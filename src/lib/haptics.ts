import { TOUCH } from '@/app.config';

// Short vibration for key tactile actions. No-op when disabled or unsupported.
export function haptic(ms = 10): void {
  if (!TOUCH.hapticsEnabled) return;
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    navigator.vibrate(ms);
  }
}
