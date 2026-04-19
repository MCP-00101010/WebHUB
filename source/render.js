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
  modalNameRow: document.getElementById('modalNameRow'),
  modalLabel1: document.getElementById('modalLabel1'),
  modalInput1: document.getElementById('modalInput1'),
  modalInput2: document.getElementById('modalInput2'),
  modalUrlRow: document.getElementById('modalUrlRow'),
  modalTagsRow: document.getElementById('modalTagsRow'),
  modalTagsLabel: document.getElementById('modalTagsLabel'),
  modalInput3: document.getElementById('modalInput3'),
  modalSelectRow: document.getElementById('modalSelectRow'),
  modalSelect: document.getElementById('modalSelect'),
  modalCancelBtn: document.getElementById('modalCancelBtn'),
  contextMenu: document.getElementById('contextMenu'),
  searchInput: document.getElementById('searchInput'),
  searchResultsPane: document.getElementById('searchResultsPane')
};

function faviconUrl(url, sz) {
  try { return `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=${sz}`; }
  catch { return ''; }
}

async function fetchFaviconDataUrl(url, sz) {
  const src = faviconUrl(url, sz);
  if (!src) return '';
  try {
    const resp = await fetch(src);
    if (!resp.ok) return '';
    const blob = await resp.blob();
    return new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result);
      reader.onerror = () => resolve('');
      reader.readAsDataURL(blob);
    });
  } catch { return ''; }
}

function setFavicon(img, item, sz) {
  if (item.faviconCache) {
    img.src = item.faviconCache;
  } else if (item.url) {
    img.src = faviconUrl(item.url, sz);
    fetchFaviconDataUrl(item.url, sz).then(dataUrl => {
      if (dataUrl) {
        item.faviconCache = dataUrl;
        trimFaviconCache(item);
        img.src = dataUrl;
        saveState();
      }
    });
  }
}

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

  const ff = (key) => s[key] || 'inherit';
  const fw = (key, def = 'normal') => s[key] ? 'bold' : def;
  const fi = (key) => s[key] ? 'italic' : 'normal';
  const td = (key) => s[key] ? 'underline' : 'none';

  r.setProperty('--bookmark-font-family',        ff('bookmarkFontFamily'));
  r.setProperty('--bookmark-font-weight',         fw('bookmarkBold'));
  r.setProperty('--bookmark-font-style',          fi('bookmarkItalic'));
  r.setProperty('--bookmark-text-decoration',     td('bookmarkUnderline'));

  r.setProperty('--folder-font-family',           ff('folderFontFamily'));
  r.setProperty('--folder-font-weight',           fw('folderBold', '600'));
  r.setProperty('--folder-font-style',            fi('folderItalic'));
  r.setProperty('--folder-text-decoration',       td('folderUnderline'));

  r.setProperty('--title-font-family',            ff('titleFontFamily'));
  r.setProperty('--title-font-weight',            fw('titleBold', '600'));
  r.setProperty('--title-font-style',             fi('titleItalic'));
  r.setProperty('--title-text-decoration',        td('titleUnderline'));

  r.setProperty('--hub-name-font-size',           `${s.hubNameFontSize || 18}px`);
  r.setProperty('--hub-name-font-family',         ff('hubNameFontFamily'));
  r.setProperty('--hub-name-font-weight',         fw('hubNameBold'));
  r.setProperty('--hub-name-font-style',          fi('hubNameItalic'));
  r.setProperty('--hub-name-text-decoration',     td('hubNameUnderline'));

  r.setProperty('--board-title-font-family',      ff('boardTitleFontFamily'));
  r.setProperty('--board-title-font-weight',      fw('boardTitleBold', '600'));
  r.setProperty('--board-title-font-style',       fi('boardTitleItalic'));
  r.setProperty('--board-title-text-decoration',  td('boardTitleUnderline'));

  r.setProperty('--board-font-family',            ff('boardFontFamily'));
  r.setProperty('--board-font-weight',            fw('boardBold'));
  r.setProperty('--board-font-style',             fi('boardItalic'));
  r.setProperty('--board-text-decoration',        td('boardUnderline'));

  r.setProperty('--hub-name-text-align',          s.hubNameTextAlign    || 'left');
  r.setProperty('--board-title-text-align',       s.boardTitleTextAlign || 'left');
  r.setProperty('--board-text-align',             s.boardTextAlign      || 'left');
  r.setProperty('--bookmark-text-align',          s.bookmarkTextAlign   || 'left');
  r.setProperty('--folder-text-align',            s.folderTextAlign     || 'left');

  r.setProperty('--hub-name-color',               s.hubNameColor    || 'var(--text)');
  r.setProperty('--board-title-color',            s.boardTitleColor || 'var(--text)');
  r.setProperty('--board-color',                  s.boardColor      || 'var(--text)');
  r.setProperty('--bookmark-color',               s.bookmarkColor   || 'var(--text)');
  r.setProperty('--folder-color',                 s.folderColor     || 'var(--text)');
  r.setProperty('--title-color',                  s.titleColor      || 'var(--text-muted)');
  r.setProperty('--title-line-color',             s.titleLineColor  || 'rgba(255,255,255,0.12)');
  r.setProperty('--title-line-style',             s.titleLineStyle  || 'solid');

  const sdSizes = { small: '34px', medium: '44px', large: '56px' };
  r.setProperty('--speed-link-size', sdSizes[s.speedDialIconSize] || '44px');
  const essCols = { small: 8, medium: 6, large: 4 };
  r.setProperty('--essentials-cols', essCols[s.essentialsIconSize] || 6);
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function updateInboxBadge() {
  const board = getActiveBoard();
  const { bookmarks, folders } = getBoardInboxCounts(board);
  const count = bookmarks + folders;
  const badge = document.getElementById('inboxBadge');
  if (badge) {
    badge.textContent = count;
    badge.classList.toggle('hidden', count === 0);
  }
}

function renderInboxPanel() {
  const board = getActiveBoard();
  const inbox = getBoardInbox(board);
  const body = document.getElementById('inboxPanelBody');
  if (!body) return;
  body.innerHTML = '';
  const { bookmarks, folders } = getBoardInboxCounts(board);
  const bmEl = document.getElementById('inboxPanelBmCount');
  const flEl = document.getElementById('inboxPanelFlCount');
  if (bmEl) { bmEl.textContent = bookmarks; bmEl.classList.toggle('hidden', bookmarks === 0); }
  if (flEl) { flEl.textContent = folders; flEl.classList.toggle('hidden', folders === 0); }
  updateInboxBadge();
  if (!inbox?.items.length) {
    const empty = document.createElement('div');
    empty.className = 'inbox-empty';
    empty.textContent = 'Inbox is empty.';
    body.appendChild(empty);
    return;
  }
  inbox.items.forEach(item => body.appendChild(createBoardItemElement(item, inbox.id, null, 0)));
}

function renderAll() {
  applySettings();
  elements.hubNameEl.textContent = state.hubName || 'Morpheus WebHub';
  document.title = state.hubName || 'Morpheus WebHub';
  // If active board is Import Manager but it's now empty, switch to first nav board
  const activeBoard = state.boards.find(b => b.id === state.activeBoardId);
  if (activeBoard?.isImportManager && !importManagerHasItems()) {
    function findFirstBoardId(items) {
      for (const i of items) { if (i.boardId) return i.boardId; if (i.children) { const r = findFirstBoardId(i.children); if (r) return r; } }
      return null;
    }
    const fallbackId = findFirstBoardId(state.navItems);
    if (fallbackId) state.activeBoardId = fallbackId;
  }
  renderNav();
  renderEssentials();
  renderBoard();
  updateInboxBadge();
  if (typeof inboxPanelOpen !== 'undefined' && inboxPanelOpen) renderInboxPanel();
  const q = elements.searchInput.value.trim();
  if (q) renderSearchResults(q);
}

function renderSearchResults(query) {
  const q = query.toLowerCase();
  const pane = elements.searchResultsPane;
  pane.innerHTML = '';

  const matchesQuery = (item, board) => {
    if ((item.title || '').toLowerCase().includes(q)) return true;
    if (item.url && item.url.toLowerCase().includes(q)) return true;
    if (item.tags && item.tags.some(t => t.toLowerCase().includes(q))) return true;
    if (item.sharedTags && item.sharedTags.some(t => t.toLowerCase().includes(q))) return true;
    if (item.tags && item.tags.some(t => t.toLowerCase().includes(q))) return true;
    if (board) {
      const inherited = computeInheritedTags(item, board);
      if (inherited.some(t => t.toLowerCase().includes(q))) return true;
    }
    return false;
  };

  const collectFromList = (items, board) => {
    const hits = [];
    for (const item of (items || [])) {
      if (matchesQuery(item, board)) hits.push(item);
      if (item.children) hits.push(...collectFromList(item.children, board));
    }
    return hits;
  };

  const groups = [];
  const essHits = state.essentials.filter(e => e && matchesQuery(e, null));
  if (essHits.length) groups.push({ label: 'Essentials', items: essHits });
  for (const board of state.boards) {
    const hits = [];
    if (matchesQuery(board, null)) hits.push(board);
    hits.push(...board.speedDial.filter(i => matchesQuery(i, board)));
    hits.push(...board.columns.filter(c => !c.isInbox).flatMap(col => collectFromList(col.items, board)));
    if (hits.length) groups.push({ label: board.title, items: hits });
  }

  if (!groups.length) {
    const empty = document.createElement('div');
    empty.className = 'search-empty';
    empty.textContent = 'No bookmarks found.';
    pane.appendChild(empty);
    return;
  }

  for (const group of groups) {
    const groupEl = document.createElement('div');
    groupEl.className = 'search-results-group';
    const label = document.createElement('div');
    label.className = 'search-results-group-label';
    label.textContent = group.label;
    groupEl.appendChild(label);
    const list = document.createElement('div');
    list.className = 'search-results-list';
    group.items.forEach(item => list.appendChild(createSearchResultItem(item)));
    groupEl.appendChild(list);
    pane.appendChild(groupEl);
  }
}

function createSearchResultItem(item) {
  if (item.type === 'folder') return createFolderSearchResultItem(item);
  if (item.type === 'board') return createBoardSearchResultItem(item);

  const el = document.createElement('a');
  el.className = 'board-column-item bookmark-item';
  el.href = item.url || '#';
  el.target = '_blank';
  el.rel = 'noreferrer noopener';

  const favicon = document.createElement('span');
  favicon.className = 'bookmark-favicon';
  if (item.url) {
    const img = document.createElement('img');
    setFavicon(img, item, 64);
    img.alt = '';
    img.draggable = false;
    favicon.appendChild(img);
  }
  el.appendChild(favicon);

  const body = document.createElement('div');
  body.className = 'bookmark-body';
  const label = document.createElement('span');
  label.className = 'bookmark-label';
  label.textContent = item.title || item.url || 'Untitled';
  body.appendChild(label);
  if (item.url) {
    const urlEl = document.createElement('span');
    urlEl.className = 'search-result-url';
    urlEl.textContent = item.url;
    body.appendChild(urlEl);
  }
  if (item.tags && item.tags.length > 0) {
    const tagsEl = document.createElement('div');
    tagsEl.className = 'bookmark-tags';
    renderTagsInto(tagsEl, item.tags);
    body.appendChild(tagsEl);
  }
  el.appendChild(body);
  return el;
}

function createFolderSearchResultItem(item) {
  const el = document.createElement('div');
  el.className = 'board-column-item bookmark-item';

  const icon = document.createElement('span');
  icon.className = 'bookmark-favicon';
  icon.style.cssText = 'font-size:1rem;display:grid;place-items:center;';
  icon.textContent = '📁';
  el.appendChild(icon);

  const body = document.createElement('div');
  body.className = 'bookmark-body';
  const label = document.createElement('span');
  label.className = 'bookmark-label';
  label.textContent = item.title || 'Untitled Folder';
  body.appendChild(label);

  const allTags = [...(item.sharedTags || []), ...(item.tags || [])];
  if (allTags.length) {
    const tagsEl = document.createElement('div');
    tagsEl.className = 'bookmark-tags';
    renderTagsInto(tagsEl, allTags);
    body.appendChild(tagsEl);
  }

  el.appendChild(body);
  return el;
}

function createBoardSearchResultItem(item) {
  const el = document.createElement('div');
  el.className = 'board-column-item bookmark-item';
  el.style.cursor = 'pointer';
  el.addEventListener('click', () => {
    state.activeBoardId = item.id;
    elements.searchInput.value = '';
    elements.mainPanel.classList.remove('search-active');
    elements.searchResultsPane.classList.add('hidden');
    renderAll();
    saveState();
  });

  const icon = document.createElement('span');
  icon.className = 'bookmark-favicon';
  icon.style.cssText = 'font-size:1rem;display:grid;place-items:center;';
  icon.textContent = '🗂️';
  el.appendChild(icon);

  const body = document.createElement('div');
  body.className = 'bookmark-body';
  const label = document.createElement('span');
  label.className = 'bookmark-label';
  label.textContent = item.title || 'Untitled Board';
  body.appendChild(label);

  const allTags = [...(item.sharedTags || []), ...(item.tags || [])];
  if (allTags.length) {
    const tagsEl = document.createElement('div');
    tagsEl.className = 'bookmark-tags';
    renderTagsInto(tagsEl, allTags);
    body.appendChild(tagsEl);
  }

  el.appendChild(body);
  return el;
}

function applyTagColor(chip, tag) {
  const color = state.settings.tagColors?.[tag];
  if (color) {
    chip.style.background = hexToRgba(color, 0.15);
    chip.style.color = color;
  }
}

function makeTagChip(tag) {
  const chip = document.createElement('span');
  chip.className = 'tag-chip';
  chip.textContent = tag;
  applyTagColor(chip, tag);
  return chip;
}

function renderTagsInto(container, tags) {
  (tags || []).forEach(t => container.appendChild(makeTagChip(t)));
}

function createTagSection(labelText, tags) {
  const section = document.createElement('div');
  section.className = 'tag-section';
  const lbl = document.createElement('span');
  lbl.className = 'tag-section-label';
  lbl.textContent = labelText;
  section.appendChild(lbl);
  tags.forEach(t => section.appendChild(makeTagChip(t)));
  return section;
}

let lastRenderedBoardId = null;

function renderEssentials() {
  const section = document.getElementById('essentialsSection');
  const visible = state.settings.showEssentials !== false;
  if (section) section.classList.toggle('hidden', !visible);
  if (!visible) { elements.essentialsGrid.innerHTML = ''; return; }
  elements.essentialsGrid.innerHTML = '';
  const displayCount = state.settings.essentialsDisplayCount || 10;
  for (let slot = 0; slot < displayCount; slot++) {
    const item = state.essentials[slot] || null;
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
        setFavicon(img, item, 64);
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
      if (!dragPayload && !isExternalDrag(event)) return;
      if (dragPayload?.area === 'essential' && dragPayload.slot === slot) return;
      if (dragPayload?.area === 'nav') return;
      event.preventDefault();
      event.dataTransfer.dropEffect = dragPayload ? 'move' : 'copy';
      cell.classList.add('drop-target');
    });
    cell.addEventListener('dragleave', () => cell.classList.remove('drop-target'));
    cell.addEventListener('drop', event => {
      event.preventDefault();
      event.stopPropagation();
      cell.classList.remove('drop-target');
      if (isExternalDrag(event)) {
        const ext = getExternalDrop(event);
        if (ext) openExternalBookmarkModal(ext.url, ext.title, { area: 'essential', slot, item });
        return;
      }
      handleEssentialSlotDrop(slot);
    });

    elements.essentialsGrid.appendChild(cell);
  }
}

function renderNav() {
  elements.navList.innerHTML = '';
  if (importManagerHasItems()) {
    const importBoard = getImportManagerBoard();
    if (importBoard) elements.navList.appendChild(createImportManagerNavItem(importBoard));
  }
  state.navItems.forEach(item => elements.navList.appendChild(createNavItem(item)));
}

function createImportManagerNavItem(board) {
  const el = document.createElement('div');
  el.className = 'nav-item nav-import-manager';
  el.dataset.type = 'board';

  const label = document.createElement('div');
  label.textContent = board.title;
  el.appendChild(label);

  const { bookmarks, folders } = getImportManagerCounts();
  if (bookmarks > 0 || folders > 0) {
    const bmBadge = document.createElement('span');
    bmBadge.className = 'nav-inbox-badge';
    bmBadge.title = 'Bookmarks';
    bmBadge.textContent = bookmarks;
    el.appendChild(bmBadge);
    const folderBadge = document.createElement('span');
    folderBadge.className = 'nav-inbox-badge nav-inbox-badge--folder';
    folderBadge.title = 'Folders';
    folderBadge.textContent = folders;
    el.appendChild(folderBadge);
  }

  el.addEventListener('click', () => {
    state.activeBoardId = board.id;
    elements.searchInput.value = '';
    elements.mainPanel.classList.remove('search-active');
    elements.searchResultsPane.classList.add('hidden');
    renderAll();
    saveState();
  });

  el.addEventListener('contextmenu', event => {
    event.preventDefault();
    event.stopPropagation();
  });

  return el;
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
    const board = state.boards.find(b => b.id === item.boardId);
    const { bookmarks: ibm, folders: ifl } = getBoardInboxCounts(board);
    if (ibm + ifl > 0) {
      const bmBadge = document.createElement('span');
      bmBadge.className = 'nav-inbox-badge';
      bmBadge.title = 'Bookmarks in inbox';
      bmBadge.textContent = ibm;
      el.appendChild(bmBadge);
      const flBadge = document.createElement('span');
      flBadge.className = 'nav-inbox-badge nav-inbox-badge--folder';
      flBadge.title = 'Folders in inbox';
      flBadge.textContent = ifl;
      el.appendChild(flBadge);
    }
    el.addEventListener('click', () => {
      if (item.boardId) {
        state.activeBoardId = item.boardId;
        elements.searchInput.value = '';
        elements.mainPanel.classList.remove('search-active');
        elements.searchResultsPane.classList.add('hidden');
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

function applyBoardBackground(board) {
  const mp = elements.mainPanel;
  mp.style.backgroundImage = board.backgroundImage ? `url(${board.backgroundImage})` : '';
  mp.style.setProperty('--container-alpha', (board.containerOpacity ?? 100) / 100);
}

function renderBoard() {
  const board = getActiveBoard();
  if (!board) {
    elements.mainPanel.classList.add('no-board');
    elements.mainPanel.style.backgroundImage = '';
    elements.boardTitle.textContent = '';
    elements.speedDial.innerHTML = '';
    elements.bookmarkColumns.innerHTML = '';
    lastRenderedBoardId = null;
    return;
  }

  const isNewBoard = board.id !== lastRenderedBoardId;
  if (isNewBoard) {
    if (typeof clearSelection === 'function') clearSelection();
    lastRenderedBoardId = board.id;
    elements.mainPanel.classList.remove('board-fade-in');
    void elements.mainPanel.offsetWidth;
    elements.mainPanel.classList.add('board-fade-in');
  }

  elements.mainPanel.classList.remove('no-board');
  elements.boardTitle.textContent = board.title;
  elements.bookmarkColumns.style.setProperty('--columns', board.columnCount);
  applyBoardBackground(board);

  const speedDialPanel = elements.mainPanel.querySelector('.speed-dial-panel');
  if (speedDialPanel) speedDialPanel.classList.toggle('hidden', board.showSpeedDial === false);

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
      setFavicon(favicon, item, 256);
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
}

function renderColumns(board) {
  elements.bookmarkColumns.innerHTML = '';
  board.columns.filter(c => !c.isInbox).forEach(column => {
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
    if (column.items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'column-empty-state';
      empty.textContent = 'Right-click to add';
      columnEl.appendChild(empty);
    }
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
    if (selectedItemIds?.has(item.id)) itemEl.classList.add('selected');

    const header = document.createElement('div');
    header.className = 'folder-header';

    const folderCheckbox = document.createElement('div');
    folderCheckbox.className = 'item-checkbox';
    folderCheckbox.addEventListener('click', e => { e.stopPropagation(); e.preventDefault(); toggleItemSelection(item.id, itemEl); });
    header.appendChild(folderCheckbox);

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
      const inInbox = state.boards.some(b => b.columns.some(c => c.isInbox && c.id === columnId));
      if (inInbox) renderInboxPanel(); else renderBoard();
    });

    const title = document.createElement('div');
    title.className = 'folder-title';
    title.textContent = item.title;

    header.appendChild(collapseBtn);
    header.appendChild(title);
    itemEl.appendChild(header);

    const board = getActiveBoard();
    const folderTagArea = document.createElement('div');
    folderTagArea.className = 'folder-tag-area';
    const inherited = computeInheritedTags(item, board);
    if (inherited.length) folderTagArea.appendChild(createTagSection('Inherited', inherited));
    if (item.sharedTags?.length) folderTagArea.appendChild(createTagSection('Shared', item.sharedTags));
    if (item.tags?.length) folderTagArea.appendChild(createTagSection('Tags', item.tags));
    if (folderTagArea.children.length) itemEl.appendChild(folderTagArea);

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
    if (selectedItemIds?.has(item.id)) itemEl.classList.add('selected');

    const bmCheckbox = document.createElement('div');
    bmCheckbox.className = 'item-checkbox';
    bmCheckbox.addEventListener('click', e => { e.stopPropagation(); e.preventDefault(); toggleItemSelection(item.id, itemEl); });
    itemEl.appendChild(bmCheckbox);

    const favicon = document.createElement('span');
    favicon.className = 'bookmark-favicon';
    if (item.url) {
      const faviconImg = document.createElement('img');
      setFavicon(faviconImg, item, 64);
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

    const bmBoard = getActiveBoard();
    const bmInherited = computeInheritedTags(item, bmBoard);
    if (bmInherited.length) {
      const iSection = createTagSection('Inherited', bmInherited);
      iSection.classList.add('bookmark-tags');
      body.appendChild(iSection);
    }

    if (item.tags && item.tags.length > 0) {
      const tagsEl = document.createElement('div');
      tagsEl.className = 'bookmark-tags';
      renderTagsInto(tagsEl, item.tags);
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
