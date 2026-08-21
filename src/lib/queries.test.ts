import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAllLogs, getLogsInRange, getRecentLogs } from '@/lib/queries';

// Minimal thenable stand-in for the PostgREST builder: every filter returns
// itself and records the call, and awaiting it yields an empty result set.
function stubClient() {
  const calls: string[] = [];
  const builder: Record<string, unknown> = {};
  for (const m of ['select', 'gte', 'lte', 'order', 'limit']) {
    builder[m] = () => builder;
  }
  builder.neq = (column: string, value: string) => {
    calls.push(`neq ${column}=${value}`);
    return builder;
  };
  builder.then = (resolve: (v: { data: [] }) => void) => resolve({ data: [] });
  const client = { from: () => builder } as unknown as SupabaseClient;
  return { client, calls };
}

// Discarding a session deletes the row outright, so nothing should be writing
// 'cancelled' any more — but rows cancelled before that change still exist, and
// every list query has to agree about hiding them. getAllLogs was the one that
// did not, which is how a discarded session kept surfacing on /app/you and had
// to be deleted a second time by hand.
describe('log list queries exclude cancelled sessions', () => {
  it.each([
    ['getRecentLogs', (c: SupabaseClient) => getRecentLogs(10, c)],
    ['getLogsInRange', (c: SupabaseClient) => getLogsInRange('2026-01-01', '2026-12-31', c)],
    ['getAllLogs', (c: SupabaseClient) => getAllLogs(c)],
  ])('%s filters status=cancelled', async (_name, run) => {
    const { client, calls } = stubClient();
    await run(client);
    expect(calls).toContain('neq status=cancelled');
  });
});
