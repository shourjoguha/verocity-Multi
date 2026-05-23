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
  };
}

// Rest countdown — counts down to zero then stops.
export function useCountdown() {
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          setRunning(false);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [running]);

  return {
    secondsLeft,
    running,
    start: (s: number) => {
      setSecondsLeft(s);
      setRunning(true);
    },
    stop: () => setRunning(false),
  };
}
