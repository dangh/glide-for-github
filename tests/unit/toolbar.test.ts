// @vitest-environment jsdom
import { createElement, Profiler } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FileSummary, PrData } from '../../src/viewer/github/private';
import { useSettings } from '../../src/viewer/state/settings';
import { usePageScroll } from '../../src/viewer/pageScroll';
import { usePr } from '../../src/viewer/state/store';
import { Toolbar } from '../../src/viewer/ui/Toolbar';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const file = (path: string, viewed = false): FileSummary => ({
  path,
  digest: path,
  status: 'modified',
  additions: 1,
  deletions: 1,
  viewed,
  tooLarge: false,
  binary: false,
});

const pr: PrData = {
  ref: { owner: 'o', repo: 'r', number: 1, page: 'changes' },
  author: 'me',
  baseOid: 'base',
  headOid: 'head',
  commits: [{ oid: 'c'.repeat(40), shortOid: 'ccccccc', message: 'one' }],
  files: [file('a.ts', true), file('b.ts'), file('c.ts')],
  viewer: { login: 'me', canApplySuggestion: false, canReview: true },
  threadMarkers: { threads: [], byPath: {} },
};

afterEach(() => {
  document.body.innerHTML = '';
});

describe('Toolbar', () => {
  it('shows the viewed counter and does not re-render while diffs load', async () => {
    usePr.getState().setPr(pr);
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    let commits = 0;
    await act(async () => {
      root.render(createElement(Profiler, { id: 'toolbar', onRender: () => commits++ }, createElement(Toolbar)));
    });
    expect(container.querySelector('[data-testid="viewed-counter"]')!.textContent).toBe('1 / 3 viewed');
    expect(container.textContent).toContain('All commits');

    const before = commits;
    await act(async () => {
      const s = usePr.getState();
      s.setLoad(['a.ts', 'b.ts'], { status: 'loading' });
      s.applyLoads([{ path: 'a.ts', summary: s.files.get('a.ts')!, load: { status: 'loaded', additions: 1, deletions: 1 } }]);
      s.setThreads([]);
      s.setNotice({ kind: 'info', message: 'x' });
    });
    expect(commits).toBe(before);

    await act(async () => usePr.getState().setViewedLocal('b.ts', true));
    expect(container.querySelector('[data-testid="viewed-counter"]')!.textContent).toBe('2 / 3 viewed');
    await act(async () => root.unmount());
  });

  it("toggles the file tree like GitHub's button: label, expanded state and the remembered setting", async () => {
    const saved: unknown[] = [];
    vi.stubGlobal('chrome', { storage: { sync: { get: async () => ({}), set: async (v: unknown) => void saved.push(v) } } });
    usePr.getState().setPr(pr);
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(createElement(Toolbar)));
    const toggle = () => container.querySelector<HTMLButtonElement>('[data-testid="tree-toggle"]')!;
    expect(useSettings.getState().settings.layout.showTree).toBe(true);
    expect(toggle().getAttribute('aria-label')).toBe('Collapse file tree');
    expect(toggle().getAttribute('aria-expanded')).toBe('true');

    await act(async () => toggle().click());
    expect(useSettings.getState().settings.layout.showTree).toBe(false);
    expect(toggle().getAttribute('aria-label')).toBe('Expand file tree');
    expect(toggle().getAttribute('aria-expanded')).toBe('false');

    await act(async () => toggle().click());
    expect(useSettings.getState().settings.layout.showTree).toBe(true);
    expect(saved.length).toBeGreaterThan(0);
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  });

  it("shows the layout and wrap that 'default' resolves to (GitHub: Unified, wrapped)", async () => {
    usePr.getState().setPr(pr);
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(createElement(Toolbar)));
    const pressed = (name: string) =>
      [...container.querySelectorAll('button')].find((b) => b.textContent === name)!.getAttribute('aria-pressed');
    expect(useSettings.getState().settings.diff.diffStyle).toBe('default');
    expect(pressed('Unified')).toBe('true');
    expect(pressed('Split')).toBe('false');
    expect(pressed('Wrap')).toBe('true');
    await act(async () => root.unmount());
  });

  /** The toolbar's controls in order: buttons by accessible name, the divider, the viewed counter, the PR header. */
  const controls = (toolbar: Element) =>
    [...toolbar.children].map((el) => {
      if (el.matches('.toolbar-divider')) return '|';
      if (el.matches('.grow')) return '<grow>';
      if (el.matches('[data-testid="viewed-counter"]')) return 'viewed';
      if (el.matches('[data-testid="pr-title"]')) return 'pr-header';
      if (el.hasAttribute('aria-label')) return el.getAttribute('aria-label');
      const button = el.matches('button') ? el : el.querySelector('button');
      return button?.getAttribute('aria-label') ?? button?.getAttribute('title') ?? el.textContent;
    });

  /** The branch summary's words, as its flex items show them. */
  const summary = (root: Element) =>
    [...root.querySelectorAll('.pr-branches-text > *')].map((el) => el.textContent).filter(Boolean).join(' ');

  async function render() {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(createElement(Toolbar)));
    return { container, toolbar: container.querySelector('[role="toolbar"]')!, unmount: () => act(async () => root.unmount()) };
  }

  it("ends like GitHub's Files changed toolbar: viewed counter, divider, Submit review, Display gear", async () => {
    usePr.getState().setPr(pr);
    const { toolbar, unmount } = await render();
    expect(controls(toolbar)).toEqual([
      'Collapse file tree',
      'All commits',
      'Diff layout',
      'Wrap',
      'Hide whitespace',
      '<grow>',
      'viewed',
      '|',
      'Submit review',
      'Display options',
    ]);
    expect(toolbar.querySelector('[data-testid="display-menu"]')!.textContent).toBe('');
    expect(toolbar.querySelector('.viewed-word')!.textContent).toBe(' viewed');
    await unmount();
  });

  it('with the merged bar, keeps the diff toggles in the Display menu only, as GitHub does', async () => {
    usePr.getState().setPr(pr);
    usePageScroll.setState({ layout: 'merged', stuck: false });
    const { toolbar, unmount } = await render();
    expect(controls(toolbar)).toEqual(['Collapse file tree', 'All commits', '<grow>', 'viewed', '|', 'Submit review', 'Display options']);

    await act(async () => toolbar.querySelector<HTMLButtonElement>('[data-testid="display-menu"]')!.click());
    const menu = toolbar.querySelector('.display-menu .popover-panel')!;
    const labels = [...menu.querySelectorAll('.field > span:last-of-type, .field > span:first-child')].map((l) => l.textContent);
    expect(labels).toEqual(expect.arrayContaining(['Layout', 'Long lines', 'Hide whitespace changes']));
    await unmount();
    usePageScroll.setState({ layout: 'frame', stuck: false });
  });

  it("stuck with the merged bar, shows GitHub's sticky PR header: state, plain title and number above the commit range and branches", async () => {
    usePr.getState().setPr({
      ...pr,
      title: 'Use `foo` in `bar`',
      state: 'merged',
      mergedBy: 'octocat',
      branches: { base: 'main', head: { owner: 'o', repo: 'r', branch: 'feature/x' }, commits: 4 },
    });
    const { toolbar, unmount } = await render();
    const header = () => toolbar.querySelector('[data-testid="pr-title"]');
    expect(header()).toBeNull();

    await act(async () => usePageScroll.setState({ layout: 'page', stuck: true }));
    expect(header()).toBeNull();

    await act(async () => usePageScroll.setState({ layout: 'merged', stuck: true }));
    expect(controls(toolbar)).toEqual(['Collapse file tree', 'pr-header', '<grow>', 'viewed', '|', 'Submit review', 'Display options']);
    expect(header()!.querySelector('.pr-state-merged')!.textContent).toBe('Merged');
    expect(header()!.querySelector('.pr-state svg')).not.toBeNull();
    expect(header()!.querySelector('.pr-title-text')!.textContent).toBe('Use `foo` in `bar`');
    expect(header()!.querySelector('code')).toBeNull();
    expect(header()!.querySelector('.pr-number')!.textContent).toBe('#1');
    const row = header()!.querySelector('.pr-summary-row')!;
    expect(row.querySelector('[data-testid="range-picker"]')!.textContent).toBe('All commits');
    expect(summary(row)).toBe('octocat merged 4 commits into main from feature/x');
    expect([...row.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual([
      'https://github.com/octocat',
      'https://github.com/o/r/tree/main',
      'https://github.com/o/r/tree/feature/x',
    ]);
    expect(row.querySelector('button[aria-label="Copy head branch name to clipboard"]')).not.toBeNull();

    // A fork's branches carry their owners; an open or draft PR is its author's.
    await act(async () =>
      usePr.getState().setPr({ ...pr, title: 'T', state: 'draft', branches: { base: 'main', head: { owner: 'me', repo: 'r-fork', branch: 'topic' }, commits: 1 } }),
    );
    expect(header()!.querySelector('.pr-state-draft')!.textContent).toBe('Draft');
    expect(summary(header()!)).toBe('me wants to merge 1 commit into o:main from me:topic');
    expect(header()!.querySelector<HTMLAnchorElement>('.branch-name:last-of-type')!.getAttribute('href')).toBe('https://github.com/me/r-fork/tree/topic');

    await act(async () => usePr.getState().setPr({ ...pr, title: 'T', state: 'open' }));
    expect(header()!.querySelector('.pr-state-open')!.textContent).toBe('Open');
    expect(header()!.querySelector('[data-testid="pr-branches"]')).toBeNull();

    await act(async () => usePageScroll.setState({ stuck: false }));
    expect(header()).toBeNull();
    expect(toolbar.querySelector('[data-testid="range-picker"]')).not.toBeNull();
    await unmount();
    usePageScroll.setState({ layout: 'frame', stuck: false });
  });
});
