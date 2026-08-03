import { describe, expect, it } from 'vitest';
import {
  AuthFailedError,
  BbbApiClient,
  BbbApiError,
  ClientBugError,
  RateLimitedError,
  ServerError,
  TimeoutError,
  buildApiUrl,
  calculateChecksum,
  extractHostname,
  matchesPattern,
  validateTargetHost,
} from './index.js';

describe('index.ts Exports', () => {
  it('exports BbbApiClient class', () => {
    expect(BbbApiClient).toBeDefined();
  });

  it('exports typed errors', () => {
    expect(BbbApiError).toBeDefined();
    expect(RateLimitedError).toBeDefined();
    expect(AuthFailedError).toBeDefined();
    expect(TimeoutError).toBeDefined();
    expect(ServerError).toBeDefined();
    expect(ClientBugError).toBeDefined();
  });

  it('exports helper functions', () => {
    expect(calculateChecksum).toBeDefined();
    expect(buildApiUrl).toBeDefined();
    expect(validateTargetHost).toBeDefined();
    expect(extractHostname).toBeDefined();
    expect(matchesPattern).toBeDefined();
  });
});
