const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'source', 'system-monitor-widget.js'), 'utf8');

function context() {
  const sandbox = vm.createContext({
    WIDGET_REGISTRY: {}, console, WidgetSDK: { cache: { get: () => null, set() {} }, nativeHost: { supports: () => false } }, document: {}
  });
  vm.runInContext(source, sandbox);
  return sandbox;
}

test('system monitor clamps intervals, thresholds, and metric names', () => {
  const sandbox = context();
  const result = vm.runInContext(`(() => { const widget = { config: { metrics: ['cpu','processes','cpu'], refreshSeconds: 1, cpuWarning: 200, diskWarning: -1 } }; _systemMonitorConfig(widget); return widget.config; })()`, sandbox);
  assert.deepEqual([...result.metrics], ['cpu']);
  assert.equal(result.refreshSeconds, 15);
  assert.equal(result.cpuWarning, 100);
  assert.equal(result.diskWarning, 1);
});

test('system monitor formats bounded values and stores no process-level data', () => {
  const sandbox = context();
  assert.equal(vm.runInContext(`_systemMonitorFormatBytes(1073741824)`, sandbox), '1.0 GiB');
  assert.equal(vm.runInContext(`_systemMonitorDuration(90061)`, sandbox), '1d 1h 1m');
  assert.doesNotMatch(source, /process(?:Name|List|es)|\blocalStorage\b|\bfetch\s*\(/i);
  assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext(`WIDGET_REGISTRY.systemMonitor.defaultData`, sandbox))), {});
});
