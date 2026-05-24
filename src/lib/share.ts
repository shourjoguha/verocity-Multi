// Client helpers for read-only share links (SPEC §7B). The raw token is random
// and shown to the owner once; only its SHA-256 hash is stored in `shares`. The
// public share-read edge function (verify_jwt off) re-hashes the token and
// returns the scoped data — holders never receive a writable key.
import type { Plan, Profile, ShareScope, WorkoutLog } from '@/lib/types';

const FUNCTIONS_URL = `${import.meta.env.PUBLIC_SUPABASE_URL ?? ''}/functions/v1/share-read`;

// 32 random bytes as lowercase hex (matches share-read's sha256Hex input shape).
export function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function shareUrl(token: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}/share?token=${token}`;
}

export type ShareResult =
  | { scope: 'profile'; profile: Profile | null; plans: Plan[]; logs: WorkoutLog[] }
  | { scope: 'plan'; plan: Plan | null }
  | { scope: 'log'; log: WorkoutLog | null };

// Resolve a share token via the edge function. Returns null with a reason on any
// non-200 (invalid / expired / revoked / network).
export async function fetchShare(
  token: string,
): Promise<{ data: ShareResult | null; error: string | null }> {
  try {
    const res = await fetch(`${FUNCTIONS_URL}?token=${encodeURIComponent(token)}`);
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      return { data: null, error: body?.error ?? `http_${res.status}` };
    }
    return { data: (await res.json()) as ShareResult, error: null };
  } catch {
    return { data: null, error: 'network_error' };
  }
}

export const SHARE_SCOPES: ShareScope[] = ['profile', 'plan', 'log'];
