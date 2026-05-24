import { describe, expect, it } from 'vitest';
import { parseVoiceSet } from '@/lib/voice';

describe('parseVoiceSet', () => {
  it('parses "weight for reps at rpe"', () => {
    expect(parseVoiceSet('100 for 5 at 8')).toEqual({ weight: 100, reps: 5, rpe: 8 });
  });

  it('parses explicit units and keywords', () => {
    expect(parseVoiceSet('100 kilos 5 reps rpe 8')).toEqual({ weight: 100, reps: 5, rpe: 8 });
  });

  it('parses two bare numbers as weight then reps', () => {
    expect(parseVoiceSet('100 5')).toEqual({ weight: 100, reps: 5 });
  });

  it('treats bodyweight as zero load', () => {
    expect(parseVoiceSet('bodyweight 10')).toEqual({ weight: 0, reps: 10 });
  });

  it('ignores a leading movement word', () => {
    expect(parseVoiceSet('squat 140 for 3')).toEqual({ weight: 140, reps: 3 });
  });

  it('parses distance in meters and kilometers', () => {
    expect(parseVoiceSet('row 500 meters')).toEqual({ distance: 500 });
    expect(parseVoiceSet('run 5 km')).toEqual({ distance: 5000 });
  });

  it('parses time in minutes and seconds', () => {
    expect(parseVoiceSet('plank 90 seconds')).toEqual({ time: 90 });
    expect(parseVoiceSet('hold 1 minute 30 seconds')).toEqual({ time: 90 });
  });

  it('returns an empty object when nothing is recognized', () => {
    expect(parseVoiceSet('no numbers here')).toEqual({});
  });
});
