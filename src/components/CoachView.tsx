import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  getActivePlan,
  getRecentLogs,
  getRecommendations,
  insertRecommendations,
  updateRecommendation,
} from '@/lib/queries';
import { generateRecommendations } from '@/lib/coach';
import type { Recommendation, RecDisposition } from '@/lib/types';
import { formatDate } from '@/lib/format';
import { toast } from '@/lib/toast';
import { EmptyState, SectionHeader } from '@/components/ui/primitives';
import { EchoText } from '@/components/EchoText';
import { Item, PageStagger } from '@/components/anim';
import { Modal } from '@/components/ui/Modal';

const inkBtn =
  'inline-flex min-h-11 items-center justify-center bg-fg px-3 text-sm uppercase tracking-wider text-bg transition-colors hover:bg-fg/85 disabled:opacity-40';
const ghostBtn =
  'inline-flex min-h-11 items-center justify-center border border-border px-3 text-sm uppercase tracking-wider text-fg transition-colors hover:border-fg';

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
        className={`flex w-full items-start justify-between gap-3 border border-border bg-surface p-4 text-left transition-colors hover:border-fg ${
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

  async function analyze() {
    if (analyzing) return;
    setAnalyzing(true);
    try {
      const [plan, logs] = await Promise.all([getActivePlan(), getRecentLogs(50)]);
      const generated = generateRecommendations(logs, plan);
      const ok = await insertRecommendations(generated);
      if (!ok) {
        toast('Analysis failed — try again', 'error');
        return;
      }
      setRecs(await getRecommendations());
      toast(`${generated.length} new ${generated.length === 1 ? 'insight' : 'insights'}`, 'success');
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

  if (!ready) return <div className="px-6 py-16 text-sm text-muted">Loading…</div>;

  const now = Date.now();
  const isLive = (r: Recommendation) =>
    r.status === 'open' || (r.status === 'snoozed' && r.snooze_until != null && Date.parse(r.snooze_until) <= now);
  const open = recs.filter(isLive);
  const snoozed = recs.filter(
    (r) => r.status === 'snoozed' && r.snooze_until != null && Date.parse(r.snooze_until) > now,
  );
  const decided = recs.filter((r) => r.status === 'acted' || r.status === 'dismissed');

  return (
    <>
      <PageStagger className="mx-auto max-w-3xl px-6 py-10">
        <Item>
          <header className="mb-8">
            <p className="text-[0.7rem] uppercase tracking-[0.35em] text-muted">Coach</p>
            <div className="mt-2 flex items-end justify-between gap-4">
              <EchoText
                text="COACH"
                as="h1"
                className="font-display text-5xl font-bold uppercase leading-[0.9] tracking-[-0.04em] text-fg md:text-7xl"
              />
              <button onClick={analyze} disabled={analyzing} className={`shrink-0 ${inkBtn}`}>
                {analyzing ? 'Analyzing…' : 'Analyze my training'}
              </button>
            </div>
          </header>
        </Item>

        <Item>
          <section className="mb-10">
            <SectionHeader>Open</SectionHeader>
            {open.length === 0 ? (
              <EmptyState>Nothing open. Tap “Analyze my training” to scan recent sessions.</EmptyState>
            ) : (
              <ul className="flex flex-col gap-2">
                {open.map((r) => (
                  <RecRow key={r.id} rec={r} onClick={() => setActive(r)} />
                ))}
              </ul>
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
