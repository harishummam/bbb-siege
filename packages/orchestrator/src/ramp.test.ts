import { describe, expect, it } from 'vitest';
import { computeLaunchSchedule } from './ramp.js';
import type { RampStep } from './scenario.js';

describe('computeLaunchSchedule', () => {
  it('launches the initial cohort at t=0 and holds', () => {
    const ramp: RampStep[] = [
      { kind: 'target', atMs: 0, users: 3 },
      { kind: 'hold', holdMs: 5000 },
    ];
    const s = computeLaunchSchedule(ramp);
    expect(s.peak).toBe(3);
    expect(s.launchAtMs).toEqual([0, 0, 0]);
    expect(s.totalMs).toBe(5000);
  });

  it('interpolates launch times across a rising segment', () => {
    const ramp: RampStep[] = [
      { kind: 'target', atMs: 0, users: 10 },
      { kind: 'target', atMs: 60_000, users: 300 },
      { kind: 'hold', holdMs: 300_000 },
    ];
    const s = computeLaunchSchedule(ramp);
    expect(s.peak).toBe(300);
    expect(s.launchAtMs).toHaveLength(300);
    expect(s.totalMs).toBe(360_000);
    // first 10 at t=0
    expect(s.launchAtMs.slice(0, 10)).toEqual(Array(10).fill(0));
    // the 300th bot lands at the end of the ramp segment
    expect(s.launchAtMs[299]).toBeCloseTo(60_000, 5);
    // monotonically non-decreasing
    for (let i = 1; i < s.launchAtMs.length; i++) {
      expect(s.launchAtMs[i]).toBeGreaterThanOrEqual(s.launchAtMs[i - 1]);
    }
  });

  it('treats a decreasing target as a plateau (no un-launch)', () => {
    const ramp: RampStep[] = [
      { kind: 'target', atMs: 0, users: 50 },
      { kind: 'target', atMs: 30_000, users: 20 },
      { kind: 'hold', holdMs: 10_000 },
    ];
    const s = computeLaunchSchedule(ramp);
    expect(s.peak).toBe(50);
    expect(s.totalMs).toBe(40_000);
  });
});
