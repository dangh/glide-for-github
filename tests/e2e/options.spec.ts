/**
 * Options page e2e (Task 13). The e2e profile holds the user's real token, so these tests never read, print or
 * remove it: the token list is checked by owner/kind text only, add and remove use the fake owner
 * `pierre-e2e-owner` with a dummy string GitHub rejects (nothing is saved), and the 'dangh' and '*' entries
 * are never touched. Settings are restored to what they were.
 */
import { expect, extensionId, openPierre, SANDBOX, test, type Viewer } from './fixtures';
import type { BrowserContext, Page } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

const FAKE_OWNER = 'pierre-e2e-owner';
const TOKENS_KEY = 'pierre.tokens';

async function openOptions(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId()}/options.html`);
  await expect(page.getByRole('heading', { name: 'GitHub tokens' })).toBeVisible();
  return page;
}

/** The control of one settings field, by its visible label (the label's text also holds a select's options). */
const field = (page: Page, label: string) =>
  page.locator('label.field').filter({ has: page.locator('span', { hasText: new RegExp(`^${label}$`) }) }).locator('select, input').first();

/** Owners (keys only) of the saved tokens, read inside the extension page; values never leave it. */
const savedOwners = (page: Page) =>
  page.evaluate(async (key) => Object.keys(((await chrome.storage.local.get(key))[key] as Record<string, unknown> | undefined) ?? {}).sort(), TOKENS_KEY);

test.describe('options page', () => {
  test('lists saved tokens by owner and kind, never a token value', async ({ extContext }) => {
    const page = await openOptions(extContext);
    const owners = await savedOwners(page);
    const rows = page.getByTestId('token-row');
    await expect(rows).toHaveCount(owners.length);
    for (const owner of owners) {
      const row = page.locator(`[data-testid="token-row"][data-owner="${owner}"]`);
      await expect(row).toContainText(/classic|fine-grained/);
    }
    // No token-shaped string anywhere in the page. The regex runs in the page and only a count comes back, so a
    // failure cannot print the page (or a token) into the test output.
    const tokenShaped = await page.evaluate(
      () => (document.documentElement.outerHTML.match(/gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}/g) ?? []).length,
    );
    expect(tokenShaped).toBe(0);
    await page.close();
  });

  test('"Add token" validates with GitHub: a rejected token saves nothing', async ({ extContext }) => {
    const page = await openOptions(extContext);
    const before = await savedOwners(page);
    await page.getByRole('button', { name: 'Add token' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.locator('input[name="pierre-token-owner"]').fill(FAKE_OWNER);
    await dialog.locator('input[type="password"]').fill('pierre-e2e-dummy-not-a-token');
    await dialog.getByRole('button', { name: 'Save token' }).click();
    await expect(dialog.getByRole('alert')).toBeVisible({ timeout: 30_000 });
    expect(await savedOwners(page)).toEqual(before);
    await expect(page.locator(`[data-testid="token-row"][data-owner="${FAKE_OWNER}"]`)).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await page.close();
  });

  test('Remove asks first and removes only the chosen entry (fake owner)', async ({ extContext }) => {
    const page = await openOptions(extContext);
    const before = await savedOwners(page);
    // Seed the fake owner directly in storage (a dummy value, not a real token); every other entry is left as it is.
    await page.evaluate(
      async ([key, owner]) => {
        const all = ((await chrome.storage.local.get(key))[key] as Record<string, unknown> | undefined) ?? {};
        await chrome.storage.local.set({ [key!]: { ...all, [owner!]: { token: 'pierre-e2e-dummy', login: 'e2e', kind: 'classic' } } });
      },
      [TOKENS_KEY, FAKE_OWNER],
    );
    try {
      const row = page.locator(`[data-testid="token-row"][data-owner="${FAKE_OWNER}"]`);
      // The open page follows storage changes.
      await expect(row).toBeVisible();
      await expect(row).toContainText('classic');
      await row.getByRole('button', { name: `Remove token for ${FAKE_OWNER}` }).click();
      await row.getByRole('button', { name: 'Keep' }).click();
      await expect(row).toBeVisible();
      await row.getByRole('button', { name: `Remove token for ${FAKE_OWNER}` }).click();
      await row.getByRole('button', { name: 'Confirm remove' }).click();
      await expect(row).toHaveCount(0);
      expect(await savedOwners(page)).toEqual(before);
    } finally {
      // Cleanup if a step failed: drop only the fake owner.
      await page.evaluate(
        async ([key, owner]) => {
          const all = ((await chrome.storage.local.get(key))[key] as Record<string, unknown> | undefined) ?? {};
          if (owner! in all) {
            delete all[owner!];
            await chrome.storage.local.set({ [key!]: all });
          }
        },
        [TOKENS_KEY, FAKE_OWNER],
      );
    }
    expect(await savedOwners(page)).toEqual(before);
    await page.close();
  });

  test('groups the settings as Diff, Tree, Fonts and Review and renders a live Pierre sample', async ({ extContext }) => {
    const page = await openOptions(extContext);
    await expect(page.locator('.settings-form legend')).toHaveText(['Diff', 'Tree', 'Fonts', 'Review']);
    const sample = page.getByTestId('sample-diff');
    const lines = () => page.evaluate(() => document.querySelector('[data-testid="sample-diff"] diffs-container')?.shadowRoot?.querySelectorAll('[data-line]').length ?? 0);
    const diffType = () =>
      page.evaluate(() => document.querySelector('[data-testid="sample-diff"] diffs-container')?.shadowRoot?.querySelector('[data-diff-type]')?.getAttribute('data-diff-type') ?? null);
    await expect(sample).toBeVisible();
    await expect.poll(lines, { timeout: 30_000 }).toBeGreaterThan(5);

    const layout = field(page, 'Layout');
    const original = await layout.inputValue();
    // 'default' is GitHub's layout: unified ('single').
    const typeOf = (style: string) => (style === 'split' ? 'split' : 'single');
    try {
      const other = original === 'split' ? 'unified' : 'split';
      await layout.selectOption(other);
      await expect.poll(diffType, { timeout: 15_000 }).toBe(typeOf(other));
      // A theme choice re-renders the sample too (no reload, same sample element).
      const dark = field(page, 'Dark theme');
      const originalDark = await dark.inputValue();
      await dark.selectOption('dracula');
      await expect.poll(lines).toBeGreaterThan(5);
      await dark.selectOption(originalDark);
    } finally {
      await layout.selectOption(original);
    }
    await expect.poll(diffType, { timeout: 15_000 }).toBe(typeOf(original));
    await page.close();
  });

  test('a setting changed in options reaches an open viewer without reload', async ({ page, extContext }) => {
    const viewer: Viewer = await openPierre(page, SANDBOX, 'hash');
    await viewer.allFetched();
    const path = 'config/settings.json';
    await viewer.scrollToFile(path);
    const original = await viewer.frame().evaluate(() => window.__pierre!.settings.getState().settings.diff.diffStyle);
    const other = original === 'split' ? 'unified' : 'split';
    // 'default' is GitHub's layout: unified ('single').
    const typeOf = (style: string) => (style === 'split' ? 'split' : 'single');
    await expect.poll(async () => (await viewer.item(path))?.diffType).toBe(typeOf(original));

    // The extension id from the options page's path-derived id must match the viewer frame's.
    expect(viewer.frame().url()).toContain(`chrome-extension://${extensionId()}/`);

    const marker = await viewer.frame().evaluate(() => ((window as unknown as { __marker: number }).__marker = 7));
    expect(marker).toBe(7);
    const options = await openOptions(extContext);
    const layout = field(options, 'Layout');
    try {
      await layout.selectOption(other);
      await expect.poll(() => viewer.frame().evaluate(() => window.__pierre!.settings.getState().settings.diff.diffStyle), { timeout: 15_000 }).toBe(other);
      await viewer.scrollToFile(path);
      await expect.poll(async () => (await viewer.item(path))?.diffType, { timeout: 15_000 }).toBe(typeOf(other));
      // Same document: the viewer was not reloaded.
      expect(await viewer.frame().evaluate(() => (window as unknown as { __marker?: number }).__marker)).toBe(7);
    } finally {
      await layout.selectOption(original);
      await expect.poll(() => viewer.frame().evaluate(() => window.__pierre!.settings.getState().settings.diff.diffStyle), { timeout: 15_000 }).toBe(original);
      await options.close();
    }
  });

  test('font text that CSS rejects is marked invalid and never saved', async ({ extContext }) => {
    const page = await openOptions(extContext);
    const input = field(page, 'Code font');
    const stored = () =>
      page.evaluate(async () => ((await chrome.storage.sync.get('pierre.settings'))['pierre.settings'] as { fonts?: { codeFontFamily?: string } } | undefined)?.fonts?.codeFontFamily ?? null);
    const before = await stored();
    for (const bad of ['Menlo)', 'Menlo]', 'Menlo !important', 'Menlo; color: red']) {
      await input.fill(bad);
      await expect(input, bad).toHaveAttribute('aria-invalid', 'true');
    }
    await page.waitForTimeout(1200);
    expect(await stored()).toBe(before);
    await input.fill(before ?? '');
    await expect(input).not.toHaveAttribute('aria-invalid', 'true');
    await page.waitForTimeout(1200);
    await page.close();
  });

  test('a numeric edit typed right before the page closes is still saved', async ({ extContext }) => {
    const page = await openOptions(extContext);
    const input = field(page, 'Lines per expand');
    const original = await input.inputValue();
    const probe = original === '77' ? '78' : '77';
    const stored = (p: Page) =>
      p.evaluate(async () => ((await chrome.storage.sync.get('pierre.settings'))['pierre.settings'] as { diff?: { expansionLineCount?: number } } | undefined)?.diff?.expansionLineCount ?? null);
    try {
      await input.fill(probe);
      // Navigate away at once: well inside the debounce window, so only the unmount/pagehide flush can save it.
      await page.goto('about:blank');
      const check = await openOptions(extContext);
      await expect.poll(() => stored(check), { timeout: 10_000 }).toBe(Number(probe));
      const again = field(check, 'Lines per expand');
      await expect(again).toHaveValue(probe);
      await again.fill(original);
      await expect.poll(() => stored(check), { timeout: 10_000 }).toBe(Number(original));
      await check.close();
    } finally {
      const restore = await openOptions(extContext);
      await field(restore, 'Lines per expand').fill(original);
      await restore.waitForTimeout(1200);
      await restore.close();
    }
    await page.close();
  });
});
