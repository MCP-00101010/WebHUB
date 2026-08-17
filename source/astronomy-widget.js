// --- Astronomy and Night Sky widget ---------------------------------------

const _astronomyRuntime = new Map();

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
  category: 'Space & Astronomy',
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

  dispose(widget) {
    _astronomyRuntime.delete(widget.id);
  },

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

    _bindOpenMeteoLocationSearch({
      widgetType: 'astronomy',
      input,
      button: searchBtn,
      results,
      signal: _wstgAbort?.signal,
      disabledAfter: () => useWeatherInput.checked,
      onSelect(result, label) {
        widget.config.locationName = label;
        widget.config.latitude = result.latitude;
        widget.config.longitude = result.longitude;
        widget.config.timezone = result.timezone || 'auto';
        selected.textContent = `Selected: ${label}`;
      }
    });
  }
};
