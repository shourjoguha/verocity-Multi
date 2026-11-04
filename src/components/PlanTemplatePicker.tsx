// The "start from a ready plan" path on /app/plan/upload: the curated
// plan_templates catalogue (0050). Adopting copies the template into a new
// owned plan, re-dated to today, and makes it active — so when the user
// already has an active plan the first tap only arms the button and says what
// it will replace.
import { useEffect, useState } from 'react';
import { BLOCKS } from '@/app.config';
import { adoptPlanTemplate, getActivePlan, getPlanTemplates } from '@/lib/queries';
import { planWeeks } from '@/lib/planRebase';
import type { Plan, PlanTemplate } from '@/lib/types';
import { track } from '@/lib/analytics';
import { Button, ListCard, SectionHeader } from '@/components/ui/primitives';

export default function PlanTemplatePicker() {
  const [templates, setTemplates] = useState<PlanTemplate[]>([]);
  const [active, setActive] = useState<Plan | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getPlanTemplates()
      .then(setTemplates)
      .catch(() => setTemplates([]));
    getActivePlan()
      .then(setActive)
      .catch(() => setActive(null));
  }, []);

  // Nothing curated (fresh clone, or every row retired): the authoring path
  // below is the whole page, as before.
  if (templates.length === 0) return null;

  async function use(t: PlanTemplate) {
    if (active && armed !== t.id) {
      setArmed(t.id);
      return;
    }
    setBusy(t.id);
    setError(null);
    const plan = await adoptPlanTemplate(t);
    if (!plan) {
      setBusy(null);
      setError('Could not start that plan. Check your connection and try again.');
      return;
    }
    track('plan_adopted', { template: t.name });
    window.location.href = '/app/plan';
  }

  return (
    <div className="mb-6">
      <SectionHeader>Start from a ready plan</SectionHeader>
      <ListCard>
        {templates.map((t) => {
          const weeks = planWeeks(t.parsed);
          const days = t.parsed.days.length;
          const blocks = t.parsed.blocks.map((b) => BLOCKS[b.type]?.label ?? b.type);
          return (
            <div key={t.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="font-semibold text-fg">{t.name}</p>
                <p className="mt-1 text-sm text-muted tabular-nums">
                  {weeks} wk · {days} day{days === 1 ? '' : 's'}/wk · {blocks.join(' → ')}
                </p>
                {t.summary ? <p className="mt-1 text-sm text-muted">{t.summary}</p> : null}
                <p className="mt-1 text-xs text-subtle">{t.parsed.days.map((d) => d.label).join(' · ')}</p>
              </div>
              <Button
                variant={armed === t.id ? 'primary' : 'ghost'}
                onClick={() => use(t)}
                disabled={busy !== null}
                className="shrink-0"
              >
                {busy === t.id ? 'Starting…' : armed === t.id ? `Replace “${active?.name}”` : 'Use this plan'}
              </Button>
            </div>
          );
        })}
      </ListCard>
      {error ? <p className="mt-2 text-sm text-accent">{error}</p> : null}
      <p className="mt-2 text-xs text-subtle">Starts today. You can edit it after, or build your own below.</p>
    </div>
  );
}
