/**
 * "This pull request was updated" (state/freshness.ts) against a real push. WRITES to the sandbox PR's branch
 * (tests/sandbox.json): one commit adds a probe file through the GitHub API (`gh`, the developer's own login), and a
 * second commit deletes it afterwards, so the PR's diff ends up unchanged (two more commits in its history).
 * Read-only otherwise; like review.spec.ts, it writes only to the sandbox. Takes about a minute (the 60 s poll).
 */
import { execFileSync } from 'node:child_process';
import { expect, openPierre, SANDBOX, test } from './fixtures';

const BRANCH = 'review-me';
const repo = `repos/${SANDBOX.owner}/${SANDBOX.repo}`;
const gh = (args: string[]) => JSON.parse(execFileSync('gh', ['api', ...args], { encoding: 'utf8' })) as Record<string, any>;

test('a push while the Glide tab is open shows the banner; Reload shows the new commit', async ({ page }) => {
  test.setTimeout(240_000);
  const viewer = await openPierre(page, SANDBOX);
  await viewer.ready();
  const headOid = () => viewer.frame().evaluate(() => window.__pierre!.store.getState().pr!.headOid);
  const before = await headOid();

  const path = `freshness-probe-${Date.now()}.md`;
  const put = gh(['-X', 'PUT', `${repo}/contents/${path}`, '-f', 'message=test: freshness probe', '-f', `branch=${BRANCH}`,
    '-f', `content=${Buffer.from('Freshness probe, deleted by the next commit.\n').toString('base64')}`]);
  try {
    // The regular poll (every 60 s while visible) finds the push by itself.
    const banner = viewer.locator.getByRole('status').filter({ hasText: 'This pull request was updated.' });
    await expect(banner).toBeVisible({ timeout: 90_000 });
    expect(await headOid()).toBe(before);

    await banner.getByRole('button', { name: 'Reload' }).click();
    await expect(banner).toBeHidden({ timeout: 30_000 });
    await expect.poll(headOid, { timeout: 30_000 }).toBe(put.commit.sha);
    const listed = () => viewer.frame().evaluate((p) => window.__pierre!.store.getState().files.has(p), path);
    await expect.poll(listed, { timeout: 30_000 }).toBe(true);
  } finally {
    gh(['-X', 'DELETE', `${repo}/contents/${path}`, '-f', 'message=test: remove freshness probe', '-f', `branch=${BRANCH}`,
      '-f', `sha=${put.content.sha}`]);
  }
});
