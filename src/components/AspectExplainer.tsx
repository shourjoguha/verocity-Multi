import {
  ASPECT_MIN_BASELINE,
  ASPECT_SCALE,
  FITNESS_ASPECTS,
  type AspectWindowKey,
} from '@/app.config';
import { Modal } from '@/components/ui/Modal';

// What the radar's numbers actually mean. Reachable at any time, not only during
// a cold start: "the middle ring is typical for you" is a claim that deserves an
// answer to "typical how, from what?" no matter how much history you have — and
// the honest answer includes a caveat (below) that the chart cannot show.
const METRIC_NOTES: Record<string, string> = {
  strength:
    'Training volume from your resistance work — load × reps, added up. Each set is then weighted by how heavy it was relative to your own best for that movement, so a heavy low-rep block still registers instead of reading as a drop.',
  endurance:
    'Three things that all mean conditioning: aerobic minutes weighted by heart rate, plus strength work done on short rests, plus the gap between your average and peak heart rate scaled by how long the session ran. That gap is what separates intervals from steady state — it counts for more when you logged a conditioning block.',
  power:
    'Training volume from explosive work — jumps, throws, slams and the Olympic lifts, as classified by the movement taxonomy. Low-rep sets count for more, since 20 tired jumps are not the same training as 6 sharp ones.',
  mobility: 'Mobility minutes per week, scaled up slightly for work outside the sagittal plane.',
  consistency:
    'Distinct training days per week, multiplied by the share of planned sets you actually completed.',
  recovery:
    'Your sleep / energy / soreness check-ins, damped when your last 7 days of load run hot against your last 28.',
};

export function AspectExplainer({
  open,
  onClose,
  windowKey,
  windowDays,
  baselineSamples,
}: {
  open: boolean;
  onClose: () => void;
  windowKey: AspectWindowKey;
  windowDays: number;
  baselineSamples: number;
}) {
  const short = ASPECT_MIN_BASELINE - baselineSamples;

  return (
    <Modal open={open} onClose={onClose} title="How this chart is scored">
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 text-sm leading-relaxed text-muted">
        <section>
          <h3 className="mb-1.5 text-fg">Two steps, not one</h3>
          <p>
            Each axis is measured first, in its own units — kilograms, minutes per week,
            training days. That measurement covers the last {windowDays} days.
          </p>
          <p className="mt-2">
            It is then placed on a {ASPECT_SCALE.min}–{ASPECT_SCALE.max} scale against{' '}
            <strong className="text-fg">your own past values for that same axis</strong>, one
            sample per completed week. The middle of the scale is the median of your own
            history, so it means "typical for you" — not typical for anyone else. There is no
            population average and no reference person in this chart.
          </p>
        </section>

        <section>
          <h3 className="mb-1.5 text-fg">Why some axes show a measurement instead</h3>
          <p>
            A score needs something to be relative to. Below {ASPECT_MIN_BASELINE} weekly
            samples there isn't one, so that axis shows its raw measurement on a dashed spoke
            rather than a rating.
          </p>
          <p className="mt-2">
            {short > 0 ? (
              <>
                You have <span className="tabular-nums text-fg">{baselineSamples}</span> of{' '}
                {ASPECT_MIN_BASELINE} weeks stored for this window. About{' '}
                <span className="tabular-nums text-fg">{short}</span> more{' '}
                {short === 1 ? 'week' : 'weeks'} of logging and the scores appear.
              </>
            ) : (
              <>
                You have <span className="tabular-nums text-fg">{baselineSamples}</span> weekly
                samples stored for this window. A hollow point means that axis is scored but
                its baseline is still thin, so treat it as provisional.
              </>
            )}
          </p>
        </section>

        <section>
          <h3 className="mb-1.5 text-fg">The two windows</h3>
          <p>
            <strong className="text-fg">Recent</strong> measures a shorter span, so one session
            moves it noticeably — useful for seeing whether this week landed.{' '}
            <strong className="text-fg">Trend</strong> measures a longer one and is steadier.
            Each keeps its own separate history, so a Recent reading is only ever compared with
            other Recent readings.
          </p>
          <p className="mt-2 text-subtle">Currently showing: {windowKey === 'recent' ? 'Recent' : 'Trend'}, {windowDays} days.</p>
        </section>

        <section>
          <h3 className="mb-1.5 text-fg">What it can't tell you</h3>
          <p>
            Because the baseline follows you, sustained improvement gets normalised away: train
            hard for a year and your median rises with you, pulling scores back toward the
            middle. That is working as intended — it reads "typical for you lately", not
            lifetime progress. Use the comparison below the chart against an older block to see
            long-range change.
          </p>
        </section>

        <section>
          <h3 className="mb-1.5 text-fg">What you log changes the number</h3>
          <p>
            Strength and power are measured as training volume, and volume is read from the
            detail on each set — so notating a set is not just bookkeeping:
          </p>
          <ul className="mt-2 space-y-1.5">
            <li>
              <strong className="text-fg">/side</strong> — counts the set twice. Reps are logged
              per side, so without this marker half the work is invisible.
            </li>
            <li>
              <strong className="text-fg">(p)</strong> — paused reps count for more, being more
              time under tension than touch-and-go.
            </li>
            <li>
              <strong className="text-fg">RPE</strong> — near-failure sets count for more at the
              same load. Leaving it blank costs nothing; it scores as an average effort, so this
              rewards hard training rather than diligent logging.
            </li>
            <li>
              <strong className="text-fg">Rest, and session length</strong> — short rests push
              work onto the endurance axis. Rest you set on a movement and the wall-clock time
              the session took are both read, since actual rest between sets isn't recorded.
            </li>
          </ul>
        </section>

        <section>
          <h3 className="mb-2 text-fg">What each axis measures</h3>
          <dl className="space-y-2.5">
            {FITNESS_ASPECTS.map((a) => (
              <div key={a.key}>
                <dt className="t-control text-fg">
                  {a.label} <span className="text-subtle">· {a.unit}</span>
                </dt>
                <dd className="text-xs">{METRIC_NOTES[a.key]}</dd>
              </div>
            ))}
          </dl>
        </section>

        <p className="text-xs text-subtle">
          A fitness check-in overrides any axis you rate, but only while it is recent — after
          that the measurement takes back over rather than letting an old rating look current.
        </p>
      </div>
      <div className="flex items-center border-t border-border p-4">
        <button
          type="button"
          onClick={onClose}
          className="hill-btn ml-auto inline-flex min-h-11 items-center bg-fg px-5 text-sm uppercase tracking-wider text-bg transition-colors hover:bg-fg/85"
        >
          Got it
        </button>
      </div>
    </Modal>
  );
}
