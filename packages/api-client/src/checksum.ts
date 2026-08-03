import crypto from 'node:crypto';
import type { HashAlgorithm } from './types.js';

export function calculateChecksum(
  apiCall: string,
  queryString: string,
  secret: string,
  algo: HashAlgorithm = 'sha256'
): string {
  const payload = apiCall + queryString + secret;
  return crypto.createHash(algo).update(payload).digest('hex');
}

export function normalizeBaseUrl(baseUrl: string): string {
  let clean = baseUrl.trim().replace(/\/+$/, '');
  if (!clean.endsWith('/bigbluebutton/api')) {
    if (clean.endsWith('/bigbluebutton')) {
      clean += '/api';
    } else {
      clean += '/bigbluebutton/api';
    }
  }
  return clean;
}

export function buildApiUrl(
  baseUrl: string,
  apiCall: string,
  params: Record<string, unknown>,
  secret: string,
  algo: HashAlgorithm = 'sha256'
): { url: string; endpoint: string; queryString: string; checksum: string } {
  const base = normalizeBaseUrl(baseUrl);
  const endpoint = `${base}/${apiCall}`;

  const searchParams = new URLSearchParams();

  for (const [key, val] of Object.entries(params)) {
    if (val !== undefined && val !== null) {
      if (typeof val === 'boolean') {
        searchParams.append(key, val ? 'true' : 'false');
      } else {
        searchParams.append(key, String(val));
      }
    }
  }

  const queryString = searchParams.toString();
  const checksum = calculateChecksum(apiCall, queryString, secret, algo);

  searchParams.append('checksum', checksum);

  const fullUrl = `${endpoint}?${searchParams.toString()}`;

  return {
    url: fullUrl,
    endpoint,
    queryString,
    checksum,
  };
}
