/**
 * Every `DisplaySettings` field (src/shared/settings.ts) as a form, shared by the viewer's Display menu and the
 * options page. Enumerations apply at once; numeric inputs are debounced (chrome.storage.sync is rate limited)
 * and a pending edit is flushed when the form unmounts or the page is hidden, so closing the menu or the tab
 * right after typing does not lose it. Invalid values are shown but never committed.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { DARK_THEMES, LIGHT_THEMES, SETTING_CHOICES, type DeepPartial, type DisplaySettings } from '../../shared/settings';

/** Pause after the last keystroke before a numeric edit is saved (sync storage allows ~120 writes per minute). */
export const INPUT_DEBOUNCE_MS = 400;

export type Update = (patch: DeepPartial<DisplaySettings>) => void;

function Select<T extends string>({ label, value, choices, onChange }: { label: string; value: T; choices: readonly T[]; onChange(v: T): void }) {
  // A stored value outside the list (a dark theme chosen as the light one) stays visible instead of snapping.
  const shown = choices.includes(value) ? choices : [value, ...choices];
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T)}>
        {shown.map((c) => (
          <option key={c} value={c}>
            {c}
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
  const [draft, change] = useDebounced(String(value), (v) => onChange(Number(v)), (v) => /^\d+$/.test(v) && Number(v) >= min);
  return (
    <label className="field">
      <span>{label}</span>
      <input type="number" min={min} step={1} value={draft} onChange={(e) => change(e.target.value)} />
    </label>
  );
}

export function DisplaySettingsForm({ settings, update }: { settings: DisplaySettings; update: Update }) {
  const d = settings.diff;
  const t = settings.tree;
  const diff = (p: Partial<DisplaySettings['diff']>) => update({ diff: p });
  const tree = (p: Partial<DisplaySettings['tree']>) => update({ tree: p });
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
        <Select label="Light theme" value={d.themeLight} choices={LIGHT_THEMES} onChange={(v) => diff({ themeLight: v })} />
        <Select label="Dark theme" value={d.themeDark} choices={DARK_THEMES} onChange={(v) => diff({ themeDark: v })} />
      </fieldset>
      <fieldset>
        <legend>Tree</legend>
        <Check label="Filter box" value={t.search} onChange={(v) => tree({ search: v })} />
        <Select label="Filter mode" value={t.fileTreeSearchMode} choices={C.tree.fileTreeSearchMode} onChange={(v) => tree({ fileTreeSearchMode: v })} />
        <Select label="On filter blur" value={t.searchBlurBehavior} choices={C.tree.searchBlurBehavior} onChange={(v) => tree({ searchBlurBehavior: v })} />
        <Select
          label="Folders start"
          value={expansion}
          choices={['closed', 'open', '1', '2', '3'] as const}
          onChange={(v) => tree({ initialExpansion: v === 'open' || v === 'closed' ? v : Number(v) })}
        />
        <Check label="Flatten single-child folders" value={t.flattenEmptyDirectories} onChange={(v) => tree({ flattenEmptyDirectories: v })} />
        <Check label="Sticky folders" value={t.stickyFolders} onChange={(v) => tree({ stickyFolders: v })} />
        <Select label="Density" value={density} choices={C.tree.density} onChange={(v) => tree({ density: v })} />
        <Select label="Icons" value={t.icons} choices={C.tree.icons} onChange={(v) => tree({ icons: v })} />
        <Check label="Colored icons" value={t.coloredIcons} onChange={(v) => tree({ coloredIcons: v })} />
      </fieldset>
      <fieldset>
        <legend>Review</legend>
        <Check label="Hide whitespace changes" value={settings.review.hideWhitespace} onChange={(v) => update({ review: { hideWhitespace: v } })} />
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
