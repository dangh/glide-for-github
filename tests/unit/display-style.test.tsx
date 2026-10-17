// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { GITHUB_FONTS } from '../../src/shared/github-defaults';
import { DEFAULT_SETTINGS, type DisplaySettings } from '../../src/shared/settings';
import { useSettings } from '../../src/viewer/state/settings';
import { applyStyleVars, DisplayStyle } from '../../src/viewer/ui/DisplayStyle';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.documentElement.removeAttribute('style');
  delete document.documentElement.dataset.fileHeader;
  useSettings.setState({ settings: structuredClone(DEFAULT_SETTINGS) as DisplaySettings });
});

describe('applyStyleVars', () => {
  it('sets the variables, and removes the ones a later call no longer has', () => {
    const el = document.createElement('div');
    applyStyleVars(el, { '--a': '1', '--b': 'x y' });
    expect(el.style.getPropertyValue('--a')).toBe('1');
    expect(el.style.getPropertyValue('--b')).toBe('x y');
    applyStyleVars(el, { '--a': '2' });
    expect(el.style.getPropertyValue('--a')).toBe('2');
    expect(el.style.getPropertyValue('--b')).toBe('');
  });

  it('leaves properties it did not set alone', () => {
    const el = document.createElement('div');
    el.style.colorScheme = 'dark';
    applyStyleVars(el, { '--a': '1' });
    applyStyleVars(el, {});
    expect(el.style.colorScheme).toBe('dark');
  });
});

describe('DisplayStyle', () => {
  it('applies the settings to the document root and follows changes', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    await act(async () => root.render(createElement(DisplayStyle)));
    const html = document.documentElement;
    expect(html.style.getPropertyValue('--diffs-font-family')).toBe(GITHUB_FONTS.code);
    expect(html.style.getPropertyValue('--pierre-font')).toBe(GITHUB_FONTS.ui);
    expect(html.style.getPropertyValue('--diffs-bg-addition-override')).toContain('#dafbe1');
    expect(html.dataset.fileHeader).toBe('github');

    await act(async () =>
      useSettings.setState((s) => ({
        settings: { ...s.settings, diff: { ...s.settings.diff, changeColors: 'theme', fileHeaderStyle: 'pierre' }, fonts: { ...s.settings.fonts, codeFontSize: 15 } },
      })),
    );
    expect(html.style.getPropertyValue('--diffs-bg-addition-override')).toBe('');
    expect(html.style.getPropertyValue('--diffs-font-size')).toBe('15px');
    expect(html.dataset.fileHeader).toBe('pierre');
    await act(async () => root.unmount());
  });
});
