/** The extension's options page: tokens, display settings (shared with the viewer's Display menu) and a live sample. */
import { useEffect } from 'react';
import { BRAND } from '../shared/brand';

/** The installed version, from the manifest (absent outside the extension, e.g. in unit tests). */
const VERSION = globalThis.chrome?.runtime?.getManifest?.().version;
import { resolveDiffChoice, resolveFonts } from '../shared/github-defaults';
import { initSettings, useSettings } from '../viewer/state/settings';
import { DisplaySettingsForm } from '../viewer/ui/DisplaySettingsForm';
import { DisplayStyle } from '../viewer/ui/DisplayStyle';
import { ExperimentSettingsForm } from './ExperimentSettings';
import { GithubSettingsForm } from './GithubSettings';
import { SampleDiff } from './SampleDiff';
import { TokenSettings } from './TokenSettings';

export function OptionsPage() {
  const settings = useSettings((s) => s.settings);
  const loaded = useSettings((s) => s.loaded);
  const update = useSettings((s) => s.update);
  const themeType = resolveDiffChoice('themeType', settings.diff.themeType);

  useEffect(() => initSettings(), []);
  useEffect(() => {
    document.title = `${BRAND.name} options`;
  }, []);
  useEffect(() => {
    document.documentElement.style.colorScheme = themeType === 'system' ? 'light dark' : themeType;
  }, [themeType]);

  return (
    <main className="options">
      <DisplayStyle />
      <header className="options-header">
        <img className="options-icon" src="icons/icon.svg" width={40} height={40} alt="" />
        <div className="options-title">
          <h1>{BRAND.name}</h1>
          {VERSION && (
            <a
              className="options-version"
              href={`https://github.com/dangh/glide-for-github/releases/tag/v${VERSION}`}
              target="_blank"
              rel="noopener noreferrer"
              title="Release notes"
            >
              v{VERSION}
            </a>
          )}
        </div>
      </header>
      <TokenSettings />
      <section className="options-section" aria-labelledby="display-heading">
        <h2 id="display-heading">Display</h2>
        <p className="muted">Changes apply at once, also in pull requests that are already open.</p>
        {loaded && (
          <div className="options-display">
            <DisplaySettingsForm settings={settings} update={update} />
            <div className="options-sample">
              <h3>Preview</h3>
              <SampleDiff diff={settings.diff} lineHeight={resolveFonts(settings.fonts).codeLineHeight} />
            </div>
          </div>
        )}
      </section>
      <section className="options-section" aria-labelledby="github-heading">
        <h2 id="github-heading">GitHub</h2>
        <p className="muted">Changes apply at once, also in pull requests that are already open.</p>
        {loaded && <GithubSettingsForm github={settings.github} update={update} />}
      </section>
      <section className="options-section" aria-labelledby="experiments-heading">
        <h2 id="experiments-heading">Experimental</h2>
        <p className="muted">Changes apply at once; an open Glide tab reloads its viewer to switch.</p>
        {loaded && <ExperimentSettingsForm experiments={settings.experiments} update={update} />}
      </section>
    </main>
  );
}
