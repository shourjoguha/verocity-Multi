import { METRICS } from '@/app.config';
import type { JumpMarkKind, LogItem, SetActual } from '@/lib/types';
import { formatSetActual } from '@/lib/format';
import { restAfterSet } from '@/lib/logEdits';
import { haptic } from '@/lib/haptics';
import { Button } from '@/components/ui/primitives';
import SegmentedTabs from '@/components/ui/SegmentedTabs';
import { DemoIconButton } from '@/components/MovementDemo';
import { CopyGlyph, MoreGlyph, PlusGlyph } from '@/components/ui/icons';
import { SetFields } from '@/components/logger/SetFields';
import { copyPreviousPatch, previousLoggedSet, rpeScale, rpeTapPatch, selectedRpe } from '@/components/logger/focusSet';

// The movement you are working on, as the Logger's focus card shows it: only
// the LIVE set, large — its fields, an RPE picker and one primary "Log set N" —
// with the movement's other sets as compact chips above.
//
// A VIEW, not a second logger. Every write goes through the callbacks, which
// the Logger binds to the same `patchSetActual` calls the set row and
// SetEntrySheet make; logging patches `{ completed: true }` and nothing else,
// exactly as the sheet's Log does. Which fields render is SetFields' decision,
// shared with the sheet. RPE is the one deliberate difference in shape: a
// picker that starts EMPTY unless this set was rated (focusSet.ts), so a set
// logged without touching it records RPE the way the sheet's untouched stepper
// does — the seeded value, `rpeRated: false`.
//
// Nothing here moves focus. No field auto-focuses when the card appears:
// raising the iOS keyboard mid-layout is a known flicker source (LESSONS §
// "A sheet flickers…"), and the steppers do not need a keyboard.

const ICON_BTN = 'hill-btn flex h-11 w-11 shrink-0 items-center justify-center transition-colors';
const GLYPH = 'h-[1.15rem] w-[1.15rem]';

const clockOf = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

// "150 × 5" without the RPE — a chip carries RPE as its own quiet suffix.
const valueText = (a: SetActual) => formatSetActual({ ...a, rpe: undefined });

export function FocusItem({
  item,
  liveKi,
  markKind,
  grouped,
  onPatchSet,
  onLogSet,
  onOpenSet,
  onToggleSet,
  onAddSet,
  onCycleMetric,
  onToggleAll,
  onOptions,
  onDemo,
}: {
  item: LogItem;
  /** The set being logged, or null when every set is already logged. */
  liveKi: number | null;
  markKind: JumpMarkKind | null;
  /** Inside a superset/circuit card: no outer corners to round. */
  grouped: boolean;
  onPatchSet: (ki: number, patch: Partial<SetActual>) => void;
  onLogSet: (ki: number) => void;
  onOpenSet: (ki: number) => void;
  onToggleSet: (ki: number) => void;
  onAddSet: () => void;
  onCycleMetric: () => void;
  onToggleAll: () => void;
  onOptions: () => void;
  onDemo: () => void;
}) {
  const live = liveKi != null ? item.sets[liveKi] : null;
  const doneCount = item.sets.filter((s) => s.actual.completed).length;
  const allDone = item.sets.length > 0 && doneCount === item.sets.length;
  const prevKi = liveKi != null ? previousLoggedSet(item, liveKi) : -1;
  const rest = liveKi != null ? restAfterSet(item, liveKi) : item.restSeconds;
  const metricLabel = METRICS[item.primaryMetric].label;

  return (
    <div>
      {/* Identity band — the same shape as the full card's: the ✓ cell is
          "complete the whole movement", the name carries the demo icon, ⋯
          opens movement options (notes, rest, swap, move, superset, delete).
          Delete lives only behind ⋯, never beside Log. */}
      <div className="flex items-stretch">
        <button
          type="button"
          onClick={onToggleAll}
          className={`flex w-11 shrink-0 items-center justify-center border-r text-sm transition-colors ${
            grouped ? '' : 'rounded-tl-card'
          } ${allDone ? 'border-r-accent bg-accent text-accent-fg' : 'border-r-transparent bg-tappable text-muted'}`}
          aria-label="Complete movement"
          aria-pressed={allDone}
        >
          <span aria-hidden>✓</span>
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-2 pl-2.5">
          <span className="flex min-h-11 min-w-0 items-center font-display text-base uppercase text-fg">
            <span className="truncate">{item.movement}</span>
          </span>
          <DemoIconButton name={item.movement} onOpen={onDemo} />
        </div>
        <span className="flex shrink-0 items-center pl-2 t-label text-faint tabular-nums">
          {doneCount}/{item.sets.length}
        </span>
        <button
          type="button"
          onClick={onOptions}
          className={`${ICON_BTN} self-center text-muted hover:text-fg`}
          aria-label="Movement options"
          title="Movement options"
        >
          <MoreGlyph className={GLYPH} />
        </button>
      </div>

      {/* The live line. "Set N of M" is the in-progress accent as text: it
          measures 4.84:1 on --color-surface in light and 12.9:1 in dark, so it
          clears 4.5:1 for small text in both. The copy key sits hard right on
          this same line, disabled (not hidden) when nothing before the live set
          is logged, so its position never moves. */}
      <div className="flex items-center gap-2 border-t border-border-soft pl-4">
        <p className="min-w-0 flex-1 truncate text-sm tabular-nums">
          {live ? (
            <>
              <span className="text-teal">
                Set {liveKi! + 1} of {item.sets.length}
              </span>
              <span className="text-muted">
                {live.planned ? ` · plan ${live.planned}` : ''}
                {rest != null ? ` · rest ${clockOf(rest)}` : ''}
              </span>
            </>
          ) : (
            <span className="text-muted">
              {item.sets.length === 0
                ? 'No sets — add one below'
                : `All ${item.sets.length} ${item.sets.length === 1 ? 'set' : 'sets'} logged`}
            </span>
          )}
        </p>
        <button
          type="button"
          disabled={!live || prevKi < 0}
          onClick={() => {
            if (liveKi == null || prevKi < 0) return;
            haptic(8);
            // A patch like any stepper tap: fields change, nothing is logged.
            onPatchSet(liveKi, copyPreviousPatch(item.sets[prevKi].actual));
          }}
          className={`${ICON_BTN} text-muted hover:text-fg disabled:opacity-40 disabled:hover:text-muted`}
          aria-label="Copy previous set"
          title={prevKi >= 0 ? `Copy set ${prevKi + 1}` : 'No logged set to copy'}
        >
          <CopyGlyph className="h-4 w-4" />
        </button>
      </div>

      {/* Every other set of this movement, as a chip: logged ones filled, open
          ones (later sets, or one skipped earlier) hollow. The ✓ half toggles
          completion — the un-tick — and the value half opens SetEntrySheet,
          which owns typed entry, Copy to next and Delete set. Two targets per
          chip, side by side, each a real 44px tall: chips wrap in a ROW, so
          nothing here fakes height. */}
      {item.sets.length > (live ? 1 : 0) ? (
        <div className="flex flex-wrap gap-1.5 px-4 pb-1">
          {item.sets.map((s, ki) => {
            if (ki === liveKi) return null;
            const done = s.actual.completed;
            const value = valueText(s.actual);
            return (
              <div key={ki} className="flex items-stretch rounded-control bg-tappable">
                <button
                  type="button"
                  onClick={() => {
                    haptic();
                    onToggleSet(ki);
                  }}
                  aria-label={`Toggle completed, set ${ki + 1}`}
                  aria-pressed={done}
                  className="flex min-h-11 w-9 shrink-0 items-center justify-center"
                >
                  <span
                    aria-hidden
                    className={`flex h-5 w-5 items-center justify-center rounded-chip border text-[0.65rem] ${
                      done ? 'border-accent bg-accent text-accent-fg' : 'border-border text-transparent'
                    }`}
                  >
                    ✓
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onOpenSet(ki)}
                  aria-label={`Edit set ${ki + 1} — ${value}`}
                  className="flex min-h-11 items-baseline gap-1 self-stretch py-3 pr-3 text-left"
                >
                  <span className="t-label text-faint tabular-nums">{ki + 1}</span>
                  <span className={`text-sm tabular-nums ${done ? 'text-fg' : 'text-muted'}`}>{value}</span>
                  {s.actual.rpe != null ? (
                    <span className="text-xs tabular-nums text-muted">@{s.actual.rpe}</span>
                  ) : null}
                </button>
              </div>
            );
          })}
        </div>
      ) : null}

      {live ? (
        <div className="flex flex-col gap-2 px-4 pb-3 pt-2">
          <SetFields
            metric={item.primaryMetric}
            markKind={markKind}
            actual={live.actual}
            onPatch={(patch) => onPatchSet(liveKi!, patch)}
            stepLabel
          />
          <div className="mt-1 t-label text-muted">RPE</div>
          {/* Pick-one → SegmentedTabs. `active` is '' unless THIS set was
              rated, so nothing is selected for a seeded value; tapping the
              selected value again withdraws the rating (rpeTapPatch). */}
          <SegmentedTabs
            as="radiogroup"
            ariaLabel="RPE"
            size="numeric"
            tabs={rpeScale(selectedRpe(live.actual)).map((v) => ({ key: String(v), label: String(v) }))}
            active={selectedRpe(live.actual) != null ? String(selectedRpe(live.actual)) : ''}
            onChange={(k) => onPatchSet(liveKi!, rpeTapPatch(live.actual, Number(k)))}
          />
          <Button
            onClick={() => {
              haptic();
              onLogSet(liveKi!);
            }}
            className="mt-2 min-h-14 w-full text-sm"
          >
            Log set {liveKi! + 1}
          </Button>
        </div>
      ) : null}

      {/* Movement controls, one line, none destructive: add set, the metric
          (written out; tapping cycles it), and the live set's own sheet for
          Copy to next / Delete set / typed entry. */}
      <div className="flex items-center border-t border-border-soft px-2 text-muted">
        <button
          type="button"
          onClick={onAddSet}
          className="hill-btn flex h-11 min-w-11 shrink-0 items-center justify-center gap-1 px-2 t-control transition-colors hover:text-fg"
          aria-label="Add set"
          title="Add set"
        >
          <PlusGlyph className="h-4 w-4" />
          Set
        </button>
        <button
          type="button"
          onClick={onCycleMetric}
          className="hill-btn flex h-11 min-w-11 shrink-0 items-center justify-center gap-1 px-2 t-control text-fg transition-colors"
          aria-label={`Metric: ${metricLabel}. Change metric`}
          title={`Metric: ${metricLabel}`}
        >
          {metricLabel}
          <span aria-hidden className="text-faint">
            ↻
          </span>
        </button>
        <span className="flex-1" />
        {live ? (
          <button
            type="button"
            onClick={() => onOpenSet(liveKi!)}
            className="flex min-h-11 shrink-0 items-center px-2 t-control text-muted hover:text-fg"
            aria-label={`Set ${liveKi! + 1} options`}
          >
            Set {liveKi! + 1} ⋯
          </button>
        ) : null}
      </div>
    </div>
  );
}
