/**
 * The CSS side of the display settings, on the document root (inherited into Pierre's shadow roots): font and
 * GitHub change-color custom properties (`toStyleVars`) and `data-file-header` (viewer.css styles the per-file
 * header from it). Renders nothing; the DOM is touched only when those values change, never per keystroke or scroll.
 */
import { useEffect } from 'react';
import { toStyleVars } from '../../shared/github-defaults';
import { DEFAULT_CHOICE } from '../../shared/settings';
import { useSettings } from '../state/settings';

const appliedKeys = new WeakMap<HTMLElement, string[]>();

/** Sets `vars` as inline custom properties on `el` and removes the ones an earlier call set that `vars` lacks. */
export function applyStyleVars(el: HTMLElement, vars: Readonly<Record<string, string>>): void {
  for (const key of appliedKeys.get(el) ?? []) if (!(key in vars)) el.style.removeProperty(key);
  for (const [key, value] of Object.entries(vars)) el.style.setProperty(key, value);
  appliedKeys.set(el, Object.keys(vars));
}

export function DisplayStyle() {
  const vars = useSettings((s) => toStyleVars(s.settings));
  const header = useSettings((s) => (s.settings.diff.fileHeaderStyle === DEFAULT_CHOICE ? 'github' : 'pierre'));
  useEffect(() => applyStyleVars(document.documentElement, vars), [vars]);
  useEffect(() => {
    document.documentElement.dataset.fileHeader = header;
  }, [header]);
  return null;
}
