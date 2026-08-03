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
  const targetPicker = document.getElementById('targetPicker');
  const targetBoard = document.getElementById('targetBoard');
  const targetTab   = document.getElementById('targetTab');
  const sendBtn    = document.getElementById('sendBtn');
  const sendToTabBtn = document.getElementById('sendToTabBtn');
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
  let targetBoards = [];
  let targetsLoaded = false;
  let targetsInFlight = null;

  function findSelectedTarget() {
    const board = targetBoards.find(item => item.id === targetBoard.value);
    const tab = board?.tabs?.find(item => item.id === targetTab.value);
    return board && tab ? { board, tab } : null;
  }

  function replaceOptions(select, options, selectedValue = '') {
    select.innerHTML = '';
    for (const optionData of options) {
      const option = document.createElement('option');
      option.value = optionData.id;
      option.textContent = optionData.title;
      select.appendChild(option);
    }
    if (options.some(option => option.id === selectedValue)) select.value = selectedValue;
  }

  async function rememberTarget() {
    const target = findSelectedTarget();
    if (!target) return;
    await browser.storage.local.set({
      morpheusPopupTarget: { boardId: target.board.id, tabId: target.tab.id }
    }).catch(() => {});
  }

  function renderTargetTabs(preferredTabId = '') {
    const board = targetBoards.find(item => item.id === targetBoard.value) || targetBoards[0];
    replaceOptions(targetTab, board?.tabs || [], preferredTabId);
    if (!targetTab.value && board?.tabs?.[0]) targetTab.value = board.tabs[0].id;
    targetPicker.classList.toggle('hidden', !morpheusOpen || !findSelectedTarget());
    updateActionButtons();
  }

  async function loadTargets() {
    if (!morpheusOpen) return false;
    if (targetsInFlight) return targetsInFlight;
    targetsInFlight = (async () => {
      const [response, stored] = await Promise.all([
        browser.runtime.sendMessage({ type: 'MW_GET_INBOX_TARGETS' }),
        browser.storage.local.get('morpheusPopupTarget').catch(() => ({}))
      ]);
      if (response?.ok !== true) throw new Error(response?.error || 'The Hub did not return any Inbox targets');
      targetBoards = Array.isArray(response?.boards) ? response.boards : [];
      const remembered = stored?.morpheusPopupTarget || {};
      const preferredBoardId = targetBoards.some(board => board.id === remembered.boardId)
        ? remembered.boardId
        : (targetBoards.some(board => board.id === response?.activeBoardId) ? response.activeBoardId : targetBoards[0]?.id || '');
      replaceOptions(targetBoard, targetBoards, preferredBoardId);
      if (!targetBoard.value && targetBoards[0]) targetBoard.value = targetBoards[0].id;
      const selectedBoard = targetBoards.find(board => board.id === targetBoard.value);
      const preferredTabId = selectedBoard?.tabs?.some(tab => tab.id === remembered.tabId)
        ? remembered.tabId
        : (selectedBoard?.tabs?.some(tab => tab.id === response?.activeTabId) ? response.activeTabId : selectedBoard?.tabs?.[0]?.id || '');
      targetsLoaded = true;
      renderTargetTabs(preferredTabId);
      return targetBoards.length > 0;
    })().catch(error => {
      targetBoards = [];
      targetsLoaded = true;
      targetPicker.classList.add('hidden');
      hubRelayError = error?.message || String(error);
      return false;
    }).finally(() => { targetsInFlight = null; });
    return targetsInFlight;
  }

  function updateActionButtons() {
    const disabled = sending || !morpheusOpen || !isReal;
    sendBtn.disabled = disabled;
    importBtn.disabled = disabled;
    sendToTabBtn.disabled = disabled || !findSelectedTarget();
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
        if (morpheusOpen && !targetsLoaded) void loadTargets();
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

  async function sendCurrentTab(type, okMessage, target = null) {
    sending = true;
    updateActionButtons();
    try {
      await refreshStatus();
      if (!morpheusOpen) throw new Error('Morpheus WebHub is not open');
      const res = await browser.runtime.sendMessage({
        type,
        targetBoardId: target?.board?.id || '',
        targetTabId: target?.tab?.id || '',
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

  targetBoard.addEventListener('change', () => {
    renderTargetTabs();
    void rememberTarget();
  });
  targetTab.addEventListener('change', () => {
    updateActionButtons();
    void rememberTarget();
  });
  sendBtn.addEventListener('click', () => sendCurrentTab('MW_SEND_TAB', 'Sent to inbox!'));
  sendToTabBtn.addEventListener('click', () => {
    const target = findSelectedTarget();
    if (!target) return;
    void rememberTarget();
    sendCurrentTab('MW_SEND_TAB', `Sent to ${target.board.title} / ${target.tab.title}!`, target);
  });
  importBtn.addEventListener('click', () => sendCurrentTab('MW_SEND_TAB_TO_IMPORT_MANAGER', 'Sent to Import Manager!'));
}

main();
