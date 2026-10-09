import { useEffect, useState } from 'react';
import {
  createMovement,
  createSession,
  deleteSession,
  getAllPlans,
  getMovements,
  getSessions,
  resolveMovement,
  updateSession,
  type SessionInput,
} from '@/lib/queries';
import { firstWeekWithContent, frameFromPlanDay } from '@/lib/logBuilder';
import { useAuthedQuery } from '@/lib/useAuthedQuery';
import { clientFor, isReadOnly, type Surface } from '@/lib/surface';
import type { Movement, Plan, PlanDay, Session, SessionExercise, SessionType } from '@/lib/types';
import { ACTIVITY_TAGS, METRICS, SECTIONS, TIMERS, type ActivityTagKey, type MetricKey, type SectionKey, PRIMARY_METRICS } from '@/app.config';
import { DEFAULT_PRIMARY_METRIC } from '@/lib/metrics';
import { tagColor } from '@/lib/tags';
import { distinctSessionMovements, formatSessionMeta, sessionMovementKeys, TYPE_SHORT } from '@/lib/sessionMeta';
import { SessionSheet } from '@/components/SessionSheet';
import { Button, EmptyState, ListCard, LoadingScreen } from '@/components/ui/primitives';
import { Modal } from '@/components/ui/Modal';
import { Disclosure } from '@/components/ui/Disclosure';
import SegmentedTabs from '@/components/ui/SegmentedTabs';
import { ECHO_APP_TITLE, EchoText } from '@/components/EchoText';
import { Item, PageStagger } from '@/components/anim';
import { MovementPicker } from '@/components/logger/MovementPicker';
import { toast } from '@/lib/toast';

const TAG_KEYS = Object.keys(ACTIVITY_TAGS) as ActivityTagKey[];
// See LibraryView: offer only primary-eligible metrics; stored legacy values
// still resolve through METRICS.
const METRIC_KEYS = PRIMARY_METRICS as readonly MetricKey[];
const SESSION_TYPES = Object.keys(TYPE_SHORT) as SessionType[];
const inputClass =
  'min-h-11 w-full border border-border bg-surface px-3 text-base text-fg outline-none placeholder:text-muted focus:border-subtle';

// Effective length of a session for the duration filter: an actual duration
// when known, else the format's time cap (AMRAP/EMOM etc. have no fixed
// duration otherwise). Sessions with neither (legacy strength templates)
// don't match any bucket.
function sessionSeconds(s: Session): number | null {
  return s.duration_seconds ?? s.time_cap_seconds ?? null;
}

type DurationBucket = { key: string; label: string; min: number; max: number };
const DURATION_BUCKETS: DurationBucket[] = [
  { key: 'under15', label: '< 15 min', min: 0, max: 15 * 60 },
  { key: '15to30', label: '15–30 min', min: 15 * 60, max: 30 * 60 },
  { key: '30to45', label: '30–45 min', min: 30 * 60, max: 45 * 60 },
  { key: '45plus', label: '45+ min', min: 45 * 60, max: Infinity },
];

function FilterIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
      strokeLinecap="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M3 4.5h14l-5.5 6.25v5.25l-3 1.5v-6.75L3 4.5z" />
    </svg>
  );
}

// One toggle chip for the filter sheet. The BUTTON is the 44px target and is
// transparent; the bordered chip is a 32px span inside it. Wrapped rows sit
// with no vertical gap, so each row's 44px box abuts the next instead of
// overlapping it (LESSONS: the slim-thumb trick does not transfer to stacked
// rows) — the chips read slim, the 12px between them is hit box, not margin.
function FilterChip({
  label,
  on,
  onClick,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`group flex min-h-11 items-center t-control transition-colors ${
        on ? 'text-fg' : 'text-muted hover:text-fg'
      }`}
    >
      <span
        className={`hill-btn flex min-h-8 items-center border bg-surface px-2.5 ${
          on ? 'border-fg' : 'border-border group-hover:border-subtle'
        }`}
      >
        {label}
      </span>
    </button>
  );
}

// A multi-select chip row — the session-type and duration filter groups.
function PillFilter<T extends string>({
  options,
  selected,
  onToggle,
}: {
  options: { key: T; label: string }[];
  selected: T[];
  onToggle: (key: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-x-1.5">
      {options.map(({ key, label }) => (
        <FilterChip key={key} label={label} on={selected.includes(key)} onClick={() => onToggle(key)} />
      ))}
    </div>
  );
}

type MovementMode = 'include' | 'exclude';

// Include and exclude share one list of movements, so they are one section with
// a mode switch rather than two copies of the same chip wall. A movement is in
// at most one of the two lists: picking it in the other mode moves it across.
// Options come from the movements actually present across the user's sessions
// (distinctSessionMovements), not the whole library.
function MovementFilter({
  options,
  include,
  exclude,
  onChange,
}: {
  options: { key: string; label: string }[];
  include: string[];
  exclude: string[];
  onChange: (include: string[], exclude: string[]) => void;
}) {
  const [mode, setMode] = useState<MovementMode>('include');
  const [query, setQuery] = useState('');
  const mine = mode === 'include' ? include : exclude;
  const toggle = (key: string) => {
    const without = (xs: string[]) => xs.filter((k) => k !== key);
    if (mine.includes(key)) {
      onChange(mode === 'include' ? without(include) : include, mode === 'exclude' ? without(exclude) : exclude);
    } else if (mode === 'include') {
      onChange([...include, key], without(exclude));
    } else {
      onChange(without(include), [...exclude, key]);
    }
  };
  const visible = query ? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase())) : options;

  if (options.length === 0) {
    return <p className="text-sm text-muted">No movements logged in any session yet.</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      <SegmentedTabs
        tabs={[
          { key: 'include', label: `Include${include.length ? ` · ${include.length}` : ''}` },
          { key: 'exclude', label: `Exclude${exclude.length ? ` · ${exclude.length}` : ''}` },
        ]}
        active={mode}
        onChange={(k) => setMode(k as MovementMode)}
        ariaLabel="Movement filter mode"
        size="sm"
      />
      <p className="text-xs text-muted">
        {mode === 'include' ? 'Show sessions with any of these.' : 'Hide sessions with any of these.'}
      </p>
      {options.length > 8 ? (
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search movements"
          className={inputClass}
          aria-label="Search movements"
        />
      ) : null}
      <div className="flex flex-wrap gap-x-1.5 capitalize">
        {visible.length === 0 ? (
          <p className="text-sm text-muted">No matches.</p>
        ) : (
          visible.map((o) => (
            <FilterChip key={o.key} label={o.label} on={mine.includes(o.key)} onClick={() => toggle(o.key)} />
          ))
        )}
      </div>
    </div>
  );
}

type Draft = { name: string; tags: string[]; exercises: SessionExercise[] };

const emptyDraft = (): Draft => ({ name: '', tags: [], exercises: [] });

function TagPicker({ value, onChange }: { value: string[]; onChange: (tags: string[]) => void }) {
  const toggle = (key: string) =>
    onChange(value.includes(key) ? value.filter((t) => t !== key) : [...value, key]);
  return (
    <div className="flex flex-wrap gap-2">
      {TAG_KEYS.map((key) => {
        const on = value.includes(key);
        const { label, color } = ACTIVITY_TAGS[key];
        return (
          <button
            key={key}
            type="button"
            onClick={() => toggle(key)}
            aria-pressed={on}
            className={`hill-btn border bg-surface px-2 py-1 t-control transition-colors ${
              on ? '' : 'border-border text-muted hover:text-fg'
            }`}
            style={on ? { borderColor: color, color } : undefined}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function SessionForm({
  draft,
  setDraft,
  movements,
  onSubmit,
  onCancel,
  submitLabel,
  busy,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  movements: Movement[];
  onSubmit: () => void;
  onCancel: () => void;
  submitLabel: string;
  busy: boolean;
}) {
  const [picking, setPicking] = useState(false);

  const setEx = (i: number, patch: Partial<SessionExercise>) =>
    setDraft({ ...draft, exercises: draft.exercises.map((e, idx) => (idx === i ? { ...e, ...patch } : e)) });
  const removeEx = (i: number) =>
    setDraft({ ...draft, exercises: draft.exercises.filter((_, idx) => idx !== i) });
  const moveEx = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= draft.exercises.length) return;
    const next = draft.exercises.slice();
    [next[i], next[j]] = [next[j], next[i]];
    setDraft({ ...draft, exercises: next });
  };

  function addMovement(picked: Movement | { name: string }) {
    const name = picked.name;
    const known = movements.find((m) => m.name.toLowerCase() === name.toLowerCase());
    const primaryMetric: MetricKey =
      'primary_metric' in picked ? picked.primary_metric : known?.primary_metric ?? DEFAULT_PRIMARY_METRIC;
    // First exercise lands in primary; later ones in accessory — a sane default
    // the user can change per row.
    const section: SectionKey = draft.exercises.length === 0 ? 'primary' : 'accessory';
    // A name typed into the picker's "Add …" row joins the library, as it does
    // in the Logger — otherwise it stays unsearchable until a workout using
    // this session is finished. Skipped while the library has not loaded: an
    // empty one would turn every shared movement into a custom duplicate.
    if (!('id' in picked) && movements.length > 0 && !resolveMovement(name, movements)) {
      createMovement({
        name,
        category: null,
        primary_metric: primaryMetric,
        default_rest_seconds: TIMERS.defaultRestSeconds,
      }).then((created) => {
        if (!created) toast(`Couldn't add “${name}” to your library`, 'error');
      });
    }
    setDraft({
      ...draft,
      exercises: [...draft.exercises, { movement: name, section, primaryMetric, planned: '' }],
    });
    setPicking(false);
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className="flex flex-col gap-4 border border-border bg-surface p-4"
    >
      <input
        value={draft.name}
        onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        placeholder="Session name"
        className={inputClass}
        aria-label="Session name"
        autoFocus
      />

      <div>
        <div className="mb-2 t-label text-muted">Tags</div>
        <TagPicker value={draft.tags} onChange={(tags) => setDraft({ ...draft, tags })} />
      </div>

      <div>
        <div className="mb-2 t-label text-muted">Movements</div>
        {draft.exercises.length === 0 ? (
          <p className="mb-3 text-sm text-muted">No movements yet.</p>
        ) : (
          <ul className="mb-3 flex flex-col gap-2">
            {draft.exercises.map((ex, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2 border border-border p-2">
                <span className="min-w-28 flex-1 capitalize text-fg">{ex.movement}</span>
                <select
                  value={ex.section}
                  onChange={(e) => setEx(i, { section: e.target.value as SectionKey })}
                  className="min-h-9 border border-border bg-bg px-2 text-xs uppercase tracking-wider text-fg outline-none focus:border-subtle"
                  aria-label={`${ex.movement} section`}
                >
                  {SECTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <select
                  value={ex.primaryMetric}
                  onChange={(e) => setEx(i, { primaryMetric: e.target.value as MetricKey })}
                  className="min-h-9 border border-border bg-bg px-2 text-xs uppercase tracking-wider text-fg outline-none focus:border-subtle"
                  aria-label={`${ex.movement} metric`}
                >
                  {METRIC_KEYS.map((m) => (
                    <option key={m} value={m}>
                      {METRICS[m].label}
                    </option>
                  ))}
                </select>
                <input
                  value={ex.planned}
                  onChange={(e) => setEx(i, { planned: e.target.value })}
                  placeholder="3x5"
                  className="min-h-9 w-20 border border-border bg-bg px-2 text-sm tabular-nums text-fg outline-none focus:border-subtle"
                  aria-label={`${ex.movement} planned sets`}
                />
                <div className="flex shrink-0 items-center">
                  <button
                    type="button"
                    onClick={() => moveEx(i, -1)}
                    disabled={i === 0}
                    className="px-1.5 text-muted hover:text-fg disabled:opacity-30"
                    aria-label="Move up"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => moveEx(i, 1)}
                    disabled={i === draft.exercises.length - 1}
                    className="px-1.5 text-muted hover:text-fg disabled:opacity-30"
                    aria-label="Move down"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => removeEx(i)}
                    className="px-1.5 text-muted hover:text-accent"
                    aria-label={`Remove ${ex.movement}`}
                  >
                    ×
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          onClick={() => setPicking(true)}
          className="t-control text-muted hover:text-fg"
        >
          + Movement
        </button>
      </div>

      <div className="flex gap-3">
        <Button type="submit" disabled={busy || !draft.name.trim()}>
          {submitLabel}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>

      {picking ? (
        <MovementPicker
          movements={movements}
          title="Add movement"
          onPick={addMovement}
          onClose={() => setPicking(false)}
        />
      ) : null}
    </form>
  );
}

// "From your plans" browser: expand a plan to its days, then start a day or save
// it as a reusable session.
function PlansBrowser({
  plans,
  onSaveDay,
  busy,
}: {
  plans: Plan[];
  onSaveDay: (plan: Plan, day: PlanDay) => void;
  busy: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const withDays = plans.filter((p) => (p.parsed.days ?? []).length > 0);
  if (withDays.length === 0) return null;

  return (
    <Item>
      <div className="mt-12">
        <div className="mb-4 t-eyebrow text-muted">From your plans</div>
        <ul className="divide-y divide-border border border-border">
          {withDays.map((plan) => {
            const open = openId === plan.id;
            return (
              <li key={plan.id}>
                <button
                  type="button"
                  onClick={() => setOpenId(open ? null : plan.id)}
                  className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-elevated"
                  aria-expanded={open}
                >
                  <span className="text-fg">
                    {plan.name}
                    {plan.is_active ? (
                      <span className="ml-2 t-control text-muted">active</span>
                    ) : null}
                  </span>
                  <span className={`text-[0.7rem] text-muted transition-transform ${open ? 'rotate-90' : ''}`}>
                    ▸
                  </span>
                </button>
                {open ? (
                  <ul className="border-t border-border bg-bg/40">
                    {plan.parsed.days.map((day) => (
                      <li
                        key={day.dayKey}
                        className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5 pl-6 last:border-b-0"
                      >
                        <span className="text-sm text-fg">{day.label}</span>
                        <div className="flex items-center gap-3 t-control">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => onSaveDay(plan, day)}
                            className="text-muted hover:text-fg disabled:opacity-40"
                          >
                            Save as session
                          </button>
                          <a
                            href={`/app/log?plan=${encodeURIComponent(plan.id)}&day=${encodeURIComponent(day.dayKey)}`}
                            className="text-muted hover:text-fg"
                          >
                            Start →
                          </a>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
    </Item>
  );
}

const byCreated = (a: Session, b: Session) => b.created_at.localeCompare(a.created_at);

export default function SessionsView({ mode = 'app' }: { mode?: Surface }) {
  // Showcase: read through the anon client, skip useAuthedQuery's session
  // guard (it would bounce a visitor to /login), and skip the SWR cache, which
  // is keyed per surface-blind and would leak the owner's rows into a public
  // page on a shared browser.
  const readOnly = isReadOnly(mode);
  const client = clientFor(mode);
  const opts = readOnly ? { auth: false } : undefined;
  const sessionsQ = useAuthedQuery(() => getSessions(client), opts ?? { key: 'sessions' });
  const movementsQ = useAuthedQuery(() => getMovements(client), opts ?? { key: 'movements' });
  const plansQ = useAuthedQuery(() => getAllPlans(client), opts ?? { key: 'plans:all' });

  const [items, setItems] = useState<Session[] | null>(null);
  const [q, setQ] = useState('');
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<SessionType[]>([]);
  const [durationFilter, setDurationFilter] = useState<string[]>([]);
  const [includeMovements, setIncludeMovements] = useState<string[]>([]);
  const [excludeMovements, setExcludeMovements] = useState<string[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [busy, setBusy] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);

  useEffect(() => {
    if (sessionsQ.data) setItems(sessionsQ.data);
  }, [sessionsQ.data]);

  const movements = movementsQ.data ?? [];
  const plans = plansQ.data ?? [];
  const sessions = items ?? [];
  const movementOptions = distinctSessionMovements(sessions);

  const filtered = sessions.filter((s) => {
    if (tagFilter && !s.tags.includes(tagFilter)) return false;
    if (q && !s.name.toLowerCase().includes(q.toLowerCase())) return false;
    if (typeFilter.length > 0 && (!s.session_type || !typeFilter.includes(s.session_type))) return false;
    if (durationFilter.length > 0) {
      const secs = sessionSeconds(s);
      if (secs == null) return false;
      const inBucket = DURATION_BUCKETS.some((b) => durationFilter.includes(b.key) && secs >= b.min && secs < b.max);
      if (!inBucket) return false;
    }
    if (includeMovements.length > 0 || excludeMovements.length > 0) {
      const names = sessionMovementKeys(s);
      if (includeMovements.length > 0 && !includeMovements.some((m) => names.includes(m))) return false;
      if (excludeMovements.length > 0 && excludeMovements.some((m) => names.includes(m))) return false;
    }
    return true;
  });

  const activeFilterCount =
    typeFilter.length + durationFilter.length + includeMovements.length + excludeMovements.length;
  const movementSummary = [
    includeMovements.length ? `${includeMovements.length} in` : '',
    excludeMovements.length ? `${excludeMovements.length} out` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  function clearAdvancedFilters() {
    setTypeFilter([]);
    setDurationFilter([]);
    setIncludeMovements([]);
    setExcludeMovements([]);
  }

  const toggleType = (t: SessionType) =>
    setTypeFilter((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  const toggleDuration = (key: string) =>
    setDurationFilter((prev) => (prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key]));

  const toInput = (d: Draft): SessionInput => ({
    name: d.name.trim(),
    tags: d.tags,
    frame: { exercises: d.exercises.filter((e) => e.movement.trim() !== '') },
  });

  function startAdd() {
    setEditingId(null);
    setDraft(emptyDraft());
    setAdding(true);
  }

  function startEdit(s: Session) {
    setAdding(false);
    setEditingId(s.id);
    setDraft({ name: s.name, tags: s.tags, exercises: s.frame.exercises ?? [] });
  }

  function cancel() {
    setAdding(false);
    setEditingId(null);
    setDraft(emptyDraft());
  }

  async function handleCreate() {
    if (busy || !draft.name.trim()) return;
    setBusy(true);
    const created = await createSession(toInput(draft));
    setBusy(false);
    if (created) {
      setItems((prev) => [created, ...(prev ?? [])].sort(byCreated));
      cancel();
    } else {
      toast('Could not save session', 'error');
    }
  }

  async function handleUpdate(id: string) {
    if (busy || !draft.name.trim()) return;
    const patch = toInput(draft);
    setBusy(true);
    const ok = await updateSession(id, patch);
    setBusy(false);
    if (ok) {
      setItems((prev) => (prev ?? []).map((s) => (s.id === id ? { ...s, ...patch } : s)).sort(byCreated));
      cancel();
    } else {
      toast('Could not save session', 'error');
    }
  }

  // Called from the sheet's armed trash, which is the confirm step. Logs that
  // used this session survive it: workout_logs.session_id is ON DELETE SET NULL.
  async function handleDelete(s: Session): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    const ok = await deleteSession(s.id);
    setBusy(false);
    if (!ok) {
      toast('Could not delete session', 'error');
      return false;
    }
    setPreviewId(null);
    setItems((prev) => (prev ?? []).filter((x) => x.id !== s.id));
    toast('Session deleted · your logged workouts stay', 'success');
    return true;
  }

  async function saveDayAsSession(plan: Plan, day: PlanDay) {
    if (busy) return;
    const week = firstWeekWithContent(day);
    const frame = frameFromPlanDay(day, week);
    if (frame.exercises.length === 0) {
      toast('That day has no programmed movements', 'error');
      return;
    }
    setBusy(true);
    const created = await createSession({
      name: `${plan.name} · ${day.label}`,
      tags: [],
      frame,
      source_plan_id: plan.id,
      source_day_key: day.dayKey,
    });
    setBusy(false);
    if (created) {
      setItems((prev) => [created, ...(prev ?? [])].sort(byCreated));
      toast('Saved to sessions', 'success');
    } else {
      toast('Could not save session', 'error');
    }
  }

  if (sessionsQ.loading || items === null) {
    return <LoadingScreen />;
  }

  return (
    <PageStagger className="mx-auto max-w-3xl px-4 pb-8 pt-5 sm:px-6">
      <Item>
        <div className="mb-6 flex items-end justify-between gap-4">
          <EchoText
            text="SESSIONS"
            as="h1"
            className={ECHO_APP_TITLE}
          />
          {!adding ? (
            <div className="shrink-0">
              <Button variant="ghost" onClick={startAdd}>+ Session</Button>
            </div>
          ) : null}
        </div>
      </Item>

      {adding ? (
        <Item>
          <div className="mb-6">
            <SessionForm
              draft={draft}
              setDraft={setDraft}
              movements={movements}
              onSubmit={handleCreate}
              onCancel={cancel}
              submitLabel="Create"
              busy={busy}
            />
          </div>
        </Item>
      ) : null}

      <Item>
        <div className="mb-4 flex gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search sessions"
            className="min-h-11 w-full flex-1 border border-border bg-surface px-3 text-base text-fg outline-none placeholder:text-muted focus:border-subtle"
          />
          <button
            type="button"
            onClick={() => setFiltersOpen(true)}
            aria-label="Filters"
            className={`hill-btn flex min-h-11 shrink-0 items-center gap-1.5 border bg-surface px-3 t-control transition-colors ${
              activeFilterCount > 0 ? 'border-fg text-fg' : 'border-border text-muted hover:text-fg'
            }`}
          >
            <FilterIcon />
            Filters
            {activeFilterCount > 0 ? <span className="tabular-nums">({activeFilterCount})</span> : null}
          </button>
        </div>
        <div className="mb-5 flex flex-wrap gap-2">
          <button
            onClick={() => setTagFilter(null)}
            className={`flex min-h-11 items-center border px-3 t-control transition-colors ${
              tagFilter === null ? 'border-fg text-fg' : 'border-border text-muted hover:text-fg'
            }`}
          >
            All
          </button>
          {TAG_KEYS.map((key) => (
            <button
              key={key}
              onClick={() => setTagFilter(tagFilter === key ? null : key)}
              className={`flex min-h-11 items-center border px-3 t-control transition-colors ${
                tagFilter === key ? 'border-fg text-fg' : 'border-border text-muted hover:text-fg'
              }`}
            >
              {ACTIVITY_TAGS[key].label}
            </button>
          ))}
        </div>
      </Item>

      {filtered.length === 0 ? (
        <Item>
          <EmptyState>{sessions.length === 0 ? 'No sessions yet.' : 'No sessions match.'}</EmptyState>
        </Item>
      ) : (
        <Item>
          <ListCard>
            {filtered.map((s) => {
              if (editingId === s.id) {
                return (
                  <div key={s.id} className="p-4">
                    <SessionForm
                      draft={draft}
                      setDraft={setDraft}
                      movements={movements}
                      onSubmit={() => handleUpdate(s.id)}
                      onCancel={cancel}
                      submitLabel="Save"
                      busy={busy}
                    />
                  </div>
                );
              }
              const groupCount = s.frame.groups?.reduce((n, g) => n + g.items.length, 0);
              const count = groupCount ?? s.frame.exercises?.length ?? 0;
              const meta = formatSessionMeta(s);
              // One line, one target: the row opens the sheet, and every action
              // (Start / Edit / Delete) lives in the sheet's footer. The first
              // tag is the stripe, as in LogList; the sheet shows all of them.
              const stripe = s.tags[0] ? tagColor(s.tags[0]) : 'transparent';
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setPreviewId(s.id)}
                  className="flex min-h-11 w-full items-center gap-3 px-3 text-left transition-colors hover:bg-elevated"
                  style={{ boxShadow: `inset 3px 0 0 ${stripe}` }}
                  aria-label={`Open ${s.name}`}
                >
                  <span className="min-w-0 flex-1 truncate text-fg">{s.name}</span>
                  <span className="shrink-0 t-control tabular-nums text-muted">
                    {meta ? `${meta} · ` : ''}
                    {count} mv
                  </span>
                </button>
              );
            })}
          </ListCard>
        </Item>
      )}

      <PlansBrowser plans={plans} onSaveDay={saveDayAsSession} busy={busy} />

      <SessionSheet
        session={sessions.find((s) => s.id === previewId) ?? null}
        onClose={() => setPreviewId(null)}
        onEdit={
          readOnly
            ? undefined
            : (s) => {
                setPreviewId(null);
                startEdit(s);
              }
        }
        onDelete={readOnly ? undefined : handleDelete}
      />

      <Modal open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filters">
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
          <div>
            <div className="t-label text-muted">Workout type</div>
            <PillFilter
              options={SESSION_TYPES.map((t) => ({ key: t, label: TYPE_SHORT[t] }))}
              selected={typeFilter}
              onToggle={toggleType}
            />
          </div>

          <div>
            <div className="t-label text-muted">Duration</div>
            <PillFilter
              options={DURATION_BUCKETS.map((b) => ({ key: b.key, label: b.label }))}
              selected={durationFilter}
              onToggle={toggleDuration}
            />
          </div>

          <Disclosure
            title="Movements"
            headerRight={movementSummary}
            defaultOpen={includeMovements.length + excludeMovements.length > 0}
          >
            <MovementFilter
              options={movementOptions}
              include={includeMovements}
              exclude={excludeMovements}
              onChange={(inc, exc) => {
                setIncludeMovements(inc);
                setExcludeMovements(exc);
              }}
            />
          </Disclosure>
        </div>
        <div className="flex shrink-0 border-t border-border p-4">
          <Button variant="ghost" onClick={clearAdvancedFilters} disabled={activeFilterCount === 0}>
            Clear filters
          </Button>
        </div>
      </Modal>
    </PageStagger>
  );
}
