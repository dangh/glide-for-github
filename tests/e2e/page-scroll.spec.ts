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
      overscrollY: getComputedStyle(document.documentElement).overscrollBehaviorY,
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

/**
 * macOS Chrome rubber-bands a page flicked past its end; Linux Chrome does not, so this models it after Chromium's
 * ElasticOverscrollControllerExponential. While the bounce animates (kStateMomentumAnimated) the stretch follows
 * s(t) = (s0 + 0.31 v0 t) e^(-12.5 t) whatever else moves the page, and ReconcileStretchAndScroll scrolls the page back
 * to its end by up to s(t), before the main thread sees its next scroll event. A root with `overscroll-behavior-y: none`
 * does not stretch. Returns whether the page bounces.
 */
function bounceAtEnd(page: Page, s0 = 30, v0 = 2000) {
  return page.evaluate(([s0, v0]) => {
    if (getComputedStyle(document.documentElement).overscrollBehaviorY === 'none') return false;
    const start = performance.now();
    const reconcile = () => {
      const t = (performance.now() - start) / 1000;
      const stretch = Math.round((s0 + 0.31 * v0 * t) * Math.exp(-12.5 * t));
      if (stretch < 1) return removeEventListener('scroll', reconcile, { capture: true });
      const back = Math.min(stretch, document.scrollingElement!.scrollHeight - innerHeight - scrollY);
      if (back >= 1) scrollBy({ top: back, behavior: 'instant' });
    };
    addEventListener('scroll', reconcile, { capture: true });
    return true;
  }, [s0, v0]);
}

/**
 * macOS Chrome also rubber-bands a scroller that is not the root (kOverscrollEffectOnNonRootScrollers, on by default):
 * the scroller a gesture latched to, once a wheel step finds it at its top. This models it for the list as above: a
 * wheel step up that finds the list at its top, scrollable (`overflow-y: auto`) and with `overscroll-behavior-y` other
 * than none (which drops the overscroll, cc::InputHandler::ScrollUpdate) starts the stretch; from then on, every frame
 * and before the viewer sees a list scroll, ReconcileStretchAndScroll scrolls the list back to its top by up to s(t).
 * The flick in the test began mid-list, so on a trackpad Chrome latched all of it to the list.
 */
function bounceAtTop(viewer: Viewer, s0 = 30, v0 = 2000) {
  return viewer.frame().evaluate(([s0, v0]) => {
    const root = document.querySelector<HTMLElement>('.pierre-diffs')!;
    let start: number | null = null;
    const stretch = () => {
      const t = (performance.now() - start!) / 1000;
      return Math.round((s0 + 0.31 * v0 * t) * Math.exp(-12.5 * t));
    };
    const reconcile = () => {
      if (start === null) return;
      const s = stretch();
      if (s < 1) return removeEventListener('scroll', reconcile, { capture: true });
      if (root.scrollTop > 0) root.scrollTop -= Math.min(s, root.scrollTop);
    };
    const frame = () => {
      reconcile();
      if (start === null || stretch() >= 1) requestAnimationFrame(frame);
    };
    addEventListener('wheel', (e) => {
      const style = getComputedStyle(root);
      if (start === null && e.deltaY < 0 && root.scrollTop <= 0.5 && style.overflowY === 'auto' && style.overscrollBehaviorY !== 'none') {
        start = performance.now();
      }
    }, { capture: true, passive: true });
    addEventListener('scroll', reconcile, { capture: true });
    requestAnimationFrame(frame);
  }, [s0, v0]);
}

/**
 * Every position the list and the page take while `run` scrolls (at each scroll event, before the viewer or the page
 * reacts to it, and each frame), and how far each moved up along the way.
 */
async function upwardMoves(page: Page, viewer: Viewer, run: () => Promise<void>) {
  const record = (inFrame: boolean) => {
    const w = window as unknown as { glideTops: number[] | null };
    const root = document.querySelector<HTMLElement>('.pierre-diffs');
    const top = () => (inFrame ? root!.scrollTop : scrollY);
    w.glideTops = [top()];
    const push = () => w.glideTops?.push(top());
    addEventListener('scroll', push, { capture: true });
    const frame = () => {
      if (!w.glideTops) return removeEventListener('scroll', push, { capture: true });
      push();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  };
  const collect = () => {
    const w = window as unknown as { glideTops: number[] | null };
    const tops = w.glideTops!;
    w.glideTops = null;
    return tops;
  };
  await page.evaluate(record, false);
  await viewer.frame().evaluate(record, true);
  await run();
  const [pageTops, listTops] = [await page.evaluate(collect), await viewer.frame().evaluate(collect)];
  const ups = (tops: number[]) => tops.slice(1).map((t, i) => tops[i]! - t).filter((d) => d > 0.5);
  return { pageDown: pageTops.at(-1)! - pageTops[0]!, page: ups(pageTops), list: ups(listTops) };
}

/** How far the list moved down, frame by frame, while `run` scrolls it up. */
async function downwardMoves(viewer: Viewer, run: () => Promise<void>) {
  await viewer.frame().evaluate(() => {
    const root = document.querySelector<HTMLElement>('.pierre-diffs')!;
    const w = window as unknown as { glideTops: number[] | null };
    w.glideTops = [root.scrollTop];
    const frame = () => {
      if (!w.glideTops) return;
      w.glideTops.push(root.scrollTop);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  await run();
  const tops = await viewer.frame().evaluate(() => {
    const w = window as unknown as { glideTops: number[] | null };
    const tops = w.glideTops!;
    w.glideTops = null;
    return tops;
  });
  return { up: tops[0]! - tops.at(-1)!, down: tops.slice(1).map((t, i) => t - tops[i]!).filter((d) => d > 0.5) };
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
  expect(off.overscrollY).toBe('auto');
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

test('page scrolling: flicking past the end and straight back up does not pull the list back down', async ({ page, extContext }) => {
  await setExperiments(extContext, { pageScroll: true, mergedBar: false }, page);
  const viewer = await openPierre(page, REACT);
  await viewer.scrollToFile((await viewer.order()).at(-1)!);
  await page.waitForTimeout(1000);
  await wheel(page, 300, 10);
  // Up and back first: Pierre measures the files above the end, which moves the list without moving the diffs.
  await wheel(page, -300, 10);
  await wheel(page, 300, 30);
  expect((await positions(page, viewer)).atBottom).toBe(true);

  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(50);
  const cdp = await page.context().newCDPSession(page);
  const moves = await downwardMoves(viewer, async () => {
    await bounceAtEnd(page);
    // A trackpad flick: decaying deltas at half the display's frame rate (a 120 Hz MacBook Pro screen).
    for (let i = 0; i < 30; i++) {
      void cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 900, y: 650, deltaX: 0, deltaY: -Math.max(1, Math.round(90 * 0.92 ** i)) });
      await page.waitForTimeout(33);
    }
    await page.waitForTimeout(500);
  });
  expect(moves.up).toBeGreaterThan(500);
  expect(moves.down).toEqual([]);
});

test('page scrolling: flicking past the top and straight back down is not pulled back up', async ({ page, extContext }) => {
  await setExperiments(extContext, { pageScroll: true, mergedBar: false }, page);
  const viewer = await openPierre(page, REACT);
  await wheel(page, 200, 3);
  const start = await positions(page, viewer);
  expect(start.listTop).toBeGreaterThan(300);

  const cdp = await page.context().newCDPSession(page);
  // Trackpad flicks as above: up past the list's top, then straight back down while the list would still bounce.
  // DevTools sends each wheel event as a gesture of its own (phase began, then ended), so Chrome latches each anew, as
  // it does for a new swipe; the viewer sees one gesture, as it does on a trackpad.
  const flick = async (sign: number, steps: number) => {
    for (let i = 0; i < steps; i++) {
      void cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 900, y: 650, deltaX: 0, deltaY: sign * Math.max(1, Math.round(90 * 0.92 ** i)) });
      await page.waitForTimeout(33);
    }
  };
  await bounceAtTop(viewer);
  await flick(-1, 8);
  const top = await positions(page, viewer);
  expect(top.listTop).toBe(0);
  expect(top.scrollY).toBeLessThan(start.scrollY - start.listTop);

  const moves = await upwardMoves(page, viewer, async () => {
    await flick(1, 30);
    await page.waitForTimeout(500);
  });
  expect(moves.pageDown).toBeGreaterThan(500);
  expect({ page: moves.page, list: moves.list }).toEqual({ page: [], list: [] });
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
  // Like GitHub's Files changed toolbar: the diff toggles live in the Display menu, the gear ends the bar.
  await expect(viewer.locator.getByRole('button', { name: 'Split', exact: true })).toHaveCount(0);
  await expect(viewer.locator.getByRole('button', { name: 'Hide whitespace', exact: true })).toHaveCount(0);
  await expect(viewer.locator.locator('.pierre-toolbar > :last-child [data-testid="display-menu"]')).toHaveCount(1);
  await expect(viewer.locator.getByTestId('review-button')).toHaveText('Submit review');
  const edges = () =>
    Promise.all([
      page.evaluate(() => {
        const wrapper = document.querySelector('[data-glide-scroll]')!.getBoundingClientRect();
        const iframe = document.querySelector('iframe[data-pierre-viewer]')!.getBoundingClientRect();
        return { gutter: wrapper.left, iframeLeft: iframe.left, iframeWidth: iframe.width, viewport: document.documentElement.clientWidth };
      }),
      viewer.frame().evaluate(() => {
        const box = (sel: string) => document.querySelector(sel)!.getBoundingClientRect();
        return { toolbar: { left: box('.pierre-toolbar').left, width: box('.pierre-toolbar').width }, bodyLeft: box('.pierre-body').left, treeToggleLeft: box('[data-testid="tree-toggle"]').left };
      }),
    ]).then(([outer, inner]) => ({ ...outer, ...inner }));
  // The iframe spans the viewport; before it sticks the bar and the diffs keep GitHub's page gutters.
  const atTop = await edges();
  expect(atTop.gutter).toBeGreaterThan(0);
  expect(atTop.iframeLeft).toBe(0);
  expect(atTop.iframeWidth).toBe(atTop.viewport);
  expect(atTop.toolbar.left).toBe(atTop.gutter);
  expect(atTop.bodyLeft).toBe(atTop.gutter);

  await wheel(page, 200, 12);
  const down = await positions(page, viewer);
  expect(down.titleBottom).toBeLessThan(0);
  expect(down.sticky?.display).toBe('none');
  expect(down.iframeTop).toBe(0);
  expect(down.title).toContain('#37778');
  expect(down.title).toContain('Merged');
  // GitHub's sticky title is plain text: the backticks GitHub's page title renders as code stay.
  const titleText = await viewer.locator.locator('.pr-title-text').innerText();
  expect(titleText).toBe(await viewer.frame().evaluate(() => window.__pierre!.store.getState().pr!.title));
  expect(titleText).toContain('`');
  expect(githubTitle.replace(/\s+/g, ' ')).toContain(titleText.replaceAll('`', '').replace(/\s+/g, ' '));
  await expect(viewer.locator.locator('.pr-state-merged svg')).toHaveCount(1);
  await expect(viewer.locator.locator('.pr-summary-row [data-testid="range-picker"]')).toHaveText('All commits');
  await expect(viewer.locator.getByTestId('pr-branches')).toContainText(/merged 4 commits into\s*main\s*from\s*sebbie\/foundation/);
  // Stuck, the bar spans the viewport like GitHub's, its controls and the diffs still inside the gutters.
  const stuck = await edges();
  expect(stuck.toolbar).toEqual({ left: 0, width: stuck.viewport });
  expect(stuck.treeToggleLeft).toBe(stuck.gutter);
  expect(stuck.bodyLeft).toBe(stuck.gutter);
  await page.screenshot({ path: `${SHOTS}/merged-stuck.png` });

  // Like GitHub's sticky title, clicking it goes back to the top of the page (the list with it), keeping #glide.
  await viewer.locator.locator('.pr-title-text').click();
  await expect.poll(async () => (await positions(page, viewer)).scrollY).toBe(0);
  await expect.poll(async () => (await positions(page, viewer)).listTop).toBe(0);
  expect(page.url()).toContain('#glide');

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
