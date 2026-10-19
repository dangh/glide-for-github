// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createScrollPosition } from '../../src/inpage/scrollPosition';
import { usePageScroll, type ListAnchors } from '../../src/viewer/pageScroll';
import { usePr } from '../../src/viewer/state/store';
import { session } from '../../src/viewer/state/session';
import { createLoader } from '../../src/viewer/state/loader';
import { fetchPrData } from '../../src/viewer/github/private';
import { fakeRpc, ref } from './sandbox-fixtures';

const KEY = 'glide.scroll:o/r#1';
const root = document.createElement('div');
let frame: FrameRequestCallback | undefined;
const nextFrame = () => { const next = frame; frame = undefined; next?.(0); };
const anchors = (): ListAnchors => ({ anchor: () => ({ path: 'second.ts', offset: 320 }), scrollToAnchor: vi.fn() });

it('observes input during migration and does not jump when recovered state arrives', () => {
  const position = createScrollPosition(window, KEY, { deferRestore: true });
  const list = anchors();
  position.attach(root, list);
  window.dispatchEvent(new WheelEvent('wheel'));
  sessionStorage.setItem(KEY, JSON.stringify({ path: 'first.ts', offset: 90 }));
  position.start();
  nextFrame();
  expect(list.scrollToAnchor).not.toHaveBeenCalled();
  position.dispose();
});

it('reads recovered state only when migration is complete', () => {
  const position = createScrollPosition(window, KEY, { deferRestore: true });
  const list = anchors();
  position.attach(root, list);
  expect(frame).toBeUndefined();
  sessionStorage.setItem(KEY, JSON.stringify({ path: 'first.ts', offset: 90 }));
  position.start();
  nextFrame();
  expect(list.scrollToAnchor).toHaveBeenCalledWith({ path: 'first.ts', offset: 90 });
  position.dispose();
});

beforeEach(() => {
  sessionStorage.clear();
  history.scrollRestoration = 'auto';
  usePageScroll.setState({ layout: 'merged', stuck: true });
  usePr.setState({ ...usePr.getInitialState(), load: new Map([['first.ts', { status: 'loaded' }]]) });
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.stubGlobal('requestAnimationFrame', (next: FrameRequestCallback) => { frame = next; return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => { frame = undefined; });
  vi.stubGlobal('scrollTo', vi.fn());
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  frame = undefined;
  session.loader?.cancel();
  session.loader = undefined;
  session.viewport = undefined;
});

it('restores the saved file and offset once, then flushes the current file before reload', () => {
  sessionStorage.setItem(KEY, JSON.stringify({ path: 'first.ts', offset: 140 }));
  const position = createScrollPosition(window, KEY);
  const list = anchors();
  position.attach(root, list);
  nextFrame();
  expect(list.scrollToAnchor).toHaveBeenCalledExactlyOnceWith({ path: 'first.ts', offset: 140 });
  position.attach(root, list);
  nextFrame();
  expect(list.scrollToAnchor).toHaveBeenCalledTimes(1);
  window.dispatchEvent(new Event('scroll'));
  window.dispatchEvent(new Event('pagehide'));
  expect(JSON.parse(sessionStorage.getItem(KEY)!)).toEqual({ path: 'second.ts', offset: 320 });
  position.dispose();
  expect(history.scrollRestoration).toBe('auto');
  sessionStorage.removeItem(KEY);
  window.dispatchEvent(new Event('scroll'));
  vi.runAllTimers();
  expect(sessionStorage.getItem(KEY)).toBeNull();
});

it('restores a position inside GitHub’s header without jumping to the diff list', () => {
  sessionStorage.setItem(KEY, JSON.stringify({ pageTop: 150 }));
  const position = createScrollPosition(window, KEY);
  const list = anchors();
  position.attach(root, list);
  nextFrame();
  expect(window.scrollTo).toHaveBeenCalledWith({ top: 150, behavior: 'instant' });
  expect(list.scrollToAnchor).not.toHaveBeenCalled();
  usePageScroll.setState({ stuck: false });
  vi.stubGlobal('scrollY', 0);
  position.dispose();
  expect(JSON.parse(sessionStorage.getItem(KEY)!)).toEqual({ pageTop: 0 });
});

it('waits for the saved file to load before applying its offset', () => {
  sessionStorage.setItem(KEY, JSON.stringify({ path: 'first.ts', offset: 140 }));
  usePr.setState({ load: new Map([['first.ts', { status: 'loading' }]]) });
  const position = createScrollPosition(window, KEY);
  const list = anchors();
  position.attach(root, list);
  nextFrame();
  expect(list.scrollToAnchor).not.toHaveBeenCalled();
  usePr.setState({ load: new Map([['first.ts', { status: 'loaded' }]]) });
  nextFrame();
  expect(list.scrollToAnchor).toHaveBeenCalledExactlyOnceWith({ path: 'first.ts', offset: 140 });
  position.dispose();
});

it('keeps the saved position if loading is interrupted, and yields restoration to user input', () => {
  const saved = JSON.stringify({ path: 'first.ts', offset: 140 });
  sessionStorage.setItem(KEY, saved);
  const interrupted = createScrollPosition(window, KEY);
  interrupted.attach(root, anchors());
  interrupted.dispose();
  nextFrame();
  expect(sessionStorage.getItem(KEY)).toBe(saved);
  const position = createScrollPosition(window, KEY);
  const list = anchors();
  window.dispatchEvent(new WheelEvent('wheel', { deltaY: 80 }));
  position.attach(root, list);
  nextFrame();
  expect(list.scrollToAnchor).not.toHaveBeenCalled();
  position.dispose();
});

it('loads a delayed saved file’s full lines even after the initial viewport replaces its priority', async () => {
  vi.useRealTimers();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const rpc = fakeRpc(async path => {
    if (path.endsWith('/diff_entries')) await gate;
    return undefined;
  });
  const pr = await fetchPrData(rpc, ref);
  usePr.getState().setPr(pr);
  sessionStorage.setItem(KEY, JSON.stringify({ path: 'src/obsolete.ts', offset: 140 }));
  const position = createScrollPosition(window, KEY);
  const list = anchors();
  session.loader = createLoader({
    rpc, pr, whitespace: false, range: {}, concurrency: 1, firstChunkSize: 1,
    getSummary: path => usePr.getState().files.get(path),
    onResults: results => usePr.getState().applyLoads(results),
    onLoading: (paths, load) => usePr.getState().setLoad(paths, load),
  });
  try {
    position.attach(root, list);
    session.loader.prioritize(session.viewport!);
    session.loader.start();
    session.loader.prioritize([pr.files.find(file => file.path !== 'src/obsolete.ts')!.path]);
    release();
    await vi.waitFor(() => expect(usePr.getState().load.get('src/obsolete.ts')?.status).toBe('loaded'));
    nextFrame();
    expect(rpc.calls.some(call => call.args[0] === `/${ref.owner}/${ref.repo}/pull/${ref.number}/page_data/diff_entry_lines`)).toBe(true);
    expect(list.scrollToAnchor).toHaveBeenCalledExactlyOnceWith({ path: 'src/obsolete.ts', offset: 140 });
  } finally {
    position.dispose();
  }
});
