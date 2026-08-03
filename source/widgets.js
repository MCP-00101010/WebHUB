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
    config: { ...def.defaultConfig },
    data: cloneData(def.defaultData)
  };
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

  const settingsBtn = document.createElement('button');
  settingsBtn.type = 'button';
  settingsBtn.className = 'widget-action-btn';
  settingsBtn.title = 'Widget settings';
  settingsBtn.setAttribute('aria-label', `Edit ${widget.title || def.name} widget`);
  settingsBtn.appendChild(icon('icon-settings'));
  settingsBtn.addEventListener('click', e => {
    e.stopPropagation();
    openWidgetSettings(widget, () => {
      body.innerHTML = '';
      def.render(widget, body, 'column');
    });
  });
  el.appendChild(settingsBtn);

  if (typeof def.reload === 'function') {
    const reloadBtn = document.createElement('button');
    reloadBtn.type = 'button';
    reloadBtn.className = 'widget-action-btn widget-action-btn--reload';
    const reloadLabel = def.reloadLabel || `Reload ${widget.title || def.name} data`;
    reloadBtn.title = reloadLabel;
    reloadBtn.setAttribute('aria-label', reloadLabel);
    reloadBtn.appendChild(icon('icon-reload'));
    reloadBtn.addEventListener('click', async e => {
      e.stopPropagation();
      if (reloadBtn.disabled) return;
      reloadBtn.disabled = true;
      reloadBtn.classList.add('is-loading');
      try {
        const request = def.reload(widget);
        body.innerHTML = '';
        def.render(widget, body, 'column');
        await request;
      } finally {
        reloadBtn.disabled = false;
        reloadBtn.classList.remove('is-loading');
      }
    });
    el.appendChild(reloadBtn);
  }

  const body = document.createElement('div');
  body.className = 'widget-body';
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

  if (subtitle) subtitle.textContent = (options.isNew ? 'New ' : 'Edit ') + def.name;
  titleInput.value = widget.title || '';
  body.innerHTML   = '';
  def.renderSettings(widget, body);
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

function _fmtCountdownCompact(ms) {
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
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


// ---- Clock widget ----

WIDGET_REGISTRY['clock'] = {
  name: 'Clock',
  description: 'Live clock with optional date display',
  allowedIn: ['column', 'navpane'],
  defaultConfig: { format: '24h', showSeconds: false, showDate: true, timezone: '' },
  defaultData: {},

  render(widget, el, context) {
    const c = widget.config;
    if (context === 'navpane') {
      el.className = 'nav-widget-clock';
      const tick = () => { el.textContent = _fmtTime(_tzDate(c.timezone), c); };
      tick();
      _setWidgetTimer(widget.id, context, tick, 1000);
    } else {
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
    }
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
    if (context === 'navpane') {
      el.className = 'nav-widget-countdown';
      const tick = () => {
        if (!c.targetDate) { el.textContent = '—'; return; }
        const diff = new Date(c.targetDate) - Date.now();
        if (diff <= 0) {
          el.textContent = c.label || 'Today!';
          clearInterval(_widgetTimers.get(`${widget.id}:navpane`));
          _widgetTimers.delete(`${widget.id}:navpane`);
          return;
        }
        el.textContent = _fmtCountdownCompact(diff);
      };
      tick();
      _setWidgetTimer(widget.id, context, tick, 1000);
    } else {
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
          clearInterval(_widgetTimers.get(`${widget.id}:column`));
          _widgetTimers.delete(`${widget.id}:column`);
          return;
        }
        valueEl.textContent = _fmtCountdown(diff);
      };
      tick();
      _setWidgetTimer(widget.id, context, tick, 1000);
    }
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
