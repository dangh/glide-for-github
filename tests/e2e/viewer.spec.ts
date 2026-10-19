/**
 * Viewer e2e (Task 7), read-only, on the private sandbox PR (tests/sandbox.json) and react/react#37778.
 * Setup and run instructions: playwright.config.ts.
 */
import { expect, githubViewedCount, openPierre, prUrl, REACT, SANDBOX, test, Viewer } from './fixtures';

test.describe.configure({ mode: 'serial' });

const BINARY = 'assets/added.png';
const TOO_LARGE = 'generated/big.generated.ts';
const PURE_RENAME = 'src/legacy/renamed-pure.ts';
const CHANGED_RENAME = 'src/modern/helper-renamed.ts';
const DELETED = 'src/obsolete.ts';
/** Pierre's `data-diff-type` for the unified layout. */
const UNIFIED = 'single';

/** Back to the defaults (GitHub's look): removes every stored display override; open viewers follow the change. */
async function resetSettings(viewer: Viewer) {
  await viewer.evaluate(() => chrome.storage.sync.remove('pierre.settings'));
  await expect
    .poll(() => viewer.evaluate(() => window.__pierre!.settings.getState().settings.diff.diffStyle))
    .toBe('default');
}

/** Text of every rendered diff item (their shadow roots), joined. */
const diffText = (viewer: Viewer) =>
  viewer.evaluate((_, viewerRoot) => [...viewerRoot.querySelectorAll('diffs-container')].map((c) => c.shadowRoot?.textContent ?? '').join('\n'));

/**
 * The first "N unmodified lines" expander row of a file: its gap size and a click on its expand button (not "Expand
 * all"). Pierre renders each separator in the gutter and the code column; the gutter copy holds the visible button.
 * The click is a real mouse click at the button (moved off the sticky file header first), because Playwright's
 * actionability checks mistake Pierre's layered rows for an overlay.
 */
async function expander(viewer: Viewer, path: string) {
  const find = () =>
    viewer.evaluate((p, viewerRoot) => {
      const header = [...viewerRoot.querySelectorAll<HTMLElement>('.fh')].find((e) => e.dataset.path === p);
      const root = header?.closest('diffs-container')?.shadowRoot;
      const row = [...(root?.querySelectorAll('[data-gutter] > [data-separator="line-info-basic"]') ?? [])].find((r) => /\d+ unmodified line/.test(r.textContent ?? ''));
      const button = row?.querySelector('[data-expand-button]:not([data-expand-all-button])');
      if (!row || !button) return null;
      const r = button.getBoundingClientRect();
      return { gap: Number(/(\d+) unmodified/.exec(row.textContent!)![1]), x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, path);
  await viewer.page.evaluate(() => window.scrollBy(0, -120));
  await expect.poll(async () => (await find()) !== null, { timeout: 15_000 }).toBe(true);
  const found = (await find())!;
  return {
    gap: found.gap,
    click: async () => {
      // Pierre's interaction layer acts on a pointer that has moved onto the row first (as a user's would).
      await viewer.page.mouse.move(found.x, found.y);
      await viewer.page.waitForTimeout(300);
      await viewer.page.mouse.down();
      await viewer.page.mouse.up();
    },
  };
}

/** The tree's visible git status lane: number of rows that show one, and the letters shown. */
const gitLane = (viewer: Viewer) =>
  viewer.evaluate((_, viewerRoot) => {
    const root = viewerRoot.querySelector('file-tree-container')?.shadowRoot;
    const lanes = [...(root?.querySelectorAll<HTMLElement>('[data-item-section="git"]') ?? [])].filter((l) => getComputedStyle(l).display !== 'none');
    return { rows: lanes.length, letters: lanes.map((l) => l.textContent?.trim() ?? '').filter((t) => /^[AMDR]$/.test(t)) };
  });

/** One row of screen pixels at viewer coordinates, as '#rrggbb', read from a real screenshot. */
async function pixelRow(viewer: Viewer, x: number, y: number, width: number): Promise<string[]> {
  const png = await viewer.page.screenshot({ clip: { x, y, width, height: 1 } });
  return viewer.evaluate(async (b64) => {
    const img = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))]));
    const g = new OffscreenCanvas(img.width, 1).getContext('2d')!;
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, img.width, 1).data;
    return Array.from({ length: img.width }, (_, i) => `#${[0, 1, 2].map((k) => d[i * 4 + k]!.toString(16).padStart(2, '0')).join('')}`);
  }, png.toString('base64'));
}

test.describe('sandbox PR', () => {
  test('Glide tab is visible right after Files changed', async ({ page }) => {
    await page.goto(prUrl(SANDBOX), { waitUntil: 'domcontentloaded' });
    const tab = page.locator('a[data-pierre-tab]');
    await expect(tab).toBeVisible({ timeout: 30_000 });
    await expect(tab).toHaveText(/Glide/);
    const previous = await tab.evaluate((el) => el.previousElementSibling?.textContent ?? '');
    expect(previous).toMatch(/Files changed/);
  });

  test('clicking it shows the tree with all files', async ({ page }) => {
    const viewer = await openPierre(page, SANDBOX, 'click');
    expect(page.url()).toMatch(/#glide$/);
    const order = await viewer.order();
    expect(order).toHaveLength(20);

    // Open every folder through the Display menu, then read every file row of the (virtualized) tree.
    await viewer.locator.getByTestId('display-menu').click();
    await viewer.locator.getByLabel('Folders start').selectOption('open');
    await page.keyboard.press('Escape');
    await expect.poll(() => viewer.treeFiles().then((f) => f.length), { timeout: 15_000 }).toBe(order.length);
    expect((await viewer.treeFiles()).sort()).toEqual([...order].sort());
    await resetSettings(viewer);
  });

  test('every sandbox file eventually renders a Pierre diff', async ({ page }) => {
    const viewer = await openPierre(page, SANDBOX, 'hash');
    await viewer.allFetched();
    for (const path of await viewer.order()) {
      await viewer.scrollToFile(path);
      await expect
        .poll(async () => {
          const [info, load] = await Promise.all([viewer.item(path), viewer.loads().then((l) => l[path]!)]);
          if (!info) return 'not rendered';
          if (load.status === 'binary') return info.header.includes('Binary file not shown') ? 'ok' : 'binary without placeholder';
          if (load.status === 'too-large') return info.header.includes('Load diff') ? 'ok' : 'too-large without button';
          if (load.status === 'loaded' && load.empty) return /renamed without changes|No changes/.test(info.header) ? 'ok' : 'empty without note';
          if (load.status === 'loaded') return info.lines > 0 ? 'ok' : 'no lines';
          return load.status;
        }, { message: path, timeout: 20_000 })
        .toBe('ok');
    }
  });

  test('renders placeholders: too large, binary, rename', async ({ page }) => {
    const viewer = await openPierre(page, SANDBOX, 'hash');
    await viewer.allFetched();

    await viewer.scrollToFile(BINARY);
    await expect(viewer.locator.locator(`.fh[data-path="${BINARY}"]`)).toContainText('Binary file not shown');

    await viewer.scrollToFile(PURE_RENAME);
    const pure = viewer.locator.locator(`.fh[data-path="${PURE_RENAME}"]`);
    await expect(pure.getByTestId('prev-path')).toHaveText(/\S/);
    await expect(pure).toContainText('→');
    await expect(pure).toContainText('File renamed without changes');

    await viewer.scrollToFile(CHANGED_RENAME);
    const changed = viewer.locator.locator(`.fh[data-path="${CHANGED_RENAME}"]`);
    await expect(changed.getByTestId('prev-path')).toHaveText(/\S/);
    await expect.poll(async () => (await viewer.item(CHANGED_RENAME))?.lines ?? 0).toBeGreaterThan(0);

    // Deleted files come back collapsed from GitHub and load lazily near the viewport.
    await viewer.scrollToFile(DELETED);
    await expect.poll(async () => (await viewer.item(DELETED))?.lines ?? 0, { timeout: 20_000 }).toBeGreaterThan(0);

    await viewer.scrollToFile(TOO_LARGE);
    const big = viewer.locator.locator(`.fh[data-path="${TOO_LARGE}"]`);
    await expect(big.getByTestId('load-diff')).toBeVisible();
    expect((await viewer.item(TOO_LARGE))!.lines).toBe(0);
    // GitHub returns no lines for this file (its own UI says "Diff is too big to render"), and the full files
    // (~644 KB each, 1.29 M chars combined) are over the viewer's 1 M-char cap: Pierre says so and links to GitHub.
    await big.getByTestId('load-diff').click();
    await expect(big.getByTestId('too-big')).toContainText('Diff is too big to render', { timeout: 30_000 });
    await expect(big.getByRole('link', { name: 'Open on GitHub' })).toHaveAttribute(
      'href',
      new RegExp(`^${prUrl(SANDBOX, '/changes')}#diff-[0-9a-f]{64}$`),
    );
    expect((await viewer.loads())[TOO_LARGE]).toMatchObject({ status: 'too-large', tooBig: true });
  });

  test('"Load diff" renders a too-large file when its full files fit', async ({ page }) => {
    // Serve small versions of the file's raw contents (inside this browser only) so the fallback diff runs.
    let headOid = '';
    await page.route(
      (url) => url.pathname.includes('/raw/') && url.pathname.endsWith(`/${TOO_LARGE}`),
      (route) => {
        const head = headOid !== '' && route.request().url().includes(`/raw/${headOid}/`);
        const lines = Array.from({ length: 200 }, (_, i) => `export const v${i} = ${i};`);
        if (!head) lines[100] = 'export const changed = true;';
        return route.fulfill({ status: 200, contentType: 'text/plain', body: lines.join('\n') + '\n' });
      },
    );
    const viewer = await openPierre(page, SANDBOX, 'hash');
    headOid = await viewer.evaluate(() => window.__pierre!.store.getState().pr!.headOid);
    await viewer.allFetched();
    await viewer.scrollToFile(TOO_LARGE);
    const big = viewer.locator.locator(`.fh[data-path="${TOO_LARGE}"]`);
    await big.getByTestId('load-diff').click();
    await expect.poll(async () => (await viewer.loads())[TOO_LARGE]!.status, { timeout: 30_000 }).toBe('loaded');
    await viewer.scrollToFile(TOO_LARGE);
    await expect.poll(async () => (await viewer.item(TOO_LARGE))?.lines ?? 0, { timeout: 20_000 }).toBeGreaterThan(0);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('Split/Unified toggle re-renders without reload and persists after reload', async ({ page }) => {
    const viewer = await openPierre(page, SANDBOX, 'hash');
    await resetSettings(viewer);
    await viewer.allFetched();
    const path = 'config/settings.json';
    await viewer.scrollToFile(path);
    // The default layout is GitHub's: unified.
    await expect.poll(async () => (await viewer.item(path))?.diffType).toBe(UNIFIED);
    await expect(viewer.locator.getByRole('button', { name: 'Unified', exact: true })).toHaveAttribute('aria-pressed', 'true');

    await viewer.evaluate(() => ((window as unknown as { __marker: number }).__marker = 42));
    await viewer.locator.getByRole('button', { name: 'Split', exact: true }).click();
    await expect.poll(async () => (await viewer.item(path))?.diffType).toBe('split');
    // Same document: no reload happened.
    expect(await viewer.evaluate(() => (window as unknown as { __marker?: number }).__marker)).toBe(42);

    await page.reload({ waitUntil: 'domcontentloaded' });
    const again = new Viewer(page);
    await again.ready();
    await expect(again.locator.getByRole('button', { name: 'Split', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await again.scrollToFile(path);
    await expect.poll(async () => (await again.item(path))?.diffType).toBe('split');
    await resetSettings(again);
  });

  test("default look is GitHub's: expandable rows without @@, status icons but no A/M/D letters, GitHub colors, fonts and file boxes", async ({ page }) => {
    const viewer = await openPierre(page, SANDBOX, 'hash');
    await resetSettings(viewer);
    await viewer.allFetched();
    const path = 'config/settings.json';
    await viewer.scrollToFile(path);
    await expect.poll(async () => (await viewer.item(path))?.lines ?? 0).toBeGreaterThan(0);

    // No "@@ -a,b +c,d @@" text: the hunk rows are GitHub-like slim expanders ("N unmodified lines")...
    expect(await diffText(viewer)).not.toMatch(/@@/);
    // ...and one click on an expander reveals that gap (6 lines here; at most expansionLineCount = 20 per click).
    const GAP = 'src/util/math.ts';
    await viewer.scrollToFile(GAP);
    await expect.poll(async () => (await viewer.item(GAP))?.lines ?? 0).toBeGreaterThan(0);
    const before = (await viewer.item(GAP))!.lines;
    const gapRow = await expander(viewer, GAP);
    await gapRow.click();
    await expect.poll(async () => (await viewer.item(GAP))!.lines - before, { timeout: 15_000 }).toBe(Math.min(gapRow.gap, 20));
    expect(await diffText(viewer)).not.toMatch(/@@/);
    // An explicit choice still shows @@ hunk headers (the check above is not vacuous).
    await viewer.evaluate(() => window.__pierre!.settings.getState().update({ diff: { hunkSeparators: 'metadata' } }));
    await expect.poll(() => diffText(viewer), { timeout: 15_000 }).toMatch(/@@ -\d+/);
    await viewer.evaluate(() => window.__pierre!.settings.getState().update({ diff: { hunkSeparators: 'default' } }));
    await expect.poll(() => diffText(viewer), { timeout: 15_000 }).not.toMatch(/@@/);

    // No git status lane (letters) in the tree by default; the option turns it on.
    expect(await gitLane(viewer)).toEqual({ rows: 0, letters: [] });
    await viewer.evaluate(() => window.__pierre!.settings.getState().update({ tree: { showGitStatus: true } }));
    await expect.poll(async () => (await gitLane(viewer)).letters.length, { timeout: 15_000 }).toBeGreaterThan(0);
    await viewer.evaluate(() => window.__pierre!.settings.getState().update({ tree: { showGitStatus: false } }));
    await expect.poll(async () => (await gitLane(viewer)).rows, { timeout: 15_000 }).toBe(0);

    // GitHub's colors and fonts, octicon tree icons, the file box header without a status letter.
    const look = await viewer.evaluate((_, viewerRoot) => {
      const root = [...viewerRoot.querySelectorAll('diffs-container')].map((c) => c.shadowRoot!).find((r) => r.querySelector('[data-line][data-line-type="change-addition"]'));
      const added = root?.querySelector('[data-line][data-line-type="change-addition"]');
      // Any CSS color (lab(), hex with alpha) as 8-bit RGBA, through a canvas.
      const ctx = document.createElement('canvas').getContext('2d')!;
      const rgba = (css: string) => {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = css;
        ctx.fillRect(0, 0, 1, 1);
        return [...ctx.getImageData(0, 0, 1, 1).data];
      };
      const tree = viewerRoot.querySelector('file-tree-container')!.shadowRoot!;
      return {
        added: added ? rgba(getComputedStyle(added).backgroundColor) : null,
        // GitHub's addition line color, light and dark (src/shared/github-defaults.ts).
        expected: [rgba('#dafbe1'), rgba('#2ea04326')],
        codeFont: added ? getComputedStyle(added).fontFamily : null,
        codeSize: added ? getComputedStyle(added).fontSize : null,
        uiFont: getComputedStyle(viewerRoot.querySelector('.pierre-toolbar')!).fontFamily,
        fileIcons: [...tree.querySelectorAll('[data-item-type="file"] use')].map((u) => u.getAttribute('href')).slice(0, 3),
        // GitHub's status icons: file-added in fgColor-success, file-diff in fgColor-muted.
        statusIcons: Object.fromEntries(
          [...tree.querySelectorAll<HTMLElement>('[data-item-git-status]')].map((r) => [
            r.dataset.itemGitStatus,
            rgba(getComputedStyle(r.querySelector('[data-item-section="icon"]')!).color),
          ]),
        ),
        statusColors: { added: [rgba('#1a7f37'), rgba('#3fb950')], modified: [rgba('#59636e'), rgba('#9198a1')] },
        badge: getComputedStyle(viewerRoot.querySelector('.fh-badge')!).display,
        header: (viewerRoot.host as HTMLElement).dataset.fileHeader,
      };
    });
    const close = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]!) <= 2);
    expect(look.added).not.toBeNull();
    expect(look.codeFont).toContain('ui-monospace');
    expect(look.codeSize).toBe('12px');
    expect(look.uiFont).toContain('-apple-system');
    expect(look.fileIcons.length).toBeGreaterThan(0);
    for (const href of look.fileIcons) expect(href).toBe('#glide-octicon-file');
    for (const status of ['added', 'modified'] as const) {
      const color = look.statusIcons[status];
      expect(color, status).toBeDefined();
      expect(look.statusColors[status].some((e) => close(color!, e)), `${status}: ${color}`).toBe(true);
    }
    expect(look.badge).toBe('none');
    expect(look.header).toBe('github');
    // The line background is GitHub's color (light or dark, whichever scheme applies), not a mix into the background.
    expect(look.expected.some((e) => close(look.added!, e)), `${look.added} vs ${JSON.stringify(look.expected)}`).toBe(true);
    await resetSettings(viewer);
  });

  test('a 24 px code font gets taller rows: no overlapping rows or files', async ({ page }) => {
    const viewer = await openPierre(page, SANDBOX, 'hash');
    await resetSettings(viewer);
    await viewer.allFetched();
    // 'scroll' is the path where CodeView estimates rows from itemMetrics instead of measuring them.
    await viewer.evaluate(() => window.__pierre!.settings.getState().update({ fonts: { codeFontSize: 24 }, diff: { overflow: 'scroll' } }));
    const path = 'src/util/math.ts';
    await viewer.scrollToFile(path);
    await expect.poll(async () => (await viewer.item(path))?.lines ?? 0, { timeout: 15_000 }).toBeGreaterThan(3);
    await page.waitForTimeout(500);
    const layout = await viewer.evaluate((_, viewerRoot) => {
      const items = [...viewerRoot.querySelectorAll('diffs-container')].map((c) => ({ c, r: c.getBoundingClientRect() })).sort((a, b) => a.r.top - b.r.top);
      const problems: string[] = [];
      for (let i = 1; i < items.length; i++) {
        if (items[i]!.r.top < items[i - 1]!.r.bottom - 0.5) problems.push(`file ${i} overlaps the one above`);
      }
      let rows = 0;
      let fontSize = '';
      for (const { c } of items) {
        for (const column of c.shadowRoot!.querySelectorAll('code')) {
          const lines = [...column.querySelectorAll<HTMLElement>('[data-line]')].map((l) => l.getBoundingClientRect());
          for (let i = 0; i < lines.length; i++) {
            rows++;
            if (lines[i]!.height < 24) problems.push(`row ${i} is ${lines[i]!.height}px tall`);
            if (i > 0 && lines[i]!.top < lines[i - 1]!.bottom - 0.5) problems.push(`row ${i} overlaps the row above`);
          }
        }
        const line = c.shadowRoot!.querySelector('[data-line]');
        if (line) fontSize = getComputedStyle(line).fontSize;
      }
      return { problems: problems.slice(0, 5), rows, fontSize };
    });
    expect(layout.fontSize).toBe('24px');
    expect(layout.rows).toBeGreaterThan(3);
    expect(layout.problems).toEqual([]);
    expect(await viewer.evaluate(() => getComputedStyle(document.querySelector('#glide-inpage-spike')!).getPropertyValue('--diffs-line-height').trim())).toBe('40px');
    await resetSettings(viewer);
  });

  test('the tree can sit on the right of the diffs', async ({ page }) => {
    const viewer = await openPierre(page, SANDBOX, 'hash');
    await resetSettings(viewer);
    const sides = () =>
      viewer.evaluate((_, viewerRoot) => ({
        tree: viewerRoot.querySelector('.pierre-tree-pane')!.getBoundingClientRect().x,
        main: viewerRoot.querySelector('.pierre-main')!.getBoundingClientRect().x,
      }));
    expect((await sides()).tree).toBeLessThan((await sides()).main);
    await viewer.locator.getByTestId('display-menu').click();
    await viewer.locator.locator('label.field', { hasText: 'Tree position' }).locator('select').selectOption('right');
    await expect.poll(async () => { const s = await sides(); return s.tree > s.main; }).toBe(true);
    // DOM order matches the screen (keyboard focus goes diffs first, then the tree).
    expect(
      await viewer.evaluate(
        (_, viewerRoot) => (viewerRoot.querySelector('.pierre-main')!.compareDocumentPosition(viewerRoot.querySelector('.pierre-tree-pane')!) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
      ),
    ).toBe(true);
    await page.keyboard.press('Escape');
    // The tree still works there: selecting a file scrolls its diff into view.
    const path = 'src/util/math.ts';
    await viewer.locator.locator('file-tree-container').getByPlaceholder('Search…').fill('math');
    await viewer.locator.locator(`file-tree-container [data-item-path="${path}"]`).click();
    await expect.poll(async () => (await viewer.item(path))?.top ?? Infinity, { timeout: 10_000 }).toBeLessThan(80);
    await resetSettings(viewer);
    await expect.poll(async () => { const s = await sides(); return s.tree < s.main; }).toBe(true);
  });

  test("a narrow toolbar drops controls like GitHub's and keeps its actions on screen", async ({ page }) => {
    const viewer = await openPierre(page, SANDBOX, 'hash');
    await resetSettings(viewer);
    const toolbar = () =>
      viewer.evaluate((_, viewerRoot) => {
        const shown = (s: string) => (viewerRoot.querySelector(s)?.getClientRects().length ?? 0) > 0;
        const review = viewerRoot.querySelector<HTMLElement>('[data-testid="review-button"]')!;
        const gear = viewerRoot.querySelector('[data-testid="display-menu"]')!.getBoundingClientRect();
        return {
          toggles: shown('.diff-toggle'),
          range: shown('[data-testid="range-picker"]'),
          viewed: shown('[data-testid="viewed-counter"]'),
          review: review.innerText,
          fits: gear.right <= document.documentElement.clientWidth,
        };
      });
    try {
      await expect.poll(toolbar).toEqual({ toggles: true, range: true, viewed: true, review: 'Submit review', fits: true });
      await page.setViewportSize({ width: 600, height: 900 });
      await expect.poll(toolbar).toEqual({ toggles: false, range: true, viewed: true, review: 'Review', fits: true });
      await page.setViewportSize({ width: 500, height: 900 });
      await expect.poll(toolbar).toEqual({ toggles: false, range: false, viewed: false, review: 'Review', fits: true });
    } finally {
      await page.setViewportSize({ width: 1400, height: 900 });
    }
  });

  test("the file tree button hides and shows the tree like GitHub's, and is remembered", async ({ page }) => {
    let viewer = await openPierre(page, SANDBOX, 'hash');
    await resetSettings(viewer);
    const toggle = () => viewer.locator.getByTestId('tree-toggle');
    const layout = () =>
      viewer.evaluate((_, viewerRoot) => ({
        treeShown: getComputedStyle(viewerRoot.querySelector('.pierre-tree-pane')!).display !== 'none',
        firstBoxX: viewerRoot.querySelector('diffs-container')!.getBoundingClientRect().x,
        toolbarX: viewerRoot.querySelector('.pierre-toolbar')!.getBoundingClientRect().x,
      }));
    /** Where the button sits in the toolbar, and whether its icon is mirrored. */
    const side = () =>
      viewer.evaluate((_, viewerRoot) => {
        const button = viewerRoot.querySelector('[data-testid="tree-toggle"]')!;
        const toolbar = viewerRoot.querySelector('.pierre-toolbar')!;
        const b = button.getBoundingClientRect();
        const t = toolbar.getBoundingClientRect();
        return {
          first: toolbar.firstElementChild === button,
          last: toolbar.lastElementChild === button,
          atLeft: Math.abs(b.left - t.left) <= 1,
          atRight: Math.abs(b.right - t.right) <= 1,
          icon: getComputedStyle(button.querySelector('svg')!).transform,
        };
      });
    await expect(toggle()).toHaveAttribute('aria-label', 'Collapse file tree');
    expect((await layout()).treeShown).toBe(true);
    // GitHub's place and orientation with the tree on the left.
    expect(await side()).toEqual({ first: true, last: false, atLeft: true, atRight: false, icon: 'none' });

    await toggle().click();
    await expect(toggle()).toHaveAttribute('aria-label', 'Expand file tree');
    await expect.poll(async () => (await layout()).treeShown).toBe(false);
    // Like GitHub with its tree collapsed, the file boxes start where the toolbar does.
    const collapsed = await layout();
    expect(Math.abs(collapsed.firstBoxX - collapsed.toolbarX)).toBeLessThanOrEqual(1);

    viewer = await openPierre(page, SANDBOX, 'hash');
    await expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    expect((await layout()).treeShown).toBe(false);

    await toggle().click();
    await expect.poll(async () => (await layout()).treeShown).toBe(true);

    // With the tree on the right, the button ends the toolbar and its icon points that way.
    await viewer.locator.getByTestId('display-menu').click();
    await viewer.locator.locator('label.field', { hasText: 'Tree position' }).locator('select').selectOption('right');
    await page.keyboard.press('Escape');
    await expect.poll(side).toEqual({ first: false, last: true, atLeft: false, atRight: true, icon: 'matrix(-1, 0, 0, 1, 0, 0)' });
    await toggle().click();
    await expect.poll(async () => (await layout()).treeShown).toBe(false);
    await toggle().click();
    await expect.poll(async () => (await layout()).treeShown).toBe(true);
    await resetSettings(viewer);
    await expect.poll(async () => (await side()).first).toBe(true);
  });

  test('clicking the GitHub page around the viewer closes the Display menu', async ({ page }) => {
    const viewer = await openPierre(page, SANDBOX, 'hash');
    const panel = viewer.locator.locator('.display-menu .popover-panel');
    await viewer.locator.getByTestId('display-menu').click();
    await expect(panel).toBeVisible();
    // Focus inside the menu (a select, a text field) keeps it open.
    await viewer.locator.locator('label.field', { hasText: 'Code font' }).first().locator('input').click();
    await expect(panel).toBeVisible();
    // A click on GitHub's page (outside the viewer): the PR title (plain text, no link).
    const title = page.locator('h1:visible').first();
    const box = (await title.boundingBox())!;
    const hostBox = (await viewer.locator.boundingBox())!;
    expect(box.y + box.height).toBeLessThan(hostBox.y);
    await page.mouse.click(box.x + 4, box.y + box.height / 2);
    await expect(panel).toBeHidden();
  });

  test('Hide whitespace refetches with w=1; the commit picker narrows the range', async ({ page }) => {
    const viewer = await openPierre(page, SANDBOX, 'hash');
    await viewer.allFetched();
    const WS = 'src/whitespace.ts';
    expect((await viewer.loads())[WS]).toMatchObject({ status: 'loaded', additions: 6, deletions: 6 });

    await viewer.locator.getByRole('button', { name: 'Hide whitespace' }).click();
    await expect.poll(async () => (await viewer.loads())[WS], { timeout: 30_000 }).toMatchObject({ status: 'loaded', empty: true, additions: 0 });
    await viewer.scrollToFile(WS);
    await expect(viewer.locator.locator(`.fh[data-path="${WS}"]`)).toContainText('No changes to show');
    await viewer.locator.getByRole('button', { name: 'Hide whitespace' }).click();
    await expect.poll(async () => (await viewer.loads())[WS], { timeout: 30_000 }).toMatchObject({ status: 'loaded', additions: 6 });

    // One commit: fewer files change, the rest show "No changes"; back to all commits restores them.
    await viewer.locator.getByTestId('range-picker').click();
    await viewer.locator.locator('.menu-item').nth(1).click(); // first commit
    await expect(viewer.locator.getByTestId('range-picker')).toHaveText(/1 commit: \w+/);
    await viewer.allFetched();
    const one = Object.values(await viewer.loads());
    expect(one.filter((l) => l.status === 'error')).toEqual([]);
    const unchanged = one.filter((l) => l.status === 'loaded' && l.empty).length;
    expect(unchanged).toBeGreaterThan(0);
    await viewer.locator.getByTestId('range-picker').click();
    await viewer.locator.getByRole('button', { name: /All commits/ }).click();
    await viewer.allFetched();
    expect(Object.values(await viewer.loads()).filter((l) => l.status === 'loaded' && l.empty).length).toBeLessThan(unchanged);
    await resetSettings(viewer);
  });

  test('selecting a tree item scrolls its diff into view', async ({ page }) => {
    const viewer = await openPierre(page, SANDBOX, 'hash');
    await viewer.allFetched();
    const path = 'src/util/math.ts';
    expect((await viewer.item(path))?.top ?? Infinity).toBeGreaterThan(600); // not on screen yet

    // Filter the tree, then click the file row.
    const search = viewer.locator.locator('file-tree-container').getByPlaceholder('Search…');
    await search.fill('math');
    await viewer.locator.locator(`file-tree-container [data-item-path="${path}"]`).click();
    await expect.poll(async () => (await viewer.item(path))?.top ?? Infinity, { timeout: 10_000 }).toBeLessThan(60);
  });

  test('viewed files are collapsed and the counter matches GitHub', async ({ page }) => {
    const github = await githubViewedCount(page, SANDBOX);
    let viewer = await openPierre(page, SANDBOX, 'hash');
    await expect.poll(() => viewer.viewedCounter()).toBe(`${github.viewed} / ${github.total} viewed`);

    // Without writing to GitHub: mark two files viewed in GitHub's route response, inside this browser only.
    const marked = ['config/settings.json', 'docs/guide.md'];
    await page.route(
      (url) => url.pathname === `/${SANDBOX.owner}/${SANDBOX.repo}/pull/${SANDBOX.number}/changes`,
      async (route) => {
        if (route.request().headers()['x-github-app-type'] !== 'dataRouter') return route.continue();
        const response = await route.fetch();
        const json = await response.json();
        for (const s of json.payload.pullRequestsChangesRoute.diffSummaries) if (marked.includes(s.path)) s.markedAsViewed = true;
        await route.fulfill({ response, json });
      },
    );
    await page.reload({ waitUntil: 'domcontentloaded' });
    viewer = new Viewer(page);
    await viewer.ready();
    await expect.poll(() => viewer.viewedCounter()).toBe(`${github.viewed + marked.length} / ${github.total} viewed`);
    await viewer.allFetched();
    for (const path of marked) {
      await viewer.scrollToFile(path);
      await expect.poll(async () => (await viewer.item(path))?.collapsed).toBe(true);
      expect((await viewer.item(path))!.lines).toBe(0);
      await expect(viewer.locator.locator(`.fh[data-path="${path}"] input[type="checkbox"]`)).toBeChecked();
    }
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });
});

test.describe('react/react#37778 (read-only)', () => {
  test('a default expander reveals at most 20 lines per click (expansionLineCount)', async ({ page }) => {
    const viewer = await openPierre(page, REACT, 'hash');
    await resetSettings(viewer);
    // This file's only hunk starts at line 110: 109 unchanged lines above it, more than one click's worth.
    const FILE = 'compiler/apps/playground/components/Header.tsx';
    await viewer.scrollToFile(FILE);
    await expect.poll(async () => (await viewer.item(FILE))?.lines ?? 0, { timeout: 30_000 }).toBeGreaterThan(0);
    expect(await diffText(viewer)).not.toMatch(/@@/);
    const before = (await viewer.item(FILE))!.lines;
    const row = await expander(viewer, FILE);
    expect(row.gap).toBeGreaterThan(20);
    await row.click();
    await expect.poll(async () => (await viewer.item(FILE))!.lines - before, { timeout: 30_000 }).toBe(20);
    await expect.poll(() => diffText(viewer)).toContain(`${row.gap - 20} unmodified lines`);
  });

  test("Split view: the old side meets the new side's line numbers with no divider, like GitHub's", async ({ page }) => {
    const viewer = await openPierre(page, REACT, 'hash');
    await resetSettings(viewer);
    // Line 7 is changed on both sides, and expander rows run above and below it.
    const FILE = '.github/PULL_REQUEST_TEMPLATE.md';
    for (const overflow of ['wrap', 'scroll'] as const) {
      await viewer.evaluate((o) => window.__pierre!.settings.getState().update({ diff: { diffStyle: 'split', overflow: o } }), overflow);
      await viewer.scrollToFile(FILE);
      const edge = () =>
        viewer.evaluate((p, viewerRoot) => {
          const header = [...viewerRoot.querySelectorAll<HTMLElement>('.fh')].find((e) => e.dataset.path === p);
          const root = header?.closest('diffs-container')?.shadowRoot;
          const del = root?.querySelector('[data-deletions] [data-content] [data-line-type="change-deletion"]');
          if (!root || !del) return null;
          const top = del.getBoundingClientRect().top;
          const num = [...root.querySelectorAll('[data-additions] [data-column-number][data-line-type="change-addition"]')].find(
            (n) => Math.abs(n.getBoundingClientRect().top - top) < 1,
          );
          const separator = root.querySelector('[data-additions] [data-gutter] [data-separator]');
          if (!num || !separator) return null;
          return {
            overflow: root.querySelector('[data-diff]')!.getAttribute('data-overflow'),
            x: Math.round(num.getBoundingClientRect().left),
            // Just inside the top of each row, above the text.
            rowY: Math.round(top) + 1,
            separatorY: Math.round(separator.getBoundingClientRect().top) + 2,
          };
        }, FILE);
      await expect.poll(async () => (await edge())?.overflow, { timeout: 30_000 }).toBe(overflow);
      const { x, rowY, separatorY } = (await edge())!;
      // 8 px of the old side's deletion row, then 2 px of the new side's number cell.
      const row = await pixelRow(viewer, x - 8, rowY, 10);
      expect(row[0], `${overflow}: a colored deletion row`).not.toBe(row[9]);
      expect(row.slice(0, 8), `${overflow}: deletion row up to the number cell, ${row.join(' ')}`).toEqual(Array(8).fill(row[0]));
      const separator = await pixelRow(viewer, x - 8, separatorY, 16);
      expect(separator, `${overflow}: one unbroken expander row, ${separator.join(' ')}`).toEqual(Array(16).fill(separator[0]));
    }
    await resetSettings(viewer);
  });

  test('one early click on the Glide tab opens Glide while GitHub is still loading', async ({ page }) => {
    // GitHub re-renders its tab strip during load, re-injecting our tab between pointerdown and pointerup; a single
    // press as soon as the tab exists must still open Glide (no retry).
    await page.goto(prUrl(REACT), { waitUntil: 'commit' });
    const tab = page.locator('a[data-pierre-tab]');
    await tab.waitFor({ timeout: 30_000 });
    const box = (await tab.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect.poll(() => page.url(), { timeout: 10_000 }).toMatch(/#glide$/);
    await new Viewer(page).ready();
  });

  test('opens, lists every file, loads every diff, counter matches GitHub', async ({ page }) => {
    const github = await githubViewedCount(page, REACT);
    const started = Date.now();
    const viewer = await openPierre(page, REACT, 'hash');
    const firstHeaderMs = Date.now() - started;
    const order = await viewer.order();
    expect(order.length).toBe(github.total);
    await expect.poll(() => viewer.viewedCounter()).toBe(`${github.viewed} / ${github.total} viewed`);
    await viewer.allFetched(90_000);
    const allLoadedMs = Date.now() - started;
    const stats = await viewer.evaluate(() => window.__pierreStats);
    test.info().annotations.push({
      type: 'timing',
      description: `after navigation: first header ${firstHeaderMs} ms, all files loaded ${allLoadedMs} ms; loader: first diff ${Math.round(stats!.firstDiffAt! - stats!.startedAt)} ms, all ${Math.round(stats!.doneAt! - stats!.startedAt)} ms, ${stats!.requests} requests`,
    });
    console.log(test.info().annotations.at(-1)!.description);
    const loads = await viewer.loads();
    expect(Object.values(loads).filter((l) => l.status === 'error')).toEqual([]);
  });
});
