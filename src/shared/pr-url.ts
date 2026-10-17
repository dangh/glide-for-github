export type PrPage = 'conversation' | 'commits' | 'checks' | 'changes' | 'files';

export interface PrRef {
  owner: string;
  repo: string;
  number: number;
  page: PrPage;
}

const GLIDE_HASH = '#glide';
/** Hash of links made before the rename to Glide; still opens the viewer. */
const LEGACY_HASH = '#pierre';
const POSITIVE_INT = /^[1-9]\d*$/;

/**
 * Parses a github.com pull request URL. Query strings and hashes are ignored.
 * Returns null for any other host, scheme, or path shape.
 */
export function parsePrUrl(url: string): PrRef | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.host !== 'github.com') return null;

  const path = u.pathname.replace(/\/+$/, '');
  const parts = path.split('/');
  // A leading slash yields parts[0] === ''.
  if (parts.length < 5 || parts[0] !== '') return null;

  const [, owner, repo, kind, rawNumber, ...rest] = parts;
  if (!owner || !repo || kind !== 'pull') return null;
  if (!POSITIVE_INT.test(rawNumber ?? '')) return null;
  const number = Number(rawNumber);
  if (!Number.isSafeInteger(number)) return null;

  const page = pageFor(rest);
  if (!page) return null;
  return { owner, repo, number, page };
}

/** Maps the path segments after /pull/{n} to a PR page. `range` is an optional second segment. */
function pageFor(rest: string[]): PrPage | null {
  const [head, ...tail] = rest;
  if (head === undefined) return 'conversation';
  if (tail.length > 1) return null;
  if (head === 'changes') return 'changes';
  if (head === 'files') return 'files';
  if (head === 'commits') return 'commits';
  if (head === 'checks' && tail.length === 0) return 'checks';
  return null;
}

/** True when the URL's hash is exactly `#glide` (or its old name `#pierre`). */
export function isGlideActive(url: string): boolean {
  try {
    const { hash } = new URL(url);
    return hash === GLIDE_HASH || hash === LEGACY_HASH;
  } catch {
    return false;
  }
}

/** Base PR URL on the Conversation page, the lightest page to load, with the Glide hash. */
export function glideUrl(ref: PrRef): string {
  return `https://github.com/${ref.owner}/${ref.repo}/pull/${ref.number}${GLIDE_HASH}`;
}

/** Stable identifier for a PR, independent of page: `owner/repo#n`. */
export function prKey(ref: PrRef): string {
  return `${ref.owner}/${ref.repo}#${ref.number}`;
}
