/**
 * File groups (Sift's tabs in Glide), read-only, on react/react#37778 (167 files). Tests that change settings or
 * groups snapshot every stored Glide item first and put them back in afterAll.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserContext, Page } from '@playwright/test';
import { expect, extensionId, openPierre, REACT, ROOT, test, type Viewer } from './fixtures';

test.describe.configure({ mode: 'serial' });

const SHOTS = join(ROOT, '.superpowers/file-groups');
mkdirSync(SHOTS, { recursive: true });

/** Glide's sync items: the settings and the file groups. */
const isGlideKey = (k: string) => k === 'pierre.settings' || k.startsWith('pierre.fileGroups');

async function extensionPage(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId()}/options.html`);
  return page;
}

async function readGlideSync(context: BrowserContext): Promise<Record<string, unknown>> {
  const ext = await extensionPage(context);
  const all = await ext.evaluate(() => chrome.storage.sync.get(null));
  await ext.close();
  return Object.fromEntries(Object.entries(all).filter(([k]) => isGlideKey(k)));
}

async function writeGlideSync(context: BrowserContext, items: Record<string, unknown>) {
  const ext = await extensionPage(context);
  await ext.evaluate(async (saved) => {
    const all = await chrome.storage.sync.get(null);
    const stale = Object.keys(all).filter((k) => (k === 'pierre.settings' || k.startsWith('pierre.fileGroups')) && !(k in saved));
    if (stale.length > 0) await chrome.storage.sync.remove(stale);
    if (Object.keys(saved).length > 0) await chrome.storage.sync.set(saved);
  }, items);
  await ext.close();
}

/** Merges `patch` into one section of the stored settings. */
async function setSettings(context: BrowserContext, section: string, patch: Record<string, unknown>, back?: Page) {
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

const tabs = (viewer: Viewer) => viewer.locator.getByRole('tablist', { name: 'File groups' }).getByRole('tab');
const tab = (viewer: Viewer, name: string) => viewer.locator.getByRole('tab', { name: new RegExp(`^${name} \\d+$`) });

/** Each tab's label and count, as shown. */
const tabCounts = async (viewer: Viewer) =>
  Object.fromEntries(
    (await tabs(viewer).allInnerTexts()).map((t) => {
      const m = /^(.*?)\s*(\d+)$/.exec(t.trim())!;
      return [m[1]!, Number(m[2])];
    }),
  );

/** What the diff list holds (CodeView items) and what the store says the open group shows. */
const listState = (viewer: Viewer) =>
  viewer.frame().evaluate(() => {
    const p = window.__pierre!;
    const order = p.store.getState().order;
    const inList = order.filter((path) => p.session.codeView?.getItem(path) !== undefined);
    return { inList, order, selected: document.querySelector('[role="tab"][aria-selected="true"]')?.textContent ?? null };
  });

/**
 * The toolbar's visible controls and whether any is cut off or overlaps another: each must sit inside the toolbar's
 * content box (inside the page gutters) and inside the window. `form` says which form the file groups show.
 */
const toolbarLayout = (viewer: Viewer) =>
  viewer.frame().evaluate(() => {
    const bar = document.querySelector<HTMLElement>('.pierre-toolbar')!;
    const cs = getComputedStyle(bar);
    const box = bar.getBoundingClientRect();
    const left = Math.max(0, box.left + parseFloat(cs.paddingLeft));
    const right = Math.min(document.documentElement.clientWidth, box.right - parseFloat(cs.paddingRight));
    const CONTROLS = 'button, a, .viewed-counter, .pr-state, .pr-number, .toolbar-divider';
    const visible = (el: Element) => el.checkVisibility({ visibilityProperty: true, opacityProperty: true }) && el.getBoundingClientRect().width > 0;
    const all = [...bar.querySelectorAll(CONTROLS)].filter((el) => visible(el) && !el.closest('.popover-panel'));
    // Leaves only: a control holding another (the merged title link holds nothing; a tab list's tabs are leaves).
    const leaves = all.filter((el) => !all.some((o) => o !== el && el.contains(o)));
    const name = (el: Element) => (el.getAttribute('aria-label') || el.textContent || el.className).trim().slice(0, 30);
    const problems: string[] = [];
    /** The part of `el` left visible by the ancestors that clip it (the branch summary cuts off its end). */
    const shownRect = (el: Element) => {
      const r = el.getBoundingClientRect();
      let { left: l, right: rt } = r;
      for (let p = el.parentElement; p && p !== bar; p = p.parentElement) {
        if (getComputedStyle(p).overflowX === 'visible') continue;
        const c = p.getBoundingClientRect();
        l = Math.max(l, c.left);
        rt = Math.min(rt, c.right);
      }
      return { left: l, right: rt, top: r.top, bottom: r.bottom };
    };
    const rects = leaves.map((el) => ({ el, r: shownRect(el) })).filter(({ r }) => r.right - r.left > 0.5);
    for (const { el, r } of rects) {
      if (r.left < left - 0.5 || r.right > right + 0.5) problems.push(`${name(el)} outside [${Math.round(left)}, ${Math.round(right)}]: ${Math.round(r.left)}-${Math.round(r.right)}`);
    }
    // The merged title's row overlaps the commit range row under it by 4 px, as GitHub's sticky title does.
    const row = (el: Element) => (el.closest('.pr-title-row') ? 'title' : el.closest('.pr-summary-row') ? 'summary' : null);
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const rows = [row(rects[i]!.el), row(rects[j]!.el)];
        if (rows.includes('title') && rows.includes('summary')) continue;
        const a = rects[i]!.r;
        const b = rects[j]!.r;
        // Tabs share their 1 px borders by design.
        const overlap = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const vertical = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (overlap > 1.5 && vertical > 1.5) problems.push(`${name(rects[i]!.el)} overlaps ${name(rects[j]!.el)} by ${Math.round(overlap)} px`);
      }
    }
    const slot = document.querySelector('[data-testid="file-groups"]');
    return {
      problems,
      form: !slot ? 'none' : slot.hasAttribute('data-compact') ? 'menu' : 'tabs',
      width: Math.round(box.width),
    };
  });

/** Every width from GitHub's narrowest phone layout up: the ones where GitHub's toolbar changes, and the gaps between. */
const WIDTHS = [320, 360, 414, 480, 500, 544, 600, 700, 767, 768, 840, 900, 1012, 1100, 1180, 1280, 1400, 1600];

async function sweep(viewer: Viewer, label: string, prepare?: () => Promise<void>) {
  const page = viewer.page;
  const forms: Record<number, string> = {};
  try {
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await prepare?.();
      // Resize observers and GitHub's own layout settle over a few frames.
      await page.waitForTimeout(250);
      const layout = await toolbarLayout(viewer);
      expect(layout.problems, `${label} at ${width} px`).toEqual([]);
      forms[width] = layout.form;
    }
  } finally {
    await page.setViewportSize({ width: 1400, height: 900 });
  }
  return forms;
}

let saved: Record<string, unknown> = {};

test.beforeAll(async ({ extContext }) => {
  saved = await readGlideSync(extContext);
  // Known starting point: default groups, file groups on, opening on All, tree left and shown, no page scrolling.
  await writeGlideSync(extContext, {});
});

test.afterAll(async ({ extContext }) => {
  await writeGlideSync(extContext, saved);
});

test.describe('file groups', () => {
  test('tabs with counts on react#37778; the groups add up to All', async ({ page }) => {
    const viewer = await openPierre(page, REACT, 'hash');
    await expect(tabs(viewer).first()).toBeVisible();
    const counts = await tabCounts(viewer);
    // Sift's tabs on this PR (store/screenshots/1-tests-tab.png there): Infra and Artifacts are empty, so hidden.
    expect(counts).toEqual({ All: 167, Source: 59, Tests: 80, Docs: 5, Manifest: 23 });
    expect(counts.Source! + counts.Tests! + counts.Docs! + counts.Manifest!).toBe(counts.All);
    await expect(tab(viewer, 'All')).toHaveAttribute('aria-selected', 'true');
    // All is today's view: every file in the list.
    const state = await listState(viewer);
    expect(state.inList).toEqual(state.order);
  });

  test('the tabs sit in the toolbar row, left of the viewed counter; there is no row of their own', async ({ page }) => {
    const viewer = await openPierre(page, REACT, 'hash');
    const place = await viewer.frame().evaluate(() => {
      const bar = document.querySelector('.pierre-toolbar')!;
      const tabs = document.querySelector('[role="tablist"]')!;
      const viewed = document.querySelector('[data-testid="viewed-counter"]')!.getBoundingClientRect();
      const r = tabs.getBoundingClientRect();
      return { inBar: bar.contains(tabs), gap: Math.round(viewed.left - r.right), middle: Math.round(r.top + r.height / 2 - (viewed.top + viewed.height / 2)), height: Math.round(r.height), rows: document.querySelectorAll('.pierre-app > .file-groups').length };
    });
    // Sift's spacing: 12 px before the viewed counter, centred on the row, 28 px tall.
    expect(place).toEqual({ inBar: true, gap: 12, middle: 0, height: 28, rows: 0 });
  });

  for (const tree of ['left', 'right'] as const) {
    test(`toolbar with the tree ${tree}: tabs when they fit, else the menu, and nothing is cut off or overlaps from 320 px up`, async ({ page, extContext }) => {
      await setSettings(extContext, 'layout', { treePosition: tree });
      try {
        const viewer = await openPierre(page, REACT, 'hash');
        const forms = await sweep(viewer, `frame, tree ${tree}`);
        expect(forms[320]).toBe('menu');
        // At 1100 px Split/Unified, Wrap and Hide whitespace make room (they are in the Display menu too).
        expect(forms[1100]).toBe('tabs');
        expect(forms[1600]).toBe('tabs');
        const toggles = () => viewer.frame().evaluate(() => [...document.querySelectorAll('.diff-toggle')].some((el) => el.getClientRects().length > 0));
        await page.setViewportSize({ width: 1100, height: 900 });
        await expect.poll(toggles).toBe(false);
        await page.setViewportSize({ width: 1600, height: 900 });
        await expect.poll(toggles).toBe(true);
        await page.setViewportSize({ width: 1400, height: 900 });
      } finally {
        await writeGlideSync(extContext, {});
      }
    });
  }

  test('narrow: a menu button with the open group and its count; keyboard and ARIA like a menu', async ({ page }) => {
    const viewer = await openPierre(page, REACT, 'hash');
    await tab(viewer, 'Tests').click();
    try {
      await page.setViewportSize({ width: 700, height: 900 });
      const button = viewer.locator.getByTestId('file-groups-button');
      await expect(viewer.locator.getByRole('button', { name: 'File group: Tests 80' })).toBeVisible();
      await expect(button).toHaveAttribute('aria-haspopup', 'menu');
      await expect(button).toHaveAttribute('aria-expanded', 'false');
      // The hidden tabs are out of the accessibility tree and the Tab order.
      await expect(viewer.locator.getByRole('tablist', { name: 'File groups' })).toHaveCount(0);
      const menu = viewer.locator.getByRole('menu', { name: 'File groups' });
      const item = (name: string) => menu.getByRole('menuitemradio', { name: new RegExp(`^${name} \\d+$`) });

      // Enter opens it on the open group; arrows, Home and End move; Enter picks, closes and focuses the button.
      await button.focus();
      await page.keyboard.press('Enter');
      await expect(button).toHaveAttribute('aria-expanded', 'true');
      await expect(item('Tests')).toBeFocused();
      await expect(item('Tests')).toHaveAttribute('aria-checked', 'true');
      const items = (await menu.getByRole('menuitemradio').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
      expect(items).toEqual(['All 167', 'Source 59', 'Tests 80', 'Docs 5', 'Manifest 23']);
      await page.keyboard.press('ArrowDown');
      await expect(item('Docs')).toBeFocused();
      await page.keyboard.press('End');
      await expect(item('Manifest')).toBeFocused();
      await page.keyboard.press('ArrowDown');
      await expect(item('All')).toBeFocused();
      await page.keyboard.press('Home');
      await page.keyboard.press('ArrowDown');
      await expect(item('Source')).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(menu).toHaveCount(0);
      await expect(button).toBeFocused();
      await expect(viewer.locator.getByRole('button', { name: 'File group: Source 59' })).toBeVisible();
      expect((await listState(viewer)).inList).toHaveLength(59);

      // Up opens it on the last group; typing a letter jumps to a group; Escape closes and keeps the group.
      await page.keyboard.press('ArrowUp');
      await expect(item('Manifest')).toBeFocused();
      await page.keyboard.press('d');
      await expect(item('Docs')).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
      await expect(button).toBeFocused();
      await expect(button).toHaveAccessibleName('File group: Source 59');

      // A click picks too; a click outside closes.
      await viewer.locator.getByTestId('file-groups-button').click();
      await item('Docs').click();
      await expect(viewer.locator.getByRole('button', { name: 'File group: Docs 5' })).toBeVisible();
      expect((await listState(viewer)).inList).toHaveLength(5);
      await viewer.locator.getByTestId('file-groups-button').click();
      await expect(menu).toBeVisible();
      await viewer.locator.getByTestId('viewed-counter').click();
      await expect(menu).toHaveCount(0);

      // At 320 px the menu stays inside the window.
      await page.setViewportSize({ width: 320, height: 900 });
      await viewer.locator.getByTestId('file-groups-button').click();
      const inside = await viewer.frame().evaluate(() => {
        const r = document.querySelector('[role="menu"]')!.getBoundingClientRect();
        return r.left >= 0 && r.right <= document.documentElement.clientWidth;
      });
      expect(inside).toBe(true);
      await page.keyboard.press('Escape');

      // Wide again: the tabs come back with the same group open, and focus moves to it from the button.
      await viewer.locator.getByTestId('file-groups-button').focus();
      await page.setViewportSize({ width: 1400, height: 900 });
      await expect(tab(viewer, 'Docs')).toHaveAttribute('aria-selected', 'true');
      await expect(tab(viewer, 'Docs')).toBeFocused();
    } finally {
      await page.setViewportSize({ width: 1400, height: 900 });
    }
  });

  test('merged bar, before and after it sticks: tabs or menu, nothing cut off or overlapping from 320 px up', async ({ page, extContext }) => {
    await setSettings(extContext, 'experiments', { pageScroll: true, mergedBar: true });
    try {
      const viewer = await openPierre(page, REACT, 'hash');
      const top = await sweep(viewer, 'merged, top', async () => {
        await page.evaluate(() => window.scrollTo(0, 0));
      });
      const stuck = await sweep(viewer, 'merged, stuck', async () => {
        // Past GitHub's header, so the viewer is stuck to the top of the window.
        await page.evaluate(() => window.scrollTo(0, scrollY + document.querySelector('iframe[data-pierre-viewer]')!.getBoundingClientRect().top + 600));
        await expect.poll(() => viewer.frame().evaluate(() => document.querySelector('.pierre-toolbar')!.hasAttribute('data-stuck'))).toBe(true);
      });
      expect(top[320]).toBe('menu');
      expect(top[1100]).toBe('tabs');
      // Stuck, the long title (react#37778's) gives way first, as GitHub's sticky title does beside Sift's tabs.
      expect(stuck[320]).toBe('menu');
      expect(stuck[1100]).toBe('tabs');
    } finally {
      await writeGlideSync(extContext, {});
    }
  });

  test('Tests filters the tree and the diffs, instantly, and loaded diffs stay loaded; viewed stays global', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
    const viewer = await openPierre(page, REACT, 'hash');
    const before = await viewer.viewedCounter();

    // Switched while diffs are still loading: files outside the group load too, without touching the list.
    const started = Date.now();
    await tab(viewer, 'Tests').click();
    await expect(tab(viewer, 'Tests')).toHaveAttribute('aria-selected', 'true');
    const state = await listState(viewer);
    expect(Date.now() - started).toBeLessThan(1500);
    await viewer.allFetched();
    expect(errors.filter((e) => /CodeView/.test(e))).toEqual([]);
    await viewer.frame().evaluate(() => ((window as unknown as { __diffs: unknown }).__diffs = window.__pierre!.store.getState().diffs));
    expect(state.inList).toHaveLength(80);
    expect(state.inList.every((p) => /__tests__\/|\.test\.|fixtures\//.test(p))).toBe(true);
    expect(state.inList).toEqual(state.order.filter((p) => state.inList.includes(p)));

    const tree = await viewer.treeFiles();
    expect(tree.sort()).toEqual([...state.inList].sort());
    // Every rendered diff header belongs to the group.
    const headers = await viewer.frame().evaluate(() => [...document.querySelectorAll<HTMLElement>('.fh')].map((h) => h.dataset.path!));
    expect(headers.length).toBeGreaterThan(0);
    expect(headers.every((h) => state.inList.includes(h))).toBe(true);
    expect(await viewer.viewedCounter()).toBe(before);

    // Loaded diffs stay loaded: the store's diffs are the very same map after switching back and forth.
    for (const name of ['Docs', 'Manifest', 'Source', 'All', 'Tests']) await tab(viewer, name).click();
    expect(await viewer.frame().evaluate(() => (window as unknown as { __diffs: unknown }).__diffs === window.__pierre!.store.getState().diffs)).toBe(true);
    expect(await viewer.frame().evaluate(() => [...window.__pierre!.store.getState().load.values()].some((l) => l.status === 'loading'))).toBe(false);
    await page.mouse.move(700, 120);
    await page.screenshot({ path: `${SHOTS}/tests-light-tree-left.png` });
  });

  test('a switch keeps the place when the top file is in the new group, else starts at the top', async ({ page }) => {
    const viewer = await openPierre(page, REACT, 'hash');
    const tests = (await listState(viewer)).order.filter((p) => p.includes('__tests__/'));
    const path = tests[Math.floor(tests.length / 2)]!;
    await viewer.scrollToFile(path);
    await expect.poll(async () => (await viewer.item(path))?.top ?? Infinity, { timeout: 10_000 }).toBeLessThan(60);
    const listTop = () => viewer.frame().evaluate(() => document.querySelector('.pierre-diffs')!.scrollTop);
    expect(await listTop()).toBeGreaterThan(1000);

    await tab(viewer, 'Tests').click();
    await expect.poll(async () => Math.abs(((await viewer.item(path))?.top ?? Infinity))).toBeLessThan(60);
    await tab(viewer, 'All').click();
    await expect.poll(async () => Math.abs(((await viewer.item(path))?.top ?? Infinity))).toBeLessThan(60);
    await tab(viewer, 'Docs').click();
    await expect.poll(listTop).toBe(0);
  });

  test('the tree search works within the group', async ({ page }) => {
    const viewer = await openPierre(page, REACT, 'hash');
    const search = viewer.locator.locator('file-tree-container').getByPlaceholder('Search…');
    await tab(viewer, 'Docs').click();
    const docs = (await listState(viewer)).inList;
    expect(docs).toHaveLength(5);
    await search.fill('md');
    // The tree filters on its next render: poll until the rows are the matches.
    await expect.poll(async () => (await viewer.treeFiles()).sort()).toEqual([...docs].sort());

    // Clicking another tab keeps the search open with its text, and it finds only that group's files.
    await tab(viewer, 'Manifest').click();
    const manifest = (await listState(viewer)).inList;
    await expect(search).toHaveValue('md');
    await expect.poll(async () => (await viewer.treeFiles()).sort()).toEqual(manifest.filter((p) => /md/i.test(p)).sort());

    // So does a pick from the narrow toolbar's menu.
    await page.setViewportSize({ width: 700, height: 900 });
    try {
      await viewer.locator.getByTestId('file-groups-button').click();
      await viewer.locator.getByRole('menuitemradio', { name: /^Docs \d+$/ }).click();
      await expect(search).toHaveValue('md');
      await expect.poll(async () => (await viewer.treeFiles()).sort()).toEqual([...docs].sort());
    } finally {
      await page.setViewportSize({ width: 1400, height: 900 });
    }
  });

  test('a collapsed file stays collapsed across group switches', async ({ page }) => {
    const viewer = await openPierre(page, REACT, 'hash');
    await tab(viewer, 'Docs').click();
    const path = (await listState(viewer)).inList[0]!;
    const header = viewer.locator.locator(`.fh[data-path="${path}"]`);
    await header.getByRole('button', { name: 'Collapse file' }).click();
    const collapsed = () => viewer.frame().evaluate((p) => window.__pierre!.session.codeView?.getItem(p)?.collapsed, path);
    await expect.poll(collapsed).toBe(true);
    await tab(viewer, 'All').click();
    await expect.poll(collapsed).toBe(true);
    await tab(viewer, 'Docs').click();
    await expect(header.getByRole('button', { name: 'Expand file' })).toBeVisible();

    // A folder collapsed in the tree stays collapsed in every group that has it.
    await tab(viewer, 'All').click();
    const folder = viewer.locator.locator('file-tree-container [data-item-type="folder"][data-item-path^="compiler"]').first();
    const folderPath = await folder.getAttribute('data-item-path');
    await expect(folder).toHaveAttribute('aria-expanded', 'true');
    await folder.click();
    await expect(folder).toHaveAttribute('aria-expanded', 'false');
    const row = viewer.locator.locator(`file-tree-container [data-item-path="${folderPath}"]`);
    await tab(viewer, 'Docs').click();
    await expect(row).toHaveAttribute('aria-expanded', 'false');
    await tab(viewer, 'All').click();
    await expect(row).toHaveAttribute('aria-expanded', 'false');
  });

  test('keyboard: arrow keys, Home and End move between tabs and open them', async ({ page }) => {
    const viewer = await openPierre(page, REACT, 'hash');
    await tab(viewer, 'All').focus();
    await page.keyboard.press('ArrowRight');
    await expect(tab(viewer, 'Source')).toHaveAttribute('aria-selected', 'true');
    await expect(tab(viewer, 'Source')).toBeFocused();
    await page.keyboard.press('End');
    await expect(tab(viewer, 'Manifest')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowRight');
    await expect(tab(viewer, 'All')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowLeft');
    await expect(tab(viewer, 'Manifest')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Home');
    await expect(tab(viewer, 'All')).toHaveAttribute('aria-selected', 'true');
    // Only the open tab is in the Tab order.
    expect(await viewer.locator.locator('[role="tab"][tabindex="0"]').count()).toBe(1);
  });

  test('the group picked on a PR is remembered after a reload', async ({ page }) => {
    let viewer = await openPierre(page, REACT, 'hash');
    await tab(viewer, 'Docs').click();
    viewer = await openPierre(page, REACT, 'hash');
    await expect(tab(viewer, 'Docs')).toHaveAttribute('aria-selected', 'true');
    expect((await listState(viewer)).inList).toHaveLength(5);
    await tab(viewer, 'All').click();
    viewer = await openPierre(page, REACT, 'hash');
    await expect(tab(viewer, 'All')).toHaveAttribute('aria-selected', 'true');
  });

  test('the default group from the options opens a fresh PR', async ({ page, extContext }) => {
    await setSettings(extContext, 'fileGroups', { defaultGroup: 'Tests' });
    try {
      const viewer = await openPierre(page, REACT, 'hash');
      await expect(tab(viewer, 'Tests')).toHaveAttribute('aria-selected', 'true');
      expect((await listState(viewer)).inList).toHaveLength(80);
    } finally {
      await writeGlideSync(extContext, {});
    }
  });

  test('editing a group in the options changes the tabs live', async ({ page, extContext }) => {
    const viewer = await openPierre(page, REACT, 'hash');
    const options = await extensionPage(extContext);
    try {
      const section = options.locator('section', { has: options.getByRole('heading', { name: 'File groups' }) });
      await expect(section.getByTestId('group-card')).toHaveCount(6);
      await section.screenshot({ path: `${SHOTS}/options.png` });
      await section.getByRole('button', { name: 'Add group' }).click();
      await section.getByRole('textbox', { name: 'Name of group 7' }).fill('Compiler');
      await section.getByRole('textbox', { name: 'Patterns of Compiler' }).fill('/compiler/\n!Tests');
      await expect(section.getByRole('status')).toHaveText('Saved');
      await section.getByRole('textbox', { name: 'Name of group 3' }).fill('Documentation');
      await expect(section.getByRole('status')).toHaveText('Saved');
      await page.bringToFront();
      await expect(tab(viewer, 'Documentation')).toBeVisible();
      const counts = await tabCounts(viewer);
      expect(counts.Documentation).toBe(5);
      expect(counts.Compiler).toBeGreaterThan(0);
      await tab(viewer, 'Compiler').click();
      const state = await listState(viewer);
      expect(state.inList).toHaveLength(counts.Compiler!);
      expect(state.inList.every((p) => p.startsWith('compiler/') && !/__tests__\/|\.test\./.test(p))).toBe(true);

      // An invalid edit is refused, and the viewer keeps the last good groups.
      await options.bringToFront();
      await section.getByRole('textbox', { name: 'Name of group 7' }).fill('Tests');
      await expect(section.getByRole('alert')).toContainText('Two groups are named "Tests"');
      await page.bringToFront();
      await expect(tab(viewer, 'Compiler')).toBeVisible();

      await options.bringToFront();
      await section.getByRole('button', { name: 'Reset to defaults' }).click();
      await expect(section.getByRole('status')).toHaveText('Saved');
      await page.bringToFront();
      await expect(tab(viewer, 'Docs')).toBeVisible();
      await expect(tab(viewer, 'Compiler')).toHaveCount(0);
      // The open group is gone: back to All.
      await expect(tab(viewer, 'All')).toHaveAttribute('aria-selected', 'true');
    } finally {
      await options.close();
      await writeGlideSync(extContext, {});
    }
  });

  test('turned off, there are no tabs and every file shows', async ({ page, extContext }) => {
    const viewer = await openPierre(page, REACT, 'hash');
    await tab(viewer, 'Tests').click();
    await setSettings(extContext, 'fileGroups', { enabled: false }, page);
    try {
      await expect(viewer.locator.getByTestId('file-groups')).toHaveCount(0);
      await expect.poll(async () => (await listState(viewer)).inList.length).toBe(167);
    } finally {
      await writeGlideSync(extContext, {});
    }
  });

  test('works with the tree on the right, the tree hidden, and in dark mode', async ({ page, extContext }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await setSettings(extContext, 'layout', { treePosition: 'right' });
    try {
      let viewer = await openPierre(page, REACT, 'hash');
      await tab(viewer, 'Tests').click();
      await page.mouse.move(700, 120);
      await page.screenshot({ path: `${SHOTS}/tests-dark-tree-right.png` });
      await page.emulateMedia({ colorScheme: 'light' });
      await page.screenshot({ path: `${SHOTS}/tests-light-tree-right.png` });
      expect((await viewer.treeFiles()).length).toBe(80);

      await viewer.locator.getByTestId('tree-toggle').click();
      await expect(viewer.locator.getByTestId('tree')).toBeHidden();
      await tab(viewer, 'Docs').click();
      expect((await listState(viewer)).inList).toHaveLength(5);
      await viewer.locator.getByTestId('tree-toggle').click();
      await expect.poll(async () => (await viewer.treeFiles()).length).toBe(5);

      await setSettings(extContext, 'layout', { treePosition: 'left' });
      await page.emulateMedia({ colorScheme: 'dark' });
      viewer = await openPierre(page, REACT, 'hash');
      await expect(tab(viewer, 'Docs')).toHaveAttribute('aria-selected', 'true');
      await tab(viewer, 'Tests').click();
      await page.mouse.move(700, 120);
      await page.screenshot({ path: `${SHOTS}/tests-dark-tree-left.png` });
    } finally {
      await page.emulateMedia({ colorScheme: null });
      await writeGlideSync(extContext, {});
    }
  });

  test('with page scrolling and the merged bar, the tabs stay with the toolbar', async ({ page, extContext }) => {
    await setSettings(extContext, 'experiments', { pageScroll: true, mergedBar: true });
    try {
      const viewer = await openPierre(page, REACT, 'hash');
      await expect(tab(viewer, 'All')).toBeVisible();
      await tab(viewer, 'Tests').click();
      expect((await listState(viewer)).inList).toHaveLength(80);
      // Scroll the page until GitHub's header is gone and the viewer is stuck: the tabs are still on screen.
      await page.mouse.move(900, 650);
      for (let i = 0; i < 20; i++) {
        await page.mouse.wheel(0, 300);
        await page.waitForTimeout(25);
      }
      await page.waitForTimeout(800);
      const box = await page.locator('iframe[data-pierre-viewer]').boundingBox();
      const tabBox = await tab(viewer, 'Tests').boundingBox();
      expect(tabBox!.y).toBeGreaterThanOrEqual(box!.y);
      expect(tabBox!.y).toBeLessThan(200);
      await page.screenshot({ path: `${SHOTS}/tests-merged-bar-stuck.png` });
      await tab(viewer, 'Docs').click();
      expect((await listState(viewer)).inList).toHaveLength(5);
    } finally {
      await writeGlideSync(extContext, {});
    }
  });
});
