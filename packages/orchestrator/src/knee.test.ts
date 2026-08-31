import { describe, expect, it } from 'vitest';
import { computeKnee, type JoinSample } from './knee.js';

function band(users: number, latencyMs: number, n: number): JoinSample[] {
  return Array.from({ length: n }, () => ({ users, latencyMs }));
}

describe('computeKnee', () => {
  it('groups samples into bands and finds the first band crossing the SLO', () => {
    const samples: JoinSample[] = [
      ...band(10, 500, 20), // band 25: p95 = 500ms, under SLO
      ...band(60, 3000, 20), // band 75: p95 = 3000ms, under SLO
      ...band(120, 9000, 20), // band 125: p95 = 9000ms, over 8s SLO
    ];
    const knee = computeKnee(samples, 25, 8000);
    expect(knee.kneeUsers).toBe(125);
    expect(knee.bands.map((b) => b.users)).toEqual([25, 75, 125]);
    expect(knee.bands[2].p95Ms).toBe(9000);
  });

  it('returns null knee when no band crosses the SLO', () => {
    const knee = computeKnee(band(50, 1000, 10), 25, 8000);
    expect(knee.kneeUsers).toBeNull();
  });

  it('computes bands but leaves knee null when no SLO is given', () => {
    const knee = computeKnee(band(50, 1000, 10), 25);
    expect(knee.sloMs).toBeUndefined();
    expect(knee.kneeUsers).toBeNull();
    expect(knee.bands).toHaveLength(1);
  });
});
