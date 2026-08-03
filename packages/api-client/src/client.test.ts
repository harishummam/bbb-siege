import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BbbApiClient } from './client.js';
import {
  AuthFailedError,
  ClientBugError,
  RateLimitedError,
  TimeoutError,
} from './errors.js';

describe('BbbApiClient Unit Tests', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('Host Guardrails', () => {
    it('throws ClientBugError when host is not in allowlist and iUnderstand is false', () => {
      expect(() => {
        new BbbApiClient({
          url: 'https://production-bbb.example.com/bigbluebutton/api',
          secret: 'secret123',
          iUnderstand: false,
          testHosts: ['test.example.com'],
        });
      }).toThrowError(ClientBugError);
    });

    it('allows initialization when host matches allowlist', () => {
      expect(() => {
        new BbbApiClient({
          url: 'https://test.example.com/bigbluebutton/api',
          secret: 'secret123',
          testHosts: ['test.example.com'],
        });
      }).not.toThrow();
    });

    it('allows initialization when iUnderstand: true is passed', () => {
      expect(() => {
        new BbbApiClient({
          url: 'https://production-bbb.example.com/bigbluebutton/api',
          secret: 'secret123',
          iUnderstand: true,
        });
      }).not.toThrow();
    });
  });

  describe('API Methods', () => {
    const config = {
      url: 'https://localhost/bigbluebutton/api',
      secret: 'secret123',
      iUnderstand: true,
    };

    it('create() constructs signed request and parses SUCCESS XML', async () => {
      const mockXml = `
        <response>
          <returncode>SUCCESS</returncode>
          <meetingID>meeting-101</meetingID>
          <internalMeetingID>int-meeting-101</internalMeetingID>
          <attendeePW>ap123</attendeePW>
          <moderatorPW>mp123</moderatorPW>
          <createTime>1785753110005</createTime>
          <hasUserJoined>false</hasUserJoined>
        </response>
      `;

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(mockXml, { status: 200 })
      );

      const client = new BbbApiClient(config);
      const res = await client.create({
        meetingID: 'meeting-101',
        name: 'Test Meeting',
      });

      expect(fetchSpy).toHaveBeenCalledOnce();
      const calledUrl = new URL(fetchSpy.mock.calls[0][0] as string);
      expect(calledUrl.pathname).toBe('/bigbluebutton/api/create');
      expect(calledUrl.searchParams.get('meetingID')).toBe('meeting-101');
      expect(calledUrl.searchParams.has('checksum')).toBe(true);

      expect(res.returncode).toBe('SUCCESS');
      expect(res.meetingID).toBe('meeting-101');
      expect(res.internalMeetingID).toBe('int-meeting-101');
    });

    it('join() forces redirect=false and returns join tokens', async () => {
      const mockXml = `
        <response>
          <returncode>SUCCESS</returncode>
          <meeting_id>meeting-101</meeting_id>
          <user_id>w_user1</user_id>
          <auth_token>token_auth_123</auth_token>
          <session_token>token_session_123</session_token>
          <url>https://localhost/html5client/?sessionToken=token_session_123</url>
        </response>
      `;

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(mockXml, { status: 200 })
      );

      const client = new BbbApiClient(config);
      const res = await client.join({
        fullName: 'Bot User',
        meetingID: 'meeting-101',
        password: 'mp123',
      });

      expect(fetchSpy).toHaveBeenCalledOnce();
      const calledUrl = new URL(fetchSpy.mock.calls[0][0] as string);
      expect(calledUrl.searchParams.get('redirect')).toBe('false');

      expect(res.returncode).toBe('SUCCESS');
      expect(res.session_token).toBe('token_session_123');
      expect(res.auth_token).toBe('token_auth_123');
      expect(res.user_id).toBe('w_user1');
    });

    it('end() calls /end and parses response', async () => {
      const mockXml = `
        <response>
          <returncode>SUCCESS</returncode>
          <messageKey>meetingEnded</messageKey>
          <message>Meeting ended</message>
        </response>
      `;

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(mockXml, { status: 200 })
      );

      const client = new BbbApiClient(config);
      const res = await client.end({
        meetingID: 'meeting-101',
        password: 'mp123',
      });

      expect(res.returncode).toBe('SUCCESS');
      expect(res.messageKey).toBe('meetingEnded');
    });

    it('isMeetingRunning() returns boolean status', async () => {
      const mockXml = `
        <response>
          <returncode>SUCCESS</returncode>
          <running>true</running>
        </response>
      `;

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(mockXml, { status: 200 })
      );

      const client = new BbbApiClient(config);
      const res = await client.isMeetingRunning({ meetingID: 'meeting-101' });

      expect(res.returncode).toBe('SUCCESS');
      expect(res.running).toBe(true);
    });

    it('getMeetings() parses array of active meetings', async () => {
      const mockXml = `
        <response>
          <returncode>SUCCESS</returncode>
          <meetings>
            <meeting>
              <meetingID>m1</meetingID>
              <running>true</running>
            </meeting>
            <meeting>
              <meetingID>m2</meetingID>
              <running>false</running>
            </meeting>
          </meetings>
        </response>
      `;

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(mockXml, { status: 200 })
      );

      const client = new BbbApiClient(config);
      const res = await client.getMeetings();

      expect(res.returncode).toBe('SUCCESS');
      expect(res.meetings.length).toBe(2);
      expect(res.meetings[0].meetingID).toBe('m1');
      expect(res.meetings[1].meetingID).toBe('m2');
    });
  });

  describe('Checksum Algorithm Negotiation', () => {
    const config = {
      url: 'https://localhost/bigbluebutton/api',
      secret: 'secret123',
      iUnderstand: true,
      hashAlgorithm: 'sha256' as const,
    };

    it('falls back from sha256 to sha1 on checksumError and updates active algorithm', async () => {
      const checksumErrorXml = `
        <response>
          <returncode>FAILED</returncode>
          <messageKey>checksumError</messageKey>
          <message>You did not pass the checksum security check</message>
        </response>
      `;

      const successXml = `
        <response>
          <returncode>SUCCESS</returncode>
          <running>true</running>
        </response>
      `;

      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response(checksumErrorXml, { status: 200 }))
        .mockResolvedValueOnce(new Response(successXml, { status: 200 }));

      const client = new BbbApiClient(config);
      expect(client.getActiveHashAlgorithm()).toBe('sha256');

      const res = await client.isMeetingRunning({ meetingID: 'demo' });

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(res.returncode).toBe('SUCCESS');
      expect(client.getActiveHashAlgorithm()).toBe('sha1');
    });
  });

  describe('Error Mapping', () => {
    const config = {
      url: 'https://localhost/bigbluebutton/api',
      secret: 'secret123',
      iUnderstand: true,
    };

    it('maps HTTP 429 / 503 to RateLimitedError', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('Too Many Requests', { status: 429 })
      );

      const client = new BbbApiClient(config);
      await expect(client.getMeetings()).rejects.toThrowError(RateLimitedError);
    });

    it('maps checksum failure XML to AuthFailedError', async () => {
      const checksumErrorXml = `
        <response>
          <returncode>FAILED</returncode>
          <messageKey>checksumError</messageKey>
          <message>You did not pass the checksum security check</message>
        </response>
      `;

      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(checksumErrorXml, { status: 200 })
      );

      const client = new BbbApiClient(config);
      await expect(client.getMeetings()).rejects.toThrowError(AuthFailedError);
    });

    it('maps aborted request to TimeoutError', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementationOnce(
        (_url, init) =>
          new Promise((_, reject) => {
            const signal = init?.signal as AbortSignal;
            if (signal) {
              signal.addEventListener('abort', () => {
                reject(new TimeoutError('Request timed out after 50ms'));
              });
            }
          })
      );

      const client = new BbbApiClient(config);
      await expect(
        client.getMeetings({ timeoutMs: 10 })
      ).rejects.toThrowError(TimeoutError);
    });
  });
});
