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
import { FileGroupSettingsForm } from './FileGroupSettings';
import { GithubSettingsForm } from './GithubSettings';
import { RelatedFilesSettingsForm } from './RelatedFilesSettings';
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
      <div className="options-layout">
        <nav className="options-nav" aria-label="Settings sections">
          <h2>Settings</h2>
          <a href="#tokens-heading">GitHub tokens</a>
          <a href="#display-heading">Display</a>
          <a href="#github-heading">GitHub</a>
          <a href="#file-groups-heading">File groups</a>
          <a href="#related-files-heading">Related files</a>
          <a href="#experiments-heading">Experimental</a>
        </nav>
        <div className="options-content">
          <TokenSettings />
          <section className="options-section" aria-labelledby="display-heading">
            <h2 id="display-heading">Display</h2>
            <p className="muted">Changes apply at once, also in pull requests that are already open.</p>
            {loaded && (
              <div className="options-display">
                <DisplaySettingsForm settings={settings} update={update} relatedFiles={false} />
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
          <section className="options-section" aria-labelledby="file-groups-heading">
            <h2 id="file-groups-heading">File groups</h2>
            <p className="muted">
              Changes apply at once, also in pull requests that are already open. The groups come from{' '}
              <a href="https://github.com/dangh/sift-for-github" target="_blank" rel="noopener noreferrer">
                Sift for GitHub
              </a>
              .
            </p>
            {loaded && <FileGroupSettingsForm settings={settings.fileGroups} update={update} />}
          </section>
          <section className="options-section" aria-labelledby="related-files-heading">
            <h2 id="related-files-heading">Related files</h2>
            <p className="muted">
              Show a file with its companions, like a lock file with its manifest, so they read as one change. Changes apply at
              once, also in pull requests that are already open.
            </p>
            {loaded && <RelatedFilesSettingsForm style={settings.relatedFiles.style} update={update} />}
          </section>
          <section className="options-section" aria-labelledby="experiments-heading">
            <h2 id="experiments-heading">Experimental</h2>
            <p className="muted">Changes apply at once; an open Glide tab reloads its viewer to switch.</p>
            {loaded && <ExperimentSettingsForm experiments={settings.experiments} update={update} />}
          </section>
        </div>
      </div>
    </main>
  );
}
