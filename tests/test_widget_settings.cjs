const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('widget settings use a full draft and restore original data on cancel', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'source', 'widgets.js'), 'utf8');
  const settings = source.match(/function openWidgetSettings[\s\S]*?\/\/ ={20,}\n\/\/ Built-in widgets/)?.[0] || '';
  assert.match(settings, /const savedData\s*= cloneData\(widget\.data\)/);
  assert.match(settings, /const draftWidget =/);
  assert.match(settings, /def\.renderSettings\(draftWidget, body\)/);
  assert.match(settings, /restoreSavedWidget\(\);\s*if \(!options\.deferUndo\) pushUndoSnapshot\(\);\s*applyDraftToWidget\(\)/);
  assert.match(settings, /widget\.data = cloneData\(savedData\)/);
});

test('widget setting values are escaped and shared networking loads before widgets', () => {
  const widgets = fs.readFileSync(path.join(__dirname, '..', 'source', 'widgets.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(widgets, /function _escapeWidgetSettingValue/);
  assert.match(widgets, /_escapeWidgetSettingValue\(c\.content\)/);
  assert.ok(html.indexOf('source/widget-network.js') < html.indexOf('source/widgets.js'));
});
