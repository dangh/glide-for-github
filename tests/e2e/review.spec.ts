/**
 * Threads and the inline composer, end to end on the sandbox PR ONLY (tests/sandbox.json, dangh/pierre-sandbox#1).
 *
 * - "typing keeps focus…" is read-only (a composer is opened and typed in, never posted).
 * - "writes…" posts with the token saved once in .e2e-profile's extension storage (`npm run e2e:token`); it is
 *   skipped when no token is stored. Every comment it creates carries a unique marker and is deleted at the end
 *   (also on failure), and a pending review it starts is discarded. Results are checked against GitHub's own
 *   data (`page_data/threads` + `thread_previews`, the endpoints GitHub's Files changed page reads) in a fresh
 *   github.com tab, and the first comment visually on GitHub's Files changed page.
 * The token is used only inside the extension (Pierre's own code); the test never reads its value. Resolve runs twice:
 * with the active (classic) token through the API, and with the fine-grained entries the setup saved in
 * `pierre.e2e.fineGrainedTokens` swapped in (GitHub refuses those, so Pierre falls back to the GitHub session).
 */
import type { Frame, Locator, Page, Request } from '@playwright/test';
import { expect, openPierre, prUrl, SANDBOX, test, type Viewer } from './fixtures';

const FILE = 'src/util/math.ts';
const PREFIX = 'pierre-e2e-';
const MARK = `${PREFIX}${Date.now().toString(36)}`;

interface GhComment {
  databaseId: number;
  body: string;
  state: string;
  reactionGroups?: { reaction: { content: string; viewerHasReacted: boolean }; totalCount: number }[];
}
interface GhThread {
  id: string;
  isResolved: boolean;
  comments: GhComment[];
  path?: string;
  line?: number | null;
  startLine?: number | null;
  diffSide?: string;
  startDiffSide?: string | null;
  subjectType?: string;
}

/** GitHub's own thread data for the sandbox PR (threads + positions), read with the browser's GitHub session. */
async function githubThreads(page: Page): Promise<GhThread[]> {
  const gh = await page.context().newPage();
  try {
    await gh.goto(prUrl(SANDBOX, '/changes'), { waitUntil: 'domcontentloaded' });
    return await gh.evaluate(async (base) => {
      const meta = (n: string) => document.querySelector<HTMLMetaElement>(`meta[name="${n}"]`)?.content;
      const headers: Record<string, string> = {
        Accept: 'application/json',
        'GitHub-Verified-Fetch': 'true',
        'X-Requested-With': 'XMLHttpRequest',
        'GitHub-Is-React': 'true',
      };
      const nonce = meta('fetch-nonce');
      if (nonce) headers['X-Fetch-Nonce'] = nonce;
      const get = async (u: string) => (await fetch(u, { headers, credentials: 'same-origin', cache: 'no-store' })).json();
      const threads: { id: string; isResolved: boolean; commentsData?: { comments: GhComment[] } }[] = [];
      let url: string | null = `${base}/page_data/threads`;
      for (let i = 0; url && i < 10; i++) {
        const res: Response = await fetch(url, { headers, credentials: 'same-origin', cache: 'no-store' });
        threads.push(...((await res.json()).threads ?? []));
        const next = /<([^>]+)>;\s*rel="next"/.exec(res.headers.get('link') ?? '');
        url = next ? next[1]! : null;
      }
      const previews: Record<string, unknown>[] = await get(`${base}/page_data/thread_previews`);
      const byId = new Map(previews.map((p) => [String(p.id), p]));
      return threads.map((t) => {
        const p = (byId.get(String(t.id)) ?? {}) as Record<string, unknown>;
        return {
          id: String(t.id),
          isResolved: t.isResolved,
          comments: t.commentsData?.comments ?? [],
          path: p.path as string,
          line: p.line as number,
          startLine: p.startLine as number | null,
          diffSide: p.diffSide as string,
          startDiffSide: p.startDiffSide as string | null,
          subjectType: p.subjectType as string,
        };
      });
    }, `/${SANDBOX.owner}/${SANDBOX.repo}/pull/${SANDBOX.number}`);
  } finally {
    await gh.close();
  }
}

/** The viewer's pending review as GitHub's Files changed page embeds it (`viewerPendingReview`); pending threads are not in page_data/threads. */
async function githubPendingReview(
  page: Page,
): Promise<{ id: unknown; threads: { id: string; bodies: string[]; state?: string; marker?: string; path?: string }[] } | null> {
  const gh = await page.context().newPage();
  try {
    await gh.goto(prUrl(SANDBOX, '/changes'), { waitUntil: 'domcontentloaded' });
    return await gh.evaluate(() => {
      for (const el of document.querySelectorAll('script[data-target="react-app.embeddedData"]')) {
        const route = JSON.parse(el.textContent ?? '{}')?.payload?.pullRequestsChangesRoute;
        if (!route) continue;
        const review = route.viewerPendingReview;
        if (!review?.id) return null;
        const threads = (review.comments ?? []).map((c: { threadId: string }) => {
          const t = route.markers?.threads?.[c.threadId];
          // Where the Files changed page puts it: the per-file markersMap key (e.g. "R18").
          let marker: string | undefined;
          let path: string | undefined;
          for (const s of route.diffSummaries ?? [])
            for (const [key, m] of Object.entries(s.markersMap ?? {}))
              if ((m as { threads?: { id: string }[] }).threads?.some((x) => String(x.id) === String(c.threadId))) [marker, path] = [key, s.path];
          return {
            id: String(c.threadId),
            bodies: (t?.commentsData?.comments ?? []).map((x: { body: string }) => x.body),
            state: t?.commentsData?.comments?.[0]?.state,
            marker,
            path,
          };
        });
        return { id: review.id, threads };
      }
      return null;
    });
  } finally {
    await gh.close();
  }
}

const threadWith = (threads: GhThread[], text: string) => threads.find((t) => t.comments.some((c) => c.body.includes(text)));

/** Whether an extension storage KEY exists (keys only; values are never read into the test). */
async function hasStorageKey(frame: Frame, key: string): Promise<boolean> {
  return frame.evaluate(async (k) => (await chrome.storage.local.getKeys()).includes(k), key);
}

/**
 * Makes the tokens object saved under `key` (e.g. `pierre.e2e.classicToken`) Pierre's active `pierre.tokens`, inside
 * the extension page: storage objects are copied there and never returned or logged. The previous `pierre.tokens`
 * is backed up to `pierre.e2e.activeBackup`; `restoreTokens` puts it back.
 */
async function activateTokens(frame: Frame, key: string): Promise<void> {
  const ok = await frame.evaluate(async (k) => {
    const got = await chrome.storage.local.get(['pierre.tokens', k, 'pierre.e2e.activeBackup']);
    if (!got[k]) return false;
    if (!got['pierre.e2e.activeBackup']) await chrome.storage.local.set({ 'pierre.e2e.activeBackup': got['pierre.tokens'] ?? {} });
    await chrome.storage.local.set({ 'pierre.tokens': got[k] });
    return true;
  }, key);
  expect(ok, `${key} missing from the e2e profile`).toBe(true);
}

async function restoreTokens(frame: Frame): Promise<void> {
  await frame.evaluate(async () => {
    const got = await chrome.storage.local.get('pierre.e2e.activeBackup');
    if (!got['pierre.e2e.activeBackup']) return;
    await chrome.storage.local.set({ 'pierre.tokens': got['pierre.e2e.activeBackup'] });
    await chrome.storage.local.remove('pierre.e2e.activeBackup');
  });
}

/**
 * Resolves then unresolves `thread` in Pierre, checking GitHub's `isResolved` after each and that Pierre never
 * prompted nor showed an error. Returns the write paths taken, in order: `graphql:(un)resolveReviewThread`
 * (Pierre's token API, from the viewer iframe) and `session:(un)resolve_thread` (GitHub's page_data endpoint, sent
 * by the bridge in the github.com page).
 */
async function resolveRoundTrip(page: Page, viewer: Viewer, thread: () => Locator, text: string): Promise<string[]> {
  const seen: string[] = [];
  const onRequest = (r: Request) => {
    if (r.url() === 'https://api.github.com/graphql') {
      const q = (JSON.parse(r.postData() ?? '{}').query as string | undefined) ?? '';
      const op = /\{\s*((?:un)?resolveReviewThread)\(/.exec(q)?.[1]; // the field call, not the input type name
      if (op) seen.push(`graphql:${op}`);
    } else if (/\/page_data\/(un)?resolve_thread$/.test(new URL(r.url()).pathname)) {
      seen.push(`session:${new URL(r.url()).pathname.split('/').pop()}`);
    }
  };
  page.on('request', onRequest);
  const dialog = viewer.locator.getByRole('dialog');
  try {
    await thread().getByRole('button', { name: 'Resolve conversation' }).click();
    await expect(thread().locator('.label-resolved')).toBeVisible();
    await expect.poll(async () => threadWith(await githubThreads(page), text)!.isResolved, { timeout: 30_000 }).toBe(true);
    await thread().locator('.thread-fold').click();
    await thread().getByRole('button', { name: 'Unresolve conversation' }).click();
    await expect(thread().locator('.label-resolved')).toHaveCount(0);
    await expect.poll(async () => threadWith(await githubThreads(page), text)!.isResolved, { timeout: 30_000 }).toBe(false);
    await expect(thread().locator('.thread-error')).toHaveCount(0);
    expect(await dialog.count()).toBe(0); // never prompted
  } finally {
    page.off('request', onRequest);
  }
  return seen;
}

async function tokenStored(frame: Frame): Promise<boolean> {
  return frame.evaluate(async () => (await chrome.storage.local.getKeys()).includes('pierre.tokens'));
}

const fileItem = (viewer: Viewer, path = FILE) => viewer.locator.locator(`diffs-container:has(.fh[data-path="${path}"])`);
const numberCell = (viewer: Viewer, line: number, side: 'additions' | 'deletions' = 'additions') =>
  fileItem(viewer).locator(`code[data-${side}] [data-column-number="${line}"]`);
const composer = (viewer: Viewer, key: string) => viewer.locator.locator(`.composer[data-draft-key="${key}"]`);

/** Hover the line number, click Pierre's gutter "+" (single line). Retried: a scroll that settles re-renders the window. */
async function plusOn(viewer: Viewer, line: number) {
  await numberCell(viewer, line).scrollIntoViewIfNeeded();
  const plus = fileItem(viewer).locator('[data-utility-button]');
  await expect(async () => {
    await numberCell(viewer, line).hover({ timeout: 2_000 });
    await plus.click({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
}

/** Drag over line numbers (Pierre line selection): opens a range composer. */
async function dragNumbers(page: Page, viewer: Viewer, from: number, to: number) {
  await numberCell(viewer, from).scrollIntoViewIfNeeded();
  const a = (await numberCell(viewer, from).boundingBox())!;
  const b = (await numberCell(viewer, to).boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 6 });
  await page.mouse.up();
}

async function openSandbox(page: Page): Promise<Viewer> {
  const viewer = await openPierre(page, SANDBOX, 'hash');
  await viewer.allFetched();
  await viewer.scrollToFile(FILE);
  await expect(numberCell(viewer, 11)).toBeVisible();
  return viewer;
}

/** Waits until the viewer shows a server-confirmed (refetched, non-provisional) comment containing `text`. */
async function confirmedInViewer(viewer: Viewer, text: string) {
  await expect
    .poll(
      () =>
        viewer.frame().evaluate(
          (t) => window.__pierre!.store.getState().threads.some((th) => !th.provisional && th.comments.some((c) => !c.provisional && c.body.includes(t))),
          text,
        ),
      { timeout: 30_000 },
    )
    .toBe(true);
}

test.describe('threads and the inline composer', () => {
  test('typing keeps focus, caret and text while files load and re-render (read-only)', async ({ page }) => {
    const viewer = await openSandbox(page);
    // Idle viewer: no CodeView item is re-rendered while nothing changes.
    const versions = () => viewer.frame().evaluate(() => {
      const s = window.__pierre!.store.getState();
      return s.order.map((p) => window.__pierre!.session.codeView!.getItem(p)?.version ?? 0).join(',');
    });
    await page.waitForTimeout(1000);
    const before = await versions();
    await page.waitForTimeout(1500);
    expect(await versions()).toBe(before);
    await plusOn(viewer, 13);
    const key = `${FILE}:additions:-13`;
    const box = composer(viewer, key).locator('textarea');
    await expect(box).toBeFocused();
    await page.keyboard.type('hello world');
    // Caret after "hello", tag the node to prove it is the same element afterwards.
    await viewer.frame().evaluate(() => {
      const el = document.activeElement as HTMLTextAreaElement & { __probe?: number };
      el.__probe = 42;
      el.setSelectionRange(5, 5);
    });
    const same = () =>
      viewer.frame().evaluate(() => {
        const el = document.activeElement as HTMLTextAreaElement & { __probe?: number };
        return { probe: el.__probe ?? null, tag: el.tagName, value: el.value, caret: el.selectionStart };
      });

    // 1. Every OTHER file's diff lands again (new diff objects → CodeView updateItem per file), as when a loader runs.
    const updated = await viewer.frame().evaluate((path) => {
      const s = window.__pierre!.store.getState();
      const others = s.order.filter((p) => p !== path && s.diffs.has(p));
      s.applyLoads(others.map((p) => ({ path: p, summary: s.files.get(p)!, load: s.load.get(p)!, diff: { ...s.diffs.get(p)! } })));
      return others.length;
    }, FILE);
    expect(updated).toBeGreaterThan(5);
    await page.waitForTimeout(300);
    expect(await same()).toEqual({ probe: 42, tag: 'TEXTAREA', value: 'hello world', caret: 5 });

    // 2. The composer's own file re-renders (its diff object replaced).
    await viewer.frame().evaluate((path) => {
      const s = window.__pierre!.store.getState();
      s.applyLoads([{ path, summary: s.files.get(path)!, load: s.load.get(path)!, diff: { ...s.diffs.get(path)! } }]);
    }, FILE);
    await page.waitForTimeout(300);
    expect(await same()).toEqual({ probe: 42, tag: 'TEXTAREA', value: 'hello world', caret: 5 });

    // 3. Typing continues at the caret.
    await page.keyboard.type(',');
    expect((await same()).value).toBe('hello, world');

    // 4. A real background reload of every diff (Hide whitespace refetches all files), while typing.
    const hide = viewer.locator.getByRole('button', { name: /whitespace/i }).first();
    await viewer.frame().evaluate(() => (document.activeElement as HTMLElement).dataset.keep = '1');
    await hide.click();
    await viewer.allFetched();
    // The toolbar click moved focus; the composer node itself must be the same, with its text.
    const kept = await viewer.frame().evaluate(() => {
      const el = document.querySelector<HTMLTextAreaElement & { __probe?: number }>('textarea[data-keep="1"]');
      return el ? { probe: el.__probe ?? null, value: el.value, connected: el.isConnected } : null;
    });
    expect(kept).toEqual({ probe: 42, value: 'hello, world', connected: true });
    await hide.click(); // restore
    await viewer.allFetched();

    // Nothing was posted; close the composer (Cancel discards the draft).
    await composer(viewer, key).getByRole('button', { name: 'Cancel' }).click();
    await expect(composer(viewer, key)).toHaveCount(0);
  });

  test('writes: comment, range + suggestion, file, reply, edit, react, resolve, delete, review (sandbox only)', async ({ page }) => {
    test.setTimeout(420_000);
    let viewer = await openSandbox(page);
    test.skip(!(await tokenStored(viewer.frame())), 'e2e writes pending token: run `npm run e2e:token` once');
    expect(prUrl(SANDBOX)).toBe('https://github.com/dangh/pierre-sandbox/pull/1'); // never post anywhere else
    // A pending review left by an earlier (interrupted) run would change the composer's buttons: discard it.
    const discarded = await viewer.frame().evaluate(() =>
      window.__pierre!.review.withApi('clean up', async (api) => {
        const pending = await api.pendingReview();
        if (pending) await api.deleteReview(pending.nodeId);
        return pending !== null;
      }),
    );
    if (discarded) viewer = await openSandbox(page);

    const single = `${MARK} single-line`;
    const range = `${MARK} range`;
    const fileLevel = `${MARK} file-level`;
    const reply = `${MARK} reply`;
    const edited = `${MARK} reply edited`;
    const reviewBody = `${MARK} review`;

    try {
      await test.step('single-line comment at R11 appears on GitHub at the same line', async () => {
        console.log('[e2e] step: single-line comment at R11 appears on GitHub at th');
        await plusOn(viewer, 11);
        const c = composer(viewer, `${FILE}:additions:-11`);
        await expect(c.locator('textarea')).toBeFocused();
        await page.keyboard.type(single);
        await c.getByRole('button', { name: 'Add single comment' }).click();
        await expect(c).toHaveCount(0);
        await expect(fileItem(viewer).locator('.thread', { hasText: single })).toBeVisible();
        await confirmedInViewer(viewer, single);
        const t = threadWith(await githubThreads(page), single);
        expect(t).toMatchObject({ path: FILE, line: 11, diffSide: 'RIGHT', subjectType: 'LINE' });
        expect([null, 11]).toContain(t!.startLine ?? null); // GitHub reports startLine = line for one line
        // Visually on GitHub's own Files changed page, opened at the file (GitHub virtualizes far-away files).
        const digest = await viewer.frame().evaluate((p) => window.__pierre!.store.getState().files.get(p)!.digest, FILE);
        const gh = await page.context().newPage();
        await gh.goto(prUrl(SANDBOX, `/changes#diff-${digest}`), { waitUntil: 'domcontentloaded' });
        // GitHub collapses the thread into an avatar marker on the line (right side); open it to show the comment.
        const region = gh.getByRole('region', { name: /src\/util\/math\.ts/ });
        const marker = region.locator('[class*="right-side"] img[alt="dangh"]').first();
        await expect(marker).toBeVisible({ timeout: 30_000 });
        expect(await marker.evaluate((img) => img.closest('tr, [role="row"]')?.textContent ?? '')).toContain('throw new RangeError');
        // And the text in GitHub's comments panel.
        await gh.getByRole('button', { name: /Open comments panel/ }).click();
        await expect(gh.getByText(single).first()).toBeVisible({ timeout: 30_000 });
        await gh.screenshot({ path: test.info().outputPath('github-single-line.png') });
        await gh.close();
      });

      await test.step('range R15-R17 with "Insert suggestion" appears on GitHub as a multi-line thread', async () => {
        console.log('[e2e] step: range R15-R17 with "Insert suggestion" appears on ');
        await dragNumbers(page, viewer, 15, 17);
        const c = composer(viewer, `${FILE}:additions:15-17`);
        await expect(c).toBeVisible();
        await c.getByRole('button', { name: 'Insert suggestion' }).click();
        const lines = await viewer.frame().evaluate((path) => {
          const d = window.__pierre!.store.getState().diffs.get(path)!;
          const h = d.hunks[0]!;
          return [15, 16, 17].map((n) => d.additionLines[h.additionLineIndex + n - h.additionStart]!.replace(/\n$/, ''));
        }, FILE);
        await expect(c.locator('textarea')).toHaveValue('```suggestion\n' + lines.join('\n') + '\n```');
        await c.locator('textarea').press('Control+Home');
        await page.keyboard.type(`${range}\n`);
        await expect(c.locator('.composer-target')).toHaveText('Comment on lines R15 to R17');
        await c.getByRole('button', { name: 'Add single comment' }).click();
        await expect(c).toHaveCount(0);
        // The line selection is released, so the next gutter "+" targets its own line.
        expect(await viewer.frame().evaluate(() => window.__pierre!.session.codeView!.getSelectedLines())).toBeNull();
        await confirmedInViewer(viewer, range);
        expect(threadWith(await githubThreads(page), range)).toMatchObject({ path: FILE, line: 17, startLine: 15, diffSide: 'RIGHT', subjectType: 'LINE' });
      });

      await test.step('file-level comment from the header appears on GitHub as a file thread', async () => {
        console.log('[e2e] step: file-level comment from the header appears on GitH');
        await fileItem(viewer).getByTestId('comment-on-file').click();
        const c = composer(viewer, `${FILE}:additions:-0`);
        await expect(c.locator('textarea')).toBeFocused();
        await page.keyboard.type(fileLevel);
        await page.keyboard.press('Control+Enter'); // primary action = Add single comment
        await expect(c).toHaveCount(0);
        await confirmedInViewer(viewer, fileLevel);
        expect(threadWith(await githubThreads(page), fileLevel)).toMatchObject({ path: FILE, subjectType: 'FILE' });
      });

      // By id: a resolved thread collapses and no longer shows its text.
      const threadId = await fileItem(viewer).locator('.thread', { hasText: single }).getAttribute('data-thread-id');
      expect(threadId).toMatch(/^\d+$/);
      const thread = () => fileItem(viewer).locator(`.thread[data-thread-id="${threadId}"]`);

      await test.step('reply, then edit the reply', async () => {
        console.log('[e2e] step: reply, then edit the reply');
        await thread().getByRole('button', { name: 'Reply…' }).click();
        await expect(thread().locator('textarea')).toBeFocused();
        await page.keyboard.type(reply);
        await thread().getByRole('button', { name: 'Reply', exact: true }).click();
        await confirmedInViewer(viewer, reply);
        expect(threadWith(await githubThreads(page), single)!.comments.map((c) => c.body)).toEqual([single, reply]);

        const comment = thread().locator('.comment', { hasText: reply });
        await comment.getByRole('button', { name: 'Edit' }).click();
        const box = comment.locator('textarea');
        await expect(box).toHaveValue(reply);
        await box.fill(edited);
        await comment.getByRole('button', { name: 'Update comment' }).click();
        await expect(thread().locator('.comment', { hasText: edited })).toBeVisible();
        await expect.poll(async () => threadWith(await githubThreads(page), single)!.comments.map((c) => c.body), { timeout: 30_000 }).toEqual([single, edited]);
      });

      await test.step('add and remove 👍', async () => {
        console.log('[e2e] step: add and remove 👍');
        const first = thread().locator('.comment').first();
        await first.getByRole('button', { name: 'Add reaction' }).click();
        await first.locator('.reaction-menu [data-reaction="THUMBS_UP"]').click();
        await expect(first.locator('.reactions > [data-reaction="THUMBS_UP"]')).toHaveText('👍 1');
        const thumbs = async () =>
          threadWith(await githubThreads(page), single)!.comments[0]!.reactionGroups?.find((g) => g.reaction.content === 'THUMBS_UP');
        await expect.poll(async () => (await thumbs())?.totalCount, { timeout: 30_000 }).toBe(1);
        expect((await thumbs())!.reaction.viewerHasReacted).toBe(true);
        await first.locator('.reactions > [data-reaction="THUMBS_UP"]').click();
        await expect(first.locator('.reactions > [data-reaction="THUMBS_UP"]')).toHaveCount(0);
        await expect.poll(async () => (await thumbs())?.totalCount ?? 0, { timeout: 30_000 }).toBe(0);
      });

      await test.step('resolve and unresolve with a fine-grained token: GitHub refuses it, Pierre falls back to the session', async () => {
        console.log('[e2e] step: resolve/unresolve (fine-grained token → session fallback)');
        // The active token is the user's fine-grained one (or the saved fine-grained entries, when present).
        const swap = await hasStorageKey(viewer.frame(), 'pierre.e2e.fineGrainedTokens');
        if (swap) await activateTokens(viewer.frame(), 'pierre.e2e.fineGrainedTokens');
        try {
          const paths = await resolveRoundTrip(page, viewer, thread, single);
          console.log(`[e2e] resolve paths: ${paths.join(' → ')}`);
          expect(paths).toEqual(['graphql:resolveReviewThread', 'session:resolve_thread', 'graphql:unresolveReviewThread', 'session:unresolve_thread']);
        } finally {
          if (swap) await restoreTokens(viewer.frame());
        }
      });

      await test.step('delete own reply', async () => {
        console.log('[e2e] step: delete own reply');
        const comment = thread().locator('.comment', { hasText: edited });
        await comment.getByRole('button', { name: 'Delete' }).click();
        await comment.getByRole('button', { name: 'Delete' }).click(); // confirm
        await expect(thread().locator('.comment', { hasText: edited })).toHaveCount(0);
        await expect.poll(async () => threadWith(await githubThreads(page), single)!.comments.map((c) => c.body), { timeout: 30_000 }).toEqual([single]);
      });

      await test.step('review comment: "Start a review", then only "Add review comment"; record GitHub REST single comment while pending', async () => {
        console.log('[e2e] step: review comment: "Start a review", then only "Add r');
        await plusOn(viewer, 18);
        const c = composer(viewer, `${FILE}:additions:-18`);
        await expect(c.locator('textarea')).toBeFocused();
        await page.keyboard.type(reviewBody);
        await c.getByRole('button', { name: 'Start a review' }).click();
        await expect(c).toHaveCount(0);
        await expect.poll(() => viewer.frame().evaluate(() => window.__pierre!.store.getState().pendingReview?.count ?? 0)).toBe(1);
        const pendingOnGithub = await githubPendingReview(page);
        expect(pendingOnGithub?.id).toBeTruthy();
        expect(pendingOnGithub!.threads).toEqual([expect.objectContaining({ bodies: [reviewBody], state: 'pending', marker: 'R18', path: FILE })]);
        await expect(fileItem(viewer).locator('.thread', { hasText: reviewBody }).locator('.label-pending')).toBeVisible();

        // A new composer now offers "Add review comment" as its action.
        await plusOn(viewer, 16);
        const c2 = composer(viewer, `${FILE}:additions:-16`);
        await expect(c2.getByRole('button', { name: 'Add review comment' })).toBeVisible();
        await expect(c2.getByRole('button', { name: 'Start a review' })).toHaveCount(0);
        await c2.getByRole('button', { name: 'Cancel' }).click();

        // What GitHub does with REST POST /pulls/{n}/comments while the viewer has a pending review.
        const probe = await viewer.frame().evaluate(async (body) => {
          const r = window.__pierre!.review;
          try {
            const res = await r.withApi('probe', (api) =>
              api.createComment({ path: 'src/util/math.ts', line: 16, side: 'additions', body, commitId: r.shownHeadOid() }),
            );
            return { ok: true as const, id: res.id };
          } catch (err) {
            const e = err as { kind?: string; status?: number; message?: string };
            return { ok: false as const, kind: e.kind, status: e.status, message: e.message };
          }
        }, `${MARK} probe single while pending`);
        console.log(`[e2e] REST single comment while a review is pending: ${JSON.stringify(probe)}`);
        test.info().annotations.push({ type: 'single-comment-while-pending', description: JSON.stringify(probe) });
        // Recorded 2026-10-17: 422 "user_id can only have one pending review per pull request". Hence
        // SINGLE_COMMENT_WHILE_PENDING = false (only "Add review comment" while a review is pending).
        expect(probe).toMatchObject({ ok: false, kind: 'validation', status: 422 });
        expect(probe.ok === false && probe.message).toContain('one pending review');
      });
    } finally {
      await cleanup(page, viewer.frame());
    }
  });
});

test.describe('resolve via the API with a classic token', () => {
  test('resolve and unresolve go through GitHub\'s API, no session fallback (needs pierre.e2e.classicToken)', async ({ page }) => {
    test.setTimeout(240_000);
    const viewer = await openSandbox(page);
    const frame = viewer.frame();
    test.skip(
      !(await hasStorageKey(frame, 'pierre.e2e.classicToken')),
      'No classic token in the e2e profile (pierre.e2e.classicToken): save one with the controller\'s setup to test the API path',
    );
    const text = `${MARK} classic resolve`;
    await activateTokens(frame, 'pierre.e2e.classicToken');
    try {
      await plusOn(viewer, 13);
      const c = composer(viewer, `${FILE}:additions:-13`);
      await expect(c.locator('textarea')).toBeFocused();
      await page.keyboard.type(text);
      await c.getByRole('button', { name: 'Add single comment' }).click();
      await confirmedInViewer(viewer, text);
      const id = await fileItem(viewer).locator('.thread', { hasText: text }).getAttribute('data-thread-id');
      const paths = await resolveRoundTrip(page, viewer, () => fileItem(viewer).locator(`.thread[data-thread-id="${id}"]`), text);
      expect(paths).toEqual(['graphql:resolveReviewThread', 'graphql:unresolveReviewThread']);
    } finally {
      await restoreTokens(frame);
      await cleanup(page, frame);
    }
  });
});

/** Deletes every comment carrying an e2e marker and discards the viewer's pending review (sandbox only). */
async function cleanup(page: Page, frame: Frame) {
  const leftovers = (await githubThreads(page))
    .flatMap((t) => t.comments)
    .filter((c) => c.body.startsWith(PREFIX) && c.state !== 'pending') // this run's and interrupted runs' leftovers
    .map((c) => c.databaseId);
  await frame.evaluate(async (ids) => {
    const r = window.__pierre!.review;
    await r.withApi('clean up', async (api) => {
      const pending = await api.pendingReview();
      if (pending) await api.deleteReview(pending.nodeId);
      for (const id of ids) await api.deleteComment(id).catch(() => undefined);
    });
  }, leftovers);
  const left = (await githubThreads(page)).flatMap((t) => t.comments).filter((c) => c.body.startsWith(PREFIX));
  expect(left, 'e2e comments left on the sandbox').toEqual([]);
}
