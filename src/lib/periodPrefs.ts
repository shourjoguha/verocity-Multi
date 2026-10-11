// The training period shared by Body and Stats. Per-device, like the body map
// style (lib/bodyMapPrefs.ts): localStorage plus an event so both tabs, and an
// already-open view, stay in sync without a reload.
import { useEffect, useState } from 'react';
import { DEFAULT_PERIOD, TRAINING_PERIODS, type TrainingPeriodKey } from '@/app.config';

export const PERIOD_STORAGE_KEY = 'verocity:period';
export const PERIOD_EVENT = 'verocity:period-change';

const KEYS: readonly unknown[] = TRAINING_PERIODS.map((p) => p.key);

// Reading localStorage THROWS where site data is blocked — see getStoredBackground.
export function getPeriod(): TrainingPeriodKey {
  if (typeof window === 'undefined') return DEFAULT_PERIOD;
  try {
    const raw = window.localStorage.getItem(PERIOD_STORAGE_KEY);
    return KEYS.includes(raw) ? (raw as TrainingPeriodKey) : DEFAULT_PERIOD;
  } catch {
    return DEFAULT_PERIOD;
  }
}

export function setPeriod(next: TrainingPeriodKey): void {
  try {
    window.localStorage.setItem(PERIOD_STORAGE_KEY, next);
  } catch {
    /* blocked — the event below still updates this page. */
  }
  window.dispatchEvent(new CustomEvent(PERIOD_EVENT, { detail: next }));
}

export function usePeriod(): TrainingPeriodKey {
  const [period, setPeriodState] = useState<TrainingPeriodKey>(DEFAULT_PERIOD);
  useEffect(() => {
    setPeriodState(getPeriod());
    // Prefer the event's detail: when storage is blocked, re-reading it would
    // fall back to the default and the picked period would never apply.
    const on = (e: Event) => {
      const next = (e as CustomEvent<unknown>).detail;
      setPeriodState(KEYS.includes(next) ? (next as TrainingPeriodKey) : getPeriod());
    };
    window.addEventListener(PERIOD_EVENT, on);
    return () => window.removeEventListener(PERIOD_EVENT, on);
  }, []);
  return period;
}
