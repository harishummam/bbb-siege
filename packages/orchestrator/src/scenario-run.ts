import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import type { BbbApiClient } from '@bbb-siege/api-client';
import type { BbbAdapter } from '@bbb-siege/protocol';
import { BrowserBot, type BrowserKind } from '@bbb-siege/bot-browser';
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
  type MetricsRecorder,
  type ProbeResult,
} from './run-core.js';
import { KneeSampler } from './knee.js';

const DEFAULT_MAX_BROWSER_PROBES = 3;

interface ProbeArgs {
  client: BbbApiClient;
  meetingID: string;
  moderatorPW: string;
  namePrefix: string;
  holdMs: number;
  connectTimeoutMs?: number;
  metrics?: MetricsRecorder;
  log: Logger;
  signal: AbortSignal;
}

async function runProbe(index: number, browser: BrowserKind, args: ProbeArgs): Promise<ProbeResult> {
  if (args.signal.aborted) return { browser, status: 'failed', iceConnected: false };
  const bot = new BrowserBot({
    client: args.client,
    meetingID: args.meetingID,
    password: args.moderatorPW,
    fullName: `${args.namePrefix}-probe-${index}`,
    browser,
    holdMs: args.holdMs,
    iceTimeoutMs: args.connectTimeoutMs,
    logger: args.log.child({ probe: index }),
  });
  const outcome = await bot.run(args.signal);
  const result: ProbeResult =
    outcome.status === 'completed'
      ? {
          browser,
          status: 'completed',
          iceConnected: outcome.iceConnected,
          rttMs: outcome.qoe?.rttMs,
          jitterMs: outcome.qoe?.audio?.jitterMs,
          turnRelayUsed: outcome.qoe?.turnRelayUsed,
        }
      : { browser, status: 'failed', iceConnected: false };
  args.metrics?.recordProbe?.(result);
  return result;
}

function planProbes(scenario: Scenario, peak: number, maxProbes: number): { count: number; browsers: BrowserKind[] } {
  const browserMix = scenario.mix.browser;
  if (!browserMix || browserMix.weight <= 0) return { count: 0, browsers: [] };
  const total = scenario.mix.signaling.weight + (scenario.mix.media?.weight ?? 0) + browserMix.weight;
  const derived = Math.round((peak * browserMix.weight) / total);
  const count = Math.min(maxProbes, Math.max(1, derived));
  const browsers: BrowserKind[] = browserMix.browsers?.length ? browserMix.browsers : ['chromium'];
  return { count, browsers };
}

export interface ScenarioRunConfig {
  scenario: Scenario;
  adapter: BbbAdapter;
  client: BbbApiClient;
  moderatorPW?: string;
  namePrefix?: string;
  connectTimeoutMs?: number;
  maxBrowserProbes?: number;
  metrics?: MetricsRecorder;
  logger?: Logger;
}

export interface ScenarioReport extends FleetReport {
  scenarioName: string;
  peakUsers: number;
  plannedDurationMs: number;
  probes: ProbeResult[];
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
  const sampler = new KneeSampler();
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
          metrics: config.metrics,
          sampler,
          signal: controller.signal,
        });
      })()
    );

    const probePlan = planProbes(scenario, schedule.peak, config.maxBrowserProbes ?? DEFAULT_MAX_BROWSER_PROBES);
    if (probePlan.count > 0) {
      log.info({ count: probePlan.count, browsers: probePlan.browsers }, 'launching browser probes');
    }
    const probeTasks = Array.from({ length: probePlan.count }, (_unused, index) =>
      runProbe(index, probePlan.browsers[index % probePlan.browsers.length], {
        client,
        meetingID: meetingsCreated[index % meetingsCreated.length],
        moderatorPW,
        namePrefix,
        holdMs: schedule.totalMs,
        connectTimeoutMs: config.connectTimeoutMs,
        metrics: config.metrics,
        log,
        signal: controller.signal,
      })
    );

    const [outcomes, probes] = await Promise.all([Promise.all(tasks), Promise.all(probeTasks)]);
    const report = buildReport(
      outcomes,
      meetingsCreated,
      meetingsEnded,
      performance.now() - start,
      sampler,
      scenario.slo?.joinLatencyP95
    );
    return {
      ...report,
      scenarioName: scenario.name,
      peakUsers: schedule.peak,
      plannedDurationMs: schedule.totalMs,
      probes,
    };
  } finally {
    externalSignal?.removeEventListener('abort', onExternalAbort);
    controller.abort();
    meetingsEnded.push(...(await teardownMeetings(client, meetingsCreated, moderatorPW, log)));
    log.info({ meetingsEnded }, 'scenario teardown complete');
  }
}
