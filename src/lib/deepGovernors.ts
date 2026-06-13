// Deterministic governors for rx deep enrichment — TypeScript port of the
// TradingView `app/rx/deep_governors.py`. Kept in lockstep with it.
//
// Why this exists in the UI: on the finance path the governor runs server-side
// at `/v1/rx/deep` ingest. On the fitness/nutrition path the enrichment is
// written straight to Supabase by a Claude Code session, so there is no
// server-side ingest to run the governor. To keep the alarm-fatigue +
// web-surface-bias guards DETERMINISTIC (not "whatever the LLM wrote into
// payload.governor"), the Coach UI recomputes the verdict from the raw payload
// fields here. Same thresholds, enforced at render — the UI is the enforcement
// point for the non-TradingV stores.

type Dict = Record<string, unknown>;

const STRENGTH_ORDER: Record<string, number> = { none: 0, thin: 1, moderate: 2, strong: 3 };
const ORDER_NAME: Record<number, string> = { 0: 'none', 1: 'thin', 2: 'moderate', 3: 'strong' };
const TIER_RANK: Record<string, number> = { primary: 3, reputable: 3, secondary: 2, low: 1 };

function asArr(v: unknown): Dict[] {
  return Array.isArray(v) ? (v as Dict[]) : [];
}

export interface ContradictionVerdict {
  severity: 'none' | 'low' | 'medium' | 'high';
  raiseBanner: boolean;
  contradictsCount: number;
  pairCount: number;
}

/** NEW-1 alarm-fatigue guard. Banner only on a real conflict signal. */
export function contradictionSeverity(payload: Dict): ContradictionVerdict {
  const pairs = asArr(payload.contradictory_pairs);
  const pairCount = pairs.length;

  let contradicts: number;
  if (typeof payload.contradicts_count === 'number') {
    contradicts = payload.contradicts_count;
  } else {
    contradicts = asArr(payload.sources).filter((s) => s.stance === 'contradicts').length;
  }
  const stale = typeof payload.stale_count === 'number' ? payload.stale_count : 0;

  if (pairCount >= 1 || contradicts >= 2) {
    return { severity: 'high', raiseBanner: true, contradictsCount: contradicts, pairCount };
  }
  if (contradicts === 1) {
    return { severity: 'medium', raiseBanner: true, contradictsCount: contradicts, pairCount };
  }
  if (stale > 0) {
    return { severity: 'low', raiseBanner: false, contradictsCount: contradicts, pairCount };
  }
  return { severity: 'none', raiseBanner: false, contradictsCount: contradicts, pairCount };
}

export interface CredibilityVerdict {
  credibility: 'none' | 'thin' | 'moderate' | 'strong';
  countsAgainstThesis: boolean;
  distinctPublishers: number;
}

/** NEW-2 web-surface-bias guard. Cap counter strength by source diversity + tier. */
export function disconfirmationCredibility(payload: Dict): CredibilityVerdict {
  const sources = asArr(payload.sources);
  const publishers = new Set(
    sources.map((s) => (typeof s.publisher === 'string' ? s.publisher : '')).filter(Boolean),
  );
  const nPub = publishers.size;
  const tiers = sources.map((s) => TIER_RANK[String(s.tier ?? 'low').toLowerCase()] ?? 1);
  const bestTier = tiers.length ? Math.max(...tiers) : 0;

  let sourceCred: string;
  if (nPub === 0) sourceCred = 'none';
  else if (nPub === 1) sourceCred = 'thin';
  else if (nPub >= 3 && bestTier >= 3) sourceCred = 'strong';
  else sourceCred = 'moderate';

  const self = String(payload.strength ?? 'none').toLowerCase();
  const selfRank = STRENGTH_ORDER[self] ?? 3; // unknown self-report → trust sources
  const governedRank = Math.min(STRENGTH_ORDER[sourceCred], selfRank);
  const credibility = ORDER_NAME[governedRank] as CredibilityVerdict['credibility'];

  return {
    credibility,
    countsAgainstThesis: credibility === 'moderate' || credibility === 'strong',
    distinctPublishers: nPub,
  };
}
