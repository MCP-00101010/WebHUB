// Widget and Integration SDK. Loaded after the legacy built-in catalogue so it
// can normalize those descriptors without changing their classic-script order.

const WIDGET_SDK_VERSION = 1;
const WIDGET_LOCAL_OPT_IN_KEY = 'morpheus-widget-sdk-local-opt-in';
const WIDGET_SDK_CACHE_PREFIX = 'morpheus-widget-sdk-cache:v1:';
const WIDGET_SDK_DEFAULT_CACHE_QUOTA = 256 * 1024;
const WIDGET_SDK_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const WIDGET_SDK_MAX_CONCURRENT_REQUESTS = 6;
const WIDGET_SDK_CAPABILITIES = Object.freeze([
  'network', 'extensionRelay', 'nativeHost', 'secureCredentials',
  'filesystemPaths', 'geolocation', 'notifications', 'timers', 'localCache'
]);

const WIDGET_BUILTIN_MANIFEST = Object.freeze({
  clock: { capabilities: { timers: true }, responsive: { minWidth: 160, preferredWidth: 260, compactBelow: 210 } },
  countdown: { capabilities: { timers: true }, responsive: { minWidth: 160, preferredWidth: 260, compactBelow: 210 } },
  notes: { capabilities: {}, responsive: { minWidth: 180, preferredWidth: 320 } },
  todo: { capabilities: {}, responsive: { minWidth: 200, preferredWidth: 340 } },
  image: {
    capabilities: { network: { domains: ['user-configured'] }, nativeHost: { optional: true }, filesystemPaths: { optional: true } },
    responsive: { minWidth: 180, preferredWidth: 360, aspectRatio: 'auto' }
  },
  nasaApod: {
    capabilities: { network: { domains: ['api.nasa.gov'] }, secureCredentials: { optional: true }, localCache: { quotaBytes: 512 * 1024 } },
    responsive: { minWidth: 240, preferredWidth: 420 }
  },
  weather: {
    capabilities: { network: { domains: ['api.open-meteo.com', 'geocoding-api.open-meteo.com'] }, timers: true, localCache: { quotaBytes: 256 * 1024 } },
    responsive: { minWidth: 260, preferredWidth: 460, compactBelow: 340 }
  },
  weatherMap: {
    capabilities: { network: { domains: ['api.open-meteo.com', 'geocoding-api.open-meteo.com', 'tiles.openfreemap.org'] }, timers: true, localCache: { quotaBytes: 512 * 1024 } },
    responsive: { minWidth: 300, preferredWidth: 620, preferredHeight: 420 }
  },
  issTracker: {
    capabilities: { network: { domains: ['api.wheretheiss.at', 'celestrak.org', 'tiles.openfreemap.org'] }, timers: true, localCache: { quotaBytes: 256 * 1024 } },
    responsive: { minWidth: 300, preferredWidth: 620, preferredHeight: 440 }
  },
  astronomy: {
    capabilities: { network: { domains: ['geocoding-api.open-meteo.com'], optional: true }, localCache: { quotaBytes: 128 * 1024 } },
    responsive: { minWidth: 280, preferredWidth: 520 }
  },
  rssReader: {
    capabilities: { network: { domains: ['user-configured'] }, extensionRelay: { optional: true }, localCache: { quotaBytes: 1024 * 1024 }, timers: true },
    responsive: { minWidth: 280, preferredWidth: 620 }
  },
  ipInfo: {
    capabilities: { network: { domains: ['ipwho.is', 'api64.ipify.org', 'speed.cloudflare.com'] }, timers: true, localCache: { quotaBytes: 128 * 1024 } },
    responsive: { minWidth: 180, preferredWidth: 340, compactBelow: 240 }
  },
  protonCalendar: {
    capabilities: {
      network: { domains: ['user-configured', 'www.gov.uk', 'll.thespacedevs.com', 'api.football-data.org', 'tournaments.darts.web.gc.pdcservices.co.uk', 'www.thesportsdb.com'] },
      extensionRelay: { optional: true }, secureCredentials: { optional: true }, timers: true, localCache: { quotaBytes: 512 * 1024 }
    },
    responsive: { minWidth: 300, preferredWidth: 680 }
  },
  calculatorConverter: {
    capabilities: { localCache: { quotaBytes: 128 * 1024 } },
    responsive: { minWidth: 180, preferredWidth: 420, compactBelow: 260 }
  },
  focusSession: {
    capabilities: { timers: true, localCache: { quotaBytes: 128 * 1024 }, notifications: { optional: true } },
    responsive: { minWidth: 180, preferredWidth: 360, compactBelow: 250 }
  },
  savedSessions: {
    capabilities: { extensionRelay: { optional: true } },
    responsive: { minWidth: 200, preferredWidth: 460, compactBelow: 300 }
  },
  serviceMonitor: {
    capabilities: {
      network: { domains: ['user-configured'] }, extensionRelay: { optional: true },
      timers: true, localCache: { quotaBytes: 512 * 1024 }, notifications: { optional: true }
    },
    responsive: { minWidth: 240, preferredWidth: 520, compactBelow: 320 }
  },
  systemMonitor: {
    capabilities: { nativeHost: { optional: true }, timers: true, localCache: { quotaBytes: 512 * 1024 } },
    responsive: { minWidth: 240, preferredWidth: 520, compactBelow: 320 }
  },
  gitWorkspace: {
    capabilities: { nativeHost: { optional: true }, filesystemPaths: { optional: true }, timers: true, localCache: { quotaBytes: 256 * 1024 } },
    responsive: { minWidth: 260, preferredWidth: 560, compactBelow: 340 }
  },
  mediaWatchlist: {
    capabilities: { network: { domains: ['api.themoviedb.org', 'fandom.com'], optional: true }, secureCredentials: { optional: true }, timers: true, localCache: { quotaBytes: 1024 * 1024 }, notifications: { optional: true } },
    responsive: { minWidth: 260, preferredWidth: 600, compactBelow: 360 }
  },
  recentFiles: {
    capabilities: { nativeHost: { optional: true }, filesystemPaths: { optional: true }, timers: true, localCache: { quotaBytes: 512 * 1024 } },
    responsive: { minWidth: 240, preferredWidth: 560, compactBelow: 340 }
  },
  universalSearch: {
    capabilities: { localCache: { quotaBytes: 128 * 1024 } },
    responsive: { minWidth: 240, preferredWidth: 600, compactBelow: 340 }
  }
});

const _widgetSdkDescriptors = new Map();
const _widgetSdkSchedules = new Map();
const _widgetSdkFrames = new Map();
const _widgetSdkNetworkState = new Map();
const _widgetSdkNetworkQueue = [];
let _widgetSdkActiveRequests = 0;

function _widgetSdkClone(value) {
  if (value === undefined) return undefined;
  if (typeof structuredClone === 'function') {
    try { return structuredClone(value); } catch {}
  }
  return JSON.parse(JSON.stringify(value));
}

function _widgetSdkSettingsSchema(defaultConfig) {
  const properties = {};
  Object.entries(defaultConfig || {}).forEach(([key, value]) => {
    const type = Array.isArray(value) ? 'array' : value === null ? 'any' : typeof value;
    properties[key] = { type };
  });
  return { type: 'object', properties, additionalProperties: true };
}

function _widgetSdkCapabilityAvailable(name) {
  if (name === 'network') return typeof fetch === 'function';
  if (name === 'extensionRelay') return typeof bridge !== 'undefined' && bridge?.isAvailable?.() === true;
  if (name === 'nativeHost') return typeof bridge !== 'undefined' && bridge?.nativeIsAvailable?.() === true;
  if (name === 'secureCredentials') return typeof bridge !== 'undefined' && typeof bridge?.secretGet === 'function';
  if (name === 'filesystemPaths') return typeof bridge !== 'undefined' && typeof bridge?.openFilePicker === 'function';
  if (name === 'geolocation') return typeof navigator !== 'undefined' && !!navigator.geolocation;
  if (name === 'notifications') return typeof Notification !== 'undefined';
  if (name === 'timers') return typeof setTimeout === 'function';
  if (name === 'localCache') return typeof localStorage !== 'undefined';
  return false;
}

function validateWidgetDescriptor(descriptor, options = {}) {
  const errors = [];
  const warnings = [];
  const strict = options.strict !== false;
  if (!descriptor || typeof descriptor !== 'object') return { valid: false, errors: ['Descriptor must be an object.'], warnings };
  if (!/^[a-z][a-zA-Z0-9-]{1,63}$/.test(String(descriptor.id || ''))) errors.push('id must be 2-64 URL-safe characters and start with a lowercase letter.');
  ['name', 'category', 'description'].forEach(key => {
    if (!String(descriptor[key] || '').trim()) errors.push(`${key} is required.`);
  });
  if (!Array.isArray(descriptor.allowedIn) || !descriptor.allowedIn.length) errors.push('allowedIn must contain at least one location.');
  else if (descriptor.allowedIn.some(location => !['column', 'navpane'].includes(location))) errors.push('allowedIn contains an unsupported location.');
  if (!descriptor.defaultConfig || typeof descriptor.defaultConfig !== 'object' || Array.isArray(descriptor.defaultConfig)) errors.push('defaultConfig must be an object.');
  if (!descriptor.defaultData || typeof descriptor.defaultData !== 'object' || Array.isArray(descriptor.defaultData)) errors.push('defaultData must be an object.');
  if (!descriptor.settingsSchema || descriptor.settingsSchema.type !== 'object') errors.push('settingsSchema must describe an object.');
  if (typeof descriptor.render !== 'function') errors.push('render must be a function.');
  if (descriptor.reload !== undefined && typeof descriptor.reload !== 'function') errors.push('reload must be a function when supplied.');
  if (descriptor.cleanup !== undefined && typeof descriptor.cleanup !== 'function') errors.push('cleanup must be a function when supplied.');
  if (descriptor.migrate !== undefined && typeof descriptor.migrate !== 'function') errors.push('migrate must be a function when supplied.');
  if (!descriptor.responsive || typeof descriptor.responsive !== 'object') errors.push('responsive size hints are required.');
  const capabilities = descriptor.capabilities || {};
  Object.keys(capabilities).forEach(name => {
    if (!WIDGET_SDK_CAPABILITIES.includes(name)) errors.push(`Unknown capability: ${name}.`);
  });
  if (strict && descriptor.source !== 'builtin' && descriptor.trusted === true) errors.push('Only built-in descriptors may declare themselves trusted.');
  if (!descriptor.renderSettings) warnings.push('No custom settings renderer supplied; only the title can be edited.');
  return { valid: errors.length === 0, errors, warnings };
}

function _widgetSdkNormalizeDescriptor(id, descriptor, options = {}) {
  const manifest = WIDGET_BUILTIN_MANIFEST[id] || {};
  const source = options.source || descriptor.source || 'local';
  return {
    ...descriptor,
    id,
    sdkVersion: WIDGET_SDK_VERSION,
    source,
    trusted: source === 'builtin',
    defaultConfig: _widgetSdkClone(descriptor.defaultConfig || {}),
    defaultData: _widgetSdkClone(descriptor.defaultData || {}),
    settingsSchema: descriptor.settingsSchema || _widgetSdkSettingsSchema(descriptor.defaultConfig),
    capabilities: descriptor.capabilities || manifest.capabilities || {},
    responsive: descriptor.responsive || manifest.responsive || { minWidth: 180, preferredWidth: 360 },
    cleanup: descriptor.cleanup || descriptor.dispose || (() => {}),
    migrate: descriptor.migrate || (state => state)
  };
}

function widgetLocalPackagesEnabled() {
  try { return localStorage.getItem(WIDGET_LOCAL_OPT_IN_KEY) === 'true'; } catch { return false; }
}

function setWidgetLocalPackagesEnabled(enabled) {
  try { localStorage.setItem(WIDGET_LOCAL_OPT_IN_KEY, enabled === true ? 'true' : 'false'); } catch {}
  return widgetLocalPackagesEnabled();
}

function registerWidget(descriptor, options = {}) {
  const id = String(descriptor?.id || options.id || '');
  const normalized = _widgetSdkNormalizeDescriptor(id, descriptor || {}, options);
  const validation = validateWidgetDescriptor(normalized);
  if (!validation.valid) throw new Error(`Invalid widget descriptor ${id || '(missing id)'}: ${validation.errors.join(' ')}`);
  if (normalized.source !== 'builtin' && !widgetLocalPackagesEnabled()) {
    throw new Error('Local widget packages are disabled. Enable them explicitly before registration.');
  }
  if (_widgetSdkDescriptors.has(id) && options.replace !== true && WIDGET_REGISTRY[id] !== descriptor) {
    throw new Error(`Widget ${id} is already registered.`);
  }
  WIDGET_REGISTRY[id] = normalized;
  _widgetSdkDescriptors.set(id, normalized);
  return normalized;
}

function _widgetSdkAdoptBuiltins() {
  Object.entries(WIDGET_REGISTRY).forEach(([id, descriptor]) => {
    if (_widgetSdkDescriptors.get(id) === descriptor) return;
    const normalized = _widgetSdkNormalizeDescriptor(id, descriptor, { source: 'builtin' });
    const validation = validateWidgetDescriptor(normalized);
    if (!validation.valid) {
      console.warn(`Skipping invalid built-in widget ${id}`, validation.errors);
      return;
    }
    WIDGET_REGISTRY[id] = normalized;
    _widgetSdkDescriptors.set(id, normalized);
  });
  return _widgetSdkDescriptors.size;
}

function _widgetSdkMissingCapabilities(descriptor) {
  return Object.entries(descriptor?.capabilities || {})
    .filter(([name, requirement]) => requirement !== false && requirement?.optional !== true && !_widgetSdkCapabilityAvailable(name))
    .map(([name]) => name);
}

function _widgetSdkRenderError(element, descriptor, message, kind = 'error') {
  if (!element) return;
  element.innerHTML = '';
  element.className = `widget-sdk-state is-${kind}`;
  const title = document.createElement('div');
  title.className = 'widget-sdk-state-title';
  title.textContent = descriptor?.name || 'Widget unavailable';
  const detail = document.createElement('div');
  detail.className = 'widget-sdk-state-detail';
  detail.textContent = message;
  element.append(title, detail);
}

function _widgetSdkRender(descriptor, widget, element, context) {
  const missing = _widgetSdkMissingCapabilities(descriptor);
  if (missing.length) {
    _widgetSdkRenderError(element, descriptor, `Unavailable capabilities: ${missing.join(', ')}.`, 'unavailable');
    return false;
  }
  try {
    descriptor.render(widget, element, context);
    return true;
  } catch (error) {
    console.warn(`Failed to render ${descriptor.name}`, error);
    _widgetSdkRenderError(element, descriptor, error?.message || 'The widget could not be rendered.');
    return false;
  }
}

function _widgetSdkReload(descriptor, widget) {
  if (typeof descriptor?.reload !== 'function') return Promise.resolve();
  return Promise.resolve().then(() => descriptor.reload(widget));
}

function _widgetSdkSchedule(key, task, intervalMs, options = {}) {
  _widgetSdkCancelSchedule(key);
  const record = {
    key, task, intervalMs: Math.max(250, Number(intervalMs) || 1000), timer: null,
    cancelled: false, failures: 0, runWhenHidden: options.runWhenHidden === true,
    maxBackoffMs: Math.max(Number(options.maxBackoffMs) || 5 * 60 * 1000, Number(intervalMs) || 1000)
  };
  const queue = delay => {
    if (record.cancelled) return;
    record.timer = setTimeout(run, Math.max(0, delay));
  };
  const run = async () => {
    if (record.cancelled) return;
    if (!record.runWhenHidden && typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      queue(Math.min(record.intervalMs, 30000));
      return;
    }
    try {
      await record.task();
      record.failures = 0;
    } catch (error) {
      record.failures += 1;
      console.warn(`Widget schedule ${key} failed`, error);
    }
    const delay = record.failures
      ? Math.min(record.maxBackoffMs, record.intervalMs * (2 ** Math.min(record.failures, 6)))
      : record.intervalMs;
    queue(delay);
  };
  record.cancel = () => {
    record.cancelled = true;
    if (record.timer) clearTimeout(record.timer);
    if (_widgetSdkSchedules.get(key) === record) _widgetSdkSchedules.delete(key);
  };
  _widgetSdkSchedules.set(key, record);
  queue(record.intervalMs);
  return record;
}

function _widgetSdkCancelSchedule(key) {
  _widgetSdkSchedules.get(key)?.cancel?.();
}

function _widgetSdkRequestFrame(key, callback) {
  _widgetSdkCancelFrame(key);
  const request = typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame
    : next => setTimeout(() => next(Date.now()), 16);
  const cancel = typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : clearTimeout;
  const record = { key, handle: null, cancelled: false };
  record.cancel = () => {
    record.cancelled = true;
    if (record.handle != null) cancel(record.handle);
    if (_widgetSdkFrames.get(key) === record) _widgetSdkFrames.delete(key);
  };
  record.handle = request(timestamp => {
    if (record.cancelled) return;
    if (_widgetSdkFrames.get(key) === record) _widgetSdkFrames.delete(key);
    callback(timestamp);
  });
  _widgetSdkFrames.set(key, record);
  return record;
}

function _widgetSdkCancelFrame(key) {
  _widgetSdkFrames.get(key)?.cancel?.();
}

function _widgetSdkTeardown(widget, context) {
  if (!widget?.id) return;
  const prefix = `${widget.id}:`;
  for (const [key, record] of _widgetSdkSchedules) {
    if (key === `${widget.id}:${context}` || (context === undefined && key.startsWith(prefix))) record.cancel();
  }
  for (const [key, record] of _widgetSdkFrames) {
    if (key.startsWith(prefix)) record.cancel();
  }
  for (const [key, state] of _widgetSdkNetworkState) {
    if (key.includes(`:${widget.id}`)) {
      state.controller?.abort?.();
      _widgetSdkNetworkState.delete(key);
    }
  }
  if (context === undefined) {
    const descriptor = WIDGET_REGISTRY[widget.widgetType];
    try { descriptor?.cleanup?.(widget); } catch (error) { console.warn(`Failed to clean up ${descriptor?.name || widget.widgetType}`, error); }
  }
}

function _widgetSdkValidateSettingsDraft(descriptor, widget) {
  const errors = [];
  const schema = descriptor?.settingsSchema;
  const config = widget?.config;
  if (!config || typeof config !== 'object' || Array.isArray(config)) return { valid: false, errors: ['Widget configuration must be an object.'] };
  Object.entries(schema?.properties || {}).forEach(([key, rule]) => {
    const value = config[key];
    if (value === undefined || rule.type === 'any') return;
    if (rule.type === 'array' && !Array.isArray(value)) errors.push(`${key} must be a list.`);
    else if (rule.type === 'number' && !(typeof value === 'number' || (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))))) errors.push(`${key} must be a number.`);
    else if (!['array', 'number'].includes(rule.type) && typeof value !== rule.type) errors.push(`${key} must be ${rule.type}.`);
    if (Array.isArray(rule.enum) && !rule.enum.includes(value)) errors.push(`${key} has an unsupported value.`);
  });
  return { valid: errors.length === 0, errors };
}

function _widgetSdkMigrateState(widget) {
  if (!widget || widget.type !== 'widget') return widget;
  const descriptor = WIDGET_REGISTRY[widget.widgetType];
  if (!descriptor) return widget;
  widget.config = { ..._widgetSdkClone(descriptor.defaultConfig), ...(widget.config || {}) };
  widget.data = { ..._widgetSdkClone(descriptor.defaultData), ...(widget.data || {}) };
  const migrated = descriptor.migrate(widget);
  return migrated && typeof migrated === 'object' ? migrated : widget;
}

function _widgetSdkCacheKey(widgetType, widgetId, key) {
  return `${WIDGET_SDK_CACHE_PREFIX}${encodeURIComponent(widgetType)}:${encodeURIComponent(widgetId)}:${encodeURIComponent(key)}`;
}

function _widgetSdkCacheGet(widgetType, widgetId, key) {
  try {
    const storageKey = _widgetSdkCacheKey(widgetType, widgetId, key);
    const envelope = JSON.parse(localStorage.getItem(storageKey) || 'null');
    if (!envelope) return null;
    if (envelope.expiresAt && envelope.expiresAt <= Date.now()) {
      localStorage.removeItem(storageKey);
      return null;
    }
    return envelope.value;
  } catch { return null; }
}

function _widgetSdkCacheSet(widgetType, widgetId, key, value, options = {}) {
  const descriptor = WIDGET_REGISTRY[widgetType];
  const quota = Number(descriptor?.capabilities?.localCache?.quotaBytes) || WIDGET_SDK_DEFAULT_CACHE_QUOTA;
  const storageKey = _widgetSdkCacheKey(widgetType, widgetId, key);
  const envelope = JSON.stringify({
    value,
    storedAt: Date.now(),
    expiresAt: options.ttlMs ? Date.now() + Math.max(0, Number(options.ttlMs)) : 0
  });
  const namespace = `${WIDGET_SDK_CACHE_PREFIX}${encodeURIComponent(widgetType)}:${encodeURIComponent(widgetId)}:`;
  let used = envelope.length * 2;
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const currentKey = localStorage.key(index);
      if (currentKey?.startsWith(namespace) && currentKey !== storageKey) used += (localStorage.getItem(currentKey) || '').length * 2;
    }
    if (used > quota) throw new Error(`Widget cache quota exceeded (${quota} bytes).`);
    localStorage.setItem(storageKey, envelope);
    return value;
  } catch (error) {
    if (error?.message?.includes('quota')) throw error;
    throw new Error('Widget cache is unavailable.');
  }
}

function _widgetSdkCacheRemove(widgetType, widgetId, key, options = {}) {
  try { localStorage.removeItem(_widgetSdkCacheKey(widgetType, widgetId, key)); } catch {}
  (options.legacyKeys || []).forEach(legacyKey => {
    try { localStorage.removeItem(String(legacyKey)); } catch {}
  });
}

function _widgetSdkCacheMigrateLegacy(widgetType, widgetId, key, legacyKey) {
  const current = _widgetSdkCacheGet(widgetType, widgetId, key);
  if (current != null) return current;
  let value = null;
  try { value = JSON.parse(localStorage.getItem(String(legacyKey)) || 'null'); } catch { value = null; }
  if (value == null) return null;
  try {
    _widgetSdkCacheSet(widgetType, widgetId, key, value);
    localStorage.removeItem(String(legacyKey));
  } catch {}
  return value;
}

function _widgetSdkResolveNetworkWidget(options = {}) {
  if (options.widgetType) return options.widgetType;
  const key = String(options.widgetFetchKey || '');
  if (key.startsWith('weather-map:')) return 'weatherMap';
  if (key.startsWith('ip-info:') || key.startsWith('ip-speed:')) return 'ipInfo';
  if (key.startsWith('apod:')) return 'nasaApod';
  if (key.startsWith('weather:')) return 'weather';
  if (key.startsWith('rss:')) return 'rssReader';
  if (key === 'iss-tle') return 'issTracker';
  return '';
}

function _widgetSdkAssertNetworkDomain(input, widgetType) {
  if (!widgetType) return;
  const domains = WIDGET_REGISTRY[widgetType]?.capabilities?.network?.domains || [];
  if (domains.includes('user-configured')) return;
  const baseUrl = typeof location !== 'undefined' ? location.href : 'http://localhost/';
  const hostname = new URL(String(input), baseUrl).hostname.toLowerCase();
  if (!domains.some(domain => hostname === domain || hostname.endsWith(`.${domain}`))) {
    throw new Error(`${widgetType} has not declared network access to ${hostname}.`);
  }
}

function _widgetSdkRunNetworkQueue() {
  while (_widgetSdkActiveRequests < WIDGET_SDK_MAX_CONCURRENT_REQUESTS && _widgetSdkNetworkQueue.length) {
    const next = _widgetSdkNetworkQueue.shift();
    _widgetSdkActiveRequests += 1;
    next.run().then(next.resolve, next.reject).finally(() => {
      _widgetSdkActiveRequests -= 1;
      _widgetSdkRunNetworkQueue();
    });
  }
}

function _widgetSdkNetworkRequest(input, options, timeoutMs, executor) {
  const widgetType = _widgetSdkResolveNetworkWidget(options);
  _widgetSdkAssertNetworkDomain(input, widgetType);
  const requestKey = String(options.widgetFetchKey || '');
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const parentSignal = options.signal;
  const abortFromParent = () => controller?.abort(parentSignal?.reason);
  if (parentSignal?.aborted) abortFromParent();
  else parentSignal?.addEventListener?.('abort', abortFromParent, { once: true });
  const state = { controller };
  if (requestKey) _widgetSdkNetworkState.set(requestKey, state);
  return new Promise((resolve, reject) => {
    _widgetSdkNetworkQueue.push({
      resolve,
      reject,
      run: async () => {
        try {
          const response = await executor(input, { ...options, signal: controller?.signal || parentSignal, __widgetSdkManaged: true }, timeoutMs);
          const maxBytes = Math.max(1024, Number(options.maxResponseBytes) || WIDGET_SDK_MAX_RESPONSE_BYTES);
          const contentLength = Number(response?.headers?.get?.('content-length') || 0);
          if (contentLength > maxBytes) throw new Error(`Widget response exceeds the ${maxBytes}-byte limit.`);
          return response;
        } finally {
          if (requestKey && _widgetSdkNetworkState.get(requestKey) === state) _widgetSdkNetworkState.delete(requestKey);
          parentSignal?.removeEventListener?.('abort', abortFromParent);
        }
      }
    });
    _widgetSdkRunNetworkQueue();
  });
}

function _widgetSdkAssertDeclaredCapability(widgetType, capability) {
  const declaration = WIDGET_REGISTRY[widgetType]?.capabilities?.[capability];
  if (!declaration) throw new Error(`${widgetType || 'Widget'} has not declared ${capability} access.`);
}

async function _widgetSdkExtensionInvoke(widgetType, method, ...args) {
  _widgetSdkAssertDeclaredCapability(widgetType, 'extensionRelay');
  const handler = typeof bridge !== 'undefined' ? bridge?.[method] : null;
  if (typeof handler !== 'function') throw new Error('Extension relay is unavailable.');
  return handler.apply(bridge, args);
}

async function _widgetSdkNativeInvoke(widgetType, method, ...args) {
  _widgetSdkAssertDeclaredCapability(widgetType, 'nativeHost');
  const handler = typeof bridge !== 'undefined' ? bridge?.[method] : null;
  if (typeof handler !== 'function' || bridge?.nativeIsAvailable?.() !== true) throw new Error('Native host is unavailable.');
  return handler.apply(bridge, args);
}

function _widgetSdkNativeSupports(widgetType, capability) {
  _widgetSdkAssertDeclaredCapability(widgetType, 'nativeHost');
  return typeof bridge !== 'undefined' && bridge?.nativeIsAvailable?.() === true && bridge?.supports?.(capability) === true;
}

function _widgetSdkExtensionSupports(widgetType, capability) {
  _widgetSdkAssertDeclaredCapability(widgetType, 'extensionRelay');
  return typeof bridge !== 'undefined' && bridge?.supports?.(capability) === true;
}

async function _widgetSdkCredentialStatus(widgetType) {
  _widgetSdkAssertDeclaredCapability(widgetType, 'secureCredentials');
  if (typeof bridge === 'undefined' || typeof bridge?.secretStatus !== 'function') {
    return { available: false, error: 'Extension not detected' };
  }
  return bridge.secretStatus();
}

async function _widgetSdkCredentialGet(widgetType, key) {
  _widgetSdkAssertDeclaredCapability(widgetType, 'secureCredentials');
  if (typeof bridge === 'undefined' || typeof bridge?.secretGet !== 'function') return '';
  return bridge.secretGet(key);
}

async function _widgetSdkCredentialSet(widgetType, key, value) {
  _widgetSdkAssertDeclaredCapability(widgetType, 'secureCredentials');
  if (typeof bridge === 'undefined' || typeof bridge?.secretSet !== 'function') return false;
  return bridge.secretSet(key, value);
}

async function _widgetSdkCredentialRemove(widgetType, key) {
  _widgetSdkAssertDeclaredCapability(widgetType, 'secureCredentials');
  if (typeof bridge === 'undefined' || typeof bridge?.secretDelete !== 'function') return false;
  return bridge.secretDelete(key);
}

const WidgetSDK = Object.freeze({
  version: WIDGET_SDK_VERSION,
  capabilities: Object.freeze({ names: WIDGET_SDK_CAPABILITIES, available: _widgetSdkCapabilityAvailable, missing: _widgetSdkMissingCapabilities }),
  registry: Object.freeze({ register: registerWidget, adoptBuiltins: _widgetSdkAdoptBuiltins, get: id => _widgetSdkDescriptors.get(id), list: () => [..._widgetSdkDescriptors.values()], validate: validateWidgetDescriptor }),
  runtime: Object.freeze({ render: _widgetSdkRender, reload: _widgetSdkReload, schedule: _widgetSdkSchedule, cancelSchedule: _widgetSdkCancelSchedule, requestFrame: _widgetSdkRequestFrame, cancelFrame: _widgetSdkCancelFrame, teardown: _widgetSdkTeardown }),
  settings: Object.freeze({ validateDraft: _widgetSdkValidateSettingsDraft }),
  state: Object.freeze({ migrate: _widgetSdkMigrateState }),
  cache: Object.freeze({ get: _widgetSdkCacheGet, set: _widgetSdkCacheSet, remove: _widgetSdkCacheRemove, migrateLegacy: _widgetSdkCacheMigrateLegacy }),
  network: Object.freeze({ request: _widgetSdkNetworkRequest, assertDomain: _widgetSdkAssertNetworkDomain }),
  extensionRelay: Object.freeze({ invoke: _widgetSdkExtensionInvoke, supports: _widgetSdkExtensionSupports }),
  nativeHost: Object.freeze({ invoke: _widgetSdkNativeInvoke, supports: _widgetSdkNativeSupports }),
  credentials: Object.freeze({ status: _widgetSdkCredentialStatus, get: _widgetSdkCredentialGet, set: _widgetSdkCredentialSet, remove: _widgetSdkCredentialRemove }),
  localPackages: Object.freeze({ enabled: widgetLocalPackagesEnabled, setEnabled: setWidgetLocalPackagesEnabled })
});

_widgetSdkAdoptBuiltins();
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('DOMContentLoaded', _widgetSdkAdoptBuiltins, { once: true });
}
