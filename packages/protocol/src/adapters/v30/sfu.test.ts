import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { AuthFailedError, RateLimitedError, ServerError, TimeoutError } from '@bbb-siege/api-client';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket as WsSocket } from 'ws';
import type { JoinContext } from '../../types.js';
import { cameraStreamId, fetchV30IceServers, openV30Sfu, parseIceServers, sfuUrl, type SfuMessage } from './sfu.js';

interface FlowStep {
  direction: 'client->server' | 'server->client';
  message: SfuMessage;
}

interface SfuFixture {
  stuns: { response: unknown };
  flows: Record<'fullAudio' | 'listenOnly' | 'cameraShare' | 'cameraView' | 'cameraStop', { messages: FlowStep[] }>;
}

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../fixtures/v30/sfu-signaling.json', import.meta.url)), 'utf8')
) as SfuFixture;

const SDP_FIELDS = ['sdpOffer', 'sdpAnswer', 'answer'];
const COOKIE = 'JSESSIONID=abc123';

function withoutSdp(message: SfuMessage): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(message).map(([k, v]) => [k, SDP_FIELDS.includes(k) && typeof v === 'string' ? '<sdp>' : v])
  );
}

function clientMessages(flow: keyof SfuFixture['flows']): SfuMessage[] {
  return fixture.flows[flow].messages.filter((s) => s.direction === 'client->server').map((s) => s.message);
}

function serverMessages(flow: keyof SfuFixture['flows']): SfuMessage[] {
  return fixture.flows[flow].messages.filter((s) => s.direction === 'server->client').map((s) => s.message);
}

function replayTable(flow: keyof SfuFixture['flows']): Map<string, SfuMessage[]> {
  const table = new Map<string, SfuMessage[]>();
  let key: string | undefined;
  for (const step of fixture.flows[flow].messages) {
    if (step.direction === 'client->server') {
      key = step.message.id;
      table.set(key, []);
    } else if (key) {
      table.get(key)!.push(step.message);
    }
  }
  return table;
}

type Handler = (message: SfuMessage, reply: (m: unknown) => void, socket: WsSocket) => void;

interface MockSfu {
  wsUrl: string;
  received: SfuMessage[];
  requests: IncomingMessage[];
  close(): Promise<void>;
}

function startMockSfu(handler: Handler, opts: { status?: number } = {}): Promise<MockSfu> {
  return new Promise((resolve) => {
    const received: SfuMessage[] = [];
    const requests: IncomingMessage[] = [];
    const wss = new WebSocketServer({
      port: 0,
      host: '127.0.0.1',
      verifyClient: (info, done) => {
        requests.push(info.req);
        if (opts.status) return done(false, opts.status);
        done(info.req.headers.cookie === COOKIE, 401);
      },
    });
    wss.on('connection', (socket: WsSocket) => {
      socket.on('message', (raw) => {
        const message = JSON.parse(raw.toString()) as SfuMessage;
        received.push(message);
        if (message.id === 'ping') return socket.send(JSON.stringify({ id: 'pong' }));
        handler(message, (m) => socket.send(JSON.stringify(m)), socket);
      });
    });
    wss.on('listening', () => {
      const { port } = wss.address() as AddressInfo;
      resolve({
        wsUrl: `ws://127.0.0.1:${port}/graphql`,
        received,
        requests,
        close: () =>
          new Promise<void>((r) => {
            for (const client of wss.clients) client.terminate();
            wss.close(() => r());
          }),
      });
    });
  });
}

function replay(flow: keyof SfuFixture['flows']): Handler {
  const table = replayTable(flow);
  return (message, reply) => {
    for (const response of table.get(message.id) ?? []) reply(response);
  };
}

function context(graphqlWebsocketUrl: string, cookie: string | null = COOKIE): JoinContext {
  return {
    meetingId: 'meeting-1',
    userId: 'w_abc123',
    sessionToken: 'session-token-1',
    authToken: 'auth-1',
    clientSessionUUID: 'be7a2c89-a2c1-461e-866f-0eb5f1562c2a',
    graphqlWebsocketUrl,
    joinUrl: 'https://example.test/html5client',
    sessionCookie: cookie ?? undefined,
  };
}

let mock: MockSfu | undefined;

afterEach(async () => {
  await mock?.close();
  mock = undefined;
});

describe('v30 SFU addressing', () => {
  it('derives the SFU socket URL from the GraphQL host and appends the session token', () => {
    expect(sfuUrl(context('wss://bbb.example.com/graphql'))).toBe(
      'wss://bbb.example.com/bbb-webrtc-sfu?sessionToken=session-token-1'
    );
  });

  it('builds camera ids in the recorded <userId>_<clientSessionUUID>_<deviceId> shape', () => {
    const shape = /^w_[a-z0-9]+_[0-9a-f-]{36}_[0-9a-f]{64}$/;
    const recorded = String(clientMessages('cameraShare')[0].cameraId);
    expect(recorded).toMatch(shape);
    expect(cameraStreamId(context('wss://x/graphql'), 'f'.repeat(64))).toMatch(shape);
  });

  it('maps the recorded stuns response to RTCPeerConnection ice servers', () => {
    const servers = parseIceServers(fixture.stuns.response);
    expect(servers[0]).toEqual({ urls: 'stun:coturn.example.com' });
    expect(servers.slice(1).map((s) => s.urls)).toEqual([
      'turn:coturn.example.com:5349?transport=tcp',
      'turns:coturn.example.com:5349?transport=tcp',
    ]);
    expect(servers[1].username).toMatch(/:w_/);
    expect(servers[1].credential).toBeDefined();
  });
});

describe('fetchV30IceServers', () => {
  async function withHttp(status: number, body: unknown, fn: (url: string, seen: IncomingMessage[]) => Promise<void>) {
    const seen: IncomingMessage[] = [];
    const server = createServer((req, res) => {
      seen.push(req);
      res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address() as AddressInfo;
    try {
      await fn(`ws://127.0.0.1:${port}/graphql`, seen);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  }

  it('requests /bigbluebutton/api/stuns with the session token and cookie', async () => {
    await withHttp(200, fixture.stuns.response, async (url, seen) => {
      const servers = await fetchV30IceServers(context(url));
      expect(servers).toHaveLength(3);
      expect(seen[0].url).toBe('/bigbluebutton/api/stuns?sessionToken=session-token-1');
      expect(seen[0].headers.cookie).toBe(COOKIE);
    });
  });

  it('classifies 401 as AuthFailed', async () => {
    await withHttp(401, {}, async (url) => {
      await expect(fetchV30IceServers(context(url))).rejects.toBeInstanceOf(AuthFailedError);
    });
  });
});

describe('openV30Sfu', () => {
  it('replays the JSESSIONID cookie and session token on the upgrade', async () => {
    mock = await startMockSfu(() => undefined);
    const sfu = await openV30Sfu(context(mock.wsUrl));
    expect(mock.requests[0].url).toBe('/bbb-webrtc-sfu?sessionToken=session-token-1');
    expect(mock.requests[0].headers.cookie).toBe(COOKIE);
    await sfu.close();
  });

  it('fails with AuthFailed when the upgrade is refused with 401 (no cookie)', async () => {
    mock = await startMockSfu(() => undefined);
    await expect(openV30Sfu(context(mock.wsUrl, null))).rejects.toBeInstanceOf(AuthFailedError);
  });

  it('classifies 429 on the upgrade as RateLimited', async () => {
    mock = await startMockSfu(() => undefined, { status: 429 });
    await expect(openV30Sfu(context(mock.wsUrl))).rejects.toBeInstanceOf(RateLimitedError);
  });

  it('sends application-level pings', async () => {
    mock = await startMockSfu(() => undefined);
    const sfu = await openV30Sfu(context(mock.wsUrl), { heartbeatMs: 20 });
    await new Promise((r) => setTimeout(r, 80));
    await sfu.close();
    expect(mock.received.some((m) => m.id === 'ping')).toBe(true);
  });
});

describe('SFU audio flow (server offers)', () => {
  it.each([
    ['fullAudio', false],
    ['listenOnly', true],
  ] as const)('%s matches the recorded browser exchange', async (flow, listenOnly) => {
    mock = await startMockSfu(replay(flow));
    const sfu = await openV30Sfu(context(mock.wsUrl));
    const [serverOffer] = serverMessages(flow);
    let offered: string | undefined;

    await sfu.startAudio({
      listenOnly,
      answer: async (offer) => {
        offered = offer;
        return 'v=0\r\nclient-answer';
      },
    });
    await sfu.close();

    expect(offered).toBe(serverOffer.sdpAnswer);
    const sent = mock.received.filter((m) => m.id !== 'ping');
    expect(sent.map(withoutSdp)).toEqual(clientMessages(flow).map(withoutSdp));
    expect(sent[1].sdpOffer).toBe('v=0\r\nclient-answer');
  });

  it('rejects with ServerError when the SFU does not accept', async () => {
    mock = await startMockSfu((m, reply) => {
      if (m.id === 'start') reply({ type: 'audio', id: 'startResponse', response: 'rejected' });
    });
    const sfu = await openV30Sfu(context(mock.wsUrl));
    await expect(sfu.startAudio({ answer: async () => 'x' })).rejects.toBeInstanceOf(ServerError);
    await sfu.close();
  });

  it('times out with the unhandled message ids when media never flows', async () => {
    mock = await startMockSfu((m, reply) => {
      if (m.id === 'start') reply({ type: 'audio', id: 'somethingUnexpected' });
    });
    const sfu = await openV30Sfu(context(mock.wsUrl));
    const failure = sfu.startAudio({ answer: async () => 'x', timeoutMs: 100 });
    await expect(failure).rejects.toBeInstanceOf(TimeoutError);
    await expect(failure).rejects.toThrow(/somethingUnexpected/);
    await sfu.close();
  });

  it('rejects in-flight flows with ServerError when the socket drops', async () => {
    mock = await startMockSfu((m, _reply, socket) => {
      if (m.id === 'start') socket.close(1011, 'boom');
    });
    const sfu = await openV30Sfu(context(mock.wsUrl));
    await expect(sfu.startAudio({ answer: async () => 'x' })).rejects.toBeInstanceOf(ServerError);
    await sfu.closed;
  });
});

describe('SFU camera flows', () => {
  const cameraId = String(clientMessages('cameraShare')[0].cameraId);

  it('share (client offers) matches the recorded exchange and resolves on playStart', async () => {
    mock = await startMockSfu(replay('cameraShare'));
    const sfu = await openV30Sfu(context(mock.wsUrl));
    let applied: string | undefined;

    await sfu.startCameraShare({
      cameraId,
      offerSdp: 'v=0\r\nclient-offer',
      applyAnswer: async (answer) => {
        await new Promise((r) => setTimeout(r, 20));
        applied = answer;
      },
    });

    expect(applied).toBe(serverMessages('cameraShare')[0].sdpAnswer);
    const sent = mock.received.filter((m) => m.id !== 'ping');
    expect(sent.map(withoutSdp)).toEqual(clientMessages('cameraShare').map(withoutSdp));
    expect(sent[0].sdpOffer).toBe('v=0\r\nclient-offer');

    sfu.stopCamera(cameraId, 'share');
    await new Promise((r) => setTimeout(r, 30));
    expect(mock.received.at(-1)).toEqual(clientMessages('cameraStop').find((m) => m.role === 'share'));
    await sfu.close();
  });

  it('view (server offers) matches the recorded exchange and resolves on playStart', async () => {
    mock = await startMockSfu(replay('cameraView'));
    const sfu = await openV30Sfu(context(mock.wsUrl));
    let offered: string | undefined;

    await sfu.startCameraView({
      cameraId,
      answer: async (offer) => {
        offered = offer;
        return 'v=0\r\nviewer-answer';
      },
    });

    expect(offered).toBe(serverMessages('cameraView')[0].sdpAnswer);
    const sent = mock.received.filter((m) => m.id !== 'ping');
    expect(sent.map(withoutSdp)).toEqual(clientMessages('cameraView').map(withoutSdp));
    expect(sent[1].answer).toBe('v=0\r\nviewer-answer');

    sfu.stopCamera(cameraId, 'viewer');
    await new Promise((r) => setTimeout(r, 30));
    expect(mock.received.at(-1)).toEqual(clientMessages('cameraStop').find((m) => m.role === 'viewer'));
    await sfu.close();
  });

  it('ignores messages for other cameras', async () => {
    mock = await startMockSfu((m, reply) => {
      if (m.id !== 'start') return;
      reply({ type: 'video', role: 'viewer', id: 'startResponse', cameraId: 'someone-else', sdpAnswer: 'other' });
    });
    const sfu = await openV30Sfu(context(mock.wsUrl));
    await expect(
      sfu.startCameraView({ cameraId, answer: async () => 'x', timeoutMs: 100 })
    ).rejects.toBeInstanceOf(TimeoutError);
    await sfu.close();
  });
});
