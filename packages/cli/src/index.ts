import { pathToFileURL } from 'node:url';
import { BbbApiClient } from '@bbb-siege/api-client';
import { SiegeMetrics, startMetricsServer, type MetricsServer } from '@bbb-siege/metrics';
import { loadScenario, runScenario, type KneeResult } from '@bbb-siege/orchestrator';
import { V30Adapter } from '@bbb-siege/protocol';
import { Command } from 'commander';
import { createLogger } from './log.js';

function splitHosts(value: string | undefined): string[] {
  return value ? value.split(/[,;]/).map((h) => h.trim()).filter(Boolean) : [];
}

function formatKnee(knee: KneeResult): Record<string, unknown> {
  return {
    sloP95Ms: knee.sloMs ?? null,
    kneeUsers: knee.kneeUsers,
    bands: knee.bands.map((b) => ({ users: b.users, p95Ms: Math.round(b.p95Ms), n: b.count })),
  };
}

interface RunOptions {
  metricsPort: string;
  iUnderstand?: boolean;
}

async function runCommand(scenarioPath: string, options: RunOptions): Promise<void> {
  const log = createLogger('siege');

  let scenario;
  try {
    scenario = loadScenario(scenarioPath);
  } catch (error) {
    log.error({ err: error }, 'failed to load scenario');
    process.exitCode = 1;
    return;
  }

  const client = new BbbApiClient({
    url: scenario.target.url,
    secret: scenario.target.secret,
    testHosts: splitHosts(process.env.BBB_TEST_HOSTS),
    iUnderstand: options.iUnderstand ?? false,
  });

  const metrics = new SiegeMetrics();
  let metricsServer: MetricsServer | undefined;
  try {
    metricsServer = await startMetricsServer(metrics, Number.parseInt(options.metricsPort, 10) || 9095);
    log.info({ port: metricsServer.port }, 'metrics endpoint listening at /metrics');
  } catch (error) {
    log.warn({ err: error }, 'metrics server failed to start; continuing without it');
  }

  const controller = new AbortController();
  const onSigint = (): void => {
    log.warn('SIGINT received, aborting run and ending meetings');
    controller.abort();
  };
  process.on('SIGINT', onSigint);

  log.info({ scenario: scenario.name }, 'starting scenario run');
  try {
    const report = await runScenario(
      { scenario, adapter: new V30Adapter(), client, metrics, logger: log },
      controller.signal
    );
    log.info(
      {
        scenario: report.scenarioName,
        peakUsers: report.peakUsers,
        plannedDurationMs: report.plannedDurationMs,
        completed: report.completed,
        failed: report.failed,
        skipped: report.skipped,
        byKind: report.byKind,
        joinLatencyMs: report.timings.apiJoin,
        knee: formatKnee(report.knee),
        meetingsEnded: report.meetingsEnded.length,
        meetingsCreated: report.meetingsCreated.length,
      },
      'RUN REPORT'
    );
    if (report.completed === 0) process.exitCode = 1;
  } catch (error) {
    log.error({ err: error }, 'scenario run failed');
    process.exitCode = 1;
  } finally {
    process.off('SIGINT', onSigint);
    await metricsServer?.close();
  }
}

export const program = new Command();
program.name('bbb-siege').description('Load and stress testing harness for BigBlueButton 3.x');
program
  .command('run')
  .argument('<scenario>', 'path to a scenario YAML file')
  .option('--metrics-port <port>', 'port for the Prometheus /metrics endpoint', '9095')
  .option('--i-understand', 'bypass the BBB_TEST_HOSTS guardrail for the target host', false)
  .action(runCommand);

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  program.parseAsync(process.argv).catch((error) => {
    createLogger('siege').error({ err: error }, 'cli crashed');
    process.exitCode = 1;
  });
}
