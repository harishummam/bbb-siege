export type BbbErrorKind =
  | 'RateLimited'
  | 'AuthFailed'
  | 'IceFailed'
  | 'Timeout'
  | 'ServerError'
  | 'ClientBug';

export class BbbApiError extends Error {
  readonly kind: BbbErrorKind;
  readonly statusCode?: number;
  readonly messageKey?: string;
  readonly details?: unknown;

  constructor(
    message: string,
    kind: BbbErrorKind,
    options?: { statusCode?: number; messageKey?: string; details?: unknown }
  ) {
    super(message);
    this.name = 'BbbApiError';
    this.kind = kind;
    this.statusCode = options?.statusCode;
    this.messageKey = options?.messageKey;
    this.details = options?.details;
  }
}

export class RateLimitedError extends BbbApiError {
  constructor(message = 'Rate limit exceeded (HTTP 429/503 or middleware rate limit)', statusCode?: number, details?: unknown) {
    super(message, 'RateLimited', { statusCode, details });
    this.name = 'RateLimitedError';
  }
}

export class AuthFailedError extends BbbApiError {
  constructor(message = 'Authentication failed (checksum mismatch or invalid credentials)', messageKey?: string, statusCode?: number) {
    super(message, 'AuthFailed', { messageKey, statusCode });
    this.name = 'AuthFailedError';
  }
}

export class TimeoutError extends BbbApiError {
  constructor(message = 'API request timed out') {
    super(message, 'Timeout');
    this.name = 'TimeoutError';
  }
}

export class ServerError extends BbbApiError {
  constructor(message: string, statusCode?: number, messageKey?: string, details?: unknown) {
    super(message, 'ServerError', { statusCode, messageKey, details });
    this.name = 'ServerError';
  }
}

export class ClientBugError extends BbbApiError {
  constructor(message: string, details?: unknown) {
    super(message, 'ClientBug', { details });
    this.name = 'ClientBugError';
  }
}
