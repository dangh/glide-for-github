/** Retired styles fall back to Nested in both settings surfaces and in the live PR. */
import { test, expect, waitForViewer } from './inpage-fixtures';
import { extensionId } from './fixtures';

for (const retired of ['box', 'rail']) {
  test(`${retired} falls back to Nested; Nested and Off remain selectable`, async ({ glideContext }, info) => {
    const options = await glideContext.newPage();
    await options.goto(`chrome-extension://${extensionId()}/options.html`);
    await options.evaluate(async style => {
      await chrome.storage.sync.set({ 'pierre.settings': {
        relatedFiles: { style }, fileGroups: { enabled: false },
        experiments: { pageScroll: true, mergedBar: true },
      } });
    }, retired);
    await options.reload();
    const section = options.getByRole('region', { name: 'Related files', exact: true });
    await expect(section.getByRole('radio')).toHaveCount(2);
    await expect(section.getByRole('radio', { name: /Nested/ })).toBeChecked();
    await section.scrollIntoViewIfNeeded();
    await section.getByRole('radiogroup').screenshot({ path: info.outputPath('remaining-styles.png') });

    const page = await glideContext.newPage();
    await page.goto('https://github.com/dangh/pierre-sandbox/pull/3/files#glide');
    await waitForViewer(page);
    const host = page.locator('#glide-inpage-spike');
    const companions = host.locator('.fh[data-related="companion"]');
    await expect(companions).toHaveCount(2);
    await host.getByTestId('display-menu').click();
    const select = host.getByRole('combobox', { name: 'Related files', exact: true });
    await expect(select.locator('option')).toHaveText(['Nested', 'Off']);
    await expect(select).toHaveValue('nested');
    await select.selectOption('off');
    await expect(host.locator('.fh[data-related]')).toHaveCount(0);
    await expect(section.getByRole('radio', { name: /^Off/ })).toBeChecked();
    await select.selectOption('nested');
    await expect(companions).toHaveCount(2);
    await expect(section.getByRole('radio', { name: /Nested/ })).toBeChecked();
    await page.keyboard.press('Escape');
    await page.reload();
    await waitForViewer(page);
    await expect(host.locator('.fh[data-related="companion"]')).toHaveCount(2);
  });
}
