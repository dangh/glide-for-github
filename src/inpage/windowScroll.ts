/**
 * SPIKE: makes every Pierre CodeView virtualize against the window instead of its own scroll container.
 *
 * CodeView reads three things from its root: `scrollTop`, its height (getBoundingClientRect) and `scroll` events, and
 * writes one: `root.scrollTo` (applyScrollFix, for anchoring and programmatic scrolls). Here the root does not scroll
 * (overflow visible, as tall as the list), and the logical scrollTop is how far the list's top has gone above the
 * viewport's top inset (GitHub's sticky header + Glide's sticky toolbar). The paged scroll rebase (12M px) is off:
 * the window cannot be rebased.
 */
import { CodeView } from '@pierre/diffs';

let insetTop = (): number => 0;
export function setInsetTop(fn: () => number): void {
  insetTop = fn;
}

const NO_REBASE = { containerHeight: Infinity, triggerTop: -Infinity, targetTop: 0, targetBottom: Infinity, threshold: Infinity };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CV = any;
const proto = CodeView.prototype as CV;

(window as unknown as { __spikeOriginal: CV }).__spikeOriginal = Object.fromEntries(['setup', 'cleanUp', 'getScrollTop', 'getHeight', 'applyScrollFix', 'applyStickyPositioning'].map((name) => [name, proto[name]]));

const setup = proto.setup;
proto.setup = function (this: CV, root: HTMLElement) {
  this.scrollRebaseConfig = NO_REBASE;
  root.style.setProperty('--glide-sticky-top', `${insetTop()}px`);
  setup.call(this, root);
  root.removeEventListener('scroll', this.handleScroll);
  this.__onWindowResize = () => {
    this.heightDirty = true;
    this.scrollDirty = true;
    this.render();
  };
  window.addEventListener('scroll', this.handleScroll, { passive: true });
  window.addEventListener('wheel', this.clearPendingScroll, { passive: true });
  window.addEventListener('resize', this.__onWindowResize, { passive: true });
};

const cleanUp = proto.cleanUp;
proto.cleanUp = function (this: CV) {
  window.removeEventListener('scroll', this.handleScroll);
  window.removeEventListener('wheel', this.clearPendingScroll);
  window.removeEventListener('resize', this.__onWindowResize);
  cleanUp.call(this);
};

proto.getScrollTop = function (this: CV) {
  if (!this.scrollDirty) return this.scrollTop;
  this.scrollDirty = false;
  const top = this.root ? this.root.getBoundingClientRect().top : 0;
  this.scrollTop = this.clampScrollTop(insetTop() - top);
  return this.scrollTop;
};

proto.getHeight = function (this: CV) {
  if (!this.heightDirty) return this.height;
  this.heightDirty = false;
  this.height = Math.max(0, window.innerHeight - insetTop());
  return this.height;
};

/** Original applyScrollFix with `root.scrollTo(paged)` replaced by a window scroll to the logical position. */
proto.applyScrollFix = function (this: CV, targetScrollTop: number, syncedScrollTop: number) {
  if (this.root == null) return;
  const round = (n: number) => Math.round(n * devicePixelRatio) / devicePixelRatio;
  const target = round(this.clampScrollTop(targetScrollTop));
  const synced = round(syncedScrollTop);
  if (target === this.renderState.scrollTop && target === synced) return;
  this.suspendScrollInteractions();
  if (target !== synced) {
    this.syncContainerHeight();
    const current = insetTop() - this.root.getBoundingClientRect().top;
    const dy = target - current;
    if (Math.abs(dy) >= 0.5) window.scrollBy({ top: dy, behavior: 'instant' });
  }
  this.renderState.scrollTop = target;
  this.scrollTop = target;
  this.scrollDirty = false;
};

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
