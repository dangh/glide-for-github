/**
 * Related files in the viewer: which files of the open group are companions of which (src/shared/related-files.ts),
 * and how the diff list shows them (`DisplaySettings.relatedFiles.style`).
 *
 * Relations are computed once per (rules, open group's files) pair, over the open group's files only, so a companion
 * nests only when its main file is in the same group. The layout (list order, roles, folded files) is computed once
 * per (relations, style) pair. Every file stays its own CodeView item.
 */
import { create } from 'zustand';
import { defaultRules, loadRelatedRules, onRelatedRulesChange } from '../../shared/related-files-storage';
import type { GroupsStorage } from '../../shared/file-groups-storage';
import { arrange, NO_RELATIONS, relateFiles, type RelatedRule, type Relations } from '../../shared/related-files';
import type { RelatedStyle } from '../../shared/settings';
import { currentGroup, useActiveGroup, useFileGroups } from './fileGroups';
import { useSettings } from './settings';
import { usePr } from './store';

export const useRelatedRules = create<{ rules: RelatedRule[]; loaded: boolean }>()(() => ({ rules: defaultRules(), loaded: false }));

/** A main file or a companion; `above` and `last` locate the companion within their shared box. */
export type Role =
  | { kind: 'main'; files: readonly string[] }
  | { kind: 'companion'; main: string; above: string; last: boolean };

export interface RelatedLayout {
  style: RelatedStyle;
  relations: Relations;
  /** The diff list's file paths, in order. */
  items: readonly string[];
  roles: ReadonlyMap<string, Role>;
  /** Companions that start collapsed ('nested'). */
  folded: ReadonlySet<string>;
  /** CodeView's `layout.gapBefore`: none inside a nested group's box; unset when no box has parts. */
  gapBefore?: GapBefore;
}

/** The gap above item `id` when `previousId` is the item above it; `undefined` keeps the list's gap. */
export type GapBefore = (id: string, previousId: string) => number | undefined;

/**
 * Nested files share one box: a part right below the box's previous part touches it. Asked about any
 * other neighbor (CodeView can lay out the old list with the new layout for a frame), it keeps the list's gap.
 */
function touching(roles: ReadonlyMap<string, Role>): GapBefore {
  return (id, previousId) => {
    const role = roles.get(id);
    return role?.kind === 'companion' && role.above === previousId ? 0 : undefined;
  };
}

const relationsMemo = new WeakMap<readonly string[], { rules: readonly RelatedRule[]; relations: Relations }>();

/** The relations among `shown`, computed once per (rules, shown) pair (both are replaced, never mutated). */
export function relationsOf(rules: readonly RelatedRule[], shown: readonly string[]): Relations {
  const known = relationsMemo.get(shown);
  if (known?.rules === rules) return known.relations;
  const relations = relateFiles(rules, shown);
  relationsMemo.set(shown, { rules, relations });
  return relations;
}

const EMPTY_SET: ReadonlySet<string> = new Set();
const EMPTY_ROLES: ReadonlyMap<string, Role> = new Map();

function buildLayout(relations: Relations, style: RelatedStyle, shown: readonly string[]): RelatedLayout {
  if (style === 'off' || relations.companions.size === 0) {
    return { style, relations: style === 'off' ? NO_RELATIONS : relations, items: shown, roles: EMPTY_ROLES, folded: EMPTY_SET };
  }
  const roles = new Map<string, Role>();
  const folded = new Set<string>();
  const items: string[] = [];
  for (const path of arrange(shown, relations)) {
    const main = relations.mainOf.get(path);
    const companions = relations.companions.get(path);
    const group = main ?? (companions ? path : undefined);
    if (group === undefined) {
      items.push(path);
      continue;
    }
    const list = relations.companions.get(group)!;
    const last = path === list.at(-1);
    if (main === undefined) roles.set(path, { kind: 'main', files: [path, ...list] });
    else {
      roles.set(path, { kind: 'companion', main, above: items.at(-1)!, last });
      folded.add(path);
    }
    items.push(path);
  }
  return { style, relations, items, roles, folded, gapBefore: touching(roles) };
}

let layoutMemo: { relations: Relations; style: RelatedStyle; shown: readonly string[]; layout: RelatedLayout } | undefined;

/** The layout of `shown`, computed once per (rules, shown, style). */
export function relatedLayout(rules: readonly RelatedRule[], shown: readonly string[], style: RelatedStyle): RelatedLayout {
  const relations = style === 'off' ? NO_RELATIONS : relationsOf(rules, shown);
  if (layoutMemo && layoutMemo.relations === relations && layoutMemo.style === style && layoutMemo.shown === shown) return layoutMemo.layout;
  const layout = buildLayout(relations, style, shown);
  layoutMemo = { relations, style, shown, layout };
  return layout;
}

/** The open group's layout, now (for imperative code). */
export const currentRelated = (): RelatedLayout =>
  relatedLayout(useRelatedRules.getState().rules, currentGroup().shown, useSettings.getState().settings.relatedFiles.style);

/** The open group's layout; re-renders only when it changes. */
export function useRelated(): RelatedLayout {
  const { shown } = useActiveGroup();
  const rules = useRelatedRules((s) => s.rules);
  const style = useSettings((s) => s.settings.relatedFiles.style);
  return relatedLayout(rules, shown, style);
}

/** A file's role, re-rendering only when it changes. */
export function useRole(id: string): Role | undefined {
  return useRelated().roles.get(id);
}

/**
 * Loads the rules and follows their changes, and keeps `PrState.folded` on the open group's folded companions.
 * Returns the unsubscribe function.
 */
export function initRelatedFiles(storage?: GroupsStorage): () => void {
  let active = true;
  let changed = false;
  void loadRelatedRules(storage).then(
    (rules) => active && !changed && useRelatedRules.setState({ rules, loaded: true }),
    () => active && !changed && useRelatedRules.setState({ loaded: true }),
  );
  const offStorage = onRelatedRulesChange((rules) => {
    changed = true;
    useRelatedRules.setState({ rules, loaded: true });
  }, storage);
  const syncFolded = () => {
    const { folded } = currentRelated();
    if (usePr.getState().folded !== folded) usePr.getState().setFolded(folded);
  };
  syncFolded();
  const offs = [usePr.subscribe(syncFolded), useFileGroups.subscribe(syncFolded), useSettings.subscribe(syncFolded), useRelatedRules.subscribe(syncFolded)];
  return () => {
    active = false;
    offStorage();
    for (const off of offs) off();
  };
}
