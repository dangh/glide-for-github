import { describe, expect, it } from 'vitest';
import type { FileSummary, PrData } from '../../src/viewer/github/private';
import type { ThreadModel } from '../../src/viewer/github/threads';
import { commentCount, createPrStore, draftKey, isCollapsed, threadsByPath } from '../../src/viewer/state/store';
import { decorationFor, gitStatusEntries, visibleFiles } from '../../src/viewer/state/view';

const file = (path: string, extra: Partial<FileSummary> = {}): FileSummary => ({
  path,
  digest: `d-${path}`,
  status: 'modified',
  additions: 1,
  deletions: 1,
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

const thread = (id: string, path: string, dbIds: number[]): ThreadModel => ({
  id,
  path,
  side: 'additions',
  line: 1,
  subject: 'line',
  isOutdated: false,
  isResolved: false,
  viewerCanReply: true,
  comments: dbIds.map((databaseId) => ({
    databaseId,
    nodeId: `n${databaseId}`,
    author: { login: 'me', avatarUrl: '' },
    body: 'b',
    bodyHTML: 'b',
    bodyVersion: 'v',
    createdAt: '2026-10-17T00:00:00Z',
    state: 'submitted',
    reactions: [],
    viewerCanUpdate: true,
    viewerCanDelete: true,
  })),
});

describe('store', () => {
  it('setPr seeds order, summaries, viewed and pending loads', () => {
    const store = createPrStore();
    store.getState().setPr(pr([file('a.ts', { viewed: true }), file('b.ts')]));
    const s = store.getState();
    expect(s.order).toEqual(['a.ts', 'b.ts']);
    expect([...s.viewed]).toEqual(['a.ts']);
    expect(s.load.get('b.ts')).toEqual({ status: 'pending' });
    expect(isCollapsed(s, 'a.ts')).toBe(true);
    expect(isCollapsed(s, 'b.ts')).toBe(false);
  });

  it('applyLoads replaces only the given files and keeps other references', () => {
    const store = createPrStore();
    store.getState().setPr(pr([file('a.ts'), file('b.ts')]));
    const before = store.getState();
    const renamed = file('a.ts', { prevPath: 'old.ts' });
    const diff = { name: 'a.ts' } as never;
    store.getState().applyLoads([{ path: 'a.ts', summary: renamed, load: { status: 'loaded', additions: 2, deletions: 0 }, diff }]);
    const after = store.getState();
    expect(after.files.get('a.ts')).toBe(renamed);
    expect(after.files.get('b.ts')).toBe(before.files.get('b.ts'));
    expect(after.diffs.get('a.ts')).toBe(diff);
    expect(after.viewed).toBe(before.viewed); // untouched slices keep their identity
    store.getState().applyLoads([{ path: 'a.ts', summary: renamed, load: { status: 'binary' } }]);
    expect(store.getState().diffs.has('a.ts')).toBe(false);
  });

  it('setViewedLocal toggles viewed and drops the manual collapse override', () => {
    const store = createPrStore();
    store.getState().setPr(pr([file('a.ts')]));
    store.getState().setCollapsed('a.ts', true);
    expect(isCollapsed(store.getState(), 'a.ts')).toBe(true);
    store.getState().setViewedLocal('a.ts', true);
    expect(store.getState().viewed.has('a.ts')).toBe(true);
    expect(store.getState().collapsed.has('a.ts')).toBe(false);
    const same = store.getState();
    store.getState().setViewedLocal('a.ts', true); // no-op keeps state
    expect(store.getState()).toBe(same);
    store.getState().setViewedLocal('a.ts', false);
    expect(isCollapsed(store.getState(), 'a.ts')).toBe(false);
  });

  it('setRange ignores an identical range', () => {
    const store = createPrStore();
    store.getState().setRange({ head: 'x' });
    const r = store.getState().range;
    store.getState().setRange({ head: 'x' });
    expect(store.getState().range).toBe(r);
  });

  it('upsertThread / removeComment keep threads by id and drop empty threads', () => {
    const store = createPrStore();
    store.getState().setThreads([thread('1', 'a.ts', [10, 11]), thread('2', 'b.ts', [20])]);
    store.getState().upsertThread(thread('3', 'a.ts', [30]));
    store.getState().upsertThread({ ...thread('1', 'a.ts', [10, 11]), isResolved: true });
    expect(store.getState().threads.map((t) => t.id)).toEqual(['1', '2', '3']);
    expect(store.getState().threads[0]!.isResolved).toBe(true);

    store.getState().removeComment(11);
    expect(store.getState().threads[0]!.comments.map((c) => c.databaseId)).toEqual([10]);
    store.getState().removeComment(20);
    expect(store.getState().threads.map((t) => t.id)).toEqual(['1', '3']);
    const same = store.getState().threads;
    store.getState().removeComment(999);
    expect(store.getState().threads).toBe(same);

    const byPath = threadsByPath(store.getState().threads);
    expect(byPath).toBe(threadsByPath(store.getState().threads)); // cached per array
    expect(commentCount(byPath.get('a.ts'))).toBe(2);
  });

  it('drafts by key', () => {
    const store = createPrStore();
    const key = draftKey.line('a.ts', 'additions', 12, 10);
    expect(key).toBe('a.ts:additions:10-12');
    expect(draftKey.line('a.ts', 'deletions', 3)).toBe('a.ts:deletions:-3');
    expect(draftKey.reply('99')).toBe('reply:99');
    expect(draftKey.edit(5)).toBe('edit:5');
    store.getState().setDraft(key, { body: 'hi', path: 'a.ts', side: 'additions', line: 12, startLine: 10, updatedAt: 1 });
    expect(store.getState().drafts.get(key)?.body).toBe('hi');
    store.getState().clearDraft(key);
    expect(store.getState().drafts.size).toBe(0);
  });
});

describe('view helpers', () => {
  it("gitStatusEntries: none when neither the status letters nor GitHub's status icons need it", () => {
    const files = [file('a.ts', { status: 'added' }), file('b.ts'), file('c.ts', { status: 'deleted' })];
    expect(gitStatusEntries(files, { icons: 'complete', showGitStatus: false })).toBeUndefined();
    expect(gitStatusEntries(files, { icons: 'default', showGitStatus: false })).toHaveLength(3);
    expect(gitStatusEntries(files, { icons: 'complete', showGitStatus: true })).toEqual([
      { path: 'a.ts', status: 'added' },
      { path: 'b.ts', status: 'modified' },
      { path: 'c.ts', status: 'deleted' },
    ]);
  });

  it('decorationFor shows comment count, viewed tick and rename tooltip', () => {
    const store = createPrStore();
    store.getState().setPr(pr([file('a.ts', { viewed: true }), file('b.ts'), file('c.ts', { prevPath: 'old/c.ts' })]));
    store.getState().setThreads([thread('1', 'a.ts', [1, 2])]);
    expect(decorationFor(store.getState(), 'a.ts')).toEqual({
      text: '2 ✓',
      title: '2 comments · Viewed',
      parts: [
        { text: '2', color: 'var(--pierre-muted)' },
        { text: ' ✓', color: 'var(--pierre-success)' },
      ],
    });
    expect(decorationFor(store.getState(), 'b.ts')).toBeNull();
    expect(decorationFor(store.getState(), 'c.ts')?.title).toBe('Renamed from old/c.ts');
    expect(decorationFor(store.getState(), 'missing.ts')).toBeNull();
  });

  it('visibleFiles finds the current file and the files in the viewport', () => {
    const order = ['a', 'b', 'c', 'd', 'e'];
    const tops: Record<string, number> = { a: 0, b: 100, c: 400, d: 450, e: 2000 };
    const topOf = (id: string) => tops[id];
    expect(visibleFiles(order, topOf, 0, 500)).toEqual({ ids: ['a', 'b', 'c', 'd'], current: 'a' });
    expect(visibleFiles(order, topOf, 120, 300)).toEqual({ ids: ['b', 'c'], current: 'b' });
    expect(visibleFiles(order, topOf, 90, 300, 40)).toEqual({ ids: ['b'], current: 'b' }); // header edge
    expect(visibleFiles(order, topOf, 1900, 900)).toEqual({ ids: ['d', 'e'], current: 'd' });
    expect(visibleFiles([], topOf, 0, 100)).toEqual({ ids: [] });
  });
});
