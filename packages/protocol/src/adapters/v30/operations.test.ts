import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket as WsSocket } from 'ws';
import type { JoinContext } from '../../types.js';
import { openV30Signaling } from './signaling.js';
import {
  chatSubscription,
  coreSubscriptions,
  meetingSubscription,
  raisedHandUsersSubscription,
  userCurrentSubscription,
  userJoinMutation,
  usersCountSubscription,
  videoStreamsSubscription,
} from './operations.js';

interface Fixture {
  subscriptions: { opName: string; payload: { id: string } }[];
  dataResponses: { payload: { id: string; payload: { data: Record<string, unknown> } } }[];
}

function loadRecordedData(): Map<string, Record<string, unknown>> {
  const path = fileURLToPath(new URL('../../../fixtures/v30/graphql-subscriptions.json', import.meta.url));
  const fixture = JSON.parse(readFileSync(path, 'utf8')) as Fixture;
  const idToName = new Map<string, string>();
  for (const sub of fixture.subscriptions) {
    if (sub.payload?.id) idToName.set(sub.payload.id, sub.opName);
  }
  const byName = new Map<string, Record<string, unknown>>();
  for (const res of fixture.dataResponses) {
    const name = idToName.get(res.payload?.id);
    if (name && !byName.has(name)) byName.set(name, res.payload.payload.data);
  }
  return byName;
}

const recorded = loadRecordedData();

interface MockServer {
  url: string;
  close(): Promise<void>;
}

function startReplayServer(): Promise<MockServer> {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    wss.on('connection', (socket: WsSocket) => {
      socket.on('message', (raw) => {
        const msg = JSON.parse(raw.toString()) as {
          type: string;
          id?: string;
          payload?: { operationName?: string };
        };
        if (msg.type === 'connection_init') {
          socket.send(JSON.stringify({ type: 'connection_ack' }));
          return;
        }
        if (msg.type === 'subscribe') {
          const data = recorded.get(msg.payload?.operationName ?? '');
          if (data) {
            socket.send(JSON.stringify({ id: msg.id, type: 'next', payload: { data } }));
          }
          socket.send(JSON.stringify({ id: msg.id, type: 'complete' }));
        }
      });
    });
    wss.on('listening', () => {
      const { port } = wss.address() as AddressInfo;
      resolve({ url: `ws://127.0.0.1:${port}`, close: () => new Promise((r) => wss.close(() => r())) });
    });
  });
}

function fakeContext(url: string): JoinContext {
  return {
    meetingId: 'm1',
    userId: 'u1',
    sessionToken: 'tok',
    authToken: 'auth',
    clientSessionUUID: 'uuid',
    graphqlWebsocketUrl: url,
    joinUrl: 'https://example.test',
  };
}

let mock: MockServer | undefined;

afterEach(async () => {
  await mock?.close();
  mock = undefined;
});

describe('v30 operations', () => {
  it('userJoinMutation carries auth token and returns the recorded result', async () => {
    const spec = userJoinMutation('auth-abc');
    expect(spec.operationName).toBe('UserJoin');
    expect(spec.variables).toMatchObject({ authToken: 'auth-abc', clientType: 'HTML5', clientIsMobile: false });

    mock = await startReplayServer();
    const session = await openV30Signaling(fakeContext(mock.url));
    const result = (await session.mutate(spec)) as { userJoinMeeting?: boolean };
    expect(result.userJoinMeeting).toBe(true);
    await session.close();
  });

  it('coreSubscriptions cover the seven signaling subscriptions', () => {
    expect(coreSubscriptions().map((s) => s.operationName)).toEqual([
      'Patched_userCurrentSubscription',
      'Patched_MeetingSubscription',
      'Patched_UserListSubscription',
      'ChatSubscription',
      'UsersCount',
      'Patched_VideoStreams',
      'RaisedHandUsers',
    ]);
  });

  it.each([
    [userCurrentSubscription(), 'user_current'],
    [meetingSubscription(), 'meeting'],
    [chatSubscription(), 'chat'],
    [usersCountSubscription(), 'user_aggregate'],
    [videoStreamsSubscription(), 'user_camera'],
    [raisedHandUsersSubscription(), 'user'],
  ])('delivers recorded data for %o', async (spec, expectedKey) => {
    mock = await startReplayServer();
    const session = await openV30Signaling(fakeContext(mock.url));

    let received: Record<string, unknown> | undefined;
    for await (const event of session.subscribe(spec)) {
      received = event as Record<string, unknown>;
      break;
    }
    expect(received).toBeDefined();
    expect(received).toHaveProperty(expectedKey);

    await session.close();
  });
});
