import { describe, expect, it } from 'vitest';
import { chainExpanded, folderChains, noteExpansion } from '../../src/viewer/state/treeFolders';

describe('folder rows of a file tree', () => {
  const paths = ['a/b/c/one.ts', 'a/b/c/two.ts', 'a/d.ts', 'x/y/z.ts', 'top.ts'];

  it('merges a folder holding just one folder into one row with it, like @pierre/trees does', () => {
    expect(folderChains(paths, true)).toEqual([['a/'], ['a/b/', 'a/b/c/'], ['x/', 'x/y/']]);
  });

  it('without merging, every folder is its own row', () => {
    expect(folderChains(paths, false)).toEqual([['a/'], ['a/b/'], ['a/b/c/'], ['x/'], ['x/y/']]);
  });

  it('a folder holding a file and a folder is not merged', () => {
    expect(folderChains(['p/q/r.ts', 'p/s.ts'], true)).toEqual([['p/'], ['p/q/']]);
  });

  it('a row is open only if every folder it stands for was left open', () => {
    const seen = new Map<string, boolean>();
    // In one group the user closed a/ (its own row); a/b/c/ (a merged row there) stayed open.
    noteExpansion([['a/'], ['a/b/', 'a/b/c/']], (p) => (p === 'a/' ? false : true), seen);
    // Where a/, a/b/ and a/b/c/ are one row, it is closed.
    expect(chainExpanded(['a/', 'a/b/', 'a/b/c/'], seen)).toBe(false);
    // Opening that merged row opens every folder it stands for.
    noteExpansion([['a/', 'a/b/', 'a/b/c/']], () => true, seen);
    expect(chainExpanded(['a/'], seen)).toBe(true);
    expect(chainExpanded(['a/b/', 'a/b/c/'], seen)).toBe(true);
    // Folders never shown keep the tree's own state.
    expect(chainExpanded(['n/'], seen)).toBeUndefined();
  });
});
