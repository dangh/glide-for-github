// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://github.com/dangh/pierre-sandbox/pull/1/changes"}
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectBridge } from '../../src/inpage/connectBridge';
import { createConnection } from '../../src/viewer/connection';
import { startBridge } from '../../src/page/bridge';
type Queued = { data: unknown; ports: MessagePort[] };

describe('content script + bridge handshake, in-order message delivery', () => {
  let queue: Queued[];
  let stopBridge: (() => void) | undefined;
  const clients: Array<{ close(): void }> = [];

  /** Delivers one queued window.postMessage the way the browser does (same window, same origin, ports attached). */
  function deliver({ data, ports }: Queued) {
    const ev = new Event('message');
    Object.defineProperties(ev, {
      data: { value: data },
      source: { value: window },
      origin: { value: window.location.origin },
      ports: { value: ports },
    });
    window.dispatchEvent(ev);
  }
  /** Messages posted while delivering (the reset, the re-sent port) are appended and delivered in order. */
  function flush() {
    while (queue.length) deliver(queue.shift()!);
  }

  beforeEach(() => {
    queue = [];
    vi.spyOn(window, 'postMessage').mockImplementation(((data: unknown, target: string, transfer?: MessagePort[]) => {
      expect(target).toBe(window.location.origin);
      queue.push({ data, ports: transfer ?? [] });
    }) as typeof window.postMessage);
  });
  afterEach(() => {
    for (const c of clients.splice(0)) c.close();
    stopBridge?.();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  const fetchOk = (async () =>
    new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;


  async function viewerCanCall(connection: ReturnType<typeof createConnection>) {
    await expect(connection.rpc.call('get', '/dangh/pierre-sandbox/pull/1/changes', {}, { dataRouter: true })).resolves.toMatchObject({ data: { ok: true } });
  }

  it('renews a channel queued before the bridge starts', async () => {
    const connection = createConnection(window, { source: window });
    clients.push({ close: connection.dispose });
    const disconnect = connectBridge(window);
    stopBridge = startBridge(window, { fetch: fetchOk });
    flush();
    await viewerCanCall(connection);
    disconnect();
    flush();
  });

  it('connects when the bridge was already listening', async () => {
    stopBridge = startBridge(window, { fetch: fetchOk });
    flush();
    const connection = createConnection(window, { source: window });
    clients.push({ close: connection.dispose });
    const disconnect = connectBridge(window);
    flush();
    await viewerCanCall(connection);
    disconnect();
    flush();
  });

  it('ignores bridge-ready from another origin or window, and after disconnect', async () => {
    const disconnect = connectBridge(window);
    queue.length = 0;
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'pierre:bridge-ready' }, source: window, origin: 'https://evil.example' }));
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'pierre:bridge-ready' }, origin: window.location.origin }));
    expect(queue).toEqual([]);
    disconnect();
    queue.length = 0;
    deliver({ data: { type: 'pierre:bridge-ready' }, ports: [] });
    expect(queue).toEqual([]);
  });
});
