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
  let _lastError = '';
  let _extensionVersion = '';
  let _capabilities = new Set();

  let _seq = 0;
  const _pending = new Map();
  const DEFAULT_TIMEOUT_MS = 5000;
  const LARGE_PAYLOAD_TIMEOUT_MS = 60000;
  const SHARED_READ_CHUNK_BYTES = 256 * 1024;
  const ASSET_WRITE_TIMEOUT_MS = 60000;
  const FAVICON_FETCH_TIMEOUT_MS = 30000;
  const FEED_FETCH_TIMEOUT_MS = 30000;
  const TRANSLATOR_ASSET_TIMEOUT_MS = 60000;
  const URL_HEALTH_TIMEOUT_MS = 20000;
  const DIRECTORY_APPROVAL_TIMEOUT_MS = 305000;

  function _send(type, payload = {}, options = {}) {
    return new Promise((resolve, reject) => {
      const id = `mw-${++_seq}`;
      const request = { _mw: true, _req: true, id, type, ...payload };
      const timer = setTimeout(() => {
        _pending.delete(id);
        reject(new Error('timeout'));
      }, options.timeoutMs || DEFAULT_TIMEOUT_MS);
      _pending.set(id, { resolve, reject, timer, request });
      window.postMessage(request, '*');
    });
  }

  function _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function _decodeBase64Bytes(value) {
    const binary = atob(value || '');
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  async function _loadSharedStateChunkedOnce() {
    let offset = 0;
    let readVersion = null;
    let fileInfo = null;
    let databasePath = null;
    let totalSize = 0;
    const chunks = [];
    let byteLength = 0;

    while (true) {
      const res = await _send('MW_LOAD_SHARED_CHUNK', {
        offset,
        length: SHARED_READ_CHUNK_BYTES,
        expectedVersion: readVersion
      }, { timeoutMs: LARGE_PAYLOAD_TIMEOUT_MS });
      const bytes = _decodeBase64Bytes(res.chunk || '');
      chunks.push(bytes);
      byteLength += bytes.length;
      fileInfo = res.fileInfo ? { ...(fileInfo || {}), ...res.fileInfo } : fileInfo;
      readVersion = readVersion || res.readVersion || res.fileInfo?.version || null;
      if (res.readVersion && readVersion !== res.readVersion) {
        throw new Error('Shared database changed during chunked read; retry required');
      }
      databasePath = res.databasePath || databasePath;
      totalSize = Number.isFinite(res.totalSize) ? res.totalSize : totalSize;
      const nextOffset = Number.isFinite(res.nextOffset) ? res.nextOffset : offset + bytes.length;
      if (res.done) break;
      if (!bytes.length || nextOffset <= offset) throw new Error('Shared database chunk read stalled');
      offset = nextOffset;
    }

    const expectedSize = Number(totalSize || fileInfo?.size || 0);
    if (expectedSize && byteLength !== expectedSize) {
      throw new Error(`Shared database chunk read was incomplete (${byteLength} of ${expectedSize} bytes)`);
    }

    if (fileInfo?.exists === false) {
      return { json: null, fileInfo, fromDisk: true, databasePath };
    }
    const joined = new Uint8Array(byteLength);
    let targetOffset = 0;
    for (const chunk of chunks) {
      joined.set(chunk, targetOffset);
      targetOffset += chunk.length;
    }
    return {
      json: new TextDecoder('utf-8').decode(joined) || null,
      fileInfo,
      fromDisk: true,
      databasePath
    };
  }

  async function _loadSharedStateChunked() {
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await _loadSharedStateChunkedOnce();
      } catch (error) {
        lastError = error;
        if (!/changed during chunked read/i.test(error?.message || '')) throw error;
      }
    }
    throw lastError || new Error('Shared database could not be read consistently');
  }

  async function _connect({ retries = 2, delayMs = 250, pingTimeoutMs = 750 } = {}) {
    if (_connectPromise) return _connectPromise;
    _connectPromise = (async () => {
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          const res = await _send('MW_PING', {
            morpheusPage: true,
            pageUrl: window.location.href,
            active: !document.hidden && document.hasFocus()
          }, { timeoutMs: pingTimeoutMs });
          const recoveredAfterStartup = _readyResolved && !_available;
          _available = true;
          _nativeAvailable = res.nativeAvailable === true;
          _extensionVersion = res.version || '';
          _capabilities = new Set(Array.isArray(res.capabilities) ? res.capabilities : []);
          _lastError = '';
          if (recoveredAfterStartup) {
            window.dispatchEvent(new CustomEvent('morpheus:bridge-ready', {
              detail: { nativeAvailable: _nativeAvailable }
            }));
          }
          return true;
        } catch (error) {
          _available = false;
          _nativeAvailable = false;
          _capabilities = new Set();
          _lastError = error?.message || String(error);
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

    // A document_idle content relay may attach after the page's first ping.
    // Replay pending requests immediately instead of waiting for their timeout.
    if (e.data._relayReady) {
      for (const pending of _pending.values()) window.postMessage(pending.request, '*');
      if (!_available && !_connectPromise) {
        void _connect({ retries: 1, delayMs: 200, pingTimeoutMs: 750 });
      }
      return;
    }

    // Tab pushed from the extension popup.
    if (e.data._push && e.data.type === 'MW_RECEIVE_TAB') {
      window.dispatchEvent(new CustomEvent('morpheus:receive-tab', {
        detail: {
          pushRequestId: e.data.pushRequestId || '',
          deliveryId: e.data.deliveryId || '',
          targetBoardId: e.data.targetBoardId || '',
          targetTabId: e.data.targetTabId || '',
          url: e.data.url,
          title: e.data.title,
          faviconCache: e.data.faviconCache || ''
        }
      }));
      return;
    }
    if (e.data._push && e.data.type === 'MW_RECEIVE_IMPORT_ITEMS') {
      window.dispatchEvent(new CustomEvent('morpheus:receive-import-items', {
        detail: {
          pushRequestId: e.data.pushRequestId || '',
          deliveryId: e.data.deliveryId || '',
          items: e.data.items || [],
          source: e.data.source || ''
        }
      }));
      return;
    }
    if (e.data._push && e.data.type === 'MW_GET_INBOX_TARGETS') {
      window.dispatchEvent(new CustomEvent('morpheus:get-inbox-targets', {
        detail: { pushRequestId: e.data.pushRequestId || '' }
      }));
      return;
    }
    if (e.data._push && e.data.type === 'MW_OPEN_COMMAND_PALETTE') {
      window.dispatchEvent(new CustomEvent('morpheus:open-command-palette', {
        detail: { pushRequestId: e.data.pushRequestId || '' }
      }));
      return;
    }
    if (e.data._push && e.data.type === 'MW_NOTIFICATION_EVENT') {
      window.dispatchEvent(new CustomEvent('morpheus:notification-event', {
        detail: { pushRequestId: e.data.pushRequestId || '', event: e.data.event || null }
      }));
      return;
    }
    if (e.data._push && e.data.type === 'MW_OPEN_NOTIFICATION_TARGET') {
      window.dispatchEvent(new CustomEvent('morpheus:open-notification-target', {
        detail: { pushRequestId: e.data.pushRequestId || '', event: e.data.event || null }
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
    supports(capability) { return _capabilities.has(capability); },
    getDiagnostics() {
      return {
        relayState: document.documentElement.dataset.morpheusExtensionRelay || 'not-injected',
        relayError: document.documentElement.dataset.morpheusExtensionError || '',
        bridgeError: _lastError,
        extensionVersion: _extensionVersion,
        capabilities: [..._capabilities]
      };
    },

    async getStorageInfo() {
      if (!_available) await _connect({ retries: 1, delayMs: 200, pingTimeoutMs: 750 });
      if (!_available) return { nativeAvailable: false, databasePath: null };
      try {
        const res = await _send('MW_GET_STORAGE_INFO');
        _available = true;
        _nativeAvailable = res.nativeAvailable === true;
        if (Array.isArray(res.capabilities)) _capabilities = new Set(res.capabilities);
        return {
          nativeAvailable: res.nativeAvailable === true,
          databasePath: res.databasePath || null,
          extensionVersion: res.version || _extensionVersion,
          capabilities: Array.isArray(res.capabilities) ? res.capabilities : [..._capabilities]
        };
      } catch {
        _available = false;
        _nativeAvailable = false;
        _lastError = 'Storage information request failed';
        return { nativeAvailable: false, databasePath: null };
      }
    },

    async scheduleNotification(job) {
      if (!_available) await _connect({ retries: 1, delayMs: 200 });
      if (!_available || !_capabilities.has('notificationScheduler')) return { ok: false, available: false };
      return _send('MW_NOTIFICATION_SCHEDULE', { job });
    },

    async cancelNotification(id) {
      if (!_available) await _connect({ retries: 1, delayMs: 200 });
      if (!_available || !_capabilities.has('notificationScheduler')) return { ok: false, available: false };
      return _send('MW_NOTIFICATION_CANCEL', { id });
    },

    async listNotifications() {
      if (!_available) await _connect({ retries: 1, delayMs: 200 });
      if (!_available || !_capabilities.has('notificationScheduler')) return { ok: false, available: false, events: [], jobs: [] };
      return _send('MW_NOTIFICATION_LIST');
    },

    async markNotificationsRead(ids = []) {
      if (!_available || !_capabilities.has('notificationScheduler')) return { ok: false, available: false };
      return _send('MW_NOTIFICATION_MARK_READ', { ids });
    },

    async clearNotifications() {
      if (!_available || !_capabilities.has('notificationScheduler')) return { ok: false, available: false };
      return _send('MW_NOTIFICATION_CLEAR');
    },

    async saveState(json, options = {}) {
      if (!_available) await _connect({ retries: 1, delayMs: 200, pingTimeoutMs: 750 });
      if (!_available) return { ok: false, conflict: false, fileInfo: null, databasePath: null };
      try {
        const res = await _send('MW_SAVE', {
          json,
          expectedVersion: options.expectedVersion ?? null,
          expectedHash: options.expectedHash || ''
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

    respondToPush(pushRequestId, result = {}) {
      if (!pushRequestId) return;
      window.postMessage({
        _mw: true,
        _pushResponse: true,
        pushRequestId,
        ...result
      }, '*');
    },

    async loadState() {
      if (!_available) await _connect({ retries: 1, delayMs: 200, pingTimeoutMs: 750 });
      if (!_available) return { json: null, fileInfo: null, fromDisk: false, databasePath: null };
      try {
        if (_nativeAvailable) {
          const loaded = await _loadSharedStateChunked();
          _available = true;
          return loaded;
        }
        const res = await _send('MW_LOAD', {}, { timeoutMs: LARGE_PAYLOAD_TIMEOUT_MS });
        _available = true;
        return {
          json: res.json || null,
          fileInfo: res.fileInfo || null,
          fromDisk: res.fromDisk === true,
          databasePath: res.databasePath || null
        };
      } catch (error) {
        _available = false;
        _nativeAvailable = false;
        return {
          json: null,
          fileInfo: null,
          fromDisk: false,
          databasePath: null,
          error: error?.message || String(error)
        };
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

    async captureBrowserSession(scope = 'window') {
      if (!_available) await _connect({ retries: 1, delayMs: 200 });
      if (!_available || !_capabilities.has('browserSessions')) throw new Error('Firefox session capture is unavailable');
      const res = await _send('MW_CAPTURE_BROWSER_SESSION', { scope });
      return { title: res.title || 'Browser Session', createdAt: res.createdAt, tabs: Array.isArray(res.tabs) ? res.tabs : [] };
    },

    async launchBrowserSession(tabs, options = {}) {
      if (!_available) await _connect({ retries: 1, delayMs: 200 });
      if (!_available || !_capabilities.has('browserSessions')) throw new Error('Firefox session launch is unavailable');
      return _send('MW_LAUNCH_BROWSER_SESSION', {
        tabs: Array.isArray(tabs) ? tabs : [],
        staggerMs: Math.max(0, Math.min(1000, Number(options.staggerMs || 0))),
        recreateGroups: options.recreateGroups !== false
      }, { timeoutMs: LARGE_PAYLOAD_TIMEOUT_MS });
    },

    async listDatabaseBackups() {
      if (!_available) await _connect({ retries: 1, delayMs: 200 });
      if (!_available || !_nativeAvailable || !_capabilities.has('backupTimeline')) return [];
      const res = await _send('MW_LIST_DATABASE_BACKUPS', {}, { timeoutMs: LARGE_PAYLOAD_TIMEOUT_MS });
      return Array.isArray(res.backups) ? res.backups : [];
    },

    async readDatabaseBackup(name) {
      if (!_available) await _connect({ retries: 1, delayMs: 200 });
      if (!_available || !_nativeAvailable || !_capabilities.has('backupTimeline')) throw new Error('Backup timeline is unavailable');
      const res = await _send('MW_READ_DATABASE_BACKUP', { name }, { timeoutMs: LARGE_PAYLOAD_TIMEOUT_MS });
      return { content: res.content || '', summary: res.summary || null, fileInfo: res.fileInfo || null };
    },

    async createDatabaseSafetyBackup() {
      if (!_available) await _connect({ retries: 1, delayMs: 200 });
      if (!_available || !_nativeAvailable || !_capabilities.has('backupTimeline')) throw new Error('Native backup support is unavailable');
      return _send('MW_CREATE_DATABASE_BACKUP', {}, { timeoutMs: LARGE_PAYLOAD_TIMEOUT_MS });
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

    async fetchFeed(url) {
      if (!_available) await _connect({ retries: 1, delayMs: 200 });
      if (!_available) return null;
      const feedUrl = typeof url === 'string' ? url.trim() : '';
      if (!/^https?:\/\//i.test(feedUrl)) return null;
      try {
        const res = await _send('MW_FETCH_FEED', { url: feedUrl }, { timeoutMs: FEED_FETCH_TIMEOUT_MS });
        return res.ok && typeof res.text === 'string' ? {
          text: res.text,
          finalUrl: res.finalUrl || feedUrl,
          contentType: res.contentType || '',
          bytes: Number(res.bytes || 0)
        } : null;
      } catch (error) {
        console.warn('Morpheus: extension feed fetch failed', error);
        return null;
      }
    },

    async fetchTranslationAssetChunk(assetId, offset, length) {
      if (!_available) await _connect({ retries: 1, delayMs: 200 });
      if (!_available || !_capabilities.has('translationModels')) {
        throw new Error(`Local translation models require the current Firefox extension${_extensionVersion ? `; detected ${_extensionVersion}` : ''}.`);
      }
      try {
        return await _send('MW_FETCH_TRANSLATOR_ASSET_CHUNK', {
          assetId: String(assetId || ''),
          offset: Math.max(0, Math.floor(Number(offset) || 0)),
          length: Math.max(1, Math.floor(Number(length) || 0))
        }, { timeoutMs: TRANSLATOR_ASSET_TIMEOUT_MS });
      } catch (error) {
        if (error?.message === 'timeout') throw new Error('Translation model download timed out.');
        throw error;
      }
    },

    async checkUrl(url) {
      if (!_available) await _connect({ retries: 1, delayMs: 200 });
      if (!_available) return { available: false, reachable: false, status: 0, finalUrl: url || '', error: 'Extension relay unavailable' };
      const targetUrl = typeof url === 'string' ? url.trim() : '';
      if (!/^https?:\/\//i.test(targetUrl)) return { available: true, reachable: false, status: 0, finalUrl: targetUrl, errorType: 'unsupported', error: 'Unsupported URL scheme' };
      if (!_capabilities.has('urlHealth')) {
        return {
          available: false,
          reachable: false,
          status: 0,
          finalUrl: targetUrl,
          errorType: 'relay',
          error: `Link Health requires the current Firefox extension${_extensionVersion ? `; detected ${_extensionVersion}` : ''}. Reload or update the extension.`
        };
      }
      try {
        const res = await _send('MW_CHECK_URL', { url: targetUrl }, { timeoutMs: URL_HEALTH_TIMEOUT_MS });
        return {
          available: true,
          reachable: res.reachable !== false,
          status: Number(res.status || 0),
          statusText: res.statusText || '',
          finalUrl: res.finalUrl || targetUrl,
          errorType: res.errorType || '',
          error: res.error || ''
        };
      } catch (error) {
        const message = error?.message || 'URL check failed';
        const relayFailure = /bridge error|relay|not registered|unsupported message/i.test(message);
        return { available: !relayFailure, reachable: false, status: 0, finalUrl: targetUrl, errorType: relayFailure ? 'relay' : (/timed out/i.test(message) ? 'timeout' : 'network'), error: message };
      }
    },

    async fetchCalendar(url, headers = {}) {
      if (!_available) await _connect({ retries: 1, delayMs: 200 });
      if (!_available) return null;
      const calendarUrl = typeof url === 'string' ? url.trim() : '';
      if (!/^https?:\/\//i.test(calendarUrl)) return null;
      const safeHeaders = {};
      if (typeof headers.Accept === 'string') safeHeaders.Accept = headers.Accept.slice(0, 256);
      if (typeof headers['X-Auth-Token'] === 'string') safeHeaders['X-Auth-Token'] = headers['X-Auth-Token'].slice(0, 512);
      if (typeof headers.Authorization === 'string') safeHeaders.Authorization = headers.Authorization.slice(0, 512);
      if (typeof headers['x-apisports-key'] === 'string') safeHeaders['x-apisports-key'] = headers['x-apisports-key'].slice(0, 512);
      try {
        const res = await _send('MW_FETCH_CALENDAR', { url: calendarUrl, headers: safeHeaders }, { timeoutMs: FEED_FETCH_TIMEOUT_MS });
        return res.ok && typeof res.text === 'string' ? {
          text: res.text,
          finalUrl: res.finalUrl || calendarUrl,
          contentType: res.contentType || '',
          bytes: Number(res.bytes || 0)
        } : { error: res.error || 'Extension request failed', status: Number(res.status || 0) };
      } catch (error) {
        console.warn('Morpheus: extension calendar fetch failed', error);
        return null;
      }
    },

    async monitorService(endpoint = {}) {
      if (!_available) await _connect({ retries: 1, delayMs: 200 });
      if (!_available || !_capabilities.has('serviceMonitor')) throw new Error('Service monitor relay is unavailable');
      const res = await _send('MW_MONITOR_SERVICE', {
        url: String(endpoint.url || '').slice(0, 4096),
        timeoutSeconds: Math.max(3, Math.min(30, Number(endpoint.timeoutSeconds) || 10)),
        assertionType: ['none', 'text', 'json'].includes(endpoint.assertionType) ? endpoint.assertionType : 'none'
      }, { timeoutMs: Math.max(5000, Math.min(35000, (Number(endpoint.timeoutSeconds) || 10) * 1000 + 2000)) });
      return {
        status: Number(res.status || 0), finalUrl: res.finalUrl || endpoint.url || '',
        text: typeof res.text === 'string' ? res.text : '', durationMs: Math.max(0, Number(res.durationMs) || 0)
      };
    },

    async getSystemMetrics(metrics = []) {
      if (!_available) await _connect({ retries: 1, delayMs: 200 });
      if (!_available || !_nativeAvailable || !_capabilities.has('systemMetrics')) throw new Error('System metrics are unavailable');
      const allowed = new Set(['cpu', 'memory', 'disk', 'network', 'uptime', 'battery', 'platform']);
      const res = await _send('MW_SYSTEM_METRICS', { metrics: [...new Set((Array.isArray(metrics) ? metrics : []).filter(metric => allowed.has(metric)))] });
      return res.metrics && typeof res.metrics === 'object' ? res.metrics : {};
    },

    async approveDirectory(purpose, title = 'Select folder') {
      if (!_available) await _connect({ retries: 1, delayMs: 200 });
      if (!_available || !_nativeAvailable || !_capabilities.has('approvedDirectories')) throw new Error('Directory approval is unavailable');
      const res = await _send('MW_APPROVE_DIRECTORY', { purpose, title }, { timeoutMs: DIRECTORY_APPROVAL_TIMEOUT_MS });
      return res.directory || null;
    },

    async getGitWorkspaceStatus(handle) {
      if (!_available) await _connect({ retries: 1, delayMs: 200 });
      if (!_available || !_nativeAvailable || !_capabilities.has('gitWorkspace')) throw new Error('Git workspace inspection is unavailable');
      const res = await _send('MW_GIT_WORKSPACE_STATUS', { handle });
      return res.repository || null;
    },

    async openApprovedDirectory(handle, purpose, action) {
      if (!_available) await _connect({ retries: 1, delayMs: 200 });
      if (!_available || !_nativeAvailable || !_capabilities.has('approvedDirectories')) throw new Error('Native folder actions are unavailable');
      const res = await _send('MW_OPEN_APPROVED_DIRECTORY', { handle, purpose, action });
      if (res.ok === false) throw new Error(res.error || 'The native folder action failed');
      return true;
    },

    async listRecentFiles(options = {}) {
      if (!_available) await _connect({ retries: 1, delayMs: 200 });
      if (!_available || !_nativeAvailable || !_capabilities.has('recentFiles')) throw new Error('Recent-file access is unavailable');
      const res = await _send('MW_LIST_RECENT_FILES', options);
      return res.result || null;
    },

    async openApprovedFile(handle, relativePath, action) {
      if (!_available) await _connect({ retries: 1, delayMs: 200 });
      if (!_available || !_nativeAvailable || !_capabilities.has('recentFiles')) throw new Error('Native file actions are unavailable');
      const res = await _send('MW_OPEN_APPROVED_FILE', { handle, relativePath, action });
      if (res.ok === false) throw new Error(res.error || 'The native file action failed');
      return true;
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
