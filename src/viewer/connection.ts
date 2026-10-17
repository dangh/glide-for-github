/**
 * The viewer's side of the port handshake (see src/shared/rpc.ts and src/content/host.ts).
 *
 * The content script posts `{type: 'pierre:port', colorMode}` with a MessagePort to this frame, and may
 * post a replacement at any time (bridge-ready race). `createConnection` exposes one stable `rpc` facade:
 * calls wait for the first port, and a call that fails because its port was replaced (`closed`) is re-issued
 * on the new port, for reads and applySuggestions only (see `RETRY_ON_CLOSED`).
 */
import { BridgeError, createRpcClient, RETRY_ON_CLOSED, type BridgeMethods, type RpcClient } from '../shared/rpc';
import type { PrRef } from '../shared/pr-url';
import type { Rpc } from './github/private';

export const GITHUB_ORIGIN = 'https://github.com';

export interface Connection {
  /** Stable RPC facade; survives port replacement. */
  rpc: Rpc;
  /** Resolves with GitHub's `data-color-mode` (`light` / `dark` / `auto`, or undefined) once the first port arrived. */
  ready: Promise<string | undefined>;
  dispose(): void;
}

export interface ConnectionOptions {
  /** How long a call whose port was closed waits for a replacement port. */
  reconnectTimeoutMs?: number;
  /** Only messages from this window are accepted (the embedding github.com page). Defaults to `win.parent`. */
  source?: MessageEventSource | null;
  createClient?: (port: MessagePort) => RpcClient<BridgeMethods>;
}

export function createConnection(win: Window, options: ConnectionOptions = {}): Connection {
  const reconnectTimeoutMs = options.reconnectTimeoutMs ?? 10_000;
  const source = options.source === undefined ? win.parent : options.source;
  const createClient = options.createClient ?? ((port: MessagePort) => createRpcClient<BridgeMethods>(port));

  let client: RpcClient<BridgeMethods> | undefined;
  let resolveReady!: (colorMode: string | undefined) => void;
  const ready = new Promise<string | undefined>((resolve) => (resolveReady = resolve));
  const waiters = new Set<() => void>();
  let disposed = false;

  const onMessage = (event: MessageEvent) => {
    if (disposed || event.origin !== GITHUB_ORIGIN) return;
    if (source !== null && event.source !== source) return;
    const data = event.data as { type?: unknown; colorMode?: unknown } | null;
    if (!data || data.type !== 'pierre:port') return;
    const port = event.ports[0];
    if (!port) return;
    const previous = client;
    client = createClient(port);
    previous?.close();
    resolveReady(typeof data.colorMode === 'string' ? data.colorMode : undefined);
    for (const wake of [...waiters]) wake();
  };
  win.addEventListener('message', onMessage);

  /** Resolves once a client other than `stale` is installed; rejects after the timeout. */
  const nextClient = (stale: RpcClient<BridgeMethods>) =>
    new Promise<void>((resolve, reject) => {
      if (client !== stale) return resolve();
      const timer = setTimeout(() => {
        waiters.delete(wake);
        reject(new BridgeError({ status: 0, code: 'closed', message: 'Connection to GitHub lost' }));
      }, reconnectTimeoutMs);
      const wake = () => {
        if (client === stale) return;
        clearTimeout(timer);
        waiters.delete(wake);
        resolve();
      };
      waiters.add(wake);
    });

  async function call<K extends keyof BridgeMethods & string>(
    method: K,
    ...args: Parameters<BridgeMethods[K]>
  ): Promise<Awaited<ReturnType<BridgeMethods[K]>>> {
    await ready;
    for (let attempt = 0; ; attempt++) {
      const current = client!;
      try {
        return await current.call(method, ...args);
      } catch (err) {
        // Session writes other than applySuggestions (same idempotency key) may already have reached GitHub: never re-send them.
        if (disposed || attempt >= 2 || !RETRY_ON_CLOSED.has(method) || !(err instanceof BridgeError) || err.code !== 'closed') throw err;
        await nextClient(current);
      }
    }
  }
  const rpc: Rpc = { call };

  return {
    rpc,
    ready,
    dispose() {
      disposed = true;
      win.removeEventListener('message', onMessage);
      client?.close();
    },
  };
}

/** The PR from the viewer URL's `?pr=owner/repo#n` (set by the content script, see src/content/host.ts). */
export function parsePrParam(search: string): PrRef | null {
  const key = new URLSearchParams(search).get('pr') ?? '';
  const m = /^([^/#\s]+)\/([^/#\s]+)#([1-9]\d*)$/.exec(key);
  return m ? { owner: m[1]!, repo: m[2]!, number: Number(m[3]), page: 'changes' } : null;
}

/** How long the viewer waits for the content script's port before telling the user to reload the page. */
export const PORT_TIMEOUT_MS = 5000;
/** Shown when no port ever arrives: the extension was updated (or reloaded) and this page's content script is gone. */
export const PORT_TIMEOUT_MESSAGE = 'Reload the page to use Pierre. The extension was updated, so this page can no longer talk to it.';

/**
 * Calls `onTimeout(PORT_TIMEOUT_MESSAGE)` when `ready` (the first port) has not resolved within `ms`. A port that
 * arrives later still connects (the caller clears the message by loading the PR). Returns a cancel function.
 */
export function watchPort(ready: Promise<unknown>, onTimeout: (message: string) => void, ms = PORT_TIMEOUT_MS): () => void {
  let settled = false;
  const timer = setTimeout(() => {
    if (!settled) onTimeout(PORT_TIMEOUT_MESSAGE);
  }, ms);
  void ready.then(() => {
    settled = true;
    clearTimeout(timer);
  });
  return () => {
    settled = true;
    clearTimeout(timer);
  };
}
