import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkoutLog } from '@/lib/types';

const getAllLogs = vi.fn<() => Promise<WorkoutLog[]>>();
vi.mock('@/lib/queries', () => ({ getAllLogs: () => getAllLogs() }));

const { loadAllLogs, invalidateLogs, newestLogs, logsBetween } = await import('./logStore');
const { clearQueryCache, getCached } = await import('./queryCache');

const log = (id: string, log_date: string) => ({ id, log_date }) as WorkoutLog;
const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

beforeEach(() => {
  getAllLogs.mockReset();
  clearQueryCache();
  invalidateLogs();
});

describe('loadAllLogs', () => {
  it('shares one request between concurrent readers', async () => {
    getAllLogs.mockResolvedValue([log('a', '2026-01-01')]);
    const [x, y] = await Promise.all([loadAllLogs(), loadAllLogs()]);
    expect(getAllLogs).toHaveBeenCalledTimes(1);
    expect(x).toBe(y);
  });

  it('reuses a fresh result without fetching again', async () => {
    getAllLogs.mockResolvedValue([log('a', '2026-01-01')]);
    await loadAllLogs();
    await loadAllLogs();
    expect(getAllLogs).toHaveBeenCalledTimes(1);
  });

  it('refetches after a cache clear (every log write does one)', async () => {
    getAllLogs.mockResolvedValue([log('a', '2026-01-01')]);
    await loadAllLogs();
    clearQueryCache();
    await loadAllLogs();
    expect(getAllLogs).toHaveBeenCalledTimes(2);
  });

  it('refetches after invalidateLogs (another device wrote)', async () => {
    getAllLogs.mockResolvedValue([log('a', '2026-01-01')]);
    await loadAllLogs();
    invalidateLogs();
    await loadAllLogs();
    expect(getAllLogs).toHaveBeenCalledTimes(2);
  });

  it('does not store a read that was in flight across a write', async () => {
    const before = deferred<WorkoutLog[]>();
    getAllLogs.mockReturnValueOnce(before.promise);
    const stale = loadAllLogs();
    clearQueryCache(); // a log write lands mid-request
    before.resolve([log('old', '2026-01-01')]);
    await stale;
    expect(getCached('logs:all')).toBeUndefined();
  });

  it('does not let an invalidated request overwrite a newer one', async () => {
    const older = deferred<WorkoutLog[]>();
    getAllLogs.mockReturnValueOnce(older.promise).mockResolvedValueOnce([log('new', '2026-01-02')]);
    const first = loadAllLogs();
    invalidateLogs();
    await loadAllLogs();
    older.resolve([log('old', '2026-01-01')]);
    await first;
    expect(getCached<WorkoutLog[]>('logs:all')?.map((l) => l.id)).toEqual(['new']);
  });
});

it('never hands a request from before a clear to a caller after it', async () => {
  const before = deferred<WorkoutLog[]>();
  getAllLogs.mockReturnValueOnce(before.promise).mockResolvedValueOnce([log('after', '2026-01-02')]);
  const first = loadAllLogs();
  clearQueryCache(); // e.g. sign-out, then another account signs in
  const second = await loadAllLogs();
  expect(getAllLogs).toHaveBeenCalledTimes(2);
  expect(second.map((l) => l.id)).toEqual(['after']);
  before.resolve([log('before', '2026-01-01')]);
  await first;
});

describe('slices', () => {
  const all = [log('a', '2026-01-01'), log('b', '2026-01-05'), log('c', '2026-01-09')];

  it('newestLogs matches getRecentLogs: newest first, capped', () => {
    expect(newestLogs(all, 2).map((l) => l.id)).toEqual(['c', 'b']);
    expect(newestLogs(all, 10).map((l) => l.id)).toEqual(['c', 'b', 'a']);
  });

  it('logsBetween matches getLogsInRange: inclusive, oldest first', () => {
    expect(logsBetween(all, '2026-01-01', '2026-01-05').map((l) => l.id)).toEqual(['a', 'b']);
    expect(logsBetween(all, '2026-01-02', '2026-01-04')).toEqual([]);
  });
});
