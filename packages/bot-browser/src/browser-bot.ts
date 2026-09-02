import { performance } from 'node:perf_hooks';
import type { BbbApiClient } from '@bbb-siege/api-client';
import { chromium, firefox, type Browser, type BrowserContext, type Page } from 'playwright';
import pino, { type Logger } from 'pino';
import { PROBE_INIT_SCRIPT } from './init-script.js';

export type BrowserKind = 'chromium' | 'firefox';

export interface BrowserBotConfig {
  client: BbbApiClient;
  meetingID: string;
  password: string;
  fullName: string;
  browser?: BrowserKind;
  holdMs?: number;
  iceTimeoutMs?: number;
  logger?: Logger;
}

export interface BrowserTimings {
  navigateMs?: number;
  iceConnectedMs?: number;
}

export type BrowserOutcome =
  | {
      status: 'completed';
      browser: BrowserKind;
      iceConnected: boolean;
      pcCount: number;
      timings: BrowserTimings;
    }
  | { status: 'failed'; browser: BrowserKind; error: unknown; timings: BrowserTimings };

interface IceEvent {
  t: number;
  state: string;
}

async function clickFirst(page: Page, label: string, selectors: string[], log: Logger): Promise<boolean> {
  for (const selector of selectors) {
    try {
      const locator = page.locator(selector).first();
      if (await locator.isVisible({ timeout: 1500 })) {
        await locator.click({ timeout: 3000 });
        log.debug({ selector }, `clicked ${label}`);
        return true;
      }
    } catch {
      // try next candidate
    }
  }
  log.debug(`${label}: no matching element`);
  return false;
}

export class BrowserBot {
  private readonly config: BrowserBotConfig;
  private readonly browserKind: BrowserKind;
  private readonly log: Logger;
  private readonly timings: BrowserTimings = {};

  constructor(config: BrowserBotConfig) {
    this.config = config;
    this.browserKind = config.browser ?? 'chromium';
    this.log = (config.logger ?? pino({ name: 'browser-bot' })).child({ browser: this.browserKind });
  }

  async run(signal?: AbortSignal): Promise<BrowserOutcome> {
    const start = performance.now();
    const joinUrl = this.config.client.buildJoinUrl({
      fullName: this.config.fullName,
      meetingID: this.config.meetingID,
      password: this.config.password,
      redirect: true,
    });

    let browser: Browser | undefined;
    let context: BrowserContext | undefined;
    const onAbort = (): void => void browser?.close();
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      browser = await this.launch();
      context = await browser.newContext({
        permissions: this.browserKind === 'chromium' ? ['microphone', 'camera'] : undefined,
        ignoreHTTPSErrors: true,
      });
      const page = await context.newPage();
      await page.addInitScript(PROBE_INIT_SCRIPT);

      const navStart = performance.now();
      await page.goto(joinUrl, { waitUntil: 'networkidle', timeout: 30_000 });
      this.timings.navigateMs = performance.now() - navStart;
      this.log.debug('client loaded');

      await this.joinMedia(page);

      const iceConnected = await this.waitForIce(page, this.config.iceTimeoutMs ?? 25_000);
      if (iceConnected) {
        this.timings.iceConnectedMs = performance.now() - start;
        this.log.info({ iceConnectedMs: Math.round(this.timings.iceConnectedMs) }, 'ICE connected');
      } else {
        this.log.warn('ICE did not reach connected within timeout');
      }

      const pcCount = await page.evaluate(() => (window as unknown as { __probe?: { pcs: unknown[] } }).__probe?.pcs.length ?? 0);
      await this.hold(page, signal);

      return { status: 'completed', browser: this.browserKind, iceConnected, pcCount, timings: this.timings };
    } catch (error) {
      this.log.error({ err: error }, 'browser probe failed');
      return { status: 'failed', browser: this.browserKind, error, timings: this.timings };
    } finally {
      signal?.removeEventListener('abort', onAbort);
      await context?.close().catch(() => undefined);
      await browser?.close().catch(() => undefined);
      this.log.debug('browser closed');
    }
  }

  private launch(): Promise<Browser> {
    if (this.browserKind === 'firefox') {
      return firefox.launch({
        headless: true,
        firefoxUserPrefs: {
          'media.navigator.permission.disabled': true,
          'media.navigator.streams.fake': true,
        },
      });
    }
    return chromium.launch({
      headless: true,
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
    });
  }

  private async joinMedia(page: Page): Promise<void> {
    await page.waitForTimeout(4000);
    await clickFirst(
      page,
      'microphone',
      ['[data-test="microphoneBtn"]', 'button:has-text("Microphone")', 'button[aria-label*="Microphone" i]'],
      this.log
    );
    await page.waitForTimeout(2500);
    await clickFirst(page, 'join conference audio', ['[data-test="joinEchoTestButton"]'], this.log);
    await page.waitForTimeout(2000);
    await this.domClickByTest(page, 'closeModal');
    await page.waitForTimeout(1000);
    const sharedCamera = await this.domClickByTest(page, 'joinVideo');
    if (sharedCamera) {
      await page.waitForTimeout(3500);
      await this.dumpButtons(page);
      const started =
        (await this.domClickByTest(page, 'startSharingWebcam')) ||
        (await clickFirst(
          page,
          'start sharing',
          ['button:has-text("Start sharing")', 'button[aria-label*="Start sharing" i]'],
          this.log
        ));
      this.log.debug({ started }, 'webcam share');
    }
  }

  private async domClickByTest(page: Page, test: string): Promise<boolean> {
    const clicked = await page.evaluate((t) => {
      const els = Array.from(document.querySelectorAll('button, a, [role="button"]'));
      const el = els.find(
        (e) => e.getAttribute('data-test') === t && (e as HTMLElement).offsetParent !== null
      ) as HTMLElement | undefined;
      if (el) {
        el.click();
        return true;
      }
      return false;
    }, test);
    this.log.debug({ test, clicked }, 'domClickByTest');
    return clicked;
  }

  private async dumpButtons(page: Page): Promise<void> {
    const buttons = await page.evaluate(() =>
      Array.from(document.querySelectorAll('button'))
        .filter((b) => (b as HTMLElement).offsetParent !== null)
        .map((b) => ({
          test: b.getAttribute('data-test'),
          label: b.getAttribute('aria-label'),
        }))
        .filter((b) => b.test || b.label)
    );
    this.log.debug({ buttons }, 'visible toolbar buttons');
  }

  private async waitForIce(page: Page, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const states = await page.evaluate(
        () => (window as unknown as { __probe?: { ice: IceEvent[] } }).__probe?.ice.map((e) => e.state) ?? []
      );
      if (states.some((s) => s === 'connected' || s === 'completed')) return true;
      if (states.includes('failed')) return false;
      await page.waitForTimeout(500);
    }
    return false;
  }

  private async hold(page: Page, signal?: AbortSignal): Promise<void> {
    const holdMs = this.config.holdMs ?? 0;
    if (holdMs <= 0 || signal?.aborted) return;
    const step = 500;
    let elapsed = 0;
    while (elapsed < holdMs && !signal?.aborted) {
      await page.waitForTimeout(Math.min(step, holdMs - elapsed));
      elapsed += step;
    }
  }
}
