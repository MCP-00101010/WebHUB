const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

test('Import Manager delivery rebases once and deduplicates retries by delivery ID', async () => {
  const state = { importManager: { items: [], lastImportedAt: null } };
  let prepareCalls = 0;
  let saveCalls = 0;
  let mutationSequence = 0;
  let reloadCalls = 0;
  const context = vm.createContext({
    state,
    console,
    Date,
    Math,
    bridge: { nativeIsAvailable: () => true },
    isValidUrl: () => true,
    normalizeUrl: value => value,
    createFolderRecord: (title, options) => ({ type: 'folder', title, ...options }),
    prepareForExternalDelivery: async () => { prepareCalls += 1; return { ok: true }; },
    pushUndoSnapshot: () => {},
    renderImportManagerPanel: () => {},
    showImportManagerPanel: () => {},
    showNotice: () => {},
    getImportManagerCounts: () => ({ bookmarks: state.importManager.items.length, folders: 0 }),
    getLocalStateMutationSequence: () => mutationSequence,
    saveState: async () => {
      saveCalls += 1;
      mutationSequence += 1;
      return saveCalls === 1 ? { ok: false, conflict: true } : { ok: true, persisted: 'shared' };
    },
    awaitExternalDeliverySave: promise => promise,
    reloadHubData: async () => {
      reloadCalls += 1;
      state.importManager = { items: [], lastImportedAt: null };
      return true;
    }
  });
  const filename = path.join(__dirname, '..', 'source', 'import.js');
  vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  context.renderImportManagerPanel = () => {};
  context.showImportManagerPanel = () => {};
  context.getImportManagerCounts = () => ({ bookmarks: state.importManager.items.length, folders: 0 });

  const payload = [{ type: 'bookmark', title: 'Example', url: 'https://example.com' }];
  const first = await context.receiveExternalImportItems(payload, { deliveryId: 'delivery-42' });
  assert.equal(first.ok, true);
  assert.equal(reloadCalls, 1);
  assert.equal(saveCalls, 2);
  assert.equal(state.importManager.items.length, 1);
  assert.equal(state.importManager.items[0].id, 'bm-import-delivery-delivery-42-0');

  const retry = await context.receiveExternalImportItems(payload, { deliveryId: 'delivery-42' });
  assert.equal(retry.ok, true);
  assert.equal(retry.duplicate, true);
  assert.equal(saveCalls, 2);
  assert.equal(state.importManager.items.length, 1);
  assert.equal(prepareCalls, 2);
});

test('shared polling uses semantic snapshots and startup rejects an empty successful read', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'source', 'app.js'), 'utf8');
  assert.match(app, /snapshotsMatch\(liveJson, currentJson\)/);
  assert.match(app, /!loaded\?\.json && loaded\?\.fileInfo\?\.exists !== false/);
  assert.match(app, /The shared database returned no hub data/);
});

test('external Inbox delivery immediately refreshes the active board tab indicators', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'source', 'app.js'), 'utf8');
  const delivery = app.match(/async function persistExternalTabDelivery[\s\S]*?function summarizeHubSnapshot/)?.[0] || '';
  assert.match(delivery, /renderNav\(\);\s*renderBoardTabBar\(getActiveBoard\(\), getActiveTab\(\)\);\s*updateInboxBadge\(\);/);
});
