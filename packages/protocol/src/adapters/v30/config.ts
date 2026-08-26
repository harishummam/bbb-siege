import { ClientBugError, ServerError, normalizeBaseUrl } from '@bbb-siege/api-client';
import type { ClientConfig } from '../../types.js';

export async function discoverClientConfig(
  baseUrl: string,
  signal?: AbortSignal
): Promise<ClientConfig> {
  const url = normalizeBaseUrl(baseUrl);
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    signal,
  });

  if (!res.ok) {
    throw new ServerError(`Client config discovery failed (HTTP ${res.status})`, res.status);
  }

  const text = await res.text();
  if (!text.trimStart().startsWith('{')) {
    throw new ClientBugError(
      'Client config endpoint did not return JSON; expected Content-Type: application/json to trigger the JSON response',
      text.slice(0, 200),
    );
  }

  const body = JSON.parse(text) as { response?: Partial<ClientConfig> };
  const config = body.response;

  if (!config?.graphqlWebsocketUrl) {
    throw new ClientBugError('Client config missing graphqlWebsocketUrl', body);
  }

  return {
    returncode: config.returncode ?? 'SUCCESS',
    version: config.version,
    apiVersion: config.apiVersion,
    bbbVersion: config.bbbVersion,
    graphqlWebsocketUrl: config.graphqlWebsocketUrl,
    graphqlApiUrl: config.graphqlApiUrl,
  };
}

export function parseVersion(raw: string): { major: number; minor: number; patch: number } {
  const match = raw.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return { major: 0, minor: 0, patch: 0 };
  }
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}
