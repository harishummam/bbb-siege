import { describe, expect, it } from 'vitest';
import { ORCHESTRATOR_PLACEHOLDER } from './index.js';

describe('orchestrator', () => {
  it('exports placeholder', () => {
    expect(ORCHESTRATOR_PLACEHOLDER).toBe('orchestrator');
  });
});
