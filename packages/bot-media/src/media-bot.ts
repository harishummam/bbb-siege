import type { BbbApiClient } from '@bbb-siege/api-client';
import type { BbbAdapter, JoinOptions, MediaStack, SignalingSession } from '@bbb-siege/protocol';
import { userCurrentSubscription, userJoinMutation } from '@bbb-siege/protocol';
import pino, { type Logger } from 'pino';

export interface MediaBotConfig {
  adapter: BbbAdapter;
  client: BbbApiClient;
  join: JoinOptions;
  connectTimeoutMs?: number;
  detectTimeoutMs?: number;
  logger?: Logger;
}

export interface MediaDetectResult {
  stack: MediaStack;
  livekitTokenPresent: boolean;
  livekitToken?: string;
  recordKeys?: string[];
  livekit?: unknown;
}

interface UserCurrentRecord {
  livekit?: { livekitToken?: unknown } | null;
  [key: string]: unknown;
}

export class MediaBot {
  private readonly adapter: BbbAdapter;
  private readonly client: BbbApiClient;
  private readonly config: MediaBotConfig;
  private readonly log: Logger;

  constructor(config: MediaBotConfig) {
    this.adapter = config.adapter;
    this.client = config.client;
    this.config = config;
    this.log = config.logger ?? pino({ name: 'media-bot' });
  }

  /**
   * Joins signaling, registers presence, and inspects `user_current.livekit.livekitToken`
   * to determine which SFU stack the server is running (LiveKit if a token is issued,
   * otherwise inferred mediasoup). Leaves cleanly.
   */
  async detect(externalSignal?: AbortSignal): Promise<MediaDetectResult> {
    const controller = new AbortController();
    const onAbort = (): void => controller.abort(externalSignal?.reason);
    externalSignal?.addEventListener('abort', onAbort, { once: true });

    const context = await this.adapter.join(this.client, { ...this.config.join, signal: controller.signal });
    const session = await this.adapter.openSignaling(context, {
      signal: controller.signal,
      connectTimeoutMs: this.config.connectTimeoutMs,
    });

    try {
      await session.mutate(userJoinMutation(context.authToken), controller.signal);
      const result = await this.readUserCurrent(session, controller.signal);
      this.log.info(result, 'media stack detected');
      return result;
    } finally {
      externalSignal?.removeEventListener('abort', onAbort);
      controller.abort();
      await this.adapter.leave(context, session).catch(() => undefined);
    }
  }

  private async readUserCurrent(session: SignalingSession, signal: AbortSignal): Promise<MediaDetectResult> {
    const timeoutMs = this.config.detectTimeoutMs ?? 8000;
    const readController = new AbortController();
    const onAbort = (): void => readController.abort();
    signal.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => readController.abort(), timeoutMs);

    let sawRecord = false;
    let recordKeys: string[] | undefined;
    let livekit: unknown;

    try {
      for await (const data of session.subscribe(userCurrentSubscription(), readController.signal)) {
        const record = (data as { user_current?: UserCurrentRecord[] })?.user_current?.[0];
        if (!record) continue;
        sawRecord = true;
        recordKeys = Object.keys(record);
        livekit = record.livekit ?? undefined;
        const token =
          livekit && typeof livekit === 'object' && typeof (livekit as { livekitToken?: unknown }).livekitToken === 'string'
            ? (livekit as { livekitToken: string }).livekitToken
            : undefined;
        if (token) {
          return { stack: 'livekit', livekitTokenPresent: true, livekitToken: token, recordKeys, livekit };
        }
      }
    } catch (error) {
      if (!readController.signal.aborted) throw error;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    }

    return { stack: sawRecord ? 'mediasoup' : 'unknown', livekitTokenPresent: false, recordKeys, livekit };
  }
}
