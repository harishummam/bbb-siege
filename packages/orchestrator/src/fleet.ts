import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import type { BbbApiClient } from '@bbb-siege/api-client';
import type { BbbAdapter } from '@bbb-siege/protocol';
import pino, { type Logger } from 'pino';
import {
  buildReport,
  createMeetings,
  delay,
  runOneBot,
  teardownMeetings,
  type BotOutcome,
  type FleetReport,
  type MetricsRecorder,
} from './run-core.js';
import { KneeSampler } from './knee.js';

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
  metrics?: MetricsRecorder;
  logger?: Logger;
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
  const sampler = new KneeSampler();
  const start = performance.now();

  try {
    await createMeetings(client, meetingCount, namePrefix, runId, moderatorPW, controller.signal, meetingsCreated);
    log.info({ meetingsCreated }, 'meetings created');

    const tasks = Array.from({ length: botCount }, async (_unused, index): Promise<BotOutcome> => {
      await delay(index * startStaggerMs, controller.signal);
      return runOneBot(index, {
        adapter,
        client,
        fullName: `${namePrefix}-bot-${index}`,
        meetingID: meetingsCreated[index % meetingsCreated.length],
        password: moderatorPW,
        holdMs,
        connectTimeoutMs,
        chatMessagesPerMinute,
        raiseHandProbability,
        logger: log,
        metrics: config.metrics,
        sampler,
        signal: controller.signal,
      });
    });

    const outcomes = await Promise.all(tasks);
    return buildReport(outcomes, meetingsCreated, meetingsEnded, performance.now() - start, sampler);
  } finally {
    externalSignal?.removeEventListener('abort', onExternalAbort);
    controller.abort();
    meetingsEnded.push(...(await teardownMeetings(client, meetingsCreated, moderatorPW, log)));
    log.info({ meetingsEnded }, 'fleet teardown complete');
  }
}
