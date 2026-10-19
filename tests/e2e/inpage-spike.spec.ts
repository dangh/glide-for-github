/** Read-only smoke check of the packaged extension, using a disposable copy of a signed-in profile. */
import { test, expect, chromium } from '@playwright/test';
import { mkdtemp, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromePath, DIST } from './fixtures';

for (const blockWorkers of [false, true]) {
test(blockWorkers ? 'a worker startup failure is shown instead of falling back to main-thread highlighting' : 'the tab survives replacement and the top-document viewer uses real highlighting workers', async () => {
  test.skip(!process.env.PIERRE_SPIKE_PROFILE, 'Set PIERRE_SPIKE_PROFILE to a signed-in Chrome profile to copy');
  const profile = await mkdtemp(join(tmpdir(), 'glide-inpage-'));
  if (process.env.PIERRE_SPIKE_PROFILE) await cp(process.env.PIERRE_SPIKE_PROFILE, profile, {
    recursive: true, filter: path => !/Singleton|\/(Cache|Code Cache|GPUCache|Service Worker)(\/|$)/.test(path),
  });
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: chromePath(), headless: true,
    args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
    viewport: { width: 1280, height: 800 },
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
    // A layout replacement can remove the worker host. The viewer must recreate its pool.
    await page.locator('iframe[data-glide-worker-host]').evaluate(el => el.remove());
    await expect(page.locator('iframe[data-glide-worker-host]')).toHaveCount(1);
    await expect(host.locator('.fh').first()).toBeVisible();
    await expect.poll(async () => {
      const replacement = page.frames().find(frame => frame.url().includes('/worker-host.html'));
      return replacement?.evaluate(() => window.__glideWorkerHost?.renders ?? 0) ?? 0;
    }).toBeGreaterThan(0);
    await expect(page.locator('iframe[data-pierre-viewer]')).toHaveCount(0);
    expect(workerErrors).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});

}
