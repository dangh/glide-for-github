/** Real GitHub interactions in the packaged extension; drafts are canceled and no review writes are submitted. */
import { test, expect, chromium } from '@playwright/test';
import { mkdtemp, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromePath, DIST } from './fixtures';

for (const { blockWorkers, scale } of [{ blockWorkers: false, scale: 1 }, { blockWorkers: false, scale: 2 }, { blockWorkers: true, scale: 1 }]) {
  test(blockWorkers ? 'a worker startup failure is shown instead of falling back to main-thread highlighting' : `the packaged in-page viewer supports layout, scrolling and review controls at ${scale}x`, async ({}, testInfo) => {
    test.skip(!process.env.PIERRE_SPIKE_PROFILE, 'Set PIERRE_SPIKE_PROFILE to a signed-in Chrome profile to copy');
    const profile = await mkdtemp(join(tmpdir(), 'glide-inpage-'));
    if (process.env.PIERRE_SPIKE_PROFILE) await cp(process.env.PIERRE_SPIKE_PROFILE, profile, {
      recursive: true, filter: path => !/Singleton|\/(Cache|Code Cache|GPUCache|Service Worker)(\/|$)/.test(path),
    });
    const context = await chromium.launchPersistentContext(profile, {
      executablePath: chromePath(), headless: true,
      args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, `--force-device-scale-factor=${scale}`],
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: scale,
    });
    try {
      if (blockWorkers) await context.addInitScript(() => {
        if (location.protocol === 'chrome-extension:' && location.pathname === '/worker-host.html') {
          Object.defineProperty(window, 'Worker', { value: new Proxy(Worker, {
            construct() { throw new Error('Forced worker startup failure'); },
          }) });
        }
      });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      const workerErrors: string[] = [];
      page.on('console', message => {
        if (/SecurityError|worker initialization timed out/i.test(message.text())) workerErrors.push(message.text());
      });
      await page.goto('https://github.com/dangh/glide-for-github/pull/1/files');
      expect(await page.evaluate(() => devicePixelRatio)).toBe(scale);
      const tab = page.locator('a[data-pierre-tab]');
      await expect(tab).toBeVisible();
      // GitHub replaces the tab strip after initial rendering. The extension must repair its tab.
      await tab.evaluate(el => el.remove());
      await expect(tab).toBeVisible({ timeout: 5000 });
      await tab.click();
      const host = page.locator('#glide-inpage-spike');
      await expect(host).toBeVisible({timeout:5000});
      if (blockWorkers) {
        await expect(host.locator('[role=alert]')).toContainText('Forced worker startup failure');
        await expect(host.locator('.fh')).toHaveCount(0);
        expect(errors).toEqual([]);
        return;
      }
      await expect(host.locator('.pierre-app')).toBeVisible();
      expect(await host.evaluate(el => ({
        topDocument: el.ownerDocument.defaultView?.frameElement === null,
        shadow: !!el.shadowRoot,
      }))).toEqual({ topDocument: true, shadow: true });
      await expect(page.locator('iframe[data-pierre-viewer]')).toHaveCount(0);
      await expect(host.locator('.fh').first(), errors.join('\n')).toBeVisible({ timeout: 30_000 });
      await expect.poll(async () => {
        const frame = page.frames().find(frame => frame.url().includes('/worker-host.html'));
        return frame?.evaluate(() => window.__glideWorkerHost);
      }).toMatchObject({ initialized: expect.any(Number), renders: expect.any(Number), errors: 0 });
      const frame = page.frames().find(frame => frame.url().includes('/worker-host.html'))!;
      await expect.poll(() => frame.evaluate(() => window.__glideWorkerHost?.initialized ?? 0)).toBeGreaterThanOrEqual(2);
      await expect.poll(() => frame.evaluate(() => window.__glideWorkerHost?.renders ?? 0)).toBeGreaterThan(0);
      await expect(page.locator('iframe[data-glide-worker-host]')).toBeHidden();
      console.log('Native highlighting worker results:', await frame.evaluate(() => window.__glideWorkerHost));
      const capture = async (name: string) => {
        await page.screenshot({ path: testInfo.outputPath(`${name}.png`) });
        const geometry = await host.evaluate(el => {
          const root = el.shadowRoot!;
          const selectors = ['.pierre-app', '.pierre-toolbar', '.pierre-body', '.pierre-tree-pane', '.pierre-main', '.pierre-diffs', '.fh'];
          return { scrollY, viewport: [innerWidth, innerHeight], documentHeight: document.documentElement.scrollHeight,
            elements: selectors.map(selector => {
              const node = root.querySelector(selector)!;
              const rect = node.getBoundingClientRect();
              const style = getComputedStyle(node);
              return { selector, x: rect.x, y: rect.y, width: rect.width, height: rect.height, display: style.display, overflow: style.overflow, position: style.position };
            }),
          };
        });
        await testInfo.attach(`${name}-geometry`, { body: JSON.stringify(geometry, null, 2), contentType: 'application/json' });
      };
      await capture('initial');
      const contentWidth = await host.evaluate(el => el.parentElement!.getBoundingClientRect().width);
      await expect.poll(async () => (await host.boundingBox())?.width ?? 0).toBeGreaterThan(contentWidth - 5);
      await expect(host.locator('.pierre-body')).toHaveCSS('display', 'flex');
      await expect.poll(async () => (await host.locator('.pierre-main').boundingBox())?.width ?? 0).toBeGreaterThan(contentWidth - 310);
      await page.mouse.move(950, 650);
      await page.mouse.wheel(0, 1200);
      await page.waitForTimeout(800);
      await capture('scrolled');
      await page.mouse.wheel(0, -1500);
      await page.waitForTimeout(800);
      await expect(host.getByRole('button', { name: 'Collapse file tree', exact: true })).toBeVisible();
      await host.getByRole('button', { name: 'Collapse file tree', exact: true }).click();
      await expect(host.locator('.pierre-tree-pane')).toBeHidden();
      await host.getByRole('button', { name: 'Expand file tree', exact: true }).click();
      await expect(host.locator('.pierre-tree-pane')).toBeVisible();

      await host.getByRole('button', { name: 'Split', exact: true }).click();
      await expect(host.getByRole('button', { name: 'Split', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await capture('split');
      await host.getByRole('button', { name: 'Unified', exact: true }).click();
      await host.getByTitle('Display options', { exact: true }).click();
      const menu = host.locator('.display-menu .popover-panel');
      await expect(menu).toBeVisible();
      await expect.poll(async () => { const rect = await menu.boundingBox(); return rect!.y + rect!.height; }).toBeLessThanOrEqual(800);
      await page.getByRole('heading', { level: 1 }).click();
      await expect(menu).toHaveCount(0, { timeout: 3000 });
      await host.getByTitle('Display options', { exact: true }).click();
      await menu.locator('label.field', { hasText: 'Tree position' }).locator('select').selectOption('right');
      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
      await expect.poll(async () => host.evaluate(el => {
        const root = el.shadowRoot!;
        return root.querySelector('.pierre-tree-pane')!.getBoundingClientRect().left >= root.querySelector('.pierre-main')!.getBoundingClientRect().right - 1;
      })).toBe(true);
      await capture('tree-right');
      await host.getByTitle('Display options', { exact: true }).click();
      await menu.locator('label.field', { hasText: 'Tree position' }).locator('select').selectOption('left');
      await page.keyboard.press('Escape');

      await host.getByRole('button', { name: 'Comment on file', exact: true }).first().click();
      const composer = host.locator('.composer');
      const comment = composer.getByRole('textbox', { name: 'Comment', exact: true });
      await expect(comment).toBeFocused();
      await page.keyboard.type('Glide browser check, not submitted.');
      await expect(comment).toHaveValue('Glide browser check, not submitted.');
      await page.waitForTimeout(500);
      await expect(comment).toBeFocused();
      await capture('comment');
      await composer.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(composer).toHaveCount(0);

      for (const width of [1440, 900, 768]) {
        await page.setViewportSize({ width, height: 900 });
        await expect.poll(async () => host.evaluate(el => Math.abs(el.getBoundingClientRect().width - el.parentElement!.getBoundingClientRect().width))).toBeLessThan(5);
        await expect.poll(async () => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
        await host.getByTitle('Display options', { exact: true }).click();
        await expect(menu).toBeVisible();
        await capture(`width-${width}-menu`);
        const rect = await menu.boundingBox();
        expect(rect!.x).toBeGreaterThanOrEqual(0);
        expect(rect!.x + rect!.width).toBeLessThanOrEqual(width);
        expect(rect!.y + rect!.height).toBeLessThanOrEqual(900);
        await page.keyboard.press('Escape');
      }
      await page.setViewportSize({ width: 1280, height: 800 });
      const tree = host.locator('file-tree-container');
      const search = tree.getByPlaceholder('Search…');
      await search.fill('lifecycle.ts');
      await tree.locator('[data-item-path="src/content/lifecycle.ts"]').click();
      const chosenHeader = host.locator('.fh[data-path="src/content/lifecycle.ts"]');
      await expect(chosenHeader).toBeInViewport();
      await expect.poll(async () => (await chosenHeader.boundingBox())?.y ?? Infinity).toBeLessThan(110);
      await capture('tree-navigation');
      await search.fill('');
      await host.getByTestId('review-button').click();
      await expect(host.getByRole('dialog', { name: 'Finish your review' })).toBeVisible();
      await capture('review-menu');
      await page.keyboard.press('Escape');
      await expect(host.getByRole('dialog', { name: 'Finish your review' })).toHaveCount(0);
      await page.mouse.move(1000, 650);
      await page.mouse.wheel(0, 5000);
      await expect.poll(async () => host.locator('[data-line]').evaluateAll(lines => lines.filter(line => {
        const r = line.getBoundingClientRect();
        return r.bottom > 102 && r.top < innerHeight;
      }).length)).toBeGreaterThan(3);
      await capture('deep-scroll');
      await page.mouse.wheel(0, -100000);
      await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
      await page.getByRole('link', { name: /^Files changed/ }).click();
      await expect(host).toHaveCount(0);
      await page.locator('a[data-pierre-tab]').click();
      await expect(host.locator('.fh').first()).toBeVisible();
      await page.reload();
      await expect(host.locator('.fh').first()).toBeVisible();
      await capture('reload');
      // A layout replacement can remove the worker host. The viewer must recreate its pool.
      await page.locator('iframe[data-glide-worker-host]').evaluate(el => el.remove());
      await expect(page.locator('iframe[data-glide-worker-host]')).toHaveCount(1);
      await expect(host.locator('.fh').first()).toBeVisible();
      await expect.poll(async () => {
        const replacement = page.frames().find(frame => frame.url().includes('/worker-host.html'));
        return replacement?.evaluate(() => window.__glideWorkerHost?.renders ?? 0) ?? 0;
      }).toBeGreaterThan(0);
      await expect(page.locator('iframe[data-pierre-viewer]')).toHaveCount(0);
      await page.goto('https://github.com/react/react/pull/37778/files#glide');
      await expect(host.locator('.fh').first()).toBeVisible({ timeout: 60_000 });
      await expect.poll(async () => host.evaluate(el => Math.abs(el.getBoundingClientRect().width - el.parentElement!.getBoundingClientRect().width))).toBeLessThan(5);
      await capture('second-pr');
      await page.mouse.move(1000, 650);
      await page.mouse.wheel(0, 1400);
      await expect.poll(async () => host.locator('[data-line]').evaluateAll(lines => lines.filter(line => {
        const r = line.getBoundingClientRect();
        return r.bottom > 102 && r.top < innerHeight;
      }).length)).toBeGreaterThan(3);
      await page.waitForTimeout(800);
      await capture('second-pr-scrolled');
      expect(workerErrors).toEqual([]);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
      await rm(profile, { recursive: true, force: true });
    }
  });

}
