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
