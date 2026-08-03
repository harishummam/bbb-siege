import { describe, expect, it } from 'vitest';
import { BbbApiClient } from './client.js';

const isIntegration = process.env.BBB_INTEGRATION_TEST === 'true';
const bbbUrl = process.env.BBB_URL;
const bbbSecret = process.env.BBB_SECRET;

describe.skipIf(!isIntegration || !bbbUrl || !bbbSecret)(
  'BbbApiClient Live Integration Test Suite',
  () => {
    const testMeetingID = `integration-test-${Date.now()}`;

    it('executes full meeting lifecycle (create -> isRunning -> join -> getMeetingInfo -> end)', async () => {
      const client = new BbbApiClient({
        url: bbbUrl!,
        secret: bbbSecret!,
        iUnderstand: true,
      });

      // 1. Create meeting
      const createRes = await client.create({
        meetingID: testMeetingID,
        name: 'Live Integration Test Meeting',
        attendeePW: 'ap',
        moderatorPW: 'mp',
      });

      expect(createRes.returncode).toBe('SUCCESS');
      expect(createRes.meetingID).toBe(testMeetingID);

      // 2. Check if running
      const runningRes = await client.isMeetingRunning({
        meetingID: testMeetingID,
      });
      expect(runningRes.returncode).toBe('SUCCESS');
      expect(typeof runningRes.running).toBe('boolean');

      // 3. Join with redirect=false
      const joinRes = await client.join({
        fullName: 'Integration Test Bot',
        meetingID: testMeetingID,
        password: 'mp',
      });
      expect(joinRes.returncode).toBe('SUCCESS');
      expect(joinRes.session_token).toBeTruthy();
      expect(joinRes.auth_token).toBeTruthy();
      expect(joinRes.url).toContain('html5client');

      // 4. Get Meeting Info
      const infoRes = await client.getMeetingInfo({
        meetingID: testMeetingID,
      });
      expect(infoRes.returncode).toBe('SUCCESS');
      expect(infoRes.meetingID).toBe(testMeetingID);

      // 5. End Meeting
      const endRes = await client.end({
        meetingID: testMeetingID,
        password: 'mp',
      });
      expect(endRes.returncode).toBe('SUCCESS');
    });
  }
);
