/** The options page's Experimental group (`DisplaySettings.experiments`; not in the viewer's Display menu). */
import type { ExperimentSettings } from '../shared/settings';
import type { Update } from '../viewer/ui/DisplaySettingsForm';

function Experiment({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description: string;
  value: boolean;
  onChange(v: boolean): void;
}) {
  return (
    <label className="options-check">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
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
        label="Merge GitHub's sticky header into Glide's toolbar"
        description="Hides GitHub's sticky pull request header while Glide is open; Glide's toolbar shows the title instead."
        value={experiments.mergedBar}
        onChange={(v) => set({ mergedBar: v })}
      />
    </div>
  );
}
