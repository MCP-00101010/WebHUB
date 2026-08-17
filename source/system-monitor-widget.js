// --- System Monitor widget --------------------------------------------------
// Reads only explicitly selected aggregate metrics from the native host.

const _systemMonitorRuntime = new Map();
const SYSTEM_MONITOR_METRICS = ['cpu', 'memory', 'disk', 'network', 'uptime', 'battery', 'platform'];
const SYSTEM_MONITOR_HISTORY_KEY = 'samples';
const SYSTEM_MONITOR_MAX_SAMPLES = 120;

function _systemMonitorConfig(widget) {
  widget.config = widget.config || {};
  const metrics = Array.isArray(widget.config.metrics) ? widget.config.metrics : ['cpu', 'memory', 'disk', 'network', 'uptime'];
  widget.config.metrics = [...new Set(metrics.filter(metric => SYSTEM_MONITOR_METRICS.includes(metric)))];
  if (!widget.config.metrics.length) widget.config.metrics = ['cpu'];
  widget.config.refreshSeconds = [5, 15, 30, 60].includes(Number(widget.config.refreshSeconds)) ? Number(widget.config.refreshSeconds) : 15;
  widget.config.cpuWarning = Math.max(1, Math.min(100, Number(widget.config.cpuWarning) || 85));
  widget.config.memoryWarning = Math.max(1, Math.min(100, Number(widget.config.memoryWarning) || 85));
  widget.config.diskWarning = Math.max(1, Math.min(100, Number(widget.config.diskWarning) || 90));
  return widget.config;
}

function _systemMonitorFormatBytes(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (!bytes) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** index).toFixed(index < 2 ? 0 : 1)} ${units[index]}`;
}

function _systemMonitorDuration(seconds) {
  let remaining = Math.max(0, Number(seconds) || 0);
  const days = Math.floor(remaining / 86400); remaining %= 86400;
  const hours = Math.floor(remaining / 3600); remaining %= 3600;
  const minutes = Math.floor(remaining / 60);
  return [days ? `${days}d` : '', hours ? `${hours}h` : '', `${minutes}m`].filter(Boolean).join(' ');
}

function _systemMonitorHistory(widget) {
  const value = WidgetSDK.cache.get('systemMonitor', widget.id, SYSTEM_MONITOR_HISTORY_KEY);
  return Array.isArray(value) ? value.slice(-SYSTEM_MONITOR_MAX_SAMPLES) : [];
}

function _systemMonitorNativeAvailable() {
  try { return WidgetSDK.nativeHost.supports('systemMonitor', 'systemMetrics'); } catch { return false; }
}

async function _systemMonitorFetch(widget, options = {}) {
  const config = _systemMonitorConfig(widget);
  const runtime = _systemMonitorRuntime.get(widget.id) || { loading: false, latest: null, error: '' };
  _systemMonitorRuntime.set(widget.id, runtime);
  if (runtime.loading) return;
  runtime.loading = true; runtime.error = '';
  try {
    const sample = await WidgetSDK.nativeHost.invoke('systemMonitor', 'getSystemMetrics', config.metrics);
    runtime.latest = sample;
    const history = _systemMonitorHistory(widget);
    history.push(sample);
    WidgetSDK.cache.set('systemMonitor', widget.id, SYSTEM_MONITOR_HISTORY_KEY, history.slice(-SYSTEM_MONITOR_MAX_SAMPLES));
  } catch (error) {
    runtime.error = error?.message || 'Unable to read system metrics.';
  } finally {
    runtime.loading = false;
    if (!options.silent) { _refreshWidget(widget.id, 'column'); _refreshWidget(widget.id, 'navpane'); }
  }
}

function _systemMonitorSparkline(history, getter, maximum = 100) {
  const values = history.slice(-30).map(getter).filter(Number.isFinite);
  const graph = document.createElement('div'); graph.className = 'system-monitor-sparkline';
  values.forEach(value => {
    const bar = document.createElement('span');
    bar.style.height = `${Math.max(3, Math.min(100, value / Math.max(1, maximum) * 100))}%`;
    graph.appendChild(bar);
  });
  return graph;
}

function _systemMonitorCard(label, value, detail = '', options = {}) {
  const card = document.createElement('div'); card.className = `system-monitor-card${options.warning ? ' is-warning' : ''}`;
  const heading = document.createElement('div'); heading.className = 'system-monitor-card-label'; heading.textContent = label;
  const main = document.createElement('div'); main.className = 'system-monitor-card-value'; main.textContent = value;
  card.append(heading, main);
  if (detail) { const meta = document.createElement('div'); meta.className = 'system-monitor-card-detail'; meta.textContent = detail; card.appendChild(meta); }
  if (options.graph) card.appendChild(options.graph);
  return card;
}

function _systemMonitorNetworkRate(history) {
  if (history.length < 2) return null;
  const previous = history[history.length - 2]; const current = history[history.length - 1];
  if (!previous?.network || !current?.network) return null;
  const seconds = Math.max(1, (Number(current.sampledAt) - Number(previous.sampledAt)) / 1000);
  return {
    received: Math.max(0, (current.network.receivedBytes - previous.network.receivedBytes) / seconds),
    sent: Math.max(0, (current.network.sentBytes - previous.network.sentBytes) / seconds)
  };
}

function _systemMonitorRender(widget, element, context) {
  const config = _systemMonitorConfig(widget);
  const runtime = _systemMonitorRuntime.get(widget.id) || { loading: false, latest: null, error: '' };
  _systemMonitorRuntime.set(widget.id, runtime);
  const history = _systemMonitorHistory(widget);
  if (!runtime.latest && history.length) runtime.latest = history[history.length - 1];
  element.className = `system-monitor-widget${context === 'navpane' ? ' is-compact' : ''}`;
  const rerender = () => { if (element.isConnected) { element.innerHTML = ''; _systemMonitorRender(widget, element, context); } };
  _setWidgetRefresher(widget.id, context, rerender);
  const header = document.createElement('div'); header.className = 'system-monitor-header';
  const status = document.createElement('span'); status.className = 'system-monitor-status'; status.textContent = runtime.latest?.sampledAt ? `Updated ${new Date(runtime.latest.sampledAt).toLocaleTimeString()}` : 'Awaiting sample';
  header.appendChild(status); element.appendChild(header);
  if (!_systemMonitorNativeAvailable()) {
    const unavailable = document.createElement('div'); unavailable.className = 'widget-empty-state is-error'; unavailable.textContent = 'System metrics require the Firefox extension and native host. Install or reconnect the host, then reload this widget.'; element.appendChild(unavailable); return;
  }
  if (runtime.error) { const error = document.createElement('div'); error.className = 'widget-error-state'; error.textContent = runtime.error; element.appendChild(error); }
  const sample = runtime.latest;
  if (!sample) { const loading = document.createElement('div'); loading.className = 'widget-empty-state'; loading.textContent = 'Reading aggregate system metrics…'; element.appendChild(loading); void _systemMonitorFetch(widget); return; }
  const grid = document.createElement('div'); grid.className = 'system-monitor-grid';
  if (config.metrics.includes('cpu') && sample.cpu) grid.appendChild(_systemMonitorCard('CPU', `${Number(sample.cpu.percent || 0).toFixed(0)}%`, `${sample.cpu.cores || 1} logical cores`, { warning: sample.cpu.percent >= config.cpuWarning, graph: _systemMonitorSparkline(history, item => Number(item.cpu?.percent)) }));
  if (config.metrics.includes('memory') && sample.memory) grid.appendChild(_systemMonitorCard('Memory', `${Number(sample.memory.percent || 0).toFixed(0)}%`, `${_systemMonitorFormatBytes(sample.memory.usedBytes)} of ${_systemMonitorFormatBytes(sample.memory.totalBytes)}`, { warning: sample.memory.percent >= config.memoryWarning, graph: _systemMonitorSparkline(history, item => Number(item.memory?.percent)) }));
  if (config.metrics.includes('disk')) (sample.disk || []).forEach(disk => grid.appendChild(_systemMonitorCard(`Disk ${disk.name}`, `${Number(disk.percent || 0).toFixed(0)}%`, `${_systemMonitorFormatBytes(disk.freeBytes)} free`, { warning: disk.percent >= config.diskWarning, graph: _systemMonitorSparkline(history, item => Number((item.disk || []).find(entry => entry.name === disk.name)?.percent)) })));
  if (config.metrics.includes('network')) {
    const rate = _systemMonitorNetworkRate(history);
    const network = sample.network;
    grid.appendChild(_systemMonitorCard('Network', rate ? `↓ ${_systemMonitorFormatBytes(rate.received)}/s` : (network ? `↓ ${_systemMonitorFormatBytes(network.receivedBytes)}` : 'Unavailable'), rate ? `↑ ${_systemMonitorFormatBytes(rate.sent)}/s` : (network ? `↑ ${_systemMonitorFormatBytes(network.sentBytes)} total` : 'This platform did not expose counters')));
  }
  if (config.metrics.includes('uptime') && sample.uptime) grid.appendChild(_systemMonitorCard('Uptime', _systemMonitorDuration(sample.uptime.seconds)));
  if (config.metrics.includes('battery')) grid.appendChild(_systemMonitorCard('Battery', sample.battery?.percent == null ? 'Unavailable' : `${sample.battery.percent}%`, sample.battery ? (sample.battery.charging ? 'Charging / AC connected' : 'On battery') : 'No battery reported'));
  if (config.metrics.includes('platform') && sample.platform) grid.appendChild(_systemMonitorCard('Platform', `${sample.platform.system} ${sample.platform.release}`, sample.platform.machine || ''));
  element.appendChild(grid);
  _setWidgetTimer(widget.id, context, () => _systemMonitorFetch(widget, { silent: false }), config.refreshSeconds * 1000);
}

function _systemMonitorRenderSettings(widget, container) {
  const config = _systemMonitorConfig(widget);
  container.innerHTML = `<div class="settings-section-label">Metric cards</div><div class="system-monitor-settings-metrics"></div>
    <div class="settings-row"><span>Refresh interval</span><select class="settings-select" data-cfg="refreshSeconds">${[5,15,30,60].map(value => `<option value="${value}" ${config.refreshSeconds === value ? 'selected' : ''}>${value} seconds</option>`).join('')}</select></div>
    <div class="settings-row"><span>CPU warning</span><input class="settings-text-input" type="number" min="1" max="100" data-cfg="cpuWarning" value="${config.cpuWarning}"/></div>
    <div class="settings-row"><span>Memory warning</span><input class="settings-text-input" type="number" min="1" max="100" data-cfg="memoryWarning" value="${config.memoryWarning}"/></div>
    <div class="settings-row"><span>Disk warning</span><input class="settings-text-input" type="number" min="1" max="100" data-cfg="diskWarning" value="${config.diskWarning}"/></div>
    <div class="settings-help">Only selected aggregate metrics are requested. History is bounded and remains in this browser; process names and file contents are never collected.</div>`;
  const labels = { cpu: 'CPU', memory: 'Memory', disk: 'Disks', network: 'Network totals', uptime: 'Uptime', battery: 'Battery', platform: 'Platform' };
  const target = container.querySelector('.system-monitor-settings-metrics');
  SYSTEM_MONITOR_METRICS.forEach(metric => {
    const label = document.createElement('label'); label.className = 'system-monitor-settings-toggle';
    const input = document.createElement('input'); input.type = 'checkbox'; input.checked = config.metrics.includes(metric);
    input.addEventListener('change', () => { config.metrics = input.checked ? [...new Set([...config.metrics, metric])] : config.metrics.filter(value => value !== metric); });
    label.append(input, document.createTextNode(labels[metric])); target.appendChild(label);
  });
}

WIDGET_REGISTRY['systemMonitor'] = {
  id: 'systemMonitor', name: 'System Monitor', category: 'Other', description: 'Aggregate CPU, memory, disk, network, uptime, battery, and platform metrics from the native host.',
  allowedIn: ['column', 'navpane'], liveSettingsPreview: false, reloadLabel: 'Refresh system metrics',
  defaultConfig: { metrics: ['cpu','memory','disk','network','uptime'], refreshSeconds: 15, cpuWarning: 85, memoryWarning: 85, diskWarning: 90 }, defaultData: {},
  settingsSchema: { type: 'object', properties: { metrics: { type: 'array' }, refreshSeconds: { type: 'number' }, cpuWarning: { type: 'number' }, memoryWarning: { type: 'number' }, diskWarning: { type: 'number' } }, additionalProperties: false },
  capabilities: { nativeHost: { optional: true }, timers: true, localCache: { quotaBytes: 512 * 1024 } }, responsive: { minWidth: 240, preferredWidth: 520, compactBelow: 320 },
  migrate(widget) { widget.config = { ...this.defaultConfig, ...(widget.config || {}) }; widget.data = {}; _systemMonitorConfig(widget); return widget; },
  reload(widget) { return _systemMonitorFetch(widget); }, onSettingsCommit(widget) { _systemMonitorRuntime.delete(widget.id); }, cleanup(widget) { _systemMonitorRuntime.delete(widget.id); },
  render(widget, element, context) { _systemMonitorRender(widget, element, context); }, renderSettings(widget, container) { _systemMonitorRenderSettings(widget, container); }
};
