const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadWidgets(fetchImpl = async () => ({ ok: true, json: async () => ({}) })) {
  const storage = new Map();
  const context = vm.createContext({
    console,
    URL,
    fetch: fetchImpl,
    setInterval,
    clearInterval,
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: key => storage.delete(key)
    },
    saveState: () => { throw new Error('Weather refresh must not save shared Hub state'); }
  });
  const filename = path.join(__dirname, '..', 'source', 'widgets.js');
  vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  return { context, storage };
}

test('weather widget is registered as a column widget with basic defaults', () => {
  const { context } = loadWidgets();
  const result = vm.runInContext(`(() => {
    const def = WIDGET_REGISTRY.weather;
    return { name: def.name, allowedIn: def.allowedIn, config: def.defaultConfig };
  })()`, context);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    name: 'Weather',
    allowedIn: ['column'],
    config: {
      locationName: '',
      latitude: '',
      longitude: '',
      timezone: 'auto',
      days: 5,
      units: 'metric',
      forecastLayout: 'vertical',
      showHourly24: false
    }
  });
});

test('weather forecast length is constrained to the Open-Meteo range', () => {
  const { context } = loadWidgets();
  assert.equal(vm.runInContext('_normalizeWeatherDays(0)', context), 1);
  assert.equal(vm.runInContext('_normalizeWeatherDays("7")', context), 7);
  assert.equal(vm.runInContext('_normalizeWeatherDays(99)', context), 16);
  assert.equal(vm.runInContext('_normalizeWeatherDays("invalid")', context), 5);
});

test('weather widget does not treat its empty default coordinates as a real location', () => {
  const { context } = loadWidgets();
  assert.equal(vm.runInContext("_weatherSignature({ config: WIDGET_REGISTRY.weather.defaultConfig })", context), '');
  assert.equal(vm.runInContext("_weatherSignature({ config: { latitude: 91, longitude: 0, days: 5 } })", context), '');
});

test('weather automatic refresh is claimed once per clock hour', () => {
  const { context } = loadWidgets();
  context.runtime = {};
  context.hourStart = Date.parse('2026-08-03T17:00:00Z');
  assert.equal(vm.runInContext('_claimWeatherRefreshHour(runtime, hourStart)', context), true);
  assert.equal(vm.runInContext('_claimWeatherRefreshHour(runtime, hourStart + 59 * 60 * 1000)', context), false);
  assert.equal(vm.runInContext('_claimWeatherRefreshHour(runtime, hourStart + 60 * 60 * 1000)', context), true);
});

test('weather refresh requests the configured forecast and stays out of shared state', async () => {
  const requests = [];
  const payload = {
    current: { time: '2026-08-03T12:00', temperature_2m: 18, weather_code: 2 },
    hourly: { time: ['2026-08-03T12:00'] },
    daily: { time: ['2026-08-03'] }
  };
  const { context, storage } = loadWidgets(async url => {
    requests.push(String(url));
    return { ok: true, json: async () => payload };
  });
  context.widget = {
    id: 'weather-one',
    config: {
      locationName: 'London, England, United Kingdom',
      latitude: 51.5074,
      longitude: -0.1278,
      timezone: 'Europe/London',
      days: 7,
      units: 'imperial',
      forecastLayout: 'horizontal'
    }
  };

  vm.runInContext('_ensureWeatherData(widget)', context);
  await vm.runInContext("_widgetFetches.get('weather:weather-one')", context);

  assert.equal(requests.length, 1);
  const url = new URL(requests[0]);
  assert.equal(url.hostname, 'api.open-meteo.com');
  assert.equal(url.searchParams.get('forecast_days'), '7');
  assert.equal(url.searchParams.get('timezone'), 'Europe/London');
  assert.equal(url.searchParams.get('temperature_unit'), 'fahrenheit');
  assert.equal(url.searchParams.get('wind_speed_unit'), 'mph');
  assert.equal(url.searchParams.get('precipitation_unit'), 'inch');
  assert.match(url.searchParams.get('current'), /temperature_2m/);
  assert.match(url.searchParams.get('hourly'), /temperature_2m/);
  assert.match(url.searchParams.get('hourly'), /precipitation_probability/);
  assert.match(url.searchParams.get('hourly'), /weather_code/);
  assert.equal(url.searchParams.get('forecast_hours'), '24');
  assert.match(url.searchParams.get('daily'), /precipitation_probability_max/);
  const cached = JSON.parse(storage.get('morpheus-webhub-weather:weather-one'));
  assert.deepEqual(cached.payload, payload);
});

test('weather manual reload bypasses a fresh cache', async () => {
  let requestCount = 0;
  const refreshedPayload = {
    current: { time: '2026-08-03T13:00', temperature_2m: 21, weather_code: 1 },
    hourly: { time: ['2026-08-03T13:00'] },
    daily: { time: ['2026-08-03'] }
  };
  const { context } = loadWidgets(async () => {
    requestCount += 1;
    return { ok: true, json: async () => refreshedPayload };
  });
  context.widget = {
    id: 'weather-manual-reload',
    config: { latitude: 51.5, longitude: -0.1, timezone: 'Europe/London', days: 5, units: 'metric' }
  };
  vm.runInContext("_writeWeatherCache(widget, { current: { time: 'old' }, hourly: { time: [] }, daily: { time: [] } })", context);
  assert.equal(vm.runInContext('_ensureWeatherData(widget)', context), null);
  assert.equal(requestCount, 0);
  await vm.runInContext('WIDGET_REGISTRY.weather.reload(widget)', context);
  assert.equal(requestCount, 1);
  const cached = vm.runInContext('_readWeatherCache(widget)', context);
  assert.deepEqual(JSON.parse(JSON.stringify(cached.payload)), refreshedPayload);
});

test('basic Weather exposes a reload action beside widget settings', () => {
  const widgets = fs.readFileSync(path.join(__dirname, '..', 'source', 'widgets.js'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'source', 'styles.css'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(widgets, /if \(typeof def\.reload === 'function'\)/);
  assert.match(widgets, /widget-action-btn widget-action-btn--reload/);
  assert.match(widgets, /appendChild\(icon\('icon-reload'\)\)/);
  assert.match(widgets, /reload\(widget\) \{\s*return _ensureWeatherData\(widget, \{ force: true \}\);/);
  assert.match(styles, /\.widget-action-btn--reload\s*\{[^}]*right:\s*26px/s);
  assert.match(styles, /\.widget-weather-location\s*\{[^}]*padding-right:\s*50px/s);
  assert.match(html, /<symbol id="icon-reload"/);
});

test('both Weather widgets force refresh on first render and each new hour', () => {
  const widgets = fs.readFileSync(path.join(__dirname, '..', 'source', 'widgets.js'), 'utf8');
  const weatherSource = widgets.slice(
    widgets.indexOf("WIDGET_REGISTRY['weather']"),
    widgets.indexOf("WIDGET_REGISTRY['weatherMap']")
  );
  const mapSource = widgets.slice(widgets.indexOf("WIDGET_REGISTRY['weatherMap']"));
  assert.match(weatherSource, /_claimWeatherRefreshHour\(runtime\)[\s\S]*?_ensureWeatherData\(widget, \{ force: true \}\)/);
  assert.match(weatherSource, /_setWidgetTimer\(widget\.id, context,[\s\S]*?_claimWeatherRefreshHour\(currentRuntime\)[\s\S]*?_ensureWeatherData\(widget, \{ force: true \}\)[\s\S]*?60 \* 1000/);
  assert.match(mapSource, /_claimWeatherRefreshHour\(runtime\)[\s\S]*?_ensureWeatherMapData\(widget, \{ force: true \}\)/);
  assert.match(mapSource, /_setWidgetTimer\(widget\.id, context,[\s\S]*?_claimWeatherRefreshHour\(currentRuntime\)[\s\S]*?_ensureWeatherMapData\(widget, \{ force: true \}\)[\s\S]*?60 \* 1000/);
});

test('weather response cache tracks data-affecting options but not display layout', () => {
  const { context } = loadWidgets();
  context.widget = {
    id: 'weather-two',
    config: { latitude: 52.5, longitude: 13.4, timezone: 'Europe/Berlin', days: 5, units: 'metric', forecastLayout: 'vertical', showHourly24: false }
  };
  assert.equal(vm.runInContext("_writeWeatherCache(widget, { current: {}, hourly: { time: [] }, daily: { time: [] } }); !!_readWeatherCache(widget)", context), true);
  assert.equal(vm.runInContext("widget.config.forecastLayout = 'horizontal'; !!_readWeatherCache(widget)", context), true);
  assert.equal(vm.runInContext("widget.config.showHourly24 = true; !!_readWeatherCache(widget)", context), true);
  assert.equal(vm.runInContext("widget.config.units = 'imperial'; !!_readWeatherCache(widget)", context), false);
});

test('weather hourly helper extracts the next 24 hours with icon inputs', () => {
  const { context } = loadWidgets();
  context.payload = {
    current: { time: '2026-08-03T13:45' },
    hourly: {
      time: ['2026-08-03T12:00', '2026-08-03T13:00', '2026-08-03T14:00'],
      temperature_2m: [17, 18, 19],
      precipitation_probability: [5, 20, 35],
      weather_code: [0, 2, 61],
      is_day: [1, 1, 0]
    }
  };
  const hours = vm.runInContext('_weatherHourlyForecast(payload, 24)', context);
  assert.deepEqual(JSON.parse(JSON.stringify(hours)), [
    { time: '2026-08-03T13:00', temperature: 18, precipitationProbability: 20, weatherCode: 2, isDay: true },
    { time: '2026-08-03T14:00', temperature: 19, precipitationProbability: 35, weatherCode: 61, isDay: false }
  ]);
  assert.equal(vm.runInContext("_weatherHourLabel('2026-08-03T13:00', 0)", context), 'Now');
  assert.equal(vm.runInContext("_weatherHourLabel('2026-08-03T14:00', 1)", context), '14:00');
});

test('weather hourly forecast is optional and rendered between current and daily conditions', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'source', 'widgets.js'), 'utf8');
  const weatherSource = source.slice(
    source.indexOf("WIDGET_REGISTRY['weather']"),
    source.indexOf("WIDGET_REGISTRY['weatherMap']")
  );
  const currentIndex = weatherSource.indexOf('el.appendChild(header);');
  const hourlyIndex = weatherSource.indexOf('if (c.showHourly24)');
  const dailyIndex = weatherSource.indexOf("const forecast = document.createElement('div');");
  assert.ok(currentIndex >= 0 && currentIndex < hourlyIndex && hourlyIndex < dailyIndex);
  assert.match(weatherSource, /data-cfg="showHourly24"/);
  assert.match(weatherSource, /_weatherCodeDetails\(hour\.weatherCode, hour\.isDay\)/);
  assert.match(weatherSource, /widget-weather-hourly-viewport widget-interactive-surface/);
});

test('weather hourly viewport supports grab-to-scroll without starting a widget drag', () => {
  const { context } = loadWidgets();
  const listeners = {};
  const classes = new Set();
  let capturedPointer = null;
  let releasedPointer = null;
  let pointerDownPrevented = false;
  let pointerMovePrevented = false;
  let attached = false;
  const widgetCard = { draggable: true };
  context.viewport = {
    scrollLeft: 120,
    classList: {
      add: name => classes.add(name),
      remove: name => classes.delete(name)
    },
    addEventListener: (type, listener) => { listeners[type] = listener; },
    closest: selector => attached && selector === '.widget-card' ? widgetCard : null,
    matches: () => false,
    setPointerCapture: pointerId => { capturedPointer = pointerId; },
    hasPointerCapture: pointerId => capturedPointer === pointerId,
    releasePointerCapture: pointerId => { releasedPointer = pointerId; }
  };
  vm.runInContext('_enableWeatherHourlyDragScroll(viewport)', context);
  attached = true;
  listeners.pointerdown({ pointerType: 'mouse', button: 0, pointerId: 7, clientX: 100, preventDefault() { pointerDownPrevented = true; }, stopPropagation() {} });
  assert.equal(widgetCard.draggable, false);
  assert.equal(capturedPointer, 7);
  assert.equal(pointerDownPrevented, true);
  assert.equal(classes.has('is-dragging'), true);
  listeners.pointermove({ pointerId: 7, clientX: 70, preventDefault() { pointerMovePrevented = true; }, stopPropagation() {} });
  assert.equal(context.viewport.scrollLeft, 150);
  assert.equal(pointerMovePrevented, true);
  listeners.pointerup({ pointerId: 7, stopPropagation() {} });
  assert.equal(releasedPointer, 7);
  assert.equal(classes.has('is-dragging'), false);
  assert.equal(widgetCard.draggable, true);
});

test('weather styling includes current conditions, forecast rows and location results', () => {
  const styles = fs.readFileSync(path.join(__dirname, '..', 'source', 'styles.css'), 'utf8');
  assert.match(styles, /\.widget-weather-current\s*\{/);
  assert.match(styles, /\.widget-weather-day\s*\{/);
  assert.match(styles, /\.widget-weather-forecast\.is-horizontal\s*\{/);
  assert.match(styles, /\.widget-weather-hourly-grid\s*\{/);
  assert.match(styles, /\.widget-weather-hourly-grid\s*\{[^}]*display:\s*flex/s);
  assert.match(styles, /calc\(\(100% - 21px\) \/ 8\)/);
  assert.match(styles, /\.widget-weather-hourly-viewport\s*\{[^}]*cursor:\s*grab/s);
  assert.match(styles, /\.weather-location-result\s*\{/);
});

test('weather map widget is registered with regional map defaults', () => {
  const { context } = loadWidgets();
  const result = vm.runInContext(`(() => {
    const def = WIDGET_REGISTRY.weatherMap;
    return { name: def.name, allowedIn: def.allowedIn, config: def.defaultConfig };
  })()`, context);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    name: 'Weather Map',
    allowedIn: ['column'],
    config: {
      locationName: '',
      latitude: '',
      longitude: '',
      timezone: 'auto',
      units: 'metric',
      mapStyle: 'dark',
      originZoom: 7
    }
  });
});

test('weather map origin zoom is constrained to supported map levels', () => {
  const { context } = loadWidgets();
  assert.equal(vm.runInContext('_normalizeWeatherMapOriginZoom(1)', context), 3);
  assert.equal(vm.runInContext('_normalizeWeatherMapOriginZoom(8.13)', context), 8.25);
  assert.equal(vm.runInContext('_normalizeWeatherMapOriginZoom(20)', context), 13);
  assert.equal(vm.runInContext("_normalizeWeatherMapOriginZoom('invalid')", context), 7);
});

test('weather map request batches a bounded regional grid and 49 forecast hours', () => {
  const { context } = loadWidgets();
  context.widget = {
    id: 'map-one',
    config: { latitude: 51.5074, longitude: -0.1278, units: 'imperial', mapStyle: 'dark' }
  };
  const result = vm.runInContext(`(() => {
    const grid = _buildWeatherMapGrid(widget);
    return { grid, url: _weatherMapForecastUrl(widget) };
  })()`, context);
  const parsed = new URL(result.url);
  assert.equal(result.grid.points.length, 35);
  assert.equal(parsed.searchParams.get('latitude').split(',').length, 35);
  assert.equal(parsed.searchParams.get('longitude').split(',').length, 35);
  assert.equal(parsed.searchParams.get('forecast_hours'), '49');
  assert.equal(parsed.searchParams.get('temperature_unit'), 'fahrenheit');
  assert.equal(parsed.searchParams.get('wind_speed_unit'), 'mph');
  assert.equal(parsed.searchParams.get('precipitation_unit'), 'inch');
  assert.match(parsed.searchParams.get('hourly'), /wind_direction_10m/);
  assert.match(parsed.searchParams.get('hourly'), /precipitation/);
});

test('weather map forced refresh bypasses a fresh cache', async () => {
  let requestCount = 0;
  const payload = [{ latitude: 51.5, longitude: -0.1, hourly: { time: ['2026-08-03T17:00'] } }];
  const { context } = loadWidgets(async () => {
    requestCount += 1;
    return { ok: true, json: async () => payload };
  });
  context.widget = { id: 'map-hourly-refresh', config: { latitude: 51.5, longitude: -0.1, units: 'metric' } };
  context.oldPayload = [{ latitude: 51.5, longitude: -0.1, hourly: { time: ['old'] } }];
  vm.runInContext('_writeWeatherMapCache(widget, oldPayload)', context);
  assert.equal(vm.runInContext('_ensureWeatherMapData(widget)', context), null);
  assert.equal(requestCount, 0);
  await vm.runInContext('_ensureWeatherMapData(widget, { force: true })', context);
  assert.equal(requestCount, 1);
  const cached = vm.runInContext('_readWeatherMapCache(widget)', context);
  assert.deepEqual(JSON.parse(JSON.stringify(cached.payload)), payload);
});

test('weather map reset action restores origin centre and zoom without changing widget config', async () => {
  const payload = [{ latitude: 51.5, longitude: -0.1, hourly: { time: ['2026-08-03T17:00'] } }];
  const { context, storage } = loadWidgets(async () => ({ ok: true, json: async () => payload }));
  context.widget = {
    id: 'map-reset-origin',
    config: { locationName: 'Origin', latitude: 51.5, longitude: -0.1, units: 'metric', mapStyle: 'dark', originZoom: 6.5 }
  };
  const originalConfig = JSON.parse(JSON.stringify(context.widget.config));
  vm.runInContext(`_writeWeatherMapView(widget, {
    forecastCenter: { latitude: 53, longitude: -2, label: 'Current' },
    camera: { latitude: 53, longitude: -2, zoom: 11 }
  })`, context);
  await vm.runInContext('WIDGET_REGISTRY.weatherMap.reload(widget)', context);
  assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext('_weatherMapCenter(widget)', context))), { latitude: 51.5, longitude: -0.1 });
  assert.equal(vm.runInContext('_getWeatherMapRuntime(widget).camera', context), null);
  assert.deepEqual(context.widget.config, originalConfig);
  assert.equal(storage.has('morpheus-webhub-weather-map-view:map-reset-origin'), false);
});

test('weather map settings include origin controls and a live origin preview', () => {
  const root = path.join(__dirname, '..');
  const widgets = fs.readFileSync(path.join(root, 'source', 'widgets.js'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'source', 'styles.css'), 'utf8');
  const mapSource = widgets.slice(widgets.indexOf("WIDGET_REGISTRY['weatherMap']"));
  assert.match(mapSource, /reloadLabel: 'Reset Weather Map to its origin'/);
  assert.match(mapSource, /<span>Origin location<\/span>/);
  assert.match(mapSource, /<span>Current map centre<\/span>/);
  assert.match(mapSource, /weather-map-origin-zoom/);
  assert.match(mapSource, /weather-map-current-zoom/);
  assert.match(mapSource, /weather-map-origin-preview-canvas/);
  assert.match(mapSource, /new maplibregl\.Map\([\s\S]*?interactive: false/);
  assert.match(mapSource, /liveSettingsPreview: false/);
  assert.match(widgets, /refreshPreview && def\.liveSettingsPreview !== false/);
  assert.match(widgets, /syncConfig\(false\);[\s\S]*?def\.onSettingsCommit\(widget, savedConfig\)/);
  assert.match(styles, /\.weather-map-origin-preview\s*\{[^}]*height:\s*180px/s);
  assert.match(styles, /\.widget-weather-map-location\s*\{[^}]*padding-right:\s*50px/s);
});

test('committing a changed Weather Map origin discards the old camera without recapturing it', () => {
  const { context, storage } = loadWidgets();
  let cameraCaptured = false;
  context.widget = {
    id: 'map-settings-commit',
    config: { locationName: 'Origin', latitude: 51.5, longitude: -0.1, units: 'metric', mapStyle: 'dark', originZoom: 7 }
  };
  context.previousConfig = JSON.parse(JSON.stringify(context.widget.config));
  vm.runInContext("_writeWeatherMapView(widget, { camera: { latitude: 53, longitude: -2, zoom: 11 } })", context);
  context.widget.config.originZoom = 8;
  context.instance = {
    widgetId: 'map-settings-commit',
    widget: context.widget,
    runtime: {},
    markers: [],
    map: {
      getCenter: () => { cameraCaptured = true; return { lat: 53, lng: -2 }; },
      getZoom: () => 11,
      remove() {}
    }
  };
  vm.runInContext("_weatherMapInstances.set(widget.id, instance); WIDGET_REGISTRY.weatherMap.onSettingsCommit(widget, previousConfig)", context);
  assert.equal(cameraCaptured, false);
  assert.equal(vm.runInContext('_weatherMapInstances.has(widget.id)', context), false);
  assert.equal(vm.runInContext('_readWeatherMapView(widget)', context), null);
  assert.equal(storage.has('morpheus-webhub-weather-map-view:map-settings-commit'), false);
  assert.equal(context.widget.config.originZoom, 8);
});

test('weather map feature collection extracts each forecast layer at the selected hour', () => {
  const { context } = loadWidgets();
  context.cache = {
    payload: [{
      latitude: 51.5,
      longitude: -0.1,
      hourly: {
        time: ['2026-08-03T12:00', '2026-08-03T13:00'],
        temperature_2m: [20, 21],
        precipitation: [0, 1.5],
        cloud_cover: [25, 70],
        wind_speed_10m: [8, 12],
        wind_direction_10m: [180, 225]
      }
    }]
  };
  const properties = vm.runInContext('_weatherMapFeatureCollection(cache, 1).features[0].properties', context);
  assert.deepEqual(JSON.parse(JSON.stringify(properties)), {
    temperature: 21,
    precipitation: 1.5,
    cloudCover: 70,
    windSpeed: 12,
    windDirection: 225
  });
});

test('weather map Now control selects the forecast hour nearest the current time', () => {
  const { context } = loadWidgets();
  context.cache = {
    payload: [{ hourly: { time: ['2026-08-03T12:00', '2026-08-03T13:00', '2026-08-03T14:00'] } }]
  };
  assert.equal(vm.runInContext("_weatherMapCurrentHourIndex(cache, Date.parse('2026-08-03T13:18:00Z'))", context), 1);
  assert.equal(vm.runInContext("_weatherMapCurrentHourIndex(cache, Date.parse('2026-08-03T13:48:00Z'))", context), 2);
  assert.equal(vm.runInContext('_weatherMapCurrentHourIndex(null)', context), 0);
});

test('weather map quantitative legends expose values at every colour stop', () => {
  const { context } = loadWidgets();
  const legends = vm.runInContext(`({
    rainMetric: _weatherMapLegend('rain', 'metric'),
    rainImperial: _weatherMapLegend('rain', 'imperial'),
    temperature: _weatherMapLegend('temperature', 'metric'),
    clouds: _weatherMapLegend('clouds', 'metric')
  })`, context);
  const result = JSON.parse(JSON.stringify(legends));
  assert.deepEqual(result.rainMetric.ticks, [['0', 0], ['1.5', 15], ['5', 50], ['10+', 100]]);
  assert.deepEqual(result.rainImperial.ticks, [['0', 0], ['0.06', 15], ['0.2', 50], ['0.4+', 100]]);
  assert.equal(result.temperature.ticks.length, 6);
  assert.deepEqual(result.clouds.ticks, [[0, 0], [50, 50], [100, 100]]);
});

test('weather map normalizes independent active overlays without forcing one selection', () => {
  const { context } = loadWidgets();
  context.runtime = { activeLayers: ['wind', 'rain', 'rain', 'unknown'] };
  assert.deepEqual(
    JSON.parse(JSON.stringify(vm.runInContext('_weatherMapActiveLayers(runtime)', context))),
    ['wind', 'rain']
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(vm.runInContext('runtime.activeLayers = []; _weatherMapActiveLayers(runtime)', context))),
    []
  );
});

test('weather map view state survives runtime reloads without changing widget data', () => {
  const { context, storage } = loadWidgets();
  context.widget = {
    id: 'map-local-view',
    config: { locationName: 'London', latitude: 51.5, longitude: -0.1, units: 'metric', mapStyle: 'dark' }
  };
  const originalConfig = JSON.parse(JSON.stringify(context.widget.config));
  const result = vm.runInContext(`(() => {
    _writeWeatherMapView(widget, {
      forecastCenter: { latitude: 52.1, longitude: -1.2, label: 'Map centre · 52.100, -1.200' }
    });
    const first = _getWeatherMapRuntime(widget);
    first.activeLayers = ['wind', 'rain'];
    first.hourIndex = 9;
    first.camera = { latitude: 52.1, longitude: -1.2, zoom: 11.5 };
    first.attributionExpanded = false;
    _persistWeatherMapRuntime(widget, first);
    _weatherMapRuntime.clear();
    _weatherMapViewMemory.clear();
    const restored = _getWeatherMapRuntime(widget);
    return {
      layers: restored.activeLayers,
      hourIndex: restored.hourIndex,
      camera: restored.camera,
      attributionExpanded: restored.attributionExpanded,
      center: _weatherMapCenter(widget),
      label: _weatherMapLocationLabel(widget)
    };
  })()`, context);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    layers: ['wind', 'rain'],
    hourIndex: 9,
    camera: { latitude: 52.1, longitude: -1.2, zoom: 11.5 },
    attributionExpanded: false,
    center: { latitude: 52.1, longitude: -1.2 },
    label: 'Map centre · 52.100, -1.200'
  });
  assert.deepEqual(context.widget.config, originalConfig);
  assert.equal(storage.has('morpheus-webhub-weather-map-view:map-local-view'), true);
});

test('weather map carries camera and active overlays across forecast-centre changes', () => {
  const { context } = loadWidgets();
  context.widget = { id: 'map-camera', config: { latitude: 51.5, longitude: -0.1, units: 'metric' } };
  const result = vm.runInContext(`(() => {
    const first = _getWeatherMapRuntime(widget);
    first.activeLayers = ['wind', 'rain'];
    first.hourIndex = 7;
    first.camera = { latitude: 51.6, longitude: -0.2, zoom: 10.5 };
    first.attributionExpanded = false;
    _writeWeatherMapView(widget, {
      forecastCenter: { latitude: 51.6, longitude: -0.2, label: 'Map centre' }
    });
    const next = _getWeatherMapRuntime(widget);
    return { layers: next.activeLayers, hourIndex: next.hourIndex, camera: next.camera, attributionExpanded: next.attributionExpanded };
  })()`, context);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    layers: ['wind', 'rain'],
    hourIndex: 7,
    camera: { latitude: 51.6, longitude: -0.2, zoom: 10.5 },
    attributionExpanded: false
  });
});

test('weather map captures a valid MapLibre camera before rerendering', () => {
  const { context } = loadWidgets();
  context.instance = {
    widgetId: 'map-camera',
    runtime: {},
    map: {
      getCenter: () => ({ lat: 52.25, lng: -1.75 }),
      getZoom: () => 11.25
    }
  };
  const camera = vm.runInContext('_captureWeatherMapCamera(instance)', context);
  assert.deepEqual(JSON.parse(JSON.stringify(camera)), { latitude: 52.25, longitude: -1.75, zoom: 11.25 });
  assert.deepEqual(JSON.parse(JSON.stringify(context.instance.runtime.camera)), JSON.parse(JSON.stringify(camera)));
});

test('weather map captures compact attribution state before recreation', () => {
  const { context } = loadWidgets();
  context.instance = {
    runtime: {},
    widget: { id: 'map-attribution', config: { latitude: 51.5, longitude: -0.1 } },
    map: {
      getContainer: () => ({
        querySelector: () => ({
          classList: { contains: className => className === 'maplibregl-compact-show' }
        })
      })
    }
  };
  assert.equal(vm.runInContext('_captureWeatherMapAttribution(instance)', context), true);
  assert.equal(context.instance.runtime.attributionExpanded, true);
  assert.equal(vm.runInContext('_readWeatherMapView(instance.widget).attributionExpanded', context), true);
  assert.equal(context.instance.widget.config.attributionExpanded, undefined);
});

test('weather map discards a stale response and fetches the latest dragged centre', async () => {
  const pending = [];
  const requests = [];
  const { context, storage } = loadWidgets(url => {
    requests.push(String(url));
    return new Promise(resolve => pending.push(resolve));
  });
  context.widget = { id: 'map-drag', config: { latitude: 51.5, longitude: -0.1, units: 'metric' } };

  vm.runInContext('_ensureWeatherMapData(widget)', context);
  const firstRequest = vm.runInContext("_widgetFetches.get('weather-map:map-drag')", context);
  vm.runInContext("_writeWeatherMapView(widget, { forecastCenter: { latitude: 52.5, longitude: -0.1, label: 'Map centre' } })", context);
  pending[0]({
    ok: true,
    json: async () => [{ latitude: 51.5, longitude: -0.1, hourly: { time: ['2026-08-03T12:00'] } }]
  });
  await firstRequest;

  assert.equal(requests.length, 2);
  const secondRequest = vm.runInContext("_widgetFetches.get('weather-map:map-drag')", context);
  pending[1]({
    ok: true,
    json: async () => [{ latitude: 52.5, longitude: -0.1, hourly: { time: ['2026-08-03T12:00'] } }]
  });
  await secondRequest;

  const cache = JSON.parse(storage.get('morpheus-webhub-weather-map:map-drag'));
  assert.equal(cache.payload[0].latitude, 52.5);
  assert.match(cache.signature, /^52\.5000:/);
});

test('weather map uses dedicated layers and animation controls for combined overlays', () => {
  const root = path.join(__dirname, '..');
  const widgets = fs.readFileSync(path.join(root, 'source', 'widgets.js'), 'utf8');
  assert.match(widgets, /const WEATHER_MAP_LAYER_ORDER = \['temperature', 'clouds', 'rain'\]/);
  assert.match(widgets, /WEATHER_MAP_LAYER_ORDER\.forEach[\s\S]*?map\.addLayer[\s\S]*?setLayoutProperty\(layerId, 'visibility'/);
  assert.match(widgets, /button\.setAttribute\('aria-pressed',[\s\S]*?runtime\.activeLayers/);
  assert.match(widgets, /setInterval\(\(\) => \{[\s\S]*?runtime\.hourIndex[\s\S]*?900\)/);
  assert.match(widgets, /requestAnimationFrame\(tick\)/);
  assert.match(widgets, /circle-stroke-opacity/);
  assert.match(widgets, /nowButton\.textContent = 'Now'/);
  assert.match(widgets, /runtime\.hourIndex = _weatherMapCurrentHourIndex\(cache\)/);
  const legendHelper = widgets.slice(widgets.indexOf('function _weatherMapLegend'), widgets.indexOf('function _stopWeatherMapRainAnimation'));
  assert.doesNotMatch(legendHelper, /Wind speed/);
  assert.match(legendHelper, /activeLayers\.filter\(layer => layer !== 'wind'\)/);
  assert.match(widgets, /maxZoom:\s*13/);
  assert.doesNotMatch(widgets, /maxBounds:\s*grid\.bounds/);
  assert.match(widgets, /new ResizeObserver\(\(\) => _scheduleWeatherMapResize\(instance\)\)/);
  assert.match(widgets, /map\.on\('dragstart',[\s\S]*?map\.on\('moveend',[\s\S]*?_writeWeatherMapView\(widget, \{ forecastCenter, camera \}\)[\s\S]*?_ensureWeatherMapData\(widget\)/);
  const mapRender = widgets.slice(widgets.indexOf("WIDGET_REGISTRY['weatherMap']"));
  const mapInteractions = mapRender.slice(0, mapRender.indexOf('\n  renderSettings(widget, container)'));
  assert.doesNotMatch(mapInteractions, /widget\.config\.(?:latitude|longitude|locationName|attributionExpanded)\s*=/);
  assert.doesNotMatch(mapInteractions, /saveState\(\)/);
  assert.match(widgets, /_weatherMapSignature\(widget\) !== signature[\s\S]*?_ensureWeatherMapData\(widget\)/);
  assert.match(widgets, /_captureWeatherMapAttribution\(instance\)/);
  assert.match(widgets, /_restoreWeatherMapAttribution\(instance\)/);
});

test('weather map forecast refreshes update the existing canvas in place', () => {
  const widgets = fs.readFileSync(path.join(__dirname, '..', 'source', 'widgets.js'), 'utf8');
  const refresherStart = widgets.indexOf("timeInput.addEventListener('input'");
  const refresherEnd = widgets.indexOf('\n  renderSettings(widget, container)', refresherStart);
  assert.ok(refresherStart > 0 && refresherEnd > refresherStart);
  const inPlaceRefresh = widgets.slice(refresherStart, refresherEnd);
  assert.match(inPlaceRefresh, /_setWidgetRefresher\(widget\.id, context/);
  assert.match(inPlaceRefresh, /const refreshedCache = _readWeatherMapCache\(widget\)/);
  assert.match(inPlaceRefresh, /applyLayers\(\)/);
  assert.doesNotMatch(inPlaceRefresh, /_destroyWeatherMap\(/);
  assert.doesNotMatch(inPlaceRefresh, /el\.innerHTML\s*=\s*''/);
  assert.doesNotMatch(inPlaceRefresh, /WIDGET_REGISTRY\.weatherMap\.render\(/);
});

test('weather map assets are pinned locally and map instances are torn down before column rerenders', () => {
  const root = path.join(__dirname, '..');
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const widgets = fs.readFileSync(path.join(root, 'source', 'widgets.js'), 'utf8');
  const mapJs = fs.statSync(path.join(root, 'vendor', 'maplibre-gl', 'maplibre-gl.js'));
  const mapCss = fs.statSync(path.join(root, 'vendor', 'maplibre-gl', 'maplibre-gl.css'));
  const licence = fs.readFileSync(path.join(root, 'vendor', 'maplibre-gl', 'LICENSE.txt'), 'utf8');
  assert.ok(mapJs.size > 1_000_000);
  assert.ok(mapCss.size > 50_000);
  assert.match(licence, /Copyright \(c\) 2023, MapLibre contributors/);
  assert.match(index, /vendor\/maplibre-gl\/maplibre-gl\.css/);
  assert.match(index, /vendor\/maplibre-gl\/maplibre-gl\.js/);
  assert.match(widgets, /function clearColumnWidgetTimers\(\)[\s\S]*?_destroyAllWeatherMaps\(\);/);
  assert.match(widgets, /if \(instance\.playTimer\) clearInterval\(instance\.playTimer\)/);
  assert.match(widgets, /cancelAnimationFrame\(instance\.rainAnimationFrame\)/);
  assert.match(widgets, /https:\/\/tiles\.openfreemap\.org\/styles\//);
  assert.match(widgets, /attributionControl:\s*\{[\s\S]*?customAttribution:[\s\S]*?OpenFreeMap[\s\S]*?OpenMapTiles[\s\S]*?OpenStreetMap/);
});

test('weather map styling covers controls, timeline, legends and wind markers', () => {
  const styles = fs.readFileSync(path.join(__dirname, '..', 'source', 'styles.css'), 'utf8');
  assert.match(styles, /\.widget-weather-map-shell\s*\{/);
  assert.match(styles, /\.widget-weather-map-timeline\s*\{/);
  assert.match(styles, /\.widget-weather-map-legend\.is-rain/);
  assert.match(styles, /\.widget-weather-map-wind-marker\s*\{/);
  assert.match(styles, /@keyframes weather-map-wind-flow/);
  assert.match(styles, /\.widget-weather-map-play-btn\s*\{/);
  assert.match(styles, /\.widget-weather-map-now-btn/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(styles, /\.widget-weather-map\s*\{[\s\S]*?width:\s*100%;[\s\S]*?min-width:\s*0;/);
  const windMarker = styles.match(/\.widget-weather-map-wind-marker\s*\{([\s\S]*?)\}/)?.[1] || '';
  assert.match(windMarker, /background:\s*transparent/);
  assert.doesNotMatch(windMarker, /border-radius:\s*50%/);
  assert.match(styles, /\.widget-weather-map \.maplibregl-ctrl-group\s*\{[\s\S]*?var\(--border\)[\s\S]*?var\(--panel-r\)/);
  assert.match(styles, /\.widget-weather-map \.maplibregl-ctrl-group button\s*\{[\s\S]*?color:\s*var\(--text\)/);
  assert.match(styles, /\.widget-weather-map \.maplibregl-ctrl-zoom-in \.maplibregl-ctrl-icon[\s\S]*?background-image:\s*none/);
  assert.match(styles, /background:\s*currentColor/);
  assert.match(styles, /\.widget-weather-map-legend\s*\{[\s\S]*?width:\s*100%/);
  assert.match(styles, /\.widget-weather-map-legend-scale\s*\{[\s\S]*?width:\s*100%[\s\S]*?height:\s*22px/);
  assert.match(styles, /\.widget-weather-map-legend-tick\s*\{/);
  assert.match(styles, /#3288bd 31%[\s\S]*?#fee08b 69%/);
});
