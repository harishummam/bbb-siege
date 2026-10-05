import {
  AuthFailedError,
  ClientBugError,
  RateLimitedError,
  ServerError,
  TimeoutError,
  type BbbApiError,
} from '@bbb-siege/api-client';
import WebSocket from 'ws';
import type {
  IceServer,
  JoinContext,
  OpenSfuOptions,
  SfuAudioRequest,
  SfuCameraRole,
  SfuCameraShareRequest,
  SfuCameraViewRequest,
  SfuConnection,
} from '../../types.js';

const SFU_PATH = '/bbb-webrtc-sfu';
const STUNS_PATH = '/bigbluebutton/api/stuns';
const DEFAULT_FLOW_TIMEOUT_MS = 20_000;
const DEFAULT_CAMERA_BITRATE = 200;
const INBOX_LIMIT = 200;

export interface SfuMessage {
  id: string;
  [key: string]: unknown;
}

interface StunsResponse {
  stunServers?: { url?: unknown }[];
  turnServers?: { url?: unknown; username?: unknown; password?: unknown }[];
}

function httpUrlFor(path: string, context: JoinContext): URL {
  const url = new URL(path, context.graphqlWebsocketUrl);
  url.protocol = url.protocol === 'ws:' ? 'http:' : 'https:';
  return url;
}

export function sfuUrl(context: JoinContext, override?: string): string {
  const url = new URL(override ?? SFU_PATH, context.graphqlWebsocketUrl);
  url.searchParams.set('sessionToken', context.sessionToken);
  return url.toString();
}

export function cameraStreamId(context: JoinContext, deviceId: string): string {
  return `${context.userId}_${context.clientSessionUUID}_${deviceId}`;
}

function errorForStatus(status: number, what: string): BbbApiError {
  if (status === 401 || status === 403) return new AuthFailedError(`${what} rejected (HTTP ${status})`, undefined, status);
  if (status === 429 || status === 503) return new RateLimitedError(`${what} rate limited (HTTP ${status})`, status);
  return new ServerError(`${what} failed (HTTP ${status})`, status);
}

export function parseIceServers(body: unknown): IceServer[] {
  if (!body || typeof body !== 'object') throw new ClientBugError('stuns response is not an object', body);
  const { stunServers = [], turnServers = [] } = body as StunsResponse;
  const servers: IceServer[] = [];
  for (const stun of stunServers) {
    if (typeof stun.url === 'string') servers.push({ urls: stun.url });
  }
  for (const turn of turnServers) {
    if (typeof turn.url !== 'string') continue;
    servers.push({
      urls: turn.url,
      username: typeof turn.username === 'string' ? turn.username : undefined,
      credential: typeof turn.password === 'string' ? turn.password : undefined,
    });
  }
  return servers;
}

export async function fetchV30IceServers(
  context: JoinContext,
  signal?: AbortSignal,
  timeoutMs = 10_000
): Promise<IceServer[]> {
  const url = httpUrlFor(STUNS_PATH, context);
  url.searchParams.set('sessionToken', context.sessionToken);
  const timeout = AbortSignal.timeout(timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, {
      headers: context.sessionCookie ? { Cookie: context.sessionCookie } : undefined,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (error) {
    if (timeout.aborted) throw new TimeoutError(`stuns request timed out after ${timeoutMs}ms`);
    throw error;
  }
  if (!res.ok) throw errorForStatus(res.status, 'stuns request');
  return parseIceServers(await res.json());
}

function waitForOpen(socket: WebSocket, timeoutMs: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const settle = (error?: unknown): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      socket.off('open', onOpen);
      socket.off('unexpected-response', onUnexpected);
      socket.off('error', onError);
      if (error) {
        socket.on('error', () => undefined);
        socket.terminate();
        reject(error);
      } else {
        resolve();
      }
    };
    const onOpen = (): void => settle();
    const onUnexpected = (_req: unknown, res: { statusCode?: number }): void =>
      settle(errorForStatus(res.statusCode ?? 0, 'SFU websocket upgrade'));
    const onError = (error: Error): void => settle(new ServerError(`SFU websocket error: ${error.message}`));
    const onAbort = (): void => settle(signal?.reason ?? new Error('aborted'));
    const timer = setTimeout(() => settle(new TimeoutError(`SFU websocket open timed out after ${timeoutMs}ms`)), timeoutMs);

    if (signal?.aborted) return onAbort();
    socket.once('open', onOpen);
    socket.once('unexpected-response', onUnexpected);
    socket.once('error', onError);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function openV30Sfu(context: JoinContext, options: OpenSfuOptions = {}): Promise<SfuConnection> {
  const { signal, connectTimeoutMs = 10_000, heartbeatMs = 15_000 } = options;
  const socket = new WebSocket(sfuUrl(context, options.url), {
    headers: context.sessionCookie ? { Cookie: context.sessionCookie } : undefined,
  });
  await waitForOpen(socket, connectTimeoutMs, signal);
  return new V30SfuConnection(socket, heartbeatMs, signal);
}

type Predicate = (message: SfuMessage) => boolean;

interface Waiter {
  matches: Predicate;
  resolve(message: SfuMessage): void;
  reject(error: unknown): void;
}

function isTimeoutReason(reason: unknown): boolean {
  return reason instanceof DOMException && reason.name === 'TimeoutError';
}

class V30SfuConnection implements SfuConnection {
  readonly closed: Promise<void>;
  private readonly inbox: SfuMessage[] = [];
  private readonly waiters = new Set<Waiter>();
  private readonly heartbeat: NodeJS.Timeout;
  private closeError?: ServerError;

  constructor(
    private readonly socket: WebSocket,
    heartbeatMs: number,
    private readonly signal?: AbortSignal
  ) {
    this.closed = new Promise<void>((resolve) => {
      socket.once('close', (code: number, reason: Buffer) => {
        clearInterval(this.heartbeat);
        this.closeError = new ServerError(`SFU socket closed (code ${code})`, undefined, undefined, {
          code,
          reason: reason.toString(),
        });
        for (const waiter of this.waiters) waiter.reject(this.closeError);
        this.waiters.clear();
        resolve();
      });
    });
    socket.on('error', () => undefined);
    socket.on('message', (raw: WebSocket.RawData) => this.onMessage(raw));
    this.heartbeat = setInterval(() => this.trySend({ id: 'ping' }), heartbeatMs);
    this.heartbeat.unref();
    signal?.addEventListener('abort', this.onAbort, { once: true });
  }

  async startAudio(request: SfuAudioRequest): Promise<void> {
    const role = request.listenOnly ? 'passive-sendrecv' : 'sendrecv';
    await this.runFlow('audio', request, async (flowSignal) => {
      this.send({ id: 'start', type: 'audio', role, clientSessionNumber: 1, extension: null, transparentListenOnly: true });
      const response = await this.waitFor((m) => m.type === 'audio' && m.id === 'startResponse', flowSignal);
      const offer = this.acceptedSdp(response, 'audio');
      const answer = await this.race(request.answer(offer), flowSignal);
      this.send({ id: 'subscriberAnswer', type: 'audio', role, sdpOffer: answer });
      await this.waitFor((m) => m.type === 'audio' && m.id === 'webRTCAudioSuccess', flowSignal);
    });
  }

  async startCameraShare(request: SfuCameraShareRequest): Promise<void> {
    const { cameraId } = request;
    const isMine = this.cameraMatcher(cameraId, 'share');
    await this.runFlow(`camera share ${cameraId}`, request, async (flowSignal) => {
      this.send({
        id: 'start',
        type: 'video',
        cameraId,
        role: 'share',
        sdpOffer: request.offerSdp,
        bitrate: request.bitrate ?? DEFAULT_CAMERA_BITRATE,
        record: request.record ?? true,
      });
      const response = await this.waitFor((m) => isMine(m) && m.id === 'startResponse', flowSignal);
      await this.race(request.applyAnswer(this.acceptedSdp(response, 'camera share')), flowSignal);
      await this.waitFor((m) => isMine(m) && m.id === 'playStart', flowSignal);
    });
  }

  async startCameraView(request: SfuCameraViewRequest): Promise<void> {
    const { cameraId } = request;
    const isMine = this.cameraMatcher(cameraId, 'viewer');
    await this.runFlow(`camera view ${cameraId}`, request, async (flowSignal) => {
      this.send({
        id: 'start',
        type: 'video',
        cameraId,
        role: 'viewer',
        sdpOffer: null,
        bitrate: request.bitrate ?? DEFAULT_CAMERA_BITRATE,
        record: request.record ?? true,
      });
      const response = await this.waitFor((m) => isMine(m) && m.id === 'startResponse', flowSignal);
      const answer = await this.race(request.answer(this.acceptedSdp(response, 'camera view')), flowSignal);
      this.send({ id: 'subscriberAnswer', type: 'video', role: 'viewer', cameraId, answer });
      await this.waitFor((m) => isMine(m) && m.id === 'playStart', flowSignal);
    });
  }

  stopCamera(cameraId: string, role: SfuCameraRole): void {
    this.trySend({ id: 'stop', type: 'video', cameraId, role });
  }

  async close(): Promise<void> {
    clearInterval(this.heartbeat);
    this.signal?.removeEventListener('abort', this.onAbort);
    if (this.socket.readyState === WebSocket.CLOSED) return;
    const forceTimer = setTimeout(() => this.socket.terminate(), 2000);
    this.socket.close(1000);
    await this.closed;
    clearTimeout(forceTimer);
  }

  private readonly onAbort = (): void => void this.close();

  private async runFlow(
    label: string,
    options: { signal?: AbortSignal; timeoutMs?: number },
    body: (flowSignal: AbortSignal) => Promise<void>
  ): Promise<void> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_FLOW_TIMEOUT_MS;
    const signals = [AbortSignal.timeout(timeoutMs), options.signal, this.signal].filter(
      (s): s is AbortSignal => s !== undefined
    );
    const flowSignal = AbortSignal.any(signals);
    try {
      await body(flowSignal);
    } catch (error) {
      if (flowSignal.aborted && isTimeoutReason(flowSignal.reason)) {
        const unhandled = this.inbox.map((m) => m.id);
        throw new TimeoutError(
          `SFU ${label} timed out after ${timeoutMs}ms${unhandled.length ? ` (unhandled SFU messages: ${unhandled.join(', ')})` : ''}`
        );
      }
      throw error;
    }
  }

  private cameraMatcher(cameraId: string, role: SfuCameraRole): Predicate {
    return (m) => m.type === 'video' && m.cameraId === cameraId && m.role === role;
  }

  private acceptedSdp(message: SfuMessage, label: string): string {
    if (message.response !== undefined && message.response !== 'accepted') {
      throw new ServerError(`SFU rejected ${label}`, undefined, undefined, message);
    }
    if (typeof message.sdpAnswer !== 'string') {
      throw new ClientBugError(`SFU ${label} startResponse carried no SDP`, message);
    }
    return message.sdpAnswer;
  }

  private onMessage(raw: WebSocket.RawData): void {
    let message: unknown;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!message || typeof message !== 'object' || typeof (message as SfuMessage).id !== 'string') return;
    const sfuMessage = message as SfuMessage;
    if (sfuMessage.id === 'pong') return;
    for (const waiter of this.waiters) {
      if (waiter.matches(sfuMessage)) {
        this.waiters.delete(waiter);
        waiter.resolve(sfuMessage);
        return;
      }
    }
    this.inbox.push(sfuMessage);
    if (this.inbox.length > INBOX_LIMIT) this.inbox.shift();
  }

  private waitFor(matches: Predicate, signal: AbortSignal): Promise<SfuMessage> {
    const index = this.inbox.findIndex(matches);
    if (index >= 0) return Promise.resolve(this.inbox.splice(index, 1)[0]);
    if (this.closeError) return Promise.reject(this.closeError);
    if (signal.aborted) return Promise.reject(signal.reason);
    return new Promise<SfuMessage>((resolve, reject) => {
      const onAbort = (): void => {
        this.waiters.delete(waiter);
        reject(signal.reason);
      };
      const waiter: Waiter = {
        matches,
        resolve: (message) => {
          signal.removeEventListener('abort', onAbort);
          resolve(message);
        },
        reject: (error) => {
          signal.removeEventListener('abort', onAbort);
          reject(error);
        },
      };
      this.waiters.add(waiter);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  private race<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) return Promise.reject(signal.reason);
    return new Promise<T>((resolve, reject) => {
      const onAbort = (): void => reject(signal.reason);
      signal.addEventListener('abort', onAbort, { once: true });
      promise.then(
        (value) => {
          signal.removeEventListener('abort', onAbort);
          resolve(value);
        },
        (error: unknown) => {
          signal.removeEventListener('abort', onAbort);
          reject(error);
        }
      );
    });
  }

  private send(message: SfuMessage): void {
    if (this.socket.readyState !== WebSocket.OPEN) {
      throw this.closeError ?? new ServerError('SFU socket is not open');
    }
    this.socket.send(JSON.stringify(message));
  }

  private trySend(message: SfuMessage): void {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }
}
