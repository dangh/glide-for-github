/**
 * End-to-end tests: the built extension (dist/) in a logged-in Chrome, against real GitHub pages.
 *
 * Login: `scripts/e2e-profile.sh` copies the agent-browser GitHub profile (~/.agent-browser/profiles/github,
 * user dangh) to `.e2e-profile/` (git-ignored). Cookies survive the copy (verified 2026-10-17 with Chrome
 * for Testing 155), and tests clone it again into a disposable profile before `launchPersistentContext`; no agent-browser
 * session is involved while the tests run.
 *
 * Run:
 *   agent-browser --session pierre-gh close   # the profile must not be in use while copying
 *   ./scripts/e2e-profile.sh
 *   npm run e2e                                # builds dist/, then runs tests/e2e HEADED on DISPLAY (default :0)
 *   npm run e2e:headless                       # same, headless (CI)
 *   npm run e2e:token                          # once: paste a GitHub token into Glide's prompt (write tests)
 * Env: PIERRE_E2E_CHROME (Chrome for Testing binary; default: newest ~/.agent-browser/browsers/chrome-*),
 *      PIERRE_SPIKE_PROFILE (optional signed-in source profile; always cloned),
 *      PIERRE_E2E_HEADLESS=1 (headless; the default is headed on $DISPLAY or :0, with WAYLAND_DISPLAY cleared).
 *
 * `npm run perf` runs tests/e2e/perf.spec.ts only (the performance budget on public PRs, read-only; see that file).
 *
 * viewer.spec.ts is read-only. review.spec.ts WRITES, only on the sandbox PR (tests/sandbox.json), with the token
 * saved in .e2e-profile's extension storage by `npm run e2e:token` (it skips when no token is stored); it removes
 * what it creates. Viewed-state checks rewrite GitHub's route response inside the test browser only.
 * freshness.spec.ts also WRITES to the sandbox PR's branch (with `gh`): it pushes a probe commit to check the "PR was
 * updated" banner, then a commit that deletes the probe again.
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  // perf.spec.ts (Task 12) is long-running: only with `npm run perf` (PIERRE_PERF=1).
  testIgnore: process.env.PIERRE_PERF === '1' ? [] : ['**/perf.spec.ts'],
  timeout: 180_000,
  expect: { timeout: 30_000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  outputDir: 'test-results',
  use: { actionTimeout: 30_000, screenshot: 'only-on-failure' },
});
