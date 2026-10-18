/** The options page's GitHub group (`DisplaySettings.github`; not in the viewer's Display menu). */
import type { GithubSettings } from '../shared/settings';
import type { Update } from '../viewer/ui/DisplaySettingsForm';

export function GithubSettingsForm({ github, update }: { github: GithubSettings; update: Update }) {
  return (
    <div className="options-checks">
      <label className="options-check">
        <input
          type="checkbox"
          checked={github.replaceFilesTab}
          onChange={(e) => update({ github: { replaceFilesTab: e.target.checked } })}
        />
        <span>
          <span className="options-check-label">Replace Files changed with Glide</span>
          <span className="options-check-description">
            Hides GitHub's Files changed tab and opens Glide wherever it would open; Glide's Display menu still links to
            GitHub's page.
          </span>
        </span>
      </label>
    </div>
  );
}
