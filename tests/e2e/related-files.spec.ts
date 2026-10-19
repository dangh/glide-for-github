/**
 * Related files, read-only, on microsoft/vscode#341674 ("Bump @github/copilot-sdk to 1.0.23-preview.0"): package.json
 * with package-lock.json at the root and again in remote/, and one snapshot file. Viewed there is answered locally
 * (route interception); the real Viewed sync of a group runs on the sandbox PR with a custom rule (build.py → extra.py,
 * two files the sandbox already has). Every stored Glide item is snapshotted first and put back in afterAll.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page, Route } from '@playwright/test';
import { expect, extensionPage, openPierre, prUrl, readGlideSync, ROOT, SANDBOX, setSettings, test, writeGlideSync, type PrId, type Viewer } from './fixtures';

test.describe.configure({ mode: 'serial' });

const VSCODE: PrId = { owner: 'microsoft', repo: 'vscode', number: 341674 };
const SNAPSHOT = 'src/vs/platform/agentHost/test/node/__snapshots__/Copilot_SDK_-_managed_settings_bundled_managedSettings_schema_matches_the_snapshot.schema.json';
const SHOTS = process.env.PIERRE_SHOTS ?? join(ROOT, '.superpowers/related-files');
mkdirSync(SHOTS, { recursive: true });

/** The diff list's files, in the order the CodeView lays them out. */
const listItems = (viewer: Viewer) =>
  viewer.frame().evaluate(() => {
    const view = window.__pierre!.session.codeView!;
    const ids = window.__pierre!.store.getState().order.filter((id) => view.getItem(id));
    const top = (id: string) => view.getInstance()!.getTopForItem(id)!;
    return ids.sort((a, b) => top(a) - top(b));
  });

/** Scrolls an item into view without unfolding it (the tree and `scrollToFile` unfold a folded file). */
const reveal = (viewer: Viewer, id: string) =>
  viewer.frame().evaluate((i) => window.__pierre!.session.codeView!.scrollTo({ type: 'item', id: i, align: 'center' }), id);

const header = (viewer: Viewer, path: string) => viewer.locator.locator(`.fh[data-path="${path}"]`);

const setCollapsed = (viewer: Viewer, path: string, collapsed: boolean) =>
  viewer.frame().evaluate(([p, c]) => window.__pierre!.store.getState().setCollapsed(p, c), [path, collapsed] as const);

/**
 * Each item's box (its `diffs-container`) and header, in the viewer's px, and `drift`: how far the box is drawn from
 * where CodeView laid the item out (`getTopForItem`), which every scroll offset relies on.
 */
const boxes = (viewer: Viewer, ids: readonly string[]) =>
  viewer.frame().evaluate((list) => {
    const view = window.__pierre!.session.codeView!.getInstance()!;
    const root = view.getContainerElement()!;
    const origin = root.getBoundingClientRect().top - root.scrollTop;
    return list.map((id) => {
      const fh = document.querySelector<HTMLElement>(`.fh[data-path="${CSS.escape(id)}"]`);
      const box = fh?.closest('diffs-container');
      if (!fh || !box) return null;
      const b = box.getBoundingClientRect();
      const h = fh.getBoundingClientRect();
      return { id, top: b.top, bottom: b.bottom, headerTop: h.top, headerBottom: h.bottom, drift: Math.round(b.top - origin - view.getTopForItem(id)!) };
    });
  }, ids);

/** Where a scroll to `id` landed: its header's distance from the top it should be at (the list's end clamps it). */
const scrolledTo = (viewer: Viewer, id: string) =>
  viewer.frame().evaluate((target) => {
    const view = window.__pierre!.session.codeView!.getInstance()!;
    const root = view.getContainerElement()!;
    const fh = document.querySelector<HTMLElement>(`.fh[data-path="${CSS.escape(target)}"]`);
    const box = fh?.closest('diffs-container');
    if (!fh || !box) return { found: false };
    const itemTop = view.getTopForItem(target)!;
    const scrollTop = Math.min(itemTop, root.scrollHeight - root.clientHeight);
    const rootTop = root.getBoundingClientRect().top;
    return {
      found: true,
      offset: Math.round(root.scrollTop - scrollTop),
      drift: Math.round(box.getBoundingClientRect().top - (rootTop + itemTop - root.scrollTop)),
    };
  }, id);

async function shoot(page: Page, name: string) {
  await page.mouse.move(5, 5);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

let saved: Record<string, unknown> = {};

test.beforeAll(async ({ extContext }) => {
  saved = await readGlideSync(extContext);
  await writeGlideSync(extContext, {});
});

test.afterAll(async ({ extContext }) => {
  await writeGlideSync(extContext, saved);
});

test.describe('related files', () => {
  test('nested (default): each lock file folds under its package.json, as a one-line row that opens its diff', async ({ page }) => {
    const viewer = await openPierre(page, VSCODE, 'hash');
    await viewer.allFetched();
    // GitHub's order: folders first, and package-lock.json before package.json.
    expect(await viewer.order()).toEqual(['remote/package-lock.json', 'remote/package.json', SNAPSHOT, 'package-lock.json', 'package.json']);
    await expect.poll(() => listItems(viewer)).toEqual(['remote/package.json', 'remote/package-lock.json', SNAPSHOT, 'package.json', 'package-lock.json']);

    await shoot(page, 'nested-light-wide-top');
    await viewer.scrollToFile('package.json');
    const lock = header(viewer, 'package-lock.json');
    await expect(lock).toHaveAttribute('data-related', 'companion');
    await expect(lock.locator('.fh-name')).toHaveText('package-lock.json');
    await expect(lock.locator('.fh-tag')).toHaveText('lock file');
    await expect(lock.locator('.fh-counts')).toHaveText('+36−36');
    await expect(lock.locator('.fh-viewed')).toHaveCount(0);
    expect(await viewer.item('package-lock.json')).toMatchObject({ collapsed: true, lines: 0 });
    await expect(header(viewer, 'package.json')).toHaveAttribute('data-related', 'main');
    await expect(header(viewer, SNAPSHOT)).not.toHaveAttribute('data-related');
    await shoot(page, 'nested-light-wide');

    await lock.getByRole('button', { name: 'Expand package-lock.json' }).click();
    await expect.poll(async () => (await viewer.item('package-lock.json'))?.lines ?? 0).toBeGreaterThan(0);
    await shoot(page, 'nested-light-wide-open');
    await lock.getByRole('button', { name: 'Collapse package-lock.json' }).click();
    await expect.poll(async () => (await viewer.item('package-lock.json'))?.collapsed).toBe(true);
  });

  test('nested: the tree puts each lock file right after its package.json, indented; a click there unfolds it', async ({ page }) => {
    const viewer = await openPierre(page, VSCODE, 'hash');
    await viewer.allFetched();
    const rows = await viewer.treeFiles();
    expect(rows.indexOf('package-lock.json')).toBe(rows.indexOf('package.json') + 1);
    expect(rows.indexOf('remote/package-lock.json')).toBe(rows.indexOf('remote/package.json') + 1);
    const indent = (path: string) =>
      viewer.locator.locator(`[data-item-path="${path}"] > [data-item-section="icon"]`).evaluate((el) => getComputedStyle(el).marginInlineStart);
    expect(await indent('package-lock.json')).toBe('12px');
    expect(await indent('package.json')).toBe('0px');

    expect(await viewer.item('remote/package-lock.json')).toMatchObject({ collapsed: true });
    await viewer.locator.locator('[data-item-path="remote/package-lock.json"]').click();
    await expect.poll(async () => (await viewer.item('remote/package-lock.json'))?.collapsed).toBe(false);
    await expect.poll(async () => (await viewer.item('remote/package-lock.json'))?.lines ?? 0).toBeGreaterThan(0);
  });

  test('nested: one Viewed for package.json and its lock file marks both on GitHub (answered locally), and comments open a folded file', async ({ page }) => {
    const marked: string[] = [];
    // Nothing reaches GitHub: the session's file_review and the token's mutations are answered here.
    const fileReview = async (route: Route) => {
      const body = JSON.parse(route.request().postData() ?? '{}') as { path?: string; _method?: string };
      marked.push(`${body._method === 'delete' || route.request().method() === 'DELETE' ? 'unmark' : 'mark'} ${body.path}`);
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    };
    const graphql = async (route: Route) => {
      const body = JSON.parse(route.request().postData() ?? '{}') as { query?: string; variables?: { input?: { path?: string } } };
      const op = /\{\s*((?:un)?markFileAsViewed)\(/.exec(body.query ?? '')?.[1];
      if (!op) return route.continue();
      marked.push(`${op === 'markFileAsViewed' ? 'mark' : 'unmark'} ${body.variables?.input?.path}`);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { [op]: { pullRequest: { id: 'PR_x' } } } }) });
    };
    await page.context().route(`${prUrl(VSCODE)}/file_review`, fileReview);
    await page.context().route('https://api.github.com/graphql', graphql);
    try {
      const viewer = await openPierre(page, VSCODE, 'hash');
      await viewer.allFetched();
      await viewer.scrollToFile('package.json');
      const viewed = header(viewer, 'package.json').locator('.fh-viewed input');
      await expect(viewed).not.toBeChecked();
      await viewed.click();
      await expect(viewed).toBeChecked();
      await expect.poll(() => [...marked].sort()).toEqual(['mark package-lock.json', 'mark package.json']);
      expect(await viewer.viewedCounter()).toMatch(/2\s*\/\s*5/);
      expect(await viewer.item('package.json')).toMatchObject({ collapsed: true });
      await shoot(page, 'nested-light-viewed');
      await viewed.click();
      await expect(viewed).not.toBeChecked();
      await expect.poll(() => marked.filter((m) => m.startsWith('unmark')).sort()).toEqual(['unmark package-lock.json', 'unmark package.json']);
      await expect(viewer.locator.locator('.toast-error')).toHaveCount(0);

      // "Comment on file" on the folded row opens the file with the comment box (nothing is posted).
      await reveal(viewer, 'package-lock.json');
      const lock = header(viewer, 'package-lock.json');
      await expect(lock).toBeVisible();
      expect(await viewer.item('package-lock.json')).toMatchObject({ collapsed: true });
      await lock.getByTestId('comment-on-file').click();
      await expect.poll(async () => (await viewer.item('package-lock.json'))?.collapsed).toBe(false);
      const composer = viewer.locator.locator('textarea').first();
      await expect(composer).toBeVisible();
      // The sticky header can cover the button: click it in place.
      await viewer.locator.getByRole('button', { name: 'Cancel' }).first().evaluate((b) => (b as HTMLButtonElement).click());
      await expect(viewer.locator.locator('textarea')).toHaveCount(0);
    } finally {
      await page.context().unroute(`${prUrl(VSCODE)}/file_review`, fileReview);
      await page.context().unroute('https://api.github.com/graphql', graphql);
    }
  });

  test('file groups: the pair nests in Manifest, which holds both; the snapshot alone in Tests shows as it is', async ({ page }) => {
    const viewer = await openPierre(page, VSCODE, 'hash');
    await viewer.allFetched();
    await viewer.locator.getByRole('tab', { name: /^Manifest \d+$/ }).click();
    await expect.poll(() => listItems(viewer)).toEqual(['remote/package.json', 'remote/package-lock.json', 'package.json', 'package-lock.json']);
    await expect(header(viewer, 'remote/package-lock.json')).toHaveAttribute('data-related', 'companion');
    await viewer.locator.getByRole('tab', { name: /^Tests \d+$/ }).click();
    await expect.poll(() => listItems(viewer)).toEqual([SNAPSHOT]);
    await viewer.locator.getByRole('tab', { name: /^All \d+$/ }).click();
  });

  test('a lock file whose package.json is in another group shows on its own (custom group of lock files)', async ({ page, extContext }) => {
    const ext = await extensionPage(extContext);
    await ext.evaluate(() => chrome.storage.sync.set({ 'pierre.fileGroups': 1, 'pierre.fileGroups.0': { label: 'Locks', patterns: '*-lock.json' } }));
    await ext.close();
    try {
      const viewer = await openPierre(page, VSCODE, 'hash');
      await viewer.locator.getByRole('tab', { name: /^Locks \d+$/ }).click();
      await expect.poll(() => listItems(viewer)).toEqual(['remote/package-lock.json', 'package-lock.json']);
      await expect(header(viewer, 'remote/package-lock.json')).not.toHaveAttribute('data-related');
      expect(await viewer.item('remote/package-lock.json')).toMatchObject({ collapsed: false });
      await viewer.locator.getByRole('tab', { name: /^All \d+$/ }).click();
    } finally {
      await writeGlideSync(extContext, {});
    }
  });

  test('the Display menu switches the style at once', async ({ page }) => {
    const viewer = await openPierre(page, VSCODE, 'hash');
    await viewer.locator.getByTestId('display-menu').click();
    const select = viewer.locator.getByRole('combobox', { name: 'Related files', exact: true });
    await expect(select).toHaveValue('nested');
    /** The gap above remote/package-lock.json, and how far it and its main file are drawn from where CodeView laid them out. */
    const gap = async () => {
      const [main, lock] = await boxes(viewer, ['remote/package.json', 'remote/package-lock.json']);
      return main && lock ? { gap: Math.round(lock.top - main.bottom), drift: [main.drift, lock.drift] } : null;
    };
    await viewer.scrollToFile('remote/package.json');
    await expect.poll(gap).toEqual({ gap: 0, drift: [0, 0] });
    await expect(select.locator('option')).toHaveText(['Nested', 'Off']);
    await select.selectOption('off');
    await expect.poll(() => listItems(viewer)).toEqual(await viewer.order());
    await expect(viewer.locator.locator('.fh[data-related]')).toHaveCount(0);
    await select.selectOption('nested');
    await viewer.scrollToFile('remote/package.json');
    await expect.poll(gap).toEqual({ gap: 0, drift: [0, 0] });
    await page.keyboard.press('Escape');
  });

  for (const style of ['nested', 'off'] as const) {
    test(`${style}: dark, narrow, and the tree on the right`, async ({ page, extContext }) => {
      await setSettings(extContext, 'relatedFiles', { style });
      try {
        await page.emulateMedia({ colorScheme: 'dark' });
        let viewer = await openPierre(page, VSCODE, 'hash');
        await viewer.allFetched();
        await viewer.scrollToFile('remote/package.json');
        await shoot(page, `${style}-dark-wide`);
        await page.setViewportSize({ width: 700, height: 900 });
        await viewer.scrollToFile('remote/package.json');
        await shoot(page, `${style}-dark-narrow`);
        await page.setViewportSize({ width: 1400, height: 900 });
        await page.emulateMedia({ colorScheme: 'light' });
        await setSettings(extContext, 'layout', { treePosition: 'right' }, page);
        viewer = await openPierre(page, VSCODE, 'hash');
        await viewer.allFetched();
        await viewer.scrollToFile('remote/package.json');
        await shoot(page, `${style}-light-tree-right`);
        await page.setViewportSize({ width: 700, height: 900 });
        await viewer.scrollToFile('remote/package.json');
        await shoot(page, `${style}-light-narrow`);
      } finally {
        await page.setViewportSize({ width: 1400, height: 900 });
        await page.emulateMedia({ colorScheme: null });
        await writeGlideSync(extContext, {});
      }
    });
  }

  test('sandbox, custom rules: a folded file shows its comment count and its thread when opened; Viewed of a group syncs with GitHub', async ({ page, extContext }) => {
    test.setTimeout(300_000);
    const rules = [
      { main: 'Tooltip.ts', companions: 'Button.ts' },
      { main: 'build.py', companions: 'extra.py' },
    ];
    const ext = await extensionPage(extContext);
    await ext.evaluate((r) => chrome.storage.sync.set({ 'pierre.relatedFiles': { rules: r } }), rules);
    await ext.close();
    const MAIN = 'scripts/build.py';
    const COMPANION = 'scripts/extra.py';
    let viewer = await openPierre(page, SANDBOX, 'hash');
    const rpc = (method: 'markViewed' | 'unmarkViewed', path: string) =>
      viewer.frame().evaluate(([m, p]) => window.__pierre!.session.rpc!.call(m, 'dangh', 'pierre-sandbox', 1, p), [method, path] as const);
    const before = await viewer.frame().evaluate(() => [...window.__pierre!.store.getState().viewed]);
    try {
      // Comments: Button.ts (one review thread) folds under Tooltip.ts and says so on its row.
      await viewer.scrollToFile('src/components/Tooltip.ts');
      const button = header(viewer, 'src/components/Button.ts');
      await expect(button).toHaveAttribute('data-related', 'companion');
      await expect(button.locator('.fh-comments')).toHaveText(/1/);
      expect(await viewer.item('src/components/Button.ts')).toMatchObject({ collapsed: true });
      await shoot(page, 'sandbox-nested-comments');
      // The tree is long here and virtualized: filter it to the file first.
      await viewer.locator.getByPlaceholder('Search…').fill('Button.ts');
      await viewer.locator.locator('[data-item-path="src/components/Button.ts"]').click();
      await expect.poll(async () => (await viewer.item('src/components/Button.ts'))?.collapsed).toBe(false);
      await expect(viewer.locator.locator('diffs-container').filter({ has: button }).locator('.thread')).toHaveCount(1);

      // Viewed: start from both not viewed, check the group, GitHub has both, uncheck, GitHub has neither.
      for (const p of [MAIN, COMPANION]) if (before.includes(p)) await rpc('unmarkViewed', p);
      if (before.includes(MAIN) || before.includes(COMPANION)) viewer = await openPierre(page, SANDBOX, 'hash');
      await viewer.scrollToFile(MAIN);
      const box = header(viewer, MAIN).locator('.fh-viewed input');
      await expect(box).not.toBeChecked();
      await box.click();
      await expect(box).toBeChecked();
      const github = async () => {
        const gh = await page.context().newPage();
        try {
          await gh.goto(prUrl(SANDBOX, '/changes'), { waitUntil: 'domcontentloaded' });
          return await gh.evaluate(() => {
            for (const el of document.querySelectorAll('script[data-target="react-app.embeddedData"]')) {
              const route = JSON.parse(el.textContent ?? '{}')?.payload?.pullRequestsChangesRoute;
              if (route) return Object.fromEntries((route.diffSummaries as { path: string; markedAsViewed: boolean }[]).map((d) => [d.path, d.markedAsViewed === true]));
            }
            return {};
          });
        } finally {
          await gh.close();
        }
      };
      await expect.poll(async () => { const v = await github(); return [v[MAIN], v[COMPANION]]; }, { timeout: 30_000 }).toEqual([true, true]);
      await page.bringToFront();
      await box.click();
      await expect(box).not.toBeChecked();
      await expect.poll(async () => { const v = await github(); return [v[MAIN], v[COMPANION]]; }, { timeout: 30_000 }).toEqual([false, false]);
      await expect(viewer.locator.locator('.toast-error')).toHaveCount(0);
    } finally {
      // Put GitHub's viewed state back as it was.
      try {
        for (const p of [MAIN, COMPANION]) await rpc(before.includes(p) ? 'markViewed' : 'unmarkViewed', p);
      } catch {
        // the viewer is gone; nothing more to restore from here
      }
      await writeGlideSync(extContext, {});
    }
  });

  test('options page: two styles with previews, and the rules editor with add, reorder, delete, reset and try paths', async ({ extContext }) => {
    const options = await extensionPage(extContext);
    try {
      const section = options.getByRole('region', { name: 'Related files' });
      await expect(section.getByRole('radio')).toHaveCount(2);
      await expect(section.getByRole('radio', { name: /Nested/ })).toBeChecked();
      await section.scrollIntoViewIfNeeded();
      await section.getByRole('radiogroup').screenshot({ path: `${SHOTS}/options-light.png` });

      await section.getByTestId('related-style-off').click();
      await expect.poll(() => options.evaluate(async () => ((await chrome.storage.sync.get('pierre.settings'))['pierre.settings'] as { relatedFiles?: unknown })?.relatedFiles)).toEqual({ style: 'off' });

      const rules = section.getByTestId('related-rule');
      const count = await rules.count();
      expect(count).toBeGreaterThan(10);
      await expect(section.getByRole('textbox', { name: 'Main file of rule 1', exact: true })).toHaveValue('package.json');

      // Try paths: the defaults relate the sample.
      const probe = section.getByTestId('related-probe-result');
      await expect(probe).toContainText('package.json ← package-lock.json');
      await expect(probe).toContainText('services/api/serverless.yml ← serverless-resources.yml');

      // Add a rule with ${basename}, move it up, see it in the probe, then reset.
      await section.getByRole('button', { name: 'Add rule' }).click();
      await expect(section.getByRole('alert')).toContainText(`Rule ${count + 1} needs a main file pattern.`);
      await section.getByRole('textbox', { name: `Main file of rule ${count + 1}`, exact: true }).fill('*.ts');
      await section.getByRole('textbox', { name: 'Related files of *.ts' }).fill('${basename}.test.ts');
      await section.getByRole('button', { name: 'Move *.ts up' }).click();
      await expect(section.getByRole('textbox', { name: `Main file of rule ${count}`, exact: true })).toHaveValue('*.ts');
      await section.getByRole('textbox', { name: 'Try paths, one per line' }).fill('src/a.ts\nsrc/a.test.ts\nsrc/b.test.ts');
      await expect(probe).toHaveText('src/a.ts ← a.test.ts');
      await expect(section.getByRole('status')).toHaveText('Saved');
      const stored = await options.evaluate(async () => (await chrome.storage.sync.get('pierre.relatedFiles'))['pierre.relatedFiles'] as { rules: { main: string }[] });
      expect(stored.rules.at(-2)).toEqual({ main: '*.ts', companions: '${basename}.test.ts' });

      // A pattern with a folder is refused and not saved.
      await section.getByRole('textbox', { name: 'Related files of *.ts' }).fill('test/${basename}.ts');
      await expect(section.getByRole('alert')).toContainText('names a folder');
      await section.getByRole('button', { name: 'Delete *.ts' }).click();
      await expect(rules).toHaveCount(count);
      await section.getByRole('button', { name: 'Reset to defaults' }).click();
      await expect.poll(() => options.evaluate(async () => (await chrome.storage.sync.get('pierre.relatedFiles'))['pierre.relatedFiles'])).toBeUndefined();

      await options.emulateMedia({ colorScheme: 'dark' });
      await section.getByTestId('related-style-nested').click();
      await section.getByRole('radiogroup').screenshot({ path: `${SHOTS}/options-dark.png` });
      await section.screenshot({ path: `${SHOTS}/options-dark-rules.png` });
      await options.setViewportSize({ width: 600, height: 900 });
      await section.scrollIntoViewIfNeeded();
      await options.screenshot({ path: `${SHOTS}/options-dark-narrow.png` });
    } finally {
      await options.close();
      await writeGlideSync(extContext, {});
    }
  });

  for (const style of ['nested'] as const) {
    for (const scheme of ['light', 'dark'] as const) {
      test(`${style}, ${scheme}: one box, its parts touching, and a 42 px main header, collapsed and expanded`, async ({ page, extContext }) => {
        await setSettings(extContext, 'relatedFiles', { style });
        try {
          await page.emulateMedia({ colorScheme: scheme });
          const viewer = await openPierre(page, VSCODE, 'hash');
          await viewer.allFetched();
          const main = 'remote/package.json';
          const lock = 'remote/package-lock.json';
          const parts = [main, lock];
          await viewer.scrollToFile(main);
          await expect.poll(async () => (await boxes(viewer, parts)).every((b) => b !== null)).toBe(true);

          const check = async (name: string) => {
            await shoot(page, `${style}-${scheme}-${name}`);
            const got = (await boxes(viewer, parts)).map((b) => b!);
            for (const b of got) expect(b.drift, `${b.id}: drawn where CodeView laid it out`).toBe(0);
            expect(got.slice(1).map((b, i) => Math.round(b.top - got[i]!.bottom)), 'no band between the parts').toEqual(got.slice(1).map(() => 0));
            const head = got[0]!;
            expect(Math.round(head.headerBottom - head.headerTop), 'the box header is any header').toBe(42);
            return got;
          };

          await setCollapsed(viewer, lock, true);
          await setCollapsed(viewer, main, true);
          const collapsed = await check('main-collapsed');
          const mainBox = collapsed.find((b) => b.id === main)!;
          expect(Math.round(mainBox.bottom - mainBox.top), 'a collapsed main file is its header alone').toBe(42);

          await setCollapsed(viewer, main, false);
          await expect.poll(async () => (await viewer.item(main))?.lines ?? 0).toBeGreaterThan(0);
          const expanded = await check('main-expanded');
          const headerTop = expanded[0]!.headerTop;

          // Opening and closing the lock file below leaves the box where it is.
          await header(viewer, lock).locator('.fh-chevron').click();
          await expect.poll(async () => (await viewer.item(lock))?.lines ?? 0).toBeGreaterThan(0);
          expect((await check('lock-expanded'))[0]!.headerTop).toBe(headerTop);
          await header(viewer, lock).locator('.fh-chevron').click();
          await expect.poll(async () => (await viewer.item(lock))?.collapsed).toBe(true);
          expect((await check('lock-collapsed'))[0]!.headerTop).toBe(headerTop);
        } finally {
          await page.emulateMedia({ colorScheme: null });
          await writeGlideSync(extContext, {});
        }
      });
    }
  }

  for (const style of ['nested', 'off'] as const) {
    test(`${style}: the tree scrolls every file's header to the top, also below a group`, async ({ page, extContext }) => {
      await setSettings(extContext, 'relatedFiles', { style });
      try {
        await page.setViewportSize({ width: 1400, height: 500 });
        const viewer = await openPierre(page, VSCODE, 'hash');
        await viewer.allFetched();
        for (const path of [SNAPSHOT, 'package.json', 'remote/package-lock.json', 'package-lock.json', 'remote/package.json']) {
          await viewer.scrollToFile(path);
          await expect.poll(() => scrolledTo(viewer, path), { message: `${path} at the top` }).toEqual({ found: true, offset: 0, drift: 0 });
        }
      } finally {
        await page.setViewportSize({ width: 1400, height: 900 });
        await writeGlideSync(extContext, {});
      }
    });
  }

  for (const style of ['off'] as const) {
    test(`${style}: the diff list and its headers`, async ({ page, extContext }) => {
      await setSettings(extContext, 'relatedFiles', { style });
      try {
        const viewer = await openPierre(page, VSCODE, 'hash');
        await viewer.allFetched();
        await shoot(page, `${style}-light-wide-top`);
        await viewer.scrollToFile('package.json');
        await expect.poll(() => listItems(viewer)).toEqual(await viewer.order());
        await expect(viewer.locator.locator('.fh[data-related]')).toHaveCount(0);
        await shoot(page, `${style}-light-wide`);
      } finally {
        await writeGlideSync(extContext, {});
      }
    });
  }
});
