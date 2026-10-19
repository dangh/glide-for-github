/** Pure view helpers (viewport math, tree decorations), kept out of the React components for unit tests. */
import type { FileDiffContentsLoader } from '@pierre/diffs';
import type { GitStatusEntry } from '@pierre/trees';
import type { CodeViewReactOptions } from '@pierre/diffs/react';
import { filePaddingBottom, hunkSeparatorHeight, resolveDiffChoice } from '../../shared/github-defaults';
import { DEFAULT_SETTINGS, toDiffOptions, treeNeedsGitStatus, type DiffSettings, type TreeSettings } from '../../shared/settings';
import type { FileSummary } from '../github/private';
import type { AnnotationMeta } from './items';
import type { GapBefore } from './relatedFiles';
import { effectiveThemeType } from './settings';
import { commentCount, threadsByPath, type PrState } from './store';

/**
 * Per-file header row height by `diff.fileHeaderStyle`: FileHeader renders exactly this and CodeView reserves it
 * (`itemMetrics.diffHeaderHeight`). GitHub's `.diff-file-header` is 42 px.
 */
const HEADER_HEIGHTS = Object.freeze({ default: 42, pierre: 40 });
export const headerHeight = (style: DiffSettings['fileHeaderStyle']): number => HEADER_HEIGHTS[style];

/** Pierre's default code row height (`--diffs-line-height`), GitHub's 20 px at the default 12 px font. */
export const DEFAULT_LINE_HEIGHT = 20;

type MetricsChoices = Pick<DiffSettings, 'overflow' | 'hunkSeparators' | 'fileHeaderStyle'>;
type ItemMetrics = Readonly<{ diffHeaderHeight: number; lineHeight: number; paddingBottom: number; hunkSeparatorHeight?: number }>;
const metricsByKey = new Map<string, ItemMetrics>();

/**
 * CodeView `itemMetrics` for a code row height and the diff options that size rows CodeView estimates without
 * measuring: rows at `lineHeight` (must match `--diffs-line-height`, github-defaults.ts toStyleVars), the space under
 * each file at `paddingBottom` (DIFF_CSS, per overflow), separator rows at `hunkSeparatorHeight` (GITHUB_HUNK_CSS) and
 * the header at `headerHeight`. One frozen object per combination, so CodeView's option comparison sees no change
 * while they stay.
 */
export function itemMetricsFor(lineHeight: number, diff: MetricsChoices = DEFAULT_SETTINGS.diff): ItemMetrics {
  const overflow = resolveDiffChoice('overflow', diff.overflow);
  const hunk = hunkSeparatorHeight(diff.hunkSeparators);
  const header = headerHeight(diff.fileHeaderStyle);
  const key = `${lineHeight}:${overflow}:${hunk}:${header}`;
  let m = metricsByKey.get(key);
  if (!m) {
    m = Object.freeze({ diffHeaderHeight: header, lineHeight, paddingBottom: filePaddingBottom(overflow), ...(hunk ? { hunkSeparatorHeight: hunk } : {}) });
    metricsByKey.set(key, m);
  }
  return m;
}

/** Metrics at the default code font size and diff settings. */
export const ITEM_METRICS = itemMetricsFor(DEFAULT_LINE_HEIGHT);

export type DiffViewOptions = CodeViewReactOptions<AnnotationMeta, undefined>;

/**
 * Memoized CodeView options: returns the previous object while the diff settings object, GitHub's color mode,
 * the file loader and the code line height are unchanged, so unrelated setting changes never call `setOptions`.
 */
export function createDiffOptionsBuilder() {
  let last:
    | {
        diff: DiffSettings;
        colorMode: string | undefined;
        loadDiffFiles?: FileDiffContentsLoader;
        interactions?: DiffViewOptions;
        lineHeight: number;
        gapBefore?: GapBefore;
        options: DiffViewOptions;
      }
    | undefined;
  /**
   * `interactions`: gutter "+" / line selection wiring (Task 9); pass a stable object. `lineHeight`: code row px.
   * `gapBefore`: the related files layout's (state/relatedFiles.ts).
   */
  return (
    diff: DiffSettings,
    colorMode: string | undefined,
    loadDiffFiles?: FileDiffContentsLoader,
    interactions?: DiffViewOptions,
    lineHeight: number = DEFAULT_LINE_HEIGHT,
    gapBefore?: GapBefore,
  ): DiffViewOptions => {
    if (
      last &&
      last.diff === diff &&
      last.colorMode === colorMode &&
      last.loadDiffFiles === loadDiffFiles &&
      last.interactions === interactions &&
      last.lineHeight === lineHeight &&
      last.gapBefore === gapBefore
    )
      return last.options;
    const base = toDiffOptions<AnnotationMeta>({ ...DEFAULT_SETTINGS, diff });
    const options: DiffViewOptions = {
      ...base,
      ...(gapBefore && base.layout ? { layout: { ...base.layout, gapBefore } } : {}),
      themeType: effectiveThemeType(diff.themeType, colorMode),
      itemMetrics: itemMetricsFor(lineHeight, diff),
      ...(loadDiffFiles ? { loadDiffFiles } : {}),
      ...interactions,
    };
    last = { diff, colorMode, ...(loadDiffFiles ? { loadDiffFiles } : {}), ...(interactions ? { interactions } : {}), lineHeight, ...(gapBefore ? { gapBefore } : {}), options };
    return options;
  };
}

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

/**
 * The tree's `gitStatus`: for its A/M/D letters, colored names and folder roll-ups (`tree.showGitStatus`) and for
 * GitHub's status file icons (`tree.icons` 'default'); undefined when neither is on, so @pierre/trees draws no status.
 */
export function gitStatusEntries(files: readonly FileSummary[], tree: Pick<TreeSettings, 'icons' | 'showGitStatus'>): GitStatusEntry[] | undefined {
  return treeNeedsGitStatus(tree) ? files.map((f) => ({ path: f.path, status: f.status })) : undefined;
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

/** The diff scroll position is mirrored into the tree only once scrolling has paused this long. */
export const TREE_SYNC_QUIET_MS = 150;

export interface SettleOptions {
  quietMs?: number;
  /** Runs `fn` when the main thread is idle (default `requestIdleCallback`, at most `IDLE_TIMEOUT_MS` later). */
  idle?: (fn: () => void) => () => void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
}

const IDLE_TIMEOUT_MS = 500;
const defaultIdle = (fn: () => void): (() => void) => {
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(() => fn(), { timeout: IDLE_TIMEOUT_MS });
    return () => cancelIdleCallback(id);
  }
  const id = setTimeout(fn, 0);
  return () => clearTimeout(id);
};

/**
 * Calls `run` with the last pushed value once pushes have stopped for `quietMs`, in an idle callback (Task 12).
 * Used for diff scroll → tree selection: revealing a file in the tree (select, expand folders, scroll the tree) made
 * the tree re-render and re-lay out inside scroll frames; on microsoft/vscode#151512 it raised the viewer's p99 task
 * from ~11 ms to ~20 ms while scrolling. The tree now catches up when scrolling pauses.
 */
export function createSettle<T>(run: (value: T) => void, options: SettleOptions = {}) {
  const quietMs = options.quietMs ?? TREE_SYNC_QUIET_MS;
  const idle = options.idle ?? defaultIdle;
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
  let timer: unknown;
  let cancelIdle: (() => void) | undefined;
  let pending: { value: T } | undefined;
  const cancel = () => {
    if (timer !== undefined) clearTimer(timer);
    timer = undefined;
    cancelIdle?.();
    cancelIdle = undefined;
  };
  return {
    push(value: T) {
      pending = { value };
      cancel();
      timer = setTimer(() => {
        timer = undefined;
        cancelIdle = idle(() => {
          cancelIdle = undefined;
          const p = pending;
          pending = undefined;
          if (p) run(p.value);
        });
      }, quietMs);
    },
    cancel() {
      pending = undefined;
      cancel();
    },
  };
}
