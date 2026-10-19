/**
 * GitHub's Refresh button for a pull request that was pushed to (state/freshness.ts) against a real push, in each
 * layout: today's, page scrolling, and page scrolling with the merged bar (tree on the right). WRITES to the sandbox
 * PR's branch (tests/sandbox.json): per layout, one commit adds a probe file through the GitHub API (`gh`, the
 * developer's own login), and a second commit deletes it afterwards, so the PR's diff ends up unchanged (two more
 * commits in its history). Read-only otherwise; like review.spec.ts, it writes only to the sandbox. The button must
 * appear within 20 s, which only GitHub's live channel achieves (the backup poll runs every 60 s), and be on screen and
 * on top: GitHub's page at the iframe's spot is the iframe, and the viewer at the button's spot is the button.
 */
import { execFileSync } from 'node:child_process';
import { expect, ON_SCREEN, openPierre, placement, SANDBOX, setExperiments, test, type Experiments } from './fixtures';

test.describe.configure({ mode: 'serial' });

const BRANCH = 'review-me';
const REFRESH = 'button[aria-label="Refresh"]';
const repo = `repos/${SANDBOX.owner}/${SANDBOX.repo}`;
const gh = (args: string[]) => JSON.parse(execFileSync('gh', ['api', ...args], { encoding: 'utf8' })) as Record<string, any>;

const LAYOUTS: { name: string; experiments: Experiments; tree: 'left' | 'right' }[] = [
  { name: 'default layout', experiments: null, tree: 'left' },
  { name: 'page scrolling', experiments: { pageScroll: true, mergedBar: false }, tree: 'left' },
  { name: 'page scrolling with the merged bar, tree on the right', experiments: { pageScroll: true, mergedBar: true }, tree: 'right' },
];

test.afterAll(async ({ extContext }) => setExperiments(extContext, null, undefined, 'left'));

for (const layout of LAYOUTS) {
  test(`${layout.name}: a push shows GitHub's Refresh button within seconds, on screen; Refresh shows the new commit`, async ({ page, extContext }) => {
    test.setTimeout(180_000);
    await setExperiments(extContext, layout.experiments, page, layout.tree);
    const viewer = await openPierre(page, SANDBOX);
    const headOid = () => viewer.frame().evaluate(() => window.__pierre!.store.getState().pr!.headOid);
    const before = await headOid();
    const refresh = viewer.locator.getByRole('button', { name: 'Refresh' });
    await expect(refresh).toHaveCount(0);

    const path = `freshness-probe-${Date.now()}.md`;
    const put = gh(['-X', 'PUT', `${repo}/contents/${path}`, '-f', 'message=test: freshness probe', '-f', `branch=${BRANCH}`,
      '-f', `content=${Buffer.from('Freshness probe, deleted by the next commit.\n').toString('base64')}`]);
    const pushedAt = Date.now();
    try {
      await expect(refresh).toBeVisible({ timeout: 20_000 });
      test.info().annotations.push({ type: 'refresh shown after', description: `${Date.now() - pushedAt} ms` });
      await expect(refresh).toHaveText('Refresh');
      expect(await placement(page, viewer, REFRESH), 'at the top of the page').toEqual(ON_SCREEN);
      if (layout.experiments) {
        await page.mouse.wheel(0, 3000);
        await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(1000);
        expect(await placement(page, viewer, REFRESH), 'scrolled down').toEqual(ON_SCREEN);
      }
      expect(await headOid()).toBe(before);

      await refresh.click();
      await expect(refresh).toHaveCount(0, { timeout: 30_000 });
      await expect.poll(headOid, { timeout: 30_000 }).toBe(put.commit.sha);
      const listed = () => viewer.frame().evaluate((p) => window.__pierre!.store.getState().files.has(p), path);
      await expect.poll(listed, { timeout: 30_000 }).toBe(true);
    } finally {
      gh(['-X', 'DELETE', `${repo}/contents/${path}`, '-f', 'message=test: remove freshness probe', '-f', `branch=${BRANCH}`,
        '-f', `sha=${put.content.sha}`]);
    }
  });
}
