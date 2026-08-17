// --- IP Info widget --------------------------------------------------------

const _ipInfoMemoryCache = new Map();
const _ipInfoSpeedMemoryCache = new Map();
const _ipInfoRuntime = new Map();

const IP_INFO_CACHE_PREFIX = 'morpheus-webhub-ip-info:';
const IP_INFO_SPEED_CACHE_PREFIX = 'morpheus-webhub-ip-speed:';
const IP_INFO_REQUEST_TIMEOUT_MS = 12000;
const IP_INFO_RETRY_MS = 5 * 60 * 1000;
const IP_INFO_SPEED_TIMEOUT_MS = 60 * 1000;
const IP_INFO_SPEED_MEASUREMENTS = [
  { type: 'latency', numPackets: 8 },
  { type: 'download', bytes: 1e6, count: 2, bypassMinDuration: true },
  { type: 'download', bytes: 5e6, count: 2, bypassMinDuration: true },
  { type: 'download', bytes: 1e7, count: 1, bypassMinDuration: true },
  { type: 'upload', bytes: 1e6, count: 2, bypassMinDuration: true },
  { type: 'upload', bytes: 4e6, count: 2, bypassMinDuration: true }
];

// ---- IP Info widget ----

function _normalizeIpInfoRefreshMinutes(value) {
  const parsed = Number.parseInt(value, 10);
  return [0, 5, 15, 30, 60, 180].includes(parsed) ? parsed : 15;
}

function _ipInfoCacheKey(widgetId) {
  return `${IP_INFO_CACHE_PREFIX}${widgetId}`;
}

function _readIpInfoCache(widgetId) {
  if (_ipInfoMemoryCache.has(widgetId)) return _ipInfoMemoryCache.get(widgetId);
  let cache = WidgetSDK.cache.get('ipInfo', widgetId, 'lookup')
    || WidgetSDK.cache.migrateLegacy('ipInfo', widgetId, 'lookup', _ipInfoCacheKey(widgetId));
  if (!cache || !cache.data || !Number.isFinite(Number(cache.fetchedAt))) cache = null;
  _ipInfoMemoryCache.set(widgetId, cache);
  return cache;
}

function _writeIpInfoCache(widgetId, data) {
  const cache = { fetchedAt: Date.now(), data };
  _ipInfoMemoryCache.set(widgetId, cache);
  try { WidgetSDK.cache.set('ipInfo', widgetId, 'lookup', cache); } catch {}
  return cache;
}

function _ipInfoSpeedCacheKey(widgetId) {
  return `${IP_INFO_SPEED_CACHE_PREFIX}${widgetId}`;
}

function _readIpInfoSpeedCache(widgetId) {
  if (_ipInfoSpeedMemoryCache.has(widgetId)) return _ipInfoSpeedMemoryCache.get(widgetId);
  let cache = WidgetSDK.cache.get('ipInfo', widgetId, 'speed')
    || WidgetSDK.cache.migrateLegacy('ipInfo', widgetId, 'speed', _ipInfoSpeedCacheKey(widgetId));
  if (
    !cache
    || !Number.isFinite(Number(cache.fetchedAt))
    || !String(cache.ip || '')
    || !Number.isFinite(Number(cache.downloadMbps))
    || !Number.isFinite(Number(cache.uploadMbps))
  ) cache = null;
  _ipInfoSpeedMemoryCache.set(widgetId, cache);
  return cache;
}

function _writeIpInfoSpeedCache(widgetId, result) {
  const cache = { fetchedAt: Date.now(), ...result };
  _ipInfoSpeedMemoryCache.set(widgetId, cache);
  try { WidgetSDK.cache.set('ipInfo', widgetId, 'speed', cache); } catch {}
  return cache;
}

function _getIpInfoRuntime(widgetId) {
  let runtime = _ipInfoRuntime.get(widgetId);
  if (!runtime) {
    runtime = {
      status: 'idle',
      error: '',
      nextRetryAt: 0,
      sessionRefreshClaimed: false,
      changed: false,
      speedStatus: 'idle',
      speedStage: '',
      speedError: '',
      speedOnNextLookup: false
    };
    _ipInfoRuntime.set(widgetId, runtime);
  }
  return runtime;
}

function _claimIpInfoSessionRefresh(runtime) {
  if (runtime.sessionRefreshClaimed) return false;
  runtime.sessionRefreshClaimed = true;
  return true;
}

function _isIpInfoCacheFresh(widget, cache) {
  if (!cache?.fetchedAt) return false;
  const minutes = _normalizeIpInfoRefreshMinutes(widget.config?.refreshMinutes);
  return minutes === 0 || Date.now() - Number(cache.fetchedAt) < minutes * 60 * 1000;
}

function _ipInfoCountryFlag(countryCode) {
  const code = String(countryCode || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return '🌐';
  return String.fromCodePoint(...[...code].map(letter => 127397 + letter.charCodeAt(0)));
}

async function _fetchIpInfoJson(url, widgetId = 'shared') {
  try {
    const response = await _fetchWithTimeout(url, {
      widgetType: 'ipInfo',
      widgetFetchKey: `ip-info:${widgetId}`,
      credentials: 'omit',
      redirect: 'follow',
      cache: 'no-store',
      headers: { Accept: 'application/json' }
    }, IP_INFO_REQUEST_TIMEOUT_MS);
    let payload = null;
    try { payload = await response.json(); } catch { payload = null; }
    if (!response.ok) throw new Error(payload?.message || `IP service returned ${response.status}`);
    if (!payload || typeof payload !== 'object') throw new Error('IP service returned an invalid response.');
    return payload;
  } catch (error) {
    if (['AbortError', 'TimeoutError'].includes(error?.name)) throw new Error('IP lookup timed out.');
    throw error;
  }
}

function _normalizeIpInfoPayload(payload, source = 'ipwho.is') {
  const ip = String(payload?.ip || '').trim();
  if (!ip || ip.length > 64 || !/^[0-9a-f:.]+$/i.test(ip)) throw new Error('IP service did not return a valid public address.');
  const countryCode = String(payload?.country_code || '').trim().toUpperCase();
  return {
    ip,
    type: String(payload?.type || (ip.includes(':') ? 'IPv6' : 'IPv4')),
    country: String(payload?.country || ''),
    countryCode,
    flag: String(payload?.flag?.emoji || _ipInfoCountryFlag(countryCode)),
    city: String(payload?.city || ''),
    region: String(payload?.region || ''),
    isp: String(payload?.connection?.isp || payload?.connection?.org || ''),
    asn: payload?.connection?.asn ? `AS${String(payload.connection.asn).replace(/^AS/i, '')}` : '',
    source,
    partial: source !== 'ipwho.is'
  };
}

async function _fetchIpInfoPayload(widgetId = 'shared') {
  try {
    const payload = await _fetchIpInfoJson('https://ipwho.is/', widgetId);
    if (payload.success === false) throw new Error(payload.message || 'IP geolocation lookup failed.');
    return _normalizeIpInfoPayload(payload, 'ipwho.is');
  } catch (primaryError) {
    try {
      const payload = await _fetchIpInfoJson('https://api64.ipify.org?format=json', widgetId);
      return _normalizeIpInfoPayload(payload, 'ipify');
    } catch {
      throw primaryError;
    }
  }
}

function _normalizeIpInfoSpeedResult(summary, ip) {
  const downloadMbps = Number(summary?.download) / 1e6;
  const uploadMbps = Number(summary?.upload) / 1e6;
  const latencyMs = Number(summary?.latency);
  const jitterMs = Number(summary?.jitter);
  if (!Number.isFinite(downloadMbps) || downloadMbps <= 0 || !Number.isFinite(uploadMbps) || uploadMbps <= 0) {
    throw new Error('Cloudflare did not return a complete speed measurement.');
  }
  return {
    ip: String(ip || ''),
    downloadMbps,
    uploadMbps,
    latencyMs: Number.isFinite(latencyMs) && latencyMs >= 0 ? latencyMs : null,
    jitterMs: Number.isFinite(jitterMs) && jitterMs >= 0 ? jitterMs : null
  };
}

function _refreshIpInfoSurfaces(widgetId) {
  _refreshWidget(widgetId, 'column');
  _refreshWidget(widgetId, 'navpane');
}

function _runIpInfoSpeedTest(widget, ip) {
  if (widget.config?.speedTest === false) return null;
  const runtime = _getIpInfoRuntime(widget.id);
  const fetchKey = `ip-speed:${widget.id}`;
  if (_widgetFetches.has(fetchKey)) return _widgetFetches.get(fetchKey);
  if (typeof CloudflareSpeedTest !== 'function') {
    runtime.speedStatus = 'error';
    runtime.speedError = 'The Cloudflare speed-test engine is unavailable.';
    _refreshIpInfoSurfaces(widget.id);
    return null;
  }

  runtime.speedStatus = 'loading';
  runtime.speedStage = 'Starting connection test…';
  runtime.speedError = '';
  _refreshIpInfoSurfaces(widget.id);

  const request = new Promise(resolve => {
    let test = null;
    let settled = false;
    let timeout = null;
    const settle = (result = null, error = '') => {
      if (settled) return;
      settled = true;
      timeout?.cancel?.();
      if (error) {
        try { test?.pause?.(); } catch {}
        runtime.speedStatus = 'error';
        runtime.speedStage = '';
        runtime.speedError = String(error || 'Unable to measure the connection speed.');
        resolve(null);
        return;
      }
      const cache = _writeIpInfoSpeedCache(widget.id, result);
      runtime.speedStatus = 'ready';
      runtime.speedStage = '';
      runtime.speedError = '';
      resolve(cache);
    };

    try {
      test = new CloudflareSpeedTest({
        autoStart: false,
        measurements: IP_INFO_SPEED_MEASUREMENTS,
        measureDownloadLoadedLatency: false,
        measureUploadLoadedLatency: false,
        logAimApiUrl: null,
        bandwidthFinishRequestDuration: 750
      });
      test.onResultsChange = ({ type } = {}) => {
        const stage = type === 'latency'
          ? 'Measuring latency…'
          : type === 'download'
            ? 'Measuring download speed…'
            : type === 'upload'
              ? 'Measuring upload speed…'
              : runtime.speedStage;
        if (stage !== runtime.speedStage) {
          runtime.speedStage = stage;
          _refreshIpInfoSurfaces(widget.id);
        }
      };
      test.onFinish = results => {
        try {
          settle(_normalizeIpInfoSpeedResult(results.getSummary(), ip));
        } catch (error) {
          settle(null, error?.message);
        }
      };
      test.onError = error => settle(null, error || 'Cloudflare speed test failed.');
      timeout = WidgetSDK.runtime.schedule(
        `${widget.id}:ip-speed-timeout`,
        () => settle(null, 'Cloudflare speed test timed out.'),
        IP_INFO_SPEED_TIMEOUT_MS,
        { runWhenHidden: true }
      );
      test.play();
    } catch (error) {
      settle(null, error?.message || 'Unable to start the Cloudflare speed test.');
    }
  }).finally(() => {
    _widgetFetches.delete(fetchKey);
    _refreshIpInfoSurfaces(widget.id);
  });
  _widgetFetches.set(fetchKey, request);
  return request;
}

function _ensureIpInfoData(widget, options = {}) {
  const force = options.force === true;
  const cache = _readIpInfoCache(widget.id);
  const runtime = _getIpInfoRuntime(widget.id);
  if (options.runSpeed === true) runtime.speedOnNextLookup = true;
  if (!force && _isIpInfoCacheFresh(widget, cache)) return null;
  if (!force && runtime.nextRetryAt > Date.now()) return null;
  const fetchKey = `ip-info:${widget.id}`;
  if (_widgetFetches.has(fetchKey)) return _widgetFetches.get(fetchKey);
  runtime.status = 'loading';
  runtime.error = '';
  const request = _fetchIpInfoPayload(widget.id)
    .then(data => {
      const ipChanged = !!cache?.data?.ip && cache.data.ip !== data.ip;
      runtime.changed = ipChanged;
      _writeIpInfoCache(widget.id, data);
      runtime.status = 'ready';
      runtime.error = '';
      runtime.nextRetryAt = 0;
      const shouldRunSpeed = runtime.speedOnNextLookup || ipChanged;
      runtime.speedOnNextLookup = false;
      if (shouldRunSpeed) _runIpInfoSpeedTest(widget, data.ip);
      return data;
    })
    .catch(error => {
      runtime.status = 'error';
      runtime.error = error?.message || 'Unable to check the public IP address.';
      runtime.nextRetryAt = Date.now() + IP_INFO_RETRY_MS;
      runtime.speedOnNextLookup = false;
      return null;
    })
    .finally(() => {
      _widgetFetches.delete(fetchKey);
      _refreshIpInfoSurfaces(widget.id);
    });
  _widgetFetches.set(fetchKey, request);
  return request;
}

function _ipInfoCheckedLabel(fetchedAt) {
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - Number(fetchedAt || 0)) / 60000));
  if (elapsedMinutes < 1) return 'Checked just now';
  if (elapsedMinutes === 1) return 'Checked 1 minute ago';
  if (elapsedMinutes < 60) return `Checked ${elapsedMinutes} minutes ago`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  return `Checked ${elapsedHours} hour${elapsedHours === 1 ? '' : 's'} ago`;
}

function _ipInfoCompactAge(fetchedAt) {
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - Number(fetchedAt || 0)) / 60000));
  if (elapsedMinutes < 1) return 'now';
  if (elapsedMinutes < 60) return `${elapsedMinutes}m`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h`;
  return `${Math.floor(elapsedHours / 24)}d`;
}

function _formatIpInfoSpeedMetric(value, unit) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '—';
  const digits = numeric >= 100 ? 0 : 1;
  return `${numeric.toFixed(digits)} ${unit}`;
}

WIDGET_REGISTRY['ipInfo'] = {
  name: 'IP Info',
  category: 'Weather & Network',
  description: 'Current public IP address and approximate country for checking VPN connections',
  allowedIn: ['column', 'navpane'],
  defaultConfig: {
    refreshMinutes: 15,
    showCity: true,
    showProvider: true,
    showIpType: true,
    speedTest: true
  },
  defaultData: {},
  reloadLabel: 'Check public IP and connection speed now',

  dispose(widget) {
    _ipInfoRuntime.delete(widget.id);
    _ipInfoMemoryCache.delete(widget.id);
    _ipInfoSpeedMemoryCache.delete(widget.id);
    WidgetSDK.cache.remove('ipInfo', widget.id, 'lookup', { legacyKeys: [_ipInfoCacheKey(widget.id)] });
    WidgetSDK.cache.remove('ipInfo', widget.id, 'speed', { legacyKeys: [_ipInfoSpeedCacheKey(widget.id)] });
  },

  reload(widget) {
    return _ensureIpInfoData(widget, { force: true, runSpeed: true });
  },

  render(widget, el, context) {
    const runtime = _getIpInfoRuntime(widget.id);
    let cache = _readIpInfoCache(widget.id);

    _setWidgetRefresher(widget.id, context, () => {
      if (!el.isConnected) {
        _widgetRefreshers.delete(`${widget.id}:${context}`);
        return;
      }
      el.innerHTML = '';
      WIDGET_REGISTRY.ipInfo.render(widget, el, context);
    });

    el.className = 'widget-ip-info';
    if (widget.title) {
      const heading = document.createElement('div');
      heading.className = 'widget-ip-info-heading';
      heading.textContent = widget.title;
      el.appendChild(heading);
    }

    if (_claimIpInfoSessionRefresh(runtime)) {
      _ensureIpInfoData(widget, { force: true, runSpeed: true });
    } else if (!_isIpInfoCacheFresh(widget, cache)) {
      _ensureIpInfoData(widget);
    }
    _setWidgetTimer(widget.id, context, () => {
      if (!_isIpInfoCacheFresh(widget, _readIpInfoCache(widget.id))) _ensureIpInfoData(widget);
    }, 60 * 1000);
    cache = _readIpInfoCache(widget.id);

    if (!cache?.data) {
      const placeholder = document.createElement('div');
      placeholder.className = `widget-ip-info-placeholder${runtime.status === 'error' ? ' is-error' : ''}`;
      placeholder.textContent = runtime.status === 'error' ? runtime.error : 'Checking your public IP address…';
      el.appendChild(placeholder);
      return;
    }

    const data = cache.data;
    const main = document.createElement('div');
    main.className = 'widget-ip-info-main';
    const flag = document.createElement('span');
    flag.className = 'widget-ip-info-flag';
    flag.textContent = data.flag || _ipInfoCountryFlag(data.countryCode);
    flag.setAttribute('aria-label', data.country ? `${data.country} flag` : 'Country unavailable');
    const identity = document.createElement('div');
    identity.className = 'widget-ip-info-identity';
    const country = document.createElement('div');
    country.className = 'widget-ip-info-country';
    country.textContent = data.country || 'Country unavailable';
    if (runtime.changed) {
      const changed = document.createElement('span');
      changed.className = 'widget-ip-info-changed';
      changed.textContent = 'IP changed';
      country.appendChild(changed);
    }
    const address = document.createElement('div');
    address.className = 'widget-ip-info-address widget-interactive-surface';
    const addressValue = document.createElement('span');
    addressValue.textContent = data.ip;
    address.appendChild(addressValue);
    if (widget.config?.showIpType !== false && data.type) {
      const addressType = document.createElement('span');
      addressType.className = 'widget-ip-info-type';
      addressType.textContent = `(${data.type})`;
      address.appendChild(addressType);
    }
    address.title = 'Current public IP address';
    identity.append(country, address);
    main.append(flag, identity);
    el.appendChild(main);

    const details = [];
    if (widget.config?.showCity !== false) {
      const location = [data.city, data.region].filter(Boolean).join(', ');
      if (location) details.push(location);
    }
    if (details.length) {
      const locationLine = document.createElement('div');
      locationLine.className = 'widget-ip-info-details';
      locationLine.textContent = details.join(' · ');
      el.appendChild(locationLine);
    }
    if (widget.config?.showProvider !== false && (data.isp || data.asn)) {
      const provider = document.createElement('div');
      provider.className = 'widget-ip-info-provider';
      provider.textContent = [data.isp, data.asn].filter(Boolean).join(' · ');
      el.appendChild(provider);
    }
    if (data.partial) {
      const partial = document.createElement('div');
      partial.className = 'widget-ip-info-status is-warning';
      partial.textContent = 'Country lookup unavailable; showing the public IP only.';
      el.appendChild(partial);
    } else if (runtime.status === 'loading') {
      const loading = document.createElement('div');
      loading.className = 'widget-ip-info-status';
      loading.textContent = 'Checking for an IP change…';
      el.appendChild(loading);
    } else if (runtime.status === 'error') {
      const error = document.createElement('div');
      error.className = 'widget-ip-info-status is-error';
      error.textContent = `Showing the last result. ${runtime.error}`;
      el.appendChild(error);
    }

    const speedCache = _readIpInfoSpeedCache(widget.id);
    const currentSpeed = speedCache?.ip === data.ip ? speedCache : null;
    if (widget.config?.speedTest !== false) {
      const speed = document.createElement('div');
      speed.className = 'widget-ip-info-speed';
      speed.setAttribute('aria-live', 'polite');

      if (runtime.speedStatus === 'loading') {
        const progress = document.createElement('div');
        progress.className = 'widget-ip-info-speed-status';
        progress.textContent = runtime.speedStage || 'Testing connection speed…';
        speed.appendChild(progress);
      } else if (currentSpeed) {
        const metrics = document.createElement('div');
        metrics.className = 'widget-ip-info-speed-metrics';
        const values = [
          ['Download', _formatIpInfoSpeedMetric(currentSpeed.downloadMbps, 'Mbps')],
          ['Upload', _formatIpInfoSpeedMetric(currentSpeed.uploadMbps, 'Mbps')],
          ['Ping', _formatIpInfoSpeedMetric(currentSpeed.latencyMs, 'ms')]
        ];
        values.forEach(([label, value]) => {
          const metric = document.createElement('div');
          metric.className = 'widget-ip-info-speed-metric';
          const metricLabel = document.createElement('span');
          metricLabel.textContent = label;
          const metricValue = document.createElement('strong');
          metricValue.textContent = value;
          metric.append(metricLabel, metricValue);
          metrics.appendChild(metric);
        });
        speed.appendChild(metrics);
      } else {
        const pending = document.createElement('div');
        pending.className = `widget-ip-info-speed-status${runtime.speedStatus === 'error' ? ' is-error' : ''}`;
        pending.textContent = runtime.speedStatus === 'error'
          ? runtime.speedError
          : 'Connection speed will be measured with the next IP check.';
        speed.appendChild(pending);
      }
      el.appendChild(speed);
    }

    const footer = document.createElement('div');
    footer.className = 'widget-ip-info-footer';
    const status = document.createElement('span');
    status.className = 'widget-ip-info-footer-status';
    const sameCheck = currentSpeed && Math.abs(Number(cache.fetchedAt) - Number(currentSpeed.fetchedAt)) < 60 * 1000;
    status.textContent = sameCheck
      ? `IP + speed ${_ipInfoCompactAge(Math.max(cache.fetchedAt, currentSpeed.fetchedAt))}`
      : `IP ${_ipInfoCompactAge(cache.fetchedAt)}${currentSpeed ? ` · Speed ${_ipInfoCompactAge(currentSpeed.fetchedAt)}` : ''}`;
    if (currentSpeed && Number.isFinite(Number(currentSpeed.jitterMs))) {
      status.textContent += ` · Jitter ${_formatIpInfoSpeedMetric(currentSpeed.jitterMs, 'ms')}`;
    }
    status.title = `${_ipInfoCheckedLabel(cache.fetchedAt)}${currentSpeed ? ` · Speed tested ${_ipInfoCompactAge(currentSpeed.fetchedAt)}` : ''}`;
    const sources = document.createElement('span');
    sources.className = 'widget-ip-info-footer-sources widget-interactive-surface';
    const source = document.createElement('a');
    source.href = data.source === 'ipify' ? 'https://www.ipify.org/' : 'https://ipwhois.io/';
    source.target = '_blank';
    source.rel = 'noreferrer noopener';
    source.textContent = data.source === 'ipify' ? 'ipify' : 'ipwho.is';
    source.addEventListener('mousedown', event => event.stopPropagation());
    sources.appendChild(source);
    if (widget.config?.speedTest !== false) {
      const separator = document.createElement('span');
      separator.textContent = '·';
      const cloudflare = document.createElement('a');
      cloudflare.href = 'https://speed.cloudflare.com/';
      cloudflare.target = '_blank';
      cloudflare.rel = 'noreferrer noopener';
      cloudflare.textContent = 'CF';
      cloudflare.title = 'Cloudflare Speed Test';
      cloudflare.addEventListener('mousedown', event => event.stopPropagation());
      sources.append(separator, cloudflare);
    }
    footer.append(status, sources);
    el.appendChild(footer);
  },

  renderSettings(widget, container) {
    const c = widget.config || {};
    container.innerHTML = `
      <div class="settings-row">
        <span>Automatic refresh</span>
        <select class="settings-select" data-cfg="refreshMinutes">
          ${[[5, 'Every 5 minutes'], [15, 'Every 15 minutes'], [30, 'Every 30 minutes'], [60, 'Hourly'], [180, 'Every 3 hours'], [0, 'Manual only']].map(([minutes, label]) => `<option value="${minutes}" ${_normalizeIpInfoRefreshMinutes(c.refreshMinutes) === minutes ? 'selected' : ''}>${label}</option>`).join('')}
        </select>
      </div>
      <div class="settings-row"><span>Approximate city</span><label class="settings-toggle"><input type="checkbox" data-cfg="showCity" ${c.showCity !== false ? 'checked' : ''}/><span class="toggle-track"></span></label></div>
      <div class="settings-row"><span>Network provider</span><label class="settings-toggle"><input type="checkbox" data-cfg="showProvider" ${c.showProvider !== false ? 'checked' : ''}/><span class="toggle-track"></span></label></div>
      <div class="settings-row"><span>IPv4 / IPv6 type</span><label class="settings-toggle"><input type="checkbox" data-cfg="showIpType" ${c.showIpType !== false ? 'checked' : ''}/><span class="toggle-track"></span></label></div>
      <div class="settings-row"><span>Cloudflare connection speed test</span><label class="settings-toggle"><input type="checkbox" data-cfg="speedTest" ${c.speedTest !== false ? 'checked' : ''}/><span class="toggle-track"></span></label></div>
      <div class="settings-help">The widget checks the browser's public exit address on Hub load and at the selected interval. IP geolocation is approximate. Data is requested from ipwho.is and cached only in this browser.</div>
      <div class="settings-help">The bounded Cloudflare test runs on Hub load, after a detected IP change, or when this widget is manually reloaded—not on the IP refresh interval when the address is unchanged. Each run transfers up to about 32 MB. Completed results stay in this browser and Cloudflare result reporting is disabled.</div>`;
  }
};
