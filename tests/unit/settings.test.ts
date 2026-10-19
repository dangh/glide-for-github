// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { themes as bundledThemes } from '@pierre/theming/themes';
import { DEFAULT_COLLAPSED_CONTEXT_THRESHOLD, DEFAULT_TOKENIZE_MAX_LENGTH } from '@pierre/diffs';
import {
  DARK_THEMES,
  DEFAULT_SETTINGS,
  LIGHT_THEMES,
  SETTINGS_STORAGE_KEY,
  SETTING_CHOICES,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  FONT_TEXT_MAX,
  isFontSize,
  isFontText,
  loadSettings,
  onSettingsChange,
  saveSettings,
  setSettingsStorage,
  toDiffOptions,
  toTreeOptions,
  treeNeedsGitStatus,
  type DisplaySettings,
  type SettingsStorage,
} from '../../src/shared/settings';
import { DIFF_CSS, GITHUB_CHANGE_CSS, GITHUB_HUNK_CSS, GITHUB_TREE_CSS, GITHUB_TREE_ICONS, hunkSeparatorHeight } from '../../src/shared/github-defaults';
import { githubSettingsOf } from '../../src/shared/github-settings';
import { HIDE_GIT_STATUS_CSS } from '../../src/shared/github-tree-icons';

type Changes = Record<string, { newValue?: unknown; oldValue?: unknown }>;
type ChangeListener = (changes: Changes, areaName: string) => void;

/** Minimal in-memory stand-in for `chrome.storage` (sync area + the global onChanged event). */
function makeFakeChrome(initial: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = { ...initial };
  const listeners = new Set<ChangeListener>();
  const fire = (changes: Changes, areaName: string) => {
    for (const l of [...listeners]) l(changes, areaName);
  };
  const chromeLike = {
    storage: {
      sync: {
        async get(key: string) {
          return key in data ? { [key]: structuredClone(data[key]) } : {};
        },
        async set(items: Record<string, unknown>) {
          const changes: Changes = {};
          for (const [k, v] of Object.entries(items)) {
            changes[k] = { oldValue: data[k], newValue: structuredClone(v) };
            data[k] = structuredClone(v);
          }
          fire(changes, 'sync');
        },
      },
      onChanged: {
        addListener: (l: ChangeListener) => void listeners.add(l),
        removeListener: (l: ChangeListener) => void listeners.delete(l),
        hasListener: (l: ChangeListener) => listeners.has(l),
      },
    },
  };
  return { chrome: chromeLike, data, listeners, fire };
}

let fake: ReturnType<typeof makeFakeChrome>;
beforeEach(() => {
  fake = makeFakeChrome();
  vi.stubGlobal('chrome', fake.chrome);
});
afterEach(() => {
  setSettingsStorage(undefined);
  vi.unstubAllGlobals();
});

describe('DEFAULT_SETTINGS', () => {
  it("uses 'default' (GitHub's look) for every enumerated option, and GitHub-like values for the rest", () => {
    expect(DEFAULT_SETTINGS).toEqual({
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
        search: true,
        searchBlurBehavior: 'default',
        showGitStatus: false,
      },
      fonts: { codeFontFamily: '', uiFontFamily: '', codeFontSize: 'default', codeFontFeatures: '' },
      layout: { treePosition: 'left', showTree: true },
      review: { hideWhitespace: false },
      experiments: { pageScroll: false, mergedBar: false },
      github: { replaceFilesTab: false },
      fileGroups: { enabled: true, defaultGroup: '', hideEmpty: true },
      relatedFiles: { style: 'nested' },
    } satisfies DisplaySettings);
  });

  it('keeps the Pierre limits it does not change in step with the installed @pierre/diffs', () => {
    expect(DEFAULT_SETTINGS.diff.collapsedContextThreshold).toBe(DEFAULT_COLLAPSED_CONTEXT_THRESHOLD);
    expect(DEFAULT_SETTINGS.diff.tokenizeMaxLength).toBe(DEFAULT_TOKENIZE_MAX_LENGTH);
  });

  it('is immutable so a stray write cannot corrupt the defaults', () => {
    expect(() => {
      (DEFAULT_SETTINGS.diff as { diffStyle: string }).diffStyle = 'unified';
    }).toThrow(TypeError);
  });

  it('has every default inside its own list of choices', () => {
    for (const [section, choices] of Object.entries(SETTING_CHOICES)) {
      for (const [key, values] of Object.entries(choices)) {
        const def = (DEFAULT_SETTINGS as unknown as Record<string, Record<string, unknown>>)[section]![key];
        expect(values, `${section}.${key}`).toContain(def);
      }
    }
  });

  it("lists 'default' first in every enumerated choice list except the tree position", () => {
    for (const [section, choices] of Object.entries(SETTING_CHOICES)) {
      for (const [key, values] of Object.entries(choices)) {
        if (section === 'layout' && key === 'treePosition') continue;
        expect((values as readonly unknown[])[0], `${section}.${key}`).toBe('default');
      }
    }
    expect(SETTING_CHOICES.layout.treePosition).toEqual(['left', 'right']);
    expect(SETTING_CHOICES.diff.changeColors).toEqual(['default', 'theme']);
    expect(SETTING_CHOICES.diff.fileHeaderStyle).toEqual(['default', 'pierre']);
  });

  it("keeps Pierre's own values after 'default' (no value lost or renamed)", () => {
    expect(SETTING_CHOICES.diff.diffStyle).toEqual(['default', 'split', 'unified']);
    expect(SETTING_CHOICES.diff.overflow).toEqual(['default', 'scroll', 'wrap']);
    expect(SETTING_CHOICES.diff.lineDiffType).toEqual(['default', 'word-alt', 'word-line', 'word', 'char', 'none']);
    expect(SETTING_CHOICES.diff.diffIndicators).toEqual(['default', 'classic', 'bars', 'none']);
    expect(SETTING_CHOICES.diff.hunkSeparators).toEqual(['default', 'line-info', 'line-info-basic', 'metadata', 'simple']);
    expect(SETTING_CHOICES.diff.themeType).toEqual(['default', 'system', 'light', 'dark']);
    expect(SETTING_CHOICES.diff.lineHoverHighlight).toEqual(['default', 'disabled', 'both', 'number', 'line']);
    expect(SETTING_CHOICES.tree.icons).toEqual(['default', 'minimal', 'standard', 'complete']);
    expect(SETTING_CHOICES.tree.fileTreeSearchMode).toEqual(['default', 'expand-matches', 'collapse-non-matches', 'hide-non-matches']);
    expect(SETTING_CHOICES.tree.searchBlurBehavior).toEqual(['default', 'close', 'retain']);
    expect(SETTING_CHOICES.tree.initialExpansion).toEqual(['default', 'open', 'closed']);
    // Pierre's own density keyword is also 'default' (30 px rows, the closest to GitHub's tree): one entry serves both.
    expect(SETTING_CHOICES.tree.density).toEqual(['default', 'compact', 'relaxed']);
  });
});

describe('theme names', () => {
  it('lists exactly the themes bundled with the installed @pierre/theming (guards drift on upgrades)', () => {
    expect([...LIGHT_THEMES]).toEqual([...bundledThemes.getThemeNames({ colorScheme: 'light' })]);
    expect([...DARK_THEMES]).toEqual([...bundledThemes.getThemeNames({ colorScheme: 'dark' })]);
  });

  it("contains the GitHub themes that 'default' resolves to", () => {
    expect(LIGHT_THEMES).toContain('github-light-default');
    expect(DARK_THEMES).toContain('github-dark-default');
  });

  it("offers 'default' first in both theme lists", () => {
    expect(SETTING_CHOICES.diff.themeLight).toEqual(['default', ...LIGHT_THEMES]);
    expect(SETTING_CHOICES.diff.themeDark).toEqual(['default', ...DARK_THEMES]);
  });

  it('loadSettings falls back to the default for an unknown theme name and keeps a known one', async () => {
    fake.data[SETTINGS_STORAGE_KEY] = { diff: { themeLight: 'not-a-theme', themeDark: 'dracula' } };
    const s = await loadSettings();
    expect(s.diff.themeLight).toBe(DEFAULT_SETTINGS.diff.themeLight);
    expect(s.diff.themeDark).toBe('dracula');
  });

  it('saveSettings never stores an unknown theme name', async () => {
    await saveSettings({ diff: { themeLight: 'github-light-typo', themeDark: 'nord' } });
    expect(fake.data[SETTINGS_STORAGE_KEY]).toEqual({ diff: { themeDark: 'nord' } });
  });
});

describe('experiments', () => {
  it('are off unless stored as true; anything else falls back to off', async () => {
    fake.data[SETTINGS_STORAGE_KEY] = { experiments: { pageScroll: 'yes', mergedBar: 1, extra: true } };
    expect((await loadSettings()).experiments).toEqual({ pageScroll: false, mergedBar: false });
    fake.data[SETTINGS_STORAGE_KEY] = { experiments: { pageScroll: true } };
    expect((await loadSettings()).experiments).toEqual({ pageScroll: true, mergedBar: false });
  });

  it('save as sparse overrides next to the display settings and reach followers', async () => {
    const seen: DisplaySettings[] = [];
    const off = onSettingsChange((s) => seen.push(s));
    await saveSettings({ diff: { diffStyle: 'split' } });
    await saveSettings({ experiments: { mergedBar: true, bogus: true } as never });
    off();
    expect(fake.data[SETTINGS_STORAGE_KEY]).toEqual({ diff: { diffStyle: 'split' }, experiments: { mergedBar: true } });
    expect(seen.at(-1)?.experiments).toEqual({ pageScroll: false, mergedBar: true });
  });
});

describe('fileGroups', () => {
  it('default on, opening on All, hiding empty groups; invalid stored values fall back', async () => {
    expect((await loadSettings()).fileGroups).toEqual({ enabled: true, defaultGroup: '', hideEmpty: true });
    fake.data[SETTINGS_STORAGE_KEY] = { fileGroups: { enabled: 'no', defaultGroup: 7, hideEmpty: 0, extra: true } };
    expect((await loadSettings()).fileGroups).toEqual({ enabled: true, defaultGroup: '', hideEmpty: true });
    fake.data[SETTINGS_STORAGE_KEY] = { fileGroups: { defaultGroup: 'x'.repeat(61) } };
    expect((await loadSettings()).fileGroups.defaultGroup).toBe('');
    fake.data[SETTINGS_STORAGE_KEY] = { fileGroups: { enabled: false, defaultGroup: 'Tests', hideEmpty: false } };
    expect((await loadSettings()).fileGroups).toEqual({ enabled: false, defaultGroup: 'Tests', hideEmpty: false });
  });

  it('saves only what changed', async () => {
    await saveSettings({ fileGroups: { defaultGroup: 'Source' } });
    expect(fake.data[SETTINGS_STORAGE_KEY]).toEqual({ fileGroups: { defaultGroup: 'Source' } });
  });
});

describe('relatedFiles', () => {
  it('nests companion files by default; Nested and Off can be stored', async () => {
    expect((await loadSettings()).relatedFiles).toEqual({ style: 'nested' });
    for (const style of ['nested', 'off'] as const) {
      fake.data[SETTINGS_STORAGE_KEY] = { relatedFiles: { style } };
      expect((await loadSettings()).relatedFiles.style).toBe(style);
    }
  });

  it.each(['box', 'rail', 'tabs'])('falls back to Nested for the retired or invalid style %s', async (style) => {
    fake.data[SETTINGS_STORAGE_KEY] = { relatedFiles: { style }, layout: { treePosition: 'right' } };
    const settings = await loadSettings();
    expect(settings.relatedFiles.style).toBe('nested');
    expect(settings.layout.treePosition).toBe('right');
  });
});

describe('github', () => {
  it('replaces Files changed only when stored as true, read the same by the content script', async () => {
    for (const stored of [undefined, { github: { replaceFilesTab: 'yes' } }, { github: { replaceFilesTab: 1, extra: true } }]) {
      fake.data[SETTINGS_STORAGE_KEY] = stored;
      expect((await loadSettings()).github).toEqual({ replaceFilesTab: false });
      expect(githubSettingsOf(stored)).toEqual({ replaceFilesTab: false });
    }
    const on = { github: { replaceFilesTab: true } };
    fake.data[SETTINGS_STORAGE_KEY] = on;
    expect((await loadSettings()).github).toEqual({ replaceFilesTab: true });
    expect(githubSettingsOf(on)).toEqual({ replaceFilesTab: true });
  });

  it('saves as a sparse override', async () => {
    await saveSettings({ github: { replaceFilesTab: true } });
    expect(fake.data[SETTINGS_STORAGE_KEY]).toEqual({ github: { replaceFilesTab: true } });
  });
});

describe('loadSettings', () => {
  it('returns the defaults, as a fresh copy, when nothing is stored', async () => {
    const s = await loadSettings();
    expect(s).toEqual(DEFAULT_SETTINGS);
    expect(s).not.toBe(DEFAULT_SETTINGS);
    s.diff.diffStyle = 'unified';
    expect(DEFAULT_SETTINGS.diff.diffStyle).toBe('default');
    expect((await loadSettings()).diff.diffStyle).toBe('default');
  });

  it('overlays stored values on the defaults', async () => {
    fake.data[SETTINGS_STORAGE_KEY] = { diff: { diffStyle: 'unified' }, review: { hideWhitespace: true } };
    const s = await loadSettings();
    expect(s.diff.diffStyle).toBe('unified');
    expect(s.review.hideWhitespace).toBe(true);
    expect(s.diff.overflow).toBe('default');
    expect(s.tree).toEqual(DEFAULT_SETTINGS.tree);
  });

  it('drops unknown keys at every level', async () => {
    fake.data[SETTINGS_STORAGE_KEY] = {
      bogus: 1,
      diff: { diffStyle: 'unified', nope: true, preferredHighlighter: 'shiki-wasm' },
      tree: { sort: 'default', extra: 'x' },
      review: { hideWhitespace: true, other: 1 },
    };
    const s = await loadSettings();
    expect(Object.keys(s).sort()).toEqual(['diff', 'experiments', 'fileGroups', 'fonts', 'github', 'layout', 'relatedFiles', 'review', 'tree']);
    expect(Object.keys(s.diff).sort()).toEqual(Object.keys(DEFAULT_SETTINGS.diff).sort());
    expect(Object.keys(s.tree).sort()).toEqual(Object.keys(DEFAULT_SETTINGS.tree).sort());
    expect(Object.keys(s.review)).toEqual(['hideWhitespace']);
    expect(s.diff.diffStyle).toBe('unified');
    expect(s.review.hideWhitespace).toBe(true);
  });

  it('falls back to the default for invalid values, field by field', async () => {
    fake.data[SETTINGS_STORAGE_KEY] = {
      diff: {
        diffStyle: 'sideways',
        overflow: 'wrap',
        lineDiffType: 42,
        diffIndicators: null,
        disableBackground: 'yes',
        expansionLineCount: -5,
        collapsedContextThreshold: 1.5,
        tokenizeMaxLineLength: Number.NaN,
        maxLineDiffLength: Infinity,
        tokenizeMaxLength: 0,
        layoutGap: -1,
        layoutPaddingTop: 2.5,
        layoutPaddingBottom: '8',
        themeLight: '',
        themeDark: 7,
        themeType: 'dim',
        lineHoverHighlight: 'all',
      },
      tree: {
        initialExpansion: -1,
        density: 0,
        icons: 'fancy',
        fileTreeSearchMode: 'hide',
        stickyFolders: 1,
      },
      review: { hideWhitespace: 'true' },
    };
    const s = await loadSettings();
    expect(s.diff).toEqual({ ...DEFAULT_SETTINGS.diff, overflow: 'wrap' });
    expect(s.tree).toEqual(DEFAULT_SETTINGS.tree);
    expect(s.review).toEqual(DEFAULT_SETTINGS.review);
  });

  it('accepts the numeric forms of initialExpansion and density', async () => {
    fake.data[SETTINGS_STORAGE_KEY] = { tree: { initialExpansion: 2, density: 1.25 } };
    const s = await loadSettings();
    expect(s.tree.initialExpansion).toBe(2);
    expect(s.tree.density).toBe(1.25);
  });

  it('accepts zero for the layout spacing and a custom tokenizeMaxLength', async () => {
    fake.data[SETTINGS_STORAGE_KEY] = {
      diff: { layoutGap: 0, layoutPaddingTop: 0, layoutPaddingBottom: 16, tokenizeMaxLength: 50000 },
    };
    const s = await loadSettings();
    expect(s.diff).toMatchObject({ layoutGap: 0, layoutPaddingTop: 0, layoutPaddingBottom: 16, tokenizeMaxLength: 50000 });
  });

  it('keeps explicit values stored by older versions (they are overrides of the GitHub default)', async () => {
    fake.data[SETTINGS_STORAGE_KEY] = {
      diff: { diffStyle: 'split', overflow: 'scroll', lineDiffType: 'word-alt', diffIndicators: 'bars', hunkSeparators: 'line-info', themeLight: 'pierre-light', themeDark: 'pierre-dark', themeType: 'system' },
      tree: { icons: 'complete', initialExpansion: 'closed', searchBlurBehavior: 'close', density: 'compact' },
    };
    const s = await loadSettings();
    expect(s.diff).toMatchObject({ diffStyle: 'split', overflow: 'scroll', lineDiffType: 'word-alt', diffIndicators: 'bars', hunkSeparators: 'line-info', themeLight: 'pierre-light', themeDark: 'pierre-dark', themeType: 'system' });
    expect(s.tree).toMatchObject({ icons: 'complete', initialExpansion: 'closed', searchBlurBehavior: 'close', density: 'compact' });
  });

  it("accepts 'default' for every enumerated option", async () => {
    const diff = Object.fromEntries(Object.keys(SETTING_CHOICES.diff).map((k) => [k, 'default']));
    const tree = Object.fromEntries(Object.keys(SETTING_CHOICES.tree).map((k) => [k, 'default']));
    fake.data[SETTINGS_STORAGE_KEY] = { diff: { ...diff, diffStyle: 'unified' }, tree };
    await saveSettings({ diff: { diffStyle: 'default' } });
    const s = await loadSettings();
    for (const k of Object.keys(diff)) expect((s.diff as unknown as Record<string, unknown>)[k], k).toBe('default');
    for (const k of Object.keys(tree)) expect((s.tree as unknown as Record<string, unknown>)[k], k).toBe('default');
  });

  it('falls back to the default for invalid values of the new options', async () => {
    fake.data[SETTINGS_STORAGE_KEY] = {
      diff: { changeColors: 'pink', fileHeaderStyle: 'github' },
      tree: { showGitStatus: 'yes' },
      layout: { treePosition: 'top', showTree: 'no' },
      fonts: { codeFontSize: 7, codeFontFamily: 12, uiFontFamily: null, codeFontFeatures: [] },
    };
    const s = await loadSettings();
    expect(s.diff.changeColors).toBe('default');
    expect(s.diff.fileHeaderStyle).toBe('default');
    expect(s.tree.showGitStatus).toBe(false);
    expect(s.layout).toEqual({ treePosition: 'left', showTree: true });
    expect(s.fonts).toEqual(DEFAULT_SETTINGS.fonts);
  });

  it('keeps valid new options', async () => {
    fake.data[SETTINGS_STORAGE_KEY] = {
      diff: { changeColors: 'theme', fileHeaderStyle: 'pierre' },
      tree: { showGitStatus: true },
      layout: { treePosition: 'right', showTree: false },
      fonts: { codeFontSize: 14, codeFontFamily: '"JetBrains Mono", monospace', uiFontFamily: 'Inter, sans-serif', codeFontFeatures: '"calt" 0, "liga" 1' },
    };
    const s = await loadSettings();
    expect(s.diff).toMatchObject({ changeColors: 'theme', fileHeaderStyle: 'pierre' });
    expect(s.tree.showGitStatus).toBe(true);
    expect(s.layout).toEqual({ treePosition: 'right', showTree: false });
    expect(s.fonts).toEqual({ codeFontSize: 14, codeFontFamily: '"JetBrains Mono", monospace', uiFontFamily: 'Inter, sans-serif', codeFontFeatures: '"calt" 0, "liga" 1' });
  });

  it('validates font text (at most 300 chars, none of ; { } < >) and size (integer 8-32 px, or default)', async () => {
    expect(isFontText('')).toBe(true);
    expect(isFontText('default')).toBe(true);
    expect(isFontText('a'.repeat(FONT_TEXT_MAX))).toBe(true);
    expect(isFontText('a'.repeat(FONT_TEXT_MAX + 1))).toBe(false);
    for (const bad of ['Menlo; color: red', 'x{', 'x}', '<style>', 'a>b']) expect(isFontText(bad), bad).toBe(false);
    expect(isFontText(3)).toBe(false);

    expect(isFontSize('default')).toBe(true);
    expect(isFontSize(FONT_SIZE_MIN)).toBe(true);
    expect(isFontSize(FONT_SIZE_MAX)).toBe(true);
    for (const bad of [FONT_SIZE_MIN - 1, FONT_SIZE_MAX + 1, 12.5, '12', Number.NaN, null]) expect(isFontSize(bad), String(bad)).toBe(false);
    expect([FONT_TEXT_MAX, FONT_SIZE_MIN, FONT_SIZE_MAX]).toEqual([300, 8, 32]);

    fake.data[SETTINGS_STORAGE_KEY] = { fonts: { codeFontFamily: 'Menlo; } body { display:none', codeFontSize: 33, codeFontFeatures: 'a'.repeat(301), uiFontFamily: 'Inter' } };
    expect((await loadSettings()).fonts).toEqual({ ...DEFAULT_SETTINGS.fonts, uiFontFamily: 'Inter' });
  });

  it('survives garbage in storage', async () => {
    for (const garbage of [null, 'str', 42, [], [1, 2]]) {
      fake.data[SETTINGS_STORAGE_KEY] = garbage;
      expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
    }
    fake.data[SETTINGS_STORAGE_KEY] = { diff: 'nope', tree: [], review: null, fonts: 5, layout: 'right' };
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
});

describe('saveSettings', () => {
  it('merges a partial patch into storage and returns the effective settings', async () => {
    const result = await saveSettings({ diff: { diffStyle: 'unified' } });
    expect(fake.data[SETTINGS_STORAGE_KEY]).toEqual({ diff: { diffStyle: 'unified' } });
    expect(result.diff.diffStyle).toBe('unified');
    expect(result.diff.overflow).toBe('default');
    expect((await loadSettings()).diff.diffStyle).toBe('unified');
  });

  it('deep-merges successive patches without clobbering sibling keys', async () => {
    await saveSettings({ diff: { diffStyle: 'unified', overflow: 'wrap' } });
    await saveSettings({ diff: { overflow: 'scroll' }, tree: { density: 'compact' }, review: { hideWhitespace: true } });
    expect(fake.data[SETTINGS_STORAGE_KEY]).toEqual({
      diff: { diffStyle: 'unified', overflow: 'scroll' },
      tree: { density: 'compact' },
      review: { hideWhitespace: true },
    });
  });

  it('does not lose writes that are issued concurrently', async () => {
    await Promise.all([
      saveSettings({ diff: { diffStyle: 'unified' } }),
      saveSettings({ diff: { overflow: 'wrap' } }),
      saveSettings({ tree: { stickyFolders: true } }),
    ]);
    expect(fake.data[SETTINGS_STORAGE_KEY]).toEqual({
      diff: { diffStyle: 'unified', overflow: 'wrap' },
      tree: { stickyFolders: true },
    });
  });

  it('never stores unknown keys or invalid values', async () => {
    await saveSettings({
      diff: { diffStyle: 'unified', overflow: 'zigzag', preferredHighlighter: 'shiki-wasm' },
      rogue: { a: 1 },
    } as never);
    expect(fake.data[SETTINGS_STORAGE_KEY]).toEqual({ diff: { diffStyle: 'unified' } });
  });

  it('cleans pre-existing junk out of storage on the next save', async () => {
    fake.data[SETTINGS_STORAGE_KEY] = { diff: { diffStyle: 'unified', legacy: 1 }, old: true };
    await saveSettings({ review: { hideWhitespace: true } });
    expect(fake.data[SETTINGS_STORAGE_KEY]).toEqual({
      diff: { diffStyle: 'unified' },
      review: { hideWhitespace: true },
    });
  });

  it('keeps later saves working after a failed write', async () => {
    const original = fake.chrome.storage.sync.set;
    fake.chrome.storage.sync.set = async () => {
      throw new Error('quota exceeded');
    };
    await expect(saveSettings({ diff: { diffStyle: 'unified' } })).rejects.toThrow('quota exceeded');
    fake.chrome.storage.sync.set = original;
    await saveSettings({ diff: { overflow: 'wrap' } });
    expect(fake.data[SETTINGS_STORAGE_KEY]).toEqual({ diff: { overflow: 'wrap' } });
  });
});

describe('storage seam', () => {
  it('uses an injected storage instead of chrome.storage', async () => {
    const data: Record<string, unknown> = {};
    const storage: SettingsStorage = {
      area: {
        get: async (key) => (key in data ? { [key]: data[key] } : {}),
        set: async (items) => void Object.assign(data, items),
      },
      subscribe: () => () => {},
    };
    vi.stubGlobal('chrome', undefined);
    setSettingsStorage(storage);
    await saveSettings({ review: { hideWhitespace: true } });
    expect(data[SETTINGS_STORAGE_KEY]).toEqual({ review: { hideWhitespace: true } });
    expect((await loadSettings()).review.hideWhitespace).toBe(true);
  });
});

describe('onSettingsChange', () => {
  it('subscribes through chrome.storage.onChanged and reports sanitized settings for the sync area', async () => {
    const cb = vi.fn();
    onSettingsChange(cb);
    expect(fake.listeners.size).toBe(1);
    await saveSettings({ diff: { diffStyle: 'unified' } });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0]![0].diff.diffStyle).toBe('unified');
    expect(cb.mock.calls[0]![0].diff.overflow).toBe('default');

    fake.fire({ [SETTINGS_STORAGE_KEY]: { newValue: { diff: { overflow: 'wrap', junk: 1 }, junk: 1 } } }, 'sync');
    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb.mock.calls[1]![0]).toEqual({ ...DEFAULT_SETTINGS, diff: { ...DEFAULT_SETTINGS.diff, overflow: 'wrap' } });
  });

  it('ignores other storage areas and other keys', () => {
    const cb = vi.fn();
    onSettingsChange(cb);
    fake.fire({ [SETTINGS_STORAGE_KEY]: { newValue: { diff: { diffStyle: 'unified' } } } }, 'local');
    fake.fire({ [SETTINGS_STORAGE_KEY]: { newValue: { diff: { diffStyle: 'unified' } } } }, 'managed');
    fake.fire({ somethingElse: { newValue: 1 } }, 'sync');
    expect(cb).not.toHaveBeenCalled();
  });

  it('reports the defaults when the stored value is removed', () => {
    const cb = vi.fn();
    onSettingsChange(cb);
    fake.fire({ [SETTINGS_STORAGE_KEY]: { oldValue: { diff: { diffStyle: 'unified' } } } }, 'sync');
    expect(cb).toHaveBeenCalledWith(DEFAULT_SETTINGS);
  });

  it('returns an unsubscribe function', async () => {
    const cb = vi.fn();
    const off = onSettingsChange(cb);
    off();
    expect(fake.listeners.size).toBe(0);
    await saveSettings({ diff: { diffStyle: 'unified' } });
    expect(cb).not.toHaveBeenCalled();
  });
});

describe('saving while the page closes (pagehide flush)', () => {
  /** A `set` spy; with `defer`, change events are collected instead of fired, to be delivered later. */
  function watchSet(defer = false) {
    const sync = fake.chrome.storage.sync;
    const original = sync.set.bind(sync);
    const calls: Record<string, unknown>[] = [];
    const held: Changes[] = [];
    sync.set = async (items: Record<string, unknown>) => {
      calls.push(structuredClone(items));
      if (!defer) return original(items);
      const changes: Changes = {};
      for (const [k, v] of Object.entries(items)) {
        changes[k] = { oldValue: fake.data[k], newValue: structuredClone(v) };
        fake.data[k] = structuredClone(v);
      }
      held.push(changes);
    };
    return { calls, held, deliver: () => held.splice(0).forEach((c) => fake.fire(c, 'sync')) };
  }

  it('issues the write in the same tick once settings are loaded and followed, so a closing page cannot drop it', async () => {
    fake.data[SETTINGS_STORAGE_KEY] = { diff: { diffStyle: 'unified' } };
    await loadSettings();
    onSettingsChange(() => {});
    const spy = watchSet();
    const saved = saveSettings({ diff: { overflow: 'wrap' } });
    expect(spy.calls).toEqual([{ [SETTINGS_STORAGE_KEY]: { diff: { diffStyle: 'unified', overflow: 'wrap' } } }]);
    expect((await saved).diff.overflow).toBe('wrap');
  });

  it('reads storage first when nobody follows changes (the cache could be stale)', async () => {
    await loadSettings();
    const spy = watchSet();
    const saved = saveSettings({ diff: { overflow: 'wrap' } });
    expect(spy.calls).toEqual([]);
    await saved;
    expect(spy.calls).toHaveLength(1);
  });

  it('merges a change made by another context into the next write', async () => {
    await loadSettings();
    onSettingsChange(() => {});
    fake.data[SETTINGS_STORAGE_KEY] = { tree: { density: 'compact' } };
    fake.fire({ [SETTINGS_STORAGE_KEY]: { newValue: { tree: { density: 'compact' } } } }, 'sync');
    await saveSettings({ diff: { overflow: 'wrap' } });
    expect(fake.data[SETTINGS_STORAGE_KEY]).toEqual({ diff: { overflow: 'wrap' }, tree: { density: 'compact' } });
  });

  it('late echoes of its own earlier writes do not roll the cache back', async () => {
    await loadSettings();
    onSettingsChange(() => {});
    const spy = watchSet(true);
    void saveSettings({ diff: { diffStyle: 'unified' } });
    void saveSettings({ diff: { overflow: 'wrap' } });
    expect(spy.calls).toHaveLength(2);
    spy.deliver(); // both echoes arrive after both writes
    void saveSettings({ tree: { stickyFolders: true } });
    expect(spy.calls.at(-1)).toEqual({
      [SETTINGS_STORAGE_KEY]: { diff: { diffStyle: 'unified', overflow: 'wrap' }, tree: { stickyFolders: true } },
    });
  });

  it('recognizes echoes of its own writes whatever the key order of the merged value (patch key before an existing one)', async () => {
    fake.data[SETTINGS_STORAGE_KEY] = { diff: { overflow: 'wrap' } };
    await loadSettings();
    onSettingsChange(() => {});
    const spy = watchSet(true);
    // Merged value is { overflow, diffStyle } (insertion order) but the echo is sanitized to schema order { diffStyle, overflow }.
    void saveSettings({ diff: { diffStyle: 'unified' } });
    void saveSettings({ tree: { stickyFolders: true } });
    // Only the first echo has arrived when the third save happens.
    fake.fire(spy.held.shift()!, 'sync');
    void saveSettings({ review: { hideWhitespace: true } });
    expect(spy.calls.at(-1)).toEqual({
      [SETTINGS_STORAGE_KEY]: {
        diff: { diffStyle: 'unified', overflow: 'wrap' },
        tree: { stickyFolders: true },
        review: { hideWhitespace: true },
      },
    });
  });

  it('forgets the cache after a failed write and reads storage again', async () => {
    await loadSettings();
    onSettingsChange(() => {});
    const original = fake.chrome.storage.sync.set;
    fake.chrome.storage.sync.set = async () => {
      throw new Error('quota exceeded');
    };
    await expect(saveSettings({ diff: { diffStyle: 'unified' } })).rejects.toThrow('quota exceeded');
    fake.chrome.storage.sync.set = original;
    fake.data[SETTINGS_STORAGE_KEY] = { review: { hideWhitespace: true } };
    const spy = watchSet();
    const saved = saveSettings({ diff: { overflow: 'wrap' } });
    expect(spy.calls).toEqual([]); // slow path: reads first
    await saved;
    expect(fake.data[SETTINGS_STORAGE_KEY]).toEqual({ diff: { overflow: 'wrap' }, review: { hideWhitespace: true } });
  });

  it('stops using the cache once the last listener is removed', async () => {
    await loadSettings();
    const off = onSettingsChange(() => {});
    off();
    const spy = watchSet();
    void saveSettings({ diff: { overflow: 'wrap' } });
    expect(spy.calls).toEqual([]);
  });
});

describe('toDiffOptions', () => {
  it('always sets preferredHighlighter to shiki-js', () => {
    expect(toDiffOptions(DEFAULT_SETTINGS).preferredHighlighter).toBe('shiki-js');
  });

  it('keeps shiki-js even when storage tries to say otherwise', async () => {
    fake.data[SETTINGS_STORAGE_KEY] = { diff: { preferredHighlighter: 'shiki-wasm' } };
    expect(toDiffOptions(await loadSettings()).preferredHighlighter).toBe('shiki-js');
  });

  /** Explicit (non-default) values for every diff option. */
  const explicitDiff: DisplaySettings['diff'] = {
    diffStyle: 'split',
    overflow: 'scroll',
    lineDiffType: 'char',
    diffIndicators: 'bars',
    disableBackground: true,
    disableLineNumbers: true,
    hunkSeparators: 'metadata',
    expandUnchanged: true,
    expansionLineCount: 25,
    collapsedContextThreshold: 4,
    stickyHeader: false,
    themeLight: 'github-light',
    themeDark: 'github-dark',
    themeType: 'dark',
    lineHoverHighlight: 'both',
    changeColors: 'theme',
    fileHeaderStyle: 'pierre',
    tokenizeMaxLineLength: 500,
    tokenizeMaxLength: 60000,
    maxLineDiffLength: 2000,
    layoutGap: 12,
    layoutPaddingTop: 4,
    layoutPaddingBottom: 20,
  };

  it('maps every explicit diff setting onto the CodeView option it drives (Pierre values pass through unchanged)', () => {
    const s: DisplaySettings = { ...DEFAULT_SETTINGS, diff: explicitDiff };
    expect(toDiffOptions(s)).toEqual({
      theme: { light: 'github-light', dark: 'github-dark' },
      themeType: 'dark',
      diffStyle: 'split',
      overflow: 'scroll',
      lineDiffType: 'char',
      diffIndicators: 'bars',
      disableBackground: true,
      disableLineNumbers: true,
      hunkSeparators: 'metadata',
      expandUnchanged: true,
      expansionLineCount: 25,
      collapsedContextThreshold: 4,
      // CodeView names the sticky-header option in the plural; BaseCodeOptions' `stickyHeader` is not accepted.
      stickyHeaders: false,
      lineHoverHighlight: 'both',
      tokenizeMaxLineLength: 500,
      tokenizeMaxLength: 60000,
      maxLineDiffLength: 2000,
      layout: { gap: 12, paddingTop: 4, paddingBottom: 20 },
      preferredHighlighter: 'shiki-js',
      unsafeCSS: DIFF_CSS,
    });
    expect(toDiffOptions(s)).not.toHaveProperty('stickyHeader');
  });

  it("resolves every 'default' to GitHub's Files changed look", () => {
    const o = toDiffOptions(DEFAULT_SETTINGS);
    expect(o).toMatchObject({
      theme: { light: 'github-light-default', dark: 'github-dark-default' },
      themeType: 'system',
      diffStyle: 'unified',
      overflow: 'wrap',
      lineDiffType: 'word',
      diffIndicators: 'classic',
      // No "@@ -a,b +c,d @@" text by default: a slim "N unmodified lines" row with expand buttons.
      hunkSeparators: 'line-info-basic',
      lineHoverHighlight: 'disabled',
      stickyHeaders: true,
      expansionLineCount: 20,
      layout: { gap: 16, paddingTop: 16, paddingBottom: 16 },
    });
  });

  it("resolves 'default' option by option, leaving explicit siblings alone", () => {
    const o = toDiffOptions({ ...DEFAULT_SETTINGS, diff: { ...explicitDiff, themeLight: 'default', hunkSeparators: 'default' } });
    expect(o.theme).toEqual({ light: 'github-light-default', dark: 'github-dark' });
    expect(o.hunkSeparators).toBe('line-info-basic');
    expect(o.diffStyle).toBe('split');
  });

  it("GitHub change colors ('default') add the CSS that makes Pierre use them unmixed and seamless; every look aligns line numbers", () => {
    const github = toDiffOptions(DEFAULT_SETTINGS) as Record<string, unknown>;
    expect(github.unsafeCSS).toBe(`${DIFF_CSS}\n${GITHUB_CHANGE_CSS}\n${GITHUB_HUNK_CSS}`);
    expect(GITHUB_CHANGE_CSS).toMatch(/--mix-light:\s*0%/);
    expect(GITHUB_CHANGE_CSS).toMatch(/--diffs-gap-style:\s*none/);
    const theme = toDiffOptions({ ...DEFAULT_SETTINGS, diff: { ...DEFAULT_SETTINGS.diff, changeColors: 'theme', hunkSeparators: 'line-info-basic' } }) as Record<
      string,
      unknown
    >;
    expect(theme.unsafeCSS).toBe(DIFF_CSS);
  });

  it("GitHub hunk separators ('default') get GitHub's 24 px blue expander rows; an explicit 'line-info-basic' keeps Pierre's", () => {
    expect(GITHUB_HUNK_CSS).toMatch(/\[data-separator='line-info-basic'\][^}]*height:\s*24px/);
    expect(hunkSeparatorHeight('default')).toBe(24);
    expect(hunkSeparatorHeight('line-info-basic')).toBeUndefined();
    const explicit = toDiffOptions({ ...DEFAULT_SETTINGS, diff: { ...DEFAULT_SETTINGS.diff, hunkSeparators: 'line-info-basic' } });
    expect(explicit.hunkSeparators).toBe('line-info-basic');
    expect(explicit.unsafeCSS).not.toContain(GITHUB_HUNK_CSS);
  });

  it('does not set options the viewer owns', () => {
    const o = toDiffOptions(DEFAULT_SETTINGS) as Record<string, unknown>;
    for (const owned of ['collapsed', 'enableGutterUtility', 'enableLineSelection', 'disableFileHeader']) {
      expect(o).not.toHaveProperty(owned);
    }
  });
});

describe('toTreeOptions', () => {
  it("resolves the defaults to GitHub's tree: open folders, 32 px rows, octicons, filter text kept, no status letters", () => {
    const o = toTreeOptions(DEFAULT_SETTINGS);
    expect(o).toEqual({
      flattenEmptyDirectories: true,
      initialExpansion: 'open',
      fileTreeSearchMode: 'hide-non-matches',
      density: 'default',
      itemHeight: 32,
      icons: GITHUB_TREE_ICONS,
      stickyFolders: false,
      search: true,
      searchBlurBehavior: 'retain',
      unsafeCSS: `${GITHUB_TREE_CSS}${HIDE_GIT_STATUS_CSS}`,
    });
    expect(o).not.toHaveProperty('gitStatus');
    // GitHub's icons pick each file's glyph by its status, so the tree gets the status, but shows no letters.
    expect(treeNeedsGitStatus(DEFAULT_SETTINGS.tree)).toBe(true);
    expect(HIDE_GIT_STATUS_CSS).toMatch(/\[data-item-section="git"\][^}]*display:\s*none/);
  });

  it('shows the status letters with GitHub icons when showGitStatus is on, and needs no status for other icons', () => {
    const letters = { ...DEFAULT_SETTINGS.tree, showGitStatus: true };
    expect(toTreeOptions({ ...DEFAULT_SETTINGS, tree: letters }).unsafeCSS).toBe(GITHUB_TREE_CSS);
    expect(treeNeedsGitStatus({ icons: 'complete', showGitStatus: false })).toBe(false);
    expect(treeNeedsGitStatus({ icons: 'complete', showGitStatus: true })).toBe(true);
  });

  it("gives only the density 'default' GitHub's 32 px rows; the other densities keep Pierre's heights", () => {
    expect(toTreeOptions({ ...DEFAULT_SETTINGS, tree: { ...DEFAULT_SETTINGS.tree, density: 'relaxed' } })).not.toHaveProperty('itemHeight');
    expect(toTreeOptions({ ...DEFAULT_SETTINGS, tree: { ...DEFAULT_SETTINGS.tree, density: 1.5 } })).not.toHaveProperty('itemHeight');
  });

  it('maps explicit tree settings onto @pierre/trees options', () => {
    expect(
      toTreeOptions({
        ...DEFAULT_SETTINGS,
        tree: {
          flattenEmptyDirectories: false,
          initialExpansion: 3,
          fileTreeSearchMode: 'expand-matches',
          density: 'compact',
          icons: 'minimal',
          coloredIcons: false,
          stickyFolders: true,
          search: false,
          searchBlurBehavior: 'close',
          showGitStatus: true,
        },
      }),
    ).toEqual({
      flattenEmptyDirectories: false,
      initialExpansion: 3,
      fileTreeSearchMode: 'expand-matches',
      density: 'compact',
      icons: { set: 'minimal', colored: false },
      stickyFolders: true,
      search: false,
      searchBlurBehavior: 'close',
    });
  });
});
