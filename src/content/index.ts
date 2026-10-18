import { storedLayout } from './layout-source';
import { createLifecycle } from './lifecycle';

const lifecycle = createLifecycle(window, storedLayout());

if (document.body) lifecycle.start();
else document.addEventListener('DOMContentLoaded', () => lifecycle.start(), { once: true });
