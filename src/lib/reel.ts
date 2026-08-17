// The short film behind the landing hero's "Watch the reel" control.
//
// Now a YouTube Shorts embed rather than a local file — the asset lives on
// YouTube (https://www.youtube.com/shorts/mAr3fdl65-w) and this page just
// shows it in a dialog. Third-party fetch on the marketing homepage, weighed
// against the operational cost of hosting a video ourselves: fine.
//
// `?autoplay=1&mute=1&playsinline=1` because the dialog opens on a click, so
// autoplay is legal and muted playback is what a shorts feed feels like.
// `loop=1&playlist=<id>` because YouTube's loop parameter only takes effect
// when playlist names the same video (yes, that is genuinely the API).
//
// `origin=` is set client-side (we don't know it at build time), so the
// module ships the base URL and the dialog appends origin at render.
const YT_ID = 'mAr3fdl65-w';

export const REEL = {
  embed:
    `https://www.youtube.com/embed/${YT_ID}` +
    `?autoplay=1&mute=1&playsinline=1&loop=1&playlist=${YT_ID}&rel=0&modestbranding=1`,
  // The source page, linked as a fallback in the dialog for anyone whose
  // browser or extension blocks the embed.
  href: `https://www.youtube.com/shorts/${YT_ID}`,
  title: 'Verocity — the reel',
} as const;
