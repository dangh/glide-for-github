import { createFileTreeIconResolver } from '@pierre/trees';
import { describe, expect, it } from 'vitest';
import {
  GITHUB_COLORS,
  GITHUB_DIFF,
  GITHUB_FONTS,
  GITHUB_TREE,
  GITHUB_TREE_CSS,
  GITHUB_TREE_ICONS,
  resolveDiffChoice,
  resolveFonts,
  toStyleVars,
} from '../../src/shared/github-defaults';
import { DEFAULT_SETTINGS, type DisplaySettings } from '../../src/shared/settings';
import { effectiveThemeType } from '../../src/viewer/state/settings';

const withFonts = (fonts: Partial<DisplaySettings['fonts']>): DisplaySettings => ({ ...DEFAULT_SETTINGS, fonts: { ...DEFAULT_SETTINGS.fonts, ...fonts } });

describe("the GitHub mapping of 'default'", () => {
  it('maps each enumerated diff option to the value closest to GitHub', () => {
    expect(GITHUB_DIFF).toEqual({
      diffStyle: 'unified',
      overflow: 'wrap',
      lineDiffType: 'word',
      diffIndicators: 'classic',
      hunkSeparators: 'simple',
      themeLight: 'github-light-default',
      themeDark: 'github-dark-default',
      themeType: 'system',
      lineHoverHighlight: 'disabled',
    });
    expect(GITHUB_TREE).toEqual({
      initialExpansion: 'open',
      fileTreeSearchMode: 'hide-non-matches',
      density: 'default',
      searchBlurBehavior: 'retain',
    });
  });

  it('resolveDiffChoice resolves only the value default', () => {
    expect(resolveDiffChoice('diffStyle', 'default')).toBe('unified');
    expect(resolveDiffChoice('diffStyle', 'split')).toBe('split');
    expect(resolveDiffChoice('overflow', 'default')).toBe('wrap');
    expect(resolveDiffChoice('overflow', 'scroll')).toBe('scroll');
  });

  it("themeType 'default' follows the system / GitHub's color mode like 'system'", () => {
    expect(effectiveThemeType('default', undefined)).toBe('system');
    expect(effectiveThemeType('default', 'auto')).toBe('system');
    expect(effectiveThemeType('default', 'dark')).toBe('dark');
    expect(effectiveThemeType('light', 'dark')).toBe('light');
  });

  it("uses GitHub's diffBlob colors (light from the brief, dark from Primer)", () => {
    expect(GITHUB_COLORS).toEqual({
      additionLine: { light: '#dafbe1', dark: '#2ea04326' },
      additionWord: { light: '#aceebb', dark: '#2ea04366' },
      additionNum: { light: '#ccffd8', dark: '#3fb9504d' },
      deletionLine: { light: '#ffebe9', dark: '#f851491a' },
      deletionWord: { light: '#ffcecb', dark: '#f8514966' },
      deletionNum: { light: '#ffd7d5', dark: '#f851494d' },
    });
  });
});

describe('fonts', () => {
  it("GitHub's stacks and 12 px code by default", () => {
    expect(GITHUB_FONTS.code).toBe('ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace');
    expect(GITHUB_FONTS.ui).toBe('-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji"');
    expect(GITHUB_FONTS.codeSize).toBe(12);
    expect(GITHUB_FONTS.features).toBe('normal');
    expect(resolveFonts(DEFAULT_SETTINGS.fonts)).toEqual({ code: GITHUB_FONTS.code, ui: GITHUB_FONTS.ui, codeSize: 12, features: 'normal' });
  });

  it("treats empty, blank and 'default' text as the GitHub stack, and trims custom text", () => {
    for (const blank of ['', '   ', 'default', ' Default ']) {
      expect(resolveFonts({ ...DEFAULT_SETTINGS.fonts, codeFontFamily: blank, uiFontFamily: blank, codeFontFeatures: blank })).toEqual(
        resolveFonts(DEFAULT_SETTINGS.fonts),
      );
    }
    expect(resolveFonts({ codeFontFamily: ' "Fira Code" ', uiFontFamily: 'Inter', codeFontSize: 14, codeFontFeatures: '"liga" 0' })).toEqual({
      code: '"Fira Code"',
      ui: 'Inter',
      codeSize: 14,
      features: '"liga" 0',
    });
  });
});

describe('toStyleVars', () => {
  it('sets the font variables of Pierre (diffs + trees) and of the viewer UI from the defaults', () => {
    const vars = toStyleVars(DEFAULT_SETTINGS);
    expect(vars).toMatchObject({
      '--pierre-font': GITHUB_FONTS.ui,
      '--pierre-mono': GITHUB_FONTS.code,
      '--diffs-font-family': GITHUB_FONTS.code,
      '--diffs-font-size': '12px',
      '--diffs-font-features': 'normal',
      '--diffs-header-font-family': GITHUB_FONTS.ui,
      '--trees-font-family-override': GITHUB_FONTS.ui,
      '--trees-font-size-override': '14px',
    });
  });

  it('applies custom fonts', () => {
    const vars = toStyleVars(withFonts({ codeFontFamily: '"Fira Code", monospace', uiFontFamily: 'Inter', codeFontSize: 15, codeFontFeatures: '"calt" 0' }));
    expect(vars['--diffs-font-family']).toBe('"Fira Code", monospace');
    expect(vars['--pierre-mono']).toBe('"Fira Code", monospace');
    expect(vars['--diffs-font-size']).toBe('15px');
    expect(vars['--diffs-font-features']).toBe('"calt" 0');
    expect(vars['--pierre-font']).toBe('Inter');
    expect(vars['--trees-font-family-override']).toBe('Inter');
    expect(vars['--diffs-header-font-family']).toBe('Inter');
  });

  it("sets GitHub's change colors (light-dark pairs) only for changeColors 'default'", () => {
    const vars = toStyleVars(DEFAULT_SETTINGS);
    expect(vars).toMatchObject({
      '--diffs-bg-addition-override': 'light-dark(#dafbe1, #2ea04326)',
      '--diffs-bg-addition-emphasis-override': 'light-dark(#aceebb, #2ea04366)',
      '--diffs-bg-addition-number-override': 'light-dark(#ccffd8, #3fb9504d)',
      '--diffs-bg-deletion-override': 'light-dark(#ffebe9, #f851491a)',
      '--diffs-bg-deletion-emphasis-override': 'light-dark(#ffcecb, #f8514966)',
      '--diffs-bg-deletion-number-override': 'light-dark(#ffd7d5, #f851494d)',
    });
    const theme = toStyleVars({ ...DEFAULT_SETTINGS, diff: { ...DEFAULT_SETTINGS.diff, changeColors: 'theme' } });
    expect(Object.keys(theme).filter((k) => k.startsWith('--diffs-bg-'))).toEqual([]);
  });

  it('returns the same object for the same inputs (applied once per settings change)', () => {
    expect(toStyleVars(DEFAULT_SETTINGS)).toBe(toStyleVars(DEFAULT_SETTINGS));
  });
});

describe('GitHub tree icons', () => {
  const { resolveIcon } = createFileTreeIconResolver(GITHUB_TREE_ICONS);

  it('uses the plain octicon file icon for every file, whatever its type', () => {
    for (const path of ['src/a.ts', 'package.json', 'README.md', 'Dockerfile', 'img.png']) {
      expect(resolveIcon('file-tree-icon-file', path).name, path).toBe('glide-octicon-file');
    }
  });

  it('draws folders with the octicon folder (filled; open when expanded)', () => {
    expect(resolveIcon('file-tree-icon-chevron').name).toBe('glide-octicon-folder');
    const sprite = GITHUB_TREE_ICONS.spriteSheet!;
    expect(sprite).toContain('id="glide-octicon-file"');
    expect(sprite).toContain('id="glide-octicon-folder"');
    // Closed and open shapes are switched by a custom property the tree CSS sets on expanded folder rows.
    expect(sprite).toContain('--glide-folder-open');
    expect(GITHUB_TREE_CSS).toMatch(/\[aria-expanded="true"\]\[data-item-type="folder"\]/);
    expect(GITHUB_TREE_CSS).toContain('--glide-folder-open');
    // The tree rotates closed folders' chevrons; a folder icon must stay upright.
    expect(GITHUB_TREE_CSS).toMatch(/transform:\s*none/);
  });
});
