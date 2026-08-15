import GroupPager from './GroupPager';
import StatsView from './StatsView';
import BodyView from './BodyView';
import CoachView from './CoachView';
import type { Surface } from '@/lib/surface';

// The Progress neighbourhood as one sliding page: Stats / Body / Coach.
//
// Coach is omitted on the showcase — a data-scope decision, not a layout one:
// the coach reads the owner's own logs back to them and is deliberately not
// public. GroupPager derives its tab list from the views it is given, so
// dropping the view drops the tab with it and nothing else has to know.
export default function ProgressGroup({
  initial,
  mode = 'app',
}: {
  initial: string;
  mode?: Surface;
}) {
  const views =
    mode === 'showcase'
      ? { stats: <StatsView mode={mode} />, body: <BodyView mode={mode} /> }
      : { stats: <StatsView mode={mode} />, body: <BodyView mode={mode} />, coach: <CoachView /> };

  return <GroupPager groupKey="progress" initial={initial} surface={mode} views={views} />;
}
