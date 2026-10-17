import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSettle, TREE_SYNC_QUIET_MS } from '../../src/viewer/state/view';

describe('createSettle (diff scroll → tree selection)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** Idle callbacks run when the test says the main thread is idle. */
  function setup() {
    const run = vi.fn();
    const idleQueue: (() => void)[] = [];
    const settle = createSettle<string>(run, {
      idle: (fn) => {
        idleQueue.push(fn);
        return () => idleQueue.splice(idleQueue.indexOf(fn), 1);
      },
    });
    const idle = () => idleQueue.splice(0).forEach((fn) => fn());
    return { run, settle, idle, idleQueue };
  }

  it('runs nothing during a stream of pushes (a scroll), then once with the last value, when idle', () => {
    const { run, settle, idle, idleQueue } = setup();
    for (let i = 0; i < 20; i++) {
      settle.push(`file${i}`);
      vi.advanceTimersByTime(16);
    }
    idle();
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(TREE_SYNC_QUIET_MS);
    expect(run).not.toHaveBeenCalled(); // waits for an idle period
    expect(idleQueue).toHaveLength(1);
    idle();
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith('file19');
  });

  it('a push while waiting for idle replaces the value and restarts the quiet period', () => {
    const { run, settle, idle, idleQueue } = setup();
    settle.push('a');
    vi.advanceTimersByTime(TREE_SYNC_QUIET_MS);
    settle.push('b');
    expect(idleQueue).toHaveLength(0);
    vi.advanceTimersByTime(TREE_SYNC_QUIET_MS);
    idle();
    expect(run.mock.calls).toEqual([['b']]);
  });

  it('cancel drops the pending value', () => {
    const { run, settle, idle } = setup();
    settle.push('a');
    settle.cancel();
    vi.advanceTimersByTime(TREE_SYNC_QUIET_MS * 2);
    idle();
    expect(run).not.toHaveBeenCalled();
  });

  it('falls back to a timer without requestIdleCallback', () => {
    const run = vi.fn();
    const settle = createSettle<string>(run);
    settle.push('x');
    vi.advanceTimersByTime(TREE_SYNC_QUIET_MS + 600);
    expect(run).toHaveBeenCalledWith('x');
  });
});
