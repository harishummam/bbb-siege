import type { BbbApiClient } from '@bbb-siege/api-client';
import { AuthFailedError } from '@bbb-siege/api-client';
import type {
  BbbAdapter,
  JoinContext,
  MutationSpec,
  SignalingSession,
  SubscriptionSpec,
} from '@bbb-siege/protocol';
import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { SignalingBot } from './index.js';

const silentLogger = pino({ level: 'silent' });

const context: JoinContext = {
  meetingId: 'm1',
  userId: 'u1',
  sessionToken: 'tok',
  authToken: 'auth-xyz',
  clientSessionUUID: 'uuid',
  graphqlWebsocketUrl: 'ws://unused',
  joinUrl: 'https://example.test',
};

function fakeSession(overrides: Partial<SignalingSession> = {}): SignalingSession & {
  closeCalls: number;
} {
  let resolveClosed!: () => void;
  const closed = new Promise<void>((r) => {
    resolveClosed = r;
  });
  const session = {
    closeCalls: 0,
    closed,
    async *subscribe(spec: SubscriptionSpec): AsyncGenerator<unknown> {
      yield { op: spec.operationName, count: 1 };
    },
    mutate: vi.fn(async () => ({ userJoinMeeting: true })),
    async close(): Promise<void> {
      session.closeCalls += 1;
      resolveClosed();
    },
    ...overrides,
  };
  return session;
}

function fakeAdapter(session: SignalingSession, joinError?: Error): BbbAdapter {
  return {
    detectVersion: vi.fn(),
    detectMediaStack: vi.fn(),
    createMeeting: vi.fn(),
    join: vi.fn(async () => {
      if (joinError) throw joinError;
      return context;
    }),
    openSignaling: vi.fn(async () => session),
    leave: vi.fn(async (_ctx: JoinContext, s: SignalingSession) => {
      await s.close();
    }),
  } as unknown as BbbAdapter;
}

const client = {} as BbbApiClient;
const joinOptions = { fullName: 'Bot 1', meetingID: 'm1', password: 'mp' };

describe('SignalingBot', () => {
  it('joins, sends UserJoin, folds subscription data, and leaves cleanly', async () => {
    const session = fakeSession();
    const adapter = fakeAdapter(session);
    const bot = new SignalingBot({
      adapter,
      client,
      join: joinOptions,
      logger: silentLogger,
      holdMs: 20,
    });

    const outcome = await bot.run();

    expect(outcome.status).toBe('completed');
    const mutateArg = (session.mutate as ReturnType<typeof vi.fn>).mock.calls[0][0] as MutationSpec;
    expect(mutateArg.operationName).toBe('UserJoin');
    expect(mutateArg.variables).toMatchObject({ authToken: 'auth-xyz' });
    if (outcome.status === 'completed') {
      expect(outcome.state.get('Patched_userCurrentSubscription')).toBeDefined();
      expect(outcome.timings.apiJoinMs).toBeGreaterThanOrEqual(0);
      expect(outcome.timings.wsConnectMs).toBeGreaterThanOrEqual(0);
    }
    expect(session.closeCalls).toBe(1);
  });

  it('sends chat and raise-hand behaviour mutations during hold', async () => {
    const session = fakeSession();
    const adapter = fakeAdapter(session);
    const bot = new SignalingBot({
      adapter,
      client,
      join: joinOptions,
      logger: silentLogger,
      holdMs: 1200,
      chatMessagesPerMinute: 120,
      raiseHandProbability: 1,
    });

    const outcome = await bot.run();
    expect(outcome.status).toBe('completed');

    const ops = (session.mutate as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => (c[0] as MutationSpec).operationName
    );
    expect(ops).toContain('ChatSendMessage');
    expect(ops.filter((o) => o === 'SetRaiseHand').length).toBeGreaterThanOrEqual(1);
  });

  it('classifies a join failure and never opens signaling', async () => {
    const session = fakeSession();
    const adapter = fakeAdapter(session, new AuthFailedError('bad checksum'));
    const bot = new SignalingBot({ adapter, client, join: joinOptions, logger: silentLogger });

    const outcome = await bot.run();

    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') expect(outcome.kind).toBe('AuthFailed');
    expect(adapter.openSignaling).not.toHaveBeenCalled();
    expect(session.closeCalls).toBe(0);
  });

  it('leaves when the external signal aborts during hold', async () => {
    const session = fakeSession();
    const adapter = fakeAdapter(session);
    const controller = new AbortController();
    const bot = new SignalingBot({
      adapter,
      client,
      join: joinOptions,
      logger: silentLogger,
      holdMs: 60_000,
    });

    const runPromise = bot.run(controller.signal);
    setTimeout(() => controller.abort(), 20);
    const outcome = await runPromise;

    expect(outcome.status).toBe('completed');
    expect(session.closeCalls).toBe(1);
  });
});
