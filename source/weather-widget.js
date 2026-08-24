// --- Weather widget --------------------------------------------------------

const _weatherMemoryCache = new Map();
const _weatherViewMemory = new Map();
const _weatherRuntime = new Map();

const WEATHER_CACHE_PREFIX = 'morpheus-webhub-weather:';
const WEATHER_CACHE_SCHEMA_VERSION = 'hourly-v1';
const WEATHER_CACHE_TTL_MS = 30 * 60 * 1000;
const WEATHER_RETRY_DELAY_MS = 5 * 60 * 1000;

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
  let cache = _weatherMemoryCache.get(widget.id) || null;
  if (!cache) {
    cache = WidgetSDK.cache.get('weather', widget.id, 'forecast')
      || WidgetSDK.cache.migrateLegacy('weather', widget.id, 'forecast', key);
    if (cache) _weatherMemoryCache.set(widget.id, cache);
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
  _weatherMemoryCache.set(widget.id, cache);
  try { WidgetSDK.cache.set('weather', widget.id, 'forecast', cache); } catch {}
  return cache;
}

function _readWeatherView(widgetId) {
  if (_weatherViewMemory.has(widgetId)) return _weatherViewMemory.get(widgetId);
  const stored = WidgetSDK.cache.get('weather', widgetId, 'view');
  const view = {
    hourlyScrollLeft: Math.max(0, Math.min(100000, Number(stored?.hourlyScrollLeft) || 0))
  };
  _weatherViewMemory.set(widgetId, view);
  return view;
}

function _writeWeatherView(widgetId, updates = {}) {
  const current = _readWeatherView(widgetId);
  const view = {
    ...current,
    ...updates,
    hourlyScrollLeft: Math.max(0, Math.min(100000, Number(updates.hourlyScrollLeft ?? current.hourlyScrollLeft) || 0))
  };
  _weatherViewMemory.set(widgetId, view);
  try { WidgetSDK.cache.set('weather', widgetId, 'view', view); } catch {}
  return view;
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
  const request = _fetchWithTimeout(_weatherForecastUrl(widget), { widgetFetchKey: fetchKey, widgetType: 'weather' })
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
      if (error?.name === 'AbortError') return;
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

// ---- Weather widget ----

WIDGET_REGISTRY['weather'] = {
  name: 'Weather',
  category: 'Weather & Hazards',
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
  settingsSchema: {
    type: 'object',
    properties: {
      locationName: { type: 'string' },
      latitude: { type: 'any' },
      longitude: { type: 'any' },
      timezone: { type: 'string' },
      days: { type: 'number' },
      units: { type: 'string', enum: ['metric', 'imperial'] },
      forecastLayout: { type: 'string', enum: ['vertical', 'horizontal'] },
      showHourly24: { type: 'boolean' }
    },
    additionalProperties: false
  },

  dispose(widget) {
    const cacheKey = _weatherCacheKey(widget.id);
    _weatherRuntime.delete(widget.id);
    _weatherMemoryCache.delete(widget.id);
    _weatherViewMemory.delete(widget.id);
    WidgetSDK.cache.remove('weather', widget.id, 'forecast', { legacyKeys: [cacheKey] });
    WidgetSDK.cache.remove('weather', widget.id, 'view');
  },

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
          hourlyViewport.addEventListener('scroll', () => {
            WidgetSDK.runtime.requestFrame(`${widget.id}:weather-hourly-scroll`, () => {
              _writeWeatherView(widget.id, { hourlyScrollLeft: hourlyViewport.scrollLeft });
            });
          }, { passive: true });
          _enableWeatherHourlyDragScroll(hourlyViewport);
          hourlySection.append(hourlyTitle, hourlyViewport);
          el.appendChild(hourlySection);
          WidgetSDK.runtime.requestFrame(`${widget.id}:weather-hourly-restore`, () => {
            hourlyViewport.scrollLeft = _readWeatherView(widget.id).hourlyScrollLeft;
          });
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

    _bindOpenMeteoLocationSearch({
      widgetType: 'weather',
      input,
      button: searchBtn,
      results,
      signal: _wstgAbort?.signal,
      onSelect(location, label) {
        widget.config.locationName = label;
        widget.config.latitude = location.latitude;
        widget.config.longitude = location.longitude;
        widget.config.timezone = location.timezone || 'auto';
        selected.textContent = `Selected: ${label}`;
      }
    });
  }
};
