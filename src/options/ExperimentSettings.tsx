/** The options page's Experimental group (`DisplaySettings.experiments`; not in the viewer's Display menu). */
import type { ExperimentSettings } from '../shared/settings';
import type { Update } from '../viewer/ui/DisplaySettingsForm';

function Experiment({
  label,
  description,
  value,
  disabled = false,
  onChange,
}: {
  label: string;
  description: string;
  value: boolean;
  disabled?: boolean;
  onChange(v: boolean): void;
}) {
  return (
    <label className="options-check" aria-disabled={disabled || undefined}>
      <input type="checkbox" checked={value} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="options-check-label">{label}</span>
        <span className="options-check-description">{description}</span>
      </span>
    </label>
  );
}

export function ExperimentSettingsForm({ experiments, update }: { experiments: ExperimentSettings; update: Update }) {
  const set = (patch: Partial<ExperimentSettings>) => update({ experiments: patch });
  return (
    <div className="options-checks">
      <Experiment
        label="Scroll with the page"
        description="GitHub's page scrolls the diffs, so its header scrolls away and the footer is reachable, like GitHub's own Files changed page."
        value={experiments.pageScroll}
        onChange={(v) => set({ pageScroll: v })}
      />
      <Experiment
        label="Merge GitHub's sticky header into Glide's toolbar"
        description={
          experiments.pageScroll
            ? "Hides GitHub's sticky pull request header while Glide is open; Glide's toolbar shows the title instead."
            : 'Needs "Scroll with the page".'
        }
        value={experiments.mergedBar}
        disabled={!experiments.pageScroll}
        onChange={(v) => set({ mergedBar: v })}
      />
    </div>
  );
}
