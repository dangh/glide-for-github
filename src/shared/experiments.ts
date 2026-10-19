/**
 * The `experiments` section of the stored settings item. src/shared/settings.ts owns the item and validates every
 * section; the content script reads only this one, through this module, so it does not bundle the display schema.
 */

export const SETTINGS_STORAGE_KEY = 'pierre.settings';

/** Options page only (not in the viewer's Display menu); the content script reads them when it mounts the viewer. */
export interface ExperimentSettings {
  pageScroll: boolean;
  /** Ignored unless `pageScroll` is on. */
  mergedBar: boolean;
  /** Try-out, ignored unless `pageScroll` is on: macOS's rubber band where it cannot jank (src/shared/page-scroll.ts). */
  rubberBand: boolean;
}

/** The experiments in a stored settings item: anything but `true` is off, the default; `rubberBand` is on unless `false`. */
export function experimentsOf(item: unknown): ExperimentSettings {
  const raw = (item as { experiments?: Partial<Record<keyof ExperimentSettings, unknown>> } | null | undefined)?.experiments;
  return { pageScroll: raw?.pageScroll === true, mergedBar: raw?.mergedBar === true, rubberBand: raw?.rubberBand !== false };
}
