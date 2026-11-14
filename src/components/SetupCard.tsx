// Home's way back into onboarding. Signup redirects a new account to
// /app/onboarding once; before this card, closing that tab meant never seeing
// the flow again, and an account that predates it was never offered it at all.
//
// Shown while `user_stats.onboarded_at` is null. Dismiss stamps the same flag
// the flow stamps on finish, so "not now" is permanent and Settings remains the
// way in. Renders nothing until the read lands: a card that appears and then
// vanishes for an onboarded user would be a flash on every Home load.
import { useEffect, useState } from 'react';
import { getUserStats, upsertUserStats } from '@/lib/queries';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/primitives';

export default function SetupCard() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    let active = true;
    getUserStats()
      .then((s) => {
        if (active && !s?.onboarded_at) setShow(true);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  if (!show) return null;

  async function dismiss() {
    setShow(false);
    if (!(await upsertUserStats({ onboarded_at: new Date().toISOString() }))) {
      toast('Could not save — try again', 'error');
      setShow(true);
    }
  }

  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border border-border bg-surface px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-fg">Finish setup</p>
        <p className="text-sm text-muted">Four short screens, so plans and coaching start out tuned to you.</p>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button variant="ghost" onClick={dismiss}>
          Dismiss
        </Button>
        <Button onClick={() => (window.location.href = '/app/onboarding')}>Set up</Button>
      </div>
    </div>
  );
}
