import { describe, expect, it } from 'vitest';
import { METRICS_PLACEHOLDER } from './index.js';

describe('metrics', () => {
  it('exports placeholder', () => {
    expect(METRICS_PLACEHOLDER).toBe('metrics');
  });
});
