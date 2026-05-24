import type { Plan } from '@/lib/types';
import { Modal } from '@/components/ui/Modal';

// "New session" chooser: a plan day, a blank workout, or a non-lifting activity.
// An optional date (from the calendar) is forwarded so the session lands on the
// chosen day rather than today.
export function AddSessionMenu({
  plan,
  date,
  open,
  onClose,
}: {
  plan: Plan | null;
  date?: string;
  open: boolean;
  onClose: () => void;
}) {
  const dateQ = date ? `date=${date}` : '';
  const blankHref = `/app/log${dateQ ? `?${dateQ}` : ''}`;
  const activityHref = `/app/activity${dateQ ? `?${dateQ}` : ''}`;
  const dayHref = (dayKey: string) =>
    `/app/log?day=${encodeURIComponent(dayKey)}${dateQ ? `&${dateQ}` : ''}`;

  return (
    <Modal open={open} onClose={onClose} title={date ? 'New session' : 'Start something'}>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {plan && plan.parsed.days.length > 0 ? (
          <>
            <div className="mb-2 text-[0.65rem] uppercase tracking-[0.2em] text-muted">
              From {plan.parsed.title}
            </div>
            <ul className="mb-5 border border-border">
              {plan.parsed.days.map((d) => (
                <li key={d.dayKey}>
                  <a
                    href={dayHref(d.dayKey)}
                    className="flex items-center justify-between border-b border-border px-4 py-3 text-sm transition-colors last:border-b-0 hover:bg-elevated"
                  >
                    <span className="text-fg">{d.label}</span>
                    <span className="text-muted">→</span>
                  </a>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        <div className="flex flex-col gap-2">
          <a
            href={blankHref}
            className="inline-flex min-h-12 items-center justify-center border border-border px-4 text-sm uppercase tracking-wider text-fg transition-colors hover:border-fg"
          >
            Blank workout
          </a>
          <a
            href={activityHref}
            className="inline-flex min-h-12 items-center justify-center border border-border px-4 text-sm uppercase tracking-wider text-fg transition-colors hover:border-fg"
          >
            Log activity
          </a>
        </div>
      </div>
    </Modal>
  );
}
