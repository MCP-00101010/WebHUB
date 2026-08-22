const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'source/focus-session-widget.js'), 'utf8');

function createContext(extra = {}) {
  const cache = new Map();
  const notificationCalls = { scheduled: [], cancelled: [], published: [], permission: true };
  const context = vm.createContext({
    WIDGET_REGISTRY: {},
    WidgetSDK: {
      cache: {
        get: (type, id, key) => cache.get(`${type}:${id}:${key}`) || null,
        set: (type, id, key, value) => cache.set(`${type}:${id}:${key}`, JSON.parse(JSON.stringify(value))),
        remove: (type, id, key) => cache.delete(`${type}:${id}:${key}`)
      },
      runtime: { schedule: () => {}, cancelSchedule: () => {} },
      notifications: {
        schedule: async job => { notificationCalls.scheduled.push(job); return true; },
        cancel: async id => { notificationCalls.cancelled.push(id); return true; },
        publish: async event => { notificationCalls.published.push(event); return event; },
        requestPermission: async () => notificationCalls.permission
      }
    },
    state: { boards: [], navItems: [], sets: [] },
    getBoardTabs: board => board.tabs || [],
    Date,
    Intl,
    Math,
    Number,
    Object,
    String,
    Map,
    Promise,
    setTimeout,
    clearTimeout,
    ...extra
  });
  context.__cache = cache;
  context.__notificationCalls = notificationCalls;
  vm.runInContext(source, context);
  return context;
}

function makeWidget(config = {}) {
  return {
    id: 'focus-1', type: 'widget', widgetType: 'focusSession', data: {},
    config: {
      preset: 'custom', workMinutes: 1, breakMinutes: 1, longBreakMinutes: 2, longBreakEvery: 2,
      autoStartNext: false, showDailyTotals: true, launchTarget: '', warnCalendarConflicts: true, notifications: false,
      ...config
    }
  };
}

test('focus timer uses an absolute deadline across pause and resume', () => {
  const context = createContext();
  context.widget = makeWidget();
  vm.runInContext('runtime = _focusDefaultRuntime(widget); _focusStartTimer(widget, runtime, 1000)', context);
  assert.equal(context.runtime.endsAt, 61000);
  vm.runInContext('_focusPauseTimer(runtime, 21000)', context);
  assert.equal(context.runtime.status, 'paused');
  assert.equal(context.runtime.remainingMs, 40000);
  vm.runInContext('_focusStartTimer(widget, runtime, 50000)', context);
  assert.equal(context.runtime.endsAt, 90000);
  assert.equal(vm.runInContext('_focusRemainingMs(widget, runtime, 70000)', context), 20000);
});

test('an elapsed phase is reconciled after reload without timer drift', () => {
  const context = createContext();
  context.widget = makeWidget();
  vm.runInContext('runtime = _focusDefaultRuntime(widget); _focusStartTimer(widget, runtime, 1000); _focusPersistRuntime(widget, runtime); _focusSessionRuntimeMemory.clear()', context);
  vm.runInContext('restored = _focusReadRuntime(widget); changed = _focusAdvanceExpired(widget, restored, 70000)', context);
  assert.equal(context.changed, true);
  assert.equal(context.restored.phase, 'break');
  assert.equal(context.restored.status, 'paused');
  assert.equal(context.restored.completedWorkSessions, 1);
  assert.equal(context.restored.history.length, 1);
  assert.equal(context.restored.history[0].skipped, false);
});

test('automatic sequences advance through short and long breaks from anchored deadlines', () => {
  const context = createContext();
  context.widget = makeWidget({ autoStartNext: true });
  vm.runInContext('runtime = _focusDefaultRuntime(widget); _focusStartTimer(widget, runtime, 1000); _focusAdvanceExpired(widget, runtime, 121001)', context);
  assert.equal(context.runtime.phase, 'work');
  assert.equal(context.runtime.status, 'running');
  assert.equal(context.runtime.endsAt, 181000);
  assert.equal(context.runtime.completedWorkSessions, 1);
  vm.runInContext('_focusAdvanceExpired(widget, runtime, 181001)', context);
  assert.equal(context.runtime.phase, 'longBreak');
  assert.equal(context.runtime.endsAt, 301000);
  assert.equal(context.runtime.completedWorkSessions, 2);
});

test('skip and reset preserve history while excluding skipped work from daily totals', () => {
  const context = createContext();
  context.widget = makeWidget();
  vm.runInContext('runtime = _focusDefaultRuntime(widget); _focusStartTimer(widget, runtime, 1000); _focusSkipTimer(widget, runtime, 31000)', context);
  assert.equal(context.runtime.phase, 'break');
  assert.equal(context.runtime.history[0].skipped, true);
  assert.equal(vm.runInContext('_focusDailySummary(runtime, 31000).sessions', context), 0);
  vm.runInContext('_focusResetTimer(widget, runtime)', context);
  assert.equal(context.runtime.status, 'idle');
  assert.equal(context.runtime.phase, 'work');
  assert.equal(context.runtime.history.length, 1);
  assert.equal(context.runtime.sessionActive, false);
});

test('daily totals count completed focus phases only for the local day', () => {
  const context = createContext();
  const today = new Date(2026, 7, 17, 12).getTime();
  const yesterday = new Date(2026, 7, 16, 12).getTime();
  context.runtime = {
    history: [
      { phase: 'work', endedAt: today, durationMs: 25 * 60000, skipped: false },
      { phase: 'break', endedAt: today, durationMs: 5 * 60000, skipped: false },
      { phase: 'work', endedAt: today, durationMs: 10 * 60000, skipped: true },
      { phase: 'work', endedAt: yesterday, durationMs: 50 * 60000, skipped: false }
    ]
  };
  const summary = vm.runInContext(`_focusDailySummary(runtime, ${today})`, context);
  assert.equal(summary.sessions, 1);
  assert.equal(summary.milliseconds, 25 * 60000);
});

test('calendar warnings find timed overlaps and ignore all-day entries', () => {
  const calendarRuntime = new Map([
    ['calendar-1', { events: [
      { title: 'All day', start: 0, end: 86400000, allDay: true },
      { title: 'Stand-up', start: 20000, end: 40000, allDay: false }
    ] }]
  ]);
  const context = createContext({ _calendarRuntime: calendarRuntime });
  const conflict = vm.runInContext('_focusFindCalendarConflict(10000, 30000)', context);
  assert.equal(conflict.title, 'Stand-up');
  assert.equal(vm.runInContext('_focusFindCalendarConflict(50000, 60000)', context), null);
});

test('phase notifications publish through the shared notification service', async () => {
  const context = createContext();
  context.widget = makeWidget({ notifications: true });
  assert.equal(vm.runInContext("_focusNotify(widget, 'work', 'break', 61000)", context), true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(context.__notificationCalls.published.length, 1);
  assert.equal(context.__notificationCalls.published[0].dedupeKey, 'focus:focus-1:61000');
});

test('notification opt-in requests permission and disables itself when denied', async () => {
  const notices = [];
  const context = createContext({ showNotice: message => notices.push(message) });
  context.__notificationCalls.permission = false;
  context.widget = makeWidget({ notifications: true });
  assert.equal(await vm.runInContext('_focusRequestNotificationPermission(widget)', context), true);
  assert.equal(context.widget.config.notifications, false);
  assert.match(notices[0], /not granted/);
});

test('optional Set launch deduplicates URLs and stays user-triggered', () => {
  const opened = [];
  const set = { id: 'set-1', title: 'Work', items: [
    { type: 'bookmark', url: 'https://one.example/' },
    { type: 'bookmark', url: 'https://one.example/' },
    { type: 'bookmark', url: 'https://two.example/' }
  ] };
  const context = createContext({
    state: { boards: [], navItems: [], sets: [set] },
    findSetById: id => id === set.id ? set : null,
    resolveSetItems: value => value.items,
    openHubBookmark: bookmark => opened.push(bookmark.url)
  });
  context.widget = makeWidget({ launchTarget: 'set:set-1' });
  assert.equal(vm.runInContext('_focusLaunchTarget(widget)', context), true);
  assert.deepEqual(opened, ['https://one.example/', 'https://two.example/']);
});

test('optional folder launch resolves nested bookmarks from the configured board', () => {
  const opened = [];
  const folder = {
    id: 'folder-1', type: 'folder', title: 'Research', children: [
      { type: 'bookmark', url: 'https://paper.example/' },
      { id: 'folder-2', type: 'folder', title: 'Notes', children: [{ type: 'bookmark', url: 'https://notes.example/' }] }
    ]
  };
  const board = { id: 'board-1', title: 'Work', tabs: [{ title: 'Today', columns: [{ title: 'Main', items: [folder] }] }] };
  const context = createContext({
    state: { boards: [board], navItems: [], sets: [] },
    getBoardTabs: value => value.tabs,
    isDynamicFolder: () => false,
    resolveFolderChildren: value => value.children,
    openHubBookmark: bookmark => opened.push(bookmark.url)
  });
  context.widget = makeWidget({ launchTarget: 'folder:folder-1' });
  assert.equal(vm.runInContext('_focusLaunchTarget(widget)', context), true);
  assert.deepEqual(opened, ['https://paper.example/', 'https://notes.example/']);
});

test('focus runtime and history remain in local SDK cache rather than widget data', () => {
  const context = createContext();
  context.widget = makeWidget();
  vm.runInContext('runtime = _focusDefaultRuntime(widget); runtime.completedWorkSessions = 3; _focusPersistRuntime(widget, runtime)', context);
  assert.deepEqual(context.widget.data, {});
  assert.ok(context.__cache.has('focusSession:focus-1:runtime'));
  assert.deepEqual(JSON.parse(JSON.stringify(context.WIDGET_REGISTRY.focusSession.defaultData)), {});
});

test('focus history disclosure survives runtime recreation', () => {
  const context = createContext();
  context.widget = makeWidget();
  vm.runInContext('runtime = _focusDefaultRuntime(widget); runtime.historyOpen = true; _focusPersistRuntime(widget, runtime); _focusSessionRuntimeMemory.clear();', context);
  assert.equal(vm.runInContext('_focusReadRuntime(widget).historyOpen', context), true);
});

test('multiple Focus widget instances keep independent timer state', () => {
  const context = createContext();
  context.first = makeWidget();
  context.second = { ...makeWidget(), id: 'focus-2', config: { ...makeWidget().config } };
  vm.runInContext('firstRuntime = _focusDefaultRuntime(first); secondRuntime = _focusDefaultRuntime(second); _focusStartTimer(first, firstRuntime, 1000); secondRuntime.completedWorkSessions = 7; _focusPersistRuntime(first, firstRuntime); _focusPersistRuntime(second, secondRuntime)', context);
  assert.equal(context.__cache.get('focusSession:focus-1:runtime').status, 'running');
  assert.equal(context.__cache.get('focusSession:focus-2:runtime').status, 'idle');
  assert.equal(context.__cache.get('focusSession:focus-2:runtime').completedWorkSessions, 7);
});

test('Focus Session exposes the complete SDK contract for board and sidebar use', () => {
  const context = createContext();
  const descriptor = context.WIDGET_REGISTRY.focusSession;
  assert.deepEqual(JSON.parse(JSON.stringify(descriptor.allowedIn)), ['column', 'navpane']);
  assert.equal(descriptor.category, 'Personal & Productivity');
  assert.equal(descriptor.capabilities.timers, true);
  assert.equal(descriptor.capabilities.notifications.optional, true);
  assert.equal(descriptor.capabilities.localCache.quotaBytes, 128 * 1024);
  assert.equal(typeof descriptor.beforeSettingsCommit, 'function');
  assert.equal(typeof descriptor.cleanup, 'function');
  assert.equal(typeof descriptor.renderSettings, 'function');
});

test('Focus assets load after the SDK and include compact sidebar styling', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'source/focus-session-widget.css'), 'utf8');
  assert.ok(html.indexOf('source/widget-sdk.js') < html.indexOf('source/focus-session-widget.js'));
  assert.match(html, /source\/focus-session-widget\.css/);
  assert.match(css, /focus-session--navpane/);
  assert.match(css, /@container \(max-width: 250px\)/);
  assert.match(source, /endsAt/);
});
