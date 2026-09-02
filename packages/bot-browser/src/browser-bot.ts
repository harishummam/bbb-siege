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

export interface QoeStats {
  turnRelayUsed: boolean;
  rttMs?: number;
  audio?: { jitterMs?: number; packetsLost?: number; packetsReceived?: number; kbps?: number };
  video?: {
    framesDecoded?: number;
    fps?: number;
    freezeCount?: number;
    packetsLost?: number;
    kbps?: number;
    frameHeight?: number;
  };
}

export type BrowserOutcome =
  | {
      status: 'completed';
      browser: BrowserKind;
      iceConnected: boolean;
      iceStates: string[];
      pcCount: number;
      timings: BrowserTimings;
      qoe?: QoeStats;
    }
  | { status: 'failed'; browser: BrowserKind; error: unknown; timings: BrowserTimings };

type RawStat = Record<string, unknown> & { _pc?: number; id?: string; type?: string };

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

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

      const before = iceConnected ? await this.collectStats(page) : [];
      const statsStart = performance.now();
      await this.hold(page, signal);
      const qoe = iceConnected
        ? this.summarizeQoe(before, await this.collectStats(page), performance.now() - statsStart)
        : undefined;
      if (qoe) this.log.info({ qoe }, 'QoE collected');

      const iceStates = await this.collectIceStates(page);
      return { status: 'completed', browser: this.browserKind, iceConnected, iceStates, pcCount, timings: this.timings, qoe };
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

  private collectIceStates(page: Page): Promise<string[]> {
    return page.evaluate(
      () => (window as unknown as { __probe?: { ice: { state: string }[] } }).__probe?.ice.map((e) => e.state) ?? []
    );
  }

  private collectStats(page: Page): Promise<RawStat[]> {
    return page.evaluate(async () => {
      const probe = (window as unknown as { __probe?: { pcs: RTCPeerConnection[] } }).__probe;
      const out: Record<string, unknown>[] = [];
      if (!probe) return out;
      for (let i = 0; i < probe.pcs.length; i++) {
        try {
          const report = await probe.pcs[i].getStats();
          report.forEach((r: Record<string, unknown>) => out.push({ ...r, _pc: i }));
        } catch {
          // peer connection may be closed
        }
      }
      return out;
    });
  }

  private summarizeQoe(before: RawStat[], after: RawStat[], windowMs: number): QoeStats {
    const beforeIdx = new Map<string, RawStat>();
    for (const r of before) beforeIdx.set(`${r._pc}:${r.id}`, r);
    const afterById = new Map<string, RawStat>();
    for (const r of after) afterById.set(String(r.id), r);

    const secs = windowMs / 1000;
    const delta = (r: RawStat, field: string): number | undefined => {
      const now = num(r[field]);
      if (now === undefined) return undefined;
      const prev = num(beforeIdx.get(`${r._pc}:${r.id}`)?.[field]);
      return prev === undefined ? now : now - prev;
    };
    const kbps = (r: RawStat): number | undefined => {
      const d = delta(r, 'bytesReceived');
      return d !== undefined && secs > 0 ? Math.round((d * 8) / 1000 / secs) : undefined;
    };

    const qoe: QoeStats = { turnRelayUsed: false };

    for (const r of after) {
      if (r.type !== 'inbound-rtp') continue;
      const kind = r.kind ?? r.mediaType;
      if (kind === 'audio') {
        const jitter = num(r.jitter);
        qoe.audio = {
          jitterMs: jitter !== undefined ? Math.round(jitter * 1000) : undefined,
          packetsLost: num(r.packetsLost),
          packetsReceived: num(r.packetsReceived),
          kbps: kbps(r),
        };
      } else if (kind === 'video') {
        const dFrames = delta(r, 'framesDecoded');
        qoe.video = {
          framesDecoded: num(r.framesDecoded),
          fps: dFrames !== undefined && secs > 0 ? Math.round(dFrames / secs) : undefined,
          freezeCount: num(r.freezeCount),
          packetsLost: num(r.packetsLost),
          kbps: kbps(r),
          frameHeight: num(r.frameHeight),
        };
      }
    }

    for (const r of after) {
      if (r.type !== 'candidate-pair') continue;
      const selected = r.nominated === true || r.selected === true || r.state === 'succeeded';
      if (!selected) continue;
      const rtt = num(r.currentRoundTripTime);
      if (rtt !== undefined && qoe.rttMs === undefined) qoe.rttMs = Math.round(rtt * 1000);
      const local = afterById.get(String(r.localCandidateId));
      const remote = afterById.get(String(r.remoteCandidateId));
      if (local?.candidateType === 'relay' || remote?.candidateType === 'relay') qoe.turnRelayUsed = true;
    }

    return qoe;
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
