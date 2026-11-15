import { useEffect, useState } from 'react';
import { getActivePlan } from '@/lib/queries';
import { getCached, setCached } from '@/lib/queryCache';
import type { Plan } from '@/lib/types';
import { AddSessionMenu } from '@/components/AddSessionMenu';
import { readOnlyProps } from '@/components/ui/ReadOnly';

// The ribbon's centre slot. It used to be a plain <a href="/app/log">, which
// dropped you straight into a blank workout — and since the Logger calls
// createLog({ status: 'in_progress' }) on mount, a mistap left a real row
// behind. Now it asks first, reusing the same AddSessionMenu sheet that Home's
// "Start workout" and the calendar's day tap already open: plan days, minis,
// saved sessions, blank workout, or an activity.
//
// The tab bar is otherwise static Astro, so this is the one island in the
// layout. It is deliberately tiny — AddSessionMenu and Modal are already in the
// /app bundle graph via ProfileView (which now hosts the calendar), so it adds
// no new chunk.
// `glyph` is accepted for callsite compatibility with the Astro layout. The
// button sits beside the dock (not inside it) as a square accent cell with a
// plus, drawn on the same grid and stroke as the dock icons in
// `src/layouts/App.astro`. The label is its accessible name.
export function LogTabButton({
  label,
  glyph: _glyph,
  readOnly = false,
}: {
  label: string;
  glyph: string;
  // Showcase: the slot keeps its place, its icon and its label, and refuses.
  // Passed from App.astro rather than derived from the URL because this island
  // is server-rendered — guessing at hydration would change the markup.
  readOnly?: boolean;
}) {
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
        {...(readOnly
          ? readOnlyProps(true)
          : { onClick: () => setOpen(true), 'aria-haspopup': 'dialog' as const, 'aria-expanded': open })}
        aria-label={label}
        className="tab-bubble-primary grid h-14 w-14 shrink-0 place-items-center"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-6 w-6"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
      <AddSessionMenu plan={plan} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

export default LogTabButton;
