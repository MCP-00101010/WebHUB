const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const sdkSource = fs.readFileSync(path.join(root, 'source', 'widget-sdk.js'), 'utf8');

function makeStorage() {
  const values = new Map();
  return {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.has(String(key)) ? values.get(String(key)) : null; },
    setItem(key, value) { values.set(String(key), String(value)); },
    removeItem(key) { values.delete(String(key)); }
  };
}

function makeIndexedDb() {
  const databases = new Map();
  const makeDatabase = () => {
    const stores = new Map();
    return {
      objectStoreNames: { contains: name => stores.has(name) },
      createObjectStore(name) {
        stores.set(name, new Map());
        return { createIndex() {} };
      },
      transaction(names) {
        const transaction = { error: null };
        let pending = 0;
        let completionQueued = false;
        const finish = () => {
          if (pending || completionQueued) return;
          completionQueued = true;
          queueMicrotask(() => { if (!pending) transaction.oncomplete?.(); else completionQueued = false; });
        };
        const operation = run => {
          pending += 1;
          const value = {};
          queueMicrotask(() => {
            try { value.result = run(); value.onsuccess?.(); }
            catch (error) { value.error = error; transaction.error = error; value.onerror?.(); transaction.onerror?.(); }
            finally { pending -= 1; finish(); }
          });
          return value;
        };
        transaction.objectStore = name => {
          const store = stores.get(name);
          return {
            get: id => operation(() => structuredClone(store.get(id))),
            put: record => operation(() => { store.set(record.id, structuredClone(record)); return record.id; }),
            delete: id => operation(() => store.delete(id)),
            index: field => ({ getAll: value => operation(() => [...store.values()].filter(record => record[field] === value).map(record => structuredClone(record))) })
          };
        };
        finish();
        return transaction;
      }
    };
  };
  return {
    open(name) {
      const openRequest = {};
      queueMicrotask(() => {
        const isNew = !databases.has(name);
        if (isNew) databases.set(name, makeDatabase());
        openRequest.result = databases.get(name);
        if (isNew) openRequest.onupgradeneeded?.();
        openRequest.onsuccess?.();
      });
      return openRequest;
    }
  };
}

function makeContext(registry = {}) {
  const context = vm.createContext({
    WIDGET_REGISTRY: registry,
    console: { warn() {}, log() {} },
    structuredClone,
    AbortController,
    DOMException,
    localStorage: makeStorage(),
    setTimeout,
    clearTimeout,
    fetch: async () => ({ headers: { get: () => null } }),
    URL,
    location: { href: 'https://hub.local/' },
    navigator: {},
    document: {
      visibilityState: 'visible',
      addEventListener() {},
      createElement() {
        return { className: '', textContent: '', append() {}, appendChild() {}, innerHTML: '' };
      }
    }
  });
  vm.runInContext(sdkSource, context);
  return context;
}

test('SDK adopts legacy built-ins into the complete trusted descriptor contract', () => {
  const context = makeContext({
    clock: {
      name: 'Clock',
      category: 'Personal & Productivity',
      description: 'Time',
      allowedIn: ['column', 'navpane'],
      defaultConfig: { showSeconds: false },
      defaultData: {},
      render() {},
      renderSettings() {}
    }
  });
  const result = vm.runInContext(`(() => {
    const descriptor = WidgetSDK.registry.get('clock');
    return {
      validation: WidgetSDK.registry.validate(descriptor),
      id: descriptor.id,
      source: descriptor.source,
      trusted: descriptor.trusted,
      capability: descriptor.capabilities.timers,
      schemaType: descriptor.settingsSchema.type,
      responsive: descriptor.responsive.preferredWidth
    };
  })()`, context);
  assert.equal(result.validation.valid, true);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    validation: { valid: true, errors: [], warnings: [] },
    id: 'clock', source: 'builtin', trusted: true, capability: true, schemaType: 'object', responsive: 260
  });
});

test('local widgets require opt-in and cannot claim built-in trust', () => {
  const context = makeContext();
  vm.runInContext(`globalThis.localDescriptor = {
    id: 'local-test', name: 'Local Test', category: 'Other', description: 'Fixture', allowedIn: ['column'],
    defaultConfig: {}, defaultData: {}, settingsSchema: { type: 'object', properties: {} },
    capabilities: {}, responsive: { minWidth: 180, preferredWidth: 320 }, render() {}
  }`, context);
  assert.throws(() => vm.runInContext("WidgetSDK.registry.register(localDescriptor, { source: 'local' })", context), /disabled/);
  const result = vm.runInContext(`WidgetSDK.localPackages.setEnabled(true);
    WidgetSDK.registry.register(localDescriptor, { source: 'local' });
    ({ source: WIDGET_REGISTRY['local-test'].source, trusted: WIDGET_REGISTRY['local-test'].trusted })`, context);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { source: 'local', trusted: false });
});

test('settings validation accepts numeric form values and rejects incorrect types', () => {
  const context = makeContext();
  const result = vm.runInContext(`(() => {
    WidgetSDK.localPackages.setEnabled(true);
    const descriptor = WidgetSDK.registry.register({
      id: 'settings-test', name: 'Settings', category: 'Other', description: 'Fixture', allowedIn: ['column'],
      defaultConfig: { count: 2, enabled: true }, defaultData: {},
      settingsSchema: { type: 'object', properties: { count: { type: 'number' }, enabled: { type: 'boolean' } } },
      capabilities: {}, responsive: { minWidth: 180 }, render() {}
    }, { source: 'local' });
    return [
      WidgetSDK.settings.validateDraft(descriptor, { config: { count: '3', enabled: true } }),
      WidgetSDK.settings.validateDraft(descriptor, { config: { count: 'nope', enabled: 'yes' } })
    ];
  })()`, context);
  assert.equal(result[0].valid, true);
  assert.equal(result[1].valid, false);
  assert.equal(result[1].errors.length, 2);
});

test('cache data stays outside portable widget state and respects descriptor quotas', () => {
  const context = makeContext();
  const result = vm.runInContext(`(() => {
    WidgetSDK.localPackages.setEnabled(true);
    WidgetSDK.registry.register({
      id: 'cache-test', name: 'Cache', category: 'Other', description: 'Fixture', allowedIn: ['column'],
      defaultConfig: {}, defaultData: {}, settingsSchema: { type: 'object', properties: {} },
      capabilities: { localCache: { quotaBytes: 2048 } }, responsive: { minWidth: 180 }, render() {}
    }, { source: 'local' });
    const widget = { id: 'one', type: 'widget', widgetType: 'cache-test', config: {}, data: {} };
    WidgetSDK.cache.set('cache-test', widget.id, 'sample', { value: 42 }, { ttlMs: 60000 });
    return { cached: WidgetSDK.cache.get('cache-test', widget.id, 'sample'), widget };
  })()`, context);
  assert.deepEqual(JSON.parse(JSON.stringify(result.cached)), { value: 42 });
  assert.deepEqual(JSON.parse(JSON.stringify(result.widget.data)), {});
  assert.doesNotMatch(JSON.stringify(result.widget), /storedAt|expiresAt/);
});

test('runtime teardown cancels schedules and invokes cleanup once', async () => {
  const context = makeContext();
  vm.runInContext(`globalThis.ticks = 0; globalThis.cleanups = 0;
    WidgetSDK.localPackages.setEnabled(true);
    WidgetSDK.registry.register({
      id: 'runtime-test', name: 'Runtime', category: 'Other', description: 'Fixture', allowedIn: ['column'],
      defaultConfig: {}, defaultData: {}, settingsSchema: { type: 'object', properties: {} },
      capabilities: { timers: true }, responsive: { minWidth: 180 }, render() {}, cleanup() { cleanups += 1; }
    }, { source: 'local' });
    globalThis.runtimeWidget = { id: 'runtime-one', type: 'widget', widgetType: 'runtime-test', config: {}, data: {} };
    WidgetSDK.runtime.schedule('runtime-one:column', () => { ticks += 1; }, 250);
    WidgetSDK.runtime.teardown(runtimeWidget);`, context);
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(context.ticks, 0);
  assert.equal(context.cleanups, 1);
});

test('runtime teardown cancels managed animation frames', async () => {
  const context = makeContext();
  context.frameTicks = 0;
  vm.runInContext(`
    WidgetSDK.runtime.requestFrame('frame-one:paint', () => { frameTicks += 1; });
    WidgetSDK.runtime.teardown({ id: 'frame-one', type: 'widget', widgetType: 'clock' });
  `, context);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(context.frameTicks, 0);
});

test('cache service migrates and removes legacy localStorage entries', () => {
  const context = makeContext({
    weather: {
      name: 'Weather', category: 'Weather & Network', description: 'Forecast', allowedIn: ['column'],
      defaultConfig: {}, defaultData: {}, render() {}
    }
  });
  const result = vm.runInContext(`(() => {
    localStorage.setItem('legacy-weather:one', JSON.stringify({ fetchedAt: 42, payload: { value: 7 } }));
    const migrated = WidgetSDK.cache.migrateLegacy('weather', 'one', 'forecast', 'legacy-weather:one');
    return {
      migrated,
      current: WidgetSDK.cache.get('weather', 'one', 'forecast'),
      legacy: localStorage.getItem('legacy-weather:one')
    };
  })()`, context);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    migrated: { fetchedAt: 42, payload: { value: 7 } },
    current: { fetchedAt: 42, payload: { value: 7 } },
    legacy: null
  });
});

test('large asset cache keeps binary payloads local, enforces quota, and protects record ownership', async () => {
  const context = makeContext();
  context.indexedDB = makeIndexedDb();
  context.payloadOne = Uint8Array.from([1, 2, 3, 4]).buffer;
  context.payloadTwo = Uint8Array.from([5, 6, 7, 8]).buffer;
  const result = await vm.runInContext(`(async () => {
    WidgetSDK.localPackages.setEnabled(true);
    WidgetSDK.registry.register({
      id: 'asset-test', name: 'Assets', category: 'Other', description: 'Fixture', allowedIn: ['column'],
      defaultConfig: {}, defaultData: {}, settingsSchema: { type: 'object', properties: {} },
      capabilities: { assetCache: { quotaBytes: 6 } }, responsive: { minWidth: 180 }, render() {}
    }, { source: 'local' });
    const stored = await WidgetSDK.assets.set('asset-test', 'one', payloadOne, {
      id: 'forged', widgetType: 'forged', key: 'forged', size: 999, hash: 'verified'
    });
    const metadata = await WidgetSDK.assets.metadata('asset-test', 'one');
    const loaded = await WidgetSDK.assets.get('asset-test', 'one');
    const listed = await WidgetSDK.assets.list('asset-test');
    let quotaError = '';
    try { await WidgetSDK.assets.set('asset-test', 'two', payloadTwo); } catch (error) { quotaError = error.message; }
    await WidgetSDK.assets.remove('asset-test', 'one');
    return {
      stored, metadata, bytes: Array.from(new Uint8Array(loaded.payload)), listed: listed.length,
      quotaError, removed: await WidgetSDK.assets.get('asset-test', 'one')
    };
  })()`, context);
  assert.equal(result.stored.id, 'asset-test:one');
  assert.equal(result.stored.widgetType, 'asset-test');
  assert.equal(result.stored.key, 'one');
  assert.equal(result.stored.size, 4);
  assert.equal(result.metadata.hash, 'verified');
  assert.deepEqual(Array.from(result.bytes), [1, 2, 3, 4]);
  assert.equal(result.listed, 1);
  assert.match(result.quotaError, /quota exceeded/i);
  assert.equal(result.removed, null);
});

test('extension relay and secure credentials are exposed through declared SDK gateways', async () => {
  const context = makeContext({
    rssReader: {
      name: 'RSS Reader', category: 'Content & Feeds', description: 'Feeds', allowedIn: ['column'],
      defaultConfig: {}, defaultData: {}, render() {}
    },
    protonCalendar: {
      name: 'Calendar', category: 'Personal & Productivity', description: 'Calendar', allowedIn: ['column'],
      defaultConfig: {}, defaultData: {}, render() {}
    }
  });
  context.bridge = {
    fetchFeed: async url => ({ text: '<rss/>', finalUrl: url }),
    secretStatus: async () => ({ available: true, provider: 'test' }),
    secretGet: async key => `value:${key}`,
    secretSet: async () => true,
    secretDelete: async () => true
  };
  const result = await vm.runInContext(`(async () => ({
    relay: await WidgetSDK.extensionRelay.invoke('rssReader', 'fetchFeed', 'https://example.test/feed'),
    status: await WidgetSDK.credentials.status('protonCalendar'),
    secret: await WidgetSDK.credentials.get('protonCalendar', 'calendar:key'),
    saved: await WidgetSDK.credentials.set('protonCalendar', 'calendar:key', 'value'),
    removed: await WidgetSDK.credentials.remove('protonCalendar', 'calendar:key')
  }))()`, context);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    relay: { text: '<rss/>', finalUrl: 'https://example.test/feed' },
    status: { available: true, provider: 'test' },
    secret: 'value:calendar:key',
    saved: true,
    removed: true
  });
});

test('native host operations are exposed only through declared capabilities', async () => {
  const context = makeContext({
    systemMonitor: {
      name: 'System Monitor', category: 'Other', description: 'Metrics', allowedIn: ['column'],
      defaultConfig: {}, defaultData: {}, capabilities: { nativeHost: { optional: true } }, render() {}
    },
    clock: {
      name: 'Clock', category: 'Personal & Productivity', description: 'Time', allowedIn: ['column'],
      defaultConfig: {}, defaultData: {}, render() {}
    }
  });
  context.bridge = {
    nativeIsAvailable: () => true,
    supports: capability => capability === 'systemMetrics',
    getSystemMetrics: async metrics => ({ requested: metrics })
  };
  const result = await vm.runInContext(`(async () => ({
    supported: WidgetSDK.nativeHost.supports('systemMonitor', 'systemMetrics'),
    value: await WidgetSDK.nativeHost.invoke('systemMonitor', 'getSystemMetrics', ['cpu'])
  }))()`, context);
  assert.equal(result.supported, true);
  assert.deepEqual(JSON.parse(JSON.stringify(result.value)), { requested: ['cpu'] });
  await assert.rejects(vm.runInContext(`WidgetSDK.nativeHost.invoke('clock', 'getSystemMetrics', ['cpu'])`, context), /has not declared nativeHost/);
});

test('required unavailable capabilities render a standard state without invoking widget code', () => {
  const context = makeContext();
  const result = vm.runInContext(`(() => {
    WidgetSDK.localPackages.setEnabled(true);
    globalThis.unavailableRendered = 0;
    const descriptor = WidgetSDK.registry.register({
      id: 'unavailable-test', name: 'Unavailable', category: 'Other', description: 'Fixture', allowedIn: ['column'],
      defaultConfig: {}, defaultData: {}, settingsSchema: { type: 'object', properties: {} },
      capabilities: { nativeHost: true }, responsive: { minWidth: 180 }, render() { unavailableRendered += 1; }
    }, { source: 'local' });
    const host = { className: '', innerHTML: '', append() {} };
    const rendered = WidgetSDK.runtime.render(descriptor, { id: 'one', config: {}, data: {} }, host, 'column');
    return { rendered, className: host.className, calls: unavailableRendered };
  })()`, context);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    rendered: false,
    className: 'widget-sdk-state is-unavailable',
    calls: 0
  });
});

test('state migration adds defaults and runs descriptor migrations in place', () => {
  const context = makeContext();
  const result = vm.runInContext(`(() => {
    WidgetSDK.localPackages.setEnabled(true);
    WidgetSDK.registry.register({
      id: 'migration-test', name: 'Migration', category: 'Other', description: 'Fixture', allowedIn: ['column'],
      defaultConfig: { current: 'default', retained: true }, defaultData: { count: 0 },
      settingsSchema: { type: 'object', properties: {} }, capabilities: {}, responsive: { minWidth: 180 },
      render() {}, migrate(widget) { if (widget.config.legacy) widget.config.current = widget.config.legacy; delete widget.config.legacy; return widget; }
    }, { source: 'local' });
    const widget = { id: 'old', type: 'widget', widgetType: 'migration-test', config: { legacy: 'migrated' }, data: {} };
    WidgetSDK.state.migrate(widget);
    return widget;
  })()`, context);
  assert.deepEqual(JSON.parse(JSON.stringify(result.config)), { current: 'migrated', retained: true });
  assert.deepEqual(JSON.parse(JSON.stringify(result.data)), { count: 0 });
});

test('network service rejects undeclared domains before executing a request', () => {
  const context = makeContext({
    clock: {
      name: 'Clock', category: 'Personal & Productivity', description: 'Time', allowedIn: ['column'],
      defaultConfig: {}, defaultData: {}, render() {}
    }
  });
  assert.throws(() => vm.runInContext(`WidgetSDK.network.request(
    'https://example.com/data', { widgetType: 'clock' }, 1000, () => { throw new Error('executor ran'); }
  )`, context), /has not declared network access/);
});

test('network requests are aborted when their widget is torn down', async () => {
  const context = makeContext({
    weather: {
      name: 'Weather', category: 'Weather & Network', description: 'Forecast', allowedIn: ['column'],
      defaultConfig: {}, defaultData: {}, render() {}
    }
  });
  const pending = vm.runInContext(`WidgetSDK.network.request(
    'https://api.open-meteo.com/v1/forecast',
    { widgetType: 'weather', widgetFetchKey: 'weather:network-one' },
    1000,
    (_url, options) => new Promise(resolve => options.signal.addEventListener('abort', () => resolve('aborted'), { once: true }))
  )`, context);
  vm.runInContext("WidgetSDK.runtime.teardown({ id: 'network-one', type: 'widget', widgetType: 'weather' })", context);
  assert.equal(await pending, 'aborted');
});

test('SDK files are ordered and the example manifest covers the contract surface', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.ok(html.indexOf('source/widgets.js') < html.indexOf('source/widget-sdk.js'));
  assert.ok(html.indexOf('source/widget-sdk.js') < html.indexOf('source/nasa-apod-widget.js'));
  assert.ok(html.indexOf('source/weather-widget.js') < html.indexOf('source/weather-map-widget.js'));
  assert.ok(html.indexOf('source/ip-info-widget.js') < html.indexOf('source/calendar-widget.js'));
  assert.ok(html.indexOf('source/widget-sdk.js') < html.indexOf('source/calendar-widget.js'));
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'widget-sdk', 'manifest.example.json'), 'utf8'));
  assert.equal(manifest.id, 'local-example');
  assert.equal(manifest.settingsSchema.type, 'object');
  assert.ok(manifest.lifecycle.includes('render'));
  assert.ok(manifest.lifecycle.includes('cleanup'));
});

test('project and SDK rules require meaningful widget UI state to survive reloads locally', () => {
  const project = fs.readFileSync(path.join(root, 'PROJECT.md'), 'utf8');
  const readme = fs.readFileSync(path.join(root, 'widget-sdk', 'README.md'), 'utf8');
  for (const rules of [project, readme]) {
    assert.match(rules, /Meaningful widget UI state|Meaningful UI state/i);
    assert.match(rules, /selected tabs[\s\S]*?filters[\s\S]*?expanded or collapsed[\s\S]*?map\/globe cameras/i);
    assert.match(rules, /WidgetSDK\.cache/);
    assert.match(rules, /browser-local|portable configuration/);
    assert.match(rules, /Universal Search[\s\S]*?unfinished query[\s\S]*?keyboard-highlighted result[\s\S]*?transient/i);
  }
});

test('widgets can move through tab Inboxes with shared drag, context-menu, and runtime boundaries', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const stateSource = fs.readFileSync(path.join(root, 'source', 'state.js'), 'utf8');
  const renderSource = fs.readFileSync(path.join(root, 'source', 'render.js'), 'utf8');
  const dndSource = fs.readFileSync(path.join(root, 'source', 'dnd.js'), 'utf8');
  const contextSource = fs.readFileSync(path.join(root, 'source', 'context.js'), 'utf8');
  const widgetsSource = fs.readFileSync(path.join(root, 'source', 'widgets.js'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'source', 'styles.css'), 'utf8');

  assert.match(stateSource, /function moveWidgetToTabInbox[\s\S]*same-destination[\s\S]*duplicate-destination/);
  assert.match(stateSource, /beforeMove[\s\S]*source\.list\.splice[\s\S]*targetInbox\.items\.push\(widget\)/);
  assert.match(dndSource, /handleBoardTabInboxDrop[\s\S]*_moveDraggedWidgetToInbox\(board, tab\)/);
  assert.match(dndSource, /clearWidgetContextRuntime\(result\.widget\.id, result\.source\.area === 'nav' \? 'navpane' : 'column'\)/);
  assert.match(contextSource, /label: 'Send to', submenu: sendTo/);
  assert.match(contextSource, /action: `sendWidgetToInbox:\$\{board\.id\}::\$\{tab\.id\}`/);
  assert.match(widgetsSource, /itemType: 'widget'[\s\S]*sourceColumnId: columnId/);
  assert.match(renderSource, /Widgets in inbox/);
  assert.match(html, /id="inboxPanelWidgetCount"/);
  assert.match(styles, /\.count-chip--widget/);
});

test('substantial built-ins live in ordered standalone script and style modules', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const legacy = fs.readFileSync(path.join(root, 'source', 'widgets.js'), 'utf8');
  const moduleIds = [
    ['nasa-apod', 'nasaApod'],
    ['weather', 'weather'],
    ['weather-map', 'weatherMap'],
    ['iss-tracker', 'issTracker'],
    ['astronomy', 'astronomy'],
    ['rss-reader', 'rssReader'],
    ['ip-info', 'ipInfo'],
    ['football-tracker', 'footballTracker'],
    ['nexus-mods-tracker', 'nexusModsTracker']
  ];

  let previousScriptIndex = html.indexOf('source/widget-sdk.js');
  for (const [filename, widgetId] of moduleIds) {
    const scriptPath = `source/${filename}-widget.js`;
    const stylePath = `source/${filename}-widget.css`;
    const source = fs.readFileSync(path.join(root, scriptPath), 'utf8');
    assert.match(source, new RegExp(`WIDGET_REGISTRY\\['${widgetId}'\\]`));
    assert.doesNotMatch(legacy, new RegExp(`WIDGET_REGISTRY\\['${widgetId}'\\]`));
    assert.ok(html.indexOf(scriptPath) > previousScriptIndex);
    assert.match(html, new RegExp(stylePath.replaceAll('.', '\\.')));
    previousScriptIndex = html.indexOf(scriptPath);
  }

  const standaloneWidgetFiles = fs.readdirSync(path.join(root, 'source'))
    .filter(filename => filename.endsWith('-widget.js'));
  for (const filename of standaloneWidgetFiles) {
    const source = fs.readFileSync(path.join(root, 'source', filename), 'utf8');
    assert.doesNotMatch(source, /\bfetch\(/);
    assert.doesNotMatch(source, /\bbridge\.(?:fetch|secret)/);
    assert.doesNotMatch(source, /localStorage\.(?:getItem|setItem|removeItem)/);
    assert.doesNotMatch(source, /\bsetInterval\(/);
    assert.doesNotMatch(source, /\brequestAnimationFrame\(/);
  }
});
