/**
 * Fixtures captured from the sandbox PR (scripts/capture-fixtures.mjs) and a fake bridge RPC that serves
 * them the way GitHub does. Not a test file itself (no `.test.ts` suffix).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BridgeMethods, BridgeQuery, Json } from '../../src/shared/rpc';
import type { PrRef } from '../../src/shared/pr-url';

// String form: under jsdom, `URL` is jsdom's and fileURLToPath rejects it.
const dir = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/sandbox');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const fixture = (name: string): any => JSON.parse(readFileSync(join(dir, name), 'utf8'));

export const sandbox = fixture('../../sandbox.json') as { owner: string; repo: string; number: number };
export const ref: PrRef = { ...sandbox, page: 'changes' };
export const base = `/${sandbox.owner}/${sandbox.repo}/pull/${sandbox.number}`;

export interface Call {
  method: string;
  args: unknown[];
}

type Handler = (path: string, query: BridgeQuery | undefined) => { data: Json; link: string | null } | Promise<{ data: Json; link: string | null }>;

/** Decodes a `diff_entries` raw query the way GitHub's server does (two decoding passes). */
export function decodePathsQuery(raw: string): { paths: string[]; params: URLSearchParams } {
  const params = new URLSearchParams(raw);
  const joined = params.get('paths') ?? '';
  return { paths: joined === '' ? [] : joined.split(',').map(decodeURIComponent), params };
}

type Override = (path: string, query: BridgeQuery | undefined) => ReturnType<Handler> | undefined | Promise<Awaited<ReturnType<Handler>> | undefined>;

/** A fake `RpcClient<BridgeMethods>` answering from the sandbox fixtures. `override` runs first; returning undefined falls through. */
export function fakeRpc(override?: Override) {
  const calls: Call[] = [];
  const route = fixture('route.json');
  const entries = { '0': fixture('diff-entries-w0.json').data, '1': fixture('diff-entries-w1.json').data };
  const lines = fixture('diff-entry-lines.json');
  const threads = fixture('threads.json');
  const previews = fixture('thread-previews.json');
  const positioning = fixture('thread-preview-positioning.json');

  const get: Handler = (path, query) => {
    if (path === `${base}/changes`) return { data: route, link: null };
    if (path === `${base}/page_data/diff_entries`) {
      const { paths, params } = decodePathsQuery((query as { raw: string }).raw);
      const all = entries[(params.get('w') ?? '0') as '0' | '1'] as { path: string }[];
      return { data: all.filter((e) => paths.includes(e.path)) as unknown as Json, link: null };
    }
    if (path === `${base}/page_data/diff_entry_lines`) {
      const q = query as Record<string, string>;
      if (q.path !== lines.path) return { data: { diffEntryLines: [] }, link: null };
      return { data: lines.data, link: null };
    }
    if (path === `${base}/page_data/threads`) return { data: threads.pages[0].data, link: threads.pages[0].link };
    if (path === `${base}/page_data/thread_previews`) return { data: previews.data, link: null };
    if (path === `${base}/page_data/thread_preview_positioning`) return { data: positioning.data, link: null };
    throw { status: 0, code: 'not_allowed', message: `unexpected path ${path}` };
  };

  const rpc = {
    calls,
    async call<K extends keyof BridgeMethods & string>(method: K, ...args: Parameters<BridgeMethods[K]>): Promise<Awaited<ReturnType<BridgeMethods[K]>>> {
      type R = Awaited<ReturnType<BridgeMethods[K]>>;
      calls.push({ method, args });
      if (method === 'get') {
        const [path, query] = args as [string, BridgeQuery | undefined];
        const res = (override && (await override(path, query))) || (await get(path, query));
        return structuredClone(res) as R;
      }
      if (method === 'getText') return `text of ${String(args[0])}` as R;
      throw new Error(`unexpected method ${method}`);
    },
  };
  return rpc;
}
