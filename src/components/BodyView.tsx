import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { createMovement, getLogsInRange, getMovements } from '@/lib/queries';
import { useAuthedQuery } from '@/lib/useAuthedQuery';
import { supabasePublic } from '@/lib/supabase';
import { showcaseRefDate } from '@/lib/showcase';
import type { Movement, WorkoutLog } from '@/lib/types';
import { regionIntensities, summarizeBodyLoad } from '@/lib/bodyLoad';
import { normalizeMovementName, type OverrideMap } from '@/lib/movementTaxonomy';
import type { BodyFace } from '@/lib/bodyRegions';
import {
  MODALITY_KEYS,
  MOVEMENT_MODALITIES,
  MOVEMENT_PLANES,
  MUSCLE_REGIONS,
  MUSCLE_REGION_KEYS,
  PLANE_KEYS,
  ROTARY_ROLES,
  type MovementProfile,
  type RegionKey,
} from '@/app.config';
import { TaxonomyEditor } from '@/components/TaxonomyEditor';
import { formatRound } from '@/lib/format';
import { Card, EmptyState, LoadingScreen, SectionHeader, StatCard } from '@/components/ui/primitives';
import { EchoText } from '@/components/EchoText';
import { BodyMap } from '@/components/BodyMap';
import { EASE, Item, PageStagger } from '@/components/anim';

const WINDOWS = [
  { key: '4w', label: '4 weeks', days: 28 },
  { key: '8w', label: '8 weeks', days: 56 },
  { key: '26w', label: '6 months', days: 182 },
] as const;

type WindowKey = (typeof WINDOWS)[number]['key'];

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

export default function BodyView({ mode = 'app' }: { mode?: 'app' | 'showcase' }) {
  const showcase = mode === 'showcase';
  const client = showcase ? supabasePublic : undefined;
  const [windowKey, setWindowKey] = useState<WindowKey>('8w');
  const [face, setFace] = useState<BodyFace>('front');
  const [selected, setSelected] = useState<RegionKey | null>(null);
  const [mapping, setMapping] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Overrides saved in this session, so the map updates without a refetch.
  const [localOverrides, setLocalOverrides] = useState<OverrideMap>({});

  const days = WINDOWS.find((w) => w.key === windowKey)!.days;
  const today = showcase ? showcaseRefDate() : new Date();
  const from = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - (days - 1)),
  );

  const { data: logs, loading } = useAuthedQuery(
    () => getLogsInRange(ymd(from), ymd(today), client),
    { auth: !showcase, key: showcase ? undefined : `body:logs:${windowKey}` },
  );
  const { data: movements } = useAuthedQuery(() => getMovements(client), {
    auth: !showcase,
    key: showcase ? undefined : 'movements',
  });

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
      primary_metric: 'weight',
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
  const summary = useMemo(() => summarizeBodyLoad(all, overrides), [all, overrides]);
  const intensity = useMemo(() => regionIntensities(summary), [summary]);

  if (loading) return <LoadingScreen />;

  const regionRows = MUSCLE_REGION_KEYS.map((k) => ({
    key: k,
    label: MUSCLE_REGIONS[k].label,
    minutes: summary.regionMinutes[k],
    sets: summary.resistanceSets[k],
    intensity: intensity[k],
  })).sort((a, b) => b.minutes - a.minutes);

  const worked = regionRows.filter((r) => r.minutes > 0);
  const systemicShare =
    summary.totalMinutes > 0 ? summary.systemicMinutes / summary.totalMinutes : 0;

  const rotaryTotal = summary.rotaryMinutes.rotational + summary.rotaryMinutes.antiRotational;

  return (
    <PageStagger className="mx-auto max-w-3xl px-4 sm:px-6 py-8">
      <Item>
        <div className="mb-6 flex items-end justify-between gap-4">
          <EchoText
            text="BODY"
            as="h1"
            className="font-display text-3xl font-bold uppercase leading-[0.9] tracking-[-0.04em] text-fg sm:text-5xl md:text-7xl"
          />
        </div>
      </Item>

      <Item>
        <div className="t-label mb-6 flex gap-1">
          {WINDOWS.map((w) => (
            <button
              key={w.key}
              type="button"
              onClick={() => setWindowKey(w.key)}
              aria-pressed={windowKey === w.key}
              className={`hill-btn flex min-h-11 items-center border bg-surface px-3 transition-colors ${
                windowKey === w.key ? 'border-fg text-fg' : 'border-border text-muted hover:text-fg'
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>
      </Item>

      {summary.totalMinutes === 0 ? (
        <Item>
          <EmptyState>No completed sessions in this window.</EmptyState>
        </Item>
      ) : (
        <>
          <Item>
            <div className="mb-6 grid grid-cols-3 gap-px bg-border">
              <StatCard label="Working min" value={Math.round(summary.totalMinutes)} />
              <StatCard label="Sessions" value={summary.sessions} />
              <StatCard label="Mapped" value={`${Math.round(summary.coverage * 100)}%`} />
            </div>
          </Item>

          <Item>
            <section className="mb-8 grid gap-6 sm:grid-cols-2 sm:items-start">
              {/* The Card carries .lift; the stage inside carries the
                  perspective. Never the other way round — see global.css. */}
              <Card>
                <div className="p-4">
                  <BodyMap
                    intensity={intensity}
                    systemic={systemicShare}
                    face={face}
                    onFaceChange={setFace}
                    selected={selected}
                  />
                  <p className="mt-3 text-center t-control text-muted">
                    Drag to turn · {Math.round(systemicShare * 100)}% full-body
                  </p>
                </div>
              </Card>

              {/* Region selection lives HERE, not on the SVG paths: a 12px
                  calf path as a role="button" would fail the 44px tap-target
                  audit, and a list row gives screen readers real text. */}
              <div>
                <SectionHeader>Regions</SectionHeader>
                <ul className="flex flex-col gap-px bg-border">
                  {worked.map((r) => (
                    <li key={r.key}>
                      <button
                        type="button"
                        onClick={() => setSelected(selected === r.key ? null : r.key)}
                        aria-pressed={selected === r.key}
                        className={`flex min-h-11 w-full items-center gap-3 bg-surface px-3 py-2 text-left text-sm transition-colors ${
                          selected === r.key ? 'text-fg' : 'text-subtle hover:text-fg'
                        }`}
                      >
                        <span className="w-24 shrink-0">{r.label}</span>
                        <span className="flex h-2 flex-1 overflow-hidden bg-elevated">
                          <span
                            className="h-full"
                            style={{
                              width: `${r.intensity * 100}%`,
                              backgroundColor: 'var(--color-fg)',
                              opacity: selected === r.key ? 0.9 : 0.55,
                            }}
                          />
                        </span>
                        <span className="w-12 shrink-0 text-right tabular-nums text-muted">
                          {formatRound(r.minutes, 0)}m
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          </Item>

          <Item>
            <section className="mb-8">
              <SectionHeader>Modality</SectionHeader>
              <ShareBar
                rows={MODALITY_KEYS.map((k) => ({
                  key: k,
                  label: MOVEMENT_MODALITIES[k].label,
                  value: summary.modalityMinutes[k],
                }))}
              />
            </section>
          </Item>

          <Item>
            <section className="mb-8">
              <SectionHeader>Plane of motion</SectionHeader>
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
            </section>
          </Item>

          {summary.unmapped.length > 0 ? (
            <Item>
              <section>
                <SectionHeader>Unmapped ({summary.unmapped.length})</SectionHeader>
                <Card>
                  <ul className="divide-y divide-border">
                    {summary.unmapped.map((u) => (
                      <li key={u.name} className="flex items-center gap-3 px-4 py-2 text-sm">
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
                </Card>
                <p className="mt-2 t-control text-muted">
                  These names could not be classified — often a name that lost its tail on
                  import. Mapping one adds it to your Library.
                </p>
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
