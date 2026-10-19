import { test, waitForViewer, expect } from './inpage-fixtures';

test('native GitHub navigation returns to a working viewer with its draft', async ({ glideContext }, info) => {
  const page = await glideContext.newPage();
  await page.goto('https://github.com/dangh/pierre-sandbox/pull/1/files#glide');
  await waitForViewer(page);
  const host = page.locator('#glide-inpage-spike');
  await expect(host.locator('[data-line]').first()).toBeVisible();
  await page.mouse.move(1100, 650); await page.mouse.wheel(0, -100000);
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  await host.getByTestId('review-button').press('Enter');
  await host.locator('.review-menu textarea').fill('Navigation retention check, not submitted.');
  await page.keyboard.press('Escape');
  const before = await page.evaluate(() => performance.timeOrigin);
  await page.locator('a[href="/dangh/pierre-sandbox/pulls"]').first().click();
  await expect(page).toHaveURL('https://github.com/dangh/pierre-sandbox/pulls');
  await expect(host).toHaveCount(0);
  await expect(page.locator('iframe[data-glide-worker-host]')).toHaveCount(0);
  await page.getByText('review-me: sandbox fixture PR', { exact: true }).click();
  await expect(page).toHaveURL('https://github.com/dangh/pierre-sandbox/pull/1');
  await info.attach('navigation-mode', { body: (await page.evaluate(() => performance.timeOrigin)) === before ? 'same-document' : 'full-document', contentType: 'text/plain' });
  await page.locator('a[data-pierre-tab]').click();
  await expect(host.locator('[data-line]').first()).toBeVisible();
  await page.mouse.move(1100, 650); await page.mouse.wheel(0, -100000);
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  await host.getByTestId('review-button').press('Enter');
  await expect(host.locator('.review-menu textarea')).toHaveValue('Navigation retention check, not submitted.');
  await page.screenshot({ path: info.outputPath('after-native-navigation.png') });
  await page.keyboard.press('Escape');
  await expect.poll(async () => page.frames().find(frame => frame.url().includes('/worker-host.html'))?.evaluate(() => window.__glideWorkerHost?.renders ?? 0)).toBeGreaterThan(0);
  await expect(page.locator('iframe[data-glide-worker-host]')).toHaveCount(1);
});

// GitHub's current list route reloads the document. Exercise Turbo's body replacement separately.
test('body replacement remounts the viewer and workers without losing its draft', async ({ glideContext }) => {
  const page = await glideContext.newPage();
  await page.goto('https://github.com/dangh/pierre-sandbox/pull/1/files#glide');
  await waitForViewer(page);
  const host = page.locator('#glide-inpage-spike');
  await expect(host.locator('[data-line]').first()).toBeVisible();
  await host.getByTestId('review-button').click();
  await host.locator('.review-menu textarea').fill('Body replacement draft');
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    const body = document.body.cloneNode(true) as HTMLBodyElement;
    body.querySelector('#glide-inpage-spike')?.remove();
    body.querySelector('iframe[data-glide-worker-host]')?.remove();
    document.body.replaceWith(body);
    document.dispatchEvent(new Event('turbo:render'));
  });
  await expect(host.locator('[data-line]').first()).toBeVisible();
  await host.getByTestId('review-button').click();
  await expect(host.locator('.review-menu textarea')).toHaveValue('Body replacement draft');
  await expect(page.locator('iframe[data-glide-worker-host]')).toHaveCount(1);
  await expect.poll(async () => page.frames().find(frame => frame.url().includes('/worker-host.html'))?.evaluate(() => window.__glideWorkerHost?.renders ?? 0)).toBeGreaterThan(0);
});
