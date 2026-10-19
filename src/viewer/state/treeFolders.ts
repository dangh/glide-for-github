/**
 * The tree's folder rows across file group switches. With "Flatten single-child folders" (@pierre/trees'
 * `flattenEmptyDirectories`) a folder holding just one folder shares a row with it ("crates/react_compiler/src"),
 * and which folders merge depends on the files shown, so one group can show as one row what another shows as
 * several. A row's open state is its last folder's; these helpers carry it over by folder path.
 */

/** Each folder row's folders, top first (`a/`, `a/b/`): one per row, or a merged chain. */
export function folderChains(paths: readonly string[], flatten: boolean): string[][] {
  /** Folder → its child entries (folders end in "/"). */
  const children = new Map<string, Set<string>>([['', new Set()]]);
  for (const path of paths) {
    const parts = path.split('/');
    let parent = '';
    for (let i = 0; i < parts.length; i++) {
      const isFolder = i < parts.length - 1;
      const entry = parent + parts[i] + (isFolder ? '/' : '');
      children.get(parent)!.add(entry);
      if (!isFolder) break;
      if (!children.has(entry)) children.set(entry, new Set());
      parent = entry;
    }
  }
  /** The folder a folder merges with: its only entry, when that is a folder. */
  const mergesWith = (folder: string): string | undefined => {
    if (!flatten) return undefined;
    const kids = children.get(folder)!;
    const [only] = kids;
    return kids.size === 1 && only!.endsWith('/') ? only : undefined;
  };
  const chains: string[][] = [];
  const walk = (folder: string) => {
    for (const entry of children.get(folder)!) {
      if (!entry.endsWith('/')) continue;
      const chain = [entry];
      for (let next = mergesWith(entry); next; next = mergesWith(next)) chain.push(next);
      chains.push(chain);
      walk(chain.at(-1)!);
    }
  };
  walk('');
  return chains;
}

/** Records each row's open state (`expanded(last folder)`) for every folder the row stands for. */
export function noteExpansion(chains: readonly string[][], expanded: (folder: string) => boolean | undefined, seen: Map<string, boolean>): void {
  for (const chain of chains) {
    const open = expanded(chain.at(-1)!);
    if (open !== undefined) for (const folder of chain) seen.set(folder, open);
  }
}

/** A row's state from what was seen: open only if every folder it stands for was left open; undefined if none was seen. */
export function chainExpanded(chain: readonly string[], seen: ReadonlyMap<string, boolean>): boolean | undefined {
  const known = chain.map((f) => seen.get(f)).filter((v): v is boolean => v !== undefined);
  return known.length === 0 ? undefined : known.every(Boolean);
}
