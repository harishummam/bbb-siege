export interface Percentiles {
  count: number;
  min: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

const EMPTY: Percentiles = { count: 0, min: 0, p50: 0, p95: 0, p99: 0, max: 0 };

function nearestRank(sorted: number[], percentile: number): number {
  const rank = Math.ceil((percentile / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

export function percentiles(values: number[]): Percentiles {
  if (values.length === 0) return { ...EMPTY };
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    min: sorted[0],
    p50: nearestRank(sorted, 50),
    p95: nearestRank(sorted, 95),
    p99: nearestRank(sorted, 99),
    max: sorted[sorted.length - 1],
  };
}
