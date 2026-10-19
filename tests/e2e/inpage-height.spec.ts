/** Stress the actual viewport adapter beyond Chrome's physical document height limit. */
import { test, expect, chromium } from '@playwright/test';
import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import { chromePath } from './fixtures';

test('logical files beyond 34 million pixels remain reachable in a bounded document', async ({}, info) => {
  const bundle = await build({ entryPoints: ['scripts/inpage-spike/probe.mjs'], bundle: true, write: false, format: 'iife', platform: 'browser' });
  const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.setContent('<style>body{margin:0}</style><header style="height:250px">Page header</header>');
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await page.evaluate(async () => {
      const probe = window as any;
      await probe.__spikeStart({ count: 10500 });
    });
    const measure = () => page.evaluate(() => {
      const { view, list } = (window as any).__spike;
      return { logical: view.getScrollHeight(), physical: document.documentElement.scrollHeight, offset: view.scrollPageOffset,
        top: view.getScrollTop(), first: view.renderState.firstIndex, last: view.renderState.lastIndex, inner: list.scrollTop };
    });
    await expect.poll(async () => (await measure()).logical).toBeGreaterThan(34000000);
    await expect.poll(async () => (await measure()).physical).toBeLessThan(13000000);
    const samples = [];
    for (const index of [5000, 10499, 2000, 0]) {
      await page.evaluate(i => (window as any).__spike.view.scrollTo({ type: 'item', id: `src/file-${i}.ts`, align: 'start', behavior: 'instant' }), index);
      await expect.poll(async () => { const s = await measure(); return s.first <= index && s.last >= index; }).toBe(true);
      await expect.poll(() => page.evaluate(i => { const el = (window as any).__spike.view.items[i].element; return !!el?.isConnected && !!el.shadowRoot?.querySelector('[data-line]'); }, index)).toBe(true);
      const sample = await measure();
      expect(sample.physical).toBeLessThan(13000000);
      expect(sample.inner).toBe(0);
      samples.push({ index, ...sample });
    }
    // Cross a page boundary with physical scrolling, without a tree/programmatic logical jump.
    await page.evaluate(() => (window as any).__spike.view.scrollTo({ type: 'item', id: 'src/file-5000.ts', align: 'start', behavior: 'instant' }));
    await expect.poll(async () => (await measure()).offset).toBeGreaterThan(0);
    const before = await measure();
    await page.mouse.move(900, 600);
    await page.mouse.wheel(0, 9500000);
    await expect.poll(async () => (await measure()).offset).toBeGreaterThan(before.offset);
    const after = await measure();
    expect(after.top).toBeGreaterThan(before.top + 9499000);
    expect(after.top).toBeLessThan(before.top + 9501000);
    await page.mouse.wheel(0, 500000 - (after.top - after.offset));
    await expect.poll(async () => (await measure()).offset).toBeLessThan(after.offset);
    await page.evaluate(() => (window as any).__spike.scrollWindowToTop());
    await expect.poll(async () => (await measure()).offset).toBe(0);
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
    await expect.poll(async () => (await measure()).first).toBe(0);
    await page.evaluate(() => (window as any).__spike.view.scrollTo({ type: 'item', id: 'src/file-5000.ts', align: 'start', behavior: 'instant' }));
    await expect.poll(async () => (await measure()).offset).toBeGreaterThan(0);
    await page.evaluate(() => { const { view } = (window as any).__spike; view.setItems(view.items.slice(0, 10).map((item: any) => item.item)); });
    await expect.poll(async () => (await measure()).offset).toBe(0);
    await expect.poll(async () => (await measure()).physical).toBeLessThan(40000);
    await expect(page.locator('diffs-container').first()).toBeVisible();
    await writeFile(info.outputPath('height-and-jumps.json'), JSON.stringify({ samples, before, after }, null, 2));
    await page.screenshot({ path: info.outputPath('back-at-top.png') });
  } finally { await browser.close(); }
});
