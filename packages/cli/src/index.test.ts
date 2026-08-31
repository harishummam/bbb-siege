import { describe, expect, it } from 'vitest';
import { program } from './index.js';

describe('cli', () => {
  it('exposes a run command', () => {
    const names = program.commands.map((c) => c.name());
    expect(names).toContain('run');
  });

  it('run command declares a scenario argument and metrics-port option', () => {
    const run = program.commands.find((c) => c.name() === 'run');
    expect(run).toBeDefined();
    const optionFlags = run!.options.map((o) => o.long);
    expect(optionFlags).toContain('--metrics-port');
    expect(optionFlags).toContain('--i-understand');
  });
});
