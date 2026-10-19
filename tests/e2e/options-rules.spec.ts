/** Rule editor interaction checks in a disposable extension profile. */
import { test, expect } from './inpage-fixtures';
import { extensionId } from './fixtures';
import type { Locator } from '@playwright/test';

async function expectContentFits(field: Locator) {
  await expect(field).toHaveAttribute('rows', '4');
  await expect.poll(() => field.evaluate(el => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1);
  expect(await field.evaluate(el => el.clientHeight >= 4 * parseFloat(getComputedStyle(el).lineHeight))).toBe(true);
}

for (const theme of ['light', 'dark']) test(`rule editors fit content and save through keyboard editing (${theme})`, async ({ glideContext }, info) => {
  const page = await glideContext.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`chrome-extension://${extensionId()}/options.html`);
  await page.evaluate(async (theme) => {
    const all = await chrome.storage.sync.get(null);
    await chrome.storage.sync.remove(Object.keys(all).filter(key => key === 'pierre.fileGroups' || key.startsWith('pierre.fileGroups.') || key === 'pierre.relatedFiles'));
    await chrome.storage.sync.set({ 'pierre.settings': { diff: { themeType: theme } } });
  }, theme);
  await page.reload();
  const groups = page.getByRole('region', { name: 'File groups', exact: true });
  const related = page.getByRole('region', { name: 'Related files', exact: true });
  const patternsField = groups.getByRole('textbox', { name: 'Patterns of Tests', exact: true });
  await expect(patternsField).toBeAttached();
  const original = await patternsField.inputValue();
  const lines = original.split('\n').length;
  expect(lines).toBeGreaterThan(6);
  await expectContentFits(patternsField);
  await groups.evaluate(el => el.scrollIntoView({block: 'start'}));
  await page.mouse.move(5, 5);
  await page.screenshot({path: info.outputPath('file-groups.png')});

  // Native Tab navigation still enters the field without hiding patterns on blur.
  await groups.getByRole('textbox', { name: 'Name of group 2', exact: true }).focus();
  for (let step = 0; step < 5 && !(await patternsField.evaluate(el => el === document.activeElement)); step++) await page.keyboard.press('Tab');
  await expect(patternsField).toBeFocused();
  await expectContentFits(patternsField);
  expect(await patternsField.evaluate(el => getComputedStyle(el).outlineStyle)).toBe('solid');
  await patternsField.fill(original + '\n*.declutter-test');
  await page.keyboard.press('Tab');
  await expectContentFits(patternsField);
  await expect.poll(() => page.evaluate(async () => JSON.stringify(await chrome.storage.sync.get(null)))).toContain('*.declutter-test');
  await page.reload();
  await expect(patternsField).toHaveValue(original + '\n*.declutter-test');

  await related.evaluate(el => el.scrollIntoView({block: 'start'}));
  await page.mouse.move(5, 5);
  await page.screenshot({path: info.outputPath('related-files.png')});
  const companions = related.getByRole('textbox', { name: 'Related files of package.json', exact: true });
  const patterns = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lock', 'bun.lockb', 'npm-shrinkwrap.json', 'custom.lock'].join('\n');
  await companions.fill(patterns);
  await expectContentFits(companions);
  await page.screenshot({path: info.outputPath('editing-related-files.png')});
  await page.keyboard.press('Tab');
  await expectContentFits(companions);
  await expect.poll(() => page.evaluate(async () => JSON.stringify(await chrome.storage.sync.get('pierre.relatedFiles')))).toContain('custom.lock');
  await page.reload();
  await expect(companions).toHaveValue(patterns);
  await page.setViewportSize({width: 390, height: 844});
  await related.evaluate(el => el.scrollIntoView({block: 'start'}));
  for (const editor of [groups, related]) {
    const width = await editor.locator('.rule-editor-list').evaluate(el => ({right: el.getBoundingClientRect().right, client: el.clientWidth, scroll: el.scrollWidth}));
    expect(width.right).toBeLessThanOrEqual(390);
    expect(width.scroll).toBe(width.client);
  }
  await companions.click();
  await expectContentFits(companions);
  await page.screenshot({path: info.outputPath('narrow-editing.png')});

  await groups.getByText('Import from Sift for GitHub', {exact: true}).click();
  // Exercise every textarea, including the import panel and paths probe.
  for (const field of await page.locator('textarea').all()) {
    const saved = await field.inputValue();
    await field.fill('');
    await expectContentFits(field);
    const minimum = await field.evaluate(el => el.clientHeight);
    await field.fill(Array.from({length: 25}, (_, i) => `path-${i}.json`).join('\n'));
    await page.keyboard.press('Tab');
    await expectContentFits(field);
    expect(await field.evaluate(el => el.clientHeight)).toBeGreaterThan(minimum * 2);
    await field.fill('short');
    await expectContentFits(field);
    expect(await field.evaluate(el => el.clientHeight)).toBe(minimum);
    await field.fill(saved);
  }
  const imported = page.getByRole('textbox', {name: 'Sift settings to import'});
  await page.setViewportSize({width: 1280, height: 900});
  await imported.fill('long wrapped content '.repeat(80));
  await expectContentFits(imported);
  const wideHeight = await imported.evaluate(el => el.clientHeight);
  await page.setViewportSize({width: 390, height: 844});
  await expectContentFits(imported);
  expect(await imported.evaluate(el => el.clientHeight)).toBeGreaterThan(wideHeight);
  await page.setViewportSize({width: 1280, height: 900});
  await expectContentFits(imported);
  expect(await imported.evaluate(el => el.clientHeight)).toBe(wideHeight);
});
