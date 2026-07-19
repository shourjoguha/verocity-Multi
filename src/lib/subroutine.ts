// Helpers for subroutine items — free-text blocks (title + description + link)
// that live among movements. See ItemKind / the `kind` field in lib/types.ts.
import type { ItemKind } from '@/lib/types';

export function isSubroutine(item: { kind?: ItemKind }): boolean {
  return item.kind === 'subroutine';
}

// Resolve a user-entered URL to a safe href, or null if it can't be one. Only
// http/https is allowed (blocks javascript:, data:, etc.); a bare host like
// "example.com/x" is promoted to https://. Returns null for empty/invalid input
// so callers can decide whether to render a "Link".
export function safeHref(url?: string | null): string | null {
  const raw = url?.trim();
  if (!raw) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
  } catch {
    return null;
  }
}
