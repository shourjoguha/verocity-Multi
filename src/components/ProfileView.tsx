import { useEffect, useState } from 'react';
import { supabase, supabasePublic } from '@/lib/supabase';
import { getActivePlan, getAllLogs, getAllPlans, getCurrentProfile, getRecentLogs } from '@/lib/queries';
import { signOut } from '@/lib/auth';
import type { Plan, PlanDay, Profile, WorkoutLog } from '@/lib/types';
import { bestE1rm } from '@/lib/e1rm';
import { weekFromDate } from '@/lib/week';
import { formatDate, formatDuration, formatRound } from '@/lib/format';
import { tagColor } from '@/lib/tags';
import {
  bundleToJson,
  buildExportBundle,
  downloadFile,
  exportFilename,
  logsToCsv,
} from '@/lib/exportData';
import { Button, Card, EmptyState, SectionHeader, StatCard, Tag } from '@/components/ui/primitives';
import { SetShapeStrip } from '@/components/SetShapeStrip';
import { EchoText } from '@/components/EchoText';
import { Item, PageStagger } from '@/components/anim';
import { DayPreviewDialog } from '@/components/DayPreviewDialog';
import { AddSessionMenu } from '@/components/AddSessionMenu';
import { LogQuickView } from '@/components/LogQuickView';

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
  const [exporting, setExporting] = useState<'json' | 'csv' | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [previewDay, setPreviewDay] = useState<PlanDay | null>(null);
  const [quickLog, setQuickLog] = useState<WorkoutLog | null>(null);

  async function handleExport(format: 'json' | 'csv') {
    if (exporting) return;
    setExporting(format);
    try {
      const [prof, plans, allLogs] = await Promise.all([
        getCurrentProfile(),
        getAllPlans(),
        getAllLogs(),
      ]);
      if (format === 'json') {
        const json = bundleToJson(buildExportBundle(prof, plans, allLogs));
        downloadFile(exportFilename('json'), json, 'application/json');
      } else {
        downloadFile(exportFilename('csv'), logsToCsv(allLogs), 'text/csv');
      }
    } finally {
      setExporting(null);
    }
  }

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
  const doneThisWeek = new Set(
    logs
      .filter((l) => l.status === 'done' && l.week_number === week && l.day_key)
      .map((l) => l.day_key as string),
  );

  return (
    <>
    <PageStagger className="mx-auto max-w-3xl px-6 py-10">
      <Item>
        <header className="mb-10">
          <p className="text-[0.7rem] uppercase tracking-[0.35em] text-muted">
            {mode === 'showcase' ? 'Showcase' : 'Dashboard'}
          </p>
          <div className="mt-2 flex items-end justify-between gap-4">
            <EchoText
              text={profile?.display_name ?? 'Athlete'}
              as="h1"
              className="font-display text-5xl font-bold uppercase leading-[0.9] tracking-[-0.04em] text-fg md:text-7xl"
            />
            {mode === 'app' ? (
              <button
                onClick={() => signOut().then(() => (window.location.href = '/login'))}
                className="shrink-0 pb-1 text-[0.7rem] uppercase tracking-wider text-muted transition-colors hover:text-fg"
              >
                Sign out
              </button>
            ) : null}
          </div>
        </header>
      </Item>

      <Item>
        <section className="mb-10 grid grid-cols-3 gap-px bg-border">
          <StatCard label="Sessions" value={sessionCount} />
          <StatCard label="Total time" value={formatDuration(totalSeconds)} />
          <StatCard
            label="Top e1RM"
            value={top != null ? formatRound(top) : '—'}
            unit={top != null ? 'kg' : undefined}
          />
        </section>
      </Item>

      {mode === 'app' ? (
        <Item>
          <section className="mb-10 flex gap-3">
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="inline-flex min-h-12 flex-1 items-center justify-center bg-fg px-4 text-sm uppercase tracking-wider text-bg transition-colors hover:bg-fg/85"
            >
              Start workout
            </button>
            <a
              href="/app/activity"
              className="inline-flex min-h-12 flex-1 items-center justify-center border border-border px-4 text-sm uppercase tracking-wider text-fg transition-colors hover:border-fg"
            >
              Log activity
            </a>
          </section>
        </Item>
      ) : null}

      {mode === 'app' && plan && plan.parsed.days.length > 0 ? (
        <Item>
          <section className="mb-10">
            <SectionHeader>This week{week ? ` · Week ${week}` : ''}</SectionHeader>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {plan.parsed.days.map((d) => {
                const done = doneThisWeek.has(d.dayKey);
                return (
                  <button
                    key={d.dayKey}
                    type="button"
                    onClick={() => setPreviewDay(d)}
                    className="flex min-w-[8.5rem] shrink-0 flex-col gap-2 border border-border bg-surface p-3 text-left transition-colors hover:border-fg"
                    style={done ? { boxShadow: 'inset 3px 0 0 var(--color-fg)' } : undefined}
                  >
                    <span className="text-sm text-fg">{d.label}</span>
                    <span className="text-[0.65rem] uppercase tracking-wider text-muted">
                      {done ? 'Done' : `${d.exercises.length} moves`}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        </Item>
      ) : null}

      <Item>
        <section className="mb-10">
          <SectionHeader>Active plan</SectionHeader>
          {plan ? (
            <Card>
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-display text-xl font-semibold tracking-tight text-fg">{plan.name}</div>
                  {week ? <div className="mt-0.5 text-sm text-muted">Week {week}</div> : null}
                </div>
                {mode === 'app' ? (
                  <a
                    href="/app/plan"
                    className="text-[0.7rem] uppercase tracking-wider text-muted transition-colors hover:text-fg"
                  >
                    View →
                  </a>
                ) : null}
              </div>
            </Card>
          ) : (
            <EmptyState>No active plan.</EmptyState>
          )}
        </section>
      </Item>

      <Item>
        <section>
          <SectionHeader>Recent sessions</SectionHeader>
          {logs.length === 0 ? (
            <EmptyState>No sessions logged yet.</EmptyState>
          ) : (
            <ul className="border border-border bg-surface">
              {logs.slice(0, 12).map((log) => {
                const accent = log.tags[0] ? tagColor(log.tags[0]) : 'transparent';
                const inner = (
                  <>
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
                  </>
                );
                return (
                  <li key={log.id} className="border-b border-border last:border-b-0">
                    {mode === 'app' ? (
                      <button
                        type="button"
                        onClick={() => setQuickLog(log)}
                        className="flex w-full items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-elevated"
                        style={{ boxShadow: `inset 3px 0 0 ${accent}` }}
                      >
                        {inner}
                      </button>
                    ) : (
                      <div
                        className="flex items-center gap-4 px-4 py-3"
                        style={{ boxShadow: `inset 3px 0 0 ${accent}` }}
                      >
                        {inner}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </Item>

      {mode === 'app' ? (
        <Item>
          <section className="mt-10">
            <SectionHeader>Your data</SectionHeader>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="ghost" onClick={() => handleExport('json')} disabled={!!exporting}>
                {exporting === 'json' ? 'Exporting…' : 'Export JSON'}
              </Button>
              <Button variant="ghost" onClick={() => handleExport('csv')} disabled={!!exporting}>
                {exporting === 'csv' ? 'Exporting…' : 'Export CSV'}
              </Button>
              <a
                href="/app/shares"
                className="text-[0.7rem] uppercase tracking-wider text-muted transition-colors hover:text-fg"
              >
                Share links →
              </a>
            </div>
            <p className="mt-2 text-[0.7rem] text-muted">
              JSON is the complete backup. CSV is a flattened per-set view for spreadsheets.
            </p>
          </section>
        </Item>
      ) : null}
    </PageStagger>

      {mode === 'app' ? (
        <>
          <AddSessionMenu plan={plan} open={addOpen} onClose={() => setAddOpen(false)} />
          <DayPreviewDialog
            day={previewDay}
            week={week ?? 1}
            open={previewDay !== null}
            onClose={() => setPreviewDay(null)}
          />
          <LogQuickView log={quickLog} open={quickLog !== null} onClose={() => setQuickLog(null)} />
        </>
      ) : null}
    </>
  );
}
