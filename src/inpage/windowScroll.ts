/** Pierre owns document paging; this module supplies the inset and tracks mounted window views. */
import type { CodeViewWindowViewport } from '@pierre/diffs';

let insetTop = (): number => 0;
export function setInsetTop(fn: () => number): void {
  insetTop = fn;
}

type MountedView = Parameters<NonNullable<CodeViewWindowViewport['onMount']>>[0];
const views = new Set<MountedView>();

/** Explicitly passed to the in-page viewer; normal Pierre instances keep their element viewport. */
export const windowViewport: CodeViewWindowViewport = {
  window,
  getInsetTop: () => insetTop(),
  stickyHeaderCSS: '[data-diffs-header][data-sticky] { top: var(--glide-sticky-top, 0px); }',
  onMount(view) {
    views.add(view);
    return () => { views.delete(view); };
  },
};

export function refreshWindowViewport(): void {
  for (const view of views) view.refreshViewport();
}

/** Physical page zero must also discard any logical offset from a very tall list. */
export function scrollWindowToTop(): void {
  for (const view of views) view.resetScrollPage();
  window.scrollTo({ top: 0, behavior: 'instant' });
}
