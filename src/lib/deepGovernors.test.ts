import { describe, expect, it } from 'vitest';
import { contradictionSeverity, disconfirmationCredibility } from './deepGovernors';

// Mirrors TradingView tests/test_rx_deep_governors.py — the TS port must agree
// with the Python governor so the fitness path enforces the same thresholds.

describe('contradictionSeverity (alarm-fatigue guard)', () => {
  it('pair raises high banner', () => {
    const v = contradictionSeverity({ contradictory_pairs: [{ a: 'x', b: 'y' }], contradicts_count: 0 });
    expect(v.severity).toBe('high');
    expect(v.raiseBanner).toBe(true);
  });
  it('two contradictions raise high', () => {
    expect(contradictionSeverity({ contradicts_count: 2 }).raiseBanner).toBe(true);
  });
  it('single contradiction is medium banner', () => {
    const v = contradictionSeverity({ contradicts_count: 1 });
    expect(v.severity).toBe('medium');
    expect(v.raiseBanner).toBe(true);
  });
  it('staleness only → no banner', () => {
    const v = contradictionSeverity({ contradicts_count: 0, stale_count: 3 });
    expect(v.severity).toBe('low');
    expect(v.raiseBanner).toBe(false);
  });
  it('aligned → no banner', () => {
    expect(contradictionSeverity({ contradicts_count: 0, stale_count: 0 }).raiseBanner).toBe(false);
  });
  it('derives count from sources', () => {
    const v = contradictionSeverity({
      sources: [{ stance: 'contradicts' }, { stance: 'contradicts' }, { stance: 'supports' }],
    });
    expect(v.contradictsCount).toBe(2);
    expect(v.severity).toBe('high');
  });
});

describe('disconfirmationCredibility (web-surface-bias guard)', () => {
  it('single source capped at thin despite self strong', () => {
    const v = disconfirmationCredibility({ strength: 'strong', sources: [{ publisher: 'Blog', tier: 'low' }] });
    expect(v.credibility).toBe('thin');
    expect(v.countsAgainstThesis).toBe(false);
  });
  it('three reputable publishers can be strong', () => {
    const v = disconfirmationCredibility({
      strength: 'strong',
      sources: [
        { publisher: 'WSJ', tier: 'reputable' },
        { publisher: 'FT', tier: 'reputable' },
        { publisher: '10-K', tier: 'primary' },
      ],
    });
    expect(v.credibility).toBe('strong');
    expect(v.countsAgainstThesis).toBe(true);
  });
  it('two publishers moderate', () => {
    const v = disconfirmationCredibility({
      strength: 'strong',
      sources: [
        { publisher: 'WSJ', tier: 'reputable' },
        { publisher: 'Bloomberg', tier: 'reputable' },
      ],
    });
    expect(v.credibility).toBe('moderate');
  });
  it('never inflates above self-report', () => {
    const v = disconfirmationCredibility({
      strength: 'none',
      sources: [
        { publisher: 'A', tier: 'reputable' },
        { publisher: 'B', tier: 'reputable' },
        { publisher: 'C', tier: 'primary' },
      ],
    });
    expect(v.credibility).toBe('none');
  });
  it('no sources → none', () => {
    expect(disconfirmationCredibility({ strength: 'moderate', sources: [] }).credibility).toBe('none');
  });
});
