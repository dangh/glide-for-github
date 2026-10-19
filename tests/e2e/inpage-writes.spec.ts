/** Real writes are restricted to an explicitly selected disposable branch in the dedicated sandbox. */
import { execFileSync } from 'node:child_process';
import { test, waitForViewer, expect, clickInDiff } from './inpage-fixtures';

const repository = 'dangh/pierre-sandbox';
const number = Number(process.env.PIERRE_WRITE_PR);
const file = 'src/util/math.ts';
const marker = `glide-adoption-${Date.now()}`;
const api = (path: string, ...args: string[]) => JSON.parse(execFileSync('gh', ['api', `repos/${repository}/${path}`, ...args], { encoding: 'utf8' }) || 'null');

test('real in-page comments, replies, edits, review submission/discard, Viewed and suggestion commit', async ({ glideContext }, info) => {
  test.setTimeout(600000);
  test.skip(!Number.isSafeInteger(number) || number < 2, 'Set PIERRE_WRITE_PR to a disposable sandbox PR');
  const pull = api(`pulls/${number}`);
  expect(pull.head.ref).toMatch(/^test\/inpage-adoption-/);
  expect(pull.state).toBe('open');
  const initialReviews = api(`pulls/${number}/reviews`);
  expect(initialReviews.filter((review: { state: string }) => review.state === 'PENDING'), 'Use a fresh disposable PR without a pending review').toEqual([]);
  const initialReviewIds = new Set(initialReviews.map((review: { id: number }) => review.id));
  const page = await glideContext.newPage();
  await page.goto(`https://github.com/${repository}/pull/${number}/files#glide`);
  await waitForViewer(page);
  const host = page.locator('#glide-inpage-spike');
  await expect(host.locator('.fh').first()).toBeVisible();
  const worker = page.frames().find(frame => frame.url().includes('/worker-host.html'))!;
  expect(await worker.evaluate(async () => Object.keys((await chrome.storage.local.get('pierre.tokens'))['pierre.tokens'] ?? {}).length > 0), 'Test profile must have a stored token; its value stays inside the disposable profile').toBe(true);
  const tree = host.locator('file-tree-container');
  const item = host.locator('diffs-container').filter({ has: page.locator(`.fh[data-path="${file}"]`) });
  const jump = async () => {
    await tree.getByPlaceholder('Search…').fill('math.ts');
    await tree.locator(`[data-item-path="${file}"]`).click();
    await expect(item.locator('.fh')).toBeInViewport();
  };
  await jump();
  const thread = (body: string) => item.locator('.thread').filter({ hasText: body });
  const comments = () => api(`pulls/${number}/comments`);
  const reviews = () => api(`pulls/${number}/reviews`);
  const resolvedOnGithub = (body: string) => {
    const query = `query { repository(owner: "dangh", name: "pierre-sandbox") { pullRequest(number: ${number}) { reviewThreads(first: 100) { nodes { isResolved comments(first: 20) { nodes { body } } } } } } }`;
    const result = JSON.parse(execFileSync('gh', ['api', 'graphql', '-f', `query=${query}`], { encoding: 'utf8' }));
    return result.data.repository.pullRequest.reviewThreads.nodes.find((t: { comments: { nodes: { body: string }[] } }) => t.comments.nodes.some(c => c.body === body))?.isResolved;
  };
  const viewedOnGithub = () => {
    const query = `query { repository(owner: "dangh", name: "pierre-sandbox") { pullRequest(number: ${number}) { files(first: 100) { nodes { path viewerViewedState } } } } }`;
    const result = JSON.parse(execFileSync('gh', ['api', 'graphql', '-f', `query=${query}`], { encoding: 'utf8' }));
    return result.data.repository.pullRequest.files.nodes.find((item: { path: string }) => item.path === file)?.viewerViewedState;
  };
  const post = async (body: string, action = 'Add single comment', line?: number) => {
    await jump();
    if (line === undefined) await clickInDiff(item.getByRole('button', { name: 'Comment on file' }));
    else {
      const cell = item.locator(`code[data-additions] [data-column-number="${line}"]`);
      await expect(async () => {
        await jump();
        await cell.hover({ timeout: 2000 });
      }).toPass({ timeout: 30000 });
      await item.locator('[data-utility-button]').click();
    }
    const composer = item.locator('.composer');
    await composer.locator('textarea').fill(body);
    await clickInDiff(composer.getByRole('button', { name: action, exact: true }));
    await expect(composer).toHaveCount(0);
  };
  const summary = host.locator('.review-menu textarea');
  const menu = host.locator('.review-panel');
  try {
    await test.step('post, reply, edit, resolve/unresolve and delete through the UI', async () => {
      const body = `${marker} file comment`;
      await post(body);
      await expect.poll(() => comments().some((c: { body: string }) => c.body === body)).toBe(true);
      await clickInDiff(thread(body).getByRole('button', { name: 'Reply…', exact: true }));
      await thread(body).getByRole('textbox', { name: 'Reply', exact: true }).fill(`${marker} reply`);
      await clickInDiff(thread(body).getByRole('button', { name: 'Reply', exact: true }));
      await expect.poll(() => comments().some((c: { body: string }) => c.body === `${marker} reply`)).toBe(true);
      const reply = item.locator('.comment').filter({ hasText: `${marker} reply` });
      await clickInDiff(reply.getByRole('button', { name: 'Edit', exact: true }));
      await reply.getByRole('textbox', { name: 'Edit comment' }).fill(`${marker} edited`);
      await clickInDiff(reply.getByRole('button', { name: 'Update comment' }));
      await expect.poll(() => comments().some((c: { body: string }) => c.body === `${marker} edited`)).toBe(true);
      await clickInDiff(thread(body).getByRole('button', { name: 'Resolve conversation', exact: true }));
      await expect(item.locator('.label-resolved')).toBeVisible();
      await expect.poll(() => resolvedOnGithub(body)).toBe(true);
      await page.reload(); await waitForViewer(page); await jump();
      const resolved = item.locator('.thread').filter({ has: page.locator('.label-resolved') });
      await expect(resolved).toHaveCount(1);
      await clickInDiff(resolved.locator('.thread-fold'));
      await clickInDiff(thread(body).getByRole('button', { name: 'Unresolve conversation', exact: true }));
      await expect(thread(body).locator('.label-resolved')).toHaveCount(0);
      await expect.poll(() => resolvedOnGithub(body)).toBe(false);
      const edited = item.locator('.comment').filter({ hasText: `${marker} edited` });
      await clickInDiff(edited.getByRole('button', { name: 'Delete', exact: true }));
      await clickInDiff(edited.locator('.comment-confirm').getByRole('button', { name: 'Delete', exact: true }));
      await expect.poll(() => comments().some((c: { body: string }) => c.body === `${marker} edited`)).toBe(false);
    });
    await test.step('start and submit a Comment review, then discard another pending review', async () => {
      await post(`${marker} pending`, 'Start a review');
      await host.getByTestId('review-button').click();
      await summary.fill(`${marker} submitted review`);
      await menu.getByRole('button', { name: 'Submit review', exact: true }).click();
      await expect(menu).toHaveCount(0);
      await expect.poll(() => reviews().some((r: { body: string; state: string }) => r.body === `${marker} submitted review` && r.state === 'COMMENTED')).toBe(true);
      await post(`${marker} discarded`, 'Start a review');
      await host.getByTestId('review-button').click();
      await menu.getByRole('button', { name: 'Discard pending review' }).click();
      await menu.getByRole('button', { name: 'Discard review', exact: true }).click();
      await expect(menu.getByRole('button', { name: 'Discard pending review' })).toHaveCount(0);
      await expect.poll(() => reviews().some((r: { state: string }) => r.state === 'PENDING')).toBe(false);
      await page.keyboard.press('Escape');
    });
    await test.step('Viewed survives reload in both directions', async () => {
      await jump();
      const viewed = item.locator('.fh-viewed input');
      await viewed.check();
      await expect.poll(viewedOnGithub).toBe('VIEWED');
      await page.reload(); await waitForViewer(page); await jump();
      await expect(viewed).toBeChecked();
      await viewed.uncheck();
      await expect.poll(viewedOnGithub).toBe('UNVIEWED');
      await page.reload(); await waitForViewer(page); await jump();
      await expect(viewed).not.toBeChecked();
    });
    await test.step('commit a suggestion and verify its new commit and file contents', async () => {
      const replacement = `  return Math.min(hi, Math.max(lo, v)); // ${marker}`;
      const body = `${marker} suggestion\n\`\`\`suggestion\n${replacement}\n\`\`\``;
      await post(body, 'Add single comment', 13);
      await clickInDiff(thread(`${marker} suggestion`).getByRole('button', { name: 'Commit suggestion', exact: true }));
      const dialog = host.locator('.commit-dialog');
      const title = dialog.locator('input[name="commit-message"]');
      await expect(title).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      expect(await dialog.evaluate(el => el.contains(el.getRootNode() instanceof ShadowRoot ? (el.getRootNode() as ShadowRoot).activeElement : document.activeElement)), 'Shift+Tab stays inside the modal').toBe(true);
      await title.focus();
      for (let i = 0; i < 6; i++) {
        await page.keyboard.press('Tab');
        expect(await dialog.evaluate(el => el.contains(el.getRootNode() instanceof ShadowRoot ? (el.getRootNode() as ShadowRoot).activeElement : document.activeElement)), 'Tab stays inside the modal').toBe(true);
      }
      await page.screenshot({ path: info.outputPath('commit-dialog.png') });
      await title.fill(`${marker} commit`);
      let release!: () => void;
      const held = new Promise<void>(resolve => { release = resolve; });
      await page.route(`https://github.com/${repository}/pull/${number}/page_data/apply_review_suggestions`, async route => {
        await held;
        await route.continue();
      });
      try {
        await dialog.getByRole('button', { name: 'Commit changes' }).click();
        await expect(title).toBeFocused();
        await expect(dialog.getByRole('button', { name: 'Committing…' })).toBeDisabled();
        for (let i = 0; i < 4; i++) {
          await page.keyboard.press('Tab');
          expect(await dialog.evaluate(el => el.contains((el.getRootNode() as ShadowRoot).activeElement)), 'Focus stays in the busy dialog').toBe(true);
        }
      } finally { release(); }
      await expect(dialog).toHaveCount(0, { timeout: 60000 });
      await expect.poll(() => api(`pulls/${number}`).head.sha).not.toBe(pull.head.sha);
      const head = api(`pulls/${number}`).head.sha;
      expect(api(`commits/${head}`).commit.message.split('\n')[0]).toBe(`${marker} commit`);
      const content = api(`contents/${file}?ref=${head}`);
      expect(Buffer.from(content.content, 'base64').toString('utf8').split('\n')[12]).toBe(replacement);
    });
    await page.screenshot({ path: info.outputPath('writes-complete.png') });
  } finally {
    await page.screenshot({ path: info.outputPath('final-state.png') }).catch(() => undefined);
    for (const review of reviews()) {
      if (review.state !== 'PENDING' || initialReviewIds.has(review.id)) continue;
      const draftComments = api(`pulls/${number}/reviews/${review.id}/comments`);
      if (draftComments.length > 0 && draftComments.every((comment: { body: string }) => comment.body.startsWith(marker))) {
        api(`pulls/${number}/reviews/${review.id}`, '-X', 'DELETE');
      }
    }
    for (const comment of comments()) if (typeof comment.body === 'string' && comment.body.startsWith(marker)) api(`pulls/comments/${comment.id}`, '-X', 'DELETE');
  }
});
