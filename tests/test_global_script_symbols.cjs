const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('classic Hub scripts do not silently override top-level function declarations', () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script[^>]+src="([^"]+\.js)"/g)]
    .map(match => match[1])
    .filter(file => file.startsWith('source/'));
  const declarations = new Map();

  for (const file of scripts) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    for (const match of source.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm)) {
      const locations = declarations.get(match[1]) || [];
      locations.push(file);
      declarations.set(match[1], locations);
    }
  }

  const duplicates = [...declarations]
    .filter(([, locations]) => locations.length > 1)
    .map(([name, locations]) => `${name}: ${locations.join(', ')}`);
  assert.deepEqual(duplicates, []);
});

test('Import Manager exposes distinct item and path selectors', () => {
  const stateSource = fs.readFileSync(path.join(__dirname, '..', 'source', 'state.js'), 'utf8');
  const importSource = fs.readFileSync(path.join(__dirname, '..', 'source', 'import.js'), 'utf8');
  assert.match(stateSource, /function findImportManagerItemPath\(itemId\)/);
  assert.match(importSource, /function getImportManagerItemById\(itemId,/);
  assert.doesNotMatch(`${stateSource}\n${importSource}`, /function findImportManagerItemById\(/);
});
