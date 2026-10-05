import type { IceServer } from '@bbb-siege/protocol';
import type { IceServer as NdcIceServer, RelayType } from 'node-datachannel';

export interface IceServerConversionOptions {
  includeTurn?: boolean;
}

interface ParsedIceUrl {
  scheme: 'stun' | 'stuns' | 'turn' | 'turns';
  host: string;
  port?: number;
  transport?: 'udp' | 'tcp';
}

const ICE_URL = /^(stuns?|turns?):(\[[^\]]+\]|[^:?]+)(?::(\d+))?(?:\?transport=(udp|tcp))?$/i;

export function parseIceUrl(url: string): ParsedIceUrl | undefined {
  const match = ICE_URL.exec(url.trim());
  if (!match) return undefined;
  return {
    scheme: match[1].toLowerCase() as ParsedIceUrl['scheme'],
    host: match[2],
    port: match[3] ? Number(match[3]) : undefined,
    transport: match[4]?.toLowerCase() as ParsedIceUrl['transport'],
  };
}

function relayTypeFor(url: ParsedIceUrl): RelayType {
  if (url.scheme === 'turns') return 'TurnTls';
  return url.transport === 'tcp' ? 'TurnTcp' : 'TurnUdp';
}

export function toNdcIceServers(
  servers: IceServer[],
  options: IceServerConversionOptions = {}
): (string | NdcIceServer)[] {
  const includeTurn = options.includeTurn ?? true;
  const converted: (string | NdcIceServer)[] = [];
  for (const server of servers) {
    const url = parseIceUrl(server.urls);
    if (!url) continue;
    if (url.scheme === 'stun' || url.scheme === 'stuns') {
      converted.push(`stun:${url.host}:${url.port ?? 3478}`);
      continue;
    }
    if (!includeTurn || !server.username || !server.credential) continue;
    converted.push({
      hostname: url.host,
      port: url.port ?? (url.scheme === 'turns' ? 5349 : 3478),
      username: server.username,
      password: server.credential,
      relayType: relayTypeFor(url),
    });
  }
  return converted;
}
