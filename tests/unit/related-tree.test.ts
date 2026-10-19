import type { FileTreeSortEntry } from '@pierre/trees';
import { describe, expect, it } from 'vitest';
// The library's own default order, which its entry point does not export.
// @ts-expect-error untyped internal module
import { comparePreparedPaths } from '../../node_modules/@pierre/trees/dist/path-store/src/sort.js';
import { DEFAULT_RELATED_RULES, NO_RELATIONS, relateFiles } from '../../src/shared/related-files';
import { relatedSort, relatedTreeCss } from '../../src/viewer/state/relatedTree';

const entry = (path: string): FileTreeSortEntry => {
  const isDirectory = path.endsWith('/');
  const segments = path.replace(/\/$/, '').split('/');
  return { path, segments, isDirectory, depth: segments.length, basename: segments.at(-1)! };
};

const paths = [
  'src/',
  'src/a10.ts',
  'src/a2.ts',
  'src/B.ts',
  'src/b.ts',
  'remote/',
  'remote/package-lock.json',
  'remote/package.json',
  'package-lock.json',
  'package.json',
  'yarn.lock',
  'README.md',
  'serverless-resources.yml',
  'serverless.yml',
];

describe('tree order with related files', () => {
  it('with no relations, is the library\'s own default order', () => {
    const ours = [...paths].map(entry).sort(relatedSort(() => NO_RELATIONS)).map((e) => e.path);
    const theirs = [...paths].map(entry).sort(comparePreparedPaths as (a: FileTreeSortEntry, b: FileTreeSortEntry) => number).map((e) => e.path);
    expect(ours).toEqual(theirs);
    expect(ours.indexOf('package-lock.json')).toBeLessThan(ours.indexOf('package.json'));
  });

  it('puts each companion right after its main file, in its main file\'s order', () => {
    const files = paths.filter((p) => !p.endsWith('/'));
    const relations = relateFiles(DEFAULT_RELATED_RULES, files);
    const sorted = [...paths].map(entry).sort(relatedSort(() => relations)).map((e) => e.path);
    expect(sorted).toEqual([
      'remote/',
      'remote/package.json',
      'remote/package-lock.json',
      'src/',
      'src/a2.ts',
      'src/a10.ts',
      'src/B.ts',
      'src/b.ts',
      'package.json',
      'package-lock.json',
      'yarn.lock',
      'README.md',
      'serverless.yml',
      'serverless-resources.yml',
    ]);
  });

  it('indents and dims every companion row, and only those', () => {
    const relations = relateFiles(DEFAULT_RELATED_RULES, ['package.json', 'package-lock.json', 'a "b".ts']);
    const css = relatedTreeCss(relations);
    expect(css).toContain('[data-item-path="package-lock.json"]');
    expect(css).not.toContain('[data-item-path="package.json"]');
    expect(relatedTreeCss(NO_RELATIONS)).toBe('');
  });
});
