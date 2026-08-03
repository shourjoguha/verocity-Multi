import type { Session, SessionType } from '@/lib/types';

// Short labels for the format badge shown on structured session cards. Also
// the label source for the session-type filter in SessionsView.
export const TYPE_SHORT: Record<SessionType, string> = {
  AMRAP: 'AMRAP',
  EMOM: 'EMOM',
  FOR_TIME: 'For Time',
  FOR_TOTAL_REPS: 'For Reps',
  FOR_TOTAL_DISTANCE: 'For Dist',
  FOR_LOAD: 'For Load',
  INTERVALS: 'Intervals',
  ROUNDS_FOR_TIME: 'RFT',
  CHIPPER: 'Chipper',
  PARTNER: 'Partner',
  OTHER: 'WOD',
};

function fmtMinsSecs(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return s === 0 ? `${m}:00` : `${m}:${String(s).padStart(2, '0')}`;
}

// Compact format badge: e.g. "AMRAP · 25:00", "8 RFT · Cap 25:00", "EMOM · 20:00".
// Returns null for legacy strength sessions (session_type null) so callers can
// skip the badge entirely.
export function formatSessionMeta(s: Session): string | null {
  if (!s.session_type) return null;
  const label = TYPE_SHORT[s.session_type];

  const parts: string[] = [];
  if (s.rounds && (s.session_type === 'ROUNDS_FOR_TIME' || s.session_type === 'FOR_TIME')) {
    parts.push(`${s.rounds} ${label}`);
  } else {
    parts.push(label);
  }
  if (s.duration_seconds) parts.push(fmtMinsSecs(s.duration_seconds));
  else if (s.time_cap_seconds) parts.push(`Cap ${fmtMinsSecs(s.time_cap_seconds)}`);
  if (s.partner) parts.push('Partner');

  return parts.join(' · ');
}

// A session's items live in `frame.groups[].items` when present, else the
// flat `frame.exercises[]` mirror — `groups` is authoritative per the
// SessionFrame contract in lib/types.ts.
function sessionItems(s: Session) {
  return s.frame.groups?.flatMap((g) => g.items) ?? s.frame.exercises ?? [];
}

// Distinct movement names touched by a session, normalised to lower case for
// matching — movements are free text with no FK, "matched by NORMALISED NAME"
// per the Movement type comment. Used by the movement include/exclude filter.
export function sessionMovementKeys(s: Session): string[] {
  return [...new Set(sessionItems(s).map((i) => i.movement.trim().toLowerCase()).filter(Boolean))];
}

// Every distinct movement name across a list of sessions, keeping the first
// casing seen for display, sorted for a stable picker list.
export function distinctSessionMovements(sessions: Session[]): { key: string; label: string }[] {
  const byKey = new Map<string, string>();
  for (const s of sessions) {
    for (const item of sessionItems(s)) {
      const label = item.movement.trim();
      const key = label.toLowerCase();
      if (key && !byKey.has(key)) byKey.set(key, label);
    }
  }
  return [...byKey.entries()]
    .map(([key, label]) => ({ key, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
