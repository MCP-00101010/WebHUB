const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

function makeBookmark(id, url, extra = {}) {
  return { type: 'bookmark', id, title: id, url, tags: [], faviconCache: '', ...extra };
}

function makeFixture() {
  const now = Date.now();
  const bookmarks = {
    essential: makeBookmark(`essential-${now - 9000}`, 'https://essential.example/'),
    speedDial: makeBookmark(`speed-${now - 8000}`, 'https://speed.example/'),
    migrated: makeBookmark(`migrated-${now - 7000}`, 'https://s.to/watch/alpha?episode=4#resume'),
    tracked: makeBookmark(`tracked-${now - 6000}`, 'https://www.example.com/page/?utm_source=news&id=7#part'),
    locked: makeBookmark(`locked-${now - 5000}`, 'https://s.to/private', { locked: true }),
    inboxDuplicate: makeBookmark(`inbox-${now - 4000}`, 'https://www.example.com/page?id=7'),
    tabTwo: makeBookmark(`tab-two-${now - 3000}`, 'https://tab-two.example/'),
    imported: makeBookmark(`import-${now - 2000}`, 'https://import.example/'),
    setDuplicate: makeBookmark(`set-${now - 1000}`, 'https://www.example.com/page/?id=7&utm_medium=email#other'),
    dynamicFolderChild: makeBookmark('dynamic-folder-child', 'https://should-not-appear.example/'),
    dynamicSetChild: makeBookmark('dynamic-set-child', 'https://should-not-appear-set.example/')
  };

  const firstColumn = {
    id: 'column-1',
    title: 'Reading',
    items: [
      bookmarks.migrated,
      bookmarks.tracked,
      bookmarks.locked,
      { type: 'widget', id: 'widget-1', widgetType: 'clock', title: 'Desk Clock' },
      { type: 'folder', id: 'dynamic-folder', title: 'Dynamic', folderMode: 'dynamic', children: [bookmarks.dynamicFolderChild] }
    ]
  };
  const tabOne = {
    id: 'tab-1',
    title: 'Main',
    columns: [firstColumn],
    inbox: { id: 'inbox-1', items: [bookmarks.inboxDuplicate] }
  };
  const tabTwo = {
    id: 'tab-2',
    title: 'Later',
    columns: [{ id: 'column-2', title: 'Later', items: [bookmarks.tabTwo] }],
    inbox: { id: 'inbox-2', items: [] }
  };
  const board = {
    id: 'board-1',
    title: 'Personal',
    speedDial: [bookmarks.speedDial],
    tabs: [tabOne, tabTwo],
    // Legacy aliases can point at the active tab. The canonical collector must not double count them.
    columns: tabOne.columns,
    inbox: tabOne.inbox
  };
  const state = {
    essentials: [bookmarks.essential],
    boards: [board],
    activeBoardId: board.id,
    activeTabId: tabOne.id,
    importManager: { items: [bookmarks.imported] },
    sets: [
      { id: 'set-1', title: 'Manual', mode: 'manual', items: [bookmarks.setDuplicate] },
      { id: 'set-2', title: 'Dynamic', mode: 'dynamic', items: [bookmarks.dynamicSetChild] }
    ]
  };
  return { state, bookmarks, now };
}

function loadBookmarkTools(fixture, healthResponses = {}) {
  const storage = new Map();
  const source = fs.readFileSync(path.join(ROOT, 'source', 'bookmark-tools.js'), 'utf8');
  const coreMarker = source.indexOf('// --- Phase 1 UI ---');
  assert(coreMarker > 0, 'bookmark-tools core/UI marker should exist');

  const context = vm.createContext({
    state: fixture.state,
    console,
    URL,
    Date,
    Math,
    Promise,
    Set,
    Map,
    WeakSet,
    AbortController,
    structuredClone,
    localStorage: {
      getItem(key) { return storage.has(key) ? storage.get(key) : null; },
      setItem(key, value) { storage.set(key, String(value)); },
      removeItem(key) { storage.delete(key); }
    },
    isDynamicFolder(item) { return item?.folderMode === 'dynamic'; },
    isDynamicSet(set) { return set?.mode === 'dynamic'; },
    getBoardTabs(board) { return board.tabs || []; },
    getBoardInbox(_board, tab) { return tab.inbox; },
    updateBookmarkActivitySettingsUi() {},
    bridge: {
      async checkUrl(url) {
        const response = healthResponses[url];
        if (response instanceof Error) throw response;
        return response || { reachable: true, status: 200, finalUrl: url };
      }
    }
  });
  vm.runInContext(source.slice(0, coreMarker), context, { filename: 'bookmark-tools.js' });
  return { context, storage };
}

(async () => {
  const fixture = makeFixture();
  const { context, storage } = loadBookmarkTools(fixture);

  const inventory = context.collectStoredBookmarks(fixture.state);
  assert.strictEqual(inventory.length, 9, 'all real storage surfaces should be collected once');
  assert(!inventory.some(entry => entry.item === fixture.bookmarks.dynamicFolderChild), 'dynamic folder projections should not be treated as stored bookmarks');
  assert(!inventory.some(entry => entry.item === fixture.bookmarks.dynamicSetChild), 'dynamic Set projections should not be treated as stored bookmarks');
  assert.strictEqual(inventory.filter(entry => entry.item === fixture.bookmarks.tracked).length, 1, 'legacy board aliases must not double count active-tab bookmarks');
  assert(inventory.some(entry => entry.area === 'inbox' && entry.tabId === 'tab-1'), 'tab inboxes should retain scope metadata');
  assert(inventory.some(entry => entry.area === 'set' && entry.setId === 'set-1'), 'manual Sets should retain scope metadata');

  assert.strictEqual(
    context.replaceExactUrlHostname('https://s.to/watch/alpha?episode=4#resume', 's.to', 'serienstream.to'),
    'https://serienstream.to/watch/alpha?episode=4#resume',
    'host replacement should preserve path, query, and fragment byte-for-byte'
  );
  assert.strictEqual(context.replaceExactUrlHostname('https://not-s.to/watch', 's.to', 'serienstream.to'), '', 'lookalike hostnames must not match');
  const migration = context.planBookmarkHostMigration('s.to', 'serienstream.to', { root: fixture.state });
  assert.strictEqual(migration.length, 1, 'locked bookmarks should be excluded from migration plans');
  assert.strictEqual(migration[0].entry.item, fixture.bookmarks.migrated);
  assert.strictEqual(migration[0].newUrl, 'https://serienstream.to/watch/alpha?episode=4#resume');
  assert.strictEqual(
    context.planBookmarkHostMigration('s.to', 'serienstream.to', { root: fixture.state, scope: 'active-tab', activeTabId: 'tab-2' }).length,
    0,
    'migration scope should be enforced'
  );

  const cleaned = context.removeTrackingParametersFromUrl(fixture.bookmarks.tracked.url);
  assert.strictEqual(cleaned, 'https://www.example.com/page/?id=7#part', 'tracking cleanup should preserve functional query parameters and fragments');
  const cleanupPlan = context.planTrackingParameterCleanup(undefined, { root: fixture.state });
  assert.strictEqual(cleanupPlan.length, 2, 'both unlocked URLs containing tracking parameters should be previewed');
  assert(cleanupPlan.every(change => !change.newUrl.includes('utm_')));

  const duplicateGroups = context.findBookmarkDuplicateGroups({ root: fixture.state });
  assert.strictEqual(duplicateGroups.length, 1, 'equivalent URLs should form one duplicate group');
  assert.strictEqual(duplicateGroups[0].entries.length, 3, 'fragment, tracking, and trailing-slash variants should normalize together');
  context.ignoreBookmarkDuplicateGroup(duplicateGroups[0].normalizedUrl);
  assert.strictEqual(context.findBookmarkDuplicateGroups({ root: fixture.state }).length, 0, 'ignored duplicate groups should stay hidden locally');
  assert.strictEqual(context.findBookmarkDuplicateGroups({ root: fixture.state, includeIgnored: true }).length, 1, 'ignored groups should remain discoverable when explicitly requested');
  assert.strictEqual(context.findBookmarkDuplicateGroups({ root: fixture.state, includeIgnored: true, keepFragment: true }).length, 0, 'fragment handling should be configurable');

  const firstOpen = fixture.now + 1000;
  assert.strictEqual(context.recordBookmarkOpen(fixture.bookmarks.migrated, firstOpen), true);
  assert.strictEqual(context.recordBookmarkOpen(fixture.bookmarks.migrated, firstOpen + 1000), true);
  assert.strictEqual(context.recordBookmarkOpen(fixture.bookmarks.tracked, firstOpen + 500), true);
  const activity = context.getBookmarkActivityState();
  assert.strictEqual(activity.bookmarks[fixture.bookmarks.migrated.id].openCount, 2);
  assert.strictEqual(activity.bookmarks[fixture.bookmarks.migrated.id].lastOpenedAt, firstOpen + 1000);
  assert(storage.has('morpheus-webhub-bookmark-activity-v1'), 'activity metadata should be persisted in browser-local storage');
  assert(!JSON.stringify(fixture.state).includes('openCount'), 'activity metadata must not leak into synced Hub state');
  activity.bookmarks.stale = { firstSeenAt: 1, lastOpenedAt: null, openCount: 0, recent: [] };
  context.syncBookmarkActivityInventory(fixture.state);
  assert.strictEqual(activity.bookmarks.stale, undefined, 'activity records for deleted IDs should be cleaned up');

  const mostUsed = context.getSmartViewResults('most-used', { root: fixture.state, now: firstOpen + 3000, days: 'all' });
  assert.strictEqual(mostUsed[0].entry.item, fixture.bookmarks.migrated, 'Most Used should sort by open count');
  const recent = context.getSmartViewResults('recent', { root: fixture.state, now: firstOpen + 3000, days: 'all' });
  assert.strictEqual(recent[0].entry.item, fixture.bookmarks.migrated, 'Recently Opened should sort by most recent timestamp');
  activity.bookmarks[fixture.bookmarks.tracked.id].lastOpenedAt = firstOpen - (100 * 86400000);
  activity.bookmarks[fixture.bookmarks.tracked.id].openCount = 1;
  const neglected = context.getSmartViewResults('neglected', { root: fixture.state, now: firstOpen + 3000, days: 90 });
  assert(neglected.some(result => result.entry.item === fixture.bookmarks.tracked), 'Neglected should include bookmarks opened before the configured threshold');
  assert(!neglected.some(result => result.entry.item === fixture.bookmarks.migrated), 'Neglected should exclude recently opened bookmarks');
  const neverOpened = context.getSmartViewResults('never-opened', { root: fixture.state, now: firstOpen + 3000, days: 'all' });
  assert(!neverOpened.some(result => result.entry.item === fixture.bookmarks.migrated));
  assert.strictEqual(context.getEssentialsViewId(), 'essentials', 'Essentials should remain the default sidebar view');
  assert.strictEqual(context.setEssentialsView('most-used', { render: false }), 'most-used');
  assert.strictEqual(context.cycleEssentialsView(1), 'neglected', 'the compact switcher should cycle forward through activity views');
  assert.strictEqual(context.cycleEssentialsView(-1), 'most-used', 'the compact switcher should cycle backward through activity views');
  assert.strictEqual(context.getEssentialsActivityResults('neglected', { root: fixture.state, now: firstOpen + 3000, limit: 10 }).length, 1);
  assert.strictEqual(context.getBookmarkActivityState().essentialsView, 'most-used', 'the selected sidebar view should remain in browser-local activity state');
  context.setBookmarkActivityTrackingEnabled(false);
  assert.strictEqual(context.recordBookmarkOpen(fixture.bookmarks.imported, firstOpen + 4000), false, 'disabled activity tracking should not record opens');
  context.clearBookmarkActivityStatistics(fixture.state);
  assert.strictEqual(context.getBookmarkActivityState().bookmarks[fixture.bookmarks.migrated.id].openCount, 0, 'clearing activity should retain inventory records but reset statistics');
  assert.strictEqual(context.getBookmarkActivityState().trackingEnabled, false, 'clearing statistics should preserve the privacy toggle');

  const healthFixture = makeFixture();
  const redirectUrl = healthFixture.bookmarks.tracked.url;
  const brokenUrl = healthFixture.bookmarks.imported.url;
  const restrictedUrl = healthFixture.bookmarks.tabTwo.url;
  const loaded = loadBookmarkTools(healthFixture, {
    [redirectUrl]: { reachable: true, status: 200, finalUrl: 'https://www.example.com/new-page?id=7' },
    [brokenUrl]: { reachable: false, status: 503, finalUrl: brokenUrl, error: 'Service Unavailable' },
    [restrictedUrl]: { reachable: true, status: 403, finalUrl: restrictedUrl }
  });
  const selected = loaded.context.collectStoredBookmarks(healthFixture.state).filter(entry => [redirectUrl, brokenUrl, restrictedUrl].includes(entry.item.url));
  const progress = [];
  const health = await loaded.context.runBookmarkHealthScan(selected, { concurrency: 2, onProgress: value => progress.push(value.completed) });
  assert.strictEqual(health.length, 3);
  assert.strictEqual(progress.length, 3, 'health scans should report progress for each unique URL');
  assert.strictEqual(health.find(result => result.url === redirectUrl).state, 'redirected');
  assert.strictEqual(health.find(result => result.url === brokenUrl).state, 'http-error');
  assert.strictEqual(health.find(result => result.url === restrictedUrl).state, 'restricted');
  assert.strictEqual(loaded.context.classifyBookmarkHealthResult({ available: false, errorType: 'relay', error: 'bridge error' }, redirectUrl), 'unavailable', 'relay capability failures must not be reported as broken bookmarks');
  assert.strictEqual(loaded.context.getSmartViewResults('redirected', { root: healthFixture.state, days: 'all' }).length, 1);
  assert.strictEqual(loaded.context.getSmartViewResults('broken', { root: healthFixture.state, days: 'all' }).length, 1);

  const cancellationFixture = makeFixture();
  const cancellation = loadBookmarkTools(cancellationFixture);
  cancellation.context.bridge.checkUrl = () => new Promise(() => {});
  const controller = new AbortController();
  const scanPromise = cancellation.context.runBookmarkHealthScan(cancellation.context.collectStoredBookmarks(cancellationFixture.state), { signal: controller.signal, concurrency: 4 });
  controller.abort();
  assert.deepStrictEqual(Array.from(await scanPromise), [], 'cancelling a health scan should release active workers without waiting for relay timeouts');

  const commandSource = fs.readFileSync(path.join(ROOT, 'source', 'command-palette.js'), 'utf8');
  const commandContext = vm.createContext({
    state: fixture.state,
    localStorage: { getItem() { return null; }, setItem() {} },
    SMART_VIEW_DEFINITIONS: [{ id: 'recent', label: 'Recently Opened' }],
    WIDGET_REGISTRY: { clock: { name: 'Clock', category: 'Information', allowedIn: ['column'] } },
    WIDGET_CATEGORY_ORDER: ['Information'],
    getBoardTabs(board) { return board.tabs || []; },
    getBoardInbox(_board, tab) { return tab.inbox; },
    isDynamicFolder(item) { return item?.folderMode === 'dynamic'; },
    collectStoredBookmarks: context.collectStoredBookmarks,
    resolveTag() { return null; },
    resolveSetItems(set) { return set.items || []; }
  });
  vm.runInContext(commandSource, commandContext, { filename: 'command-palette.js' });
  assert(commandContext.scoreCommandPaletteEntry({ label: 'Open Bookmark Maintenance', detail: '', keywords: '' }, 'maintenance') > 0);
  assert(commandContext.scoreCommandPaletteEntry({ label: 'Recently Opened', detail: '', keywords: '' }, 'rcnt opnd') > 0, 'palette matching should tolerate subsequences');
  assert.strictEqual(commandContext.scoreCommandPaletteEntry({ label: 'Settings', detail: '', keywords: '' }, 'zzzzzz'), 0);
  const paletteEntries = Array.from(commandContext.buildCommandPaletteEntries());
  assert(paletteEntries.some(entry => entry.group === 'Folders' && entry.label === 'Dynamic'), 'palette should index folders');
  assert(paletteEntries.some(entry => entry.group === 'Widgets' && entry.label === 'Desk Clock'), 'palette should index placed widgets');
  assert(paletteEntries.some(entry => entry.group === 'Settings' && entry.label === 'UI Settings'), 'palette should index settings pages');
  assert(paletteEntries.some(entry => entry.group === 'Actions' && entry.label === 'Add Clock Widget'), 'palette should index available widget actions');
  const contextualActions = Array.from(commandContext._commandPaletteFilteredEntries('edit migrated'));
  assert(contextualActions.some(entry => entry.group === 'Bookmark Actions' && entry.label.startsWith('Edit:')), 'palette should expose contextual bookmark actions');

  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  for (const requiredId of ['hubToolsPanel', 'hubToolsBody', 'commandPaletteOverlay', 'commandPaletteInput', 'stgBookmarkActivityTracking', 'stgBookmarkActivityExport', 'essentialsViewPreviousBtn', 'essentialsViewMenuBtn', 'essentialsViewMenu', 'essentialsViewNextBtn', 'essentialsSmartViewsBtn', 'searchSmartViewsBtn']) {
    assert(html.includes(`id="${requiredId}"`), `index should provide #${requiredId}`);
  }
  assert(html.includes('data-hub-tools-tab="smart"'));
  assert(html.includes('data-hub-tools-tab="maintenance"'));
  assert(html.indexOf('source/bookmark-tools.js') < html.indexOf('source/command-palette.js'));
  assert(html.indexOf('source/command-palette.js') < html.indexOf('source/app.js'));
  assert(!html.includes('id="quickSettingsBtn"'), 'the redundant Settings icon should not force the sidebar action bar onto a second row');
  const appSource = fs.readFileSync(path.join(ROOT, 'source', 'app.js'), 'utf8');
  assert(appSource.includes("document.getElementById('aboutBtn').addEventListener('click', () => showSettingsPanel('about'))"), 'the version button should remain the sidebar Settings entry point');

  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension', 'manifest.json'), 'utf8'));
  assert.strictEqual(manifest.commands['open-command-palette'].suggested_key.default, 'Ctrl+Shift+K');
  const background = fs.readFileSync(path.join(ROOT, 'extension', 'background.js'), 'utf8');
  const content = fs.readFileSync(path.join(ROOT, 'extension', 'content.js'), 'utf8');
  const bridge = fs.readFileSync(path.join(ROOT, 'source', 'bridge.js'), 'utf8');
  assert(background.includes("case 'MW_CHECK_URL':"), 'background should expose bounded URL checks');
  assert(background.includes("command !== 'open-command-palette'"), 'background should route the extension shortcut');
  assert(content.includes("'MW_OPEN_COMMAND_PALETTE'"), 'content relay should forward palette push messages');
  assert(bridge.includes("async checkUrl(url)"), 'page bridge should expose URL health checks');
  assert(bridge.includes("errorType: res.errorType || ''"), 'page bridge should preserve health failure categories');
  assert(bridge.includes("supports(capability)"), 'page bridge should expose extension capability negotiation');
  for (const sourceFile of ['render-items.js', 'sets.js', 'import.js', 'context.js']) {
    const source = fs.readFileSync(path.join(ROOT, 'source', sourceFile), 'utf8');
    assert(source.includes('openHubBookmark'), `${sourceFile} should use the central bookmark-opening path`);
  }
  const renderSource = fs.readFileSync(path.join(ROOT, 'source', 'render.js'), 'utf8');
  assert(renderSource.includes('recordBookmarkOpen'), 'search and rendered shortcuts should record activity through the central tracker');
  const activityRenderer = renderSource.slice(renderSource.indexOf('function _renderEssentialsActivityView'), renderSource.indexOf('function renderEssentials'));
  assert(activityRenderer.includes('getEssentialsActivityResults'), 'Essentials activity modes should reuse Smart View activity results');
  assert(activityRenderer.includes('handleEssentialsActivityContextMenu'), 'activity tiles should expose read-only open and locate actions');
  assert(!/link\.draggable\s*=\s*true/.test(activityRenderer), 'activity results should not become reorderable Essentials slots');
  assert(renderSource.includes('function getBookmarkFaviconResolutionState'), 'favicon maintenance should share the renderer\'s effective resolution state');
  const bookmarkToolsSource = fs.readFileSync(path.join(ROOT, 'source', 'bookmark-tools.js'), 'utf8');
  assert(bookmarkToolsSource.includes('initializeEssentialsViewControls'), 'the Essentials mode picker should initialize keyboard and cycling controls');
  const bookmarkToolsStyles = fs.readFileSync(path.join(ROOT, 'source', 'bookmark-tools.css'), 'utf8');
  assert(bookmarkToolsStyles.includes('.essentials-view-menu') && bookmarkToolsStyles.includes('.essentials-activity-empty'), 'the compact picker and activity empty states should be styled');
  assert(bookmarkToolsSource.includes('inspectStoredBookmarkFavicons'), 'favicon repair should run an explicit bounded inspection');
  assert(!bookmarkToolsSource.includes('collectStoredBookmarks().filter(entry => !entry.item.faviconCache)'), 'maintenance counts must not equate an empty persisted cache with a missing displayed icon');
  assert(commandSource.includes("event.key !== 'Tab'") && commandSource.includes('focusable[focusable.length - 1]'), 'palette should trap keyboard focus');
  assert(commandSource.includes('invalidateCommandPaletteIndex'), 'palette should expose derived-index invalidation');

  console.log('Phase 1 feature tests passed.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
