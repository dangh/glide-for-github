// @vitest-environment jsdom
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { DARK_THEMES, DEFAULT_SETTINGS, LIGHT_THEMES, type DisplaySettings } from '../../src/shared/settings';
import { DisplaySettingsForm, INPUT_DEBOUNCE_MS, type Update } from '../../src/viewer/ui/DisplaySettingsForm';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
let update: Mock<Update>;

const settings = (): DisplaySettings => structuredClone(DEFAULT_SETTINGS) as DisplaySettings;

async function mount(s: DisplaySettings = settings()) {
  await act(async () => root.render(createElement(DisplaySettingsForm, { settings: s, update })));
}
const field = (label: string) => {
  const el = [...container.querySelectorAll('label.field')].find((l) => l.querySelector('span')?.textContent === label);
  if (!el) throw new Error(`no field ${label}`);
  return el.querySelector('input, select') as HTMLInputElement | HTMLSelectElement;
};
async function type(el: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  update = vi.fn<Update>();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('DisplaySettingsForm', () => {
  it('groups the fields as Diff, Tree and Review', async () => {
    await mount();
    const legends = [...container.querySelectorAll('legend')].map((l) => l.textContent);
    expect(legends).toEqual(['Diff', 'Tree', 'Review']);
    // Theme fields live in the Diff group.
    expect(field('Light theme').closest('fieldset')?.querySelector('legend')?.textContent).toBe('Diff');
    expect(field('Folders start').closest('fieldset')?.querySelector('legend')?.textContent).toBe('Tree');
    expect(field('Hide whitespace changes').closest('fieldset')?.querySelector('legend')?.textContent).toBe('Review');
  });

  it('offers the bundled light themes for Light theme and the dark ones for Dark theme', async () => {
    await mount();
    const options = (el: HTMLElement) => [...el.querySelectorAll('option')].map((o) => o.value);
    expect(options(field('Light theme'))).toEqual([...LIGHT_THEMES]);
    expect(options(field('Dark theme'))).toEqual([...DARK_THEMES]);
    expect(field('Light theme').value).toBe('pierre-light');
  });

  it('applies a theme choice immediately', async () => {
    await mount();
    const select = field('Dark theme') as HTMLSelectElement;
    await act(async () => {
      select.value = 'dracula';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(update).toHaveBeenCalledWith({ diff: { themeDark: 'dracula' } });
  });

  it('keeps a stored theme that is outside its list selectable', async () => {
    const s = settings();
    s.diff.themeLight = 'dracula';
    await mount(s);
    expect(field('Light theme').value).toBe('dracula');
  });

  it(`debounces numeric input by at least 300 ms (${INPUT_DEBOUNCE_MS} ms)`, async () => {
    expect(INPUT_DEBOUNCE_MS).toBeGreaterThanOrEqual(300);
    await mount();
    await type(field('Lines per expand') as HTMLInputElement, '5');
    await type(field('Lines per expand') as HTMLInputElement, '50');
    await act(async () => void vi.advanceTimersByTime(INPUT_DEBOUNCE_MS - 1));
    expect(update).not.toHaveBeenCalled();
    await act(async () => void vi.advanceTimersByTime(2));
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({ diff: { expansionLineCount: 50 } });
  });

  it('never commits an invalid number', async () => {
    await mount();
    await type(field('Lines per expand') as HTMLInputElement, '0');
    await type(field('Gap between files (px)') as HTMLInputElement, '-3');
    await act(async () => void vi.advanceTimersByTime(INPUT_DEBOUNCE_MS * 3));
    expect(update).not.toHaveBeenCalled();
  });

  it('flushes a pending edit when the form unmounts', async () => {
    await mount();
    await type(field('Lines per expand') as HTMLInputElement, '42');
    expect(update).not.toHaveBeenCalled();
    await act(async () => root.render(createElement('div')));
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({ diff: { expansionLineCount: 42 } });
    await act(async () => void vi.advanceTimersByTime(INPUT_DEBOUNCE_MS * 2));
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('flushes a pending edit on pagehide, once', async () => {
    await mount();
    await type(field('Lines per expand') as HTMLInputElement, '33');
    await act(async () => void window.dispatchEvent(new Event('pagehide')));
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({ diff: { expansionLineCount: 33 } });
    await act(async () => void vi.advanceTimersByTime(INPUT_DEBOUNCE_MS * 2));
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('does not call update on unmount or pagehide when nothing is pending', async () => {
    await mount();
    await act(async () => void window.dispatchEvent(new Event('pagehide')));
    await act(async () => root.render(createElement('div')));
    expect(update).not.toHaveBeenCalled();
  });
});
