const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

function loadAstronomyWidgets() {
  const context = vm.createContext({
    console,
    URL,
    Intl,
    setInterval,
    clearInterval,
    localStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {}
    },
    fetch: () => { throw new Error('Astronomy calculations must not require a runtime fetch'); },
    saveState: () => { throw new Error('Astronomy refresh must not save shared Hub state'); }
  });
  for (const filename of [
    'vendor/astronomy-engine/astronomy.browser.min.js',
    'source/astronomy-events.js',
    'source/widgets.js'
  ]) {
    vm.runInContext(fs.readFileSync(path.join(root, filename), 'utf8'), context, { filename });
  }
  return context;
}

test('astronomy widget is registered with local-first defaults', () => {
  const context = loadAstronomyWidgets();
  const result = vm.runInContext(`(() => {
    const def = WIDGET_REGISTRY.astronomy;
    return { name: def.name, allowedIn: def.allowedIn, config: def.defaultConfig };
  })()`, context);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    name: 'Astronomy & Night Sky',
    allowedIn: ['column'],
    config: {
      useWeatherLocation: true,
      locationName: '',
      latitude: '',
      longitude: '',
      timezone: 'auto',
      eventDays: 90,
      showPlanets: true,
      showMeteorShowers: true,
      showEvents: true
    }
  });
});

test('astronomy location can inherit the first configured Weather widget', () => {
  const context = loadAstronomyWidgets();
  context.state = {
    boards: [{ tabs: [{ columns: [{ items: [{
      id: 'weather-one',
      type: 'widget',
      widgetType: 'weather',
      config: {
        locationName: 'London, England, United Kingdom',
        latitude: 51.5074,
        longitude: -0.1278,
        timezone: 'Europe/London'
      }
    }] }] }] }]
  };
  context.widget = { id: 'astronomy-one', config: { useWeatherLocation: true } };
  const location = vm.runInContext('_astronomyLocation(widget)', context);
  assert.deepEqual(JSON.parse(JSON.stringify(location)), {
    latitude: 51.5074,
    longitude: -0.1278,
    locationName: 'London, England, United Kingdom',
    timezone: 'Europe/London',
    inherited: true
  });
});

test('fixed-date London snapshot includes Moon, daylight, planets, showers and major events', () => {
  const context = loadAstronomyWidgets();
  context.widget = {
    id: 'astronomy-london',
    config: {
      useWeatherLocation: false,
      locationName: 'London',
      latitude: 51.5074,
      longitude: -0.1278,
      timezone: 'Europe/London',
      eventDays: 90
    }
  };
  const result = vm.runInContext(`(() => {
    const snapshot = _astronomySnapshot(widget, new Date('2026-08-03T18:00:00Z'));
    return {
      phaseName: snapshot.phaseName,
      illumination: snapshot.illumination,
      sunrise: snapshot.sunrise.date.toISOString(),
      sunset: snapshot.sunset.date.toISOString(),
      planets: snapshot.planets.map(item => item.name),
      meteors: snapshot.meteors.map(item => ({ name: item.name, active: item.active })),
      events: snapshot.events.map(item => item.title)
    };
  })()`, context);
  const snapshot = JSON.parse(JSON.stringify(result));
  assert.equal(snapshot.phaseName, 'Waning Gibbous');
  assert.equal(snapshot.illumination, 75);
  assert.match(snapshot.sunrise, /^2026-08-04T04:28:/);
  assert.match(snapshot.sunset, /^2026-08-03T19:45:/);
  assert.deepEqual(snapshot.planets, ['Mars', 'Saturn']);
  assert.deepEqual(snapshot.meteors.slice(0, 2), [
    { name: 'Southern delta Aquariids', active: true },
    { name: 'Perseids', active: true }
  ]);
  assert.ok(snapshot.events.includes('169P/NEAT close approach'));
  assert.ok(snapshot.events.includes('Partial solar eclipse'));
  assert.ok(snapshot.events.includes('Partial lunar eclipse'));
  assert.ok(snapshot.events.includes('September equinox'));
});

test('Moon phase mask covers the expected illuminated side', () => {
  const context = loadAstronomyWidgets();
  const masks = vm.runInContext(`({
    newMoon: _astronomyMoonPath(0),
    firstQuarter: _astronomyMoonPath(90),
    fullMoon: _astronomyMoonPath(180),
    lastQuarter: _astronomyMoonPath(270)
  })`, context);
  assert.notEqual(masks.newMoon, masks.fullMoon);
  assert.notEqual(masks.firstQuarter, masks.lastQuarter);
  assert.match(masks.firstQuarter, /^M 50\.00 2\.00/);
  assert.match(masks.fullMoon, /L 2\.00 50\.00/);
});

test('daylight cards are ordered by the next actual occurrence', () => {
  const context = loadAstronomyWidgets();
  const labels = vm.runInContext(`_astronomyChronologicalDaylight({
    sunrise: { date: new Date('2026-08-04T04:31:00Z') },
    sunset: { date: new Date('2026-08-03T19:49:00Z') },
    nightStart: new Date('2026-08-03T21:23:00Z'),
    nightEnd: new Date('2026-08-04T02:57:00Z'),
    isDarkNow: false
  }).map(entry => entry.label)`, context);
  assert.deepEqual(JSON.parse(JSON.stringify(labels)), ['Sunset', 'Dark sky', 'Dawn', 'Sunrise']);
});

test('astronomy assets are local, licensed and loaded before widget code', () => {
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const licence = fs.readFileSync(path.join(root, 'vendor', 'astronomy-engine', 'LICENSE.txt'), 'utf8');
  const version = fs.readFileSync(path.join(root, 'vendor', 'astronomy-engine', 'VERSION.txt'), 'utf8');
  const engine = fs.statSync(path.join(root, 'vendor', 'astronomy-engine', 'astronomy.browser.min.js'));
  const moon = fs.statSync(path.join(root, 'assets', 'astronomy', 'nasa-lro-moon-mosaic.png'));
  assert.ok(engine.size > 100_000);
  assert.ok(moon.size > 500_000);
  assert.match(licence, /MIT License/);
  assert.match(version, /Astronomy Engine 2\.1\.19/);
  assert.ok(index.indexOf('vendor/astronomy-engine/astronomy.browser.min.js') < index.indexOf('source/widgets.js'));
  assert.ok(index.indexOf('source/astronomy-events.js') < index.indexOf('source/widgets.js'));
});

test('astronomy widget exposes location, horizon and section controls with responsive styling', () => {
  const widgets = fs.readFileSync(path.join(root, 'source', 'widgets.js'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'source', 'styles.css'), 'utf8');
  const source = widgets.slice(widgets.indexOf("WIDGET_REGISTRY['astronomy']"));
  assert.match(source, /Use Weather location/);
  assert.match(source, /Separate location/);
  assert.match(source, /Upcoming events/);
  assert.match(source, /Visible planets tonight/);
  assert.match(source, /Meteor showers/);
  assert.match(widgets, /\{ label: 'Sunrise', value: snapshot\.sunrise \}/);
  assert.match(widgets, /\{ label: 'Sunset', value: snapshot\.sunset \}/);
  assert.match(source, /liveSettingsPreview: false/);
  assert.match(styles, /\.widget-astronomy-moon\s*\{/);
  assert.match(styles, /\.widget-astronomy-daylight\s*\{/);
  assert.match(styles, /\.widget-astronomy-planets\s*\{/);
  assert.match(styles, /@media \(max-width: 560px\)/);
});
