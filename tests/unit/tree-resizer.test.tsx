// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { DEFAULT_SETTINGS, type DisplaySettings, type LayoutSettings } from '../../src/shared/settings';
import { useSettings, type SettingsState } from '../../src/viewer/state/settings';
import { usePr } from '../../src/viewer/state/store';
import { TreePaneFrame } from '../../src/viewer/ui/TreePaneFrame';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let body: HTMLDivElement;
let update: Mock<SettingsState['update']>;

/** jsdom has no layout (nor CSS max()): the pane is as wide as its handle says, in a body with room to spare. */
const widthOf = (el: HTMLElement) => Number(el.querySelector('[role="separator"]')?.getAttribute('aria-valuenow') ?? 0);
Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
  configurable: true,
  get(this: HTMLElement) {
    if (this.classList.contains('pierre-tree-pane')) return widthOf(this);
    return this.classList.contains('pierre-body') ? 2000 : 0;
  },
});

async function mount(layout: Partial<LayoutSettings> = {}, githubWidth?: number) {
  const settings = structuredClone(DEFAULT_SETTINGS) as DisplaySettings;
  Object.assign(settings.layout, layout);
  useSettings.setState({ settings, update });
  usePr.setState({ pr: (githubWidth ? { viewer: { treeWidth: githubWidth } } : null) as never });
  await act(async () => root.render(createElement(TreePaneFrame, null, createElement('div', { className: 'tree' }))));
}
const handle = () => body.querySelector<HTMLElement>('[role="separator"]')!;
const now = () => Number(handle().getAttribute('aria-valuenow'));
const fire = (type: string, init: PointerEventInit = {}) =>
  act(async () => {
    handle().dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, button: 0, ...init }));
  });
const key = (type: 'keydown' | 'keyup', k: string) =>
  act(async () => {
    handle().dispatchEvent(new KeyboardEvent(type, { key: k, bubbles: true, cancelable: true }));
  });

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 16));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => true);
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  update = vi.fn();
  body = document.createElement('div');
  body.className = 'pierre-body';
  document.body.append(body);
  root = createRoot(body);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('tree resize handle', () => {
  it('is a focusable vertical separator with the width and its limits', async () => {
    await mount();
    const h = handle();
    expect(h.getAttribute('aria-orientation')).toBe('vertical');
    expect(h.getAttribute('aria-label')).toBe('Resize file tree');
    expect(h.tabIndex).toBe(0);
    expect([now(), h.getAttribute('aria-valuemin'), h.getAttribute('aria-valuemax')]).toEqual([296, '256', '700']);
  });

  it("starts at the account's GitHub width when the width is 'default'", async () => {
    await mount({}, 436);
    expect(now()).toBe(436);
    await act(async () => root.unmount());
    root = createRoot(body);
    await mount({ treeWidth: 320 }, 436);
    expect(now()).toBe(320);
  });

  it('follows a drag every frame and saves once, when the drag ends', async () => {
    await mount();
    await fire('pointerdown', { clientX: 300 });
    expect(document.documentElement.dataset.treeResizing).toBe('');
    for (const x of [320, 350, 400]) await fire('pointermove', { clientX: x, buttons: 1 });
    await act(async () => vi.advanceTimersByTime(20));
    expect(now()).toBe(396);
    expect(handle().dataset.dragging).toBe('true');
    expect(update).not.toHaveBeenCalled();
    await fire('lostpointercapture', { clientX: 400 });
    expect(update.mock.calls).toEqual([[{ layout: { treeWidth: 396 } }]]);
    expect(document.documentElement.dataset.treeResizing).toBeUndefined();
    expect(handle().dataset.dragging).toBeUndefined();
  });

  it('mirrors the drag for a tree on the right, and saves nothing for a click', async () => {
    await mount({ treePosition: 'right' });
    await fire('pointerdown', { clientX: 1000 });
    await fire('lostpointercapture');
    expect(update).not.toHaveBeenCalled();
    await fire('pointerdown', { clientX: 1000 });
    await fire('pointermove', { clientX: 900, buttons: 1 });
    await fire('lostpointercapture');
    expect(update.mock.calls).toEqual([[{ layout: { treeWidth: 396 } }]]);
  });

  it('ends a drag whose pointerup got lost at the next move with the button up', async () => {
    await mount();
    await fire('pointerdown', { clientX: 300 });
    await fire('pointermove', { clientX: 380, buttons: 1 });
    await fire('pointermove', { clientX: 500, buttons: 0 });
    expect(update.mock.calls).toEqual([[{ layout: { treeWidth: 376 } }]]);
    expect(HTMLElement.prototype.releasePointerCapture).toHaveBeenCalledWith(1);
    expect(document.documentElement.dataset.treeResizing).toBeUndefined();
    await fire('lostpointercapture');
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('steps with the arrow keys and saves when the key goes up', async () => {
    await mount();
    for (let i = 0; i < 3; i++) await key('keydown', 'ArrowRight');
    expect(now()).toBe(344);
    expect(update).not.toHaveBeenCalled();
    await key('keyup', 'ArrowRight');
    expect(update.mock.calls).toEqual([[{ layout: { treeWidth: 344 } }]]);
  });

  it('widens a tree on the right with ArrowLeft, and goes to the ends with Home and End', async () => {
    await mount({ treePosition: 'right' });
    await key('keydown', 'ArrowLeft');
    expect(now()).toBe(312);
    await key('keydown', 'End');
    expect(now()).toBe(700);
    await key('keydown', 'Home');
    expect(now()).toBe(256);
    await key('keyup', 'Home');
    expect(update.mock.calls).toEqual([[{ layout: { treeWidth: 256 } }]]);
  });

  it('resets to the default with a double-click or Enter', async () => {
    await mount({ treeWidth: 500 });
    await act(async () => {
      handle().dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    await key('keydown', 'Enter');
    expect(update.mock.calls).toEqual([[{ layout: { treeWidth: 'default' } }], [{ layout: { treeWidth: 'default' } }]]);
  });

  it('puts the handle between the tree and the diffs in the focus order', async () => {
    await mount();
    expect(body.querySelector('aside')!.lastElementChild).toBe(handle());
    await mount({ treePosition: 'right' });
    expect(body.querySelector('aside')!.firstElementChild).toBe(handle());
  });
});
