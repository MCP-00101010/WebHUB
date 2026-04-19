// Bridge between the Morpheus WebHub page and the Firefox extension.
// When the extension is absent, all methods no-op gracefully and the app
// continues using localStorage as normal.

const bridge = (() => {
  let _available = false;
  let _resolveReady;
  const whenReady = new Promise(r => { _resolveReady = r; });

  let _seq = 0;
  const _pending = new Map();

  // Send a request to the content script and wait for the response.
  function _send(type, payload = {}) {
    return new Promise((resolve, reject) => {
      const id = `mw-${++_seq}`;
      const timer = setTimeout(() => {
        _pending.delete(id);
        reject(new Error('timeout'));
      }, 1500);
      _pending.set(id, { resolve, reject, timer });
      window.postMessage({ _mw: true, _req: true, id, type, ...payload }, '*');
    });
  }

  // Handle incoming messages from content.js.
  window.addEventListener('message', e => {
    if (!e.data?._mw || e.source !== window) return;

    // Incoming tab pushed by the extension popup.
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

  // Ping the extension on page load; resolves whenReady.
  (async () => {
    try {
      await _send('MW_PING');
      _available = true;
    } catch {
      _available = false;
    }
    _resolveReady();
  })();

  return {
    whenReady,
    isAvailable() { return _available; },

    async saveState(json) {
      if (!_available) return false;
      try { await _send('MW_SAVE', { json }); return true; }
      catch { return false; }
    },

    async loadState() {
      if (!_available) return null;
      try { return (await _send('MW_LOAD')).json || null; }
      catch { return null; }
    }
  };
})();
