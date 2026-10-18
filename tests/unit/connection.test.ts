import { describe, expect, it } from 'vitest';
import { BridgeError, type BridgeMethods, type RpcClient } from '../../src/shared/rpc';
import { createConnection, parsePrParam } from '../../src/viewer/connection';

type Listener = (event: MessageEvent) => void;

/** A window stand-in: the connection only uses add/removeEventListener('message'). */
function fakeWindow() {
  const listeners = new Set<Listener>();
  const parent = {} as MessageEventSource;
  return {
    parent,
    win: {
      parent,
      addEventListener: (_: string, l: Listener) => listeners.add(l),
      removeEventListener: (_: string, l: Listener) => listeners.delete(l),
    } as unknown as Window,
    post(data: unknown, opts: { origin?: string; source?: unknown; port?: unknown; scrollPort?: unknown } = {}) {
      const event = {
        data,
        origin: opts.origin ?? 'https://github.com',
        source: opts.source === undefined ? parent : opts.source,
        ports: opts.port === null ? [] : [opts.port ?? {}, ...(opts.scrollPort ? [opts.scrollPort] : [])],
      } as unknown as MessageEvent;
      for (const l of listeners) l(event);
    },
    listeners,
  };
}

/** Fake clients: each port gets a client whose calls are answered by `answer` (or stay pending). */
function fakeClients(answer: (n: number, method: string) => Promise<unknown> | 'pending') {
  const clients: { closed: boolean; reject: (e: unknown) => void }[] = [];
  const createClient = (): RpcClient<BridgeMethods> => {
    const n = clients.length;
    const pending = new Set<(e: unknown) => void>();
    const record = {
      closed: false,
      reject: (e: unknown) => pending.forEach((r) => r(e)),
    };
    clients.push(record);
    return {
      call: ((method: string) => {
        const a = answer(n, method);
        if (a !== 'pending') return a;
        return new Promise((_, reject) => pending.add(reject));
      }) as RpcClient<BridgeMethods>['call'],
      close() {
        record.closed = true;
        record.reject(new BridgeError({ status: 0, code: 'closed', message: 'RPC port closed' }));
      },
    };
  };
  return { clients, createClient };
}

describe('viewer connection', () => {
  it('passes the scroll channel of a page-scrolling handshake on, and closes one nobody asked for', async () => {
    const w = fakeWindow();
    const { createClient } = fakeClients(async () => null);
    const received: unknown[] = [];
    const conn = createConnection(w.win, { createClient, onScrollPort: (p) => received.push(p) });
    const scrollPort = { close() {} };
    w.post({ type: 'pierre:port' }, { scrollPort });
    w.post({ type: 'pierre:port' });
    expect(received).toEqual([scrollPort]);
    conn.dispose();

    const unused = { closed: false, close() { this.closed = true; } };
    const plain = createConnection(w.win, { createClient });
    w.post({ type: 'pierre:port' }, { scrollPort: unused });
    expect(unused.closed).toBe(true);
    plain.dispose();
  });

  it('accepts pierre:port only from github.com and the parent window, and reports the color mode', async () => {
    const w = fakeWindow();
    const { clients, createClient } = fakeClients(async (n) => `client ${n}`);
    const conn = createConnection(w.win, { createClient });
    w.post({ type: 'pierre:port' }, { origin: 'https://evil.example' });
    w.post({ type: 'pierre:port' }, { source: {} });
    w.post({ type: 'other' });
    w.post({ type: 'pierre:port' }, { port: null });
    expect(clients).toHaveLength(0);
    w.post({ type: 'pierre:port', colorMode: 'dark' });
    await expect(conn.ready).resolves.toBe('dark');
    await expect(conn.rpc.call('getText', 'x')).resolves.toBe('client 0');
    conn.dispose();
    expect(w.listeners.size).toBe(0);
    expect(clients[0]!.closed).toBe(true);
  });

  it('calls wait for the first port', async () => {
    const w = fakeWindow();
    const { createClient } = fakeClients(async () => 'ok');
    const conn = createConnection(w.win, { createClient });
    const call = conn.rpc.call('getText', 'x');
    w.post({ type: 'pierre:port' });
    await expect(call).resolves.toBe('ok');
  });

  it('re-issues a call on the replacement port when its port is replaced mid-call', async () => {
    const w = fakeWindow();
    const { clients, createClient } = fakeClients((n) => (n === 0 ? 'pending' : Promise.resolve(`answered by ${n}`)));
    const conn = createConnection(w.win, { createClient });
    w.post({ type: 'pierre:port' });
    const call = conn.rpc.call('getText', 'x');
    await new Promise((r) => setTimeout(r, 0));
    w.post({ type: 'pierre:port' }); // bridge-ready race: new port, old client closed
    await expect(call).resolves.toBe('answered by 1');
    expect(clients[0]!.closed).toBe(true);
  });

  it('gives up when no replacement port arrives, and passes other errors through', async () => {
    const w = fakeWindow();
    const { clients, createClient } = fakeClients((n, method) =>
      method === 'preview' ? Promise.reject(new BridgeError({ status: 404, message: 'nope' })) : n === 0 ? 'pending' : Promise.resolve('x'),
    );
    const conn = createConnection(w.win, { createClient, reconnectTimeoutMs: 20 });
    w.post({ type: 'pierre:port' });
    const call = conn.rpc.call('getText', 'x');
    await new Promise((r) => setTimeout(r, 0));
    clients[0]!.reject(new BridgeError({ status: 0, code: 'closed', message: 'gone' }));
    await expect(call).rejects.toMatchObject({ code: 'closed' });
    await expect(conn.rpc.call('preview', 't', { owner: 'o', repo: 'r' })).rejects.toMatchObject({ status: 404 });
  });

  it.each(['resolveThread', 'unresolveThread', 'markViewed', 'unmarkViewed'] as const)(
    'never re-sends the session write %s when its port is replaced mid-call (rejects with closed)',
    async (method) => {
      const w = fakeWindow();
      const seen: string[] = [];
      const { createClient } = fakeClients((n, m) => (seen.push(`${n}:${m}`), n === 0 ? 'pending' : Promise.resolve('sent twice')));
      const conn = createConnection(w.win, { createClient });
      w.post({ type: 'pierre:port' });
      const call = (conn.rpc.call as (m: string, ...a: unknown[]) => Promise<unknown>)(method, 'o', 'r', 1, '7');
      await new Promise((r) => setTimeout(r, 0));
      w.post({ type: 'pierre:port' });
      await expect(call).rejects.toMatchObject({ code: 'closed' });
      expect(seen).toEqual([`0:${method}`]);
    },
  );

  it('re-issues applySuggestions on the replacement port with the SAME idempotency key (GitHub dedupes by key)', async () => {
    const w = fakeWindow();
    const args: unknown[][] = [];
    const clients: number[] = [];
    let n = 0;
    const createClient = (): RpcClient<BridgeMethods> => {
      const id = n++;
      const pending = new Set<(e: unknown) => void>();
      return {
        call: ((_m: string, ...a: unknown[]) => {
          args.push(a);
          clients.push(id);
          if (id === 0) return new Promise((_, reject) => pending.add(reject));
          return Promise.resolve('applied');
        }) as RpcClient<BridgeMethods>['call'],
        close: () => pending.forEach((r) => r(new BridgeError({ status: 0, code: 'closed', message: 'RPC port closed' }))),
      };
    };
    const conn = createConnection(w.win, { createClient });
    w.post({ type: 'pierre:port' });
    const body = { owner: 'o', repo: 'r', number: 1, comments: [{ id: 1 }], message: 'm', expectedHeadOid: 'a'.repeat(40) };
    const call = conn.rpc.call('applySuggestions', body, 'key-1');
    await new Promise((r) => setTimeout(r, 0));
    w.post({ type: 'pierre:port' });
    await expect(call).resolves.toBe('applied');
    expect(clients).toEqual([0, 1]);
    expect(args[1]).toEqual([body, 'key-1']);
  });

  it('parses the viewer ?pr= parameter', () => {
    expect(parsePrParam('?pr=' + encodeURIComponent('dangh/pierre-sandbox#1'))).toEqual({
      owner: 'dangh',
      repo: 'pierre-sandbox',
      number: 1,
      page: 'changes',
    });
    expect(parsePrParam('?pr=a%2Fb%2337778')?.number).toBe(37778);
    expect(parsePrParam('')).toBeNull();
    expect(parsePrParam('?pr=a/b#0')).toBeNull();
    expect(parsePrParam('?pr=' + encodeURIComponent('a/b/c#1'))).toBeNull();
  });
});
