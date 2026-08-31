import { afterEach, describe, expect, it } from 'vitest';
import { LogBuffer, SiegeMetrics, startMetricsServer, type MetricsServer } from './index.js';

let server: MetricsServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe('SiegeMetrics', () => {
  it('records phases and outcomes into the registry', async () => {
    const metrics = new SiegeMetrics();
    metrics.botStarted();
    metrics.recordJoinPhase('api_join', 80);
    metrics.recordJoinPhase('ws_connect', 200);
    metrics.recordOutcome({ status: 'completed' });
    metrics.recordOutcome({ status: 'failed', kind: 'RateLimited' });
    metrics.botStopped();

    const text = await metrics.metricsText();
    expect(text).toContain('bbb_siege_join_phase_duration_seconds');
    expect(text).toContain('bbb_siege_bot_outcomes_total');
    expect(text).toContain('result="completed"');
    expect(text).toContain('kind="RateLimited"');
    expect(text).toContain('bbb_siege_rate_limited_total 1');
    expect(text).toMatch(/bbb_siege_active_bots 0/);
  });

  it('serves metrics over HTTP on /metrics', async () => {
    const metrics = new SiegeMetrics();
    metrics.recordOutcome({ status: 'completed' });
    server = await startMetricsServer(metrics, 0);
    expect(server.port).toBeGreaterThan(0);

    const res = await fetch(`http://127.0.0.1:${server.port}/metrics`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    const body = await res.text();
    expect(body).toContain('bbb_siege_bot_outcomes_total');
  });

  it('serves the live dashboard HTML at /', async () => {
    server = await startMetricsServer(new SiegeMetrics(), 0);
    const res = await fetch(`http://127.0.0.1:${server.port}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const body = await res.text();
    expect(body).toContain('bbb-siege');
    expect(body).toContain("fetch('/metrics'");
  });

  it('serves buffered logs incrementally at /logs', async () => {
    const logBuffer = new LogBuffer();
    logBuffer.push('{"level":30,"msg":"one"}');
    logBuffer.push('{"level":30,"msg":"two"}');
    server = await startMetricsServer(new SiegeMetrics(), 0, { logBuffer });

    const first = (await (await fetch(`http://127.0.0.1:${server.port}/logs?after=0`)).json()) as {
      lines: string[];
      nextSeq: number;
    };
    expect(first.lines).toHaveLength(2);
    expect(first.nextSeq).toBe(2);

    logBuffer.push('{"level":40,"msg":"three"}');
    const next = (await (await fetch(`http://127.0.0.1:${server.port}/logs?after=2`)).json()) as {
      lines: string[];
      nextSeq: number;
    };
    expect(next.lines).toEqual(['{"level":40,"msg":"three"}']);
    expect(next.nextSeq).toBe(3);
  });

  it('returns 404 for unknown paths', async () => {
    server = await startMetricsServer(new SiegeMetrics(), 0);
    const res = await fetch(`http://127.0.0.1:${server.port}/nope`);
    expect(res.status).toBe(404);
  });
});

describe('LogBuffer', () => {
  it('assigns increasing seqs and trims to capacity', () => {
    const buf = new LogBuffer(3);
    for (const l of ['a', 'b', 'c', 'd', 'e']) buf.push(l);
    expect(buf.lastSeq).toBe(5);
    expect(buf.since(0).map((e) => e.line)).toEqual(['c', 'd', 'e']);
    expect(buf.since(4).map((e) => e.line)).toEqual(['e']);
  });
});
