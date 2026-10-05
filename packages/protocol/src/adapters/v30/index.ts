import { randomUUID } from 'node:crypto';
import type { BbbApiClient, CreateMeetingOptions, CreateMeetingResponse } from '@bbb-siege/api-client';
import { ClientBugError } from '@bbb-siege/api-client';
import { BaseBbbAdapter } from '../../adapter.js';
import type {
  BbbVersion,
  IceServer,
  JoinContext,
  JoinOptions,
  MediaStack,
  OpenSfuOptions,
  OpenSignalingOptions,
  SfuConnection,
  SignalingSession,
} from '../../types.js';
import { discoverClientConfig, parseVersion } from './config.js';
import { cameraStreamId, fetchV30IceServers, openV30Sfu } from './sfu.js';
import { openV30Signaling } from './signaling.js';

export class V30Adapter extends BaseBbbAdapter {
  override async detectVersion(client: BbbApiClient, signal?: AbortSignal): Promise<BbbVersion> {
    const config = await discoverClientConfig(client.getBaseUrl(), signal);
    const raw = config.bbbVersion ?? '0.0.0';
    const { major, minor, patch } = parseVersion(raw);
    return { raw, major, minor, patch, tag: `v${major}${minor}` };
  }

  override async detectMediaStack(): Promise<MediaStack> {
    return 'unknown';
  }

  override async createMeeting(
    client: BbbApiClient,
    options: CreateMeetingOptions
  ): Promise<CreateMeetingResponse> {
    return client.create(options);
  }

  override async join(client: BbbApiClient, options: JoinOptions): Promise<JoinContext> {
    const joinResponse = await client.join(options);

    if (joinResponse.returncode !== 'SUCCESS' || !joinResponse.session_token) {
      throw new ClientBugError('Join did not return a session token', joinResponse);
    }

    const config = await discoverClientConfig(client.getBaseUrl(), options.signal);

    return {
      meetingId: joinResponse.meeting_id || options.meetingID,
      userId: joinResponse.user_id,
      sessionToken: joinResponse.session_token,
      authToken: joinResponse.auth_token,
      clientSessionUUID: randomUUID(),
      graphqlWebsocketUrl: config.graphqlWebsocketUrl,
      joinUrl: joinResponse.url,
      sessionCookie: joinResponse.sessionCookie,
    };
  }

  override async openSignaling(
    context: JoinContext,
    options?: OpenSignalingOptions
  ): Promise<SignalingSession> {
    return openV30Signaling(context, options);
  }

  override async leave(_context: JoinContext, session: SignalingSession): Promise<void> {
    await session.close();
  }

  override fetchIceServers(context: JoinContext, signal?: AbortSignal): Promise<IceServer[]> {
    return fetchV30IceServers(context, signal);
  }

  override openSfu(context: JoinContext, options?: OpenSfuOptions): Promise<SfuConnection> {
    return openV30Sfu(context, options);
  }

  override cameraStreamId(context: JoinContext, deviceId: string): string {
    return cameraStreamId(context, deviceId);
  }
}
