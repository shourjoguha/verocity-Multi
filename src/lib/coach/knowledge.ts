// The coach's evidence base: every numeric threshold the rules test against,
// each one attributable to a named person in a named episode.
//
// WHY THIS IS NOT app.config.ts, which is where every other constant lives.
// app.config holds *this app's* choices — VOLUME.unweightedRepKg is a unit
// conversion we picked, ASPECT_WINDOW_DAYS is a responsiveness control we tuned.
// Nothing in this file is our choice. Every value here is an external claim
// made by a specific person on a specific date, and it changes when the corpus
// changes, not when the product changes. Two different provenances and two
// different change cadences do not belong in one module.
//
// THE BAN THIS FILE RESPECTS. lib/aspects.ts states the house rule: "inventing a
// reference value and calling the midpoint 'typical for you' was a claim the
// data could not support." A cited threshold is the only kind of absolute this
// codebase may hold, and it earns that only while the citation is real. So:
//
//   - `quote` is VERBATIM from the transcript at `source.vaultPath`. If you
//     cannot paste the sentence, the threshold does not go in.
//   - `speaker` is a PERSON, never "research" or "studies". Galpin saying
//     ">= 10 sets" is a practitioner heuristic, not a meta-analysis, and the UI
//     must be able to say so. Laundering a podcast into "science shows" would
//     satisfy the letter of the ban and break its spirit.
//   - `caveat` carries the limit the speaker themselves put on the number.
//     Several of these thresholds are explicitly conditional in the source and
//     a rule that drops the condition is misquoting them.
//
// Bump KNOWLEDGE_PACK_VERSION whenever a value, quote or caveat changes. It is
// stamped onto every recommendation row so a finding can always be traced to
// the exact evidence that produced it, including after the pack moves on.

export const KNOWLEDGE_PACK_VERSION = '2026.08.1';

export interface Source {
  /** A person. Never an institution, never "research". */
  speaker: string;
  work: string;
  published: string;
  url: string;
  /** Path inside the operator's knowledge vault the quote was read from. */
  vaultPath: string;
}

export const SOURCES = {
  galpinStrength: {
    speaker: 'Andy Galpin',
    work: 'Huberman Lab guest series — How to Build Strength, Muscle Size & Endurance',
    published: '2026-05-11',
    url: 'https://www.youtube.com/watch?v=IAnhFUUCq6c',
    vaultPath: 'Videos/fitness/galpin/2026-w20-how-to-build-strength-muscle-size-endurance.md',
  },
  galpinProtocols: {
    speaker: 'Andy Galpin',
    work: 'Huberman Lab guest series — Optimal Protocols to Build Strength & Grow Muscles',
    published: '2026-05-11',
    url: 'https://www.youtube.com/watch?v=CyDLbrZK75U',
    vaultPath: 'Videos/fitness/galpin/2026-w20-optimal-protocols-to-build-strength-grow-muscles.md',
  },
  galpinEndurance: {
    speaker: 'Andy Galpin',
    work: 'Huberman Lab guest series — How to Build Physical Endurance & Lose Fat',
    published: '2026-05-11',
    url: 'https://www.youtube.com/watch?v=oNkDA2F7CjM',
    vaultPath: 'Videos/fitness/galpin/2026-w20-how-to-build-physical-endurance-lose-fat.md',
  },
  galpinRecovery: {
    speaker: 'Andy Galpin',
    work: 'Huberman Lab guest series — Maximize Recovery to Achieve Fitness & Performance Goals',
    published: '2026-05-11',
    url: 'https://www.youtube.com/watch?v=juD99_sPWGU',
    vaultPath: 'Videos/fitness/galpin/2026-w20-maximize-recovery-to-achieve-fitness-performance-goals.md',
  },
  galpinProgram: {
    speaker: 'Andy Galpin',
    work: 'Huberman Lab guest series — Optimize Your Training Program for Fitness & Longevity',
    published: '2026-05-11',
    url: 'https://www.youtube.com/watch?v=UIy-WQCZd4M',
    vaultPath: 'Videos/fitness/galpin/2026-w20-optimize-your-training-program-for-fitness-longevity.md',
  },
  galpinNutrition: {
    speaker: 'Andy Galpin',
    work: 'Huberman Lab guest series — Optimal Nutrition & Supplementation for Fitness',
    published: '2026-05-10',
    url: 'https://www.youtube.com/watch?v=q37ARYnRDGc',
    vaultPath: 'Videos/nutrition/galpin/2026-w19-optimal-nutrition-supplementation-for-fitness.md',
  },
  attiaProtein: {
    speaker: 'Peter Attia with Rhonda Patrick',
    work: 'The Drive #369 — Rethinking protein needs for muscle and longevity',
    published: '2026-05-15',
    url: 'https://www.youtube.com/watch?v=VhbpSc6pKRQ',
    vaultPath:
      'Videos/nutrition/peterattiamd/2026-w20-369-rethinking-protein-needs-for-muscle-and-longevity-and-the-benefits-of-creatine-sauna-use.md',
  },
  attiaZone5: {
    speaker: 'Iñigo San-Millán with Peter Attia',
    work: 'How often should you be doing Zone 5 training?',
    published: '2026-05-15',
    url: 'https://www.youtube.com/watch?v=xuqURs4auc8',
    vaultPath:
      'Videos/fitness/peterattiamd/2026-w20-how-often-should-you-be-doing-zone-5-training-i-igo-san-mill-n-ph-d-peter-attia-m-d.md',
  },
} as const satisfies Record<string, Source>;

export type SourceKey = keyof typeof SOURCES;

/**
 * One cited threshold. `value` is deliberately loose — some claims are a single
 * number (10 sets), some a range ([8, 15] reps), some a pair of tiers
 * ({ floor: 1.2, target: 1.6 }). Forcing them into one shape would mean
 * flattening ranges the speaker stated as ranges.
 */
export interface Claim<V> {
  /** Stable id. Referenced by rule_id strings and stored in `evidence`. */
  id: string;
  /** What the claim asserts, in the app's own words. */
  statement: string;
  value: V;
  unit: string;
  source: SourceKey;
  /** Verbatim from the transcript. Never paraphrased. */
  quote: string;
  /** The limit the speaker put on it. Rules MUST honour this. */
  caveat?: string;
}

const claim = <V>(c: Claim<V>): Claim<V> => c;

// ---------------------------------------------------------------------------
// Training — what a given adaptation actually requires
// ---------------------------------------------------------------------------

export const TRAINING = {
  strengthIntensity: claim({
    id: 'strength.intensity',
    statement: 'Strength work is loaded at or above 85% of one-rep max.',
    value: 0.85,
    unit: 'fraction of 1RM',
    source: 'galpinStrength',
    quote: 'above 85% of your one rep max.',
    caveat:
      'Stated for the moderately-to-highly trained. Galpin puts the same lifter at ~75% when only moderately trained, and says of the untrained "everything works".',
  }),
  strengthReps: claim({
    id: 'strength.reps',
    statement: 'True strength sets run to five reps or fewer.',
    value: 5,
    unit: 'reps per set (max)',
    source: 'galpinStrength',
    quote: 'five repetitions per set or less range.',
  }),
  strengthFrequency: claim({
    id: 'strength.frequency',
    statement: 'Twice a week per muscle is enough to drive strength for most people.',
    value: 2,
    unit: 'sessions per muscle per week',
    source: 'galpinStrength',
    quote: 'Twice per week per muscle.',
    caveat: 'Galpin calls three "great" but two "really effective" — this is a floor, not a cap.',
  }),
  hypertrophyWeeklySets: claim({
    id: 'hypertrophy.weeklySets',
    statement: 'Hypertrophy maintenance starts around ten hard sets per muscle group per week.',
    value: 10,
    unit: 'sets per muscle group per week',
    source: 'galpinEndurance',
    quote: '10 sets per muscle group per week minimum',
    caveat:
      "Huberman's framing for an all-round trainee, which Galpin accepts in the exchange. It is a minimum for maintaining or building, not an optimum.",
  }),
  hypertrophyReps: claim({
    id: 'hypertrophy.reps',
    statement: 'Most hypertrophy work belongs in the eight-to-fifteen rep range.',
    value: [8, 15] as [number, number],
    unit: 'reps per set',
    source: 'galpinProtocols',
    quote: 'eight to 15 repetition per set range.',
    caveat:
      'Galpin puts the effective band far wider (5–30, fading to ~4) and says the range only works taken to or near muscular failure. Outside 8–15 is not wasted work.',
  }),
  hypertrophyProximityToFailure: claim({
    id: 'hypertrophy.proximityToFailure',
    statement: 'The rep range only works if the set is taken to or near muscular failure.',
    value: 8.5,
    unit: 'RPE at which a set reads as near failure',
    source: 'galpinStrength',
    quote: 'The only caveat for hypertrophy is you have to take it to muscular failure',
    caveat:
      'The RPE number is the APP\'S translation of "near failure", not Galpin\'s — he speaks in failure, not in RPE. RPE 8.5 is roughly 1-2 reps in reserve. He also notes the higher the rep range, the harder genuine failure is to reach: "It is very challenging to maintain the focus required at rep 27 to actually get sufficient failure by rep 30."',
  }),
  strengthRest: claim({
    id: 'strength.rest',
    statement: 'Heavy low-rep work needs two to four minutes between sets.',
    value: [120, 240] as [number, number],
    unit: 'seconds of rest between sets',
    source: 'galpinStrength',
    quote: "So the number we're going to throw out typically is like two to four minutes",
    caveat:
      'The reason is that intensity, not volume, drives strength, so any fatigue carried into the next set costs the adaptation. Galpin explicitly allows the rest to be filled by supersetting an unrelated muscle group — resting is not the same as standing still. For HYPERTROPHY he says the opposite: stay "in the two minute range at most".',
  }),
  hypertrophyRest: claim({
    id: 'hypertrophy.rest',
    statement: 'Hypertrophy work is best kept to about two minutes of rest at most.',
    value: 120,
    unit: 'seconds of rest between sets (max)',
    source: 'galpinProtocols',
    quote:
      "if you're gonna train for hypertrophy, it's probably best to stay in the two minute range at most",
    caveat:
      'Galpin immediately adds that longer rest is fine if the load or the volume goes up to compensate: "you can\'t lower one of the variables, keep everything else the same and expect the same result." So this is a trade, not a limit.',
  }),
  zone2Weekly: claim({
    id: 'endurance.zone2Weekly',
    statement: 'Around 150–180 minutes a week of conversational-pace cardio.',
    value: [150, 180] as [number, number],
    unit: 'minutes per week',
    source: 'galpinStrength',
    quote: '150 to 180 minutes of so-called zone two cardio can just barely have a conversation.',
    caveat:
      'A general health floor, not a performance target, and Galpin notes it can be met partly by physical activity rather than structured sessions.',
  }),
  vo2Weekly: claim({
    id: 'endurance.vo2Weekly',
    statement: 'Five to six minutes a week of genuinely all-out work.',
    value: [5, 6] as [number, number],
    unit: 'minutes per week at/near max heart rate',
    source: 'galpinEndurance',
    quote: 'five or six minute per week threshold.',
    caveat:
      'Total working minutes only — rest between bouts is excluded. Galpin puts it at 4–8 bouts, and separately at as little as one 90-second bout a week near max HR.',
  }),
  vo2AllOut: claim({
    id: 'endurance.vo2AllOut',
    statement: 'The interval only counts if it actually reaches maximum heart rate.',
    value: 9,
    unit: 'RPE at which a bout reads as all-out',
    source: 'galpinStrength',
    quote: "as long as you touch that max heart rate, I'm good",
    caveat:
      "The RPE number is the APP'S translation of touching max heart rate — Galpin speaks in heart rate, and the athlete's own hr_max is the better read whenever the session logged one. He is explicit that the bout LENGTH does not matter (\"If that takes you 20 seconds or 90 seconds, it's fine\"); only the intensity reached does.",
  }),
  vo2Bouts: claim({
    id: 'endurance.vo2Bouts',
    statement: 'Four to eight all-out bouts in a single session.',
    value: [4, 8] as [number, number],
    unit: 'bouts per session',
    source: 'galpinStrength',
    quote: 'Ideal world probably four to eight in that single session',
  }),
  vo2Ordering: claim({
    id: 'endurance.vo2Ordering',
    statement: 'In a session that mixes both, the hard interval goes after the steady-state work.',
    value: 'intervals-last',
    unit: 'session ordering',
    source: 'attiaZone5',
    quote: "you don't want to start with the high intensity",
    caveat:
      'San-Millán\'s reason is lactate suppressing lipolysis, so this bites for the aerobic/fat-oxidation goal of the steady work. It is not a general rule about session order.',
  }),
  interferenceModality: claim({
    id: 'endurance.interferenceModality',
    statement: 'Running interferes with hypertrophy more than cycling does.',
    value: 'prefer-low-eccentric',
    unit: 'modality choice',
    source: 'galpinProtocols',
    quote: 'much more interference with running unlike hypertrophy than we do cycling',
    caveat:
      'Galpin frames interference as primarily an energy-balance problem — "you can ameliorate this by just eating more" — with modality second.',
  }),
  blockLength: claim({
    id: 'programming.blockLength',
    statement: 'Progress a block for four to six weeks, eight at the outside, then back off.',
    value: [4, 8] as [number, number],
    unit: 'weeks before a deload',
    source: 'galpinProgram',
    quote: 'four to six weeks, maybe up to eight before we then take a back off',
  }),
  overreachingRun: claim({
    id: 'recovery.overreachingRun',
    statement: 'A decrement is worth acting on only after about five consecutive days.',
    value: 5,
    unit: 'consecutive days of decrement',
    source: 'galpinRecovery',
    quote:
      'more than probably, in my opinion, five days in a row of decrement, then I might start paying attention.',
    caveat:
      'Galpin wants three signals together — performance, a biomarker and symptoms — before calling it overreaching. A single-axis read is weaker than the quote alone suggests.',
  }),
} as const;

// ---------------------------------------------------------------------------
// Readiness — the SYMPTOM channel, and only that
// ---------------------------------------------------------------------------
// The logger's vibe check records sleep, energy and soreness on a 1-5 scale.
// In Galpin's framework that is exactly ONE of the three signals he wants before
// anyone says the word overreaching; the other two are a performance decrement
// and a moving biomarker. Rules built on vibe alone must therefore be phrased as
// a question, and gain confidence only when a load signal agrees with them.

export const READINESS = {
  threeSignals: claim({
    id: 'recovery.threeSignals',
    statement: 'Overreaching needs a performance drop, a biomarker and a symptom together.',
    value: 3,
    unit: 'concurrent signal types',
    source: 'galpinRecovery',
    quote: 'If you see all three of these popping up, you have reason to believe',
    caveat:
      'The app can read symptoms (the vibe check) and a load proxy (training density). It has no biomarker unless Garmin is connected, so it can never reach three on its own and must not claim to.',
  }),
  respondLighter: claim({
    id: 'recovery.respondLighter',
    statement: 'The response to a bad day is a lighter session, not a cancelled one.',
    value: 6,
    unit: 'RPE to fall back to',
    source: 'galpinProtocols',
    quote: "can we go real light? Let's go to six out of 10 RPE",
    caveat:
      'Said with hypertrophy as the goal, where volume is the driver and keeping some volume in matters. For a strength block the same logic favours cutting volume and keeping load.',
  }),
} as const;

// ---------------------------------------------------------------------------
// Nutrition — TIMING AND STYLE ONLY
// ---------------------------------------------------------------------------
// `meal_logs` holds no calories and no macro grams, by an explicit schema
// decision (migration 0032: "No calories, no macros, no score"). So the dose
// claims below exist to be DISPLAYED as a cited target the athlete can aim at.
// No rule may test logged meals against them — there is no gram in the database
// to compare with, and manufacturing one from size + tag_mix percents would be
// precisely the invented reference value this codebase bans. See
// rules/nutrition.ts, which tests only what the athlete actually recorded:
// clock times, gaps, cadence, portion size, tag presence and hunger.

export const NUTRITION = {
  proteinFloor: claim({
    id: 'nutrition.proteinFloor',
    statement: 'Nobody should sit below 1.2 g of protein per kg of bodyweight per day.',
    value: 1.2,
    unit: 'g/kg bodyweight per day',
    source: 'attiaProtein',
    quote: 'nobody that should be consuming less than 1.2 grams of protein per kilogram per day',
    caveat: 'A revised floor for the RDA, explicitly not an optimum.',
  }),
  proteinTarget: claim({
    id: 'nutrition.proteinTarget',
    statement: 'Aim so the worst day still lands at 1.6 g/kg — a 1.6–2.2 band.',
    value: [1.6, 2.2] as [number, number],
    unit: 'g/kg bodyweight per day',
    source: 'attiaProtein',
    quote: 'shift the range so that your low day is 1.6 and your high day is maybe 2.2',
    caveat:
      'Attia\'s argument is asymmetric-risk, not that 2.2 beats 1.6: "every day you\'re below, the downside is much greater than the upside of being above."',
  }),
  proteinTotalOverTiming: claim({
    id: 'nutrition.proteinTotalOverTiming',
    statement: 'Daily protein total matters more for growth than when you eat it.',
    value: 'total-over-timing',
    unit: 'priority',
    source: 'galpinNutrition',
    quote:
      'total amount of protein you ingest throughout the day is probably a bigger determinant for things like muscle growth than the timing.',
    caveat:
      'This is what keeps the coach from nagging about a missed post-workout meal. Galpin still calls the post-exercise window "extremely real" — just not a 30-minute one.',
  }),
  carbTimingPrecondition: claim({
    id: 'nutrition.carbTimingPrecondition',
    statement: 'Carbohydrate timing only starts to matter at daily or twice-daily training.',
    value: 7,
    unit: 'sessions per week at which timing begins to matter',
    source: 'galpinNutrition',
    quote:
      "if you're training every day or twice in a day, then the timing of carbohydrate really starts to matter",
    caveat:
      'The converse is the load-bearing half: with two or more days between sessions, Galpin says glycogen restores on its own and timing can be ignored. Any carb-timing rule MUST gate on this.',
  }),
  fastedDuration: claim({
    id: 'nutrition.fastedDuration',
    statement: 'Training unfed is fine up to about an hour; past that it gets harder.',
    value: 60,
    unit: 'minutes of unfed training before fuelling starts to matter',
    source: 'galpinNutrition',
    quote: "So are you really talking 30, 45 minutes, 60 minutes, you're probably fine",
    caveat:
      'Conditional on the day before: "if you ate sufficient calories a day before, didn\'t train and your glycogen stores are topped off, you have a fighting chance." Galpin also separates CAN from SHOULD — he sees no scenario where fasting improves performance, only ones where it does not hurt it.',
  }),
  hardSessionFuel: claim({
    id: 'nutrition.hardSessionFuel',
    statement: 'Around a hard session, roughly 0.5 g carbohydrate and 0.25 g protein per pound.',
    value: { carbPerLb: 0.5, proteinPerLb: 0.25 },
    unit: 'g per lb bodyweight, across pre/during/post combined',
    source: 'galpinNutrition',
    quote: 'half a gram of carbohydrate per pound of body weight',
    caveat:
      'Galpin calls it "a very rough number to start" and scales it with expenditure. Display only — nothing logged can be measured against it.',
  }),
} as const;

/** Every claim in the pack, by id — the lookup `evidence` payloads resolve against. */
export const CLAIMS: Record<string, Claim<unknown>> = Object.fromEntries(
  [...Object.values(TRAINING), ...Object.values(READINESS), ...Object.values(NUTRITION)].map(
    (c) => [c.id, c as Claim<unknown>],
  ),
);
