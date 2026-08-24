const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

test('shared database is transferred to the page in bounded chunks', async () => {
  const source = JSON.stringify({
    hubName: 'Chunked hub',
    payload: 'x'.repeat(700000)
  });
  const sourceBytes = Buffer.from(source);
  const windowListeners = new Map();
  const requests = [];
  let pingCount = 0;

  const window = {
    location: { href: 'file:///hub/index.html' },
    addEventListener(type, listener) {
      const listeners = windowListeners.get(type) || [];
      listeners.push(listener);
      windowListeners.set(type, listeners);
    },
    dispatchEvent: () => {},
    postMessage(message) {
      if (!message?._req) return;
      requests.push(message);
      let response;
      if (message.type === 'MW_PING') {
        pingCount++;
        if (pingCount === 1) {
          setImmediate(() => {
            for (const listener of (windowListeners.get('message') || [])) {
              listener({ source: window, data: { _mw: true, _relayReady: true } });
            }
          });
          return;
        }
        response = { ok: true, nativeAvailable: true, databasePath: 'C:\\hub.json' };
      } else if (message.type === 'MW_LOAD_SHARED_CHUNK') {
        const end = Math.min(sourceBytes.length, message.offset + message.length);
        response = {
          ok: true,
          chunk: sourceBytes.subarray(message.offset, end).toString('base64'),
          nextOffset: end,
          totalSize: sourceBytes.length,
          done: end >= sourceBytes.length,
          databasePath: 'C:\\hub.json',
          fileInfo: { exists: true, version: 'v1', contentHash: 'h1' }
        };
      } else {
        response = { ok: false, error: `Unexpected request: ${message.type}` };
      }
      setImmediate(() => {
        for (const listener of (windowListeners.get('message') || [])) {
          listener({
            source: window,
            data: { _mw: true, _res: true, id: message.id, ...response }
          });
        }
      });
    }
  };
  const context = vm.createContext({
    window,
    document: { hidden: false, hasFocus: () => true },
    console,
    atob: value => Buffer.from(value, 'base64').toString('binary'),
    TextDecoder,
    Uint8Array,
    setTimeout,
    clearTimeout
  });
  const filename = path.join(__dirname, '..', 'source', 'bridge.js');
  vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });

  await vm.runInContext('bridge.whenReady', context);
  const loaded = await vm.runInContext('bridge.loadState()', context);

  assert.equal(loaded.json, source);
  assert.equal(loaded.fromDisk, true);
  assert.equal(loaded.databasePath, 'C:\\hub.json');
  assert.equal(pingCount, 2);
  const chunks = requests.filter(request => request.type === 'MW_LOAD_SHARED_CHUNK');
  assert.equal(chunks.length, 3);
  assert.ok(chunks.every(request => request.length === 256 * 1024));
  assert.equal(requests.some(request => request.type === 'MW_LOAD'), false);
});

test('relay-ready reconnects after the initial bridge attempts have expired', async () => {
  const windowListeners = new Map();
  const dispatchedEvents = [];
  let relayAvailable = false;
  const window = {
    location: { href: 'file:///hub/index.html' },
    addEventListener(type, listener) {
      const listeners = windowListeners.get(type) || [];
      listeners.push(listener);
      windowListeners.set(type, listeners);
    },
    dispatchEvent(event) { dispatchedEvents.push(event); },
    postMessage(message) {
      if (!relayAvailable || !message?._req || message.type !== 'MW_PING') return;
      setImmediate(() => {
        for (const listener of (windowListeners.get('message') || [])) {
          listener({
            source: window,
            data: {
              _mw: true,
              _res: true,
              id: message.id,
              ok: true,
              nativeAvailable: true,
              databasePath: 'C:\\hub.json'
            }
          });
        }
      });
    }
  };
  const context = vm.createContext({
    window,
    document: { hidden: false, hasFocus: () => true },
    console,
    CustomEvent: class CustomEvent {
      constructor(type, options) { this.type = type; this.detail = options?.detail; }
    },
    atob: value => Buffer.from(value, 'base64').toString('binary'),
    TextDecoder,
    Uint8Array,
    setTimeout: (callback, delay) => setTimeout(callback, Math.min(delay, 5)),
    clearTimeout
  });
  const filename = path.join(__dirname, '..', 'source', 'bridge.js');
  vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });

  await vm.runInContext('bridge.whenReady', context);
  assert.equal(vm.runInContext('bridge.isAvailable()', context), false);

  relayAvailable = true;
  for (const listener of (windowListeners.get('message') || [])) {
    listener({ source: window, data: { _mw: true, _relayReady: true } });
  }
  await new Promise(resolve => setTimeout(resolve, 30));

  assert.equal(vm.runInContext('bridge.isAvailable()', context), true);
  assert.equal(vm.runInContext('bridge.nativeIsAvailable()', context), true);
  assert.equal(dispatchedEvents.at(-1)?.type, 'morpheus:bridge-ready');
  assert.equal(dispatchedEvents.at(-1)?.detail.nativeAvailable, true);
});

test('directory approval keeps the page request alive for the interactive picker', async () => {
  const windowListeners = new Map();
  const scheduledTimeouts = [];
  const window = {
    location: { href: 'file:///hub/index.html' },
    addEventListener(type, listener) {
      const listeners = windowListeners.get(type) || [];
      listeners.push(listener);
      windowListeners.set(type, listeners);
    },
    dispatchEvent: () => {},
    postMessage(message) {
      if (!message?._req) return;
      let response;
      if (message.type === 'MW_PING') response = { ok: true, nativeAvailable: true, capabilities: ['approvedDirectories', 'applicationLauncher'] };
      else if (message.type === 'MW_APPROVE_DIRECTORY') response = { ok: true, directory: { handle: 'dir_abcdefghijklmnop', label: 'Repository' } };
      else if (message.type === 'MW_APPROVE_APPLICATION') response = { ok: true, application: { appKey: 'app_abcdefghijklmnop', label: 'Editor', kind: 'executable', state: 'ready' } };
      else if (message.type === 'MW_GET_APPLICATION_STATUS') response = { ok: true, application: { appKey: message.appKey, label: 'Editor', kind: 'executable', state: 'ready' } };
      else if (message.type === 'MW_LAUNCH_APPROVED_APPLICATION') response = { ok: true };
      else response = { ok: false, error: 'No terminal application was found' };
      setImmediate(() => {
        for (const listener of (windowListeners.get('message') || [])) {
          listener({ source: window, data: { _mw: true, _res: true, id: message.id, ...response } });
        }
      });
    }
  };
  const context = vm.createContext({
    window,
    document: { hidden: false, hasFocus: () => true },
    console,
    atob: value => Buffer.from(value, 'base64').toString('binary'),
    TextDecoder,
    Uint8Array,
    setTimeout: (callback, delay, ...args) => {
      scheduledTimeouts.push(delay);
      return setTimeout(callback, delay, ...args);
    },
    clearTimeout
  });
  const filename = path.join(__dirname, '..', 'source', 'bridge.js');
  vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });

  await vm.runInContext('bridge.whenReady', context);
  scheduledTimeouts.length = 0;
  const directory = await vm.runInContext("bridge.approveDirectory('git', 'Approve repository')", context);

  assert.equal(directory.handle, 'dir_abcdefghijklmnop');
  assert.deepEqual(scheduledTimeouts, [305000]);
  assert.ok(scheduledTimeouts.every(Number.isFinite));
  scheduledTimeouts.length = 0;
  const application = await vm.runInContext("bridge.approveApplication('', 'Select application')", context);
  assert.equal(application.appKey, 'app_abcdefghijklmnop');
  assert.deepEqual(scheduledTimeouts, [305000]);
  assert.equal((await vm.runInContext("bridge.getApplicationStatus('app_abcdefghijklmnop')", context)).state, 'ready');
  assert.equal(await vm.runInContext("bridge.launchApplication('app_abcdefghijklmnop')", context), true);
  await assert.rejects(
    vm.runInContext("bridge.openApprovedDirectory('dir_abcdefghijklmnop', 'git', 'terminal')", context),
    /No terminal application was found/
  );
});
