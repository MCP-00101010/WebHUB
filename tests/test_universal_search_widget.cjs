const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'source', 'universal-search-widget.js'), 'utf8');
function context() { const sandbox = vm.createContext({ WIDGET_REGISTRY: {}, Set, URL, console, WidgetSDK: { cache: { get: () => null, set() {}, remove() {} } }, document: {} }); vm.runInContext(source, sandbox); return sandbox; }

test('search templates require HTTPS and exactly one query placeholder', () => {
  const sandbox = context();
  assert.equal(vm.runInContext(`_universalSearchTemplate('https://example.test/search?q={query}')`, sandbox), 'https://example.test/search?q={query}');
  assert.equal(vm.runInContext(`_universalSearchTemplate('http://example.test/?q={query}')`, sandbox), '');
  assert.equal(vm.runInContext(`_universalSearchTemplate('https://example.test/{query}/{query}')`, sandbox), '');
  assert.equal(vm.runInContext(`_universalSearchTemplate('javascript:{query}')`, sandbox), '');
});

test('providers reject duplicate and reserved aliases', () => {
  const sandbox = context();
  const result = vm.runInContext(`(() => { const widget = { config: { providers: [
    { id: 'one', name: 'One', alias: 'g', icon: '1', template: 'https://one.test/?q={query}' },
    { id: 'two', name: 'Two', alias: 'g', icon: '2', template: 'https://two.test/?q={query}' },
    { id: 'three', name: 'Three', alias: 'open', icon: '3', template: 'https://three.test/?q={query}' }
  ] } }; return _universalSearchProviders(widget); })()`, sandbox);
  assert.deepEqual([...result].map(provider => provider.alias), ['g', '', '']);
});

test('aliases, URLs, and encoded search queries resolve predictably', () => {
  const sandbox = context();
  const result = vm.runInContext(`(() => { const widget = { config: { providers: [{ id:'youtube', name:'YouTube', alias:'yt', icon:'Y', template:'https://youtube.test/?q={query}' }], defaultProviderId:'youtube' } }; const parsed = _universalSearchParse(widget, '@yt cats & dogs'); return { query: parsed.query, explicit: parsed.explicit, url: _universalSearchUrl(parsed.provider, parsed.query), direct: _universalSearchDirectUrl('example.com/path') }; })()`, sandbox);
  assert.equal(result.query, 'cats & dogs');
  assert.equal(result.explicit, true);
  assert.equal(result.url, 'https://youtube.test/?q=cats%20%26%20dogs');
  assert.equal(result.direct, 'https://example.com/path');
  assert.equal(vm.runInContext(`_universalSearchDirectUrl('ordinary search')`, sandbox), '');
  assert.equal(vm.runInContext(`_universalSearchDirectUrl('ordinary')`, sandbox), '');
});

test('at-prefix provider picker is discoverable, filterable, and keeps searches transient', () => {
  const sandbox = context();
  const result = vm.runInContext(`(() => { const widget = { config: { providers: [
    { id:'google', name:'Google', alias:'g', icon:'G', template:'https://google.test/?q={query}' },
    { id:'duckduckgo', name:'DuckDuckGo', alias:'ddg', icon:'D', template:'https://duck.test/?q={query}' },
    { id:'private', name:'Private Search', alias:'', icon:'P', template:'https://private.test/?q={query}' }
  ], defaultProviderId:'google' } }; return {
    all: _universalSearchProviderChoices(widget, '@').map(entry => ({ label: entry.label, fill: entry.fill })),
    filtered: _universalSearchProviderChoices(widget, '@duck').map(entry => entry.label),
    media: _universalSearchProviderChoices(widget, '@media').map(entry => entry.label),
    searching: _universalSearchProviderChoices(widget, '@ddg cats').length
  }; })()`, sandbox);
  assert.deepEqual(JSON.parse(JSON.stringify(result.all.slice(0, 2))), [
    { label: 'Google', fill: '@g ' },
    { label: 'DuckDuckGo', fill: '@ddg ' }
  ]);
  assert.ok(result.all.some(entry => entry.label === 'IMDb'));
  assert.deepEqual([...result.filtered], ['DuckDuckGo']);
  assert.deepEqual([...result.media], ['YouTube', 'Twitch', 'Bandcamp', 'IMDb']);
  assert.equal(result.searching, 0);
});

test('at-prefix searches can use unconfigured built-ins without adding them to settings', () => {
  const sandbox = context();
  const result = vm.runInContext(`(() => { const widget = { config: { providers: [
    { id:'google', name:'Google', alias:'g', icon:'G', template:'https://google.test/?q={query}' }
  ], defaultProviderId:'google' } }; const explicit = _universalSearchParse(widget, '@imdb dune'); const plain = _universalSearchParse(widget, 'imdb dune'); return {
    configuredIds: widget.config.providers.map(provider => provider.id),
    explicit: { provider: explicit.provider.id, configured: explicit.provider.configured, query: explicit.query },
    plain: { provider: plain.provider.id, explicit: plain.explicit, query: plain.query }
  }; })()`, sandbox);
  assert.deepEqual([...result.configuredIds], ['google']);
  assert.deepEqual(JSON.parse(JSON.stringify(result.explicit)), { provider: 'imdb', configured: false, query: 'dune' });
  assert.deepEqual(JSON.parse(JSON.stringify(result.plain)), { provider: 'google', explicit: false, query: 'imdb dune' });
});

test('search recents stay behind local SDK cache', () => {
  assert.doesNotMatch(source, /\blocalStorage\b|\bfetch\s*\(/);
  assert.match(source, /WidgetSDK\.cache\.set\('universalSearch'/);
  assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext(`WIDGET_REGISTRY.universalSearch.defaultData`, context()))), {});
});

test('unfinished queries and keyboard selection are explicit transient state', () => {
  assert.match(source, /Unfinished queries and the keyboard-highlighted result are deliberately transient/);
  assert.match(source, /_universalSearchRuntime\.get\(widget\.id\) \|\| \{ query: '', selected: 0 \}/);
  assert.doesNotMatch(source, /WidgetSDK\.cache\.set\('universalSearch', widget\.id, (?!UNIVERSAL_SEARCH_RECENTS_KEY)/);
});

test('provider presets cover common general, knowledge, development, shopping, gaming, and media searches', () => {
  const sandbox = context();
  const presets = vm.runInContext('UNIVERSAL_SEARCH_PROVIDER_PRESETS.map(({ group, id }) => ({ group, id }))', sandbox);
  const groups = new Set([...presets].map(preset => preset.group));
  assert.deepEqual([...groups], ['General', 'Knowledge', 'Development', 'Shopping', 'Gaming', 'Media']);
  assert.ok([...presets].some(preset => preset.id === 'duckduckgo'));
  assert.ok([...presets].some(preset => preset.id === 'github'));
  assert.ok([...presets].some(preset => preset.id === 'steam'));
  assert.ok([...presets].some(preset => preset.id === 'gog'));
  assert.ok([...presets].some(preset => preset.id === 'twitch'));
  for (const id of ['google-maps', 'reddit', 'npm', 'pypi', 'docker-hub', 'steamdb', 'itch-io', 'protondb', 'pcgamingwiki', 'bandcamp']) assert.ok([...presets].some(preset => preset.id === id), `${id} should be built in`);
  assert.ok([...presets].every(preset => preset.id !== 'spotify'));
});

test('GOG and Twitch presets build their current catalogue search URLs', () => {
  const sandbox = context();
  const urls = vm.runInContext(`({
    gog: _universalSearchUrl(_universalSearchPreset('gog'), 'Baldur & Beyond'),
    twitch: _universalSearchUrl(_universalSearchPreset('twitch'), 'retro games')
  })`, sandbox);
  assert.equal(urls.gog, 'https://www.gog.com/en/games?query=Baldur%20%26%20Beyond');
  assert.equal(urls.twitch, 'https://www.twitch.tv/search?term=retro%20games');
});

test('recommended general, development, gaming, and media presets build direct search URLs', () => {
  const sandbox = context();
  const urls = vm.runInContext(`Object.fromEntries(['google-maps','reddit','npm','pypi','docker-hub','steamdb','itch-io','protondb','pcgamingwiki','bandcamp'].map(id => [id, _universalSearchUrl(_universalSearchPreset(id), 'test & tools')]))`, sandbox);
  assert.equal(urls['google-maps'], 'https://www.google.com/maps/search/?api=1&query=test%20%26%20tools');
  assert.equal(urls.reddit, 'https://www.reddit.com/search/?q=test%20%26%20tools');
  assert.equal(urls.npm, 'https://www.npmjs.com/search?q=test%20%26%20tools');
  assert.equal(urls.pypi, 'https://pypi.org/search/?q=test%20%26%20tools');
  assert.equal(urls['docker-hub'], 'https://hub.docker.com/search?q=test%20%26%20tools');
  assert.equal(urls.steamdb, 'https://steamdb.info/search/?a=app&q=test%20%26%20tools');
  assert.equal(urls['itch-io'], 'https://itch.io/search?q=test%20%26%20tools');
  assert.equal(urls.protondb, 'https://www.protondb.com/search?q=test%20%26%20tools');
  assert.equal(urls.pcgamingwiki, 'https://www.pcgamingwiki.com/w/index.php?search=test%20%26%20tools');
  assert.equal(urls.bandcamp, 'https://bandcamp.com/search?q=test%20%26%20tools');
});

test('preset catalogue filtering matches names, aliases, and purpose groups', () => {
  const sandbox = context();
  const matches = filter => [...vm.runInContext(`UNIVERSAL_SEARCH_PROVIDER_PRESETS.filter(provider => _universalSearchPresetMatches(provider, ${JSON.stringify(filter)})).map(provider => provider.id)`, sandbox)];
  assert.deepEqual(matches('shopping'), ['amazon-uk', 'ebay-uk']);
  assert.deepEqual(matches('wa'), ['wolfram-alpha']);
  assert.deepEqual(matches('development docs'), ['mdn']);
  assert.equal(matches('not-a-real-provider').length, 0);
});

test('new widgets receive a small balanced default provider set', () => {
  const sandbox = context();
  const defaults = vm.runInContext(`(() => { const widget = { config: {} }; return _universalSearchProviders(widget).map(provider => provider.id); })()`, sandbox);
  assert.deepEqual([...defaults], ['google', 'duckduckgo', 'youtube', 'wikipedia']);
});

test('provider configuration uses a focused editor rather than exposed inline fields', () => {
  assert.match(source, /universal-search-provider-editor/);
  assert.match(source, /Filter provider presets/);
  assert.match(source, /universal-search-settings-order/);
  assert.doesNotMatch(source, /universal-search-settings-grid/);
});

test('provider UI resolves real favicons and retains configured text as a fallback', () => {
  assert.match(source, /resolveFaviconSource\(\{ title: provider\.name, url: home, faviconCache: '' \}\)/);
  assert.match(source, /fallback\.classList\.add\('hidden'\)/);
  assert.match(source, /Fallback icon/);
});

test('migration preserves valid saved provider identity, order, and default selection', () => {
  const sandbox = context();
  const migrated = vm.runInContext(`WIDGET_REGISTRY.universalSearch.migrate({ id: 'search-1', config: {
    providers: [
      { id:'second', name:'Second', alias:'two', icon:'2', template:'https://two.test/?q={query}' },
      { id:'first', name:'First', alias:'one', icon:'1', template:'https://one.test/?q={query}' }
    ],
    defaultProviderId:'first', rememberSearches:false, openInNewTab:false, localResultCount:12
  }, data: { obsolete: true } })`, sandbox);
  assert.deepEqual([...migrated.config.providers].map(provider => provider.id), ['second', 'first']);
  assert.equal(migrated.config.defaultProviderId, 'first');
  assert.equal(migrated.config.rememberSearches, false);
  assert.equal(migrated.config.openInNewTab, false);
  assert.equal(migrated.config.localResultCount, 12);
  assert.deepEqual(JSON.parse(JSON.stringify(migrated.data)), {});
});
