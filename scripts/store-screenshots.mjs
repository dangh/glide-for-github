#!/usr/bin/env node
/**
 * Capture five Chrome Web Store screenshots (1280x800) from a public PR and the options page.
 * Requires a built dist/ and Node 24. Set PIERRE_SPIKE_PROFILE to the authorized signed-in profile;
 * the browser fixtures clone it into a disposable directory, including this build's extension credentials.
 * Run headless with PIERRE_E2E_HEADLESS=1 node scripts/store-screenshots.mjs [out-dir].
 * A comment draft is typed and cancelled, never submitted. Private visible text blocks capture.
 */
import { chromium } from '@playwright/test';
import { evaluateInpage, waitForInpage, VIEWER_HOST } from './inpage-driver.mjs';
import { browserEnv, chromePath, cloneProfile, DIST, HEADLESS } from '../tests/e2e/browser-fixtures.ts';
import { mkdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(process.argv[2] ?? join(root, 'store/screenshots'));
mkdirSync(out, { recursive: true });
const PR = 'https://github.com/react/react/pull/37778';

const HIDE_AVATARS = `
  img[src*="avatars.githubusercontent.com"], img.avatar, img[data-testid="github-avatar"], .avatar, .AppHeader-user img,
  [data-testid="github-avatar"], img[alt^="@"], [class*="Avatar"] img, [data-component="Avatar"] { visibility: hidden !important; }
  .fh img, .thread img, .composer img { visibility: hidden !important; }
`;

const profile = await cloneProfile();
let context;
try {
  context = await chromium.launchPersistentContext(profile, {
    executablePath: chromePath(),
    headless: HEADLESS,
    env: { ...process.env, ...browserEnv() },
    args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, '--disable-sync'],
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  /** Hides avatars in every open shadow tree and refuses visible login or token text. */
  async function sanitize(target, login) {
    const all = await target.evaluate(css => {
      const texts = [];
      const scan = root => {
        const style = document.createElement('style');
        style.textContent = css;
        (root instanceof Document ? root.head : root).append(style);
        const container = root instanceof Document ? root.body : root;
        for (const el of container.querySelectorAll('*')) {
          if (el.shadowRoot) scan(el.shadowRoot);
          const rect = el.getBoundingClientRect();
          if (el instanceof HTMLElement && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden') {
            if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) texts.push(el.value);
            for (const child of el.childNodes) if (child.nodeType === Node.TEXT_NODE) texts.push(child.textContent ?? '');
          }
        }
      };
      scan(document);
      return texts.join('\n');
    }, HIDE_AVATARS);
    const deny = (process.env.STORE_SHOT_DENY ?? '').split(',').filter(Boolean).map(w => new RegExp(w, 'i'));
    const bad = [new RegExp('ghp' + '_[A-Za-z0-9]'), new RegExp('github' + '_pat_'), ...deny, login ? new RegExp(`\\b${login}\\b`, 'i') : null].filter(Boolean);
    for (const re of bad) if (re.test(all)) throw new Error('Refusing screenshot: private text is visible on the page');
  }

  const viewer = page.locator(VIEWER_HOST);
  const viewerReady = () => waitForInpage(page);

  /** The signed-in login, only to make sure it is not on screen; never printed or stored. */
  async function signedInLogin() {
    await page.goto('https://github.com/', { waitUntil: 'domcontentloaded' });
    return page.evaluate(() => document.querySelector('meta[name="user-login"]')?.getAttribute('content') ?? '');
  }

  const login = await signedInLogin();
  if (!login) throw new Error('not signed in on the e2e profile');

  await page.goto(`${PR}#glide`, { waitUntil: 'domcontentloaded' });
  await viewerReady();

  // Reset settings only in the disposable profile; local credentials stay available for GitHub reads.
  const id = await evaluateInpage(page, () => chrome.runtime.id);
  const options = await context.newPage();
  await options.goto(`chrome-extension://${id}/options.html`);
  const resetSync = () => options.evaluate(() => chrome.storage.sync.clear());

  const FILE = 'compiler/apps/playground/components/Header.tsx';
  const LINE = 113;
  const shot = async (name) => {
    await sanitize(page, login);
    await page.screenshot({ path: join(out, name) });
    console.log('wrote', name);
  };
  const openPr = async () => {
    await page.bringToFront();
    await page.goto(`${PR}#glide`, { waitUntil: 'domcontentloaded' });
    await page.reload({ waitUntil: 'domcontentloaded' });
    return viewerReady();
  };

  await resetSync();
  await openPr();

  // 1. The Glide tab: file group tabs, file tree (expanded) and diffs.
  await evaluateInpage(page, () => window.__pierre.settings.getState().update({ tree: { initialExpansion: 'open' }, layout: { treePosition: 'right' } }));
  await page.waitForTimeout(1500);
  await shot('1-glide-tab.png');

  // 2. A comment composer open on a line, with a draft typed in and NOT submitted.
  await evaluateInpage(page, (p) => window.__pierre.session.scrollToFile?.(p), FILE);
  const item = viewer.locator(`diffs-container:has(.fh[data-path="${FILE}"])`);
  const cell = item.locator(`[data-column-number="${LINE}"][data-line-type="change-addition"]`).first();
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
  await openPr();
  await viewer.getByRole('button', { name: /Display/ }).click();
  await page.waitForTimeout(600);
  await shot('3-display-menu.png');

  // 5. The Tests file group: the tree and the diffs show only the pull request's test files.
  await openPr();
  await viewer.getByRole('tablist', { name: 'File groups' }).getByRole('tab', { name: /^Tests/ }).click();
  await page.waitForTimeout(2000);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await page.mouse.move(640, 20);
  await shot('5-file-groups.png');

  // 4. Native sidebar navigation to Related files keeps saved token owners outside the viewport.
  await resetSync();
  await options.bringToFront();
  await options.reload();
  await options.getByRole('navigation', { name: 'Settings sections' })
    .getByRole('link', { name: 'Related files', exact: true }).click();
  await options.getByRole('region', { name: 'Related files' }).getByRole('radio', { name: /Nested/ }).waitFor();
  await options.waitForTimeout(800);
  await sanitize(options, login);
  await options.screenshot({ path: join(out, '4-options.png') });
  console.log('wrote 4-options.png');
} finally {
  try {
    await context?.close();
  } finally {
    await rm(profile, { recursive: true, force: true });
    console.log('removed disposable profile');
  }
}
