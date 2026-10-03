// What Home's Coach tab says: how many findings are live, and how many of
// those arrived since the athlete last opened /app/coach.
//
// The two counts drive different things on purpose. LIVE is the badge — it
// stays while a finding is still true. UNSEEN is the motion — the runner loops
// only while there is something you have not looked at, and stops the moment
// you open Coach. If the loop keyed off live findings instead, a volume gap
// that takes three weeks to close would animate for three weeks, and it would
// be wallpaper inside one.
//
// "Last seen" is per device (localStorage), not a profile column: a new device
// shows every live finding as unseen once. That keeps this a UI-only change;
// syncing it across devices would be a db-change.

import type { Recommendation } from '@/lib/types';

export const COACH_SEEN_STORAGE_KEY = 'verocity:coach-seen-at';

/** Open, or snoozed with the snooze already lapsed — what CoachView lists as open. */
export function isLiveRec(r: Recommendation, now: number): boolean {
  return r.status === 'open' || (r.status === 'snoozed' && r.snooze_until != null && Date.parse(r.snooze_until) <= now);
}

export function coachSignal(
  recs: Recommendation[],
  seenAt: number | null,
  now: number,
): { live: number; unseen: number } {
  const live = recs.filter((r) => isLiveRec(r, now));
  const unseen = seenAt == null ? live.length : live.filter((r) => Date.parse(r.created_at) > seenAt).length;
  return { live: live.length, unseen };
}

// Reading localStorage THROWS where site data is blocked — see getStoredBackground
// in lib/background.ts for the island that went blank over exactly this.
export function getCoachSeenAt(): number | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = Number(window.localStorage.getItem(COACH_SEEN_STORAGE_KEY));
    return Number.isFinite(raw) && raw > 0 ? raw : null;
  } catch {
    return null;
  }
}

export function setCoachSeenAt(at: number): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(COACH_SEEN_STORAGE_KEY, String(at));
  } catch {
    /* blocked — the runner keeps looping on this device, which is the safe side. */
  }
}
