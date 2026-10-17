// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://github.com/dangh/pierre-sandbox/pull/1/changes"}
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { injectTab, setTabActive } from '../../src/content/tab';
import { mountViewer, setExtensionUrlResolver } from '../../src/content/host';
import { createLifecycle } from '../../src/content/lifecycle';
import { pierreUrl, type PrRef } from '../../src/shared/pr-url';

const ref: PrRef = { owner: 'dangh', repo: 'pierre-sandbox', number: 1, page: 'changes' };
const EXT = 'chrome-extension://abcdefghijklmnop/';

const fixture = (name: string) =>
  readFileSync(resolve(__dirname, '../fixtures/dom', name), 'utf8');

const fixtures = [
  { name: 'new React PR UI', file: 'pr-tabs-new.html', filesTab: 'a#prs-files-anchor-tab' },
  { name: 'classic PR UI', file: 'pr-tabs-classic.html', filesTab: 'a[href$="/pull/1/files"]' },
];

const go = (path: string) => window.history.pushState(null, '', path);
const pierreTabs = () => document.querySelectorAll('[data-pierre-tab]');
const viewers = () => document.querySelectorAll('iframe[data-pierre-viewer]');

/** Document HTML with the Pierre tab and viewer removed, to compare against the untouched fixture. */
function bodyWithoutPierre(): string {
  const clone = document.body.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('[data-pierre-tab], iframe[data-pierre-viewer]').forEach((e) => e.remove());
  return clone.innerHTML;
}

beforeEach(() => {
  setExtensionUrlResolver((path) => EXT + path);
  vi.spyOn(window, 'postMessage').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('data-color-mode');
  go('/dangh/pierre-sandbox/pull/1/changes');
});

describe.each(fixtures)('$name', ({ file, filesTab }) => {
  let original: string;

  beforeEach(() => {
    document.body.innerHTML = fixture(file);
    original = document.body.innerHTML;
    go('/dangh/pierre-sandbox/pull/1/changes');
  });

  describe('injectTab', () => {
    it('inserts the Pierre tab directly after Files changed', () => {
      const tab = injectTab(document, ref);
      const files = document.querySelector(filesTab)!;
      expect(tab).not.toBeNull();
      expect(files.nextElementSibling).toBe(tab);
      expect(tab!.textContent).toContain('Pierre');
      expect(tab!.getAttribute('href')).toBe(pierreUrl(ref));
      expect(tab!.hasAttribute('data-pierre-tab')).toBe(true);
    });

    it('copies the tab classes but not selection, id or counters', () => {
      const tab = injectTab(document, ref)!;
      const files = document.querySelector(filesTab)!;
      expect(tab.id).toBe('');
      expect(tab.hasAttribute('aria-current')).toBe(false);
      expect(tab.className).not.toMatch(/selected/);
      const filesClasses = [...files.classList].filter((c) => !/^selected/.test(c));
      for (const c of filesClasses) expect(tab.classList.contains(c)).toBe(true);
      expect(tab.querySelector('[class*="Counter"]')).toBeNull();
    });

    it('is idempotent', () => {
      const a = injectTab(document, ref);
      const b = injectTab(document, ref);
      expect(b).toBe(a);
      expect(pierreTabs()).toHaveLength(1);
    });

    it('returns null when the tab nav is missing', () => {
      document.body.innerHTML = '<p>nothing here</p>';
      expect(injectTab(document, ref)).toBeNull();
    });

    it('leaves everything else byte-identical', () => {
      injectTab(document, ref);
      expect(bodyWithoutPierre()).toBe(original);
    });
  });

  describe('setTabActive', () => {
    it('moves the selected styling to Pierre and restores it exactly', () => {
      const tab = injectTab(document, ref)!;
      const files = document.querySelector(filesTab)!;
      expect(files.getAttribute('aria-current')).toBe('page');

      setTabActive(document, true);
      expect(tab.getAttribute('aria-current')).toBe('page');
      expect(tab.className).toMatch(/selected/);
      expect(files.getAttribute('aria-current')).not.toBe('page');
      expect(files.className).not.toMatch(/selected/);

      setTabActive(document, true); // idempotent
      expect(tab.getAttribute('aria-current')).toBe('page');

      setTabActive(document, false);
      expect(tab.hasAttribute('aria-current')).toBe(false);
      expect(tab.className).not.toMatch(/selected/);
      expect(bodyWithoutPierre()).toBe(original);
    });

    it('does not re-select a tab GitHub already moved away from while Pierre was active', () => {
      const tab = injectTab(document, ref)!;
      const files = document.querySelector(filesTab)!;
      const other = [...files.parentElement!.children].find((c) => c !== files && c !== tab)! as HTMLElement;
      setTabActive(document, true);

      // User clicks another tab: GitHub's router moves the selected state (React removes the old attrs).
      const selectedClass = tab.getAttribute('data-pierre-selected')!;
      files.removeAttribute('aria-current');
      other.setAttribute('aria-current', 'page');
      other.classList.add(selectedClass);

      setTabActive(document, false);
      expect(files.hasAttribute('aria-current')).toBe(false);
      expect(files.className).not.toMatch(/selected/);
      expect(document.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
      expect(other.getAttribute('aria-current')).toBe('page');
      expect(files.hasAttribute('data-pierre-class')).toBe(false);
    });
  });

  describe('mountViewer', () => {
    it('hides the content, adds one iframe for this PR, and unmount restores both', () => {
      injectTab(document, ref);
      const content = document.querySelector('#fixture-content')!;
      const host = mountViewer(document, ref);

      expect(viewers()).toHaveLength(1);
      expect(host.iframe.getAttribute('src')).toBe(
        EXT + 'viewer.html?pr=' + encodeURIComponent('dangh/pierre-sandbox#1'),
      );
      expect(host.iframe.src).toContain('pr=dangh%2Fpierre-sandbox%231');
      expect(host.iframe.style.height).toMatch(/^calc\(100vh - \d+px\)$/);
      expect(hiddenAncestor(content)).toBe(true);

      host.unmount();
      expect(viewers()).toHaveLength(0);
      expect(hiddenAncestor(content)).toBe(false);
      expect(bodyWithoutPierre()).toBe(original);
    });

    it('hands the bridge port to the page and the viewer port to the iframe', () => {
      document.documentElement.setAttribute('data-color-mode', 'dark');
      const host = mountViewer(document, ref);
      const framePost = vi.spyOn(host.iframe.contentWindow!, 'postMessage').mockImplementation(() => {});

      const bridgeCall = vi.mocked(window.postMessage).mock.calls[0]! as unknown as [unknown, string, unknown[]];
      expect(bridgeCall[0]).toEqual({ type: 'pierre:bridge-port' });
      expect(bridgeCall[1]).toBe(window.location.origin);
      expect(bridgeCall[2]).toHaveLength(1);

      host.iframe.dispatchEvent(new Event('load'));
      expect(framePost).toHaveBeenCalledTimes(1);
      const [msg, origin, transfer] = framePost.mock.calls[0] as unknown as [unknown, string, unknown[]];
      expect(msg).toEqual({ type: 'pierre:port', colorMode: 'dark' });
      expect(origin).toBe('chrome-extension://abcdefghijklmnop');
      expect(transfer).toHaveLength(1);
    });

    it('tells the bridge to reset on unmount', () => {
      const host = mountViewer(document, ref);
      host.unmount();
      expect(window.postMessage).toHaveBeenLastCalledWith({ type: 'pierre:bridge-reset' }, window.location.origin);
    });
  });

  describe('lifecycle', () => {
    it('does nothing visible to the page while Pierre is inactive, except adding the tab', () => {
      createLifecycle(window).sync();
      expect(pierreTabs()).toHaveLength(1);
      expect(viewers()).toHaveLength(0);
      expect(bodyWithoutPierre()).toBe(original);
    });

    it('mounts on #pierre, selects the tab, and unmounts when the hash goes', () => {
      const life = createLifecycle(window);
      life.sync();
      go('/dangh/pierre-sandbox/pull/1/changes#pierre');
      life.sync();
      expect(viewers()).toHaveLength(1);
      expect(pierreTabs()[0]!.getAttribute('aria-current')).toBe('page');
      expect(hiddenAncestor(document.querySelector('#fixture-content')!)).toBe(true);

      go('/dangh/pierre-sandbox/pull/1/changes');
      life.sync();
      expect(viewers()).toHaveLength(0);
      expect(pierreTabs()).toHaveLength(1);
      expect(bodyWithoutPierre()).toBe(original);
    });

    it('idempotent across soft-nav', () => {
      const life = createLifecycle(window);
      go('/dangh/pierre-sandbox/pull/1/changes#pierre');
      life.sync();
      // GitHub re-renders the tab nav: a fresh node without our tab.
      const nav = document.querySelector('nav')!;
      const fresh = nav.cloneNode(true) as HTMLElement;
      fresh.querySelectorAll('[data-pierre-tab]').forEach((e) => e.remove());
      nav.replaceWith(fresh);
      life.sync();
      life.sync();
      life.sync();
      expect(pierreTabs()).toHaveLength(1);
      expect(viewers()).toHaveLength(1);
      expect(fresh.contains(pierreTabs()[0]!)).toBe(true);
    });

    it('removes the tab and viewer when navigating away from the PR', () => {
      const life = createLifecycle(window);
      go('/dangh/pierre-sandbox/pull/1/changes#pierre');
      life.sync();
      expect(pierreTabs()).toHaveLength(1);
      go('/dangh/pierre-sandbox/issues/1');
      life.sync();
      expect(pierreTabs()).toHaveLength(0);
      expect(viewers()).toHaveLength(0);
      expect(bodyWithoutPierre()).toBe(original);
    });

    it('remounts when the PR changes', () => {
      const life = createLifecycle(window);
      go('/dangh/pierre-sandbox/pull/1/changes#pierre');
      life.sync();
      go('/dangh/pierre-sandbox/pull/2/changes#pierre');
      life.sync();
      expect(viewers()).toHaveLength(1);
      expect(viewers()[0]!.getAttribute('src')).toContain('pr=dangh%2Fpierre-sandbox%232');
    });

    it('clicking the tab stays on the current page, adds #pierre, and mounts without navigating', () => {
      const life = createLifecycle(window);
      life.start();
      const tab = pierreTabs()[0] as HTMLAnchorElement;
      const ev = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
      tab.dispatchEvent(ev);
      life.stop();
      expect(ev.defaultPrevented).toBe(true);
      expect(window.location.pathname).toBe('/dangh/pierre-sandbox/pull/1/changes');
      expect(window.location.hash).toBe('#pierre');
      expect(viewers()).toHaveLength(1);
    });

    it('leaves modified clicks to the browser', () => {
      const life = createLifecycle(window);
      life.start();
      const tab = pierreTabs()[0] as HTMLAnchorElement;
      const ev = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ctrlKey: true });
      tab.dispatchEvent(ev);
      life.stop();
      expect(ev.defaultPrevented).toBe(false);
      expect(viewers()).toHaveLength(0);
    });
  });
});

/** True when the node or any ancestor is display:none (jsdom computes inline styles). */
function hiddenAncestor(el: Element): boolean {
  for (let e: Element | null = el; e; e = e.parentElement) {
    if (getComputedStyle(e).display === 'none') return true;
  }
  return false;
}
