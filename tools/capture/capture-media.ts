import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { chromium, type Browser, type Page } from 'playwright';

const rootEnvPath = path.resolve(process.cwd(), '.env');
const parentEnvPath = path.resolve(process.cwd(), '../../.env');
if (fs.existsSync(rootEnvPath)) dotenv.config({ path: rootEnvPath });
else if (fs.existsSync(parentEnvPath)) dotenv.config({ path: parentEnvPath });
else dotenv.config();

const bbbUrl = process.env.BBB_URL;
const bbbSecret = process.env.BBB_SECRET;
if (!bbbUrl || !bbbSecret) {
  console.error('Error: BBB_URL and BBB_SECRET must be set in .env');
  process.exit(1);
}
const sanitizedUrl = bbbUrl.replace(/\/+$/, '');
const holdMs = Number(process.env.HOLD_MS ?? 15_000);

function checksum(apiCall: string, qs: string): string {
  return crypto.createHash('sha256').update(apiCall + qs + bbbSecret).digest('hex');
}
function endpoint(apiCall: string): string {
  let base = sanitizedUrl;
  if (!base.endsWith('/bigbluebutton/api')) {
    base += base.endsWith('/bigbluebutton') ? '/api' : '/bigbluebutton/api';
  }
  return `${base}/${apiCall}`;
}
async function apiRequest(apiCall: string, params: Record<string, string>): Promise<string> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${endpoint(apiCall)}?${qs}&checksum=${checksum(apiCall, qs)}`);
  return res.text();
}
function joinUrl(meetingID: string, fullName: string, password: string): string {
  const qs = new URLSearchParams({ fullName, meetingID, password, redirect: 'true' }).toString();
  return `${endpoint('join')}?${qs}&checksum=${checksum('join', qs)}`;
}

function redact(text: string): string {
  return text
    .replaceAll(bbbSecret!, '[REDACTED_SECRET]')
    .replace(/sessionToken=[a-zA-Z0-9_-]+/g, 'sessionToken=[REDACTED_SESSION_TOKEN]')
    .replace(/checksum=[a-fA-F0-9]+/g, 'checksum=[REDACTED_CHECKSUM]')
    .replace(/"(sessionToken|authToken|token|credential|password)"\s*:\s*"[^"]+"/g, '"$1":"[REDACTED]"')
    .replace(/\\"(sessionToken|authToken|token|credential|password)\\"\s*:\s*\\"[^"\\]+\\"/g, '\\"$1\\":\\"[REDACTED]\\"')
    .replace(/a=ice-pwd:[^\s\\]+/g, 'a=ice-pwd:[REDACTED]')
    .replace(/JSESSIONID=[a-zA-Z0-9_-]+/g, 'JSESSIONID=[REDACTED_JSESSIONID]');
}

const MEDIA_KEYWORDS = /bridge|voice|audio|camera|webcam|stream|sfu|livekit|mediasoup|kurento|turn|stun|ice/i;

type Role = 'publisher' | 'viewer';

interface WsFrame {
  t: number;
  role: Role;
  url: string;
  direction: 'sent' | 'received' | 'open' | 'close';
  payload?: unknown;
}

interface HttpExchange {
  t: number;
  role: Role;
  method: string;
  url: string;
  status?: number;
  body?: string;
}

const PC_INIT_SCRIPT = `(() => {
  const Orig = window.RTCPeerConnection;
  if (!Orig) return;
  const cap = { t0: Date.now(), events: [] };
  window.__mediaCap = cap;
  const log = (pc, event, data) => cap.events.push({ t: Date.now() - cap.t0, pc, event, data });
  let seq = 0;
  window.RTCPeerConnection = function (config, ...rest) {
    const pc = new Orig(config, ...rest);
    const id = seq++;
    log(id, 'create', config ? JSON.parse(JSON.stringify(config)) : null);
    const wrap = (name) => {
      const orig = pc[name].bind(pc);
      pc[name] = async (...args) => {
        const result = await orig(...args);
        if (result && result.sdp) log(id, name, { type: result.type, sdp: result.sdp });
        return result;
      };
    };
    ['createOffer', 'createAnswer'].forEach(wrap);
    for (const name of ['setLocalDescription', 'setRemoteDescription']) {
      const orig = pc[name].bind(pc);
      pc[name] = (desc, ...args) => {
        log(id, name, desc ? { type: desc.type, sdp: desc.sdp } : null);
        return orig(desc, ...args);
      };
    }
    const origAddTrack = pc.addTrack.bind(pc);
    pc.addTrack = (track, ...streams) => {
      log(id, 'addTrack', { kind: track.kind, label: track.label });
      return origAddTrack(track, ...streams);
    };
    const origAddTransceiver = pc.addTransceiver.bind(pc);
    pc.addTransceiver = (trackOrKind, init) => {
      log(id, 'addTransceiver', { kind: typeof trackOrKind === 'string' ? trackOrKind : trackOrKind.kind, direction: init && init.direction });
      return origAddTransceiver(trackOrKind, init);
    };
    pc.addEventListener('icecandidate', (e) => log(id, 'icecandidate', e.candidate ? e.candidate.candidate : null));
    pc.addEventListener('iceconnectionstatechange', () => log(id, 'iceconnectionstate', pc.iceConnectionState));
    pc.addEventListener('connectionstatechange', () => log(id, 'connectionstate', pc.connectionState));
    pc.addEventListener('track', (e) => log(id, 'track', { kind: e.track.kind }));
    return pc;
  };
  window.RTCPeerConnection.prototype = Orig.prototype;
  Object.setPrototypeOf(window.RTCPeerConnection, Orig);
})();`;

const t0 = Date.now();
const frames: WsFrame[] = [];
const gqlMedia: WsFrame[] = [];
const http: HttpExchange[] = [];

function parse(payload: string | Buffer): unknown {
  const text = typeof payload === 'string' ? payload : payload.toString('utf-8');
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function instrument(page: Page, role: Role): void {
  page.on('websocket', (ws) => {
    const url = ws.url();
    const isGraphql = /\/graphql/.test(url);
    console.log(`[${role}] ws open ${url.replace(/\?.*/, '')}`);
    if (!isGraphql) frames.push({ t: Date.now() - t0, role, url, direction: 'open' });
    const record = (direction: 'sent' | 'received') => (frame: { payload: string | Buffer }) => {
      const payload = parse(frame.payload);
      if (!isGraphql) {
        frames.push({ t: Date.now() - t0, role, url, direction, payload });
        const id = (payload as { id?: string })?.id;
        console.log(`[${role}] sfu ${direction} ${id ?? typeof payload}`);
        return;
      }
      const text = typeof frame.payload === 'string' ? frame.payload : frame.payload.toString('utf-8');
      const isMutation = direction === 'sent' && /\bmutation\b/.test(text);
      if (isMutation || MEDIA_KEYWORDS.test(text)) {
        gqlMedia.push({ t: Date.now() - t0, role, url, direction, payload });
        if (isMutation) console.log(`[${role}] gql mutation ${(payload as { payload?: { operationName?: string } }).payload?.operationName}`);
      }
    };
    ws.on('framesent', record('sent'));
    ws.on('framereceived', record('received'));
    ws.on('close', () => {
      if (!isGraphql) frames.push({ t: Date.now() - t0, role, url, direction: 'close' });
    });
  });

  page.on('response', async (res) => {
    const url = res.url();
    if (!/stun|turn|sfu|livekit|mediasoup|ice/i.test(url) || /\.(js|css|woff2?|svg|png)(\?|$)/.test(url)) return;
    let body: string | undefined;
    try {
      body = (await res.text()).slice(0, 20_000);
    } catch {
      body = undefined;
    }
    http.push({ t: Date.now() - t0, role, method: res.request().method(), url, status: res.status(), body });
    console.log(`[${role}] http ${res.status()} ${url.replace(/\?.*/, '')}`);
  });
}

async function clickFirst(page: Page, role: Role, label: string, selectors: string[]): Promise<boolean> {
  for (const selector of selectors) {
    try {
      const locator = page.locator(selector).first();
      if (await locator.isVisible({ timeout: 1500 })) {
        await locator.click({ timeout: 3000 });
        console.log(`[${role}] ${label}: clicked ${selector}`);
        return true;
      }
    } catch {
      // try next candidate
    }
  }
  console.log(`[${role}] ${label}: no matching element`);
  return false;
}

async function domClickByTest(page: Page, role: Role, test: string): Promise<boolean> {
  const clicked = await page.evaluate((t) => {
    const els = Array.from(document.querySelectorAll('button, a, [role="button"]'));
    const el = els.find((e) => e.getAttribute('data-test') === t && (e as HTMLElement).offsetParent !== null) as
      | HTMLElement
      | undefined;
    el?.click();
    return Boolean(el);
  }, test);
  console.log(`[${role}] dom click ${test}: ${clicked ? 'clicked' : 'not found'}`);
  return clicked;
}

async function openPage(browser: Browser, role: Role, url: string): Promise<Page> {
  const context = await browser.newContext({ permissions: ['microphone', 'camera'], ignoreHTTPSErrors: true });
  const page = await context.newPage();
  await page.addInitScript(PC_INIT_SCRIPT);
  instrument(page, role);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
  await page.waitForTimeout(4000);
  return page;
}

async function publish(page: Page): Promise<void> {
  await clickFirst(page, 'publisher', 'microphone', ['[data-test="microphoneBtn"]', 'button:has-text("Microphone")']);
  await page.waitForTimeout(2500);
  await clickFirst(page, 'publisher', 'join conference audio', ['[data-test="joinEchoTestButton"]']);
  await page.waitForTimeout(3000);
  await domClickByTest(page, 'publisher', 'closeModal');
  await page.waitForTimeout(1000);
  if (await domClickByTest(page, 'publisher', 'joinVideo')) {
    await page.waitForTimeout(3500);
    if (!(await domClickByTest(page, 'publisher', 'startSharingWebcam'))) {
      await clickFirst(page, 'publisher', 'start sharing', ['button:has-text("Start sharing")']);
    }
  }
}

async function listenOnly(page: Page): Promise<void> {
  const joined = await clickFirst(page, 'viewer', 'listen only', [
    '[data-test="listenOnlyBtn"]',
    'button:has-text("Listen only")',
  ]);
  if (!joined) await domClickByTest(page, 'viewer', 'closeModal');
}

async function stopWebcam(page: Page): Promise<void> {
  const stopped =
    (await domClickByTest(page, 'publisher', 'leaveVideo')) ||
    (await clickFirst(page, 'publisher', 'stop webcam', [
      'button[aria-label*="Stop sharing webcam" i]',
      'button:has-text("Stop sharing")',
    ]));
  if (!stopped) await domClickByTest(page, 'publisher', 'joinVideo');
}

async function pcEvents(page: Page): Promise<unknown> {
  return page.evaluate(() => (window as unknown as { __mediaCap?: unknown }).__mediaCap ?? null).catch(() => null);
}

async function main(): Promise<void> {
  const meetingID = `capture-media-${Date.now()}`;
  const createXml = await apiRequest('create', { meetingID, name: 'Capture Media', moderatorPW: 'mp', attendeePW: 'ap' });
  if (!/<returncode>SUCCESS<\/returncode>/.test(createXml)) {
    console.error('create failed:', createXml);
    process.exit(1);
  }
  console.log(`[API] meeting created ${meetingID}`);

  const browser = await chromium.launch({
    headless: true,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
  });
  const onSigint = (): void => void browser.close();
  process.once('SIGINT', onSigint);

  const result: Record<string, unknown> = { capturedAt: new Date().toISOString(), meetingID };
  try {
    const publisher = await openPage(browser, 'publisher', joinUrl(meetingID, 'Media Publisher', 'mp'));
    await publish(publisher);
    console.log('[capture] publisher media requested; joining viewer');

    const viewer = await openPage(browser, 'viewer', joinUrl(meetingID, 'Media Viewer', 'ap'));
    await listenOnly(viewer);

    console.log(`[capture] holding ${holdMs}ms`);
    await viewer.waitForTimeout(holdMs);

    await stopWebcam(publisher);
    await publisher.waitForTimeout(4000);

    result.publisherPc = await pcEvents(publisher);
    result.viewerPc = await pcEvents(viewer);

    await viewer.context().close();
    await publisher.waitForTimeout(1500);
    await publisher.context().close();
    await new Promise((r) => setTimeout(r, 1500));
  } finally {
    process.off('SIGINT', onSigint);
    await browser.close().catch(() => undefined);
    await apiRequest('end', { meetingID, password: 'mp' }).catch(() => undefined);
    console.log('[API] meeting ended');
  }

  Object.assign(result, {
    sfuFrameCount: frames.length,
    sfuFrames: frames,
    graphqlMediaFrameCount: gqlMedia.length,
    graphqlMediaFrames: gqlMedia,
    http,
  });

  const outputDir = path.resolve(process.cwd(), 'output');
  fs.mkdirSync(outputDir, { recursive: true });
  const outPath = path.join(outputDir, 'media-chromium.json');
  fs.writeFileSync(outPath, redact(JSON.stringify(result, null, 2)), 'utf-8');

  const ids = frames.map((f) => `${f.role}:${f.direction}:${(f.payload as { id?: string })?.id ?? '-'}`);
  console.log(`\n[Saved] ${frames.length} SFU frames, ${gqlMedia.length} GraphQL media frames -> ${outPath}`);
  console.log('SFU sockets:', [...new Set(frames.map((f) => f.url.replace(/\?.*/, '')))].join(', ') || '(none)');
  console.log('SFU message ids:', [...new Set(ids)].join(', '));
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
