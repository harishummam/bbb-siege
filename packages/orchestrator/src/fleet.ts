import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import type { BbbApiClient, BbbErrorKind } from '@bbb-siege/api-client';
import type { BbbAdapter } from '@bbb-siege/protocol';
import { SignalingBot, type PhaseTimings } from '@bbb-siege/bot-headless';
import pino, { type Logger } from 'pino';
import { percentiles, type Percentiles } from './percentiles.js';

export interface FleetConfig {
  adapter: BbbAdapter;
  client: BbbApiClient;
  botCount: number;
  meetingCount?: number;
  namePrefix?: string;
  moderatorPW?: string;
  holdMs?: number;
  startStaggerMs?: number;
  connectTimeoutMs?: number;
  chatMessagesPerMinute?: number;
  raiseHandProbability?: number;
  logger?: Logger;
}

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

type FleetOutcome =
  | { status: 'completed'; timings: PhaseTimings }
  | { status: 'failed'; kind: BbbErrorKind }
  | { status: 'skipped' };

function delay(ms: number, signal: AbortSignal): Promise<void> {
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

export async function runFleet(
  config: FleetConfig,
  externalSignal?: AbortSignal
): Promise<FleetReport> {
  const {
    adapter,
    client,
    botCount,
    meetingCount = 1,
    namePrefix = 'bbb-siege',
    moderatorPW = 'fleet-mod',
    holdMs = 10_000,
    startStaggerMs = 50,
    connectTimeoutMs,
    chatMessagesPerMinute,
    raiseHandProbability,
  } = config;
  const log = config.logger ?? pino({ name: 'fleet' });

  if (botCount < 1) throw new Error('botCount must be >= 1');
  if (meetingCount < 1) throw new Error('meetingCount must be >= 1');

  const controller = new AbortController();
  const onExternalAbort = (): void => controller.abort(externalSignal?.reason);
  externalSignal?.addEventListener('abort', onExternalAbort, { once: true });

  const runId = randomUUID().slice(0, 8);
  const meetingsCreated: string[] = [];
  const meetingsEnded: string[] = [];
  const start = performance.now();

  try {
    for (let i = 0; i < meetingCount; i++) {
      const meetingID = `${namePrefix}-${runId}-${i}`;
      const created = await client.create({
        meetingID,
        name: `bbb-siege fleet ${runId} #${i}`,
        moderatorPW,
        attendeePW: 'fleet-att',
        duration: 120,
        signal: controller.signal,
      });
      if (created.returncode !== 'SUCCESS') {
        throw new Error(`Failed to create meeting ${meetingID}: ${created.message ?? 'unknown'}`);
      }
      meetingsCreated.push(meetingID);
    }
    log.info({ meetingsCreated }, 'meetings created');

    const tasks = Array.from({ length: botCount }, (_, index) =>
      launchBot(index, {
        adapter,
        client,
        meetingID: meetingsCreated[index % meetingsCreated.length],
        moderatorPW,
        namePrefix,
        runId,
        holdMs,
        startStaggerMs,
        connectTimeoutMs,
        chatMessagesPerMinute,
        raiseHandProbability,
        logger: log,
        signal: controller.signal,
      })
    );

    const outcomes = await Promise.all(tasks);
    return buildReport(outcomes, meetingsCreated, meetingsEnded, performance.now() - start);
  } finally {
    externalSignal?.removeEventListener('abort', onExternalAbort);
    controller.abort();
    for (const meetingID of meetingsCreated) {
      try {
        const ended = await client.end({ meetingID, password: moderatorPW });
        if (ended.returncode === 'SUCCESS') meetingsEnded.push(meetingID);
      } catch (error) {
        log.warn({ err: error, meetingID }, 'failed to end meeting during teardown');
      }
    }
    log.info({ meetingsEnded }, 'fleet teardown complete');
  }
}

interface LaunchArgs {
  adapter: BbbAdapter;
  client: BbbApiClient;
  meetingID: string;
  moderatorPW: string;
  namePrefix: string;
  runId: string;
  holdMs: number;
  startStaggerMs: number;
  connectTimeoutMs?: number;
  chatMessagesPerMinute?: number;
  raiseHandProbability?: number;
  logger: Logger;
  signal: AbortSignal;
}

async function launchBot(index: number, args: LaunchArgs): Promise<FleetOutcome> {
  await delay(index * args.startStaggerMs, args.signal);
  if (args.signal.aborted) return { status: 'skipped' };

  const bot = new SignalingBot({
    adapter: args.adapter,
    client: args.client,
    join: {
      fullName: `${args.namePrefix}-bot-${index}`,
      meetingID: args.meetingID,
      password: args.moderatorPW,
    },
    holdMs: args.holdMs,
    connectTimeoutMs: args.connectTimeoutMs,
    chatMessagesPerMinute: args.chatMessagesPerMinute,
    raiseHandProbability: args.raiseHandProbability,
    logger: args.logger.child({ bot: index }),
  });

  const outcome = await bot.run(args.signal);
  return outcome.status === 'completed'
    ? { status: 'completed', timings: outcome.timings }
    : { status: 'failed', kind: outcome.kind };
}

function buildReport(
  outcomes: FleetOutcome[],
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
