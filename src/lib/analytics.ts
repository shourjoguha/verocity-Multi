import posthog from 'posthog-js';

const key = import.meta.env.PUBLIC_POSTHOG_KEY;
const host = import.meta.env.PUBLIC_POSTHOG_HOST;

const enabled = Boolean(key);

if (!enabled) {
  // Surfaced in the browser console; the build itself does not need this.
  console.warn('[analytics] PUBLIC_POSTHOG_KEY is not set — analytics is disabled.');
} else {
  posthog.init(key, {
    api_host: host || 'https://us.i.posthog.com',
    capture_exceptions: true,
    // Pageviews are captured explicitly on astro:page-load instead (see
    // capturePageview) since ClientRouter's soft navigation isn't guaranteed
    // to trip posthog-js's own history-based autocapture.
    capture_pageview: false,
    capture_pageleave: true,
    person_profiles: 'identified_only',
  });
}

export function track(event: string, properties?: Record<string, unknown>): void {
  if (!enabled) return;
  try {
    posthog.capture(event, properties);
  } catch {
    // Analytics must never break a success path.
  }
}

export function captureUserIdentified(userId: string, properties?: Record<string, unknown>): void {
  if (!enabled) return;
  try {
    posthog.identify(userId, properties);
  } catch {
    // Analytics must never break a success path.
  }
}

export function resetAnalyticsIdentity(): void {
  if (!enabled) return;
  try {
    posthog.reset();
  } catch {
    // Analytics must never break a success path.
  }
}

export function capturePageview(): void {
  if (!enabled) return;
  try {
    posthog.capture('$pageview');
  } catch {
    // Analytics must never break a success path.
  }
}
