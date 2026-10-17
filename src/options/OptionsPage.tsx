/** The extension's options page: tokens, display settings (shared with the viewer's Display menu) and a live sample. */
import { useEffect } from 'react';
import { BRAND } from '../shared/brand';
import { resolveDiffChoice, resolveFonts } from '../shared/github-defaults';
import { initSettings, useSettings } from '../viewer/state/settings';
import { DisplaySettingsForm } from '../viewer/ui/DisplaySettingsForm';
import { DisplayStyle } from '../viewer/ui/DisplayStyle';
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
      <h1>{BRAND.name}</h1>
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
    </main>
  );
}
