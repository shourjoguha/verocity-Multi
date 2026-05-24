// Client-side data export (SPEC §10). JSON is the complete, lossless dump;
// CSV is a flattened per-set view of the logs (supersets/circuits collapse to a
// group label and item notes are dropped) for spreadsheet use.
import type { LogDocument, Plan, Profile, WorkoutLog } from '@/lib/types';

export interface ExportBundle {
  exportedAt: string;
  version: 1;
  profile: Profile | null;
  plans: Plan[];
  logs: WorkoutLog[];
}

export function buildExportBundle(
  profile: Profile | null,
  plans: Plan[],
  logs: WorkoutLog[],
): ExportBundle {
  return { exportedAt: new Date().toISOString(), version: 1, profile, plans, logs };
}

export function bundleToJson(bundle: ExportBundle): string {
  return JSON.stringify(bundle, null, 2);
}

const CSV_HEADERS = [
  'log_date',
  'status',
  'activity_type',
  'day_key',
  'week',
  'section',
  'group',
  'movement',
  'metric',
  'planned',
  'weight',
  'reps',
  'rpe',
  'distance',
  'time',
  'completed',
  'notations',
] as const;

function csvCell(value: unknown): string {
  if (value == null) return '';
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function logsToCsv(logs: WorkoutLog[]): string {
  const rows: string[] = [CSV_HEADERS.join(',')];
  for (const log of logs) {
    const sections = (log.data as LogDocument)?.sections ?? [];
    const base = [log.log_date, log.status, log.activity_type, log.day_key, log.week_number];
    let emitted = false;
    for (const section of sections) {
      for (const group of section.groups) {
        for (const item of group.items) {
          for (const set of item.sets) {
            emitted = true;
            rows.push(
              [
                ...base,
                section.key,
                group.kind,
                item.movement,
                item.primaryMetric,
                set.planned,
                set.actual.weight,
                set.actual.reps,
                set.actual.rpe,
                set.actual.distance,
                set.actual.time,
                set.actual.completed,
                set.notations.join(' '),
              ]
                .map(csvCell)
                .join(','),
            );
          }
        }
      }
    }
    // Keep activity/empty logs as a single summary row so nothing is dropped.
    if (!emitted) {
      rows.push([...base, '', '', '', '', '', '', '', '', '', '', '', ''].map(csvCell).join(','));
    }
  }
  return rows.join('\n');
}

export function exportFilename(ext: string): string {
  return `verocity-export-${new Date().toISOString().slice(0, 10)}.${ext}`;
}

export function downloadFile(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
