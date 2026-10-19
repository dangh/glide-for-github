/**
 * GitHub's file tree look for @pierre/trees (`tree.icons: 'default'`): the octicons `file-16`, `file-added-16`,
 * `file-diff-16`, `file-moved-16`, `file-removed-16`, `file-directory-fill-16`, `file-directory-open-fill-16`,
 * `chevron-right-16`, `chevron-down-16` and `search-16` (Primer Octicons 19.x, MIT; paths copied from
 * https://unpkg.com/@primer/octicons@19.40.0/build/svg/), and the palette and spacing of GitHub's tree view.
 *
 * @pierre/trees has two icon slots: `file-tree-icon-file` for files and `file-tree-icon-chevron` for folders (it
 * draws no separate folder icon). The folder slot is remapped to one 40x16 symbol, chevron + 8 px gap + folder like
 * GitHub's tree, holding both states; which one shows is switched by custom properties that inherit into the `<use>` tree,
 * set by GITHUB_TREE_CSS on expanded folder rows (open: chevron-down + open folder; closed: chevron-right + closed
 * folder). That CSS widens every row's icon cell to 40 px (file icons right-aligned under their sibling folders'
 * icons), cancels the rotation the tree applies to a closed folder's chevron, and colors the icons like GitHub's tree
 * view (`--treeViewItem-leadingVisual-iconColor-rest`, Primer primitives 11.x: folders #54aeff light / fgColor-muted
 * dark, files and chevrons fgColor-muted).
 *
 * The file slot picks its glyph by the row's `data-item-git-status` the same way (GitHub's tree shows a file's change
 * status as its icon), so the tree needs `gitStatus` whenever these icons are on; HIDE_GIT_STATUS_CSS then hides the
 * tree's own A/M/D letters and status colors while `tree.showGitStatus` is off.
 */
import type { FileTreeIconConfig, GitStatus } from '@pierre/trees';

/** The statuses a PR file can have (FileSummary['status']), in @pierre/trees' `gitStatus` names. */
type FileStatus = Extract<GitStatus, 'added' | 'modified' | 'renamed' | 'deleted'>;

const FILE =
  'M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9.5a.25.25 0 0 0 .25-.25V6h-2.75A1.75 1.75 0 0 1 9 4.25V1.5Zm6.75.062V4.25c0 .138.112.25.25.25h2.688l-.011-.013-2.914-2.914-.013-.011Z';
const FOLDER =
  'M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75Z';
export const CHEVRON_RIGHT =
  'M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z';
export const CHEVRON_DOWN =
  'M12.78 5.22a.749.749 0 0 1 0 1.06l-4.25 4.25a.749.749 0 0 1-1.06 0L3.22 6.28a.749.749 0 1 1 1.06-1.06L8 8.939l3.72-3.719a.749.749 0 0 1 1.06 0Z';
const FOLDER_OPEN =
  'M.513 1.513A1.75 1.75 0 0 1 1.75 1h3.5c.55 0 1.07.26 1.4.7l.9 1.2a.25.25 0 0 0 .2.1H13a1 1 0 0 1 1 1v.5H2.75a.75.75 0 0 0 0 1.5h11.978a1 1 0 0 1 .994 1.117L15 13.25A1.75 1.75 0 0 1 13.25 15H1.75A1.75 1.75 0 0 1 0 13.25V2.75c0-.464.184-.91.513-1.237Z';
const SEARCH =
  'M10.68 11.74a6 6 0 0 1-7.922-8.982 6 6 0 0 1 8.982 7.922l3.04 3.04a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215ZM11.5 7a4.499 4.499 0 1 0-8.997 0A4.499 4.499 0 0 0 11.5 7Z';

/**
 * GitHub's tree icon per file status and its color, as measured on /pull/N/changes: added `file-added` in
 * fgColor-success, modified `file-diff` in fgColor-muted, renamed `file-moved` in fgColor-attention, deleted
 * `file-removed` in fgColor-danger (Primer primitives 11.x light / dark).
 */
const STATUS_ICONS: Record<FileStatus, { paths: readonly string[]; color: string }> = {
  added: {
    paths: [
      'M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9.5a.25.25 0 0 0 .25-.25V4.664a.25.25 0 0 0-.073-.177l-2.914-2.914a.25.25 0 0 0-.177-.073Zm4.48 3.758a.75.75 0 0 1 .755.745l.01 1.497h1.497a.75.75 0 0 1 0 1.5H9v1.507a.75.75 0 0 1-1.5 0V9.005l-1.502.01a.75.75 0 0 1-.01-1.5l1.507-.01-.01-1.492a.75.75 0 0 1 .745-.755Z',
    ],
    color: 'light-dark(#1a7f37, #3fb950)',
  },
  modified: {
    paths: [
      'M1 1.75C1 .784 1.784 0 2.75 0h7.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16H2.75A1.75 1.75 0 0 1 1 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h10.5a.25.25 0 0 0 .25-.25V4.664a.25.25 0 0 0-.073-.177l-2.914-2.914a.25.25 0 0 0-.177-.073ZM8 3.25a.75.75 0 0 1 .75.75v1.5h1.5a.75.75 0 0 1 0 1.5h-1.5v1.5a.75.75 0 0 1-1.5 0V7h-1.5a.75.75 0 0 1 0-1.5h1.5V4A.75.75 0 0 1 8 3.25Zm-3 8a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1-.75-.75Z',
    ],
    color: 'light-dark(#59636e, #9198a1)',
  },
  renamed: {
    paths: [
      'M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-3.5a.75.75 0 0 1 0-1.5h3.5a.25.25 0 0 0 .25-.25V4.664a.25.25 0 0 0-.073-.177l-2.914-2.914a.25.25 0 0 0-.177-.073H3.75a.25.25 0 0 0-.25.25v6.5a.75.75 0 0 1-1.5 0v-6.5Z',
      'm5.427 15.573 3.146-3.146a.25.25 0 0 0 0-.354L5.427 8.927A.25.25 0 0 0 5 9.104V11.5H.75a.75.75 0 0 0 0 1.5H5v2.396c0 .223.27.335.427.177Z',
    ],
    color: 'light-dark(#9a6700, #d29922)',
  },
  deleted: {
    paths: [
      'M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9.5a.25.25 0 0 0 .25-.25V4.664a.25.25 0 0 0-.073-.177l-2.914-2.914a.25.25 0 0 0-.177-.073Zm4.5 6h2.242a.75.75 0 0 1 0 1.5h-2.24l-2.254.015a.75.75 0 0 1-.01-1.5Z',
    ],
    color: 'light-dark(#d1242f, #f85149)',
  },
};
const STATUSES = Object.keys(STATUS_ICONS) as FileStatus[];

const FILE_ICON = 'glide-octicon-file';
const FOLDER_ICON = 'glide-octicon-folder';

const statusGlyphs = STATUSES.map(
  (s) => `<g style="display:var(--glide-file-${s}, none)">${STATUS_ICONS[s].paths.map((d) => `<path d="${d}"/>`).join('')}</g>`,
).join('\n');

const SPRITE = `<svg data-glide-icons aria-hidden="true" width="0" height="0" style="position:absolute">
<symbol id="${FILE_ICON}" viewBox="0 0 16 16"><path style="display:var(--glide-file-plain, inline)" d="${FILE}"/>
${statusGlyphs}
</symbol>
<symbol id="${FOLDER_ICON}" viewBox="0 0 40 16">
<g style="fill:var(--glide-chevron-color, currentColor)"><path style="display:var(--glide-folder-closed, inline)" d="${CHEVRON_RIGHT}"/><path style="display:var(--glide-folder-open, none)" d="${CHEVRON_DOWN}"/></g>
<g transform="translate(24 0)"><path style="display:var(--glide-folder-closed, inline)" d="${FOLDER}"/><path style="display:var(--glide-folder-open, none)" d="${FOLDER_OPEN}"/></g>
</symbol>
</svg>`;

/** `icons` for @pierre/trees: no built-in set, every file the octicon file (by status), every folder the octicon folder. */
export const GITHUB_TREE_ICONS: FileTreeIconConfig = Object.freeze({
  set: 'none',
  colored: false,
  spriteSheet: SPRITE,
  remap: Object.freeze({
    'file-tree-icon-file': FILE_ICON,
    'file-tree-icon-chevron': Object.freeze({ name: FOLDER_ICON, width: 40, height: 16, viewBox: '0 0 40 16' }),
  }),
}) as FileTreeIconConfig;

const statusRules = STATUSES.map(
  (s) => `[data-item-git-status="${s}"] > [data-item-section="icon"] {
  --glide-file-plain: none;
  --glide-file-${s}: inline;
  color: ${STATUS_ICONS[s].color};
}`,
).join('\n');

const searchMask = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='${SEARCH}'/%3E%3C/svg%3E")`;

/**
 * Tree `unsafeCSS` that goes with GITHUB_TREE_ICONS (runs in the tree's `unsafe` cascade layer, after its own).
 * Palette: GitHub's tree view on /pull/N/changes, Primer primitives 11.x fgColor-default (#1f2328 / #f0f6fc) on
 * bgColor-default (#ffffff / #0d1117); hover and selection control-transparent-bgColor-hover (#818b981a / #656c7633)
 * and -selected (#818b981f light, proposed; #656c7633 dark, measured). Spacing as measured there: rows flush with
 * the pane, chevron + 8 + folder + 8 before the name, 8 px indent per level (indent guides under the parent's
 * chevron), the "Filter files…" box 32 px tall with a 16 px search icon, 16 px above and below it. The 1 px side faces
 * the page edge and the 16 px side the divider: `--glide-tree-start` / `--glide-tree-end` (viewer.css) swap them when
 * the tree sits on the right.
 */
export const GITHUB_TREE_CSS = `
:host {
  --trees-fg-override: light-dark(#1f2328, #f0f6fc);
  --trees-bg-override: light-dark(#ffffff, #0d1117);
  --trees-bg-muted-override: light-dark(#818b981a, #656c7633);
  --trees-selected-fg-override: light-dark(#1f2328, #f0f6fc);
  --trees-selected-bg-override: light-dark(#818b981f, #656c7633);
  --trees-border-color-override: light-dark(#d1d9e0, #3d444d);
  --trees-search-bg-override: light-dark(#ffffff, #0d1117);
  --trees-focus-ring-color-override: light-dark(#0969da, #1f6feb);
  --trees-padding-inline-override: 1px;
  --trees-item-margin-x-override: 0px;
  --trees-item-padding-x-override: 0px;
  --trees-item-row-gap-override: 8px;
}
[data-type="item"] {
  padding-inline-end: 8px;
}
[data-item-section="decoration"] {
  min-width: max-content;
}
[data-file-tree-virtualized-scroll="true"] {
  padding-inline: var(--glide-tree-start, 1px) var(--glide-tree-end, 16px);
}
[data-file-tree-search-container] {
  position: relative;
  padding: 16px var(--glide-tree-end, 16px) 0 var(--glide-tree-start, 1px);
  margin-bottom: 16px;
}
[data-file-tree-search-container]::before {
  content: "";
  position: absolute;
  left: calc(var(--glide-tree-start, 1px) + 9px);
  top: 24px;
  width: 16px;
  height: 16px;
  background-color: light-dark(#59636e, #9198a1);
  mask: ${searchMask} no-repeat;
  pointer-events: none;
}
[data-file-tree-search-input] {
  box-sizing: border-box;
  height: 32px;
  line-height: 30px;
  margin-block: 0;
  padding: 0 8px 0 32px;
}
[data-file-tree-search-input]::placeholder {
  color: light-dark(#59636e, #9198a1);
}
[data-item-section="spacing"] {
  padding-left: 0;
  margin-right: -8px;
}
[data-item-section="spacing-item"] {
  box-sizing: border-box;
  width: 8px;
  margin: 0;
  border-left: 0;
  border-right: 1px solid var(--trees-indent-guide-bg);
  transform: none;
}
[data-item-section="icon"] {
  width: 40px;
  justify-content: flex-end;
}
[data-item-section="icon"] > [data-icon-name] {
  color: inherit;
}
[data-item-type="folder"] > [data-item-section="icon"] {
  color: light-dark(#54aeff, #9198a1);
  --glide-chevron-color: light-dark(#59636e, #9198a1);
}
[data-item-type="folder"] > [data-item-section="icon"] > [data-icon-name="file-tree-icon-chevron"] {
  transform: none;
}
[aria-expanded="true"][data-item-type="folder"] > [data-item-section="icon"] {
  --glide-folder-closed: none;
  --glide-folder-open: inline;
}
[data-item-type="file"] > [data-item-section="icon"] {
  color: light-dark(#59636e, #9198a1);
}
${statusRules}
`;

/** Tree `unsafeCSS` for GitHub's icons with `tree.showGitStatus` off: the status picks the icon, nothing else shows it. */
export const HIDE_GIT_STATUS_CSS = `
[data-item-section="git"] {
  display: none;
}
[data-item-git-status] > [data-item-section="content"] {
  color: inherit;
}
`;
