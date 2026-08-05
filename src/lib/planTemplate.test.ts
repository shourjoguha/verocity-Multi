import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { PLAN_LENGTH } from '@/app.config';
import {
  PLAN_CSV_HEADERS,
  buildPlanAiPrompt,
  buildPlanCsvTemplate,
  buildPlanFixPrompt,
  buildPlanTsvTemplate,
  parsePlanTabular,
  parsePlanWorkbook,
  validateParsedPlan,
} from '@/lib/planTemplate';
import type { UserStats } from '@/lib/types';

/** A fully-populated stats row — every branch of the profile block reachable. */
const fullStats = (): UserStats => ({
  owner_user_id: 'u1',
  body_weight_kg: 68,
  height_cm: 170,
  birth_year: 1992,
  gender: 'female',
  body_type: null,
  injuries: [{ id: 'i1', region: 'shoulders', label: 'Rotator cuff', year: 2023 }],
  goals: [
    { id: 'strength', label: 'Strength', weight: 70 },
    { id: 'hypertrophy', label: 'Hypertrophy', weight: 50 },
  ],
  experience: 'intermediate',
  days_per_week: 4,
  equipment: ['barbell', 'rack'],
  preferred_plan_weeks: 10,
  disciplines: ['weightlifting', 'calisthenics'],
  onboarded_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  created_at: '2026-01-01T00:00:00Z',
});

describe('plan CSV template', () => {
  it('CSV starts with the canonical header row', () => {
    const csv = buildPlanCsvTemplate();
    expect(csv.split('\n')[0]).toBe(PLAN_CSV_HEADERS.join(','));
  });

  it('TSV uses tab delimiter and matches CSV row count', () => {
    const tsv = buildPlanTsvTemplate();
    const csv = buildPlanCsvTemplate();
    expect(tsv.split('\n')[0]).toBe(PLAN_CSV_HEADERS.join('\t'));
    expect(tsv.split('\n').length).toBe(csv.split('\n').length);
  });

  it('round-trips: template parses into a valid plan with no issues', () => {
    const { plan, issues } = parsePlanTabular(buildPlanCsvTemplate());
    expect(issues).toEqual([]);
    expect(plan.title).toBe('Sample 8-Week Block');
    expect(plan.startDate).toBe('2026-06-01');
    expect(plan.endDate).toBe('2026-07-26');
    expect(plan.weeklyTemplate).toEqual(['monday-lower', 'thursday-upper']);
    expect(plan.blocks).toEqual([
      { type: 'accumulation', startWeek: 1, endWeek: 4 },
      { type: 'intensification', startWeek: 5, endWeek: 7 },
      { type: 'deload', startWeek: 8, endWeek: 8 },
    ]);
    const squat = plan.days[0].exercises.find((e) => e.movement === 'Back Squat')!;
    expect(squat.plannedByWeek[1]).toBe('3x5');
    expect(squat.plannedByWeek[8]).toBe('2x5');
    const rdl = plan.days[0].exercises.find((e) => e.movement === 'Romanian Deadlift')!;
    expect(Object.keys(rdl.plannedByWeek)).toHaveLength(8);
    expect(rdl.plannedByWeek[3]).toBe('3x8');
    // The SUB row parses into a subroutine with title/description/url and no weeks.
    const box = plan.days[1].exercises.find((e) => e.movement === 'Box breathing')!;
    expect(box.kind).toBe('subroutine');
    expect(box.description).toContain('4 counts in');
    expect(box.url).toBe('https://example.com/box-breathing');
    expect(Object.keys(box.plannedByWeek)).toHaveLength(0);
  });

  it('TSV parses identically to CSV', () => {
    const fromCsv = parsePlanTabular(buildPlanCsvTemplate()).plan;
    const fromTsv = parsePlanTabular(buildPlanTsvTemplate()).plan;
    expect(fromTsv).toEqual(fromCsv);
  });

  it('AI prompt documents the SUB row kind', () => {
    expect(buildPlanAiPrompt()).toContain('SUB');
  });
});

describe('plan tabular parser — compatibility checks', () => {
  it('flags bad header', () => {
    const { issues } = parsePlanTabular('a,b,c\nMETA,title,X');
    expect(issues.some((i) => i.includes('Header row must be exactly'))).toBe(true);
  });

  it('flags unknown section and metric', () => {
    const csv = [
      PLAN_CSV_HEADERS.join(','),
      'META,weeks,4',
      'DAY,mon,Monday',
      'EX,mon,Squat,turbo,weight,1,3x5,',
      'EX,mon,Press,primary,joules,1,3x5,',
    ].join('\n');
    const { issues } = parsePlanTabular(csv);
    expect(issues.some((i) => i.includes('section "turbo"'))).toBe(true);
    expect(issues.some((i) => i.includes('metric "joules"'))).toBe(true);
  });

  it('flags EX with no planned sets and out-of-range week', () => {
    const csv = [
      PLAN_CSV_HEADERS.join(','),
      'META,weeks,2',
      'DAY,mon,Monday',
      'EX,mon,Squat,primary,weight,9,3x5,',
    ].join('\n');
    const { issues } = parsePlanTabular(csv);
    expect(issues.some((i) => i.includes('outside 1..2'))).toBe(true);
  });

  it('flags overlapping blocks', () => {
    const csv = [
      PLAN_CSV_HEADERS.join(','),
      'META,weeks,6',
      'BLOCK,accumulation,,,,1-4,,',
      'BLOCK,intensification,,,,3-6,,',
      'DAY,mon,Monday',
      'EX,mon,Squat,primary,weight,*,3x5,',
    ].join('\n');
    const { issues } = parsePlanTabular(csv);
    expect(issues.some((i) => i.includes('overlaps'))).toBe(true);
  });

  it('quoted cells preserve commas', () => {
    const csv = [
      PLAN_CSV_HEADERS.join(','),
      'META,title,"Hello, World"',
      'META,weeks,1',
      'DAY,mon,Monday',
      'EX,mon,Squat,primary,weight,*,3x5,"superset with next, hard"',
    ].join('\n');
    const { plan, issues } = parsePlanTabular(csv);
    expect(issues).toEqual([]);
    expect(plan.title).toBe('Hello, World');
    expect(plan.days[0].exercises[0].notes).toBe('superset with next, hard');
  });
});

describe('buildPlanAiPrompt', () => {
  it('contains the canonical header and core vocabulary from app.config', () => {
    const prompt = buildPlanAiPrompt();
    expect(prompt).toContain(PLAN_CSV_HEADERS.join(','));
    expect(prompt).toContain('primary');
    expect(prompt).toContain('accumulation');
    expect(prompt).toContain('weight');
  });

  it('carries the two-phase structure and the rubric', () => {
    const prompt = buildPlanAiPrompt();
    expect(prompt).toContain('PHASE 1');
    expect(prompt).toContain('PHASE 2');
    expect(prompt).toContain('PRESCRIPTION RUBRIC');
    expect(prompt).toContain('SELF-CHECK BEFORE YOU SEND');
    // The rubric is what makes the prompt reason rather than just transcribe.
    expect(prompt).toContain('Goal weighting');
    expect(prompt).toContain(`${PLAN_LENGTH.minWeeks} and ${PLAN_LENGTH.maxWeeks} weeks`);
  });

  // Preferred/avoided movements are things the profile has no field for and
  // the AI would not know to ask about otherwise. Pinned so a later prompt
  // rewrite that drops them fails loudly.
  it('asks the athlete about preferred and avoided movements', () => {
    const prompt = buildPlanAiPrompt();
    expect(prompt).toMatch(/preferred movements/i);
    expect(prompt).toMatch(/movements to avoid/i);
    expect(prompt).toMatch(/none.*fine answer/i);
  });

  /**
   * THE FORMAT GUARD. The prompt ends with a worked example, and the example is
   * `buildPlanCsvTemplate()` — so the thing the model is told to imitate is the
   * same artifact the parser is tested against. Pulling it back out of the
   * finished prompt and parsing it is what stops the two drifting apart: if the
   * example ever stops importing cleanly, the whole feature is redundant.
   */
  it('embeds a worked example that parses with zero issues', () => {
    const prompt = buildPlanAiPrompt();
    const header = PLAN_CSV_HEADERS.join(',');
    // The example is the last thing in the prompt, so the final header
    // occurrence opens it.
    const example = prompt.slice(prompt.lastIndexOf(header));
    expect(example.split('\n')[0]).toBe(header);

    const { plan, issues } = parsePlanTabular(example);
    expect(issues).toEqual([]);
    expect(plan.days.length).toBeGreaterThan(0);
    expect(validateParsedPlan(plan)).toEqual([]);
  });

  it('says the profile is missing when there is no stats row', () => {
    const prompt = buildPlanAiPrompt({ stats: null });
    expect(prompt).toContain('No profile is on file');
    expect(prompt).not.toContain('undefined');
    expect(prompt).not.toContain('NaN');
    expect(prompt).not.toContain('null');
  });

  it('renders a full profile, with goals in rank order', () => {
    const prompt = buildPlanAiPrompt({
      stats: fullStats(),
      today: new Date('2026-08-01T00:00:00Z'),
    });
    expect(prompt).toContain('- Age: 34');
    expect(prompt).toContain('- Sex: female');
    expect(prompt).toContain('- Bodyweight: 68 kg');
    expect(prompt).toContain('- Height: 170 cm');
    expect(prompt).toContain('1. Strength (70)');
    expect(prompt).toContain('2. Hypertrophy (50)');
    expect(prompt).toContain('Experience: Intermediate');
    expect(prompt).toContain('Training days available per week: 4');
    expect(prompt).toContain('Barbell, Squat rack');
    expect(prompt).toContain('Preferred disciplines: Weightlifting, Calisthenics');
    expect(prompt).toContain('Preferred plan length: 10 weeks');
    expect(prompt).toContain('Rotator cuff (shoulders, 2023)');
    // Everything is known, so nothing should be queued for the interview.
    expect(prompt).not.toContain('UNKNOWN — ask the athlete');
  });

  it('lists absent fields as UNKNOWN so phase 1 has something to ask about', () => {
    const prompt = buildPlanAiPrompt({
      stats: { ...fullStats(), birth_year: null, experience: null, equipment: [], goals: [] },
      today: new Date('2026-08-01T00:00:00Z'),
    });
    const unknown = prompt.slice(prompt.indexOf('UNKNOWN — ask the athlete'));
    expect(unknown).toContain('age');
    expect(unknown).toContain('training experience');
    expect(unknown).toContain('equipment available');
    expect(unknown).toContain('goals and their relative priority');
  });

  // app.config.ts refuses body_type a consumer on purpose; routing it into
  // prescription here would quietly overturn that decision.
  it('never sends body type', () => {
    const prompt = buildPlanAiPrompt({ stats: { ...fullStats(), body_type: 'hourglass' } });
    expect(prompt).not.toContain('hourglass');
  });
});

describe('LLM wrapper tolerance', () => {
  // Measured before the fix: a ```csv fence produced 3 issues and a "Here is
  // your plan:" line produced 2 — on files whose every data row was already
  // valid (days parsed fine in both). The header check was the only thing
  // rejecting them, and it cost the user a repair round trip.
  it('accepts output wrapped in a markdown fence', () => {
    const { plan, issues } = parsePlanTabular('```csv\n' + buildPlanCsvTemplate() + '\n```');
    expect(issues).toEqual([]);
    expect(plan.days.length).toBe(2);
  });

  it('accepts a preamble line before the header', () => {
    const { plan, issues } = parsePlanTabular('Here is your plan:\n' + buildPlanCsvTemplate());
    expect(issues).toEqual([]);
    expect(plan.days.length).toBe(2);
  });

  it('handles a fenced TSV — the fence must not fool the delimiter sniff', () => {
    const { plan, issues } = parsePlanTabular('```\n' + buildPlanTsvTemplate() + '\n```');
    expect(issues).toEqual([]);
    expect(plan.days.length).toBe(2);
  });

  // The agreed scope was fences and preamble, nothing more. A line after the
  // data might be a mistyped row, so it still reports rather than vanishing.
  it('still reports trailing prose instead of silently dropping it', () => {
    const { issues } = parsePlanTabular(buildPlanCsvTemplate() + '\n\nLet me know!');
    expect(issues.some((i) => i.includes('unknown kind'))).toBe(true);
  });

  // The bad-header error must survive: a file with no canonical header is left
  // alone so it reports against its own first line, exactly as before.
  it('still rejects a genuinely wrong header', () => {
    const { issues } = parsePlanTabular('a,b,c\nEX,monday,Squat,primary,weight,1,3x5,');
    expect(issues.some((i) => i.includes('Header row must be exactly'))).toBe(true);
  });
});

describe('buildPlanFixPrompt', () => {
  it('numbers the issues and echoes the rejected CSV', () => {
    const csv = 'kind,id\nDAY,monday';
    const prompt = buildPlanFixPrompt(['Bad section.', 'Bad metric.'], csv);
    expect(prompt).toContain('1. Bad section.');
    expect(prompt).toContain('2. Bad metric.');
    expect(prompt).toContain(csv);
    // The original prompt may have scrolled out of the chat by now.
    expect(prompt).toContain(PLAN_CSV_HEADERS.join(','));
    expect(prompt).toContain('warmup, primary');
  });

  it('omits the echo when the upload was a workbook', () => {
    const prompt = buildPlanFixPrompt(['Bad section.'], '');
    expect(prompt).toContain('1. Bad section.');
    expect(prompt).toContain('uploaded as a spreadsheet');
  });
});

describe('parsePlanWorkbook (xlsx)', () => {
  async function buildXlsx(rows: string[][]): Promise<ArrayBuffer> {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Plan');
    for (const row of rows) ws.addRow(row);
    const buf = await wb.xlsx.writeBuffer();
    return buf as ArrayBuffer;
  }

  it('parses an xlsx with the canonical header equivalently to CSV', async () => {
    // Hand-built rows so quoted commas and newlines aren't a concern.
    const rows: string[][] = [
      [...PLAN_CSV_HEADERS],
      ['META', 'title', 'Mini Plan', '', '', '', '', ''],
      ['META', 'start', '2026-06-01', '', '', '', '', ''],
      ['META', 'weeks', '2', '', '', '', '', ''],
      ['BLOCK', 'accumulation', '', '', '', '1-2', '', ''],
      ['DAY', 'mon', 'Monday', '', '', '', '', ''],
      ['EX', 'mon', 'Back Squat', 'primary', 'weight', '1', '3x5', ''],
      ['EX', 'mon', 'Back Squat', 'primary', 'weight', '2', '4x5', ''],
      ['EX', 'mon', 'Leg Press', 'accessory', 'reps', '*', '3x12', 'meters, on 2:00'],
    ];
    const buf = await buildXlsx(rows);
    const fromXlsx = await parsePlanWorkbook(buf);

    const csvText =
      [
        PLAN_CSV_HEADERS.join(','),
        'META,title,Mini Plan',
        'META,start,2026-06-01',
        'META,weeks,2',
        'BLOCK,accumulation,,,,1-2,,',
        'DAY,mon,Monday',
        'EX,mon,Back Squat,primary,weight,1,3x5,',
        'EX,mon,Back Squat,primary,weight,2,4x5,',
        'EX,mon,Leg Press,accessory,reps,*,3x12,"meters, on 2:00"',
      ].join('\n') + '\n';
    const fromCsv = parsePlanTabular(csvText);

    expect(fromXlsx.issues).toEqual([]);
    expect(fromXlsx.plan).toEqual(fromCsv.plan);
  });

  it('locates the header row even with leading blank/preamble rows', async () => {
    const buf = await buildXlsx([
      ['My AI export', '', '', '', '', '', '', ''],
      [],
      [...PLAN_CSV_HEADERS],
      ['META', 'title', 'Tiny', '', '', '', '', ''],
      ['META', 'weeks', '1', '', '', '', '', ''],
      ['DAY', 'mon', 'Monday', '', '', '', '', ''],
      ['EX', 'mon', 'Squat', 'primary', 'weight', '*', '3x5', ''],
    ]);
    const { plan, issues } = await parsePlanWorkbook(buf);
    expect(issues).toEqual([]);
    expect(plan.title).toBe('Tiny');
    expect(plan.days[0].exercises[0].movement).toBe('Squat');
  });

  it('reports a useful issue when the header is missing', async () => {
    const buf = await buildXlsx([
      ['wrong', 'header', 'row'],
      ['META', 'title', 'X'],
    ]);
    const { issues } = await parsePlanWorkbook(buf);
    expect(issues.some((i) => i.includes('Could not find header row'))).toBe(true);
  });
});

describe('validateParsedPlan', () => {
  it('passes on a minimal valid plan', () => {
    const issues = validateParsedPlan({
      title: 'T',
      startDate: null,
      endDate: null,
      blocks: [],
      weeklyTemplate: ['mon'],
      days: [
        {
          dayKey: 'mon',
          label: 'Monday',
          exercises: [
            { movement: 'Squat', section: 'primary', primaryMetric: 'weight', plannedByWeek: { 1: '3x5' } },
          ],
        },
      ],
    });
    expect(issues).toEqual([]);
  });

  it('catches empty plan', () => {
    const issues = validateParsedPlan({
      title: '',
      startDate: null,
      endDate: null,
      blocks: [],
      weeklyTemplate: [],
      days: [],
    });
    expect(issues).toContain('Plan title is required.');
    expect(issues).toContain('Plan needs at least one day.');
  });

  const planWithSubroutine = (description: string, title = 'Breathe') => ({
    title: 'T',
    startDate: null,
    endDate: null,
    blocks: [],
    weeklyTemplate: ['mon'],
    days: [
      {
        dayKey: 'mon',
        label: 'Monday',
        exercises: [
          {
            kind: 'subroutine' as const,
            movement: title,
            section: 'cooldown' as const,
            primaryMetric: 'reps' as const,
            plannedByWeek: {},
            description,
          },
        ],
      },
    ],
  });

  it('accepts a valid subroutine and does not require planned sets', () => {
    const issues = validateParsedPlan(planWithSubroutine('Box breathing, 5 rounds.'));
    expect(issues).toEqual([]);
  });

  it('flags a subroutine with no title and one with no description', () => {
    expect(validateParsedPlan(planWithSubroutine('Breathe', '')).some((i) => i.includes('subroutine with no title'))).toBe(true);
    expect(validateParsedPlan(planWithSubroutine('')).some((i) => i.includes('needs a description'))).toBe(true);
  });

  it('flags a subroutine description over 300 characters', () => {
    const issues = validateParsedPlan(planWithSubroutine('x'.repeat(301)));
    expect(issues.some((i) => i.includes('exceeds 300 characters'))).toBe(true);
  });
});
