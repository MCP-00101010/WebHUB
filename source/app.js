const APP_VERSION = '0.11.55';

document.documentElement.classList.add('hub-booting');

let activeModal = null;
let contextTarget = null;
let lastActiveColumnId = null;

let confirmCallback = null;
let confirmCancelCallback = null;
const SHARED_DISK_POLL_MS = 5000;
const SHARED_DISK_NOTICE_KEY = 'morpheus-shared-disk-notice';
let sharedDiskPollTimer = null;
let sharedDiskReloadPromptOpen = false;
let sharedDiskDataReloadInProgress = false;
let sharedRecoveryPollTimer = null;
let sharedRecoveryCheckInProgress = false;
let sharedRecoveryPromptOpen = false;
let lastBridgeNativeReady = false;
let lastBridgeRecoveryPath = '';

// --- Undo / redo ---

const MAX_UNDO = 50;
let undoStack = [];
let redoStack = [];

// --- Bulk selection ---

let selectedItemIds = new Set();
let selectionContext = null;

function toggleItemSelection(itemId, itemEl, context = 'board') {
  if (selectionContext && selectionContext !== context) clearSelection();
  selectionContext = context;
  if (selectedItemIds.has(itemId)) {
    selectedItemIds.delete(itemId);
    itemEl?.classList.remove('selected');
  } else {
    selectedItemIds.add(itemId);
    itemEl?.classList.add('selected');
  }
  if (selectedItemIds.size === 0) selectionContext = null;
  updateBulkToolbar();
}

function clearSelection() {
  selectedItemIds.clear();
  selectionContext = null;
  document.querySelectorAll('.board-column-item.selected').forEach(el => el.classList.remove('selected'));
  updateBulkToolbar();
}

function updateBulkToolbar() {
  const toolbar = document.getElementById('bulkToolbar');
  const countEl = document.getElementById('bulkCount');
  const moveBtn = document.getElementById('bulkMoveBtn');
  if (!toolbar) return;
  const n = selectedItemIds.size;
  toolbar.classList.toggle('hidden', n === 0);
  if (countEl) countEl.textContent = `${n} selected`;
  if (moveBtn) moveBtn.textContent = selectionContext === 'import-manager' ? 'Send to Tab Inbox…' : 'Move to Tab Inbox…';
}

function pushUndoSnapshot() {
  undoStack.push(JSON.stringify(state));
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack = [];
  updateUndoRedoUI();
}

function undo() {
  if (!undoStack.length) return;
  redoStack.push(JSON.stringify(state));
  restoreStateSnapshot(undoStack.pop());
  cleanTrashAfterRestore();
  saveState();
  renderAll();
  updateUndoRedoUI();
  if (!document.getElementById('trashPanel').classList.contains('hidden')) renderTrashPanel();
}

function redo() {
  if (!redoStack.length) return;
  undoStack.push(JSON.stringify(state));
  restoreStateSnapshot(redoStack.pop());
  cleanTrashAfterRestore();
  saveState();
  renderAll();
  updateUndoRedoUI();
  if (!document.getElementById('trashPanel').classList.contains('hidden')) renderTrashPanel();
}

function updateUndoRedoUI() {
  const canUndo = undoStack.length === 0;
  const canRedo = redoStack.length === 0;
  ['undoBtn', 'stgUndoBtn'].forEach(id => { const el = document.getElementById(id); if (el) el.disabled = canUndo; });
  ['redoBtn', 'stgRedoBtn'].forEach(id => { const el = document.getElementById(id); if (el) el.disabled = canRedo; });
  updateTrashBadge();
}

function updateTrashBadge() {
  const count = recentlyDeleted.length;
  const el = document.getElementById('trashCount');
  if (!el) return;
  el.textContent = count;
  el.classList.toggle('hidden', count === 0);
}

// --- Tooltip ---

const tooltipEl = document.getElementById('tooltip');
let tooltipTarget = null;

function positionTooltip(target) {
  tooltipEl.textContent = target.dataset.tooltip;
  const color = target.dataset.tooltipColor || '';
  tooltipEl.style.setProperty('--tooltip-color', color);
  tooltipEl.classList.toggle('has-color', !!color);
  tooltipEl.style.left = '-9999px';
  tooltipEl.style.top = '-9999px';
  tooltipEl.classList.remove('hidden');
  const rect = target.getBoundingClientRect();
  const tW = tooltipEl.offsetWidth;
  const tH = tooltipEl.offsetHeight;
  let top = rect.top - tH - 6;
  let left = rect.left + rect.width / 2 - tW / 2;
  if (top < 4) top = rect.bottom + 6;
  left = Math.max(4, Math.min(left, window.innerWidth - tW - 4));
  tooltipEl.style.top = top + 'px';
  tooltipEl.style.left = left + 'px';
}

document.addEventListener('mouseover', e => {
  const target = e.target.closest('[data-tooltip]');
  if (target === tooltipTarget) return;
  tooltipTarget = target;
  if (!target) { tooltipEl.classList.add('hidden'); return; }
  positionTooltip(target);
});

document.addEventListener('mouseout', e => {
  const target = e.target.closest('[data-tooltip]');
  if (!target) return;
  if (!target.contains(e.relatedTarget)) {
    tooltipTarget = null;
    tooltipEl.classList.add('hidden');
  }
});

function showConfirmDialog(message, onConfirm, okLabel = 'Delete', onCancel = null) {
  confirmCallback = onConfirm;
  confirmCancelCallback = onCancel;
  document.getElementById('confirmMessage').textContent = message;
  document.getElementById('confirmOkBtn').textContent = okLabel;
  document.getElementById('confirmOverlay').classList.remove('hidden');
}

function hideConfirmDialog(options = {}) {
  const { invokeCancel = false } = options;
  const cancelCb = confirmCancelCallback;
  confirmCallback = null;
  confirmCancelCallback = null;
  document.getElementById('confirmOverlay').classList.add('hidden');
  document.getElementById('confirmOkBtn').textContent = 'Delete';
  if (invokeCancel && cancelCb) cancelCb();
}

function showNotice(message) {
  document.getElementById('noticeMessage').textContent = message;
  document.getElementById('noticeOverlay').classList.remove('hidden');
}

function hideNotice() {
  document.getElementById('noticeOverlay').classList.add('hidden');
}

function queueSharedDiskNotice(message) {
  try { sessionStorage.setItem(SHARED_DISK_NOTICE_KEY, message); } catch {}
}

function confirmDialogIsOpen() {
  return !document.getElementById('confirmOverlay').classList.contains('hidden');
}

function resetTransientUiForDataReload() {
  if (!elements.contextMenu.classList.contains('hidden')) hideContextMenu();
  if (selectedItemIds.size > 0) clearSelection();
  if (!elements.searchModal.classList.contains('hidden')) closeSearchModal();
  if (typeof setsManagerPanelOpen !== 'undefined' && setsManagerPanelOpen) hideSetManagerPanel();
  if (typeof importManagerPanelOpen !== 'undefined' && importManagerPanelOpen) hideImportManagerPanel();
  if (typeof inboxPanelOpen !== 'undefined' && inboxPanelOpen) hideInboxPanel();
  if (!document.getElementById('trashPanel').classList.contains('hidden')) hideTrashPanel();
  if (!document.getElementById('tagManagerPanel').classList.contains('hidden')) hideTagManagerPanel();
  if (!document.getElementById('settingsPanel').classList.contains('hidden')) hideSettingsPanel();
  if (!document.getElementById('folderModal').classList.contains('hidden')) hideFolderModal();
  if (!document.getElementById('boardSettingsPanel').classList.contains('hidden')) {
    document.getElementById('boardSettingsPanel').classList.add('hidden');
    document.getElementById('modalCard').classList.remove('hidden');
    elements.modalOverlay.classList.add('hidden');
    if (typeof boardSettingsCreatingId !== 'undefined') boardSettingsCreatingId = null;
    if (typeof _boardSettingsCancelSnapshot !== 'undefined') _boardSettingsCancelSnapshot = null;
  }
  if (!document.getElementById('modalCard').classList.contains('hidden')) hideModal();
  if (!document.getElementById('noticeOverlay').classList.contains('hidden')) hideNotice();
  if (!document.getElementById('confirmOverlay').classList.contains('hidden')) hideConfirmDialog();
  if (typeof dragPayload !== 'undefined') dragPayload = null;
  if (typeof removeDragPlaceholders === 'function') removeDragPlaceholders();
  sharedDiskReloadPromptOpen = false;
}

async function reloadHubData(options = {}) {
  const {
    source = 'shared',
    notice = '',
    fallbackToHardReload = false
  } = options;
  if (sharedDiskDataReloadInProgress) return false;
  sharedDiskDataReloadInProgress = true;
  document.documentElement.classList.add('hub-booting');
  try {
    resetTransientUiForDataReload();

    let snapshot = null;
    let databasePath = (state.databasePath || '').trim();
    let fileInfo = null;

    if (source === 'shared') {
      if (typeof bridge === 'undefined') throw new Error('Bridge unavailable');
      await bridge.whenReady;
      if (!bridge.isAvailable() || !bridge.nativeIsAvailable()) throw new Error('Shared storage unavailable');
      const loaded = await bridge.loadState();
      snapshot = loaded?.json || null;
      fileInfo = loaded?.fileInfo || null;
      databasePath = (loaded?.databasePath || state.databasePath || '').trim();
      if (!snapshot) throw new Error('No shared hub data was returned');
      restoreStateSnapshot(snapshot);
      if (databasePath) state.databasePath = databasePath;
      if (fileInfo) setSharedDiskBaseline(fileInfo, databasePath);
      else resetSharedDiskBaseline(databasePath);
      persistStateToLocalCache(snapshot, {
        source: 'shared',
        databasePath,
        sharedBaselineVersion: fileInfo?.version ?? null,
        sharedBaselinePath: databasePath
      });
      startSharedDiskPolling();
    } else {
      snapshot = localStorage.getItem(STORAGE_KEY) || serializeStateSnapshot();
      restoreStateSnapshot(snapshot);
      resetSharedDiskBaseline(state.databasePath || '');
      ensureLocalCacheMetadata(snapshot, {
        source: 'local',
        databasePath: state.databasePath || ''
      });
    }

    undoStack = [];
    redoStack = [];
    isDirty = false;
    renderAll();
    if (typeof updateSidebarExtensionStatus === 'function') updateSidebarExtensionStatus();
    if (typeof updateDatabasePathControls === 'function') await updateDatabasePathControls();
    if (typeof updateAboutBridgeStatus === 'function') await updateAboutBridgeStatus();
    updateUndoRedoUI();
    document.documentElement.classList.remove('hub-booting');
    if (notice) showNotice(notice);
    return true;
  } catch (error) {
    console.error('Failed to reload hub data in-app:', error);
    document.documentElement.classList.remove('hub-booting');
    if (fallbackToHardReload) {
      queueSharedDiskNotice(notice || 'Reloaded hub data.');
      location.reload();
      return false;
    }
    showNotice(`Failed to reload hub data: ${error.message || error}`);
    return false;
  } finally {
    sharedDiskDataReloadInProgress = false;
  }
}

function reloadForSharedDisk(message) {
  void reloadHubData({
    source: 'shared',
    notice: message,
    fallbackToHardReload: true
  });
}

function shouldShowSharedAutoRefreshNotice() {
  return state.settings?.sharedAutoRefreshNotice !== false;
}

function getReloadHubSource() {
  if (typeof bridge !== 'undefined' && bridge.isAvailable() && bridge.nativeIsAvailable() && state.databasePath) {
    return 'shared';
  }
  return 'local';
}

function reloadHubDataManually() {
  const source = getReloadHubSource();
  const notice = source === 'shared'
    ? 'Reloaded hub data from the shared database.'
    : 'Reloaded hub data from the browser cache.';
  void reloadHubData({ source, notice });
}

function parseIsoTime(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function snapshotsMatch(left, right) {
  return computeSnapshotHash(left || '') === computeSnapshotHash(right || '');
}

function localCacheLooksNewerThanShared(localMeta, databasePath, localSnapshot, sharedSnapshot, sharedFileInfo = null) {
  const samePath =
    !databasePath ||
    !localMeta?.databasePath ||
    localMeta.databasePath === databasePath ||
    !localMeta?.sharedBaselinePath ||
    localMeta.sharedBaselinePath === databasePath;
  if (!samePath) return false;
  if (localMeta?.source !== 'local') return false;
  if (snapshotsMatch(localSnapshot, sharedSnapshot)) return false;
  const liveVersion = sharedFileInfo?.version ?? null;
  if (liveVersion !== null && localMeta?.sharedBaselineVersion !== null && localMeta.sharedBaselineVersion === liveVersion) {
    return true;
  }
  const localCachedAt = parseIsoTime(localMeta?.cachedAt);
  if (!localCachedAt) return false;
  const sharedSeenAt = parseIsoTime(localMeta?.sharedSeenAt);
  if (sharedSeenAt && localCachedAt <= sharedSeenAt) return false;
  return true;
}

async function refreshBridgeStatusUi() {
  if (typeof updateSidebarExtensionStatus === 'function') updateSidebarExtensionStatus();
  if (typeof updateDatabasePathControls === 'function') await updateDatabasePathControls();
  if (typeof updateAboutBridgeStatus === 'function') await updateAboutBridgeStatus();
}

async function promoteLocalCacheToShared(options = {}) {
  const { snapshot = localStorage.getItem(STORAGE_KEY) || serializeStateSnapshot(), databasePath = state.databasePath || '', expectedVersion = null } = options;
  try {
    const result = await bridge.saveState(snapshot, { expectedVersion });
    if (!result?.ok) {
      showNotice('Failed to update the shared database from this browser cache.');
      return false;
    }
    if (result.conflict) {
      notifySharedDiskConflict({
        fileInfo: result.fileInfo || null,
        databasePath: result.databasePath || databasePath || state.databasePath || ''
      });
      return false;
    }
    const activePath = (result.databasePath || databasePath || state.databasePath || '').trim();
    if (activePath) state.databasePath = activePath;
    if (result.fileInfo) setSharedDiskBaseline(result.fileInfo, activePath);
    else resetSharedDiskBaseline(activePath);
    persistStateToLocalCache(snapshot, {
      source: 'shared',
      databasePath: activePath,
      sharedBaselineVersion: result.fileInfo?.version ?? null,
      sharedBaselinePath: activePath
    });
    isDirty = false;
    startSharedDiskPolling();
    await refreshBridgeStatusUi();
    showNotice("Updated the shared database from this browser's newer local cache.");
    return true;
  } catch (error) {
    console.error('Failed to update shared database from local cache:', error);
    showNotice(`Failed to update the shared database: ${error.message || error}`);
    return false;
  }
}

async function handleRecoveredSharedStorage(info) {
  const databasePath = (info?.databasePath || '').trim();
  if (!databasePath || sharedDiskSyncIsBlocked()) return;

  const localSnapshot = localStorage.getItem(STORAGE_KEY) || serializeStateSnapshot();
  const localMeta = ensureLocalCacheMetadata(localSnapshot, {
    source: getLocalCacheMeta().source || 'local',
    databasePath
  });
  const loaded = await bridge.loadState();
  const sharedSnapshot = loaded?.json || '';
  const sharedFileInfo = loaded?.fileInfo || null;

  state.databasePath = databasePath;

  if (snapshotsMatch(localSnapshot, sharedSnapshot)) {
    if (sharedFileInfo) setSharedDiskBaseline(sharedFileInfo, databasePath);
    else resetSharedDiskBaseline(databasePath);
    persistStateToLocalCache(localSnapshot, {
      source: 'shared',
      databasePath,
      sharedBaselineVersion: sharedFileInfo?.version ?? null,
      sharedBaselinePath: databasePath
    });
    startSharedDiskPolling();
    await refreshBridgeStatusUi();
    return;
  }

  if (localCacheLooksNewerThanShared(localMeta, databasePath, localSnapshot, sharedSnapshot, sharedFileInfo)) {
    if (sharedRecoveryPromptOpen || sharedDiskReloadPromptOpen || confirmDialogIsOpen()) return;
    sharedRecoveryPromptOpen = true;
    showConfirmDialog(
      `The shared database at ${databasePath} looks older than this browser's cached copy. Update the shared database from the newer local cache now?`,
      () => {
        sharedRecoveryPromptOpen = false;
        void promoteLocalCacheToShared({
          snapshot: localSnapshot,
          databasePath,
          expectedVersion: sharedFileInfo?.version ?? null
        });
      },
      'Update shared',
      () => {
        sharedRecoveryPromptOpen = false;
        blockSharedDiskSync(databasePath);
        showNotice('Shared storage is available again, but this tab is keeping its newer local copy for now. Shared sync is paused until you reload.');
      }
    );
    return;
  }

  await reloadHubData({
    source: 'shared',
    notice: 'Shared storage is available again. Reloaded the latest shared data.'
  });
}

function startSharedRecoveryPolling() {
  if (sharedRecoveryPollTimer) clearInterval(sharedRecoveryPollTimer);
  if (typeof bridge === 'undefined') return;
  sharedRecoveryPollTimer = setInterval(() => {
    checkForSharedRecovery().catch(() => {});
  }, SHARED_DISK_POLL_MS);
}

async function checkForSharedRecovery() {
  if (sharedRecoveryCheckInProgress || sharedDiskDataReloadInProgress) return;
  if (typeof bridge === 'undefined') return;
  sharedRecoveryCheckInProgress = true;
  try {
    await bridge.whenReady;
    const info = await bridge.getStorageInfo();
    const extensionReady = bridge.isAvailable();
    const nativeReady = extensionReady && info?.nativeAvailable === true && !!info.databasePath;
    const databasePath = (info?.databasePath || '').trim();

    if (!nativeReady && sharedDiskPollTimer) {
      clearInterval(sharedDiskPollTimer);
      sharedDiskPollTimer = null;
    }

    const recovered = nativeReady && (!lastBridgeNativeReady || lastBridgeRecoveryPath !== databasePath);
    const statusChanged = lastBridgeNativeReady !== nativeReady || lastBridgeRecoveryPath !== databasePath;

    lastBridgeNativeReady = nativeReady;
    lastBridgeRecoveryPath = databasePath;

    if (statusChanged) await refreshBridgeStatusUi();
    if (recovered) await handleRecoveredSharedStorage(info);
  } finally {
    sharedRecoveryCheckInProgress = false;
  }
}

function promptSharedDiskConflict(detail = {}) {
  if (sharedDiskReloadPromptOpen) return;
  if (confirmDialogIsOpen()) {
    setTimeout(() => promptSharedDiskConflict(detail), 600);
    return;
  }
  sharedDiskReloadPromptOpen = true;
  const path = detail.databasePath || state.databasePath || 'the shared database';
  showConfirmDialog(
    `The shared database changed on disk before this browser finished saving to ${path}. Reload the latest shared copy now?`,
    () => {
      sharedDiskReloadPromptOpen = false;
      reloadForSharedDisk('Reloaded shared database after a save conflict with another browser or sync tool.');
    },
    'Reload',
    () => {
      sharedDiskReloadPromptOpen = false;
      showNotice('Shared disk sync is paused in this tab until you reload. Export JSON if you need to keep this local copy first.');
    }
  );
}

function startSharedDiskPolling() {
  if (sharedDiskPollTimer) clearInterval(sharedDiskPollTimer);
  if (typeof bridge === 'undefined' || !bridge.isAvailable() || !bridge.nativeIsAvailable() || !state.databasePath) return;
  sharedDiskPollTimer = setInterval(() => {
    checkForExternalSharedDiskChanges().catch(() => {});
  }, SHARED_DISK_POLL_MS);
}

async function checkForExternalSharedDiskChanges() {
  if (sharedDiskDataReloadInProgress) return;
  if (typeof bridge === 'undefined' || !bridge.isAvailable() || !bridge.nativeIsAvailable()) return;
  const live = await bridge.getDatabaseFileInfo();
  const livePath = (live?.databasePath || '').trim();
  if (!livePath) return;
  if (livePath !== (state.databasePath || '').trim()) {
    state.databasePath = livePath;
    resetSharedDiskBaseline(livePath);
    persistStateToLocalCache(JSON.stringify(state), {
      source: 'local',
      databasePath: livePath,
      sharedBaselineVersion: null,
      sharedBaselinePath: livePath
    });
    if (typeof updateDatabasePathControls === 'function') await updateDatabasePathControls();
    if (typeof updateAboutBridgeStatus === 'function') await updateAboutBridgeStatus();
  }
  if (sharedDiskSyncIsBlocked()) return;
  const liveVersion = live?.fileInfo?.version || null;
  const baselineVersion = getSharedDiskBaselineVersion();
  if (liveVersion === baselineVersion) return;
  if (liveVersion === null && baselineVersion === null) return;
  const loaded = await bridge.loadState();
  const liveJson = loaded?.json || null;
  const currentJson = typeof serializeStateSnapshot === 'function' ? serializeStateSnapshot() : JSON.stringify(state);
  if (liveJson && liveJson === currentJson) {
    setSharedDiskBaseline(loaded?.fileInfo || live?.fileInfo || null, livePath);
    persistStateToLocalCache(currentJson, {
      source: 'shared',
      databasePath: livePath,
      sharedBaselineVersion: (loaded?.fileInfo || live?.fileInfo || null)?.version ?? null,
      sharedBaselinePath: livePath
    });
    return;
  }
  if (sharedDiskReloadPromptOpen || confirmDialogIsOpen()) return;
  if (hasPendingSharedDiskChanges()) {
    sharedDiskReloadPromptOpen = true;
    showConfirmDialog(
      `The shared database changed on disk at ${livePath}. Reload now and discard this window's newer local copy?`,
      () => {
        sharedDiskReloadPromptOpen = false;
        reloadForSharedDisk(shouldShowSharedAutoRefreshNotice()
          ? 'Reloaded shared database after detecting an external change.'
          : '');
      },
      'Reload',
      () => { sharedDiskReloadPromptOpen = false; }
    );
    return;
  }
  reloadForSharedDisk(shouldShowSharedAutoRefreshNotice()
    ? 'Reloaded shared database after detecting an external change.'
    : '');
}


// --- Trash panel ---

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatTimeSince(ts) {
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function getTrashItemLabel(entry) {
  const a = entry.source?.area;
  if (a === 'nav-board') return 'Board';
  if (a === 'folder-board') return 'Board';
  if (a === 'set') return 'Set';
  if (a === 'nav-item') {
    const t = entry.item?.type;
    return t === 'folder' ? 'Nav folder' : t === 'title' ? 'Nav title' : 'Nav item';
  }
  if (a === 'speed-dial') return 'Speed dial';
  if (a === 'essential') return 'Essential';
  const t = entry.item?.type;
  return t === 'folder' ? 'Folder' : t === 'bookmark' ? 'Bookmark' : t === 'title' ? 'Title' : 'Item';
}

function renderTrashPanel() {
  const list = document.getElementById('trashList');
  const emptyEl = document.getElementById('trashEmpty');
  const clearBtn = document.getElementById('trashClearAllBtn');
  const count = recentlyDeleted.length;
  updateTrashBadge();
  if (count === 0) {
    list.innerHTML = '';
    emptyEl.classList.remove('hidden');
    clearBtn.disabled = true;
    return;
  }
  emptyEl.classList.add('hidden');
  clearBtn.disabled = false;
  list.innerHTML = '';
  for (const entry of recentlyDeleted) {
    const name = entry.item?.title || entry.item?.navItem?.title || entry.item?.board?.title || '(untitled)';
    const div = document.createElement('div');
    div.className = 'trash-item';
    div.innerHTML = `
      <div class="trash-item-info">
        <span class="trash-item-name">${escapeHtml(name)}</span>
        <span class="trash-item-meta">${getTrashItemLabel(entry)} · ${formatTimeSince(entry.deletedAt)}</span>
      </div>
      <div class="trash-item-actions">
        <button class="secondary-btn trash-restore-btn" data-trash-id="${entry.trashId}">Restore</button>
        <button class="danger-btn trash-delete-btn" data-trash-id="${entry.trashId}">×</button>
      </div>`;
    list.appendChild(div);
  }
}

function showTrashPanel() {
  document.getElementById('modalCard').classList.add('hidden');
  const panel = document.getElementById('trashPanel');
  panel.classList.remove('hidden');
  elements.modalOverlay.classList.remove('hidden');
  centerPanel(panel);
  makeDraggable(panel, document.getElementById('trashDragHandle'));
  renderTrashPanel();
}

function hideTrashPanel() {
  document.getElementById('trashPanel').classList.add('hidden');
  document.getElementById('modalCard').classList.remove('hidden');
  elements.modalOverlay.classList.add('hidden');
}

function confirmDelete(settingKey, message, onConfirm) {
  if (!state.settings[settingKey]) { onConfirm(); return; }
  showConfirmDialog(message, onConfirm);
}

// --- Draggable panels ---

function makeDraggable(panel, handle, onDrop) {
  if (panel.dataset.draggableAttached) return;
  panel.dataset.draggableAttached = '1';
  handle.addEventListener('mousedown', e => {
    if (e.target.closest('input, select, button, textarea, label')) return;
    e.preventDefault();
    const rect = panel.getBoundingClientRect();
    let ox = e.clientX - rect.left, oy = e.clientY - rect.top;
    const onMove = e => {
      const x = Math.min(Math.max(0, e.clientX - ox), window.innerWidth - panel.offsetWidth);
      const y = Math.min(Math.max(0, e.clientY - oy), window.innerHeight - panel.offsetHeight);
      panel.style.left = x + 'px';
      panel.style.top  = y + 'px';
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (onDrop) onDrop();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

function centerPanel(panel) {
  requestAnimationFrame(() => {
    panel.classList.add('draggable');
    panel.style.left = Math.round((window.innerWidth  - panel.offsetWidth)  / 2) + 'px';
    panel.style.top  = Math.round((window.innerHeight - panel.offsetHeight) / 2) + 'px';
  });
}

// --- Init ---

function attachEventListeners() {
  document.getElementById('aboutBtn').addEventListener('click', () => showSettingsPanel('about'));
  elements.quickSearchBtn?.addEventListener('click', () => openSearchModal({}));
  elements.quickTagManagerBtn?.addEventListener('click', showTagManagerPanel);
  elements.quickSettingsBtn?.addEventListener('click', () => showSettingsPanel('general'));
  document.getElementById('trashBtn').addEventListener('click', showTrashPanel);
  document.getElementById('trashCloseBtn').addEventListener('click', hideTrashPanel);
  document.getElementById('trashClearAllBtn').addEventListener('click', () => {
    clearTrash();
    renderTrashPanel();
  });
  document.getElementById('trashList').addEventListener('click', e => {
    const restoreBtn = e.target.closest('.trash-restore-btn');
    const deleteBtn = e.target.closest('.trash-delete-btn');
    if (restoreBtn) {
      restoreFromTrash(restoreBtn.dataset.trashId);
      renderAll();
      saveState();
      renderTrashPanel();
    } else if (deleteBtn) {
      removeTrashItem(deleteBtn.dataset.trashId);
      renderTrashPanel();
    }
  });
  document.getElementById('undoBtn').addEventListener('click', undo);
  document.getElementById('redoBtn').addEventListener('click', redo);

  document.getElementById('bulkDeleteBtn').addEventListener('click', () => {
    const n = selectedItemIds.size;
    if (!n) return;
    const isImportSelection = selectionContext === 'import-manager';
    showConfirmDialog(isImportSelection
      ? `Delete ${n} selected imported ${n > 1 ? 'items' : 'item'}?`
      : `Delete ${n} selected ${n > 1 ? 'items' : 'item'}?`, () => {
      pushUndoSnapshot();
      if (isImportSelection) {
        const toDelete = collectSelectedImportManagerItems(selectedItemIds);
        toDelete.forEach(item => removeImportManagerItemById(item.id));
        clearSelection();
        renderAll();
        saveState();
        return;
      }
      const board = getActiveBoard();
      for (const itemId of [...selectedItemIds]) {
        const found = findBoardItemInColumns(board, itemId);
        if (found?.item) {
          pushToTrash(cloneData(found.item), { area: 'board-item', boardId: board.id });
          found.list.splice(found.list.indexOf(found.item), 1);
        }
      }
      clearSelection();
      renderAll();
      saveState();
      updateTrashBadge();
    }, `Delete ${n} ${n === 1 ? 'Item' : 'Items'}`);
  });
  document.getElementById('bulkTagBtn').addEventListener('click', () => {
    showModal('bulkAddTags', { title: 'Add Tags to Selected', showName: false, showTags: true });
  });
  document.getElementById('bulkMoveBtn').addEventListener('click', () => {
    const isImportSelection = selectionContext === 'import-manager';
    const ab = getActiveBoard();
    const activeTab = getActiveTab();
    const selectOptions = _sortedInboxTargetOptions(
      state.boards.filter(b => !b.locked),
      isImportSelection
        ? {}
        : { excludeBoardId: ab?.id || null, excludeTabId: activeTab?.id || null }
    );
    if (!selectOptions.length) { alert('No other tab inboxes to move to.'); return; }
    showModal('bulkMoveToBoard', {
      title: isImportSelection ? 'Send Selected to Tab Inbox' : 'Move Selected to Tab Inbox',
      showName: false,
      showSelect: true,
      selectLabel: 'Target tab inbox',
      selectOptions
    });
  });
  document.getElementById('bulkDeselectBtn').addEventListener('click', clearSelection);

  document.getElementById('sidebarCollapseBtn').addEventListener('click', () => {
    const sidebar = document.getElementById('navSidebar');
    const appShell = document.querySelector('.app-shell');
    const collapsed = sidebar.classList.toggle('collapsed');
    appShell.classList.toggle('sidebar-collapsed', collapsed);
    const btn = document.getElementById('sidebarCollapseBtn');
    btn.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
    btn.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
  });

  elements.boardSettingsBtn.addEventListener('click', () => {
    showBoardMetaModal('edit');
  });
  elements.speedDialToggleBtn?.addEventListener('click', () => {
    const board = getActiveBoardContainer();
    if (!board) return;
    pushUndoSnapshot();
    board.showSpeedDial = board.showSpeedDial === false;
    renderBoard();
    saveState();
  });
  elements.setBarToggleBtn?.addEventListener('click', () => {
    const board = getActiveBoardContainer();
    const tab = getActiveTab();
    if (!board || !tab) return;
    pushUndoSnapshot();
    tab.showSetBar = tab.showSetBar === false;
    syncBoardCompatibilityFields(board, tab.id);
    renderBoard();
    saveState();
  });
  makeDraggable(document.getElementById('modalCard'), document.getElementById('modalCardHeader'));
  elements.modalCancelBtn.addEventListener('click', hideModal);
  elements.modalOverlay.addEventListener('click', event => {
    if (event.target !== elements.modalOverlay) return;
    if (!document.getElementById('settingsPanel').classList.contains('hidden')) {
      hideSettingsPanel();
    } else if (!document.getElementById('boardSettingsPanel').classList.contains('hidden')) {
      cancelBoardSettingsPanel();
    } else if (!document.getElementById('trashPanel').classList.contains('hidden')) {
      hideTrashPanel();
    } else if (typeof importManagerPanelOpen !== 'undefined' && importManagerPanelOpen) {
      hideImportManagerPanel();
    } else {
      hideModal();
    }
  });
  elements.modalForm.addEventListener('submit', handleModalSubmit);
  document.getElementById('modalSpeedDialSlots')?.addEventListener('input', handleModalSpeedDialSlotsInput);
  document.getElementById('cmCollectionShowSpeedDial')?.addEventListener('change', handleModalCollectionShowSpeedDialChange);
  elements.modalInput2.addEventListener('input', () => {
    if (activeModal !== 'addBookmark') return;
    const url = elements.modalInput2.value.trim();
    const warning = document.getElementById('modalDuplicateWarning');
    if (!warning) return;
    if (!url) { warning.classList.add('hidden'); return; }
    const dup = findDuplicateUrl(url);
    if (dup) {
      warning.textContent = `Already saved: "${dup.item.title}"`;
      warning.classList.remove('hidden');
    } else {
      warning.classList.add('hidden');
    }
  });
  initChipInput(elements.modalInput3, tagChipOpts());
  initChipInput(elements.modalInput4, tagChipOpts());
  elements.navList.addEventListener('contextmenu', handleNavListContextMenu);
  elements.navList.addEventListener('dragover', handleNavListDragOver);
  elements.navList.addEventListener('drop', handleNavListDrop);
  elements.speedDial.addEventListener('contextmenu', event => {
    if (event.target.closest('.speed-link')) return;
    event.preventDefault();
    if (getActiveBoard()?.locked) return;
    contextTarget = { area: 'speed-dial' };
    showContextMenu(event.clientX, event.clientY, [
      { label: 'Add bookmark', action: 'addSpeedDialBookmark' }
    ]);
  });
  elements.speedDial.addEventListener('dragover', handleSpeedDialContainerDragOver);
  elements.speedDial.addEventListener('drop', handleSpeedDialContainerDrop);
  document.getElementById('confirmOkBtn').addEventListener('click', () => {
    const cb = confirmCallback;
    hideConfirmDialog();
    if (cb) {
      try { cb(); } catch (err) {
        console.error('[confirmOkBtn] callback threw:', err);
        showNotice(`An error occurred: ${err.message || err}`);
      }
    }
  });
  document.getElementById('confirmCancelBtn').addEventListener('click', () => hideConfirmDialog({ invokeCancel: true }));
  document.getElementById('confirmOverlay').addEventListener('click', e => {
    if (e.target === document.getElementById('confirmOverlay')) hideConfirmDialog({ invokeCancel: true });
  });

  document.getElementById('noticeOkBtn').addEventListener('click', hideNotice);
  document.getElementById('noticeOverlay').addEventListener('click', e => {
    if (e.target === document.getElementById('noticeOverlay')) hideNotice();
  });

  document.addEventListener('click', event => {
    if (!elements.contextMenu.contains(event.target)) hideContextMenu();
  });

  window.addEventListener('beforeunload', event => {
    if (isDirty && state.settings.warnOnClose) {
      event.preventDefault();
      event.returnValue = '';
    }
  });

  document.getElementById('searchModalCloseBtn').addEventListener('click', closeSearchModal);

  document.getElementById('searchModalInput').addEventListener('input', () => {
    const q = elements.searchModalInput.value.trim();
    if (q || activeTagFilters.size > 0) renderSearchResults();
    else elements.searchModalResults.innerHTML = '';
  });

  document.getElementById('searchModal').addEventListener('click', e => {
    // filter chips (Name, URL, Show types)
    const chip = e.target.closest('.search-filter-chip');
    if (chip) {
      const key = chip.dataset.filter;
      if (key === 'tags') {
        // toggle tag picker panel
        const pickerEl = document.getElementById('searchTagPicker');
        const willShow = pickerEl.classList.contains('hidden');
        _showTagPicker(willShow);
        if (willShow) renderSearchResults();
        return;
      }
      searchFilters[key] = !searchFilters[key];
      chip.classList.toggle('active', searchFilters[key]);
      const q = elements.searchModalInput.value.trim();
      if (q || activeTagFilters.size > 0) renderSearchResults();
      return;
    }

    // sort buttons in tag picker
    const sortBtn = e.target.closest('.search-tag-sort-btn');
    if (sortBtn) {
      document.querySelectorAll('.search-tag-sort-btn').forEach(b => b.classList.remove('active'));
      sortBtn.classList.add('active');
      _tagPickerSort = sortBtn.dataset.sort;
      renderSearchResults();
      return;
    }

    // AND/OR mode button
    if (e.target.id === 'searchTagModeBtn') {
      _tagFilterMode = _tagFilterMode === 'or' ? 'and' : 'or';
      e.target.dataset.mode = _tagFilterMode;
      e.target.textContent = _tagFilterMode === 'and' ? 'ALL' : 'ANY';
      renderSearchResults();
      return;
    }

    // tag chip clicks in picker list
    const pickerChip = e.target.closest('#searchTagPickerList .tag-chip');
    if (pickerChip) {
      const id = pickerChip.dataset.tagId;
      if (activeTagFilters.has(id)) activeTagFilters.delete(id);
      else activeTagFilters.add(id);
      renderSearchResults();
    }
  });

  document.addEventListener('keydown', event => {
    const inInput = document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);

    if (event.ctrlKey && event.key === 'z' && !event.shiftKey) {
      event.preventDefault();
      undo();
      return;
    }

    if (event.ctrlKey && (event.key === 'y' || (event.key === 'z' && event.shiftKey))) {
      event.preventDefault();
      redo();
      return;
    }

    if (event.ctrlKey && event.key === 'f') {
      event.preventDefault();
      openSearchModal({});
      return;
    }

    if (!inInput && event.key === '/') {
      event.preventDefault();
      openSearchModal({});
      return;
    }

    if (!inInput && (event.key === 'n' || event.key === 'N') && elements.modalOverlay.classList.contains('hidden')) {
      const board = getActiveBoard();
      const tab = getActiveTab();
      if (board && tab && (tab.columns || []).length) {
        const columnId = lastActiveColumnId || tab.columns[0]?.id;
        contextTarget = { area: 'board-empty', columnId };
        showModal('addBookmark', {
          title: 'New Bookmark', placeholder1: 'New Bookmark',
          showUrl: true, placeholder2: 'Bookmark URL',
          showTags: true, inheritedTags: getContextInheritedTags(contextTarget)
        });
        event.preventDefault();
        return;
      }
    }

    if (event.key !== 'Escape') return;
    if (!document.getElementById('noticeOverlay').classList.contains('hidden')) { hideNotice(); return; }
    if (!document.getElementById('confirmOverlay').classList.contains('hidden')) { hideConfirmDialog({ invokeCancel: true }); return; }
    if (!elements.searchModal.classList.contains('hidden')) { closeSearchModal(); return; }
    if (!elements.contextMenu.classList.contains('hidden')) { hideContextMenu(); return; }
    if (typeof setsManagerPanelOpen !== 'undefined' && setsManagerPanelOpen) { hideSetManagerPanel(); return; }
    if (typeof importManagerPanelOpen !== 'undefined' && importManagerPanelOpen) { hideImportManagerPanel(); return; }
    if (!document.getElementById('trashPanel').classList.contains('hidden')) { hideTrashPanel(); return; }
    if (!document.getElementById('tagManagerPanel').classList.contains('hidden')) { hideTagManagerPanel(); return; }
    if (!document.getElementById('settingsPanel').classList.contains('hidden')) { hideSettingsPanel(); return; }
    if (!document.getElementById('boardSettingsPanel').classList.contains('hidden')) { cancelBoardSettingsPanel(); return; }
    if (selectedItemIds.size > 0) { clearSelection(); return; }
    if (!elements.modalOverlay.classList.contains('hidden')) { hideModal(); return; }
  });

  document.addEventListener('dragover', event => {
    if (isExternalDrag(event)) event.preventDefault();
  });
  document.addEventListener('drop', event => {
    if (isExternalDrag(event)) event.preventDefault();
  });

  // Receive a tab sent by the extension popup → drop into the active board's inbox.
  window.addEventListener('morpheus:receive-tab', e => {
    const { url, title } = e.detail;
    const board = getActiveBoard();
    if (!board || board.locked) return;
    const inbox = getBoardInbox(board, getActiveTab());
    if (!inbox) return;
    pushUndoSnapshot();
    inbox.items.push({
      id: `bm-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      type: 'bookmark',
      title: title || url || 'Untitled',
      url,
      tags: [],
      faviconCache: ''
    });
    saveState();
    renderNav();
    updateInboxBadge();
    if (typeof inboxPanelOpen !== 'undefined' && inboxPanelOpen) renderInboxPanel();
  });

  window.addEventListener('morpheus:shared-disk-conflict', e => {
    promptSharedDiskConflict(e.detail || {});
  });
}

attachEventListeners();
attachSettingsListeners();
attachBoardSettingsListeners();
attachFolderModalListeners();
attachInboxListeners();
attachImportManagerListeners();
attachSetPanelListeners();
attachBookmarkImportListener();

async function initializeHubState() {
  let loadedFromShared = false;
  try {
    if (typeof bridge !== 'undefined') {
      await bridge.whenReady;
      if (bridge.isAvailable()) {
        const info = await bridge.getStorageInfo();
        if (info?.nativeAvailable && info.databasePath) {
          const loaded = await bridge.loadState();
          if (loaded?.json) {
            restoreStateSnapshot(loaded.json);
          } else {
            state = loadState();
            ensureLocalCacheMetadata(localStorage.getItem(STORAGE_KEY), {
              source: 'local',
              databasePath: state.databasePath || info.databasePath || ''
            });
          }
          state.databasePath = info.databasePath;
          if (loaded?.fileInfo) setSharedDiskBaseline(loaded.fileInfo, info.databasePath);
          else resetSharedDiskBaseline(info.databasePath);
          persistStateToLocalCache(null, {
            source: loaded?.json ? 'shared' : 'local',
            databasePath: info.databasePath,
            sharedBaselineVersion: loaded?.fileInfo?.version ?? null,
            sharedBaselinePath: info.databasePath
          });
          startSharedDiskPolling();
          loadedFromShared = true;
        }
      }
    }
    if (!loadedFromShared) {
      state = loadState();
      resetSharedDiskBaseline(state.databasePath || '');
      ensureLocalCacheMetadata(localStorage.getItem(STORAGE_KEY), {
        source: 'local',
        databasePath: state.databasePath || ''
      });
    }
  } catch (error) {
    console.warn('Failed to initialize hub state from preferred source, falling back to browser cache.', error);
    state = loadState();
    resetSharedDiskBaseline(state.databasePath || '');
    ensureLocalCacheMetadata(localStorage.getItem(STORAGE_KEY), {
      source: 'local',
      databasePath: state.databasePath || ''
    });
  }

  renderAll();
  if (typeof updateSidebarExtensionStatus === 'function') updateSidebarExtensionStatus();
  updateUndoRedoUI();
  isDirty = false;
  document.documentElement.classList.remove('hub-booting');
  lastBridgeNativeReady = typeof bridge !== 'undefined' && bridge.isAvailable() && bridge.nativeIsAvailable() && !!state.databasePath;
  lastBridgeRecoveryPath = (state.databasePath || '').trim();
  startSharedRecoveryPolling();

  try {
    const sharedDiskNotice = sessionStorage.getItem(SHARED_DISK_NOTICE_KEY);
    if (sharedDiskNotice) {
      sessionStorage.removeItem(SHARED_DISK_NOTICE_KEY);
      requestAnimationFrame(() => showNotice(sharedDiskNotice));
    }
  } catch {}
}

initializeHubState();
