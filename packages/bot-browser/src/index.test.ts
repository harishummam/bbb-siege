import { describe, expect, it } from 'vitest';
import { BOT_BROWSER_PLACEHOLDER } from './index.js';

describe('bot-browser', () => {
  it('exports placeholder', () => {
    expect(BOT_BROWSER_PLACEHOLDER).toBe('bot-browser');
  });
});
