#!/usr/bin/env node
/**
 * Takes the Chrome Web Store screenshots (1280x800) into store/screenshots/, headed, from react/react#37778 (public)
 * and the options page. Needs `npm run build` (dist/) and the logged-in e2e profile (see playwright.config.ts), and a
 * display: `DISPLAY=:0 WAYLAND_DISPLAY= node scripts/store-screenshots.mjs [out-dir]`.
 *
 * Read-only on GitHub: it opens a comment composer and types into it but never submits. Avatars are hidden, and the
 * script refuses to write a screenshot if the signed-in login (read from the page header), a STORE_SHOT_DENY word or a token-looking string
 * appears in any visible text.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(process.argv[2] ?? join(root, 'store/screenshots'));
mkdirSync(out, { recursive: true });
const PR = 'https://github.com/react/react/pull/37778';
const CHROME_DIR = join(homedir(), '.agent-browser/browsers');
const num = (d) => d.replace('chrome-', '').split('.').map(Number);
const chromeBin =
  process.env.PIERRE_E2E_CHROME ??
  join(
    CHROME_DIR,
    readdirSync(CHROME_DIR)
      .filter((d) => /^chrome-\d/.test(d))
      .sort((a, b) => {
        const [x, y] = [num(a), num(b)];
        for (let i = 0; i < 4; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
        return 0;
      })
      .at(-1),
    'chrome',
  );

const HIDE_AVATARS = `
  img[src*="avatars.githubusercontent.com"], img.avatar, img[data-testid="github-avatar"], .avatar, .AppHeader-user img,
  [data-testid="github-avatar"], img[alt^="@"], [class*="Avatar"] img, [data-component="Avatar"] { visibility: hidden !important; }
  .fh img, .thread img, .composer img { visibility: hidden !important; }
`;

const context = await chromium.launchPersistentContext(join(root, '.e2e-profile'), {
  executablePath: chromeBin,
  headless: false,
  env: { ...process.env, DISPLAY: process.env.DISPLAY || ':0', WAYLAND_DISPLAY: '' },
  args: [`--disable-extensions-except=${join(root, 'dist')}`, `--load-extension=${join(root, 'dist')}`],
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
});
const page = await context.newPage();

const viewerFrame = () => page.frames().find((f) => f.url().startsWith('chrome-extension://') && f.url().includes('/viewer.html'));

/** Hides avatars and fails when a login-like or secret-looking string is visible anywhere on the page or viewer. */
async function sanitize(login) {
  for (const f of [page.mainFrame(), viewerFrame()].filter(Boolean)) {
    await f.addStyleTag({ content: HIDE_AVATARS }).catch(() => {});
  }
  const texts = await Promise.all([page.mainFrame(), viewerFrame()].filter(Boolean).map((f) => f.evaluate(() => document.body.innerText).catch(() => '')));
  const all = texts.join('\n');
  // Extra case-insensitive words that must not appear (comma-separated, e.g. an employer's name): STORE_SHOT_DENY.
  const deny = (process.env.STORE_SHOT_DENY ?? '').split(',').filter(Boolean).map((w) => new RegExp(w, 'i'));
  const bad = [new RegExp('ghp' + '_[A-Za-z0-9]'), new RegExp('github' + '_pat_'), ...deny, login ? new RegExp(`\\b${login}\\b`, 'i') : null].filter(Boolean);
  for (const re of bad) if (re.test(all)) throw new Error(`refusing to screenshot: ${re} is visible on the page`);
}

const viewer = page.frameLocator('iframe[data-pierre-viewer]');

/** GitHub re-renders its layout once during load, remounting the iframe: wait until one frame has the PR and stays. */
async function viewerReady() {
  await page.waitForLoadState('load');
  for (let i = 0; i < 6; i++) {
    await viewer.locator('.fh').first().waitFor({ timeout: 60_000 });
    const f = viewerFrame();
    if (!f) continue;
    const ready = await f.evaluate(() => window.__pierre?.store.getState().pr !== null).catch(() => false);
    await page.waitForTimeout(1500);
    if (ready && viewerFrame() === f && !f.isDetached()) return f;
  }
  throw new Error('viewer did not settle');
}

/** The signed-in login, only to make sure it is not on screen; never printed or stored. */
async function signedInLogin() {
  await page.goto('https://github.com/', { waitUntil: 'domcontentloaded' });
  return page.evaluate(() => document.querySelector('meta[name="user-login"]')?.getAttribute('content') ?? '');
}

const login = await signedInLogin();
if (!login) throw new Error('not signed in on the e2e profile');

await page.goto(`${PR}#glide`, { waitUntil: 'domcontentloaded' });
let frame = await viewerReady();
await frame.evaluate(() =>
  window.__pierre.settings.getState().update({ diff: { diffStyle: 'split' }, tree: { initialExpansion: 'closed' }, review: { hideWhitespace: false } }),
);
await page.waitForTimeout(1500);
frame = viewerFrame();
const FILE = 'compiler/apps/playground/components/Header.tsx';
const LINE = 113;
const shot = async (name) => {
  await sanitize(login);
  await page.screenshot({ path: join(out, name) });
  console.log('wrote', name);
};

// 1. The Glide tab: file tree (expanded) and diffs.
await frame.evaluate(() => window.__pierre.settings.getState().update({ tree: { initialExpansion: 'open' } }));
await page.waitForTimeout(1500);
await shot('1-glide-tab.png');

// 2. A comment composer open on a line, with a draft typed in and NOT submitted.
await frame.evaluate((p) => window.__pierre.session.scrollToFile?.(p), FILE);
const item = viewer.locator(`diffs-container:has(.fh[data-path="${FILE}"])`);
const cell = item.locator(`code[data-additions] [data-column-number="${LINE}"]`);
await cell.scrollIntoViewIfNeeded();
await page.waitForTimeout(800);
for (let i = 0; i < 10; i++) {
  try {
    await cell.hover({ timeout: 2_000 });
    await item.locator('[data-utility-button]').click({ timeout: 2_000 });
    break;
  } catch (e) {
    if (i === 9) throw e;
    await page.waitForTimeout(500);
  }
}
const box = viewer.locator('.composer textarea').first();
await box.waitFor({ timeout: 15_000 });
await box.fill('Nice cleanup. Should the old facebook/react URL keep redirecting here?');
await page.mouse.move(640, 20); // park the pointer outside the diff so no hover chrome is drawn
await page.waitForTimeout(500);
await shot('2-inline-thread.png');
// Cancel discards the draft: nothing was posted.
await viewer.locator('.composer').getByRole('button', { name: 'Cancel' }).click();
await viewer.locator('.composer').waitFor({ state: 'detached' });

// 3. The Display menu.
await page.goto(`${PR}#glide`, { waitUntil: 'domcontentloaded' });
await page.reload({ waitUntil: 'domcontentloaded' });
frame = await viewerReady();
await viewer.getByRole('button', { name: /Display/ }).click();
await page.waitForTimeout(600);
await shot('3-display-menu.png');

// 4. The options page. The saved-token list is hidden: it names the owners the profile holds tokens for.
const id = new URL(viewerFrame().url()).host;
const options = await context.newPage();
await options.setViewportSize({ width: 1280, height: 800 });
await options.goto(`chrome-extension://${id}/options.html`);
await options.getByRole('heading', { name: 'GitHub tokens' }).waitFor();
await options.evaluate(() => {
  const heading = [...document.querySelectorAll('h2')].find((h) => h.textContent.includes('GitHub tokens'));
  heading?.closest('section')?.remove();
});
await options.waitForTimeout(800);
await options.screenshot({ path: join(out, '4-options.png') });
console.log('wrote 4-options.png');

await context.close();
