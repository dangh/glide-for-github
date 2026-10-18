// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScrollAnchor, ViewerScrollMessage } from '../../src/shared/page-scroll';
import { createPageScrollView, type ListAnchors } from '../../src/viewer/pageScroll';

const KEY = 'glide.scroll:test';
const EXTENT = 5000;

/** Delivers the MessageChannel messages posted so far (MessagePort delivery is a real macrotask, not a faked timer). */
const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
};

/** CodeView's root as the view sees it: a scroller with `EXTENT` px of range; scroll events are dispatched by the test. */
function fakeRoot() {
  const root = document.createElement('div');
  let top = 0;
  Object.defineProperty(root, 'scrollTop', { get: () => top, set: (v: number) => (top = Math.min(EXTENT, Math.max(0, v))) });
  Object.defineProperty(root, 'clientHeight', { get: () => 800 });
  Object.defineProperty(root, 'scrollHeight', { get: () => EXTENT + 800 });
  return root;
}

function setup(anchors: ListAnchors | null = null) {
  const root = fakeRoot();
  const view = createPageScrollView(window, 'page', KEY);
  const channel = new MessageChannel();
  const sent: ViewerScrollMessage[] = [];
  channel.port2.onmessage = (e) => sent.push(e.data as ViewerScrollMessage);
  view.setPort(channel.port1);
  view.attach(root, anchors);
  return {
    root,
    view,
    sent,
    port: channel.port2,
    /** The page's position: the list offset it maps to, whether the iframe is stuck, and the newest seq it applied. */
    page: (top: number, stuck: boolean, ack = 0) => channel.port2.postMessage({ type: 'scroll', top, stuck, ack }),
    wheel: (deltaY: number, at = { clientX: 400, clientY: 400 }) => root.dispatchEvent(new WheelEvent('wheel', { deltaY, ...at })),
    /** The list scrolled by itself (natively, or Pierre). */
    scrollList(top: number) {
      root.scrollTop = top;
      root.dispatchEvent(new Event('scroll'));
    },
    handOffs: () => sent.filter((m) => m.type === 'scrollBy'),
    scrollTos: () => sent.filter((m) => m.type === 'scrollTo'),
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  sessionStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('wheel hand-off', () => {
  it('a gesture that began while GitHub scrolled stays with GitHub after the iframe sticks: no hand-off at the list end', async () => {
    const s = setup();
    s.page(0, false);
    await flush();
    expect(s.root.style.overflowY).toBe('hidden');

    // Chrome latched this gesture to GitHub's page (the list could not scroll): the page scrolls itself.
    s.wheel(100);
    vi.advanceTimersByTime(50);
    s.page(0, true);
    await flush();
    s.wheel(100);
    vi.advanceTimersByTime(50);
    // Stuck, the list scrolls natively; Chrome keeps this gesture on GitHub's page, so its rubber band stays on.
    expect(s.root.style.overflowY).toBe('auto');
    expect(s.root.style.overscrollBehaviorY).toBe('');
    s.page(EXTENT, true);
    await flush();
    expect(s.root.scrollTop).toBe(EXTENT);
    // At the list's end the page goes on into the footer by itself; handing the wheel over too would scroll it twice.
    s.wheel(100);
    vi.advanceTimersByTime(50);
    s.wheel(100);
    await flush();
    expect(s.handOffs()).toEqual([]);
  });

  it('a gesture latched to the list hands the rest to the page at either end', async () => {
    const s = setup();
    s.page(1000, true);
    await flush();
    expect(s.root.style.overflowY).toBe('auto');
    s.wheel(-100);
    s.scrollList(0);
    s.wheel(-100);
    await flush();
    expect(s.handOffs()).toEqual([{ type: 'scrollBy', dy: -100 }]);

    vi.advanceTimersByTime(600);
    s.page(EXTENT - 50, true, s.scrollTos().at(-1)!.seq);
    await flush();
    s.wheel(100);
    s.scrollList(EXTENT);
    s.wheel(100);
    await flush();
    expect(s.handOffs().at(-1)).toEqual({ type: 'scrollBy', dy: 100 });
  });

  it('a gesture that began at the list edge is left to the browser (it chains it to the page)', async () => {
    const s = setup();
    s.page(EXTENT, true);
    await flush();
    s.wheel(100);
    s.wheel(100);
    await flush();
    expect(s.handOffs()).toEqual([]);
  });

  it('moving the pointer 10 px starts a new gesture, as in Chrome', async () => {
    const s = setup();
    s.page(EXTENT - 100, true);
    await flush();
    s.wheel(100, { clientX: 400, clientY: 400 });
    s.scrollList(EXTENT);
    s.wheel(100, { clientX: 400, clientY: 405 });
    await flush();
    expect(s.handOffs()).toEqual([{ type: 'scrollBy', dy: 100 }]);
    // A new gesture at the end: Chrome chains it to the page.
    s.wheel(100, { clientX: 400, clientY: 420 });
    await flush();
    expect(s.handOffs()).toHaveLength(1);
  });

  it('the list stops scrolling natively as soon as the iframe unsticks, mid-gesture too: a flick straight back down goes to the page', async () => {
    const s = setup();
    s.page(300, true);
    await flush();
    s.wheel(-100);
    s.scrollList(200);
    s.wheel(-200);
    s.scrollList(0);
    s.wheel(-100);
    await flush();
    expect(s.handOffs()).toEqual([{ type: 'scrollBy', dy: -100 }]);
    s.page(0, false, s.scrollTos().at(-1)!.seq); // GitHub's header is back
    await flush();
    expect(s.root.style.overflowY).toBe('hidden');

    // The flick back down, within the same gesture as far as the viewer can tell: the page takes it.
    s.wheel(100);
    await flush();
    expect(s.handOffs().at(-1)).toEqual({ type: 'scrollBy', dy: 100 });
    s.page(20, true, s.scrollTos().at(-1)!.seq);
    await flush();
    expect(s.root.style.overflowY).toBe('auto');
  });

  it("a gesture latched to the list turns the list's rubber band off until it ends; one the browser chains to the page does not", async () => {
    const s = setup();
    s.page(1000, true);
    await flush();
    expect(s.root.style.overscrollBehaviorY).toBe('');
    s.wheel(-100);
    expect(s.root.style.overscrollBehaviorY).toBe('none');
    s.scrollList(0);
    s.wheel(-100);
    vi.advanceTimersByTime(499);
    expect(s.root.style.overscrollBehaviorY).toBe('none');
    vi.advanceTimersByTime(1);
    expect(s.root.style.overscrollBehaviorY).toBe('');

    await flush();
    s.page(0, true, s.scrollTos().at(-1)!.seq);
    await flush();
    s.wheel(-100); // begins at the list's top
    expect(s.root.style.overscrollBehaviorY).toBe('');
  });
});

describe('page and list positions', () => {
  it('drops page positions older than its newest request, then follows the page again', async () => {
    const s = setup();
    s.page(0, true);
    await flush();
    s.scrollList(500);
    await flush();
    expect(s.scrollTos()).toEqual([{ type: 'scrollTo', top: 500, seq: 1 }]);
    s.page(0, true, 0); // computed before the page applied seq 1
    await flush();
    expect(s.root.scrollTop).toBe(500);
    s.page(500, true, 1);
    s.page(700, true, 1);
    await flush();
    expect(s.root.scrollTop).toBe(700);
  });

  it('a list move whose scroll event is still to come is sent before a page position overwrites it', async () => {
    const s = setup();
    s.page(0, true);
    await flush();
    s.root.scrollTop = 300; // Pierre kept the view in place as files above loaded
    s.page(0, true);
    await flush();
    expect(s.scrollTos()).toEqual([{ type: 'scrollTo', top: 300, seq: 1 }]);
    expect(s.root.scrollTop).toBe(300);
  });

  it('a new channel replaces the old one: the old port is closed, seq starts over, the extent is sent again', async () => {
    const s = setup();
    s.page(0, true);
    await flush();
    s.scrollList(400);
    await flush();
    expect(s.sent[0]).toEqual({ type: 'extent', extent: EXTENT });

    const next = new MessageChannel();
    const sent: ViewerScrollMessage[] = [];
    next.port2.onmessage = (e) => sent.push(e.data as ViewerScrollMessage);
    s.view.setPort(next.port1);
    s.page(0, false); // on the old channel: ignored
    await flush();
    expect(s.root.scrollTop).toBe(400);
    expect(sent).toEqual([{ type: 'extent', extent: EXTENT }]);

    next.port2.postMessage({ type: 'scroll', top: 400, stuck: true, ack: 0 });
    await flush();
    s.scrollList(900);
    await flush();
    expect(sent.at(-1)).toEqual({ type: 'scrollTo', top: 900, seq: 1 });
  });
});

describe("GitHub's header or footer on screen", () => {
  it('the list moving by itself goes back to the page position instead of pulling the page back', async () => {
    const s = setup();
    s.page(EXTENT, false); // footer on screen
    await flush();
    s.scrollList(EXTENT - 300); // Pierre keeping its view in place as files above load
    expect(s.root.scrollTop).toBe(EXTENT);
    s.root.scrollTop = EXTENT - 200; // the same, with its scroll event still to come
    s.page(EXTENT, false);
    await flush();
    expect(s.root.scrollTop).toBe(EXTENT);
    expect(s.scrollTos()).toEqual([]);
  });

  it('a scroll the user asked for moves the page, and so do the list moves that follow it until the page catches up', async () => {
    const s = setup();
    s.page(0, false); // header on screen
    await flush();
    s.view.expectListScroll();
    s.scrollList(1000);
    s.scrollList(1010); // Pierre settling on the file
    await flush();
    expect(s.scrollTos()).toEqual([
      { type: 'scrollTo', top: 1000, seq: 1 },
      { type: 'scrollTo', top: 1010, seq: 2 },
    ]);
    s.page(1010, true, 2);
    await flush();
    s.scrollList(1200);
    await flush();
    expect(s.scrollTos().at(-1)).toEqual({ type: 'scrollTo', top: 1200, seq: 3 });
  });

  it('an expected scroll that never came does not let a later list move through', async () => {
    const s = setup();
    s.page(0, false);
    await flush();
    s.view.expectListScroll();
    vi.advanceTimersByTime(500);
    s.scrollList(400);
    expect(s.root.scrollTop).toBe(0);
    expect(s.scrollTos()).toEqual([]);
  });

  it('a restored position moves the page', () => {
    sessionStorage.setItem(KEY, JSON.stringify({ path: 'src/b.ts', offset: 40 }));
    const root = fakeRoot();
    const view = createPageScrollView(window, 'page', KEY);
    const channel = new MessageChannel();
    view.setPort(channel.port1);
    view.attach(root, { anchor: () => null, scrollToAnchor: () => (root.scrollTop = 2000) });
    root.dispatchEvent(new Event('scroll'));
    expect(root.scrollTop).toBe(2000);
    channel.port1.close();
  });
});

describe('malformed page messages', () => {
  it('are ignored, including non-finite positions and acks', async () => {
    const s = setup();
    s.page(0, true);
    await flush();
    s.scrollList(500);
    await flush();
    for (const bad of [
      null,
      'scroll',
      { type: 'scroll', top: 0, stuck: true, ack: Infinity },
      { type: 'scroll', top: NaN, stuck: true, ack: 1 },
      { type: 'scroll', top: Infinity, stuck: true, ack: 1 },
      { type: 'scroll', top: -5, stuck: true, ack: 1 },
      { type: 'scroll', top: 0, stuck: 'no', ack: 1 },
      { type: 'scroll', top: 0, stuck: false },
    ]) {
      s.port.postMessage(bad);
    }
    await flush();
    expect(s.root.scrollTop).toBe(500);
    expect(s.root.style.overflowY).toBe('auto');
  });
});

describe('restore after reload', () => {
  const anchorsFor = (calls: ScrollAnchor[]): ListAnchors => ({ anchor: () => ({ path: 'a.ts', offset: 12 }), scrollToAnchor: (a) => calls.push(a) });

  it('restores the saved position once, on the first root', () => {
    sessionStorage.setItem(KEY, JSON.stringify({ path: 'src/b.ts', offset: 40 }));
    const calls: ScrollAnchor[] = [];
    const s = setup(anchorsFor(calls));
    expect(calls).toEqual([{ path: 'src/b.ts', offset: 40 }]);
    s.view.attach(null, null);
    s.view.attach(fakeRoot(), anchorsFor(calls));
    expect(calls).toHaveLength(1);
  });

  it('saves the position once scrolling pauses', async () => {
    const s = setup(anchorsFor([]));
    s.page(0, true);
    await flush();
    s.scrollList(100);
    expect(sessionStorage.getItem(KEY)).toBeNull();
    vi.advanceTimersByTime(300);
    expect(JSON.parse(sessionStorage.getItem(KEY)!)).toEqual({ path: 'a.ts', offset: 12 });
  });
});
