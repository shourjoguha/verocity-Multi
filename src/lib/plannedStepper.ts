// A stepper VIEW over a planned-set string — not a new model.
//
// `plannedByWeek[w]` stays free text ("5x5 @75%", "4x8 @27.5kg RPE8", "3x12/s",
// "AMRAP"). The plan editor offers −/+ steppers only for strings this module can
// parse EXACTLY: sets × reps plus up to two qualifiers (one load — `@75%` or
// `@27.5kg` — and one effort — `@RPE7`, `RPE8` or a bare `@7`). Every separator,
// the `x`/`×` glyph and the spelling of `RPE`/`kg` are captured, so
// `formatStepped(parseStepped(s)!) === s` for every string it accepts. Anything
// else returns null, and the editor shows the original string in a text field,
// untouched. A string is only ever rewritten by a stepper the user pressed.

import { METRICS, RPE, type MetricKey } from '@/app.config';

export type LoadKind = 'pct' | 'kg' | 'rpe';

export interface Qualifier {
  lead: string; // whitespace before the qualifier; "" only when "@" follows directly ("5x5@75%")
  at: boolean; // written with "@"
  gap: string; // whitespace after "@"
  kind: LoadKind;
  value: number;
  word: string; // "RPE"/"rpe" for an effort written with the word; "" for a bare "@7"
  wordGap: string; // whitespace between RPE and its number
  unitGap: string; // whitespace between a kg number and "kg"
  unit: string; // "kg" as written (case kept)
}

export interface Stepped {
  sets: number;
  times: string; // the separator between sets and reps, as written: "x", " x ", "×"
  reps: number;
  quals: Qualifier[];
}

// Numbers that print back exactly as they were written: no leading zeros, no
// trailing decimal zeros ("27.50" is rejected rather than rewritten "27.5").
const NUM = '(?:0|[1-9]\\d*)(?:\\.\\d*[1-9])?';
const HEAD = /^([1-9]\d*)(\s*[x×]\s*)([1-9]\d*)/i;
const QUAL = new RegExp(
  `^(\\s*)(@?)(\\s*)(?:(${NUM})%|(${NUM})(\\s?)(kg)\\b|(rpe)(\\s?)(${NUM})|(${NUM}))`,
  'i',
);

export function parseStepped(raw: string): Stepped | null {
  const head = raw.match(HEAD);
  if (!head) return null;
  const out: Stepped = { sets: Number(head[1]), times: head[2], reps: Number(head[3]), quals: [] };
  let rest = raw.slice(head[0].length);
  while (rest) {
    const m = rest.match(QUAL);
    if (!m) return null;
    const [whole, lead, at, gap, pct, kg, unitGap, unit, word, wordGap, rpeNum, bare] = m;
    // A qualifier is separated from what precedes it by whitespace, or by "@"
    // ("5x5@75%"). "@" itself is required for a bare number and forbidden from
    // standing alone ("5x5 @ " is not a load).
    if (!lead && !at) return null;
    if (!at && gap) return null;
    if (bare !== undefined && !at) return null;
    const kind: LoadKind = pct !== undefined ? 'pct' : kg !== undefined ? 'kg' : 'rpe';
    const value = Number(pct ?? kg ?? rpeNum ?? bare);
    // An effort off the RPE scale ("@75", which probably meant 75%) is not
    // something a stepper can show without clamping it — leave it as text.
    if (kind === 'rpe' && (value < RPE.min || value > RPE.max)) return null;
    out.quals.push({
      lead,
      at: !!at,
      gap,
      kind,
      value,
      word: word ?? '',
      wordGap: wordGap ?? '',
      unitGap: unitGap ?? '',
      unit: unit ?? '',
    });
    rest = rest.slice(whole.length);
  }
  // At most one load and at most one effort.
  const loads = out.quals.filter((q) => q.kind !== 'rpe').length;
  const efforts = out.quals.filter((q) => q.kind === 'rpe').length;
  if (loads > 1 || efforts > 1) return null;
  return out;
}

const num = (v: number) => String(Number(v.toFixed(2)));

function formatQual(q: Qualifier): string {
  const body =
    q.kind === 'pct'
      ? `${num(q.value)}%`
      : q.kind === 'kg'
        ? `${num(q.value)}${q.unitGap}${q.unit}`
        : `${q.word}${q.wordGap}${num(q.value)}`;
  return `${q.lead}${q.at ? '@' : ''}${q.gap}${body}`;
}

export function formatStepped(s: Stepped): string {
  return `${s.sets}${s.times}${s.reps}${s.quals.map(formatQual).join('')}`;
}

// ---- stepping ----

export const PCT_STEP = 2.5;

// What the second number of "5x5" counts depends on the movement's metric:
// reps for a lift, seconds/metres/calories for conditioning ("6x500").
export function repsLabel(metric: MetricKey): string {
  if (metric === 'time') return 'Seconds';
  if (metric === 'distance') return 'Metres';
  if (metric === 'cal') return 'Calories';
  return 'Reps';
}

export function repsStep(metric: MetricKey): number {
  return metric === 'time' || metric === 'distance' || metric === 'cal' ? METRICS[metric].step : 1;
}

export function qualStep(kind: LoadKind): number {
  return kind === 'pct' ? PCT_STEP : kind === 'kg' ? METRICS.weight.step : RPE.step;
}

// The stepper's readout for a qualifier — its number in its own unit, not
// the written form (the label already says "RPE" or "% 1RM").
export function qualDisplay(q: Qualifier): string {
  const v = num(q.value);
  return q.kind === 'pct' ? `${v}%` : q.kind === 'kg' ? `${v} ${METRICS.weight.unit}` : v;
}

export function qualLabel(kind: LoadKind): string {
  return kind === 'pct' ? 'Load · % 1RM' : kind === 'kg' ? `Load · ${METRICS.weight.unit}` : 'RPE';
}

function clampQual(kind: LoadKind, v: number): number {
  if (kind === 'rpe') return Math.min(RPE.max, Math.max(RPE.min, v));
  return Math.max(0, v);
}

export function stepSets(s: Stepped, dir: 1 | -1): Stepped {
  return { ...s, sets: Math.max(1, s.sets + dir) };
}

export function stepReps(s: Stepped, dir: 1 | -1, metric: MetricKey): Stepped {
  const step = repsStep(metric);
  return { ...s, reps: Math.max(step, s.reps + dir * step) };
}

export function stepQual(s: Stepped, qi: number, dir: 1 | -1): Stepped {
  return {
    ...s,
    quals: s.quals.map((q, i) =>
      i === qi ? { ...q, value: clampQual(q.kind, q.value + dir * qualStep(q.kind)) } : q,
    ),
  };
}

// Where a freshly added load starts. The athlete moves it from here; it is a
// starting position for the stepper, not a recommendation.
export const LOAD_SEED: Record<LoadKind, number> = { pct: 70, kg: 20, rpe: RPE.default };

// Set the single qualifier of a string that has at most one: add one, change
// its kind (value restarts at the seed), or remove it (`null`). Strings with a
// load AND an effort are left to the text field — this returns them unchanged.
export function setLoadKind(s: Stepped, kind: LoadKind | null): Stepped {
  if (s.quals.length > 1) return s;
  if (kind === null) return { ...s, quals: [] };
  const q: Qualifier = {
    lead: ' ',
    at: true,
    gap: '',
    kind,
    value: LOAD_SEED[kind],
    word: kind === 'rpe' ? 'RPE' : '',
    wordGap: '',
    unitGap: '',
    unit: kind === 'kg' ? METRICS.weight.unit : '',
  };
  return { ...s, quals: [q] };
}
