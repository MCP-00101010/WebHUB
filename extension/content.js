'use strict';

(() => {
if (globalThis.__morpheusWebHubRelayLoaded) return;
globalThis.__morpheusWebHubRelayLoaded = true;

// Keep the page/extension transport deliberately small. Firefox injects this
// once at document_idle, after Morpheus' identifying meta tag is available.
const IS_MORPHEUS = !!document.querySelector('meta[name="morpheus-webhub"]');
const IS_EMUGUI = !!document.querySelector('meta[name="morpheus-emugui"]')
  && (window.location.protocol === 'file:' || (
    window.location.protocol === 'http:'
    && ['localhost', '127.0.0.1'].includes(window.location.hostname)
    && window.location.port === '8765'
  ));
const pendingPagePushes = new Map();
let pushSequence = 0;
let registeredWithBackground = false;
let registrationPromise = null;
let hubSessionToken = '';
let emuguiRegistrationPromise = null;
let emuguiSessionToken = '';

function setRelayDiagnostic(state, error = '') {
  const root = document.documentElement;
  if (!root) return;
  root.dataset.morpheusExtensionRelay = state;
  if (error) root.dataset.morpheusExtensionError = error;
  else delete root.dataset.morpheusExtensionError;
}

function relayPushToPage(message) {
  const pushRequestId = `mw-push-${Date.now()}-${++pushSequence}`;
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      pendingPagePushes.delete(pushRequestId);
      resolve({ ok: false, error: 'The hub did not acknowledge the delivery in time' });
    }, 65000);
    pendingPagePushes.set(pushRequestId, { resolve, timer });
    window.postMessage({ _mw: true, _push: true, pushRequestId, ...message }, '*');
  });
}

function registerHub({ force = false } = {}) {
  if (registeredWithBackground && hubSessionToken && !force) {
    return Promise.resolve({ ok: true, hubSessionToken });
  }
  if (registrationPromise) return registrationPromise;
  registrationPromise = browser.runtime.sendMessage({
    type: 'MW_REGISTER',
    pageUrl: window.location.href,
    active: !document.hidden && document.hasFocus()
  }).then(response => {
    if (response?.ok !== true) throw new Error(response?.error || 'The extension background rejected Hub registration');
    if (!response.hubSessionToken) throw new Error('The extension background did not establish a Hub session');
    registeredWithBackground = true;
    hubSessionToken = response.hubSessionToken;
    setRelayDiagnostic('background-ready');
    window.postMessage({ _mw: true, _relayReady: true }, '*');
    return response;
  }).catch(error => {
    registeredWithBackground = false;
    hubSessionToken = '';
    setRelayDiagnostic('background-error', error?.message || String(error));
    return { ok: false, error: error?.message || String(error) };
  }).finally(() => {
    registrationPromise = null;
  });
  return registrationPromise;
}

function registerEmuGui({ force = false } = {}) {
  if (emuguiSessionToken && !force) return Promise.resolve({ ok: true, emuguiSessionToken });
  if (emuguiRegistrationPromise) return emuguiRegistrationPromise;
  emuguiRegistrationPromise = browser.runtime.sendMessage({
    type: 'MW_EMUGUI_REGISTER',
    pageUrl: window.location.href
  }).then(response => {
    if (response?.ok !== true || !response.emuguiSessionToken) {
      throw new Error(response?.error || 'The extension rejected EmuGUI registration');
    }
    emuguiSessionToken = response.emuguiSessionToken;
    setRelayDiagnostic('background-ready');
    window.postMessage({ _emugui: true, _relayReady: true, transport: response.transport || '' }, '*');
    return response;
  }).catch(error => {
    emuguiSessionToken = '';
    setRelayDiagnostic('background-error', error?.message || String(error));
    return { ok: false, error: error?.message || String(error) };
  }).finally(() => {
    emuguiRegistrationPromise = null;
  });
  return emuguiRegistrationPromise;
}

if (IS_MORPHEUS) {
  setRelayDiagnostic('loaded');
  void registerHub();

  browser.runtime.onMessage.addListener(msg => {
    if (msg.type === 'MW_DISCOVER') {
      return registerHub({ force: true }).then(result => ({
        ok: result?.ok === true,
        isMorpheus: true,
        registered: result?.ok === true,
        pageUrl: window.location.href,
        hubSessionToken: result?.hubSessionToken || '',
        error: result?.ok === true ? '' : (result?.error || 'Hub registration failed')
      }));
    }
    if (msg.type === 'MW_RECEIVE_TAB') {
      return relayPushToPage({
        type: 'MW_RECEIVE_TAB',
        deliveryId: msg.deliveryId || '',
        targetBoardId: msg.targetBoardId || '',
        targetTabId: msg.targetTabId || '',
        url: msg.url,
        title: msg.title,
        faviconCache: msg.faviconCache || ''
      });
    }
    if (msg.type === 'MW_RECEIVE_IMPORT_ITEMS') {
      return relayPushToPage({
        type: 'MW_RECEIVE_IMPORT_ITEMS',
        deliveryId: msg.deliveryId || '',
        items: msg.items || [],
        source: msg.source || ''
      });
    }
    if (msg.type === 'MW_RECEIVE_GAME') {
      return relayPushToPage({
        type: 'MW_RECEIVE_GAME',
        deliveryId: msg.deliveryId || '',
        targetBoardId: msg.targetBoardId || '',
        targetTabId: msg.targetTabId || '',
        game: msg.game || null
      });
    }
    if (msg.type === 'MW_UPDATE_GAME_BINDING') {
      return relayPushToPage({
        type: 'MW_UPDATE_GAME_BINDING',
        deliveryId: msg.deliveryId || '',
        game: msg.game || null
      });
    }
    if (msg.type === 'MW_GET_INBOX_TARGETS') {
      return relayPushToPage({ type: 'MW_GET_INBOX_TARGETS' });
    }
    if (msg.type === 'MW_OPEN_COMMAND_PALETTE') {
      return relayPushToPage({ type: 'MW_OPEN_COMMAND_PALETTE' });
    }
    if (msg.type === 'MW_NOTIFICATION_EVENT') {
      return relayPushToPage({ type: 'MW_NOTIFICATION_EVENT', event: msg.event || null });
    }
    if (msg.type === 'MW_OPEN_NOTIFICATION_TARGET') {
      return relayPushToPage({ type: 'MW_OPEN_NOTIFICATION_TARGET', event: msg.event || null });
    }
  });
}
if (IS_EMUGUI) {
  setRelayDiagnostic('loaded');
  void registerEmuGui();
}

// Relay page requests to the extension background and delivery acknowledgements
// back to the popup/background sender.
window.addEventListener('message', async event => {
  if (IS_EMUGUI && event.source === window && event.data?._emuguiReq === true) {
    const requestId = String(event.data.requestId || '');
    const type = String(event.data.type || '');
    if (!requestId || !['MW_EMUGUI_SEND_GAME', 'MW_EMUGUI_RPC', 'MW_EMUGUI_ASSET'].includes(type)) return;
    let response;
    try {
      const registration = await registerEmuGui();
      if (registration?.ok !== true || !emuguiSessionToken) throw new Error(registration?.error || 'EmuGUI is not registered');
      const message = {
        type,
        emuguiSessionToken,
        pageUrl: window.location.href
      };
      if (type === 'MW_EMUGUI_SEND_GAME') Object.assign(message, {
          gameId: String(event.data.gameId || '').slice(0, 120),
          emulatorId: String(event.data.emulatorId || '').slice(0, 120),
          profileId: String(event.data.profileId || '').slice(0, 120),
          rebindGameKey: String(event.data.rebindGameKey || '').slice(0, 80),
          deliveryId: String(event.data.deliveryId || '').slice(0, 160)
        });
      if (type === 'MW_EMUGUI_RPC') Object.assign(message, {
          method: String(event.data.method || '').slice(0, 8),
          path: String(event.data.path || '').slice(0, 96),
          query: event.data.query && typeof event.data.query === 'object' ? event.data.query : {},
          body: event.data.body && typeof event.data.body === 'object' ? event.data.body : {}
        });
      if (type === 'MW_EMUGUI_ASSET') message.path = String(event.data.path || '').slice(0, 2048);
      response = await browser.runtime.sendMessage(message);
    } catch (error) {
      response = { ok: false, error: error?.message || String(error) };
    }
    window.postMessage({ _emuguiRes: true, requestId, ...(response || { ok: false, error: 'No extension response' }) }, '*');
    return;
  }
  if (!IS_MORPHEUS) return;
  if (event.data?._mw && event.source === window && event.data._pushResponse) {
    const pending = pendingPagePushes.get(event.data.pushRequestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingPagePushes.delete(event.data.pushRequestId);
    pending.resolve({
      ok: event.data.ok === true,
      conflict: event.data.conflict === true,
      persisted: event.data.persisted || '',
      boards: Array.isArray(event.data.boards) ? event.data.boards : [],
      activeBoardId: event.data.activeBoardId || '',
      activeTabId: event.data.activeTabId || '',
      error: event.data.error || ''
    });
    return;
  }
  if (!event.data?._mw || event.source !== window || !event.data._req) return;

  const { id, type } = event.data;
  const reply = data => window.postMessage({ _mw: true, _res: true, id, ...data }, '*');
  try {
    const registration = await registerHub();
    if (registration?.ok !== true || !hubSessionToken) {
      throw new Error(registration?.error || 'The Hub relay is not registered');
    }
    const response = await browser.runtime.sendMessage({
      type,
      ...event.data,
      morpheusPage: IS_MORPHEUS,
      pageUrl: window.location.href,
      hubSessionToken
    });
    reply(response);
  } catch (error) {
    setRelayDiagnostic('background-error', error?.message || String(error));
    reply({ ok: false, error: error?.message || String(error) });
  }
});

})();
