import { useEffect, useState } from 'react';
import {
  createSession,
  deleteSession,
  getAllPlans,
  getMovements,
  getSessions,
  updateSession,
  type SessionInput,
} from '@/lib/queries';
import { firstWeekWithContent, frameFromPlanDay } from '@/lib/logBuilder';
import { useAuthedQuery } from '@/lib/useAuthedQuery';
import type { Movement, Plan, PlanDay, Session, SessionExercise } from '@/lib/types';
import { ACTIVITY_TAGS, METRICS, SECTIONS, type ActivityTagKey, type MetricKey, type SectionKey } from '@/app.config';
import { tagColor } from '@/lib/tags';
import { Button, EmptyState, LoadingScreen, Tag } from '@/components/ui/primitives';
import { EchoText } from '@/components/EchoText';
import { Item, PageStagger } from '@/components/anim';
import { MovementPicker } from '@/components/logger/MovementPicker';
import { toast } from '@/lib/toast';

const TAG_KEYS = Object.keys(ACTIVITY_TAGS) as ActivityTagKey[];
const METRIC_KEYS = Object.keys(METRICS) as MetricKey[];
const inputClass =
  'min-h-11 w-full border border-border bg-surface px-3 text-base text-fg outline-none placeholder:text-muted focus:border-subtle';

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
      'primary_metric' in picked ? picked.primary_metric : known?.primary_metric ?? 'weight';
    // First exercise lands in primary; later ones in accessory — a sane default
    // the user can change per row.
    const section: SectionKey = draft.exercises.length === 0 ? 'primary' : 'accessory';
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

export default function SessionsView() {
  const sessionsQ = useAuthedQuery(() => getSessions(), { key: 'sessions' });
  const movementsQ = useAuthedQuery(() => getMovements(), { key: 'movements' });
  const plansQ = useAuthedQuery(() => getAllPlans(), { key: 'plans:all' });

  const [items, setItems] = useState<Session[] | null>(null);
  const [q, setQ] = useState('');
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (sessionsQ.data) setItems(sessionsQ.data);
  }, [sessionsQ.data]);

  const movements = movementsQ.data ?? [];
  const plans = plansQ.data ?? [];
  const sessions = items ?? [];

  const filtered = sessions.filter((s) => {
    if (tagFilter && !s.tags.includes(tagFilter)) return false;
    if (q && !s.name.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });

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

  async function handleDelete(s: Session) {
    if (busy) return;
    if (!confirm(`Delete "${s.name}"? This can't be undone.`)) return;
    setBusy(true);
    const ok = await deleteSession(s.id);
    setBusy(false);
    if (ok) setItems((prev) => (prev ?? []).filter((x) => x.id !== s.id));
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
    <PageStagger className="mx-auto max-w-3xl px-6 py-8">
      <Item>
        <div className="mb-6 flex items-end justify-between gap-4">
          <EchoText
            text="SESSIONS"
            as="h1"
            className="font-display text-5xl font-bold uppercase leading-[0.9] tracking-[-0.04em] text-fg md:text-7xl"
          />
          {!adding ? (
            <button
              onClick={startAdd}
              className="shrink-0 pb-1 t-control text-muted transition-colors hover:text-fg"
            >
              + Session
            </button>
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
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search sessions"
          className="mb-4 min-h-11 w-full border border-border bg-surface px-3 text-base text-fg outline-none placeholder:text-muted focus:border-subtle"
        />
        <div className="mb-5 flex flex-wrap gap-2">
          <button
            onClick={() => setTagFilter(null)}
            className={`min-h-9 border px-3 t-control transition-colors ${
              tagFilter === null ? 'border-fg text-fg' : 'border-border text-muted hover:text-fg'
            }`}
          >
            All
          </button>
          {TAG_KEYS.map((key) => (
            <button
              key={key}
              onClick={() => setTagFilter(tagFilter === key ? null : key)}
              className={`min-h-9 border px-3 t-control transition-colors ${
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
          <ul className="divide-y divide-border border border-border">
            {filtered.map((s) => {
              if (editingId === s.id) {
                return (
                  <li key={s.id} className="p-4">
                    <SessionForm
                      draft={draft}
                      setDraft={setDraft}
                      movements={movements}
                      onSubmit={() => handleUpdate(s.id)}
                      onCancel={cancel}
                      submitLabel="Save"
                      busy={busy}
                    />
                  </li>
                );
              }
              const count = s.frame.exercises?.length ?? 0;
              return (
                <li key={s.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-fg">{s.name}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {s.tags.map((t) => (
                        <Tag key={t} label={ACTIVITY_TAGS[t as ActivityTagKey]?.label ?? t} color={tagColor(t)} />
                      ))}
                      <span className="t-control text-muted">
                        {count} {count === 1 ? 'movement' : 'movements'}
                        {s.source_plan_id ? ' · from plan' : ''}
                      </span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <a
                      href={`/app/log?session=${encodeURIComponent(s.id)}`}
                      className="hill-btn border border-border bg-surface px-2 py-1 t-control text-fg hover:border-fg"
                    >
                      Start
                    </a>
                    <button
                      onClick={() => startEdit(s)}
                      className="px-2 t-control text-muted hover:text-fg"
                      aria-label={`Edit ${s.name}`}
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(s)}
                      className="px-2 text-muted hover:text-accent"
                      aria-label={`Delete ${s.name}`}
                    >
                      ×
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </Item>
      )}

      <PlansBrowser plans={plans} onSaveDay={saveDayAsSession} busy={busy} />
    </PageStagger>
  );
}
