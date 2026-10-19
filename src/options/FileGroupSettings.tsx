/**
 * The options page's File groups section: the switches (`DisplaySettings.fileGroups`) and the group editor, which
 * saves each valid edit at once (debounced) to its own storage items (src/shared/file-groups-storage.ts).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ALL_GROUP, classify, compileGroups, groupsProblem, parseSiftImport, type FileGroup, type SiftImport } from '../shared/file-groups';
import { defaultGroups, loadFileGroups, onFileGroupsChange, saveFileGroups, sameGroups } from '../shared/file-groups-storage';
import type { FileGroupSettings } from '../shared/settings';
import type { Update } from '../viewer/ui/DisplaySettingsForm';

const SAVE_DELAY_MS = 400;

/** A group being edited: `id` follows it through renames and moves; `text` is the textarea, one pattern per line. */
interface DraftGroup {
  id: number;
  label: string;
  text: string;
}

let nextId = 1;
const toDraft = (groups: readonly FileGroup[]): DraftGroup[] => groups.map((g) => ({ id: nextId++, label: g.label, text: g.patterns.join('\n') }));
const fromDraft = (draft: readonly DraftGroup[]): FileGroup[] =>
  draft.map((d) => ({ label: d.label.trim(), patterns: d.text.split('\n').map((p) => p.trim()).filter(Boolean) }));

type Status = { kind: 'idle' } | { kind: 'saved' } | { kind: 'error'; message: string };

function GroupEditor({ draft, index, count, onChange, onMove, onDelete }: {
  draft: DraftGroup;
  index: number;
  count: number;
  onChange(next: DraftGroup): void;
  onMove(by: -1 | 1): void;
  onDelete(): void;
}) {
  const name = draft.label.trim() || `Group ${index + 1}`;
  return (
    <li className="group-card" data-testid="group-card">
      <div className="group-card-row">
        <input
          type="text"
          className="group-label"
          aria-label={`Name of group ${index + 1}`}
          placeholder="Group name"
          value={draft.label}
          onChange={(e) => onChange({ ...draft, label: e.target.value })}
        />
        <button type="button" className="btn" aria-label={`Move ${name} up`} disabled={index === 0} onClick={() => onMove(-1)}>
          Up
        </button>
        <button type="button" className="btn" aria-label={`Move ${name} down`} disabled={index === count - 1} onClick={() => onMove(1)}>
          Down
        </button>
        <button type="button" className="btn" aria-label={`Delete ${name}`} onClick={onDelete}>
          Delete
        </button>
      </div>
      <textarea
        className="group-patterns"
        aria-label={`Patterns of ${name}`}
        spellCheck={false}
        value={draft.text}
        onChange={(e) => onChange({ ...draft, text: e.target.value })}
      />
    </li>
  );
}

function SiftImportForm({ onImport }: { onImport(imported: SiftImport): void }) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const run = () => {
    const result = parseSiftImport(text);
    if ('error' in result) return setError(result.error);
    setError(null);
    setText('');
    onImport(result);
  };
  return (
    <details className="group-import">
      <summary>Import from Sift for GitHub</summary>
      <p className="muted">
        Sift has no export button. On Sift's options page, open the developer tools console and run{' '}
        <code>copy(JSON.stringify(await chrome.storage.sync.get('config')))</code>, then paste the result here (nothing
        copied means Sift still has its default tabs, which Glide's defaults match). Or paste tabs as text: a line with
        the tab's name in brackets, like <code>[Tests]</code>, then its patterns. Importing replaces the groups below, and
        Sift's tab to open on and its hide-empty switch replace the ones above.
      </p>
      <textarea className="group-patterns" aria-label="Sift settings to import" spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="options-actions">
        <button type="button" className="btn" onClick={run}>
          Import
        </button>
        {error && (
          <span className="group-error" role="alert">
            {error}
          </span>
        )}
      </div>
    </details>
  );
}

function PathProbe({ groups }: { groups: readonly FileGroup[] }) {
  const [path, setPath] = useState('');
  const compiled = useMemo(() => compileGroups(groups), [groups]);
  const held = path.trim() ? [...classify(compiled, path.trim())].map((i) => groups[i]!.label) : null;
  return (
    <div className="group-probe">
      <label className="field field-check">
        <span>Try a path</span>
        <input type="text" placeholder="services/users/test/create.test.js" value={path} onChange={(e) => setPath(e.target.value)} />
      </label>
      {held && <span data-testid="group-probe-result">→ {held.join(', ') || 'no group (only under All)'}</span>}
    </div>
  );
}

export function FileGroupSettingsForm({ settings, update }: { settings: FileGroupSettings; update: Update }) {
  const [draft, setDraft] = useState<DraftGroup[] | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  /** What storage holds, by draft id (renames and deletions of the default group follow from it). */
  const saved = useRef<DraftGroup[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** A valid edit waiting out SAVE_DELAY_MS; written at once if the page is closed or hidden first. */
  const pending = useRef<DraftGroup[] | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const commit = (next: DraftGroup[]) => {
    clearTimeout(timer.current);
    pending.current = null;
    const previous = saved.current;
    saveFileGroups(fromDraft(next)).then(
      () => {
        saved.current = next;
        setStatus({ kind: 'saved' });
        // The default group follows a rename, and All replaces it once it is deleted.
        const current = settingsRef.current.defaultGroup;
        const named = (d: DraftGroup) => d.label.trim().toLowerCase() === current.toLowerCase();
        const was = previous.find(named);
        if (current === ALL_GROUP || !was || next.some(named)) return;
        const now = next.find((d) => d.id === was.id);
        const label = now ? now.label.trim() : ALL_GROUP;
        if (label !== current) update({ fileGroups: { defaultGroup: label } });
      },
      (err: unknown) => setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) }),
    );
  };
  const commitRef = useRef(commit);
  commitRef.current = commit;

  useEffect(() => {
    const adopt = (groups: FileGroup[]) => {
      // Another context's change (or the echo of ours): take it unless this page has unsaved edits.
      setDraft((current) => {
        if (current && !sameGroups(fromDraft(current), fromDraft(saved.current))) return current;
        if (current && sameGroups(fromDraft(current), groups)) return current;
        const next = toDraft(groups);
        saved.current = next;
        return next;
      });
    };
    void loadFileGroups().then(adopt, () => adopt(defaultGroups()));
    const off = onFileGroupsChange(adopt);
    const flush = () => {
      if (pending.current) commitRef.current(pending.current);
    };
    const onHidden = () => document.visibilityState === 'hidden' && flush();
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      off();
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onHidden);
      flush();
    };
  }, []);

  const groups = useMemo(() => (draft ? fromDraft(draft) : []), [draft]);

  const save = (next: DraftGroup[]) => {
    clearTimeout(timer.current);
    pending.current = null;
    const problem = groupsProblem(fromDraft(next));
    if (problem) return setStatus({ kind: 'error', message: problem });
    setStatus({ kind: 'idle' });
    pending.current = next;
    timer.current = setTimeout(() => commit(next), SAVE_DELAY_MS);
  };

  const edit = (next: DraftGroup[]) => {
    setDraft(next);
    save(next);
  };

  const move = (i: number, by: -1 | 1) => {
    if (!draft) return;
    const next = [...draft];
    [next[i], next[i + by]] = [next[i + by]!, next[i]!];
    edit(next);
  };

  return (
    <div className="file-groups-settings">
      <div className="options-checks">
        <label className="options-check">
          <input type="checkbox" checked={settings.enabled} onChange={(e) => update({ fileGroups: { enabled: e.target.checked } })} />
          <span>
            <span className="options-check-label">Show file groups</span>
            <span className="options-check-description">
              Tabs in the toolbar that show one kind of file at a time in the tree and the diffs, each with its file
              count. All shows every file.
            </span>
          </span>
        </label>
        <label className="options-check" aria-disabled={!settings.enabled || undefined}>
          <input
            type="checkbox"
            checked={settings.hideEmpty}
            disabled={!settings.enabled}
            onChange={(e) => update({ fileGroups: { hideEmpty: e.target.checked } })}
          />
          <span>
            <span className="options-check-label">Hide groups with no files</span>
            <span className="options-check-description">All and the open group always show.</span>
          </span>
        </label>
      </div>
      <label className="field field-check group-default">
        <span>Open pull requests on</span>
        <select
          value={settings.defaultGroup}
          disabled={!settings.enabled}
          onChange={(e) => update({ fileGroups: { defaultGroup: e.target.value } })}
        >
          <option value={ALL_GROUP}>All</option>
          {groups
            .filter((g) => g.label)
            .map((g) => (
              <option key={g.label} value={g.label}>
                {g.label}
              </option>
            ))}
        </select>
      </label>
      <p className="muted">
        The group picked on a pull request is remembered for it across reloads; a pull request opened fresh starts on this
        one (or on All when this group has no files there).
      </p>

      <h3 className="group-heading">Groups</h3>
      <p className="muted">
        One pattern per line, in{' '}
        <a href="https://git-scm.com/docs/gitignore#_pattern_format" target="_blank" rel="noopener noreferrer">
          gitignore syntax
        </a>{' '}
        (case-insensitive); a later line overrides an earlier one. <code>*.md</code> matches a name at any depth,{' '}
        <code>docs/*.md</code> or <code>/build</code> is relative to the repository root, <code>test/</code> matches every
        file under a <code>test</code> folder, <code>**</code> spans folders and <code>#</code> starts a comment.{' '}
        <code>!*.md</code> drops matching files and <code>!Manifest</code> drops what the Manifest group holds. A group
        whose first line starts with <code>!</code> starts from every file. Two groups can exclude each other; a file both
        would hold then shows in neither.
      </p>
      {draft && (
        <>
          <ol className="group-list">
            {draft.map((d, i) => (
              <GroupEditor
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
            <button type="button" className="btn" onClick={() => edit([...draft, { id: nextId++, label: '', text: '' }])}>
              Add group
            </button>
            <button type="button" className="btn" onClick={() => edit(toDraft(defaultGroups()))}>
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
          <PathProbe groups={groups} />
          <SiftImportForm
            onImport={({ groups: imported, defaultGroup, hideEmpty }) => {
              edit(toDraft(imported));
              const patch = { ...(defaultGroup === undefined ? {} : { defaultGroup }), ...(hideEmpty === undefined ? {} : { hideEmpty }) };
              if (Object.keys(patch).length > 0) update({ fileGroups: patch });
            }}
          />
        </>
      )}
    </div>
  );
}
