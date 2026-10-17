/**
 * Viewer e2e (Task 7), read-only, on the private sandbox PR (tests/sandbox.json) and react/react#37778.
 * Setup and run instructions: playwright.config.ts.
 */
import { expect, githubViewedCount, openPierre, prUrl, REACT, SANDBOX, test, Viewer } from './fixtures';

test.describe.configure({ mode: 'serial' });

const BINARY = 'assets/added.png';
const TOO_LARGE = 'generated/big.generated.ts';
const PURE_RENAME = 'src/legacy/renamed-pure.ts';
const CHANGED_RENAME = 'src/modern/helper-renamed.ts';
const DELETED = 'src/obsolete.ts';
/** Pierre's `data-diff-type` for the unified layout. */
const UNIFIED = 'single';

/** Resets settings the tests change, through the viewer's own settings store (persists to storage.sync). */
async function resetSettings(viewer: Viewer) {
  await viewer.frame().evaluate(() =>
    window.__pierre!.settings.getState().update({ diff: { diffStyle: 'split' }, tree: { initialExpansion: 'closed' }, review: { hideWhitespace: false } }),
  );
}

test.describe('sandbox PR', () => {
  test('Glide tab is visible right after Files changed', async ({ page }) => {
    await page.goto(prUrl(SANDBOX), { waitUntil: 'domcontentloaded' });
    const tab = page.locator('a[data-pierre-tab]');
    await expect(tab).toBeVisible({ timeout: 30_000 });
    await expect(tab).toHaveText(/Glide/);
    const previous = await tab.evaluate((el) => el.previousElementSibling?.textContent ?? '');
    expect(previous).toMatch(/Files changed/);
  });

  test('clicking it shows the tree with all files', async ({ page }) => {
    const viewer = await openPierre(page, SANDBOX, 'click');
    expect(page.url()).toMatch(/#glide$/);
    const order = await viewer.order();
    expect(order).toHaveLength(20);

    // Open every folder through the Display menu, then read every file row of the (virtualized) tree.
    await viewer.locator.getByTestId('display-menu').click();
    await viewer.locator.getByLabel('Folders start').selectOption('open');
    await page.keyboard.press('Escape');
    await expect.poll(() => viewer.treeFiles().then((f) => f.length), { timeout: 15_000 }).toBe(order.length);
    expect((await viewer.treeFiles()).sort()).toEqual([...order].sort());
    await resetSettings(viewer);
  });

  test('every sandbox file eventually renders a Pierre diff', async ({ page }) => {
    const viewer = await openPierre(page, SANDBOX, 'hash');
    await viewer.allFetched();
    for (const path of await viewer.order()) {
      await viewer.scrollToFile(path);
      await expect
        .poll(async () => {
          const [info, load] = await Promise.all([viewer.item(path), viewer.loads().then((l) => l[path]!)]);
          if (!info) return 'not rendered';
          if (load.status === 'binary') return info.header.includes('Binary file not shown') ? 'ok' : 'binary without placeholder';
          if (load.status === 'too-large') return info.header.includes('Load diff') ? 'ok' : 'too-large without button';
          if (load.status === 'loaded' && load.empty) return /renamed without changes|No changes/.test(info.header) ? 'ok' : 'empty without note';
          if (load.status === 'loaded') return info.lines > 0 ? 'ok' : 'no lines';
          return load.status;
        }, { message: path, timeout: 20_000 })
        .toBe('ok');
    }
  });

  test('renders placeholders: too large, binary, rename', async ({ page }) => {
    const viewer = await openPierre(page, SANDBOX, 'hash');
    await viewer.allFetched();

    await viewer.scrollToFile(BINARY);
    await expect(viewer.locator.locator(`.fh[data-path="${BINARY}"]`)).toContainText('Binary file not shown');

    await viewer.scrollToFile(PURE_RENAME);
    const pure = viewer.locator.locator(`.fh[data-path="${PURE_RENAME}"]`);
    await expect(pure.getByTestId('prev-path')).toHaveText(/\S/);
    await expect(pure).toContainText('→');
    await expect(pure).toContainText('File renamed without changes');

    await viewer.scrollToFile(CHANGED_RENAME);
    const changed = viewer.locator.locator(`.fh[data-path="${CHANGED_RENAME}"]`);
    await expect(changed.getByTestId('prev-path')).toHaveText(/\S/);
    await expect.poll(async () => (await viewer.item(CHANGED_RENAME))?.lines ?? 0).toBeGreaterThan(0);

    // Deleted files come back collapsed from GitHub and load lazily near the viewport.
    await viewer.scrollToFile(DELETED);
    await expect.poll(async () => (await viewer.item(DELETED))?.lines ?? 0, { timeout: 20_000 }).toBeGreaterThan(0);

    await viewer.scrollToFile(TOO_LARGE);
    const big = viewer.locator.locator(`.fh[data-path="${TOO_LARGE}"]`);
    await expect(big.getByTestId('load-diff')).toBeVisible();
    expect((await viewer.item(TOO_LARGE))!.lines).toBe(0);
    // GitHub returns no lines for this file (its own UI says "Diff is too big to render"), and the full files
    // (~644 KB each, 1.29 M chars combined) are over the viewer's 1 M-char cap: Pierre says so and links to GitHub.
    await big.getByTestId('load-diff').click();
    await expect(big.getByTestId('too-big')).toContainText('Diff is too big to render', { timeout: 30_000 });
    await expect(big.getByRole('link', { name: 'Open on GitHub' })).toHaveAttribute(
      'href',
      new RegExp(`^${prUrl(SANDBOX, '/changes')}#diff-[0-9a-f]{64}$`),
    );
    expect((await viewer.loads())[TOO_LARGE]).toMatchObject({ status: 'too-large', tooBig: true });
  });

  test('"Load diff" renders a too-large file when its full files fit', async ({ page }) => {
    // Serve small versions of the file's raw contents (inside this browser only) so the fallback diff runs.
    let headOid = '';
    await page.route(
      (url) => url.pathname.includes('/raw/') && url.pathname.endsWith(`/${TOO_LARGE}`),
      (route) => {
        const head = headOid !== '' && route.request().url().includes(`/raw/${headOid}/`);
        const lines = Array.from({ length: 200 }, (_, i) => `export const v${i} = ${i};`);
        if (!head) lines[100] = 'export const changed = true;';
        return route.fulfill({ status: 200, contentType: 'text/plain', body: lines.join('\n') + '\n' });
      },
    );
    const viewer = await openPierre(page, SANDBOX, 'hash');
    headOid = await viewer.frame().evaluate(() => window.__pierre!.store.getState().pr!.headOid);
    await viewer.allFetched();
    await viewer.scrollToFile(TOO_LARGE);
    const big = viewer.locator.locator(`.fh[data-path="${TOO_LARGE}"]`);
    await big.getByTestId('load-diff').click();
    await expect.poll(async () => (await viewer.loads())[TOO_LARGE]!.status, { timeout: 30_000 }).toBe('loaded');
    await viewer.scrollToFile(TOO_LARGE);
    await expect.poll(async () => (await viewer.item(TOO_LARGE))?.lines ?? 0, { timeout: 20_000 }).toBeGreaterThan(0);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('Split/Unified toggle re-renders without reload and persists after reload', async ({ page }) => {
    const viewer = await openPierre(page, SANDBOX, 'hash');
    await viewer.allFetched();
    const path = 'config/settings.json';
    await viewer.scrollToFile(path);
    await expect.poll(async () => (await viewer.item(path))?.diffType).toBe('split');

    await viewer.frame().evaluate(() => ((window as unknown as { __marker: number }).__marker = 42));
    await viewer.locator.getByRole('button', { name: 'Unified', exact: true }).click();
    await expect.poll(async () => (await viewer.item(path))?.diffType).toBe(UNIFIED);
    // Same document: no reload happened.
    expect(await viewer.frame().evaluate(() => (window as unknown as { __marker?: number }).__marker)).toBe(42);

    await page.reload({ waitUntil: 'domcontentloaded' });
    const again = new Viewer(page);
    await again.ready();
    await expect(again.locator.getByRole('button', { name: 'Unified', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await again.scrollToFile(path);
    await expect.poll(async () => (await again.item(path))?.diffType).toBe(UNIFIED);
    await resetSettings(again);
  });

  test('Hide whitespace refetches with w=1; the commit picker narrows the range', async ({ page }) => {
    const viewer = await openPierre(page, SANDBOX, 'hash');
    await viewer.allFetched();
    const WS = 'src/whitespace.ts';
    expect((await viewer.loads())[WS]).toMatchObject({ status: 'loaded', additions: 6, deletions: 6 });

    await viewer.locator.getByRole('button', { name: 'Hide whitespace' }).click();
    await expect.poll(async () => (await viewer.loads())[WS], { timeout: 30_000 }).toMatchObject({ status: 'loaded', empty: true, additions: 0 });
    await viewer.scrollToFile(WS);
    await expect(viewer.locator.locator(`.fh[data-path="${WS}"]`)).toContainText('No changes to show');
    await viewer.locator.getByRole('button', { name: 'Hide whitespace' }).click();
    await expect.poll(async () => (await viewer.loads())[WS], { timeout: 30_000 }).toMatchObject({ status: 'loaded', additions: 6 });

    // One commit: fewer files change, the rest show "No changes"; back to all commits restores them.
    await viewer.locator.getByTestId('range-picker').click();
    await viewer.locator.locator('.menu-item').nth(1).click(); // first commit
    await expect(viewer.locator.getByTestId('range-picker')).toHaveText(/1 commit: \w+/);
    await viewer.allFetched();
    const one = Object.values(await viewer.loads());
    expect(one.filter((l) => l.status === 'error')).toEqual([]);
    const unchanged = one.filter((l) => l.status === 'loaded' && l.empty).length;
    expect(unchanged).toBeGreaterThan(0);
    await viewer.locator.getByTestId('range-picker').click();
    await viewer.locator.getByRole('button', { name: /All commits/ }).click();
    await viewer.allFetched();
    expect(Object.values(await viewer.loads()).filter((l) => l.status === 'loaded' && l.empty).length).toBeLessThan(unchanged);
    await resetSettings(viewer);
  });

  test('selecting a tree item scrolls its diff into view', async ({ page }) => {
    const viewer = await openPierre(page, SANDBOX, 'hash');
    await viewer.allFetched();
    const path = 'src/util/math.ts';
    expect((await viewer.item(path))?.top ?? Infinity).toBeGreaterThan(600); // not on screen yet

    // Filter the tree, then click the file row.
    const search = viewer.locator.locator('file-tree-container').getByPlaceholder('Search…');
    await search.fill('math');
    await viewer.locator.locator(`file-tree-container [data-item-path="${path}"]`).click();
    await expect.poll(async () => (await viewer.item(path))?.top ?? Infinity, { timeout: 10_000 }).toBeLessThan(60);
  });

  test('viewed files are collapsed and the counter matches GitHub', async ({ page }) => {
    const github = await githubViewedCount(page, SANDBOX);
    let viewer = await openPierre(page, SANDBOX, 'hash');
    await expect.poll(() => viewer.viewedCounter()).toBe(`${github.viewed} / ${github.total} viewed`);

    // Without writing to GitHub: mark two files viewed in GitHub's route response, inside this browser only.
    const marked = ['config/settings.json', 'docs/guide.md'];
    await page.route(
      (url) => url.pathname === `/${SANDBOX.owner}/${SANDBOX.repo}/pull/${SANDBOX.number}/changes`,
      async (route) => {
        if (route.request().headers()['x-github-app-type'] !== 'dataRouter') return route.continue();
        const response = await route.fetch();
        const json = await response.json();
        for (const s of json.payload.pullRequestsChangesRoute.diffSummaries) if (marked.includes(s.path)) s.markedAsViewed = true;
        await route.fulfill({ response, json });
      },
    );
    await page.reload({ waitUntil: 'domcontentloaded' });
    viewer = new Viewer(page);
    await viewer.ready();
    await expect.poll(() => viewer.viewedCounter()).toBe(`${github.viewed + marked.length} / ${github.total} viewed`);
    await viewer.allFetched();
    for (const path of marked) {
      await viewer.scrollToFile(path);
      await expect.poll(async () => (await viewer.item(path))?.collapsed).toBe(true);
      expect((await viewer.item(path))!.lines).toBe(0);
      await expect(viewer.locator.locator(`.fh[data-path="${path}"] input[type="checkbox"]`)).toBeChecked();
    }
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });
});

test.describe('react/react#37778 (read-only)', () => {
  test('one early click on the Glide tab opens Glide while GitHub is still loading', async ({ page }) => {
    // GitHub re-renders its tab strip during load, re-injecting our tab between pointerdown and pointerup; a single
    // press as soon as the tab exists must still open Glide (no retry).
    await page.goto(prUrl(REACT), { waitUntil: 'commit' });
    const tab = page.locator('a[data-pierre-tab]');
    await tab.waitFor({ timeout: 30_000 });
    const box = (await tab.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect.poll(() => page.url(), { timeout: 10_000 }).toMatch(/#glide$/);
    await new Viewer(page).ready();
  });

  test('opens, lists every file, loads every diff, counter matches GitHub', async ({ page }) => {
    const github = await githubViewedCount(page, REACT);
    const started = Date.now();
    const viewer = await openPierre(page, REACT, 'hash');
    const firstHeaderMs = Date.now() - started;
    const order = await viewer.order();
    expect(order.length).toBe(github.total);
    await expect.poll(() => viewer.viewedCounter()).toBe(`${github.viewed} / ${github.total} viewed`);
    await viewer.allFetched(90_000);
    const allLoadedMs = Date.now() - started;
    const stats = await viewer.frame().evaluate(() => window.__pierreStats);
    test.info().annotations.push({
      type: 'timing',
      description: `after navigation: first header ${firstHeaderMs} ms, all files loaded ${allLoadedMs} ms; loader: first diff ${Math.round(stats!.firstDiffAt! - stats!.startedAt)} ms, all ${Math.round(stats!.doneAt! - stats!.startedAt)} ms, ${stats!.requests} requests`,
    });
    console.log(test.info().annotations.at(-1)!.description);
    const loads = await viewer.loads();
    expect(Object.values(loads).filter((l) => l.status === 'error')).toEqual([]);
  });
});
