import { createLifecycle } from './lifecycle';
import { storedSettings } from './settings-source';

const lifecycle = createLifecycle(window, storedSettings());

if (document.body) lifecycle.start();
else document.addEventListener('DOMContentLoaded', () => lifecycle.start(), { once: true });
