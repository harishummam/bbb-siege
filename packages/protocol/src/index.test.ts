import { describe, expect, it } from 'vitest';
import { PROTOCOL_PLACEHOLDER, V30Adapter } from './index.js';

describe('protocol', () => {
  it('exports placeholder', () => {
    expect(PROTOCOL_PLACEHOLDER).toBe('protocol');
  });

  it('exposes the v30 adapter', () => {
    const adapter = new V30Adapter();
    expect(adapter).toBeInstanceOf(V30Adapter);
    expect(typeof adapter.join).toBe('function');
    expect(typeof adapter.openSignaling).toBe('function');
  });
});
