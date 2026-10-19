/**
 * Shared e2e fixtures (see playwright.config.ts for setup): a worker-scoped persistent Chrome context on the
 * copied logged-in profile with dist/ loaded, and extension settings helpers.
 */
import { test as base, chromium, expect, type BrowserContext, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { cp, mkdtemp, rm, stat } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
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

/** Clone before launching: tests never mutate or remove the signed-in source profile. */
export async function cloneProfile(source = process.env.PIERRE_SPIKE_PROFILE ?? PROFILE) {
  if (!existsSync(join(source, 'Default'))) throw new Error('No signed-in profile: set PIERRE_SPIKE_PROFILE or run scripts/e2e-profile.sh');
  const profile = await mkdtemp(join(tmpdir(), 'glide-e2e-'));
  try {
    await cp(source, profile, { recursive: true, filter: path => !/Singleton|\/(Cache|Code Cache|GPUCache|Service Worker)(\/|$)/.test(path) });
    const originalDist = join(dirname(source), 'dist');
    const originalPath = existsSync(originalDist) ? realpathSync(originalDist) : originalDist;
    const sourceId = [...createHash('sha256').update(originalPath).digest('hex').slice(0, 32)]
      .map(c => String.fromCharCode(97 + parseInt(c, 16))).join('');
    const local = join(profile, 'Default', 'Local Extension Settings');
    if (sourceId !== extensionId() && await stat(join(local, sourceId)).then(() => true, () => false)) {
      await rm(join(local, extensionId()), { recursive: true, force: true });
      await cp(join(local, sourceId), join(local, extensionId()), { recursive: true });
    }
    return profile;
  } catch (error) {
    await rm(profile, { recursive: true, force: true });
    throw error;
  }
}

export const test = base.extend<{ page: Page }, { extContext: BrowserContext; screenScale: number }>({
  /** The browser's device pixel ratio (`test.use({ screenScale: 2 })` for a Retina screen). */
  screenScale: [1, { scope: 'worker', option: true }],
  extContext: [
    async ({ screenScale }, use) => {
      if (!existsSync(join(DIST, 'manifest.json'))) throw new Error('No dist/: run npm run build first');
      const profile = await cloneProfile();
      let context: BrowserContext | undefined;
      try {
        context = await chromium.launchPersistentContext(profile, {
          executablePath: chromePath(),
          headless: HEADLESS,
          env: { ...(process.env as Record<string, string>), ...browserEnv() },
          // Match the physical screen for zoom and border-pixel checks.
          args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, `--force-device-scale-factor=${screenScale}`],
          viewport: { width: 1400, height: 900 },
          deviceScaleFactor: screenScale,
        });
        await use(context);
      } finally {
        await context?.close();
        await rm(profile, { recursive: true, force: true });
      }
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

export type Experiments = { mergedBar: boolean } | null;

/**
 * Writes (or with null removes) the stored experiments, and the tree side when given, keeping every other stored
 * setting, then brings `back` to the front again (a background tab renders no frames, so it would not scroll).
 */
export async function setExperiments(context: BrowserContext, experiments: Experiments, back?: Page, treePosition?: 'left' | 'right') {
  const ext = await context.newPage();
  await ext.goto(`chrome-extension://${extensionId()}/options.html`);
  await ext.evaluate(
    async ({ value, side }) => {
      const stored = ((await chrome.storage.sync.get('pierre.settings'))['pierre.settings'] ?? {}) as Record<string, unknown>;
      if (value) stored.experiments = value;
      else delete stored.experiments;
      if (side) stored.layout = { ...(stored.layout as object | undefined), treePosition: side };
      await chrome.storage.sync.set({ 'pierre.settings': stored });
    },
    { value: experiments, side: treePosition },
  );
  await ext.close();
  await back?.bringToFront();
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
