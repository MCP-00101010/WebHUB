// --- Inbox panel ---

const INBOX_POS_KEY = 'morpheus-inbox-pos';
const IMPORT_MANAGER_POS_KEY = 'morpheus-import-manager-pos';

let inboxPanelOpen = false;
let importManagerPanelOpen = false;

function saveInboxPos() {
  const panel = document.getElementById('inboxPanel');
  if (!panel) return;
  const rect = panel.getBoundingClientRect();
  localStorage.setItem(INBOX_POS_KEY, JSON.stringify({ x: rect.left, y: rect.top }));
}

function showInboxPanel() {
  inboxPanelOpen = true;
  const panel = document.getElementById('inboxPanel');
  panel.classList.remove('hidden');
  panel.classList.add('draggable');
  try {
    const pos = JSON.parse(localStorage.getItem(INBOX_POS_KEY));
    if (pos) { panel.style.left = pos.x + 'px'; panel.style.top = pos.y + 'px'; }
    else centerPanel(panel);
  } catch { centerPanel(panel); }
  makeDraggable(panel, document.getElementById('inboxPanelHeader'), saveInboxPos);
  renderInboxPanel();
}

function hideInboxPanel() {
  inboxPanelOpen = false;
  document.getElementById('inboxPanel').classList.add('hidden');
}

function _saveImportManagerPos() {
  const panel = document.getElementById('importManagerPanel');
  if (!panel) return;
  const rect = panel.getBoundingClientRect();
  localStorage.setItem(IMPORT_MANAGER_POS_KEY, JSON.stringify({ x: rect.left, y: rect.top }));
}

function _restoreImportManagerPos(panel) {
  try {
    const pos = JSON.parse(localStorage.getItem(IMPORT_MANAGER_POS_KEY));
    if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
      panel.style.left = `${pos.x}px`;
      panel.style.top = `${pos.y}px`;
      return true;
    }
  } catch {}
  return false;
}

function updateImportManagerBadge() {
  const badge = document.getElementById('quickImportManagerBadge');
  if (!badge) return;
  const { bookmarks, folders } = getImportManagerCounts();
  const count = bookmarks + folders;
  badge.textContent = count > 99 ? '99+' : `${count}`;
  badge.classList.toggle('hidden', count === 0);
}

function _pruneImportManagerSelection() {
  if (selectionContext !== 'import-manager' || !selectedItemIds?.size) return;
  const liveIds = new Set();
  const walk = items => {
    for (const item of (items || [])) {
      if (!item?.id) continue;
      liveIds.add(item.id);
      if (item.type === 'folder' && Array.isArray(item.children)) walk(item.children);
    }
  };
  walk(state.importManager?.items || []);
  let changed = false;
  for (const itemId of [...selectedItemIds]) {
    if (!liveIds.has(itemId)) {
      selectedItemIds.delete(itemId);
      changed = true;
    }
  }
  if (selectedItemIds.size === 0) selectionContext = null;
  if (changed) updateBulkToolbar();
}

function showImportManagerPanel() {
  if (selectedItemIds?.size && selectionContext !== 'import-manager') clearSelection();
  importManagerPanelOpen = true;
  const panel = document.getElementById('importManagerPanel');
  if (!panel) return;
  panel.classList.remove('hidden');
  panel.classList.add('draggable');
  if (!_restoreImportManagerPos(panel)) centerPanel(panel);
  makeDraggable(panel, document.getElementById('importManagerHeader'), _saveImportManagerPos);
  renderImportManagerPanel();
}

function hideImportManagerPanel() {
  if (selectionContext === 'import-manager') clearSelection();
  importManagerPanelOpen = false;
  document.getElementById('importManagerPanel')?.classList.add('hidden');
}

function _collectImportUrls(items) {
  const urls = [];
  for (const item of (items || [])) {
    if (item?.type === 'bookmark' && item.url) urls.push(item.url);
    if (item?.children) urls.push(..._collectImportUrls(item.children));
  }
  return urls;
}

function _openImportFolder(item) {
  _collectImportUrls([item]).forEach(url => window.open(url, '_blank', 'noreferrer noopener'));
}

function _createImportManagerItem(item, depth = 0, parentFolder = null) {
  const itemEl = document.createElement('div');
  itemEl.className = 'board-column-item import-manager-item';
  itemEl.dataset.itemId = item.id;
  itemEl.style.marginLeft = `${depth * 16}px`;
  if (selectedItemIds?.has(item.id)) itemEl.classList.add('selected');

  if (item.type === 'folder') {
    itemEl.classList.add('folder-card');
    const header = document.createElement('div');
    header.className = 'item-header';

    const checkbox = document.createElement('div');
    checkbox.className = 'item-checkbox';
    checkbox.addEventListener('click', event => {
      event.stopPropagation();
      event.preventDefault();
      toggleItemSelection(item.id, itemEl, 'import-manager');
    });
    header.appendChild(checkbox);

    const collapseBtn = document.createElement('button');
    collapseBtn.type = 'button';
    collapseBtn.className = 'collapse-btn';
    collapseBtn.title = item.collapsed ? 'Expand' : 'Collapse';
    collapseBtn.appendChild(icon(item.collapsed ? 'icon-folder-closed' : 'icon-folder-open'));
    collapseBtn.addEventListener('click', event => {
      event.stopPropagation();
      item.collapsed = !item.collapsed;
      saveState();
      renderImportManagerPanel();
    });
    header.appendChild(collapseBtn);

    const name = document.createElement('span');
    name.className = 'folder-title';
    name.textContent = item.title || 'Untitled Folder';
    header.appendChild(name);
    itemEl.appendChild(header);

    itemEl.addEventListener('click', () => {
      item.collapsed = !item.collapsed;
      saveState();
      renderImportManagerPanel();
    });
  } else {
    itemEl.classList.add('bookmark-item');
    const header = document.createElement('div');
    header.className = 'item-header';

    const checkbox = document.createElement('div');
    checkbox.className = 'item-checkbox';
    checkbox.addEventListener('click', event => {
      event.stopPropagation();
      event.preventDefault();
      toggleItemSelection(item.id, itemEl, 'import-manager');
    });
    header.appendChild(checkbox);

    const favicon = document.createElement('span');
    favicon.className = 'bookmark-favicon';
    if (item.url) {
      const faviconImg = document.createElement('img');
      setFavicon(faviconImg, item, 64);
      faviconImg.alt = '';
      faviconImg.draggable = false;
      favicon.appendChild(faviconImg);
    }
    header.appendChild(favicon);

    const name = document.createElement('span');
    name.className = 'bookmark-label';
    name.textContent = item.title || item.url || 'Untitled Bookmark';
    header.appendChild(name);
    itemEl.appendChild(header);

    if (item.url) {
      const url = document.createElement('div');
      url.className = 'import-manager-item-url';
      url.textContent = item.url;
      itemEl.appendChild(url);
    }

    itemEl.addEventListener('click', () => {
      if (item.url) window.open(item.url, '_blank', 'noreferrer noopener');
    });
  }

  itemEl.addEventListener('contextmenu', event => {
    event.preventDefault();
    event.stopPropagation();
    contextTarget = { area: 'import-manager-item', itemId: item.id, item, parentId: parentFolder?.id || null };
    if (item.type === 'folder') {
      showContextMenu(event.clientX, event.clientY, [
        { label: 'Send to tab inbox…', action: 'sendImportToInbox' },
        { label: 'Open all', action: 'openAllImports' },
        { label: 'Delete folder', action: 'deleteImportItem' }
      ]);
    } else {
      showContextMenu(event.clientX, event.clientY, [
        { label: 'Open in new tab', action: 'openNewTab' },
        { label: 'Send to tab inbox…', action: 'sendImportToInbox' },
        { label: 'Delete bookmark', action: 'deleteImportItem' }
      ]);
    }
  });

  return itemEl;
}

function _renderImportItems(listEl, items, depth = 0, parentFolder = null) {
  for (const item of (items || [])) {
    const itemEl = _createImportManagerItem(item, depth, parentFolder);
    listEl.appendChild(itemEl);
    if (item.type === 'folder' && !item.collapsed && Array.isArray(item.children) && item.children.length) {
      _renderImportItems(listEl, item.children, depth + 1, item);
    }
  }
}

function renderImportManagerPanel() {
  const listEl = document.getElementById('importManagerList');
  const emptyEl = document.getElementById('importManagerEmpty');
  const statusEl = document.getElementById('importManagerStatus');
  const bmEl = document.getElementById('importManagerBmCount');
  const folderEl = document.getElementById('importManagerFolderCount');
  const clearBtn = document.getElementById('importManagerClearBtn');
  if (!listEl || !emptyEl || !statusEl || !bmEl || !folderEl || !clearBtn) return;

  listEl.innerHTML = '';
  const items = state.importManager?.items || [];
  _pruneImportManagerSelection();
  const { bookmarks, folders } = getImportManagerCounts();
  updateImportManagerBadge();
  bmEl.textContent = `${bookmarks}`;
  folderEl.textContent = `${folders}`;
  bmEl.classList.toggle('hidden', bookmarks === 0);
  folderEl.classList.toggle('hidden', folders === 0);
  clearBtn.disabled = items.length === 0;

  if (!items.length) {
    emptyEl.classList.remove('hidden');
    statusEl.textContent = 'Import a Firefox/Zen bookmarks HTML export to stage it here.';
    return;
  }

  emptyEl.classList.add('hidden');
  statusEl.textContent = `Imported ${bookmarks} bookmark${bookmarks === 1 ? '' : 's'} in ${folders} folder${folders === 1 ? '' : 's'}.`;
  _renderImportItems(listEl, items);
}

function _parseInboxTargetOptions(boards) {
  return [...boards]
    .sort((a, b) => (a.title || '').localeCompare(b.title || ''))
    .flatMap(board => (board.tabs || []).map(tab => ({
      value: `${board.id}::${tab.id}`,
      label: `${board.title || 'Untitled Board'} / ${tab.title || 'Untitled Tab'}`
    })));
}

function attachInboxListeners() {
  document.getElementById('inboxBtn').addEventListener('click', () => {
    if (inboxPanelOpen) hideInboxPanel(); else showInboxPanel();
  });
  document.getElementById('inboxPanelClose').addEventListener('click', hideInboxPanel);

  const body = document.getElementById('inboxPanelBody');
  body.addEventListener('dragover', e => {
    if (!dragPayload || dragPayload.area !== 'board') return;
    if (getActiveBoard()?.locked) return;
    e.preventDefault();
    body.classList.add('drag-over');
  });
  body.addEventListener('dragleave', e => {
    if (!body.contains(e.relatedTarget)) body.classList.remove('drag-over');
  });
  body.addEventListener('drop', e => {
    e.preventDefault();
    body.classList.remove('drag-over');
    if (!dragPayload || dragPayload.area !== 'board') return;
    if (getActiveBoard()?.locked) { dragPayload = null; return; }
    pushUndoSnapshot();
    const inbox = getBoardInbox(getActiveBoard(), getActiveTab());
    if (!inbox) return;
    const dragged = removeBoardItemById(dragPayload.itemId);
    if (dragged) inbox.items.push(dragged);
    dragPayload = null;
    renderInboxPanel();
    renderBoard();
    renderNav();
    saveState();
  });
}

function attachImportManagerListeners() {
  document.getElementById('quickImportManagerBtn')?.addEventListener('click', showImportManagerPanel);
  document.getElementById('importManagerDoneBtn')?.addEventListener('click', hideImportManagerPanel);
  document.getElementById('importManagerClearBtn')?.addEventListener('click', () => {
    if (!importManagerHasItems()) return;
    showConfirmDialog('Clear all imported items from Import Manager?', () => {
      pushUndoSnapshot();
      if (selectionContext === 'import-manager') clearSelection();
      clearImportManager();
      renderImportManagerPanel();
      saveState();
    }, 'Clear');
  });
}

// --- Browser bookmark import ---

function parseBookmarkHtml(htmlText) {
  const doc = new DOMParser().parseFromString(htmlText, 'text/html');
  function parseDL(dl) {
    const items = [];
    if (!dl) return items;
    const children = Array.from(dl.children);
    for (let i = 0; i < children.length; i++) {
      const el = children[i];
      if (el.tagName !== 'DT') continue;
      const a = el.querySelector(':scope > A');
      const h3 = el.querySelector(':scope > H3');
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
        let subDL = el.querySelector(':scope > DL');
        if (!subDL) {
          let j = i + 1;
          while (j < children.length && children[j].tagName !== 'DT' && children[j].tagName !== 'DL') j++;
          if (j < children.length && children[j].tagName === 'DL') { subDL = children[j]; i = j; }
        }
        items.push({
          id: `bm-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          type: 'folder',
          title: h3.textContent.trim(),
          collapsed: true,
          tags: [],
          sharedTags: [],
          inheritTags: true,
          autoRemoveTags: false,
          children: parseDL(subDL)
        });
      }
    }
    return items;
  }
  return parseDL(doc.querySelector('DL'));
}

function attachBookmarkImportListener() {
  const bmImportFile = document.getElementById('importBookmarksFile');
  if (!bmImportFile) return;
  bmImportFile.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const items = parseBookmarkHtml(ev.target.result);
      if (!items.length) { showNotice('No bookmarks found in file.'); return; }
      pushUndoSnapshot();
      if (!state.importManager) state.importManager = { items: [], lastImportedAt: null };
      state.importManager.items.push(...items);
      state.importManager.lastImportedAt = new Date().toISOString();
      renderImportManagerPanel();
      saveState();
      showImportManagerPanel();
      const { bookmarks, folders } = getImportManagerCounts();
      showNotice(`Imported ${bookmarks} bookmarks in ${folders} folders into Import Manager.`);
    };
    reader.readAsText(file);
    bmImportFile.value = '';
  });
}
