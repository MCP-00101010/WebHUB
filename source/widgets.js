// --- Widget registry and framework ---

const WIDGET_REGISTRY = {};

// Timer storage: key = "widgetId:context"
const _widgetTimers = new Map();
const _widgetRefreshers = new Map();
const _widgetFetches = new Map();

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

  const header = document.createElement('div');
  header.className = 'widget-header';

  const titleSpan = document.createElement('span');
  titleSpan.className = 'widget-title';
  titleSpan.textContent = widget.title || def.name;
  header.appendChild(titleSpan);

  const settingsBtn = document.createElement('button');
  settingsBtn.type = 'button';
  settingsBtn.className = 'widget-action-btn';
  settingsBtn.title = 'Widget settings';
  settingsBtn.appendChild(icon('icon-settings'));
  settingsBtn.addEventListener('click', e => {
    e.stopPropagation();
    openWidgetSettings(widget, () => {
      titleSpan.textContent = widget.title || def.name;
      body.innerHTML = '';
      def.render(widget, body, 'column');
    });
  });
  header.appendChild(settingsBtn);
  el.appendChild(header);

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
    if (e.target.closest('input, textarea, button, label, select')) { e.preventDefault(); return; }
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

  document.getElementById('modalCard').classList.add('hidden');
  panel.classList.remove('hidden');
  elements.modalOverlay.classList.remove('hidden');
  centerPanel(panel);
  makeDraggable(panel, document.getElementById('wstgHeader'));
  titleInput.focus();

  const syncConfig = () => {
    body.querySelectorAll('[data-cfg]').forEach(input => {
      if (input.type === 'radio' && !input.checked) return;
      const key = input.dataset.cfg;
      widget.config[key] = input.type === 'checkbox' ? input.checked : input.value;
    });
    if (onRefresh) onRefresh();
  };
  body.addEventListener('input',  syncConfig, { signal: sig });
  body.addEventListener('change', syncConfig, { signal: sig });

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
    syncConfig();
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
  const keys = state?.settings?.serviceApiKeys;
  if (!keys || typeof keys !== 'object') return '';
  const value = keys[serviceName];
  return typeof value === 'string' ? value.trim() : '';
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
      widget.data.apodCache = _normalizeApodPayload(payload);
      widget.data.apodStatus = 'ready';
      widget.data.apodError = '';
      saveState();
    })
    .catch(error => {
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
      <div class="settings-row">
        <span>Image URL</span>
        <input type="text" data-cfg="url" value="${c.url || ''}" placeholder="https://example.com/image.png" class="settings-text-input" />
      </div>
      <div class="settings-row">
        <span>Fit</span>
        <select data-cfg="fit">
          <option value="contain" ${(c.fit || 'contain') === 'contain' ? 'selected' : ''}>Contain</option>
          <option value="cover"   ${c.fit === 'cover'   ? 'selected' : ''}>Cover</option>
          <option value="fill"    ${c.fit === 'fill'    ? 'selected' : ''}>Fill</option>
        </select>
      </div>
      <div class="settings-row">
        <span>Caption</span>
        <input type="text" data-cfg="caption" value="${c.caption || ''}" placeholder="Optional caption" class="settings-text-input" />
      </div>`;
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
