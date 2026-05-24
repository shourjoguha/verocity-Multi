// On-demand AI coach (Coach phase 2). Computes training drift signals from the
// caller's own logs (RLS-scoped via their JWT — no service-role needed) and asks
// Claude for fitness recommendations, written back to the recommendations table.
// Returns {ok:false,error:'no_key'} when ANTHROPIC_API_KEY is unset so the client
// falls back to the rule-based generator. Fitness-only.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const MODEL = 'claude-haiku-4-5-20251001';

const SYSTEM_PROMPT = `You are a strength & conditioning coach reviewing an athlete's recent training signals (provided as JSON).
Return ONLY a JSON array (no prose, no markdown fences) of 1-4 objects, each exactly:
{"tldr": "<=60-char headline", "action": "one concrete next step", "body_md": "2-3 sentences of reasoning grounded in the numbers", "drift_score": 0.0-1.0, "confidence": 0.0-1.0}
Fitness only — never nutrition or medical advice. Be specific to the numbers. If everything looks healthy, return a single encouraging item with a low drift_score.`;

function e1rm(weight: number, reps: number): number | null {
  if (reps <= 0) return null;
  if (reps === 1) return weight;
  return (weight * 36) / (37 - Math.min(reps, 36)); // Brzycki, matching the app
}

// deno-lint-ignore no-explicit-any
type AnyLog = any;

function flatten(log: AnyLog) {
  const out: { movement: string; weight?: number; reps?: number; rpe?: number; completed: boolean }[] = [];
  for (const section of log.data?.sections ?? []) {
    for (const group of section.groups ?? []) {
      for (const item of group.items ?? []) {
        for (const st of item.sets ?? []) {
          out.push({
            movement: item.movement,
            weight: st.actual?.weight,
            reps: st.actual?.reps,
            rpe: st.actual?.rpe,
            completed: !!st.actual?.completed,
          });
        }
      }
    }
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const authHeader = req.headers.get('Authorization') ?? '';
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return json({ ok: false, error: 'unauthorized' }, 401);

  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!anthropicKey) return json({ ok: false, error: 'no_key' }, 200);

  // Caller's recent done sessions (newest first), RLS-scoped to them.
  const { data: logsData } = await db
    .from('workout_logs')
    .select('log_date, week_number, total_seconds, data')
    .eq('status', 'done')
    .order('log_date', { ascending: false })
    .limit(40);
  const logs = (logsData ?? []) as AnyLog[];
  if (logs.length === 0) return json({ ok: false, error: 'no_data' }, 200);

  // ---- drift signals ----
  let totalSets = 0;
  let doneSets = 0;
  const rpeRecent: number[] = [];
  const rpePrior: number[] = [];
  // per-movement best e1RM per session, oldest→newest
  const moveSeries: Record<string, number[]> = {};
  const ordered = [...logs].reverse(); // oldest→newest
  ordered.forEach((log) => {
    const best: Record<string, number> = {};
    for (const s of flatten(log)) {
      totalSets += 1;
      if (s.completed) doneSets += 1;
      if (s.weight != null && s.reps != null) {
        const e = e1rm(s.weight, s.reps);
        if (e != null) best[s.movement] = Math.max(best[s.movement] ?? 0, e);
      }
    }
    for (const [m, e] of Object.entries(best)) (moveSeries[m] ??= []).push(e);
  });
  logs.forEach((log, idx) => {
    for (const s of flatten(log)) {
      if (s.rpe != null) (idx < 5 ? rpeRecent : idx < 10 ? rpePrior : rpeRecent).push(s.rpe);
    }
  });
  const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const topMovements = Object.entries(moveSeries)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 4)
    .map(([name, series]) => ({
      name,
      sessions: series.length,
      e1rmFirst: Math.round(series[0]),
      e1rmLast: Math.round(series[series.length - 1]),
    }));

  const signals = {
    sessionsAnalyzed: logs.length,
    adherencePct: totalSets ? Math.round((doneSets / totalSets) * 100) : null,
    avgRpeRecent: avg(rpeRecent),
    avgRpePrior: avg(rpePrior),
    topMovements,
    currentWeek: logs[0]?.week_number ?? null,
  };

  // ---- ask Claude (prompt-cached system) ----
  let recs: { tldr: string; action: string; body_md: string; drift_score: number; confidence: number }[];
  try {
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2048,
        system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: JSON.stringify(signals) }],
      }),
    });
    if (!aiRes.ok) return json({ ok: false, error: 'model_error' }, 200);
    const payload = await aiRes.json();
    const text: string = (payload.content ?? []).map((b: AnyLog) => b.text ?? '').join('').trim();
    const cleaned = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    recs = JSON.parse(cleaned);
    if (!Array.isArray(recs)) throw new Error('not an array');
  } catch {
    return json({ ok: false, error: 'parse_failed' }, 200);
  }

  const rows = recs.slice(0, 4).map((r) => ({
    owner_user_id: user.id,
    status: 'open',
    tldr: String(r.tldr ?? '').slice(0, 200),
    action: String(r.action ?? '').slice(0, 400),
    body_md: String(r.body_md ?? '').slice(0, 2000),
    drift_score: typeof r.drift_score === 'number' ? r.drift_score : null,
    confidence: typeof r.confidence === 'number' ? r.confidence : null,
  }));
  const { error: insErr } = await db.from('recommendations').insert(rows);
  if (insErr) return json({ ok: false, error: 'insert_failed' }, 200);

  return json({ ok: true, count: rows.length });
});
