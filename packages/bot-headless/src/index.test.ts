import { describe, expect, it } from 'vitest';
import { BOT_HEADLESS_PLACEHOLDER } from './index.js';

describe('bot-headless', () => {
  it('exports placeholder', () => {
    expect(BOT_HEADLESS_PLACEHOLDER).toBe('bot-headless');
  });
});
