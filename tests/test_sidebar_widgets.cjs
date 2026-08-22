const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

function registryBlock(source, widgetType, nextMarker) {
  const start = source.indexOf(`WIDGET_REGISTRY['${widgetType}']`);
  const end = source.indexOf(nextMarker, start);
  return source.slice(start, end);
}

test('Clock uses its full Hub presentation and timer in the sidebar', () => {
  const widgets = fs.readFileSync(path.join(root, 'source/widgets.js'), 'utf8');
  const block = registryBlock(widgets, 'clock', "WIDGET_REGISTRY['countdown']");
  assert.match(block, /allowedIn: \['column', 'navpane'\]/);
  assert.match(block, /el\.className = 'widget-clock'/);
  assert.match(block, /widget-clock-time/);
  assert.match(block, /widget-clock-date/);
  assert.match(block, /_setWidgetTimer\(widget\.id, context, tick, 1000\)/);
  assert.doesNotMatch(block, /context === 'navpane'|nav-widget-clock/);
});

test('Countdown uses its full Hub presentation and context timer in the sidebar', () => {
  const widgets = fs.readFileSync(path.join(root, 'source/widgets.js'), 'utf8');
  const block = registryBlock(widgets, 'countdown', '// ---- Notes widget ----');
  assert.match(block, /allowedIn: \['column', 'navpane'\]/);
  assert.match(block, /el\.className = 'widget-countdown'/);
  assert.match(block, /widget-countdown-label/);
  assert.match(block, /widget-countdown-value/);
  assert.match(block, /_widgetTimers\.get\(`\$\{widget\.id\}:\$\{context\}`\)/);
  assert.doesNotMatch(block, /context === 'navpane'|nav-widget-countdown|_fmtCountdownCompact/);
});

test('Notes persists edits promptly and restores its editing position locally', () => {
  const widgets = fs.readFileSync(path.join(root, 'source/widgets.js'), 'utf8');
  const block = registryBlock(widgets, 'notes', '// ---- To-do list widget ----');
  assert.match(widgets, /function _notesReadView\(widgetId\)/);
  assert.match(widgets, /function _notesWriteView\(widgetId, textarea\)/);
  assert.match(block, /_notesScheduleSave\(widget\.id\)/);
  assert.match(block, /ta\.scrollTop = view\.scrollTop/);
  assert.match(block, /ta\.setSelectionRange/);
  assert.match(block, /capabilities: \{ localCache: \{ quotaBytes: 32 \* 1024 \} \}/);
});

test('sidebar widget host preserves regular widget width and interactions', () => {
  const widgets = fs.readFileSync(path.join(root, 'source/widgets.js'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'source/styles.css'), 'utf8');
  const render = fs.readFileSync(path.join(root, 'source/render.js'), 'utf8');
  assert.match(styles, /\.nav-widget-body\s*\{[^}]*display:\s*block;[^}]*width:\s*100%;[^}]*min-width:\s*0/s);
  assert.match(styles, /\.nav-widget-item:hover \.widget-action-btn/);
  assert.doesNotMatch(styles, /\.nav-widget-clock\s*\{|\.nav-widget-countdown\s*\{/);
  assert.match(widgets, /function _widgetInteractiveDragTarget\(target\)/);
  assert.match(render, /dragStartedOnInteractiveControl = _widgetInteractiveDragTarget\(event\.target\)/);
  assert.match(render, /dragStartedOnInteractiveControl \|\| _widgetInteractiveDragTarget\(e\.target\)/);
  assert.match(render, /if \(_widgetInteractiveDragTarget\(e\.target\)\) \{ e\.stopPropagation\(\); return; \}/);
  assert.match(render, /_appendWidgetActionButtons\(el, item, body, 'navpane'/);
  assert.match(render, /sidebarBottomAvailable: !parent/);
  assert.match(widgets, /function _appendWidgetActionButtons\(host, widget, body, context, options = \{\}\)/);
  assert.match(widgets, /settingsBtn\.className = 'widget-action-btn'/);
  assert.match(widgets, /reloadBtn\.className = 'widget-action-btn widget-action-btn--reload'/);
});

test('bottom-aligned sidebar widgets form a stable reorderable group', () => {
  const render = fs.readFileSync(path.join(root, 'source/render.js'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'source/styles.css'), 'utf8');
  const widgets = fs.readFileSync(path.join(root, 'source/widgets.js'), 'utf8');
  const contextSource = fs.readFileSync(path.join(root, 'source/context.js'), 'utf8');
  const dnd = fs.readFileSync(path.join(root, 'source/dnd.js'), 'utf8');
  const helperStart = render.indexOf('function _isBottomAlignedNavWidget');
  const helperEnd = render.indexOf('\nfunction createNavItem', helperStart);
  const context = vm.createContext({});
  vm.runInContext(render.slice(helperStart, helperEnd), context);
  context.items = [
    { id: 'regular-a', type: 'board' },
    { id: 'bottom-a', type: 'widget', config: { sidebarBottom: true } },
    { id: 'regular-b', type: 'title' },
    { id: 'bottom-b', type: 'widget', config: { sidebarBottom: true } }
  ];
  const firstOrder = vm.runInContext('_orderedNavItemsForRender(items).map(item => item.id)', context);
  assert.deepEqual(JSON.parse(JSON.stringify(firstOrder)), ['regular-a', 'regular-b', 'bottom-a', 'bottom-b']);
  context.items = [context.items[0], context.items[3], context.items[2], context.items[1]];
  const reordered = vm.runInContext('_orderedNavItemsForRender(items).map(item => item.id)', context);
  assert.deepEqual(JSON.parse(JSON.stringify(reordered)), ['regular-a', 'regular-b', 'bottom-b', 'bottom-a']);
  assert.match(render, /bottomGroup\.className = 'nav-bottom-widget-group'/);
  assert.match(render, /state\.navItems\.splice\(0, state\.navItems\.length, \.\.\.orderedItems\)/);
  assert.match(styles, /\.nav-bottom-widget-group\s*\{[^}]*margin-top:\s*auto/s);
  assert.match(dnd, /_navPlacementGroupsMatch\(item\)/);
  assert.match(dnd, /function _navInsertionSplitRatio[\s\S]*?draggedIndex > targetIndex \? 0\.68 : 0\.5/);
  assert.match(dnd, /rect\.height \* splitRatio \? 'before' : 'after'/);
  assert.match(dnd, /animate: !parentEl\.classList\.contains\('nav-bottom-widget-group'\)/);
  assert.match(dnd, /function _insertDragPreview\(clone, parent, beforeEl, options = \{\}\)[\s\S]*?options\.animate === false[\s\S]*?clone\.style\.opacity = '0\.5'/);
  assert.match(dnd, /_navDraggedItemIsBottomAligned\(\) && bottomGroup[\s\S]*?_moveNavPreview\(bottomGroup, null\)/);
  assert.match(dnd, /_moveNavPreview\(elements\.navList, bottomGroup \|\| null\)/);
  assert.match(widgets, /Align at sidebar bottom/);
  assert.match(widgets, /placementInput\.dataset\.cfg = 'sidebarBottom'/);
  assert.match(contextSource, /widgetContext: contextTarget\.area === 'nav-item' \? 'navpane' : 'column'/);
  assert.match(contextSource, /widgetContext: 'navpane'/);
});
