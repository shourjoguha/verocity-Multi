// Single source of truth for the two multi-page neighbourhoods that render as a
// single grouped page with a sliding segmented control (see GroupPager.tsx).
// The drawer in App.astro still lists these destinations flat; this module is
// what the group islands, the bottom-ribbon Training/Progress tabs, and the
// "remember last sub-page" href rewrite all read so they cannot drift apart.

export type GroupKey = 'training' | 'progress';

export type GroupTab = { key: string; label: string; href: string };
export type GroupDef = { key: GroupKey; label: string; base: string; tabs: GroupTab[] };

export const GROUPS: Record<GroupKey, GroupDef> = {
  training: {
    key: 'training',
    label: 'Training',
    base: '/app/plan',
    tabs: [
      { key: 'plan', label: 'Plan', href: '/app/plan' },
      { key: 'sessions', label: 'Sessions', href: '/app/sessions' },
      { key: 'library', label: 'Library', href: '/app/library' },
    ],
  },
  progress: {
    key: 'progress',
    label: 'Progress',
    base: '/app/stats',
    tabs: [
      { key: 'stats', label: 'Stats', href: '/app/stats' },
      { key: 'body', label: 'Body', href: '/app/body' },
      { key: 'coach', label: 'Coach', href: '/app/coach' },
    ],
  },
};

// The bottom-ribbon Training/Progress tab reopens whichever sub-page you last
// viewed in that group. The group island writes this on every tab change and
// App.astro's setupNav rewrites the tab href from it on each page-load. Keep the
// prefix in sync with the literal hardcoded in App.astro's <script>.
export const navStorageKey = (g: GroupKey) => `verocity:nav:${g}`;
