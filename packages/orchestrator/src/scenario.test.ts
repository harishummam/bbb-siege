import { describe, expect, it } from 'vitest';
import { ScenarioError, interpolateEnv, parseScenario } from './scenario.js';

const YAML = `
name: signaling-ramp-300
description: Ramp to 300 signaling users.
target:
  url: \${BBB_URL}
  secret: \${BBB_SECRET}
meeting:
  count: 4
ramp:
  - { at: 0s, users: 10 }
  - { at: 60s, users: \${MAX_USERS:-300} }
  - { hold: 5m }
behaviour:
  chatMessagesPerMinute: 2
  raiseHandProbability: 0.05
slo:
  joinLatencyP95: 8s
`;

const env = { BBB_URL: 'https://test.example.org', BBB_SECRET: 'sekret' } as NodeJS.ProcessEnv;

describe('interpolateEnv', () => {
  it('substitutes vars and applies :- defaults', () => {
    expect(interpolateEnv('a=${FOO:-bar}', {})).toBe('a=bar');
    expect(interpolateEnv('a=${FOO}', { FOO: 'x' } as NodeJS.ProcessEnv)).toBe('a=x');
  });

  it('throws listing missing vars', () => {
    expect(() => interpolateEnv('${MISSING} ${ALSO}', {})).toThrow(/MISSING, ALSO/);
  });
});

describe('parseScenario', () => {
  it('parses durations to ms and applies defaults', () => {
    const scenario = parseScenario(YAML, env);
    expect(scenario.name).toBe('signaling-ramp-300');
    expect(scenario.target.url).toBe('https://test.example.org');
    expect(scenario.target.version).toBe('auto');
    expect(scenario.meeting.count).toBe(4);
    expect(scenario.mix.signaling.weight).toBe(100);
    expect(scenario.slo?.joinLatencyP95).toBe(8000);
  });

  it('compiles the ramp into typed target/hold steps', () => {
    const scenario = parseScenario(YAML, env);
    expect(scenario.ramp).toEqual([
      { kind: 'target', atMs: 0, users: 10 },
      { kind: 'target', atMs: 60_000, users: 300 },
      { kind: 'hold', holdMs: 300_000 },
    ]);
  });

  it('honours MAX_USERS override', () => {
    const scenario = parseScenario(YAML, { ...env, MAX_USERS: '150' } as NodeJS.ProcessEnv);
    const second = scenario.ramp[1];
    expect(second.kind === 'target' && second.users).toBe(150);
  });

  it('rejects an invalid duration', () => {
    const bad = `name: x\ntarget: { url: u, secret: s }\nramp: [ { at: 5x, users: 1 } ]`;
    expect(() => parseScenario(bad, env)).toThrow(ScenarioError);
  });

  it('rejects a scenario with no ramp', () => {
    const bad = `name: x\ntarget: { url: u, secret: s }\nramp: []`;
    expect(() => parseScenario(bad, env)).toThrow(/ramp/);
  });

  it('throws ScenarioError when a required env var is missing', () => {
    expect(() => parseScenario(YAML, { BBB_URL: 'u' } as NodeJS.ProcessEnv)).toThrow(/BBB_SECRET/);
  });
});
