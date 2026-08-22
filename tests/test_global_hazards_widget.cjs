const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'source', 'global-hazards-widget.js'), 'utf8');

function createContext(extra = {}) {
  const cache = new Map(); const notifications = [];
  const context = vm.createContext({
    WIDGET_REGISTRY: {}, Map, Set, Object, String, Number, Date, Math, Promise, URL,
    _refreshWidget() {}, _setWidgetRefresher() {},
    WidgetSDK: {
      cache: {
        get: (type, id, key) => cache.get(`${type}:${id}:${key}`) || null,
        set: (type, id, key, value) => cache.set(`${type}:${id}:${key}`, JSON.parse(JSON.stringify(value))),
        remove: (type, id, key) => cache.delete(`${type}:${id}:${key}`)
      },
      extensionRelay: { invoke: async () => { throw new Error('relay unavailable'); } },
      runtime: { schedule() {}, requestFrame(key, callback) { callback(); return { cancel() {} }; } },
      notifications: { requestPermission: async () => true, publish: async event => { notifications.push(event); return event; } }
    },
    ...extra
  });
  context.__cache = cache; context.__notifications = notifications;
  vm.runInContext(source, context);
  return context;
}

function widget(config = {}) {
  return { id: 'hazards-1', type: 'widget', widgetType: 'globalHazards', config: { ...config }, data: {} };
}

test('Global Hazards is a column-only Weather & Hazards widget with bounded capabilities', () => {
  const context = createContext(); const descriptor = context.WIDGET_REGISTRY.globalHazards;
  assert.equal(descriptor.category, 'Weather & Hazards');
  assert.deepEqual(JSON.parse(JSON.stringify(descriptor.allowedIn)), ['column']);
  assert.equal(descriptor.defaultConfig.earthquakeMagnitude, 4.5);
  assert.equal(descriptor.defaultConfig.refreshMinutes, 15);
  assert.equal(descriptor.defaultConfig.notifications, false);
  assert.equal(descriptor.defaultConfig.spaceWeather, true);
  assert.equal(descriptor.capabilities.localCache.quotaBytes, 4 * 1024 * 1024);
  assert.equal(descriptor.capabilities.notifications.optional, true);
  for (const domain of ['eonet.gsfc.nasa.gov', 'earthquake.usgs.gov', 'www.gdacs.org', 'ssd-api.jpl.nasa.gov', 'services.swpc.noaa.gov', 'tiles.openfreemap.org']) {
    assert.ok(descriptor.capabilities.network.domains.includes(domain));
  }
  assert.doesNotMatch(source, /\blocalStorage\b|\bfetch\s*\(/);
});

test('existing widget configurations receive the new map categories once without overriding later choices', () => {
  const context = createContext(); const descriptor = context.WIDGET_REGISTRY.globalHazards;
  context.legacy = widget({ categories: ['earthquake', 'storm'] });
  const migrated = descriptor.migrate(context.legacy);
  assert.deepEqual([...migrated.config.categories], ['earthquake', 'storm', 'temperature', 'airburst']);
  assert.equal(migrated.config.categorySchema, 2);
  migrated.config.categories = ['earthquake'];
  const normalized = descriptor.migrate(migrated);
  assert.deepEqual([...normalized.config.categories], ['earthquake']);
});

test('NASA EONET temperature extremes are retained as map hazards', () => {
  const context = createContext();
  context.payload = { events: [{
    id: 'EONET_TEMP', title: 'Heatwave Example', categories: [{ id: 'tempExtremes', title: 'Temperature Extremes' }],
    link: 'https://eonet.gsfc.nasa.gov/api/v3/events/EONET_TEMP',
    geometry: [{ date: '2026-08-21T00:00:00Z', type: 'Point', coordinates: [15, 45], magnitudeValue: 41, magnitudeUnit: 'C' }]
  }] };
  const events = vm.runInContext('_globalHazardNormalizeEonet(payload)', context);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'temperature');
  assert.equal(events[0].magnitude, '41 C');
});

test('NASA EONET events retain latest geometry, storm tracks, magnitude and official links', () => {
  const context = createContext();
  context.payload = { events: [{
    id: 'EONET_1', title: 'Typhoon Example', categories: [{ id: 'severeStorms', title: 'Severe Storms' }],
    link: 'https://eonet.gsfc.nasa.gov/api/v3/events/EONET_1',
    sources: [{ id: 'JTWC', url: 'https://example.test/storm.tcw' }, { id: 'REPORT', url: 'https://example.test/storm-report' }], geometry: [
      { date: '2026-08-20T00:00:00Z', type: 'Point', coordinates: [145, 12], magnitudeValue: 50, magnitudeUnit: 'kts' },
      { date: '2026-08-21T00:00:00Z', type: 'Point', coordinates: [146, 13], magnitudeValue: 100, magnitudeUnit: 'kts' }
    ]
  }] };
  const events = vm.runInContext('_globalHazardNormalizeEonet(payload)', context);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'storm');
  assert.equal(events[0].severity, 'critical');
  assert.deepEqual([...events[0].coordinates], [146, 13]);
  assert.equal(events[0].track.length, 2);
  assert.equal(events[0].magnitude, '100 kts');
  assert.equal(events[0].url, 'https://example.test/storm-report');
});

test('download-only EONET storm sources fall back to the browser-readable event endpoint', () => {
  const context = createContext();
  context.payload = { events: [{
    id: 'EONET_2', title: 'Storm download fallback', categories: [{ id: 'severeStorms' }],
    link: 'https://eonet.gsfc.nasa.gov/api/v3/events/EONET_2', sources: [{ id: 'JTWC', url: 'https://example.test/latest.tcw' }],
    geometry: [{ date: '2026-08-21T00:00:00Z', type: 'Point', coordinates: [140, 15], magnitudeValue: 70, magnitudeUnit: 'kts' }]
  }] };
  const events = vm.runInContext('_globalHazardNormalizeEonet(payload)', context);
  assert.equal(events[0].url, 'https://eonet.gsfc.nasa.gov/api/v3/events/EONET_2');
  assert.doesNotMatch(events[0].url, /\.tcw$/i);
});

test('USGS normalization derives severity and preserves its tsunami indicator', () => {
  const context = createContext();
  context.payload = { features: [{ id: 'us1', geometry: { type: 'Point', coordinates: [120, -7, 10] }, properties: {
    mag: 6.4, title: 'M 6.4 - Example region', place: 'Example region', time: 1000, updated: 2000, alert: 'orange', tsunami: 1,
    url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us1'
  } }] };
  const events = vm.runInContext('_globalHazardNormalizeUsgs(payload)', context);
  assert.equal(events[0].severity, 'high');
  assert.equal(events[0].magnitude, 'M 6.4');
  assert.equal(events[0].tsunamiPotential, true);
  assert.equal(events[0].source, 'USGS');
});

test('GDACS keeps tsunami, cyclone, orange and red alerts while suppressing duplicate green hazards', () => {
  const context = createContext();
  const feature = (eventtype, alertlevel, id) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [10 + id, 20] }, properties: {
    eventtype, eventid: id, name: `${eventtype} ${id}`, alertlevel, fromdate: '2026-08-20T00:00:00Z', datemodified: '2026-08-21T00:00:00Z',
    severitydata: { severitytext: 'Example severity' }, url: { report: `https://www.gdacs.org/report.aspx?eventid=${id}` }
  } });
  context.payload = { features: [feature('TS', 'Green', 1), feature('TC', 'Green', 2), feature('WF', 'Green', 3), feature('FL', 'Orange', 4), feature('VO', 'Red', 5)] };
  const events = vm.runInContext('_globalHazardNormalizeGdacs(payload)', context);
  assert.deepEqual([...events].map(event => event.type), ['tsunami', 'storm', 'flood', 'volcano']);
  assert.equal(events.find(event => event.type === 'volcano').severity, 'critical');
  assert.equal(events.find(event => event.type === 'flood').severity, 'high');
});

test('NASA JPL fireballs become geolocated airburst events with energy severity', () => {
  const context = createContext(); context.payload = {
    fields: ['date', 'energy', 'impact-e', 'lat', 'lat-dir', 'lon', 'lon-dir', 'alt', 'vel'],
    data: [
      ['2026-08-21 12:30:00', '4.2', '12.5', '47.7', 'N', '119.4', 'W', '30.0', '18.2'],
      ['2026-08-20 01:00:00', '2.1', '0.08', '19.5', 'S', '176.2', 'E', null, null]
    ]
  };
  const events = vm.runInContext('_globalHazardNormalizeFireballs(payload)', context);
  assert.equal(events.length, 2);
  assert.equal(events[0].type, 'airburst');
  assert.equal(events[0].severity, 'high');
  assert.deepEqual([...events[0].coordinates], [-119.4, 47.7]);
  assert.match(events[0].magnitude, /12\.5 kt estimated impact/);
  assert.equal(events[1].severity, 'info');
  assert.deepEqual([...events[1].coordinates], [176.2, -19.5]);
});

test('NOAA space-weather status retains current scales and recent scaled alerts without map coordinates', () => {
  const context = createContext(); context.widget = widget({ days: 7 });
  const now = new Date(); const stamp = now.toISOString().slice(0, 10); const time = now.toISOString().slice(11, 19);
  context.scales = { 0: { DateStamp: stamp, TimeStamp: time, G: { Scale: '2', Text: 'moderate' }, S: { Scale: '0', Text: 'none' }, R: { Scale: '1', Text: 'minor' } } };
  context.alerts = [{ product_id: 'K06A', issue_datetime: `${stamp} ${time}`, message: 'Space Weather Message Code: ALTK06\n\nALERT: Geomagnetic K-index of 6\nNoaa Scale: G2 - Moderate\nPotential Impacts: Aurora may be visible farther south.' }];
  const result = vm.runInContext('_globalHazardNormalizeSpaceWeather(scales, alerts, widget)', context);
  assert.deepEqual([...result.scales].map(item => `${item.code}${item.scale}`), ['G2', 'S0', 'R1']);
  assert.equal(result.alerts.length, 1);
  assert.equal(result.alerts[0].severity, 'high');
  assert.match(result.alerts[0].title, /Geomagnetic K-index/);
  assert.match(result.alerts[0].description, /Aurora/);
});

test('provider URLs are bounded by the configured window and earthquake threshold', () => {
  const context = createContext(); context.widget = widget({ days: 14, earthquakeMagnitude: 5.5 });
  const urls = vm.runInContext('_globalHazardUrls(widget)', context);
  assert.match(urls.eonet, /status=open&days=14&limit=300$/);
  assert.match(urls.usgs, /minmagnitude=5\.5&orderby=time&limit=1000$/);
  assert.match(urls.gdacs, /events4app$/);
  assert.match(urls.fireball, /fireball\.api\?date-min=.*&date-max=.*&req-loc=true&limit=200$/);
  assert.match(urls.swpcAlerts, /alerts\.json$/);
  assert.match(urls.swpcScales, /noaa-scales\.json$/);
});

test('hazard basemaps use the same normalized Dark and Liberty styles as Weather Map', () => {
  const context = createContext();
  assert.equal(vm.runInContext("_globalHazardMapStyle('unsupported')", context), 'dark');
  assert.equal(vm.runInContext("_globalHazardMapStyle('liberty')", context), 'liberty');
  assert.equal(vm.runInContext("_globalHazardMapStyleUrl('liberty')", context), 'https://tiles.openfreemap.org/styles/liberty');
  assert.match(source, /<span>Basemap<\/span>[\s\S]*?name="globalHazardsMapStyle"[\s\S]*?>Dark<[\s\S]*?>Liberty</);
});

test('today-only uses the current UTC date and removes stale provider events', () => {
  const context = createContext(); context.widget = widget({ days: 1 });
  const today = new Date().toISOString().slice(0, 10);
  const urls = vm.runInContext('_globalHazardUrls(widget)', context);
  assert.match(urls.eonet, /days=1/);
  assert.equal(new URL(urls.usgs).searchParams.get('starttime'), today);
  context.recent = { timestamp: Date.now() - 2 * 24 * 60 * 60 * 1000, updatedAt: Date.now() };
  context.stale = { timestamp: Date.now() - 2 * 24 * 60 * 60 * 1000, updatedAt: Date.now() - 2 * 24 * 60 * 60 * 1000 };
  assert.equal(vm.runInContext('_globalHazardEventInWindow(widget, recent)', context), true);
  assert.equal(vm.runInContext('_globalHazardEventInWindow(widget, stale)', context), false);
});

test('the report-link schema invalidates cached download-only event URLs', () => {
  const context = createContext(); context.widget = widget();
  context.__cache.set('globalHazards:hazards-1:events', { signature: '30:4.5', events: [{ url: 'https://example.test/storm.tcw' }] });
  assert.equal(vm.runInContext('_globalHazardReadCache(widget)', context), null);
  assert.match(vm.runInContext('_globalHazardSignature(widget)', context), /^v3-expanded-feeds:/);
});

test('refresh merges partial provider success and sends only new regional high-severity alerts', async () => {
  let generation = 1;
  const quake = (id, longitude) => ({ id, geometry: { type: 'Point', coordinates: [longitude, 55, 10] }, properties: {
    mag: 6.2, title: `M 6.2 - Event ${id}`, place: 'Nearby', time: Date.now(), updated: Date.now(), alert: 'orange', tsunami: 0,
    url: `https://earthquake.usgs.gov/earthquakes/eventpage/${id}`
  } });
  const context = createContext({
    _fetchWithTimeout: async url => {
      if (url.includes('eonet.gsfc.nasa.gov')) return { ok: true, json: async () => ({ events: [] }) };
      if (url.includes('earthquake.usgs.gov')) return { ok: true, json: async () => ({ features: generation === 1 ? [quake('one', -4)] : [quake('two', -4), quake('one', -4)] }) };
      if (url.includes('gdacs.org')) throw new Error('GDACS temporarily unavailable');
      if (url.includes('ssd-api.jpl.nasa.gov')) return { ok: true, json: async () => ({ fields: [], data: [] }) };
      throw new Error(`Unexpected URL: ${url}`);
    }
  });
  context.widget = widget({ useWeatherLocation: false, latitude: 55, longitude: -4, watchRadiusKm: 250, notificationSeverity: 'high', notifications: true, spaceWeather: false });
  const first = await vm.runInContext('_globalHazardLoad(widget, true)', context);
  assert.equal(first.events.length, 1);
  assert.equal(first.warnings.length, 1);
  assert.equal(context.__notifications.length, 0);
  generation = 2;
  const second = await vm.runInContext('_globalHazardLoad(widget, true)', context);
  assert.equal(second.events.length, 2);
  assert.equal(context.__notifications.length, 1);
  assert.match(context.__notifications[0].title, /Event two/);
  assert.equal(context.__notifications[0].source.widgetType, 'globalHazards');
});

test('filters, selection, list position and map presentation survive runtime recreation', () => {
  const context = createContext(); context.widget = widget();
  const restored = vm.runInContext(`(() => {
    const first = _globalHazardRuntimeState(widget);
    first.activeTypes = new Set(['earthquake', 'tsunami']);
    first.selectedId = 'usgs:example';
    first.camera = { longitude: -4.25, latitude: 55.86, zoom: 5.5 };
    first.attributionExpanded = true;
    first.listScrollTop = 148;
    _globalHazardPersistRuntime(widget, first);
    _globalHazardRuntime.clear();
    _globalHazardViewMemory.clear();
    const next = _globalHazardRuntimeState(widget);
    return {
      activeTypes: [...next.activeTypes], selectedId: next.selectedId, camera: next.camera,
      attributionExpanded: next.attributionExpanded, listScrollTop: next.listScrollTop
    };
  })()`, context);
  assert.deepEqual(JSON.parse(JSON.stringify(restored)), {
    activeTypes: ['earthquake', 'tsunami'], selectedId: 'usgs:example',
    camera: { longitude: -4.25, latitude: 55.86, zoom: 5.5 },
    attributionExpanded: true, listScrollTop: 148
  });
  assert.equal(context.__cache.has('globalHazards:hazards-1:view'), true);
  assert.deepEqual(context.widget.data, {});
});

test('map teardown captures camera and compact provider attribution state', () => {
  const context = createContext(); context.widget = widget();
  context.instance = {
    widget: context.widget, runtime: {},
    map: {
      getCenter: () => ({ lng: 12.5, lat: 41.9 }), getZoom: () => 6.25,
      getContainer: () => ({ querySelector: () => ({ classList: { contains: name => name === 'maplibregl-compact-show' } }) })
    }
  };
  const captured = vm.runInContext(`({
    camera: _globalHazardCaptureMapView(instance),
    attributionExpanded: _globalHazardCaptureAttribution(instance),
    view: _globalHazardReadView(widget)
  })`, context);
  assert.deepEqual(JSON.parse(JSON.stringify(captured.camera)), { longitude: 12.5, latitude: 41.9, zoom: 6.25 });
  assert.equal(captured.attributionExpanded, true);
  assert.equal(captured.view.attributionExpanded, true);
});

test('hazard assets load after MapLibre and SDK and expose responsive map/list styling', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'source', 'global-hazards-widget.css'), 'utf8');
  assert.ok(html.indexOf('vendor/maplibre-gl/maplibre-gl.js') < html.indexOf('source/global-hazards-widget.js'));
  assert.ok(html.indexOf('source/widget-sdk.js') < html.indexOf('source/global-hazards-widget.js'));
  assert.match(html, /source\/global-hazards-widget\.css/);
  assert.match(css, /global-hazards-layout/);
  assert.match(css, /global-hazards-map-shell/);
  assert.match(css, /global-hazards-space-weather/);
  assert.match(css, /\.global-hazards-filters\s*\{[^}]*padding-bottom:\s*8px;[^}]*overflow-x:\s*auto/s);
  assert.match(css, /\.global-hazards-layout\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*width:\s*100%/s);
  assert.match(css, /\.global-hazards-map-shell\s*\{[^}]*width:\s*100%;[^}]*aspect-ratio:\s*16 \/ 9/s);
  assert.match(css, /\.global-hazards-list\s*\{[^}]*max-height:\s*calc\(10 \* var\(--hazard-event-row-height\)\);[^}]*overflow-y:\s*auto/s);
  assert.match(css, /\.global-hazards-event\s*\{[^}]*min-height:\s*var\(--hazard-event-row-height\)/s);
  assert.match(css, /\.global-hazards-focus-location\s*\{[^}]*top:\s*9px;[^}]*left:\s*9px/s);
  assert.match(css, /\.global-hazards-widget \.maplibregl-ctrl-group button\s*\{[^}]*color:\s*var\(--text\)/s);
  assert.match(css, /\.global-hazards-widget \.maplibregl-ctrl-zoom-in \.maplibregl-ctrl-icon[\s\S]*?background-image:\s*none/);
  assert.match(css, /\.global-hazards-widget \.maplibregl-ctrl-attrib\s*\{[^}]*color:\s*#1d2530;[^}]*font-size:\s*9px/s);
  assert.match(source, /Focus map on settings location/);
  assert.match(source, /map\.easeTo\(\{ center: watch\.coordinates/);
  assert.match(source, /Today only/);
  assert.match(css, /@container \(max-width: 480px\)/);
  assert.match(source, /clusterRadius: 42/);
  assert.match(source, /await map\.getSource\(sourceId\)\.getClusterExpansionZoom\(clusterId\)/);
  assert.match(source, /map\.on\('moveend',[\s\S]*?_globalHazardCaptureMapView\(instance\)/);
  assert.match(source, /_globalHazardRestoreAttribution\(instance\)/);
  assert.match(source, /_globalHazardTrackCollection/);
  assert.match(source, /WidgetSDK\.notifications\.publish/);
  assert.match(source, /Space-weather status/);
  assert.match(source, /_globalHazardSpaceWeatherPanel/);
});
