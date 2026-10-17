/**
 * Shared e2e fixtures (see playwright.config.ts for setup): a worker-scoped persistent Chrome context on the
 * copied logged-in profile with dist/ loaded, and helpers to drive the Pierre viewer iframe.
 */
import { test as base, chromium, expect, type BrowserContext, type Frame, type FrameLocator, type Page } from '@playwright/test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const PROFILE = join(ROOT, '.e2e-profile');
export const DIST = join(ROOT, 'dist');

export interface PrId {
  owner: string;
  repo: string;
  number: number;
}

export const SANDBOX: PrId = JSON.parse(readFileSync(join(ROOT, 'tests/sandbox.json'), 'utf8'));
export const REACT: PrId = { owner: 'react', repo: 'react', number: 37778 };
export const prUrl = (pr: PrId, suffix = '') => `https://github.com/${pr.owner}/${pr.repo}/pull/${pr.number}${suffix}`;

/** Chrome for Testing binary: $PIERRE_E2E_CHROME, else the newest agent-browser download. */
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
        headless: !process.env.PIERRE_E2E_HEADED,
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
    if (!frame) throw new Error('Pierre viewer frame not found');
    return frame;
  }

  /** Waits for the viewer to have the PR data and its first file header. */
  async ready(timeout = 60_000) {
    // The content script may remount the iframe once while GitHub hydrates: wait until the same viewer
    // frame has the PR and stays attached.
    for (let attempt = 0; attempt < 4; attempt++) {
      await expect(this.locator.locator('.fh').first()).toBeVisible({ timeout });
      await expect.poll(() => this.frame().evaluate(() => window.__pierre?.store.getState().pr !== null), { timeout }).toBe(true);
      const frame = this.frame();
      await this.page.waitForTimeout(500);
      if (!frame.isDetached() && this.frame() === frame) return;
    }
    throw new Error('Pierre viewer frame did not settle');
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

/** Opens a PR page and switches to the Pierre tab by clicking it (or with `#pierre`). */
export async function openPierre(page: Page, pr: PrId, how: 'click' | 'hash' = 'click'): Promise<Viewer> {
  if (how === 'hash') {
    await page.goto(prUrl(pr, '#pierre'), { waitUntil: 'domcontentloaded' });
  } else {
    await page.goto(prUrl(pr), { waitUntil: 'load' });
    const tab = page.locator('a[data-pierre-tab]');
    await expect(tab).toBeVisible({ timeout: 30_000 });
    // A click while GitHub is still hydrating its tab strip can be lost (the strip is re-rendered and the
    // tab re-injected), so click until the URL switches to #pierre.
    await expect(async () => {
      if (!page.url().endsWith('#pierre')) await tab.click({ timeout: 5_000 });
      expect(page.url()).toMatch(/#pierre$/);
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
