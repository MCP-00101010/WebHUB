import assert from 'node:assert/strict';

const port = Number(process.argv[2] || 9223);
const targetUrl = 'file:///F:/Projects/Coding/Morpheus%20WebHub/index.html';
const socket = new WebSocket(`ws://127.0.0.1:${port}/session`);
const pending = new Map();
let sequence = 0;

socket.addEventListener('message', event => {
  const message = JSON.parse(String(event.data));
  if (!message.id || !pending.has(message.id)) return;
  const request = pending.get(message.id);
  pending.delete(message.id);
  if (message.type === 'success') request.resolve(message.result);
  else request.reject(new Error(message.message || JSON.stringify(message)));
});

await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', () => reject(new Error(`Could not connect to Firefox BiDi on port ${port}`)), { once: true });
});

function command(method, params = {}) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

await command('session.new', { capabilities: { alwaysMatch: {} } });

let hubContext = null;
let snapshot = null;
let reloadedAfterExtensionInstall = false;
const deadline = Date.now() + 10000;
while (Date.now() < deadline) {
  const tree = await command('browsingContext.getTree');
  const contexts = [...(tree.contexts || [])];
  while (contexts.length) {
    const candidate = contexts.shift();
    if (candidate.url?.startsWith(targetUrl)) hubContext = candidate.context;
    contexts.push(...(candidate.children || []));
  }
  if (hubContext) {
    if (!reloadedAfterExtensionInstall) {
      await command('browsingContext.navigate', {
        context: hubContext,
        url: targetUrl,
        wait: 'complete'
      });
      reloadedAfterExtensionInstall = true;
    }
    const evaluated = await command('script.evaluate', {
      expression: `JSON.stringify({
        relay: document.documentElement.dataset.morpheusExtensionRelay || '',
        relayError: document.documentElement.dataset.morpheusExtensionError || '',
        marker: !!document.querySelector('meta[name="morpheus-webhub"]'),
        readyState: document.readyState,
        userAgent: navigator.userAgent,
        bridgeAvailable: typeof bridge === 'object' && bridge.isAvailable(),
        version: document.getElementById('aboutVersionLine')?.textContent || '',
        booting: document.documentElement.classList.contains('hub-booting'),
        boardCount: typeof state === 'object' && Array.isArray(state.boards) ? state.boards.length : -1,
        hubName: typeof state === 'object' ? state.hubName : ''
      })`,
      target: { context: hubContext },
      awaitPromise: true,
      resultOwnership: 'none'
    });
    if (evaluated.result?.type === 'string') snapshot = JSON.parse(evaluated.result.value);
    if (snapshot?.relay === 'background-ready' && snapshot.boardCount > 0 && !snapshot.booting) break;
  }
  await new Promise(resolve => setTimeout(resolve, 250));
}

await command('session.end').catch(() => {});
socket.close();

assert.ok(hubContext, 'The exact Hub file URL was not open in Firefox');
assert.equal(snapshot?.relay, 'background-ready', snapshot?.relayError || `The extension relay did not register: ${JSON.stringify(snapshot)}`);
assert.equal(snapshot?.booting, false, 'The Hub remained behind its protected startup screen');
assert.ok(snapshot?.boardCount > 0, 'The shared database did not populate any boards');
console.log(JSON.stringify(snapshot));
