import { useEffect, useState } from 'react';

// Session stopwatch — counts up, supports pause/resume and seeding from a
// resumed session's elapsed seconds.
export function useStopwatch(initialSeconds = 0, autostart = false) {
  const [seconds, setSeconds] = useState(initialSeconds);
  const [running, setRunning] = useState(autostart);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [running]);

  return {
    seconds,
    running,
    start: () => setRunning(true),
    pause: () => setRunning(false),
    resume: () => setRunning(true),
    // Seeding has to be possible AFTER mount: the Logger only learns a resumed
    // session's elapsed time once the row has loaded, and without this the
    // clock restarted at 0 and the autosave wrote that over the real duration.
    set: (s: number) => setSeconds(s),
  };
}

// No rest countdown: it paused when the phone locked and was fiddly mid-set.
// Rest is logged as a tag on the item (TIMERS.restPresets), not timed.
