/** Rule editor interaction checks in a disposable extension profile. */
import { test, expect } from './inpage-fixtures';
import { extensionId } from './fixtures';

test('rule editors expand on focus and save through keyboard editing', async ({ glideContext }, info) => {
  const page = await glideContext.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`chrome-extension://${extensionId()}/options.html`);
  await page.evaluate(async () => {
    const all = await chrome.storage.sync.get(null);
    await chrome.storage.sync.remove(Object.keys(all).filter(key => key === 'pierre.fileGroups' || key.startsWith('pierre.fileGroups.') || key === 'pierre.relatedFiles'));
    await chrome.storage.sync.set({ 'pierre.settings': { diff: { themeType: 'light' } } });
  });
  await page.reload();
  const groups = page.getByRole('region', { name: 'File groups', exact: true });
  const related = page.getByRole('region', { name: 'Related files', exact: true });
  const patternsField = groups.getByRole('textbox', { name: 'Patterns of Tests', exact: true });
  await expect(patternsField).toBeAttached();
  const original = await patternsField.inputValue();
  const lines = original.split('\n').length;
  expect(lines).toBeGreaterThan(6);
  await expect(patternsField).toHaveAttribute('rows', '6');
  await expect(patternsField).toHaveAttribute('data-more', 'true');
  await groups.evaluate(el => el.scrollIntoView({block: 'start'}));
  await page.mouse.move(5, 5);
  await page.screenshot({path: info.outputPath('file-groups.png')});

  // Native Tab navigation still enters the field and expands every pattern.
  await groups.getByRole('textbox', { name: 'Name of group 2', exact: true }).focus();
  for (let step = 0; step < 5 && !(await patternsField.evaluate(el => el === document.activeElement)); step++) await page.keyboard.press('Tab');
  await expect(patternsField).toBeFocused();
  await expect(patternsField).toHaveAttribute('rows', String(lines));
  await expect(patternsField).not.toHaveAttribute('data-more');
  expect(await patternsField.evaluate(el => getComputedStyle(el).outlineStyle)).toBe('solid');
  await patternsField.fill(original + '\n*.declutter-test');
  await page.keyboard.press('Tab');
  await expect(patternsField).toHaveAttribute('rows', '6');
  await expect.poll(() => page.evaluate(async () => JSON.stringify(await chrome.storage.sync.get(null)))).toContain('*.declutter-test');
  await page.reload();
  await expect(patternsField).toHaveValue(original + '\n*.declutter-test');

  await related.evaluate(el => el.scrollIntoView({block: 'start'}));
  await page.mouse.move(5, 5);
  await page.screenshot({path: info.outputPath('related-files.png')});
  const companions = related.getByRole('textbox', { name: 'Related files of package.json', exact: true });
  const patterns = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lock', 'bun.lockb', 'npm-shrinkwrap.json', 'custom.lock'].join('\n');
  await companions.fill(patterns);
  await expect(companions).toHaveAttribute('rows', '7');
  await page.screenshot({path: info.outputPath('editing-related-files.png')});
  await page.keyboard.press('Tab');
  await expect(companions).toHaveAttribute('rows', '6');
  await expect(companions).toHaveAttribute('data-more', 'true');
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
  await expect(companions).toHaveAttribute('rows', '7');
  await page.screenshot({path: info.outputPath('narrow-editing.png')});
});
