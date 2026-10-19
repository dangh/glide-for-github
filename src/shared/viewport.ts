/** GitHub viewport breakpoints used by the in-page layout. */
export const BREAKPOINTS = { md: 768, lg: 1012 } as const;

export type Breakpoint = keyof typeof BREAKPOINTS;

const NAMES = Object.keys(BREAKPOINTS) as Breakpoint[];

/** The breakpoints a viewport `width` (CSS px, scrollbar included, as media queries see it) reaches. */
export function reachedBreakpoints(width: number): Breakpoint[] {
  return NAMES.filter((name) => width >= BREAKPOINTS[name]);
}
