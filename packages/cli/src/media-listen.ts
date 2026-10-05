import { BbbApiClient } from '@bbb-siege/api-client';
import { MediaBot, shutdownMediaTransport, type MediaListenOutcome } from '@bbb-siege/bot-media';
import { V30Adapter } from '@bbb-siege/protocol';
import { createLogger } from './log.js';

const log = createLogger('media-listen');

function splitHosts(value: string | undefined): string[] {
  return value ? value.split(/[,;]/).map((h) => h.trim()).filter(Boolean) : [];
}

function percentile(values: number[], p: number): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]);
}

async function main(): Promise<void> {
  const url = process.env.BBB_URL;
  const secret = process.env.BBB_SECRET;
  if (!url || !secret) {
    log.error('BBB_URL and BBB_SECRET must be set (run with --env-file=.env)');
    process.exitCode = 1;
    return;
  }
  const listeners = Math.max(1, Number(process.env.LISTENERS ?? 1));
  const holdMs = Number(process.env.HOLD_MS ?? 15_000);
  const staggerMs = Number(process.env.STAGGER_MS ?? 200);
  const includeTurn = process.env.INCLUDE_TURN !== 'false';

  const client = new BbbApiClient({ url, secret, testHosts: splitHosts(process.env.BBB_TEST_HOSTS) });
  const meetingID = `bbb-siege-media-listen-${Date.now()}`;
  const moderatorPW = 'listen-mod';
  const controller = new AbortController();
  const onSigint = (): void => controller.abort(new Error('SIGINT'));
  process.once('SIGINT', onSigint);

  let meetingCreated = false;
  try {
    const created = await client.create({ meetingID, name: 'bbb-siege native listen-only', moderatorPW, attendeePW: 'listen-att', duration: 30 });
    meetingCreated = created.returncode === 'SUCCESS';
    log.info({ meetingID, listeners, holdMs, includeTurn }, 'meeting created');

    const adapter = new V30Adapter();
    const runs: Promise<MediaListenOutcome>[] = [];
    for (let i = 0; i < listeners && !controller.signal.aborted; i++) {
      const bot = new MediaBot({
        adapter,
        client,
        join: { fullName: `listener-${i + 1}`, meetingID, password: 'listen-att' },
        logger: log.child({ bot: i + 1 }),
        includeTurn,
      });
      runs.push(bot.listen({ holdMs, signal: controller.signal }));
      if (i < listeners - 1) await new Promise((r) => setTimeout(r, staggerMs));
    }
    const outcomes = await Promise.all(runs);

    outcomes.forEach((outcome, i) => {
      if (outcome.status === 'completed') {
        log.info({ bot: i + 1, timings: outcome.timings, audio: outcome.audio, candidatePair: outcome.candidatePair, turnRelayUsed: outcome.turnRelayUsed }, 'LISTENER COMPLETED');
      } else {
        const error = outcome.error as { kind?: string; message?: string };
        log.warn({ bot: i + 1, kind: error?.kind, error: error?.message, timings: outcome.timings }, 'LISTENER FAILED');
      }
    });

    const completed = outcomes.filter((o): o is Extract<MediaListenOutcome, { status: 'completed' }> => o.status === 'completed');
    const flowing = completed.map((o) => o.timings.mediaFlowingMs ?? 0);
    log.info(
      {
        listeners,
        completed: completed.length,
        failed: outcomes.length - completed.length,
        receivingAudio: completed.filter((o) => o.audio.packets > 0).length,
        mediaFlowingMsP50: percentile(flowing, 50),
        mediaFlowingMsP95: percentile(flowing, 95),
        totalPacketsLost: completed.reduce((sum, o) => sum + o.audio.lost, 0),
        maxJitterMs: Math.max(0, ...completed.map((o) => o.audio.jitterMs)),
      },
      'LISTEN SUMMARY'
    );
    if (completed.length < outcomes.length) process.exitCode = 1;
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
    shutdownMediaTransport();
  }
}

main().catch((error) => {
  log.error({ err: error }, 'media-listen crashed');
  process.exitCode = 1;
});
