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
  const result = vm.runInContext(`(() => { const widget = { config: { providers: [{ id:'youtube', name:'YouTube', alias:'yt', icon:'Y', template:'https://youtube.test/?q={query}' }], defaultProviderId:'youtube' } }; const parsed = _universalSearchParse(widget, 'yt cats & dogs'); return { query: parsed.query, explicit: parsed.explicit, url: _universalSearchUrl(parsed.provider, parsed.query), direct: _universalSearchDirectUrl('example.com/path') }; })()`, sandbox);
  assert.equal(result.query, 'cats & dogs');
  assert.equal(result.explicit, true);
  assert.equal(result.url, 'https://youtube.test/?q=cats%20%26%20dogs');
  assert.equal(result.direct, 'https://example.com/path');
  assert.equal(vm.runInContext(`_universalSearchDirectUrl('ordinary search')`, sandbox), '');
  assert.equal(vm.runInContext(`_universalSearchDirectUrl('ordinary')`, sandbox), '');
});

test('search recents stay behind local SDK cache', () => {
  assert.doesNotMatch(source, /\blocalStorage\b|\bfetch\s*\(/);
  assert.match(source, /WidgetSDK\.cache\.set\('universalSearch'/);
  assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext(`WIDGET_REGISTRY.universalSearch.defaultData`, context()))), {});
});
