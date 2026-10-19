import type { Page } from '@playwright/test';
export const VIEWER_HOST: string;
export function evaluateInpage<R, Arg = undefined>(page: Page, fn: (arg: Arg, viewerRoot: ShadowRoot) => R | Promise<R>, arg?: Arg): Promise<R>;
export function waitForInpage(page: Page, timeout?: number): Promise<void>;
