const elements = {
  navList: document.getElementById('navList'),
  essentialsGrid: document.getElementById('essentialsGrid'),
  hubNameEl: document.getElementById('hubNameEl'),
  boardTitle: document.getElementById('boardTitle'),
  boardSettingsBtn: document.getElementById('boardSettingsBtn'),
  globalSettingsBtn: document.getElementById('globalSettingsBtn'),
  mainPanel: document.getElementById('mainPanel'),
  bookmarkColumns: document.getElementById('bookmarkColumns'),
  speedDial: document.getElementById('speedDial'),
  modalOverlay: document.getElementById('modalOverlay'),
  modalTitle: document.getElementById('modalTitle'),
  modalForm: document.getElementById('modalForm'),
  modalLabel1: document.getElementById('modalLabel1'),
  modalInput1: document.getElementById('modalInput1'),
  modalInput2: document.getElementById('modalInput2'),
  modalUrlRow: document.getElementById('modalUrlRow'),
  modalTagsRow: document.getElementById('modalTagsRow'),
  modalInput3: document.getElementById('modalInput3'),
  modalSelectRow: document.getElementById('modalSelectRow'),
  modalSelect: document.getElementById('modalSelect'),
  modalCancelBtn: document.getElementById('modalCancelBtn'),
  contextMenu: document.getElementById('contextMenu')
};

function buildTooltip(item) {
  const parts = [item.title || 'Untitled'];
  if (item.url) parts.push(item.url);
  if (item.tags && item.tags.length > 0) parts.push(item.tags.map(t => `#${t}`).join(' '));
  return parts.join('\n');
}

function applySettings() {
  const s = state.settings;
  const r = document.documentElement.style;
  r.setProperty('--board-font-size', `${s.boardFontSize}px`);
  r.setProperty('--bookmark-font-size', `${s.bookmarkFontSize}px`);
  r.setProperty('--folder-font-size', `${s.folderFontSize}px`);
  r.setProperty('--title-font-size', `${s.titleFontSize}px`);
  r.setProperty('--title-line-thickness', `${s.titleLineThickness}px`);
  r.setProperty('--board-title-font-size', `${s.boardTitleFontSize}px`);
  r.setProperty('--tags-display', s.showTags ? 'flex' : 'none');
}

function renderAll() {
  applySettings();
  elements.hubNameEl.textContent = state.hubName || 'Morpheus WebHub';
  document.title = state.hubName || 'Morpheus WebHub';
  renderNav();
  renderEssentials();
  renderBoard();
}

function renderEssentials() {
  elements.essentialsGrid.innerHTML = '';
  state.essentials.forEach((item, slot) => {
    const cell = document.createElement('div');
    cell.className = `essential-slot ${item ? 'filled' : 'empty'}`;
    cell.dataset.slot = slot;

    if (item) {
      const link = document.createElement('a');
      link.href = item.url || '#';
      link.target = '_blank';
      link.rel = 'noreferrer noopener';
      link.draggable = true;
      link.dataset.tooltip = buildTooltip(item);

      if (item.url) {
        const img = document.createElement('img');
        try {
          const { hostname } = new URL(item.url);
          img.src = `https://www.google.com/s2/favicons?domain=${hostname}&sz=64`;
        } catch { img.src = ''; }
        img.alt = item.title || '';
        img.draggable = false;
        link.appendChild(img);
      } else {
        const fallback = document.createElement('span');
        fallback.className = 'essential-slot-fallback';
        fallback.textContent = item.title ? item.title[0].toUpperCase() : '?';
        link.appendChild(fallback);
      }

      link.addEventListener('dragstart', event => {
        event.stopPropagation();
        dragPayload = { area: 'essential', slot, itemId: item.id };
        event.dataTransfer.setData('text/plain', item.id);
        event.dataTransfer.effectAllowed = 'move';
        applyDragImage(event, link);
      });
      link.addEventListener('dragend', () => {
        dragPayload = null;
        removeDragPlaceholders();
        document.querySelectorAll('.essential-slot.drop-target').forEach(el => el.classList.remove('drop-target'));
      });

      cell.appendChild(link);
    }

    cell.addEventListener('contextmenu', event => {
      event.preventDefault();
      event.stopPropagation();
      handleEssentialContextMenu(event, slot, item);
    });

    cell.addEventListener('dragover', event => {
      if (!dragPayload) return;
      if (dragPayload.area === 'essential' && dragPayload.slot === slot) return;
      if (dragPayload.area === 'nav') return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      cell.classList.add('drop-target');
    });
    cell.addEventListener('dragleave', () => cell.classList.remove('drop-target'));
    cell.addEventListener('drop', event => {
      event.preventDefault();
      event.stopPropagation();
      cell.classList.remove('drop-target');
      handleEssentialSlotDrop(slot);
    });

    elements.essentialsGrid.appendChild(cell);
  });
}

function renderNav() {
  elements.navList.innerHTML = '';
  state.navItems.forEach(item => elements.navList.appendChild(createNavItem(item)));
}

function createNavItem(item, depth = 0, parent = null) {
  const el = document.createElement('div');
  el.className = 'nav-item';
  el.dataset.id = item.id;
  el.dataset.type = item.type;
  el.draggable = true;

  if (item.type === 'title') el.classList.add(item.title ? 'nav-title' : 'nav-divider');

  if (item.type === 'folder') {
    el.classList.add('folder-card');

    const header = document.createElement('div');
    header.className = 'folder-header';

    const collapseBtn = document.createElement('button');
    collapseBtn.type = 'button';
    collapseBtn.className = 'collapse-btn';
    collapseBtn.title = item.collapsed ? 'Expand' : 'Collapse';
    collapseBtn.setAttribute('aria-label', item.collapsed ? 'Expand folder' : 'Collapse folder');
    collapseBtn.appendChild(icon(item.collapsed ? 'icon-chevron-right' : 'icon-chevron-down'));
    collapseBtn.addEventListener('click', event => {
      event.stopPropagation();
      item.collapsed = !item.collapsed;
      saveState();
      renderNav();
    });

    const titleDiv = document.createElement('div');
    titleDiv.className = 'folder-title';
    titleDiv.textContent = item.title || 'Untitled Folder';

    header.appendChild(collapseBtn);
    header.appendChild(titleDiv);
    el.appendChild(header);
  } else {
    if (item.type !== 'title' || item.title) {
      const label = document.createElement('div');
      label.textContent = item.title || (item.type === 'board' ? 'Untitled Board' : '');
      el.appendChild(label);
    }
  }

  if (item.type === 'board') {
    el.addEventListener('click', () => {
      if (item.boardId) {
        state.activeBoardId = item.boardId;
        renderAll();
        saveState();
      }
    });
  }

  el.addEventListener('contextmenu', event => {
    event.preventDefault();
    event.stopPropagation();
    handleNavContextMenu(event, item, parent, depth);
  });

  el.addEventListener('dragstart', event => {
    event.stopPropagation();
    dragPayload = { area: 'nav', itemId: item.id, parentId: parent ? parent.id : null };
    event.dataTransfer.setData('text/plain', item.id);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.dropEffect = 'move';
    applyDragImage(event, el);
  });

  el.addEventListener('dragend', () => {
    dragPayload = null;
    removeDragPlaceholders();
    document.querySelectorAll('.nav-item.drop-target, .nav-item.drop-position-before, .nav-item.drop-position-after').forEach(n => {
      n.classList.remove('drop-target', 'drop-position-before', 'drop-position-after');
      n.removeAttribute('data-drop-position');
    });
  });

  el.addEventListener('dragover', event => handleNavItemDragOver(event, item, parent));
  el.addEventListener('dragleave', event => {
    if (el.contains(event.relatedTarget)) return;
    el.classList.remove('drop-target', 'drop-position-before', 'drop-position-after');
    el.removeAttribute('data-drop-position');
  });
  el.addEventListener('drop', event => {
    event.preventDefault();
    event.stopPropagation();
    el.classList.remove('drop-target', 'drop-position-before', 'drop-position-after');
    el.removeAttribute('data-drop-position');
    handleNavDrop(event, item, parent);
  });

  if (item.type === 'folder' && !item.collapsed && Array.isArray(item.children)) {
    const childrenContainer = document.createElement('div');
    childrenContainer.className = 'folder-children';
    item.children.forEach(child => childrenContainer.appendChild(createNavItem(child, depth + 1, item)));
    el.appendChild(childrenContainer);
  }

  return el;
}

function renderBoard() {
  const board = getActiveBoard();
  if (!board) {
    elements.mainPanel.classList.add('no-board');
    return;
  }
  elements.mainPanel.classList.remove('no-board');
  elements.boardTitle.textContent = board.title;
  elements.bookmarkColumns.style.setProperty('--columns', board.columnCount);
  renderSpeedDial(board);
  renderColumns(board);
}

function renderSpeedDial(board) {
  elements.speedDial.innerHTML = '';
  board.speedDial.forEach(item => {
    const link = document.createElement('a');
    link.className = 'speed-link';
    link.dataset.itemId = item.id;
    link.href = item.url || '#';
    link.target = '_blank';
    link.rel = 'noreferrer noopener';
    link.draggable = true;
    link.dataset.tooltip = buildTooltip(item);

    if (item.url) {
      const favicon = document.createElement('img');
      try {
        const { hostname } = new URL(item.url);
        favicon.src = `https://www.google.com/s2/favicons?domain=${hostname}&sz=256`;
      } catch {
        favicon.src = '';
      }
      favicon.alt = item.title || 'Bookmark';
      favicon.draggable = false;
      link.appendChild(favicon);
    } else {
      const fallback = document.createElement('span');
      fallback.className = 'speed-link-fallback';
      fallback.textContent = item.title ? item.title[0].toUpperCase() : '?';
      link.appendChild(fallback);
    }

    link.addEventListener('dragstart', event => {
      event.stopPropagation();
      dragPayload = { area: 'speed-dial', itemId: item.id };
      event.dataTransfer.setData('text/plain', item.id);
      event.dataTransfer.effectAllowed = 'move';
      applyDragImage(event, link);
    });
    link.addEventListener('dragend', () => {
      dragPayload = null;
      removeDragPlaceholders();
    });
    link.addEventListener('contextmenu', event => {
      event.preventDefault();
      event.stopPropagation();
      handleSpeedDialContextMenu(event, item);
    });
    link.addEventListener('dragover', event => handleSpeedDialItemDragOver(event, item));
    link.addEventListener('dragleave', event => {
      if (link.contains(event.relatedTarget)) return;
      link.classList.remove('drop-position-before', 'drop-position-after');
      link.removeAttribute('data-drop-position');
    });
    link.addEventListener('drop', event => handleSpeedDialItemDrop(event, item));

    elements.speedDial.appendChild(link);
  });

  const addButton = document.createElement('button');
  addButton.id = 'addSpeedDialBookmarkBtn';
  addButton.className = 'icon-btn speed-dial-add-btn';
  addButton.type = 'button';
  addButton.title = 'Add Speed Dial Bookmark';
  addButton.setAttribute('aria-label', 'Add Speed Dial Bookmark');
  addButton.appendChild(icon('icon-bookmark-add'));
  elements.speedDial.appendChild(addButton);
}

function renderColumns(board) {
  elements.bookmarkColumns.innerHTML = '';
  board.columns.forEach(column => {
    const columnEl = document.createElement('div');
    columnEl.className = 'board-column';
    columnEl.dataset.columnId = column.id;
    columnEl.addEventListener('dragover', handleBoardColumnDragOver);
    columnEl.addEventListener('dragleave', event => {
      if (columnEl.contains(event.relatedTarget)) return;
      columnEl.classList.remove('drop-target');
    });
    columnEl.addEventListener('drop', event => handleBoardColumnDrop(event, column.id));
    columnEl.addEventListener('contextmenu', event => handleBoardColumnContextMenu(event, column.id));

    column.items.forEach(item => columnEl.appendChild(createBoardItemElement(item, column.id, 1, null)));
    elements.bookmarkColumns.appendChild(columnEl);
  });
}

function createBoardItemElement(item, columnId, depth = 1, parentFolder = null) {
  const itemEl = document.createElement('div');
  itemEl.className = 'board-column-item';
  itemEl.dataset.itemId = item.id;
  itemEl.dataset.columnId = columnId;
  itemEl.dataset.itemType = item.type;
  itemEl.draggable = true;

  if (item.type === 'folder') {
    itemEl.classList.add('folder-card');

    const header = document.createElement('div');
    header.className = 'folder-header';

    const collapseBtn = document.createElement('button');
    collapseBtn.type = 'button';
    collapseBtn.className = 'collapse-btn';
    collapseBtn.title = item.collapsed ? 'Expand' : 'Collapse';
    collapseBtn.setAttribute('aria-label', item.collapsed ? 'Expand folder' : 'Collapse folder');
    collapseBtn.appendChild(icon(item.collapsed ? 'icon-chevron-right' : 'icon-chevron-down'));
    collapseBtn.addEventListener('click', event => {
      event.stopPropagation();
      item.collapsed = !item.collapsed;
      saveState();
      renderBoard();
    });

    const title = document.createElement('div');
    title.className = 'folder-title';
    title.textContent = item.title;

    header.appendChild(collapseBtn);
    header.appendChild(title);
    itemEl.appendChild(header);

    header.addEventListener('dragover', event => handleBoardFolderHeaderDragOver(event, item, columnId, depth));
    header.addEventListener('dragleave', event => {
      if (header.contains(event.relatedTarget)) return;
      header.classList.remove('drop-target');
    });
    header.addEventListener('drop', event => {
      event.preventDefault();
      event.stopPropagation();
      handleBoardFolderHeaderDrop(event, item, columnId, depth);
    });

    if (!item.collapsed) {
      const childrenContainer = document.createElement('div');
      childrenContainer.className = 'folder-children';
      childrenContainer.addEventListener('dragover', event => handleBoardFolderContainerDragOver(event, item, columnId, depth));
      childrenContainer.addEventListener('dragleave', event => {
        if (event.currentTarget.contains(event.relatedTarget)) return;
        event.currentTarget.classList.remove('drop-target');
      });
      childrenContainer.addEventListener('drop', event => {
        event.preventDefault();
        event.stopPropagation();
        handleBoardFolderContainerDrop(event, item, columnId, depth);
      });
      itemEl.appendChild(childrenContainer);

      if (Array.isArray(item.children)) {
        item.children.forEach(child => childrenContainer.appendChild(createBoardItemElement(child, columnId, depth + 1, item)));
      }
    }
  } else if (item.type === 'bookmark') {
    itemEl.classList.add('bookmark-item');

    const favicon = document.createElement('span');
    favicon.className = 'bookmark-favicon';
    if (item.url) {
      const faviconImg = document.createElement('img');
      try {
        const { hostname } = new URL(item.url);
        faviconImg.src = `https://www.google.com/s2/favicons?domain=${hostname}&sz=64`;
      } catch {
        faviconImg.src = '';
      }
      faviconImg.alt = '';
      faviconImg.draggable = false;
      favicon.appendChild(faviconImg);
    }
    itemEl.appendChild(favicon);

    const body = document.createElement('div');
    body.className = 'bookmark-body';

    const label = document.createElement('span');
    label.className = 'bookmark-label';
    label.textContent = item.title || item.url || 'Untitled Bookmark';
    body.appendChild(label);

    if (item.tags && item.tags.length > 0) {
      const tagsEl = document.createElement('div');
      tagsEl.className = 'bookmark-tags';
      item.tags.forEach(tag => {
        const chip = document.createElement('span');
        chip.className = 'tag-chip';
        chip.textContent = tag;
        tagsEl.appendChild(chip);
      });
      body.appendChild(tagsEl);
    }

    itemEl.appendChild(body);

    itemEl.dataset.tooltip = buildTooltip(item);

    itemEl.addEventListener('click', () => window.open(item.url, '_blank'));
  } else if (item.type === 'title') {
    if (item.title) {
      itemEl.classList.add('title-item');
      const titleSpan = document.createElement('span');
      titleSpan.textContent = item.title;
      itemEl.appendChild(titleSpan);
    } else {
      itemEl.classList.add('divider-item');
    }
  }

  itemEl.addEventListener('contextmenu', event => {
    event.preventDefault();
    event.stopPropagation();
    handleBoardContextMenu(event, item, columnId, parentFolder, depth);
  });

  itemEl.addEventListener('dragstart', event => {
    event.stopPropagation();
    dragPayload = {
      area: 'board',
      itemId: item.id,
      itemType: item.type,
      sourceColumnId: columnId,
      sourceParentId: parentFolder ? parentFolder.id : null
    };
    event.dataTransfer.setData('text/plain', item.id);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.dropEffect = 'move';
    applyDragImage(event, itemEl);
  });

  itemEl.addEventListener('dragend', () => {
    dragPayload = null;
    removeDragPlaceholders();
  });

  itemEl.addEventListener('dragover', event => handleBoardItemDragOver(event, item, columnId, parentFolder, depth));
  itemEl.addEventListener('dragleave', event => {
    if (itemEl.contains(event.relatedTarget)) return;
    itemEl.classList.remove('drop-target', 'drop-position-before', 'drop-position-after');
    itemEl.removeAttribute('data-drop-position');
  });
  itemEl.addEventListener('drop', event => handleBoardItemDrop(event, item, columnId, parentFolder, depth));

  return itemEl;
}
