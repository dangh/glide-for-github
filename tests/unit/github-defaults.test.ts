import { createFileTreeIconResolver } from '@pierre/trees';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DIFF_CSS,
  GITHUB_CHANGE_CSS,
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
      hunkSeparators: 'line-info-basic',
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

  it("uses GitHub's diffBlob colors from Primer primitives 11.10.0 (light and dark)", () => {
    expect(GITHUB_COLORS).toEqual({
      additionLine: { light: '#dafbe1', dark: '#2ea04326' },
      additionWord: { light: '#aceebb', dark: '#2ea04366' },
      additionNum: { light: '#aceebb', dark: '#3fb9504d' },
      deletionLine: { light: '#ffebe9', dark: '#f851491a' },
      deletionWord: { light: '#ffcecb', dark: '#f8514966' },
      deletionNum: { light: '#ffcecb', dark: '#f851494d' },
    });
  });
});

describe('fonts', () => {
  it("GitHub's stacks and 12 px code by default", () => {
    expect(GITHUB_FONTS.code).toBe('ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace');
    expect(GITHUB_FONTS.ui).toBe('-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji"');
    expect(GITHUB_FONTS.codeSize).toBe(12);
    expect(GITHUB_FONTS.features).toBe('normal');
    expect(resolveFonts(DEFAULT_SETTINGS.fonts)).toEqual({ code: GITHUB_FONTS.code, ui: GITHUB_FONTS.ui, codeSize: 12, codeLineHeight: 20, features: 'normal' });
  });

  it("scales the code line height with the size (GitHub's 20 px at 12 px), so large sizes do not overlap", () => {
    const at = (codeFontSize: number) => resolveFonts({ ...DEFAULT_SETTINGS.fonts, codeFontSize }).codeLineHeight;
    expect(at(12)).toBe(20);
    expect(at(24)).toBe(40);
    expect(at(8)).toBe(13);
    expect(at(32)).toBe(53);
    for (let size = 8; size <= 32; size++) expect(at(size), String(size)).toBeGreaterThanOrEqual(Math.ceil(size * 1.5));
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
      codeLineHeight: 23,
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
      '--diffs-line-height': '20px',
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
    expect(vars['--diffs-line-height']).toBe('25px');
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
      '--diffs-bg-addition-number-override': 'light-dark(#aceebb, #3fb9504d)',
      '--diffs-bg-deletion-override': 'light-dark(#ffebe9, #f851491a)',
      '--diffs-bg-deletion-emphasis-override': 'light-dark(#ffcecb, #f8514966)',
      '--diffs-bg-deletion-number-override': 'light-dark(#ffcecb, #f851494d)',
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

  it("draws folders like GitHub: chevron + gap + octicon folder in one 40x16 icon (open: chevron-down + open folder)", () => {
    expect(resolveIcon('file-tree-icon-chevron')).toMatchObject({ name: 'glide-octicon-folder', width: 40, height: 16, viewBox: '0 0 40 16' });
    // Both rows get a 40 px icon cell; file icons sit right-aligned, under their sibling folders' icons.
    expect(GITHUB_TREE_CSS).toMatch(/\[data-item-section="icon"\][^}]*width:\s*40px/);
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

/** All JS of an installed @pierre package's dist (its own files, not nested node_modules). */
function pierreDist(pkg: 'diffs' | 'trees'): string {
  const root = join(__dirname, '../../node_modules/@pierre', pkg, 'dist');
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (e.name !== 'node_modules') walk(join(dir, e.name));
      } else if (e.name.endsWith('.js')) out.push(readFileSync(join(dir, e.name), 'utf8'));
    }
  };
  walk(root);
  return out.join('\n');
}

/** Attribute names, attribute values and non-Glide custom properties a CSS string refers to. */
function cssNames(css: string): string[] {
  const names = new Set<string>();
  for (const m of css.matchAll(/\[([a-z-]+)(?:[\^]?=["']?([\w-]+))?/g)) {
    names.add(m[1]!);
    if (m[2]) names.add(m[2]);
  }
  for (const m of css.matchAll(/--[\w-]+/g)) if (!m[0].startsWith('--glide-')) names.add(m[0]);
  return [...names];
}

describe('names our fixed Pierre CSS relies on (guards drift on @pierre upgrades)', () => {
  const diffs = pierreDist('diffs');
  const trees = pierreDist('trees');

  it('the diff unsafeCSS and the style variables exist in @pierre/diffs', () => {
    const names = [...cssNames(GITHUB_CHANGE_CSS), ...cssNames(DIFF_CSS), 'change-addition', 'change-deletion', 'data-diff-span'];
    for (const v of Object.keys(toStyleVars(DEFAULT_SETTINGS))) if (v.startsWith('--diffs-')) names.push(v);
    expect(names).toEqual(
      expect.arrayContaining(['--mix-light', '--mix-dark', 'data-line-type', 'data-background', '--diffs-line-height', '--diffs-gap-style', '--diffs-min-number-column-width', '--diffs-scrollbar-gutter', 'data-overflow', 'data-code']),
    );
    for (const name of names) expect(diffs.includes(name), name).toBe(true);
  });

  it('the tree unsafeCSS, icon slots and style variables exist in @pierre/trees', () => {
    const names = [...cssNames(GITHUB_TREE_CSS), ...Object.keys(GITHUB_TREE_ICONS.remap ?? {})];
    for (const v of Object.keys(toStyleVars(DEFAULT_SETTINGS))) if (v.startsWith('--trees-')) names.push(v);
    expect(names).toEqual(expect.arrayContaining(['data-item-section', 'data-item-type', 'data-icon-name', 'aria-expanded', 'file-tree-icon-chevron']));
    for (const name of names) expect(trees.includes(name), name).toBe(true);
  });
});
