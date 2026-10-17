// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requireToken } from '../../src/viewer/auth/requireToken';
import { setToken, setTokenStorage, type TokenStorageArea } from '../../src/viewer/auth/tokens';
import type { FileSummary, PrData } from '../../src/viewer/github/private';
import type { CommentModel, ThreadModel } from '../../src/viewer/github/threads';
import { openComposer, targetFromRange } from '../../src/viewer/state/compose';
import { resetReviewCaches } from '../../src/viewer/state/review';
import { session } from '../../src/viewer/state/session';
import { draftKey, usePr } from '../../src/viewer/state/store';
import { Composer } from '../../src/viewer/ui/Composer';
import { sanitizeHtml } from '../../src/viewer/ui/Markdown';
import { Thread } from '../../src/viewer/ui/Thread';
import { TokenPromptHost } from '../../src/viewer/ui/TokenPrompt';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TOKEN = 'ghp_ThreadTestToken0123456789';

const file = (path: string): FileSummary => ({ path, digest: path, status: 'modified', additions: 1, deletions: 1, viewed: false, tooLarge: false, binary: false });
const pr: PrData = {
  ref: { owner: 'dangh', repo: 'pierre-sandbox', number: 1, page: 'changes' },
  nodeId: 'PR_node',
  author: 'dangh',
  baseOid: 'b'.repeat(40),
  headOid: 'h'.repeat(40),
  commits: [],
  files: [file('src/a.ts')],
  viewer: { login: 'dangh', canApplySuggestion: true, canReview: true },
  threadMarkers: { threads: [], byPath: {} },
};

const comment = (databaseId: number, extra: Partial<CommentModel> = {}): CommentModel => ({
  databaseId,
  nodeId: `PRRC_${databaseId}`,
  author: { login: 'dangh', avatarUrl: '' },
  body: `body ${databaseId}`,
  bodyHTML: `<p>body ${databaseId}</p>`,
  bodyVersion: 'v',
  createdAt: '2026-10-17T06:26:18Z',
  state: 'submitted',
  reactions: [{ content: 'THUMBS_UP', count: 1, viewerHasReacted: true }],
  viewerCanUpdate: true,
  viewerCanDelete: true,
  ...extra,
});

const thread = (id: string, extra: Partial<ThreadModel> = {}): ThreadModel => ({
  id,
  path: 'src/a.ts',
  side: 'additions',
  line: 4,
  subject: 'line',
  isOutdated: false,
  isResolved: false,
  comments: [comment(Number(id) * 10)],
  viewerCanReply: true,
  ...extra,
});

function fakeArea(): TokenStorageArea {
  const data: Record<string, unknown> = {};
  return {
    get: async (key) => (key in data ? { [key]: structuredClone(data[key]) } : {}),
    set: async (items) => void Object.assign(data, structuredClone(items)),
  };
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let root: Root;
let container: HTMLDivElement;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  setTokenStorage(fakeArea());
  await setToken('dangh', TOKEN, { login: 'dangh' });
  resetReviewCaches();
  session.rpc = undefined;
  usePr.getState().setPr(pr);
  usePr.getState().setPendingReview(null);
  usePr.setState({ drafts: new Map() });
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) vi.spyOn(console, m).mockImplementation(() => undefined);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = '';
  setTokenStorage(undefined);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const render = (el: React.ReactNode) => act(async () => root.render(el));
const button = (name: string | RegExp) =>
  [...container.querySelectorAll('button')].find((b) => (typeof name === 'string' ? b.textContent === name : name.test(b.textContent ?? '')));
const click = (el: Element) => act(async () => (el as HTMLElement).click());
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));
const gqlBodies = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/graphql')).map(([, init]) => JSON.parse(init.body));

describe('Thread', () => {
  it('renders comments with GitHub HTML, author, time and reactions', async () => {
    usePr.getState().setThreads([thread('1')]);
    await render(<Thread threadId="1" />);
    expect(container.querySelector('.markdown-body')!.innerHTML).toBe('<p>body 10</p>');
    expect(container.querySelector('.comment-author')!.textContent).toBe('dangh');
    expect(container.querySelector('[data-reaction="THUMBS_UP"]')!.textContent).toBe('👍 1');
    expect(button('Resolve conversation')).toBeDefined();
  });

  it('outdated threads start collapsed with an "Outdated" label; resolved ones with "Resolved", expandable', async () => {
    usePr.getState().setThreads([thread('1', { isOutdated: true }), thread('2', { isResolved: true })]);
    await render(
      <>
        <Thread threadId="1" />
        <Thread threadId="2" />
      </>,
    );
    const [outdated, resolved] = [...container.querySelectorAll<HTMLElement>('.thread')];
    expect(outdated!.querySelector('.label-outdated')!.textContent).toBe('Outdated');
    expect(outdated!.querySelector('.comment')).toBeNull();
    expect(resolved!.querySelector('.label-resolved')!.textContent).toBe('Resolved');
    expect(resolved!.querySelector('.comment')).toBeNull();
    await click(resolved!.querySelector('.thread-fold')!);
    expect(resolved!.querySelector('.comment')).not.toBeNull();
    expect(button('Unresolve conversation')).toBeDefined();
  });

  it('toggling a reaction the viewer has removes it (viewerHasReacted), optimistically', async () => {
    usePr.getState().setThreads([thread('1')]);
    fetchMock.mockResolvedValue(json(200, { data: { removeReaction: { reaction: { content: 'THUMBS_UP' } } } }));
    await render(<Thread threadId="1" />);
    await click(container.querySelector('[data-reaction="THUMBS_UP"]')!);
    await settle();
    expect(gqlBodies()[0].query).toContain('removeReaction');
    expect(gqlBodies()[0].variables.input).toEqual({ subjectId: 'PRRC_10', content: 'THUMBS_UP' });
    expect(usePr.getState().threads[0]!.comments[0]!.reactions[0]).toEqual({ content: 'THUMBS_UP', count: 0, viewerHasReacted: false });
  });

  it('a failed reaction is reverted and shown with Retry', async () => {
    usePr.getState().setThreads([thread('1')]);
    fetchMock.mockResolvedValue(json(200, { errors: [{ type: 'FORBIDDEN', message: 'nope' }] }));
    await render(<Thread threadId="1" />);
    await click(container.querySelector('[aria-label="Add reaction"]')!);
    await click(container.querySelector('.reaction-menu [data-reaction="HEART"]')!);
    await settle();
    expect(gqlBodies()[0].query).toContain('addReaction');
    expect(usePr.getState().threads[0]!.comments[0]!.reactions.find((r) => r.content === 'HEART')).toMatchObject({ count: 0, viewerHasReacted: false });
    expect(container.querySelector('[role="alert"]')!.textContent).toContain('Retry');
  });

  it('resolve looks up thread node ids lazily, once, then resolves', async () => {
    usePr.getState().setThreads([thread('1'), thread('2')]);
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const q = JSON.parse(String(init.body)).query as string;
      if (q.includes('reviewThreads'))
        return json(200, {
          data: {
            repository: {
              pullRequest: {
                reviewThreads: {
                  nodes: [
                    { id: 'PRRT_1', comments: { nodes: [{ databaseId: 10 }] } },
                    { id: 'PRRT_2', comments: { nodes: [{ databaseId: 20 }] } },
                  ],
                  pageInfo: { hasNextPage: false, endCursor: null },
                },
              },
            },
          },
        });
      return json(200, { data: { resolveReviewThread: { thread: { id: 'x', isResolved: true } } } });
    });
    await render(
      <>
        <Thread threadId="1" />
        <Thread threadId="2" />
      </>,
    );
    const [b1, b2] = [...container.querySelectorAll('button')].filter((b) => b.textContent === 'Resolve conversation');
    await click(b1!);
    await settle();
    await click(b2!);
    await settle();
    const bodies = gqlBodies();
    expect(bodies.filter((b) => b.query.includes('reviewThreads'))).toHaveLength(1);
    expect(bodies.filter((b) => b.query.includes('resolveReviewThread')).map((b) => b.variables.input.threadId)).toEqual(['PRRT_1', 'PRRT_2']);
    expect(usePr.getState().threads.every((t) => t.isResolved)).toBe(true);
  });

  it('reply posts a REST reply, or a review reply while a review is pending', async () => {
    usePr.getState().setThreads([thread('1')]);
    fetchMock.mockResolvedValue(json(201, { id: 11, node_id: 'PRRC_11' }));
    await render(<Thread threadId="1" />);
    await click(button('Reply…')!);
    const ta = container.querySelector('textarea')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(ta, 'thanks');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(button('Reply')!);
    await settle();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.github.com/repos/dangh/pierre-sandbox/pulls/1/comments/10/replies');
    expect(JSON.parse(init.body)).toEqual({ body: 'thanks' });
    expect(usePr.getState().threads[0]!.comments.map((c) => c.databaseId)).toEqual([10, 11]);
    expect(usePr.getState().drafts.has(draftKey.reply('1'))).toBe(false);

    // Pending review: addPullRequestReviewThreadReply with the cached thread node id.
    usePr.getState().setPendingReview({ nodeId: 'PRR_1', count: 0 });
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const q = JSON.parse(String(init.body)).query as string;
      if (q.includes('reviewThreads'))
        return json(200, {
          data: { repository: { pullRequest: { reviewThreads: { nodes: [{ id: 'PRRT_1', comments: { nodes: [{ databaseId: 10 }] } }], pageInfo: { hasNextPage: false } } } } },
        });
      return json(200, { data: { addPullRequestReviewThreadReply: { comment: { id: 'PRRC_12', databaseId: 12 } } } });
    });
    await click(button('Reply…')!);
    const ta2 = container.querySelector('textarea')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(ta2, 'in review');
      ta2.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(button('Add review comment')!);
    await settle();
    const reply = gqlBodies().find((b) => b.query.includes('addPullRequestReviewThreadReply'))!;
    expect(reply.variables.input).toEqual({ pullRequestReviewId: 'PRR_1', pullRequestReviewThreadId: 'PRRT_1', body: 'in review' });
    expect(usePr.getState().pendingReview!.count).toBe(1);
  });

  it('edit and delete own comments', async () => {
    usePr.getState().setThreads([thread('1', { comments: [comment(10), comment(11)] })]);
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) =>
      init.method === 'DELETE' ? new Response(null, { status: 204 }) : json(200, { id: 10, node_id: 'PRRC_10' }),
    );
    await render(<Thread threadId="1" />);
    await click(container.querySelector('[data-comment-id="10"]')!.querySelector('button')!); // Edit
    const ta = container.querySelector('textarea')!;
    expect(ta.value).toBe('body 10');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(ta, 'edited');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(button('Update comment')!);
    await settle();
    expect(fetchMock.mock.calls[0]![0]).toBe('https://api.github.com/repos/dangh/pierre-sandbox/pulls/comments/10');
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ body: 'edited' });
    expect(usePr.getState().threads[0]!.comments[0]!.body).toBe('edited');
    expect(container.querySelector('[data-comment-id="10"] .markdown-body')!.textContent).toBe('edited');

    const c11 = container.querySelector('[data-comment-id="11"]')!;
    await click([...c11.querySelectorAll('button')].find((b) => b.textContent === 'Delete')!);
    await click([...c11.querySelectorAll('button')].find((b) => b.textContent === 'Delete')!); // confirm
    await settle();
    expect(fetchMock.mock.calls[1]![1].method).toBe('DELETE');
    expect(usePr.getState().threads[0]!.comments.map((c) => c.databaseId)).toEqual([10]);
  });
});

describe('Esc', () => {
  it('closes an empty composer, but not while the token prompt is open (the prompt takes it)', async () => {
    const key = openComposer(targetFromRange('src/a.ts', { start: 2, side: 'additions', end: 2 }));
    await render(
      <>
        <Composer draftKey={key} mode="new" />
        <TokenPromptHost />
      </>,
    );
    const ta = container.querySelector('textarea')!;
    const pending = requireToken('dangh', 'comment', { force: true });
    pending.catch(() => undefined);
    await settle();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => void ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    await settle();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(usePr.getState().drafts.has(key)).toBe(true);
    await act(async () => void ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(usePr.getState().drafts.has(key)).toBe(false);
  });
});

describe('sanitizeHtml', () => {
  it('keeps GitHub markup, drops active content', () => {
    expect(sanitizeHtml('<p dir="auto">hi <a href="/dangh">@dangh</a></p>')).toBe('<p dir="auto">hi <a href="/dangh">@dangh</a></p>');
    expect(sanitizeHtml('<img src="x" onerror="alert(1)"><script>alert(1)</script><a href="javascript:alert(1)">x</a>')).toBe('<img src="x"><a>x</a>');
    expect(sanitizeHtml('<input type="checkbox" checked=""> <input type="text">')).toBe('<input type="checkbox" checked="" disabled=""> ');
  });
});
