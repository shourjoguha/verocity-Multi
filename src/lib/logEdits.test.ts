import { describe, expect, it } from 'vitest';
import { addSet, addSubroutine, isGroupComplete, patchSetActual, setSubroutine } from '@/lib/logEdits';
import { isSubroutine, safeHref } from '@/lib/subroutine';
import type { LogDocument, LogGroup } from '@/lib/types';

const blank: LogDocument = { sections: [{ key: 'cooldown', groups: [] }] };

// A one-section doc whose single group holds movements each with `setsPer`
// incomplete sets. Two movements ⇒ a superset.
function docWith(setsPer: number, movements = 1): LogDocument {
  const mkItem = (n: number) => ({
    id: `i${n}`,
    movement: `m${n}`,
    primaryMetric: 'weight' as const,
    sets: Array.from({ length: setsPer }, () => ({
      planned: null,
      actual: { completed: false, prefilled: false },
      notations: [],
    })),
  });
  const group: LogGroup = {
    id: 'g1',
    kind: movements > 1 ? 'superset' : 'single',
    items: Array.from({ length: movements }, (_, i) => mkItem(i)),
  };
  return { sections: [{ key: 'primary', groups: [group] }] };
}

describe('addSubroutine', () => {
  it('appends a single-item subroutine group with no sets', () => {
    const doc = addSubroutine(blank, 'cooldown', 'Box breathing', 'Breathe.', 'https://x.test');
    const item = doc.sections[0].groups[0].items[0];
    expect(doc.sections[0].groups[0].kind).toBe('single');
    expect(isSubroutine(item)).toBe(true);
    expect(item.movement).toBe('Box breathing');
    expect(item.description).toBe('Breathe.');
    expect(item.url).toBe('https://x.test');
    expect(item.sets).toHaveLength(0);
  });

  it('creates the section when it is absent', () => {
    const doc = addSubroutine({ sections: [] }, 'warmup', 'Mobility', 'Flow.');
    expect(doc.sections.map((s) => s.key)).toEqual(['warmup']);
    expect(doc.sections[0].groups[0].items[0].url).toBeUndefined();
  });
});

describe('setSubroutine', () => {
  const doc = addSubroutine(blank, 'cooldown', 'Old', 'Old body', 'https://old.test');

  it('patches only the provided fields', () => {
    const next = setSubroutine(doc, 0, 0, 0, { title: 'New', description: 'New body' });
    const item = next.sections[0].groups[0].items[0];
    expect(item.movement).toBe('New');
    expect(item.description).toBe('New body');
    expect(item.url).toBe('https://old.test'); // untouched
  });

  it('clears the url when passed an empty string', () => {
    const next = setSubroutine(doc, 0, 0, 0, { url: '' });
    expect(next.sections[0].groups[0].items[0].url).toBeUndefined();
  });
});

describe('isGroupComplete', () => {
  it('is false while any set is unticked, true when every set is done', () => {
    let doc = docWith(2);
    expect(isGroupComplete(doc.sections[0].groups[0])).toBe(false);
    doc = patchSetActual(doc, 0, 0, 0, 0, { completed: true });
    expect(isGroupComplete(doc.sections[0].groups[0])).toBe(false); // one set left
    doc = patchSetActual(doc, 0, 0, 0, 1, { completed: true });
    expect(isGroupComplete(doc.sections[0].groups[0])).toBe(true);
  });

  it('needs every movement complete in a superset', () => {
    let doc = docWith(1, 2);
    doc = patchSetActual(doc, 0, 0, 0, 0, { completed: true }); // first movement only
    expect(isGroupComplete(doc.sections[0].groups[0])).toBe(false);
    doc = patchSetActual(doc, 0, 0, 1, 0, { completed: true });
    expect(isGroupComplete(doc.sections[0].groups[0])).toBe(true);
  });

  it('is never complete for a subroutine-only group', () => {
    const doc = addSubroutine(blank, 'cooldown', 'Breathe', 'in/out');
    expect(isGroupComplete(doc.sections[0].groups[0])).toBe(false);
  });
});

describe('completedAt stamping', () => {
  it('stamps when the last set completes and clears when it goes incomplete', () => {
    let doc = docWith(1);
    expect(doc.sections[0].groups[0].completedAt).toBeUndefined();
    doc = patchSetActual(doc, 0, 0, 0, 0, { completed: true });
    expect(doc.sections[0].groups[0].completedAt).toBeTruthy();
    doc = patchSetActual(doc, 0, 0, 0, 0, { completed: false });
    expect(doc.sections[0].groups[0].completedAt).toBeUndefined();
  });

  it('clears when an incomplete set is added to a complete group', () => {
    let doc = docWith(1);
    doc = patchSetActual(doc, 0, 0, 0, 0, { completed: true });
    expect(doc.sections[0].groups[0].completedAt).toBeTruthy();
    doc = addSet(doc, 0, 0, 0);
    expect(doc.sections[0].groups[0].completedAt).toBeUndefined();
  });

  it('does not move an existing completion timestamp when the group is touched again', () => {
    let doc = docWith(2);
    doc = patchSetActual(doc, 0, 0, 0, 0, { completed: true });
    doc = patchSetActual(doc, 0, 0, 0, 1, { completed: true });
    const stamp = doc.sections[0].groups[0].completedAt;
    expect(stamp).toBeTruthy();
    // A later edit that keeps the group complete must preserve the first stamp.
    doc = patchSetActual(doc, 0, 0, 0, 1, { weight: 100 });
    expect(doc.sections[0].groups[0].completedAt).toBe(stamp);
  });
});

describe('safeHref', () => {
  it('passes through http/https and promotes bare hosts', () => {
    expect(safeHref('https://a.test/x')).toBe('https://a.test/x');
    expect(safeHref('a.test/x')).toBe('https://a.test/x');
  });

  it('rejects non-http schemes and empty input', () => {
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('')).toBeNull();
    expect(safeHref(undefined)).toBeNull();
  });
});
