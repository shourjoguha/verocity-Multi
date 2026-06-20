import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { parseGarminExport } from '@/lib/garmin/parseExport';
import { buildIngestRequest } from '@/lib/garmin/ingest';

// Build a ZIP mirroring the real export's nested-folder + wrapper shapes.
function makeZip(files: Record<string, unknown | string>): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [path, content] of Object.entries(files)) {
    entries[path] = strToU8(typeof content === 'string' ? content : JSON.stringify(content));
  }
  return zipSync(entries);
}

const exportZip = makeZip({
  // Activities come wrapped in `summarizedActivitiesExport`.
  'DI_CONNECT/DI-Connect-Fitness/123_summarizedActivities.json': [
    {
      summarizedActivitiesExport: [
        { activityId: 111, activityType: 'running', startTimeGmt: '2024-09-22 06:30:00', duration: 1830 },
        { activityId: 222, activityType: 'strength_training', startTimeGmt: '2024-09-23 18:00:00', duration: 2400 },
      ],
    },
  ],
  // Daily wellness as a bare array.
  'DI_CONNECT/DI-Connect-Wellness/2024-09-22_UDSFile.json': [
    { calendarDate: '2024-09-22', restingHeartRate: 48, totalSteps: 11200 },
  ],
  // Sleep as a lone object.
  'DI_CONNECT/DI-Connect-Wellness/2024-09-22_sleepData.json': {
    calendarDate: '2024-09-22',
    sleepTimeSeconds: 27000,
    deepSleepSeconds: 6000,
  },
  // Noise that must be skipped: non-JSON, bad JSON, unclassifiable JSON.
  'DI_CONNECT/readme.txt': 'not json',
  'DI_CONNECT/broken.json': '{ this is not valid',
  'DI_CONNECT/user_profile.json': { displayName: 'someone', gender: 'x' },
});

describe('parseGarminExport', () => {
  it('classifies activities, daily, and sleep records by shape', () => {
    const summaries = parseGarminExport(exportZip);
    const byType = summaries.reduce<Record<string, number>>((acc, s) => {
      acc[s.summary_type] = (acc[s.summary_type] ?? 0) + 1;
      return acc;
    }, {});
    expect(byType).toEqual({ activity: 2, daily: 1, sleep: 1 });
  });

  it('unwraps summarizedActivitiesExport and skips unmapped files', () => {
    const summaries = parseGarminExport(exportZip);
    const activities = summaries.filter((s) => s.summary_type === 'activity');
    expect(activities.map((a) => a.payload.activityId)).toEqual([111, 222]);
    // user_profile / readme / broken contributed nothing.
    expect(summaries).toHaveLength(4);
  });

  it('feeds buildIngestRequest end-to-end', () => {
    const req = buildIngestRequest('user-1', 'zip', parseGarminExport(exportZip));
    expect(req.activities).toHaveLength(2);
    expect(req.activities[0].activity.provider_activity_id).toBe('111');
    // Daily + sleep merge onto the one shared date.
    expect(req.health).toHaveLength(1);
    expect(req.health[0].resting_hr).toBe(48);
    expect(req.health[0].sleep_seconds).toBe(27000);
  });

  it('returns nothing for a zip with no recognizable summaries', () => {
    const empty = makeZip({ 'a/b.json': { foo: 'bar' }, 'c.txt': 'x' });
    expect(parseGarminExport(empty)).toEqual([]);
  });
});
