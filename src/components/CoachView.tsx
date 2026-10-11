import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  addCoachAthleteNote,
  deleteCoachAthleteNote,
  getActivePlan,
  getCoachAthleteNotes,
  getCoachBriefs,
  getCoachObservations,
  getCoachRuleNotes,
  getMealLogs,
  getMovements,
  getRecentLogs,
  getRecommendations,
  getUserStats,
  deleteCoachBrief,
  updateCoachBrief,
  updateRecommendation,
  upsertCoachFindings,
  upsertCoachObservations,
} from '@/lib/queries';
import { runCoach } from '@/lib/coach/evaluate';
import { groupByTheme, type Theme } from '@/lib/coach/themes';
import {
  briefAgeDays,
  currentBrief,
  governContextNotes,
  governEdges,
  isBriefLive,
} from '@/lib/coach/governor';
import { impactScore } from '@/lib/coach/impact';
import type { Reading } from '@/lib/coach/recurrence';
import type { EvidencePayload } from '@/lib/coach/types';
import {
  TRAJECTORY_POINTS,
  checkinDelta,
  mergeSeries,
  readingsByRule,
  trajectoryLabel,
  type CheckinDelta,
  type TrajectoryLabel,
} from '@/lib/coach/trajectory';
import { normalizeMovementName, type OverrideMap } from '@/lib/movementTaxonomy';
import type {
  CoachAthleteNote,
  CoachBrief,
  CoachObservation,
  CoachRuleNote,
  Recommendation,
  RecDisposition,
} from '@/lib/types';
import { formatDate } from '@/lib/format';
import { toast } from '@/lib/toast';
import { isLiveRec, setCoachSeenAt } from '@/lib/coachSignal';
import { EmptyState, LoadingScreen, SectionHeader } from '@/components/ui/primitives';
import { ECHO_APP_TITLE, EchoText } from '@/components/EchoText';
import { Item, PageStagger } from '@/components/anim';
import { Modal } from '@/components/ui/Modal';
import { Disclosure } from '@/components/ui/Disclosure';
import DeepEnrichment from '@/components/DeepEnrichment';

/**
 * How many open findings lead the page. The rest are one tap away rather than
 * gone: the cap used to be applied inside the engine, which did not defer a
 * fifth true finding so much as destroy it — no row, no history, nothing for
 * the athlete to expand. CLAUDE.md's rule is "default to 3-4 things, collapse
 * the rest", and a collapsed default with no expansion is a removed feature.
 */
const SURFACED_LIMIT = 3;

/**
 * Rank an existing row the same way the engine ranked the finding that wrote
 * it. Recomputed from `rule_id`, `drift_score` and `confidence` rather than
 * stored, so re-weighting a rule reorders rows already on the page.
 */
function rank(r: Recommendation): number {
  if (!r.rule_id) return 0; // Pre-0036 and AI-written rows have no rule identity.
  return impactScore({
    ruleId: r.rule_id,
    drift: r.drift_score ?? 0,
    confidence: r.confidence ?? 0.5,
  });
}

/**
 * One slot on the page: either a theme holding several findings, or a single
 * finding that belongs to no group.
 */
type Unit =
  | { kind: 'theme'; key: string; theme: Theme; rows: Recommendation[]; score: number }
  | { kind: 'row'; key: string; row: Recommendation; score: number };

/**
 * Split the open list into what leads and what folds away.
 *
 * SURFACED_LIMIT NOW COUNTS SLOTS, NOT ROWS, and that is the point of grouping:
 * three endurance findings used to consume the entire headline and push
 * nutrition below the fold, which is what the old MAX_SURFACED_PER_FAMILY cap
 * was patching around. One theme card carrying all three costs one slot and
 * says the thing the three rows were separately circling.
 *
 * A theme ranks at its best member — a group is exactly as urgent as the worst
 * thing in it, and averaging would let two mild findings bury one severe one.
 */
function partitionOpen(open: Recommendation[]): { lead: Unit[]; rest: Recommendation[] } {
  const ranked = [...open].sort((a, b) => rank(b) - rank(a));
  const groups = groupByTheme(ranked);
  const grouped = new Set(groups.flatMap((g) => g.rows.map((r) => r.id)));

  const units: Unit[] = [
    ...groups.map((g) => ({
      kind: 'theme' as const,
      key: g.theme.key,
      theme: g.theme,
      rows: g.rows,
      score: Math.max(...g.rows.map(rank)),
    })),
    ...ranked
      .filter((r) => !grouped.has(r.id))
      .map((r) => ({ kind: 'row' as const, key: r.id, row: r, score: rank(r) })),
  ].sort((a, b) => b.score - a.score);

  const lead = units.slice(0, SURFACED_LIMIT);
  // Everything below the fold is flattened back to rows: a half-shown theme is
  // a headline that lies about what it contains.
  const rest = units
    .slice(SURFACED_LIMIT)
    .flatMap((u) => (u.kind === 'theme' ? u.rows : [u.row]));
  return { lead, rest };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const inkBtn =
  'hill-btn inline-flex min-h-11 items-center justify-center bg-fg px-3 text-sm uppercase tracking-wider text-bg transition-colors hover:bg-fg/85 disabled:opacity-40';
const ghostBtn =
  'hill-btn inline-flex min-h-11 items-center justify-center border border-border bg-surface px-3 text-sm uppercase tracking-wider text-fg transition-colors hover:border-fg';

/**
 * One bar per check-in, oldest on the left, height = drift. A day the rule did
 * not fire is drawn in the elevated tone, so the coach staying quiet reads as
 * quiet rather than as a short bar. Monochrome: this is chrome around data, and
 * the direction is carried by TrajectoryTag, which also says it in words.
 */
function TrajectoryBars({ series }: { series: readonly Reading[] }) {
  const tail = series.slice(-TRAJECTORY_POINTS);
  const label = `Drift at the last ${tail.length} check-ins: ${tail
    .map((r) => `${Math.round(r.drift * 100)}%`)
    .join(', ')}`;
  return (
    <div
      role="img"
      aria-label={label}
      className="grid h-7 items-end gap-1"
      style={{ gridTemplateColumns: `repeat(${TRAJECTORY_POINTS}, minmax(0, 1fr))` }}
    >
      {Array.from({ length: TRAJECTORY_POINTS - tail.length }, (_, i) => (
        <span key={`pad-${i}`} />
      ))}
      {tail.map((r) => (
        <span
          key={r.observedOn}
          className={r.fired ? 'bg-fg' : 'bg-elevated'}
          style={{ height: `${Math.max(8, Math.round(r.drift * 100))}%` }}
        />
      ))}
    </div>
  );
}

/** Direction in words AND an arrow, so it survives without colour. The hue is
 *  the delta tokens' meaning (worse / better), not decoration. */
const TRAJECTORY_TAG: Record<TrajectoryLabel, { text: string; tone: string }> = {
  'came-back': { text: '↑ Came back', tone: 'text-down' },
  persisting: { text: '→ Persisting', tone: 'text-subtle' },
  improving: { text: '↓ Improving', tone: 'text-up' },
  resolving: { text: '↓ Clearing', tone: 'text-up' },
  new: { text: 'New', tone: 'text-fg' },
};

function TrajectoryTag({ series }: { series: readonly Reading[] }) {
  const label = trajectoryLabel(series);
  if (!label) return null;
  const t = TRAJECTORY_TAG[label];
  return (
    <span className={`shrink-0 text-[0.6rem] font-semibold uppercase tracking-wider ${t.tone}`}>
      {t.text}
    </span>
  );
}

/** What the last check-in changed, kept on the page instead of in a toast. */
function CheckinStrip({ delta }: { delta: CheckinDelta }) {
  const cells: [number, string][] = [
    [delta.fresh, 'New'],
    [delta.still, 'Still there'],
    [delta.cleared, 'Cleared'],
  ];
  return (
    <div>
      <div className="grid grid-cols-3 border border-border bg-surface">
        {cells.map(([n, label], i) => (
          <div key={label} className={`px-3 py-2 ${i > 0 ? 'border-l border-border-soft' : ''}`}>
            <div className="font-display text-xl tabular-nums text-fg">{n}</div>
            <div className="text-[0.6rem] uppercase tracking-[0.2em] text-muted">{label}</div>
          </div>
        ))}
      </div>
      <p className="mt-1 text-[0.6rem] uppercase tracking-[0.2em] text-muted">
        Last check-in · {formatDate(delta.on)}
      </p>
    </div>
  );
}

/** `recommendations.evidence` is untyped JSON; rows written before 0036, or by
 *  the AI edge function, carry none. */
function asEvidence(e: unknown): EvidencePayload | null {
  if (!e || typeof e !== 'object') return null;
  const v = e as Partial<EvidencePayload>;
  return Array.isArray(v.claims) && v.observed != null && typeof v.observed === 'object'
    ? (v as EvidencePayload)
    : null;
}

const humanize = (key: string) =>
  key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_.]/g, ' ')
    .toLowerCase();

const formatObserved = (v: number | string | null) =>
  v == null ? '—' : typeof v === 'number' ? String(Math.round(v * 100) / 100) : v;

/**
 * The finding's receipts: the numbers the rule measured, how much data they
 * rest on, and each cited claim with its verbatim quote. This is what makes a
 * deterministic finding different from advice, and it used to be invisible —
 * the sheet showed a drift percentage and nothing it was a percentage of.
 */
function EvidenceBlock({ evidence, sessions }: { evidence: EvidencePayload; sessions: number | null }) {
  const observed = Object.entries(evidence.observed);
  return (
    <section className="mt-5">
      <div className="text-[0.6rem] uppercase tracking-[0.3em] text-subtle">What was measured</div>
      {observed.length > 0 ? (
        <dl className="mt-2 border border-border">
          {observed.map(([k, v]) => (
            <div
              key={k}
              className="flex items-baseline justify-between gap-3 border-t border-border-soft px-3 py-2 first:border-t-0"
            >
              <dt className="text-sm text-muted">{humanize(k)}</dt>
              <dd className="text-sm tabular-nums text-fg">{formatObserved(v)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <p className="mt-2 text-xs text-muted">
        {sessions != null ? `${sessions} sessions in the window · ` : ''}
        {evidence.sufficiency === 'partial' ? 'Thin data — read with care' : 'Enough data'} · pack{' '}
        {evidence.packVersion}
      </p>
      {evidence.claims.map((c) => (
        <div key={c.id} className="mt-2">
          <Disclosure title={`Rests on · ${c.speaker}`}>
            <p className="text-sm text-fg">{c.statement}</p>
            <blockquote className="mt-2 bg-bg px-3 py-2 text-sm text-subtle">“{c.quote}”</blockquote>
            {c.caveat ? <p className="mt-2 text-xs text-muted">Caveat: {c.caveat}</p> : null}
            {c.url ? (
              <a
                href={c.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex min-h-11 items-center text-xs uppercase tracking-wider text-subtle underline"
              >
                {c.work}
              </a>
            ) : (
              <p className="mt-2 text-xs uppercase tracking-wider text-subtle">{c.work}</p>
            )}
          </Disclosure>
        </div>
      ))}
    </section>
  );
}

function RecRow({
  rec,
  onClick,
  snoozed,
  muted,
  noted,
  series,
}: {
  rec: Recommendation;
  onClick: () => void;
  snoozed?: boolean;
  muted?: boolean;
  /** An athlete note the weekly routine has not read yet. */
  noted?: boolean;
  /** The rule's readings, when the row should show its trajectory. */
  series?: readonly Reading[];
}) {
  const aging = rec.status === 'open' && Date.now() - Date.parse(rec.created_at) > 14 * 86_400_000;
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={`hill-btn flex w-full flex-wrap items-start justify-between gap-3 border border-border bg-surface p-4 text-left transition-colors hover:border-fg ${
          muted ? 'opacity-60' : ''
        }`}
      >
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-fg">{rec.tldr}</div>
          {rec.action ? <div className="mt-0.5 text-xs text-muted">{rec.action}</div> : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1 text-[0.6rem] uppercase tracking-wider text-muted">
          {aging ? <span className="text-fg">Aging</span> : null}
          {noted ? <span>Noted</span> : null}
          {snoozed && rec.snooze_until ? <span>till {formatDate(rec.snooze_until.slice(0, 10))}</span> : null}
          {rec.status === 'acted' && rec.disposition ? (
            <span>{rec.disposition.replace(/_/g, ' ')}</span>
          ) : null}
          {rec.status === 'dismissed' ? <span>dismissed</span> : null}
          {series && series.length > 0 ? <TrajectoryTag series={series} /> : null}
        </div>
        {series && series.length > 0 ? (
          <div className="w-full">
            <TrajectoryBars series={series} />
          </div>
        ) : null}
      </button>
    </li>
  );
}

/**
 * The model's synthesis, above the findings and visibly NOT one of them.
 *
 * The label is not decoration. A brief and a finding are both prose on a page,
 * and the only thing separating a sourced claim from an inference is whether
 * the page says so — so the author and the age are rendered every time, not
 * only once the brief is old. Nothing in src/lib/coach/** reads this row; it
 * changes what the page says and not one finding.
 */
function BriefCard({ brief, onClick }: { brief: CoachBrief; onClick: () => void }) {
  const age = briefAgeDays(brief);
  return (
    <button
      type="button"
      onClick={onClick}
      className="lift block w-full border border-border bg-surface p-4 text-left transition-colors hover:border-fg"
    >
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="text-[0.6rem] uppercase tracking-[0.3em] text-subtle">Observation</span>
        <span className="shrink-0 text-[0.6rem] uppercase tracking-wider text-muted">
          {brief.author} · {age === 0 ? 'today' : `${age}d ago`}
        </span>
      </div>
      <div className="mb-1 font-display text-sm uppercase tracking-[0.04em] text-fg">
        {brief.headline}
      </div>
      <p className="whitespace-pre-line text-sm text-muted">{brief.body_md}</p>
      {brief.window_start && brief.window_end ? (
        <div className="mt-2 text-[0.6rem] uppercase tracking-wider text-faint">
          {brief.window_start} → {brief.window_end}
        </div>
      ) : null}
    </button>
  );
}

/** A brief the athlete has snoozed or answered, listed beside the findings in
 *  the same state so it is one tap from being reopened rather than gone. */
function BriefRow({ brief, onClick }: { brief: CoachBrief; onClick: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="hill-btn flex w-full items-start justify-between gap-3 border border-border bg-surface p-4 text-left opacity-60 transition-colors hover:border-fg"
      >
        <div>
          <div className="text-[0.6rem] uppercase tracking-[0.3em] text-subtle">
            Observation · {brief.author}
          </div>
          <div className="mt-0.5 text-sm font-medium text-fg">{brief.headline}</div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1 text-[0.6rem] uppercase tracking-wider text-muted">
          {brief.status === 'snoozed' && brief.snooze_until ? (
            <span>till {formatDate(brief.snooze_until.slice(0, 10))}</span>
          ) : null}
          {brief.status === 'acted' && brief.disposition ? (
            <span>{brief.disposition.replace(/_/g, ' ')}</span>
          ) : null}
        </div>
      </button>
    </li>
  );
}

/**
 * How far back the page looks, in whole weeks. The slider's top stop is "All":
 * the range is sized to the oldest row, so the last week already includes it.
 */
function WeeksFilter({
  weeks,
  max,
  onChange,
}: {
  weeks: number;
  max: number;
  onChange: (w: number) => void;
}) {
  return (
    <label className="flex min-h-11 items-center gap-3">
      <span className="shrink-0 text-[0.6rem] uppercase tracking-[0.3em] text-subtle">Created</span>
      <input
        type="range"
        min={1}
        max={max}
        step={1}
        value={weeks}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label="Show suggestions created within this many weeks"
        className="h-1 flex-1 accent-fg"
      />
      <span className="w-20 shrink-0 text-right text-[0.65rem] uppercase tracking-wider tabular-nums text-muted">
        {weeks >= max ? 'All' : `Last ${weeks} wk`}
      </span>
    </label>
  );
}

/**
 * Several findings that are one story.
 *
 * A hairline container with the theme's headline and a one-line blurb, then the
 * member rows divided by `--color-border-soft` — the ListCard distinction:
 * `--color-border` outlines the card, the soft weight divides rows inside it.
 * No shadow and no transform; the rows inside stay flat, which is the default
 * rather than the exception (CLAUDE.md, "Depth is retired").
 */
function ThemeCard({
  theme,
  rows,
  onOpen,
  noted,
  series,
}: {
  theme: Theme;
  rows: Recommendation[];
  onOpen: (r: Recommendation) => void;
  noted: Set<string>;
  /** The members' readings merged per check-in at the worst member. */
  series: readonly Reading[];
}) {
  return (
    <li className="lift overflow-hidden border border-border bg-surface">
      <div className="border-b border-border-soft px-4 py-3">
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-display text-sm uppercase tracking-[0.04em] text-fg">
            {theme.title}
          </span>
          {series.length > 0 ? (
            <TrajectoryTag series={series} />
          ) : (
            <span className="shrink-0 text-[0.6rem] uppercase tracking-wider text-muted">
              {rows.length} findings
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-muted">{theme.blurb}</p>
        {series.length > 0 ? (
          <div className="mt-3">
            <TrajectoryBars series={series} />
          </div>
        ) : null}
      </div>
      <ul>
        {rows.map((r) => (
          <li key={r.id} className="border-t border-border-soft first:border-t-0">
            <button
              type="button"
              onClick={() => onOpen(r)}
              className="flex min-h-11 w-full items-start justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-bg"
            >
              <span className="text-sm font-medium text-fg">{r.tldr}</span>
              <span className="shrink-0 text-[0.6rem] uppercase tracking-wider text-muted">
                {noted.has(r.id) ? 'Noted · ' : ''}
                {r.drift_score != null ? `${Math.round(r.drift_score * 100)}%` : ''}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </li>
  );
}

export default function CoachView() {
  const [ready, setReady] = useState(false);
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [active, setActive] = useState<Recommendation | null>(null);
  const [note, setNote] = useState('');
  const [briefs, setBriefs] = useState<CoachBrief[]>([]);
  const [ruleNotes, setRuleNotes] = useState<CoachRuleNote[]>([]);
  const [athleteNotes, setAthleteNotes] = useState<CoachAthleteNote[]>([]);
  // The trajectory memory (0042), read on open so the page can draw where each
  // finding has been — previously it was only loaded inside a check-in.
  const [observations, setObservations] = useState<CoachObservation[]>([]);
  const [noting, setNoting] = useState(false);
  const [activeBrief, setActiveBrief] = useState<CoachBrief | null>(null);
  // Null = no filter. Kept apart from the slider position so the default stays
  // "everything" as older rows arrive and the range grows.
  const [weeks, setWeeks] = useState<number | null>(null);

  // Opening Coach is what stops Home's tab runner (lib/coachSignal.ts). Re-stamped
  // whenever the list changes, so findings a check-in mints while you are here
  // count as seen rather than greeting you on the way back to Home.
  useEffect(() => {
    if (ready) setCoachSeenAt(Date.now());
  }, [ready, recs]);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) {
        window.location.href = '/login';
        return;
      }
      const [rows, briefRows, noteRows, athleteRows, obsRows] = await Promise.all([
        getRecommendations(),
        getCoachBriefs(),
        getCoachRuleNotes(),
        getCoachAthleteNotes(),
        getCoachObservations(),
      ]);
      setRecs(rows);
      setBriefs(briefRows);
      setRuleNotes(noteRows);
      setAthleteNotes(athleteRows);
      setObservations(obsRows);
      setReady(true);
    });
  }, []);

  /**
   * Check-in: run the deterministic engine over the athlete's own rows and
   * upsert what it finds.
   *
   * NO NETWORK CALL TO A MODEL. The `coach` edge function is still deployed and
   * still works, but it is deliberately not on this path any more: it returned
   * free-text advice that could not be reproduced, could not carry a citation,
   * and was fitness-only by its own system prompt. Everything here is computed
   * in the browser from rows RLS already scopes to this user, so the same data
   * always produces the same findings and each one can name the claim it rests
   * on. See src/lib/coach/knowledge.ts.
   *
   * Upsert, not insert: re-running in the same week refreshes the live row for a
   * rule instead of minting a duplicate, and anything the athlete has already
   * dismissed, acted on or snoozed is filtered out before we get here by the
   * cooldown in lib/coach/evaluate.ts.
   */
  async function analyze() {
    if (analyzing) return;
    setAnalyzing(true);
    try {
      const [plan, logs, meals, stats, movements, existing, observations] = await Promise.all([
        getActivePlan(),
        getRecentLogs(80),
        getMealLogs(200),
        getUserStats(),
        getMovements(),
        getRecommendations(),
        // The trajectory memory (migration 0042). Without it the engine falls
        // back to the drift frozen on each decided row, which is correct but
        // cannot tell a problem that improved from one that came back.
        getCoachObservations(),
      ]);
      // Per-user taxonomy corrections, keyed by normalised name — the same map
      // BodyView builds. Without it a movement the athlete has remapped would be
      // classified one way on the body map and another way here.
      const overrides: OverrideMap = {};
      for (const m of movements) {
        if (m.taxonomy) overrides[normalizeMovementName(m.name)] = m.taxonomy;
      }
      const { write, refreshed, findings, suppressed, observations: readings, resolved } =
        runCoach({
          logs,
          meals,
          stats,
          plan,
          overrides,
          existing,
          observations,
          // Governed here, once. runCoach does not re-validate: one enforcement
          // point or there are two places to tighten and one gets missed.
          edges: governEdges(ruleNotes),
        });
      if (write.length > 0 && !(await upsertCoachFindings(write))) {
        toast('Check-in failed — try again', 'error');
        return;
      }
      // Readings are written AFTER the findings and their failure is not fatal:
      // a check-in that produced advice has done its job even if the trajectory
      // row did not land. It is still reported, because a write path that
      // cannot report failure hides a schema fault indefinitely — see the
      // user_stats entry in docs/LESSONS.md.
      if (!(await upsertCoachObservations(readings))) {
        console.error('coach observations not saved; trajectory will have a gap');
      }
      const [freshRecs, freshObs] = await Promise.all([getRecommendations(), getCoachObservations()]);
      setRecs(freshRecs);
      setObservations(freshObs);
      // Say what actually happened. "Nothing new since last check-in" used to
      // cover four different situations, one of which was the engine being
      // gagged by its own cooldowns while the athlete kept training — so the
      // one message an athlete saw most was the one that told them least.
      const fresh = write.length - refreshed.length - resolved.length;
      const parts = [
        fresh > 0 ? `${fresh} new` : null,
        resolved.length > 0 ? `${resolved.length} cleared` : null,
        refreshed.length > 0 ? `${refreshed.length} updated` : null,
      ].filter(Boolean);
      if (parts.length > 0) {
        toast(parts.join(' · '), 'success');
      } else if (suppressed.some((s) => s.reason === 'improving')) {
        // Distinct from "nothing has moved" on purpose. It is the one sentence
        // an athlete mid-fix wants, and the two used to share a reason code.
        toast('Moving in the right direction — nothing to add', 'success');
      } else if (suppressed.some((s) => s.reason === 'no-new-training')) {
        toast('Log a few more sessions and I can re-check', 'success');
      } else if (suppressed.length > 0) {
        toast('Same picture as last time — nothing has moved', 'success');
      } else if (findings.length === 0) {
        toast('Nothing to flag — keep logging', 'success');
      }
    } finally {
      setAnalyzing(false);
    }
  }

  function closeDetail() {
    setActive(null);
    setActiveBrief(null);
    setNote('');
  }

  async function refresh() {
    setRecs(await getRecommendations());
  }

  async function decide(rec: Recommendation, disposition: RecDisposition) {
    await updateRecommendation(rec.id, {
      status: 'acted',
      disposition,
      disposition_note: note || null,
    });
    closeDetail();
    await refresh();
  }

  /**
   * "Noted": save the note for the weekly routine and keep the finding open.
   * Touches nothing on the recommendation row, so no cooldown starts and the
   * scorecard does not count it as decided.
   */
  async function addNote(rec: Recommendation) {
    if (noting || !note.trim()) return;
    setNoting(true);
    try {
      const row = await addCoachAthleteNote(rec, note);
      if (!row) {
        toast('Could not save note — try again', 'error');
        return;
      }
      setAthleteNotes((prev) => [row, ...prev]);
      setNote('');
      toast('Noted — the weekly review will read it', 'success');
    } finally {
      setNoting(false);
    }
  }

  /** Delete one of your own notes. Irreversible, so it asks, as removeBrief does. */
  async function removeNote(n: CoachAthleteNote) {
    if (!window.confirm('Delete this note? This cannot be undone.')) return;
    if (!(await deleteCoachAthleteNote(n.id))) {
      toast('Could not delete — try again', 'error');
      return;
    }
    setAthleteNotes((prev) => prev.filter((x) => x.id !== n.id));
  }

  async function dismiss(rec: Recommendation) {
    await updateRecommendation(rec.id, { status: 'dismissed' });
    closeDetail();
    await refresh();
  }

  async function snooze(rec: Recommendation, days: number) {
    await updateRecommendation(rec.id, {
      status: 'snoozed',
      snooze_until: new Date(Date.now() + days * 86_400_000).toISOString(),
    });
    closeDetail();
    await refresh();
  }

  /** Did it / Modified on a brief. Unlike a finding there is no "skipped" —
   *  a brief the athlete will not act on is deleted. */
  async function decideBrief(b: CoachBrief, disposition: 'acted_as_prescribed' | 'acted_modified') {
    if (
      !(await updateCoachBrief(b.id, {
        status: 'acted',
        disposition,
        disposition_note: note || null,
      }))
    ) {
      toast('Could not save — try again', 'error');
      return;
    }
    closeDetail();
    setBriefs(await getCoachBriefs());
  }

  async function snoozeBrief(b: CoachBrief, days: number) {
    if (
      !(await updateCoachBrief(b.id, {
        status: 'snoozed',
        snooze_until: new Date(Date.now() + days * 86_400_000).toISOString(),
      }))
    ) {
      toast('Could not save — try again', 'error');
      return;
    }
    closeDetail();
    setBriefs(await getCoachBriefs());
  }

  async function removeBrief(b: CoachBrief) {
    if (!window.confirm('Delete this observation? This cannot be undone.')) return;
    if (!(await deleteCoachBrief(b.id))) {
      toast('Could not delete — try again', 'error');
      return;
    }
    closeDetail();
    setBriefs(await getCoachBriefs());
  }

  if (!ready) return <LoadingScreen />;

  const now = Date.now();
  const brief = currentBrief(briefs);
  const contextNotes = governContextNotes(ruleNotes);
  // Open findings are never filtered by age: a live problem does not stop being
  // one because it was first raised a while ago, and the old created-at slider
  // hid exactly the aging findings that most needed seeing.
  const open = recs.filter((r) => isLiveRec(r, now));
  const { lead, rest } = partitionOpen(open);

  const byRule = readingsByRule(observations);
  const seriesOf = (r: Recommendation): Reading[] => (r.rule_id ? (byRule.get(r.rule_id) ?? []) : []);
  const delta = checkinDelta(observations);

  // History — snoozed and decided — is where the created-at filter lives now.
  const snoozedAll = recs.filter(
    (r) => r.status === 'snoozed' && r.snooze_until != null && Date.parse(r.snooze_until) > now,
  );
  const decidedAll = recs.filter((r) => r.status === 'acted' || r.status === 'dismissed');
  const snoozedBriefsAll = briefs.filter((b) => b.status === 'snoozed' && !isBriefLive(b));
  const decidedBriefsAll = briefs.filter((b) => b.status === 'acted');
  const historyCreated = [...snoozedAll, ...decidedAll, ...snoozedBriefsAll, ...decidedBriefsAll].map(
    (x) => Date.parse(x.created_at),
  );
  // Sized to the oldest history row so the top stop means "all".
  const oldest = Math.min(now, ...historyCreated);
  const maxWeeks = Math.max(1, Math.ceil((now - oldest) / (7 * 86_400_000)));
  const shownWeeks = weeks == null ? maxWeeks : Math.min(weeks, maxWeeks);
  const inWindow = (createdAt: string) =>
    shownWeeks >= maxWeeks || now - Date.parse(createdAt) <= shownWeeks * 7 * 86_400_000;
  const snoozed = snoozedAll.filter((r) => inWindow(r.created_at));
  const decided = decidedAll.filter((r) => inWindow(r.created_at));
  const snoozedBriefs = snoozedBriefsAll.filter((b) => inWindow(b.created_at));
  const decidedBriefs = decidedBriefsAll.filter((b) => inWindow(b.created_at));
  const snoozedCount = snoozedAll.length + snoozedBriefsAll.length;
  const decidedCount = decidedAll.length + decidedBriefsAll.length;
  // Findings carrying a note the routine has not read yet.
  const noted = new Set(
    athleteNotes
      .filter((n) => n.reviewed_at == null && n.recommendation_id)
      .map((n) => n.recommendation_id as string),
  );
  const activeNotes = active ? athleteNotes.filter((n) => n.recommendation_id === active.id) : [];
  const activeSeries = active ? seriesOf(active) : [];
  const activeEvidence = active ? asEvidence(active.evidence) : null;
  /** Sessions in the measurement window at the rule's newest reading. */
  const latestSessions = (ruleId: string | null): number | null => {
    const s = ruleId ? observations.filter((o) => o.rule_id === ruleId) : [];
    return s.length > 0 ? s[s.length - 1].sessions : null;
  };

  return (
    <>
      <PageStagger className="mx-auto max-w-3xl px-4 pb-10 pt-5 sm:px-6">
        <Item>
          <header className="mb-6">
            <div className="flex items-end justify-between gap-4">
              <EchoText
                text="COACH"
                as="h1"
                className={ECHO_APP_TITLE}
              />
              <button onClick={analyze} disabled={analyzing} className={`shrink-0 ${inkBtn}`}>
                {analyzing ? 'Checking in…' : 'Check-in'}
              </button>
            </div>
          </header>
        </Item>

        {delta ? (
          <Item>
            <div className="mb-8">
              <CheckinStrip delta={delta} />
            </div>
          </Item>
        ) : null}

        {brief ? (
          <Item>
            <section className="mb-8">
              <BriefCard brief={brief} onClick={() => setActiveBrief(brief)} />
            </section>
          </Item>
        ) : null}

        <Item>
          <section className="mb-10">
            <SectionHeader>Open</SectionHeader>
            {open.length === 0 ? (
              <EmptyState>Nothing open. Tap “Check-in” to scan recent sessions.</EmptyState>
            ) : (
              <>
                <ul className="flex flex-col gap-2">
                  {lead.map((u) =>
                    u.kind === 'theme' ? (
                      <ThemeCard
                        key={u.key}
                        theme={u.theme}
                        rows={u.rows}
                        onOpen={setActive}
                        noted={noted}
                        series={mergeSeries(u.rows.map(seriesOf))}
                      />
                    ) : (
                      <RecRow
                        key={u.key}
                        rec={u.row}
                        onClick={() => setActive(u.row)}
                        noted={noted.has(u.row.id)}
                        series={seriesOf(u.row)}
                      />
                    ),
                  )}
                </ul>
                {rest.length > 0 ? (
                  <div className="mt-2">
                    <Disclosure title={`${rest.length} more`}>
                      <ul className="flex flex-col gap-2 p-4 pt-0">
                        {rest.map((r) => (
                          <RecRow
                            key={r.id}
                            rec={r}
                            onClick={() => setActive(r)}
                            noted={noted.has(r.id)}
                            series={seriesOf(r)}
                          />
                        ))}
                      </ul>
                    </Disclosure>
                  </div>
                ) : null}
              </>
            )}
          </section>
        </Item>

        {snoozedCount + decidedCount > 0 ? (
          <Item>
            <section>
              <Disclosure
                title="History"
                headerRight={`${snoozedCount} snoozed · ${decidedCount} decided`}
              >
                <div className="flex flex-col gap-6">
                  <WeeksFilter weeks={shownWeeks} max={maxWeeks} onChange={(w) => setWeeks(w)} />
                  {snoozed.length + snoozedBriefs.length > 0 ? (
                    <div>
                      <SectionHeader>Snoozed</SectionHeader>
                      <ul className="flex flex-col gap-2">
                        {snoozedBriefs.map((b) => (
                          <BriefRow key={b.id} brief={b} onClick={() => setActiveBrief(b)} />
                        ))}
                        {snoozed.map((r) => (
                          <RecRow
                            key={r.id}
                            rec={r}
                            onClick={() => setActive(r)}
                            snoozed
                            noted={noted.has(r.id)}
                          />
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {decided.length + decidedBriefs.length > 0 ? (
                    <div>
                      <SectionHeader>Decided</SectionHeader>
                      <ul className="flex flex-col gap-2">
                        {decidedBriefs.map((b) => (
                          <BriefRow key={b.id} brief={b} onClick={() => setActiveBrief(b)} />
                        ))}
                        {decided.map((r) => (
                          <RecRow key={r.id} rec={r} onClick={() => setActive(r)} muted />
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {snoozed.length + snoozedBriefs.length + decided.length + decidedBriefs.length === 0 ? (
                    <EmptyState>Nothing from the last {shownWeeks} wk.</EmptyState>
                  ) : null}
                </div>
              </Disclosure>
            </section>
          </Item>
        ) : null}
      </PageStagger>

      <Modal open={active !== null} onClose={closeDetail} title="Finding">
        {active ? (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <div className="mb-1 font-display text-lg uppercase leading-tight text-fg">{active.tldr}</div>
              {active.action ? <div className="mb-3 text-sm text-subtle">{active.action}</div> : null}
              {active.body_md ? (
                <p className="whitespace-pre-line text-sm text-muted">{active.body_md}</p>
              ) : null}
              {activeSeries.length > 0 ? (
                <div className="mt-4">
                  <div className="mb-2 flex items-baseline justify-between gap-3">
                    <span className="text-[0.6rem] uppercase tracking-[0.3em] text-subtle">
                      Last {Math.min(activeSeries.length, TRAJECTORY_POINTS)} check-ins
                    </span>
                    <TrajectoryTag series={activeSeries} />
                  </div>
                  <TrajectoryBars series={activeSeries} />
                </div>
              ) : null}
              {activeEvidence ? (
                <EvidenceBlock
                  evidence={activeEvidence}
                  sessions={activeSeries.length > 0 ? latestSessions(active.rule_id) : null}
                />
              ) : null}
              {active.rule_id && contextNotes.has(active.rule_id) ? (
                <div className="mt-3 border-l-2 border-border-soft pl-3">
                  <div className="text-[0.6rem] uppercase tracking-[0.3em] text-subtle">
                    Context · {contextNotes.get(active.rule_id)!.note.author}
                  </div>
                  <p className="mt-1 text-sm text-subtle">
                    {contextNotes.get(active.rule_id)!.text}
                  </p>
                </div>
              ) : null}
              <div className="mt-4 flex gap-4 text-[0.65rem] uppercase tracking-wider text-muted">
                {active.drift_score != null ? <span>Drift {Math.round(active.drift_score * 100)}%</span> : null}
                {active.confidence != null ? (
                  <span>Confidence {Math.round(active.confidence * 100)}%</span>
                ) : null}
              </div>
              {active.status === 'acted' || active.status === 'dismissed' ? (
                <div className="mt-4 text-sm text-subtle">
                  {active.status === 'dismissed'
                    ? 'Dismissed.'
                    : `Marked: ${active.disposition?.replace(/_/g, ' ')}`}
                  {active.disposition_note ? ` · ${active.disposition_note}` : ''}
                </div>
              ) : (
                <>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Note — context for the coach, you don't have to decide yet"
                    aria-label="Note"
                    rows={2}
                    className="mt-4 w-full border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-subtle"
                  />
                  <div className="mt-2 flex justify-end">
                    <button
                      onClick={() => addNote(active)}
                      disabled={noting || !note.trim()}
                      className={ghostBtn}
                    >
                      {noting ? 'Saving…' : 'Noted · keep open'}
                    </button>
                  </div>
                </>
              )}
              {activeNotes.length > 0 ? (
                <div className="mt-4">
                  <div className="text-[0.6rem] uppercase tracking-[0.3em] text-subtle">
                    Notes for weekly review
                  </div>
                  <ul className="mt-2 border border-border">
                    {activeNotes.map((n) => (
                      <li
                        key={n.id}
                        className="flex items-start gap-2 border-t border-border-soft py-2 pl-3 first:border-t-0"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="whitespace-pre-line text-sm text-fg">{n.body}</p>
                          <div className="mt-1 text-[0.65rem] uppercase tracking-wider text-muted">
                            {formatDate(n.created_at.slice(0, 10))} ·{' '}
                            {n.reviewed_at
                              ? `Read ${formatDate(n.reviewed_at.slice(0, 10))}${
                                  // An id points at a brief or rule note; only prose is worth showing.
                                  n.review_ref && !UUID.test(n.review_ref) ? ` · ${n.review_ref}` : ''
                                }`
                              : 'Waiting for weekly review'}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeNote(n)}
                          className="-my-1 inline-flex min-h-11 shrink-0 items-center px-3 text-[0.65rem] uppercase tracking-wider text-muted hover:text-fg"
                        >
                          Delete
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <DeepEnrichment recId={active.id} />
            </div>
            {active.status === 'acted' || active.status === 'dismissed' ? null : (
              <div className="flex flex-col gap-2 border-t border-border p-4">
                <div className="flex gap-2">
                  <button onClick={() => decide(active, 'acted_as_prescribed')} className={`flex-1 ${inkBtn}`}>
                    Did it
                  </button>
                  <button onClick={() => decide(active, 'acted_modified')} className={`flex-1 ${ghostBtn}`}>
                    Modified
                  </button>
                  <button onClick={() => decide(active, 'skipped')} className={`flex-1 ${ghostBtn}`}>
                    Skipped
                  </button>
                </div>
                <div className="text-[0.6rem] uppercase tracking-[0.2em] text-muted">Ask again in</div>
                <div className="flex gap-2">
                  {[1, 3, 7].map((d) => (
                    <button
                      key={d}
                      onClick={() => snooze(active, d)}
                      aria-label={`Snooze ${d} days`}
                      className={`flex-1 ${ghostBtn}`}
                    >
                      {d}d
                    </button>
                  ))}
                  <button onClick={() => dismiss(active)} className={`flex-1 ${ghostBtn}`}>
                    Dismiss
                  </button>
                </div>
              </div>
            )}
          </>
        ) : null}
      </Modal>

      <Modal open={activeBrief !== null} onClose={closeDetail} title="Observation">
        {activeBrief ? (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <div className="mb-1 text-[0.6rem] uppercase tracking-[0.3em] text-subtle">
                {activeBrief.author} · {formatDate(activeBrief.created_at.slice(0, 10))}
              </div>
              <div className="mb-2 font-display text-lg text-fg">{activeBrief.headline}</div>
              <p className="whitespace-pre-line text-sm text-muted">{activeBrief.body_md}</p>
              {activeBrief.status === 'acted' ? (
                <div className="mt-4 text-sm text-subtle">
                  Marked: {activeBrief.disposition?.replace(/_/g, ' ')}
                  {activeBrief.disposition_note ? ` · ${activeBrief.disposition_note}` : ''}
                </div>
              ) : (
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Note (optional)"
                  rows={2}
                  className="mt-4 w-full border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-subtle"
                />
              )}
            </div>
            <div className="flex flex-col gap-2 border-t border-border p-4">
              <div className="flex gap-2">
                {activeBrief.status === 'acted' ? null : (
                  <>
                    <button
                      onClick={() => decideBrief(activeBrief, 'acted_as_prescribed')}
                      className={`flex-1 ${inkBtn}`}
                    >
                      Did it
                    </button>
                    <button
                      onClick={() => decideBrief(activeBrief, 'acted_modified')}
                      className={`flex-1 ${ghostBtn}`}
                    >
                      Modified
                    </button>
                  </>
                )}
                <button onClick={() => removeBrief(activeBrief)} className={`flex-1 ${ghostBtn}`}>
                  Delete
                </button>
              </div>
              {activeBrief.status === 'acted' ? null : (
                <div className="flex gap-2">
                  {[1, 3, 7].map((d) => (
                    <button key={d} onClick={() => snoozeBrief(activeBrief, d)} className={`flex-1 ${ghostBtn}`}>
                      Snooze {d}d
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : null}
      </Modal>
    </>
  );
}
