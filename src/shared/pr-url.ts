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

/** Marks a link to GitHub's Files changed page that the user chose over Glide, so Glide does not replace it. */
const KEEP_GITHUB = { name: 'glide', value: 'off' };

/**
 * GitHub's own Files changed page for a PR, at one file's diff when its path digest is known. Never replaced by Glide:
 * a spot in the diff never is, and the page itself carries the flag.
 */
export function filesChangedUrl(ref: Pick<PrRef, 'owner' | 'repo' | 'number'>, digest?: string): string {
  const page = `https://github.com/${ref.owner}/${ref.repo}/pull/${ref.number}/changes`;
  return digest ? `${page}#diff-${digest}` : `${page}?${KEEP_GITHUB.name}=${KEEP_GITHUB.value}`;
}

/** GitHub's Files changed page is what the URL shows: a files page without Glide open over it. */
export function showsGithubFiles(url: string): boolean {
  const page = parsePrUrl(url)?.page;
  return (page === 'changes' || page === 'files') && !isGlideActive(url);
}

/**
 * With "Replace Files changed with Glide" on, the URL to show instead of `url`: the same page with Glide open, for
 * the whole PR's Files changed page. Null for every other URL, including a commit range or a spot in the diff (a
 * hash), which only GitHub's page can show, and links made with `filesChangedUrl`.
 */
export function filesRedirect(url: string): string | null {
  if (!showsGithubFiles(url)) return null;
  const u = new URL(url);
  const wholePr = u.pathname.replace(/\/+$/, '').split('/').length === 6; // '', owner, repo, 'pull', n, page
  if (!wholePr || u.hash !== '' || u.searchParams.get(KEEP_GITHUB.name) === KEEP_GITHUB.value) return null;
  return `${u.origin}${u.pathname}${u.search}${GLIDE_HASH}`;
}

/** Base PR URL on the Conversation page, the lightest page to load, with the Glide hash. */
export function glideUrl(ref: PrRef): string {
  return `https://github.com/${ref.owner}/${ref.repo}/pull/${ref.number}${GLIDE_HASH}`;
}

/** Stable identifier for a PR, independent of page: `owner/repo#n`. */
export function prKey(ref: PrRef): string {
  return `${ref.owner}/${ref.repo}#${ref.number}`;
}
