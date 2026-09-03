import type { BbbApiClient } from '@bbb-siege/api-client';
import type { BbbAdapter, JoinContext, SignalingSession, SubscriptionSpec } from '@bbb-siege/protocol';
import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { MediaBot } from './index.js';

const silent = pino({ level: 'silent' });

const context: JoinContext = {
  meetingId: 'm1',
  userId: 'u1',
  sessionToken: 'tok',
  authToken: 'auth',
  clientSessionUUID: 'uuid',
  graphqlWebsocketUrl: 'ws://unused',
  joinUrl: 'https://example.test',
};

function fakeSession(userCurrent: unknown): SignalingSession {
  let resolveClosed!: () => void;
  const closed = new Promise<void>((r) => {
    resolveClosed = r;
  });
  return {
    closed,
    async *subscribe(spec: SubscriptionSpec): AsyncGenerator<unknown> {
      if (spec.operationName === 'Patched_userCurrentSubscription') yield { user_current: [userCurrent] };
    },
    mutate: vi.fn(async () => ({ userJoinMeeting: true })),
    async close(): Promise<void> {
      resolveClosed();
    },
  };
}

function fakeAdapter(session: SignalingSession): BbbAdapter {
  return {
    detectVersion: vi.fn(),
    detectMediaStack: vi.fn(),
    createMeeting: vi.fn(),
    join: vi.fn(async () => context),
    openSignaling: vi.fn(async () => session),
    leave: vi.fn(async (_c: JoinContext, s: SignalingSession) => s.close()),
  } as unknown as BbbAdapter;
}

const client = {} as BbbApiClient;
const join = { fullName: 'media-bot', meetingID: 'm1', password: 'mp' };

describe('MediaBot.detect', () => {
  it('detects LiveKit when a livekitToken is present', async () => {
    const bot = new MediaBot({ adapter: fakeAdapter(fakeSession({ livekit: { livekitToken: 'jwt-abc' } })), client, join, logger: silent });
    const result = await bot.detect();
    expect(result.stack).toBe('livekit');
    expect(result.livekitTokenPresent).toBe(true);
    expect(result.livekitToken).toBe('jwt-abc');
  });

  it('infers mediasoup when the record has no livekit token', async () => {
    const bot = new MediaBot({ adapter: fakeAdapter(fakeSession({ livekit: { livekitToken: null }, name: 'x' })), client, join, logger: silent });
    const result = await bot.detect();
    expect(result.stack).toBe('mediasoup');
    expect(result.livekitTokenPresent).toBe(false);
  });
});
