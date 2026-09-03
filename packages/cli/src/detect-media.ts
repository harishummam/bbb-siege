import { BbbApiClient } from '@bbb-siege/api-client';
import { MediaBot } from '@bbb-siege/bot-media';
import { V30Adapter } from '@bbb-siege/protocol';
import { createLogger } from './log.js';

const log = createLogger('detect-media');

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

  const client = new BbbApiClient({ url, secret, testHosts: splitHosts(process.env.BBB_TEST_HOSTS) });
  const meetingID = `bbb-siege-detect-${Date.now()}`;
  const moderatorPW = 'detect-mod';

  let meetingCreated = false;
  try {
    const created = await client.create({ meetingID, name: 'bbb-siege media detect', moderatorPW, attendeePW: 'detect-att', duration: 60 });
    meetingCreated = created.returncode === 'SUCCESS';
    log.info({ meetingID }, 'meeting created');

    const bot = new MediaBot({
      adapter: new V30Adapter(),
      client,
      join: { fullName: 'detect-bot', meetingID, password: moderatorPW },
      logger: log,
    });
    const result = await bot.detect();
    log.info(
      { stack: result.stack, livekitTokenPresent: result.livekitTokenPresent, recordKeys: result.recordKeys, livekit: result.livekit },
      'MEDIA STACK'
    );
  } finally {
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
  log.error({ err: error }, 'detect-media crashed');
  process.exitCode = 1;
});
