import type { Plan, WorkoutLog } from '@/lib/types';
import type { RecInput } from '@/lib/queries';
import { flattenSets } from '@/lib/stats';
import { e1rm } from '@/lib/e1rm';
import { currentProgramWeek, planWeekCount } from '@/lib/progression';

// Rule-based coach (Coach phase 1). Reads recent training and surfaces a few
// fitness-only insights. Phase 2 swaps this for an AI edge function over
// versioned drift-signal views; the recommendation shape stays the same.
export function generateRecommendations(logs: WorkoutLog[], plan: Plan | null): RecInput[] {
  const done = logs.filter((l) => l.status === 'done');
  if (done.length === 0) {
    return [
      {
        tldr: 'No sessions logged yet',
        action: 'Log a few workouts to start getting coached.',
        body_md:
          'Once a handful of sessions are in, the coach can read trends in load, effort (RPE), adherence and progress.',
        drift_score: 0,
        confidence: 0.3,
      },
    ];
  }

  const recs: RecInput[] = [];

  // Adherence over the last 10 sessions (completed vs planned sets).
  const recent = done.slice(0, 10);
  let total = 0;
  let completed = 0;
  for (const l of recent) {
    for (const s of flattenSets(l)) {
      total += 1;
      if (s.completed) completed += 1;
    }
  }
  const adherence = total ? completed / total : 1;
  if (total >= 10 && adherence < 0.7) {
    recs.push({
      tldr: `Adherence is ${Math.round(adherence * 100)}% lately`,
      action: 'Trim a set or two per movement, or add a recovery day.',
      body_md: `Across your last ${recent.length} sessions you completed ${completed} of ${total} planned sets. Repeatedly dropping sets usually means fatigue is outrunning recovery — pull volume back for a week and let it rebound.`,
      drift_score: Number((1 - adherence).toFixed(2)),
      confidence: 0.6,
    });
  }

  // RPE creep: average effort of the last 5 vs the prior 5 sessions.
  const avgRpe = (ls: WorkoutLog[]) => {
    const v = ls.flatMap((l) =>
      flattenSets(l)
        .map((s) => s.rpe)
        .filter((r): r is number => r != null),
    );
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const recentRpe = avgRpe(done.slice(0, 5));
  const priorRpe = avgRpe(done.slice(5, 10));
  if (recentRpe != null && priorRpe != null && recentRpe - priorRpe >= 0.5) {
    recs.push({
      tldr: `Effort is trending up (RPE ${priorRpe.toFixed(1)} → ${recentRpe.toFixed(1)})`,
      action: 'Insert a lighter day, or cap top sets around RPE 8.',
      body_md: `Average RPE has climbed from ${priorRpe.toFixed(1)} to ${recentRpe.toFixed(1)} at similar loads. Rising effort for the same work is an early fatigue signal — a deliberate lighter day tends to pay it back.`,
      drift_score: Number(Math.min(1, (recentRpe - priorRpe) / 2).toFixed(2)),
      confidence: 0.55,
    });
  }

  // e1RM plateau on the most-logged movement (first half vs second half).
  const byMove = new Map<string, number[]>();
  for (const l of [...done].reverse()) {
    const best = new Map<string, number>();
    for (const s of flattenSets(l)) {
      if (s.weight == null || s.reps == null) continue;
      const est = e1rm(s.weight, s.reps);
      if (est != null) best.set(s.movement, Math.max(best.get(s.movement) ?? 0, est));
    }
    for (const [m, e] of best) byMove.set(m, [...(byMove.get(m) ?? []), e]);
  }
  let topMove: string | null = null;
  let topPts: number[] = [];
  for (const [m, pts] of byMove) if (pts.length > topPts.length) ((topMove = m), (topPts = pts));
  if (topMove && topPts.length >= 4) {
    const mid = Math.floor(topPts.length / 2);
    const avg = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
    if (avg(topPts.slice(mid)) - avg(topPts.slice(0, mid)) <= 0) {
      recs.push({
        tldr: `${topMove} has plateaued`,
        action: 'Change the stimulus — new rep range, tempo, or a back-off set.',
        body_md: `Estimated 1RM on ${topMove} has been flat-to-down across ${topPts.length} logged sessions. Plateaus respond to a changed stimulus more than to simply pushing harder.`,
        drift_score: 0.5,
        confidence: 0.5,
      });
    }
  }

  // Deload reminder from the plan's block schedule.
  if (plan) {
    const wk = currentProgramWeek(plan.id, logs, planWeekCount(plan.parsed));
    const block = plan.parsed.blocks.find((b) => wk != null && wk >= b.startWeek && wk <= b.endWeek);
    if (block?.type === 'deload') {
      recs.push({
        tldr: `Week ${wk} is a deload`,
        action: 'Keep the movements but cut volume ~40% and leave reps in reserve.',
        body_md:
          'Your plan schedules a deload this week. The point is to shed fatigue so the next block lands harder — resist the urge to push.',
        drift_score: 0,
        confidence: 0.8,
      });
    }
  }

  if (recs.length === 0) {
    recs.push({
      tldr: 'Training looks dialed in',
      action: 'Stay the course — consistency is doing the work.',
      body_md:
        'No drift in adherence, effort, or progress across your recent sessions. The coach will flag the moment something shifts.',
      drift_score: 0,
      confidence: 0.5,
    });
  }

  return recs;
}
