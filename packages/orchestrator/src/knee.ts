import { percentiles } from './percentiles.js';

export interface JoinSample {
  users: number;
  latencyMs: number;
}

export interface LatencyBand {
  users: number;
  p95Ms: number;
  count: number;
}

export interface KneeResult {
  sloMs?: number;
  bandSize: number;
  kneeUsers: number | null;
  bands: LatencyBand[];
}

export class KneeSampler {
  private active = 0;
  readonly samples: JoinSample[] = [];

  enter(): number {
    this.active += 1;
    return this.active;
  }

  exit(): void {
    this.active -= 1;
  }

  record(users: number, latencyMs: number): void {
    this.samples.push({ users, latencyMs });
  }
}

export function computeKnee(samples: JoinSample[], bandSize = 25, sloMs?: number): KneeResult {
  const grouped = new Map<number, number[]>();
  for (const { users, latencyMs } of samples) {
    const band = Math.max(bandSize, Math.ceil(users / bandSize) * bandSize);
    const bucket = grouped.get(band);
    if (bucket) bucket.push(latencyMs);
    else grouped.set(band, [latencyMs]);
  }

  const bands: LatencyBand[] = [...grouped.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([users, latencies]) => ({ users, p95Ms: percentiles(latencies).p95, count: latencies.length }));

  let kneeUsers: number | null = null;
  if (sloMs !== undefined) {
    const crossed = bands.find((band) => band.p95Ms > sloMs);
    kneeUsers = crossed ? crossed.users : null;
  }

  return { sloMs, bandSize, kneeUsers, bands };
}
