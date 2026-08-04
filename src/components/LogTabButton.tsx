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
// /app bundle graph via ProfileView (which now hosts the calendar), so it adds
// no new chunk.
// `glyph` is accepted for callsite compatibility with the Astro layout, but the
// centre slot now renders the shared scroll-and-quill SVG so the ribbon stays
// on one icon set. See the ribbon icon block in `src/layouts/App.astro`.
export function LogTabButton({ label, glyph: _glyph }: { label: string; glyph: string }) {
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
        className="tab-bubble-primary flex min-h-13 flex-1 flex-col items-center justify-center gap-0.5"
      >
        {/* Geometry mirrors the plain tabs in App.astro — same min-h-13 cell,
            same h-8 glyph row — so the ribbon stays on one baseline. SVG must
            mirror the `log` case in App.astro (same viewBox, stroke, paths) so
            the ribbon reads as one set; currentColor lets the primary (ink)
            slot paint the stroke in paper. */}
        <span aria-hidden="true" className="flex h-8 items-center justify-center text-[1.75rem] leading-none">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-7 w-7"
          >
            <path d="M4 5.5 C 4 4.2 5 3.5 6 3.5 H12 C 13.1 3.5 14 4.5 14 5.8 V6.6 C 14 7.6 13.2 8.4 12.2 8.4 H5.5 C 4.6 8.4 4 7.8 4 7 Z" />
            <path d="M5.5 8.4 V17.2 C 5.5 18.7 4.5 19.7 3 19.7" />
            <path d="M3 19.7 H10.5 C 12 19.7 13 18.7 13 17.2 V16.4 H5.5" />
            <path d="M7 12.4 Q 8.5 11.6 10 12.4 T 12 12.4" />
            <path d="M20.5 3.8 L15 9.2" />
            <path d="M15 9.2 Q 13.6 6.6 15.8 5.2 Q 18 4.4 19.8 4.6" />
          </svg>
        </span>
        <span className="t-control">{label}</span>
      </button>
      <AddSessionMenu plan={plan} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

export default LogTabButton;
