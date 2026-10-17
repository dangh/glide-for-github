// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://github.com/dangh/pierre-sandbox/pull/1/changes"}
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBridgeImpl, githubHeaders, startBridge } from '../../src/page/bridge';
import { BridgeError, createRpcClient, type BridgeMethods } from '../../src/shared/rpc';

const SHA = 'a'.repeat(40);

function setMeta(name: string, content: string) {
  let m = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!m) {
    m = document.createElement('meta');
    m.name = name;
    document.head.append(m);
  }
  m.content = content;
}

type FetchCall = { url: string; init: RequestInit };
function fakeFetch(respond: () => Response = () => json({ ok: true })) {
  const calls: FetchCall[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return respond();
  });
  return { fn: fn as unknown as typeof fetch, calls };
}
const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init });

const headersOf = (c: FetchCall) => c.init.headers as Record<string, string>;

beforeEach(() => {
  setMeta('fetch-nonce', 'nonce-1');
  setMeta('release', 'release-1');
});
afterEach(() => {
  document.head.innerHTML = '';
  vi.restoreAllMocks();
});

describe('githubHeaders', () => {
  it('sends the verified-fetch header set from the page meta tags', () => {
    expect(githubHeaders(document)).toEqual({
      'GitHub-Verified-Fetch': 'true',
      'X-Requested-With': 'XMLHttpRequest',
      'X-Fetch-Nonce': 'nonce-1',
      'X-GitHub-Client-Version': 'release-1',
      'GitHub-Is-React': 'true',
    });
  });

  it('reads the meta values fresh on every call', () => {
    expect(githubHeaders(document)['X-Fetch-Nonce']).toBe('nonce-1');
    setMeta('fetch-nonce', 'nonce-2');
    setMeta('release', 'release-2');
    const h = githubHeaders(document);
    expect(h['X-Fetch-Nonce']).toBe('nonce-2');
    expect(h['X-GitHub-Client-Version']).toBe('release-2');
  });

  it('omits headers whose meta tag is missing', () => {
    document.head.innerHTML = '';
    const h = githubHeaders(document);
    expect('X-Fetch-Nonce' in h).toBe(false);
    expect('X-GitHub-Client-Version' in h).toBe(false);
  });
});

describe('bridge get: allowlist', () => {
  const allowed = [
    '/dangh/pierre-sandbox/pull/1',
    '/dangh/pierre-sandbox/pull/1/changes',
    '/dangh/pierre-sandbox/pull/12/page_data/diff_entries',
    '/dangh/pierre-sandbox/pull/1/page_data/diff_entry_lines',
    '/dangh/pierre-sandbox/pull/1/page_data/threads',
    '/dangh/pierre-sandbox/pull/1/page_data/thread_previews',
    '/dangh/pierre-sandbox/pull/1/page_data/thread_preview_positioning',
    '/dangh/pierre-sandbox/pull/1/page_data/review_menu',
  ];
  it.each(allowed)('accepts %s', async (path) => {
    const { fn, calls } = fakeFetch();
    const bridge = createBridgeImpl({ doc: document, fetch: fn });
    await expect(bridge.get(path)).resolves.toMatchObject({ data: { ok: true } });
    expect(calls[0]!.url).toBe('https://github.com' + path);
  });

  const rejected = [
    '/dangh/pierre-sandbox/settings',
    '/dangh/pierre-sandbox/pull/1/page_data/create_review_comment',
    '/dangh/pierre-sandbox/pull/1/page_data/apply_review_suggestions',
    '/dangh/pierre-sandbox/pull/1/page_data/file_tree',
    '/dangh/pierre-sandbox/pull/x/changes',
    '/dangh/pierre-sandbox/pull/1/changes/extra',
    '/dangh/pierre-sandbox/pull/1/changes?x=1',
    '/dangh/pierre-sandbox/pull/1/changes#frag',
    '/dangh/pierre-sandbox/pull/1/changes\n',
    '/../pierre-sandbox/pull/1/changes',
    '/./pierre-sandbox/pull/1/changes',
    '//evil.example/x/pull/1/changes',
    'https://evil.example/dangh/pierre-sandbox/pull/1/changes',
    'https://github.com/dangh/pierre-sandbox/pull/1/changes',
    'dangh/pierre-sandbox/pull/1/changes',
    '/preview',
  ];
  it.each(rejected)('rejects %j without calling fetch', async (path) => {
    const { fn } = fakeFetch();
    const bridge = createBridgeImpl({ doc: document, fetch: fn });
    await expect(bridge.get(path)).rejects.toMatchObject({ status: 0, code: 'not_allowed' });
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('bridge get: request building', () => {
  const P = '/dangh/pierre-sandbox/pull/1/page_data/diff_entries';

  it('sends GitHub headers, Accept json, same-origin credentials, GET', async () => {
    const { fn, calls } = fakeFetch();
    await createBridgeImpl({ doc: document, fetch: fn }).get(P);
    const c = calls[0]!;
    expect(c.init.method).toBe('GET');
    expect(c.init.credentials).toBe('same-origin');
    expect(headersOf(c)).toMatchObject({ Accept: 'application/json', 'X-Fetch-Nonce': 'nonce-1' });
    expect('X-GitHub-App-Type' in headersOf(c)).toBe(false);
  });

  it('adds X-GitHub-App-Type: dataRouter when opts.dataRouter is set', async () => {
    const { fn, calls } = fakeFetch();
    await createBridgeImpl({ doc: document, fetch: fn }).get('/dangh/pierre-sandbox/pull/1/changes', {}, { dataRouter: true });
    expect(headersOf(calls[0]!)['X-GitHub-App-Type']).toBe('dataRouter');
  });

  it('uses the meta values current at call time', async () => {
    const { fn, calls } = fakeFetch();
    const bridge = createBridgeImpl({ doc: document, fetch: fn });
    await bridge.get(P);
    setMeta('fetch-nonce', 'nonce-2');
    await bridge.get(P);
    expect(headersOf(calls[0]!)['X-Fetch-Nonce']).toBe('nonce-1');
    expect(headersOf(calls[1]!)['X-Fetch-Nonce']).toBe('nonce-2');
  });

  it('builds the query with URLSearchParams semantics; arrays repeat the key', async () => {
    const { fn, calls } = fakeFetch();
    await createBridgeImpl({ doc: document, fetch: fn }).get(P, {
      w: '1',
      'context_line_ranges[]': ['{"start":1,"end":3}', '{"start":5,"end":9}'],
    });
    const url = new URL(calls[0]!.url);
    expect(url.searchParams.get('w')).toBe('1');
    expect(url.searchParams.getAll('context_line_ranges[]')).toEqual(['{"start":1,"end":3}', '{"start":5,"end":9}']);
  });

  it('appends {raw} verbatim', async () => {
    const { fn, calls } = fakeFetch();
    await createBridgeImpl({ doc: document, fetch: fn }).get(P, { raw: 'paths=a%2520b.ts%2Cc.ts&w=0' });
    expect(calls[0]!.url).toBe('https://github.com' + P + '?paths=a%2520b.ts%2Cc.ts&w=0');
  });

  it.each(['paths=a#frag', 'paths=a\nb', 'paths=a\rb'])('rejects {raw} %j', async (raw) => {
    const { fn } = fakeFetch();
    await expect(createBridgeImpl({ doc: document, fetch: fn }).get(P, { raw })).rejects.toMatchObject({
      status: 0,
      code: 'bad_request',
    });
    expect(fn).not.toHaveBeenCalled();
  });

  it('adds no "?" for an empty query', async () => {
    const { fn, calls } = fakeFetch();
    await createBridgeImpl({ doc: document, fetch: fn }).get(P, {});
    expect(calls[0]!.url).toBe('https://github.com' + P);
    await createBridgeImpl({ doc: document, fetch: fn }).get(P, { raw: '' });
    expect(calls[1]!.url).toBe('https://github.com' + P);
  });
});

describe('bridge get: responses', () => {
  const P = '/dangh/pierre-sandbox/pull/1/page_data/threads';

  it('returns parsed JSON plus the Link header', async () => {
    const link = '<https://github.com/x?after=abc>; rel="next"';
    const { fn } = fakeFetch(() => json({ threads: [] }, { headers: { Link: link } }));
    await expect(createBridgeImpl({ doc: document, fetch: fn }).get(P)).resolves.toEqual({
      data: { threads: [] },
      link,
    });
  });

  it('returns link: null when there is no Link header', async () => {
    const { fn } = fakeFetch(() => json([1]));
    await expect(createBridgeImpl({ doc: document, fetch: fn }).get(P)).resolves.toEqual({ data: [1], link: null });
  });

  it('rejects non-2xx with GitHub\'s JSON error', async () => {
    const { fn } = fakeFetch(() => json({ error: 'nope', code: 'SOME_CODE' }, { status: 422 }));
    await expect(createBridgeImpl({ doc: document, fetch: fn }).get(P)).rejects.toEqual({
      status: 422,
      code: 'SOME_CODE',
      message: 'nope',
    });
  });

  it('rejects non-2xx HTML bodies with a generic message and no code', async () => {
    const { fn } = fakeFetch(() => new Response('<html>oops</html>', { status: 502 }));
    const err = await Promise.resolve().then(() => createBridgeImpl({ doc: document, fetch: fn }).get(P)).catch((e: unknown) => e);
    expect(err).toEqual({ status: 502, message: 'HTTP 502' });
  });

  it('rejects a 2xx non-JSON body as bad_json', async () => {
    const { fn } = fakeFetch(() => new Response('<html/>', { status: 200 }));
    await expect(createBridgeImpl({ doc: document, fetch: fn }).get(P)).rejects.toMatchObject({
      status: 200,
      code: 'bad_json',
    });
  });

  it('maps a network failure to status 0 / network', async () => {
    const fn = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    await expect(createBridgeImpl({ doc: document, fetch: fn }).get(P)).rejects.toMatchObject({
      status: 0,
      code: 'network',
    });
  });
});

describe('bridge getText', () => {
  it.each([
    `https://github.com/dangh/pierre-sandbox/raw/${SHA}/src/a.ts`,
    `https://github.com/dangh/pierre-sandbox/raw/${SHA}/dir/with%20space/b.md`,
  ])('accepts %s', async (url) => {
    const { fn, calls } = fakeFetch(() => new Response('file text'));
    await expect(createBridgeImpl({ doc: document, fetch: fn }).getText(url)).resolves.toBe('file text');
    expect(calls[0]!.url).toBe(url);
    expect(calls[0]!.init.credentials).toBe('same-origin');
    // No custom headers: the 302 to raw.githubusercontent.com must stay a CORS-simple request.
    expect(calls[0]!.init.headers ?? {}).toEqual({});
  });

  it.each([
    'https://evil.example/dangh/pierre-sandbox/raw/' + SHA + '/a.ts',
    'http://github.com/dangh/pierre-sandbox/raw/' + SHA + '/a.ts',
    'https://github.com.evil.example/dangh/pierre-sandbox/raw/' + SHA + '/a.ts',
    'https://user@github.com/dangh/pierre-sandbox/raw/' + SHA + '/a.ts',
    'https://github.com:8443/dangh/pierre-sandbox/raw/' + SHA + '/a.ts',
    'https://raw.githubusercontent.com/dangh/pierre-sandbox/' + SHA + '/a.ts',
    'https://github.com/dangh/pierre-sandbox/blob/' + SHA + '/a.ts',
    'https://github.com/dangh/pierre-sandbox/raw/main/a.ts',
    'https://github.com/dangh/pierre-sandbox/raw/' + SHA + '/',
    'https://github.com/dangh/pierre-sandbox/raw/' + SHA + '/../../../settings',
    'https://github.com/dangh/pierre-sandbox/raw/' + SHA + '/%2e%2e/%2E%2e/settings',
    '/dangh/pierre-sandbox/raw/' + SHA + '/a.ts',
    'not a url',
  ])('rejects %j', async (url) => {
    const { fn } = fakeFetch();
    await expect(createBridgeImpl({ doc: document, fetch: fn }).getText(url)).rejects.toMatchObject({
      status: 0,
      code: 'not_allowed',
    });
    expect(fn).not.toHaveBeenCalled();
  });

  it('rejects non-2xx', async () => {
    const { fn } = fakeFetch(() => new Response('gone', { status: 404 }));
    await expect(
      createBridgeImpl({ doc: document, fetch: fn }).getText(`https://github.com/dangh/pierre-sandbox/raw/${SHA}/a.ts`),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('bridge preview', () => {
  it('POSTs multipart to /preview with the verified-fetch headers and returns the html', async () => {
    const { fn, calls } = fakeFetch(() => new Response('<p>hi</p>'));
    const html = await createBridgeImpl({ doc: document, fetch: fn }).preview('hello **x**', {
      owner: 'dangh',
      repo: 'pierre-sandbox',
      issueId: 777,
      repositoryId: 555,
      number: 1,
      path: 'src/a.ts',
      line: 12,
      baseOid: 'b'.repeat(40),
      headOid: 'c'.repeat(40),
    });
    expect(html).toBe('<p>hi</p>');
    const c = calls[0]!;
    expect(c.url).toBe('https://github.com/preview');
    expect(c.init.method).toBe('POST');
    expect(c.init.credentials).toBe('same-origin');
    const h = headersOf(c);
    expect(h['X-Fetch-Nonce']).toBe('nonce-1');
    expect(h['GitHub-Verified-Fetch']).toBe('true');
    // The browser must set the multipart boundary itself.
    expect(Object.keys(h).map((k) => k.toLowerCase())).not.toContain('content-type');
    expect(Object.keys(h).map((k) => k.toLowerCase())).not.toContain('accept');
    const form = c.init.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(Object.fromEntries(form.entries())).toEqual({
      text: 'hello **x**',
      issue: '777',
      project: '777',
      repository: '555',
      subject_type: 'PullRequest',
      subject: '1',
      path: 'src/a.ts',
      line_number: '12',
      start_commit_oid: 'b'.repeat(40),
      base_commit_oid: 'b'.repeat(40),
      end_commit_oid: 'c'.repeat(40),
    });
  });

  it('sends only the text when the context has just owner/repo', async () => {
    const { fn, calls } = fakeFetch(() => new Response('<p/>'));
    await createBridgeImpl({ doc: document, fetch: fn }).preview('t', { owner: 'dangh', repo: 'pierre-sandbox' });
    expect([...(calls[0]!.init.body as FormData).keys()]).toEqual(['text']);
  });

  it('rejects an owner/repo that is not a plain name', async () => {
    const { fn } = fakeFetch();
    await expect(
      createBridgeImpl({ doc: document, fetch: fn }).preview('t', { owner: '../x', repo: 'y' }),
    ).rejects.toMatchObject({ status: 0, code: 'not_allowed' });
    expect(fn).not.toHaveBeenCalled();
  });

  it('rejects non-2xx', async () => {
    const { fn } = fakeFetch(() => new Response('x', { status: 500 }));
    await expect(
      createBridgeImpl({ doc: document, fetch: fn }).preview('t', { owner: 'o', repo: 'r' }),
    ).rejects.toMatchObject({ status: 500 });
  });
});

describe('bridge applySuggestions', () => {
  const body = {
    owner: 'dangh',
    repo: 'pierre-sandbox',
    number: 1,
    comments: [{ id: 11 }, { id: 12, suggestionIndex: 1 }],
    message: 'Apply suggestions',
    expectedHeadOid: 'd'.repeat(40),
  };

  it('POSTs JSON to apply_review_suggestions with an Idempotency-Key', async () => {
    const { fn, calls } = fakeFetch(() => json({ applied: true }));
    const out = await createBridgeImpl({ doc: document, fetch: fn }).applySuggestions(body, 'key_123-abc');
    expect(out).toEqual({ applied: true });
    const c = calls[0]!;
    expect(c.url).toBe('https://github.com/dangh/pierre-sandbox/pull/1/page_data/apply_review_suggestions');
    expect(c.init.method).toBe('POST');
    expect(c.init.credentials).toBe('same-origin');
    expect(headersOf(c)).toMatchObject({
      'Idempotency-Key': 'key_123-abc',
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Fetch-Nonce': 'nonce-1',
    });
    expect(JSON.parse(c.init.body as string)).toEqual({
      comments: body.comments,
      message: body.message,
      expectedHeadOid: body.expectedHeadOid,
    });
  });

  it('surfaces a 409 HEAD_OID_MISMATCH', async () => {
    const { fn } = fakeFetch(() => json({ code: 'HEAD_OID_MISMATCH' }, { status: 409 }));
    await expect(createBridgeImpl({ doc: document, fetch: fn }).applySuggestions(body, 'k1')).rejects.toMatchObject({
      status: 409,
      code: 'HEAD_OID_MISMATCH',
    });
  });

  it('tolerates an empty 2xx body', async () => {
    const { fn } = fakeFetch(() => new Response(null, { status: 204 }));
    await expect(createBridgeImpl({ doc: document, fetch: fn }).applySuggestions(body, 'k1')).resolves.toBeNull();
  });

  it.each([
    ['owner', { ...body, owner: '../x' }],
    ['repo', { ...body, repo: 'a/b' }],
    ['number', { ...body, number: 0 }],
    ['number', { ...body, number: 1.5 }],
    ['comments', { ...body, comments: [] }],
    ['expectedHeadOid', { ...body, expectedHeadOid: 'main' }],
  ])('rejects a bad %s without calling fetch', async (_name, bad) => {
    const { fn } = fakeFetch();
    await expect(createBridgeImpl({ doc: document, fetch: fn }).applySuggestions(bad, 'k1')).rejects.toMatchObject({
      status: 0,
      code: 'bad_request',
    });
    expect(fn).not.toHaveBeenCalled();
  });

  it.each(['', 'has space', 'a'.repeat(200), 'x\ny'])('rejects the idempotency key %j', async (key) => {
    const { fn } = fakeFetch();
    await expect(createBridgeImpl({ doc: document, fetch: fn }).applySuggestions(body, key)).rejects.toMatchObject({
      status: 0,
      code: 'bad_request',
    });
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('bridge resolveThread / unresolveThread (R§4.6, session fallback)', () => {
  it.each([
    ['resolveThread', 'resolve_thread'],
    ['unresolveThread', 'unresolve_thread'],
  ] as const)('%s POSTs {threadId} to page_data/%s with the verified-fetch headers', async (method, endpoint) => {
    const { fn, calls } = fakeFetch(() => json({ ok: true }));
    const out = await createBridgeImpl({ doc: document, fetch: fn })[method]('dangh', 'pierre-sandbox', 1, '2910292349');
    expect(out).toEqual({ ok: true });
    const c = calls[0]!;
    expect(c.url).toBe(`https://github.com/dangh/pierre-sandbox/pull/1/page_data/${endpoint}`);
    expect(c.init.method).toBe('POST');
    expect(c.init.credentials).toBe('same-origin');
    expect(headersOf(c)).toMatchObject({
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'GitHub-Verified-Fetch': 'true',
      'X-Fetch-Nonce': 'nonce-1',
    });
    expect(JSON.parse(c.init.body as string)).toEqual({ threadId: '2910292349' });
  });

  it('tolerates an empty 2xx body', async () => {
    const { fn } = fakeFetch(() => new Response(null, { status: 204 }));
    await expect(createBridgeImpl({ doc: document, fetch: fn }).resolveThread('dangh', 'pierre-sandbox', 1, '7')).resolves.toBeNull();
  });

  it('rejects non-2xx with GitHub\'s error', async () => {
    const { fn } = fakeFetch(() => json({ error: 'Not authorized' }, { status: 403 }));
    await expect(createBridgeImpl({ doc: document, fetch: fn }).unresolveThread('dangh', 'pierre-sandbox', 1, '7')).rejects.toMatchObject({
      status: 403,
      message: 'Not authorized',
    });
  });

  const good = ['dangh', 'pierre-sandbox', 1, '2910292349'] as const;
  it.each([
    ['owner', ['../x', good[1], good[2], good[3]]],
    ['owner', ['..', good[1], good[2], good[3]]],
    ['repo', [good[0], 'a/b', good[2], good[3]]],
    ['number', [good[0], good[1], 0, good[3]]],
    ['number', [good[0], good[1], 1.5, good[3]]],
    ['number', [good[0], good[1], '1', good[3]]],
    ['threadId', [good[0], good[1], good[2], 'PRRT_kwDO']],
    ['threadId', [good[0], good[1], good[2], '12/../x']],
    ['threadId', [good[0], good[1], good[2], '']],
    ['threadId', [good[0], good[1], good[2], 12]],
  ])('rejects a bad %s without calling fetch', async (_name, args) => {
    for (const method of ['resolveThread', 'unresolveThread'] as const) {
      const { fn } = fakeFetch();
      const impl = createBridgeImpl({ doc: document, fetch: fn }) as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
      await expect(impl[method]!(...args)).rejects.toMatchObject({ status: 0 });
      expect(fn).not.toHaveBeenCalled();
    }
  });
});

describe('startBridge handshake', () => {
  const ports: MessagePort[] = [];
  const newChannel = () => {
    const c = new MessageChannel();
    ports.push(c.port1, c.port2);
    return c;
  };
  let stop: () => void;
  let post: ReturnType<typeof vi.spyOn>;
  let fetchMock: ReturnType<typeof fakeFetch>;

  /** Delivers a `message` event the way the browser does for `window.postMessage`. */
  function deliver(data: unknown, opts: { source?: unknown; origin?: string; ports?: MessagePort[] } = {}) {
    const ev = new Event('message');
    Object.defineProperties(ev, {
      data: { value: data },
      source: { value: 'source' in opts ? opts.source : window },
      origin: { value: opts.origin ?? window.location.origin },
      ports: { value: opts.ports ?? [] },
    });
    window.dispatchEvent(ev);
  }

  beforeEach(() => {
    post = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
    fetchMock = fakeFetch();
    stop = startBridge(window, { fetch: fetchMock.fn });
  });
  afterEach(() => {
    stop();
    for (const p of ports.splice(0)) p.close();
  });

  const GET = '/dangh/pierre-sandbox/pull/1/changes';
  const ping = (client: ReturnType<typeof createRpcClient<BridgeMethods>>) => client.call('get', GET, {}, { dataRouter: true });

  it('announces itself with pierre:bridge-ready to location.origin, never "*"', () => {
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith({ type: 'pierre:bridge-ready' }, 'https://github.com');
  });

  it('serves RPC over a port delivered by a same-window, same-origin message', async () => {
    const c = newChannel();
    deliver({ type: 'pierre:bridge-port' }, { ports: [c.port2] });
    const client = createRpcClient<BridgeMethods>(c.port1);
    await expect(ping(client)).resolves.toMatchObject({ data: { ok: true } });
    expect(fetchMock.calls).toHaveLength(1);
    await expect(client.call('get', '/dangh/pierre-sandbox/settings')).rejects.toBeInstanceOf(BridgeError);
    expect(fetchMock.calls).toHaveLength(1);
  });

  it.each([
    ['a foreign origin', { origin: 'https://evil.example' }],
    ['another source window', { source: {} }],
    ['a null source', { source: null }],
    ['no port', { ports: [] }],
  ])('ignores bridge-port from %s', async (_n, opts) => {
    const c = newChannel();
    deliver({ type: 'pierre:bridge-port' }, { ports: 'ports' in opts ? opts.ports : [c.port2], ...opts });
    const client = createRpcClient<BridgeMethods>(c.port1, { timeoutMs: 60 });
    await expect(ping(client)).rejects.toMatchObject({ code: 'timeout' });
    expect(fetchMock.calls).toHaveLength(0);
  });

  it('ignores a message with two ports', async () => {
    const a = newChannel();
    const b = newChannel();
    deliver({ type: 'pierre:bridge-port' }, { ports: [a.port2, b.port2] });
    const client = createRpcClient<BridgeMethods>(a.port1, { timeoutMs: 60 });
    await expect(ping(client)).rejects.toMatchObject({ code: 'timeout' });
  });

  it('ignores unrelated and malformed messages', () => {
    expect(() => {
      deliver(null);
      deliver('pierre:bridge-port');
      deliver({ type: 'something-else' });
      deliver(undefined);
    }).not.toThrow();
  });

  it('keeps the first port while active and ignores a second bridge-port', async () => {
    const first = newChannel();
    const second = newChannel();
    deliver({ type: 'pierre:bridge-port' }, { ports: [first.port2] });
    deliver({ type: 'pierre:bridge-port' }, { ports: [second.port2] });
    const c1 = createRpcClient<BridgeMethods>(first.port1);
    const c2 = createRpcClient<BridgeMethods>(second.port1, { timeoutMs: 60 });
    await expect(ping(c1)).resolves.toBeTruthy();
    await expect(ping(c2)).rejects.toMatchObject({ code: 'timeout' });
  });

  it('closes the old port on pierre:bridge-reset and then accepts the next', async () => {
    const first = newChannel();
    const second = newChannel();
    deliver({ type: 'pierre:bridge-port' }, { ports: [first.port2] });
    deliver({ type: 'pierre:bridge-reset' });
    deliver({ type: 'pierre:bridge-port' }, { ports: [second.port2] });
    const c1 = createRpcClient<BridgeMethods>(first.port1, { timeoutMs: 60 });
    const c2 = createRpcClient<BridgeMethods>(second.port1);
    await expect(ping(c1)).rejects.toMatchObject({ code: 'timeout' }); // old port is closed
    await expect(ping(c2)).resolves.toBeTruthy();
  });

  it('ignores bridge-reset from a foreign origin', async () => {
    const c = newChannel();
    deliver({ type: 'pierre:bridge-port' }, { ports: [c.port2] });
    deliver({ type: 'pierre:bridge-reset' }, { origin: 'https://evil.example' });
    await expect(ping(createRpcClient<BridgeMethods>(c.port1))).resolves.toBeTruthy();
  });

  it('stop() removes the listener', async () => {
    stop();
    const c = newChannel();
    deliver({ type: 'pierre:bridge-port' }, { ports: [c.port2] });
    const client = createRpcClient<BridgeMethods>(c.port1, { timeoutMs: 60 });
    await expect(ping(client)).rejects.toMatchObject({ code: 'timeout' });
  });
});
