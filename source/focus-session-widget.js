// Focus Session widget. Active state, history, and daily totals remain in the
// Widget SDK local cache and never enter the shared Hub database.

const FOCUS_SESSION_CACHE_KEY = 'runtime';
const FOCUS_SESSION_HISTORY_LIMIT = 120;
const FOCUS_SESSION_MAX_RECOVERY_PHASES = 64;
const FOCUS_SESSION_PRESETS = Object.freeze({
  pomodoro: { label: 'Pomodoro', workMinutes: 25, breakMinutes: 5, longBreakMinutes: 15, longBreakEvery: 4 },
  deepWork: { label: 'Deep work', workMinutes: 50, breakMinutes: 10, longBreakMinutes: 30, longBreakEvery: 3 },
  shortSprint: { label: 'Short sprint', workMinutes: 15, breakMinutes: 3, longBreakMinutes: 10, longBreakEvery: 4 },
  custom: { label: 'Custom' }
});

const _focusSessionRuntimeMemory = new Map();
let _focusSessionCalendarWarmAt = 0;

function _focusClampMinutes(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(240, parsed)) : fallback;
}

function _focusNormalizedConfig(widget) {
  const config = widget?.config || {};
  return {
    preset: Object.hasOwn(FOCUS_SESSION_PRESETS, config.preset) ? config.preset : 'pomodoro',
    workMinutes: _focusClampMinutes(config.workMinutes, 25),
    breakMinutes: _focusClampMinutes(config.breakMinutes, 5),
    longBreakMinutes: _focusClampMinutes(config.longBreakMinutes, 15),
    longBreakEvery: Math.max(1, Math.min(12, Math.round(Number(config.longBreakEvery) || 4))),
    autoStartNext: config.autoStartNext === true,
    showDailyTotals: config.showDailyTotals !== false,
    launchTarget: String(config.launchTarget || ''),
    warnCalendarConflicts: config.warnCalendarConflicts !== false,
    notifications: config.notifications === true
  };
}

function _focusPhaseDurationMs(widget, phase) {
  const config = _focusNormalizedConfig(widget);
  const minutes = phase === 'longBreak' ? config.longBreakMinutes : phase === 'break' ? config.breakMinutes : config.workMinutes;
  return minutes * 60 * 1000;
}

function _focusDefaultRuntime(widget) {
  return {
    status: 'idle',
    phase: 'work',
    endsAt: 0,
    remainingMs: _focusPhaseDurationMs(widget, 'work'),
    phaseStartedAt: 0,
    completedWorkSessions: 0,
    sessionActive: false,
    history: [],
    historyOpen: false
  };
}

function _focusSanitizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history.filter(entry => entry && ['work', 'break', 'longBreak'].includes(entry.phase) && Number.isFinite(Number(entry.endedAt)))
    .map(entry => ({
      phase: entry.phase,
      endedAt: Number(entry.endedAt),
      durationMs: Math.max(0, Number(entry.durationMs) || 0),
      skipped: entry.skipped === true
    }))
    .slice(0, FOCUS_SESSION_HISTORY_LIMIT);
}

function _focusReadRuntime(widget) {
  if (_focusSessionRuntimeMemory.has(widget.id)) return _focusSessionRuntimeMemory.get(widget.id);
  const fallback = _focusDefaultRuntime(widget);
  let stored = null;
  try { stored = typeof WidgetSDK !== 'undefined' ? WidgetSDK.cache.get('focusSession', widget.id, FOCUS_SESSION_CACHE_KEY) : null; } catch {}
  const runtime = stored && typeof stored === 'object' ? { ...fallback, ...stored } : fallback;
  runtime.status = ['idle', 'running', 'paused'].includes(runtime.status) ? runtime.status : 'idle';
  runtime.phase = ['work', 'break', 'longBreak'].includes(runtime.phase) ? runtime.phase : 'work';
  runtime.endsAt = Math.max(0, Number(runtime.endsAt) || 0);
  runtime.remainingMs = Math.max(0, Number(runtime.remainingMs) || _focusPhaseDurationMs(widget, runtime.phase));
  runtime.phaseStartedAt = Math.max(0, Number(runtime.phaseStartedAt) || 0);
  runtime.completedWorkSessions = Math.max(0, Math.round(Number(runtime.completedWorkSessions) || 0));
  runtime.sessionActive = runtime.sessionActive === true;
  runtime.history = _focusSanitizeHistory(runtime.history);
  runtime.historyOpen = runtime.historyOpen === true;
  if (runtime.status === 'running' && !runtime.endsAt) runtime.status = 'paused';
  _focusSessionRuntimeMemory.set(widget.id, runtime);
  return runtime;
}

function _focusPersistRuntime(widget, runtime) {
  runtime.history = _focusSanitizeHistory(runtime.history);
  _focusSessionRuntimeMemory.set(widget.id, runtime);
  try { if (typeof WidgetSDK !== 'undefined') WidgetSDK.cache.set('focusSession', widget.id, FOCUS_SESSION_CACHE_KEY, runtime); } catch {}
  void _focusSyncNotification(widget, runtime);
  return runtime;
}

function _focusPhaseLabel(phase) {
  return phase === 'longBreak' ? 'Long break' : phase === 'break' ? 'Short break' : 'Focus';
}

function _focusNextPhase(widget, runtime, completedPhase = runtime.phase) {
  if (completedPhase !== 'work') return 'work';
  return runtime.completedWorkSessions > 0 && runtime.completedWorkSessions % _focusNormalizedConfig(widget).longBreakEvery === 0
    ? 'longBreak'
    : 'break';
}

function _focusStartTimer(widget, runtime, now = Date.now()) {
  if (runtime.status === 'running') return runtime;
  const duration = _focusPhaseDurationMs(widget, runtime.phase);
  const remaining = runtime.status === 'paused' && runtime.remainingMs > 0 ? Math.min(runtime.remainingMs, duration) : duration;
  runtime.status = 'running';
  runtime.remainingMs = remaining;
  runtime.endsAt = now + remaining;
  if (!runtime.phaseStartedAt) runtime.phaseStartedAt = now;
  runtime.sessionActive = true;
  return runtime;
}

function _focusPauseTimer(runtime, now = Date.now()) {
  if (runtime.status !== 'running') return runtime;
  runtime.remainingMs = Math.max(0, runtime.endsAt - now);
  runtime.endsAt = 0;
  runtime.status = 'paused';
  return runtime;
}

function _focusRecordPhase(widget, runtime, phase, endedAt, skipped = false) {
  const durationMs = skipped
    ? Math.max(0, Math.min(_focusPhaseDurationMs(widget, phase), endedAt - (runtime.phaseStartedAt || endedAt)))
    : _focusPhaseDurationMs(widget, phase);
  runtime.history.unshift({ phase, endedAt, durationMs, skipped });
  runtime.history = runtime.history.slice(0, FOCUS_SESSION_HISTORY_LIMIT);
  if (phase === 'work' && !skipped) runtime.completedWorkSessions += 1;
}

function _focusNotificationId(widget) { return `focus:${widget.id}`; }
function _focusNotificationEvent(widget, phase, endsAt) {
  const runtime = _focusReadRuntime(widget);
  const projectedRuntime = phase === 'work' ? { ...runtime, completedWorkSessions: runtime.completedWorkSessions + 1 } : runtime;
  const nextPhase = _focusNextPhase(widget, projectedRuntime, phase);
  return {
    id: _focusNotificationId(widget), title: phase === 'work' ? 'Focus complete' : 'Break complete',
    message: `Next: ${_focusPhaseLabel(nextPhase)}.`, when: endsAt, expiresAt: endsAt + 24 * 60 * 60 * 1000,
    dedupeKey: `${_focusNotificationId(widget)}:${endsAt}`,
    source: { widgetType: 'focusSession', widgetId: widget.id, label: 'Focus Session' }
  };
}
function _focusSyncNotification(widget, runtime = _focusReadRuntime(widget)) {
  if (typeof WidgetSDK === 'undefined') return false;
  if (!_focusNormalizedConfig(widget).notifications || runtime.status !== 'running' || !runtime.endsAt) return WidgetSDK.notifications.cancel(_focusNotificationId(widget));
  return WidgetSDK.notifications.schedule(_focusNotificationEvent(widget, runtime.phase, runtime.endsAt));
}
function _focusNotify(widget, completedPhase, nextPhase, completedAt) {
  if (!_focusNormalizedConfig(widget).notifications || typeof WidgetSDK === 'undefined') return false;
  const title = completedPhase === 'work' ? 'Focus complete' : 'Break complete';
  const body = `Next: ${_focusPhaseLabel(nextPhase)}.`;
  void WidgetSDK.notifications.publish({ id: _focusNotificationId(widget), title, message: body, createdAt: Date.now(), dedupeKey: `${_focusNotificationId(widget)}:${completedAt}`, source: { widgetType: 'focusSession', widgetId: widget.id, label: 'Focus Session' } }, { system: true });
  return true;
}

function _focusAdvanceExpired(widget, runtime, now = Date.now()) {
  if (runtime.status !== 'running' || runtime.endsAt > now) return false;
  const autoStart = _focusNormalizedConfig(widget).autoStartNext;
  let changed = false;
  let recovered = 0;
  let lastTransition = null;
  while (runtime.status === 'running' && runtime.endsAt <= now && recovered < FOCUS_SESSION_MAX_RECOVERY_PHASES) {
    const completedAt = runtime.endsAt;
    const completedPhase = runtime.phase;
    _focusRecordPhase(widget, runtime, completedPhase, completedAt, false);
    runtime.phase = _focusNextPhase(widget, runtime, completedPhase);
    runtime.remainingMs = _focusPhaseDurationMs(widget, runtime.phase);
    runtime.phaseStartedAt = 0;
    runtime.endsAt = 0;
    changed = true;
    recovered += 1;
    lastTransition = { completedPhase, nextPhase: runtime.phase, completedAt };
    if (!autoStart) {
      runtime.status = 'paused';
      break;
    }
    runtime.status = 'running';
    runtime.phaseStartedAt = completedAt;
    runtime.endsAt = completedAt + runtime.remainingMs;
  }
  if (recovered >= FOCUS_SESSION_MAX_RECOVERY_PHASES && runtime.endsAt <= now) {
    runtime.status = 'paused';
    runtime.endsAt = 0;
    runtime.phaseStartedAt = 0;
    runtime.remainingMs = _focusPhaseDurationMs(widget, runtime.phase);
  }
  if (lastTransition) _focusNotify(widget, lastTransition.completedPhase, lastTransition.nextPhase, lastTransition.completedAt);
  return changed;
}

function _focusSkipTimer(widget, runtime, now = Date.now()) {
  const completedPhase = runtime.phase;
  _focusRecordPhase(widget, runtime, completedPhase, now, true);
  runtime.phase = _focusNextPhase(widget, runtime, completedPhase);
  runtime.status = 'paused';
  runtime.endsAt = 0;
  runtime.phaseStartedAt = 0;
  runtime.remainingMs = _focusPhaseDurationMs(widget, runtime.phase);
  return runtime;
}

function _focusResetTimer(widget, runtime) {
  runtime.status = 'idle';
  runtime.phase = 'work';
  runtime.endsAt = 0;
  runtime.remainingMs = _focusPhaseDurationMs(widget, 'work');
  runtime.phaseStartedAt = 0;
  runtime.completedWorkSessions = 0;
  runtime.sessionActive = false;
  return runtime;
}

function _focusRemainingMs(widget, runtime, now = Date.now()) {
  if (runtime.status === 'running') return Math.max(0, runtime.endsAt - now);
  return Math.max(0, Number(runtime.remainingMs) || _focusPhaseDurationMs(widget, runtime.phase));
}

function _focusFormatDuration(milliseconds) {
  const totalSeconds = Math.max(0, Math.ceil(Number(milliseconds) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = value => String(value).padStart(2, '0');
  return hours ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

function _focusLocalDayKey(timestamp = Date.now()) {
  const date = new Date(timestamp);
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function _focusDailySummary(runtime, now = Date.now()) {
  const today = _focusLocalDayKey(now);
  const completed = runtime.history.filter(entry => entry.phase === 'work' && !entry.skipped && _focusLocalDayKey(entry.endedAt) === today);
  return {
    sessions: completed.length,
    milliseconds: completed.reduce((total, entry) => total + entry.durationMs, 0)
  };
}

function _focusCollectWidgetItems(widgetType) {
  if (typeof state === 'undefined') return [];
  const matches = [];
  const walk = items => {
    (items || []).forEach(item => {
      if (item?.type === 'widget' && item.widgetType === widgetType) matches.push(item);
      if (item?.children) walk(item.children);
    });
  };
  (state.boards || []).forEach(board => {
    const tabs = typeof getBoardTabs === 'function' ? getBoardTabs(board) : [{ columns: board.columns || [] }];
    tabs.forEach(tab => (tab.columns || []).forEach(column => walk(column.items)));
  });
  walk(state.navItems || []);
  return matches;
}

function _focusWarmCalendarData() {
  if (typeof _calendarEnsureData !== 'function' || Date.now() - _focusSessionCalendarWarmAt < 5 * 60 * 1000) return [];
  const widgets = _focusCollectWidgetItems('protonCalendar');
  if (!widgets.length) return [];
  _focusSessionCalendarWarmAt = Date.now();
  return widgets.map(widget => {
    try { return Promise.resolve(_calendarEnsureData(widget)).catch(() => null); } catch { return Promise.resolve(null); }
  });
}

function _focusFindCalendarConflict(start, end) {
  if (typeof _calendarRuntime === 'undefined') return null;
  const events = [];
  for (const runtime of _calendarRuntime.values()) {
    (runtime?.events || []).forEach(event => {
      const eventStart = Number(event.start);
      const eventEnd = Number(event.end) || eventStart + 60 * 60 * 1000;
      if (!event.allDay && eventEnd > start && eventStart < end) events.push(event);
    });
  }
  return events.sort((left, right) => left.start - right.start)[0] || null;
}

function _focusCalendarConflict(widget, runtime, now = Date.now()) {
  if (!_focusNormalizedConfig(widget).warnCalendarConflicts || runtime.phase !== 'work') return null;
  const end = runtime.status === 'running' ? runtime.endsAt : now + _focusRemainingMs(widget, runtime, now);
  return _focusFindCalendarConflict(now, end);
}

function _focusWalkFolders(items, location, board, output) {
  (items || []).forEach(item => {
    if (item?.type !== 'folder') return;
    output.push({ id: item.id, folder: item, board, label: `${location} / ${item.title || 'Untitled Folder'}` });
    const dynamic = typeof isDynamicFolder === 'function' ? isDynamicFolder(item) : item.dynamic === true;
    if (!dynamic) _focusWalkFolders(item.children || [], `${location} / ${item.title || 'Untitled Folder'}`, board, output);
  });
}

function _focusFolderOptions() {
  if (typeof state === 'undefined') return [];
  const folders = [];
  (state.boards || []).forEach(board => {
    const tabs = typeof getBoardTabs === 'function' ? getBoardTabs(board) : [{ title: '', columns: board.columns || [] }];
    tabs.forEach(tab => (tab.columns || []).forEach(column => {
      _focusWalkFolders(column.items, `${board.title || 'Untitled Board'} / ${tab.title || 'Untitled Tab'} / ${column.title || 'Untitled Column'}`, board, folders);
    }));
  });
  _focusWalkFolders(state.navItems || [], 'Sidebar', null, folders);
  return folders;
}

function _focusLaunchOptions() {
  const options = [{ value: '', label: 'Do not open anything' }];
  if (typeof state !== 'undefined') {
    (state.sets || []).forEach(set => options.push({ value: `set:${set.id}`, label: `Set · ${set.title || 'Untitled Set'}` }));
    _focusFolderOptions().forEach(entry => options.push({ value: `folder:${entry.id}`, label: `Folder · ${entry.label}` }));
  }
  return options;
}

function _focusFindFolder(folderId) {
  return _focusFolderOptions().find(entry => entry.id === folderId) || null;
}

function _focusCollectFolderBookmarks(folder, board, seen = new Set()) {
  if (!folder || seen.has(folder.id)) return [];
  seen.add(folder.id);
  const children = typeof resolveFolderChildren === 'function' ? resolveFolderChildren(folder, board) : folder.children || [];
  const bookmarks = [];
  children.forEach(item => {
    if (item?.type === 'bookmark' && item.url) bookmarks.push(item);
    if (item?.type === 'folder') bookmarks.push(..._focusCollectFolderBookmarks(item, board, seen));
  });
  return bookmarks;
}

function _focusResolveLaunchBookmarks(target) {
  const value = String(target || '');
  if (value.startsWith('set:')) {
    const set = typeof findSetById === 'function' ? findSetById(value.slice(4)) : null;
    return { found: !!set, label: set?.title || 'Set', bookmarks: set && typeof resolveSetItems === 'function' ? resolveSetItems(set).filter(item => item?.url) : [] };
  }
  if (value.startsWith('folder:')) {
    const match = _focusFindFolder(value.slice(7));
    return { found: !!match, label: match?.folder?.title || 'Folder', bookmarks: match ? _focusCollectFolderBookmarks(match.folder, match.board) : [] };
  }
  return { found: true, label: '', bookmarks: [] };
}

function _focusLaunchTarget(widget) {
  const target = _focusNormalizedConfig(widget).launchTarget;
  if (!target) return false;
  const resolved = _focusResolveLaunchBookmarks(target);
  if (!resolved.found) {
    if (typeof showNotice === 'function') showNotice('The configured focus launch target no longer exists.');
    return false;
  }
  const seen = new Set();
  const bookmarks = resolved.bookmarks.filter(item => {
    const url = String(item?.url || '');
    if (!url || seen.has(url)) return false;
    seen.add(url);
    return true;
  });
  if (!bookmarks.length) {
    if (typeof showNotice === 'function') showNotice(`${resolved.label || 'The launch target'} has no bookmarks to open.`);
    return false;
  }
  const open = () => bookmarks.forEach(bookmark => {
    if (typeof openHubBookmark === 'function') openHubBookmark(bookmark);
  });
  if (bookmarks.length > 10 && typeof showConfirmDialog === 'function') showConfirmDialog(`Open ${bookmarks.length} focus bookmarks?`, open, 'Open Bookmarks');
  else open();
  return true;
}

function _focusEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function _focusElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function _focusUpdateLiveElements(widget, runtime, element, now = Date.now()) {
  const remaining = _focusRemainingMs(widget, runtime, now);
  const duration = _focusPhaseDurationMs(widget, runtime.phase);
  const progress = duration ? Math.max(0, Math.min(1, (duration - remaining) / duration)) : 0;
  const countdown = element.querySelector('[data-focus-countdown]');
  if (countdown) countdown.textContent = _focusFormatDuration(remaining);
  const dial = element.querySelector('[data-focus-dial]');
  if (dial) dial.style.setProperty('--focus-progress', `${progress * 360}deg`);
  const conflict = element.querySelector('[data-focus-conflict]');
  if (conflict) {
    const event = _focusCalendarConflict(widget, runtime, now);
    conflict.classList.toggle('hidden', !event);
    if (event) {
      const time = new Date(event.start).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
      conflict.textContent = `Calendar: ${event.title || 'Event'} at ${time} overlaps this focus window.`;
    }
  }
}

function _focusRenderWidget(widget, element, context = 'column') {
  const runtime = _focusReadRuntime(widget);
  if (_focusAdvanceExpired(widget, runtime)) _focusPersistRuntime(widget, runtime);
  else void _focusSyncNotification(widget, runtime);
  if (typeof WidgetSDK !== 'undefined') WidgetSDK.runtime.cancelSchedule(`${widget.id}:${context}`);
  element.innerHTML = '';
  element.classList.remove('focus-session--column', 'focus-session--navpane');
  element.classList.add('focus-session', `focus-session--${context}`);

  const header = _focusElement('div', 'focus-session-header');
  header.append(
    _focusElement('strong', 'focus-session-phase', _focusPhaseLabel(runtime.phase)),
    _focusElement('span', 'focus-session-preset', FOCUS_SESSION_PRESETS[_focusNormalizedConfig(widget).preset]?.label || 'Custom')
  );
  element.appendChild(header);

  const dial = _focusElement('div', `focus-session-dial focus-session-dial--${runtime.phase}`);
  dial.dataset.focusDial = '';
  const time = _focusElement('time', 'focus-session-time', _focusFormatDuration(_focusRemainingMs(widget, runtime)));
  time.dataset.focusCountdown = '';
  const stateLabel = _focusElement('span', 'focus-session-state', runtime.status === 'running'
    ? 'In progress'
    : runtime.status === 'paused' && runtime.phaseStartedAt ? 'Ready to resume' : 'Ready to start');
  dial.append(time, stateLabel);
  element.appendChild(dial);

  const controls = _focusElement('div', 'focus-session-controls');
  const primary = _focusElement('button', 'focus-session-primary', runtime.status === 'running'
    ? 'Pause'
    : runtime.status === 'paused' && runtime.phaseStartedAt ? 'Resume' : 'Start');
  primary.type = 'button';
  primary.addEventListener('click', () => {
    if (runtime.status === 'running') _focusPauseTimer(runtime);
    else {
      const shouldLaunch = runtime.phase === 'work' && !runtime.sessionActive;
      _focusStartTimer(widget, runtime);
      if (shouldLaunch) _focusLaunchTarget(widget);
    }
    _focusPersistRuntime(widget, runtime);
    _focusRenderWidget(widget, element, context);
  });
  const skip = _focusElement('button', '', 'Skip');
  skip.type = 'button';
  skip.addEventListener('click', () => { _focusSkipTimer(widget, runtime); _focusPersistRuntime(widget, runtime); _focusRenderWidget(widget, element, context); });
  const reset = _focusElement('button', '', 'Reset');
  reset.type = 'button';
  reset.addEventListener('click', () => { _focusResetTimer(widget, runtime); _focusPersistRuntime(widget, runtime); _focusRenderWidget(widget, element, context); });
  controls.append(primary, skip, reset);
  element.appendChild(controls);

  const sequence = _focusElement('div', 'focus-session-sequence');
  const sequenceLength = _focusNormalizedConfig(widget).longBreakEvery;
  const completedInCycle = runtime.phase === 'longBreak' ? sequenceLength : runtime.completedWorkSessions % sequenceLength;
  for (let index = 0; index < sequenceLength; index += 1) {
    const marker = _focusElement('span', index < completedInCycle ? 'complete' : '');
    marker.title = index < completedInCycle ? 'Completed focus block' : 'Upcoming focus block';
    sequence.appendChild(marker);
  }
  element.appendChild(sequence);

  const conflict = _focusElement('div', 'focus-session-conflict hidden');
  conflict.dataset.focusConflict = '';
  element.appendChild(conflict);

  const config = _focusNormalizedConfig(widget);
  if (config.launchTarget) {
    const launch = _focusLaunchOptions().find(option => option.value === config.launchTarget);
    element.appendChild(_focusElement('div', 'focus-session-launch', launch ? `Starts with ${launch.label}` : 'Launch target is missing'));
  }

  if (config.showDailyTotals) {
    const summary = _focusDailySummary(runtime);
    const stats = _focusElement('div', 'focus-session-stats');
    stats.append(
      _focusElement('span', '', `Today: ${summary.sessions} session${summary.sessions === 1 ? '' : 's'}`),
      _focusElement('strong', '', `${Math.round(summary.milliseconds / 60000)} min`)
    );
    element.appendChild(stats);
  }

  if (context !== 'navpane' && runtime.history.length) {
    const history = _focusElement('details', 'focus-session-history');
    history.open = runtime.historyOpen;
    history.addEventListener('toggle', () => {
      runtime.historyOpen = history.open;
      _focusPersistRuntime(widget, runtime);
    });
    const summary = _focusElement('summary', '', 'Recent phases');
    history.appendChild(summary);
    runtime.history.slice(0, 5).forEach(entry => {
      const row = _focusElement('div', 'focus-session-history-row');
      row.append(
        _focusElement('span', '', `${entry.skipped ? 'Skipped ' : ''}${_focusPhaseLabel(entry.phase)}`),
        _focusElement('time', '', new Date(entry.endedAt).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' }))
      );
      history.appendChild(row);
    });
    element.appendChild(history);
  }

  _focusUpdateLiveElements(widget, runtime, element);
  if (runtime.status === 'running' && typeof WidgetSDK !== 'undefined') {
    WidgetSDK.runtime.schedule(`${widget.id}:${context}`, () => {
      if (!element.isConnected) {
        WidgetSDK.runtime.cancelSchedule(`${widget.id}:${context}`);
        return;
      }
      if (_focusAdvanceExpired(widget, runtime)) {
        _focusPersistRuntime(widget, runtime);
        _focusRenderWidget(widget, element, context);
      } else _focusUpdateLiveElements(widget, runtime, element);
    }, 1000, { runWhenHidden: true, maxBackoffMs: 5000 });
  }
  const calendarTasks = _focusWarmCalendarData();
  if (calendarTasks.length) Promise.allSettled(calendarTasks).then(() => { if (element.isConnected) _focusUpdateLiveElements(widget, runtime, element); });
}

async function _focusRequestNotificationPermission(widget) {
  if (!_focusNormalizedConfig(widget).notifications) return true;
  const permissionGranted = typeof WidgetSDK !== 'undefined' && await WidgetSDK.notifications.requestPermission();
  if (!permissionGranted) {
    widget.config.notifications = false;
    if (typeof showNotice === 'function') showNotice('Notification permission was not granted. Other Focus settings were saved.');
  }
  return true;
}

WIDGET_REGISTRY['focusSession'] = {
  id: 'focusSession',
  name: 'Focus Session',
  category: 'Personal & Productivity',
  description: 'A local Pomodoro and custom focus timer with reliable recovery, daily totals, and optional launch helpers.',
  allowedIn: ['column', 'navpane'],
  liveSettingsPreview: false,
  defaultConfig: {
    preset: 'pomodoro', workMinutes: 25, breakMinutes: 5, longBreakMinutes: 15, longBreakEvery: 4,
    autoStartNext: false, showDailyTotals: true, launchTarget: '', warnCalendarConflicts: true, notifications: false
  },
  defaultData: {},
  settingsSchema: {
    type: 'object',
    properties: {
      preset: { type: 'string', enum: Object.keys(FOCUS_SESSION_PRESETS) },
      workMinutes: { type: 'number' }, breakMinutes: { type: 'number' }, longBreakMinutes: { type: 'number' }, longBreakEvery: { type: 'number' },
      autoStartNext: { type: 'boolean' }, showDailyTotals: { type: 'boolean' }, launchTarget: { type: 'string' },
      warnCalendarConflicts: { type: 'boolean' }, notifications: { type: 'boolean' }
    },
    additionalProperties: false
  },
  capabilities: { timers: true, localCache: { quotaBytes: 128 * 1024 }, notifications: { optional: true } },
  responsive: { minWidth: 180, preferredWidth: 360, compactBelow: 250 },
  migrate(widget) {
    widget.config = { ...this.defaultConfig, ...(widget.config || {}) };
    widget.data = {};
    return widget;
  },
  beforeSettingsCommit(widget) { return _focusRequestNotificationPermission(widget); },
  onSettingsCommit(widget, previousConfig) {
    const runtime = _focusReadRuntime(widget);
    const durationChanged = ['workMinutes', 'breakMinutes', 'longBreakMinutes'].some(key => Number(widget.config[key]) !== Number(previousConfig?.[key]));
    if (durationChanged && runtime.status !== 'running') runtime.remainingMs = _focusPhaseDurationMs(widget, runtime.phase);
    _focusPersistRuntime(widget, runtime);
  },
  cleanup(widget) {
    _focusSessionRuntimeMemory.delete(widget.id);
    try { void WidgetSDK.notifications.cancel(_focusNotificationId(widget)); } catch {}
    try { if (typeof WidgetSDK !== 'undefined') WidgetSDK.cache.remove('focusSession', widget.id, FOCUS_SESSION_CACHE_KEY); } catch {}
  },
  render(widget, element, context) { _focusRenderWidget(widget, element, context); },
  renderSettings(widget, container) {
    const config = _focusNormalizedConfig(widget);
    const options = _focusLaunchOptions();
    container.innerHTML = `
      <div class="settings-row"><span>Preset</span><select class="settings-select focus-settings-preset" data-cfg="preset">
        ${Object.entries(FOCUS_SESSION_PRESETS).map(([key, preset]) => `<option value="${key}" ${config.preset === key ? 'selected' : ''}>${preset.label}</option>`).join('')}
      </select></div>
      <div class="settings-row"><span>Focus minutes</span><input class="settings-text-input" type="number" min="1" max="240" step="1" data-cfg="workMinutes" value="${config.workMinutes}" /></div>
      <div class="settings-row"><span>Short-break minutes</span><input class="settings-text-input" type="number" min="1" max="240" step="1" data-cfg="breakMinutes" value="${config.breakMinutes}" /></div>
      <div class="settings-row"><span>Long-break minutes</span><input class="settings-text-input" type="number" min="1" max="240" step="1" data-cfg="longBreakMinutes" value="${config.longBreakMinutes}" /></div>
      <div class="settings-row"><span>Long break after</span><select class="settings-select" data-cfg="longBreakEvery">
        ${[2, 3, 4, 5, 6, 8].map(count => `<option value="${count}" ${config.longBreakEvery === count ? 'selected' : ''}>${count} focus sessions</option>`).join('')}
      </select></div>
      <div class="settings-row"><span>Open when the session starts</span><select class="settings-select" data-cfg="launchTarget">
        ${options.map(option => `<option value="${_focusEscape(option.value)}" ${config.launchTarget === option.value ? 'selected' : ''}>${_focusEscape(option.label)}</option>`).join('')}
      </select></div>
      <div class="settings-row"><span>Start the next phase automatically</span><label class="settings-toggle"><input type="checkbox" data-cfg="autoStartNext" ${config.autoStartNext ? 'checked' : ''} /><span class="toggle-track"></span></label></div>
      <div class="settings-row"><span>Show today's totals</span><label class="settings-toggle"><input type="checkbox" data-cfg="showDailyTotals" ${config.showDailyTotals ? 'checked' : ''} /><span class="toggle-track"></span></label></div>
      <div class="settings-row"><span>Warn about upcoming Calendar conflicts</span><label class="settings-toggle"><input type="checkbox" data-cfg="warnCalendarConflicts" ${config.warnCalendarConflicts ? 'checked' : ''} /><span class="toggle-track"></span></label></div>
      <div class="settings-row"><span>Phase-complete notifications</span><label class="settings-toggle"><input type="checkbox" data-cfg="notifications" ${config.notifications ? 'checked' : ''} /><span class="toggle-track"></span></label></div>
      <div class="settings-help">Timer state, history, and daily totals stay in this browser. Enabling notifications asks for browser permission when you save.</div>`;

    const preset = container.querySelector('.focus-settings-preset');
    preset?.addEventListener('change', () => {
      const values = FOCUS_SESSION_PRESETS[preset.value];
      if (!values?.workMinutes) return;
      ['workMinutes', 'breakMinutes', 'longBreakMinutes', 'longBreakEvery'].forEach(key => {
        const input = container.querySelector(`[data-cfg="${key}"]`);
        if (input) {
          input.value = String(values[key]);
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });
    });
  }
};
