/**
 * Display settings inside the viewer: loaded from `chrome.storage.sync`, updated optimistically on change
 * (then persisted with `saveSettings`), and kept in step with other contexts via `onSettingsChange`.
 */
import type { ThemeTypes } from '@pierre/diffs';
import { create } from 'zustand';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  onSettingsChange,
  saveSettings,
  type DeepPartial,
  type DisplaySettings,
} from '../../shared/settings';

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
  const diff = shallowEqual(prev.diff, next.diff) ? prev.diff : next.diff;
  const tree = shallowEqual(prev.tree, next.tree) ? prev.tree : next.tree;
  const review = shallowEqual(prev.review, next.review) ? prev.review : next.review;
  return diff === prev.diff && tree === prev.tree && review === prev.review ? prev : { diff, tree, review };
}

function merge(s: DisplaySettings, patch: DeepPartial<DisplaySettings>): DisplaySettings {
  return reconcileSettings(s, {
    diff: { ...s.diff, ...(patch.diff as Partial<DisplaySettings['diff']>) },
    tree: { ...s.tree, ...(patch.tree as Partial<DisplaySettings['tree']>) },
    review: { ...s.review, ...(patch.review as Partial<DisplaySettings['review']>) },
  });
}

export const useSettings = create<SettingsState>()((set, get) => ({
  settings: structuredClone(DEFAULT_SETTINGS) as DisplaySettings,
  loaded: false,
  colorMode: undefined,
  update(patch) {
    const next = merge(get().settings, patch);
    if (next !== get().settings) set({ settings: next });
    saveSettings(patch).catch((err: unknown) => console.warn('[pierre] saving settings failed', err));
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
 * The theme type Pierre renders with. `system` follows GitHub's own color mode when GitHub forces one
 * (`light` / `dark`); GitHub's `auto` keeps `system` (the OS preference, like GitHub).
 */
export function effectiveThemeType(themeType: ThemeTypes, colorMode: string | undefined): ThemeTypes {
  if (themeType !== 'system') return themeType;
  return colorMode === 'light' || colorMode === 'dark' ? colorMode : 'system';
}
