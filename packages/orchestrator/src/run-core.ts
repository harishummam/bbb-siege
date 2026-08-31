import type { BbbApiClient, BbbErrorKind } from '@bbb-siege/api-client';
import type { BbbAdapter } from '@bbb-siege/protocol';
import { SignalingBot, type PhaseTimings } from '@bbb-siege/bot-headless';
import type { Logger } from 'pino';
import { percentiles, type Percentiles } from './percentiles.js';

export interface FleetReport {
  total: number;
  completed: number;
  failed: number;
  skipped: number;
  byKind: Partial<Record<BbbErrorKind, number>>;
  timings: {
    apiJoin: Percentiles;
    wsConnect: Percentiles;
    userJoin: Percentiles;
    firstSubscriptionData: Percentiles;
  };
  meetingsCreated: string[];
  meetingsEnded: string[];
  wallClockMs: number;
}

export type BotOutcome =
  | { status: 'completed'; timings: PhaseTimings }
  | { status: 'failed'; kind: BbbErrorKind }
  | { status: 'skipped' };

export type JoinPhase = 'api_join' | 'ws_connect' | 'user_join' | 'first_subscription_data';

export interface MetricsRecorder {
  botStarted(): void;
  botStopped(): void;
  recordJoinPhase(phase: JoinPhase, ms: number): void;
  recordOutcome(outcome: BotOutcome): void;
}

export function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });
    function finish(): void {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    }
  });
}

export interface BotRunParams {
  adapter: BbbAdapter;
  client: BbbApiClient;
  fullName: string;
  meetingID: string;
  password: string;
  holdMs: number;
  connectTimeoutMs?: number;
  chatMessagesPerMinute?: number;
  raiseHandProbability?: number;
  logger: Logger;
  metrics?: MetricsRecorder;
  signal: AbortSignal;
}

const PHASE_KEYS: { phase: JoinPhase; key: keyof PhaseTimings }[] = [
  { phase: 'api_join', key: 'apiJoinMs' },
  { phase: 'ws_connect', key: 'wsConnectMs' },
  { phase: 'user_join', key: 'userJoinMs' },
  { phase: 'first_subscription_data', key: 'firstSubscriptionDataMs' },
];

export async function runOneBot(index: number, params: BotRunParams): Promise<BotOutcome> {
  if (params.signal.aborted) return { status: 'skipped' };
  const bot = new SignalingBot({
    adapter: params.adapter,
    client: params.client,
    join: { fullName: params.fullName, meetingID: params.meetingID, password: params.password },
    holdMs: params.holdMs,
    connectTimeoutMs: params.connectTimeoutMs,
    chatMessagesPerMinute: params.chatMessagesPerMinute,
    raiseHandProbability: params.raiseHandProbability,
    logger: params.logger.child({ bot: index }),
  });

  params.metrics?.botStarted();
  let botOutcome;
  try {
    botOutcome = await bot.run(params.signal);
  } finally {
    params.metrics?.botStopped();
  }

  const outcome: BotOutcome =
    botOutcome.status === 'completed'
      ? { status: 'completed', timings: botOutcome.timings }
      : { status: 'failed', kind: botOutcome.kind };

  if (params.metrics && outcome.status === 'completed') {
    for (const { phase, key } of PHASE_KEYS) {
      const value = outcome.timings[key];
      if (typeof value === 'number') params.metrics.recordJoinPhase(phase, value);
    }
  }
  params.metrics?.recordOutcome(outcome);
  return outcome;
}

export async function createMeetings(
  client: BbbApiClient,
  count: number,
  namePrefix: string,
  runId: string,
  moderatorPW: string,
  signal: AbortSignal,
  sink: string[]
): Promise<void> {
  for (let i = 0; i < count; i++) {
    const meetingID = `${namePrefix}-${runId}-${i}`;
    const response = await client.create({
      meetingID,
      name: `bbb-siege ${runId} #${i}`,
      moderatorPW,
      attendeePW: 'siege-att',
      duration: 120,
      signal,
    });
    if (response.returncode !== 'SUCCESS') {
      throw new Error(`Failed to create meeting ${meetingID}: ${response.message ?? 'unknown'}`);
    }
    sink.push(meetingID);
  }
}

export async function teardownMeetings(
  client: BbbApiClient,
  meetingIds: string[],
  moderatorPW: string,
  log: Logger
): Promise<string[]> {
  const ended: string[] = [];
  for (const meetingID of meetingIds) {
    try {
      const response = await client.end({ meetingID, password: moderatorPW });
      if (response.returncode === 'SUCCESS') ended.push(meetingID);
    } catch (error) {
      log.warn({ err: error, meetingID }, 'failed to end meeting during teardown');
    }
  }
  return ended;
}

export function buildReport(
  outcomes: BotOutcome[],
  meetingsCreated: string[],
  meetingsEnded: string[],
  wallClockMs: number
): FleetReport {
  const byKind: Partial<Record<BbbErrorKind, number>> = {};
  const apiJoin: number[] = [];
  const wsConnect: number[] = [];
  const userJoin: number[] = [];
  const firstSubscriptionData: number[] = [];

  let completed = 0;
  let failed = 0;
  let skipped = 0;

  for (const outcome of outcomes) {
    if (outcome.status === 'completed') {
      completed += 1;
      push(apiJoin, outcome.timings.apiJoinMs);
      push(wsConnect, outcome.timings.wsConnectMs);
      push(userJoin, outcome.timings.userJoinMs);
      push(firstSubscriptionData, outcome.timings.firstSubscriptionDataMs);
    } else if (outcome.status === 'failed') {
      failed += 1;
      byKind[outcome.kind] = (byKind[outcome.kind] ?? 0) + 1;
    } else {
      skipped += 1;
    }
  }

  return {
    total: outcomes.length,
    completed,
    failed,
    skipped,
    byKind,
    timings: {
      apiJoin: percentiles(apiJoin),
      wsConnect: percentiles(wsConnect),
      userJoin: percentiles(userJoin),
      firstSubscriptionData: percentiles(firstSubscriptionData),
    },
    meetingsCreated,
    meetingsEnded,
    wallClockMs,
  };
}

function push(target: number[], value: number | undefined): void {
  if (typeof value === 'number') target.push(value);
}
