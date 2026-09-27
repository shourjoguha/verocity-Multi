import { useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { getAllLogs, getAllPlans, getMovements, getUserStats } from '@/lib/queries';
import { useAuthedQuery } from '@/lib/useAuthedQuery';
import { normalizeMovementName, type OverrideMap } from '@/lib/movementTaxonomy';
import {
  buildReview,
  effortHeadline,
  frequencyHeadline,
  goalsHeadline,
  staplesHeadline,
  volumeHeadline,
  type Review,
  type ReviewPeriod,
  type StapleSet,
} from '@/lib/review';
import { formatRound } from '@/lib/format';
import { ACTIVITY_TAGS, LOAD_EQUIVALENCE, RPE_LADDER } from '@/app.config';
import { Delta, EmptyState, LoadingScreen, SectionHeader, StatCard } from '@/components/ui/primitives';
import SegmentedTabs from '@/components/ui/SegmentedTabs';
import { ECHO_APP_TITLE, EchoText } from '@/components/EchoText';
import { Item, PageStagger } from '@/components/anim';
import { PlanAdherenceSection } from '@/components/PlanAdherence';

// /app/review — a look back over one period: all time, the last 13 weeks, or
// one plan's life. Everything on it is measured by lib/review.ts from the logs;
// each section is one headline over one chart, and nothing here is prose that a
// number does not back.

const PERIOD_TABS = [
  { key: 'all', label: 'All time' },
  { key: 'quarter', label: 'Quarter' },
  { key: 'plan', label: 'Plan' },
];

// Hours by kind of session. Colour is data here (activity identity), and each
// segment is also labelled with its hours below the bar. Unclassified time has
// no identity to show, so it takes the monochrome chrome grey instead.
const LENSES = [
  { key: 'strength', label: 'Strength', color: ACTIVITY_TAGS.strength.color },
  { key: 'cardio', label: 'Cardio', color: ACTIVITY_TAGS.endurance.color },
  { key: 'mobility', label: 'Mobility', color: ACTIVITY_TAGS.mobility.color },
  { key: 'other', label: 'Other', color: undefined },
] as const;

const pct = (n: number) => `${Math.round(n * 100)}%`;
const one = (n: number) => formatRound(n, 1);
const shortDate = (d: string) =>
  new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

export default function ReviewView() {
  const { data, loading } = useAuthedQuery(
    async () => {
      const [logs, plans, stats, movements] = await Promise.all([
        getAllLogs(supabase),
        getAllPlans(supabase),
        getUserStats(supabase),
        getMovements(supabase),
      ]);
      const overrides: OverrideMap = {};
      for (const m of movements) if (m.taxonomy) overrides[normalizeMovementName(m.name)] = m.taxonomy;
      return { logs, plans, stats, overrides };
    },
    { key: 'review:data' },
  );

  const [kind, setKind] = useState<ReviewPeriod['kind']>('all');
  const [planId, setPlanId] = useState<string | null>(null);

  // Newest plan first; the picker defaults to the most recent one.
  const plans = useMemo(
    () => [...(data?.plans ?? [])].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)),
    [data],
  );
  const chosenPlan = planId ?? plans[0]?.id ?? null;
  const period: ReviewPeriod | null =
    kind === 'plan' ? (chosenPlan ? { kind: 'plan', planId: chosenPlan } : null) : { kind };

  const review = useMemo(
    () => (data && period ? buildReview(period, data) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, kind, chosenPlan],
  );

  if (loading) return <LoadingScreen />;

  return (
    <PageStagger className="mx-auto max-w-3xl px-4 pb-10 pt-5 sm:px-6">
      <Item>
        <a href="/app/plan" className="mb-1 flex min-h-11 w-fit items-center t-control text-muted hover:text-fg">
          ← Plan
        </a>
        <EchoText text="REVIEW" as="h1" className={`mb-4 ${ECHO_APP_TITLE}`} />
      </Item>

      <Item>
        <div className="mb-6 flex flex-col gap-2">
          <SegmentedTabs
            tabs={PERIOD_TABS}
            active={kind}
            onChange={(k) => setKind(k as ReviewPeriod['kind'])}
            ariaLabel="Review period"
          />
          {kind === 'plan' && plans.length > 0 ? (
            <select
              value={chosenPlan ?? ''}
              onChange={(e) => setPlanId(e.target.value)}
              aria-label="Plan to review"
              className="min-h-11 w-full rounded-control border border-border bg-surface px-3 text-base text-fg outline-none focus:border-subtle"
            >
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.is_active ? ' (active)' : ''}
                </option>
              ))}
            </select>
          ) : null}
        </div>
      </Item>

      {review ? (
        <ReviewBody review={review} />
      ) : (
        <Item>
          <EmptyState>{kind === 'plan' && plans.length === 0 ? 'No plans yet.' : 'Nothing logged in this period.'}</EmptyState>
        </Item>
      )}
    </PageStagger>
  );
}

function ReviewBody({ review: r }: { review: Review }) {
  const w = r.window;
  return (
    <>
      <Item>
        <p className="t-label mb-2 text-muted tabular-nums">
          {w.label} · {shortDate(w.start)} – {shortDate(w.end)} · {r.sessions} sessions
        </p>
        <h2 className="mb-4 text-lg leading-snug text-fg">{frequencyHeadline(r)}</h2>
        <div className="mb-8 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatCard label="Lifts / week" value={one(r.liftsPerWeek)} unit={r.plannedLiftsPerWeek ? `of ${r.plannedLiftsPerWeek}` : undefined} />
          <StatCard label="Active days / wk" value={one(r.activeDaysPerWeek)} />
          <StatCard label="Hours" value={formatRound(r.hours)} />
          <StatCard label="Weeks" value={formatRound(w.weeks)} />
        </div>
      </Item>

      <Item>
        <section className="mb-8">
          <SectionHeader>Frequency</SectionHeader>
          <Calendar review={r} />
        </section>
      </Item>

      <Item>
        <section className="mb-8">
          <SectionHeader>Where the time went</SectionHeader>
          {goalsHeadline(r) ? <h3 className="mb-3 text-base leading-snug text-fg">{goalsHeadline(r)}</h3> : null}
          <HoursBar review={r} />
          {r.goals.length >= 2 ? <GoalsChart review={r} /> : null}
          {r.unmeasuredGoals.length ? (
            <p className="mt-2 text-xs text-muted">Not measurable from the log: {r.unmeasuredGoals.join(', ')}.</p>
          ) : null}
        </section>
      </Item>

      <Item>
        <section className="mb-8">
          <SectionHeader>Hard sets per muscle, per week</SectionHeader>
          <h3 className="mb-3 text-base leading-snug text-fg">{volumeHeadline(r)}</h3>
          <VolumeChart review={r} />
        </section>
      </Item>

      {effortHeadline(r) ? (
        <Item>
          <section className="mb-8">
            <SectionHeader>Effort</SectionHeader>
            <h3 className="mb-3 text-base leading-snug text-fg">{effortHeadline(r)}</h3>
            <EffortChart review={r} />
          </section>
        </Item>
      ) : null}

      {r.staples.length ? (
        <Item>
          <section className="mb-8">
            <SectionHeader>Staple lifts</SectionHeader>
            <h3 className="mb-3 text-base leading-snug text-fg">{staplesHeadline(r)}</h3>
            <StaplesTable review={r} />
          </section>
        </Item>
      ) : null}

      {r.adherence ? (
        <Item>
          <section className="mb-8">
            <PlanAdherenceSection adherence={r.adherence} />
          </section>
        </Item>
      ) : null}
    </>
  );
}

// Week rows, Monday first. Each session is a colour (its activity tag) AND a
// letter (its plan day or activity), so the grid still reads without colour.
function Calendar({ review: r }: { review: Review }) {
  return (
    <div className="rounded-card border border-border bg-surface p-3">
      <div className="grid grid-cols-[3.25rem_repeat(7,minmax(0,1fr))_2.75rem] gap-[3px] text-[0.65rem] text-muted">
        <span>Week</span>
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <span key={i} className="text-center">
            {d}
          </span>
        ))}
        <span className="text-right">Lifts·days</span>
        {r.calendar.map((wk) => (
          <CalendarRow key={wk.start} week={wk} />
        ))}
      </div>
      <p className="mt-2 text-[0.65rem] text-muted">
        Colour is the session's activity tag; the letter is its plan day or activity.
      </p>
    </div>
  );
}

function CalendarRow({ week }: { week: Review['calendar'][number] }) {
  return (
    <>
      <span className="self-center tabular-nums">{shortDate(week.start)}</span>
      {week.days.map((d) => (
        <span
          key={d.date}
          title={d.title}
          aria-label={d.colors.length ? d.title : undefined}
          className={`flex aspect-square min-w-0 flex-col overflow-hidden rounded-chip ${
            d.inWindow ? (d.colors.length ? '' : 'bg-fg/[0.05]') : ''
          }`}
        >
          {d.colors.map((c, i) => (
            <span
              key={i}
              className="flex flex-1 items-center justify-center text-[0.6rem] font-bold leading-none text-teal-fg"
              style={{ backgroundColor: c }}
            >
              {d.marks[i]}
            </span>
          ))}
        </span>
      ))}
      <span className="self-center text-right tabular-nums">
        <b className="font-semibold text-fg">{week.lifts}</b>·{week.active}
      </span>
    </>
  );
}

function HoursBar({ review: r }: { review: Review }) {
  const total = r.hours || 1;
  const parts = LENSES.map((l) => ({ ...l, hours: r.hoursByLens[l.key] })).filter((l) => l.hours > 0);
  return (
    <div className="mb-4">
      <div className="flex h-3 w-full overflow-hidden rounded-chip bg-fg/[0.05]" aria-hidden>
        {parts.map((p) => (
          <span
            key={p.key}
            className={p.color ? '' : 'bg-fg/30'}
            style={{ width: `${(p.hours / total) * 100}%`, backgroundColor: p.color }}
          />
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {parts.map((p) => (
          <span key={p.key} className="inline-flex items-center gap-1.5 tabular-nums">
            <span
              aria-hidden
              className={`inline-block h-2 w-2 rounded-chip ${p.color ? '' : 'bg-fg/30'}`}
              style={{ backgroundColor: p.color }}
            />
            {p.label} {formatRound(p.hours)}h · {pct(p.hours / total)}
          </span>
        ))}
      </div>
    </div>
  );
}

// Goal weight (hollow) against share of time (filled), one row per goal the app
// can measure. Scale is fixed to the larger of the two so both dots fit.
function GoalsChart({ review: r }: { review: Review }) {
  const max = Math.max(0.5, ...r.goals.flatMap((g) => [g.intent, g.actual]));
  const x = (v: number) => `${(v / max) * 100}%`;
  return (
    <div className="rounded-card border border-border bg-surface p-3">
      <div className="mb-2 flex flex-wrap gap-x-4 text-[0.65rem] text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-muted bg-surface" /> Goal weight
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-fg" /> Share of time
        </span>
      </div>
      {r.goals.map((g) => {
        const lo = Math.min(g.intent, g.actual);
        const hi = Math.max(g.intent, g.actual);
        return (
          <div key={g.id} className="grid grid-cols-[6rem_1fr_5.5rem] items-center gap-2 py-1.5">
            <span className="truncate text-sm text-subtle">{g.label}</span>
            <div
              className="relative mx-1.5 h-5"
              aria-label={`${g.label}: goal weight ${pct(g.intent)}, share of time ${pct(g.actual)}`}
            >
              <span className="absolute top-1/2 h-0.5 -translate-y-1/2 bg-border" style={{ left: x(lo), width: `calc(${x(hi)} - ${x(lo)})` }} />
              <span
                className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-muted bg-surface"
                style={{ left: x(g.intent) }}
              />
              <span className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-fg" style={{ left: x(g.actual) }} />
            </div>
            <span className="whitespace-nowrap text-right text-xs tabular-nums text-fg">
              {pct(g.actual)}
              <span className="text-muted"> of {pct(g.intent)}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function VolumeChart({ review: r }: { review: Review }) {
  const max = Math.max(r.setFloor * 1.5, ...r.regionSets.map((g) => g.perWeek));
  const x = (v: number) => `${(v / max) * 100}%`;
  return (
    <div className="rounded-card border border-border bg-surface p-3">
      {r.regionSets.map((g) => (
        <div key={g.key} className="grid grid-cols-[6.5rem_1fr] items-center gap-2 py-1">
          <span className="truncate text-sm text-subtle">{g.label}</span>
          <div className="relative mr-10 h-4" aria-label={`${g.label}: ${one(g.perWeek)} hard sets a week`}>
            <span
              className={`absolute inset-y-0.5 left-0 rounded-r-chip ${g.perWeek < r.setFloor ? 'bg-fg/35' : 'bg-fg/80'}`}
              style={{ width: x(g.perWeek) }}
            />
            <span aria-hidden className="absolute -inset-y-0.5 w-px bg-fg" style={{ left: x(r.setFloor) }} />
            <span className="absolute top-0 ml-1.5 text-xs leading-4 tabular-nums text-fg" style={{ left: x(g.perWeek) }}>
              {one(g.perWeek)}
            </span>
          </div>
        </div>
      ))}
      <p className="mt-2 text-[0.65rem] text-muted">
        Line = {r.setFloor} sets a week, the coach's hypertrophy floor. Lighter bars sit under it. A set counts for every
        muscle it meaningfully trains.
      </p>
    </div>
  );
}

function EffortChart({ review: r }: { review: Review }) {
  const e = r.effort;
  return (
    <div className="rounded-card border border-border bg-surface p-3">
      {e.byGroup.map((g) => (
        <div key={g.label} className="grid grid-cols-[6.5rem_1fr] items-center gap-2 py-1">
          <span className="truncate text-sm text-subtle">{g.label}</span>
          <div className="relative mr-24 h-4" aria-label={`${g.label}: ${g.hard} of ${g.total} sets at RPE ${RPE_LADDER.nearFailure} or more`}>
            <span className="absolute inset-y-0.5 left-0 rounded-r-chip bg-fg/80" style={{ width: pct(g.hard / g.total) }} />
            <span className="absolute top-0 ml-1.5 whitespace-nowrap text-xs leading-4 tabular-nums text-fg" style={{ left: pct(g.hard / g.total) }}>
              {pct(g.hard / g.total)} <span className="text-muted">· {g.hard}/{g.total}</span>
            </span>
          </div>
        </div>
      ))}
      <p className="mt-2 text-[0.65rem] text-muted">
        Sets at RPE {RPE_LADDER.nearFailure}+ by plan day, over {e.ratedSessions} rated sessions.
        {e.unratedSessions ? ` ${e.unratedSessions} left the RPE at its default and are not counted.` : ''}
      </p>
    </div>
  );
}

// One row per staple track. Each end shows the set that best represents that
// session; the change is in estimated 1RM (see findStaples), so reps, RPE and
// pause credit all count and a variation is compared only with itself.
function StapleEnd({ set, strong }: { set: StapleSet; strong?: boolean }) {
  return (
    <span className={`block tabular-nums ${strong ? 'text-fg' : 'text-muted'}`}>
      {formatRound(set.weight, 1)}×{set.reps}
      {set.held ? <span title="Paused or tempo — credited as heavier"> {set.held}</span> : null}
      {set.rpe != null ? <span className="block text-[0.65rem] text-muted">@{formatRound(set.rpe, 1)}</span> : null}
    </span>
  );
}

function StaplesTable({ review: r }: { review: Review }) {
  const credited = r.staples.some((s) => s.first.held || s.last.held);
  return (
    <div className="overflow-hidden rounded-card border border-border bg-surface">
      <table className="w-full text-sm">
        <thead>
          <tr className="t-label text-muted">
            <th className="border-b border-border px-3 py-2 text-left font-medium">Lift</th>
            <th className="border-b border-border px-3 py-2 text-right font-medium">First</th>
            <th className="border-b border-border px-3 py-2 text-right font-medium">Latest</th>
            <th className="border-b border-border px-3 py-2 text-right font-medium">1RM</th>
          </tr>
        </thead>
        <tbody>
          {r.staples.map((s) => {
            const change = s.change == null ? null : Math.round(s.change * 100);
            return (
              <tr key={`${s.movement}|${s.variant}`} className="border-b border-border-soft last:border-0 align-top">
                <td className="px-3 py-2 text-fg">
                  {s.movement}
                  {s.variant ? ' (v)' : ''}
                  <span className="block text-[0.65rem] text-muted">
                    {s.sessions} sessions{s.variant ? ` · variation since ${shortDate(s.since)}` : ''}
                    {s.measure === 'reps' ? ' · by reps' : ''}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  <StapleEnd set={s.first} />
                </td>
                <td className="px-3 py-2 text-right">
                  <StapleEnd set={s.last} strong />
                </td>
                <td className="px-3 py-2 text-right">
                  {change == null ? (
                    <span className="text-[0.65rem] text-muted">reps only</span>
                  ) : (
                    <span className="inline-flex items-center">
                      <Delta value={change} />
                      {change !== 0 ? <span className={`text-xs font-bold ${change > 0 ? 'text-up' : 'text-down'}`}>%</span> : null}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="border-t border-border-soft px-3 py-2 text-[0.65rem] text-muted">
        Change in estimated 1RM from weight and reps; RPE counts too when both sessions were rated.
        {credited ? ` (p) paused and (t) tempo sets count ${Math.round((LOAD_EQUIVALENCE.pauseTempo - 1) * 100)}% heavier.` : ''}
        {' '}A (v) variation is only compared with itself; isometric work like Pallof press is compared by reps.
      </p>
    </div>
  );
}
