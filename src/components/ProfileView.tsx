import { useEffect, useState } from 'react';
import { supabase, supabasePublic } from '@/lib/supabase';
import { getActivePlan, getCurrentProfile, getRecentLogs } from '@/lib/queries';
import { signOut } from '@/lib/auth';
import type { Plan, Profile, WorkoutLog } from '@/lib/types';
import { bestE1rm } from '@/lib/e1rm';
import { weekFromDate } from '@/lib/week';
import { formatDate, formatDuration, formatRound } from '@/lib/format';
import { tagColor } from '@/lib/tags';
import { Button, Card, EmptyState, SectionHeader, StatCard, Tag } from '@/components/ui/primitives';
import { SetShapeStrip } from '@/components/SetShapeStrip';

function topE1rm(logs: WorkoutLog[]): number | null {
  let best: number | null = null;
  for (const log of logs) {
    const sets = (log.data?.sections ?? []).flatMap((s) =>
      s.groups.flatMap((g) => g.items.flatMap((i) => i.sets)),
    );
    const est = bestE1rm(sets.map((s) => ({ weight: s.actual.weight, reps: s.actual.reps })));
    if (est != null && (best == null || est > best)) best = est;
  }
  return best;
}

export default function ProfileView({ mode }: { mode: 'app' | 'showcase' }) {
  const client = mode === 'showcase' ? supabasePublic : supabase;
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [logs, setLogs] = useState<WorkoutLog[]>([]);

  useEffect(() => {
    let active = true;
    (async () => {
      if (mode === 'app') {
        const { data } = await supabase.auth.getSession();
        if (!data.session) {
          window.location.href = '/login';
          return;
        }
      }
      const [p, pl, lg] = await Promise.all([
        getCurrentProfile(client),
        getActivePlan(client),
        getRecentLogs(30, client),
      ]);
      if (!active) return;
      setProfile(p);
      setPlan(pl);
      setLogs(lg);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [mode]);

  if (loading) {
    return <div className="px-6 py-16 text-sm text-muted">Loading…</div>;
  }

  if (mode === 'showcase' && !profile) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-16">
        <EmptyState>No showcase profile is configured yet.</EmptyState>
      </div>
    );
  }

  const sessionCount = logs.length;
  const totalSeconds = logs.reduce((acc, l) => acc + (l.total_seconds ?? 0), 0);
  const top = topE1rm(logs);
  const week = plan ? weekFromDate(plan.start_date, new Date()) : null;

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <header className="mb-8 flex items-baseline justify-between">
        <div>
          <p className="text-[0.7rem] uppercase tracking-[0.3em] text-muted">
            {mode === 'showcase' ? 'Showcase' : 'Dashboard'}
          </p>
          <h1 className="font-display text-4xl font-semibold tracking-tight text-fg">
            {profile?.display_name ?? 'Athlete'}
          </h1>
        </div>
        {mode === 'app' ? (
          <button
            onClick={() => signOut().then(() => (window.location.href = '/login'))}
            className="text-[0.7rem] uppercase tracking-wider text-muted hover:text-fg"
          >
            Sign out
          </button>
        ) : null}
      </header>

      <section className="mb-8 grid grid-cols-3 gap-px bg-border">
        <StatCard label="Sessions" value={sessionCount} />
        <StatCard label="Total time" value={formatDuration(totalSeconds)} />
        <StatCard label="Top e1RM" value={top != null ? formatRound(top) : '—'} unit={top != null ? 'kg' : undefined} />
      </section>

      <section className="mb-8">
        <SectionHeader>Active plan</SectionHeader>
        {plan ? (
          <Card>
            <div className="flex items-center justify-between">
              <div>
                <div className="font-display text-xl text-fg">{plan.name}</div>
                {week ? <div className="text-sm text-muted">Week {week}</div> : null}
              </div>
              {mode === 'app' ? (
                <Button variant="ghost" disabled>
                  Start workout
                </Button>
              ) : null}
            </div>
          </Card>
        ) : (
          <EmptyState>No active plan.</EmptyState>
        )}
      </section>

      <section>
        <SectionHeader>Recent sessions</SectionHeader>
        {logs.length === 0 ? (
          <EmptyState>No sessions logged yet.</EmptyState>
        ) : (
          <ul className="divide-y divide-border border border-border">
            {logs.slice(0, 12).map((log) => (
              <li key={log.id} className="flex items-center gap-4 px-4 py-3">
                <div className="w-16 shrink-0 text-sm tabular-nums text-subtle">
                  {formatDate(log.log_date)}
                </div>
                <div className="flex flex-1 flex-wrap gap-1">
                  {log.tags.length > 0 ? (
                    log.tags.map((t) => <Tag key={t} label={t} color={tagColor(t)} />)
                  ) : (
                    <span className="text-sm text-muted">{log.activity_type ?? 'Session'}</span>
                  )}
                </div>
                <SetShapeStrip data={log.data} className="shrink-0" />
                <div className="w-12 shrink-0 text-right text-sm tabular-nums text-muted">
                  {formatDuration(log.total_seconds)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
