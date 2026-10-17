/** Pure view helpers (viewport math, tree decorations), kept out of the React components for unit tests. */
import { commentCount, threadsByPath, type PrState } from './store';

/**
 * Files intersecting the viewport, top first, and the current file (the one under the top edge), from the
 * CodeView layout (`getTopForItem` covers every item, rendered or not), by binary search over `order`.
 */
export function visibleFiles(
  order: readonly string[],
  topOf: (id: string) => number | undefined,
  scrollTop: number,
  height: number,
  /** The current file is the last one whose top is above `scrollTop + edgeOffset` (its header shows). */
  edgeOffset = 0,
): { ids: string[]; current?: string } {
  if (order.length === 0) return { ids: [] };
  const edge = scrollTop + edgeOffset;
  let lo = 0;
  let hi = order.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((topOf(order[mid]!) ?? Number.POSITIVE_INFINITY) <= edge) lo = mid;
    else hi = mid - 1;
  }
  const ids: string[] = [];
  const bottom = scrollTop + height;
  for (let i = lo; i < order.length && ids.length < 100; i++) {
    const top = topOf(order[i]!);
    if (top === undefined || top > bottom) break;
    ids.push(order[i]!);
  }
  return { ids, current: order[lo] };
}

export type Decoration = { text: string; title?: string; parts?: { text: string; color?: string }[] } | null;

const VIEWED_COLOR = 'var(--pierre-success)';
const MUTED_COLOR = 'var(--pierre-muted)';

/** Row decoration: comment count, viewed tick, rename source in the tooltip. */
export function decorationFor(state: Pick<PrState, 'files' | 'viewed' | 'threads'>, path: string): Decoration {
  const summary = state.files.get(path);
  if (!summary) return null;
  const comments = commentCount(threadsByPath(state.threads).get(path));
  const viewed = state.viewed.has(path);
  const parts: { text: string; color?: string }[] = [];
  const titles: string[] = [];
  if (summary.prevPath) titles.push(`Renamed from ${summary.prevPath}`);
  if (comments > 0) {
    parts.push({ text: `${comments}`, color: MUTED_COLOR });
    titles.push(`${comments} comment${comments === 1 ? '' : 's'}`);
  }
  if (viewed) {
    parts.push({ text: comments > 0 ? ' ✓' : '✓', color: VIEWED_COLOR });
    titles.push('Viewed');
  }
  if (parts.length === 0 && titles.length === 0) return null;
  return { text: parts.map((p) => p.text).join(''), title: titles.join(' · '), parts };
}
