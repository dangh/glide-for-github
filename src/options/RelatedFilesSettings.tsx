/**
 * The options page's Related files section: how related files show (`DisplaySettings.relatedFiles.style`, two
 * choices, each with a small preview drawn like the viewer's GitHub file boxes) and the rules that relate them, saved
 * at once (debounced) to their storage item (src/shared/related-files-storage.ts), as the file groups editor does.
 */
import { useMemo, useState } from 'react';
import { BASENAME, relateFiles, rulesProblem, type RelatedRule } from '../shared/related-files';
import { defaultRules, loadRelatedRules, onRelatedRulesChange, saveRelatedRules, sameRules } from '../shared/related-files-storage';
import { RELATED_STYLES, type RelatedStyle } from '../shared/settings';
import { RELATED_STYLE_LABELS, type Update } from '../viewer/ui/DisplaySettingsForm';
import { RowActions } from './ListRow';
import { AutoSizeTextarea } from './AutoSizeTextarea';
import { useEditableList } from './useEditableList';

/** A rule being edited: `id` follows it through moves; `text` is the textarea, one related-file pattern per line. */
interface DraftRule {
  id: number;
  main: string;
  text: string;
}

let nextId = 1;
const toDraft = (rules: readonly RelatedRule[]): DraftRule[] => rules.map((r) => ({ id: nextId++, main: r.main, text: r.companions.join('\n') }));
const fromDraft = (draft: readonly DraftRule[]): RelatedRule[] =>
  draft.map((d) => ({ main: d.main.trim(), companions: d.text.split('\n').map((p) => p.trim()).filter(Boolean) }));

const DESCRIPTIONS: Record<RelatedStyle, string> = {
  nested: 'A related file folds into one line at the bottom of its main file. Click it to open its diff.',
  off: 'Every file on its own, in GitHub’s order.',
};

const Head = ({ name, counts, viewed }: { name: string; counts: [number, number]; viewed?: string }) => (
  <div className="rp-head">
    <span className="rp-chevron">▾</span>
    <span className="rp-name">{name}</span>
    <span className="rp-grow" />
    <span className="rp-add">+{counts[0]}</span>
    <span className="rp-del">−{counts[1]}</span>
    {viewed && <span className="rp-viewed">☐ {viewed}</span>}
  </div>
);

const Code = ({ lines }: { lines: [string, string][] }) => (
  <div className="rp-code">
    {lines.map(([kind, text], i) => (
      <div key={i} className={`rp-line rp-${kind}`}>
        {text}
      </div>
    ))}
  </div>
);

const MAIN_LINES: [string, string][] = [
  ['d', '-  "react": "^18.2.0",'],
  ['a', '+  "react": "^19.0.0",'],
];
const LOCK_LINES: [string, string][] = [['a', '+  "node_modules/react": {']];
const Tag = () => <span className="rp-tag">lock file</span>;

/** A mock of the diff list in one style, drawn like the viewer's GitHub file boxes. */
function Preview({ style }: { style: RelatedStyle }) {
  switch (style) {
    case 'nested':
      return (
        <div className="rp-box">
          <Head name="package.json" counts={[2, 1]} viewed="Viewed" />
          <Code lines={MAIN_LINES} />
          <div className="rp-head rp-row">
            <span className="rp-chevron">▸</span>
            <span className="rp-name">package-lock.json</span>
            <Tag />
            <span className="rp-grow" />
            <span className="rp-add">+312</span>
            <span className="rp-del">−45</span>
          </div>
        </div>
      );
    case 'off':
      return (
        <div>
          <div className="rp-box">
            <Head name="package-lock.json" counts={[312, 45]} viewed="Viewed" />
            <Code lines={LOCK_LINES} />
          </div>
          <div className="rp-box">
            <Head name="package.json" counts={[2, 1]} viewed="Viewed" />
            <Code lines={MAIN_LINES} />
          </div>
        </div>
      );
  }
}

function StylePicker({ value, onChange }: { value: RelatedStyle; onChange(style: RelatedStyle): void }) {
  return (
    <div className="related-styles" role="radiogroup" aria-label="Show related files">
      {RELATED_STYLES.map((style) => (
        <label key={style} className="related-style" data-checked={style === value || undefined} data-testid={`related-style-${style}`}>
          <span className="related-style-title">
            <input type="radio" name="related-style" value={style} checked={style === value} onChange={() => onChange(style)} />
            {RELATED_STYLE_LABELS[style]}
            {style === 'nested' && <span className="muted related-style-default"> (default)</span>}
          </span>
          <span className="related-style-description">{DESCRIPTIONS[style]}</span>
          <span className="related-preview" aria-hidden="true">
            <Preview style={style} />
          </span>
        </label>
      ))}
    </div>
  );
}

function RuleEditor({ draft, index, count, onChange, onMove, onDelete }: {
  draft: DraftRule;
  index: number;
  count: number;
  onChange(next: DraftRule): void;
  onMove(by: -1 | 1): void;
  onDelete(): void;
}) {
  const name = draft.main.trim() || `rule ${index + 1}`;
  return (
    <li className="related-rule" data-testid="related-rule">
      <input
        type="text"
        className="group-label"
        aria-label={`Main file of rule ${index + 1}`}
        placeholder="package.json"
        spellCheck={false}
        value={draft.main}
        onChange={(e) => onChange({ ...draft, main: e.target.value })}
      />
      <span className="related-rule-arrow" aria-hidden="true">
        ←
      </span>
      <AutoSizeTextarea
        className="group-patterns related-patterns"
        aria-label={`Related files of ${name}`}
        placeholder="package-lock.json"
        spellCheck={false}
        value={draft.text}
        onChange={(e) => onChange({ ...draft, text: e.target.value })}
      />
      <RowActions name={name} index={index} count={count} onMove={onMove} onDelete={onDelete} />
    </li>
  );
}

const PROBE_SAMPLE = ['package.json', 'package-lock.json', 'services/api/serverless.yml', 'services/api/serverless-resources.yml', 'src/index.ts'].join('\n');

/** Paths typed one per line, and how the rules relate them. */
function PathsProbe({ rules }: { rules: readonly RelatedRule[] }) {
  const [text, setText] = useState(PROBE_SAMPLE);
  const result = useMemo(() => {
    const paths = text.split('\n').map((p) => p.trim()).filter(Boolean);
    return relateFiles(rules, paths);
  }, [rules, text]);
  return (
    <div className="related-probe">
      <label className="field field-text related-probe-input">
        <span>Try paths, one per line</span>
        <AutoSizeTextarea className="group-patterns" spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <div data-testid="related-probe-result" className="related-probe-result">
        {result.companions.size === 0 ? (
          <span className="muted">Nothing related.</span>
        ) : (
          <ul>
            {[...result.companions].map(([main, list]) => (
              <li key={main}>
                <code>{main}</code> ← {list.map((c, i) => (
                  <span key={c}>
                    {i > 0 && ', '}
                    <code>{c.slice(c.lastIndexOf('/') + 1)}</code>
                  </span>
                ))}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function RelatedFilesSettingsForm({ style, update }: { style: RelatedStyle; update: Update }) {
  const { draft, status, edit } = useEditableList({
    load: loadRelatedRules,
    subscribe: onRelatedRulesChange,
    defaults: defaultRules,
    toDraft,
    fromDraft,
    same: sameRules,
    problem: rulesProblem,
    save: saveRelatedRules,
  });
  const rules = useMemo(() => (draft ? fromDraft(draft) : []), [draft]);

  const move = (i: number, by: -1 | 1) => {
    if (!draft) return;
    const next = [...draft];
    [next[i], next[i + by]] = [next[i + by]!, next[i]!];
    edit(next);
  };

  return (
    <div className="related-settings">
      <StylePicker value={style} onChange={(next) => update({ relatedFiles: { style: next } })} />
      <h3 className="group-heading">Rules</h3>
      <p className="muted">
        Each rule names a main file and, one per line, the files related to it. Related files must sit in the main file’s
        folder. Patterns are file names: <code>*</code> matches any characters, <code>?</code> one character, and{' '}
        <code>{BASENAME}</code> in a related file stands for the main file’s name without its extension (like{' '}
        <code>{`${BASENAME}.lock`}</code>). Names are case-insensitive. The first rule that matches a main file wins, and a
        file belongs to one main file at most.
      </p>
      {draft && (
        <>
          <p className="muted rule-editor-hint">Click a pattern to edit, or use Tab. Valid changes save automatically.</p>
          <ol className="box-list rule-editor-list related-rules">
            {draft.map((d, i) => (
              <RuleEditor
                key={d.id}
                draft={d}
                index={i}
                count={draft.length}
                onChange={(next) => edit(draft.map((x) => (x.id === d.id ? next : x)))}
                onMove={(by) => move(i, by)}
                onDelete={() => edit(draft.filter((x) => x.id !== d.id))}
              />
            ))}
          </ol>
          <div className="options-actions">
            <button type="button" className="btn" onClick={() => edit([...draft, { id: nextId++, main: '', text: '' }])}>
              Add rule
            </button>
            <button type="button" className="btn" onClick={() => edit(toDraft(defaultRules()))}>
              Reset to defaults
            </button>
            {status.kind === 'error' && (
              <span className="group-error" role="alert">
                {status.message}
              </span>
            )}
            {status.kind === 'saved' && (
              <span className="muted" role="status">
                Saved
              </span>
            )}
          </div>
          <PathsProbe rules={rules} />
        </>
      )}
    </div>
  );
}
