import { useEffect, useRef, useState } from 'react';

// Session stopwatch — counts up, supports pause/resume and seeding from a
// resumed session's elapsed seconds.
//
// Elapsed time is read off the wall clock, never counted. It used to add 1 per
// setInterval tick, and iOS suspends timers while the phone is locked, so a
// session lost every minute the screen was off. The interval now only
// re-renders; the value is `banked + (now - runFrom)`, which is right however
// long the tab slept.
export function useStopwatch(initialSeconds = 0, autostart = false) {
  // Seconds from finished runs (before the last pause), and when the current
  // run began — null while paused.
  const banked = useRef(initialSeconds);
  const runFrom = useRef<number | null>(autostart ? Date.now() : null);
  const [running, setRunning] = useState(autostart);
  const [, tick] = useState(0);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => tick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [running]);

  const elapsed = () =>
    banked.current +
    (runFrom.current == null ? 0 : Math.floor((Date.now() - runFrom.current) / 1000));

  const run = () => {
    if (runFrom.current != null) return;
    runFrom.current = Date.now();
    setRunning(true);
  };

  return {
    seconds: elapsed(),
    running,
    start: run,
    pause: () => {
      banked.current = elapsed();
      runFrom.current = null;
      setRunning(false);
    },
    resume: run,
    // Seeding has to be possible AFTER mount: the Logger only learns a resumed
    // session's elapsed time once the row has loaded, and without this the
    // clock restarted at 0 and the autosave wrote that over the real duration.
    set: (s: number) => {
      banked.current = s;
      if (runFrom.current != null) runFrom.current = Date.now();
      tick((t) => t + 1);
    },
  };
}

// No rest countdown: it paused when the phone locked and was fiddly mid-set.
// Rest is logged as a tag on the item (TIMERS.restPresets), not timed.
