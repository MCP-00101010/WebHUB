const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const stateSource = fs.readFileSync(path.join(root, 'source', 'state.js'), 'utf8');
const settingsSource = fs.readFileSync(path.join(root, 'source', 'settings.js'), 'utf8');
const mediaSource = fs.readFileSync(path.join(root, 'source', 'media-watchlist-widget.js'), 'utf8');
const calendarSource = fs.readFileSync(path.join(root, 'source', 'calendar-widget.js'), 'utf8');

test('all provider API keys are presented in the central API Keys settings page', () => {
  for (const id of ['stgApiKeyNasa', 'stgApiKeyTmdb', 'stgApiKeyFootballData']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(stateSource, /tmdb:\s*'service\.tmdb\.readAccessToken'/);
  assert.match(stateSource, /footballData:\s*'service\.footballData\.apiToken'/);
  assert.match(settingsSource, /_serviceSecretSaveTimers\.get\(serviceName\)/);
  assert.doesNotMatch(mediaSource, /media-watchlist-token|WidgetSDK\.credentials/);
  assert.doesNotMatch(calendarSource, /football-data\.org API token[^\n]*type="password"/);
});

test('legacy widget credential keys are discovered and migrated to global service entries', async () => {
  const secrets = new Map([
    ['media-watchlist:media-1:tmdb-token', 'old-tmdb-token'],
    ['proton-calendar:calendar-1:league', 'old-football-token']
  ]);
  const writes = [];
  const deletes = [];
  const cache = {};
  let saved = 0;
  let canScrub = false;
  const state = {
    settings: { serviceApiKeys: { nasa: '', tmdb: '', footballData: '' } },
    essentials: [],
    navItems: [],
    boards: [{ tabs: [{ columns: [{ items: [
      { id: 'media-1', type: 'widget', widgetType: 'mediaWatchlist' },
      { id: 'calendar-1', type: 'widget', widgetType: 'protonCalendar', config: { calendars: [{ id: 'league', type: 'football' }] } }
    ] }] }] }]
  };
  const context = vm.createContext({
    console,
    Map,
    Set,
    Object,
    String,
    Promise,
    setTimeout,
    clearTimeout,
    state,
    defaultSettings: { serviceApiKeys: { nasa: '', tmdb: '', footballData: '' } },
    SERVICE_SECRET_KEYS: {
      nasa: 'service.nasa.apiKey',
      tmdb: 'service.tmdb.readAccessToken',
      footballData: 'service.footballData.apiToken'
    },
    bridge: {
      whenReady: Promise.resolve(),
      isAvailable: () => true,
      nativeIsAvailable: () => true,
      secretStatus: async () => ({ available: true, provider: 'test' }),
      secretGet: async key => secrets.get(key) || '',
      secretSet: async (key, value) => { writes.push([key, value]); secrets.set(key, value); return true; },
      secretDelete: async key => { deletes.push(key); secrets.delete(key); return true; }
    },
    getBoardTabs: board => board.tabs || [],
    getServiceSecret: serviceName => cache[serviceName] || '',
    setServiceSecretCache: (serviceName, value) => { cache[serviceName] = value; },
    setServiceSecretsCanScrubState: value => { canScrub = value; },
    clearStoredServiceApiKeys: rootState => { Object.keys(rootState.settings.serviceApiKeys).forEach(key => { rootState.settings.serviceApiKeys[key] = ''; }); },
    saveState: () => { saved += 1; },
    cloneData: value => structuredClone(value)
  });
  vm.runInContext(settingsSource, context);

  const discovered = vm.runInContext('collectLegacyWidgetServiceSecretKeys(state)', context);
  assert.deepEqual(JSON.parse(JSON.stringify(discovered)), {
    tmdb: ['media-watchlist:media-1:tmdb-token'],
    footballData: ['proton-calendar:calendar-1:league']
  });

  assert.equal(await vm.runInContext('initializeServiceSecrets()', context), true);
  assert.deepEqual(writes, [
    ['service.tmdb.readAccessToken', 'old-tmdb-token'],
    ['service.footballData.apiToken', 'old-football-token']
  ]);
  assert.deepEqual(deletes.sort(), [
    'media-watchlist:media-1:tmdb-token',
    'proton-calendar:calendar-1:league'
  ]);
  assert.equal(cache.tmdb, 'old-tmdb-token');
  assert.equal(cache.footballData, 'old-football-token');
  assert.equal(canScrub, true);
  assert.equal(saved, 1);
});
