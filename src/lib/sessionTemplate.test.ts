import { describe, expect, it } from 'vitest';
import { SUBROUTINE } from '@/app.config';
import type { ScalingLevel, SessionType, GroupKind } from '@/lib/types';
import {
  SESSION_CSV_HEADERS,
  buildSessionAiPrompt,
  buildSessionCsvTemplate,
  buildSessionTsvTemplate,
  parseSessionTabular,
  validateSessions,
} from '@/lib/sessionTemplate';

const SESSION_TYPES: SessionType[] = [
  'AMRAP',
  'EMOM',
  'FOR_TIME',
  'FOR_TOTAL_REPS',
  'FOR_TOTAL_DISTANCE',
  'FOR_LOAD',
  'INTERVALS',
  'ROUNDS_FOR_TIME',
  'CHIPPER',
  'PARTNER',
  'OTHER',
];
const SCALING_LEVELS: ScalingLevel[] = ['rx', 'intermediate', 'beginner'];
const GROUP_KINDS: GroupKind[] = ['single', 'superset', 'circuit'];

describe('session CSV template', () => {
  it('CSV starts with the canonical header row', () => {
    const csv = buildSessionCsvTemplate();
    expect(csv.split('\n')[0]).toBe(SESSION_CSV_HEADERS.join(','));
  });

  it('TSV uses tab delimiter and matches CSV row count', () => {
    const tsv = buildSessionTsvTemplate();
    const csv = buildSessionCsvTemplate();
    expect(tsv.split('\n')[0]).toBe(SESSION_CSV_HEADERS.join('\t'));
    expect(tsv.split('\n').length).toBe(csv.split('\n').length);
  });

  it('round-trips: template parses into valid sessions with no issues', () => {
    const { sessions, issues } = parseSessionTabular(buildSessionCsvTemplate());
    expect(issues).toEqual([]);
    expect(validateSessions(sessions)).toEqual([]);
    expect(sessions).toHaveLength(2);
  });

  it('includes both a flat strength session and a structured session with variants', () => {
    const { sessions } = parseSessionTabular(buildSessionCsvTemplate());
    const strength = sessions.find((s) => s.name === 'Push Day')!;
    expect(strength).toBeDefined();
    expect(strength.frame.variants).toBeUndefined();
    expect(strength.frame.exercises.length).toBeGreaterThan(0);
    // Flat session: every group is a single-item "single" group.
    expect(strength.frame.groups!.every((g) => g.kind === 'single' && g.items.length === 1)).toBe(true);

    const fran = sessions.find((s) => s.name === 'Fran')!;
    expect(fran).toBeDefined();
    expect(fran.session_type).toBe('FOR_TIME');
    expect(fran.time_cap_seconds).toBe(600);
    expect(fran.frame.groups).toBeDefined();
    expect(fran.frame.groups![0].kind).toBe('circuit');
    expect(fran.frame.variants).toHaveLength(3);
    const levels = fran.frame.variants!.map((v) => v.level).sort();
    expect(levels).toEqual(['beginner', 'intermediate', 'rx']);
    const beginner = fran.frame.variants!.find((v) => v.level === 'beginner')!;
    expect(beginner.timeCapSeconds).toBe(900);
    expect(beginner.label).toBe('Foundations');
  });

  it('TSV parses identically to CSV', () => {
    const fromCsv = parseSessionTabular(buildSessionCsvTemplate()).sessions;
    const fromTsv = parseSessionTabular(buildSessionTsvTemplate()).sessions;
    expect(fromTsv).toEqual(fromCsv);
  });
});

describe('buildSessionAiPrompt', () => {
  it('contains the canonical header', () => {
    expect(buildSessionAiPrompt()).toContain(SESSION_CSV_HEADERS.join(','));
  });

  it('names every SessionType', () => {
    const prompt = buildSessionAiPrompt();
    for (const t of SESSION_TYPES) expect(prompt).toContain(t);
  });

  it('names every ScalingLevel', () => {
    const prompt = buildSessionAiPrompt();
    for (const l of SCALING_LEVELS) expect(prompt).toContain(l);
  });

  it('names every GroupKind', () => {
    const prompt = buildSessionAiPrompt();
    for (const k of GROUP_KINDS) expect(prompt).toContain(k);
  });
});

describe('session tabular parser — compatibility checks', () => {
  it('flags bad header', () => {
    const { issues } = parseSessionTabular('a,b,c\nSESSION,x,X');
    expect(issues.some((i) => i.includes('Header row must be exactly'))).toBe(true);
  });

  it('flags a session with no name', () => {
    const csv = [SESSION_CSV_HEADERS.join(','), 'SESSION,mystery,', 'EX,mystery,Squat,primary,weight,,3x5,'].join(
      '\n',
    );
    const { issues } = parseSessionTabular(csv);
    expect(issues.some((i) => i.includes('missing a name'))).toBe(true);
  });

  it('flags unknown session_type', () => {
    const csv = [
      SESSION_CSV_HEADERS.join(','),
      'SESSION,mystery,Mystery WOD',
      'META,session_type,MADE_UP',
      'EX,mystery,Squat,primary,weight,,3x5,',
    ].join('\n');
    const { issues } = parseSessionTabular(csv);
    expect(issues.some((i) => i.includes('unknown session_type'))).toBe(true);
  });

  it('flags unknown section and metric on an EX row', () => {
    const csv = [
      SESSION_CSV_HEADERS.join(','),
      'SESSION,mon,Monday',
      'EX,mon,Squat,turbo,weight,,3x5,',
      'EX,mon,Press,primary,joules,,3x5,',
    ].join('\n');
    const { issues } = parseSessionTabular(csv);
    expect(issues.some((i) => i.includes('section "turbo"'))).toBe(true);
    expect(issues.some((i) => i.includes('metric "joules"'))).toBe(true);
  });

  it('flags a subroutine description over the character cap', () => {
    const csv = [
      SESSION_CSV_HEADERS.join(','),
      'SESSION,mon,Monday',
      ['SUB', 'mon', 'Breathe', 'cooldown', '', '', '', 'x'.repeat(SUBROUTINE.maxDescriptionChars + 1)].join(','),
    ].join('\n');
    const { issues } = parseSessionTabular(csv);
    expect(issues.some((i) => i.includes(`exceeds ${SUBROUTINE.maxDescriptionChars} characters`))).toBe(true);
  });

  it('flags a variant with an unknown level', () => {
    const csv = [
      SESSION_CSV_HEADERS.join(','),
      'SESSION,mon,Monday',
      'EX,mon,Squat,primary,weight,,3x5,',
      'VARIANT,mon,elite:Elite',
      'EX,mon,Squat,primary,weight,,5x3,',
    ].join('\n');
    const { issues } = parseSessionTabular(csv);
    expect(issues.some((i) => i.includes('unknown variant level'))).toBe(true);
  });
});
