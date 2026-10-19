/** The UI lives in an open shadow root; its inspection hooks live in Chrome's extension world. */
export const VIEWER_HOST = '#glide-inpage-spike';

const sessions = new WeakMap();
async function runtime(page) {
  let pending = sessions.get(page);
  if (!pending) {
    pending = (async () => {
      const client = await page.context().newCDPSession(page);
      const contexts = new Map();
      client.on('Runtime.executionContextCreated', ({ context }) => contexts.set(context.id, context.auxData ?? {}));
      client.on('Runtime.executionContextDestroyed', ({ executionContextId }) => contexts.delete(executionContextId));
      client.on('Runtime.executionContextsCleared', () => contexts.clear());
      await client.send('Runtime.enable');
      return { client, contexts };
    })();
    sessions.set(page, pending);
  }
  return pending;
}

/** Run an inspection in the content script's world, never GitHub's main world or the worker iframe. */
export async function evaluateInpage(page, fn, arg) {
  const { client, contexts } = await runtime(page);
  const { frameTree } = await client.send('Page.getFrameTree');
  for (const [contextId, context] of contexts) {
    if (context.frameId !== frameTree.frame.id || context.isDefault) continue;
    const probe = await client.send('Runtime.evaluate', {
      contextId, expression: '!!window.__pierre', returnByValue: true,
    }).catch(() => null);
    if (probe?.result.value !== true) continue;
    const result = await client.send('Runtime.evaluate', {
      contextId,
      expression: `(${fn.toString()})(${JSON.stringify(arg) ?? 'undefined'}, document.querySelector(${JSON.stringify(VIEWER_HOST)}).shadowRoot)`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    if (result.result.unserializableValue === '-0') return -0;
    if (result.result.unserializableValue === 'NaN') return NaN;
    if (result.result.unserializableValue === 'Infinity') return Infinity;
    if (result.result.unserializableValue === '-Infinity') return -Infinity;
    return result.result.value;
  }
  throw new Error('Glide content-script inspection context not found');
}

export async function waitForInpage(page, timeout = 60_000) {
  await page.locator(VIEWER_HOST).locator('.fh').first().waitFor({ state: 'visible', timeout });
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const ready = await evaluateInpage(page, () => !!window.__pierre?.store.getState().pr && !!window.__pierreStats?.doneAt).catch(() => false);
    if (ready) return;
    await page.waitForTimeout(100);
  }
  throw new Error('Glide did not finish loading');
}
