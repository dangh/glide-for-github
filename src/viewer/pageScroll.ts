import { create } from 'zustand';
import type { ScrollAnchor, ScrollLayout } from '../shared/page-scroll';

/** Window scroll state used by the toolbar and restoration. */
export const usePageScroll = create<{ layout: ScrollLayout; stuck: boolean }>(() => ({ layout: 'page', stuck: false }));

export interface ListAnchors {
  anchor(): ScrollAnchor | null;
  scrollToAnchor(anchor: ScrollAnchor): void;
}

export interface ScrollPosition {
  attach(root: HTMLElement | null, anchors: ListAnchors | null): void;
}
