-- Verocity v2 — seed 22 real, dated CrossFit.com daily WODs (Jul 4 – Aug 3,
-- 2026), each with the site's own published Rx / Intermediate / Beginner
-- scaling. Captured via browser inspection (crossfit.com/workout blocks
-- server-side fetches with a 403; the content below was read from the
-- rendered page and transcribed verbatim into source_text).
--
-- Source filtering applied per the ingestion brief: rest days and pages that
-- carry only editorial/article content were excluded entirely (Jul 5, 9, 12,
-- 16, 19, 23, 26, 30 and Aug 2) — no session, no placeholder, no empty row
-- was created for those dates. `instructions` carries only material scoring
-- rules, movement standards, penalty/rest rules and partner rules — not the
-- "Stimulus and Strategy" coaching prose, which is commentary rather than
-- prescription (excluded per the same brief).
--
-- Frame/variant shape matches 0028 exactly: `variants[]` holds Rx and any
-- level whose prescription differs from Rx; a level explicitly marked "Same
-- as Rx'd" in the source is omitted so `selectVariant` (src/lib/logBuilder.ts)
-- falls back to Rx for it, rather than duplicating identical data. Calorie-
-- scored ergo movements (Row, Bike) use `primaryMetric: "cal"` with a bare
-- numeric `planned` count, matching the corrected convention from 0025/0026
-- (not the "distance" + "Ncal" label 0024 originally shipped).
--
-- Movements are keyed by lowercased name via `movements_shared_name_unique`
-- (0023); sessions by (source, source_ref) via `sessions_source_ref_unique`
-- (0027). Both inserts are idempotent — a re-import is a no-op.

-- ---- 1. Shared movements (new to this migration) ---------------------------
-- Row, Wall Ball, Burpee, Back Squat, Run, Sit-up, Push-up, Air Squat (0024);
-- Pull-up, Ring Row, Deadlift, Clean and Jerk, Double-Under, Single-Under
-- (0028) already exist — not re-inserted. Distinct scaling/variant movements
-- (e.g. Power Clean vs Squat Clean vs Hang Power Clean, Rope Climb vs
-- Pull-to-Stand) are kept separate per the taxonomy guardrails, not collapsed.
insert into public.movements (name, primary_metric, default_metrics, owner_user_id)
values
  ('Overhead Squat',              'weight',   array['reps','weight'],   null),
  ('Dumbbell Hang Power Clean',   'weight',   array['reps','weight'],   null),
  ('Dumbbell Push Press',         'weight',   array['reps','weight'],   null),
  ('Dumbbell Farmers Carry',      'distance', array['distance','weight'], null),
  ('Muscle-up',                   'reps',     array['reps'],            null),
  ('Foot-Assisted Ring Dip',      'reps',     array['reps'],            null),
  ('Dumbbell Hang Snatch',        'weight',   array['reps','weight'],   null),
  ('Dumbbell-Facing Burpee',      'reps',     array['reps'],            null),
  ('Bench Press',                 'weight',   array['reps','weight'],   null),
  ('Squat Clean',                 'weight',   array['reps','weight'],   null),
  ('Push Jerk',                   'weight',   array['reps','weight'],   null),
  ('Jumping Pull-up',             'reps',     array['reps'],            null),
  ('Clean',                       'weight',   array['reps','weight'],   null),
  ('Low-Hang Squat Snatch',       'weight',   array['reps','weight'],   null),
  ('Hang Power Snatch',           'weight',   array['reps','weight'],   null),
  ('Shoulder Press',              'weight',   array['reps','weight'],   null),
  ('Power Clean',                 'weight',   array['reps','weight'],   null),
  ('Box Jump',                    'reps',     array['reps'],            null),
  ('Hand-Release Push-up',        'reps',     array['reps'],            null),
  ('Foot-Assisted Pull-up',       'reps',     array['reps'],            null),
  ('Hand-Elevated Push-up',       'reps',     array['reps'],            null),
  ('Bike',                        'distance', array['distance','time'], null),
  ('Dumbbell Box Step-up',        'reps',     array['reps','weight'],   null),
  ('Box Step-up',                 'reps',     array['reps'],            null),
  ('Chest-to-Bar Pull-up',        'reps',     array['reps'],            null),
  ('Burpee Box Jump-Over',        'reps',     array['reps'],            null),
  ('Burpee Box Step-Over',        'reps',     array['reps'],            null),
  ('Push Press',                  'weight',   array['reps','weight'],   null),
  ('Hanging Knee Raise',          'reps',     array['reps'],            null),
  ('Front Squat',                 'weight',   array['reps','weight'],   null),
  ('Power Snatch',                'weight',   array['reps','weight'],   null),
  ('Rope Climb',                  'reps',     array['reps'],            null),
  ('Pull-to-Stand',               'reps',     array['reps'],            null),
  ('Toes-to-Bar',                 'reps',     array['reps'],            null)
on conflict (lower(name)) where owner_user_id is null do nothing;

-- ---- 2. Shared CrossFit daily-WOD sessions ---------------------------------

insert into public.sessions
  (owner_user_id, name, tags, frame, session_type, time_cap_seconds,
   duration_seconds, rounds, partner, instructions, source, source_ref, source_text)
values

-- Mon Aug 3, 2026 — run/OHS
(null, 'CrossFit · Aug 3, 2026', array['crossfit'],
 $${
   "exercises": [
     {"movement":"Run","section":"conditioning","primaryMetric":"distance","planned":"1x800m"},
     {"movement":"Overhead Squat","section":"conditioning","primaryMetric":"reps","planned":"1x15","notes":"155/105 lb"}
   ],
   "groups": [
     {"kind":"circuit","section":"conditioning","rounds":3,"label":"Round (3×, Rx)",
      "items":[
        {"movement":"Run","section":"conditioning","primaryMetric":"distance","planned":"1x800m"},
        {"movement":"Overhead Squat","section":"conditioning","primaryMetric":"reps","planned":"1x15","notes":"155/105 lb"}
      ]}
   ],
   "variants": [
     {"level":"rx","label":"Rx","groups":[
       {"kind":"circuit","section":"conditioning","rounds":3,"label":"Round (3×, Rx)",
        "items":[
          {"movement":"Run","section":"conditioning","primaryMetric":"distance","planned":"1x800m"},
          {"movement":"Overhead Squat","section":"conditioning","primaryMetric":"reps","planned":"1x15","notes":"155/105 lb"}
        ]}
     ]},
     {"level":"intermediate","label":"Intermediate","groups":[
       {"kind":"circuit","section":"conditioning","rounds":3,"label":"Round (3×, Intermediate)",
        "items":[
          {"movement":"Run","section":"conditioning","primaryMetric":"distance","planned":"1x600m"},
          {"movement":"Overhead Squat","section":"conditioning","primaryMetric":"reps","planned":"1x15","notes":"105/75 lb"}
        ]}
     ]},
     {"level":"beginner","label":"Beginner","groups":[
       {"kind":"circuit","section":"conditioning","rounds":3,"label":"Round (3×, Beginner)",
        "items":[
          {"movement":"Run","section":"conditioning","primaryMetric":"distance","planned":"1x400m"},
          {"movement":"Overhead Squat","section":"conditioning","primaryMetric":"reps","planned":"1x10","notes":"45/35 lb"}
        ]}
     ]}
   ]
 }$$::jsonb,
 'ROUNDS_FOR_TIME', null, null, 3, false, null,
 'CrossFit.com', 'daily/260803',
 $$3 rounds for time:
800-meter run
15 overhead squats (155/105 lb)$$),

-- Sat Aug 1, 2026 — DB complex
(null, 'CrossFit · Aug 1, 2026', array['crossfit'],
 $${
   "exercises": [
     {"movement":"Dumbbell Hang Power Clean","section":"conditioning","primaryMetric":"reps","planned":"1x10","notes":"50/35 lb"},
     {"movement":"Dumbbell Push Press","section":"conditioning","primaryMetric":"reps","planned":"1x10","notes":"50/35 lb"},
     {"movement":"Dumbbell Farmers Carry","section":"conditioning","primaryMetric":"distance","planned":"1x200m","notes":"50/35 lb"}
   ],
   "groups": [
     {"kind":"circuit","section":"conditioning","rounds":5,"label":"Round (5×, Rx)",
      "items":[
        {"movement":"Dumbbell Hang Power Clean","section":"conditioning","primaryMetric":"reps","planned":"1x10","notes":"50/35 lb"},
        {"movement":"Dumbbell Push Press","section":"conditioning","primaryMetric":"reps","planned":"1x10","notes":"50/35 lb"},
        {"movement":"Dumbbell Farmers Carry","section":"conditioning","primaryMetric":"distance","planned":"1x200m","notes":"50/35 lb"}
      ]}
   ],
   "variants": [
     {"level":"rx","label":"Rx","groups":[
       {"kind":"circuit","section":"conditioning","rounds":5,"label":"Round (5×, Rx)",
        "items":[
          {"movement":"Dumbbell Hang Power Clean","section":"conditioning","primaryMetric":"reps","planned":"1x10","notes":"50/35 lb"},
          {"movement":"Dumbbell Push Press","section":"conditioning","primaryMetric":"reps","planned":"1x10","notes":"50/35 lb"},
          {"movement":"Dumbbell Farmers Carry","section":"conditioning","primaryMetric":"distance","planned":"1x200m","notes":"50/35 lb"}
        ]}
     ]},
     {"level":"intermediate","label":"Intermediate","groups":[
       {"kind":"circuit","section":"conditioning","rounds":5,"label":"Round (5×, Intermediate)",
        "items":[
          {"movement":"Dumbbell Hang Power Clean","section":"conditioning","primaryMetric":"reps","planned":"1x10","notes":"35/20 lb"},
          {"movement":"Dumbbell Push Press","section":"conditioning","primaryMetric":"reps","planned":"1x10","notes":"35/20 lb"},
          {"movement":"Dumbbell Farmers Carry","section":"conditioning","primaryMetric":"distance","planned":"1x200m","notes":"35/20 lb"}
        ]}
     ]},
     {"level":"beginner","label":"Beginner","groups":[
       {"kind":"circuit","section":"conditioning","rounds":5,"label":"Round (5×, Beginner)",
        "items":[
          {"movement":"Dumbbell Hang Power Clean","section":"conditioning","primaryMetric":"reps","planned":"1x10","notes":"20/15 lb"},
          {"movement":"Dumbbell Push Press","section":"conditioning","primaryMetric":"reps","planned":"1x10","notes":"20/15 lb"},
          {"movement":"Dumbbell Farmers Carry","section":"conditioning","primaryMetric":"distance","planned":"1x100m","notes":"20/15 lb"}
        ]}
     ]}
   ]
 }$$::jsonb,
 'ROUNDS_FOR_TIME', null, null, 5, false, null,
 'CrossFit.com', 'daily/260801',
 $$5 rounds for time:
10 dumbbell hang power cleans
10 dumbbell push presses
200-meter dumbbell farmers carry
(50/35-lb dumbbells)$$),

-- Fri Jul 31, 2026 — muscle-up / back squat pyramid
(null, 'CrossFit · Jul 31, 2026', array['crossfit'],
 $${
   "exercises": [
     {"movement":"Muscle-up","section":"conditioning","primaryMetric":"reps","planned":"","notes":"2-4-6-8-6-4-2 reps"},
     {"movement":"Back Squat","section":"conditioning","primaryMetric":"reps","planned":"","notes":"2-4-6-8-6-4-2 reps · 225/155 lb"}
   ],
   "groups": [
     {"kind":"circuit","section":"conditioning","rounds":1,"label":"2-4-6-8-6-4-2 pyramid (Rx)",
      "items":[
        {"movement":"Muscle-up","section":"conditioning","primaryMetric":"reps","planned":"","notes":"2-4-6-8-6-4-2 reps"},
        {"movement":"Back Squat","section":"conditioning","primaryMetric":"reps","planned":"","notes":"2-4-6-8-6-4-2 reps · 225/155 lb"}
      ]}
   ],
   "variants": [
     {"level":"rx","label":"Rx","groups":[
       {"kind":"circuit","section":"conditioning","rounds":1,"label":"2-4-6-8-6-4-2 pyramid (Rx)",
        "items":[
          {"movement":"Muscle-up","section":"conditioning","primaryMetric":"reps","planned":"","notes":"2-4-6-8-6-4-2 reps"},
          {"movement":"Back Squat","section":"conditioning","primaryMetric":"reps","planned":"","notes":"2-4-6-8-6-4-2 reps · 225/155 lb"}
        ]}
     ]},
     {"level":"intermediate","label":"Intermediate","groups":[
       {"kind":"circuit","section":"conditioning","rounds":1,"label":"1-2-3-4-3-2-1 / 2-4-6-8-6-4-2 pyramid (Intermediate)",
        "items":[
          {"movement":"Muscle-up","section":"conditioning","primaryMetric":"reps","planned":"","notes":"1-2-3-4-3-2-1 reps"},
          {"movement":"Back Squat","section":"conditioning","primaryMetric":"reps","planned":"","notes":"2-4-6-8-6-4-2 reps · 155/105 lb"}
        ]}
     ]},
     {"level":"beginner","label":"Beginner","groups":[
       {"kind":"circuit","section":"conditioning","rounds":1,"label":"2-4-6-8-6-4-2 pyramid (Beginner)",
        "items":[
          {"movement":"Ring Row","section":"conditioning","primaryMetric":"reps","planned":"","notes":"2-4-6-8-6-4-2 reps, each rep + a foot-assisted ring dip"},
          {"movement":"Foot-Assisted Ring Dip","section":"conditioning","primaryMetric":"reps","planned":"","notes":"2-4-6-8-6-4-2 reps"},
          {"movement":"Back Squat","section":"conditioning","primaryMetric":"reps","planned":"","notes":"2-4-6-8-6-4-2 reps · 65/45 lb"}
        ]}
     ]}
   ]
 }$$::jsonb,
 'FOR_TIME', null, null, null, false,
 'Pyramid ladder: 2-4-6-8-6-4-2 reps of each movement.',
 'CrossFit.com', 'daily/260731',
 $$For time:
2 muscle-ups, 2 back squats
4 muscle-ups, 4 back squats
6 muscle-ups, 6 back squats
8 muscle-ups, 8 back squats
6 muscle-ups, 6 back squats
4 muscle-ups, 4 back squats
2 muscle-ups, 2 back squats
(225/155-lb back squat)$$),

-- Wed Jul 29, 2026 — row/DB snatch/burpee intervals
(null, 'CrossFit · Jul 29, 2026', array['crossfit'],
 $${
   "exercises": [
     {"movement":"Row","section":"conditioning","primaryMetric":"cal","planned":"1x18"},
     {"movement":"Dumbbell Hang Snatch","section":"conditioning","primaryMetric":"reps","planned":"1x20","notes":"alternating · 50/35 lb"},
     {"movement":"Dumbbell-Facing Burpee","section":"conditioning","primaryMetric":"reps","planned":"","notes":"max reps in remaining time"}
   ],
   "groups": [
     {"kind":"circuit","section":"conditioning","rounds":5,"restSeconds":60,"label":"3-min AMRAP (5×, Rx)",
      "items":[
        {"movement":"Row","section":"conditioning","primaryMetric":"cal","planned":"1x18"},
        {"movement":"Dumbbell Hang Snatch","section":"conditioning","primaryMetric":"reps","planned":"1x20","notes":"alternating · 50/35 lb"},
        {"movement":"Dumbbell-Facing Burpee","section":"conditioning","primaryMetric":"reps","planned":"","notes":"max reps in remaining time"}
      ]}
   ],
   "variants": [
     {"level":"rx","label":"Rx","groups":[
       {"kind":"circuit","section":"conditioning","rounds":5,"restSeconds":60,"label":"3-min AMRAP (5×, Rx)",
        "items":[
          {"movement":"Row","section":"conditioning","primaryMetric":"cal","planned":"1x18"},
          {"movement":"Dumbbell Hang Snatch","section":"conditioning","primaryMetric":"reps","planned":"1x20","notes":"alternating · 50/35 lb"},
          {"movement":"Dumbbell-Facing Burpee","section":"conditioning","primaryMetric":"reps","planned":"","notes":"max reps in remaining time"}
        ]}
     ]},
     {"level":"intermediate","label":"Intermediate","groups":[
       {"kind":"circuit","section":"conditioning","rounds":5,"restSeconds":60,"label":"3-min AMRAP (5×, Intermediate)",
        "items":[
          {"movement":"Row","section":"conditioning","primaryMetric":"cal","planned":"1x14"},
          {"movement":"Dumbbell Hang Snatch","section":"conditioning","primaryMetric":"reps","planned":"1x20","notes":"alternating · 35/20 lb"},
          {"movement":"Dumbbell-Facing Burpee","section":"conditioning","primaryMetric":"reps","planned":"","notes":"max reps in remaining time"}
        ]}
     ]},
     {"level":"beginner","label":"Beginner","groups":[
       {"kind":"circuit","section":"conditioning","rounds":5,"restSeconds":60,"label":"3-min AMRAP (5×, Beginner)",
        "items":[
          {"movement":"Row","section":"conditioning","primaryMetric":"cal","planned":"1x10"},
          {"movement":"Dumbbell Hang Snatch","section":"conditioning","primaryMetric":"reps","planned":"1x20","notes":"alternating · 20/15 lb"},
          {"movement":"Burpee","section":"conditioning","primaryMetric":"reps","planned":"","notes":"max reps in remaining time"}
        ]}
     ]}
   ]
 }$$::jsonb,
 'INTERVALS', null, 1140, 5,
 false, '5 rounds, each a 3-minute AMRAP; rest 1 minute between rounds.',
 'CrossFit.com', 'daily/260729',
 $$For 5 rounds, AMRAP in 3 minutes of:
18-calorie row
20 alternating dumbbell hang snatches (50/35-lb dumbbell)
Max dumbbell-facing burpees
Rest 1 minute between rounds$$),

-- Tue Jul 28, 2026 — "Linda" (three bars of death)
(null, 'CrossFit · Jul 28, 2026 (Linda)', array['crossfit'],
 $${
   "exercises": [
     {"movement":"Deadlift","section":"conditioning","primaryMetric":"weight","planned":"","notes":"10-9-8-7-6-5-4-3-2-1 reps · 1½× bodyweight"},
     {"movement":"Bench Press","section":"conditioning","primaryMetric":"weight","planned":"","notes":"10-9-8-7-6-5-4-3-2-1 reps · bodyweight"},
     {"movement":"Squat Clean","section":"conditioning","primaryMetric":"weight","planned":"","notes":"10-9-8-7-6-5-4-3-2-1 reps · ¾× bodyweight"}
   ],
   "groups": [
     {"kind":"circuit","section":"conditioning","rounds":10,"label":"10-9-8…1 ladder (Rx)",
      "items":[
        {"movement":"Deadlift","section":"conditioning","primaryMetric":"weight","planned":"","notes":"10-9-8-7-6-5-4-3-2-1 reps · 1½× bodyweight"},
        {"movement":"Bench Press","section":"conditioning","primaryMetric":"weight","planned":"","notes":"10-9-8-7-6-5-4-3-2-1 reps · bodyweight"},
        {"movement":"Squat Clean","section":"conditioning","primaryMetric":"weight","planned":"","notes":"10-9-8-7-6-5-4-3-2-1 reps · ¾× bodyweight"}
      ]}
   ],
   "variants": [
     {"level":"rx","label":"Rx","groups":[
       {"kind":"circuit","section":"conditioning","rounds":10,"label":"10-9-8…1 ladder (Rx)",
        "items":[
          {"movement":"Deadlift","section":"conditioning","primaryMetric":"weight","planned":"","notes":"10-9-8-7-6-5-4-3-2-1 reps · 1½× bodyweight"},
          {"movement":"Bench Press","section":"conditioning","primaryMetric":"weight","planned":"","notes":"10-9-8-7-6-5-4-3-2-1 reps · bodyweight"},
          {"movement":"Squat Clean","section":"conditioning","primaryMetric":"weight","planned":"","notes":"10-9-8-7-6-5-4-3-2-1 reps · ¾× bodyweight"}
        ]}
     ]},
     {"level":"intermediate","label":"Intermediate","groups":[
       {"kind":"circuit","section":"conditioning","rounds":10,"label":"10-9-8…1 ladder (Intermediate)",
        "items":[
          {"movement":"Deadlift","section":"conditioning","primaryMetric":"weight","planned":"","notes":"10-9-8-7-6-5-4-3-2-1 reps · 1¼× bodyweight"},
          {"movement":"Bench Press","section":"conditioning","primaryMetric":"weight","planned":"","notes":"10-9-8-7-6-5-4-3-2-1 reps · ¾× bodyweight"},
          {"movement":"Squat Clean","section":"conditioning","primaryMetric":"weight","planned":"","notes":"10-9-8-7-6-5-4-3-2-1 reps · ½× bodyweight"}
        ]}
     ]},
     {"level":"beginner","label":"Beginner","groups":[
       {"kind":"circuit","section":"conditioning","rounds":8,"label":"8-7-6…1 ladder (Beginner)",
        "items":[
          {"movement":"Deadlift","section":"conditioning","primaryMetric":"weight","planned":"","notes":"8-7-6-5-4-3-2-1 reps · 65/95 lb"},
          {"movement":"Bench Press","section":"conditioning","primaryMetric":"weight","planned":"","notes":"8-7-6-5-4-3-2-1 reps · 55/75 lb"},
          {"movement":"Squat Clean","section":"conditioning","primaryMetric":"weight","planned":"","notes":"8-7-6-5-4-3-2-1 reps · 35/45 lb"}
        ]}
     ]}
   ]
 }$$::jsonb,
 'FOR_TIME', null, null, 10, false,
 '10-9-8-7-6-5-4-3-2-1 reps for time of Deadlift, Bench Press and Squat Clean.',
 'CrossFit.com', 'daily/260728',
 $$10-9-8-7-6-5-4-3-2-1 reps for time:
1½-bodyweight deadlifts
Bodyweight bench presses
¾-bodyweight squat cleans$$),

-- Mon Jul 27, 2026 — 2× 1-mile run
(null, 'CrossFit · Jul 27, 2026', array['crossfit'],
 $${
   "exercises": [
     {"movement":"Run","section":"conditioning","primaryMetric":"distance","planned":"2x1600m"}
   ],
   "groups": [
     {"kind":"circuit","section":"conditioning","rounds":2,"label":"Round (2×, Rx)",
      "items":[
        {"movement":"Run","section":"conditioning","primaryMetric":"distance","planned":"1x1600m"}
      ]}
   ],
   "variants": [
     {"level":"rx","label":"Rx","groups":[
       {"kind":"circuit","section":"conditioning","rounds":2,"label":"Round (2×, Rx)",
        "items":[
          {"movement":"Run","section":"conditioning","primaryMetric":"distance","planned":"1x1600m"}
        ]}
     ]},
     {"level":"beginner","label":"Beginner","groups":[
       {"kind":"circuit","section":"conditioning","rounds":1,"label":"Effort 1 (Beginner)",
        "items":[
          {"movement":"Run","section":"conditioning","primaryMetric":"distance","planned":"1x1600m"}
        ]},
       {"kind":"circuit","section":"conditioning","rounds":1,"label":"Effort 2 (Beginner)",
        "items":[
          {"movement":"Run","section":"conditioning","primaryMetric":"distance","planned":"1x800m"}
        ]}
     ]}
   ]
 }$$::jsonb,
 'INTERVALS', null, null, 2, false,
 'Check your time after round 1 and rest exactly that long before round 2.',
 'CrossFit.com', 'daily/260727',
 $$2 rounds, each for time:
1,600-meter run
Check your time and rest exactly that amount of time before the second round.$$),

-- Sat Jul 25, 2026 — 2008 CrossFit Games Event 4
(null, 'CrossFit · Jul 25, 2026 (2008 Games Event 4)', array['crossfit'],
 $${
   "exercises": [
     {"movement":"Deadlift","section":"conditioning","primaryMetric":"reps","planned":"1x5","notes":"275/185 lb"},
     {"movement":"Burpee","section":"conditioning","primaryMetric":"reps","planned":"1x10"}
   ],
   "groups": [
     {"kind":"circuit","section":"conditioning","rounds":5,"label":"Round (5×, Rx)",
      "items":[
        {"movement":"Deadlift","section":"conditioning","primaryMetric":"reps","planned":"1x5","notes":"275/185 lb"},
        {"movement":"Burpee","section":"conditioning","primaryMetric":"reps","planned":"1x10"}
      ]}
   ],
   "variants": [
     {"level":"rx","label":"Rx","groups":[
       {"kind":"circuit","section":"conditioning","rounds":5,"label":"Round (5×, Rx)",
        "items":[
          {"movement":"Deadlift","section":"conditioning","primaryMetric":"reps","planned":"1x5","notes":"275/185 lb"},
          {"movement":"Burpee","section":"conditioning","primaryMetric":"reps","planned":"1x10"}
        ]}
     ]},
     {"level":"intermediate","label":"Intermediate","groups":[
       {"kind":"circuit","section":"conditioning","rounds":5,"label":"Round (5×, Intermediate)",
        "items":[
          {"movement":"Deadlift","section":"conditioning","primaryMetric":"reps","planned":"1x5","notes":"205/145 lb"},
          {"movement":"Burpee","section":"conditioning","primaryMetric":"reps","planned":"1x10"}
        ]}
     ]},
     {"level":"beginner","label":"Beginner","groups":[
       {"kind":"circuit","section":"conditioning","rounds":5,"label":"Round (5×, Beginner)",
        "items":[
          {"movement":"Deadlift","section":"conditioning","primaryMetric":"reps","planned":"1x5","notes":"95/65 lb"},
          {"movement":"Burpee","section":"conditioning","primaryMetric":"reps","planned":"1x10"}
        ]}
     ]}
   ]
 }$$::jsonb,
 'ROUNDS_FOR_TIME', null, null, 5, false, null,
 'CrossFit.com', 'daily/260725',
 $$5 rounds for time:
5 deadlifts (275/185 lb)
10 burpees$$),

-- Fri Jul 24, 2026 — 2007 CrossFit Games Event 2 ("The Hopper")
(null, 'CrossFit · Jul 24, 2026 (The Hopper)', array['crossfit'],
 $${
   "exercises": [
     {"movement":"Row","section":"conditioning","primaryMetric":"distance","planned":"1x1000m"},
     {"movement":"Pull-up","section":"conditioning","primaryMetric":"reps","planned":"1x25"},
     {"movement":"Push Jerk","section":"conditioning","primaryMetric":"reps","planned":"1x7","notes":"135/85 lb"}
   ],
   "groups": [
     {"kind":"single","section":"conditioning","label":"Row (Rx)",
      "items":[{"movement":"Row","section":"conditioning","primaryMetric":"distance","planned":"1x1000m"}]},
     {"kind":"circuit","section":"conditioning","rounds":5,"label":"Round (5×, Rx)",
      "items":[
        {"movement":"Pull-up","section":"conditioning","primaryMetric":"reps","planned":"1x25"},
        {"movement":"Push Jerk","section":"conditioning","primaryMetric":"reps","planned":"1x7","notes":"135/85 lb"}
      ]}
   ],
   "variants": [
     {"level":"rx","label":"Rx","groups":[
       {"kind":"single","section":"conditioning","label":"Row (Rx)",
        "items":[{"movement":"Row","section":"conditioning","primaryMetric":"distance","planned":"1x1000m"}]},
       {"kind":"circuit","section":"conditioning","rounds":5,"label":"Round (5×, Rx)",
        "items":[
          {"movement":"Pull-up","section":"conditioning","primaryMetric":"reps","planned":"1x25"},
          {"movement":"Push Jerk","section":"conditioning","primaryMetric":"reps","planned":"1x7","notes":"135/85 lb"}
        ]}
     ]},
     {"level":"intermediate","label":"Intermediate","groups":[
       {"kind":"single","section":"conditioning","label":"Row (Intermediate)",
        "items":[{"movement":"Row","section":"conditioning","primaryMetric":"distance","planned":"1x1000m"}]},
       {"kind":"circuit","section":"conditioning","rounds":5,"label":"Round (5×, Intermediate)",
        "items":[
          {"movement":"Pull-up","section":"conditioning","primaryMetric":"reps","planned":"1x15"},
          {"movement":"Push Jerk","section":"conditioning","primaryMetric":"reps","planned":"1x7","notes":"115/75 lb"}
        ]}
     ]},
     {"level":"beginner","label":"Beginner","groups":[
       {"kind":"single","section":"conditioning","label":"Row (Beginner)",
        "items":[{"movement":"Row","section":"conditioning","primaryMetric":"distance","planned":"1x500m"}]},
       {"kind":"circuit","section":"conditioning","rounds":5,"label":"Round (5×, Beginner)",
        "items":[
          {"movement":"Jumping Pull-up","section":"conditioning","primaryMetric":"reps","planned":"1x10","notes":"bar intersects forearms overhead"},
          {"movement":"Push Jerk","section":"conditioning","primaryMetric":"reps","planned":"1x7","notes":"45/35 lb"}
        ]}
     ]}
   ]
 }$$::jsonb,
 'FOR_TIME', null, null, 5, false, null,
 'CrossFit.com', 'daily/260724',
 $$For time:
1,000-meter row
Then, 5 rounds of:
25 pull-ups
7 push jerks (135/85 lb)$$),

-- Wed Jul 22, 2026 — 2019 CrossFit Games Event 8 (1RM clean)
(null, 'CrossFit · Jul 22, 2026 (2019 Games Event 8)', array['crossfit'],
 $${
   "exercises": [
     {"movement":"Clean","section":"primary","primaryMetric":"weight","planned":"1x1","notes":"any variation, build to a heaviest single"}
   ],
   "groups": [
     {"kind":"single","section":"primary","label":"1-rep max (Rx)",
      "items":[{"movement":"Clean","section":"primary","primaryMetric":"weight","planned":"1x1","notes":"any variation, build to a heaviest single"}]}
   ],
   "variants": [
     {"level":"rx","label":"Rx","groups":[
       {"kind":"single","section":"primary","label":"1-rep max",
        "items":[{"movement":"Clean","section":"primary","primaryMetric":"weight","planned":"1x1","notes":"any variation, build to a heaviest single"}]}
     ]}
   ]
 }$$::jsonb,
 'FOR_LOAD', null, null, null, false,
 'Any variation of the clean is allowed — build to your heaviest single.',
 'CrossFit.com', 'daily/260722',
 $$1-rep-max clean$$),

-- Tue Jul 21, 2026 — 2014 CrossFit Games Workout 7 (Muscle-Up Biathlon)
(null, 'CrossFit · Jul 21, 2026 (Muscle-Up Biathlon)', array['crossfit'],
 $${
   "exercises": [
     {"movement":"Run","section":"conditioning","primaryMetric":"distance","planned":"3x400m"},
     {"movement":"Muscle-up","section":"conditioning","primaryMetric":"reps","planned":"","notes":"18-15-12 reps"}
   ],
   "groups": [
     {"kind":"circuit","section":"conditioning","rounds":1,"label":"Biathlon (Rx)",
      "items":[
        {"movement":"Run","section":"conditioning","primaryMetric":"distance","planned":"1x400m"},
        {"movement":"Muscle-up","section":"conditioning","primaryMetric":"reps","planned":"1x18"},
        {"movement":"Run","section":"conditioning","primaryMetric":"distance","planned":"1x400m"},
        {"movement":"Muscle-up","section":"conditioning","primaryMetric":"reps","planned":"1x15"},
        {"movement":"Run","section":"conditioning","primaryMetric":"distance","planned":"1x400m"},
        {"movement":"Muscle-up","section":"conditioning","primaryMetric":"reps","planned":"1x12"}
      ]}
   ],
   "variants": [
     {"level":"rx","label":"Rx","groups":[
       {"kind":"circuit","section":"conditioning","rounds":1,"label":"Biathlon (Rx)",
        "items":[
          {"movement":"Run","section":"conditioning","primaryMetric":"distance","planned":"1x400m"},
          {"movement":"Muscle-up","section":"conditioning","primaryMetric":"reps","planned":"1x18"},
          {"movement":"Run","section":"conditioning","primaryMetric":"distance","planned":"1x400m"},
          {"movement":"Muscle-up","section":"conditioning","primaryMetric":"reps","planned":"1x15"},
          {"movement":"Run","section":"conditioning","primaryMetric":"distance","planned":"1x400m"},
          {"movement":"Muscle-up","section":"conditioning","primaryMetric":"reps","planned":"1x12"}
        ]}
     ]},
     {"level":"intermediate","label":"Intermediate","groups":[
       {"kind":"circuit","section":"conditioning","rounds":1,"label":"Biathlon (Intermediate)",
        "items":[
          {"movement":"Run","section":"conditioning","primaryMetric":"distance","planned":"1x400m"},
          {"movement":"Muscle-up","section":"conditioning","primaryMetric":"reps","planned":"1x9"},
          {"movement":"Run","section":"conditioning","primaryMetric":"distance","planned":"1x400m"},
          {"movement":"Muscle-up","section":"conditioning","primaryMetric":"reps","planned":"1x6"},
          {"movement":"Run","section":"conditioning","primaryMetric":"distance","planned":"1x400m"},
          {"movement":"Muscle-up","section":"conditioning","primaryMetric":"reps","planned":"1x3"}
        ]}
     ]},
     {"level":"beginner","label":"Beginner","groups":[
       {"kind":"circuit","section":"conditioning","rounds":1,"label":"Biathlon (Beginner)",
        "items":[
          {"movement":"Run","section":"conditioning","primaryMetric":"distance","planned":"1x400m"},
          {"movement":"Ring Row","section":"conditioning","primaryMetric":"reps","planned":"1x18"},
          {"movement":"Run","section":"conditioning","primaryMetric":"distance","planned":"1x400m"},
          {"movement":"Ring Row","section":"conditioning","primaryMetric":"reps","planned":"1x15"},
          {"movement":"Run","section":"conditioning","primaryMetric":"distance","planned":"1x400m"},
          {"movement":"Ring Row","section":"conditioning","primaryMetric":"reps","planned":"1x12"}
        ]}
     ]}
   ]
 }$$::jsonb,
 'FOR_TIME', null, null, null, false,
 'If you break a set of muscle-ups (or the substituted movement), run a 200-meter penalty lap.',
 'CrossFit.com', 'daily/260721',
 $$For time:
400-meter run, 18 muscle-ups
400-meter run, 15 muscle-ups
400-meter run, 12 muscle-ups
Break a set → 200-meter penalty lap$$),

-- Mon Jul 20, 2026 — 2009 CrossFit Games Event 5
(null, 'CrossFit · Jul 20, 2026 (2009 Games Event 5)', array['crossfit'],
 $${
   "exercises": [
     {"movement":"Wall Ball","section":"conditioning","primaryMetric":"reps","planned":"1x30","notes":"20-lb ball to 10-ft target"},
     {"movement":"Low-Hang Squat Snatch","section":"conditioning","primaryMetric":"reps","planned":"1x30","notes":"75 lb · barbell stays below the knee"}
   ],
   "groups": [
     {"kind":"circuit","section":"conditioning","rounds":3,"label":"Round (3×, Rx)",
      "items":[
        {"movement":"Wall Ball","section":"conditioning","primaryMetric":"reps","planned":"1x30","notes":"20-lb ball to 10-ft target"},
        {"movement":"Low-Hang Squat Snatch","section":"conditioning","primaryMetric":"reps","planned":"1x30","notes":"75 lb · barbell stays below the knee"}
      ]}
   ],
   "variants": [
     {"level":"rx","label":"Rx","groups":[
       {"kind":"circuit","section":"conditioning","rounds":3,"label":"Round (3×, Rx)",
        "items":[
          {"movement":"Wall Ball","section":"conditioning","primaryMetric":"reps","planned":"1x30","notes":"20-lb ball to 10-ft target"},
          {"movement":"Low-Hang Squat Snatch","section":"conditioning","primaryMetric":"reps","planned":"1x30","notes":"75 lb · barbell stays below the knee"}
        ]}
     ]},
     {"level":"intermediate","label":"Intermediate","groups":[
       {"kind":"circuit","section":"conditioning","rounds":3,"label":"Round (3×, Intermediate)",
        "items":[
          {"movement":"Wall Ball","section":"conditioning","primaryMetric":"reps","planned":"1x25","notes":"14-lb ball to 10-ft target"},
          {"movement":"Low-Hang Squat Snatch","section":"conditioning","primaryMetric":"reps","planned":"1x25","notes":"55 lb · barbell stays below the knee"}
        ]}
     ]},
     {"level":"beginner","label":"Beginner","groups":[
       {"kind":"circuit","section":"conditioning","rounds":3,"label":"Round (3×, Beginner)",
        "items":[
          {"movement":"Wall Ball","section":"conditioning","primaryMetric":"reps","planned":"1x20","notes":"10-lb ball to 9-ft target"},
          {"movement":"Hang Power Snatch","section":"conditioning","primaryMetric":"reps","planned":"1x20","notes":"35 lb"}
        ]}
     ]}
   ]
 }$$::jsonb,
 'ROUNDS_FOR_TIME', null, null, 3, false, null,
 'CrossFit.com', 'daily/260720',
 $$3 rounds for time:
30 wall-ball shots (20-lb ball, 10-ft target)
30 low-hang squat snatches (75 lb)$$),

-- Sat Jul 18, 2026 — DU/sit-up ladder + shoulder press
(null, 'CrossFit · Jul 18, 2026', array['crossfit'],
 $${
   "exercises": [
     {"movement":"Double-Under","section":"conditioning","primaryMetric":"reps","planned":"","notes":"50-40-30-20-10 reps"},
     {"movement":"Sit-up","section":"conditioning","primaryMetric":"reps","planned":"","notes":"50-40-30-20-10 reps"},
     {"movement":"Shoulder Press","section":"conditioning","primaryMetric":"reps","planned":"1x5","notes":"80% of 1RM · after each round"}
   ],
   "groups": [
     {"kind":"circuit","section":"conditioning","rounds":5,"label":"50-40-30-20-10 (Rx)",
      "items":[
        {"movement":"Double-Under","section":"conditioning","primaryMetric":"reps","planned":"","notes":"50-40-30-20-10 reps"},
        {"movement":"Sit-up","section":"conditioning","primaryMetric":"reps","planned":"","notes":"50-40-30-20-10 reps"},
        {"movement":"Shoulder Press","section":"conditioning","primaryMetric":"reps","planned":"1x5","notes":"80% of 1RM · after each round"}
      ]}
   ],
   "variants": [
     {"level":"rx","label":"Rx","groups":[
       {"kind":"circuit","section":"conditioning","rounds":5,"label":"50-40-30-20-10 (Rx)",
        "items":[
          {"movement":"Double-Under","section":"conditioning","primaryMetric":"reps","planned":"","notes":"50-40-30-20-10 reps"},
          {"movement":"Sit-up","section":"conditioning","primaryMetric":"reps","planned":"","notes":"50-40-30-20-10 reps"},
          {"movement":"Shoulder Press","section":"conditioning","primaryMetric":"reps","planned":"1x5","notes":"80% of 1RM · after each round"}
        ]}
     ]},
     {"level":"intermediate","label":"Intermediate","groups":[
       {"kind":"circuit","section":"conditioning","rounds":5,"label":"25-20-15-10-5 / 50-40-30-20-10 (Intermediate)",
        "items":[
          {"movement":"Double-Under","section":"conditioning","primaryMetric":"reps","planned":"","notes":"25-20-15-10-5 reps or attempts"},
          {"movement":"Sit-up","section":"conditioning","primaryMetric":"reps","planned":"","notes":"50-40-30-20-10 reps"},
          {"movement":"Shoulder Press","section":"conditioning","primaryMetric":"reps","planned":"1x5","notes":"80% of 1RM · after each round"}
        ]}
     ]},
     {"level":"beginner","label":"Beginner","groups":[
       {"kind":"circuit","section":"conditioning","rounds":5,"label":"50-40-30-20-10 / 15-12-9-6-3 (Beginner)",
        "items":[
          {"movement":"Single-Under","section":"conditioning","primaryMetric":"reps","planned":"","notes":"50-40-30-20-10 reps"},
          {"movement":"Sit-up","section":"conditioning","primaryMetric":"reps","planned":"","notes":"15-12-9-6-3 reps"},
          {"movement":"Shoulder Press","section":"conditioning","primaryMetric":"reps","planned":"1x5","notes":"moderate load · after each round"}
        ]}
     ]}
   ]
 }$$::jsonb,
 'FOR_TIME', null, null, 5, false,
 'Complete 5 shoulder presses at 80% of your heaviest shoulder press after each round.',
 'CrossFit.com', 'daily/260718',
 $$50-40-30-20-10 reps for time:
Double-unders
Sit-ups
5 shoulder presses at 80% of 1RM after each round$$),

-- Fri Jul 17, 2026 — power clean build
(null, 'CrossFit · Jul 17, 2026', array['crossfit'],
 $${
   "exercises": [
     {"movement":"Power Clean","section":"primary","primaryMetric":"weight","planned":"","notes":"3-3-2-2-1-1-1-1 reps, build to heaviest set"}
   ],
   "groups": [
     {"kind":"single","section":"primary","label":"Build (Rx)",
      "items":[{"movement":"Power Clean","section":"primary","primaryMetric":"weight","planned":"","notes":"3-3-2-2-1-1-1-1 reps, build to heaviest set"}]}
   ],
   "variants": [
     {"level":"rx","label":"Rx","groups":[
       {"kind":"single","section":"primary","label":"Build (Rx)",
        "items":[{"movement":"Power Clean","section":"primary","primaryMetric":"weight","planned":"","notes":"3-3-2-2-1-1-1-1 reps, build to heaviest set"}]}
     ]},
     {"level":"beginner","label":"Beginner","groups":[
       {"kind":"single","section":"primary","label":"Build (Beginner)",
        "items":[{"movement":"Power Clean","section":"primary","primaryMetric":"weight","planned":"","notes":"3-3-3-3-3-3-3 reps, build to heaviest set"}]}
     ]}
   ]
 }$$::jsonb,
 'FOR_LOAD', null, null, null, false,
 'Build across sets using the listed rep scheme.',
 'CrossFit.com', 'daily/260717',
 $$Power clean 3-3-2-2-1-1-1-1 reps$$),

-- Wed Jul 15, 2026 — row/thruster 21-15-9
(null, 'CrossFit · Jul 15, 2026', array['crossfit'],
 $${
   "exercises": [
     {"movement":"Row","section":"conditioning","primaryMetric":"cal","planned":"","notes":"21-15-9 reps"},
     {"movement":"Thruster","section":"conditioning","primaryMetric":"reps","planned":"","notes":"21-15-9 reps · 95/65 lb"}
   ],
   "groups": [
     {"kind":"circuit","section":"conditioning","rounds":3,"label":"21-15-9 (Rx)",
      "items":[
        {"movement":"Row","section":"conditioning","primaryMetric":"cal","planned":"","notes":"21-15-9 reps"},
        {"movement":"Thruster","section":"conditioning","primaryMetric":"reps","planned":"","notes":"21-15-9 reps · 95/65 lb"}
      ]}
   ],
   "variants": [
     {"level":"rx","label":"Rx","groups":[
       {"kind":"circuit","section":"conditioning","rounds":3,"label":"21-15-9 (Rx)",
        "items":[
          {"movement":"Row","section":"conditioning","primaryMetric":"cal","planned":"","notes":"21-15-9 reps"},
          {"movement":"Thruster","section":"conditioning","primaryMetric":"reps","planned":"","notes":"21-15-9 reps · 95/65 lb"}
        ]}
     ]},
     {"level":"intermediate","label":"Intermediate","groups":[
       {"kind":"circuit","section":"conditioning","rounds":3,"label":"21-15-9 (Intermediate)",
        "items":[
          {"movement":"Row","section":"conditioning","primaryMetric":"cal","planned":"","notes":"21-15-9 reps"},
          {"movement":"Thruster","section":"conditioning","primaryMetric":"reps","planned":"","notes":"21-15-9 reps · 75/55 lb"}
        ]}
     ]},
     {"level":"beginner","label":"Beginner","groups":[
       {"kind":"circuit","section":"conditioning","rounds":3,"label":"15-12-9 (Beginner)",
        "items":[
          {"movement":"Row","section":"conditioning","primaryMetric":"cal","planned":"","notes":"15-12-9 reps"},
          {"movement":"Thruster","section":"conditioning","primaryMetric":"reps","planned":"","notes":"15-12-9 reps · 45/35 lb"}
        ]}
     ]}
   ]
 }$$::jsonb,
 'FOR_TIME', null, null, 3, false, null,
 'CrossFit.com', 'daily/260715',
 $$21-15-9 reps for time:
Calorie row
Thrusters (95/65 lb)$$),

-- Tue Jul 14, 2026 — "Jack's Triangle"
(null, 'CrossFit · Jul 14, 2026 (Jack''s Triangle)', array['crossfit'],
 $${
   "exercises": [
     {"movement":"Deadlift","section":"conditioning","primaryMetric":"reps","planned":"","notes":"max reps in 2 min · 225/155 lb"},
     {"movement":"Pull-up","section":"conditioning","primaryMetric":"reps","planned":"1x4"},
     {"movement":"Box Jump","section":"conditioning","primaryMetric":"reps","planned":"1x11","notes":"30/24 in"},
     {"movement":"Hand-Release Push-up","section":"conditioning","primaryMetric":"reps","planned":"1x13"},
     {"movement":"Bike","section":"conditioning","primaryMetric":"cal","planned":"1x23"}
   ],
   "groups": [
     {"kind":"single","section":"conditioning","label":"Max-rep deadlift (2 min, Rx)",
      "items":[{"movement":"Deadlift","section":"conditioning","primaryMetric":"reps","planned":"","notes":"max reps in 2 min · 225/155 lb"}]},
     {"kind":"circuit","section":"conditioning","rounds":1,"label":"19-min AMRAP (Rx)",
      "items":[
        {"movement":"Pull-up","section":"conditioning","primaryMetric":"reps","planned":"1x4"},
        {"movement":"Box Jump","section":"conditioning","primaryMetric":"reps","planned":"1x11","notes":"30/24 in"},
        {"movement":"Hand-Release Push-up","section":"conditioning","primaryMetric":"reps","planned":"1x13"},
        {"movement":"Bike","section":"conditioning","primaryMetric":"cal","planned":"1x23"}
      ]},
     {"kind":"single","section":"conditioning","label":"Max-rep deadlift (2 min, Rx)",
      "items":[{"movement":"Deadlift","section":"conditioning","primaryMetric":"reps","planned":"","notes":"max reps in 2 min · 225/155 lb"}]}
   ],
   "variants": [
     {"level":"rx","label":"Rx","groups":[
       {"kind":"single","section":"conditioning","label":"Max-rep deadlift (2 min, Rx)",
        "items":[{"movement":"Deadlift","section":"conditioning","primaryMetric":"reps","planned":"","notes":"max reps in 2 min · 225/155 lb"}]},
       {"kind":"circuit","section":"conditioning","rounds":1,"label":"19-min AMRAP (Rx)",
        "items":[
          {"movement":"Pull-up","section":"conditioning","primaryMetric":"reps","planned":"1x4"},
          {"movement":"Box Jump","section":"conditioning","primaryMetric":"reps","planned":"1x11","notes":"30/24 in"},
          {"movement":"Hand-Release Push-up","section":"conditioning","primaryMetric":"reps","planned":"1x13"},
          {"movement":"Bike","section":"conditioning","primaryMetric":"cal","planned":"1x23"}
        ]},
       {"kind":"single","section":"conditioning","label":"Max-rep deadlift (2 min, Rx)",
        "items":[{"movement":"Deadlift","section":"conditioning","primaryMetric":"reps","planned":"","notes":"max reps in 2 min · 225/155 lb"}]}
     ]},
     {"level":"intermediate","label":"Intermediate","groups":[
       {"kind":"single","section":"conditioning","label":"Max-rep deadlift (2 min, Intermediate)",
        "items":[{"movement":"Deadlift","section":"conditioning","primaryMetric":"reps","planned":"","notes":"max reps in 2 min · 185/135 lb"}]},
       {"kind":"circuit","section":"conditioning","rounds":1,"label":"19-min AMRAP (Intermediate)",
        "items":[
          {"movement":"Pull-up","section":"conditioning","primaryMetric":"reps","planned":"1x4"},
          {"movement":"Box Jump","section":"conditioning","primaryMetric":"reps","planned":"1x11","notes":"24/20 in"},
          {"movement":"Hand-Release Push-up","section":"conditioning","primaryMetric":"reps","planned":"1x13"},
          {"movement":"Bike","section":"conditioning","primaryMetric":"cal","planned":"1x15"}
        ]},
       {"kind":"single","section":"conditioning","label":"Max-rep deadlift (2 min, Intermediate)",
        "items":[{"movement":"Deadlift","section":"conditioning","primaryMetric":"reps","planned":"","notes":"max reps in 2 min · 185/135 lb"}]}
     ]},
     {"level":"beginner","label":"Beginner","groups":[
       {"kind":"single","section":"conditioning","label":"Max-rep deadlift (2 min, Beginner)",
        "items":[{"movement":"Deadlift","section":"conditioning","primaryMetric":"reps","planned":"","notes":"max reps in 2 min · 75/55 lb"}]},
       {"kind":"circuit","section":"conditioning","rounds":1,"restSeconds":45,"label":"19-min AMRAP (Beginner)",
        "items":[
          {"movement":"Foot-Assisted Pull-up","section":"conditioning","primaryMetric":"reps","planned":"1x4"},
          {"movement":"Box Jump","section":"conditioning","primaryMetric":"reps","planned":"1x6","notes":"12/6 in"},
          {"movement":"Hand-Elevated Push-up","section":"conditioning","primaryMetric":"reps","planned":"1x8"},
          {"movement":"Bike","section":"conditioning","primaryMetric":"cal","planned":"1x12"}
        ]},
       {"kind":"single","section":"conditioning","label":"Max-rep deadlift (2 min, Beginner)",
        "items":[{"movement":"Deadlift","section":"conditioning","primaryMetric":"reps","planned":"","notes":"max reps in 2 min · 75/55 lb"}]}
     ]}
   ]
 }$$::jsonb,
 'FOR_TOTAL_REPS', null, 1380, null, false,
 'For total reps: two 2-minute max-rep deadlift efforts bookend a 19-minute AMRAP, with no rest between the three parts.',
 'CrossFit.com', 'daily/260714',
 $$As many reps as possible in 2 minutes of max-rep deadlifts (225/155 lb)
Then, AMRAP in 19 minutes of:
4 strict pull-ups
11 box jumps (30/24 in)
13 hand-release push-ups
23-calorie bike
Then, as many reps as possible in 2 minutes of max-rep deadlifts
No rest between parts$$),

-- Mon Jul 13, 2026 — DB box step-up / run (vest)
(null, 'CrossFit · Jul 13, 2026', array['crossfit'],
 $${
   "exercises": [
     {"movement":"Dumbbell Box Step-up","section":"conditioning","primaryMetric":"reps","planned":"1x20","notes":"50-lb dumbbells, 20-in box, 20-lb vest"},
     {"movement":"Run","section":"conditioning","primaryMetric":"distance","planned":"1x400m","notes":"wearing a 20-lb vest"}
   ],
   "groups": [
     {"kind":"circuit","section":"conditioning","rounds":3,"label":"Round (3×, Rx)",
      "items":[
        {"movement":"Dumbbell Box Step-up","section":"conditioning","primaryMetric":"reps","planned":"1x20","notes":"50-lb dumbbells, 20-in box, 20-lb vest"},
        {"movement":"Run","section":"conditioning","primaryMetric":"distance","planned":"1x400m","notes":"wearing a 20-lb vest"}
      ]}
   ],
   "variants": [
     {"level":"rx","label":"Rx","groups":[
       {"kind":"circuit","section":"conditioning","rounds":3,"label":"Round (3×, Rx)",
        "items":[
          {"movement":"Dumbbell Box Step-up","section":"conditioning","primaryMetric":"reps","planned":"1x20","notes":"50-lb dumbbells, 20-in box, 20-lb vest"},
          {"movement":"Run","section":"conditioning","primaryMetric":"distance","planned":"1x400m","notes":"wearing a 20-lb vest"}
        ]}
     ]},
     {"level":"intermediate","label":"Intermediate","groups":[
       {"kind":"circuit","section":"conditioning","rounds":3,"label":"Round (3×, Intermediate)",
        "items":[
          {"movement":"Dumbbell Box Step-up","section":"conditioning","primaryMetric":"reps","planned":"1x20","notes":"35-lb dumbbells, 20-in box, no vest"},
          {"movement":"Run","section":"conditioning","primaryMetric":"distance","planned":"1x400m"}
        ]}
     ]},
     {"level":"beginner","label":"Beginner","groups":[
       {"kind":"circuit","section":"conditioning","rounds":3,"label":"Round (3×, Beginner)",
        "items":[
          {"movement":"Box Step-up","section":"conditioning","primaryMetric":"reps","planned":"1x20","notes":"18-in box, bodyweight"},
          {"movement":"Run","section":"conditioning","primaryMetric":"distance","planned":"1x200m"}
        ]}
     ]}
   ]
 }$$::jsonb,
 'ROUNDS_FOR_TIME', null, null, 3, false, null,
 'CrossFit.com', 'daily/260713',
 $$3 rounds for time:
20 dumbbell box step-ups
400-meter run
All movements done wearing a vest (50-lb dumbbells, 20-in box, 20-lb vest)$$),

-- Sat Jul 11, 2026 — Open Workout 20.5
(null, 'CrossFit · Jul 11, 2026 (Open 20.5)', array['crossfit'],
 $${
   "exercises": [
     {"movement":"Muscle-up","section":"conditioning","primaryMetric":"reps","planned":"1x40"},
     {"movement":"Row","section":"conditioning","primaryMetric":"cal","planned":"1x80"},
     {"movement":"Wall Ball","section":"conditioning","primaryMetric":"reps","planned":"1x120","notes":"20-lb ball to 10-ft target"}
   ],
   "groups": [
     {"kind":"circuit","section":"conditioning","rounds":1,"label":"Partitioned any way (Rx)",
      "items":[
        {"movement":"Muscle-up","section":"conditioning","primaryMetric":"reps","planned":"1x40"},
        {"movement":"Row","section":"conditioning","primaryMetric":"cal","planned":"1x80"},
        {"movement":"Wall Ball","section":"conditioning","primaryMetric":"reps","planned":"1x120","notes":"20-lb ball to 10-ft target"}
      ]}
   ],
   "variants": [
     {"level":"rx","label":"Rx","groups":[
       {"kind":"circuit","section":"conditioning","rounds":1,"label":"Partitioned any way (Rx)",
        "items":[
          {"movement":"Muscle-up","section":"conditioning","primaryMetric":"reps","planned":"1x40"},
          {"movement":"Row","section":"conditioning","primaryMetric":"cal","planned":"1x80"},
          {"movement":"Wall Ball","section":"conditioning","primaryMetric":"reps","planned":"1x120","notes":"20-lb ball to 10-ft target"}
        ]}
     ]},
     {"level":"intermediate","label":"Intermediate","groups":[
       {"kind":"circuit","section":"conditioning","rounds":1,"label":"Partitioned any way (Intermediate)",
        "items":[
          {"movement":"Chest-to-Bar Pull-up","section":"conditioning","primaryMetric":"reps","planned":"1x40"},
          {"movement":"Row","section":"conditioning","primaryMetric":"cal","planned":"1x80"},
          {"movement":"Wall Ball","section":"conditioning","primaryMetric":"reps","planned":"1x120","notes":"14-lb ball to 10-ft target"}
        ]}
     ]},
     {"level":"beginner","label":"Beginner","groups":[
       {"kind":"circuit","section":"conditioning","rounds":1,"label":"Partitioned any way (Beginner)",
        "items":[
          {"movement":"Jumping Pull-up","section":"conditioning","primaryMetric":"reps","planned":"1x40"},
          {"movement":"Row","section":"conditioning","primaryMetric":"cal","planned":"1x50"},
          {"movement":"Wall Ball","section":"conditioning","primaryMetric":"reps","planned":"1x60","notes":"10-lb ball to 9-ft target"}
        ]}
     ]}
   ]
 }$$::jsonb,
 'FOR_TIME', 1200, null, null, false,
 'Partition the reps of each movement however you like within the time cap.',
 'CrossFit.com', 'daily/260711',
 $$For time, partitioned any way:
40 muscle-ups
80-calorie row
120 wall-ball shots (20-lb ball, 10-ft target)
Time cap: 20 minutes$$),

-- Fri Jul 10, 2026 — burpee box jump-over / deadlift ascending
(null, 'CrossFit · Jul 10, 2026', array['crossfit'],
 $${
   "exercises": [
     {"movement":"Burpee Box Jump-Over","section":"conditioning","primaryMetric":"reps","planned":"","notes":"ascending by 3s: 3,6,9…"},
     {"movement":"Deadlift","section":"conditioning","primaryMetric":"reps","planned":"","notes":"ascending by 3s: 3,6,9… · 225/155 lb"}
   ],
   "groups": [
     {"kind":"circuit","section":"conditioning","rounds":1,"label":"Ascending AMRAP (Rx)",
      "items":[
        {"movement":"Burpee Box Jump-Over","section":"conditioning","primaryMetric":"reps","planned":"","notes":"ascending by 3s: 3,6,9…"},
        {"movement":"Deadlift","section":"conditioning","primaryMetric":"reps","planned":"","notes":"ascending by 3s: 3,6,9… · 225/155 lb"}
      ]}
   ],
   "variants": [
     {"level":"rx","label":"Rx","groups":[
       {"kind":"circuit","section":"conditioning","rounds":1,"label":"Ascending AMRAP (Rx)",
        "items":[
          {"movement":"Burpee Box Jump-Over","section":"conditioning","primaryMetric":"reps","planned":"","notes":"ascending by 3s: 3,6,9… · 24-in box"},
          {"movement":"Deadlift","section":"conditioning","primaryMetric":"reps","planned":"","notes":"ascending by 3s: 3,6,9… · 225/155 lb"}
        ]}
     ]},
     {"level":"intermediate","label":"Intermediate","groups":[
       {"kind":"circuit","section":"conditioning","rounds":1,"label":"Ascending AMRAP (Intermediate)",
        "items":[
          {"movement":"Burpee Box Jump-Over","section":"conditioning","primaryMetric":"reps","planned":"","notes":"ascending by 3s: 3,6,9… · 24-in box"},
          {"movement":"Deadlift","section":"conditioning","primaryMetric":"reps","planned":"","notes":"ascending by 3s: 3,6,9… · 155/105 lb"}
        ]}
     ]},
     {"level":"beginner","label":"Beginner","groups":[
       {"kind":"circuit","section":"conditioning","rounds":1,"label":"Ascending AMRAP (Beginner)",
        "items":[
          {"movement":"Burpee Box Step-Over","section":"conditioning","primaryMetric":"reps","planned":"","notes":"ascending by 3s: 3,6,9… · 20/12-in box"},
          {"movement":"Deadlift","section":"conditioning","primaryMetric":"reps","planned":"","notes":"ascending by 3s: 3,6,9… · 75/55 lb"}
        ]}
     ]}
   ]
 }$$::jsonb,
 'AMRAP', 600, null, null, false,
 'Ascending reps each round (3, 6, 9…) of both movements, continuing until the 10-minute cap.',
 'CrossFit.com', 'daily/260710',
 $$Max reps in 10 minutes:
3 burpee box jump-overs, 3 deadlifts
6 burpee box jump-overs, 6 deadlifts
9 burpee box jump-overs, 9 deadlifts
etc. (225/155-lb deadlift)$$),

-- Wed Jul 8, 2026 — push press / toes-to-bar
(null, 'CrossFit · Jul 8, 2026', array['crossfit'],
 $${
   "exercises": [
     {"movement":"Push Press","section":"conditioning","primaryMetric":"reps","planned":"1x15","notes":"155/105 lb"},
     {"movement":"Toes-to-Bar","section":"conditioning","primaryMetric":"reps","planned":"1x20"}
   ],
   "groups": [
     {"kind":"circuit","section":"conditioning","rounds":5,"label":"Round (5×, Rx)",
      "items":[
        {"movement":"Push Press","section":"conditioning","primaryMetric":"reps","planned":"1x15","notes":"155/105 lb"},
        {"movement":"Toes-to-Bar","section":"conditioning","primaryMetric":"reps","planned":"1x20"}
      ]}
   ],
   "variants": [
     {"level":"rx","label":"Rx","groups":[
       {"kind":"circuit","section":"conditioning","rounds":5,"label":"Round (5×, Rx)",
        "items":[
          {"movement":"Push Press","section":"conditioning","primaryMetric":"reps","planned":"1x15","notes":"155/105 lb"},
          {"movement":"Toes-to-Bar","section":"conditioning","primaryMetric":"reps","planned":"1x20"}
        ]}
     ]},
     {"level":"intermediate","label":"Intermediate","groups":[
       {"kind":"circuit","section":"conditioning","rounds":5,"label":"Round (5×, Intermediate)",
        "items":[
          {"movement":"Push Press","section":"conditioning","primaryMetric":"reps","planned":"1x15","notes":"115/75 lb"},
          {"movement":"Hanging Knee Raise","section":"conditioning","primaryMetric":"reps","planned":"1x20","notes":"to chest height"}
        ]}
     ]},
     {"level":"beginner","label":"Beginner","groups":[
       {"kind":"circuit","section":"conditioning","rounds":5,"label":"Round (5×, Beginner)",
        "items":[
          {"movement":"Push Press","section":"conditioning","primaryMetric":"reps","planned":"1x10","notes":"45/35 lb"},
          {"movement":"Hanging Knee Raise","section":"conditioning","primaryMetric":"reps","planned":"1x10"}
        ]}
     ]}
   ]
 }$$::jsonb,
 'ROUNDS_FOR_TIME', null, null, 5, false, null,
 'CrossFit.com', 'daily/260708',
 $$5 rounds for time:
15 push presses (155/105 lb)
20 toes-to-bars$$),

-- Tue Jul 7, 2026 — front squat build
(null, 'CrossFit · Jul 7, 2026', array['crossfit'],
 $${
   "exercises": [
     {"movement":"Front Squat","section":"primary","primaryMetric":"weight","planned":"5x3","notes":"build to a heavy set of 3"}
   ],
   "groups": [
     {"kind":"single","section":"primary","label":"Build (Rx)",
      "items":[{"movement":"Front Squat","section":"primary","primaryMetric":"weight","planned":"5x3","notes":"build to a heavy set of 3"}]}
   ],
   "variants": [
     {"level":"rx","label":"Rx","groups":[
       {"kind":"single","section":"primary","label":"Build (Rx)",
        "items":[{"movement":"Front Squat","section":"primary","primaryMetric":"weight","planned":"5x3","notes":"build to a heavy set of 3"}]}
     ]}
   ]
 }$$::jsonb,
 'FOR_LOAD', null, null, null, false,
 'Build to a heavy set of 3.',
 'CrossFit.com', 'daily/260707',
 $$Front squat 3-3-3-3-3 reps$$),

-- Mon Jul 6, 2026 — power snatch / rope climb descending
(null, 'CrossFit · Jul 6, 2026', array['crossfit'],
 $${
   "exercises": [
     {"movement":"Power Snatch","section":"conditioning","primaryMetric":"reps","planned":"","notes":"15-12-9-6-3 reps · 135/95 lb"},
     {"movement":"Rope Climb","section":"conditioning","primaryMetric":"reps","planned":"","notes":"5-4-3-2-1 reps · climb to 15 ft"}
   ],
   "groups": [
     {"kind":"circuit","section":"conditioning","rounds":5,"label":"Descending ladder (Rx)",
      "items":[
        {"movement":"Power Snatch","section":"conditioning","primaryMetric":"reps","planned":"","notes":"15-12-9-6-3 reps · 135/95 lb"},
        {"movement":"Rope Climb","section":"conditioning","primaryMetric":"reps","planned":"","notes":"5-4-3-2-1 reps · climb to 15 ft"}
      ]}
   ],
   "variants": [
     {"level":"rx","label":"Rx","groups":[
       {"kind":"circuit","section":"conditioning","rounds":5,"label":"Descending ladder (Rx)",
        "items":[
          {"movement":"Power Snatch","section":"conditioning","primaryMetric":"reps","planned":"","notes":"15-12-9-6-3 reps · 135/95 lb"},
          {"movement":"Rope Climb","section":"conditioning","primaryMetric":"reps","planned":"","notes":"5-4-3-2-1 reps · climb to 15 ft"}
        ]}
     ]},
     {"level":"intermediate","label":"Intermediate","groups":[
       {"kind":"circuit","section":"conditioning","rounds":5,"label":"Descending ladder (Intermediate)",
        "items":[
          {"movement":"Power Snatch","section":"conditioning","primaryMetric":"reps","planned":"","notes":"15-12-9-6-3 reps · 95/65 lb"},
          {"movement":"Rope Climb","section":"conditioning","primaryMetric":"reps","planned":"","notes":"3-3-2-2-1 reps · climb to 12 ft"}
        ]}
     ]},
     {"level":"beginner","label":"Beginner","groups":[
       {"kind":"circuit","section":"conditioning","rounds":5,"label":"Descending ladder (Beginner)",
        "items":[
          {"movement":"Hang Power Snatch","section":"conditioning","primaryMetric":"reps","planned":"","notes":"15-12-9-6-3 reps · 45/35 lb"},
          {"movement":"Pull-to-Stand","section":"conditioning","primaryMetric":"reps","planned":"","notes":"3-3-3-3-3 reps"}
        ]}
     ]}
   ]
 }$$::jsonb,
 'FOR_TIME', null, null, 5, false, null,
 'CrossFit.com', 'daily/260706',
 $$For time:
15 power snatches, 5 rope climbs to 15 ft
12 power snatches, 4 rope climbs
9 power snatches, 3 rope climbs
6 power snatches, 2 rope climbs
3 power snatches, 1 rope climb
(135/95-lb barbell)$$),

-- Sat Jul 4, 2026 — "Eva Strong" (partner)
(null, 'CrossFit · Jul 4, 2026 (Eva Strong)', array['crossfit'],
 $${
   "exercises": [
     {"movement":"Double-Under","section":"conditioning","primaryMetric":"reps","planned":"1x24","notes":"each partner"},
     {"movement":"Toes-to-Bar","section":"conditioning","primaryMetric":"reps","planned":"1x19","notes":"total, shared"},
     {"movement":"Clean and Jerk","section":"conditioning","primaryMetric":"reps","planned":"1x2","notes":"total, shared · 205/135 lb"},
     {"movement":"Run","section":"conditioning","primaryMetric":"distance","planned":"1x400m","notes":"together"}
   ],
   "groups": [
     {"kind":"circuit","section":"conditioning","rounds":5,"label":"Partner round (5×, Rx)",
      "items":[
        {"movement":"Double-Under","section":"conditioning","primaryMetric":"reps","planned":"1x24","notes":"each partner"},
        {"movement":"Toes-to-Bar","section":"conditioning","primaryMetric":"reps","planned":"1x19","notes":"total, shared"},
        {"movement":"Clean and Jerk","section":"conditioning","primaryMetric":"reps","planned":"1x2","notes":"total, shared · 205/135 lb"},
        {"movement":"Run","section":"conditioning","primaryMetric":"distance","planned":"1x400m","notes":"together"}
      ]}
   ],
   "variants": [
     {"level":"rx","label":"Rx","groups":[
       {"kind":"circuit","section":"conditioning","rounds":5,"label":"Partner round (5×, Rx)",
        "items":[
          {"movement":"Double-Under","section":"conditioning","primaryMetric":"reps","planned":"1x24","notes":"each partner"},
          {"movement":"Toes-to-Bar","section":"conditioning","primaryMetric":"reps","planned":"1x19","notes":"total, shared"},
          {"movement":"Clean and Jerk","section":"conditioning","primaryMetric":"reps","planned":"1x2","notes":"total, shared · 205/135 lb"},
          {"movement":"Run","section":"conditioning","primaryMetric":"distance","planned":"1x400m","notes":"together"}
        ]}
     ]},
     {"level":"intermediate","label":"Intermediate","groups":[
       {"kind":"circuit","section":"conditioning","rounds":5,"label":"Partner round (5×, Intermediate)",
        "items":[
          {"movement":"Double-Under","section":"conditioning","primaryMetric":"reps","planned":"1x12","notes":"each partner"},
          {"movement":"Toes-to-Bar","section":"conditioning","primaryMetric":"reps","planned":"1x19","notes":"total, shared"},
          {"movement":"Clean and Jerk","section":"conditioning","primaryMetric":"reps","planned":"1x2","notes":"total, shared · 155/105 lb"},
          {"movement":"Run","section":"conditioning","primaryMetric":"distance","planned":"1x400m","notes":"together"}
        ]}
     ]},
     {"level":"beginner","label":"Beginner","groups":[
       {"kind":"circuit","section":"conditioning","rounds":5,"label":"Partner round (5×, Beginner)",
        "items":[
          {"movement":"Single-Under","section":"conditioning","primaryMetric":"reps","planned":"1x24","notes":"each partner"},
          {"movement":"Hanging Knee Raise","section":"conditioning","primaryMetric":"reps","planned":"1x19","notes":"total, shared"},
          {"movement":"Clean and Jerk","section":"conditioning","primaryMetric":"reps","planned":"1x2","notes":"total, shared · 45/35 lb"},
          {"movement":"Run","section":"conditioning","primaryMetric":"distance","planned":"1x200m","notes":"each partner"}
        ]}
     ]}
   ]
 }$$::jsonb,
 'ROUNDS_FOR_TIME', null, null, 5, true,
 'Partner workout: share reps of each movement as you like; complete the run together.',
 'CrossFit.com', 'daily/260704',
 $$With a partner, 5 rounds for time:
24 double-unders (each)
19 toes-to-bars (total)
2 clean and jerks (total, 205/135 lb)
400-meter run (together)$$)

on conflict (source, source_ref) where source_ref is not null do nothing;
