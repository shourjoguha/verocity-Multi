import type { Session, SessionType } from '@/lib/types';

// Short labels for the format badge shown on structured session cards.
const TYPE_SHORT: Record<SessionType, string> = {
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
