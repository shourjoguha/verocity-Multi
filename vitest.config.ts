import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // PIN THE TIMEZONE. The coach's fuel-timing signal compares a session's
    // LOCAL start hour (`new Date(started_at).getHours()`) against meal times
    // stored as bare wall-clock strings. In a browser both are the athlete's own
    // zone, so that is right in production — but it makes any test over those
    // fixtures a function of the machine's TZ. coach.test.ts passed in
    // Europe/London and Asia/Kolkata and failed in UTC, America/New_York and
    // Australia/Sydney, which is why it was red in CI and green for whoever
    // wrote it. Pinning makes the suite mean the same thing everywhere.
    env: { TZ: 'UTC' },
  },
});
