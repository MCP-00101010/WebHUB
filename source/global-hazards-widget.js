// --- Global Hazards widget ------------------------------------------------
// Near-real-time provider data and view state stay in the Widget SDK cache.

const GLOBAL_HAZARD_TYPES = Object.freeze({
  earthquake: { label: 'Earthquakes', short: 'Quake', color: '#f0b35b', symbol: '≈' },
  wildfire: { label: 'Wildfires', short: 'Fire', color: '#ed6a4a', symbol: '◆' },
  storm: { label: 'Storms', short: 'Storm', color: '#7a9cff', symbol: '●' },
  volcano: { label: 'Volcanoes', short: 'Volcano', color: '#d56b9d', symbol: '▲' },
  flood: { label: 'Floods', short: 'Flood', color: '#45b7d1', symbol: '≋' },
  tsunami: { label: 'Tsunamis', short: 'Tsunami', color: '#39c6ad', symbol: '≋' },
  landslide: { label: 'Landslides', short: 'Slide', color: '#b39a72', symbol: '◢' },
  drought: { label: 'Droughts', short: 'Drought', color: '#d1a94d', symbol: '◌' },
  temperature: { label: 'Temperature extremes', short: 'Temp', color: '#ff8d5d', symbol: '±' },
  airburst: { label: 'Fireballs and airbursts', short: 'Airburst', color: '#c68cff', symbol: '✦' }
});
const GLOBAL_HAZARD_TYPE_ORDER = Object.freeze(Object.keys(GLOBAL_HAZARD_TYPES));
const GLOBAL_HAZARD_SEVERITIES = Object.freeze(['info', 'moderate', 'high', 'critical']);
const GLOBAL_HAZARD_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const GLOBAL_HAZARD_CACHE_SCHEMA = 'v3-expanded-feeds';
const GLOBAL_HAZARD_MAX_EVENTS = 1000;
const GLOBAL_HAZARD_SOURCE_URLS = Object.freeze({
  EONET: 'https://eonet.gsfc.nasa.gov/',
  USGS: 'https://earthquake.usgs.gov/',
  GDACS: 'https://www.gdacs.org/',
  JPL: 'https://cneos.jpl.nasa.gov/fireballs/',
  NOAA: 'https://www.swpc.noaa.gov/'
});
const _globalHazardRuntime = new Map();
const _globalHazardInstances = new Map();
const _globalHazardViewMemory = new Map();

function _globalHazardMapStyle(value) {
  return typeof _normalizeWeatherMapStyle === 'function' ? _normalizeWeatherMapStyle(value) : (value === 'liberty' ? 'liberty' : 'dark');
}

function _globalHazardMapStyleUrl(value) {
  return typeof _weatherMapStyleUrl === 'function' ? _weatherMapStyleUrl(value) : `https://tiles.openfreemap.org/styles/${_globalHazardMapStyle(value)}`;
}

function _globalHazardClamp(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
}

function _globalHazardSafeUrl(value) {
  return /^https:\/\//i.test(String(value || '')) ? String(value).slice(0, 800) : '';
}

function _globalHazardBrowserReportUrl(value) {
  const safe = _globalHazardSafeUrl(value);
  if (!safe) return '';
  try {
    const pathname = new URL(safe).pathname;
    if (/\.(?:tcw|kml|kmz|shp|zip|gz|grb2?|nc|csv)$/i.test(pathname)) return '';
  } catch { return ''; }
  return safe;
}

function _globalHazardConfig(widget) {
  const config = widget.config || {};
  const categorySchema = Math.max(1, Number(config.categorySchema) || 1);
  let categories = Array.isArray(config.categories) ? config.categories.filter(type => GLOBAL_HAZARD_TYPES[type]) : [...GLOBAL_HAZARD_TYPE_ORDER];
  if (categorySchema < 2) categories = [...categories, 'temperature', 'airburst'];
  widget.config = {
    days: [1, 7, 14, 30, 60].includes(Number(config.days)) ? Number(config.days) : 30,
    earthquakeMagnitude: [2.5, 4, 4.5, 5, 5.5].includes(Number(config.earthquakeMagnitude)) ? Number(config.earthquakeMagnitude) : 4.5,
    refreshMinutes: [15, 30, 60].includes(Number(config.refreshMinutes)) ? Number(config.refreshMinutes) : 15,
    mapStyle: _globalHazardMapStyle(config.mapStyle),
    categories: categories.length ? [...new Set(categories)] : [...GLOBAL_HAZARD_TYPE_ORDER],
    minimumSeverity: GLOBAL_HAZARD_SEVERITIES.includes(config.minimumSeverity) ? config.minimumSeverity : 'info',
    useWeatherLocation: config.useWeatherLocation !== false,
    locationName: String(config.locationName || '').trim().slice(0, 120),
    latitude: config.latitude === '' || config.latitude == null ? '' : _globalHazardClamp(config.latitude, -90, 90, ''),
    longitude: config.longitude === '' || config.longitude == null ? '' : _globalHazardClamp(config.longitude, -180, 180, ''),
    watchRadiusKm: Math.round(_globalHazardClamp(config.watchRadiusKm, 25, 5000, 500)),
    notificationSeverity: ['moderate', 'high', 'critical'].includes(config.notificationSeverity) ? config.notificationSeverity : 'high',
    notifications: config.notifications === true,
    spaceWeather: config.spaceWeather !== false,
    categorySchema: 2
  };
  return widget.config;
}

function _globalHazardSignature(widget) {
  const config = _globalHazardConfig(widget);
  return `${GLOBAL_HAZARD_CACHE_SCHEMA}:${config.days}:${config.earthquakeMagnitude}:${config.spaceWeather ? 1 : 0}`;
}

function _globalHazardNormalizeView(widget, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const config = _globalHazardConfig(widget);
  const savedTypes = Array.isArray(value.activeTypes)
    ? [...new Set(value.activeTypes.filter(type => config.categories.includes(type) && GLOBAL_HAZARD_TYPES[type]))]
    : null;
  const longitude = Number(value.camera?.longitude); const latitude = Number(value.camera?.latitude); const zoom = Number(value.camera?.zoom);
  const camera = Number.isFinite(longitude) && longitude >= -180 && longitude <= 180
    && Number.isFinite(latitude) && latitude >= -85 && latitude <= 85
    && Number.isFinite(zoom) && zoom >= 1 && zoom <= 12
    ? { longitude, latitude, zoom } : null;
  return {
    activeTypes: savedTypes,
    selectedId: String(value.selectedId || '').slice(0, 160),
    camera,
    attributionExpanded: typeof value.attributionExpanded === 'boolean' ? value.attributionExpanded : undefined,
    listScrollTop: Math.max(0, Math.min(100000, Number(value.listScrollTop) || 0))
  };
}

function _globalHazardReadView(widget) {
  let view = _globalHazardViewMemory.get(widget.id) || null;
  if (!view) {
    view = _globalHazardNormalizeView(widget, WidgetSDK.cache.get('globalHazards', widget.id, 'view'));
    if (view) _globalHazardViewMemory.set(widget.id, view);
  }
  return view;
}

function _globalHazardWriteView(widget, updates = {}) {
  const view = _globalHazardNormalizeView(widget, { ...(_globalHazardReadView(widget) || {}), ...updates });
  if (!view) return null;
  _globalHazardViewMemory.set(widget.id, view);
  try { WidgetSDK.cache.set('globalHazards', widget.id, 'view', view); } catch {}
  return view;
}

function _globalHazardPersistRuntime(widget, runtime) {
  if (!runtime) return null;
  return _globalHazardWriteView(widget, {
    activeTypes: [...runtime.activeTypes], selectedId: runtime.selectedId,
    camera: runtime.camera, attributionExpanded: runtime.attributionExpanded,
    listScrollTop: runtime.listScrollTop
  });
}

function _globalHazardRuntimeState(widget) {
  let runtime = _globalHazardRuntime.get(widget.id);
  if (!runtime) {
    const config = _globalHazardConfig(widget); const view = _globalHazardReadView(widget);
    runtime = {
      status: 'idle', error: '', loading: null,
      selectedId: view?.selectedId || '', activeTypes: new Set(view?.activeTypes ?? config.categories),
      camera: view?.camera || null, attributionExpanded: view?.attributionExpanded,
      listScrollTop: view?.listScrollTop || 0
    };
    _globalHazardRuntime.set(widget.id, runtime);
  }
  return runtime;
}

function _globalHazardSeverityIndex(value) {
  return Math.max(0, GLOBAL_HAZARD_SEVERITIES.indexOf(String(value || 'info')));
}

function _globalHazardCoordinate(value) {
  if (!Array.isArray(value) || value.length < 2) return null;
  const longitude = Number(value[0]); const latitude = Number(value[1]);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) return null;
  return [longitude, latitude];
}

function _globalHazardGeometryPoint(geometry) {
  if (!geometry) return null;
  if (geometry.type === 'Point') return _globalHazardCoordinate(geometry.coordinates);
  if (geometry.type === 'LineString') return _globalHazardCoordinate(geometry.coordinates?.at(-1));
  const ring = geometry.type === 'Polygon' ? geometry.coordinates?.[0] : (geometry.type === 'MultiPolygon' ? geometry.coordinates?.[0]?.[0] : null);
  const points = (Array.isArray(ring) ? ring : []).map(_globalHazardCoordinate).filter(Boolean);
  if (!points.length) return null;
  return [points.reduce((sum, point) => sum + point[0], 0) / points.length, points.reduce((sum, point) => sum + point[1], 0) / points.length];
}

function _globalHazardEvent(value = {}) {
  const coordinates = _globalHazardCoordinate(value.coordinates);
  const timestamp = Number(value.timestamp);
  if (!value.id || !GLOBAL_HAZARD_TYPES[value.type] || !coordinates || !Number.isFinite(timestamp)) return null;
  const severity = GLOBAL_HAZARD_SEVERITIES.includes(value.severity) ? value.severity : 'info';
  return {
    id: String(value.id).slice(0, 160), type: value.type, title: String(value.title || GLOBAL_HAZARD_TYPES[value.type].label).slice(0, 180),
    description: String(value.description || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500),
    coordinates, track: (Array.isArray(value.track) ? value.track : []).map(_globalHazardCoordinate).filter(Boolean).slice(-100),
    timestamp, updatedAt: Number(value.updatedAt) || timestamp, severity,
    magnitude: String(value.magnitude || '').slice(0, 100), source: String(value.source || '').slice(0, 40),
    url: _globalHazardBrowserReportUrl(value.url), tsunamiPotential: value.tsunamiPotential === true
  };
}

function _globalHazardEonetType(category) {
  const id = String(category?.id || '').toLowerCase();
  if (id === 'wildfires') return 'wildfire';
  if (id === 'severestorms') return 'storm';
  if (id === 'volcanoes') return 'volcano';
  if (id === 'floods') return 'flood';
  if (id === 'landslides') return 'landslide';
  if (id === 'drought') return 'drought';
  if (id === 'tempextremes') return 'temperature';
  return '';
}

function _globalHazardEonetSeverity(type, geometry) {
  const magnitude = Number(geometry?.magnitudeValue); const unit = String(geometry?.magnitudeUnit || '').toLowerCase();
  if (!Number.isFinite(magnitude)) return 'info';
  if (type === 'storm' && unit.includes('kt')) return magnitude >= 96 ? 'critical' : (magnitude >= 64 ? 'high' : (magnitude >= 48 ? 'moderate' : 'info'));
  if (type === 'wildfire' && unit.includes('acre')) return magnitude >= 50000 ? 'critical' : (magnitude >= 10000 ? 'high' : (magnitude >= 1000 ? 'moderate' : 'info'));
  return 'moderate';
}

function _globalHazardNormalizeEonet(payload) {
  return (Array.isArray(payload?.events) ? payload.events : []).map(event => {
    const type = (event?.categories || []).map(_globalHazardEonetType).find(Boolean); const geometries = Array.isArray(event?.geometry) ? event.geometry : [];
    const geometry = [...geometries].reverse().find(entry => _globalHazardGeometryPoint(entry)); const coordinates = _globalHazardGeometryPoint(geometry);
    if (!type || !geometry || !coordinates) return null;
    const magnitude = geometry.magnitudeValue == null ? '' : `${geometry.magnitudeValue}${geometry.magnitudeUnit ? ` ${geometry.magnitudeUnit}` : ''}`;
    return _globalHazardEvent({
      id: `eonet:${event.id}`, type, title: event.title, description: event.description, coordinates,
      track: geometries.filter(entry => entry?.type === 'Point').map(entry => entry.coordinates), timestamp: Date.parse(geometry.date),
      updatedAt: Date.parse(geometry.date), severity: _globalHazardEonetSeverity(type, geometry), magnitude, source: 'NASA EONET',
      url: event.sources?.map(source => source?.url).find(_globalHazardBrowserReportUrl)
        || _globalHazardBrowserReportUrl(event.link)
    });
  }).filter(Boolean);
}

function _globalHazardUsgsSeverity(properties) {
  const alert = String(properties?.alert || '').toLowerCase(); const magnitude = Number(properties?.mag);
  if (alert === 'red' || magnitude >= 7) return 'critical';
  if (alert === 'orange' || magnitude >= 6) return 'high';
  if (alert === 'yellow' || magnitude >= 5) return 'moderate';
  return 'info';
}

function _globalHazardNormalizeUsgs(payload) {
  return (Array.isArray(payload?.features) ? payload.features : []).map(feature => {
    const properties = feature?.properties || {}; const coordinates = _globalHazardGeometryPoint(feature?.geometry);
    return _globalHazardEvent({
      id: `usgs:${feature?.id}`, type: 'earthquake', title: properties.title || properties.place, description: properties.place,
      coordinates, timestamp: Number(properties.time), updatedAt: Number(properties.updated), severity: _globalHazardUsgsSeverity(properties),
      magnitude: Number.isFinite(Number(properties.mag)) ? `M ${Number(properties.mag).toFixed(1)}` : '', source: 'USGS', url: properties.url,
      tsunamiPotential: Number(properties.tsunami) === 1
    });
  }).filter(Boolean);
}

function _globalHazardGdacsType(value) {
  return ({ TC: 'storm', FL: 'flood', VO: 'volcano', DR: 'drought', WF: 'wildfire', TS: 'tsunami' })[String(value || '').toUpperCase()] || '';
}

function _globalHazardNormalizeGdacs(payload) {
  return (Array.isArray(payload?.features) ? payload.features : []).map(feature => {
    const properties = feature?.properties || {}; const type = _globalHazardGdacsType(properties.eventtype);
    const alert = String(properties.alertlevel || '').toLowerCase();
    if (!type || (type !== 'tsunami' && type !== 'storm' && !['orange', 'red'].includes(alert))) return null;
    return _globalHazardEvent({
      id: `gdacs:${properties.eventtype}:${properties.eventid}`, type, title: properties.name || properties.description,
      description: properties.description || properties.htmldescription, coordinates: _globalHazardGeometryPoint(feature.geometry),
      timestamp: Date.parse(properties.fromdate), updatedAt: Date.parse(properties.datemodified || properties.todate),
      severity: alert === 'red' ? 'critical' : (alert === 'orange' ? 'high' : 'moderate'),
      magnitude: properties.severitydata?.severitytext || '', source: 'GDACS', url: properties.url?.report
    });
  }).filter(Boolean);
}

function _globalHazardNormalizeFireballs(payload) {
  const fields = Array.isArray(payload?.fields) ? payload.fields.map(String) : [];
  return (Array.isArray(payload?.data) ? payload.data : []).map(values => {
    if (!Array.isArray(values) || !fields.length) return null;
    const record = Object.fromEntries(fields.map((field, index) => [field, values[index]]));
    const latitude = Number(record.lat) * (String(record['lat-dir']).toUpperCase() === 'S' ? -1 : 1);
    const longitude = Number(record.lon) * (String(record['lon-dir']).toUpperCase() === 'W' ? -1 : 1);
    const timestamp = Date.parse(`${String(record.date || '').trim().replace(' ', 'T')}Z`);
    const impactEnergy = Number(record['impact-e']); const altitude = Number(record.alt); const radiatedEnergy = Number(record.energy);
    if (![latitude, longitude, timestamp].every(Number.isFinite)) return null;
    const severity = impactEnergy >= 100 ? 'critical' : (impactEnergy >= 10 ? 'high' : (impactEnergy >= 1 ? 'moderate' : 'info'));
    const coordinateLabel = `${Math.abs(latitude).toFixed(1)}° ${latitude < 0 ? 'S' : 'N'}, ${Math.abs(longitude).toFixed(1)}° ${longitude < 0 ? 'W' : 'E'}`;
    const magnitude = [
      Number.isFinite(impactEnergy) ? `${impactEnergy.toLocaleString()} kt estimated impact` : '',
      Number.isFinite(altitude) ? `${altitude.toLocaleString()} km altitude` : ''
    ].filter(Boolean).join(' · ');
    const description = Number.isFinite(radiatedEnergy)
      ? `Detected at peak brightness with approximately ${(radiatedEnergy * 1e10).toExponential(2)} joules of radiated energy.`
      : 'Atmospheric fireball detected at peak brightness.';
    return _globalHazardEvent({
      id: `jpl:${record.date}:${latitude}:${longitude}`, type: 'airburst', title: `Atmospheric fireball over ${coordinateLabel}`,
      description, coordinates: [longitude, latitude], timestamp, updatedAt: timestamp, severity, magnitude,
      source: 'NASA/JPL CNEOS', url: GLOBAL_HAZARD_SOURCE_URLS.JPL
    });
  }).filter(Boolean);
}

function _globalHazardParseNoaaDate(value) {
  const normalized = String(value || '').trim().replace(' ', 'T');
  return normalized ? Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(normalized) ? normalized : `${normalized}Z`) : NaN;
}

function _globalHazardSpaceSeverity(level) {
  const value = Number(level) || 0;
  return value >= 4 ? 'critical' : (value >= 2 ? 'high' : (value >= 1 ? 'moderate' : 'info'));
}

function _globalHazardNormalizeSpaceWeather(scalesPayload, alertsPayload, widget) {
  if (!scalesPayload && !alertsPayload) return null;
  const current = scalesPayload?.['0'] || scalesPayload?.[0] || {};
  const updatedAt = _globalHazardParseNoaaDate(`${current.DateStamp || ''} ${current.TimeStamp || ''}`);
  const scaleNames = { G: 'Geomagnetic storm', S: 'Solar radiation storm', R: 'Radio blackout' };
  const scales = scalesPayload ? ['G', 'S', 'R'].map(code => {
    const scale = Math.max(0, Math.min(5, Number(current?.[code]?.Scale) || 0));
    return { code, scale, label: scaleNames[code], text: String(current?.[code]?.Text || (scale ? '' : 'none')).trim().toLowerCase(), severity: _globalHazardSpaceSeverity(scale) };
  }) : [];
  const windowStart = _globalHazardWindowStart(widget);
  const alerts = (Array.isArray(alertsPayload) ? alertsPayload : []).map(record => {
    const timestamp = _globalHazardParseNoaaDate(record?.issue_datetime); const message = String(record?.message || '');
    const match = message.match(/NOAA Scale:\s*([GSR])\s*([1-5])\s*-\s*([^\r\n]+)/i);
    if (!match || !Number.isFinite(timestamp) || timestamp < windowStart) return null;
    const titleLine = message.split(/\r?\n/).map(line => line.trim()).find(line => /^(?:CANCEL\s+)?(?:ALERT|WARNING|WATCH|SUMMARY):/i.test(line));
    const impacts = message.match(/Potential Impacts:\s*([\s\S]+)/i)?.[1]?.replace(/\s+/g, ' ').trim() || '';
    const level = Number(match[2]);
    return {
      id: `noaa:${record.product_id || match[1]}:${record.issue_datetime}`, code: match[1].toUpperCase(), level,
      title: String(titleLine || `${scaleNames[match[1].toUpperCase()]} ${match[1].toUpperCase()}${level}`).replace(/^CANCEL\s+/i, 'Cancelled '),
      description: impacts.slice(0, 500), timestamp, severity: _globalHazardSpaceSeverity(level),
      url: 'https://www.swpc.noaa.gov/products/alerts-watches-and-warnings'
    };
  }).filter(Boolean).sort((left, right) => right.timestamp - left.timestamp).slice(0, 5);
  return { updatedAt: Number.isFinite(updatedAt) ? updatedAt : (alerts[0]?.timestamp || Date.now()), scales, alerts };
}

function _globalHazardMergeEvents(...groups) {
  const events = new Map();
  groups.flat().filter(Boolean).forEach(event => {
    const existing = events.get(event.id);
    if (!existing || event.updatedAt > existing.updatedAt) events.set(event.id, event);
  });
  return [...events.values()].sort((left, right) => {
    const severity = _globalHazardSeverityIndex(right.severity) - _globalHazardSeverityIndex(left.severity);
    return severity || right.timestamp - left.timestamp;
  }).slice(0, GLOBAL_HAZARD_MAX_EVENTS);
}

function _globalHazardDateDaysAgo(days) {
  const date = new Date(Date.now() - Number(days) * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

function _globalHazardWindowStart(widget, now = Date.now()) {
  const date = new Date(Number(now));
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - (_globalHazardConfig(widget).days - 1));
  return date.getTime();
}

function _globalHazardEventInWindow(widget, event, now = Date.now()) {
  return Math.max(Number(event?.timestamp) || 0, Number(event?.updatedAt) || 0) >= _globalHazardWindowStart(widget, now);
}

function _globalHazardUrls(widget) {
  const config = _globalHazardConfig(widget);
  const urls = {
    eonet: `https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=${config.days}&limit=300`,
    usgs: `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=${_globalHazardDateDaysAgo(config.days - 1)}&minmagnitude=${config.earthquakeMagnitude}&orderby=time&limit=1000`,
    gdacs: 'https://www.gdacs.org/gdacsapi/api/events/geteventlist/events4app',
    fireball: `https://ssd-api.jpl.nasa.gov/fireball.api?date-min=${_globalHazardDateDaysAgo(config.days - 1)}&date-max=${_globalHazardDateDaysAgo(0)}&req-loc=true&limit=200`
  };
  if (config.spaceWeather) {
    urls.swpcAlerts = 'https://services.swpc.noaa.gov/products/alerts.json';
    urls.swpcScales = 'https://services.swpc.noaa.gov/products/noaa-scales.json';
  }
  return urls;
}

async function _globalHazardRequest(widget, source, url) {
  const headers = { Accept: 'application/json' }; let directError = null;
  try {
    const response = await _fetchWithTimeout(url, {
      method: 'GET', credentials: 'omit', redirect: 'follow', cache: 'no-store', headers, widgetType: 'globalHazards',
      widgetFetchKey: `global-hazards:${widget.id}:${source}`, maxResponseBytes: 4 * 1024 * 1024
    }, 25000);
    if (!response.ok) throw new Error(`${source} returned ${response.status}`);
    return await response.json();
  } catch (error) { directError = error; }
  try {
    const relayed = await WidgetSDK.extensionRelay.invoke('globalHazards', 'fetchCalendar', url, headers);
    if (relayed?.text) return JSON.parse(relayed.text);
    if (relayed?.error) throw new Error(relayed.error);
  } catch (relayError) { throw relayError || directError; }
  throw directError || new Error(`${source} request failed.`);
}

function _globalHazardReadCache(widget) {
  const cached = WidgetSDK.cache.get('globalHazards', widget.id, 'events');
  return cached?.signature === _globalHazardSignature(widget) && Array.isArray(cached.events) ? cached : null;
}

function _globalHazardCacheFresh(widget, cache, now = Date.now()) {
  return !!cache && now - Number(cache.fetchedAt || 0) < _globalHazardConfig(widget).refreshMinutes * 60 * 1000;
}

function _globalHazardDistanceKm(left, right) {
  const radians = degrees => Number(degrees) * Math.PI / 180; const earthRadius = 6371;
  const deltaLat = radians(right[1] - left[1]); const deltaLon = radians(right[0] - left[0]);
  const value = Math.sin(deltaLat / 2) ** 2 + Math.cos(radians(left[1])) * Math.cos(radians(right[1])) * Math.sin(deltaLon / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function _globalHazardWatchLocation(widget) {
  const config = _globalHazardConfig(widget);
  if (config.useWeatherLocation && typeof _findWeatherWidgetLocation === 'function') {
    const inherited = _findWeatherWidgetLocation(widget.id);
    if (inherited) return { coordinates: [Number(inherited.longitude), Number(inherited.latitude)], label: inherited.locationName || 'Weather location' };
  }
  const latitude = Number(config.latitude); const longitude = Number(config.longitude);
  return Number.isFinite(latitude) && Number.isFinite(longitude) && config.latitude !== '' && config.longitude !== ''
    ? { coordinates: [longitude, latitude], label: config.locationName || 'Watch location' } : null;
}

async function _globalHazardProcessNotifications(widget, events) {
  const seenRecord = WidgetSDK.cache.get('globalHazards', widget.id, 'seen') || null;
  const seen = new Set(Array.isArray(seenRecord?.ids) ? seenRecord.ids : []); const incomingIds = events.map(event => event.id);
  try { WidgetSDK.cache.set('globalHazards', widget.id, 'seen', { ids: [...new Set([...incomingIds, ...seen])].slice(0, 1200), updatedAt: Date.now() }); } catch {}
  if (!seenRecord || !_globalHazardConfig(widget).notifications) return;
  const location = _globalHazardWatchLocation(widget); if (!location) return;
  const config = _globalHazardConfig(widget); const minimum = _globalHazardSeverityIndex(config.notificationSeverity);
  const alerts = events.filter(event => !seen.has(event.id) && _globalHazardSeverityIndex(event.severity) >= minimum
    && _globalHazardDistanceKm(location.coordinates, event.coordinates) <= config.watchRadiusKm);
  if (!alerts.length) return;
  const first = alerts[0]; const title = alerts.length === 1 ? first.title : `${alerts.length} new hazard alerts`;
  const message = alerts.length === 1
    ? `${GLOBAL_HAZARD_TYPES[first.type].label} · ${first.severity} · within ${config.watchRadiusKm} km of ${location.label}`
    : `${alerts.slice(0, 3).map(event => event.title).join(' · ')}${alerts.length > 3 ? ` · +${alerts.length - 3} more` : ''}`;
  await WidgetSDK.notifications.publish({
    id: `global-hazards:${widget.id}:${Date.now()}`, title, message, createdAt: Date.now(),
    dedupeKey: `global-hazards:${widget.id}:${alerts.map(event => event.id).sort().join('|')}`,
    source: { widgetType: 'globalHazards', widgetId: widget.id, label: 'Global Hazards' }
  }, { system: true });
}

async function _globalHazardLoad(widget, force = false) {
  const config = _globalHazardConfig(widget); const runtime = _globalHazardRuntimeState(widget); const cached = _globalHazardReadCache(widget);
  if (!force && _globalHazardCacheFresh(widget, cached)) return cached;
  if (runtime.loading) return runtime.loading;
  runtime.status = 'loading'; runtime.error = '';
  runtime.loading = (async () => {
    const urls = _globalHazardUrls(widget); const names = Object.keys(urls);
    const settled = await Promise.allSettled(names.map(name => _globalHazardRequest(widget, name.toUpperCase(), urls[name])));
    const payloads = {}; const errors = [];
    settled.forEach((result, index) => result.status === 'fulfilled' ? payloads[names[index]] = result.value : errors.push(`${names[index].toUpperCase()}: ${result.reason?.message || 'unavailable'}`));
    if (!Object.keys(payloads).length) throw new Error(errors.join(' · ') || 'Hazard feeds are unavailable.');
    const events = _globalHazardMergeEvents(
      _globalHazardNormalizeEonet(payloads.eonet), _globalHazardNormalizeUsgs(payloads.usgs),
      _globalHazardNormalizeGdacs(payloads.gdacs), _globalHazardNormalizeFireballs(payloads.fireball)
    ).filter(event => _globalHazardEventInWindow(widget, event));
    const spaceWeather = config.spaceWeather ? _globalHazardNormalizeSpaceWeather(payloads.swpcScales, payloads.swpcAlerts, widget) : null;
    const next = { signature: _globalHazardSignature(widget), fetchedAt: Date.now(), events, spaceWeather, sources: names.filter(name => payloads[name]), warnings: errors };
    WidgetSDK.cache.set('globalHazards', widget.id, 'events', next, { ttlMs: GLOBAL_HAZARD_CACHE_TTL_MS });
    await _globalHazardProcessNotifications(widget, events);
    runtime.status = 'ready'; runtime.error = errors.join(' · ');
    return next;
  })().catch(error => {
    runtime.status = 'error'; runtime.error = error?.message || 'Hazard feeds could not be loaded.';
    if (cached) return cached;
    throw error;
  }).finally(() => {
    runtime.loading = null; _refreshWidget(widget.id, 'column');
  });
  return runtime.loading;
}

function _globalHazardFilteredEvents(widget, cache, runtime) {
  const minimum = _globalHazardSeverityIndex(_globalHazardConfig(widget).minimumSeverity);
  return (cache?.events || []).filter(event => runtime.activeTypes.has(event.type) && _globalHazardSeverityIndex(event.severity) >= minimum);
}

function _globalHazardFeatureCollection(events) {
  return {
    type: 'FeatureCollection', features: events.map(event => ({
      type: 'Feature', id: event.id, geometry: { type: 'Point', coordinates: event.coordinates },
      properties: { id: event.id, type: event.type, severity: event.severity, severityIndex: _globalHazardSeverityIndex(event.severity), title: event.title }
    }))
  };
}

function _globalHazardTrackCollection(events) {
  return {
    type: 'FeatureCollection', features: events.filter(event => event.track.length > 1).map(event => ({
      type: 'Feature', geometry: { type: 'LineString', coordinates: event.track }, properties: { id: event.id, type: event.type }
    }))
  };
}

function _globalHazardCaptureMapView(instance) {
  const map = instance?.map;
  if (!map?.getCenter || !map?.getZoom) return null;
  try {
    const center = map.getCenter();
    const camera = { longitude: Number(center.lng), latitude: Number(center.lat), zoom: Number(map.getZoom()) };
    if (!Number.isFinite(camera.longitude) || !Number.isFinite(camera.latitude) || !Number.isFinite(camera.zoom)) return null;
    instance.runtime.camera = camera; _globalHazardWriteView(instance.widget, { camera });
    return camera;
  } catch { return null; }
}

function _globalHazardCaptureAttribution(instance) {
  const container = instance?.map?.getContainer?.()?.querySelector?.('.maplibregl-ctrl-attrib.maplibregl-compact');
  if (!container) return null;
  const expanded = container.classList.contains('maplibregl-compact-show');
  instance.runtime.attributionExpanded = expanded; _globalHazardWriteView(instance.widget, { attributionExpanded: expanded });
  return expanded;
}

function _globalHazardRestoreAttribution(instance) {
  const container = instance?.map?.getContainer?.()?.querySelector?.('.maplibregl-ctrl-attrib.maplibregl-compact');
  if (!container) return;
  if (typeof instance.runtime.attributionExpanded !== 'boolean') instance.runtime.attributionExpanded = container.classList.contains('maplibregl-compact-show');
  container.classList.toggle('maplibregl-compact-show', instance.runtime.attributionExpanded);
  container.toggleAttribute?.('open', !instance.runtime.attributionExpanded);
  const button = container.querySelector?.('.maplibregl-ctrl-attrib-button');
  if (!button || instance.attributionButton === button) return;
  instance.attributionButton = button;
  button.addEventListener('click', () => {
    instance.runtime.attributionExpanded = container.classList.contains('maplibregl-compact-show');
    _globalHazardWriteView(instance.widget, { attributionExpanded: instance.runtime.attributionExpanded });
  });
}

function _globalHazardDestroyMap(widgetId, options = {}) {
  const instance = _globalHazardInstances.get(widgetId); if (!instance) return;
  if (options.preserveView !== false) { _globalHazardCaptureMapView(instance); _globalHazardCaptureAttribution(instance); }
  try { instance.resizeObserver?.disconnect?.(); } catch {}
  if (instance.widgetCard) instance.widgetCard.draggable = true;
  try { instance.map?.remove?.(); } catch {}
  _globalHazardInstances.delete(widgetId);
}

function _globalHazardRelativeTime(timestamp) {
  const delta = Date.now() - Number(timestamp); const absolute = Math.abs(delta);
  if (absolute < 60 * 60 * 1000) return `${Math.max(1, Math.round(absolute / 60000))}m ago`;
  if (absolute < 24 * 60 * 60 * 1000) return `${Math.round(absolute / 3600000)}h ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function _globalHazardDetailContent(event, container) {
  container.innerHTML = '';
  if (!event) { container.className = 'global-hazards-detail is-empty'; container.textContent = 'Select a marker or event to inspect it.'; return; }
  container.className = 'global-hazards-detail';
  const heading = document.createElement('div'); heading.className = 'global-hazards-detail-heading';
  const type = document.createElement('span'); type.className = `global-hazards-type type-${event.type}`; type.textContent = `${GLOBAL_HAZARD_TYPES[event.type].symbol} ${GLOBAL_HAZARD_TYPES[event.type].label}`;
  const severity = document.createElement('span'); severity.className = `global-hazards-severity severity-${event.severity}`; severity.textContent = event.severity;
  heading.append(type, severity);
  const title = document.createElement('strong'); title.textContent = event.title;
  const meta = document.createElement('span'); meta.className = 'global-hazards-detail-meta'; meta.textContent = [event.source, new Date(event.timestamp).toLocaleString(), event.magnitude].filter(Boolean).join(' · ');
  container.append(heading, title, meta);
  if (event.description && event.description.toLowerCase() !== event.title.toLowerCase()) { const description = document.createElement('p'); description.textContent = event.description; container.appendChild(description); }
  if (event.tsunamiPotential) { const tsunami = document.createElement('span'); tsunami.className = 'global-hazards-tsunami-note'; tsunami.textContent = 'USGS tsunami flag reported — follow official local guidance.'; container.appendChild(tsunami); }
  if (event.url) { const link = document.createElement('a'); link.href = event.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'Open official report ↗'; container.appendChild(link); }
}

function _globalHazardSpaceWeatherPanel(cache) {
  const panel = document.createElement('section'); panel.className = 'global-hazards-space-weather'; panel.setAttribute('aria-label', 'Space weather status');
  const header = document.createElement('div'); header.className = 'global-hazards-space-header';
  const identity = document.createElement('span'); identity.innerHTML = '<small>Global conditions</small><strong>Space weather</strong>';
  const updated = document.createElement('small'); updated.className = 'global-hazards-space-updated';
  const data = cache?.spaceWeather;
  updated.textContent = data ? _globalHazardRelativeTime(data.updatedAt) : (cache ? 'Feed unavailable' : 'Loading…');
  header.append(identity, updated); panel.appendChild(header);
  if (!data) {
    const empty = document.createElement('div'); empty.className = 'global-hazards-space-empty'; empty.textContent = cache ? 'NOAA space-weather status could not be retrieved.' : 'Loading NOAA space-weather status…';
    panel.appendChild(empty); return panel;
  }
  if (data.scales.length) {
    const scales = document.createElement('div'); scales.className = 'global-hazards-space-scales';
    data.scales.forEach(item => {
      const card = document.createElement('div'); card.className = `global-hazards-space-scale severity-${item.severity}`; card.title = `${item.label}: ${item.code}${item.scale}${item.text ? ` (${item.text})` : ''}`;
      const value = document.createElement('strong'); value.textContent = `${item.code}${item.scale}`;
      const label = document.createElement('span'); label.textContent = item.label;
      card.append(value, label); scales.appendChild(card);
    });
    panel.appendChild(scales);
  }
  const alerts = document.createElement('div'); alerts.className = 'global-hazards-space-alerts';
  if (data.alerts.length) {
    data.alerts.slice(0, 3).forEach(item => {
      const row = document.createElement('a'); row.href = item.url; row.target = '_blank'; row.rel = 'noopener noreferrer'; row.className = `global-hazards-space-alert severity-${item.severity}`;
      const badge = document.createElement('span'); badge.textContent = `${item.code}${item.level}`;
      const copy = document.createElement('span'); const title = document.createElement('strong'); title.textContent = item.title;
      const meta = document.createElement('small'); meta.textContent = _globalHazardRelativeTime(item.timestamp); copy.append(title, meta); row.append(badge, copy); alerts.appendChild(row);
    });
  } else {
    const quiet = document.createElement('span'); quiet.className = 'global-hazards-space-quiet'; quiet.textContent = 'No scaled NOAA alerts in the selected event window.'; alerts.appendChild(quiet);
  }
  panel.appendChild(alerts); return panel;
}

function _globalHazardRender(widget, element, context) {
  _globalHazardDestroyMap(widget.id); const config = _globalHazardConfig(widget); const runtime = _globalHazardRuntimeState(widget); const cache = _globalHazardReadCache(widget);
  if (!cache && !runtime.loading) void _globalHazardLoad(widget).catch(() => {});
  else if (cache && !_globalHazardCacheFresh(widget, cache) && !runtime.loading) void _globalHazardLoad(widget).catch(() => {});
  WidgetSDK.runtime.schedule(`${widget.id}:global-hazards-refresh`, () => {
    const current = _globalHazardReadCache(widget);
    if (!_globalHazardCacheFresh(widget, current)) void _globalHazardLoad(widget).catch(() => {});
  }, 60 * 1000, { runWhenHidden: true, maxBackoffMs: 5 * 60 * 1000 });
  _setWidgetRefresher(widget.id, context, () => { if (element.isConnected) _globalHazardRender(widget, element, context); });
  element.className = 'global-hazards-widget'; element.innerHTML = '';

  const header = document.createElement('div'); header.className = 'global-hazards-header';
  const identity = document.createElement('div'); identity.className = 'global-hazards-identity';
  const eyebrow = document.createElement('span'); eyebrow.textContent = 'Near real time'; const title = document.createElement('strong'); title.textContent = 'Global Hazards'; identity.append(eyebrow, title);
  const summary = document.createElement('span'); summary.className = 'global-hazards-summary';
  summary.textContent = cache ? `${cache.events.length} events · ${_globalHazardRelativeTime(cache.fetchedAt)}` : (runtime.status === 'error' ? 'Feeds unavailable' : 'Loading feeds…');
  header.append(identity, summary); element.appendChild(header);

  const filters = document.createElement('div'); filters.className = 'global-hazards-filters';
  GLOBAL_HAZARD_TYPE_ORDER.forEach(type => {
    const count = (cache?.events || []).filter(event => event.type === type).length; const button = document.createElement('button'); button.type = 'button';
    button.className = `global-hazards-filter type-${type}`; button.classList.toggle('active', runtime.activeTypes.has(type)); button.disabled = count === 0;
    button.textContent = `${GLOBAL_HAZARD_TYPES[type].short} ${count}`; button.setAttribute('aria-pressed', String(runtime.activeTypes.has(type)));
    button.addEventListener('click', () => { runtime.activeTypes.has(type) ? runtime.activeTypes.delete(type) : runtime.activeTypes.add(type); _globalHazardPersistRuntime(widget, runtime); _globalHazardRender(widget, element, context); });
    filters.appendChild(button);
  });
  element.appendChild(filters);
  if (config.spaceWeather) element.appendChild(_globalHazardSpaceWeatherPanel(cache));

  const layout = document.createElement('div'); layout.className = 'global-hazards-layout';
  const mapShell = document.createElement('div'); mapShell.className = 'global-hazards-map-shell widget-interactive-surface';
  const mapContainer = document.createElement('div'); mapContainer.className = 'global-hazards-map';
  const status = document.createElement('div'); status.className = 'global-hazards-status';
  if (!cache) status.textContent = runtime.status === 'error' ? runtime.error : 'Loading global hazard feeds…';
  else if (runtime.status === 'loading') status.textContent = 'Refreshing hazard feeds…';
  else if (runtime.error) status.textContent = `Partial coverage: ${runtime.error}`;
  else status.classList.add('hidden');
  if (runtime.status === 'error' || runtime.error) status.classList.add('is-error');
  const watch = _globalHazardWatchLocation(widget);
  const focusLocation = document.createElement('button'); focusLocation.type = 'button'; focusLocation.className = 'global-hazards-focus-location widget-interactive-surface';
  focusLocation.setAttribute('aria-label', 'Focus map on settings location'); focusLocation.title = watch ? `Focus on ${watch.label}` : 'Choose a watch location in widget settings'; focusLocation.disabled = !watch;
  focusLocation.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="5"></circle><path d="M12 2v3M12 19v3M2 12h3M19 12h3"></path></svg>';
  focusLocation.addEventListener('click', event => {
    event.stopPropagation();
    const map = _globalHazardInstances.get(widget.id)?.map;
    if (map && watch) map.easeTo({ center: watch.coordinates, zoom: Math.max(Number(map.getZoom()) || 0, 5), duration: 650 });
  });
  mapShell.append(mapContainer, status, focusLocation);
  const side = document.createElement('div'); side.className = 'global-hazards-side';
  const detail = document.createElement('div'); const events = _globalHazardFilteredEvents(widget, cache, runtime);
  let selected = events.find(event => event.id === runtime.selectedId) || null; _globalHazardDetailContent(selected, detail);
  const list = document.createElement('div'); list.className = 'global-hazards-list'; list.setAttribute('aria-label', 'Hazard events');
  const showEvent = event => {
    runtime.selectedId = event.id; selected = event; _globalHazardWriteView(widget, { selectedId: event.id }); _globalHazardDetailContent(event, detail);
    list.querySelectorAll('.global-hazards-event').forEach(node => node.classList.toggle('active', node.dataset.eventId === event.id));
    const map = _globalHazardInstances.get(widget.id)?.map; if (map) map.easeTo({ center: event.coordinates, zoom: Math.max(map.getZoom(), 4), duration: 650 });
  };
  events.slice(0, 100).forEach(event => {
    const row = document.createElement('button'); row.type = 'button'; row.className = 'global-hazards-event'; row.dataset.eventId = event.id; row.classList.toggle('active', event.id === runtime.selectedId);
    const marker = document.createElement('span'); marker.className = `global-hazards-event-symbol type-${event.type}`; marker.textContent = GLOBAL_HAZARD_TYPES[event.type].symbol;
    const copy = document.createElement('span'); const name = document.createElement('strong'); name.textContent = event.title; const meta = document.createElement('small'); meta.textContent = `${GLOBAL_HAZARD_TYPES[event.type].short} · ${event.severity} · ${_globalHazardRelativeTime(event.timestamp)}`; copy.append(name, meta);
    row.append(marker, copy); row.addEventListener('click', () => showEvent(event)); list.appendChild(row);
  });
  if (!events.length) { const empty = document.createElement('div'); empty.className = 'global-hazards-empty'; empty.textContent = cache ? 'No events match the active filters.' : 'Waiting for hazard data…'; list.appendChild(empty); }
  side.append(detail, list); layout.append(mapShell, side); element.appendChild(layout);
  list.scrollTop = runtime.listScrollTop;
  list.addEventListener('scroll', () => {
    runtime.listScrollTop = list.scrollTop;
    WidgetSDK.runtime.requestFrame(`${widget.id}:global-hazards-list-view`, () => _globalHazardWriteView(widget, { listScrollTop: runtime.listScrollTop }));
  }, { passive: true });

  const attribution = document.createElement('div'); attribution.className = 'global-hazards-attribution'; attribution.append('Data: ');
  const sourceLabels = ['EONET', 'USGS', 'GDACS', 'JPL', ...(config.spaceWeather ? ['NOAA'] : [])];
  sourceLabels.forEach((source, index) => { if (index) attribution.append(' · '); const link = document.createElement('a'); link.href = GLOBAL_HAZARD_SOURCE_URLS[source]; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = source; attribution.appendChild(link); });
  element.appendChild(attribution);
  if (typeof maplibregl === 'undefined') { status.classList.remove('hidden'); status.classList.add('is-error'); status.textContent = 'MapLibre failed to load.'; return; }

  const widgetCard = element.closest('.widget-card'); const disableDrag = () => { if (widgetCard) widgetCard.draggable = false; }; const restoreDrag = () => { if (widgetCard) widgetCard.draggable = true; };
  mapShell.addEventListener('mouseenter', disableDrag); mapShell.addEventListener('mouseleave', restoreDrag); mapShell.addEventListener('touchstart', disableDrag, { passive: true }); mapShell.addEventListener('touchend', restoreDrag, { passive: true });
  let map;
  try {
    const camera = runtime.camera;
    map = new maplibregl.Map({
      container: mapContainer, style: _globalHazardMapStyleUrl(config.mapStyle),
      center: camera ? [camera.longitude, camera.latitude] : [0, 18], zoom: camera?.zoom ?? 1.25, minZoom: 1, maxZoom: 12,
      renderWorldCopies: false, dragRotate: false, pitchWithRotate: false,
      attributionControl: { compact: true, customAttribution: '<a href="https://openfreemap.org/" target="_blank" rel="noreferrer">OpenFreeMap</a> · <a href="https://openmaptiles.org/" target="_blank" rel="noreferrer">© OpenMapTiles</a> · Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>' }
    });
    map.touchZoomRotate.disableRotation(); map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  } catch (error) { status.classList.remove('hidden'); status.classList.add('is-error'); status.textContent = error?.message || 'Unable to initialise the hazard map.'; return; }
  const instance = { widgetId: widget.id, widget, runtime, map, resizeObserver: null, widgetCard, attributionButton: null }; _globalHazardInstances.set(widget.id, instance);
  if (typeof ResizeObserver === 'function') { instance.resizeObserver = new ResizeObserver(() => map.resize()); instance.resizeObserver.observe(mapShell); }
  map.on('moveend', () => { if (_globalHazardInstances.get(widget.id) === instance) _globalHazardCaptureMapView(instance); });
  map.on('load', () => {
    if (_globalHazardInstances.get(widget.id) !== instance) return;
    _globalHazardRestoreAttribution(instance);
    const sourceId = `global-hazards-${widget.id}`; const trackId = `global-hazard-tracks-${widget.id}`;
    map.addSource(trackId, { type: 'geojson', data: _globalHazardTrackCollection(events) });
    map.addLayer({ id: `${trackId}-line`, type: 'line', source: trackId, paint: { 'line-color': '#7a9cff', 'line-width': 2, 'line-opacity': 0.55, 'line-dasharray': [2, 2] } });
    map.addSource(sourceId, { type: 'geojson', data: _globalHazardFeatureCollection(events), cluster: true, clusterRadius: 42, clusterMaxZoom: 5 });
    map.addLayer({ id: `${sourceId}-clusters`, type: 'circle', source: sourceId, filter: ['has', 'point_count'], paint: { 'circle-color': '#8e5f68', 'circle-radius': ['step', ['get', 'point_count'], 14, 10, 18, 50, 23], 'circle-stroke-color': '#f7dce1', 'circle-stroke-width': 1.5 } });
    map.addLayer({ id: `${sourceId}-count`, type: 'symbol', source: sourceId, filter: ['has', 'point_count'], layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 11 }, paint: { 'text-color': '#fff' } });
    const colorExpression = ['match', ['get', 'type'], ...GLOBAL_HAZARD_TYPE_ORDER.flatMap(type => [type, GLOBAL_HAZARD_TYPES[type].color]), '#b0a4a7'];
    map.addLayer({ id: `${sourceId}-points`, type: 'circle', source: sourceId, filter: ['!', ['has', 'point_count']], paint: {
      'circle-color': colorExpression, 'circle-radius': ['interpolate', ['linear'], ['get', 'severityIndex'], 0, 5, 3, 10], 'circle-opacity': 0.9,
      'circle-stroke-color': ['match', ['get', 'severity'], 'critical', '#fff', 'high', '#ffe1c0', '#2c171c'], 'circle-stroke-width': ['match', ['get', 'severity'], 'critical', 3, 'high', 2, 1]
    } });
    map.on('click', `${sourceId}-clusters`, async event => {
      const feature = map.queryRenderedFeatures(event.point, { layers: [`${sourceId}-clusters`] })[0]; const clusterId = feature?.properties?.cluster_id;
      if (clusterId == null) return;
      try { const zoom = await map.getSource(sourceId).getClusterExpansionZoom(clusterId); map.easeTo({ center: feature.geometry.coordinates, zoom }); } catch {}
    });
    map.on('click', `${sourceId}-points`, event => { const id = event.features?.[0]?.properties?.id; const hazard = events.find(item => item.id === id); if (hazard) showEvent(hazard); });
    [`${sourceId}-clusters`, `${sourceId}-points`].forEach(layer => { map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer'; }); map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; }); });
    if (watch) { const marker = document.createElement('div'); marker.className = 'global-hazards-watch-marker'; marker.title = `${watch.label} · ${config.watchRadiusKm} km alert radius`; new maplibregl.Marker({ element: marker }).setLngLat(watch.coordinates).addTo(map); }
    if (runtime.status !== 'loading' && !runtime.error) status.classList.add('hidden'); map.resize();
  });
}

async function _globalHazardBeforeSettingsCommit(widget) {
  if (!_globalHazardConfig(widget).notifications) return true;
  const granted = await WidgetSDK.notifications.requestPermission();
  if (!granted) { widget.config.notifications = false; if (typeof showNotice === 'function') showNotice('Notification permission was not granted. Hazard notifications remain off.'); }
  return true;
}

function _globalHazardEscape(value) {
  return String(value || '').replace(/[&<>"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character]);
}

function _globalHazardRenderSettings(widget, container) {
  const config = _globalHazardConfig(widget);
  container.innerHTML = `<div class="settings-row"><span>Event window</span><select class="settings-select" data-cfg="days"><option value="1" ${config.days === 1 ? 'selected' : ''}>Today only</option><option value="7" ${config.days === 7 ? 'selected' : ''}>7 days</option><option value="14" ${config.days === 14 ? 'selected' : ''}>14 days</option><option value="30" ${config.days === 30 ? 'selected' : ''}>30 days</option><option value="60" ${config.days === 60 ? 'selected' : ''}>60 days</option></select></div>
    <div class="settings-row"><span>Earthquake threshold</span><select class="settings-select" data-cfg="earthquakeMagnitude">${[2.5, 4, 4.5, 5, 5.5].map(value => `<option value="${value}" ${config.earthquakeMagnitude === value ? 'selected' : ''}>Magnitude ${value}+</option>`).join('')}</select></div>
    <div class="settings-row"><span>Refresh</span><select class="settings-select" data-cfg="refreshMinutes">${[15, 30, 60].map(value => `<option value="${value}" ${config.refreshMinutes === value ? 'selected' : ''}>${value} minutes</option>`).join('')}</select></div>
    <div class="settings-row"><span>Basemap</span><div class="board-fit-radios weather-option-radios"><label class="board-fit-label"><input type="radio" name="globalHazardsMapStyle" data-cfg="mapStyle" value="dark" ${_globalHazardMapStyle(config.mapStyle) === 'dark' ? 'checked' : ''}/><span>Dark</span></label><label class="board-fit-label"><input type="radio" name="globalHazardsMapStyle" data-cfg="mapStyle" value="liberty" ${_globalHazardMapStyle(config.mapStyle) === 'liberty' ? 'checked' : ''}/><span>Liberty</span></label></div></div>
    <div class="settings-row"><span>Minimum severity</span><select class="settings-select" data-cfg="minimumSeverity">${GLOBAL_HAZARD_SEVERITIES.map(value => `<option value="${value}" ${config.minimumSeverity === value ? 'selected' : ''}>${value[0].toUpperCase() + value.slice(1)}</option>`).join('')}</select></div>
    <div class="settings-row settings-row--top"><span>Hazard types</span><div class="global-hazards-settings-types">${GLOBAL_HAZARD_TYPE_ORDER.map(type => `<label><input type="checkbox" data-hazard-type="${type}" ${config.categories.includes(type) ? 'checked' : ''}/> ${GLOBAL_HAZARD_TYPES[type].label}</label>`).join('')}</div></div>
    <div class="settings-row"><span>Space-weather status</span><label class="settings-toggle"><input type="checkbox" data-cfg="spaceWeather" ${config.spaceWeather ? 'checked' : ''}/><span class="toggle-track"></span></label></div>
    <div class="settings-row"><span>Use Weather location</span><label class="settings-toggle"><input type="checkbox" data-cfg="useWeatherLocation" ${config.useWeatherLocation ? 'checked' : ''}/><span class="toggle-track"></span></label></div>
    <div class="settings-row settings-row--top"><span>Custom watch location</span><div class="weather-location-settings"><div class="weather-location-search-row"><input class="settings-text-input global-hazards-location-search" type="text" value="${_globalHazardEscape(config.locationName)}" placeholder="Search location"/><button type="button" class="settings-inline-btn global-hazards-location-search-btn">Search</button></div><div class="weather-location-results global-hazards-location-results"></div><div class="weather-coordinate-grid"><label>Latitude<input class="settings-number-input" type="number" min="-90" max="90" step="0.0001" data-cfg="latitude" value="${config.latitude}"/></label><label>Longitude<input class="settings-number-input" type="number" min="-180" max="180" step="0.0001" data-cfg="longitude" value="${config.longitude}"/></label></div></div></div>
    <div class="settings-row"><span>Alert radius</span><input class="settings-number-input" type="number" min="25" max="5000" step="25" data-cfg="watchRadiusKm" value="${config.watchRadiusKm}"/><span class="settings-unit">km</span></div>
    <div class="settings-row"><span>Notification severity</span><select class="settings-select" data-cfg="notificationSeverity">${['moderate', 'high', 'critical'].map(value => `<option value="${value}" ${config.notificationSeverity === value ? 'selected' : ''}>${value[0].toUpperCase() + value.slice(1)}+</option>`).join('')}</select></div>
    <div class="settings-row"><span>Regional notifications</span><label class="settings-toggle"><input type="checkbox" data-cfg="notifications" ${config.notifications ? 'checked' : ''}/><span class="toggle-track"></span></label></div>
    <div class="settings-help">Notifications are checked on the widget's refresh schedule while the Hub is running. They use the first configured Weather location when enabled, otherwise the custom coordinates above.</div>`;
  const typeInputs = [...container.querySelectorAll('[data-hazard-type]')];
  typeInputs.forEach(input => input.addEventListener('change', () => { widget.config.categories = typeInputs.filter(item => item.checked).map(item => item.dataset.hazardType); }));
  const searchInput = container.querySelector('.global-hazards-location-search'); const searchButton = container.querySelector('.global-hazards-location-search-btn'); const results = container.querySelector('.global-hazards-location-results');
  const latitude = container.querySelector('[data-cfg="latitude"]'); const longitude = container.querySelector('[data-cfg="longitude"]');
  if (typeof _bindOpenMeteoLocationSearch === 'function') _bindOpenMeteoLocationSearch({
    input: searchInput, button: searchButton, results, widgetType: 'globalHazards',
    onSelect(location, label) { searchInput.value = label; widget.config.locationName = label; latitude.value = String(location.latitude); longitude.value = String(location.longitude); latitude.dispatchEvent(new Event('change', { bubbles: true })); longitude.dispatchEvent(new Event('change', { bubbles: true })); }
  });
}

WIDGET_REGISTRY['globalHazards'] = {
  id: 'globalHazards', name: 'Global Hazards', category: 'Weather & Hazards',
  description: 'Near-real-time terrestrial hazards and airbursts on a global map, with a compact NOAA space-weather status.',
  allowedIn: ['column'], liveSettingsPreview: false,
  defaultConfig: {
    days: 30, earthquakeMagnitude: 4.5, refreshMinutes: 15, mapStyle: 'dark', categories: [...GLOBAL_HAZARD_TYPE_ORDER], minimumSeverity: 'info',
    useWeatherLocation: true, locationName: '', latitude: '', longitude: '', watchRadiusKm: 500, notificationSeverity: 'high', notifications: false, spaceWeather: true, categorySchema: 1
  },
  defaultData: {},
  settingsSchema: { type: 'object', properties: {
    days: { type: 'number' }, earthquakeMagnitude: { type: 'number' }, refreshMinutes: { type: 'number' }, mapStyle: { type: 'string', enum: ['dark', 'liberty'] },
    categories: { type: 'array' }, minimumSeverity: { type: 'string', enum: GLOBAL_HAZARD_SEVERITIES }, useWeatherLocation: { type: 'boolean' },
    locationName: { type: 'string' }, latitude: { type: 'any' }, longitude: { type: 'any' }, watchRadiusKm: { type: 'number' }, notificationSeverity: { type: 'string', enum: ['moderate', 'high', 'critical'] }, notifications: { type: 'boolean' }, spaceWeather: { type: 'boolean' }, categorySchema: { type: 'number' }
  }, additionalProperties: false },
  capabilities: {
    network: { domains: ['eonet.gsfc.nasa.gov', 'earthquake.usgs.gov', 'www.gdacs.org', 'ssd-api.jpl.nasa.gov', 'services.swpc.noaa.gov', 'geocoding-api.open-meteo.com', 'tiles.openfreemap.org'] },
    extensionRelay: { optional: true }, timers: true, localCache: { quotaBytes: 4 * 1024 * 1024 }, notifications: { optional: true }
  },
  responsive: { minWidth: 300, preferredWidth: 760, preferredHeight: 520, compactBelow: 480 },
  migrate(widget) {
    const previous = widget.config || {};
    widget.config = { ...this.defaultConfig, ...previous, categorySchema: Number(previous.categorySchema) || 1 };
    widget.data = {}; _globalHazardConfig(widget); return widget;
  },
  beforeSettingsCommit(widget) { return _globalHazardBeforeSettingsCommit(widget); },
  onSettingsCommit(widget) { const runtime = _globalHazardRuntimeState(widget); runtime.activeTypes = new Set(_globalHazardConfig(widget).categories); runtime.selectedId = ''; _globalHazardPersistRuntime(widget, runtime); },
  reload(widget) { return _globalHazardLoad(widget, true); },
  clearContextRuntime(widgetId) { _globalHazardDestroyMap(widgetId); },
  resizeRuntime(widgetId) { _globalHazardInstances.get(widgetId)?.map?.resize?.(); },
  dispose(widget) { _globalHazardDestroyMap(widget.id, { preserveView: false }); _globalHazardRuntime.delete(widget.id); _globalHazardViewMemory.delete(widget.id); WidgetSDK.cache.remove('globalHazards', widget.id, 'events'); WidgetSDK.cache.remove('globalHazards', widget.id, 'seen'); WidgetSDK.cache.remove('globalHazards', widget.id, 'view'); },
  cleanup(widget) { _globalHazardDestroyMap(widget.id); _globalHazardRuntime.delete(widget.id); _globalHazardViewMemory.delete(widget.id); },
  render(widget, element, context) { _globalHazardRender(widget, element, context); },
  renderSettings(widget, container) { _globalHazardRenderSettings(widget, container); }
};
