/**
 * What the display option value 'default' means: the look of GitHub's own Files changed page.
 *
 * ---------------------------------------------------------------------------------------------------------
 * GitHub-default mapping (every option in DisplaySettings; "default" = DEFAULT_SETTINGS value)
 * ---------------------------------------------------------------------------------------------------------
 * option                     default      resolves to / means                 why (GitHub behaviour)
 * diff.diffStyle             'default'    'unified'                           GitHub's default diff view is Unified
 * diff.overflow              'default'    'wrap'                              GitHub diff cells wrap long lines
 *                                                                             (classic `.blob-code-inner { white-space: pre-wrap }`)
 * diff.lineDiffType          'default'    'word'                              GitHub highlights changed words
 * diff.diffIndicators        'default'    'classic'                           +/- signs in the line gutter
 * diff.hunkSeparators        'default'    'simple'                            no "@@ -a,b +c,d @@" rows (user request);
 *                                                                             a plain separator with the expand affordance
 * diff.themeLight/Dark       'default'    'github-light-default' /            GitHub's Primer syntax colors (Shiki's
 *                                         'github-dark-default'               bundled GitHub themes)
 * diff.themeType             'default'    'system' (follows GitHub's mode)    GitHub's default theme setting syncs with the OS
 * diff.lineHoverHighlight    'default'    'disabled'                          GitHub draws no row hover highlight
 * diff.changeColors          'default'    GitHub's diffBlob colors            see GITHUB_COLORS ('theme' = Pierre's)
 * diff.fileHeaderStyle       'default'    GitHub's file box (viewer.css)      gray bar, mono path, +/- counts, Viewed
 *                                                                             right-aligned, 1px border, 6px radius
 * diff.disableBackground     false        colored change lines                GitHub colors added/removed lines
 * diff.disableLineNumbers    false        line numbers shown                  GitHub shows both line numbers
 * diff.expandUnchanged       false        unchanged lines collapsed           GitHub collapses unchanged context
 * diff.expansionLineCount    20           20 lines per expand click           GitHub's expander reveals 20 lines
 * diff.collapsedContextThreshold 1        Pierre's value (no GitHub analogue)
 * diff.stickyHeader          true         file headers stick while scrolling  GitHub's file headers are sticky
 * diff.tokenizeMax* and maxLineDiffLength Pierre's limits (performance; no visible GitHub analogue)
 * diff.layoutGap/PaddingTop/Bottom 16     16 px between / around file boxes   GitHub's file boxes are 16 px apart
 * tree.initialExpansion      'default'    'open'                              GitHub's file tree starts expanded
 * tree.fileTreeSearchMode    'default'    'hide-non-matches'                  GitHub's filter lists only matching files
 * tree.searchBlurBehavior    'default'    'retain'                            GitHub keeps the filter text
 * tree.density               'default'    Pierre's 'default' (30 px rows)     closest to GitHub's ~32 px tree rows
 * tree.icons                 'default'    octicon file / folder icons         ./github-tree-icons.ts
 * tree.coloredIcons          true         (only affects Pierre's icon sets)
 * tree.flattenEmptyDirectories true       single-child folders compacted      GitHub compacts folder chains
 * tree.stickyFolders         false                                            GitHub's tree has no sticky folders
 * tree.search                true         filter box shown                    GitHub's "Filter files…" box
 * tree.showGitStatus         false        no A/M/D letters                    user request
 * fonts.*                    '' / 'default' GITHUB_FONTS                      GitHub's Primer font stacks, 12 px code
 * layout.treePosition        'left'                                           GitHub's tree is on the left
 * review.hideWhitespace      false                                            GitHub shows whitespace changes
 */
import type { DiffSettings, DisplaySettings, FontSettings, TreeSettings } from './settings';

// Not imported from ./settings (which imports this module): a literal keeps module evaluation order irrelevant.
const DEFAULT = 'default';
type Default = typeof DEFAULT;
type Resolved<T> = { [K in keyof T]: Exclude<T[K], Default> };

/** What each enumerated diff option's 'default' resolves to (table above). */
export const GITHUB_DIFF = Object.freeze({
  diffStyle: 'unified',
  overflow: 'wrap',
  lineDiffType: 'word',
  diffIndicators: 'classic',
  hunkSeparators: 'simple',
  themeLight: 'github-light-default',
  themeDark: 'github-dark-default',
  themeType: 'system',
  lineHoverHighlight: 'disabled',
} as const) satisfies Partial<Resolved<DiffSettings>>;

/** What each enumerated tree option's 'default' resolves to (icons: ./github-tree-icons.ts). */
export const GITHUB_TREE = Object.freeze({
  initialExpansion: 'open',
  fileTreeSearchMode: 'hide-non-matches',
  density: 'default',
  searchBlurBehavior: 'retain',
} as const) satisfies Partial<TreeSettings>;

type GithubDiffKey = keyof typeof GITHUB_DIFF;
export type ResolvedDiffSettings = Resolved<DiffSettings>;

/** One diff option's effective value: its GitHub value when it is 'default'. */
export function resolveDiffChoice<K extends GithubDiffKey>(key: K, value: DiffSettings[K]): Exclude<DiffSettings[K], Default> {
  return (value === DEFAULT ? GITHUB_DIFF[key] : value) as Exclude<DiffSettings[K], Default>;
}

/** Every diff option with 'default' resolved. */
export function resolveDiff(d: DiffSettings): ResolvedDiffSettings {
  const out = { ...d } as Record<string, unknown>;
  for (const key of Object.keys(GITHUB_DIFF) as GithubDiffKey[]) out[key] = resolveDiffChoice(key, d[key]);
  return out as ResolvedDiffSettings;
}

/**
 * GitHub's diff line colors (Primer `diffBlob` tokens). Light: the values the user asked for (#dafbe1 / #aceebb /
 * #ccffd8 and #ffebe9 / #ffcecb / #ffd7d5). Dark: Primer primitives 11.10.0, functional/themes/dark.css
 * (https://unpkg.com/@primer/primitives@11.10.0/dist/css/functional/themes/dark.css):
 * `--diffBlob-additionLine-bgColor` = bgColor-success-muted #2ea04326, `--diffBlob-additionWord-bgColor` #2ea04366,
 * `--diffBlob-additionNum-bgColor` #3fb9504d, `--diffBlob-deletionLine-bgColor` = bgColor-danger-muted #f851491a,
 * `--diffBlob-deletionWord-bgColor` #f8514966, `--diffBlob-deletionNum-bgColor` #f851494d.
 */
export const GITHUB_COLORS = Object.freeze({
  additionLine: { light: '#dafbe1', dark: '#2ea04326' },
  additionWord: { light: '#aceebb', dark: '#2ea04366' },
  additionNum: { light: '#ccffd8', dark: '#3fb9504d' },
  deletionLine: { light: '#ffebe9', dark: '#f851491a' },
  deletionWord: { light: '#ffcecb', dark: '#f8514966' },
  deletionNum: { light: '#ffd7d5', dark: '#f851494d' },
});

/** Pierre's override variables, each fed one GitHub color as a `light-dark()` pair. */
const COLOR_VARS: Record<string, keyof typeof GITHUB_COLORS> = {
  '--diffs-bg-addition-override': 'additionLine',
  '--diffs-bg-addition-emphasis-override': 'additionWord',
  '--diffs-bg-addition-number-override': 'additionNum',
  '--diffs-bg-deletion-override': 'deletionLine',
  '--diffs-bg-deletion-emphasis-override': 'deletionWord',
  '--diffs-bg-deletion-number-override': 'deletionNum',
};

/**
 * Diff `unsafeCSS` for GitHub's colors. Pierre uses the line/number overrides as a mix target (88-91% background,
 * the rest override), which would turn #dafbe1 nearly white; on change rows (code and gutter) the mix is set to
 * 0% so the override is the color. Hover and selection still mix on top as usual.
 */
export const GITHUB_CHANGE_CSS = `[data-background] [data-line-type^='change-'] { --mix-light: 0%; --mix-dark: 0%; }`;

/** GitHub's Primer font stacks and sizes. */
export const GITHUB_FONTS = Object.freeze({
  code: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
  ui: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji"',
  codeSize: 12,
  features: 'normal',
  /** GitHub's tree rows use the 14 px body text size. */
  treeSize: 14,
});

export interface ResolvedFonts {
  code: string;
  ui: string;
  codeSize: number;
  features: string;
}

const text = (value: string, fallback: string) => {
  const v = value.trim();
  return v === '' || v.toLowerCase() === DEFAULT ? fallback : v;
};

/** Effective fonts: blank or 'default' text and a 'default' size become GitHub's. */
export function resolveFonts(f: FontSettings): ResolvedFonts {
  return {
    code: text(f.codeFontFamily, GITHUB_FONTS.code),
    ui: text(f.uiFontFamily, GITHUB_FONTS.ui),
    codeSize: f.codeFontSize === DEFAULT ? GITHUB_FONTS.codeSize : f.codeFontSize,
    features: text(f.codeFontFeatures, GITHUB_FONTS.features),
  };
}

let lastVars: { fonts: FontSettings; colors: DiffSettings['changeColors']; vars: Readonly<Record<string, string>> } | undefined;

/**
 * CSS custom properties for the document root (inherited into Pierre's shadow roots): fonts for the diffs, the tree
 * and the viewer's own UI (`--pierre-font` / `--pierre-mono` in viewer.css), and GitHub's change colors when
 * `diff.changeColors` is 'default'. Memoized on its inputs, so callers can apply it once per settings change.
 */
export function toStyleVars(s: DisplaySettings): Readonly<Record<string, string>> {
  if (lastVars && lastVars.fonts === s.fonts && lastVars.colors === s.diff.changeColors) return lastVars.vars;
  const f = resolveFonts(s.fonts);
  const vars: Record<string, string> = {
    '--pierre-font': f.ui,
    '--pierre-mono': f.code,
    '--diffs-font-family': f.code,
    '--diffs-font-size': `${f.codeSize}px`,
    '--diffs-font-features': f.features,
    '--diffs-header-font-family': f.ui,
    '--trees-font-family-override': f.ui,
    '--trees-font-size-override': `${GITHUB_FONTS.treeSize}px`,
  };
  if (s.diff.changeColors === DEFAULT) {
    for (const [name, key] of Object.entries(COLOR_VARS)) vars[name] = `light-dark(${GITHUB_COLORS[key].light}, ${GITHUB_COLORS[key].dark})`;
  }
  lastVars = { fonts: s.fonts, colors: s.diff.changeColors, vars: Object.freeze(vars) };
  return lastVars.vars;
}

export { GITHUB_TREE_CSS, GITHUB_TREE_ICONS } from './github-tree-icons';
