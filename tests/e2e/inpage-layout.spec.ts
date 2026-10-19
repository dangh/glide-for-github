/** Native GitHub pages and the packaged extension, with measured sticky and container edges. */
import { test, expect, chromium, type Locator } from '@playwright/test';
import { mkdtemp, rm, cp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromePath, DIST, extensionId } from './fixtures';

const geometry = (host: Locator) => host.evaluate(el => {
  const root = el.shadowRoot!;
  const box = (selector: string) => root.querySelector(selector)!.getBoundingClientRect().toJSON();
  const diffs = root.querySelector<HTMLElement>('.pierre-diffs')!;
  return {
    y: scrollY, width: document.documentElement.clientWidth, overflow: document.documentElement.scrollWidth - innerWidth,
    host: el.getBoundingClientRect().toJSON(), toolbar: box('.pierre-toolbar'), tree: box('.pierre-tree-pane'),
    main: box('.pierre-main'), diffs: box('.pierre-diffs'), file: box('.fh'),
    toggle: box('[data-testid="tree-toggle"]'),
    listScroll: diffs.scrollTop, listOverflow: getComputedStyle(diffs).overflowY,
    title: !!root.querySelector('[data-testid="pr-title"]'),
    native: [...document.querySelectorAll<HTMLElement>('header [data-component="PageHeader"]')]
      .filter(h => ['sticky', 'fixed'].includes(getComputedStyle(h).position))
      .map(h => ({ display: getComputedStyle(h).display, bottom: h.getBoundingClientRect().bottom })),
  };
});

for (const mode of ['merged', 'page'] as const) for (const scale of [1, 2]) {
  test(`in-page ${mode} sticky headers and spacing at ${scale}x`, async ({}, info) => {
    test.skip(!process.env.PIERRE_SPIKE_PROFILE, 'Set PIERRE_SPIKE_PROFILE to a signed-in profile');
    const profile = await mkdtemp(join(tmpdir(), 'glide-layout-'));
    await cp(process.env.PIERRE_SPIKE_PROFILE!, profile, {
      recursive: true, filter: path => !/Singleton|\/(Cache|Code Cache|GPUCache|Service Worker)(\/|$)/.test(path),
    });
    const context = await chromium.launchPersistentContext(profile, {
      executablePath: chromePath(), headless: true,
      args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, `--force-device-scale-factor=${scale}`],
      viewport: { width: 1280, height: 800 }, deviceScaleFactor: scale,
    });
    try {
      const options = await context.newPage();
      await options.goto(`chrome-extension://${extensionId()}/options.html`);
      await options.evaluate(async merged => {
        const saved = (await chrome.storage.sync.get('pierre.settings'))['pierre.settings'];
        await chrome.storage.sync.set({ 'pierre.settings': { ...(typeof saved === 'object' && saved !== null ? saved : {}), experiments: { mergedBar: merged } } });
      }, mode === 'merged');
      await options.close();
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      const host = page.locator('#glide-inpage-spike');
      const ready = async () => {
        await expect(host.locator('.fh').first()).toBeVisible();
        await expect.poll(async () => host.locator('[data-line]').count()).toBeGreaterThan(3);
      };
      const capture = async (name: string) => {
        await page.screenshot({ path: info.outputPath(`${name}.png`) });
        await writeFile(info.outputPath(`${name}.json`), JSON.stringify(await geometry(host), null, 2));
      };
      const top = async () => {
        if (await host.locator('.pr-title-text').isVisible()) await host.locator('.pr-title-text').click();
        else {
          await page.mouse.move(page.viewportSize()!.width - 80, 650);
          await page.mouse.wheel(0, -100000);
        }
        await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
        await expect(host.getByTestId('pr-title')).toHaveCount(0);
      };
      const jump = async (nativeTop: number) => {
        await top();
        const tree = host.locator('file-tree-container');
        await tree.getByPlaceholder('Search…').fill('host.ts');
        await tree.locator('[data-item-path="src/content/host.ts"]').click();
        await tree.getByPlaceholder('Search…').fill('lifecycle.ts');
        await tree.locator('[data-item-path="src/content/lifecycle.ts"]').click();
        const header = host.locator('.fh[data-path="src/content/lifecycle.ts"]');
        await expect.poll(async () => (await header.boundingBox())?.y ?? Infinity).toBeCloseTo(nativeTop + 60, 0);
        await page.mouse.move(600, 650);
        await page.mouse.wheel(0, 200);
        await expect.poll(async () => (await header.boundingBox())?.y ?? Infinity).toBeCloseTo(nativeTop + 60, 0);
        await tree.getByPlaceholder('Search…').fill('');
      };
      const menu = host.locator('.display-menu .popover-panel');
      const setTree = async (side: 'left' | 'right') => {
        await host.getByTitle('Display options', { exact: true }).click();
        await menu.locator('label.field', { hasText: 'Tree position' }).locator('select').selectOption(side);
        await page.keyboard.press('Escape');
      };
      for (const route of ['/files', '']) {
        const label = route ? 'files' : 'conversation';
        await page.setViewportSize({ width: 1440, height: 800 });
        await page.goto(`https://github.com/dangh/glide-for-github/pull/1${route}`);
        await expect(page.locator('a[data-pierre-tab]')).toBeVisible();
        if (!route) await expect.poll(() => page.locator('header [data-component="PageHeader"]').count()).toBe(2);
        const footerStyle = await page.locator('footer[role="contentinfo"]').getAttribute('style');
        const nativeHeaderStyles = await page.locator('header [data-component="PageHeader"]').evaluateAll(headers => headers.map(h => h.getAttribute('style') ?? ''));
        await page.screenshot({ path: info.outputPath(`${label}-native-top.png`) });
        await page.locator('a[data-pierre-tab]').click();
        await ready();
        await top();
        await setTree('left');
        const nativeTop = mode === 'page' && !route ? 60 : 0;
        for (const width of [767, 768, 1011, 1012, 1440]) {
          await page.setViewportSize({ width, height: 800 });
          await top();
          const gutter = width < 768 ? 16 : width < 1012 ? 24 : 32;
          await expect.poll(async () => (await geometry(host)).host.left).toBe(gutter);
          await expect.poll(async () => (await geometry(host)).host.right).toBe(width - gutter);
          await expect.poll(async () => (await geometry(host)).toolbar.left).toBe(gutter);
          const start = await geometry(host);
          expect(start.diffs.top).toBe(start.main.top); // CodeView's padding must not collapse through its root.
          expect(start.listOverflow).toBe('visible');
          expect(start.listScroll).toBe(0);
          expect(start.overflow).toBeLessThanOrEqual(1);
          await capture(`${label}-${width}-top`);
          await jump(nativeTop);
          await expect.poll(async () => (await geometry(host)).toolbar.top).toBe(nativeTop);
          const stuck = await geometry(host);
          expect(stuck.toolbar.height).toBe(60);
          expect(stuck.tree.top).toBe(nativeTop + 60);
          expect(stuck.tree.bottom).toBe(800);
          expect(stuck.toolbar.left).toBe(mode === 'merged' ? 0 : gutter);
          expect(stuck.toolbar.right).toBe(mode === 'merged' ? width : width - gutter);
          expect(stuck.toggle.left).toBe(gutter);
          expect(stuck.title).toBe(mode === 'merged');
          expect(stuck.file.left).toBe(stuck.tree.right + 16);
          expect(stuck.file.right).toBe(width - gutter);
          if (mode === 'merged') expect(stuck.native.every(h => h.display === 'none')).toBe(true);
          else if (!route) expect(stuck.native).toEqual([{ display: 'flex', bottom: 60 }]);
          await capture(`${label}-${width}-stuck`);
          await host.getByTitle('Display options', { exact: true }).click();
          const menuBox = (await menu.boundingBox())!;
          expect(menuBox.x).toBeGreaterThanOrEqual(0);
          expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(width);
          expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(800);
          await page.keyboard.press('Escape');
          await setTree('right');
          const right = await geometry(host);
          expect(right.file.left).toBe(gutter);
          expect(right.file.right).toBe(right.tree.left - 16);
          await host.getByRole('button', { name: 'Collapse file tree', exact: true }).click();
          await expect(host.locator('.pierre-tree-pane')).toBeHidden();
          const hidden = await geometry(host);
          expect(hidden.file.left).toBe(gutter);
          expect(hidden.file.right).toBe(width - gutter);
          expect(hidden.overflow).toBeLessThanOrEqual(1);
          await capture(`${label}-${width}-hidden`);
          await host.getByRole('button', { name: 'Expand file tree', exact: true }).click();
          await setTree('left');
          if (mode === 'merged' && width - 2 * gutter >= 768) {
            await host.locator('.pr-title-text').click();
            await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
            expect(page.url()).toContain('#glide');
          }
        }
        await page.setViewportSize({ width: 1440, height: 800 });
        await host.getByTitle('Display options', { exact: true }).click();
        await menu.locator('summary', { hasText: 'Advanced' }).click();
        await menu.getByLabel('Padding top (px)', { exact: true }).fill('40');
        await page.keyboard.press('Escape');
        await expect(host.locator('.pierre-diffs > div').first()).toHaveCSS('margin-top', '40px');
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        await jump(nativeTop);
        await capture(`${label}-custom-padding`);
        await host.getByTitle('Display options', { exact: true }).click();
        await menu.locator('summary', { hasText: 'Advanced' }).click();
        await menu.getByLabel('Padding top (px)', { exact: true }).fill('16');
        await page.keyboard.press('Escape');
        await expect(host.locator('.pierre-diffs > div').first()).toHaveCSS('margin-top', '16px');
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        if (mode === 'merged' && scale === 1 && route === '/files') {
          await jump(nativeTop);
          const file = host.locator('diffs-container').filter({ has: page.locator('.fh[data-path="src/content/lifecycle.ts"]') });
          const rows = () => file.locator('[data-line]').evaluateAll(lines => lines.map(line => ({
            number: line.getAttribute('data-line'), text: line.textContent, top: line.getBoundingClientRect().top,
          })));
          const tracked = (await rows()).find(line => line.top >= 180 && line.top < 300)!;
          expect(tracked).toBeDefined();
          const retainedHost = await host.elementHandle();
          const nativeAnchor = await page.locator('header').filter({ has: page.locator('a[data-pierre-tab]') }).elementHandle();
          const anchoring = await page.evaluate(() => {
            const previous = document.documentElement.style.overflowAnchor;
            document.documentElement.style.overflowAnchor = 'none';
            return previous;
          });
          const beforeY = await page.evaluate(() => scrollY);
          const replacement = await nativeAnchor!.evaluateHandle(el => {
            const next = el.cloneNode(true);
            if (!(next instanceof HTMLElement)) throw new Error('Missing GitHub header');
            next.style.paddingBottom = '200px';
            next.dataset.layoutReplacement = '';
            el.replaceWith(next);
            return next;
          });
          await expect.poll(() => host.evaluate(el => el.previousElementSibling?.hasAttribute('data-layout-replacement'))).toBe(true);
          expect(await retainedHost!.evaluate(el => el === document.querySelector('#glide-inpage-spike'))).toBe(true);
          await expect.poll(async () => (await rows()).find(line => line.number === tracked.number && line.text === tracked.text)?.top ?? Infinity)
            .toBeCloseTo(tracked.top + 200, 0);
          expect(await page.evaluate(() => scrollY)).toBe(beforeY);
          expect((await geometry(host)).toolbar.top).toBe(0);
          await capture('files-anchor-replaced');
          await replacement.evaluate((el, original) => el.replaceWith(original!), nativeAnchor);
          await page.evaluate(value => { document.documentElement.style.overflowAnchor = value; }, anchoring);
        }
        await expect(page.locator('footer[role="contentinfo"]')).toBeHidden();
        await page.mouse.move(1100, 650);
        await page.mouse.wheel(0, 100000);
        await expect.poll(async () => Math.abs((await geometry(host)).host.bottom - 800)).toBeLessThan(2);
        await capture(`${label}-bottom`);
        await top();
        await page.goBack();
        await expect(host).toHaveCount(0);
        expect(await page.locator('footer[role="contentinfo"]').getAttribute('style')).toBe(footerStyle);
        expect(await page.locator('header [data-component="PageHeader"]').evaluateAll(headers => headers.map(h => h.getAttribute('style') ?? ''))).toEqual(nativeHeaderStyles);
        if (!route) {
          await page.evaluate(() => scrollTo({ top: 1000, behavior: 'instant' }));
          await expect.poll(() => page.evaluate(() => scrollY)).toBe(1000);
          await expect.poll(() => page.evaluate(() => [...document.querySelectorAll<HTMLElement>('header [data-component="PageHeader"]')]
            .filter(h => ['sticky', 'fixed'].includes(getComputedStyle(h).position))
            .map(h => getComputedStyle(h).display)))
            .toEqual(['flex']);
        }
      }
      expect(errors).toEqual([]);
    } finally {
      await context.close();
      await rm(profile, { recursive: true, force: true });
    }
  });
}
