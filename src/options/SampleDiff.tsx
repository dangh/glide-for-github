/** Live preview: a built-in before/after rendered by Pierre's CodeView with the current display settings. */
import { CodeView } from '@pierre/diffs/react';
import { useMemo } from 'react';
import { filePaddingBottom, resolveDiffChoice } from '../shared/github-defaults';
import { DEFAULT_SETTINGS, toDiffOptions, type DiffSettings } from '../shared/settings';
import { buildSampleDiff, SAMPLE_FILE_NAME } from './sample';

export function SampleDiff({ diff, lineHeight }: { diff: DiffSettings; lineHeight: number }) {
  // `diff` keeps its identity while unrelated settings change (see reconcileSettings), so only diff edits re-option the view.
  // `lineHeight` matches `--diffs-line-height` for the code font size (see state/view.ts itemMetricsFor); the
  // sample keeps Pierre's own file header, so only the row height and the space under the file (DIFF_CSS) are set.
  const options = useMemo(
    () => ({
      ...toDiffOptions<undefined, undefined>({ ...DEFAULT_SETTINGS, diff }),
      itemMetrics: { lineHeight, paddingBottom: filePaddingBottom(resolveDiffChoice('overflow', diff.overflow)) },
    }),
    [diff, lineHeight],
  );
  const items = useMemo(() => [{ id: SAMPLE_FILE_NAME, type: 'diff' as const, fileDiff: buildSampleDiff(), version: 1 }], []);
  return (
    <div className="sample-diff" data-testid="sample-diff">
      <CodeView<undefined, undefined> className="sample-diff-view" items={items} options={options} />
    </div>
  );
}
