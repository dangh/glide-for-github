import { test as base, chromium, expect, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { rm } from 'node:fs/promises';
import { evaluateInpage, waitForInpage, VIEWER_HOST } from '../../scripts/inpage-driver.mjs';
import { chromePath, cloneProfile, DIST, extensionId, prUrl, type PrId } from './browser-fixtures';

export const test = base.extend<{ glideContext: BrowserContext }>({
  glideContext: async ({}, use) => {
    const profile = await cloneProfile();
    let context: BrowserContext | undefined;
    try {
      context = await chromium.launchPersistentContext(profile, {
        executablePath: chromePath(), headless: true,
        args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`], viewport: { width: 1280, height: 800 },
      });
      const options = await context.newPage();
      await options.goto(`chrome-extension://${extensionId()}/options.html`);
      await options.evaluate(async () => {
        const old = (await chrome.storage.sync.get('pierre.settings'))['pierre.settings'];
        const settings = typeof old === 'object' && old !== null ? old : {};
        const diff = 'diff' in settings && typeof settings.diff === 'object' && settings.diff !== null ? settings.diff : {};
        await chrome.storage.sync.set({ 'pierre.settings': { ...settings, diff: { ...diff, diffStyle: 'split' }, experiments: { mergedBar: true } } });
      });
      await options.close();
      await use(context);
    } finally {
      await context?.close();
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

/** Wait for the packaged in-page viewer and the content script's loader. */
export async function waitForViewer(page: Page) {
  await waitForInpage(page);
}

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

/** Current in-page viewer, re-found after navigation or a GitHub layout replacement. */
export class Viewer {
  readonly locator: Locator;

  constructor(readonly page: Page) {
    this.locator = page.locator(VIEWER_HOST);
  }

  evaluate<R, Arg = undefined>(fn: (arg: Arg, viewerRoot: ShadowRoot) => R | Promise<R>, arg?: Arg): Promise<R> {
    return evaluateInpage(this.page, fn, arg);
  }

  async ready(timeout = 60_000) {
    await waitForInpage(this.page, timeout);
  }

  order(): Promise<string[]> {
    return this.evaluate(() => window.__pierre!.store.getState().order);
  }

  loads(): Promise<Record<string, FileLoad>> {
    return this.evaluate(() => Object.fromEntries(window.__pierre!.store.getState().load));
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
    await this.evaluate((p) => window.__pierre!.session.scrollToFile?.(p), path);
  }

  item(path: string): Promise<ItemInfo | null> {
    return this.evaluate((p, viewerRoot) => {
      const header = [...viewerRoot.querySelectorAll<HTMLElement>('.fh')].find((e) => e.dataset.path === p);
      if (!header) return null;
      const root = header.closest('diffs-container')?.shadowRoot;
      return {
        header: header.innerText.replace(/\s+/g, ' ').trim(),
        lines: root ? root.querySelectorAll('[data-line]').length : 0,
        diffType: root?.querySelector('[data-diff-type]')?.getAttribute('data-diff-type') ?? null,
        collapsed: window.__pierre!.session.codeView?.getItem(p)?.collapsed ?? null,
        top: header.getBoundingClientRect().top - viewerRoot.querySelector('.pierre-toolbar')!.getBoundingClientRect().bottom,
      };
    }, path);
  }

  /** Every file path in the tree (folders expanded by the caller), scrolling its virtualized list. */
  treeFiles(): Promise<string[]> {
    return this.evaluate(async (_, viewerRoot) => {
      const root = viewerRoot.querySelector('file-tree-container')?.shadowRoot;
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

/** The element must be visible and win hit testing through the viewer's shadow root. */
export async function placement(_page: Page, viewer: Viewer, selector: string) {
  return viewer.locator.locator(selector).evaluate(el => {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const root = el.getRootNode();
    if (!(root instanceof ShadowRoot)) throw new Error('Viewer element has no shadow root');
    const hit = root.elementFromPoint(x, y);
    return {
      inViewport: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth,
      onTopInViewer: !!hit && el.contains(hit),
      onTopInPage: document.elementFromPoint(x, y) === root.host,
    };
  });
}
export const ON_SCREEN = { inViewport: true, onTopInViewer: true, onTopInPage: true };

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
