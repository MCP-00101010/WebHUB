const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

function loadApod(fetchImpl) {
  const storage = new Map();
  const context = vm.createContext({
    console,
    URL,
    AbortController,
    DOMException,
    structuredClone,
    setTimeout,
    clearTimeout,
    fetch: fetchImpl,
    getServiceSecret: () => 'test-key',
    saveState: () => { throw new Error('APOD runtime data must not save shared Hub state'); },
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
  for (const filename of ['source/widget-network.js', 'source/widgets.js', 'source/widget-sdk.js', 'source/nasa-apod-widget.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, filename), 'utf8'), context, { filename });
  }
  vm.runInContext('WidgetSDK.registry.adoptBuiltins()', context);
  return { context, storage };
}

test('NASA APOD caches daily media through the SDK without changing portable widget data', async () => {
  const payload = {
    date: '2026-08-17',
    title: 'Test nebula',
    explanation: 'A local test fixture.',
    media_type: 'image',
    url: 'https://example.test/apod.jpg'
  };
  const { context, storage } = loadApod(async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => payload
  }));
  context.widget = { id: 'apod-one', type: 'widget', widgetType: 'nasaApod', config: {}, data: {} };
  vm.runInContext('_ensureApodData(widget)', context);
  await vm.runInContext('_widgetFetches.get("apod:apod-one")', context);

  const envelope = JSON.parse(storage.get('morpheus-widget-sdk-cache:v1:nasaApod:apod-one:daily'));
  assert.equal(envelope.value.title, 'Test nebula');
  assert.deepEqual(JSON.parse(JSON.stringify(context.widget.data)), {});
});

test('NASA APOD migrates legacy portable cache data into SDK-local storage', () => {
  const { context, storage } = loadApod(async () => { throw new Error('Unexpected fetch'); });
  context.widget = {
    id: 'apod-legacy', type: 'widget', widgetType: 'nasaApod', config: {},
    data: { apodStatus: 'ready', apodCache: { fetchedOn: '2026-08-17', title: 'Legacy image' } }
  };
  vm.runInContext('WidgetSDK.state.migrate(widget)', context);
  const envelope = JSON.parse(storage.get('morpheus-widget-sdk-cache:v1:nasaApod:apod-legacy:daily'));
  assert.equal(envelope.value.title, 'Legacy image');
  assert.deepEqual(JSON.parse(JSON.stringify(context.widget.data)), {});
});
