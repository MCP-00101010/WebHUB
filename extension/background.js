'use strict';

// Tab ID of the currently open Morpheus WebHub page.
let morpheusTabId = null;

// Shared database file path resolved via native host config.
let saveFilePath = null;

// Whether the native messaging host is reachable.
let nativeAvailable = false;
let nativeError = '';
let hubPageUrl = '';

// Debounce timer for file writes (avoid hammering disk on every save).
let saveTimer = null;
let pendingSaveContent = null;
let pendingSaveExpectedVersion = null;
let saveWaiters = [];
let assetWriteSessions = new Map();

const MENU_IMPORT_BOOKMARK_ID = 'morpheus-import-bookmark';
const DATABASE_READ_CHUNK_BYTES = 512 * 1024;
const ASSET_WRITE_CHUNK_CHARS = 512 * 1024;
const MAX_BACKGROUND_ASSET_DOWNLOAD_BYTES = 25 * 1024 * 1024;
const MAX_NATIVE_FAVICON_BYTES = 1024 * 1024;
const IMAGE_ASSET_EXTENSIONS = new Set(['avif', 'bmp', 'gif', 'jpg', 'jpeg', 'png', 'svg', 'webp']);


// ---------------------------------------------------------------------------
// Native host probe — called once on startup
// ---------------------------------------------------------------------------

async function probeNativeHost() {
  try {
    const res = await browser.runtime.sendNativeMessage('morpheus_webhub', { type: 'PING' });
    nativeAvailable = res?.ok === true;
    nativeError = nativeAvailable ? '' : 'Native host did not return ok';
  } catch (error) {
    nativeAvailable = false;
    nativeError = error?.message || String(error);
  }
}

const nativeProbePromise = probeNativeHost();
const hostConfigPromise = (async () => {
  await nativeProbePromise;
  if (!nativeAvailable) return;
  try {
    const res = await browser.runtime.sendNativeMessage('morpheus_webhub', { type: 'READ_CONFIG' });
    saveFilePath = normalizeDatabasePath(res?.config?.databasePath || '');
  } catch (error) {
    saveFilePath = null;
    nativeError = error?.message || String(error);
  }
})();


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
    databasePath: saveFilePath || null,
    nativeError: nativeAvailable ? '' : nativeError,
    extensionId: browser.runtime.id || ''
  };
}

async function writeHostConfig() {
  await nativeProbePromise;
  if (!nativeAvailable) return false;
  try {
    await browser.runtime.sendNativeMessage('morpheus_webhub', {
      type: 'WRITE_CONFIG',
      config: { databasePath: saveFilePath || '' }
    });
    return true;
  } catch {
    return false;
  }
}

async function setDatabasePath(path) {
  await hostConfigPromise;
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

async function sendImportItemsToMorpheus(items, source = '') {
  if (morpheusTabId === null) throw new Error('Morpheus WebHub is not open');
  await browser.tabs.sendMessage(morpheusTabId, {
    type: 'MW_RECEIVE_IMPORT_ITEMS',
    items: items || [],
    source
  });
}

async function importBookmarkNode(bookmarkId) {
  if (!bookmarkId) throw new Error('No bookmark was selected');
  const roots = await browser.bookmarks.getSubTree(bookmarkId);
  const items = roots.map(bookmarkNodeToImportItem).filter(Boolean);
  if (!items.length) throw new Error('No bookmarks found');
  await sendImportItemsToMorpheus(items, 'bookmarks-menu');
}

async function getDatabaseFileInfo() {
  await nativeProbePromise;
  await hostConfigPromise;
  if (!nativeAvailable || !saveFilePath) {
    return {
      databasePath: saveFilePath || null,
      fileInfo: null
    };
  }
  try {
    const res = await browser.runtime.sendNativeMessage('morpheus_webhub', {
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
    const res = await browser.runtime.sendNativeMessage('morpheus_webhub', {
      type: 'READ_FILE_CHUNK',
      path,
      offset,
      length: DATABASE_READ_CHUNK_BYTES
    });
    if (!res?.ok) throw new Error(res?.error || 'Native chunk read failed');
    fileInfo = res.fileInfo || fileInfo;
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

async function beginAssetWrite(options = {}) {
  await nativeProbePromise;
  await hostConfigPromise;
  if (!nativeAvailable) return { ok: false, error: 'Native host not available' };
  const session = createAssetWriteSession(options);
  const res = await browser.runtime.sendNativeMessage('morpheus_webhub', {
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
  return browser.runtime.sendNativeMessage('morpheus_webhub', {
    type: 'APPEND_FILE_CHUNK',
    tempPath: session.tempPath,
    chunk: chunk || ''
  });
}

async function finishAssetWrite(sessionId) {
  const session = assetWriteSessions.get(sessionId);
  if (!session) return { ok: false, error: 'Unknown asset write session' };
  try {
    const res = await browser.runtime.sendNativeMessage('morpheus_webhub', {
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
  return browser.runtime.sendNativeMessage('morpheus_webhub', {
    type: 'DELETE_FILE',
    path: session.tempPath
  });
}

async function cacheAssetUrl(options = {}) {
  await nativeProbePromise;
  await hostConfigPromise;
  if (!nativeAvailable) return { ok: false, error: 'Native host not available' };
  const url = typeof options.url === 'string' ? options.url.trim() : '';
  if (!/^https?:\/\//i.test(url)) return { ok: false, error: 'Only http and https URLs can be cached' };
  const session = createAssetWriteSession({
    kind: options.kind || 'background',
    collectionName: options.collectionName || '',
    itemName: options.itemName || '',
    extension: options.extension || assetExtensionFromUrl(url)
  });
  const res = await browser.runtime.sendNativeMessage('morpheus_webhub', {
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
  await nativeProbePromise;
  if (!nativeAvailable) return { ok: false, error: 'Native host not available' };
  const url = typeof options.url === 'string' ? options.url.trim() : '';
  if (!/^https?:\/\//i.test(url)) return { ok: false, error: 'Only http and https URLs support native favicon fetch' };
  return browser.runtime.sendNativeMessage('morpheus_webhub', {
    type: 'FETCH_FAVICON',
    url,
    maxBytes: options.maxBytes || MAX_NATIVE_FAVICON_BYTES
  });
}

async function secretStatus() {
  await nativeProbePromise;
  if (!nativeAvailable) return { ok: true, available: false, provider: '', error: nativeError || 'Native host not available' };
  return browser.runtime.sendNativeMessage('morpheus_webhub', { type: 'SECRET_STATUS' });
}

async function secretGet(key) {
  await nativeProbePromise;
  if (!nativeAvailable) return { ok: false, error: 'Native host not available', value: '' };
  return browser.runtime.sendNativeMessage('morpheus_webhub', { type: 'SECRET_GET', key });
}

async function secretSet(key, value) {
  await nativeProbePromise;
  if (!nativeAvailable) return { ok: false, error: 'Native host not available' };
  return browser.runtime.sendNativeMessage('morpheus_webhub', { type: 'SECRET_SET', key, value });
}

async function secretDelete(key) {
  await nativeProbePromise;
  if (!nativeAvailable) return { ok: false, error: 'Native host not available' };
  return browser.runtime.sendNativeMessage('morpheus_webhub', { type: 'SECRET_DELETE', key });
}

async function secretList() {
  await nativeProbePromise;
  if (!nativeAvailable) return { ok: true, keys: [] };
  return browser.runtime.sendNativeMessage('morpheus_webhub', { type: 'SECRET_LIST' });
}


// ---------------------------------------------------------------------------
// Save — native file write (debounced) + storage.local mirror
// ---------------------------------------------------------------------------

async function flushPendingSave() {
  const content = pendingSaveContent;
  const expectedVersion = pendingSaveExpectedVersion;
  pendingSaveContent = null;
  pendingSaveExpectedVersion = null;
  try {
    const res = await browser.runtime.sendNativeMessage('morpheus_webhub', {
      type: 'WRITE_FILE_IF_UNCHANGED',
      path: saveFilePath,
      content,
      expectedVersion
    });
    return {
      ok: res?.ok !== false,
      conflict: res?.conflict === true,
      fileInfo: res?.fileInfo || null,
      databasePath: saveFilePath || null
    };
  } catch (e) {
    console.warn('Morpheus: native write failed', e);
    return {
      ok: false,
      error: e.message,
      conflict: false,
      fileInfo: null,
      databasePath: saveFilePath || null
    };
  }
}

function scheduleNativeSave(content, expectedVersion = null) {
  pendingSaveContent = content;
  pendingSaveExpectedVersion = expectedVersion ?? null;
  clearTimeout(saveTimer);
  return new Promise(resolve => {
    saveWaiters.push(resolve);
    saveTimer = setTimeout(async () => {
      const result = await flushPendingSave();
      const waiters = saveWaiters.splice(0);
      for (const waiter of waiters) waiter(result);
    }, 800);
  });
}

async function saveState(json, { expectedVersion = null } = {}) {
  await nativeProbePromise;
  await hostConfigPromise;
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

  // Write to disk via native host (debounced).
  if (canWriteDisk) {
    const diskResult = await scheduleNativeSave(json, expectedVersion);
    if (diskResult.ok || diskResult.conflict) return diskResult;
  }

  if (mirrored) return { ok: true, conflict: false, fileInfo: null, databasePath: saveFilePath || null };
  throw (mirrorError || new Error('No save target available'));
}


// ---------------------------------------------------------------------------
// Load — native file read first, storage.local fallback
// ---------------------------------------------------------------------------

async function loadState() {
  await nativeProbePromise;
  await hostConfigPromise;
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
    }
  }
  // Fall back to extension storage.
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
  await nativeProbePromise;
  if (!nativeAvailable) return { ok: false, error: 'Native host not available' };
  try {
    return await browser.runtime.sendNativeMessage('morpheus_webhub', {
      type: 'OPEN_FILE_PICKER',
      accept,
      title
    });
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function pickDatabasePath(title, defaultName) {
  await nativeProbePromise;
  if (!nativeAvailable) return { ok: false, error: 'Native host not available' };
  try {
    return await browser.runtime.sendNativeMessage('morpheus_webhub', {
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
      nativeProbePromise
        .then(() => hostConfigPromise)
        .then(() => sendResponse({ ok: true, version: '1.0', ...getStorageInfo() }))
        .catch(() => sendResponse({ ok: true, version: '1.0', nativeAvailable: false, databasePath: null }));
      return true;

    case 'MW_REGISTER':
      morpheusTabId = sender.tab.id;
      hubPageUrl = msg.pageUrl || sender.tab.url || hubPageUrl || '';
      nativeProbePromise
        .then(() => hostConfigPromise)
        .then(() => sendResponse({ ok: true, ...getStorageInfo() }))
        .catch(() => sendResponse({ ok: true, nativeAvailable: false, databasePath: null }));
      return true;

    case 'MW_GET_STATUS':
      nativeProbePromise
        .then(() => hostConfigPromise)
        .then(() => sendResponse({ ok: true, morpheusOpen: morpheusTabId !== null, ...getStorageInfo() }))
        .catch(() => sendResponse({ ok: true, morpheusOpen: morpheusTabId !== null, nativeAvailable: false, databasePath: null }));
      return true;

    case 'MW_GET_STORAGE_INFO':
      nativeProbePromise
        .then(() => hostConfigPromise)
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
      saveState(msg.json, { expectedVersion: msg.expectedVersion ?? null })
        .then(result => sendResponse(result || { ok: true }))
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'MW_LOAD':
      loadState()
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
      nativeProbePromise
        .then(() => hostConfigPromise)
        .then(() => {
          const dir = deriveThemesDir();
          if (!dir || !nativeAvailable) return sendResponse({ ok: true, themes: [] });
          return browser.runtime.sendNativeMessage('morpheus_webhub', { type: 'LIST_DIR', path: dir, ext: '.json' })
            .then(res => Promise.all((res?.files || []).map(async f => {
              try {
                const r = await browser.runtime.sendNativeMessage('morpheus_webhub',
                  { type: 'READ_FILE', path: joinThemePath(f) });
                return (r?.ok && r.content) ? JSON.parse(r.content) : null;
              } catch { return null; }
            })))
            .then(themes => sendResponse({ ok: true, themes: themes.filter(Boolean) }));
        })
        .catch(() => sendResponse({ ok: true, themes: [] }));
      return true;
    }

    case 'MW_WRITE_THEME': {
      nativeProbePromise
        .then(() => hostConfigPromise)
        .then(() => {
          const theme = msg.theme;
          const path = joinThemePath((theme?.id || 'custom') + '.json');
          if (!path || !nativeAvailable) return sendResponse({ ok: false, error: 'Not available' });
          return browser.runtime.sendNativeMessage('morpheus_webhub',
            { type: 'WRITE_FILE', path, content: JSON.stringify(theme, null, 2) })
            .then(res => sendResponse(res || { ok: true }));
        })
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true;
    }

    case 'MW_SEND_TAB':
      if (morpheusTabId === null) {
        sendResponse({ ok: false, error: 'Morpheus WebHub is not open' });
        break;
      }
      browser.tabs.sendMessage(morpheusTabId, {
        type: 'MW_RECEIVE_TAB',
        url:   msg.url,
        title: msg.title,
        faviconCache: msg.faviconCache || ''
      })
        .then(() => sendResponse({ ok: true }))
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'MW_SEND_TAB_TO_IMPORT_MANAGER': {
      const item = tabToImportItem(msg);
      if (!item) {
        sendResponse({ ok: false, error: 'No tab URL to import' });
        break;
      }
      sendImportItemsToMorpheus([item], 'popup')
        .then(() => sendResponse({ ok: true }))
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
    morpheusTabId = null;
  }
});
