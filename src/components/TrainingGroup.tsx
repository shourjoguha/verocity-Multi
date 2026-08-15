import GroupPager from './GroupPager';
import PlanView from './PlanView';
import SessionsView from './SessionsView';
import LibraryView from './LibraryView';
import type { Surface } from '@/lib/surface';

// The Training neighbourhood as one sliding page: Plan / Sessions / Library.
//
// `mode` is threaded explicitly rather than read from the URL because these are
// server-rendered islands: the page knows the surface at build time, and a view
// that guessed it at hydration would render app markup on the server and
// showcase markup in the browser.
export default function TrainingGroup({
  initial,
  mode = 'app',
}: {
  initial: string;
  mode?: Surface;
}) {
  return (
    <GroupPager
      groupKey="training"
      initial={initial}
      surface={mode}
      views={{
        plan: <PlanView mode={mode} />,
        sessions: <SessionsView mode={mode} />,
        library: <LibraryView mode={mode} />,
      }}
    />
  );
}
