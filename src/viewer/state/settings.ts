/**
 * Display settings inside the viewer: loaded from `chrome.storage.sync`, updated optimistically on change
 * (then persisted with `saveSettings`), and kept in step with other contexts via `onSettingsChange`.
 */
import type { ThemeTypes } from '@pierre/diffs';
import { create } from 'zustand';
import { resolveDiffChoice } from '../../shared/github-defaults';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  onSettingsChange,
  saveSettings,
  SETTINGS_SECTIONS,
  type DeepPartial,
  type DiffSettings,
  type DisplaySettings,
} from '../../shared/settings';
import { PORT_TIMEOUT_MESSAGE } from '../connection';
import { usePr } from './store';

export interface SettingsState {
  settings: DisplaySettings;
  loaded: boolean;
  /** GitHub's `data-color-mode` from the handshake (`light` / `dark` / `auto`). */
  colorMode: string | undefined;
  update(patch: DeepPartial<DisplaySettings>): void;
  setColorMode(mode: string | undefined): void;
}

const shallowEqual = (a: object, b: object) => {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
};

/**
 * `next`, reusing `prev`'s section objects (and `prev` itself) wherever the values are shallow-equal, so a
 * tree-only change, a review toggle or the storage echo of our own write keeps `settings.diff` identical and
 * the diff view's options untouched.
 */
export function reconcileSettings(prev: DisplaySettings, next: DisplaySettings): DisplaySettings {
  const out = {} as Record<keyof DisplaySettings, object>;
  let changed = false;
  for (const name of SETTINGS_SECTIONS) {
    const same = shallowEqual(prev[name], next[name]);
    out[name] = same ? prev[name] : next[name];
    if (!same) changed = true;
  }
  return changed ? (out as unknown as DisplaySettings) : prev;
}

function merge(s: DisplaySettings, patch: DeepPartial<DisplaySettings>): DisplaySettings {
  const next = {} as Record<keyof DisplaySettings, object>;
  for (const name of SETTINGS_SECTIONS) next[name] = { ...s[name], ...(patch[name] as object | undefined) };
  return reconcileSettings(s, next as unknown as DisplaySettings);
}

export const useSettings = create<SettingsState>()((set, get) => ({
  settings: structuredClone(DEFAULT_SETTINGS) as DisplaySettings,
  loaded: false,
  colorMode: undefined,
  update(patch) {
    const next = merge(get().settings, patch);
    if (next !== get().settings) set({ settings: next });
    saveSettings(patch).catch((err: unknown) => {
      // The extension was reloaded or updated under this page: nothing it does can persist until a reload.
      if (!globalThis.chrome?.runtime?.id) usePr.getState().setNotice({ kind: 'error', message: PORT_TIMEOUT_MESSAGE });
      else console.warn('[pierre] saving settings failed', err);
    });
  },
  setColorMode: (colorMode) => set({ colorMode }),
}));

/** Loads stored settings and follows changes from other contexts. Returns the unsubscribe function. */
export function initSettings(): () => void {
  loadSettings()
    .then((settings) => useSettings.setState((s) => ({ settings: reconcileSettings(s.settings, settings), loaded: true })))
    .catch(() => useSettings.setState({ loaded: true }));
  // Also fires for our own writes (the echo): reconcile so unchanged sections keep their identity.
  return onSettingsChange((settings) =>
    useSettings.setState((s) => {
      const next = reconcileSettings(s.settings, settings);
      return next === s.settings ? s : { settings: next };
    }),
  );
}

/**
 * The theme type Pierre renders with. `system` (also what 'default' resolves to) follows GitHub's own color mode
 * when GitHub forces one (`light` / `dark`); GitHub's `auto` keeps `system` (the OS preference, like GitHub).
 */
export function effectiveThemeType(themeType: DiffSettings['themeType'], colorMode: string | undefined): ThemeTypes {
  const resolved = resolveDiffChoice('themeType', themeType);
  if (resolved !== 'system') return resolved;
  return colorMode === 'light' || colorMode === 'dark' ? colorMode : 'system';
}
