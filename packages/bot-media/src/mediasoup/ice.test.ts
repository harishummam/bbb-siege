import { describe, expect, it } from 'vitest';
import { parseIceUrl, toNdcIceServers } from './ice.js';

const recorded = [
  { urls: 'stun:coturn.example.com' },
  { urls: 'turn:coturn.example.com:5349?transport=tcp', username: '1791270108:w_abc', credential: 'secret' },
  { urls: 'turns:coturn.example.com:5349?transport=tcp', username: '1791270108:w_abc', credential: 'secret' },
];

describe('parseIceUrl', () => {
  it('parses scheme, host, port and transport', () => {
    expect(parseIceUrl('turn:coturn.example.com:5349?transport=tcp')).toEqual({
      scheme: 'turn',
      host: 'coturn.example.com',
      port: 5349,
      transport: 'tcp',
    });
    expect(parseIceUrl('stun:coturn.example.com')).toEqual({ scheme: 'stun', host: 'coturn.example.com' });
    expect(parseIceUrl('https://nope')).toBeUndefined();
  });
});

describe('toNdcIceServers', () => {
  it('maps BBB stuns entries to libdatachannel servers, keeping colon-bearing TURN usernames intact', () => {
    expect(toNdcIceServers(recorded)).toEqual([
      'stun:coturn.example.com:3478',
      { hostname: 'coturn.example.com', port: 5349, username: '1791270108:w_abc', password: 'secret', relayType: 'TurnTcp' },
      { hostname: 'coturn.example.com', port: 5349, username: '1791270108:w_abc', password: 'secret', relayType: 'TurnTls' },
    ]);
  });

  it('can drop TURN servers', () => {
    expect(toNdcIceServers(recorded, { includeTurn: false })).toEqual(['stun:coturn.example.com:3478']);
  });

  it('skips TURN entries without credentials', () => {
    expect(toNdcIceServers([{ urls: 'turn:t.example.com' }])).toEqual([]);
  });
});
