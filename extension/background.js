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
const IMAGE_ASSET_EXTENSIONS = new Set(['avif', 'bmp', 'gif', 'jpg', 'jpeg', 'png', 'svg', 'webp']);
const NATIVE_REQUEST_TIMEOUT_MS = 15000;
const NATIVE_RETRY_COOLDOWN_MS = 5000;


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
    activeRequest.timer = setTimeout(() => {
      const active = nativePortActiveRequest;
      const timedOutPort = nativePort;
      nativePortActiveRequest = null;
      nativePort = null;
      nativeAvailable = false;
      storageInfoReady = false;
      nativeError = `Native host request timed out after ${NATIVE_REQUEST_TIMEOUT_MS / 1000} seconds`;
      if (active) active.reject(new Error(nativeError));
      try { timedOutPort?.disconnect(); } catch {}
      pumpNativePortQueue();
    }, NATIVE_REQUEST_TIMEOUT_MS);
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

function sendPersistentNativeMessage(message) {
  if (typeof browser.runtime.connectNative !== 'function') {
    return sendNativeRequest(message);
  }
  return new Promise((resolve, reject) => {
    nativePortRequestQueue.push({ message, resolve, reject });
    pumpNativePortQueue();
  });
}

function sendNativeRequest(message, timeoutMs = NATIVE_REQUEST_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      nativeAvailable = false;
      storageInfoReady = false;
      nativeError = `Native host request timed out after ${timeoutMs / 1000} seconds`;
      reject(new Error(nativeError));
    }, timeoutMs);
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
    let path = decodeURIComponent(parsed.pathname || '');
    if (/^\/[a-zA-Z]:/.test(path)) path = path.slice(1);
    return path.replace(/\//g, '\\');
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

function rememberMorpheusTab(tab, pageUrl = '') {
  if (tab?.id === undefined) return false;
  const url = pageUrl || tab.url || '';
  if (!isPotentialHubUrl(url)) return false;
  morpheusTabId = tab.id;
  hubPageUrl = url;
  hubRelayError = '';
  hubRegisteredAt = Date.now();
  return true;
}

function forgetMorpheusTab(tabId = morpheusTabId, error = '') {
  if (tabId !== morpheusTabId) return;
  morpheusTabId = null;
  hubPageUrl = '';
  hubRegisteredAt = 0;
  hubRelayError = error || '';
}

async function discoverMorpheusTab(tab, { inject = false } = {}) {
  if (tab?.id === undefined || !isPotentialHubUrl(tab.url || '')) return false;
  const discover = async () => {
    try {
      const response = await browser.tabs.sendMessage(tab.id, { type: 'MW_DISCOVER' });
      if (response?.isMorpheus === true && response?.registered !== false) {
        rememberMorpheusTab(tab, response.pageUrl || tab.url || '');
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
    extensionId: browser.runtime.id || ''
  };
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
      path: saveFilePath
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

async function readNativeFileChunked(path) {
  let offset = 0;
  let totalSize = 0;
  let fileInfo = null;
  const chunks = [];

  while (true) {
    const res = await sendPersistentNativeMessage({
      type: 'READ_FILE_CHUNK',
      path,
      offset,
      length: DATABASE_READ_CHUNK_BYTES
    });
    if (!res?.ok) throw new Error(res?.error || 'Native chunk read failed');
    fileInfo = res.fileInfo ? { ...(fileInfo || {}), ...res.fileInfo } : fileInfo;
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

  return {
    content: decodeChunkedText(chunks, totalSize || chunks.reduce((sum, chunk) => sum + chunk.length, 0)),
    fileInfo
  };
}

async function loadSharedStateChunk(offset = 0, length = PAGE_DATABASE_READ_CHUNK_BYTES) {
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
    length: safeLength
  });
  if (!res?.ok) throw new Error(res?.error || 'Shared database chunk read failed');
  return {
    chunk: res.chunk || '',
    nextOffset: res.nextOffset ?? safeOffset,
    totalSize: res.totalSize ?? 0,
    done: res.done === true,
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
  switch (msg.type) {

    case 'MW_PING':
      // Extension presence must not wait for native-host startup. The page asks
      // for authoritative storage info immediately after this handshake.
      if (msg.morpheusPage === true && sender.tab) {
        rememberMorpheusTab(sender.tab, msg.pageUrl || sender.tab.url || '');
      }
      sendResponse({ ok: true, version: browser.runtime.getManifest?.()?.version || '', ...getStorageInfo() });
      break;

    case 'MW_REGISTER':
      if (!rememberMorpheusTab(sender.tab, msg.pageUrl || sender.tab?.url || '')) {
        sendResponse({ ok: false, error: 'Hub registration came from an unsupported page' });
        break;
      }
      sendResponse({ ok: true, ...getStorageInfo() });
      break;

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
      loadSharedStateChunk(msg.offset, msg.length)
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
          const path = joinThemePath((theme?.id || 'custom') + '.json');
          if (!path || !nativeAvailable) return sendResponse({ ok: false, error: 'Not available' });
          return sendNativeRequest({ type: 'WRITE_FILE', path, content: JSON.stringify(theme, null, 2) })
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

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

browser.tabs.onRemoved.addListener(tabId => {
  if (tabId === morpheusTabId) {
    forgetMorpheusTab(tabId);
  }
});

if (browser.tabs.onUpdated) {
  browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (tabId === morpheusTabId && changeInfo.url && changeInfo.url !== hubPageUrl) {
      forgetMorpheusTab(tabId, 'The Hub tab navigated away');
    }
    if (changeInfo.status === 'complete' && isPotentialHubUrl(tab?.url || '')) {
      void discoverMorpheusTab(tab, { inject: true });
    }
  });
}

// Content scripts are not retroactively attached when a temporary/reloaded
// extension starts while the Hub tab is already open. Rebuild the registry
// once at background startup; normal tab updates handle later navigations.
void ensureMorpheusTab();
