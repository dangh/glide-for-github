// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Popover } from '../../src/viewer/ui/Popover';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;

beforeEach(async () => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(Popover, { label: 'Menu', testId: 'menu', children: () => createElement('p', { className: 'inside' }, 'panel') })));
  await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="menu"]')!.click());
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = '';
});

const isOpen = () => container.querySelector('.popover-panel') !== null;

describe('Popover dismissal', () => {
  it('closes when the frame loses focus to the page around it (window blur)', async () => {
    expect(isOpen()).toBe(true);
    await act(async () => void window.dispatchEvent(new Event('blur')));
    expect(isOpen()).toBe(false);
  });

  it('stays open on blur while a modal dialog (token prompt) is open', async () => {
    const modal = document.createElement('div');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    document.body.append(modal);
    await act(async () => void window.dispatchEvent(new Event('blur')));
    expect(isOpen()).toBe(true);
  });

  it('still closes on an outside mousedown and on Escape, not on an inside mousedown', async () => {
    await act(async () => void container.querySelector('.inside')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    expect(isOpen()).toBe(true);
    await act(async () => void document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    expect(isOpen()).toBe(false);
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="menu"]')!.click());
    await act(async () => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(isOpen()).toBe(false);
  });

  it('stops listening once closed', async () => {
    await act(async () => void window.dispatchEvent(new Event('blur')));
    await act(async () => void window.dispatchEvent(new Event('blur')));
    expect(isOpen()).toBe(false);
  });
});
