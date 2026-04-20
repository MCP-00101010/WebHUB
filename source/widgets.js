// --- Widget registry and framework ---

const WIDGET_REGISTRY = {};

// Timer storage: key = "widgetId:context"
const _widgetTimers = new Map();

function _setWidgetTimer(widgetId, context, fn, ms) {
  const key = `${widgetId}:${context}`;
  const existing = _widgetTimers.get(key);
  if (existing) clearInterval(existing);
  _widgetTimers.set(key, setInterval(fn, ms));
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
    data: JSON.parse(JSON.stringify(def.defaultData))
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
  el.addEventListener('dragend', () => { dragPayload = null; removeDragPlaceholders(); });
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

function openWidgetSettings(widget, onRefresh) {
  if (_wstgAbort) _wstgAbort.abort();
  _wstgAbort = new AbortController();
  const sig = _wstgAbort.signal;

  const def = WIDGET_REGISTRY[widget.widgetType];
  if (!def) return;

  const savedConfig = JSON.parse(JSON.stringify(widget.config));
  const savedTitle  = widget.title;

  const panel      = document.getElementById('widgetSettingsPanel');
  const titleInput = document.getElementById('wstgTitle');
  const body       = document.getElementById('wstgBody');

  titleInput.value = widget.title || '';
  body.innerHTML   = '';
  def.renderSettings(widget, body);

  document.getElementById('modalCard').classList.add('hidden');
  panel.classList.remove('hidden');
  elements.modalOverlay.classList.remove('hidden');
  centerPanel(panel);
  makeDraggable(panel, document.getElementById('wstgHeader'));

  const syncConfig = () => {
    body.querySelectorAll('[data-cfg]').forEach(input => {
      const key = input.dataset.cfg;
      widget.config[key] = input.type === 'checkbox' ? input.checked : input.value;
    });
    if (onRefresh) onRefresh();
  };
  body.addEventListener('input',  syncConfig, { signal: sig });
  body.addEventListener('change', syncConfig, { signal: sig });

  document.getElementById('wstgDoneBtn').addEventListener('click', () => {
    pushUndoSnapshot();
    widget.title = titleInput.value.trim();
    syncConfig();
    panel.classList.add('hidden');
    elements.modalOverlay.classList.add('hidden');
    saveState();
    if (onRefresh) onRefresh();
    _wstgAbort.abort();
  }, { signal: sig, once: true });

  document.getElementById('wstgCancelBtn').addEventListener('click', () => {
    widget.config = savedConfig;
    widget.title  = savedTitle;
    panel.classList.add('hidden');
    elements.modalOverlay.classList.add('hidden');
    if (onRefresh) onRefresh();
    _wstgAbort.abort();
  }, { signal: sig, once: true });
}

// --- Widget picker panel ---

let _wPickerAbort = null;

function openWidgetPicker(context, onSelect) {
  if (_wPickerAbort) _wPickerAbort.abort();
  _wPickerAbort = new AbortController();
  const sig = _wPickerAbort.signal;

  const available = Object.entries(WIDGET_REGISTRY)
    .filter(([, def]) => def.allowedIn.includes(context));
  if (!available.length) return;

  const panel = document.getElementById('widgetPickerPanel');
  const list  = document.getElementById('wPickerList');
  list.innerHTML = '';

  available.forEach(([type, def]) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'widget-picker-btn';
    btn.innerHTML = `<span class="widget-picker-name">${def.name}</span><span class="widget-picker-desc">${def.description}</span>`;
    btn.addEventListener('click', () => {
      panel.classList.add('hidden');
      elements.modalOverlay.classList.add('hidden');
      _wPickerAbort.abort();
      onSelect(type);
    }, { once: true });
    list.appendChild(btn);
  });

  document.getElementById('modalCard').classList.add('hidden');
  panel.classList.remove('hidden');
  elements.modalOverlay.classList.remove('hidden');
  centerPanel(panel);

  document.getElementById('wPickerCancelBtn').addEventListener('click', () => {
    panel.classList.add('hidden');
    elements.modalOverlay.classList.add('hidden');
    _wPickerAbort.abort();
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
        <select data-cfg="format">
          <option value="24h" ${c.format !== '12h' ? 'selected' : ''}>24 hour</option>
          <option value="12h" ${c.format === '12h' ? 'selected' : ''}>12 hour</option>
        </select>
      </div>
      <div class="settings-row">
        <span>Show seconds</span>
        <label class="settings-toggle"><input type="checkbox" data-cfg="showSeconds" ${c.showSeconds ? 'checked' : ''}/><span class="toggle-track"></span></label>
      </div>
      <div class="settings-row">
        <span>Show date</span>
        <label class="settings-toggle"><input type="checkbox" data-cfg="showDate" ${c.showDate ? 'checked' : ''}/><span class="toggle-track"></span></label>
      </div>
      <div class="settings-row">
        <span>Timezone</span>
        <input type="text" data-cfg="timezone" placeholder="e.g. America/New_York" value="${c.timezone || ''}" class="settings-text-input" />
      </div>`;
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
      </div>`;
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
      <div class="settings-row settings-row--top">
        <span>Content</span>
        <textarea data-cfg="content" class="settings-text-input widget-settings-textarea" rows="8" placeholder="Type a note…">${c.content || ''}</textarea>
      </div>`;
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
      <div class="settings-row">
        <span>Clear completed</span>
        <button type="button" class="secondary-btn" id="todoClearDoneBtn">Clear</button>
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
