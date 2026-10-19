import { describe, expect, it } from 'vitest';
import { experimentsOf } from '../../src/shared/experiments';
import { parseScrollAnchor, scrollLayoutOf } from '../../src/shared/page-scroll';

describe('scroll layout compatibility', () => {
  it.each([
    [{}, 'page'],
    [{ mergedBar: true }, 'merged'],
    [{ mergedBar: true, pageScroll: false }, 'page'],
    [{ mergedBar: true, pageScroll: true }, 'merged'],
    [{ mergedBar: true, pageScroll: 'yes' }, 'page'],
  ])('preserves effective layout for %j', (experiments, expected) => {
    expect(scrollLayoutOf(experimentsOf({ experiments }))).toBe(expected);
  });
});

describe('scroll anchor (restored after reload)', () => {
  it('accepts a path with a finite offset and nothing else', () => {
    expect(parseScrollAnchor(JSON.stringify({ path: 'src/a.ts', offset: -12.5 }))).toEqual({ path: 'src/a.ts', offset: -12.5 });
    expect(parseScrollAnchor(null)).toBeNull();
    expect(parseScrollAnchor('not json')).toBeNull();
    expect(parseScrollAnchor('null')).toBeNull();
    expect(parseScrollAnchor(JSON.stringify({ path: '', offset: 0 }))).toBeNull();
    expect(parseScrollAnchor(JSON.stringify({ path: 'a', offset: '3' }))).toBeNull();
  });
});
