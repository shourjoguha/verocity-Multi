// Aggregates logged work into per-region / per-modality / per-plane totals.
//
// UNIT: WORKING MINUTES. Tonnage (weight × reps) is deliberately not the
// primary currency — it is exactly zero for Ski-Erg Intervals, Box Jump and
// Side Plank, which is why `sessionVolume` in lib/stats.ts cannot answer this
// question. Minutes are the one unit that spans resistance, endurance,
// plyometric, isometric and mobility work without a per-modality fudge factor
// that nobody could defend when the chart looks wrong.
//
// Tonnage and hard sets still ship as secondary readouts, restricted to
// resistance work, so the numbers reconcile with Stats.
//
// This walks the log itself rather than reusing `flattenSets` because it needs
// `section` and `primaryMetric` for the modality fallback, and widening
// `FlatSet` would touch a type stats.test.ts asserts on.

import {
  LOAD,
  MODALITY_KEYS,
  MUSCLE_REGION_KEYS,
  PLANE_KEYS,
  type ModalityKey,
  type MovementProfile,
  type PlaneKey,
  type RegionKey,
  type RotaryRole,
  type SectionKey,
} from '@/app.config';
import { classifyMovement, type OverrideMap } from '@/lib/movementTaxonomy';
import { isSubroutine } from '@/lib/subroutine';
import type { LogSet, WorkoutLog } from '@/lib/types';

export interface UnmappedMovement {
  name: string;
  minutes: number;
  sessions: number;
}

export interface BodyLoadSummary {
  regionMinutes: Record<RegionKey, number>;
  modalityMinutes: Record<ModalityKey, number>;
  planeMinutes: Record<PlaneKey, number>;
  rotaryMinutes: Record<RotaryRole, number>;
  systemicMinutes: number;
  resistanceSets: Record<RegionKey, number>;
  resistanceTonnage: Record<RegionKey, number>;
  unmapped: UnmappedMovement[];
  totalMinutes: number;
  // classified / (classified + unmapped), 0..1
  coverage: number;
  sessions: number;
}

function zeroed<K extends string>(keys: readonly K[]): Record<K, number> {
  return Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
}

// Minutes of work represented by one set. Only completed sets count —
// DELIBERATELY unlike sessionVolume, which counts every set. A planned-but-not-
// performed set is not work done to a region.
export function setMinutes(set: LogSet): number {
  const a = set.actual;
  if (!a.completed) return 0;
  if (a.time != null) return a.time / 60;
  if (a.reps != null) return (a.reps * LOAD.repSeconds) / 60;
  if (a.distance != null) return a.distance / LOAD.metersPerMinute;
  return LOAD.fallbackSetMinutes;
}

// Modality fallback, used ONLY when the taxonomy is silent on a name. Static
// classification always wins: a Back Squat inside a conditioning circuit is
// still resistance. The taxonomy answers "what kind of movement is this", not
// "how did this session feel" — which is exactly why the session tag is the
// last resort and never overrides.
function inferModality(
  sets: LogSet[],
  primaryMetric: string,
  section: SectionKey,
): ModalityKey | null {
  const done = sets.filter((s) => s.actual.completed);
  const looksEndurance = done.some(
    (s) => (s.actual.time != null || s.actual.distance != null) && s.actual.weight == null,
  );
  if (looksEndurance) return 'endurance';
  if (primaryMetric === 'time' || primaryMetric === 'distance') {
    return section === 'warmup' || section === 'cooldown' ? 'mobility' : 'endurance';
  }
  if (primaryMetric === 'weight') return 'resistance';
  if (section === 'conditioning') return 'endurance';
  if (section === 'warmup' || section === 'cooldown') return 'mobility';
  return null;
}

export function summarizeBodyLoad(
  logs: WorkoutLog[],
  overrides: OverrideMap = {},
): BodyLoadSummary {
  const regionMinutes = zeroed(MUSCLE_REGION_KEYS);
  const modalityMinutes = zeroed(MODALITY_KEYS);
  const planeMinutes = zeroed(PLANE_KEYS);
  const rotaryMinutes = zeroed(['rotational', 'antiRotational'] as const);
  const resistanceSets = zeroed(MUSCLE_REGION_KEYS);
  const resistanceTonnage = zeroed(MUSCLE_REGION_KEYS);

  let systemicMinutes = 0;
  let classifiedMinutes = 0;
  let unmappedMinutes = 0;
  const unmapped = new Map<string, { minutes: number; sessions: Set<string> }>();
  const countedLogs = new Set<string>();

  for (const log of logs) {
    if (log.status !== 'done') continue;
    countedLogs.add(log.id);

    for (const section of log.data?.sections ?? []) {
      for (const group of section.groups ?? []) {
        for (const item of group.items ?? []) {
          if (isSubroutine(item)) continue;

          const minutes = item.sets.reduce((acc, s) => acc + setMinutes(s), 0);
          if (minutes <= 0) continue;

          const c = classifyMovement(item.movement, { overrides });
          const hasRegions = Object.keys(c.profile.regions).length > 0;

          if (!hasRegions) {
            unmappedMinutes += minutes;
            const entry = unmapped.get(item.movement) ?? { minutes: 0, sessions: new Set<string>() };
            entry.minutes += minutes;
            entry.sessions.add(log.id);
            unmapped.set(item.movement, entry);
            continue;
          }

          classifiedMinutes += minutes;

          const profile: MovementProfile = c.profile;
          const modality =
            profile.modality ?? inferModality(item.sets, item.primaryMetric, section.key);

          for (const [region, weight] of Object.entries(profile.regions) as [RegionKey, number][]) {
            regionMinutes[region] += minutes * weight;

            if (modality === 'resistance') {
              for (const s of item.sets) {
                if (!s.actual.completed) continue;
                resistanceSets[region] += weight;
                resistanceTonnage[region] += (s.actual.weight ?? 0) * (s.actual.reps ?? 0) * weight;
              }
            }
          }

          for (const [plane, weight] of Object.entries(profile.planes) as [PlaneKey, number][]) {
            planeMinutes[plane] += minutes * weight;
          }

          if (modality) modalityMinutes[modality] += minutes;
          if (profile.rotary) rotaryMinutes[profile.rotary] += minutes;
          if (profile.systemic) systemicMinutes += minutes;
        }
      }
    }
  }

  const totalMinutes = classifiedMinutes + unmappedMinutes;

  return {
    regionMinutes,
    modalityMinutes,
    planeMinutes,
    rotaryMinutes,
    systemicMinutes,
    resistanceSets,
    resistanceTonnage,
    unmapped: [...unmapped.entries()]
      .map(([name, v]) => ({ name, minutes: v.minutes, sessions: v.sessions.size }))
      .sort((a, b) => b.minutes - a.minutes),
    totalMinutes,
    coverage: totalMinutes > 0 ? classifiedMinutes / totalMinutes : 0,
    sessions: countedLogs.size,
  };
}

// Region intensities normalised 0..1 against the busiest region, for the map.
export function regionIntensities(summary: BodyLoadSummary): Record<RegionKey, number> {
  const max = Math.max(...Object.values(summary.regionMinutes));
  const out = zeroed(MUSCLE_REGION_KEYS);
  if (max <= 0) return out;
  for (const k of MUSCLE_REGION_KEYS) out[k] = summary.regionMinutes[k] / max;
  return out;
}
