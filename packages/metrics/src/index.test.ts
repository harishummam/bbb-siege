import { afterEach, describe, expect, it } from 'vitest';
import { SiegeMetrics, startMetricsServer, type MetricsServer } from './index.js';

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

  it('returns 404 for unknown paths', async () => {
    server = await startMetricsServer(new SiegeMetrics(), 0);
    const res = await fetch(`http://127.0.0.1:${server.port}/nope`);
    expect(res.status).toBe(404);
  });
});
