#!/usr/bin/env node
/**
 * Captures GitHub's private PR endpoints for the sandbox PR (tests/sandbox.json) into
 * tests/fixtures/sandbox/*.json. Read-only and re-runnable.
 *
 * It drives the logged-in test browser through the agent-browser CLI (session `pierre-gh`, profile
 * ~/.agent-browser/profiles/github) and runs same-origin `fetch` calls inside github.com with the
 * headers GitHub's own client sends (R§0.1). It also records the `diff_entries` URLs that GitHub's own
 * client requested while the page loaded (used by the "encodes awkward paths" test).
 *
 *   node scripts/capture-fixtures.mjs
 *   AGENT_BROWSER=/path/to/agent-browser node scripts/capture-fixtures.mjs
 *
 * Saved fixtures never contain cookies, nonces or signed tokens: request headers are not saved; every
 * key ending in `Channel` (`aliveChannel`, `changeGroupGenerationChannel`, ...) is removed; every
 * `renderInfo` (rich-diff image links on viewscreen.githubusercontent.com whose hex `enc_url*` params
 * encode raw.githubusercontent.com URLs with `?token=`) is removed; and any other string holding
 * `enc_url` or `token=` is replaced by "<stripped>". `save` refuses to write a file that still matches.
 *
 * ONE-OFF MANUAL STEP (already done on 2026-10-17, skipped when the threads exist):
 * the sandbox PR must carry these review threads before capturing. They were posted with `gh api` on
 * dangh/pierre-sandbox only (never on any other repo):
 *   1. single-line, RIGHT src/util/math.ts line 10
 *        gh api repos/dangh/pierre-sandbox/pulls/1/comments -X POST -f body=... -f commit_id=<head>
 *          -f path=src/util/math.ts -F line=10 -f side=RIGHT
 *   2. multi-line, RIGHT src/components/Button.ts lines 8-9
 *        ... -f path=src/components/Button.ts -F start_line=8 -f start_side=RIGHT -F line=9 -f side=RIGHT
 *   3. file-level on `docs/with space.md`
 *        ... -f path='docs/with space.md' -f subject_type=file
 *   then resolve thread 3 (GraphQL resolveReviewThread), then make thread 1 outdated by pushing a commit
 *   to the sandbox `review-me` branch that changes src/util/math.ts line 10 (clone in /tmp, `git push`).
 * If fewer than 3 threads exist the script prints this reminder and still captures what is there.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sandbox = JSON.parse(readFileSync(join(root, 'tests/sandbox.json'), 'utf8'));
const outDir = join(root, 'tests/fixtures/sandbox');
const SESSION = 'pierre-gh';
const PROFILE = join(homedir(), '.agent-browser/profiles/github');
const prPath = `/${sandbox.owner}/${sandbox.repo}/pull/${sandbox.number}`;
const prUrl = `https://github.com${prPath}/changes`;

function agentBrowserBin() {
  if (process.env.AGENT_BROWSER) return process.env.AGENT_BROWSER;
  const jean = join(homedir(), '.local/share/com.jean.desktop/agent-browser-cli/node_modules/.bin/agent-browser');
  return existsSync(jean) ? jean : 'agent-browser';
}
const AB = agentBrowserBin();

function ab(args, input) {
  const out = execFileSync(AB, ['--session', SESSION, '--profile', PROFILE, '--json', ...args], {
    input,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  const res = JSON.parse(out);
  if (!res.success) throw new Error(`agent-browser ${args[0]} failed: ${JSON.stringify(res.error)}`);
  return res.data;
}

/** Runs an async function body in the page and returns its JSON result. */
function inPage(body, params) {
  const script = `(async () => { const params = ${JSON.stringify(params)};
    const meta = (n) => document.querySelector('meta[name="' + n + '"]')?.content;
    const headers = (dataRouter) => ({
      'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'GitHub-Verified-Fetch': 'true',
      'GitHub-Is-React': 'true', ...(meta('release') ? {'X-GitHub-Client-Version': meta('release')} : {}),
      ...(dataRouter ? {'X-GitHub-App-Type': 'dataRouter'} : {}) });
    const get = async (path, query, dataRouter) => {
      const r = await fetch(path + (query ? '?' + query : ''), {headers: headers(dataRouter), credentials: 'same-origin'});
      if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + path);
      return {query: query || '', link: r.headers.get('Link'), data: await r.json()};
    };
    ${body}
  })().then((v) => JSON.stringify(v))`;
  const data = ab(['eval', '--stdin'], script);
  return JSON.parse(data.result);
}

/** `token=` hex-encoded (as inside `enc_url` params), built at runtime so this file never contains it. */
const TOKEN_HEX = Buffer.from('token=').toString('hex');
/** Signed links: hex `enc_url` params and `token=`, plain or hex-encoded. */
const SIGNED = new RegExp(`enc_url|token=|${TOKEN_HEX}`, 'i');
/** Anything that looks like a credential: signed links, channel tokens, nonces. */
const SECRET = new RegExp(`v2:[0-9a-f-]{20,}|authenticity_token|X-Fetch-Nonce|Channel"|"eyJ|${SIGNED.source}`, 'i');

/** Removes signed live-update channel tokens and signed raw-file links. */
function strip(value) {
  if (Array.isArray(value)) return value.map(strip);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (/Channel$/.test(k) || k === 'renderInfo') continue;
      out[k] = strip(v);
    }
    return out;
  }
  if (typeof value === 'string' && SIGNED.test(value)) return '<stripped>';
  return value;
}

function save(name, value) {
  const text = JSON.stringify(strip(value), null, 1) + '\n';
  if (SECRET.test(text)) throw new Error(`${name}: looks like it holds a nonce/token`);
  writeFileSync(join(outDir, name), text);
  console.log(`saved ${name} (${text.length} bytes)`);
}

/** GitHub's own client encoding (R§1.2), same as src/shared/rpc.ts diffEntriesRaw. */
const pathsQuery = (paths, extra) =>
  ['paths=' + encodeURIComponent(paths.map(encodeURIComponent).join(',')), ...Object.entries(extra).map(([k, v]) => `${k}=${encodeURIComponent(v)}`)].join('&');

mkdirSync(outDir, { recursive: true });

// 1. Load the PR page and let GitHub's own client fetch every diff (scrolling triggers the lazy batches).
ab(['network', 'requests', '--clear']);
ab(['open', prUrl]);
for (let i = 0; i < 10; i++) {
  ab(['scroll', 'down', '3000']);
  ab(['wait', '700']);
}
const githubUrls = ab(['network', 'requests', '--filter', 'page_data/diff_entries'])
  .requests.map((r) => r.url)
  .filter((u) => u.startsWith(`https://github.com${prPath}/page_data/diff_entries?`))
  .map((u) => u.slice('https://github.com'.length));

// 2. Route JSON.
const route = inPage(`return (await get(params.prPath + '/changes', '', true)).data;`, { prPath });
const changes = route.payload.pullRequestsChangesRoute;
const headOid = changes.comparison.fullDiff.headOid;
const paths = changes.diffSummaries.map((s) => s.path);
const threadCount = Object.keys(changes.markers.threads).length;
if (threadCount < 3) {
  console.warn(`WARNING: only ${threadCount} review threads on the sandbox PR. Post the threads first (see the header of this script).`);
}

// 3. Everything else, in one page eval.
const captured = inPage(
  `
  const base = params.prPath + '/page_data/';
  const entries = {};
  for (const w of ['0', '1']) {
    const q = params.queries[w];
    entries[w] = await get(base + 'diff_entries', q);
  }
  const lines = await get(base + 'diff_entry_lines', 'path=' + encodeURIComponent(params.linesPath) + '&w=0');
  const threadPages = [];
  let next = base + 'threads', query = '';
  while (next) {
    const page = await get(next, query);
    threadPages.push(page);
    const m = /<([^>]+)>;\\s*rel="next"/.exec(page.link || '');
    if (!m) break;
    const u = new URL(m[1], location.origin);
    next = u.pathname; query = u.search.slice(1);
  }
  const previews = await get(base + 'thread_previews', '');
  const ids = threadPages.flatMap((p) => p.data.threads.map((t) => t.id));
  const positioning = await get(base + 'thread_preview_positioning', 'thread_ids=' + ids.join(','));
  return {entries, lines, threadPages, previews, positioning};
  `,
  {
    prPath,
    linesPath: 'src/obsolete.ts',
    queries: { 0: pathsQuery(paths, { w: '0' }), 1: pathsQuery(paths, { w: '1' }) },
  },
);

save('route.json', route);
save('diff-entries-w0.json', captured.entries['0']);
save('diff-entries-w1.json', captured.entries['1']);
save('diff-entry-lines.json', { path: 'src/obsolete.ts', ...captured.lines });
save('threads.json', { pages: captured.threadPages });
save('thread-previews.json', captured.previews);
save('thread-preview-positioning.json', captured.positioning);
save('github-requests.json', {
  note: "diff_entries URLs (path + query) requested by GitHub's own client while loading the PR page.",
  diffEntries: githubUrls,
});
save('meta.json', { capturedAt: new Date().toISOString(), pr: sandbox, headOid, files: paths.length, threads: threadCount });
