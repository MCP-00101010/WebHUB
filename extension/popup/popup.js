'use strict';

async function main() {
  const statusBar = document.getElementById('statusBar');
  const tabInfo   = document.getElementById('tabInfo');
  const tabTitle  = document.getElementById('tabTitle');
  const tabUrl    = document.getElementById('tabUrl');
  const sendBtn   = document.getElementById('sendBtn');
  const feedback  = document.getElementById('feedback');

  function setStatus(msg, cls = '') {
    statusBar.textContent = msg;
    statusBar.className = 'status-bar ' + cls;
  }

  function showFeedback(msg, cls = '') {
    feedback.textContent = msg;
    feedback.className = 'feedback ' + cls;
  }

  // Get the current active tab.
  const [currentTab] = await browser.tabs.query({ active: true, currentWindow: true });

  // Show tab info if it looks like a real page (not extension UI etc.).
  const isReal = currentTab?.url && !currentTab.url.startsWith('about:') && !currentTab.url.startsWith('moz-extension:');
  if (isReal) {
    tabTitle.textContent = currentTab.title || 'Untitled';
    tabUrl.textContent   = currentTab.url;
    tabInfo.classList.remove('hidden');
  }

  // Check whether Morpheus is open.
  let morpheusOpen = false;
  try {
    const res = await browser.runtime.sendMessage({ type: 'MW_GET_STATUS' });
    morpheusOpen = res.morpheusOpen;
  } catch {
    setStatus('Extension error.', 'err');
    return;
  }

  if (!morpheusOpen) {
    setStatus('Morpheus WebHub is not open.', 'warn');
    return;
  }

  setStatus('Morpheus WebHub is open.', 'ok');

  if (!isReal) {
    setStatus('Navigate to a page first.', 'warn');
    return;
  }

  sendBtn.disabled = false;

  sendBtn.addEventListener('click', async () => {
    sendBtn.disabled = true;
    try {
      const res = await browser.runtime.sendMessage({
        type: 'MW_SEND_TAB',
        url:   currentTab.url,
        title: currentTab.title || currentTab.url
      });
      if (res.ok) {
        showFeedback('Sent to inbox!');
        setTimeout(() => window.close(), 1200);
      } else {
        sendBtn.disabled = false;
        showFeedback('Error: ' + (res.error || 'Unknown'), 'err');
      }
    } catch (err) {
      sendBtn.disabled = false;
      showFeedback('Error: ' + err.message, 'err');
    }
  });
}

main();
