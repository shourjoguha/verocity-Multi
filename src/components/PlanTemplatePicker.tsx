// The "Ready plan" tab of /app/plan/upload: a dropdown over the curated
// plan_templates catalogue (0050), a preview of the chosen plan, and one
// action. Adopting copies the template into a new owned plan, re-dated to
// today, and makes it active.
//
// The default is the FIRST template by sort_order — the catalogue's order is
// the curation, so the default is changed in data, never by a name in here.
//
// The list opens IN FLOW (it pushes the preview down) rather than floating:
// no overlay, no z-order against the bottom nav, nothing to animate — see
// docs/LESSONS.md § Rendering for what overlays here have cost.
//
// The action bar is `sticky bottom-0` inside [data-scroll-root], the pattern
// the Logger's Finish bar uses; it is opaque (no blur) so touch Safari has no
// backdrop to re-sample.
import { useEffect, useRef, useState } from 'react';
import { BLOCKS } from '@/app.config';
import { adoptPlanTemplate, getActivePlan } from '@/lib/queries';
import { planWeeks } from '@/lib/planRebase';
import type { Plan, PlanTemplate } from '@/lib/types';
import { track } from '@/lib/analytics';
import { Button } from '@/components/ui/primitives';

function meta(t: PlanTemplate): string {
  const days = t.parsed.days.length;
  const base = `${planWeeks(t.parsed)} wk · ${days} day${days === 1 ? '' : 's'}/wk`;
  return t.summary ? `${t.summary} · ${base}` : base;
}

// Proportional phase strip. Block colour is data (CLAUDE.md "colour only on
// data"), read from BLOCKS exactly as PlanEditor and ShareView do.
function BlockStrip({ t, thin = false }: { t: PlanTemplate; thin?: boolean }) {
  return (
    <span aria-hidden className={`flex w-full gap-0.5 ${thin ? 'h-1' : 'h-2'}`}>
      {t.parsed.blocks.map((b, i) => (
        <span
          key={i}
          className="rounded-[2px]"
          style={{ flexGrow: b.endWeek - b.startWeek + 1, backgroundColor: BLOCKS[b.type]?.color }}
        />
      ))}
    </span>
  );
}

function ChevronIcon({ up }: { up: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d={up ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} />
    </svg>
  );
}

export default function PlanTemplatePicker({
  templates,
  onBuild,
}: {
  templates: PlanTemplate[];
  onBuild: () => void;
}) {
  const [selectedId, setSelectedId] = useState(templates[0]?.id ?? '');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<Plan | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    getActivePlan()
      .then(setActive)
      .catch(() => setActive(null));
  }, []);

  // Close on Escape or a press outside the dropdown.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onDown = (e: PointerEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [open]);

  const t = templates.find((x) => x.id === selectedId) ?? templates[0];
  if (!t) return null;

  const weeks = planWeeks(t.parsed);
  const starts = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

  function pick(id: string) {
    setSelectedId(id);
    setOpen(false);
    setConfirming(false);
    setError(null);
    triggerRef.current?.focus();
  }

  async function start() {
    if (active && !confirming) {
      setConfirming(true);
      return;
    }
    setBusy(true);
    setError(null);
    const plan = await adoptPlanTemplate(t);
    if (!plan) {
      setBusy(false);
      setError('Could not start that plan. Check your connection and try again.');
      return;
    }
    track('plan_adopted', { template: t.name });
    window.location.href = '/app/plan';
  }

  const label = 't-label text-muted';
  const stat = 'border-border-soft p-3.5';

  return (
    <>
      <div ref={boxRef} className="flex flex-col gap-2">
        <span id="plan-picker-label" className={label}>
          Program
        </span>
        <button
          ref={triggerRef}
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-labelledby="plan-picker-label plan-picker-value"
          onClick={() => setOpen((o) => !o)}
          className={`flex min-h-15 items-center gap-3 border border-fg bg-surface px-3.5 py-2.5 text-left text-fg ${
            open ? 'rounded-t-control' : 'rounded-control'
          }`}
        >
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span id="plan-picker-value" className="truncate text-base font-semibold">
              {t.name}
            </span>
            <span className="truncate text-xs text-muted tabular-nums">{meta(t)}</span>
          </span>
          <ChevronIcon up={open} />
        </button>

        {open ? (
          <div
            role="listbox"
            aria-label="Ready plans"
            className="-mt-2 overflow-hidden rounded-b-control border border-t-0 border-fg bg-surface"
          >
            {templates.map((x) => {
              const on = x.id === t.id;
              return (
                <button
                  key={x.id}
                  type="button"
                  role="option"
                  aria-selected={on}
                  onClick={() => pick(x.id)}
                  className={`flex w-full items-start gap-3 border-t border-border-soft p-3.5 text-left text-fg ${
                    on ? 'bg-bg' : 'hover:bg-bg'
                  }`}
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <span className="text-[0.9375rem] font-semibold">{x.name}</span>
                    <span className="text-xs text-muted tabular-nums">{meta(x)}</span>
                    <BlockStrip t={x} thin />
                  </span>
                  <span className="h-[18px] w-[18px] shrink-0">
                    {on ? (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                        <path d="M5 12.5l4.5 4.5L19 7.5" />
                      </svg>
                    ) : null}
                  </span>
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onBuild();
              }}
              className="flex min-h-13 w-full items-center gap-3 border-t border-border px-3.5 text-left text-fg hover:bg-bg"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                <path d="M12 5v14M5 12h14" />
              </svg>
              <span className="flex flex-1 flex-col gap-px">
                <span className="text-sm font-semibold">Build my own</span>
                <span className="text-xs text-muted">AI prompt, spreadsheet or Markdown</span>
              </span>
              <span aria-hidden className="text-muted">
                ›
              </span>
            </button>
          </div>
        ) : null}
      </div>

      <section aria-label={`${t.name} preview`} className="mt-4 overflow-hidden rounded-card border border-border bg-surface">
        <div className="grid grid-cols-3">
          <div className={stat}>
            <div className="font-display text-2xl tabular-nums text-fg">{weeks}</div>
            <div className="mt-0.5 t-label text-muted">Weeks</div>
          </div>
          <div className={`${stat} border-l`}>
            <div className="font-display text-2xl tabular-nums text-fg">{t.parsed.days.length}</div>
            <div className="mt-0.5 t-label text-muted">Days / wk</div>
          </div>
          <div className={`${stat} border-l`}>
            <div className="font-display text-2xl tabular-nums text-fg">{starts}</div>
            <div className="mt-0.5 t-label text-muted">Starts</div>
          </div>
        </div>
        <div className="flex flex-col gap-2.5 border-t border-border-soft p-3.5">
          <BlockStrip t={t} />
          <ul className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-subtle tabular-nums">
            {t.parsed.blocks.map((b, i) => (
              <li key={i}>
                {BLOCKS[b.type]?.label ?? b.type} · wk {b.startWeek}
                {b.endWeek > b.startWeek ? `–${b.endWeek}` : ''}
              </li>
            ))}
          </ul>
        </div>
        <div className="border-t border-border-soft">
          <div className="px-3.5 pb-1.5 pt-3 t-label text-muted">Your week</div>
          <ol>
            {t.parsed.days.map((d, i) => (
              <li
                key={d.dayKey}
                className="flex min-h-10 items-center gap-3 border-t border-border-soft px-3.5 text-sm text-fg"
              >
                <span className="w-6 shrink-0 text-[0.6875rem] font-semibold text-muted tabular-nums">D{i + 1}</span>
                <span className="min-w-0 truncate">{d.label}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <div className="pb-safe sticky bottom-0 -mx-4 mt-6 flex flex-col gap-2.5 border-t border-border bg-surface px-4 pt-3 sm:-mx-6 sm:px-6">
        {confirming && active ? (
          <>
            <p className="text-sm text-subtle">
              Replaces your active plan, <strong className="font-semibold text-fg">{active.name}</strong>. Its logged
              sessions stay in your history.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>
                Keep current
              </Button>
              <Button onClick={start} disabled={busy}>
                {busy ? 'Starting…' : 'Replace & start'}
              </Button>
            </div>
          </>
        ) : (
          <>
            <Button onClick={start} disabled={busy} className="w-full">
              {busy ? 'Starting…' : `Start ${t.name}`}
            </Button>
            <p className="text-center text-xs text-muted">Copied into your account. Edit anything after.</p>
          </>
        )}
        {error ? <p className="text-sm text-accent">{error}</p> : null}
        <div className="h-1" />
      </div>
    </>
  );
}
