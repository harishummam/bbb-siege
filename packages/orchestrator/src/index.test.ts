import type { BbbApiClient } from '@bbb-siege/api-client';
import type { BbbAdapter, JoinContext, SignalingSession, SubscriptionSpec } from '@bbb-siege/protocol';
import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { parseScenario, percentiles, runFleet, runScenario } from './index.js';

const silent = pino({ level: 'silent' });

function fakeSession(): SignalingSession {
  let resolveClosed!: () => void;
  const closed = new Promise<void>((r) => {
    resolveClosed = r;
  });
  return {
    closed,
    async *subscribe(spec: SubscriptionSpec): AsyncGenerator<unknown> {
      yield { op: spec.operationName };
    },
    mutate: vi.fn(async () => ({ userJoinMeeting: true })),
    async close(): Promise<void> {
      resolveClosed();
    },
  };
}

function fakeAdapter(): BbbAdapter {
  return {
    detectVersion: vi.fn(),
    detectMediaStack: vi.fn(),
    createMeeting: vi.fn(),
    join: vi.fn(
      async (_client, options: { meetingID: string; fullName: string }): Promise<JoinContext> => ({
        meetingId: options.meetingID,
        userId: `u-${options.fullName}`,
        sessionToken: 'tok',
        authToken: 'auth',
        clientSessionUUID: 'uuid',
        graphqlWebsocketUrl: 'ws://unused',
        joinUrl: 'https://example.test',
      })
    ),
    openSignaling: vi.fn(async () => fakeSession()),
    leave: vi.fn(async (_ctx: JoinContext, s: SignalingSession) => {
      await s.close();
    }),
  } as unknown as BbbAdapter;
}

function fakeClient(): BbbApiClient & { createCalls: string[]; endCalls: string[] } {
  const createCalls: string[] = [];
  const endCalls: string[] = [];
  return {
    createCalls,
    endCalls,
    create: vi.fn(async (opts: { meetingID: string }) => {
      createCalls.push(opts.meetingID);
      return { returncode: 'SUCCESS', meetingID: opts.meetingID };
    }),
    end: vi.fn(async (opts: { meetingID: string }) => {
      endCalls.push(opts.meetingID);
      return { returncode: 'SUCCESS' };
    }),
  } as unknown as BbbApiClient & { createCalls: string[]; endCalls: string[] };
}

describe('percentiles', () => {
  it('computes nearest-rank percentiles', () => {
    const p = percentiles([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    expect(p.count).toBe(10);
    expect(p.min).toBe(10);
    expect(p.max).toBe(100);
    expect(p.p50).toBe(50);
    expect(p.p95).toBe(100);
  });

  it('returns zeros for empty input', () => {
    expect(percentiles([])).toEqual({ count: 0, min: 0, p50: 0, p95: 0, p99: 0, max: 0 });
  });
});

describe('runFleet', () => {
  it('creates meetings, runs all bots, aggregates timings, and ends every meeting', async () => {
    const client = fakeClient();
    const report = await runFleet({
      adapter: fakeAdapter(),
      client,
      botCount: 6,
      meetingCount: 2,
      holdMs: 10,
      startStaggerMs: 0,
      logger: silent,
    });

    expect(report.total).toBe(6);
    expect(report.completed).toBe(6);
    expect(report.failed).toBe(0);
    expect(report.meetingsCreated).toHaveLength(2);
    expect(report.meetingsEnded).toHaveLength(2);
    expect(client.endCalls.sort()).toEqual([...report.meetingsCreated].sort());
    expect(report.timings.apiJoin.count).toBe(6);
  });

  it('runs a scenario ramp: launches peak bots and ends every meeting', async () => {
    const client = fakeClient();
    const scenario = parseScenario(
      `name: t\ntarget: { url: u, secret: s }\nmeeting: { count: 2 }\nramp:\n  - { at: 0s, users: 4 }\n  - { hold: 20ms }`,
      {} as NodeJS.ProcessEnv
    );
    const report = await runScenario({ adapter: fakeAdapter(), client, scenario, logger: silent });

    expect(report.scenarioName).toBe('t');
    expect(report.peakUsers).toBe(4);
    expect(report.completed).toBe(4);
    expect(report.meetingsCreated).toHaveLength(2);
    expect(report.meetingsEnded).toEqual(report.meetingsCreated);
  });

  it('drives the metrics recorder for started/stopped/phase/outcome', async () => {
    const client = fakeClient();
    const events: string[] = [];
    const recorder = {
      botStarted: () => events.push('start'),
      botStopped: () => events.push('stop'),
      recordJoinPhase: (phase: string) => events.push(`phase:${phase}`),
      recordOutcome: (o: { status: string }) => events.push(`outcome:${o.status}`),
    };
    await runFleet({
      adapter: fakeAdapter(),
      client,
      botCount: 2,
      meetingCount: 1,
      holdMs: 10,
      startStaggerMs: 0,
      metrics: recorder,
      logger: silent,
    });
    expect(events.filter((e) => e === 'start')).toHaveLength(2);
    expect(events.filter((e) => e === 'stop')).toHaveLength(2);
    expect(events.filter((e) => e === 'outcome:completed')).toHaveLength(2);
    expect(events).toContain('phase:api_join');
    expect(events).toContain('phase:ws_connect');
  });

  it('ends created meetings even when aborted mid-run', async () => {
    const client = fakeClient();
    const controller = new AbortController();
    const runPromise = runFleet(
      {
        adapter: fakeAdapter(),
        client,
        botCount: 20,
        meetingCount: 1,
        holdMs: 60_000,
        startStaggerMs: 5,
        logger: silent,
      },
      controller.signal
    );
    setTimeout(() => controller.abort(), 20);
    const report = await runPromise;

    expect(report.meetingsCreated).toHaveLength(1);
    expect(report.meetingsEnded).toEqual(report.meetingsCreated);
  });
});
