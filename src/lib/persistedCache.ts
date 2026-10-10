// The few query-cache entries Home needs to paint, kept in localStorage so a
// cold launch can show last-known data at once while the real reads run. The
// in-memory cache (queryCache.ts) survives tab switches but not a reload, which
// left a cold Home waiting on its whole history download every time.
//
// What it is NOT: a source of truth. Everything restored is treated as stale —
// logStore still fetches on first use — so the worst case is the previous
// session's numbers for the length of one request.
//
// Privacy: the anon key is public and RLS is the boundary, but rows sitting in
// this browser bypass RLS for whoever opens it next. So entries are stored per
// user id, read back only for the user whose Supabase session is in this
// browser, wiped on every query-cache clear (sign-out and every write go
// through it), and any other user's entries are deleted on load — which covers
// a session that simply expired and was replaced without a sign-out.
//
// Size: one overwritten entry, the size of the history (~1.7 KB per log).
const PREFIX = 'verocity:cache:v1:';
export const PERSISTED_KEYS = new Set(['profile', 'plan:active', 'logs:all']);

// The signed-in user's id, synchronously, from the session supabase-js keeps in
// localStorage (`sb-<project-ref>-auth-token`). Synchronous because the restore
// has to finish before the first island renders; supabase.auth.getSession() is
// async.
function sessionUserId(): string | null {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !/^sb-.+-auth-token$/.test(key)) continue;
      const id = JSON.parse(localStorage.getItem(key) ?? 'null')?.user?.id;
      if (typeof id === 'string') return id;
    }
  } catch {
    // Storage blocked (private mode, disabled site data): nothing to restore.
  }
  return null;
}

function removeAll(except?: string): void {
  try {
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(PREFIX) && key !== except) doomed.push(key);
    }
    doomed.forEach((key) => localStorage.removeItem(key));
  } catch {
    // Nothing stored that we can reach.
  }
}

// Entries saved for the current user, after deleting everyone else's.
export function restorePersisted(): Map<string, unknown> {
  const restored = new Map<string, unknown>();
  if (typeof localStorage === 'undefined') return restored;
  const uid = sessionUserId();
  removeAll(uid ? PREFIX + uid : undefined);
  if (!uid) return restored;
  try {
    const raw = localStorage.getItem(PREFIX + uid);
    const entries = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
    for (const [key, value] of Object.entries(entries ?? {})) {
      if (PERSISTED_KEYS.has(key)) restored.set(key, value);
    }
  } catch {
    removeAll();
  }
  return restored;
}

// Writes the persisted subset of `cache` for the current user. Called after a
// persisted key changes; a failed write (quota, private mode) only costs the
// next cold launch its head start.
export function writePersisted(cache: Map<string, unknown>): void {
  if (typeof localStorage === 'undefined') return;
  const uid = sessionUserId();
  if (!uid) return;
  const entries: Record<string, unknown> = {};
  for (const key of PERSISTED_KEYS) if (cache.has(key)) entries[key] = cache.get(key);
  try {
    localStorage.setItem(PREFIX + uid, JSON.stringify(entries));
  } catch {
    removeAll();
  }
}

export function clearPersisted(): void {
  removeAll();
}
