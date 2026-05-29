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
  const DEFAULT_TIMEOUT_MS = 5000;
  const LARGE_PAYLOAD_TIMEOUT_MS = 60000;
  const ASSET_WRITE_TIMEOUT_MS = 60000;
  const FAVICON_FETCH_TIMEOUT_MS = 30000;

  function _send(type, payload = {}, options = {}) {
    return new Promise((resolve, reject) => {
      const id = `mw-${++_seq}`;
      const timer = setTimeout(() => {
        _pending.delete(id);
        reject(new Error('timeout'));
      }, options.timeoutMs || DEFAULT_TIMEOUT_MS);
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
        detail: { url: e.data.url, title: e.data.title, faviconCache: e.data.faviconCache || '' }
      }));
      return;
    }
    if (e.data._push && e.data.type === 'MW_RECEIVE_IMPORT_ITEMS') {
      window.dispatchEvent(new CustomEvent('morpheus:receive-import-items', {
        detail: { items: e.data.items || [], source: e.data.source || '' }
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
        _available = true;
        _nativeAvailable = res.nativeAvailable === true;
        return {
          nativeAvailable: res.nativeAvailable === true,
          databasePath: res.databasePath || null
        };
      } catch {
        _available = false;
        _nativeAvailable = false;
        return { nativeAvailable: false, databasePath: null };
      }
    },

    async saveState(json, options = {}) {
      if (!_available) await _connect({ retries: 1, delayMs: 200 });
      if (!_available) return { ok: false, conflict: false, fileInfo: null, databasePath: null };
      try {
        const res = await _send('MW_SAVE', {
          json,
          expectedVersion: options.expectedVersion ?? null
        }, { timeoutMs: LARGE_PAYLOAD_TIMEOUT_MS });
        _available = true;
        return {
          ok: res.ok !== false,
          conflict: res.conflict === true,
          fileInfo: res.fileInfo || null,
          databasePath: res.databasePath || null
        };
      } catch {
        _available = false;
        _nativeAvailable = false;
        return { ok: false, conflict: false, fileInfo: null, databasePath: null };
      }
    },

    async loadState() {
      if (!_available) await _connect({ retries: 1, delayMs: 200 });
      if (!_available) return { json: null, fileInfo: null, fromDisk: false, databasePath: null };
      try {
        const res = await _send('MW_LOAD', {}, { timeoutMs: LARGE_PAYLOAD_TIMEOUT_MS });
        _available = true;
        return {
          json: res.json || null,
          fileInfo: res.fileInfo || null,
          fromDisk: res.fromDisk === true,
          databasePath: res.databasePath || null
        };
      } catch {
        _available = false;
        _nativeAvailable = false;
        return { json: null, fileInfo: null, fromDisk: false, databasePath: null };
      }
    },

    async getDatabaseFileInfo() {
      if (!_available) await _connect({ retries: 1, delayMs: 200 });
      if (!_available || !_nativeAvailable) return { databasePath: null, fileInfo: null };
      try {
        const res = await _send('MW_GET_DATABASE_FILE_INFO');
        _available = true;
        return {
          databasePath: res.databasePath || null,
          fileInfo: res.fileInfo || null
        };
      } catch {
        _available = false;
        _nativeAvailable = false;
        return { databasePath: null, fileInfo: null };
      }
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

    async saveAssetDataUrl(options = {}) {
      if (!_available) await _connect({ retries: 1, delayMs: 200 });
      if (!_available || !_nativeAvailable) return null;
      const dataUrl = typeof options.dataUrl === 'string' ? options.dataUrl : '';
      const commaIndex = dataUrl.indexOf(',');
      const meta = commaIndex >= 0 ? dataUrl.slice(0, commaIndex) : '';
      const base64 = commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : '';
      if (!/^data:[^;]+;base64/i.test(meta) || !base64) return null;
      let sessionId = '';
      try {
        const begin = await _send('MW_BEGIN_ASSET_WRITE', {
          kind: options.kind || 'background',
          collectionName: options.collectionName || '',
          itemName: options.itemName || '',
          extension: options.extension || 'webp',
          mimeType: options.mimeType || ''
        }, { timeoutMs: ASSET_WRITE_TIMEOUT_MS });
        if (!begin.ok || !begin.sessionId) throw new Error(begin.error || 'asset write failed');
        sessionId = begin.sessionId;
        const chunkChars = Math.max(4, begin.chunkChars || 512 * 1024);
        const alignedChunkChars = chunkChars - (chunkChars % 4);
        for (let offset = 0; offset < base64.length; offset += alignedChunkChars) {
          const chunk = base64.slice(offset, offset + alignedChunkChars);
          const appended = await _send('MW_APPEND_ASSET_WRITE', { sessionId, chunk }, { timeoutMs: ASSET_WRITE_TIMEOUT_MS });
          if (!appended.ok) throw new Error(appended.error || 'asset write failed');
        }
        const finished = await _send('MW_FINISH_ASSET_WRITE', { sessionId }, { timeoutMs: ASSET_WRITE_TIMEOUT_MS });
        sessionId = '';
        return finished.ok ? {
          publicPath: finished.publicPath || finished.relativePath || '',
          relativePath: finished.relativePath || '',
          fileInfo: finished.fileInfo || null
        } : null;
      } catch (error) {
        if (sessionId) {
          try { await _send('MW_ABORT_ASSET_WRITE', { sessionId }, { timeoutMs: DEFAULT_TIMEOUT_MS }); } catch {}
        }
        console.warn('Morpheus: failed to save asset', error);
        return null;
      }
    },

    async cacheAssetUrl(options = {}) {
      if (!_available) await _connect({ retries: 1, delayMs: 200 });
      if (!_available || !_nativeAvailable) return null;
      const url = typeof options.url === 'string' ? options.url.trim() : '';
      if (!/^https?:\/\//i.test(url)) return null;
      try {
        const res = await _send('MW_CACHE_ASSET_URL', {
          url,
          kind: options.kind || 'background',
          collectionName: options.collectionName || '',
          itemName: options.itemName || '',
          extension: options.extension || '',
          maxBytes: options.maxBytes || 0
        }, { timeoutMs: ASSET_WRITE_TIMEOUT_MS });
        return res.ok ? {
          publicPath: res.publicPath || res.relativePath || '',
          relativePath: res.relativePath || '',
          fileInfo: res.fileInfo || null,
          contentType: res.contentType || '',
          bytes: res.bytes || 0
        } : null;
      } catch (error) {
        console.warn('Morpheus: failed to cache asset URL', error);
        return null;
      }
    },

    async fetchFavicon(url) {
      if (!_available) await _connect({ retries: 1, delayMs: 200 });
      if (!_available || !_nativeAvailable) return null;
      const pageUrl = typeof url === 'string' ? url.trim() : '';
      if (!/^https?:\/\//i.test(pageUrl)) return null;
      try {
        const res = await _send('MW_FETCH_FAVICON', {
          url: pageUrl
        }, { timeoutMs: FAVICON_FETCH_TIMEOUT_MS });
        return res.ok && res.dataUrl ? {
          dataUrl: res.dataUrl,
          iconUrl: res.iconUrl || '',
          contentType: res.contentType || '',
          bytes: res.bytes || 0
        } : null;
      } catch (error) {
        console.warn('Morpheus: native favicon fetch failed', error);
        return null;
      }
    },

    async secretStatus() {
      if (!_available) await _connect({ retries: 1, delayMs: 200 });
      if (!_available || !_nativeAvailable) return { available: false, provider: '', error: 'Native host not available' };
      try {
        const res = await _send('MW_SECRET_STATUS');
        return {
          available: res.available === true,
          provider: res.provider || '',
          error: res.error || ''
        };
      } catch (error) {
        return { available: false, provider: '', error: error?.message || 'Secret storage unavailable' };
      }
    },

    async secretGet(key) {
      if (!_available) await _connect({ retries: 1, delayMs: 200 });
      if (!_available || !_nativeAvailable) return '';
      try {
        const res = await _send('MW_SECRET_GET', { key });
        return res.ok ? (res.value || '') : '';
      } catch {
        return '';
      }
    },

    async secretSet(key, value) {
      if (!_available) await _connect({ retries: 1, delayMs: 200 });
      if (!_available || !_nativeAvailable) return false;
      try {
        const res = await _send('MW_SECRET_SET', { key, value });
        return res.ok !== false;
      } catch {
        return false;
      }
    },

    async secretDelete(key) {
      if (!_available) await _connect({ retries: 1, delayMs: 200 });
      if (!_available || !_nativeAvailable) return false;
      try {
        const res = await _send('MW_SECRET_DELETE', { key });
        return res.ok !== false;
      } catch {
        return false;
      }
    },

    async secretList() {
      if (!_available) await _connect({ retries: 1, delayMs: 200 });
      if (!_available || !_nativeAvailable) return [];
      try {
        const res = await _send('MW_SECRET_LIST');
        return Array.isArray(res.keys) ? res.keys : [];
      } catch {
        return [];
      }
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
