import { describe, expect, it } from 'vitest';
import { NotImplemented, PROTOCOL_PLACEHOLDER, V30Adapter } from './index.js';

describe('protocol', () => {
  it('exports placeholder', () => {
    expect(PROTOCOL_PLACEHOLDER).toBe('protocol');
  });

  it('v30 adapter throws NotImplemented for methods', async () => {
    const adapter = new V30Adapter();
    await expect(adapter.createMeeting()).rejects.toThrow(NotImplemented);
    await expect(adapter.join()).rejects.toThrow(NotImplemented);
    await expect(adapter.openSignaling()).rejects.toThrow(NotImplemented);
    await expect(adapter.subscribe()).rejects.toThrow(NotImplemented);
    await expect(adapter.mutate()).rejects.toThrow(NotImplemented);
    await expect(adapter.negotiateMedia()).rejects.toThrow(NotImplemented);
    await expect(adapter.leave()).rejects.toThrow(NotImplemented);
    await expect(adapter.detectVersion()).rejects.toThrow(NotImplemented);
    await expect(adapter.detectMediaStack()).rejects.toThrow(NotImplemented);
  });
});
