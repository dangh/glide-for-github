import { test, waitForViewer, expect } from './inpage-fixtures';

test('recovers old extension-origin drafts once, before rendering, without altering the originals', async ({ glideContext }, info) => {
  const page = await glideContext.newPage();
  const url = 'https://github.com/dangh/glide-for-github/pull/1/files#glide';
  await page.goto(url);
  await waitForViewer(page);
  const host = page.locator('#glide-inpage-spike');
  await expect(host.locator('.fh').first()).toBeVisible();
  const legacy = page.frames().find(frame => frame.url().includes('/worker-host.html'))!;
  const pr = 'dangh/glide-for-github#1';
  const entries = [
    [`pierre.drafts:${pr}`, JSON.stringify([['review-summary', { body: 'Draft from the previous iframe viewer', updatedAt: 1 }]])],
    [`pierre.fileGroup:${pr}`, 'Tests'],
    [`pierre.applySuggestions.key:${pr}`, 'preserved-retry-key'],
    [`glide.scroll:${pr}`, JSON.stringify({ path: 'tests/e2e/page-scroll.spec.ts', offset: 0 })],
  ];
  // Both old viewer.html and worker-host.html share this extension-origin, per-tab storage area.
  await legacy.evaluate(items => { for (const [name, value] of items) sessionStorage.setItem(name!, value!); }, entries);
  await page.evaluate(key => sessionStorage.removeItem(`glide.legacy-session:${key}`), pr);
  await page.reload();
  await waitForViewer(page);
  await expect(host.locator('.fh').first()).toBeVisible();
  await expect(host.getByRole('tab', { name: /^Tests/ })).toHaveAttribute('aria-selected', 'true');
  const openReview = async () => {
    await expect(host.locator('[data-line]').first()).toBeVisible();
    await page.mouse.move(1100, 650);
    await page.mouse.wheel(0, -100000);
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
    await host.getByTestId('review-button').press('Enter');
  };
  await openReview();
  const summary = host.locator('.review-menu textarea');
  await expect(summary).toHaveValue('Draft from the previous iframe viewer');
  await page.screenshot({ path: info.outputPath('recovered-draft.png') });
  await summary.fill('Edited after migration');
  await page.keyboard.press('Escape');
  await page.reload();
  await waitForViewer(page);
  await expect(host.locator('.fh').first()).toBeVisible();
  await openReview();
  await expect(summary).toHaveValue('Edited after migration');
  await summary.fill('');
  await page.keyboard.press('Escape');
  await page.reload();
  await waitForViewer(page);
  await expect(host.locator('.fh').first()).toBeVisible();
  await openReview();
  await expect(summary).toHaveValue('');
  const currentLegacy = page.frames().find(frame => frame.url().includes('/worker-host.html'))!;
  expect(await currentLegacy.evaluate(items => items.map(([name]) => [name, sessionStorage.getItem(name!)]), entries)).toEqual(entries);
  expect(await page.evaluate(key => sessionStorage.getItem(`pierre.applySuggestions.key:${key}`), pr)).toBe('preserved-retry-key');
});
