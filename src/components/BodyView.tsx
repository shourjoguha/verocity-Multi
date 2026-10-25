import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { getLogsInRange, getMovements, getUserStats, saveMovementTaxonomy } from '@/lib/queries';
import { toast } from '@/lib/toast';
import { loadAllLogs, logsBetween } from '@/lib/logStore';
import { useAuthedQuery } from '@/lib/useAuthedQuery';
import { supabasePublic } from '@/lib/supabase';
import type { Movement, MovementTaxonomyOverride, WorkoutLog } from '@/lib/types';
import {
  muscleTotals,
  regionTotals,
  summarizeBodyLoad,
  type BodyCurrency,
} from '@/lib/bodyLoad';
import { unweightedRepKg } from '@/lib/userStats';
import { normalizeMovementName, type OverrideMap } from '@/lib/movementTaxonomy';
import { layoutCallouts } from '@/lib/bodyCallouts';
import type { BodyFace } from '@/lib/bodyRegions';
import {
  BODY_LENSES,
  BODY_LENS_KEYS,
  DEFAULT_BODY_LENS,
  MODALITY_KEYS,
  MOVEMENT_MODALITIES,
  MOVEMENT_PLANES,
  MUSCLE_KEYS,
  MUSCLE_REGIONS,
  MUSCLE_REGION_KEYS,
  PLANE_KEYS,
  TRAINING_PERIODS,
  ROTARY_ROLES,
  type ModalityKey,
  type RegionKey,
  type BodyLensKey,
} from '@/app.config';
import { DEFAULT_PRIMARY_METRIC } from '@/lib/metrics';
import { TaxonomyEditor } from '@/components/TaxonomyEditor';
import { EmptyState, LoadingScreen, SectionHeader } from '@/components/ui/primitives';
import SegmentedTabs from '@/components/ui/SegmentedTabs';
import { Disclosure } from '@/components/ui/Disclosure';
import { ECHO_APP_TITLE, EchoText } from '@/components/EchoText';
import { BodyMap } from '@/components/BodyMap';
import { useBodyMapInk, useBodyMapStyle } from '@/lib/bodyMapPrefs';
import { setPeriod, usePeriod } from '@/lib/periodPrefs';
import { EASE, Item, PageStagger } from '@/components/anim';
import { adherenceText, useActivePlanAdherence } from '@/components/PlanAdherence';

// The page-wide measure. Work is each loaded working set counted once, split
// across the muscles it trains (so it sums to the number of sets); Volume is the
// scaled load x reps x range-of-motion index. Time-only training (runs, rides,
// yoga) has no sets and no volume, so a lens holding only that falls back to
// minutes for display (see `effective` below) rather than rendering cold.
// Both read as a % of their own total — the units differ and must never be
// compared across the toggle.
const MEASURES = [
  { key: 'work', label: 'Work' },
  { key: 'volume', label: 'Volume' },
] as const satisfies readonly { key: BodyCurrency; label: string }[];

type Measure = (typeof MEASURES)[number]['key'];

const MEASURE_NOUN: Record<BodyCurrency, string> = { work: 'work', volume: 'volume', minutes: 'time' };

// Whole percent, but a real non-zero share never reads as 0%.
function pctLabel(share: number): string {
  if (share <= 0) return '0%';
  const r = Math.round(share * 100);
  return r === 0 ? '<1%' : `${r}%`;
}

function ymd(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate(),
  ).padStart(2, '0')}`;
}

// A horizontal proportion bar, matching the RPE-fingerprint pattern in
// StatsView rather than inventing a second visual vocabulary.
function ShareBar({
  rows,
}: {
  rows: { key: string; label: string; value: number }[];
}) {
  const total = rows.reduce((a, r) => a + r.value, 0);
  if (total <= 0) return null;
  const shown = rows.filter((r) => r.value > 0);
  return (
    <div className="flex flex-col gap-3">
      {shown.map((r, i) => (
        <div key={r.key} className="flex items-center gap-3 text-sm">
          <div className="w-24 shrink-0 text-subtle">{r.label}</div>
          <motion.div
            className="flex h-3 flex-1 overflow-hidden bg-elevated"
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ duration: 0.7, ease: EASE }}
            style={{ transformOrigin: 'left' }}
          >
            <div
              className="h-full"
              style={{
                width: `${(r.value / total) * 100}%`,
                backgroundColor: 'var(--color-fg)',
                opacity: 0.3 + (1 - i / Math.max(1, shown.length)) * 0.6,
              }}
            />
          </motion.div>
          <div className="w-10 shrink-0 text-right tabular-nums text-muted">
            {Math.round((r.value / total) * 100)}%
          </div>
        </div>
      ))}
    </div>
  );
}

type RegionRowData = {
  key: RegionKey;
  label: string;
  total: number;
  minutes: number;
  share: number;
  intensity: number;
};

// One region row. Extracted because it now renders in TWO places — the top-3
// summary and the full list inside the disclosure — and a copy-paste would let
// the two drift.
function RegionRow({
  row,
  selected,
  onSelect,
}: {
  row: RegionRowData;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className={`flex min-h-11 w-full items-center gap-3 bg-surface px-3 py-2 text-left text-sm transition-colors ${
          selected ? 'text-fg' : 'text-subtle hover:text-fg'
        }`}
      >
        <span className="w-24 shrink-0">{row.label}</span>
        <span className="flex h-2 flex-1 overflow-hidden rounded-[2px] bg-elevated">
          <span
            className="h-full"
            style={{
              width: `${row.intensity * 100}%`,
              backgroundColor: 'var(--color-fg)',
              opacity: selected ? 0.9 : 0.55,
            }}
          />
        </span>
        <span className="w-14 shrink-0 text-right tabular-nums text-muted">
          {pctLabel(row.share)}
        </span>
      </button>
    </li>
  );
}

// Roughly where each region sits down the figure, so a callout points at the
// part it names instead of floating at an arbitrary height. Percentages of the
// stage's height, tuned against the silhouette in BodyMap.
const CALLOUT_TOP: Record<RegionKey, number> = {
  shoulders: 18,
  chest: 26,
  back: 26,
  arms: 38,
  core: 40,
  glutes: 54,
  hamstrings: 62,
  quads: 58,
  calves: 78,
};

export default function BodyView({ mode = 'app' }: { mode?: 'app' | 'showcase' }) {
  const showcase = mode === 'showcase';
  const client = showcase ? supabasePublic : undefined;
  // Shared with Stats and saved on the device (lib/periodPrefs.ts).
  const periodKey = usePeriod();
  const [measure, setMeasure] = useState<Measure>('work');
  // Defaults to strength, the lens where "volume" means load moved rather than
  // duration re-spelled. See BODY_LENSES in app.config.ts.
  const [lens, setLens] = useState<BodyLensKey>(DEFAULT_BODY_LENS);
  const [face, setFace] = useState<BodyFace>('front');
  const bodyMapStyle = useBodyMapStyle();
  const bodyMapInk = useBodyMapInk();
  const [selected, setSelected] = useState<RegionKey | null>(null);
  const [mapping, setMapping] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Overrides saved in this session, so the map updates without a refetch.
  const [localOverrides, setLocalOverrides] = useState<OverrideMap>({});
  const adherence = useActivePlanAdherence(!showcase);

  const days = TRAINING_PERIODS.find((p) => p.key === periodKey)!.days;
  // Real "now" on both surfaces — the showcase is live (migration 0034).
  const today = new Date();
  const from = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - (days - 1)),
  );

  const { data: logs, loading } = useAuthedQuery(
    () =>
      showcase
        ? getLogsInRange(ymd(from), ymd(today), client)
        : loadAllLogs().then((all) => logsBetween(all, ymd(from), ymd(today))),
    { auth: !showcase, key: showcase ? undefined : `body:logs:${periodKey}` },
  );
  const { data: movements } = useAuthedQuery(() => getMovements(client), {
    auth: !showcase,
    key: showcase ? undefined : 'movements',
  });
  // Owner bodyweight, used to price unweighted work. Short-circuited in showcase
  // mode: `user_stats` has no anon policy, so the request could only ever come
  // back null. The public map falls back to the flat constant — exactly the
  // pre-bodyweight behaviour.
  const { data: stats, loading: statsLoading } = useAuthedQuery(
    () => (showcase ? Promise.resolve(null) : getUserStats()),
    { auth: !showcase, key: showcase ? undefined : 'userStats' },
  );

  // Per-user corrections, keyed by normalised name. Rows without a taxonomy
  // payload simply contribute nothing.
  const overrides: OverrideMap = useMemo(() => {
    const out: OverrideMap = {};
    for (const m of (movements ?? []) as Movement[]) {
      if (m.taxonomy) out[normalizeMovementName(m.name)] = m.taxonomy;
    }
    return { ...out, ...localOverrides };
  }, [movements, localOverrides]);

  // Logging a new name usually already created its owner-scoped library row
  // (with no taxonomy), so saving a map UPDATES that row, and creates one only
  // when there is none — see saveMovementTaxonomy. A failed save says so; it
  // used to leave the sheet open with no word, which read as a dead button.
  async function handleMap(name: string, taxonomy: MovementTaxonomyOverride) {
    if (busy) return;
    setBusy(true);
    const saved = await saveMovementTaxonomy({
      name,
      category: null,
      primary_metric: DEFAULT_PRIMARY_METRIC,
      default_rest_seconds: 120,
      taxonomy,
    });
    setBusy(false);
    if (saved) {
      setLocalOverrides((prev) => ({ ...prev, [normalizeMovementName(name)]: taxonomy }));
      setMapping(null);
    } else {
      toast(`Couldn't save the mapping for ${name}`, 'error');
    }
  }

  const all: WorkoutLog[] = logs ?? [];
  const unweightedKg = unweightedRepKg(stats ?? null);
  const summary = useMemo(
    () => summarizeBodyLoad(all, overrides, { unweightedKg }),
    [all, overrides, unweightedKg],
  );
  // What the page actually shows. The chosen measure, unless this lens has none
  // of it in the period but does have minutes — then time, with a note. Decided
  // per lens so Strength can read Work while Cardio reads time.
  const effective: BodyCurrency = useMemo(() => {
    const sum = (c: BodyCurrency) =>
      Object.values(regionTotals(summary, c, lens)).reduce((a, b) => a + b, 0);
    if (sum(measure) > 0) return measure;
    return sum('minutes') > 0 ? 'minutes' : measure;
  }, [summary, measure, lens]);
  const fellBack = effective !== measure;
  // Work counts sets only, so a cardio or mobility lens on Work misses timed
  // and distance work that Volume prices as rep-equivalents. Point at Volume.
  const volumeHint = measure === 'work' && (lens === 'cardio' || lens === 'mobility');

  // The map shades each muscle by its SHARE of the active measure's total, in
  // fixed bands (bodyMapShade) — not relative to the busiest muscle, so one
  // dominant muscle cannot wash the rest out, and the legend, callouts and list
  // all read the same unit. (muscleIntensities, which normalises to the max, is
  // no longer read here.)
  const intensity = useMemo(() => {
    const t = muscleTotals(summary, effective, lens);
    const sum = Object.values(t).reduce((a, b) => a + b, 0);
    return Object.fromEntries(
      MUSCLE_KEYS.map((m) => [m, sum > 0 ? t[m] / sum : 0]),
    ) as Record<(typeof MUSCLE_KEYS)[number], number>;
  }, [summary, effective, lens]);
  // Decision D4: a muscle is ESTIMATED when any of the ACTIVE measure came from
  // the default region split rather than an authored muscle profile. The epsilon
  // only absorbs float noise between two sums of the same quantity.
  // Marked only while coverage is PARTIAL: when every muscle is estimated (or
  // none is) the mark distinguishes nothing, dashes every plate and buries the
  // gaps, and the caption below already says it.
  const coverage = summary.muscleCoverage[effective];
  const estimated = useMemo(
    () => {
      const whole =
        effective === 'work'
          ? summary.muscleWork
          : effective === 'volume'
            ? summary.muscleVolume
            : summary.muscleMinutes;
      const partial = coverage > 0 && coverage < 1;
      return Object.fromEntries(
        MUSCLE_KEYS.map((m) => [
          m,
          partial && whole[m] - summary.muscleAuthored[effective][m] > 1e-6,
        ]),
      ) as Record<(typeof MUSCLE_KEYS)[number], boolean>;
    },
    [summary, effective, coverage],
  );

  // Wait on stats too, or Volume would paint at the flat constant and then jump
  // once bodyweight lands.
  if (loading || statsLoading) return <LoadingScreen />;

  const totals = regionTotals(summary, effective, lens);
  const regionMax = Math.max(0, ...Object.values(totals));
  const totalSum = Object.values(totals).reduce((a, b) => a + b, 0);
  // Share of this period's active measure that is estimated (D4); 0 hides the line.
  const estimatedPct = 100 - Math.round(coverage * 100);
  // Emptiness is a property of the LENS, not the window — measured on minutes so
  // the answer does not change when the measure toggle does.
  const lensTotal = Object.values(regionTotals(summary, 'minutes', lens)).reduce((a, b) => a + b, 0);
  const regionRows = MUSCLE_REGION_KEYS.map((k) => ({
    key: k,
    label: MUSCLE_REGIONS[k].label,
    total: totals[k],
    minutes: summary.regionMinutes[k],
    share: totalSum > 0 ? totals[k] / totalSum : 0,
    intensity: regionMax > 0 ? totals[k] / regionMax : 0,
  })).sort((a, b) => b.total - a.total);

  // Regions with any of the ACTIVE measure. (This used to filter on minutes so a
  // region would not vanish when the toggle flipped; with % of total a 0% row is
  // noise, and a lens with none of the measure falls back to time above.)
  const worked = regionRows.filter((r) => r.total > 0);
  const systemicShare =
    summary.totalMinutes > 0 ? summary.systemicMinutes / summary.totalMinutes : 0;

  const rotaryTotal = summary.rotaryMinutes.rotational + summary.rotaryMinutes.antiRotational;

  // The four busiest regions, annotated on the figure, as a share of the TOTAL
  // of the active measure — the same measure the silhouette is shaded by and the
  // list beside it ranks by, so the three cannot disagree.
  // Side and final height come from layoutCallouts, which alternates edges
  // going DOWN the figure and then slots each edge apart. Ranking by list
  // position put chest and back — both at 26% — on the same edge at the same
  // height, and nothing enforced a gap between them.
  const callouts = layoutCallouts(
    worked.slice(0, 4).map((r) => ({
      key: r.key,
      label: MUSCLE_REGIONS[r.key].short,
      pct: Math.round(r.share * 100),
      top: CALLOUT_TOP[r.key],
    })),
  );

  // How you trained, grouped by LENS: the bar is the lens control. The lenses
  // partition the modalities (BODY_LENSES), so the three shares are the old
  // five-way split regrouped, and the sub-line under the bar keeps the
  // within-lens split (plyometric and isometric inside Strength). Order is the
  // tab order, not size order, so each segment sits over its own tab.
  const modalityTotal = MODALITY_KEYS.reduce((a, k) => a + summary.modalityMinutes[k], 0);
  const pctOf = (min: number) => (modalityTotal > 0 ? Math.round((min / modalityTotal) * 100) : 0);
  const lensGroups = BODY_LENS_KEYS.map((k, i) => {
    const mods = BODY_LENSES[k].modalities as readonly ModalityKey[];
    return {
      key: k,
      label: BODY_LENSES[k].label,
      minutes: mods.reduce((a, m) => a + summary.modalityMinutes[m], 0),
      parts: mods
        .filter((m) => summary.modalityMinutes[m] > 0)
        .sort((a, b) => summary.modalityMinutes[b] - summary.modalityMinutes[a])
        .map((m) => `${MOVEMENT_MODALITIES[m].label} ${pctOf(summary.modalityMinutes[m])}%`),
      tone: `color-mix(in srgb, var(--color-fg) ${Math.round(
        100 - (i / BODY_LENS_KEYS.length) * 65,
      )}%, var(--color-elevated))`,
    };
  });
  const activeGroup = lensGroups.find((g) => g.key === lens)!;

  const planeTotal = PLANE_KEYS.reduce((a, k) => a + summary.planeMinutes[k], 0);
  const topPlane = [...PLANE_KEYS].sort((a, b) => summary.planeMinutes[b] - summary.planeMinutes[a])[0];

  return (
    <PageStagger className="mx-auto max-w-3xl px-4 pb-8 pt-5 sm:px-6">
      {/* The period and the measure drive the whole page, so both sit in the
          header: the totals under them change with the period and nothing else. */}
      <Item>
        <div className="mb-5 flex items-start justify-between gap-3">
          {/* Adherence sits under the title, in the height the right-hand
              controls already take: the whole plan, so not in the period line. */}
          <div className="flex min-w-0 flex-col items-start">
            <EchoText text="BODY" as="h1" className={ECHO_APP_TITLE} />
            {adherence ? (
              <a
                href="/app/plan"
                className="-my-3 inline-flex min-h-11 items-center text-[0.7rem] tabular-nums text-muted underline"
              >
                {adherenceText(adherence)}
              </a>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5 pt-1">
            <SegmentedTabs
              tabs={TRAINING_PERIODS.map((p) => ({ key: p.key, label: p.label }))}
              active={periodKey}
              onChange={(k) => setPeriod(k as (typeof TRAINING_PERIODS)[number]['key'])}
              ariaLabel="Time period"
              size="sm"
              className="w-[15rem]"
            />
            <SegmentedTabs
              tabs={MEASURES.map((m) => ({ key: m.key, label: m.label }))}
              active={measure}
              onChange={(k) => setMeasure(k as Measure)}
              ariaLabel="Measure muscles by"
              size="sm"
              as="radiogroup"
              className="w-40"
            />
            {summary.totalMinutes > 0 ? (
              <p className="t-label text-muted opacity-75 tabular-nums">
                {Math.round(summary.totalMinutes)} min · {summary.sessions}{' '}
                {summary.sessions === 1 ? 'session' : 'sessions'}
              </p>
            ) : null}
          </div>
        </div>
      </Item>

      {summary.totalMinutes === 0 ? (
        <Item>
          <EmptyState>No completed sessions in this period.</EmptyState>
        </Item>
      ) : (
        <>
          {/* One card, read top to bottom: how the window split by kind of
              work — which IS the lens control — then the figure for the chosen
              lens, then the detail on request. The bar used to sit apart from
              a second Strength/Cardio/Mobility tab row that grouped the same
              modalities; two widgets for one split, only one of them live. */}
          <Item>
            <section className="lift mb-6 border border-border bg-surface">
              <div className="p-3">
                <h2 className="t-label mb-2 text-muted">How you trained</h2>
                <div
                  className="mb-2 flex h-2.5 gap-[2px] overflow-hidden rounded-[2px]"
                  role="img"
                  aria-label={lensGroups.map((g) => `${g.label} ${pctOf(g.minutes)}%`).join(', ')}
                >
                  {lensGroups
                    .filter((g) => g.minutes > 0)
                    .map((g) => (
                      <div
                        key={g.key}
                        className="min-w-[3px] transition-opacity"
                        style={{
                          flexGrow: g.minutes,
                          backgroundColor: g.tone,
                          opacity: g.key === lens ? 1 : 0.35,
                        }}
                      />
                    ))}
                </div>
                <SegmentedTabs
                  tabs={lensGroups.map((g) => ({
                    key: g.key,
                    label: `${g.label} ${pctOf(g.minutes)}%`,
                  }))}
                  active={lens}
                  onChange={(k) => setLens(k as BodyLensKey)}
                  ariaLabel="Kind of work"
                  size="sm"
                />
                {fellBack && lensTotal > 0 && !volumeHint ? (
                  <p className="mt-2 text-xs text-muted">
                    No {measure === 'work' ? 'sets' : 'volume'} logged for{' '}
                    {BODY_LENSES[lens].label.toLowerCase()} — showing time
                  </p>
                ) : null}
                {activeGroup.parts.length > 0 ? (
                  <p className="mt-2 text-xs text-muted tabular-nums">
                    {activeGroup.parts.join(' · ')}
                  </p>
                ) : null}
              </div>

              {/* THE CALLOUTS ARE SIBLINGS OF <BodyMap>, NOT ANCESTORS OF THE
                  STAGE. BodyMap is a CSS-only 3D slab, and any grouping
                  property (overflow:hidden, opacity<1, filter, mask,
                  clip-path, contain:paint) on an element BETWEEN
                  .bodymap-stage and the faces flattens it silently. This
                  wrapper adds only `position: relative`. Do not move these
                  inside, and do not add overflow-hidden here or on the card. */}
              <div className="border-t border-border-soft px-3 pb-2 pt-4">
                {lensTotal === 0 ? (
                  /* The period HAS work, this lens does not. Without its own
                     message the silhouette just renders cold and reads as
                     broken rather than empty. */
                  <p className="py-8 text-center text-sm text-muted">
                    No {BODY_LENSES[lens].label.toLowerCase()} work logged in this period.
                  </p>
                ) : (
                  <div className="relative">
                    <BodyMap
                      intensity={intensity}
                      estimated={estimated}
                      systemic={systemicShare}
                      face={face}
                      onFaceChange={setFace}
                      selected={selected}
                      style={bodyMapStyle}
                      ink={bodyMapInk}
                      legendCaption={`% of total ${MEASURE_NOUN[effective]}`}
                    />
                    {callouts.map((c) => (
                      <div
                        key={c.key}
                        className={`pointer-events-none absolute max-w-[5.5rem] ${
                          c.side === 'left' ? 'left-0 text-right' : 'right-0 text-left'
                        }`}
                        style={{ top: `${c.top}%` }}
                      >
                        <div className="t-label leading-tight text-muted">{c.label}</div>
                        <div className="font-display text-sm leading-tight tabular-nums text-fg">
                          {c.pct}%
                        </div>
                        <div
                          className={`mt-1 h-px w-6 bg-border ${c.side === 'left' ? 'ml-auto' : ''}`}
                        />
                      </div>
                    ))}
                  </div>
                )}
                {volumeHint && lensTotal > 0 ? (
                  <p className="mt-1 text-center text-xs text-muted">
                    {fellBack ? 'Showing time. ' : ''}Pick Volume to see sports and other
                    non set-rep work
                  </p>
                ) : null}
                {lensTotal > 0 && estimatedPct > 0 ? (
                  <p className="mt-1 text-center text-xs text-muted tabular-nums">
                    Muscle detail is estimated for {estimatedPct}% of this period's{' '}
                    {MEASURE_NOUN[effective]}
                  </p>
                ) : null}
              </div>

              {planeTotal > 0 ? (
                <Disclosure
                  variant="row"
                  title="Plane of motion"
                  headerRight={`${MOVEMENT_PLANES[topPlane].label} ${Math.round(
                    (summary.planeMinutes[topPlane] / planeTotal) * 100,
                  )}%`}
                >
                  <ShareBar
                    rows={PLANE_KEYS.map((k) => ({
                      key: k,
                      label: MOVEMENT_PLANES[k].label,
                      value: summary.planeMinutes[k],
                    }))}
                  />
                  {rotaryTotal > 0 ? (
                    <div className="mt-4">
                      <div className="t-label mb-2 text-muted">Within transverse</div>
                      <ShareBar
                        rows={(['rotational', 'antiRotational'] as const).map((k) => ({
                          key: k,
                          label: ROTARY_ROLES[k].label,
                          value: summary.rotaryMinutes[k],
                        }))}
                      />
                    </div>
                  ) : null}
                </Disclosure>
              ) : null}

              {/* Only when there is something to map. Its header carries the
                  coverage, which used to sit in the meta line for everyone. */}
              {summary.unmapped.length > 0 ? (
                <Disclosure
                  variant="row"
                  title={`Unmapped (${summary.unmapped.length})`}
                  headerRight={`${Math.round(summary.coverage * 100)}% mapped`}
                >
                  <ul className="-mx-3 divide-y divide-border-soft">
                    {summary.unmapped.map((u) => (
                      <li key={u.name} className="flex items-center gap-3 px-3 py-1 text-sm">
                        <span className="min-w-0 flex-1 truncate text-fg">{u.name}</span>
                        <span className="shrink-0 tabular-nums text-muted">
                          {u.sessions} {u.sessions === 1 ? 'session' : 'sessions'}
                        </span>
                        {showcase ? null : (
                          <button
                            type="button"
                            onClick={() => setMapping(u.name)}
                            className="flex min-h-11 shrink-0 items-center px-2 t-control text-muted hover:text-fg"
                            aria-label={`Map ${u.name}`}
                          >
                            Map
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 t-control text-muted">
                    These names could not be classified — often a name that lost its tail on
                    import. Mapping one adds it to your Library.
                  </p>
                </Disclosure>
              ) : null}
            </section>
          </Item>

          {/* Top three, then the rest in the same card. Region selection lives
              on these ROWS, not on the SVG paths: a 12px calf path as a
              role="button" would fail the 44px tap-target audit, and a row
              gives screen readers real text. The Work/Volume toggle lives in the
              page header: it drives the whole page, not just this list. */}
          {worked.length > 0 && lensTotal > 0 ? (
            <Item>
              <section className="mb-6">
                <SectionHeader>Most worked</SectionHeader>
                <div className="lift overflow-hidden border border-border bg-surface">
                  <ul className="flex flex-col gap-px bg-border-soft">
                    {worked.slice(0, 3).map((r) => (
                      <RegionRow
                        key={r.key}
                        row={r}
                        selected={selected === r.key}
                        onSelect={() => setSelected(selected === r.key ? null : r.key)}
                      />
                    ))}
                  </ul>
                  {worked.length > 3 ? (
                    <Disclosure variant="row" title={`Show all ${worked.length}`}>
                      <ul className="-mx-3 -mb-3 flex flex-col gap-px bg-border-soft">
                        {worked.slice(3).map((r) => (
                          <RegionRow
                            key={r.key}
                            row={r}
                                selected={selected === r.key}
                            onSelect={() => setSelected(selected === r.key ? null : r.key)}
                          />
                        ))}
                      </ul>
                    </Disclosure>
                  ) : null}
                </div>
                {effective === 'volume' ? (
                  <p className="mt-2 text-[0.7rem] text-muted">
                    Scaled volume — load × reps × range of motion, with unloaded work priced
                    against your bodyweight. Shown as a share of the period's total.
                  </p>
                ) : effective === 'work' ? (
                  <p className="mt-2 text-[0.7rem] text-muted">
                    Work — each loaded set counts once, split across the muscles it trains.
                    Shown as a share of the period's total.
                  </p>
                ) : null}
              </section>
            </Item>
          ) : null}
        </>
      )}

      {/* Outside the stagger, like every other view's sheets. */}
      <TaxonomyEditor
        open={mapping !== null}
        movementName={mapping ?? ''}
        busy={busy}
        onSave={(profile) => mapping && handleMap(mapping, profile)}
        onClose={() => setMapping(null)}
      />
    </PageStagger>
  );
}
