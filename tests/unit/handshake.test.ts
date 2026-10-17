// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://github.com/dangh/pierre-sandbox/pull/1/changes"}
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountViewer, setExtensionUrlResolver } from '../../src/content/host';
import { startBridge } from '../../src/page/bridge';
import { createRpcClient, type BridgeMethods } from '../../src/shared/rpc';
import type { PrRef } from '../../src/shared/pr-url';

const ref: PrRef = { owner: 'dangh', repo: 'pierre-sandbox', number: 1, page: 'changes' };
const EXT = 'chrome-extension://abcdefghijklmnop/';

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
    setExtensionUrlResolver((path) => EXT + path);
    document.body.innerHTML = readFileSync(resolve(__dirname, '../fixtures/dom/pr-tabs-new.html'), 'utf8');
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

  async function viewerCanCall(portsSentToViewer: MessagePort[]): Promise<void> {
    const client = createRpcClient<BridgeMethods>(portsSentToViewer.at(-1)!, { timeoutMs: 1000 });
    clients.push(client);
    await expect(client.call('get', '/dangh/pierre-sandbox/pull/1/changes', {}, { dataRouter: true })).resolves.toMatchObject({
      data: { ok: true },
    });
  }

  function mountWithViewerSpy() {
    const host = mountViewer(document, ref);
    const toViewer: MessagePort[] = [];
    vi.spyOn(host.iframe.contentWindow!, 'postMessage').mockImplementation(((_m: unknown, _o: string, transfer?: MessagePort[]) => {
      toViewer.push(...(transfer ?? []));
    }) as Window['postMessage']);
    return { host, toViewer };
  }

  it('bridge-port queued before the bridge started, then ready: the viewer\'s newest port works', async () => {
    const { host, toViewer } = mountWithViewerSpy(); // queues [bridge-port#1]
    host.iframe.dispatchEvent(new Event('load')); // viewer already holds port1#1
    stopBridge = startBridge(window, { fetch: fetchOk }); // queues [bridge-ready]
    expect(queue.map((q) => (q.data as { type: string }).type)).toEqual(['pierre:bridge-port', 'pierre:bridge-ready']);

    flush(); // bridge accepts #1, content re-handshakes on ready

    expect(toViewer).toHaveLength(2);
    await viewerCanCall(toViewer);
    host.unmount();
  });

  it('same race before the iframe has loaded: the load delivers the working port', async () => {
    const { host, toViewer } = mountWithViewerSpy();
    stopBridge = startBridge(window, { fetch: fetchOk });
    flush();
    host.iframe.dispatchEvent(new Event('load'));
    expect(toViewer).toHaveLength(1);
    await viewerCanCall(toViewer);
    host.unmount();
  });

  it('bridge ready before mount (port arrives to a listening bridge): no re-handshake needed', async () => {
    stopBridge = startBridge(window, { fetch: fetchOk });
    flush(); // ready, nobody listening yet
    const { host, toViewer } = mountWithViewerSpy();
    host.iframe.dispatchEvent(new Event('load'));
    flush();
    expect(toViewer).toHaveLength(1);
    await viewerCanCall(toViewer);
    host.unmount();
  });
});
