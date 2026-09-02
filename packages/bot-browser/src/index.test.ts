import { describe, expect, it } from 'vitest';
import { BrowserBot, PROBE_INIT_SCRIPT } from './index.js';

describe('bot-browser', () => {
  it('exports BrowserBot and the probe init script', () => {
    expect(typeof BrowserBot).toBe('function');
    expect(PROBE_INIT_SCRIPT).toContain('RTCPeerConnection');
    expect(PROBE_INIT_SCRIPT).toContain('iceconnectionstatechange');
  });

  it('defaults to chromium', () => {
    const bot = new BrowserBot({
      client: {} as never,
      meetingID: 'm',
      password: 'p',
      fullName: 'probe',
    });
    expect(bot).toBeInstanceOf(BrowserBot);
  });
});
