// @vitest-environment jsdom
// (@pierre/diffs reads `navigator` at import time.)
import { getSingularPatch } from '@pierre/diffs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BridgeError } from '../../src/shared/rpc';
import { useTokenPrompt } from '../../src/viewer/auth/requireToken';
import { setToken, setTokenStorage, type TokenStorageArea } from '../../src/viewer/auth/tokens';
import { WriteError } from '../../src/viewer/github/errors';
import type { FileSummary, PrData } from '../../src/viewer/github/private';
import type { CommentModel, ThreadModel } from '../../src/viewer/github/threads';
import { createAnnotationSource } from '../../src/viewer/state/annotations';
import {
  fileTarget,
  newSideLines,
  openComposer,
  openComposerIn,
  suggestionBlock,
  targetFromRange,
  targetKey,
  type CommentTarget,
} from '../../src/viewer/state/compose';
import { ItemSync, type PierreItem } from '../../src/viewer/state/items';
import { discardReview, mergeThreads, resetReviewCaches, setFileViewed, submitNewComment, submitReview } from '../../src/viewer/state/review';
import { session } from '../../src/viewer/state/session';
import { createPrStore, draftKey, isCollapsed, usePr } from '../../src/viewer/state/store';
import { batchKeyName, initBatchPersistence } from '../../src/viewer/state/batch';
import { reloadPr } from '../../src/viewer/state/load';
import { applyKeyName, commitSuggestions, suggestionCount } from '../../src/viewer/state/suggestions';

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
      { side: 'additions', lineNumber: 4, metadata: { kind: 'thread', threadKey: '10' } },
      { side: 'additions', lineNumber: 0, metadata: { kind: 'thread', threadKey: '20' } },
      { side: 'deletions', lineNumber: 0, metadata: { kind: 'thread', threadKey: '30' } },
      { side: 'deletions', lineNumber: 7, metadata: { kind: 'thread', threadKey: '40' } },
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
      { side: 'additions', lineNumber: 4, metadata: { kind: 'thread', threadKey: '10' } },
    ]);
    for (let i = 0; i < 20; i++) {
      store.getState().setDraft(key, { ...store.getState().drafts.get(key)!, body: 'x'.repeat(i), updatedAt: i });
      expect(sync.sync(store.getState(), sink)).toEqual([]);
    }
    expect(updates).toHaveLength(1);
  });

  it('threads are ordered by first comment id (stable across a provisional → server swap and refetch order)', () => {
    const { store, sync, sink, items } = setup([thread('2', 'a.ts', 8), thread('1', 'a.ts', 4)]);
    const a = items.find((i) => i.id === 'a.ts')!;
    expect(a.annotations!.map((x) => (x.metadata.kind === 'thread' ? x.metadata.threadKey : ''))).toEqual(['10', '20']);
    // The provisional thread of comment 30 becomes server thread '9': same key, same place, no item update.
    store.getState().setThreads([thread('2', 'a.ts', 8), thread('1', 'a.ts', 4), thread('local:30', 'a.ts', 6, { comments: [comment(30)] })]);
    expect(sync.sync(store.getState(), sink)).toEqual(['a.ts']);
    store.getState().setThreads([thread('9', 'a.ts', 6, { comments: [comment(30)] }), thread('1', 'a.ts', 4), thread('2', 'a.ts', 8)]);
    expect(sync.sync(store.getState(), sink)).toEqual([]);
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

// ---- Task 10: review submission, viewed sync, apply suggestion ------------------------------------------

describe('review submission, viewed, apply suggestion (global store)', () => {
  const TOKEN = 'ghp_ReviewTestToken0123456789';
  const HEAD = 'c'.repeat(40);
  const livePr: PrData = { ...pr, nodeId: 'PR_node', headOid: HEAD, baseOid: 'b'.repeat(40), files: [file('a.ts'), file('b.ts')] };

  function fakeArea(): TokenStorageArea {
    const data: Record<string, unknown> = {};
    return {
      get: async (key) => (key in data ? { [key]: structuredClone(data[key]) } : {}),
      set: async (items) => void Object.assign(data, structuredClone(items)),
    };
  }
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  /** GraphQL answers by operation name (`mutation StartReview(…`, `query PendingReview(…`). */
  function graphql(answers: Record<string, () => Response>) {
    const ops: { op: string; variables: Record<string, unknown> }[] = [];
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      const op = /^(?:query|mutation)\s+(\w+)/.exec(body.query)![1]!;
      ops.push({ op, variables: body.variables });
      const answer = answers[op];
      if (!answer) throw new Error(`unexpected ${op}`);
      return answer();
    });
    return ops;
  }
  function fakeRpc(handler: (method: string, ...args: unknown[]) => Promise<unknown>) {
    const calls: unknown[][] = [];
    session.rpc = { call: (async (method: string, ...args: unknown[]) => (calls.push([method, ...args]), handler(method, ...args))) as never };
    return calls;
  }
  const refusedViewed = (op: 'markFileAsViewed' | 'unmarkFileAsViewed') => () =>
    json(200, { data: { [op]: null }, errors: [{ type: 'FORBIDDEN', message: 'Resource not accessible by personal access token' }] });

  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(async () => {
    setTokenStorage(fakeArea());
    await setToken('o', TOKEN, { login: 'me' });
    resetReviewCaches();
    usePr.getState().setPr(livePr);
    usePr.setState({ drafts: new Map(), threads: [], pendingReview: null, headMoved: false, suggestionBatch: [], notice: null });
    sessionStorage.clear();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    session.rpc = undefined;
    for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) vi.spyOn(console, m).mockImplementation(() => undefined);
  });
  afterEach(() => {
    setTokenStorage(undefined);
    session.rpc = undefined;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('pending review count', () => {
    const answers = {
      PendingReview: () => json(200, { data: { repository: { pullRequest: { reviews: { nodes: [] } } } } }),
      StartReview: () => json(200, { data: { addPullRequestReview: { pullRequestReview: { id: 'PRR_1' } } } }),
      AddReviewThread: () =>
        json(200, { data: { addPullRequestReviewThread: { thread: { id: 'PRRT_1', comments: { nodes: [{ id: 'PRRC_5', databaseId: 5 }] } } } } }),
      SubmitReview: () => json(200, { data: { submitPullRequestReview: { pullRequestReview: { id: 'PRR_1' } } } }),
      DeleteReview: () => json(200, { data: { deletePullRequestReview: { pullRequestReview: { id: 'PRR_1' } } } }),
    };
    const addReviewComment = async (line: number) => {
      const key = openComposer(targetFromRange('a.ts', { start: line, side: 'additions', end: line }));
      await submitNewComment(key, `review comment ${line}`, 'review');
    };

    it('add → 1 pending; submit as Comment → no pending review, its comments submitted, summary draft cleared', async () => {
      const ops = graphql(answers);
      await addReviewComment(2);
      expect(usePr.getState().pendingReview).toEqual({ nodeId: 'PRR_1', count: 1 });
      usePr.getState().setDraft(draftKey.reviewSummary, { body: 'Looks good', updatedAt: 1 });
      await submitReview('COMMENT', 'Looks good');
      expect(ops.at(-1)).toEqual({ op: 'SubmitReview', variables: { input: { pullRequestReviewId: 'PRR_1', event: 'COMMENT', body: 'Looks good' } } });
      const s = usePr.getState();
      expect(s.pendingReview).toBeNull();
      expect(s.drafts.has(draftKey.reviewSummary)).toBe(false);
      expect(s.threads.flatMap((t) => t.comments.map((c) => c.state))).toEqual(['submitted']);
    });

    it('submitting with no pending review starts an empty one first, then submits it (Approve)', async () => {
      const ops = graphql(answers);
      await submitReview('APPROVE', '');
      expect(ops.map((o) => o.op)).toEqual(['PendingReview', 'StartReview', 'SubmitReview']);
      expect(ops[1]!.variables).toEqual({ input: { pullRequestId: 'PR_node', commitOID: HEAD } });
      expect(ops[2]!.variables).toEqual({ input: { pullRequestReviewId: 'PRR_1', event: 'APPROVE', body: '' } });
      expect(usePr.getState().pendingReview).toBeNull();
    });

    it('discard deletes the pending review: count gone and its pending comments removed', async () => {
      const ops = graphql(answers);
      await addReviewComment(2);
      usePr.getState().upsertThread(thread('9', 'b.ts', 1)); // a submitted thread stays
      expect(usePr.getState().pendingReview?.count).toBe(1);
      await discardReview();
      expect(ops.at(-1)).toEqual({ op: 'DeleteReview', variables: { input: { pullRequestReviewId: 'PRR_1' } } });
      expect(usePr.getState().pendingReview).toBeNull();
      expect(usePr.getState().threads.map((t) => t.id)).toEqual(['9']);
    });

    it('a failed submit keeps the pending review, its count and the summary draft', async () => {
      graphql({ ...answers, SubmitReview: () => json(200, { data: null, errors: [{ type: 'UNPROCESSABLE', message: 'Review cannot be submitted' }] }) });
      await addReviewComment(2);
      usePr.getState().setDraft(draftKey.reviewSummary, { body: 'sum', updatedAt: 1 });
      await expect(submitReview('COMMENT', 'sum')).rejects.toThrow(/Review cannot be submitted/);
      expect(usePr.getState().pendingReview).toEqual({ nodeId: 'PRR_1', count: 1 });
      expect(usePr.getState().drafts.get(draftKey.reviewSummary)?.body).toBe('sum');
    });
  });

  describe('viewed', () => {
    it('toggles optimistically (and collapses) and marks it on GitHub with the token (markFileAsViewed)', async () => {
      const ops = graphql({ MarkViewed: () => json(200, { data: { markFileAsViewed: { pullRequest: { id: 'PR_node' } } } }) });
      const done = setFileViewed('a.ts', true);
      expect(usePr.getState().viewed.has('a.ts')).toBe(true); // before GitHub answered
      expect(isCollapsed(usePr.getState(), 'a.ts')).toBe(true);
      await done;
      expect(ops).toEqual([{ op: 'MarkViewed', variables: { input: { pullRequestId: 'PR_node', path: 'a.ts' } } }]);
      expect(usePr.getState().viewed.has('a.ts')).toBe(true);
    });

    it('reverts when GitHub rejects it', async () => {
      graphql({ UnmarkViewed: () => json(502, { message: 'Bad gateway' }) });
      usePr.getState().setViewedLocal('a.ts', true);
      await expect(setFileViewed('a.ts', false)).rejects.toBeInstanceOf(WriteError);
      expect(usePr.getState().viewed.has('a.ts')).toBe(true);
    });

    it('a token GitHub refuses (fine-grained) falls back to the session file_review via the bridge, no prompt', async () => {
      graphql({ MarkViewed: refusedViewed('markFileAsViewed') });
      const calls = fakeRpc(async () => null);
      await setFileViewed('a.ts', true);
      expect(calls).toEqual([['markViewed', 'o', 'r', 1, 'a.ts']]);
      expect(usePr.getState().viewed.has('a.ts')).toBe(true);
      expect(useTokenPrompt.getState().queue).toHaveLength(0);
    });

    it('without a token, uses the session only (no API call, no prompt); unmark likewise', async () => {
      setTokenStorage(fakeArea());
      const calls = fakeRpc(async () => null);
      await setFileViewed('b.ts', true);
      await setFileViewed('b.ts', false);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(calls).toEqual([
        ['markViewed', 'o', 'r', 1, 'b.ts'],
        ['unmarkViewed', 'o', 'r', 1, 'b.ts'],
      ]);
      expect(usePr.getState().viewed.has('b.ts')).toBe(false);
      expect(useTokenPrompt.getState().queue).toHaveLength(0);
    });

    it('reverts when the session fallback fails too', async () => {
      setTokenStorage(fakeArea());
      fakeRpc(async () => {
        throw new BridgeError({ status: 422, message: 'can only be marked as viewed on the All files page' });
      });
      await expect(setFileViewed('a.ts', true)).rejects.toThrow(/All files page/);
      expect(usePr.getState().viewed.has('a.ts')).toBe(false);
    });
  });

  describe('apply suggestions', () => {
    const ref = (commentId: number, suggestionIndex = 0) => ({
      commentId,
      suggestionIndex,
      path: 'a.ts',
      url: `https://github.com/o/r/pull/1#discussion_r${commentId}`,
    });
    const applyCalls = (calls: unknown[][]) => calls.filter((c) => c[0] === 'applySuggestions');

    it('sends sorted comments, the message and the PR head with a per-PR key; success clears key and batch and reloads the PR', async () => {
      const calls = fakeRpc(async (method) => {
        if (method === 'applySuggestions') return {};
        throw new BridgeError({ status: 0, code: 'network', message: 'offline in tests' });
      });
      for (const r of [ref(12, 1), ref(7), ref(12, 0)]) usePr.getState().addToBatch(r);
      await commitSuggestions(usePr.getState().suggestionBatch, 'Apply suggestions from code review');
      const [call] = applyCalls(calls);
      expect(call![1]).toEqual({
        owner: 'o',
        repo: 'r',
        number: 1,
        comments: [{ id: 7, suggestionIndex: 0 }, { id: 12, suggestionIndex: 0 }, { id: 12, suggestionIndex: 1 }],
        message: 'Apply suggestions from code review',
        expectedHeadOid: HEAD,
      });
      expect(call![2]).toMatch(/^[0-9a-f-]{36}$/);
      expect(sessionStorage.getItem(applyKeyName(livePr.ref))).toBeNull();
      expect(usePr.getState().suggestionBatch).toEqual([]);
      expect(calls.some((c) => c[0] === 'get' && c[1] === '/o/r/pull/1/changes')).toBe(true); // PR data reloaded
    });

    it('head moved: a 409 HEAD_OID_MISMATCH sets headMoved and keeps the suggestion batch', async () => {
      fakeRpc(async () => {
        throw new BridgeError({ status: 409, code: 'HEAD_OID_MISMATCH', message: 'HTTP 409' });
      });
      usePr.getState().addToBatch(ref(7));
      usePr.getState().addToBatch(ref(8));
      const err = await commitSuggestions(usePr.getState().suggestionBatch, 'm').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(WriteError);
      expect((err as WriteError).kind).toBe('conflict');
      expect((err as Error).message).toMatch(/head moved/i);
      expect(usePr.getState().headMoved).toBe(true);
      expect(usePr.getState().suggestionBatch.map((r) => r.commentId)).toEqual([7, 8]);
    });

    it('reuses the idempotency key across a retry after a failure, and uses a new one after success', async () => {
      let n = 0;
      const calls = fakeRpc(async (method) => {
        if (method !== 'applySuggestions') return null;
        if (n++ === 0) throw new BridgeError({ status: 0, code: 'network', message: 'Failed to fetch' });
        return {};
      });
      usePr.getState().addToBatch(ref(7));
      await expect(commitSuggestions([ref(7)], 'm')).rejects.toBeInstanceOf(WriteError);
      expect(usePr.getState().suggestionBatch).toHaveLength(1); // kept for the retry
      await commitSuggestions([ref(7)], 'm');
      await commitSuggestions([ref(9)], 'm');
      const keys = applyCalls(calls).map((c) => c[2]);
      expect(keys).toHaveLength(3);
      expect(keys[1]).toBe(keys[0]);
      expect(keys[2]).not.toBe(keys[0]);
      expect(sessionStorage.getItem(applyKeyName(livePr.ref))).toBeNull();
    });

    it('any other failure is a WriteError with GitHub\'s message; nothing applied, batch kept', async () => {
      fakeRpc(async () => {
        throw new BridgeError({ status: 422, message: 'Suggestion is outdated' });
      });
      usePr.getState().addToBatch(ref(7));
      await expect(commitSuggestions([ref(7)], 'm')).rejects.toThrow(/Suggestion is outdated/);
      expect(usePr.getState().headMoved).toBe(false);
      expect(usePr.getState().suggestionBatch).toHaveLength(1);
    });

    /** GitHub's route JSON for `o/r#1` at `head`, with suggestion comments 7 (R4) and 8 (R6, outdated later) on a.ts. */
    function routeAt(head: string, comments: { id: number; marker: string }[]) {
      const thread = (c: { id: number }) => ({
        id: String(c.id * 10),
        subjectType: 'LINE',
        isResolved: false,
        viewerCanReply: true,
        commentsData: {
          comments: [
            { id: `PRRC_${c.id}`, databaseId: c.id, author: { login: 'octo', avatarUrl: '' }, body: '```suggestion\nx\n```', bodyHTML: '', bodyVersion: 'v', createdAt: '2026-10-17T00:00:00Z', state: 'submitted' },
          ],
        },
      });
      return {
        payload: {
          pullRequestsChangesRoute: {
            pullRequest: { globalRelayId: 'PR_node', author: { login: 'me' } },
            comparison: { fullDiff: { baseOid: 'b'.repeat(40), headOid: head } },
            user: { currentUserLogin: 'me', canApplySuggestion: true, canComment: true },
            diffSummaries: [
              {
                path: 'a.ts',
                pathDigest: 'd',
                changeType: 'MODIFIED',
                linesAdded: 1,
                linesDeleted: 0,
                markedAsViewed: false,
                markersMap: Object.fromEntries(comments.map((c) => [c.marker, { threads: [{ id: String(c.id * 10) }] }])),
              },
            ],
            markers: { threads: Object.fromEntries(comments.map((c) => [String(c.id * 10), thread(c)])) },
          },
        },
      };
    }

    it('head moved → "Reload" (soft, loadPr) keeps the batch, drops refs that no longer apply, and the commit sends the new head', async () => {
      const NEW = 'e'.repeat(40);
      let head = HEAD;
      let applied = 0;
      const calls = fakeRpc(async (method, path) => {
        if (method === 'applySuggestions') {
          if (applied++ === 0) throw new BridgeError({ status: 409, code: 'HEAD_OID_MISMATCH', message: 'HTTP 409' });
          return {};
        }
        if (method === 'get' && String(path).endsWith('/changes')) return { data: routeAt(head, [{ id: 7, marker: 'R4' }]), link: null };
        if (method === 'get' && String(path).endsWith('/page_data/threads')) return { data: { threads: [] }, link: null };
        if (method === 'get') return { data: [], link: null };
        throw new Error(`unexpected ${method}`);
      });
      // 8's comment is gone after the reload (its suggestion was applied / deleted elsewhere).
      usePr.getState().addToBatch(ref(7));
      usePr.getState().addToBatch(ref(8));
      await expect(commitSuggestions(usePr.getState().suggestionBatch, 'm')).rejects.toThrow(/head moved/i);
      expect(usePr.getState().headMoved).toBe(true);

      head = NEW; // the PR has a new commit
      await reloadPr();
      const s = usePr.getState();
      expect(s.headMoved).toBe(false);
      expect(s.pr!.headOid).toBe(NEW);
      expect(s.suggestionBatch.map((r) => r.commentId)).toEqual([7]); // kept; 8 no longer applies
      await commitSuggestions(s.suggestionBatch, 'm');
      const applies = calls.filter((c) => c[0] === 'applySuggestions');
      expect((applies[0]![1] as { expectedHeadOid: string }).expectedHeadOid).toBe(HEAD);
      expect((applies[1]![1] as { expectedHeadOid: string }).expectedHeadOid).toBe(NEW);
    });

    it('persists the batch per PR in sessionStorage and restores it in a fresh viewer (page reload)', () => {
      const first = createPrStore();
      const stop = initBatchPersistence(first);
      first.getState().setPr(livePr);
      first.getState().addToBatch(ref(7));
      first.getState().addToBatch(ref(9, 1));
      stop();
      expect(JSON.parse(sessionStorage.getItem(batchKeyName(livePr.ref))!)).toHaveLength(2);

      const second = createPrStore(); // the reloaded viewer
      const stop2 = initBatchPersistence(second);
      second.getState().setPr(livePr);
      expect(second.getState().suggestionBatch).toEqual([ref(7), ref(9, 1)]);
      second.getState().removeFromBatch([ref(7)]);
      expect(JSON.parse(sessionStorage.getItem(batchKeyName(livePr.ref))!)).toEqual([ref(9, 1)]);
      stop2();
    });

    it('ignores a malformed or foreign stored batch', () => {
      sessionStorage.setItem(
        batchKeyName(livePr.ref),
        JSON.stringify([ref(7), { commentId: 'x' }, { ...ref(8), url: 'javascript:alert(1)' }, { ...ref(9), suggestionIndex: -1 }]),
      );
      const store = createPrStore();
      const stop = initBatchPersistence(store);
      store.getState().setPr(livePr);
      expect(store.getState().suggestionBatch).toEqual([ref(7)]);
      stop();
      sessionStorage.setItem(batchKeyName(livePr.ref), '{not json');
      const other = createPrStore();
      const stop2 = initBatchPersistence(other);
      other.getState().setPr(livePr);
      expect(other.getState().suggestionBatch).toEqual([]);
      stop2();
    });

    it('counts suggestion blocks in a comment body (fenced ```suggestion, not inside other fences)', () => {
      expect(suggestionCount('plain')).toBe(0);
      expect(suggestionCount('Try:\n```suggestion\nconst a = 1;\n```\n')).toBe(1);
      expect(suggestionCount('```suggestion\na\n```\ntext\n````suggestion\nb\n```\n````\n')).toBe(2);
      expect(suggestionCount('```ts\n```suggestion\n```\n')).toBe(0);
      expect(suggestionCount('  ```suggestion\nx\n  ```')).toBe(1);
    });
  });
});
