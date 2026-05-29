'use strict';

async function main() {
  const elMorpheus = document.getElementById('statusMorpheus');
  const elNative   = document.getElementById('statusNative');
  const elPath     = document.getElementById('statusPath');
  const elDetail   = document.getElementById('statusDetail');
  const tabInfo    = document.getElementById('tabInfo');
  const tabTitle   = document.getElementById('tabTitle');
  const tabUrl     = document.getElementById('tabUrl');
  const sendBtn    = document.getElementById('sendBtn');
  const importBtn  = document.getElementById('importBtn');
  const feedback   = document.getElementById('feedback');

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
  let extensionId = '';
  try {
    const res = await browser.runtime.sendMessage({ type: 'MW_GET_STATUS' });
    morpheusOpen    = res.morpheusOpen;
    nativeAvailable = res.nativeAvailable;
    databasePath    = res.databasePath || null;
    nativeError     = res.nativeError || '';
    extensionId     = res.extensionId || browser.runtime.id || '';
  } catch {
    setRow(elMorpheus, '⚠ Extension error', 'err');
    return;
  }

  setRow(elMorpheus,
    morpheusOpen ? '● Morpheus is open' : '○ Morpheus is not open',
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
    elDetail.classList.add('hidden');
  } else {
    elPath.textContent = extensionId ? `Extension ID: ${extensionId}` : 'Extension ID unavailable';
    elPath.classList.remove('hidden');
    elPath.classList.add('muted');
    elDetail.textContent = nativeError ? `Native error: ${nativeError}` : 'Native host did not connect';
    elDetail.classList.remove('hidden');
    elDetail.classList.add('warn');
  }

  if (!morpheusOpen || !isReal) {
    if (!morpheusOpen) setRow(elMorpheus, '○ Open Morpheus to send tabs', 'warn');
    return;
  }

  sendBtn.disabled = false;
  importBtn.disabled = false;

  async function sendCurrentTab(type, okMessage) {
    sendBtn.disabled = true;
    importBtn.disabled = true;
    try {
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
        sendBtn.disabled = false;
        importBtn.disabled = false;
        showFeedback('Error: ' + (res.error || 'unknown'), 'err');
      }
    } catch (err) {
      sendBtn.disabled = false;
      importBtn.disabled = false;
      showFeedback('Error: ' + err.message, 'err');
    }
  }

  sendBtn.addEventListener('click', () => sendCurrentTab('MW_SEND_TAB', 'Sent to inbox!'));
  importBtn.addEventListener('click', () => sendCurrentTab('MW_SEND_TAB_TO_IMPORT_MANAGER', 'Sent to Import Manager!'));
}

main();
