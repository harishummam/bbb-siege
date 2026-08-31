import type { RampStep } from './scenario.js';

export interface LaunchSchedule {
  peak: number;
  launchAtMs: number[];
  totalMs: number;
}

export function computeLaunchSchedule(ramp: RampStep[]): LaunchSchedule {
  const launchAtMs: number[] = [];
  let prevT = 0;
  let prevU = 0;
  let launched = 0;

  for (const step of ramp) {
    if (step.kind === 'hold') {
      prevT += step.holdMs;
      continue;
    }

    const atMs = Math.max(step.atMs, prevT);
    if (step.users > launched) {
      for (let level = launched + 1; level <= step.users; level++) {
        const t =
          atMs <= prevT || step.users === prevU
            ? atMs
            : prevT + ((level - prevU) / (step.users - prevU)) * (atMs - prevT);
        launchAtMs.push(t);
      }
      launched = step.users;
    }
    prevT = atMs;
    prevU = launched;
  }

  return { peak: launched, launchAtMs, totalMs: prevT };
}
