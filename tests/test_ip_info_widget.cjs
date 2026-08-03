const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

function loadWidgets(fetchImpl = async () => { throw new Error('Unexpected fetch'); }) {
  const storage = new Map();
  const context = vm.createContext({
    console,
    URL,
    Date,
    Intl,
    AbortController,
    fetch: fetchImpl,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: key => storage.delete(key)
    },
    saveState: () => { throw new Error('IP information must not save shared Hub state'); },
    cloneData: value => JSON.parse(JSON.stringify(value))
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'source/widgets.js'), 'utf8'), context, { filename: 'source/widgets.js' });
  return { context, storage };
}

test('IP Info is a reloadable column widget with a conservative refresh interval', () => {
  const { context } = loadWidgets();
  const definition = vm.runInContext(`(() => {
    const def = WIDGET_REGISTRY.ipInfo;
    return { name: def.name, allowedIn: def.allowedIn, config: def.defaultConfig, hasReload: typeof def.reload === 'function' };
  })()`, context);
  assert.deepEqual(JSON.parse(JSON.stringify(definition)), {
    name: 'IP Info',
    allowedIn: ['column', 'navpane'],
    config: { refreshMinutes: 15, showCity: true, showProvider: true, showIpType: true, speedTest: true },
    hasReload: true
  });
});

test('IP payload normalization retains VPN-check details and derives flags safely', () => {
  const { context } = loadWidgets();
  context.payload = {
    ip: '8.8.8.8',
    success: true,
    type: 'IPv4',
    country: 'United States',
    country_code: 'US',
    city: 'Mountain View',
    region: 'California',
    flag: { emoji: '🇺🇸' },
    connection: { isp: 'Google LLC', asn: 15169 }
  };
  const normalized = vm.runInContext('_normalizeIpInfoPayload(payload)', context);
  assert.equal(normalized.ip, '8.8.8.8');
  assert.equal(normalized.country, 'United States');
  assert.equal(normalized.flag, '🇺🇸');
  assert.equal(normalized.isp, 'Google LLC');
  assert.equal(normalized.asn, 'AS15169');
  assert.equal(vm.runInContext("_ipInfoCountryFlag('GB')", context), '🇬🇧');
  assert.equal(vm.runInContext("_ipInfoCountryFlag('invalid')", context), '🌐');
});

test('IP lookup refreshes once per Hub session and caches results outside the database', async () => {
  const requests = [];
  const { context, storage } = loadWidgets(async (url, options) => {
    requests.push({ url: String(url), options });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ip: '203.0.113.7',
        success: true,
        type: 'IPv4',
        country: 'United Kingdom',
        country_code: 'GB',
        flag: { emoji: '🇬🇧' },
        connection: { isp: 'Example ISP', asn: 64500 }
      })
    };
  });
  context.widget = { id: 'ip-widget', config: { refreshMinutes: 15 } };
  assert.equal(vm.runInContext('_claimIpInfoSessionRefresh(_getIpInfoRuntime(widget.id))', context), true);
  assert.equal(vm.runInContext('_claimIpInfoSessionRefresh(_getIpInfoRuntime(widget.id))', context), false);
  await vm.runInContext('_ensureIpInfoData(widget, { force: true })', context);
  const cached = JSON.parse(storage.get('morpheus-webhub-ip-info:ip-widget'));
  assert.equal(cached.data.ip, '203.0.113.7');
  assert.equal(cached.data.countryCode, 'GB');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://ipwho.is/');
  assert.equal(requests[0].options.credentials, 'omit');
  assert.equal(requests[0].options.cache, 'no-store');
});

test('ipify preserves the public IP when geolocation is temporarily unavailable', async () => {
  const requests = [];
  const { context } = loadWidgets(async url => {
    requests.push(String(url));
    if (requests.length === 1) {
      return { ok: false, status: 503, json: async () => ({ message: 'Unavailable' }) };
    }
    return { ok: true, status: 200, json: async () => ({ ip: '2001:db8::7' }) };
  });
  const data = await vm.runInContext('_fetchIpInfoPayload()', context);
  assert.equal(data.ip, '2001:db8::7');
  assert.equal(data.type, 'IPv6');
  assert.equal(data.partial, true);
  assert.deepEqual(requests, ['https://ipwho.is/', 'https://api64.ipify.org?format=json']);
});

test('Cloudflare speed testing runs on IP changes and manual refresh but not unchanged interval checks', async () => {
  const speedTests = [];
  const speedConfigs = [];
  const { context, storage } = loadWidgets(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      ip: '203.0.113.22',
      success: true,
      type: 'IPv4',
      country: 'United Kingdom',
      country_code: 'GB'
    })
  }));
  context.CloudflareSpeedTest = class {
    constructor(config) {
      speedConfigs.push(config);
      speedTests.push(this);
    }
    play() {}
    pause() {}
  };
  context.widget = { id: 'ip-speed-widget', config: { refreshMinutes: 15, speedTest: true } };
  context.oldData = { ip: '198.51.100.8', type: 'IPv4', country: 'United Kingdom', countryCode: 'GB' };
  vm.runInContext('_writeIpInfoCache(widget.id, oldData)', context);

  await vm.runInContext('_ensureIpInfoData(widget, { force: true })', context);
  assert.equal(speedTests.length, 1, 'a detected public-IP change should start a speed test');
  assert.equal(speedConfigs[0].autoStart, false);
  assert.equal(speedConfigs[0].logAimApiUrl, null);
  assert.equal(speedConfigs[0].measurements.some(item => item.type === 'packetLoss'), false);
  const transferBytes = speedConfigs[0].measurements
    .filter(item => item.type === 'download' || item.type === 'upload')
    .reduce((total, item) => total + item.bytes * item.count, 0);
  assert.equal(transferBytes, 32e6);
  const firstSpeedRequest = vm.runInContext('_widgetFetches.get("ip-speed:ip-speed-widget")', context);
  speedTests[0].onFinish({
    getSummary: () => ({ download: 125e6, upload: 32e6, latency: 18.4, jitter: 2.1 })
  });
  await firstSpeedRequest;
  const speedCache = JSON.parse(storage.get('morpheus-webhub-ip-speed:ip-speed-widget'));
  assert.equal(speedCache.ip, '203.0.113.22');
  assert.equal(speedCache.downloadMbps, 125);
  assert.equal(speedCache.uploadMbps, 32);

  await vm.runInContext('_ensureIpInfoData(widget, { force: true })', context);
  assert.equal(speedTests.length, 1, 'an unchanged timed IP lookup must not rerun the speed test');

  await vm.runInContext('_ensureIpInfoData(widget, { force: true, runSpeed: true })', context);
  assert.equal(speedTests.length, 2, 'manual widget reload should rerun the speed test');
  const manualSpeedRequest = vm.runInContext('_widgetFetches.get("ip-speed:ip-speed-widget")', context);
  speedTests[1].onFinish({
    getSummary: () => ({ download: 130e6, upload: 35e6, latency: 17, jitter: 1.8 })
  });
  await manualSpeedRequest;
});

test('the pinned Cloudflare browser engine loads locally before widget code', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const engine = fs.readFileSync(path.join(root, 'vendor/cloudflare-speedtest/speedtest.js'), 'utf8');
  assert.ok(html.indexOf('vendor/cloudflare-speedtest/speedtest.js') < html.indexOf('source/widgets.js'));
  assert.match(engine, /globalThis\.CloudflareSpeedTest = SpeedTestEngine/);
  assert.doesNotMatch(engine, /^export\b/m);
  assert.equal(fs.existsSync(path.join(root, 'vendor/cloudflare-speedtest/LICENSE.txt')), true);
});

test('the Cloudflare engine resolves API URLs when a file Hub has a null origin', () => {
  const engine = fs.readFileSync(path.join(root, 'vendor/cloudflare-speedtest/speedtest.js'), 'utf8');
  const context = vm.createContext({
    URL,
    window: { location: { origin: 'null', href: 'file:///F:/Projects/Coding/Morpheus%20WebHub/index.html' } }
  });
  vm.runInContext(engine, context, { filename: 'vendor/cloudflare-speedtest/speedtest.js' });
  assert.equal(
    vm.runInContext("resolveSpeedTestUrl('https://speed.cloudflare.com/__down').href", context),
    'https://speed.cloudflare.com/__down'
  );
});

test('IP Info UI exposes flag, address, change state, privacy controls, and attribution', () => {
  const widgets = fs.readFileSync(path.join(root, 'source/widgets.js'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'source/styles.css'), 'utf8');
  const source = widgets.slice(widgets.indexOf("WIDGET_REGISTRY['ipInfo']"));
  assert.match(source, /widget-ip-info-flag/);
  assert.match(source, /widget-ip-info-address widget-interactive-surface/);
  assert.match(source, /addressType\.textContent = `\(\$\{data\.type\}\)`/);
  assert.match(source, /widget-ip-info-changed/);
  assert.match(source, /Check public IP and connection speed now/);
  assert.match(source, /Approximate city/);
  assert.match(source, /Network provider/);
  assert.match(source, /https:\/\/ipwhois\.io\//);
  assert.match(source, /Cloudflare connection speed test/);
  assert.match(source, /runSpeed: true/);
  assert.match(source, /widget-ip-info-speed-metrics/);
  assert.match(source, /widget-ip-info-footer-status/);
  assert.match(source, /IP \+ speed/);
  assert.doesNotMatch(source, /widget-ip-info-speed-meta/);
  assert.match(styles, /\.widget-ip-info-flag\s*\{[^}]*font-size:\s*2\.25rem/s);
  assert.match(styles, /\.widget-ip-info-address\s*\{[^}]*user-select:\s*text/s);
  assert.match(styles, /\.widget-ip-info-type\s*\{/);
  assert.match(styles, /\.widget-ip-info-speed-metrics\s*\{[^}]*grid-template-columns:\s*repeat\(3,/s);
  assert.match(styles, /\.widget-ip-info-footer\s*\{[^}]*white-space:\s*nowrap/s);
  const footerStyle = styles.match(/\.widget-ip-info-footer\s*\{([^}]*)\}/s)?.[1] || '';
  assert.doesNotMatch(footerStyle, /border-(?:top|block-start)\s*:/);
});
