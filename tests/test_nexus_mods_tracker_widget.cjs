const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const trackerSource = fs.readFileSync(path.join(root, 'source', 'nexus-mods-tracker-widget.js'), 'utf8');
const trackerStyles = fs.readFileSync(path.join(root, 'source', 'nexus-mods-tracker-widget.css'), 'utf8');

function response(status, payload, headers = {}) {
  const normalized = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), String(value)]));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: key => normalized.get(String(key).toLowerCase()) ?? null },
    json: async () => payload
  };
}

function loadTracker(fetchImpl, apiKey = 'personal-test-key') {
  const storage = new Map();
  const context = vm.createContext({
    console,
    URL,
    Intl,
    Date,
    Promise,
    Map,
    Set,
    AbortController,
    DOMException,
    structuredClone,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    fetch: fetchImpl,
    APP_VERSION: '0.11.194',
    getServiceSecret: service => service === 'nexusMods' ? apiKey : '',
    saveState: () => { throw new Error('Nexus runtime data must not save shared Hub state'); },
    location: { href: 'file:///morpheus/index.html' },
    localStorage: {
      get length() { return storage.size; },
      key: index => [...storage.keys()][index] ?? null,
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: key => storage.delete(key)
    },
    document: {
      hidden: false,
      visibilityState: 'visible',
      addEventListener() {},
      createElement: () => ({ append() {}, appendChild() {} })
    }
  });
  for (const filename of ['source/widget-network.js', 'source/widgets.js', 'source/widget-sdk.js', 'source/nexus-mods-tracker-widget.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, filename), 'utf8'), context, { filename });
  }
  vm.runInContext('_widgetSdkAdoptBuiltins()', context);
  return { context, storage };
}

test('Nexus game and mod payloads are bounded and normalized for compact display', () => {
  const { context } = loadTracker(async () => { throw new Error('Unexpected fetch'); });
  context.catalog = [
    { id: 2, domain_name: 'fallout4', name: 'Fallout 4', mods: 200 },
    { id: 1, domain_name: 'skyrimspecialedition', name: 'Skyrim Special Edition', mods: 500 },
    { id: 3, domain_name: '../bad', name: 'Bad game', mods: 999 }
  ];
  const games = vm.runInContext('_nexusModsNormalizeCatalog(catalog)', context);
  assert.deepEqual(JSON.parse(JSON.stringify(games.map(game => game.domain))), ['skyrimspecialedition', 'fallout4']);

  context.widget = {
    title: '',
    config: { games: [{ domain: 'skyrimspecialedition', name: 'Skyrim Special Edition' }, { domain: 'fallout4', name: 'Fallout 4' }] }
  };
  assert.equal(vm.runInContext('_nexusModsTitle(widget)', context), 'Skyrim Special Edition');
  assert.deepEqual(JSON.parse(JSON.stringify(context.widget.config.games.map(game => game.domain))), ['skyrimspecialedition']);
  context.widget.title = 'My Skyrim mods';
  assert.equal(vm.runInContext('_nexusModsTitle(widget)', context), 'My Skyrim mods');

  context.game = { domain: 'fallout4', name: 'Fallout 4' };
  context.mod = {
    mod_id: 42,
    name: 'A useful mod',
    summary: '  Compact   summary  ',
    author: 'Mod Author',
    version: '1.2',
    created_timestamp: 100,
    updated_timestamp: 200,
    endorsement_count: 50,
    mod_downloads: 5000,
    picture_url: 'https://staticdelivery.nexusmods.com/mods/1151/images/42/title.jpg',
    contains_adult_content: true,
    available: true,
    status: 'published'
  };
  const normalized = vm.runInContext('_nexusModsNormalizeMod(mod, game, "updated")', context);
  assert.equal(normalized.summary, 'Compact summary');
  assert.equal(normalized.url, 'https://www.nexusmods.com/fallout4/mods/42');
  assert.equal(normalized.adult, true);
  assert.equal(normalized.imageUrl, 'https://staticdelivery.nexusmods.com/mods/1151/images/42/title.jpg');
  assert.equal(vm.runInContext('_nexusModsImageUrl("https://example.com/not-nexus.jpg")', context), '');
  assert.equal(vm.runInContext('_nexusModsListHeight({ itemsPerGame: 5, showSummaries: true })', context), 544);
  assert.equal(vm.runInContext('_nexusModsListHeight({ itemsPerGame: 10, showSummaries: false })', context), 834);

  context.mod = { mod_id: 99, available: false, status: 'removed', name: 'Should not remain visible' };
  const unavailable = vm.runInContext('_nexusModsNormalizeMod(mod, game, "added")', context);
  assert.equal(unavailable, null);
});

test('Nexus tracker keeps one selected game and browser-local caches', async () => {
  const calls = [];
  const nodes = Array.from({ length: 14 }, (_, index) => ({
    modId: index + 1,
    name: `Skyrim mod ${index + 1}`,
    author: 'A',
    createdAt: new Date((index + 1) * 1000).toISOString(),
    updatedAt: new Date((index + 2) * 1000).toISOString(),
    endorsements: index,
    downloads: index * 10,
    pictureUrl: `https://staticdelivery.nexusmods.com/mods/1704/images/${index + 1}/title.jpg`,
    available: true,
    status: 'published'
  }));
  const { context, storage } = loadTracker(async (url, options) => {
    calls.push({ url: String(url), options });
    return response(200, { data: { mods: { nodes } } }, { 'X-RL-Daily-Remaining': 19998, 'X-RL-Hourly-Remaining': 498 });
  });
  context.widget = {
    id: 'nexus-one', type: 'widget', widgetType: 'nexusModsTracker', data: {},
    config: { games: [{ domain: 'skyrimspecialedition', name: 'Skyrim Special Edition' }, { domain: 'fallout4', name: 'Fallout 4' }], itemsPerGame: 5, refreshMinutes: 180 }
  };
  assert.equal(await vm.runInContext('_nexusModsLoadFeed(widget, "added")', context), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.nexusmods.com/v2/graphql');
  assert.equal(calls[0].options.method, 'POST');
  assert.ok(calls.every(call => call.options.headers.APIKEY === 'personal-test-key'));
  assert.ok(calls.every(call => call.options.headers['Protocol-Version'] === '1.0.0'));
  assert.ok(calls.every(call => call.options.headers['Application-Name'] === 'Morpheus WebHub'));
  assert.ok(calls.every(call => call.options.headers['Application-Version'] === '0.11.194'));
  const requestBody = JSON.parse(calls[0].options.body);
  assert.equal(requestBody.operationName, 'MorpheusNexusModsFeed');
  assert.equal(requestBody.variables.count, 30);
  assert.equal(requestBody.variables.sort[0].createdAt.direction, 'DESC');
  assert.equal(vm.runInContext('_nexusModsItems(widget, "added").length', context), 14, 'viewport setting must not truncate the scrollable feed');
  assert.equal(vm.runInContext('_nexusModsItems(widget, "added")[0].name', context), 'Skyrim mod 14');
  assert.deepEqual(JSON.parse(JSON.stringify(context.widget.config.games.map(game => game.domain))), ['skyrimspecialedition']);
  assert.ok(storage.has('morpheus-widget-sdk-cache:v1:nexusModsTracker:nexus-one:feed%3Askyrimspecialedition%3Aadded'));
  assert.ok(!storage.has('morpheus-widget-sdk-cache:v1:nexusModsTracker:nexus-one:feed%3Afallout4%3Aadded'));
  assert.deepEqual(JSON.parse(JSON.stringify(context.widget.data)), {});

  assert.equal(await vm.runInContext('_nexusModsLoadFeed(widget, "added", { force: true })', context), false);
  assert.equal(calls.length, 1, 'manual refresh is held to the five-minute provider floor');
});

test('Nexus updated feed follows file-update activity and omits unavailable mods', async () => {
  const calls = [];
  const { context } = loadTracker(async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('/mods/updated.json')) {
      return response(200, Array.from({ length: 14 }, (_, index) => ({
        mod_id: index + 1,
        latest_file_update: 101 + index,
        latest_mod_activity: 901 + index
      })));
    }
    if (String(url).endsWith('/mods/13.json')) return response(200, { mod_id: 13, name: 'Hidden result', updated_timestamp: 900, available: false, status: 'hidden' });
    if (String(url).endsWith('/mods/14.json')) return response(404, { message: 'Not found' });
    const id = Number(String(url).match(/\/mods\/(\d+)\.json$/)?.[1]);
    if (id) return response(200, { mod_id: id, name: `Updated mod ${id}`, updated_timestamp: 50, picture_url: `https://staticdelivery.nexusmods.com/mods/1151/images/${id}/title.jpg`, available: true, status: 'published' });
    throw new Error(`Unexpected URL: ${url}`);
  });
  context.widget = {
    id: 'nexus-updated', type: 'widget', widgetType: 'nexusModsTracker', data: {},
    config: { games: [{ domain: 'fallout4', name: 'Fallout 4' }], itemsPerGame: 5, refreshMinutes: 180 }
  };

  assert.equal(await vm.runInContext('_nexusModsLoadFeed(widget, "updated")', context), true);
  assert.equal(calls[0].url, 'https://api.nexusmods.com/v1/games/fallout4/mods/updated.json?period=1m');
  assert.equal(calls.length, 15);
  assert.equal(vm.runInContext('_nexusModsItems(widget, "updated").length', context), 12, 'updated viewport setting must not truncate the scrollable feed');
  assert.deepEqual(
    JSON.parse(JSON.stringify(vm.runInContext('(() => { const item = _nexusModsItems(widget, "updated")[0]; return [item.name, item.updatedAt, item.imageUrl]; })()', context))),
    ['Updated mod 12', 112000, 'https://staticdelivery.nexusmods.com/mods/1151/images/12/title.jpg']
  );
});

test('Nexus tracker retains stale results when a game is unavailable or rate limited', async () => {
  const { context } = loadTracker(async () => response(429, { message: 'Too many requests' }));
  context.widget = {
    id: 'nexus-stale', type: 'widget', widgetType: 'nexusModsTracker', data: {},
    config: { games: [{ domain: 'fallout4', name: 'Fallout 4' }], itemsPerGame: 5, refreshMinutes: 60 }
  };
  context.cached = {
    fetchedAt: Date.now() - 2 * 60 * 60 * 1000,
    game: { domain: 'fallout4', name: 'Fallout 4' },
    feed: 'updated',
    items: [{ id: 7, name: 'Cached update', gameDomain: 'fallout4', gameName: 'Fallout 4', updatedAt: 123, createdAt: 100, adult: false, available: true }]
  };
  vm.runInContext('WidgetSDK.cache.set("nexusModsTracker", widget.id, "feed:fallout4:updated", cached)', context);
  assert.equal(await vm.runInContext('_nexusModsLoadFeed(widget, "updated")', context), false);
  assert.equal(vm.runInContext('_nexusModsItems(widget, "updated")[0].name', context), 'Cached update');
  assert.match(vm.runInContext('_nexusModsState(widget).errors.fallout4', context), /rate limit reached/i);
});

test('Nexus tracker source is read-only and declares conservative provider boundaries', () => {
  const sdk = fs.readFileSync(path.join(root, 'source', 'widget-sdk.js'), 'utf8');
  assert.match(trackerSource, /method:\s*'GET'/);
  assert.match(trackerSource, /method:\s*'POST'/);
  assert.doesNotMatch(trackerSource, /method:\s*'(?:PUT|PATCH|DELETE)'/);
  assert.doesNotMatch(trackerSource, /\bmutation\b/i);
  assert.match(trackerSource, /MorpheusNexusModsFeed/);
  assert.match(trackerSource, /NEXUS_MODS_FEED_LIMIT = 30/);
  assert.match(trackerSource, /latest_added/);
  assert.match(trackerSource, /mods\/updated/);
  assert.match(trackerSource, /latest_file_update/);
  assert.doesNotMatch(trackerSource, /Unavailable mod/);
  assert.match(trackerSource, /NEXUS_MODS_DEFAULT_REFRESH_MINUTES = 180/);
  assert.match(trackerSource, /NEXUS_MODS_MANUAL_REFRESH_FLOOR_MS = 5 \* 60 \* 1000/);
  assert.match(trackerSource, /NEXUS_MODS_MAX_GAMES = 1/);
  assert.match(trackerSource, />Mods displayed<\/span>/);
  assert.match(trackerSource, /how many mod cards are visible at once/);
  assert.match(trackerSource, /nexus-mods-heading/);
  assert.match(trackerStyles, /\.nexus-mods-list\{[^}]*overflow-y:auto/);
  assert.match(trackerStyles, /\.nexus-mods-list\{[^}]*max-height:/);
  assert.match(trackerStyles, /\.nexus-mods-item\.has-image\{[^}]*grid-template-columns:112px minmax\(0,1fr\)/);
  assert.match(trackerStyles, /\.nexus-mods-title-row\{[^}]*display:flex/);
  assert.match(trackerStyles, /\.nexus-mods-image\{[^}]*object-fit:cover/);
  assert.match(trackerSource, /titleRow\.appendChild\(badge\)[\s\S]*titleRow\.appendChild\(heading\)/);
  assert.match(trackerSource, /if \(image\) article\.appendChild\(image\);\s*article\.appendChild\(content\)/);
  assert.match(sdk, /nexusModsTracker:[\s\S]*api\.nexusmods\.com/);
  assert.doesNotMatch(trackerSource, /\/endorse|\/abstain|\/download_link|\/tracked_mods/);
});
