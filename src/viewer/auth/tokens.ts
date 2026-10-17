/**
 * Personal access token store, one entry per repo owner plus an optional default (`'*'`).
 *
 * Tokens live in `chrome.storage.local` (never `sync`: they must not leave the device) under a single item.
 * Only extension pages (the viewer, the options page) import this module; the token is never posted to the
 * github.com page and never logged. Owner keys are case-insensitive (GitHub logins are): stored lower-cased.
 */

export const TOKENS_STORAGE_KEY = 'pierre.tokens';
/** Default key: used for any owner without its own token. */
export const DEFAULT_OWNER_KEY = '*';

export type TokenKind = 'classic' | 'fine-grained';

export interface TokenInfo {
  owner: string;
  login: string;
  kind: TokenKind;
}

interface StoredToken {
  token: string;
  login: string;
  kind: TokenKind;
}

export interface TokenStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

let injected: TokenStorageArea | undefined;

/** Test seam: route the store through a fake area. Pass `undefined` to go back to `chrome.storage.local`. */
export function setTokenStorage(area: TokenStorageArea | undefined): void {
  injected = area;
}

const area = (): TokenStorageArea => injected ?? chrome.storage.local;
const ownerKey = (owner: string): string => (owner === DEFAULT_OWNER_KEY ? owner : owner.trim().toLowerCase());

/** `github_pat_` is a fine-grained token; `ghp_` and anything unrecognized are treated as classic. */
export function tokenKind(token: string): TokenKind {
  return token.startsWith('github_pat_') ? 'fine-grained' : 'classic';
}

function isStored(v: unknown): v is StoredToken {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return typeof r.token === 'string' && r.token !== '' && typeof r.login === 'string' && (r.kind === 'classic' || r.kind === 'fine-grained');
}

async function readAll(): Promise<Record<string, StoredToken>> {
  const raw = (await area().get(TOKENS_STORAGE_KEY))[TOKENS_STORAGE_KEY];
  const out: Record<string, StoredToken> = {};
  if (typeof raw === 'object' && raw !== null) {
    for (const [key, value] of Object.entries(raw)) if (isStored(value)) out[key] = value;
  }
  return out;
}

/** Writes are read-modify-write on one item: serialize them so concurrent saves do not drop each other. */
let writeChain: Promise<unknown> = Promise.resolve();
function mutate(fn: (all: Record<string, StoredToken>) => void): Promise<void> {
  const run = writeChain.then(async () => {
    const all = await readAll();
    fn(all);
    await area().set({ [TOKENS_STORAGE_KEY]: all });
  });
  writeChain = run.catch(() => undefined);
  return run;
}

/** The owner's token, else the default token, else null. */
export async function getToken(owner: string): Promise<string | null> {
  const all = await readAll();
  return all[ownerKey(owner)]?.token ?? all[DEFAULT_OWNER_KEY]?.token ?? null;
}

/** Saves `token` for `owner` (or `'*'`). `meta.login` is the account it belongs to (from `viewer()`), shown in settings. */
export async function setToken(owner: string | '*', token: string, meta: { login?: string } = {}): Promise<void> {
  const value = token.trim();
  if (!value) throw new Error('Token is empty.');
  const key = ownerKey(owner);
  await mutate((all) => {
    all[key] = { token: value, login: meta.login ?? '', kind: tokenKind(value) };
  });
}

export async function removeToken(owner: string | '*'): Promise<void> {
  const key = ownerKey(owner);
  await mutate((all) => {
    delete all[key];
  });
}

/** Metadata for every saved token, sorted by owner. Never includes the token itself. */
export async function listTokens(): Promise<TokenInfo[]> {
  const all = await readAll();
  return Object.entries(all)
    .map(([owner, t]) => ({ owner, login: t.login, kind: t.kind }))
    .sort((a, b) => (a.owner < b.owner ? -1 : a.owner > b.owner ? 1 : 0));
}
