import { performance } from 'node:perf_hooks';
import type { BbbApiClient } from '@bbb-siege/api-client';
import type {
  BbbAdapter,
  JoinContext,
  JoinOptions,
  MediaStack,
  SfuConnection,
  SignalingSession,
} from '@bbb-siege/protocol';
import { userCurrentSubscription, userJoinMutation, userSetListenOnlyInput } from '@bbb-siege/protocol';
import pino, { type Logger } from 'pino';
import { createNdcAudioPeer, type AudioPeer, type AudioPeerFactory } from './mediasoup/audio-peer.js';
import { toNdcIceServers } from './mediasoup/ice.js';

export interface MediaBotConfig {
  adapter: BbbAdapter;
  client: BbbApiClient;
  join: JoinOptions;
  connectTimeoutMs?: number;
  detectTimeoutMs?: number;
  logger?: Logger;
  peerFactory?: AudioPeerFactory;
  includeTurn?: boolean;
}

export interface ListenOptions {
  holdMs?: number;
  mediaTimeoutMs?: number;
  signal?: AbortSignal;
}

export interface MediaTimings {
  joinMs?: number;
  iceConnectedMs?: number;
  mediaFlowingMs?: number;
  firstAudioPacketMs?: number;
}

export interface AudioReceiveQoe {
  packets: number;
  lost: number;
  jitterMs: number;
  kbps?: number;
}

export type MediaListenOutcome =
  | {
      status: 'completed';
      timings: MediaTimings;
      audio: AudioReceiveQoe;
      turnRelayUsed: boolean;
      candidatePair?: string;
    }
  | { status: 'failed'; error: unknown; timings: MediaTimings };

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

  /**
   * Joins as a listen-only participant over native WebRTC: negotiates audio with the SFU,
   * receives the conference mix for `holdMs`, and reports phase timings plus RTP receive QoE.
   */
  async listen(options: ListenOptions = {}): Promise<MediaListenOutcome> {
    const controller = new AbortController();
    const onAbort = (): void => controller.abort(options.signal?.reason);
    options.signal?.addEventListener('abort', onAbort, { once: true });
    const timings: MediaTimings = {};

    let context: JoinContext | undefined;
    let session: SignalingSession | undefined;
    let sfu: SfuConnection | undefined;
    let peer: AudioPeer | undefined;

    try {
      const joinStart = performance.now();
      context = await this.adapter.join(this.client, { ...this.config.join, signal: controller.signal });
      session = await this.adapter.openSignaling(context, {
        signal: controller.signal,
        connectTimeoutMs: this.config.connectTimeoutMs,
      });
      await session.mutate(userJoinMutation(context.authToken), controller.signal);
      timings.joinMs = performance.now() - joinStart;

      const iceServers = await this.adapter.fetchIceServers(context, controller.signal);
      peer = (this.config.peerFactory ?? createNdcAudioPeer)({
        iceServers: toNdcIceServers(iceServers, { includeTurn: this.config.includeTurn }),
      });
      const activePeer = peer;

      const mediaStart = performance.now();
      sfu = await this.adapter.openSfu(context, { signal: controller.signal });
      await sfu.startAudio({
        listenOnly: true,
        answer: (offer) => activePeer.answer(offer),
        signal: controller.signal,
        timeoutMs: options.mediaTimeoutMs,
      });
      timings.mediaFlowingMs = performance.now() - mediaStart;
      if (activePeer.events.iceConnectedAt !== undefined) {
        timings.iceConnectedMs = activePeer.events.iceConnectedAt - mediaStart;
      }
      await session.mutate(userSetListenOnlyInput(true), controller.signal);
      this.log.info({ mediaFlowingMs: Math.round(timings.mediaFlowingMs) }, 'listen-only audio flowing');

      const before = activePeer.stats();
      const holdStart = performance.now();
      await this.hold(options.holdMs ?? 0, controller.signal);
      const after = activePeer.stats();
      const holdSecs = (performance.now() - holdStart) / 1000;

      if (after.firstPacketAt !== undefined) timings.firstAudioPacketMs = after.firstPacketAt - mediaStart;
      const pair = activePeer.candidatePair();
      return {
        status: 'completed',
        timings,
        audio: {
          packets: after.packets,
          lost: after.lost,
          jitterMs: after.jitterMs,
          kbps: holdSecs > 0 ? Math.round(((after.bytes - before.bytes) * 8) / 1000 / holdSecs) : undefined,
        },
        turnRelayUsed: pair?.turnRelayUsed ?? false,
        candidatePair: pair ? `${pair.local}->${pair.remote}` : undefined,
      };
    } catch (error) {
      this.log.error({ err: error }, 'listen-only media bot failed');
      return { status: 'failed', error, timings };
    } finally {
      options.signal?.removeEventListener('abort', onAbort);
      controller.abort();
      await sfu?.close().catch(() => undefined);
      peer?.close();
      if (context && session) await this.adapter.leave(context, session).catch(() => undefined);
    }
  }

  private hold(holdMs: number, signal: AbortSignal): Promise<void> {
    if (holdMs <= 0 || signal.aborted) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const done = (): void => {
        clearTimeout(timer);
        signal.removeEventListener('abort', done);
        resolve();
      };
      const timer = setTimeout(done, holdMs);
      signal.addEventListener('abort', done, { once: true });
    });
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
