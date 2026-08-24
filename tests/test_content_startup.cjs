const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

test('known-good idle relay registers and catches the page bridge ping', async () => {
  let markerAvailable = true;
  const windowListeners = new Map();
  const documentListeners = new Map();
  const runtimeListeners = [];
  const runtimeMessages = [];
  const postedMessages = [];

  const window = {
    location: { href: 'file:///hub/index.html' },
    addEventListener(type, listener) {
      const listeners = windowListeners.get(type) || [];
      listeners.push(listener);
      windowListeners.set(type, listeners);
    },
    postMessage(message) { postedMessages.push(message); }
  };
  const document = {
    readyState: 'complete',
    hidden: false,
    hasFocus: () => true,
    documentElement: { dataset: {} },
    querySelector: selector => markerAvailable && selector === 'meta[name="morpheus-webhub"]' ? {} : null,
    addEventListener(type, listener) {
      const listeners = documentListeners.get(type) || [];
      listeners.push(listener);
      documentListeners.set(type, listeners);
    }
  };
  const browser = {
    runtime: {
      sendMessage: async message => {
        runtimeMessages.push(message);
        if (message.type === 'MW_REGISTER') return { ok: true, hubSessionToken: 'session-1' };
        return message.type === 'MW_PING'
          ? { ok: true, nativeAvailable: true, databasePath: 'C:\\hub.json' }
          : { ok: true };
      },
      onMessage: { addListener: listener => runtimeListeners.push(listener) }
    }
  };

  const context = vm.createContext({
    browser,
    document,
    window,
    Date,
    Promise,
    setTimeout,
    clearTimeout
  });
  const filename = path.join(__dirname, '..', 'extension', 'content.js');
  vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(windowListeners.get('message')?.length, 1);
  assert.deepEqual(runtimeMessages.map(message => message.type), ['MW_REGISTER']);
  assert.equal(document.documentElement.dataset.morpheusExtensionRelay, 'background-ready');
  assert.deepEqual(JSON.parse(JSON.stringify(await runtimeListeners[0]({ type: 'MW_DISCOVER' }))), {
    ok: true,
    isMorpheus: true,
    registered: true,
    pageUrl: 'file:///hub/index.html',
    hubSessionToken: 'session-1',
    error: ''
  });

  const request = {
    _mw: true,
    _req: true,
    id: 'startup-ping',
    type: 'MW_PING',
    morpheusPage: true
  };
  await windowListeners.get('message')[0]({ data: request, source: window });

  assert.deepEqual(runtimeMessages.map(message => message.type), ['MW_REGISTER', 'MW_REGISTER', 'MW_PING']);
  assert.equal(postedMessages.at(-1).id, 'startup-ping');
  assert.equal(postedMessages.at(-1).nativeAvailable, true);

  const delivery = runtimeListeners[0]({
    type: 'MW_RECEIVE_TAB',
    deliveryId: 'delivery-1',
    url: 'https://example.com',
    title: 'Example'
  });
  const pushed = postedMessages.at(-1);
  assert.equal(pushed.type, 'MW_RECEIVE_TAB');
  assert.equal(pushed.deliveryId, 'delivery-1');
  await windowListeners.get('message')[0]({
    source: window,
    data: { _mw: true, _pushResponse: true, pushRequestId: pushed.pushRequestId, ok: true, persisted: 'shared' }
  });
  assert.deepEqual(JSON.parse(JSON.stringify(await delivery)), {
    ok: true,
    conflict: false,
    persisted: 'shared',
    boards: [],
    activeBoardId: '',
    activeTabId: '',
    error: ''
  });

  const gameDelivery = runtimeListeners[0]({
    type: 'MW_RECEIVE_GAME',
    deliveryId: 'game-delivery-1',
    game: { gameKey: 'game_abcdefghijklmnop', title: 'Jetpac', tags: ['Games'], thumbnailCache: '' }
  });
  const gamePush = postedMessages.at(-1);
  assert.equal(gamePush.type, 'MW_RECEIVE_GAME');
  assert.equal(gamePush.game.gameKey, 'game_abcdefghijklmnop');
  await windowListeners.get('message')[0]({
    source: window,
    data: { _mw: true, _pushResponse: true, pushRequestId: gamePush.pushRequestId, ok: true, persisted: 'shared' }
  });
  assert.equal((await gameDelivery).ok, true);

  const gameUpdate = runtimeListeners[0]({
    type: 'MW_UPDATE_GAME_BINDING',
    deliveryId: 'game-update-1',
    game: { gameKey: 'game_abcdefghijklmnop', title: 'Jetpac', profileName: 'Spectrum 48K' }
  });
  const updatePush = postedMessages.at(-1);
  assert.equal(updatePush.type, 'MW_UPDATE_GAME_BINDING');
  assert.equal(updatePush.game.profileName, 'Spectrum 48K');
  await windowListeners.get('message')[0]({
    source: window,
    data: { _mw: true, _pushResponse: true, pushRequestId: updatePush.pushRequestId, ok: true, persisted: 'shared' }
  });
  assert.equal((await gameUpdate).ok, true);

  const targetsDelivery = runtimeListeners[0]({ type: 'MW_GET_INBOX_TARGETS' });
  const targetsPush = postedMessages.at(-1);
  assert.equal(targetsPush.type, 'MW_GET_INBOX_TARGETS');
  await windowListeners.get('message')[0]({
    source: window,
    data: {
      _mw: true,
      _pushResponse: true,
      pushRequestId: targetsPush.pushRequestId,
      ok: true,
      boards: [{ id: 'board-1', title: 'Board', tabs: [{ id: 'tab-1', title: 'Tab' }] }],
      activeBoardId: 'board-1',
      activeTabId: 'tab-1'
    }
  });
  const targets = await targetsDelivery;
  assert.equal(targets.boards[0].tabs[0].id, 'tab-1');
  assert.equal(targets.activeBoardId, 'board-1');

  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'extension', 'manifest.json'), 'utf8'));
  assert.equal(manifest.content_scripts[0].run_at, 'document_idle');
  assert.ok(manifest.content_scripts[0].matches.includes('file:///*'));
  assert.equal(manifest.permissions.includes('file:///*'), true);
});

test('discovery retries registration after the initial background handshake fails', async () => {
  const runtimeListeners = [];
  const runtimeMessages = [];
  let registrationAttempts = 0;
  const document = {
    hidden: false,
    hasFocus: () => true,
    documentElement: { dataset: {} },
    querySelector: selector => selector === 'meta[name="morpheus-webhub"]' ? {} : null
  };
  const window = {
    location: { href: 'file:///hub/index.html' },
    addEventListener: () => {},
    postMessage: () => {}
  };
  const browser = {
    runtime: {
      sendMessage: async message => {
        runtimeMessages.push(message);
        if (message.type === 'MW_REGISTER' && ++registrationAttempts === 1) {
          throw new Error('background was still starting');
        }
        return { ok: true, hubSessionToken: 'session-2' };
      },
      onMessage: { addListener: listener => runtimeListeners.push(listener) }
    }
  };
  const context = vm.createContext({ browser, document, window, Date, Promise, setTimeout, clearTimeout });
  const filename = path.join(__dirname, '..', 'extension', 'content.js');
  vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(document.documentElement.dataset.morpheusExtensionRelay, 'background-error');
  const discovered = await runtimeListeners[0]({ type: 'MW_DISCOVER' });
  assert.equal(discovered.registered, true);
  assert.equal(registrationAttempts, 2);
  assert.equal(document.documentElement.dataset.morpheusExtensionRelay, 'background-ready');
});

test('EmuGUI localhost page can request only bounded game delivery', async () => {
  const listeners = [];
  const runtimeMessages = [];
  const posted = [];
  const window = {
    location: { href: 'http://127.0.0.1:8765/', protocol: 'http:', hostname: '127.0.0.1', port: '8765' },
    addEventListener(type, listener) { if (type === 'message') listeners.push(listener); },
    postMessage(message) { posted.push(message); }
  };
  const document = {
    querySelector: selector => selector === 'meta[name="morpheus-emugui"]' ? {} : null,
    documentElement: { dataset: {} }
  };
  const browser = {
    runtime: {
      sendMessage: async message => {
        runtimeMessages.push(message);
        return { ok: true, deliveryId: 'game-one', persisted: 'shared' };
      },
      onMessage: { addListener: () => {} }
    }
  };
  const context = vm.createContext({ browser, document, window, Date, Promise, setTimeout, clearTimeout });
  const filename = path.join(__dirname, '..', 'extension', 'content.js');
  vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });

  await listeners[0]({ source: window, data: {
    _emuguiReq: true, requestId: 'request-1', type: 'MW_EMUGUI_SEND_GAME',
    gameId: 'jetpac', emulatorId: 'eightyone', profileId: 'profile-48k'
  } });

  assert.deepEqual(JSON.parse(JSON.stringify(runtimeMessages[0])), {
    type: 'MW_EMUGUI_SEND_GAME', gameId: 'jetpac', emulatorId: 'eightyone', profileId: 'profile-48k', rebindGameKey: '', deliveryId: ''
  });
  assert.equal(posted.at(-1)._emuguiRes, true);
  assert.equal(posted.at(-1).persisted, 'shared');
});
