import { describe, expect, it } from 'vitest';
import { experimentsOf } from '../../src/shared/experiments';
import {
  listCanScroll,
  listScroll,
  pageScrollDelta,
  parseScrollAnchor,
  parseScrollLayout,
  ScrollRequests,
  scrollLayoutOf,
  stickySizes,
  wheelHandOff,
  wheelPixels,
} from '../../src/shared/page-scroll';

describe('scroll layout', () => {
  it('is frame unless page scrolling is on; the merged bar only counts with it', () => {
    expect(scrollLayoutOf({ pageScroll: false, mergedBar: false })).toBe('frame');
    expect(scrollLayoutOf({ pageScroll: false, mergedBar: true })).toBe('frame');
    expect(scrollLayoutOf({ pageScroll: true, mergedBar: false })).toBe('page');
    expect(scrollLayoutOf({ pageScroll: true, mergedBar: true })).toBe('merged');
  });

  it('round-trips through the viewer URL, anything unknown is frame', () => {
    expect(parseScrollLayout('?pr=a%2Fb%231&scroll=page')).toBe('page');
    expect(parseScrollLayout('?pr=a%2Fb%231&scroll=merged')).toBe('merged');
    expect(parseScrollLayout('?pr=a%2Fb%231')).toBe('frame');
    expect(parseScrollLayout('?scroll=frame')).toBe('frame');
    expect(parseScrollLayout('?scroll=sideways')).toBe('frame');
  });

  it('reads the experiments from a stored settings item; anything but true is off', () => {
    expect(experimentsOf(undefined)).toEqual({ pageScroll: false, mergedBar: false });
    expect(experimentsOf({ diff: {} })).toEqual({ pageScroll: false, mergedBar: false });
    expect(experimentsOf({ experiments: { pageScroll: 'true', mergedBar: 1 } })).toEqual({ pageScroll: false, mergedBar: false });
    expect(experimentsOf({ experiments: { pageScroll: true, mergedBar: true } })).toEqual({ pageScroll: true, mergedBar: true });
  });
});

describe('page position to list offset', () => {
  const STICK = 60;
  const EXTENT = 5000;

  it('is 0 and not stuck while the wrapper is below its stick point', () => {
    expect(listScroll(261, STICK, EXTENT)).toEqual({ top: 0, stuck: false });
    expect(listScroll(61, STICK, EXTENT)).toEqual({ top: 0, stuck: false });
  });

  it('follows the page pixel for pixel while stuck, including both ends', () => {
    expect(listScroll(60, STICK, EXTENT)).toEqual({ top: 0, stuck: true });
    expect(listScroll(60.4, STICK, EXTENT)).toEqual({ top: 0, stuck: true });
    expect(listScroll(-940, STICK, EXTENT)).toEqual({ top: 1000, stuck: true });
    expect(listScroll(60 - EXTENT, STICK, EXTENT)).toEqual({ top: EXTENT, stuck: true });
  });

  it('stays at the end and lets go once the page scrolls past it (GitHub footer)', () => {
    expect(listScroll(60 - EXTENT - 300, STICK, EXTENT)).toEqual({ top: EXTENT, stuck: false });
  });

  it('pageScrollDelta brings the page to a list offset: listScroll after the scroll reads it back', () => {
    for (const [wrapperTop, listTop] of [
      [261, 0],
      [261, 1234],
      [-940, 0],
      [-940, 4999],
      [60, 300],
    ] as const) {
      const dy = pageScrollDelta(wrapperTop, STICK, listTop);
      expect(listScroll(wrapperTop - dy, STICK, EXTENT)).toEqual({ top: listTop, stuck: true });
    }
    expect(pageScrollDelta(60 - 500, STICK, 500)).toBe(0);
  });

  it('sizes the wrapper as the iframe plus the list range', () => {
    expect(stickySizes(60, 5000)).toEqual({ wrapper: 'calc(100vh - 60px + 5000px)', iframe: 'calc(100vh - 60px)' });
    expect(stickySizes(0, 0)).toEqual({ wrapper: 'calc(100vh - 0px + 0px)', iframe: 'calc(100vh - 0px)' });
  });
});

describe('wheel hand-off', () => {
  it('converts line and page deltas to pixels', () => {
    expect(wheelPixels(-3, 1, 800)).toBe(-120);
    expect(wheelPixels(1, 2, 800)).toBe(800);
    expect(wheelPixels(53, 0, 800)).toBe(53);
  });

  it('knows when the list can still move in the wheel direction', () => {
    expect(listCanScroll(-100, 0, 5000)).toBe(false);
    expect(listCanScroll(-100, 0.3, 5000)).toBe(false);
    expect(listCanScroll(-100, 10, 5000)).toBe(true);
    expect(listCanScroll(100, 5000, 5000)).toBe(false);
    expect(listCanScroll(100, 4999.8, 5000)).toBe(false);
    expect(listCanScroll(100, 4000, 5000)).toBe(true);
    expect(listCanScroll(0, 100, 5000)).toBe(false);
  });

  it('hands a latched gesture to the page at the top (header comes back) and the bottom (footer comes in)', () => {
    expect(wheelHandOff(true, true, -100, 0, 5000)).toBe(-100);
    expect(wheelHandOff(true, true, 100, 5000, 5000)).toBe(100);
    expect(wheelHandOff(true, true, -100, 300, 5000)).toBe(0);
    expect(wheelHandOff(true, true, 100, 300, 5000)).toBe(0);
  });

  it('hands all of a latched gesture to the page once the iframe is no longer stuck', () => {
    expect(wheelHandOff(true, false, -100, 5000, 5000)).toBe(-100);
    expect(wheelHandOff(true, false, 100, 0, 5000)).toBe(100);
  });

  it('leaves a gesture that started at the edge or on the page to the browser, which chains it to the page already', () => {
    expect(wheelHandOff(false, true, -100, 0, 5000)).toBe(0);
    expect(wheelHandOff(false, true, 100, 5000, 5000)).toBe(0);
    expect(wheelHandOff(false, false, 100, 5000, 5000)).toBe(0);
  });
});

describe('seq/ack ordering', () => {
  it('ignores page positions older than the newest viewer request until the page acknowledges it', () => {
    const requests = new ScrollRequests();
    expect(requests.current(0)).toBe(true);
    const a = requests.request();
    const b = requests.request();
    expect(requests.current(0)).toBe(false);
    expect(requests.current(a)).toBe(false);
    expect(requests.current(b)).toBe(true);
  });

  it('starts over with a new channel', () => {
    const requests = new ScrollRequests();
    requests.request();
    requests.request();
    requests.reset();
    expect(requests.current(0)).toBe(true);
    expect(requests.request()).toBe(1);
  });
});

describe('scroll anchor (restored after reload)', () => {
  it('accepts a path with a finite offset and nothing else', () => {
    expect(parseScrollAnchor(JSON.stringify({ path: 'src/a.ts', offset: -12.5 }))).toEqual({ path: 'src/a.ts', offset: -12.5 });
    expect(parseScrollAnchor(null)).toBeNull();
    expect(parseScrollAnchor('not json')).toBeNull();
    expect(parseScrollAnchor('null')).toBeNull();
    expect(parseScrollAnchor(JSON.stringify({ path: '', offset: 0 }))).toBeNull();
    expect(parseScrollAnchor(JSON.stringify({ path: 'a', offset: '3' }))).toBeNull();
  });
});
