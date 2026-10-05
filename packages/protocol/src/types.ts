import type { JoinMeetingOptions } from '@bbb-siege/api-client';

export type MediaStack = 'mediasoup' | 'livekit' | 'unknown';

export interface BbbVersion {
  raw: string;
  major: number;
  minor: number;
  patch: number;
  tag: string;
}

export interface ClientConfig {
  returncode: string;
  version?: string;
  apiVersion?: string;
  bbbVersion?: string;
  graphqlWebsocketUrl: string;
  graphqlApiUrl?: string;
}

export interface JoinContext {
  meetingId: string;
  userId: string;
  sessionToken: string;
  authToken: string;
  clientSessionUUID: string;
  graphqlWebsocketUrl: string;
  joinUrl: string;
  sessionCookie?: string;
}

export type JoinOptions = JoinMeetingOptions;

export interface SubscriptionSpec {
  operationName: string;
  query: string;
  variables?: Record<string, unknown>;
}

export interface MutationSpec {
  operationName: string;
  query: string;
  variables?: Record<string, unknown>;
}

export interface SignalingSession {
  subscribe(spec: SubscriptionSpec, signal?: AbortSignal): AsyncIterable<unknown>;
  mutate(spec: MutationSpec, signal?: AbortSignal): Promise<unknown>;
  close(): Promise<void>;
  readonly closed: Promise<void>;
}

export interface OpenSignalingOptions {
  signal?: AbortSignal;
  connectTimeoutMs?: number;
  isMobile?: boolean;
}

export interface IceServer {
  urls: string;
  username?: string;
  credential?: string;
}

export type SfuCameraRole = 'share' | 'viewer';

export interface SfuFlowOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface SfuAudioRequest extends SfuFlowOptions {
  listenOnly?: boolean;
  answer(offerSdp: string): Promise<string>;
}

export interface SfuCameraShareRequest extends SfuFlowOptions {
  cameraId: string;
  offerSdp: string;
  applyAnswer(answerSdp: string): Promise<void>;
  bitrate?: number;
  record?: boolean;
}

export interface SfuCameraViewRequest extends SfuFlowOptions {
  cameraId: string;
  answer(offerSdp: string): Promise<string>;
  bitrate?: number;
  record?: boolean;
}

export interface SfuConnection {
  startAudio(request: SfuAudioRequest): Promise<void>;
  startCameraShare(request: SfuCameraShareRequest): Promise<void>;
  startCameraView(request: SfuCameraViewRequest): Promise<void>;
  stopCamera(cameraId: string, role: SfuCameraRole): void;
  close(): Promise<void>;
  readonly closed: Promise<void>;
}

export interface OpenSfuOptions {
  signal?: AbortSignal;
  connectTimeoutMs?: number;
  heartbeatMs?: number;
  url?: string;
}
