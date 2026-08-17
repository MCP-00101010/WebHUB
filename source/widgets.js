// --- Widget registry and framework ---

const WIDGET_REGISTRY = {};
const WIDGET_CATEGORY_ORDER = [
  'Personal & Productivity',
  'Weather & Network',
  'Space & Astronomy',
  'Content & Feeds',
  'Other'
];

// Timer storage: key = "widgetId:context"
const _widgetTimers = new Map();
const _widgetRefreshers = new Map();
const _widgetFetches = new Map();
function _setWidgetTimer(widgetId, context, fn, ms) {
  const key = `${widgetId}:${context}`;
  const existing = _widgetTimers.get(key);
  if (existing?.cancel) existing.cancel();
  else if (existing) clearInterval(existing);
  const timer = typeof WidgetSDK !== 'undefined'
    ? WidgetSDK.runtime.schedule(key, fn, ms)
    : setInterval(fn, ms);
  _widgetTimers.set(key, timer);
}

function _setWidgetRefresher(widgetId, context, fn) {
  _widgetRefreshers.set(`${widgetId}:${context}`, fn);
}

function _refreshWidget(widgetId, context) {
  const refresh = _widgetRefreshers.get(`${widgetId}:${context}`);
  if (typeof refresh === 'function') refresh();
}

function _widgetRenderSignature(widget) {
  try { return JSON.stringify([widget?.title || '', widget?.config || {}, widget?.data || {}]); }
  catch { return `${widget?.widgetType || ''}:${widget?.id || ''}`; }
}

function clearWidgetContextRuntime(widgetId, context) {
  const key = `${widgetId}:${context}`;
  const timer = _widgetTimers.get(key);
  if (timer?.cancel) timer.cancel();
  else if (timer) clearInterval(timer);
  if (typeof WidgetSDK !== 'undefined') WidgetSDK.runtime.cancelSchedule(key);
  _widgetTimers.delete(key);
  _widgetRefreshers.delete(key);
  Object.values(WIDGET_REGISTRY).forEach(definition => {
    if (typeof definition.clearContextRuntime === 'function') definition.clearContextRuntime(widgetId, context);
  });
}

function resizeWidgetRuntime(widgetId) {
  Object.values(WIDGET_REGISTRY).forEach(definition => {
    if (typeof definition.resizeRuntime === 'function') definition.resizeRuntime(widgetId);
  });
}

function refreshRenderedWidget(widget, context = 'column') {
  if (!widget?.id) return false;
  const selector = context === 'navpane' ? '.nav-widget-item' : '.widget-card';
  const host = [...document.querySelectorAll(`${selector}[data-item-id], ${selector}[data-id]`)]
    .find(element => (element.dataset.itemId || element.dataset.id) === widget.id);
  const body = host?.querySelector(context === 'navpane' ? '.nav-widget-body' : '.widget-body');
  const def = WIDGET_REGISTRY[widget.widgetType];
  if (!host || !body || !def) return false;
  clearWidgetContextRuntime(widget.id, context);
  body.innerHTML = '';
  if (typeof WidgetSDK !== 'undefined') WidgetSDK.runtime.render(def, widget, body, context);
  else def.render(widget, body, context);
  host.dataset.widgetRenderSignature = _widgetRenderSignature(widget);
  requestAnimationFrame(() => resizeWidgetRuntime(widget.id));
  return true;
}

function disposeWidgetRuntime(widget) {
  if (!widget?.id || widget.type !== 'widget') return;
  const widgetId = widget.id;
  for (const [key, timer] of _widgetTimers) {
    if (key.startsWith(`${widgetId}:`)) {
      if (timer?.cancel) timer.cancel();
      else clearInterval(timer);
      _widgetTimers.delete(key);
    }
  }
  for (const key of _widgetRefreshers.keys()) {
    if (key.startsWith(`${widgetId}:`)) _widgetRefreshers.delete(key);
  }
  for (const key of _widgetFetches.keys()) {
    if (key.includes(`:${widgetId}`)) {
      _widgetFetches.delete(key);
    }
  }
  const def = WIDGET_REGISTRY[widget.widgetType];
  if (typeof WidgetSDK !== 'undefined') WidgetSDK.runtime.teardown(widget);
  else if (typeof def?.dispose === 'function') def.dispose(widget);
}

function disposeWidgetsInValue(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  if (value.type === 'widget') disposeWidgetRuntime(value);
  if (Array.isArray(value)) value.forEach(entry => disposeWidgetsInValue(entry, seen));
  else Object.values(value).forEach(entry => disposeWidgetsInValue(entry, seen));
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
    if (typeof WidgetSDK !== 'undefined') WidgetSDK.runtime.render(def, widget, body, context);
    else def.render(widget, body, context);
    host.dataset.widgetRenderSignature = _widgetRenderSignature(widget);
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
      const request = typeof WidgetSDK !== 'undefined'
        ? WidgetSDK.runtime.reload(def, widget)
        : def.reload(widget);
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
  if (typeof WidgetSDK !== 'undefined') WidgetSDK.runtime.render(def, widget, body, 'column');
  else def.render(widget, body, 'column');

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

  el.dataset.widgetRenderSignature = _widgetRenderSignature(widget);

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
  const savedData   = cloneData(widget.data);
  const savedTitle  = widget.title;
  const draftWidget = {
    ...widget,
    title: savedTitle,
    config: cloneData(savedConfig),
    data: cloneData(savedData)
  };

  const applyDraftToWidget = () => {
    widget.title = draftWidget.title;
    widget.config = cloneData(draftWidget.config);
    widget.data = cloneData(draftWidget.data);
  };
  const restoreSavedWidget = () => {
    widget.title = savedTitle;
    widget.config = cloneData(savedConfig);
    widget.data = cloneData(savedData);
  };

  const panel      = document.getElementById('widgetSettingsPanel');
  const titleInput = document.getElementById('wstgTitle');
  const body       = document.getElementById('wstgBody');
  const subtitle   = document.getElementById('wstgSubtitle');

  panel.classList.toggle('widget-settings-panel--wide', def.settingsPanelWidth === 'wide');
  if (subtitle) subtitle.textContent = (options.isNew ? 'New ' : 'Edit ') + def.name;
  titleInput.value = widget.title || '';
  body.innerHTML   = '';
  def.renderSettings(draftWidget, body);
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
    placementInput.checked = draftWidget.config?.sidebarBottom === true;
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
      draftWidget.config[key] = input.type === 'checkbox' ? input.checked : input.value;
    });
    draftWidget.title = titleInput.value.trim();
    if (refreshPreview && def.liveSettingsPreview !== false && onRefresh) {
      applyDraftToWidget();
      onRefresh();
    }
  };
  body.addEventListener('input',  () => syncConfig(), { signal: sig });
  body.addEventListener('change', () => syncConfig(), { signal: sig });

  const doneButton = document.getElementById('wstgDoneBtn');
  const cancelButton = document.getElementById('wstgCancelBtn');
  doneButton.disabled = false;
  cancelButton.disabled = false;
  doneButton.addEventListener('click', async () => {
    if (doneButton.disabled) return;
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
    syncConfig(false);
    if (typeof WidgetSDK !== 'undefined') {
      const validation = WidgetSDK.settings.validateDraft(def, draftWidget);
      if (!validation.valid) {
        showNotice(validation.errors[0] || `Invalid ${def.name} settings.`);
        return;
      }
    }
    if (typeof def.beforeSettingsCommit === 'function') {
      doneButton.disabled = true;
      cancelButton.disabled = true;
      let canCommit = false;
      try {
        canCommit = await def.beforeSettingsCommit(draftWidget, body, {
          originalWidget: widget,
          savedConfig: cloneData(savedConfig),
          savedData: cloneData(savedData),
          savedTitle
        }) !== false;
      } catch (error) {
        console.warn(`Failed to save ${def.name} settings`, error);
        showNotice(error?.message || `Could not save ${def.name} settings.`);
      }
      if (!canCommit) {
        doneButton.disabled = false;
        cancelButton.disabled = false;
        return;
      }
    }
    restoreSavedWidget();
    if (!options.deferUndo) pushUndoSnapshot();
    applyDraftToWidget();
    if (typeof def.onSettingsCommit === 'function') def.onSettingsCommit(widget, savedConfig);
    if (options.onDone) options.onDone(widget);
    panel.classList.add('hidden');
    elements.modalOverlay.classList.add('hidden');
    saveState();
    if (onRefresh) onRefresh();
    _wstgAbort.abort();
  }, { signal: sig });

  cancelButton.addEventListener('click', () => {
    restoreSavedWidget();
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

function _escapeWidgetSettingValue(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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

function _setWidgetStatusText(el, text, cls = '') {
  const row = document.createElement('div');
  row.className = `widget-apod-status${cls ? ` ${cls}` : ''}`;
  row.textContent = text;
  el.appendChild(row);
}

// ---- Clock widget ----

WIDGET_REGISTRY['clock'] = {
  name: 'Clock',
  category: 'Personal & Productivity',
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
          <input type="text" list="wstgTzList" data-cfg="timezone" placeholder="e.g. America/New_York" value="${_escapeWidgetSettingValue(c.timezone)}" class="settings-text-input" autocomplete="off" />
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
  category: 'Personal & Productivity',
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
        _widgetTimers.get(`${widget.id}:${context}`)?.cancel?.();
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
        <input type="text" data-cfg="label" value="${_escapeWidgetSettingValue(c.label)}" placeholder="Event name" class="settings-text-input" />
      </div>
      <div class="settings-row">
        <span>Target date</span>
        <input type="datetime-local" data-cfg="targetDate" value="${_escapeWidgetSettingValue(c.targetDate)}" class="settings-text-input" />
      </div>
      <div id="countdownDateError" class="settings-warning hidden">Target date must be in the future.</div>`;
  }
};


// ---- Notes widget ----

WIDGET_REGISTRY['notes'] = {
  name: 'Notes',
  category: 'Personal & Productivity',
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
      <textarea data-cfg="content" class="settings-text-input widget-notes-settings-textarea" rows="8" placeholder="Type a note…">${_escapeWidgetSettingValue(c.content)}</textarea>`;
  }
};


// ---- To-do list widget ----

WIDGET_REGISTRY['todo'] = {
  name: 'To-do List',
  category: 'Personal & Productivity',
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
  category: 'Content & Feeds',
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
          <input type="text" data-cfg="url" value="${_escapeWidgetSettingValue(c.url)}" placeholder="Enter URL" class="settings-text-input" />
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
          <input type="text" data-cfg="caption" value="${_escapeWidgetSettingValue(c.caption)}" placeholder="Optional caption" class="settings-text-input" />
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
