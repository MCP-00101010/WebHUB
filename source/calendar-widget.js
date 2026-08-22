// --- Calendar widget --------------------------------------------------------
// Private calendar URLs stay in the native secret store. Shared provider API
// keys are managed globally in Settings. Event data is merged in memory.

const _calendarRuntime = new Map();
const _calendarViewMemory = new Map();
let _calendarDayModal = null;
let _calendarMoonIconSequence = 0;
let _calendarRequestSequence = 0;

const CALENDAR_VIEW_PREFIX = 'morpheus-webhub-calendar-view:';
const CALENDAR_MAX_SOURCES = 12;
const CALENDAR_MAX_RESPONSE_CHARS = 2 * 1024 * 1024;
const CALENDAR_RANGE_BEHIND_DAYS = 370;
const CALENDAR_RANGE_AHEAD_DAYS = 730;
const CALENDAR_MAX_RECURRENCE_DAYS = 20000;
const CALENDAR_SOURCE_COLORS = ['#6d4aff', '#e55353', '#2aa876', '#e09f3e', '#3f8efc', '#c45ad8'];
const CALENDAR_WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const CALENDAR_SOURCE_TYPES = new Set(['proton', 'ics', 'ukHolidays', 'astronomy', 'moonPhases', 'launches', 'football', 'pdc', 'mediaWatchlist']);
const CALENDAR_SOURCE_DEFAULT_NAMES = {
  proton: 'Proton Calendar', ics: 'Public calendar', ukHolidays: 'UK bank holidays',
  astronomy: 'Astronomy', moonPhases: 'Moon phases', launches: 'Space launches', football: 'Football', pdc: 'PDC darts', mediaWatchlist: 'Media watchlist'
};

function _calendarNewSourceId() {
  return `calendar-source-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function _calendarSources(widget) {
  widget.config = widget.config || {};
  if (!Array.isArray(widget.config.calendars)) widget.config.calendars = [];
  const seen = new Set();
  widget.config.calendars = widget.config.calendars.slice(0, CALENDAR_MAX_SOURCES).map((entry, index) => {
    const source = entry && typeof entry === 'object' ? entry : {};
    let id = String(source.id || '').trim();
    if (!id || seen.has(id)) id = _calendarNewSourceId();
    seen.add(id);
    const color = /^#[0-9a-f]{6}$/i.test(String(source.color || ''))
      ? String(source.color).toLowerCase()
      : CALENDAR_SOURCE_COLORS[index % CALENDAR_SOURCE_COLORS.length];
    const type = CALENDAR_SOURCE_TYPES.has(source.type) ? source.type : 'proton';
    const normalized = {
      id,
      name: String(source.name || '').trim(),
      color,
      type
    };
    if (type === 'ukHolidays') normalized.region = ['england-and-wales', 'scotland', 'northern-ireland'].includes(source.region)
      ? source.region : 'england-and-wales';
    if (type === 'launches') {
      normalized.limit = Math.min(50, Math.max(5, Number.parseInt(source.limit, 10) || 20));
      normalized.search = String(source.search || '').trim().slice(0, 80);
    }
    if (type === 'football') {
      normalized.mode = source.mode === 'team' ? 'team' : 'competition';
      normalized.competitionCode = String(source.competitionCode || 'PL').trim().toUpperCase().slice(0, 12);
      normalized.teamId = String(source.teamId || '').replace(/\D/g, '').slice(0, 12);
    }
    return normalized;
  });
  return widget.config.calendars;
}

function _calendarNormalizeAgendaDays(value) {
  const parsed = Number.parseInt(value, 10);
  return [7, 14, 30, 60].includes(parsed) ? parsed : 14;
}

function _calendarNormalizeRefreshMinutes(value) {
  const parsed = Number.parseInt(value, 10);
  return [30, 60, 180, 360].includes(parsed) ? parsed : 60;
}

function _calendarSecretKey(widgetId, sourceId) {
  return `proton-calendar:${widgetId}:${sourceId}`;
}

function _calendarSourceNeedsSecret(source) {
  return source.type === 'proton' || source.type === 'ics';
}

function _calendarSourceUsesCredential(source) {
  return _calendarSourceNeedsSecret(source) || source.type === 'football';
}

function _calendarViewKey(widgetId) {
  return `${CALENDAR_VIEW_PREFIX}${widgetId}`;
}

function _calendarReadView(widget) {
  if (_calendarViewMemory.has(widget.id)) return _calendarViewMemory.get(widget.id);
  const stored = WidgetSDK.cache.get('protonCalendar', widget.id, 'view')
    || WidgetSDK.cache.migrateLegacy('protonCalendar', widget.id, 'view', _calendarViewKey(widget.id));
  const defaultMode = widget.config?.defaultView === 'month' ? 'month' : 'agenda';
  const anchor = Number(stored?.anchor);
  const view = {
    mode: ['agenda', 'month'].includes(stored?.mode) ? stored.mode : defaultMode,
    anchor: Number.isFinite(anchor) ? anchor : new Date().setHours(0, 0, 0, 0),
    hiddenSourceIds: Array.isArray(stored?.hiddenSourceIds) ? stored.hiddenSourceIds.map(String) : [],
    openEventIds: Array.isArray(stored?.openEventIds) ? stored.openEventIds.map(String).slice(-100) : [],
    scrollTop: {
      agenda: Math.max(0, Math.min(100000, Number(stored?.scrollTop?.agenda) || 0)),
      month: Math.max(0, Math.min(100000, Number(stored?.scrollTop?.month) || 0))
    }
  };
  _calendarViewMemory.set(widget.id, view);
  return view;
}

function _calendarWriteView(widget, updates = {}) {
  const current = _calendarReadView(widget);
  const view = {
    mode: ['agenda', 'month'].includes(updates.mode) ? updates.mode : current.mode,
    anchor: Number.isFinite(Number(updates.anchor)) ? Number(updates.anchor) : current.anchor,
    hiddenSourceIds: Array.isArray(updates.hiddenSourceIds) ? updates.hiddenSourceIds.map(String) : current.hiddenSourceIds,
    openEventIds: Array.isArray(updates.openEventIds) ? updates.openEventIds.map(String).slice(-100) : current.openEventIds,
    scrollTop: {
      agenda: Math.max(0, Math.min(100000, Number(updates.scrollTop?.agenda ?? current.scrollTop?.agenda) || 0)),
      month: Math.max(0, Math.min(100000, Number(updates.scrollTop?.month ?? current.scrollTop?.month) || 0))
    }
  };
  _calendarViewMemory.set(widget.id, view);
  try { WidgetSDK.cache.set('protonCalendar', widget.id, 'view', view); } catch {}
  return view;
}

function _calendarGetRuntime(widgetId) {
  let runtime = _calendarRuntime.get(widgetId);
  if (!runtime) {
    runtime = {
      loading: false,
      generation: 0,
      secretsLoaded: false,
      secrets: new Map(),
      events: [],
      fetchedAt: 0,
      nextRetryAt: 0,
      errors: [],
      sourceTitles: new Map()
    };
    _calendarRuntime.set(widgetId, runtime);
  }
  return runtime;
}

function _calendarNormalizeShareUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const normalized = /^webcal:/i.test(raw) ? `https:${raw.slice(raw.indexOf(':') + 1)}` : raw;
    const url = new URL(normalized);
    return url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}

function _calendarUnescapeText(value) {
  return String(value || '')
    .replace(/\\[nN]/g, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .trim();
}

function _calendarParsePropertyLine(line) {
  let quoted = false;
  let separator = -1;
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === '"') quoted = !quoted;
    if (line[index] === ':' && !quoted) {
      separator = index;
      break;
    }
  }
  if (separator < 1) return null;
  const left = line.slice(0, separator);
  const segments = left.split(';');
  const name = String(segments.shift() || '').toUpperCase();
  const params = {};
  segments.forEach(segment => {
    const equals = segment.indexOf('=');
    if (equals < 1) return;
    params[segment.slice(0, equals).toUpperCase()] = segment.slice(equals + 1).replace(/^"|"$/g, '');
  });
  return { name, params, value: line.slice(separator + 1) };
}

function _calendarZonedTimestamp(parts, timeZone) {
  const utcGuess = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour || 0, parts.minute || 0, parts.second || 0);
  if (!timeZone || /^(UTC|GMT)$/i.test(timeZone)) return utcGuess;
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: 'h23'
    });
    let timestamp = utcGuess;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const values = {};
      formatter.formatToParts(new Date(timestamp)).forEach(part => {
        if (part.type !== 'literal') values[part.type] = Number(part.value);
      });
      const represented = Date.UTC(values.year, values.month - 1, values.day, values.hour, values.minute, values.second);
      const difference = utcGuess - represented;
      timestamp += difference;
      if (!difference) break;
    }
    return timestamp;
  } catch {
    return new Date(parts.year, parts.month - 1, parts.day, parts.hour || 0, parts.minute || 0, parts.second || 0).getTime();
  }
}

function _calendarParseDateValue(value, params = {}, fallbackTimeZone = '') {
  const raw = String(value || '').trim();
  const dateOnly = params.VALUE === 'DATE' || /^\d{8}$/.test(raw);
  const match = raw.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?)?(Z)?$/);
  if (!match) return null;
  const parts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4] || 0),
    minute: Number(match[5] || 0),
    second: Number(match[6] || 0)
  };
  let timestamp;
  if (match[7]) timestamp = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  else if (dateOnly) timestamp = new Date(parts.year, parts.month - 1, parts.day).getTime();
  else timestamp = _calendarZonedTimestamp(parts, params.TZID || fallbackTimeZone);
  return { timestamp, allDay: dateOnly, parts, timeZone: params.TZID || fallbackTimeZone || '' };
}

function _calendarParseDuration(value) {
  const match = String(value || '').match(/^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i);
  if (!match) return 0;
  return ((Number(match[1] || 0) * 7 + Number(match[2] || 0)) * 86400000)
    + Number(match[3] || 0) * 3600000
    + Number(match[4] || 0) * 60000
    + Number(match[5] || 0) * 1000;
}

function _calendarParseRule(value) {
  const rule = {};
  String(value || '').split(';').forEach(part => {
    const equals = part.indexOf('=');
    if (equals > 0) rule[part.slice(0, equals).toUpperCase()] = part.slice(equals + 1).toUpperCase();
  });
  return rule;
}

function _calendarDayNumber(parts) {
  return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / 86400000);
}

function _calendarPartsForDay(startParts, dayOffset) {
  const date = new Date(Date.UTC(startParts.year, startParts.month - 1, startParts.day + dayOffset));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: startParts.hour || 0,
    minute: startParts.minute || 0,
    second: startParts.second || 0
  };
}

function _calendarByDayMatches(parts, token) {
  const match = String(token || '').match(/^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/);
  if (!match) return false;
  const weekday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  if (CALENDAR_WEEKDAYS[weekday] !== match[2]) return false;
  if (!match[1]) return true;
  const ordinal = Number(match[1]);
  if (ordinal > 0) return Math.ceil(parts.day / 7) === ordinal;
  const lastDay = new Date(Date.UTC(parts.year, parts.month, 0)).getUTCDate();
  return -Math.ceil((lastDay - parts.day + 1) / 7) === ordinal;
}

function _calendarRuleMatches(rule, startParts, candidateParts, dayOffset) {
  const frequency = rule.FREQ;
  const interval = Math.max(1, Number.parseInt(rule.INTERVAL || '1', 10) || 1);
  const byDays = String(rule.BYDAY || '').split(',').filter(Boolean);
  const byMonthDays = String(rule.BYMONTHDAY || '').split(',').filter(Boolean).map(Number).filter(Number.isFinite);
  const byMonths = String(rule.BYMONTH || '').split(',').filter(Boolean).map(Number).filter(Number.isFinite);
  if (byMonths.length && !byMonths.includes(candidateParts.month)) return false;
  if (byMonthDays.length) {
    const lastDay = new Date(Date.UTC(candidateParts.year, candidateParts.month, 0)).getUTCDate();
    const matchesDay = byMonthDays.some(day => day > 0 ? candidateParts.day === day : candidateParts.day === lastDay + day + 1);
    if (!matchesDay) return false;
  }
  if (byDays.length && !byDays.some(day => _calendarByDayMatches(candidateParts, day))) return false;

  if (frequency === 'DAILY') return dayOffset % interval === 0;
  if (frequency === 'WEEKLY') {
    if (Math.floor(dayOffset / 7) % interval !== 0) return false;
    return byDays.length || new Date(Date.UTC(candidateParts.year, candidateParts.month - 1, candidateParts.day)).getUTCDay()
      === new Date(Date.UTC(startParts.year, startParts.month - 1, startParts.day)).getUTCDay();
  }
  if (frequency === 'MONTHLY') {
    const months = (candidateParts.year - startParts.year) * 12 + candidateParts.month - startParts.month;
    if (months < 0 || months % interval !== 0) return false;
    return byMonthDays.length || byDays.length || candidateParts.day === startParts.day;
  }
  if (frequency === 'YEARLY') {
    const years = candidateParts.year - startParts.year;
    if (years < 0 || years % interval !== 0) return false;
    if (!byMonths.length && candidateParts.month !== startParts.month) return false;
    return byMonthDays.length || byDays.length || candidateParts.day === startParts.day;
  }
  return dayOffset === 0;
}

function _calendarBuildEvent(properties, source) {
  const first = name => properties.find(property => property.name === name) || null;
  const startProperty = first('DTSTART');
  const start = startProperty ? _calendarParseDateValue(startProperty.value, startProperty.params) : null;
  if (!start) return null;
  const endProperty = first('DTEND');
  const parsedEnd = endProperty ? _calendarParseDateValue(endProperty.value, endProperty.params, start.timeZone) : null;
  const durationProperty = first('DURATION');
  const duration = parsedEnd
    ? Math.max(0, parsedEnd.timestamp - start.timestamp)
    : (_calendarParseDuration(durationProperty?.value) || (start.allDay ? 86400000 : 3600000));
  const recurrenceProperty = first('RECURRENCE-ID');
  const recurrence = recurrenceProperty
    ? _calendarParseDateValue(recurrenceProperty.value, recurrenceProperty.params, start.timeZone)
    : null;
  const exdates = properties
    .filter(property => property.name === 'EXDATE')
    .flatMap(property => String(property.value || '').split(',').map(value => _calendarParseDateValue(value, property.params, start.timeZone)?.timestamp))
    .filter(Number.isFinite);
  return {
    uid: _calendarUnescapeText(first('UID')?.value) || `${source.id}:${start.timestamp}:${_calendarUnescapeText(first('SUMMARY')?.value)}`,
    title: _calendarUnescapeText(first('SUMMARY')?.value) || 'Untitled event',
    description: _calendarUnescapeText(first('DESCRIPTION')?.value),
    location: _calendarUnescapeText(first('LOCATION')?.value),
    url: _calendarNormalizeShareUrl(_calendarUnescapeText(first('URL')?.value)),
    status: String(first('STATUS')?.value || '').toUpperCase(),
    start,
    duration,
    recurrenceId: recurrence?.timestamp ?? null,
    rule: first('RRULE') ? _calendarParseRule(first('RRULE').value) : null,
    exdates: new Set(exdates),
    sourceId: source.id,
    sourceName: source.name,
    color: source.color
  };
}

function _calendarOccurrence(event, startTimestamp, recurrenceId = null) {
  return {
    id: `${event.sourceId}:${event.uid}:${recurrenceId ?? startTimestamp}`,
    uid: event.uid,
    title: event.title,
    description: event.description,
    location: event.location,
    url: event.url,
    start: startTimestamp,
    end: startTimestamp + event.duration,
    allDay: event.start.allDay,
    sourceId: event.sourceId,
    sourceName: event.sourceName,
    color: event.color,
    recurrenceId
  };
}

function _calendarExpandEvent(event, rangeStart, rangeEnd) {
  if (event.status === 'CANCELLED') return [];
  if (!event.rule?.FREQ) {
    const occurrence = _calendarOccurrence(event, event.start.timestamp, event.recurrenceId);
    return occurrence.end > rangeStart && occurrence.start < rangeEnd ? [occurrence] : [];
  }
  const countLimit = Math.max(0, Number.parseInt(event.rule.COUNT || '0', 10) || 0);
  const untilValue = event.rule.UNTIL
    ? _calendarParseDateValue(event.rule.UNTIL, {}, event.start.timeZone)?.timestamp
    : null;
  const startDayNumber = _calendarDayNumber(event.start.parts);
  const rangeStartDate = new Date(rangeStart);
  const rangeEndDate = new Date(rangeEnd);
  const rangeStartOffset = _calendarDayNumber({
    year: rangeStartDate.getUTCFullYear(),
    month: rangeStartDate.getUTCMonth() + 1,
    day: rangeStartDate.getUTCDate()
  }) - startDayNumber;
  const rangeEndOffset = _calendarDayNumber({
    year: rangeEndDate.getUTCFullYear(),
    month: rangeEndDate.getUTCMonth() + 1,
    day: rangeEndDate.getUTCDate()
  }) - startDayNumber + 2;
  const firstCandidateDay = countLimit ? 0 : Math.max(0, rangeStartOffset - 31);
  const lastCandidateDay = Math.max(
    firstCandidateDay,
    Math.min(rangeEndOffset, firstCandidateDay + CALENDAR_MAX_RECURRENCE_DAYS)
  );
  const occurrences = [];
  let matchedCount = 0;
  for (let dayOffset = firstCandidateDay; dayOffset <= lastCandidateDay; dayOffset += 1) {
    const parts = _calendarPartsForDay(event.start.parts, dayOffset);
    if (!_calendarRuleMatches(event.rule, event.start.parts, parts, dayOffset)) continue;
    const timestamp = event.start.allDay
      ? new Date(parts.year, parts.month - 1, parts.day).getTime()
      : _calendarZonedTimestamp(parts, event.start.timeZone);
    if (Number.isFinite(untilValue) && timestamp > untilValue) break;
    matchedCount += 1;
    if (countLimit && matchedCount > countLimit) break;
    if (event.exdates.has(timestamp)) continue;
    const occurrence = _calendarOccurrence(event, timestamp, timestamp);
    if (occurrence.end > rangeStart && occurrence.start < rangeEnd) occurrences.push(occurrence);
  }
  return occurrences;
}

function _calendarParseIcs(text, source, now = Date.now()) {
  const normalized = String(text || '').replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
  if (!/BEGIN:VCALENDAR/i.test(normalized)) throw new Error('The link did not return an iCalendar file.');
  const lines = normalized.split(/\r?\n/);
  const eventBlocks = [];
  let current = null;
  let calendarTitle = source.name || 'Calendar';
  lines.forEach(line => {
    if (line === 'BEGIN:VEVENT') {
      current = [];
      return;
    }
    if (line === 'END:VEVENT') {
      if (current) eventBlocks.push(current);
      current = null;
      return;
    }
    const property = _calendarParsePropertyLine(line);
    if (!property) return;
    if (current) current.push(property);
    else if (property.name === 'X-WR-CALNAME' && property.value) calendarTitle = _calendarUnescapeText(property.value);
  });
  const definitions = eventBlocks.map(block => _calendarBuildEvent(block, source)).filter(Boolean);
  const rangeStart = now - CALENDAR_RANGE_BEHIND_DAYS * 86400000;
  const rangeEnd = now + CALENDAR_RANGE_AHEAD_DAYS * 86400000;
  const overrides = new Map();
  definitions.filter(event => Number.isFinite(event.recurrenceId)).forEach(event => {
    overrides.set(`${event.uid}:${event.recurrenceId}`, event);
  });
  const events = [];
  definitions.filter(event => !Number.isFinite(event.recurrenceId)).forEach(event => {
    _calendarExpandEvent(event, rangeStart, rangeEnd).forEach(occurrence => {
      const override = overrides.get(`${event.uid}:${occurrence.recurrenceId}`);
      if (!override) {
        events.push(occurrence);
        return;
      }
      if (override.status !== 'CANCELLED') events.push(_calendarOccurrence(override, override.start.timestamp, override.recurrenceId));
      overrides.delete(`${event.uid}:${occurrence.recurrenceId}`);
    });
  });
  overrides.forEach(override => {
    if (override.status !== 'CANCELLED') events.push(_calendarOccurrence(override, override.start.timestamp, override.recurrenceId));
  });
  return { title: calendarTitle, events: events.sort((left, right) => left.start - right.start || left.end - right.end) };
}

async function _calendarFetchText(url, headers = {}, widgetId = 'shared') {
  let directError = null;
  try {
    const response = await _fetchWithTimeout(url, {
      widgetType: 'protonCalendar',
      widgetFetchKey: `calendar:${widgetId}:${++_calendarRequestSequence}`,
      maxResponseBytes: CALENDAR_MAX_RESPONSE_CHARS,
      credentials: 'omit',
      redirect: 'follow',
      cache: 'no-store',
      headers: { Accept: 'text/calendar, text/plain, application/octet-stream;q=0.5, */*;q=0.1', ...headers }
    }, 15000);
    if (!response.ok) throw new Error(`Calendar returned ${response.status}`);
    const text = await response.text();
    if (text.length > CALENDAR_MAX_RESPONSE_CHARS) throw new Error('Calendar exceeds the 2 MiB response limit.');
    return text;
  } catch (error) {
    directError = error;
  }
  try {
    const relayed = await WidgetSDK.extensionRelay.invoke('protonCalendar', 'fetchCalendar', url, headers);
    if (relayed?.text) return relayed.text;
  } catch {
    try {
      const relayed = await WidgetSDK.extensionRelay.invoke('protonCalendar', 'fetchFeed', url);
      if (relayed?.text) return relayed.text;
    } catch {}
  }
  const reason = ['AbortError', 'TimeoutError'].includes(directError?.name) ? 'Calendar request timed out.' : (directError?.message || 'Calendar request failed.');
  throw new Error(`${reason} The extension relay could not fetch it either.`);
}

async function _calendarFetchJson(url, headers = {}, widgetId = 'shared') {
  const text = await _calendarFetchText(url, { Accept: 'application/json, */*;q=0.2', ...headers }, widgetId);
  try { return JSON.parse(text); } catch { throw new Error('Calendar provider returned invalid JSON.'); }
}

function _calendarProviderEvent(source, values) {
  const start = Number(values.start);
  const allDay = values.allDay === true;
  const end = Number(values.end) || start + (allDay ? 86400000 : 3600000);
  return {
    id: `${source.id}:${values.id || start}:${values.title || ''}`,
    uid: String(values.id || `${source.id}-${start}`),
    title: String(values.title || 'Untitled event'),
    description: String(values.description || '').trim(),
    location: String(values.location || '').trim(),
    url: _calendarNormalizeShareUrl(values.url),
    start, end: Math.max(end, start + 60000), allDay,
    moonPhaseAngle: Number.isFinite(Number(values.moonPhaseAngle)) ? Number(values.moonPhaseAngle) : null,
    moonPhaseQuarter: Number.isInteger(values.moonPhaseQuarter) ? values.moonPhaseQuarter : null,
    sourceId: source.id,
    sourceName: source.name || CALENDAR_SOURCE_DEFAULT_NAMES[source.type],
    color: source.color
  };
}

function _calendarDateOnlyTimestamp(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime() : NaN;
}

async function _calendarLoadUkHolidays(source, widgetId) {
  const data = await _calendarFetchJson('https://www.gov.uk/bank-holidays.json', {}, widgetId);
  const division = data?.[source.region || 'england-and-wales'];
  if (!division || !Array.isArray(division.events)) throw new Error('UK bank-holiday region was not found.');
  return division.events.map(event => {
    const start = _calendarDateOnlyTimestamp(event.date);
    return _calendarProviderEvent(source, { id: `${source.region}:${event.date}:${event.title}`, title: event.title, start, allDay: true });
  }).filter(event => Number.isFinite(event.start));
}

function _calendarAstroDate(value) {
  if (value?.date instanceof Date) return value.date;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function _calendarLoadAstronomy(source) {
  const events = [];
  const add = (dateValue, id, title, description = '') => {
    const date = _calendarAstroDate(dateValue);
    if (!date) return;
    events.push(_calendarProviderEvent(source, { id, title, description, start: date.getTime(), end: date.getTime() + 3600000 }));
  };
  const now = new Date();
  if (typeof Astronomy !== 'undefined') {
    for (let year = now.getUTCFullYear() - 1; year <= now.getUTCFullYear() + 2; year += 1) {
      const seasons = Astronomy.Seasons(year);
      add(seasons.mar_equinox, `march-equinox-${year}`, 'March equinox');
      add(seasons.jun_solstice, `june-solstice-${year}`, 'June solstice');
      add(seasons.sep_equinox, `september-equinox-${year}`, 'September equinox');
      add(seasons.dec_solstice, `december-solstice-${year}`, 'December solstice');
    }
  }
  const catalog = globalThis.ASTRONOMY_EVENT_CATALOG || {};
  for (const shower of (catalog.meteorShowers || [])) {
    for (let year = now.getUTCFullYear() - 1; year <= now.getUTCFullYear() + 2; year += 1) {
      const [month, day] = shower.peak;
      add(new Date(Date.UTC(year, month - 1, day, 12)), `${shower.id}-${year}`, `${shower.name} peak`, `Meteor shower · up to ${shower.zhr} meteors/hour · ${shower.hemisphere}`);
    }
  }
  for (const approach of (catalog.closeApproaches || [])) {
    add(approach.date, approach.id, `${approach.name} close approach`, `${(Number(approach.distanceAu) * 149.5978707).toFixed(1)} million km from Earth`);
  }
  return events;
}

function _calendarLoadMoonPhases(source, now = new Date()) {
  if (typeof Astronomy === 'undefined') return [];
  const rangeStart = now.getTime() - CALENDAR_RANGE_BEHIND_DAYS * 86400000;
  const rangeEnd = now.getTime() + CALENDAR_RANGE_AHEAD_DAYS * 86400000;
  const names = ['New moon', 'First quarter moon', 'Full moon', 'Last quarter moon'];
  const angles = [0, 90, 180, 270];
  const events = [];
  let quarter = Astronomy.SearchMoonQuarter(new Date(rangeStart - 10 * 86400000));
  for (let count = 0; quarter && count < 180; count += 1) {
    const date = _calendarAstroDate(quarter.time);
    if (!date) break;
    if (date.getTime() > rangeEnd) break;
    if (date.getTime() >= rangeStart) {
      events.push(_calendarProviderEvent(source, {
        id: `moon-${quarter.quarter}-${date.toISOString()}`,
        title: names[quarter.quarter] || 'Moon phase',
        description: 'Principal lunar phase',
        start: date.getTime(), end: date.getTime() + 3600000,
        moonPhaseQuarter: quarter.quarter,
        moonPhaseAngle: angles[quarter.quarter]
      }));
    }
    quarter = Astronomy.NextMoonQuarter(quarter);
  }
  return events;
}

async function _calendarLoadLaunches(source, widgetId) {
  const limit = Math.min(50, Math.max(5, Number(source.limit) || 20));
  const data = await _calendarFetchJson(`https://ll.thespacedevs.com/2.3.0/launches/upcoming/?format=json&limit=${limit}&ordering=net`, {}, widgetId);
  const search = String(source.search || '').toLowerCase();
  return (data?.results || []).filter(launch => !search || JSON.stringify(launch).toLowerCase().includes(search)).map(launch => {
    const start = Date.parse(launch.net || launch.window_start);
    const mission = launch.mission?.description || launch.mission?.name || '';
    const provider = launch.launch_service_provider?.name || '';
    const pad = [launch.pad?.name, launch.pad?.location?.name].filter(Boolean).join(' · ');
    return _calendarProviderEvent(source, {
      id: launch.id, title: launch.name, start, end: Date.parse(launch.window_end) || start + 3600000,
      description: [launch.status?.name, provider, mission].filter(Boolean).join('\n'), location: pad
    });
  }).filter(event => Number.isFinite(event.start));
}

async function _calendarLoadFootball(source, token, widgetId) {
  const now = new Date();
  const format = date => date.toISOString().slice(0, 10);
  const from = format(new Date(now.getTime() - 31 * 86400000));
  const to = format(new Date(now.getTime() + 365 * 86400000));
  let path;
  if (source.mode === 'team') {
    if (!source.teamId) throw new Error('Add a football-data.org team ID in settings.');
    path = `teams/${source.teamId}/matches`;
  } else {
    if (!source.competitionCode) throw new Error('Add a football competition code in settings.');
    path = `competitions/${encodeURIComponent(source.competitionCode)}/matches`;
  }
  const data = await _calendarFetchJson(`https://api.football-data.org/v4/${path}?dateFrom=${from}&dateTo=${to}`, { 'X-Auth-Token': token }, widgetId);
  return (data?.matches || []).map(match => {
    const start = Date.parse(match.utcDate);
    const title = `${match.homeTeam?.name || 'TBC'} vs ${match.awayTeam?.name || 'TBC'}`;
    return _calendarProviderEvent(source, {
      id: match.id, title, start, end: start + 2 * 3600000,
      description: [match.competition?.name, match.stage, match.status, match.matchday ? `Matchday ${match.matchday}` : ''].filter(Boolean).join(' · '),
      location: match.venue || ''
    });
  }).filter(event => Number.isFinite(event.start));
}

function _calendarSportsDbDate(event) {
  const timestamp = Date.parse(event.strTimestamp || '');
  if (Number.isFinite(timestamp)) return { start: timestamp, allDay: false };
  const date = _calendarDateOnlyTimestamp(event.dateEvent);
  const time = String(event.strTime || '').match(/^(\d{2}):(\d{2})/);
  return { start: date + (time ? (Number(time[1]) * 60 + Number(time[2])) * 60000 : 0), allDay: !time };
}

function _calendarParsePdcApi(data, source) {
  return (data?.data || []).map(record => {
    const attributes = record?.attributes || {};
    const start = _calendarDateOnlyTimestamp(attributes.startDate);
    const inclusiveEnd = _calendarDateOnlyTimestamp(attributes.endDate || attributes.startDate);
    const informationPage = String(attributes.informationPage || '');
    return _calendarProviderEvent(source, {
      id: record.id, title: attributes.name, start, end: inclusiveEnd + 86400000, allDay: true,
      description: [attributes.isRanked ? 'Ranked' : '', attributes.isTelevised ? 'Televised' : ''].filter(Boolean).join(' · '),
      location: [attributes.venue, attributes.city].filter(Boolean).join(' · '),
      url: informationPage.startsWith('/') ? `https://www.pdc.tv${informationPage}` : 'https://www.pdc.tv/tournaments/calendar'
    });
  }).filter(event => Number.isFinite(event.start));
}

async function _calendarLoadPdc(source, widgetId) {
  const year = new Date().getFullYear();
  const seasons = [year - 1, year, year + 1];
  const officialResults = await Promise.all(seasons.map(season =>
    _calendarFetchJson(`https://tournaments.darts.web.gc.pdcservices.co.uk/v2/calendar?page.size=500&filter=seasonID:eq:${season}`, {}, widgetId)
      .then(data => _calendarParsePdcApi(data, source)).catch(() => [])));
  const officialEvents = officialResults.flat();
  if (officialEvents.length) return officialEvents.sort((left, right) => left.start - right.start || left.title.localeCompare(right.title));

  const requests = [year, year + 1].map(season =>
    _calendarFetchJson(`https://www.thesportsdb.com/api/v1/json/123/eventsseason.php?id=4554&s=${season}`, {}, widgetId));
  const responses = await Promise.all(requests.map(request => request.catch(error => ({ events: [], _error: error }))));
  const rawEvents = responses.flatMap(result => result?.events || []);
  if (!rawEvents.length && responses.every(result => result?._error)) throw responses[0]._error;
  const unique = new Map();
  rawEvents.forEach(event => unique.set(String(event.idEvent || `${event.dateEvent}:${event.strEvent}`), event));
  return [...unique.values()].map(event => {
    const timing = _calendarSportsDbDate(event);
    return _calendarProviderEvent(source, {
      id: event.idEvent, title: event.strEvent || event.strEventAlternate || 'PDC event', start: timing.start,
      end: timing.start + (timing.allDay ? 86400000 : 4 * 3600000), allDay: timing.allDay,
      description: [event.strLeague, event.strStatus, event.strDescription].filter(Boolean).join('\n'),
      location: [event.strVenue, event.strCity, event.strCountry].filter(Boolean).join(' · '),
      url: event.idEvent ? `https://www.thesportsdb.com/event/${event.idEvent}` : ''
    });
  }).filter(event => Number.isFinite(event.start));
}

async function _calendarLoadSecrets(widget, runtime) {
  if (runtime.secretsLoaded) return runtime.secrets;
  const sources = _calendarSources(widget).filter(_calendarSourceNeedsSecret);
  if (!sources.length) { runtime.secretsLoaded = true; return runtime.secrets; }
  const status = await WidgetSDK.credentials.status('protonCalendar');
  if (!status?.available) return runtime.secrets;
  const pairs = await Promise.all(sources.map(async source => [
    source.id,
    String(await WidgetSDK.credentials.get('protonCalendar', _calendarSecretKey(widget.id, source.id)) || '').trim()
  ]));
  runtime.secrets = new Map(pairs);
  runtime.secretsLoaded = true;
  return runtime.secrets;
}

function _calendarDataFresh(widget, runtime) {
  const now = Date.now();
  if (runtime.errors.length) return runtime.nextRetryAt > now;
  return runtime.fetchedAt > 0
    && now - runtime.fetchedAt < _calendarNormalizeRefreshMinutes(widget.config?.refreshMinutes) * 60000;
}

function _calendarEnsureData(widget, options = {}) {
  const runtime = _calendarGetRuntime(widget.id);
  if (runtime.loading) return runtime.request || null;
  if (!options.force && _calendarDataFresh(widget, runtime)) return null;
  runtime.loading = true;
  runtime.errors = [];
  const generation = ++runtime.generation;
  const request = _calendarLoadSecrets(widget, runtime)
    .then(async secrets => {
      const sources = _calendarSources(widget);
      if (!sources.length) return { events: [], titles: new Map(), errors: [] };
      const results = await Promise.all(sources.map(async source => {
        try {
          let events = [];
          let title = '';
          if (source.type === 'proton' || source.type === 'ics') {
            const url = _calendarNormalizeShareUrl(secrets.get(source.id));
            if (!url) throw new Error(`Add a ${source.type === 'proton' ? 'Proton share' : 'public ICS'} URL in settings.`);
            const parsed = _calendarParseIcs(await _calendarFetchText(url, {}, widget.id), source);
            events = parsed.events; title = parsed.title;
          } else if (source.type === 'ukHolidays') events = await _calendarLoadUkHolidays(source, widget.id);
          else if (source.type === 'astronomy') events = _calendarLoadAstronomy(source);
          else if (source.type === 'moonPhases') events = _calendarLoadMoonPhases(source);
          else if (source.type === 'launches') events = await _calendarLoadLaunches(source, widget.id);
          else if (source.type === 'football') {
            const token = typeof getServiceSecret === 'function' ? getServiceSecret('footballData') : '';
            if (!token) throw new Error('Add a football-data.org API token in Settings > API Keys.');
            events = await _calendarLoadFootball(source, token, widget.id);
          } else if (source.type === 'pdc') events = await _calendarLoadPdc(source, widget.id);
          else if (source.type === 'mediaWatchlist') events = typeof _mediaWatchlistCalendarEvents === 'function' ? _mediaWatchlistCalendarEvents(source) : [];
          return { source, parsed: { events, title } };
        } catch (error) {
          return { source, error: error?.message || 'Unable to load this calendar.' };
        }
      }));
      const events = [];
      const titles = new Map();
      const errors = [];
      results.forEach(result => {
        if (result.parsed) {
          events.push(...result.parsed.events);
          titles.set(result.source.id, result.parsed.title);
        } else if (result.error) {
          errors.push(`${result.source.name || 'Calendar'}: ${result.error}`);
        }
      });
      return { events: events.sort((left, right) => left.start - right.start || left.end - right.end), titles, errors };
    })
    .then(result => {
      if (runtime.generation !== generation) return;
      runtime.events = result.events;
      runtime.sourceTitles = result.titles;
      runtime.errors = result.errors;
      runtime.fetchedAt = Date.now();
      runtime.nextRetryAt = result.errors.length ? Date.now() + 15 * 60000 : 0;
    })
    .catch(error => {
      if (runtime.generation !== generation) return;
      runtime.errors = [error?.message || 'Unable to load calendars.'];
      runtime.nextRetryAt = Date.now() + 15 * 60000;
    })
    .finally(() => {
      if (runtime.generation === generation) {
        runtime.loading = false;
        runtime.request = null;
        _refreshWidget(widget.id, 'column');
      }
    });
  runtime.request = request;
  return request;
}

function _calendarStartOfDay(value) {
  const date = new Date(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function _calendarAddDays(value, days) {
  const date = new Date(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days).getTime();
}

function _calendarEventsInRange(events, start, end) {
  return events.filter(event => event.end > start && event.start < end);
}

function _calendarTimeLabel(event) {
  if (event.allDay) return 'All day';
  const start = new Date(event.start).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const end = new Date(event.end).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `${start}–${end}`;
}

function _calendarAppendEventDetails(parent, event, widget = null) {
  const details = document.createElement('details');
  details.className = 'widget-calendar-event';
  details.style.setProperty('--calendar-event-color', event.color);
  if (widget) {
    details.open = _calendarReadView(widget).openEventIds.includes(String(event.id));
    details.addEventListener('toggle', () => {
      const open = new Set(_calendarReadView(widget).openEventIds);
      if (details.open) open.add(String(event.id)); else open.delete(String(event.id));
      _calendarWriteView(widget, { openEventIds: [...open] });
    });
  }
  const summary = document.createElement('summary');
  const time = document.createElement('span');
  time.className = 'widget-calendar-event-time';
  time.textContent = _calendarTimeLabel(event);
  const title = document.createElement('span');
  title.className = 'widget-calendar-event-title';
  title.textContent = event.title;
  const source = document.createElement('span');
  source.className = 'widget-calendar-event-source';
  source.textContent = event.sourceName || 'Calendar';
  summary.append(time, title, source);
  details.appendChild(summary);
  if (event.location || event.description || event.url) {
    const body = document.createElement('div');
    body.className = 'widget-calendar-event-details';
    if (event.location) {
      const location = document.createElement('div');
      location.textContent = event.location;
      body.appendChild(location);
    }
    if (event.description) {
      const description = document.createElement('p');
      description.textContent = event.description;
      body.appendChild(description);
    }
    if (event.url) {
      const link = document.createElement('a');
      link.href = event.url;
      link.target = '_blank';
      link.rel = 'noreferrer noopener';
      link.textContent = 'Open event link';
      body.appendChild(link);
    }
    details.appendChild(body);
  }
  parent.appendChild(details);
}

function _calendarRenderAgenda(widget, container, runtime, view) {
  const start = _calendarStartOfDay(view.anchor);
  const end = _calendarAddDays(start, _calendarNormalizeAgendaDays(widget.config?.agendaDays));
  const events = _calendarEventsInRange(runtime.events, start, end);
  container.innerHTML = '';
  if (!events.length) {
    const empty = document.createElement('div');
    empty.className = 'widget-calendar-empty';
    empty.textContent = runtime.loading ? 'Loading calendar events…' : 'No events in this period.';
    container.appendChild(empty);
    return;
  }
  let currentDay = null;
  events.forEach(event => {
    const eventDay = _calendarStartOfDay(Math.max(event.start, start));
    if (eventDay !== currentDay) {
      currentDay = eventDay;
      const heading = document.createElement('div');
      heading.className = 'widget-calendar-day-heading';
      heading.textContent = new Date(eventDay).toLocaleDateString(undefined, {
        weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
      });
      container.appendChild(heading);
    }
    _calendarAppendEventDetails(container, event, widget);
  });
}

function _calendarMoonPath(phaseAngle) {
  const angle = ((Number(phaseAngle) % 360) + 360) % 360;
  const waxing = angle <= 180;
  const radians = angle * Math.PI / 180;
  const points = [];
  const steps = 24;
  for (let index = 0; index <= steps; index += 1) {
    const y = -1 + (2 * index / steps);
    const edge = Math.sqrt(Math.max(0, 1 - y * y));
    points.push([waxing ? edge : -edge, y]);
  }
  for (let index = steps; index >= 0; index -= 1) {
    const y = -1 + (2 * index / steps);
    const edge = Math.sqrt(Math.max(0, 1 - y * y));
    points.push([waxing ? Math.cos(radians) * edge : -Math.cos(radians) * edge, y]);
  }
  return points.map(([x, y], index) => `${index ? 'L' : 'M'} ${(50 + x * 48).toFixed(2)} ${(50 + y * 48).toFixed(2)}`).join(' ') + ' Z';
}

function _calendarCreateMoonIcon(event) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.classList.add('widget-calendar-moon-phase');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', event.title);
  const defs = document.createElementNS(ns, 'defs');
  const clip = document.createElementNS(ns, 'clipPath');
  const clipId = `calendar-moon-${++_calendarMoonIconSequence}`;
  clip.id = clipId;
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', _calendarMoonPath(event.moonPhaseAngle));
  clip.appendChild(path); defs.appendChild(clip);
  const darkImage = document.createElementNS(ns, 'image');
  darkImage.setAttribute('href', 'assets/astronomy/nasa-lro-moon-mosaic.png');
  darkImage.setAttribute('x', '2'); darkImage.setAttribute('y', '2'); darkImage.setAttribute('width', '96'); darkImage.setAttribute('height', '96');
  darkImage.setAttribute('preserveAspectRatio', 'xMidYMid slice'); darkImage.classList.add('widget-calendar-moon-dark');
  const litImage = darkImage.cloneNode(false);
  litImage.classList.remove('widget-calendar-moon-dark'); litImage.classList.add('widget-calendar-moon-lit');
  litImage.setAttribute('clip-path', `url(#${clipId})`);
  const rim = document.createElementNS(ns, 'circle');
  rim.setAttribute('cx', '50'); rim.setAttribute('cy', '50'); rim.setAttribute('r', '48'); rim.classList.add('widget-calendar-moon-rim');
  svg.append(defs, darkImage, litImage, rim);
  return svg;
}

function _calendarCloseDayAgenda() {
  if (!_calendarDayModal) return;
  const modal = _calendarDayModal;
  _calendarDayModal = null;
  document.removeEventListener('keydown', modal.onKeyDown);
  modal.overlay.remove();
  modal.previousFocus?.focus?.();
}

function _calendarOpenDayAgenda(widget, runtime, dayStart) {
  _calendarCloseDayAgenda();
  const dayEnd = _calendarAddDays(dayStart, 1);
  const dayEvents = _calendarEventsInRange(runtime.events, dayStart, dayEnd);
  const previousFocus = document.activeElement;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay calendar-day-modal-overlay';
  const card = document.createElement('section');
  card.className = 'modal-card calendar-day-modal-card';
  card.setAttribute('role', 'dialog'); card.setAttribute('aria-modal', 'true');
  const header = document.createElement('div'); header.className = 'calendar-day-modal-header';
  const heading = document.createElement('h3');
  heading.textContent = new Date(dayStart).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const close = document.createElement('button'); close.type = 'button'; close.className = 'icon-btn calendar-day-modal-close'; close.textContent = '×';
  close.title = 'Close day agenda'; close.setAttribute('aria-label', 'Close day agenda');
  header.append(heading, close);
  const body = document.createElement('div'); body.className = 'calendar-day-modal-body';
  const allDayEvents = dayEvents.filter(event => event.allDay);
  if (allDayEvents.length) {
    const allDay = document.createElement('section'); allDay.className = 'calendar-day-all-day';
    const label = document.createElement('div'); label.className = 'calendar-day-section-label'; label.textContent = 'All day'; allDay.appendChild(label);
    allDayEvents.forEach(event => _calendarAppendEventDetails(allDay, event)); body.appendChild(allDay);
  }
  const timeline = document.createElement('div'); timeline.className = 'calendar-day-timeline';
  const timedEvents = dayEvents.filter(event => !event.allDay);
  const eventsByHour = new Map();
  timedEvents.forEach(event => {
    const effectiveStart = Math.max(dayStart, event.start);
    const hour = Math.max(0, Math.min(23, Math.floor((effectiveStart - dayStart) / 3600000)));
    if (!eventsByHour.has(hour)) eventsByHour.set(hour, []);
    eventsByHour.get(hour).push(event);
  });
  for (let hour = 0; hour < 24; hour += 1) {
    const row = document.createElement('div'); row.className = 'calendar-day-hour'; row.dataset.hour = String(hour);
    const label = document.createElement('time'); label.className = 'calendar-day-hour-label';
    label.textContent = new Date(dayStart + hour * 3600000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    const events = document.createElement('div'); events.className = 'calendar-day-hour-events';
    (eventsByHour.get(hour) || []).forEach(event => _calendarAppendEventDetails(events, event));
    row.append(label, events); timeline.appendChild(row);
  }
  if (!dayEvents.length) {
    const empty = document.createElement('div'); empty.className = 'calendar-day-empty'; empty.textContent = 'No events scheduled for this day.'; body.appendChild(empty);
  }
  body.appendChild(timeline);
  const footer = document.createElement('div'); footer.className = 'calendar-day-modal-footer';
  const done = document.createElement('button'); done.type = 'button'; done.className = 'primary-btn'; done.textContent = 'Done'; footer.appendChild(done);
  card.append(header, body, footer); overlay.appendChild(card); document.body.appendChild(overlay);
  const onKeyDown = event => { if (event.key === 'Escape') _calendarCloseDayAgenda(); };
  _calendarDayModal = { overlay, onKeyDown, previousFocus, widgetId: widget.id };
  document.addEventListener('keydown', onKeyDown);
  close.addEventListener('click', _calendarCloseDayAgenda); done.addEventListener('click', _calendarCloseDayAgenda);
  overlay.addEventListener('click', event => { if (event.target === overlay) _calendarCloseDayAgenda(); });
  close.focus();
  WidgetSDK.runtime.requestFrame(`${widget.id}:calendar-day-scroll`, () => {
    const targetHour = dayStart === _calendarStartOfDay(Date.now())
      ? new Date().getHours()
      : (timedEvents.length ? Math.max(0, Math.min(23, Math.floor((Math.max(dayStart, timedEvents[0].start) - dayStart) / 3600000))) : 8);
    timeline.querySelector(`[data-hour="${targetHour}"]`)?.scrollIntoView({ block: 'start' });
  });
}

function _calendarRenderMonth(widget, container, runtime, view, rerender) {
  const anchor = new Date(view.anchor);
  const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const mondayFirst = widget.config?.weekStarts !== 'sunday';
  const firstOffset = mondayFirst ? (monthStart.getDay() + 6) % 7 : monthStart.getDay();
  const gridStart = new Date(monthStart.getFullYear(), monthStart.getMonth(), 1 - firstOffset).getTime();
  const weekdayFormatter = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
  container.innerHTML = '';
  const weekdays = document.createElement('div');
  weekdays.className = 'widget-calendar-weekdays';
  for (let index = 0; index < 7; index += 1) {
    const weekday = document.createElement('span');
    const baseSunday = new Date(2026, 7, 2 + index + (mondayFirst ? 1 : 0));
    weekday.textContent = weekdayFormatter.format(baseSunday).slice(0, 2);
    weekdays.appendChild(weekday);
  }
  const grid = document.createElement('div');
  grid.className = 'widget-calendar-month-grid widget-interactive-surface';
  const today = _calendarStartOfDay(Date.now());
  for (let index = 0; index < 42; index += 1) {
    const dayStart = _calendarAddDays(gridStart, index);
    const dayEnd = _calendarAddDays(dayStart, 1);
    const dayDate = new Date(dayStart);
    const cell = document.createElement('div');
    cell.className = 'widget-calendar-month-day';
    if (dayDate.getMonth() !== monthStart.getMonth()) cell.classList.add('is-outside');
    if (dayStart === today) cell.classList.add('is-today');
    const dayEvents = _calendarEventsInRange(runtime.events, dayStart, dayEnd);
    const dayHeader = document.createElement('div');
    dayHeader.className = 'widget-calendar-day-header';
    const number = document.createElement('button');
    number.type = 'button';
    number.className = 'widget-calendar-day-number';
    number.textContent = dayDate.getDate();
    number.title = `Open 24-hour agenda for ${dayDate.toLocaleDateString()}`;
    number.setAttribute('aria-label', number.title);
    number.addEventListener('click', event => {
      event.stopPropagation();
      _calendarOpenDayAgenda(widget, runtime, dayStart);
    });
    number.addEventListener('dblclick', event => event.stopPropagation());
    dayHeader.appendChild(number);
    const moonPhase = dayEvents.find(event => Number.isFinite(event.moonPhaseAngle));
    if (moonPhase) {
      const icon = _calendarCreateMoonIcon(moonPhase);
      icon.title = `${moonPhase.title} · ${new Date(moonPhase.start).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
      dayHeader.appendChild(icon);
    }
    cell.appendChild(dayHeader);
    dayEvents.slice(0, 3).forEach(event => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'widget-calendar-month-event';
      button.style.setProperty('--calendar-event-color', event.color);
      button.textContent = `${event.allDay ? '' : `${new Date(event.start).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })} `}${event.title}`;
      button.title = `${_calendarTimeLabel(event)} · ${event.title}`;
      button.addEventListener('click', eventClick => {
        eventClick.stopPropagation();
        _calendarWriteView(widget, { mode: 'agenda', anchor: dayStart });
        rerender();
      });
      cell.appendChild(button);
    });
    if (dayEvents.length > 3) {
      const more = document.createElement('span');
      more.className = 'widget-calendar-more';
      more.textContent = `+${dayEvents.length - 3} more`;
      cell.appendChild(more);
    }
    cell.addEventListener('dblclick', () => {
      _calendarWriteView(widget, { mode: 'agenda', anchor: dayStart });
      rerender();
    });
    grid.appendChild(cell);
  }
  container.append(weekdays, grid);
}

function _calendarRenderSettings(widget, container) {
  const config = widget.config || {};
  const sources = _calendarSources(widget);
  const secretDrafts = new Map();
  const initialTypes = new Map(sources.map(source => [source.id, source.type]));
  container.innerHTML = `
    <div class="calendar-settings-source-section">
      <div class="calendar-settings-source-label">Calendar sources</div>
      <div class="calendar-settings-source-list"></div>
      <button type="button" class="secondary-btn calendar-settings-add">Add source</button>
    </div>
    <div class="settings-row"><span>Default view</span><div class="board-fit-radios weather-option-radios">
      <label class="board-fit-label"><input type="radio" name="calendarDefaultView" data-cfg="defaultView" value="agenda" ${config.defaultView !== 'month' ? 'checked' : ''}/><span>Agenda</span></label>
      <label class="board-fit-label"><input type="radio" name="calendarDefaultView" data-cfg="defaultView" value="month" ${config.defaultView === 'month' ? 'checked' : ''}/><span>Month</span></label>
    </div></div>
    <div class="settings-row"><span>Agenda range</span><select class="settings-select" data-cfg="agendaDays">
      ${[7, 14, 30, 60].map(days => `<option value="${days}" ${_calendarNormalizeAgendaDays(config.agendaDays) === days ? 'selected' : ''}>${days} days</option>`).join('')}
    </select></div>
    <div class="settings-row"><span>Week starts</span><select class="settings-select" data-cfg="weekStarts">
      <option value="monday" ${config.weekStarts !== 'sunday' ? 'selected' : ''}>Monday</option><option value="sunday" ${config.weekStarts === 'sunday' ? 'selected' : ''}>Sunday</option>
    </select></div>
    <div class="settings-row"><span>Automatic refresh</span><select class="settings-select" data-cfg="refreshMinutes">
      ${[[30, '30 minutes'], [60, 'Hourly'], [180, 'Every 3 hours'], [360, 'Every 6 hours']].map(([minutes, label]) => `<option value="${minutes}" ${_calendarNormalizeRefreshMinutes(config.refreshMinutes) === minutes ? 'selected' : ''}>${label}</option>`).join('')}
    </select></div>
    <div class="settings-help calendar-settings-help">All sources merge into one read-only calendar. Private calendar URLs stay with their source in Windows Credential Manager; provider API keys are managed globally in Settings &gt; API Keys. Click a source name above the calendar to show or hide it.</div>
    <div class="calendar-settings-status settings-muted">Checking secure storage…</div>`;

  const list = container.querySelector('.calendar-settings-source-list');
  const addButton = container.querySelector('.calendar-settings-add');
  const status = container.querySelector('.calendar-settings-status');
  const option = (value, label, selected) => `<option value="${value}" ${selected === value ? 'selected' : ''}>${label}</option>`;
  const input = (value, placeholder, onInput, type = 'text') => {
    const field = document.createElement('input');
    field.type = type; field.className = 'settings-text-input'; field.value = value || ''; field.placeholder = placeholder;
    field.autocomplete = 'off'; field.addEventListener('input', () => onInput(field.value)); return field;
  };
  const renderProviderFields = (source, parent) => {
    parent.innerHTML = '';
    if (source.type === 'proton' || source.type === 'ics') {
      const secretRow = document.createElement('div'); secretRow.className = 'calendar-settings-url-row';
      const placeholder = source.type === 'proton' ? 'Proton sharing URL' : 'HTTPS iCalendar URL';
      const secret = input(secretDrafts.get(source.id) || '', placeholder, value => secretDrafts.set(source.id, value), 'password');
      secret.classList.add('calendar-settings-url');
      const reveal = document.createElement('button'); reveal.type = 'button'; reveal.className = 'secondary-btn calendar-settings-reveal'; reveal.textContent = 'Show';
      reveal.addEventListener('click', () => { secret.type = secret.type === 'password' ? 'text' : 'password'; reveal.textContent = secret.type === 'password' ? 'Show' : 'Hide'; });
      secretRow.append(secret, reveal); parent.appendChild(secretRow);
    }
    if (source.type === 'ukHolidays') {
      const region = document.createElement('select'); region.className = 'settings-select';
      region.innerHTML = option('england-and-wales', 'England and Wales', source.region) + option('scotland', 'Scotland', source.region) + option('northern-ireland', 'Northern Ireland', source.region);
      region.addEventListener('change', () => { source.region = region.value; }); parent.appendChild(region);
    }
    if (source.type === 'launches') {
      const row = document.createElement('div'); row.className = 'calendar-settings-provider-grid';
      const limit = document.createElement('select'); limit.className = 'settings-select';
      limit.innerHTML = [10, 20, 30, 50].map(value => option(String(value), `${value} upcoming launches`, String(source.limit))).join('');
      limit.addEventListener('change', () => { source.limit = Number(limit.value); });
      row.append(limit, input(source.search, 'Optional agency/mission filter', value => { source.search = value; })); parent.appendChild(row);
    }
    if (source.type === 'football') {
      const row = document.createElement('div'); row.className = 'calendar-settings-provider-grid';
      const mode = document.createElement('select'); mode.className = 'settings-select';
      mode.innerHTML = option('competition', 'Competition', source.mode) + option('team', 'Team', source.mode);
      const identifier = input(source.mode === 'team' ? source.teamId : source.competitionCode,
        source.mode === 'team' ? 'Team ID (e.g. 64)' : 'Competition code (e.g. PL)', value => {
          if (source.mode === 'team') source.teamId = value.replace(/\D/g, ''); else source.competitionCode = value.toUpperCase();
        });
      mode.addEventListener('change', () => { source.mode = mode.value; renderProviderFields(source, parent); });
      row.append(mode, identifier); parent.appendChild(row);
      const help = document.createElement('div'); help.className = 'settings-muted calendar-settings-inline-help'; help.textContent = 'API token managed globally in Settings > API Keys.'; parent.appendChild(help);
    }
    if (source.type === 'pdc') {
      const help = document.createElement('div'); help.className = 'settings-muted calendar-settings-inline-help'; help.textContent = 'Uses the official PDC tournament calendar, including ProTour, televised, development, challenge and qualifying events.'; parent.appendChild(help);
    }
    if (source.type === 'astronomy') {
      const help = document.createElement('div'); help.className = 'settings-muted calendar-settings-inline-help'; help.textContent = 'Solstices/equinoxes, meteor peaks and known close approaches; calculated locally.'; parent.appendChild(help);
    }
    if (source.type === 'mediaWatchlist') {
      const help = document.createElement('div'); help.className = 'settings-muted calendar-settings-inline-help'; help.textContent = 'Read-only upcoming releases and episodes from Media Watchlist widgets that expose dates to Calendar.'; parent.appendChild(help);
    }
    if (source.type === 'moonPhases') {
      const help = document.createElement('div'); help.className = 'settings-muted calendar-settings-inline-help'; help.textContent = 'New moon, first quarter, full moon and last quarter; calculated locally with phase images in Month view.'; parent.appendChild(help);
    }
  };
  const renderRows = () => {
    list.innerHTML = '';
    sources.forEach((source, index) => {
      const row = document.createElement('div'); row.className = 'calendar-settings-source-row'; row.dataset.sourceId = source.id;
      const color = document.createElement('input'); color.type = 'color'; color.className = 'calendar-settings-color'; color.value = source.color; color.title = 'Source colour';
      const fields = document.createElement('div'); fields.className = 'calendar-settings-source-fields';
      const identity = document.createElement('div'); identity.className = 'calendar-settings-provider-grid';
      const name = input(source.name, CALENDAR_SOURCE_DEFAULT_NAMES[source.type], value => { source.name = value; });
      const type = document.createElement('select'); type.className = 'settings-select calendar-settings-type';
      type.innerHTML = [['proton','Proton Calendar'],['ics','Public ICS'],['ukHolidays','UK bank holidays'],['astronomy','Astronomy events'],['moonPhases','Moon phases'],['launches','Space launches'],['football','Football'],['pdc','PDC darts'],['mediaWatchlist','Media watchlist']]
        .map(([value, label]) => option(value, label, source.type)).join('');
      const provider = document.createElement('div'); provider.className = 'calendar-settings-provider-fields';
      name.addEventListener('input', () => { source.name = name.value; }); color.addEventListener('input', () => { source.color = color.value; });
      type.addEventListener('change', () => {
        source.type = type.value;
        if (initialTypes.get(source.id) !== source.type) secretDrafts.set(source.id, '');
        Object.assign(source, _calendarSources({ config: { calendars: [source] } })[0]);
        name.placeholder = CALENDAR_SOURCE_DEFAULT_NAMES[source.type];
        renderProviderFields(source, provider);
      });
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'icon-btn is-danger calendar-settings-remove'; remove.textContent = '×'; remove.title = 'Remove source';
      remove.addEventListener('click', () => { sources.splice(index, 1); renderRows(); });
      identity.append(type, name); fields.append(identity, provider); renderProviderFields(source, provider); row.append(color, fields, remove); list.appendChild(row);
    });
    addButton.disabled = sources.length >= CALENDAR_MAX_SOURCES;
    if (!sources.length) { const empty = document.createElement('div'); empty.className = 'settings-muted calendar-settings-empty'; empty.textContent = 'No calendar sources configured yet.'; list.appendChild(empty); }
  };
  addButton.addEventListener('click', () => {
    if (sources.length >= CALENDAR_MAX_SOURCES) return;
    sources.push({ id: _calendarNewSourceId(), name: '', color: CALENDAR_SOURCE_COLORS[sources.length % CALENDAR_SOURCE_COLORS.length], type: 'proton' });
    renderRows();
  });
  renderRows();

  widget._calendarSecretDrafts = secretDrafts;
  widget._calendarSecretLoadPromise = (async () => {
    const secretSources = sources.filter(_calendarSourceNeedsSecret);
    if (!secretSources.length) { widget._calendarSecretStatus = { available: true, publicOnly: true }; status.textContent = 'No credentials are needed by the configured sources.'; return; }
    const secretStatus = await WidgetSDK.credentials.status('protonCalendar');
    widget._calendarSecretStatus = secretStatus;
    if (!secretStatus?.available) { status.textContent = `Secure storage unavailable: ${secretStatus?.error || 'native host unavailable'}.`; status.classList.add('is-error'); return; }
    const values = await Promise.all(secretSources.map(async source => [
      source.id,
      await WidgetSDK.credentials.get('protonCalendar', _calendarSecretKey(widget.id, source.id))
    ]));
    values.forEach(([sourceId, value]) => { if (!secretDrafts.get(sourceId)) secretDrafts.set(sourceId, value || ''); });
    status.textContent = `Private calendar links are stored by ${secretStatus.provider || 'the native secret store'}.`; renderRows();
  })().catch(error => { widget._calendarSecretStatus = { available: false, error: error?.message }; status.textContent = `Secure storage unavailable: ${error?.message || 'unknown error'}.`; status.classList.add('is-error'); });
}

async function _calendarCommitSettings(widget, container, context = {}) {
  await widget._calendarSecretLoadPromise;
  const sources = _calendarSources(widget);
  const status = widget._calendarSecretStatus;
  const statusElement = container.querySelector('.calendar-settings-status');
  const securedSources = sources.filter(_calendarSourceNeedsSecret);
  if (securedSources.length && !status?.available) {
    if (statusElement) {
      statusElement.textContent = `Cannot save calendar links: ${status?.error || 'Windows Credential Manager is unavailable'}.`;
      statusElement.classList.add('is-error');
    }
    return false;
  }
  const drafts = widget._calendarSecretDrafts instanceof Map ? widget._calendarSecretDrafts : new Map();
  for (const source of securedSources) {
    const raw = String(drafts.get(source.id) || '').trim();
    const normalized = _calendarNormalizeShareUrl(raw);
    if (raw && !normalized) {
      statusElement.textContent = `${source.name || 'Calendar'} needs a valid HTTPS calendar URL.`;
      statusElement.classList.add('is-error');
      return false;
    }
    if (!raw) {
      statusElement.textContent = `${source.name || 'Calendar'} needs a calendar URL.`;
      statusElement.classList.add('is-error');
      return false;
    }
  }
  const oldSources = Array.isArray(context.savedConfig?.calendars) ? context.savedConfig.calendars : [];
  const securedIds = new Set(securedSources.map(source => source.id));
  const operations = securedSources.map(source => WidgetSDK.credentials.set(
    'protonCalendar',
    _calendarSecretKey(widget.id, source.id),
    _calendarNormalizeShareUrl(drafts.get(source.id))
  ));
  oldSources.filter(source => source.type !== 'football' && !securedIds.has(source.id)).forEach(source => {
    operations.push(WidgetSDK.credentials.remove('protonCalendar', _calendarSecretKey(widget.id, source.id)));
  });
  const results = operations.length ? await Promise.all(operations) : [];
  if (results.some(result => result !== true)) {
    statusElement.textContent = 'Windows Credential Manager did not accept one or more calendar credentials.';
    statusElement.classList.add('is-error');
    return false;
  }
  _calendarRuntime.delete(widget.id);
  return true;
}

function _calendarDispose(widget) {
  if (_calendarDayModal?.widgetId === widget.id) _calendarCloseDayAgenda();
  _calendarRuntime.delete(widget.id);
  _calendarViewMemory.delete(widget.id);
  WidgetSDK.cache.remove('protonCalendar', widget.id, 'view', { legacyKeys: [_calendarViewKey(widget.id)] });
}

WIDGET_REGISTRY['protonCalendar'] = {
  name: 'Calendar',
  category: 'Personal & Productivity',
  description: 'Unified read-only agenda and month views for private calendars and public events',
  allowedIn: ['column'],
  settingsPanelWidth: 'wide',
  liveSettingsPreview: false,
  reloadLabel: 'Refresh calendars',
  defaultConfig: {
    calendars: [],
    defaultView: 'agenda',
    agendaDays: 14,
    weekStarts: 'monday',
    refreshMinutes: 60
  },
  defaultData: {},

  reload(widget) {
    return _calendarEnsureData(widget, { force: true });
  },

  beforeSettingsCommit(widget, container, context) {
    return _calendarCommitSettings(widget, container, context);
  },

  onSettingsCommit(widget) {
    _calendarRuntime.delete(widget.id);
    const currentView = _calendarReadView(widget);
    if (!['agenda', 'month'].includes(currentView.mode)) _calendarWriteView(widget, { mode: widget.config?.defaultView });
  },

  dispose(widget) {
    _calendarDispose(widget);
  },

  render(widget, element, context) {
    const sources = _calendarSources(widget);
    const runtime = _calendarGetRuntime(widget.id);
    const rerender = () => {
      if (!element.isConnected) {
        _widgetRefreshers.delete(`${widget.id}:${context}`);
        return;
      }
      element.innerHTML = '';
      WIDGET_REGISTRY.protonCalendar.render(widget, element, context);
    };
    _setWidgetRefresher(widget.id, context, rerender);
    element.className = 'widget-calendar';

    const header = document.createElement('div');
    header.className = 'widget-calendar-header';
    const heading = document.createElement('div');
    heading.className = 'widget-calendar-heading';
    heading.textContent = widget.title || 'Calendar';
    const protonLink = document.createElement('a');
    protonLink.href = 'https://calendar.proton.me/';
    protonLink.target = '_blank';
    protonLink.rel = 'noreferrer noopener';
    protonLink.textContent = 'Open Proton';
    header.appendChild(heading);
    element.appendChild(header);

    if (!sources.length) {
      const empty = document.createElement('div');
      empty.className = 'widget-calendar-empty';
      empty.textContent = 'Add a calendar source in widget settings.';
      element.appendChild(empty);
      return;
    }

    _calendarEnsureData(widget);
    _setWidgetTimer(widget.id, context, () => _calendarEnsureData(widget), 60000);
    let view = _calendarReadView(widget);
    const toolbar = document.createElement('div');
    toolbar.className = 'widget-calendar-toolbar widget-interactive-surface';
    const previous = document.createElement('button');
    previous.type = 'button';
    previous.className = 'icon-btn';
    previous.textContent = '‹';
    previous.title = 'Previous period';
    const today = document.createElement('button');
    today.type = 'button';
    today.className = 'widget-calendar-today';
    today.textContent = 'Today';
    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'icon-btn';
    next.textContent = '›';
    next.title = 'Next period';
    const period = document.createElement('span');
    period.className = 'widget-calendar-period';
    const agenda = document.createElement('button');
    agenda.type = 'button';
    agenda.className = `widget-calendar-view-button${view.mode === 'agenda' ? ' active' : ''}`;
    agenda.textContent = 'Agenda';
    const month = document.createElement('button');
    month.type = 'button';
    month.className = `widget-calendar-view-button${view.mode === 'month' ? ' active' : ''}`;
    month.textContent = 'Month';
    toolbar.append(previous, today, next, period, agenda, month);
    element.appendChild(toolbar);

    const legend = document.createElement('div');
    legend.className = 'widget-calendar-legend';
    const hiddenSourceIds = new Set(view.hiddenSourceIds || []);
    sources.forEach(source => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = `widget-calendar-legend-item${hiddenSourceIds.has(source.id) ? ' is-hidden' : ''}`;
      item.style.setProperty('--calendar-event-color', source.color);
      item.textContent = source.name || runtime.sourceTitles.get(source.id) || CALENDAR_SOURCE_DEFAULT_NAMES[source.type];
      item.title = hiddenSourceIds.has(source.id) ? 'Show this source' : 'Hide this source';
      item.setAttribute('aria-pressed', String(!hiddenSourceIds.has(source.id)));
      item.addEventListener('click', () => {
        if (hiddenSourceIds.has(source.id)) hiddenSourceIds.delete(source.id); else hiddenSourceIds.add(source.id);
        view = _calendarWriteView(widget, { hiddenSourceIds: [...hiddenSourceIds] });
        rerender();
      });
      legend.appendChild(item);
    });
    element.appendChild(legend);

    const content = document.createElement('div');
    content.className = `widget-calendar-content is-${view.mode}`;
    element.appendChild(content);
    const renderContent = () => {
      view = _calendarReadView(widget);
      agenda.classList.toggle('active', view.mode === 'agenda');
      month.classList.toggle('active', view.mode === 'month');
      content.className = `widget-calendar-content is-${view.mode}`;
      const anchor = new Date(view.anchor);
      period.textContent = view.mode === 'month'
        ? anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
        : `${anchor.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} + ${_calendarNormalizeAgendaDays(widget.config?.agendaDays)} days`;
      const visibleRuntime = { ...runtime, events: runtime.events.filter(event => !hiddenSourceIds.has(event.sourceId)) };
      if (view.mode === 'month') _calendarRenderMonth(widget, content, visibleRuntime, view, renderContent);
      else _calendarRenderAgenda(widget, content, visibleRuntime, view);
      content.scrollTop = view.scrollTop?.[view.mode] || 0;
    };
    content.addEventListener('scroll', () => {
      const mode = view.mode; const scrollTop = content.scrollTop;
      WidgetSDK.runtime.requestFrame(`${widget.id}:calendar-view-scroll`, () => {
        const current = _calendarReadView(widget);
        _calendarWriteView(widget, { scrollTop: { ...current.scrollTop, [mode]: scrollTop } });
      });
    }, { passive: true });
    previous.addEventListener('click', () => {
      const anchor = new Date(view.anchor);
      const nextAnchor = view.mode === 'month'
        ? new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1).getTime()
        : _calendarAddDays(view.anchor, -_calendarNormalizeAgendaDays(widget.config?.agendaDays));
      view = _calendarWriteView(widget, { anchor: nextAnchor });
      renderContent();
    });
    next.addEventListener('click', () => {
      const anchor = new Date(view.anchor);
      const nextAnchor = view.mode === 'month'
        ? new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1).getTime()
        : _calendarAddDays(view.anchor, _calendarNormalizeAgendaDays(widget.config?.agendaDays));
      view = _calendarWriteView(widget, { anchor: nextAnchor });
      renderContent();
    });
    today.addEventListener('click', () => {
      view = _calendarWriteView(widget, { anchor: _calendarStartOfDay(Date.now()) });
      renderContent();
    });
    agenda.addEventListener('click', () => {
      view = _calendarWriteView(widget, { mode: 'agenda' });
      renderContent();
    });
    month.addEventListener('click', () => {
      view = _calendarWriteView(widget, { mode: 'month' });
      renderContent();
    });
    renderContent();

    const status = document.createElement('div');
    status.className = 'widget-calendar-status';
    if (runtime.loading) status.textContent = 'Refreshing calendars…';
    else if (runtime.errors.length) {
      status.classList.add('is-error');
      status.textContent = runtime.errors.join(' · ');
    } else if (runtime.fetchedAt) {
      status.textContent = `Updated ${new Date(runtime.fetchedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
    }
    const privacy = document.createElement('span');
    privacy.textContent = sources.some(_calendarSourceUsesCredential) ? 'Read-only · credentials secured locally' : 'Read-only · public sources';
    if (sources.some(source => source.type === 'proton')) status.append(protonLink);
    status.append(privacy);
    const providerLinks = {
      ukHolidays: ['GOV.UK', 'https://www.gov.uk/bank-holidays'],
      launches: ['Launch Library 2', 'https://thespacedevs.com/llapi'],
      football: ['football-data.org', 'https://www.football-data.org/'],
      pdc: ['PDC', 'https://www.pdc.tv/tournaments/calendar']
    };
    const providerTypes = [...new Set(sources.map(source => source.type).filter(type => providerLinks[type]))];
    if (providerTypes.length) {
      const attributions = document.createElement('span');
      attributions.className = 'widget-calendar-attributions';
      attributions.append('Sources: ');
      providerTypes.forEach((type, index) => {
        if (index) attributions.append(' · ');
        const [label, url] = providerLinks[type];
        const link = document.createElement('a'); link.href = url; link.target = '_blank'; link.rel = 'noreferrer noopener'; link.textContent = label;
        attributions.append(link);
      });
      status.append(attributions);
    }
    element.appendChild(status);
  },

  renderSettings(widget, container) {
    _calendarRenderSettings(widget, container);
  }
};
