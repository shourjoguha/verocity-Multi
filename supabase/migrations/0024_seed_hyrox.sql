-- Verocity v2 — seed the shared movement library and 21 Hyrox WOD sessions.
--
-- Both movements and sessions are inserted as shared-library rows
-- (owner_user_id IS NULL). Both selects are open to anon/authenticated; only
-- server-side seeds like this one may write NULL-owned rows (0005 for
-- movements, 0023 for sessions).
--
-- Movements are keyed by lowercased name via `movements_shared_name_unique`
-- (0023), so the ON CONFLICT clause makes this migration idempotent — a
-- second apply is a no-op for movements. Sessions have no such uniqueness;
-- they insert unconditionally, so this migration should apply exactly once.
--
-- Source: 21 WODwell "Hyrox Workout of the Week" cards ingested via the
-- parser worked up in the CLAUDE session that produced this migration.

-- ---- 1. Shared movements ---------------------------------------------------
insert into public.movements (name, primary_metric, default_metrics, owner_user_id)
values
  ('Wall Ball',            'reps',     array['reps','weight'], null),
  ('Ski Erg',              'distance', array['distance','time'], null),
  ('Row',                  'distance', array['distance','time'], null),
  ('Burpee',               'reps',     array['reps','time'],     null),
  ('Burpee Broad Jump',    'reps',     array['reps'],            null),
  ('Sandbag Lunge',        'reps',     array['reps','weight'],   null),
  ('Sled Push',            'distance', array['distance','weight'], null),
  ('Sled Pull',            'distance', array['distance','weight'], null),
  ('Devil Press',          'reps',     array['reps','weight'],   null),
  ('Back Squat',           'weight',   array['reps','weight'],   null),
  ('Walkout to Push-up',   'reps',     array['reps'],            null),
  ('Run',                  'distance', array['distance','time'], null),
  ('Air Squat',            'reps',     array['reps'],            null),
  ('Sit-up',               'reps',     array['reps'],            null),
  ('Push-up',              'reps',     array['reps'],            null),
  ('Lunge',                'reps',     array['reps'],            null),
  ('Alternating Lunge',    'reps',     array['reps'],            null),
  ('V-Up',                 'reps',     array['reps'],            null)
on conflict (lower(name)) where owner_user_id is null do nothing;

-- ---- 2. Shared Hyrox sessions ---------------------------------------------
-- Each session carries session-level metadata (session_type / duration /
-- rounds / partner / instructions / source_text) plus a `frame` JSONB with
-- both `groups[]` (authoritative for the Logger) and `exercises[]` (flat
-- back-compat mirror for readers that predate 0023).
--
-- Movement strings must exactly match the shared library names above; the
-- Logger resolves by name (case-sensitive) when reading planned sets.

insert into public.sessions
  (owner_user_id, name, tags, frame, session_type, time_cap_seconds,
   duration_seconds, rounds, partner, instructions, source, source_text)
values
-- BEVERLY HILLS
(null, 'Hyrox · Beverly Hills', array['hyrox','endurance'],
 $${
   "exercises": [
     {"movement":"Wall Ball","section":"conditioning","primaryMetric":"reps","planned":"1x40s","notes":"Max reps, 20/14 lb"},
     {"movement":"Ski Erg","section":"conditioning","primaryMetric":"distance","planned":"1x40s","notes":"Max calories"},
     {"movement":"Lunge","section":"conditioning","primaryMetric":"reps","planned":"1x40s","notes":"Max reps"},
     {"movement":"Burpee","section":"conditioning","primaryMetric":"reps","planned":"1x40s","notes":"Max reps"},
     {"movement":"V-Up","section":"conditioning","primaryMetric":"reps","planned":"1x40s","notes":"Max reps"}
   ],
   "groups": [
     {"kind":"circuit","section":"conditioning","rounds":5,"restSeconds":20,"label":"Round (5×)",
      "items":[
        {"movement":"Wall Ball","section":"conditioning","primaryMetric":"reps","planned":"1x40s","notes":"Max reps, 20/14 lb"},
        {"movement":"Ski Erg","section":"conditioning","primaryMetric":"distance","planned":"1x40s","notes":"Max calories"},
        {"movement":"Lunge","section":"conditioning","primaryMetric":"reps","planned":"1x40s","notes":"Max reps"},
        {"movement":"Burpee","section":"conditioning","primaryMetric":"reps","planned":"1x40s","notes":"Max reps"},
        {"movement":"V-Up","section":"conditioning","primaryMetric":"reps","planned":"1x40s","notes":"Max reps"}
      ]}
   ]
 }$$::jsonb,
 'AMRAP', null, 1500, 5, false,
 '5 rounds. 40s max at each station, 20s rest between stations. Each round is 5 minutes.',
 'WODwell',
 $$AMRAP in 25 minutes
Complete 5 rounds of:
40 second Max Wall Ball Shots (20/14 lb) / 20s Rest
40 second Max Calorie Ski Erg / 20s Rest
40 second Max Lunges / 20s Rest
40 second Max Burpees / 20s Rest
40 second Max V-Ups / 20s Rest$$),

-- CHANGNING
(null, 'Hyrox · Changning', array['hyrox','endurance'],
 $${
   "exercises": [
     {"movement":"Burpee Broad Jump","section":"conditioning","primaryMetric":"reps","planned":"1x10"},
     {"movement":"Push-up","section":"conditioning","primaryMetric":"reps","planned":"1x20"},
     {"movement":"Sandbag Lunge","section":"conditioning","primaryMetric":"reps","planned":"1x30","notes":"60/40 lb"},
     {"movement":"Row","section":"conditioning","primaryMetric":"distance","planned":"1x40cal"}
   ],
   "groups": [
     {"kind":"circuit","section":"conditioning","rounds":1,
      "items":[
        {"movement":"Burpee Broad Jump","section":"conditioning","primaryMetric":"reps","planned":"1x10"},
        {"movement":"Push-up","section":"conditioning","primaryMetric":"reps","planned":"1x20"},
        {"movement":"Sandbag Lunge","section":"conditioning","primaryMetric":"reps","planned":"1x30","notes":"60/40 lb"},
        {"movement":"Row","section":"conditioning","primaryMetric":"distance","planned":"1x40cal"}
      ]}
   ]
 }$$::jsonb,
 'AMRAP', null, 1800, null, false,
 'AMRAP in 30 minutes. Cycle the four movements as many times as possible.',
 'WODwell',
 $$AMRAP in 30 minutes
10 Burpee Broad Jumps
20 Push-Ups
30 Sandbag Lunges (60/40 lb)
40 calorie Row$$),

-- THOMPSON
(null, 'Hyrox · Thompson', array['hyrox','endurance'],
 $${
   "exercises": [
     {"movement":"Sled Push","section":"conditioning","primaryMetric":"distance","planned":"1x25m","notes":"AHAP"},
     {"movement":"Alternating Lunge","section":"conditioning","primaryMetric":"reps","planned":"1x20"}
   ],
   "groups": [
     {"kind":"circuit","section":"conditioning","rounds":8,"restSeconds":120,"label":"Round (8×)",
      "items":[
        {"movement":"Sled Push","section":"conditioning","primaryMetric":"distance","planned":"1x25m","notes":"AHAP"},
        {"movement":"Alternating Lunge","section":"conditioning","primaryMetric":"reps","planned":"1x20"}
      ]}
   ]
 }$$::jsonb,
 'ROUNDS_FOR_TIME', null, null, 8, false,
 '8 rounds. Sled push AHAP. Rest 2 minutes between rounds.',
 'WODwell',
 $$8 Rounds for Time
25 meter Sled Push (as heavy as possible)
20 Alternating Lunges

Rest 2 minutes$$),

-- COOPER
(null, 'Hyrox · Cooper', array['hyrox','endurance'],
 $${
   "exercises": [
     {"movement":"Burpee","section":"conditioning","primaryMetric":"reps","planned":"1x10"},
     {"movement":"Air Squat","section":"conditioning","primaryMetric":"reps","planned":"1x10"},
     {"movement":"Push-up","section":"conditioning","primaryMetric":"reps","planned":"1x10"},
     {"movement":"Sit-up","section":"conditioning","primaryMetric":"reps","planned":"1x10"}
   ],
   "groups": [
     {"kind":"circuit","section":"conditioning","rounds":10,"label":"Round (10×)",
      "items":[
        {"movement":"Burpee","section":"conditioning","primaryMetric":"reps","planned":"1x10"},
        {"movement":"Air Squat","section":"conditioning","primaryMetric":"reps","planned":"1x10"},
        {"movement":"Push-up","section":"conditioning","primaryMetric":"reps","planned":"1x10"},
        {"movement":"Sit-up","section":"conditioning","primaryMetric":"reps","planned":"1x10"}
      ]}
   ]
 }$$::jsonb,
 'ROUNDS_FOR_TIME', null, null, 10, false, null, 'WODwell',
 $$10 Rounds For Time:
10 Burpees
10 Air Squats
10 Push-Ups
10 Sit-Ups$$),

-- FLINT
(null, 'Hyrox · Flint', array['hyrox','endurance'],
 $${
   "exercises": [
     {"movement":"Ski Erg","section":"conditioning","primaryMetric":"distance","planned":"1x20cal","notes":"0:00-2:00 window"},
     {"movement":"Burpee","section":"conditioning","primaryMetric":"reps","planned":"1x20","notes":"2:00-4:00 window"},
     {"movement":"Row","section":"conditioning","primaryMetric":"distance","planned":"1x20cal","notes":"4:00-6:00 window"}
   ],
   "groups": [
     {"kind":"circuit","section":"conditioning","rounds":5,"label":"6-min cycle (5×)",
      "items":[
        {"movement":"Ski Erg","section":"conditioning","primaryMetric":"distance","planned":"1x20cal","notes":"0:00-2:00 window"},
        {"movement":"Burpee","section":"conditioning","primaryMetric":"reps","planned":"1x20","notes":"2:00-4:00 window"},
        {"movement":"Row","section":"conditioning","primaryMetric":"distance","planned":"1x20cal","notes":"4:00-6:00 window"}
      ]}
   ]
 }$$::jsonb,
 'FOR_TOTAL_REPS', null, 1800, 5, false,
 'For Total Reps in 30 minutes. Each 6-minute cycle: 2min at each station. Repeat 5×.',
 'WODwell',
 $$For Total Reps in 30 minutes
0:00-2:00: 20 calorie Ski Erg
2:00-4:00: 20 Burpees
4:00-6:00: 20 calorie Row

Repeat 5x$$),

-- JOEL 2.0
(null, 'Hyrox · Joel 2.0', array['hyrox','strength','endurance'],
 $${
   "exercises": [
     {"movement":"Back Squat","section":"primary","primaryMetric":"weight","planned":"5x5","notes":"As heavy as possible"},
     {"movement":"Ski Erg","section":"conditioning","primaryMetric":"distance","planned":"1x250m"},
     {"movement":"Devil Press","section":"conditioning","primaryMetric":"reps","planned":"1x5","notes":"2x50/35 lb (per hand)"},
     {"movement":"Row","section":"conditioning","primaryMetric":"distance","planned":"1x250m"}
   ],
   "groups": [
     {"kind":"single","section":"primary","label":"For Load (5×5 AHAP)",
      "items":[
        {"movement":"Back Squat","section":"primary","primaryMetric":"weight","planned":"5x5","notes":"As heavy as possible each round"}
      ]},
     {"kind":"circuit","section":"conditioning","rounds":3,"label":"3 RFT (10-min cap)",
      "items":[
        {"movement":"Ski Erg","section":"conditioning","primaryMetric":"distance","planned":"1x250m"},
        {"movement":"Devil Press","section":"conditioning","primaryMetric":"reps","planned":"1x5","notes":"2x50/35 lb (per hand)"},
        {"movement":"Row","section":"conditioning","primaryMetric":"distance","planned":"1x250m"}
      ]}
   ]
 }$$::jsonb,
 'FOR_LOAD', 600, null, null, false,
 'Strength: 5 rounds of 5 Back Squats, AHAP. Then 3 rounds for time (10-min cap): 250m Ski Erg / 5 Devil Presses / 250m Row.',
 'WODwell',
 $$For Load
As Heavy As Possible for 5 Rounds:
5 Back Squats

Then, 3 Rounds for Time:
250 meter SkiErg
5 Devil Presses (2x50/35 lb)
250 meter Row

Time Cap: 10 minutes$$),

-- KEITH
(null, 'Hyrox · Keith', array['hyrox','endurance'],
 $${
   "exercises": [
     {"movement":"Sled Push","section":"conditioning","primaryMetric":"distance","planned":"1x25m","notes":"Every 90s, 0:00-9:00"},
     {"movement":"Sled Pull","section":"conditioning","primaryMetric":"distance","planned":"1x12.5m","notes":"Every 90s, 9:00-18:00"}
   ],
   "groups": [
     {"kind":"circuit","section":"conditioning","rounds":6,"label":"0:00-9:00 (every 90s)",
      "items":[
        {"movement":"Sled Push","section":"conditioning","primaryMetric":"distance","planned":"1x25m"}
      ]},
     {"kind":"circuit","section":"conditioning","rounds":6,"label":"9:00-18:00 (every 90s)",
      "items":[
        {"movement":"Sled Pull","section":"conditioning","primaryMetric":"distance","planned":"1x12.5m"}
      ]}
   ]
 }$$::jsonb,
 'FOR_TOTAL_DISTANCE', null, 1080, null, false,
 'For Total Distance. 6 sled pushes on the 90s (9 min), then 6 sled pulls on the 90s (9 min).',
 'WODwell',
 $$For Total Distance
From 0:00-9:00, every 90 seconds complete:
25 meter Sled Push

From 9:00-18:00, every 90 seconds complete:
12.5 meter Sled Pull$$),

-- HETFIELD
(null, 'Hyrox · Hetfield', array['hyrox','strength','endurance'],
 $${
   "exercises": [
     {"movement":"Back Squat","section":"primary","primaryMetric":"weight","planned":"5x5","notes":"Increase weight each round"},
     {"movement":"Ski Erg","section":"conditioning","primaryMetric":"distance","planned":"","notes":"30-20-10-20-30 cal ladder"},
     {"movement":"Air Squat","section":"conditioning","primaryMetric":"reps","planned":"","notes":"30-20-10-20-30 rep ladder"},
     {"movement":"Burpee","section":"conditioning","primaryMetric":"reps","planned":"","notes":"30-20-10-20-30 rep ladder"}
   ],
   "groups": [
     {"kind":"single","section":"primary","label":"For Load (5×5, increase weight)",
      "items":[
        {"movement":"Back Squat","section":"primary","primaryMetric":"weight","planned":"5x5","notes":"Increase weight each round"}
      ]},
     {"kind":"circuit","section":"conditioning","rounds":5,"label":"30-20-10-20-30 For Time (30-min cap)",
      "items":[
        {"movement":"Ski Erg","section":"conditioning","primaryMetric":"distance","planned":"","notes":"Calorie ladder per round: 30-20-10-20-30"},
        {"movement":"Air Squat","section":"conditioning","primaryMetric":"reps","planned":"","notes":"Rep ladder: 30-20-10-20-30"},
        {"movement":"Burpee","section":"conditioning","primaryMetric":"reps","planned":"","notes":"Rep ladder: 30-20-10-20-30"}
      ]}
   ]
 }$$::jsonb,
 'FOR_LOAD', 1800, null, null, false,
 'Strength: 5 rounds of 5 Back Squats, increasing. Then 30-20-10-20-30 ladder For Time: Cal Ski / Air Squats / Burpees. Cap 30 min.',
 'WODwell',
 $$For Load:
5 Rounds of 5 Back Squats (increase weight each round)

Then, 30-20-10-20-30 Reps for Time of:
Calorie Ski
Air Squats
Burpees

Time Cap: 30 minutes$$),

-- MILLER
(null, 'Hyrox · Miller', array['hyrox','endurance'],
 $${
   "exercises": [
     {"movement":"Row","section":"conditioning","primaryMetric":"distance","planned":"1x60s","notes":"20/15 cal · Minute 1"},
     {"movement":"Wall Ball","section":"conditioning","primaryMetric":"reps","planned":"1x60s","notes":"20/15 reps · 20/14 lb · Minute 2"},
     {"movement":"Burpee","section":"conditioning","primaryMetric":"reps","planned":"1x60s","notes":"20/15 · Minute 3"}
   ],
   "groups": [
     {"kind":"circuit","section":"conditioning","rounds":5,"restSeconds":60,"label":"EMOM cycle (5×) · minute 4 rest",
      "items":[
        {"movement":"Row","section":"conditioning","primaryMetric":"distance","planned":"1x60s","notes":"20/15 cal · Minute 1"},
        {"movement":"Wall Ball","section":"conditioning","primaryMetric":"reps","planned":"1x60s","notes":"20/15 reps · 20/14 lb · Minute 2"},
        {"movement":"Burpee","section":"conditioning","primaryMetric":"reps","planned":"1x60s","notes":"20/15 · Minute 3"}
      ]}
   ]
 }$$::jsonb,
 'EMOM', null, 1200, 5, false,
 'EMOM 20 min. 3-station cycle then 1 min rest, repeated 5×.',
 'WODwell',
 $$EMOM for 20 minutes
Minute 1: 20/15 calorie Row
Minute 2: 20/15 Wall Ball Shots (20/14 lb)
Minute 3: 20/15 Burpees
Minute 4: Rest

Repeat 5x$$),

-- KANE
(null, 'Hyrox · Kane', array['hyrox','endurance'],
 $${
   "exercises": [
     {"movement":"Air Squat","section":"conditioning","primaryMetric":"reps","planned":"1x15"},
     {"movement":"Sit-up","section":"conditioning","primaryMetric":"reps","planned":"1x10"},
     {"movement":"Walkout to Push-up","section":"conditioning","primaryMetric":"reps","planned":"1x5"}
   ],
   "groups": [
     {"kind":"circuit","section":"conditioning","rounds":1,
      "items":[
        {"movement":"Air Squat","section":"conditioning","primaryMetric":"reps","planned":"1x15"},
        {"movement":"Sit-up","section":"conditioning","primaryMetric":"reps","planned":"1x10"},
        {"movement":"Walkout to Push-up","section":"conditioning","primaryMetric":"reps","planned":"1x5"}
      ]}
   ]
 }$$::jsonb,
 'AMRAP', null, 960, null, false,
 'AMRAP 16 min. INTERRUPTION: every 2 minutes, drop and do 3 Burpees, then resume.',
 'WODwell',
 $$AMRAP in 16 minutes
15 Air Squats
10 Sit-Ups
5 Walkouts to Push-Ups

Every 2 minutes, complete:
3 Burpees$$),

-- CLIFF
(null, 'Hyrox · Cliff', array['hyrox','endurance'],
 $${
   "exercises": [
     {"movement":"Ski Erg","section":"conditioning","primaryMetric":"distance","planned":"1x40s","notes":"Max calories"},
     {"movement":"Burpee","section":"conditioning","primaryMetric":"reps","planned":"1x40s","notes":"Max reps"},
     {"movement":"Row","section":"conditioning","primaryMetric":"distance","planned":"1x40s","notes":"Max calories"},
     {"movement":"Wall Ball","section":"conditioning","primaryMetric":"reps","planned":"1x40s","notes":"Max reps · 20/14 lb"}
   ],
   "groups": [
     {"kind":"circuit","section":"conditioning","rounds":8,"restSeconds":20,"label":"Round (8×)",
      "items":[
        {"movement":"Ski Erg","section":"conditioning","primaryMetric":"distance","planned":"1x40s","notes":"Max calories"},
        {"movement":"Burpee","section":"conditioning","primaryMetric":"reps","planned":"1x40s","notes":"Max reps"},
        {"movement":"Row","section":"conditioning","primaryMetric":"distance","planned":"1x40s","notes":"Max calories"},
        {"movement":"Wall Ball","section":"conditioning","primaryMetric":"reps","planned":"1x40s","notes":"Max reps · 20/14 lb"}
      ]}
   ]
 }$$::jsonb,
 'FOR_TOTAL_REPS', null, 1920, 8, false,
 '8 rounds for Total Reps in 32 min. 40s work / 20s rest at each of 4 stations.',
 'WODwell',
 $$8 Rounds for Total Reps in 32 minutes
40 second Max Calorie Ski / 20s Rest
40 second Max Burpees / 20s Rest
40 second Max Calorie Row / 20s Rest
40 second Max Wall Ball Shots (20/14 lb)$$),

-- NELSON
(null, 'Hyrox · Nelson', array['hyrox','endurance'],
 $${
   "exercises": [
     {"movement":"Wall Ball","section":"conditioning","primaryMetric":"reps","planned":"1x60s","notes":"15 reps · 20/14 lb · Minute 1"},
     {"movement":"Burpee Broad Jump","section":"conditioning","primaryMetric":"reps","planned":"1x60s","notes":"10 reps · Minute 2"},
     {"movement":"Ski Erg","section":"conditioning","primaryMetric":"distance","planned":"1x60s","notes":"15 cal · Minute 3"},
     {"movement":"Lunge","section":"conditioning","primaryMetric":"reps","planned":"1x60s","notes":"20 reps · Minute 4"}
   ],
   "groups": [
     {"kind":"circuit","section":"conditioning","rounds":6,"restSeconds":60,"label":"EMOM cycle (6×) · minute 5 rest",
      "items":[
        {"movement":"Wall Ball","section":"conditioning","primaryMetric":"reps","planned":"1x60s","notes":"15 reps · 20/14 lb · Minute 1"},
        {"movement":"Burpee Broad Jump","section":"conditioning","primaryMetric":"reps","planned":"1x60s","notes":"10 reps · Minute 2"},
        {"movement":"Ski Erg","section":"conditioning","primaryMetric":"distance","planned":"1x60s","notes":"15 cal · Minute 3"},
        {"movement":"Lunge","section":"conditioning","primaryMetric":"reps","planned":"1x60s","notes":"20 reps · Minute 4"}
      ]}
   ]
 }$$::jsonb,
 'EMOM', null, 1800, 6, false,
 'EMOM 30 min. 4-station cycle then 1 min rest, repeated 6×.',
 'WODwell',
 $$EMOM for 30 minutes
Minute 1: 15 Wall Ball Shots (20/14 lb)
Minute 2: 10 Burpee Broad Jumps
Minute 3: 15 calorie Ski Erg
Minute 4: 20 Lunges
Minute 5: Rest

Repeat 6x$$),

-- HOLLY
(null, 'Hyrox · Holly', array['hyrox','endurance'],
 $${
   "exercises": [
     {"movement":"Row","section":"conditioning","primaryMetric":"distance","planned":"","notes":"5-10-15-20-25 cal per round"},
     {"movement":"Wall Ball","section":"conditioning","primaryMetric":"reps","planned":"","notes":"10-20-30-40-50 reps · 20/14 lb"}
   ],
   "groups": [
     {"kind":"circuit","section":"conditioning","rounds":5,"label":"Ascending ladder (5 rounds)",
      "items":[
        {"movement":"Row","section":"conditioning","primaryMetric":"distance","planned":"","notes":"Calorie ladder: 5-10-15-20-25"},
        {"movement":"Wall Ball","section":"conditioning","primaryMetric":"reps","planned":"","notes":"Rep ladder: 10-20-30-40-50 · 20/14 lb"}
      ]}
   ]
 }$$::jsonb,
 'AMRAP', null, 1200, 5, false,
 'AMRAP 20 min. Row 5-10-15-20-25 cal + Wall Ball 10-20-30-40-50 per round.',
 'WODwell',
 $$AMRAP in 20 minutes
5-10-15-20-25 calorie Row
10-20-30-40-50 Wall Ball Shots (20/14 lb)$$),

-- REED
(null, 'Hyrox · Reed', array['hyrox','endurance'],
 $${
   "exercises": [
     {"movement":"Row","section":"conditioning","primaryMetric":"distance","planned":"1x60s","notes":"Max calories"},
     {"movement":"Air Squat","section":"conditioning","primaryMetric":"reps","planned":"1x60s","notes":"Max reps"},
     {"movement":"Ski Erg","section":"conditioning","primaryMetric":"distance","planned":"1x60s","notes":"Max calories"},
     {"movement":"Sit-up","section":"conditioning","primaryMetric":"reps","planned":"1x60s","notes":"Max reps"}
   ],
   "groups": [
     {"kind":"circuit","section":"conditioning","rounds":5,"label":"Round (5×), 1-min max intervals",
      "items":[
        {"movement":"Row","section":"conditioning","primaryMetric":"distance","planned":"1x60s","notes":"Max calories"},
        {"movement":"Air Squat","section":"conditioning","primaryMetric":"reps","planned":"1x60s","notes":"Max reps"},
        {"movement":"Ski Erg","section":"conditioning","primaryMetric":"distance","planned":"1x60s","notes":"Max calories"},
        {"movement":"Sit-up","section":"conditioning","primaryMetric":"reps","planned":"1x60s","notes":"Max reps"}
      ]}
   ]
 }$$::jsonb,
 'FOR_TOTAL_REPS', null, 1200, 5, false,
 '5 rounds for Total Reps in 20 min. 1-minute max at each of 4 stations.',
 'WODwell',
 $$5 Rounds for Total Reps in 20 minutes
1 minute Max Calorie Row
1 minute Max Air Squats
1 minute Max Calorie SkiErg
1 minute Max Sit-Ups$$),

-- KNIGHT
(null, 'Hyrox · Knight (Partner)', array['hyrox','endurance'],
 $${
   "exercises": [
     {"movement":"Ski Erg","section":"conditioning","primaryMetric":"distance","planned":"1x1000m"},
     {"movement":"Row","section":"conditioning","primaryMetric":"distance","planned":"1x1000m"},
     {"movement":"Burpee Broad Jump","section":"conditioning","primaryMetric":"reps","planned":"1x50"}
   ],
   "groups": [
     {"kind":"circuit","section":"conditioning","rounds":1,"label":"Partner AMRAP",
      "items":[
        {"movement":"Ski Erg","section":"conditioning","primaryMetric":"distance","planned":"1x1000m"},
        {"movement":"Row","section":"conditioning","primaryMetric":"distance","planned":"1x1000m"},
        {"movement":"Burpee Broad Jump","section":"conditioning","primaryMetric":"reps","planned":"1x50"}
      ]}
   ]
 }$$::jsonb,
 'AMRAP', null, 1800, null, true,
 'Partner AMRAP 30 min. Split work as you like.',
 'WODwell',
 $$AMRAP (with a Partner) in 30 minutes
1,000 meter Ski Erg
1,000 meter Row
50 Burpee Broad Jumps$$),

-- NASH
(null, 'Hyrox · Nash', array['hyrox','endurance'],
 $${
   "exercises": [
     {"movement":"Wall Ball","section":"conditioning","primaryMetric":"reps","planned":"1x60s","notes":"15 reps · 20/14 lb"},
     {"movement":"Burpee Broad Jump","section":"conditioning","primaryMetric":"reps","planned":"1x60s","notes":"10 reps"},
     {"movement":"Row","section":"conditioning","primaryMetric":"distance","planned":"1x60s","notes":"12 cal"}
   ],
   "groups": [
     {"kind":"circuit","section":"conditioning","rounds":10,"restSeconds":120,"label":"EMOM 1 (0:00-10:00)",
      "items":[
        {"movement":"Wall Ball","section":"conditioning","primaryMetric":"reps","planned":"1x60s","notes":"15 reps · 20/14 lb"}
      ]},
     {"kind":"circuit","section":"conditioning","rounds":10,"restSeconds":120,"label":"EMOM 2 (12:00-22:00)",
      "items":[
        {"movement":"Burpee Broad Jump","section":"conditioning","primaryMetric":"reps","planned":"1x60s","notes":"10 reps"}
      ]},
     {"kind":"circuit","section":"conditioning","rounds":10,"label":"EMOM 3 (24:00-34:00)",
      "items":[
        {"movement":"Row","section":"conditioning","primaryMetric":"distance","planned":"1x60s","notes":"12 cal"}
      ]}
   ]
 }$$::jsonb,
 'EMOM', null, 2040, null, false,
 'Three 10-minute EMOMs with 2 min rest between. Wall Ball → Burpee Broad Jump → Row.',
 'WODwell',
 $$Three 10-minute EMOMs for 34 minutes
From 0:00-10:00, EMOM of 15 Wall Ball Shots (20/14 lb)
Rest 2 minutes
From 12:00-22:00, EMOM of 10 Burpee Broad Jumps
Rest 2 minutes
From 24:00-34:00, EMOM of 12 calorie Row$$),

-- LEWIS
(null, 'Hyrox · Lewis', array['hyrox','endurance'],
 $${
   "exercises": [
     {"movement":"Row","section":"conditioning","primaryMetric":"distance","planned":"1x500m"},
     {"movement":"Lunge","section":"conditioning","primaryMetric":"reps","planned":"1x50"},
     {"movement":"Ski Erg","section":"conditioning","primaryMetric":"distance","planned":"1x500m"},
     {"movement":"Air Squat","section":"conditioning","primaryMetric":"reps","planned":"1x50"},
     {"movement":"Run","section":"conditioning","primaryMetric":"distance","planned":"1x500m"},
     {"movement":"Push-up","section":"conditioning","primaryMetric":"reps","planned":"1x50"}
   ],
   "groups": [
     {"kind":"circuit","section":"conditioning","rounds":1,
      "items":[
        {"movement":"Row","section":"conditioning","primaryMetric":"distance","planned":"1x500m"},
        {"movement":"Lunge","section":"conditioning","primaryMetric":"reps","planned":"1x50"},
        {"movement":"Ski Erg","section":"conditioning","primaryMetric":"distance","planned":"1x500m"},
        {"movement":"Air Squat","section":"conditioning","primaryMetric":"reps","planned":"1x50"},
        {"movement":"Run","section":"conditioning","primaryMetric":"distance","planned":"1x500m"},
        {"movement":"Push-up","section":"conditioning","primaryMetric":"reps","planned":"1x50"}
      ]}
   ]
 }$$::jsonb,
 'AMRAP', null, 1800, null, false,
 'AMRAP 30 min. Cycle the 6-station chain as many times as possible.',
 'WODwell',
 $$AMRAP in 30 minutes
500 meter Row
50 Lunges
500 meter Ski Erg
50 Air Squats
500 meter Run
50 Push-Ups$$),

-- SMITH
(null, 'Hyrox · Smith (Partner)', array['hyrox','endurance'],
 $${
   "exercises": [
     {"movement":"Row","section":"conditioning","primaryMetric":"distance","planned":"","notes":"30-20-10-20-30 cal ladder"},
     {"movement":"Wall Ball","section":"conditioning","primaryMetric":"reps","planned":"","notes":"30-20-10-20-30 · 20/14 lb"},
     {"movement":"Burpee","section":"conditioning","primaryMetric":"reps","planned":"","notes":"30-20-10-20-30"}
   ],
   "groups": [
     {"kind":"circuit","section":"conditioning","rounds":5,"label":"30-20-10-20-30 For Time (Partner)",
      "items":[
        {"movement":"Row","section":"conditioning","primaryMetric":"distance","planned":"","notes":"Calorie ladder: 30-20-10-20-30"},
        {"movement":"Wall Ball","section":"conditioning","primaryMetric":"reps","planned":"","notes":"Rep ladder: 30-20-10-20-30 · 20/14 lb"},
        {"movement":"Burpee","section":"conditioning","primaryMetric":"reps","planned":"","notes":"Rep ladder: 30-20-10-20-30"}
      ]}
   ]
 }$$::jsonb,
 'FOR_TIME', 1500, null, 5, true,
 'Partner For Time. 30-20-10-20-30 reps per movement (Row cal / Wall Ball / Burpee). Cap 25 min.',
 'WODwell',
 $$For Time (with a Partner)
30-20-10-20-30 reps of:
Calorie Row
Wall Ball Shots (20/14 lb)
Burpees

Time Cap: 25 minutes$$),

-- ANDRÉ
(null, 'Hyrox · André', array['hyrox','endurance'],
 $${
   "exercises": [
     {"movement":"Row","section":"conditioning","primaryMetric":"distance","planned":"1x1000m"},
     {"movement":"Burpee","section":"conditioning","primaryMetric":"reps","planned":"1x50"},
     {"movement":"Row","section":"conditioning","primaryMetric":"distance","planned":"1x800m"},
     {"movement":"Burpee","section":"conditioning","primaryMetric":"reps","planned":"1x40"},
     {"movement":"Row","section":"conditioning","primaryMetric":"distance","planned":"1x600m"},
     {"movement":"Burpee","section":"conditioning","primaryMetric":"reps","planned":"1x30"},
     {"movement":"Row","section":"conditioning","primaryMetric":"distance","planned":"1x400m"},
     {"movement":"Burpee","section":"conditioning","primaryMetric":"reps","planned":"1x20"},
     {"movement":"Row","section":"conditioning","primaryMetric":"distance","planned":"1x200m"},
     {"movement":"Burpee","section":"conditioning","primaryMetric":"reps","planned":"1x10"}
   ],
   "groups": [
     {"kind":"circuit","section":"conditioning","rounds":1,"label":"Round 1 (1000/50)",
      "items":[
        {"movement":"Row","section":"conditioning","primaryMetric":"distance","planned":"1x1000m"},
        {"movement":"Burpee","section":"conditioning","primaryMetric":"reps","planned":"1x50"}
      ]},
     {"kind":"circuit","section":"conditioning","rounds":1,"label":"Round 2 (800/40)",
      "items":[
        {"movement":"Row","section":"conditioning","primaryMetric":"distance","planned":"1x800m"},
        {"movement":"Burpee","section":"conditioning","primaryMetric":"reps","planned":"1x40"}
      ]},
     {"kind":"circuit","section":"conditioning","rounds":1,"label":"Round 3 (600/30)",
      "items":[
        {"movement":"Row","section":"conditioning","primaryMetric":"distance","planned":"1x600m"},
        {"movement":"Burpee","section":"conditioning","primaryMetric":"reps","planned":"1x30"}
      ]},
     {"kind":"circuit","section":"conditioning","rounds":1,"label":"Round 4 (400/20)",
      "items":[
        {"movement":"Row","section":"conditioning","primaryMetric":"distance","planned":"1x400m"},
        {"movement":"Burpee","section":"conditioning","primaryMetric":"reps","planned":"1x20"}
      ]},
     {"kind":"circuit","section":"conditioning","rounds":1,"label":"Round 5 (200/10)",
      "items":[
        {"movement":"Row","section":"conditioning","primaryMetric":"distance","planned":"1x200m"},
        {"movement":"Burpee","section":"conditioning","primaryMetric":"reps","planned":"1x10"}
      ]}
   ]
 }$$::jsonb,
 'FOR_TIME', 2400, null, 5, false,
 'For Time. Descending row/burpee ladder: 1000/50, 800/40, 600/30, 400/20, 200/10. Cap 40 min.',
 'WODwell',
 $$For Time
1,000m Row / 50 Burpees
800m Row / 40 Burpees
600m Row / 30 Burpees
400m Row / 20 Burpees
200m Row / 10 Burpees

Time Cap: 40 minutes$$),

-- RICHIE
(null, 'Hyrox · Richie', array['hyrox','endurance'],
 $${
   "exercises": [
     {"movement":"Ski Erg","section":"conditioning","primaryMetric":"distance","planned":"1x500m"},
     {"movement":"Burpee","section":"conditioning","primaryMetric":"reps","planned":"1x20"},
     {"movement":"Wall Ball","section":"conditioning","primaryMetric":"reps","planned":"1x20","notes":"20/14 lb"},
     {"movement":"Row","section":"conditioning","primaryMetric":"distance","planned":"1x500m"}
   ],
   "groups": [
     {"kind":"circuit","section":"conditioning","rounds":2,"label":"2 RFT (25-min cap)",
      "items":[
        {"movement":"Ski Erg","section":"conditioning","primaryMetric":"distance","planned":"1x500m"},
        {"movement":"Burpee","section":"conditioning","primaryMetric":"reps","planned":"1x20"},
        {"movement":"Wall Ball","section":"conditioning","primaryMetric":"reps","planned":"1x20","notes":"20/14 lb"},
        {"movement":"Row","section":"conditioning","primaryMetric":"distance","planned":"1x500m"}
      ]}
   ]
 }$$::jsonb,
 'ROUNDS_FOR_TIME', 1500, null, 2, false, null, 'WODwell',
 $$2 Rounds for Time
500 meter Ski Erg
20 Burpees
20 Wall Ball Shots (20/14 lb)
500 meter Row

Time Cap: 25 minutes$$),

-- CASH
(null, 'Hyrox · Cash (Partner)', array['hyrox','endurance'],
 $${
   "exercises": [
     {"movement":"Ski Erg","section":"conditioning","primaryMetric":"distance","planned":"1x20cal"},
     {"movement":"Sandbag Lunge","section":"conditioning","primaryMetric":"reps","planned":"1x20"},
     {"movement":"Burpee Broad Jump","section":"conditioning","primaryMetric":"reps","planned":"1x20"}
   ],
   "groups": [
     {"kind":"circuit","section":"conditioning","rounds":1,"label":"Partner AMRAP",
      "items":[
        {"movement":"Ski Erg","section":"conditioning","primaryMetric":"distance","planned":"1x20cal"},
        {"movement":"Sandbag Lunge","section":"conditioning","primaryMetric":"reps","planned":"1x20"},
        {"movement":"Burpee Broad Jump","section":"conditioning","primaryMetric":"reps","planned":"1x20"}
      ]}
   ]
 }$$::jsonb,
 'AMRAP', null, 1200, null, true,
 'Partner AMRAP 20 min. Split work as you like.',
 'WODwell',
 $$AMRAP (with a Partner) in 20 minutes
20 calorie Ski Erg
20 Sandbag Lunges
20 Burpee Broad Jumps$$);
