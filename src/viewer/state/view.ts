/** Pure view helpers (viewport math, tree decorations), kept out of the React components for unit tests. */
import type { FileDiffContentsLoader } from '@pierre/diffs';
import type { GitStatusEntry } from '@pierre/trees';
import type { CodeViewReactOptions } from '@pierre/diffs/react';
import { DEFAULT_SETTINGS, toDiffOptions, type DiffSettings } from '../../shared/settings';
import type { PrRef } from '../../shared/pr-url';
import type { FileSummary } from '../github/private';
import type { AnnotationMeta } from './items';
import { effectiveThemeType } from './settings';
import { commentCount, threadsByPath, type PrState } from './store';

/** Height of the per-file header row; CodeView reserves exactly this (`itemMetrics.diffHeaderHeight`). */
export const HEADER_HEIGHT = 40;

/** Constant so CodeView's shallow option comparison sees no change. */
export const ITEM_METRICS = Object.freeze({ diffHeaderHeight: HEADER_HEIGHT });

export type DiffViewOptions = CodeViewReactOptions<AnnotationMeta, undefined>;

/**
 * Memoized CodeView options: returns the previous object while the diff settings object, GitHub's color mode
 * and the file loader are unchanged (by reference), so unrelated setting changes never call `setOptions`.
 */
export function createDiffOptionsBuilder() {
  let last:
    | { diff: DiffSettings; colorMode: string | undefined; loadDiffFiles?: FileDiffContentsLoader; interactions?: DiffViewOptions; options: DiffViewOptions }
    | undefined;
  /** `interactions`: gutter "+" / line selection wiring (Task 9); pass a stable object. */
  return (diff: DiffSettings, colorMode: string | undefined, loadDiffFiles?: FileDiffContentsLoader, interactions?: DiffViewOptions): DiffViewOptions => {
    if (last && last.diff === diff && last.colorMode === colorMode && last.loadDiffFiles === loadDiffFiles && last.interactions === interactions)
      return last.options;
    const options: DiffViewOptions = {
      ...toDiffOptions<AnnotationMeta>({ ...DEFAULT_SETTINGS, diff }),
      themeType: effectiveThemeType(diff.themeType, colorMode),
      itemMetrics: ITEM_METRICS,
      ...(loadDiffFiles ? { loadDiffFiles } : {}),
      ...interactions,
    };
    last = { diff, colorMode, ...(loadDiffFiles ? { loadDiffFiles } : {}), ...(interactions ? { interactions } : {}), options };
    return options;
  };
}

/** GitHub's Files changed page for a PR, at one file's diff when its path digest is known. */
export function filesChangedUrl(ref: Pick<PrRef, 'owner' | 'repo' | 'number'>, digest?: string): string {
  const base = `https://github.com/${ref.owner}/${ref.repo}/pull/${ref.number}/changes`;
  return digest ? `${base}#diff-${digest}` : base;
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
 * The tree's `gitStatus` (A/M/D letters, colored names and folder roll-ups), or undefined when the
 * `tree.showGitStatus` option is off, so @pierre/trees draws no status at all.
 */
export function gitStatusEntries(files: readonly FileSummary[], show: boolean): GitStatusEntry[] | undefined {
  return show ? files.map((f) => ({ path: f.path, status: f.status })) : undefined;
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
