/**
 * Viewer state (zustand). Later tasks depend on these names:
 * - Task 9: `threads`, `upsertThread`, `removeComment`, `drafts`/`setDraft`/`clearDraft` (composer drafts), items' annotations.
 * - Task 10: `viewed`/`setViewedLocal`, `pendingReview`, `headMoved`.
 * - Task 11: `headMoved`, `drafts` (persisted per PR).
 *
 * Every collection is replaced (never mutated in place) so selectors can compare by reference; no-op actions
 * return the same state (no notification). Subscribe with
 * narrow selectors: a diff landing must not re-render the toolbar or the tree.
 */
import type { FileDiffMetadata } from '@pierre/diffs';
import { create } from 'zustand';
import type { FileSummary, PrData } from '../github/private';
import type { DiffSide, ThreadModel } from '../github/threads';
import type { CommitRange } from './range';

/** `${path}:${side}:${startLine ?? ''}-${line}` | `reply:${threadId}` | `edit:${databaseId}` | `review-summary`. */
export type DraftKey = string;

export interface Draft {
  body: string;
  /** Line comment target (new comments). */
  path?: string;
  side?: DiffSide;
  line?: number;
  startLine?: number;
  startSide?: DiffSide;
  subject?: 'line' | 'file';
  /** Reply target. */
  threadId?: string;
  /** Edit target (comment databaseId). */
  databaseId?: number;
  updatedAt: number;
}

export const draftKey = {
  line: (path: string, side: DiffSide, line: number, startLine?: number): DraftKey => `${path}:${side}:${startLine ?? ''}-${line}`,
  reply: (threadId: string): DraftKey => `reply:${threadId}`,
  edit: (databaseId: number): DraftKey => `edit:${databaseId}`,
  reviewSummary: 'review-summary' as DraftKey,
};

/**
 * Per-file loading state.
 * - `pending`: not requested yet (placeholder item); `loading`: request in flight.
 * - `loaded`: diff in `diffs` (`empty` when it has no lines: pure rename, mode change, or no change in the range).
 * - `needs-lines`: GitHub collapsed it (deleted files); lines load when it comes near the viewport.
 * - `too-large`: lines only on "Load diff" (`loadingLines` while that request runs).
 * - `binary`: no text diff. `error`: `message` says why; retry re-queues it.
 * `additions`/`deletions` are the counts for the requested range/whitespace (summaries hold the full PR's).
 */
export interface FileLoadState {
  status: 'pending' | 'loading' | 'loaded' | 'needs-lines' | 'too-large' | 'binary' | 'error';
  additions?: number;
  deletions?: number;
  empty?: boolean;
  loadingLines?: boolean;
  message?: string;
}

export interface Notice {
  kind: 'info' | 'error';
  message: string;
}

/** One finished file from the loader. */
export interface FileLoadResult {
  path: string;
  /** The summary updated with the entry's flags (`applyDiffEntry`). */
  summary: FileSummary;
  load: FileLoadState;
  diff?: FileDiffMetadata;
}

export interface PrState {
  pr: PrData | null;
  /** File paths in GitHub's order. */
  order: string[];
  /** Current summaries by path (binary/tooLarge/prevPath are updated as entries load). */
  files: Map<string, FileSummary>;
  diffs: Map<string, FileDiffMetadata>;
  load: Map<string, FileLoadState>;
  threads: ThreadModel[];
  viewed: Set<string>;
  range: CommitRange;
  drafts: Map<DraftKey, Draft>;
  pendingReview: { nodeId: string; count: number } | null;
  headMoved: boolean;
  /** User collapse overrides by path (absent = default: collapsed iff viewed). */
  collapsed: Map<string, boolean>;
  notice: Notice | null;
  /** Full-pane error (PR data could not be read). */
  fatal: string | null;

  setPr(pr: PrData): void;
  setFatal(message: string | null): void;
  /** Clears diffs and loading state (range or whitespace changed); summaries and viewed stay. */
  resetDiffs(): void;
  setRange(range: CommitRange): void;
  setLoad(paths: readonly string[], load: FileLoadState): void;
  applyLoads(results: readonly FileLoadResult[]): void;
  setViewedLocal(path: string, viewed: boolean): void;
  setCollapsed(path: string, collapsed: boolean | undefined): void;
  setThreads(threads: ThreadModel[]): void;
  upsertThread(thread: ThreadModel): void;
  removeComment(databaseId: number): void;
  setDraft(key: DraftKey, draft: Draft): void;
  clearDraft(key: DraftKey): void;
  setPendingReview(review: { nodeId: string; count: number } | null): void;
  setHeadMoved(moved: boolean): void;
  setNotice(notice: Notice | null): void;
}

const initialData = () => ({
  pr: null,
  order: [] as string[],
  files: new Map<string, FileSummary>(),
  diffs: new Map<string, FileDiffMetadata>(),
  load: new Map<string, FileLoadState>(),
  threads: [] as ThreadModel[],
  viewed: new Set<string>(),
  range: {} as CommitRange,
  drafts: new Map<DraftKey, Draft>(),
  pendingReview: null,
  headMoved: false,
  collapsed: new Map<string, boolean>(),
  notice: null,
  fatal: null,
});

const PENDING: FileLoadState = Object.freeze({ status: 'pending' }) as FileLoadState;

export const createPrStore = () =>
  create<PrState>()((set) => ({
    ...initialData(),

    setPr: (pr) =>
      set({
        pr,
        order: pr.files.map((f) => f.path),
        files: new Map(pr.files.map((f) => [f.path, f])),
        diffs: new Map(),
        load: new Map(pr.files.map((f) => [f.path, PENDING])),
        viewed: new Set(pr.files.filter((f) => f.viewed).map((f) => f.path)),
        collapsed: new Map(),
        fatal: null,
      }),

    setFatal: (fatal) => set({ fatal }),

    resetDiffs: () => set((s) => ({ diffs: new Map(), load: new Map(s.order.map((p) => [p, PENDING])) })),

    setRange: (range) =>
      set((s) => (s.range.base === range.base && s.range.head === range.head ? s : { range: { ...range } })),

    setLoad: (paths, load) =>
      set((s) => {
        const next = new Map(s.load);
        for (const p of paths) next.set(p, load);
        return { load: next };
      }),

    applyLoads: (results) =>
      set((s) => {
        if (results.length === 0) return s;
        const files = new Map(s.files);
        const diffs = new Map(s.diffs);
        const load = new Map(s.load);
        for (const r of results) {
          if (!files.has(r.path)) continue;
          files.set(r.path, r.summary);
          load.set(r.path, r.load);
          if (r.diff) diffs.set(r.path, r.diff);
          else diffs.delete(r.path);
        }
        return { files, diffs, load };
      }),

    setViewedLocal: (path, viewed) =>
      set((s) => {
        if (s.viewed.has(path) === viewed) return s;
        const next = new Set(s.viewed);
        if (viewed) next.add(path);
        else next.delete(path);
        // A viewed toggle resets the manual collapse override so the file follows its viewed state.
        const collapsed = new Map(s.collapsed);
        collapsed.delete(path);
        return { viewed: next, collapsed };
      }),

    setCollapsed: (path, value) =>
      set((s) => {
        const collapsed = new Map(s.collapsed);
        if (value === undefined) collapsed.delete(path);
        else collapsed.set(path, value);
        return { collapsed };
      }),

    setThreads: (threads) => set({ threads }),

    upsertThread: (thread) =>
      set((s) => {
        const i = s.threads.findIndex((t) => t.id === thread.id);
        const threads = [...s.threads];
        if (i >= 0) threads[i] = thread;
        else threads.push(thread);
        return { threads };
      }),

    removeComment: (databaseId) =>
      set((s) => {
        let changed = false;
        const threads: ThreadModel[] = [];
        for (const t of s.threads) {
          if (!t.comments.some((c) => c.databaseId === databaseId)) {
            threads.push(t);
            continue;
          }
          changed = true;
          const comments = t.comments.filter((c) => c.databaseId !== databaseId);
          if (comments.length > 0) threads.push({ ...t, comments });
        }
        return changed ? { threads } : s;
      }),

    setDraft: (key, draft) =>
      set((s) => {
        const drafts = new Map(s.drafts);
        drafts.set(key, draft);
        return { drafts };
      }),

    clearDraft: (key) =>
      set((s) => {
        if (!s.drafts.has(key)) return s;
        const drafts = new Map(s.drafts);
        drafts.delete(key);
        return { drafts };
      }),

    setPendingReview: (pendingReview) => set({ pendingReview }),
    setHeadMoved: (headMoved) => set({ headMoved }),
    setNotice: (notice) => set({ notice }),
  }));

/** The viewer's store. */
export const usePr = createPrStore();

/** Whether a file's item is collapsed: the user's override, else viewed files are collapsed. */
export function isCollapsed(s: Pick<PrState, 'collapsed' | 'viewed'>, path: string): boolean {
  return s.collapsed.get(path) ?? s.viewed.has(path);
}

const threadsByPathCache = new WeakMap<ThreadModel[], Map<string, ThreadModel[]>>();

/** Threads grouped by path; cached per `threads` array, so the result is reference-stable between thread changes. */
export function threadsByPath(threads: ThreadModel[]): Map<string, ThreadModel[]> {
  let map = threadsByPathCache.get(threads);
  if (!map) {
    map = new Map();
    for (const t of threads) {
      const list = map.get(t.path);
      if (list) list.push(t);
      else map.set(t.path, [t]);
    }
    threadsByPathCache.set(threads, map);
  }
  return map;
}

/** Comment count per path (all comments of all threads on the file). */
export function commentCount(threads: ThreadModel[] | undefined): number {
  let n = 0;
  for (const t of threads ?? []) n += t.comments.length;
  return n;
}
