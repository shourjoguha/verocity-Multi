import { useEffect, useState } from 'react';
import { haptic } from '@/lib/haptics';

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

// Rest countdown — counts down to zero then stops. Fires `onDone` once when it
// reaches zero (not when stopped early), so the caller can signal the user: in
// the gym the phone is usually face-down or in a pocket, and a countdown that
// ends silently is a countdown you miss.
export function useCountdown(onDone?: () => void) {
  const [secondsLeft, setSecondsLeft] = useState(0);
  // What the countdown was started with, kept so the caller can draw a
  // remaining-fraction bar. Never reset on stop: the bar unmounts with the
  // timer, and zeroing it here would divide by zero on the last frame.
  const [totalSeconds, setTotalSeconds] = useState(0);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [running]);

  // Zero is detected here rather than inside the updater so the signal fires
  // exactly once (updaters are re-invoked under StrictMode). Setting running
  // false immediately makes the guard self-limiting.
  useEffect(() => {
    if (!running || secondsLeft > 0) return;
    setRunning(false);
    haptic(200);
    onDone?.();
  }, [running, secondsLeft, onDone]);

  return {
    secondsLeft,
    totalSeconds,
    running,
    start: (s: number) => {
      setSecondsLeft(s);
      setTotalSeconds(s);
      setRunning(true);
    },
    stop: () => setRunning(false),
  };
}
