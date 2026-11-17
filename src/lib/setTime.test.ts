import { describe, expect, it } from 'vitest';
import { SET_TIME } from '@/app.config';
import { classifyMovement } from '@/lib/movementTaxonomy';
import { movementKind, setClockSeconds, setWorkSeconds } from '@/lib/setTime';
import type { LogSet } from '@/lib/types';

const set = (actual: Partial<LogSet['actual']>, notations: string[] = []): LogSet =>
  ({ planned: null, notations, actual: { completed: true, prefilled: false, ...actual } }) as LogSet;
const profile = (name: string) => classifyMovement(name).profile;

describe('movementKind', () => {
  it('reads the kind off the taxonomy', () => {
    expect(movementKind(profile('Back Squat'))).toBe('lower');
    expect(movementKind(profile('Hip Thrust'))).toBe('lower');
    expect(movementKind(profile('Bench Press'))).toBe('upper');
    expect(movementKind(profile('Pull-Up'))).toBe('upper');
    expect(movementKind(profile('Bicep Curl'))).toBe('isolation');
    expect(movementKind(profile('Rear Delt Fly'))).toBe('isolation');
    expect(movementKind(profile('Plank'))).toBe('core');
    expect(movementKind(profile('Kettlebell Swing'))).toBe('ballistic');
    expect(movementKind(null)).toBe('upper');
  });
});

describe('setWorkSeconds — the owner\'s SET_TIME', () => {
  const squat = profile('Back Squat');

  it('prices a strength squat set from its kind and intent', () => {
    const k = SET_TIME.kinds.lower;
    expect(setWorkSeconds(set({ weight: 100, reps: 5 }), squat)).toBeCloseTo(5 * k.repSeconds * SET_TIME.intent.strength, 5);
    expect(setWorkSeconds(set({ weight: 80, reps: 10 }), squat)).toBeCloseTo(10 * k.repSeconds, 5);
  });

  it('a paused squat costs more per rep than a rear-delt fly', () => {
    const paused = setWorkSeconds(set({ weight: 100, reps: 5 }, ['(p)']), squat) / 5;
    const fly = setWorkSeconds(set({ weight: 8, reps: 15 }), profile('Rear Delt Fly')) / 15;
    expect(paused).toBeGreaterThan(fly * 2);
  });

  it('doubles a per-side set and adds the switch', () => {
    const one = setWorkSeconds(set({ weight: 20, reps: 8 }), profile('Bulgarian Split Squat'));
    const both = setWorkSeconds(set({ weight: 20, reps: 8 }, ['/side']), profile('Bulgarian Split Squat'));
    expect(both).toBeCloseTo(one * 2 + SET_TIME.sideSwitchSeconds, 5);
  });

  it('slows reps near failure and speeds them in a conditioning block', () => {
    const at7 = setWorkSeconds(set({ weight: 80, reps: 10, rpe: 7 }), squat);
    const at9 = setWorkSeconds(set({ weight: 80, reps: 10, rpe: SET_TIME.nearFailureRpe }), squat);
    expect(at9).toBeCloseTo(at7 * SET_TIME.nearFailureFactor, 5);
    expect(setWorkSeconds(set({ weight: 80, reps: 10 }), squat, 'conditioning')).toBeCloseTo(at7 * SET_TIME.intent.conditioning, 5);
  });

  it('keeps a timed set at its logged time, with no setup', () => {
    const plank = set({ time: 45 });
    expect(setWorkSeconds(plank, profile('Plank'))).toBe(45);
    expect(setClockSeconds(plank, profile('Plank'))).toBe(45);
  });

  it('adds setup to a rep-counted set\'s clock cost', () => {
    const s = set({ weight: 100, reps: 5 });
    expect(setClockSeconds(s, squat)).toBeCloseTo(SET_TIME.kinds.lower.setupSeconds + setWorkSeconds(s, squat), 5);
  });
});
