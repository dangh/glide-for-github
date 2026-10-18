/**
 * Display settings: the single schema behind the viewer's Display menu (Task 7) and the options page (Task 13).
 *
 * Persistence: one `chrome.storage.sync` item (`pierre.settings`) holding only the user's validated overrides
 * (sparse). Loading overlays them on `DEFAULT_SETTINGS`, so a future change of a Pierre default reaches users
 * who never touched that option, and the item stays far below the 8 KB per-item sync quota.
 *
 * ---------------------------------------------------------------------------------------------------------
 * 'default' (feedback round 1): every enumerated option also takes the value 'default', listed first and labelled
 * "Default (GitHub)"; it resolves to the value that looks most like GitHub's Files changed page (the mapping table
 * and the colors / fonts / icons live in ./github-defaults.ts). DEFAULT_SETTINGS uses 'default' wherever it
 * applies; booleans and numbers default to their GitHub-closest values (table in ./github-defaults.ts). Explicit
 * values stored by older versions keep working as overrides; invalid values fall back to the default.
 *
 * Option inventory (derived from the installed @pierre/diffs 1.5.x and @pierre/trees 1.0.0-beta.6 .d.ts/.js).
 * The "default" column below is Pierre's own default, i.e. what an explicit choice of that value means.
 * ---------------------------------------------------------------------------------------------------------
 * Diff options are the ones accepted by the React `CodeViewReactOptions`, i.e. the pass-through keys listed in
 * `CODE_VIEW_DIFF_OPTION_KEYS` plus the CodeView-level keys (diffs/dist/components/CodeView.d.ts), which
 * narrow `BaseCodeOptions` / `BaseDiffOptions` (diffs/dist/types.d.ts) and `InteractionManagerBaseOptions`.
 *
 * INCLUDED, diff (default / where the default comes from):
 *   diffStyle                 'split' | 'unified'                         'split'    DiffHunksRenderer.js getOptionsWithDefaults
 *   overflow                  'scroll' | 'wrap'                           'scroll'   same
 *   lineDiffType              'word-alt'|'word-line'|'word'|'char'|'none' 'word-alt' same
 *   diffIndicators            'classic' | 'bars' | 'none'                 'bars'     same
 *   disableBackground         boolean                                     false      same
 *   disableLineNumbers        boolean                                     false      same
 *   hunkSeparators            'line-info'|'line-info-basic'|'metadata'|'simple'   'line-info'   same ('custom' is
 *                             deprecated and CodeViewOptions excludes it)
 *   expandUnchanged           boolean                                     false      same
 *   expansionLineCount        positive integer                            100        same
 *   collapsedContextThreshold non-negative integer                        1          DEFAULT_COLLAPSED_CONTEXT_THRESHOLD (constants)
 *   stickyHeader              boolean                                     false      same renderer default. NOTE: CodeView takes
 *                             this as `stickyHeaders` (plural, CodeViewOptions); `BaseCodeOptions.stickyHeader` is not in
 *                             CodeViewReactOptions, so toDiffOptions emits `stickyHeaders`.
 *   themeLight / themeDark    bundled theme names (LIGHT_THEMES / DARK_THEMES below; unknown names fall back to the default)
 *                                                                         'pierre-light' / 'pierre-dark'   DEFAULT_THEMES (constants)
 *   themeType                 'system' | 'light' | 'dark'                 'system'   File.js / FileDiff.js (`themeType = "system"`)
 *   lineHoverHighlight        'disabled' | 'both' | 'number' | 'line'     'disabled' InteractionManager.js (`lineHoverHighlight = "disabled"`)
 *   tokenizeMaxLineLength     positive integer                            1000       DiffHunksRenderer.js (`1e3`)
 *   tokenizeMaxLength         positive integer (total chars tokenized)    100000     DEFAULT_TOKENIZE_MAX_LENGTH (constants)
 *   maxLineDiffLength         positive integer                            1000       same (`maxLineDiffLength = 1e3`)
 *   layoutGap / layoutPaddingTop / layoutPaddingBottom   non-negative integers (px; CodeViewOptions.layout)
 *                                                                         8 / 8 / 8  DEFAULT_CODE_VIEW_LAYOUT (constants); gap =
 *                             spacing between file cards, padding = space above the first / below the last card
 *
 * INCLUDED, tree (@pierre/trees `FileTreeOptions`):
 *   flattenEmptyDirectories   boolean                                     true       path-store/src/options.js (`!== false`)
 *   initialExpansion          'open' | 'closed' | non-negative integer    'closed'   path-store/src/store.js (`?? "closed"`)
 *   fileTreeSearchMode        'expand-matches'|'collapse-non-matches'|'hide-non-matches'   'hide-non-matches'   FileTreeController.js
 *   density                   'compact'|'default'|'relaxed' | number>0    'default'  model/density.js (`density ?? "default"`)
 *   icons                     'minimal' | 'standard' | 'complete'         'complete' iconConfig.js normalizeFileTreeIcons
 *   coloredIcons              boolean (FileTreeIconConfig.colored)        true       iconConfig.js (`colored ?? true`)
 *   stickyFolders             boolean                                     false      render/FileTreeView.js (`stickyFolders = false`)
 *   search                    boolean (shows the search input)            true       EXTENSION DEFAULT (controller ruling: the approved
 *                             layout mockup has a "Filter files" box above the tree). Pierre's own default is false
 *                             (render/FileTreeView.js `searchEnabled = false`).
 *   searchBlurBehavior        'close' | 'retain'                          'close'    render/FileTreeView.js (`searchBlurBehavior = "close"`)
 *
 * INCLUDED, review: hideWhitespace (boolean, default false; extension-owned, not a Pierre option).
 *
 * INCLUDED, extension-owned (feedback round 1):
 *   diff.changeColors         'default' (GitHub's diffBlob colors) | 'theme' (Pierre's theme-derived colors)
 *   diff.fileHeaderStyle      'default' (GitHub file box) | 'pierre' (Glide's flat header bar)
 *   tree.showGitStatus        boolean, false: A/M/D letters and folder roll-ups (@pierre/trees `gitStatus`)
 *   fonts.*                   codeFontFamily / uiFontFamily / codeFontFeatures (free text, '' or 'default' = GitHub's),
 *                             codeFontSize ('default' = 12 px, or 8-32 px). The text goes into CSS custom properties,
 *                             so it is at most 300 chars and never contains ; { } < >.
 *   layout.treePosition       'left' | 'right', default 'left'
 *   layout.showTree           boolean, true: the file tree pane (the toolbar's file tree button, like GitHub's)
 *   experiments.pageScroll    boolean, false: GitHub's page scrolls the diffs (src/shared/page-scroll.ts), not the viewer
 *   experiments.mergedBar     boolean, false: GitHub's sticky PR header folds into Glide's toolbar (only with pageScroll)
 *   github.replaceFilesTab    boolean, false: GitHub's Files changed tab is hidden and its page opens Glide instead
 *
 * EXCLUDED, with reasons:
 *   preferredHighlighter        not a user option: toDiffOptions always sets 'shiki-js' (global no-WASM constraint)
 *   theme as a single string    covered by themeLight/themeDark (the extension always passes the light/dark pair)
 *   disableFileHeader           the viewer's per-file header hosts its own collapse/viewed controls
 *   collapsed                   per-item state, driven by the viewer
 *   disableVirtualizationBuffers, useCSSClasses, useTokenTransformer, itemMetrics,
 *   pointerEventsOnScroll, smoothScrollSettings, __devOnlyValidateItemHeights, __debugPointerEvents,
 *   disableErrorHandling        internal / perf / virtualization tuning, not reader-facing display choices
 *   unsafeCSS                   arbitrary CSS injection (diffs and trees)
 *   parseDiffOptions, loadDiffFiles   diff computation / data loading; hideWhitespace is handled in `review`
 *   enableGutterUtility, enableLineSelection, controlledSelection, enableTokenInteractionsOnWhitespace
 *                               interaction wiring owned by the viewer (or inert without token callbacks)
 *   lineAnnotations, items, createEditor, edit, onItemEdit*   data / editing mode / merge-conflict UI
 *   every callback and render hook (render*, on*, getEditStateKey, ...)
 *   trees: sort (only 'default' or a comparator function, which cannot be persisted), itemHeight (follows density;
 *     'default' gets GitHub's 32 px), overscan / initialVisibleRowCount (virtualization perf), searchFakeFocus (demo/test aid),
 *     dragAndDrop / renaming (editing), composition / renderRowDecoration (render hooks), gitStatus / paths /
 *     preparedInput / initialExpandedPaths / initialSelectedPaths / initialSearchQuery / id (data, set by the viewer),
 *     icons object form beyond {set, colored} (custom sprite sheets and remaps)
 */
import type { DiffIndicators, HunkSeparators, LineDiffTypes, ThemeTypes } from '@pierre/diffs';
import type { CodeViewReactOptions } from '@pierre/diffs/react';
import type {
  FileTreeBuiltInIconSet,
  FileTreeDensity,
  FileTreeInitialExpansion,
  FileTreeOptions,
  FileTreeSearchBlurBehavior,
  FileTreeSearchMode,
} from '@pierre/trees';
import { DIFF_CSS, GITHUB_CHANGE_CSS, GITHUB_HUNK_CSS, GITHUB_TREE, GITHUB_TREE_ROW_HEIGHT, resolveDiff } from './github-defaults';
import { GITHUB_TREE_CSS, GITHUB_TREE_ICONS, HIDE_GIT_STATUS_CSS } from './github-tree-icons';
import { SETTINGS_STORAGE_KEY, type ExperimentSettings } from './experiments';
import type { GithubSettings } from './github-settings';

export { SETTINGS_STORAGE_KEY, type ExperimentSettings, type GithubSettings };

// ---------------------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------------------

/** `InteractionManagerBaseOptions['lineHoverHighlight']`, which @pierre/diffs does not export as its own type. */
export type LineHoverHighlight = 'disabled' | 'both' | 'number' | 'line';

/** The choice that resolves to GitHub's look (see ./github-defaults.ts). */
export const DEFAULT_CHOICE = 'default';
export type Default = typeof DEFAULT_CHOICE;
type OrDefault<T> = Default | T;

export interface DiffSettings {
  diffStyle: OrDefault<'split' | 'unified'>;
  overflow: OrDefault<'scroll' | 'wrap'>;
  lineDiffType: OrDefault<LineDiffTypes>;
  diffIndicators: OrDefault<DiffIndicators>;
  disableBackground: boolean;
  disableLineNumbers: boolean;
  hunkSeparators: OrDefault<Exclude<HunkSeparators, 'custom'>>;
  expandUnchanged: boolean;
  expansionLineCount: number;
  collapsedContextThreshold: number;
  stickyHeader: boolean;
  /** A bundled light theme name, or 'default'. */
  themeLight: string;
  /** A bundled dark theme name, or 'default'. */
  themeDark: string;
  themeType: OrDefault<ThemeTypes>;
  lineHoverHighlight: OrDefault<LineHoverHighlight>;
  /** Addition/deletion backgrounds: GitHub's colors, or the ones Pierre derives from the theme. */
  changeColors: OrDefault<'theme'>;
  /** Per-file header look: GitHub's file box, or Glide's flat bar. */
  fileHeaderStyle: OrDefault<'pierre'>;
  tokenizeMaxLineLength: number;
  tokenizeMaxLength: number;
  maxLineDiffLength: number;
  layoutGap: number;
  layoutPaddingTop: number;
  layoutPaddingBottom: number;
}

export interface TreeSettings {
  flattenEmptyDirectories: boolean;
  initialExpansion: OrDefault<FileTreeInitialExpansion>;
  fileTreeSearchMode: OrDefault<FileTreeSearchMode>;
  /** Pierre's own density keyword 'default' doubles as ours: Pierre's 'default' spacing with GitHub's 32 px rows. */
  density: FileTreeDensity;
  icons: OrDefault<FileTreeBuiltInIconSet>;
  coloredIcons: boolean;
  stickyFolders: boolean;
  search: boolean;
  searchBlurBehavior: OrDefault<FileTreeSearchBlurBehavior>;
  /** A/M/D letters (and folder roll-ups) in the tree. */
  showGitStatus: boolean;
}

export interface FontSettings {
  /** CSS font-family list for code; '' or 'default' = GitHub's monospace stack. */
  codeFontFamily: string;
  /** CSS font-family list for the viewer's own UI and the tree; '' or 'default' = GitHub's system stack. */
  uiFontFamily: string;
  /** Code font size in px (FONT_SIZE_MIN-FONT_SIZE_MAX), or 'default' (12 px). */
  codeFontSize: OrDefault<number>;
  /** CSS font-feature-settings for code; '' or 'default' = normal. */
  codeFontFeatures: string;
}

export interface LayoutSettings {
  treePosition: 'left' | 'right';
  /** The file tree pane is shown (GitHub's "Collapse file tree" / "Expand file tree" button). */
  showTree: boolean;
}

export interface ReviewSettings {
  hideWhitespace: boolean;
}

export interface DisplaySettings {
  diff: DiffSettings;
  tree: TreeSettings;
  fonts: FontSettings;
  layout: LayoutSettings;
  review: ReviewSettings;
  experiments: ExperimentSettings;
  github: GithubSettings;
}

/** The sections of `DisplaySettings`, in storage order. */
export const SETTINGS_SECTIONS = ['diff', 'tree', 'fonts', 'layout', 'review', 'experiments', 'github'] as const;

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

// ---------------------------------------------------------------------------------------------------------
// Choices (single source for menus; validators below reuse them)
// ---------------------------------------------------------------------------------------------------------

const DIFF_STYLES = ['split', 'unified'] as const;
const OVERFLOWS = ['scroll', 'wrap'] as const;
const LINE_DIFF_TYPES = ['word-alt', 'word-line', 'word', 'char', 'none'] as const;
const DIFF_INDICATORS = ['classic', 'bars', 'none'] as const;
const HUNK_SEPARATORS = ['line-info', 'line-info-basic', 'metadata', 'simple'] as const;
const THEME_TYPES = ['system', 'light', 'dark'] as const;
const LINE_HOVER_HIGHLIGHTS = ['disabled', 'both', 'number', 'line'] as const;
const SEARCH_MODES = ['expand-matches', 'collapse-non-matches', 'hide-non-matches'] as const;
const ICON_SETS = ['minimal', 'standard', 'complete'] as const;
const SEARCH_BLUR_BEHAVIORS = ['close', 'retain'] as const;
const DENSITY_KEYWORDS = ['compact', 'default', 'relaxed'] as const;
const EXPANSION_KEYWORDS = ['open', 'closed'] as const;
const CHANGE_COLORS = ['theme'] as const;
const FILE_HEADER_STYLES = ['pierre'] as const;
const TREE_POSITIONS = ['left', 'right'] as const;
/** A choice list with 'default' first. */
const withDefault = <const L extends readonly string[]>(list: L) => [DEFAULT_CHOICE, ...list] as const;

/**
 * Themes Pierre can load by name: the `@pierre/theming` bundled collection (Pierre's own plus Shiki's), split by
 * color scheme. Listed statically so this module stays free of the theme loaders; tests/unit/settings.test.ts
 * compares both lists with the installed collection, so an upgrade that adds or drops a theme fails the test.
 */
export const LIGHT_THEMES = [
  'pierre-light', 'pierre-light-soft', 'pierre-light-vibrant', 'pierre-light-protanopia-deuteranopia', 'pierre-light-tritanopia',
  'ayu-light', 'catppuccin-latte', 'everforest-light', 'github-light', 'github-light-default', 'github-light-high-contrast',
  'gruvbox-light-hard', 'gruvbox-light-medium', 'gruvbox-light-soft', 'horizon-bright', 'kanagawa-lotus', 'light-plus',
  'material-theme-lighter', 'min-light', 'night-owl-light', 'one-light', 'rose-pine-dawn', 'slack-ochin', 'snazzy-light',
  'solarized-light', 'vitesse-light',
] as const;
export const DARK_THEMES = [
  'pierre-dark', 'pierre-dark-soft', 'pierre-dark-vibrant', 'pierre-dark-protanopia-deuteranopia', 'pierre-dark-tritanopia',
  'andromeeda', 'aurora-x', 'ayu-dark', 'ayu-mirage', 'catppuccin-frappe', 'catppuccin-macchiato', 'catppuccin-mocha', 'dark-plus',
  'dracula', 'dracula-soft', 'everforest-dark', 'github-dark', 'github-dark-default', 'github-dark-dimmed', 'github-dark-high-contrast',
  'gruvbox-dark-hard', 'gruvbox-dark-medium', 'gruvbox-dark-soft', 'horizon', 'houston', 'kanagawa-dragon', 'kanagawa-wave', 'laserwave',
  'material-theme', 'material-theme-darker', 'material-theme-ocean', 'material-theme-palenight', 'min-dark', 'monokai', 'night-owl', 'nord',
  'one-dark-pro', 'plastic', 'poimandres', 'red', 'rose-pine', 'rose-pine-moon', 'slack-dark', 'solarized-dark', 'synthwave-84',
  'tokyo-night', 'vesper', 'vitesse-black', 'vitesse-dark',
] as const;
const ALL_THEMES: readonly string[] = [DEFAULT_CHOICE, ...LIGHT_THEMES, ...DARK_THEMES];

/** Compile-time proof that a choice list covers every member of the library union (fails typecheck if Pierre adds one). */
type Covers<Union, List extends readonly unknown[]> = [Exclude<Union, Default>] extends [List[number]] ? true : never;
const _exhaustive: [
  Covers<DiffSettings['diffStyle'], typeof DIFF_STYLES>,
  Covers<DiffSettings['overflow'], typeof OVERFLOWS>,
  Covers<DiffSettings['lineDiffType'], typeof LINE_DIFF_TYPES>,
  Covers<DiffSettings['diffIndicators'], typeof DIFF_INDICATORS>,
  Covers<DiffSettings['hunkSeparators'], typeof HUNK_SEPARATORS>,
  Covers<DiffSettings['themeType'], typeof THEME_TYPES>,
  Covers<DiffSettings['lineHoverHighlight'], typeof LINE_HOVER_HIGHLIGHTS>,
  Covers<TreeSettings['fileTreeSearchMode'], typeof SEARCH_MODES>,
  Covers<TreeSettings['icons'], typeof ICON_SETS>,
  Covers<TreeSettings['searchBlurBehavior'], typeof SEARCH_BLUR_BEHAVIORS>,
  Covers<Extract<TreeSettings['density'], string>, typeof DENSITY_KEYWORDS>,
  Covers<Exclude<Extract<TreeSettings['initialExpansion'], string>, Default>, typeof EXPANSION_KEYWORDS>,
] = [true, true, true, true, true, true, true, true, true, true, true, true];
void _exhaustive;

/** Allowed values for every enumerated setting, keyed like `DisplaySettings` (drives Display menu / options page controls). */
export const SETTING_CHOICES = {
  diff: {
    diffStyle: withDefault(DIFF_STYLES),
    overflow: withDefault(OVERFLOWS),
    lineDiffType: withDefault(LINE_DIFF_TYPES),
    diffIndicators: withDefault(DIFF_INDICATORS),
    hunkSeparators: withDefault(HUNK_SEPARATORS),
    themeType: withDefault(THEME_TYPES),
    lineHoverHighlight: withDefault(LINE_HOVER_HIGHLIGHTS),
    themeLight: withDefault(LIGHT_THEMES),
    themeDark: withDefault(DARK_THEMES),
    changeColors: withDefault(CHANGE_COLORS),
    fileHeaderStyle: withDefault(FILE_HEADER_STYLES),
  },
  tree: {
    fileTreeSearchMode: withDefault(SEARCH_MODES),
    icons: withDefault(ICON_SETS),
    searchBlurBehavior: withDefault(SEARCH_BLUR_BEHAVIORS),
    // Pierre's keyword 'default' doubles as ours (see TreeSettings.density): 'default' first, then the others.
    density: ['default', 'compact', 'relaxed'] as const,
    initialExpansion: withDefault(EXPANSION_KEYWORDS),
  },
  layout: {
    treePosition: TREE_POSITIONS,
  },
} as const;

/** Limits for the font settings (they end up in CSS custom properties). */
export const FONT_TEXT_MAX = 300;
export const FONT_SIZE_MIN = 8;
export const FONT_SIZE_MAX = 32;

// ---------------------------------------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------------------------------------

function deepFreeze<T extends object>(value: T): T {
  for (const v of Object.values(value)) if (v !== null && typeof v === 'object') deepFreeze(v);
  return Object.freeze(value);
}

/**
 * 'default' (GitHub's look) for every enumerated option; booleans and numbers at their GitHub-closest values (the
 * table with the reasons is in ./github-defaults.ts). Frozen; `loadSettings` returns fresh mutable copies.
 */
export const DEFAULT_SETTINGS: DisplaySettings = deepFreeze({
  diff: {
    diffStyle: 'default',
    overflow: 'default',
    lineDiffType: 'default',
    diffIndicators: 'default',
    disableBackground: false,
    disableLineNumbers: false,
    hunkSeparators: 'default',
    expandUnchanged: false,
    expansionLineCount: 20,
    collapsedContextThreshold: 1,
    stickyHeader: true,
    themeLight: 'default',
    themeDark: 'default',
    themeType: 'default',
    lineHoverHighlight: 'default',
    changeColors: 'default',
    fileHeaderStyle: 'default',
    tokenizeMaxLineLength: 1000,
    tokenizeMaxLength: 100000,
    maxLineDiffLength: 1000,
    layoutGap: 16,
    layoutPaddingTop: 16,
    layoutPaddingBottom: 16,
  },
  tree: {
    flattenEmptyDirectories: true,
    initialExpansion: 'default',
    fileTreeSearchMode: 'default',
    density: 'default',
    icons: 'default',
    coloredIcons: true,
    stickyFolders: false,
    search: true, // extension default (Pierre's is false); see header
    searchBlurBehavior: 'default',
    showGitStatus: false,
  },
  fonts: { codeFontFamily: '', uiFontFamily: '', codeFontSize: 'default', codeFontFeatures: '' },
  layout: { treePosition: 'left', showTree: true },
  review: { hideWhitespace: false },
  experiments: { pageScroll: false, mergedBar: false },
  github: { replaceFilesTab: false },
});

// ---------------------------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------------------------

type Guard<T> = (value: unknown) => value is T;
type Schema<T> = { [K in keyof T]-?: Guard<T[K]> };

const isBool: Guard<boolean> = (v): v is boolean => typeof v === 'boolean';
const isInt = (v: unknown, min: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min;
const oneOf = <const L extends readonly string[]>(list: L): Guard<L[number]> =>
  (v): v is L[number] => typeof v === 'string' && (list as readonly string[]).includes(v);

const isDensity: Guard<FileTreeDensity> = (v): v is FileTreeDensity =>
  oneOf(DENSITY_KEYWORDS)(v) || (typeof v === 'number' && Number.isFinite(v) && v > 0);
const isInitialExpansion: Guard<TreeSettings['initialExpansion']> = (v): v is TreeSettings['initialExpansion'] =>
  oneOf(SETTING_CHOICES.tree.initialExpansion)(v) || isInt(v, 0);

/** Font text that is safe inside a CSS custom property: a string of at most FONT_TEXT_MAX chars without ; { } < >. */
export const isFontText: Guard<string> = (v): v is string => typeof v === 'string' && v.length <= FONT_TEXT_MAX && !/[;{}<>]/.test(v);
/** 'default' or an integer px size in FONT_SIZE_MIN..FONT_SIZE_MAX. */
export const isFontSize: Guard<FontSettings['codeFontSize']> = (v): v is FontSettings['codeFontSize'] =>
  v === DEFAULT_CHOICE || (isInt(v, FONT_SIZE_MIN) && v <= FONT_SIZE_MAX);

const C = SETTING_CHOICES;
const DIFF_SCHEMA: Schema<DiffSettings> = {
  diffStyle: oneOf(C.diff.diffStyle),
  overflow: oneOf(C.diff.overflow),
  lineDiffType: oneOf(C.diff.lineDiffType),
  diffIndicators: oneOf(C.diff.diffIndicators),
  disableBackground: isBool,
  disableLineNumbers: isBool,
  hunkSeparators: oneOf(C.diff.hunkSeparators),
  expandUnchanged: isBool,
  expansionLineCount: (v): v is number => isInt(v, 1),
  collapsedContextThreshold: (v): v is number => isInt(v, 0),
  stickyHeader: isBool,
  themeLight: oneOf(ALL_THEMES),
  themeDark: oneOf(ALL_THEMES),
  themeType: oneOf(C.diff.themeType),
  lineHoverHighlight: oneOf(C.diff.lineHoverHighlight),
  changeColors: oneOf(C.diff.changeColors),
  fileHeaderStyle: oneOf(C.diff.fileHeaderStyle),
  tokenizeMaxLineLength: (v): v is number => isInt(v, 1),
  tokenizeMaxLength: (v): v is number => isInt(v, 1),
  maxLineDiffLength: (v): v is number => isInt(v, 1),
  layoutGap: (v): v is number => isInt(v, 0),
  layoutPaddingTop: (v): v is number => isInt(v, 0),
  layoutPaddingBottom: (v): v is number => isInt(v, 0),
};

const TREE_SCHEMA: Schema<TreeSettings> = {
  flattenEmptyDirectories: isBool,
  initialExpansion: isInitialExpansion,
  fileTreeSearchMode: oneOf(C.tree.fileTreeSearchMode),
  density: isDensity,
  icons: oneOf(C.tree.icons),
  coloredIcons: isBool,
  stickyFolders: isBool,
  search: isBool,
  searchBlurBehavior: oneOf(C.tree.searchBlurBehavior),
  showGitStatus: isBool,
};

const FONT_SCHEMA: Schema<FontSettings> = {
  codeFontFamily: isFontText,
  uiFontFamily: isFontText,
  codeFontSize: isFontSize,
  codeFontFeatures: isFontText,
};

const LAYOUT_SCHEMA: Schema<LayoutSettings> = { treePosition: oneOf(C.layout.treePosition), showTree: isBool };

const REVIEW_SCHEMA: Schema<ReviewSettings> = { hideWhitespace: isBool };

const EXPERIMENTS_SCHEMA: Schema<ExperimentSettings> = { pageScroll: isBool, mergedBar: isBool };

const GITHUB_SCHEMA: Schema<GithubSettings> = { replaceFilesTab: isBool };

const SCHEMAS = {
  diff: DIFF_SCHEMA,
  tree: TREE_SCHEMA,
  fonts: FONT_SCHEMA,
  layout: LAYOUT_SCHEMA,
  review: REVIEW_SCHEMA,
  experiments: EXPERIMENTS_SCHEMA,
  github: GITHUB_SCHEMA,
} as const;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Keeps only the schema's own keys whose values pass their guard. Anything else (unknown keys, bad values) is dropped. */
function pick<T extends object>(schema: Schema<T>, raw: unknown): Partial<T> {
  const out: Record<string, unknown> = {};
  if (!isRecord(raw)) return out as Partial<T>;
  for (const key of Object.keys(schema) as (keyof T & string)[]) {
    if (Object.hasOwn(raw, key) && schema[key](raw[key])) out[key] = raw[key];
  }
  return out as Partial<T>;
}

/** Validated sparse overrides: only known sections and keys with valid values survive. */
function sanitizeOverrides(raw: unknown): DeepPartial<DisplaySettings> {
  const src = isRecord(raw) ? raw : {};
  const out: DeepPartial<DisplaySettings> = {};
  for (const name of SETTINGS_SECTIONS) {
    const picked = pick(SCHEMAS[name] as Schema<object>, Object.hasOwn(src, name) ? src[name] : undefined);
    if (Object.keys(picked).length > 0) (out as Record<string, unknown>)[name] = picked;
  }
  return out;
}

function mergeOverrides(
  base: DeepPartial<DisplaySettings>,
  patch: DeepPartial<DisplaySettings>,
): DeepPartial<DisplaySettings> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const name of SETTINGS_SECTIONS) {
    const merged = { ...base[name], ...patch[name] };
    if (Object.keys(merged).length > 0) out[name] = merged;
  }
  return out as DeepPartial<DisplaySettings>;
}

/** Defaults overlaid with (already or not yet validated) stored overrides; always a fresh, fully populated object. */
function resolve(raw: unknown): DisplaySettings {
  const o = sanitizeOverrides(raw);
  return {
    diff: { ...DEFAULT_SETTINGS.diff, ...o.diff },
    tree: { ...DEFAULT_SETTINGS.tree, ...o.tree },
    fonts: { ...DEFAULT_SETTINGS.fonts, ...o.fonts },
    layout: { ...DEFAULT_SETTINGS.layout, ...o.layout },
    review: { ...DEFAULT_SETTINGS.review, ...o.review },
    experiments: { ...DEFAULT_SETTINGS.experiments, ...o.experiments },
    github: { ...DEFAULT_SETTINGS.github, ...o.github },
  };
}

// ---------------------------------------------------------------------------------------------------------
// Storage seam
// ---------------------------------------------------------------------------------------------------------

export interface SettingsStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export interface SettingsStorage {
  area: SettingsStorageArea;
  /** Listens for changes to the area's items; returns an unsubscribe function. */
  subscribe(listener: (changes: Record<string, { newValue?: unknown; oldValue?: unknown }>) => void): () => void;
}

/** Production storage: `chrome.storage.sync`, with changes from `chrome.storage.onChanged` filtered to area 'sync'. */
function chromeSyncStorage(): SettingsStorage {
  return {
    area: chrome.storage.sync,
    subscribe(listener) {
      const handler = (changes: Record<string, { newValue?: unknown; oldValue?: unknown }>, areaName: string) => {
        if (areaName === 'sync') listener(changes);
      };
      chrome.storage.onChanged.addListener(handler);
      return () => chrome.storage.onChanged.removeListener(handler);
    },
  };
}

let injectedStorage: SettingsStorage | undefined;

/** Test seam: route settings through a fake storage. Pass `undefined` to go back to `chrome.storage.sync`. */
export function setSettingsStorage(storage: SettingsStorage | undefined): void {
  injectedStorage = storage;
  // Also resets what this module knows about storage (see `known`), so tests start clean.
  known = undefined;
  followers = 0;
  outstanding = [];
}

const storage = (): SettingsStorage => injectedStorage ?? chromeSyncStorage();

async function readOverrides(area: SettingsStorageArea): Promise<DeepPartial<DisplaySettings>> {
  const stored = await area.get(SETTINGS_STORAGE_KEY);
  return sanitizeOverrides(stored[SETTINGS_STORAGE_KEY]);
}

// ---------------------------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------------------------

/**
 * Overrides as this context last knew them in storage (including its own writes), or undefined when unknown.
 * It lets `saveSettings` issue its write in the same tick instead of after a read. That matters when a page is
 * closing (pagehide): continuations of async reads never run in a dying page, an already issued write does.
 * It is trusted only while something follows storage changes (`onSettingsChange`), so other contexts' changes
 * keep it current; `outstanding` lets the echoes of this context's own writes be told from foreign changes.
 */
let known: DeepPartial<DisplaySettings> | undefined;
let followers = 0;
let outstanding: string[] = [];
let slowWrites = 0;
/** Canonical form (schema key order), so a merged value and its sanitized echo from `storage.onChanged` compare equal. */
const fingerprint = (o: DeepPartial<DisplaySettings>): string => JSON.stringify(sanitizeOverrides(o));

function forgetKnown(): void {
  known = undefined;
  outstanding = [];
}

/** A `storage.onChanged` value for our item: an echo of one of our writes (ignored) or a foreign change (adopted). */
function observeStored(raw: unknown): void {
  const next = sanitizeOverrides(raw);
  const echo = outstanding.indexOf(fingerprint(next));
  if (echo >= 0) {
    outstanding.splice(0, echo + 1);
    return;
  }
  outstanding = [];
  known = next;
}

export async function loadSettings(): Promise<DisplaySettings> {
  const stored = await storage().area.get(SETTINGS_STORAGE_KEY);
  const overrides = sanitizeOverrides(stored[SETTINGS_STORAGE_KEY]);
  // A read that raced with our own writes may be older than what `known` already holds.
  if (outstanding.length === 0 && slowWrites === 0) known = overrides;
  return resolve(overrides);
}

let writeQueue: Promise<unknown> = Promise.resolve();

/**
 * Merges `patch` into the stored overrides (unknown keys and invalid values are dropped, never stored) and
 * resolves with the effective settings. Writes are serialized so concurrent calls cannot lose each other's keys;
 * with a trustworthy cache (see `known`) the write is issued immediately.
 */
export function saveSettings(patch: DeepPartial<DisplaySettings>): Promise<DisplaySettings> {
  const clean = sanitizeOverrides(patch);
  const { area } = storage();

  const write = (next: DeepPartial<DisplaySettings>): Promise<DisplaySettings> => {
    known = next;
    outstanding.push(fingerprint(next));
    let saved: Promise<void>;
    try {
      saved = area.set({ [SETTINGS_STORAGE_KEY]: next });
    } catch (err) {
      // Chrome throws here, not in the promise, once the extension was reloaded or updated under this page.
      saved = Promise.reject(err);
    }
    return saved.then(
      () => resolve(next),
      (err: unknown) => {
        forgetKnown();
        throw err;
      },
    );
  };

  if (known !== undefined && followers > 0 && slowWrites === 0) {
    const run = write(mergeOverrides(known, clean));
    writeQueue = run.catch(() => undefined);
    return run;
  }

  slowWrites++;
  const run = writeQueue
    .then(async () => write(mergeOverrides(await readOverrides(area), clean)))
    .finally(() => void slowWrites--);
  writeQueue = run.catch(() => undefined);
  return run;
}

/** Calls `cb` with the effective settings whenever they change in `chrome.storage.sync` (any context). */
export function onSettingsChange(cb: (settings: DisplaySettings) => void): () => void {
  followers++;
  const off = storage().subscribe((changes) => {
    const change = changes[SETTINGS_STORAGE_KEY];
    if (!change) return;
    observeStored(change.newValue);
    cb(resolve(change.newValue));
  });
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    off();
    if (--followers === 0) forgetKnown();
  };
}

/**
 * Options for the React `CodeView`, with every 'default' resolved to GitHub's look (./github-defaults.ts).
 * `preferredHighlighter` is fixed to 'shiki-js' (global constraint: no WASM) and is deliberately not a setting.
 * Viewer-owned options (lineAnnotations, enableGutterUtility, enableLineSelection, collapsed, callbacks) are not
 * set here; spread this and add them. `unsafeCSS` is a fixed string (never user text): aligned line numbers and no
 * padding under the last line, plus, with GitHub's change colors, Pierre using the colors as they are, and with
 * GitHub's hunk separators, GitHub's 24 px blue expander rows (CodeView's `itemMetrics.hunkSeparatorHeight` must
 * match: `hunkSeparatorHeight` in ./github-defaults.ts).
 */
export function toDiffOptions<LAnnotation = undefined, Caret = undefined>(
  s: DisplaySettings,
): CodeViewReactOptions<LAnnotation, Caret> {
  const d = resolveDiff(s.diff);
  const css = [DIFF_CSS];
  if (s.diff.changeColors === DEFAULT_CHOICE) css.push(GITHUB_CHANGE_CSS);
  if (s.diff.hunkSeparators === DEFAULT_CHOICE) css.push(GITHUB_HUNK_CSS);
  return {
    theme: { light: d.themeLight, dark: d.themeDark },
    themeType: d.themeType,
    diffStyle: d.diffStyle,
    overflow: d.overflow,
    lineDiffType: d.lineDiffType,
    diffIndicators: d.diffIndicators,
    disableBackground: d.disableBackground,
    disableLineNumbers: d.disableLineNumbers,
    hunkSeparators: d.hunkSeparators,
    expandUnchanged: d.expandUnchanged,
    expansionLineCount: d.expansionLineCount,
    collapsedContextThreshold: d.collapsedContextThreshold,
    // CodeViewOptions spells this `stickyHeaders`; `stickyHeader` is not part of CodeViewReactOptions.
    stickyHeaders: d.stickyHeader,
    lineHoverHighlight: d.lineHoverHighlight,
    tokenizeMaxLineLength: d.tokenizeMaxLineLength,
    tokenizeMaxLength: d.tokenizeMaxLength,
    maxLineDiffLength: d.maxLineDiffLength,
    layout: { gap: d.layoutGap, paddingTop: d.layoutPaddingTop, paddingBottom: d.layoutPaddingBottom },
    preferredHighlighter: 'shiki-js',
    unsafeCSS: css.join('\n'),
  };
}

export type TreeDisplayOptions = Pick<
  FileTreeOptions,
  | 'flattenEmptyDirectories'
  | 'initialExpansion'
  | 'fileTreeSearchMode'
  | 'density'
  | 'itemHeight'
  | 'icons'
  | 'stickyFolders'
  | 'search'
  | 'searchBlurBehavior'
  | 'unsafeCSS'
>;

/**
 * Whether the tree gets `gitStatus`: for its A/M/D letters (`tree.showGitStatus`), or for GitHub's icons, which pick
 * each file's glyph by its status (./github-tree-icons.ts).
 */
export const treeNeedsGitStatus = (t: Pick<TreeSettings, 'icons' | 'showGitStatus'>): boolean => t.showGitStatus || t.icons === DEFAULT_CHOICE;

/**
 * Display-only `@pierre/trees` options, 'default' resolved; add `paths`, `onSelectionChange` etc. at the call site,
 * and `gitStatus` when `treeNeedsGitStatus`. `unsafeCSS` is a fixed string that goes with the GitHub icons (and hides
 * the status letters they need the git status for while `tree.showGitStatus` is off).
 */
export function toTreeOptions(s: DisplaySettings): TreeDisplayOptions {
  const t = s.tree;
  const github = t.icons === DEFAULT_CHOICE;
  return {
    flattenEmptyDirectories: t.flattenEmptyDirectories,
    initialExpansion: t.initialExpansion === DEFAULT_CHOICE ? GITHUB_TREE.initialExpansion : t.initialExpansion,
    fileTreeSearchMode: t.fileTreeSearchMode === DEFAULT_CHOICE ? GITHUB_TREE.fileTreeSearchMode : t.fileTreeSearchMode,
    density: t.density,
    ...(t.density === DEFAULT_CHOICE ? { itemHeight: GITHUB_TREE_ROW_HEIGHT } : {}),
    icons: github ? GITHUB_TREE_ICONS : { set: t.icons as FileTreeBuiltInIconSet, colored: t.coloredIcons },
    stickyFolders: t.stickyFolders,
    search: t.search,
    searchBlurBehavior: t.searchBlurBehavior === DEFAULT_CHOICE ? GITHUB_TREE.searchBlurBehavior : t.searchBlurBehavior,
    ...(github ? { unsafeCSS: t.showGitStatus ? GITHUB_TREE_CSS : `${GITHUB_TREE_CSS}${HIDE_GIT_STATUS_CSS}` } : {}),
  };
}
