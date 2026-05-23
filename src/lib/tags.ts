import { ACTIVITY_TAGS, type ActivityTagKey } from '@/app.config';

// Resolve an activity tag to its token color; unknown tags fall back to muted.
export function tagColor(tag: string): string {
  const known = ACTIVITY_TAGS[tag as ActivityTagKey];
  return known ? known.color : 'hsl(0 0% 42%)';
}
