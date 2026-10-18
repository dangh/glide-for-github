/**
 * File tree (@pierre/trees) with optional git status badges, comment-count and viewed decorations, a filter box,
 * selection → scroll the diff list, and diff scroll position → tree selection.
 *
 * Tree options are construction-time in @pierre/trees, so a Display-menu change remounts the tree (cheap).
 * Decoration changes (viewed, comments, renames) re-render the mounted rows via `model.render({})`.
 * A file group switch swaps the tree's paths in place (`resetPaths`), keeping the search and each folder's expansion.
 */
import type { FileTreeDirectoryHandle, GitStatusEntry } from '@pierre/trees';
import { FileTree, useFileTree } from '@pierre/trees/react';
import { memo, useEffect, useMemo, useRef } from 'react';
import { DEFAULT_SETTINGS, toTreeOptions, type TreeSettings } from '../../shared/settings';
import { useActiveGroup } from '../state/fileGroups';
import { session } from '../state/session';
import { effectiveThemeType, useSettings } from '../state/settings';
import { usePr } from '../state/store';
import { decorationFor, gitStatusEntries } from '../state/view';

type TreeModel = ReturnType<typeof useFileTree>['model'];
const ancestorsOf = (path: string): string[] => {
  const segments = path.split('/');
  const out: string[] = [];
  for (let i = 1; i < segments.length; i++) out.push(segments.slice(0, i).join('/') + '/');
  return out;
};

const directoryOf = (m: TreeModel, dir: string): FileTreeDirectoryHandle | undefined => {
  const item = m.getItem(dir) ?? m.getItem(dir.slice(0, -1));
  return item?.isDirectory() ? (item as FileTreeDirectoryHandle) : undefined;
};

const foldersOf = (paths: readonly string[]) => new Set(paths.flatMap(ancestorsOf));

function Tree({ paths, gitStatus, settings, colorScheme }: { paths: readonly string[]; gitStatus: GitStatusEntry[] | undefined; settings: TreeSettings; colorScheme: string }) {
  /** True while the diff scroll position updates the selection: that selection must not scroll the diff. */
  const syncing = useRef(false);
  const modelRef = useRef<TreeModel | null>(null);

  const { model } = useFileTree({
    paths,
    ...(gitStatus ? { gitStatus } : {}),
    ...toTreeOptions({ ...DEFAULT_SETTINGS, tree: settings }),
    renderRowDecoration: ({ item }) => (item.kind === 'file' ? decorationFor(usePr.getState(), item.path) : null),
    onSelectionChange: (selected) => {
      const path = selected.length === 1 ? selected[0]! : undefined;
      if (syncing.current || !path || !usePr.getState().files.has(path)) return;
      session.scrollToFile?.(path);
    },
  });
  modelRef.current = model;

  // A group switch: the new paths, with each folder as the user last left it in any group.
  const shownPaths = useRef(paths);
  const expansion = useRef(new Map<string, boolean>());
  useEffect(() => {
    if (shownPaths.current === paths) return;
    for (const dir of foldersOf(shownPaths.current)) {
      const item = directoryOf(model, dir);
      if (item) expansion.current.set(dir, item.isExpanded());
    }
    shownPaths.current = paths;
    const query = model.isSearchOpen() ? model.getSearchValue() : '';
    model.resetPaths(paths);
    for (const dir of foldersOf(paths)) {
      const expanded = expansion.current.get(dir);
      const item = expanded === undefined ? undefined : directoryOf(model, dir);
      if (item && item.isExpanded() !== expanded) {
        if (expanded) item.expand();
        else item.collapse();
      }
    }
    // resetPaths keeps the query but not its matches (still the old paths'); searching again finds the new ones.
    if (query) {
      model.setSearch('');
      model.setSearch(query);
    }
  }, [model, paths]);

  // Diff scroll position → tree selection.
  useEffect(() => {
    session.revealInTree = (path: string) => {
      const m = modelRef.current;
      if (!m) return;
      const selected = m.getSelectedPaths();
      if (selected.length === 1 && selected[0] === path) return;
      syncing.current = true;
      try {
        for (const p of selected) if (p !== path) m.getItem(p)?.deselect();
        for (const dir of ancestorsOf(path)) {
          const item = directoryOf(m, dir);
          if (item && !item.isExpanded()) item.expand();
        }
        m.getItem(path)?.select();
        m.scrollToPath(path, { focus: false, offset: 'nearest' });
      } finally {
        syncing.current = false;
      }
    };
    return () => {
      session.revealInTree = undefined;
    };
  }, []);

  // Re-render rows when decoration inputs change.
  useEffect(() => {
    let frame = 0;
    let last = usePr.getState();
    const unsubscribe = usePr.subscribe((s) => {
      if (s.viewed === last.viewed && s.threads === last.threads && s.files === last.files) return;
      last = s;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!model.getFileTreeContainer()) return;
        model.render({});
      });
    });
    return () => {
      unsubscribe();
      cancelAnimationFrame(frame);
    };
  }, [model]);

  return <FileTree model={model} className="pierre-tree" style={{ colorScheme }} />;
}

export const TreePane = memo(function TreePane() {
  const { shown } = useActiveGroup();
  const pr = usePr((s) => s.pr);
  const settings = useSettings((s) => s.settings.tree);
  const themeType = useSettings((s) => effectiveThemeType(s.settings.diff.themeType, s.colorMode));
  const gitStatus = useMemo(() => gitStatusEntries(pr?.files ?? [], settings), [pr, settings]);
  const key = useMemo(() => JSON.stringify(settings), [settings]);
  const colorScheme = themeType === 'system' ? 'light dark' : themeType;

  if (!pr) return <aside className="pierre-tree-pane" />;
  return (
    <aside className="pierre-tree-pane" data-testid="tree">
      <Tree key={`${pr.headOid}:${key}`} paths={shown} gitStatus={gitStatus} settings={settings} colorScheme={colorScheme} />
    </aside>
  );
});
