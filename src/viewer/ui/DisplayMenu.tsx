/**
 * Display menu: the shared settings form (DisplaySettingsForm) in a popover. Changes apply without reload and
 * persist to `chrome.storage.sync` through the viewer's settings store.
 */
import { memo } from 'react';
import { useSettings } from '../state/settings';
import { DisplaySettingsForm } from './DisplaySettingsForm';
import { Popover } from './Popover';

export const DisplayMenu = memo(function DisplayMenu() {
  const settings = useSettings((s) => s.settings);
  const update = useSettings((s) => s.update);
  return (
    <Popover label="⚙ Display" title="Display options" testId="display-menu" className="display-menu">
      {() => <DisplaySettingsForm settings={settings} update={update} />}
    </Popover>
  );
});
