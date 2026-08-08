// First-run onboarding — the guided takeover a new user lands on straight after
// signup (SignupForm redirects here). It fills the same `user_stats` row that
// Settings' UserStatsPanel edits, one phase at a time, so the AI plan prompt and
// the personalization surfaces start out tuned instead of empty.
//
// Design contract: this is built from the app's own system — .hill-btn chips
// (invert on aria-pressed), EchoText hero, tokens only, CSS-first stagger, the
// non-scrolling app-shell with a pinned nav. Nothing here is required (every
// user_stats column is nullable), so every phase — and the whole flow — skips.
//
// Persistence is a partial upsert per phase (upsertUserStats only SETs the keys
// present), so a user who drops off keeps whatever they had already entered.
// `onboarded_at` is stamped when the flow is finished OR skipped, which is what
// stops the post-signup redirect bringing them back.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  DISCIPLINES,
  EQUIPMENT,
  EXPERIENCE_LEVELS,
  EXPERIENCE_KEYS,
  GENDERS,
  GENDER_KEYS,
  GOALS,
  GOAL_WEIGHT,
  MUSCLE_REGIONS,
  MUSCLE_REGION_KEYS,
  PLAN_LENGTH,
  STATS_LIMITS,
  type DisciplineKey,
  type EquipmentKey,
  type ExperienceKey,
  type GenderKey,
  type GoalKey,
  type RegionKey,
} from '@/app.config';
import { getUserStats, upsertUserStats, type UserStatsInput } from '@/lib/queries';
import { getSession } from '@/lib/auth';
import type { Goal, Injury, UserStats } from '@/lib/types';
import { toast } from '@/lib/toast';
import { EchoText } from '@/components/EchoText';
import SegmentedTabs from '@/components/ui/SegmentedTabs';
import { ProgressBar } from '@/components/onboarding/ProgressBar';

// Step indices. Named so the nav logic and the progress count read clearly and
// don't drift when a phase is inserted.
const STEPS = [
  'welcome',
  'about',
  'rhythm',
  'goals',
  'disciplines',
  'equipment',
  'areas',
  'summary',
  'guide',
] as const;
const SUMMARY = STEPS.indexOf('summary');
const GUIDE = STEPS.indexOf('guide');
const LAST_QUESTION = SUMMARY - 1;

const field =
  'min-h-11 w-full border border-border bg-surface px-3 text-base text-fg outline-none focus:border-fg';
const eyebrow = 't-eyebrow text-subtle';
const heading = 'font-display text-3xl font-semibold leading-[1.06] tracking-[-0.015em] text-fg';
const sub = 'mt-2 max-w-[40ch] text-muted';
const fieldLabel = 'mb-2 mt-6 block t-label text-muted first:mt-0';

interface Draft {
  weight: string;
  height: string;
  birthYear: string;
  gender: GenderKey | '';
  days: number | null;
  experience: ExperienceKey | '';
  planWeeks: number | null;
  goals: GoalKey[];
  disciplines: DisciplineKey[];
  equipment: EquipmentKey[];
  regions: RegionKey[];
  regionNote: string;
}

const EMPTY: Draft = {
  weight: '',
  height: '',
  birthYear: '',
  gender: '',
  days: null,
  experience: '',
  planWeeks: null,
  goals: [],
  disciplines: [],
  equipment: [],
  regions: [],
  regionNote: '',
};

function toDraft(s: UserStats | null): Draft {
  if (!s) return EMPTY;
  const goalIds = s.goals.map((g) => g.id).filter((id): id is GoalKey => id in GOALS);
  return {
    ...EMPTY,
    weight: s.body_weight_kg?.toString() ?? '',
    height: s.height_cm?.toString() ?? '',
    birthYear: s.birth_year?.toString() ?? '',
    gender: s.gender ?? '',
    days: s.days_per_week,
    experience: s.experience ?? '',
    planWeeks: s.preferred_plan_weeks,
    goals: goalIds,
    disciplines: s.disciplines ?? [],
    equipment: s.equipment ?? [],
    regions: (s.injuries ?? [])
      .map((i) => i.region)
      .filter((r): r is RegionKey => r != null),
  };
}

/** Parse a bounded numeric string to a number, or null when blank/out of range. */
function bounded(raw: string, { min, max }: { min: number; max: number }): number | null {
  const n = Number(raw.trim());
  if (raw.trim() === '' || !Number.isFinite(n)) return null;
  return n >= min && n <= max ? n : null;
}

// Ranked goals → Goal[]. Selection order is the rank (see the Goal note in
// types.ts); weight steps down from the top so the first pick outranks the last
// but nothing falls below the neutral default.
function goalsPayload(keys: GoalKey[]): Goal[] {
  return keys.map((k, i) => ({
    id: k,
    label: GOALS[k].label,
    weight: Math.max(GOAL_WEIGHT.default, GOAL_WEIGHT.max - i * 15),
  }));
}

// Selected regions → Injury[]. One row per region, labelled by the region so the
// prompt renders something meaningful; the shared note rides on the first row.
function injuriesPayload(regions: RegionKey[], note: string): Injury[] {
  const trimmed = note.trim();
  return regions.map((r, i) => ({
    id: crypto.randomUUID(),
    region: r,
    label: MUSCLE_REGIONS[r].label,
    ...(i === 0 && trimmed ? { notes: trimmed } : {}),
  }));
}

const planWeekOptions = Array.from(
  { length: PLAN_LENGTH.maxWeeks - PLAN_LENGTH.minWeeks + 1 },
  (_, i) => PLAN_LENGTH.minWeeks + i,
);
const dayOptions = Array.from(
  { length: STATS_LIMITS.daysPerWeek.max - STATS_LIMITS.daysPerWeek.min + 1 },
  (_, i) => STATS_LIMITS.daysPerWeek.min + i,
);

function Chip({
  on,
  onClick,
  children,
  rank,
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
  rank?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`hill-btn inline-flex min-h-11 items-center gap-2 border bg-surface px-4 text-sm ${
        on ? 'border-fg text-fg' : 'border-border text-muted hover:text-fg'
      }`}
    >
      {rank != null ? (
        <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-fg px-1 text-[11px] tabular-nums text-bg">
          {rank}
        </span>
      ) : null}
      {children}
    </button>
  );
}

export function OnboardingView() {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(true);

  const set = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));

  // Guard: no session → login. Already onboarded → the flow is behind them, so
  // the URL should not re-open it. Otherwise seed the draft from any partial row.
  useEffect(() => {
    let active = true;
    (async () => {
      const session = await getSession();
      if (!session) {
        window.location.href = '/login';
        return;
      }
      const stats = await getUserStats();
      if (!active) return;
      if (stats?.onboarded_at) {
        window.location.href = '/app';
        return;
      }
      setDraft(toDraft(stats));
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  // The fields this phase owns, or null for phases that collect nothing (welcome
  // / summary / guide). Persisted on Continue and on Skip, partial by design.
  function phasePayload(i: number): UserStatsInput | null {
    switch (STEPS[i]) {
      case 'about':
        return {
          body_weight_kg: bounded(draft.weight, STATS_LIMITS.weightKg),
          height_cm: bounded(draft.height, STATS_LIMITS.heightCm),
          birth_year: bounded(draft.birthYear, STATS_LIMITS.birthYear),
          gender: draft.gender === '' ? null : draft.gender,
        };
      case 'rhythm':
        return {
          days_per_week: draft.days,
          experience: draft.experience === '' ? null : draft.experience,
          preferred_plan_weeks: draft.planWeeks,
        };
      case 'goals':
        return { goals: goalsPayload(draft.goals) };
      case 'disciplines':
        return { disciplines: draft.disciplines };
      case 'equipment':
        return { equipment: draft.equipment };
      case 'areas':
        return { injuries: injuriesPayload(draft.regions, draft.regionNote) };
      default:
        return null;
    }
  }

  async function persist(i: number) {
    const payload = phasePayload(i);
    if (payload) await upsertUserStats(payload);
  }

  function next() {
    void persist(step); // save this phase, don't block the transition on it
    setStep((s) => Math.min(s + 1, GUIDE));
  }
  function back() {
    setStep((s) => Math.max(s - 1, 0));
  }
  function skipPhase() {
    setStep((s) => Math.min(s + 1, GUIDE));
  }

  // Finish or skip-all: stamp the flag (so the redirect never brings them back)
  // and land on the plan guide, which every user sees regardless of path.
  async function complete() {
    void persist(step);
    const ok = await upsertUserStats({ onboarded_at: new Date().toISOString() });
    if (!ok) toast('Saved locally — we could not reach the server', 'error');
    setStep(GUIDE);
  }

  const toggle = <K,>(arr: K[], v: K): K[] =>
    arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];

  const summary = useMemo(() => buildSummary(draft), [draft]);

  if (loading) {
    return (
      <div className="flex h-[100dvh] items-center justify-center">
        <span className="t-label text-muted">Loading…</span>
      </div>
    );
  }

  const isQuestion = step > 0 && step < SUMMARY;

  return (
    <div className="flex h-[100dvh] flex-col bg-surface">
      {/* Top: progress + per-phase skip */}
      <header className="flex flex-col gap-3 border-b border-border px-5 pb-3 pt-4">
        <div className="flex items-center justify-between">
          <span className="font-display text-xs font-semibold uppercase tracking-[0.16em] text-muted">
            Verocity
          </span>
          <span className="text-xs tabular-nums text-subtle">
            {step === 0 ? 'Welcome' : step === GUIDE ? 'First plan' : `${step} / ${LAST_QUESTION}`}
          </span>
        </div>
        <ProgressBar total={STEPS.length} current={step} />
        <div className="flex min-h-5 items-center justify-between">
          <span className="text-xs text-subtle">
            {step === 0
              ? 'Set up your profile — skip anything you like'
              : step === GUIDE
                ? "You're all set — here's how to start"
                : 'Every step is optional'}
          </span>
          {isQuestion ? (
            <button
              type="button"
              onClick={skipPhase}
              className="p-1 text-sm text-muted underline decoration-subtle underline-offset-4 hover:text-fg"
            >
              Skip this →
            </button>
          ) : null}
        </div>
      </header>

      {/* Scroller — the app-shell rule: the document doesn't scroll, this does */}
      <div data-scroll-root className="flex-1 overflow-y-auto px-5 py-6">
        <div key={step} className="stagger">
          {STEPS[step] === 'welcome' && (
            <div className="flex min-h-full flex-col justify-center">
              <div className="stagger-item">
                <EchoText
                  text="Train"
                  as="span"
                  className="font-display text-6xl font-semibold uppercase leading-[0.92] tracking-[-0.02em]"
                />
              </div>
              <p className={`${eyebrow} stagger-item mt-5`}>Welcome to Verocity</p>
              <h1 className={`${heading} stagger-item mt-2`}>Let&apos;s shape your training around you.</h1>
              <p className={`${sub} stagger-item`}>
                A few quick questions so your plans, coaching and body map start out tuned to your
                goals, kit and history. Every step is optional — skip whatever you want, change it
                later in Settings.
              </p>
            </div>
          )}

          {STEPS[step] === 'about' && (
            <>
              <p className={`${eyebrow} stagger-item`}>About you</p>
              <h1 className={`${heading} stagger-item`}>The basics</h1>
              <p className={`${sub} stagger-item`}>Used to scale loads and estimate effort. Leave any of it blank.</p>
              <div className="stagger-item grid grid-cols-2 gap-4">
                <label className="block">
                  <span className={fieldLabel}>Height (cm)</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={draft.height}
                    onChange={(e) => set({ height: e.target.value })}
                    className={`${field} tabular-nums`}
                  />
                </label>
                <label className="block">
                  <span className={fieldLabel}>Bodyweight (kg)</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={draft.weight}
                    onChange={(e) => set({ weight: e.target.value })}
                    className={`${field} tabular-nums`}
                  />
                </label>
                <label className="block">
                  <span className={fieldLabel}>Birth year</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    value={draft.birthYear}
                    onChange={(e) => set({ birthYear: e.target.value })}
                    className={`${field} tabular-nums`}
                  />
                </label>
              </div>
              <span className={`${fieldLabel} stagger-item`}>Sex</span>
              <div className="stagger-item flex flex-wrap gap-2">
                {GENDER_KEYS.map((k) => (
                  <Chip key={k} on={draft.gender === k} onClick={() => set({ gender: draft.gender === k ? '' : k })}>
                    {GENDERS[k].label}
                  </Chip>
                ))}
              </div>
            </>
          )}

          {STEPS[step] === 'rhythm' && (
            <>
              <p className={`${eyebrow} stagger-item`}>Training rhythm</p>
              <h1 className={`${heading} stagger-item`}>How do you train?</h1>
              <p className={`${sub} stagger-item`}>Sets the shape and volume of a generated plan.</p>
              <span className={`${fieldLabel} stagger-item`}>Days per week</span>
              <div className="stagger-item flex flex-wrap gap-2">
                {dayOptions.map((d) => (
                  <Chip key={d} on={draft.days === d} onClick={() => set({ days: draft.days === d ? null : d })}>
                    {d}
                  </Chip>
                ))}
              </div>
              <span className={`${fieldLabel} stagger-item`}>Experience</span>
              <div className="stagger-item">
                <SegmentedTabs
                  ariaLabel="Experience"
                  tabs={EXPERIENCE_KEYS.map((k) => ({ key: k, label: EXPERIENCE_LEVELS[k].label }))}
                  active={draft.experience}
                  onChange={(k) => set({ experience: draft.experience === k ? '' : (k as ExperienceKey) })}
                />
                {draft.experience ? (
                  <p className="mt-2 text-xs text-subtle">{EXPERIENCE_LEVELS[draft.experience].blurb}</p>
                ) : null}
              </div>
              <span className={`${fieldLabel} stagger-item`}>Preferred plan length</span>
              <div className="stagger-item flex flex-wrap gap-2">
                {planWeekOptions.map((w) => (
                  <Chip
                    key={w}
                    on={draft.planWeeks === w}
                    onClick={() => set({ planWeeks: draft.planWeeks === w ? null : w })}
                  >
                    {w} wk
                  </Chip>
                ))}
              </div>
            </>
          )}

          {STEPS[step] === 'goals' && (
            <>
              <p className={`${eyebrow} stagger-item`}>Your goals</p>
              <h1 className={`${heading} stagger-item`}>What are you chasing?</h1>
              <p className={`${sub} stagger-item`}>
                Tap in priority order — the number is the rank we&apos;ll weight them by.
              </p>
              <div className="stagger-item mt-6 flex flex-wrap gap-2">
                {(Object.keys(GOALS) as GoalKey[]).map((k) => {
                  const idx = draft.goals.indexOf(k);
                  return (
                    <Chip
                      key={k}
                      on={idx >= 0}
                      rank={idx >= 0 ? idx + 1 : undefined}
                      onClick={() => set({ goals: toggle(draft.goals, k) })}
                    >
                      {GOALS[k].label}
                    </Chip>
                  );
                })}
              </div>
            </>
          )}

          {STEPS[step] === 'disciplines' && (
            <>
              <p className={`${eyebrow} stagger-item`}>Disciplines</p>
              <h1 className={`${heading} stagger-item`}>What do you like to train?</h1>
              <p className={`${sub} stagger-item`}>Pick any that fit — we&apos;ll bias suggestions toward them.</p>
              <div className="stagger-item mt-6 flex flex-wrap gap-2">
                {DISCIPLINES.map((d) => (
                  <Chip
                    key={d.key}
                    on={draft.disciplines.includes(d.key)}
                    onClick={() => set({ disciplines: toggle(draft.disciplines, d.key) })}
                  >
                    {d.label}
                  </Chip>
                ))}
              </div>
            </>
          )}

          {STEPS[step] === 'equipment' && (
            <>
              <p className={`${eyebrow} stagger-item`}>Equipment</p>
              <h1 className={`${heading} stagger-item`}>What can you train with?</h1>
              <p className={`${sub} stagger-item`}>Drives exercise substitutions. Select everything you have access to.</p>
              <div className="stagger-item mt-6 flex flex-wrap gap-2">
                {EQUIPMENT.map((e) => (
                  <Chip
                    key={e.key}
                    on={draft.equipment.includes(e.key)}
                    onClick={() => set({ equipment: toggle(draft.equipment, e.key) })}
                  >
                    {e.label}
                  </Chip>
                ))}
              </div>
            </>
          )}

          {STEPS[step] === 'areas' && (
            <>
              <p className={`${eyebrow} stagger-item`}>Sensitive areas</p>
              <h1 className={`${heading} stagger-item`}>Anything to work around?</h1>
              <p className={`${sub} stagger-item`}>
                Old injuries or areas to go easy on, so we can substitute the right movements.
                Optional.
              </p>
              <div className="stagger-item mt-6 flex flex-wrap gap-2">
                {MUSCLE_REGION_KEYS.map((k) => (
                  <Chip
                    key={k}
                    on={draft.regions.includes(k)}
                    onClick={() => set({ regions: toggle(draft.regions, k) })}
                  >
                    {MUSCLE_REGIONS[k].label}
                  </Chip>
                ))}
              </div>
              <label className="block">
                <span className={fieldLabel}>
                  Notes <span className="font-normal normal-case tracking-normal text-subtle">(optional)</span>
                </span>
                <textarea
                  rows={2}
                  value={draft.regionNote}
                  maxLength={STATS_LIMITS.injuryLabelChars}
                  onChange={(e) => set({ regionNote: e.target.value })}
                  placeholder="e.g. Left shoulder — avoid overhead pressing"
                  className={`${field} resize-none py-2`}
                />
              </label>
            </>
          )}

          {STEPS[step] === 'summary' && (
            <>
              <p className={`${eyebrow} stagger-item`}>All set</p>
              <h1 className={`${heading} stagger-item`}>Here&apos;s your starting point.</h1>
              <p className={`${sub} stagger-item`}>Saved to your profile. Change any of it anytime in Settings.</p>
              <dl className="stagger-item mt-5 grid grid-cols-[auto_1fr] gap-px border border-border bg-border">
                {summary.map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="bg-surface px-4 py-3 t-label text-muted">{k}</dt>
                    <dd className={`bg-surface px-4 py-3 text-right text-sm ${v ? 'text-fg' : 'italic text-subtle'}`}>
                      {v || 'Skipped'}
                    </dd>
                  </div>
                ))}
              </dl>
            </>
          )}

          {STEPS[step] === 'guide' && <PlanGuide />}
        </div>
      </div>

      {/* Bottom: floating nav, pinned inside the scroller shell */}
      <nav className="flex items-center justify-between gap-3 border-t border-border px-5 py-3 pb-safe">
        <button
          type="button"
          onClick={back}
          disabled={step === 0}
          aria-label="Back"
          className="hill-btn inline-flex h-12 w-12 items-center justify-center border border-border bg-surface text-lg text-fg disabled:opacity-40"
        >
          ←
        </button>
        {step < SUMMARY ? (
          <button
            type="button"
            onClick={complete}
            // min-h-11, not p-2: this measured 36px and was the last sub-44px
            // target in the app (TOUCH.minTargetPx, audit:mobile rule 2). It
            // reads as a text link, which is exactly why it is easy to miss —
            // a link still has to be tappable.
            className="inline-flex min-h-11 items-center px-2 text-sm text-muted underline decoration-subtle underline-offset-4 hover:text-fg"
          >
            Skip for now
          </button>
        ) : null}
        {step === GUIDE ? (
          <button
            type="button"
            onClick={() => (window.location.href = '/app/plan')}
            className="hill-btn inline-flex min-h-12 flex-1 items-center justify-center bg-fg px-5 text-sm font-semibold uppercase tracking-wider text-bg"
          >
            Go to Plans →
          </button>
        ) : step === SUMMARY ? (
          <button
            type="button"
            onClick={complete}
            className="hill-btn inline-flex min-h-12 flex-1 items-center justify-center bg-fg px-5 text-sm font-semibold uppercase tracking-wider text-bg"
          >
            Finish →
          </button>
        ) : (
          <button
            type="button"
            onClick={next}
            className="hill-btn inline-flex min-h-12 flex-1 items-center justify-center bg-fg px-5 text-sm font-semibold uppercase tracking-wider text-bg"
          >
            {step === 0 ? 'Get started →' : 'Continue →'}
          </button>
        )}
      </nav>
    </div>
  );
}

// The closing coach-mark. A faithful, token-built miniature of the plan page —
// monochrome like the rest of the app — with the three targets ringed and
// numbered, matched to a legend. (A literal screenshot would need an authed
// running app with a plan on file; this representation always tracks the design
// system and both themes for free.) Ring = the target, the rest is dimmed.
function PlanGuide() {
  return (
    <>
      <p className={`${eyebrow} stagger-item`}>One last thing</p>
      <h1 className={`${heading} stagger-item`}>Make your first plan.</h1>
      <p className={`${sub} stagger-item`}>
        Head to Plans to upload a spreadsheet or generate one with the AI prompt. Here&apos;s where
        to look:
      </p>

      <div className="stagger-item mx-auto mt-5 w-full max-w-[280px]">
        <div className="relative overflow-hidden rounded-xl border border-border bg-bg">
          {/* header */}
          <div className="flex items-center justify-between border-b border-border bg-surface px-3 py-2 text-muted">
            <span className="text-sm">☰</span>
            <span className="font-display text-[8px] font-semibold uppercase tracking-[0.16em]">Verocity</span>
            <span className="h-4 w-4 rounded-full border border-border bg-bg" />
          </div>
          {/* top tabs — Plan ringed */}
          <div className="grid grid-cols-3 gap-px px-3 pt-3 text-[10px] font-semibold">
            <span className="relative z-10 rounded-[3px] bg-fg py-1.5 text-center text-bg ring-2 ring-fg ring-offset-2 ring-offset-bg">
              Plan
              <Badge n={2} />
            </span>
            <span className="py-1.5 text-center text-subtle opacity-50">Sessions</span>
            <span className="py-1.5 text-center text-subtle opacity-50">Library</span>
          </div>
          {/* body — New plan ringed */}
          <div className="px-3 py-3">
            <div className="flex items-center justify-between">
              <div className="opacity-50">
                <div className="font-display text-[13px] font-semibold text-fg">Your plan</div>
                <div className="text-[8px] text-subtle">Push · Pull · Legs — Week 3</div>
              </div>
              <span className="relative z-10 rounded-[3px] border border-fg bg-fg px-2 py-1 font-display text-[9px] font-semibold text-bg ring-2 ring-fg ring-offset-2 ring-offset-bg">
                ＋ New plan
                <Badge n={3} />
              </span>
            </div>
            <div className="mt-2 space-y-2 opacity-50">
              <div className="h-6 rounded border border-border bg-surface" />
              <div className="h-6 rounded border border-border bg-surface" />
            </div>
          </div>
          {/* bottom ribbon — Training ringed */}
          <div className="grid grid-cols-5 items-center border-t border-border bg-surface py-1.5 text-subtle">
            <Slot glyph="⌂" label="Home" dim />
            <div className="relative z-10 flex flex-col items-center rounded-[3px] py-0.5 text-fg ring-2 ring-fg ring-offset-2 ring-offset-surface">
              <span className="text-[13px] leading-none">▤</span>
              <small className="text-[7px]">Training</small>
              <Badge n={1} />
            </div>
            <div className="flex justify-center">
              <span className="-mt-1 flex h-5 w-5 items-center justify-center rounded-full bg-fg text-[11px] text-bg">＋</span>
            </div>
            <Slot glyph="◔" label="Progress" dim />
            <Slot glyph="☺" label="You" dim />
          </div>
        </div>
      </div>

      <ol className="stagger-item mt-6 flex flex-col gap-3">
        {[
          ['Tap Training', 'in the bottom bar.'],
          ['Open the Plan tab', 'at the top.'],
          ['Hit New plan', 'to upload a spreadsheet or copy the AI prompt to generate one.'],
        ].map(([b, rest], i) => (
          <li key={i} className="flex items-start gap-3">
            <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-fg font-display text-xs font-bold text-bg">
              {i + 1}
            </span>
            <span className="text-sm leading-snug text-fg">
              <b className="font-semibold">{b}</b> <span className="text-muted">{rest}</span>
            </span>
          </li>
        ))}
      </ol>
    </>
  );
}

function Badge({ n }: { n: number }) {
  return (
    <span className="absolute -left-2 -top-2 flex h-[16px] w-[16px] items-center justify-center rounded-full bg-fg font-display text-[10px] font-bold text-bg ring-1 ring-bg">
      {n}
    </span>
  );
}

function Slot({ glyph, label, dim }: { glyph: string; label: string; dim?: boolean }) {
  return (
    <div className={`flex flex-col items-center gap-0.5 ${dim ? 'opacity-50' : ''}`}>
      <span className="text-[13px] leading-none">{glyph}</span>
      <small className="text-[7px]">{label}</small>
    </div>
  );
}

function buildSummary(d: Draft): [string, string][] {
  const nm = <K extends string>(arr: K[], lookup: (k: K) => string) => arr.map(lookup).join(', ');
  const basics = [d.height && `${d.height}cm`, d.weight && `${d.weight}kg`, d.birthYear]
    .filter(Boolean)
    .join(' · ');
  const rhythm = [
    d.days && `${d.days} days/wk`,
    d.experience && EXPERIENCE_LEVELS[d.experience].label,
    d.planWeeks && `plan ${d.planWeeks}wk`,
  ]
    .filter(Boolean)
    .join(' · ');
  const eq = d.equipment;
  return [
    ['Basics', basics],
    ['Sex', d.gender ? GENDERS[d.gender].label : ''],
    ['Rhythm', rhythm],
    ['Goals', nm(d.goals, (k) => GOALS[k].label)],
    ['Disciplines', nm(d.disciplines, (k) => DISCIPLINES.find((x) => x.key === k)?.label ?? k)],
    [
      'Equipment',
      eq.length > 6
        ? `${nm(eq.slice(0, 6), (k) => EQUIPMENT.find((x) => x.key === k)?.label ?? k)} +${eq.length - 6}`
        : nm(eq, (k) => EQUIPMENT.find((x) => x.key === k)?.label ?? k),
    ],
    ['Work around', nm(d.regions, (k) => MUSCLE_REGIONS[k].label)],
  ];
}

export default OnboardingView;
