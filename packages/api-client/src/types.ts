export type HashAlgorithm = 'sha256' | 'sha1';

export interface BbbApiClientConfig {
  /** Target BBB Server API URL, e.g. https://bbb.example.com/bigbluebutton/api */
  url: string;
  /** BBB Shared Secret */
  secret: string;
  /** Explicit safety escape hatch flag allowing execution against hosts not in BBB_TEST_HOSTS */
  iUnderstand?: boolean;
  /** Allowed hostnames/patterns for test target allowlist override */
  testHosts?: string[];
  /** Default request timeout in milliseconds (default: 10000) */
  defaultTimeoutMs?: number;
  /** Hash algorithm preferred for checksum computation (default: sha256) */
  hashAlgorithm?: HashAlgorithm;
}

export interface RequestOptions {
  /** Optional AbortSignal to cancel the HTTP request */
  signal?: AbortSignal;
  /** Custom timeout in milliseconds for this specific request */
  timeoutMs?: number;
}

export interface CreateMeetingOptions extends RequestOptions {
  meetingID: string;
  name: string;
  attendeePW?: string;
  moderatorPW?: string;
  record?: boolean;
  duration?: number;
  welcome?: string;
  dialNumber?: string;
  voiceBridge?: number | string;
  maxParticipants?: number;
  logoutURL?: string;
  [key: string]: unknown;
}

export interface CreateMeetingResponse {
  returncode: 'SUCCESS' | 'FAILED';
  meetingID: string;
  internalMeetingID: string;
  parentMeetingID?: string;
  attendeePW: string;
  moderatorPW: string;
  createTime: number;
  voiceBridge?: number | string;
  dialNumber?: string;
  createDate?: string;
  hasUserJoined?: boolean;
  duration?: number;
  hasBeenEndly?: boolean;
  messageKey?: string;
  message?: string;
}

export interface JoinMeetingOptions extends RequestOptions {
  fullName: string;
  meetingID: string;
  password: string; // moderator or attendee password
  userID?: string;
  createTime?: number;
  webVoiceConf?: string;
  configToken?: string;
  avatarURL?: string;
  [key: string]: unknown;
}

export interface JoinMeetingResponse {
  returncode: 'SUCCESS' | 'FAILED';
  messageKey?: string;
  message?: string;
  meeting_id: string;
  user_id: string;
  auth_token: string;
  session_token: string;
  guestStatus?: string;
  url: string;
}

export interface EndMeetingOptions extends RequestOptions {
  meetingID: string;
  password: string; // moderator password
}

export interface EndMeetingResponse {
  returncode: 'SUCCESS' | 'FAILED';
  messageKey?: string;
  message?: string;
}

export interface IsMeetingRunningOptions extends RequestOptions {
  meetingID: string;
}

export interface IsMeetingRunningResponse {
  returncode: 'SUCCESS' | 'FAILED';
  running: boolean;
  messageKey?: string;
  message?: string;
}

export interface MeetingSummary {
  meetingID: string;
  internalMeetingID?: string;
  meetingName?: string;
  createTime?: number;
  running?: boolean;
  hasUserJoined?: boolean;
  participantCount?: number;
  listenerCount?: number;
  voiceParticipantCount?: number;
  videoCount?: number;
  moderatorCount?: number;
  attendeePW?: string;
  moderatorPW?: string;
  [key: string]: unknown;
}

export interface GetMeetingsResponse {
  returncode: 'SUCCESS' | 'FAILED';
  meetings: MeetingSummary[];
  messageKey?: string;
  message?: string;
}

export interface GetMeetingInfoOptions extends RequestOptions {
  meetingID: string;
}

export interface GetMeetingInfoResponse {
  returncode: 'SUCCESS' | 'FAILED';
  meetingID: string;
  internalMeetingID?: string;
  meetingName?: string;
  createTime?: number;
  running?: boolean;
  hasUserJoined?: boolean;
  participantCount?: number;
  listenerCount?: number;
  voiceParticipantCount?: number;
  videoCount?: number;
  moderatorCount?: number;
  attendeePW?: string;
  moderatorPW?: string;
  messageKey?: string;
  message?: string;
  [key: string]: unknown;
}
