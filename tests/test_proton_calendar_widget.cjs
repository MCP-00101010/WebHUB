const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const calendarSource = fs.readFileSync(path.join(root, 'source', 'calendar-widget.js'), 'utf8');
const astronomyEngine = fs.readFileSync(path.join(root, 'vendor', 'astronomy-engine', 'astronomy.browser.min.js'), 'utf8');
const astronomyCatalog = fs.readFileSync(path.join(root, 'source', 'astronomy-events.js'), 'utf8');
const networkSource = fs.readFileSync(path.join(root, 'source', 'widget-network.js'), 'utf8');
const sdkSource = fs.readFileSync(path.join(root, 'source', 'widget-sdk.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'source', 'calendar-widget.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function createContext(overrides = {}) {
  const storage = new Map();
  const context = vm.createContext({
    console,
    URL,
    Intl,
    Date,
    Map,
    Set,
    Promise,
    structuredClone,
    AbortController,
    TextDecoder,
    setTimeout,
    clearTimeout,
    getServiceSecret: serviceName => serviceName === 'footballData' ? 'global-football-token' : '',
    WIDGET_REGISTRY: {},
    localStorage: {
      getItem: key => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key)
    },
    bridge: {
      secretStatus: async () => ({ available: true, provider: 'windows-credential-manager' }),
      secretGet: async () => '',
      secretSet: async () => true,
      secretDelete: async () => true,
      fetchFeed: async () => null,
      fetchCalendar: async () => null
    },
    fetch: async () => { throw new Error('network unavailable'); },
    _setWidgetRefresher() {},
    _setWidgetTimer() {},
    _refreshWidget() {},
    ...overrides
  });
  vm.runInContext(networkSource, context);
  vm.runInContext(sdkSource, context);
  vm.runInContext(calendarSource, context);
  vm.runInContext('WidgetSDK.registry.adoptBuiltins()', context);
  return { context, storage };
}

test('Calendar migrates legacy Proton sources without persisting sharing URLs', () => {
  const { context } = createContext();
  const definition = context.WIDGET_REGISTRY.protonCalendar;
  assert.equal(definition.name, 'Calendar');
  assert.equal(definition.category, 'Personal & Productivity');
  assert.deepEqual(JSON.parse(JSON.stringify(definition.allowedIn)), ['column']);
  assert.deepEqual(JSON.parse(JSON.stringify(definition.defaultConfig.calendars)), []);

  context.widget = {
    id: 'calendar-1',
    config: { calendars: [{ id: 'personal', name: 'Personal', color: '#6d4aff', url: 'https://secret.example/' }] }
  };
  const normalized = vm.runInContext('_calendarSources(widget)', context);
  assert.equal(normalized[0].type, 'proton');
  assert.equal(normalized[0].url, undefined);
  assert.doesNotMatch(JSON.stringify(context.widget.config), /secret\.example/);
});

test('ICS parser handles timed, all-day, escaped, and excluded recurring events', () => {
  const { context } = createContext();
  context.icsText = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'X-WR-CALNAME:Personal',
    'BEGIN:VEVENT',
    'UID:weekly-1',
    'DTSTART;TZID=Europe/London:20260810T090000',
    'DTEND;TZID=Europe/London:20260810T100000',
    'RRULE:FREQ=WEEKLY;COUNT=3;BYDAY=MO',
    'EXDATE;TZID=Europe/London:20260817T090000',
    'SUMMARY:Project\\, planning',
    'LOCATION:Office',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:holiday-1',
    'DTSTART;VALUE=DATE:20260812',
    'DTEND;VALUE=DATE:20260813',
    'SUMMARY:Day off',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');
  context.sourceConfig = { id: 'personal', name: 'Personal', color: '#6d4aff' };
  const parsed = vm.runInContext("_calendarParseIcs(icsText, sourceConfig, Date.parse('2026-08-01T00:00:00Z'))", context);
  assert.equal(parsed.title, 'Personal');
  assert.equal(parsed.events.length, 3);
  const meetings = parsed.events.filter(event => event.uid === 'weekly-1');
  assert.equal(meetings.length, 2);
  assert.equal(meetings[0].title, 'Project, planning');
  assert.equal(new Date(meetings[0].start).toISOString(), '2026-08-10T08:00:00.000Z');
  assert.equal(new Date(meetings[1].start).toISOString(), '2026-08-24T08:00:00.000Z');
  const allDay = parsed.events.find(event => event.uid === 'holiday-1');
  assert.equal(allDay.allDay, true);
  assert.equal(allDay.end - allDay.start, 86400000);
});

test('calendar fetch falls back to the authenticated extension text relay', async () => {
  const relayed = [];
  const { context } = createContext({
    fetch: async () => { throw new Error('CORS blocked'); },
    bridge: {
      secretStatus: async () => ({ available: true }),
      secretGet: async () => '',
      secretSet: async () => true,
      secretDelete: async () => true,
      fetchCalendar: async (url, headers) => {
        relayed.push([url, headers]);
        return { text: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR' };
      },
      fetchFeed: async url => {
        relayed.push([url, {}]);
        return { text: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR' };
      }
    }
  });
  const text = await vm.runInContext("_calendarFetchText('https://calendar.proton.me/shared/test')", context);
  assert.match(text, /VCALENDAR/);
  assert.deepEqual(JSON.parse(JSON.stringify(relayed)), [['https://calendar.proton.me/shared/test', {}]]);
});

test('settings commit stores links in Credential Manager and deletes removed source secrets', async () => {
  const writes = [];
  const deletes = [];
  const { context } = createContext({
    bridge: {
      secretStatus: async () => ({ available: true }),
      secretGet: async () => '',
      secretSet: async (key, value) => { writes.push([key, value]); return true; },
      secretDelete: async key => { deletes.push(key); return true; },
      fetchFeed: async () => null
    }
  });
  context.widget = {
    id: 'calendar-2',
    config: { calendars: [{ id: 'new', name: 'Personal', color: '#6d4aff', type: 'proton' }] },
    _calendarSecretStatus: { available: true },
    _calendarSecretLoadPromise: Promise.resolve(),
    _calendarSecretDrafts: new Map([['new', 'https://calendar.proton.me/shared/new']])
  };
  context.container = { querySelector: () => ({ textContent: '', classList: { add() {} } }) };
  context.commitContext = { savedConfig: { calendars: [{ id: 'old', name: 'Old' }] } };
  const committed = await vm.runInContext('_calendarCommitSettings(widget, container, commitContext)', context);
  assert.equal(committed, true);
  assert.deepEqual(writes, [[
    'proton-calendar:calendar-2:new',
    'https://calendar.proton.me/shared/new'
  ]]);
  assert.deepEqual(deletes, ['proton-calendar:calendar-2:old']);
});

test('public source settings commit without native secure storage', async () => {
  const { context } = createContext({ bridge: undefined });
  context.widget = {
    id: 'calendar-public',
    config: { calendars: [{ id: 'holidays', name: '', color: '#e55353', type: 'ukHolidays', region: 'scotland' }] },
    _calendarSecretStatus: { available: true, publicOnly: true },
    _calendarSecretLoadPromise: Promise.resolve(),
    _calendarSecretDrafts: new Map()
  };
  context.container = { querySelector: () => ({ textContent: '', classList: { add() {} } }) };
  const committed = await vm.runInContext('_calendarCommitSettings(widget, container, { savedConfig: { calendars: [] } })', context);
  assert.equal(committed, true);
  assert.equal(context.widget.config.calendars[0].region, 'scotland');
});

test('football sources use the global API token rather than a per-source secret', () => {
  const { context } = createContext();
  assert.equal(vm.runInContext("_calendarSourceNeedsSecret({ type: 'football' })", context), false);
  assert.equal(vm.runInContext("_calendarSourceUsesCredential({ type: 'football' })", context), true);
  assert.match(calendarSource, /getServiceSecret\('footballData'\)/);
  assert.doesNotMatch(calendarSource, /source\.type === 'football' \? 'football-data\.org API token'/);
});

test('public provider records normalize into shared chronological events', () => {
  const { context } = createContext();
  context.sourceConfig = { id: 'launches', name: 'Launches', color: '#3f8efc', type: 'launches' };
  context.values = { id: 'launch-1', title: 'Test mission', start: Date.parse('2026-08-10T10:00:00Z'), location: 'Test pad' };
  const event = vm.runInContext('_calendarProviderEvent(sourceConfig, values)', context);
  assert.equal(event.sourceId, 'launches');
  assert.equal(event.end - event.start, 3600000);
  assert.equal(event.location, 'Test pad');

  context.sportsEvent = { dateEvent: '2026-09-01', strTime: '19:30:00' };
  const timing = vm.runInContext('_calendarSportsDbDate(sportsEvent)', context);
  assert.equal(timing.allDay, false);
  assert.equal(new Date(timing.start).getMinutes(), 30);
});

test('official PDC calendar records normalize into dated all-day events', () => {
  const { context } = createContext();
  context.sourceConfig = { id: 'pdc', name: 'PDC', color: '#e55353', type: 'pdc' };
  context.pdcData = { data: [{ id: '10847', attributes: {
    name: '2026 Test Trophy', startDate: '2026-08-08', endDate: '2026-08-10',
    venue: 'Test Arena', city: 'London', isRanked: true, isTelevised: true,
    informationPage: '/tournaments/test-trophy'
  } }] };
  const events = vm.runInContext('_calendarParsePdcApi(pdcData, sourceConfig)', context);
  assert.equal(events.length, 1);
  assert.equal(events[0].title, '2026 Test Trophy');
  assert.equal(new Date(events[0].start).getMonth(), 7);
  assert.equal(events[0].end - events[0].start, 3 * 86400000);
  assert.equal(events[0].allDay, true);
  assert.equal(events[0].location, 'Test Arena · London');
  assert.equal(events[0].url, 'https://www.pdc.tv/tournaments/test-trophy');
});

test('source visibility is browser-local view state rather than widget configuration', () => {
  const { context, storage } = createContext();
  context.widget = { id: 'calendar-view', config: { defaultView: 'agenda', calendars: [] } };
  const view = vm.runInContext("_calendarWriteView(widget, { hiddenSourceIds: ['football', 'launches'] })", context);
  assert.deepEqual(JSON.parse(JSON.stringify(view.hiddenSourceIds)), ['football', 'launches']);
  assert.match(storage.get('morpheus-widget-sdk-cache:v1:protonCalendar:calendar-view:view'), /football/);
  assert.doesNotMatch(JSON.stringify(context.widget.config), /football/);
});

test('astronomy and moon-phase sources calculate their distinct events locally', () => {
  const { context } = createContext();
  vm.runInContext(astronomyEngine, context);
  vm.runInContext(astronomyCatalog, context);
  context.sourceConfig = { id: 'sky', name: 'Sky', color: '#c45ad8', type: 'astronomy' };
  const events = vm.runInContext('_calendarLoadAstronomy(sourceConfig)', context);
  assert.ok(!events.some(event => /moon/i.test(event.title)));
  assert.ok(events.some(event => /solstice|equinox/i.test(event.title)));
  assert.ok(events.some(event => /Perseids peak/.test(event.title)));
  context.moonSource = { id: 'moon', name: 'Moon phases', color: '#e09f3e', type: 'moonPhases' };
  const moonEvents = vm.runInContext('_calendarLoadMoonPhases(moonSource, new Date("2026-08-05T12:00:00Z"))', context);
  assert.ok(moonEvents.length > 100);
  assert.ok(moonEvents.some(event => event.title === 'Full moon' && event.moonPhaseAngle === 180));
  assert.ok(moonEvents.every(event => Number.isFinite(event.moonPhaseAngle)));
});

test('month day numbers open a dismissible 24-hour agenda modal', () => {
  assert.match(calendarSource, /number\.addEventListener\('click',[\s\S]*?_calendarOpenDayAgenda\(widget, runtime, dayStart\)/);
  assert.match(calendarSource, /for \(let hour = 0; hour < 24; hour \+= 1\)/);
  assert.match(calendarSource, /event\.key === 'Escape'/);
  assert.match(calendarSource, /event\.target === overlay/);
  assert.match(styles, /\.calendar-day-modal-card/);
  assert.match(styles, /\.widget-calendar-moon-phase/);
});

test('calendar assets expose secure settings and responsive agenda/month views', () => {
  assert.match(html, /source\/calendar-widget\.css/);
  assert.match(html, /source\/calendar-widget\.js/);
  assert.match(calendarSource, /UK bank holidays/);
  assert.match(calendarSource, /football-data\.org/);
  assert.match(calendarSource, /tournaments\.darts\.web\.gc\.pdcservices\.co\.uk/);
  assert.match(calendarSource, /hiddenSourceIds/);
  assert.match(calendarSource, /credentials secured locally/);
  assert.match(calendarSource, /beforeSettingsCommit/);
  assert.match(styles, /\.widget-calendar-header\s*\{[^}]*padding-right:\s*52px/s);
  assert.match(styles, /\.widget-calendar-month-grid/);
  assert.match(styles, /\.widget-calendar-content\.is-agenda/);
  assert.match(styles, /@media \(max-width: 520px\)/);
});
