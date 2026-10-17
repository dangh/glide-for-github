// @vitest-environment jsdom
import { createElement, Profiler } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { FileSummary, PrData } from '../../src/viewer/github/private';
import { useSettings } from '../../src/viewer/state/settings';
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
});
