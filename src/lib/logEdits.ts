// Pure, immutable transforms on a LogDocument. The Logger island calls these
// from setDoc(...) so all the structural editing (sets, metric swap, movement
// add/swap/remove, superset grouping) stays out of the component and testable.
import { RPE, type MetricKey } from '@/app.config';
import type { GroupKind, LogDocument, LogGroup, LogItem, SetActual } from '@/lib/types';
import { isSubroutine } from '@/lib/subroutine';

function newId(): string {
  return crypto.randomUUID();
}

function emptyActual(): SetActual {
  return { completed: false, prefilled: false, rpe: RPE.default };
}

function mapSection(doc: LogDocument, si: number, fn: (s: LogDocument['sections'][number]) => LogDocument['sections'][number]): LogDocument {
  return { ...doc, sections: doc.sections.map((s, i) => (i === si ? fn(s) : s)) };
}

function mapGroup(doc: LogDocument, si: number, gi: number, fn: (g: LogGroup) => LogGroup): LogDocument {
  return mapSection(doc, si, (s) => ({ ...s, groups: s.groups.map((g, i) => (i === gi ? restampGroup(fn(g)) : g)) }));
}

// A group is fully complete when it has at least one set-bearing item and every
// such item has all its sets completed. Subroutine items (no sets) are ignored,
// so a subroutine-only group is never "complete".
export function isGroupComplete(group: LogGroup): boolean {
  const setItems = group.items.filter((it) => !isSubroutine(it));
  if (setItems.length === 0) return false;
  return setItems.every((it) => it.sets.length > 0 && it.sets.every((s) => s.actual.completed));
}

// Stamp completedAt the first time a group becomes fully complete (preserving
// that first timestamp = completion order), and clear it when the group is no
// longer complete. Idempotent — applied on every group mutation.
function restampGroup(group: LogGroup): LogGroup {
  const complete = isGroupComplete(group);
  if (complete && !group.completedAt) return { ...group, completedAt: new Date().toISOString() };
  if (!complete && group.completedAt) {
    const { completedAt: _completedAt, ...rest } = group;
    return rest;
  }
  return group;
}

function mapItem(doc: LogDocument, si: number, gi: number, ii: number, fn: (it: LogItem) => LogItem): LogDocument {
  return mapGroup(doc, si, gi, (g) => ({ ...g, items: g.items.map((it, i) => (i === ii ? fn(it) : it)) }));
}

export function patchSetActual(
  doc: LogDocument,
  si: number,
  gi: number,
  ii: number,
  ki: number,
  patch: Partial<SetActual>,
): LogDocument {
  return mapItem(doc, si, gi, ii, (it) => ({
    ...it,
    sets: it.sets.map((set, i) => (i === ki ? { ...set, actual: { ...set.actual, ...patch } } : set)),
  }));
}

// Append a set, carrying weight/reps forward from the last set as a prefill.
export function addSet(doc: LogDocument, si: number, gi: number, ii: number): LogDocument {
  return mapItem(doc, si, gi, ii, (it) => {
    if (isSubroutine(it)) return it; // subroutines have no sets
    const prev = it.sets[it.sets.length - 1];
    return {
      ...it,
      sets: [
        ...it.sets,
        {
          planned: prev?.planned ?? null,
          actual: {
            weight: prev?.actual.weight,
            reps: prev?.actual.reps,
            rpe: prev?.actual.rpe ?? RPE.default,
            completed: false,
            prefilled: true,
          },
          notations: [],
        },
      ],
    };
  });
}

export function removeSet(doc: LogDocument, si: number, gi: number, ii: number, ki: number): LogDocument {
  return mapItem(doc, si, gi, ii, (it) => ({ ...it, sets: it.sets.filter((_, i) => i !== ki) }));
}

export function setItemMetric(doc: LogDocument, si: number, gi: number, ii: number, metric: MetricKey): LogDocument {
  return mapItem(doc, si, gi, ii, (it) => ({ ...it, primaryMetric: metric }));
}

export function setItemRest(doc: LogDocument, si: number, gi: number, ii: number, seconds: number): LogDocument {
  return mapItem(doc, si, gi, ii, (it) => ({ ...it, restSeconds: seconds }));
}

// Swap the movement on an item, resetting actuals but keeping the set count and
// planned targets (the prescription survives a substitution).
export function swapItemMovement(
  doc: LogDocument,
  si: number,
  gi: number,
  ii: number,
  movement: string,
  primaryMetric: MetricKey,
): LogDocument {
  return mapItem(doc, si, gi, ii, (it) => ({
    ...it,
    movement,
    primaryMetric,
    sets: it.sets.map((set) => ({ ...set, actual: emptyActual() })),
  }));
}

// Append a movement as a new single-item group to a section (creating it if needed).
export function addItem(
  doc: LogDocument,
  sectionKey: LogDocument['sections'][number]['key'],
  movement: string,
  primaryMetric: MetricKey,
): LogDocument {
  const item: LogItem = {
    id: newId(),
    movement,
    primaryMetric,
    sets: [{ planned: null, actual: emptyActual(), notations: [] }],
  };
  const group: LogGroup = { id: newId(), kind: 'single', items: [item] };
  const idx = doc.sections.findIndex((s) => s.key === sectionKey);
  if (idx < 0) return { ...doc, sections: [...doc.sections, { key: sectionKey, groups: [group] }] };
  return mapSection(doc, idx, (s) => ({ ...s, groups: [...s.groups, group] }));
}

// Append a subroutine (free-text block) as a new single-item group. Like a
// movement it lives in a section, but carries a title/description/link and no
// sets. primaryMetric is a harmless default (never rendered for subroutines).
export function addSubroutine(
  doc: LogDocument,
  sectionKey: LogDocument['sections'][number]['key'],
  title: string,
  description: string,
  url?: string,
): LogDocument {
  const item: LogItem = {
    id: newId(),
    kind: 'subroutine',
    movement: title,
    description,
    ...(url ? { url } : {}),
    primaryMetric: 'reps',
    sets: [],
  };
  const group: LogGroup = { id: newId(), kind: 'single', items: [item] };
  const idx = doc.sections.findIndex((s) => s.key === sectionKey);
  if (idx < 0) return { ...doc, sections: [...doc.sections, { key: sectionKey, groups: [group] }] };
  return mapSection(doc, idx, (s) => ({ ...s, groups: [...s.groups, group] }));
}

// Patch a subroutine's title/description/link. Empty url clears it.
export function setSubroutine(
  doc: LogDocument,
  si: number,
  gi: number,
  ii: number,
  patch: { title?: string; description?: string; url?: string },
): LogDocument {
  return mapItem(doc, si, gi, ii, (it) => {
    const next: LogItem = { ...it };
    if (patch.title !== undefined) next.movement = patch.title;
    if (patch.description !== undefined) next.description = patch.description;
    if (patch.url !== undefined) {
      if (patch.url.trim()) next.url = patch.url;
      else delete next.url;
    }
    return next;
  });
}

// Remove an item; drop the whole group (and section) once they go empty.
export function removeItem(doc: LogDocument, si: number, gi: number, ii: number): LogDocument {
  const pruned = mapGroup(doc, si, gi, (g) => ({ ...g, items: g.items.filter((_, i) => i !== ii) }));
  return mapSection(pruned, si, (s) => ({ ...s, groups: s.groups.filter((g) => g.items.length > 0) }));
}

export function removeGroup(doc: LogDocument, si: number, gi: number): LogDocument {
  return mapSection(doc, si, (s) => ({ ...s, groups: s.groups.filter((_, i) => i !== gi) }));
}

// Merge a group with the one after it into a single superset/circuit group.
export function mergeWithNext(doc: LogDocument, si: number, gi: number, kind: GroupKind): LogDocument {
  return mapSection(doc, si, (s) => {
    if (gi + 1 >= s.groups.length) return s;
    const a = s.groups[gi];
    const b = s.groups[gi + 1];
    const merged: LogGroup = restampGroup({ id: a.id, kind, items: [...a.items, ...b.items] });
    return { ...s, groups: s.groups.flatMap((g, i) => (i === gi ? [merged] : i === gi + 1 ? [] : [g])) };
  });
}

export function setGroupKind(doc: LogDocument, si: number, gi: number, kind: GroupKind): LogDocument {
  return mapGroup(doc, si, gi, (g) => ({ ...g, kind }));
}

// Split a multi-item group back into single-item groups.
export function ungroup(doc: LogDocument, si: number, gi: number): LogDocument {
  return mapSection(doc, si, (s) => ({
    ...s,
    groups: s.groups.flatMap((g, i) =>
      i !== gi
        ? [g]
        : g.items.map((it) => restampGroup({ id: newId(), kind: 'single' as GroupKind, items: [it] })),
    ),
  }));
}

// Move a group up (dir -1) or down (dir +1) within its section.
export function moveGroup(doc: LogDocument, si: number, gi: number, dir: -1 | 1): LogDocument {
  return mapSection(doc, si, (s) => {
    const j = gi + dir;
    if (j < 0 || j >= s.groups.length) return s;
    const groups = [...s.groups];
    [groups[gi], groups[j]] = [groups[j], groups[gi]];
    return { ...s, groups };
  });
}

// Move a whole group (single or superset) to another section by key, appending
// it to the end of the target section (creating the section if absent). No-op
// when the target is the group's current section.
export function moveGroupToSection(
  doc: LogDocument,
  si: number,
  gi: number,
  targetKey: LogDocument['sections'][number]['key'],
): LogDocument {
  const section = doc.sections[si];
  const group = section?.groups[gi];
  if (!group || section.key === targetKey) return doc;
  const pruned = mapSection(doc, si, (s) => ({ ...s, groups: s.groups.filter((_, i) => i !== gi) }));
  const idx = pruned.sections.findIndex((s) => s.key === targetKey);
  if (idx < 0) return { ...pruned, sections: [...pruned.sections, { key: targetKey, groups: [group] }] };
  return mapSection(pruned, idx, (s) => ({ ...s, groups: [...s.groups, group] }));
}

// Merge two groups that may live in different sections into one superset/circuit.
// The merged group stays in the SOURCE section (source items first); the target
// group's items are appended and the target group removed.
export function groupWithAcrossSections(
  doc: LogDocument,
  si: number,
  gi: number,
  targetSi: number,
  targetGi: number,
  kind: GroupKind = 'superset',
): LogDocument {
  if (si === targetSi) return groupWith(doc, si, gi, targetGi, kind);
  const src = doc.sections[si]?.groups[gi];
  const dst = doc.sections[targetSi]?.groups[targetGi];
  if (!src || !dst) return doc;
  const merged: LogGroup = { id: src.id, kind, items: [...src.items, ...dst.items] };
  const withMerged = mapGroup(doc, si, gi, () => merged); // mapGroup restamps
  return mapSection(withMerged, targetSi, (s) => ({
    ...s,
    groups: s.groups.filter((_, i) => i !== targetGi),
  }));
}

// Merge two arbitrary groups in a section into one superset/circuit, placed at
// the earlier position, items in positional order.
export function groupWith(
  doc: LogDocument,
  si: number,
  gi: number,
  targetGi: number,
  kind: GroupKind = 'superset',
): LogDocument {
  return mapSection(doc, si, (s) => {
    if (gi === targetGi || gi >= s.groups.length || targetGi >= s.groups.length) return s;
    const lo = Math.min(gi, targetGi);
    const hi = Math.max(gi, targetGi);
    const merged: LogGroup = restampGroup({
      id: s.groups[lo].id,
      kind,
      items: [...s.groups[lo].items, ...s.groups[hi].items],
    });
    const groups: LogGroup[] = [];
    s.groups.forEach((g, i) => {
      if (i === lo) groups.push(merged);
      else if (i !== hi) groups.push(g);
    });
    return { ...s, groups };
  });
}

// Toggle a notation across all of an item's sets (on if any set lacks it).
export function toggleItemNotation(
  doc: LogDocument,
  si: number,
  gi: number,
  ii: number,
  note: string,
): LogDocument {
  return mapItem(doc, si, gi, ii, (it) => {
    if (isSubroutine(it)) return it; // subroutines have no sets to notate
    const allHave = it.sets.length > 0 && it.sets.every((set) => set.notations.includes(note));
    return {
      ...it,
      sets: it.sets.map((set) => ({
        ...set,
        notations: allHave
          ? set.notations.filter((n) => n !== note)
          : Array.from(new Set([...set.notations, note])),
      })),
    };
  });
}
