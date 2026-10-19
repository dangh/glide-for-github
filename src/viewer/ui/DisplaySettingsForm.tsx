/**
 * Every `DisplaySettings` field (src/shared/settings.ts) as a form, shared by the viewer's Display menu and the
 * options page. Enumerations apply at once, with 'default' first as "Default (GitHub)"; numeric and text inputs
 * are debounced (chrome.storage.sync is rate limited) and a pending edit is flushed when the form unmounts or the
 * page is hidden, so closing the menu or the tab right after typing does not lose it. Invalid values are shown
 * (marked aria-invalid) but never committed.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { GITHUB_FONTS } from '../../shared/github-defaults';
import {
  DEFAULT_CHOICE,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  isFontText,
  RELATED_STYLES,
  SETTING_CHOICES,
  type DeepPartial,
  type DisplaySettings,
  type FontSettings,
  type RelatedStyle,
} from '../../shared/settings';

/** Pause after the last keystroke before a numeric edit is saved (sync storage allows ~120 writes per minute). */
export const INPUT_DEBOUNCE_MS = 400;

export type Update = (patch: DeepPartial<DisplaySettings>) => void;

export const DEFAULT_LABEL = 'Default (GitHub)';

function Select<T extends string>({ label, value, choices, onChange }: { label: string; value: T; choices: readonly T[]; onChange(v: T): void }) {
  // A stored value outside the list (a dark theme chosen as the light one) stays visible instead of snapping.
  const shown = choices.includes(value) ? choices : [value, ...choices];
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T)}>
        {shown.map((c) => (
          <option key={c} value={c}>
            {c === DEFAULT_CHOICE ? DEFAULT_LABEL : c}
          </option>
        ))}
      </select>
    </label>
  );
}

function Check({ label, value, onChange, hint }: { label: string; value: boolean; onChange(v: boolean): void; hint?: string }) {
  return (
    <label className="field field-check" title={hint}>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

/** Commits after the user paused typing, and immediately on unmount / pagehide. Invalid drafts are never committed. */
function useDebounced<T>(value: T, commit: (v: T) => void, valid: (v: T) => boolean) {
  const [draft, setDraft] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef<{ v: T } | null>(null);
  const commitRef = useRef(commit);
  commitRef.current = commit;
  useEffect(() => setDraft(value), [value]);

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const p = pending.current;
    pending.current = null;
    if (p) commitRef.current(p.v);
  }, []);
  useEffect(() => {
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [flush]);

  const change = (v: T) => {
    setDraft(v);
    clearTimeout(timer.current);
    if (valid(v)) {
      pending.current = { v };
      timer.current = setTimeout(flush, INPUT_DEBOUNCE_MS);
    } else {
      pending.current = null;
    }
  };
  return [draft, change] as const;
}

function NumberField({ label, value, min, onChange }: { label: string; value: number; min: number; onChange(v: number): void }) {
  const valid = (v: string) => /^\d+$/.test(v) && Number(v) >= min;
  const [draft, change] = useDebounced(String(value), (v) => onChange(Number(v)), valid);
  return (
    <label className="field">
      <span>{label}</span>
      <input type="number" min={min} step={1} value={draft} aria-invalid={!valid(draft) || undefined} onChange={(e) => change(e.target.value)} />
    </label>
  );
}

/**
 * Font text the stored-settings validation accepts (isFontText) and that CSS itself accepts as a custom property
 * value (`CSS.supports`, where available): unbalanced `)` / `]` or `!important` would pass the first check but make
 * the variable invalid at use, silently falling back to Pierre's font.
 */
export function fontTextValid(v: string): boolean {
  if (!isFontText(v)) return false;
  if (v.trim() === '' || typeof CSS === 'undefined' || typeof CSS.supports !== 'function') return true;
  return CSS.supports('--x', v);
}

/** Free font text (goes into a CSS custom property); empty = the GitHub default shown as placeholder. */
function FontTextField({ label, value, placeholder, onChange }: { label: string; value: string; placeholder: string; onChange(v: string): void }) {
  const [draft, change] = useDebounced(value, onChange, fontTextValid);
  return (
    <label className="field field-text">
      <span>{label}</span>
      <input
        type="text"
        value={draft}
        placeholder={placeholder}
        title={placeholder}
        spellCheck={false}
        aria-invalid={!fontTextValid(draft) || undefined}
        onChange={(e) => change(e.target.value)}
      />
    </label>
  );
}

const sizeValid = (v: string) => v === '' || (/^\d+$/.test(v) && Number(v) >= FONT_SIZE_MIN && Number(v) <= FONT_SIZE_MAX);

/** Code font size in px; empty = 'default' (GitHub's 12 px, shown as placeholder). */
function FontSizeField({ value, onChange }: { value: FontSettings['codeFontSize']; onChange(v: FontSettings['codeFontSize']): void }) {
  const [draft, change] = useDebounced(value === DEFAULT_CHOICE ? '' : String(value), (v) => onChange(v === '' ? DEFAULT_CHOICE : Number(v)), sizeValid);
  return (
    <label className="field">
      <span>Code font size (px)</span>
      <input
        type="number"
        min={FONT_SIZE_MIN}
        max={FONT_SIZE_MAX}
        step={1}
        value={draft}
        placeholder={String(GITHUB_FONTS.codeSize)}
        aria-invalid={!sizeValid(draft) || undefined}
        onChange={(e) => change(e.target.value)}
      />
    </label>
  );
}

/** The related-files styles, as the Display menu and the options page name them. */
export const RELATED_STYLE_LABELS: Record<RelatedStyle, string> = { nested: 'Nested', box: 'One box', rail: 'Group rail', off: 'Off' };

/** `relatedFiles`: the Related files choice (the options page shows it in its own section, with previews). */
export function DisplaySettingsForm({ settings, update, relatedFiles = true }: { settings: DisplaySettings; update: Update; relatedFiles?: boolean }) {
  const d = settings.diff;
  const t = settings.tree;
  const diff = (p: Partial<DisplaySettings['diff']>) => update({ diff: p });
  const tree = (p: Partial<DisplaySettings['tree']>) => update({ tree: p });
  const fonts = (p: Partial<DisplaySettings['fonts']>) => update({ fonts: p });
  const f = settings.fonts;
  const C = SETTING_CHOICES;
  const expansion = typeof t.initialExpansion === 'number' ? String(t.initialExpansion) : t.initialExpansion;
  const density = typeof t.density === 'number' ? 'default' : t.density;

  return (
    <div className="settings-form">
      <fieldset>
        <legend>Diff</legend>
        <Select label="Layout" value={d.diffStyle} choices={C.diff.diffStyle} onChange={(v) => diff({ diffStyle: v })} />
        <Select label="Long lines" value={d.overflow} choices={C.diff.overflow} onChange={(v) => diff({ overflow: v })} />
        <Select label="Inline changes" value={d.lineDiffType} choices={C.diff.lineDiffType} onChange={(v) => diff({ lineDiffType: v })} />
        <Select label="Change indicators" value={d.diffIndicators} choices={C.diff.diffIndicators} onChange={(v) => diff({ diffIndicators: v })} />
        <Select label="Hunk separators" value={d.hunkSeparators} choices={C.diff.hunkSeparators} onChange={(v) => diff({ hunkSeparators: v })} />
        <Select label="Line hover" value={d.lineHoverHighlight} choices={C.diff.lineHoverHighlight} onChange={(v) => diff({ lineHoverHighlight: v })} />
        <Check label="No change background" value={d.disableBackground} onChange={(v) => diff({ disableBackground: v })} />
        <Check label="Hide line numbers" value={d.disableLineNumbers} onChange={(v) => diff({ disableLineNumbers: v })} />
        <Check label="Expand unchanged lines" value={d.expandUnchanged} onChange={(v) => diff({ expandUnchanged: v })} />
        <Check label="Sticky file headers" value={d.stickyHeader} onChange={(v) => diff({ stickyHeader: v })} />
        <NumberField label="Lines per expand" value={d.expansionLineCount} min={1} onChange={(v) => diff({ expansionLineCount: v })} />
        <NumberField
          label="Collapse context above"
          value={d.collapsedContextThreshold}
          min={0}
          onChange={(v) => diff({ collapsedContextThreshold: v })}
        />
        <Select label="Mode" value={d.themeType} choices={C.diff.themeType} onChange={(v) => diff({ themeType: v })} />
        <Select label="Light theme" value={d.themeLight} choices={C.diff.themeLight as readonly string[]} onChange={(v) => diff({ themeLight: v })} />
        <Select label="Dark theme" value={d.themeDark} choices={C.diff.themeDark as readonly string[]} onChange={(v) => diff({ themeDark: v })} />
        <Select label="Change colors" value={d.changeColors} choices={C.diff.changeColors} onChange={(v) => diff({ changeColors: v })} />
        <Select label="File headers" value={d.fileHeaderStyle} choices={C.diff.fileHeaderStyle} onChange={(v) => diff({ fileHeaderStyle: v })} />
      </fieldset>
      <fieldset>
        <legend>Tree</legend>
        <Check label="Filter box" value={t.search} onChange={(v) => tree({ search: v })} />
        <Select label="Filter mode" value={t.fileTreeSearchMode} choices={C.tree.fileTreeSearchMode} onChange={(v) => tree({ fileTreeSearchMode: v })} />
        <Select label="On filter blur" value={t.searchBlurBehavior} choices={C.tree.searchBlurBehavior} onChange={(v) => tree({ searchBlurBehavior: v })} />
        <Select
          label="Folders start"
          value={expansion}
          choices={[...C.tree.initialExpansion, '1', '2', '3'] as const}
          onChange={(v) => tree({ initialExpansion: v === 'open' || v === 'closed' || v === DEFAULT_CHOICE ? v : Number(v) })}
        />
        <Check label="Flatten single-child folders" value={t.flattenEmptyDirectories} onChange={(v) => tree({ flattenEmptyDirectories: v })} />
        <Check label="Sticky folders" value={t.stickyFolders} onChange={(v) => tree({ stickyFolders: v })} />
        <Select label="Density" value={density} choices={C.tree.density} onChange={(v) => tree({ density: v })} />
        <Select label="Icons" value={t.icons} choices={C.tree.icons} onChange={(v) => tree({ icons: v })} />
        <Check label="Colored icons" value={t.coloredIcons} onChange={(v) => tree({ coloredIcons: v })} />
        <Check label="Git status letters" value={t.showGitStatus} onChange={(v) => tree({ showGitStatus: v })} hint="A / M / D badges in the tree" />
        <Select
          label="Tree position"
          value={settings.layout.treePosition}
          choices={C.layout.treePosition}
          onChange={(v) => update({ layout: { treePosition: v } })}
        />
      </fieldset>
      <fieldset>
        <legend>Fonts</legend>
        <FontTextField label="Code font" value={f.codeFontFamily} placeholder={GITHUB_FONTS.code} onChange={(v) => fonts({ codeFontFamily: v })} />
        <FontSizeField value={f.codeFontSize} onChange={(v) => fonts({ codeFontSize: v })} />
        <FontTextField label="Code font features" value={f.codeFontFeatures} placeholder={GITHUB_FONTS.features} onChange={(v) => fonts({ codeFontFeatures: v })} />
        <FontTextField label="UI font" value={f.uiFontFamily} placeholder={GITHUB_FONTS.ui} onChange={(v) => fonts({ uiFontFamily: v })} />
      </fieldset>
      <fieldset>
        <legend>Review</legend>
        <Check label="Hide whitespace changes" value={settings.review.hideWhitespace} onChange={(v) => update({ review: { hideWhitespace: v } })} />
        {relatedFiles && (
          <label className="field">
            <span>Related files</span>
            <select value={settings.relatedFiles.style} onChange={(e) => update({ relatedFiles: { style: e.target.value as RelatedStyle } })}>
              {RELATED_STYLES.map((style) => (
                <option key={style} value={style}>
                  {RELATED_STYLE_LABELS[style]}
                </option>
              ))}
            </select>
          </label>
        )}
      </fieldset>
      <details className="advanced">
        <summary>Advanced</summary>
        <NumberField label="Highlight lines up to (chars)" value={d.tokenizeMaxLineLength} min={1} onChange={(v) => diff({ tokenizeMaxLineLength: v })} />
        <NumberField label="Highlight files up to (chars)" value={d.tokenizeMaxLength} min={1} onChange={(v) => diff({ tokenizeMaxLength: v })} />
        <NumberField label="Inline diff lines up to (chars)" value={d.maxLineDiffLength} min={1} onChange={(v) => diff({ maxLineDiffLength: v })} />
        <NumberField label="Gap between files (px)" value={d.layoutGap} min={0} onChange={(v) => diff({ layoutGap: v })} />
        <NumberField label="Padding top (px)" value={d.layoutPaddingTop} min={0} onChange={(v) => diff({ layoutPaddingTop: v })} />
        <NumberField label="Padding bottom (px)" value={d.layoutPaddingBottom} min={0} onChange={(v) => diff({ layoutPaddingBottom: v })} />
      </details>
    </div>
  );
}
