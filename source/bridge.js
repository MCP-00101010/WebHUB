// Bridge between the Morpheus WebHub page and the Firefox extension.
// When the extension is absent every method no-ops and the app continues
// using localStorage as normal.

const bridge = (() => {
  let _available = false;
  let _nativeAvailable = false;
  let _resolveReady;
  const whenReady = new Promise(r => { _resolveReady = r; });
  let _readyResolved = false;
  let _connectPromise = null;

  let _seq = 0;
  const _pending = new Map();

  function _send(type, payload = {}) {
    return new Promise((resolve, reject) => {
      const id = `mw-${++_seq}`;
      const timer = setTimeout(() => {
        _pending.delete(id);
        reject(new Error('timeout'));
      }, 3000);
      _pending.set(id, { resolve, reject, timer });
      window.postMessage({ _mw: true, _req: true, id, type, ...payload }, '*');
    });
  }

  function _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function _connect({ retries = 4, delayMs = 350 } = {}) {
    if (_connectPromise) return _connectPromise;
    _connectPromise = (async () => {
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          const res = await _send('MW_PING');
          _available = true;
          _nativeAvailable = res.nativeAvailable === true;
          return true;
        } catch {
          _available = false;
          _nativeAvailable = false;
          if (attempt < retries) await _sleep(delayMs);
        }
      }
      return false;
    })();

    try {
      return await _connectPromise;
    } finally {
      _connectPromise = null;
    }
  }

  window.addEventListener('message', e => {
    if (!e.data?._mw || e.source !== window) return;

    // Tab pushed from the extension popup.
    if (e.data._push && e.data.type === 'MW_RECEIVE_TAB') {
      window.dispatchEvent(new CustomEvent('morpheus:receive-tab', {
        detail: { url: e.data.url, title: e.data.title }
      }));
      return;
    }

    // Response to one of our _send() calls.
    if (!e.data._res) return;
    const handler = _pending.get(e.data.id);
    if (!handler) return;
    clearTimeout(handler.timer);
    _pending.delete(e.data.id);
    if (e.data.ok) handler.resolve(e.data);
    else handler.reject(new Error(e.data.error || 'bridge error'));
  });

  // Ping the extension; resolves whenReady.
  (async () => {
    await _connect();
    if (!_readyResolved) {
      _readyResolved = true;
      _resolveReady();
    }
  })();

  return {
    whenReady,
    isAvailable()       { return _available; },
    nativeIsAvailable() { return _nativeAvailable; },

    async getStorageInfo() {
      if (!_available) await _connect({ retries: 1, delayMs: 200 });
      if (!_available) return { nativeAvailable: false, databasePath: null };
      try {
        const res = await _send('MW_GET_STORAGE_INFO');
        return {
          nativeAvailable: res.nativeAvailable === true,
          databasePath: res.databasePath || null
        };
      } catch {
        return { nativeAvailable: false, databasePath: null };
      }
    },

    async saveState(json) {
      if (!_available) await _connect({ retries: 1, delayMs: 200 });
      if (!_available) return false;
      try { await _send('MW_SAVE', { json }); return true; }
      catch { return false; }
    },

    async loadState() {
      if (!_available) await _connect({ retries: 1, delayMs: 200 });
      if (!_available) return null;
      try { return (await _send('MW_LOAD')).json || null; }
      catch { return null; }
    },

    // Returns { name, dataUrl } or null (cancelled / unavailable).
    async openFilePicker(accept = '', title = 'Select file') {
      if (!_available) await _connect({ retries: 1, delayMs: 200 });
      if (!_available || !_nativeAvailable) return null;
      try {
        const res = await _send('MW_OPEN_FILE_PICKER', { accept, title });
        return res.ok && res.dataUrl ? { name: res.name, dataUrl: res.dataUrl, path: res.path } : null;
      } catch { return null; }
    },

    async pickDatabasePath(title = 'Choose shared database location', defaultName = 'morpheus-webhub.json') {
      if (!_available) await _connect({ retries: 1, delayMs: 200 });
      if (!_available || !_nativeAvailable) return null;
      try {
        const res = await _send('MW_PICK_DATABASE_PATH', { title, defaultName });
        if (res.ok && res.path) return { name: res.name, path: res.path };
        if (res.ok) return { name: res.name || '', path: '', error: res.error || '' };
        return { name: '', path: '', error: res.error || 'bridge error' };
      } catch { return null; }
    },

    async setDatabasePath(path) {
      if (!_available) await _connect({ retries: 1, delayMs: 200 });
      if (!_available) return null;
      try {
        const res = await _send('MW_SET_DATABASE_PATH', { path });
        return res.ok ? { nativeAvailable: res.nativeAvailable === true, databasePath: res.databasePath || null } : null;
      } catch { return null; }
    },

    // Returns array of theme objects from ./themes/ folder, or [] if unavailable.
    async listThemes() {
      if (!_available) await _connect({ retries: 1, delayMs: 200 });
      if (!_available || !_nativeAvailable) return [];
      try {
        const res = await _send('MW_LIST_THEMES');
        return Array.isArray(res.themes) ? res.themes : [];
      } catch { return []; }
    },

    // Writes theme JSON to ./themes/<theme.id>.json via native host.
    async saveTheme(theme) {
      if (!_available) await _connect({ retries: 1, delayMs: 200 });
      if (!_available || !_nativeAvailable) return false;
      try { await _send('MW_WRITE_THEME', { theme }); return true; }
      catch { return false; }
    }
  };
})();
