/**
 * Every file in one virtualized Pierre CodeView (uncontrolled: items are seeded once, then updated one by
 * one with `updateItem`, see state/items.ts).
 */
import type { FileDiffLoadedFiles, FileDiffMetadata } from '@pierre/diffs';
import { CodeView, type CodeViewHandle, type CodeViewReactOptions } from '@pierre/diffs/react';
import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { DEFAULT_SETTINGS, toDiffOptions } from '../../shared/settings';
import { fetchFullFile, type PrData, type Rpc } from '../github/private';
import { ItemSync, noAnnotations, type AnnotationMeta, type AnnotationSource, type PierreItem } from '../state/items';
import { rangeOids } from '../state/range';
import { session } from '../state/session';
import { effectiveThemeType, useSettings } from '../state/settings';
import { usePr } from '../state/store';
import { FileHeader, HEADER_HEIGHT } from './FileHeader';
import { visibleFiles } from '../state/view';

type Handle = CodeViewHandle<AnnotationMeta, undefined>;
type Options = CodeViewReactOptions<AnnotationMeta, undefined>;

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

function viewportFiles(handle: Handle): { ids: string[]; current?: string } {
  const instance = handle.getInstance();
  if (!instance) return { ids: [] };
  return visibleFiles(usePr.getState().order, (id) => instance.getTopForItem(id), instance.getScrollTop(), instance.getHeight(), HEADER_HEIGHT);
}

export interface DiffPaneProps {
  rpc: Rpc;
  /** Task 9 passes the thread/composer annotation source. */
  annotations?: AnnotationSource;
}

export const DiffPane = memo(function DiffPane({ rpc, annotations = noAnnotations }: DiffPaneProps) {
  const pr = usePr((s) => s.pr);
  const diffSettings = useSettings((s) => s.settings.diff);
  const colorMode = useSettings((s) => s.colorMode);
  const handleRef = useRef<Handle | null>(null);
  const sync = useMemo(() => new ItemSync(annotations), [annotations]);

  const loadDiffFiles = useMemo(() => (pr ? createFileLoader(rpc, pr) : undefined), [rpc, pr]);

  const options = useMemo<Options>(() => {
    const base = toDiffOptions<AnnotationMeta>({ ...DEFAULT_SETTINGS, diff: diffSettings });
    return {
      ...base,
      themeType: effectiveThemeType(diffSettings.themeType, colorMode),
      itemMetrics: { diffHeaderHeight: HEADER_HEIGHT },
      ...(loadDiffFiles ? { loadDiffFiles } : {}),
    };
  }, [diffSettings, colorMode, loadDiffFiles]);

  // Seeded once per PR; later changes go through `sync` → updateItem.
  const initialItems = useMemo<PierreItem[]>(() => (pr ? sync.seed(usePr.getState()) : []), [pr, sync]);

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
  const onViewport = useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const handle = handleRef.current;
      if (!handle) return;
      const { ids, current } = viewportFiles(handle);
      if (ids.length > 0) {
        // The next few files below the viewport too, so scrolling down finds them loaded.
        const order = usePr.getState().order;
        const next = order.indexOf(current!) + ids.length;
        session.loader?.prioritize([...ids, ...order.slice(next, next + PRIORITY_AHEAD)]);
      }
      if (current && current !== lastCurrent.current && performance.now() >= quietUntil.current) {
        lastCurrent.current = current;
        session.revealInTree?.(current);
      }
    });
  }, []);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  // Loader restarts (range/whitespace) need the current viewport again.
  const loadVersion = usePr((s) => s.range);
  useEffect(() => {
    const t = setTimeout(onViewport, 0);
    return () => clearTimeout(t);
  }, [loadVersion, initialItems, onViewport]);

  const setHandle = useCallback((handle: Handle | null) => {
    handleRef.current = handle;
    session.codeView = handle;
    session.scrollToFile = handle
      ? (path: string) => {
          lastCurrent.current = path;
          quietUntil.current = performance.now() + SCROLL_QUIET_MS;
          handle.scrollTo({ type: 'item', id: path, align: 'start' });
        }
      : undefined;
  }, []);

  const renderCustomHeader = useCallback((item: PierreItem) => <FileHeader path={item.id} />, []);

  if (!pr) return <div className="pierre-diffs pierre-diffs-empty" />;
  return (
    <CodeView<AnnotationMeta, undefined>
      key={pr.headOid}
      ref={setHandle}
      className="pierre-diffs"
      initialItems={initialItems}
      options={options}
      onScroll={onViewport}
      renderCustomHeader={renderCustomHeader}
    />
  );
});
