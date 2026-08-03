import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { chromium, firefox } from 'playwright';

// Load .env from root or current dir
const rootEnvPath = path.resolve(process.cwd(), '.env');
const parentEnvPath = path.resolve(process.cwd(), '../../.env');
if (fs.existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath });
} else if (fs.existsSync(parentEnvPath)) {
  dotenv.config({ path: parentEnvPath });
} else {
  dotenv.config();
}

const bbbUrl = process.env.BBB_URL;
const bbbSecret = process.env.BBB_SECRET;

if (!bbbUrl || !bbbSecret) {
  console.error('Error: BBB_URL and BBB_SECRET must be set in .env');
  process.exit(1);
}

const sanitizedUrl = bbbUrl.replace(/\/+$/, '');

function computeChecksum(apiCall: string, queryString: string, secret: string, algo = 'sha256'): string {
  const str = apiCall + queryString + secret;
  return crypto.createHash(algo).update(str).digest('hex');
}

function getApiEndpoint(apiCall: string): string {
  let base = sanitizedUrl;
  if (!base.endsWith('/bigbluebutton/api')) {
    if (base.endsWith('/bigbluebutton')) {
      base += '/api';
    } else {
      base += '/bigbluebutton/api';
    }
  }
  return `${base}/${apiCall}`;
}

async function apiRequest(apiCall: string, params: Record<string, string>): Promise<string> {
  const qs = new URLSearchParams(params).toString();
  let algo = 'sha256';
  let checksum = computeChecksum(apiCall, qs, bbbSecret!, algo);
  const endpoint = getApiEndpoint(apiCall);
  let url = `${endpoint}?${qs}&checksum=${checksum}`;

  console.log(`[API] Calling ${apiCall} (${algo})...`);
  let res = await fetch(url);
  let text = await res.text();

  if (text.includes('checksumError')) {
    algo = 'sha1';
    checksum = computeChecksum(apiCall, qs, bbbSecret!, algo);
    url = `${endpoint}?${qs}&checksum=${checksum}`;
    console.log(`[API] Retrying ${apiCall} with sha1...`);
    res = await fetch(url);
    text = await res.text();
  }

  return text;
}

function parseXmlTag(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}>(.*?)</${tag}>`, 's'));
  return match ? match[1].trim() : null;
}

interface CapturedWsFrame {
  timestamp: string;
  direction: 'sent' | 'received';
  payload: string;
  url: string;
}

interface CapturedGqlOp {
  timestamp: string;
  type: string;
  opName?: string;
  payload: unknown;
}

function redactData(text: string, tokens: string[]): string {
  let redacted = text;

  if (bbbSecret) {
    redacted = redacted.replaceAll(bbbSecret, '[REDACTED_SECRET]');
  }

  for (const token of tokens) {
    if (token && token.length > 3) {
      redacted = redacted.replaceAll(token, '[REDACTED_TOKEN]');
    }
  }

  redacted = redacted.replace(/sessionToken=[a-zA-Z0-9_-]+/g, 'sessionToken=[REDACTED_SESSION_TOKEN]');
  redacted = redacted.replace(/checksum=[a-fA-F0-9]+/g, 'checksum=[REDACTED_CHECKSUM]');
  redacted = redacted.replace(/"sessionToken"\s*:\s*"[^"]+"/g, '"sessionToken":"[REDACTED_SESSION_TOKEN]"');
  redacted = redacted.replace(/"authToken"\s*:\s*"[^"]+"/g, '"authToken":"[REDACTED_AUTH_TOKEN]"');
  redacted = redacted.replace(/"token"\s*:\s*"[^"]+"/g, '"token":"[REDACTED_TOKEN]"');
  redacted = redacted.replace(/JSESSIONID=[a-zA-Z0-9_-]+/g, 'JSESSIONID=[REDACTED_JSESSIONID]');

  return redacted;
}

async function runCapture(browserType: 'chromium' | 'firefox', joinUrl: string, extractedTokens: string[]) {
  console.log(`\n========================================`);
  console.log(`Starting capture for ${browserType.toUpperCase()}`);
  console.log(`========================================\n`);

  const outputDir = path.resolve(process.cwd(), 'output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const harPath = path.join(outputDir, `har-${browserType}.har`);
  const jsonPath = path.join(outputDir, `capture-${browserType}.json`);
  const screenshotPath = path.join(outputDir, `screenshot-${browserType}.png`);

  const launcher = browserType === 'chromium' ? chromium : firefox;
  const browser = await launcher.launch({
    headless: true,
    firefoxUserPrefs: browserType === 'firefox' ? {
      'media.navigator.permission.disabled': true,
      'media.navigator.streams.fake': true,
    } : undefined,
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--allow-file-access-from-files',
    ],
  });

  const context = await browser.newContext({
    recordHar: { path: harPath },
    permissions: browserType === 'chromium' ? ['microphone', 'camera'] : undefined,
    ignoreHTTPSErrors: true,
  });

  const page = await context.newPage();

  page.on('console', (msg) => {
    const text = msg.text();
    if (!text.includes('preload tag') && !text.includes('Feature-Policy')) {
      console.log(`[CONSOLE ${browserType}]`, msg.type(), text);
    }
  });

  page.on('pageerror', (err) => console.error(`[PAGE ERROR ${browserType}]`, err.message));

  const wsFrames: CapturedWsFrame[] = [];
  const gqlOps: CapturedGqlOp[] = [];
  let connectionInitPayload: unknown = null;

  // WebRTC tracking via plain JS string injection
  await page.addInitScript(`
    (function() {
      window.__webrtcEvents = [];
      const origPeerConnection = window.RTCPeerConnection;
      if (!origPeerConnection) return;

      function logEvent(event, data) {
        window.__webrtcEvents.push({
          timestamp: new Date().toISOString(),
          event: event,
          data: data
        });
      }

      window.RTCPeerConnection = function(...args) {
        const pc = new origPeerConnection(...args);
        logEvent('createPeerConnection', args[0]);

        const origCreateOffer = pc.createOffer.bind(pc);
        pc.createOffer = async function(...oArgs) {
          const offer = await origCreateOffer(...oArgs);
          logEvent('createOffer', { sdp: offer.sdp, type: offer.type });
          return offer;
        };

        const origCreateAnswer = pc.createAnswer.bind(pc);
        pc.createAnswer = async function(...aArgs) {
          const answer = await origCreateAnswer(...aArgs);
          logEvent('createAnswer', { sdp: answer.sdp, type: answer.type });
          return answer;
        };

        const origSetLocalDescription = pc.setLocalDescription.bind(pc);
        pc.setLocalDescription = async function(desc) {
          logEvent('setLocalDescription', desc ? { sdp: desc.sdp, type: desc.type } : null);
          return origSetLocalDescription(desc);
        };

        const origSetRemoteDescription = pc.setRemoteDescription.bind(pc);
        pc.setRemoteDescription = async function(desc) {
          logEvent('setRemoteDescription', desc ? { sdp: desc.sdp, type: desc.type } : null);
          return origSetRemoteDescription(desc);
        };

        pc.addEventListener('icecandidate', (evt) => {
          logEvent('icecandidate', evt.candidate ? evt.candidate.toJSON() : null);
        });

        pc.addEventListener('iceconnectionstatechange', () => {
          logEvent('iceconnectionstatechange', pc.iceConnectionState);
        });

        return pc;
      };
      Object.assign(window.RTCPeerConnection, origPeerConnection);
    })();
  `);

  // Track WebSockets
  page.on('websocket', (ws) => {
    const url = ws.url();
    console.log(`[WS Created ${browserType}] ${url}`);

    ws.on('framesent', (frame) => {
      const payload = String(frame.payload);
      wsFrames.push({
        timestamp: new Date().toISOString(),
        direction: 'sent',
        payload,
        url,
      });

      try {
        const parsed = JSON.parse(payload);
        if (parsed.type === 'connection_init') {
          connectionInitPayload = parsed;
          console.log(`[GQL ${browserType}] Captured connection_init payload!`);
        } else if (parsed.type === 'subscribe' || parsed.type === 'start') {
          gqlOps.push({
            timestamp: new Date().toISOString(),
            type: 'subscribe',
            opName: parsed.payload?.operationName || parsed.id,
            payload: parsed,
          });
        } else if (parsed.type === 'mutation') {
          gqlOps.push({
            timestamp: new Date().toISOString(),
            type: 'mutation',
            opName: parsed.payload?.operationName,
            payload: parsed,
          });
        }
      } catch {
        // Not JSON
      }
    });

    ws.on('framereceived', (frame) => {
      const payload = String(frame.payload);
      wsFrames.push({
        timestamp: new Date().toISOString(),
        direction: 'received',
        payload,
        url,
      });

      try {
        const parsed = JSON.parse(payload);
        if (parsed.type === 'next' || parsed.type === 'data') {
          gqlOps.push({
            timestamp: new Date().toISOString(),
            type: 'data_response',
            opName: parsed.id,
            payload: parsed,
          });
        }
      } catch {
        // Not JSON
      }
    });
  });

  console.log(`[Navigating ${browserType}] ${joinUrl}`);
  await page.goto(joinUrl, { waitUntil: 'networkidle' });

  // Give page time to interact with audio and webcam UI
  await page.waitForTimeout(5000);

  try {
    console.log(`[UI ${browserType}] Checking UI elements...`);

    // Look for microphone button
    const micButton = page.locator('button:has-text("Microphone"), [aria-label*="Microphone"], [data-test="microphoneButton"]');
    if (await micButton.first().isVisible({ timeout: 5000 })) {
      console.log(`[UI ${browserType}] Clicking Microphone button...`);
      await micButton.first().click();

      const confirmEcho = page.locator('button:has-text("Yes"), [aria-label*="Echo"]');
      if (await confirmEcho.first().isVisible({ timeout: 5000 })) {
        console.log(`[UI ${browserType}] Confirming Echo test...`);
        await confirmEcho.first().click();
      }
    }

    // Try starting webcam
    const webcamButton = page.locator('button:has-text("Share camera"), [aria-label*="camera"], [data-test="webcamButton"]');
    if (await webcamButton.first().isVisible({ timeout: 3000 })) {
      console.log(`[UI ${browserType}] Clicking Webcam button...`);
      await webcamButton.first().click();

      const startSharing = page.locator('button:has-text("Start sharing")');
      if (await startSharing.first().isVisible({ timeout: 3000 })) {
        console.log(`[UI ${browserType}] Clicking Start Sharing...`);
        await startSharing.first().click();
      }
    }
  } catch (err) {
    console.log(`[UI Note ${browserType}]`, (err as Error).message);
  }

  console.log(`[Waiting ${browserType}] Holding session for 15s...`);
  await page.waitForTimeout(15000);

  await page.screenshot({ path: screenshotPath });
  console.log(`[Screenshot ${browserType}] Saved to ${screenshotPath}`);

  const pageWebRtcEvents = await page.evaluate(() => {
    return (window as unknown as Record<string, unknown>).__webrtcEvents || [];
  });

  await context.close();
  await browser.close();

  const dump = {
    browser: browserType,
    capturedAt: new Date().toISOString(),
    connectionInitPayload,
    graphqlOpsCount: gqlOps.length,
    websocketFramesCount: wsFrames.length,
    webrtcEventsCount: (pageWebRtcEvents as unknown[]).length,
    connectionInit: connectionInitPayload,
    graphqlOps: gqlOps,
    websocketFrames: wsFrames,
    webrtcEvents: pageWebRtcEvents,
  };

  const rawJsonStr = JSON.stringify(dump, null, 2);
  const redactedJsonStr = redactData(rawJsonStr, extractedTokens);

  fs.writeFileSync(jsonPath, redactedJsonStr, 'utf-8');
  console.log(`[Saved ${browserType}] Captured data written to ${jsonPath}`);

  if (fs.existsSync(harPath)) {
    const harText = fs.readFileSync(harPath, 'utf-8');
    const redactedHar = redactData(harText, extractedTokens);
    fs.writeFileSync(harPath, redactedHar, 'utf-8');
    console.log(`[Saved ${browserType}] Sanitized HAR written to ${harPath}`);
  }
}

async function main() {
  console.log('=== BBB 3.0 Protocol Capture Script ===');
  const meetingID = `capture-${Date.now()}`;
  const name = 'Capture Test Meeting';

  const createXml = await apiRequest('create', {
    meetingID,
    name,
    attendeePW: 'ap',
    moderatorPW: 'mp',
    record: 'false',
  });

  const returncode = parseXmlTag(createXml, 'returncode');
  console.log(`[API create] Return code: ${returncode}`);
  if (returncode !== 'SUCCESS') {
    console.error('[API create] Failed:', createXml);
    process.exit(1);
  }

  // 1. Join Chromium (direct join URL with redirect=true to capture session cookies)
  const qsChromium = new URLSearchParams({
    fullName: 'Test Moderator Chromium',
    meetingID,
    password: 'mp',
    redirect: 'true',
  }).toString();
  const sumChromium = computeChecksum('join', qsChromium, bbbSecret!, 'sha256');
  const joinUrlChromium = `${getApiEndpoint('join')}?${qsChromium}&checksum=${sumChromium}`;

  console.log(`[API join Chromium] Got redirect join URL successfully.`);
  await runCapture('chromium', joinUrlChromium, []);

  // 2. Join Firefox
  const qsFirefox = new URLSearchParams({
    fullName: 'Test Moderator Firefox',
    meetingID,
    password: 'mp',
    redirect: 'true',
  }).toString();
  const sumFirefox = computeChecksum('join', qsFirefox, bbbSecret!, 'sha256');
  const joinUrlFirefox = `${getApiEndpoint('join')}?${qsFirefox}&checksum=${sumFirefox}`;

  console.log(`[API join Firefox] Got redirect join URL successfully.`);
  await runCapture('firefox', joinUrlFirefox, []);

  console.log('\n=== Protocol Capture Complete! ===');
}

main().catch((err) => {
  console.error('Fatal error during protocol capture:', err);
  process.exit(1);
});
