import { BbbApiClient } from '@bbb-siege/api-client';
import { runFleet } from '@bbb-siege/orchestrator';
import { V30Adapter } from '@bbb-siege/protocol';
import { createLogger } from './log.js';

const log = createLogger('fleet');

function splitHosts(value: string | undefined): string[] {
  return value ? value.split(/[,;]/).map((h) => h.trim()).filter(Boolean) : [];
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function main(): Promise<void> {
  const url = process.env.BBB_URL;
  const secret = process.env.BBB_SECRET;
  if (!url || !secret) {
    log.error('BBB_URL and BBB_SECRET must be set (run with --env-file=.env)');
    process.exitCode = 1;
    return;
  }

  const client = new BbbApiClient({ url, secret, testHosts: splitHosts(process.env.BBB_TEST_HOSTS) });
  const adapter = new V30Adapter();

  const botCount = intEnv('BOTS', 10);
  const meetingCount = intEnv('MEETINGS', 1);
  const holdMs = intEnv('HOLD_MS', 10_000);
  const startStaggerMs = intEnv('STAGGER_MS', 50);

  const controller = new AbortController();
  const onSigint = (): void => {
    log.warn('SIGINT received, aborting bots and ending meetings');
    controller.abort();
  };
  process.on('SIGINT', onSigint);

  log.info({ botCount, meetingCount, holdMs, startStaggerMs }, 'starting fleet');
  try {
    const report = await runFleet(
      { adapter, client, botCount, meetingCount, holdMs, startStaggerMs, logger: log },
      controller.signal
    );
    log.info(
      {
        total: report.total,
        completed: report.completed,
        failed: report.failed,
        skipped: report.skipped,
        byKind: report.byKind,
        wallClockMs: Math.round(report.wallClockMs),
        joinLatencyMs: report.timings.apiJoin,
        wsConnectMs: report.timings.wsConnect,
        firstSubscriptionDataMs: report.timings.firstSubscriptionData,
        meetingsEnded: report.meetingsEnded.length,
        meetingsCreated: report.meetingsCreated.length,
      },
      'FLEET REPORT'
    );
    if (report.completed === 0) process.exitCode = 1;
  } finally {
    process.off('SIGINT', onSigint);
  }
}

main().catch((error) => {
  log.error({ err: error }, 'fleet run crashed');
  process.exitCode = 1;
});
