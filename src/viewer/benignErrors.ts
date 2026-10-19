/**
 * Chrome raises "ResizeObserver loop completed with undelivered notifications" when a resize observer's callback
 * changes the size of something observed in the same frame (the file group tabs' fit check, Pierre's virtualized
 * list). The notifications are only delivered a frame later and nothing is lost (the spec calls it benign), but
 * unhandled, it lands in chrome://extensions as an error of the extension. Marking it handled keeps it out.
 */
const BENIGN = new Set([
  'ResizeObserver loop completed with undelivered notifications.',
  'ResizeObserver loop limit exceeded',
]);

export function ignoreBenignErrors(win: Window): void {
  win.addEventListener('error', (event) => {
    if (BENIGN.has(event.message)) event.preventDefault();
  });
}
