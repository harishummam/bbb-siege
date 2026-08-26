import { BbbApiClient } from '@bbb-siege/api-client';
import { SignalingBot } from '@bbb-siege/bot-headless';
import { V30Adapter } from '@bbb-siege/protocol';
import pino from 'pino';

const log = pino({ name: 'smoke' });

function splitHosts(value: string | undefined): string[] {
  return value
    ? value.split(/[,;]/).map((h) => h.trim()).filter(Boolean)
    : [];
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

  const meetingID = `bbb-siege-smoke-${Date.now()}`;
  const moderatorPW = 'smoke-mod';

  const controller = new AbortController();
  const onSigint = (): void => {
    log.warn('SIGINT received, aborting bot and ending meeting');
    controller.abort();
  };
  process.on('SIGINT', onSigint);

  let meetingCreated = false;
  try {
    const version = await adapter.detectVersion(client, controller.signal);
    log.info({ bbbVersion: version.raw, tag: version.tag }, 'server version');

    log.info({ meetingID }, 'creating meeting');
    const created = await client.create({
      meetingID,
      name: 'bbb-siege smoke',
      moderatorPW,
      attendeePW: 'smoke-att',
      duration: 60,
      signal: controller.signal,
    });
    meetingCreated = created.returncode === 'SUCCESS';
    log.info({ returncode: created.returncode, internalMeetingID: created.internalMeetingID }, 'meeting created');

    const bot = new SignalingBot({
      adapter,
      client,
      join: { fullName: 'smoke-bot-1', meetingID, password: moderatorPW },
      holdMs: 5000,
      logger: log.child({ bot: 1 }),
    });

    const outcome = await bot.run(controller.signal);
    if (outcome.status === 'completed') {
      log.info(
        { timings: outcome.timings, usersCount: outcome.state.usersCount() },
        'BOT COMPLETED',
      );
    } else {
      log.error({ kind: outcome.kind, timings: outcome.timings }, 'BOT FAILED');
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
  log.error({ err: error }, 'smoke run crashed');
  process.exitCode = 1;
});
