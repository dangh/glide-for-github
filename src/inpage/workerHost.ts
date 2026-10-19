/** Extension-origin workers and a read-only, authenticated recovery path for old per-PR session state. */
import { serveLegacyState } from './legacyState';

const legacyReady = serveLegacyState();
declare global {
  interface Window {
    __glideWorkerHost?: { spawned: number; initialized: number; renders: number; errors: number };
  }
}
const stats = window.__glideWorkerHost = { spawned: 0, initialized: 0, renders: 0, errors: 0 };
const workers = new Set<Worker>();
let connected = false;

window.addEventListener('message', (event: MessageEvent<unknown>) => {
  if (connected || event.source !== parent || event.origin !== 'https://github.com' || event.data !== 'glide:worker-host') return;
  const control = event.ports[0];
  if (!control) return;
  connected = true;
  control.onmessage = (request: MessageEvent<unknown>) => {
    if (request.data !== 'glide:spawn-worker') return;
    const port = request.ports[0];
    if (!port) return;
    let worker: Worker;
    try {
      worker = new Worker(chrome.runtime.getURL('pierre-worker.js'), { type: 'module' });
    } catch (error) {
      stats.errors++;
      port.postMessage({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
      return;
    }
    workers.add(worker);
    stats.spawned++;
    worker.onmessage = (response: MessageEvent<unknown>) => {
      const data = response.data;
      if (data && typeof data === 'object' && 'type' in data) {
        if (data.type === 'error') stats.errors++;
        else if ('requestType' in data) {
          if (data.requestType === 'initialize') stats.initialized++;
          if (data.requestType === 'diff' || data.requestType === 'file') stats.renders++;
        }
      }
      port.postMessage({ kind: 'message', data });
    };
    worker.onerror = (error) => {
      stats.errors++;
      port.postMessage({ kind: 'error', message: error.message || 'Glide highlighting worker failed' });
      error.preventDefault();
    };
    port.onmessage = (message: MessageEvent<unknown>) => {
      const data = message.data;
      if (!data || typeof data !== 'object' || !('kind' in data)) return;
      if (data.kind === 'post' && 'data' in data) worker.postMessage(data.data);
      if (data.kind === 'terminate') {
        worker.terminate();
        workers.delete(worker);
        port.close();
      }
    };
  };
  void legacyReady.then(() => control.postMessage('glide:workers-ready'));
});
window.addEventListener('pagehide', () => {
  for (const worker of workers) worker.terminate();
  workers.clear();
});
export {};
