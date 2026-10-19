/** Native document scrolling, sticky chrome, restoration, and merged-toolbar navigation. */
import type { Page } from '@playwright/test';
import { expect, extensionId, ON_SCREEN, openPierre, placement, prUrl, REACT, setExperiments, test, Viewer } from './fixtures';

const SHOTS = 'test-results/page-scroll';

const positions = (viewer: Viewer) => viewer.evaluate((_, root) => {
  const diffs = root.querySelector<HTMLElement>('.pierre-diffs')!;
  const toolbar = root.querySelector('.pierre-toolbar')!.getBoundingClientRect();
  const host = root.host.getBoundingClientRect();
  const native = [...document.querySelectorAll<HTMLElement>('header [data-component="PageHeader"]')]
    .filter(h => ['sticky', 'fixed'].includes(getComputedStyle(h).position));
  return {
    y: scrollY, atBottom: scrollY + innerHeight >= document.scrollingElement!.scrollHeight - 1,
    scrollable: document.scrollingElement!.scrollHeight - innerHeight,
    listTop: diffs.scrollTop, overflow: getComputedStyle(diffs).overflowY,
    hostBottom: host.bottom, hostLeft: host.left,
    bodyLeft: root.querySelector('.pierre-body')!.getBoundingClientRect().left,
    treeToggleLeft: root.querySelector('[data-testid="tree-toggle"]')!.getBoundingClientRect().left,
    toolbar: { top: toolbar.top, bottom: toolbar.bottom, left: toolbar.left, right: toolbar.right },
    treeTop: root.querySelector('.pierre-tree-pane')!.getBoundingClientRect().top,
    stuckHeader: [...root.querySelectorAll('.fh')].some(h => Math.abs(h.getBoundingClientRect().top - toolbar.bottom) <= 2),
    native: native.map(h => ({ display: getComputedStyle(h).display, bottom: h.getBoundingClientRect().bottom })),
    footer: getComputedStyle(document.querySelector('footer[role="contentinfo"]')!).display,
    title: root.querySelector<HTMLElement>('[data-testid="pr-title"]')?.innerText ?? null,
    height: innerHeight, width: document.documentElement.clientWidth,
  };
});

async function wheel(page: Page, dy: number, steps: number) {
  await page.mouse.move(900, 650);
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, dy);
    await page.waitForTimeout(25);
  }
  await page.waitForTimeout(500);
}

/** Record the real document during a reversal; the viewer must never become a second scroller. */
async function reversal(viewer: Viewer, direction: 1 | -1, run: () => Promise<void>) {
  await viewer.evaluate(() => {
    const state = { positions: [scrollY], running: true };
    Object.assign(window, { __scrollProbe: state });
    const tick = () => { if (state.running) { state.positions.push(scrollY); requestAnimationFrame(tick); } };
    requestAnimationFrame(tick);
  });
  await run();
  const samples = await viewer.evaluate(() => {
    const state = (window as unknown as { __scrollProbe: { positions: number[]; running: boolean } }).__scrollProbe;
    state.running = false;
    return state.positions;
  });
  expect(direction * (samples.at(-1)! - samples[0]!)).toBeGreaterThan(500);
  expect(samples.slice(1).filter((y, i) => direction * (y - samples[i]!) < -0.5)).toEqual([]);
  expect((await positions(viewer)).listTop).toBe(0);
}

test.afterAll(async ({ extContext }) => setExperiments(extContext, null));

test('options: merging the sticky header is an independent saved choice', async ({ extContext }) => {
  await setExperiments(extContext, null);
  const page = await extContext.newPage();
  try {
    await page.goto(`chrome-extension://${extensionId()}/options.html`);
    const merged = page.getByRole('checkbox', { name: /^Merge GitHub's sticky header/ });
    const stored = () => page.evaluate(async () => ((await chrome.storage.sync.get('pierre.settings'))['pierre.settings'] as { experiments?: unknown } | undefined)?.experiments ?? null);
    await expect(page.getByRole('checkbox', { name: /^Scroll with the page/ })).toHaveCount(0);
    await expect(merged).toBeEnabled();
    await expect(merged).not.toBeChecked();
    await merged.check();
    await expect.poll(stored).toEqual({ mergedBar: true });
    await merged.uncheck();
    await expect.poll(stored).toEqual({ mergedBar: false });
  } finally { await page.close(); }
});

test('page scrolling is always native; changing the merged bar updates an open tab', async ({ page, extContext }) => {
  await setExperiments(extContext, null, page);
  const viewer = await openPierre(page, REACT);
  expect((await positions(viewer)).overflow).toBe('visible');
  await viewer.evaluate(() => { Object.assign(window, { __layoutMarker: 42 }); });
  await wheel(page, 200, 12);
  await setExperiments(extContext, { mergedBar: true }, page);
  await expect(viewer.locator.getByTestId('pr-title')).toBeVisible();
  await setExperiments(extContext, { mergedBar: false }, page);
  await viewer.ready();
  await expect(viewer.locator.getByTestId('pr-title')).toHaveCount(0);
  expect(await viewer.evaluate(() => (window as unknown as { __layoutMarker: number }).__layoutMarker)).toBe(42);
  expect((await positions(viewer)).listTop).toBe(0);
});

for (const mergedBar of [false, true]) {
  test(`${mergedBar ? 'merged' : 'page'}: sticky headers, tree jump, scroll to top and end`, async ({ page, extContext }) => {
    await setExperiments(extContext, { mergedBar }, page);
    const viewer = await openPierre(page, REACT);
    const top = await positions(viewer);
    expect(top.scrollable).toBeGreaterThan(10_000);
    expect(top.listTop).toBe(0);
    await wheel(page, 200, 12);
    const down = await positions(viewer);
    expect(down.y).toBeGreaterThan(1000);
    expect(down.treeTop).toBe(down.toolbar.bottom);
    expect(down.stuckHeader).toBe(true);
    expect(down.listTop).toBe(0);
    expect(down.overflow).toBe('visible');
    if (mergedBar) {
      expect(down.toolbar.top).toBe(0);
      expect(down.native.every(h => h.display === 'none')).toBe(true);
    } else {
      const visible = down.native.filter(h => h.display !== 'none');
      expect(down.toolbar.top).toBe(Math.max(0, ...visible.map(h => h.bottom)));
    }
    const path = (await viewer.order())[100]!;
    const search = viewer.locator.locator('file-tree-container').getByPlaceholder('Search…');
    await search.fill(path.split('/').at(-1)!);
    await viewer.locator.locator(`file-tree-container [data-item-path="${path}"]`).click();
    await expect.poll(async () => Math.abs((await viewer.item(path))?.top ?? Infinity)).toBeLessThan(60);
    expect((await positions(viewer)).y).toBeGreaterThan(down.y);
    await search.fill('');
    await wheel(page, -800, 60);
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
    await viewer.scrollToFile((await viewer.order()).at(-1)!);
    await wheel(page, 300, 10);
    const end = await positions(viewer);
    expect(end.atBottom).toBe(true);
    expect(end.footer).toBe('none');
    expect(Math.abs(end.hostBottom - end.height)).toBeLessThanOrEqual(1);
  });
}

test('flicking past the end and immediately up does not pull the page back down', async ({ page, extContext }) => {
  await setExperiments(extContext, { mergedBar: false }, page);
  const viewer = await openPierre(page, REACT);
  await viewer.scrollToFile((await viewer.order()).at(-1)!);
  await wheel(page, 300, 10);
  await wheel(page, -300, 10);
  await wheel(page, 300, 30);
  expect((await positions(viewer)).atBottom).toBe(true);
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(50);
  await reversal(viewer, -1, () => wheel(page, -90, 30));
});

test('flicking past the top and immediately down does not pull the page back up', async ({ page, extContext }) => {
  await setExperiments(extContext, { mergedBar: false }, page);
  const viewer = await openPierre(page, REACT);
  await wheel(page, 200, 3);
  await wheel(page, -200, 10);
  expect((await positions(viewer)).y).toBe(0);
  await reversal(viewer, 1, () => wheel(page, 90, 30));
});

test('a reload restores the same file', async ({ page, extContext }) => {
  await setExperiments(extContext, { mergedBar: false }, page);
  let viewer = await openPierre(page, REACT, 'hash');
  const path = (await viewer.order())[80]!;
  await viewer.scrollToFile(path);
  await expect.poll(async () => Math.abs((await viewer.item(path))?.top ?? Infinity)).toBeLessThan(60);
  await page.waitForTimeout(500);
  viewer = await openPierre(page, REACT, 'hash');
  await expect.poll(async () => Math.abs((await viewer.item(path))?.top ?? Infinity)).toBeLessThan(60);
  expect((await positions(viewer)).listTop).toBe(0);
});

test('a toast stays on top before and after the toolbar sticks in both modes', async ({ page, extContext }) => {
  for (const mergedBar of [false, true]) {
    await setExperiments(extContext, { mergedBar }, page);
    const viewer = await openPierre(page, REACT);
    await viewer.evaluate(() => window.__pierre!.store.getState().setNotice({ kind: 'error', message: 'Could not reload the pull request.' }));
    for (const [dy, steps] of [[0, 0], [50, 2], [200, 12]]) {
      await wheel(page, dy!, steps!);
      await expect.poll(() => placement(page, viewer, '.toast')).toEqual(ON_SCREEN);
    }
  }
});

test('merged title, toolbar gutters, and leaving Glide restore GitHub chrome', async ({ page, extContext }) => {
  await setExperiments(extContext, { mergedBar: true }, page);
  const viewer = await openPierre(page, REACT);
  const githubTitle = await page.locator('header [data-component="PageHeader"] [data-component="TitleArea"]').first().innerText();
  await expect(viewer.locator.getByRole('button', { name: 'Split', exact: true })).toHaveCount(0);
  await expect(viewer.locator.getByRole('button', { name: 'Hide whitespace', exact: true })).toHaveCount(0);
  await expect(viewer.locator.locator('.pierre-toolbar > :last-child [data-testid="display-menu"]')).toHaveCount(1);
  await expect(viewer.locator.getByTestId('review-button')).toHaveText('Submit review');
  const top = await positions(viewer);
  expect(top.title).toBeNull();
  expect(top.hostLeft).toBeGreaterThan(0);
  expect(top.toolbar.left).toBe(top.hostLeft);
  expect(top.bodyLeft).toBe(top.hostLeft);
  await wheel(page, 200, 12);
  const down = await positions(viewer);
  expect(down.toolbar).toMatchObject({ top: 0, left: 0, right: down.width });
  expect(down.title).toContain('#37778');
  expect(down.title).toContain('Merged');
  expect(down.bodyLeft).toBe(down.hostLeft);
  expect(down.treeToggleLeft).toBe(down.hostLeft);
  const title = await viewer.locator.locator('.pr-title-text').innerText();
  expect(title).toBe(await viewer.evaluate(() => window.__pierre!.store.getState().pr!.title));
  expect(title).toContain('`');
  expect(githubTitle.replace(/\s+/g, ' ')).toContain(title.replaceAll('`', '').replace(/\s+/g, ' '));
  await expect(viewer.locator.locator('.pr-state-merged svg')).toHaveCount(1);
  await expect(viewer.locator.locator('.pr-summary-row [data-testid="range-picker"]')).toHaveText('All commits');
  await expect(viewer.locator.getByTestId('pr-branches')).toContainText(/merged 4 commits into\s*main\s*from\s*sebbie\/foundation/);
  await viewer.locator.locator('.pr-title-text').click();
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  expect(page.url()).toContain('#glide');
  await page.goBack();
  await expect(viewer.locator).toHaveCount(0);
  await page.evaluate(() => window.scrollTo(0, 2000));
  await expect.poll(() => page.evaluate(() => [...document.querySelectorAll<HTMLElement>('header [data-component="PageHeader"]')]
    .filter(h => ['sticky', 'fixed'].includes(getComputedStyle(h).position)).map(h => getComputedStyle(h).display)))
    .toEqual(['flex']);
  expect(page.url()).toBe(prUrl(REACT));
});
/** A merged public stack (github/gh-stack's own Stack #530): #529 is 4th of 5, #528 below it. */
const STACKED = { owner: 'github', repo: 'gh-stack', number: 529 };

test("merged bar: a stacked PR shows GitHub's stack button once stuck; its menu opens another PR of the stack in Glide", async ({ page, extContext }) => {
  await setExperiments(extContext, { mergedBar: true }, page);
  const viewer = await openPierre(page, STACKED, 'hash');
  // GitHub's own header carries the button while it is on screen; Glide's bar adds its compact one once stuck.
  await expect(page.locator('button[aria-label="Navigate pull request stack, position 4 of 5"]').first()).toHaveText('4/5');
  const button = viewer.locator.getByTestId('stack-button');
  await expect(button).toHaveCount(0);
  await page.evaluate(() => window.scrollTo(0, 2000));
  await expect(button).toHaveText('4/5');
  await expect(button).toHaveAttribute('aria-label', 'Navigate pull request stack, position 4 of 5');

  await button.click();
  const entries = viewer.locator.locator('.stack-list a');
  await expect(viewer.locator.locator('.stack-menu-title')).toHaveText('Stack #530');
  await expect(entries).toHaveCount(5);
  await expect(entries.locator('.stack-entry-desc')).toHaveText([/^#521 · /, /^#529 · /, /^#528 · /, /^#527 · /, /^#526 · /]);
  await expect(entries.nth(1)).toHaveAttribute('aria-current', 'page');
  await expect(viewer.locator.locator('.stack-base')).toHaveText('main');
  await page.screenshot({ path: `${SHOTS}/merged-stack-menu.png`, clip: { x: 0, y: 0, width: 800, height: 480 } });

  await entries.nth(2).click();
  await page.waitForURL('https://github.com/github/gh-stack/pull/528#glide');
  const next = new Viewer(page);
  await next.ready();
  await page.evaluate(() => window.scrollTo(0, 2000));
  await expect(next.locator.getByTestId('stack-button')).toHaveText('3/5');
});
