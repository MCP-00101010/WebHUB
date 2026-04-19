'use strict';

// Tab ID of the currently open Morpheus WebHub page.
let morpheusTabId = null;

// File path derived from the morpheus page URL (e.g. C:/…/morpheus-webhub.json).
let saveFilePath = null;

// Whether the native messaging host is reachable.
let nativeAvailable = false;

// Debounce timer for file writes (avoid hammering disk on every save).
let saveTimer = null;
let pendingSaveContent = null;


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

probeNativeHost();


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

function deriveFilePath(pageUrl) {
  // Convert file:///C:/foo/index.html  →  C:/foo/morpheus-webhub.json
  // Convert file:///home/user/foo/index.html  →  /home/user/foo/morpheus-webhub.json
  try {
    let path = decodeURIComponent(pageUrl.replace(/^file:\/\/\//, '').replace(/^file:\/\//, ''));
    // On Windows the path starts with a drive letter (C:/…) — correct already.
    // On Linux/Mac it starts with / — re-add it.
    if (!path.match(/^[A-Za-z]:/)) path = '/' + path;
    return path.replace(/[^/\\]*$/, 'morpheus-webhub.json');
  } catch {
    return null;
  }
}


// ---------------------------------------------------------------------------
// Save — native file write (debounced) + storage.local mirror
// ---------------------------------------------------------------------------

async function saveState(json) {
  // Always mirror to extension storage (fast, no debounce needed).
  await browser.storage.local.set({ morpheusState: json });

  // Write to disk via native host (debounced).
  if (nativeAvailable && saveFilePath) {
    pendingSaveContent = json;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      const content = pendingSaveContent;
      pendingSaveContent = null;
      try {
        await browser.runtime.sendNativeMessage('morpheus_webhub', {
          type: 'WRITE_FILE',
          path: saveFilePath,
          content
        });
      } catch (e) {
        console.warn('Morpheus: native write failed', e);
      }
    }, 800);
  }
}


// ---------------------------------------------------------------------------
// Load — native file read first, storage.local fallback
// ---------------------------------------------------------------------------

async function loadState() {
  if (nativeAvailable && saveFilePath) {
    try {
      const res = await browser.runtime.sendNativeMessage('morpheus_webhub', {
        type: 'READ_FILE',
        path: saveFilePath
      });
      if (res?.ok && res.content) return res.content;
    } catch (e) {
      console.warn('Morpheus: native read failed', e);
    }
  }
  // Fall back to extension storage.
  const stored = await browser.storage.local.get('morpheusState');
  return stored.morpheusState || null;
}


// ---------------------------------------------------------------------------
// File picker — delegates to native host
// ---------------------------------------------------------------------------

async function openFilePicker(accept, title) {
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


// ---------------------------------------------------------------------------
// Message router
// ---------------------------------------------------------------------------

browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {

    case 'MW_REGISTER':
      morpheusTabId = sender.tab.id;
      saveFilePath  = deriveFilePath(msg.pageUrl);
      sendResponse({ ok: true, nativeAvailable });
      break;

    case 'MW_GET_STATUS':
      sendResponse({ ok: true, morpheusOpen: morpheusTabId !== null, nativeAvailable });
      break;

    case 'MW_SAVE':
      saveState(msg.json)
        .then(() => sendResponse({ ok: true }))
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'MW_LOAD':
      loadState()
        .then(json => sendResponse({ ok: true, json }))
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'MW_OPEN_FILE_PICKER':
      openFilePicker(msg.accept || '', msg.title || 'Select file')
        .then(res => sendResponse(res))
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'MW_LIST_THEMES': {
      const dir = deriveThemesDir();
      if (!dir || !nativeAvailable) { sendResponse({ ok: true, themes: [] }); break; }
      browser.runtime.sendNativeMessage('morpheus_webhub', { type: 'LIST_DIR', path: dir, ext: '.json' })
        .then(res => Promise.all((res?.files || []).map(async f => {
          try {
            const r = await browser.runtime.sendNativeMessage('morpheus_webhub',
              { type: 'READ_FILE', path: joinThemePath(f) });
            return (r?.ok && r.content) ? JSON.parse(r.content) : null;
          } catch { return null; }
        })))
        .then(themes => sendResponse({ ok: true, themes: themes.filter(Boolean) }))
        .catch(() => sendResponse({ ok: true, themes: [] }));
      return true;
    }

    case 'MW_WRITE_THEME': {
      const theme = msg.theme;
      const path = joinThemePath((theme?.id || 'custom') + '.json');
      if (!path || !nativeAvailable) { sendResponse({ ok: false, error: 'Not available' }); break; }
      browser.runtime.sendNativeMessage('morpheus_webhub',
        { type: 'WRITE_FILE', path, content: JSON.stringify(theme, null, 2) })
        .then(res => sendResponse(res || { ok: true }))
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
    saveFilePath  = null;
  }
});
