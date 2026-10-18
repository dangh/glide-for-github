/**
 * The stored settings the content script follows while a tab is open (changes on the options page apply at once).
 * It reads only these sections, so content.js does not bundle the settings schema (src/shared/settings.ts).
 */
import { experimentsOf, SETTINGS_STORAGE_KEY } from '../shared/experiments';
import { githubSettingsOf } from '../shared/github-settings';
import { scrollLayoutOf, type ScrollLayout } from '../shared/page-scroll';

export interface ContentSettings {
  /** The layout for a viewer mounted now. */
  layout: ScrollLayout;
  /** "Replace Files changed with Glide" (src/content/lifecycle.ts). */
  replaceFilesTab: boolean;
}

export const DEFAULT_CONTENT_SETTINGS: ContentSettings = { layout: 'frame', replaceFilesTab: false };

/** The content script's settings in a stored settings item; anything missing or invalid is the default. */
export function contentSettingsOf(item: unknown): ContentSettings {
  return { layout: scrollLayoutOf(experimentsOf(item)), replaceFilesTab: githubSettingsOf(item).replaceFilesTab };
}

export interface SettingsSource {
  /** The settings now, or undefined while they are still being read. */
  get(): ContentSettings | undefined;
  /** Calls `onChange` when the settings change; returns an unsubscribe function. */
  subscribe(onChange: () => void): () => void;
}

/** Settings that never change (tests, and the default when nothing else is given). */
export function fixedSettings(settings: Partial<ContentSettings> = {}): SettingsSource {
  const value = { ...DEFAULT_CONTENT_SETTINGS, ...settings };
  return { get: () => value, subscribe: () => () => undefined };
}

/** How long the first read may take before the defaults apply: the viewer waits for it. */
export const READ_TIMEOUT_MS = 1000;

/** The settings in `chrome.storage.sync`. */
export function storedSettings(): SettingsSource {
  let value: ContentSettings | undefined;
  /** A change arrived: it is newer than anything the first read returns. */
  let changed = false;
  const listeners = new Set<() => void>();
  const adopt = (item: unknown) => {
    const next = contentSettingsOf(item);
    if (value && next.layout === value.layout && next.replaceFilesTab === value.replaceFilesTab) return;
    value = next;
    for (const fn of [...listeners]) fn();
  };
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync' || !changes[SETTINGS_STORAGE_KEY]) return;
    changed = true;
    adopt(changes[SETTINGS_STORAGE_KEY].newValue);
  });
  // A read that fails (extension reloaded) or never settles means the defaults; one that is only late still applies.
  const timer = setTimeout(() => {
    if (!value) adopt(undefined);
  }, READ_TIMEOUT_MS);
  const first = (item: unknown) => {
    clearTimeout(timer);
    if (!changed) adopt(item);
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
