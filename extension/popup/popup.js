'use strict';

function isPotentialHubPage(url = '') {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'file:'
      || (parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname));
  } catch {
    return false;
  }
}

async function ensureActiveHubRelay(tab) {
  if (tab?.id === undefined || !isPotentialHubPage(tab.url || '')) return { attempted: false, ready: false, error: '' };
  let discovered = await browser.tabs.sendMessage(tab.id, { type: 'MW_DISCOVER' }).catch(() => null);
  if (discovered?.isMorpheus && discovered?.registered !== false) return { attempted: false, ready: true, error: '' };
  try {
    // Opening the browser-action popup grants activeTab access to this tab,
    // providing a reliable fallback when Firefox has not applied the manifest
    // content script to a local file page.
    await browser.tabs.executeScript(tab.id, { runAt: 'document_idle', file: '/content.js' });
    discovered = await browser.tabs.sendMessage(tab.id, { type: 'MW_DISCOVER' }).catch(() => null);
    return discovered?.isMorpheus && discovered?.registered !== false
      ? { attempted: true, ready: true, error: '' }
      : { attempted: true, ready: false, error: 'The relay was injected but did not identify the Hub page.' };
  } catch (error) {
    return { attempted: true, ready: false, error: error?.message || String(error) };
  }
}

async function main() {
  const elMorpheus = document.getElementById('statusMorpheus');
  const elVersion  = document.getElementById('statusVersion');
  const elNative   = document.getElementById('statusNative');
  const elPath     = document.getElementById('statusPath');
  const elDetail   = document.getElementById('statusDetail');
  const tabInfo    = document.getElementById('tabInfo');
  const tabTitle   = document.getElementById('tabTitle');
  const tabUrl     = document.getElementById('tabUrl');
  const sendBtn    = document.getElementById('sendBtn');
  const importBtn  = document.getElementById('importBtn');
  const feedback   = document.getElementById('feedback');

  const manifestVersion = browser.runtime.getManifest?.()?.version || '';
  if (elVersion) elVersion.textContent = manifestVersion ? `Extension version ${manifestVersion}` : 'Extension version unavailable';

  function setRow(el, text, cls) {
    el.textContent = text;
    el.className = 'status-row ' + (cls || '');
  }

  function showFeedback(text, cls) {
    feedback.textContent = text;
    feedback.className = 'feedback ' + (cls || '');
  }

  // Current active tab.
  const [currentTab] = await browser.tabs.query({ active: true, currentWindow: true });
  const isReal = currentTab?.url &&
    !currentTab.url.startsWith('about:') &&
    !currentTab.url.startsWith('moz-extension:');

  if (isReal) {
    tabTitle.textContent = currentTab.title || 'Untitled';
    tabUrl.textContent   = currentTab.url;
    tabInfo.classList.remove('hidden');
  }

  // Extension status.
  let morpheusOpen = false;
  let nativeAvailable = false;
  let databasePath = null;
  let nativeError = '';
  let hubRelayError = '';
  let extensionId = '';
  let storageInfoReady = false;
  let fileSchemeAccess = null;
  let fileSchemeAccessRequired = false;
  let sending = false;
  let refreshInFlight = null;
  let statusPollTimer = null;

  function updateActionButtons() {
    const disabled = sending || !morpheusOpen || !isReal;
    sendBtn.disabled = disabled;
    importBtn.disabled = disabled;
  }

  function renderStatus() {
    setRow(elMorpheus,
      morpheusOpen
        ? '● Morpheus is open'
        : (fileSchemeAccessRequired && fileSchemeAccess === false
          ? '○ Local-file access is disabled'
          : '○ Waiting for Morpheus…'),
      morpheusOpen ? 'ok' : 'warn'
    );

    setRow(elNative,
      nativeAvailable ? '● Disk database: enabled' : '○ Disk database: unavailable',
      nativeAvailable ? 'ok' : 'warn'
    );

    if (nativeAvailable) {
      elPath.textContent = databasePath ? `Shared DB: ${databasePath}` : 'Shared DB: not configured';
      elPath.classList.remove('hidden');
      elPath.classList.toggle('warn', !databasePath);
      elPath.classList.toggle('muted', !databasePath);
      if (!morpheusOpen && fileSchemeAccessRequired && fileSchemeAccess === false) {
        elDetail.textContent = 'Open about:addons → Morpheus WebHub → Permissions, then enable “Access local files on your computer”.';
        elDetail.classList.remove('hidden');
        elDetail.classList.add('warn');
      } else if (!morpheusOpen && hubRelayError) {
        elDetail.textContent = `Relay error: ${hubRelayError}`;
        elDetail.classList.remove('hidden');
        elDetail.classList.add('warn');
      } else {
        elDetail.classList.add('hidden');
      }
    } else {
      elPath.textContent = extensionId ? `Extension ID: ${extensionId}` : 'Extension ID unavailable';
      elPath.classList.remove('hidden');
      elPath.classList.add('muted');
      elDetail.textContent = fileSchemeAccessRequired && fileSchemeAccess === false
        ? 'Open about:addons → Morpheus WebHub → Permissions, then enable “Access local files on your computer”.'
        : (nativeError ? `Native error: ${nativeError}` : 'Native host did not connect');
      elDetail.classList.remove('hidden');
      elDetail.classList.add('warn');
    }
    updateActionButtons();
  }

  function refreshStatus() {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = browser.runtime.sendMessage({ type: 'MW_GET_STATUS' })
      .then(res => {
        morpheusOpen    = res?.morpheusOpen === true;
        nativeAvailable = res?.nativeAvailable === true;
        storageInfoReady = res?.storageInfoReady === true;
        databasePath    = res?.databasePath || null;
        nativeError     = res?.nativeError || '';
        fileSchemeAccess = res?.fileSchemeAccess ?? null;
        fileSchemeAccessRequired = res?.fileSchemeAccessRequired === true;
        if (morpheusOpen) hubRelayError = '';
        else if (res?.hubRelayError) hubRelayError = res.hubRelayError;
        extensionId     = res?.extensionId || browser.runtime.id || '';
        renderStatus();
        return morpheusOpen && storageInfoReady;
      })
      .catch(() => {
        morpheusOpen = false;
        setRow(elMorpheus, '⚠ Extension error', 'err');
        updateActionButtons();
        return false;
      })
      .finally(() => { refreshInFlight = null; });
    return refreshInFlight;
  }

  const relayResult = await ensureActiveHubRelay(currentTab);
  if (relayResult.error) hubRelayError = relayResult.error;
  const initialStatusReady = await refreshStatus();
  if (!initialStatusReady) {
    statusPollTimer = setInterval(async () => {
      if (await refreshStatus()) {
        clearInterval(statusPollTimer);
        statusPollTimer = null;
      }
    }, 500);
  }
  window.addEventListener('unload', () => {
    if (statusPollTimer) clearInterval(statusPollTimer);
  }, { once: true });

  async function sendCurrentTab(type, okMessage) {
    sending = true;
    updateActionButtons();
    try {
      await refreshStatus();
      if (!morpheusOpen) throw new Error('Morpheus WebHub is not open');
      const res = await browser.runtime.sendMessage({
        type,
        url:   currentTab.url,
        title: currentTab.title || currentTab.url,
        faviconCache: currentTab.favIconUrl || ''
      });
      if (res.ok) {
        showFeedback(okMessage, 'ok');
        setTimeout(() => window.close(), 1200);
      } else {
        sending = false;
        updateActionButtons();
        showFeedback('Error: ' + (res.error || 'unknown'), 'err');
      }
    } catch (err) {
      sending = false;
      updateActionButtons();
      showFeedback('Error: ' + err.message, 'err');
    }
  }

  sendBtn.addEventListener('click', () => sendCurrentTab('MW_SEND_TAB', 'Sent to inbox!'));
  importBtn.addEventListener('click', () => sendCurrentTab('MW_SEND_TAB_TO_IMPORT_MANAGER', 'Sent to Import Manager!'));
}

main();
