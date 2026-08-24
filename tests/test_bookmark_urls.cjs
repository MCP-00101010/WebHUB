const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const stateSource = fs.readFileSync(path.join(__dirname, '..', 'source', 'state.js'), 'utf8');
const validationStart = stateSource.indexOf('function isValidUrl(');
const validationEnd = stateSource.indexOf('function isDescendant(', validationStart);
assert.ok(validationStart >= 0 && validationEnd > validationStart, 'bookmark URL helpers should be present');

const context = vm.createContext({ URL });
vm.runInContext(stateSource.slice(validationStart, validationEnd), context);

test('bookmark URLs accept and canonicalize local file pages', () => {
  const emuGuiUrl = 'file:///F:/Projects/Coding/Morpheus%20EmuGUI/web/index.html';
  assert.equal(context.isValidUrl(emuGuiUrl), true);
  assert.equal(context.normalizeUrl(emuGuiUrl), emuGuiUrl);
  assert.equal(context.isValidUrl('file:///F:/Projects/Coding/Morpheus EmuGUI/web/index.html'), true);
  assert.equal(
    context.normalizeUrl('file:///F:/Projects/Coding/Morpheus EmuGUI/web/index.html'),
    emuGuiUrl
  );
  assert.equal(context.isValidUrl('file://localhost/F:/Projects/Coding/Morpheus%20EmuGUI/web/index.html'), true);
});

test('bookmark URLs retain web support and reject privileged or remote file schemes', () => {
  assert.equal(context.isValidUrl('example.com/page'), true);
  assert.equal(context.normalizeUrl('example.com/page'), 'https://example.com/page');
  assert.equal(context.isValidUrl('http://localhost:8765/'), true);
  assert.equal(context.isValidUrl('file://remote-host/share/index.html'), false);
  assert.equal(context.isValidUrl('file:///'), false);
  assert.equal(context.isValidUrl('javascript:alert(1)'), false);
  assert.equal(context.isValidUrl('data:text/html,test'), false);
  assert.equal(context.isValidUrl(`file:///F:/bad\0name.html`), false);
});
