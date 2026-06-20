// Garmin recovery surface for StatsView (plan §6, §7). Reads garmin_health_daily
// for the last 30 days and renders a snapshot (latest resting HR, HRV, sleep,
// body battery, VO₂ max, steps), the most recent night's sleep-stage split, and
// resting-HR / HRV trends. Self-hides when there's no health data, so it's inert
// until a Garmin import (ZIP today, live sync later) populates the table. App
// mode only — health data is private PII and never appears on the showcase.
import { useEffect, useState } from 'react';
import { getGarminHealthDaily } from '@/lib/queries';
import {
  hasHealthData,
  latestEntry,
  latestSleepStages,
  metricSeries,
  type HealthPoint,
} from '@/lib/garmin/health';
import type { GarminHealthDaily } from '@/lib/types';
import { formatDuration } from '@/lib/format';
import { SectionHeader, StatCard } from '@/components/ui/primitives';
import { Item } from '@/components/anim';

const DAYS = 30;

function ymd(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate(),
  ).padStart(2, '0')}`;
}

function Spark({ points }: { points: HealthPoint[] }) {
  if (points.length < 2) return null;
  const H = 36;
  const vals = points.map((p) => p.value);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const n = points.length;
  const x = (i: number) => (i / (n - 1)) * 100;
  const y = (v: number) => H - 3 - ((v - min) / span) * (H - 6);
  const line = points
    .map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`)
    .join(' ');
  return (
    <svg viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" className="block h-9 w-full" aria-hidden>
      <path
        d={line}
        fill="none"
        stroke="var(--color-fg)"
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function GarminHealthSection() {
  const [rows, setRows] = useState<GarminHealthDaily[] | null>(null);

  useEffect(() => {
    let active = true;
    const today = new Date();
    const from = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - (DAYS - 1)),
    );
    getGarminHealthDaily(ymd(from), ymd(today)).then((r) => {
      if (active) setRows(r);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!rows || !hasHealthData(rows)) return null;

  const restingHr = latestEntry(rows, 'resting_hr');
  const hrv = latestEntry(rows, 'hrv_ms');
  const sleep = latestEntry(rows, 'sleep_seconds');
  const bodyBattery = latestEntry(rows, 'body_battery_high');
  const vo2max = latestEntry(rows, 'vo2max');
  const steps = latestEntry(rows, 'steps');
  const stages = latestSleepStages(rows);
  const restingHrSeries = metricSeries(rows, 'resting_hr');
  const hrvSeries = metricSeries(rows, 'hrv_ms');

  return (
    <Item>
      <section className="mb-10">
        <SectionHeader>Recovery</SectionHeader>
        <div className="grid grid-cols-3 gap-px bg-border">
          <StatCard label="Resting HR" value={restingHr ? restingHr.value : '—'} unit={restingHr ? 'bpm' : undefined} />
          <StatCard label="HRV" value={hrv ? hrv.value : '—'} unit={hrv ? 'ms' : undefined} />
          <StatCard label="Sleep" value={sleep ? formatDuration(sleep.value) : '—'} />
          <StatCard label="Body Battery" value={bodyBattery ? bodyBattery.value : '—'} />
          <StatCard label="VO₂ Max" value={vo2max ? vo2max.value : '—'} />
          <StatCard label="Steps" value={steps ? steps.value.toLocaleString() : '—'} />
        </div>

        {stages ? (
          <div className="mt-px bg-surface px-4 py-4">
            <div className="mb-2 text-[0.65rem] uppercase tracking-[0.2em] text-muted">Last sleep</div>
            <div className="flex h-2.5 w-full overflow-hidden">
              <span style={{ flexGrow: stages.deep }} className="bg-fg" />
              <span style={{ flexGrow: stages.rem }} className="bg-fg/60" />
              <span style={{ flexGrow: stages.light }} className="bg-fg/30" />
            </div>
            <div className="mt-2 flex gap-4 text-[0.6rem] uppercase tracking-wider text-muted">
              <span>Deep {formatDuration(stages.deep)}</span>
              <span>REM {formatDuration(stages.rem)}</span>
              <span>Light {formatDuration(stages.light)}</span>
            </div>
          </div>
        ) : null}

        {restingHrSeries.length > 1 || hrvSeries.length > 1 ? (
          <div className="mt-px grid grid-cols-2 gap-px bg-border">
            {restingHrSeries.length > 1 ? (
              <div className="bg-surface px-4 py-4">
                <div className="mb-2 text-[0.65rem] uppercase tracking-[0.2em] text-muted">
                  Resting HR · {DAYS}d
                </div>
                <Spark points={restingHrSeries} />
              </div>
            ) : null}
            {hrvSeries.length > 1 ? (
              <div className="bg-surface px-4 py-4">
                <div className="mb-2 text-[0.65rem] uppercase tracking-[0.2em] text-muted">
                  HRV · {DAYS}d
                </div>
                <Spark points={hrvSeries} />
              </div>
            ) : null}
          </div>
        ) : null}
      </section>
    </Item>
  );
}
