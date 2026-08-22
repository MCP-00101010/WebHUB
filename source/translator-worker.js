/* Bergamot worker runtime for the local Translator widget. */
/* global loadBergamot, MORPHEUS_BERGAMOT_WASM_GZIP_BASE64 */

'use strict';

// Kept as one self-contained function so a file:// Hub can safely serialize it
// into a same-origin blob worker. Firefox intentionally blocks separate local
// files as worker entry points under its strict file-origin policy.
function morpheusTranslatorWorkerBootstrap() {

const TRANSLATOR_WORKER_ALIGNMENTS = Object.freeze({ model: 256, lex: 64, vocab: 64 });
let translatorWorkerEngine = null;

function translatorWorkerError(error) {
  return {
    name: error?.name || 'Error',
    message: error?.message || String(error || 'Translation failed'),
    stack: error?.stack || ''
  };
}

async function translatorWorkerDecodeWasm() {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('This Firefox version cannot decompress the local Bergamot engine.');
  }
  const encoded = MORPHEUS_BERGAMOT_WASM_GZIP_BASE64;
  const compressed = new Uint8Array(encoded.length * 3 / 4);
  let cursor = 0;
  const blockSize = 32768;
  for (let offset = 0; offset < encoded.length; offset += blockSize) {
    const binary = atob(encoded.slice(offset, offset + blockSize));
    for (let index = 0; index < binary.length; index += 1) compressed[cursor++] = binary.charCodeAt(index);
  }
  const stream = new Blob([compressed.subarray(0, cursor)]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}

function translatorWorkerInitializeWasm(wasmBinary) {
  return new Promise((resolve, reject) => {
    let bergamot;
    bergamot = loadBergamot({
      INITIAL_MEMORY: 41_943_040,
      print() {},
      printErr() {},
      onAbort() { reject(new Error('Bergamot aborted while loading its WASM engine.')); },
      onRuntimeInitialized: async () => {
        await Promise.resolve();
        resolve(bergamot);
      },
      wasmBinary
    });
  });
}

function translatorWorkerConfig(modelName) {
  const values = {
    'beam-size': '1', normalize: '1.0', 'word-penalty': '0', 'max-length-break': '128',
    'mini-batch-words': '1024', workspace: '128', 'max-length-factor': '2.0',
    'skip-cost': 'true', 'cpu-threads': '0', quiet: 'true', 'quiet-translation': 'true',
    'gemm-precision': modelName.endsWith('intgemm8.bin') ? 'int8shiftAll' : 'int8shiftAlphaAll',
    alignment: 'soft'
  };
  return `\n${Object.entries(values).map(([key, value]) => `            ${key}: ${value}`).join('\n')}\n            `;
}

function translatorWorkerAlignedMemory(bergamot, buffer, alignment) {
  const memory = new bergamot.AlignedMemory(buffer.byteLength, alignment);
  memory.getByteArrayView().set(new Uint8Array(buffer));
  return memory;
}

async function translatorWorkerInitialize(message) {
  self.postMessage({ type: 'progress', requestId: message.requestId, stage: 'wasm', detail: 'Starting the Bergamot engine…' });
  const wasm = message.wasmBinary instanceof ArrayBuffer ? message.wasmBinary : await translatorWorkerDecodeWasm();
  const bergamot = await translatorWorkerInitializeWasm(wasm);
  self.postMessage({ type: 'progress', requestId: message.requestId, stage: 'model', detail: 'Loading the offline language model…' });
  const files = message.files || {};
  for (const type of ['model', 'lex', 'vocab']) {
    if (!(files[type]?.buffer instanceof ArrayBuffer)) throw new Error(`The ${type} model file is missing.`);
  }
  const modelMemory = translatorWorkerAlignedMemory(bergamot, files.model.buffer, TRANSLATOR_WORKER_ALIGNMENTS.model);
  const lexMemory = translatorWorkerAlignedMemory(bergamot, files.lex.buffer, TRANSLATOR_WORKER_ALIGNMENTS.lex);
  const vocabMemory = translatorWorkerAlignedMemory(bergamot, files.vocab.buffer, TRANSLATOR_WORKER_ALIGNMENTS.vocab);
  const vocabList = new bergamot.AlignedMemoryList();
  vocabList.push_back(vocabMemory);
  const model = new bergamot.TranslationModel(
    message.sourceLanguage,
    message.targetLanguage,
    translatorWorkerConfig(files.model.name || ''),
    modelMemory,
    lexMemory,
    vocabList,
    null
  );
  translatorWorkerEngine = {
    pair: `${message.sourceLanguage}${message.targetLanguage}`,
    bergamot,
    model,
    service: new bergamot.BlockingService({ cacheSize: 0 })
  };
  self.postMessage({ type: 'progress', requestId: message.requestId, stage: 'ready', detail: 'Local translation engine ready.' });
}

function translatorWorkerTranslate(text) {
  if (!translatorWorkerEngine) throw new Error('The local translation engine is not ready.');
  const messages = new translatorWorkerEngine.bergamot.VectorString();
  const options = new translatorWorkerEngine.bergamot.VectorResponseOptions();
  let responses = null;
  try {
    messages.push_back(text);
    options.push_back({ qualityScores: false, alignment: true, html: false });
    responses = translatorWorkerEngine.service.translate(translatorWorkerEngine.model, messages, options);
    if (!responses.size()) throw new Error('Bergamot returned no translation.');
    return responses.get(0).getTranslatedText();
  } finally {
    responses?.delete?.();
    messages.delete();
    options.delete();
  }
}

self.addEventListener('message', event => {
  const message = event.data || {};
  if (message.type === 'init') {
    translatorWorkerInitialize(message)
      .then(() => self.postMessage({ type: 'ready', requestId: message.requestId, pair: translatorWorkerEngine.pair }))
      .catch(error => self.postMessage({ type: 'error', requestId: message.requestId, error: translatorWorkerError(error) }));
    return;
  }
  if (message.type === 'translate') {
    try {
      const startedAt = performance.now();
      const output = translatorWorkerTranslate(String(message.text || ''));
      self.postMessage({ type: 'translated', requestId: message.requestId, output, durationMs: performance.now() - startedAt });
    } catch (error) {
      self.postMessage({ type: 'error', requestId: message.requestId, error: translatorWorkerError(error) });
    }
  }
});

}

// Retain direct-worker support for localhost or other tuple origins.
if (typeof document === 'undefined' && typeof importScripts === 'function') {
  importScripts('../vendor/bergamot/bergamot-translator.js');
  importScripts('../vendor/bergamot/bergamot-wasm-data.js');
  morpheusTranslatorWorkerBootstrap();
}
