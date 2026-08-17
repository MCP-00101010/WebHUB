const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'source', 'phase2-tools.js'), 'utf8');
const marker = source.indexOf('// --- Phase 2 UI ---');
assert(marker > 0, 'Phase 2 core/UI marker should exist');
const context = vm.createContext({ console, URL, Date, Math, Set, Map, structuredClone });
vm.runInContext(source.slice(0, marker), context, { filename: 'phase2-tools.js' });

const records = [
  { source: 'inbox', item: { id: 'a', type: 'bookmark', title: 'Read this', url: 'https://Example.com/story/?utm_source=x&id=1#top', tags: ['later'] } },
  { source: 'inbox', item: { id: 'b', type: 'bookmark', title: 'Duplicate', url: 'https://example.com/story?id=1', tags: [] } }
];
const rules = [
  {
    id: 'first', name: 'Clean and tag', stop: false,
    conditions: { hostname: 'example.com', source: 'inbox' },
    actions: { normalizeUrl: true, addTags: ['research'], titlePrefix: '[Web] ' }
  },
  {
    id: 'second', name: 'Route stories', stop: true,
    conditions: { urlText: '/story' },
    actions: { routeBoardId: 'board-2', routeTabId: 'tab-2' }
  },
  {
    id: 'never', name: 'Should not run',
    conditions: { hostname: 'example.com' }, actions: { titlePrefix: 'BAD ' }
  }
];
const evaluated = context.evaluateAutomationRules(records, rules, {
  knownUrls: ['https://unrelated.example/'],
  tagNameFor: value => value,
  destinationExists: (board, tab) => board === 'board-2' && tab === 'tab-2'
});
assert.deepStrictEqual([...evaluated[0].matchedRules], ['first', 'second'], 'continue/stop order should be deterministic');
assert.strictEqual(evaluated[0].proposed.title, '[Web] Read this');
assert.strictEqual(evaluated[0].proposed.url, 'https://example.com/story?id=1');
assert.strictEqual(evaluated[0].proposed.routeTabId, 'tab-2');
assert.strictEqual(evaluated[1].duplicate, true, 'duplicates inside one delivery should be detected');

const rejected = context.evaluateAutomationRules(records, [{
  id: 'duplicates', conditions: { duplicate: 'yes' }, actions: { rejectDuplicate: true }
}], { knownUrls: ['https://example.com/story?id=1'] });
assert.strictEqual(rejected[1].proposed.rejected, true);

const locked = context.evaluateAutomationRules([{ source: 'inbox', item: { type: 'bookmark', locked: true, title: 'Locked', url: 'https://example.com/story' } }], rules, { destinationExists: () => false });
assert(locked[0].conflicts.includes('Item is locked'));
assert(locked[0].conflicts.includes('Destination is missing'));

const session = context.sanitizeBrowserSession({
  id: 'saved', title: 'Work', windowId: 9,
  tabs: [
    { id: 11, windowId: 9, title: 'A', url: 'https://a.example/', pinned: true, group: { id: 3, title: 'Docs', color: 'blue' } },
    { id: 12, title: 'Internal', url: 'about:config' }
  ]
});
assert.strictEqual(session.tabs.length, 1);
assert(!JSON.stringify(session).includes('windowId'));
assert(!JSON.stringify(session).includes('"id":11'));
assert.strictEqual(context.dedupeSessionTabs([session.tabs[0], { ...session.tabs[0], url: 'https://a.example/#fragment' }]).length, 1);

const root = {
  schemaVersion: 2, databasePath: 'C:/private/hub.json', activeBoardId: 'board-1', activeTabId: 'tab-1',
  boards: [{ id: 'board-1', title: 'Home', tabs: [{ id: 'tab-1', title: 'Main', backgroundImage: 'file:///secret.jpg', columns: [], inbox: { id: 'inbox-1', items: [{ id: 'bm-1', type: 'bookmark', title: 'A', url: 'https://a.example/', faviconCache: 'data:image/png;base64,secret' }] } }] }],
  navItems: [], sets: [], tags: [{ id: 'tag-1', name: 'work' }], settings: { serviceApiKeys: { nasa: 'secret' }, activeThemeName: 'dark' }
};
const bundle = context.createPortableBundle(root, 'active-tab', { includeFavicons: false, includeBackgrounds: false });
assert.strictEqual(context.validatePortableBundle(bundle).ok, true);
const serialized = JSON.stringify(bundle);
assert(!serialized.includes('C:/private'));
assert(!serialized.includes('base64,secret'));
assert(!serialized.includes('serviceApiKeys'));
assert.strictEqual(bundle.payload.tabs[0].backgroundImage, '');

const destination = structuredClone(root);
destination.boards[0].tabs[0].inbox.items = [];
const itemBundle = context.createPortableBundle(root, 'active-inbox');
const imported = context.importPortableBundle(itemBundle, destination, { mode: 'copy' });
assert.strictEqual(imported.ok, true);
assert.strictEqual(destination.boards[0].tabs[0].inbox.items.length, 1);
assert.notStrictEqual(destination.boards[0].tabs[0].inbox.items[0].id, 'bm-1', 'copy import should remap IDs');

const summary = context.summarizePhaseTwoState(root);
assert.deepStrictEqual({ boards: summary.boards, tabs: summary.tabs, bookmarks: summary.bookmarks }, { boards: 1, tabs: 1, bookmarks: 1 });
const comparison = context.comparePhaseTwoSummaries(summary, { ...summary, bookmarks: 3 });
assert.strictEqual(comparison.find(entry => entry.key === 'bookmarks').delta, 2);

const described = context.describeAutomationRule({ conditions: { hostname: 'youtube.com' }, actions: { addTags: ['video'] } });
assert.match(described, /When website is youtube\.com, add video\./);

root.boards[0].tabs[0].inbox.items.push({ id: 'folder-1', type: 'folder', title: 'Nested', children: [{ id: 'bm-2', type: 'bookmark', title: 'B', url: 'https://b.example/' }] });
const folderBundle = context.createPortableBundle(root, 'folder', { folderId: 'folder-1' });
assert.strictEqual(folderBundle.payload.items[0].children[0].url, 'https://b.example/');

const restoreTarget = { ...structuredClone(root), boards: [], navItems: [], sets: [], activeBoardId: null, activeTabId: null };
context.restorePhaseTwoBackupScope(root, restoreTarget, 'board', 'Home');
assert.strictEqual(restoreTarget.boards.length, 1);
assert.notStrictEqual(restoreTarget.boards[0].id, 'board-1', 'single-board restore should remap colliding references');
assert.strictEqual(restoreTarget.navItems[0].boardId, restoreTarget.boards[0].id);

assert.match(source, /Add tags[\s\S]*Change names[\s\S]*Move bookmarks[\s\S]*Clean incoming links/);
assert.match(source, /hideHubToolsPanel\(\);[\s\S]*showSetManagerForSet\(createdSet\.id, \{ focusTitle: true \}\)/);

console.log('Phase 2 feature tests passed');
