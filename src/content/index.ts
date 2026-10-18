import { githubSettingsOf } from '../shared/github-settings';
import { storedLayout } from './layout-source';
import { createLifecycle } from './lifecycle';
import { storedSetting } from './setting-source';

const lifecycle = createLifecycle(window, storedLayout(), storedSetting((item) => githubSettingsOf(item).replaceFilesTab));

if (document.body) lifecycle.start();
else document.addEventListener('DOMContentLoaded', () => lifecycle.start(), { once: true });
