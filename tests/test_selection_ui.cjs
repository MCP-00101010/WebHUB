const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('selection checkbox keeps its visual size while exposing a larger hit target', () => {
  const styles = fs.readFileSync(path.join(__dirname, '..', 'source', 'styles.css'), 'utf8');
  assert.match(styles, /\.item-checkbox\s*\{[\s\S]*?width:\s*15px;[\s\S]*?height:\s*15px;/);
  assert.match(styles, /\.item-checkbox::before\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?inset:\s*-5px;/);
});

test('board and Import Manager checkbox clicks stop bookmark activation', () => {
  for (const filename of ['render-items.js', 'import.js']) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'source', filename), 'utf8');
    assert.match(source, /checkbox\.addEventListener\('click',[\s\S]*?stopPropagation\(\);[\s\S]*?preventDefault\(\);/);
  }
});
