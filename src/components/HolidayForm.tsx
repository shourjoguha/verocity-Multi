import { useState } from 'react';
import { HOLIDAY_KINDS, type HolidayKindKey } from '@/app.config';
import { addDays, holidayDays, isActiveHoliday, validateHoliday } from '@/lib/holidays';
import { createHoliday, deleteHoliday, updateHoliday } from '@/lib/queries';
import { ymdLocal } from '@/lib/streak';
import { toast } from '@/lib/toast';
import type { Holiday } from '@/lib/types';
import { Button } from '@/components/ui/primitives';
import { HolidayGlyph, HolidayScene } from '@/components/HolidayScene';

// Add or edit one holiday. Shared by Log Activity (Session / Holiday) and
// Settings → Holidays, so the two entry points cannot drift apart.
//
// A holiday is a date range, never a log: saving here writes `holidays`
// (migration 0049), not workout_logs, so nothing on it reaches volume, the
// body map or the session stats. The overlap check below names the clash; the
// database's exclusion constraint is the real guard.

const field =
  'min-h-11 w-full min-w-0 border border-border bg-surface px-3 text-base text-fg outline-none focus:border-subtle';
const label = 'mb-2 block t-control text-muted';

export function HolidayForm({
  holiday,
  others,
  onSaved,
  onDeleted,
  onCancel,
}: {
  /** The holiday being edited, or null for a new one. */
  holiday: Holiday | null;
  /** Every other holiday on file, for the overlap check. */
  others: Holiday[];
  onSaved: (h: Holiday) => void;
  onDeleted?: (id: string) => void;
  onCancel?: () => void;
}) {
  const today = ymdLocal(new Date());
  const [kind, setKind] = useState<HolidayKindKey>(holiday?.kind ?? 'hike');
  const [name, setName] = useState(holiday?.name ?? '');
  const [from, setFrom] = useState(holiday?.starts_on ?? today);
  const [to, setTo] = useState(holiday?.ends_on ?? addDays(today, 6));
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const draft = { kind, starts_on: from, ends_on: to };
  const error = validateHoliday(draft, others.filter((h) => h.id !== holiday?.id));

  async function save() {
    if (error || saving) return;
    setSaving(true);
    const input = { kind, name: name.trim() || null, starts_on: from, ends_on: to };
    const res = holiday ? await updateHoliday(holiday.id, input) : await createHoliday(input);
    setSaving(false);
    if (!res.ok) {
      toast(res.error === 'overlap' ? 'Those dates overlap another holiday' : 'Could not save the holiday', 'error');
      return;
    }
    toast(holiday ? 'Holiday updated' : 'Holiday added', 'success');
    onSaved(res.holiday);
  }

  async function remove() {
    if (!holiday || saving) return;
    setSaving(true);
    const ok = await deleteHoliday(holiday.id);
    setSaving(false);
    if (!ok) {
      toast('Could not delete the holiday', 'error');
      return;
    }
    toast('Holiday deleted', 'success');
    onDeleted?.(holiday.id);
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <span className={label}>Kind</span>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(HOLIDAY_KINDS) as HolidayKindKey[]).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={kind === k}
              onClick={() => setKind(k)}
              className={`flex min-h-11 items-center gap-2 border px-3 t-control transition-colors ${
                kind === k ? 'border-fg text-fg' : 'border-border text-muted hover:text-fg'
              }`}
            >
              <HolidayGlyph kind={k} />
              {HOLIDAY_KINDS[k].label}
            </button>
          ))}
        </div>
      </div>

      <div className="h-24 overflow-hidden rounded-card border border-border bg-surface">
        <HolidayScene kind={kind} seed={9} />
      </div>

      <div>
        <label className={label} htmlFor="holiday-name">
          Name (optional)
        </label>
        <input
          id="holiday-name"
          type="text"
          value={name}
          maxLength={40}
          placeholder={HOLIDAY_KINDS[kind].label}
          onChange={(e) => setName(e.target.value)}
          className={`${field} placeholder:text-muted`}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="min-w-0">
          <label className={label} htmlFor="holiday-from">
            From
          </label>
          <input id="holiday-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={field} />
        </div>
        <div className="min-w-0">
          <label className={label} htmlFor="holiday-to">
            To
          </label>
          <input id="holiday-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className={field} />
        </div>
      </div>

      {error ? (
        <p className="text-sm text-down" role="alert">
          {error}
        </p>
      ) : (
        <p className="text-sm text-muted">
          {holidayDays(draft)} days. Not counted as training. Your streak pauses for those weeks, and the coach
          leaves the days out of its weekly rates
          {isActiveHoliday(draft) ? ', knowing you were on the move' : ''}.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={save} disabled={!!error || saving}>
          {saving ? 'Saving…' : holiday ? 'Save changes' : 'Add holiday'}
        </Button>
        {onCancel ? (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        {holiday && onDeleted ? (
          confirmDelete ? (
            <span className="inline-flex items-center gap-2 t-control">
              <span className="text-muted">Delete?</span>
              <button type="button" onClick={remove} className="-my-3 min-h-11 px-2 text-down">
                Yes
              </button>
              <button type="button" onClick={() => setConfirmDelete(false)} className="-my-3 min-h-11 px-2 text-muted">
                No
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="-my-3 min-h-11 px-2 t-control text-muted transition-colors hover:text-fg"
            >
              Delete
            </button>
          )
        ) : null}
      </div>
    </div>
  );
}
