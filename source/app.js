let activeModal = null;
let contextTarget = null;

// --- Modal ---

function showModal(type, options = {}) {
  activeModal = type;
  if (options.contextTarget) contextTarget = options.contextTarget;
  elements.modalOverlay.classList.remove('hidden');
  elements.modalTitle.textContent = options.title || 'Action';
  elements.modalLabel1.textContent = options.label1 || 'Name';
  elements.modalInput1.value = options.value1 || '';
  elements.modalInput2.value = options.value2 || '';
  elements.modalSelect.value = options.selectValue || '3';
  elements.modalInput3.value = options.value3 || '';
  elements.modalUrlRow.classList.toggle('hidden', !options.showUrl);
  elements.modalTagsRow.classList.toggle('hidden', !options.showTags);
  elements.modalSelectRow.classList.toggle('hidden', !options.showSelect);
  elements.modalInput1.placeholder = options.placeholder1 || 'Enter name';
  elements.modalInput2.placeholder = options.placeholder2 || 'Enter URL';
  elements.modalInput1.focus();
}

function hideModal() {
  activeModal = null;
  elements.modalOverlay.classList.add('hidden');
}

function handleModalSubmit(event) {
  event.preventDefault();
  const value1 = elements.modalInput1.value.trim();
  const value2 = elements.modalInput2.value.trim();
  const value3 = elements.modalInput3.value.trim();
  const tags = value3 ? value3.split(/\s+/).filter(Boolean) : [];
  const selectValue = elements.modalSelect.value;

  if (!value1) return;

  switch (activeModal) {
    case 'addBoard':
      createBoard(value1);
      break;
    case 'addNavFolder':
      addNavSection({ type: 'folder', title: value1 });
      break;
    case 'addNavTitle':
      addNavSection({ type: 'title', title: value1 });
      break;
    case 'addBookmark':
      if (contextTarget?.area === 'speed-dial') {
        addSpeedDialBookmark(value1, value2, tags);
      } else {
        addBookmark(value1, value2, contextTarget?.columnId, tags);
      }
      break;
    case 'addFolder':
      addBookmarkItem('folder', value1, contextTarget?.columnId);
      break;
    case 'addTitle':
      addBookmarkItem('title', value1, contextTarget?.columnId);
      break;
    case 'boardSettings':
      updateBoardSettings(value1, selectValue);
      break;
    case 'renameItem':
      renameContextItem(value1, contextTarget);
      break;
    case 'editBookmark':
      editBookmarkContext(value1, value2, tags, contextTarget);
      break;
    case 'addEssential':
    case 'editEssential':
      if (setEssential(contextTarget.slot, value1, value2, tags)) {
        hideModal();
        renderEssentials();
        saveState();
      }
      return;
    case 'editSpeedDial': {
      if (!isValidUrl(value2)) { alert('Please enter a valid URL.'); return; }
      const board = getActiveBoard();
      const sdItem = board.speedDial.find(i => i.id === contextTarget?.itemId);
      if (sdItem) { sdItem.title = value1; sdItem.url = normalizeUrl(value2); sdItem.tags = tags; }
      break;
    }
    case 'addBoardSubfolder': {
      const parent = contextTarget?.item;
      if (parent) {
        parent.children = parent.children || [];
        parent.children.push({ id: `id-${Date.now()}`, type: 'folder', title: value1, children: [] });
        parent.collapsed = false;
      }
      break;
    }
    case 'addNavSubfolder': {
      const parent = contextTarget?.item;
      if (parent) {
        parent.children = parent.children || [];
        parent.children.push({ id: `id-${Date.now()}`, type: 'folder', title: value1, children: [] });
        parent.collapsed = false;
      }
      break;
    }
    default:
      break;
  }

  hideModal();
  renderAll();
  saveState();
}

function openBoardSettings() {
  const board = getActiveBoard();
  showModal('boardSettings', {
    title: 'Board Settings',
    placeholder1: 'Board title',
    value1: board.title,
    showSelect: true,
    selectValue: board.columnCount.toString()
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
    case 'deleteItem':
      deleteBoardTarget(contextTarget);
      renderAll();
      saveState();
      break;
    case 'deleteNavItem':
      if (contextTarget.item?.type === 'board' && contextTarget.item?.boardId) {
        deleteBoardAndNavItem(contextTarget.itemId, contextTarget.item.boardId);
      } else {
        removeNavItemById(contextTarget.itemId);
      }
      renderAll();
      saveState();
      break;
    case 'addBoard':
      showModal('addBoard', { title: 'Create Board', placeholder1: 'Board title' });
      break;
    case 'addNavFolder':
      showModal('addNavFolder', { title: 'Add Navigation Folder', placeholder1: 'Folder title' });
      break;
    case 'addNavTitle':
      showModal('addNavTitle', { title: 'Add Navigation Title', placeholder1: 'Title text' });
      break;
    case 'addNavDivider':
      state.navItems.push({ id: `id-${Date.now()}`, type: 'title', title: '' });
      renderNav();
      saveState();
      break;
    case 'addFolder':
      showModal('addFolder', { title: 'Add Folder', placeholder1: 'Folder title', contextTarget });
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
      addBookmarkItem('title', '', contextTarget.columnId);
      renderAll();
      saveState();
      break;
    case 'editSpeedDial':
      showModal('editSpeedDial', {
        title: 'Edit Speed Dial Bookmark',
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
      const board = getActiveBoard();
      board.speedDial = board.speedDial.filter(i => i.id !== contextTarget.itemId);
      renderAll();
      saveState();
      break;
    }
    case 'addBoardSubfolder':
      showModal('addBoardSubfolder', { title: 'Create Subfolder', placeholder1: 'Folder name' });
      break;
    case 'addNavSubfolder':
      showModal('addNavSubfolder', { title: 'Create Subfolder', placeholder1: 'Folder name' });
      break;
    case 'addEssential':
      showModal('addEssential', {
        title: 'Add Essential Bookmark', placeholder1: 'Bookmark title',
        showUrl: true, placeholder2: 'Bookmark URL',
        showTags: true, contextTarget
      });
      break;
    case 'editEssential':
      showModal('editEssential', {
        title: 'Edit Essential Bookmark',
        placeholder1: 'Bookmark title', value1: contextTarget.item.title,
        showUrl: true, placeholder2: 'Bookmark URL', value2: contextTarget.item.url || '',
        showTags: true, value3: (contextTarget.item.tags || []).join(' ')
      });
      break;
    case 'deleteEssential':
      removeEssential(contextTarget.slot);
      renderEssentials();
      saveState();
      break;
    case 'addSpeedDialBookmark':
      showModal('addBookmark', {
        title: 'Add Speed Dial Bookmark', placeholder1: 'Bookmark title',
        showUrl: true, placeholder2: 'Bookmark URL',
        showTags: true, contextTarget
      });
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
    options.push({ label: 'Rename folder', action: 'renameItem' });
    if (depth < 2) options.push({ label: 'Create subfolder', action: 'addBoardSubfolder' });
    options.push({ label: 'Delete folder', action: 'deleteItem' });
  } else if (item.type === 'bookmark') {
    options.push({ label: 'Edit bookmark', action: 'editBookmark' });
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

function showSettingsPanel() {
  document.getElementById('modalCard').classList.add('hidden');
  document.getElementById('settingsPanel').classList.remove('hidden');
  elements.modalOverlay.classList.remove('hidden');
  const s = state.settings;
  document.getElementById('stgHubName').value = state.hubName || '';
  document.getElementById('stgBookmarkFont').value = s.bookmarkFontSize;
  document.getElementById('stgShowTags').checked = s.showTags;
  document.getElementById('stgFolderFont').value = s.folderFontSize;
  document.getElementById('stgTitleFont').value = s.titleFontSize;
  document.getElementById('stgLineThicknessVal').textContent = s.titleLineThickness;
  document.getElementById('stgBoardTitleFont').value = s.boardTitleFontSize;
  document.getElementById('stgBoardFont').value = s.boardFontSize;
}

function hideSettingsPanel() {
  document.getElementById('settingsPanel').classList.add('hidden');
  document.getElementById('modalCard').classList.remove('hidden');
  elements.modalOverlay.classList.add('hidden');
  saveState();
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

  document.getElementById('settingsDoneBtn').addEventListener('click', hideSettingsPanel);
}

// --- Init ---

function attachEventListeners() {
  elements.globalSettingsBtn.addEventListener('click', showSettingsPanel);

  elements.speedDial.addEventListener('click', event => {
    if (!event.target.closest('#addSpeedDialBookmarkBtn')) return;
    event.preventDefault();
    contextTarget = { area: 'speed-dial' };
    showModal('addBookmark', {
      title: 'Add Speed Dial Bookmark', placeholder1: 'Bookmark title',
      showUrl: true, placeholder2: 'Bookmark URL',
      showTags: true, contextTarget
    });
  });

  elements.boardSettingsBtn.addEventListener('click', openBoardSettings);
  elements.modalCancelBtn.addEventListener('click', hideModal);
  elements.modalOverlay.addEventListener('click', event => {
    if (event.target !== elements.modalOverlay) return;
    if (!document.getElementById('settingsPanel').classList.contains('hidden')) {
      hideSettingsPanel();
    } else {
      hideModal();
    }
  });
  elements.modalForm.addEventListener('submit', handleModalSubmit);
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
  document.addEventListener('click', event => {
    if (!elements.contextMenu.contains(event.target)) hideContextMenu();
  });
}

attachEventListeners();
attachSettingsListeners();
renderAll();
saveState();
