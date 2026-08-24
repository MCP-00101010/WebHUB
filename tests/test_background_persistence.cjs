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
  const nativeRequests = [];
  const executedScripts = [];
  const createdTabs = [];
  const updatedTabs = [];
  const scheduledTimeouts = [];
  const injectedTabs = new Set();
  const storageValues = new Map(Object.entries(options.storageValues || {}));
  if (options.localStorageState) storageValues.set('morpheusState', options.localStorageState);
  const createdAlarms = new Map();
  const createdNotifications = [];
  const browser = {
    runtime: {
      id: 'test-extension',
      getManifest: () => ({ version: '1.0.31' }),
      getURL: value => `moz-extension://test/${value}`,
      getBrowserInfo: options.browserVersion ? async () => ({ version: options.browserVersion }) : undefined,
      sendNativeMessage: async (_host, message) => {
        nativeRequests.push(message);
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
        if (message.type === 'EMUGUI_STATUS') return options.emuguiStatus || { ok: true, emugui: { available: true, serviceVersion: 1 } };
        if (message.type === 'EMUGUI_CREATE_HUB_BINDING') return options.emuguiBinding || { ok: true, game: { gameKey: 'game_abcdefghijklmnop', state: 'ready', title: 'Jetpac', tags: ['Games', 'ZX Spectrum'], systemId: 'zx-spectrum', systemName: 'ZX Spectrum', emulatorName: 'EightyOne', profileName: 'Spectrum 48K', thumbnailCache: '' } };
        if (message.type === 'EMUGUI_AUTHORIZE_PAGE') return { ok: true, authorized: options.emuguiAuthorized !== false };
        if (message.type === 'EMUGUI_API') return options.emuguiApi || { ok: true, result: { ok: true, games: [] } };
        if (message.type === 'EMUGUI_ASSET') return options.emuguiAsset || { ok: true, asset: { dataUrl: 'data:image/png;base64,cG5n', contentType: 'image/png' } };
        if (message.type === 'GAME_STATUS') return { ok: true, game: { gameKey: message.gameKey, state: 'ready', title: 'Jetpac' } };
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
        get: async keys => {
          const selected = typeof keys === 'string' ? [keys] : (Array.isArray(keys) ? keys : [...storageValues.keys()]);
          return Object.fromEntries(selected.filter(key => storageValues.has(key)).map(key => [key, storageValues.get(key)]));
        },
        set: async values => { Object.entries(values || {}).forEach(([key, value]) => storageValues.set(key, value)); },
        remove: async keys => { (Array.isArray(keys) ? keys : [keys]).forEach(key => storageValues.delete(key)); }
      }
    },
    alarms: {
      create: (name, details) => { createdAlarms.set(name, details); },
      clear: async name => createdAlarms.delete(name),
      onAlarm: { addListener: listener => { listeners.alarm = listener; } }
    },
    notifications: {
      create: async (id, details) => { createdNotifications.push({ id, details }); return id; },
      onClicked: { addListener: listener => { listeners.notificationClicked = listener; } }
    },
    windows: { update: async () => ({}) },
    tabs: {
      query: async query => typeof options.queryTabs === 'function' ? options.queryTabs(query) : (options.tabs || []),
      get: async tabId => (options.tabs || []).find(tab => tab.id === tabId),
      create: async details => {
        if ((options.createFailures || []).includes(details.url)) throw new Error('simulated open failure');
        const tab = { id: 1000 + createdTabs.length, ...details };
        createdTabs.push(tab);
        return tab;
      },
      update: async (tabId, details) => {
        updatedTabs.push({ tabId, details });
        return { id: tabId, ...details };
      },
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
        if (message.type === 'MW_GET_INBOX_TARGETS') {
          return { ok: true, boards: [{ id: 'board-1', tabs: [{ id: 'tab-1' }] }] };
        }
        return { ok: true, persisted: 'shared' };
      },
      onRemoved: { addListener: listener => { listeners.removed = listener; } },
      onUpdated: { addListener: listener => { listeners.updated = listener; } },
      onActivated: { addListener: listener => { listeners.activated = listener; } }
    },
    sessions: { getRecentlyClosed: async () => options.recentlyClosed || [] },
    bookmarks: { getSubTree: async () => [] },
    menus: {
      create: () => {},
      remove: async () => {},
      onClicked: { addListener: () => {} }
    },
    commands: { onCommand: { addListener: listener => { listeners.command = listener; } } }
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
            } else if (message.type === 'EMUGUI_STATUS') {
              messageListeners.forEach(listener => listener(options.emuguiStatus || { ok: true, emugui: { available: true, serviceVersion: 1 } }));
            } else if (message.type === 'EMUGUI_CREATE_HUB_BINDING') {
              messageListeners.forEach(listener => listener(options.emuguiBinding || { ok: true, game: { gameKey: 'game_abcdefghijklmnop', state: 'ready', title: 'Jetpac', tags: ['Games', 'ZX Spectrum'], systemId: 'zx-spectrum', systemName: 'ZX Spectrum', emulatorName: 'EightyOne', profileName: 'Spectrum 48K', thumbnailCache: '' } }));
            } else if (message.type === 'EMUGUI_AUTHORIZE_PAGE') {
              messageListeners.forEach(listener => listener({ ok: true, authorized: options.emuguiAuthorized !== false }));
            } else if (message.type === 'EMUGUI_API') {
              messageListeners.forEach(listener => listener(options.emuguiApi || { ok: true, result: { ok: true, games: [] } }));
            } else if (message.type === 'EMUGUI_ASSET') {
              messageListeners.forEach(listener => listener(options.emuguiAsset || { ok: true, asset: { dataUrl: 'data:image/png;base64,cG5n', contentType: 'image/png' } }));
            } else if (message.type === 'GAME_STATUS') {
              messageListeners.forEach(listener => listener({ ok: true, game: { gameKey: message.gameKey, state: 'ready', title: 'Jetpac' } }));
            } else if (message.type === 'OPEN_GAME_IN_EMUGUI') {
              const suffix = message.rebind ? '&hubRebind=game_abcdefghijklmnop' : '';
              messageListeners.forEach(listener => listener({ ok: true, url: `http://127.0.0.1:8765/?game=jetpac${suffix}` }));
            } else if (message.type === 'REBIND_GAME') {
              messageListeners.forEach(listener => listener(options.emuguiBinding || { ok: true, game: { gameKey: message.gameKey, state: 'ready', title: 'Jetpac', tags: ['Games', 'ZX Spectrum'], systemId: 'zx-spectrum', systemName: 'ZX Spectrum', emulatorName: 'EightyOne', profileName: 'Spectrum 48K', thumbnailCache: '' } }));
            } else if (message.type === 'LAUNCH_APPROVED_APPLICATION' || message.type === 'LAUNCH_GAME' || message.type === 'REVEAL_GAME' || message.type === 'FORGET_GAME') {
              messageListeners.forEach(listener => listener({ ok: true }));
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
    fetch: options.fetchImpl || globalThis.fetch,
    AbortController,
    TextDecoder,
    Uint8Array,
    atob: value => Buffer.from(value, 'base64').toString('binary'),
    btoa: value => Buffer.from(value, 'binary').toString('base64'),
    crypto: require('node:crypto').webcrypto,
    setTimeout: (callback, delay, ...args) => {
      scheduledTimeouts.push(delay);
      return setTimeout(callback, delay, ...args);
    },
    clearTimeout
  });
  const filename = path.join(__dirname, '..', 'extension', 'background.js');
  vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  await new Promise(resolve => setImmediate(resolve));
  return { context, listeners, nativeWrites, nativeRequests, pendingWrites, sentTabs, nativeConnections, executedScripts, createdTabs, updatedTabs, scheduledTimeouts, storageValues, createdAlarms, createdNotifications };
}

test('extension notification jobs persist, fire once, and enter the Hub notification feed', async () => {
  const harness = await loadBackground();
  const when = Date.now() + 60000;
  const job = { id: 'countdown:one', title: 'Countdown complete', message: 'Tea has arrived.', when, expiresAt: when + 60000, dedupeKey: 'tea:one', source: { widgetType: 'countdown', widgetId: 'one', label: 'Tea' } };
  const scheduled = await harness.context.scheduleHubNotification(job);
  assert.equal(scheduled.ok, true);
  assert.equal(harness.createdAlarms.get('morpheus-notification:countdown:one').when, when);
  assert.equal(harness.storageValues.get('morpheusNotificationJobsV1').length, 1);

  harness.listeners.alarm({ name: 'morpheus-notification:countdown:one' });
  await new Promise(resolve => setImmediate(resolve));
  await harness.context.notificationMutation;
  assert.equal(harness.createdNotifications.length, 1);
  assert.equal(harness.createdNotifications[0].details.message, 'Tea has arrived.');
  assert.equal(harness.storageValues.get('morpheusNotificationJobsV1').length, 0);
  assert.equal(harness.storageValues.get('morpheusNotificationEventsV1').length, 1);
});

test('extension recreates future alarms and fires missed unexpired jobs after restart', async () => {
  const harness = await loadBackground();
  const future = Date.now() + 90000;
  const missed = Date.now() - 1000;
  harness.storageValues.set('morpheusNotificationJobsV1', [
    { id: 'future', title: 'Future', message: 'Still pending', when: future, expiresAt: future + 60000, dedupeKey: 'future', source: {} },
    { id: 'missed', title: 'Missed', message: 'Recovered after restart', when: missed, expiresAt: Date.now() + 60000, dedupeKey: 'missed', source: {} }
  ]);
  await harness.context.rehydrateNotificationAlarms();
  await harness.context.notificationMutation;
  assert.equal(harness.createdAlarms.get('morpheus-notification:future').when, future);
  assert.equal(harness.createdNotifications.at(-1).details.message, 'Recovered after restart');
  assert.deepEqual(harness.storageValues.get('morpheusNotificationJobsV1').map(job => job.id), ['future']);
});

test('directory approval passes a finite interactive timeout to the native request', async () => {
  const harness = await loadBackground();
  harness.scheduledTimeouts.length = 0;

  await harness.context.approveDirectory('git', 'Approve a Git repository folder');

  assert.deepEqual(harness.scheduledTimeouts, [300000]);
  assert.ok(harness.scheduledTimeouts.every(Number.isFinite));

  harness.scheduledTimeouts.length = 0;
  await harness.context.sendNativeRequest({ type: 'PING' }, { timeoutMs: 1 });
  assert.deepEqual(harness.scheduledTimeouts, [15000]);
});

test('session capture removes browser IDs and skips private/internal tabs', async () => {
  const harness = await loadBackground({ tabs: [
    { id: 1, windowId: 9, title: 'Public', url: 'https://example.com/', pinned: true },
    { id: 2, windowId: 9, title: 'Private', url: 'https://private.example/', incognito: true },
    { id: 3, windowId: 9, title: 'Internal', url: 'about:config' }
  ] });
  const result = await harness.context.captureBrowserSession('window');
  assert.equal(result.tabs.length, 1);
  assert.equal(result.skippedPrivate, 1);
  assert.equal(JSON.stringify(result.tabs).includes('windowId'), false);
  assert.equal(JSON.stringify(result.tabs).includes('"id"'), false);
});

test('active-tab capture falls back to the last active web tab when invoked from the Hub', async () => {
  const tabs = [
    { id: 7, windowId: 2, title: 'Work', url: 'https://work.example/', active: false },
    { id: 8, windowId: 2, title: 'Hub', url: 'file:///hub.html', active: true }
  ];
  const harness = await loadBackground({ tabs, queryTabs: () => [tabs[1]] });
  harness.listeners.activated({ tabId: 7 });
  await new Promise(resolve => setImmediate(resolve));
  harness.listeners.activated({ tabId: 8 });
  await new Promise(resolve => setImmediate(resolve));
  const result = await harness.context.captureBrowserSession('active-tab');
  assert.equal(result.tabs.length, 1);
  assert.equal(result.tabs[0].url, 'https://work.example/');
});

test('session launch deduplicates URLs and reports partial failures without aborting', async () => {
  const harness = await loadBackground({ createFailures: ['https://bad.example/'] });
  const result = await harness.context.launchBrowserSession([
    { title: 'One', url: 'https://one.example/' },
    { title: 'One duplicate', url: 'https://one.example/#again' },
    { title: 'Bad', url: 'https://bad.example/' },
    { title: 'Two', url: 'https://two.example/' }
  ], { staggerMs: 0, recreateGroups: true });
  assert.equal(result.opened, 2);
  assert.equal(result.failed, 1);
  assert.equal(result.groupingSupported, false);
  assert.deepEqual(harness.createdTabs.map(tab => tab.url), ['https://one.example/', 'https://two.example/']);
});

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

test('the active registered hub receives deliveries over a later inactive registration', async () => {
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

  assert.equal(harness.sentTabs.at(-1).tabId, 10);

  const targets = await new Promise(resolve => {
    harness.listeners.message({ type: 'MW_GET_INBOX_TARGETS' }, {}, resolve);
  });
  assert.equal(targets.boards[0].tabs[0].id, 'tab-1');
  assert.equal(harness.sentTabs.at(-1).message.type, 'MW_GET_INBOX_TARGETS');
});

test('extension handshake responds before native host startup completes', async () => {
  const nativePing = deferred();
  const harness = await loadBackground({ nativePing });
  let response = null;
  const registration = await new Promise(resolve => harness.listeners.message(
    { type: 'MW_REGISTER', pageUrl: 'file:///hub.html', active: true },
    { tab: { id: 10, url: 'file:///hub.html' } },
    resolve
  ));
  assert(registration.capabilities.includes('urlHealth'));
  assert(registration.capabilities.includes('translationModels'));
  assert(registration.capabilities.includes('emuguiService'));
  harness.listeners.message(
    { type: 'MW_PING', morpheusPage: true, pageUrl: 'file:///hub.html', hubSessionToken: registration.hubSessionToken },
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

test('EmuGUI status is routed through the native host', async () => {
  const harness = await loadBackground({
    emuguiStatus: { ok: true, emugui: { available: true, serviceVersion: 1, activeCollection: { id: 'spectrum', name: 'ZX Spectrum' } } }
  });

  const result = await harness.context.getEmuGuiStatus();

  assert.equal(result.emugui.activeCollection.id, 'spectrum');
  assert.equal(harness.nativeRequests.at(-1).type, 'EMUGUI_STATUS');
});

test('authorized EmuGUI page creates a native binding and delivers a compact game to Hub Inbox', async () => {
  const harness = await loadBackground({ tabs: [{ id: 10, url: 'file:///hub.html', active: true }] });
  await new Promise(resolve => harness.listeners.message(
    { type: 'MW_REGISTER', pageUrl: 'file:///hub.html', active: true },
    { tab: { id: 10, url: 'file:///hub.html', active: true } },
    resolve
  ));

  const pageUrl = 'http://127.0.0.1:8765/';
  const registration = await new Promise(resolve => harness.listeners.message(
    { type: 'MW_EMUGUI_REGISTER', pageUrl },
    { tab: { id: 20, url: pageUrl } },
    resolve
  ));

  const result = await new Promise(resolve => harness.listeners.message(
    {
      type: 'MW_EMUGUI_SEND_GAME', gameId: 'jetpac', emulatorId: 'eightyone', profileId: 'profile-48k',
      pageUrl, emuguiSessionToken: registration.emuguiSessionToken
    },
    { tab: { id: 20, url: pageUrl } },
    resolve
  ));

  assert.equal(result.ok, true);
  assert.equal(harness.nativeRequests.at(-1).type, 'EMUGUI_CREATE_HUB_BINDING');
  assert.equal(harness.sentTabs.at(-1).message.type, 'MW_RECEIVE_GAME');
  assert.equal(harness.sentTabs.at(-1).message.game.gameKey, 'game_abcdefghijklmnop');
  assert.equal(harness.sentTabs.at(-1).message.game.systemId, 'zx-spectrum');
  assert.equal(harness.sentTabs.at(-1).message.game.emulatorName, 'EightyOne');
  assert.equal(harness.sentTabs.at(-1).message.game.profileName, 'Spectrum 48K');
  assert.equal('path' in harness.sentTabs.at(-1).message.game, false);
});

test('EmuGUI delivery rejects pages outside its fixed localhost origin', async () => {
  const harness = await loadBackground();
  const result = await new Promise(resolve => harness.listeners.message(
    { type: 'MW_EMUGUI_SEND_GAME', gameId: 'jetpac' },
    { tab: { id: 20, url: 'http://localhost:9999/' } },
    resolve
  ));
  assert.equal(result.ok, false);
  assert.match(result.error, /not authorized/i);
  assert.equal(harness.nativeRequests.some(message => message.type === 'EMUGUI_CREATE_HUB_BINDING'), false);
});

test('localhost EmuGUI fallback cannot invoke the privileged management RPC', async () => {
  const harness = await loadBackground();
  const pageUrl = 'http://127.0.0.1:8765/';
  const sender = { tab: { id: 20, url: pageUrl } };
  const registration = await new Promise(resolve => harness.listeners.message(
    { type: 'MW_EMUGUI_REGISTER', pageUrl }, sender, resolve
  ));
  const result = await new Promise(resolve => harness.listeners.message({
    type: 'MW_EMUGUI_RPC', method: 'POST', path: '/api/delete', body: { game_id: 'jetpac' }, pageUrl,
    emuguiSessionToken: registration.emuguiSessionToken
  }, sender, resolve));

  assert.equal(result.ok, false);
  assert.match(result.error, /not authorized/i);
  assert.equal(harness.nativeRequests.some(message => message.type === 'EMUGUI_API'), false);
});

test('configured EmuGUI file page registers once and relays API and asset requests', async () => {
  const harness = await loadBackground({ usePersistentNative: true });
  const pageUrl = 'file:///F:/Projects/Coding/Morpheus%20EmuGUI/web/index.html';
  const sender = { tab: { id: 21, url: pageUrl } };
  const registration = await new Promise(resolve => harness.listeners.message(
    { type: 'MW_EMUGUI_REGISTER', pageUrl }, sender, resolve
  ));

  assert.equal(registration.ok, true);
  assert.equal(registration.transport, 'extension');
  assert.equal(harness.nativeConnections[0].messages.some(message => message.type === 'EMUGUI_AUTHORIZE_PAGE'), true);

  const rpc = await new Promise(resolve => harness.listeners.message({
    type: 'MW_EMUGUI_RPC', method: 'GET', path: '/api/games', query: {}, body: {}, pageUrl,
    emuguiSessionToken: registration.emuguiSessionToken
  }, sender, resolve));
  const asset = await new Promise(resolve => harness.listeners.message({
    type: 'MW_EMUGUI_ASSET', path: 'screenshots/jetpac.png', pageUrl,
    emuguiSessionToken: registration.emuguiSessionToken
  }, sender, resolve));

  assert.equal(rpc.result.games.length, 0);
  assert.match(asset.asset.dataUrl, /^data:image\/png/);
  assert.equal(harness.nativeConnections[0].messages.some(message => message.type === 'EMUGUI_API'), true);
  assert.equal(harness.nativeConnections[0].messages.some(message => message.type === 'EMUGUI_ASSET'), true);
});

test('unconfigured EmuGUI file page is denied before RPC reaches the native service', async () => {
  const harness = await loadBackground({ usePersistentNative: true, emuguiAuthorized: false });
  const pageUrl = 'file:///F:/Untrusted/web/index.html';
  const sender = { tab: { id: 22, url: pageUrl } };
  const registration = await new Promise(resolve => harness.listeners.message(
    { type: 'MW_EMUGUI_REGISTER', pageUrl }, sender, resolve
  ));

  assert.equal(registration.ok, false);
  assert.match(registration.error, /configured Morpheus EmuGUI/i);
  assert.equal(harness.nativeConnections[0].messages.some(message => message.type === 'EMUGUI_API'), false);
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

test('bounded link-health checks report redirects and unsupported schemes', async () => {
  const harness = await loadBackground({
    fetchImpl: async () => ({
      status: 200,
      statusText: 'OK',
      url: 'https://example.com/final',
      body: { cancel: async () => {} }
    })
  });
  const registration = await new Promise(resolve => harness.listeners.message(
    { type: 'MW_REGISTER', pageUrl: 'file:///hub.html', active: true },
    { tab: { id: 10, url: 'file:///hub.html' } },
    resolve
  ));
  const sendPageRequest = message => new Promise(resolve => harness.listeners.message(
    { ...message, morpheusPage: true, pageUrl: 'file:///hub.html', hubSessionToken: registration.hubSessionToken },
    { tab: { id: 10, url: 'file:///hub.html' } },
    resolve
  ));

  const checked = await sendPageRequest({ type: 'MW_CHECK_URL', url: 'https://example.com/start' });
  assert.equal(checked.reachable, true);
  assert.equal(checked.finalUrl, 'https://example.com/final');
  const unsupported = await sendPageRequest({ type: 'MW_CHECK_URL', url: 'ftp://example.com/file' });
  assert.equal(unsupported.errorType, 'unsupported');
});

test('link-health retries with a bounded GET when a server rejects HEAD', async () => {
  const methods = [];
  const harness = await loadBackground({
    fetchImpl: async (_url, options) => {
      methods.push(options.method);
      if (options.method === 'HEAD') throw new TypeError('NetworkError when attempting to fetch resource.');
      return { status: 200, statusText: 'OK', url: 'https://example.com/page', body: { cancel: async () => {} } };
    }
  });
  const registration = await new Promise(resolve => harness.listeners.message(
    { type: 'MW_REGISTER', pageUrl: 'file:///hub.html', active: true },
    { tab: { id: 14, url: 'file:///hub.html' } },
    resolve
  ));
  const checked = await new Promise(resolve => harness.listeners.message(
    { type: 'MW_CHECK_URL', url: 'https://example.com/page', morpheusPage: true, pageUrl: 'file:///hub.html', hubSessionToken: registration.hubSessionToken },
    { tab: { id: 14, url: 'file:///hub.html' } },
    resolve
  ));

  assert.deepEqual(methods, ['HEAD', 'GET']);
  assert.equal(checked.reachable, true);
  assert.equal(checked.status, 200);
});

test('the Firefox command focuses the registered Hub palette', async () => {
  const harness = await loadBackground();
  await new Promise(resolve => harness.listeners.message(
    { type: 'MW_REGISTER', pageUrl: 'file:///hub.html', active: true },
    { tab: { id: 12, url: 'file:///hub.html' } },
    resolve
  ));
  harness.listeners.command('open-command-palette');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(harness.sentTabs.at(-1).tabId, 12);
  assert.equal(harness.sentTabs.at(-1).message.type, 'MW_OPEN_COMMAND_PALETTE');
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

test('application launches stay on the persistent native connection', async () => {
  const harness = await loadBackground({ usePersistentNative: true });
  const registration = await new Promise(resolve => harness.listeners.message(
    { type: 'MW_REGISTER', pageUrl: 'file:///hub.html', active: true },
    { tab: { id: 10, url: 'file:///hub.html' } },
    resolve
  ));
  const response = await new Promise(resolve => harness.listeners.message(
    {
      type: 'MW_LAUNCH_APPROVED_APPLICATION', appKey: 'app_abcdefghijklmnop',
      morpheusPage: true, pageUrl: 'file:///hub.html', hubSessionToken: registration.hubSessionToken
    },
    { tab: { id: 10, url: 'file:///hub.html' } },
    resolve
  ));

  assert.equal(response.ok, true);
  assert.equal(harness.nativeConnections.length, 1);
  assert.deepEqual(
    harness.nativeConnections[0].messages.map(message => message.type),
    ['PING', 'READ_CONFIG', 'LAUNCH_APPROVED_APPLICATION']
  );
});

test('EmuGUI game launches stay on the persistent native connection', async () => {
  const harness = await loadBackground({ usePersistentNative: true });
  const registration = await new Promise(resolve => harness.listeners.message(
    { type: 'MW_REGISTER', pageUrl: 'file:///hub.html', active: true },
    { tab: { id: 10, url: 'file:///hub.html' } },
    resolve
  ));
  const response = await new Promise(resolve => harness.listeners.message(
    {
      type: 'MW_LAUNCH_GAME', gameKey: 'game_abcdefghijklmnop',
      morpheusPage: true, pageUrl: 'file:///hub.html', hubSessionToken: registration.hubSessionToken
    },
    { tab: { id: 10, url: 'file:///hub.html' } },
    resolve
  ));

  assert.equal(response.ok, true);
  assert.deepEqual(harness.nativeConnections[0].messages.map(message => message.type), ['PING', 'READ_CONFIG', 'LAUNCH_GAME']);
  assert(harness.scheduledTimeouts.includes(120000));
});

test('Hub game actions open a focused EmuGUI rebind page and reveal through native authority', async () => {
  const harness = await loadBackground({ usePersistentNative: true });
  const opened = await harness.context.openGameInEmuGui('game_abcdefghijklmnop', true);
  const revealed = await harness.context.runGameAction('REVEAL_GAME', 'game_abcdefghijklmnop');

  assert.equal(opened.ok, true);
  assert.equal(revealed.ok, true);
  assert.match(harness.createdTabs[0].url, /^http:\/\/127\.0\.0\.1:8765\/\?game=jetpac&hubRebind=/);
  assert.deepEqual(harness.nativeConnections[0].messages.map(message => message.type), [
    'PING', 'READ_CONFIG', 'OPEN_GAME_IN_EMUGUI', 'REVEAL_GAME'
  ]);
});

test('EmuGUI rebind updates the existing Hub game instead of delivering a duplicate', async () => {
  const harness = await loadBackground({ usePersistentNative: true, tabs: [{ id: 10, url: 'file:///hub.html', active: true }], hubTabIds: [10], relayPresent: true });
  await new Promise(resolve => harness.listeners.message(
    { type: 'MW_REGISTER', pageUrl: 'file:///hub.html', active: true },
    { tab: { id: 10, url: 'file:///hub.html', active: true } },
    resolve
  ));
  const result = await harness.context.sendEmuGuiGameToHub({
    gameId: 'jetpac', emulatorId: 'eightyone', profileId: 'profile-48k', rebindGameKey: 'game_abcdefghijklmnop'
  });

  assert.equal(result.ok, true);
  assert.equal(harness.sentTabs.at(-1).message.type, 'MW_UPDATE_GAME_BINDING');
  assert.equal(harness.sentTabs.at(-1).message.game.gameKey, 'game_abcdefghijklmnop');
  assert(harness.nativeConnections[0].messages.some(message => message.type === 'REBIND_GAME'));
});

test('EmuGUI status and binding work share the warmed persistent native connection', async () => {
  const harness = await loadBackground({ usePersistentNative: true });

  const status = await harness.context.getEmuGuiStatus();
  const binding = await harness.context.createEmuGuiHubBinding('jetpac', 'eightyone', 'profile-48k');
  const gameStatus = await harness.context.getGameStatus('game_abcdefghijklmnop', true);

  assert.equal(status.ok, true);
  assert.equal(binding.game.title, 'Jetpac');
  assert.equal(gameStatus.game.state, 'ready');
  assert.deepEqual(harness.nativeConnections[0].messages.map(message => message.type), [
    'PING', 'READ_CONFIG', 'EMUGUI_STATUS', 'EMUGUI_CREATE_HUB_BINDING', 'GAME_STATUS'
  ]);
  assert.equal(harness.nativeConnections[0].messages.at(-1).includeThumbnail, true);
  assert.equal(harness.scheduledTimeouts.filter(timeout => timeout === 120000).length, 3);
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

test('extension feed relay fetches bounded text only for the Hub page', async () => {
  const requests = [];
  const feedText = '<rss><channel><title>Test</title></channel></rss>';
  const harness = await loadBackground({
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      return {
        ok: true,
        status: 200,
        url: String(url),
        headers: { get: name => name === 'content-length' ? String(Buffer.byteLength(feedText)) : 'application/rss+xml' },
        arrayBuffer: async () => Buffer.from(feedText)
      };
    }
  });
  const registration = await new Promise(resolve => {
    harness.listeners.message(
      { type: 'MW_REGISTER', pageUrl: 'file:///hub/index.html', active: true },
      { tab: { id: 7, url: 'file:///hub/index.html' } },
      resolve
    );
  });
  const response = await new Promise(resolve => {
    harness.listeners.message(
      { type: 'MW_FETCH_FEED', morpheusPage: true, pageUrl: 'file:///hub/index.html', hubSessionToken: registration.hubSessionToken, url: 'https://example.com/feed.xml' },
      { tab: { id: 7, url: 'file:///hub/index.html' } },
      resolve
    );
  });
  assert.equal(response.ok, true);
  assert.equal(response.text, feedText);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.credentials, 'omit');
  assert.match(requests[0].options.headers.Accept, /rss\+xml/);

  const denied = await new Promise(resolve => {
    harness.listeners.message(
      { type: 'MW_FETCH_FEED', morpheusPage: false, pageUrl: 'https://example.com/', url: 'https://example.com/feed.xml' },
      { tab: { id: 8, url: 'https://example.com/' } },
      resolve
    );
  });
  assert.equal(denied.ok, false);
  assert.match(denied.error, /not authorized/i);
});

test('translator relay serves only fixed Mozilla model ranges to an authenticated Hub', async () => {
  const requests = [];
  const bytes = Uint8Array.from([1, 2, 3, 4]);
  const harness = await loadBackground({
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      return {
        status: 206,
        headers: { get: name => name.toLowerCase() === 'content-range' ? 'bytes 0-3/31561787' : null },
        arrayBuffer: async () => bytes.buffer
      };
    }
  });
  const registration = await new Promise(resolve => harness.listeners.message(
    { type: 'MW_REGISTER', pageUrl: 'file:///hub/index.html', active: true },
    { tab: { id: 27, url: 'file:///hub/index.html' } }, resolve
  ));
  const sendPageRequest = message => new Promise(resolve => harness.listeners.message(
    { ...message, morpheusPage: true, pageUrl: 'file:///hub/index.html', hubSessionToken: registration.hubSessionToken },
    { tab: { id: 27, url: 'file:///hub/index.html' } }, resolve
  ));
  const response = await sendPageRequest({
    type: 'MW_FETCH_TRANSLATOR_ASSET_CHUNK', assetId: 'ende:model:2.1', offset: 0, length: 4
  });
  assert.equal(response.ok, true);
  assert.deepEqual([...Buffer.from(response.chunk, 'base64')], [1, 2, 3, 4]);
  assert.equal(response.nextOffset, 4);
  assert.equal(response.totalSize, 31561787);
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /^https:\/\/firefox-settings-attachments\.cdn\.mozilla\.net\//);
  assert.equal(requests[0].options.headers.Range, 'bytes=0-3');
  assert.equal(requests[0].options.credentials, 'omit');
  assert.equal(requests[0].options.redirect, 'error');

  const denied = await sendPageRequest({
    type: 'MW_FETCH_TRANSLATOR_ASSET_CHUNK', assetId: 'custom:https://example.com/model.bin', offset: 0, length: 4
  });
  assert.equal(denied.ok, false);
  assert.match(denied.error, /unknown translation model asset/i);
  assert.equal(requests.length, 1);
});

test('calendar relay forwards only bounded calendar headers for an authenticated Hub session', async () => {
  const requests = [];
  const body = JSON.stringify({ matches: [] });
  const harness = await loadBackground({
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      const rejected = options?.headers?.Authorization === 'bad-sportmonks-token';
      const responseBody = rejected ? JSON.stringify({ message: 'Invalid token provided' }) : body;
      return {
        ok: !rejected, status: rejected ? 401 : 200, url: String(url),
        headers: { get: name => name === 'content-length' ? String(Buffer.byteLength(responseBody)) : 'application/json' },
        arrayBuffer: async () => Buffer.from(responseBody)
      };
    }
  });
  const registration = await new Promise(resolve => harness.listeners.message(
    { type: 'MW_REGISTER', pageUrl: 'file:///hub/index.html', active: true },
    { tab: { id: 17, url: 'file:///hub/index.html' } }, resolve
  ));
  const response = await new Promise(resolve => harness.listeners.message(
    {
      type: 'MW_FETCH_CALENDAR', morpheusPage: true, pageUrl: 'file:///hub/index.html',
      hubSessionToken: registration.hubSessionToken, url: 'https://api.football-data.org/v4/competitions/PL/matches',
      headers: { Accept: 'application/json', 'X-Auth-Token': 'private-token', Authorization: 'must-not-pass' }
    },
    { tab: { id: 17, url: 'file:///hub/index.html' } }, resolve
  ));
  assert.equal(response.ok, true);
  assert.equal(requests[0].options.headers.Accept, 'application/json');
  assert.equal(requests[0].options.headers['X-Auth-Token'], 'private-token');
  assert.equal(requests[0].options.headers.Authorization, undefined);
  assert.equal(requests[0].options.credentials, 'omit');
  assert.equal(requests[0].options.redirect, 'error');

  await new Promise(resolve => harness.listeners.message(
    {
      type: 'MW_FETCH_CALENDAR', morpheusPage: true, pageUrl: 'file:///hub/index.html',
      hubSessionToken: registration.hubSessionToken, url: 'https://example.com/calendar.json',
      headers: { 'X-Auth-Token': 'must-not-leak' }
    },
    { tab: { id: 17, url: 'file:///hub/index.html' } }, resolve
  ));
  assert.equal(requests[1].options.headers['X-Auth-Token'], undefined);
  assert.equal(requests[1].options.redirect, 'follow');

  await new Promise(resolve => harness.listeners.message(
    {
      type: 'MW_FETCH_CALENDAR', morpheusPage: true, pageUrl: 'file:///hub/index.html',
      hubSessionToken: registration.hubSessionToken, url: 'https://api.sportmonks.com/v3/football/leagues/501',
      headers: { Authorization: 'sportmonks-token', 'x-apisports-key': 'must-not-pass' }
    },
    { tab: { id: 17, url: 'file:///hub/index.html' } }, resolve
  ));
  assert.equal(requests[2].options.headers.Authorization, 'sportmonks-token');
  assert.equal(requests[2].options.headers['x-apisports-key'], undefined);
  assert.equal(requests[2].options.redirect, 'error');

  await new Promise(resolve => harness.listeners.message(
    {
      type: 'MW_FETCH_CALENDAR', morpheusPage: true, pageUrl: 'file:///hub/index.html',
      hubSessionToken: registration.hubSessionToken, url: 'https://v3.football.api-sports.io/fixtures?league=45&season=2026',
      headers: { 'x-apisports-key': 'api-football-key', Authorization: 'must-not-pass' }
    },
    { tab: { id: 17, url: 'file:///hub/index.html' } }, resolve
  ));
  assert.equal(requests[3].options.headers['x-apisports-key'], 'api-football-key');
  assert.equal(requests[3].options.headers.Authorization, undefined);
  assert.equal(requests[3].options.redirect, 'error');

  const rejected = await new Promise(resolve => harness.listeners.message(
    {
      type: 'MW_FETCH_CALENDAR', morpheusPage: true, pageUrl: 'file:///hub/index.html',
      hubSessionToken: registration.hubSessionToken, url: 'https://api.sportmonks.com/v3/football/leagues/501',
      headers: { Authorization: 'bad-sportmonks-token' }
    },
    { tab: { id: 17, url: 'file:///hub/index.html' } }, resolve
  ));
  assert.equal(rejected.ok, false);
  assert.equal(rejected.status, 401);
  assert.match(rejected.error, /Invalid token provided/);
});

test('native services require the exact registered Hub session', async () => {
  const harness = await loadBackground();
  const registration = await new Promise(resolve => harness.listeners.message(
    { type: 'MW_REGISTER', pageUrl: 'file:///hub/index.html', active: true },
    { tab: { id: 71, url: 'file:///hub/index.html' } },
    resolve
  ));
  assert.ok(registration.hubSessionToken);

  const denied = await new Promise(resolve => harness.listeners.message(
    {
      type: 'MW_SECRET_GET', morpheusPage: true, pageUrl: 'file:///hub/index.html',
      hubSessionToken: 'wrong-session', key: 'nasa'
    },
    { tab: { id: 71, url: 'file:///hub/index.html' } },
    resolve
  ));
  assert.equal(denied.ok, false);
  assert.match(denied.error, /not authorized/i);

  assert.equal(harness.context.joinThemePath('../escape.json'), null);
  assert.match(harness.context.joinThemePath('safe-theme.json'), /safe-theme\.json$/);
  assert.equal(harness.context.fileUrlToPath('file:///home/user/WebHub/index.html'), '/home/user/WebHub/index.html');
  assert.equal(harness.context.fileUrlToPath('file:///F:/WebHub/index.html'), 'F:\\WebHub\\index.html');
});
