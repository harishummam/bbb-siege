import http from 'node:http';
import { Counter, Gauge, Histogram, Registry } from 'prom-client';
import { DASHBOARD_HTML } from './dashboard.js';

export type JoinPhase = 'api_join' | 'ws_connect' | 'user_join' | 'first_subscription_data';

type OutcomeInput =
  | { status: 'completed' }
  | { status: 'skipped' }
  | { status: 'failed'; kind: string };

interface ProbeInput {
  browser: string;
  iceConnected: boolean;
  rttMs?: number;
  jitterMs?: number;
  turnRelayUsed?: boolean;
}

const DEFAULT_PORT = 9095;

export class SiegeMetrics {
  readonly registry: Registry;
  private readonly joinPhase: Histogram<'phase'>;
  private readonly outcomes: Counter<'result' | 'kind'>;
  private readonly activeBots: Gauge;
  private readonly rateLimited: Counter;
  private readonly probeOutcomes: Counter<'browser' | 'ice'>;
  private readonly probeRtt: Gauge<'browser'>;
  private readonly probeJitter: Gauge<'browser'>;
  private readonly probeTurnRelay: Counter<'browser'>;

  constructor(prefix = 'bbb_siege') {
    this.registry = new Registry();
    this.joinPhase = new Histogram({
      name: `${prefix}_join_phase_duration_seconds`,
      help: 'Join phase durations in seconds, labelled by phase',
      labelNames: ['phase'],
      buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 4, 8, 16],
      registers: [this.registry],
    });
    this.outcomes = new Counter({
      name: `${prefix}_bot_outcomes_total`,
      help: 'Bot run outcomes by result and (for failures) error kind',
      labelNames: ['result', 'kind'],
      registers: [this.registry],
    });
    this.activeBots = new Gauge({
      name: `${prefix}_active_bots`,
      help: 'Currently running bots',
      registers: [this.registry],
    });
    this.rateLimited = new Counter({
      name: `${prefix}_rate_limited_total`,
      help: 'Bot outcomes rejected by server rate limiting',
      registers: [this.registry],
    });
    this.probeOutcomes = new Counter({
      name: `${prefix}_probe_outcomes_total`,
      help: 'Browser probe outcomes by browser and ICE result',
      labelNames: ['browser', 'ice'],
      registers: [this.registry],
    });
    this.probeRtt = new Gauge({
      name: `${prefix}_probe_rtt_ms`,
      help: 'Latest browser probe media round-trip time (ms) by browser',
      labelNames: ['browser'],
      registers: [this.registry],
    });
    this.probeJitter = new Gauge({
      name: `${prefix}_probe_jitter_ms`,
      help: 'Latest browser probe audio jitter (ms) by browser',
      labelNames: ['browser'],
      registers: [this.registry],
    });
    this.probeTurnRelay = new Counter({
      name: `${prefix}_probe_turn_relay_total`,
      help: 'Browser probes that used a TURN relay, by browser',
      labelNames: ['browser'],
      registers: [this.registry],
    });
  }

  recordProbe(probe: ProbeInput): void {
    this.probeOutcomes.labels(probe.browser, probe.iceConnected ? 'connected' : 'failed').inc();
    if (probe.rttMs !== undefined) this.probeRtt.labels(probe.browser).set(probe.rttMs);
    if (probe.jitterMs !== undefined) this.probeJitter.labels(probe.browser).set(probe.jitterMs);
    if (probe.turnRelayUsed) this.probeTurnRelay.labels(probe.browser).inc();
  }

  botStarted(): void {
    this.activeBots.inc();
  }

  botStopped(): void {
    this.activeBots.dec();
  }

  recordJoinPhase(phase: JoinPhase, ms: number): void {
    this.joinPhase.labels(phase).observe(ms / 1000);
  }

  recordOutcome(outcome: OutcomeInput): void {
    if (outcome.status === 'completed') {
      this.outcomes.labels('completed', '').inc();
    } else if (outcome.status === 'skipped') {
      this.outcomes.labels('skipped', '').inc();
    } else {
      this.outcomes.labels('failed', outcome.kind).inc();
      if (outcome.kind === 'RateLimited') this.rateLimited.inc();
    }
  }

  metricsText(): Promise<string> {
    return this.registry.metrics();
  }

  get contentType(): string {
    return this.registry.contentType;
  }
}

export interface LogEntry {
  seq: number;
  line: string;
}

export class LogBuffer {
  private entries: LogEntry[] = [];
  private counter = 0;

  constructor(private readonly capacity = 2000) {}

  push(line: string): void {
    this.counter += 1;
    this.entries.push({ seq: this.counter, line });
    if (this.entries.length > this.capacity) {
      this.entries.splice(0, this.entries.length - this.capacity);
    }
  }

  since(after: number): LogEntry[] {
    if (after <= 0) return this.entries.slice(-400);
    return this.entries.filter((entry) => entry.seq > after);
  }

  get lastSeq(): number {
    return this.counter;
  }
}

export interface MetricsServer {
  port: number;
  close(): Promise<void>;
}

export interface MetricsServerOptions {
  logBuffer?: LogBuffer;
}

export function startMetricsServer(
  metrics: SiegeMetrics,
  port = DEFAULT_PORT,
  options: MetricsServerOptions = {}
): Promise<MetricsServer> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.method === 'GET' && (req.url === '/' || req.url === '/dashboard')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(DASHBOARD_HTML);
        return;
      }
      if (req.method === 'GET' && req.url && req.url.startsWith('/logs')) {
        const after = Number.parseInt(new URL(req.url, 'http://localhost').searchParams.get('after') ?? '0', 10) || 0;
        const buffer = options.logBuffer;
        const lines = buffer ? buffer.since(after).map((entry) => entry.line) : [];
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ nextSeq: buffer ? buffer.lastSeq : 0, lines }));
        return;
      }
      if (req.method === 'GET' && req.url === '/metrics') {
        metrics
          .metricsText()
          .then((text) => {
            res.writeHead(200, { 'Content-Type': metrics.contentType });
            res.end(text);
          })
          .catch((error: unknown) => {
            res.writeHead(500);
            res.end(String(error));
          });
        return;
      }
      res.writeHead(404);
      res.end('not found');
    });
    server.on('error', reject);
    server.listen(port, () => {
      const address = server.address();
      const boundPort = typeof address === 'object' && address ? address.port : port;
      resolve({
        port: boundPort,
        close: () =>
          new Promise((done) => {
            server.close(() => done());
            server.closeAllConnections?.();
          }),
      });
    });
  });
}
