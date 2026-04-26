'use strict';

async function main() {
  const elMorpheus = document.getElementById('statusMorpheus');
  const elNative   = document.getElementById('statusNative');
  const elPath     = document.getElementById('statusPath');
  const tabInfo    = document.getElementById('tabInfo');
  const tabTitle   = document.getElementById('tabTitle');
  const tabUrl     = document.getElementById('tabUrl');
  const sendBtn    = document.getElementById('sendBtn');
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
  try {
    const res = await browser.runtime.sendMessage({ type: 'MW_GET_STATUS' });
    morpheusOpen    = res.morpheusOpen;
    nativeAvailable = res.nativeAvailable;
    databasePath    = res.databasePath || null;
  } catch {
    setRow(elMorpheus, '⚠ Extension error', 'err');
    return;
  }

  setRow(elMorpheus,
    morpheusOpen ? '● Morpheus is open' : '○ Morpheus is not open',
    morpheusOpen ? 'ok' : 'warn'
  );

  setRow(elNative,
    nativeAvailable ? '● File save: enabled' : '○ File save: extension storage only',
    nativeAvailable ? 'ok' : 'muted'
  );

  if (nativeAvailable) {
    elPath.textContent = databasePath ? `Shared DB: ${databasePath}` : 'Shared DB: not configured';
    elPath.classList.remove('hidden');
    elPath.classList.toggle('warn', !databasePath);
    elPath.classList.toggle('muted', !databasePath);
  } else {
    elPath.classList.add('hidden');
  }

  if (!morpheusOpen || !isReal) {
    if (!morpheusOpen) setRow(elMorpheus, '○ Open Morpheus to send tabs', 'warn');
    return;
  }

  sendBtn.disabled = false;

  sendBtn.addEventListener('click', async () => {
    sendBtn.disabled = true;
    try {
      const res = await browser.runtime.sendMessage({
        type:  'MW_SEND_TAB',
        url:   currentTab.url,
        title: currentTab.title || currentTab.url
      });
      if (res.ok) {
        showFeedback('Sent to inbox!', 'ok');
        setTimeout(() => window.close(), 1200);
      } else {
        sendBtn.disabled = false;
        showFeedback('Error: ' + (res.error || 'unknown'), 'err');
      }
    } catch (err) {
      sendBtn.disabled = false;
      showFeedback('Error: ' + err.message, 'err');
    }
  });
}

main();
