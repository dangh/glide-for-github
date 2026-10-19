/**
 * File tree (@pierre/trees) with optional git status badges, comment-count and viewed decorations, a filter box,
 * selection → scroll the diff list, and diff scroll position → tree selection.
 *
 * Tree options are construction-time in @pierre/trees, so a Display-menu change remounts the tree (cheap).
 * Decoration changes (viewed, comments, renames) re-render the mounted rows via `model.render({})`.
 * A file group switch swaps the tree's paths in place (`resetPaths`), keeping the search and each folder's expansion;
 * a click on a group tab, which blurs and so closes the search, reopens it (`session.keepTreeSearch`).
 * Related files sit right after their main file, indented and dimmed (state/relatedTree.ts); a change of relations
 * re-sorts the same way, and swaps the stylesheet the tree's shadow root holds for them. The pane's width and its
 * resize handle are TreePaneFrame's.
 */
import type { FileTreeDirectoryHandle, GitStatusEntry } from '@pierre/trees';
import { FileTree, useFileTree } from '@pierre/trees/react';
import { memo, useEffect, useMemo, useRef } from 'react';
import type { Relations } from '../../shared/related-files';
import { DEFAULT_SETTINGS, toTreeOptions, type TreeSettings } from '../../shared/settings';
import { useActiveGroup, useFileGroups } from '../state/fileGroups';
import { useRelated, useRelatedRules } from '../state/relatedFiles';
import { relatedSort, relatedTreeCss } from '../state/relatedTree';
import { session } from '../state/session';
import { effectiveThemeType, useSettings } from '../state/settings';
import { usePr } from '../state/store';
import { chainExpanded, folderChains, noteExpansion } from '../state/treeFolders';
import { decorationFor, gitStatusEntries } from '../state/view';
import { TreePaneFrame } from './TreePaneFrame';

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

/** The tree's stylesheet for related files, in its open shadow root (`unsafeCSS` is fixed when the tree is created). */
function setRelatedCss(model: TreeModel, css: string) {
  const root = model.getFileTreeContainer()?.shadowRoot;
  if (!root) return;
  let style = root.querySelector<HTMLStyleElement>('style[data-related-files]');
  if (!style) {
    style = document.createElement('style');
    style.dataset.relatedFiles = '';
    root.append(style);
  }
  if (style.textContent !== css) style.textContent = css;
}

function Tree({
  paths,
  relations,
  gitStatus,
  settings,
  colorScheme,
}: {
  paths: readonly string[];
  relations: Relations;
  gitStatus: GitStatusEntry[] | undefined;
  settings: TreeSettings;
  colorScheme: string;
}) {
  /** True while the diff scroll position updates the selection: that selection must not scroll the diff. */
  const syncing = useRef(false);
  const modelRef = useRef<TreeModel | null>(null);
  const relationsRef = useRef(relations);
  relationsRef.current = relations;
  const sort = useMemo(() => relatedSort(() => relationsRef.current), []);

  const { model } = useFileTree({
    paths,
    sort,
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

  // A group switch: the new paths, with each folder row as the user last left it in any group (rows of merged
  // single-child folders included, however the new group merges them: state/treeFolders.ts).
  const shownPaths = useRef(paths);
  const sortedBy = useRef(relations);
  const expansion = useRef(new Map<string, boolean>());
  useEffect(() => {
    if (shownPaths.current === paths && sortedBy.current === relations) return;
    sortedBy.current = relations;
    const flatten = settings.flattenEmptyDirectories;
    noteExpansion(folderChains(shownPaths.current, flatten), (dir) => directoryOf(model, dir)?.isExpanded(), expansion.current);
    shownPaths.current = paths;
    const query = model.isSearchOpen() ? model.getSearchValue() : '';
    model.resetPaths(paths);
    for (const chain of folderChains(paths, flatten)) {
      const expanded = chainExpanded(chain, expansion.current);
      if (expanded === undefined) continue;
      for (const dir of chain) {
        const item = directoryOf(model, dir);
        if (item && item.isExpanded() !== expanded) {
          if (expanded) item.expand();
          else item.collapse();
        }
      }
    }
    // resetPaths keeps the query but not its matches (still the old paths'); searching again finds the new ones.
    if (query) {
      model.setSearch('');
      model.setSearch(query);
    }
  }, [model, paths, relations, settings.flattenEmptyDirectories]);

  // The shadow root exists once the tree has rendered; a frame later covers the first mount.
  useEffect(() => {
    const css = relatedTreeCss(relations);
    setRelatedCss(model, css);
    const frame = requestAnimationFrame(() => setRelatedCss(model, css));
    return () => cancelAnimationFrame(frame);
  }, [model, relations]);

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
    session.keepTreeSearch = () => {
      const query = modelRef.current?.isSearchOpen() ? modelRef.current.getSearchValue() : null;
      return () => {
        const m = modelRef.current;
        if (query !== null && m && !m.isSearchOpen()) m.setSearch(query);
      };
    };
    return () => {
      session.revealInTree = undefined;
      session.keepTreeSearch = undefined;
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
  const { relations } = useRelated();
  const fileGroupsLoaded = useFileGroups((s) => s.loaded);
  const rulesLoaded = useRelatedRules((s) => s.loaded);
  const groupsLoaded = fileGroupsLoaded && rulesLoaded;
  const settingsLoaded = useSettings((s) => s.loaded);
  const pr = usePr((s) => s.pr);
  const settings = useSettings((s) => s.settings.tree);
  const themeType = useSettings((s) => effectiveThemeType(s.settings.diff.themeType, s.colorMode));
  const gitStatus = useMemo(() => gitStatusEntries(pr?.files ?? [], settings), [pr, settings]);
  const key = useMemo(() => JSON.stringify(settings), [settings]);
  const colorScheme = themeType === 'system' ? 'light dark' : themeType;

  // Like the diff list, the tree waits for the file groups so it never shows another group's files first.
  if (!pr || !groupsLoaded || !settingsLoaded) return <TreePaneFrame />;
  return (
    <TreePaneFrame testId="tree">
      <Tree key={`${pr.headOid}:${key}`} paths={shown} relations={relations} gitStatus={gitStatus} settings={settings} colorScheme={colorScheme} />
    </TreePaneFrame>
  );
});
