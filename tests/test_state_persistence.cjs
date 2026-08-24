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

function loadStateScript() {
  const storage = new Map();
  const saves = [];
  const bridge = {
    isAvailable: () => true,
    nativeIsAvailable: () => true,
    saveState: (snapshot, options) => {
      const pending = deferred();
      saves.push({ snapshot, options, pending });
      return pending.promise;
    }
  };
  const context = vm.createContext({
    bridge,
    console,
    structuredClone,
    getResolvedThemeId: value => value || 'default-dark',
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: key => storage.delete(key)
    },
    window: {
      innerWidth: 1600,
      dispatchEvent: () => {}
    },
    CustomEvent: class CustomEvent {
      constructor(type, options) { this.type = type; this.detail = options?.detail; }
    },
    setTimeout,
    clearTimeout
  });
  const schemaFilename = path.join(__dirname, '..', 'source', 'state-schema.js');
  vm.runInContext(fs.readFileSync(schemaFilename, 'utf8'), context, { filename: schemaFilename });
  const filename = path.join(__dirname, '..', 'source', 'state.js');
  vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  return { context, saves, storage };
}

test('page debounce resolves every covered save only after latest snapshot persists', async () => {
  const harness = loadStateScript();
  harness.context.setSharedDiskBaseline({ version: 'v1', contentHash: 'h1' }, '/hub.json');
  vm.runInContext("state.databasePath = '/hub.json'", harness.context);

  const first = vm.runInContext("state.hubName = 'First'; saveState()", harness.context);
  const second = vm.runInContext("state.hubName = 'Second'; saveState()", harness.context);
  await new Promise(resolve => setTimeout(resolve, 300));

  assert.equal(harness.saves.length, 1);
  assert.equal(JSON.parse(harness.saves[0].snapshot).hubName, 'Second');
  assert.equal(harness.saves[0].options.expectedVersion, 'v1');
  assert.equal(harness.saves[0].options.expectedHash, 'h1');

  harness.saves[0].pending.resolve({
    ok: true,
    conflict: false,
    databasePath: '/hub.json',
    fileInfo: { version: 'v2', contentHash: 'h2' }
  });
  assert.equal((await first).fileInfo.version, 'v2');
  assert.equal((await second).fileInfo.version, 'v2');

  const third = vm.runInContext("state.hubName = 'Third'; saveState()", harness.context);
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(harness.saves[1].options.expectedVersion, 'v2');
  assert.equal(harness.saves[1].options.expectedHash, 'h2');
  harness.saves[1].pending.resolve({
    ok: true,
    conflict: false,
    databasePath: '/hub.json',
    fileInfo: { version: 'v3', contentHash: 'h3' }
  });
  await third;
});

test('snapshot comparison ignores JSON formatting and object property order', () => {
  const harness = loadStateScript();
  const compact = '{"boards":[{"id":"one","items":[1,2]}],"settings":{"theme":"red","enabled":true}}';
  const reformatted = JSON.stringify({ settings: { enabled: true, theme: 'red' }, boards: [{ items: [1, 2], id: 'one' }] }, null, 2);
  const changed = JSON.stringify({ settings: { enabled: true, theme: 'red' }, boards: [{ items: [2, 1], id: 'one' }] }, null, 2);

  assert.equal(harness.context.snapshotsMatch(compact, reformatted), true);
  assert.equal(harness.context.snapshotsMatch(compact, changed), false);
  assert.equal(harness.context.snapshotsMatch(compact, '{not-json'), false);
});

test('transient Inbox and Import Manager items discard lock flags', () => {
  const harness = loadStateScript();
  const normalizedImport = harness.context.normalizeImportManagerState({
    items: [{ id: 'folder', type: 'folder', locked: true, children: [{ id: 'bookmark', type: 'bookmark', locked: true }] }]
  });
  const normalizedInbox = harness.context.normalizeBoardInboxRecord({
    items: [{ id: 'inbox-bookmark', type: 'bookmark', locked: true }]
  }, 'tab-1');

  assert.equal('locked' in normalizedImport.items[0], false);
  assert.equal('locked' in normalizedImport.items[0].children[0], false);
  assert.equal('locked' in normalizedInbox.items[0], false);
});

test('application items receive portable normalized fields without a native path', () => {
  const harness = loadStateScript();
  const item = vm.runInContext(`(() => {
    const values = [{ id: 'legacy-app', type: 'application', title: '', tags: null, nativePath: 'C:/unsafe.exe' }];
    migrateItems(values);
    return values[0];
  })()`, harness.context);

  assert.equal(item.type, 'application');
  assert.equal(item.title, 'Application');
  assert.match(item.appKey, /^app_[A-Za-z0-9_-]{12,75}$/);
  assert.deepEqual([...item.tags], []);
  assert.equal('nativePath' in item, false);
});

test('widget Inbox moves preserve identity, reject duplicates, and restore through Undo snapshots', () => {
  const harness = loadStateScript();
  const cacheKey = 'morpheus-widget-sdk-cache:v1:clock:widget-column:view';
  harness.storage.set(cacheKey, JSON.stringify({ zonePickerOpen: true }));
  const result = vm.runInContext(`(() => {
    WIDGET_REGISTRY = {
      clock: { allowedIn: ['column', 'navpane'] },
      navOnly: { allowedIn: ['navpane'] }
    };
    const columnWidget = { id: 'widget-column', type: 'widget', widgetType: 'clock', title: 'Clock', config: { zone: 'UTC' }, data: { portable: true } };
    const navWidget = { id: 'widget-nav', type: 'widget', widgetType: 'clock', title: 'Nav clock', config: { sidebarBottom: true }, data: {} };
    const navOnlyWidget = { id: 'widget-nav-only', type: 'widget', widgetType: 'navOnly', title: 'Nav only', config: {}, data: {} };
    const makeTab = (id, columnItems = []) => ({
      id, title: id, columns: [{ id: id + '-column', items: columnItems }],
      inbox: { id: id + '-inbox', title: 'Inbox', isInbox: true, items: [] }
    });
    state = {
      ...state,
      activeBoardId: 'board-a', activeTabId: 'tab-a',
      navItems: [navWidget, navOnlyWidget],
      boards: [
        { id: 'board-a', title: 'Board A', tabs: [makeTab('tab-a', [columnWidget])] },
        { id: 'board-b', title: 'Board B', tabs: [makeTab('tab-b')] }
      ]
    };
    syncBoardCompatibilityState();
    const undoSnapshot = JSON.stringify(state);
    let undoCaptures = 0;
    const sameTab = moveWidgetToTabInbox('widget-column', 'board-a', 'tab-a', { beforeMove: () => { undoCaptures += 1; } });
    const duplicate = moveWidgetToTabInbox('widget-column', 'board-a', 'tab-a', { beforeMove: () => { undoCaptures += 1; } });
    const missing = moveWidgetToTabInbox('widget-nav', 'missing-board', 'missing-tab');
    state.boards[1].locked = true;
    const locked = moveWidgetToTabInbox('widget-nav', 'board-b', 'tab-b');
    state.boards[1].locked = false;
    const unsupported = moveWidgetToTabInbox('widget-nav-only', 'board-b', 'tab-b');
    const crossBoard = moveWidgetToTabInbox('widget-nav', 'board-b', 'tab-b', { beforeMove: () => { undoCaptures += 1; } });
    const moved = state.boards[0].tabs[0].inbox.items[0];
    const crossMoved = state.boards[1].tabs[0].inbox.items[0];
    const counts = getBoardInboxCounts(state.boards[0], state.boards[0].tabs[0]);
    restoreStateSnapshot(undoSnapshot);
    return {
      sameTab: sameTab.ok,
      duplicateReason: duplicate.reason,
      missingReason: missing.reason,
      lockedReason: locked.reason,
      unsupportedReason: unsupported.reason,
      crossBoard: crossBoard.ok,
      undoCaptures,
      sameTabColumnCount: sameTab.source.container.items.length,
      movedId: moved.id,
      movedZone: moved.config.zone,
      crossMovedId: crossMoved.id,
      counts,
      restoredColumnIds: state.boards[0].tabs[0].columns[0].items.map(item => item.id),
      restoredInboxIds: state.boards[0].tabs[0].inbox.items.map(item => item.id),
      restoredNavWidgetIds: state.navItems.filter(item => item.type === 'widget').map(item => item.id)
    };
  })()`, harness.context);

  assert.equal(result.sameTab, true);
  assert.equal(result.duplicateReason, 'same-destination');
  assert.equal(result.missingReason, 'missing-destination');
  assert.equal(result.lockedReason, 'locked-destination');
  assert.equal(result.unsupportedReason, 'unsupported-placement');
  assert.equal(result.crossBoard, true);
  assert.equal(result.undoCaptures, 2);
  assert.equal(result.sameTabColumnCount, 0);
  assert.equal(result.movedId, 'widget-column');
  assert.equal(result.movedZone, 'UTC');
  assert.equal(result.crossMovedId, 'widget-nav');
  assert.deepEqual(JSON.parse(JSON.stringify(result.counts)), { bookmarks: 0, applications: 0, folders: 0, widgets: 1 });
  assert.deepEqual(JSON.parse(JSON.stringify(result.restoredColumnIds)), ['widget-column']);
  assert.deepEqual(JSON.parse(JSON.stringify(result.restoredInboxIds)), []);
  assert.deepEqual(JSON.parse(JSON.stringify(result.restoredNavWidgetIds)), ['widget-nav', 'widget-nav-only']);
  assert.equal(harness.storage.get(cacheKey), JSON.stringify({ zonePickerOpen: true }));
});

test('selected bookmark collection preserves tree order', () => {
  const harness = loadStateScript();
  const items = [
    { id: 'one', type: 'bookmark' },
    { id: 'folder', type: 'folder', children: [{ id: 'two', type: 'bookmark' }] },
    { id: 'three', type: 'bookmark' }
  ];
  const selected = harness.context.collectSelectedBookmarksInTree(new Set(['three', 'one', 'two']), items);
  assert.deepEqual(JSON.parse(JSON.stringify(selected.map(item => item.id))), ['one', 'two', 'three']);
});

test('state loading repairs orphaned boards instead of deleting them', () => {
  const harness = loadStateScript();
  const saved = JSON.stringify({
    hubName: 'Recovered hub',
    boards: [{ id: 'orphan', title: 'Important Board', tabs: [] }],
    navItems: [],
    settings: {},
    essentials: []
  });
  const parsed = harness.context.parseStateJson(saved);
  assert.equal(parsed.boards.length, 1);
  assert.equal(parsed.boards[0].id, 'orphan');
  assert.equal(parsed.navItems.some(item => item.boardId === 'orphan'), true);
  assert.equal(parsed.schemaVersion, 3);
});

test('persisted snapshots omit active-tab board compatibility aliases', () => {
  const harness = loadStateScript();
  const snapshot = JSON.parse(harness.context.serializeStateSnapshot());
  assert.equal(snapshot.schemaVersion, 3);
  assert.equal(Array.isArray(snapshot.boards[0].tabs[0].columns), true);
  assert.equal('columns' in snapshot.boards[0], false);
  assert.equal('inbox' in snapshot.boards[0], false);
  assert.equal('backgroundImage' in snapshot.boards[0], false);
});
