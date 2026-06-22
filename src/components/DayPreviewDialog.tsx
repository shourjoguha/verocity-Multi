import { SECTIONS } from '@/app.config';
import type { PlanDay } from '@/lib/types';
import { Modal } from '@/components/ui/Modal';

// Preview a plan day's prescription for the current week, then start it.
export function DayPreviewDialog({
  day,
  week,
  open,
  onClose,
}: {
  day: PlanDay | null;
  week: number;
  open: boolean;
  onClose: () => void;
}) {
  const grouped = SECTIONS.map((key) => ({
    key,
    items: (day?.exercises ?? []).filter((e) => e.section === key),
  })).filter((s) => s.items.length > 0);

  return (
    <Modal open={open && !!day} onClose={onClose} title={day?.label ?? 'Day'}>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {grouped.length === 0 ? (
          <p className="text-sm text-muted">No movements on this day.</p>
        ) : (
          <div className="flex flex-col gap-5">
            {grouped.map((s) => (
              <div key={s.key}>
                <div className="mb-2 t-label text-muted">{s.key}</div>
                <ul className="flex flex-col gap-1.5">
                  {s.items.map((ex, i) => (
                    <li key={i} className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="capitalize text-fg">{ex.movement}</span>
                      <span className="shrink-0 tabular-nums text-subtle">
                        {ex.plannedByWeek[week] ?? '—'}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="border-t border-border p-4">
        <a
          href={day ? `/app/log?day=${encodeURIComponent(day.dayKey)}` : '#'}
          className="inline-flex min-h-12 w-full items-center justify-center bg-fg px-4 text-sm uppercase tracking-wider text-bg transition-colors hover:bg-fg/85"
        >
          Start workout
        </a>
      </div>
    </Modal>
  );
}
