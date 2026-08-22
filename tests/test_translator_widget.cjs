const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const zlib = require('node:zlib');

const root = path.join(__dirname, '..');
const widgetSource = fs.readFileSync(path.join(root, 'source', 'translator-widget.js'), 'utf8');
const workerSource = fs.readFileSync(path.join(root, 'source', 'translator-worker.js'), 'utf8');

function context() {
  const sandbox = vm.createContext({
    WIDGET_REGISTRY: {},
    WidgetSDK: { cache: {}, assets: {}, extensionRelay: {} },
    Map,
    URL,
    setTimeout,
    clearTimeout
  });
  vm.runInContext(widgetSource, sandbox, { filename: 'translator-widget.js' });
  return sandbox;
}

test('translator declares a private local-only widget contract', () => {
  const descriptor = context().WIDGET_REGISTRY.translator;
  assert.equal(descriptor.name, 'Translator');
  assert.equal(descriptor.category, 'Utilities');
  assert.deepEqual(Array.from(descriptor.allowedIn), ['column', 'navpane']);
  assert.deepEqual(JSON.parse(JSON.stringify(descriptor.defaultConfig)), {
    defaultDirection: 'ende', rememberText: false, showHistory: false
  });
  assert.equal(descriptor.defaultData && Object.keys(descriptor.defaultData).length, 0);
  assert.equal(descriptor.capabilities.assetCache.quotaBytes, 96 * 1024 * 1024);
  assert.equal(descriptor.capabilities.network, undefined);
  assert.match(descriptor.description, /locally/i);
});

test('English and German model manifests are fixed and bounded', () => {
  const sandbox = context();
  const summary = vm.runInContext(`Object.fromEntries(Object.entries(TRANSLATOR_MODELS).map(([pair, model]) => [pair, {
    source: model.source, target: model.target, bytes: _translatorModelBytes(model),
    hashes: Object.values(model.files).map(file => file.hash), ids: Object.values(model.files).map(file => file.id)
  }]))`, sandbox);
  assert.deepEqual(JSON.parse(JSON.stringify(summary)), {
    ende: {
      source: 'en', target: 'de', bytes: 36719532,
      hashes: [
        '8df29d9494d19f47fd5d97c6a73474c6f657e9f81c1a607c431d02befdf3810f',
        '7ed39f1cffbd68a27ddf05bbfe068de2060f1d7e69f1a20e27ae923551dd7393',
        '69f730becafa48e3bb2c244eab66456877c08959a02f2bd5519b5a3088b62f9c'
      ],
      ids: ['ende:model:2.1', 'ende:lex:2.1', 'ende:vocab:2.1']
    },
    deen: {
      source: 'de', target: 'en', bytes: 37317656,
      hashes: [
        '3e6f7c2c2425d10824797270b382bee718ff34af2cab9308841c82ca46dc6f20',
        '113b98460468360cca68c042e1cddf49c4e1931cbb975ed04349c9a3bd607010',
        '69f730becafa48e3bb2c244eab66456877c08959a02f2bd5519b5a3088b62f9c'
      ],
      ids: ['deen:model:2.0', 'deen:lex:2.0', 'deen:vocab:2.0']
    }
  });
});

test('runtime persistence defaults to direction only and opt-in keeps local text', () => {
  const sandbox = context();
  const writes = [];
  sandbox.WidgetSDK.cache.get = () => null;
  sandbox.WidgetSDK.cache.set = (...args) => writes.push(args);
  const result = vm.runInContext(`(() => {
    const widget = { id: 'one', config: { defaultDirection: 'ende', rememberText: false } };
    const runtime = _translatorReadRuntime(widget);
    Object.assign(runtime, { input: 'secret source', output: 'secret result', history: [{ input: 'secret source', output: 'secret result' }] });
    _translatorPersistRuntime(widget, runtime);
    widget.config.rememberText = true;
    _translatorPersistRuntime(widget, runtime);
    return runtime;
  })()`, sandbox);
  assert.equal(result.source, 'en');
  assert.equal(writes.length, 2);
  assert.equal(writes[0][3].input, '');
  assert.deepEqual(Array.from(writes[0][3].history), []);
  assert.equal(writes[1][3].input, 'secret source');
  assert.equal(writes[1][3].history.length, 1);
});

test('translator history disclosure survives runtime recreation without retaining private text', () => {
  const sandbox = context();
  let stored = null;
  sandbox.WidgetSDK.cache.get = () => stored;
  sandbox.WidgetSDK.cache.set = (type, id, key, value) => { stored = JSON.parse(JSON.stringify(value)); };
  sandbox.widget = { id: 'translator-view', config: { defaultDirection: 'ende', rememberText: false } };
  vm.runInContext('runtime = _translatorReadRuntime(widget); runtime.historyOpen = true; _translatorPersistRuntime(widget, runtime); _translatorRuntimeMemory.clear();', sandbox);
  const restored = vm.runInContext('_translatorReadRuntime(widget)', sandbox);
  assert.equal(restored.historyOpen, true);
  assert.equal(stored.input, '');
  assert.deepEqual(stored.history, []);
});

test('bundled Bergamot WASM round-trips to the recorded upstream hash', () => {
  const wasmData = fs.readFileSync(path.join(root, 'vendor', 'bergamot', 'bergamot-wasm-data.js'), 'utf8');
  const chunks = [...wasmData.matchAll(/^\s*'([^']*)'[,]?$/gm)].map(match => match[1]);
  assert.ok(chunks.length > 1000);
  const wasm = zlib.gunzipSync(Buffer.from(chunks.join(''), 'base64'));
  assert.equal(wasm.length, 4960506);
  assert.equal(crypto.createHash('sha256').update(wasm).digest('hex'), 'a3a89d9ad0a4ed8f27bf3e403701b23f5709816f6376438503f2fa5b0182c2dc');
});

test('worker, relay, styles, and document wiring preserve the offline boundary', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'source', 'translator-widget.css'), 'utf8');
  const framework = fs.readFileSync(path.join(root, 'source', 'widgets.js'), 'utf8');
  const render = fs.readFileSync(path.join(root, 'source', 'render.js'), 'utf8');
  const bridge = fs.readFileSync(path.join(root, 'source', 'bridge.js'), 'utf8');
  const background = fs.readFileSync(path.join(root, 'extension', 'background.js'), 'utf8');
  assert.ok(html.indexOf('source/widget-sdk.js') < html.indexOf('source/translator-widget.js'));
  assert.ok(html.indexOf('source/translator-widget.js') < html.indexOf('source/command-palette.js'));
  assert.match(html, /source\/translator-widget\.css/);
  assert.match(css, /translator-widget--navpane/);
  assert.match(css, /user-select:\s*text/);
  assert.match(widgetSource, /function _translatorProtectInteractive\(element\)/);
  assert.match(widgetSource, /\['mousedown', 'pointerdown', 'dragstart', 'contextmenu'\]/);
  assert.match(framework, /dragStartedOnInteractiveControl \|\| _widgetInteractiveDragTarget\(e\.target\)/);
  assert.match(render, /dragStartedOnInteractiveControl \|\| _widgetInteractiveDragTarget\(e\.target\)/);
  assert.doesNotMatch(widgetSource, /\bfetch\(/);
  assert.match(workerSource, /new bergamot\.TranslationModel/);
  assert.match(workerSource, /new bergamot\.TranslationModel\(\s*message\.sourceLanguage,\s*message\.targetLanguage/);
  assert.match(workerSource, /new bergamot\.BlockingService/);
  assert.match(workerSource, /DecompressionStream\('gzip'\)/);
  assert.match(workerSource, /function morpheusTranslatorWorkerBootstrap\(\)/);
  assert.match(workerSource, /message\.wasmBinary instanceof ArrayBuffer/);
  assert.match(widgetSource, /URL\.createObjectURL\(new Blob/);
  assert.match(widgetSource, /morpheusTranslatorWorkerBootstrap\.toString\(\)/);
  assert.match(widgetSource, /const wasmBinary = sharedWasmBinary\.slice\(0\)/);
  assert.match(widgetSource, /await _translatorEnsureWorkerAssets\(\)/);
  assert.match(widgetSource, /record\.payload\?\.byteLength/);
  assert.match(widgetSource, /message\.type === 'progress'/);
  assert.match(widgetSource, /location\.protocol === 'file:'[\s\S]*?_translatorEnsureMainEngine/);
  assert.match(widgetSource, /function _translatorInitializeMainWasm\(wasmBinary\)/);
  assert.match(widgetSource, /const output = _translatorTranslateMain\(text\)/);
  assert.doesNotMatch(widgetSource, /globalThis\.MORPHEUS_BERGAMOT_WASM_GZIP_BASE64=\$\{JSON\.stringify/);
  assert.doesNotMatch(widgetSource, /new Worker\(new URL\('source\/translator-worker\.js'/);
  assert.match(bridge, /fetchTranslationAssetChunk/);
  assert.match(background, /MW_FETCH_TRANSLATOR_ASSET_CHUNK/);
  assert.match(background, /TRANSLATOR_ASSETS\[assetId\]/);
  assert.match(background, /response\.status !== 206/);
});
