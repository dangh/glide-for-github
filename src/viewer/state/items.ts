/**
 * CodeView items, one per file, keyed by path.
 *
 * Items are built once from the summaries (header-only placeholder diffs) and afterwards only changed
 * items are pushed to the CodeView with `updateItem` (bumped `version`), never the whole list. An item's
 * inputs are: its diff (placeholder until loaded), its collapsed flag, and its annotations. The per-file
 * header (path, counts, Viewed, notices) is a React component that subscribes to the store itself, so a
 * header-only change (e.g. "Loading…" → loaded counts) does not need an item update.
 *
 * Annotations (Task 9): `AnnotationSource(path, state)` returns the file's annotations (threads at
 * `{side, lineNumber}`, file-level at `lineNumber: 0`, plus open composers). It MUST return the same array
 * reference while nothing about that file changed; a new reference re-renders that one item only.
 */
import { getSingularPatch, type CodeViewDiffItem, type DiffLineAnnotation, type FileDiffMetadata } from '@pierre/diffs';
import { buildPatch } from '../github/convert';
import type { FileSummary } from '../github/private';
import type { DraftKey, PrState } from './store';
import { isCollapsed } from './store';

/** `threadKey`: the thread's stable key (`threadKey()` in store.ts, first comment id), not its id. */
export type AnnotationMeta = { kind: 'thread'; threadKey: string } | { kind: 'composer'; key: DraftKey };
export type FileAnnotation = DiffLineAnnotation<AnnotationMeta>;
export type PierreItem = CodeViewDiffItem<AnnotationMeta>;

export type AnnotationSource = (path: string, state: PrState) => readonly FileAnnotation[];

const EMPTY: readonly FileAnnotation[] = Object.freeze([]);
/** Task 7 renders no annotations; Task 9 supplies threads and composers. */
export const noAnnotations: AnnotationSource = () => EMPTY;

const placeholders = new WeakMap<FileSummary, FileDiffMetadata>();

/** Header-only diff for a file whose lines are not loaded (or have none). Cached per summary object. */
export function placeholderDiff(summary: FileSummary): FileDiffMetadata {
  let diff = placeholders.get(summary);
  if (!diff) {
    diff = getSingularPatch(buildPatch(summary, []));
    diff.cacheKey = `placeholder:${summary.digest}:${summary.prevPath ?? ''}`;
    placeholders.set(summary, diff);
  }
  return diff;
}

export interface ItemInputs {
  diff: FileDiffMetadata;
  collapsed: boolean;
  annotations: readonly FileAnnotation[];
}

export function itemInputs(state: PrState, path: string, annotations: AnnotationSource): ItemInputs | undefined {
  const summary = state.files.get(path);
  if (!summary) return undefined;
  return {
    diff: state.diffs.get(path) ?? placeholderDiff(summary),
    collapsed: isCollapsed(state, path),
    annotations: annotations(path, state),
  };
}

export function buildItem(path: string, inputs: ItemInputs, version: number): PierreItem {
  return {
    id: path,
    type: 'diff',
    fileDiff: inputs.diff,
    collapsed: inputs.collapsed,
    annotations: inputs.annotations as FileAnnotation[],
    version,
  };
}

const sameInputs = (a: ItemInputs, b: ItemInputs) =>
  a.diff === b.diff && a.collapsed === b.collapsed && a.annotations === b.annotations;

export interface ItemSink {
  updateItem(item: PierreItem): boolean;
}

/**
 * Keeps CodeView items in step with the store: `seed` builds the initial list, `sync` pushes only the
 * items whose inputs changed (by reference) since the last call. Every file is tracked, but only the mounted ones
 * (the open file group's, see `mount`) are pushed; the others keep their latest item for when they are mounted again.
 */
export class ItemSync {
  private last = new Map<string, { inputs: ItemInputs; item: PierreItem }>();
  private mounted = new Set<string>();
  /** The paths last passed to `mount`. */
  mountedPaths: readonly string[] = [];
  private lastDeps: unknown[] = [];

  constructor(private readonly annotations: AnnotationSource = noAnnotations) {}

  /** The state slices item inputs can depend on; when none changed, `sync` skips the per-file pass. */
  private deps(state: PrState): unknown[] {
    return [state.order, state.files, state.diffs, state.viewed, state.collapsed, state.threads, state.drafts];
  }

  /** Items for `paths` (default: every file), which are then the mounted ones. */
  seed(state: PrState, paths: readonly string[] = state.order): PierreItem[] {
    this.last.clear();
    this.lastDeps = this.deps(state);
    for (const path of state.order) {
      const inputs = itemInputs(state, path, this.annotations);
      if (inputs) this.last.set(path, { inputs, item: buildItem(path, inputs, 1) });
    }
    return this.mount(paths);
  }

  /** The current items for `paths`, which become the mounted ones (the CodeView is about to show exactly these). */
  mount(paths: readonly string[]): PierreItem[] {
    const items: PierreItem[] = [];
    for (const path of paths) {
      const entry = this.last.get(path);
      if (entry) items.push(entry.item);
    }
    this.mounted = new Set(items.map((i) => i.id));
    this.mountedPaths = paths;
    return items;
  }

  /** Returns the mounted paths that were updated. */
  sync(state: PrState, sink: ItemSink): string[] {
    const deps = this.deps(state);
    if (deps.every((d, i) => d === this.lastDeps[i])) return [];
    this.lastDeps = deps;
    const updated: string[] = [];
    for (const path of state.order) {
      const prev = this.last.get(path);
      if (!prev) continue;
      const inputs = itemInputs(state, path, this.annotations);
      if (!inputs || sameInputs(prev.inputs, inputs)) continue;
      const item = buildItem(path, inputs, (prev.item.version ?? 1) + 1);
      this.last.set(path, { inputs, item });
      if (!this.mounted.has(path)) continue;
      sink.updateItem(item);
      updated.push(path);
    }
    return updated;
  }
}
