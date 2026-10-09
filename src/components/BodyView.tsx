import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { createMovement, getLogsInRange, getMovements, getUserStats } from '@/lib/queries';
import { loadAllLogs, logsBetween } from '@/lib/logStore';
import { useAuthedQuery } from '@/lib/useAuthedQuery';
import { supabasePublic } from '@/lib/supabase';
import type { Movement, WorkoutLog } from '@/lib/types';
import { regionIntensities, regionTotals, summarizeBodyLoad, type BodyCurrency } from '@/lib/bodyLoad';
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
  MUSCLE_REGIONS,
  MUSCLE_REGION_KEYS,
  PLANE_KEYS,
  ROTARY_ROLES,
  type ModalityKey,
  type MovementProfile,
  type RegionKey,
  type BodyLensKey,
} from '@/app.config';
import { DEFAULT_PRIMARY_METRIC } from '@/lib/metrics';
import { TaxonomyEditor } from '@/components/TaxonomyEditor';
import { formatRound } from '@/lib/format';
import { EmptyState, LoadingScreen, SectionHeader } from '@/components/ui/primitives';
import SegmentedTabs from '@/components/ui/SegmentedTabs';
import { Disclosure } from '@/components/ui/Disclosure';
import { ECHO_APP_TITLE, EchoText } from '@/components/EchoText';
import { BodyMap } from '@/components/BodyMap';
import { EASE, Item, PageStagger } from '@/components/anim';

const WINDOWS = [
  { key: '4w', label: '4W', days: 28 },
  { key: '8w', label: '8W', days: 56 },
  { key: '13w', label: '3M', days: 91 },
  { key: '26w', label: '6M', days: 182 },
] as const;

type WindowKey = (typeof WINDOWS)[number]['key'];

// The two readings of the same window. Minutes answers "how long did I work this
// region", volume answers "how much work landed there" — a 45-minute mobility
// flow and a 45-minute squat session are the same on the first and nothing alike
// on the second.
//
// They are NOT two spellings of one number and must never be read against each
// other: minutes are wall clock, volume is load x rep-equivalents. Volume used to
// collapse onto minutes anyway, because duration converts into rep-equivalents —
// which is exactly what BODY_LENSES now prevents by keeping the comparison inside
// one kind of work. Minutes stays the default because it is the currency that
// survives for every lens.
const CURRENCIES = [
  { key: 'minutes', label: 'Minutes' },
  { key: 'volume', label: 'Volume' },
] as const satisfies readonly { key: BodyCurrency; label: string }[];

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
  sets: number;
  intensity: number;
};

// One region row. Extracted because it now renders in TWO places — the top-3
// summary and the full list inside the disclosure — and a copy-paste would let
// the two drift.
function RegionRow({
  row,
  currency,
  selected,
  onSelect,
}: {
  row: RegionRowData;
  currency: BodyCurrency;
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
          {currency === 'minutes' ? `${formatRound(row.total, 0)}m` : formatRound(row.total, 0)}
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
  const [windowKey, setWindowKey] = useState<WindowKey>('8w');
  const [currency, setCurrency] = useState<BodyCurrency>('minutes');
  // Defaults to strength, the lens where "volume" means load moved rather than
  // duration re-spelled. See BODY_LENSES in app.config.ts.
  const [lens, setLens] = useState<BodyLensKey>(DEFAULT_BODY_LENS);
  const [face, setFace] = useState<BodyFace>('front');
  const [selected, setSelected] = useState<RegionKey | null>(null);
  const [mapping, setMapping] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Overrides saved in this session, so the map updates without a refetch.
  const [localOverrides, setLocalOverrides] = useState<OverrideMap>({});

  const days = WINDOWS.find((w) => w.key === windowKey)!.days;
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
    { auth: !showcase, key: showcase ? undefined : `body:logs:${windowKey}` },
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

  // A logged movement usually has no library row (logs carry only a name), so
  // saving a map CREATES the owner-scoped row. createMovement sets
  // owner_user_id itself, which satisfies 0005_lock_shared_library by
  // construction — and it is also how the library finally gets populated.
  async function handleMap(name: string, taxonomy: MovementProfile) {
    if (busy) return;
    setBusy(true);
    const created = await createMovement({
      name,
      category: null,
      primary_metric: DEFAULT_PRIMARY_METRIC,
      default_rest_seconds: 120,
      taxonomy,
    });
    setBusy(false);
    if (created) {
      setLocalOverrides((prev) => ({ ...prev, [normalizeMovementName(name)]: taxonomy }));
      setMapping(null);
    }
  }

  const all: WorkoutLog[] = logs ?? [];
  const unweightedKg = unweightedRepKg(stats ?? null);
  const summary = useMemo(
    () => summarizeBodyLoad(all, overrides, { unweightedKg }),
    [all, overrides, unweightedKg],
  );
  // Normalised per currency, so the heat map cannot contradict the list beside it.
  const intensity = useMemo(
    () => regionIntensities(summary, currency, lens),
    [summary, currency, lens],
  );

  // Wait on stats too, or Volume would paint at the flat constant and then jump
  // once bodyweight lands.
  if (loading || statsLoading) return <LoadingScreen />;

  const totals = regionTotals(summary, currency, lens);
  // Emptiness is a property of the LENS, not the window — measured on minutes so
  // the answer does not change when the currency toggle does.
  const lensTotal = Object.values(regionTotals(summary, 'minutes', lens)).reduce((a, b) => a + b, 0);
  const regionRows = MUSCLE_REGION_KEYS.map((k) => ({
    key: k,
    label: MUSCLE_REGIONS[k].label,
    total: totals[k],
    minutes: summary.regionMinutes[k],
    sets: summary.resistanceSets[k],
    intensity: intensity[k],
  })).sort((a, b) => b.total - a.total);

  // Filter on minutes, not on the active currency: a region with logged work but
  // zero volume should still appear rather than vanish when the toggle flips.
  const worked = regionRows.filter((r) => r.minutes > 0);
  const systemicShare =
    summary.totalMinutes > 0 ? summary.systemicMinutes / summary.totalMinutes : 0;

  const rotaryTotal = summary.rotaryMinutes.rotational + summary.rotaryMinutes.antiRotational;

  // The four busiest regions, annotated on the figure. Shares are always of
  // MINUTES regardless of the currency toggle: the callouts sit beside a
  // silhouette shaded by `intensity`, and a percentage that changed meaning
  // when a toggle further down the page flipped would be quietly wrong.
  // Side and final height come from layoutCallouts, which alternates edges
  // going DOWN the figure and then slots each edge apart. Ranking by list
  // position put chest and back — both at 26% — on the same edge at the same
  // height, and nothing enforced a gap between them.
  const totalWorked = worked.reduce((a, r) => a + r.minutes, 0);
  const callouts = layoutCallouts(
    worked.slice(0, 4).map((r) => ({
      key: r.key,
      label: MUSCLE_REGIONS[r.key].short,
      pct: totalWorked > 0 ? Math.round((r.minutes / totalWorked) * 100) : 0,
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
      {/* The window and the totals it produces share the title row: the
          minutes and sessions change with 4W/8W/3M/6M and with nothing else on
          the page, so they sit under the control that moves them. */}
      <Item>
        <div className="mb-5 flex items-start justify-between gap-3">
          <EchoText text="BODY" as="h1" className={ECHO_APP_TITLE} />
          <div className="flex shrink-0 flex-col items-end gap-1.5 pt-1">
            <SegmentedTabs
              tabs={WINDOWS.map((w) => ({ key: w.key, label: w.label }))}
              active={windowKey}
              onChange={(k) => setWindowKey(k as WindowKey)}
              ariaLabel="Time window"
              size="sm"
              className="w-[13rem]"
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
          <EmptyState>No completed sessions in this window.</EmptyState>
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
                  /* The window HAS work, this lens does not. Without its own
                     message the silhouette just renders cold and reads as
                     broken rather than empty. */
                  <p className="py-8 text-center text-sm text-muted">
                    No {BODY_LENSES[lens].label.toLowerCase()} work logged in this window.
                  </p>
                ) : (
                  <div className="relative">
                    <BodyMap
                      intensity={intensity}
                      systemic={systemicShare}
                      face={face}
                      onFaceChange={setFace}
                      selected={selected}
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
              gives screen readers real text. The currency toggle sits in the
              header because it changes the top three too, not only the list
              it used to be hidden inside. */}
          {worked.length > 0 && lensTotal > 0 ? (
            <Item>
              <section className="mb-6">
                <SectionHeader
                  action={
                    <SegmentedTabs
                      tabs={CURRENCIES.map((c) => ({ key: c.key, label: c.label }))}
                      active={currency}
                      onChange={(k) => setCurrency(k as BodyCurrency)}
                      ariaLabel="Measure regions by"
                      size="compact"
                      as="radiogroup"
                      className="w-40"
                    />
                  }
                >
                  Most worked
                </SectionHeader>
                <div className="lift overflow-hidden border border-border bg-surface">
                  <ul className="flex flex-col gap-px bg-border-soft">
                    {worked.slice(0, 3).map((r) => (
                      <RegionRow
                        key={r.key}
                        row={r}
                        currency={currency}
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
                            currency={currency}
                            selected={selected === r.key}
                            onSelect={() => setSelected(selected === r.key ? null : r.key)}
                          />
                        ))}
                      </ul>
                    </Disclosure>
                  ) : null}
                </div>
                {currency === 'volume' ? (
                  <p className="mt-2 text-[0.7rem] text-muted">
                    Scaled volume — load × reps × range of motion, with unloaded work priced
                    against your bodyweight. A relative index, not kilograms.
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
