const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'source', 'recent-files-widget.js'), 'utf8');
function context() { const sandbox = vm.createContext({ WIDGET_REGISTRY: {}, console, WidgetSDK: { cache: { get: () => null, set() {} }, nativeHost: { supports: () => false } }, document: {} }); vm.runInContext(source, sandbox); return sandbox; }

test('Recent Files normalizes opaque roots and bounded filters', () => {
  const sandbox = context();
  const result = vm.runInContext(`(() => { const widget = { config: { roots: [
    { handle: 'dir_abcdefghijklmnop', label: 'Downloads', path: 'C:/private' }, { handle: 'dir_abcdefghijklmnop', label: 'Duplicate' }
  ], extensions: '.PDF, jpg, ../../exe, pdf', maxAgeHours: 2, resultCount: 1000, recursive: 1 } }; _recentFilesRoots(widget); return widget.config; })()`, sandbox);
  assert.equal(result.roots.length, 1);
  assert.equal(Object.hasOwn(result.roots[0], 'path'), false);
  assert.equal(result.extensions, 'pdf, jpg');
  assert.equal(result.maxAgeHours, 168);
  assert.equal(result.resultCount, 30);
  assert.equal(result.recursive, false);
});

test('Recent Files uses fixed native actions and local cache only', () => {
  const sandbox = context();
  assert.equal(vm.runInContext(`_recentFilesIcon('pdf')`, sandbox), '▤');
  assert.doesNotMatch(source, /\blocalStorage\b|\bfetch\s*\(|child_process|exec\s*\(/);
  assert.match(source, /'openApprovedFile'/);
  assert.match(source, /WidgetSDK\.cache\.set\('recentFiles'/);
});
