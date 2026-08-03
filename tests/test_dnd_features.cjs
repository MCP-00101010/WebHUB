const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function removeById(list, itemId) {
  const index = list.findIndex(item => item.id === itemId);
  if (index !== -1) return list.splice(index, 1)[0];
  for (const item of list) {
    if (Array.isArray(item.children)) {
      const removed = removeById(item.children, itemId);
      if (removed) return removed;
    }
  }
  return null;
}

function loadDnd(items) {
  const state = { importManager: { items } };
  const context = vm.createContext({
    state,
    console,
    removeImportManagerItemById: itemId => removeById(state.importManager.items, itemId),
    stripTransientItemLocks: list => {
      const walk = nested => nested.forEach(item => {
        delete item.locked;
        if (Array.isArray(item.children)) walk(item.children);
      });
      walk(list);
      return list;
    }
  });
  const filename = path.join(__dirname, '..', 'source', 'dnd.js');
  vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  return { context, state };
}

test('multi-item Import Manager drag removes every selected bookmark in payload order', () => {
  const harness = loadDnd([
    { id: 'one', type: 'bookmark', locked: true },
    { id: 'folder', type: 'folder', children: [{ id: 'two', type: 'bookmark', locked: true }] },
    { id: 'three', type: 'bookmark' }
  ]);
  vm.runInContext("dragPayload = { area: 'import-manager', itemId: 'one', itemIds: ['one', 'two', 'three'], itemType: 'bookmark' }", harness.context);

  const moved = vm.runInContext('_takeImportManagerDraggedItems()', harness.context);
  assert.deepEqual(JSON.parse(JSON.stringify(moved.map(item => item.id))), ['one', 'two', 'three']);
  assert.equal(moved.some(item => 'locked' in item), false);
  assert.deepEqual(JSON.parse(JSON.stringify(harness.state.importManager.items)), [
    { id: 'folder', type: 'folder', children: [] }
  ]);
});

test('multi-item insertion keeps the group together beside its drop target', () => {
  const harness = loadDnd([]);
  const result = vm.runInContext(`(() => {
    const list = [{ id: 'target' }, { id: 'tail' }];
    _insertDraggedItemsRelativeToTarget(list, 'target', [{ id: 'one' }, { id: 'two' }], 'after');
    return list.map(item => item.id);
  })()`, harness.context);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), ['target', 'one', 'two', 'tail']);
});

test('multi-drag image renders every dragged bookmark in payload order', () => {
  const harness = loadDnd([]);
  const makeElement = (itemId = '') => {
    const classes = new Set(['board-column-item', 'import-manager-item']);
    return {
      dataset: { itemId, columnId: 'import-manager' },
      style: {},
      children: [],
      className: '',
      classList: {
        add: (...names) => names.forEach(name => classes.add(name)),
        remove: (...names) => names.forEach(name => classes.delete(name)),
        contains: name => classes.has(name)
      },
      cloneNode() { return makeElement(itemId); },
      querySelectorAll: () => [],
      removeAttribute: () => {},
      appendChild(child) { this.children.push(child); return child; }
    };
  };
  const sources = ['one', 'two', 'three'].map(makeElement);
  harness.context.document = {
    createElement: () => makeElement(),
    querySelectorAll: () => sources
  };
  harness.context.primaryDragElement = sources[0];
  vm.runInContext("dragPayload = { area: 'import-manager', itemId: 'one', itemIds: ['one', 'two', 'three'], itemType: 'bookmark', sourceColumnId: 'import-manager' }", harness.context);

  const renderedIds = vm.runInContext('_createMultiDragImage(primaryDragElement, 240).children.map(item => item.dataset.itemId)', harness.context);
  assert.deepEqual(JSON.parse(JSON.stringify(renderedIds)), ['one', 'two', 'three']);

  const insertionPreview = vm.runInContext("createDragPlaceholder('board')", harness.context);
  assert.deepEqual(insertionPreview.children.map(item => item.dataset.itemId), ['one', 'two', 'three']);
  assert.equal(insertionPreview.classList.contains('drag-preview'), true);
  assert.equal(insertionPreview.classList.contains('multi-drag-insertion-preview'), true);

  vm.runInContext('_hideMultiDragSourceElements(primaryDragElement)', harness.context);
  assert.equal(sources.every(source => source.classList.contains('dragging')), true);
  assert.equal(sources.every(source => source.classList.contains('multi-drag-source')), true);
  vm.runInContext('clearMultiDragSourceElements()', harness.context);
  assert.equal(sources.some(source => source.classList.contains('dragging')), false);
  assert.equal(sources.some(source => source.classList.contains('multi-drag-source')), false);
});
