import { afterEach, describe, expect, it } from 'vitest';
import { BridgeError, createRpcClient, diffEntriesRaw, serveRpc } from '../../src/shared/rpc';

type Methods = {
  add(a: number, b: number): number;
  echo(value: string): string;
  fail(): never;
  boom(): never;
  hang(): never;
  slow(ms: number, value: string): string;
};

const ports: MessagePort[] = [];
function channel(): MessageChannel {
  const c = new MessageChannel();
  ports.push(c.port1, c.port2);
  return c;
}
afterEach(() => {
  for (const p of ports.splice(0)) p.close();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const impl = {
  add: (a: number, b: number) => a + b,
  echo: async (value: string) => value,
  fail: () => {
    throw { status: 409, code: 'HEAD_OID_MISMATCH', message: 'head moved' };
  },
  boom: () => {
    throw new Error('kaput');
  },
  hang: () => new Promise<never>(() => {}),
  slow: async (ms: number, value: string) => {
    await sleep(ms);
    return value;
  },
};

describe('rpc over a real MessageChannel', () => {
  it('round-trips sync and async implementations', async () => {
    const { port1, port2 } = channel();
    serveRpc<Methods>(port2, impl);
    const client = createRpcClient<Methods>(port1);
    await expect(client.call('add', 2, 3)).resolves.toBe(5);
    await expect(client.call('echo', 'hi')).resolves.toBe('hi');
  });

  it('matches responses to calls by id when they arrive out of order', async () => {
    const { port1, port2 } = channel();
    serveRpc<Methods>(port2, impl);
    const client = createRpcClient<Methods>(port1);
    const [slow, fast] = await Promise.all([client.call('slow', 40, 'slow'), client.call('slow', 0, 'fast')]);
    expect([slow, fast]).toEqual(['slow', 'fast']);
  });

  it('rethrows {status, code, message} errors as BridgeError', async () => {
    const { port1, port2 } = channel();
    serveRpc<Methods>(port2, impl);
    const client = createRpcClient<Methods>(port1);
    const err = await client.call('fail').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BridgeError);
    expect(err).toBeInstanceOf(Error);
    expect(err).toMatchObject({ status: 409, code: 'HEAD_OID_MISMATCH', message: 'head moved' });
  });

  it('maps an unexpected exception to status 0 / internal without leaking a stack', async () => {
    const { port1, port2 } = channel();
    serveRpc<Methods>(port2, impl);
    const client = createRpcClient<Methods>(port1);
    const err = (await client.call('boom').catch((e: unknown) => e)) as BridgeError;
    expect(err).toBeInstanceOf(BridgeError);
    expect(err.status).toBe(0);
    expect(err.code).toBe('internal');
    expect(err.message).toBe('kaput');
  });

  it('rejects a method the server does not implement as not_allowed (incl. prototype names)', async () => {
    const { port1, port2 } = channel();
    serveRpc<Methods>(port2, impl);
    const client = createRpcClient<Record<string, () => unknown>>(port1);
    for (const m of ['nope', 'toString', 'constructor', '__proto__']) {
      const err = (await client.call(m).catch((e: unknown) => e)) as BridgeError;
      expect(err).toBeInstanceOf(BridgeError);
      expect(err.code).toBe('not_allowed');
    }
  });

  it('times out when no response arrives, then ignores the late reply', async () => {
    const { port1, port2 } = channel();
    serveRpc<Methods>(port2, impl);
    const client = createRpcClient<Methods>(port1, { timeoutMs: 30 });
    const err = (await client.call('hang').catch((e: unknown) => e)) as BridgeError;
    expect(err).toBeInstanceOf(BridgeError);
    expect(err.code).toBe('timeout');
    expect(err.status).toBe(0);
    // A later call on the same client still works.
    await expect(client.call('add', 1, 1)).resolves.toBe(2);
  });

  it('defaults to a 30 s timeout', async () => {
    const { port1 } = channel();
    const realSetTimeout = globalThis.setTimeout;
    const delays: number[] = [];
    globalThis.setTimeout = ((fn: () => void, ms?: number) => {
      delays.push(ms ?? 0);
      return realSetTimeout(fn, ms);
    }) as typeof setTimeout;
    try {
      const client = createRpcClient<Methods>(port1);
      const pending = client.call('hang').catch(() => {});
      client.close();
      await pending;
    } finally {
      globalThis.setTimeout = realSetTimeout;
    }
    expect(delays).toContain(30_000);
  });

  it('close() rejects pending calls and later calls', async () => {
    const { port1, port2 } = channel();
    serveRpc<Methods>(port2, impl);
    const client = createRpcClient<Methods>(port1);
    const pending = client.call('hang');
    client.close();
    await expect(pending).rejects.toMatchObject({ code: 'closed' });
    await expect(client.call('add', 1, 2)).rejects.toMatchObject({ code: 'closed' });
  });

  it('ignores messages that are not rpc frames', async () => {
    const { port1, port2 } = channel();
    serveRpc<Methods>(port2, impl);
    const client = createRpcClient<Methods>(port1);
    port1.postMessage('garbage');
    port1.postMessage({ id: 1, method: 'add', args: [1, 2] }); // missing the rpc marker
    await expect(client.call('add', 4, 5)).resolves.toBe(9);
  });
});

describe('diffEntriesRaw', () => {
  it('double-encodes each path and joins them with %2C, as GitHub does', () => {
    expect(diffEntriesRaw(['a b.ts', 'src/x,y.ts'])).toBe(
      'paths=a%2520b.ts%2Csrc%252Fx%252Cy.ts',
    );
  });

  it('appends extra params after paths, URL-encoded', () => {
    expect(diffEntriesRaw(['a.ts'], { w: '1', range: 'abc..def' })).toBe('paths=a.ts&w=1&range=abc..def');
  });
});
