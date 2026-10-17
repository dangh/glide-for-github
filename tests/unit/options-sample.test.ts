// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { SAMPLE_FILE_NAME, buildSampleDiff } from '../../src/options/sample';

describe('options sample diff', () => {
  const diff = buildSampleDiff();

  it('is a modified TypeScript file', () => {
    expect(diff.name).toBe(SAMPLE_FILE_NAME);
    expect(SAMPLE_FILE_NAME).toMatch(/\.ts$/);
    expect(diff.type).toBe('change');
  });

  it('has two separate hunks, so hunk separators and collapsed context show', () => {
    expect(diff.hunks.length).toBeGreaterThanOrEqual(2);
  });

  it('adds and deletes lines, with a modified line pair for inline word changes', () => {
    const lines = diff.hunks.flatMap((h) => h.hunkContent);
    const added = lines.reduce((n, c) => n + (c.type === 'change' ? c.additions : 0), 0);
    const deleted = lines.reduce((n, c) => n + (c.type === 'change' ? c.deletions : 0), 0);
    expect(added).toBeGreaterThan(0);
    expect(deleted).toBeGreaterThan(0);
  });

  it('is built once and reused', () => {
    expect(buildSampleDiff()).toBe(diff);
  });
});
