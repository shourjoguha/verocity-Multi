import { useEffect, useState } from 'react';
import { HOLIDAY_KINDS } from '@/app.config';
import { getHolidays } from '@/lib/queries';
import { holidayDays, holidayLabel, isActiveHoliday } from '@/lib/holidays';
import { formatDate } from '@/lib/format';
import { ymdLocal } from '@/lib/streak';
import {
  HOLIDAY_INKS,
  HOLIDAY_MOTIONS,
  setHolidayInk,
  setHolidayMotion,
  useHolidayInk,
  useHolidayMotion,
  type HolidayInk,
  type HolidayMotion,
} from '@/lib/holidayPrefs';
import type { Holiday } from '@/lib/types';
import { EmptyState, LoadingScreen, SectionHeader } from '@/components/ui/primitives';
import SegmentedTabs from '@/components/ui/SegmentedTabs';
import { HolidayForm } from '@/components/HolidayForm';
import { HolidayGlyph, HolidayScene } from '@/components/HolidayScene';

// Settings → Holidays: every planned break, plus how their scenes are drawn.
// Editing happens inline with the same form Log Activity uses.

const INK_LABEL: Record<HolidayInk, string> = { mono: 'Mono', colour: 'Colour' };
const MOTION_LABEL: Record<HolidayMotion, string> = { auto: 'Auto', on: 'On', still: 'Still' };

function Row({ h, onEdit }: { h: Holiday; onEdit: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onEdit}
        className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-elevated"
      >
        <span className="text-subtle">
          <HolidayGlyph kind={h.kind} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm text-fg">{holidayLabel(h)}</span>
          <span className="text-xs text-muted">
            {HOLIDAY_KINDS[h.kind].label} · {isActiveHoliday(h) ? 'active' : 'rest'} · {formatDate(h.starts_on)} –{' '}
            {formatDate(h.ends_on)} · {holidayDays(h)} days
          </span>
        </span>
        <span className="t-control text-muted">Edit</span>
      </button>
    </li>
  );
}

export function HolidaysSettings() {
  const [holidays, setHolidays] = useState<Holiday[] | null>(null);
  // null = the list; 'new' = adding; otherwise the id being edited.
  const [editing, setEditing] = useState<string | null>(null);
  const ink = useHolidayInk();
  const motion = useHolidayMotion();
  // Read after mount, never during render: the server cannot know it, and a
  // first client render that differs is React #418.
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    getHolidays().then(setHolidays);
    setReducedMotion(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }, []);

  if (holidays === null) return <LoadingScreen />;

  if (editing !== null) {
    const current = editing === 'new' ? null : (holidays.find((h) => h.id === editing) ?? null);
    const sorted = (list: Holiday[]) => [...list].sort((a, b) => a.starts_on.localeCompare(b.starts_on));
    return (
      <section className="mb-6">
        <SectionHeader>{current ? `Edit ${holidayLabel(current)}` : 'New holiday'}</SectionHeader>
        <HolidayForm
          key={editing}
          holiday={current}
          others={holidays}
          onSaved={(h) => {
            setHolidays(sorted([...holidays.filter((x) => x.id !== h.id), h]));
            setEditing(null);
          }}
          onDeleted={(id) => {
            setHolidays(holidays.filter((x) => x.id !== id));
            setEditing(null);
          }}
          onCancel={() => setEditing(null)}
        />
      </section>
    );
  }

  const today = ymdLocal(new Date());
  const upcoming = holidays.filter((h) => h.ends_on >= today);
  const past = holidays.filter((h) => h.ends_on < today).reverse();
  const preview = upcoming[0] ?? past[0] ?? null;

  return (
    <>
      <section className="mb-6">
        <SectionHeader
          action={
            <button
              type="button"
              onClick={() => setEditing('new')}
              className="-my-3 flex min-h-11 items-center t-control text-muted transition-colors hover:text-fg"
            >
              + Add holiday
            </button>
          }
        >
          Your holidays
        </SectionHeader>
        {holidays.length === 0 ? (
          <EmptyState>
            No holidays yet. A planned break pauses your streak and is left out of the coach&apos;s weekly rates,
            without counting as training.
          </EmptyState>
        ) : (
          <div className="overflow-hidden rounded-card border border-border bg-surface">
            {upcoming.length > 0 ? (
              <>
                <div className="border-b border-border-soft bg-bg px-3 py-1.5 t-label text-faint">Upcoming</div>
                <ul className="divide-y divide-border-soft">
                  {upcoming.map((h) => (
                    <Row key={h.id} h={h} onEdit={() => setEditing(h.id)} />
                  ))}
                </ul>
              </>
            ) : null}
            {past.length > 0 ? (
              <>
                <div className="border-y border-border-soft bg-bg px-3 py-1.5 t-label text-faint">Past</div>
                <ul className="divide-y divide-border-soft">
                  {past.map((h) => (
                    <Row key={h.id} h={h} onEdit={() => setEditing(h.id)} />
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        )}
      </section>

      <section className="mb-6">
        <SectionHeader>Scenes</SectionHeader>
        <div className="grid gap-2">
          <div className="mb-1 t-label text-muted">Ink</div>
          <SegmentedTabs
            as="radiogroup"
            size="sm"
            ariaLabel="Holiday scene ink"
            tabs={HOLIDAY_INKS.map((k) => ({ key: k, label: INK_LABEL[k] }))}
            active={ink}
            onChange={(k) => setHolidayInk(k as HolidayInk)}
          />
          <div className="mt-3 mb-1 t-label text-muted">Motion</div>
          <SegmentedTabs
            as="radiogroup"
            size="sm"
            ariaLabel="Holiday scene motion"
            tabs={HOLIDAY_MOTIONS.map((k) => ({ key: k, label: MOTION_LABEL[k] }))}
            active={motion}
            onChange={(k) => setHolidayMotion(k as HolidayMotion)}
          />
          <div className="mt-3 h-20 overflow-hidden rounded-card border border-border bg-surface">
            <HolidayScene kind={preview?.kind ?? 'dive'} seed={4} />
          </div>
          <p className="text-xs text-muted">
            This device only. Scenes appear on the calendar and the Stats consistency grid.{' '}
            {reducedMotion
              ? motion === 'auto'
                ? 'Your device asks for reduced motion, so Auto keeps them still. Pick On to animate anyway.'
                : motion === 'on'
                  ? 'Animating even though your device asks for reduced motion.'
                  : ''
              : 'Auto follows your device’s reduced-motion setting.'}
          </p>
        </div>
      </section>
    </>
  );
}
