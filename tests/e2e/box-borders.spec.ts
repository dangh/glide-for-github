/**
 * File box borders on a Retina screen (device pixel ratio 2), read-only, on react/react#37778, with page scrolling and
 * the merged bar, the tree hidden and shown, at 100% and at 90% browser zoom (device pixel ratio 1.8, where Chrome used
 * to drop the right border of a box that touched its frame's or its list's edge). Stored Glide items are put back in
 * afterAll; the zoom is per tab, so it ends with the tab.
 */
import type { BrowserContext, Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, extensionPage, openPierre, readGlideSync, REACT, ROOT, setExperiments, setSettings, test, writeGlideSync, type Viewer } from './fixtures';

test.use({ screenScale: 2 });

const SHOTS = join(ROOT, '.superpowers/box-borders');
mkdirSync(SHOTS, { recursive: true });

let saved: Record<string, unknown> = {};
test.beforeAll(async ({ extContext }) => {
  saved = await readGlideSync(extContext);
});
test.afterAll(async ({ extContext }) => writeGlideSync(extContext, saved));

async function setZoom(context: BrowserContext, page: Page, factor: number) {
  const ext = await extensionPage(context);
  await ext.evaluate(async (z) => {
    const [tab] = await chrome.tabs.query({ url: 'https://github.com/*' });
    await chrome.tabs.setZoomSettings(tab!.id!, { scope: 'per-tab' });
    await chrome.tabs.setZoom(tab!.id!, z);
  }, factor);
  await ext.close();
  await page.bringToFront();
}

/** The iframe in the page, and in the viewer the toolbar, the list and the file boxes whose header is on screen. */
const layoutOf = async (page: Page, viewer: Viewer) => ({
  iframe: await page.evaluate(() => {
    const r = document.querySelector('iframe[data-pierre-viewer]')!.getBoundingClientRect();
    return { left: r.left, top: r.top, dpr: devicePixelRatio };
  }),
  ...(await viewer.frame().evaluate(() => {
    const x = (e: Element) => {
      const r = e.getBoundingClientRect();
      return { left: r.left, right: r.right, bottom: r.bottom };
    };
    const toolbar = document.querySelector('.pierre-toolbar')!;
    const below = toolbar.getBoundingClientRect().bottom;
    const { paddingLeft, paddingRight } = getComputedStyle(toolbar);
    return {
      frameWidth: document.documentElement.getBoundingClientRect().width,
      /** The toolbar's content box: the stuck merged bar spans the viewport with the gutters inside it. */
      toolbar: { left: x(toolbar).left + parseFloat(paddingLeft), right: x(toolbar).right - parseFloat(paddingRight) },
      list: x(document.querySelector('.pierre-diffs')!),
      boxes: [...document.querySelectorAll('.pierre-diffs diffs-container')].flatMap((box) => {
        const h = box.querySelector('.fh')?.getBoundingClientRect();
        const y = h ? (h.top + h.bottom) / 2 : -1;
        return y > below + 4 && y < innerHeight - 4 ? [{ ...x(box), y }] : [];
      }),
    };
  })),
});

/**
 * Whether a border-colored pixel is drawn in each box's outermost CSS pixel on each side, at its header's middle, in a
 * screenshot of the page (decoded in the viewer, which has a canvas).
 */
function bordersDrawn(viewer: Viewer, shot: Buffer, l: Awaited<ReturnType<typeof layoutOf>>) {
  return viewer.frame().evaluate(
    async ({ png, l }) => {
      const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(png), (c) => c.charCodeAt(0))], { type: 'image/png' }));
      const ctx = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);
      const { dpr, left: dx, top: dy } = l.iframe;
      // The border may be snapped to the device pixel next to its exact position.
      const drawn = (y: number, from: number, to: number) => {
        const x0 = Math.floor((dx + from) * dpr) - 1;
        const row = ctx.getImageData(x0, Math.round((dy + y) * dpr), Math.ceil((dx + to) * dpr) + 1 - x0, 1).data;
        for (let i = 0; i < row.length; i += 4) if (row[i]! + row[i + 1]! + row[i + 2]! < 3 * 236) return true;
        return false;
      };
      return l.boxes.map((b) => ({ left: drawn(b.y, b.left, b.left + 1), right: drawn(b.y, b.right - 1, b.right) }));
    },
    { png: shot.toString('base64'), l },
  );
}

for (const mergedBar of [false, true]) {
  for (const tree of ['hidden', 'left', 'right'] as const) {
    const name = `${mergedBar ? 'merged bar' : 'page scrolling'}, tree ${tree}`;
    test(`${name}: every file box shows its 1 px border and lines up with the toolbar`, async ({ page, extContext }) => {
      await setExperiments(extContext, { pageScroll: true, mergedBar }, page, tree === 'hidden' ? 'right' : tree);
      await setSettings(extContext, 'layout', { showTree: tree !== 'hidden' }, page);
      await page.setViewportSize({ width: 1283, height: 900 });
      const viewer = await openPierre(page, REACT, 'hash');
      for (const [zoom, scrollY] of [[1, 0], [1, 1500], [0.9, 0], [0.9, 1500]] as const) {
        await setZoom(extContext, page, zoom);
        await expect.poll(() => page.evaluate(() => devicePixelRatio)).toBeCloseTo(2 * zoom, 2);
        await page.evaluate((y) => window.scrollTo(0, y), scrollY);
        // Settled: the same layout before and after the screenshot.
        let shot: Buffer;
        let l = await layoutOf(page, viewer);
        await expect(async () => {
          shot = await page.screenshot();
          const after = await layoutOf(page, viewer);
          const same = JSON.stringify(after) === JSON.stringify(l);
          l = after;
          expect(same).toBe(true);
        }).toPass({ timeout: 15_000, intervals: [300] });
        writeFileSync(join(SHOTS, `${name.replaceAll(/\W+/g, '-')}-zoom-${zoom}-y${scrollY}.png`), shot!);

        expect(l.boxes.length).toBeGreaterThan(0);
        // Layout rounds to 1/64 px when zoomed.
        const px = 1 - 1 / 32;
        for (const b of l.boxes) {
          expect.soft(b.right).toBeLessThanOrEqual(l.frameWidth - px);
          expect.soft(b.right).toBeLessThanOrEqual(l.list.right - px);
          expect.soft(b.left).toBeGreaterThanOrEqual(l.list.left + px);
          // The edge facing the page edge (both, with no tree) is the toolbar's.
          if (tree !== 'right') expect.soft(b.right).toBeCloseTo(l.toolbar.right, 2);
          if (tree !== 'left') expect.soft(b.left).toBeCloseTo(l.toolbar.left, 2);
        }
        expect.soft(await bordersDrawn(viewer, shot!, l), `zoom ${zoom}, scrolled to ${scrollY}`).toEqual(l.boxes.map(() => ({ left: true, right: true })));
      }
    });
  }
}
