import { AuthFailedError, ServerError, TimeoutError } from '@bbb-siege/api-client';
import { createClient, type Client } from 'graphql-ws';
import WebSocket from 'ws';
import type {
  JoinContext,
  MutationSpec,
  OpenSignalingOptions,
  SignalingSession,
  SubscriptionSpec,
} from '../../types.js';

const MIDDLEWARE_REJECT_CODE = 4403;

export async function openV30Signaling(
  context: JoinContext,
  options: OpenSignalingOptions = {}
): Promise<SignalingSession> {
  const { signal, connectTimeoutMs = 15000, isMobile = false } = options;

  let resolveAck!: () => void;
  let rejectAck!: (reason: unknown) => void;
  const acknowledged = new Promise<void>((resolve, reject) => {
    resolveAck = resolve;
    rejectAck = reject;
  });

  let resolveClosed!: () => void;
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });

  const client: Client = createClient({
    url: context.graphqlWebsocketUrl,
    webSocketImpl: WebSocket,
    lazy: false,
    retryAttempts: 0,
    connectionParams: {
      headers: {
        'X-Session-Token': context.sessionToken,
        'X-ClientSessionUUID': context.clientSessionUUID,
        'X-ClientType': 'HTML5',
        'X-ClientIsMobile': isMobile ? 'true' : 'false',
      },
    },
    on: {
      connected: () => resolveAck(),
      error: (err) => rejectAck(err),
      closed: (event) => {
        const code = (event as { code?: number }).code;
        if (code === MIDDLEWARE_REJECT_CODE) {
          rejectAck(new AuthFailedError('GraphQL middleware rejected connection (4403)'));
        }
        resolveClosed();
      },
    },
  });

  const timer = setTimeout(() => {
    rejectAck(new TimeoutError(`Signaling connection timed out after ${connectTimeoutMs}ms`));
  }, connectTimeoutMs);

  const onAbort = (): void => void client.dispose();
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    await acknowledged;
  } catch (err) {
    signal?.removeEventListener('abort', onAbort);
    await client.dispose();
    throw err;
  } finally {
    clearTimeout(timer);
  }

  return {
    closed,
    subscribe(spec: SubscriptionSpec, subSignal?: AbortSignal): AsyncIterable<unknown> {
      return iterateOperation(client, spec, subSignal);
    },
    async mutate(spec: MutationSpec, subSignal?: AbortSignal): Promise<unknown> {
      for await (const result of iterateOperation(client, spec, subSignal)) {
        return result;
      }
      return undefined;
    },
    async close(): Promise<void> {
      signal?.removeEventListener('abort', onAbort);
      await client.dispose();
    },
  };
}

async function* iterateOperation(
  client: Client,
  spec: SubscriptionSpec | MutationSpec,
  signal?: AbortSignal
): AsyncGenerator<unknown> {
  const iterator = client.iterate({
    operationName: spec.operationName,
    query: spec.query,
    variables: spec.variables ?? {},
  });

  const onAbort = (): void => void iterator.return?.();
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    for await (const result of iterator) {
      if (result.errors?.length) {
        throw new ServerError(`GraphQL operation ${spec.operationName} failed`, undefined, undefined, result.errors);
      }
      yield result.data;
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}
