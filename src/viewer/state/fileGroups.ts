/**
 * The open file group (Source, Tests, …; src/shared/file-groups.ts) and which files it shows.
 *
 * Files are classified once per (groups, files) pair; switching groups only picks another precomputed list, so the
 * tree and the diff list swap their paths without a request. The choice made on a PR is kept per PR in
 * `sessionStorage`, so a reload reopens it; a PR opened fresh starts on the default group. A group renamed on the
 * options page stays picked (`renamedGroups`).
 */
import { create } from 'zustand';
import { ALL_GROUP, groupPaths, type FileGroup } from '../../shared/file-groups';
import { defaultGroups, loadFileGroups, onFileGroupsChange, type GroupsStorage } from '../../shared/file-groups-storage';
import { prKey, type PrRef } from '../../shared/pr-url';
import type { FileGroupSettings } from '../../shared/settings';
import { sessionStore } from './batch';
import { useSettings } from './settings';
import { usePr, type PrState } from './store';

export interface FileGroupsState {
  groups: FileGroup[];
  loaded: boolean;
  /** The group picked on this PR (or restored from its memory), ALL_GROUP for All; null: the default applies. */
  choice: string | null;
  choose(label: string): void;
}

export const useFileGroups = create<FileGroupsState>()((set) => ({
  groups: defaultGroups(),
  loaded: false,
  choice: null,
  choose: (choice) => set({ choice }),
}));

export interface GroupView {
  labels: readonly string[];
  /** Each group's files, in PR order. */
  paths: readonly (readonly string[])[];
}

let memo: { groups: readonly FileGroup[]; order: readonly string[]; view: GroupView } | undefined;

/** The classification of `order`, computed once per (groups, order) pair (both are replaced, never mutated). */
export function groupView(groups: readonly FileGroup[], order: readonly string[]): GroupView {
  if (memo?.groups === groups && memo.order === order) return memo.view;
  const view = { labels: groups.map((g) => g.label), paths: groupPaths(groups, order) };
  memo = { groups, order, view };
  return view;
}

const indexOf = (view: GroupView, label: string) => {
  const key = label.toLowerCase();
  return view.labels.findIndex((l) => l.toLowerCase() === key);
};

/**
 * The open group's label, or ALL_GROUP. A choice whose group is gone falls back to the default; the default group
 * opens only when it has files (a PR with no tests does not open on an empty Tests).
 */
export function activeGroup(choice: string | null, settings: FileGroupSettings, view: GroupView): string {
  if (!settings.enabled) return ALL_GROUP;
  if (choice === ALL_GROUP) return ALL_GROUP;
  if (choice !== null) {
    const i = indexOf(view, choice);
    if (i >= 0) return view.labels[i]!;
  }
  const i = indexOf(view, settings.defaultGroup);
  return i >= 0 && view.paths[i]!.length > 0 ? view.labels[i]! : ALL_GROUP;
}

/** The files the open group shows: `order` itself for All, so the list's identity only changes with the group. */
export function shownPaths(order: readonly string[], view: GroupView, active: string): readonly string[] {
  if (active === ALL_GROUP) return order;
  return view.paths[indexOf(view, active)] ?? order;
}

export interface GroupTab {
  label: string;
  count: number;
}

/** All, then each group with its file count; with `hideEmpty`, groups with no files are left out unless open. */
export function groupTabs(order: readonly string[], view: GroupView, active: string, hideEmpty: boolean): GroupTab[] {
  const tabs: GroupTab[] = [{ label: ALL_GROUP, count: order.length }];
  view.labels.forEach((label, i) => {
    const count = view.paths[i]!.length;
    if (!hideEmpty || count > 0 || label === active) tabs.push({ label, count });
  });
  return tabs;
}

type Snapshot = { order: readonly string[]; groups: readonly FileGroup[]; choice: string | null; settings: FileGroupSettings };

function resolve({ order, groups, choice, settings }: Snapshot) {
  const view = groupView(groups, order);
  const active = activeGroup(choice, settings, view);
  return { view, active, shown: shownPaths(order, view, active) };
}

const snapshot = (): Snapshot => ({
  order: usePr.getState().order,
  groups: useFileGroups.getState().groups,
  choice: useFileGroups.getState().choice,
  settings: useSettings.getState().settings.fileGroups,
});

/** The open group and its files, now (for imperative code: viewport tracking, scroll handlers). */
export const currentGroup = () => resolve(snapshot());

/** The open group and its files; re-renders only when one of them changes. */
export function useActiveGroup() {
  const order = usePr((s) => s.order);
  const groups = useFileGroups((s) => s.groups);
  const choice = useFileGroups((s) => s.choice);
  const settings = useSettings((s) => s.settings.fileGroups);
  return resolve({ order, groups, choice, settings });
}

/** `sessionStorage` key holding the group picked on a PR. */
export const groupMemoryKey = (ref: PrRef): string => `pierre.fileGroup:${prKey(ref)}`;
const MEMORY_PREFIX = 'pierre.fileGroup:';

/**
 * Old label → new label for the groups `next` renamed from `prev`: a label gone whose patterns one new label has (the
 * options page saves a rename on its own as you type), else, with as many groups as before, the new label in its place.
 */
export function renamedGroups(prev: readonly FileGroup[], next: readonly FileGroup[]): Map<string, string> {
  const has = (list: readonly FileGroup[], label: string) => list.some((g) => g.label.toLowerCase() === label.toLowerCase());
  const added = new Set(next.filter((g) => !has(prev, g.label)).map((g) => g.label));
  const renames = new Map<string, string>();
  prev.forEach((old, i) => {
    if (has(next, old.label)) return;
    const patterns = old.patterns.join('\n');
    const same = next.filter((g) => added.has(g.label) && g.patterns.join('\n') === patterns);
    const label = same.length === 1 ? same[0]!.label : prev.length === next.length && added.has(next[i]!.label) ? next[i]!.label : undefined;
    if (label === undefined) return;
    renames.set(old.label, label);
    added.delete(label);
  });
  return renames;
}

/** Follows renames in the open choice and in every PR's remembered group. */
function followRenames(renames: ReadonlyMap<string, string>) {
  if (renames.size === 0) return;
  const renamed = (label: string | null) => (label === null ? undefined : [...renames].find(([old]) => old.toLowerCase() === label.toLowerCase())?.[1]);
  try {
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      const now = key?.startsWith(MEMORY_PREFIX) ? renamed(sessionStorage.getItem(key)) : undefined;
      if (key && now !== undefined) sessionStorage.setItem(key, now);
    }
  } catch {
    // blocked storage (the in-memory stand-in only holds this PR's): only the open choice follows
  }
  const choice = renamed(useFileGroups.getState().choice);
  if (choice !== undefined) useFileGroups.getState().choose(choice);
}

/**
 * Loads the groups and follows their changes, and keeps each PR's choice: restored when the PR is set, written
 * when the user picks a group. Returns the unsubscribe function.
 */
export function initFileGroups(store = usePr, storage?: GroupsStorage): () => void {
  let active = true;
  void loadFileGroups(storage).then(
    (groups) => active && useFileGroups.setState({ groups, loaded: true }),
    () => active && useFileGroups.setState({ loaded: true }),
  );
  const offStorage = onFileGroupsChange((groups) => {
    const renames = renamedGroups(useFileGroups.getState().groups, groups);
    useFileGroups.setState({ groups });
    followRenames(renames);
  }, storage);

  let name: string | null = null;
  const onPr = (s: PrState) => {
    const next = s.pr ? groupMemoryKey(s.pr.ref) : null;
    if (next === name) return;
    name = next;
    let saved: string | null = null;
    try {
      saved = name ? sessionStore().getItem(name) : null;
    } catch {
      // blocked storage: the default group
    }
    useFileGroups.setState({ choice: saved });
  };
  onPr(store.getState());
  const offPr = store.subscribe(onPr);
  const offChoice = useFileGroups.subscribe((s, prev) => {
    if (!name || s.choice === prev.choice || s.choice === null) return;
    try {
      sessionStore().setItem(name, s.choice);
    } catch {
      // quota / blocked storage: the choice still holds for this page
    }
  });
  return () => {
    active = false;
    offStorage();
    offPr();
    offChoice();
  };
}
