// --- Service Monitor widget -------------------------------------------------
// Portable endpoint configuration; samples and uptime history stay local.

const _serviceMonitorRuntime = new Map();
const SERVICE_MONITOR_HISTORY_KEY = 'history';
const SERVICE_MONITOR_MAX_HISTORY = 120;
const SERVICE_MONITOR_INTERVALS = [1, 5, 15, 30, 60];

function _serviceMonitorEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function _serviceMonitorId() {
  return `endpoint-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function _serviceMonitorEndpoints(widget) {
  widget.config = widget.config || {};
  const seen = new Set();
  const endpoints = Array.isArray(widget.config.endpoints) ? widget.config.endpoints : [];
  widget.config.endpoints = endpoints.slice(0, 20).map((entry, index) => {
    const source = entry && typeof entry === 'object' ? entry : {};
    let id = String(source.id || '').trim();
    if (!id || seen.has(id)) id = _serviceMonitorId();
    seen.add(id);
    let url = String(source.url || '').trim().slice(0, 4096);
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:') url = '';
    } catch { url = ''; }
    const intervalMinutes = SERVICE_MONITOR_INTERVALS.includes(Number(source.intervalMinutes)) ? Number(source.intervalMinutes) : 5;
    const assertionType = ['none', 'text', 'json'].includes(source.assertionType) ? source.assertionType : 'none';
    return {
      id,
      name: String(source.name || '').trim().slice(0, 80) || `Service ${index + 1}`,
      url,
      expectedStatus: Math.max(100, Math.min(599, Number.parseInt(source.expectedStatus, 10) || 200)),
      timeoutSeconds: Math.max(3, Math.min(30, Number.parseInt(source.timeoutSeconds, 10) || 10)),
      intervalMinutes,
      assertionType,
      assertionPath: assertionType === 'json' ? String(source.assertionPath || '').trim().slice(0, 160) : '',
      assertionValue: assertionType === 'none' ? '' : String(source.assertionValue || '').slice(0, 500)
    };
  });
  return widget.config.endpoints;
}

function _serviceMonitorHistory(widget) {
  const cached = WidgetSDK.cache.get('serviceMonitor', widget.id, SERVICE_MONITOR_HISTORY_KEY);
  return cached && typeof cached === 'object' && !Array.isArray(cached) ? cached : {};
}

function _serviceMonitorWriteHistory(widget, history) {
  try { WidgetSDK.cache.set('serviceMonitor', widget.id, SERVICE_MONITOR_HISTORY_KEY, history); } catch {}
}

function _serviceMonitorJsonValue(payload, path) {
  if (!path) return payload;
  return String(path).split('.').filter(Boolean).reduce((value, segment) => {
    if (value == null || !Object.prototype.hasOwnProperty.call(Object(value), segment)) return undefined;
    return value[segment];
  }, payload);
}

async function _serviceMonitorDirectCheck(endpoint, widgetId) {
  const startedAt = performance.now();
  const response = await _fetchWithTimeout(endpoint.url, {
    method: 'GET', credentials: 'omit', redirect: 'follow', cache: 'no-store',
    headers: { Accept: endpoint.assertionType === 'json' ? 'application/json, text/plain;q=0.8, */*;q=0.2' : 'text/plain, application/json;q=0.8, */*;q=0.2' },
    widgetType: 'serviceMonitor', widgetFetchKey: `service-monitor:${widgetId}:${endpoint.id}`,
    maxResponseBytes: 128 * 1024
  }, endpoint.timeoutSeconds * 1000);
  let text = '';
  if (endpoint.assertionType !== 'none') {
    const declared = Number(response.headers?.get?.('content-length') || 0);
    if (declared > 128 * 1024) throw new Error('Service response exceeds the 128 KiB limit');
    if (response.body?.getReader) {
      const reader = response.body.getReader(); const chunks = []; let total = 0;
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        total += value.byteLength; if (total > 128 * 1024) { await reader.cancel(); throw new Error('Service response exceeds the 128 KiB limit'); }
        chunks.push(value);
      }
      const bytes = new Uint8Array(total); let offset = 0; chunks.forEach(chunk => { bytes.set(chunk, offset); offset += chunk.byteLength; }); text = new TextDecoder().decode(bytes);
    } else {
      const bytes = await response.arrayBuffer(); if (bytes.byteLength > 128 * 1024) throw new Error('Service response exceeds the 128 KiB limit'); text = new TextDecoder().decode(bytes);
    }
  } else { try { await response.body?.cancel?.(); } catch {} }
  return { status: response.status, finalUrl: response.url || endpoint.url, text, durationMs: Math.max(0, Math.round(performance.now() - startedAt)) };
}

async function _serviceMonitorCheck(endpoint, widgetId) {
  const checkedAt = Date.now();
  let result;
  let directError = null;
  try {
    result = await _serviceMonitorDirectCheck(endpoint, widgetId);
  } catch (error) {
    directError = error;
    try {
      result = await WidgetSDK.extensionRelay.invoke('serviceMonitor', 'monitorService', endpoint);
    } catch {}
  }
  if (!result) {
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    return { checkedAt, ok: false, status: 0, durationMs: 0, errorType: offline ? 'offline' : (directError?.name === 'TimeoutError' || /timed out/i.test(directError?.message || '') ? 'timeout' : 'network'), error: offline ? 'Browser is offline' : (directError?.message || 'Network request failed') };
  }
  const status = Number(result.status || 0);
  let assertionOk = true;
  let assertionError = '';
  if (endpoint.assertionType === 'text') {
    assertionOk = String(result.text || '').includes(endpoint.assertionValue);
    if (!assertionOk) assertionError = 'Expected text was not found';
  } else if (endpoint.assertionType === 'json') {
    try {
      const payload = JSON.parse(String(result.text || ''));
      const actual = _serviceMonitorJsonValue(payload, endpoint.assertionPath);
      assertionOk = String(actual ?? '') === endpoint.assertionValue;
      if (!assertionOk) assertionError = `JSON assertion did not match (${String(actual ?? 'missing').slice(0, 80)})`;
    } catch { assertionOk = false; assertionError = 'Response was not valid JSON'; }
  }
  const statusOk = status === endpoint.expectedStatus;
  return {
    checkedAt,
    ok: statusOk && assertionOk,
    status,
    durationMs: Math.max(0, Number(result.durationMs) || 0),
    finalUrl: String(result.finalUrl || endpoint.url).slice(0, 4096),
    errorType: !statusOk ? (status === 429 ? 'rate-limit' : 'http') : (!assertionOk ? 'assertion' : ''),
    error: !statusOk ? `Expected ${endpoint.expectedStatus}, received ${status || 'no response'}` : assertionError
  };
}

function _serviceMonitorNotify(widget, endpoint, previous, sample) {
  if (widget.config?.notifications !== true || sample.ok || previous?.ok !== true) return;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try { new Notification(`${endpoint.name} is unavailable`, { body: sample.error || `HTTP ${sample.status || 0}` }); } catch {}
}

async function _serviceMonitorRunDue(widget, options = {}) {
  const endpoints = _serviceMonitorEndpoints(widget).filter(endpoint => endpoint.url);
  const history = _serviceMonitorHistory(widget);
  const now = Date.now();
  const due = endpoints.filter(endpoint => {
    if (options.endpointId && endpoint.id !== options.endpointId) return false;
    const samples = Array.isArray(history[endpoint.id]) ? history[endpoint.id] : [];
    const latest = samples[samples.length - 1];
    if (options.force) return true;
    const failures = samples.slice(-5).reverse().findIndex(sample => sample.ok);
    const backoffMultiplier = latest?.ok === false ? Math.min(8, 2 ** Math.max(0, failures < 0 ? Math.min(3, samples.length) : failures)) : 1;
    return !latest || now - latest.checkedAt >= endpoint.intervalMinutes * 60000 * backoffMultiplier;
  });
  if (!due.length) return;
  const runtime = _serviceMonitorRuntime.get(widget.id) || { running: new Set() };
  _serviceMonitorRuntime.set(widget.id, runtime);
  await Promise.all(due.map(async endpoint => {
    if (runtime.running.has(endpoint.id)) return;
    runtime.running.add(endpoint.id);
    try {
      const samples = Array.isArray(history[endpoint.id]) ? history[endpoint.id] : [];
      const previous = samples[samples.length - 1];
      const sample = await _serviceMonitorCheck(endpoint, widget.id);
      history[endpoint.id] = [...samples, sample].slice(-SERVICE_MONITOR_MAX_HISTORY);
      _serviceMonitorNotify(widget, endpoint, previous, sample);
    } finally { runtime.running.delete(endpoint.id); }
  }));
  _serviceMonitorWriteHistory(widget, history);
  _refreshWidget(widget.id, 'column');
  _refreshWidget(widget.id, 'navpane');
}

function _serviceMonitorSparkline(samples) {
  const recent = samples.slice(-24);
  const graph = document.createElement('div');
  graph.className = 'service-monitor-sparkline';
  graph.setAttribute('aria-label', `${recent.filter(sample => sample.ok).length} of ${recent.length} recent checks succeeded`);
  recent.forEach(sample => {
    const bar = document.createElement('span');
    bar.className = sample.ok ? 'is-up' : 'is-down';
    bar.title = `${new Date(sample.checkedAt).toLocaleString()} · ${sample.ok ? 'Up' : sample.error || 'Down'}${sample.durationMs ? ` · ${sample.durationMs} ms` : ''}`;
    graph.appendChild(bar);
  });
  return graph;
}

function _serviceMonitorRender(widget, element, context) {
  const endpoints = _serviceMonitorEndpoints(widget);
  const history = _serviceMonitorHistory(widget);
  element.className = `service-monitor-widget${context === 'navpane' ? ' is-compact' : ''}`;
  const rerender = () => {
    if (!element.isConnected) return;
    element.innerHTML = '';
    _serviceMonitorRender(widget, element, context);
  };
  _setWidgetRefresher(widget.id, context, rerender);
  const header = document.createElement('div'); header.className = 'service-monitor-header';
  const summary = document.createElement('span'); summary.className = 'service-monitor-summary';
  const latest = endpoints.map(endpoint => (history[endpoint.id] || []).at?.(-1)).filter(Boolean);
  const down = latest.filter(sample => !sample.ok).length;
  summary.textContent = !endpoints.length ? 'No endpoints' : !latest.length ? `${endpoints.length} awaiting checks` : down ? `${down} down · ${latest.length - down} up` : `${latest.length} services up`;
  header.appendChild(summary); element.appendChild(header);
  if (!endpoints.length) {
    const empty = document.createElement('div'); empty.className = 'widget-empty-state'; empty.textContent = 'Add an HTTPS endpoint in widget settings.'; element.appendChild(empty); return;
  }
  const list = document.createElement('div'); list.className = 'service-monitor-list';
  endpoints.forEach(endpoint => {
    const samples = Array.isArray(history[endpoint.id]) ? history[endpoint.id] : [];
    const sample = samples[samples.length - 1];
    const row = document.createElement('div'); row.className = `service-monitor-row ${sample ? (sample.ok ? 'is-up' : 'is-down') : 'is-pending'}`;
    const state = document.createElement('span'); state.className = 'service-monitor-state'; state.textContent = sample ? (sample.ok ? '●' : '×') : '○';
    const details = document.createElement('div'); details.className = 'service-monitor-details';
    const name = document.createElement('div'); name.className = 'service-monitor-name'; name.textContent = endpoint.name;
    const meta = document.createElement('div'); meta.className = 'service-monitor-meta';
    if (!sample) meta.textContent = 'Not checked yet';
    else meta.textContent = sample.ok ? `${sample.status} · ${sample.durationMs} ms · ${new Date(sample.checkedAt).toLocaleTimeString()}` : `${sample.error || 'Unavailable'} · ${new Date(sample.checkedAt).toLocaleTimeString()}`;
    details.append(name, meta);
    const button = document.createElement('button'); button.type = 'button'; button.className = 'service-monitor-check'; button.textContent = '↻'; button.title = `Check ${endpoint.name}`;
    button.addEventListener('click', async () => { button.disabled = true; await _serviceMonitorRunDue(widget, { force: true, endpointId: endpoint.id }); button.disabled = false; rerender(); });
    row.append(state, details, button);
    if (samples.length) row.appendChild(_serviceMonitorSparkline(samples));
    list.appendChild(row);
  });
  element.appendChild(list);
  void _serviceMonitorRunDue(widget);
  _setWidgetTimer(widget.id, context, () => _serviceMonitorRunDue(widget), 60000);
}

async function _serviceMonitorBeforeCommit(widget) {
  if (widget.config?.notifications !== true || typeof Notification === 'undefined') return true;
  let permission = Notification.permission;
  if (permission === 'default') try { permission = await Notification.requestPermission(); } catch { permission = 'denied'; }
  if (permission !== 'granted') {
    widget.config.notifications = false;
    if (typeof showNotice === 'function') showNotice('Notification permission was not granted. Other monitor settings were saved.');
  }
  return true;
}

function _serviceMonitorRenderSettings(widget, container) {
  const endpoints = _serviceMonitorEndpoints(widget);
  container.innerHTML = `<div class="service-monitor-settings-list"></div><button type="button" class="secondary-btn service-monitor-add">Add endpoint</button>
    <div class="settings-row"><span>Outage notifications</span><label class="settings-toggle"><input type="checkbox" data-cfg="notifications" ${widget.config.notifications === true ? 'checked' : ''}/><span class="toggle-track"></span></label></div>
    <div class="settings-help">Checks accept HTTPS only and never send cookies or credentials. Status history remains in this browser.</div>`;
  const list = container.querySelector('.service-monitor-settings-list');
  const renderRows = () => {
    list.innerHTML = '';
    endpoints.forEach((endpoint, index) => {
      const row = document.createElement('div'); row.className = 'service-monitor-settings-row';
      row.innerHTML = `<div class="service-monitor-settings-grid">
        <input class="settings-text-input" data-field="name" placeholder="Service name" value="${_serviceMonitorEscape(endpoint.name)}"/>
        <input class="settings-text-input" data-field="url" type="url" placeholder="https://status.example.com/health" value="${_serviceMonitorEscape(endpoint.url)}"/>
        <select class="settings-select" data-field="expectedStatus">${[200,201,204,301,302,401,403].map(value => `<option value="${value}" ${endpoint.expectedStatus === value ? 'selected' : ''}>Expect ${value}</option>`).join('')}</select>
        <select class="settings-select" data-field="intervalMinutes">${SERVICE_MONITOR_INTERVALS.map(value => `<option value="${value}" ${endpoint.intervalMinutes === value ? 'selected' : ''}>Every ${value === 60 ? 'hour' : `${value} min`}</option>`).join('')}</select>
        <select class="settings-select" data-field="timeoutSeconds">${[5,10,15,20,30].map(value => `<option value="${value}" ${endpoint.timeoutSeconds === value ? 'selected' : ''}>${value}s timeout</option>`).join('')}</select>
        <select class="settings-select" data-field="assertionType"><option value="none">No content check</option><option value="text" ${endpoint.assertionType === 'text' ? 'selected' : ''}>Contains text</option><option value="json" ${endpoint.assertionType === 'json' ? 'selected' : ''}>JSON path equals</option></select>
        <input class="settings-text-input" data-field="assertionPath" placeholder="JSON path, e.g. status.value" value="${_serviceMonitorEscape(endpoint.assertionPath)}" ${endpoint.assertionType === 'json' ? '' : 'disabled'}/>
        <input class="settings-text-input" data-field="assertionValue" placeholder="Expected value" value="${_serviceMonitorEscape(endpoint.assertionValue)}" ${endpoint.assertionType === 'none' ? 'disabled' : ''}/>
      </div><button type="button" class="icon-btn is-danger service-monitor-remove" title="Remove endpoint">×</button>`;
      row.querySelectorAll('[data-field]').forEach(input => input.addEventListener('input', () => {
        const key = input.dataset.field;
        endpoint[key] = ['expectedStatus','intervalMinutes','timeoutSeconds'].includes(key) ? Number(input.value) : input.value;
        if (key === 'assertionType') renderRows();
      }));
      row.querySelectorAll('select[data-field]').forEach(input => input.addEventListener('change', () => {
        const key = input.dataset.field;
        endpoint[key] = ['expectedStatus','intervalMinutes','timeoutSeconds'].includes(key) ? Number(input.value) : input.value;
        if (key === 'assertionType') renderRows();
      }));
      row.querySelector('.service-monitor-remove').addEventListener('click', () => { endpoints.splice(index, 1); renderRows(); });
      list.appendChild(row);
    });
    if (!endpoints.length) { const empty = document.createElement('div'); empty.className = 'settings-muted'; empty.textContent = 'No endpoints configured.'; list.appendChild(empty); }
    container.querySelector('.service-monitor-add').disabled = endpoints.length >= 20;
  };
  container.querySelector('.service-monitor-add').addEventListener('click', () => { endpoints.push(_serviceMonitorEndpoints({ config: { endpoints: [{}] } })[0]); renderRows(); });
  renderRows();
}

WIDGET_REGISTRY['serviceMonitor'] = {
  id: 'serviceMonitor', name: 'Service Monitor', category: 'Weather & Network',
  description: 'Watch HTTPS endpoints with bounded checks, assertions, local uptime history, and optional outage notifications.',
  allowedIn: ['column', 'navpane'], liveSettingsPreview: false, reloadLabel: 'Check all services',
  defaultConfig: { endpoints: [], notifications: false }, defaultData: {},
  settingsSchema: { type: 'object', properties: { endpoints: { type: 'array' }, notifications: { type: 'boolean' } }, additionalProperties: false },
  capabilities: { network: { domains: ['user-configured'] }, extensionRelay: { optional: true }, timers: true, localCache: { quotaBytes: 512 * 1024 }, notifications: { optional: true } },
  responsive: { minWidth: 240, preferredWidth: 520, compactBelow: 320 },
  migrate(widget) { widget.config = { ...this.defaultConfig, ...(widget.config || {}) }; widget.data = {}; _serviceMonitorEndpoints(widget); return widget; },
  reload(widget) { return _serviceMonitorRunDue(widget, { force: true }); },
  beforeSettingsCommit(widget) { return _serviceMonitorBeforeCommit(widget); },
  onSettingsCommit(widget) { _serviceMonitorRuntime.delete(widget.id); },
  cleanup(widget) { _serviceMonitorRuntime.delete(widget.id); },
  render(widget, element, context) { _serviceMonitorRender(widget, element, context); },
  renderSettings(widget, container) { _serviceMonitorRenderSettings(widget, container); }
};
