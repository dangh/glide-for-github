import { createLifecycle } from './lifecycle';

const lifecycle = createLifecycle();

if (document.body) lifecycle.start();
else document.addEventListener('DOMContentLoaded', () => lifecycle.start(), { once: true });
