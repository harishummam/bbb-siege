import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import type { BbbApiClient } from '@bbb-siege/api-client';
import type { BbbAdapter } from '@bbb-siege/protocol';
import pino, { type Logger } from 'pino';
import { computeLaunchSchedule } from './ramp.js';
import type { Scenario } from './scenario.js';
import {
  buildReport,
  createMeetings,
  delay,
  runOneBot,
  teardownMeetings,
  type BotOutcome,
  type FleetReport,
} from './run-core.js';

export interface ScenarioRunConfig {
  scenario: Scenario;
  adapter: BbbAdapter;
  client: BbbApiClient;
  moderatorPW?: string;
  namePrefix?: string;
  connectTimeoutMs?: number;
  logger?: Logger;
}

export interface ScenarioReport extends FleetReport {
  scenarioName: string;
  peakUsers: number;
  plannedDurationMs: number;
}

export async function runScenario(
  config: ScenarioRunConfig,
  externalSignal?: AbortSignal
): Promise<ScenarioReport> {
  const { scenario, adapter, client } = config;
  const moderatorPW = config.moderatorPW ?? 'scenario-mod';
  const namePrefix = config.namePrefix ?? 'bbb-siege';
  const log = config.logger ?? pino({ name: 'scenario' });

  const schedule = computeLaunchSchedule(scenario.ramp);
  if (schedule.peak < 1) throw new Error('scenario ramp launches no users');

  const controller = new AbortController();
  const onExternalAbort = (): void => controller.abort(externalSignal?.reason);
  externalSignal?.addEventListener('abort', onExternalAbort, { once: true });

  const runId = randomUUID().slice(0, 8);
  const meetingsCreated: string[] = [];
  const meetingsEnded: string[] = [];
  const start = performance.now();

  try {
    await createMeetings(client, scenario.meeting.count, namePrefix, runId, moderatorPW, controller.signal, meetingsCreated);
    log.info(
      { meetingsCreated, peakUsers: schedule.peak, plannedDurationMs: schedule.totalMs },
      'scenario meetings created'
    );

    const tasks = schedule.launchAtMs.map((launchAt, index) =>
      (async (): Promise<BotOutcome> => {
        await delay(launchAt, controller.signal);
        return runOneBot(index, {
          adapter,
          client,
          fullName: `${namePrefix}-bot-${index}`,
          meetingID: meetingsCreated[index % meetingsCreated.length],
          password: moderatorPW,
          holdMs: Math.max(0, schedule.totalMs - launchAt),
          connectTimeoutMs: config.connectTimeoutMs,
          chatMessagesPerMinute: scenario.behaviour?.chatMessagesPerMinute,
          raiseHandProbability: scenario.behaviour?.raiseHandProbability,
          logger: log,
          signal: controller.signal,
        });
      })()
    );

    const outcomes = await Promise.all(tasks);
    const report = buildReport(outcomes, meetingsCreated, meetingsEnded, performance.now() - start);
    return {
      ...report,
      scenarioName: scenario.name,
      peakUsers: schedule.peak,
      plannedDurationMs: schedule.totalMs,
    };
  } finally {
    externalSignal?.removeEventListener('abort', onExternalAbort);
    controller.abort();
    meetingsEnded.push(...(await teardownMeetings(client, meetingsCreated, moderatorPW, log)));
    log.info({ meetingsEnded }, 'scenario teardown complete');
  }
}
