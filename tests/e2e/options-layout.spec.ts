/** Settings navigation and responsive layout in the built extension. */
import { test, expect } from './inpage-fixtures';
import { extensionId } from './fixtures';

test('settings navigation, preview and forms work in light, dark and narrow layouts', async ({ glideContext }, info) => {
  const page = await glideContext.newPage();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`chrome-extension://${extensionId()}/options.html`);
  await page.evaluate(async () => chrome.storage.sync.set({ 'pierre.settings': { diff: { themeType: 'light' } } }));
  await page.reload();
  const navigation = page.getByRole('navigation', { name: 'Settings sections' });
  await expect(navigation.getByRole('link')).toHaveCount(6);
  await expect(page.getByTestId('sample-diff')).toBeVisible();
  await page.screenshot({ path: info.outputPath('options-light.png') });

  // The navigation uses native anchors, including keyboard activation and browser history.
  await navigation.getByRole('link', { name: 'Related files', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#related-files-heading$/);
  await expect.poll(() => page.locator('#related-files-heading').evaluate(el => el.getBoundingClientRect().top)).toBeGreaterThanOrEqual(0);
  await expect.poll(() => page.locator('#related-files-heading').evaluate(el => el.getBoundingClientRect().top)).toBeLessThan(100);
  await page.screenshot({ path: info.outputPath('related-light.png') });
  await page.goBack();
  await expect(page).not.toHaveURL(/#related-files-heading$/);

  const layout = page.locator('label.field').filter({ has: page.locator('span', { hasText: /^Layout$/ }) }).locator('select');
  await layout.selectOption('split');
  await expect.poll(() => page.evaluate(() => document.querySelector('[data-testid="sample-diff"] diffs-container')?.shadowRoot?.querySelector('[data-diff-type]')?.getAttribute('data-diff-type'))).toBe('split');
  await page.reload();
  await expect(layout).toHaveValue('split');

  await page.getByRole('button', { name: 'Add token', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  for (const theme of ['light', 'dark']) {
    await page.locator('label.field').filter({ has: page.locator('span', { hasText: /^Mode$/ }) }).locator('select').selectOption(theme);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: info.outputPath(`options-${theme}.png`) });
    for (const width of [1280, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      for (const link of await navigation.getByRole('link').all()) {
        await link.click();
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      }
      if (width === 390) {
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: info.outputPath(`options-narrow-${theme}.png`) });
        await page.getByRole('button', { name: 'Add token', exact: true }).click();
        await expect(page.getByRole('dialog')).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
        await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
      }
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
});
