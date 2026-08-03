const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

async function loadBackground(options = {}) {
  const listeners = {};
  const nativeWrites = [];
  const pendingWrites = [];
  const sentTabs = [];
  const nativeConnections = [];
  const executedScripts = [];
  const injectedTabs = new Set();
  const browser = {
    runtime: {
      id: 'test-extension',
      getBrowserInfo: options.browserVersion ? async () => ({ version: options.browserVersion }) : undefined,
      sendNativeMessage: async (_host, message) => {
        if (message.type === 'PING') return options.nativePing?.promise || { ok: true };
        if (message.type === 'READ_CONFIG') return { ok: true, config: { databasePath: 'C:\\hub.json' } };
        if (message.type === 'READ_FILE_CHUNK') {
          if (options.nativeReadError) throw new Error(options.nativeReadError);
          return {
            ok: true,
            chunk: Buffer.from(options.nativeState || '{}').toString('base64'),
            nextOffset: Buffer.byteLength(options.nativeState || '{}'),
            totalSize: Buffer.byteLength(options.nativeState || '{}'),
            done: true,
            fileInfo: { exists: true, version: 'v1', contentHash: 'h1' }
          };
        }
        if (message.type === 'WRITE_FILE_IF_UNCHANGED') {
          nativeWrites.push(message);
          const pending = deferred();
          pendingWrites.push(pending);
          return pending.promise;
        }
        return { ok: true };
      },
      sendMessage: async () => ({ ok: true }),
      onMessage: { addListener: listener => { listeners.message = listener; } }
    },
    extension: {
      isAllowedFileSchemeAccess: async () => options.fileSchemeAccess !== false
    },
    storage: {
      local: {
        get: async () => options.localStorageState ? { morpheusState: options.localStorageState } : {},
        set: async () => {},
        remove: async () => {}
      }
    },
    tabs: {
      query: async () => options.tabs || [],
      executeScript: async (tabId, details) => {
        executedScripts.push({ tabId, details });
        if (details?.file) {
          injectedTabs.add(tabId);
          return [true];
        }
        return options.hubTabIds?.includes(tabId)
          ? [{ isHub: true, relayState: options.relayPresent ? 'background-ready' : '' }]
          : [{ isHub: false, relayState: '' }];
      },
      sendMessage: async (tabId, message) => {
        sentTabs.push({ tabId, message });
        if (message.type === 'MW_DISCOVER') {
          const tab = (options.tabs || []).find(candidate => candidate.id === tabId);
          return options.hubTabIds?.includes(tabId) && (options.relayPresent || injectedTabs.has(tabId))
            ? { ok: true, isMorpheus: true, pageUrl: tab?.url || '' }
            : null;
        }
        return { ok: true, persisted: 'shared' };
      },
      onRemoved: { addListener: listener => { listeners.removed = listener; } },
      onUpdated: { addListener: listener => { listeners.updated = listener; } },
      onActivated: { addListener: listener => { listeners.activated = listener; } }
    },
    bookmarks: { getSubTree: async () => [] },
    menus: {
      create: () => {},
      remove: async () => {},
      onClicked: { addListener: () => {} }
    }
  };
  if (options.usePersistentNative) {
    browser.runtime.connectNative = () => {
      const messageListeners = [];
      const disconnectListeners = [];
      const connection = {
        messages: [],
        onMessage: { addListener: listener => messageListeners.push(listener) },
        onDisconnect: { addListener: listener => disconnectListeners.push(listener) },
        disconnect() {
          disconnectListeners.forEach(listener => listener());
        },
        postMessage(message) {
          connection.messages.push(message);
          setImmediate(() => {
            if (message.type === 'PING') messageListeners.forEach(listener => listener({ ok: true }));
            else if (message.type === 'READ_CONFIG') {
              messageListeners.forEach(listener => listener({ ok: true, config: { databasePath: 'C:\\hub.json' } }));
            } else if (message.type === 'READ_FILE_CHUNK') {
              const content = options.nativeState || '{}';
              messageListeners.forEach(listener => listener({
                ok: true,
                chunk: Buffer.from(content).toString('base64'),
                nextOffset: Buffer.byteLength(content),
                totalSize: Buffer.byteLength(content),
                done: true,
                fileInfo: { exists: true, version: 'v1', contentHash: 'h1' }
              }));
            }
          });
        }
      };
      nativeConnections.push(connection);
      return connection;
    };
  }
  const context = vm.createContext({
    browser,
    console,
    URL,
    TextDecoder,
    Uint8Array,
    atob: value => Buffer.from(value, 'base64').toString('binary'),
    crypto: require('node:crypto').webcrypto,
    setTimeout,
    clearTimeout
  });
  const filename = path.join(__dirname, '..', 'extension', 'background.js');
  vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  await new Promise(resolve => setImmediate(resolve));
  return { context, listeners, nativeWrites, pendingWrites, sentTabs, nativeConnections, executedScripts };
}

test('native save FIFO keeps requests and responses correlated', async () => {
  const harness = await loadBackground();
  const first = harness.context.scheduleNativeSave('first', 'v1', 'h1');
  const second = harness.context.scheduleNativeSave('second', 'v1', 'h1');

  await new Promise(resolve => setImmediate(resolve));
  assert.equal(harness.nativeWrites.length, 1);
  assert.equal(harness.nativeWrites[0].content, 'first');

  harness.pendingWrites[0].resolve({ ok: true, fileInfo: { version: 'v2' } });
  assert.equal((await first).fileInfo.version, 'v2');
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(harness.nativeWrites.length, 2);
  assert.equal(harness.nativeWrites[1].content, 'second');
  harness.pendingWrites[1].resolve({ ok: true, conflict: true, fileInfo: { version: 'v3' } });
  assert.equal((await second).conflict, true);
});

test('the most recently registered hub receives deliveries', async () => {
  const harness = await loadBackground();
  const register = (tabId, active) => new Promise(resolve => {
    harness.listeners.message(
      { type: 'MW_REGISTER', pageUrl: `file:///hub-${tabId}.html`, active },
      { tab: { id: tabId, url: `file:///hub-${tabId}.html` } },
      resolve
    );
  });
  await register(10, true);
  await register(20, false);

  await new Promise(resolve => {
    harness.listeners.message(
      { type: 'MW_SEND_TAB', url: 'https://example.com', title: 'Example' },
      {},
      response => {
        assert.equal(response.ok, true);
        resolve();
      }
    );
  });

  assert.equal(harness.sentTabs.at(-1).tabId, 20);
});

test('extension handshake responds before native host startup completes', async () => {
  const nativePing = deferred();
  const harness = await loadBackground({ nativePing });
  let response = null;
  harness.listeners.message(
    { type: 'MW_PING', morpheusPage: true, pageUrl: 'file:///hub.html' },
    { tab: { id: 10, url: 'file:///hub.html' } },
    result => { response = result; }
  );

  assert.equal(response?.ok, true);
  assert.equal(response?.nativeAvailable, false);

  const status = await new Promise(resolve => {
    harness.listeners.message({ type: 'MW_GET_STATUS' }, {}, resolve);
  });
  assert.equal(status.morpheusOpen, true);
  assert.equal(status.storageInfoReady, false);
  nativePing.resolve({ ok: true });
});

test('status discovers an unregistered file hub and injects the root extension relay', async () => {
  const harness = await loadBackground({
    tabs: [{ id: 42, url: 'file:///F:/Projects/Coding/Morpheus%20WebHub/index.html', active: true }],
    hubTabIds: [42],
    relayPresent: false
  });

  const status = await new Promise(resolve => {
    harness.listeners.message({ type: 'MW_GET_STATUS' }, {}, resolve);
  });

  assert.equal(status.morpheusOpen, true);
  assert.deepEqual(JSON.parse(JSON.stringify(harness.executedScripts)), [{
    tabId: 42,
    details: { runAt: 'document_idle', file: '/content.js' }
  }]);
});

test('Firefox 153 reports its new disabled local-file permission instead of a generic relay failure', async () => {
  const harness = await loadBackground({
    browserVersion: '153.0',
    fileSchemeAccess: false,
    tabs: [{ id: 43, url: 'file:///F:/hub/index.html', active: true }],
    hubTabIds: [43]
  });
  const status = await new Promise(resolve => {
    harness.listeners.message({ type: 'MW_GET_STATUS' }, {}, resolve);
  });

  assert.equal(status.morpheusOpen, false);
  assert.equal(status.fileSchemeAccessRequired, true);
  assert.equal(status.fileSchemeAccess, false);
  assert.match(status.hubRelayError, /Access local files on your computer/);
  assert.equal(harness.executedScripts.length, 0);
});

test('configured shared read failure never substitutes extension-local state', async () => {
  const harness = await loadBackground({
    nativeReadError: 'disk temporarily unavailable',
    localStorageState: '{"hubName":"Empty fallback"}'
  });

  await assert.rejects(
    harness.context.loadState(),
    /Shared database read failed: disk temporarily unavailable/
  );
});

test('startup and chunked database load share one persistent native connection', async () => {
  const nativeState = '{"hubName":"Shared hub"}';
  const harness = await loadBackground({ usePersistentNative: true, nativeState });
  const loaded = await harness.context.loadState();

  assert.equal(loaded.json, nativeState);
  assert.equal(loaded.fromDisk, true);
  assert.equal(harness.nativeConnections.length, 1);
  assert.deepEqual(
    harness.nativeConnections[0].messages.map(message => message.type),
    ['PING', 'READ_CONFIG', 'READ_FILE_CHUNK']
  );
});

test('native disconnect clears availability and a later probe reconnects', async () => {
  const harness = await loadBackground({ usePersistentNative: true });
  await harness.context.ensureNativeStorageReady();
  assert.equal(harness.context.getStorageInfo().nativeAvailable, true);

  harness.nativeConnections[0].disconnect();
  assert.equal(harness.context.getStorageInfo().nativeAvailable, false);
  assert.match(harness.context.getStorageInfo().nativeError, /disconnected/i);

  vm.runInContext('lastNativeRefreshAt = 0', harness.context);
  await harness.context.ensureNativeStorageReady();
  assert.equal(harness.context.getStorageInfo().nativeAvailable, true);
  assert.equal(harness.nativeConnections.length, 2);
});
