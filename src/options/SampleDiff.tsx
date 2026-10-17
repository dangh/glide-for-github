/** Live preview: a built-in before/after rendered by Pierre's CodeView with the current display settings. */
import { CodeView } from '@pierre/diffs/react';
import { useMemo } from 'react';
import { DEFAULT_SETTINGS, toDiffOptions, type DiffSettings } from '../shared/settings';
import { buildSampleDiff, SAMPLE_FILE_NAME } from './sample';

export function SampleDiff({ diff }: { diff: DiffSettings }) {
  // `diff` keeps its identity while unrelated settings change (see reconcileSettings), so only diff edits re-option the view.
  const options = useMemo(() => toDiffOptions<undefined, undefined>({ ...DEFAULT_SETTINGS, diff }), [diff]);
  const items = useMemo(() => [{ id: SAMPLE_FILE_NAME, type: 'diff' as const, fileDiff: buildSampleDiff(), version: 1 }], []);
  return (
    <div className="sample-diff" data-testid="sample-diff">
      <CodeView<undefined, undefined> className="sample-diff-view" items={items} options={options} />
    </div>
  );
}
