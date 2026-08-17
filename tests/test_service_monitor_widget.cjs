const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'source', 'service-monitor-widget.js'), 'utf8');

function context() {
  const cache = new Map();
  const sandbox = vm.createContext({
    WIDGET_REGISTRY: {}, URL, console, performance, navigator: { onLine: true },
    WidgetSDK: { cache: {
      get(type, id, key) { return cache.get(`${type}:${id}:${key}`) || null; },
      set(type, id, key, value) { cache.set(`${type}:${id}:${key}`, structuredClone(value)); }
    } },
    structuredClone, document: {}, Notification: undefined
  });
  vm.runInContext(source, sandbox);
  return sandbox;
}

test('service monitor normalizes safe HTTPS endpoint configuration', () => {
  const sandbox = context();
  const result = vm.runInContext(`(() => {
    const widget = { config: { endpoints: [
      { id: 'a', name: 'API', url: 'https://example.test/health', expectedStatus: 204, intervalMinutes: 15, timeoutSeconds: 20 },
      { id: 'a', name: '', url: 'http://insecure.test', intervalMinutes: 2, timeoutSeconds: 100 }
    ] } };
    return _serviceMonitorEndpoints(widget);
  })()`, sandbox);
  assert.equal(result[0].url, 'https://example.test/health');
  assert.equal(result[0].expectedStatus, 204);
  assert.equal(result[1].url, '');
  assert.equal(result[1].intervalMinutes, 5);
  assert.equal(result[1].timeoutSeconds, 30);
  assert.notEqual(result[0].id, result[1].id);
});

test('service monitor resolves dotted JSON assertions without executing paths', () => {
  const sandbox = context();
  assert.equal(vm.runInContext(`_serviceMonitorJsonValue({ status: { value: 'ready' } }, 'status.value')`, sandbox), 'ready');
  assert.equal(vm.runInContext(`_serviceMonitorJsonValue({ status: {} }, 'status.missing')`, sandbox), undefined);
});

test('service monitor keeps samples behind the SDK cache boundary', () => {
  assert.doesNotMatch(source, /\blocalStorage\b|\bfetch\s*\(/);
  assert.match(source, /WidgetSDK\.cache\.set\('serviceMonitor'/);
  assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext(`WIDGET_REGISTRY.serviceMonitor.defaultData`, context()))), {});
});
