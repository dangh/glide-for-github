// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_COLLAPSED_CONTEXT_THRESHOLD, DEFAULT_THEMES } from '@pierre/diffs';
import {
  DEFAULT_SETTINGS,
  SETTINGS_STORAGE_KEY,
  SETTING_CHOICES,
  loadSettings,
  onSettingsChange,
  saveSettings,
  setSettingsStorage,
  toDiffOptions,
  toTreeOptions,
  type DisplaySettings,
  type SettingsStorage,
} from '../../src/shared/settings';

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
  it('deep-equals the documented Pierre defaults', () => {
    expect(DEFAULT_SETTINGS).toEqual({
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
        maxLineDiffLength: 1000,
      },
      tree: {
        flattenEmptyDirectories: true,
        initialExpansion: 'closed',
        fileTreeSearchMode: 'hide-non-matches',
        density: 'default',
        icons: 'complete',
        coloredIcons: true,
        stickyFolders: false,
        search: false,
        searchBlurBehavior: 'close',
      },
      review: { hideWhitespace: false },
    } satisfies DisplaySettings);
  });

  it('agrees with the constants exported by the installed @pierre/diffs', () => {
    expect(DEFAULT_SETTINGS.diff.themeLight).toBe(DEFAULT_THEMES.light);
    expect(DEFAULT_SETTINGS.diff.themeDark).toBe(DEFAULT_THEMES.dark);
    expect(DEFAULT_SETTINGS.diff.collapsedContextThreshold).toBe(DEFAULT_COLLAPSED_CONTEXT_THRESHOLD);
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
});

describe('loadSettings', () => {
  it('returns the defaults, as a fresh copy, when nothing is stored', async () => {
    const s = await loadSettings();
    expect(s).toEqual(DEFAULT_SETTINGS);
    expect(s).not.toBe(DEFAULT_SETTINGS);
    s.diff.diffStyle = 'unified';
    expect(DEFAULT_SETTINGS.diff.diffStyle).toBe('split');
    expect((await loadSettings()).diff.diffStyle).toBe('split');
  });

  it('overlays stored values on the defaults', async () => {
    fake.data[SETTINGS_STORAGE_KEY] = { diff: { diffStyle: 'unified' }, review: { hideWhitespace: true } };
    const s = await loadSettings();
    expect(s.diff.diffStyle).toBe('unified');
    expect(s.review.hideWhitespace).toBe(true);
    expect(s.diff.overflow).toBe('scroll');
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
    expect(Object.keys(s).sort()).toEqual(['diff', 'review', 'tree']);
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

  it('survives garbage in storage', async () => {
    for (const garbage of [null, 'str', 42, [], [1, 2]]) {
      fake.data[SETTINGS_STORAGE_KEY] = garbage;
      expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
    }
    fake.data[SETTINGS_STORAGE_KEY] = { diff: 'nope', tree: [], review: null };
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
});

describe('saveSettings', () => {
  it('merges a partial patch into storage and returns the effective settings', async () => {
    const result = await saveSettings({ diff: { diffStyle: 'unified' } });
    expect(fake.data[SETTINGS_STORAGE_KEY]).toEqual({ diff: { diffStyle: 'unified' } });
    expect(result.diff.diffStyle).toBe('unified');
    expect(result.diff.overflow).toBe('scroll');
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
    expect(cb.mock.calls[0]![0].diff.overflow).toBe('scroll');

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

describe('toDiffOptions', () => {
  it('always sets preferredHighlighter to shiki-js', () => {
    expect(toDiffOptions(DEFAULT_SETTINGS).preferredHighlighter).toBe('shiki-js');
  });

  it('keeps shiki-js even when storage tries to say otherwise', async () => {
    fake.data[SETTINGS_STORAGE_KEY] = { diff: { preferredHighlighter: 'shiki-wasm' } };
    expect(toDiffOptions(await loadSettings()).preferredHighlighter).toBe('shiki-js');
  });

  it('maps every diff setting onto the CodeView option it drives', () => {
    const s: DisplaySettings = {
      ...DEFAULT_SETTINGS,
      diff: {
        diffStyle: 'unified',
        overflow: 'wrap',
        lineDiffType: 'char',
        diffIndicators: 'classic',
        disableBackground: true,
        disableLineNumbers: true,
        hunkSeparators: 'metadata',
        expandUnchanged: true,
        expansionLineCount: 25,
        collapsedContextThreshold: 4,
        stickyHeader: true,
        themeLight: 'github-light',
        themeDark: 'github-dark',
        themeType: 'dark',
        lineHoverHighlight: 'both',
        tokenizeMaxLineLength: 500,
        maxLineDiffLength: 2000,
      },
    };
    expect(toDiffOptions(s)).toEqual({
      theme: { light: 'github-light', dark: 'github-dark' },
      themeType: 'dark',
      diffStyle: 'unified',
      overflow: 'wrap',
      lineDiffType: 'char',
      diffIndicators: 'classic',
      disableBackground: true,
      disableLineNumbers: true,
      hunkSeparators: 'metadata',
      expandUnchanged: true,
      expansionLineCount: 25,
      collapsedContextThreshold: 4,
      // CodeView names the sticky-header option in the plural; BaseCodeOptions' `stickyHeader` is not accepted.
      stickyHeaders: true,
      lineHoverHighlight: 'both',
      tokenizeMaxLineLength: 500,
      maxLineDiffLength: 2000,
      preferredHighlighter: 'shiki-js',
    });
    expect(toDiffOptions(s)).not.toHaveProperty('stickyHeader');
  });

  it('does not set options the viewer owns', () => {
    const o = toDiffOptions(DEFAULT_SETTINGS) as Record<string, unknown>;
    for (const owned of ['collapsed', 'enableGutterUtility', 'enableLineSelection', 'unsafeCSS', 'disableFileHeader']) {
      expect(o).not.toHaveProperty(owned);
    }
  });
});

describe('toTreeOptions', () => {
  it('maps the tree settings onto @pierre/trees options', () => {
    expect(toTreeOptions(DEFAULT_SETTINGS)).toEqual({
      flattenEmptyDirectories: true,
      initialExpansion: 'closed',
      fileTreeSearchMode: 'hide-non-matches',
      density: 'default',
      icons: { set: 'complete', colored: true },
      stickyFolders: false,
      search: false,
      searchBlurBehavior: 'close',
    });
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
          search: true,
          searchBlurBehavior: 'retain',
        },
      }),
    ).toEqual({
      flattenEmptyDirectories: false,
      initialExpansion: 3,
      fileTreeSearchMode: 'expand-matches',
      density: 'compact',
      icons: { set: 'minimal', colored: false },
      stickyFolders: true,
      search: true,
      searchBlurBehavior: 'retain',
    });
  });
});
