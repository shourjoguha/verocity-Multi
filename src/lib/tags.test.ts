import { describe, expect, it } from 'vitest';
import { ACTIVITY_TAGS, ACTIVITY_TYPE_TAGS } from '@/app.config';
import { retagForType, sessionTagColors, stripeBackground, tagColor, tagWash } from '@/lib/tags';

describe('stripeBackground', () => {
  it('returns undefined below two colors, so the caller stays on a solid fill', () => {
    expect(stripeBackground([])).toBeUndefined();
    expect(stripeBackground(['#084A24'])).toBeUndefined();
  });

  it('emits a 45° repeating gradient naming each color once', () => {
    const bg = stripeBackground(['#084A24', '#1DBD8E']);
    expect(bg).toBe('repeating-linear-gradient(45deg, #084A24 0px 4px, #1DBD8E 4px 8px)');
  });

  it('lays bands end to end for three or more colors', () => {
    const bg = stripeBackground(['#a', '#b', '#c'], 3);
    expect(bg).toBe('repeating-linear-gradient(45deg, #a 0px 3px, #b 3px 6px, #c 6px 9px)');
  });
});

describe('sessionTagColors', () => {
  it('dedupes tags that share a color', () => {
    // Two tags, one color each — a day of two strength sessions must collapse to
    // a single color or the heatmap would stripe a single-activity day.
    expect(sessionTagColors(['strength', 'strength'])).toEqual([ACTIVITY_TAGS.strength.color]);
  });

  it('keeps distinct colors in order', () => {
    expect(sessionTagColors(['strength', 'mobility'])).toEqual([
      ACTIVITY_TAGS.strength.color,
      ACTIVITY_TAGS.mobility.color,
    ]);
  });

  it('falls back to the activity type, then to strength, when there are no tags', () => {
    expect(sessionTagColors([], 'endurance')).toEqual([ACTIVITY_TAGS.endurance.color]);
    expect(sessionTagColors([])).toEqual([ACTIVITY_TAGS.strength.color]);
  });

  it('collapses unknown tags onto one fallback color', () => {
    // Both resolve to the muted fallback, so they must not read as two activities.
    expect(sessionTagColors(['whittling', 'yodelling'])).toEqual([tagColor('whittling')]);
  });
});

describe('retagForType', () => {
  it('switches Sport on for the court sports', () => {
    expect(ACTIVITY_TYPE_TAGS.Padel).toBe('sport');
    expect(ACTIVITY_TYPE_TAGS.Tennis).toBe('sport');
    expect(retagForType([], null, 'sport')).toEqual({ tags: ['sport'], autoTag: 'sport' });
  });

  // Recovery is what keeps a sauna out of the coach's training-day counts.
  it('switches Recovery on for Sauna', () => {
    expect(ACTIVITY_TYPE_TAGS.Sauna).toBe('recovery');
  });

  it('takes an automatic tag back off when the type changes away', () => {
    // Padel, then Run: the run must not be saved tagged Sport.
    expect(retagForType(['sport'], 'sport', null)).toEqual({ tags: [], autoTag: null });
  });

  it('keeps the automatic tag across Padel -> Tennis', () => {
    expect(retagForType(['sport'], 'sport', 'sport')).toEqual({ tags: ['sport'], autoTag: 'sport' });
  });

  it('never removes a tag the athlete set by hand', () => {
    // Sport was on before Padel was picked, so it is not Padel's to take away.
    const picked = retagForType(['sport'], null, 'sport');
    expect(picked).toEqual({ tags: ['sport'], autoTag: null });
    expect(retagForType(picked.tags, picked.autoTag, null)).toEqual({ tags: ['sport'], autoTag: null });
  });

  it('leaves other tags alone', () => {
    expect(retagForType(['recovery'], null, 'sport')).toEqual({
      tags: ['recovery', 'sport'],
      autoTag: 'sport',
    });
    expect(retagForType(['recovery', 'sport'], 'sport', null)).toEqual({
      tags: ['recovery'],
      autoTag: null,
    });
  });
});

describe('tagWash', () => {
  it('mixes one colour into the surface', () => {
    expect(tagWash(['var(--tag-sport)'], 14)).toBe('color-mix(in srgb, var(--tag-sport) 14%, var(--color-surface))');
  });

  it('splits several colours into equal hard-edged diagonal parts', () => {
    expect(tagWash(['#a', '#b'], 50)).toBe(
      'linear-gradient(135deg, color-mix(in srgb, #a 50%, var(--color-surface)) 0% 50%, color-mix(in srgb, #b 50%, var(--color-surface)) 50% 100%)',
    );
  });
});

describe('ACTIVITY_TAGS colours', () => {
  it('are theme tokens, never raw hexes', () => {
    for (const { color } of Object.values(ACTIVITY_TAGS)) expect(color).toMatch(/^var\(--tag-[a-z]+\)$/);
  });
});
