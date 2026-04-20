// --- Context menu ---

function _clearSubmenus() {
  document.querySelectorAll('.context-submenu').forEach(s => s.remove());
}

function showContextMenu(x, y, actions) {
  const menu = elements.contextMenu;
  menu.innerHTML = '';
  actions.forEach(action => {
    const button = document.createElement('button');
    button.textContent = action.label;
    if (action.submenu && action.submenu.length) {
      button.classList.add('has-submenu');
      const arrow = document.createElement('span');
      arrow.className = 'submenu-arrow';
      arrow.textContent = '›';
      button.appendChild(arrow);
      button.addEventListener('mouseenter', () => {
        _clearSubmenus();
        const sub = document.createElement('div');
        sub.className = 'context-menu context-submenu';
        action.submenu.forEach(subAction => {
          const subBtn = document.createElement('button');
          subBtn.textContent = subAction.label;
          subBtn.addEventListener('click', () => { handleContextMenuAction(subAction.action); hideContextMenu(); });
          sub.appendChild(subBtn);
        });
        document.body.appendChild(sub);
        const rect = button.getBoundingClientRect();
        let left = rect.right + 2;
        let top = rect.top;
        sub.style.left = `${left}px`;
        sub.style.top = `${top}px`;
        const subRect = sub.getBoundingClientRect();
        if (subRect.right > window.innerWidth - 4) left = rect.left - subRect.width - 2;
        if (subRect.bottom > window.innerHeight - 4) top = window.innerHeight - subRect.height - 4;
        sub.style.left = `${left}px`;
        sub.style.top = `${top}px`;
      });
    } else {
      button.addEventListener('mouseenter', _clearSubmenus);
      button.addEventListener('click', () => { handleContextMenuAction(action.action); hideContextMenu(); });
    }
    menu.appendChild(button);
  });
  menu.style.left = '0';
  menu.style.top = '0';
  menu.classList.remove('hidden');
  const menuW = menu.offsetWidth;
  const menuH = menu.offsetHeight;
  menu.style.left = `${Math.min(x, window.innerWidth - menuW - 4)}px`;
  menu.style.top  = `${Math.min(y, window.innerHeight - menuH - 4)}px`;
}

function hideContextMenu() {
  _clearSubmenus();
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
    case 'editBoard': {
      const boardId = contextTarget.item?.boardId;
      if (boardId) {
        state.activeBoardId = boardId;
        renderAll();
        saveState();
        showBoardSettingsPanel();
      }
      break;
    }
    case 'editSpeedDial':
    case 'editBookmark':
      showModal('editBookmark', {
        title: 'Edit Bookmark',
        placeholder1: 'Bookmark title',
        value1: contextTarget.item.title,
        showUrl: true,
        placeholder2: 'Bookmark URL',
        value2: contextTarget.item.url || '',
        showTags: true,
        value3: (contextTarget.item.tags || []).join(' '),
        inheritedTags: getContextInheritedTags(contextTarget)
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
      const capturedNavItemId = contextTarget.itemId;
      confirmDelete(navKey, navLabel, () => {
        pushUndoSnapshot();
        if (isNavBoard) {
          const fullBoard = state.boards.find(b => b.id === capturedNavBoardId);
          pushToTrash({ navItem: capturedNavItem, board: fullBoard ? JSON.parse(JSON.stringify(fullBoard)) : null }, { area: 'nav-board', parentId: capturedNavParentId });
          deleteBoardAndNavItem(capturedNavItemId, capturedNavBoardId);
        } else {
          pushToTrash(capturedNavItem, { area: 'nav-item', parentId: capturedNavParentId });
          removeNavItemById(capturedNavItemId);
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
      showModal('addFolder', { title: 'Add Navigation Folder', placeholder1: 'New Folder' });
      break;
    case 'addNavTitle':
      showModal('addTitle', { title: 'Add Navigation Title', placeholder1: 'New Title' });
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
        title: 'Add Bookmark', placeholder1: 'New Bookmark',
        showUrl: true, placeholder2: 'Bookmark URL',
        showTags: true, contextTarget,
        inheritedTags: getContextInheritedTags(contextTarget)
      });
      break;
    case 'addTitle':
      showModal('addTitle', { title: 'Add Title', placeholder1: 'New Title', contextTarget });
      break;
    case 'addDivider':
      pushUndoSnapshot();
      addBookmarkItem('title', '', contextTarget.columnId);
      renderAll();
      saveState();
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
      showModal('addFolder', { title: 'Create Subfolder', placeholder1: 'New Folder' });
      break;
    case 'addEssential':
      showModal('addBookmark', {
        title: 'Add Bookmark', placeholder1: 'New Bookmark',
        showUrl: true, placeholder2: 'Bookmark URL', showTags: true
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
      const found = findBoardItemInColumns(getActiveBoard(), contextTarget.itemId);
      if (found?.item) { found.item.faviconCache = ''; renderAll(); saveState(); }
      break;
    }
    case 'duplicateBookmark': {
      const found = findBoardItemInColumns(getActiveBoard(), contextTarget.itemId);
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
      const cab = getActiveBoard();
      const boards = cab?.isImportManager
        ? state.boards.filter(b => !b.isImportManager)
        : state.boards.filter(b => !b.isImportManager && b.id !== cab?.id);
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
        title: 'Add Speed Dial Bookmark', placeholder1: 'New Bookmark',
        showUrl: true, placeholder2: 'Bookmark URL', showTags: true, contextTarget,
        inheritedTags: getContextInheritedTags(contextTarget)
      });
      break;
    case 'editFolder':
      showFolderModal('edit', contextTarget);
      break;
    case 'editWidget':
      openWidgetSettings(contextTarget.item, () => { renderAll(); saveState(); });
      break;
    default:
      if (action.startsWith('addWidget:')) {
        const type = action.slice('addWidget:'.length);
        pushUndoSnapshot();
        const widget = _newWidgetState(type);
        const board = getActiveBoard();
        const col = board?.columns.find(c => c.id === contextTarget.columnId);
        if (col) col.items.push(widget);
        renderAll();
        saveState();
        openWidgetSettings(widget, () => { renderAll(); saveState(); });
      } else if (action.startsWith('addNavWidget:')) {
        const type = action.slice('addNavWidget:'.length);
        pushUndoSnapshot();
        const widget = _newWidgetState(type);
        state.navItems.push(widget);
        renderNav();
        saveState();
        openWidgetSettings(widget, () => { renderNav(); saveState(); });
      }
      break;
  }
}

function handleBoardContextMenu(event, item, columnId, parentFolder, depth) {
  contextTarget = { area: 'board-item', itemId: item.id, columnId, parentId: parentFolder ? parentFolder.id : null, item, depth };

  const activeBoard = getActiveBoard();
  const regularBoards = state.boards.filter(b => !b.isImportManager);
  const canMoveToBoard = activeBoard?.isImportManager
    ? regularBoards.length > 0
    : regularBoards.filter(b => b.id !== activeBoard?.id).length > 0;

  const options = [];
  if (item.type === 'folder') {
    options.push({ label: 'Edit folder', action: 'editFolder' });
    options.push({ label: 'Open all', action: 'openAll' });
    if (depth < 2) options.push({ label: 'Create subfolder', action: 'addBoardSubfolder' });
    if (canMoveToBoard) options.push({ label: 'Move to board', action: 'moveToBoard' });
    options.push({ label: 'Delete folder', action: 'deleteItem' });
  } else if (item.type === 'bookmark') {
    options.push({ label: 'Edit bookmark', action: 'editBookmark' });
    options.push({ label: 'Duplicate', action: 'duplicateBookmark' });
    options.push({ label: 'Refresh favicon', action: 'refreshFavicon' });
    if (canMoveToBoard) options.push({ label: 'Move to board', action: 'moveToBoard' });
    options.push({ label: 'Delete bookmark', action: 'deleteItem' });
  } else if (item.type === 'title') {
    options.push({ label: 'Rename', action: 'renameItem' });
    options.push({ label: 'Delete', action: 'deleteItem' });
  }

  showContextMenu(event.clientX, event.clientY, options);
}

function handleNavContextMenu(event, item, parent, depth = 0) {
  contextTarget = { area: 'nav-item', itemId: item.id, parentId: parent ? parent.id : null, item, depth };

  const options = [];
  if (item.type === 'board') {
    options.push({ label: 'Edit board', action: 'editBoard' });
    options.push({ label: 'Delete board', action: 'deleteNavItem' });
  } else if (item.type === 'folder') {
    options.push({ label: 'Rename folder', action: 'renameItem' });
    if (depth < 2) options.push({ label: 'Create subfolder', action: 'addNavSubfolder' });
    options.push({ label: 'Delete folder', action: 'deleteNavItem' });
  } else if (item.type === 'title') {
    options.push({ label: 'Rename', action: 'renameItem' });
    options.push({ label: 'Delete', action: 'deleteNavItem' });
  } else if (item.type === 'widget') {
    options.push({ label: 'Widget settings', action: 'editWidget' });
    options.push({ label: 'Delete widget', action: 'deleteNavItem' });
  }

  showContextMenu(event.clientX, event.clientY, options);
}

function handleEssentialContextMenu(event, slot, item) {
  contextTarget = { area: 'essential', slot, item };
  const options = item
    ? [{ label: 'Edit bookmark', action: 'editEssential' }, { label: 'Delete bookmark', action: 'deleteEssential' }]
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
  const widgetSubmenu = Object.entries(WIDGET_REGISTRY)
    .filter(([, def]) => def.allowedIn.includes('column'))
    .map(([type, def]) => ({ label: def.name, action: `addWidget:${type}` }));
  const items = [
    { label: 'Add folder', action: 'addFolder' },
    { label: 'Add bookmark', action: 'addBookmark' },
    { label: 'Add title', action: 'addTitle' },
    { label: 'Add divider', action: 'addDivider' }
  ];
  if (widgetSubmenu.length) items.push({ label: 'Add widget', submenu: widgetSubmenu });
  showContextMenu(event.clientX, event.clientY, items);
}

function handleNavListContextMenu(event) {
  event.preventDefault();
  contextTarget = { area: 'nav-empty' };
  const widgetSubmenu = Object.entries(WIDGET_REGISTRY)
    .filter(([, def]) => def.allowedIn.includes('navpane'))
    .map(([type, def]) => ({ label: def.name, action: `addNavWidget:${type}` }));
  const items = [
    { label: 'Add board', action: 'addBoard' },
    { label: 'Add folder', action: 'addNavFolder' },
    { label: 'Add title', action: 'addNavTitle' },
    { label: 'Add divider', action: 'addNavDivider' }
  ];
  if (widgetSubmenu.length) items.push({ label: 'Add widget', submenu: widgetSubmenu });
  showContextMenu(event.clientX, event.clientY, items);
}
