import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { chromium } from 'playwright';

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

function checksum(apiCall: string, qs: string, algo = 'sha256'): string {
  return crypto.createHash(algo).update(apiCall + qs + bbbSecret).digest('hex');
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
  const url = `${endpoint(apiCall)}?${qs}&checksum=${checksum(apiCall, qs)}`;
  const res = await fetch(url);
  return res.text();
}
function redact(text: string): string {
  return text
    .replaceAll(bbbSecret!, '[REDACTED_SECRET]')
    .replace(/sessionToken=[a-zA-Z0-9_-]+/g, 'sessionToken=[REDACTED_SESSION_TOKEN]')
    .replace(/checksum=[a-fA-F0-9]+/g, 'checksum=[REDACTED_CHECKSUM]')
    .replace(/"authToken"\s*:\s*"[^"]+"/g, '"authToken":"[REDACTED_AUTH_TOKEN]"')
    .replace(/JSESSIONID=[a-zA-Z0-9_-]+/g, 'JSESSIONID=[REDACTED_JSESSIONID]');
}

interface GqlOp {
  timestamp: string;
  opName?: string;
  payload: unknown;
}

interface UiButton {
  test: string | null;
  label: string | null;
  text: string;
}

interface UiDump {
  buttons: UiButton[];
  inputs: {
    tag: string;
    id?: string;
    test: string | null;
    label: string | null;
    placeholder: string | null;
  }[];
}

async function clickFirst(page: import('playwright').Page, label: string, selectors: string[]): Promise<boolean> {
  for (const selector of selectors) {
    try {
      const el = page.locator(selector).first();
      if (await el.isVisible({ timeout: 2000 })) {
        await el.click();
        console.log(`[UI] ${label}: clicked "${selector}"`);
        return true;
      }
    } catch {
      // try next selector
    }
  }
  console.log(`[UI] ${label}: no matching element found`);
  return false;
}

const UI_SCAN = `(function () {
  var visible = function (el) { return el.offsetParent !== null; };
  var buttons = Array.prototype.slice.call(document.querySelectorAll('button'))
    .filter(visible)
    .map(function (b) {
      return { test: b.getAttribute('data-test'), label: b.getAttribute('aria-label'), text: (b.textContent || '').trim().slice(0, 40) };
    })
    .filter(function (b) { return b.test || b.label || b.text; });
  var inputs = Array.prototype.slice.call(document.querySelectorAll('textarea, input, [contenteditable="true"]'))
    .map(function (i) {
      return { tag: i.tagName.toLowerCase(), id: i.id || undefined, test: i.getAttribute('data-test'), label: i.getAttribute('aria-label'), placeholder: i.getAttribute('placeholder') };
    });
  return { buttons: buttons, inputs: inputs };
})()`;

async function domClickByTest(page: import('playwright').Page, testName: string): Promise<boolean> {
  const script = `(function () {
    var els = Array.prototype.slice.call(document.querySelectorAll('button, a, [role="button"]'));
    var el = els.filter(function (e) { return e.getAttribute('data-test') === '${testName}' && e.offsetParent !== null; })[0];
    if (el) { el.click(); return true; }
    return false;
  })()`;
  const ok = (await page.evaluate(script)) as boolean;
  console.log(`[DOM click] ${testName}: ${ok ? 'clicked' : 'not found'}`);
  return ok;
}

async function domFocus(page: import('playwright').Page, selector: string): Promise<boolean> {
  const script = `(function () {
    var els = Array.prototype.slice.call(document.querySelectorAll('${selector}'));
    var el = els.filter(function (e) { return e.offsetParent !== null; })[0] || els[0];
    if (el) { el.focus(); return true; }
    return false;
  })()`;
  return (await page.evaluate(script)) as boolean;
}

async function dumpUi(page: import('playwright').Page, label: string): Promise<UiDump> {
  const ui = (await page.evaluate(UI_SCAN)) as UiDump;
  const dir = path.resolve(process.cwd(), 'output');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `ui-${label}.json`), JSON.stringify(ui, null, 2), 'utf-8');
  console.log(`\n[UI ${label}] ${ui.inputs.length} inputs, ${ui.buttons.length} buttons`);
  console.log(`[UI ${label}] inputs:`, JSON.stringify(ui.inputs));
  const relevant = ui.buttons.filter((b) => /hand|raise|react|chat|send|message/i.test(`${b.test} ${b.label} ${b.text}`));
  console.log(`[UI ${label}] chat/hand buttons:`, JSON.stringify(relevant));
  return ui;
}

async function main(): Promise<void> {
  const meetingID = `capture-actions-${Date.now()}`;
  const createXml = await apiRequest('create', { meetingID, name: 'Capture Actions', moderatorPW: 'mp', attendeePW: 'ap' });
  if (!/<returncode>SUCCESS<\/returncode>/.test(createXml)) {
    console.error('create failed:', createXml);
    process.exit(1);
  }
  console.log(`[API] meeting created ${meetingID}`);

  const qs = new URLSearchParams({ fullName: 'Actions Bot', meetingID, password: 'mp', redirect: 'true' }).toString();
  const joinUrl = `${endpoint('join')}?${qs}&checksum=${checksum('join', qs)}`;

  const browser = await chromium.launch({ headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const context = await browser.newContext({ permissions: ['microphone', 'camera'], ignoreHTTPSErrors: true });
  const page = await context.newPage();

  const ops: GqlOp[] = [];
  page.on('websocket', (ws) => {
    ws.on('framesent', (frame) => {
      try {
        const parsed = JSON.parse(String(frame.payload)) as { type?: string; id?: string; payload?: { operationName?: string; query?: string } };
        if (parsed.type === 'subscribe' && /^\s*mutation\b/.test(parsed.payload?.query ?? '')) {
          ops.push({ timestamp: new Date().toISOString(), opName: parsed.payload?.operationName, payload: parsed });
          console.log(`[GQL mutation sent] ${parsed.payload?.operationName}`);
        }
      } catch {
        // not JSON
      }
    });
  });

  console.log(`[Nav] ${joinUrl.replace(/checksum=[a-f0-9]+/, 'checksum=...')}`);
  await page.goto(joinUrl, { waitUntil: 'networkidle' });
  await page.waitForTimeout(5000);

  await clickFirst(page, 'dismiss audio modal', [
    '[data-test="listenOnlyBtn"]',
    'button:has-text("Listen only")',
    'button[aria-label="Close"]',
    '[data-test="closeModal"]',
  ]);
  await page.waitForTimeout(3000);

  await dumpUi(page, 'after-join');

  await domClickByTest(page, 'chatButton');
  await page.waitForTimeout(2500);
  const ui2 = await dumpUi(page, 'after-chat-open');

  try {
    const focused = await domFocus(page, '#message-input, textarea[aria-label*="message" i]');
    if (focused) {
      await page.keyboard.type('bbb-siege capture: hello');
      console.log('[UI] chat: typed message');
      const sent = await domClickByTest(page, 'sendMessageButton');
      if (!sent) await page.keyboard.press('Enter');
      console.log('[UI] chat: message submitted');
    } else {
      console.log('[UI] chat: message input not found; inputs =', JSON.stringify(ui2.inputs));
    }
  } catch (err) {
    console.log('[UI] chat: failed', (err as Error).message);
  }
  await page.waitForTimeout(2000);

  await domClickByTest(page, 'raiseHandBtn');
  await page.waitForTimeout(3000);

  await context.close();
  await browser.close();
  await apiRequest('end', { meetingID, password: 'mp' });
  console.log(`[API] meeting ended`);

  const outputDir = path.resolve(process.cwd(), 'output');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const outPath = path.join(outputDir, 'actions-chromium.json');
  const dump = { capturedAt: new Date().toISOString(), mutationOpsCount: ops.length, mutationOps: ops };
  fs.writeFileSync(outPath, redact(JSON.stringify(dump, null, 2)), 'utf-8');
  console.log(`\n[Saved] ${ops.length} mutation op(s) -> ${outPath}`);
  console.log('Mutation names captured:', [...new Set(ops.map((o) => o.opName))].join(', ') || '(none)');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
