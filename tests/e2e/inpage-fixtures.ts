import { test as base, chromium, expect, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { cp, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { chromePath, DIST, extensionId } from './fixtures';

export const test = base.extend<{ glideContext: BrowserContext }>({
  glideContext: async ({}, use) => {
    const source = process.env.PIERRE_SPIKE_PROFILE;
    if (!source) throw new Error('Set PIERRE_SPIKE_PROFILE to the signed-in test profile');
    const profile = await mkdtemp(join(tmpdir(), 'glide-adoption-'));
    await cp(source, profile, { recursive: true, filter: path => !/Singleton|\/(Cache|Code Cache|GPUCache|Service Worker)(\/|$)/.test(path) });
    // Worktrees have different unpacked-extension IDs. Keep credentials inside the disposable profile.
    const originalDist = join(dirname(source), 'dist');
    const sourceId = [...createHash('sha256').update(originalDist).digest('hex').slice(0, 32)].map(c => String.fromCharCode(97 + parseInt(c, 16))).join('');
    const local = join(profile, 'Default', 'Local Extension Settings');
    if (sourceId !== extensionId() && await stat(join(local, sourceId)).then(() => true, () => false)) {
      await rm(join(local, extensionId()), { recursive: true, force: true });
      await cp(join(local, sourceId), join(local, extensionId()), { recursive: true });
    }
    const context = await chromium.launchPersistentContext(profile, {
      executablePath: chromePath(), headless: true,
      args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`], viewport: { width: 1280, height: 800 },
    });
    try {
      const options = await context.newPage();
      await options.goto(`chrome-extension://${extensionId()}/options.html`);
      await options.evaluate(async () => {
        const old = (await chrome.storage.sync.get('pierre.settings'))['pierre.settings'];
        const settings = typeof old === 'object' && old !== null ? old : {};
        const diff = 'diff' in settings && typeof settings.diff === 'object' && settings.diff !== null ? settings.diff : {};
        await chrome.storage.sync.set({ 'pierre.settings': { ...settings, diff: { ...diff, diffStyle: 'split' }, experiments: { pageScroll: true, mergedBar: true } } });
      });
      await options.close();
      await use(context);
    } finally {
      await context.close();
      await rm(profile, { recursive: true, force: true });
    }
  },
});
export { expect };

export async function clickInDiff(target: Locator) {
  await expect(async () => {
    await target.evaluate(el => el.scrollIntoView({ block: 'center' }));
    await target.click({ timeout: 2000 });
  }).toPass({ timeout: 30000 });
}

/** Wait for Glide's loader, not GitHub's continuously active background network. */
export async function waitForViewer(page: Page) {
  const client = await page.context().newCDPSession(page);
  const contexts = new Map<number, { frameId?: string; isDefault?: boolean }>();
  client.on('Runtime.executionContextCreated', ({ context }) => contexts.set(context.id, context.auxData ?? {}));
  client.on('Runtime.executionContextDestroyed', ({ executionContextId }) => contexts.delete(executionContextId));
  try {
    await client.send('Runtime.enable');
    const { frameTree } = await client.send('Page.getFrameTree');
    await expect.poll(async () => {
      for (const [contextId, context] of contexts) {
        if (context.frameId !== frameTree.frame.id || context.isDefault) continue;
        const value = await client.send('Runtime.evaluate', { contextId, expression: '!!window.__pierreStats?.doneAt', returnByValue: true }).catch(() => null);
        if (value?.result.value === true) return true;
      }
      return false;
    }).toBe(true);
  } finally { await client.detach(); }
}
