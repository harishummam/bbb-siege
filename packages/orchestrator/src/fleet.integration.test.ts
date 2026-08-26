import { BbbApiClient } from '@bbb-siege/api-client';
import { V30Adapter } from '@bbb-siege/protocol';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { runFleet } from './fleet.js';

const isIntegration = process.env.BBB_INTEGRATION_TEST === 'true';
const bbbUrl = process.env.BBB_URL;
const bbbSecret = process.env.BBB_SECRET;

describe.skipIf(!isIntegration || !bbbUrl || !bbbSecret)(
  'runFleet live integration',
  () => {
    const logger = pino({ level: 'silent' });

    function client(): BbbApiClient {
      return new BbbApiClient({ url: bbbUrl!, secret: bbbSecret!, iUnderstand: true });
    }

    it('runs a single bot end to end and ends the meeting', async () => {
      const report = await runFleet({
        adapter: new V30Adapter(),
        client: client(),
        botCount: 1,
        meetingCount: 1,
        holdMs: 2000,
        startStaggerMs: 0,
        logger,
      });
      expect(report.completed).toBe(1);
      expect(report.meetingsEnded).toEqual(report.meetingsCreated);
    }, 30_000);

    it('runs 10 bots against one meeting and ends cleanly', async () => {
      const report = await runFleet({
        adapter: new V30Adapter(),
        client: client(),
        botCount: 10,
        meetingCount: 1,
        holdMs: 3000,
        startStaggerMs: 100,
        logger,
      });
      expect(report.completed).toBeGreaterThan(0);
      expect(report.failed + report.completed + report.skipped).toBe(10);
      expect(report.meetingsEnded).toEqual(report.meetingsCreated);
    }, 60_000);
  }
);
