/**
 * GitHub's viewport breakpoints (Primer's md and lg) that the viewer's layout follows: page gutters, the toolbar's
 * divider, "viewed" word and branch summary. The viewer cannot use media queries for them: its iframe is narrower than
 * GitHub's viewport by the page scrollbar, and outside the merged bar by the page gutters too. So the page reports
 * which breakpoints its viewport reaches, with every handshake and whenever that changes.
 */
export const BREAKPOINTS = { md: 768, lg: 1012 } as const;

export type Breakpoint = keyof typeof BREAKPOINTS;

const NAMES = Object.keys(BREAKPOINTS) as Breakpoint[];

/** The breakpoints a viewport `width` (CSS px, scrollbar included, as media queries see it) reaches. */
export function reachedBreakpoints(width: number): Breakpoint[] {
  return NAMES.filter((name) => width >= BREAKPOINTS[name]);
}

/** Page → viewer, posted to the iframe's window. */
export interface ViewportMessage {
  type: 'pierre:viewport';
  reached: Breakpoint[];
}

export function parseViewportMessage(data: unknown): Breakpoint[] | null {
  if (typeof data !== 'object' || data === null) return null;
  const m = data as Record<string, unknown>;
  if (m.type !== 'pierre:viewport' || !Array.isArray(m.reached)) return null;
  return NAMES.filter((name) => (m.reached as unknown[]).includes(name));
}
