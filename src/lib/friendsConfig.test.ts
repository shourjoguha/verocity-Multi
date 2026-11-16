import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FRIENDS } from '@/app.config';

// The caps in FRIENDS are ENFORCED by the RPCs in migration 0052; app.config
// only tells the UI what they are. The SQL tags each mirrored constant with
// `-- FRIENDS.<key>`, and this reads the file, so a cap changed on one side
// fails here instead of shipping a UI that promises what the server refuses.
const sql = readFileSync(resolve(__dirname, '../../supabase/migrations/0052_friends_sharing.sql'), 'utf8');

describe('FRIENDS caps mirror migration 0052', () => {
  const mirrored = [...sql.matchAll(/:=\s*(\d+);\s*--\s*FRIENDS\.(\w+)/g)].map((m) => [m[2], Number(m[1])] as const);

  it('tags every mirrored cap', () => {
    expect(mirrored.map(([k]) => k).sort()).toEqual(
      ['batchMaxItems', 'dailySendCap', 'maxPayloadBytes', 'pendingRequestCap'].sort(),
    );
  });

  it.each(mirrored)('FRIENDS.%s matches the SQL constant', (key, value) => {
    expect(FRIENDS[key as keyof typeof FRIENDS]).toBe(value);
  });

  it('codeLength matches the friend_codes check constraint', () => {
    expect(sql).toContain(`{${FRIENDS.codeLength}}$'`);
  });
});

// §12.6: friendship is an address book. A policy that names `friendships`
// anywhere outside its own table would be the start of an ambient cross-user
// read, which this feature must never grant.
describe('no RLS policy references friendships', () => {
  it('holds in 0052', () => {
    const policies = [...sql.matchAll(/create policy (\w+) on public\.(\w+)([\s\S]*?);/g)];
    for (const [, name, table, body] of policies) {
      if (table === 'friendships') continue;
      expect(body, name).not.toMatch(/friendships/);
    }
  });
});
