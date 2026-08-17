const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'source/saved-sessions-widget.js'), 'utf8');
const sdkSource = fs.readFileSync(path.join(root, 'source/widget-sdk.js'), 'utf8');

function createContext(extra = {}) {
  const saves = [];
  const undo = [];
  const context = vm.createContext({
    WIDGET_REGISTRY: {},
    state: { savedSessions: [] },
    bridge: { supports: () => false },
    saveState: () => { saves.push(JSON.parse(JSON.stringify(context.state.savedSessions))); return Promise.resolve(); },
    pushUndoSnapshot: () => undo.push(true),
    Date,
    Intl,
    Math,
    Number,
    Object,
    String,
    URL,
    Set,
    Map,
    Promise,
    structuredClone,
    setTimeout,
    clearTimeout,
    localStorage: { length: 0, key: () => null, getItem: () => null, setItem() {}, removeItem() {} },
    ...extra
  });
  context.__saves = saves;
  context.__undo = undo;
  vm.runInContext(sdkSource, context);
  vm.runInContext(source, context);
  vm.runInContext('WidgetSDK.registry.adoptBuiltins()', context);
  return context;
}

function widget(config = {}) {
  return {
    id: 'saved-widget-1', type: 'widget', widgetType: 'savedSessions', data: {},
    config: { defaultCaptureScope: 'window', staggerMs: 125, recreateGroups: true, previewIcons: 4, ...config }
  };
}

test('session normalization keeps portable metadata and removes duplicate or unsupported tabs', () => {
  const context = createContext();
  context.raw = {
    id: 'session-1', windowId: 9, title: 'Work', createdAt: '2026-08-17T10:00:00.000Z',
    updatedAt: '2026-08-17T11:00:00.000Z', lastLaunchedAt: '2026-08-17T12:00:00.000Z',
    tabs: [
      { id: 1, windowId: 9, title: 'Docs', url: 'https://example.com/docs?utm_source=test#one', pinned: true, group: { id: 4, title: 'Research', color: 'blue' } },
      { id: 2, title: 'Duplicate', url: 'https://example.com/docs#two' },
      { id: 3, title: 'Internal', url: 'about:config' }
    ]
  };
  const session = vm.runInContext('_savedSessionsNormalizeSession(raw)', context);
  assert.equal(session.tabs.length, 1);
  assert.equal(session.tabs[0].pinned, true);
  assert.deepEqual(JSON.parse(JSON.stringify(session.tabs[0].group)), { title: 'Research', color: 'blue' });
  assert.equal(session.lastLaunchedAt, '2026-08-17T12:00:00.000Z');
  assert.equal(JSON.stringify(session).includes('windowId'), false);
  assert.equal(JSON.stringify(session).includes('"id":1'), false);
  assert.equal(JSON.stringify(session).includes('faviconCache'), false);
});

test('capture requires the Firefox session capability and sanitizes bridge results', async () => {
  const missing = createContext();
  await assert.rejects(vm.runInContext("_savedSessionsCapture('window')", missing), /unavailable/);

  const bridge = {
    supports: capability => capability === 'browserSessions',
    captureBrowserSession: async () => ({
      title: 'Firefox Session', createdAt: '2026-08-17T10:00:00.000Z',
      tabs: [{ id: 44, windowId: 2, title: 'One', url: 'https://one.example/' }]
    })
  };
  const context = createContext({ bridge });
  const session = await vm.runInContext("_savedSessionsCapture('window', 'Morning')", context);
  assert.equal(session.title, 'Morning');
  assert.equal(session.tabs.length, 1);
  assert.equal(JSON.stringify(session).includes('windowId'), false);
});

test('create, replace, and append mutations preserve identity and deduplicate URLs', async () => {
  let captureCount = 0;
  const bridge = {
    supports: () => true,
    captureBrowserSession: async () => {
      captureCount += 1;
      return captureCount === 1
        ? { title: 'First', tabs: [{ title: 'One', url: 'https://one.example/' }] }
        : captureCount === 2
          ? { title: 'Replacement', tabs: [{ title: 'Two', url: 'https://two.example/' }] }
          : { title: 'Append', tabs: [{ title: 'Two again', url: 'https://two.example/#again' }, { title: 'Three', url: 'https://three.example/' }] };
    }
  };
  const context = createContext({ bridge });
  context.widget = widget();
  vm.runInContext('runtime = _savedSessionsRuntimeFor(widget)', context);
  const created = await vm.runInContext("_savedSessionsCaptureMutation(widget, runtime, 'create', null, 'Named')", context);
  const originalId = created.id;
  await vm.runInContext("_savedSessionsCaptureMutation(widget, runtime, 'replace', state.savedSessions[0])", context);
  assert.equal(context.state.savedSessions[0].id, originalId);
  assert.deepEqual(Array.from(context.state.savedSessions[0].tabs, tab => tab.url), ['https://two.example/']);
  await vm.runInContext("_savedSessionsCaptureMutation(widget, runtime, 'append', state.savedSessions[0])", context);
  assert.deepEqual(Array.from(context.state.savedSessions[0].tabs, tab => tab.url), ['https://two.example/', 'https://three.example/']);
  assert.equal(context.__undo.length, 3);
  assert.equal(context.__saves.length, 3);
});

test('bridge launch reports partial failure, grouping degradation, and updates last-launched metadata', async () => {
  const calls = [];
  const bridge = {
    supports: () => true,
    launchBrowserSession: async (tabs, options) => { calls.push({ tabs, options }); return { opened: 1, failed: 1, groupingSupported: false }; }
  };
  const context = createContext({ bridge });
  context.widget = widget({ staggerMs: 250, recreateGroups: true });
  context.session = vm.runInContext("_savedSessionsNormalizeSession({ id: 's', title: 'Two', tabs: [{ url: 'https://one.example/' }, { url: 'https://bad.example/' }] })", context);
  const result = await vm.runInContext('_savedSessionsLaunch(widget, session)', context);
  assert.equal(result.opened, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.groupingSupported, false);
  assert.equal(calls[0].options.staggerMs, 250);
  assert.equal(calls[0].options.recreateGroups, true);
  assert.match(context.session.lastLaunchedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('cross-browser launch fallback opens portable URLs without claiming group support', async () => {
  const opened = [];
  const document = {
    body: { appendChild() {} },
    createElement: () => ({ style: {}, click() { opened.push(this.href); }, remove() {} })
  };
  const context = createContext({ document });
  context.widget = widget();
  context.session = vm.runInContext("_savedSessionsNormalizeSession({ title: 'Fallback', tabs: [{ url: 'https://one.example/' }, { url: 'https://two.example/' }] })", context);
  const result = await vm.runInContext('_savedSessionsLaunch(widget, session)', context);
  assert.deepEqual(opened, ['https://one.example/', 'https://two.example/']);
  assert.equal(result.opened, 2);
  assert.equal(result.groupingSupported, false);
  assert.equal(result.fallback, true);
});

test('large launches require confirmation before their action runs', () => {
  let prompt = '';
  let ran = false;
  const context = createContext({ showConfirmDialog: (message, callback) => { prompt = message; context.callback = callback; } });
  context.action = () => { ran = true; };
  assert.equal(vm.runInContext('_savedSessionsRunLargeAction(11, action)', context), true);
  assert.equal(ran, false);
  assert.match(prompt, /11 tabs/);
  context.callback();
  assert.equal(ran, true);
});

test('duplicating a session deep-copies group metadata and resets launch history', () => {
  const context = createContext();
  context.session = vm.runInContext("_savedSessionsNormalizeSession({ id: 'original', title: 'Work', lastLaunchedAt: '2026-08-17T12:00:00.000Z', tabs: [{ title: 'One', url: 'https://one.example/', group: { title: 'Docs', color: 'blue' } }] })", context);
  const copy = vm.runInContext('_savedSessionsClone(session)', context);
  assert.notEqual(copy.id, 'original');
  assert.equal(copy.title, 'Work copy');
  assert.equal(copy.lastLaunchedAt, null);
  copy.tabs[0].group.title = 'Changed';
  assert.equal(context.session.tabs[0].group.title, 'Docs');
});

test('shared-state normalization preserves session timestamps and removes duplicate URLs', () => {
  const stateSource = fs.readFileSync(path.join(root, 'source/state.js'), 'utf8');
  const start = stateSource.indexOf('function normalizeSavedSessionTabs');
  const end = stateSource.indexOf('\nfunction touchSet', start);
  const context = vm.createContext({ Date, URL, Set });
  vm.runInContext(stateSource.slice(start, end), context);
  context.sessions = [{
    id: 'saved', title: 'Saved', createdAt: '2026-08-17T10:00:00.000Z', updatedAt: '2026-08-17T11:00:00.000Z', lastLaunchedAt: '2026-08-17T12:00:00.000Z',
    tabs: [{ url: 'https://example.com/?utm_source=x#one' }, { url: 'https://example.com/#two' }]
  }];
  const normalized = vm.runInContext('normalizeSavedSessionsState(sessions)', context);
  assert.equal(normalized[0].tabs.length, 1);
  assert.equal(normalized[0].updatedAt, '2026-08-17T11:00:00.000Z');
  assert.equal(normalized[0].lastLaunchedAt, '2026-08-17T12:00:00.000Z');
});

test('Hub Tools keeps widget session metadata and refreshes widget instances', () => {
  const phaseTwo = fs.readFileSync(path.join(root, 'source/phase2-tools.js'), 'utf8');
  assert.match(phaseTwo, /lastLaunchedAt:\s*session\.lastLaunchedAt \|\| null/);
  assert.match(phaseTwo, /session\.lastLaunchedAt = new Date\(\)\.toISOString\(\)/);
  assert.match(phaseTwo, /typeof _savedSessionsRefreshWidgets === 'function'/);
});

test('Saved Sessions exposes a complete optional-bridge SDK contract', () => {
  const context = createContext();
  const descriptor = context.WIDGET_REGISTRY.savedSessions;
  assert.deepEqual(JSON.parse(JSON.stringify(descriptor.allowedIn)), ['column', 'navpane']);
  assert.equal(descriptor.category, 'Personal & Productivity');
  assert.equal(descriptor.capabilities.extensionRelay.optional, true);
  assert.deepEqual(JSON.parse(JSON.stringify(descriptor.defaultData)), {});
  assert.equal(typeof descriptor.render, 'function');
  assert.equal(typeof descriptor.renderSettings, 'function');
  assert.equal(typeof descriptor.cleanup, 'function');
});

test('Saved Sessions assets load after the SDK and cover favicons and compact layouts', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'source/saved-sessions-widget.css'), 'utf8');
  assert.ok(html.indexOf('source/widget-sdk.js') < html.indexOf('source/saved-sessions-widget.js'));
  assert.match(html, /source\/saved-sessions-widget\.css/);
  assert.match(source, /resolveFaviconSource\(/);
  assert.match(source, /faviconCache: ''/);
  assert.match(css, /saved-sessions-widget--navpane/);
  assert.match(css, /@container \(max-width: 300px\)/);
});
