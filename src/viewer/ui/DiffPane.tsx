/**
 * The open file group's files in one virtualized Pierre CodeView (uncontrolled: items are seeded once, then updated
 * one by one with `updateItem`, see state/items.ts). A group switch hands the CodeView the new group's items with
 * `setItems`: items it already has keep their layout, and loaded diffs stay loaded. Related files
 * (state/relatedFiles.ts) order the items, companions after their main file;
 * a change of style or rules goes through `setItems` the same way. Their `gapBefore` takes the gap out of a box
 * (`layout.gapBefore`, added to @pierre/diffs by patches/), and a new one relays out the list.
 */
import type { DiffLineAnnotation, FileDiffLoadedFiles, FileDiffMetadata, LineAnnotation, SelectedLineRange } from '@pierre/diffs';
import { CodeView, type CodeViewHandle } from '@pierre/diffs/react';
import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { resolveFonts } from '../../shared/github-defaults';
import { fetchFullFile, type PrData, type Rpc } from '../github/private';
import type { ListAnchors } from '../pageScroll';
import { createAnnotationSource } from '../state/annotations';
import { targetFromRange } from '../state/compose';
import { ItemSync, type AnnotationMeta, type AnnotationSource, type PierreItem } from '../state/items';
import { rangeOids } from '../state/range';
import { currentRelated, useRelated } from '../state/relatedFiles';
import { session } from '../state/session';
import { useSettings } from '../state/settings';
import { isCollapsed, usePr } from '../state/store';
import { createDiffOptionsBuilder, createSettle, headerHeight, visibleFiles, type DiffViewOptions } from '../state/view';
import { Composer, openComposerAt } from './Composer';
import { FileHeader } from './FileHeader';
import { Thread } from './Thread';

type Handle = CodeViewHandle<AnnotationMeta, undefined>;

/** Files around the viewport that the loader should fetch first (and whose collapsed lines load lazily). */
const PRIORITY_AHEAD = 6;
const SCROLL_QUIET_MS = 700;

/** `loadDiffFiles`: full old/new contents for expanding context, at the shown range's base/head. */
function createFileLoader(rpc: Rpc, pr: PrData) {
  return async (fileDiff: FileDiffMetadata): Promise<FileDiffLoadedFiles> => {
    const { oldOid, newOid } = rangeOids(pr, usePr.getState().range);
    const path = fileDiff.name;
    const prevPath = fileDiff.prevName ?? path;
    const newContents = fetchFullFile(rpc, pr.ref, path, newOid);
    if (fileDiff.type === 'rename-pure') {
      return { oldFile: null, newFile: { name: path, contents: await newContents, cacheKey: `${newOid}:${path}` } };
    }
    const [oldText, newText] = await Promise.all([fetchFullFile(rpc, pr.ref, prevPath, oldOid), newContents]);
    return {
      oldFile: { name: prevPath, contents: oldText, cacheKey: `${oldOid}:${prevPath}` },
      newFile: { name: path, contents: newText, cacheKey: `${newOid}:${path}` },
    };
  };
}

/** `paths`: the files the CodeView holds, in order. */
function viewportFiles(handle: Handle, paths: readonly string[]): { ids: string[]; current?: string } {
  const instance = handle.getInstance();
  if (!instance) return { ids: [] };
  return visibleFiles(paths, (id) => instance.getTopForItem(id), instance.getScrollTop(), instance.getHeight(), headerHeight(useSettings.getState().settings.diff.fileHeaderStyle));
}

/** The top visible file and how far the list is scrolled into it (an item `offset` of `-offset` scrolls back there). */
function listAnchors(handle: Handle, sync: ItemSync): ListAnchors {
  return {
    anchor() {
      const instance = handle.getInstance();
      const { current } = viewportFiles(handle, sync.mountedPaths);
      const top = current === undefined ? undefined : instance?.getTopForItem(current);
      return instance && current !== undefined && top !== undefined ? { path: current, offset: instance.getScrollTop() - top } : null;
    },
    scrollToAnchor({ path, offset }) {
      if (handle.getItem(path)) handle.scrollTo({ type: 'item', id: path, align: 'start', offset: -offset });
    },
  };
}

/** CodeView callbacks get the item context last; the item id is the file path. */
const itemPath = (context: unknown): string | undefined => (context as { item?: { id?: string } } | undefined)?.item?.id;
const isMultiLine = (r: SelectedLineRange) => r.start !== r.end || (r.endSide ?? r.side) !== r.side;

/**
 * Gutter "+" (click, or drag over lines) opens a composer for that line or range; a multi-line line selection
 * (drag over line numbers) opens a range composer. Both fire for one gutter drag: opening is idempotent.
 */
const INTERACTIONS: DiffViewOptions = Object.freeze({
  enableGutterUtility: true,
  enableLineSelection: true,
  onGutterUtilityClick: ((range: SelectedLineRange, context: unknown) => {
    const path = itemPath(context);
    if (path) openComposerAt(targetFromRange(path, range));
  }) as DiffViewOptions['onGutterUtilityClick'],
  onLineSelectionEnd: ((range: SelectedLineRange | null, context: unknown) => {
    const path = itemPath(context);
    if (path && range && isMultiLine(range)) openComposerAt(targetFromRange(path, range));
  }) as DiffViewOptions['onLineSelectionEnd'],
});

/** Threads and open composers as line annotations; keyed so a slot never reuses another composer's textarea. */
export function renderAnnotation(annotation: DiffLineAnnotation<AnnotationMeta> | LineAnnotation<AnnotationMeta>) {
  const meta = annotation.metadata;
  return meta.kind === 'thread' ? (
    <Thread key={`t:${meta.threadKey}`} threadKey={meta.threadKey} />
  ) : (
    <Composer key={`c:${meta.key}`} draftKey={meta.key} mode="new" />
  );
}

export interface DiffPaneProps {
  rpc: Rpc;
  /** Thread/composer annotation source (default: `createAnnotationSource()`, one per pane). */
  annotations?: AnnotationSource;
}

export const DiffPane = memo(function DiffPane({ rpc, annotations }: DiffPaneProps) {
  const pr = usePr((s) => s.pr);
  const diffSettings = useSettings((s) => s.settings.diff);
  const colorMode = useSettings((s) => s.colorMode);
  const lineHeight = useSettings((s) => resolveFonts(s.settings.fonts).codeLineHeight);
  const handleRef = useRef<Handle | null>(null);
  const defaultSource = useMemo(createAnnotationSource, []);
  const source = annotations ?? defaultSource;
  const sync = useMemo(() => new ItemSync(source), [source]);

  const loadDiffFiles = useMemo(() => (pr ? createFileLoader(rpc, pr) : undefined), [rpc, pr]);

  const related = useRelated();
  const buildOptions = useMemo(createDiffOptionsBuilder, []);
  const options = buildOptions(diffSettings, colorMode, loadDiffFiles, INTERACTIONS, lineHeight, related.gapBefore);

  // Seeded once per PR; later changes go through `sync` → updateItem.
  const initialItems = useMemo<PierreItem[]>(() => (pr ? sync.seed(usePr.getState(), currentRelated().items) : []), [pr, sync]);

  useEffect(() => {
    if (!pr) return;
    const flush = () => {
      const handle = handleRef.current;
      if (handle) sync.sync(usePr.getState(), handle);
    };
    flush();
    return usePr.subscribe(flush);
  }, [pr, sync]);

  // Viewport → loader priority and tree selection, at most once per frame.
  const frame = useRef(0);
  const lastCurrent = useRef<string | undefined>(undefined);
  /** After a programmatic scroll (tree click), the tree keeps the clicked file until scrolling settles. */
  const quietUntil = useRef(0);
  /** Tree selection follows the diff only once scrolling pauses, off the scroll frames (see `createSettle`). */
  const treeSync = useMemo(
    () =>
      createSettle<string>((path) => {
        if (path === lastCurrent.current || performance.now() < quietUntil.current) return;
        lastCurrent.current = path;
        session.revealInTree?.(path);
      }),
    [],
  );
  useEffect(() => () => treeSync.cancel(), [treeSync]);
  const onViewport = useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const handle = handleRef.current;
      if (!handle) return;
      const { ids, current } = viewportFiles(handle, sync.mountedPaths);
      if (ids.length > 0) {
        // The next few files below the viewport too, so scrolling down finds them loaded.
        const order = sync.mountedPaths;
        const next = order.indexOf(current!) + ids.length;
        session.viewport = [...ids, ...order.slice(next, next + PRIORITY_AHEAD)];
        session.loader?.prioritize(session.viewport);
      }
      // Every scroll frame restarts the quiet period, so the tree only updates once scrolling pauses.
      if (current && performance.now() >= quietUntil.current) treeSync.push(current);
    });
  }, [treeSync, sync]);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  // A group switch (or a change of related files): its files load next, and the list keeps its place when the item at
  // its top is still listed, else starts at the top.
  const { items } = related;
  useEffect(() => {
    session.loader?.prefer(items);
    const handle = handleRef.current;
    const instance = handle?.getInstance();
    if (!handle || !instance || sync.mountedPaths === items) return;
    const anchors = listAnchors(handle, sync);
    const anchor = anchors.anchor();
    instance.setItems(sync.mount(items));
    session.pageScroll?.expectListScroll?.();
    if (anchor && items.includes(anchor.path)) anchors.scrollToAnchor(anchor);
    else handle.scrollTo({ type: 'position', position: 0 });
    onViewport();
  }, [items, sync, onViewport]);

  // The first viewport once items exist. (Loader restarts replay `session.viewport` themselves.)
  useEffect(() => {
    const t = setTimeout(onViewport, 0);
    return () => clearTimeout(t);
  }, [initialItems, onViewport]);

  const setHandle = useCallback((handle: Handle | null) => {
    handleRef.current = handle;
    session.codeView = handle;
    session.scrollToFile = handle
      ? (path: string) => {
          lastCurrent.current = path;
          quietUntil.current = performance.now() + SCROLL_QUIET_MS;
          treeSync.cancel();
          session.pageScroll?.expectListScroll?.();
          // A folded companion unfolds when selected in the tree.
          const s = usePr.getState();
          if (s.folded.has(path) && isCollapsed(s, path)) s.setCollapsed(path, false);
          handle.scrollTo({ type: 'item', id: path, align: 'start' });
        }
      : undefined;
    session.pageScroll?.attach(handle?.getInstance()?.getContainerElement() ?? null, handle ? listAnchors(handle, sync) : null);
  }, [treeSync, sync]);

  const renderCustomHeader = useCallback(
    (item: PierreItem) => <FileHeader path={item.id} />,
    [],
  );

  if (!pr) return <div className="pierre-diffs pierre-diffs-empty" />;
  return (
    <>
      {items.length === 0 && <div className="pierre-empty-group">No files in this group.</div>}
      <CodeView<AnnotationMeta, undefined>
        key={pr.headOid}
        ref={setHandle}
        className="pierre-diffs"
        initialItems={initialItems}
        options={options}
        onScroll={onViewport}
        renderCustomHeader={renderCustomHeader}
        renderAnnotation={renderAnnotation}
      />
    </>
  );
});
