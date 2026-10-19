/**
 * The options page's Related files section: how related files show (`DisplaySettings.relatedFiles.style`, four
 * choices, each with a small preview drawn like the viewer's GitHub file boxes) and the rules that relate them, saved
 * at once (debounced) to their storage item (src/shared/related-files-storage.ts), as the file groups editor does.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BASENAME, relateFiles, rulesProblem, type RelatedRule } from '../shared/related-files';
import { defaultRules, loadRelatedRules, onRelatedRulesChange, saveRelatedRules, sameRules } from '../shared/related-files-storage';
import { RELATED_STYLES, type RelatedStyle } from '../shared/settings';
import { RELATED_STYLE_LABELS, type Update } from '../viewer/ui/DisplaySettingsForm';
import { RowActions, usePreviewRows } from './ListRow';

const SAVE_DELAY_MS = 400;

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

type Status = { kind: 'idle' } | { kind: 'saved' } | { kind: 'error'; message: string };

const DESCRIPTIONS: Record<RelatedStyle, string> = {
  nested: 'A related file folds into one line at the bottom of its main file. Click it to open its diff.',
  box: 'Related files share one box under a summary header, each file with its own small header.',
  rail: 'Files keep their own boxes under a group line, tied by a rail.',
  off: 'Every file on its own, in GitHub’s order.',
};

const Head = ({ chevron = '▾', name, extra, counts, viewed }: { chevron?: string; name: string; extra?: ReactNode; counts: [number, number]; viewed?: string }) => (
  <div className="rp-head">
    <span className="rp-chevron">{chevron}</span>
    <span className="rp-name">{name}</span>
    {extra}
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
    case 'box':
      return (
        <div className="rp-box">
          <Head name="package.json" extra={<span className="rp-muted">+ 1 related</span>} counts={[314, 46]} viewed="Viewed" />
          <div className="rp-head rp-sub">
            <span className="rp-name">package.json</span>
            <span className="rp-grow" />
            <span className="rp-add">+2</span>
            <span className="rp-del">−1</span>
          </div>
          <Code lines={MAIN_LINES} />
          <div className="rp-head rp-sub">
            <span className="rp-name">package-lock.json</span>
            <Tag />
            <span className="rp-grow" />
            <span className="rp-add">+312</span>
            <span className="rp-del">−45</span>
          </div>
          <Code lines={LOCK_LINES} />
        </div>
      );
    case 'rail':
      return (
        <div>
          <div className="rp-group">
            <span className="rp-chevron">▾</span>
            <span className="rp-name">package.json</span>
            <span className="rp-muted">· 2 files</span>
            <span className="rp-grow" />
            <span className="rp-viewed">☐ Viewed all</span>
          </div>
          <div className="rp-rail">
            <div className="rp-box">
              <Head name="package.json" counts={[2, 1]} viewed="Viewed" />
              <Code lines={MAIN_LINES} />
            </div>
            <div className="rp-box">
              <Head chevron="▸" name="package-lock.json" counts={[312, 45]} viewed="Viewed" />
            </div>
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
      <textarea
        className="group-patterns related-patterns"
        aria-label={`Related files of ${name}`}
        placeholder="package-lock.json"
        spellCheck={false}
        {...usePreviewRows(draft.text, 1, 6)}
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
        <textarea className="group-patterns" spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} />
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
  const [draft, setDraft] = useState<DraftRule[] | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  /** What storage holds. */
  const saved = useRef<DraftRule[]>([]);
  const submitted = useRef<DraftRule[] | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** A valid edit waiting out SAVE_DELAY_MS; written at once if the page is closed or hidden first. */
  const pending = useRef<DraftRule[] | null>(null);

  const commit = (next: DraftRule[]) => {
    clearTimeout(timer.current);
    pending.current = null;
    submitted.current = next;
    // Issued before pagehide returns; this page may die before the promise settles.
    saveRelatedRules(fromDraft(next)).then(
      () => {
        if (submitted.current !== next) return;
        saved.current = next;
        if (sameRules(fromDraft(draftRef.current ?? []), fromDraft(next))) setStatus({ kind: 'saved' });
      },
      (err: unknown) => {
        if (submitted.current !== next) return;
        submitted.current = saved.current;
        setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
      },
    );
  };
  const commitRef = useRef(commit);
  commitRef.current = commit;

  useEffect(() => {
    let active = true;
    let changed = false;
    const adopt = (rules: RelatedRule[]) => {
      // Another context's change (or the echo of ours): take it unless this page has unsaved edits.
      setDraft((current) => {
        if (current && !sameRules(fromDraft(current), fromDraft(saved.current))) return current;
        if (current && sameRules(fromDraft(current), rules)) return current;
        const next = toDraft(rules);
        saved.current = next;
        submitted.current = next;
        return next;
      });
    };
    const initial = (rules: RelatedRule[]) => { if (active && !changed) adopt(rules); };
    void loadRelatedRules().then(initial, () => initial(defaultRules()));
    const off = onRelatedRulesChange((rules) => {
      changed = true;
      adopt(rules);
    });
    const flush = () => {
      if (pending.current) commitRef.current(pending.current);
    };
    const onHidden = () => document.visibilityState === 'hidden' && flush();
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      active = false;
      off();
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onHidden);
      flush();
    };
  }, []);

  const rules = useMemo(() => (draft ? fromDraft(draft) : []), [draft]);

  const edit = (next: DraftRule[]) => {
    setDraft(next);
    clearTimeout(timer.current);
    pending.current = null;
    const problem = rulesProblem(fromDraft(next));
    if (problem) return setStatus({ kind: 'error', message: problem });
    setStatus({ kind: 'idle' });
    pending.current = next;
    timer.current = setTimeout(() => commit(next), SAVE_DELAY_MS);
  };

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
