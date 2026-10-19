/**
 * Shared e2e fixtures (see playwright.config.ts for setup): a worker-scoped persistent Chrome context on the
 * copied logged-in profile with dist/ loaded, and helpers to drive the Pierre viewer iframe.
 */
import { test as base, chromium, expect, type BrowserContext, type Frame, type FrameLocator, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const PROFILE = join(ROOT, '.e2e-profile');
export const DIST = join(ROOT, 'dist');

/** Chrome derives an unpacked extension's id from its path: sha256, first 32 hex digits mapped to a-p. */
export function extensionId(): string {
  const hex = createHash('sha256').update(realpathSync(DIST)).digest('hex').slice(0, 32);
  return [...hex].map((c) => String.fromCharCode('a'.charCodeAt(0) + parseInt(c, 16))).join('');
}

export interface PrId {
  owner: string;
  repo: string;
  number: number;
}

export const SANDBOX: PrId = JSON.parse(readFileSync(join(ROOT, 'tests/sandbox.json'), 'utf8'));
export const REACT: PrId = { owner: 'react', repo: 'react', number: 37778 };
export const prUrl = (pr: PrId, suffix = '') => `https://github.com/${pr.owner}/${pr.repo}/pull/${pr.number}${suffix}`;

/** Chrome for Testing binary: $PIERRE_E2E_CHROME, else the newest agent-browser download. */
/**
 * Headed by default, on the VNC desktop (DISPLAY, default :0) so runs can be watched; `PIERRE_E2E_HEADLESS=1`
 * (`npm run e2e:headless`, CI) runs headless.
 */
export const HEADLESS = process.env.PIERRE_E2E_HEADLESS === '1';
export const browserEnv = (): Record<string, string> =>
  HEADLESS ? {} : { DISPLAY: process.env.DISPLAY || ':0', WAYLAND_DISPLAY: '' };

export function chromePath(): string {
  if (process.env.PIERRE_E2E_CHROME) return process.env.PIERRE_E2E_CHROME;
  const dir = join(homedir(), '.agent-browser/browsers');
  const versions = existsSync(dir) ? readdirSync(dir).filter((d) => /^chrome-\d/.test(d)) : [];
  const num = (d: string) => d.replace('chrome-', '').split('.').map(Number);
  versions.sort((a, b) => {
    const [x, y] = [num(a), num(b)];
    for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
    return 0;
  });
  const newest = versions.at(-1);
  if (!newest) throw new Error('No Chrome for Testing found; set PIERRE_E2E_CHROME');
  return join(dir, newest, 'chrome');
}

export const test = base.extend<{ page: Page }, { extContext: BrowserContext }>({
  extContext: [
    async ({}, use) => {
      if (!existsSync(join(PROFILE, 'Default'))) throw new Error('No .e2e-profile: run scripts/e2e-profile.sh first');
      if (!existsSync(join(DIST, 'manifest.json'))) throw new Error('No dist/: run npm run build first');
      const context = await chromium.launchPersistentContext(PROFILE, {
        executablePath: chromePath(),
        headless: HEADLESS,
        env: { ...(process.env as Record<string, string>), ...browserEnv() },
        args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
        viewport: { width: 1400, height: 900 },
      });
      await use(context);
      await context.close();
    },
    { scope: 'worker' },
  ],
  page: async ({ extContext }, use) => {
    const page = await extContext.newPage();
    await use(page);
    await page.close();
  },
});
export { expect };

export interface FileLoad {
  status: string;
  empty?: boolean;
  loadingLines?: boolean;
}

export interface ItemInfo {
  header: string;
  /** Rendered `[data-line]` rows in the item's shadow DOM (virtualized: only the visible window). */
  lines: number;
  diffType: string | null;
  collapsed: boolean | null;
  top: number;
}

/** The Pierre viewer iframe of a page (re-found on every call: the content script may remount it). */
export class Viewer {
  readonly locator: FrameLocator;

  constructor(readonly page: Page) {
    this.locator = page.frameLocator('iframe[data-pierre-viewer]');
  }

  frame(): Frame {
    const frame = this.page.frames().find((f) => f.url().startsWith('chrome-extension://') && f.url().includes('/viewer.html'));
    if (!frame) throw new Error('Glide viewer frame not found');
    return frame;
  }

  /** Waits for the viewer to have the PR data and its first file header. */
  async ready(timeout = 60_000) {
    // GitHub replaces its page layout once during load (~0.5 s after the load event, with or without Pierre), which
    // remounts the iframe. With the route prefetched (Task 12) the first viewer can already show the PR by then, so
    // wait for the page's load event and until the same viewer frame has the PR and stays attached for 1.5 s.
    await this.page.waitForLoadState('load', { timeout });
    for (let attempt = 0; attempt < 4; attempt++) {
      await expect(this.locator.locator('.fh').first()).toBeVisible({ timeout });
      await expect
        .poll(
          async () => {
            // Between the old frame's removal and the new one's arrival `frame()` throws: not ready yet.
            try {
              return await this.frame().evaluate(() => window.__pierre?.store.getState().pr !== null);
            } catch {
              return false;
            }
          },
          { timeout },
        )
        .toBe(true);
      const frame = this.frame();
      await this.page.waitForTimeout(1500);
      if (!frame.isDetached() && this.frame() === frame) return;
    }
    throw new Error('Glide viewer frame did not settle');
  }

  order(): Promise<string[]> {
    return this.frame().evaluate(() => window.__pierre!.store.getState().order);
  }

  loads(): Promise<Record<string, FileLoad>> {
    return this.frame().evaluate(() => Object.fromEntries(window.__pierre!.store.getState().load));
  }

  /** Waits until no file is pending/loading (lazy and on-demand line loads excluded). */
  async allFetched(timeout = 60_000) {
    await expect
      .poll(
        async () => Object.values(await this.loads()).filter((l) => l.status === 'pending' || l.status === 'loading').length,
        { timeout, intervals: [100, 250, 500] },
      )
      .toBe(0);
  }

  async scrollToFile(path: string) {
    await this.frame().evaluate((p) => window.__pierre!.session.scrollToFile?.(p), path);
  }

  item(path: string): Promise<ItemInfo | null> {
    return this.frame().evaluate((p) => {
      const header = [...document.querySelectorAll<HTMLElement>('.fh')].find((e) => e.dataset.path === p);
      if (!header) return null;
      const root = header.closest('diffs-container')?.shadowRoot;
      return {
        header: header.innerText.replace(/\s+/g, ' ').trim(),
        lines: root ? root.querySelectorAll('[data-line]').length : 0,
        diffType: root?.querySelector('[data-diff-type]')?.getAttribute('data-diff-type') ?? null,
        collapsed: window.__pierre!.session.codeView?.getItem(p)?.collapsed ?? null,
        top: header.getBoundingClientRect().top - document.querySelector('.pierre-diffs')!.getBoundingClientRect().top,
      };
    }, path);
  }

  /** Every file path in the tree (folders expanded by the caller), scrolling its virtualized list. */
  treeFiles(): Promise<string[]> {
    return this.frame().evaluate(async () => {
      const root = document.querySelector('file-tree-container')?.shadowRoot;
      if (!root) return [];
      const seen = new Set<string>();
      const collect = () =>
        root.querySelectorAll<HTMLElement>('[data-item-type="file"][data-item-path]').forEach((e) => seen.add(e.dataset.itemPath!));
      const scroller = [...root.querySelectorAll<HTMLElement>('*')].find(
        (e) => e.scrollHeight > e.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(e).overflowY),
      );
      collect();
      if (scroller) {
        scroller.scrollTop = 0;
        for (let i = 0; i < 500; i++) {
          await new Promise((r) => setTimeout(r, 40));
          collect();
          if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1) break;
          scroller.scrollTop += Math.max(40, scroller.clientHeight * 0.7);
        }
        await new Promise((r) => setTimeout(r, 40));
        collect();
      }
      return [...seen];
    });
  }

  viewedCounter(): Promise<string> {
    return this.locator.getByTestId('viewed-counter').innerText();
  }
}

/** Opens a PR page and switches to the Glide tab by clicking it (or with `#glide`). */
export async function openPierre(page: Page, pr: PrId, how: 'click' | 'hash' = 'click'): Promise<Viewer> {
  if (how === 'hash') {
    // Already there: `goto` would be a same-document hash navigation (no reload), so reload to get fresh data.
    if (page.url() === prUrl(pr, '#glide')) await page.reload({ waitUntil: 'domcontentloaded' });
    else await page.goto(prUrl(pr, '#glide'), { waitUntil: 'domcontentloaded' });
  } else {
    await page.goto(prUrl(pr), { waitUntil: 'load' });
    const tab = page.locator('a[data-pierre-tab]');
    await expect(tab).toBeVisible({ timeout: 30_000 });
    // A click while GitHub is still hydrating its tab strip can be lost (the strip is re-rendered and the
    // tab re-injected), so click until the URL switches to #glide.
    await expect(async () => {
      if (!page.url().endsWith('#glide')) await tab.click({ timeout: 5_000 });
      expect(page.url()).toMatch(/#glide$/);
    }).toPass({ timeout: 30_000, intervals: [1_000, 2_000] });
  }
  const viewer = new Viewer(page);
  await viewer.ready();
  return viewer;
}

/** GitHub's own "N of M files viewed" from its Files changed page. */
export async function githubViewedCount(page: Page, pr: PrId): Promise<{ viewed: number; total: number }> {
  await page.goto(prUrl(pr, '/files'), { waitUntil: 'domcontentloaded' });
  const label = page.getByText(/\d+ of \d+ files? viewed/).first();
  await expect(label).toBeVisible({ timeout: 30_000 });
  const m = /(\d+) of (\d+) files? viewed/.exec(await label.innerText())!;
  return { viewed: Number(m[1]), total: Number(m[2]) };
}

/** Glide's sync items: the settings, the file groups and the related-files rules. */
const isGlideKey = (k: string) => k === 'pierre.settings' || k.startsWith('pierre.fileGroups') || k === 'pierre.relatedFiles';

export async function extensionPage(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId()}/options.html`);
  return page;
}

export async function readGlideSync(context: BrowserContext): Promise<Record<string, unknown>> {
  const ext = await extensionPage(context);
  const all = await ext.evaluate(() => chrome.storage.sync.get(null));
  await ext.close();
  return Object.fromEntries(Object.entries(all).filter(([k]) => isGlideKey(k)));
}

export async function writeGlideSync(context: BrowserContext, items: Record<string, unknown>) {
  const ext = await extensionPage(context);
  await ext.evaluate(async (saved) => {
    const all = await chrome.storage.sync.get(null);
    const stale = Object.keys(all).filter((k) => (k === 'pierre.settings' || k.startsWith('pierre.fileGroups') || k === 'pierre.relatedFiles') && !(k in saved));
    if (stale.length > 0) await chrome.storage.sync.remove(stale);
    if (Object.keys(saved).length > 0) await chrome.storage.sync.set(saved);
  }, items);
  await ext.close();
}

/** Merges `patch` into one section of the stored settings. */
export async function setSettings(context: BrowserContext, section: string, patch: Record<string, unknown>, back?: Page) {
  const ext = await extensionPage(context);
  await ext.evaluate(
    async ([name, value]) => {
      const stored = ((await chrome.storage.sync.get('pierre.settings'))['pierre.settings'] ?? {}) as Record<string, Record<string, unknown>>;
      stored[name as string] = { ...stored[name as string], ...(value as Record<string, unknown>) };
      await chrome.storage.sync.set({ 'pierre.settings': stored });
    },
    [section, patch] as const,
  );
  await ext.close();
  await back?.bringToFront();
}
