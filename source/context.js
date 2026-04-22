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

function _findNavItem(id, items) {
  for (const item of (items || state.navItems)) {
    if (item.id === id) return item;
    if (item.children) { const r = _findNavItem(id, item.children); if (r) return r; }
  }
  return null;
}

function handleContextMenuAction(action) {
  if (!contextTarget) return;

  switch (action) {
    case 'openNewTab':
      if (contextTarget.item?.url) window.open(contextTarget.item.url, '_blank', 'noreferrer noopener');
      break;
    case 'openNewWindow':
      if (contextTarget.item?.url) window.open(contextTarget.item.url, '_blank', 'noreferrer noopener,noopener,width=1280,height=800');
      break;
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
    case 'addCollection':
      pushUndoSnapshot();
      createCollection('New Collection');
      renderAll();
      saveState();
      showModal('editCollection', {
        title: 'New Collection', placeholder1: 'Collection Name', value1: 'New Collection',
        showTags: true, showSharedTags: true
      });
      break;
    case 'editCollection': {
      const coll = contextTarget.item;
      if (!coll) break;
      contextTarget = { ...contextTarget, collectionId: coll.id };
      showModal('editCollection', {
        title: 'Edit Collection', placeholder1: 'Collection Name', value1: coll.title,
        showTags: true, showSharedTags: true,
        value3: (coll.tags || []).join(' '),
        value4: (coll.sharedTags || []).join(' ')
      });
      break;
    }
    case 'addBoardToCollection': {
      const coll = contextTarget.item || state.navItems.find(i => i.id === contextTarget.collectionId);
      if (!coll) break;
      pushUndoSnapshot();
      createBoardInCollection(coll, 'New Board');
      renderAll();
      saveState();
      showBoardSettingsPanel(true);
      break;
    }
    case 'deleteCollection': {
      const coll = contextTarget.item;
      if (!coll) break;
      const boardCount = (coll.boardIds || []).length;
      const msg = boardCount
        ? `Delete collection "${coll.title}"? Its ${boardCount} board${boardCount > 1 ? 's' : ''} will be moved back to the nav.`
        : `Delete collection "${coll.title}"?`;
      showConfirmDialog(msg, () => {
        pushUndoSnapshot();
        for (const boardId of (coll.boardIds || [])) {
          const board = state.boards.find(b => b.id === boardId);
          if (board) state.navItems.push({ id: `nav-${boardId}`, type: 'board', title: board.title, boardId });
        }
        removeNavItemById(coll.id);
        if (state.activeCollectionId === coll.id) {
          state.activeCollectionId = null;
          state.activeBoardId = coll.boardIds[0] || state.activeBoardId;
        }
        renderAll(); saveState();
      }, 'Delete');
      break;
    }
    case 'editBoardFromTab': {
      const board = state.boards.find(b => b.id === contextTarget.boardId);
      if (board) { state.activeBoardId = board.id; renderBoard(); showBoardSettingsPanel(); }
      break;
    }
    case 'unlockBoardFromTab': {
      const board = state.boards.find(b => b.id === contextTarget.boardId);
      if (board) { board.locked = false; renderAll(); saveState(); }
      break;
    }
    case 'removeFromCollection': {
      const coll = state.navItems.find(i => i.id === contextTarget.collectionId);
      if (!coll) break;
      pushUndoSnapshot();
      coll.boardIds = (coll.boardIds || []).filter(id => id !== contextTarget.boardId);
      const board = state.boards.find(b => b.id === contextTarget.boardId);
      if (board) state.navItems.push({ id: `nav-${contextTarget.boardId}`, type: 'board', title: board.title, boardId: contextTarget.boardId });
      if (state.activeBoardId === contextTarget.boardId) {
        state.activeCollectionId = coll.boardIds.length ? coll.id : null;
        if (coll.boardIds.length) state.activeBoardId = coll.boardIds[0];
      }
      renderAll(); saveState();
      break;
    }
    case 'deleteBoardFromCollection': {
      const coll = state.navItems.find(i => i.id === contextTarget.collectionId);
      const board = state.boards.find(b => b.id === contextTarget.boardId);
      if (!coll || !board) break;
      confirmDelete('confirmDeleteBoard', `Delete board "${board.title}"? This cannot be undone.`, () => {
        pushUndoSnapshot();
        coll.boardIds = (coll.boardIds || []).filter(id => id !== contextTarget.boardId);
        state.boards = state.boards.filter(b => b.id !== contextTarget.boardId);
        if (state.activeBoardId === contextTarget.boardId) {
          state.activeBoardId = coll.boardIds[0] || null;
          if (!coll.boardIds.length) state.activeCollectionId = null;
        }
        renderAll(); saveState(); updateTrashBadge();
      });
      break;
    }
    case 'editBoardFromFolderTab': {
      const board = state.boards.find(b => b.id === contextTarget.boardId);
      if (board) { state.activeBoardId = board.id; renderBoard(); showBoardSettingsPanel(); }
      break;
    }
    case 'unlockBoardFromFolderTab': {
      const board = state.boards.find(b => b.id === contextTarget.boardId);
      if (board) { board.locked = false; renderAll(); saveState(); }
      break;
    }
    case 'removeFromFolder': {
      const folderItem = _findNavItem(contextTarget.folderId);
      if (!folderItem) break;
      pushUndoSnapshot();
      const navItem = (folderItem.children || []).find(c => c.id === contextTarget.navItemId);
      folderItem.children = (folderItem.children || []).filter(c => c.id !== contextTarget.navItemId);
      if (navItem) state.navItems.push(navItem);
      renderAll(); saveState();
      break;
    }
    case 'deleteBoardFromFolder': {
      const folderItem2 = _findNavItem(contextTarget.folderId);
      const board2 = state.boards.find(b => b.id === contextTarget.boardId);
      if (!folderItem2 || !board2) break;
      confirmDelete('confirmDeleteBoard', `Delete board "${board2.title}"? This cannot be undone.`, () => {
        pushUndoSnapshot();
        folderItem2.children = (folderItem2.children || []).filter(c => c.id !== contextTarget.navItemId);
        state.boards = state.boards.filter(b => b.id !== contextTarget.boardId);
        if (state.activeBoardId === contextTarget.boardId) {
          const sibling = (folderItem2.children || []).find(c => c.type === 'board' && c.boardId);
          state.activeBoardId = sibling?.boardId || null;
        }
        renderAll(); saveState(); updateTrashBadge();
      });
      break;
    }
    case 'addBoardToFolder': {
      const folderForAdd = _findNavItem(contextTarget.folderId || contextTarget.itemId);
      if (!folderForAdd) break;
      pushUndoSnapshot();
      const newId = `board-${Date.now()}`;
      const newBoard = {
        id: newId, title: 'New Board', columnCount: 3, backgroundImage: '', containerOpacity: 100,
        showSpeedDial: true, sharedTags: [], tags: [], inheritTags: true, speedDial: [],
        columns: [
          { id: `${newId}-col-1`, title: 'Column 1', items: [] },
          { id: `${newId}-col-2`, title: 'Column 2', items: [] },
          { id: `${newId}-col-3`, title: 'Column 3', items: [] },
          { id: `${newId}-inbox`, title: 'Inbox', isInbox: true, items: [] }
        ]
      };
      state.boards.push(newBoard);
      if (!folderForAdd.children) folderForAdd.children = [];
      folderForAdd.children.push({ id: `nav-${Date.now()}`, type: 'board', title: 'New Board', boardId: newId });
      state.activeBoardId = newId;
      state.activeCollectionId = null;
      renderAll(); saveState(); showBoardSettingsPanel(true);
      break;
    }
    case 'editCollectionSpeedDial':
      showModal('editBookmark', { item: contextTarget.item, area: 'collection-speed-dial', collectionId: contextTarget.collectionId });
      break;
    case 'duplicateCollectionSpeedDial': {
      const srcColl = state.navItems.find(i => i.id === contextTarget.collectionId);
      if (srcColl) {
        pushUndoSnapshot();
        const dup = { ...JSON.parse(JSON.stringify(contextTarget.item)), id: `bm-${Date.now()}` };
        const idx = srcColl.speedDial.findIndex(i => i.id === contextTarget.itemId);
        srcColl.speedDial.splice(idx + 1, 0, dup);
        renderAll(); saveState();
      }
      break;
    }
    case 'refreshCollectionSpeedDialFavicon': {
      const item = contextTarget.item;
      if (item?.url) { item.faviconCache = ''; renderAll(); saveState(); }
      break;
    }
    case 'deleteCollectionSpeedDial': {
      const srcColl = state.navItems.find(i => i.id === contextTarget.collectionId);
      if (srcColl) {
        pushUndoSnapshot();
        srcColl.speedDial = srcColl.speedDial.filter(i => i.id !== contextTarget.itemId);
        renderAll(); saveState();
      }
      break;
    }
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
    case 'addBookmarkToFolder': {
      const folderCtx = { ...contextTarget, area: 'board-folder-item' };
      showModal('addBookmark', {
        title: 'Add Bookmark', placeholder1: 'New Bookmark',
        showUrl: true, placeholder2: 'Bookmark URL',
        showTags: true, contextTarget: folderCtx,
        inheritedTags: getContextInheritedTags({ ...contextTarget, area: 'board-subfolder' })
      });
      break;
    }
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
        showTags: true, value3: (contextTarget.item.tags || []).join(' '),
        inheritedTags: getContextInheritedTags(contextTarget)
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
      const area = contextTarget.area;
      if (area === 'speed-dial-item') {
        const board = getActiveBoard();
        const sdItem = board?.speedDial.find(i => i.id === contextTarget.itemId);
        if (sdItem) { sdItem.faviconCache = ''; renderAll(); saveState(); }
      } else if (area === 'essential') {
        const essItem = state.essentials[contextTarget.slot];
        if (essItem) { essItem.faviconCache = ''; renderEssentials(); saveState(); }
      } else {
        const found = findBoardItemInColumns(getBoardForContext(contextTarget), contextTarget.itemId);
        if (found?.item) { found.item.faviconCache = ''; renderAll(); saveState(); }
      }
      break;
    }
    case 'duplicateBookmark': {
      const area = contextTarget.area;
      if (area === 'speed-dial-item') {
        const board = getActiveBoard();
        const sdIdx = board?.speedDial.findIndex(i => i.id === contextTarget.itemId);
        if (sdIdx !== -1) {
          pushUndoSnapshot();
          const copy = { ...board.speedDial[sdIdx], id: `bm-${Date.now()}`, title: board.speedDial[sdIdx].title + ' (copy)', faviconCache: '' };
          board.speedDial.splice(sdIdx + 1, 0, copy);
          renderAll(); saveState();
        }
      } else if (area === 'essential') {
        const essItem = state.essentials[contextTarget.slot];
        if (essItem) {
          pushUndoSnapshot();
          const copy = { ...essItem, id: `bm-${Date.now()}`, title: essItem.title + ' (copy)', faviconCache: '' };
          state.essentials.push(copy);
          renderEssentials(); saveState();
        }
      } else {
        const found = findBoardItemInColumns(getBoardForContext(contextTarget), contextTarget.itemId);
        if (found?.item) {
          pushUndoSnapshot();
          const copy = { ...found.item, id: `bm-${Date.now()}`, title: found.item.title + ' (copy)', faviconCache: '' };
          found.list.splice(found.list.indexOf(found.item) + 1, 0, copy);
          renderAll(); saveState();
        }
      }
      break;
    }
    case 'moveToBoard': {
      const cab = getActiveBoard();
      const area = contextTarget.area;
      // Speed dial and essentials are not board-scoped, so offer all boards.
      // Board items exclude the current board (already there); import manager gets all regular boards.
      const boards = (area === 'speed-dial-item' || area === 'essential')
        ? state.boards.filter(b => !b.isImportManager && !b.locked)
        : cab?.isImportManager
          ? state.boards.filter(b => !b.isImportManager && !b.locked)
          : state.boards.filter(b => !b.isImportManager && !b.locked && b.id !== cab?.id);
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
    case 'lockItem':
      if (contextTarget.item) {
        pushUndoSnapshot();
        contextTarget.item.locked = true;
        renderAll();
        saveState();
      }
      break;
    case 'unlockItem':
      if (contextTarget.item) {
        pushUndoSnapshot();
        contextTarget.item.locked = false;
        renderAll();
        saveState();
      }
      break;
    case 'lockBoard': {
      const lb = state.boards.find(b => b.id === contextTarget.item?.boardId);
      if (lb) { pushUndoSnapshot(); lb.locked = true; renderAll(); saveState(); }
      break;
    }
    case 'unlockBoard': {
      const ub = state.boards.find(b => b.id === contextTarget.item?.boardId);
      if (ub) { pushUndoSnapshot(); ub.locked = false; renderAll(); saveState(); }
      break;
    }
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
      } else if (action.startsWith('openInBoard:')) {
        const boardId = action.slice('openInBoard:'.length);
        state.activeBoardId = boardId;
        const targetBoard = state.boards.find(b => b.id === boardId);
        const highlightId = contextTarget?.item?.id || null;
        if (targetBoard && highlightId) {
          unfoldBoardItemAncestors(targetBoard, highlightId);
        }
        closeSearchModal();
        renderAll();
        saveState();
        if (highlightId) {
          const el = document.querySelector(`[data-item-id="${highlightId}"]`);
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.classList.add('search-highlight');
            el.addEventListener('animationend', () => el.classList.remove('search-highlight'), { once: true });
          }
        }
      } else if (action.startsWith('moveToBoard:')) {
        const targetBoardId = action.slice('moveToBoard:'.length);
        const targetBoard = state.boards.find(b => b.id === targetBoardId);
        if (targetBoard && !targetBoard.locked && contextTarget?.item) {
          pushUndoSnapshot();
          const capturedItem = JSON.parse(JSON.stringify(contextTarget.item));
          capturedItem.type = 'bookmark';
          if (!capturedItem.tags) capturedItem.tags = [];
          deleteBoardTarget(contextTarget);
          (getBoardInbox(targetBoard) || targetBoard.columns[0]).items.push(capturedItem);
          renderAll();
          saveState();
        }
      }
      break;
  }
}

function handleBoardContextMenu(event, item, columnId, parentFolder, depth, effectiveLocked = false, inheritedLock = false) {
  if (getActiveBoard()?.locked) return;
  contextTarget = { area: 'board-item', itemId: item.id, columnId, parentId: parentFolder ? parentFolder.id : null, item, depth };

  const options = [];

  if (effectiveLocked) {
    if (!inheritedLock) {
      options.push({ label: 'Unlock item', action: 'unlockItem' });
    }
    showContextMenu(event.clientX, event.clientY, options);
    return;
  }

  const activeBoard = getActiveBoard();
  const regularBoards = state.boards.filter(b => !b.isImportManager && !b.locked);
  const canMoveToBoard = activeBoard?.isImportManager
    ? regularBoards.length > 0
    : regularBoards.filter(b => b.id !== activeBoard?.id).length > 0;

  if (item.type === 'folder') {
    options.push({ label: 'Edit folder', action: 'editFolder' });
    options.push({ label: 'Add bookmark', action: 'addBookmarkToFolder' });
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

  if (item.type === 'folder' || item.type === 'bookmark') {
    options.push({ label: 'Lock item', action: 'lockItem' });
  }

  showContextMenu(event.clientX, event.clientY, options);
}

function handleNavContextMenu(event, item, parent, depth = 0) {
  contextTarget = { area: 'nav-item', itemId: item.id, parentId: parent ? parent.id : null, item, depth };

  const options = [];
  if (item.type === 'board') {
    const board = state.boards.find(b => b.id === item.boardId);
    if (board?.locked) {
      options.push({ label: 'Unlock board', action: 'unlockBoard' });
    } else {
      options.push({ label: 'Edit board', action: 'editBoard' });
      options.push({ label: 'Delete board', action: 'deleteNavItem' });
      options.push({ label: 'Lock board', action: 'lockBoard' });
    }
  } else if (item.type === 'folder') {
    options.push({ label: 'Edit folder', action: 'editFolder' });
    options.push({ label: 'Add board', action: 'addBoardToFolder' });
    if (depth < 2) options.push({ label: 'Create subfolder', action: 'addNavSubfolder' });
    options.push({ label: 'Delete folder', action: 'deleteNavItem' });
  } else if (item.type === 'title') {
    options.push({ label: 'Rename', action: 'renameItem' });
    options.push({ label: 'Delete', action: 'deleteNavItem' });
  } else if (item.type === 'collection') {
    options.push({ label: 'Edit collection', action: 'editCollection' });
    options.push({ label: 'Add board', action: 'addBoardToCollection' });
    options.push({ label: 'Delete collection', action: 'deleteCollection' });
  } else if (item.type === 'widget') {
    options.push({ label: 'Widget settings', action: 'editWidget' });
    options.push({ label: 'Delete widget', action: 'deleteNavItem' });
  }

  showContextMenu(event.clientX, event.clientY, options);
}

function handleCollectionTabContextMenu(event, boardId, collection) {
  contextTarget = { area: 'collection-tab', boardId, collectionId: collection.id };
  const board = state.boards.find(b => b.id === boardId);
  const options = board?.locked
    ? [{ label: 'Unlock board', action: 'unlockBoardFromTab' }]
    : [
        { label: 'Edit board', action: 'editBoardFromTab' },
        { label: 'Remove from collection', action: 'removeFromCollection' },
        { label: 'Delete board', action: 'deleteBoardFromCollection' }
      ];
  showContextMenu(event.clientX, event.clientY, options);
}

function handleFolderTabContextMenu(event, navItem, folder) {
  contextTarget = { area: 'folder-tab', navItemId: navItem.id, boardId: navItem.boardId, folderId: folder.id };
  const board = state.boards.find(b => b.id === navItem.boardId);
  const options = board?.locked
    ? [{ label: 'Unlock board', action: 'unlockBoardFromFolderTab' }]
    : [
        { label: 'Edit board', action: 'editBoardFromFolderTab' },
        { label: 'Remove from folder', action: 'removeFromFolder' },
        { label: 'Delete board', action: 'deleteBoardFromFolder' }
      ];
  showContextMenu(event.clientX, event.clientY, options);
}

function handleCollectionSpeedDialContextMenu(event, item, collection) {
  contextTarget = { area: 'collection-speed-dial', itemId: item.id, collectionId: collection.id, item };
  showContextMenu(event.clientX, event.clientY, [
    { label: 'Edit bookmark', action: 'editCollectionSpeedDial' },
    { label: 'Duplicate', action: 'duplicateCollectionSpeedDial' },
    { label: 'Refresh favicon', action: 'refreshCollectionSpeedDialFavicon' },
    { label: 'Delete bookmark', action: 'deleteCollectionSpeedDial' }
  ]);
}

function handleEssentialContextMenu(event, slot, item) {
  contextTarget = { area: 'essential', slot, item };
  const options = item
    ? [
        { label: 'Edit bookmark',    action: 'editEssential' },
        { label: 'Duplicate',        action: 'duplicateBookmark' },
        { label: 'Refresh favicon',  action: 'refreshFavicon' },
        { label: 'Move to board',    action: 'moveToBoard' },
        { label: 'Delete bookmark',  action: 'deleteEssential' }
      ]
    : [{ label: 'Add bookmark', action: 'addEssential' }];
  showContextMenu(event.clientX, event.clientY, options);
}

function handleSpeedDialContextMenu(event, item) {
  if (getActiveBoard()?.locked) return;
  contextTarget = { area: 'speed-dial-item', itemId: item.id, item };
  const cab = getActiveBoard();
  const boards = state.boards.filter(b => !b.isImportManager && !b.locked);
  const canMove = boards.length > 0;
  const options = [
    { label: 'Edit bookmark',   action: 'editSpeedDial' },
    { label: 'Duplicate',       action: 'duplicateBookmark' },
    { label: 'Refresh favicon', action: 'refreshFavicon' },
  ];
  if (canMove) options.push({ label: 'Move to board', action: 'moveToBoard' });
  options.push({ label: 'Delete bookmark', action: 'deleteSpeedDial' });
  showContextMenu(event.clientX, event.clientY, options);
}

function handleBoardColumnContextMenu(event, columnId) {
  if (getActiveBoard()?.locked) return;
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

function handleSearchResultContextMenu(event, item, meta) {
  event.preventDefault();
  event.stopPropagation();

  if (meta.area === 'essential') {
    handleEssentialContextMenu(event, meta.slot, item);
    return;
  }
  if (meta.area === 'speed-dial-item') {
    handleSpeedDialContextMenu(event, item);
    return;
  }
  if (item.type === 'board') {
    handleNavContextMenu(event, item, null, 0);
    return;
  }

  contextTarget = { area: 'board-item', itemId: item.id, columnId: meta.columnId || null, parentId: null, boardId: meta.boardId, item, depth: 1 };

  const options = [];
  if (item.type === 'bookmark') {
    if (item.url) {
      options.push({ label: 'Open in new tab',    action: 'openNewTab' });
      options.push({ label: 'Open in new window', action: 'openNewWindow' });
    }
    options.push({ label: 'Edit bookmark',   action: 'editBookmark' });
    options.push({ label: 'Duplicate',        action: 'duplicateBookmark' });
    options.push({ label: 'Refresh favicon',  action: 'refreshFavicon' });
    const allBoards = state.boards.filter(b => !b.isImportManager && !b.locked && b.id !== meta.boardId);
    if (allBoards.length) {
      options.push({ label: 'Move to board', submenu: allBoards.map(b => ({ label: b.title, action: `moveToBoard:${b.id}` })) });
    }
    options.push({ label: 'Show in board',   action: `openInBoard:${meta.boardId}` });
    options.push({ label: 'Delete bookmark', action: 'deleteItem' });
  } else if (item.type === 'folder') {
    options.push({ label: 'Edit folder',     action: 'editFolder' });
    options.push({ label: 'Show in board',   action: `openInBoard:${meta.boardId}` });
    options.push({ label: 'Delete folder',   action: 'deleteItem' });
  }
  showContextMenu(event.clientX, event.clientY, options);
}

function handleNavListContextMenu(event) {
  event.preventDefault();
  contextTarget = { area: 'nav-empty' };
  const widgetSubmenu = Object.entries(WIDGET_REGISTRY)
    .filter(([, def]) => def.allowedIn.includes('navpane'))
    .map(([type, def]) => ({ label: def.name, action: `addNavWidget:${type}` }));
  const items = [
    { label: 'Add board', action: 'addBoard' },
    { label: 'Add collection', action: 'addCollection' },
    { label: 'Add folder', action: 'addNavFolder' },
    { label: 'Add title', action: 'addNavTitle' },
    { label: 'Add divider', action: 'addNavDivider' }
  ];
  if (widgetSubmenu.length) items.push({ label: 'Add widget', submenu: widgetSubmenu });
  showContextMenu(event.clientX, event.clientY, items);
}
