/**
 * The page-scrolling experiments (src/shared/page-scroll.ts), read-only, on react/react#37778 (167 files). Each test
 * sets the experiments in chrome.storage.sync from an extension page; afterAll removes them again.
 */
import type { BrowserContext, Page } from '@playwright/test';
import { expect, extensionId, openPierre, prUrl, REACT, test, Viewer } from './fixtures';

test.describe.configure({ mode: 'serial' });

const SHOTS = '.superpowers/scroll-flags';
type Experiments = { pageScroll: boolean; mergedBar: boolean } | null;

/**
 * Writes (or with null removes) the stored experiments, keeping every other stored setting, then brings `back` to
 * the front again (a background tab renders no frames, so it would not scroll).
 */
async function setExperiments(context: BrowserContext, experiments: Experiments, back?: Page) {
  const ext = await context.newPage();
  await ext.goto(`chrome-extension://${extensionId()}/options.html`);
  await ext.evaluate(async (value) => {
    const stored = ((await chrome.storage.sync.get('pierre.settings'))['pierre.settings'] ?? {}) as Record<string, unknown>;
    if (value) stored.experiments = value;
    else delete stored.experiments;
    await chrome.storage.sync.set({ 'pierre.settings': stored });
  }, experiments);
  await ext.close();
  await back?.bringToFront();
}

/** Page and list positions: everything the sync must keep consistent. */
async function positions(page: Page, viewer: Viewer) {
  const outer = await page.evaluate(() => {
    const wrapper = document.querySelector<HTMLElement>('[data-glide-scroll]');
    const iframe = document.querySelector<HTMLElement>('iframe[data-pierre-viewer]')!;
    const headers = [...document.querySelectorAll<HTMLElement>('header [data-component="PageHeader"]')];
    const title = headers.find((h) => getComputedStyle(h).position === 'static');
    const sticky = headers.find((h) => getComputedStyle(h).position !== 'static');
    return {
      scrollY: scrollY,
      atBottom: scrollY + innerHeight >= document.scrollingElement!.scrollHeight - 1,
      docScrollable: document.scrollingElement!.scrollHeight - innerHeight,
      wrapperTop: wrapper ? wrapper.getBoundingClientRect().top : null,
      iframeTop: iframe.getBoundingClientRect().top,
      iframeBottom: iframe.getBoundingClientRect().bottom,
      innerHeight,
      titleBottom: title ? title.getBoundingClientRect().bottom : null,
      sticky: sticky ? { display: getComputedStyle(sticky).display, height: sticky.getBoundingClientRect().height, style: sticky.getAttribute('style') } : null,
      footerDisplay: (() => { const f = document.querySelector('footer[role="contentinfo"]'); return f ? getComputedStyle(f).display : null; })(),
      wrapperBottom: wrapper ? wrapper.getBoundingClientRect().bottom : null,
    };
  });
  const inner = await viewer.frame().evaluate(() => {
    const root = document.querySelector<HTMLElement>('.pierre-diffs')!;
    const rootTop = root.getBoundingClientRect().top;
    const stuckHeader = [...document.querySelectorAll<HTMLElement>('.fh')].some((h) => Math.abs(h.getBoundingClientRect().top - rootTop) <= 2);
    return {
      listTop: root.scrollTop,
      overflowY: getComputedStyle(root).overflowY,
      scrollbar: getComputedStyle(root).scrollbarWidth,
      layout: document.documentElement.dataset.scrollLayout ?? null,
      treeTop: document.querySelector('.pierre-tree-pane')!.getBoundingClientRect().top,
      stuckHeader,
      title: document.querySelector<HTMLElement>('[data-testid="pr-title"]')?.innerText ?? null,
    };
  });
  return { ...outer, ...inner };
}

/** Mouse-wheel steps over the diff list, like a user scrolling. */
async function wheel(page: Page, dy: number, steps: number) {
  await page.mouse.move(900, 650);
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, dy);
    await page.waitForTimeout(25);
  }
  await page.waitForTimeout(800);
}

test.afterAll(async ({ extContext }) => setExperiments(extContext, null));

test('options page: an Experimental group whose merged bar needs page scrolling', async ({ extContext }) => {
  await setExperiments(extContext, null);
  const page = await extContext.newPage();
  await page.goto(`chrome-extension://${extensionId()}/options.html`);
  const stored = () => page.evaluate(async () => ((await chrome.storage.sync.get('pierre.settings'))['pierre.settings'] as { experiments?: unknown } | undefined)?.experiments ?? null);
  await expect(page.getByRole('heading', { name: 'Experimental' })).toBeVisible();
  const pageScroll = page.getByRole('checkbox', { name: /^Scroll with the page/ });
  const mergedBar = page.getByRole('checkbox', { name: /^Merge GitHub's sticky header/ });
  await expect(pageScroll).not.toBeChecked();
  await expect(mergedBar).toBeDisabled();

  await pageScroll.check();
  await expect(mergedBar).toBeEnabled();
  await expect.poll(stored).toEqual({ pageScroll: true });
  await mergedBar.check();
  await expect.poll(stored).toEqual({ pageScroll: true, mergedBar: true });
  await pageScroll.uncheck();
  await expect(mergedBar).toBeDisabled();
  await expect.poll(stored).toEqual({ pageScroll: false, mergedBar: true });
  await page.close();
});

test("both off: today's layout, and turning page scrolling on switches an open tab", async ({ page, extContext }) => {
  await setExperiments(extContext, null, page);
  const viewer = await openPierre(page, REACT);
  const off = await positions(page, viewer);
  expect(off.wrapperTop).toBeNull();
  expect(off.layout).toBeNull();
  expect(off.overflowY).toBe('auto');
  expect(off.scrollbar).not.toBe('none');
  expect(Math.abs(off.iframeBottom - off.innerHeight)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: `${SHOTS}/off.png` });

  await setExperiments(extContext, { pageScroll: true, mergedBar: false }, page);
  await expect.poll(() => page.locator('[data-glide-scroll="page"] iframe[data-pierre-viewer]').count()).toBe(1);
  await new Viewer(page).ready();
});

test("page scrolling: GitHub's header scrolls away, the tree and file headers stay sticky, page and list stay in sync", async ({ page, extContext }) => {
  await setExperiments(extContext, { pageScroll: true, mergedBar: false }, page);
  const viewer = await openPierre(page, REACT);
  const top = await positions(page, viewer);
  expect(top.layout).toBe('page');
  expect(top.scrollbar).toBe('none');
  expect(top.docScrollable).toBeGreaterThan(10_000);
  expect(top.scrollY).toBe(0);
  expect(top.listTop).toBe(0);
  await page.screenshot({ path: `${SHOTS}/page-top.png` });

  await wheel(page, 200, 12);
  const down = await positions(page, viewer);
  expect(down.titleBottom).toBeLessThan(0);
  // GitHub's sticky header shows, and the viewer sticks right below it.
  expect(down.sticky?.display).not.toBe('none');
  expect(down.sticky?.height).toBeGreaterThan(0);
  expect(Math.abs(down.iframeTop - down.sticky!.height)).toBeLessThanOrEqual(1);
  expect(down.listTop).toBeGreaterThan(1000);
  expect(Math.abs(down.listTop - (down.sticky!.height - down.wrapperTop!))).toBeLessThanOrEqual(1);
  expect(down.treeTop).toBe(top.treeTop);
  expect(down.stuckHeader).toBe(true);
  expect(down.overflowY).toBe('auto');
  await page.screenshot({ path: `${SHOTS}/page-stuck.png` });

  // A tree click scrolls the list and the page along with it.
  const path = (await viewer.order())[100]!;
  const search = viewer.locator.locator('file-tree-container').getByPlaceholder('Search…');
  await search.fill(path.split('/').at(-1)!);
  await viewer.locator.locator(`file-tree-container [data-item-path="${path}"]`).click();
  await expect.poll(async () => Math.abs((await viewer.item(path))?.top ?? Infinity), { timeout: 10_000 }).toBeLessThan(60);
  await page.waitForTimeout(500);
  const clicked = await positions(page, viewer);
  expect(clicked.listTop).toBeGreaterThan(down.listTop);
  expect(Math.abs(clicked.listTop - (clicked.sticky!.height - clicked.wrapperTop!))).toBeLessThanOrEqual(1);
  await search.fill('');

  // One upward wheel sequence that starts in the list brings GitHub's header back.
  await wheel(page, -800, 60);
  const back = await positions(page, viewer);
  expect(back.scrollY).toBe(0);
  expect(back.listTop).toBe(0);
  expect(back.sticky?.display).toBe('none');

  // Like GitHub's own Files changed page, the page ends with the diffs: GitHub's footer is hidden.
  await viewer.scrollToFile((await viewer.order()).at(-1)!);
  await page.waitForTimeout(1000);
  await wheel(page, 300, 10);
  const end = await positions(page, viewer);
  expect(end.atBottom).toBe(true);
  expect(end.footerDisplay).toBe('none');
  expect(Math.abs(end.wrapperBottom! - end.innerHeight)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: `${SHOTS}/page-end.png` });
});

test('page scrolling: a reload comes back to the same file', async ({ page, extContext }) => {
  await setExperiments(extContext, { pageScroll: true, mergedBar: false }, page);
  let viewer = await openPierre(page, REACT, 'hash');
  const path = (await viewer.order())[80]!;
  await viewer.scrollToFile(path);
  await expect.poll(async () => Math.abs((await viewer.item(path))?.top ?? Infinity), { timeout: 10_000 }).toBeLessThan(60);
  await page.waitForTimeout(500);

  viewer = await openPierre(page, REACT, 'hash');
  await expect.poll(async () => Math.abs((await viewer.item(path))?.top ?? Infinity), { timeout: 15_000 }).toBeLessThan(60);
  const restored = await positions(page, viewer);
  expect(Math.abs(restored.listTop - ((restored.sticky?.height ?? 0) - restored.wrapperTop!))).toBeLessThanOrEqual(1);
});

test("merged bar: GitHub's sticky header is hidden, Glide's toolbar shows the title, leaving the tab restores it", async ({ page, extContext }) => {
  await setExperiments(extContext, { pageScroll: true, mergedBar: true }, page);
  const viewer = await openPierre(page, REACT);
  const githubTitle = await page.locator('header [data-component="PageHeader"] [data-component="TitleArea"]').first().innerText();
  expect((await positions(page, viewer)).title).toBeNull(); // GitHub's own title is on screen

  await wheel(page, 200, 12);
  const down = await positions(page, viewer);
  expect(down.titleBottom).toBeLessThan(0);
  expect(down.sticky?.display).toBe('none');
  expect(down.iframeTop).toBe(0);
  expect(down.title).toContain('#37778');
  expect(down.title).toContain('Merged');
  const titleText = await viewer.locator.locator('.pr-title-text').innerText();
  expect(githubTitle.replace(/\s+/g, ' ')).toContain(titleText.replace(/\s+/g, ' '));
  await page.screenshot({ path: `${SHOTS}/merged-stuck.png` });

  // Leaving Glide (back to Conversation) shows GitHub's header again.
  await page.goBack();
  await expect(page.locator('iframe[data-pierre-viewer]')).toHaveCount(0);
  await page.evaluate(() => window.scrollTo(0, 2000));
  await expect
    .poll(() => page.evaluate(() => {
      const sticky = [...document.querySelectorAll<HTMLElement>('header [data-component="PageHeader"]')].find((h) => getComputedStyle(h).position !== 'static');
      return sticky ? { style: sticky.getAttribute('style'), display: getComputedStyle(sticky).display } : null;
    }))
    .toEqual({ style: null, display: 'flex' });
  expect(page.url()).toBe(prUrl(REACT));
});
