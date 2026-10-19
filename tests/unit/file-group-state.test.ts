// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ALL_GROUP, type FileGroup } from '../../src/shared/file-groups';
import { FILE_GROUPS_KEY, type GroupsStorage } from '../../src/shared/file-groups-storage';
import type { FileGroupSettings } from '../../src/shared/settings';
import type { FileSummary, PrData } from '../../src/viewer/github/private';
import {
  activeGroup,
  currentGroup,
  groupMemoryKey,
  groupTabs,
  groupView,
  initFileGroups,
  renamedGroups,
  shownPaths,
  useFileGroups,
} from '../../src/viewer/state/fileGroups';
import { useSettings } from '../../src/viewer/state/settings';
import { createPrStore, usePr } from '../../src/viewer/state/store';

const groups: FileGroup[] = [
  { label: 'Source', patterns: ['!Tests', '!Docs'] },
  { label: 'Tests', patterns: ['*.test.ts'] },
  { label: 'Docs', patterns: ['*.md'] },
  { label: 'Infra', patterns: ['Dockerfile'] },
];
const order = ['src/a.ts', 'src/a.test.ts', 'README.md', 'src/b.ts', 'src/b.test.ts'];
const on: FileGroupSettings = { enabled: true, defaultGroup: ALL_GROUP, hideEmpty: true };

describe('classification', () => {
  it('is computed once per (groups, files) pair', () => {
    const view = groupView(groups, order);
    expect(groupView(groups, order)).toBe(view);
    expect(view.paths).toEqual([['src/a.ts', 'src/b.ts'], ['src/a.test.ts', 'src/b.test.ts'], ['README.md'], []]);
    expect(groupView([...groups], order)).not.toBe(view);
  });

  it('groups that exclude each other count every file once, so the counts add up to All', () => {
    const view = groupView(groups, order);
    expect(view.paths.reduce((n, p) => n + p.length, 0)).toBe(order.length);
  });
});

describe('the open group', () => {
  const view = groupView(groups, order);

  it('All by default; the default group when it has files; a choice wins', () => {
    expect(activeGroup(null, on, view)).toBe(ALL_GROUP);
    expect(activeGroup(null, { ...on, defaultGroup: 'tests' }, view)).toBe('Tests');
    expect(activeGroup(null, { ...on, defaultGroup: 'Infra' }, view)).toBe(ALL_GROUP);
    expect(activeGroup('Docs', { ...on, defaultGroup: 'Tests' }, view)).toBe('Docs');
    expect(activeGroup(ALL_GROUP, { ...on, defaultGroup: 'Tests' }, view)).toBe(ALL_GROUP);
  });

  it('a choice whose group is gone falls back to the default; off, it is always All', () => {
    expect(activeGroup('Gone', { ...on, defaultGroup: 'Tests' }, view)).toBe('Tests');
    expect(activeGroup('Tests', { ...on, enabled: false }, view)).toBe(ALL_GROUP);
  });

  it('shows the group\'s files, and All shows the very same list as the store', () => {
    expect(shownPaths(order, view, 'Tests')).toEqual(['src/a.test.ts', 'src/b.test.ts']);
    expect(shownPaths(order, view, 'Tests')).toBe(view.paths[1]);
    expect(shownPaths(order, view, ALL_GROUP)).toBe(order);
  });

  it('tabs: All first, counts per group, empty groups hidden unless open or kept', () => {
    expect(groupTabs(order, view, ALL_GROUP, true)).toEqual([
      { label: ALL_GROUP, count: 5 },
      { label: 'Source', count: 2 },
      { label: 'Tests', count: 2 },
      { label: 'Docs', count: 1 },
    ]);
    expect(groupTabs(order, view, 'Infra', true).map((t) => t.label)).toContain('Infra');
    expect(groupTabs(order, view, ALL_GROUP, false).map((t) => [t.label, t.count])).toContainEqual(['Infra', 0]);
  });
});

const file = (path: string): FileSummary => ({ path, digest: `d-${path}`, status: 'modified', additions: 1, deletions: 0, viewed: false, tooLarge: false, binary: false });
const pr = (number: number): PrData => ({
  ref: { owner: 'o', repo: 'r', number, page: 'changes' },
  author: 'me',
  baseOid: 'base',
  headOid: `head-${number}`,
  commits: [],
  files: order.map(file),
  viewer: { login: 'me', canApplySuggestion: false, canReview: true },
  threadMarkers: { threads: [], byPath: {} },
});

function memoryStorage(items: Record<string, unknown> = {}): GroupsStorage & { replace(next: Record<string, unknown>): void } {
  const listeners = new Set<(keys: string[]) => void>();
  return {
    get: async () => items,
    set: async () => undefined,
    remove: async () => undefined,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    replace(next) {
      items = next;
      for (const l of listeners) l(Object.keys(next));
    },
  };
}

const stored = (list: FileGroup[]) =>
  Object.fromEntries([[FILE_GROUPS_KEY, list.length], ...list.map((g, i) => [`${FILE_GROUPS_KEY}.${i}`, { label: g.label, patterns: g.patterns.join('\n') }])]);

describe('renamed groups', () => {
  it('a label gone, and one new label with the same patterns: a rename', () => {
    const next = groups.map((g) => (g.label === 'Docs' ? { ...g, label: 'Documentation' } : g));
    expect(renamedGroups(groups, next)).toEqual(new Map([['Docs', 'Documentation']]));
  });

  it('renamed and edited at once: the label in the same place, when the list kept its length', () => {
    const next = groups.map((g) => (g.label === 'Docs' ? { label: 'Documentation', patterns: ['*.md', '*.rst'] } : g));
    expect(renamedGroups(groups, next)).toEqual(new Map([['Docs', 'Documentation']]));
  });

  it('a group deleted, or deleted and another added elsewhere, is no rename', () => {
    expect(renamedGroups(groups, groups.filter((g) => g.label !== 'Docs'))).toEqual(new Map());
    const swapped = [...groups.filter((g) => g.label !== 'Docs'), { label: 'Adr', patterns: ['adr/'] }];
    expect(renamedGroups(groups, swapped)).toEqual(new Map());
  });
});

describe('per pull request memory', () => {
  let off: () => void = () => undefined;
  beforeEach(() => {
    sessionStorage.clear();
    useFileGroups.setState({ choice: null, loaded: false });
  });
  afterEach(() => off());

  it('restores the group picked on a PR after a reload, and a fresh PR starts on the default', async () => {
    const store = createPrStore();
    off = initFileGroups(store, memoryStorage());
    store.getState().setPr(pr(1));
    expect(useFileGroups.getState().choice).toBeNull();
    useFileGroups.getState().choose('Tests');
    expect(sessionStorage.getItem(groupMemoryKey(pr(1).ref))).toBe('Tests');
    useFileGroups.getState().choose(ALL_GROUP);
    expect(sessionStorage.getItem(groupMemoryKey(pr(1).ref))).toBe(ALL_GROUP);
    useFileGroups.getState().choose('Docs');
    off();

    // A reload: a new viewer, the same PR.
    useFileGroups.setState({ choice: null });
    const reloaded = createPrStore();
    off = initFileGroups(reloaded, memoryStorage());
    reloaded.getState().setPr(pr(1));
    expect(useFileGroups.getState().choice).toBe('Docs');

    // Another PR in the same viewer does not inherit it.
    reloaded.getState().setPr(pr(2));
    expect(useFileGroups.getState().choice).toBeNull();
  });

  it('a soft reload of the same PR keeps the current choice', () => {
    const store = createPrStore();
    off = initFileGroups(store, memoryStorage());
    store.getState().setPr(pr(1));
    useFileGroups.getState().choose('Tests');
    store.getState().setPr(pr(1));
    expect(useFileGroups.getState().choice).toBe('Tests');
  });

  it('a renamed group stays picked, on this PR and in the memory of other PRs', async () => {
    const storage = memoryStorage(stored(groups));
    const store = createPrStore();
    off = initFileGroups(store, storage);
    await new Promise((r) => setTimeout(r, 0));
    sessionStorage.setItem(groupMemoryKey(pr(2).ref), 'Docs');
    sessionStorage.setItem(groupMemoryKey(pr(3).ref), 'Tests');
    store.getState().setPr(pr(1));
    useFileGroups.getState().choose('Docs');

    storage.replace(stored(groups.map((g) => (g.label === 'Docs' ? { ...g, label: 'Documentation' } : g))));
    await new Promise((r) => setTimeout(r, 0));
    expect(useFileGroups.getState().choice).toBe('Documentation');
    expect(sessionStorage.getItem(groupMemoryKey(pr(1).ref))).toBe('Documentation');
    expect(sessionStorage.getItem(groupMemoryKey(pr(2).ref))).toBe('Documentation');
    expect(sessionStorage.getItem(groupMemoryKey(pr(3).ref))).toBe('Tests');
  });

  it('a late initial read cannot replace a newer storage change', async () => {
    const storage = memoryStorage(stored(groups));
    let finishInitial!: (items: Record<string, unknown>) => void;
    const get = storage.get;
    let initial = true;
    storage.get = () => {
      if (!initial) return get(null);
      initial = false;
      return new Promise((resolve) => { finishInitial = resolve; });
    };
    off = initFileGroups(createPrStore(), storage);
    const newer = [{ label: 'New', patterns: ['*.ts'] }];
    storage.replace(stored(newer));
    await new Promise((r) => setTimeout(r, 0));
    expect(useFileGroups.getState().groups).toEqual(newer);
    expect(useFileGroups.getState().loaded).toBe(true);
    finishInitial(stored(groups));
    await new Promise((r) => setTimeout(r, 0));
    expect(useFileGroups.getState().groups).toEqual(newer);
  });

  it('loads the stored groups, then follows the viewer stores', async () => {
    off = initFileGroups(createPrStore(), memoryStorage({ [FILE_GROUPS_KEY]: 1, [`${FILE_GROUPS_KEY}.0`]: { label: 'Md', patterns: '*.md' } }));
    await new Promise((r) => setTimeout(r, 0));
    expect(useFileGroups.getState()).toMatchObject({ loaded: true, groups: [{ label: 'Md', patterns: ['*.md'] }] });
    usePr.getState().setPr(pr(3));
    useSettings.setState((s) => ({ settings: { ...s.settings, fileGroups: { ...s.settings.fileGroups, defaultGroup: 'Md' } } }));
    expect(currentGroup().active).toBe('Md');
    expect(currentGroup().shown).toEqual(['README.md']);
  });
});
