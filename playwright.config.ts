/**
 * End-to-end tests: the built extension (dist/) in a logged-in Chrome, against real GitHub pages.
 *
 * Login: `scripts/e2e-profile.sh` copies the agent-browser GitHub profile (~/.agent-browser/profiles/github,
 * user dangh) to `.e2e-profile/` (git-ignored). Cookies survive the copy (verified 2026-10-17 with Chrome
 * for Testing 155), so the tests use Playwright's `launchPersistentContext` on that copy; no agent-browser
 * session is involved while the tests run.
 *
 * Run:
 *   agent-browser --session pierre-gh close   # the profile must not be in use while copying
 *   ./scripts/e2e-profile.sh
 *   npm run e2e                                # builds dist/, then runs tests/e2e
 * Env: PIERRE_E2E_CHROME (Chrome for Testing binary; default: newest ~/.agent-browser/browsers/chrome-*),
 *      PIERRE_E2E_HEADED=1 (show the browser; needs DISPLAY, e.g. DISPLAY=:0).
 *
 * The tests are read-only: they never post, mark viewed or change anything on GitHub. Viewed-state checks
 * rewrite GitHub's route response inside the test browser only.
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  timeout: 180_000,
  expect: { timeout: 30_000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  outputDir: 'test-results',
});
