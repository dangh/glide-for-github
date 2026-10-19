// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { ignoreBenignErrors } from '../../src/viewer/benignErrors';

const fire = (message: string) => {
  const event = new ErrorEvent('error', { message, cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
};

describe('ignoreBenignErrors', () => {
  ignoreBenignErrors(window);

  it("marks Chrome's ResizeObserver loop report as handled, so it is not reported as an error", () => {
    expect(fire('ResizeObserver loop completed with undelivered notifications.')).toBe(true);
    expect(fire('ResizeObserver loop limit exceeded')).toBe(true);
  });

  it('leaves every other error alone', () => {
    expect(fire('TypeError: x is undefined')).toBe(false);
    expect(fire('ResizeObserver is not defined')).toBe(false);
  });
});
