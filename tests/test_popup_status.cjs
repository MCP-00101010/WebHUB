const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function makeElement() {
  const classes = new Set(['hidden']);
  return {
    textContent: '',
    className: '',
    disabled: true,
    listeners: {},
    classList: {
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      toggle: (name, force) => force ? classes.add(name) : classes.delete(name),
      contains: name => classes.has(name)
    },
    addEventListener(type, listener) { this.listeners[type] = listener; }
  };
}

test('popup enables delivery actions when a later status refresh finds the hub', async () => {
  const elementIds = [
    'statusMorpheus', 'statusNative', 'statusPath', 'statusDetail',
    'tabInfo', 'tabTitle', 'tabUrl', 'sendBtn', 'importBtn', 'feedback'
  ];
  const elements = Object.fromEntries(elementIds.map(id => [id, makeElement()]));
  const statuses = [
    { ok: true, morpheusOpen: false, nativeAvailable: false, storageInfoReady: false },
    { ok: true, morpheusOpen: true, nativeAvailable: false, storageInfoReady: false },
    { ok: true, morpheusOpen: true, nativeAvailable: true, storageInfoReady: true, databasePath: 'C:\\hub.json' }
  ];
  let statusIndex = 0;
  let intervalCallback = null;
  const injectedTabs = [];
  let relayReady = false;
  const context = vm.createContext({
    console,
    URL,
    document: { getElementById: id => elements[id] },
    window: {
      addEventListener: () => {},
      close: () => {}
    },
    browser: {
      tabs: {
        query: async () => [{ id: 7, url: 'https://example.com', title: 'Example' }],
        sendMessage: async (_tabId, message) => message.type === 'MW_DISCOVER' && relayReady
          ? { ok: true, isMorpheus: true }
          : null,
        executeScript: async (tabId, details) => {
          injectedTabs.push({ tabId, details });
          relayReady = true;
        }
      },
      runtime: {
        id: 'test-extension',
        sendMessage: async message => {
          if (message.type !== 'MW_GET_STATUS') return { ok: true };
          return statuses[Math.min(statusIndex++, statuses.length - 1)];
        }
      }
    },
    setInterval: callback => { intervalCallback = callback; return 1; },
    clearInterval: () => {},
    setTimeout,
    clearTimeout
  });
  const filename = path.join(__dirname, '..', 'extension', 'popup', 'popup.js');
  vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(elements.sendBtn.disabled, true);
  assert.equal(elements.importBtn.disabled, true);
  assert.equal(typeof intervalCallback, 'function');

  await intervalCallback();
  assert.equal(elements.sendBtn.disabled, false);
  assert.equal(elements.importBtn.disabled, false);

  await intervalCallback();
  assert.match(elements.statusNative.textContent, /enabled/);

  const relay = await context.ensureActiveHubRelay({ id: 42, url: 'file:///F:/hub/index.html' });
  assert.equal(relay.ready, true);
  assert.deepEqual(JSON.parse(JSON.stringify(injectedTabs)), [{
    tabId: 42,
    details: { runAt: 'document_idle', file: '/content.js' }
  }]);
});

test('popup includes the Firefox local-file permission instruction', () => {
  const popup = fs.readFileSync(path.join(__dirname, '..', 'extension', 'popup', 'popup.js'), 'utf8');
  assert.match(popup, /Access local files on your computer/);
  assert.match(popup, /about:addons/);
});
