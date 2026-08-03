import GroupPager from './GroupPager';
import StatsView from './StatsView';
import BodyView from './BodyView';
import CoachView from './CoachView';

// The Progress neighbourhood as one sliding page: Stats / Body / Coach.
export default function ProgressGroup({ initial }: { initial: string }) {
  return (
    <GroupPager
      groupKey="progress"
      initial={initial}
      views={{
        stats: <StatsView />,
        body: <BodyView />,
        coach: <CoachView />,
      }}
    />
  );
}
