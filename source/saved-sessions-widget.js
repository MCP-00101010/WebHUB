// Saved Sessions widget. Portable session records live in shared Hub state;
// browser tab/window IDs and widget view state never do.

const SAVED_SESSIONS_LARGE_LAUNCH_COUNT = 10;
const SAVED_SESSIONS_GROUP_COLORS = Object.freeze({
  grey: '#8a8f98', blue: '#4f8cff', red: '#e45d68', yellow: '#d7a62a', green: '#39a96b',
  pink: '#d96ca8', purple: '#9569db', cyan: '#37a9b8', orange: '#dd8439'
});

const _savedSessionsRuntime = new Map();
const _savedSessionsRenderers = new Map();
const _savedSessionsViewMemory = new Map();

function _savedSessionsId() {
  return `session-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`}`;
}

function _savedSessionsUrlKey(value) {
  try {
    const url = new URL(String(value || ''));
    if (!/^https?:$/.test(url.protocol)) return '';
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_.+|fbclid|gclid|mc_cid|mc_eid)$/i.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return url.toString();
  } catch { return ''; }
}

function _savedSessionsNormalizeTabs(tabs) {
  const seen = new Set();
  return (Array.isArray(tabs) ? tabs : []).map(tab => {
    const url = String(tab?.url || '');
    const key = _savedSessionsUrlKey(url);
    if (!key || seen.has(key)) return null;
    seen.add(key);
    return {
      title: String(tab?.title || url),
      url,
      pinned: tab?.pinned === true,
      active: tab?.active === true,
      group: tab?.group && typeof tab.group === 'object'
        ? { title: String(tab.group.title || ''), color: String(tab.group.color || '') }
        : null
    };
  }).filter(Boolean);
}

function _savedSessionsNormalizeSession(session = {}, index = 0) {
  const createdAt = typeof session.createdAt === 'string' ? session.createdAt : new Date().toISOString();
  return {
    id: String(session.id || _savedSessionsId()),
    title: String(session.title || `Session ${index + 1}`).trim() || `Session ${index + 1}`,
    createdAt,
    updatedAt: typeof session.updatedAt === 'string' ? session.updatedAt : createdAt,
    lastLaunchedAt: typeof session.lastLaunchedAt === 'string' ? session.lastLaunchedAt : null,
    tabs: _savedSessionsNormalizeTabs(session.tabs)
  };
}

function _savedSessionsAll() {
  if (typeof state === 'undefined') return [];
  if (!Array.isArray(state.savedSessions)) state.savedSessions = [];
  state.savedSessions = state.savedSessions.filter(session => session && typeof session === 'object');
  state.savedSessions.forEach((session, index) => Object.assign(session, _savedSessionsNormalizeSession(session, index)));
  return state.savedSessions;
}

function _savedSessionsBridgeAvailable() {
  return WidgetSDK.extensionRelay.supports('savedSessions', 'browserSessions');
}

function _savedSessionsReadView(widget) {
  if (_savedSessionsViewMemory.has(widget.id)) return _savedSessionsViewMemory.get(widget.id);
  const source = WidgetSDK.cache.get('savedSessions', widget.id, 'view') || {};
  const view = {
    selectedId: String(source.selectedId || '').slice(0, 120),
    captureScope: ['active-tab', 'window', 'highlighted', 'group', 'recent'].includes(source.captureScope) ? source.captureScope : '',
    listScrollTop: Math.max(0, Math.min(100000, Number(source.listScrollTop) || 0))
  };
  _savedSessionsViewMemory.set(widget.id, view); return view;
}

function _savedSessionsWriteView(widget, runtime) {
  const view = {
    selectedId: String(runtime?.selectedId || '').slice(0, 120),
    captureScope: ['active-tab', 'window', 'highlighted', 'group', 'recent'].includes(runtime?.captureScope) ? runtime.captureScope : 'window',
    listScrollTop: Math.max(0, Math.min(100000, Number(runtime?.listScrollTop) || 0))
  };
  _savedSessionsViewMemory.set(widget.id, view);
  try { WidgetSDK.cache.set('savedSessions', widget.id, 'view', view); } catch {}
  return view;
}

function _savedSessionsRuntimeFor(widget) {
  let runtime = _savedSessionsRuntime.get(widget.id);
  if (!runtime) {
    const sessions = _savedSessionsAll(); const view = _savedSessionsReadView(widget);
    runtime = {
      selectedId: sessions.some(session => session.id === view.selectedId) ? view.selectedId : (sessions[0]?.id || ''),
      editingId: '',
      captureScope: view.captureScope || (['active-tab', 'window', 'highlighted', 'group', 'recent'].includes(widget.config?.defaultCaptureScope)
        ? widget.config.defaultCaptureScope : 'window'),
      listScrollTop: view.listScrollTop,
      status: '',
      busy: false
    };
    _savedSessionsRuntime.set(widget.id, runtime);
  }
  return runtime;
}

function _savedSessionsCommit() {
  if (typeof saveState === 'function') void saveState();
  _savedSessionsRefreshWidgets();
}

function _savedSessionsRefreshWidgets() {
  for (const [key, entry] of _savedSessionsRenderers) {
    if (!entry.element?.isConnected) {
      _savedSessionsRenderers.delete(key);
      continue;
    }
    entry.render();
  }
}

async function _savedSessionsCapture(scope, title = '') {
  if (!_savedSessionsBridgeAvailable()) throw new Error('Firefox session capture is unavailable. Install or reload the extension and check its Hub connection.');
  const result = await WidgetSDK.extensionRelay.invoke('savedSessions', 'captureBrowserSession', scope);
  const session = _savedSessionsNormalizeSession({
    ...result,
    title: String(title || result.title || '').trim() || `Session ${new Date().toLocaleString()}`,
    createdAt: result.createdAt || new Date().toISOString()
  });
  if (!session.tabs.length) throw new Error('No supported web tabs were returned. Private and internal browser pages cannot be saved.');
  return session;
}

function _savedSessionsFallbackLaunch(tabs) {
  let opened = 0;
  let failed = 0;
  for (const tab of _savedSessionsNormalizeTabs(tabs)) {
    try {
      if (typeof document === 'undefined') throw new Error('A browser document is unavailable.');
      const link = document.createElement('a');
      link.href = tab.url;
      link.target = '_blank';
      link.rel = 'noreferrer noopener';
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      link.remove();
      opened += 1;
    } catch { failed += 1; }
  }
  return { opened, failed, failures: [], groupingSupported: false, fallback: true };
}

async function _savedSessionsLaunch(widget, session) {
  const tabs = _savedSessionsNormalizeTabs(session?.tabs);
  if (!tabs.length) throw new Error('This session has no supported tabs to launch.');
  const staggerMs = Math.max(0, Math.min(1000, Number(widget.config?.staggerMs) || 0));
  const recreateGroups = widget.config?.recreateGroups !== false;
  const result = _savedSessionsBridgeAvailable()
    ? await WidgetSDK.extensionRelay.invoke('savedSessions', 'launchBrowserSession', tabs, { staggerMs, recreateGroups })
    : _savedSessionsFallbackLaunch(tabs);
  if (!Number(result?.opened)) throw new Error(result?.failed ? `No tabs opened; ${result.failed} failed.` : 'The browser blocked every tab.');
  const launchedAt = new Date().toISOString();
  session.lastLaunchedAt = launchedAt;
  session.updatedAt = launchedAt;
  return result;
}

function _savedSessionsRunLargeAction(tabCount, action) {
  if (tabCount > SAVED_SESSIONS_LARGE_LAUNCH_COUNT && typeof showConfirmDialog === 'function') {
    showConfirmDialog(`Open ${tabCount} tabs from this session?`, action, 'Open Tabs');
    return true;
  }
  void action();
  return false;
}

function _savedSessionsClone(session) {
  const now = new Date().toISOString();
  return _savedSessionsNormalizeSession({
    ...session,
    id: _savedSessionsId(),
    title: `${session.title} copy`,
    createdAt: now,
    updatedAt: now,
    lastLaunchedAt: null,
    tabs: session.tabs.map(tab => ({ ...tab, group: tab.group ? { ...tab.group } : null }))
  });
}

function _savedSessionsFormatDate(value, fallback = 'Never') {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function _savedSessionsGroupSummary(session) {
  const groups = new Map();
  session.tabs.forEach(tab => {
    if (!tab.group?.title) return;
    const key = `${tab.group.title}|${tab.group.color}`;
    if (!groups.has(key)) groups.set(key, { ...tab.group, count: 0 });
    groups.get(key).count += 1;
  });
  return [...groups.values()];
}

function _savedSessionsElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function _savedSessionsButton(label, className = '') {
  const button = _savedSessionsElement('button', className, label);
  button.type = 'button';
  return button;
}

function _savedSessionsFavicon(tab) {
  const wrapper = _savedSessionsElement('span', 'saved-sessions-favicon');
  const color = SAVED_SESSIONS_GROUP_COLORS[String(tab.group?.color || '').toLowerCase()];
  if (color) wrapper.style.setProperty('--session-group-color', color);
  const fallback = _savedSessionsElement('span', 'saved-sessions-favicon-fallback', (tab.title || '?').slice(0, 1).toUpperCase());
  const image = document.createElement('img');
  image.alt = '';
  image.draggable = false;
  image.addEventListener('load', () => fallback.classList.add('hidden'));
  image.addEventListener('error', () => image.remove());
  wrapper.append(fallback, image);
  if (typeof resolveFaviconSource === 'function') {
    Promise.resolve(resolveFaviconSource({ title: tab.title, url: tab.url, faviconCache: '' }))
      .then(source => { if (source && image.isConnected) image.src = source; })
      .catch(() => {});
  }
  else {
    try { image.src = `${new URL(tab.url).origin}/favicon.ico`; } catch { image.remove(); }
  }
  return wrapper;
}

function _savedSessionsSetBusy(runtime, status) {
  runtime.busy = true;
  runtime.status = status;
  _savedSessionsRefreshWidgets();
}

function _savedSessionsFinish(runtime, status) {
  runtime.busy = false;
  runtime.status = status;
  _savedSessionsCommit();
}

async function _savedSessionsCaptureMutation(widget, runtime, mode, session, title = '') {
  _savedSessionsSetBusy(runtime, mode === 'create' ? 'Capturing tabs…' : mode === 'replace' ? 'Replacing session…' : 'Appending tabs…');
  try {
    const captured = await _savedSessionsCapture(runtime.captureScope, title);
    if (typeof pushUndoSnapshot === 'function') pushUndoSnapshot();
    if (mode === 'create') {
      _savedSessionsAll().unshift(captured);
      runtime.selectedId = captured.id; _savedSessionsWriteView(widget, runtime);
      _savedSessionsFinish(runtime, `Saved ${captured.tabs.length} tab${captured.tabs.length === 1 ? '' : 's'}.`);
      return captured;
    }
    if (!session || !_savedSessionsAll().includes(session)) throw new Error('That saved session no longer exists.');
    const now = new Date().toISOString();
    if (mode === 'replace') session.tabs = captured.tabs;
    else session.tabs = _savedSessionsNormalizeTabs([...session.tabs, ...captured.tabs]);
    session.updatedAt = now;
    _savedSessionsFinish(runtime, mode === 'replace'
      ? `Replaced with ${session.tabs.length} tab${session.tabs.length === 1 ? '' : 's'}.`
      : `Session now contains ${session.tabs.length} unique tab${session.tabs.length === 1 ? '' : 's'}.`);
    return session;
  } catch (error) {
    runtime.busy = false;
    runtime.status = error?.message || String(error);
    _savedSessionsRefreshWidgets();
    return null;
  }
}

function _savedSessionsRenderWidget(widget, element, context = 'column') {
  const runtime = _savedSessionsRuntimeFor(widget);
  const sessions = _savedSessionsAll();
  if (!sessions.some(session => session.id === runtime.selectedId)) { runtime.selectedId = sessions[0]?.id || ''; _savedSessionsWriteView(widget, runtime); }
  const selected = sessions.find(session => session.id === runtime.selectedId) || null;
  const rendererKey = `${widget.id}:${context}`;
  _savedSessionsRenderers.set(rendererKey, { element, render: () => _savedSessionsRenderWidget(widget, element, context) });

  element.innerHTML = '';
  element.classList.remove('saved-sessions-widget--column', 'saved-sessions-widget--navpane');
  element.classList.add('saved-sessions-widget', `saved-sessions-widget--${context}`);

  const availability = _savedSessionsElement('div', `saved-sessions-availability${_savedSessionsBridgeAvailable() ? ' is-connected' : ''}`);
  availability.textContent = _savedSessionsBridgeAvailable()
    ? 'Firefox session capture and grouped launch are available.'
    : 'Capture needs the Firefox extension. Saved URLs can still launch without groups or pin state.';
  element.appendChild(availability);

  const capture = _savedSessionsElement('div', 'saved-sessions-capture');
  const name = _savedSessionsElement('input', 'saved-sessions-name');
  name.type = 'text';
  name.maxLength = 120;
  name.placeholder = 'Optional session name';
  name.setAttribute('aria-label', 'New session name');
  const scope = _savedSessionsElement('select', 'saved-sessions-scope');
  scope.setAttribute('aria-label', 'Tabs to capture');
  [['active-tab', 'Active tab'], ['window', 'Current window'], ['highlighted', 'Selected tabs'], ['group', 'Current group'], ['recent', 'Recently closed']].forEach(([value, label]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    option.selected = runtime.captureScope === value;
    scope.appendChild(option);
  });
  scope.addEventListener('change', () => { runtime.captureScope = scope.value; _savedSessionsWriteView(widget, runtime); });
  const save = _savedSessionsButton(runtime.busy ? 'Working…' : 'Save Session', 'saved-sessions-save');
  save.disabled = runtime.busy || !_savedSessionsBridgeAvailable();
  save.addEventListener('click', () => { runtime.captureScope = scope.value; void _savedSessionsCaptureMutation(widget, runtime, 'create', null, name.value); });
  capture.append(name, scope, save);
  element.appendChild(capture);

  const list = _savedSessionsElement('div', 'saved-sessions-list');
  sessions.forEach(session => {
    const card = _savedSessionsButton('', `saved-sessions-card${session.id === runtime.selectedId ? ' active' : ''}`);
    card.dataset.sessionId = session.id;
    const copy = _savedSessionsElement('span', 'saved-sessions-card-copy');
    copy.append(
      _savedSessionsElement('strong', '', session.title),
      _savedSessionsElement('small', '', `${session.tabs.length} tab${session.tabs.length === 1 ? '' : 's'} · ${session.lastLaunchedAt ? `Launched ${_savedSessionsFormatDate(session.lastLaunchedAt)}` : 'Never launched'}`)
    );
    const icons = _savedSessionsElement('span', 'saved-sessions-favicons');
    const previewCount = Math.max(1, Math.min(8, Number(widget.config?.previewIcons) || 4));
    session.tabs.slice(0, previewCount).forEach(tab => icons.appendChild(_savedSessionsFavicon(tab)));
    if (session.tabs.length > previewCount) icons.appendChild(_savedSessionsElement('span', 'saved-sessions-favicon-more', `+${session.tabs.length - previewCount}`));
    card.append(copy, icons);
    card.addEventListener('click', () => { runtime.selectedId = session.id; runtime.editingId = ''; runtime.status = ''; _savedSessionsWriteView(widget, runtime); _savedSessionsRenderWidget(widget, element, context); });
    list.appendChild(card);
  });
  if (!sessions.length) list.appendChild(_savedSessionsElement('div', 'saved-sessions-empty', 'No saved sessions yet. Capture the active tab, current window, selected tabs, a group, or recently closed tabs.'));
  element.appendChild(list); list.scrollTop = runtime.listScrollTop;
  list.addEventListener('scroll', () => {
    runtime.listScrollTop = list.scrollTop;
    WidgetSDK.runtime.requestFrame(`${widget.id}:saved-sessions-list-view`, () => _savedSessionsWriteView(widget, runtime));
  }, { passive: true });

  if (selected) {
    const detail = _savedSessionsElement('div', 'saved-sessions-detail');
    const heading = _savedSessionsElement('div', 'saved-sessions-detail-heading');
    if (runtime.editingId === selected.id) {
      const input = _savedSessionsElement('input', 'saved-sessions-rename');
      input.type = 'text';
      input.maxLength = 120;
      input.value = selected.title;
      input.setAttribute('aria-label', 'Session name');
      const commitRename = () => {
        const value = input.value.trim();
        if (!value) { runtime.status = 'Session names cannot be empty.'; _savedSessionsRenderWidget(widget, element, context); return; }
        if (typeof pushUndoSnapshot === 'function') pushUndoSnapshot();
        selected.title = value;
        selected.updatedAt = new Date().toISOString();
        runtime.editingId = '';
        _savedSessionsFinish(runtime, 'Session renamed.');
      };
      input.addEventListener('keydown', event => { if (event.key === 'Enter') commitRename(); if (event.key === 'Escape') { runtime.editingId = ''; _savedSessionsRenderWidget(widget, element, context); } });
      const saveName = _savedSessionsButton('Save name');
      saveName.addEventListener('click', commitRename);
      heading.append(input, saveName);
      WidgetSDK.runtime.requestFrame(`${widget.id}:saved-sessions-rename`, () => { input.focus(); input.select(); });
    } else {
      heading.append(
        _savedSessionsElement('strong', '', selected.title),
        _savedSessionsElement('span', '', `Saved ${_savedSessionsFormatDate(selected.createdAt, 'Unknown')}`)
      );
    }
    detail.appendChild(heading);

    const groups = _savedSessionsGroupSummary(selected);
    if (groups.length) {
      const groupRow = _savedSessionsElement('div', 'saved-sessions-groups');
      groups.forEach(group => {
        const chip = _savedSessionsElement('span', '', `${group.title} · ${group.count}`);
        chip.style.setProperty('--session-group-color', SAVED_SESSIONS_GROUP_COLORS[group.color.toLowerCase()] || SAVED_SESSIONS_GROUP_COLORS.grey);
        groupRow.appendChild(chip);
      });
      detail.appendChild(groupRow);
    }

    const actions = _savedSessionsElement('div', 'saved-sessions-actions');
    const launch = _savedSessionsButton('Launch', 'is-primary');
    launch.disabled = runtime.busy || !selected.tabs.length;
    launch.addEventListener('click', () => {
      const run = async () => {
        _savedSessionsSetBusy(runtime, 'Launching session…');
        try {
          const result = await _savedSessionsLaunch(widget, selected);
          const fallback = result.fallback ? ' Browser fallback cannot restore groups or pinned state.' : result.groupingSupported === false ? ' Tab grouping was unavailable.' : '';
          const failures = Number(result.failed) ? ` ${result.failed} failed.` : '';
          _savedSessionsFinish(runtime, `Opened ${result.opened} tab${result.opened === 1 ? '' : 's'}.${failures}${fallback}`);
        } catch (error) {
          runtime.busy = false;
          runtime.status = error?.message || String(error);
          _savedSessionsRefreshWidgets();
        }
      };
      _savedSessionsRunLargeAction(selected.tabs.length, run);
    });
    const replace = _savedSessionsButton('Replace');
    replace.disabled = runtime.busy || !_savedSessionsBridgeAvailable();
    replace.addEventListener('click', () => { runtime.captureScope = scope.value; void _savedSessionsCaptureMutation(widget, runtime, 'replace', selected); });
    const append = _savedSessionsButton('Append tabs');
    append.disabled = runtime.busy || !_savedSessionsBridgeAvailable();
    append.addEventListener('click', () => { runtime.captureScope = scope.value; void _savedSessionsCaptureMutation(widget, runtime, 'append', selected); });
    const rename = _savedSessionsButton('Rename');
    rename.disabled = runtime.busy;
    rename.addEventListener('click', () => { runtime.editingId = selected.id; _savedSessionsRenderWidget(widget, element, context); });
    const duplicate = _savedSessionsButton('Duplicate');
    duplicate.disabled = runtime.busy;
    duplicate.addEventListener('click', () => {
      if (typeof pushUndoSnapshot === 'function') pushUndoSnapshot();
      const copy = _savedSessionsClone(selected);
      const index = _savedSessionsAll().indexOf(selected);
      state.savedSessions.splice(index + 1, 0, copy);
      runtime.selectedId = copy.id; _savedSessionsWriteView(widget, runtime);
      _savedSessionsFinish(runtime, 'Session duplicated.');
    });
    const remove = _savedSessionsButton('Delete', 'is-danger');
    remove.disabled = runtime.busy;
    remove.addEventListener('click', () => {
      const perform = () => {
        if (typeof pushUndoSnapshot === 'function') pushUndoSnapshot();
        const index = _savedSessionsAll().indexOf(selected);
        if (index !== -1) state.savedSessions.splice(index, 1);
        runtime.selectedId = state.savedSessions[index]?.id || state.savedSessions[index - 1]?.id || ''; _savedSessionsWriteView(widget, runtime);
        runtime.editingId = '';
        _savedSessionsFinish(runtime, 'Session deleted.');
      };
      if (typeof showConfirmDialog === 'function') showConfirmDialog(`Delete “${selected.title}”?`, perform, 'Delete Session');
      else perform();
    });
    actions.append(launch, replace, append, rename, duplicate, remove);
    detail.appendChild(actions);
    element.appendChild(detail);
  }

  const status = _savedSessionsElement('div', `saved-sessions-status${runtime.status ? '' : ' hidden'}`, runtime.status);
  status.setAttribute('role', 'status');
  element.appendChild(status);
}

WIDGET_REGISTRY['savedSessions'] = {
  id: 'savedSessions',
  name: 'Saved Sessions',
  category: 'Personal & Productivity',
  description: 'Capture, organize, preview, and safely relaunch portable Firefox tab sessions.',
  allowedIn: ['column', 'navpane'],
  liveSettingsPreview: false,
  defaultConfig: { defaultCaptureScope: 'window', staggerMs: 125, recreateGroups: true, previewIcons: 4 },
  defaultData: {},
  settingsSchema: {
    type: 'object',
    properties: {
      defaultCaptureScope: { type: 'string', enum: ['active-tab', 'window', 'highlighted', 'group', 'recent'] },
      staggerMs: { type: 'number' },
      recreateGroups: { type: 'boolean' },
      previewIcons: { type: 'number' }
    },
    additionalProperties: false
  },
  capabilities: { extensionRelay: { optional: true }, localCache: { quotaBytes: 64 * 1024 } },
  responsive: { minWidth: 200, preferredWidth: 460, compactBelow: 300 },
  migrate(widget) {
    widget.config = { ...this.defaultConfig, ...(widget.config || {}) };
    widget.data = {};
    return widget;
  },
  onSettingsCommit(widget, previousConfig) {
    const runtime = _savedSessionsRuntimeFor(widget);
    if (widget.config.defaultCaptureScope !== previousConfig?.defaultCaptureScope) { runtime.captureScope = widget.config.defaultCaptureScope; _savedSessionsWriteView(widget, runtime); }
  },
  dispose(widget) {
    _savedSessionsRuntime.delete(widget.id); _savedSessionsViewMemory.delete(widget.id); WidgetSDK.cache.remove('savedSessions', widget.id, 'view');
    for (const key of _savedSessionsRenderers.keys()) if (key.startsWith(`${widget.id}:`)) _savedSessionsRenderers.delete(key);
  },
  cleanup(widget) {
    _savedSessionsRuntime.delete(widget.id); _savedSessionsViewMemory.delete(widget.id);
    for (const key of _savedSessionsRenderers.keys()) if (key.startsWith(`${widget.id}:`)) _savedSessionsRenderers.delete(key);
  },
  render(widget, element, context) { _savedSessionsRenderWidget(widget, element, context); },
  renderSettings(widget, container) {
    const scope = ['active-tab', 'window', 'highlighted', 'group', 'recent'].includes(widget.config.defaultCaptureScope) ? widget.config.defaultCaptureScope : 'window';
    const stagger = [0, 125, 250, 500].includes(Number(widget.config.staggerMs)) ? Number(widget.config.staggerMs) : 125;
    const previews = Math.max(1, Math.min(8, Number(widget.config.previewIcons) || 4));
    container.innerHTML = `
      <div class="settings-row"><span>Default capture</span><select class="settings-select" data-cfg="defaultCaptureScope">
        <option value="active-tab" ${scope === 'active-tab' ? 'selected' : ''}>Active tab</option>
        <option value="window" ${scope === 'window' ? 'selected' : ''}>Current window</option>
        <option value="highlighted" ${scope === 'highlighted' ? 'selected' : ''}>Selected tabs</option>
        <option value="group" ${scope === 'group' ? 'selected' : ''}>Current group</option>
        <option value="recent" ${scope === 'recent' ? 'selected' : ''}>Recently closed</option>
      </select></div>
      <div class="settings-row"><span>Launch delay</span><select class="settings-select" data-cfg="staggerMs">
        <option value="0" ${stagger === 0 ? 'selected' : ''}>No delay</option>
        <option value="125" ${stagger === 125 ? 'selected' : ''}>125 ms</option>
        <option value="250" ${stagger === 250 ? 'selected' : ''}>250 ms</option>
        <option value="500" ${stagger === 500 ? 'selected' : ''}>500 ms</option>
      </select></div>
      <div class="settings-row"><span>Preview favicons</span><input class="settings-text-input" type="number" min="1" max="8" step="1" data-cfg="previewIcons" value="${previews}" /></div>
      <div class="settings-row"><span>Restore tab groups when supported</span><label class="settings-toggle"><input type="checkbox" data-cfg="recreateGroups" ${widget.config.recreateGroups !== false ? 'checked' : ''} /><span class="toggle-track"></span></label></div>
      <div class="settings-help">Session titles, URLs, pin state, and group labels/colours are portable. Browser tab and window IDs are never stored.</div>`;
  }
};
