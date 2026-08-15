import { useRef, useState, type ReactNode } from 'react';
import SegmentedTabs from './ui/SegmentedTabs';
import { GROUPS, navStorageKey, type GroupKey } from '@/lib/appNav';
import { hrefFor, type Surface } from '@/lib/surface';

// A grouped page: one segmented control on top, its sibling views below,
// switched client-side with a CSS-first directional slide. This is the seamless
// alternative to a full route swap between /app/plan|sessions|library (and the
// Progress trio) — the sibling views stay mounted so re-selecting a tab is
// instant and keeps its state, while the incoming panel is only mounted the
// first time it is opened so Progress does not boot Stats + the 3D Body map +
// Coach at once on a phone.
//
// URL sync uses replaceState, NOT pushState: it keeps the address bar and a
// refresh/deep-link correct without minting history entries that Astro's
// ClientRouter would intercept on Back and turn into a fresh full-island swap
// (the very flash this feature exists to avoid). Back therefore leaves the
// group rather than stepping through sub-tabs.
export default function GroupPager({
  groupKey,
  initial,
  views,
  surface = 'app',
}: {
  groupKey: GroupKey;
  initial: string;
  views: Record<string, ReactNode>;
  surface?: Surface;
}) {
  // Tabs come from the views the caller actually supplied, not from the whole
  // group: the showcase omits Coach for data-scope reasons, and deriving the
  // control from `views` means dropping a view drops its tab with it.
  const tabs = GROUPS[groupKey].tabs.filter((t) => t.key in views);
  const initialKey = tabs.some((t) => t.key === initial) ? initial : tabs[0].key;

  const [active, setActive] = useState(initialKey);
  const [mounted, setMounted] = useState<Set<string>>(() => new Set([initialKey]));
  // null on first paint so the initial panel does not slide over its own
  // PageStagger entrance; set to a direction on every user-driven change.
  const [dir, setDir] = useState<'right' | 'left' | null>(null);
  const activeIndex = useRef(tabs.findIndex((t) => t.key === initialKey));

  const select = (key: string) => {
    if (key === active) return;
    const nextIndex = tabs.findIndex((t) => t.key === key);
    setDir(nextIndex > activeIndex.current ? 'right' : 'left');
    activeIndex.current = nextIndex;
    setMounted((m) => (m.has(key) ? m : new Set(m).add(key)));
    setActive(key);
    // Both go through hrefFor: the group's canonical hrefs are `/app/*`, and
    // writing one of those from the showcase would rewrite the address bar to
    // the private app and teach the ribbon's Training/Progress slot to navigate
    // a visitor straight out of the read-only surface.
    const href = hrefFor(tabs[nextIndex].href, surface);
    try {
      window.history.replaceState(window.history.state, '', href);
      sessionStorage.setItem(navStorageKey(groupKey), href);
    } catch {
      /* private mode / quota — navigation still works, just not remembered */
    }
    // Match a fresh page navigation: land at the top of the new sub-page.
    document.getElementById('app-scroll')?.scrollTo({ top: 0 });
  };

  return (
    <div>
      <div className="mx-auto max-w-3xl px-4 pt-4 sm:px-6">
        <SegmentedTabs
          tabs={tabs.map((t) => ({ key: t.key, label: t.label }))}
          active={active}
          onChange={select}
          ariaLabel={`${GROUPS[groupKey].label} sections`}
        />
      </div>
      {tabs.map((t) =>
        mounted.has(t.key) ? (
          // Inactive panels are display:none, so keeping them mounted preserves
          // their state without cost; showing one replays its slide keyframe
          // because animations restart when an element leaves display:none.
          <div
            key={t.key}
            className={
              t.key === active
                ? dir
                  ? `group-panel group-panel--${dir}`
                  : 'group-panel'
                : 'hidden'
            }
          >
            {views[t.key]}
          </div>
        ) : null,
      )}
    </div>
  );
}
