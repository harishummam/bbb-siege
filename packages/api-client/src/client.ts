import { buildApiUrl } from './checksum.js';
import {
  AuthFailedError,
  BbbApiError,
  ClientBugError,
  RateLimitedError,
  ServerError,
  TimeoutError,
} from './errors.js';
import { validateTargetHost } from './guardrails.js';
import type {
  BbbApiClientConfig,
  CreateMeetingOptions,
  CreateMeetingResponse,
  EndMeetingOptions,
  EndMeetingResponse,
  GetMeetingInfoOptions,
  GetMeetingInfoResponse,
  GetMeetingsResponse,
  IsMeetingRunningOptions,
  IsMeetingRunningResponse,
  JoinMeetingOptions,
  JoinMeetingResponse,
  MeetingSummary,
  RequestOptions,
  HashAlgorithm,
} from './types.js';
import { parseXmlResponse } from './xml-parser.js';

export class BbbApiClient {
  private readonly config: Required<BbbApiClientConfig>;
  private activeHashAlgorithm: HashAlgorithm;

  constructor(config: BbbApiClientConfig) {
    if (!config.url) {
      throw new ClientBugError('BBB API Client requires a valid url in configuration');
    }
    if (!config.secret) {
      throw new ClientBugError('BBB API Client requires a valid secret in configuration');
    }

    this.config = {
      url: config.url,
      secret: config.secret,
      iUnderstand: config.iUnderstand ?? false,
      testHosts: config.testHosts ?? [],
      defaultTimeoutMs: config.defaultTimeoutMs ?? 10000,
      hashAlgorithm: config.hashAlgorithm ?? 'sha256',
    };

    this.activeHashAlgorithm = this.config.hashAlgorithm;

    // Validate target host against guardrails
    validateTargetHost(this.config.url, {
      iUnderstand: this.config.iUnderstand,
      testHosts: this.config.testHosts,
    });
  }

  public getActiveHashAlgorithm(): HashAlgorithm {
    return this.activeHashAlgorithm;
  }

  public getBaseUrl(): string {
    return this.config.url;
  }

  /**
   * Builds a signed `join` URL for a browser to navigate (redirect=true by default).
   */
  public buildJoinUrl(options: {
    fullName: string;
    meetingID: string;
    password: string;
    userID?: string;
    redirect?: boolean;
    [key: string]: unknown;
  }): string {
    const { url } = buildApiUrl(
      this.config.url,
      'join',
      { ...options, redirect: options.redirect ?? true },
      this.config.secret,
      this.activeHashAlgorithm
    );
    return url;
  }

  private async executeRequest<T>(
    apiCall: string,
    params: Record<string, unknown>,
    algo: HashAlgorithm,
    options?: RequestOptions,
    capture?: { setCookie?: string[] }
  ): Promise<T> {
    const timeoutMs = options?.timeoutMs ?? this.config.defaultTimeoutMs;
    const callerSignal = options?.signal;

    const timeoutController = new AbortController();
    const timer = setTimeout(() => {
      timeoutController.abort(new TimeoutError(`Request timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    let combinedSignal: AbortSignal;
    if (callerSignal) {
      if (typeof AbortSignal.any === 'function') {
        combinedSignal = AbortSignal.any([callerSignal, timeoutController.signal]);
      } else {
        combinedSignal = timeoutController.signal;
        callerSignal.addEventListener(
          'abort',
          () => timeoutController.abort(callerSignal.reason),
          { once: true }
        );
      }
    } else {
      combinedSignal = timeoutController.signal;
    }

    try {
      const { url } = buildApiUrl(
        this.config.url,
        apiCall,
        params,
        this.config.secret,
        algo
      );

      const res = await fetch(url, { signal: combinedSignal });

      if (capture) {
        capture.setCookie = res.headers.getSetCookie?.() ?? [];
      }

      if (res.status === 429 || res.status === 503) {
        throw new RateLimitedError(
          `Rate limited by server (HTTP ${res.status})`,
          res.status
        );
      }

      if (res.status === 401 || res.status === 403) {
        throw new AuthFailedError(
          `HTTP Authentication failed (${res.status})`,
          undefined,
          res.status
        );
      }

      if (!res.ok) {
        throw new ServerError(
          `HTTP request failed with status ${res.status}`,
          res.status
        );
      }

      const xmlText = await res.text();
      return parseXmlResponse<T>(xmlText);
    } catch (err) {
      if (err instanceof BbbApiError) {
        throw err;
      }
      if (combinedSignal.aborted) {
        const reason = combinedSignal.reason;
        if (reason instanceof BbbApiError) {
          throw reason;
        }
        throw new TimeoutError(`Request timed out after ${timeoutMs}ms`);
      }
      throw new ServerError(
        `Network error while executing ${apiCall}: ${(err as Error).message}`,
        undefined,
        undefined,
        err
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private async executeWithChecksumNegotiation<T>(
    apiCall: string,
    params: Record<string, unknown>,
    options?: RequestOptions,
    capture?: { setCookie?: string[] }
  ): Promise<T> {
    const primaryAlgo = this.activeHashAlgorithm;
    try {
      return await this.executeRequest<T>(apiCall, params, primaryAlgo, options, capture);
    } catch (err) {
      if (
        err instanceof AuthFailedError &&
        (err.messageKey === 'checksumError' ||
          err.message.toLowerCase().includes('checksum'))
      ) {
        const fallbackAlgo: HashAlgorithm =
          primaryAlgo === 'sha256' ? 'sha1' : 'sha256';
        try {
          const result = await this.executeRequest<T>(
            apiCall,
            params,
            fallbackAlgo,
            options,
            capture
          );
          // Checksum fallback succeeded — update active algorithm
          this.activeHashAlgorithm = fallbackAlgo;
          return result;
        } catch {
          // If fallback also fails, throw original AuthFailedError
          throw err;
        }
      }
      throw err;
    }
  }

  /**
   * `/bigbluebutton/api/create`
   * Creates a meeting on the BBB server.
   */
  public async create(
    options: CreateMeetingOptions
  ): Promise<CreateMeetingResponse> {
    const { signal, timeoutMs, ...params } = options;
    const raw = await this.executeWithChecksumNegotiation<Record<string, unknown>>(
      'create',
      params,
      { signal, timeoutMs }
    );

    return {
      returncode: raw.returncode as 'SUCCESS' | 'FAILED',
      meetingID: String(raw.meetingID),
      internalMeetingID: String(raw.internalMeetingID),
      parentMeetingID: raw.parentMeetingID ? String(raw.parentMeetingID) : undefined,
      attendeePW: String(raw.attendeePW),
      moderatorPW: String(raw.moderatorPW),
      createTime: Number(raw.createTime),
      voiceBridge: raw.voiceBridge as string | number | undefined,
      dialNumber: raw.dialNumber ? String(raw.dialNumber) : undefined,
      createDate: raw.createDate ? String(raw.createDate) : undefined,
      hasUserJoined: raw.hasUserJoined === true || raw.hasUserJoined === 'true',
      duration: raw.duration ? Number(raw.duration) : undefined,
      hasBeenEndly: raw.hasBeenEndly === true || raw.hasBeenEndly === 'true',
      messageKey: raw.messageKey ? String(raw.messageKey) : undefined,
      message: raw.message ? String(raw.message) : undefined,
    };
  }

  /**
   * `/bigbluebutton/api/join`
   * Joins a meeting with redirect=false, returning sessionToken, authToken, and URL.
   */
  public async join(options: JoinMeetingOptions): Promise<JoinMeetingResponse> {
    const { signal, timeoutMs, ...params } = options;

    // Force redirect=false to receive XML payload with sessionToken
    const joinParams = {
      ...params,
      redirect: false,
    };

    const capture: { setCookie?: string[] } = {};
    const raw = await this.executeWithChecksumNegotiation<Record<string, unknown>>(
      'join',
      joinParams,
      { signal, timeoutMs },
      capture
    );

    return {
      returncode: raw.returncode as 'SUCCESS' | 'FAILED',
      messageKey: raw.messageKey ? String(raw.messageKey) : undefined,
      message: raw.message ? String(raw.message) : undefined,
      meeting_id: String(raw.meeting_id || raw.meetingID || ''),
      user_id: String(raw.user_id || raw.userID || ''),
      auth_token: String(raw.auth_token || raw.authToken || ''),
      session_token: String(raw.session_token || raw.sessionToken || ''),
      guestStatus: raw.guestStatus ? String(raw.guestStatus) : undefined,
      url: String(raw.url || ''),
      sessionCookie: extractSessionCookie(capture.setCookie),
    };
  }

  /**
   * `/bigbluebutton/api/end`
   * Ends an active meeting using moderator password.
   */
  public async end(options: EndMeetingOptions): Promise<EndMeetingResponse> {
    const { signal, timeoutMs, ...params } = options;
    const raw = await this.executeWithChecksumNegotiation<Record<string, unknown>>(
      'end',
      params,
      { signal, timeoutMs }
    );

    return {
      returncode: raw.returncode as 'SUCCESS' | 'FAILED',
      messageKey: raw.messageKey ? String(raw.messageKey) : undefined,
      message: raw.message ? String(raw.message) : undefined,
    };
  }

  /**
   * `/bigbluebutton/api/isMeetingRunning`
   * Checks if a meeting is currently running.
   */
  public async isMeetingRunning(
    options: IsMeetingRunningOptions
  ): Promise<IsMeetingRunningResponse> {
    const { signal, timeoutMs, ...params } = options;
    const raw = await this.executeWithChecksumNegotiation<Record<string, unknown>>(
      'isMeetingRunning',
      params,
      { signal, timeoutMs }
    );

    const isRunning = raw.running === true || raw.running === 'true';

    return {
      returncode: raw.returncode as 'SUCCESS' | 'FAILED',
      running: isRunning,
      messageKey: raw.messageKey ? String(raw.messageKey) : undefined,
      message: raw.message ? String(raw.message) : undefined,
    };
  }

  /**
   * `/bigbluebutton/api/getMeetings`
   * Retrieves list of all active meetings on the BBB server.
   */
  public async getMeetings(options?: RequestOptions): Promise<GetMeetingsResponse> {
    const raw = await this.executeWithChecksumNegotiation<Record<string, unknown>>(
      'getMeetings',
      {},
      options
    );

    let meetingsList: MeetingSummary[] = [];

    if (raw.meetings) {
      const meetingsObj = raw.meetings as {
        meeting?: Record<string, unknown>[] | Record<string, unknown>;
      };
      if (Array.isArray(meetingsObj.meeting)) {
        meetingsList = meetingsObj.meeting.map((m: Record<string, unknown>) => ({
          meetingID: String(m.meetingID),
          internalMeetingID: m.internalMeetingID ? String(m.internalMeetingID) : undefined,
          meetingName: m.meetingName ? String(m.meetingName) : undefined,
          createTime: m.createTime ? Number(m.createTime) : undefined,
          running: m.running === true || m.running === 'true',
          hasUserJoined: m.hasUserJoined === true || m.hasUserJoined === 'true',
          participantCount: m.participantCount ? Number(m.participantCount) : undefined,
          listenerCount: m.listenerCount ? Number(m.listenerCount) : undefined,
          voiceParticipantCount: m.voiceParticipantCount
            ? Number(m.voiceParticipantCount)
            : undefined,
          videoCount: m.videoCount ? Number(m.videoCount) : undefined,
          moderatorCount: m.moderatorCount ? Number(m.moderatorCount) : undefined,
          attendeePW: m.attendeePW ? String(m.attendeePW) : undefined,
          moderatorPW: m.moderatorPW ? String(m.moderatorPW) : undefined,
        }));
      } else if (meetingsObj.meeting && typeof meetingsObj.meeting === 'object') {
        const m = meetingsObj.meeting as Record<string, unknown>;
        meetingsList = [
          {
            meetingID: String(m.meetingID),
            internalMeetingID: m.internalMeetingID ? String(m.internalMeetingID) : undefined,
            meetingName: m.meetingName ? String(m.meetingName) : undefined,
            createTime: m.createTime ? Number(m.createTime) : undefined,
            running: m.running === true || m.running === 'true',
            hasUserJoined: m.hasUserJoined === true || m.hasUserJoined === 'true',
            participantCount: m.participantCount ? Number(m.participantCount) : undefined,
            listenerCount: m.listenerCount ? Number(m.listenerCount) : undefined,
            voiceParticipantCount: m.voiceParticipantCount
              ? Number(m.voiceParticipantCount)
              : undefined,
            videoCount: m.videoCount ? Number(m.videoCount) : undefined,
            moderatorCount: m.moderatorCount ? Number(m.moderatorCount) : undefined,
            attendeePW: m.attendeePW ? String(m.attendeePW) : undefined,
            moderatorPW: m.moderatorPW ? String(m.moderatorPW) : undefined,
          },
        ];
      }
    }

    return {
      returncode: raw.returncode as 'SUCCESS' | 'FAILED',
      meetings: meetingsList,
      messageKey: raw.messageKey ? String(raw.messageKey) : undefined,
      message: raw.message ? String(raw.message) : undefined,
    };
  }

  /**
   * `/bigbluebutton/api/getMeetingInfo`
   * Retrieves detailed status and info for a specific meetingID.
   */
  public async getMeetingInfo(
    options: GetMeetingInfoOptions
  ): Promise<GetMeetingInfoResponse> {
    const { signal, timeoutMs, ...params } = options;
    const raw = await this.executeWithChecksumNegotiation<Record<string, unknown>>(
      'getMeetingInfo',
      params,
      { signal, timeoutMs }
    );

    return {
      returncode: raw.returncode as 'SUCCESS' | 'FAILED',
      meetingID: String(raw.meetingID),
      internalMeetingID: raw.internalMeetingID ? String(raw.internalMeetingID) : undefined,
      meetingName: raw.meetingName ? String(raw.meetingName) : undefined,
      createTime: raw.createTime ? Number(raw.createTime) : undefined,
      running: raw.running === true || raw.running === 'true',
      hasUserJoined: raw.hasUserJoined === true || raw.hasUserJoined === 'true',
      participantCount: raw.participantCount ? Number(raw.participantCount) : undefined,
      listenerCount: raw.listenerCount ? Number(raw.listenerCount) : undefined,
      voiceParticipantCount: raw.voiceParticipantCount
        ? Number(raw.voiceParticipantCount)
        : undefined,
      videoCount: raw.videoCount ? Number(raw.videoCount) : undefined,
      moderatorCount: raw.moderatorCount ? Number(raw.moderatorCount) : undefined,
      attendeePW: raw.attendeePW ? String(raw.attendeePW) : undefined,
      moderatorPW: raw.moderatorPW ? String(raw.moderatorPW) : undefined,
      messageKey: raw.messageKey ? String(raw.messageKey) : undefined,
      message: raw.message ? String(raw.message) : undefined,
    };
  }
}

function extractSessionCookie(setCookie: string[] | undefined): string | undefined {
  const jsession = setCookie?.find((cookie) => cookie.startsWith('JSESSIONID='));
  return jsession?.split(';', 1)[0];
}
