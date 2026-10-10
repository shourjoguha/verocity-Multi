import { beforeEach, describe, expect, it } from 'vitest';
import { clearPersisted, restorePersisted, writePersisted } from './persistedCache';

// Minimal Storage over a Map, installed as the global the module reads.
class MemoryStorage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  keys() {
    return [...this.m.keys()];
  }
}

let store: MemoryStorage;
const signIn = (id: string) =>
  store.setItem('sb-proj-auth-token', JSON.stringify({ access_token: 't', user: { id } }));

beforeEach(() => {
  store = new MemoryStorage();
  (globalThis as { localStorage?: unknown }).localStorage = store;
});

describe('persistedCache', () => {
  it('round-trips only the persisted keys, for the signed-in user', () => {
    signIn('alice');
    writePersisted(
      new Map<string, unknown>([
        ['logs:all', [{ id: 'l1' }]],
        ['profile', { id: 'alice' }],
        ['stats:logs:240d', ['not persisted']],
      ]),
    );
    const restored = restorePersisted();
    expect([...restored.keys()].sort()).toEqual(['logs:all', 'profile']);
    expect(restored.get('logs:all')).toEqual([{ id: 'l1' }]);
  });

  it("never restores another user's rows, and deletes them", () => {
    signIn('alice');
    writePersisted(new Map([['logs:all', [{ id: 'alice-log' }]]]));
    signIn('bob'); // alice's session expired; bob signed in without a sign-out
    expect(restorePersisted().size).toBe(0);
    expect(store.keys().filter((k) => k.startsWith('verocity:'))).toEqual([]);
  });

  it('restores nothing and keeps nothing without a session', () => {
    signIn('alice');
    writePersisted(new Map([['logs:all', []]]));
    store.removeItem('sb-proj-auth-token');
    expect(restorePersisted().size).toBe(0);
    expect(store.keys().filter((k) => k.startsWith('verocity:'))).toEqual([]);
  });

  it('clearPersisted wipes everything it wrote', () => {
    signIn('alice');
    writePersisted(new Map([['logs:all', []]]));
    clearPersisted();
    expect(store.keys().filter((k) => k.startsWith('verocity:'))).toEqual([]);
    expect(store.getItem('sb-proj-auth-token')).not.toBeNull();
  });

  it('drops a corrupt entry instead of throwing', () => {
    signIn('alice');
    store.setItem('verocity:cache:v1:alice', '{not json');
    expect(restorePersisted().size).toBe(0);
    expect(store.getItem('verocity:cache:v1:alice')).toBeNull();
  });
});
