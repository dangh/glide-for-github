import { parseScrollAnchor, type ScrollAnchor } from '../shared/page-scroll';
import { usePageScroll, type ListAnchors } from '../viewer/pageScroll';
import { usePr } from '../viewer/state/store';
import { session } from '../viewer/state/session';

type Position = ScrollAnchor | { pageTop: number };

function readPosition(win: Window, key: string): Position | null {
  try {
    const raw = win.sessionStorage.getItem(key);
    const value: unknown = JSON.parse(raw ?? 'null');
    if (value && typeof value === 'object' && 'pageTop' in value && typeof value.pageTop === 'number' && Number.isFinite(value.pageTop) && value.pageTop >= 0)
      return { pageTop: value.pageTop };
    return parseScrollAnchor(raw);
  } catch {
    return null;
  }
}

/** Browser pixel restoration cannot follow files that change height as their diffs load. */
export function createScrollPosition(win: Window, key: string, { deferRestore = false } = {}) {
  let started = !deferRestore;
  let saved = started ? readPosition(win, key) : null;
  if (saved && 'path' in saved) session.viewport = [saved.path];
  let anchors: ListAnchors | null = null;
  let restored = false;
  let disposed = false;
  let interacted = false;
  let requestedLines = false;
  let restoreFrame: number | undefined;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  const inputs = ['wheel', 'pointerdown', 'keydown', 'touchstart'] as const;
  const onInput = () => { interacted = true; restore(); };
  const save = () => {
    clearTimeout(saveTimer);
    if (!restored || !anchors) return;
    const position = usePageScroll.getState().stuck ? anchors.anchor() : { pageTop: win.scrollY };
    try {
      if (position) win.sessionStorage.setItem(key, JSON.stringify(position));
    } catch {
      // Scrolling still works when session storage is unavailable.
    }
  };
  const onScroll = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 300);
  };
  const ready = () => {
    if (!saved || 'pageTop' in saved || interacted) return true;
    const state = usePr.getState();
    if (state.pr && !state.files.has(saved.path)) return true;
    const load = state.load.get(saved.path);
    if (load?.status === 'needs-lines' && !load.loadingLines && !load.message && !requestedLines && session.loader) {
      // The initial viewport can replace our priority before this delayed entry arrives.
      requestedLines = true;
      void session.loader.loadLines(saved.path).catch(() => undefined);
    }
    // A placeholder is too short for a saved offset and would land in a later file.
    return load && (!['pending', 'loading', 'needs-lines'].includes(load.status) || !!load.message);
  };
  const restore = () => {
    if (!started || !anchors || restored || restoreFrame !== undefined || !ready()) return;
    restoreFrame = win.requestAnimationFrame(() => {
      restoreFrame = undefined;
      if (!anchors || !ready()) return;
      restored = true;
      if (!saved || interacted) return;
      if ('pageTop' in saved) win.scrollTo({ top: saved.pageTop, behavior: 'instant' });
      else anchors.scrollToAnchor({ path: saved.path, offset: usePr.getState().load.get(saved.path)?.status === 'loaded' ? saved.offset : 0 });
    });
  };
  const unsubscribe = usePr.subscribe(restore);
  win.addEventListener('scroll', onScroll, { passive: true });
  win.addEventListener('pagehide', save);
  for (const event of inputs) win.addEventListener(event, onInput, { passive: true, capture: true });
  return {
    start() {
      if (started || disposed) return;
      saved = readPosition(win, key);
      if (saved && 'path' in saved && !interacted) session.viewport = [saved.path];
      started = true;
      restore();
    },
    attach(_root: HTMLElement | null, next: ListAnchors | null) {
      if (disposed) return;
      if (!next) save();
      anchors = next;
      restore();
    },
    dispose() {
      save();
      disposed = true;
      unsubscribe();
      if (restoreFrame !== undefined) win.cancelAnimationFrame(restoreFrame);
      clearTimeout(saveTimer);
      win.removeEventListener('scroll', onScroll);
      win.removeEventListener('pagehide', save);
      for (const event of inputs) win.removeEventListener(event, onInput, true);
    },
  };
}
