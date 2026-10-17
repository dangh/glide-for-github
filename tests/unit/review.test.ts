// @vitest-environment jsdom
// (@pierre/diffs reads `navigator` at import time.)
import { getSingularPatch } from '@pierre/diffs';
import { describe, expect, it } from 'vitest';
import type { FileSummary, PrData } from '../../src/viewer/github/private';
import type { CommentModel, ThreadModel } from '../../src/viewer/github/threads';
import { createAnnotationSource } from '../../src/viewer/state/annotations';
import {
  fileTarget,
  newSideLines,
  openComposerIn,
  suggestionBlock,
  targetFromRange,
  targetKey,
  type CommentTarget,
} from '../../src/viewer/state/compose';
import { ItemSync, type PierreItem } from '../../src/viewer/state/items';
import { mergeThreads } from '../../src/viewer/state/review';
import { createPrStore } from '../../src/viewer/state/store';

const file = (path: string): FileSummary => ({
  path,
  digest: `d-${path}`,
  status: 'modified',
  additions: 1,
  deletions: 1,
  viewed: false,
  tooLarge: false,
  binary: false,
});

const pr: PrData = {
  ref: { owner: 'o', repo: 'r', number: 1, page: 'changes' },
  author: 'me',
  baseOid: 'base',
  headOid: 'head',
  commits: [],
  files: [file('a.ts'), file('b.ts')],
  viewer: { login: 'me', canApplySuggestion: false, canReview: true },
  threadMarkers: { threads: [], byPath: {} },
};

const comment = (databaseId: number, body = `c${databaseId}`, extra: Partial<CommentModel> = {}): CommentModel => ({
  databaseId,
  nodeId: `PRRC_${databaseId}`,
  author: { login: 'me', avatarUrl: '' },
  body,
  bodyHTML: `<p>${body}</p>`,
  bodyVersion: 'v',
  createdAt: '2026-10-17T00:00:00Z',
  state: 'submitted',
  reactions: [],
  viewerCanUpdate: true,
  viewerCanDelete: true,
  ...extra,
});

const thread = (id: string, path: string, line: number, extra: Partial<ThreadModel> = {}): ThreadModel => ({
  id,
  path,
  side: 'additions',
  line,
  subject: line === 0 ? 'file' : 'line',
  isOutdated: false,
  isResolved: false,
  comments: [comment(Number(id) * 10)],
  viewerCanReply: true,
  ...extra,
});

function setup(threads: ThreadModel[] = []) {
  const store = createPrStore();
  store.getState().setPr(pr);
  store.getState().setThreads(threads);
  const sync = new ItemSync(createAnnotationSource());
  const items = sync.seed(store.getState());
  const updates: PierreItem[] = [];
  const sink = { updateItem: (item: PierreItem) => (updates.push(item), true) };
  return { store, sync, items, updates, sink };
}

describe('annotation source', () => {
  it('places line threads at {side, lineNumber}, file-level and outdated threads at line 0', () => {
    const { items } = setup([
      thread('1', 'a.ts', 4),
      thread('2', 'a.ts', 0),
      thread('3', 'a.ts', 9, { isOutdated: true, side: 'deletions' }),
      thread('4', 'a.ts', 7, { side: 'deletions', startLine: 5, startSide: 'deletions' }),
    ]);
    const a = items.find((i) => i.id === 'a.ts')!;
    expect(a.annotations).toEqual([
      { side: 'additions', lineNumber: 4, metadata: { kind: 'thread', threadId: '1' } },
      { side: 'additions', lineNumber: 0, metadata: { kind: 'thread', threadId: '2' } },
      { side: 'deletions', lineNumber: 0, metadata: { kind: 'thread', threadId: '3' } },
      { side: 'deletions', lineNumber: 7, metadata: { kind: 'thread', threadId: '4' } },
    ]);
    expect(items.find((i) => i.id === 'b.ts')!.annotations).toEqual([]);
  });

  it('opening a composer updates that one item; typing (draft body changes) updates none', () => {
    const { store, sync, updates, sink } = setup([thread('1', 'a.ts', 4)]);
    const target = targetFromRange('a.ts', { start: 6, side: 'additions', end: 6, endSide: 'additions' });
    const key = openComposerIn(store, target);
    expect(sync.sync(store.getState(), sink)).toEqual(['a.ts']);
    // Composers first (in opening order), then threads: Pierre keys annotation slots by index, so a thread
    // added to the file later never shifts (remounts) an open composer.
    expect(updates[0]!.annotations).toEqual([
      { side: 'additions', lineNumber: 6, metadata: { kind: 'composer', key } },
      { side: 'additions', lineNumber: 4, metadata: { kind: 'thread', threadId: '1' } },
    ]);
    for (let i = 0; i < 20; i++) {
      store.getState().setDraft(key, { ...store.getState().drafts.get(key)!, body: 'x'.repeat(i), updatedAt: i });
      expect(sync.sync(store.getState(), sink)).toEqual([]);
    }
    expect(updates).toHaveLength(1);
  });

  it('opening the same composer twice is a no-op', () => {
    const { store, sync, sink } = setup();
    const target = targetFromRange('a.ts', { start: 3, side: 'additions', end: 3 });
    openComposerIn(store, target);
    sync.sync(store.getState(), sink);
    const before = store.getState().drafts;
    openComposerIn(store, target);
    expect(store.getState().drafts).toBe(before);
  });

  it('a thread refetch with the same positions keeps every item untouched; a moved or new thread updates its file only', () => {
    const { store, sync, sink } = setup([thread('1', 'a.ts', 4), thread('2', 'b.ts', 2)]);
    // New thread objects (new reply, edited body, reactions) at the same places.
    store.getState().setThreads([
      thread('1', 'a.ts', 4, { comments: [comment(10), comment(11)] }),
      thread('2', 'b.ts', 2, { isResolved: true }),
    ]);
    expect(sync.sync(store.getState(), sink)).toEqual([]);
    store.getState().setThreads([thread('1', 'a.ts', 4), thread('2', 'b.ts', 2), thread('3', 'b.ts', 5)]);
    expect(sync.sync(store.getState(), sink)).toEqual(['b.ts']);
  });
});

describe('composer targets', () => {
  it('a single line, a range (normalized top to bottom) and a whole file', () => {
    expect(targetFromRange('a.ts', { start: 5, side: 'additions', end: 5, endSide: 'additions' })).toEqual({
      path: 'a.ts',
      side: 'additions',
      line: 5,
      subject: 'line',
    });
    expect(targetFromRange('a.ts', { start: 9, side: 'deletions', end: 7, endSide: 'deletions' })).toEqual({
      path: 'a.ts',
      side: 'deletions',
      line: 9,
      startLine: 7,
      startSide: 'deletions',
      subject: 'line',
    });
    expect(targetFromRange('a.ts', { start: 3, side: 'deletions', end: 4, endSide: 'additions' })).toEqual({
      path: 'a.ts',
      side: 'additions',
      line: 4,
      startLine: 3,
      startSide: 'deletions',
      subject: 'line',
    });
    expect(fileTarget('a.ts')).toEqual({ path: 'a.ts', side: 'additions', line: 0, subject: 'file' });
  });

  it('draft keys follow draftKey.line, files use line 0', () => {
    const t: CommentTarget = { path: 'a.ts', side: 'additions', line: 9, startLine: 7, startSide: 'additions', subject: 'line' };
    expect(targetKey(t)).toBe('a.ts:additions:7-9');
    expect(targetKey(fileTarget('a.ts'))).toBe('a.ts:additions:-0');
  });
});

describe('suggestions', () => {
  const patch = ['diff --git a/a.ts b/a.ts', '--- a/a.ts', '+++ b/a.ts', '@@ -10,3 +10,4 @@', ' one', '-two', '+TWO', '+three', ' four', ''].join('\n');

  it('reads new-side lines from a partial diff by line number', () => {
    const diff = getSingularPatch(patch);
    expect(newSideLines(diff, 11, 12)).toEqual(['TWO', 'three']);
    expect(newSideLines(diff, 10, 10)).toEqual(['one']);
    expect(newSideLines(diff, 13, 13)).toEqual(['four']);
    expect(newSideLines(diff, 20, 21)).toBeNull();
  });

  it('builds the exact fenced block', () => {
    expect(suggestionBlock(['TWO', 'three'])).toBe('```suggestion\nTWO\nthree\n```');
  });
});

describe('mergeThreads', () => {
  it('keeps provisional threads and comments the refetch does not have yet, drops recently deleted comments', () => {
    const local = thread('local:99', 'a.ts', 3, { comments: [comment(99, 'new', { provisional: true })], provisional: true });
    const replied = thread('1', 'a.ts', 4, { comments: [comment(10), comment(12, 'reply', { provisional: true })] });
    const fetched = [thread('1', 'a.ts', 4), thread('2', 'b.ts', 2, { comments: [comment(20), comment(21)] })];
    const merged = mergeThreads(fetched, [local, replied], new Set([21]));
    expect(merged.map((t) => [t.id, t.comments.map((c) => c.databaseId)])).toEqual([
      ['1', [10, 12]],
      ['2', [20]],
      ['local:99', [99]],
    ]);
  });

  it('the server copy wins once it has the comment', () => {
    const local = thread('local:99', 'a.ts', 3, { comments: [comment(99, 'new', { provisional: true })], provisional: true });
    const fetched = [thread('7', 'a.ts', 3, { comments: [comment(99, 'new')] })];
    expect(mergeThreads(fetched, [local], new Set()).map((t) => t.id)).toEqual(['7']);
  });
});
