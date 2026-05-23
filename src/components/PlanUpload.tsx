import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { adoptPlan, createPlan } from '@/lib/queries';
import { parsePlanMarkdown, PLAN_FORMAT_HELP } from '@/lib/planParser';
import type { ParsedPlan } from '@/lib/types';
import { Button, EmptyState, SectionHeader } from '@/components/ui/primitives';

export default function PlanUpload() {
  const [ready, setReady] = useState(false);
  const [markdown, setMarkdown] = useState('');
  const [parsed, setParsed] = useState<ParsedPlan | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        window.location.href = '/login';
        return;
      }
      // ?adopt=<planId> → copy a shared/public plan and go to the plan view.
      const adopt = new URLSearchParams(window.location.search).get('adopt');
      if (adopt) {
        const result = await adoptPlan(adopt);
        window.location.href = result ? '/app/plan' : '/app/plan/upload';
        return;
      }
      setReady(true);
    })();
  }, []);

  if (!ready) return <div className="px-6 py-16 text-sm text-muted">Loading…</div>;

  const weeks = parsed
    ? Math.max(
        1,
        ...parsed.blocks.map((b) => b.endWeek),
        ...parsed.days.flatMap((d) =>
          d.exercises.flatMap((e) => Object.keys(e.plannedByWeek).map(Number)),
        ),
      )
    : 0;

  async function save() {
    if (!parsed) return;
    setSaving(true);
    setError(null);
    const result = await createPlan(parsed, markdown);
    setSaving(false);
    if (!result) {
      setError('Could not save the plan. Check your connection and try again.');
      return;
    }
    window.location.href = '/app/plan';
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="mb-6 font-display text-3xl font-semibold tracking-tight text-fg">New plan</h1>

      <textarea
        value={markdown}
        onChange={(e) => setMarkdown(e.target.value)}
        placeholder={PLAN_FORMAT_HELP}
        spellCheck={false}
        rows={14}
        className="w-full border border-border bg-surface p-3 font-mono text-sm text-fg outline-none placeholder:text-muted focus:border-subtle"
      />

      <div className="mt-4 flex gap-3">
        <Button variant="ghost" onClick={() => setParsed(parsePlanMarkdown(markdown))}>
          Parse
        </Button>
        {parsed ? (
          <Button onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save & activate'}
          </Button>
        ) : null}
      </div>

      {error ? <p className="mt-3 text-sm text-accent">{error}</p> : null}

      {parsed ? (
        <div className="mt-8">
          <SectionHeader>
            Preview · {parsed.title} · {weeks} weeks · {parsed.days.length} days
          </SectionHeader>
          {parsed.days.length === 0 ? (
            <EmptyState>No days parsed — check the format.</EmptyState>
          ) : (
            parsed.days.map((day) => (
              <div key={day.dayKey} className="mb-4 border border-border p-4">
                <div className="mb-2 font-display text-lg text-fg">{day.label}</div>
                <ul className="flex flex-col gap-1 text-sm">
                  {day.exercises.map((ex, i) => (
                    <li key={i} className="flex justify-between">
                      <span className="capitalize text-subtle">{ex.movement}</span>
                      <span className="tabular-nums text-muted">
                        {Object.values(ex.plannedByWeek)[0] ?? '—'}
                        {Object.keys(ex.plannedByWeek).length > 1 ? ' …' : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
