import type { BbbApiClient, CreateMeetingOptions, CreateMeetingResponse } from '@bbb-siege/api-client';
import type {
  BbbVersion,
  JoinContext,
  JoinOptions,
  MediaStack,
  OpenSignalingOptions,
  SignalingSession,
} from './types.js';

export class NotImplemented extends Error {
  constructor(methodName?: string) {
    super(methodName ? `NotImplemented: ${methodName}` : 'NotImplemented');
    this.name = 'NotImplemented';
  }
}

export interface BbbAdapter {
  detectVersion(client: BbbApiClient, signal?: AbortSignal): Promise<BbbVersion>;
  detectMediaStack(client: BbbApiClient, signal?: AbortSignal): Promise<MediaStack>;
  createMeeting(client: BbbApiClient, options: CreateMeetingOptions): Promise<CreateMeetingResponse>;
  join(client: BbbApiClient, options: JoinOptions): Promise<JoinContext>;
  openSignaling(context: JoinContext, options?: OpenSignalingOptions): Promise<SignalingSession>;
  leave(context: JoinContext, session: SignalingSession): Promise<void>;
}

export class BaseBbbAdapter implements BbbAdapter {
  detectVersion(..._args: unknown[]): Promise<BbbVersion> {
    throw new NotImplemented('detectVersion');
  }

  detectMediaStack(..._args: unknown[]): Promise<MediaStack> {
    throw new NotImplemented('detectMediaStack');
  }

  createMeeting(..._args: unknown[]): Promise<CreateMeetingResponse> {
    throw new NotImplemented('createMeeting');
  }

  join(..._args: unknown[]): Promise<JoinContext> {
    throw new NotImplemented('join');
  }

  openSignaling(..._args: unknown[]): Promise<SignalingSession> {
    throw new NotImplemented('openSignaling');
  }

  leave(..._args: unknown[]): Promise<void> {
    throw new NotImplemented('leave');
  }
}
