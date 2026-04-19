const APP_VERSION = '0.10.0';

let activeModal = null;
let contextTarget = null;
let lastActiveColumnId = null;

let confirmCallback = null;

// --- Undo / redo ---

const MAX_UNDO = 50;
let undoStack = [];
let redoStack = [];

// --- Bulk selection ---

let selectedItemIds = new Set();

function toggleItemSelection(itemId, itemEl) {
  if (selectedItemIds.has(itemId)) {
    selectedItemIds.delete(itemId);
    itemEl?.classList.remove('selected');
  } else {
    selectedItemIds.add(itemId);
    itemEl?.classList.add('selected');
  }
  updateBulkToolbar();
}

function clearSelection() {
  selectedItemIds.clear();
  document.querySelectorAll('.board-column-item.selected').forEach(el => el.classList.remove('selected'));
  updateBulkToolbar();
}

function updateBulkToolbar() {
  const toolbar = document.getElementById('bulkToolbar');
  const countEl = document.getElementById('bulkCount');
  if (!toolbar) return;
  const n = selectedItemIds.size;
  toolbar.classList.toggle('hidden', n === 0);
  if (countEl) countEl.textContent = `${n} selected`;
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
  saveState();
  renderAll();
  updateUndoRedoUI();
}

function redo() {
  if (!redoStack.length) return;
  undoStack.push(JSON.stringify(state));
  restoreStateSnapshot(redoStack.pop());
  saveState();
  renderAll();
  updateUndoRedoUI();
}

function updateUndoRedoUI() {
  const undoBtn = document.getElementById('undoBtn');
  const redoBtn = document.getElementById('redoBtn');
  if (undoBtn) undoBtn.disabled = undoStack.length === 0;
  if (redoBtn) redoBtn.disabled = redoStack.length === 0;
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

function showConfirmDialog(message, onConfirm, okLabel = 'Delete') {
  confirmCallback = onConfirm;
  document.getElementById('confirmMessage').textContent = message;
  document.getElementById('confirmOkBtn').textContent = okLabel;
  document.getElementById('confirmOverlay').classList.remove('hidden');
}

function hideConfirmDialog() {
  confirmCallback = null;
  document.getElementById('confirmOverlay').classList.add('hidden');
  document.getElementById('confirmOkBtn').textContent = 'Delete';
}

function showAboutPanel() {
  document.getElementById('modalCard').classList.add('hidden');
  const panel = document.getElementById('aboutPanel');
  panel.classList.remove('hidden');
  elements.modalOverlay.classList.remove('hidden');
  centerPanel(panel);
  makeDraggable(panel, document.getElementById('aboutDragHandle'));
}

function hideAboutPanel() {
  document.getElementById('aboutPanel').classList.add('hidden');
  document.getElementById('modalCard').classList.remove('hidden');
  elements.modalOverlay.classList.add('hidden');
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
    const name = entry.item?.title || entry.item?.navItem?.title || '(untitled)';
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
  panel.classList.add('draggable');
  panel.style.left = Math.round((window.innerWidth  - panel.offsetWidth)  / 2) + 'px';
  panel.style.top  = Math.round((window.innerHeight - panel.offsetHeight) / 2) + 'px';
}

// --- Init ---

function attachEventListeners() {
  elements.globalSettingsBtn.addEventListener('click', showSettingsPanel);
  document.getElementById('aboutBtn').addEventListener('click', showAboutPanel);
  document.getElementById('aboutCloseBtn').addEventListener('click', hideAboutPanel);
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
    showConfirmDialog(`Delete ${n} selected ${n > 1 ? 'items' : 'item'}?`, () => {
      pushUndoSnapshot();
      const board = getActiveBoard();
      for (const itemId of [...selectedItemIds]) {
        const found = findBoardItemInColumns(board, itemId);
        if (found?.item) {
          pushToTrash(JSON.parse(JSON.stringify(found.item)), { area: 'board-item', boardId: board.id });
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
    const ab = getActiveBoard();
    const boards = ab?.isImportManager
      ? state.boards.filter(b => !b.isImportManager)
      : state.boards.filter(b => !b.isImportManager && b.id !== ab?.id);
    if (!boards.length) { alert('No other boards to move to.'); return; }
    showModal('bulkMoveToBoard', {
      title: 'Move Selected to Board',
      showName: false,
      showSelect: true,
      selectLabel: 'Target board',
      selectOptions: boards.map(b => ({ value: b.id, label: b.title }))
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

  elements.boardSettingsBtn.addEventListener('click', () => showBoardSettingsPanel());
  elements.modalCancelBtn.addEventListener('click', hideModal);
  elements.modalOverlay.addEventListener('click', event => {
    if (event.target !== elements.modalOverlay) return;
    if (!document.getElementById('settingsPanel').classList.contains('hidden')) {
      hideSettingsPanel();
    } else if (!document.getElementById('boardSettingsPanel').classList.contains('hidden')) {
      cancelBoardSettingsPanel();
    } else if (!document.getElementById('aboutPanel').classList.contains('hidden')) {
      hideAboutPanel();
    } else if (!document.getElementById('trashPanel').classList.contains('hidden')) {
      hideTrashPanel();
    } else {
      hideModal();
    }
  });
  elements.modalForm.addEventListener('submit', handleModalSubmit);
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
  attachTagAutocomplete(elements.modalInput3);
  elements.navList.addEventListener('contextmenu', handleNavListContextMenu);
  elements.navList.addEventListener('dragover', handleNavListDragOver);
  elements.navList.addEventListener('drop', handleNavListDrop);
  elements.speedDial.addEventListener('contextmenu', event => {
    if (event.target.closest('.speed-link')) return;
    event.preventDefault();
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
    if (cb) cb();
  });
  document.getElementById('confirmCancelBtn').addEventListener('click', hideConfirmDialog);
  document.getElementById('confirmOverlay').addEventListener('click', e => {
    if (e.target === document.getElementById('confirmOverlay')) hideConfirmDialog();
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

  document.getElementById('searchInput').addEventListener('input', e => {
    const q = e.target.value.trim();
    if (q) {
      renderSearchResults(q);
      elements.mainPanel.classList.add('search-active');
      elements.searchResultsPane.classList.remove('hidden');
    } else {
      elements.mainPanel.classList.remove('search-active');
      elements.searchResultsPane.classList.add('hidden');
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
      elements.searchInput.focus();
      return;
    }

    if (!inInput && event.key === '/') {
      event.preventDefault();
      elements.searchInput.focus();
      return;
    }

    if (!inInput && (event.key === 'n' || event.key === 'N') && elements.modalOverlay.classList.contains('hidden')) {
      const board = getActiveBoard();
      if (board) {
        const columnId = lastActiveColumnId || board.columns[0]?.id;
        contextTarget = { area: 'board-empty', columnId };
        showModal('addBookmark', {
          title: 'Add Bookmark', placeholder1: 'Bookmark title',
          showUrl: true, placeholder2: 'Bookmark URL',
          showTags: true
        });
        event.preventDefault();
        return;
      }
    }

    if (event.key !== 'Escape') return;
    if (!document.getElementById('confirmOverlay').classList.contains('hidden')) { hideConfirmDialog(); return; }
    if (elements.searchInput.value) {
      elements.searchInput.value = '';
      elements.mainPanel.classList.remove('search-active');
      elements.searchResultsPane.classList.add('hidden');
      return;
    }
    if (!elements.contextMenu.classList.contains('hidden')) { hideContextMenu(); return; }
    if (!document.getElementById('aboutPanel').classList.contains('hidden')) { hideAboutPanel(); return; }
    if (!document.getElementById('trashPanel').classList.contains('hidden')) { hideTrashPanel(); return; }
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
    if (!board) return;
    const inbox = getBoardInbox(board);
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
}

attachEventListeners();
attachSettingsListeners();
attachBoardSettingsListeners();
attachFolderModalListeners();
attachInboxListeners();
attachBookmarkImportListener();
renderAll();
saveState();
updateUndoRedoUI();

// If localStorage is empty and bridge storage has a backup, restore from it.
if (typeof bridge !== 'undefined') {
  bridge.whenReady.then(async () => {
    if (!bridge.isAvailable()) return;
    if (localStorage.getItem('morpheus-webhub-state')) return; // already have local state
    const json = await bridge.loadState();
    if (!json) return;
    restoreStateSnapshot(json);
    localStorage.setItem('morpheus-webhub-state', json);
    renderAll();
  });
}
