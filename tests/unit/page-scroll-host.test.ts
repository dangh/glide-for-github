// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://github.com/dangh/pierre-sandbox/pull/1#glide"}
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountViewer, setExtensionUrlResolver } from '../../src/content/host';
import { createPageScroll } from '../../src/content/page-scroll';
import { createLifecycle } from '../../src/content/lifecycle';
import { DEFAULT_CONTENT_SETTINGS, type SettingsSource } from '../../src/content/settings-source';
import type { PageScrollMessage, ScrollLayout } from '../../src/shared/page-scroll';
import type { PrRef } from '../../src/shared/pr-url';

const ref: PrRef = { owner: 'dangh', repo: 'pierre-sandbox', number: 1, page: 'changes' };
const EXT = 'chrome-extension://abcdefghijklmnop/';
const STICKY_STYLE = 'position: sticky; display: none';

const rect = (top: number, height: number) => ({ top, height, bottom: top + height, left: 0, right: 0, width: 0, x: 0, y: top, toJSON() {} }) as DOMRect;

/** Adds GitHub's sticky PR header (hidden until the title scrolls away; 60 px when shown) to the layout header. */
function addStickyHeader(): HTMLElement {
  const header = document.createElement('div');
  header.setAttribute('data-component', 'PageHeader');
  header.setAttribute('style', STICKY_STYLE);
  header.getBoundingClientRect = () => rect(0, header.style.display === 'flex' ? 60 : 0);
  document.querySelector('header')!.append(header);
  return header;
}

let original: string;
let wrapperTop = 261;

beforeEach(() => {
  setExtensionUrlResolver((path) => EXT + path);
  vi.spyOn(window, 'postMessage').mockImplementation(() => {});
  document.body.innerHTML = readFileSync(resolve(__dirname, '../fixtures/dom/pr-tabs-new.html'), 'utf8');
  original = document.body.innerHTML;
  wrapperTop = 261;
  vi.spyOn(HTMLDivElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLDivElement) {
    return this.hasAttribute('data-glide-scroll') ? rect(wrapperTop, 0) : rect(0, 0);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

/** Loads the iframe and returns the viewer's end of the scroll channel and the messages the page sent on it. */
function connectViewer(iframe: HTMLIFrameElement) {
  const framePost = vi.spyOn(iframe.contentWindow!, 'postMessage').mockImplementation(() => {});
  iframe.dispatchEvent(new Event('load'));
  const transfer = (framePost.mock.calls.at(-1) as unknown as [unknown, string, MessagePort[]])[2];
  const port = transfer[1]!;
  const received: PageScrollMessage[] = [];
  port.onmessage = (e) => received.push(e.data as PageScrollMessage);
  return { transfer, port, received };
}

const settle = () => new Promise((r) => setTimeout(r, 20));

describe('page layout', () => {
  it('puts the iframe in a wrapper, sticky below GitHub\'s header, and unmount restores the page exactly', async () => {
    const header = addStickyHeader();
    const before = document.body.innerHTML;
    const host = mountViewer(document, ref, 'page');
    const wrapper = document.querySelector<HTMLElement>('[data-glide-scroll="page"]')!;
    expect(host.iframe.parentElement).toBe(wrapper);
    expect(host.iframe.getAttribute('src')).toBe(EXT + 'viewer.html?pr=' + encodeURIComponent('dangh/pierre-sandbox#1') + '&scroll=page');
    expect(host.iframe.style.position).toBe('sticky');
    expect(host.iframe.style.top).toBe('60px');
    expect(host.iframe.style.height).toBe('calc(100vh - 60px)');
    expect(header.getAttribute('style')).toBe(STICKY_STYLE);

    host.unmount();
    expect(document.querySelector('[data-glide-scroll]')).toBeNull();
    expect(document.body.innerHTML).toBe(before);
  });

  it('hands the viewer a scroll channel; extents size the wrapper and page scrolls map to list offsets', async () => {
    addStickyHeader();
    const host = mountViewer(document, ref, 'page');
    const wrapper = host.iframe.parentElement!;
    const { transfer, port, received } = connectViewer(host.iframe);
    expect(transfer).toHaveLength(2);

    port.postMessage({ type: 'extent', extent: 5000 });
    await settle();
    // (calc() terms are re-ordered when serialized)
    expect(wrapper.style.height).toMatch(/^calc\(.*5000px.*\)$/);
    expect(wrapper.style.height).toContain('100vh - 60px');

    wrapperTop = 60 - 1200;
    window.dispatchEvent(new Event('scroll'));
    await settle();
    expect(received.at(-1)).toEqual({ type: 'scroll', top: 1200, stuck: true, ack: 0 });
    host.unmount();
  });

  it('a list scroll moves the page to the same offset and acknowledges it, also when the page cannot move', async () => {
    addStickyHeader();
    const host = mountViewer(document, ref, 'page');
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(((opts: ScrollToOptions) => {
      wrapperTop -= opts.top ?? 0;
    }) as typeof window.scrollBy);
    const { port, received } = connectViewer(host.iframe);
    port.postMessage({ type: 'extent', extent: 5000 });

    port.postMessage({ type: 'scrollTo', top: 700, seq: 1 });
    await settle();
    expect(scrollBy).toHaveBeenLastCalledWith({ top: 261 - 60 + 700, behavior: 'instant' });
    expect(received.at(-1)).toEqual({ type: 'scroll', top: 700, stuck: true, ack: 1 });

    // Already there: no scroll, but the ack still arrives.
    scrollBy.mockClear();
    port.postMessage({ type: 'scrollTo', top: 700, seq: 2 });
    await settle();
    expect(scrollBy).not.toHaveBeenCalled();
    expect(received.at(-1)).toEqual({ type: 'scroll', top: 700, stuck: true, ack: 2 });

    // The rest of a wheel gesture at the list's end goes to the page as it is.
    port.postMessage({ type: 'scrollBy', dy: 120 });
    await settle();
    expect(scrollBy).toHaveBeenLastCalledWith({ top: 120, behavior: 'instant' });
    host.unmount();
  });

  it('ignores malformed messages on the scroll channel: no resize, no scroll, no ack', async () => {
    const host = mountViewer(document, ref, 'page');
    const wrapper = host.iframe.parentElement!;
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
    const { port, received } = connectViewer(host.iframe);
    await settle();
    const height = wrapper.style.height;
    const before = received.length;
    for (const bad of [
      null,
      'x',
      { type: 'other' },
      { type: 'extent', extent: -1 },
      { type: 'extent', extent: 'big' },
      { type: 'extent', extent: Infinity },
      { type: 'extent', extent: NaN },
      { type: 'scrollTo', top: 1 },
      { type: 'scrollTo', top: NaN, seq: 1 },
      { type: 'scrollTo', top: 1, seq: Infinity },
      { type: 'scrollBy', dy: Infinity },
      { type: 'scrollBy', dy: -Infinity },
      { type: 'scrollBy', dy: NaN },
      { type: 'scrollBy' },
    ]) {
      port.postMessage(bad);
    }
    await settle();
    expect(wrapper.style.height).toBe(height);
    expect(scrollBy).not.toHaveBeenCalled();
    expect(received.length).toBe(before);
    host.unmount();
  });

  it('sticks at the top when GitHub has no sticky header (no hiding, nothing to measure)', () => {
    const host = mountViewer(document, ref, 'page');
    expect(host.iframe.style.top).toBe('0px');
    host.unmount();
    expect(document.body.innerHTML).toBe(original);
  });
});

describe('merged layout', () => {
  it("hides GitHub's sticky header while mounted, sticks at 0, and restores the header on unmount", () => {
    const header = addStickyHeader();
    const host = mountViewer(document, ref, 'merged');
    expect(host.iframe.getAttribute('src')).toContain('&scroll=merged');
    expect(header.style.getPropertyValue('display')).toBe('none');
    expect(header.style.getPropertyPriority('display')).toBe('important');
    expect(host.iframe.style.top).toBe('0px');

    // GitHub re-rendered its header: the new one is hidden too.
    header.remove();
    const again = addStickyHeader();
    expect(host.refresh()).toBe(true);
    expect(again.style.getPropertyPriority('display')).toBe('important');

    host.unmount();
    expect(again.getAttribute('style')).toBe(STICKY_STYLE);
  });

  it('without a header to hide it falls back to the page layout (nothing hidden)', () => {
    const host = mountViewer(document, ref, 'merged');
    expect(host.iframe.style.top).toBe('0px');
    host.unmount();
    expect(document.body.innerHTML).toBe(original);
  });
});

describe('lifecycle with a layout source', () => {
  function source(initial: ScrollLayout | undefined) {
    let layout = initial;
    const listeners = new Set<() => void>();
    const src: SettingsSource = {
      get: () => layout && { ...DEFAULT_CONTENT_SETTINGS, layout },
      subscribe(fn) {
        listeners.add(fn);
        return () => void listeners.delete(fn);
      },
    };
    return {
      src,
      set(next: ScrollLayout) {
        layout = next;
        for (const fn of listeners) fn();
      },
    };
  }

  it('waits for the layout, mounts in it, and remounts when it changes', () => {
    const s = source(undefined);
    const life = createLifecycle(window, s.src);
    life.start();
    expect(document.querySelector('iframe[data-pierre-viewer]')).toBeNull();
    expect(document.querySelector('[data-pierre-tab]')).not.toBeNull();

    s.set('page');
    const first = document.querySelector('iframe[data-pierre-viewer]')!;
    expect(first.parentElement!.getAttribute('data-glide-scroll')).toBe('page');

    s.set('frame');
    const second = document.querySelector('iframe[data-pierre-viewer]')!;
    expect(second).not.toBe(first);
    expect(document.querySelector('[data-glide-scroll]')).toBeNull();
    expect(second.getAttribute('src')).not.toContain('scroll=');
    life.stop();
  });
});

describe('page scroll channel', () => {
  function create() {
    const anchor = document.createElement('div');
    document.body.append(anchor);
    const iframe = document.createElement('iframe');
    const scroll = createPageScroll(document, anchor, iframe, 'page');
    document.body.append(scroll.wrapper);
    return scroll;
  }
  function channel(scroll: ReturnType<typeof create>) {
    const c = new MessageChannel();
    const received: PageScrollMessage[] = [];
    c.port1.onmessage = (e) => received.push(e.data as PageScrollMessage);
    scroll.connect(c.port2);
    return { port: c.port1, received };
  }
  let scrollY = 0;
  let now = 1000;
  beforeEach(() => {
    scrollY = 0;
    now = 1000;
    Object.defineProperty(window, 'scrollY', { configurable: true, get: () => scrollY });
    vi.spyOn(performance, 'now').mockImplementation(() => now);
  });
  /** GitHub's page moving: `wrapperTop` follows `scrollY`. */
  const moveTo = (y: number) => {
    wrapperTop -= y - scrollY;
    scrollY = y;
  };

  it('a new channel replaces the old one: the old port is closed and acks start over', async () => {
    const scroll = create();
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(((o: ScrollToOptions) => moveTo(scrollY + (o.top ?? 0))) as typeof window.scrollBy);
    const a = channel(scroll);
    a.port.postMessage({ type: 'extent', extent: 5000 });
    a.port.postMessage({ type: 'scrollTo', top: 300, seq: 7 });
    await settle();
    expect(a.received.at(-1)).toMatchObject({ ack: 7 });

    const b = channel(scroll);
    await settle();
    expect(b.received).toEqual([{ type: 'scroll', top: 300, stuck: true, ack: 0 }]);
    scrollBy.mockClear();
    a.port.postMessage({ type: 'scrollBy', dy: 100 });
    await settle();
    expect(scrollBy).not.toHaveBeenCalled();
    scroll.dispose();
  });

  it('after dispose nothing is posted and the channel is closed', async () => {
    const scroll = create();
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
    const { port, received } = channel(scroll);
    await settle();
    const before = received.length;
    scroll.dispose();
    wrapperTop = -500;
    window.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new Event('resize'));
    port.postMessage({ type: 'scrollBy', dy: 100 });
    await settle();
    expect(received.length).toBe(before);
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it("drops a wheel hand-off while GitHub's page is scrolling by itself, not after its own scrolls", async () => {
    const scroll = create();
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(((o: ScrollToOptions) => moveTo(scrollY + (o.top ?? 0))) as typeof window.scrollBy);
    const { port } = channel(scroll);
    port.postMessage({ type: 'extent', extent: 5000 });

    // A scroll the viewer asked for is the page's own.
    port.postMessage({ type: 'scrollTo', top: 300, seq: 1 });
    await settle();
    window.dispatchEvent(new Event('scroll'));
    port.postMessage({ type: 'scrollBy', dy: 100 });
    await settle();
    expect(scrollBy).toHaveBeenLastCalledWith({ top: 100, behavior: 'instant' });

    // The page scrolled itself (Chrome latched the gesture to it): the hand-off would scroll it twice.
    scrollBy.mockClear();
    moveTo(scrollY + 120);
    window.dispatchEvent(new Event('scroll'));
    now += 50;
    port.postMessage({ type: 'scrollBy', dy: 100 });
    await settle();
    expect(scrollBy).not.toHaveBeenCalled();

    now += 200;
    port.postMessage({ type: 'scrollBy', dy: 100 });
    await settle();
    expect(scrollBy).toHaveBeenCalledOnce();
    scroll.dispose();
  });
});
