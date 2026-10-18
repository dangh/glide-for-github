/**
 * Display menu: the shared settings form (DisplaySettingsForm) in a popover under a gear button, like GitHub's diff
 * view settings. Changes apply without reload and persist to `chrome.storage.sync` through the viewer's settings store.
 */
import { memo } from 'react';
import { filesChangedUrl } from '../../shared/pr-url';
import { useSettings } from '../state/settings';
import { usePr } from '../state/store';
import { DisplaySettingsForm } from './DisplaySettingsForm';
import { GearIcon } from './icons';
import { Popover } from './Popover';

/** While Glide replaces Files changed, the way to GitHub's own page, for what only GitHub's page does. */
const GithubFilesLink = memo(function GithubFilesLink() {
  const replaced = useSettings((s) => s.settings.github.replaceFilesTab);
  const ref = usePr((s) => s.pr?.ref);
  if (!replaced || !ref) return null;
  return (
    <p className="display-menu-footer">
      <a className="fh-link" href={filesChangedUrl(ref)} target="_top">
        Open GitHub's Files changed
      </a>
    </p>
  );
});

export const DisplayMenu = memo(function DisplayMenu() {
  const settings = useSettings((s) => s.settings);
  const update = useSettings((s) => s.update);
  return (
    <Popover label={<GearIcon />} title="Display options" testId="display-menu" className="display-menu">
      {() => (
        <>
          <DisplaySettingsForm settings={settings} update={update} />
          <GithubFilesLink />
        </>
      )}
    </Popover>
  );
});
