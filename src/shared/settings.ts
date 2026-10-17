/**
 * Display settings: the single schema behind the viewer's Display menu (Task 7) and the options page (Task 13).
 *
 * Persistence: one `chrome.storage.sync` item (`pierre.settings`) holding only the user's validated overrides
 * (sparse). Loading overlays them on `DEFAULT_SETTINGS`, so a future change of a Pierre default reaches users
 * who never touched that option, and the item stays far below the 8 KB per-item sync quota.
 *
 * ---------------------------------------------------------------------------------------------------------
 * Option inventory (derived from the installed @pierre/diffs 1.5.x and @pierre/trees 1.0.0-beta.6 .d.ts/.js)
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
 *   trees: sort (only 'default' or a comparator function, which cannot be persisted), itemHeight (density already
 *     drives row height), overscan / initialVisibleRowCount (virtualization perf), searchFakeFocus (demo/test aid),
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

// ---------------------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------------------

/** `InteractionManagerBaseOptions['lineHoverHighlight']`, which @pierre/diffs does not export as its own type. */
export type LineHoverHighlight = 'disabled' | 'both' | 'number' | 'line';

export interface DiffSettings {
  diffStyle: 'split' | 'unified';
  overflow: 'scroll' | 'wrap';
  lineDiffType: LineDiffTypes;
  diffIndicators: DiffIndicators;
  disableBackground: boolean;
  disableLineNumbers: boolean;
  hunkSeparators: Exclude<HunkSeparators, 'custom'>;
  expandUnchanged: boolean;
  expansionLineCount: number;
  collapsedContextThreshold: number;
  stickyHeader: boolean;
  themeLight: string;
  themeDark: string;
  themeType: ThemeTypes;
  lineHoverHighlight: LineHoverHighlight;
  tokenizeMaxLineLength: number;
  tokenizeMaxLength: number;
  maxLineDiffLength: number;
  layoutGap: number;
  layoutPaddingTop: number;
  layoutPaddingBottom: number;
}

export interface TreeSettings {
  flattenEmptyDirectories: boolean;
  initialExpansion: FileTreeInitialExpansion;
  fileTreeSearchMode: FileTreeSearchMode;
  density: FileTreeDensity;
  icons: FileTreeBuiltInIconSet;
  coloredIcons: boolean;
  stickyFolders: boolean;
  search: boolean;
  searchBlurBehavior: FileTreeSearchBlurBehavior;
}

export interface ReviewSettings {
  hideWhitespace: boolean;
}

export interface DisplaySettings {
  diff: DiffSettings;
  tree: TreeSettings;
  review: ReviewSettings;
}

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
const ALL_THEMES: readonly string[] = [...LIGHT_THEMES, ...DARK_THEMES];

/** Compile-time proof that a choice list covers every member of the library union (fails typecheck if Pierre adds one). */
type Covers<Union, List extends readonly unknown[]> = [Union] extends [List[number]] ? true : never;
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
  Covers<Extract<TreeSettings['initialExpansion'], string>, typeof EXPANSION_KEYWORDS>,
] = [true, true, true, true, true, true, true, true, true, true, true, true];
void _exhaustive;

/** Allowed values for every enumerated setting, keyed like `DisplaySettings` (drives Display menu / options page controls). */
export const SETTING_CHOICES = {
  diff: {
    diffStyle: DIFF_STYLES,
    overflow: OVERFLOWS,
    lineDiffType: LINE_DIFF_TYPES,
    diffIndicators: DIFF_INDICATORS,
    hunkSeparators: HUNK_SEPARATORS,
    themeType: THEME_TYPES,
    lineHoverHighlight: LINE_HOVER_HIGHLIGHTS,
  },
  tree: {
    fileTreeSearchMode: SEARCH_MODES,
    icons: ICON_SETS,
    searchBlurBehavior: SEARCH_BLUR_BEHAVIORS,
    density: DENSITY_KEYWORDS,
    initialExpansion: EXPANSION_KEYWORDS,
  },
} as const;

// ---------------------------------------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------------------------------------

function deepFreeze<T extends object>(value: T): T {
  for (const v of Object.values(value)) if (v !== null && typeof v === 'object') deepFreeze(v);
  return Object.freeze(value);
}

/** Pierre's own defaults (sources in the header comment), except `tree.search` which is the extension's default. Frozen; `loadSettings` returns fresh mutable copies. */
export const DEFAULT_SETTINGS: DisplaySettings = deepFreeze({
  diff: {
    diffStyle: 'split',
    overflow: 'scroll',
    lineDiffType: 'word-alt',
    diffIndicators: 'bars',
    disableBackground: false,
    disableLineNumbers: false,
    hunkSeparators: 'line-info',
    expandUnchanged: false,
    expansionLineCount: 100,
    collapsedContextThreshold: 1,
    stickyHeader: false,
    themeLight: 'pierre-light',
    themeDark: 'pierre-dark',
    themeType: 'system',
    lineHoverHighlight: 'disabled',
    tokenizeMaxLineLength: 1000,
    tokenizeMaxLength: 100000,
    maxLineDiffLength: 1000,
    layoutGap: 8,
    layoutPaddingTop: 8,
    layoutPaddingBottom: 8,
  },
  tree: {
    flattenEmptyDirectories: true,
    initialExpansion: 'closed',
    fileTreeSearchMode: 'hide-non-matches',
    density: 'default',
    icons: 'complete',
    coloredIcons: true,
    stickyFolders: false,
    search: true, // extension default (Pierre's is false); see header
    searchBlurBehavior: 'close',
  },
  review: { hideWhitespace: false },
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
const isInitialExpansion: Guard<FileTreeInitialExpansion> = (v): v is FileTreeInitialExpansion =>
  oneOf(EXPANSION_KEYWORDS)(v) || isInt(v, 0);

const DIFF_SCHEMA: Schema<DiffSettings> = {
  diffStyle: oneOf(DIFF_STYLES),
  overflow: oneOf(OVERFLOWS),
  lineDiffType: oneOf(LINE_DIFF_TYPES),
  diffIndicators: oneOf(DIFF_INDICATORS),
  disableBackground: isBool,
  disableLineNumbers: isBool,
  hunkSeparators: oneOf(HUNK_SEPARATORS),
  expandUnchanged: isBool,
  expansionLineCount: (v): v is number => isInt(v, 1),
  collapsedContextThreshold: (v): v is number => isInt(v, 0),
  stickyHeader: isBool,
  themeLight: oneOf(ALL_THEMES),
  themeDark: oneOf(ALL_THEMES),
  themeType: oneOf(THEME_TYPES),
  lineHoverHighlight: oneOf(LINE_HOVER_HIGHLIGHTS),
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
  fileTreeSearchMode: oneOf(SEARCH_MODES),
  density: isDensity,
  icons: oneOf(ICON_SETS),
  coloredIcons: isBool,
  stickyFolders: isBool,
  search: isBool,
  searchBlurBehavior: oneOf(SEARCH_BLUR_BEHAVIORS),
};

const REVIEW_SCHEMA: Schema<ReviewSettings> = { hideWhitespace: isBool };

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
  const sections = [
    ['diff', DIFF_SCHEMA],
    ['tree', TREE_SCHEMA],
    ['review', REVIEW_SCHEMA],
  ] as const;
  for (const [name, schema] of sections) {
    const picked = pick(schema as Schema<object>, Object.hasOwn(src, name) ? src[name] : undefined);
    if (Object.keys(picked).length > 0) (out as Record<string, unknown>)[name] = picked;
  }
  return out;
}

function mergeOverrides(
  base: DeepPartial<DisplaySettings>,
  patch: DeepPartial<DisplaySettings>,
): DeepPartial<DisplaySettings> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const name of ['diff', 'tree', 'review'] as const) {
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
    review: { ...DEFAULT_SETTINGS.review, ...o.review },
  };
}

// ---------------------------------------------------------------------------------------------------------
// Storage seam
// ---------------------------------------------------------------------------------------------------------

export const SETTINGS_STORAGE_KEY = 'pierre.settings';

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
const fingerprint = (o: DeepPartial<DisplaySettings>): string => JSON.stringify(o);

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
    return area.set({ [SETTINGS_STORAGE_KEY]: next }).then(
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
 * Options for the React `CodeView`. `preferredHighlighter` is fixed to 'shiki-js' (global constraint: no WASM) and
 * is deliberately not a setting. Viewer-owned options (lineAnnotations, enableGutterUtility, enableLineSelection,
 * collapsed, callbacks) are not set here; spread this and add them.
 */
export function toDiffOptions<LAnnotation = undefined, Caret = undefined>(
  s: DisplaySettings,
): CodeViewReactOptions<LAnnotation, Caret> {
  const d = s.diff;
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
  };
}

export type TreeDisplayOptions = Pick<
  FileTreeOptions,
  | 'flattenEmptyDirectories'
  | 'initialExpansion'
  | 'fileTreeSearchMode'
  | 'density'
  | 'icons'
  | 'stickyFolders'
  | 'search'
  | 'searchBlurBehavior'
>;

/** Display-only `@pierre/trees` options; add `paths`, `gitStatus`, `onSelectionChange` etc. at the call site. */
export function toTreeOptions(s: DisplaySettings): TreeDisplayOptions {
  const t = s.tree;
  return {
    flattenEmptyDirectories: t.flattenEmptyDirectories,
    initialExpansion: t.initialExpansion,
    fileTreeSearchMode: t.fileTreeSearchMode,
    density: t.density,
    icons: { set: t.icons, colored: t.coloredIcons },
    stickyFolders: t.stickyFolders,
    search: t.search,
    searchBlurBehavior: t.searchBlurBehavior,
  };
}
