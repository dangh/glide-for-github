/** Read-only GitHub checks. Stack data is local; no review or suggestion is submitted. */
import { test, expect, chromium } from '@playwright/test';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromePath, DIST, extensionId } from './fixtures';

test('in-page menus fit, modals cover the toolbar, and reload restores the file and drafts', async ({}, info) => {
  test.skip(!process.env.PIERRE_SPIKE_PROFILE, 'Set PIERRE_SPIKE_PROFILE to a signed-in profile');
  const profile = await mkdtemp(join(tmpdir(), 'glide-regression-'));
  await cp(process.env.PIERRE_SPIKE_PROFILE!, profile, {
    recursive: true, filter: path => !/Singleton|\/(Cache|Code Cache|GPUCache|Service Worker)(\/|$)/.test(path),
  });
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: chromePath(), headless: true,
    args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
    viewport: { width: 1280, height: 800 },
  });
  try {
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId()}/options.html`);
    await options.evaluate(async () => {
      const saved = (await chrome.storage.sync.get('pierre.settings'))['pierre.settings'];
      await chrome.storage.sync.set({ 'pierre.settings': { ...(typeof saved === 'object' && saved !== null ? saved : {}), experiments: { mergedBar: true } } });
    });
    await options.close();
    const page = await context.newPage();
    await page.route('**/page_data/header*', route => route.fulfill({ json: {
      featureStates: { pullRequestStacks: 'ENABLED' },
      stack: { number: 1, position: 1, size: 20, baseBranch: 'main',
        repositoryOwnerLogin: 'dangh', repositoryName: 'glide-for-github',
        pulls: Array.from({ length: 20 }, (_, i) => ({ number: 20 - i, title: `Stack entry ${20 - i}`, headBranch: `branch-${i}`, state: 'OPEN' })),
      },
    } }));
    await page.goto('https://github.com/dangh/glide-for-github/pull/1/files#glide');
    const host = page.locator('#glide-inpage-spike');
    await expect(host.locator('.fh').first()).toBeVisible();
    await page.mouse.move(1100, 650);
    await page.mouse.wheel(0, -100000);
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
    const tree = host.locator('file-tree-container');
    await tree.getByPlaceholder('Search…').fill('lifecycle.ts');
    await tree.locator('[data-item-path="src/content/lifecycle.ts"]').click();
    const file = host.locator('diffs-container').filter({ has: page.locator('.fh[data-path="src/content/lifecycle.ts"]') });
    await expect(file.locator('.fh')).toBeInViewport();
    await page.mouse.move(1100, 650);
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(500);
    const visibleRows = () => file.locator('[data-line]').evaluateAll(lines => lines.map(line => ({
      number: line.getAttribute('data-line'), text: line.textContent, top: line.getBoundingClientRect().top,
    })).filter(line => line.top > 180 && line.top < 400));
    await expect.poll(async () => (await visibleRows()).length).toBeGreaterThan(2);
    const tracked = (await visibleRows())[0]!;
    expect(tracked).toBeDefined();
    // Stack navigation appears only once the merged title sticks.
    await expect(host.locator('.pierre-toolbar')).toHaveAttribute('data-stuck', 'true');
    await host.getByTestId('stack-button').click();
    const panel = host.locator('.stack-menu .popover-panel');
    await expect(panel).toBeVisible({ timeout: 5000 });
    const panelBox = (await panel.boundingBox())!;
    expect.soft(panelBox.y + panelBox.height, 'The stack menu must fit below the toolbar').toBeLessThanOrEqual(800);
    await panel.locator('.stack-list').evaluate(el => { el.scrollTop = el.scrollHeight; });
    await expect.soft(panel.locator('.stack-base')).toBeInViewport();
    await page.screenshot({ path: info.outputPath('stack-menu.png') });
    await page.keyboard.press('Escape');

    await host.getByTestId('review-button').click();
    const summary = host.locator('.review-menu textarea');
    await summary.fill('Regression check, retained draft only.');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500); // The existing persistence debounce is 300ms.

    // Hit-test the shipped backdrop CSS; dialog state/remount behavior is covered with real components in unit tests.
    const hit = await host.evaluate(el => {
      const root = el.shadowRoot!;
      const backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop';
      root.querySelector('.pierre-app')!.append(backdrop);
      const button = root.querySelector('[data-testid="review-button"]')!.getBoundingClientRect();
      const covered = root.elementFromPoint(button.x + button.width / 2, button.y + button.height / 2) === backdrop;
      backdrop.remove();
      return covered;
    });
    expect.soft(hit, 'The modal backdrop must block toolbar clicks').toBe(true);
    await page.screenshot({ path: info.outputPath('before-reload.png') });
    await page.reload();
    await expect(host.locator('.fh').first()).toBeVisible();
    await expect(file.locator('.fh'), 'Reload must restore the same file').toBeInViewport();
    await expect.poll(async () => file.locator('[data-line]').evaluateAll((lines, target) =>
      Math.min(...lines.filter(line => line.getAttribute('data-line') === target.number && line.textContent === target.text)
        .map(line => Math.abs(line.getBoundingClientRect().top - target.top))), tracked),
    ).toBeLessThan(0.5);
    await host.getByTestId('review-button').click();
    await expect(summary).toHaveValue('Regression check, retained draft only.');
    await page.keyboard.press('Escape');
    await page.screenshot({ path: info.outputPath('restored-file.png') });
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});
