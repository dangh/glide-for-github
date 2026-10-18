/**
 * "Replace Files changed with Glide" (`github.replaceFilesTab`), read-only, on the sandbox PR. Each test sets the
 * option in chrome.storage.sync from an extension page; afterAll removes it again.
 */
import type { BrowserContext, Page } from '@playwright/test';
import { expect, extensionId, prUrl, SANDBOX, test, Viewer } from './fixtures';

test.describe.configure({ mode: 'serial' });

/** Writes (or with null removes) the stored option, keeping every other stored setting. */
async function setReplace(context: BrowserContext, replaceFilesTab: boolean | null, back?: Page) {
  const ext = await context.newPage();
  await ext.goto(`chrome-extension://${extensionId()}/options.html`);
  await ext.evaluate(async (value) => {
    const stored = ((await chrome.storage.sync.get('pierre.settings'))['pierre.settings'] ?? {}) as Record<string, unknown>;
    if (value === null) delete stored.github;
    else stored.github = { replaceFilesTab: value };
    await chrome.storage.sync.set({ 'pierre.settings': stored });
  }, replaceFilesTab);
  await ext.close();
  await back?.bringToFront();
}

const filesTab = (page: Page) =>
  page.locator('nav a#prs-files-anchor-tab, nav a[href$="/changes"]:not([data-pierre-tab]), nav a[href$="/files"]:not([data-pierre-tab])').first();
const glideTab = (page: Page) => page.locator('a[data-pierre-tab]');
const viewerFrame = (page: Page) => page.locator('iframe[data-pierre-viewer]');
const pathAndHash = (page: Page) => {
  const u = new URL(page.url());
  return u.pathname + u.search + u.hash;
};
const base = new URL(prUrl(SANDBOX)).pathname;

test.afterAll(async ({ extContext }) => setReplace(extContext, null));

test('options page: a GitHub group with the option, off by default', async ({ extContext }) => {
  await setReplace(extContext, null);
  const page = await extContext.newPage();
  await page.goto(`chrome-extension://${extensionId()}/options.html`);
  const stored = () => page.evaluate(async () => ((await chrome.storage.sync.get('pierre.settings'))['pierre.settings'] as { github?: unknown } | undefined)?.github ?? null);
  await expect(page.getByRole('heading', { name: 'GitHub', exact: true })).toBeVisible();
  const option = page.getByRole('checkbox', { name: /^Replace Files changed with Glide/ });
  await expect(option).not.toBeChecked();
  await option.check();
  await expect.poll(stored).toEqual({ replaceFilesTab: true });
  await option.uncheck();
  await expect.poll(stored).toEqual({ replaceFilesTab: false });
  await page.close();
});

test('on: Files changed is hidden, Glide takes its place with the count, and turning it off restores it live', async ({ page, extContext }) => {
  await setReplace(extContext, null, page);
  await page.goto(prUrl(SANDBOX), { waitUntil: 'load' });
  // Measure once GitHub has filled in the tab counts (they widen the tabs).
  await expect(glideTab(page).locator('[data-pierre-counter]').first()).toBeVisible({ timeout: 30_000 });
  await expect(filesTab(page)).toBeVisible();
  const filesBox = (await filesTab(page).boundingBox())!;
  const filesHtml = await filesTab(page).evaluate((a) => a.outerHTML);
  const count = (await filesTab(page).locator('[data-component="CounterLabel"], .Counter').first().innerText()).trim();

  await setReplace(extContext, true, page);
  await expect(filesTab(page)).toBeHidden();
  await expect(glideTab(page)).toBeVisible();
  const glideBox = (await glideTab(page).boundingBox())!;
  expect(Math.abs(glideBox.x - filesBox.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(glideBox.y - filesBox.y)).toBeLessThanOrEqual(1);
  await expect(glideTab(page).locator('[data-pierre-counter]').first()).toHaveText(count);
  expect(pathAndHash(page)).toBe(base);

  await setReplace(extContext, false, page);
  await expect(filesTab(page)).toBeVisible();
  expect(await filesTab(page).evaluate((a) => a.outerHTML)).toBe(filesHtml);
});

for (const [name, link] of [
  ["GitHub's own Files changed link in the timeline (/files)", (page: Page) => page.locator(`main a[href="${base}/files"]`).first()],
  ['a /changes link', (page: Page) => page.locator('#e2e-files-link')],
] as const) {
  test(`on: a click on ${name} opens Glide on the current page`, async ({ page, extContext }) => {
    await setReplace(extContext, true, page);
    await page.goto(prUrl(SANDBOX), { waitUntil: 'load' });
    await expect(glideTab(page)).toBeVisible({ timeout: 30_000 });
    await page.evaluate((href) => {
      const a = Object.assign(document.createElement('a'), { href, textContent: 'Files changed link', id: 'e2e-files-link' });
      document.querySelector('main')!.prepend(a);
    }, `${base}/changes`);
    await expect(async () => {
      if (!page.url().endsWith('#glide')) await link(page).click({ timeout: 5_000 });
      expect(pathAndHash(page)).toBe(`${base}#glide`);
    }).toPass({ timeout: 30_000, intervals: [1_000, 2_000] });
    await new Viewer(page).ready();
    await expect(filesTab(page)).toBeHidden();
    await expect(glideTab(page)).toHaveAttribute('aria-current', 'page');
  });
}

test("on: loading Files changed directly opens Glide there; the Display menu's link opens GitHub's page, which stays", async ({ page, extContext }) => {
  await setReplace(extContext, true, page);
  for (const suffix of ['/changes', '/files']) {
    await page.goto(prUrl(SANDBOX, suffix), { waitUntil: 'domcontentloaded' });
    await expect.poll(() => new URL(page.url()).hash, { timeout: 30_000 }).toBe('#glide');
    expect(new URL(page.url()).pathname).toMatch(/\/pull\/\d+\/(changes|files)$/);
  }
  const viewer = new Viewer(page);
  await viewer.ready();
  await expect(filesTab(page)).toBeHidden();

  await viewer.locator.getByTestId('display-menu').click();
  const escape = viewer.locator.getByRole('link', { name: "Open GitHub's Files changed" });
  await expect(escape).toBeVisible();
  await escape.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/replace-files-escape-hatch.png' });
  await escape.click();
  await expect.poll(() => pathAndHash(page), { timeout: 30_000 }).toBe(`${base}/changes?glide=off`);
  await page.waitForLoadState('load');
  await expect(page.getByText(/\d+ of \d+ files? viewed/).first()).toBeVisible({ timeout: 30_000 });
  await expect(filesTab(page)).toBeVisible();
  // GitHub's page settles without Glide taking over again.
  await page.waitForTimeout(3_000);
  expect(pathAndHash(page)).toBe(`${base}/changes?glide=off`);
  await expect(viewerFrame(page)).toHaveCount(0);
});

test('on: a soft navigation (Back) to Files changed through GitHub\'s router opens Glide there', async ({ page, extContext }) => {
  await setReplace(extContext, null, page);
  await page.goto(prUrl(SANDBOX), { waitUntil: 'load' });
  await expect(glideTab(page)).toBeVisible({ timeout: 30_000 });
  await expect(async () => {
    if (!page.url().endsWith('/changes')) await filesTab(page).click({ timeout: 5_000 });
    expect(pathAndHash(page)).toBe(`${base}/changes`);
  }).toPass({ timeout: 30_000, intervals: [1_000, 2_000] });
  await page.locator(`nav a[href="${base}"]`).first().click();
  await expect.poll(() => pathAndHash(page), { timeout: 30_000 }).toBe(base);

  await setReplace(extContext, true, page);
  await expect(filesTab(page)).toBeHidden();
  await page.goBack();
  await expect.poll(() => pathAndHash(page), { timeout: 30_000 }).toBe(`${base}/changes#glide`);
  await new Viewer(page).ready();
  await expect(glideTab(page)).toHaveAttribute('aria-current', 'page');
});

test("off: today's behavior, Files changed loads GitHub's page", async ({ page, extContext }) => {
  await setReplace(extContext, null, page);
  await page.goto(prUrl(SANDBOX, '/changes'), { waitUntil: 'load' });
  await expect(glideTab(page)).toBeVisible({ timeout: 30_000 });
  await expect(filesTab(page)).toBeVisible();
  await page.waitForTimeout(2_000);
  expect(new URL(page.url()).hash).toBe('');
  await expect(viewerFrame(page)).toHaveCount(0);
});
