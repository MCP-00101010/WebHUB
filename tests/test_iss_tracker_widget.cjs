const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const SAMPLE_TLE = {
  header: 'ISS (ZARYA)',
  line1: '1 25544U 98067A   21275.51834491  .00001490  00000-0  33281-4 0  9992',
  line2: '2 25544  51.6442 172.5583 0003572  65.8134  36.0590 15.48867829306491'
};

function loadIssWidgets(fetchImpl = async () => { throw new Error('Unexpected fetch'); }) {
  const storage = new Map();
  const context = vm.createContext({
    console,
    URL,
    Date,
    Intl,
    AbortController,
    DOMException,
    fetch: fetchImpl,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: key => storage.delete(key)
    },
    saveState: () => { throw new Error('ISS tracking must not save shared Hub state'); }
  });
  for (const filename of ['vendor/satellite-js/satellite.min.js', 'source/widget-network.js', 'source/widgets.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, filename), 'utf8'), context, { filename });
  }
  return { context, storage };
}

test('ISS Tracker is a column widget with local interaction defaults', () => {
  const { context } = loadIssWidgets();
  const definition = vm.runInContext(`(() => {
    const def = WIDGET_REGISTRY.issTracker;
    return { name: def.name, allowedIn: def.allowedIn, config: def.defaultConfig, hasReload: typeof def.reload === 'function' };
  })()`, context);
  assert.deepEqual(JSON.parse(JSON.stringify(definition)), {
    name: 'ISS Tracker',
    allowedIn: ['column'],
    config: { mapStyle: 'dark', showNightShade: true },
    hasReload: true
  });
});

test('pinned Satellite.js propagates a known ISS TLE into plausible coordinates', () => {
  const { context } = loadIssWidgets();
  context.tle = SAMPLE_TLE;
  const position = vm.runInContext("_issPosition(_issSatrec(tle), new Date('2021-10-02T12:26:25Z'))", context);
  assert.ok(position.latitude >= -51.7 && position.latitude <= 51.7);
  assert.ok(position.longitude >= -180 && position.longitude <= 180);
  assert.ok(position.altitude > 350 && position.altitude < 500);
  assert.ok(position.speed > 7 && position.speed < 8.5);
});

test('orbital ground track splits safely at the antimeridian', () => {
  const { context } = loadIssWidgets();
  context.tle = SAMPLE_TLE;
  const track = vm.runInContext("_issGroundTrack(_issSatrec(tle), new Date('2021-10-02T12:26:25Z'))", context);
  assert.equal(track.type, 'FeatureCollection');
  assert.deepEqual(JSON.parse(JSON.stringify(track.features.map(feature => feature.properties.segment))), ['past', 'future']);
  for (const feature of track.features) {
    assert.equal(feature.geometry.type, 'MultiLineString');
    assert.ok(feature.geometry.coordinates.length > 0);
    for (const line of feature.geometry.coordinates) {
      for (let index = 1; index < line.length; index += 1) {
        assert.ok(Math.abs(line[index][0] - line[index - 1][0]) <= 180);
      }
    }
  }
});

test('solar calculation produces a closed night hemisphere and split terminator', () => {
  const { context } = loadIssWidgets();
  const result = vm.runInContext(`(() => {
    const date = new Date('2026-08-03T12:00:00Z');
    return { sun: _subsolarPoint(date), geometry: _issDayNightGeoJson(date) };
  })()`, context);
  assert.ok(result.sun.longitude > -5 && result.sun.longitude < 5);
  assert.ok(result.sun.latitude > 15 && result.sun.latitude < 25);
  const ring = result.geometry.night.geometry.coordinates[0];
  assert.deepEqual(ring[0], ring.at(-1));
  for (let index = 1; index < ring.length; index += 1) {
    assert.ok(Math.abs(ring[index][0] - ring[index - 1][0]) <= 1);
  }
  assert.equal(result.geometry.border.geometry.type, 'MultiLineString');
  assert.ok(result.geometry.border.geometry.coordinates.length >= 1);
  for (const line of result.geometry.border.geometry.coordinates) {
    for (let index = 1; index < line.length; index += 1) {
      assert.ok(Math.abs(line[index][0] - line[index - 1][0]) <= 1);
    }
  }
});

test('ISS orbital cache remains browser-local and honours its refresh age', () => {
  const { context, storage } = loadIssWidgets();
  context.tle = SAMPLE_TLE;
  vm.runInContext('_writeIssTleCache({ ...tle, fetchedAt: Date.now(), source: "test" })', context);
  assert.ok(storage.has('morpheus-webhub-iss-tle:v1'));
  assert.equal(vm.runInContext('_isIssTleFresh(_readIssTleCache())', context), true);
  vm.runInContext('_issTleMemoryCache.fetchedAt = Date.now() - ISS_TLE_TTL_MS - 1', context);
  assert.equal(vm.runInContext('_isIssTleFresh(_readIssTleCache())', context), false);
});

test('Where The ISS At is preferred for TLE refresh', async () => {
  const requests = [];
  const { context } = loadIssWidgets(async url => {
    requests.push(String(url));
    return { ok: true, json: async () => SAMPLE_TLE };
  });
  const cache = await vm.runInContext('_fetchIssTle()', context);
  assert.equal(requests.length, 1);
  assert.match(requests[0], /api\.wheretheiss\.at\/v1\/satellites\/25544\/tles/);
  assert.equal(cache.source, 'Where The ISS At');
});

test('CelesTrak provides a fallback when the primary TLE source fails', async () => {
  const requests = [];
  const { context } = loadIssWidgets(async url => {
    requests.push(String(url));
    if (requests.length === 1) throw new Error('Primary unavailable');
    return {
      ok: true,
      text: async () => `${SAMPLE_TLE.header}\n${SAMPLE_TLE.line1}\n${SAMPLE_TLE.line2}\n`
    };
  });
  const cache = await vm.runInContext('_fetchIssTle()', context);
  assert.equal(requests.length, 2);
  assert.match(requests[1], /celestrak\.org\/NORAD\/elements\/gp\.php/);
  assert.equal(cache.source, 'CelesTrak');
});

test('ISS assets, globe interaction, cleanup, and responsive styling are wired locally', () => {
  const widgets = fs.readFileSync(path.join(root, 'source/widgets.js'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'source/styles.css'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /vendor\/satellite-js\/satellite\.min\.js/);
  assert.ok(fs.existsSync(path.join(root, 'vendor/satellite-js/LICENSE.md')));
  assert.match(widgets, /map\.setProjection\?\.\(\{ type: 'globe' \}\)/);
  assert.match(widgets, /widget-iss-map-shell widget-interactive-surface/);
  assert.match(widgets, /_destroyAllIssTrackers\(\)/);
  assert.match(styles, /\.widget-iss-map-shell\s*\{[^}]*height:\s*clamp\(/s);
  assert.match(styles, /\.widget-iss-facts\s*\{[^}]*grid-template-columns:\s*repeat\(4/s);
});

test('globe projection waits until the MapLibre style has loaded', () => {
  const widgets = fs.readFileSync(path.join(root, 'source/widgets.js'), 'utf8');
  const issSource = widgets.slice(widgets.indexOf("WIDGET_REGISTRY['issTracker']"), widgets.indexOf('// ---- Astronomy / Night Sky widget ----'));
  const construction = issSource.slice(issSource.indexOf('map = new maplibregl.Map(mapOptions)'), issSource.indexOf("map.on('load'"));
  const loadedSetup = issSource.slice(issSource.indexOf("map.on('load'"), issSource.indexOf("map.on('moveend'"));
  assert.doesNotMatch(construction, /setProjection/);
  assert.match(loadedSetup, /map\.setProjection\?\.\(\{ type: 'globe' \}\)/);
  assert.match(loadedSetup, /map\.addSource\(sourceIds\.track/);
  assert.match(loadedSetup, /catch \(error\)[\s\S]*?Unable to finish initialising the ISS globe/);
});

test('Focus ISS state is browser-local and recentres every live update', () => {
  const { context } = loadIssWidgets();
  context.map = {
    getCenter: () => ({ lng: 10, lat: 20 }),
    getZoom: () => 2,
    getBearing: () => 0,
    getPitch: () => 0
  };
  const view = vm.runInContext("_writeIssView('iss-focus', map, { focusOnIss: true }); _readIssView('iss-focus')", context);
  assert.equal(view.focusOnIss, true);

  const widgets = fs.readFileSync(path.join(root, 'source/widgets.js'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'source/styles.css'), 'utf8');
  assert.match(widgets, /focusButton\.className = 'widget-iss-focus-button'/);
  assert.match(widgets, /instance\.focusOnIss && instance\.mapReady[\s\S]*?instance\.map\.jumpTo\(\{ center:/);
  assert.match(widgets, /focusButton\.setAttribute\('aria-pressed'/);
  assert.match(styles, /\.widget-iss-focus-button\s*\{[^}]*top:\s*10px;[^}]*left:\s*10px/s);
  assert.match(styles, /\.widget-iss-focus-button\.active/);
});

test('ISS map attribution state survives widget recreation and Hub reloads', () => {
  const { context } = loadIssWidgets();
  context.instance = {
    widgetId: 'iss-attribution',
    focusOnIss: false,
    map: {
      getCenter: () => ({ lng: 10, lat: 20 }),
      getZoom: () => 2,
      getBearing: () => 0,
      getPitch: () => 0,
      getContainer: () => ({
        querySelector: () => ({
          classList: { contains: className => className === 'maplibregl-compact-show' }
        })
      })
    }
  };
  assert.equal(vm.runInContext('_captureIssAttribution(instance)', context), true);
  assert.equal(vm.runInContext("_readIssView('iss-attribution').attributionExpanded", context), true);

  const widgets = fs.readFileSync(path.join(root, 'source/widgets.js'), 'utf8');
  const issSource = widgets.slice(widgets.indexOf("WIDGET_REGISTRY['issTracker']"), widgets.indexOf('// ---- Astronomy / Night Sky widget ----'));
  assert.match(widgets, /_destroyIssTracker[\s\S]*?_captureIssAttribution\(instance\)/);
  assert.match(issSource, /_restoreIssAttribution\(instance\)/);
});

test('custom north control is clickable and resets every globe orientation axis', () => {
  const widgets = fs.readFileSync(path.join(root, 'source/widgets.js'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'source/styles.css'), 'utf8');
  const issSource = widgets.slice(widgets.indexOf("WIDGET_REGISTRY['issTracker']"), widgets.indexOf('// ---- Astronomy / Night Sky widget ----'));
  assert.match(issSource, /northButton\.className = 'widget-iss-north-button'/);
  assert.match(issSource, /dragRotate:\s*true/);
  assert.match(issSource, /NavigationControl\(\{ showCompass: false \}\)/);
  assert.match(issSource, /northButton\.addEventListener\('click',[\s\S]*?event\.preventDefault\(\)[\s\S]*?map\.easeTo\(\{ bearing: 0, pitch: 0, roll: 0, duration: 450 \}\)/);
  const northStyle = styles.slice(styles.indexOf('.widget-iss-north-button {'), styles.indexOf('.widget-iss-north-button:hover'));
  assert.match(northStyle, /pointer-events:\s*auto/);
  assert.match(northStyle, /cursor:\s*pointer/);
});
