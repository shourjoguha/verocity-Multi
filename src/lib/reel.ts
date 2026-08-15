// The short film behind the landing hero's "Watch the reel" control.
//
// Plain files under public/, so there is no player dependency and no
// third-party request from the marketing page. Both are optional at build time:
// ReelDialog degrades to a "not up yet" line if the video 404s, so the code can
// ship before the asset does.
//
// Not in lib/showcase.ts, which is the source of truth for the public showcase
// WINDOW and alias — a landing-page video has nothing to do with either.
export const REEL = {
  src: '/reel.mp4',
  poster: '/reel-poster.jpg',
} as const;
