/**
 * Display menu: every `DisplaySettings` field (src/shared/settings.ts). Changes apply without reload and
 * persist to `chrome.storage.sync`; numeric and text fields are debounced (sync storage is rate limited).
 * `DisplaySettingsForm` is reusable by the options page (Task 13).
 */
import { memo, useEffect, useRef, useState } from 'react';
import { SETTING_CHOICES, type DeepPartial, type DisplaySettings } from '../../shared/settings';
import { useSettings } from '../state/settings';
import { Popover } from './Popover';

export const INPUT_DEBOUNCE_MS = 400;

const THEME_SUGGESTIONS = [
  'pierre-light',
  'pierre-dark',
  'github-light',
  'github-dark',
  'github-light-default',
  'github-dark-default',
  'github-light-high-contrast',
  'github-dark-high-contrast',
  'one-light',
  'one-dark-pro',
  'min-light',
  'min-dark',
  'vitesse-light',
  'vitesse-dark',
  'catppuccin-latte',
  'catppuccin-mocha',
  'solarized-light',
  'solarized-dark',
  'dracula',
  'nord',
];

type Update = (patch: DeepPartial<DisplaySettings>) => void;

function Select<T extends string>({ label, value, choices, onChange }: { label: string; value: T; choices: readonly T[]; onChange(v: T): void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T)}>
        {choices.map((c) => (
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

/** Commits after the user paused typing; invalid values are shown but never saved. */
function useDebounced<T>(value: T, commit: (v: T) => void, valid: (v: T) => boolean) {
  const [draft, setDraft] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => setDraft(value), [value]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const change = (v: T) => {
    setDraft(v);
    clearTimeout(timer.current);
    if (valid(v)) timer.current = setTimeout(() => commit(v), INPUT_DEBOUNCE_MS);
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

function TextField({ label, value, onChange, list }: { label: string; value: string; onChange(v: string): void; list?: string }) {
  const [draft, change] = useDebounced(value, onChange, (v) => v.trim() !== '');
  return (
    <label className="field">
      <span>{label}</span>
      <input type="text" value={draft} list={list} onChange={(e) => change(e.target.value)} />
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
      <datalist id="pierre-themes">
        {THEME_SUGGESTIONS.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
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
      </fieldset>
      <fieldset>
        <legend>Theme</legend>
        <Select label="Mode" value={d.themeType} choices={C.diff.themeType} onChange={(v) => diff({ themeType: v })} />
        <TextField label="Light theme" value={d.themeLight} list="pierre-themes" onChange={(v) => diff({ themeLight: v })} />
        <TextField label="Dark theme" value={d.themeDark} list="pierre-themes" onChange={(v) => diff({ themeDark: v })} />
      </fieldset>
      <fieldset>
        <legend>File tree</legend>
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

export const DisplayMenu = memo(function DisplayMenu() {
  const settings = useSettings((s) => s.settings);
  const update = useSettings((s) => s.update);
  return (
    <Popover label="⚙ Display" title="Display options" testId="display-menu" className="display-menu">
      {() => <DisplaySettingsForm settings={settings} update={update} />}
    </Popover>
  );
});
