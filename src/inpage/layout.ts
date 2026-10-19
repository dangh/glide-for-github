import { findStickyHeader, stickyHeaderHeight, topBarBottom } from '../content/github-header';
import type { ScrollLayout } from '../shared/page-scroll';
import { reachedBreakpoints } from '../shared/viewport';
import { usePageScroll } from '../viewer/pageScroll';
import { refreshWindowViewport, setInsetTop } from './windowScroll';

/** The document owns scrolling; only the toolbar and tree stick inside the viewer. */
export function createInPageLayout(doc: Document, host: HTMLElement, shadow: ShadowRoot, requested: ScrollLayout, initialAnchor: HTMLElement) {
  const win = doc.defaultView!;
  const layout = requested === 'merged' ? 'merged' : 'page';
  const hidden = new Map<HTMLElement, string | null>();
  let nativeTop = 0;
  let inset = 60;
  let documentTop = NaN;
  let anchor = initialAnchor;
  let measured: { header: HTMLElement | null; width: number; height: number } | undefined;
  host.dataset.scrollLayout = layout;
  usePageScroll.setState({ layout, stuck: false });
  setInsetTop(() => inset);

  const css = (name: string, value: number) => {
    const next = `${value}px`;
    if (host.style.getPropertyValue(name) !== next) host.style.setProperty(name, next);
  };
  const hide = (el: HTMLElement) => {
    if (!hidden.has(el)) hidden.set(el, el.getAttribute('style'));
    if (el.style.getPropertyValue('display') !== 'none' || el.style.getPropertyPriority('display') !== 'important') {
      el.style.setProperty('display', 'none', 'important');
    }
  };
  const onScroll = () => {
    const rect = host.getBoundingClientRect();
    const stuck = rect.top <= nativeTop;
    if (usePageScroll.getState().stuck !== stuck) usePageScroll.setState({ stuck });
    const bottom = shadow.querySelector('.pierre-toolbar')?.getBoundingClientRect().bottom
      ?? Math.max(nativeTop, rect.top) + 60;
    css('--glide-menu-space', Math.max(0, win.innerHeight - bottom - 8));
  };
  const measure = () => {
    host.dataset.viewport = reachedBreakpoints(win.innerWidth).join(' ');
    const rect = host.getBoundingClientRect();
    css('--glide-gutter-left', rect.left);
    css('--glide-gutter-right', doc.documentElement.clientWidth - rect.right);
    const header = findStickyHeader(anchor);
    if (header && layout === 'merged') hide(header);
    if (layout === 'merged') nativeTop = 0;
    else {
      if (measured?.header !== header || measured.width !== win.innerWidth) {
        measured = { header, width: win.innerWidth, height: header ? stickyHeaderHeight(header) : topBarBottom(doc, host) };
      }
      nativeTop = measured.height;
    }
    css('--glide-toolbar-top', nativeTop);
    const toolbarHeight = shadow.querySelector('.pierre-toolbar')?.getBoundingClientRect().height ?? 60;
    const next = nativeTop + toolbarHeight;
    css('--glide-sticky-top', next);
    const nextDocumentTop = rect.top + win.scrollY;
    if (next !== inset || Math.abs(nextDocumentTop - documentTop) > 0.5 || Number.isNaN(documentTop)) {
      inset = next;
      documentTop = nextDocumentTop;
      refreshWindowViewport();
    }
    onScroll();
  };
  const resizes = new ResizeObserver(measure);
  resizes.observe(host);
  resizes.observe(anchor);
  // The toolbar arrives with React, after worker startup, and can change height with its contents.
  resizes.observe(shadow.getElementById('root')!);
  win.addEventListener('resize', measure);
  win.addEventListener('scroll', onScroll, { passive: true });
  return {
    refresh(nextAnchor: HTMLElement) {
      if (anchor !== nextAnchor) {
        resizes.unobserve(anchor);
        anchor = nextAnchor;
        resizes.observe(anchor);
      }
      for (const footer of doc.querySelectorAll<HTMLElement>('footer[role="contentinfo"]')) hide(footer);
      measure();
    },
    dispose() {
      resizes.disconnect();
      win.removeEventListener('resize', measure);
      win.removeEventListener('scroll', onScroll);
      usePageScroll.setState(usePageScroll.getInitialState());
      setInsetTop(() => 0);
      for (const [el, style] of hidden) {
        if (style === null) el.removeAttribute('style');
        else el.setAttribute('style', style);
      }
    },
  };
}
