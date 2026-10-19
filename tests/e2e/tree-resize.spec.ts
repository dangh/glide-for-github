/**
 * Resizing the file tree by its divider, read-only, on react/react#37778: drag, keyboard, double-click, a tree on the
 * right, page scrolling with the merged bar, a narrow window, and a width changed in another context. Stored Glide items
 * are put back in afterAll. Screenshots go to .superpowers/tree-resize.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserContext, Page } from '@playwright/test';
import { expect, openPierre, readGlideSync, REACT, ROOT, setExperiments, setSettings, test, Viewer, writeGlideSync } from './fixtures';

const SHOTS = join(ROOT, '.superpowers/tree-resize');
mkdirSync(SHOTS, { recursive: true });

let saved: Record<string, unknown> = {};
test.beforeAll(async ({ extContext }) => {
  saved = await readGlideSync(extContext);
});
test.afterAll(async ({ extContext }) => writeGlideSync(extContext, saved));

const HANDLE = '[data-testid="tree-resizer"]';

/** The tree, its handle and the diff list as laid out in the viewer, with the resize-observer errors seen so far. */
const layoutOf = (viewer: Viewer) =>
  viewer.frame().evaluate((sel) => {
    const rect = (e: Element) => e.getBoundingClientRect();
    const pane = document.querySelector<HTMLElement>('.pierre-tree-pane')!;
    const handle = document.querySelector<HTMLElement>(sel)!;
    const list = document.querySelector<HTMLElement>('.pierre-diffs')!;
    const boxes = [...list.querySelectorAll('diffs-container')].map(rect).filter((r) => r.height > 0 && r.bottom > 0 && r.top < innerHeight);
    const headers = [...list.querySelectorAll<HTMLElement>('.fh')].map(rect).filter((r) => r.width > 0);
    const root = list.querySelector('diffs-container')?.shadowRoot;
    const lines = root ? [...root.querySelectorAll<HTMLElement>('[data-line]')].map(rect).filter((r) => r.width > 0) : [];
    return {
      tree: pane.clientWidth,
      pane: { left: rect(pane).left, right: rect(pane).right },
      handle: { left: rect(handle).left, right: rect(handle).right },
      valuenow: Number(handle.getAttribute('aria-valuenow')),
      body: document.querySelector<HTMLElement>('.pierre-body')!.clientWidth,
      main: rect(document.querySelector('.pierre-main')!).width,
      list: { left: rect(list).left, right: rect(list).right, client: list.clientWidth },
      toolbar: rect(document.querySelector('.pierre-toolbar')!).width,
      boxesInside: boxes.every((b) => b.left >= rect(list).left - 0.5 && b.right <= rect(list).left + list.clientWidth + 0.5),
      boxesApart: boxes.every((b, i) => i === 0 || b.top >= boxes[i - 1]!.bottom - 0.5),
      headersInside: headers.every((h) => h.right <= rect(list).left + list.clientWidth + 0.5),
      linesInside: lines.every((l) => l.right <= rect(list).left + list.clientWidth + 0.5),
      roErrors: ((window as { __roErrors?: string[] }).__roErrors ?? []).length,
      resizing: document.documentElement.dataset.treeResizing !== undefined,
    };
  }, HANDLE);

/** Counts "ResizeObserver loop" errors from here on (the viewer marks them handled, but they still fire). */
const watchResizeLoops = (viewer: Viewer) =>
  viewer.frame().evaluate(() => {
    const w = window as { __roErrors?: string[] };
    w.__roErrors = [];
    addEventListener('error', (e) => {
      if (/ResizeObserver/.test(e.message)) w.__roErrors!.push(e.message);
    });
  });

const storedWidth = (viewer: Viewer) =>
  viewer
    .frame()
    .evaluate(async () => ((await chrome.storage.sync.get('pierre.settings'))['pierre.settings'] as { layout?: { treeWidth?: unknown } } | undefined)?.layout?.treeWidth ?? null);

async function handleCenter(viewer: Viewer) {
  const box = (await viewer.locator.locator(HANDLE).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + Math.min(box.height / 2, 300) };
}

/**
 * Drags the divider by `dx` px; `during` runs with the button still down. A screenshot taken mid-drag can make the
 * mouseup miss the extension's iframe, so the pointer moves on after it, as a hand does (the move ends the drag then).
 */
async function dragBy(page: Page, viewer: Viewer, dx: number, during?: () => Promise<void>) {
  const c = await handleCenter(viewer);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + dx / 2, c.y, { steps: 8 });
  await page.mouse.move(c.x + dx, c.y, { steps: 8 });
  await during?.();
  await page.mouse.up();
  await page.mouse.move(c.x + dx, c.y + 40, { steps: 2 });
}

const shotAround = async (page: Page, viewer: Viewer, name: string) => {
  const c = await handleCenter(viewer);
  await page.screenshot({ path: join(SHOTS, name), clip: { x: Math.max(0, c.x - 250), y: Math.max(0, c.y - 300), width: 500, height: 500 } });
};

async function open(page: Page, extContext: BrowserContext, layout: Record<string, unknown>) {
  await setExperiments(extContext, null);
  await setSettings(extContext, 'layout', { treePosition: 'left', showTree: true, treeWidth: 'default', ...layout });
  await setSettings(extContext, 'diff', { themeType: 'default' });
  return openPierre(page, REACT);
}

test('dragging the divider resizes the tree and the diffs, saves the width once, and keeps it after a reload', async ({ page, extContext }) => {
  const viewer = await open(page, extContext, {});
  const before = await layoutOf(viewer);
  expect(before.tree).toBe(before.valuenow);
  expect(before.handle.right - before.handle.left).toBe(5);
  // 5 px centered on the 1 px divider (the pane's right border).
  expect(before.handle.left).toBe(before.pane.right - 3);
  await watchResizeLoops(viewer);

  const c = await handleCenter(viewer);
  await page.mouse.move(c.x, c.y);
  await page.waitForTimeout(400);
  expect(await viewer.frame().evaluate((sel) => getComputedStyle(document.querySelector(sel)!).cursor, HANDLE)).toBe('col-resize');
  await shotAround(page, viewer, 'glide-hover.png');

  await dragBy(page, viewer, 150, async () => {
    await page.waitForTimeout(300);
    const mid = await layoutOf(viewer);
    expect(mid.tree).toBe(before.tree + 150);
    expect(mid.resizing).toBe(true);
    expect(await storedWidth(viewer), 'nothing saved mid-drag').toBe('default');
    expect(await viewer.frame().evaluate(() => getSelection()?.toString() ?? '')).toBe('');
    await shotAround(page, viewer, 'glide-drag.png');
  });
  await expect.poll(() => storedWidth(viewer)).toBe(before.tree + 150);
  await page.waitForTimeout(500);
  const after = await layoutOf(viewer);
  expect(after).toMatchObject({ tree: before.tree + 150, valuenow: before.tree + 150, resizing: false, toolbar: before.toolbar });
  expect(after.main).toBeCloseTo(before.main - 150, 0);
  expect(after.list.client).toBeCloseTo(before.list.client - 150, 0);
  expect(after).toMatchObject({ boxesInside: true, boxesApart: true, headersInside: true, linesInside: true, roErrors: 0 });

  // Dragging far past either end stops at GitHub's limits.
  await dragBy(page, viewer, 600);
  await expect.poll(async () => (await layoutOf(viewer)).tree).toBe(700);
  await dragBy(page, viewer, -600);
  await expect.poll(async () => (await layoutOf(viewer)).tree).toBe(256);
  await expect.poll(() => storedWidth(viewer)).toBe(256);
  await dragBy(page, viewer, 144);
  await expect.poll(() => storedWidth(viewer)).toBe(400);
  expect((await layoutOf(viewer)).roErrors).toBe(0);

  await page.reload({ waitUntil: 'load' });
  const reloaded = new Viewer(page);
  await reloaded.ready();
  expect(await layoutOf(reloaded)).toMatchObject({ tree: 400, valuenow: 400 });
});

test('arrow keys step 16 px, Home and End go to the ends, Enter and a double-click reset', async ({ page, extContext }) => {
  const viewer = await open(page, extContext, { treeWidth: 400 });
  const handle = viewer.locator.locator(HANDLE);
  await handle.focus();
  await page.keyboard.press('ArrowRight');
  expect((await layoutOf(viewer)).tree).toBe(416);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  expect((await layoutOf(viewer)).tree).toBe(384);
  await expect.poll(() => storedWidth(viewer)).toBe(384);
  await shotAround(page, viewer, 'glide-focus.png');
  await page.keyboard.press('End');
  expect((await layoutOf(viewer)).tree).toBe(700);
  await page.keyboard.press('Home');
  expect((await layoutOf(viewer)).tree).toBe(256);
  await expect.poll(() => storedWidth(viewer)).toBe(256);

  await page.keyboard.press('Enter');
  await expect.poll(() => storedWidth(viewer)).toBe('default');
  const reset = (await layoutOf(viewer)).tree;
  expect(reset).toBeGreaterThanOrEqual(256);

  await dragBy(page, viewer, 120);
  await expect.poll(() => storedWidth(viewer)).toBe(reset + 120);
  const c = await handleCenter(viewer);
  await page.mouse.dblclick(c.x, c.y);
  await expect.poll(() => storedWidth(viewer)).toBe('default');
  expect((await layoutOf(viewer)).tree).toBe(reset);
});

test('a tree on the right has the handle on its left edge, and the drag mirrored', async ({ page, extContext }) => {
  const viewer = await open(page, extContext, { treePosition: 'right', treeWidth: 320 });
  const before = await layoutOf(viewer);
  expect(before.tree).toBe(320);
  expect(before.handle.left).toBe(before.pane.left - 2);
  await dragBy(page, viewer, -100, () => shotAround(page, viewer, 'glide-right-drag.png'));
  await expect.poll(() => storedWidth(viewer)).toBe(420);
  const after = await layoutOf(viewer);
  expect(after.list.client).toBeCloseTo(before.list.client - 100, 0);
  expect(after).toMatchObject({ boxesInside: true, headersInside: true, linesInside: true });
  const handle = viewer.locator.locator(HANDLE);
  await handle.focus();
  await page.keyboard.press('ArrowLeft');
  expect((await layoutOf(viewer)).tree).toBe(436);
  await shotAround(page, viewer, 'glide-right.png');
});

test('with page scrolling and the merged bar, in dark mode, the drag works the same', async ({ page, extContext }) => {
  await setSettings(extContext, 'diff', { themeType: 'dark' });
  await setExperiments(extContext, { pageScroll: true, mergedBar: true });
  await setSettings(extContext, 'layout', { treePosition: 'left', showTree: true, treeWidth: 300 });
  const viewer = await openPierre(page, REACT);
  await watchResizeLoops(viewer);
  const before = await layoutOf(viewer);
  expect(before.tree).toBe(300);
  const c = await handleCenter(viewer);
  await page.mouse.move(c.x, c.y);
  await page.waitForTimeout(400);
  await shotAround(page, viewer, 'glide-dark-hover.png');
  await dragBy(page, viewer, 100, () => shotAround(page, viewer, 'glide-dark-drag.png'));
  await expect.poll(() => storedWidth(viewer)).toBe(400);
  const after = await layoutOf(viewer);
  expect(after.list.client).toBeCloseTo(before.list.client - 100, 0);
  expect(after).toMatchObject({ tree: 400, boxesInside: true, headersInside: true, linesInside: true, roErrors: 0 });
  await page.reload({ waitUntil: 'load' });
  const reloaded = new Viewer(page);
  await reloaded.ready();
  expect((await layoutOf(reloaded)).tree).toBe(400);
});

test('in a narrow window the diffs keep 400 px, and a width saved elsewhere applies without a reload', async ({ page, extContext }) => {
  const viewer = await open(page, extContext, { treeWidth: 700 });
  expect((await layoutOf(viewer)).tree).toBe(700);
  await page.setViewportSize({ width: 1000, height: 900 });
  await expect.poll(async () => {
    const l = await layoutOf(viewer);
    return l.tree === l.body - 401 && l.list.client > 0;
  }).toBe(true);
  await shotAround(page, viewer, 'glide-narrow.png');
  await page.setViewportSize({ width: 1400, height: 900 });
  await expect.poll(async () => (await layoutOf(viewer)).tree).toBe(700);

  await setSettings(extContext, 'layout', { treeWidth: 333 }, page);
  await expect.poll(async () => (await layoutOf(viewer)).tree).toBe(333);
});
