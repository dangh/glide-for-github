/** Renew the bridge channel when the MAIN-world script starts after the content script. */
export function connectBridge(win: Window) {
  const connect = () => {
    const channel = new MessageChannel();
    win.postMessage({ type: 'pierre:bridge-reset' }, win.location.origin);
    win.postMessage({ type: 'pierre:bridge-port' }, win.location.origin, [channel.port2]);
    win.postMessage({ type: 'pierre:port', colorMode: win.document.documentElement.getAttribute('data-color-mode') }, win.location.origin, [channel.port1]);
  };
  const onReady = (event: MessageEvent) => {
    if (event.source === win && event.origin === win.location.origin && event.data?.type === 'pierre:bridge-ready') connect();
  };
  win.addEventListener('message', onReady);
  connect();
  return () => {
    win.removeEventListener('message', onReady);
    win.postMessage({ type: 'pierre:bridge-reset' }, win.location.origin);
  };
}
