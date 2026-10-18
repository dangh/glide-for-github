/** A stored setting the content script follows while a tab is open (changes on the options page apply at once). */
import { SETTINGS_STORAGE_KEY } from '../shared/experiments';

export interface SettingSource<T> {
  /** The value now, or undefined while it is still being read. */
  get(): T | undefined;
  /** Calls `onChange` when the value changes; returns an unsubscribe function. */
  subscribe(onChange: () => void): () => void;
}

/** A value that never changes (tests, and the default when nothing else is given). */
export function fixedSetting<T>(value: T): SettingSource<T> {
  return { get: () => value, subscribe: () => () => undefined };
}

/** `read(item)` of the settings item in `chrome.storage.sync`. `read` maps a missing or unreadable item to the default. */
export function storedSetting<T>(read: (item: unknown) => T): SettingSource<T> {
  let value: T | undefined;
  const listeners = new Set<() => void>();
  const adopt = (item: unknown) => {
    const next = read(item);
    if (next === value) return;
    value = next;
    for (const fn of [...listeners]) fn();
  };
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes[SETTINGS_STORAGE_KEY]) adopt(changes[SETTINGS_STORAGE_KEY].newValue);
  });
  // A change that arrived while reading is newer than what was read; a failed read (extension reloaded) is the default.
  const first = (item: unknown) => {
    if (value === undefined) adopt(item);
  };
  chrome.storage.sync.get(SETTINGS_STORAGE_KEY).then((stored) => first(stored[SETTINGS_STORAGE_KEY]), () => first(undefined));
  return {
    get: () => value,
    subscribe(onChange) {
      listeners.add(onChange);
      return () => void listeners.delete(onChange);
    },
  };
}
