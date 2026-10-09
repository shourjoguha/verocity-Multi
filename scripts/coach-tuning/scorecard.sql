-- Rule-health scorecard for the weekly coach-tuning routine (docs/COACH_TUNING.md).
--
-- Deterministic and read-only. It answers one question per rule — is this rule
-- earning its place on the page? — from two series the app already writes:
-- `coach_observations` (one drift reading per rule per check-in day, whether or
-- not it spoke) and `recommendations` (what it said, and what the athlete did).
--
-- The VERDICT column is the contract with the routine. The routine may act only
-- on a verdict, never on a feeling, and each verdict has a fixed response in
-- the playbook. Thresholds below are the routine's own triage lines, not
-- evidence claims; they decide what gets LOOKED AT, never what the coach says.
--
-- Substitute {{OWNER_USER_ID}} before running. It is deliberately not committed.

with params as (
  select '{{OWNER_USER_ID}}'::uuid as owner,
         current_date - 28 as since
),
obs as (
  select o.rule_id, o.observed_on, o.drift::numeric as drift, o.fired, o.sufficiency
  from coach_observations o, params p
  where o.owner_user_id = p.owner and o.observed_on >= p.since
),
-- Drift trend over the window, as the change a straight line puts across all
-- 28 days. A sign alone is not a trend: day-to-day drift wobbles by a few
-- hundredths on an unchanged log, so "improving" needs MATERIAL_FALL.
trend as (
  select rule_id,
         regr_slope(drift, extract(epoch from observed_on::timestamp) / 86400) as slope_per_day
  from obs group by rule_id
),
recs as (
  select r.rule_id, r.status, r.disposition, r.created_at, r.pack_version
  from recommendations r, params p
  where r.owner_user_id = p.owner and r.rule_id is not null
    and r.rule_id not like 'outcome.%'
    and r.created_at >= p.since - 28   -- decisions look back twice as far
),
last_decision as (
  select rule_id, max(created_at)::date as decided_on
  from recs where status in ('acted', 'dismissed') group by rule_id
),
resolved as (
  select substring(r.rule_id from 'outcome\.resolved\.(.*)') as rule_id, count(*) as n
  from recommendations r, params p
  where r.owner_user_id = p.owner and r.rule_id like 'outcome.resolved.%'
    and r.created_at >= p.since - 28
  group by 1
),
per_rule as (
  select o.rule_id,
         count(*)                                         as readings,
         count(*) filter (where o.fired)                  as fired,
         round(avg(o.drift), 2)                           as drift_mean,
         round(coalesce(stddev_samp(o.drift), 0), 2)      as drift_sd,
         round((t.slope_per_day * 28)::numeric, 2)        as drift_change,
         count(*) filter (where o.fired and o.observed_on > ld.decided_on) as fired_after_decision,
         ld.decided_on,
         string_agg(distinct o.sufficiency, '|')          as sufficiency
  from obs o
  left join trend t using (rule_id)
  left join last_decision ld using (rule_id)
  group by o.rule_id, t.slope_per_day, ld.decided_on
),
decisions as (
  select rule_id,
         count(*)                                                   as recs,
         count(*) filter (where disposition = 'acted_as_prescribed') as as_prescribed,
         count(*) filter (where disposition = 'acted_modified')      as modified,
         count(*) filter (where disposition = 'skipped' or status = 'dismissed') as rejected,
         count(*) filter (where status in ('open', 'snoozed'))       as pending
  from recs group by rule_id
)
select p.rule_id,
       p.readings, p.fired, p.drift_mean, p.drift_sd, p.drift_change,
       coalesce(d.recs, 0) as recs, coalesce(d.as_prescribed, 0) as as_prescribed,
       coalesce(d.modified, 0) as modified, coalesce(d.rejected, 0) as rejected,
       coalesce(d.pending, 0) as pending, coalesce(rs.n, 0) as resolved,
       p.decided_on, p.fired_after_decision, p.sufficiency,
       case
         -- Speaks nearly every time while barely off its line: a reminder
         -- dressed as a finding. Candidate for a gate or a display surface.
         when p.fired >= 0.8 * p.readings and p.drift_mean < 0.10 then 'noise-flat'
         -- The athlete keeps saying no. Either the rule is wrong about them or
         -- the action is not one they can take; both are worth a look.
         when coalesce(d.rejected, 0) >= 2
              and coalesce(d.rejected, 0) * 2 >= coalesce(d.recs, 0) then 'rejected'
         -- Acted on, still firing, drift not falling: the action did not move
         -- the measurement. Suspect the measurement first (LESSONS: "The coach
         -- fires the same finding every check-in after the athlete acted on it").
         when p.decided_on is not null and p.fired_after_decision >= 3
              and coalesce(p.drift_change, 0) > -0.15 then 'stuck'
         -- Fired and the drift is falling, or it closed: working as intended.
         when p.fired > 0 and (coalesce(p.drift_change, 0) <= -0.15 or coalesce(rs.n, 0) > 0) then 'signal-improving'
         when p.fired > 0 then 'signal'
         -- Measured clean all window. Fine; not evidence the rule is dead.
         else 'quiet'
       end as verdict
from per_rule p
left join decisions d using (rule_id)
left join resolved rs using (rule_id)
order by
  case when p.fired >= 0.8 * p.readings and p.drift_mean < 0.10 then 0 else 1 end,
  p.fired desc, p.rule_id;
