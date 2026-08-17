// --- Weather Map widget ----------------------------------------------------

const _weatherMapMemoryCache = new Map();
const _weatherMapRuntime = new Map();
const _weatherMapInstances = new Map();
const _weatherMapViewMemory = new Map();

const WEATHER_MAP_CACHE_PREFIX = 'morpheus-webhub-weather-map:';
const WEATHER_MAP_VIEW_PREFIX = 'morpheus-webhub-weather-map-view:';
const WEATHER_MAP_CACHE_TTL_MS = 60 * 60 * 1000;
const WEATHER_MAP_ROWS = 5;
const WEATHER_MAP_COLUMNS = 7;
const WEATHER_MAP_FORECAST_HOURS = 49;
const WEATHER_MAP_LAYER_OPTIONS = [
  ['wind', 'Wind'],
  ['rain', 'Rain'],
  ['temperature', 'Temp'],
  ['clouds', 'Clouds']
];
const WEATHER_MAP_LAYER_ORDER = ['temperature', 'clouds', 'rain'];

function _normalizeWeatherMapStyle(value) {
  return value === 'liberty' ? 'liberty' : 'dark';
}

function _normalizeWeatherMapOriginZoom(value) {
  const zoom = Number(value);
  return Number.isFinite(zoom) ? Math.max(3, Math.min(13, Math.round(zoom * 4) / 4)) : 7;
}

function _weatherMapStyleUrl(value) {
  return `https://tiles.openfreemap.org/styles/${_normalizeWeatherMapStyle(value)}`;
}

function _weatherMapBaseLocationSignature(widget) {
  if (widget?.config?.latitude === '' || widget?.config?.latitude == null
      || widget?.config?.longitude === '' || widget?.config?.longitude == null) return '';
  const latitude = Number(widget?.config?.latitude);
  const longitude = Number(widget?.config?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return '';
  return `${latitude.toFixed(4)}:${longitude.toFixed(4)}:${_normalizeWeatherMapOriginZoom(widget?.config?.originZoom).toFixed(2)}`;
}

function _weatherMapViewKey(widgetId) {
  return `${WEATHER_MAP_VIEW_PREFIX}${widgetId}`;
}

function _readWeatherMapView(widget) {
  const key = _weatherMapViewKey(widget.id);
  let view = _weatherMapViewMemory.get(widget.id) || null;
  if (!view) {
    view = WidgetSDK.cache.get('weatherMap', widget.id, 'view')
      || WidgetSDK.cache.migrateLegacy('weatherMap', widget.id, 'view', key);
    if (view) _weatherMapViewMemory.set(widget.id, view);
  }
  return view?.baseLocationSignature === _weatherMapBaseLocationSignature(widget) ? view : null;
}

function _writeWeatherMapView(widget, updates = {}) {
  const baseLocationSignature = _weatherMapBaseLocationSignature(widget);
  if (!baseLocationSignature) return null;
  const key = _weatherMapViewKey(widget.id);
  const view = {
    ...(_readWeatherMapView(widget) || {}),
    ...updates,
    baseLocationSignature
  };
  _weatherMapViewMemory.set(widget.id, view);
  try { WidgetSDK.cache.set('weatherMap', widget.id, 'view', view); } catch {}
  return view;
}

function _clearWeatherMapView(widget) {
  const key = _weatherMapViewKey(widget.id);
  _weatherMapViewMemory.delete(widget.id);
  WidgetSDK.cache.remove('weatherMap', widget.id, 'view', { legacyKeys: [key] });
}

function _weatherMapCenter(widget) {
  const view = _readWeatherMapView(widget);
  const latitude = Number(view?.forecastCenter?.latitude);
  const longitude = Number(view?.forecastCenter?.longitude);
  if (Number.isFinite(latitude) && latitude >= -85 && latitude <= 85
      && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180) {
    return { latitude, longitude };
  }
  return {
    latitude: Number(widget?.config?.latitude),
    longitude: Number(widget?.config?.longitude)
  };
}

function _weatherMapLocationLabel(widget) {
  return _readWeatherMapView(widget)?.forecastCenter?.label
    || widget?.config?.locationName
    || 'Regional weather';
}

function _persistWeatherMapRuntime(widget, runtime) {
  if (!runtime) return null;
  return _writeWeatherMapView(widget, {
    activeLayers: [..._weatherMapActiveLayers(runtime)],
    hourIndex: Math.max(0, Number.parseInt(runtime.hourIndex, 10) || 0),
    camera: runtime.camera || null,
    attributionExpanded: runtime.attributionExpanded
  });
}

function _weatherMapSignature(widget) {
  const c = widget?.config || {};
  if (c.latitude === '' || c.latitude == null || c.longitude === '' || c.longitude == null) return '';
  const { latitude, longitude } = _weatherMapCenter(widget);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return '';
  return `${latitude.toFixed(4)}:${longitude.toFixed(4)}:${_normalizeWeatherUnits(c.units)}:${WEATHER_MAP_ROWS}x${WEATHER_MAP_COLUMNS}`;
}

function _weatherMapCacheKey(widgetId) {
  return `${WEATHER_MAP_CACHE_PREFIX}${widgetId}`;
}

function _readWeatherMapCache(widget) {
  const key = _weatherMapCacheKey(widget.id);
  let cache = _weatherMapMemoryCache.get(widget.id) || null;
  if (!cache) {
    cache = WidgetSDK.cache.get('weatherMap', widget.id, 'forecast')
      || WidgetSDK.cache.migrateLegacy('weatherMap', widget.id, 'forecast', key);
    if (cache) _weatherMapMemoryCache.set(widget.id, cache);
  }
  return cache?.signature === _weatherMapSignature(widget) && Array.isArray(cache?.payload) ? cache : null;
}

function _writeWeatherMapCache(widget, payload, signature = _weatherMapSignature(widget)) {
  const key = _weatherMapCacheKey(widget.id);
  const cache = { signature, fetchedAt: Date.now(), payload };
  _weatherMapMemoryCache.set(widget.id, cache);
  try { WidgetSDK.cache.set('weatherMap', widget.id, 'forecast', cache); } catch {}
  return cache;
}

function _isWeatherMapCacheFresh(cache) {
  return !!cache && Date.now() - Number(cache.fetchedAt || 0) < WEATHER_MAP_CACHE_TTL_MS;
}

function _getWeatherMapRuntime(widget) {
  const signature = _weatherMapSignature(widget);
  let runtime = _weatherMapRuntime.get(widget.id);
  if (!runtime || runtime.signature !== signature) {
    const previous = runtime;
    const savedView = _readWeatherMapView(widget);
    runtime = {
      signature,
      status: 'idle',
      error: '',
      nextRetryAt: 0,
      activeLayers: previous
        ? [..._weatherMapActiveLayers(previous)]
        : (Array.isArray(savedView?.activeLayers) ? [...savedView.activeLayers] : ['wind']),
      hourIndex: previous?.hourIndex ?? Math.max(0, Number.parseInt(savedView?.hourIndex, 10) || 0),
      camera: previous?.camera || savedView?.camera || null,
      attributionExpanded: previous?.attributionExpanded ?? savedView?.attributionExpanded ?? widget?.config?.attributionExpanded
    };
    _weatherMapRuntime.set(widget.id, runtime);
  }
  return runtime;
}

function _weatherMapActiveLayers(runtime) {
  const validLayers = new Set(WEATHER_MAP_LAYER_OPTIONS.map(([value]) => value));
  const layers = Array.isArray(runtime?.activeLayers)
    ? [...new Set(runtime.activeLayers.filter(layer => validLayers.has(layer)))]
    : ['wind'];
  if (runtime) runtime.activeLayers = layers;
  return layers;
}

function _destroyWeatherMap(widgetId, options = {}) {
  const instance = _weatherMapInstances.get(widgetId);
  if (!instance) return;
  if (options.preserveView !== false) {
    _captureWeatherMapCamera(instance);
    _captureWeatherMapAttribution(instance);
  }
  instance.playTimer?.cancel?.();
  instance.rainAnimationFrame?.cancel?.();
  instance.resizeFrame?.cancel?.();
  try { instance.resizeObserver?.disconnect(); } catch {}
  if (instance.widgetCard) instance.widgetCard.draggable = true;
  (instance.markers || []).forEach(marker => {
    try { marker.remove(); } catch {}
  });
  try { instance.map?.remove(); } catch {}
  _weatherMapInstances.delete(widgetId);
}

function _destroyAllWeatherMaps() {
  [..._weatherMapInstances.keys()].forEach(_destroyWeatherMap);
}

function _captureWeatherMapCamera(instance) {
  const map = instance?.map;
  if (!map?.getCenter || !map?.getZoom) return null;
  try {
    const center = map.getCenter();
    const camera = {
      longitude: Number(center.lng),
      latitude: Number(center.lat),
      zoom: Number(map.getZoom())
    };
    if (!Number.isFinite(camera.longitude) || !Number.isFinite(camera.latitude) || !Number.isFinite(camera.zoom)) return null;
    if (instance.runtime) instance.runtime.camera = camera;
    const currentRuntime = _weatherMapRuntime.get(instance.widgetId);
    if (currentRuntime) currentRuntime.camera = camera;
    if (instance.widget) _writeWeatherMapView(instance.widget, { camera });
    return camera;
  } catch {
    return null;
  }
}

function _scheduleWeatherMapResize(instance) {
  if (!instance?.map?.resize) return;
  instance.resizeFrame?.cancel?.();
  instance.resizeFrame = WidgetSDK.runtime.requestFrame(`${instance.widgetId}:weather-map-resize`, () => {
    instance.resizeFrame = null;
    if (_weatherMapInstances.get(instance.widgetId) !== instance) return;
    try { instance.map.resize(); } catch {}
  });
}

function _captureWeatherMapAttribution(instance) {
  const container = instance?.map?.getContainer?.()?.querySelector?.('.maplibregl-ctrl-attrib.maplibregl-compact');
  if (!container) return null;
  const expanded = container.classList.contains('maplibregl-compact-show');
  if (instance.runtime) instance.runtime.attributionExpanded = expanded;
  if (instance.widget) _writeWeatherMapView(instance.widget, { attributionExpanded: expanded });
  return expanded;
}

function _restoreWeatherMapAttribution(instance) {
  const container = instance?.map?.getContainer?.()?.querySelector?.('.maplibregl-ctrl-attrib.maplibregl-compact');
  if (!container) return;
  const runtime = instance.runtime;
  const configured = instance.widget?.config?.attributionExpanded;
  if (typeof runtime.attributionExpanded !== 'boolean') {
    runtime.attributionExpanded = typeof configured === 'boolean'
      ? configured
      : container.classList.contains('maplibregl-compact-show');
  }
  container.classList.toggle('maplibregl-compact-show', runtime.attributionExpanded);
  container.toggleAttribute('open', !runtime.attributionExpanded);

  const button = container.querySelector('.maplibregl-ctrl-attrib-button');
  if (!button || instance.attributionButton === button) return;
  instance.attributionButton = button;
  button.addEventListener('click', () => {
    const expanded = container.classList.contains('maplibregl-compact-show');
    runtime.attributionExpanded = expanded;
    _writeWeatherMapView(instance.widget, { attributionExpanded: expanded });
  });
}

function _buildWeatherMapGrid(widget) {
  const center = _weatherMapCenter(widget);
  const centerLat = Number(center.latitude);
  const centerLon = Number(center.longitude);
  const halfLat = 2.5;
  const latitudeScale = Math.max(0.35, Math.cos(centerLat * Math.PI / 180));
  const halfLon = Math.min(7, 3 / latitudeScale);
  const minLat = Math.max(-85, centerLat - halfLat);
  const maxLat = Math.min(85, centerLat + halfLat);
  const minLon = Math.max(-180, centerLon - halfLon);
  const maxLon = Math.min(180, centerLon + halfLon);
  const points = [];
  for (let row = 0; row < WEATHER_MAP_ROWS; row += 1) {
    const latitude = maxLat - ((maxLat - minLat) * row / (WEATHER_MAP_ROWS - 1));
    for (let column = 0; column < WEATHER_MAP_COLUMNS; column += 1) {
      const longitude = minLon + ((maxLon - minLon) * column / (WEATHER_MAP_COLUMNS - 1));
      points.push({ latitude, longitude });
    }
  }
  return { points, bounds: [[minLon, minLat], [maxLon, maxLat]] };
}

function _weatherMapForecastUrl(widget) {
  const units = _normalizeWeatherUnits(widget.config.units);
  const grid = _buildWeatherMapGrid(widget);
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', grid.points.map(point => point.latitude.toFixed(4)).join(','));
  url.searchParams.set('longitude', grid.points.map(point => point.longitude.toFixed(4)).join(','));
  url.searchParams.set('hourly', 'temperature_2m,precipitation,cloud_cover,wind_speed_10m,wind_direction_10m');
  url.searchParams.set('forecast_hours', String(WEATHER_MAP_FORECAST_HOURS));
  url.searchParams.set('timezone', 'GMT');
  url.searchParams.set('temperature_unit', units === 'imperial' ? 'fahrenheit' : 'celsius');
  url.searchParams.set('wind_speed_unit', units === 'imperial' ? 'mph' : 'kmh');
  url.searchParams.set('precipitation_unit', units === 'imperial' ? 'inch' : 'mm');
  return url.toString();
}

function _ensureWeatherMapData(widget, options = {}) {
  const signature = _weatherMapSignature(widget);
  if (!signature) return null;
  const force = options.force === true;
  const cache = _readWeatherMapCache(widget);
  if (!force && _isWeatherMapCacheFresh(cache)) return null;

  const runtime = _getWeatherMapRuntime(widget);
  const fetchKey = `weather-map:${widget.id}`;
  if (_widgetFetches.has(fetchKey)) return _widgetFetches.get(fetchKey);
  if (!force && runtime.nextRetryAt > Date.now()) return null;
  runtime.autoRefreshHour = _weatherRefreshHour();
  runtime.status = 'loading';
  runtime.error = '';

  const requestUrl = _weatherMapForecastUrl(widget);
  const request = _fetchWithTimeout(requestUrl, { widgetFetchKey: fetchKey, widgetType: 'weatherMap' }, 20000)
    .then(async response => {
      let payload = null;
      try { payload = await response.json(); } catch { payload = null; }
      if (!response.ok) throw new Error(payload?.reason || `Open-Meteo returned ${response.status}`);
      const locations = Array.isArray(payload) ? payload : [payload];
      if (!locations.length || !locations.every(location => Array.isArray(location?.hourly?.time))) {
        throw new Error('Open-Meteo returned incomplete map forecast data.');
      }
      if (_weatherMapSignature(widget) !== signature) return;
      _writeWeatherMapCache(widget, locations, signature);
      runtime.status = 'ready';
      runtime.error = '';
      runtime.nextRetryAt = 0;
    })
    .catch(error => {
      if (error?.name === 'AbortError') return;
      runtime.status = 'error';
      runtime.error = error?.message || 'Unable to load weather-map data.';
      runtime.nextRetryAt = Date.now() + WEATHER_RETRY_DELAY_MS;
    })
    .finally(() => {
      _widgetFetches.delete(fetchKey);
      if (_weatherMapSignature(widget) !== signature) _ensureWeatherMapData(widget);
      _refreshWidget(widget.id, 'column');
    });

  _widgetFetches.set(fetchKey, request);
  return request;
}

function _weatherMapNumber(value) {
  return _weatherNumber(value);
}

function _weatherMapFeatureCollection(cache, hourIndex) {
  const features = (cache?.payload || []).map(location => {
    const hourly = location.hourly || {};
    return {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [Number(location.longitude), Number(location.latitude)] },
      properties: {
        temperature: _weatherMapNumber(hourly.temperature_2m?.[hourIndex]),
        precipitation: _weatherMapNumber(hourly.precipitation?.[hourIndex]),
        cloudCover: _weatherMapNumber(hourly.cloud_cover?.[hourIndex]),
        windSpeed: _weatherMapNumber(hourly.wind_speed_10m?.[hourIndex]),
        windDirection: _weatherMapNumber(hourly.wind_direction_10m?.[hourIndex])
      }
    };
  }).filter(feature => feature.geometry.coordinates.every(Number.isFinite));
  return { type: 'FeatureCollection', features };
}

function _clearWeatherMapMarkers(instance) {
  (instance?.markers || []).forEach(marker => {
    try { marker.remove(); } catch {}
  });
  if (instance) instance.markers = [];
}

function _weatherMapCirclePaint(layer, units) {
  const radius = ['interpolate', ['linear'], ['zoom'], 3, 28, 7, 54];
  if (layer === 'temperature') {
    const stops = units === 'imperial'
      ? [-4, '#4b3f91', 32, '#3288bd', 59, '#66c2a5', 77, '#fee08b', 95, '#f46d43', 113, '#9e0142']
      : [-20, '#4b3f91', 0, '#3288bd', 15, '#66c2a5', 25, '#fee08b', 35, '#f46d43', 45, '#9e0142'];
    return {
      'circle-radius': radius,
      'circle-blur': 0.72,
      'circle-color': ['interpolate', ['linear'], ['get', 'temperature'], ...stops],
      'circle-opacity': 0.72
    };
  }
  if (layer === 'rain') {
    const max = units === 'imperial' ? 0.4 : 10;
    return {
      'circle-radius': radius,
      'circle-blur': 0.7,
      'circle-color': ['interpolate', ['linear'], ['get', 'precipitation'], 0, '#72c7ff', max * 0.15, '#2693ff', max * 0.5, '#3955d9', max, '#b62bd9'],
      'circle-opacity': ['interpolate', ['linear'], ['get', 'precipitation'], 0, 0, max * 0.03, 0.28, max, 0.9]
    };
  }
  return {
    'circle-radius': radius,
    'circle-blur': 0.72,
    'circle-color': ['interpolate', ['linear'], ['get', 'cloudCover'], 0, '#405066', 50, '#aeb8c5', 100, '#ffffff'],
    'circle-opacity': ['interpolate', ['linear'], ['get', 'cloudCover'], 0, 0.08, 100, 0.78]
  };
}

function _weatherMapLegend(layer, units) {
  if (layer === 'rain') {
    return {
      text: `Precipitation (${units === 'imperial' ? 'in/h' : 'mm/h'})`,
      cls: 'is-rain',
      ticks: units === 'imperial'
        ? [['0', 0], ['0.06', 15], ['0.2', 50], ['0.4+', 100]]
        : [['0', 0], ['1.5', 15], ['5', 50], ['10+', 100]]
    };
  }
  if (layer === 'temperature') {
    return {
      text: `Temperature (°${units === 'imperial' ? 'F' : 'C'})`,
      cls: 'is-temperature',
      ticks: units === 'imperial'
        ? [[-4, 0], [32, 31], [59, 54], [77, 69], [95, 85], [113, 100]]
        : [[-20, 0], [0, 31], [15, 54], [25, 69], [35, 85], [45, 100]]
    };
  }
  return { text: 'Cloud cover (%)', cls: 'is-clouds', ticks: [[0, 0], [50, 50], [100, 100]] };
}

function _renderWeatherMapLegends(widget, instance, runtime) {
  const units = _normalizeWeatherUnits(widget.config.units);
  const activeLayers = _weatherMapActiveLayers(runtime);
  const visibleLayers = activeLayers.filter(layer => layer !== 'wind');
  const signature = `${units}:${visibleLayers.join(',')}:${activeLayers.length}`;
  if (instance.legend.dataset.signature === signature) return;
  instance.legend.dataset.signature = signature;
  instance.legend.innerHTML = '';
  instance.legend.className = 'widget-weather-map-legends';
  if (!activeLayers.length) {
    instance.legend.classList.add('is-empty');
    const empty = document.createElement('span');
    empty.className = 'widget-weather-map-legend-empty';
    empty.textContent = 'All weather overlays are off.';
    instance.legend.appendChild(empty);
    return;
  }
  if (!visibleLayers.length) {
    instance.legend.classList.add('is-hidden');
    return;
  }

  WEATHER_MAP_LAYER_OPTIONS.forEach(([layer]) => {
    if (!visibleLayers.includes(layer)) return;
    const definition = _weatherMapLegend(layer, units);
    const row = document.createElement('div');
    row.className = `widget-weather-map-legend ${definition.cls}`;
    const label = document.createElement('span');
    label.className = 'widget-weather-map-legend-label';
    label.textContent = definition.text;
    const scale = document.createElement('div');
    scale.className = 'widget-weather-map-legend-scale';
    definition.ticks.forEach(([value, position], index) => {
      const tick = document.createElement('span');
      tick.className = `widget-weather-map-legend-tick${index === 0 ? ' is-first' : ''}${index === definition.ticks.length - 1 ? ' is-last' : ''}`;
      tick.style.left = `${position}%`;
      tick.textContent = String(value);
      scale.appendChild(tick);
    });
    row.append(label, scale);
    instance.legend.appendChild(row);
  });
}

function _stopWeatherMapRainAnimation(instance) {
  instance?.rainAnimationFrame?.cancel?.();
  if (instance) {
    instance.rainAnimationFrame = 0;
    instance.lastRainAnimationAt = 0;
  }
}

function _syncWeatherMapRainAnimation(instance, runtime) {
  const map = instance?.map;
  const rainLayerId = instance?.layerIds?.rain;
  const motionReduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!_weatherMapActiveLayers(runtime).includes('rain') || motionReduced || !map?.getLayer(rainLayerId)) {
    _stopWeatherMapRainAnimation(instance);
    if (map?.getLayer(rainLayerId)) {
      map.setPaintProperty(rainLayerId, 'circle-stroke-width', 0);
      map.setPaintProperty(rainLayerId, 'circle-stroke-opacity', 0);
    }
    return;
  }
  if (instance.rainAnimationFrame) return;

  const tick = timestamp => {
    if (!_weatherMapInstances.has(instance.widgetId) || !_weatherMapActiveLayers(runtime).includes('rain')) {
      _stopWeatherMapRainAnimation(instance);
      return;
    }
    if (timestamp - instance.lastRainAnimationAt >= 90 && map.isStyleLoaded() && map.getLayer(rainLayerId)) {
      const phase = (Math.sin(timestamp / 310) + 1) / 2;
      map.setPaintProperty(rainLayerId, 'circle-stroke-color', '#d8efff');
      map.setPaintProperty(rainLayerId, 'circle-stroke-width', 1 + phase * 4);
      map.setPaintProperty(rainLayerId, 'circle-stroke-opacity', 0.52 * (1 - phase));
      instance.lastRainAnimationAt = timestamp;
    }
    instance.rainAnimationFrame = WidgetSDK.runtime.requestFrame(`${instance.widgetId}:weather-map-rain`, tick);
  };
  instance.rainAnimationFrame = WidgetSDK.runtime.requestFrame(`${instance.widgetId}:weather-map-rain`, tick);
}

function _applyWeatherMapLayers(widget, instance, cache, runtime) {
  const map = instance?.map;
  if (!map?.isStyleLoaded()) return;
  const units = _normalizeWeatherUnits(widget.config.units);
  const data = _weatherMapFeatureCollection(cache, runtime.hourIndex);
  const sourceId = `weather-map-grid-${widget.id}`;
  const activeLayers = _weatherMapActiveLayers(runtime);

  if (!map.getSource(sourceId)) {
    map.addSource(sourceId, { type: 'geojson', data });
    WEATHER_MAP_LAYER_ORDER.forEach(layer => {
      const layerId = instance.layerIds[layer];
      map.addLayer({
        id: layerId,
        type: 'circle',
        source: sourceId,
        layout: { visibility: 'none' },
        paint: _weatherMapCirclePaint(layer, units)
      });
    });
  } else {
    map.getSource(sourceId).setData(data);
  }

  WEATHER_MAP_LAYER_ORDER.forEach(layer => {
    const layerId = instance.layerIds[layer];
    map.setLayoutProperty(layerId, 'visibility', activeLayers.includes(layer) ? 'visible' : 'none');
    const paint = _weatherMapCirclePaint(layer, units);
    Object.entries(paint).forEach(([name, value]) => map.setPaintProperty(layerId, name, value));
  });

  _clearWeatherMapMarkers(instance);
  if (activeLayers.includes('wind')) {
    data.features.forEach(feature => {
      const speed = feature.properties.windSpeed;
      const direction = feature.properties.windDirection;
      if (speed == null || direction == null) return;
      const markerEl = document.createElement('div');
      markerEl.className = 'widget-weather-map-wind-marker';
      markerEl.title = `${Math.round(speed)} ${units === 'imperial' ? 'mph' : 'km/h'}, from ${Math.round(direction)}°`;
      const arrow = document.createElement('span');
      arrow.className = 'widget-weather-map-wind-arrow';
      arrow.textContent = '➜';
      arrow.style.setProperty('--wind-direction', `${direction + 90}deg`);
      arrow.style.setProperty('--wind-duration', `${Math.max(0.7, 2.4 - Math.min(speed, 80) / 50).toFixed(2)}s`);
      const label = document.createElement('span');
      label.className = 'widget-weather-map-wind-speed';
      label.textContent = String(Math.round(speed));
      markerEl.append(arrow, label);
      const marker = new maplibregl.Marker({ element: markerEl, anchor: 'center' })
        .setLngLat(feature.geometry.coordinates)
        .addTo(map);
      instance.markers.push(marker);
    });
  }

  _renderWeatherMapLegends(widget, instance, runtime);
  _syncWeatherMapRainAnimation(instance, runtime);
}

function _weatherMapTimeLabel(cache, hourIndex) {
  const time = cache?.payload?.[0]?.hourly?.time?.[hourIndex];
  if (!time) return 'Forecast unavailable';
  const parsed = new Date(`${time}Z`);
  if (Number.isNaN(parsed.getTime())) return time;
  const formatted = parsed.toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  return hourIndex === _weatherMapCurrentHourIndex(cache) ? `Now · ${formatted}` : formatted;
}

function _weatherMapCurrentHourIndex(cache, now = Date.now()) {
  const times = cache?.payload?.[0]?.hourly?.time;
  if (!Array.isArray(times) || !times.length) return 0;
  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;
  times.forEach((time, index) => {
    const value = String(time);
    const timestamp = new Date(value.endsWith('Z') ? value : `${value}Z`).getTime();
    if (!Number.isFinite(timestamp)) return;
    const distance = Math.abs(timestamp - now);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  });
  return nearestIndex;
}

// ---- Weather Map widget ----

WIDGET_REGISTRY['weatherMap'] = {
  name: 'Weather Map',
  category: 'Weather & Network',
  description: 'Regional wind, rain, temperature and cloud forecasts on an interactive map',
  allowedIn: ['column'],
  defaultConfig: {
    locationName: '',
    latitude: '',
    longitude: '',
    timezone: 'auto',
    units: 'metric',
    mapStyle: 'dark',
    originZoom: 7
  },
  defaultData: {},
  liveSettingsPreview: false,

  clearContextRuntime(widgetId, context) {
    if (context === 'column') _destroyWeatherMap(widgetId);
  },

  resizeRuntime(widgetId) {
    _weatherMapInstances.get(widgetId)?.map?.resize?.();
  },

  dispose(widget) {
    const cacheKey = _weatherMapCacheKey(widget.id);
    const viewKey = _weatherMapViewKey(widget.id);
    _destroyWeatherMap(widget.id, { preserveView: false });
    _weatherMapRuntime.delete(widget.id);
    _weatherMapMemoryCache.delete(widget.id);
    _weatherMapViewMemory.delete(widget.id);
    WidgetSDK.cache.remove('weatherMap', widget.id, 'forecast', { legacyKeys: [cacheKey] });
    WidgetSDK.cache.remove('weatherMap', widget.id, 'view', { legacyKeys: [viewKey] });
  },

  onSettingsCommit(widget, previousConfig) {
    const previousOrigin = _weatherMapBaseLocationSignature({ config: previousConfig });
    const nextOrigin = _weatherMapBaseLocationSignature(widget);
    if (previousOrigin === nextOrigin) return;
    _destroyWeatherMap(widget.id, { preserveView: false });
    _clearWeatherMapView(widget);
    _weatherMapRuntime.delete(widget.id);
  },

  reloadLabel: 'Reset Weather Map to its origin',

  reload(widget) {
    _destroyWeatherMap(widget.id);
    _clearWeatherMapView(widget);
    _weatherMapRuntime.delete(widget.id);
    return _ensureWeatherMapData(widget, { force: true });
  },

  render(widget, el, context) {
    _destroyWeatherMap(widget.id);
    const c = widget.config || {};
    const signature = _weatherMapSignature(widget);

    _setWidgetRefresher(widget.id, context, () => {
      _destroyWeatherMap(widget.id);
      if (!el.isConnected) {
        _widgetRefreshers.delete(`${widget.id}:${context}`);
        return;
      }
      el.innerHTML = '';
      WIDGET_REGISTRY.weatherMap.render(widget, el, context);
    });

    el.className = 'widget-weather-map';
    if (!signature) {
      const placeholder = document.createElement('div');
      placeholder.className = 'widget-weather-placeholder';
      placeholder.textContent = 'Choose a location in the widget settings to load the regional weather map.';
      el.appendChild(placeholder);
      return;
    }

    let cache = _readWeatherMapCache(widget);
    let runtime = _getWeatherMapRuntime(widget);
    if (_claimWeatherRefreshHour(runtime)) {
      _ensureWeatherMapData(widget, { force: true });
    } else if (!_isWeatherMapCacheFresh(cache)) {
      _ensureWeatherMapData(widget);
    }
    _setWidgetTimer(widget.id, context, () => {
      const currentRuntime = _getWeatherMapRuntime(widget);
      if (_claimWeatherRefreshHour(currentRuntime)) {
        _ensureWeatherMapData(widget, { force: true });
      } else if (!_isWeatherMapCacheFresh(_readWeatherMapCache(widget))) {
        _ensureWeatherMapData(widget);
      }
    }, 60 * 1000);
    cache = _readWeatherMapCache(widget);
    let availableHours = Math.max(1, cache?.payload?.[0]?.hourly?.time?.length || WEATHER_MAP_FORECAST_HOURS);
    runtime.hourIndex = Math.min(runtime.hourIndex, availableHours - 1);

    const header = document.createElement('div');
    header.className = 'widget-weather-map-header';
    const location = document.createElement('div');
    location.className = 'widget-weather-map-location';
    location.textContent = _weatherMapLocationLabel(widget);
    header.appendChild(location);

    const layerControls = document.createElement('div');
    layerControls.className = 'widget-weather-map-layers';
    const activeLayers = _weatherMapActiveLayers(runtime);
    WEATHER_MAP_LAYER_OPTIONS.forEach(([value, label]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'widget-weather-map-layer-btn';
      button.dataset.layer = value;
      button.textContent = label;
      button.classList.toggle('active', activeLayers.includes(value));
      button.setAttribute('aria-pressed', String(activeLayers.includes(value)));
      button.title = `Toggle ${label.toLowerCase()} overlay`;
      layerControls.appendChild(button);
    });
    header.appendChild(layerControls);
    el.appendChild(header);

    const mapShell = document.createElement('div');
    mapShell.className = 'widget-weather-map-shell widget-interactive-surface';
    const widgetCard = el.closest('.widget-card');
    const disableWidgetDrag = () => { if (widgetCard) widgetCard.draggable = false; };
    const restoreWidgetDrag = () => { if (widgetCard) widgetCard.draggable = true; };
    mapShell.addEventListener('mouseenter', disableWidgetDrag);
    mapShell.addEventListener('mouseleave', restoreWidgetDrag);
    mapShell.addEventListener('touchstart', disableWidgetDrag, { passive: true });
    mapShell.addEventListener('touchend', restoreWidgetDrag, { passive: true });
    mapShell.addEventListener('dragstart', event => {
      event.preventDefault();
      event.stopPropagation();
    });
    const mapContainer = document.createElement('div');
    mapContainer.className = 'widget-weather-map-canvas';
    const status = document.createElement('div');
    status.className = 'widget-weather-map-status';
    if (!cache) status.textContent = runtime.status === 'error' ? runtime.error : 'Loading regional forecast...';
    else if (runtime.status === 'loading') status.textContent = 'Refreshing regional forecast...';
    else if (runtime.status === 'error') status.textContent = `Showing saved forecast. ${runtime.error}`;
    else status.classList.add('hidden');
    if (runtime.status === 'error') status.classList.add('is-error');
    mapShell.append(mapContainer, status);
    el.appendChild(mapShell);

    const timeline = document.createElement('div');
    timeline.className = 'widget-weather-map-timeline';
    const timelineControls = document.createElement('div');
    timelineControls.className = 'widget-weather-map-timeline-controls';
    const playButton = document.createElement('button');
    playButton.type = 'button';
    playButton.className = 'widget-weather-map-play-btn';
    playButton.textContent = '▶';
    playButton.title = 'Play forecast';
    playButton.setAttribute('aria-label', 'Play forecast');
    playButton.setAttribute('aria-pressed', 'false');
    playButton.disabled = !cache;
    const nowButton = document.createElement('button');
    nowButton.type = 'button';
    nowButton.className = 'widget-weather-map-now-btn';
    nowButton.textContent = 'Now';
    nowButton.title = 'Reset to the current forecast time';
    nowButton.setAttribute('aria-label', 'Reset forecast to current time');
    nowButton.disabled = !cache;
    timelineControls.append(playButton, nowButton);
    const timeLabel = document.createElement('span');
    timeLabel.className = 'widget-weather-map-time-label';
    timeLabel.textContent = _weatherMapTimeLabel(cache, runtime.hourIndex);
    const timeInput = document.createElement('input');
    timeInput.type = 'range';
    timeInput.min = '0';
    timeInput.max = String(availableHours - 1);
    timeInput.step = '1';
    timeInput.value = String(runtime.hourIndex);
    timeInput.disabled = !cache;
    timeInput.setAttribute('aria-label', 'Forecast time');
    timeline.append(timelineControls, timeLabel, timeInput);
    el.appendChild(timeline);

    const legends = document.createElement('div');
    legends.className = 'widget-weather-map-legends';
    el.appendChild(legends);
    _renderWeatherMapLegends(widget, { legend: legends }, runtime);

    const attribution = document.createElement('a');
    attribution.className = 'widget-weather-attribution';
    attribution.href = 'https://open-meteo.com/';
    attribution.target = '_blank';
    attribution.rel = 'noreferrer noopener';
    attribution.textContent = 'Weather data by Open-Meteo.com';
    attribution.addEventListener('mousedown', event => event.stopPropagation());
    el.appendChild(attribution);

    if (typeof maplibregl === 'undefined') {
      status.classList.remove('hidden');
      status.classList.add('is-error');
      status.textContent = 'MapLibre failed to load.';
      return;
    }

    const savedCamera = runtime.camera;
    const hasSavedCamera = savedCamera
      && Number.isFinite(Number(savedCamera.longitude))
      && Number.isFinite(Number(savedCamera.latitude))
      && Number.isFinite(Number(savedCamera.zoom));
    const mapOptions = {
      container: mapContainer,
      style: _weatherMapStyleUrl(c.mapStyle),
      minZoom: 3,
      maxZoom: 13,
      dragRotate: false,
      pitchWithRotate: false,
      attributionControl: {
        compact: true,
        customAttribution: '<a href="https://openfreemap.org/" target="_blank" rel="noreferrer">OpenFreeMap</a> · <a href="https://openmaptiles.org/" target="_blank" rel="noreferrer">© OpenMapTiles</a> · Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>'
      }
    };
    if (hasSavedCamera) {
      mapOptions.center = [Number(savedCamera.longitude), Number(savedCamera.latitude)];
      mapOptions.zoom = Math.max(3, Math.min(13, Number(savedCamera.zoom)));
    } else {
      const initialCenter = _weatherMapCenter(widget);
      mapOptions.center = [Number(initialCenter.longitude), Number(initialCenter.latitude)];
      mapOptions.zoom = _normalizeWeatherMapOriginZoom(c.originZoom);
    }
    let map = null;
    try {
      map = new maplibregl.Map(mapOptions);
      map.touchZoomRotate.disableRotation();
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    } catch (error) {
      status.classList.remove('hidden');
      status.classList.add('is-error');
      status.textContent = error?.message || 'Unable to initialise the weather map.';
      return;
    }

    const instance = {
      widgetId: widget.id,
      widget,
      map,
      runtime,
      widgetCard,
      markers: [],
      legend: legends,
      layerIds: {
        temperature: `weather-map-temperature-${widget.id}`,
        clouds: `weather-map-clouds-${widget.id}`,
        rain: `weather-map-rain-${widget.id}`
      },
      playTimer: 0,
      rainAnimationFrame: 0,
      lastRainAnimationAt: 0,
      resizeFrame: 0,
      resizeObserver: null,
      locationDragPending: false,
      attributionButton: null
    };
    _weatherMapInstances.set(widget.id, instance);
    _restoreWeatherMapAttribution(instance);
    if (typeof ResizeObserver === 'function') {
      instance.resizeObserver = new ResizeObserver(() => _scheduleWeatherMapResize(instance));
      instance.resizeObserver.observe(mapShell);
    }
    _scheduleWeatherMapResize(instance);

    const applyLayers = () => {
      if (!cache || _weatherMapInstances.get(widget.id) !== instance) return;
      _applyWeatherMapLayers(widget, instance, cache, runtime);
      timeLabel.textContent = _weatherMapTimeLabel(cache, runtime.hourIndex);
      timeInput.value = String(runtime.hourIndex);
    };

    const setPlayback = playing => {
      instance.playTimer?.cancel?.();
      instance.playTimer = null;
      playButton.classList.toggle('active', playing);
      playButton.textContent = playing ? '❚❚' : '▶';
      playButton.title = playing ? 'Pause forecast' : 'Play forecast';
      playButton.setAttribute('aria-label', playButton.title);
      playButton.setAttribute('aria-pressed', String(playing));
      if (!playing || !cache) return;
      instance.playTimer = WidgetSDK.runtime.schedule(`${widget.id}:weather-map-playback`, () => {
        runtime.hourIndex = (runtime.hourIndex + 1) % availableHours;
        applyLayers();
      }, 900);
    };

    map.on('load', () => {
      if (_weatherMapInstances.get(widget.id) !== instance) return;
      _scheduleWeatherMapResize(instance);
      _restoreWeatherMapAttribution(instance);
      applyLayers();
      if (cache && runtime.status !== 'error' && runtime.status !== 'loading') status.classList.add('hidden');
    });

    map.on('dragstart', () => {
      instance.locationDragPending = true;
      runtime.attributionExpanded = false;
      _writeWeatherMapView(widget, { attributionExpanded: false });
    });

    map.on('moveend', () => {
      if (_weatherMapInstances.get(widget.id) !== instance) return;
      const camera = _captureWeatherMapCamera(instance);
      if (!camera || !instance.locationDragPending) return;
      instance.locationDragPending = false;
      const latitude = Math.max(-85, Math.min(85, camera.latitude));
      const longitude = Math.max(-180, Math.min(180, camera.longitude));
      const previousCenter = _weatherMapCenter(widget);
      if (Math.abs(latitude - Number(previousCenter.latitude)) < 0.0001
          && Math.abs(longitude - Number(previousCenter.longitude)) < 0.0001) return;
      const forecastCenter = {
        latitude: Number(latitude.toFixed(4)),
        longitude: Number(longitude.toFixed(4)),
        label: `Map centre · ${latitude.toFixed(3)}, ${longitude.toFixed(3)}`
      };
      _writeWeatherMapView(widget, { forecastCenter, camera });
      location.textContent = forecastCenter.label;
      status.classList.remove('hidden', 'is-error');
      status.textContent = 'Loading forecast for the new map centre...';
      runtime = _getWeatherMapRuntime(widget);
      runtime.camera = camera;
      instance.runtime = runtime;
      _ensureWeatherMapData(widget);
    });

    layerControls.querySelectorAll('.widget-weather-map-layer-btn').forEach(button => {
      button.addEventListener('click', event => {
        event.stopPropagation();
        const layers = _weatherMapActiveLayers(runtime);
        runtime.activeLayers = layers.includes(button.dataset.layer)
          ? layers.filter(layer => layer !== button.dataset.layer)
          : [...layers, button.dataset.layer];
        button.classList.toggle('active', runtime.activeLayers.includes(button.dataset.layer));
        button.setAttribute('aria-pressed', String(runtime.activeLayers.includes(button.dataset.layer)));
        _persistWeatherMapRuntime(widget, runtime);
        applyLayers();
      });
    });

    playButton.addEventListener('click', event => {
      event.stopPropagation();
      const playing = !instance.playTimer;
      setPlayback(playing);
      if (!playing) _persistWeatherMapRuntime(widget, runtime);
    });

    nowButton.addEventListener('click', event => {
      event.stopPropagation();
      setPlayback(false);
      runtime.hourIndex = _weatherMapCurrentHourIndex(cache);
      _persistWeatherMapRuntime(widget, runtime);
      applyLayers();
    });

    timeInput.addEventListener('input', event => {
      event.stopPropagation();
      setPlayback(false);
      runtime.hourIndex = Math.max(0, Math.min(availableHours - 1, Number.parseInt(timeInput.value, 10) || 0));
      _persistWeatherMapRuntime(widget, runtime);
      applyLayers();
    });

    _setWidgetRefresher(widget.id, context, () => {
      if (!el.isConnected || _weatherMapInstances.get(widget.id) !== instance) {
        _widgetRefreshers.delete(`${widget.id}:${context}`);
        return;
      }

      runtime = _getWeatherMapRuntime(widget);
      instance.runtime = runtime;
      const refreshedCache = _readWeatherMapCache(widget);
      if (refreshedCache) cache = refreshedCache;
      availableHours = Math.max(1, cache?.payload?.[0]?.hourly?.time?.length || WEATHER_MAP_FORECAST_HOURS);
      runtime.hourIndex = Math.min(runtime.hourIndex, availableHours - 1);
      location.textContent = _weatherMapLocationLabel(widget);
      timeInput.max = String(availableHours - 1);
      timeInput.value = String(runtime.hourIndex);
      timeInput.disabled = !cache;
      playButton.disabled = !cache;
      nowButton.disabled = !cache;

      layerControls.querySelectorAll('.widget-weather-map-layer-btn').forEach(button => {
        const active = _weatherMapActiveLayers(runtime).includes(button.dataset.layer);
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
      });

      status.classList.remove('is-error');
      if (runtime.status === 'loading') {
        status.classList.remove('hidden');
        status.textContent = refreshedCache ? 'Refreshing regional forecast...' : 'Loading forecast for the new map centre...';
      } else if (runtime.status === 'error') {
        status.classList.remove('hidden');
        status.classList.add('is-error');
        status.textContent = cache
          ? `Showing the previous forecast. ${runtime.error}`
          : runtime.error;
      } else {
        status.classList.add('hidden');
      }

      applyLayers();
      _restoreWeatherMapAttribution(instance);
    });
  },

  renderSettings(widget, container) {
    const c = widget.config || {};
    container.innerHTML = `
      <div class="settings-row settings-row--top">
        <span>Origin location</span>
        <div class="weather-location-picker">
          <div class="weather-location-search-row">
            <input type="search" class="settings-text-input weather-map-location-search" placeholder="City or postcode" autocomplete="off" />
            <button type="button" class="secondary-btn weather-map-location-search-btn">Search</button>
          </div>
          <div class="weather-map-location-selected settings-muted"></div>
          <div class="weather-map-location-results weather-location-results"></div>
        </div>
      </div>
      <div class="settings-row">
        <span>Current map centre</span>
        <span class="settings-muted weather-map-current-centre"></span>
      </div>
      <div class="settings-row">
        <span>Origin zoom</span>
        <div class="weather-map-origin-zoom-control">
          <input type="range" class="weather-map-origin-zoom" min="3" max="13" step="0.25" value="${_normalizeWeatherMapOriginZoom(c.originZoom)}" />
          <input type="hidden" data-cfg="originZoom" value="${_normalizeWeatherMapOriginZoom(c.originZoom)}" />
          <output class="weather-map-origin-zoom-value">${_normalizeWeatherMapOriginZoom(c.originZoom).toFixed(2)}</output>
        </div>
      </div>
      <div class="settings-row">
        <span>Current zoom</span>
        <span class="settings-muted weather-map-current-zoom"></span>
      </div>
      <div class="settings-row settings-row--top">
        <span>Origin preview</span>
        <div class="weather-map-origin-preview">
          <div class="weather-map-origin-preview-canvas"></div>
          <div class="weather-map-origin-preview-message"></div>
        </div>
      </div>
      <div class="settings-row">
        <span>Units</span>
        <div class="board-fit-radios weather-option-radios">
          <label class="board-fit-label"><input type="radio" name="weatherMapUnits" data-cfg="units" value="metric" ${_normalizeWeatherUnits(c.units) === 'metric' ? 'checked' : ''}/><span>Metric</span></label>
          <label class="board-fit-label"><input type="radio" name="weatherMapUnits" data-cfg="units" value="imperial" ${_normalizeWeatherUnits(c.units) === 'imperial' ? 'checked' : ''}/><span>Imperial</span></label>
        </div>
      </div>
      <div class="settings-row">
        <span>Basemap</span>
        <div class="board-fit-radios weather-option-radios">
          <label class="board-fit-label"><input type="radio" name="weatherMapStyle" data-cfg="mapStyle" value="dark" ${_normalizeWeatherMapStyle(c.mapStyle) === 'dark' ? 'checked' : ''}/><span>Dark</span></label>
          <label class="board-fit-label"><input type="radio" name="weatherMapStyle" data-cfg="mapStyle" value="liberty" ${_normalizeWeatherMapStyle(c.mapStyle) === 'liberty' ? 'checked' : ''}/><span>Liberty</span></label>
        </div>
      </div>
      <div class="settings-help">Drag the live map to change its browser-local current centre and zoom. Use the reload icon on the widget to return to this origin. Rain is forecast precipitation, not live radar.</div>`;

    const input = container.querySelector('.weather-map-location-search');
    const searchBtn = container.querySelector('.weather-map-location-search-btn');
    const selected = container.querySelector('.weather-map-location-selected');
    const results = container.querySelector('.weather-map-location-results');
    const currentCentre = container.querySelector('.weather-map-current-centre');
    const currentZoom = container.querySelector('.weather-map-current-zoom');
    const originZoom = container.querySelector('.weather-map-origin-zoom');
    const originZoomValue = container.querySelector('.weather-map-origin-zoom-value');
    const originZoomConfig = container.querySelector('[data-cfg="originZoom"]');
    const previewCanvas = container.querySelector('.weather-map-origin-preview-canvas');
    const previewMessage = container.querySelector('.weather-map-origin-preview-message');
    selected.textContent = c.locationName ? `Origin: ${c.locationName}` : 'No origin location selected.';

    let previewMap = null;
    let previewMarker = null;
    const settingsSignal = _wstgAbort?.signal;
    const destroyPreview = () => {
      try { previewMarker?.remove(); } catch {}
      try { previewMap?.remove(); } catch {}
      previewMarker = null;
      previewMap = null;
    };
    settingsSignal?.addEventListener('abort', destroyPreview, { once: true });

    const updateCurrentViewSummary = () => {
      const center = _weatherMapCenter(widget);
      const savedView = _readWeatherMapView(widget);
      currentCentre.textContent = Number.isFinite(center.latitude) && Number.isFinite(center.longitude)
        ? `${center.latitude.toFixed(4)}, ${center.longitude.toFixed(4)}`
        : 'Unavailable';
      const zoom = Number(savedView?.camera?.zoom);
      currentZoom.textContent = (Number.isFinite(zoom) ? zoom : _normalizeWeatherMapOriginZoom(c.originZoom)).toFixed(2);
    };

    const updatePreview = () => {
      const latitude = Number(c.latitude);
      const longitude = Number(c.longitude);
      const zoom = _normalizeWeatherMapOriginZoom(c.originZoom);
      originZoom.value = String(zoom);
      originZoomConfig.value = String(zoom);
      originZoomValue.textContent = zoom.toFixed(2);
      updateCurrentViewSummary();
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
          || c.latitude === '' || c.longitude === '') {
        destroyPreview();
        previewMessage.textContent = 'Choose an origin location to preview the map.';
        previewMessage.classList.remove('hidden');
        return;
      }
      if (typeof maplibregl === 'undefined') {
        previewMessage.textContent = 'Map preview is unavailable.';
        previewMessage.classList.remove('hidden');
        return;
      }
      previewMessage.classList.add('hidden');
      if (!previewMap) {
        previewMap = new maplibregl.Map({
          container: previewCanvas,
          style: _weatherMapStyleUrl(c.mapStyle),
          center: [longitude, latitude],
          zoom,
          minZoom: 3,
          maxZoom: 13,
          interactive: false,
          attributionControl: false
        });
        const markerEl = document.createElement('div');
        markerEl.className = 'weather-map-origin-marker';
        previewMarker = new maplibregl.Marker({ element: markerEl })
          .setLngLat([longitude, latitude])
          .addTo(previewMap);
      } else {
        previewMap.jumpTo({ center: [longitude, latitude], zoom });
        previewMarker?.setLngLat([longitude, latitude]);
      }
      WidgetSDK.runtime.requestFrame(`${widget.id}:weather-map-settings-resize`, () => {
        try { previewMap?.resize(); } catch {}
      });
    };

    originZoom.addEventListener('input', event => {
      event.stopPropagation();
      c.originZoom = _normalizeWeatherMapOriginZoom(originZoom.value);
      updatePreview();
    });
    container.querySelectorAll('input[name="weatherMapStyle"]').forEach(radio => {
      radio.addEventListener('change', () => {
        if (!radio.checked) return;
        c.mapStyle = _normalizeWeatherMapStyle(radio.value);
        if (previewMap) previewMap.setStyle(_weatherMapStyleUrl(c.mapStyle));
      });
    });
    WidgetSDK.runtime.requestFrame(`${widget.id}:weather-map-settings-preview`, () => {
      if (!settingsSignal?.aborted) updatePreview();
    });
    settingsSignal?.addEventListener('abort', () => {
      WidgetSDK.runtime.cancelFrame(`${widget.id}:weather-map-settings-resize`);
      WidgetSDK.runtime.cancelFrame(`${widget.id}:weather-map-settings-preview`);
    }, { once: true });

    _bindOpenMeteoLocationSearch({
      widgetType: 'weatherMap',
      input,
      button: searchBtn,
      results,
      signal: _wstgAbort?.signal,
      onSelect(result, label) {
        widget.config.locationName = label;
        widget.config.latitude = result.latitude;
        widget.config.longitude = result.longitude;
        widget.config.timezone = result.timezone || 'auto';
        selected.textContent = `Origin: ${label}`;
        updatePreview();
      }
    });
  }
};
