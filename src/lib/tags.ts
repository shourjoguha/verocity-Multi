import { ACTIVITY_TAGS, type ActivityTagKey } from '@/app.config';

// Resolve an activity tag to its token color; unknown tags fall back to muted.
export function tagColor(tag: string): string {
  const known = ACTIVITY_TAGS[tag as ActivityTagKey];
  return known ? known.color : 'hsl(0 0% 42%)';
}

// Classify a plan day's label into an activity tag — used to tint upcoming
// ("planned") days on the plan-progress ribbon, where there is no log to color by.
export function dayTagFromLabel(label: string): ActivityTagKey {
  const t = label.toLowerCase();
  if (/recover|rest|mobility|deload/.test(t)) return 'recovery';
  if (/condition|cardio|zone|metcon|endurance|run|row|bike|swim/.test(t)) return 'conditioning';
  return 'strength';
}
