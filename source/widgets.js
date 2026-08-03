// --- Widget registry and framework ---

const WIDGET_REGISTRY = {};

// Timer storage: key = "widgetId:context"
const _widgetTimers = new Map();
const _widgetRefreshers = new Map();
const _widgetFetches = new Map();
const _weatherMemoryCache = new Map();
const _weatherRuntime = new Map();
const _weatherMapMemoryCache = new Map();
const _weatherMapRuntime = new Map();
const _weatherMapInstances = new Map();
const _weatherMapViewMemory = new Map();
const _astronomyRuntime = new Map();
const _issTrackerInstances = new Map();
const _issTrackerRuntime = new Map();
let _issTleMemoryCache = null;
const _rssMemoryCache = new Map();
const _rssViewMemory = new Map();
const _rssRuntime = new Map();
const _ipInfoMemoryCache = new Map();
const _ipInfoSpeedMemoryCache = new Map();
const _ipInfoRuntime = new Map();

const WEATHER_CACHE_PREFIX = 'morpheus-webhub-weather:';
const WEATHER_CACHE_SCHEMA_VERSION = 'hourly-v1';
const WEATHER_CACHE_TTL_MS = 30 * 60 * 1000;
const WEATHER_RETRY_DELAY_MS = 5 * 60 * 1000;
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
const ISS_TLE_CACHE_KEY = 'morpheus-webhub-iss-tle:v1';
const ISS_VIEW_PREFIX = 'morpheus-webhub-iss-view:';
const ISS_TLE_TTL_MS = 6 * 60 * 60 * 1000;
const ISS_TLE_RETRY_MS = 10 * 60 * 1000;
const ISS_PATH_BEHIND_MINUTES = 45;
const ISS_PATH_AHEAD_MINUTES = 100;
const RSS_CACHE_PREFIX = 'morpheus-webhub-rss-cache:';
const RSS_VIEW_PREFIX = 'morpheus-webhub-rss-view:';
const RSS_CACHE_SCHEMA = 1;
const RSS_MAX_FEEDS = 12;
const RSS_MAX_RESPONSE_CHARS = 2 * 1024 * 1024;
const RSS_RETRY_MS = 5 * 60 * 1000;
const IP_INFO_CACHE_PREFIX = 'morpheus-webhub-ip-info:';
const IP_INFO_SPEED_CACHE_PREFIX = 'morpheus-webhub-ip-speed:';
const IP_INFO_REQUEST_TIMEOUT_MS = 12000;
const IP_INFO_RETRY_MS = 5 * 60 * 1000;
const IP_INFO_SPEED_TIMEOUT_MS = 60 * 1000;
const IP_INFO_SPEED_MEASUREMENTS = [
  { type: 'latency', numPackets: 8 },
  { type: 'download', bytes: 1e6, count: 2, bypassMinDuration: true },
  { type: 'download', bytes: 5e6, count: 2, bypassMinDuration: true },
  { type: 'download', bytes: 1e7, count: 1, bypassMinDuration: true },
  { type: 'upload', bytes: 1e6, count: 2, bypassMinDuration: true },
  { type: 'upload', bytes: 4e6, count: 2, bypassMinDuration: true }
];

function _setWidgetTimer(widgetId, context, fn, ms) {
  const key = `${widgetId}:${context}`;
  const existing = _widgetTimers.get(key);
  if (existing) clearInterval(existing);
  _widgetTimers.set(key, setInterval(fn, ms));
}

function _setWidgetRefresher(widgetId, context, fn) {
  _widgetRefreshers.set(`${widgetId}:${context}`, fn);
}

function _refreshWidget(widgetId, context) {
  const refresh = _widgetRefreshers.get(`${widgetId}:${context}`);
  if (typeof refresh === 'function') refresh();
}

function clearColumnWidgetTimers() {
  _widgetTimers.forEach((timer, key) => {
    if (key.endsWith(':column')) { clearInterval(timer); _widgetTimers.delete(key); }
  });
  _destroyAllWeatherMaps();
  _destroyAllIssTrackers();
}

function clearNavWidgetTimers() {
  _widgetTimers.forEach((timer, key) => {
    if (key.endsWith(':navpane')) { clearInterval(timer); _widgetTimers.delete(key); }
  });
}

function _newWidgetState(widgetType) {
  const def = WIDGET_REGISTRY[widgetType];
  if (!def) return null;
  return {
    id: `widget-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type: 'widget',
    widgetType,
    title: '',
    config: cloneData(def.defaultConfig),
    data: cloneData(def.defaultData)
  };
}

function _appendWidgetActionButtons(host, widget, body, context, options = {}) {
  const def = WIDGET_REGISTRY[widget.widgetType];
  if (!def) return;
  const rerenderBody = () => {
    if (!body.isConnected) return;
    body.innerHTML = '';
    def.render(widget, body, context);
  };
  const refreshAfterSettings = options.onSettingsRefresh || rerenderBody;

  const settingsBtn = document.createElement('button');
  settingsBtn.type = 'button';
  settingsBtn.className = 'widget-action-btn';
  settingsBtn.title = 'Widget settings';
  settingsBtn.setAttribute('aria-label', `Edit ${widget.title || def.name} widget`);
  settingsBtn.appendChild(icon('icon-settings'));
  settingsBtn.addEventListener('click', event => {
    event.stopPropagation();
    openWidgetSettings(widget, refreshAfterSettings, {
      widgetContext: context,
      sidebarBottomAvailable: options.sidebarBottomAvailable
    });
  });
  host.appendChild(settingsBtn);

  if (typeof def.reload !== 'function') return;
  const reloadBtn = document.createElement('button');
  reloadBtn.type = 'button';
  reloadBtn.className = 'widget-action-btn widget-action-btn--reload';
  const reloadLabel = def.reloadLabel || `Reload ${widget.title || def.name} data`;
  reloadBtn.title = reloadLabel;
  reloadBtn.setAttribute('aria-label', reloadLabel);
  reloadBtn.appendChild(icon('icon-reload'));
  reloadBtn.addEventListener('click', async event => {
    event.stopPropagation();
    if (reloadBtn.disabled) return;
    reloadBtn.disabled = true;
    reloadBtn.classList.add('is-loading');
    try {
      const request = def.reload(widget);
      rerenderBody();
      await request;
    } finally {
      reloadBtn.disabled = false;
      reloadBtn.classList.remove('is-loading');
    }
  });
  host.appendChild(reloadBtn);
}

// --- Column widget element ---

function createWidgetElement(widget, columnId) {
  const def = WIDGET_REGISTRY[widget.widgetType];
  if (!def) return null;

  const el = document.createElement('div');
  el.className = 'board-column-item widget-card';
  el.dataset.itemId = widget.id;
  el.dataset.columnId = columnId;
  el.dataset.itemType = 'widget';
  el.draggable = true;

  const body = document.createElement('div');
  body.className = 'widget-body';
  _appendWidgetActionButtons(el, widget, body, 'column');
  el.appendChild(body);
  def.render(widget, body, 'column');

  el.addEventListener('contextmenu', e => {
    e.preventDefault();
    e.stopPropagation();
    contextTarget = { area: 'board-item', itemId: widget.id, columnId, parentId: null, item: widget, depth: 1 };
    showContextMenu(e.clientX, e.clientY, [
      { label: 'Widget settings', action: 'editWidget' },
      { label: 'Delete widget',   action: 'deleteItem' }
    ]);
  });

  el.addEventListener('dragstart', e => {
    if (e.target.closest('input, textarea, button, label, select, .widget-interactive-surface')) { e.preventDefault(); return; }
    e.stopPropagation();
    dragPayload = { area: 'board', itemId: widget.id, itemType: 'widget', widgetType: widget.widgetType, sourceColumnId: columnId, sourceParentId: null };
    e.dataTransfer.setData('text/plain', widget.id);
    e.dataTransfer.effectAllowed = 'move';
    applyDragImage(e, el);
  });
  el.addEventListener('dragend', () => { el.classList.remove('dragging'); dragPayload = null; removeDragPlaceholders(); });
  el.addEventListener('dragover', e => handleBoardItemDragOver(e, widget, columnId, null, 1));
  el.addEventListener('dragleave', e => {
    if (el.contains(e.relatedTarget)) return;
    el.classList.remove('drop-target', 'drop-position-before', 'drop-position-after');
    el.removeAttribute('data-drop-position');
  });
  el.addEventListener('drop', e => handleBoardItemDrop(e, widget, columnId, null, 1));

  return el;
}

// --- Widget settings panel ---

let _wstgAbort = null;

function openWidgetSettings(widget, onRefresh, options = {}) {
  if (_wstgAbort) _wstgAbort.abort();
  _wstgAbort = new AbortController();
  const sig = _wstgAbort.signal;

  const def = WIDGET_REGISTRY[widget.widgetType];
  if (!def) return;

  const savedConfig = cloneData(widget.config);
  const savedTitle  = widget.title;

  const panel      = document.getElementById('widgetSettingsPanel');
  const titleInput = document.getElementById('wstgTitle');
  const body       = document.getElementById('wstgBody');
  const subtitle   = document.getElementById('wstgSubtitle');

  panel.classList.toggle('widget-settings-panel--wide', def.settingsPanelWidth === 'wide');
  if (subtitle) subtitle.textContent = (options.isNew ? 'New ' : 'Edit ') + def.name;
  titleInput.value = widget.title || '';
  body.innerHTML   = '';
  def.renderSettings(widget, body);
  if (options.widgetContext === 'navpane' && options.sidebarBottomAvailable !== false) {
    const placementRow = document.createElement('div');
    placementRow.className = 'settings-row widget-sidebar-placement-row';
    const placementLabel = document.createElement('span');
    placementLabel.textContent = 'Align at sidebar bottom';
    const placementToggle = document.createElement('label');
    placementToggle.className = 'settings-toggle';
    const placementInput = document.createElement('input');
    placementInput.type = 'checkbox';
    placementInput.dataset.cfg = 'sidebarBottom';
    placementInput.checked = widget.config?.sidebarBottom === true;
    const placementTrack = document.createElement('span');
    placementTrack.className = 'toggle-track';
    placementToggle.append(placementInput, placementTrack);
    placementRow.append(placementLabel, placementToggle);
    body.appendChild(placementRow);
  }
  if (!body.querySelector('.settings-section')) {
    const section = document.createElement('div');
    section.className = 'settings-section widget-settings-section';
    const label = document.createElement('div');
    label.className = 'settings-section-label';
    label.textContent = 'Settings';
    section.appendChild(label);
    while (body.firstChild) section.appendChild(body.firstChild);
    body.appendChild(section);
  }

  document.getElementById('modalCard').classList.add('hidden');
  panel.classList.remove('hidden');
  elements.modalOverlay.classList.remove('hidden');
  centerPanel(panel);
  makeDraggable(panel, document.getElementById('wstgHeader'));
  titleInput.focus();

  const syncConfig = (refreshPreview = true) => {
    body.querySelectorAll('[data-cfg]').forEach(input => {
      if (input.type === 'radio' && !input.checked) return;
      const key = input.dataset.cfg;
      widget.config[key] = input.type === 'checkbox' ? input.checked : input.value;
    });
    if (refreshPreview && def.liveSettingsPreview !== false && onRefresh) onRefresh();
  };
  body.addEventListener('input',  () => syncConfig(), { signal: sig });
  body.addEventListener('change', () => syncConfig(), { signal: sig });

  document.getElementById('wstgDoneBtn').addEventListener('click', () => {
    if (widget.widgetType === 'countdown') {
      const dateInput = body.querySelector('[data-cfg="targetDate"]');
      const errorEl = body.querySelector('#countdownDateError');
      let val = dateInput?.value || '';
      if (val && !val.includes('T')) val = val + 'T00:00';
      if (dateInput && val) dateInput.value = val;
      if (val && new Date(val) <= new Date()) {
        errorEl?.classList.remove('hidden');
        return;
      }
      errorEl?.classList.add('hidden');
    }
    if (!options.deferUndo) pushUndoSnapshot();
    widget.title = titleInput.value.trim();
    syncConfig(false);
    if (typeof def.onSettingsCommit === 'function') def.onSettingsCommit(widget, savedConfig);
    if (options.onDone) options.onDone(widget);
    panel.classList.add('hidden');
    elements.modalOverlay.classList.add('hidden');
    saveState();
    if (onRefresh) onRefresh();
    _wstgAbort.abort();
  }, { signal: sig, once: true });

  document.getElementById('wstgCancelBtn').addEventListener('click', () => {
    widget.config = savedConfig;
    widget.title  = savedTitle;
    if (options.onCancel) options.onCancel(widget);
    panel.classList.add('hidden');
    elements.modalOverlay.classList.add('hidden');
    if (onRefresh) onRefresh();
    _wstgAbort.abort();
  }, { signal: sig, once: true });
}

// ===========================================================================
// Built-in widgets
// ===========================================================================

// ---- Shared helpers ----

function _pad2(n) { return String(n).padStart(2, '0'); }

function _fmtTime(date, config) {
  const h = date.getHours(), m = date.getMinutes(), s = date.getSeconds();
  if (config.format === '12h') {
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12  = (h % 12) || 12;
    return config.showSeconds
      ? `${h12}:${_pad2(m)}:${_pad2(s)} ${ampm}`
      : `${h12}:${_pad2(m)} ${ampm}`;
  }
  return config.showSeconds
    ? `${_pad2(h)}:${_pad2(m)}:${_pad2(s)}`
    : `${_pad2(h)}:${_pad2(m)}`;
}

function _fmtDate(date) {
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function _tzDate(tz) {
  if (!tz) return new Date();
  try { return new Date(new Date().toLocaleString('en-US', { timeZone: tz })); }
  catch { return new Date(); }
}

function _fmtCountdown(ms) {
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  if (d > 0) return `${d}d ${_pad2(h)}h ${_pad2(m)}m`;
  if (h > 0) return `${h}h ${_pad2(m)}m ${_pad2(s)}s`;
  return `${_pad2(m)}m ${_pad2(s)}s`;
}

function _todayIsoKey() {
  return new Date().toISOString().slice(0, 10);
}

function _getServiceApiKey(serviceName) {
  if (typeof getServiceSecret === 'function') return getServiceSecret(serviceName);
  return '';
}

function _setWidgetStatusText(el, text, cls = '') {
  const row = document.createElement('div');
  row.className = `widget-apod-status${cls ? ` ${cls}` : ''}`;
  row.textContent = text;
  el.appendChild(row);
}

function _getApodCache(widget) {
  if (!widget.data) widget.data = {};
  return widget.data.apodCache || null;
}

function _isApodCacheFresh(widget) {
  const cache = _getApodCache(widget);
  const apiKey = _getServiceApiKey('nasa');
  return !!(cache && apiKey && cache.fetchedOn === _todayIsoKey());
}

function _normalizeApodPayload(payload) {
  return {
    fetchedOn: _todayIsoKey(),
    date: payload?.date || '',
    title: payload?.title || 'Astronomy Picture of the Day',
    explanation: payload?.explanation || '',
    mediaType: payload?.media_type || 'image',
    url: payload?.url || '',
    hdurl: payload?.hdurl || '',
    thumbnailUrl: payload?.thumbnail_url || '',
    copyright: payload?.copyright || '',
    serviceVersion: payload?.service_version || '',
    pageUrl: payload?.date ? `https://apod.nasa.gov/apod/ap${payload.date.replaceAll('-', '').slice(2)}.html` : 'https://apod.nasa.gov/apod/'
  };
}

function _ensureApodData(widget) {
  const apiKey = _getServiceApiKey('nasa');
  if (!apiKey || _isApodCacheFresh(widget)) return;

  const fetchKey = `apod:${widget.id}`;
  if (_widgetFetches.has(fetchKey)) return;

  widget.data = widget.data || {};
  widget.data.apodStatus = 'loading';
  widget.data.apodError = '';

  const request = fetch(`https://api.nasa.gov/planetary/apod?api_key=${encodeURIComponent(apiKey)}&thumbs=true`)
    .then(async response => {
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      if (!response.ok) {
        throw new Error(payload?.msg || `NASA API returned ${response.status}`);
      }
      if (!payload?.url) {
        throw new Error('NASA APOD response did not include media.');
      }
      if (document.hidden) return;
      widget.data.apodCache = _normalizeApodPayload(payload);
      widget.data.apodStatus = 'ready';
      widget.data.apodError = '';
      saveState();
    })
    .catch(error => {
      if (document.hidden) return;
      widget.data.apodStatus = 'error';
      widget.data.apodError = error?.message || 'Unable to load the NASA APOD feed.';
      saveState();
    })
    .finally(() => {
      _widgetFetches.delete(fetchKey);
      _refreshWidget(widget.id, 'column');
    });

  _widgetFetches.set(fetchKey, request);
}

function _normalizeWeatherDays(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(16, parsed)) : 5;
}

function _normalizeWeatherUnits(value) {
  return value === 'imperial' ? 'imperial' : 'metric';
}

function _normalizeWeatherLayout(value) {
  return value === 'horizontal' ? 'horizontal' : 'vertical';
}

function _weatherSignature(widget) {
  const c = widget?.config || {};
  if (c.latitude === '' || c.latitude == null || c.longitude === '' || c.longitude == null) return '';
  const latitude = Number(c.latitude);
  const longitude = Number(c.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return '';
  return `${latitude.toFixed(5)}:${longitude.toFixed(5)}:${_normalizeWeatherDays(c.days)}:${_normalizeWeatherUnits(c.units)}:${WEATHER_CACHE_SCHEMA_VERSION}`;
}

function _weatherCacheKey(widgetId) {
  return `${WEATHER_CACHE_PREFIX}${widgetId}`;
}

function _readWeatherCache(widget) {
  const key = _weatherCacheKey(widget.id);
  let cache = _weatherMemoryCache.get(key) || null;
  if (!cache) {
    try {
      cache = JSON.parse(localStorage.getItem(key) || 'null');
    } catch {
      cache = null;
    }
    if (cache) _weatherMemoryCache.set(key, cache);
  }
  return cache?.signature === _weatherSignature(widget) && cache?.payload ? cache : null;
}

function _writeWeatherCache(widget, payload) {
  const key = _weatherCacheKey(widget.id);
  const cache = {
    signature: _weatherSignature(widget),
    fetchedAt: Date.now(),
    payload
  };
  _weatherMemoryCache.set(key, cache);
  try { localStorage.setItem(key, JSON.stringify(cache)); } catch {}
  return cache;
}

function _isWeatherCacheFresh(cache) {
  return !!cache && Date.now() - Number(cache.fetchedAt || 0) < WEATHER_CACHE_TTL_MS;
}

function _weatherRefreshHour(now = Date.now()) {
  return Math.floor(Number(now) / (60 * 60 * 1000));
}

function _claimWeatherRefreshHour(runtime, now = Date.now()) {
  const hour = _weatherRefreshHour(now);
  if (runtime?.autoRefreshHour === hour) return false;
  if (runtime) runtime.autoRefreshHour = hour;
  return true;
}

function _getWeatherRuntime(widget) {
  const signature = _weatherSignature(widget);
  let runtime = _weatherRuntime.get(widget.id);
  if (!runtime || runtime.signature !== signature) {
    runtime = { signature, status: 'idle', error: '', nextRetryAt: 0 };
    _weatherRuntime.set(widget.id, runtime);
  }
  return runtime;
}

function _weatherCodeDetails(code, isDay = true) {
  const value = Number(code);
  if (value === 0) return { symbol: isDay ? '☀️' : '🌙', label: 'Clear sky' };
  if (value === 1) return { symbol: isDay ? '🌤️' : '🌙', label: 'Mainly clear' };
  if (value === 2) return { symbol: '⛅', label: 'Partly cloudy' };
  if (value === 3) return { symbol: '☁️', label: 'Overcast' };
  if (value === 45 || value === 48) return { symbol: '🌫️', label: 'Fog' };
  if ([51, 53, 55, 56, 57].includes(value)) return { symbol: '🌦️', label: value >= 56 ? 'Freezing drizzle' : 'Drizzle' };
  if ([61, 63, 65, 66, 67].includes(value)) return { symbol: '🌧️', label: value >= 66 ? 'Freezing rain' : 'Rain' };
  if ([71, 73, 75, 77].includes(value)) return { symbol: '🌨️', label: 'Snow' };
  if ([80, 81, 82].includes(value)) return { symbol: '🌦️', label: 'Rain showers' };
  if (value === 85 || value === 86) return { symbol: '🌨️', label: 'Snow showers' };
  if ([95, 96, 99].includes(value)) return { symbol: '⛈️', label: value >= 96 ? 'Thunderstorm with hail' : 'Thunderstorm' };
  return { symbol: '—', label: 'Conditions unavailable' };
}

function _weatherForecastUrl(widget) {
  const c = widget.config;
  const units = _normalizeWeatherUnits(c.units);
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(c.latitude));
  url.searchParams.set('longitude', String(c.longitude));
  url.searchParams.set('current', 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,is_day,wind_speed_10m');
  url.searchParams.set('hourly', 'temperature_2m,precipitation_probability,weather_code,is_day');
  url.searchParams.set('daily', 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max');
  url.searchParams.set('forecast_hours', '24');
  url.searchParams.set('timezone', c.timezone || 'auto');
  url.searchParams.set('forecast_days', String(_normalizeWeatherDays(c.days)));
  url.searchParams.set('temperature_unit', units === 'imperial' ? 'fahrenheit' : 'celsius');
  url.searchParams.set('wind_speed_unit', units === 'imperial' ? 'mph' : 'kmh');
  url.searchParams.set('precipitation_unit', units === 'imperial' ? 'inch' : 'mm');
  return url.toString();
}

function _ensureWeatherData(widget, options = {}) {
  const signature = _weatherSignature(widget);
  if (!signature) return null;
  const force = options.force === true;

  const cache = _readWeatherCache(widget);
  if (!force && _isWeatherCacheFresh(cache)) return null;

  const runtime = _getWeatherRuntime(widget);
  const fetchKey = `weather:${widget.id}`;
  if (_widgetFetches.has(fetchKey)) return _widgetFetches.get(fetchKey);
  if (!force && runtime.nextRetryAt > Date.now()) return null;

  runtime.autoRefreshHour = _weatherRefreshHour();
  runtime.status = 'loading';
  runtime.error = '';
  const request = fetch(_weatherForecastUrl(widget))
    .then(async response => {
      let payload = null;
      try { payload = await response.json(); } catch { payload = null; }
      if (!response.ok) throw new Error(payload?.reason || `Open-Meteo returned ${response.status}`);
      if (!payload?.current || !Array.isArray(payload?.hourly?.time) || !Array.isArray(payload?.daily?.time)) {
        throw new Error('Open-Meteo returned incomplete forecast data.');
      }
      _writeWeatherCache(widget, payload);
      runtime.status = 'ready';
      runtime.error = '';
      runtime.nextRetryAt = 0;
    })
    .catch(error => {
      runtime.status = 'error';
      runtime.error = error?.message || 'Unable to load the weather forecast.';
      runtime.nextRetryAt = Date.now() + WEATHER_RETRY_DELAY_MS;
    })
    .finally(() => {
      _widgetFetches.delete(fetchKey);
      _refreshWidget(widget.id, 'column');
    });

  _widgetFetches.set(fetchKey, request);
  return request;
}

function _weatherDayLabel(isoDate, index) {
  if (index === 0) return 'Today';
  try {
    return new Date(`${isoDate}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' });
  } catch {
    return isoDate;
  }
}

function _formatWeatherValue(value, suffix = '') {
  const number = Number(value);
  return Number.isFinite(number) ? `${Math.round(number)}${suffix}` : '—';
}

function _weatherNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function _weatherHourlyForecast(payload, limit = 24) {
  const hourly = payload?.hourly || {};
  const times = Array.isArray(hourly.time) ? hourly.time : [];
  if (!times.length) return [];
  const currentTime = String(payload?.current?.time || '');
  const currentHour = currentTime.includes('T') ? `${currentTime.slice(0, 13)}:00` : currentTime;
  let startIndex = currentHour ? times.findIndex(time => String(time) >= currentHour) : 0;
  if (startIndex < 0) startIndex = 0;
  return times.slice(startIndex, startIndex + limit).map((time, offset) => {
    const index = startIndex + offset;
    return {
      time,
      temperature: _weatherNumber(hourly.temperature_2m?.[index]),
      precipitationProbability: _weatherNumber(hourly.precipitation_probability?.[index]),
      weatherCode: _weatherNumber(hourly.weather_code?.[index]),
      isDay: Number(hourly.is_day?.[index]) !== 0
    };
  });
}

function _weatherHourLabel(isoTime, index) {
  if (index === 0) return 'Now';
  const value = String(isoTime || '');
  const time = value.includes('T') ? value.split('T')[1]?.slice(0, 5) : value;
  return time || '—';
}

function _enableWeatherHourlyDragScroll(viewport) {
  if (!viewport?.addEventListener) return;
  let pointerId = null;
  let startX = 0;
  let startScrollLeft = 0;
  const findWidgetCard = () => viewport.closest?.('.widget-card');
  const disableWidgetDrag = () => {
    const widgetCard = findWidgetCard();
    if (widgetCard) widgetCard.draggable = false;
  };
  const restoreWidgetDrag = () => {
    const widgetCard = findWidgetCard();
    if (widgetCard) widgetCard.draggable = true;
  };

  viewport.addEventListener('mouseenter', disableWidgetDrag);
  viewport.addEventListener('mouseleave', () => {
    if (pointerId == null) restoreWidgetDrag();
  });

  viewport.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    disableWidgetDrag();
    pointerId = event.pointerId;
    startX = event.clientX;
    startScrollLeft = viewport.scrollLeft;
    viewport.classList.add('is-dragging');
    viewport.setPointerCapture?.(pointerId);
    if (event.pointerType === 'mouse') event.preventDefault();
    event.stopPropagation();
  });

  viewport.addEventListener('pointermove', event => {
    if (pointerId == null || event.pointerId !== pointerId) return;
    const delta = event.clientX - startX;
    if (Math.abs(delta) > 2) {
      viewport.scrollLeft = startScrollLeft - delta;
      event.preventDefault();
    }
    event.stopPropagation();
  });

  const endDrag = event => {
    if (pointerId == null || (event.pointerId != null && event.pointerId !== pointerId)) return;
    if (viewport.hasPointerCapture?.(pointerId)) viewport.releasePointerCapture(pointerId);
    pointerId = null;
    viewport.classList.remove('is-dragging');
    if (!viewport.matches?.(':hover')) restoreWidgetDrag();
    event.stopPropagation();
  };
  viewport.addEventListener('pointerup', endDrag);
  viewport.addEventListener('pointercancel', endDrag);
  viewport.addEventListener('dragstart', event => {
    event.preventDefault();
    event.stopPropagation();
  });
}

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
  let view = _weatherMapViewMemory.get(key) || null;
  if (!view) {
    try { view = JSON.parse(localStorage.getItem(key) || 'null'); } catch { view = null; }
    if (view) _weatherMapViewMemory.set(key, view);
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
  _weatherMapViewMemory.set(key, view);
  try { localStorage.setItem(key, JSON.stringify(view)); } catch {}
  return view;
}

function _clearWeatherMapView(widget) {
  const key = _weatherMapViewKey(widget.id);
  _weatherMapViewMemory.delete(key);
  try { localStorage.removeItem(key); } catch {}
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
  let cache = _weatherMapMemoryCache.get(key) || null;
  if (!cache) {
    try { cache = JSON.parse(localStorage.getItem(key) || 'null'); } catch { cache = null; }
    if (cache) _weatherMapMemoryCache.set(key, cache);
  }
  return cache?.signature === _weatherMapSignature(widget) && Array.isArray(cache?.payload) ? cache : null;
}

function _writeWeatherMapCache(widget, payload, signature = _weatherMapSignature(widget)) {
  const key = _weatherMapCacheKey(widget.id);
  const cache = { signature, fetchedAt: Date.now(), payload };
  _weatherMapMemoryCache.set(key, cache);
  try { localStorage.setItem(key, JSON.stringify(cache)); } catch {}
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
  if (instance.playTimer) clearInterval(instance.playTimer);
  if (instance.rainAnimationFrame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(instance.rainAnimationFrame);
  if (instance.resizeFrame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(instance.resizeFrame);
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
  if (typeof requestAnimationFrame !== 'function') {
    try { instance.map.resize(); } catch {}
    return;
  }
  if (instance.resizeFrame) cancelAnimationFrame(instance.resizeFrame);
  instance.resizeFrame = requestAnimationFrame(() => {
    instance.resizeFrame = 0;
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
  const request = fetch(requestUrl)
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
  if (instance?.rainAnimationFrame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(instance.rainAnimationFrame);
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
    instance.rainAnimationFrame = requestAnimationFrame(tick);
  };
  instance.rainAnimationFrame = requestAnimationFrame(tick);
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
    const view = JSON.parse(localStorage.getItem(_issViewKey(widgetId)) || 'null');
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
    localStorage.setItem(_issViewKey(widgetId), JSON.stringify(view));
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
    const cached = JSON.parse(localStorage.getItem(ISS_TLE_CACHE_KEY) || 'null');
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
  try { localStorage.setItem(ISS_TLE_CACHE_KEY, JSON.stringify(cache)); } catch {}
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
    const response = await fetch('https://api.wheretheiss.at/v1/satellites/25544/tles');
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
      const response = await fetch('https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=TLE');
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
  if (instance.resizeFrame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(instance.resizeFrame);
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
  if (typeof requestAnimationFrame !== 'function') {
    try { instance.map.resize(); } catch {}
    return;
  }
  if (instance.resizeFrame) cancelAnimationFrame(instance.resizeFrame);
  instance.resizeFrame = requestAnimationFrame(() => {
    instance.resizeFrame = 0;
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


// ---- Clock widget ----

WIDGET_REGISTRY['clock'] = {
  name: 'Clock',
  description: 'Live clock with optional date display',
  allowedIn: ['column', 'navpane'],
  defaultConfig: { format: '24h', showSeconds: false, showDate: true, timezone: '' },
  defaultData: {},

  render(widget, el, context) {
    const c = widget.config;
    el.className = 'widget-clock';
    el.innerHTML = `<div class="widget-clock-time"></div>${c.showDate ? '<div class="widget-clock-date"></div>' : ''}`;
    const timeEl = el.querySelector('.widget-clock-time');
    const dateEl = el.querySelector('.widget-clock-date');
    const tick = () => {
      const now = _tzDate(c.timezone);
      timeEl.textContent = _fmtTime(now, c);
      if (dateEl) dateEl.textContent = _fmtDate(now);
    };
    tick();
    _setWidgetTimer(widget.id, context, tick, 1000);
  },

  renderSettings(widget, container) {
    const c = widget.config;
    container.innerHTML = `
      <div class="settings-row">
        <span>Format</span>
        <div class="icon-size-radios">
          <label class="icon-size-label" title="24 hour"><input type="radio" name="clockFormat" data-cfg="format" value="24h" ${c.format !== '12h' ? 'checked' : ''}/><span>24h</span></label>
          <label class="icon-size-label" title="12 hour"><input type="radio" name="clockFormat" data-cfg="format" value="12h" ${c.format === '12h' ? 'checked' : ''}/><span>12h</span></label>
        </div>
      </div>
      <div class="settings-row">
        <span>Show seconds</span>
        <label class="settings-toggle"><input type="checkbox" data-cfg="showSeconds" ${c.showSeconds ? 'checked' : ''}/><span class="toggle-track"></span></label>
      </div>
      <div class="settings-row">
        <span>Show date</span>
        <label class="settings-toggle"><input type="checkbox" data-cfg="showDate" ${c.showDate ? 'checked' : ''}/><span class="toggle-track"></span></label>
      </div>
      <div class="settings-row settings-row--top">
        <span>Timezone</span>
        <div class="tz-picker-group">
          <input type="text" list="wstgTzList" data-cfg="timezone" placeholder="e.g. America/New_York" value="${c.timezone || ''}" class="settings-text-input" autocomplete="off" />
          <datalist id="wstgTzList"></datalist>
          <div class="tz-hint-row">
            <span class="tz-hint"></span>
            <button type="button" class="tz-use-local-btn">Use local</button>
          </div>
        </div>
      </div>`;

    // Populate datalist and hint
    const datalist = container.querySelector('#wstgTzList');
    const hint = container.querySelector('.tz-hint');
    const useLocalBtn = container.querySelector('.tz-use-local-btn');
    const tzInput = container.querySelector('[data-cfg="timezone"]');

    const localTz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return ''; } })();
    if (localTz) hint.textContent = `Local: ${localTz}`;

    try {
      Intl.supportedValuesOf('timeZone').forEach(tz => {
        const opt = document.createElement('option');
        opt.value = tz;
        datalist.appendChild(opt);
      });
    } catch { /* browser doesn't support Intl.supportedValuesOf */ }

    useLocalBtn.addEventListener('click', () => {
      tzInput.value = localTz;
      tzInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
};


// ---- Countdown widget ----

WIDGET_REGISTRY['countdown'] = {
  name: 'Countdown',
  description: 'Days / hours / minutes until a target date',
  allowedIn: ['column', 'navpane'],
  defaultConfig: { label: 'Event', targetDate: '' },
  defaultData: {},

  render(widget, el, context) {
    const c = widget.config;
    el.className = 'widget-countdown';
    el.innerHTML = '<div class="widget-countdown-label"></div><div class="widget-countdown-value"></div>';
    const labelEl = el.querySelector('.widget-countdown-label');
    const valueEl = el.querySelector('.widget-countdown-value');
    const tick = () => {
      labelEl.textContent = c.label || 'Event';
      if (!c.targetDate) { valueEl.textContent = 'No date set'; return; }
      const diff = new Date(c.targetDate) - Date.now();
      if (diff <= 0) {
        valueEl.textContent = '🎉 Today!';
        clearInterval(_widgetTimers.get(`${widget.id}:${context}`));
        _widgetTimers.delete(`${widget.id}:${context}`);
        return;
      }
      valueEl.textContent = _fmtCountdown(diff);
    };
    tick();
    _setWidgetTimer(widget.id, context, tick, 1000);
  },

  renderSettings(widget, container) {
    const c = widget.config;
    container.innerHTML = `
      <div class="settings-row">
        <span>Label</span>
        <input type="text" data-cfg="label" value="${c.label || ''}" placeholder="Event name" class="settings-text-input" />
      </div>
      <div class="settings-row">
        <span>Target date</span>
        <input type="datetime-local" data-cfg="targetDate" value="${c.targetDate || ''}" class="settings-text-input" />
      </div>
      <div id="countdownDateError" class="settings-warning hidden">Target date must be in the future.</div>`;
  }
};


// ---- Notes widget ----

WIDGET_REGISTRY['notes'] = {
  name: 'Notes',
  description: 'Freeform text note, editable inline',
  allowedIn: ['column'],
  defaultConfig: { content: '' },
  defaultData: {},

  render(widget, el, context) {
    el.className = 'widget-notes';
    const ta = document.createElement('textarea');
    ta.className = 'widget-notes-textarea';
    ta.value = widget.config.content || '';
    ta.placeholder = 'Type a note…';
    ta.addEventListener('mousedown', e => e.stopPropagation());
    ta.addEventListener('input', () => { widget.config.content = ta.value; });
    ta.addEventListener('blur', () => saveState());
    el.appendChild(ta);
  },

  renderSettings(widget, container) {
    const c = widget.config;
    container.innerHTML = `
      <textarea data-cfg="content" class="settings-text-input widget-notes-settings-textarea" rows="8" placeholder="Type a note…">${c.content || ''}</textarea>`;
  }
};


// ---- To-do list widget ----

WIDGET_REGISTRY['todo'] = {
  name: 'To-do List',
  description: 'Checklist with add and remove',
  allowedIn: ['column'],
  defaultConfig: {},
  defaultData: { items: [] },

  render(widget, el, context) {
    el.className = 'widget-todo';
    if (!widget.data.items) widget.data.items = [];

    const list = document.createElement('div');
    list.className = 'widget-todo-list';

    const rerender = () => {
      list.innerHTML = '';
      widget.data.items.forEach(item => {
        const row = document.createElement('label');
        row.className = 'widget-todo-row' + (item.done ? ' done' : '');
        row.addEventListener('mousedown', e => e.stopPropagation());

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = item.done;
        cb.addEventListener('change', () => {
          item.done = cb.checked;
          row.classList.toggle('done', item.done);
          saveState();
        });

        const span = document.createElement('span');
        span.className = 'widget-todo-text';
        span.textContent = item.text;

        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'widget-todo-delete';
        del.textContent = '×';
        del.addEventListener('click', e => {
          e.preventDefault();
          e.stopPropagation();
          widget.data.items = widget.data.items.filter(i => i.id !== item.id);
          rerender();
          saveState();
        });

        row.appendChild(cb);
        row.appendChild(span);
        row.appendChild(del);
        list.appendChild(row);
      });
    };
    rerender();

    const addRow = document.createElement('div');
    addRow.className = 'widget-todo-add';
    addRow.addEventListener('mousedown', e => e.stopPropagation());

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'widget-todo-input';
    input.placeholder = 'Add item…';

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'widget-todo-add-btn';
    addBtn.textContent = '+';

    const addItem = () => {
      const text = input.value.trim();
      if (!text) return;
      widget.data.items.push({ id: `td-${Date.now()}`, text, done: false });
      input.value = '';
      rerender();
      saveState();
    };
    addBtn.addEventListener('click', addItem);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addItem(); } });

    addRow.appendChild(input);
    addRow.appendChild(addBtn);
    el.appendChild(list);
    el.appendChild(addRow);
  },

  renderSettings(widget, container) {
    const done = (widget.data.items || []).filter(i => i.done).length;
    const total = (widget.data.items || []).length;
    container.innerHTML = `
      <div class="settings-row">
        <span>Progress</span>
        <span class="settings-value">${done} / ${total} done</span>
      </div>
      <div class="settings-row todo-clear-row">
        <button type="button" class="secondary-btn" id="todoClearDoneBtn">Clear completed</button>
      </div>`;
    container.querySelector('#todoClearDoneBtn').addEventListener('click', () => {
      widget.data.items = (widget.data.items || []).filter(i => !i.done);
      container.querySelector('span.settings-value').textContent =
        `${0} / ${widget.data.items.length} done`;
    });
  }
};


// ---- Image widget ----

WIDGET_REGISTRY['image'] = {
  name: 'Image',
  description: 'Display an image from a URL',
  allowedIn: ['column'],
  defaultConfig: { url: '', fit: 'contain', caption: '' },
  defaultData: {},

  render(widget, el, context) {
    const c = widget.config;
    el.className = 'widget-image';
    if (c.url) {
      const img = document.createElement('img');
      img.className = 'widget-image-img';
      img.src = c.url;
      img.style.objectFit = c.fit || 'contain';
      img.alt = c.caption || '';
      el.appendChild(img);
      if (c.caption) {
        const cap = document.createElement('div');
        cap.className = 'widget-image-caption';
        cap.textContent = c.caption;
        el.appendChild(cap);
      }
    } else {
      const ph = document.createElement('div');
      ph.className = 'widget-image-placeholder';
      ph.textContent = 'No image URL — open settings to add one';
      el.appendChild(ph);
    }
  },

  renderSettings(widget, container) {
    const c = widget.config;
    container.innerHTML = `
      <div class="settings-section widget-image-settings-section">
        <div class="settings-section-label">Image</div>
        <div class="settings-row widget-image-settings-url-row">
          <input type="text" data-cfg="url" value="${c.url || ''}" placeholder="Enter URL" class="settings-text-input" />
        </div>
        <div class="bg-drop-zone widget-image-settings-drop-zone">
          <span>Drop an image file here</span>
        </div>
        <div class="settings-row widget-image-settings-actions">
          <button type="button" class="secondary-btn widget-image-settings-browse-btn">Browse…</button>
          <button type="button" class="secondary-btn widget-image-settings-clear-btn">Clear image</button>
        </div>
        <div class="settings-row settings-row--top widget-image-settings-fit-row">
          <div class="board-fit-radios">
            <label class="board-fit-label"><input type="radio" name="widgetImageFit-${widget.id}" data-cfg="fit" value="cover" ${(c.fit || 'contain') === 'cover' ? 'checked' : ''}/><span>Cover</span></label>
            <label class="board-fit-label"><input type="radio" name="widgetImageFit-${widget.id}" data-cfg="fit" value="contain" ${(c.fit || 'contain') === 'contain' ? 'checked' : ''}/><span>Contain</span></label>
            <label class="board-fit-label"><input type="radio" name="widgetImageFit-${widget.id}" data-cfg="fit" value="fill" ${c.fit === 'fill' ? 'checked' : ''}/><span>Fill</span></label>
          </div>
        </div>
      </div>
      <div class="settings-section widget-image-caption-section">
        <div class="settings-section-label">Caption</div>
        <div class="settings-row widget-image-caption-row">
          <input type="text" data-cfg="caption" value="${c.caption || ''}" placeholder="Optional caption" class="settings-text-input" />
        </div>
      </div>`;

    const urlInput = container.querySelector('[data-cfg="url"]');
    const dropZone = container.querySelector('.widget-image-settings-drop-zone');
    const browseBtn = container.querySelector('.widget-image-settings-browse-btn');
    const clearBtn = container.querySelector('.widget-image-settings-clear-btn');

    const updatePreview = imageUrl => {
      if (!dropZone) return;
      if (imageUrl) {
        dropZone.style.backgroundImage = `url(${JSON.stringify(imageUrl)})`;
        dropZone.classList.add('has-preview');
      } else {
        dropZone.style.backgroundImage = '';
        dropZone.classList.remove('has-preview');
      }
    };

    const commitUrl = nextUrl => {
      if (!urlInput) return;
      urlInput.value = nextUrl;
      urlInput.dispatchEvent(new Event('input', { bubbles: true }));
      updatePreview(nextUrl);
    };

    updatePreview(c.url || '');
    urlInput?.addEventListener('input', () => updatePreview(urlInput.value.trim()));

    dropZone?.addEventListener('dragover', e => {
      e.preventDefault();
      dropZone.classList.add('drag-over');
    });
    dropZone?.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone?.addEventListener('drop', e => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      const file = e.dataTransfer?.files?.[0];
      if (!file || !file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = ev => commitUrl(ev.target?.result || '');
      reader.readAsDataURL(file);
    });

    browseBtn?.addEventListener('click', async () => {
      if (typeof bridge === 'undefined' || !bridge.isAvailable() || !bridge.nativeIsAvailable()) {
        alert('File browsing requires the native messaging host.\nSee extension/native/install.ps1 to set it up.');
        return;
      }
      const result = await bridge.openFilePicker('image', 'Select widget image');
      if (!result?.dataUrl) return;
      commitUrl(result.dataUrl);
    });

    clearBtn?.addEventListener('click', () => commitUrl(''));
  }
};


// ---- NASA APOD widget ----

WIDGET_REGISTRY['nasaApod'] = {
  name: 'NASA APOD',
  description: 'Show NASA Astronomy Picture of the Day',
  allowedIn: ['column'],
  defaultConfig: { preferHd: false, showDate: true, showExplanation: true },
  defaultData: { apodStatus: 'idle', apodError: '', apodCache: null },

  render(widget, el, context) {
    const c = widget.config;
    const cache = _getApodCache(widget);
    const hasApiKey = !!_getServiceApiKey('nasa');
    const isFresh = _isApodCacheFresh(widget);

    _setWidgetRefresher(widget.id, context, () => {
      if (!el.isConnected) {
        _widgetRefreshers.delete(`${widget.id}:${context}`);
        return;
      }
      el.innerHTML = '';
      WIDGET_REGISTRY.nasaApod.render(widget, el, context);
    });

    el.className = 'widget-apod';

    if (!hasApiKey) {
      const ph = document.createElement('div');
      ph.className = 'widget-apod-placeholder';
      ph.textContent = 'Add your NASA API key in Settings > API Keys to load Astronomy Picture of the Day.';
      el.appendChild(ph);
      return;
    }

    if (!isFresh) _ensureApodData(widget);
    const status = widget.data?.apodStatus || (isFresh ? 'ready' : 'idle');

    if (!cache) {
      if (status === 'error') {
        _setWidgetStatusText(el, widget.data?.apodError || 'Unable to load NASA APOD.', 'is-error');
      } else {
        const ph = document.createElement('div');
        ph.className = 'widget-apod-placeholder';
        ph.textContent = 'Loading today\'s NASA APOD...';
        el.appendChild(ph);
      }
      return;
    }

    const header = document.createElement('div');
    header.className = 'widget-apod-header';

    const title = document.createElement('div');
    title.className = 'widget-apod-title';
    title.textContent = cache.title || 'Astronomy Picture of the Day';
    header.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'widget-apod-meta';
    if (c.showDate && cache.date) {
      const date = document.createElement('span');
      date.textContent = cache.date;
      meta.appendChild(date);
    }
    if (cache.mediaType && cache.mediaType !== 'image') {
      const badge = document.createElement('span');
      badge.className = 'widget-apod-badge';
      badge.textContent = cache.mediaType;
      meta.appendChild(badge);
    }
    if (cache.copyright) {
      const credit = document.createElement('span');
      credit.textContent = `Copyright ${cache.copyright}`;
      meta.appendChild(credit);
    }
    if (meta.childNodes.length) header.appendChild(meta);
    el.appendChild(header);

    const previewUrl = cache.mediaType === 'image'
      ? ((c.preferHd && cache.hdurl) ? cache.hdurl : cache.url)
      : (cache.thumbnailUrl || cache.url);
    const openUrl = cache.mediaType === 'image'
      ? (cache.hdurl || cache.url)
      : (cache.url || cache.pageUrl);

    if (previewUrl) {
      const figure = document.createElement('div');
      figure.className = 'widget-apod-figure';

      const link = document.createElement('a');
      link.className = 'widget-apod-preview-link';
      link.href = openUrl || previewUrl;
      link.target = '_blank';
      link.rel = 'noreferrer noopener';
      link.title = cache.title || 'Open NASA APOD';
      link.addEventListener('mousedown', event => event.stopPropagation());

      const img = document.createElement('img');
      img.className = 'widget-apod-preview';
      img.src = previewUrl;
      img.alt = cache.title || 'NASA APOD';
      img.loading = 'lazy';
      link.appendChild(img);

      figure.appendChild(link);
      el.appendChild(figure);
    }

    const actions = document.createElement('div');
    actions.className = 'widget-apod-actions';

    const mediaLink = document.createElement('a');
    mediaLink.className = 'widget-apod-action';
    mediaLink.href = openUrl || cache.url || cache.pageUrl;
    mediaLink.target = '_blank';
    mediaLink.rel = 'noreferrer noopener';
    mediaLink.textContent = cache.mediaType === 'image' ? 'Open full media' : 'Open NASA media';
    mediaLink.addEventListener('mousedown', event => event.stopPropagation());
    actions.appendChild(mediaLink);

    if (cache.pageUrl) {
      const pageLink = document.createElement('a');
      pageLink.className = 'widget-apod-action';
      pageLink.href = cache.pageUrl;
      pageLink.target = '_blank';
      pageLink.rel = 'noreferrer noopener';
      pageLink.textContent = 'View APOD page';
      pageLink.addEventListener('mousedown', event => event.stopPropagation());
      actions.appendChild(pageLink);
    }

    el.appendChild(actions);

    if (c.showExplanation && cache.explanation) {
      const details = document.createElement('details');
      details.className = 'widget-apod-details';
      const summary = document.createElement('summary');
      summary.textContent = 'About this image';
      const text = document.createElement('div');
      text.className = 'widget-apod-summary';
      text.textContent = cache.explanation;
      details.appendChild(summary);
      details.appendChild(text);
      el.appendChild(details);
    }

    if (status === 'loading' && !isFresh) {
      _setWidgetStatusText(el, 'Refreshing from NASA...');
    } else if (status === 'error') {
      _setWidgetStatusText(el, widget.data?.apodError || 'Unable to refresh NASA APOD.', 'is-error');
    }
  },

  renderSettings(widget, container) {
    const c = widget.config;
    container.innerHTML = `
      <div class="settings-row settings-row--top">
        <span>NASA API key</span>
        <div class="tz-picker-group">
          <span class="settings-muted">Managed globally in Settings &gt; API Keys.</span>
        </div>
      </div>
      <div class="settings-row">
        <span>Prefer HD image</span>
        <label class="settings-toggle"><input type="checkbox" data-cfg="preferHd" ${c.preferHd ? 'checked' : ''}/><span class="toggle-track"></span></label>
      </div>
      <div class="settings-row">
        <span>Show date</span>
        <label class="settings-toggle"><input type="checkbox" data-cfg="showDate" ${c.showDate !== false ? 'checked' : ''}/><span class="toggle-track"></span></label>
      </div>
      <div class="settings-row">
        <span>Show explanation</span>
        <label class="settings-toggle"><input type="checkbox" data-cfg="showExplanation" ${c.showExplanation !== false ? 'checked' : ''}/><span class="toggle-track"></span></label>
      </div>`;
  }
};

// ---- Weather widget ----

WIDGET_REGISTRY['weather'] = {
  name: 'Weather',
  description: 'Current conditions and a multi-day forecast from Open-Meteo',
  allowedIn: ['column'],
  defaultConfig: {
    locationName: '',
    latitude: '',
    longitude: '',
    timezone: 'auto',
    days: 5,
    units: 'metric',
    forecastLayout: 'vertical',
    showHourly24: false
  },
  defaultData: {},

  reload(widget) {
    return _ensureWeatherData(widget, { force: true });
  },

  render(widget, el, context) {
    const c = widget.config || {};
    const signature = _weatherSignature(widget);

    _setWidgetRefresher(widget.id, context, () => {
      if (!el.isConnected) {
        _widgetRefreshers.delete(`${widget.id}:${context}`);
        return;
      }
      el.innerHTML = '';
      WIDGET_REGISTRY.weather.render(widget, el, context);
    });

    el.className = 'widget-weather';

    if (!signature) {
      const placeholder = document.createElement('div');
      placeholder.className = 'widget-weather-placeholder';
      placeholder.textContent = 'Choose a location in the widget settings to load a forecast.';
      el.appendChild(placeholder);
      return;
    }

    let cache = _readWeatherCache(widget);
    const runtime = _getWeatherRuntime(widget);
    if (_claimWeatherRefreshHour(runtime)) {
      _ensureWeatherData(widget, { force: true });
    } else if (!_isWeatherCacheFresh(cache)) {
      _ensureWeatherData(widget);
    }
    _setWidgetTimer(widget.id, context, () => {
      const currentRuntime = _getWeatherRuntime(widget);
      if (_claimWeatherRefreshHour(currentRuntime)) {
        _ensureWeatherData(widget, { force: true });
      } else if (!_isWeatherCacheFresh(_readWeatherCache(widget))) {
        _ensureWeatherData(widget);
      }
    }, 60 * 1000);
    cache = _readWeatherCache(widget);
    const payload = cache?.payload;

    if (!payload) {
      const placeholder = document.createElement('div');
      placeholder.className = 'widget-weather-placeholder';
      placeholder.textContent = runtime.status === 'error'
        ? runtime.error
        : `Loading weather for ${c.locationName || 'the selected location'}...`;
      if (runtime.status === 'error') placeholder.classList.add('is-error');
      el.appendChild(placeholder);
    } else {
      const current = payload.current || {};
      const currentUnits = payload.current_units || {};
      const conditions = _weatherCodeDetails(current.weather_code, Number(current.is_day) !== 0);

      const header = document.createElement('div');
      header.className = 'widget-weather-header';
      const location = document.createElement('div');
      location.className = 'widget-weather-location';
      location.textContent = c.locationName || payload.timezone_abbreviation || 'Weather';
      header.appendChild(location);

      const currentRow = document.createElement('div');
      currentRow.className = 'widget-weather-current';
      const symbol = document.createElement('span');
      symbol.className = 'widget-weather-symbol';
      symbol.textContent = conditions.symbol;
      symbol.setAttribute('aria-label', conditions.label);
      const temperature = document.createElement('span');
      temperature.className = 'widget-weather-temperature';
      temperature.textContent = _formatWeatherValue(current.temperature_2m, currentUnits.temperature_2m || '°C');
      const summary = document.createElement('span');
      summary.className = 'widget-weather-summary';
      summary.textContent = conditions.label;
      currentRow.append(symbol, temperature, summary);
      header.appendChild(currentRow);

      const details = document.createElement('div');
      details.className = 'widget-weather-details';
      details.textContent = [
        `Feels ${_formatWeatherValue(current.apparent_temperature, currentUnits.apparent_temperature || '°C')}`,
        `Humidity ${_formatWeatherValue(current.relative_humidity_2m, currentUnits.relative_humidity_2m || '%')}`,
        `Wind ${_formatWeatherValue(current.wind_speed_10m, ` ${currentUnits.wind_speed_10m || 'km/h'}`)}`
      ].join(' · ');
      header.appendChild(details);
      el.appendChild(header);

      if (c.showHourly24) {
        const hours = _weatherHourlyForecast(payload, 24);
        if (hours.length) {
          const hourlySection = document.createElement('section');
          hourlySection.className = 'widget-weather-hourly';
          const hourlyTitle = document.createElement('div');
          hourlyTitle.className = 'widget-weather-hourly-title';
          hourlyTitle.textContent = 'Next 24 hours';
          const hourlyViewport = document.createElement('div');
          hourlyViewport.className = 'widget-weather-hourly-viewport widget-interactive-surface';
          hourlyViewport.tabIndex = 0;
          hourlyViewport.setAttribute('aria-label', 'Scrollable 24-hour forecast');
          const hourlyGrid = document.createElement('div');
          hourlyGrid.className = 'widget-weather-hourly-grid';
          const hourlyUnits = payload.hourly_units || {};

          hours.forEach((hour, index) => {
            const conditions = _weatherCodeDetails(hour.weatherCode, hour.isDay);
            const card = document.createElement('div');
            card.className = 'widget-weather-hour';
            card.title = conditions.label;
            const time = document.createElement('span');
            time.className = 'widget-weather-hour-time';
            time.textContent = _weatherHourLabel(hour.time, index);
            const iconEl = document.createElement('span');
            iconEl.className = 'widget-weather-hour-symbol';
            iconEl.textContent = conditions.symbol;
            iconEl.setAttribute('aria-label', conditions.label);
            const temperatureEl = document.createElement('span');
            temperatureEl.className = 'widget-weather-hour-temperature';
            temperatureEl.textContent = _formatWeatherValue(hour.temperature, hourlyUnits.temperature_2m || '°C');
            const rain = document.createElement('span');
            rain.className = 'widget-weather-hour-rain';
            rain.textContent = `💧${_formatWeatherValue(hour.precipitationProbability, hourlyUnits.precipitation_probability || '%')}`;
            rain.title = 'Precipitation probability';
            card.append(time, iconEl, temperatureEl, rain);
            hourlyGrid.appendChild(card);
          });

          hourlyViewport.appendChild(hourlyGrid);
          _enableWeatherHourlyDragScroll(hourlyViewport);
          hourlySection.append(hourlyTitle, hourlyViewport);
          el.appendChild(hourlySection);
        }
      }

      const forecast = document.createElement('div');
      forecast.className = `widget-weather-forecast is-${_normalizeWeatherLayout(c.forecastLayout)}`;
      const daily = payload.daily || {};
      const dailyUnits = payload.daily_units || {};
      daily.time.forEach((date, index) => {
        const day = document.createElement('div');
        day.className = 'widget-weather-day';

        const dayName = document.createElement('span');
        dayName.className = 'widget-weather-day-name';
        dayName.textContent = _weatherDayLabel(date, index);
        const dayConditions = _weatherCodeDetails(daily.weather_code?.[index], true);
        const daySymbol = document.createElement('span');
        daySymbol.className = 'widget-weather-day-symbol';
        daySymbol.textContent = dayConditions.symbol;
        daySymbol.title = dayConditions.label;
        const temperatures = document.createElement('span');
        temperatures.className = 'widget-weather-day-temperatures';
        temperatures.textContent = `${_formatWeatherValue(daily.temperature_2m_max?.[index], dailyUnits.temperature_2m_max || '°C')} / ${_formatWeatherValue(daily.temperature_2m_min?.[index], dailyUnits.temperature_2m_min || '°C')}`;
        const precipitation = document.createElement('span');
        precipitation.className = 'widget-weather-day-rain';
        precipitation.textContent = `💧 ${_formatWeatherValue(daily.precipitation_probability_max?.[index], dailyUnits.precipitation_probability_max || '%')}`;
        precipitation.title = 'Maximum precipitation probability';
        day.append(dayName, daySymbol, temperatures, precipitation);
        forecast.appendChild(day);
      });
      el.appendChild(forecast);

      if (runtime.status === 'loading') {
        _setWidgetStatusText(el, 'Refreshing forecast...');
      } else if (runtime.status === 'error') {
        _setWidgetStatusText(el, `Showing saved forecast. ${runtime.error}`, 'is-error');
      }
    }

    const attribution = document.createElement('a');
    attribution.className = 'widget-weather-attribution';
    attribution.href = 'https://open-meteo.com/';
    attribution.target = '_blank';
    attribution.rel = 'noreferrer noopener';
    attribution.textContent = 'Weather data by Open-Meteo.com';
    attribution.addEventListener('mousedown', event => event.stopPropagation());
    el.appendChild(attribution);
  },

  renderSettings(widget, container) {
    const c = widget.config || {};
    const dayOptions = Array.from({ length: 16 }, (_, index) => {
      const days = index + 1;
      const selected = _normalizeWeatherDays(c.days) === days ? 'selected' : '';
      return `<option value="${days}" ${selected}>${days} day${days === 1 ? '' : 's'}</option>`;
    }).join('');

    container.innerHTML = `
      <div class="settings-row settings-row--top">
        <span>Location</span>
        <div class="weather-location-picker">
          <div class="weather-location-search-row">
            <input type="search" class="settings-text-input weather-location-search" placeholder="City or postcode" value="" autocomplete="off" />
            <button type="button" class="secondary-btn weather-location-search-btn">Search</button>
          </div>
          <div class="weather-location-selected settings-muted"></div>
          <div class="weather-location-results"></div>
        </div>
      </div>
      <div class="settings-row">
        <span>Forecast length</span>
        <select class="settings-select weather-days-select" data-cfg="days">${dayOptions}</select>
      </div>
      <div class="settings-row">
        <span>Units</span>
        <div class="board-fit-radios weather-option-radios">
          <label class="board-fit-label"><input type="radio" name="weatherUnits" data-cfg="units" value="metric" ${_normalizeWeatherUnits(c.units) === 'metric' ? 'checked' : ''}/><span>Metric</span></label>
          <label class="board-fit-label"><input type="radio" name="weatherUnits" data-cfg="units" value="imperial" ${_normalizeWeatherUnits(c.units) === 'imperial' ? 'checked' : ''}/><span>Imperial</span></label>
        </div>
      </div>
      <div class="settings-row">
        <span>Forecast display</span>
        <div class="board-fit-radios weather-option-radios">
          <label class="board-fit-label"><input type="radio" name="weatherLayout" data-cfg="forecastLayout" value="vertical" ${_normalizeWeatherLayout(c.forecastLayout) === 'vertical' ? 'checked' : ''}/><span>Vertical</span></label>
          <label class="board-fit-label"><input type="radio" name="weatherLayout" data-cfg="forecastLayout" value="horizontal" ${_normalizeWeatherLayout(c.forecastLayout) === 'horizontal' ? 'checked' : ''}/><span>Horizontal</span></label>
        </div>
      </div>
      <div class="settings-row">
        <span>24-hour forecast</span>
        <label class="settings-toggle"><input type="checkbox" data-cfg="showHourly24" ${c.showHourly24 ? 'checked' : ''}/><span class="toggle-track"></span></label>
      </div>`;

    const input = container.querySelector('.weather-location-search');
    const searchBtn = container.querySelector('.weather-location-search-btn');
    const selected = container.querySelector('.weather-location-selected');
    const results = container.querySelector('.weather-location-results');
    selected.textContent = c.locationName ? `Selected: ${c.locationName}` : 'No location selected.';

    const showSearchMessage = (message, isError = false) => {
      results.innerHTML = '';
      const row = document.createElement('div');
      row.className = `weather-location-message${isError ? ' is-error' : ''}`;
      row.textContent = message;
      results.appendChild(row);
    };

    const runSearch = async () => {
      const query = input.value.trim();
      if (query.length < 2) {
        showSearchMessage('Enter at least two characters.', true);
        return;
      }
      searchBtn.disabled = true;
      showSearchMessage('Searching...');
      try {
        const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
        url.searchParams.set('name', query);
        url.searchParams.set('count', '6');
        url.searchParams.set('language', (navigator.language || 'en').split('-')[0]);
        url.searchParams.set('format', 'json');
        const response = await fetch(url, { signal: _wstgAbort?.signal });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.reason || `Location search returned ${response.status}`);
        const locations = Array.isArray(payload?.results) ? payload.results : [];
        results.innerHTML = '';
        if (!locations.length) {
          showSearchMessage('No matching locations found.');
          return;
        }
        locations.forEach(location => {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'weather-location-result';
          const parts = [location.name, location.admin1, location.country].filter(Boolean);
          button.textContent = [...new Set(parts)].join(', ');
          button.addEventListener('click', () => {
            widget.config.locationName = button.textContent;
            widget.config.latitude = location.latitude;
            widget.config.longitude = location.longitude;
            widget.config.timezone = location.timezone || 'auto';
            selected.textContent = `Selected: ${button.textContent}`;
            results.innerHTML = '';
          });
          results.appendChild(button);
        });
      } catch (error) {
        if (error?.name !== 'AbortError') showSearchMessage(error?.message || 'Location search failed.', true);
      } finally {
        searchBtn.disabled = false;
      }
    };

    searchBtn.addEventListener('click', runSearch);
    input.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      runSearch();
    });
  }
};

// ---- Weather Map widget ----

WIDGET_REGISTRY['weatherMap'] = {
  name: 'Weather Map',
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
      if (instance.playTimer) clearInterval(instance.playTimer);
      instance.playTimer = 0;
      playButton.classList.toggle('active', playing);
      playButton.textContent = playing ? '❚❚' : '▶';
      playButton.title = playing ? 'Pause forecast' : 'Play forecast';
      playButton.setAttribute('aria-label', playButton.title);
      playButton.setAttribute('aria-pressed', String(playing));
      if (!playing || !cache) return;
      instance.playTimer = setInterval(() => {
        if (document.hidden) return;
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
      requestAnimationFrame(() => {
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
    requestAnimationFrame(() => {
      if (!settingsSignal?.aborted) updatePreview();
    });

    const showSearchMessage = (message, isError = false) => {
      results.innerHTML = '';
      const row = document.createElement('div');
      row.className = `weather-location-message${isError ? ' is-error' : ''}`;
      row.textContent = message;
      results.appendChild(row);
    };

    const runSearch = async () => {
      const query = input.value.trim();
      if (query.length < 2) {
        showSearchMessage('Enter at least two characters.', true);
        return;
      }
      searchBtn.disabled = true;
      showSearchMessage('Searching...');
      try {
        const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
        url.searchParams.set('name', query);
        url.searchParams.set('count', '6');
        url.searchParams.set('language', (navigator.language || 'en').split('-')[0]);
        url.searchParams.set('format', 'json');
        const response = await fetch(url, { signal: _wstgAbort?.signal });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.reason || `Location search returned ${response.status}`);
        const locations = Array.isArray(payload?.results) ? payload.results : [];
        results.innerHTML = '';
        if (!locations.length) {
          showSearchMessage('No matching locations found.');
          return;
        }
        locations.forEach(result => {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'weather-location-result';
          const parts = [result.name, result.admin1, result.country].filter(Boolean);
          button.textContent = [...new Set(parts)].join(', ');
          button.addEventListener('click', () => {
            widget.config.locationName = button.textContent;
            widget.config.latitude = result.latitude;
            widget.config.longitude = result.longitude;
            widget.config.timezone = result.timezone || 'auto';
            selected.textContent = `Origin: ${button.textContent}`;
            results.innerHTML = '';
            updatePreview();
          });
          results.appendChild(button);
        });
      } catch (error) {
        if (error?.name !== 'AbortError') showSearchMessage(error?.message || 'Location search failed.', true);
      } finally {
        searchBtn.disabled = false;
      }
    };

    searchBtn.addEventListener('click', runSearch);
    input.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      runSearch();
    });
  }
};

// ---- ISS Tracker widget ----

WIDGET_REGISTRY['issTracker'] = {
  name: 'ISS Tracker',
  description: 'Live ISS position, orbital ground track and Earth day/night boundary on an interactive globe',
  allowedIn: ['column'],
  defaultConfig: { mapStyle: 'dark', showNightShade: true },
  defaultData: {},
  liveSettingsPreview: false,
  reloadLabel: 'Refresh ISS orbital data',

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

// ---- Astronomy / Night Sky widget ----

const ASTRONOMY_PLANETS = [
  ['Mercury', '☿'],
  ['Venus', '♀'],
  ['Mars', '♂'],
  ['Jupiter', '♃'],
  ['Saturn', '♄']
];
const ASTRONOMY_MOON_PHASES = [
  'New Moon', 'Waxing Crescent', 'First Quarter', 'Waxing Gibbous',
  'Full Moon', 'Waning Gibbous', 'Last Quarter', 'Waning Crescent'
];
const ASTRONOMY_QUARTER_NAMES = ['New Moon', 'First Quarter', 'Full Moon', 'Last Quarter'];

function _astronomyCoordinates(config) {
  if (!config || config.latitude === '' || config.longitude === '') return null;
  const latitude = Number(config.latitude);
  const longitude = Number(config.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
      || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return {
    latitude,
    longitude,
    locationName: String(config.locationName || '').trim(),
    timezone: config.timezone && config.timezone !== 'auto' ? config.timezone : ''
  };
}

function _findWeatherWidgetLocation(excludeWidgetId = '') {
  if (typeof state === 'undefined' || !state) return null;
  const visited = new Set();
  const walk = value => {
    if (!value || typeof value !== 'object' || visited.has(value)) return null;
    visited.add(value);
    if (value.id !== excludeWidgetId && value.type === 'widget'
        && (value.widgetType === 'weather' || value.widgetType === 'weatherMap')) {
      const location = _astronomyCoordinates(value.config);
      if (location) return location;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        const match = walk(item);
        if (match) return match;
      }
      return null;
    }
    for (const [key, child] of Object.entries(value)) {
      if (key === 'data' || key === 'settings') continue;
      const match = walk(child);
      if (match) return match;
    }
    return null;
  };
  return walk(state.boards || []);
}

function _astronomyLocation(widget) {
  const config = widget?.config || {};
  if (config.useWeatherLocation !== false) {
    const weatherLocation = _findWeatherWidgetLocation(widget?.id || '');
    if (weatherLocation) return { ...weatherLocation, inherited: true };
  }
  const configured = _astronomyCoordinates(config);
  return configured ? { ...configured, inherited: false } : null;
}

function _normalizeAstronomyEventDays(value) {
  const parsed = Number.parseInt(value, 10);
  return [30, 90, 180, 365].includes(parsed) ? parsed : 90;
}

function _astronomyTimeZone(location) {
  return location?.timezone || undefined;
}

function _astronomyFormatTime(value, location) {
  const date = value?.date instanceof Date ? value.date : value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: _astronomyTimeZone(location), hour: '2-digit', minute: '2-digit'
    }).format(date);
  } catch {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
}

function _astronomyFormatDate(value, location, includeTime = false) {
  const date = value?.date instanceof Date ? value.date : value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  const options = { timeZone: _astronomyTimeZone(location), month: 'short', day: 'numeric' };
  if (includeTime) Object.assign(options, { hour: '2-digit', minute: '2-digit' });
  try { return new Intl.DateTimeFormat(undefined, options).format(date); }
  catch { return date.toLocaleDateString(undefined, options); }
}

function _astronomyPhaseName(angle) {
  return ASTRONOMY_MOON_PHASES[Math.round(Number(angle || 0) / 45) % 8];
}

function _astronomyDirection(azimuth) {
  const labels = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return labels[Math.round((((Number(azimuth) % 360) + 360) % 360) / 45) % 8];
}

function _astronomyHorizontal(A, body, date, observer) {
  const equatorial = A.Equator(body, date, observer, true, true);
  return A.Horizon(date, observer, equatorial.ra, equatorial.dec, 'normal');
}

function _astronomyMoonPath(phaseAngle) {
  const angle = ((Number(phaseAngle) % 360) + 360) % 360;
  const waxing = angle <= 180;
  const radians = angle * Math.PI / 180;
  const points = [];
  const steps = 48;
  for (let index = 0; index <= steps; index += 1) {
    const y = -1 + (2 * index / steps);
    const edge = Math.sqrt(Math.max(0, 1 - y * y));
    const x = waxing ? edge : -edge;
    points.push([x, y]);
  }
  for (let index = steps; index >= 0; index -= 1) {
    const y = -1 + (2 * index / steps);
    const edge = Math.sqrt(Math.max(0, 1 - y * y));
    const x = waxing ? Math.cos(radians) * edge : -Math.cos(radians) * edge;
    points.push([x, y]);
  }
  return points.map(([x, y], index) => `${index ? 'L' : 'M'} ${(50 + x * 48).toFixed(2)} ${(50 + y * 48).toFixed(2)}`).join(' ') + ' Z';
}

function _createAstronomyMoonDisc(widget, phaseAngle, phaseName) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.classList.add('widget-astronomy-moon-disc');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', phaseName);
  const defs = document.createElementNS(ns, 'defs');
  const clip = document.createElementNS(ns, 'clipPath');
  const clipId = `astronomy-moon-${String(widget.id).replace(/[^a-z0-9_-]/gi, '')}`;
  clip.id = clipId;
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', _astronomyMoonPath(phaseAngle));
  clip.appendChild(path);
  defs.appendChild(clip);
  const darkImage = document.createElementNS(ns, 'image');
  darkImage.setAttribute('href', 'assets/astronomy/nasa-lro-moon-mosaic.png');
  darkImage.setAttribute('x', '2');
  darkImage.setAttribute('y', '2');
  darkImage.setAttribute('width', '96');
  darkImage.setAttribute('height', '96');
  darkImage.setAttribute('preserveAspectRatio', 'xMidYMid slice');
  darkImage.classList.add('widget-astronomy-moon-dark');
  const brightImage = darkImage.cloneNode(false);
  brightImage.classList.remove('widget-astronomy-moon-dark');
  brightImage.classList.add('widget-astronomy-moon-lit');
  brightImage.setAttribute('clip-path', `url(#${clipId})`);
  const rim = document.createElementNS(ns, 'circle');
  rim.setAttribute('cx', '50');
  rim.setAttribute('cy', '50');
  rim.setAttribute('r', '48');
  rim.classList.add('widget-astronomy-moon-rim');
  svg.append(defs, darkImage, brightImage, rim);
  return svg;
}

function _astronomyDarkWindow(A, observer, now) {
  const sunNow = _astronomyHorizontal(A, A.Body.Sun, now, observer);
  let start;
  if (sunNow.altitude <= -12) {
    start = new Date(now);
  } else {
    start = A.SearchAltitude(A.Body.Sun, observer, -1, now, 2, -12)?.date || new Date(now);
  }
  const dawnSearch = new Date(start.getTime() + 60 * 1000);
  let end = A.SearchAltitude(A.Body.Sun, observer, 1, dawnSearch, 2, -12)?.date;
  if (!end || end <= start) end = new Date(start.getTime() + 12 * 60 * 60 * 1000);
  return { start, end, isDarkNow: sunNow.altitude <= -12 };
}

function _astronomyVisiblePlanets(A, observer, now, darkWindow) {
  const results = [];
  const stepMs = 30 * 60 * 1000;
  for (const [name, symbol] of ASTRONOMY_PLANETS) {
    const body = A.Body[name];
    let best = null;
    for (let time = darkWindow.start.getTime(); time <= darkWindow.end.getTime(); time += stepMs) {
      const date = new Date(time);
      const horizontal = _astronomyHorizontal(A, body, date, observer);
      if (!best || horizontal.altitude > best.altitude) best = { date, ...horizontal };
    }
    if (!best || best.altitude < 3) continue;
    const currentHorizontal = _astronomyHorizontal(A, body, now, observer);
    const magnitude = A.Illumination(body, best.date).mag;
    results.push({
      name,
      symbol,
      bestTime: best.date,
      altitude: best.altitude,
      direction: _astronomyDirection(best.azimuth),
      magnitude,
      visibleNow: darkWindow.isDarkNow && currentHorizontal.altitude >= 3
    });
  }
  return results.sort((a, b) => Number(b.visibleNow) - Number(a.visibleNow) || a.bestTime - b.bestTime);
}

function _astronomyMeteorPeriod(shower, peakYear) {
  const [peakMonth, peakDay] = shower.peak;
  const [startMonth, startDay] = shower.start;
  const [endMonth, endDay] = shower.end;
  const startYear = startMonth > peakMonth ? peakYear - 1 : peakYear;
  const endYear = endMonth < peakMonth ? peakYear + 1 : peakYear;
  return {
    start: new Date(Date.UTC(startYear, startMonth - 1, startDay, 12)),
    peak: new Date(Date.UTC(peakYear, peakMonth - 1, peakDay, 12)),
    end: new Date(Date.UTC(endYear, endMonth - 1, endDay, 12))
  };
}

function _astronomyMeteorShowers(A, now, eventDays) {
  const showers = globalThis.ASTRONOMY_EVENT_CATALOG?.meteorShowers || [];
  const horizon = new Date(now.getTime() + eventDays * 86400000);
  const matches = [];
  for (const shower of showers) {
    for (let year = now.getUTCFullYear() - 1; year <= now.getUTCFullYear() + 1; year += 1) {
      const period = _astronomyMeteorPeriod(shower, year);
      const active = now >= period.start && now <= period.end;
      if (!active && (period.peak < now || period.peak > horizon)) continue;
      const moonlight = Math.round(A.Illumination(A.Body.Moon, period.peak).phase_fraction * 100);
      matches.push({ ...shower, ...period, active, moonlight });
    }
  }
  const unique = [...new Map(matches.map(item => [`${item.id}:${item.peak.getUTCFullYear()}`, item])).values()];
  return unique.sort((a, b) => Number(b.active) - Number(a.active) || a.peak - b.peak).slice(0, 3);
}

function _astronomyUpcomingEvents(A, observer, now, location, eventDays) {
  const horizon = new Date(now.getTime() + eventDays * 86400000);
  const events = [];
  const add = (date, title, detail, type = 'event') => {
    const parsed = date?.date instanceof Date ? date.date : date instanceof Date ? date : new Date(date);
    if (Number.isFinite(parsed.getTime()) && parsed >= now && parsed <= horizon) events.push({ date: parsed, title, detail, type });
  };

  for (const year of [now.getUTCFullYear(), now.getUTCFullYear() + 1]) {
    const seasons = A.Seasons(year);
    add(seasons.mar_equinox, 'March equinox', 'Equal-length day and night');
    add(seasons.jun_solstice, 'June solstice', 'Seasonal turning point');
    add(seasons.sep_equinox, 'September equinox', 'Equal-length day and night');
    add(seasons.dec_solstice, 'December solstice', 'Seasonal turning point');
  }

  const solarEclipse = A.SearchLocalSolarEclipse(now, observer);
  if (solarEclipse?.peak?.time && Number(solarEclipse.peak.altitude) > -1) {
    add(solarEclipse.peak.time, `${solarEclipse.kind[0].toUpperCase()}${solarEclipse.kind.slice(1)} solar eclipse`,
      `${Math.round(Number(solarEclipse.obscuration || 0) * 100)}% obscuration · ${Math.round(solarEclipse.peak.altitude)}° high`, 'eclipse');
  }
  const lunarEclipse = A.SearchLunarEclipse(now);
  if (lunarEclipse?.peak) {
    const lunarAltitude = _astronomyHorizontal(A, A.Body.Moon, lunarEclipse.peak.date, observer).altitude;
    add(lunarEclipse.peak, `${lunarEclipse.kind[0].toUpperCase()}${lunarEclipse.kind.slice(1)} lunar eclipse`,
      lunarAltitude > 0 ? `${Math.round(lunarAltitude)}° above the local horizon at peak` : 'Moon below the local horizon at peak', 'eclipse');
  }

  for (const name of ['Mercury', 'Venus']) {
    const elongation = A.SearchMaxElongation(A.Body[name], now);
    add(elongation?.time, `${name} at greatest elongation`,
      `${Math.round(elongation?.elongation || 0)}° from the Sun · ${elongation?.visibility || ''} sky`, 'planet');
  }
  for (const name of ['Mars', 'Jupiter', 'Saturn']) {
    const opposition = A.SearchRelativeLongitude(A.Body[name], 0, now);
    add(opposition, `${name} at opposition`, 'Bright and visible for most of the night', 'planet');
  }

  for (const approach of (globalThis.ASTRONOMY_EVENT_CATALOG?.closeApproaches || [])) {
    const distanceMillionKm = Number(approach.distanceAu) * 149.5978707;
    add(approach.date, `${approach.name} close approach`,
      `${distanceMillionKm.toFixed(1)} million km from Earth · proximity does not guarantee naked-eye visibility`, 'comet');
  }

  return events.sort((a, b) => a.date - b.date).slice(0, 10);
}

function _astronomySnapshot(widget, now = new Date()) {
  const location = _astronomyLocation(widget);
  if (!location || typeof Astronomy === 'undefined') return null;
  const eventDays = _normalizeAstronomyEventDays(widget.config?.eventDays);
  const hourKey = Math.floor(now.getTime() / 3600000);
  const signature = `${location.latitude.toFixed(5)}:${location.longitude.toFixed(5)}:${location.timezone}:${eventDays}:${hourKey}`;
  const cached = _astronomyRuntime.get(widget.id);
  if (cached?.signature === signature && cached.snapshot) return cached.snapshot;

  const A = Astronomy;
  const observer = new A.Observer(location.latitude, location.longitude, 0);
  const phaseAngle = A.MoonPhase(now);
  const illumination = A.Illumination(A.Body.Moon, now);
  const darkWindow = _astronomyDarkWindow(A, observer, now);
  const nextQuarter = A.SearchMoonQuarter(now);
  const snapshot = {
    generatedAt: now,
    location,
    phaseAngle,
    phaseName: _astronomyPhaseName(phaseAngle),
    illumination: Math.round(illumination.phase_fraction * 100),
    moonAge: phaseAngle / 360 * 29.530588,
    moonDistanceKm: illumination.geo_dist * A.KM_PER_AU,
    moonRise: A.SearchRiseSet(A.Body.Moon, observer, 1, now, 2),
    moonSet: A.SearchRiseSet(A.Body.Moon, observer, -1, now, 2),
    nextMoonPhase: nextQuarter ? { name: ASTRONOMY_QUARTER_NAMES[nextQuarter.quarter], date: nextQuarter.time.date } : null,
    sunrise: A.SearchRiseSet(A.Body.Sun, observer, 1, now, 2),
    sunset: A.SearchRiseSet(A.Body.Sun, observer, -1, now, 2),
    nightStart: darkWindow.isDarkNow ? now : darkWindow.start,
    nightEnd: darkWindow.end,
    isDarkNow: darkWindow.isDarkNow,
    planets: _astronomyVisiblePlanets(A, observer, now, darkWindow),
    meteors: _astronomyMeteorShowers(A, now, eventDays),
    events: _astronomyUpcomingEvents(A, observer, now, location, eventDays)
  };
  _astronomyRuntime.set(widget.id, { signature, snapshot, hourKey });
  return snapshot;
}

function _astronomyAppendFact(parent, label, value) {
  const fact = document.createElement('div');
  fact.className = 'widget-astronomy-fact';
  const labelEl = document.createElement('span');
  labelEl.className = 'widget-astronomy-fact-label';
  labelEl.textContent = label;
  const valueEl = document.createElement('strong');
  valueEl.textContent = value;
  fact.append(labelEl, valueEl);
  parent.appendChild(fact);
}

function _astronomyChronologicalDaylight(snapshot) {
  const entries = [
    { label: 'Sunrise', value: snapshot.sunrise },
    { label: 'Sunset', value: snapshot.sunset },
    { label: snapshot.isDarkNow ? 'Dark now' : 'Dark sky', value: snapshot.nightStart },
    { label: 'Dawn', value: snapshot.nightEnd }
  ];
  const dateOf = entry => entry.value?.date instanceof Date ? entry.value.date : entry.value;
  return entries
    .filter(entry => Number.isFinite(dateOf(entry)?.getTime?.()))
    .sort((left, right) => dateOf(left) - dateOf(right));
}

function _astronomySection(title) {
  const section = document.createElement('section');
  section.className = 'widget-astronomy-section';
  const heading = document.createElement('div');
  heading.className = 'widget-astronomy-section-title';
  heading.textContent = title;
  section.appendChild(heading);
  return section;
}

WIDGET_REGISTRY['astronomy'] = {
  name: 'Astronomy & Night Sky',
  description: 'Moon phase, twilight, visible planets, meteor showers and upcoming sky events',
  allowedIn: ['column'],
  defaultConfig: {
    useWeatherLocation: true,
    locationName: '',
    latitude: '',
    longitude: '',
    timezone: 'auto',
    eventDays: 90,
    showPlanets: true,
    showMeteorShowers: true,
    showEvents: true
  },
  defaultData: {},
  liveSettingsPreview: false,

  onSettingsCommit(widget) {
    _astronomyRuntime.delete(widget.id);
  },

  reload(widget) {
    _astronomyRuntime.delete(widget.id);
    return Promise.resolve();
  },

  render(widget, el, context) {
    _setWidgetRefresher(widget.id, context, () => {
      if (!el.isConnected) {
        _widgetRefreshers.delete(`${widget.id}:${context}`);
        return;
      }
      el.innerHTML = '';
      WIDGET_REGISTRY.astronomy.render(widget, el, context);
    });
    el.className = 'widget-astronomy';

    const location = _astronomyLocation(widget);
    if (!location) {
      const placeholder = document.createElement('div');
      placeholder.className = 'widget-weather-placeholder';
      placeholder.textContent = widget.config?.useWeatherLocation !== false
        ? 'Add a configured Weather widget, or choose a separate sky location in this widget’s settings.'
        : 'Choose a sky location in the widget settings.';
      el.appendChild(placeholder);
      return;
    }
    if (typeof Astronomy === 'undefined') {
      const placeholder = document.createElement('div');
      placeholder.className = 'widget-weather-placeholder is-error';
      placeholder.textContent = 'Astronomy Engine failed to load.';
      el.appendChild(placeholder);
      return;
    }

    let snapshot;
    try {
      snapshot = _astronomySnapshot(widget);
    } catch (error) {
      const placeholder = document.createElement('div');
      placeholder.className = 'widget-weather-placeholder is-error';
      placeholder.textContent = error?.message || 'Unable to calculate sky conditions.';
      el.appendChild(placeholder);
      return;
    }
    const renderedHour = Math.floor(snapshot.generatedAt.getTime() / 3600000);
    _setWidgetTimer(widget.id, context, () => {
      if (Math.floor(Date.now() / 3600000) === renderedHour) return;
      _astronomyRuntime.delete(widget.id);
      _refreshWidget(widget.id, context);
    }, 60 * 1000);

    const locationLine = document.createElement('div');
    locationLine.className = 'widget-astronomy-location';
    locationLine.textContent = location.locationName || `${location.latitude.toFixed(3)}, ${location.longitude.toFixed(3)}`;
    if (location.inherited) locationLine.title = 'Using the first configured Weather widget location';
    el.appendChild(locationLine);

    const moon = document.createElement('section');
    moon.className = 'widget-astronomy-moon';
    moon.appendChild(_createAstronomyMoonDisc(widget, snapshot.phaseAngle, snapshot.phaseName));
    const moonDetails = document.createElement('div');
    moonDetails.className = 'widget-astronomy-moon-details';
    const moonName = document.createElement('strong');
    moonName.className = 'widget-astronomy-moon-name';
    moonName.textContent = snapshot.phaseName;
    const moonSummary = document.createElement('div');
    moonSummary.className = 'widget-astronomy-moon-summary';
    moonSummary.textContent = `${snapshot.illumination}% illuminated · ${snapshot.moonAge.toFixed(1)} days old`;
    const moonTimes = document.createElement('div');
    moonTimes.className = 'widget-astronomy-moon-times';
    moonTimes.textContent = `Rise ${_astronomyFormatTime(snapshot.moonRise, location)} · Set ${_astronomyFormatTime(snapshot.moonSet, location)}`;
    const nextPhase = document.createElement('div');
    nextPhase.className = 'widget-astronomy-next-phase';
    nextPhase.textContent = snapshot.nextMoonPhase
      ? `Next: ${snapshot.nextMoonPhase.name} · ${_astronomyFormatDate(snapshot.nextMoonPhase.date, location, true)}`
      : 'Next primary phase unavailable';
    moonDetails.append(moonName, moonSummary, moonTimes, nextPhase);
    moon.appendChild(moonDetails);
    el.appendChild(moon);

    const daylight = document.createElement('div');
    daylight.className = 'widget-astronomy-daylight';
    _astronomyChronologicalDaylight(snapshot).forEach(entry => {
      _astronomyAppendFact(daylight, entry.label, _astronomyFormatDate(entry.value, location, true));
    });
    el.appendChild(daylight);

    if (widget.config?.showPlanets !== false) {
      const section = _astronomySection('Visible planets tonight');
      const grid = document.createElement('div');
      grid.className = 'widget-astronomy-planets';
      if (!snapshot.planets.length) {
        const empty = document.createElement('div');
        empty.className = 'widget-astronomy-empty';
        empty.textContent = 'No naked-eye planets rise above the local horizon during dark-sky hours.';
        grid.appendChild(empty);
      }
      snapshot.planets.forEach(planet => {
        const card = document.createElement('div');
        card.className = `widget-astronomy-planet${planet.visibleNow ? ' is-visible-now' : ''}`;
        const symbol = document.createElement('span');
        symbol.className = 'widget-astronomy-planet-symbol';
        symbol.textContent = planet.symbol;
        const details = document.createElement('span');
        details.className = 'widget-astronomy-planet-details';
        const title = document.createElement('strong');
        title.textContent = planet.name;
        const meta = document.createElement('span');
        meta.textContent = `${planet.visibleNow ? 'Visible now' : `Best ${_astronomyFormatTime(planet.bestTime, location)}`} · ${planet.direction} · ${Math.round(planet.altitude)}° high · mag ${planet.magnitude.toFixed(1)}`;
        details.append(title, meta);
        card.append(symbol, details);
        grid.appendChild(card);
      });
      section.appendChild(grid);
      el.appendChild(section);
    }

    if (widget.config?.showMeteorShowers !== false) {
      const section = _astronomySection('Meteor showers');
      const list = document.createElement('div');
      list.className = 'widget-astronomy-list';
      if (!snapshot.meteors.length) {
        const empty = document.createElement('div');
        empty.className = 'widget-astronomy-empty';
        empty.textContent = `No major shower peaks in the next ${_normalizeAstronomyEventDays(widget.config?.eventDays)} days.`;
        list.appendChild(empty);
      }
      snapshot.meteors.forEach(shower => {
        const row = document.createElement('div');
        row.className = 'widget-astronomy-list-row';
        const main = document.createElement('div');
        main.className = 'widget-astronomy-list-main';
        const title = document.createElement('strong');
        title.textContent = shower.name;
        if (shower.active) {
          const badge = document.createElement('span');
          badge.className = 'widget-astronomy-active-badge';
          badge.textContent = 'Active';
          title.appendChild(badge);
        }
        const detail = document.createElement('span');
        detail.textContent = `Peak ${_astronomyFormatDate(shower.peak, location)} · up to ${shower.zhr}/hr · ${shower.radiant} · ${shower.moonlight}% Moon`;
        main.append(title, detail);
        row.appendChild(main);
        list.appendChild(row);
      });
      section.appendChild(list);
      el.appendChild(section);
    }

    if (widget.config?.showEvents !== false) {
      const section = _astronomySection(`Upcoming · ${_normalizeAstronomyEventDays(widget.config?.eventDays)} days`);
      const list = document.createElement('div');
      list.className = 'widget-astronomy-events';
      if (!snapshot.events.length) {
        const empty = document.createElement('div');
        empty.className = 'widget-astronomy-empty';
        empty.textContent = 'No selected major events in this period.';
        list.appendChild(empty);
      }
      snapshot.events.forEach(event => {
        const row = document.createElement('div');
        row.className = `widget-astronomy-event is-${event.type}`;
        const date = document.createElement('time');
        date.dateTime = event.date.toISOString();
        date.textContent = _astronomyFormatDate(event.date, location);
        const details = document.createElement('span');
        const title = document.createElement('strong');
        title.textContent = event.title;
        const meta = document.createElement('span');
        meta.textContent = event.detail;
        details.append(title, meta);
        row.append(date, details);
        list.appendChild(row);
      });
      section.appendChild(list);
      el.appendChild(section);
    }

    const attribution = document.createElement('div');
    attribution.className = 'widget-astronomy-attribution';
    attribution.innerHTML = '<a href="https://github.com/cosinekitty/astronomy" target="_blank" rel="noreferrer noopener">Astronomy Engine</a> · <a href="https://www.imo.net/resources/calendar/" target="_blank" rel="noreferrer noopener">IMO showers</a> · <a href="https://science.nasa.gov/resource/moon-mosaic/" target="_blank" rel="noreferrer noopener">NASA/LRO Moon</a> · JPL comet snapshot';
    attribution.addEventListener('mousedown', event => event.stopPropagation());
    el.appendChild(attribution);
  },

  renderSettings(widget, container) {
    const c = widget.config || {};
    const weatherLocation = _findWeatherWidgetLocation(widget.id);
    const useWeather = c.useWeatherLocation !== false;
    container.innerHTML = `
      <div class="settings-row settings-row--top">
        <span>Use Weather location</span>
        <label class="settings-toggle"><input type="checkbox" data-cfg="useWeatherLocation" ${useWeather ? 'checked' : ''}/><span class="toggle-track"></span></label>
      </div>
      <div class="astronomy-weather-location settings-muted"></div>
      <div class="settings-row astronomy-own-location-row ${useWeather ? 'is-disabled' : ''}">
        <span>Separate location</span>
        <div class="weather-location-picker">
          <div class="weather-location-search-row">
            <input type="search" class="settings-text-input astronomy-location-search" placeholder="City or postcode" autocomplete="off" ${useWeather ? 'disabled' : ''}/>
            <button type="button" class="secondary-btn astronomy-location-search-btn" ${useWeather ? 'disabled' : ''}>Search</button>
          </div>
          <div class="astronomy-location-selected settings-muted"></div>
          <div class="astronomy-location-results weather-location-results"></div>
        </div>
      </div>
      <div class="settings-row">
        <span>Upcoming events</span>
        <select class="settings-select" data-cfg="eventDays">
          ${[30, 90, 180, 365].map(days => `<option value="${days}" ${_normalizeAstronomyEventDays(c.eventDays) === days ? 'selected' : ''}>Next ${days} days</option>`).join('')}
        </select>
      </div>
      <div class="settings-row"><span>Visible planets</span><label class="settings-toggle"><input type="checkbox" data-cfg="showPlanets" ${c.showPlanets !== false ? 'checked' : ''}/><span class="toggle-track"></span></label></div>
      <div class="settings-row"><span>Meteor showers</span><label class="settings-toggle"><input type="checkbox" data-cfg="showMeteorShowers" ${c.showMeteorShowers !== false ? 'checked' : ''}/><span class="toggle-track"></span></label></div>
      <div class="settings-row"><span>Upcoming events list</span><label class="settings-toggle"><input type="checkbox" data-cfg="showEvents" ${c.showEvents !== false ? 'checked' : ''}/><span class="toggle-track"></span></label></div>`;

    const useWeatherInput = container.querySelector('[data-cfg="useWeatherLocation"]');
    const weatherLocationStatus = container.querySelector('.astronomy-weather-location');
    const ownLocationRow = container.querySelector('.astronomy-own-location-row');
    const input = container.querySelector('.astronomy-location-search');
    const searchBtn = container.querySelector('.astronomy-location-search-btn');
    const selected = container.querySelector('.astronomy-location-selected');
    const results = container.querySelector('.astronomy-location-results');
    weatherLocationStatus.textContent = weatherLocation
      ? `Available: ${weatherLocation.locationName || `${weatherLocation.latitude.toFixed(3)}, ${weatherLocation.longitude.toFixed(3)}`}`
      : 'No configured Weather widget found.';
    selected.textContent = c.locationName ? `Selected: ${c.locationName}` : 'No separate location selected.';

    useWeatherInput.addEventListener('change', () => {
      const disabled = useWeatherInput.checked;
      ownLocationRow.classList.toggle('is-disabled', disabled);
      input.disabled = disabled;
      searchBtn.disabled = disabled;
      if (disabled) results.innerHTML = '';
    });

    const showMessage = (message, isError = false) => {
      results.innerHTML = '';
      const row = document.createElement('div');
      row.className = `weather-location-message${isError ? ' is-error' : ''}`;
      row.textContent = message;
      results.appendChild(row);
    };
    const runSearch = async () => {
      const query = input.value.trim();
      if (query.length < 2) return showMessage('Enter at least two characters.', true);
      searchBtn.disabled = true;
      showMessage('Searching...');
      try {
        const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
        url.searchParams.set('name', query);
        url.searchParams.set('count', '6');
        url.searchParams.set('language', (navigator.language || 'en').split('-')[0]);
        url.searchParams.set('format', 'json');
        const response = await fetch(url, { signal: _wstgAbort?.signal });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.reason || `Location search returned ${response.status}`);
        const locations = Array.isArray(payload?.results) ? payload.results : [];
        results.innerHTML = '';
        if (!locations.length) return showMessage('No matching locations found.');
        locations.forEach(result => {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'weather-location-result';
          const parts = [result.name, result.admin1, result.country].filter(Boolean);
          button.textContent = [...new Set(parts)].join(', ');
          button.addEventListener('click', () => {
            widget.config.locationName = button.textContent;
            widget.config.latitude = result.latitude;
            widget.config.longitude = result.longitude;
            widget.config.timezone = result.timezone || 'auto';
            selected.textContent = `Selected: ${button.textContent}`;
            results.innerHTML = '';
          });
          results.appendChild(button);
        });
      } catch (error) {
        if (error?.name !== 'AbortError') showMessage(error?.message || 'Location search failed.', true);
      } finally {
        searchBtn.disabled = useWeatherInput.checked;
      }
    };
    searchBtn.addEventListener('click', runSearch);
    input.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      runSearch();
    });
  }
};

// ---- RSS Reader widget ----

function _rssNewFeedId() {
  return `rss-feed-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function _rssFeedConfigs(widget) {
  widget.config = widget.config || {};
  if (!Array.isArray(widget.config.feeds)) widget.config.feeds = [];
  const seen = new Set();
  widget.config.feeds = widget.config.feeds.slice(0, RSS_MAX_FEEDS).map(feed => {
    const normalized = feed && typeof feed === 'object' ? feed : {};
    let id = String(normalized.id || '').trim();
    if (!id || seen.has(id)) id = _rssNewFeedId();
    seen.add(id);
    return {
      id,
      name: String(normalized.name || '').trim(),
      url: String(normalized.url || '').trim()
    };
  });
  return widget.config.feeds;
}

function _normalizeRssArticleLimit(value) {
  const parsed = Number.parseInt(value, 10);
  return [10, 20, 40, 80].includes(parsed) ? parsed : 20;
}

function _normalizeRssRefreshMinutes(value) {
  const parsed = Number.parseInt(value, 10);
  return [15, 30, 60, 180].includes(parsed) ? parsed : 30;
}

function _normalizeRssLayout(value) {
  return value === 'expanded' ? 'expanded' : 'compact';
}

function _rssValidUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return /^https?:$/.test(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
}

function _rssCacheKey(widgetId) {
  return `${RSS_CACHE_PREFIX}${widgetId}`;
}

function _readRssCache(widgetId) {
  if (_rssMemoryCache.has(widgetId)) return _rssMemoryCache.get(widgetId);
  let cache = null;
  try { cache = JSON.parse(localStorage.getItem(_rssCacheKey(widgetId)) || 'null'); } catch { cache = null; }
  if (!cache || cache.schema !== RSS_CACHE_SCHEMA || typeof cache.feeds !== 'object') {
    cache = { schema: RSS_CACHE_SCHEMA, feeds: {} };
  }
  _rssMemoryCache.set(widgetId, cache);
  return cache;
}

function _writeRssCache(widgetId, cache) {
  const normalized = { schema: RSS_CACHE_SCHEMA, feeds: cache?.feeds || {} };
  _rssMemoryCache.set(widgetId, normalized);
  try { localStorage.setItem(_rssCacheKey(widgetId), JSON.stringify(normalized)); } catch {}
  return normalized;
}

function _rssViewKey(widgetId) {
  return `${RSS_VIEW_PREFIX}${widgetId}`;
}

function _readRssView(widgetId) {
  if (_rssViewMemory.has(widgetId)) return _rssViewMemory.get(widgetId);
  let view = null;
  try { view = JSON.parse(localStorage.getItem(_rssViewKey(widgetId)) || 'null'); } catch { view = null; }
  view = {
    activeFeedId: String(view?.activeFeedId || 'all'),
    search: String(view?.search || ''),
    readIds: Array.isArray(view?.readIds) ? view.readIds.slice(-2000) : [],
    starredIds: Array.isArray(view?.starredIds) ? view.starredIds.slice(-1000) : []
  };
  _rssViewMemory.set(widgetId, view);
  return view;
}

function _writeRssView(widgetId, updates = {}) {
  const current = _readRssView(widgetId);
  const view = {
    ...current,
    ...updates,
    readIds: Array.isArray(updates.readIds) ? [...new Set(updates.readIds)].slice(-2000) : current.readIds,
    starredIds: Array.isArray(updates.starredIds) ? [...new Set(updates.starredIds)].slice(-1000) : current.starredIds
  };
  _rssViewMemory.set(widgetId, view);
  try { localStorage.setItem(_rssViewKey(widgetId), JSON.stringify(view)); } catch {}
  return view;
}

function _getRssRuntime(widgetId) {
  let runtime = _rssRuntime.get(widgetId);
  if (!runtime) {
    runtime = { loading: new Set(), nextRetryAt: new Map() };
    _rssRuntime.set(widgetId, runtime);
  }
  return runtime;
}

function _rssHash(value) {
  let hash = 2166136261;
  const text = String(value || '');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function _rssElementsByLocalName(node, names) {
  const wanted = new Set(names.map(name => name.toLowerCase()));
  return Array.from(node?.getElementsByTagName?.('*') || [])
    .filter(element => wanted.has(String(element.localName || element.nodeName || '').toLowerCase()));
}

function _rssDirectChild(node, names) {
  const children = Array.from(node?.children || []);
  for (const name of names) {
    const match = children.find(element => String(element.localName || element.nodeName || '').toLowerCase() === name.toLowerCase());
    if (match) return match;
  }
  return null;
}

function _rssNodeText(node) {
  return String(node?.textContent || '').replace(/\s+/g, ' ').trim();
}

function _rssPlainText(value) {
  const html = String(value || '').trim();
  if (!html) return '';
  try {
    const documentFragment = new DOMParser().parseFromString(html, 'text/html');
    return String(documentFragment.body?.textContent || '').replace(/\s+/g, ' ').trim();
  } catch {
    return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }
}

function _rssResolveUrl(value, baseUrl) {
  try {
    const url = new URL(String(value || '').trim(), baseUrl);
    return /^https?:$/.test(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
}

function _rssEntryLink(node, baseUrl) {
  const links = Array.from(node?.children || []).filter(element => String(element.localName || '').toLowerCase() === 'link');
  const atomLink = links.find(element => !element.getAttribute('rel') || element.getAttribute('rel') === 'alternate')
    || links[0];
  return _rssResolveUrl(atomLink?.getAttribute?.('href') || _rssNodeText(atomLink), baseUrl);
}

function _rssEntryImage(node, rawContent, baseUrl) {
  const media = _rssElementsByLocalName(node, ['enclosure', 'thumbnail', 'content'])
    .find(element => {
      const url = element.getAttribute?.('url') || element.getAttribute?.('href');
      const type = String(element.getAttribute?.('type') || '');
      return url && (String(element.prefix || '').toLowerCase() === 'media'
        || /image/i.test(type)
        || String(element.localName || '').toLowerCase() === 'thumbnail');
    });
  const mediaUrl = _rssResolveUrl(media?.getAttribute?.('url') || media?.getAttribute?.('href'), baseUrl);
  if (mediaUrl) return mediaUrl;
  try {
    const fragment = new DOMParser().parseFromString(String(rawContent || ''), 'text/html');
    return _rssResolveUrl(fragment.querySelector('img')?.getAttribute('src'), baseUrl);
  } catch {
    return '';
  }
}

function _parseRssFeed(xmlText, feed, responseUrl = feed.url, fetchedAt = Date.now()) {
  const documentXml = new DOMParser().parseFromString(String(xmlText || ''), 'application/xml');
  if (documentXml.querySelector('parsererror')) throw new Error('Feed returned invalid XML.');
  const root = documentXml.documentElement;
  const rootName = String(root?.localName || '').toLowerCase();
  const isAtom = rootName === 'feed' || _rssElementsByLocalName(documentXml, ['entry']).length > 0;
  const itemNodes = _rssElementsByLocalName(documentXml, isAtom ? ['entry'] : ['item']);
  if (!['rss', 'rdf', 'feed'].includes(rootName) && !itemNodes.length) {
    throw new Error('The URL did not return an RSS or Atom feed.');
  }
  const channel = _rssElementsByLocalName(documentXml, ['channel'])[0] || root;
  const parsedTitle = _rssNodeText(_rssDirectChild(channel, ['title'])) || feed.name || 'Untitled feed';
  const items = itemNodes.map((node, index) => {
    const title = _rssNodeText(_rssDirectChild(node, ['title'])) || 'Untitled article';
    const link = _rssEntryLink(node, responseUrl);
    const guid = _rssNodeText(_rssDirectChild(node, ['guid', 'id'])) || link;
    const contentNode = _rssDirectChild(node, ['encoded', 'content', 'description', 'summary']);
    const rawContent = String(contentNode?.textContent || '');
    const summary = _rssPlainText(rawContent).slice(0, 1000);
    const dateText = _rssNodeText(_rssDirectChild(node, ['pubdate', 'published', 'updated', 'date']));
    const parsedDate = Date.parse(dateText);
    const authorNode = _rssDirectChild(node, ['creator', 'author']);
    const author = _rssNodeText(_rssDirectChild(authorNode, ['name'])) || _rssNodeText(authorNode);
    const identity = guid || `${title}:${dateText}:${index}`;
    return {
      id: `${feed.id}:${_rssHash(identity)}`,
      title,
      link,
      summary,
      image: _rssEntryImage(node, rawContent, responseUrl),
      author,
      timestamp: Number.isFinite(parsedDate) ? parsedDate : fetchedAt,
      dateText
    };
  }).sort((left, right) => right.timestamp - left.timestamp);
  return { title: parsedTitle, items };
}

async function _fetchRssText(url) {
  let directError = null;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), 15000) : null;
  try {
    const response = await fetch(url, {
      credentials: 'omit',
      redirect: 'follow',
      cache: 'no-store',
      signal: controller?.signal,
      headers: { Accept: 'application/atom+xml, application/rss+xml, application/xml, text/xml, */*;q=0.2' }
    });
    if (!response.ok) throw new Error(`Feed returned ${response.status}`);
    const text = await response.text();
    if (text.length > RSS_MAX_RESPONSE_CHARS) throw new Error('Feed exceeds the 2 MiB response limit');
    return { text, finalUrl: response.url || url, transport: 'direct' };
  } catch (error) {
    directError = error;
  } finally {
    if (timer) clearTimeout(timer);
  }

  if (typeof bridge !== 'undefined' && typeof bridge.fetchFeed === 'function') {
    const relayed = await bridge.fetchFeed(url);
    if (relayed?.text) return { ...relayed, transport: 'extension' };
  }
  const reason = directError?.name === 'AbortError' ? 'Feed request timed out.' : (directError?.message || 'Direct feed request failed.');
  throw new Error(`${reason} The extension relay could not fetch it either.`);
}

function _rssFeedFresh(widget, entry) {
  return !!entry?.fetchedAt
    && Date.now() - Number(entry.fetchedAt) < _normalizeRssRefreshMinutes(widget.config?.refreshMinutes) * 60 * 1000;
}

function _ensureRssData(widget, options = {}) {
  const feeds = _rssFeedConfigs(widget);
  if (!feeds.length) return null;
  const runtime = _getRssRuntime(widget.id);
  const force = options.force === true;
  const selectedFeedId = options.feedId || '';
  const tasks = [];

  feeds.forEach(feed => {
    if (selectedFeedId && feed.id !== selectedFeedId) return;
    const validUrl = _rssValidUrl(feed.url);
    if (!validUrl) return;
    const cached = _readRssCache(widget.id).feeds[feed.id];
    if (!force && _rssFeedFresh(widget, cached) && cached.url === validUrl) return;
    if (!force && Number(runtime.nextRetryAt.get(feed.id) || 0) > Date.now()) return;
    const fetchKey = `rss:${widget.id}:${feed.id}`;
    if (_widgetFetches.has(fetchKey)) {
      tasks.push(_widgetFetches.get(fetchKey));
      return;
    }
    runtime.loading.add(feed.id);
    const request = _fetchRssText(validUrl)
      .then(response => {
        const parsed = _parseRssFeed(response.text, feed, response.finalUrl || validUrl);
        const cache = _readRssCache(widget.id);
        cache.feeds[feed.id] = {
          url: validUrl,
          title: parsed.title,
          fetchedAt: Date.now(),
          transport: response.transport,
          error: '',
          items: parsed.items.slice(0, 80)
        };
        _writeRssCache(widget.id, cache);
        runtime.nextRetryAt.delete(feed.id);
        return { ok: true, feedId: feed.id };
      })
      .catch(error => {
        const cache = _readRssCache(widget.id);
        const previous = cache.feeds[feed.id] || { url: validUrl, title: feed.name || validUrl, items: [] };
        cache.feeds[feed.id] = {
          ...previous,
          url: validUrl,
          error: error?.message || 'Unable to load feed.',
          lastAttemptAt: Date.now()
        };
        _writeRssCache(widget.id, cache);
        runtime.nextRetryAt.set(feed.id, Date.now() + RSS_RETRY_MS);
        return { ok: false, feedId: feed.id, error };
      })
      .finally(() => {
        runtime.loading.delete(feed.id);
        _widgetFetches.delete(fetchKey);
      });
    _widgetFetches.set(fetchKey, request);
    tasks.push(request);
  });

  if (!tasks.length) return null;
  return Promise.all(tasks).finally(() => _refreshWidget(widget.id, 'column'));
}

function _rssCanonicalUrl(value) {
  try {
    const url = new URL(value);
    url.hash = '';
    [...url.searchParams.keys()].forEach(key => {
      if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
    });
    return url.toString();
  } catch {
    return '';
  }
}

function _rssItemsForView(widget, activeFeedId = 'all', search = '') {
  const feeds = _rssFeedConfigs(widget);
  const cache = _readRssCache(widget.id);
  const selectedFeeds = activeFeedId === 'all' || activeFeedId === 'starred'
    ? feeds
    : feeds.filter(feed => feed.id === activeFeedId);
  const merged = [];
  const seen = new Map();
  selectedFeeds.forEach(feed => {
    const entry = cache.feeds[feed.id];
    (entry?.items || []).slice(0, _normalizeRssArticleLimit(widget.config?.articleLimit)).forEach(item => {
      const key = _rssCanonicalUrl(item.link) || item.title.toLowerCase();
      if (['all', 'starred'].includes(activeFeedId) && seen.has(key)) {
        const existing = seen.get(key);
        if (!existing.feedNames.includes(feed.name || entry.title)) existing.feedNames.push(feed.name || entry.title);
        if (!existing.itemIds.includes(item.id)) existing.itemIds.push(item.id);
        return;
      }
      const enriched = {
        ...item,
        favoriteId: `rss-star:${_rssHash(key)}`,
        feedId: feed.id,
        feedName: feed.name || entry?.title || 'Feed',
        feedNames: [feed.name || entry?.title || 'Feed'],
        itemIds: [item.id]
      };
      seen.set(key, enriched);
      merged.push(enriched);
    });
  });
  const query = String(search || '').trim().toLowerCase();
  const starred = activeFeedId === 'starred' ? new Set(_readRssView(widget.id).starredIds) : null;
  return merged
    .filter(item => !starred || starred.has(item.favoriteId))
    .filter(item => !query || `${item.title} ${item.summary} ${item.author} ${item.feedNames.join(' ')}`.toLowerCase().includes(query))
    .sort((left, right) => right.timestamp - left.timestamp);
}

function _rssRelativeTime(timestamp) {
  const difference = Number(timestamp) - Date.now();
  const absolute = Math.abs(difference);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (absolute < 60 * 60 * 1000) return formatter.format(Math.round(difference / 60000), 'minute');
  if (absolute < 24 * 60 * 60 * 1000) return formatter.format(Math.round(difference / 3600000), 'hour');
  if (absolute < 7 * 24 * 60 * 60 * 1000) return formatter.format(Math.round(difference / 86400000), 'day');
  try { return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return ''; }
}

function _rssPruneAfterSettings(widget) {
  const feeds = _rssFeedConfigs(widget);
  const valid = new Map(feeds.map(feed => [feed.id, _rssValidUrl(feed.url)]));
  const cache = _readRssCache(widget.id);
  Object.keys(cache.feeds).forEach(feedId => {
    if (!valid.has(feedId) || cache.feeds[feedId]?.url !== valid.get(feedId)) delete cache.feeds[feedId];
  });
  _writeRssCache(widget.id, cache);
  const view = _readRssView(widget.id);
  if (!['all', 'starred'].includes(view.activeFeedId) && !valid.has(view.activeFeedId)) {
    _writeRssView(widget.id, { activeFeedId: 'all' });
  }
  _rssRuntime.delete(widget.id);
}

WIDGET_REGISTRY['rssReader'] = {
  name: 'RSS Reader',
  description: 'Tabbed RSS and Atom feeds with a combined chronological view',
  allowedIn: ['column'],
  settingsPanelWidth: 'wide',
  defaultConfig: {
    feeds: [],
    articleLimit: 20,
    refreshMinutes: 30,
    layout: 'compact',
    showImages: true
  },
  defaultData: {},
  liveSettingsPreview: false,
  reloadLabel: 'Refresh all RSS feeds',

  reload(widget) {
    return _ensureRssData(widget, { force: true });
  },

  onSettingsCommit(widget) {
    _rssPruneAfterSettings(widget);
  },

  render(widget, el, context) {
    const feeds = _rssFeedConfigs(widget);
    const runtime = _getRssRuntime(widget.id);
    let view = _readRssView(widget.id);
    if (!['all', 'starred'].includes(view.activeFeedId) && !feeds.some(feed => feed.id === view.activeFeedId)) {
      view = _writeRssView(widget.id, { activeFeedId: 'all' });
    }

    _setWidgetRefresher(widget.id, context, () => {
      if (!el.isConnected) {
        _widgetRefreshers.delete(`${widget.id}:${context}`);
        return;
      }
      el.innerHTML = '';
      WIDGET_REGISTRY.rssReader.render(widget, el, context);
    });

    el.className = `widget-rss-reader is-${_normalizeRssLayout(widget.config?.layout)}`;
    if (widget.title) {
      const heading = document.createElement('div');
      heading.className = 'widget-rss-heading';
      heading.textContent = widget.title;
      el.appendChild(heading);
    }
    if (!feeds.length) {
      const placeholder = document.createElement('div');
      placeholder.className = 'widget-rss-empty';
      placeholder.textContent = 'Add one or more RSS or Atom feed URLs in the widget settings.';
      el.appendChild(placeholder);
      return;
    }

    _ensureRssData(widget);
    _setWidgetTimer(widget.id, context, () => _ensureRssData(widget), 60 * 1000);

    const tabs = document.createElement('div');
    tabs.className = 'widget-rss-tabs widget-interactive-surface';
    tabs.setAttribute('role', 'tablist');
    const toolbar = document.createElement('div');
    toolbar.className = 'widget-rss-toolbar widget-interactive-surface';
    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'widget-rss-search';
    search.placeholder = 'Search articles';
    search.value = view.search;
    search.setAttribute('aria-label', 'Search RSS articles');
    const markRead = document.createElement('button');
    markRead.type = 'button';
    markRead.className = 'widget-rss-mark-read';
    markRead.textContent = 'Mark shown read';
    toolbar.append(search, markRead);

    const status = document.createElement('div');
    status.className = 'widget-rss-status';
    const articles = document.createElement('div');
    articles.className = 'widget-rss-articles widget-interactive-surface';
    el.append(tabs, toolbar, status, articles);

    const renderTabs = () => {
      const cache = _readRssCache(widget.id);
      const read = new Set(_readRssView(widget.id).readIds);
      tabs.innerHTML = '';
      const definitions = [
        { id: 'all', name: 'All', items: _rssItemsForView(widget, 'all', '') },
        { id: 'starred', name: '★ Starred', items: _rssItemsForView(widget, 'starred', '') },
        ...feeds.map(feed => ({
          id: feed.id,
          name: feed.name || cache.feeds[feed.id]?.title || 'Feed',
          items: _rssItemsForView(widget, feed.id, '')
        }))
      ];
      definitions.forEach(definition => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'widget-rss-tab';
        button.dataset.feedId = definition.id;
        button.setAttribute('role', 'tab');
        const active = _readRssView(widget.id).activeFeedId === definition.id;
        button.classList.toggle('active', active);
        button.setAttribute('aria-selected', String(active));
        const label = document.createElement('span');
        label.textContent = definition.name;
        const unreadCount = definition.items.filter(item => item.itemIds.some(itemId => !read.has(itemId))).length;
        button.appendChild(label);
        if (unreadCount) {
          const badge = document.createElement('span');
          badge.className = 'widget-rss-unread-badge';
          badge.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
          button.appendChild(badge);
        }
        button.addEventListener('click', event => {
          event.stopPropagation();
          view = _writeRssView(widget.id, { activeFeedId: definition.id });
          renderTabs();
          renderArticles();
        });
        tabs.appendChild(button);
      });
    };

    const renderStatus = () => {
      const cache = _readRssCache(widget.id);
      const loading = runtime.loading.size;
      const errors = feeds
        .map(feed => ({
          name: feed.name || cache.feeds[feed.id]?.title || 'Feed',
          error: _rssValidUrl(feed.url) ? (cache.feeds[feed.id]?.error || '') : 'Enter a valid HTTP(S) feed URL in settings.'
        }))
        .filter(item => item.error);
      status.innerHTML = '';
      status.classList.toggle('hidden', !loading && !errors.length);
      if (loading) {
        const loadingLine = document.createElement('div');
        loadingLine.textContent = `Refreshing ${loading} feed${loading === 1 ? '' : 's'}…`;
        status.appendChild(loadingLine);
      }
      errors.forEach(item => {
        const line = document.createElement('div');
        line.className = 'is-error';
        line.textContent = `${item.name}: ${item.error}`;
        status.appendChild(line);
      });
    };

    const renderArticles = () => {
      const currentView = _readRssView(widget.id);
      const read = new Set(currentView.readIds);
      const starred = new Set(currentView.starredIds);
      const items = _rssItemsForView(widget, currentView.activeFeedId, currentView.search);
      articles.innerHTML = '';
      markRead.disabled = !items.some(item => item.itemIds.some(itemId => !read.has(itemId)));
      if (!items.length) {
        const empty = document.createElement('div');
        empty.className = 'widget-rss-empty';
        empty.textContent = currentView.search ? 'No articles match this search.' : 'No articles are available in this view yet.';
        articles.appendChild(empty);
        renderStatus();
        return;
      }
      items.forEach(item => {
        const article = document.createElement('article');
        const itemIsRead = item.itemIds.every(itemId => read.has(itemId));
        article.className = `widget-rss-article${itemIsRead ? ' is-read' : ' is-unread'}`;
        if (widget.config?.showImages !== false && _normalizeRssLayout(widget.config?.layout) === 'expanded' && item.image) {
          const image = document.createElement('img');
          image.className = 'widget-rss-image';
          image.src = item.image;
          image.alt = '';
          image.loading = 'lazy';
          image.referrerPolicy = 'no-referrer';
          image.addEventListener('error', () => image.remove(), { once: true });
          article.appendChild(image);
        }
        const content = document.createElement('div');
        content.className = 'widget-rss-article-content';
        const titleRow = document.createElement('div');
        titleRow.className = 'widget-rss-title-row';
        const link = document.createElement('a');
        link.className = 'widget-rss-title';
        link.href = item.link || '#';
        link.target = '_blank';
        link.rel = 'noreferrer noopener';
        link.textContent = item.title;
        if (!item.link) link.removeAttribute('href');
        link.addEventListener('click', () => {
          if (item.itemIds.every(itemId => read.has(itemId))) return;
          item.itemIds.forEach(itemId => read.add(itemId));
          _writeRssView(widget.id, { readIds: [...read] });
          article.classList.remove('is-unread');
          article.classList.add('is-read');
          renderTabs();
        });
        const star = document.createElement('button');
        star.type = 'button';
        star.className = `widget-rss-star${starred.has(item.favoriteId) ? ' active' : ''}`;
        star.textContent = starred.has(item.favoriteId) ? '★' : '☆';
        star.title = starred.has(item.favoriteId) ? 'Remove favourite' : 'Add favourite';
        star.setAttribute('aria-pressed', String(starred.has(item.favoriteId)));
        star.addEventListener('click', event => {
          event.stopPropagation();
          if (starred.has(item.favoriteId)) starred.delete(item.favoriteId);
          else starred.add(item.favoriteId);
          _writeRssView(widget.id, { starredIds: [...starred] });
          star.classList.toggle('active', starred.has(item.favoriteId));
          star.textContent = starred.has(item.favoriteId) ? '★' : '☆';
          star.setAttribute('aria-pressed', String(starred.has(item.favoriteId)));
          renderTabs();
          if (_readRssView(widget.id).activeFeedId === 'starred') renderArticles();
        });
        titleRow.append(link, star);
        const meta = document.createElement('div');
        meta.className = 'widget-rss-meta';
        const source = document.createElement('span');
        source.textContent = item.feedNames.join(' + ');
        const time = document.createElement('time');
        time.dateTime = new Date(item.timestamp).toISOString();
        time.textContent = _rssRelativeTime(item.timestamp);
        meta.append(source, time);
        content.append(titleRow, meta);
        if (_normalizeRssLayout(widget.config?.layout) === 'expanded' && item.summary) {
          const summary = document.createElement('p');
          summary.className = 'widget-rss-summary';
          summary.textContent = item.summary;
          content.appendChild(summary);
        }
        article.appendChild(content);
        articles.appendChild(article);
      });
      renderStatus();
    };

    tabs.addEventListener('wheel', event => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      tabs.scrollLeft += event.deltaY;
      event.preventDefault();
    }, { passive: false });
    search.addEventListener('input', () => {
      view = _writeRssView(widget.id, { search: search.value });
      renderArticles();
    });
    markRead.addEventListener('click', event => {
      event.stopPropagation();
      const currentView = _readRssView(widget.id);
      const read = new Set(currentView.readIds);
      _rssItemsForView(widget, currentView.activeFeedId, currentView.search)
        .forEach(item => item.itemIds.forEach(itemId => read.add(itemId)));
      view = _writeRssView(widget.id, { readIds: [...read] });
      renderTabs();
      renderArticles();
    });

    renderTabs();
    renderArticles();
  },

  renderSettings(widget, container) {
    const c = widget.config || {};
    const feeds = _rssFeedConfigs(widget);
    container.innerHTML = `
      <div class="rss-settings-feed-section">
        <div class="rss-settings-feed-label">Feed tabs</div>
        <div class="rss-settings-feed-editor">
          <div class="rss-settings-feed-list"></div>
          <button type="button" class="secondary-btn rss-settings-add-feed">Add feed</button>
        </div>
      </div>
      <div class="settings-row">
        <span>Articles per feed</span>
        <select class="settings-select" data-cfg="articleLimit">
          ${[10, 20, 40, 80].map(limit => `<option value="${limit}" ${_normalizeRssArticleLimit(c.articleLimit) === limit ? 'selected' : ''}>${limit}</option>`).join('')}
        </select>
      </div>
      <div class="settings-row">
        <span>Automatic refresh</span>
        <select class="settings-select" data-cfg="refreshMinutes">
          ${[[15, '15 minutes'], [30, '30 minutes'], [60, 'Hourly'], [180, 'Every 3 hours']].map(([minutes, label]) => `<option value="${minutes}" ${_normalizeRssRefreshMinutes(c.refreshMinutes) === minutes ? 'selected' : ''}>${label}</option>`).join('')}
        </select>
      </div>
      <div class="settings-row">
        <span>Article layout</span>
        <div class="board-fit-radios weather-option-radios">
          <label class="board-fit-label"><input type="radio" name="rssLayout" data-cfg="layout" value="compact" ${_normalizeRssLayout(c.layout) === 'compact' ? 'checked' : ''}/><span>Compact</span></label>
          <label class="board-fit-label"><input type="radio" name="rssLayout" data-cfg="layout" value="expanded" ${_normalizeRssLayout(c.layout) === 'expanded' ? 'checked' : ''}/><span>Expanded</span></label>
        </div>
      </div>
      <div class="settings-row">
        <span>Article images</span>
        <label class="settings-toggle"><input type="checkbox" data-cfg="showImages" ${c.showImages !== false ? 'checked' : ''}/><span class="toggle-track"></span></label>
      </div>
      <div class="settings-help">The All tab merges every feed chronologically and collapses duplicate links. Feeds that block direct browser access are requested through extension 1.0.21.</div>`;

    const list = container.querySelector('.rss-settings-feed-list');
    const addButton = container.querySelector('.rss-settings-add-feed');
    const renderFeedRows = () => {
      list.innerHTML = '';
      feeds.forEach((feed, index) => {
        const row = document.createElement('div');
        row.className = 'rss-settings-feed-row';
        const inputs = document.createElement('div');
        inputs.className = 'rss-settings-feed-inputs';
        const name = document.createElement('input');
        name.type = 'text';
        name.className = 'settings-text-input';
        name.placeholder = 'Tab name';
        name.value = feed.name;
        const url = document.createElement('input');
        url.type = 'url';
        url.className = 'settings-text-input';
        url.placeholder = 'https://example.com/feed.xml';
        url.value = feed.url;
        const actions = document.createElement('div');
        actions.className = 'rss-settings-feed-actions';
        const up = document.createElement('button');
        up.type = 'button';
        up.className = 'icon-btn';
        up.textContent = '↑';
        up.title = 'Move feed up';
        up.disabled = index === 0;
        const down = document.createElement('button');
        down.type = 'button';
        down.className = 'icon-btn';
        down.textContent = '↓';
        down.title = 'Move feed down';
        down.disabled = index === feeds.length - 1;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'icon-btn is-danger';
        remove.textContent = '×';
        remove.title = 'Remove feed';
        remove.setAttribute('aria-label', `Remove ${feed.name || 'feed'}`);
        name.addEventListener('input', () => { feed.name = name.value; });
        url.addEventListener('input', () => { feed.url = url.value; });
        up.addEventListener('click', () => {
          if (index < 1) return;
          feeds.splice(index - 1, 0, feeds.splice(index, 1)[0]);
          renderFeedRows();
        });
        down.addEventListener('click', () => {
          if (index >= feeds.length - 1) return;
          feeds.splice(index + 1, 0, feeds.splice(index, 1)[0]);
          renderFeedRows();
        });
        remove.addEventListener('click', () => {
          feeds.splice(index, 1);
          renderFeedRows();
        });
        inputs.append(name, url);
        actions.append(up, down, remove);
        row.append(inputs, actions);
        list.appendChild(row);
      });
      addButton.disabled = feeds.length >= RSS_MAX_FEEDS;
      if (!feeds.length) {
        const empty = document.createElement('div');
        empty.className = 'settings-muted rss-settings-empty';
        empty.textContent = 'No feeds configured yet.';
        list.appendChild(empty);
      }
    };
    addButton.addEventListener('click', () => {
      if (feeds.length >= RSS_MAX_FEEDS) return;
      feeds.push({ id: _rssNewFeedId(), name: '', url: '' });
      renderFeedRows();
      list.querySelector('.rss-settings-feed-row:last-of-type input')?.focus();
    });
    renderFeedRows();
  }
};

// ---- IP Info widget ----

function _normalizeIpInfoRefreshMinutes(value) {
  const parsed = Number.parseInt(value, 10);
  return [0, 5, 15, 30, 60, 180].includes(parsed) ? parsed : 15;
}

function _ipInfoCacheKey(widgetId) {
  return `${IP_INFO_CACHE_PREFIX}${widgetId}`;
}

function _readIpInfoCache(widgetId) {
  if (_ipInfoMemoryCache.has(widgetId)) return _ipInfoMemoryCache.get(widgetId);
  let cache = null;
  try { cache = JSON.parse(localStorage.getItem(_ipInfoCacheKey(widgetId)) || 'null'); } catch { cache = null; }
  if (!cache || !cache.data || !Number.isFinite(Number(cache.fetchedAt))) cache = null;
  _ipInfoMemoryCache.set(widgetId, cache);
  return cache;
}

function _writeIpInfoCache(widgetId, data) {
  const cache = { fetchedAt: Date.now(), data };
  _ipInfoMemoryCache.set(widgetId, cache);
  try { localStorage.setItem(_ipInfoCacheKey(widgetId), JSON.stringify(cache)); } catch {}
  return cache;
}

function _ipInfoSpeedCacheKey(widgetId) {
  return `${IP_INFO_SPEED_CACHE_PREFIX}${widgetId}`;
}

function _readIpInfoSpeedCache(widgetId) {
  if (_ipInfoSpeedMemoryCache.has(widgetId)) return _ipInfoSpeedMemoryCache.get(widgetId);
  let cache = null;
  try { cache = JSON.parse(localStorage.getItem(_ipInfoSpeedCacheKey(widgetId)) || 'null'); } catch { cache = null; }
  if (
    !cache
    || !Number.isFinite(Number(cache.fetchedAt))
    || !String(cache.ip || '')
    || !Number.isFinite(Number(cache.downloadMbps))
    || !Number.isFinite(Number(cache.uploadMbps))
  ) cache = null;
  _ipInfoSpeedMemoryCache.set(widgetId, cache);
  return cache;
}

function _writeIpInfoSpeedCache(widgetId, result) {
  const cache = { fetchedAt: Date.now(), ...result };
  _ipInfoSpeedMemoryCache.set(widgetId, cache);
  try { localStorage.setItem(_ipInfoSpeedCacheKey(widgetId), JSON.stringify(cache)); } catch {}
  return cache;
}

function _getIpInfoRuntime(widgetId) {
  let runtime = _ipInfoRuntime.get(widgetId);
  if (!runtime) {
    runtime = {
      status: 'idle',
      error: '',
      nextRetryAt: 0,
      sessionRefreshClaimed: false,
      changed: false,
      speedStatus: 'idle',
      speedStage: '',
      speedError: '',
      speedOnNextLookup: false
    };
    _ipInfoRuntime.set(widgetId, runtime);
  }
  return runtime;
}

function _claimIpInfoSessionRefresh(runtime) {
  if (runtime.sessionRefreshClaimed) return false;
  runtime.sessionRefreshClaimed = true;
  return true;
}

function _isIpInfoCacheFresh(widget, cache) {
  if (!cache?.fetchedAt) return false;
  const minutes = _normalizeIpInfoRefreshMinutes(widget.config?.refreshMinutes);
  return minutes === 0 || Date.now() - Number(cache.fetchedAt) < minutes * 60 * 1000;
}

function _ipInfoCountryFlag(countryCode) {
  const code = String(countryCode || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return '🌐';
  return String.fromCodePoint(...[...code].map(letter => 127397 + letter.charCodeAt(0)));
}

async function _fetchIpInfoJson(url) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), IP_INFO_REQUEST_TIMEOUT_MS) : null;
  try {
    const response = await fetch(url, {
      credentials: 'omit',
      redirect: 'follow',
      cache: 'no-store',
      signal: controller?.signal,
      headers: { Accept: 'application/json' }
    });
    let payload = null;
    try { payload = await response.json(); } catch { payload = null; }
    if (!response.ok) throw new Error(payload?.message || `IP service returned ${response.status}`);
    if (!payload || typeof payload !== 'object') throw new Error('IP service returned an invalid response.');
    return payload;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('IP lookup timed out.');
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function _normalizeIpInfoPayload(payload, source = 'ipwho.is') {
  const ip = String(payload?.ip || '').trim();
  if (!ip || ip.length > 64 || !/^[0-9a-f:.]+$/i.test(ip)) throw new Error('IP service did not return a valid public address.');
  const countryCode = String(payload?.country_code || '').trim().toUpperCase();
  return {
    ip,
    type: String(payload?.type || (ip.includes(':') ? 'IPv6' : 'IPv4')),
    country: String(payload?.country || ''),
    countryCode,
    flag: String(payload?.flag?.emoji || _ipInfoCountryFlag(countryCode)),
    city: String(payload?.city || ''),
    region: String(payload?.region || ''),
    isp: String(payload?.connection?.isp || payload?.connection?.org || ''),
    asn: payload?.connection?.asn ? `AS${String(payload.connection.asn).replace(/^AS/i, '')}` : '',
    source,
    partial: source !== 'ipwho.is'
  };
}

async function _fetchIpInfoPayload() {
  try {
    const payload = await _fetchIpInfoJson('https://ipwho.is/');
    if (payload.success === false) throw new Error(payload.message || 'IP geolocation lookup failed.');
    return _normalizeIpInfoPayload(payload, 'ipwho.is');
  } catch (primaryError) {
    try {
      const payload = await _fetchIpInfoJson('https://api64.ipify.org?format=json');
      return _normalizeIpInfoPayload(payload, 'ipify');
    } catch {
      throw primaryError;
    }
  }
}

function _normalizeIpInfoSpeedResult(summary, ip) {
  const downloadMbps = Number(summary?.download) / 1e6;
  const uploadMbps = Number(summary?.upload) / 1e6;
  const latencyMs = Number(summary?.latency);
  const jitterMs = Number(summary?.jitter);
  if (!Number.isFinite(downloadMbps) || downloadMbps <= 0 || !Number.isFinite(uploadMbps) || uploadMbps <= 0) {
    throw new Error('Cloudflare did not return a complete speed measurement.');
  }
  return {
    ip: String(ip || ''),
    downloadMbps,
    uploadMbps,
    latencyMs: Number.isFinite(latencyMs) && latencyMs >= 0 ? latencyMs : null,
    jitterMs: Number.isFinite(jitterMs) && jitterMs >= 0 ? jitterMs : null
  };
}

function _refreshIpInfoSurfaces(widgetId) {
  _refreshWidget(widgetId, 'column');
  _refreshWidget(widgetId, 'navpane');
}

function _runIpInfoSpeedTest(widget, ip) {
  if (widget.config?.speedTest === false) return null;
  const runtime = _getIpInfoRuntime(widget.id);
  const fetchKey = `ip-speed:${widget.id}`;
  if (_widgetFetches.has(fetchKey)) return _widgetFetches.get(fetchKey);
  if (typeof CloudflareSpeedTest !== 'function') {
    runtime.speedStatus = 'error';
    runtime.speedError = 'The Cloudflare speed-test engine is unavailable.';
    _refreshIpInfoSurfaces(widget.id);
    return null;
  }

  runtime.speedStatus = 'loading';
  runtime.speedStage = 'Starting connection test…';
  runtime.speedError = '';
  _refreshIpInfoSurfaces(widget.id);

  const request = new Promise(resolve => {
    let test = null;
    let settled = false;
    let timeout = null;
    const settle = (result = null, error = '') => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (error) {
        try { test?.pause?.(); } catch {}
        runtime.speedStatus = 'error';
        runtime.speedStage = '';
        runtime.speedError = String(error || 'Unable to measure the connection speed.');
        resolve(null);
        return;
      }
      const cache = _writeIpInfoSpeedCache(widget.id, result);
      runtime.speedStatus = 'ready';
      runtime.speedStage = '';
      runtime.speedError = '';
      resolve(cache);
    };

    try {
      test = new CloudflareSpeedTest({
        autoStart: false,
        measurements: IP_INFO_SPEED_MEASUREMENTS,
        measureDownloadLoadedLatency: false,
        measureUploadLoadedLatency: false,
        logAimApiUrl: null,
        bandwidthFinishRequestDuration: 750
      });
      test.onResultsChange = ({ type } = {}) => {
        const stage = type === 'latency'
          ? 'Measuring latency…'
          : type === 'download'
            ? 'Measuring download speed…'
            : type === 'upload'
              ? 'Measuring upload speed…'
              : runtime.speedStage;
        if (stage !== runtime.speedStage) {
          runtime.speedStage = stage;
          _refreshIpInfoSurfaces(widget.id);
        }
      };
      test.onFinish = results => {
        try {
          settle(_normalizeIpInfoSpeedResult(results.getSummary(), ip));
        } catch (error) {
          settle(null, error?.message);
        }
      };
      test.onError = error => settle(null, error || 'Cloudflare speed test failed.');
      timeout = setTimeout(() => settle(null, 'Cloudflare speed test timed out.'), IP_INFO_SPEED_TIMEOUT_MS);
      test.play();
    } catch (error) {
      settle(null, error?.message || 'Unable to start the Cloudflare speed test.');
    }
  }).finally(() => {
    _widgetFetches.delete(fetchKey);
    _refreshIpInfoSurfaces(widget.id);
  });
  _widgetFetches.set(fetchKey, request);
  return request;
}

function _ensureIpInfoData(widget, options = {}) {
  const force = options.force === true;
  const cache = _readIpInfoCache(widget.id);
  const runtime = _getIpInfoRuntime(widget.id);
  if (options.runSpeed === true) runtime.speedOnNextLookup = true;
  if (!force && _isIpInfoCacheFresh(widget, cache)) return null;
  if (!force && runtime.nextRetryAt > Date.now()) return null;
  const fetchKey = `ip-info:${widget.id}`;
  if (_widgetFetches.has(fetchKey)) return _widgetFetches.get(fetchKey);
  runtime.status = 'loading';
  runtime.error = '';
  const request = _fetchIpInfoPayload()
    .then(data => {
      const ipChanged = !!cache?.data?.ip && cache.data.ip !== data.ip;
      runtime.changed = ipChanged;
      _writeIpInfoCache(widget.id, data);
      runtime.status = 'ready';
      runtime.error = '';
      runtime.nextRetryAt = 0;
      const shouldRunSpeed = runtime.speedOnNextLookup || ipChanged;
      runtime.speedOnNextLookup = false;
      if (shouldRunSpeed) _runIpInfoSpeedTest(widget, data.ip);
      return data;
    })
    .catch(error => {
      runtime.status = 'error';
      runtime.error = error?.message || 'Unable to check the public IP address.';
      runtime.nextRetryAt = Date.now() + IP_INFO_RETRY_MS;
      runtime.speedOnNextLookup = false;
      return null;
    })
    .finally(() => {
      _widgetFetches.delete(fetchKey);
      _refreshIpInfoSurfaces(widget.id);
    });
  _widgetFetches.set(fetchKey, request);
  return request;
}

function _ipInfoCheckedLabel(fetchedAt) {
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - Number(fetchedAt || 0)) / 60000));
  if (elapsedMinutes < 1) return 'Checked just now';
  if (elapsedMinutes === 1) return 'Checked 1 minute ago';
  if (elapsedMinutes < 60) return `Checked ${elapsedMinutes} minutes ago`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  return `Checked ${elapsedHours} hour${elapsedHours === 1 ? '' : 's'} ago`;
}

function _ipInfoCompactAge(fetchedAt) {
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - Number(fetchedAt || 0)) / 60000));
  if (elapsedMinutes < 1) return 'now';
  if (elapsedMinutes < 60) return `${elapsedMinutes}m`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h`;
  return `${Math.floor(elapsedHours / 24)}d`;
}

function _formatIpInfoSpeedMetric(value, unit) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '—';
  const digits = numeric >= 100 ? 0 : 1;
  return `${numeric.toFixed(digits)} ${unit}`;
}

WIDGET_REGISTRY['ipInfo'] = {
  name: 'IP Info',
  description: 'Current public IP address and approximate country for checking VPN connections',
  allowedIn: ['column', 'navpane'],
  defaultConfig: {
    refreshMinutes: 15,
    showCity: true,
    showProvider: true,
    showIpType: true,
    speedTest: true
  },
  defaultData: {},
  reloadLabel: 'Check public IP and connection speed now',

  reload(widget) {
    return _ensureIpInfoData(widget, { force: true, runSpeed: true });
  },

  render(widget, el, context) {
    const runtime = _getIpInfoRuntime(widget.id);
    let cache = _readIpInfoCache(widget.id);

    _setWidgetRefresher(widget.id, context, () => {
      if (!el.isConnected) {
        _widgetRefreshers.delete(`${widget.id}:${context}`);
        return;
      }
      el.innerHTML = '';
      WIDGET_REGISTRY.ipInfo.render(widget, el, context);
    });

    el.className = 'widget-ip-info';
    if (widget.title) {
      const heading = document.createElement('div');
      heading.className = 'widget-ip-info-heading';
      heading.textContent = widget.title;
      el.appendChild(heading);
    }

    if (_claimIpInfoSessionRefresh(runtime)) {
      _ensureIpInfoData(widget, { force: true, runSpeed: true });
    } else if (!_isIpInfoCacheFresh(widget, cache)) {
      _ensureIpInfoData(widget);
    }
    _setWidgetTimer(widget.id, context, () => {
      if (!_isIpInfoCacheFresh(widget, _readIpInfoCache(widget.id))) _ensureIpInfoData(widget);
    }, 60 * 1000);
    cache = _readIpInfoCache(widget.id);

    if (!cache?.data) {
      const placeholder = document.createElement('div');
      placeholder.className = `widget-ip-info-placeholder${runtime.status === 'error' ? ' is-error' : ''}`;
      placeholder.textContent = runtime.status === 'error' ? runtime.error : 'Checking your public IP address…';
      el.appendChild(placeholder);
      return;
    }

    const data = cache.data;
    const main = document.createElement('div');
    main.className = 'widget-ip-info-main';
    const flag = document.createElement('span');
    flag.className = 'widget-ip-info-flag';
    flag.textContent = data.flag || _ipInfoCountryFlag(data.countryCode);
    flag.setAttribute('aria-label', data.country ? `${data.country} flag` : 'Country unavailable');
    const identity = document.createElement('div');
    identity.className = 'widget-ip-info-identity';
    const country = document.createElement('div');
    country.className = 'widget-ip-info-country';
    country.textContent = data.country || 'Country unavailable';
    if (runtime.changed) {
      const changed = document.createElement('span');
      changed.className = 'widget-ip-info-changed';
      changed.textContent = 'IP changed';
      country.appendChild(changed);
    }
    const address = document.createElement('div');
    address.className = 'widget-ip-info-address widget-interactive-surface';
    const addressValue = document.createElement('span');
    addressValue.textContent = data.ip;
    address.appendChild(addressValue);
    if (widget.config?.showIpType !== false && data.type) {
      const addressType = document.createElement('span');
      addressType.className = 'widget-ip-info-type';
      addressType.textContent = `(${data.type})`;
      address.appendChild(addressType);
    }
    address.title = 'Current public IP address';
    identity.append(country, address);
    main.append(flag, identity);
    el.appendChild(main);

    const details = [];
    if (widget.config?.showCity !== false) {
      const location = [data.city, data.region].filter(Boolean).join(', ');
      if (location) details.push(location);
    }
    if (details.length) {
      const locationLine = document.createElement('div');
      locationLine.className = 'widget-ip-info-details';
      locationLine.textContent = details.join(' · ');
      el.appendChild(locationLine);
    }
    if (widget.config?.showProvider !== false && (data.isp || data.asn)) {
      const provider = document.createElement('div');
      provider.className = 'widget-ip-info-provider';
      provider.textContent = [data.isp, data.asn].filter(Boolean).join(' · ');
      el.appendChild(provider);
    }
    if (data.partial) {
      const partial = document.createElement('div');
      partial.className = 'widget-ip-info-status is-warning';
      partial.textContent = 'Country lookup unavailable; showing the public IP only.';
      el.appendChild(partial);
    } else if (runtime.status === 'loading') {
      const loading = document.createElement('div');
      loading.className = 'widget-ip-info-status';
      loading.textContent = 'Checking for an IP change…';
      el.appendChild(loading);
    } else if (runtime.status === 'error') {
      const error = document.createElement('div');
      error.className = 'widget-ip-info-status is-error';
      error.textContent = `Showing the last result. ${runtime.error}`;
      el.appendChild(error);
    }

    const speedCache = _readIpInfoSpeedCache(widget.id);
    const currentSpeed = speedCache?.ip === data.ip ? speedCache : null;
    if (widget.config?.speedTest !== false) {
      const speed = document.createElement('div');
      speed.className = 'widget-ip-info-speed';
      speed.setAttribute('aria-live', 'polite');

      if (runtime.speedStatus === 'loading') {
        const progress = document.createElement('div');
        progress.className = 'widget-ip-info-speed-status';
        progress.textContent = runtime.speedStage || 'Testing connection speed…';
        speed.appendChild(progress);
      } else if (currentSpeed) {
        const metrics = document.createElement('div');
        metrics.className = 'widget-ip-info-speed-metrics';
        const values = [
          ['Download', _formatIpInfoSpeedMetric(currentSpeed.downloadMbps, 'Mbps')],
          ['Upload', _formatIpInfoSpeedMetric(currentSpeed.uploadMbps, 'Mbps')],
          ['Ping', _formatIpInfoSpeedMetric(currentSpeed.latencyMs, 'ms')]
        ];
        values.forEach(([label, value]) => {
          const metric = document.createElement('div');
          metric.className = 'widget-ip-info-speed-metric';
          const metricLabel = document.createElement('span');
          metricLabel.textContent = label;
          const metricValue = document.createElement('strong');
          metricValue.textContent = value;
          metric.append(metricLabel, metricValue);
          metrics.appendChild(metric);
        });
        speed.appendChild(metrics);
      } else {
        const pending = document.createElement('div');
        pending.className = `widget-ip-info-speed-status${runtime.speedStatus === 'error' ? ' is-error' : ''}`;
        pending.textContent = runtime.speedStatus === 'error'
          ? runtime.speedError
          : 'Connection speed will be measured with the next IP check.';
        speed.appendChild(pending);
      }
      el.appendChild(speed);
    }

    const footer = document.createElement('div');
    footer.className = 'widget-ip-info-footer';
    const status = document.createElement('span');
    status.className = 'widget-ip-info-footer-status';
    const sameCheck = currentSpeed && Math.abs(Number(cache.fetchedAt) - Number(currentSpeed.fetchedAt)) < 60 * 1000;
    status.textContent = sameCheck
      ? `IP + speed ${_ipInfoCompactAge(Math.max(cache.fetchedAt, currentSpeed.fetchedAt))}`
      : `IP ${_ipInfoCompactAge(cache.fetchedAt)}${currentSpeed ? ` · Speed ${_ipInfoCompactAge(currentSpeed.fetchedAt)}` : ''}`;
    if (currentSpeed && Number.isFinite(Number(currentSpeed.jitterMs))) {
      status.textContent += ` · Jitter ${_formatIpInfoSpeedMetric(currentSpeed.jitterMs, 'ms')}`;
    }
    status.title = `${_ipInfoCheckedLabel(cache.fetchedAt)}${currentSpeed ? ` · Speed tested ${_ipInfoCompactAge(currentSpeed.fetchedAt)}` : ''}`;
    const sources = document.createElement('span');
    sources.className = 'widget-ip-info-footer-sources widget-interactive-surface';
    const source = document.createElement('a');
    source.href = data.source === 'ipify' ? 'https://www.ipify.org/' : 'https://ipwhois.io/';
    source.target = '_blank';
    source.rel = 'noreferrer noopener';
    source.textContent = data.source === 'ipify' ? 'ipify' : 'ipwho.is';
    source.addEventListener('mousedown', event => event.stopPropagation());
    sources.appendChild(source);
    if (widget.config?.speedTest !== false) {
      const separator = document.createElement('span');
      separator.textContent = '·';
      const cloudflare = document.createElement('a');
      cloudflare.href = 'https://speed.cloudflare.com/';
      cloudflare.target = '_blank';
      cloudflare.rel = 'noreferrer noopener';
      cloudflare.textContent = 'CF';
      cloudflare.title = 'Cloudflare Speed Test';
      cloudflare.addEventListener('mousedown', event => event.stopPropagation());
      sources.append(separator, cloudflare);
    }
    footer.append(status, sources);
    el.appendChild(footer);
  },

  renderSettings(widget, container) {
    const c = widget.config || {};
    container.innerHTML = `
      <div class="settings-row">
        <span>Automatic refresh</span>
        <select class="settings-select" data-cfg="refreshMinutes">
          ${[[5, 'Every 5 minutes'], [15, 'Every 15 minutes'], [30, 'Every 30 minutes'], [60, 'Hourly'], [180, 'Every 3 hours'], [0, 'Manual only']].map(([minutes, label]) => `<option value="${minutes}" ${_normalizeIpInfoRefreshMinutes(c.refreshMinutes) === minutes ? 'selected' : ''}>${label}</option>`).join('')}
        </select>
      </div>
      <div class="settings-row"><span>Approximate city</span><label class="settings-toggle"><input type="checkbox" data-cfg="showCity" ${c.showCity !== false ? 'checked' : ''}/><span class="toggle-track"></span></label></div>
      <div class="settings-row"><span>Network provider</span><label class="settings-toggle"><input type="checkbox" data-cfg="showProvider" ${c.showProvider !== false ? 'checked' : ''}/><span class="toggle-track"></span></label></div>
      <div class="settings-row"><span>IPv4 / IPv6 type</span><label class="settings-toggle"><input type="checkbox" data-cfg="showIpType" ${c.showIpType !== false ? 'checked' : ''}/><span class="toggle-track"></span></label></div>
      <div class="settings-row"><span>Cloudflare connection speed test</span><label class="settings-toggle"><input type="checkbox" data-cfg="speedTest" ${c.speedTest !== false ? 'checked' : ''}/><span class="toggle-track"></span></label></div>
      <div class="settings-help">The widget checks the browser's public exit address on Hub load and at the selected interval. IP geolocation is approximate. Data is requested from ipwho.is and cached only in this browser.</div>
      <div class="settings-help">The bounded Cloudflare test runs on Hub load, after a detected IP change, or when this widget is manually reloaded—not on the IP refresh interval when the address is unchanged. Each run transfers up to about 32 MB. Completed results stay in this browser and Cloudflare result reporting is disabled.</div>`;
  }
};
