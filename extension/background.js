'use strict';

// Tab ID of the currently registered Morpheus WebHub page.
let morpheusTabId = null;

// Shared database file path resolved via native host config.
let saveFilePath = null;

// Whether the native messaging host is reachable.
let nativeAvailable = false;
let nativeError = '';
let hubPageUrl = '';
let hubRelayError = '';
let hubRegisteredAt = 0;
const hubRegistrations = new Map();
const emuguiRegistrations = new Map();
let lastActiveWebTab = null;
let storageInfoReady = false;
let fileSchemeAccess = null;
let fileSchemeAccessRequired = false;

// All shared-database writes are serialized here. Requests are never merged:
// every caller receives the result for its own snapshot.
const nativeSaveQueue = [];
let nativeSaveQueueRunning = false;
let assetWriteSessions = new Map();

const MENU_IMPORT_BOOKMARK_ID = 'morpheus-import-bookmark';
const DATABASE_READ_CHUNK_BYTES = 512 * 1024;
const PAGE_DATABASE_READ_CHUNK_BYTES = 256 * 1024;
const ASSET_WRITE_CHUNK_CHARS = 512 * 1024;
const MAX_BACKGROUND_ASSET_DOWNLOAD_BYTES = 25 * 1024 * 1024;
const MAX_NATIVE_FAVICON_BYTES = 1024 * 1024;
const MAX_FEED_RESPONSE_BYTES = 2 * 1024 * 1024;
const FEED_FETCH_TIMEOUT_MS = 15000;
const URL_HEALTH_TIMEOUT_MS = 15000;
const IMAGE_ASSET_EXTENSIONS = new Set(['avif', 'bmp', 'gif', 'jpg', 'jpeg', 'png', 'svg', 'webp']);
const NATIVE_REQUEST_TIMEOUT_MS = 15000;
const EMUGUI_REQUEST_TIMEOUT_MS = 120000;
const DIRECTORY_APPROVAL_TIMEOUT_MS = 300000;
const TRANSLATOR_ASSET_TIMEOUT_MS = 45000;
const TRANSLATOR_ASSET_MAX_CHUNK_BYTES = 1024 * 1024;
const NATIVE_RETRY_COOLDOWN_MS = 5000;
const NOTIFICATION_JOBS_KEY = 'morpheusNotificationJobsV1';
const NOTIFICATION_EVENTS_KEY = 'morpheusNotificationEventsV1';
const NOTIFICATION_PENDING_ACTION_KEY = 'morpheusNotificationPendingActionV1';
const LAST_HUB_URL_KEY = 'morpheusLastHubUrlV1';
const NOTIFICATION_ALARM_PREFIX = 'morpheus-notification:';
const MAX_NOTIFICATION_JOBS = 256;
const MAX_NOTIFICATION_EVENTS = 200;
let notificationMutation = Promise.resolve();
const TRANSLATOR_ASSET_ROOT = 'https://firefox-settings-attachments.cdn.mozilla.net/';
const TRANSLATOR_ASSETS = Object.freeze({
  'ende:model:2.1': { location: 'main-workspace/translations-models/23db71e7-b6d9-45eb-a47d-0290d7d8ef63.bin', size: 31561787, hash: '8df29d9494d19f47fd5d97c6a73474c6f657e9f81c1a607c431d02befdf3810f' },
  'ende:lex:2.1': { location: 'main-workspace/translations-models/bc072b1a-7749-43f7-9fe0-34a6dff10c4a.bin', size: 4347672, hash: '7ed39f1cffbd68a27ddf05bbfe068de2060f1d7e69f1a20e27ae923551dd7393' },
  'ende:vocab:2.1': { location: 'main-workspace/translations-models/261225ea-5a52-455b-981c-7d09c6e6da3c.spm', size: 810073, hash: '69f730becafa48e3bb2c244eab66456877c08959a02f2bd5519b5a3088b62f9c' },
  'deen:model:2.0': { location: 'main-workspace/translations-models/f44b1b1b-9df6-4ece-971e-0e5ce96fae54.bin', size: 31561787, hash: '3e6f7c2c2425d10824797270b382bee718ff34af2cab9308841c82ca46dc6f20' },
  'deen:lex:2.0': { location: 'main-workspace/translations-models/d0e4efcb-6145-43db-a69e-568904cc2925.bin', size: 4945796, hash: '113b98460468360cca68c042e1cddf49c4e1931cbb975ed04349c9a3bd607010' },
  'deen:vocab:2.0': { location: 'main-workspace/translations-models/8ad4d93e-21e6-4862-81d5-c1c3a7d0767b.spm', size: 810073, hash: '69f730becafa48e3bb2c244eab66456877c08959a02f2bd5519b5a3088b62f9c' }
});
const HUB_PAGE_REQUEST_TYPES = new Set([
  'MW_PING', 'MW_GET_STORAGE_INFO', 'MW_SET_DATABASE_PATH', 'MW_PICK_DATABASE_PATH',
  'MW_SAVE', 'MW_LOAD', 'MW_LOAD_SHARED_CHUNK', 'MW_GET_DATABASE_FILE_INFO',
  'MW_OPEN_FILE_PICKER', 'MW_BEGIN_ASSET_WRITE', 'MW_APPEND_ASSET_WRITE',
  'MW_FINISH_ASSET_WRITE', 'MW_ABORT_ASSET_WRITE', 'MW_CACHE_ASSET_URL',
  'MW_FETCH_FAVICON', 'MW_FETCH_FEED', 'MW_FETCH_CALENDAR', 'MW_CHECK_URL', 'MW_SECRET_STATUS', 'MW_SECRET_GET',
  'MW_SECRET_SET', 'MW_SECRET_DELETE', 'MW_SECRET_LIST', 'MW_LIST_THEMES',
  'MW_WRITE_THEME', 'MW_CAPTURE_BROWSER_SESSION', 'MW_LAUNCH_BROWSER_SESSION',
  'MW_LIST_DATABASE_BACKUPS', 'MW_READ_DATABASE_BACKUP', 'MW_CREATE_DATABASE_BACKUP',
  'MW_MONITOR_SERVICE', 'MW_SYSTEM_METRICS', 'MW_APPROVE_DIRECTORY',
  'MW_GIT_WORKSPACE_STATUS', 'MW_OPEN_APPROVED_DIRECTORY', 'MW_LIST_RECENT_FILES', 'MW_OPEN_APPROVED_FILE',
  'MW_APPROVE_APPLICATION', 'MW_APPROVE_APPLICATION_LINK', 'MW_GET_APPLICATION_STATUS', 'MW_LAUNCH_APPROVED_APPLICATION',
  'MW_REVEAL_APPROVED_APPLICATION', 'MW_FORGET_APPROVED_APPLICATION',
  'MW_EMUGUI_STATUS', 'MW_GET_GAME_STATUS', 'MW_LAUNCH_GAME', 'MW_OPEN_GAME_IN_EMUGUI',
  'MW_REVEAL_GAME', 'MW_FORGET_GAME',
  'MW_FETCH_TRANSLATOR_ASSET_CHUNK', 'MW_NOTIFICATION_SCHEDULE', 'MW_NOTIFICATION_CANCEL',
  'MW_NOTIFICATION_LIST', 'MW_NOTIFICATION_MARK_READ', 'MW_NOTIFICATION_CLEAR'
]);
const EMUGUI_PAGE_REQUEST_TYPES = new Set(['MW_EMUGUI_SEND_GAME', 'MW_EMUGUI_RPC', 'MW_EMUGUI_ASSET']);


// Keep one native-host process alive for startup and chunked reads. Firefox's
// sendNativeMessage launches a fresh process per call; doing that for every
// 512 KiB database chunk made a normal hub load unnecessarily slow.
let nativePort = null;
let nativePortActiveRequest = null;
const nativePortRequestQueue = [];

function pumpNativePortQueue() {
  if (nativePortActiveRequest || !nativePortRequestQueue.length) return;
  if (!nativePort) {
    try {
      const port = browser.runtime.connectNative('morpheus_webhub');
      nativePort = port;
      port.onMessage.addListener(response => {
        if (nativePort !== port) return;
        const active = nativePortActiveRequest;
        nativePortActiveRequest = null;
        if (active) {
          clearTimeout(active.timer);
          active.resolve(response);
        }
        pumpNativePortQueue();
      });
      port.onDisconnect.addListener(() => {
        if (nativePort !== port) return;
        const active = nativePortActiveRequest;
        nativePortActiveRequest = null;
        nativePort = null;
        nativeAvailable = false;
        storageInfoReady = false;
        const message = browser.runtime.lastError?.message || 'Native host disconnected';
        nativeError = message;
        if (active) {
          clearTimeout(active.timer);
          active.reject(new Error(message));
        }
        pumpNativePortQueue();
      });
    } catch (error) {
      const active = nativePortRequestQueue.shift();
      if (active) active.reject(error);
      nativePort = null;
      nativeAvailable = false;
      nativeError = error?.message || String(error);
      pumpNativePortQueue();
      return;
    }
  }

  nativePortActiveRequest = nativePortRequestQueue.shift();
  const activeRequest = nativePortActiveRequest;
  try {
    nativePort.postMessage(activeRequest.message);
    if (nativePortActiveRequest !== activeRequest) return;
    const requestTimeoutMs = Number.isFinite(activeRequest.timeoutMs) && activeRequest.timeoutMs > 0
      ? activeRequest.timeoutMs
      : NATIVE_REQUEST_TIMEOUT_MS;
    activeRequest.timer = setTimeout(() => {
      const active = nativePortActiveRequest;
      const timedOutPort = nativePort;
      nativePortActiveRequest = null;
      nativePort = null;
      nativeAvailable = false;
      storageInfoReady = false;
      nativeError = `Native host request timed out after ${requestTimeoutMs / 1000} seconds`;
      if (active) active.reject(new Error(nativeError));
      try { timedOutPort?.disconnect(); } catch {}
      pumpNativePortQueue();
    }, requestTimeoutMs);
  } catch (error) {
    const active = nativePortActiveRequest;
    nativePortActiveRequest = null;
    nativePort = null;
    clearTimeout(active?.timer);
    nativeAvailable = false;
    storageInfoReady = false;
    nativeError = error?.message || String(error);
    active.reject(error);
    pumpNativePortQueue();
  }
}

function sendPersistentNativeMessage(message, timeoutMs = NATIVE_REQUEST_TIMEOUT_MS) {
  if (typeof browser.runtime.connectNative !== 'function') {
    return sendNativeRequest(message);
  }
  return new Promise((resolve, reject) => {
    nativePortRequestQueue.push({ message, resolve, reject, timeoutMs });
    pumpNativePortQueue();
  });
}

function sendNativeRequest(message, timeoutMs = NATIVE_REQUEST_TIMEOUT_MS) {
  const safeTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? timeoutMs
    : NATIVE_REQUEST_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      nativeAvailable = false;
      storageInfoReady = false;
      nativeError = `Native host request timed out after ${safeTimeoutMs / 1000} seconds`;
      reject(new Error(nativeError));
    }, safeTimeoutMs);
    Promise.resolve(browser.runtime.sendNativeMessage('morpheus_webhub', message))
      .then(response => {
        clearTimeout(timer);
        resolve(response);
      })
      .catch(error => {
        clearTimeout(timer);
        reject(error);
      });
  });
}


// ---------------------------------------------------------------------------
// Native host probe and configuration refresh
// ---------------------------------------------------------------------------

let nativeRefreshPromise = null;
let lastNativeRefreshAt = 0;

function refreshNativeStorage() {
  if (nativeRefreshPromise) return nativeRefreshPromise;
  lastNativeRefreshAt = Date.now();
  storageInfoReady = false;
  nativeRefreshPromise = (async () => {
    try {
      const ping = await sendPersistentNativeMessage({ type: 'PING' });
      nativeAvailable = ping?.ok === true;
      if (!nativeAvailable) throw new Error('Native host did not return ok');
      const config = await sendPersistentNativeMessage({ type: 'READ_CONFIG' });
      saveFilePath = normalizeDatabasePath(config?.config?.databasePath || '');
      nativeError = '';
    } catch (error) {
      nativeAvailable = false;
      nativeError = error?.message || String(error);
    } finally {
      storageInfoReady = true;
    }
  })().finally(() => {
    nativeRefreshPromise = null;
  });
  return nativeRefreshPromise;
}

const nativeProbePromise = refreshNativeStorage();
const hostConfigPromise = nativeProbePromise;

async function ensureNativeStorageReady() {
  await hostConfigPromise;
  if (!nativeAvailable && Date.now() - lastNativeRefreshAt >= NATIVE_RETRY_COOLDOWN_MS) {
    await refreshNativeStorage();
  }
}


// ---------------------------------------------------------------------------
// File path helpers
// ---------------------------------------------------------------------------

function deriveThemesDir() {
  if (!saveFilePath) return null;
  const sep = saveFilePath.includes('\\') ? '\\' : '/';
  return saveFilePath.replace(/[/\\][^/\\]*$/, '') + sep + 'themes';
}

function joinThemePath(filename) {
  const dir = deriveThemesDir();
  if (!dir) return null;
  if (!/^[a-z0-9][a-z0-9_-]{0,79}\.json$/i.test(String(filename || ''))) return null;
  const sep = dir.includes('\\') ? '\\' : '/';
  return dir + sep + filename;
}

function getPathSeparator(path) {
  return path && path.includes('\\') ? '\\' : '/';
}

function dirname(path) {
  if (!path) return '';
  return path.replace(/[/\\][^/\\]*$/, '');
}

function joinPath(...parts) {
  const filtered = parts.filter(Boolean);
  if (!filtered.length) return '';
  const sep = getPathSeparator(filtered[0]);
  return filtered
    .map((part, index) => {
      const text = String(part);
      if (index === 0) return text.replace(/[\\/]+$/, '');
      return text.replace(/^[\\/]+|[\\/]+$/g, '');
    })
    .join(sep);
}

function fileUrlToPath(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'file:') return '';
    const pathname = decodeURIComponent(parsed.pathname || '');
    if (/^\/[a-zA-Z]:/.test(pathname)) return pathname.slice(1).replace(/\//g, '\\');
    if (parsed.hostname) return `//${parsed.hostname}${pathname}`;
    return pathname;
  } catch {
    return '';
  }
}

function pathToFileUrl(path) {
  if (!path) return '';
  const normalized = path.replace(/\\/g, '/');
  if (/^[a-zA-Z]:\//.test(normalized)) return `file:///${encodeURI(normalized)}`;
  return `file://${encodeURI(normalized.startsWith('/') ? normalized : `/${normalized}`)}`;
}

function isPotentialHubUrl(url = '') {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'file:'
      || (parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname));
  } catch {
    return false;
  }
}

async function refreshFileSchemeAccess() {
  try {
    const info = typeof browser.runtime.getBrowserInfo === 'function'
      ? await browser.runtime.getBrowserInfo()
      : null;
    const majorVersion = Number.parseInt(info?.version || '', 10);
    fileSchemeAccessRequired = Number.isFinite(majorVersion) && majorVersion >= 153;
    if (!fileSchemeAccessRequired || typeof browser.extension?.isAllowedFileSchemeAccess !== 'function') {
      fileSchemeAccess = true;
      return true;
    }
    fileSchemeAccess = await browser.extension.isAllowedFileSchemeAccess();
    return fileSchemeAccess;
  } catch {
    // Firefox 142–152 exposed the API but always returned false even though
    // matching file pages were allowed. Only enforce it when 153+ is known.
    fileSchemeAccess = fileSchemeAccessRequired ? false : true;
    return fileSchemeAccess;
  }
}

function createHubSessionToken() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function selectRegisteredHub() {
  const candidates = [...hubRegistrations.entries()]
    .sort((left, right) => {
      const activeDifference = Number(right[1].active === true) - Number(left[1].active === true);
      if (activeDifference) return activeDifference;
      return (right[1].lastActiveAt || right[1].registeredAt) - (left[1].lastActiveAt || left[1].registeredAt);
    });
  const selected = candidates[0] || null;
  morpheusTabId = selected?.[0] ?? null;
  hubPageUrl = selected?.[1]?.url || '';
  hubRegisteredAt = selected?.[1]?.registeredAt || 0;
  return selected;
}

function rememberMorpheusTab(tab, pageUrl = '', options = {}) {
  if (tab?.id === undefined) return false;
  const url = pageUrl || tab.url || '';
  if (!isPotentialHubUrl(url)) return false;
  const existing = hubRegistrations.get(tab.id);
  const now = Date.now();
  const active = options.active === true || tab.active === true;
  const registration = {
    url,
    active,
    registeredAt: now,
    lastActiveAt: active ? now : (existing?.lastActiveAt || 0),
    sessionToken: options.sessionToken || existing?.sessionToken || createHubSessionToken()
  };
  hubRegistrations.set(tab.id, registration);
  void browser.storage.local.set({ [LAST_HUB_URL_KEY]: url }).catch(() => {});
  selectRegisteredHub();
  hubRelayError = '';
  return registration;
}

function forgetMorpheusTab(tabId = morpheusTabId, error = '') {
  hubRegistrations.delete(tabId);
  selectRegisteredHub();
  hubRelayError = error || '';
}

function authorizeHubPageRequest(msg, sender) {
  const tabId = sender?.tab?.id;
  const registration = tabId === undefined ? null : hubRegistrations.get(tabId);
  const pageUrl = msg?.pageUrl || sender?.tab?.url || '';
  return !!registration
    && msg?.morpheusPage === true
    && msg?.hubSessionToken === registration.sessionToken
    && pageUrl === registration.url
    && (!sender.tab.url || sender.tab.url === registration.url);
}

async function registerEmuGuiPage(sender, pageUrl) {
  const tabId = sender?.tab?.id;
  const url = String(pageUrl || sender?.tab?.url || '');
  if (tabId === undefined || !url || (sender.tab.url && sender.tab.url !== url)) {
    return { ok: false, error: 'EmuGUI registration came from an unsupported page' };
  }
  let parsed;
  try { parsed = new URL(url); } catch { return { ok: false, error: 'EmuGUI page address is invalid' }; }
  let authorized = parsed.protocol === 'http:'
    && ['localhost', '127.0.0.1'].includes(parsed.hostname)
    && parsed.port === '8765';
  if (parsed.protocol === 'file:') {
    await ensureNativeStorageReady();
    if (!nativeAvailable) return { ok: false, error: 'Native host is required to authorize the EmuGUI file page' };
    const result = await sendPersistentNativeMessage({ type: 'EMUGUI_AUTHORIZE_PAGE', pageUrl: url }, EMUGUI_REQUEST_TIMEOUT_MS);
    authorized = result?.ok === true && result.authorized === true;
  }
  if (!authorized) return { ok: false, error: 'This is not the configured Morpheus EmuGUI page' };
  const transport = parsed.protocol === 'file:' ? 'extension' : 'http';
  const registration = { url, sessionToken: createHubSessionToken(), registeredAt: Date.now(), transport };
  emuguiRegistrations.set(tabId, registration);
  return { ok: true, emuguiSessionToken: registration.sessionToken, transport };
}

function authorizeEmuGuiPageRequest(msg, sender) {
  const tabId = sender?.tab?.id;
  const registration = tabId === undefined ? null : emuguiRegistrations.get(tabId);
  return !!registration
    && msg?.emuguiSessionToken === registration.sessionToken
    && msg?.pageUrl === registration.url
    && (registration.transport === 'extension' || msg?.type === 'MW_EMUGUI_SEND_GAME')
    && (!sender.tab.url || sender.tab.url === registration.url);
}

async function discoverMorpheusTab(tab, { inject = false } = {}) {
  if (tab?.id === undefined || !isPotentialHubUrl(tab.url || '')) return false;
  const discover = async () => {
    try {
      const response = await browser.tabs.sendMessage(tab.id, { type: 'MW_DISCOVER' });
      if (response?.isMorpheus === true && response?.registered !== false) {
        rememberMorpheusTab(tab, response.pageUrl || tab.url || '', {
          active: tab.active === true,
          sessionToken: response.hubSessionToken || ''
        });
        return true;
      }
      if (response?.isMorpheus === true && response?.error) hubRelayError = response.error;
    } catch (error) {
      hubRelayError = error?.message || String(error);
    }
    return false;
  };

  if (await discover()) return true;
  if (!inject) return false;
  try {
    await browser.tabs.executeScript(tab.id, { runAt: 'document_idle', file: '/content.js' });
  } catch (error) {
    hubRelayError = error?.message || String(error);
    return false;
  }
  return discover();
}

async function ensureMorpheusTab() {
  await refreshFileSchemeAccess();
  if (fileSchemeAccess === false && hubPageUrl.startsWith('file:')) {
    forgetMorpheusTab(morpheusTabId, 'Firefox local-file access is disabled for this extension');
  }
  if (morpheusTabId !== null) {
    if (Date.now() - hubRegisteredAt < 5000) {
      return { id: morpheusTabId, url: hubPageUrl };
    }
    try {
      const tab = await browser.tabs.get(morpheusTabId);
      if (await discoverMorpheusTab(tab)) return tab;
    } catch (error) {
      hubRelayError = error?.message || String(error);
    }
    forgetMorpheusTab(morpheusTabId, hubRelayError || 'The registered Hub relay is no longer available');
  }

  const tabs = await browser.tabs.query({});
  const candidates = (tabs || [])
    .filter(tab => isPotentialHubUrl(tab.url || ''))
    .sort((left, right) => Number(right.active === true) - Number(left.active === true));
  for (const tab of candidates) {
    if (tab.url?.startsWith('file:') && fileSchemeAccess === false) {
      hubRelayError = 'Firefox 153+ requires “Access local files on your computer” to be enabled for Morpheus WebHub';
      continue;
    }
    if (await discoverMorpheusTab(tab, { inject: true })) return tab;
  }
  return null;
}

function deriveHubRootPath() {
  const pagePath = fileUrlToPath(hubPageUrl);
  if (pagePath) return dirname(pagePath);
  return dirname(saveFilePath || '');
}

function slugifyAssetSegment(value, fallback) {
  return (value || fallback || 'asset')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || fallback || 'asset';
}

function assetExtensionFromUrl(url, fallback = 'webp') {
  try {
    const parsed = new URL(url);
    const candidates = [
      parsed.pathname || '',
      decodeURIComponent(parsed.search || '')
    ];
    for (const candidate of candidates) {
      const match = candidate.match(/\.([a-z0-9]{2,5})(?:$|[?#&=/%])/i);
      const ext = (match?.[1] || '').toLowerCase();
      if (IMAGE_ASSET_EXTENSIONS.has(ext)) return ext === 'jpeg' ? 'jpg' : ext;
    }
  } catch {}
  return fallback;
}

function createAssetWriteSession({ kind = 'background', collectionName = '', itemName = '', extension = 'webp' } = {}) {
  const hubRoot = deriveHubRootPath();
  if (!hubRoot) throw new Error('Hub root path is unavailable');
  const safeKind = slugifyAssetSegment(kind, 'asset');
  const safeCollection = slugifyAssetSegment(collectionName, 'collection');
  const safeItem = slugifyAssetSegment(itemName, 'background');
  const safeExt = slugifyAssetSegment(extension, 'webp').replace(/-/g, '') || 'webp';
  const suffix = `${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 8)}`;
  const fileName = `${safeItem}-${safeKind}-${suffix}.${safeExt}`;
  const relativePath = ['assets', `${safeKind}s`, safeCollection, fileName].join('/');
  const finalPath = joinPath(hubRoot, ...relativePath.split('/'));
  const tempPath = `${finalPath}.tmp-${suffix}`;
  const publicPath = fileUrlToPath(hubPageUrl) ? relativePath : pathToFileUrl(finalPath);
  const sessionId = `asset-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return { sessionId, finalPath, tempPath, publicPath, relativePath };
}

function normalizeDatabasePath(path) {
  const trimmed = typeof path === 'string' ? path.trim() : '';
  return trimmed || null;
}

function getStorageInfo() {
  return {
    nativeAvailable,
    storageInfoReady,
    databasePath: saveFilePath || null,
    nativeError: nativeAvailable ? '' : nativeError,
    hubRelayError,
    fileSchemeAccess,
    fileSchemeAccessRequired,
    extensionId: browser.runtime.id || '',
    capabilities: ['urlHealth', 'serviceMonitor', 'systemMetrics', 'approvedDirectories', 'gitWorkspace', 'recentFiles', 'applicationLauncher', 'emuguiService', 'commandPalette', 'browserSessions', 'backupTimeline', 'portableBundles', 'translationModels', 'notificationScheduler']
  };
}

function notificationAlarmName(id) { return `${NOTIFICATION_ALARM_PREFIX}${id}`; }
function notificationId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
function sanitizeNotificationSource(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    widgetType: String(source.widgetType || '').slice(0, 80),
    widgetId: String(source.widgetId || '').slice(0, 120),
    label: String(source.label || '').slice(0, 120)
  };
}
function sanitizeNotificationJob(value) {
  const id = String(value?.id || '').trim().replace(/[^a-zA-Z0-9:_-]/g, '').slice(0, 160);
  const when = Number(value?.when);
  if (!id || !Number.isFinite(when) || when > Date.now() + 10 * 365 * 24 * 60 * 60 * 1000) throw new Error('Invalid notification schedule');
  const title = String(value?.title || 'Morpheus WebHub').trim().slice(0, 100) || 'Morpheus WebHub';
  const message = String(value?.message || '').trim().slice(0, 500);
  if (!message) throw new Error('A notification message is required');
  return {
    id, title, message, when: Math.max(Date.now(), when),
    expiresAt: Math.max(when, Number(value?.expiresAt) || when + 24 * 60 * 60 * 1000),
    createdAt: Number(value?.createdAt) || Date.now(),
    dedupeKey: String(value?.dedupeKey || id).slice(0, 180),
    source: sanitizeNotificationSource(value?.source)
  };
}
async function readNotificationStorage(key, fallback) {
  const stored = await browser.storage.local.get(key);
  return stored && Object.prototype.hasOwnProperty.call(stored, key) ? stored[key] : fallback;
}
function mutateNotifications(task) {
  const next = notificationMutation.then(task, task);
  notificationMutation = next.catch(() => {});
  return next;
}
function scheduleHubNotification(value) {
  return mutateNotifications(async () => {
    const job = sanitizeNotificationJob(value);
    const storedJobs = await readNotificationStorage(NOTIFICATION_JOBS_KEY, []);
    const jobs = Array.isArray(storedJobs) ? storedJobs : [];
    const nextJobs = [job, ...jobs.filter(item => item?.id !== job.id)].slice(0, MAX_NOTIFICATION_JOBS);
    await browser.storage.local.set({ [NOTIFICATION_JOBS_KEY]: nextJobs });
    await Promise.resolve(browser.alarms.clear(notificationAlarmName(job.id))).catch(() => {});
    browser.alarms.create(notificationAlarmName(job.id), { when: job.when });
    return { ok: true, job };
  });
}
function cancelHubNotification(id) {
  return mutateNotifications(async () => {
    const safeId = String(id || '').slice(0, 160);
    const jobs = await readNotificationStorage(NOTIFICATION_JOBS_KEY, []);
    await browser.storage.local.set({ [NOTIFICATION_JOBS_KEY]: (Array.isArray(jobs) ? jobs : []).filter(job => job?.id !== safeId) });
    await Promise.resolve(browser.alarms.clear(notificationAlarmName(safeId))).catch(() => {});
    return { ok: true };
  });
}
function fireHubNotification(jobValue) {
  return mutateNotifications(async () => {
    const job = sanitizeNotificationJob(jobValue);
    const now = Date.now();
    const jobs = await readNotificationStorage(NOTIFICATION_JOBS_KEY, []);
    await browser.storage.local.set({ [NOTIFICATION_JOBS_KEY]: (Array.isArray(jobs) ? jobs : []).filter(item => item?.id !== job.id) });
    if (job.expiresAt < now) return { ok: true, expired: true };
    const notificationIdValue = `morpheus:${job.id}:${job.when}`;
    const events = await readNotificationStorage(NOTIFICATION_EVENTS_KEY, []);
    const event = { id: notificationId(), jobId: job.id, notificationId: notificationIdValue, title: job.title, message: job.message, createdAt: now, read: false, dedupeKey: job.dedupeKey, source: job.source };
    const nextEvents = [event, ...(Array.isArray(events) ? events : []).filter(item => item?.dedupeKey !== event.dedupeKey)].slice(0, MAX_NOTIFICATION_EVENTS);
    await browser.storage.local.set({ [NOTIFICATION_EVENTS_KEY]: nextEvents });
    await browser.notifications.create(notificationIdValue, { type: 'basic', iconUrl: browser.runtime.getURL('icons/icon-96.svg'), title: job.title, message: job.message });
    void sendToMorpheus({ type: 'MW_NOTIFICATION_EVENT', event }).catch(() => {});
    return { ok: true, event };
  });
}
function listHubNotifications() {
  return mutateNotifications(async () => {
    const jobs = await readNotificationStorage(NOTIFICATION_JOBS_KEY, []);
    const events = await readNotificationStorage(NOTIFICATION_EVENTS_KEY, []);
    const pendingAction = await readNotificationStorage(NOTIFICATION_PENDING_ACTION_KEY, null);
    if (pendingAction) await browser.storage.local.remove(NOTIFICATION_PENDING_ACTION_KEY);
    return { ok: true, jobs: Array.isArray(jobs) ? jobs : [], events: Array.isArray(events) ? events : [], pendingAction };
  });
}
function markHubNotificationsRead(ids) {
  return mutateNotifications(async () => {
    const selected = new Set((Array.isArray(ids) ? ids : []).map(String));
    const events = await readNotificationStorage(NOTIFICATION_EVENTS_KEY, []);
    const next = (Array.isArray(events) ? events : []).map(event => !selected.size || selected.has(String(event?.id)) ? { ...event, read: true } : event);
    await browser.storage.local.set({ [NOTIFICATION_EVENTS_KEY]: next });
    return { ok: true, events: next };
  });
}
function clearHubNotifications() {
  return mutateNotifications(async () => { await browser.storage.local.set({ [NOTIFICATION_EVENTS_KEY]: [] }); return { ok: true }; });
}
async function rehydrateNotificationAlarms() {
  if (!browser.alarms?.create) return;
  const jobs = await readNotificationStorage(NOTIFICATION_JOBS_KEY, []);
  const now = Date.now();
  for (const rawJob of Array.isArray(jobs) ? jobs : []) {
    try {
      const job = sanitizeNotificationJob(rawJob);
      if (job.expiresAt < now) { await cancelHubNotification(job.id); continue; }
      if (job.when <= now) await fireHubNotification(job);
      else browser.alarms.create(notificationAlarmName(job.id), { when: job.when });
    } catch {}
  }
}

if (browser.alarms?.onAlarm) {
  browser.alarms.onAlarm.addListener(alarm => {
    if (!String(alarm?.name || '').startsWith(NOTIFICATION_ALARM_PREFIX)) return;
    const id = alarm.name.slice(NOTIFICATION_ALARM_PREFIX.length);
    void readNotificationStorage(NOTIFICATION_JOBS_KEY, []).then(jobs => {
      const job = (Array.isArray(jobs) ? jobs : []).find(item => item?.id === id);
      return job ? fireHubNotification(job) : null;
    }).catch(error => console.warn('Morpheus: notification alarm failed', error));
  });
  void rehydrateNotificationAlarms().catch(error => console.warn('Morpheus: notification rehydration failed', error));
}

if (browser.notifications?.onClicked) {
  browser.notifications.onClicked.addListener(clickedId => {
    void (async () => {
      const events = await readNotificationStorage(NOTIFICATION_EVENTS_KEY, []);
      const event = (Array.isArray(events) ? events : []).find(item => item?.notificationId === clickedId);
      if (!event) return;
      await markHubNotificationsRead([event.id]);
      const tab = await ensureMorpheusTab().catch(() => null);
      if (tab) {
        await browser.tabs.update(tab.id, { active: true }).catch(() => {});
        if (tab.windowId !== undefined && browser.windows?.update) await browser.windows.update(tab.windowId, { focused: true }).catch(() => {});
        await sendToMorpheus({ type: 'MW_OPEN_NOTIFICATION_TARGET', event }).catch(() => {});
        return;
      }
      await browser.storage.local.set({ [NOTIFICATION_PENDING_ACTION_KEY]: event });
      const lastUrl = await readNotificationStorage(LAST_HUB_URL_KEY, '');
      if (isPotentialHubUrl(lastUrl) && browser.tabs.create) await browser.tabs.create({ url: lastUrl, active: true });
    })().catch(error => console.warn('Morpheus: notification click failed', error));
  });
}

function sanitizeSessionTab(tab, group = null) {
  if (!/^https?:\/\//i.test(String(tab?.url || ''))) return null;
  return {
    title: String(tab.title || tab.url || ''),
    url: String(tab.url),
    pinned: tab.pinned === true,
    active: tab.active === true,
    group: group ? { title: String(group.title || ''), color: String(group.color || '') } : null
  };
}

async function captureBrowserSession(scope = 'window') {
  let tabs = [];
  let skippedPrivate = 0;
  if (scope === 'recent') {
    const recentlyClosed = typeof browser.sessions?.getRecentlyClosed === 'function' ? await browser.sessions.getRecentlyClosed({ maxResults: 25 }) : [];
    for (const entry of recentlyClosed) {
      if (entry.tab) tabs.push(entry.tab);
      if (entry.window?.tabs) tabs.push(...entry.window.tabs);
    }
  } else {
    const query = { currentWindow: true };
    if (scope === 'active-tab' || scope === 'group') query.active = true;
    if (scope === 'highlighted') query.highlighted = true;
    tabs = await browser.tabs.query(query);
    if ((scope === 'active-tab' || scope === 'group') && (!tabs.length || tabs.every(tab => isPotentialHubUrl(tab.url || ''))) && lastActiveWebTab) {
      tabs = [lastActiveWebTab];
    }
    if (scope === 'group') {
      const groupId = tabs[0]?.groupId;
      tabs = Number.isInteger(groupId) && groupId >= 0 ? await browser.tabs.query({ windowId: tabs[0]?.windowId, groupId }) : tabs;
    }
  }
  const groupCache = new Map();
  const sanitized = [];
  for (const tab of tabs) {
    if (tab.incognito === true) { skippedPrivate++; continue; }
    let group = null;
    if (Number.isInteger(tab.groupId) && tab.groupId >= 0 && typeof browser.tabGroups?.get === 'function') {
      if (!groupCache.has(tab.groupId)) {
        try { groupCache.set(tab.groupId, await browser.tabGroups.get(tab.groupId)); } catch { groupCache.set(tab.groupId, null); }
      }
      group = groupCache.get(tab.groupId);
    }
    const record = sanitizeSessionTab(tab, group);
    if (record) sanitized.push(record);
  }
  return { ok: true, title: scope === 'recent' ? 'Recently Closed' : 'Firefox Session', createdAt: new Date().toISOString(), tabs: sanitized, skippedPrivate };
}

async function launchBrowserSession(tabs, options = {}) {
  const safeTabs = (Array.isArray(tabs) ? tabs : []).map(tab => sanitizeSessionTab(tab, tab.group)).filter(Boolean);
  const seen = new Set();
  const unique = safeTabs.filter(tab => { const key = tab.url.replace(/#.*$/, ''); if (seen.has(key)) return false; seen.add(key); return true; });
  const created = [];
  const failures = [];
  for (const tab of unique) {
    try {
      const opened = await browser.tabs.create({ url: tab.url, active: false, pinned: tab.pinned });
      created.push({ id: opened.id, group: tab.group });
    } catch (error) { failures.push({ url: tab.url, error: error?.message || String(error) }); }
    if (options.staggerMs) await new Promise(resolve => setTimeout(resolve, Math.min(1000, Number(options.staggerMs))));
  }
  let groupingSupported = typeof browser.tabs.group === 'function' && typeof browser.tabGroups?.update === 'function';
  if (options.recreateGroups !== false && groupingSupported) {
    const groups = new Map();
    for (const entry of created) if (entry.group?.title) {
      const key = `${entry.group.title}|${entry.group.color}`;
      if (!groups.has(key)) groups.set(key, { ...entry.group, tabIds: [] });
      groups.get(key).tabIds.push(entry.id);
    }
    for (const group of groups.values()) {
      try { const groupId = await browser.tabs.group({ tabIds: group.tabIds }); await browser.tabGroups.update(groupId, { title: group.title, color: group.color || undefined }); } catch { groupingSupported = false; }
    }
  }
  return { ok: true, opened: created.length, failed: failures.length, failures, groupingSupported };
}

async function listDatabaseBackups() {
  await ensureNativeStorageReady();
  if (!nativeAvailable || !saveFilePath) throw new Error('A native shared database must be configured');
  return sendNativeRequest({ type: 'LIST_DATABASE_BACKUPS', databasePath: saveFilePath });
}

async function readDatabaseBackup(name) {
  await ensureNativeStorageReady();
  if (!nativeAvailable || !saveFilePath) throw new Error('A native shared database must be configured');
  let offset = 0; let readVersion = null; let metadata = null; const chunks = [];
  while (true) {
    const res = await sendNativeRequest({ type: 'READ_DATABASE_BACKUP_CHUNK', databasePath: saveFilePath, name, offset, length: PAGE_DATABASE_READ_CHUNK_BYTES, expectedVersion: readVersion });
    readVersion ||= res.readVersion;
    metadata ||= res;
    chunks.push(res.chunk || '');
    if (res.done) break;
    if (!res.nextOffset || res.nextOffset <= offset) throw new Error('Backup read stalled');
    offset = res.nextOffset;
  }
  const bytes = chunks.map(chunk => Uint8Array.from(atob(chunk), character => character.charCodeAt(0)));
  const total = bytes.reduce((sum, chunk) => sum + chunk.length, 0); const joined = new Uint8Array(total); let cursor = 0;
  for (const chunk of bytes) { joined.set(chunk, cursor); cursor += chunk.length; }
  return { ok: true, content: new TextDecoder().decode(joined), summary: metadata.summary, fileInfo: metadata.fileInfo };
}

async function createDatabaseBackup() {
  await ensureNativeStorageReady();
  if (!nativeAvailable || !saveFilePath) throw new Error('A native shared database must be configured');
  return sendNativeRequest({ type: 'CREATE_DATABASE_BACKUP', databasePath: saveFilePath });
}

async function writeHostConfig() {
  await ensureNativeStorageReady();
  if (!nativeAvailable) return false;
  try {
    await sendNativeRequest({
      type: 'WRITE_CONFIG',
      config: { databasePath: saveFilePath || '' }
    });
    return true;
  } catch {
    return false;
  }
}

async function setDatabasePath(path) {
  await ensureNativeStorageReady();
  saveFilePath = normalizeDatabasePath(path);
  if (!nativeAvailable) return !saveFilePath;
  return writeHostConfig();
}

function extractDatabasePath(json) {
  try {
    const parsed = JSON.parse(json);
    return normalizeDatabasePath(parsed?.databasePath || '');
  } catch {
    return null;
  }
}

function makeHubBookmarkId(prefix = 'bm') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function normalizeFaviconUrl(url) {
  return typeof url === 'string' ? url.trim() : '';
}

function tabToImportItem({ url, title, faviconCache = '' } = {}) {
  const normalizedUrl = typeof url === 'string' ? url.trim() : '';
  if (!normalizedUrl) return null;
  return {
    id: makeHubBookmarkId(),
    type: 'bookmark',
    title: title || normalizedUrl,
    url: normalizedUrl,
    tags: [],
    faviconCache: normalizeFaviconUrl(faviconCache)
  };
}

function bookmarkNodeToImportItem(node) {
  if (!node) return null;
  if (node.url) {
    return {
      id: makeHubBookmarkId(),
      type: 'bookmark',
      title: node.title || node.url,
      url: node.url,
      tags: [],
      faviconCache: ''
    };
  }
  const children = (node.children || [])
    .map(bookmarkNodeToImportItem)
    .filter(Boolean);
  return {
    id: makeHubBookmarkId('folder'),
    type: 'folder',
    title: node.title || 'Imported folder',
    collapsed: true,
    tags: [],
    sharedTags: [],
    children
  };
}

function makeDeliveryId(prefix = 'delivery') {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function sendImportItemsToMorpheus(items, source = '', deliveryId = '') {
  return sendToMorpheus({
    type: 'MW_RECEIVE_IMPORT_ITEMS',
    items: items || [],
    source,
    deliveryId: deliveryId || makeDeliveryId('import')
  });
}

async function sendToMorpheus(message) {
  let tab = await ensureMorpheusTab();
  if (!tab) throw new Error(hubRelayError || 'Morpheus WebHub is not open');
  try {
    return await browser.tabs.sendMessage(tab.id, message);
  } catch (error) {
    forgetMorpheusTab(tab.id, error?.message || String(error));
    tab = await ensureMorpheusTab();
    if (!tab) throw new Error(hubRelayError || 'Morpheus WebHub relay is unavailable');
    return browser.tabs.sendMessage(tab.id, message);
  }
}

async function importBookmarkNode(bookmarkId) {
  if (!bookmarkId) throw new Error('No bookmark was selected');
  const roots = await browser.bookmarks.getSubTree(bookmarkId);
  const items = roots.map(bookmarkNodeToImportItem).filter(Boolean);
  if (!items.length) throw new Error('No bookmarks found');
  const result = await sendImportItemsToMorpheus(items, 'bookmarks-menu');
  if (!result?.ok) throw new Error(result?.error || 'The hub rejected the bookmark import');
}

async function getDatabaseFileInfo() {
  await ensureNativeStorageReady();
  if (!nativeAvailable || !saveFilePath) {
    return {
      databasePath: saveFilePath || null,
      fileInfo: null
    };
  }
  try {
    const res = await sendNativeRequest({
      type: 'STAT_FILE',
      path: saveFilePath,
      includeHash: false
    });
    return {
      databasePath: saveFilePath || null,
      fileInfo: res?.fileInfo || null
    };
  } catch {
    return {
      databasePath: saveFilePath || null,
      fileInfo: null
    };
  }
}

function decodeBase64Chunk(chunk) {
  const binary = atob(chunk || '');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeChunkedText(chunks, totalSize) {
  const bytes = new Uint8Array(totalSize);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder('utf-8').decode(bytes);
}

async function readNativeFileChunkedOnce(path) {
  let offset = 0;
  let totalSize = 0;
  let fileInfo = null;
  let readVersion = null;
  const chunks = [];

  while (true) {
    const res = await sendPersistentNativeMessage({
      type: 'READ_FILE_CHUNK',
      path,
      offset,
      length: DATABASE_READ_CHUNK_BYTES,
      expectedVersion: readVersion
    });
    if (!res?.ok) throw new Error(res?.error || 'Native chunk read failed');
    fileInfo = res.fileInfo ? { ...(fileInfo || {}), ...res.fileInfo } : fileInfo;
    readVersion = readVersion || res.readVersion || res.fileInfo?.version || null;
    if (res.readVersion && readVersion !== res.readVersion) {
      throw new Error('Shared database changed during chunked read; retry required');
    }
    if (fileInfo && fileInfo.exists === false) {
      return { content: null, fileInfo };
    }
    const bytes = decodeBase64Chunk(res.chunk || '');
    chunks.push(bytes);
    totalSize = Number.isFinite(res.totalSize) ? res.totalSize : totalSize;
    offset = Number.isFinite(res.nextOffset) ? res.nextOffset : offset + bytes.length;
    if (res.done) break;
    if (!bytes.length) throw new Error('Native chunk read stalled');
  }

  const receivedSize = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  if (totalSize && receivedSize !== totalSize) {
    throw new Error(`Shared database chunk read was incomplete (${receivedSize} of ${totalSize} bytes)`);
  }

  return {
    content: decodeChunkedText(chunks, totalSize || receivedSize),
    fileInfo
  };
}

async function readNativeFileChunked(path) {
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await readNativeFileChunkedOnce(path);
    } catch (error) {
      lastError = error;
      if (!/changed during chunked read/i.test(error?.message || '')) throw error;
    }
  }
  throw lastError || new Error('Shared database could not be read consistently');
}

async function loadSharedStateChunk(offset = 0, length = PAGE_DATABASE_READ_CHUNK_BYTES, expectedVersion = null) {
  await ensureNativeStorageReady();
  if (!nativeAvailable || !saveFilePath) {
    throw new Error('Shared database is not available');
  }
  const safeOffset = Math.max(0, Number(offset) || 0);
  const safeLength = Math.max(1, Math.min(PAGE_DATABASE_READ_CHUNK_BYTES, Number(length) || PAGE_DATABASE_READ_CHUNK_BYTES));
  const res = await sendPersistentNativeMessage({
    type: 'READ_FILE_CHUNK',
    path: saveFilePath,
    offset: safeOffset,
    length: safeLength,
    expectedVersion: expectedVersion || null
  });
  if (!res?.ok) throw new Error(res?.error || 'Shared database chunk read failed');
  return {
    chunk: res.chunk || '',
    nextOffset: res.nextOffset ?? safeOffset,
    totalSize: res.totalSize ?? 0,
    done: res.done === true,
    readVersion: res.readVersion || res.fileInfo?.version || null,
    fileInfo: res.fileInfo || null,
    databasePath: saveFilePath
  };
}

async function beginAssetWrite(options = {}) {
  await ensureNativeStorageReady();
  if (!nativeAvailable) return { ok: false, error: 'Native host not available' };
  const session = createAssetWriteSession(options);
  const res = await sendNativeRequest({
    type: 'BEGIN_FILE_WRITE',
    tempPath: session.tempPath
  });
  if (!res?.ok) return { ok: false, error: res?.error || 'Failed to begin asset write' };
  assetWriteSessions.set(session.sessionId, session);
  return {
    ok: true,
    sessionId: session.sessionId,
    publicPath: session.publicPath,
    relativePath: session.relativePath,
    chunkChars: ASSET_WRITE_CHUNK_CHARS
  };
}

async function appendAssetWriteChunk(sessionId, chunk) {
  const session = assetWriteSessions.get(sessionId);
  if (!session) return { ok: false, error: 'Unknown asset write session' };
  return sendNativeRequest({
    type: 'APPEND_FILE_CHUNK',
    tempPath: session.tempPath,
    chunk: chunk || ''
  });
}

async function finishAssetWrite(sessionId) {
  const session = assetWriteSessions.get(sessionId);
  if (!session) return { ok: false, error: 'Unknown asset write session' };
  try {
    const res = await sendNativeRequest({
      type: 'FINISH_FILE_WRITE',
      tempPath: session.tempPath,
      path: session.finalPath
    });
    return {
      ok: res?.ok !== false,
      error: res?.error || '',
      fileInfo: res?.fileInfo || null,
      publicPath: session.publicPath,
      relativePath: session.relativePath
    };
  } finally {
    assetWriteSessions.delete(sessionId);
  }
}

async function abortAssetWrite(sessionId) {
  const session = assetWriteSessions.get(sessionId);
  if (!session) return { ok: true };
  assetWriteSessions.delete(sessionId);
  return sendNativeRequest({
    type: 'DELETE_FILE',
    path: session.tempPath
  });
}

async function cacheAssetUrl(options = {}) {
  await ensureNativeStorageReady();
  if (!nativeAvailable) return { ok: false, error: 'Native host not available' };
  const url = typeof options.url === 'string' ? options.url.trim() : '';
  if (!/^https?:\/\//i.test(url)) return { ok: false, error: 'Only http and https URLs can be cached' };
  const session = createAssetWriteSession({
    kind: options.kind || 'background',
    collectionName: options.collectionName || '',
    itemName: options.itemName || '',
    extension: options.extension || assetExtensionFromUrl(url)
  });
  const res = await sendNativeRequest({
    type: 'DOWNLOAD_URL_TO_FILE',
    url,
    path: session.finalPath,
    tempPath: session.tempPath,
    maxBytes: options.maxBytes || MAX_BACKGROUND_ASSET_DOWNLOAD_BYTES
  });
  if (!res?.ok) return { ok: false, error: res?.error || 'Failed to cache URL asset' };
  return {
    ok: true,
    publicPath: session.publicPath,
    relativePath: session.relativePath,
    fileInfo: res.fileInfo || null,
    contentType: res.contentType || '',
    bytes: res.bytes || 0
  };
}

async function fetchFavicon(options = {}) {
  await ensureNativeStorageReady();
  if (!nativeAvailable) return { ok: false, error: 'Native host not available' };
  const url = typeof options.url === 'string' ? options.url.trim() : '';
  if (!/^https?:\/\//i.test(url)) return { ok: false, error: 'Only http and https URLs support native favicon fetch' };
  return sendNativeRequest({
    type: 'FETCH_FAVICON',
    url,
    maxBytes: options.maxBytes || MAX_NATIVE_FAVICON_BYTES
  });
}

async function fetchFeedText(options = {}) {
  const url = typeof options.url === 'string' ? options.url.trim() : '';
  if (!/^https?:\/\//i.test(url)) return { ok: false, error: 'Only http and https feed URLs are supported' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FEED_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'omit',
      redirect: 'follow',
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        Accept: 'application/atom+xml, application/rss+xml, application/xml, text/xml, */*;q=0.2'
      }
    });
    if (!response.ok) return { ok: false, error: `Feed returned ${response.status}` };
    const declaredLength = Number(response.headers?.get?.('content-length') || 0);
    if (declaredLength > MAX_FEED_RESPONSE_BYTES) return { ok: false, error: 'Feed exceeds the 2 MiB response limit' };
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_FEED_RESPONSE_BYTES) return { ok: false, error: 'Feed exceeds the 2 MiB response limit' };
    return {
      ok: true,
      text: new TextDecoder('utf-8').decode(buffer),
      finalUrl: response.url || url,
      contentType: response.headers?.get?.('content-type') || '',
      bytes: buffer.byteLength
    };
  } catch (error) {
    return {
      ok: false,
      error: error?.name === 'AbortError' ? 'Feed request timed out' : (error?.message || 'Feed request failed')
    };
  } finally {
    clearTimeout(timer);
  }
}

function translatorBytesToBase64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + 0x8000)));
  }
  return btoa(binary);
}

async function fetchTranslatorAssetChunk(options = {}) {
  const assetId = String(options.assetId || '');
  const asset = TRANSLATOR_ASSETS[assetId];
  if (!asset) return { ok: false, error: 'Unknown translation model asset' };
  const offset = Math.max(0, Math.floor(Number(options.offset) || 0));
  if (offset >= asset.size) return { ok: false, error: 'Translation model offset is out of range' };
  const requestedLength = Math.max(1, Math.min(
    TRANSLATOR_ASSET_MAX_CHUNK_BYTES,
    Math.floor(Number(options.length) || TRANSLATOR_ASSET_MAX_CHUNK_BYTES),
    asset.size - offset
  ));
  const end = offset + requestedLength - 1;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TRANSLATOR_ASSET_TIMEOUT_MS);
  try {
    const response = await fetch(`${TRANSLATOR_ASSET_ROOT}${asset.location}`, {
      method: 'GET', credentials: 'omit', redirect: 'error', cache: 'no-store', signal: controller.signal,
      headers: { Accept: 'application/octet-stream', Range: `bytes=${offset}-${end}` }
    });
    if (response.status !== 206) return { ok: false, error: `Mozilla model server returned ${response.status}; partial content was required` };
    const contentRange = String(response.headers?.get?.('content-range') || '');
    const rangeMatch = contentRange.match(/^bytes\s+(\d+)-(\d+)\/(\d+)$/i);
    if (!rangeMatch || Number(rangeMatch[1]) !== offset || Number(rangeMatch[3]) !== asset.size) {
      return { ok: false, error: 'Mozilla model server returned an invalid byte range' };
    }
    const buffer = await response.arrayBuffer();
    if (!buffer.byteLength || buffer.byteLength > requestedLength || Number(rangeMatch[2]) !== offset + buffer.byteLength - 1) {
      return { ok: false, error: 'Mozilla model server returned an invalid chunk size' };
    }
    const nextOffset = offset + buffer.byteLength;
    return {
      ok: true, assetId, offset, nextOffset, totalSize: asset.size, hash: asset.hash,
      done: nextOffset >= asset.size, chunk: translatorBytesToBase64(new Uint8Array(buffer))
    };
  } catch (error) {
    return { ok: false, error: error?.name === 'AbortError' ? 'Translation model download timed out' : (error?.message || 'Translation model download failed') };
  } finally {
    clearTimeout(timer);
  }
}

async function checkUrlHealth(options = {}) {
  const url = typeof options.url === 'string' ? options.url.trim() : '';
  if (!/^https?:\/\//i.test(url) || url.length > 4096) {
    return { ok: true, reachable: false, status: 0, finalUrl: url, errorType: 'unsupported', error: 'Only bounded HTTP and HTTPS URLs can be checked' };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), URL_HEALTH_TIMEOUT_MS);
  const request = async method => fetch(url, {
    method,
    credentials: 'omit',
    redirect: 'follow',
    cache: 'no-store',
    signal: controller.signal,
    headers: method === 'GET' ? { Range: 'bytes=0-0' } : undefined
  });
  try {
    let response = null;
    let headError = null;
    try {
      response = await request('HEAD');
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      headError = error;
    }
    if (!response || response.status === 405 || response.status === 501) {
      try {
        response = await request('GET');
      } catch (error) {
        if (error?.name === 'AbortError') throw error;
        if (headError) {
          const combined = new Error(`HEAD failed: ${headError?.message || headError}; GET failed: ${error?.message || error}`);
          combined.cause = error;
          throw combined;
        }
        throw error;
      }
    }
    try { await response.body?.cancel?.(); } catch {}
    return {
      ok: true,
      reachable: true,
      status: response.status,
      statusText: String(response.statusText || '').slice(0, 128),
      finalUrl: response.url || url,
      errorType: response.status === 401 || response.status === 403 ? 'authentication' : (response.status >= 400 ? 'http' : '')
    };
  } catch (error) {
    const message = error?.message || 'Network request failed';
    const causeCode = String(error?.cause?.code || error?.code || '').toUpperCase();
    const dnsFailure = /ENOTFOUND|EAI_AGAIN|DNS/.test(causeCode) || /DNS|name not resolved|host not found/i.test(message);
    return {
      ok: true,
      reachable: false,
      status: 0,
      finalUrl: url,
      errorType: error?.name === 'AbortError' ? 'timeout' : (dnsFailure ? 'dns' : 'network'),
      error: error?.name === 'AbortError' ? 'Request timed out' : message
    };
  } finally {
    clearTimeout(timer);
  }
}

async function monitorService(options = {}) {
  const url = typeof options.url === 'string' ? options.url.trim() : '';
  if (!/^https:\/\//i.test(url) || url.length > 4096) return { ok: false, error: 'Only bounded HTTPS endpoints can be monitored' };
  const timeoutSeconds = Math.max(3, Math.min(30, Number(options.timeoutSeconds) || 10));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      method: 'GET', credentials: 'omit', redirect: 'follow', cache: 'no-store', signal: controller.signal,
      headers: { Accept: options.assertionType === 'json' ? 'application/json, text/plain;q=0.8, */*;q=0.2' : 'text/plain, application/json;q=0.8, */*;q=0.2' }
    });
    const declaredLength = Number(response.headers?.get?.('content-length') || 0);
    if (declaredLength > 128 * 1024) return { ok: false, error: 'Service response exceeds the 128 KiB limit' };
    let text = '';
    if (options.assertionType === 'text' || options.assertionType === 'json') {
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > 128 * 1024) return { ok: false, error: 'Service response exceeds the 128 KiB limit' };
      text = new TextDecoder('utf-8').decode(buffer);
    } else {
      try { await response.body?.cancel?.(); } catch {}
    }
    return { ok: true, status: response.status, finalUrl: response.url || url, text, durationMs: Date.now() - startedAt };
  } catch (error) {
    return { ok: false, error: error?.name === 'AbortError' ? 'Service check timed out' : (error?.message || 'Service check failed') };
  } finally { clearTimeout(timer); }
}

async function fetchCalendarText(options = {}) {
  const url = typeof options.url === 'string' ? options.url.trim() : '';
  if (!/^https:\/\//i.test(url)) return { ok: false, error: 'Only HTTPS calendar URLs are supported' };
  let parsedUrl;
  try { parsedUrl = new URL(url); } catch { return { ok: false, error: 'Calendar URL is invalid' }; }
  const requested = options.headers && typeof options.headers === 'object' ? options.headers : {};
  const headers = {
    Accept: typeof requested.Accept === 'string'
      ? requested.Accept.slice(0, 256)
      : 'text/calendar, application/json, text/plain, */*;q=0.2'
  };
  if (parsedUrl.hostname === 'api.football-data.org'
      && typeof requested['X-Auth-Token'] === 'string' && requested['X-Auth-Token'].length <= 512) {
    headers['X-Auth-Token'] = requested['X-Auth-Token'];
  }
  if (parsedUrl.hostname === 'api.sportmonks.com'
      && typeof requested.Authorization === 'string' && requested.Authorization.length <= 512) {
    headers.Authorization = requested.Authorization;
  }
  if (parsedUrl.hostname === 'v3.football.api-sports.io'
      && typeof requested['x-apisports-key'] === 'string' && requested['x-apisports-key'].length <= 512) {
    headers['x-apisports-key'] = requested['x-apisports-key'];
  }
  const hasProviderCredential = !!(headers['X-Auth-Token'] || headers.Authorization || headers['x-apisports-key']);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FEED_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'GET', credentials: 'omit', redirect: hasProviderCredential ? 'error' : 'follow', cache: 'no-store', signal: controller.signal, headers
    });
    if (!response.ok) {
      const declaredLength = Number(response.headers?.get?.('content-length') || 0);
      let detail = '';
      if (!declaredLength || declaredLength <= MAX_FEED_RESPONSE_BYTES) {
        try {
          const errorBuffer = await response.arrayBuffer();
          if (errorBuffer.byteLength <= MAX_FEED_RESPONSE_BYTES) {
            const errorText = new TextDecoder('utf-8').decode(errorBuffer);
            try { const payload = JSON.parse(errorText); detail = String(payload?.message || payload?.error || ''); }
            catch { detail = errorText.replace(/\s+/g, ' ').trim().slice(0, 300); }
          }
        } catch {}
      }
      return { ok: false, status: response.status, error: `${parsedUrl.hostname} returned ${response.status}${detail ? `: ${detail}` : ''}` };
    }
    const declaredLength = Number(response.headers?.get?.('content-length') || 0);
    if (declaredLength > MAX_FEED_RESPONSE_BYTES) return { ok: false, error: 'Calendar response exceeds the 2 MiB limit' };
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_FEED_RESPONSE_BYTES) return { ok: false, error: 'Calendar response exceeds the 2 MiB limit' };
    return {
      ok: true, text: new TextDecoder('utf-8').decode(buffer), finalUrl: response.url || url,
      contentType: response.headers?.get?.('content-type') || '', bytes: buffer.byteLength
    };
  } catch (error) {
    return { ok: false, error: error?.name === 'AbortError' ? 'Calendar request timed out' : (error?.message || 'Calendar request failed') };
  } finally {
    clearTimeout(timer);
  }
}

async function secretStatus() {
  await ensureNativeStorageReady();
  if (!nativeAvailable) return { ok: true, available: false, provider: '', error: nativeError || 'Native host not available' };
  return sendNativeRequest({ type: 'SECRET_STATUS' });
}

async function secretGet(key) {
  await ensureNativeStorageReady();
  if (!nativeAvailable) return { ok: false, error: 'Native host not available', value: '' };
  return sendNativeRequest({ type: 'SECRET_GET', key });
}

async function secretSet(key, value) {
  await ensureNativeStorageReady();
  if (!nativeAvailable) return { ok: false, error: 'Native host not available' };
  return sendNativeRequest({ type: 'SECRET_SET', key, value });
}

async function secretDelete(key) {
  await ensureNativeStorageReady();
  if (!nativeAvailable) return { ok: false, error: 'Native host not available' };
  return sendNativeRequest({ type: 'SECRET_DELETE', key });
}

async function secretList() {
  await ensureNativeStorageReady();
  if (!nativeAvailable) return { ok: true, keys: [] };
  return sendNativeRequest({ type: 'SECRET_LIST' });
}

async function systemMetrics(metrics = []) {
  await ensureNativeStorageReady();
  if (!nativeAvailable) return { ok: false, error: 'Native host not available' };
  const allowed = new Set(['cpu', 'memory', 'disk', 'network', 'uptime', 'battery', 'platform']);
  return sendNativeRequest({ type: 'SYSTEM_METRICS', metrics: [...new Set((Array.isArray(metrics) ? metrics : []).filter(metric => allowed.has(metric)))] });
}

async function approveDirectory(purpose, title) {
  await ensureNativeStorageReady();
  if (!nativeAvailable) return { ok: false, error: 'Native host not available' };
  if (!['git', 'recent-files'].includes(purpose)) return { ok: false, error: 'Unsupported directory purpose' };
  return sendNativeRequest(
    { type: 'APPROVE_DIRECTORY', purpose, title: String(title || 'Select folder').slice(0, 160) },
    DIRECTORY_APPROVAL_TIMEOUT_MS
  );
}

async function gitWorkspaceStatus(handle) {
  await ensureNativeStorageReady();
  if (!nativeAvailable) return { ok: false, error: 'Native host not available' };
  return sendNativeRequest({ type: 'GIT_WORKSPACE_STATUS', handle: String(handle || '').slice(0, 80) });
}

async function openApprovedDirectory(handle, purpose, action) {
  await ensureNativeStorageReady();
  if (!nativeAvailable) return { ok: false, error: 'Native host not available' };
  if (!['git', 'recent-files'].includes(purpose) || !['folder', 'terminal'].includes(action)) return { ok: false, error: 'Unsupported directory action' };
  return sendNativeRequest({ type: 'OPEN_APPROVED_DIRECTORY', handle: String(handle || '').slice(0, 80), purpose, action });
}

async function listRecentFiles(options = {}) {
  await ensureNativeStorageReady();
  if (!nativeAvailable) return { ok: false, error: 'Native host not available' };
  const extensions = (Array.isArray(options.extensions) ? options.extensions : []).map(value => String(value).slice(0, 16)).slice(0, 20);
  return sendNativeRequest({
    type: 'LIST_RECENT_FILES', handle: String(options.handle || '').slice(0, 80), extensions,
    maxAgeHours: Math.max(1, Math.min(8760, Number(options.maxAgeHours) || 168)),
    limit: Math.max(1, Math.min(100, Number(options.limit) || 30)), recursive: options.recursive === true
  });
}

async function openApprovedFile(handle, relativePath, action) {
  await ensureNativeStorageReady();
  if (!nativeAvailable) return { ok: false, error: 'Native host not available' };
  if (!['open', 'reveal'].includes(action)) return { ok: false, error: 'Unsupported file action' };
  return sendNativeRequest({ type: 'OPEN_APPROVED_FILE', handle: String(handle || '').slice(0, 80), relativePath: String(relativePath || '').slice(0, 2048), action });
}

async function approveApplication(appKey, title) {
  await ensureNativeStorageReady();
  if (!nativeAvailable) return { ok: false, error: 'Native host not available' };
  return sendNativeRequest({
    type: 'APPROVE_APPLICATION',
    appKey: String(appKey || '').slice(0, 80),
    title: String(title || 'Select application').slice(0, 160)
  }, DIRECTORY_APPROVAL_TIMEOUT_MS);
}

async function approveApplicationLink(appKey, title, targetUri, iconHint) {
  await ensureNativeStorageReady();
  if (!nativeAvailable) return { ok: false, error: 'Native host not available' };
  return sendNativeRequest({
    type: 'APPROVE_APPLICATION_LINK',
    appKey: String(appKey || '').slice(0, 80),
    title: String(title || 'Application').slice(0, 160),
    targetUri: String(targetUri || '').slice(0, 4096),
    iconHint: String(iconHint || '').slice(0, 2048)
  });
}

async function getApplicationStatus(appKey) {
  await ensureNativeStorageReady();
  if (!nativeAvailable) return { ok: false, error: 'Native host not available' };
  return sendNativeRequest({ type: 'GET_APPLICATION_STATUS', appKey: String(appKey || '').slice(0, 80) });
}

async function runApprovedApplicationAction(type, appKey) {
  await ensureNativeStorageReady();
  if (!nativeAvailable) return { ok: false, error: 'Native host not available' };
  const allowed = new Set(['LAUNCH_APPROVED_APPLICATION', 'REVEAL_APPROVED_APPLICATION', 'FORGET_APPROVED_APPLICATION']);
  if (!allowed.has(type)) return { ok: false, error: 'Unsupported application action' };
  const message = { type, appKey: String(appKey || '').slice(0, 80) };
  // Firefox tears down the process created for sendNativeMessage immediately
  // after its reply. On Windows that process can own launched children, making
  // an application appear for a moment and then vanish. Keep launches on the
  // long-lived native port so the child survives the response lifecycle.
  return type === 'LAUNCH_APPROVED_APPLICATION'
    ? sendPersistentNativeMessage(message)
    : sendNativeRequest(message);
}

async function getEmuGuiStatus() {
  await ensureNativeStorageReady();
  if (!nativeAvailable) return { ok: false, error: 'Native host not available' };
  return sendPersistentNativeMessage({ type: 'EMUGUI_STATUS' }, EMUGUI_REQUEST_TIMEOUT_MS);
}

async function createEmuGuiHubBinding(gameId, emulatorId, profileId) {
  await ensureNativeStorageReady();
  if (!nativeAvailable) return { ok: false, error: 'Native host not available' };
  return sendPersistentNativeMessage({
    type: 'EMUGUI_CREATE_HUB_BINDING',
    gameId: String(gameId || '').slice(0, 120),
    emulatorId: String(emulatorId || '').slice(0, 120),
    profileId: String(profileId || '').slice(0, 120)
  }, EMUGUI_REQUEST_TIMEOUT_MS);
}

async function sendEmuGuiGameToHub(message) {
  const rebindGameKey = String(message.rebindGameKey || '').slice(0, 80);
  const binding = rebindGameKey
    ? await sendPersistentNativeMessage({
        type: 'REBIND_GAME',
        gameKey: rebindGameKey,
        gameId: String(message.gameId || '').slice(0, 120),
        emulatorId: String(message.emulatorId || '').slice(0, 120),
        profileId: String(message.profileId || '').slice(0, 120)
      }, EMUGUI_REQUEST_TIMEOUT_MS)
    : await createEmuGuiHubBinding(message.gameId, message.emulatorId, message.profileId);
  if (binding?.ok === false || !binding?.game) throw new Error(binding?.error || 'EmuGUI could not create the game binding');
  const deliveryId = message.deliveryId || makeDeliveryId('game');
  const delivered = await sendToMorpheus({
    type: rebindGameKey ? 'MW_UPDATE_GAME_BINDING' : 'MW_RECEIVE_GAME',
    deliveryId,
    targetBoardId: message.targetBoardId || '',
    targetTabId: message.targetTabId || '',
    game: binding.game
  });
  if (!delivered?.ok) throw new Error(delivered?.error || 'The Hub rejected the game shortcut');
  return { ...delivered, ok: true, deliveryId, game: binding.game };
}

async function getGameStatus(gameKey, includeThumbnail = false) {
  await ensureNativeStorageReady();
  if (!nativeAvailable) return { ok: false, error: 'Native host not available' };
  return sendPersistentNativeMessage(
    { type: 'GAME_STATUS', gameKey: String(gameKey || '').slice(0, 80), includeThumbnail: includeThumbnail === true },
    EMUGUI_REQUEST_TIMEOUT_MS
  );
}

async function runGameAction(type, gameKey) {
  await ensureNativeStorageReady();
  if (!nativeAvailable) return { ok: false, error: 'Native host not available' };
  if (!['LAUNCH_GAME', 'REVEAL_GAME', 'FORGET_GAME'].includes(type)) return { ok: false, error: 'Unsupported game action' };
  const request = { type, gameKey: String(gameKey || '').slice(0, 80) };
  return sendPersistentNativeMessage(request, EMUGUI_REQUEST_TIMEOUT_MS);
}

async function runEmuGuiPageRpc(message) {
  await ensureNativeStorageReady();
  if (!nativeAvailable) return { ok: false, error: 'Native host not available' };
  return sendPersistentNativeMessage({
    type: 'EMUGUI_API',
    method: String(message.method || '').slice(0, 8),
    path: String(message.path || '').slice(0, 96),
    query: message.query && typeof message.query === 'object' ? message.query : {},
    body: message.body && typeof message.body === 'object' ? message.body : {}
  }, EMUGUI_REQUEST_TIMEOUT_MS);
}

async function loadEmuGuiPageAsset(path) {
  await ensureNativeStorageReady();
  if (!nativeAvailable) return { ok: false, error: 'Native host not available' };
  return sendPersistentNativeMessage({ type: 'EMUGUI_ASSET', path: String(path || '').slice(0, 2048) }, EMUGUI_REQUEST_TIMEOUT_MS);
}

async function openGameInEmuGui(gameKey, rebind = false) {
  await ensureNativeStorageReady();
  if (!nativeAvailable) return { ok: false, error: 'Native host not available' };
  const result = await sendPersistentNativeMessage({
    type: 'OPEN_GAME_IN_EMUGUI',
    gameKey: String(gameKey || '').slice(0, 80),
    rebind: rebind === true
  }, EMUGUI_REQUEST_TIMEOUT_MS);
  if (result?.ok === false) return result;
  let target;
  try {
    target = new URL(String(result?.url || ''));
  } catch {
    return { ok: false, error: 'EmuGUI returned an invalid page address' };
  }
  const localHttpTarget = target.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(target.hostname)
    && target.port === '8765' && target.pathname === '/';
  const localFileTarget = target.protocol === 'file:' && /\/web\/index\.html$/i.test(target.pathname);
  if (!localHttpTarget && !localFileTarget) {
    return { ok: false, error: 'EmuGUI returned an unsupported page address' };
  }
  const tabs = await browser.tabs.query({});
  const existing = (tabs || []).find(tab => {
    try {
      const url = new URL(tab.url || '');
      if (target.protocol === 'file:') return url.protocol === 'file:' && url.pathname.toLowerCase() === target.pathname.toLowerCase();
      return url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname) && url.port === '8765';
    } catch { return false; }
  });
  if (existing) {
    await browser.tabs.update(existing.id, { url: target.href, active: true });
    if (existing.windowId != null && browser.windows?.update) await browser.windows.update(existing.windowId, { focused: true });
  } else {
    await browser.tabs.create({ url: target.href, active: true });
  }
  return { ok: true };
}


// ---------------------------------------------------------------------------
// Save — correlated native FIFO + storage.local fallback
// ---------------------------------------------------------------------------

async function writeNativeSnapshot(content, expectedVersion = null, expectedHash = '', databasePath = saveFilePath) {
  try {
    const res = await sendNativeRequest({
      type: 'WRITE_FILE_IF_UNCHANGED',
      path: databasePath,
      content,
      expectedVersion,
      expectedHash: expectedHash || ''
    });
    return {
      ok: res?.ok !== false,
      conflict: res?.conflict === true,
      fileInfo: res?.fileInfo || null,
      databasePath: databasePath || null
    };
  } catch (e) {
    console.warn('Morpheus: native write failed', e);
    return {
      ok: false,
      error: e.message,
      conflict: false,
      fileInfo: null,
      databasePath: databasePath || null
    };
  }
}

function scheduleNativeSave(content, expectedVersion = null, expectedHash = '', databasePath = saveFilePath) {
  return new Promise(resolve => {
    nativeSaveQueue.push({ content, expectedVersion, expectedHash, databasePath, resolve });
    void drainNativeSaveQueue();
  });
}

async function drainNativeSaveQueue() {
  if (nativeSaveQueueRunning) return;
  nativeSaveQueueRunning = true;
  try {
    while (nativeSaveQueue.length) {
      const request = nativeSaveQueue.shift();
      const result = await writeNativeSnapshot(
        request.content,
        request.expectedVersion,
        request.expectedHash,
        request.databasePath
      );
      request.resolve(result);
    }
  } finally {
    nativeSaveQueueRunning = false;
  }
}

async function saveState(json, { expectedVersion = null, expectedHash = '' } = {}) {
  await ensureNativeStorageReady();
  const jsonPath = extractDatabasePath(json);
  if (jsonPath && jsonPath !== saveFilePath) await setDatabasePath(jsonPath);
  let mirrored = false;
  let mirrorError = null;
  const canWriteDisk = nativeAvailable && saveFilePath;

  // Extension storage is only a fallback for setups without native disk storage.
  // Large hubs can exceed browser quota, so disk-backed saves keep the JSON file
  // as the single authoritative database and clear any old full-size mirror.
  if (canWriteDisk) {
    try {
      await browser.storage.local.remove('morpheusState');
    } catch (e) {
      console.warn('Morpheus: extension storage mirror cleanup failed', e);
    }
  } else {
    try {
      await browser.storage.local.set({ morpheusState: json });
      mirrored = true;
    } catch (e) {
      mirrorError = e;
      console.warn('Morpheus: extension storage mirror failed', e);
    }
  }

  // Write to disk via the extension-wide FIFO. Page-side state already
  // debounces rapid edits, so coalescing again here would break cross-tab CAS.
  if (canWriteDisk) {
    const diskResult = await scheduleNativeSave(json, expectedVersion, expectedHash, saveFilePath);
    if (diskResult.ok || diskResult.conflict) return diskResult;
  }

  if (mirrored) return { ok: true, conflict: false, fileInfo: null, databasePath: saveFilePath || null };
  throw (mirrorError || new Error('No save target available'));
}


// ---------------------------------------------------------------------------
// Load — native file read first, storage.local fallback
// ---------------------------------------------------------------------------

async function loadState() {
  await ensureNativeStorageReady();
  if (nativeAvailable && saveFilePath) {
    try {
      const res = await readNativeFileChunked(saveFilePath);
      return {
        json: res.content || null,
        fileInfo: res.fileInfo || null,
        fromDisk: true,
        databasePath: saveFilePath || null
      };
    } catch (e) {
      console.warn('Morpheus: native read failed', e);
      // A configured shared file is authoritative. Returning extension-local
      // storage here can make a transient read failure look like an empty
      // shared database to the page.
      throw new Error(`Shared database read failed: ${e.message || e}`);
    }
  }
  // Extension storage is only authoritative when shared storage is not active.
  const stored = await browser.storage.local.get('morpheusState');
  return {
    json: stored.morpheusState || null,
    fileInfo: null,
    fromDisk: false,
    databasePath: saveFilePath || null
  };
}


// ---------------------------------------------------------------------------
// File picker — delegates to native host
// ---------------------------------------------------------------------------

async function openFilePicker(accept, title) {
  await ensureNativeStorageReady();
  if (!nativeAvailable) return { ok: false, error: 'Native host not available' };
  try {
    return await sendNativeRequest({
      type: 'OPEN_FILE_PICKER',
      accept,
      title
    });
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function pickDatabasePath(title, defaultName) {
  await ensureNativeStorageReady();
  if (!nativeAvailable) return { ok: false, error: 'Native host not available' };
  try {
    return await sendNativeRequest({
      type: 'SAVE_FILE_PICKER',
      accept: 'json',
      title,
      defaultName
    });
  } catch (e) {
    return { ok: false, error: e.message };
  }
}


// ---------------------------------------------------------------------------
// Message router
// ---------------------------------------------------------------------------

browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (HUB_PAGE_REQUEST_TYPES.has(msg?.type) && !authorizeHubPageRequest(msg, sender)) {
    sendResponse({ ok: false, error: 'This request is not authorized for the registered Hub page' });
    return false;
  }
  if (EMUGUI_PAGE_REQUEST_TYPES.has(msg?.type) && !authorizeEmuGuiPageRequest(msg, sender)) {
    sendResponse({ ok: false, error: 'This request is not authorized for Morpheus EmuGUI' });
    return false;
  }
  switch (msg.type) {

    case 'MW_PING':
      // Extension presence must not wait for native-host startup. The page asks
      // for authoritative storage info immediately after this handshake.
      if (sender.tab) rememberMorpheusTab(sender.tab, msg.pageUrl || sender.tab.url || '', {
        active: msg.active === true,
        sessionToken: msg.hubSessionToken || ''
      });
      sendResponse({ ok: true, version: browser.runtime.getManifest?.()?.version || '', ...getStorageInfo() });
      break;

    case 'MW_REGISTER':
      {
      const registration = rememberMorpheusTab(sender.tab, msg.pageUrl || sender.tab?.url || '', {
        active: msg.active === true
      });
      if (!registration) {
        sendResponse({ ok: false, error: 'Hub registration came from an unsupported page' });
        break;
      }
      sendResponse({ ok: true, hubSessionToken: registration.sessionToken, ...getStorageInfo() });
      break;
      }

    case 'MW_EMUGUI_REGISTER':
      registerEmuGuiPage(sender, msg.pageUrl)
        .then(sendResponse)
        .catch(error => sendResponse({ ok: false, error: error?.message || String(error) }));
      return true;

    case 'MW_GET_STATUS':
      if (!nativeAvailable) void ensureNativeStorageReady();
      ensureMorpheusTab()
        .then(tab => sendResponse({ ok: true, morpheusOpen: !!tab, ...getStorageInfo() }))
        .catch(error => sendResponse({
          ok: true,
          morpheusOpen: false,
          ...getStorageInfo(),
          hubRelayError: error?.message || String(error)
        }));
      return true;

    case 'MW_GET_STORAGE_INFO':
      ensureNativeStorageReady()
        .then(() => sendResponse({ ok: true, ...getStorageInfo() }))
        .catch(() => sendResponse({ ok: true, nativeAvailable: false, databasePath: null }));
      return true;

    case 'MW_NOTIFICATION_SCHEDULE':
      scheduleHubNotification(msg.job)
        .then(sendResponse)
        .catch(error => sendResponse({ ok: false, error: error?.message || 'Could not schedule notification' }));
      return true;

    case 'MW_NOTIFICATION_CANCEL':
      cancelHubNotification(msg.id)
        .then(sendResponse)
        .catch(error => sendResponse({ ok: false, error: error?.message || 'Could not cancel notification' }));
      return true;

    case 'MW_NOTIFICATION_LIST':
      listHubNotifications()
        .then(sendResponse)
        .catch(error => sendResponse({ ok: false, events: [], jobs: [], error: error?.message || 'Could not load notifications' }));
      return true;

    case 'MW_NOTIFICATION_MARK_READ':
      markHubNotificationsRead(msg.ids)
        .then(sendResponse)
        .catch(error => sendResponse({ ok: false, error: error?.message || 'Could not update notifications' }));
      return true;

    case 'MW_NOTIFICATION_CLEAR':
      clearHubNotifications()
        .then(sendResponse)
        .catch(error => sendResponse({ ok: false, error: error?.message || 'Could not clear notifications' }));
      return true;

    case 'MW_SET_DATABASE_PATH':
      setDatabasePath(msg.path || '')
        .then(ok => ok
          ? sendResponse({ ok: true, ...getStorageInfo() })
          : sendResponse({ ok: false, error: 'Failed to update database path' }))
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'MW_PICK_DATABASE_PATH':
      pickDatabasePath(msg.title || 'Choose shared database location', msg.defaultName || 'morpheus-webhub.json')
        .then(res => sendResponse(res))
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'MW_SAVE':
      saveState(msg.json, {
        expectedVersion: msg.expectedVersion ?? null,
        expectedHash: msg.expectedHash || ''
      })
        .then(result => sendResponse(result || { ok: true }))
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'MW_LOAD':
      loadState()
        .then(result => sendResponse({ ok: true, ...result }))
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'MW_LOAD_SHARED_CHUNK':
      loadSharedStateChunk(msg.offset, msg.length, msg.expectedVersion)
        .then(result => sendResponse({ ok: true, ...result }))
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'MW_GET_DATABASE_FILE_INFO':
      getDatabaseFileInfo()
        .then(result => sendResponse({ ok: true, ...result }))
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'MW_OPEN_FILE_PICKER':
      openFilePicker(msg.accept || '', msg.title || 'Select file')
        .then(res => sendResponse(res))
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'MW_BEGIN_ASSET_WRITE':
      beginAssetWrite(msg)
        .then(res => sendResponse(res))
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'MW_APPEND_ASSET_WRITE':
      appendAssetWriteChunk(msg.sessionId || '', msg.chunk || '')
        .then(res => sendResponse(res || { ok: true }))
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'MW_FINISH_ASSET_WRITE':
      finishAssetWrite(msg.sessionId || '')
        .then(res => sendResponse(res || { ok: true }))
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'MW_ABORT_ASSET_WRITE':
      abortAssetWrite(msg.sessionId || '')
        .then(res => sendResponse(res || { ok: true }))
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'MW_CACHE_ASSET_URL':
      cacheAssetUrl(msg)
        .then(res => sendResponse(res || { ok: true }))
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'MW_FETCH_FAVICON':
      fetchFavicon(msg)
        .then(res => sendResponse(res || { ok: false, error: 'No favicon found' }))
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'MW_FETCH_FEED':
      fetchFeedText(msg)
        .then(res => sendResponse(res || { ok: false, error: 'Feed request failed' }))
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'MW_FETCH_TRANSLATOR_ASSET_CHUNK':
      fetchTranslatorAssetChunk(msg)
        .then(res => sendResponse(res || { ok: false, error: 'Translation model download failed' }))
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'MW_FETCH_CALENDAR':
      fetchCalendarText(msg)
        .then(res => sendResponse(res || { ok: false, error: 'Calendar request failed' }))
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'MW_CHECK_URL':
      checkUrlHealth(msg)
        .then(res => sendResponse(res))
        .catch(e => sendResponse({ ok: true, reachable: false, status: 0, finalUrl: msg.url || '', error: e.message }));
      return true;

    case 'MW_MONITOR_SERVICE':
      monitorService(msg)
        .then(res => sendResponse(res))
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'MW_SYSTEM_METRICS':
      systemMetrics(msg.metrics)
        .then(res => sendResponse(res))
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'MW_APPROVE_DIRECTORY':
      approveDirectory(msg.purpose, msg.title).then(sendResponse).catch(e => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'MW_GIT_WORKSPACE_STATUS':
      gitWorkspaceStatus(msg.handle).then(sendResponse).catch(e => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'MW_OPEN_APPROVED_DIRECTORY':
      openApprovedDirectory(msg.handle, msg.purpose, msg.action).then(sendResponse).catch(e => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'MW_LIST_RECENT_FILES':
      listRecentFiles(msg).then(sendResponse).catch(e => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'MW_OPEN_APPROVED_FILE':
      openApprovedFile(msg.handle, msg.relativePath, msg.action).then(sendResponse).catch(e => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'MW_APPROVE_APPLICATION':
      approveApplication(msg.appKey, msg.title).then(sendResponse).catch(e => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'MW_APPROVE_APPLICATION_LINK':
      approveApplicationLink(msg.appKey, msg.title, msg.targetUri, msg.iconHint).then(sendResponse).catch(e => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'MW_GET_APPLICATION_STATUS':
      getApplicationStatus(msg.appKey).then(sendResponse).catch(e => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'MW_LAUNCH_APPROVED_APPLICATION':
      runApprovedApplicationAction('LAUNCH_APPROVED_APPLICATION', msg.appKey).then(sendResponse).catch(e => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'MW_REVEAL_APPROVED_APPLICATION':
      runApprovedApplicationAction('REVEAL_APPROVED_APPLICATION', msg.appKey).then(sendResponse).catch(e => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'MW_FORGET_APPROVED_APPLICATION':
      runApprovedApplicationAction('FORGET_APPROVED_APPLICATION', msg.appKey).then(sendResponse).catch(e => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'MW_EMUGUI_STATUS':
      getEmuGuiStatus().then(sendResponse).catch(e => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'MW_EMUGUI_SEND_GAME':
      sendEmuGuiGameToHub(msg).then(sendResponse).catch(e => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'MW_EMUGUI_RPC':
      runEmuGuiPageRpc(msg).then(sendResponse).catch(e => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'MW_EMUGUI_ASSET':
      loadEmuGuiPageAsset(msg.path).then(sendResponse).catch(e => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'MW_GET_GAME_STATUS':
      getGameStatus(msg.gameKey, msg.includeThumbnail === true).then(sendResponse).catch(e => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'MW_LAUNCH_GAME':
      runGameAction('LAUNCH_GAME', msg.gameKey).then(sendResponse).catch(e => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'MW_OPEN_GAME_IN_EMUGUI':
      openGameInEmuGui(msg.gameKey, msg.rebind === true).then(sendResponse).catch(e => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'MW_REVEAL_GAME':
      runGameAction('REVEAL_GAME', msg.gameKey).then(sendResponse).catch(e => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'MW_FORGET_GAME':
      runGameAction('FORGET_GAME', msg.gameKey).then(sendResponse).catch(e => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'MW_SECRET_STATUS':
      secretStatus()
        .then(res => sendResponse(res || { ok: true, available: false }))
        .catch(e => sendResponse({ ok: false, available: false, error: e.message }));
      return true;

    case 'MW_SECRET_GET':
      secretGet(msg.key || '')
        .then(res => sendResponse(res || { ok: true, value: '' }))
        .catch(e => sendResponse({ ok: false, value: '', error: e.message }));
      return true;

    case 'MW_SECRET_SET':
      secretSet(msg.key || '', msg.value || '')
        .then(res => sendResponse(res || { ok: true }))
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'MW_SECRET_DELETE':
      secretDelete(msg.key || '')
        .then(res => sendResponse(res || { ok: true }))
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'MW_SECRET_LIST':
      secretList()
        .then(res => sendResponse(res || { ok: true, keys: [] }))
        .catch(e => sendResponse({ ok: false, keys: [], error: e.message }));
      return true;

    case 'MW_CAPTURE_BROWSER_SESSION':
      captureBrowserSession(msg.scope || 'window')
        .then(sendResponse)
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'MW_LAUNCH_BROWSER_SESSION':
      launchBrowserSession(msg.tabs || [], { staggerMs: msg.staggerMs, recreateGroups: msg.recreateGroups })
        .then(sendResponse)
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'MW_LIST_DATABASE_BACKUPS':
      listDatabaseBackups()
        .then(sendResponse)
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'MW_READ_DATABASE_BACKUP':
      readDatabaseBackup(msg.name || '')
        .then(sendResponse)
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'MW_CREATE_DATABASE_BACKUP':
      createDatabaseBackup()
        .then(sendResponse)
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'MW_LIST_THEMES': {
      ensureNativeStorageReady()
        .then(() => {
          const dir = deriveThemesDir();
          if (!dir || !nativeAvailable) return sendResponse({ ok: true, themes: [] });
          return sendNativeRequest({ type: 'LIST_DIR', path: dir, ext: '.json' })
            .then(res => Promise.all((res?.files || []).map(async f => {
              try {
                const r = await sendNativeRequest({ type: 'READ_FILE', path: joinThemePath(f) });
                return (r?.ok && r.content) ? JSON.parse(r.content) : null;
              } catch { return null; }
            })))
            .then(themes => sendResponse({ ok: true, themes: themes.filter(Boolean) }));
        })
        .catch(() => sendResponse({ ok: true, themes: [] }));
      return true;
    }

    case 'MW_WRITE_THEME': {
      ensureNativeStorageReady()
        .then(() => {
          const theme = msg.theme;
          const themeId = theme?.id || 'custom';
          const path = joinThemePath(themeId + '.json');
          if (!path) return sendResponse({ ok: false, error: 'Theme ID must contain only letters, numbers, hyphens, or underscores' });
          if (!nativeAvailable) return sendResponse({ ok: false, error: 'Not available' });
          return sendNativeRequest({
            type: 'WRITE_THEME_FILE',
            themesDir: deriveThemesDir(),
            themeId,
            content: JSON.stringify(theme, null, 2)
          })
            .then(res => sendResponse(res || { ok: true }));
        })
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true;
    }

    case 'MW_SEND_TAB': {
      const deliveryId = msg.deliveryId || makeDeliveryId('tab');
      sendToMorpheus({
            type: 'MW_RECEIVE_TAB',
            deliveryId,
            targetBoardId: msg.targetBoardId || '',
            targetTabId: msg.targetTabId || '',
            url:   msg.url,
            title: msg.title,
            faviconCache: msg.faviconCache || ''
          })
        .then(result => sendResponse(result?.ok
          ? { ...result, ok: true, deliveryId }
          : { ok: false, conflict: result?.conflict === true, error: result?.error || 'The hub rejected the delivery' }))
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true;
      }

    case 'MW_GET_INBOX_TARGETS':
      sendToMorpheus({ type: 'MW_GET_INBOX_TARGETS' })
        .then(result => sendResponse(result?.ok
          ? result
          : { ok: false, boards: [], error: result?.error || 'The hub did not return any Inbox targets' }))
        .catch(e => sendResponse({ ok: false, boards: [], error: e.message }));
      return true;

    case 'MW_SEND_TAB_TO_IMPORT_MANAGER': {
      const item = tabToImportItem(msg);
      if (!item) {
        sendResponse({ ok: false, error: 'No tab URL to import' });
        break;
      }
      const deliveryId = msg.deliveryId || makeDeliveryId('import');
      sendImportItemsToMorpheus([item], 'popup', deliveryId)
        .then(result => sendResponse(result?.ok
          ? { ...result, ok: true, deliveryId }
          : { ok: false, conflict: result?.conflict === true, error: result?.error || 'The hub rejected the import' }))
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true;
    }

    default:
      break;
  }
});

function setupBookmarkImportMenu() {
  if (!browser.menus?.create) return;
  browser.menus.remove(MENU_IMPORT_BOOKMARK_ID)
    .catch(() => {})
    .then(() =>
      browser.menus.create({
        id: MENU_IMPORT_BOOKMARK_ID,
        title: 'Send to Morpheus Import Manager',
        contexts: ['bookmark']
      })
    )
    .catch(e => console.warn('Morpheus: failed to create bookmark import menu', e));
}

if (browser.menus?.onClicked) {
  setupBookmarkImportMenu();
  browser.menus.onClicked.addListener((info) => {
    if (info.menuItemId !== MENU_IMPORT_BOOKMARK_ID) return;
    importBookmarkNode(info.bookmarkId).catch(e => {
      console.warn('Morpheus: bookmark import failed', e);
    });
  });
}

if (browser.commands?.onCommand) {
  browser.commands.onCommand.addListener(command => {
    if (command !== 'open-command-palette') return;
    void ensureMorpheusTab()
      .then(async tab => {
        if (!tab) throw new Error('Morpheus WebHub is not open');
        if (browser.tabs.update) await browser.tabs.update(tab.id, { active: true }).catch(() => {});
        if (tab.windowId !== undefined && browser.windows?.update) {
          await browser.windows.update(tab.windowId, { focused: true }).catch(() => {});
        }
        return sendToMorpheus({ type: 'MW_OPEN_COMMAND_PALETTE' });
      })
      .catch(error => console.warn('Morpheus: command palette shortcut failed', error));
  });
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

browser.tabs.onRemoved.addListener(tabId => {
  if (hubRegistrations.has(tabId)) forgetMorpheusTab(tabId);
  emuguiRegistrations.delete(tabId);
});

if (browser.tabs.onUpdated) {
  browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    const registration = hubRegistrations.get(tabId);
    if (registration && changeInfo.url && changeInfo.url !== registration.url) {
      forgetMorpheusTab(tabId, 'The Hub tab navigated away');
    }
    if (changeInfo.status === 'complete' && isPotentialHubUrl(tab?.url || '')) {
      void discoverMorpheusTab(tab, { inject: true });
    }
  });
}

if (browser.tabs.onActivated) {
  browser.tabs.onActivated.addListener(({ tabId }) => {
    const now = Date.now();
    for (const [registeredTabId, registration] of hubRegistrations) {
      registration.active = registeredTabId === tabId;
      if (registration.active) registration.lastActiveAt = now;
    }
    selectRegisteredHub();
    if (typeof browser.tabs.get === 'function') {
      void browser.tabs.get(tabId).then(tab => {
        if (/^https?:\/\//i.test(tab?.url || '') && !isPotentialHubUrl(tab.url)) lastActiveWebTab = tab;
      }).catch(() => {});
    }
  });
}

// Content scripts are not retroactively attached when a temporary/reloaded
// extension starts while the Hub tab is already open. Rebuild the registry
// once at background startup; normal tab updates handle later navigations.
void ensureMorpheusTab();
