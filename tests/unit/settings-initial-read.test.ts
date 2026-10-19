import { afterEach, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, loadSettings, onSettingsChange, saveSettings, setSettingsStorage, SETTINGS_STORAGE_KEY, type SettingsStorage } from '../../src/shared/settings';
import { initSettings, useSettings } from '../../src/viewer/state/settings';

function delayedStorage() {
  let finish!: (items: Record<string, unknown>) => void;
  let change: Parameters<SettingsStorage['subscribe']>[0] = () => undefined;
  const writes: Record<string, unknown>[] = [];
  const storage: SettingsStorage = {
    area: {
      get: () => new Promise((resolve) => { finish = resolve; }),
      set: async (items) => {
        writes.push(items);
        change({ [SETTINGS_STORAGE_KEY]: { newValue: items[SETTINGS_STORAGE_KEY] } });
      },
    },
    subscribe: (callback) => {
      change = callback;
      return () => { change = () => undefined; };
    },
  };
  setSettingsStorage(storage);
  return {
    writes,
    resolve: (value: unknown) => finish({ [SETTINGS_STORAGE_KEY]: value }),
    emit: (value: unknown) => change({ [SETTINGS_STORAGE_KEY]: { newValue: value } }),
  };
}

afterEach(() => {
  setSettingsStorage(undefined);
  useSettings.setState({ settings: structuredClone(DEFAULT_SETTINGS), loaded: false });
});

it('keeps newer foreign settings in the returned value and the next unrelated write', async () => {
  const storage = delayedStorage();
  const off = onSettingsChange(() => undefined);
  try {
    const initial = loadSettings();
    storage.emit({ diff: { diffStyle: 'split' } });
    storage.resolve({ diff: { diffStyle: 'unified' } });
    expect((await initial).diff.diffStyle).toBe('split');
    await saveSettings({ tree: { search: false } });
    expect(storage.writes.at(-1)).toMatchObject({ [SETTINGS_STORAGE_KEY]: { diff: { diffStyle: 'split' } } });
  } finally { off(); }
});

it('keeps a local write even when its storage echo has arrived before the old read', async () => {
  const storage = delayedStorage();
  const off = onSettingsChange(() => undefined);
  try {
    storage.emit({ diff: { diffStyle: 'unified' } });
    const initial = loadSettings();
    await saveSettings({ diff: { diffStyle: 'split' } });
    storage.resolve({ diff: { diffStyle: 'unified' } });
    expect((await initial).diff.diffStyle).toBe('split');
    await saveSettings({ tree: { search: false } });
    expect(storage.writes.at(-1)).toMatchObject({ [SETTINGS_STORAGE_KEY]: { diff: { diffStyle: 'split' } } });
  } finally { off(); }
});

it('does not replace the visible settings with a stale initial value', async () => {
  const storage = delayedStorage();
  const off = initSettings();
  try {
    storage.emit({ diff: { diffStyle: 'split' } });
    storage.resolve({ diff: { diffStyle: 'unified' } });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(useSettings.getState().settings.diff.diffStyle).toBe('split');
    expect(useSettings.getState().loaded).toBe(true);
  } finally { off(); }
});

it('does not apply initial settings after the viewer unsubscribes', async () => {
  const storage = delayedStorage();
  const off = initSettings();
  off();
  storage.resolve({ diff: { diffStyle: 'unified' } });
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  expect(useSettings.getState().settings).toEqual(DEFAULT_SETTINGS);
  expect(useSettings.getState().loaded).toBe(false);
});
