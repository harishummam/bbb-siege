import { describe, expect, it } from 'vitest';
import { API_CLIENT_PLACEHOLDER } from './index.js';

describe('api-client', () => {
  it('exports placeholder', () => {
    expect(API_CLIENT_PLACEHOLDER).toBe('api-client');
  });
});
