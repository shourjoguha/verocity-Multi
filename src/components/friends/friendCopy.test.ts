import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FRIEND_REQUEST_ERRORS, SEND_ERRORS, friendRequestError, sendError } from './friendCopy';

// No silent failure: every code the RPCs can produce must have its own copy,
// never the "check your connection" fallback, and the lists must be the codes
// the SQL actually produces (the latest definition, in 0053).
const sql = readFileSync(resolve(__dirname, '../../../supabase/migrations/0053_friends_limits.sql'), 'utf8');
const body = (fn: string) => {
  const m = new RegExp(`create (?:or replace )?function public\\.${fn}\\([\\s\\S]*?\\n\\$\\$;`).exec(sql);
  if (!m) throw new Error(`${fn} not in 0053`);
  return m[0];
};
const AUTH = 'not_authenticated'; // raised only with no session; the UI never sends one

describe('send_shared_items error copy', () => {
  it('lists exactly the codes the RPC raises', () => {
    const raised = [...body('send_shared_items').matchAll(/raise exception '([a-z_]+)'/g)].map((m) => m[1]);
    expect([...new Set(raised)].filter((c) => c !== AUTH).sort()).toEqual([...SEND_ERRORS].sort());
  });

  it.each(SEND_ERRORS)('%s has its own copy for logs and plans', (code) => {
    const fallback = sendError('__unknown__');
    expect(sendError(code, { kind: 'log' })).not.toBe(fallback);
    expect(sendError(code, { kind: 'plan' })).not.toBe(fallback);
  });

  it('names the refused items from the detail', () => {
    const describe = (id: string) => ({ a: '3 Jun', b: '4 Jun' })[id] ?? id;
    expect(sendError('payload_too_large', { detail: 'a', describe })).toContain('3 Jun');
    expect(sendError('not_done', { detail: 'a,b', describe })).toContain('3 Jun, 4 Jun');
    expect(sendError('payload_too_large', { kind: 'plan', detail: 'p', describe: () => '"Block A"' })).toContain('"Block A"');
    expect(sendError('daily_cap', { detail: '80' })).toContain('80 more items');
  });
});

describe('request_friend error copy', () => {
  it('lists exactly the codes the RPC returns', () => {
    const returned = [...body('request_friend').matchAll(/'error', '([a-z_]+)'/g)].map((m) => m[1]);
    expect([...new Set(returned)].sort()).toEqual([...FRIEND_REQUEST_ERRORS].sort());
  });

  it.each(FRIEND_REQUEST_ERRORS)('%s has its own copy', (code) => {
    expect(friendRequestError(code)).not.toBe(friendRequestError('__unknown__'));
  });

  it('says try again tomorrow past the limit', () => {
    expect(friendRequestError('too_many_attempts')).toMatch(/tomorrow/);
  });
});
