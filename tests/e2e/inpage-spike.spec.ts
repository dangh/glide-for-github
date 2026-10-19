/** Read-only smoke check of the packaged extension, using a disposable copy of a signed-in profile. */
import { test, expect, chromium } from '@playwright/test';
import { mkdtemp, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromePath, DIST } from './fixtures';

test('the built extension mounts Glide in GitHub’s top document without an iframe', async () => {
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
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => { errors.push(error.message); console.log('PAGE ERROR:', error.stack); });
    await page.goto('https://github.com/dangh/glide-for-github/pull/1/files#glide');
    const host = page.locator('#glide-inpage-spike');
    await expect(host).toBeVisible({timeout:5000});
    await expect(host.locator('.pierre-app')).toBeVisible();
    expect(await host.evaluate(el => ({
      topDocument: el.ownerDocument.defaultView?.frameElement === null,
      shadow: !!el.shadowRoot,
    }))).toEqual({ topDocument: true, shadow: true });
    await expect(page.locator('iframe[data-pierre-viewer]')).toHaveCount(0);
    await expect(host.locator('.fh').first(), errors.join('\n')).toBeVisible({ timeout: 30_000 });
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});
