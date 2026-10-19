import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { READ_TIMEOUT_MS, storedSettings } from '../../src/content/settings-source';
import { SETTINGS_STORAGE_KEY } from '../../src/shared/experiments';

type ChangeListener = (changes: Record<string, { newValue?: unknown }>, area: string) => void;

/** `chrome.storage` whose first read the test settles (or never settles). */
function fakeStorage() {
  const listeners = new Set<ChangeListener>();
  let settle!: { resolve(stored: Record<string, unknown>): void; reject(err: Error): void };
  vi.stubGlobal('chrome', {
    storage: {
      sync: { get: () => new Promise((resolve, reject) => (settle = { resolve, reject })) },
      onChanged: { addListener: (l: ChangeListener) => void listeners.add(l) },
    },
  });
  return {
    read: (item: unknown) => settle.resolve(item === undefined ? {} : { [SETTINGS_STORAGE_KEY]: item }),
    fail: () => settle.reject(new Error('Extension context invalidated.')),
    change: (item: unknown, area = 'sync') => listeners.forEach((l) => l({ [SETTINGS_STORAGE_KEY]: { newValue: item } }, area)),
  };
}

const PAGE = { experiments: { pageScroll: true }, github: { replaceFilesTab: true } };
const tick = () => new Promise((r) => setImmediate(r));

beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('stored content settings', () => {
  it('are undefined until read, then follow changes, calling listeners only when they change', async () => {
    const storage = fakeStorage();
    const source = storedSettings();
    const onChange = vi.fn();
    source.subscribe(onChange);
    expect(source.get()).toBeUndefined();

    storage.read(PAGE);
    await tick();
    expect(source.get()).toEqual({ layout: 'page', replaceFilesTab: true });
    expect(onChange).toHaveBeenCalledTimes(1);

    storage.change({ ...PAGE, diff: { lineWrap: true } });
    storage.change(PAGE, 'local');
    expect(onChange).toHaveBeenCalledTimes(1);
    storage.change({ experiments: { pageScroll: true, mergedBar: true } });
    expect(source.get()).toEqual({ layout: 'merged', replaceFilesTab: false });
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('a change that arrives while the first read is in flight wins over what the read returns', async () => {
    const storage = fakeStorage();
    const source = storedSettings();
    storage.change(PAGE);
    storage.read(undefined);
    await tick();
    expect(source.get()).toEqual({ layout: 'page', replaceFilesTab: true });
  });

  it('a failed read means the defaults', async () => {
    const storage = fakeStorage();
    const source = storedSettings();
    storage.fail();
    await tick();
    expect(source.get()).toEqual({ layout: 'page', replaceFilesTab: false });
  });

  it('a read that does not settle in time means the defaults; a late one still applies', async () => {
    const storage = fakeStorage();
    const source = storedSettings();
    vi.advanceTimersByTime(READ_TIMEOUT_MS - 1);
    expect(source.get()).toBeUndefined();
    vi.advanceTimersByTime(1);
    expect(source.get()).toEqual({ layout: 'page', replaceFilesTab: false });

    storage.read(PAGE);
    await tick();
    expect(source.get()).toEqual({ layout: 'page', replaceFilesTab: true });
  });
});
