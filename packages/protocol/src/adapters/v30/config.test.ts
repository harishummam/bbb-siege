import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { discoverClientConfig, parseVersion } from './config.js';

let server: Server | undefined;

function startConfigServer(body: unknown, status = 200): Promise<string> {
  return new Promise((resolve) => {
    server = createServer((req, res) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server!.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

afterEach(async () => {
  if (server) {
    const active = server;
    await new Promise<void>((resolve) => active.close(() => resolve()));
  }
  server = undefined;
});

describe('discoverClientConfig', () => {
  it('extracts graphqlWebsocketUrl from the response envelope', async () => {
    const base = await startConfigServer({
      response: {
        returncode: 'SUCCESS',
        bbbVersion: '3.0.19',
        graphqlWebsocketUrl: 'wss://example.test/graphql',
        graphqlApiUrl: 'https://example.test/api/rest',
      },
    });

    const config = await discoverClientConfig(base);

    expect(config.graphqlWebsocketUrl).toBe('wss://example.test/graphql');
    expect(config.bbbVersion).toBe('3.0.19');
  });

  it('throws when graphqlWebsocketUrl is missing', async () => {
    const base = await startConfigServer({ response: { returncode: 'SUCCESS' } });
    await expect(discoverClientConfig(base)).rejects.toThrow(/graphqlWebsocketUrl/);
  });

  it('throws ServerError on non-2xx', async () => {
    const base = await startConfigServer({}, 503);
    await expect(discoverClientConfig(base)).rejects.toThrow(/HTTP 503/);
  });
});

describe('parseVersion', () => {
  it('parses a semver-ish string', () => {
    expect(parseVersion('3.0.19')).toEqual({ major: 3, minor: 0, patch: 19 });
  });

  it('falls back to zeros on garbage', () => {
    expect(parseVersion('unknown')).toEqual({ major: 0, minor: 0, patch: 0 });
  });
});
