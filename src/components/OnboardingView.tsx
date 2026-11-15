// First-run onboarding — the guided takeover a new user lands on straight after
// signup (SignupForm redirects here), and that Home's SetupCard links back to
// for anyone who has not finished it. It fills the same `user_stats` row that
// Settings' UserStatsPanel edits.
//
// WHAT IT ASKS, AND WHY ONLY THIS. Bodyweight and experience change numbers the
// app computes (volume pricing, the coach's set floor); days, goals, equipment
// and areas shape a plan. Height, birth year, sex, disciplines and plan length
// used to be asked here too — they reach only the AI plan prompt, which already
// asks for whatever is missing, so they live in Settings and are not asked up
// front. The flow ends on a choice of where to start rather than a diagram of
// where the New plan button is.
//
// Design contract: built from the app's own system — .hill-btn chips (invert on
// aria-pressed), EchoText hero, tokens only, CSS-first stagger, the
// non-scrolling app-shell with a pinned nav. Nothing here is required (every
// user_stats column is nullable), so every phase skips.
//
// Persistence is a partial upsert per phase (upsertUserStats only SETs the keys
// present), and ONLY for a phase the user actually changed: an existing user
// arriving from the Home card must be able to page through without the flow
// rewriting goals or injuries they tuned in Settings. `onboarded_at` is stamped
// when the flow is finished OR skipped, which is what retires the Home card.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  EQUIPMENT,
  EXPERIENCE_LEVELS,
  EXPERIENCE_KEYS,
  GOALS,
  GOAL_WEIGHT,
  MUSCLE_REGIONS,
  MUSCLE_REGION_KEYS,
  ONBOARDING,
  STATS_LIMITS,
  type EquipmentKey,
  type ExperienceKey,
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
import { FIELD } from '@/components/ui/primitives';

// Named so the nav logic and the progress count read clearly and don't drift
// when a phase is inserted.
const STEPS = ['welcome', 'basics', 'goals', 'equipment', 'areas', 'start'] as const;
const START = STEPS.indexOf('start');
const QUESTIONS = START - 1;

// Where the last screen can send someone. `?tab=build` is read by PlanUpload,
// which otherwise opens on the Ready tab whenever templates exist.
const STARTS = [
  { key: 'ready', title: 'Start from a ready-made plan', blurb: 'Pick a program, adjust it later.', href: '/app/plan/upload', cta: 'See plans →' },
  { key: 'own', title: 'Bring my own plan', blurb: 'Upload a spreadsheet or generate one with the AI prompt.', href: '/app/plan/upload?tab=build', cta: 'Open plan upload →' },
  { key: 'log', title: 'Just log a session', blurb: 'No plan. Open the logger now.', href: '/app/log', cta: 'Open logger →' },
] as const;
type StartKey = (typeof STARTS)[number]['key'];

const eyebrow = 't-eyebrow text-subtle';
const heading = 'font-display text-3xl font-semibold leading-[1.06] tracking-[-0.015em] text-fg';
const sub = 'mt-2 max-w-[40ch] text-muted';
const fieldLabel = 'mb-2 mt-6 block t-label text-muted first:mt-0';

interface Draft {
  weight: string;
  days: number | null;
  experience: ExperienceKey | '';
  goals: GoalKey[];
  equipment: EquipmentKey[];
  regions: RegionKey[];
  regionNote: string;
}

const EMPTY: Draft = {
  weight: '',
  days: null,
  experience: '',
  goals: [],
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
    days: s.days_per_week,
    experience: s.experience ?? '',
    goals: goalIds,
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

// Selected regions → Injury[], MERGED into what is already stored: a row the
// athlete detailed in Settings (year, notes) survives as long as its region is
// still selected, and unlocalised rows are never touched. The note becomes its
// own unlocalised row, so it is kept even when no region is picked.
function injuriesPayload(existing: Injury[], regions: RegionKey[], note: string): Injury[] {
  const kept = existing.filter((i) => i.region == null || regions.includes(i.region));
  const added = regions
    .filter((r) => !existing.some((i) => i.region === r))
    .map((r) => ({ id: crypto.randomUUID(), region: r, label: MUSCLE_REGIONS[r].label }));
  const trimmed = note.trim();
  const noteRow = trimmed ? [{ id: crypto.randomUUID(), region: null, label: trimmed }] : [];
  return [...kept, ...added, ...noteRow];
}

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
      // Fills come from `.hill-btn[aria-pressed]` (on = accent, off =
      // tappable); text-muted is the off state only — the pressed rule
      // overrides it. The rank badge only renders on a pressed chip, so it is
      // the INVERSE of the accent fill it sits on.
      className="hill-btn inline-flex min-h-11 min-w-11 items-center justify-center gap-2 border px-4 text-sm text-muted hover:text-fg"
    >
      {rank != null ? (
        <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent-fg px-1 text-[11px] tabular-nums text-accent">
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
  const [start, setStart] = useState<StartKey | null>(null);
  const [leaving, setLeaving] = useState(false);
  // Phases the user changed. An untouched phase is never written — see header.
  const touched = useRef(new Set<number>());
  const storedInjuries = useRef<Injury[]>([]);

  const set = (p: Partial<Draft>) => {
    touched.current.add(step);
    setDraft((d) => ({ ...d, ...p }));
  };

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
      storedInjuries.current = stats?.injuries ?? [];
      setDraft(toDraft(stats));
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  // The fields this phase owns, or null for phases that collect nothing.
  function phasePayload(i: number): UserStatsInput | null {
    switch (STEPS[i]) {
      case 'basics':
        return {
          body_weight_kg: bounded(draft.weight, STATS_LIMITS.weightKg),
          days_per_week: draft.days,
          experience: draft.experience === '' ? null : draft.experience,
        };
      case 'goals':
        return { goals: goalsPayload(draft.goals) };
      case 'equipment':
        return { equipment: draft.equipment };
      case 'areas':
        return { injuries: injuriesPayload(storedInjuries.current, draft.regions, draft.regionNote) };
      default:
        return null;
    }
  }

  async function persist(i: number) {
    if (!touched.current.has(i)) return;
    const payload = phasePayload(i);
    if (!payload) return;
    // A rejected upsert used to be completely silent here — no toast, no retry,
    // and the flow advanced regardless. That is how a PGRST204 from an unapplied
    // migration went unnoticed for weeks.
    if (!(await upsertUserStats(payload))) toast('Could not save — try again', 'error');
  }

  function next() {
    void persist(step); // save this phase, don't block the transition on it
    setStep((s) => Math.min(s + 1, START));
  }
  function back() {
    setStep((s) => Math.max(s - 1, 0));
  }
  function skip() {
    setStep((s) => Math.min(s + 1, START));
  }

  // Finish or leave early: stamp the flag (which retires Home's SetupCard) and
  // go. The navigation waits on the write so the card is not there on arrival.
  async function leave(href: string) {
    setLeaving(true);
    const ok = await upsertUserStats({ onboarded_at: new Date().toISOString() });
    if (!ok) toast('Could not save — try again', 'error');
    window.location.href = href;
  }

  const toggle = <K,>(arr: K[], v: K): K[] =>
    arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];

  // Up to ONBOARDING.maxGoals, first tap is the priority. At the cap a new tap
  // replaces the LAST pick, so the primary goal never moves under the thumb.
  const toggleGoal = (k: GoalKey): GoalKey[] => {
    if (draft.goals.includes(k)) return draft.goals.filter((g) => g !== k);
    return [...draft.goals.slice(0, ONBOARDING.maxGoals - 1), k];
  };

  if (loading) {
    return (
      <div className="flex h-[100dvh] items-center justify-center">
        <span className="t-label text-muted">Loading…</span>
      </div>
    );
  }

  const isQuestion = step > 0 && step < START;
  const chosen = STARTS.find((s) => s.key === start);
  const primary =
    'hill-btn inline-flex min-h-12 flex-1 items-center justify-center border border-accent bg-accent px-5 text-sm font-semibold uppercase tracking-wider text-accent-fg disabled:opacity-40';

  return (
    <div className="flex h-[100dvh] flex-col bg-surface">
      <header className="flex flex-col gap-3 border-b border-border px-5 pb-4 pt-4">
        <div className="flex items-center justify-between">
          <span className="font-display text-xs uppercase tracking-[0.16em] text-muted">Verocity</span>
          <span className="text-xs tabular-nums text-subtle">
            {step === 0 ? 'Welcome' : step === START ? 'Start' : `${step} / ${QUESTIONS}`}
          </span>
        </div>
        <ProgressBar total={STEPS.length} current={step} />
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
                  className="font-display text-6xl uppercase leading-[0.92] tracking-[-0.02em]"
                />
              </div>
              <p className={`${eyebrow} stagger-item mt-5`}>Welcome to Verocity</p>
              <h1 className={`${heading} stagger-item mt-2`}>Let&apos;s tune this to you.</h1>
              <p className={`${sub} stagger-item`}>
                Four short screens, then you pick where to start. Skip any of them and change
                everything later in You.
              </p>
            </div>
          )}

          {STEPS[step] === 'basics' && (
            <>
              <p className={`${eyebrow} stagger-item`}>About you</p>
              <h1 className={`${heading} stagger-item`}>The basics</h1>
              <p className={`${sub} stagger-item`}>
                Bodyweight prices pull-ups and push-ups; experience sets the coach&apos;s weekly
                targets.
              </p>
              <label className="stagger-item mt-6 block max-w-[12rem]">
                <span className={fieldLabel}>Bodyweight (kg)</span>
                <input
                  type="number"
                  inputMode="decimal"
                  value={draft.weight}
                  onChange={(e) => set({ weight: e.target.value })}
                  className={`${FIELD} tabular-nums`}
                />
              </label>
              <span className={`${fieldLabel} stagger-item`}>Days per week</span>
              {/* One value of seven: the shared segmented control, not a row of
                  detached toggles. Tapping the selected day again clears it,
                  as before — SegmentedTabs reports every tap. */}
              <div className="stagger-item">
                <SegmentedTabs
                  as="radiogroup"
                  ariaLabel="Days per week"
                  tabs={dayOptions.map((d) => ({ key: String(d), label: String(d) }))}
                  active={draft.days == null ? '' : String(draft.days)}
                  onChange={(k) => set({ days: draft.days === Number(k) ? null : Number(k) })}
                />
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
            </>
          )}

          {STEPS[step] === 'goals' && (
            <>
              <p className={`${eyebrow} stagger-item`}>Your goals</p>
              <h1 className={`${heading} stagger-item`}>What are you chasing?</h1>
              <p className={`${sub} stagger-item`}>
                Pick up to {ONBOARDING.maxGoals}. The first is your priority.
              </p>
              <div className="stagger-item mt-6 flex flex-wrap gap-2">
                {(Object.keys(GOALS) as GoalKey[]).map((k) => {
                  const idx = draft.goals.indexOf(k);
                  return (
                    <Chip
                      key={k}
                      on={idx >= 0}
                      rank={idx >= 0 ? idx + 1 : undefined}
                      onClick={() => set({ goals: toggleGoal(k) })}
                    >
                      {GOALS[k].label}
                    </Chip>
                  );
                })}
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
                Old injuries or areas to go easy on, so a plan can substitute the right movements.
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
              <label className="mt-6 block">
                <span className={fieldLabel}>
                  Notes <span className="font-normal normal-case tracking-normal text-subtle">(optional)</span>
                </span>
                <textarea
                  rows={2}
                  value={draft.regionNote}
                  maxLength={STATS_LIMITS.injuryLabelChars}
                  onChange={(e) => set({ regionNote: e.target.value })}
                  placeholder="e.g. Left shoulder — avoid overhead pressing"
                  className={`${FIELD} resize-none py-2`}
                />
              </label>
            </>
          )}

          {STEPS[step] === 'start' && (
            <>
              <p className={`${eyebrow} stagger-item`}>Last step</p>
              <h1 className={`${heading} stagger-item`}>Where do you want to start?</h1>
              <div className="stagger-item mt-6 flex flex-col gap-2">
                {STARTS.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    aria-pressed={start === s.key}
                    onClick={() => setStart(s.key)}
                    // A single-select list too long-winded for a segmented
                    // control: a column of rows, filled by the central
                    // `.hill-btn[aria-pressed]` rule (on = accent).
                    className="hill-btn flex min-h-11 flex-col items-start border px-4 py-3 text-left text-fg"
                  >
                    <span className="text-sm font-semibold">{s.title}</span>
                    <span className="mt-0.5 text-sm opacity-70">{s.blurb}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Bottom nav: the last flex child of the viewport-sized column, never
          anchored to the viewport (CLAUDE.md, "the app chrome does not scroll"). */}
      <nav className="flex items-center justify-between gap-3 border-t border-border px-5 py-3 pb-safe">
        <button
          type="button"
          onClick={back}
          disabled={step === 0}
          aria-label="Back"
          className="hill-btn inline-flex h-12 w-12 items-center justify-center border border-transparent bg-tappable text-lg text-fg hover:bg-tappable-hover disabled:opacity-40"
        >
          ←
        </button>
        {/* ONE skip per screen. It used to be two — "Skip this" up top for the
            screen, "Skip for now" down here for the whole flow — and the labels
            did not say which was which. Leaving entirely is offered on the
            welcome and start screens only. min-h-11 is TOUCH.minTargetPx. */}
        <button
          type="button"
          disabled={leaving}
          onClick={isQuestion ? skip : () => void leave('/app')}
          className="inline-flex min-h-11 items-center px-2 text-sm text-muted underline decoration-subtle underline-offset-4 hover:text-fg"
        >
          {step === 0 ? 'Skip setup' : 'Skip'}
        </button>
        {step === START ? (
          <button
            type="button"
            disabled={!chosen || leaving}
            onClick={() => chosen && void leave(chosen.href)}
            className={primary}
          >
            {chosen ? chosen.cta : 'Choose one'}
          </button>
        ) : (
          <button type="button" onClick={next} className={primary}>
            {step === 0 ? 'Get started →' : 'Continue →'}
          </button>
        )}
      </nav>
    </div>
  );
}

export default OnboardingView;
