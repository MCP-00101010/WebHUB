// Local English/German translation powered by Mozilla's Bergamot WASM engine.
// Model files live in the SDK's IndexedDB asset cache and never enter Hub state.

const TRANSLATOR_WIDGET_TYPE = 'translator';
const TRANSLATOR_RUNTIME_CACHE_KEY = 'runtime-v1';
const TRANSLATOR_MAX_CHARACTERS = 5000;
const TRANSLATOR_DOWNLOAD_CHUNK_BYTES = 1024 * 1024;
const TRANSLATOR_ENGINE_IDLE_MS = 5 * 60 * 1000;
const TRANSLATOR_LANGUAGES = Object.freeze({ en: 'English', de: 'German' });
const TRANSLATOR_MODELS = Object.freeze({
  ende: {
    label: 'English → German', source: 'en', target: 'de', version: '2.1',
    files: {
      model: { id: 'ende:model:2.1', name: 'model.ende.intgemm.alphas.bin', size: 31561787, hash: '8df29d9494d19f47fd5d97c6a73474c6f657e9f81c1a607c431d02befdf3810f' },
      lex: { id: 'ende:lex:2.1', name: 'lex.50.50.ende.s2t.bin', size: 4347672, hash: '7ed39f1cffbd68a27ddf05bbfe068de2060f1d7e69f1a20e27ae923551dd7393' },
      vocab: { id: 'ende:vocab:2.1', name: 'vocab.ende.spm', size: 810073, hash: '69f730becafa48e3bb2c244eab66456877c08959a02f2bd5519b5a3088b62f9c' }
    }
  },
  deen: {
    label: 'German → English', source: 'de', target: 'en', version: '2.0',
    files: {
      model: { id: 'deen:model:2.0', name: 'model.deen.intgemm.alphas.bin', size: 31561787, hash: '3e6f7c2c2425d10824797270b382bee718ff34af2cab9308841c82ca46dc6f20' },
      lex: { id: 'deen:lex:2.0', name: 'lex.50.50.deen.s2t.bin', size: 4945796, hash: '113b98460468360cca68c042e1cddf49c4e1931cbb975ed04349c9a3bd607010' },
      vocab: { id: 'deen:vocab:2.0', name: 'vocab.deen.spm', size: 810073, hash: '69f730becafa48e3bb2c244eab66456877c08959a02f2bd5519b5a3088b62f9c' }
    }
  }
});

const _translatorRuntimeMemory = new Map();
const _translatorInstallPromises = new Map();
const _translatorEngine = { worker: null, workerUrl: '', main: null, pair: '', ready: null, sequence: 0, pending: new Map(), idleTimer: null };
let _translatorWorkerAssetsPromise = null;
let _translatorWasmBinaryPromise = null;

function _translatorPair(source, target) {
  return `${source}${target}`;
}

function _translatorModelBytes(model) {
  return Object.values(model?.files || {}).reduce((total, file) => total + Number(file.size || 0), 0);
}

function _translatorFormatBytes(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 1 : 2)} MiB`;
}

function _translatorElement(tag, className = '', text = '') {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function _translatorProtectInteractive(element) {
  for (const type of ['mousedown', 'pointerdown', 'dragstart', 'contextmenu']) {
    element.addEventListener(type, event => event.stopPropagation());
  }
  return element;
}

function _translatorDecodeBase64(value) {
  const binary = atob(String(value || ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function _translatorHex(buffer) {
  return [...new Uint8Array(buffer)].map(value => value.toString(16).padStart(2, '0')).join('');
}

async function _translatorAssetValid(file) {
  const metadata = await WidgetSDK.assets.metadata(TRANSLATOR_WIDGET_TYPE, file.id);
  return metadata?.hash === file.hash && Number(metadata?.size) === file.size;
}

async function _translatorModelStatus(pair) {
  const model = TRANSLATOR_MODELS[pair];
  if (!model) return { installed: false, validFiles: 0, totalFiles: 0, bytes: 0 };
  const files = Object.values(model.files);
  const valid = await Promise.all(files.map(file => _translatorAssetValid(file)));
  return {
    installed: valid.every(Boolean),
    validFiles: valid.filter(Boolean).length,
    totalFiles: files.length,
    bytes: _translatorModelBytes(model)
  };
}

function _translatorCanDownloadModels() {
  try { return WidgetSDK.extensionRelay.supports(TRANSLATOR_WIDGET_TYPE, 'translationModels'); }
  catch { return false; }
}

async function _translatorDownloadAsset(file, onProgress) {
  if (await _translatorAssetValid(file)) {
    onProgress?.(file.size, file.size, file);
    return;
  }
  if (!_translatorCanDownloadModels()) throw new Error('Install or update the Morpheus Firefox extension to download Mozilla translation models.');
  const bytes = new Uint8Array(file.size);
  let offset = 0;
  while (offset < file.size) {
    const response = await WidgetSDK.extensionRelay.invoke(
      TRANSLATOR_WIDGET_TYPE,
      'fetchTranslationAssetChunk',
      file.id,
      offset,
      Math.min(TRANSLATOR_DOWNLOAD_CHUNK_BYTES, file.size - offset)
    );
    if (response?.assetId !== file.id || Number(response?.offset) !== offset || Number(response?.totalSize) !== file.size) {
      throw new Error(`Mozilla returned inconsistent data for ${file.name}.`);
    }
    const chunk = _translatorDecodeBase64(response.chunk);
    const nextOffset = Number(response.nextOffset);
    if (!chunk.length || nextOffset !== offset + chunk.length || nextOffset > file.size) {
      throw new Error(`Mozilla returned a stalled chunk for ${file.name}.`);
    }
    bytes.set(chunk, offset);
    offset = nextOffset;
    onProgress?.(offset, file.size, file);
  }
  const hash = _translatorHex(await crypto.subtle.digest('SHA-256', bytes));
  if (hash !== file.hash) throw new Error(`Integrity verification failed for ${file.name}.`);
  await WidgetSDK.assets.set(TRANSLATOR_WIDGET_TYPE, file.id, bytes.buffer, {
    hash: file.hash,
    modelPair: file.id.slice(0, 4),
    fileName: file.name,
    source: 'Mozilla Remote Settings'
  });
}

async function _translatorInstallModel(pair, onProgress) {
  if (_translatorInstallPromises.has(pair)) return _translatorInstallPromises.get(pair);
  const model = TRANSLATOR_MODELS[pair];
  if (!model) throw new Error('Unsupported translation direction.');
  const promise = (async () => {
    const files = Object.values(model.files);
    const total = _translatorModelBytes(model);
    let completed = 0;
    for (const file of files) {
      await _translatorDownloadAsset(file, (loaded, fileTotal) => onProgress?.(completed + loaded, total, file));
      completed += file.size;
      onProgress?.(completed, total, file);
    }
    return _translatorModelStatus(pair);
  })().finally(() => _translatorInstallPromises.delete(pair));
  _translatorInstallPromises.set(pair, promise);
  return promise;
}

async function _translatorRemoveModel(pair) {
  const model = TRANSLATOR_MODELS[pair];
  if (!model) return false;
  if (_translatorEngine.pair === pair) _translatorTerminateEngine();
  await Promise.all(Object.values(model.files).map(file => WidgetSDK.assets.remove(TRANSLATOR_WIDGET_TYPE, file.id)));
  return true;
}

function _translatorTerminateEngine(reason = 'The local translation engine was unloaded.') {
  if (_translatorEngine.idleTimer) clearTimeout(_translatorEngine.idleTimer);
  _translatorEngine.idleTimer = null;
  _translatorEngine.worker?.terminate?.();
  if (_translatorEngine.workerUrl) URL.revokeObjectURL(_translatorEngine.workerUrl);
  _translatorEngine.worker = null;
  _translatorEngine.workerUrl = '';
  if (_translatorEngine.main) {
    const resources = _translatorEngine.main;
    for (const key of ['service', 'model', 'vocabList', 'vocabMemory', 'lexMemory', 'modelMemory']) {
      try { resources[key]?.delete?.(); } catch {}
    }
  }
  _translatorEngine.main = null;
  _translatorEngine.pair = '';
  _translatorEngine.ready = null;
  for (const pending of _translatorEngine.pending.values()) {
    clearTimeout(pending.timer);
    pending.reject(new Error(reason));
  }
  _translatorEngine.pending.clear();
}

function _translatorLoadWorkerAsset(path, ready) {
  if (ready()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL(path, document.baseURI).href;
    script.async = true;
    script.onload = () => ready() ? resolve() : reject(new Error(`Local translation component ${path} did not initialize.`));
    script.onerror = () => reject(new Error(`Firefox could not load the local translation component ${path}.`));
    document.head.appendChild(script);
  });
}

async function _translatorEnsureWorkerAssets() {
  if (!_translatorWorkerAssetsPromise) {
    _translatorWorkerAssetsPromise = (async () => {
      await _translatorLoadWorkerAsset('vendor/bergamot/bergamot-translator.js', () => typeof loadBergamot === 'function');
      await _translatorLoadWorkerAsset('vendor/bergamot/bergamot-wasm-data.js', () => typeof MORPHEUS_BERGAMOT_WASM_GZIP_BASE64 === 'string');
      await _translatorLoadWorkerAsset('source/translator-worker.js', () => typeof morpheusTranslatorWorkerBootstrap === 'function');
    })().catch(error => {
      _translatorWorkerAssetsPromise = null;
      throw error;
    });
  }
  await _translatorWorkerAssetsPromise;
}

async function _translatorCreateWorker() {
  await _translatorEnsureWorkerAssets();
  if (typeof Blob !== 'function' || typeof URL.createObjectURL !== 'function') {
    throw new Error('This Firefox version cannot create the local translation worker.');
  }
  const source = [
    `'use strict';`,
    loadBergamot.toString(),
    `(${morpheusTranslatorWorkerBootstrap.toString()})();`
  ].join('\n');
  const workerUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  try {
    return { worker: new Worker(workerUrl), workerUrl };
  } catch (error) {
    URL.revokeObjectURL(workerUrl);
    throw error;
  }
}

function _translatorScheduleEngineUnload() {
  if (_translatorEngine.idleTimer) clearTimeout(_translatorEngine.idleTimer);
  _translatorEngine.idleTimer = setTimeout(() => _translatorTerminateEngine(), TRANSLATOR_ENGINE_IDLE_MS);
}

function _translatorWorkerRequest(type, payload = {}, transfers = [], timeoutMs = 120000, onProgress = null) {
  const worker = _translatorEngine.worker;
  if (!worker) return Promise.reject(new Error('The local translation worker is unavailable.'));
  return new Promise((resolve, reject) => {
    const requestId = `translator-${++_translatorEngine.sequence}`;
    const timer = setTimeout(() => {
      _translatorEngine.pending.delete(requestId);
      reject(new Error(type === 'init' ? 'The local engine took too long to load.' : 'Translation timed out.'));
    }, timeoutMs);
    _translatorEngine.pending.set(requestId, { resolve, reject, timer, onProgress });
    worker.postMessage({ type, requestId, ...payload }, transfers);
  });
}

async function _translatorWorkerWasmBinary() {
  if (!_translatorWasmBinaryPromise) {
    _translatorWasmBinaryPromise = (async () => {
      await _translatorEnsureWorkerAssets();
      const encoded = MORPHEUS_BERGAMOT_WASM_GZIP_BASE64;
      const compressed = new Uint8Array(Math.ceil(encoded.length * 3 / 4));
      let cursor = 0;
      const blockSize = 32768;
      for (let offset = 0; offset < encoded.length; offset += blockSize) {
        const binary = atob(encoded.slice(offset, offset + blockSize));
        for (let index = 0; index < binary.length; index += 1) compressed[cursor++] = binary.charCodeAt(index);
      }
      const stream = new Blob([compressed.subarray(0, cursor)]).stream().pipeThrough(new DecompressionStream('gzip'));
      return new Response(stream).arrayBuffer();
    })().catch(error => {
      _translatorWasmBinaryPromise = null;
      throw error;
    });
  }
  return _translatorWasmBinaryPromise;
}

function _translatorMainConfig(modelName) {
  const values = {
    'beam-size': '1', normalize: '1.0', 'word-penalty': '0', 'max-length-break': '128',
    'mini-batch-words': '1024', workspace: '128', 'max-length-factor': '2.0',
    'skip-cost': 'true', 'cpu-threads': '0', quiet: 'true', 'quiet-translation': 'true',
    'gemm-precision': modelName.endsWith('intgemm8.bin') ? 'int8shiftAll' : 'int8shiftAlphaAll',
    alignment: 'soft'
  };
  return `\n${Object.entries(values).map(([key, value]) => `            ${key}: ${value}`).join('\n')}\n            `;
}

function _translatorMainAlignedMemory(bergamot, buffer, alignment) {
  const memory = new bergamot.AlignedMemory(buffer.byteLength, alignment);
  memory.getByteArrayView().set(new Uint8Array(buffer));
  return memory;
}

function _translatorInitializeMainWasm(wasmBinary) {
  return new Promise((resolve, reject) => {
    let bergamot;
    let settled = false;
    const finish = (handler, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      handler(value);
    };
    const timer = setTimeout(() => finish(reject, new Error('Firefox could not initialize the local Bergamot runtime.')), 45000);
    try {
      bergamot = loadBergamot({
        INITIAL_MEMORY: 41_943_040,
        wasmBinary,
        print() {},
        printErr() {},
        onAbort(reason) { finish(reject, new Error(`Bergamot stopped during startup${reason ? `: ${reason}` : '.'}`)); },
        onRuntimeInitialized() { Promise.resolve().then(() => finish(resolve, bergamot)); }
      });
    } catch (error) {
      finish(reject, error);
    }
  });
}

async function _translatorLoadModelFiles(model) {
  const loadedFiles = await Promise.all(Object.entries(model.files).map(async ([type, file]) => {
    const record = await WidgetSDK.assets.get(TRANSLATOR_WIDGET_TYPE, file.id);
    if (!record || record.hash !== file.hash || Number(record.size) !== file.size || Number(record.payload?.byteLength) !== file.size) {
      throw new Error(`${file.name} is missing or outdated.`);
    }
    return [type, { name: file.name, buffer: record.payload }];
  }));
  return Object.fromEntries(loadedFiles);
}

async function _translatorEnsureMainEngine(pair, onProgress = null) {
  if (_translatorEngine.main && _translatorEngine.pair === pair && _translatorEngine.ready) {
    await _translatorEngine.ready;
    _translatorScheduleEngineUnload();
    return;
  }
  _translatorTerminateEngine('A different translation direction was loaded.');
  const model = TRANSLATOR_MODELS[pair];
  const status = await _translatorModelStatus(pair);
  if (!model || !status.installed) throw new Error('Install this offline translation model first.');
  _translatorEngine.pair = pair;
  _translatorEngine.ready = (async () => {
    onProgress?.('Reading the verified offline model…');
    const [files, sharedWasmBinary] = await Promise.all([_translatorLoadModelFiles(model), _translatorWorkerWasmBinary()]);
    onProgress?.('Starting the Bergamot engine locally…');
    const bergamot = await _translatorInitializeMainWasm(sharedWasmBinary.slice(0));
    onProgress?.('Loading the offline language model…');
    const modelMemory = _translatorMainAlignedMemory(bergamot, files.model.buffer, 256);
    const lexMemory = _translatorMainAlignedMemory(bergamot, files.lex.buffer, 64);
    const vocabMemory = _translatorMainAlignedMemory(bergamot, files.vocab.buffer, 64);
    const vocabList = new bergamot.AlignedMemoryList();
    vocabList.push_back(vocabMemory);
    const translationModel = new bergamot.TranslationModel(
      model.source, model.target, _translatorMainConfig(files.model.name),
      modelMemory, lexMemory, vocabList, null
    );
    _translatorEngine.main = {
      bergamot,
      model: translationModel,
      service: new bergamot.BlockingService({ cacheSize: 0 }),
      modelMemory,
      lexMemory,
      vocabMemory,
      vocabList
    };
  })();
  try {
    await _translatorEngine.ready;
    _translatorScheduleEngineUnload();
  } catch (error) {
    _translatorTerminateEngine(error?.message || 'The local translation engine failed to load.');
    throw error;
  }
}

function _translatorTranslateMain(text) {
  const engine = _translatorEngine.main;
  if (!engine) throw new Error('The local translation engine is unavailable.');
  const messages = new engine.bergamot.VectorString();
  const options = new engine.bergamot.VectorResponseOptions();
  let responses = null;
  try {
    messages.push_back(text);
    options.push_back({ qualityScores: false, alignment: true, html: false });
    responses = engine.service.translate(engine.model, messages, options);
    if (!responses.size()) throw new Error('Bergamot returned no translation.');
    return responses.get(0).getTranslatedText();
  } finally {
    responses?.delete?.();
    messages.delete();
    options.delete();
  }
}

async function _translatorEnsureWorkerEngine(pair, onProgress = null) {
  if (_translatorEngine.worker && _translatorEngine.pair === pair && _translatorEngine.ready) {
    await _translatorEngine.ready;
    _translatorScheduleEngineUnload();
    return;
  }
  _translatorTerminateEngine('A different translation direction was loaded.');
  const model = TRANSLATOR_MODELS[pair];
  const status = await _translatorModelStatus(pair);
  if (!model || !status.installed) throw new Error('Install this offline translation model first.');
  onProgress?.('Reading the verified offline model…');
  const [files, sharedWasmBinary] = await Promise.all([_translatorLoadModelFiles(model), _translatorWorkerWasmBinary()]);
  const wasmBinary = sharedWasmBinary.slice(0);
  const createdWorker = await _translatorCreateWorker();
  const worker = createdWorker.worker;
  _translatorEngine.worker = worker;
  _translatorEngine.workerUrl = createdWorker.workerUrl;
  _translatorEngine.pair = pair;
  worker.addEventListener('message', event => {
    const message = event.data || {};
    const pending = _translatorEngine.pending.get(message.requestId);
    if (!pending) return;
    if (message.type === 'progress') {
      pending.onProgress?.(message.detail || 'Loading the local translation engine…');
      return;
    }
    clearTimeout(pending.timer);
    _translatorEngine.pending.delete(message.requestId);
    if (message.type === 'error') pending.reject(new Error(message.error?.message || 'Local translation failed.'));
    else pending.resolve(message);
  });
  worker.addEventListener('error', event => {
    const message = event?.message || 'The local translation worker stopped unexpectedly.';
    _translatorTerminateEngine(message);
  });
  const transfers = [...Object.values(files).map(file => file.buffer), wasmBinary];
  _translatorEngine.ready = _translatorWorkerRequest('init', {
    sourceLanguage: model.source,
    targetLanguage: model.target,
    files,
    wasmBinary
  }, transfers, 180000, onProgress);
  try {
    await _translatorEngine.ready;
    _translatorScheduleEngineUnload();
  } catch (error) {
    _translatorTerminateEngine(error?.message || 'The local translation engine failed to load.');
    throw error;
  }
}

async function _translatorEnsureEngine(pair, onProgress = null) {
  if (typeof location !== 'undefined' && location.protocol === 'file:') {
    return _translatorEnsureMainEngine(pair, onProgress);
  }
  return _translatorEnsureWorkerEngine(pair, onProgress);
}

async function _translatorTranslate(pair, text, onProgress = null) {
  await _translatorEnsureEngine(pair, onProgress);
  if (_translatorEngine.main) {
    const startedAt = performance.now();
    const output = _translatorTranslateMain(text);
    _translatorScheduleEngineUnload();
    return { output, durationMs: performance.now() - startedAt };
  }
  const response = await _translatorWorkerRequest('translate', { text }, [], 60000);
  _translatorScheduleEngineUnload();
  return { output: String(response.output || ''), durationMs: Number(response.durationMs || 0) };
}

function _translatorDefaultRuntime(widget) {
  const source = widget?.config?.defaultDirection === 'deen' ? 'de' : 'en';
  return { source, target: source === 'en' ? 'de' : 'en', input: '', output: '', history: [], historyOpen: false, status: '', durationMs: 0 };
}

function _translatorReadRuntime(widget) {
  if (_translatorRuntimeMemory.has(widget.id)) return _translatorRuntimeMemory.get(widget.id);
  const fallback = _translatorDefaultRuntime(widget);
  let stored = null;
  try { stored = WidgetSDK.cache.get(TRANSLATOR_WIDGET_TYPE, widget.id, TRANSLATOR_RUNTIME_CACHE_KEY); } catch {}
  const runtime = { ...fallback, ...(stored || {}) };
  runtime.source = runtime.source === 'de' ? 'de' : 'en';
  runtime.target = runtime.source === 'en' ? 'de' : 'en';
  runtime.history = Array.isArray(runtime.history) ? runtime.history.slice(0, 10) : [];
  runtime.historyOpen = runtime.historyOpen === true;
  _translatorRuntimeMemory.set(widget.id, runtime);
  return runtime;
}

function _translatorPersistRuntime(widget, runtime) {
  _translatorRuntimeMemory.set(widget.id, runtime);
  const remember = widget?.config?.rememberText === true;
  const stored = {
    source: runtime.source,
    target: runtime.target,
    input: remember ? runtime.input : '',
    output: remember ? runtime.output : '',
    history: remember ? runtime.history.slice(0, 10) : [],
    historyOpen: runtime.historyOpen === true,
    durationMs: remember ? runtime.durationMs : 0
  };
  try { WidgetSDK.cache.set(TRANSLATOR_WIDGET_TYPE, widget.id, TRANSLATOR_RUNTIME_CACHE_KEY, stored); } catch {}
}

function _translatorCopy(text, button) {
  navigator.clipboard?.writeText?.(String(text || '')).then(() => {
    const previous = button.textContent;
    button.textContent = 'Copied';
    setTimeout(() => { if (button.isConnected) button.textContent = previous; }, 1200);
  }).catch(() => {});
}

function _translatorRenderHistory(widget, runtime, container, rerender) {
  if (widget.config.showHistory !== true || !runtime.history.length) return;
  const details = _translatorElement('details', 'translator-history');
  details.open = runtime.historyOpen;
  details.addEventListener('toggle', () => {
    runtime.historyOpen = details.open;
    _translatorPersistRuntime(widget, runtime);
  });
  details.appendChild(_translatorElement('summary', '', `Recent (${runtime.history.length})`));
  const list = _translatorElement('div', 'translator-history-list');
  runtime.history.forEach(item => {
    const button = _translatorElement('button', 'translator-history-item');
    button.type = 'button';
    button.append(
      _translatorElement('span', '', item.input),
      _translatorElement('strong', '', item.output)
    );
    button.addEventListener('click', () => {
      runtime.source = item.source;
      runtime.target = item.target;
      runtime.input = item.input;
      runtime.output = item.output;
      _translatorPersistRuntime(widget, runtime);
      rerender();
    });
    list.appendChild(button);
  });
  details.appendChild(list);
  container.appendChild(details);
}

function _translatorRenderWidget(widget, element, context = 'column') {
  const runtime = _translatorReadRuntime(widget);
  element.className = `translator-widget translator-widget--${context}`;
  element.innerHTML = '';
  const rerender = () => _translatorRenderWidget(widget, element, context);

  const languageRow = _translatorElement('div', 'translator-language-row');
  const sourceSelect = _translatorElement('select', 'translator-language-select');
  const targetSelect = _translatorElement('select', 'translator-language-select');
  for (const [code, label] of Object.entries(TRANSLATOR_LANGUAGES)) {
    const sourceOption = _translatorElement('option', '', label);
    sourceOption.value = code;
    sourceOption.selected = code === runtime.source;
    sourceSelect.appendChild(sourceOption);
    const targetOption = _translatorElement('option', '', label);
    targetOption.value = code;
    targetOption.selected = code === runtime.target;
    targetSelect.appendChild(targetOption);
  }
  sourceSelect.setAttribute('aria-label', 'Source language');
  targetSelect.setAttribute('aria-label', 'Target language');
  const swap = _translatorElement('button', 'translator-swap', '⇄');
  swap.type = 'button';
  swap.title = 'Swap languages and text';
  languageRow.append(sourceSelect, swap, targetSelect);

  const input = _translatorElement('textarea', 'translator-input');
  input.value = runtime.input;
  input.maxLength = TRANSLATOR_MAX_CHARACTERS;
  input.placeholder = `Enter up to ${TRANSLATOR_MAX_CHARACTERS.toLocaleString()} characters…`;
  input.setAttribute('aria-label', 'Text to translate');
  _translatorProtectInteractive(input);
  const counter = _translatorElement('span', 'translator-counter', `${input.value.length}/${TRANSLATOR_MAX_CHARACTERS}`);
  const inputMeta = _translatorElement('div', 'translator-input-meta');
  inputMeta.appendChild(counter);

  const output = _translatorElement('textarea', 'translator-output');
  output.value = runtime.output;
  output.readOnly = true;
  output.placeholder = 'Local translation appears here.';
  output.setAttribute('aria-label', 'Translation result');
  _translatorProtectInteractive(output);

  const actions = _translatorElement('div', 'translator-actions');
  const install = _translatorElement('button', 'translator-install', 'Checking model…');
  const translate = _translatorElement('button', 'translator-primary', 'Translate');
  const copy = _translatorElement('button', '', 'Copy');
  const clear = _translatorElement('button', '', 'Clear');
  for (const button of [install, translate, copy, clear]) button.type = 'button';
  install.hidden = true;
  translate.disabled = true;
  copy.disabled = !runtime.output;
  actions.append(install, translate, copy, clear);
  const status = _translatorElement('div', 'translator-status', 'Checking the offline model…');

  element.append(languageRow, input, inputMeta, output, actions, status);
  _translatorRenderHistory(widget, runtime, element, rerender);

  const updateDirection = source => {
    runtime.source = source === 'de' ? 'de' : 'en';
    runtime.target = runtime.source === 'en' ? 'de' : 'en';
    runtime.output = '';
    runtime.durationMs = 0;
    _translatorPersistRuntime(widget, runtime);
    rerender();
  };
  sourceSelect.addEventListener('change', () => updateDirection(sourceSelect.value));
  targetSelect.addEventListener('change', () => updateDirection(targetSelect.value === 'en' ? 'de' : 'en'));
  swap.addEventListener('click', () => {
    const previousInput = runtime.input;
    runtime.source = runtime.target;
    runtime.target = runtime.source === 'en' ? 'de' : 'en';
    runtime.input = runtime.output || previousInput;
    runtime.output = runtime.output ? previousInput : '';
    _translatorPersistRuntime(widget, runtime);
    rerender();
  });
  input.addEventListener('input', () => {
    runtime.input = input.value;
    counter.textContent = `${input.value.length}/${TRANSLATOR_MAX_CHARACTERS}`;
    _translatorPersistRuntime(widget, runtime);
  });
  input.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !translate.disabled) {
      event.preventDefault();
      translate.click();
    }
  });
  copy.addEventListener('click', () => _translatorCopy(runtime.output, copy));
  clear.addEventListener('click', () => {
    runtime.input = '';
    runtime.output = '';
    runtime.durationMs = 0;
    _translatorPersistRuntime(widget, runtime);
    rerender();
  });

  const pair = _translatorPair(runtime.source, runtime.target);
  const model = TRANSLATOR_MODELS[pair];
  const updateModelState = async () => {
    try {
      const modelStatus = await _translatorModelStatus(pair);
      if (!element.isConnected) return;
      install.hidden = modelStatus.installed;
      install.disabled = !_translatorCanDownloadModels();
      install.textContent = `Install offline model · ${_translatorFormatBytes(modelStatus.bytes)}`;
      translate.disabled = !modelStatus.installed;
      status.classList.remove('is-error');
      if (modelStatus.installed) {
        status.textContent = runtime.durationMs
          ? `Private and offline · ${Math.round(runtime.durationMs)} ms`
          : 'Private and offline · Mozilla Bergamot';
      } else if (!_translatorCanDownloadModels()) {
        status.textContent = 'The current Firefox extension is required to install this model.';
      } else {
        status.textContent = modelStatus.validFiles
          ? `Model installation incomplete (${modelStatus.validFiles}/${modelStatus.totalFiles} files).`
          : 'Download once, then translate entirely offline.';
      }
    } catch (error) {
      status.textContent = error?.message || 'Offline model status is unavailable.';
      status.classList.add('is-error');
    }
  };
  void updateModelState();

  install.addEventListener('click', async () => {
    install.disabled = true;
    status.classList.remove('is-error');
    try {
      await _translatorInstallModel(pair, (loaded, total, file) => {
        if (!element.isConnected) return;
        install.textContent = `${_translatorFormatBytes(loaded)} / ${_translatorFormatBytes(total)}`;
        status.textContent = `Downloading ${file.name} from Mozilla…`;
      });
      if (element.isConnected) rerender();
    } catch (error) {
      if (!element.isConnected) return;
      status.textContent = error?.message || 'Model installation failed.';
      status.classList.add('is-error');
      install.disabled = false;
      install.textContent = `Retry model install · ${_translatorFormatBytes(_translatorModelBytes(model))}`;
    }
  });

  translate.addEventListener('click', async () => {
    const text = input.value.trim();
    if (!text) {
      status.textContent = 'Enter some text first.';
      status.classList.add('is-error');
      input.focus();
      return;
    }
    translate.disabled = true;
    install.disabled = true;
    status.classList.remove('is-error');
    status.textContent = _translatorEngine.pair === pair ? 'Translating locally…' : 'Loading the local Bergamot engine…';
    try {
      const result = await _translatorTranslate(pair, text, detail => {
        if (element.isConnected) status.textContent = detail;
      });
      runtime.input = input.value;
      runtime.output = result.output;
      runtime.durationMs = result.durationMs;
      runtime.history = [
        { source: runtime.source, target: runtime.target, input: runtime.input, output: runtime.output, translatedAt: Date.now() },
        ...runtime.history.filter(item => item.input !== runtime.input || item.source !== runtime.source)
      ].slice(0, 10);
      _translatorPersistRuntime(widget, runtime);
      if (element.isConnected) rerender();
    } catch (error) {
      if (!element.isConnected) return;
      status.textContent = error?.message || 'Local translation failed.';
      status.classList.add('is-error');
      translate.disabled = false;
      install.disabled = false;
    }
  });
}

function _translatorRenderModelManager(container) {
  const section = _translatorElement('section', 'translator-model-manager');
  const heading = _translatorElement('div', 'translator-model-heading');
  heading.append(
    _translatorElement('strong', '', 'Offline language models'),
    _translatorElement('span', '', 'Downloaded from Mozilla, SHA-256 verified, and stored only in this browser.')
  );
  section.appendChild(heading);
  for (const [pair, model] of Object.entries(TRANSLATOR_MODELS)) {
    const row = _translatorElement('div', 'translator-model-row');
    const detail = _translatorElement('div', 'translator-model-detail');
    detail.append(
      _translatorElement('strong', '', model.label),
      _translatorElement('span', '', `${_translatorFormatBytes(_translatorModelBytes(model))} · model ${model.version}`)
    );
    const action = _translatorElement('button', 'settings-button', 'Checking…');
    action.type = 'button';
    action.disabled = true;
    const message = _translatorElement('div', 'translator-model-message');
    row.append(detail, action);
    section.append(row, message);
    const refresh = async () => {
      try {
        const status = await _translatorModelStatus(pair);
        if (!section.isConnected) return;
        action.disabled = !status.installed && !_translatorCanDownloadModels();
        action.textContent = status.installed ? 'Remove' : (status.validFiles ? 'Resume install' : 'Install');
        message.textContent = status.installed
          ? 'Installed and ready for offline use.'
          : (!_translatorCanDownloadModels() ? 'Update the Firefox extension to install this model.' : 'Not installed.');
        message.classList.remove('is-error');
        action.onclick = async () => {
          action.disabled = true;
          try {
            if (status.installed) {
              if (!window.confirm(`Remove the ${model.label} offline model from this browser?`)) return refresh();
              await _translatorRemoveModel(pair);
            } else {
              await _translatorInstallModel(pair, (loaded, total, file) => {
                if (!section.isConnected) return;
                action.textContent = `${Math.round(loaded / total * 100)}%`;
                message.textContent = `Downloading ${file.name}…`;
              });
            }
            await refresh();
          } catch (error) {
            if (!section.isConnected) return;
            message.textContent = error?.message || 'Model operation failed.';
            message.classList.add('is-error');
            action.disabled = false;
          }
        };
      } catch (error) {
        message.textContent = error?.message || 'Model status is unavailable.';
        message.classList.add('is-error');
      }
    };
    void refresh();
  }
  container.appendChild(section);
}

WIDGET_REGISTRY['translator'] = {
  id: 'translator',
  name: 'Translator',
  category: 'Utilities',
  description: 'Translate English and German locally with Mozilla Bergamot; text never leaves the browser.',
  allowedIn: ['column', 'navpane'],
  defaultConfig: { defaultDirection: 'ende', rememberText: false, showHistory: false },
  defaultData: {},
  settingsSchema: {
    type: 'object',
    properties: {
      defaultDirection: { type: 'string', enum: ['ende', 'deen'] },
      rememberText: { type: 'boolean' },
      showHistory: { type: 'boolean' }
    },
    additionalProperties: false
  },
  capabilities: {
    extensionRelay: { optional: true }, timers: true,
    localCache: { quotaBytes: 256 * 1024 }, assetCache: { quotaBytes: 96 * 1024 * 1024 }
  },
  responsive: { minWidth: 220, preferredWidth: 520, compactBelow: 320 },
  liveSettingsPreview: false,
  migrate(state) {
    state.config = { ...this.defaultConfig, ...(state.config || {}) };
    state.data = {};
    return state;
  },
  cleanup(widget) {
    _translatorRuntimeMemory.delete(widget.id);
    try { WidgetSDK.cache.remove(TRANSLATOR_WIDGET_TYPE, widget.id, TRANSLATOR_RUNTIME_CACHE_KEY); } catch {}
  },
  onSettingsCommit(widget, previousConfig) {
    const runtime = _translatorReadRuntime(widget);
    if (widget.config.defaultDirection !== previousConfig?.defaultDirection) {
      runtime.source = widget.config.defaultDirection === 'deen' ? 'de' : 'en';
      runtime.target = runtime.source === 'en' ? 'de' : 'en';
      runtime.output = '';
    }
    if (widget.config.rememberText !== true) runtime.history = [];
    _translatorPersistRuntime(widget, runtime);
  },
  render(widget, element, context) { _translatorRenderWidget(widget, element, context); },
  renderSettings(widget, container) {
    container.innerHTML = `
      <label class="settings-row"><span>Default direction</span><select class="settings-select" data-cfg="defaultDirection">
        <option value="ende" ${widget.config.defaultDirection !== 'deen' ? 'selected' : ''}>English → German</option>
        <option value="deen" ${widget.config.defaultDirection === 'deen' ? 'selected' : ''}>German → English</option>
      </select></label>
      <div class="settings-row"><span>Remember text locally</span><label class="settings-toggle"><input type="checkbox" data-cfg="rememberText" ${widget.config.rememberText === true ? 'checked' : ''} /><span class="toggle-track"></span></label></div>
      <div class="settings-row"><span>Show recent translations</span><label class="settings-toggle"><input type="checkbox" data-cfg="showHistory" ${widget.config.showHistory === true ? 'checked' : ''} /><span class="toggle-track"></span></label></div>
      <p class="settings-hint">Remembered text and history stay in this browser and are never written to the shared Hub database. Translation is manual and entirely offline after model installation.</p>`;
    _translatorRenderModelManager(container);
  }
};
