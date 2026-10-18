/**
 * GitHub's file tree icons for @pierre/trees (`tree.icons: 'default'`): the plain octicons `file-16`,
 * `file-directory-fill-16`, `file-directory-open-fill-16`, `chevron-right-16` and `chevron-down-16` (Primer
 * Octicons 19.x, MIT; paths copied from https://unpkg.com/@primer/octicons@19.40.0/build/svg/).
 *
 * @pierre/trees has two icon slots: `file-tree-icon-file` for files and `file-tree-icon-chevron` for folders (it
 * draws no separate folder icon). The folder slot is remapped to one 40x16 symbol, chevron + 8 px gap + folder like
 * GitHub's tree, holding both states; which one shows is switched by custom properties that inherit into the `<use>` tree,
 * set by GITHUB_TREE_CSS on expanded folder rows (open: chevron-down + open folder; closed: chevron-right + closed
 * folder). That CSS widens every row's icon cell to 40 px (file icons right-aligned under their sibling folders'
 * icons; the tree's indent guides stay under the chevron), cancels the rotation the tree applies to a closed
 * folder's chevron, and colors the icons like GitHub's tree view (`--treeViewItem-leadingVisual-iconColor-rest`,
 * Primer primitives 11.x: folders #54aeff light / fgColor-muted dark, files and chevrons fgColor-muted).
 */
import type { FileTreeIconConfig } from '@pierre/trees';

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

const FILE_ICON = 'glide-octicon-file';
const FOLDER_ICON = 'glide-octicon-folder';

const SPRITE = `<svg data-glide-icons aria-hidden="true" width="0" height="0" style="position:absolute">
<symbol id="${FILE_ICON}" viewBox="0 0 16 16"><path d="${FILE}"/></symbol>
<symbol id="${FOLDER_ICON}" viewBox="0 0 40 16">
<g style="fill:var(--glide-chevron-color, currentColor)"><path style="display:var(--glide-folder-closed, inline)" d="${CHEVRON_RIGHT}"/><path style="display:var(--glide-folder-open, none)" d="${CHEVRON_DOWN}"/></g>
<g transform="translate(24 0)"><path style="display:var(--glide-folder-closed, inline)" d="${FOLDER}"/><path style="display:var(--glide-folder-open, none)" d="${FOLDER_OPEN}"/></g>
</symbol>
</svg>`;

/** `icons` for @pierre/trees: no built-in set, every file the octicon file, every folder the octicon folder. */
export const GITHUB_TREE_ICONS: FileTreeIconConfig = Object.freeze({
  set: 'none',
  colored: false,
  spriteSheet: SPRITE,
  remap: Object.freeze({
    'file-tree-icon-file': FILE_ICON,
    'file-tree-icon-chevron': Object.freeze({ name: FOLDER_ICON, width: 40, height: 16, viewBox: '0 0 40 16' }),
  }),
}) as FileTreeIconConfig;

/** Tree `unsafeCSS` that goes with GITHUB_TREE_ICONS (runs in the tree's `unsafe` cascade layer, after its own). */
export const GITHUB_TREE_CSS = `
[data-item-section="icon"] {
  width: 40px;
  justify-content: flex-end;
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
`;
