// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://github.com/react/react/pull/37778#pierre"}
import { describe, expect, it, vi } from 'vitest';
import { createBridgeImpl } from '../../src/page/bridge';
import { createRoutePrefetch, prefetchPath, startWhenHeadReady } from '../../src/page/prefetch';

const ROUTE = '/react/react/pull/37778/changes';
/** The viewer's first load (`loadPr(…, {initial: true})` → `fetchPrData(…, {prefetched: true})`). */
const FIRST = { dataRouter: true, prefetched: true };

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
}

/** A bridge over a fake fetch whose responses the test releases one by one. */
function setup() {
  const calls: { url: string; method: string; headers: Record<string, string> }[] = [];
  const responses: ReturnType<typeof deferred<Response>>[] = [];
  const fetch = vi.fn((url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? 'GET', headers: (init?.headers ?? {}) as Record<string, string> });
    const d = deferred<Response>();
    responses.push(d);
    return d.promise;
  }) as unknown as typeof globalThis.fetch;
  let clock = 0;
  const base = createBridgeImpl({ doc: document, fetch });
  const prefetch = createRoutePrefetch(base, ROUTE, { ttlMs: 10_000, now: () => clock });
  const respond = (i: number, body: unknown, status = 200) =>
    responses[i]!.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
  return { calls, prefetch, respond, tick: (ms: number) => (clock += ms) };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('prefetchPath', () => {
  it('is the route path of a PR page showing Pierre, on any PR page', () => {
    expect(prefetchPath('https://github.com/react/react/pull/37778#pierre')).toBe(ROUTE);
    expect(prefetchPath('https://github.com/react/react/pull/37778/files#pierre')).toBe(ROUTE);
    expect(prefetchPath('https://github.com/react/react/pull/37778/changes?w=1#pierre')).toBe(ROUTE);
  });

  it('is null without #pierre or off a PR page', () => {
    expect(prefetchPath('https://github.com/react/react/pull/37778')).toBeNull();
    expect(prefetchPath('https://github.com/react/react/pull/37778#discussion')).toBeNull();
    expect(prefetchPath('https://github.com/react/react/issues/1#pierre')).toBeNull();
    expect(prefetchPath('https://gist.github.com/react/react/pull/1#pierre')).toBeNull();
  });
});

describe('createRoutePrefetch', () => {
  it('serves the viewer route request from the prefetch in flight (one network request)', async () => {
    const { calls, prefetch, respond } = setup();
    prefetch.start();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`https://github.com${ROUTE}`);
    const viewer = prefetch.impl.get(ROUTE, {}, FIRST);
    respond(0, { payload: { ok: 1 } });
    await expect(viewer).resolves.toEqual({ data: { payload: { ok: 1 } }, link: null });
    expect(calls).toHaveLength(1);
  });

  it('serves a remounted viewer too while fresh, then goes to the network after the TTL', async () => {
    const { calls, prefetch, respond, tick } = setup();
    prefetch.start();
    respond(0, { n: 1 });
    await flush();
    tick(5_000);
    await expect(prefetch.impl.get(ROUTE, {}, FIRST)).resolves.toMatchObject({ data: { n: 1 } });
    await expect(prefetch.impl.get(ROUTE, undefined, FIRST)).resolves.toMatchObject({ data: { n: 1 } });
    expect(calls).toHaveLength(1);
    tick(5_001);
    const later = prefetch.impl.get(ROUTE, {}, FIRST);
    expect(calls).toHaveLength(2);
    respond(1, { n: 2 });
    await expect(later).resolves.toMatchObject({ data: { n: 2 } });
  });

  it('only serves the identical request (other paths, queries or no dataRouter go to the network)', async () => {
    const { calls, prefetch, respond } = setup();
    prefetch.start();
    respond(0, { n: 1 });
    await flush();
    void prefetch.impl.get(ROUTE, { w: '1' }, FIRST);
    void prefetch.impl.get(ROUTE, {}, {});
    void prefetch.impl.get('/react/react/pull/1/changes', {}, FIRST);
    void prefetch.impl.get(`/react/react/pull/37778/page_data/diff_entries`, { paths: 'a' });
    expect(calls).toHaveLength(5);
  });

  it('serves only the first load: a later route read (thread refresh after a token write) goes to GitHub while fresh', async () => {
    const { calls, prefetch, respond } = setup();
    prefetch.start();
    respond(0, { n: 1 });
    await flush();
    // e.g. a comment posted through api.github.com, then scheduleRefresh → refreshThreads → fetchRoute
    const refresh = prefetch.impl.get(ROUTE, {}, { dataRouter: true });
    expect(calls).toHaveLength(2);
    expect(calls[1]!.headers['X-GitHub-App-Type']).toBe('dataRouter');
    respond(1, { n: 2 });
    await expect(refresh).resolves.toMatchObject({ data: { n: 2 } });
    // The flag only selects the cache: a request that is not served goes out as a plain dataRouter request.
    void prefetch.impl.get(ROUTE, { w: '1' }, FIRST);
    expect(calls[2]!.headers['X-GitHub-App-Type']).toBe('dataRouter');
  });

  it('never serves a failed prefetch: a waiting viewer makes its own request', async () => {
    const { calls, prefetch, respond } = setup();
    prefetch.start();
    const viewer = prefetch.impl.get(ROUTE, {}, FIRST);
    respond(0, { error: 'boom' }, 500);
    await flush();
    await flush();
    expect(calls).toHaveLength(2);
    respond(1, { n: 2 });
    await expect(viewer).resolves.toMatchObject({ data: { n: 2 } });
    // And later requests skip it too.
    void prefetch.impl.get(ROUTE, {}, FIRST);
    expect(calls).toHaveLength(3);
  });

  it('is dropped by any write through the bridge', async () => {
    const { calls, prefetch, respond } = setup();
    prefetch.start();
    respond(0, { n: 1 });
    await flush();
    void Promise.resolve(prefetch.impl.markViewed('react', 'react', 37778, 'a.ts')).catch(() => undefined);
    expect(calls[1]!.method).toBe('POST');
    void prefetch.impl.get(ROUTE, {}, FIRST);
    expect(calls).toHaveLength(3);
    expect(calls[2]!.url).toBe(`https://github.com${ROUTE}`);
  });

  it('reads (getText, preview) keep it', async () => {
    const { calls, prefetch, respond } = setup();
    prefetch.start();
    respond(0, { n: 1 });
    await flush();
    void Promise.resolve(prefetch.impl.getText(`https://github.com/react/react/raw/${'a'.repeat(40)}/a.ts`)).catch(() => undefined);
    void prefetch.impl.get(ROUTE, {}, FIRST);
    expect(calls).toHaveLength(2);
  });

  it('start() requests once', () => {
    const { calls, prefetch } = setup();
    prefetch.start();
    prefetch.start();
    expect(calls).toHaveLength(1);
  });
});

describe('diff_entries sharing during the page load (remounted viewer)', () => {
  const DIFFS = '/react/react/pull/37778/page_data/diff_entries';
  const q = (paths: string) => ({ raw: `paths=${paths}&w=0&range=${'a'.repeat(40)}` });

  it('an identical request in flight or just answered is shared; another chunk is not', async () => {
    const { calls, prefetch, respond, tick } = setup();
    const first = prefetch.impl.get(DIFFS, q('a.ts'));
    const again = prefetch.impl.get(DIFFS, q('a.ts')); // the remounted viewer's same first chunk
    void prefetch.impl.get(DIFFS, q('b.ts'));
    expect(calls).toHaveLength(2);
    respond(0, [{ path: 'a.ts' }]);
    await expect(first).resolves.toEqual({ data: [{ path: 'a.ts' }], link: null });
    await expect(again).resolves.toEqual({ data: [{ path: 'a.ts' }], link: null });
    tick(5_000);
    void prefetch.impl.get(DIFFS, q('a.ts'));
    expect(calls).toHaveLength(2);
    tick(5_001); // past the TTL: a new request
    void prefetch.impl.get(DIFFS, q('a.ts'));
    expect(calls).toHaveLength(3);
  });

  it('a failed request is not shared afterwards, and requests without a pinned range are never shared', async () => {
    const { calls, prefetch, respond } = setup();
    const failing = prefetch.impl.get(DIFFS, q('a.ts'));
    respond(0, { error: 'boom' }, 500);
    await expect(failing).rejects.toMatchObject({ status: 500 });
    void prefetch.impl.get(DIFFS, q('a.ts'));
    expect(calls).toHaveLength(2);
    void prefetch.impl.get(DIFFS, { raw: 'paths=a.ts&w=0' });
    void prefetch.impl.get(DIFFS, { raw: 'paths=a.ts&w=0' });
    expect(calls).toHaveLength(4);
  });
});

describe('startWhenHeadReady', () => {
  it('starts at once when the head is parsed', () => {
    const start = vi.fn();
    startWhenHeadReady(document, start);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('waits for <body> while the document is still loading', async () => {
    const doc = document.implementation.createHTMLDocument('');
    doc.documentElement.removeChild(doc.body);
    Object.defineProperty(doc, 'readyState', { value: 'loading', configurable: true });
    const start = vi.fn();
    startWhenHeadReady(doc, start);
    expect(start).not.toHaveBeenCalled();
    doc.head.append(doc.createElement('meta'));
    await flush();
    expect(start).not.toHaveBeenCalled();
    doc.documentElement.append(doc.createElement('body'));
    await flush();
    expect(start).toHaveBeenCalledTimes(1);
  });
});
