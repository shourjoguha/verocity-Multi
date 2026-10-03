import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MOVEMENT_CATEGORIES } from '@/app.config';

// The vocabulary lives twice — the Library dropdown and the movements.category
// CHECK — and a value in only one of them either cannot be saved or cannot be
// chosen. Pin them together.
describe('MOVEMENT_CATEGORIES', () => {
  it('matches the movements.category CHECK constraint', () => {
    const sql = readFileSync('supabase/migrations/0046_movement_category_vocabulary.sql', 'utf8');
    const list = sql.match(/category in \(([^)]*)\)/s)?.[1] ?? '';
    const fromSql = [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
    expect(fromSql).toEqual([...MOVEMENT_CATEGORIES].sort());
  });
});
