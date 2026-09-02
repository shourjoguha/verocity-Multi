import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  getActivePlan,
  getMealLogs,
  getMovements,
  getRecentLogs,
  getRecommendations,
  getUserStats,
  updateRecommendation,
  upsertCoachFindings,
} from '@/lib/queries';
import { family, runCoach } from '@/lib/coach/evaluate';
import { impactScore } from '@/lib/coach/impact';
import { normalizeMovementName, type OverrideMap } from '@/lib/movementTaxonomy';
import type { Recommendation, RecDisposition } from '@/lib/types';
import { formatDate } from '@/lib/format';
import { toast } from '@/lib/toast';
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

/** And at most this many of the leading rows from one family, so the loudest
 *  family (training — most numerous, best measured) cannot take the whole
 *  headline and leave nutrition and goals unseen below the fold. */
const MAX_SURFACED_PER_FAMILY = 2;

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

/** Split the open list into what leads and what folds away. */
function partitionOpen(open: Recommendation[]): { lead: Recommendation[]; rest: Recommendation[] } {
  const ranked = [...open].sort((a, b) => rank(b) - rank(a));
  const perFamily = new Map<string, number>();
  const lead: Recommendation[] = [];
  const rest: Recommendation[] = [];
  for (const r of ranked) {
    const fam = r.rule_id ? family(r.rule_id) : '';
    if (lead.length < SURFACED_LIMIT && (perFamily.get(fam) ?? 0) < MAX_SURFACED_PER_FAMILY) {
      perFamily.set(fam, (perFamily.get(fam) ?? 0) + 1);
      lead.push(r);
    } else {
      rest.push(r);
    }
  }
  // The family cap must never leave the headline short while rows wait below.
  while (lead.length < SURFACED_LIMIT && rest.length > 0) lead.push(rest.shift()!);
  return { lead, rest };
}

const inkBtn =
  'hill-btn inline-flex min-h-11 items-center justify-center bg-fg px-3 text-sm uppercase tracking-wider text-bg transition-colors hover:bg-fg/85 disabled:opacity-40';
const ghostBtn =
  'hill-btn inline-flex min-h-11 items-center justify-center border border-border bg-surface px-3 text-sm uppercase tracking-wider text-fg transition-colors hover:border-fg';

function RecRow({
  rec,
  onClick,
  snoozed,
  muted,
}: {
  rec: Recommendation;
  onClick: () => void;
  snoozed?: boolean;
  muted?: boolean;
}) {
  const aging = rec.status === 'open' && Date.now() - Date.parse(rec.created_at) > 14 * 86_400_000;
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={`hill-btn flex w-full items-start justify-between gap-3 border border-border bg-surface p-4 text-left transition-colors hover:border-fg ${
          muted ? 'opacity-60' : ''
        }`}
      >
        <div>
          <div className="text-sm font-medium text-fg">{rec.tldr}</div>
          {rec.action ? <div className="mt-0.5 text-xs text-muted">{rec.action}</div> : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1 text-[0.6rem] uppercase tracking-wider text-muted">
          {aging ? <span className="text-fg">Aging</span> : null}
          {snoozed && rec.snooze_until ? <span>till {formatDate(rec.snooze_until.slice(0, 10))}</span> : null}
          {rec.status === 'acted' && rec.disposition ? (
            <span>{rec.disposition.replace(/_/g, ' ')}</span>
          ) : null}
          {rec.status === 'dismissed' ? <span>dismissed</span> : null}
        </div>
      </button>
    </li>
  );
}

export default function CoachView() {
  const [ready, setReady] = useState(false);
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [active, setActive] = useState<Recommendation | null>(null);
  const [note, setNote] = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) {
        window.location.href = '/login';
        return;
      }
      setRecs(await getRecommendations());
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
      const [plan, logs, meals, stats, movements, existing] = await Promise.all([
        getActivePlan(),
        getRecentLogs(80),
        getMealLogs(200),
        getUserStats(),
        getMovements(),
        getRecommendations(),
      ]);
      // Per-user taxonomy corrections, keyed by normalised name — the same map
      // BodyView builds. Without it a movement the athlete has remapped would be
      // classified one way on the body map and another way here.
      const overrides: OverrideMap = {};
      for (const m of movements) {
        if (m.taxonomy) overrides[normalizeMovementName(m.name)] = m.taxonomy;
      }
      const { write, refreshed, findings, suppressed } = runCoach({
        logs,
        meals,
        stats,
        plan,
        overrides,
        existing,
      });
      if (write.length > 0 && !(await upsertCoachFindings(write))) {
        toast('Check-in failed — try again', 'error');
        return;
      }
      setRecs(await getRecommendations());
      // Say what actually happened. "Nothing new since last check-in" used to
      // cover four different situations, one of which was the engine being
      // gagged by its own cooldowns while the athlete kept training — so the
      // one message an athlete saw most was the one that told them least.
      const fresh = write.length - refreshed.length;
      if (fresh > 0) {
        toast(
          refreshed.length > 0 ? `${fresh} new · ${refreshed.length} updated` : `${fresh} new`,
          'success',
        );
      } else if (refreshed.length > 0) {
        toast(`${refreshed.length} updated with this week's numbers`, 'success');
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

  if (!ready) return <LoadingScreen />;

  const now = Date.now();
  const isLive = (r: Recommendation) =>
    r.status === 'open' || (r.status === 'snoozed' && r.snooze_until != null && Date.parse(r.snooze_until) <= now);
  const open = recs.filter(isLive);
  const { lead, rest } = partitionOpen(open);
  const snoozed = recs.filter(
    (r) => r.status === 'snoozed' && r.snooze_until != null && Date.parse(r.snooze_until) > now,
  );
  const decided = recs.filter((r) => r.status === 'acted' || r.status === 'dismissed');

  return (
    <>
      <PageStagger className="mx-auto max-w-3xl px-4 pb-10 pt-5 sm:px-6">
        <Item>
          <header className="mb-8">
            <p className="text-[0.7rem] uppercase tracking-[0.35em] text-muted">Coach</p>
            <div className="mt-2 flex items-end justify-between gap-4">
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

        <Item>
          <section className="mb-10">
            <SectionHeader>Open</SectionHeader>
            {open.length === 0 ? (
              <EmptyState>Nothing open. Tap “Check-in” to scan recent sessions.</EmptyState>
            ) : (
              <>
                <ul className="flex flex-col gap-2">
                  {lead.map((r) => (
                    <RecRow key={r.id} rec={r} onClick={() => setActive(r)} />
                  ))}
                </ul>
                {rest.length > 0 ? (
                  <div className="mt-2">
                    <Disclosure title={`${rest.length} more`}>
                      <ul className="flex flex-col gap-2 p-4 pt-0">
                        {rest.map((r) => (
                          <RecRow key={r.id} rec={r} onClick={() => setActive(r)} />
                        ))}
                      </ul>
                    </Disclosure>
                  </div>
                ) : null}
              </>
            )}
          </section>
        </Item>

        {snoozed.length > 0 ? (
          <Item>
            <section className="mb-10">
              <SectionHeader>Snoozed</SectionHeader>
              <ul className="flex flex-col gap-2">
                {snoozed.map((r) => (
                  <RecRow key={r.id} rec={r} onClick={() => setActive(r)} snoozed />
                ))}
              </ul>
            </section>
          </Item>
        ) : null}

        {decided.length > 0 ? (
          <Item>
            <section>
              <SectionHeader>Decided</SectionHeader>
              <ul className="flex flex-col gap-2">
                {decided.map((r) => (
                  <RecRow key={r.id} rec={r} onClick={() => setActive(r)} muted />
                ))}
              </ul>
            </section>
          </Item>
        ) : null}
      </PageStagger>

      <Modal open={active !== null} onClose={closeDetail} title="Recommendation">
        {active ? (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <div className="mb-1 font-display text-lg font-semibold text-fg">{active.tldr}</div>
              {active.action ? <div className="mb-3 text-sm text-subtle">{active.action}</div> : null}
              {active.body_md ? (
                <p className="whitespace-pre-line text-sm text-muted">{active.body_md}</p>
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
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Note (optional)"
                  rows={2}
                  className="mt-4 w-full border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-subtle"
                />
              )}
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
                <div className="flex gap-2">
                  {[1, 3, 7].map((d) => (
                    <button key={d} onClick={() => snooze(active, d)} className={`flex-1 ${ghostBtn}`}>
                      Snooze {d}d
                    </button>
                  ))}
                  <button onClick={() => dismiss(active)} className={ghostBtn}>
                    Dismiss
                  </button>
                </div>
              </div>
            )}
          </>
        ) : null}
      </Modal>
    </>
  );
}
