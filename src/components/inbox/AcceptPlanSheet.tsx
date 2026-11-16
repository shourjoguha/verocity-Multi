// Accept & review for a PLAN a friend sent (docs/SPEC.md §7B). Nothing is
// inserted until Save: the sheet shows what arrived, lets the receiver move the
// start date (the end date travels with it, planRebase.shiftPlanStart), and
// asks the one question createPlan used to answer silently — make it my active
// plan, or keep it for later. Save validates (validateParsedPlan inside
// planToSave, never bypassed), inserts, then marks the inbox item accepted.
//
// Built on ui/Modal, so it inherits the flicker contract. The body mounts only
// while open, so every open starts from the sender's dates.
import { useState } from 'react';
import { createPlan, setSharedItemStatus } from '@/lib/queries';
import { planToSave } from '@/lib/sharedPlan';
import type { SharedPlanPayload } from '@/lib/types';
import { toast } from '@/lib/toast';
import { todayLocal } from '@/lib/mealPhoto';
import { Modal } from '@/components/ui/Modal';
import SegmentedTabs from '@/components/ui/SegmentedTabs';
import { Button, FIELD } from '@/components/ui/primitives';

export type AcceptablePlan = { itemId: string; sender: string; plan: SharedPlanPayload; dayCount: number };

export function AcceptPlanSheet({
  target,
  onClose,
  onDone,
}: {
  target: AcceptablePlan | null;
  onClose: () => void;
  onDone: () => void;
}) {
  return (
    <Modal open={target !== null} onClose={onClose} title="Save a plan">
      {target ? <Body target={target} onClose={onClose} onDone={onDone} /> : null}
    </Modal>
  );
}

type Mode = 'active' | 'later';

function Body({ target, onClose, onDone }: { target: AcceptablePlan; onClose: () => void; onDone: () => void }) {
  const { plan, dayCount } = target;
  const [start, setStart] = useState(plan.start_date ?? todayLocal(new Date()));
  const [mode, setMode] = useState<Mode>('active');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (saving) return;
    const out = planToSave(plan, start);
    if (!out.ok) {
      setError(out.error);
      return;
    }
    setSaving(true);
    setError(null);
    const created = await createPlan(out.parsed, plan.source_markdown ?? '', { activate: mode === 'active' });
    if (!created) {
      setSaving(false);
      setError("Couldn't save the plan. Check your connection and try again.");
      return;
    }
    const marked = await setSharedItemStatus(target.itemId, 'accepted');
    setSaving(false);
    // The plan exists either way. A failed mark leaves the item in the inbox,
    // and a second Save would add a second copy, so say so rather than retry.
    toast(
      marked ? (mode === 'active' ? 'Plan saved and active' : 'Plan saved for later') : 'Plan saved. Dismiss it from your inbox.',
      marked ? 'success' : 'info',
    );
    onDone();
  }

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="min-w-0">
          <div className="break-words text-base text-fg">{plan.name}</div>
          <div className="mt-1 text-sm tabular-nums text-muted">
            From {target.sender} · {dayCount} {dayCount === 1 ? 'day' : 'days'}
          </div>
        </div>

        <label className="mt-4 flex flex-col gap-1">
          <span className="t-label text-muted">Start date</span>
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className={FIELD} />
        </label>
        <p className="mt-1 text-xs text-muted">Their start date by default. The end date moves with it.</p>

        <div className="mt-4">
          <SegmentedTabs
            as="radiogroup"
            ariaLabel="What to do with this plan"
            size="sm"
            active={mode}
            onChange={(k) => setMode(k as Mode)}
            tabs={[
              { key: 'active', label: 'Make it my active plan' },
              { key: 'later', label: 'Save for later' },
            ]}
          />
          <p className="mt-2 text-xs leading-relaxed text-muted">
            {mode === 'active'
              ? 'Your current plan stops being active. Your logs keep their history.'
              : 'Your current plan stays active. This one is kept in your account, not activated.'}
          </p>
        </div>

        {error ? (
          <p role="alert" className="mt-3 text-sm text-fg">
            {error}
          </p>
        ) : null}
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-border-soft p-4">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={save} disabled={saving || !start}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </>
  );
}
