/** Stored toolbar options, read by both the content lifecycle and options page. */
export const SETTINGS_STORAGE_KEY = 'pierre.settings';

export interface ExperimentSettings {
  mergedBar: boolean;
}

/** Preserve the effective layout of settings saved before window scrolling became mandatory. */
export function experimentsOf(item: unknown): ExperimentSettings {
  const raw = (item as { experiments?: { mergedBar?: unknown; pageScroll?: unknown } } | null | undefined)?.experiments;
  return { mergedBar: raw?.mergedBar === true && (!Object.hasOwn(raw, 'pageScroll') || raw.pageScroll === true) };
}
