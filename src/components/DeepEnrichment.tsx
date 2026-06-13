import { useEffect, useState } from 'react';
import { getDeepResults } from '@/lib/queries';
import type { RxDeepResult } from '@/lib/types';

/**
 * Surfaces rx deep enrichment (retrieval-depth cross-door porting) for a
 * recommendation, inside the Coach detail modal. Three kinds:
 *   - deep_retrieval  : the filter-late curated candidate set + judgment notes
 *   - contradiction   : a "sources conflict" banner — shown ONLY when the
 *                       deterministic governor raised it (alarm-fatigue guard)
 *   - disconfirmation : an off-vault counter, labelled with its GOVERNED
 *                       credibility (web-surface-bias guard)
 *
 * Rows are written out-of-band by a Claude Code session; the trust decisions
 * live in `payload.governor`. This component only renders them — it never
 * re-judges. Payloads are LLM-authored, so every field access is defensive.
 */

type Dict = Record<string, unknown>;

function asDict(v: unknown): Dict {
  return v && typeof v === 'object' ? (v as Dict) : {};
}
function asArr(v: unknown): Dict[] {
  return Array.isArray(v) ? (v as Dict[]) : [];
}
function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null;
}

const chip =
  'inline-flex items-center gap-1 border border-border px-1.5 py-0.5 text-[0.55rem] uppercase tracking-wider text-muted';

function DeepRetrieval({ payload }: { payload: Dict }) {
  const curated = asArr(payload.curated);
  const notes = str(payload.judgment_notes);
  const hops = payload.hops_used;
  const rescued = asArr(payload.rescued);
  if (curated.length === 0 && !notes) return null;
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[0.6rem] uppercase tracking-[0.3em] text-subtle">Deep retrieval</span>
        {typeof hops === 'number' ? <span className={chip}>{hops} hops</span> : null}
        {rescued.length > 0 ? <span className={chip}>{rescued.length} rescued</span> : null}
      </div>
      {notes ? <p className="mb-2 whitespace-pre-line text-xs text-muted">{notes}</p> : null}
      <ul className="flex flex-col gap-1">
        {curated.slice(0, 12).map((c, i) => (
          <li key={i} className="flex items-start justify-between gap-2 border border-border bg-bg px-2 py-1.5">
            <span className="text-xs text-fg">{str(c.path) ?? str(c.title) ?? 'source'}</span>
            <span className="flex shrink-0 gap-1">
              {typeof c.hop === 'number' ? <span className={chip}>hop {c.hop}</span> : null}
              {str(c.why_kept) ? <span className={chip}>{str(c.why_kept)}</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Contradiction({ payload }: { payload: Dict }) {
  const gov = asDict(payload.governor);
  const raise = gov.raise_banner === true;
  const severity = str(gov.severity) ?? 'none';
  const sources = asArr(payload.sources).filter((s) => s.stance === 'contradicts');
  const summary = str(payload.summary);
  // Alarm-fatigue guard: no banner unless the governor raised it. Below that
  // bar we show a quiet "checked, no conflict" line, never an alarm.
  if (!raise) {
    return (
      <div className="text-[0.65rem] uppercase tracking-wider text-subtle">
        Sources checked · no material conflict
      </div>
    );
  }
  return (
    <div className="border-l-2 border-fg bg-surface p-3">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-fg">⚠ Sources conflict</span>
        <span className={chip}>{severity}</span>
      </div>
      {summary ? <p className="mb-2 text-xs text-muted">{summary}</p> : null}
      {sources.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {sources.slice(0, 6).map((s, i) => (
            <li key={i} className="text-xs text-subtle">
              {str(s.path) ?? str(s.note) ?? 'source'} — {str(s.note) ?? 'contradicts'}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Disconfirmation({ payload }: { payload: Dict }) {
  const gov = asDict(payload.governor);
  const credibility = str(gov.credibility) ?? str(payload.strength) ?? 'none';
  const counts = gov.counts_against_thesis === true;
  const counter = str(payload.external_counter);
  const sources = asArr(payload.sources);
  if (!counter) return null;
  // Web-surface-bias guard: a thin/none-credibility counter is shown muted +
  // explicitly does NOT count against the thesis.
  return (
    <div className={counts ? 'border-l-2 border-subtle bg-surface p-3' : 'opacity-70 p-3'}>
      <div className="mb-1 flex items-center gap-2">
        <span className="text-[0.6rem] uppercase tracking-[0.3em] text-subtle">External counter</span>
        <span className={chip}>{credibility}</span>
        {!counts ? <span className={chip}>weak · informational</span> : null}
      </div>
      <p className="mb-2 text-xs text-muted">{counter}</p>
      {sources.length > 0 ? (
        <ul className="flex flex-col gap-0.5">
          {sources.slice(0, 4).map((s, i) => (
            <li key={i} className="text-[0.65rem] text-subtle">
              {str(s.publisher) ?? 'source'}
              {str(s.tier) ? ` · ${str(s.tier)}` : ''}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export default function DeepEnrichment({ recId }: { recId: string }) {
  const [rows, setRows] = useState<RxDeepResult[] | null>(null);

  useEffect(() => {
    let live = true;
    getDeepResults(recId).then((r) => {
      if (live) setRows(r);
    });
    return () => {
      live = false;
    };
  }, [recId]);

  if (rows === null) return null; // loading — stay quiet
  if (rows.length === 0) return null; // no enrichment for this rec

  // Newest row per kind (rows already sorted created_at desc).
  const latest = (kind: string) => rows.find((r) => r.kind === kind);
  const deep = latest('deep_retrieval');
  const contra = latest('contradiction');
  const disc = latest('disconfirmation');

  return (
    <div className="mt-5 flex flex-col gap-4 border-t border-border pt-4">
      <div className="text-[0.6rem] uppercase tracking-[0.35em] text-muted">Deep enrichment</div>
      {contra ? <Contradiction payload={asDict(contra.payload)} /> : null}
      {disc ? <Disconfirmation payload={asDict(disc.payload)} /> : null}
      {deep ? <DeepRetrieval payload={asDict(deep.payload)} /> : null}
    </div>
  );
}
