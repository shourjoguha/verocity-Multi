import { useEffect, useState } from 'react';
import type { Plan, Session } from '@/lib/types';
import { getAllPlans, getSessions } from '@/lib/queries';
import type { MiniPreset } from '@/lib/logBuilder';
import { Modal } from '@/components/ui/Modal';

// "New session" chooser: a full or shortened active-plan day, a plan "mini", a
// saved session, a past-plan day, a blank workout, or a non-lifting activity. An
// optional date (from the calendar) is forwarded so the session lands on the
// chosen day. Saved sessions / past plans (collapsed behind "More") and the
// plan's minis are fetched lazily the first time the menu opens.
type Shorten = 'full' | MiniPreset;
const SHORTEN: { key: Shorten; label: string }[] = [
  { key: 'full', label: 'Full' },
  { key: 'express', label: 'Express' },
  { key: 'half', label: 'Half' },
];

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
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [showMore, setShowMore] = useState(false);
  const [shorten, setShorten] = useState<Shorten>('full');

  useEffect(() => {
    if (open && sessions === null) getSessions().then(setSessions);
    if (open && plans === null) getAllPlans().then(setPlans);
  }, [open, sessions, plans]);

  // Past plans = everything except the active one (its days are shown up top).
  const pastPlans = (plans ?? []).filter((p) => p.id !== plan?.id && p.parsed.days.length > 0);
  // Minis tagged to the active plan get their own quick group; generic saved
  // sessions (non-mini) live in the collapsed "More" section.
  const planMinis = (sessions ?? []).filter((s) => s.is_mini && s.source_plan_id === plan?.id);
  const savedSessions = (sessions ?? []).filter((s) => !s.is_mini);

  const dateQ = date ? `date=${date}` : '';
  const suffix = dateQ ? `?${dateQ}` : '';
  const miniQ = shorten === 'full' ? '' : `&mini=${shorten}`;
  const blankHref = `/app/log${suffix}`;
  const activityHref = `/app/activity${suffix}`;
  const dayHref = (dayKey: string) =>
    `/app/log?day=${encodeURIComponent(dayKey)}${dateQ ? `&${dateQ}` : ''}${miniQ}`;
  const planDayHref = (planId: string, dayKey: string) =>
    `/app/log?plan=${encodeURIComponent(planId)}&day=${encodeURIComponent(dayKey)}${dateQ ? `&${dateQ}` : ''}${miniQ}`;
  const sessionHref = (id: string) =>
    `/app/log?session=${encodeURIComponent(id)}${dateQ ? `&${dateQ}` : ''}`;

  const rowClass =
    'flex items-center justify-between border-b border-border px-4 py-3 text-sm transition-colors last:border-b-0 hover:bg-elevated';
  const groupLabelClass = 'mb-2 text-[0.65rem] uppercase tracking-[0.2em] text-muted';
  const hasMore = savedSessions.length > 0 || pastPlans.length > 0;

  return (
    <Modal open={open} onClose={onClose} title={date ? 'New session' : 'Start something'}>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {plan && plan.parsed.days.length > 0 ? (
          <>
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="text-[0.65rem] uppercase tracking-[0.2em] text-muted">
                From {plan.parsed.title}
              </span>
              {/* Short on time? Trim the picked day to a mini, primaries intact. */}
              <div className="flex gap-1" title="Shorten the workout">
                {SHORTEN.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => setShorten(s.key)}
                    aria-pressed={shorten === s.key}
                    className={`hill-btn border bg-surface px-2 py-1 text-[0.6rem] uppercase tracking-wider transition-colors ${
                      shorten === s.key ? 'border-fg text-fg' : 'border-border text-muted hover:text-fg'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
            <ul className="mb-5 border border-border">
              {plan.parsed.days.map((d) => (
                <li key={d.dayKey}>
                  <a href={dayHref(d.dayKey)} className={rowClass}>
                    <span className="text-fg">{d.label}</span>
                    <span className="text-muted">{shorten === 'full' ? '→' : `${shorten} →`}</span>
                  </a>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        {planMinis.length > 0 ? (
          <div className="mb-5">
            <div className={groupLabelClass}>{plan?.parsed.title} · minis</div>
            <ul className="border border-border">
              {planMinis.map((s) => (
                <li key={s.id}>
                  <a href={sessionHref(s.id)} className={rowClass}>
                    <span className="truncate text-fg">{s.name}</span>
                    <span className="text-muted">→</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {hasMore ? (
          <div className="mb-5">
            <button
              type="button"
              onClick={() => setShowMore((v) => !v)}
              aria-expanded={showMore}
              className="hill-btn flex min-h-12 w-full items-center justify-between border border-border bg-surface px-4 text-[0.7rem] uppercase tracking-wider text-fg transition-colors hover:border-fg"
            >
              <span>Past plans &amp; saved sessions</span>
              <span className="text-muted">{showMore ? '−' : '+'}</span>
            </button>

            {showMore ? (
              <div className="mt-3 flex flex-col gap-5">
                {savedSessions.length > 0 ? (
                  <div>
                    <div className="flex items-baseline justify-between">
                      <span className={groupLabelClass}>Saved sessions</span>
                      <a
                        href="/app/sessions"
                        className="text-[0.65rem] uppercase tracking-wider text-muted hover:text-fg"
                      >
                        Manage →
                      </a>
                    </div>
                    <ul className="border border-border">
                      {savedSessions.map((s) => (
                        <li key={s.id}>
                          <a href={sessionHref(s.id)} className={rowClass}>
                            <span className="truncate text-fg">{s.name}</span>
                            <span className="text-muted">→</span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {pastPlans.map((p) => (
                  <div key={p.id}>
                    <div className={groupLabelClass}>{p.parsed.title || p.name}</div>
                    <ul className="border border-border">
                      {p.parsed.days.map((d) => (
                        <li key={d.dayKey}>
                          <a href={planDayHref(p.id, d.dayKey)} className={rowClass}>
                            <span className="text-fg">{d.label}</span>
                            <span className="text-muted">{shorten === 'full' ? '→' : `${shorten} →`}</span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-col gap-2">
          <a
            href={blankHref}
            className="hill-btn inline-flex min-h-12 items-center justify-center border border-border bg-surface px-4 text-sm uppercase tracking-wider text-fg transition-colors hover:border-fg"
          >
            Blank workout
          </a>
          <a
            href={activityHref}
            className="hill-btn inline-flex min-h-12 items-center justify-center border border-border bg-surface px-4 text-sm uppercase tracking-wider text-fg transition-colors hover:border-fg"
          >
            Log activity
          </a>
        </div>
      </div>
    </Modal>
  );
}
