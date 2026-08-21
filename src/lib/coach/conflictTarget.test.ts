import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// A schema test, deliberately. The bug it guards against is invisible to every
// other kind: `upsertCoachFindings` type-checks, its unit behaviour is fine, and
// the SQL is valid — it only fails at runtime, against a real Postgres, with
// 42P10. Between 0036 and 0038 that meant every deterministic finding was
// discarded and the UI said only "Check-in failed".
//
// Reading the migration directory is the cheapest place to state the rule, and
// it is the file a future edit would touch.

const DIR = join(process.cwd(), 'supabase', 'migrations');
const sql = readdirSync(DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => ({ name: f, body: readFileSync(join(DIR, f), 'utf8') }));

/** Statements creating the coach's conflict-target index, in migration order. */
function conflictTargetStatements() {
  const out: { name: string; statement: string }[] = [];
  for (const { name, body } of sql) {
    // Split on `;` and keep the ones that create that specific index.
    for (const raw of body.split(';')) {
      const statement = raw.replace(/--[^\n]*/g, '').trim();
      if (!/create\s+unique\s+index/i.test(statement)) continue;
      if (!/recommendations_rule_period_idx/i.test(statement)) continue;
      out.push({ name, statement });
    }
  }
  return out;
}

describe('coach upsert conflict target', () => {
  it('exists', () => {
    expect(conflictTargetStatements().length).toBeGreaterThan(0);
  });

  it('is NOT partial in the migration that currently defines it', () => {
    // PostgREST's on_conflict can only carry a column list. Postgres will not
    // infer a partial index without its predicate, so a `where` clause here
    // breaks every check-in at runtime with 42P10.
    const last = conflictTargetStatements().at(-1)!;
    expect(last.statement.toLowerCase(), `${last.name} re-added a predicate`).not.toMatch(
      /\bwhere\b/,
    );
  });

  it('covers exactly the columns the client names in onConflict', () => {
    const client = readFileSync(join(process.cwd(), 'src', 'lib', 'queries.ts'), 'utf8');
    // Scoped to the coach's own upsert — queries.ts carries three onConflict
    // targets and the first one in the file belongs to user_stats.
    const fn = client.slice(client.indexOf('export async function upsertCoachFindings'));
    const onConflict = fn.match(/onConflict:\s*'([^']+)'/)?.[1];
    expect(onConflict).toBe('owner_user_id,rule_id,period_key');

    const cols = conflictTargetStatements()
      .at(-1)!
      .statement.match(/\(([^)]*)\)\s*$/)?.[1]
      .split(',')
      .map((c) => c.trim());
    expect(cols).toEqual(onConflict!.split(','));
  });
});
