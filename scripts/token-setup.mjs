#!/usr/bin/env node
/**
 * One-time human step for the write e2e tests (`npm run e2e:token`): opens the e2e browser (the same Playwright
 * persistent context as tests/e2e/fixtures.ts: .e2e-profile + dist/) HEADED on DISPLAY (default :0), on the
 * sandbox PR's Pierre tab, opens Pierre's TokenPrompt (no write: a no-op token-gated action), and waits until a token is saved in the extension's
 * chrome.storage.local (key `pierre.tokens`) or 10 minutes pass.
 *
 * The token is typed by the human into Pierre's own prompt. This script never reads, prints or stores it: it
 * only checks whether the storage KEY exists (`chrome.storage.local.getKeys()`), never its value.
 * It persists across e2e runs because scripts/e2e-profile.sh keeps .e2e-profile's extension storage.
 */
import { chromium } from '@playwright/test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROFILE = join(ROOT, '.e2e-profile');
const DIST = join(ROOT, 'dist');
const SANDBOX = JSON.parse(readFileSync(join(ROOT, 'tests/sandbox.json'), 'utf8'));
const URL = `https://github.com/${SANDBOX.owner}/${SANDBOX.repo}/pull/${SANDBOX.number}#glide`;
const KEY = 'pierre.tokens';
const TIMEOUT_MS = 10 * 60_000;

function chromePath() {
  if (process.env.PIERRE_E2E_CHROME) return process.env.PIERRE_E2E_CHROME;
  const dir = join(homedir(), '.agent-browser/browsers');
  const versions = existsSync(dir) ? readdirSync(dir).filter((d) => /^chrome-\d/.test(d)) : [];
  const num = (d) => d.replace('chrome-', '').split('.').map(Number);
  versions.sort((a, b) => {
    const [x, y] = [num(a), num(b)];
    for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
    return 0;
  });
  const newest = versions.at(-1);
  if (!newest) throw new Error('No Chrome for Testing found; set PIERRE_E2E_CHROME');
  return join(dir, newest, 'chrome');
}

/**
 * Opens Pierre's token prompt WITHOUT any GitHub write: a no-op action through the e2e inspection hook
 * (`window.__pierre.review.withApi`), which asks for a token when none is stored. Not awaited (it settles when the
 * prompt is saved or cancelled).
 */
async function openPrompt(frame) {
  await frame.evaluate(() => {
    void window.__pierre.review.withApi('set up the e2e tests', async () => undefined).catch(() => undefined);
  });
}

const viewerFrame = (page) => page.frames().find((f) => f.url().startsWith('chrome-extension://') && f.url().includes('/viewer.html'));

/** Whether the token key exists (keys only; the value is never read). */
async function tokenStored(page) {
  const frame = viewerFrame(page);
  if (!frame) return false;
  try {
    return await frame.evaluate(async (key) => (await chrome.storage.local.getKeys()).includes(key), KEY);
  } catch {
    return false;
  }
}

async function main() {
  if (!existsSync(join(PROFILE, 'Default'))) throw new Error('No .e2e-profile: run scripts/e2e-profile.sh first');
  if (!existsSync(join(DIST, 'manifest.json'))) throw new Error('No dist/: run npm run build first');
  const context = await chromium.launchPersistentContext(PROFILE, {
    executablePath: chromePath(),
    headless: false,
    env: { ...process.env, DISPLAY: process.env.DISPLAY || ':0', WAYLAND_DISPLAY: '' },
    args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
    viewport: { width: 1400, height: 900 },
  });
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(URL, { waitUntil: 'domcontentloaded' });
    const deadline = Date.now() + TIMEOUT_MS;
    while (!viewerFrame(page) && Date.now() < deadline) await page.waitForTimeout(500);
    const frame = viewerFrame(page);
    if (!frame) throw new Error('Glide viewer did not open');
    await frame.waitForSelector('.fh', { timeout: 60_000 });

    if (await tokenStored(page)) {
      console.log('token-setup: a token is already stored; nothing to do.');
      return;
    }
    await openPrompt(frame);
    console.log('token-setup: paste a GitHub token into the "Connect Pierre to GitHub" prompt and press Save (waiting up to 10 minutes).');
    while (Date.now() < deadline) {
      if (await tokenStored(page)) {
        console.log('token-setup: token saved in the e2e profile.');
        return;
      }
      // The prompt was cancelled: open it again.
      const f = viewerFrame(page);
      if (f && (await f.locator('[role="dialog"]').count()) === 0) await openPrompt(f).catch(() => undefined);
      await page.waitForTimeout(1000);
    }
    console.error('token-setup: timed out after 10 minutes without a saved token.');
    process.exitCode = 1;
  } finally {
    await context.close();
  }
}

main().catch((err) => {
  console.error(`token-setup: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
