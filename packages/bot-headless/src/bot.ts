import { performance } from 'node:perf_hooks';
import type { BbbApiClient, BbbErrorKind } from '@bbb-siege/api-client';
import { BbbApiError } from '@bbb-siege/api-client';
import type {
  BbbAdapter,
  JoinContext,
  JoinOptions,
  SignalingSession,
  SubscriptionSpec,
} from '@bbb-siege/protocol';
import { coreSubscriptions, userJoinMutation } from '@bbb-siege/protocol';
import pino, { type Logger } from 'pino';
import { SubscriptionState } from './subscription-state.js';

export interface SignalingBotConfig {
  adapter: BbbAdapter;
  client: BbbApiClient;
  join: JoinOptions;
  logger?: Logger;
  holdMs?: number;
  connectTimeoutMs?: number;
  isMobile?: boolean;
  subscriptions?: SubscriptionSpec[];
}

export interface PhaseTimings {
  apiJoinMs?: number;
  wsConnectMs?: number;
  userJoinMs?: number;
  firstSubscriptionDataMs?: number;
}

export type BotOutcome =
  | { status: 'completed'; timings: PhaseTimings; state: SubscriptionState }
  | { status: 'failed'; kind: BbbErrorKind; error: unknown; timings: PhaseTimings };

function classify(error: unknown): BbbErrorKind {
  if (error instanceof BbbApiError) return error.kind;
  return 'ClientBug';
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });
    function finish(): void {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    }
  });
}

export class SignalingBot {
  private readonly adapter: BbbAdapter;
  private readonly client: BbbApiClient;
  private readonly config: SignalingBotConfig;
  private readonly log: Logger;
  private readonly state = new SubscriptionState();
  private readonly timings: PhaseTimings = {};

  constructor(config: SignalingBotConfig) {
    this.adapter = config.adapter;
    this.client = config.client;
    this.config = config;
    this.log = config.logger ?? pino({ name: 'signaling-bot' });
  }

  async run(externalSignal?: AbortSignal): Promise<BotOutcome> {
    const start = performance.now();
    const controller = new AbortController();
    const onExternalAbort = (): void => controller.abort(externalSignal?.reason);
    externalSignal?.addEventListener('abort', onExternalAbort, { once: true });

    let context: JoinContext | undefined;
    let session: SignalingSession | undefined;

    try {
      const joinStart = performance.now();
      context = await this.adapter.join(this.client, {
        ...this.config.join,
        signal: controller.signal,
      });
      this.timings.apiJoinMs = performance.now() - joinStart;
      this.log.debug({ userId: context.userId, meetingId: context.meetingId }, 'joined via api');

      const wsStart = performance.now();
      session = await this.adapter.openSignaling(context, {
        signal: controller.signal,
        connectTimeoutMs: this.config.connectTimeoutMs,
        isMobile: this.config.isMobile,
      });
      this.timings.wsConnectMs = performance.now() - wsStart;
      this.log.debug('signaling connected');

      const userJoinStart = performance.now();
      await session.mutate(userJoinMutation(context.authToken), controller.signal);
      this.timings.userJoinMs = performance.now() - userJoinStart;
      this.log.debug('userJoinMeeting acknowledged');

      const specs = this.config.subscriptions ?? coreSubscriptions();
      this.consumeSubscriptions(session, specs, controller.signal, start);

      await Promise.race([
        delay(this.config.holdMs ?? 0, controller.signal),
        session.closed,
      ]);

      return { status: 'completed', timings: this.timings, state: this.state };
    } catch (error) {
      const kind = classify(error);
      this.log.error({ kind, err: error }, 'signaling bot failed');
      return { status: 'failed', kind, error, timings: this.timings };
    } finally {
      externalSignal?.removeEventListener('abort', onExternalAbort);
      controller.abort();
      if (session) {
        try {
          await this.adapter.leave(context!, session);
          this.log.debug('left cleanly');
        } catch (error) {
          this.log.warn({ err: error }, 'error during leave');
        }
      }
    }
  }

  private consumeSubscriptions(
    session: SignalingSession,
    specs: SubscriptionSpec[],
    signal: AbortSignal,
    start: number
  ): void {
    for (const spec of specs) {
      void this.pump(session, spec, signal, start);
    }
  }

  private async pump(
    session: SignalingSession,
    spec: SubscriptionSpec,
    signal: AbortSignal,
    start: number
  ): Promise<void> {
    try {
      for await (const data of session.subscribe(spec, signal)) {
        this.state.update(spec.operationName, data);
        if (this.timings.firstSubscriptionDataMs === undefined) {
          this.timings.firstSubscriptionDataMs = performance.now() - start;
        }
      }
    } catch (error) {
      if (!signal.aborted) {
        this.log.warn({ err: error, op: spec.operationName }, 'subscription ended with error');
      }
    }
  }
}
