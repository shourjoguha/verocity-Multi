import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import {
  PLAN_CSV_HEADERS,
  buildPlanAiPrompt,
  buildPlanCsvTemplate,
  buildPlanTsvTemplate,
  parsePlanTabular,
  parsePlanWorkbook,
  validateParsedPlan,
} from '@/lib/planTemplate';

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
  });

  it('TSV parses identically to CSV', () => {
    const fromCsv = parsePlanTabular(buildPlanCsvTemplate()).plan;
    const fromTsv = parsePlanTabular(buildPlanTsvTemplate()).plan;
    expect(fromTsv).toEqual(fromCsv);
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
});
