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
    post(data: unknown, opts: { origin?: string; source?: unknown; port?: unknown } = {}) {
      const event = {
        data,
        origin: opts.origin ?? 'https://github.com',
        source: opts.source === undefined ? parent : opts.source,
        ports: opts.port === null ? [] : [opts.port ?? {}],
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
