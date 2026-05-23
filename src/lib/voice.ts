import { useCallback, useRef, useState } from 'react';
import type { SetActual } from '@/lib/types';

// Parse a spoken set into actual values. Handles the common strength phrasing
// ("100 for 5 at 8", "100 kilos 5 reps rpe 8", "100 5") plus conditioning
// ("row 500 meters", "plank 90 seconds"). Best-effort: only fills what it finds.
export function parseVoiceSet(transcript: string): Partial<SetActual> {
  let s = ` ${transcript.toLowerCase().replace(/@/g, ' at ').replace(/,/g, ' ')} `;
  const out: Partial<SetActual> = {};

  const take = (re: RegExp): number | null => {
    const m = s.match(re);
    if (!m) return null;
    s = s.replace(m[0], ' ');
    return parseFloat(m[1]);
  };

  if (/\bbody\s*weight\b|\bbodyweight\b/.test(s)) {
    out.weight = 0;
    s = s.replace(/\bbody\s*weight\b|\bbodyweight\b/g, ' ');
  }

  const rpe = take(/\b(?:rpe|at)\s+(\d+(?:\.\d+)?)/);
  if (rpe != null) out.rpe = rpe;

  const km = take(/(\d+(?:\.\d+)?)\s*(?:km|kilometers?|kilometres?)\b/);
  if (km != null) out.distance = Math.round(km * 1000);
  const meters = take(/(\d+(?:\.\d+)?)\s*(?:m|meters?|metres?)\b/);
  if (meters != null) out.distance = meters;

  const min = take(/(\d+(?:\.\d+)?)\s*(?:min|mins|minutes?)\b/);
  const sec = take(/(\d+(?:\.\d+)?)\s*(?:sec|secs|seconds?)\b/);
  if (min != null || sec != null) out.time = Math.round((min ?? 0) * 60 + (sec ?? 0));

  const reps =
    take(/(\d+)\s*(?:reps?)\b/) ?? take(/\bfor\s+(\d+)\b/) ?? take(/[x×]\s*(\d+)\b/);
  if (reps != null) out.reps = reps;

  const weightUnit = take(/(\d+(?:\.\d+)?)\s*(?:kg|kilos?|kilograms?|lb|lbs|pounds?)\b/);
  if (weightUnit != null) out.weight = weightUnit;

  // Whatever bare numbers remain fill weight then reps, in spoken order.
  const bare = (s.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
  for (const n of bare) {
    if (out.weight == null) out.weight = n;
    else if (out.reps == null) out.reps = n;
  }

  return out;
}

interface VoiceInput {
  supported: boolean;
  listening: boolean;
  start: (onResult: (transcript: string) => void) => void;
  stop: () => void;
}

// Thin wrapper over the Web Speech API (feature-detected; no-op when absent).
export function useVoiceInput(): VoiceInput {
  const supported =
    typeof window !== 'undefined' &&
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);
  const [listening, setListening] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recRef = useRef<any>(null);

  const start = useCallback(
    (onResult: (transcript: string) => void) => {
      if (!supported) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      const rec = new Ctor();
      rec.lang = 'en-US';
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rec.onresult = (e: any) => onResult(e.results[0][0].transcript as string);
      rec.onend = () => setListening(false);
      rec.onerror = () => setListening(false);
      recRef.current = rec;
      setListening(true);
      rec.start();
    },
    [supported],
  );

  const stop = useCallback(() => {
    recRef.current?.stop();
    setListening(false);
  }, []);

  return { supported, listening, start, stop };
}
