// --- ISS Tracker widget ----------------------------------------------------

const _issTrackerInstances = new Map();
const _issTrackerRuntime = new Map();
let _issTleMemoryCache = null;

const ISS_TLE_CACHE_KEY = 'morpheus-webhub-iss-tle:v1';
const ISS_VIEW_PREFIX = 'morpheus-webhub-iss-view:';
const ISS_TLE_TTL_MS = 6 * 60 * 60 * 1000;
const ISS_TLE_RETRY_MS = 10 * 60 * 1000;
const ISS_PATH_BEHIND_MINUTES = 45;
const ISS_PATH_AHEAD_MINUTES = 100;

// ---- ISS Tracker helpers ----

function _normalizeLongitude(value) {
  return (((Number(value) + 180) % 360) + 360) % 360 - 180;
}

function _normalizeIssMapStyle(value) {
  return value === 'liberty' ? 'liberty' : 'dark';
}

function _issMapStyleUrl(value) {
  return `https://tiles.openfreemap.org/styles/${_normalizeIssMapStyle(value)}`;
}

function _issViewKey(widgetId) {
  return `${ISS_VIEW_PREFIX}${widgetId}`;
}

function _readIssView(widgetId) {
  try {
    const view = WidgetSDK.cache.get('issTracker', widgetId, 'view')
      || WidgetSDK.cache.migrateLegacy('issTracker', widgetId, 'view', _issViewKey(widgetId));
    if (!view) return null;
    const camera = {
      longitude: Number(view.longitude),
      latitude: Number(view.latitude),
      zoom: Number(view.zoom),
      bearing: Number(view.bearing || 0),
      pitch: Number(view.pitch || 0)
    };
    return Object.values(camera).every(Number.isFinite)
      ? {
          ...camera,
          focusOnIss: view.focusOnIss === true,
          attributionExpanded: typeof view.attributionExpanded === 'boolean' ? view.attributionExpanded : undefined
        }
      : null;
  } catch {
    return null;
  }
}

function _writeIssView(widgetId, map, updates = {}) {
  if (!map?.getCenter || !map?.getZoom) return null;
  try {
    const center = map.getCenter();
    const camera = {
      longitude: _normalizeLongitude(center.lng),
      latitude: Math.max(-89, Math.min(89, Number(center.lat))),
      zoom: Number(map.getZoom()),
      bearing: Number(map.getBearing?.() || 0),
      pitch: Number(map.getPitch?.() || 0)
    };
    if (!Object.values(camera).every(Number.isFinite)) return null;
    const previous = _readIssView(widgetId);
    const view = {
      ...camera,
      focusOnIss: updates.focusOnIss ?? previous?.focusOnIss ?? false,
      attributionExpanded: updates.attributionExpanded ?? previous?.attributionExpanded
    };
    WidgetSDK.cache.set('issTracker', widgetId, 'view', view);
    return view;
  } catch {
    return null;
  }
}

function _validIssTle(value) {
  return !!(value
    && typeof value.line1 === 'string' && value.line1.startsWith('1 ')
    && typeof value.line2 === 'string' && value.line2.startsWith('2 '));
}

function _readIssTleCache() {
  if (_validIssTle(_issTleMemoryCache)) return _issTleMemoryCache;
  try {
    const cached = WidgetSDK.cache.get('issTracker', 'shared', 'tle')
      || WidgetSDK.cache.migrateLegacy('issTracker', 'shared', 'tle', ISS_TLE_CACHE_KEY);
    if (_validIssTle(cached)) {
      _issTleMemoryCache = cached;
      return cached;
    }
  } catch {}
  return null;
}

function _writeIssTleCache(value) {
  const cache = {
    header: String(value?.header || 'ISS (ZARYA)'),
    line1: String(value?.line1 || '').trim(),
    line2: String(value?.line2 || '').trim(),
    fetchedAt: Number(value?.fetchedAt || Date.now()),
    source: String(value?.source || 'Where The ISS At')
  };
  if (!_validIssTle(cache)) throw new Error('The ISS data source returned an invalid orbital element set.');
  _issTleMemoryCache = cache;
  try { WidgetSDK.cache.set('issTracker', 'shared', 'tle', cache); } catch {}
  return cache;
}

function _isIssTleFresh(cache) {
  return !!cache && Date.now() - Number(cache.fetchedAt || 0) < ISS_TLE_TTL_MS;
}

function _getIssRuntime(widgetId) {
  let runtime = _issTrackerRuntime.get(widgetId);
  if (!runtime) {
    runtime = { status: 'idle', error: '', nextRetryAt: 0 };
    _issTrackerRuntime.set(widgetId, runtime);
  }
  return runtime;
}

async function _fetchIssTle() {
  try {
    const response = await _fetchWithTimeout('https://api.wheretheiss.at/v1/satellites/25544/tles', { widgetFetchKey: 'iss-tle', widgetType: 'issTracker' });
    let payload = null;
    try { payload = await response.json(); } catch { payload = null; }
    if (!response.ok) throw new Error(payload?.error || `Where The ISS At returned ${response.status}`);
    return _writeIssTleCache({
      header: payload?.header,
      line1: payload?.line1,
      line2: payload?.line2,
      source: 'Where The ISS At'
    });
  } catch (primaryError) {
    try {
      const response = await _fetchWithTimeout('https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=TLE', { widgetFetchKey: 'iss-tle', widgetType: 'issTracker' });
      const text = await response.text();
      if (!response.ok) throw new Error(`CelesTrak returned ${response.status}`);
      const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      const line1Index = lines.findIndex(line => line.startsWith('1 '));
      return _writeIssTleCache({
        header: line1Index > 0 ? lines[line1Index - 1] : 'ISS (ZARYA)',
        line1: lines[line1Index],
        line2: lines[line1Index + 1],
        source: 'CelesTrak'
      });
    } catch {
      throw primaryError;
    }
  }
}

function _ensureIssTle(widget, options = {}) {
  const force = options.force === true;
  const cache = _readIssTleCache();
  if (!force && _isIssTleFresh(cache)) return null;
  const runtime = _getIssRuntime(widget.id);
  if (!force && runtime.nextRetryAt > Date.now()) return null;
  const fetchKey = 'iss-tle';
  if (_widgetFetches.has(fetchKey)) return _widgetFetches.get(fetchKey);
  runtime.status = 'loading';
  runtime.error = '';
  const request = _fetchIssTle()
    .then(() => {
      _issTrackerRuntime.forEach(item => {
        item.status = 'ready';
        item.error = '';
        item.nextRetryAt = 0;
      });
    })
    .catch(error => {
      runtime.status = 'error';
      runtime.error = error?.message || 'Unable to refresh ISS orbital data.';
      runtime.nextRetryAt = Date.now() + ISS_TLE_RETRY_MS;
    })
    .finally(() => {
      _widgetFetches.delete(fetchKey);
      _issTrackerRuntime.forEach((_, widgetId) => _refreshWidget(widgetId, 'column'));
    });
  _widgetFetches.set(fetchKey, request);
  return request;
}

function _issSatrec(cache = _readIssTleCache()) {
  if (!_validIssTle(cache) || typeof satellite === 'undefined') return null;
  try {
    const satrec = satellite.twoline2satrec(cache.line1, cache.line2);
    return satrec?.error ? null : satrec;
  } catch {
    return null;
  }
}

function _issPosition(satrec, date = new Date()) {
  if (!satrec || typeof satellite === 'undefined') return null;
  try {
    const propagated = satellite.propagate(satrec, date);
    if (!propagated?.position || !propagated?.velocity) return null;
    const geodetic = satellite.eciToGeodetic(propagated.position, satellite.gstime(date));
    const speed = Math.hypot(propagated.velocity.x, propagated.velocity.y, propagated.velocity.z);
    const position = {
      date,
      longitude: satellite.degreesLong(geodetic.longitude),
      latitude: satellite.degreesLat(geodetic.latitude),
      altitude: geodetic.height,
      speed
    };
    return Object.values(position).slice(1).every(Number.isFinite) ? position : null;
  } catch {
    return null;
  }
}

function _splitAntimeridian(points) {
  if (!Array.isArray(points) || points.length < 2) return [];
  const lines = [[points[0]]];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const delta = current[0] - previous[0];
    if (Math.abs(delta) <= 180) {
      lines.at(-1).push(current);
      continue;
    }
    const eastward = delta < -180;
    const adjustedLongitude = current[0] + (eastward ? 360 : -360);
    const boundary = eastward ? 180 : -180;
    const ratio = (boundary - previous[0]) / (adjustedLongitude - previous[0]);
    const latitude = previous[1] + (current[1] - previous[1]) * ratio;
    lines.at(-1).push([boundary, latitude]);
    lines.push([[-boundary, latitude], current]);
  }
  return lines.filter(line => line.length > 1);
}

function _issGroundTrack(satrec, now = new Date()) {
  const past = [];
  const future = [];
  for (let minute = -ISS_PATH_BEHIND_MINUTES; minute <= ISS_PATH_AHEAD_MINUTES; minute += 1) {
    const position = _issPosition(satrec, new Date(now.getTime() + minute * 60 * 1000));
    if (!position) continue;
    (minute <= 0 ? past : future).push([position.longitude, position.latitude]);
  }
  return {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { segment: 'past' }, geometry: { type: 'MultiLineString', coordinates: _splitAntimeridian(past) } },
      { type: 'Feature', properties: { segment: 'future' }, geometry: { type: 'MultiLineString', coordinates: _splitAntimeridian(future) } }
    ]
  };
}

function _subsolarPoint(date = new Date()) {
  const radians = Math.PI / 180;
  const julianDate = date.getTime() / 86400000 + 2440587.5;
  const days = julianDate - 2451545;
  const meanLongitude = (280.460 + 0.9856474 * days) * radians;
  const meanAnomaly = (357.528 + 0.9856003 * days) * radians;
  const eclipticLongitude = meanLongitude + (1.915 * Math.sin(meanAnomaly) + 0.020 * Math.sin(2 * meanAnomaly)) * radians;
  const obliquity = (23.439 - 0.0000004 * days) * radians;
  const rightAscension = Math.atan2(Math.cos(obliquity) * Math.sin(eclipticLongitude), Math.cos(eclipticLongitude)) / radians;
  const declination = Math.asin(Math.sin(obliquity) * Math.sin(eclipticLongitude)) / radians;
  const centuries = days / 36525;
  const sidereal = 280.46061837 + 360.98564736629 * days + 0.000387933 * centuries * centuries - centuries * centuries * centuries / 38710000;
  return { longitude: _normalizeLongitude(rightAscension - sidereal), latitude: declination };
}

function _issLongitudeRange(start, end, step = 1) {
  const values = [];
  const direction = end >= start ? 1 : -1;
  const increment = Math.abs(step) * direction;
  for (let value = start; direction > 0 ? value < end : value > end; value += increment) {
    values.push(value);
  }
  values.push(end);
  return values;
}

function _issNightRectangle(west, east) {
  const bottom = _issLongitudeRange(west, east).map(longitude => [longitude, -89.9]);
  const top = _issLongitudeRange(east, west).map(longitude => [longitude, 89.9]);
  const ring = [...bottom, ...top];
  ring.push([...ring[0]]);
  return ring;
}

function _issDayNightGeoJson(date = new Date()) {
  const sun = _subsolarPoint(date);
  const radians = Math.PI / 180;
  const declination = sun.latitude * radians;

  if (Math.abs(Math.sin(declination)) < 0.0001) {
    const west = _normalizeLongitude(sun.longitude + 90);
    const east = west + 180;
    const ranges = east <= 180
      ? [[west, east]]
      : [[west, 180], [-180, east - 360]];
    const polygons = ranges.map(([rangeWest, rangeEast]) => [_issNightRectangle(rangeWest, rangeEast)]);
    return {
      night: {
        type: 'Feature',
        properties: {},
        geometry: polygons.length === 1
          ? { type: 'Polygon', coordinates: polygons[0] }
          : { type: 'MultiPolygon', coordinates: polygons }
      },
      border: {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'MultiLineString',
          coordinates: [west, _normalizeLongitude(east)].map(longitude => [[longitude, -89.9], [longitude, 89.9]])
        }
      }
    };
  }

  const boundary = _issLongitudeRange(-180, 180).map(longitude => {
    const longitudeDifference = (longitude - sun.longitude) * radians;
    const latitude = Math.atan(
      -Math.cos(declination) * Math.cos(longitudeDifference) / Math.sin(declination)
    ) / radians;
    return [longitude, latitude];
  });
  const poleLatitude = sun.latitude > 0 ? -89.9 : 89.9;
  const poleEdge = _issLongitudeRange(-180, 180).map(longitude => [longitude, poleLatitude]);
  const ring = sun.latitude > 0
    ? [...poleEdge, ...boundary.slice().reverse()]
    : [...boundary, ...poleEdge.slice().reverse()];
  ring.push([...ring[0]]);
  return {
    night: { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } },
    border: { type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: [boundary] } }
  };
}

function _destroyIssTracker(widgetId) {
  const instance = _issTrackerInstances.get(widgetId);
  if (!instance) return;
  _captureIssAttribution(instance);
  _writeIssView(widgetId, instance.map, {
    focusOnIss: instance.focusOnIss,
    attributionExpanded: instance.attributionExpanded
  });
  instance.resizeFrame?.cancel?.();
  try { instance.resizeObserver?.disconnect(); } catch {}
  if (instance.widgetCard) instance.widgetCard.draggable = true;
  try { instance.marker?.remove(); } catch {}
  try { instance.map?.remove(); } catch {}
  _issTrackerInstances.delete(widgetId);
}

function _destroyAllIssTrackers() {
  [..._issTrackerInstances.keys()].forEach(_destroyIssTracker);
}

function _captureIssAttribution(instance) {
  const container = instance?.map?.getContainer?.()?.querySelector?.('.maplibregl-ctrl-attrib.maplibregl-compact');
  if (!container) return null;
  const expanded = container.classList.contains('maplibregl-compact-show');
  instance.attributionExpanded = expanded;
  _writeIssView(instance.widgetId, instance.map, {
    focusOnIss: instance.focusOnIss,
    attributionExpanded: expanded
  });
  return expanded;
}

function _restoreIssAttribution(instance) {
  const container = instance?.map?.getContainer?.()?.querySelector?.('.maplibregl-ctrl-attrib.maplibregl-compact');
  if (!container) return;
  if (typeof instance.attributionExpanded !== 'boolean') {
    instance.attributionExpanded = container.classList.contains('maplibregl-compact-show');
  }
  container.classList.toggle('maplibregl-compact-show', instance.attributionExpanded);
  container.toggleAttribute?.('open', !instance.attributionExpanded);

  const button = container.querySelector('.maplibregl-ctrl-attrib-button');
  if (!button || instance.attributionButton === button) return;
  instance.attributionButton = button;
  button.addEventListener('click', () => {
    instance.attributionExpanded = container.classList.contains('maplibregl-compact-show');
    _writeIssView(instance.widgetId, instance.map, {
      focusOnIss: instance.focusOnIss,
      attributionExpanded: instance.attributionExpanded
    });
  });
}

function _scheduleIssResize(instance) {
  if (!instance?.map?.resize) return;
  instance.resizeFrame?.cancel?.();
  instance.resizeFrame = WidgetSDK.runtime.requestFrame(`${instance.widgetId}:iss-resize`, () => {
    instance.resizeFrame = null;
    if (_issTrackerInstances.get(instance.widgetId) !== instance) return;
    try { instance.map.resize(); } catch {}
  });
}

function _issSetSourceData(map, sourceId, data) {
  const source = map?.getSource?.(sourceId);
  if (source?.setData) source.setData(data);
}

function _updateIssTracker(instance, date = new Date(), forceGeometry = false) {
  if (!instance?.satrec || _issTrackerInstances.get(instance.widgetId) !== instance) return null;
  const position = _issPosition(instance.satrec, date);
  if (!position) return null;
  instance.currentPosition = position;
  instance.marker?.setLngLat([position.longitude, position.latitude]);
  if (instance.focusOnIss && instance.mapReady) {
    instance.map.jumpTo({ center: [position.longitude, position.latitude] });
  }
  instance.latitudeValue.textContent = `${Math.abs(position.latitude).toFixed(2)}° ${position.latitude >= 0 ? 'N' : 'S'}`;
  instance.longitudeValue.textContent = `${Math.abs(position.longitude).toFixed(2)}° ${position.longitude >= 0 ? 'E' : 'W'}`;
  instance.altitudeValue.textContent = `${Math.round(position.altitude)} km`;
  instance.speedValue.textContent = `${Math.round(position.speed * 3600).toLocaleString()} km/h`;

  const minuteKey = Math.floor(date.getTime() / 60000);
  if (forceGeometry || instance.geometryMinute !== minuteKey) {
    instance.geometryMinute = minuteKey;
    _issSetSourceData(instance.map, instance.sourceIds.track, _issGroundTrack(instance.satrec, date));
    const daylight = _issDayNightGeoJson(date);
    _issSetSourceData(instance.map, instance.sourceIds.night, daylight.night);
    _issSetSourceData(instance.map, instance.sourceIds.terminator, daylight.border);
  }
  return position;
}


// ---- ISS Tracker widget ----

WIDGET_REGISTRY['issTracker'] = {
  name: 'ISS Tracker',
  category: 'Space & Astronomy',
  description: 'Live ISS position, orbital ground track and Earth day/night boundary on an interactive globe',
  allowedIn: ['column'],
  defaultConfig: { mapStyle: 'dark', showNightShade: true },
  defaultData: {},
  liveSettingsPreview: false,
  reloadLabel: 'Refresh ISS orbital data',

  clearContextRuntime(widgetId, context) {
    if (context === 'column') _destroyIssTracker(widgetId);
  },

  resizeRuntime(widgetId) {
    _issTrackerInstances.get(widgetId)?.map?.resize?.();
  },

  dispose(widget) {
    _destroyIssTracker(widget.id);
    _issTrackerRuntime.delete(widget.id);
    WidgetSDK.cache.remove('issTracker', widget.id, 'view', { legacyKeys: [_issViewKey(widget.id)] });
  },

  reload(widget) {
    return _ensureIssTle(widget, { force: true });
  },

  render(widget, el, context) {
    _destroyIssTracker(widget.id);
    const runtime = _getIssRuntime(widget.id);
    const savedView = _readIssView(widget.id);
    let cache = _readIssTleCache();
    if (!_isIssTleFresh(cache)) _ensureIssTle(widget);

    _setWidgetRefresher(widget.id, context, () => {
      if (!el.isConnected) {
        _widgetRefreshers.delete(`${widget.id}:${context}`);
        return;
      }
      el.innerHTML = '';
      WIDGET_REGISTRY.issTracker.render(widget, el, context);
    });

    el.className = 'widget-iss-tracker';
    const header = document.createElement('div');
    header.className = 'widget-iss-header';
    const heading = document.createElement('div');
    heading.className = 'widget-iss-heading';
    const title = document.createElement('strong');
    title.textContent = 'International Space Station';
    const live = document.createElement('span');
    live.className = 'widget-iss-live';
    live.textContent = 'LIVE';
    heading.append(title, live);
    const locateButton = document.createElement('button');
    locateButton.type = 'button';
    locateButton.className = 'widget-iss-locate';
    locateButton.textContent = 'Find ISS';
    locateButton.title = 'Centre the globe on the ISS';
    header.append(heading, locateButton);
    el.appendChild(header);

    const mapShell = document.createElement('div');
    mapShell.className = 'widget-iss-map-shell widget-interactive-surface';
    const mapContainer = document.createElement('div');
    mapContainer.className = 'widget-iss-map-canvas';
    const focusButton = document.createElement('button');
    focusButton.type = 'button';
    focusButton.className = 'widget-iss-focus-button';
    focusButton.textContent = '◎ Focus ISS';
    focusButton.title = 'Keep the ISS centred as it moves';
    focusButton.setAttribute('aria-pressed', String(savedView?.focusOnIss === true));
    focusButton.classList.toggle('active', savedView?.focusOnIss === true);
    const northButton = document.createElement('button');
    northButton.type = 'button';
    northButton.className = 'widget-iss-north-button';
    northButton.textContent = 'N';
    northButton.title = 'Reset north';
    northButton.setAttribute('aria-label', 'Reset globe north');
    const status = document.createElement('div');
    status.className = 'widget-iss-status';
    const updateStatus = () => {
      status.classList.remove('hidden', 'is-error');
      if (runtime.status === 'error') {
        status.classList.add('is-error');
        status.textContent = cache
          ? `Using saved orbital data. ${runtime.error}`
          : runtime.error;
      } else if (runtime.status === 'loading') {
        status.textContent = cache ? 'Refreshing orbital data…' : 'Loading ISS orbital data…';
      } else if (!cache) {
        status.textContent = 'Waiting for ISS orbital data…';
      } else {
        status.classList.add('hidden');
      }
    };
    updateStatus();
    mapShell.append(mapContainer, focusButton, northButton, status);
    el.appendChild(mapShell);

    const legend = document.createElement('div');
    legend.className = 'widget-iss-legend';
    legend.innerHTML = '<span class="is-past">Previous path</span><span class="is-future">Upcoming path</span><span class="is-terminator">Day/night border</span>';
    el.appendChild(legend);

    const facts = document.createElement('div');
    facts.className = 'widget-iss-facts';
    const factElements = {};
    [['latitude', 'Latitude'], ['longitude', 'Longitude'], ['altitude', 'Altitude'], ['speed', 'Speed']].forEach(([key, label]) => {
      const fact = document.createElement('div');
      fact.className = 'widget-iss-fact';
      const caption = document.createElement('span');
      caption.textContent = label;
      const value = document.createElement('strong');
      value.textContent = '—';
      fact.append(caption, value);
      facts.appendChild(fact);
      factElements[`${key}Value`] = value;
    });
    el.appendChild(facts);

    const attribution = document.createElement('div');
    attribution.className = 'widget-iss-attribution';
    attribution.innerHTML = 'Orbit: <a href="https://wheretheiss.at/w/developer" target="_blank" rel="noreferrer noopener">Where The ISS At</a> / <a href="https://celestrak.org/" target="_blank" rel="noreferrer noopener">CelesTrak</a> · local SGP4 propagation';
    attribution.addEventListener('mousedown', event => event.stopPropagation());
    el.appendChild(attribution);

    if (typeof maplibregl === 'undefined' || typeof satellite === 'undefined') {
      status.classList.remove('hidden');
      status.classList.add('is-error');
      status.textContent = 'The globe or orbit engine failed to load.';
      return;
    }

    cache = _readIssTleCache();
    const satrec = _issSatrec(cache);
    if (cache && !satrec && runtime.status !== 'loading') _ensureIssTle(widget, { force: true });
    const initialPosition = _issPosition(satrec, new Date());
    const mapOptions = {
      container: mapContainer,
      style: _issMapStyleUrl(widget.config?.mapStyle),
      center: savedView
        ? [savedView.longitude, savedView.latitude]
        : [initialPosition?.longitude || 0, initialPosition?.latitude || 15],
      zoom: savedView?.zoom ?? 1.15,
      bearing: savedView?.bearing || 0,
      pitch: savedView?.pitch || 0,
      minZoom: 0.4,
      maxZoom: 8,
      dragRotate: true,
      pitchWithRotate: false,
      renderWorldCopies: false,
      attributionControl: {
        compact: true,
        customAttribution: '<a href="https://openfreemap.org/" target="_blank" rel="noreferrer">OpenFreeMap</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a>'
      }
    };
    let map = null;
    try {
      map = new maplibregl.Map(mapOptions);
      map.touchZoomRotate?.disableRotation?.();
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    } catch (error) {
      status.classList.remove('hidden');
      status.classList.add('is-error');
      status.textContent = error?.message || 'Unable to initialise the ISS globe.';
      return;
    }

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

    const sourceIds = {
      track: `iss-track-${widget.id}`,
      night: `iss-night-${widget.id}`,
      terminator: `iss-terminator-${widget.id}`
    };
    const instance = {
      widgetId: widget.id,
      widgetCard,
      map,
      satrec,
      sourceIds,
      marker: null,
      currentPosition: initialPosition,
      focusOnIss: savedView?.focusOnIss === true,
      attributionExpanded: savedView?.attributionExpanded,
      attributionButton: null,
      mapReady: false,
      geometryMinute: null,
      refreshCheckMinute: null,
      resizeFrame: 0,
      resizeObserver: null,
      ...factElements
    };
    _issTrackerInstances.set(widget.id, instance);
    _restoreIssAttribution(instance);

    if (typeof ResizeObserver === 'function') {
      instance.resizeObserver = new ResizeObserver(() => _scheduleIssResize(instance));
      instance.resizeObserver.observe(mapShell);
    }
    _scheduleIssResize(instance);

    map.on('load', () => {
      if (_issTrackerInstances.get(widget.id) !== instance) return;
      try {
        _restoreIssAttribution(instance);
        map.setProjection?.({ type: 'globe' });
        map.setSky?.({
          'sky-color': '#07111f',
          'sky-horizon-blend': 0.18,
          'horizon-color': '#13243a',
          'horizon-fog-blend': 0.05,
          'fog-color': '#07111f',
          'fog-ground-blend': 0.1
        });
        const daylight = _issDayNightGeoJson(new Date());
        map.addSource(sourceIds.night, { type: 'geojson', data: daylight.night });
        map.addSource(sourceIds.terminator, { type: 'geojson', data: daylight.border });
        map.addSource(sourceIds.track, { type: 'geojson', data: satrec ? _issGroundTrack(satrec, new Date()) : { type: 'FeatureCollection', features: [] } });
        map.addLayer({
          id: `${sourceIds.night}-fill`,
          type: 'fill',
          source: sourceIds.night,
          layout: { visibility: widget.config?.showNightShade === false ? 'none' : 'visible' },
          paint: { 'fill-color': '#020711', 'fill-opacity': 0.56, 'fill-antialias': true }
        });
        map.addLayer({
          id: `${sourceIds.night}-border`,
          type: 'line',
          source: sourceIds.terminator,
          paint: { 'line-color': '#9db7d6', 'line-width': 1.35, 'line-opacity': 0.82 }
        });
        map.addLayer({
          id: `${sourceIds.track}-past`,
          type: 'line',
          source: sourceIds.track,
          filter: ['==', ['get', 'segment'], 'past'],
          paint: { 'line-color': '#92d700', 'line-width': 2, 'line-opacity': 0.46, 'line-dasharray': [1.5, 1.3] }
        });
        map.addLayer({
          id: `${sourceIds.track}-future`,
          type: 'line',
          source: sourceIds.track,
          filter: ['==', ['get', 'segment'], 'future'],
          paint: { 'line-color': '#b6f200', 'line-width': 2.4, 'line-opacity': 0.95 }
        });

        const markerElement = document.createElement('div');
        markerElement.className = 'widget-iss-marker';
        markerElement.title = 'International Space Station';
        markerElement.innerHTML = '<span class="widget-iss-marker-icon">◆</span><span class="widget-iss-marker-label">ISS</span>';
        instance.marker = new maplibregl.Marker({ element: markerElement, anchor: 'center' })
          .setLngLat(initialPosition ? [initialPosition.longitude, initialPosition.latitude] : [0, 0])
          .addTo(map);
        markerElement.classList.toggle('hidden', !initialPosition);
        instance.mapReady = true;
        _updateIssTracker(instance, new Date(), true);
        _scheduleIssResize(instance);
        updateStatus();
      } catch (error) {
        status.classList.remove('hidden');
        status.classList.add('is-error');
        status.textContent = error?.message || 'Unable to finish initialising the ISS globe.';
      }
    });

    map.on('moveend', () => {
      if (_issTrackerInstances.get(widget.id) === instance && !instance.focusOnIss) {
        _writeIssView(widget.id, map);
      }
    });

    focusButton.addEventListener('click', event => {
      event.stopPropagation();
      instance.focusOnIss = !instance.focusOnIss;
      focusButton.classList.toggle('active', instance.focusOnIss);
      focusButton.setAttribute('aria-pressed', String(instance.focusOnIss));
      _writeIssView(widget.id, map, { focusOnIss: instance.focusOnIss });
      if (instance.focusOnIss && instance.currentPosition && instance.mapReady) {
        map.easeTo({
          center: [instance.currentPosition.longitude, instance.currentPosition.latitude],
          duration: 450
        });
      }
    });

    northButton.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      map.easeTo({ bearing: 0, pitch: 0, roll: 0, duration: 450 });
    });

    locateButton.addEventListener('click', event => {
      event.stopPropagation();
      const position = instance.currentPosition || _issPosition(instance.satrec, new Date());
      if (!position) return;
      map.easeTo({
        center: [position.longitude, position.latitude],
        zoom: Math.max(1.5, Math.min(3.2, map.getZoom())),
        duration: 850
      });
    });

    _setWidgetTimer(widget.id, context, () => {
      const currentInstance = _issTrackerInstances.get(widget.id);
      if (!currentInstance) return;
      const now = new Date();
      _updateIssTracker(currentInstance, now);
      const minute = Math.floor(now.getTime() / 60000);
      if (currentInstance.refreshCheckMinute !== minute) {
        currentInstance.refreshCheckMinute = minute;
        const latestCache = _readIssTleCache();
        if (!_isIssTleFresh(latestCache)) _ensureIssTle(widget);
      }
    }, 1000);
  },

  renderSettings(widget, container) {
    const c = widget.config || {};
    container.innerHTML = `
      <div class="settings-row">
        <span>Basemap</span>
        <div class="board-fit-radios weather-option-radios">
          <label class="board-fit-label"><input type="radio" name="issMapStyle" data-cfg="mapStyle" value="dark" ${_normalizeIssMapStyle(c.mapStyle) === 'dark' ? 'checked' : ''}/><span>Dark</span></label>
          <label class="board-fit-label"><input type="radio" name="issMapStyle" data-cfg="mapStyle" value="liberty" ${_normalizeIssMapStyle(c.mapStyle) === 'liberty' ? 'checked' : ''}/><span>Liberty</span></label>
        </div>
      </div>
      <div class="settings-row">
        <span>Shade night side</span>
        <label class="settings-toggle"><input type="checkbox" data-cfg="showNightShade" ${c.showNightShade !== false ? 'checked' : ''}/><span class="toggle-track"></span></label>
      </div>
      <div class="settings-help">Drag the globe with the left mouse button and use the mouse wheel or map controls to zoom. Globe orientation and zoom are saved only in this browser.</div>`;
  }
};
