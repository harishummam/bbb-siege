import http from 'node:http';
import { Counter, Gauge, Histogram, Registry } from 'prom-client';

export type JoinPhase = 'api_join' | 'ws_connect' | 'user_join' | 'first_subscription_data';

type OutcomeInput =
  | { status: 'completed' }
  | { status: 'skipped' }
  | { status: 'failed'; kind: string };

const DEFAULT_PORT = 9095;

export class SiegeMetrics {
  readonly registry: Registry;
  private readonly joinPhase: Histogram<'phase'>;
  private readonly outcomes: Counter<'result' | 'kind'>;
  private readonly activeBots: Gauge;
  private readonly rateLimited: Counter;

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

export interface MetricsServer {
  port: number;
  close(): Promise<void>;
}

export function startMetricsServer(metrics: SiegeMetrics, port = DEFAULT_PORT): Promise<MetricsServer> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.method === 'GET' && (req.url === '/metrics' || req.url === '/')) {
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
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}
