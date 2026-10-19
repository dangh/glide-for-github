import type { ExperimentSettings } from './experiments';

export type ScrollLayout = 'page' | 'merged';

export function scrollLayoutOf(e: ExperimentSettings): ScrollLayout {
  return e.mergedBar ? 'merged' : 'page';
}

/** sessionStorage key for the scroll position restored on reload. */
export const restoreKey = (pr: string) => `glide.scroll:${pr}`;

/** Where the list was: the top visible file and how far into it, in px. */
export interface ScrollAnchor {
  path: string;
  offset: number;
}

export function parseScrollAnchor(raw: string | null): ScrollAnchor | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<ScrollAnchor> | null;
    return v && typeof v.path === 'string' && v.path !== '' && typeof v.offset === 'number' && Number.isFinite(v.offset)
      ? { path: v.path, offset: v.offset }
      : null;
  } catch {
    return null;
  }
}
