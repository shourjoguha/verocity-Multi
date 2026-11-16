import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { getActivePlan, updatePlan } from '@/lib/queries';
import {
  addBlock,
  addDay,
  addExercise,
  addSubroutine,
  copyPlanned,
  moveDay,
  moveExercise,
  nearestEarlierPlanned,
  planWeeks,
  removeBlock,
  removeDay,
  removeExercise,
  REST_STEP_SECONDS,
  setBlockEnd,
  setBlockStart,
  setBlockType,
  setDayLabel,
  setExerciseDescription,
  setExerciseMovement,
  setExerciseRest,
  setExerciseSection,
  setExerciseUrl,
  setExerciseWeekNote,
  setPlanned,
  setTitle,
} from '@/lib/planEdits';
import {
  formatStepped,
  parseStepped,
  qualDisplay,
  qualLabel,
  repsLabel,
  setLoadKind,
  stepQual,
  stepReps,
  stepSets,
  type LoadKind,
  type Stepped,
} from '@/lib/plannedStepper';
import { BLOCKS, SECTIONS, SUBROUTINE, type BlockKey, type SectionKey } from '@/app.config';
import type { ParsedPlan, PlanDay, PlanExercise } from '@/lib/types';
import { isSubroutine } from '@/lib/subroutine';
import { Button, EmptyState, FIELD, FIELD_DENSE, LoadingScreen } from '@/components/ui/primitives';
import SegmentedTabs from '@/components/ui/SegmentedTabs';
import { ActionMenu, type ActionMenuItem } from '@/components/ui/ActionMenu';
import { ECHO_APP_TITLE, EchoText } from '@/components/EchoText';
import { Item, PageStagger } from '@/components/anim';
import { Modal } from '@/components/ui/Modal';
import { PlusGlyph } from '@/components/ui/icons';
import { SHEET_GLYPH, SHEET_ICON_BTN } from '@/components/ui/SheetActions';
import { AddMenu } from '@/components/logger/AddMenu';

const SAVE_DEBOUNCE_MS = 1200;
// Phase rows are a short repeated list, so they keep FIELD_DENSE; FIELD_DENSE
// is w-full, so fixed widths come from a wrapper.
const weekCell = `${FIELD_DENSE} text-center tabular-nums`;
const rowBtn = 'flex min-h-11 min-w-11 items-center justify-center text-muted transition-colors';
const BLOCK_KEYS = Object.keys(BLOCKS) as BlockKey[];
// Week chips scroll inside the card past this width per chip, never the page.
const WEEK_CHIP_MIN_PX = 44;

const sectionName = (s: SectionKey) => s.charAt(0).toUpperCase() + s.slice(1);

const has = (ex: PlanExercise, w: number) => !!ex.plannedByWeek[w]?.trim();

// "W2–W4" for a run, "W3, W5" otherwise.
function weekList(ws: number[]): string {
  if (ws.length === 0) return '';
  const run = ws.every((w, i) => i === 0 || w === ws[i - 1] + 1);
  if (ws.length === 1) return `W${ws[0]}`;
  return run ? `W${ws[0]}–W${ws[ws.length - 1]}` : ws.map((w) => `W${w}`).join(', ');
}

function restText(s: number | undefined): string {
  if (s == null) return '—';
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

type Edit = (fn: (p: ParsedPlan) => ParsedPlan) => void;

export default function PlanEditor() {
  const [ready, setReady] = useState(false);
  const [planId, setPlanId] = useState<string | null>(null);
  const [plan, setPlan] = useState<ParsedPlan | null>(null);
  const [save, setSave] = useState<'idle' | 'pending' | 'saving' | 'saved'>('idle');
  const [extraWeeks, setExtraWeeks] = useState(0);
  const [dayIdx, setDayIdx] = useState(0);
  // The open section tab, per day (dayKey is stable across label edits).
  const [renaming, setRenaming] = useState(false);

  const firstRender = useRef(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        window.location.href = '/login';
        return;
      }
      const active = await getActivePlan();
      if (active) {
        setPlanId(active.id);
        setPlan(active.parsed);
      }
      setReady(true);
    })();
  }, []);

  // Debounced autosave on every edit (skips the initial load).
  useEffect(() => {
    if (!plan || !planId) return;
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    setSave('pending');
    const t = setTimeout(async () => {
      setSave('saving');
      const ok = await updatePlan(planId, plan);
      setSave(ok ? 'saved' : 'idle');
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [plan, planId]);

  if (!ready) return <LoadingScreen />;

  if (!plan) {
    return (
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-10">
        <EchoText
          text="EDIT PLAN"
          as="h1"
          className={`mb-8 ${ECHO_APP_TITLE}`}
        />
        <EmptyState>
          No active plan.{' '}
          <a href="/app/plan/upload" className="text-fg underline hover:text-subtle">
            Create one
          </a>
          .
        </EmptyState>
      </div>
    );
  }

  const cols = Math.max(planWeeks(plan), extraWeeks);
  const weeks = Array.from({ length: cols }, (_, i) => i + 1);
  const edit: Edit = (fn) => setPlan((p) => (p ? fn(p) : p));
  const di = Math.min(dayIdx, Math.max(0, plan.days.length - 1));
  const day: PlanDay | undefined = plan.days[di];
  const dayMenu: ActionMenuItem[] = [
    { label: 'Rename day', onSelect: () => setRenaming(true) },
    {
      label: 'Move day earlier',
      disabled: di === 0,
      onSelect: () => {
        edit((p) => moveDay(p, di, di - 1));
        setDayIdx(di - 1);
      },
    },
    {
      label: 'Move day later',
      disabled: di === plan.days.length - 1,
      onSelect: () => {
        edit((p) => moveDay(p, di, di + 1));
        setDayIdx(di + 1);
      },
    },
    {
      label: 'Delete day',
      onSelect: () => {
        edit((p) => removeDay(p, di));
        setDayIdx(Math.max(0, di - 1));
      },
    },
  ];

  return (
    <PageStagger className="mx-auto max-w-3xl px-4 sm:px-6 py-10">
      <Item>
        <header className="mb-6">
          <div className="flex items-center justify-between gap-4">
            <p className="t-eyebrow text-muted">Edit plan</p>
            <div className="flex shrink-0 items-center gap-4">
              <span className="t-control text-muted">
                {save === 'saving' ? 'Saving…' : save === 'pending' ? 'Editing…' : save === 'saved' ? 'Saved' : ''}
              </span>
              {/* 44px hit box; -my pulls it back so the header row keeps its height. */}
              <a
                href="/app/plan/view"
                className="t-control -my-3 inline-flex min-h-11 items-center text-fg"
              >
                Done →
              </a>
            </div>
          </div>
          <input
            value={plan.title}
            onChange={(e) => edit((p) => setTitle(p, e.target.value))}
            className="mt-1 w-full border-b border-border bg-transparent pb-1 text-xl font-medium text-fg outline-none focus:border-subtle"
            aria-label="Plan title"
          />
        </header>
      </Item>

      <Item>
        <section className="mb-6">
        <div className="mb-1 flex items-center justify-between">
          <span className="t-eyebrow text-muted">Phases</span>
          <button
            onClick={() => edit((p) => addBlock(p))}
            className="t-control flex min-h-11 items-center text-muted hover:text-fg"
          >
            + Phase
          </button>
        </div>
        {plan.blocks.length === 0 ? (
          <p className="text-sm text-muted">No phases yet. Add one to mark the plan's blocks of weeks.</p>
        ) : (
          // One line per phase, the phases one block: type, then its week
          // range, then remove. Each used to wrap onto a second line at 375px.
          <ul className="flex flex-col divide-y divide-border-soft rounded-card border border-outline bg-surface px-2">
            {plan.blocks.map((b, bi) => (
              <li key={bi} className="flex items-center gap-1.5 py-1">
                <span
                  className="inline-block h-2.5 w-2.5 shrink-0"
                  style={{ backgroundColor: BLOCKS[b.type]?.color }}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1">
                  <select
                    value={b.type}
                    onChange={(e) => edit((p) => setBlockType(p, bi, e.target.value as BlockKey))}
                    className={FIELD_DENSE}
                    aria-label={`Phase ${bi + 1} type`}
                  >
                    {BLOCK_KEYS.map((k) => (
                      <option key={k} value={k}>
                        {BLOCKS[k].label}
                      </option>
                    ))}
                  </select>
                </span>
                <span className="t-label text-muted">W</span>
                <span className="w-11 shrink-0">
                  <input
                    type="number"
                    min={1}
                    value={b.startWeek}
                    onChange={(e) => edit((p) => setBlockStart(p, bi, Number(e.target.value)))}
                    className={`${weekCell} px-1`}
                    aria-label={`Phase ${bi + 1} start week`}
                  />
                </span>
                <span className="text-muted">–</span>
                <span className="w-11 shrink-0">
                  <input
                    type="number"
                    min={b.startWeek}
                    value={b.endWeek}
                    onChange={(e) => edit((p) => setBlockEnd(p, bi, Number(e.target.value)))}
                    className={`${weekCell} px-1`}
                    aria-label={`Phase ${bi + 1} end week`}
                  />
                </span>
                <button
                  onClick={() => edit((p) => removeBlock(p, bi))}
                  className={`${rowBtn} -mr-1 hover:text-accent`}
                  aria-label={`Delete phase ${bi + 1}`}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        </section>
      </Item>

      <Item>
        <section aria-label="Days">
          {/* The day picker heads everything under it, and is the one place
              the day is named: the label used to repeat underneath as a
              second, display-font field. Rename lives in the day menu. */}
          <div className="mb-3 flex items-center gap-2">
            {renaming && day ? (
              <input
                autoFocus
                value={day.label}
                onChange={(e) => edit((p) => setDayLabel(p, di, e.target.value))}
                onBlur={() => setRenaming(false)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === 'Escape') setRenaming(false);
                }}
                className={`${FIELD} min-w-0 flex-1 text-lg font-medium`}
                aria-label={`Day ${di + 1} name`}
              />
            ) : (
              <select
                value={di}
                onChange={(e) => setDayIdx(Number(e.target.value))}
                className={`${FIELD} min-w-0 flex-1 text-lg font-medium`}
                aria-label="Day to edit"
                disabled={plan.days.length === 0}
              >
                {plan.days.map((d, i) => (
                  <option key={d.dayKey} value={i}>
                    {i + 1}. {d.label || `Day ${i + 1}`}
                  </option>
                ))}
              </select>
            )}
            {day ? <ActionMenu label="Day options" items={dayMenu} /> : null}
            <button
              type="button"
              onClick={() => {
                edit((p) => addDay(p));
                setDayIdx(plan.days.length);
              }}
              className={`${SHEET_ICON_BTN} text-fg hover:border-fg`}
              aria-label="Add a day"
              title="Add a day"
            >
              <PlusGlyph className={SHEET_GLYPH} />
            </button>
          </div>

          {day ? (
            <DayPanel
              key={day.dayKey}
              day={day}
              di={di}
              weeks={weeks}
              edit={edit}
            />
          ) : (
            <EmptyState>No days yet. Add one to start.</EmptyState>
          )}

          <div className="mt-6 flex items-center justify-between gap-3 border-t border-border-soft pt-4">
            <span className="t-label text-muted">
              Plan runs {cols} week{cols === 1 ? '' : 's'}
            </span>
            <Button variant="ghost" onClick={() => setExtraWeeks(cols + 1)}>
              + Week
            </Button>
          </div>
        </section>
      </Item>
    </PageStagger>
  );
}

// Everything under the day picker, indented from it so it reads as the day's
// contents: ONE list of the day's movements, grouped by section, each row a
// name and its first prescription. Tapping a row opens that movement's card
// in a bottom sheet — the cards used to be always open, one section at a time
// behind tabs, which put a week grid and five steppers on screen per movement.
function DayPanel({
  day,
  di,
  weeks,
  edit,
}: {
  day: PlanDay;
  di: number;
  weeks: number[];
  edit: Edit;
}) {
  const [openEi, setOpenEi] = useState<number | null>(null);
  const used = SECTIONS.filter((s) => day.exercises.some((e) => e.section === s));
  const firstWeek = weeks[0] ?? 1;
  const summary = (ex: PlanExercise) => {
    if (isSubroutine(ex)) return 'Subroutine';
    const w = weeks.find((wk) => has(ex, wk));
    return w == null ? 'Not set' : `${w === firstWeek ? '' : `W${w} `}${ex.plannedByWeek[w]}`;
  };
  const open = openEi != null ? day.exercises[openEi] : undefined;
  const inSectionOf = (s: SectionKey) => day.exercises.flatMap((e, ei) => (e.section === s ? [ei] : []));

  return (
    <div className="ml-2 border-l-2 border-border-soft pl-3">
      <div className="mb-1 flex items-center justify-between">
        <span className="t-label text-muted">
          {day.exercises.length} movement{day.exercises.length === 1 ? '' : 's'}
        </span>
        <AddMenu
          sections={[...SECTIONS]}
          labelFor={sectionName}
          label="Add a movement or subroutine"
          onPick={(s, kind) => {
            const at = day.exercises.length;
            edit((p) => (kind === 'movement' ? addExercise(p, di, '', s) : addSubroutine(p, di, '', s)));
            setOpenEi(at);
          }}
        />
      </div>
      {used.length === 0 ? (
        <p className="text-sm text-muted">No movements yet.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {used.map((s) => (
            <div key={s}>
              <div className="t-label mb-1 text-muted">{sectionName(s)}</div>
              <ul className="flex flex-col divide-y divide-border-soft rounded-card border border-outline bg-surface">
                {inSectionOf(s).map((ei) => {
                  const ex = day.exercises[ei];
                  return (
                    <li key={`${day.dayKey}-${ei}`}>
                      <button
                        type="button"
                        onClick={() => setOpenEi(ei)}
                        className="flex min-h-11 w-full items-center gap-3 px-3 text-left"
                      >
                        <span className="min-w-0 flex-1 truncate text-sm text-fg">
                          {ex.movement || <span className="text-muted">Untitled</span>}
                        </span>
                        <span className="shrink-0 text-xs tabular-nums text-muted">{summary(ex)}</span>
                        <span aria-hidden className="shrink-0 text-muted">›</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
      <Modal open={open != null} onClose={() => setOpenEi(null)} ariaLabel={open?.movement || 'Movement'}>
        {open != null && openEi != null ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <ExerciseCard
              key={`${day.dayKey}-${openEi}`}
              ex={open}
              di={di}
              ei={openEi}
              weeks={weeks}
              edit={edit}
              prevEi={(() => {
                const list = inSectionOf(open.section);
                const pos = list.indexOf(openEi);
                return pos > 0 ? list[pos - 1] : null;
              })()}
              nextEi={(() => {
                const list = inSectionOf(open.section);
                const pos = list.indexOf(openEi);
                return pos >= 0 && pos < list.length - 1 ? list[pos + 1] : null;
              })()}
              otherSections={SECTIONS.filter((x) => x !== open.section)}
              onMoved={(ei) => setOpenEi(ei)}
              onRemoved={() => setOpenEi(null)}
            />
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function ExerciseCard({
  ex,
  di,
  ei,
  weeks,
  edit,
  prevEi,
  nextEi,
  otherSections,
  onMoved,
  onRemoved,
}: {
  ex: PlanExercise;
  di: number;
  ei: number;
  weeks: number[];
  edit: Edit;
  prevEi: number | null;
  nextEi: number | null;
  otherSections: readonly SectionKey[];
  // The sheet follows the movement to its new index.
  onMoved: (ei: number) => void;
  onRemoved: () => void;
}) {
  const sub = isSubroutine(ex);
  const menu: ActionMenuItem[] = [
    {
      label: 'Move up',
      disabled: prevEi == null,
      onSelect: () => {
        if (prevEi == null) return;
        edit((p) => moveExercise(p, di, ei, prevEi));
        onMoved(prevEi);
      },
    },
    {
      label: 'Move down',
      disabled: nextEi == null,
      onSelect: () => {
        if (nextEi == null) return;
        edit((p) => moveExercise(p, di, ei, nextEi));
        onMoved(nextEi);
      },
    },
    ...otherSections.map((s) => ({
      label: `Move to ${sectionName(s)}`,
      onSelect: () => edit((p) => setExerciseSection(p, di, ei, s)),
    })),
    {
      label: sub ? 'Remove subroutine' : 'Remove exercise',
      onSelect: () => {
        onRemoved();
        edit((p) => removeExercise(p, di, ei));
      },
    },
  ];
  const name = ex.movement || (sub ? 'subroutine' : 'exercise');

  return (
    <div>
      <div className="flex items-center gap-2">
        <input
          value={ex.movement}
          onChange={(e) => edit((p) => setExerciseMovement(p, di, ei, e.target.value))}
          placeholder={sub ? 'Subroutine title' : 'Movement'}
          className={`${FIELD} min-w-0 flex-1 font-medium`}
          aria-label={sub ? 'Subroutine title' : 'Movement name'}
        />
        <ActionMenu label={`${name} options`} items={menu} />
      </div>
      {ex.group ? (
        <p className="t-label mt-2 text-muted">
          {ex.group.kind === 'circuit' ? 'Circuit' : 'Superset'} · {ex.group.id}
        </p>
      ) : null}
      {sub ? (
        <div className="mt-3 flex flex-col gap-2">
          <textarea
            value={ex.description ?? ''}
            onChange={(e) => edit((p) => setExerciseDescription(p, di, ei, e.target.value))}
            maxLength={SUBROUTINE.maxDescriptionChars}
            rows={3}
            placeholder="Description"
            className={`${FIELD} py-2`}
            aria-label="Subroutine description"
          />
          <input
            value={ex.url ?? ''}
            onChange={(e) => edit((p) => setExerciseUrl(p, di, ei, e.target.value))}
            type="url"
            placeholder="Insert link (optional)"
            className={FIELD}
            aria-label="Subroutine link"
          />
        </div>
      ) : (
        <WeekEditor ex={ex} di={di} ei={ei} weeks={weeks} edit={edit} />
      )}
    </div>
  );
}

function WeekEditor({
  ex,
  di,
  ei,
  weeks,
  edit,
}: {
  ex: PlanExercise;
  di: number;
  ei: number;
  weeks: number[];
  edit: Edit;
}) {
  const [week, setWeek] = useState(1);
  // Weeks the athlete chose to type rather than step.
  const [textWeeks, setTextWeeks] = useState<Set<number>>(new Set());
  // Weeks un-skipped with nothing earlier to copy: shown as an empty field,
  // and only committed to the plan once a value is typed.
  const [pending, setPending] = useState<Set<number>>(new Set());
  const w = Math.min(week, weeks.length);
  const noWeeks = !weeks.some((x) => has(ex, x));
  const raw = ex.plannedByWeek[w] ?? '';
  const programmed = has(ex, w);
  const open = programmed || pending.has(w) || noWeeks;
  const parsed = programmed ? parseStepped(raw) : null;
  const showText = !parsed || textWeeks.has(w);

  const add = (set: Set<number>, x: number) => new Set(set).add(x);
  const write = (s: Stepped) => edit((p) => setPlanned(p, di, ei, w, formatStepped(s)));

  const skip = () => {
    if (open) {
      setPending((s) => {
        const n = new Set(s);
        n.delete(w);
        return n;
      });
      edit((p) => setPlanned(p, di, ei, w, ''));
    } else {
      const prev = nearestEarlierPlanned(ex, w);
      if (prev) edit((p) => setPlanned(p, di, ei, w, prev));
      else setPending((s) => add(s, w));
    }
  };

  // Copy forward: onto the later weeks that are programmed, so deliberately
  // skipped weeks stay skipped; if none are, onto every later week.
  const later = weeks.filter((x) => x > w);
  const laterProgrammed = later.filter((x) => has(ex, x));
  const copyTargets = laterProgrammed.length ? laterProgrammed : later;

  return (
    <div className="mt-3">
      <div
        className="-my-[9px] overflow-x-auto py-[9px]"
        role="group"
        aria-label={`${ex.movement || 'Exercise'} weeks`}
      >
        <div style={{ minWidth: weeks.length * WEEK_CHIP_MIN_PX }}>
          <SegmentedTabs
            as="radiogroup"
            size="sm"
            ariaLabel="Week"
            tabs={weeks.map((x) => {
              const skipped = !has(ex, x) && !pending.has(x) && !noWeeks;
              return { key: String(x), label: `W${x}`, strike: skipped, srNote: skipped ? '(skipped)' : undefined };
            })}
            active={String(w)}
            onChange={(k) => setWeek(Number(k))}
          />
        </div>
      </div>

      <div className="mt-3">
        {!open ? (
          <p className="rounded-control bg-bg px-3 py-3 text-sm text-muted">
            Skipped in W{w}: the Logger leaves it out that week.
          </p>
        ) : showText ? (
          <label className="block">
            <span className="t-label mb-1 block text-muted">W{w} prescription</span>
            <input
              value={raw}
              onChange={(e) => {
                setTextWeeks((s) => add(s, w));
                if (e.target.value.trim()) {
                  setPending((s) => {
                    const n = new Set(s);
                    n.delete(w);
                    return n;
                  });
                }
                edit((p) => setPlanned(p, di, ei, w, e.target.value));
              }}
              placeholder="e.g. 3x8 @RPE7"
              className={`${FIELD} tabular-nums`}
            />
          </label>
        ) : (
          <div className="grid grid-cols-2 gap-x-2 gap-y-3">
            <Stepper
              label="Sets"
              value={String(parsed!.sets)}
              onDec={() => write(stepSets(parsed!, -1))}
              onInc={() => write(stepSets(parsed!, 1))}
              decDisabled={parsed!.sets <= 1}
            />
            <Stepper
              label={repsLabel(ex.primaryMetric)}
              value={String(parsed!.reps)}
              onDec={() => write(stepReps(parsed!, -1, ex.primaryMetric))}
              onInc={() => write(stepReps(parsed!, 1, ex.primaryMetric))}
            />
            {parsed!.quals.map((q, qi) => (
              <Stepper
                key={qi}
                label={qualLabel(q.kind)}
                value={qualDisplay(q)}
                onDec={() => write(stepQual(parsed!, qi, -1))}
                onInc={() => write(stepQual(parsed!, qi, 1))}
              />
            ))}
            {parsed!.quals.length <= 1 ? (
              <label className="block">
                <span className="t-label mb-1 block text-muted">Load type</span>
                <select
                  value={parsed!.quals[0]?.kind ?? ''}
                  onChange={(e) => write(setLoadKind(parsed!, (e.target.value || null) as LoadKind | null))}
                  className={FIELD}
                >
                  <option value="">None</option>
                  <option value="pct">% 1RM</option>
                  <option value="kg">kg</option>
                  <option value="rpe">RPE</option>
                </select>
              </label>
            ) : null}
          </div>
        )}
      </div>

      {open ? (
        <label className="mt-3 block">
          <span className="t-label mb-1 block text-muted">W{w} cue</span>
          <input
            value={ex.notesByWeek?.[w] ?? ''}
            onChange={(e) => edit((p) => setExerciseWeekNote(p, di, ei, w, e.target.value))}
            placeholder="Optional"
            className={FIELD}
          />
        </label>
      ) : null}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          aria-pressed={!open}
          disabled={noWeeks}
          onClick={skip}
          className="hill-btn t-control inline-flex min-h-11 flex-1 items-center justify-center border border-transparent bg-tappable px-3 text-fg hover:bg-tappable-hover disabled:opacity-40"
        >
          Skip W{w}
        </button>
        {/* Only where both views can show the string: an unparseable one has
            no stepper view to switch to, so it gets the note below instead. */}
        {open && parseStepped(raw) ? (
          <button
            type="button"
            aria-pressed={showText}
            onClick={() =>
              setTextWeeks((s) => {
                const n = new Set(s);
                if (n.has(w)) n.delete(w);
                else n.add(w);
                return n;
              })
            }
            className="hill-btn t-control inline-flex min-h-11 flex-1 items-center justify-center border border-transparent bg-tappable px-3 text-fg hover:bg-tappable-hover"
          >
            Text
          </button>
        ) : null}
      </div>
      {open && showText && raw && !parseStepped(raw) ? (
        <p className="mt-1 text-xs text-muted">Steppers can’t show this one; it stays exactly as typed.</p>
      ) : null}

      <div className="mt-3 border-t border-border-soft pt-3">
        <Stepper
          label="Rest · every week"
          value={restText(ex.restSeconds)}
          onDec={() =>
            edit((p) =>
              setExerciseRest(
                p,
                di,
                ei,
                ex.restSeconds == null || ex.restSeconds <= 0 ? undefined : ex.restSeconds - REST_STEP_SECONDS,
              ),
            )
          }
          onInc={() => edit((p) => setExerciseRest(p, di, ei, (ex.restSeconds ?? -REST_STEP_SECONDS) + REST_STEP_SECONDS))}
          decDisabled={ex.restSeconds == null}
        />
      </div>

      <div className="mt-3 rounded-control bg-bg p-3">
        <p className="t-label mb-2 text-muted">All weeks</p>
        <ul className="grid grid-cols-4 gap-x-2 gap-y-2">
          {weeks.map((x) => (
            <li key={x} className="min-w-0">
              <span className={`t-label block ${has(ex, x) ? 'text-muted' : 'text-muted line-through'}`}>W{x}</span>
              {has(ex, x) ? (
                <span className="block truncate text-sm tabular-nums text-fg" title={ex.plannedByWeek[x]}>
                  {ex.plannedByWeek[x]}
                </span>
              ) : (
                <span className="block text-sm text-muted">— skip</span>
              )}
            </li>
          ))}
        </ul>
      </div>

      {programmed && copyTargets.length ? (
        <Button
          variant="ghost"
          className="mt-3 w-full"
          onClick={() => edit((p) => copyPlanned(p, di, ei, w, copyTargets))}
        >
          Copy W{w} → {weekList(copyTargets)}
        </Button>
      ) : null}
    </div>
  );
}

function Stepper({
  label,
  value,
  onDec,
  onInc,
  decDisabled = false,
}: {
  label: string;
  value: string;
  onDec: () => void;
  onInc: () => void;
  decDisabled?: boolean;
}) {
  // "Load · % 1RM" → "load"; "Rest · every week" → "rest".
  const name = label.split(' · ')[0].toLowerCase();
  const btn =
    'flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-lg text-fg transition-colors hover:bg-tappable-hover disabled:opacity-30 disabled:hover:bg-transparent';
  return (
    <div className="min-w-0">
      <p className="t-label mb-1 text-muted">{label}</p>
      <div className="flex items-center rounded-control bg-tappable">
        <button type="button" onClick={onDec} disabled={decDisabled} className={btn} aria-label={`Less ${name}`}>
          −
        </button>
        <output className="min-w-0 flex-1 truncate text-center font-display text-lg tabular-nums text-fg">{value}</output>
        <button type="button" onClick={onInc} className={btn} aria-label={`More ${name}`}>
          +
        </button>
      </div>
    </div>
  );
}
