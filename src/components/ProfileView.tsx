import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { supabase, supabasePublic } from '@/lib/supabase';
import { getActivePlan, getAllLogs, getAllPlans, getCurrentProfile, getRecentLogs } from '@/lib/queries';
import { signOut } from '@/lib/auth';
import type { Plan, PlanDay, Profile, WorkoutLog } from '@/lib/types';
import { bestE1rm } from '@/lib/e1rm';
import { weekFromDate } from '@/lib/week';
import { formatDate, formatDuration, formatRound } from '@/lib/format';
import { tagColor } from '@/lib/tags';
import { buildTimeline, DAY_NAMES, dayNameFromLabel, typeFromLabel } from '@/lib/timeline';
import { toast } from '@/lib/toast';
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

// Edge-fade mask for the horizontal scrollers (ribbon + day rail).
const edgeFade: CSSProperties = {
  WebkitMaskImage:
    'linear-gradient(to right, transparent 0, #000 12px, #000 calc(100% - 12px), transparent 100%)',
  maskImage:
    'linear-gradient(to right, transparent 0, #000 12px, #000 calc(100% - 12px), transparent 100%)',
};

function ProgressTimeline({ plan, logs }: { plan: Plan; logs: WorkoutLog[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const points = useMemo(() => buildTimeline(plan, logs), [plan, logs]);
  const todayIndex = points.findIndex((p) => p.isToday);
  const anchorIndex = useMemo(() => {
    for (let i = points.length - 1; i >= 0; i--) if (points[i].state === 'done') return i;
    return todayIndex;
  }, [points, todayIndex]);
  const [peekIndex, setPeekIndex] = useState<number | null>(null);

  // Right-align the scroll on the most recent logged day (or today) so upcoming peeks in.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || anchorIndex < 0) return;
    const bw = 8; // 6px bar + 2px gap
    el.scrollTo({ left: Math.max(0, anchorIndex * bw - el.clientWidth * 0.8), behavior: 'auto' });
  }, [anchorIndex]);

  // Outside-tap dismiss for the peek popover.
  useEffect(() => {
    if (peekIndex === null) return;
    function onPointerDown(e: PointerEvent) {
      const root = containerRef.current;
      if (root && !root.contains(e.target as Node)) setPeekIndex(null);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [peekIndex]);

  return (
    <div ref={containerRef} className="relative border-b border-border pb-3">
      <div className="mb-2 text-[0.6rem] uppercase tracking-[0.16em] text-muted">Plan progress</div>
      <div ref={scrollRef} className="-mx-6 overflow-x-auto px-6" style={edgeFade}>
        <div className="relative flex min-h-[44px] items-stretch gap-0.5">
          {points.map((p, i) => {
            const barStyle: CSSProperties = {};
            if (p.state === 'done') {
              barStyle.backgroundColor = p.color;
            } else if (p.state === 'planned') {
              barStyle.border = `1px solid color-mix(in srgb, ${p.color} 50%, transparent)`;
              barStyle.backgroundColor = 'transparent';
            } else {
              barStyle.backgroundImage =
                'repeating-linear-gradient(45deg, color-mix(in srgb, var(--color-muted) 35%, transparent) 0, color-mix(in srgb, var(--color-muted) 35%, transparent) 1px, transparent 1px, transparent 3px)';
              barStyle.backgroundColor = 'color-mix(in srgb, var(--color-muted) 25%, transparent)';
              barStyle.opacity = 0.55;
            }
            if (p.isToday) {
              barStyle.outline = '1px solid var(--color-fg)';
              barStyle.outlineOffset = '1px';
            }
            return (
              <button
                key={p.date + i}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setPeekIndex((cur) => (cur === i ? null : i));
                }}
                onMouseEnter={() => setPeekIndex(i)}
                onMouseLeave={() => setPeekIndex((cur) => (cur === i ? null : cur))}
                className="relative flex h-11 shrink-0 cursor-pointer items-center justify-center"
                aria-label={`${p.date} ${p.fullLabel}`}
                title={`${p.fullLabel} · ${p.date}`}
              >
                <span className="block h-6 w-1.5" style={barStyle} aria-hidden />
                {peekIndex === i && (
                  <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1.5 flex -translate-x-1/2 flex-col items-center gap-0.5 whitespace-nowrap bg-fg px-2 py-1 text-[0.6rem] uppercase tracking-[0.12em] text-bg">
                    <span>{p.fullLabel}</span>
                    <span className="text-[0.55rem] normal-case tracking-normal text-bg/60">{p.date}</span>
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function ProfileView({ mode }: { mode: 'app' | 'showcase' }) {
  const client = mode === 'showcase' ? supabasePublic : supabase;
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [logs, setLogs] = useState<WorkoutLog[]>([]);
  const [allLogs, setAllLogs] = useState<WorkoutLog[]>([]);
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
      toast(`${format.toUpperCase()} export ready`, 'success');
    } catch {
      toast('Export failed — try again', 'error');
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
      const [p, pl, lg, all] = await Promise.all([
        getCurrentProfile(client),
        getActivePlan(client),
        getRecentLogs(30, client),
        getAllLogs(client),
      ]);
      if (!active) return;
      setProfile(p);
      setPlan(pl);
      setLogs(lg);
      setAllLogs(all);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [mode]);

  // Live-refresh recents when this user's logs change (e.g. finishing a session
  // on another device/tab). App mode only; the showcase is read-only.
  useEffect(() => {
    if (mode !== 'app' || !profile) return;
    const channel = supabase
      .channel(`home-logs-${profile.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'workout_logs',
          filter: `owner_user_id=eq.${profile.id}`,
        },
        () => {
          getRecentLogs(30).then(setLogs);
          getAllLogs().then(setAllLogs);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [mode, profile]);

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
  const todayDayName = DAY_NAMES[new Date().getDay()];

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
            <div className="mb-4 text-[0.7rem] uppercase tracking-[0.18em] text-muted">
              {new Date().toDateString()} · Week {week ?? 1}
            </div>
            <ProgressTimeline plan={plan} logs={allLogs} />
            <div className="mb-3 mt-6 flex items-baseline justify-between">
              <div className="text-[0.65rem] uppercase tracking-[0.16em] text-muted">Pick a day</div>
              <a
                href="/app/plan"
                className="text-[0.65rem] uppercase tracking-[0.14em] text-muted transition-colors hover:text-fg"
              >
                Plan overview →
              </a>
            </div>
            <div className="-mx-6 overflow-x-auto px-6" style={edgeFade}>
              <div className="flex gap-2 pb-2">
                {plan.parsed.days.map((d) => {
                  const isToday = dayNameFromLabel(d.label).toLowerCase() === todayDayName.toLowerCase();
                  return (
                    <button
                      key={d.dayKey}
                      type="button"
                      onClick={() => setPreviewDay(d)}
                      className={`min-w-[140px] shrink-0 border p-3 text-left transition-colors ${
                        isToday ? 'border-fg bg-fg text-bg' : 'border-border hover:bg-elevated'
                      }`}
                    >
                      <div className="truncate font-display text-base tracking-[-0.04em]">
                        {typeFromLabel(d.label)}
                      </div>
                      <div
                        className={`mt-1 text-[0.6rem] uppercase tracking-[0.14em] ${
                          isToday ? 'text-bg/70' : 'text-muted'
                        }`}
                        aria-hidden
                      >
                        {isToday ? 'today' : ' '}
                      </div>
                    </button>
                  );
                })}
              </div>
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
