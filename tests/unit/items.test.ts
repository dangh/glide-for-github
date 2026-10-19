// @vitest-environment jsdom
// (@pierre/diffs reads `navigator` at import time.)
import { describe, expect, it } from 'vitest';
import type { FileSummary, PrData } from '../../src/viewer/github/private';
import { ItemSync, placeholderDiff, type AnnotationSource, type FileAnnotation, type PierreItem } from '../../src/viewer/state/items';
import { createPrStore } from '../../src/viewer/state/store';

const file = (path: string, extra: Partial<FileSummary> = {}): FileSummary => ({
  path,
  digest: `d-${path}`,
  status: 'modified',
  additions: 1,
  deletions: 0,
  viewed: false,
  tooLarge: false,
  binary: false,
  ...extra,
});

const pr = (files: FileSummary[]): PrData => ({
  ref: { owner: 'o', repo: 'r', number: 1, page: 'changes' },
  author: 'me',
  baseOid: 'base',
  headOid: 'head',
  commits: [],
  files,
  viewer: { login: 'me', canApplySuggestion: false, canReview: true },
  threadMarkers: { threads: [], byPath: {} },
});

function setup(files = [file('a.ts'), file('b.ts', { viewed: true }), file('c.ts', { status: 'added' })], annotations?: AnnotationSource) {
  const store = createPrStore();
  store.getState().setPr(pr(files));
  const sync = new ItemSync(annotations);
  const items = sync.seed(store.getState());
  const updates: PierreItem[] = [];
  const sink = { updateItem: (item: PierreItem) => (updates.push(item), true) };
  return { store, sync, items, updates, sink };
}

describe('CodeView items', () => {
  it('seeds one header-only placeholder item per file, viewed files collapsed', () => {
    const { items } = setup();
    expect(items.map((i) => [i.id, i.type, i.collapsed, i.version])).toEqual([
      ['a.ts', 'diff', false, 1],
      ['b.ts', 'diff', true, 1],
      ['c.ts', 'diff', false, 1],
    ]);
    expect(items[0]!.fileDiff.hunks).toEqual([]);
    expect(items[2]!.fileDiff.type).toBe('new');
  });

  it('placeholders are cached per summary and show renames', () => {
    const s = file('new.ts', { status: 'renamed', prevPath: 'old.ts' });
    expect(placeholderDiff(s)).toBe(placeholderDiff(s));
    expect(placeholderDiff(s).prevName).toBe('old.ts');
    expect(placeholderDiff(s).name).toBe('new.ts');
  });

  it('a loaded diff updates only that item, with a bumped version', () => {
    const { store, sync, updates, sink } = setup();
    const diff = placeholderDiff(file('a.ts', { digest: 'x' }));
    store.getState().applyLoads([{ path: 'a.ts', summary: store.getState().files.get('a.ts')!, load: { status: 'loaded' }, diff }]);
    expect(sync.sync(store.getState(), sink)).toEqual(['a.ts']);
    expect(updates).toHaveLength(1);
    expect(updates[0]!.fileDiff).toBe(diff);
    expect(updates[0]!.version).toBe(2);

    // Nothing item-relevant changed: no updates, and no per-file pass at all.
    store.getState().setNotice({ kind: 'info', message: 'x' });
    store.getState().setLoad(['b.ts'], { status: 'loading' });
    expect(sync.sync(store.getState(), sink)).toEqual([]);
    expect(updates).toHaveLength(1);
  });

  it('viewed and manual collapse change the collapsed flag of one item', () => {
    const { store, sync, updates, sink } = setup();
    store.getState().setViewedLocal('a.ts', true);
    expect(sync.sync(store.getState(), sink)).toEqual(['a.ts']);
    expect(updates.at(-1)).toMatchObject({ id: 'a.ts', collapsed: true, version: 2 });
    store.getState().setCollapsed('b.ts', false);
    expect(sync.sync(store.getState(), sink)).toEqual(['b.ts']);
    expect(updates.at(-1)).toMatchObject({ id: 'b.ts', collapsed: false, version: 2 });
  });

  it('annotation sources re-render only files whose annotation array changed (Task 9 seam)', () => {
    const forA: FileAnnotation[] = [{ side: 'additions', lineNumber: 3, metadata: { kind: 'thread', threadKey: '1' } }];
    let current = forA;
    const annotations: AnnotationSource = (path) => (path === 'a.ts' ? current : []);
    const empty: FileAnnotation[] = [];
    const stable: AnnotationSource = (path, state) => (path === 'a.ts' ? annotations(path, state) : empty);
    const { store, sync, items, updates, sink } = setup(undefined, stable);
    expect(items[0]!.annotations).toBe(forA);

    current = [...forA, { side: 'deletions', lineNumber: 1, metadata: { kind: 'composer', key: 'a.ts:deletions:-1' } }];
    store.getState().setDraft('a.ts:deletions:-1', { body: '', updatedAt: 1 });
    expect(sync.sync(store.getState(), sink)).toEqual(['a.ts']);
    expect(updates[0]!.annotations).toBe(current);
  });

  it('a file group mounts a subset: hidden files stay current without reaching the CodeView, and come back current', () => {
    const store = createPrStore();
    store.getState().setPr(pr([file('a.ts'), file('b.ts'), file('c.ts')]));
    const sync = new ItemSync();
    expect(sync.seed(store.getState(), ['b.ts']).map((i) => i.id)).toEqual(['b.ts']);
    const updates: PierreItem[] = [];
    const sink = { updateItem: (item: PierreItem) => (updates.push(item), true) };

    store.getState().setViewedLocal('a.ts', true);
    store.getState().setViewedLocal('b.ts', true);
    expect(sync.sync(store.getState(), sink)).toEqual(['b.ts']);
    expect(updates.map((i) => i.id)).toEqual(['b.ts']);

    const all = sync.mount(store.getState().order);
    expect(all.map((i) => [i.id, i.collapsed, i.version])).toEqual([
      ['a.ts', true, 2],
      ['b.ts', true, 2],
      ['c.ts', false, 1],
    ]);
    // Unchanged items are the same objects, so the CodeView keeps their layout.
    expect(all[1]).toBe(updates[0]);
    expect(sync.mount(['b.ts'])[0]).toBe(all[1]);
  });

  it('skips files outside the PR when mounting a list', () => {
    const { sync } = setup();
    expect(sync.mount(['a.ts', 'gone.ts', 'c.ts']).map((item) => item.id)).toEqual(['a.ts', 'c.ts']);
  });

  it('a folded companion is collapsed until opened, and follows its folded state', () => {
    const { store, sync, sink, updates } = setup();
    store.getState().setFolded(new Set(['c.ts']));
    sync.sync(store.getState(), sink);
    expect(updates.map((u) => [u.id, u.collapsed])).toEqual([['c.ts', true]]);
    store.getState().setCollapsed('c.ts', false);
    sync.sync(store.getState(), sink);
    expect(updates.at(-1)).toMatchObject({ id: 'c.ts', collapsed: false });
  });
});
