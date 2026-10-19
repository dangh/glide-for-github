/** Read-only checks on the sandbox fixture matching the reported nested package/lock-file paths. */
import { test, expect, waitForViewer } from './inpage-fixtures';
import { extensionId } from './fixtures';

const folders = ['admin/services/add-ons', 'admin/web'];

for (const style of ['nested', 'box'] as const) {
  test(`${style} related files touch when collapsed and expanded in-page`, async ({ glideContext }, info) => {
    const options = await glideContext.newPage();
    await options.goto(`chrome-extension://${extensionId()}/options.html`);
    await options.evaluate(async style => {
      const saved = (await chrome.storage.sync.get('pierre.settings'))['pierre.settings'];
      const settings = typeof saved === 'object' && saved !== null ? saved : {};
      const groups = 'fileGroups' in settings && typeof settings.fileGroups === 'object' && settings.fileGroups !== null ? settings.fileGroups : {};
      await chrome.storage.sync.set({ 'pierre.settings': { ...settings, relatedFiles: { style }, fileGroups: { ...groups, enabled: false } } });
    }, style);
    await options.close();
    const page = await glideContext.newPage();
    await page.goto('https://github.com/dangh/pierre-sandbox/pull/3/files#glide');
    await waitForViewer(page);
    const host = page.locator('#glide-inpage-spike');
    const tree = host.locator('file-tree-container');
    const header = (path: string) => host.locator(`.fh[data-path="${path}"]`);
    const reveal = async (path: string) => {
      await tree.getByPlaceholder('Search…').fill(path);
      await tree.locator(`[data-item-path="${path}"]`).click();
      await expect(header(path)).toBeInViewport();
    };
    // Collapse through the actual controls, including the unrelated changelog rows in the screenshot.
    for (const folder of folders) {
      for (const name of ['CHANGELOG.md', 'package.json', 'package-lock.json']) {
        const path = `${folder}/${name}`;
        await reveal(path);
        if (await header(path).getAttribute('data-collapsed') === null) await header(path).locator('.fh-chevron').click();
        await expect(header(path)).toHaveAttribute('data-collapsed');
      }
    }
    const measure = (paths: string[]) => host.evaluate((el, paths) => paths.map(path => {
      const header = el.shadowRoot!.querySelector<HTMLElement>(`.fh[data-path="${path}"]`)!;
      const box = header.closest('diffs-container')!;
      const rect = box.getBoundingClientRect();
      return { path, top: rect.top, bottom: rect.bottom, height: rect.height, margin: getComputedStyle(box).marginTop };
    }), paths);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.screenshot({ path: info.outputPath('collapsed-groups.png') });
    for (const folder of folders) {
      const main = `${folder}/package.json`;
      const lock = `${folder}/package-lock.json`;
      const paths = style === 'box' ? [`/related/${main}`, main, lock] : [main, lock];
      const gaps = async () => {
        const parts = await measure(paths);
        return parts.slice(1).map((part, i) => part.top - parts[i]!.bottom);
      };
      await info.attach(folder.replaceAll('/', '-') + '-geometry', { body: JSON.stringify(await measure(paths)), contentType: 'application/json' });
      await expect.poll(gaps).toEqual(paths.slice(1).map(() => 0));
      expect((await measure([main]))[0]!.height).toBe(42);
      await header(main).locator('.fh-chevron').click();
      await expect(header(main)).not.toHaveAttribute('data-collapsed');
      await expect.poll(gaps).toEqual(paths.slice(1).map(() => 0));
      await header(main).locator('.fh-chevron').click();
      await expect(header(main)).toHaveAttribute('data-collapsed');
      await expect.poll(gaps).toEqual(paths.slice(1).map(() => 0));
    }
  });
}
