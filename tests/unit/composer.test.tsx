// @vitest-environment jsdom
import { getSingularPatch } from '@pierre/diffs';
import { act, Profiler } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setToken, setTokenStorage, type TokenStorageArea } from '../../src/viewer/auth/tokens';
import type { FileSummary, PrData } from '../../src/viewer/github/private';
import { createAnnotationSource } from '../../src/viewer/state/annotations';
import { openComposer, targetFromRange } from '../../src/viewer/state/compose';
import { ItemSync, type PierreItem } from '../../src/viewer/state/items';
import { refreshThreads, resetReviewCaches } from '../../src/viewer/state/review';
import { session } from '../../src/viewer/state/session';
import { usePr } from '../../src/viewer/state/store';
import { Composer } from '../../src/viewer/ui/Composer';
import { TokenPromptHost } from '../../src/viewer/ui/TokenPrompt';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const OLD_TOKEN = 'ghp_ComposerOldToken0123456789';
const NEW_TOKEN = 'ghp_ComposerNewToken0123456789';

const file = (path: string): FileSummary => ({
  path,
  digest: `d-${path}`,
  status: 'modified',
  additions: 2,
  deletions: 1,
  viewed: false,
  tooLarge: false,
  binary: false,
});

const pr: PrData = {
  ref: { owner: 'dangh', repo: 'pierre-sandbox', number: 1, page: 'changes' },
  author: 'dangh',
  baseOid: 'b'.repeat(40),
  headOid: 'h'.repeat(40),
  commits: [],
  files: [file('src/a.ts'), file('src/b.ts')],
  viewer: { login: 'dangh', canApplySuggestion: true, canReview: true },
  threadMarkers: { threads: [], byPath: {} },
};

const patch = ['diff --git a/src/a.ts b/src/a.ts', '--- a/src/a.ts', '+++ b/src/a.ts', '@@ -1,3 +1,4 @@', ' one', '-two', '+TWO', '+three', ' four', ''].join('\n');

function fakeArea(): TokenStorageArea {
  const data: Record<string, unknown> = {};
  return {
    get: async (key) => (key in data ? { [key]: structuredClone(data[key]) } : {}),
    set: async (items) => void Object.assign(data, structuredClone(items)),
  };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

let root: Root;
let container: HTMLDivElement;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  setTokenStorage(fakeArea());
  await setToken('dangh', OLD_TOKEN, { login: 'dangh' });
  resetReviewCaches();
  session.rpc = undefined;
  const s = usePr.getState();
  s.setPr(pr);
  s.setThreads([]);
  s.setPendingReview(null);
  usePr.setState({ drafts: new Map() });
  s.applyLoads([{ path: 'src/a.ts', summary: pr.files[0]!, load: { status: 'loaded' }, diff: getSingularPatch(patch) }]);
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
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const textarea = () => container.querySelector('textarea')!;
const button = (name: string) => [...document.querySelectorAll('button')].find((b) => b.textContent === name)!;
const click = (el: HTMLElement) => act(async () => el.click());
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));

function setValue(el: HTMLTextAreaElement | HTMLInputElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

async function renderComposer(key: string, onRender?: () => void) {
  await act(async () =>
    root.render(
      <>
        <Profiler id="composer" onRender={() => onRender?.()}>
          <Composer draftKey={key} mode="new" />
        </Profiler>
        <TokenPromptHost />
      </>,
    ),
  );
}

const posts = () => fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith('/pulls/1/comments') && init.method === 'POST');

describe('Composer', () => {
  it('typing 2,000 characters makes at most 10 store writes, no CodeView item updates and no re-renders', async () => {
    const key = openComposer(targetFromRange('src/a.ts', { start: 2, side: 'additions', end: 2 }));
    // The DiffPane wiring: every store change runs ItemSync against the CodeView handle.
    const sync = new ItemSync(createAnnotationSource());
    sync.seed(usePr.getState());
    const updates: PierreItem[] = [];
    const unsubscribeSync = usePr.subscribe(() => sync.sync(usePr.getState(), { updateItem: (i) => (updates.push(i), true) }));
    let renders = 0;
    await renderComposer(key, () => renders++);
    const rendersBefore = renders;
    let writes = 0;
    const unsubscribe = usePr.subscribe(() => writes++);

    vi.useFakeTimers();
    const el = textarea();
    el.focus();
    let text = '';
    for (let i = 0; i < 2000; i++) {
      text += String.fromCharCode(97 + (i % 26));
      setValue(el, text);
      vi.advanceTimersByTime(20); // ~50 characters per second, continuous
    }
    vi.advanceTimersByTime(300);
    el.blur();
    vi.useRealTimers();
    unsubscribe();
    unsubscribeSync();

    expect(writes).toBeGreaterThanOrEqual(1);
    expect(writes).toBeLessThanOrEqual(10);
    expect(updates).toHaveLength(0);
    expect(renders).toBe(rendersBefore);
    expect(usePr.getState().drafts.get(key)!.body).toBe(text);
    expect(el.value).toBe(text);
  });

  it('keeps draft on failure: a validation error keeps the text, shows the message, Retry re-sends', async () => {
    const key = openComposer(targetFromRange('src/a.ts', { start: 2, side: 'additions', end: 3 }));
    await renderComposer(key);
    fetchMock.mockResolvedValueOnce(json(422, { message: 'Validation Failed', errors: [{ message: 'line must be part of the diff' }] }));
    fetchMock.mockResolvedValueOnce(json(201, { id: 555, node_id: 'PRRC_555' }));

    setValue(textarea(), 'Please rename this');
    await click(button('Add single comment'));
    await settle();

    expect(textarea().value).toBe('Please rename this');
    expect(container.querySelector('[role="alert"]')!.textContent).toContain('line must be part of the diff');
    expect(posts()).toHaveLength(1);
    const sent = JSON.parse(posts()[0]![1].body);
    expect(sent).toEqual({
      body: 'Please rename this',
      commit_id: pr.headOid,
      path: 'src/a.ts',
      line: 3,
      side: 'RIGHT',
      start_line: 2,
      start_side: 'RIGHT',
    });
    expect(usePr.getState().drafts.get(key)!.body).toBe('Please rename this');

    await click(button('Retry'));
    await settle();
    expect(posts()).toHaveLength(2);
    expect(JSON.parse(posts()[1]![1].body).body).toBe('Please rename this');
    // Posted: the draft is gone and the comment shows as a (provisional) thread at the line.
    expect(usePr.getState().drafts.has(key)).toBe(false);
    const t = usePr.getState().threads.find((x) => x.comments[0]?.databaseId === 555)!;
    expect(t).toMatchObject({ path: 'src/a.ts', side: 'additions', line: 3, startLine: 2, subject: 'line' });
    expect(t.comments[0]!.body).toBe('Please rename this');
  });

  it('an auth rejection opens the TokenPrompt; saving a token re-sends without retyping', async () => {
    const key = openComposer(targetFromRange('src/a.ts', { start: 2, side: 'additions', end: 2 }));
    await renderComposer(key);
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      const auth = (init.headers as Record<string, string>).Authorization;
      if (url.endsWith('/user')) return json(200, { login: 'dangh' }, { 'X-OAuth-Scopes': 'repo' });
      if (auth === `Bearer ${OLD_TOKEN}`) return json(401, { message: 'Bad credentials' });
      return json(201, { id: 777, node_id: 'PRRC_777' });
    });

    setValue(textarea(), 'Looks good');
    await click(button('Add single comment'));
    await settle();

    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog).not.toBeNull();
    expect(textarea().value).toBe('Looks good');
    const field = dialog.querySelector<HTMLInputElement>('input[type="password"]')!;
    await act(async () => setValue(field, NEW_TOKEN));
    await click(button('Save token'));
    await settle();
    await settle();

    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(posts()).toHaveLength(2);
    expect((posts()[1]![1].headers as Record<string, string>).Authorization).toBe(`Bearer ${NEW_TOKEN}`);
    expect(JSON.parse(posts()[1]![1].body).body).toBe('Looks good');
    expect(usePr.getState().drafts.has(key)).toBe(false);
  });

  it('keeps text typed just before the composer unmounts (virtualized away), within the debounce', async () => {
    const key = openComposer(targetFromRange('src/a.ts', { start: 2, side: 'additions', end: 2 }));
    await renderComposer(key);
    setValue(textarea(), 'typed, then scrolled away');
    await act(async () => root.render(<TokenPromptHost />)); // unmount the composer at once (< 300 ms)
    expect(container.querySelector('textarea')).toBeNull();
    expect(usePr.getState().drafts.get(key)!.body).toBe('typed, then scrolled away');
  });

  it('"Insert suggestion" for a 2-line selection produces the exact fenced block', async () => {
    const key = openComposer(targetFromRange('src/a.ts', { start: 2, side: 'additions', end: 3, endSide: 'additions' }));
    await renderComposer(key);
    await click(button('Insert suggestion'));
    expect(textarea().value).toBe('```suggestion\nTWO\nthree\n```');
  });

  it('with a pending review the primary action is "Add review comment" (startReview not needed)', async () => {
    usePr.getState().setPendingReview({ nodeId: 'PRR_1', count: 1 });
    const key = openComposer(targetFromRange('src/a.ts', { start: 2, side: 'additions', end: 2 }));
    await renderComposer(key);
    expect(button('Start a review')).toBeUndefined();
    fetchMock.mockImplementation(async () =>
      json(200, { data: { addPullRequestReviewThread: { thread: { id: 'PRRT_1', comments: { nodes: [{ id: 'PRRC_9', databaseId: 9 }] } } } } }),
    );
    setValue(textarea(), 'In review');
    await act(async () => {
      textarea().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
    });
    await settle();
    const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body));
    expect(bodies).toHaveLength(1);
    expect(bodies[0].query).toContain('addPullRequestReviewThread');
    expect(bodies[0].variables.input).toMatchObject({ pullRequestReviewId: 'PRR_1', path: 'src/a.ts', line: 2, side: 'RIGHT', body: 'In review' });
    expect(usePr.getState().pendingReview).toEqual({ nodeId: 'PRR_1', count: 2 });
    const t = usePr.getState().threads.find((x) => x.comments[0]?.databaseId === 9)!;
    expect(t.comments[0]!.state).toBe('pending');
  });

  it('closing a new-thread composer (posted or cancelled) releases the line selection', async () => {
    const clearSelectedLines = vi.fn();
    session.codeView = { clearSelectedLines } as unknown as typeof session.codeView;
    try {
      const key = openComposer(targetFromRange('src/a.ts', { start: 2, side: 'additions', end: 3 }));
      await renderComposer(key);
      await click(button('Cancel'));
      expect(usePr.getState().drafts.has(key)).toBe(false);
      expect(clearSelectedLines).toHaveBeenCalledTimes(1);

      const key2 = openComposer(targetFromRange('src/a.ts', { start: 4, side: 'additions', end: 4 }));
      await renderComposer(key2);
      fetchMock.mockResolvedValueOnce(json(201, { id: 1, node_id: 'PRRC_1' }));
      setValue(textarea(), 'posted');
      await click(button('Add single comment'));
      await settle();
      expect(clearSelectedLines).toHaveBeenCalledTimes(2);
    } finally {
      session.codeView = undefined;
    }
  });
});

describe('Preview', () => {
  it('renders GitHub\'s /preview HTML with the context suggestions need (R§6)', async () => {
    usePr.getState().setPr({ ...pr, databaseId: 4897736474, repositoryId: 1422999940 });
    const key = openComposer(targetFromRange('src/a.ts', { start: 2, side: 'additions', end: 3 }));
    const calls: unknown[][] = [];
    session.rpc = { call: (async (...args: unknown[]) => (calls.push(args), '<p>Hi <script>x()</script></p>')) as never };
    try {
      await renderComposer(key);
      setValue(textarea(), 'Hi');
      await click(button('Preview'));
      await settle();
    } finally {
      session.rpc = undefined;
    }
    expect(calls).toEqual([
      [
        'preview',
        'Hi',
        { owner: 'dangh', repo: 'pierre-sandbox', number: 1, baseOid: pr.baseOid, headOid: pr.headOid, issueId: 4897736474, repositoryId: 1422999940, path: 'src/a.ts', line: 3, startLine: 2 },
      ],
    ]);
    expect(container.querySelector('.composer-preview .markdown-body')!.innerHTML).toBe('<p>Hi </p>');
    expect(textarea().value).toBe('Hi'); // the textarea stays mounted (hidden) with its text
    await click(button('Write'));
    expect(textarea().hidden).toBe(false);
  });
});

describe('refreshThreads', () => {
  it("refetches with the route, so the viewer's pending review threads (only in the route's markers) stay", async () => {
    const pendingThread = {
      id: '99',
      subjectType: 'LINE',
      isResolved: false,
      viewerCanReply: true,
      commentsData: {
        comments: [{ databaseId: 990, id: 'PRRC_990', body: 'pending one', bodyHTML: '<p>pending one</p>', bodyVersion: 'v', createdAt: '', state: 'pending', author: { login: 'dangh', avatarUrl: '' } }],
      },
    };
    const calls: string[] = [];
    session.rpc = {
      call: (async (method: string, path: string) => {
        calls.push(`${method} ${path}`);
        if (path.endsWith('/changes'))
          return {
            data: {
              payload: {
                pullRequestsChangesRoute: {
                  user: { currentUserLogin: 'dangh' },
                  diffSummaries: [{ path: 'src/a.ts', markersMap: { R3: { threads: [{ id: '99' }] } } }],
                  markers: { threads: { '99': pendingThread } },
                },
              },
            },
            link: null,
          };
        if (path.endsWith('/page_data/threads')) return { data: { threads: [] }, link: null };
        return { data: [], link: null };
      }) as never,
    };
    try {
      await refreshThreads();
    } finally {
      session.rpc = undefined;
    }
    expect(calls).toContain('get /dangh/pierre-sandbox/pull/1/changes');
    const t = usePr.getState().threads.find((x) => x.id === '99')!;
    expect(t).toMatchObject({ path: 'src/a.ts', side: 'additions', line: 3 });
    expect(t.comments[0]).toMatchObject({ body: 'pending one', state: 'pending' });
  });
});
