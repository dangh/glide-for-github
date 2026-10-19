// @vitest-environment jsdom
import { CodeView, parseDiffFromFile, preloadHighlighter, type CodeViewOptions } from '@pierre/diffs';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { refreshWindowViewport, scrollWindowToTop, setInsetTop, windowViewport } from '../../src/inpage/windowScroll';

const views: CodeView[] = [];
let documentScroll = 0;
let inset = 60;

beforeAll(async () => {
  await preloadHighlighter({ themes: ['github-light'], langs: ['text'], preferredHighlighter: 'shiki-js' });
});
beforeEach(() => {
  documentScroll = 0;
  inset = 60;
  setInsetTop(() => inset);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.spyOn(window, 'scrollBy').mockImplementation((options?: ScrollToOptions | number) => {
    if (typeof options === 'object') documentScroll += options.top ?? 0;
  });
  vi.spyOn(window, 'scrollTo').mockImplementation((options?: ScrollToOptions | number) => {
    if (typeof options === 'object') documentScroll = options.top ?? 0;
  });
});
afterEach(() => {
  for (const view of views.splice(0)) view.cleanUp();
  document.body.textContent = '';
  setInsetTop(() => 0);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Only layout/scroll APIs are simulated; all paging and rendering run in the patched Pierre class. */
function mount(options: CodeViewOptions<undefined, undefined> = { windowViewport }) {
  const root = document.createElement('div');
  vi.spyOn(root, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 300 - documentScroll, 1000, 650));
  root.scrollTo = vi.fn((options?: ScrollToOptions | number) => {
    if (typeof options === 'object') root.scrollTop = options.top ?? 0;
  });
  document.body.append(root);
  const view = new CodeView({ theme: 'github-light', themeType: 'light', __devOnlyValidateItemHeights: false, ...options });
  views.push(view);
  view.setup(root);
  view.setItems([{ type: 'file', id: 'file.txt', file: { name: 'file.txt', contents: 'line\n'.repeat(100) } }]);
  view.render(true);
  return { view, root };
}

it('opts into window measurements while independent element views retain their own viewport', () => {
  const page = mount();
  const element = mount({});
  documentScroll = 700;
  window.dispatchEvent(new Event('scroll'));
  element.root.scrollTop = 125;
  element.root.dispatchEvent(new Event('scroll'));
  expect(page.view.getScrollTop()).toBe(460);
  expect(page.view.getHeight()).toBe(window.innerHeight - 60);
  expect(element.view.getScrollTop()).toBe(125);
  expect(element.view.getHeight()).toBe(650);
});

it('refreshes the inset and document position, and unregisters cleaned-up views', () => {
  const { view } = mount();
  documentScroll = 700;
  inset = 90;
  refreshWindowViewport();
  expect(view.getHeight()).toBe(window.innerHeight - 90);
  expect(view.getScrollTop()).toBe(490);
  inset = 120;
  window.dispatchEvent(new Event('resize'));
  expect(view.getHeight()).toBe(window.innerHeight - 120);
  const render = vi.spyOn(view, 'render');
  view.cleanUp();
  views.splice(views.indexOf(view), 1);
  render.mockClear();
  refreshWindowViewport();
  window.dispatchEvent(new Event('resize'));
  window.dispatchEvent(new Event('scroll'));
  expect(render).not.toHaveBeenCalled();
});

it('moves the document for programmatic scrolls and leaves wheel input native', () => {
  const { view, root } = mount();
  view.scrollTo({ type: 'position', position: 500, behavior: 'instant' });
  view.render(true);
  expect(view.getScrollTop()).toBe(500);
  expect(documentScroll).toBe(740);
  expect(root.scrollTo).not.toHaveBeenCalled();
  const wheel = new WheelEvent('wheel', { deltaY: 100, cancelable: true, bubbles: true });
  root.dispatchEvent(wheel);
  expect(wheel.defaultPrevented).toBe(false);
  expect(documentScroll).toBe(740);
});

it('captures page input before a shadow boundary stops it and cancels pending anchoring', () => {
  const { view } = mount();
  const host = document.createElement('div');
  document.body.append(host);
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.addEventListener('keydown', event => event.stopPropagation());
  const input = document.createElement('input');
  shadow.append(input);
  view.scrollTo({ type: 'position', position: 500, behavior: 'instant' });
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, composed: true }));
  view.render(true);
  expect(window.scrollBy).not.toHaveBeenCalled();
});

it('returns to physical page zero after resetting logical paging', () => {
  const { view } = mount({ windowViewport, itemMetrics: { lineHeight: 200_000 } });
  view.scrollTo({ type: 'position', position: 15_000_000, behavior: 'instant' });
  view.render(true);
  expect(view.getScrollTop()).toBe(15_000_000);
  expect(documentScroll).toBeLessThan(12_000_000);
  scrollWindowToTop();
  window.dispatchEvent(new Event('scroll'));
  view.render(true);
  expect(documentScroll).toBe(0);
  expect(view.getScrollTop()).toBe(0);
});

it('keeps the sticky header inset CSS scoped to opted-in file and diff views', () => {
  const page = mount({ windowViewport, unsafeCSS: '.kept { color: red; }' });
  page.view.addItem({ type: 'diff', id: 'diff.txt', fileDiff: parseDiffFromFile(
    { name: 'diff.txt', contents: 'before\n' }, { name: 'diff.txt', contents: 'after\n' },
  ) });
  page.view.scrollTo({ type: 'item', id: 'diff.txt', align: 'start', behavior: 'instant' });
  page.view.render(true);
  const diff = page.view.getRenderedItems().find(item => item.id === 'diff.txt')?.element;
  expect(diff?.shadowRoot?.textContent).toContain('.kept { color: red; }');
  expect(diff?.shadowRoot?.textContent).toContain('top: var(--glide-sticky-top, 0px)');
  page.view.scrollTo({ type: 'position', position: 0, behavior: 'instant' });
  page.view.render(true);
  expect(page.view.getRenderedItems().find(item => item.id === 'file.txt')?.element.shadowRoot?.textContent).toContain('top: var(--glide-sticky-top, 0px)');
  const element = mount({});
  expect(element.root.querySelector('diffs-container')?.shadowRoot?.textContent).not.toContain('--glide-sticky-top');
});
