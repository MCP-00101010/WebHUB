const APP_VERSION = '0.7.1';

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

// --- Modal ---

function showModal(type, options = {}) {
  activeModal = type;
  if (options.contextTarget) contextTarget = options.contextTarget;
  elements.modalOverlay.classList.remove('hidden');
  elements.modalTitle.textContent = options.title || 'Action';
  elements.modalLabel1.textContent = options.label1 || 'Name';
  elements.modalInput1.value = options.value1 || '';
  elements.modalInput2.value = options.value2 || '';
  elements.modalInput3.value = options.value3 || '';
  const showName = options.showName !== false;
  elements.modalNameRow.classList.toggle('hidden', !showName);
  elements.modalUrlRow.classList.toggle('hidden', !options.showUrl);
  elements.modalTagsRow.classList.toggle('hidden', !options.showTags);
  elements.modalSelectRow.classList.toggle('hidden', !options.showSelect);
  if (elements.modalTagsLabel) elements.modalTagsLabel.textContent = options.label3 || 'Tags';
  elements.modalInput1.placeholder = options.placeholder1 || 'Enter name';
  elements.modalInput2.placeholder = options.placeholder2 || 'Enter URL';
  const selectLabel = document.getElementById('modalSelectLabel');
  if (selectLabel) selectLabel.textContent = options.selectLabel || 'Select';
  if (options.selectOptions) {
    elements.modalSelect.innerHTML = '';
    options.selectOptions.forEach(({ value, label }) => elements.modalSelect.appendChild(new Option(label, value)));
  } else {
    elements.modalSelect.value = options.selectValue || '';
  }
  document.getElementById('modalDuplicateWarning')?.classList.add('hidden');
  if (showName) {
    elements.modalInput1.focus();
  } else if (options.showTags) {
    elements.modalInput3.focus();
  } else if (options.showSelect) {
    elements.modalSelect.focus();
  }
}

function hideModal() {
  activeModal = null;
  elements.modalOverlay.classList.add('hidden');
  document.getElementById('tagSuggestions')?.classList.add('hidden');
  document.getElementById('modalDuplicateWarning')?.classList.add('hidden');
}

// --- Tag autocomplete ---

function getTagSuggestions(partial, input) {
  if (!partial) return [];
  const known = getKnownTags();
  const current = input.value.split(/\s+/).filter(Boolean);
  return known.filter(t => t.startsWith(partial) && t !== partial && !current.includes(t));
}

function renderTagSuggestions(input) {
  const pos = input.selectionStart;
  if (pos !== input.value.length) return;

  const val = input.value;
  const partial = val.split(/\s+/).pop();
  if (!partial) return;

  const suggestions = getTagSuggestions(partial, input);
  if (!suggestions.length) return;

  const completion = suggestions[0].slice(partial.length);
  if (!completion) return;

  input.value = val + completion;
  input.setSelectionRange(val.length, input.value.length);
}

function attachTagAutocomplete(input) {
  input.addEventListener('input', () => renderTagSuggestions(input));
  input.addEventListener('keydown', e => {
    const start = input.selectionStart;
    const end = input.selectionEnd;
    if ((e.key === 'Tab' || e.key === 'ArrowRight') && start !== end && end === input.value.length) {
      e.preventDefault();
      const accepted = input.value.slice(0, end);
      input.value = accepted + ' ';
      input.setSelectionRange(accepted.length + 1, accepted.length + 1);
    }
  });
}

function handleModalSubmit(event) {
  event.preventDefault();
  const value1 = elements.modalInput1.value.trim();
  const value2 = elements.modalInput2.value.trim();
  const value3 = elements.modalInput3.value.trim();
  const tags = value3 ? value3.split(/\s+/).filter(Boolean) : [];

  const noNameRequired = ['moveToBoard', 'bulkMoveToBoard', 'bulkAddTags'];
  if (!value1 && !noNameRequired.includes(activeModal)) return;

  pushUndoSnapshot();

  const area = contextTarget?.area;

  switch (activeModal) {
    case 'addBookmark':
      if (area === 'speed-dial' || area === 'speed-dial-item') {
        addSpeedDialBookmark(value1, value2, tags);
      } else if (area === 'essential') {
        if (!setEssential(contextTarget.slot, value1, value2, tags)) return;
        hideModal(); renderEssentials(); saveState(); return;
      } else {
        addBookmark(value1, value2, contextTarget?.columnId, tags);
      }
      break;
    case 'editBookmark':
      if (area === 'speed-dial-item') {
        if (!isValidUrl(value2)) { alert('Please enter a valid URL.'); return; }
        const board = getActiveBoard();
        const sdItem = board.speedDial.find(i => i.id === contextTarget?.itemId);
        if (sdItem) { if (normalizeUrl(value2) !== sdItem.url) sdItem.faviconCache = ''; sdItem.title = value1; sdItem.url = normalizeUrl(value2); sdItem.tags = tags; }
      } else if (area === 'essential') {
        if (!setEssential(contextTarget.slot, value1, value2, tags)) return;
        hideModal(); renderEssentials(); saveState(); return;
      } else {
        editBookmarkContext(value1, value2, tags, contextTarget);
      }
      break;
    case 'addFolder': {
      const parent = contextTarget?.item;
      if (area === 'nav-empty') {
        addNavSection({ type: 'folder', title: value1 });
      } else if (area === 'nav-subfolder') {
        if (parent) { parent.children = parent.children || []; parent.children.push({ id: `id-${Date.now()}`, type: 'folder', title: value1, children: [] }); parent.collapsed = false; }
      }
      break;
    }
    case 'addTitle':
      if (area === 'nav-empty') {
        addNavSection({ type: 'title', title: value1 });
      } else {
        addBookmarkItem('title', value1, contextTarget?.columnId);
      }
      break;
    case 'renameItem':
      renameContextItem(value1, contextTarget);
      break;
    case 'moveToBoard': {
      const targetBoardId = elements.modalSelect.value;
      const targetBoard = state.boards.find(b => b.id === targetBoardId);
      if (!targetBoard || !contextTarget?.item) break;
      const capturedItem = JSON.parse(JSON.stringify(contextTarget.item));
      deleteBoardTarget(contextTarget);
      targetBoard.columns[0].items.push(capturedItem);
      break;
    }
    case 'bulkAddTags': {
      const newTags = value3 ? value3.split(/\s+/).filter(Boolean) : [];
      if (!newTags.length) { hideModal(); return; }
      const board = getActiveBoard();
      for (const itemId of selectedItemIds) {
        const found = findBoardItemInColumns(board, itemId);
        if (found?.item) found.item.tags = [...new Set([...(found.item.tags || []), ...newTags])];
      }
      clearSelection();
      break;
    }
    case 'bulkMoveToBoard': {
      const targetBoardId = elements.modalSelect.value;
      const targetBoard = state.boards.find(b => b.id === targetBoardId);
      if (!targetBoard) break;
      const board = getActiveBoard();
      const toMove = [];
      for (const itemId of selectedItemIds) {
        const found = findBoardItemInColumns(board, itemId);
        if (found?.item) toMove.push(found);
      }
      toMove.forEach(({ item, list }) => {
        list.splice(list.indexOf(item), 1);
        targetBoard.columns[0].items.push(item);
      });
      clearSelection();
      break;
    }
    default:
      break;
  }

  hideModal();
  renderAll();
  saveState();
}

let boardSettingsCreatingId = null;

function showBoardSettingsPanel(isNew = false) {
  const board = getActiveBoard();
  if (!board) return;
  if (!isNew) pushUndoSnapshot();
  boardSettingsCreatingId = isNew ? board.id : null;
  document.getElementById('modalCard').classList.add('hidden');
  const panel = document.getElementById('boardSettingsPanel');
  document.getElementById('boardSettingsDoneBtn').textContent = isNew ? 'Create' : 'OK';
  document.getElementById('boardSettingsCancelBtn').classList.toggle('hidden', !isNew);
  panel.classList.remove('hidden');
  elements.modalOverlay.classList.remove('hidden');
  centerPanel(panel);
  makeDraggable(panel, document.getElementById('bstgHeader'));
  document.getElementById('bstgTitle').value = board.title;
  const colRadio = document.querySelector(`input[name="bstgCols"][value="${board.columnCount}"]`);
  if (colRadio) colRadio.checked = true;
  document.getElementById('bstgBgUrl').value = board.backgroundImage || '';
  document.getElementById('bstgOpacity').value = board.containerOpacity ?? 100;
  document.getElementById('bstgOpacityVal').textContent = board.containerOpacity ?? 100;
  document.getElementById('bstgShowSpeedDial').checked = board.showSpeedDial !== false;
  document.getElementById('bstgSharedTags').value = (board.sharedTags || []).join(' ');
  document.getElementById('bstgTags').value = (board.tags || []).join(' ');
  document.getElementById('bstgInheritTags').checked = board.inheritTags !== false;
}

function hideBoardSettingsPanel() {
  const panel = document.getElementById('boardSettingsPanel');
  document.getElementById('boardSettingsDoneBtn').textContent = 'OK';
  panel.classList.add('hidden');
  document.getElementById('modalCard').classList.remove('hidden');
  elements.modalOverlay.classList.add('hidden');
  boardSettingsCreatingId = null;
  saveState();
}

function cancelBoardSettingsPanel() {
  if (boardSettingsCreatingId) {
    const navItem = findNavBoardItem(boardSettingsCreatingId);
    if (navItem) deleteBoardAndNavItem(navItem.id, boardSettingsCreatingId);
    renderAll();
    saveState();
  }
  hideBoardSettingsPanel();
}

function attachBoardSettingsListeners() {
  document.getElementById('bstgTitle').addEventListener('input', e => {
    const board = getActiveBoard();
    if (!board) return;
    board.title = e.target.value;
    elements.boardTitle.textContent = board.title;
    const findNavItem = (items) => { for (const i of items) { if (i.boardId === board.id) return i; if (i.children) { const f = findNavItem(i.children); if (f) return f; } } return null; };
    const navItem = findNavItem(state.navItems);
    if (navItem) navItem.title = board.title;
    renderNav();
  });

  document.querySelectorAll('input[name="bstgCols"]').forEach(radio => {
    radio.addEventListener('change', e => {
      const board = getActiveBoard();
      if (!board) return;
      const newCount = parseInt(e.target.value, 10) || 3;
      if (newCount < board.columns.length) {
        const removed = board.columns.slice(newCount);
        const lastKept = board.columns[newCount - 1];
        for (const col of removed) lastKept.items.push(...col.items);
        board.columns = board.columns.slice(0, newCount);
      } else {
        while (board.columns.length < newCount) {
          board.columns.push({
            id: `col-${Date.now()}-${board.columns.length + 1}`,
            title: `Column ${board.columns.length + 1}`,
            items: []
          });
        }
      }
      board.columnCount = newCount;
      renderBoard();
    });
  });

  const applyBg = () => {
    const board = getActiveBoard();
    if (!board) return;
    applyBoardBackground(board);
  };

  document.getElementById('bstgBgUrl').addEventListener('input', e => {
    const board = getActiveBoard();
    if (!board) return;
    board.backgroundImage = e.target.value.trim();
    applyBg();
  });

  const dropZone = document.getElementById('bstgDropZone');
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const board = getActiveBoard();
      if (!board) return;
      board.backgroundImage = ev.target.result;
      document.getElementById('bstgBgUrl').value = '';
      applyBg();
    };
    reader.readAsDataURL(file);
  });

  document.getElementById('bstgBgClear').addEventListener('click', () => {
    const board = getActiveBoard();
    if (!board) return;
    board.backgroundImage = '';
    document.getElementById('bstgBgUrl').value = '';
    applyBg();
  });

  document.getElementById('bstgOpacity').addEventListener('input', e => {
    const board = getActiveBoard();
    if (!board) return;
    board.containerOpacity = parseInt(e.target.value);
    document.getElementById('bstgOpacityVal').textContent = board.containerOpacity;
    applyBg();
  });

  document.getElementById('bstgShowSpeedDial').addEventListener('change', e => {
    const board = getActiveBoard();
    if (!board) return;
    board.showSpeedDial = e.target.checked;
    renderBoard();
  });

  const bstgSharedTagsEl = document.getElementById('bstgSharedTags');
  bstgSharedTagsEl.addEventListener('input', e => {
    const board = getActiveBoard();
    if (!board) return;
    board.sharedTags = e.target.value.trim().split(/\s+/).filter(Boolean);
    renderBoard();
  });
  attachTagAutocomplete(bstgSharedTagsEl);

  const bstgTagsEl = document.getElementById('bstgTags');
  bstgTagsEl.addEventListener('input', e => {
    const board = getActiveBoard();
    if (!board) return;
    board.tags = e.target.value.trim().split(/\s+/).filter(Boolean);
  });
  attachTagAutocomplete(bstgTagsEl);

  document.getElementById('bstgInheritTags').addEventListener('change', e => {
    const board = getActiveBoard();
    if (!board) return;
    board.inheritTags = e.target.checked;
    renderBoard();
  });

  document.getElementById('boardSettingsDoneBtn').addEventListener('click', hideBoardSettingsPanel);
  document.getElementById('boardSettingsCancelBtn').addEventListener('click', cancelBoardSettingsPanel);
}

// --- Folder modal ---

let folderModalMode = 'create';

function showFolderModal(mode, ct) {
  folderModalMode = mode;
  if (ct) contextTarget = ct;
  document.getElementById('modalCard').classList.add('hidden');
  const panel = document.getElementById('folderModal');
  panel.classList.remove('hidden');
  elements.modalOverlay.classList.remove('hidden');
  const submitBtn = document.getElementById('folderModalSubmitBtn');
  if (mode === 'edit') {
    submitBtn.textContent = 'Save';
    const board = getActiveBoard();
    const found = findBoardItemInColumns(board, contextTarget.itemId);
    if (found?.item) {
      document.getElementById('fmName').value = found.item.title || '';
      document.getElementById('fmTags').value = (found.item.tags || []).join(' ');
      document.getElementById('fmSharedTags').value = (found.item.sharedTags || []).join(' ');
      document.getElementById('fmInheritTags').checked = found.item.inheritTags !== false;
      document.getElementById('fmAutoRemove').checked = found.item.autoRemoveTags === true;
    }
  } else {
    submitBtn.textContent = 'Create';
    document.getElementById('fmName').value = '';
    document.getElementById('fmTags').value = '';
    document.getElementById('fmSharedTags').value = '';
    document.getElementById('fmInheritTags').checked = true;
    document.getElementById('fmAutoRemove').checked = false;
  }
  centerPanel(panel);
  makeDraggable(panel, document.getElementById('folderModalHeader'));
  document.getElementById('fmName').focus();
}

function hideFolderModal() {
  document.getElementById('folderModal').classList.add('hidden');
  document.getElementById('modalCard').classList.remove('hidden');
  elements.modalOverlay.classList.add('hidden');
}

function handleFolderModalSubmit() {
  const name = document.getElementById('fmName').value.trim();
  if (!name) { document.getElementById('fmName').focus(); return; }
  const tags = document.getElementById('fmTags').value.trim().split(/\s+/).filter(Boolean);
  const sharedTags = document.getElementById('fmSharedTags').value.trim().split(/\s+/).filter(Boolean);
  const inheritTags = document.getElementById('fmInheritTags').checked;
  const autoRemoveTags = document.getElementById('fmAutoRemove').checked;
  pushUndoSnapshot();
  if (folderModalMode === 'edit') {
    editFolder(contextTarget.itemId, name, tags, sharedTags, inheritTags, autoRemoveTags);
  } else {
    const area = contextTarget?.area;
    const parent = contextTarget?.item;
    if (area === 'board-subfolder') {
      if (parent) {
        parent.children = parent.children || [];
        parent.children.push({ id: `id-${Date.now()}`, type: 'folder', title: name, children: [], tags, sharedTags, inheritTags, autoRemoveTags });
        parent.collapsed = false;
      }
    } else {
      addBookmarkItem('folder', name, contextTarget?.columnId, { tags, sharedTags, inheritTags, autoRemoveTags });
    }
  }
  hideFolderModal();
  renderAll();
  saveState();
}

function attachFolderModalListeners() {
  document.getElementById('folderModalCancelBtn').addEventListener('click', hideFolderModal);
  document.getElementById('folderModalSubmitBtn').addEventListener('click', handleFolderModalSubmit);
  document.getElementById('fmName').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); handleFolderModalSubmit(); }
  });
  attachTagAutocomplete(document.getElementById('fmTags'));
  attachTagAutocomplete(document.getElementById('fmSharedTags'));
}

function openExternalBookmarkModal(url, title, target) {
  contextTarget = target;
  showModal('addBookmark', {
    title: 'Add Bookmark',
    placeholder1: 'Bookmark title',
    value1: title,
    showUrl: true,
    placeholder2: 'Bookmark URL',
    value2: url,
    showTags: true
  });
}

// --- Context menu ---

function showContextMenu(x, y, actions) {
  const menu = elements.contextMenu;
  menu.innerHTML = '';
  actions.forEach(action => {
    const button = document.createElement('button');
    button.textContent = action.label;
    button.addEventListener('click', () => {
      handleContextMenuAction(action.action);
      hideContextMenu();
    });
    menu.appendChild(button);
  });
  menu.style.left = '0';
  menu.style.top = '0';
  menu.classList.remove('hidden');
  const menuW = menu.offsetWidth;
  const menuH = menu.offsetHeight;
  menu.style.left = `${Math.min(x, window.innerWidth - menuW - 4)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - menuH - 4)}px`;
}

function hideContextMenu() {
  elements.contextMenu.classList.add('hidden');
  elements.contextMenu.innerHTML = '';
}

function handleContextMenuAction(action) {
  if (!contextTarget) return;

  switch (action) {
    case 'renameItem':
      showModal('renameItem', {
        title: 'Rename Item',
        placeholder1: 'New name',
        value1: contextTarget.item?.title || contextTarget.item?.text || ''
      });
      break;
    case 'editBookmark':
      showModal('editBookmark', {
        title: 'Edit Bookmark', placeholder1: 'Bookmark title',
        value1: contextTarget.item.title,
        showUrl: true, placeholder2: 'Bookmark URL', value2: contextTarget.item.url || '',
        showTags: true, value3: (contextTarget.item.tags || []).join(' ')
      });
      break;
    case 'deleteItem': {
      const type = contextTarget.item?.type;
      const key = type === 'folder' ? 'confirmDeleteFolder' : type === 'bookmark' ? 'confirmDeleteBookmark' : 'confirmDeleteTitleDivider';
      const name = contextTarget.item?.title;
      const label = type === 'folder'
        ? `Delete folder "${name}" and all its contents?`
        : name ? `Delete "${name}"?` : 'Delete this item?';
      const captured = { ...contextTarget };
      const capturedItem = JSON.parse(JSON.stringify(contextTarget.item));
      const capturedBoardId = getActiveBoard()?.id;
      confirmDelete(key, label, () => {
        pushUndoSnapshot();
        pushToTrash(capturedItem, { area: 'board-item', boardId: capturedBoardId, columnId: captured.columnId, parentId: captured.parentId });
        deleteBoardTarget(captured);
        renderAll();
        saveState();
        updateTrashBadge();
      });
      break;
    }
    case 'deleteNavItem': {
      const navItemId = contextTarget.itemId;
      const navItemType = contextTarget.item?.type;
      const navBoardId = contextTarget.item?.boardId || null;
      const navName = contextTarget.item?.title;
      const isNavBoard = navItemType === 'board';
      const navKey = isNavBoard ? 'confirmDeleteBoard' : navItemType === 'folder' ? 'confirmDeleteFolder' : 'confirmDeleteTitleDivider';
      const navLabel = isNavBoard
        ? `Delete board "${navName}" and all its content?`
        : navName ? `Delete "${navName}"?` : 'Delete this item?';
      const capturedNavItem = JSON.parse(JSON.stringify(contextTarget.item));
      const capturedNavParentId = contextTarget.parentId || null;
      const capturedNavBoardId = navBoardId;
      confirmDelete(navKey, navLabel, () => {
        pushUndoSnapshot();
        if (isNavBoard) {
          const fullBoard = state.boards.find(b => b.id === capturedNavBoardId);
          pushToTrash({ navItem: capturedNavItem, board: fullBoard ? JSON.parse(JSON.stringify(fullBoard)) : null }, { area: 'nav-board', parentId: capturedNavParentId });
          deleteBoardAndNavItem(navItemId, capturedNavBoardId);
        } else {
          pushToTrash(capturedNavItem, { area: 'nav-item', parentId: capturedNavParentId });
          removeNavItemById(navItemId);
        }
        renderAll();
        saveState();
        updateTrashBadge();
      });
      break;
    }
    case 'addBoard':
      pushUndoSnapshot();
      createBoard('New Board');
      renderAll();
      saveState();
      showBoardSettingsPanel(true);
      break;
    case 'addNavFolder':
      showModal('addFolder', { title: 'Add Navigation Folder', placeholder1: 'Folder title' });
      break;
    case 'addNavTitle':
      showModal('addTitle', { title: 'Add Navigation Title', placeholder1: 'Title text' });
      break;
    case 'addNavDivider':
      pushUndoSnapshot();
      state.navItems.push({ id: `id-${Date.now()}`, type: 'title', title: '' });
      renderNav();
      saveState();
      break;
    case 'addFolder':
      showFolderModal('create', contextTarget);
      break;
    case 'addBookmark':
      showModal('addBookmark', {
        title: 'Add Bookmark', placeholder1: 'Bookmark title',
        showUrl: true, placeholder2: 'Bookmark URL',
        showTags: true, contextTarget
      });
      break;
    case 'addTitle':
      showModal('addTitle', { title: 'Add Title', placeholder1: 'Title text', contextTarget });
      break;
    case 'addDivider':
      pushUndoSnapshot();
      addBookmarkItem('title', '', contextTarget.columnId);
      renderAll();
      saveState();
      break;
    case 'editSpeedDial':
      showModal('editBookmark', {
        title: 'Edit Bookmark',
        placeholder1: 'Bookmark title',
        value1: contextTarget.item.title,
        showUrl: true,
        placeholder2: 'Bookmark URL',
        value2: contextTarget.item.url || '',
        showTags: true,
        value3: (contextTarget.item.tags || []).join(' ')
      });
      break;
    case 'deleteSpeedDial': {
      const sdItem = contextTarget.item;
      const sdId = contextTarget.itemId;
      const capturedSdItem = JSON.parse(JSON.stringify(sdItem));
      const capturedSdBoardId = getActiveBoard()?.id;
      confirmDelete('confirmDeleteBookmark', `Delete "${sdItem?.title}"?`, () => {
        pushUndoSnapshot();
        pushToTrash(capturedSdItem, { area: 'speed-dial', boardId: capturedSdBoardId });
        const board = getActiveBoard();
        board.speedDial = board.speedDial.filter(i => i.id !== sdId);
        renderAll();
        saveState();
        updateTrashBadge();
      });
      break;
    }
    case 'addBoardSubfolder':
      showFolderModal('create', { ...contextTarget, area: 'board-subfolder' });
      break;
    case 'addNavSubfolder':
      contextTarget = { ...contextTarget, area: 'nav-subfolder' };
      showModal('addFolder', { title: 'Create Subfolder', placeholder1: 'Folder name' });
      break;
    case 'addEssential':
      showModal('addBookmark', {
        title: 'Add Bookmark', placeholder1: 'Bookmark title',
        showUrl: true, placeholder2: 'Bookmark URL',
        showTags: true
      });
      break;
    case 'editEssential':
      showModal('editBookmark', {
        title: 'Edit Bookmark',
        placeholder1: 'Bookmark title', value1: contextTarget.item.title,
        showUrl: true, placeholder2: 'Bookmark URL', value2: contextTarget.item.url || '',
        showTags: true, value3: (contextTarget.item.tags || []).join(' ')
      });
      break;
    case 'openAll': {
      const collectUrls = (items) => {
        const urls = [];
        for (const item of (items || [])) {
          if (item.type === 'bookmark' && item.url) urls.push(item.url);
          if (item.children) urls.push(...collectUrls(item.children));
        }
        return urls;
      };
      collectUrls(contextTarget.item?.children).forEach(url => window.open(url, '_blank', 'noreferrer noopener'));
      break;
    }
    case 'refreshFavicon': {
      const board = getActiveBoard();
      const found = findBoardItemInColumns(board, contextTarget.itemId);
      if (found?.item) { found.item.faviconCache = ''; renderAll(); saveState(); }
      break;
    }
    case 'duplicateBookmark': {
      const board = getActiveBoard();
      const found = findBoardItemInColumns(board, contextTarget.itemId);
      if (found?.item) {
        pushUndoSnapshot();
        const copy = { ...found.item, id: `bm-${Date.now()}`, title: found.item.title + ' (copy)', faviconCache: '' };
        found.list.splice(found.list.indexOf(found.item) + 1, 0, copy);
        renderAll();
        saveState();
      }
      break;
    }
    case 'moveToBoard': {
      const boards = state.boards.filter(b => b.id !== getActiveBoard()?.id);
      showModal('moveToBoard', {
        title: 'Move to Board',
        showName: false,
        showSelect: true,
        selectLabel: 'Target board',
        selectOptions: boards.map(b => ({ value: b.id, label: b.title })),
        contextTarget
      });
      break;
    }
    case 'deleteEssential': {
      const essSlot = contextTarget.slot;
      const essName = contextTarget.item?.title;
      const capturedEssItem = JSON.parse(JSON.stringify(contextTarget.item));
      confirmDelete('confirmDeleteBookmark', `Remove "${essName}"?`, () => {
        pushUndoSnapshot();
        pushToTrash(capturedEssItem, { area: 'essential', slot: essSlot });
        removeEssential(essSlot);
        renderEssentials();
        saveState();
        updateTrashBadge();
      });
      break;
    }
    case 'addSpeedDialBookmark':
      showModal('addBookmark', {
        title: 'Add Speed Dial Bookmark', placeholder1: 'Bookmark title',
        showUrl: true, placeholder2: 'Bookmark URL',
        showTags: true, contextTarget
      });
      break;
    case 'editFolder':
      showFolderModal('edit', contextTarget);
      break;
    default:
      break;
  }
}

function handleBoardContextMenu(event, item, columnId, parentFolder, depth) {
  contextTarget = {
    area: 'board-item',
    itemId: item.id,
    columnId,
    parentId: parentFolder ? parentFolder.id : null,
    item,
    depth
  };

  const options = [];
  if (item.type === 'folder') {
    options.push({ label: 'Edit folder', action: 'editFolder' });
    options.push({ label: 'Open all', action: 'openAll' });
    if (depth < 2) options.push({ label: 'Create subfolder', action: 'addBoardSubfolder' });
    options.push({ label: 'Delete folder', action: 'deleteItem' });
  } else if (item.type === 'bookmark') {
    options.push({ label: 'Edit bookmark', action: 'editBookmark' });
    options.push({ label: 'Duplicate', action: 'duplicateBookmark' });
    options.push({ label: 'Refresh favicon', action: 'refreshFavicon' });
    if (state.boards.length > 1) options.push({ label: 'Move to board', action: 'moveToBoard' });
    options.push({ label: 'Delete bookmark', action: 'deleteItem' });
  } else if (item.type === 'title') {
    options.push({ label: 'Rename', action: 'renameItem' });
    options.push({ label: 'Delete', action: 'deleteItem' });
  }

  showContextMenu(event.clientX, event.clientY, options);
}

function handleNavContextMenu(event, item, parent, depth = 0) {
  contextTarget = {
    area: 'nav-item',
    itemId: item.id,
    parentId: parent ? parent.id : null,
    item,
    depth
  };

  const options = [];
  if (item.type === 'board') {
    options.push({ label: 'Rename board', action: 'renameItem' });
    options.push({ label: 'Delete board', action: 'deleteNavItem' });
  } else if (item.type === 'folder') {
    options.push({ label: 'Rename folder', action: 'renameItem' });
    if (depth < 2) options.push({ label: 'Create subfolder', action: 'addNavSubfolder' });
    options.push({ label: 'Delete folder', action: 'deleteNavItem' });
  } else if (item.type === 'title') {
    options.push({ label: 'Rename', action: 'renameItem' });
    options.push({ label: 'Delete', action: 'deleteNavItem' });
  }

  showContextMenu(event.clientX, event.clientY, options);
}

function handleEssentialContextMenu(event, slot, item) {
  contextTarget = { area: 'essential', slot, item };
  const options = item
    ? [
        { label: 'Edit bookmark', action: 'editEssential' },
        { label: 'Delete bookmark', action: 'deleteEssential' }
      ]
    : [{ label: 'Add bookmark', action: 'addEssential' }];
  showContextMenu(event.clientX, event.clientY, options);
}

function handleSpeedDialContextMenu(event, item) {
  contextTarget = { area: 'speed-dial-item', itemId: item.id, item };
  showContextMenu(event.clientX, event.clientY, [
    { label: 'Edit bookmark', action: 'editSpeedDial' },
    { label: 'Delete bookmark', action: 'deleteSpeedDial' }
  ]);
}

function handleBoardColumnContextMenu(event, columnId) {
  event.preventDefault();
  lastActiveColumnId = columnId;
  contextTarget = { area: 'board-empty', columnId };
  showContextMenu(event.clientX, event.clientY, [
    { label: 'Add folder', action: 'addFolder' },
    { label: 'Add bookmark', action: 'addBookmark' },
    { label: 'Add title', action: 'addTitle' },
    { label: 'Add divider', action: 'addDivider' }
  ]);
}

function handleNavListContextMenu(event) {
  event.preventDefault();
  contextTarget = { area: 'nav-empty' };
  showContextMenu(event.clientX, event.clientY, [
    { label: 'Add board', action: 'addBoard' },
    { label: 'Add folder', action: 'addNavFolder' },
    { label: 'Add title', action: 'addNavTitle' },
    { label: 'Add divider', action: 'addNavDivider' }
  ]);
}

// --- Settings panel ---

const FONT_OPTIONS = [
  { value: '', label: 'Default' },
  { value: 'system-ui, sans-serif', label: 'System UI' },
  { value: 'Arial, sans-serif', label: 'Arial' },
  { value: 'Verdana, sans-serif', label: 'Verdana' },
  { value: 'Trebuchet MS, sans-serif', label: 'Trebuchet MS' },
  { value: 'Georgia, serif', label: 'Georgia' },
  { value: "'Times New Roman', serif", label: 'Times New Roman' },
  { value: "'Courier New', monospace", label: 'Courier New' },
  { value: 'Consolas, monospace', label: 'Consolas' },
];

function populateFontSelects() {
  ['stgHubNameFamily','stgBoardTitleFamily','stgBoardFamily','stgBookmarkFamily','stgFolderFamily','stgTitleFamily'].forEach(id => {
    const sel = document.getElementById(id);
    if (sel.options.length) return;
    FONT_OPTIONS.forEach(({ value, label }) => {
      const opt = new Option(label, value);
      opt.style.fontFamily = value || 'inherit';
      sel.appendChild(opt);
    });
  });
}

function makeDraggable(panel, handle) {
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

function updateEssentialsWarning() {
  const count = state.settings.essentialsDisplayCount || 10;
  const hasHidden = state.essentials.slice(count).some(Boolean);
  document.getElementById('stgEssHiddenWarning').classList.toggle('hidden', !hasHidden);
}

function updateLastExportedLabel() {
  const el = document.getElementById('stgLastExported');
  if (!state.lastExported) { el.textContent = 'Never exported'; return; }
  const d = new Date(state.lastExported);
  el.textContent = `Last exported: ${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function showSettingsPanel() {
  document.getElementById('modalCard').classList.add('hidden');
  const panel = document.getElementById('settingsPanel');
  panel.classList.remove('hidden');
  elements.modalOverlay.classList.remove('hidden');
  centerPanel(panel);
  makeDraggable(panel, document.getElementById('stgDragHandle'));
  const s = state.settings;
  document.getElementById('stgHubName').value = state.hubName || '';
  document.getElementById('stgBookmarkFont').value = s.bookmarkFontSize;
  document.getElementById('stgShowTags').checked = s.showTags;
  document.getElementById('stgWarnOnClose').checked = s.warnOnClose;
  document.getElementById('stgConfirmDeleteBoard').checked = s.confirmDeleteBoard;
  document.getElementById('stgConfirmDeleteBookmark').checked = s.confirmDeleteBookmark;
  document.getElementById('stgConfirmDeleteFolder').checked = s.confirmDeleteFolder;
  document.getElementById('stgConfirmDeleteTitleDivider').checked = s.confirmDeleteTitleDivider;
  document.getElementById('stgFolderFont').value = s.folderFontSize;
  document.getElementById('stgTitleFont').value = s.titleFontSize;
  document.getElementById('stgLineThicknessVal').textContent = s.titleLineThickness;
  document.getElementById('stgBoardTitleFont').value = s.boardTitleFontSize;
  document.getElementById('stgBoardFont').value = s.boardFontSize;
  populateFontSelects();
  document.getElementById('stgHubNameFont').value     = s.hubNameFontSize || 18;
  document.getElementById('stgHubNameFamily').value   = s.hubNameFontFamily || '';
  document.getElementById('stgBoardTitleFamily').value = s.boardTitleFontFamily || '';
  document.getElementById('stgBoardFamily').value     = s.boardFontFamily || '';
  document.getElementById('stgBookmarkFamily').value  = s.bookmarkFontFamily || '';
  document.getElementById('stgFolderFamily').value    = s.folderFontFamily || '';
  document.getElementById('stgTitleFamily').value     = s.titleFontFamily || '';
  document.querySelectorAll('.fmt-btn').forEach(btn => {
    btn.classList.toggle('active', !!s[btn.dataset.fmt]);
  });
  document.querySelectorAll('.align-btn').forEach(btn => {
    btn.classList.toggle('active', (s[btn.dataset.alignKey] || 'left') === btn.dataset.alignVal);
  });
  const colorDefaults = { hubNameColor: '#e5e7eb', boardTitleColor: '#e5e7eb', boardColor: '#e5e7eb', bookmarkColor: '#e5e7eb', folderColor: '#e5e7eb', titleColor: '#9ca3af', titleLineColor: '#3a3c42' };
  Object.entries(colorDefaults).forEach(([key, def]) => {
    document.getElementById('stg' + key[0].toUpperCase() + key.slice(1)).value = s[key] || def;
  });
  document.getElementById('stgTitleLineStyle').value = s.titleLineStyle || 'solid';
  const sdSizeRadio = document.querySelector(`input[name="stgSpeedDialSize"][value="${s.speedDialIconSize || 'medium'}"]`);
  if (sdSizeRadio) sdSizeRadio.checked = true;
  const essSizeRadio = document.querySelector(`input[name="stgEssentialsSize"][value="${s.essentialsIconSize || 'medium'}"]`);
  if (essSizeRadio) essSizeRadio.checked = true;
  document.getElementById('stgShowEssentials').checked = s.showEssentials !== false;
  document.getElementById('stgEssCountVal').textContent = s.essentialsDisplayCount || 10;
  populateTagColors();
  updateLastExportedLabel();
  updateEssentialsWarning();
}

function hideSettingsPanel() {
  document.getElementById('settingsPanel').classList.add('hidden');
  document.getElementById('modalCard').classList.remove('hidden');
  elements.modalOverlay.classList.add('hidden');
  saveState();
}

function populateTagColors() {
  const tags = new Set();
  const walk = items => { for (const item of (items || [])) { if (item?.tags) item.tags.forEach(t => tags.add(t)); if (item?.children) walk(item.children); } };
  walk(state.essentials);
  for (const board of state.boards) { walk(board.speedDial); for (const col of board.columns) walk(col.items); }

  const container = document.getElementById('stgTagColors');
  container.innerHTML = '';
  if (!tags.size) {
    const empty = document.createElement('span');
    empty.className = 'settings-muted';
    empty.textContent = 'No tags in use yet.';
    container.appendChild(empty);
    return;
  }
  [...tags].sort().forEach(tag => {
    const row = document.createElement('div');
    row.className = 'tag-color-row';
    const label = document.createElement('span');
    label.textContent = tag;
    const group = document.createElement('div');
    group.className = 'color-picker-group';
    const input = document.createElement('input');
    input.type = 'color';
    input.className = 'color-input';
    input.value = state.settings.tagColors[tag] || '#6d7cff';
    input.addEventListener('input', e => {
      state.settings.tagColors[tag] = e.target.value;
      renderAll();
      saveState();
    });
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'color-reset-btn';
    reset.title = 'Reset to default';
    reset.textContent = '×';
    reset.addEventListener('click', () => {
      delete state.settings.tagColors[tag];
      input.value = '#6d7cff';
      renderAll();
      saveState();
    });
    group.appendChild(input);
    group.appendChild(reset);
    row.appendChild(label);
    row.appendChild(group);
    container.appendChild(row);
  });
}

// --- Browser bookmark import ---

function parseBookmarkHtml(htmlText) {
  const doc = new DOMParser().parseFromString(htmlText, 'text/html');
  function parseDL(dl) {
    const items = [];
    if (!dl) return items;
    for (const dt of dl.children) {
      if (dt.tagName !== 'DT') continue;
      const a = dt.querySelector(':scope > A');
      const h3 = dt.querySelector(':scope > H3');
      const subDL = dt.querySelector(':scope > DL');
      if (a) {
        items.push({
          id: `bm-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          type: 'bookmark',
          title: a.textContent.trim() || a.href,
          url: a.href,
          tags: [],
          faviconCache: ''
        });
      } else if (h3) {
        items.push({
          id: `bm-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          type: 'folder',
          title: h3.textContent.trim(),
          collapsed: false,
          children: parseDL(subDL)
        });
      }
    }
    return items;
  }
  return parseDL(doc.querySelector('DL'));
}

function countBookmarks(items) {
  let n = 0;
  for (const item of (items || [])) {
    if (item.type === 'bookmark') n++;
    if (item.children) n += countBookmarks(item.children);
  }
  return n;
}

function attachSettingsListeners() {
  document.getElementById('stgHubName').addEventListener('input', e => {
    state.hubName = e.target.value || 'Morpheus WebHub';
    elements.hubNameEl.textContent = state.hubName;
    document.title = state.hubName;
  });

  const numSetting = (id, key, min, max) => {
    document.getElementById(id).addEventListener('input', e => {
      const v = Math.min(max, Math.max(min, parseInt(e.target.value) || min));
      state.settings[key] = v;
      applySettings();
    });
  };

  numSetting('stgBoardFont',      'boardFontSize',      10, 24);
  numSetting('stgBookmarkFont',   'bookmarkFontSize',   10, 24);
  numSetting('stgFolderFont',     'folderFontSize',     10, 24);
  numSetting('stgTitleFont',      'titleFontSize',       8, 24);
  numSetting('stgBoardTitleFont', 'boardTitleFontSize', 14, 48);

  document.getElementById('stgShowTags').addEventListener('change', e => {
    state.settings.showTags = e.target.checked;
    applySettings();
  });
  document.getElementById('stgWarnOnClose').addEventListener('change', e => {
    state.settings.warnOnClose = e.target.checked;
  });
  document.getElementById('stgConfirmDeleteBoard').addEventListener('change', e => {
    state.settings.confirmDeleteBoard = e.target.checked;
  });
  document.getElementById('stgConfirmDeleteBookmark').addEventListener('change', e => {
    state.settings.confirmDeleteBookmark = e.target.checked;
  });
  document.getElementById('stgConfirmDeleteFolder').addEventListener('change', e => {
    state.settings.confirmDeleteFolder = e.target.checked;
  });
  document.getElementById('stgConfirmDeleteTitleDivider').addEventListener('change', e => {
    state.settings.confirmDeleteTitleDivider = e.target.checked;
  });

  const thicknessEl = document.getElementById('stgLineThicknessVal');
  document.getElementById('stgLineThicknessMinus').addEventListener('click', () => {
    if (state.settings.titleLineThickness > 1) {
      state.settings.titleLineThickness--;
      thicknessEl.textContent = state.settings.titleLineThickness;
      applySettings();
    }
  });
  document.getElementById('stgLineThicknessPlus').addEventListener('click', () => {
    if (state.settings.titleLineThickness < 8) {
      state.settings.titleLineThickness++;
      thicknessEl.textContent = state.settings.titleLineThickness;
      applySettings();
    }
  });

  const familySetting = (id, key) => {
    document.getElementById(id).addEventListener('change', e => {
      state.settings[key] = e.target.value;
      applySettings();
    });
  };
  numSetting('stgHubNameFont', 'hubNameFontSize', 10, 48);
  familySetting('stgHubNameFamily',    'hubNameFontFamily');
  familySetting('stgBoardTitleFamily', 'boardTitleFontFamily');
  familySetting('stgBoardFamily',      'boardFontFamily');
  familySetting('stgBookmarkFamily',   'bookmarkFontFamily');
  familySetting('stgFolderFamily',     'folderFontFamily');
  familySetting('stgTitleFamily',      'titleFontFamily');

  document.querySelectorAll('.fmt-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.fmt;
      state.settings[key] = !state.settings[key];
      btn.classList.toggle('active', state.settings[key]);
      applySettings();
    });
  });

  document.querySelectorAll('.align-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.alignKey;
      const val = btn.dataset.alignVal;
      state.settings[key] = val;
      document.querySelectorAll(`.align-btn[data-align-key="${key}"]`).forEach(b => {
        b.classList.toggle('active', b.dataset.alignVal === val);
      });
      applySettings();
    });
  });

  const colorDefaults = { hubNameColor: '#e5e7eb', boardTitleColor: '#e5e7eb', boardColor: '#e5e7eb', bookmarkColor: '#e5e7eb', folderColor: '#e5e7eb', titleColor: '#9ca3af', titleLineColor: '#3a3c42' };
  Object.entries(colorDefaults).forEach(([key, def]) => {
    const inputId = 'stg' + key[0].toUpperCase() + key.slice(1);
    document.getElementById(inputId).addEventListener('input', e => {
      state.settings[key] = e.target.value;
      applySettings();
    });
  });
  document.querySelectorAll('.color-reset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.colorKey;
      state.settings[key] = '';
      const inputId = 'stg' + key[0].toUpperCase() + key.slice(1);
      document.getElementById(inputId).value = colorDefaults[key];
      applySettings();
    });
  });

  document.getElementById('stgTitleLineStyle').addEventListener('change', e => {
    state.settings.titleLineStyle = e.target.value;
    applySettings();
  });

  document.getElementById('stgShowEssentials').addEventListener('change', e => {
    state.settings.showEssentials = e.target.checked;
    renderEssentials();
    saveState();
  });

  const essCountEl = document.getElementById('stgEssCountVal');
  document.getElementById('stgEssCountMinus').addEventListener('click', () => {
    if (state.settings.essentialsDisplayCount > 1) {
      state.settings.essentialsDisplayCount--;
      essCountEl.textContent = state.settings.essentialsDisplayCount;
      updateEssentialsWarning();
      renderEssentials();
      saveState();
    }
  });
  document.getElementById('stgEssCountPlus').addEventListener('click', () => {
    if (state.settings.essentialsDisplayCount < 24) {
      state.settings.essentialsDisplayCount++;
      essCountEl.textContent = state.settings.essentialsDisplayCount;
      updateEssentialsWarning();
      renderEssentials();
      saveState();
    }
  });

  document.querySelectorAll('input[name="stgSpeedDialSize"]').forEach(radio => {
    radio.addEventListener('change', e => {
      state.settings.speedDialIconSize = e.target.value;
      applySettings();
      saveState();
    });
  });

  document.querySelectorAll('input[name="stgEssentialsSize"]').forEach(radio => {
    radio.addEventListener('change', e => {
      state.settings.essentialsIconSize = e.target.value;
      applySettings();
      saveState();
    });
  });

  document.querySelectorAll('.settings-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.settings-tab').forEach(t => t.classList.toggle('active', t === tab));
      const body = document.querySelector('.settings-body[data-active-tab]');
      if (body) body.dataset.activeTab = tab.dataset.tab;
    });
  });

  document.getElementById('settingsDoneBtn').addEventListener('click', hideSettingsPanel);

  document.getElementById('stgExportBtn').addEventListener('click', () => {
    state.lastExported = new Date().toISOString();
    saveState();
    isDirty = false;
    const json = JSON.stringify(state, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const date = state.lastExported.slice(0, 10);
    const a = document.createElement('a');
    a.href = url;
    a.download = `morpheus-webhub-${date}.json`;
    a.click();
    URL.revokeObjectURL(url);
    updateLastExportedLabel();
  });

  const importFile = document.getElementById('stgImportFile');
  document.getElementById('stgImportBtn').addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const parsed = JSON.parse(ev.target.result);
        if (!parsed.boards || !parsed.navItems) {
          alert('Invalid file: not a Morpheus WebHub export.');
          return;
        }
        localStorage.setItem('morpheus-webhub-state', ev.target.result);
        location.reload();
      } catch {
        alert('Failed to read file. Make sure it is a valid JSON export.');
      }
    };
    reader.readAsText(file);
    importFile.value = '';
  });

  const bmImportFile = document.getElementById('importBookmarksFile');
  if (bmImportFile) {
    bmImportFile.addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        const items = parseBookmarkHtml(ev.target.result);
        if (!items.length) { alert('No bookmarks found in file.'); return; }
        const board = getActiveBoard();
        if (!board) return;
        pushUndoSnapshot();
        board.columns[0].items.push(...items);
        renderAll();
        saveState();
        hideSettingsPanel();
        alert(`Imported ${countBookmarks(items)} bookmarks into "${board.title}".`);
      };
      reader.readAsText(file);
      bmImportFile.value = '';
    });
  }
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
    const boards = state.boards.filter(b => b.id !== getActiveBoard()?.id);
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
}

attachEventListeners();
attachSettingsListeners();
attachBoardSettingsListeners();
attachFolderModalListeners();
renderAll();
saveState();
updateUndoRedoUI();
