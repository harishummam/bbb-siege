import { BbbApiClient } from '@bbb-siege/api-client';
import { BrowserBot, type BrowserKind } from '@bbb-siege/bot-browser';
import { createLogger } from './log.js';

const log = createLogger('probe');

function splitHosts(value: string | undefined): string[] {
  return value ? value.split(/[,;]/).map((h) => h.trim()).filter(Boolean) : [];
}

async function main(): Promise<void> {
  const url = process.env.BBB_URL;
  const secret = process.env.BBB_SECRET;
  if (!url || !secret) {
    log.error('BBB_URL and BBB_SECRET must be set (run with --env-file=.env)');
    process.exitCode = 1;
    return;
  }

  const browser = (process.env.BROWSER as BrowserKind) || 'chromium';
  const client = new BbbApiClient({ url, secret, testHosts: splitHosts(process.env.BBB_TEST_HOSTS) });

  const meetingID = `bbb-siege-probe-${Date.now()}`;
  const moderatorPW = 'probe-mod';

  const controller = new AbortController();
  const onSigint = (): void => {
    log.warn('SIGINT received, aborting probe and ending meeting');
    controller.abort();
  };
  process.on('SIGINT', onSigint);

  let meetingCreated = false;
  try {
    const created = await client.create({
      meetingID,
      name: 'bbb-siege probe',
      moderatorPW,
      attendeePW: 'probe-att',
      duration: 60,
      signal: controller.signal,
    });
    meetingCreated = created.returncode === 'SUCCESS';
    log.info({ meetingID, browser }, 'meeting created');

    const bot = new BrowserBot({
      client,
      meetingID,
      password: moderatorPW,
      fullName: `probe-${browser}`,
      browser,
      holdMs: 15_000,
      logger: log,
    });

    const outcome = await bot.run(controller.signal);
    if (outcome.status === 'completed') {
      log.info(
        { browser: outcome.browser, iceConnected: outcome.iceConnected, pcCount: outcome.pcCount, timings: outcome.timings },
        'PROBE COMPLETED'
      );
      if (!outcome.iceConnected) process.exitCode = 1;
    } else {
      log.error({ browser: outcome.browser, timings: outcome.timings }, 'PROBE FAILED');
      process.exitCode = 1;
    }
  } finally {
    process.off('SIGINT', onSigint);
    if (meetingCreated) {
      try {
        const ended = await client.end({ meetingID, password: moderatorPW });
        log.info({ returncode: ended.returncode }, 'meeting ended');
      } catch (error) {
        log.warn({ err: error }, 'failed to end meeting');
      }
    }
  }
}

main().catch((error) => {
  log.error({ err: error }, 'probe run crashed');
  process.exitCode = 1;
});
