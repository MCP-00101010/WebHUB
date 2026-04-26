'use strict';

// Tab ID of the currently open Morpheus WebHub page.
let morpheusTabId = null;

// Shared database file path resolved via native host config.
let saveFilePath = null;

// Whether the native messaging host is reachable.
let nativeAvailable = false;

// Debounce timer for file writes (avoid hammering disk on every save).
let saveTimer = null;
let pendingSaveContent = null;
let pendingSaveExpectedVersion = null;
let saveWaiters = [];


// ---------------------------------------------------------------------------
// Native host probe — called once on startup
// ---------------------------------------------------------------------------

async function probeNativeHost() {
  try {
    const res = await browser.runtime.sendNativeMessage('morpheus_webhub', { type: 'PING' });
    nativeAvailable = res?.ok === true;
  } catch {
    nativeAvailable = false;
  }
}

const nativeProbePromise = probeNativeHost();
const hostConfigPromise = (async () => {
  await nativeProbePromise;
  if (!nativeAvailable) return;
  try {
    const res = await browser.runtime.sendNativeMessage('morpheus_webhub', { type: 'READ_CONFIG' });
    saveFilePath = normalizeDatabasePath(res?.config?.databasePath || '');
  } catch {
    saveFilePath = null;
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

function normalizeDatabasePath(path) {
  const trimmed = typeof path === 'string' ? path.trim() : '';
  return trimmed || null;
}

function getStorageInfo() {
  return {
    nativeAvailable,
    databasePath: saveFilePath || null
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

  // Mirror to extension storage when possible, but do not let quota pressure
  // block the primary shared-file save path.
  try {
    await browser.storage.local.set({ morpheusState: json });
    mirrored = true;
  } catch (e) {
    mirrorError = e;
    console.warn('Morpheus: extension storage mirror failed', e);
  }

  // Write to disk via native host (debounced).
  if (nativeAvailable && saveFilePath) {
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
      const res = await browser.runtime.sendNativeMessage('morpheus_webhub', {
        type: 'READ_FILE',
        path: saveFilePath
      });
      if (res?.ok) {
        return {
          json: res.content || null,
          fileInfo: res.fileInfo || null,
          fromDisk: true,
          databasePath: saveFilePath || null
        };
      }
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
        title: msg.title
      })
        .then(() => sendResponse({ ok: true }))
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true;

    default:
      break;
  }
});


// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

browser.tabs.onRemoved.addListener(tabId => {
  if (tabId === morpheusTabId) {
    morpheusTabId = null;
  }
});
