import { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket as WsSocket } from 'ws';
import type { JoinContext } from '../../types.js';
import { openV30Signaling } from './signaling.js';

interface MockServer {
  url: string;
  lastInitPayload: Promise<unknown>;
  close(): Promise<void>;
}

function startMockGraphqlWs(opts: { rejectMissingToken?: boolean } = {}): Promise<MockServer> {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    let resolveInit!: (payload: unknown) => void;
    const lastInitPayload = new Promise<unknown>((r) => {
      resolveInit = r;
    });

    wss.on('connection', (socket: WsSocket) => {
      socket.on('message', (raw) => {
        const msg = JSON.parse(raw.toString()) as {
          type: string;
          id?: string;
          payload?: { headers?: Record<string, string> };
        };

        if (msg.type === 'connection_init') {
          resolveInit(msg.payload);
          const token = msg.payload?.headers?.['X-Session-Token'];
          if (opts.rejectMissingToken && !token) {
            socket.close(4403, 'X-Session-Token header missing on init connection');
            return;
          }
          socket.send(JSON.stringify({ type: 'connection_ack' }));
          return;
        }

        if (msg.type === 'subscribe') {
          socket.send(
            JSON.stringify({ id: msg.id, type: 'next', payload: { data: { ok: true } } })
          );
          socket.send(JSON.stringify({ id: msg.id, type: 'complete' }));
        }
      });
    });

    wss.on('listening', () => {
      const { port } = wss.address() as AddressInfo;
      resolve({
        url: `ws://127.0.0.1:${port}`,
        lastInitPayload,
        close: () => new Promise<void>((r) => wss.close(() => r())),
      });
    });
  });
}

function fakeContext(url: string, token = 'session-token-abc'): JoinContext {
  return {
    meetingId: 'meeting-1',
    userId: 'user-1',
    sessionToken: token,
    authToken: 'auth-1',
    clientSessionUUID: 'uuid-1',
    graphqlWebsocketUrl: url,
    joinUrl: 'https://example.test/html5client',
  };
}

let mock: MockServer | undefined;

afterEach(async () => {
  await mock?.close();
  mock = undefined;
});

describe('openV30Signaling', () => {
  it('sends connection_init with mandatory headers and resolves on ack', async () => {
    mock = await startMockGraphqlWs();
    const session = await openV30Signaling(fakeContext(mock.url), { isMobile: false });

    const initPayload = (await mock.lastInitPayload) as { headers: Record<string, string> };
    expect(initPayload.headers['X-Session-Token']).toBe('session-token-abc');
    expect(initPayload.headers['X-ClientType']).toBe('HTML5');
    expect(initPayload.headers['X-ClientIsMobile']).toBe('false');
    expect(initPayload.headers['X-ClientSessionUUID']).toBe('uuid-1');

    await session.close();
  });

  it('runs a mutation and returns the payload data', async () => {
    mock = await startMockGraphqlWs();
    const session = await openV30Signaling(fakeContext(mock.url));

    const result = await session.mutate({ operationName: 'DoThing', query: 'mutation DoThing { ok }' });
    expect(result).toEqual({ ok: true });

    await session.close();
  });

  it('yields subscription data', async () => {
    mock = await startMockGraphqlWs();
    const session = await openV30Signaling(fakeContext(mock.url));

    const received: unknown[] = [];
    for await (const event of session.subscribe({ operationName: 'Sub', query: 'subscription Sub { ok }' })) {
      received.push(event);
    }
    expect(received).toEqual([{ ok: true }]);

    await session.close();
  });

  it('rejects with AuthFailed when middleware closes with 4403', async () => {
    mock = await startMockGraphqlWs({ rejectMissingToken: true });
    await expect(
      openV30Signaling(fakeContext(mock.url, ''), { connectTimeoutMs: 3000 })
    ).rejects.toThrow(/4403/);
  });
});
