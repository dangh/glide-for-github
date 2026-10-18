// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://github.com/dangh/pierre-sandbox/pull/1/changes"}
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { injectTab, removeTab, setTabActive } from '../../src/content/tab';
import { mountViewer, setExtensionUrlResolver } from '../../src/content/host';
import { createLifecycle } from '../../src/content/lifecycle';
import { glideUrl, type PrRef } from '../../src/shared/pr-url';

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
    it('draws the Glide mark (a diff "+" over an arrow) as one filled path in the tab color', () => {
      const paths = [...injectTab(document, ref)!.querySelectorAll('svg path')];
      expect(paths).toHaveLength(1);
      expect(paths[0]!.getAttribute('d')).toMatch(/^M7 1\.5H8\.5/);
      expect(paths[0]!.getAttribute('fill')).toBe('currentColor');
    });

    it('inserts the Glide tab directly after Files changed', () => {
      const tab = injectTab(document, ref);
      const files = document.querySelector(filesTab)!;
      expect(tab).not.toBeNull();
      expect(files.nextElementSibling).toBe(tab);
      expect(tab!.textContent).toContain('Glide');
      expect(tab!.getAttribute('href')).toBe(glideUrl(ref));
      expect(tab!.hasAttribute('data-pierre-tab')).toBe(true);
    });

    it('copies the tab classes but not selection or id', () => {
      const tab = injectTab(document, ref)!;
      const files = document.querySelector(filesTab)!;
      expect(tab.id).toBe('');
      expect(tab.hasAttribute('aria-current')).toBe(false);
      expect(tab.className).not.toMatch(/selected/);
      const filesClasses = [...files.classList].filter((c) => !/^selected/.test(c));
      for (const c of filesClasses) expect(tab.classList.contains(c)).toBe(true);
    });

    it("shows Files changed's file count (and its screen-reader copy), without its id", () => {
      const tab = injectTab(document, ref)!;
      const files = document.querySelector(filesTab)!;
      const count = files.querySelector('[data-component="CounterLabel"], .Counter')!.textContent;
      const counter = tab.querySelector('[data-pierre-counter]')!;
      expect(counter.textContent).toBe(count);
      expect(counter.id).toBe('');
      expect(tab.textContent!.replace(/\s+/g, ' ')).toContain(`Glide${count}`);
      if (files.querySelector('[class*="VisuallyHidden"]')) expect(tab.querySelectorAll('[data-pierre-counter]')).toHaveLength(2);
    });

    it('follows Files changed when GitHub updates its count', () => {
      const tab = injectTab(document, ref)!;
      const counter = document.querySelector(filesTab)!.querySelector('[data-component="CounterLabel"], .Counter')!;
      counter.textContent = '21';
      injectTab(document, ref);
      expect(tab.querySelector('[data-pierre-counter]')!.textContent).toBe('21');
      expect(tab.querySelectorAll('[data-pierre-counter]').length).toBeLessThanOrEqual(2);
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
    it('moves the selected styling to Glide and restores it exactly', () => {
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

    it('does not re-select a tab GitHub already moved away from while Glide was active', () => {
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
      expect(host.iframe.style.minHeight).toBe('320px');
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

    it('sizes the viewer to end at the bottom of the viewport, from its own top', () => {
      const rect = vi.spyOn(HTMLIFrameElement.prototype, 'getBoundingClientRect');
      rect.mockReturnValue({ top: 261.4, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 261.4, toJSON() {} } as DOMRect);
      const host = mountViewer(document, ref);
      expect(host.iframe.style.height).toBe('calc(100vh - 261px)');

      // Layout above the viewer changed (GitHub re-rendered the header): resize and refresh re-measure.
      rect.mockReturnValue({ top: 300, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 300, toJSON() {} } as DOMRect);
      window.dispatchEvent(new Event('resize'));
      expect(host.iframe.style.height).toBe('calc(100vh - 300px)');
      host.unmount();
    });

    it('tells the bridge to reset on unmount', () => {
      const host = mountViewer(document, ref);
      host.unmount();
      expect(window.postMessage).toHaveBeenLastCalledWith({ type: 'pierre:bridge-reset' }, window.location.origin);
    });

    describe('bridge-ready handshake (bridge loaded after mount)', () => {
      const bridgeCalls = () =>
        vi.mocked(window.postMessage).mock.calls.filter(
          (c) => (c[0] as { type?: string }).type === 'pierre:bridge-port',
        ) as unknown as [unknown, string, MessagePort[]][];

      it('re-creates the channel once and re-sends a fresh port to both the bridge and the viewer', () => {
        document.documentElement.setAttribute('data-color-mode', 'light');
        const host = mountViewer(document, ref);
        const framePost = vi.spyOn(host.iframe.contentWindow!, 'postMessage').mockImplementation(() => {});
        host.iframe.dispatchEvent(new Event('load'));
        expect(bridgeCalls()).toHaveLength(1);
        expect(framePost).toHaveBeenCalledTimes(1);

        deliverMessage({ type: 'pierre:bridge-ready' });

        // A reset goes first so a bridge that already accepted the first port takes the new one.
        expect(vi.mocked(window.postMessage).mock.calls.map((c) => (c[0] as { type: string }).type)).toEqual([
          'pierre:bridge-port',
          'pierre:bridge-reset',
          'pierre:bridge-port',
        ]);
        expect(bridgeCalls()).toHaveLength(2);
        expect(bridgeCalls()[1]![1]).toBe(window.location.origin);
        expect(bridgeCalls()[1]![2]).toHaveLength(1);
        expect(framePost).toHaveBeenCalledTimes(2);
        const [msg, origin, transfer] = framePost.mock.calls[1] as unknown as [unknown, string, unknown[]];
        expect(msg).toEqual({ type: 'pierre:port', colorMode: 'light' });
        expect(origin).toBe('chrome-extension://abcdefghijklmnop');
        expect(transfer).toHaveLength(1);
        // The two sides got ends of the same new channel, distinct from the first handshake's.
        expect(transfer[0]).not.toBe((framePost.mock.calls[0] as unknown as [unknown, string, unknown[]])[2][0]);
        host.unmount();
      });

      it('before the iframe has loaded, re-sends only to the bridge; the load then delivers the newest port', () => {
        const host = mountViewer(document, ref);
        const framePost = vi.spyOn(host.iframe.contentWindow!, 'postMessage').mockImplementation(() => {});
        deliverMessage({ type: 'pierre:bridge-ready' });
        expect(bridgeCalls()).toHaveLength(2);
        expect(framePost).not.toHaveBeenCalled();
        host.iframe.dispatchEvent(new Event('load'));
        expect(framePost).toHaveBeenCalledTimes(1);
        host.unmount();
      });

      it.each([
        ['foreign origin', { origin: 'https://evil.example' }],
        ['another source', { source: {} }],
      ])('ignores bridge-ready from a %s', (_n, opts) => {
        const host = mountViewer(document, ref);
        deliverMessage({ type: 'pierre:bridge-ready' }, opts);
        expect(bridgeCalls()).toHaveLength(1);
        host.unmount();
      });

      it('does nothing once unmounted', () => {
        const host = mountViewer(document, ref);
        host.unmount();
        deliverMessage({ type: 'pierre:bridge-ready' });
        expect(bridgeCalls()).toHaveLength(1);
      });

      it('does nothing when no viewer is mounted', () => {
        deliverMessage({ type: 'pierre:bridge-ready' });
        expect(bridgeCalls()).toHaveLength(0);
      });
    });
  });

  describe('lifecycle', () => {
    it('does nothing visible to the page while Glide is inactive, except adding the tab', () => {
      createLifecycle(window).sync();
      expect(pierreTabs()).toHaveLength(1);
      expect(viewers()).toHaveLength(0);
      expect(bodyWithoutPierre()).toBe(original);
    });

    it('mounts on #pierre, selects the tab, and unmounts when the hash goes', () => {
      const life = createLifecycle(window);
      life.sync();
      go('/dangh/pierre-sandbox/pull/1/changes#glide');
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

    it('still mounts on the old #pierre hash (links made before the rename)', () => {
      const life = createLifecycle(window);
      go('/dangh/pierre-sandbox/pull/1/changes#pierre');
      life.sync();
      expect(viewers()).toHaveLength(1);
      expect(pierreTabs()[0]!.getAttribute('aria-current')).toBe('page');
    });

    it('idempotent across soft-nav', () => {
      const life = createLifecycle(window);
      go('/dangh/pierre-sandbox/pull/1/changes#glide');
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
      go('/dangh/pierre-sandbox/pull/1/changes#glide');
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
      go('/dangh/pierre-sandbox/pull/1/changes#glide');
      life.sync();
      go('/dangh/pierre-sandbox/pull/2/changes#glide');
      life.sync();
      expect(viewers()).toHaveLength(1);
      expect(viewers()[0]!.getAttribute('src')).toContain('pr=dangh%2Fpierre-sandbox%232');
    });

    it('keeps observing after Turbo replaces document.body', async () => {
      const life = createLifecycle(window);
      life.start();
      expect(pierreTabs()).toHaveLength(1);

      // Turbo Drive swaps in a brand new <body>; the nav renders into it later with no event.
      const newBody = document.createElement('body');
      document.documentElement.replaceChild(newBody, document.body);
      expect(pierreTabs()).toHaveLength(0);
      await new Promise((r) => setTimeout(r, 80));

      newBody.innerHTML = fixture(file);
      await new Promise((r) => setTimeout(r, 150));
      life.stop();
      expect(pierreTabs()).toHaveLength(1);
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
      expect(window.location.hash).toBe('#glide');
      expect(viewers()).toHaveLength(1);
    });

    describe('a press whose click is lost while GitHub re-renders the tab strip', () => {
      const RECT = { left: 100, right: 180, top: 10, bottom: 40, width: 80, height: 30, x: 100, y: 10 };
      const pointer = (type: string, x: number, y: number) =>
        new (window.PointerEvent ?? MouseEvent)(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y });
      const tick = () => new Promise((r) => setTimeout(r, 0));
      const pressTab = () => {
        const tab = pierreTabs()[0] as HTMLAnchorElement;
        vi.spyOn(tab, 'getBoundingClientRect').mockReturnValue({ ...RECT, toJSON: () => RECT } as DOMRect);
        const down = pointer('pointerdown', 140, 25);
        tab.dispatchEvent(down);
        return Object.assign(tab, { pressedAt: down.timeStamp });
      };

      it('opens Glide when the tab was re-injected between pointerdown and pointerup (no click on it)', async () => {
        const life = createLifecycle(window);
        life.start();
        const tab = pressTab();
        tab.remove(); // GitHub re-rendered the strip; our tab comes back as a new element
        life.sync();
        expect(pierreTabs()[0]).not.toBe(tab);
        document.body.dispatchEvent(pointer('pointerup', 141, 26));
        document.body.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })); // lands elsewhere
        expect(window.location.hash).toBe('');
        await tick();
        expect(window.location.hash).toBe('#glide');
        expect(window.location.pathname).toBe('/dangh/pierre-sandbox/pull/1/changes');
        expect(viewers()).toHaveLength(1);
        life.stop();
      });

      it('a normal press and click activates once', async () => {
        const life = createLifecycle(window);
        life.start();
        const push = vi.spyOn(window.history, 'pushState');
        const tab = pressTab();
        tab.dispatchEvent(pointer('pointerup', 140, 25));
        tab.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
        await tick();
        expect(push).toHaveBeenCalledTimes(1);
        expect(window.location.hash).toBe('#glide');
        expect(viewers()).toHaveLength(1);
        life.stop();
      });

      it('a release outside the pressed tab, or long after, does nothing', async () => {
        const life = createLifecycle(window);
        life.start();
        pressTab();
        document.body.dispatchEvent(pointer('pointerup', 300, 25)); // dragged away
        await tick();
        expect(window.location.hash).toBe('');
        const tab = pressTab();
        const late = pointer('pointerup', 140, 25);
        Object.defineProperty(late, 'timeStamp', { value: tab.pressedAt + 5_000 });
        tab.dispatchEvent(late);
        await tick();
        expect(window.location.hash).toBe('');
        expect(viewers()).toHaveLength(0);
        life.stop();
      });
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

/** Delivers a `message` event to the window the way the browser does for window.postMessage. */
function deliverMessage(data: unknown, opts: { source?: unknown; origin?: string } = {}): void {
  const ev = new Event('message');
  Object.defineProperties(ev, {
    data: { value: data },
    source: { value: 'source' in opts ? opts.source : window },
    origin: { value: opts.origin ?? window.location.origin },
  });
  window.dispatchEvent(ev);
}

/** True when the node or any ancestor is display:none (jsdom computes inline styles). */
function hiddenAncestor(el: Element): boolean {
  for (let e: Element | null = el; e; e = e.parentElement) {
    if (getComputedStyle(e).display === 'none') return true;
  }
  return false;
}

describe('pages without a Glide tab are not scanned', () => {
  const manyLinks = () => {
    document.body.innerHTML = `<main>${Array.from({ length: 200 }, (_, i) => `<a href="/x/${i}">link ${i}</a>`).join('')}</main>`;
  };
  /** Counts the `querySelectorAll('a')` scans of every link on the page. */
  const linkScans = () => {
    let scans = 0;
    for (const proto of [Document.prototype, Element.prototype]) {
      const original = proto.querySelectorAll;
      vi.spyOn(proto, 'querySelectorAll').mockImplementation(function (this: ParentNode, selectors: string) {
        if (selectors === 'a') scans++;
        return original.call(this, selectors);
      } as typeof proto.querySelectorAll);
    }
    return () => scans;
  };

  it('removeTab returns early when there is no Glide tab', () => {
    manyLinks();
    const scans = linkScans();
    removeTab(document);
    removeTab(document);
    expect(scans()).toBe(0);
  });

  it('a lifecycle sync on a non-PR page does not scan the links', () => {
    manyLinks();
    go('/dangh/pierre-sandbox/issues/1');
    const lifecycle = createLifecycle();
    const scans = linkScans();
    lifecycle.sync();
    lifecycle.sync();
    expect(scans()).toBe(0);
  });

  it('still removes the tab and restores the tabs it had unselected when the Glide tab is there', () => {
    document.body.innerHTML = fixture('pr-tabs-new.html');
    const original = document.body.innerHTML;
    injectTab(document, ref);
    setTabActive(document, true);
    removeTab(document);
    expect(pierreTabs()).toHaveLength(0);
    expect(document.body.innerHTML).toBe(original);
  });

  it('restores tabs left unselected even when GitHub re-rendered the Glide tab away', () => {
    document.body.innerHTML = fixture('pr-tabs-new.html');
    const original = document.body.innerHTML;
    injectTab(document, ref);
    setTabActive(document, true);
    document.querySelector('[data-pierre-tab]')!.remove();
    removeTab(document);
    expect(document.body.innerHTML).toBe(original);
  });
});
