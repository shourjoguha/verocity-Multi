import { useEffect, useState } from 'react';
import { getActivePlan } from '@/lib/queries';
import { getCached, setCached } from '@/lib/queryCache';
import type { Plan } from '@/lib/types';
import { AddSessionMenu } from '@/components/AddSessionMenu';

// The ribbon's centre slot. It used to be a plain <a href="/app/log">, which
// dropped you straight into a blank workout — and since the Logger calls
// createLog({ status: 'in_progress' }) on mount, a mistap left a real row
// behind. Now it asks first, reusing the same AddSessionMenu sheet that Home's
// "Start workout" and the calendar's day tap already open: plan days, minis,
// saved sessions, blank workout, or an activity.
//
// The tab bar is otherwise static Astro, so this is the one island in the
// layout. It is deliberately tiny — AddSessionMenu and Modal are already in the
// /app bundle graph via ProfileView and CalendarView, so it adds no new chunk.
export function LogTabButton({ label, glyph }: { label: string; glyph: string }) {
  const [open, setOpen] = useState(false);
  // Seed-then-revalidate, the same idiom ProfileView uses: on a tab navigation
  // the module cache is warm and the sheet opens with the plan already there;
  // on a cold load the first open fetches it.
  const [plan, setPlan] = useState<Plan | null>(() => getCached<Plan>('plan:active') ?? null);

  useEffect(() => {
    if (!open || plan) return;
    getActivePlan().then((p) => {
      setCached('plan:active', p);
      setPlan(p);
    });
  }, [open, plan]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="flex min-h-13 flex-1 flex-col items-center justify-center gap-0.5 text-muted transition-colors duration-150 hover:text-fg"
      >
        <span aria-hidden="true" className="flex h-8 w-12 items-center justify-center">
          <span className="flex h-7 w-7 items-center justify-center border border-fg bg-fg text-xl leading-none text-bg">
            {glyph}
          </span>
        </span>
        <span className="t-control">{label}</span>
      </button>
      <AddSessionMenu plan={plan} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

export default LogTabButton;
