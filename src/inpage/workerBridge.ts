/** Worker-compatible ports keep highlighting in the extension origin, outside GitHub's worker restrictions. */
class PortWorker extends EventTarget implements Worker {
  declare addEventListener: Worker['addEventListener'];
  declare removeEventListener: Worker['removeEventListener'];
  onmessage: Worker['onmessage'] = null;
  onmessageerror: Worker['onmessageerror'] = null;
  onerror: Worker['onerror'] = null;
  private closed = false;

  constructor(private readonly port: MessagePort) {
    super();
    port.onmessage = (event: MessageEvent<unknown>) => {
      const message = event.data;
      if (!message || typeof message !== 'object' || !('kind' in message)) return;
      if (message.kind === 'message' && 'data' in message) {
        const forwarded = new MessageEvent('message', { data: message.data });
        this.dispatchEvent(forwarded);
        this.onmessage?.call(this, forwarded);
      } else if (message.kind === 'error' && 'message' in message && typeof message.message === 'string') {
        const error = new ErrorEvent('error', { message: message.message, cancelable: true });
        this.dispatchEvent(error);
        this.onerror?.call(this, error);
      }
    };
    port.onmessageerror = () => {
      const event = new MessageEvent('messageerror');
      this.dispatchEvent(event);
      this.onmessageerror?.call(this, event);
    };
  }

  postMessage(message: unknown, options?: Transferable[] | StructuredSerializeOptions): void {
    if (this.closed) return;
    if (Array.isArray(options)) this.port.postMessage({ kind: 'post', data: message }, options);
    else this.port.postMessage({ kind: 'post', data: message }, options);
  }

  terminate(): void {
    if (this.closed) return;
    this.closed = true;
    this.port.postMessage({ kind: 'terminate' });
    this.port.close();
  }
}

export function createWorkerBridge(doc: Document) {
  const frame = doc.createElement('iframe');
  frame.dataset.glideWorkerHost = '';
  frame.hidden = true;
  frame.setAttribute('aria-hidden', 'true');
  frame.title = 'Glide highlighting workers';
  frame.src = chrome.runtime.getURL('worker-host.html');
  const origin = new URL(frame.src).origin;
  const channel = new MessageChannel();
  const workers = new Set<PortWorker>();
  let rejectReady: (error: Error) => void = () => undefined;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout>;

  const ready = new Promise<() => Worker>((resolve, reject) => {
    rejectReady = reject;
    channel.port1.onmessage = (event: MessageEvent<unknown>) => {
      if (event.data !== 'glide:workers-ready' || disposed) return;
      clearTimeout(timer);
      resolve(() => {
        if (disposed) throw new Error('Glide highlighting host is closed');
        const workerChannel = new MessageChannel();
        const worker = new PortWorker(workerChannel.port1);
        workers.add(worker);
        channel.port1.postMessage('glide:spawn-worker', [workerChannel.port2]);
        return worker;
      });
    };
    frame.addEventListener('load', () => {
      frame.contentWindow?.postMessage('glide:worker-host', origin, [channel.port2]);
    }, { once: true });
    frame.addEventListener('error', () => reject(new Error('Glide highlighting host failed to load')), { once: true });
    timer = setTimeout(() => reject(new Error('Glide highlighting host did not respond')), 10_000);
  });
  doc.body.append(frame);

  return {
    ready,
    isConnected: () => frame.isConnected,
    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimeout(timer);
      rejectReady(new Error('Glide highlighting host closed'));
      for (const worker of workers) worker.terminate();
      workers.clear();
      channel.port1.close();
      channel.port2.close();
      frame.remove();
    },
  };
}
