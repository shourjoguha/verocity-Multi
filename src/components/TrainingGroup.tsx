import GroupPager from './GroupPager';
import PlanView from './PlanView';
import SessionsView from './SessionsView';
import LibraryView from './LibraryView';

// The Training neighbourhood as one sliding page: Plan / Sessions / Library.
export default function TrainingGroup({ initial }: { initial: string }) {
  return (
    <GroupPager
      groupKey="training"
      initial={initial}
      views={{
        plan: <PlanView />,
        sessions: <SessionsView />,
        library: <LibraryView />,
      }}
    />
  );
}
