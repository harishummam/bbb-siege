import { describe, expect, it } from 'vitest';
import { BOT_MEDIA_PLACEHOLDER } from './index.js';

describe('bot-media', () => {
  it('exports placeholder', () => {
    expect(BOT_MEDIA_PLACEHOLDER).toBe('bot-media');
  });
});
