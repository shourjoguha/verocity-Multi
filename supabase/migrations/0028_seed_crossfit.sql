-- Verocity v2 — seed the shared movement library and 8 classic CrossFit
-- benchmark WODs, each with Rx / Intermediate / Beginner scaling variants.
--
-- Movements and sessions are both shared-library rows (owner_user_id IS
-- NULL), mirroring the pattern from 0023/0024 for Hyrox. Movements are keyed
-- by lowercased name via `movements_shared_name_unique` (0023), so the ON
-- CONFLICT clause makes Part A idempotent; a second apply is a no-op.
-- Sessions are keyed by (source, source_ref) via `sessions_source_ref_unique`
-- (0027), so Part B is idempotent too — a re-import is a no-op.
--
-- Frame shape: each session's `frame` carries `variants[]` (added for
-- CrossFit-style scaling — see src/lib/types.ts SessionVariant). Each variant
-- is one `groups[]` array holding a single circuit group. The top-level
-- `exercises`/`groups` stay a flat/grouped mirror of the Rx variant, for
-- readers that predate `variants`.
--
-- Source: CrossFit.com benchmark WOD descriptions ("the Girls"), transcribed
-- verbatim in `source_text`; scaling loads/reps for Intermediate/Beginner are
-- the CrossFit.com-published scaling guidance for these benchmarks.

-- ---- 1. Shared movements (new to this migration) ---------------------------
-- Wall Ball, Air Squat, Push-up, Sit-up already exist from 0024 — not re-inserted.
insert into public.movements (name, primary_metric, default_metrics, owner_user_id)
values
  ('Thruster',            'weight', array['reps','weight'], null),
  ('Pull-up',             'reps',   array['reps'],          null),
  ('Banded Pull-up',      'reps',   array['reps'],          null),
  ('Ring Row',            'reps',   array['reps'],          null),
  ('Deadlift',            'weight', array['reps','weight'], null),
  ('Handstand Push-up',   'reps',   array['reps'],          null),
  ('Pike Push-up',        'reps',   array['reps'],          null),
  ('Clean and Jerk',      'weight', array['reps','weight'], null),
  ('Double-Under',        'reps',   array['reps'],          null),
  ('Single-Under',        'reps',   array['reps'],          null),
  ('Knee Push-up',        'reps',   array['reps'],          null)
on conflict (lower(name)) where owner_user_id is null do nothing;

-- ---- 2. Shared CrossFit sessions -------------------------------------------

insert into public.sessions
  (owner_user_id, name, tags, frame, session_type, time_cap_seconds,
   duration_seconds, rounds, partner, instructions, source, source_ref, source_text)
values
-- FRAN
(null, 'Fran', array['crossfit'],
 $${
   "exercises": [
     {"movement":"Thruster","section":"conditioning","primaryMetric":"reps","planned":"","notes":"21-15-9 reps · 95/65 lb"},
     {"movement":"Pull-up","section":"conditioning","primaryMetric":"reps","planned":"","notes":"21-15-9 reps"}
   ],
   "groups": [
     {"kind":"circuit","section":"conditioning","rounds":3,"label":"21-15-9 (Rx)",
      "items":[
        {"movement":"Thruster","section":"conditioning","primaryMetric":"reps","planned":"","notes":"21-15-9 reps · 95/65 lb"},
        {"movement":"Pull-up","section":"conditioning","primaryMetric":"reps","planned":"","notes":"21-15-9 reps"}
      ]}
   ],
   "variants": [
     {"level":"rx","label":"Rx","groups":[
       {"kind":"circuit","section":"conditioning","rounds":3,"label":"21-15-9 (Rx)",
        "items":[
          {"movement":"Thruster","section":"conditioning","primaryMetric":"reps","planned":"","notes":"21-15-9 reps · 95/65 lb"},
          {"movement":"Pull-up","section":"conditioning","primaryMetric":"reps","planned":"","notes":"21-15-9 reps"}
        ]}
     ]},
     {"level":"intermediate","label":"Intermediate","groups":[
       {"kind":"circuit","section":"conditioning","rounds":3,"label":"21-15-9 (Intermediate)",
        "items":[
          {"movement":"Thruster","section":"conditioning","primaryMetric":"reps","planned":"","notes":"21-15-9 reps · 65/45 lb"},
          {"movement":"Banded Pull-up","section":"conditioning","primaryMetric":"reps","planned":"","notes":"21-15-9 reps"}
        ]}
     ]},
     {"level":"beginner","label":"Beginner","groups":[
       {"kind":"circuit","section":"conditioning","rounds":3,"label":"21-15-9 (Beginner)",
        "items":[
          {"movement":"Thruster","section":"conditioning","primaryMetric":"reps","planned":"","notes":"21-15-9 reps · 45/35 lb"},
          {"movement":"Ring Row","section":"conditioning","primaryMetric":"reps","planned":"","notes":"21-15-9 reps"}
        ]}
     ]}
   ]
 }$$::jsonb,
 'FOR_TIME', null, null, 3, false,
 '21-15-9 reps for time of Thrusters and Pull-Ups.',
 'CrossFit.com', 'benchmark/fran',
 $$21-15-9 reps for time:
Thrusters (95/65 lb)
Pull-Ups$$),

-- CINDY
(null, 'Cindy', array['crossfit'],
 $${
   "exercises": [
     {"movement":"Pull-up","section":"conditioning","primaryMetric":"reps","planned":"1x5"},
     {"movement":"Push-up","section":"conditioning","primaryMetric":"reps","planned":"1x10"},
     {"movement":"Air Squat","section":"conditioning","primaryMetric":"reps","planned":"1x15"}
   ],
   "groups": [
     {"kind":"circuit","section":"conditioning","rounds":1,"label":"AMRAP round (Rx)",
      "items":[
        {"movement":"Pull-up","section":"conditioning","primaryMetric":"reps","planned":"1x5"},
        {"movement":"Push-up","section":"conditioning","primaryMetric":"reps","planned":"1x10"},
        {"movement":"Air Squat","section":"conditioning","primaryMetric":"reps","planned":"1x15"}
      ]}
   ],
   "variants": [
     {"level":"rx","label":"Rx","groups":[
       {"kind":"circuit","section":"conditioning","rounds":1,"label":"AMRAP round (Rx)",
        "items":[
          {"movement":"Pull-up","section":"conditioning","primaryMetric":"reps","planned":"1x5"},
          {"movement":"Push-up","section":"conditioning","primaryMetric":"reps","planned":"1x10"},
          {"movement":"Air Squat","section":"conditioning","primaryMetric":"reps","planned":"1x15"}
        ]}
     ]},
     {"level":"intermediate","label":"Intermediate","groups":[
       {"kind":"circuit","section":"conditioning","rounds":1,"label":"AMRAP round (Intermediate)",
        "items":[
          {"movement":"Banded Pull-up","section":"conditioning","primaryMetric":"reps","planned":"1x5"},
          {"movement":"Push-up","section":"conditioning","primaryMetric":"reps","planned":"1x10"},
          {"movement":"Air Squat","section":"conditioning","primaryMetric":"reps","planned":"1x15"}
        ]}
     ]},
     {"level":"beginner","label":"Beginner","groups":[
       {"kind":"circuit","section":"conditioning","rounds":1,"label":"AMRAP round (Beginner)",
        "items":[
          {"movement":"Ring Row","section":"conditioning","primaryMetric":"reps","planned":"1x5"},
          {"movement":"Knee Push-up","section":"conditioning","primaryMetric":"reps","planned":"1x10"},
          {"movement":"Air Squat","section":"conditioning","primaryMetric":"reps","planned":"1x15"}
        ]}
     ]}
   ]
 }$$::jsonb,
 'AMRAP', null, 1200, 1, false,
 'AMRAP in 20 minutes. Score = total rounds + reps.',
 'CrossFit.com', 'benchmark/cindy',
 $$AMRAP in 20 minutes:
5 Pull-Ups
10 Push-Ups
15 Air Squats$$),

-- DIANE
(null, 'Diane', array['crossfit'],
 $${
   "exercises": [
     {"movement":"Deadlift","section":"conditioning","primaryMetric":"reps","planned":"","notes":"21-15-9 reps · 225/155 lb"},
     {"movement":"Handstand Push-up","section":"conditioning","primaryMetric":"reps","planned":"","notes":"21-15-9 reps"}
   ],
   "groups": [
     {"kind":"circuit","section":"conditioning","rounds":3,"label":"21-15-9 (Rx)",
      "items":[
        {"movement":"Deadlift","section":"conditioning","primaryMetric":"reps","planned":"","notes":"21-15-9 reps · 225/155 lb"},
        {"movement":"Handstand Push-up","section":"conditioning","primaryMetric":"reps","planned":"","notes":"21-15-9 reps"}
      ]}
   ],
   "variants": [
     {"level":"rx","label":"Rx","groups":[
       {"kind":"circuit","section":"conditioning","rounds":3,"label":"21-15-9 (Rx)",
        "items":[
          {"movement":"Deadlift","section":"conditioning","primaryMetric":"reps","planned":"","notes":"21-15-9 reps · 225/155 lb"},
          {"movement":"Handstand Push-up","section":"conditioning","primaryMetric":"reps","planned":"","notes":"21-15-9 reps"}
        ]}
     ]},
     {"level":"intermediate","label":"Intermediate","groups":[
       {"kind":"circuit","section":"conditioning","rounds":3,"label":"21-15-9 (Intermediate)",
        "items":[
          {"movement":"Deadlift","section":"conditioning","primaryMetric":"reps","planned":"","notes":"21-15-9 reps · 155/105 lb"},
          {"movement":"Pike Push-up","section":"conditioning","primaryMetric":"reps","planned":"","notes":"21-15-9 reps"}
        ]}
     ]},
     {"level":"beginner","label":"Beginner","groups":[
       {"kind":"circuit","section":"conditioning","rounds":3,"label":"21-15-9 (Beginner)",
        "items":[
          {"movement":"Deadlift","section":"conditioning","primaryMetric":"reps","planned":"","notes":"21-15-9 reps · 95/65 lb"},
          {"movement":"Push-up","section":"conditioning","primaryMetric":"reps","planned":"","notes":"21-15-9 reps"}
        ]}
     ]}
   ]
 }$$::jsonb,
 'FOR_TIME', null, null, 3, false, null,
 'CrossFit.com', 'benchmark/diane',
 $$21-15-9 reps for time:
Deadlifts (225/155 lb)
Handstand Push-Ups$$),

-- GRACE
(null, 'Grace', array['crossfit'],
 $${
   "exercises": [
     {"movement":"Clean and Jerk","section":"conditioning","primaryMetric":"reps","planned":"1x30","notes":"135/95 lb"}
   ],
   "groups": [
     {"kind":"circuit","section":"conditioning","rounds":1,"label":"30 reps (Rx)",
      "items":[
        {"movement":"Clean and Jerk","section":"conditioning","primaryMetric":"reps","planned":"1x30","notes":"135/95 lb"}
      ]}
   ],
   "variants": [
     {"level":"rx","label":"Rx","groups":[
       {"kind":"circuit","section":"conditioning","rounds":1,"label":"30 reps (Rx)",
        "items":[
          {"movement":"Clean and Jerk","section":"conditioning","primaryMetric":"reps","planned":"1x30","notes":"135/95 lb"}
        ]}
     ]},
     {"level":"intermediate","label":"Intermediate","groups":[
       {"kind":"circuit","section":"conditioning","rounds":1,"label":"30 reps (Intermediate)",
        "items":[
          {"movement":"Clean and Jerk","section":"conditioning","primaryMetric":"reps","planned":"1x30","notes":"95/65 lb"}
        ]}
     ]},
     {"level":"beginner","label":"Beginner","groups":[
       {"kind":"circuit","section":"conditioning","rounds":1,"label":"30 reps (Beginner)",
        "items":[
          {"movement":"Clean and Jerk","section":"conditioning","primaryMetric":"reps","planned":"1x30","notes":"75/55 lb"}
        ]}
     ]}
   ]
 }$$::jsonb,
 'FOR_TIME', null, null, 1, false, null,
 'CrossFit.com', 'benchmark/grace',
 $$For time:
30 Clean and Jerks (135/95 lb)$$),

-- KAREN
(null, 'Karen', array['crossfit'],
 $${
   "exercises": [
     {"movement":"Wall Ball","section":"conditioning","primaryMetric":"reps","planned":"1x150","notes":"20/14 lb"}
   ],
   "groups": [
     {"kind":"circuit","section":"conditioning","rounds":1,"label":"150 reps (Rx)",
      "items":[
        {"movement":"Wall Ball","section":"conditioning","primaryMetric":"reps","planned":"1x150","notes":"20/14 lb"}
      ]}
   ],
   "variants": [
     {"level":"rx","label":"Rx","groups":[
       {"kind":"circuit","section":"conditioning","rounds":1,"label":"150 reps (Rx)",
        "items":[
          {"movement":"Wall Ball","section":"conditioning","primaryMetric":"reps","planned":"1x150","notes":"20/14 lb"}
        ]}
     ]},
     {"level":"intermediate","label":"Intermediate","groups":[
       {"kind":"circuit","section":"conditioning","rounds":1,"label":"150 reps (Intermediate)",
        "items":[
          {"movement":"Wall Ball","section":"conditioning","primaryMetric":"reps","planned":"1x150","notes":"14/10 lb"}
        ]}
     ]},
     {"level":"beginner","label":"Beginner","groups":[
       {"kind":"circuit","section":"conditioning","rounds":1,"label":"100 reps (Beginner)",
        "items":[
          {"movement":"Wall Ball","section":"conditioning","primaryMetric":"reps","planned":"1x100","notes":"10/8 lb"}
        ]}
     ]}
   ]
 }$$::jsonb,
 'FOR_TIME', null, null, 1, false, null,
 'CrossFit.com', 'benchmark/karen',
 $$For time:
150 Wall Ball Shots (20/14 lb)$$),

-- ANNIE
(null, 'Annie', array['crossfit'],
 $${
   "exercises": [
     {"movement":"Double-Under","section":"conditioning","primaryMetric":"reps","planned":"","notes":"50-40-30-20-10 reps"},
     {"movement":"Sit-up","section":"conditioning","primaryMetric":"reps","planned":"","notes":"50-40-30-20-10 reps"}
   ],
   "groups": [
     {"kind":"circuit","section":"conditioning","rounds":5,"label":"50-40-30-20-10 (Rx)",
      "items":[
        {"movement":"Double-Under","section":"conditioning","primaryMetric":"reps","planned":"","notes":"50-40-30-20-10 reps"},
        {"movement":"Sit-up","section":"conditioning","primaryMetric":"reps","planned":"","notes":"50-40-30-20-10 reps"}
      ]}
   ],
   "variants": [
     {"level":"rx","label":"Rx","groups":[
       {"kind":"circuit","section":"conditioning","rounds":5,"label":"50-40-30-20-10 (Rx)",
        "items":[
          {"movement":"Double-Under","section":"conditioning","primaryMetric":"reps","planned":"","notes":"50-40-30-20-10 reps"},
          {"movement":"Sit-up","section":"conditioning","primaryMetric":"reps","planned":"","notes":"50-40-30-20-10 reps"}
        ]}
     ]},
     {"level":"intermediate","label":"Intermediate","groups":[
       {"kind":"circuit","section":"conditioning","rounds":5,"label":"50-40-30-20-10 (Intermediate)",
        "items":[
          {"movement":"Double-Under","section":"conditioning","primaryMetric":"reps","planned":"","notes":"50-40-30-20-10 reps"},
          {"movement":"Sit-up","section":"conditioning","primaryMetric":"reps","planned":"","notes":"50-40-30-20-10 reps"}
        ]}
     ]},
     {"level":"beginner","label":"Beginner","groups":[
       {"kind":"circuit","section":"conditioning","rounds":5,"label":"50-40-30-20-10 (Beginner)",
        "items":[
          {"movement":"Single-Under","section":"conditioning","primaryMetric":"reps","planned":"","notes":"100-80-60-40-20 reps (2× singles)"},
          {"movement":"Sit-up","section":"conditioning","primaryMetric":"reps","planned":"","notes":"50-40-30-20-10 reps"}
        ]}
     ]}
   ]
 }$$::jsonb,
 'FOR_TIME', null, null, 5, false, null,
 'CrossFit.com', 'benchmark/annie',
 $$50-40-30-20-10 reps for time:
Double-Unders
Sit-Ups$$),

-- BARBARA
(null, 'Barbara', array['crossfit'],
 $${
   "exercises": [
     {"movement":"Pull-up","section":"conditioning","primaryMetric":"reps","planned":"1x20"},
     {"movement":"Push-up","section":"conditioning","primaryMetric":"reps","planned":"1x30"},
     {"movement":"Sit-up","section":"conditioning","primaryMetric":"reps","planned":"1x40"},
     {"movement":"Air Squat","section":"conditioning","primaryMetric":"reps","planned":"1x50"}
   ],
   "groups": [
     {"kind":"circuit","section":"conditioning","rounds":5,"restSeconds":180,"label":"Round (5×, Rx)",
      "items":[
        {"movement":"Pull-up","section":"conditioning","primaryMetric":"reps","planned":"1x20"},
        {"movement":"Push-up","section":"conditioning","primaryMetric":"reps","planned":"1x30"},
        {"movement":"Sit-up","section":"conditioning","primaryMetric":"reps","planned":"1x40"},
        {"movement":"Air Squat","section":"conditioning","primaryMetric":"reps","planned":"1x50"}
      ]}
   ],
   "variants": [
     {"level":"rx","label":"Rx","groups":[
       {"kind":"circuit","section":"conditioning","rounds":5,"restSeconds":180,"label":"Round (5×, Rx)",
        "items":[
          {"movement":"Pull-up","section":"conditioning","primaryMetric":"reps","planned":"1x20"},
          {"movement":"Push-up","section":"conditioning","primaryMetric":"reps","planned":"1x30"},
          {"movement":"Sit-up","section":"conditioning","primaryMetric":"reps","planned":"1x40"},
          {"movement":"Air Squat","section":"conditioning","primaryMetric":"reps","planned":"1x50"}
        ]}
     ]},
     {"level":"intermediate","label":"Intermediate","groups":[
       {"kind":"circuit","section":"conditioning","rounds":5,"restSeconds":180,"label":"Round (5×, Intermediate)",
        "items":[
          {"movement":"Banded Pull-up","section":"conditioning","primaryMetric":"reps","planned":"1x20"},
          {"movement":"Push-up","section":"conditioning","primaryMetric":"reps","planned":"1x30"},
          {"movement":"Sit-up","section":"conditioning","primaryMetric":"reps","planned":"1x40"},
          {"movement":"Air Squat","section":"conditioning","primaryMetric":"reps","planned":"1x50"}
        ]}
     ]},
     {"level":"beginner","label":"Beginner","groups":[
       {"kind":"circuit","section":"conditioning","rounds":5,"restSeconds":180,"label":"Round (5×, Beginner)",
        "items":[
          {"movement":"Ring Row","section":"conditioning","primaryMetric":"reps","planned":"1x20"},
          {"movement":"Knee Push-up","section":"conditioning","primaryMetric":"reps","planned":"1x30"},
          {"movement":"Sit-up","section":"conditioning","primaryMetric":"reps","planned":"1x40"},
          {"movement":"Air Squat","section":"conditioning","primaryMetric":"reps","planned":"1x50"}
        ]}
     ]}
   ]
 }$$::jsonb,
 'ROUNDS_FOR_TIME', null, null, 5, false,
 '5 rounds for time. Rest exactly 3 minutes between rounds.',
 'CrossFit.com', 'benchmark/barbara',
 $$5 Rounds for Time:
20 Pull-Ups
30 Push-Ups
40 Sit-Ups
50 Air Squats
Rest 3 minutes between rounds$$),

-- CHELSEA
(null, 'Chelsea', array['crossfit'],
 $${
   "exercises": [
     {"movement":"Pull-up","section":"conditioning","primaryMetric":"reps","planned":"1x5"},
     {"movement":"Push-up","section":"conditioning","primaryMetric":"reps","planned":"1x10"},
     {"movement":"Air Squat","section":"conditioning","primaryMetric":"reps","planned":"1x15"}
   ],
   "groups": [
     {"kind":"circuit","section":"conditioning","rounds":30,"label":"EMOM round (Rx)",
      "items":[
        {"movement":"Pull-up","section":"conditioning","primaryMetric":"reps","planned":"1x5"},
        {"movement":"Push-up","section":"conditioning","primaryMetric":"reps","planned":"1x10"},
        {"movement":"Air Squat","section":"conditioning","primaryMetric":"reps","planned":"1x15"}
      ]}
   ],
   "variants": [
     {"level":"rx","label":"Rx","groups":[
       {"kind":"circuit","section":"conditioning","rounds":30,"label":"EMOM round (Rx)",
        "items":[
          {"movement":"Pull-up","section":"conditioning","primaryMetric":"reps","planned":"1x5"},
          {"movement":"Push-up","section":"conditioning","primaryMetric":"reps","planned":"1x10"},
          {"movement":"Air Squat","section":"conditioning","primaryMetric":"reps","planned":"1x15"}
        ]}
     ]},
     {"level":"intermediate","label":"Intermediate","groups":[
       {"kind":"circuit","section":"conditioning","rounds":30,"label":"EMOM round (Intermediate)",
        "items":[
          {"movement":"Banded Pull-up","section":"conditioning","primaryMetric":"reps","planned":"1x5"},
          {"movement":"Push-up","section":"conditioning","primaryMetric":"reps","planned":"1x10"},
          {"movement":"Air Squat","section":"conditioning","primaryMetric":"reps","planned":"1x15"}
        ]}
     ]},
     {"level":"beginner","label":"Beginner","groups":[
       {"kind":"circuit","section":"conditioning","rounds":30,"label":"EMOM round (Beginner)",
        "items":[
          {"movement":"Ring Row","section":"conditioning","primaryMetric":"reps","planned":"1x5"},
          {"movement":"Knee Push-up","section":"conditioning","primaryMetric":"reps","planned":"1x10"},
          {"movement":"Air Squat","section":"conditioning","primaryMetric":"reps","planned":"1x15"}
        ]}
     ]}
   ]
 }$$::jsonb,
 'EMOM', null, 1800, 30, false,
 'EMOM for 30 minutes: 5 Pull-Ups, 10 Push-Ups, 15 Air Squats every minute.',
 'CrossFit.com', 'benchmark/chelsea',
 $$Every minute on the minute for 30 minutes:
5 Pull-Ups
10 Push-Ups
15 Air Squats$$)
on conflict (source, source_ref) where source_ref is not null do nothing;
