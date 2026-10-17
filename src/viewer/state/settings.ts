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

function merge(s: DisplaySettings, patch: DeepPartial<DisplaySettings>): DisplaySettings {
  return {
    diff: { ...s.diff, ...(patch.diff as Partial<DisplaySettings['diff']>) },
    tree: { ...s.tree, ...(patch.tree as Partial<DisplaySettings['tree']>) },
    review: { ...s.review, ...(patch.review as Partial<DisplaySettings['review']>) },
  };
}

export const useSettings = create<SettingsState>()((set, get) => ({
  settings: structuredClone(DEFAULT_SETTINGS) as DisplaySettings,
  loaded: false,
  colorMode: undefined,
  update(patch) {
    set({ settings: merge(get().settings, patch) });
    saveSettings(patch).catch((err: unknown) => console.warn('[pierre] saving settings failed', err));
  },
  setColorMode: (colorMode) => set({ colorMode }),
}));

/** Loads stored settings and follows changes from other contexts. Returns the unsubscribe function. */
export function initSettings(): () => void {
  loadSettings()
    .then((settings) => useSettings.setState({ settings, loaded: true }))
    .catch(() => useSettings.setState({ loaded: true }));
  return onSettingsChange((settings) => useSettings.setState({ settings }));
}

/**
 * The theme type Pierre renders with. `system` follows GitHub's own color mode when GitHub forces one
 * (`light` / `dark`); GitHub's `auto` keeps `system` (the OS preference, like GitHub).
 */
export function effectiveThemeType(themeType: ThemeTypes, colorMode: string | undefined): ThemeTypes {
  if (themeType !== 'system') return themeType;
  return colorMode === 'light' || colorMode === 'dark' ? colorMode : 'system';
}
