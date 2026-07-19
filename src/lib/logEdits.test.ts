import { describe, expect, it } from 'vitest';
import { addSubroutine, setSubroutine } from '@/lib/logEdits';
import { isSubroutine, safeHref } from '@/lib/subroutine';
import type { LogDocument } from '@/lib/types';

const blank: LogDocument = { sections: [{ key: 'cooldown', groups: [] }] };

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
