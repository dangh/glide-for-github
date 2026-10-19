/**
 * SPIKE: makes every Pierre CodeView virtualize against the window instead of its own scroll container.
 *
 * CodeView reads three things from its root: `scrollTop`, its height (getBoundingClientRect) and `scroll` events, and
 * writes one: `root.scrollTo` (applyScrollFix, for anchoring and programmatic scrolls). Here the root does not scroll
 * (overflow visible, as tall as the list), and the logical scrollTop is how far the list's top has gone above the
 * viewport's top inset (GitHub's sticky header + Glide's sticky toolbar). Pierre keeps very tall lists in a bounded
 * physical scroll window; its logical page offset is applied to document scroll reads and writes too.
 */
import { CodeView } from '@pierre/diffs';

let insetTop = (): number => 0;
export function setInsetTop(fn: () => number): void {
  insetTop = fn;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CV = any;
const proto = CodeView.prototype as CV;
const views = new Set<CV>();
const scrollInputs = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;

export function refreshWindowViewport(): void {
  for (const view of views) {
    view.heightDirty = true;
    view.scrollDirty = true;
    view.render();
  }
}

(window as unknown as { __spikeOriginal: CV }).__spikeOriginal = Object.fromEntries(['setup', 'cleanUp', 'getScrollTop', 'getHeight', 'applyScrollFix', 'applyStickyPositioning'].map((name) => [name, proto[name]]));

const setup = proto.setup;
proto.setup = function (this: CV, root: HTMLElement) {
  setup.call(this, root);
  views.add(this);
  root.removeEventListener('scroll', this.handleScroll);
  this.__onWindowResize = () => {
    this.heightDirty = true;
    this.scrollDirty = true;
    this.render();
  };
  window.addEventListener('scroll', this.handleScroll, { passive: true });
  for (const event of scrollInputs) {
    root.removeEventListener(event, this.clearPendingScroll);
    // Toolbar and page interactions must interrupt anchoring too, including keys stopped at the shadow boundary.
    window.addEventListener(event, this.clearPendingScroll, { passive: true, capture: true });
  }
  window.addEventListener('resize', this.__onWindowResize, { passive: true });
};

const cleanUp = proto.cleanUp;
proto.cleanUp = function (this: CV) {
  views.delete(this);
  window.removeEventListener('scroll', this.handleScroll);
  for (const event of scrollInputs) window.removeEventListener(event, this.clearPendingScroll, true);
  window.removeEventListener('resize', this.__onWindowResize);
  cleanUp.call(this);
};

proto.getScrollTop = function (this: CV) {
  if (!this.scrollDirty) return this.scrollTop;
  this.scrollDirty = false;
  const top = this.root ? this.root.getBoundingClientRect().top : 0;
  this.scrollTop = this.clampScrollTop(Math.max(0, insetTop() - top) + this.scrollPageOffset);
  return this.scrollTop;
};

proto.getHeight = function (this: CV) {
  if (!this.heightDirty) return this.height;
  this.heightDirty = false;
  this.height = Math.max(0, window.innerHeight - insetTop());
  return this.height;
};

/** Preserve Pierre's logical scroll pages while moving the document's physical viewport. */
proto.applyScrollFix = function (this: CV, targetScrollTop: number, syncedScrollTop: number, windowSpecs: unknown) {
  if (this.root == null) return;
  const round = (n: number) => Math.round(n * devicePixelRatio) / devicePixelRatio;
  const target = round(this.clampScrollTop(targetScrollTop));
  const synced = round(syncedScrollTop);
  const previousOffset = this.scrollPageOffset;
  const syncedPaged = round(this.clampPagedScrollTop(synced - previousOffset));
  const { pagedScrollTop, scrollPageOffset } = this.resolvePagedScrollPosition(target);
  const rebased = previousOffset !== scrollPageOffset;
  if (target === this.renderState.scrollTop && target === synced && pagedScrollTop === syncedPaged && !rebased) return;
  this.suspendScrollInteractions();
  if (pagedScrollTop !== syncedPaged || rebased) {
    this.scrollPageOffset = scrollPageOffset;
    this.syncPagedScrollScaffolding(windowSpecs);
  }
  if (pagedScrollTop !== syncedPaged) {
    const current = insetTop() - this.root.getBoundingClientRect().top;
    const dy = pagedScrollTop - current;
    if (Math.abs(dy) >= 0.5) window.scrollBy({ top: dy, behavior: 'instant' });
  }
  this.renderState.scrollTop = target;
  this.scrollTop = target;
  this.scrollDirty = false;
};

/** Physical page zero must also discard any logical offset from a very tall list. */
export function scrollWindowToTop(): void {
  for (const view of views) {
    view.clearPendingScroll();
    view.scrollPageOffset = 0;
    view.scrollDirty = true;
    view.render();
  }
  window.scrollTo({ top: 0, behavior: 'instant' });
}

/** The rendered window sticks to the viewport below the inset, not to the window's top edge. */
const applyStickyPositioning = proto.applyStickyPositioning;
proto.applyStickyPositioning = function (this: CV, bounds: unknown) {
  applyStickyPositioning.call(this, bounds);
  const top = parseFloat(this.stickyContainer.style.top) || 0;
  this.stickyContainer.style.top = `${top + insetTop()}px`;
};

// Header stickiness is native CSS too; its containing viewport starts below Glide's toolbar.
for (const name of ['createDiffOptions', 'createFileOptions']) {
  const original = proto[name];
  proto[name] = function (this: CV, ...args: unknown[]) {
    const options = original.apply(this, args);
    Object.defineProperty(options, 'unsafeCSS', { value: (options.unsafeCSS ?? '') + '\n[data-diffs-header][data-sticky] { top: var(--glide-sticky-top, 0px); }', configurable: true });
    return options;
  };
}
