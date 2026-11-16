import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FRIENDS } from '@/app.config';

// The caps in FRIENDS are ENFORCED by the RPCs in migrations 0052 and 0053;
// app.config only tells the UI what they are. The SQL tags each mirrored
// constant with `-- FRIENDS.<key>`. A later migration replaces a function
// wholesale, so only the LATEST definition of each function counts: a cap
// changed on one side fails here instead of shipping a UI that promises what
// the server refuses.
const FILES = ['0052_friends_sharing.sql', '0053_friends_limits.sql'];
const sources = FILES.map((f) => readFileSync(resolve(__dirname, '../../supabase/migrations', f), 'utf8'));
const sql = sources.join('\n');

const latestFunctions = new Map<string, string>();
for (const m of sql.matchAll(/create (?:or replace )?function public\.(\w+)\([\s\S]*?\n\$\$;/g)) {
  latestFunctions.set(m[1], m[0]);
}

describe('FRIENDS caps mirror the live SQL', () => {
  const mirrored = [...latestFunctions.values()].flatMap((body) =>
    [...body.matchAll(/:=\s*(\d+);\s*--\s*FRIENDS\.(\w+)/g)].map((m) => [m[2], Number(m[1])] as const),
  );

  it('tags every numeric cap exactly once', () => {
    expect(mirrored.map(([k]) => k).sort()).toEqual(
      [
        'batchMaxItems',
        'dailySendCap',
        'failedCodeAttemptsPerDay',
        'maxLogPayloadBytes',
        'maxPlanPayloadBytes',
        'pendingRequestCap',
      ].sort(),
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
  it('holds in 0052 and 0053', () => {
    const policies = [...sql.matchAll(/create policy (\w+) on public\.(\w+)([\s\S]*?);/g)];
    for (const [, name, table, body] of policies) {
      if (table === 'friendships') continue;
      expect(body, name).not.toMatch(/friendships/);
    }
  });
});
