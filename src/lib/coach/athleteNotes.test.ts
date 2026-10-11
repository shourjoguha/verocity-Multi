import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * "Noted" (migration 0048) is context for the weekly routine, not an input to
 * the engine. If anything under src/lib/coach/** starts reading the athlete's
 * notes, a note becomes a way to change what the coach measures or to quiet a
 * rule — the exact surface CLAUDE.md and governor.ts forbid. The routine turns
 * a note into a governed `coach_rule_notes` row or a brief; that is the only
 * path in.
 */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [p] : [];
  });
}

describe('athlete notes stay outside the engine', () => {
  it('no coach engine source references coach_athlete_notes', () => {
    const offenders = sources(join(process.cwd(), 'src/lib/coach')).filter((p) =>
      /coach_athlete_notes|CoachAthleteNote/.test(readFileSync(p, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
