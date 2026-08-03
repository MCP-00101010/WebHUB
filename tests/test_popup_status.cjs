const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function makeElement() {
  const classes = new Set(['hidden']);
  const element = {
    textContent: '',
    className: '',
    disabled: true,
    value: '',
    children: [],
    listeners: {},
    classList: {
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      toggle: (name, force) => force ? classes.add(name) : classes.delete(name),
      contains: name => classes.has(name)
    },
    addEventListener(type, listener) { this.listeners[type] = listener; },
    appendChild(child) {
      this.children.push(child);
      if (!this.value && child.value) this.value = child.value;
      return child;
    }
  };
  Object.defineProperty(element, 'innerHTML', {
    get() { return ''; },
    set() { element.children = []; element.value = ''; }
  });
  return element;
}

test('popup enables delivery actions when a later status refresh finds the hub', async () => {
  const elementIds = [
    'statusMorpheus', 'statusNative', 'statusPath', 'statusDetail',
    'tabInfo', 'tabTitle', 'tabUrl', 'targetPicker', 'targetBoard', 'targetTab',
    'sendBtn', 'sendToTabBtn', 'importBtn', 'feedback'
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
  const runtimeMessages = [];
  let relayReady = false;
  const context = vm.createContext({
    console,
    URL,
    document: { getElementById: id => elements[id], createElement: () => makeElement() },
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
          runtimeMessages.push(message);
          if (message.type === 'MW_GET_INBOX_TARGETS') return {
            ok: true,
            activeBoardId: 'board-1',
            activeTabId: 'tab-1',
            boards: [
              { id: 'board-1', title: 'Board One', tabs: [{ id: 'tab-1', title: 'Tab One' }] },
              { id: 'board-2', title: 'Board Two', tabs: [{ id: 'tab-2', title: 'Tab Two' }] }
            ]
          };
          if (message.type !== 'MW_GET_STATUS') return { ok: true };
          return statuses[Math.min(statusIndex++, statuses.length - 1)];
        },
        getManifest: () => ({ version: '1.0.20' })
      },
      storage: {
        local: {
          get: async () => ({ morpheusPopupTarget: { boardId: 'board-2', tabId: 'tab-2' } }),
          set: async () => {}
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
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(elements.sendBtn.disabled, false);
  assert.equal(elements.sendToTabBtn.disabled, false);
  assert.equal(elements.importBtn.disabled, false);
  assert.equal(elements.targetBoard.value, 'board-2');
  assert.equal(elements.targetTab.value, 'tab-2');

  await elements.sendToTabBtn.listeners.click();
  await new Promise(resolve => setImmediate(resolve));
  const targetedSend = runtimeMessages.findLast(message => message.type === 'MW_SEND_TAB');
  assert.equal(targetedSend.targetBoardId, 'board-2');
  assert.equal(targetedSend.targetTabId, 'tab-2');

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
