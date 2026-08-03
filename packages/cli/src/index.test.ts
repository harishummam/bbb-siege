import { describe, expect, it } from 'vitest';
import { CLI_PLACEHOLDER } from './index.js';

describe('cli', () => {
  it('exports placeholder', () => {
    expect(CLI_PLACEHOLDER).toBe('cli');
  });
});
