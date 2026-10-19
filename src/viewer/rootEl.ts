/**
 * SPIKE (in-page): where the viewer keeps its root attributes and style vars, and where it listens for document-wide
 * events. In the iframe both are the viewer's own document; in-page they are the shadow host and its shadow root, so
 * GitHub's <html> stays untouched and events are seen before shadow DOM retargets them to the host.
 */
let inPageRoot: { el: HTMLElement; scope: ShadowRoot } | undefined;

export const viewerRoot = {
  get el(): HTMLElement { return inPageRoot?.el ?? document.documentElement; },
  get scope(): Document | ShadowRoot { return inPageRoot?.scope ?? document; },
};

export function setViewerRoot(el: HTMLElement, scope: ShadowRoot): void {
  inPageRoot = { el, scope };
}
