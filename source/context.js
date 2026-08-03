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
          subBtn.addEventListener('click', () => {
            try { handleContextMenuAction(subAction.action); }
            catch (err) { console.error('[context menu]', err); showNotice(`Error: ${err.message || err}`); }
            finally { hideContextMenu(); }
          });
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
      button.addEventListener('click', () => {
        try { handleContextMenuAction(action.action); }
        catch (err) { console.error('[context menu]', err); showNotice(`Error: ${err.message || err}`); }
        finally { hideContextMenu(); }
      });
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

function _sortedBoardOptions(boards) {
  return [...boards]
    .sort((a, b) => (a.title || '').localeCompare(b.title || ''))
    .map(board => ({ value: board.id, label: board.title || 'Untitled Board' }));
}

function _sortedInboxTargetOptions(boards, options = {}) {
  const excludeBoardId = options.excludeBoardId || null;
  const excludeTabId = options.excludeTabId || null;
  return [...boards]
    .sort((a, b) => (a.title || '').localeCompare(b.title || ''))
    .flatMap(board => (board.tabs || [])
      .filter(tab => !(board.id === excludeBoardId && tab.id === excludeTabId))
      .map(tab => ({
        value: `${board.id}::${tab.id}`,
        label: `${board.title || 'Untitled Board'} / ${tab.title || 'Untitled Tab'}`
      })));
}

function _buildAddToSetSubmenu() {
  const sets = [...(state.sets || [])]
    .filter(set => !isDynamicSet(set))
    .sort((a, b) => (a.title || '').localeCompare(b.title || ''))
    .map(set => ({ label: set.title || 'Untitled Set', action: `addBookmarkToSet:${set.id}` }));
  sets.push({ label: 'New set from this bookmark', action: 'createSetFromBookmark' });
  return sets;
}

function _findNavItem(id, items) {
  for (const item of (items || state.navItems)) {
    if (item.id === id) return item;
    if (item.children) { const r = _findNavItem(id, item.children); if (r) return r; }
  }
  return null;
}

function _openBoardMetaEditor(board) {
  if (!board) return;
  state.activeBoardId = board.id;
  state.activeTabId = board.tabs?.[0]?.id || state.activeTabId;
  renderAll();
  saveState();
  showBoardMetaModal('edit', board);
}

function _unlockBoardById(boardId) {
  const board = state.boards.find(b => b.id === boardId);
  if (!board) return;
  board.locked = false;
  renderAll();
  saveState();
}

function _renderContextScope(scope = 'all') {
  if (scope === 'nav') renderNav();
  else if (scope === 'essentials') renderEssentials();
  else if (scope === 'import-manager') renderImportManagerPanel();
  else renderAll();
}

function _mutateAndRefresh(mutator, options = {}) {
  const { undo = true, render = 'all', save = true, updateTrash = false } = options;
  if (undo) pushUndoSnapshot();
  const result = mutator ? mutator() : undefined;
  if (result === false) return false;
  _renderContextScope(render);
  if (save) saveState();
  if (updateTrash) updateTrashBadge();
  return true;
}

function _showAddBookmarkModal(context = contextTarget, overrides = {}) {
  showModal('addBookmark', {
    title: 'New Bookmark',
    placeholder1: 'New Bookmark',
    showUrl: true,
    placeholder2: 'Bookmark URL',
    showTags: true,
    contextTarget: context,
    inheritedTags: overrides.inheritedTags ?? getContextInheritedTags(context),
    ...overrides
  });
}

function _showEditBookmarkModal(context = contextTarget, overrides = {}) {
  showModal('editBookmark', {
    title: 'Edit Bookmark',
    placeholder1: 'Bookmark title',
    value1: context?.item?.title || '',
    showUrl: true,
    placeholder2: 'Bookmark URL',
    value2: context?.item?.url || '',
    showTags: true,
    value3: (context?.item?.tags || []).join(' '),
    inheritedTags: overrides.inheritedTags ?? (context?.area === 'set-item' ? [] : getContextInheritedTags(context)),
    ...overrides
  });
}

function _showMoveToBoardModal(context = contextTarget, title = 'Move to Tab Inbox') {
  const boards = state.boards.filter(b => !b.locked);
  const selectOptions = _sortedInboxTargetOptions(boards);
  if (!selectOptions.length) return false;
  showModal('moveToBoard', {
    title,
    showName: false,
    showBoardTabSelect: true,
    selectLabel: 'Target board',
    selectSecondaryLabel: 'Target tab inbox',
    contextTarget: context
  });
  return true;
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
        state.activeTabId = state.boards.find(b => b.id === boardId)?.tabs?.[0]?.id || state.activeTabId;
        renderAll();
        saveState();
        showBoardMetaModal('edit', state.boards.find(b => b.id === boardId) || null);
      }
      break;
    }
    case 'addBoardTab': {
      const board = state.boards.find(b => b.id === contextTarget.boardId) || getActiveBoardContainer();
      if (!board || board.locked) break;
      pushUndoSnapshot();
      createBoardTab(board, 'New Tab');
      renderAll();
      saveState();
      showBoardSettingsPanel(true);
      break;
    }
    case 'editBoardTab': {
      const board = state.boards.find(b => b.id === contextTarget.boardId) || getActiveBoardContainer();
      const tab = findBoardTabById(board, contextTarget.tabId);
      if (!tab || board?.locked) break;
      state.activeBoardId = board.id;
      state.activeTabId = tab.id;
      renderAll();
      saveState();
      showBoardSettingsPanel();
      break;
    }
    case 'deleteBoardTab': {
      const board = state.boards.find(b => b.id === contextTarget.boardId) || getActiveBoardContainer();
      const tab = findBoardTabById(board, contextTarget.tabId);
      if (!board || !tab || board.locked) break;
      confirmDelete('confirmDeleteTab', `Delete tab "${tab.title}" and all its content?`, () => {
        pushUndoSnapshot();
        if (!removeBoardTab(board, tab.id)) return;
        renderAll();
        saveState();
      });
      break;
    }
    case 'openSet':
      openSetById(contextTarget.setId || contextTarget.item?.id);
      break;
    case 'editSet':
      if (contextTarget.setId || contextTarget.item?.id) showSetManagerForSet(contextTarget.setId || contextTarget.item.id, { focusTitle: true });
      break;
    case 'removeSetFromTabBar': {
      const board = state.boards.find(b => b.id === contextTarget.boardId) || getActiveBoardContainer();
      const tab = findBoardTabById(board, contextTarget.tabId);
      if (!tab || !contextTarget.setId || board?.locked) break;
      pushUndoSnapshot();
      tab.setBar = (tab.setBar || []).filter(id => id !== contextTarget.setId);
      syncBoardCompatibilityFields(board, tab.id);
      renderAll();
      saveState();
      break;
    }
    case 'editSpeedDial':
    case 'editBookmark':
      _showEditBookmarkModal(contextTarget);
      break;
    case 'addSetBookmark':
      if (isDynamicSet(findSetById(contextTarget.setId))) {
        showNotice('Dynamic sets update from rules and cannot be edited manually.');
        break;
      }
      _showAddBookmarkModal(
        { area: 'set', setId: contextTarget.setId, item: contextTarget.item || findSetById(contextTarget.setId) },
        { title: 'Add Bookmark to Set', placeholder1: 'Bookmark title' }
      );
      break;
    case 'deleteItem': {
      const type = contextTarget.item?.type;
      const key = type === 'folder' ? 'confirmDeleteFolder' : type === 'bookmark' ? 'confirmDeleteBookmark' : 'confirmDeleteTitleDivider';
      const name = contextTarget.item?.title;
      const label = type === 'folder'
        ? `Delete folder "${name}" and all its contents?`
        : name ? `Delete "${name}"?` : 'Delete this item?';
      const captured = { ...contextTarget };
      const capturedItem = cloneData(contextTarget.item);
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
      const capturedNavItem = cloneData(contextTarget.item);
      const capturedNavParentId = contextTarget.parentId || null;
      const capturedNavBoardId = navBoardId;
      const capturedNavItemId = contextTarget.itemId;
      confirmDelete(navKey, navLabel, () => {
        pushUndoSnapshot();
        if (isNavBoard) {
          const fullBoard = state.boards.find(b => b.id === capturedNavBoardId);
          pushToTrash({ navItem: capturedNavItem, board: fullBoard ? cloneData(fullBoard) : null }, { area: 'nav-board', parentId: capturedNavParentId });
          deleteBoardAndNavItem(capturedNavItemId, capturedNavBoardId);
        } else {
          pushToTrash(capturedNavItem, { area: 'nav-item', parentId: capturedNavParentId });
          removeNavItemById(capturedNavItemId);
        }
        saveState();
        updateTrashBadge();
        try { renderAll(); } catch (err) {
          console.error('[deleteNavItem] renderAll failed:', err);
          try { renderNav(); } catch (_) {}
        }
      });
      break;
    }
    case 'deleteSet': {
      const set = findSetById(contextTarget.setId || contextTarget.item?.id);
      if (!set) break;
      confirmDelete('confirmDeleteSet', `Delete set "${set.title}"?`, () => {
        pushUndoSnapshot();
        pushToTrash(set, { area: 'set' });
        deleteSetById(set.id);
        if (selectedSetId === set.id) selectedSetId = null;
        renderAll();
        saveState();
      });
      break;
    }
    case 'deleteSetItem': {
      const set = findSetById(contextTarget.setId);
      if (isDynamicSet(set)) {
        showNotice('Dynamic sets update from rules and cannot be edited manually.');
        break;
      }
      const setItem = set?.items?.find(item => item.id === contextTarget.itemId);
      if (!set || !setItem) break;
      showConfirmDialog(`Remove "${setItem.title}" from this set?`, () => {
        pushUndoSnapshot();
        removeSetItemById(set, setItem.id);
        renderAll();
        saveState();
      }, 'Remove');
      break;
    }
    case 'sendImportToInbox': {
      _showMoveToBoardModal(contextTarget, 'Send to Tab Inbox');
      break;
    }
    case 'sendImportToActiveTab': {
      const board = getActiveBoard();
      const tab = getActiveTab();
      const targetInbox = getBoardInbox(board, tab);
      if (!board || !tab || board.locked || !targetInbox) {
        showNotice('No unlocked active tab inbox is available.');
        break;
      }
      pushUndoSnapshot();
      const removed = removeImportManagerItemById(contextTarget.itemId);
      if (!removed) break;
      if (!removed.tags) removed.tags = [];
      stripTransientItemLocks([removed]);
      targetInbox.items.push(removed);
      renderAll();
      saveState();
      break;
    }
    case 'deleteImportItem': {
      const item = findImportManagerItemById(contextTarget.itemId)?.item || contextTarget.item;
      if (!item) break;
      const label = item.type === 'folder'
        ? `Delete folder "${item.title}" and all imported contents?`
        : `Delete "${item.title || item.url || 'bookmark'}" from Import Manager?`;
      showConfirmDialog(label, () => {
        pushUndoSnapshot();
        removeImportManagerItemById(item.id);
        renderImportManagerPanel();
        saveState();
      }, 'Delete');
      break;
    }
    case 'openAllImports':
      if (contextTarget.item?.type === 'folder') _openImportFolder(contextTarget.item);
      break;
    case 'addBoard':
    case 'addCollection':
      showBoardMetaModal('create');
      break;
    case 'editCollection': {
      const board = contextTarget.item?.boardId
        ? state.boards.find(b => b.id === contextTarget.item.boardId)
        : (contextTarget.item?.id ? state.boards.find(b => b.id === contextTarget.item.id) : getActiveBoardContainer());
      _openBoardMetaEditor(board);
      break;
    }
    case 'editBoardFromTab': {
      const board = state.boards.find(b => b.id === contextTarget.boardId);
      _openBoardMetaEditor(board);
      break;
    }
    case 'editBoardFromFolderTab': {
      const board = state.boards.find(b => b.id === contextTarget.boardId);
      _openBoardMetaEditor(board);
      break;
    }
    case 'unlockBoardFromTab':
    case 'unlockBoardFromFolderTab': {
      _unlockBoardById(contextTarget.boardId);
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
      const navItemId = contextTarget.navItemId;
      const boardId = contextTarget.boardId;
      const folderId = contextTarget.folderId;
      const navItem = (folderItem2.children || []).find(c => c.id === navItemId);
      confirmDelete('confirmDeleteBoard', `Delete board "${board2.title}" and all its content?`, () => {
        pushUndoSnapshot();
        pushToTrash({ navItem: navItem ? cloneData(navItem) : null, board: cloneData(board2) }, { area: 'folder-board', folderId });
        folderItem2.children = (folderItem2.children || []).filter(c => c.id !== navItemId);
        state.boards = state.boards.filter(b => b.id !== boardId);
        if (state.activeBoardId === boardId) {
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
      const board = createBoardInFolder(folderForAdd, 'New Board');
      if (board) createBoardTab(board, 'New Tab');
      renderAll();
      saveState();
      if (board) showBoardSettingsPanel(true);
      break;
    }
    case 'addNavFolder':
      showFolderModal('create');
      break;
    case 'addNavTitle':
      showModal('addTitle', { title: 'New Title', placeholder1: 'New Title' });
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
    case 'addDynamicFolder':
      if (contextTarget?.area === 'nav-empty' || contextTarget?.area === 'nav-item' || contextTarget?.area === 'nav-subfolder') {
        showNotice('Dynamic folders are only available in board columns.');
        break;
      }
      if (contextTarget?.area === 'board-item') {
        if (!canInsertIntoFolder(contextTarget.item, 'folder')) {
          showNotice('Dynamic folders cannot contain subfolders.');
          break;
        }
        showFolderModal('create', { ...contextTarget, area: 'board-subfolder' }, { folderMode: 'dynamic' });
      } else {
        showFolderModal('create', contextTarget, { folderMode: 'dynamic' });
      }
      break;
    case 'addBookmark':
      _showAddBookmarkModal(contextTarget);
      break;
    case 'addTitle':
      showModal('addTitle', { title: 'New Title', placeholder1: 'New Title', contextTarget });
      break;
    case 'addDivider':
      pushUndoSnapshot();
      addBookmarkItem('title', '', contextTarget.columnId);
      renderAll();
      saveState();
      break;
    case 'addTitleToFolder':
      showModal('addTitle', {
        title: 'New Folder Title',
        placeholder1: 'New Title',
        contextTarget: { ...contextTarget, area: 'board-folder-item' }
      });
      break;
    case 'addDividerToFolder':
      if (isDynamicFolder(contextTarget.item)) break;
      pushUndoSnapshot();
      contextTarget.item.children = contextTarget.item.children || [];
      contextTarget.item.children.push({ id: `id-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, type: 'title', title: '' });
      contextTarget.item.collapsed = false;
      renderAll();
      saveState();
      break;
    case 'deleteSpeedDial': {
      const sdItem = contextTarget.item;
      const sdId = contextTarget.itemId;
      const capturedSdItem = cloneData(sdItem);
      const capturedSdBoardId = getActiveBoard()?.id;
      confirmDelete('confirmDeleteBookmark', `Delete "${sdItem?.title}"?`, () => {
        pushUndoSnapshot();
        pushToTrash(capturedSdItem, { area: 'speed-dial', boardId: capturedSdBoardId, slot: contextTarget.slot });
        const board = getActiveBoard();
        removeSpeedDialItemById(board, sdId);
        renderAll();
        saveState();
        updateTrashBadge();
      });
      break;
    }
    case 'addBoardSubfolder':
      if (!canInsertIntoFolder(contextTarget.item, 'folder')) {
        showNotice('Dynamic folders cannot contain subfolders.');
        break;
      }
      showFolderModal('create', { ...contextTarget, area: 'board-subfolder' });
      break;
    case 'addBookmarkToFolder': {
      if (isDynamicFolder(contextTarget.item)) {
        showNotice('Dynamic folders update from rules and cannot be edited manually.');
        break;
      }
      const folderCtx = { ...contextTarget, area: 'board-folder-item' };
      _showAddBookmarkModal(folderCtx, {
        inheritedTags: getContextInheritedTags({ ...contextTarget, area: 'board-subfolder' })
      });
      break;
    }
    case 'addNavSubfolder':
      contextTarget = { ...contextTarget, area: 'nav-subfolder' };
      showFolderModal('create');
      break;
    case 'addEssential':
      _showAddBookmarkModal(contextTarget);
      break;
    case 'editEssential':
      _showEditBookmarkModal(contextTarget, { inheritedTags: getContextInheritedTags(contextTarget) });
      break;
    case 'openAll': {
      const collectUrls = (items) => {
        const urls = [];
        for (const item of (items || [])) {
          if (item.type === 'bookmark' && item.url) urls.push(item.url);
          if (item.type === 'folder') {
            urls.push(...collectUrls(resolveFolderChildren(item, getBoardForContext(contextTarget))));
          }
        }
        return urls;
      };
      collectUrls(resolveFolderChildren(contextTarget.item, getBoardForContext(contextTarget))).forEach(url => window.open(url, '_blank', 'noreferrer noopener'));
      break;
    }
    case 'refreshFavicon': {
      const area = contextTarget.area;
      if (area === 'speed-dial-item') {
        const board = getActiveBoard();
        const sdItem = board?.speedDial.find(i => i?.id === contextTarget.itemId);
        if (sdItem) {
          sdItem.faviconCache = '';
          if (typeof requestNativeFaviconRefresh === 'function') requestNativeFaviconRefresh(sdItem);
          renderAll();
          saveState();
        }
      } else if (area === 'essential') {
        const essItem = state.essentials[contextTarget.slot];
        if (essItem) {
          essItem.faviconCache = '';
          if (typeof requestNativeFaviconRefresh === 'function') requestNativeFaviconRefresh(essItem);
          renderEssentials();
          saveState();
        }
      } else {
        const found = findBoardItemInColumns(getBoardForContext(contextTarget), contextTarget.itemId);
        if (found?.item) {
          found.item.faviconCache = '';
          if (typeof requestNativeFaviconRefresh === 'function') requestNativeFaviconRefresh(found.item);
          renderAll();
          saveState();
        }
      }
      break;
    }
    case 'duplicateBookmark': {
      if (contextTarget?.inDynamicFolder) {
        showNotice('Duplicate bookmarks from their source location, not from a dynamic folder view.');
        break;
      }
      const area = contextTarget.area;
      if (area === 'speed-dial-item') {
        const board = getActiveBoard();
        const sdIdx = findSpeedDialSlot(board, contextTarget.itemId);
        if (sdIdx !== -1) {
          pushUndoSnapshot();
          const copy = { ...board.speedDial[sdIdx], id: `bm-${Date.now()}`, title: board.speedDial[sdIdx].title + ' (copy)', faviconCache: '' };
          const slot = firstEmptySpeedDialSlot(board);
          if (slot === -1 || !setSpeedDialSlot(board, slot, copy)) alert('No empty speed dial slot available.');
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
      _showMoveToBoardModal(contextTarget);
      break;
    }
    case 'deleteEssential': {
      const essSlot = contextTarget.slot;
      const essName = contextTarget.item?.title;
      const capturedEssItem = cloneData(contextTarget.item);
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
      _showAddBookmarkModal(contextTarget, { title: 'Add Speed Dial Bookmark' });
      break;
    case 'editFolder':
      showFolderModal('edit', contextTarget);
      break;
    case 'editWidget':
      openWidgetSettings(contextTarget.item, () => { renderAll(); saveState(); });
      break;
    case 'lockItem':
      if (contextTarget.item) {
        _mutateAndRefresh(() => { contextTarget.item.locked = true; });
      }
      break;
    case 'unlockItem':
      if (contextTarget.item) {
        _mutateAndRefresh(() => { contextTarget.item.locked = false; });
      }
      break;
    case 'lockBoard': {
      const lb = state.boards.find(b => b.id === contextTarget.item?.boardId);
      if (lb) _mutateAndRefresh(() => { lb.locked = true; });
      break;
    }
    case 'unlockBoard': {
      const ub = state.boards.find(b => b.id === contextTarget.item?.boardId);
      if (ub) _mutateAndRefresh(() => { ub.locked = false; });
      break;
    }
    default:
      if (action.startsWith('addWidget:')) {
        const type = action.slice('addWidget:'.length);
        const widget = _newWidgetState(type);
        const columnId = contextTarget.columnId;
        openWidgetSettings(widget, null, {
          isNew: true,
          deferUndo: true,
          onDone: () => {
            pushUndoSnapshot();
            const board = getActiveBoard();
            const col = board?.columns.find(c => c.id === columnId);
            if (col) col.items.push(widget);
            renderAll();
          }
        });
      } else if (action.startsWith('addNavWidget:')) {
        const type = action.slice('addNavWidget:'.length);
        const widget = _newWidgetState(type);
        openWidgetSettings(widget, null, {
          isNew: true,
          deferUndo: true,
          onDone: () => {
            pushUndoSnapshot();
            state.navItems.push(widget);
            renderNav();
          }
        });
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
        const targetValue = action.slice('moveToBoard:'.length);
        const [targetBoardId, targetTabId] = targetValue.split('::');
        const targetBoard = state.boards.find(b => b.id === targetBoardId);
        const targetTab = targetBoard ? findBoardTabById(targetBoard, targetTabId) : null;
        const targetInbox = targetBoard && targetTab ? getBoardInbox(targetBoard, targetTab) : null;
        if (targetBoard && targetTab && targetInbox && !targetBoard.locked && contextTarget?.item) {
          pushUndoSnapshot();
          const capturedItem = cloneData(contextTarget.item);
          if (!capturedItem.tags) capturedItem.tags = [];
          if (contextTarget?.inDynamicFolder && capturedItem.type === 'bookmark') {
            capturedItem.id = `bm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          } else {
            deleteBoardTarget(contextTarget);
          }
          stripTransientItemLocks([capturedItem]);
          targetInbox.items.push(capturedItem);
          renderAll();
          saveState();
        }
      } else if (action.startsWith('addBookmarkToSet:')) {
        const setId = action.slice('addBookmarkToSet:'.length);
        const set = findSetById(setId);
        if (!set || !contextTarget?.item?.url) return;
        pushUndoSnapshot();
        const result = addBookmarkToSet(set, contextTarget.item);
        if (!result.ok) {
          showNotice(result.reason === 'duplicate'
            ? `That URL is already in the set "${set.title}".`
            : result.reason === 'dynamic'
              ? 'Dynamic sets update from rules and cannot be edited manually.'
              : 'Unable to add this bookmark to the selected set.');
          return;
        }
        renderAll();
        saveState();
      } else if (action.startsWith('addSetToTabBar:')) {
        const setId = action.slice('addSetToTabBar:'.length);
        const board = state.boards.find(b => b.id === contextTarget.boardId) || getActiveBoardContainer();
        const tab = findBoardTabById(board, contextTarget.tabId || state.activeTabId);
        const set = findSetById(setId);
        if (!board || !tab || !set) return;
        if ((tab.setBar || []).includes(setId)) return;
        pushUndoSnapshot();
        if (!Array.isArray(tab.setBar)) tab.setBar = [];
        tab.setBar.push(setId);
        syncBoardCompatibilityFields(board, tab.id);
        renderAll();
        saveState();
      } else if (action === 'createSetFromBookmark') {
        if (!contextTarget?.item?.url) return;
        pushUndoSnapshot();
        const set = createSet(contextTarget.item.title || 'New Set');
        addBookmarkToSet(set, contextTarget.item);
        selectedSetId = set.id;
        renderAll();
        saveState();
        showSetManagerForSet(set.id, { focusTitle: true });
      }
      break;
  }
}

function handleBoardContextMenu(event, item, columnId, parentFolder, depth, effectiveLocked = false, inheritedLock = false) {
  if (getActiveBoard()?.locked) return;
  const inDynamicFolder = item.type === 'bookmark' && isDynamicFolder(parentFolder);
  contextTarget = { area: 'board-item', itemId: item.id, columnId, parentId: parentFolder ? parentFolder.id : null, item, depth, inDynamicFolder };

  const options = [];

  if (effectiveLocked) {
    if (!inheritedLock) {
      options.push({ label: 'Unlock item', action: 'unlockItem' });
    }
    showContextMenu(event.clientX, event.clientY, options);
    return;
  }

  const activeBoard = getActiveBoard();
  const regularBoards = state.boards.filter(b => !b.locked);
  const canMoveToBoard = regularBoards.some(board => (board.tabs || []).length > 0);

  if (item.type === 'folder') {
    if (isDynamicFolder(item)) {
      options.push({ label: 'Edit Dynamic Folder', action: 'editFolder' });
      options.push({ label: 'Open All', action: 'openAll' });
      if (canMoveToBoard) options.push({ label: 'Move to tab inbox', action: 'moveToBoard' });
      options.push({ label: 'Delete', action: 'deleteItem' });
    } else {
      options.push({ label: 'Edit folder', action: 'editFolder' });
      options.push({ label: 'Add bookmark', action: 'addBookmarkToFolder' });
      options.push({ label: 'Add title', action: 'addTitleToFolder' });
      options.push({ label: 'Add divider', action: 'addDividerToFolder' });
      if (canInsertIntoFolder(item, 'folder')) options.push({ label: 'Add dynamic folder', action: 'addDynamicFolder' });
      options.push({ label: 'Open all', action: 'openAll' });
      if (depth < 2 && canInsertIntoFolder(item, 'folder')) options.push({ label: 'Create subfolder', action: 'addBoardSubfolder' });
      if (canMoveToBoard) options.push({ label: 'Move to tab inbox', action: 'moveToBoard' });
      options.push({ label: 'Delete folder', action: 'deleteItem' });
    }
  } else if (item.type === 'bookmark') {
    options.push({ label: 'Edit bookmark', action: 'editBookmark' });
    options.push({ label: 'Add to Set...', action: '', submenu: _buildAddToSetSubmenu() });
    if (!inDynamicFolder) options.push({ label: 'Duplicate', action: 'duplicateBookmark' });
    options.push({ label: 'Refresh favicon', action: 'refreshFavicon' });
    if (canMoveToBoard) options.push({ label: 'Move to tab inbox', action: 'moveToBoard' });
    options.push({ label: 'Delete bookmark', action: 'deleteItem' });
  } else if (item.type === 'title') {
    options.push({ label: 'Rename', action: 'renameItem' });
    options.push({ label: 'Delete', action: 'deleteItem' });
  }

  if (!isInboxColumnId(columnId) && (item.type === 'folder' || item.type === 'bookmark')) {
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
  } else if (item.type === 'widget') {
    options.push({ label: 'Widget settings', action: 'editWidget' });
    options.push({ label: 'Delete widget', action: 'deleteNavItem' });
  }

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

function handleEssentialContextMenu(event, slot, item) {
  contextTarget = { area: 'essential', slot, item };
  const options = item
    ? [
        { label: 'Edit bookmark',    action: 'editEssential' },
        { label: 'Add to Set...',    action: '', submenu: _buildAddToSetSubmenu() },
        { label: 'Duplicate',        action: 'duplicateBookmark' },
        { label: 'Refresh favicon',  action: 'refreshFavicon' },
        { label: 'Move to tab inbox', action: 'moveToBoard' },
        { label: 'Delete bookmark',  action: 'deleteEssential' }
      ]
    : [{ label: 'Add bookmark', action: 'addEssential' }];
  showContextMenu(event.clientX, event.clientY, options);
}

function handleSpeedDialContextMenu(event, item, slot = findSpeedDialSlot(getActiveBoard(), item.id)) {
  if (getActiveBoard()?.locked) return;
  contextTarget = { area: 'speed-dial-item', itemId: item.id, slot, item };
  const boards = state.boards.filter(b => !b.locked);
  const canMove = boards.some(board => (board.tabs || []).length > 0);
  const options = [
    { label: 'Edit bookmark',   action: 'editSpeedDial' },
    { label: 'Add to Set...',   action: '', submenu: _buildAddToSetSubmenu() },
    { label: 'Duplicate',       action: 'duplicateBookmark' },
    { label: 'Refresh favicon', action: 'refreshFavicon' },
  ];
  if (canMove) options.push({ label: 'Move to tab inbox', action: 'moveToBoard' });
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
    { label: 'Add dynamic folder', action: 'addDynamicFolder' },
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
  if (meta.area === 'set') {
    const set = findSetById(meta.setId || item.id);
    contextTarget = { area: 'set', setId: meta.setId || item.id, item: set || item };
      showContextMenu(event.clientX, event.clientY, [
        { label: 'Open set', action: 'openSet' },
        { label: 'Manage set', action: 'editSet' },
        { label: 'Delete set', action: 'deleteSet' }
      ]);
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
    options.push({ label: 'Add to Set...',   action: '', submenu: _buildAddToSetSubmenu() });
    options.push({ label: 'Duplicate',        action: 'duplicateBookmark' });
    options.push({ label: 'Refresh favicon',  action: 'refreshFavicon' });
    const allBoards = state.boards.filter(b => !b.locked);
    if (allBoards.length) {
      options.push({ label: 'Move to tab inbox', action: 'moveToBoard' });
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
    { label: 'Add folder', action: 'addNavFolder' },
    { label: 'Add title', action: 'addNavTitle' },
    { label: 'Add divider', action: 'addNavDivider' }
  ];
  if (widgetSubmenu.length) items.push({ label: 'Add widget', submenu: widgetSubmenu });
  showContextMenu(event.clientX, event.clientY, items);
}
