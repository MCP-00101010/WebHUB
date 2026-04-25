const elements = {
  navList: document.getElementById('navList'),
  essentialsGrid: document.getElementById('essentialsGrid'),
  hubNameEl: document.getElementById('hubNameEl'),
  boardTitle: document.getElementById('boardTitle'),
  boardSettingsBtn: document.getElementById('boardSettingsBtn'),
  inboxBtn: document.getElementById('inboxBtn'),
  mainPanel: document.getElementById('mainPanel'),
  bookmarkColumns: document.getElementById('bookmarkColumns'),
  speedDial: document.getElementById('speedDial'),
  modalOverlay: document.getElementById('modalOverlay'),
  modalTitle: document.getElementById('modalTitle'),
  modalForm: document.getElementById('modalForm'),
  modalInput1: document.getElementById('modalInput1'),
  modalInput2: document.getElementById('modalInput2'),
  modalUrlRow: document.getElementById('modalUrlRow'),
  modalTagsRow: document.getElementById('modalTagsRow'),
  modalInput3: document.getElementById('modalInput3'),
  modalInput4: document.getElementById('modalInput4'),
  modalSelectRow: document.getElementById('modalSelectRow'),
  modalSelect: document.getElementById('modalSelect'),
  modalCancelBtn: document.getElementById('modalCancelBtn'),
  contextMenu: document.getElementById('contextMenu'),
  quickSearchBtn: document.getElementById('quickSearchBtn'),
  quickTagManagerBtn: document.getElementById('quickTagManagerBtn'),
  quickSettingsBtn: document.getElementById('quickSettingsBtn'),
  searchModal: document.getElementById('searchModal'),
  searchModalInput: document.getElementById('searchModalInput'),
  searchModalResults: document.getElementById('searchModalResults'),
  collectionTabBar: document.getElementById('collectionTabBar')
};

const searchFilters = {
  name: true,
  url: true,
  typeBookmark: true,
  typeFolder: true,
  typeBoard: true
};

let activeTagFilters = new Set();
let _tagFilterMode = 'or';
let _tagPickerSort = 'az';

function _faviconHostname(url) {
  try { return new URL(url).hostname; } catch { return ''; }
}

function setFavicon(img, item, sz) {
  if (item.faviconCache) {
    img.src = item.faviconCache;
    return;
  }
  if (!item.url) return;
  const hostname = _faviconHostname(item.url);
  if (!hostname) return;
  // faviconV2 returns 404 for unknown sites (unlike /s2/favicons which always returns 200+generic globe)
  // Cap request size at 64 — larger values cause some services to return icons with white backgrounds
  const srcs = [
    `https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://${hostname}&size=64`,
    `https://icons.duckduckgo.com/ip3/${hostname}.ico`,
    `https://${hostname}/favicon.ico`,
    `https://www.google.com/s2/favicons?domain=${hostname}&sz=64`,
  ];
  let i = 0;
  const tryNext = () => {
    if (i >= srcs.length) { img.onerror = null; return; }
    img.onerror = tryNext;
    img.src = srcs[i++];
  };
  tryNext();
}

function createCountChip(value, title, variant = 'bookmark') {
  const chip = document.createElement('span');
  chip.className = `count-chip count-chip--${variant}`;
  chip.textContent = value;
  chip.title = title;
  return chip;
}

function renderCountChipsInto(container, counts, options = {}) {
  if (!container) return;
  const { bookmarks = 0, folders = 0 } = counts || {};
  const showZero = options.showZero === true;
  if (bookmarks > 0 || showZero) container.appendChild(createCountChip(bookmarks, options.bookmarkTitle || 'Bookmarks', 'bookmark'));
  if (folders > 0 || showZero) container.appendChild(createCountChip(folders, options.folderTitle || 'Folders', 'folder'));
}

function getNavFolderInboxCounts(folder) {
  const totals = { bookmarks: 0, folders: 0 };
  const seenBoardIds = new Set();
  const addBoard = boardId => {
    if (!boardId || seenBoardIds.has(boardId)) return;
    seenBoardIds.add(boardId);
    const counts = getBoardInboxCounts(state.boards.find(b => b.id === boardId));
    totals.bookmarks += counts.bookmarks;
    totals.folders += counts.folders;
  };
  const walk = items => {
    for (const item of (items || [])) {
      if (item.type === 'board') {
        addBoard(item.boardId);
      } else if (item.type === 'collection') {
        (item.boardIds || []).forEach(addBoard);
      } else if (item.type === 'folder') {
        walk(item.children);
      }
    }
  };
  walk(folder?.children);
  return totals;
}

function getCollectionInboxCounts(collection) {
  const totals = { bookmarks: 0, folders: 0 };
  const seenBoardIds = new Set();
  for (const boardId of (collection?.boardIds || [])) {
    if (!boardId || seenBoardIds.has(boardId)) continue;
    seenBoardIds.add(boardId);
    const counts = getBoardInboxCounts(state.boards.find(b => b.id === boardId));
    totals.bookmarks += counts.bookmarks;
    totals.folders += counts.folders;
  }
  return totals;
}

function buildTooltip(item, board = null) {
  const parts = [item.title || 'Untitled'];
  if (item.url) parts.push(item.url);
  const ownTags = (item.tags || []).map(id => resolveTag(id).name);
  const inherited = board ? computeInheritedTags(item, board).map(id => resolveTag(id).name) : [];
  const shared = (item.sharedTags || []).map(id => resolveTag(id).name);
  if (ownTags.length) parts.push(`Tags: ${ownTags.join(', ')}`);
  if (inherited.length) parts.push(`Inherited: ${inherited.join(', ')}`);
  if (shared.length) parts.push(`Shared: ${shared.join(', ')}`);
  return parts.join('\n');
}

function applySettings() {
  const s = state.settings;
  const r = document.documentElement.style;
  const overrides = s.styleOverrides || {};
  const fontPresets = {
    small: { base: 12, hub: 16, boardTitle: 18, nav: 13, collection: 14, title: 11 },
    medium: { base: 14, hub: 18, boardTitle: 22, nav: 14, collection: 15, title: 12 },
    large: { base: 16, hub: 21, boardTitle: 26, nav: 16, collection: 17, title: 14 }
  };
  const preset = fontPresets[s.globalFontScale || 'medium'] || fontPresets.medium;
  const globalColor = s.globalFontColorFromTheme === false
    ? (s.globalFontColor || '#e5e7eb')
    : 'var(--accent)';
  const globalMutedColor = s.globalFontColorFromTheme === false
    ? (s.globalFontColor || '#e5e7eb')
    : 'var(--accent)';
  const sectionColor = (section, key, fallback = globalColor) => overrides[section] ? (s[key] || fallback) : fallback;
  const sectionSize = (section, key, fallback) => overrides[section] ? (s[key] || fallback) : fallback;

  r.setProperty('--board-font-size', `${sectionSize('board', 'boardFontSize', preset.nav)}px`);
  r.setProperty('--bookmark-font-size', `${sectionSize('bookmark', 'bookmarkFontSize', preset.base)}px`);
  r.setProperty('--folder-font-size', `${sectionSize('folder', 'folderFontSize', preset.nav + 1)}px`);
  r.setProperty('--title-font-size', `${sectionSize('title', 'titleFontSize', preset.title)}px`);
  r.setProperty('--title-line-thickness', `${overrides.title ? s.titleLineThickness : 1}px`);
  r.setProperty('--board-title-font-size', `${sectionSize('boardTitle', 'boardTitleFontSize', preset.boardTitle)}px`);
  r.setProperty('--tags-display', s.showTags ? 'flex' : 'none');
  r.setProperty('--tags-grid-display', s.showTags ? 'grid' : 'none');

  const ff = (section, key) => overrides[section] ? (s[key] || 'inherit') : 'inherit';
  const fw = (section, key, def = 'normal') => overrides[section] ? (s[key] ? 'bold' : def) : def;
  const fi = (section, key) => overrides[section] && s[key] ? 'italic' : 'normal';
  const td = (section, key) => overrides[section] && s[key] ? 'underline' : 'none';
  const align = (section, key) => overrides[section] ? (s[key] || 'left') : 'left';

  r.setProperty('--bookmark-font-family',        ff('bookmark', 'bookmarkFontFamily'));
  r.setProperty('--bookmark-font-weight',         fw('bookmark', 'bookmarkBold'));
  r.setProperty('--bookmark-font-style',          fi('bookmark', 'bookmarkItalic'));
  r.setProperty('--bookmark-text-decoration',     td('bookmark', 'bookmarkUnderline'));

  r.setProperty('--folder-font-family',           ff('folder', 'folderFontFamily'));
  r.setProperty('--folder-font-weight',           fw('folder', 'folderBold', '600'));
  r.setProperty('--folder-font-style',            fi('folder', 'folderItalic'));
  r.setProperty('--folder-text-decoration',       td('folder', 'folderUnderline'));

  r.setProperty('--collection-font-size',         `${sectionSize('collection', 'collectionFontSize', preset.collection)}px`);
  r.setProperty('--collection-font-family',       ff('collection', 'collectionFontFamily'));
  r.setProperty('--collection-font-weight',       fw('collection', 'collectionBold', '600'));
  r.setProperty('--collection-font-style',        fi('collection', 'collectionItalic'));
  r.setProperty('--collection-text-decoration',   td('collection', 'collectionUnderline'));

  r.setProperty('--title-font-family',            ff('title', 'titleFontFamily'));
  r.setProperty('--title-font-weight',            fw('title', 'titleBold', '600'));
  r.setProperty('--title-font-style',             fi('title', 'titleItalic'));
  r.setProperty('--title-text-decoration',        td('title', 'titleUnderline'));

  r.setProperty('--hub-name-font-size',           `${sectionSize('hubName', 'hubNameFontSize', preset.hub)}px`);
  r.setProperty('--hub-name-font-family',         ff('hubName', 'hubNameFontFamily'));
  r.setProperty('--hub-name-font-weight',         fw('hubName', 'hubNameBold'));
  r.setProperty('--hub-name-font-style',          fi('hubName', 'hubNameItalic'));
  r.setProperty('--hub-name-text-decoration',     td('hubName', 'hubNameUnderline'));

  r.setProperty('--board-title-font-family',      ff('boardTitle', 'boardTitleFontFamily'));
  r.setProperty('--board-title-font-weight',      fw('boardTitle', 'boardTitleBold', '600'));
  r.setProperty('--board-title-font-style',       fi('boardTitle', 'boardTitleItalic'));
  r.setProperty('--board-title-text-decoration',  td('boardTitle', 'boardTitleUnderline'));

  r.setProperty('--board-font-family',            ff('board', 'boardFontFamily'));
  r.setProperty('--board-font-weight',            fw('board', 'boardBold'));
  r.setProperty('--board-font-style',             fi('board', 'boardItalic'));
  r.setProperty('--board-text-decoration',        td('board', 'boardUnderline'));

  r.setProperty('--hub-name-text-align',          align('hubName', 'hubNameTextAlign'));
  r.setProperty('--board-title-text-align',       align('boardTitle', 'boardTitleTextAlign'));
  r.setProperty('--board-text-align',             align('board', 'boardTextAlign'));
  r.setProperty('--bookmark-text-align',          align('bookmark', 'bookmarkTextAlign'));
  r.setProperty('--folder-text-align',            align('folder', 'folderTextAlign'));
  r.setProperty('--collection-text-align',        align('collection', 'collectionTextAlign'));

  r.setProperty('--hub-name-color',               sectionColor('hubName', 'hubNameColor'));
  r.setProperty('--board-title-color',            sectionColor('boardTitle', 'boardTitleColor'));
  r.setProperty('--board-color',                  sectionColor('board', 'boardColor'));
  r.setProperty('--bookmark-color',               sectionColor('bookmark', 'bookmarkColor'));
  r.setProperty('--folder-color',                 sectionColor('folder', 'folderColor'));
  r.setProperty('--collection-color',             sectionColor('collection', 'collectionColor'));
  r.setProperty('--title-color',                  sectionColor('title', 'titleColor', globalMutedColor));
  r.setProperty('--title-line-color',             overrides.title ? (s.titleLineColor || 'rgba(255,255,255,0.12)') : globalColor);
  r.setProperty('--title-line-style',             overrides.title ? (s.titleLineStyle || 'solid') : 'solid');

  const sdSizes = { small: '34px', medium: '44px', large: '56px' };
  r.setProperty('--speed-link-size', sdSizes[s.speedDialIconSize] || '44px');
  const essCols = { small: 8, medium: 6, large: 4 };
  r.setProperty('--essentials-cols', essCols[s.essentialsIconSize] || 6);

  applyTheme(getThemeById(s.activeThemeName || 'default-dark'));
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
    badge.innerHTML = '';
    renderCountChipsInto(badge, { bookmarks, folders }, {
      bookmarkTitle: 'Bookmarks in inbox',
      folderTitle: 'Folders in inbox'
    });
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
  if (bmEl) { bmEl.textContent = bookmarks; bmEl.className = 'count-chip count-chip--bookmark'; bmEl.classList.toggle('hidden', bookmarks === 0); }
  if (flEl) { flEl.textContent = folders; flEl.className = 'count-chip count-chip--folder'; flEl.classList.toggle('hidden', folders === 0); }
  updateInboxBadge();
  if (!inbox?.items.length) {
    const empty = document.createElement('div');
    empty.className = 'inbox-empty';
    empty.textContent = 'Inbox is empty.';
    body.appendChild(empty);
    return;
  }
  inbox.items.forEach(item => body.appendChild(createBoardItemElement(item, inbox.id)));
}

function renderAll() {
  applySettings();
  elements.hubNameEl.textContent = state.hubName || 'Morpheus WebHub';
  document.title = state.hubName || 'Morpheus WebHub';
  // If active board is Import Manager but it's now empty, switch to first nav board
  const activeBoard = state.boards.find(b => b.id === state.activeBoardId);
  if (activeBoard?.isImportManager && !importManagerHasItems()) {
    function findFirstBoardId(items) {
      for (const i of items) {
        if (i.boardId) return i.boardId;
        if (i.type === 'collection' && i.boardIds?.length) return i.boardIds[0];
        if (i.children) { const r = findFirstBoardId(i.children); if (r) return r; }
      }
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
  if (!elements.searchModal.classList.contains('hidden')) {
    const q = elements.searchModalInput.value.trim();
    if (q || activeTagFilters.size > 0) renderSearchResults();
  }
}

function _showTagPicker(show) {
  const pickerEl = document.getElementById('searchTagPicker');
  pickerEl.classList.toggle('hidden', !show);
  const tagsChip = document.querySelector('#searchModal .search-filter-chip[data-filter="tags"]');
  if (tagsChip) tagsChip.classList.toggle('active', show);
}

function openSearchModal(opts = {}) {
  const modal = elements.searchModal;
  const firstOpen = !modal.dataset.draggableAttached;
  modal.classList.remove('hidden');
  if (firstOpen) {
    makeDraggable(modal, document.getElementById('searchModalDragHandle'));
    centerPanel(modal);
  }
  if (opts.tagId) {
    activeTagFilters = new Set([opts.tagId]);
    _showTagPicker(true);
    elements.searchModalInput.value = '';
    renderSearchResults();
  } else {
    if (opts.query !== undefined) elements.searchModalInput.value = opts.query;
    elements.searchModalInput.focus();
    const q = elements.searchModalInput.value.trim();
    if (q || activeTagFilters.size > 0) renderSearchResults();
    else elements.searchModalResults.innerHTML = '';
  }
}

function closeSearchModal() {
  elements.searchModal.classList.add('hidden');
  elements.searchModalInput.value = '';
  activeTagFilters = new Set();
  _tagFilterMode = 'or';
  document.getElementById('searchTagModeBtn').dataset.mode = 'or';
  document.getElementById('searchTagModeBtn').textContent = 'ANY';
  _showTagPicker(false);
  elements.searchModalResults.innerHTML = '';
}

function renderSearchResults() {
  const q = elements.searchModalInput.value.trim().toLowerCase() || null;
  const hasTagFilters = activeTagFilters.size > 0;
  const pane = elements.searchModalResults;
  pane.innerHTML = '';

  const pickerEl = document.getElementById('searchTagPicker');
  const pickerOpen = !pickerEl.classList.contains('hidden');

  if (!q && !hasTagFilters && !pickerOpen) return;

  const typeAllowed = (item) => {
    if (item.type === 'board') return searchFilters.typeBoard;
    if (item.type === 'folder') return searchFilters.typeFolder;
    return searchFilters.typeBookmark;
  };

  const matchesText = (item, board) => {
    if (!typeAllowed(item)) return false;
    if (!q) return true;
    if (searchFilters.name && (item.title || '').toLowerCase().includes(q)) return true;
    if (searchFilters.url && item.url && item.url.toLowerCase().includes(q)) return true;
    return false;
  };

  const matchesTagFilter = (item, board) => {
    if (!hasTagFilters) return true;
    const allItemTags = [
      ...(item.tags || []),
      ...(item.sharedTags || []),
      ...(board ? computeInheritedTags(item, board) : [])
    ];
    if (_tagFilterMode === 'and') return [...activeTagFilters].every(id => allItemTags.includes(id));
    return [...activeTagFilters].some(id => allItemTags.includes(id));
  };

  const allBaseHits = [];
  const collectFromList = (items, board, columnId) => {
    const hits = [];
    for (const item of (items || [])) {
      if (matchesText(item, board)) hits.push({ item, meta: { area: 'board-item', boardId: board.id, columnId }, board });
      if (item.children) hits.push(...collectFromList(item.children, board, columnId));
    }
    return hits;
  };

  state.essentials.forEach((e, i) => {
    if (e && matchesText(e, null)) allBaseHits.push({ item: e, meta: { area: 'essential', slot: i }, board: null });
  });
  for (const board of state.boards) {
    if (matchesText(board, null)) allBaseHits.push({ item: board, meta: { area: 'board-item', boardId: board.id }, board: null });
    board.speedDial.filter(i => i && matchesText(i, board)).forEach(i => allBaseHits.push({ item: i, meta: { area: 'speed-dial-item', boardId: board.id }, board }));
    board.columns.filter(c => !c.isInbox).forEach(col => allBaseHits.push(...collectFromList(col.items, board, col.id)));
  }

  const finalHits = hasTagFilters ? allBaseHits.filter(h => matchesTagFilter(h.item, h.board)) : allBaseHits;

  const groupMap = new Map();
  for (const h of finalHits) {
    const label = h.meta.area === 'essential' ? 'Essentials' : (h.board?.title || state.boards.find(b => b.id === h.meta.boardId)?.title || '');
    if (!groupMap.has(label)) groupMap.set(label, []);
    groupMap.get(label).push(h);
  }
  const groups = [...groupMap.entries()].map(([label, items]) => ({ label, items }));

  // picker: when query exists use text-matched items, otherwise use all items (empty query = full DB)
  const pickerBaseHits = q ? allBaseHits : finalHits.length ? finalHits : allBaseHits;
  if (pickerOpen) renderTagPicker(pickerBaseHits);

  // only render results pane when there's an active query or tag filter
  if (!q && !hasTagFilters) return;

  if (!groups.length) {
    const empty = document.createElement('div');
    empty.className = 'search-empty';
    empty.textContent = 'No results found.';
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
    group.items.forEach(({ item, meta }) => list.appendChild(createSearchResultItem(item, meta)));
    groupEl.appendChild(list);
    pane.appendChild(groupEl);
  }
}

function renderTagPicker(baseHits) {
  const list = document.getElementById('searchTagPickerList');
  if (!list) return;
  list.innerHTML = '';

  // build tag count map from baseHits
  const tagCount = new Map();
  for (const { item, board } of baseHits) {
    const allTags = [
      ...(item.tags || []),
      ...(item.sharedTags || []),
      ...(board ? computeInheritedTags(item, board) : [])
    ];
    for (const id of allTags) {
      tagCount.set(id, (tagCount.get(id) || 0) + 1);
    }
  }

  if (tagCount.size === 0) {
    const empty = document.createElement('div');
    empty.className = 'search-tag-group-header';
    empty.style.opacity = '0.5';
    empty.textContent = 'No tags in results';
    list.appendChild(empty);
    return;
  }

  let tags = [...tagCount.keys()]
    .map(id => ({ id, tag: resolveTag(id), count: tagCount.get(id) }))
    .filter(t => t.tag);

  if (_tagPickerSort === 'az') {
    tags.sort((a, b) => a.tag.name.localeCompare(b.tag.name));
    const chips = document.createElement('div');
    chips.className = 'search-tag-picker-chips';
    tags.forEach(({ id, tag, count }) => chips.appendChild(_makePickerChip(id, tag, count)));
    list.appendChild(chips);
  } else if (_tagPickerSort === 'count') {
    tags.sort((a, b) => b.count - a.count || a.tag.name.localeCompare(b.tag.name));
    const chips = document.createElement('div');
    chips.className = 'search-tag-picker-chips';
    tags.forEach(({ id, tag, count }) => chips.appendChild(_makePickerChip(id, tag, count)));
    list.appendChild(chips);
  } else {
    // group sort
    const groupMap = new Map();
    const noGroup = [];
    for (const entry of tags) {
      const grpId = entry.tag.groupId;
      if (!grpId) { noGroup.push(entry); continue; }
      if (!groupMap.has(grpId)) groupMap.set(grpId, []);
      groupMap.get(grpId).push(entry);
    }
    const tagGroups = state.settings.tagGroups || [];
    const orderedGroups = tagGroups.filter(g => groupMap.has(g.id));
    for (const g of orderedGroups) {
      const header = document.createElement('div');
      header.className = 'search-tag-group-header';
      header.textContent = g.name;
      list.appendChild(header);
      const chips = document.createElement('div');
      chips.className = 'search-tag-picker-chips';
      groupMap.get(g.id).sort((a, b) => a.tag.name.localeCompare(b.tag.name))
        .forEach(({ id, tag, count }) => chips.appendChild(_makePickerChip(id, tag, count)));
      list.appendChild(chips);
    }
    if (noGroup.length) {
      const header = document.createElement('div');
      header.className = 'search-tag-group-header';
      header.textContent = 'Ungrouped';
      list.appendChild(header);
      const chips = document.createElement('div');
      chips.className = 'search-tag-picker-chips';
      noGroup.sort((a, b) => a.tag.name.localeCompare(b.tag.name))
        .forEach(({ id, tag, count }) => chips.appendChild(_makePickerChip(id, tag, count)));
      list.appendChild(chips);
    }
  }
}

function _makePickerChip(id, tag, count) {
  const chip = document.createElement('span');
  chip.className = 'tag-chip';
  chip.dataset.tagId = id;
  chip.textContent = tag.name;
  applyTagColor(chip, id);
  applyChipTooltip(chip, id);
  if (count > 1) {
    const cnt = document.createElement('span');
    cnt.className = 'tag-chip-count';
    cnt.textContent = count;
    chip.appendChild(cnt);
  }
  if (activeTagFilters.has(id)) chip.classList.add('selected');
  return chip;
}

function createSearchResultItem(item, meta = {}) {
  if (item.type === 'folder') return createFolderSearchResultItem(item, meta);
  if (item.type === 'board') return createBoardSearchResultItem(item, meta);

  const el = document.createElement('a');
  el.className = 'board-column-item bookmark-item';
  el.href = item.url || '#';
  el.target = '_blank';
  el.rel = 'noreferrer noopener';
  el.draggable = false;
  el.dataset.tooltip = buildTooltip(item);
  el.addEventListener('contextmenu', e => handleSearchResultContextMenu(e, item, meta));

  const header = document.createElement('div');
  header.className = 'item-header';
  const favicon = document.createElement('span');
  favicon.className = 'bookmark-favicon';
  if (item.url) {
    const img = document.createElement('img');
    setFavicon(img, item, 64);
    img.alt = '';
    img.draggable = false;
    favicon.appendChild(img);
  }
  header.appendChild(favicon);
  const name = document.createElement('span');
  name.className = 'bookmark-label';
  name.textContent = item.title || item.url || 'Untitled';
  header.appendChild(name);
  el.appendChild(header);

  if (item.url) {
    const urlEl = document.createElement('span');
    urlEl.className = 'search-result-url';
    urlEl.textContent = item.url;
    el.appendChild(urlEl);
  }
  if (item.tags && item.tags.length > 0) {
    const tagsEl = document.createElement('div');
    tagsEl.className = 'item-tag-chips';
    renderTagsInto(tagsEl, item.tags);
    el.appendChild(tagsEl);
  }
  return el;
}

function createFolderSearchResultItem(item, meta = {}) {
  const el = document.createElement('div');
  el.className = 'board-column-item folder-card';
  el.draggable = false;
  el.dataset.tooltip = item.title || 'Untitled Folder';
  el.addEventListener('contextmenu', e => handleSearchResultContextMenu(e, item, meta));

  const header = document.createElement('div');
  header.className = 'item-header';
  header.appendChild(icon(item.collapsed ? 'icon-folder-closed' : 'icon-folder-open'));
  const name = document.createElement('span');
  name.className = 'folder-title';
  name.textContent = item.title || 'Untitled Folder';
  header.appendChild(name);
  el.appendChild(header);

  const allTags = [...(item.sharedTags || []), ...(item.tags || [])];
  if (allTags.length) {
    const tagsEl = document.createElement('div');
    tagsEl.className = 'item-tag-chips';
    renderTagsInto(tagsEl, allTags);
    el.appendChild(tagsEl);
  }
  return el;
}

function createBoardSearchResultItem(item, meta = {}) {
  const el = document.createElement('div');
  el.className = 'board-column-item bookmark-item';
  el.draggable = false;
  el.style.cursor = 'pointer';
  el.dataset.tooltip = item.title || 'Untitled Board';
  el.addEventListener('contextmenu', e => handleSearchResultContextMenu(e, item, meta));
  el.addEventListener('click', () => {
    state.activeBoardId = item.id;
    state.activeCollectionId = null;
    closeSearchModal();
    renderAll();
    saveState();
  });

  const header = document.createElement('div');
  header.className = 'item-header';
  const boardIcon = document.createElement('span');
  boardIcon.className = 'bookmark-favicon';
  boardIcon.appendChild(icon('icon-board-add'));
  header.appendChild(boardIcon);
  const name = document.createElement('span');
  name.className = 'bookmark-label';
  name.textContent = item.title || 'Untitled Board';
  header.appendChild(name);
  el.appendChild(header);

  const allTags = [...(item.sharedTags || []), ...(item.tags || [])];
  if (allTags.length) {
    const tagsEl = document.createElement('div');
    tagsEl.className = 'item-tag-chips';
    renderTagsInto(tagsEl, allTags);
    el.appendChild(tagsEl);
  }

  return el;
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
        link.classList.remove('dragging');
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
      if (item) return;
      if (dragPayload?.area === 'nav') return;
      event.preventDefault();
      event.dataTransfer.dropEffect = dragPayload ? 'move' : 'copy';
      if (!cell.classList.contains('drop-target')) {
        removeDragPlaceholders();
        cell.classList.add('drop-target');
        const preview = dragPayload ? createEssentialSlotPreview() : createExternalSlotPreview();
        if (preview) cell.appendChild(preview);
      }
    });
    cell.addEventListener('dragleave', () => {
      cell.classList.remove('drop-target');
      cell.querySelectorAll('.drag-preview').forEach(el => el.remove());
    });
    cell.addEventListener('drop', event => {
      if (item) { event.preventDefault(); event.stopPropagation(); return; }
      event.preventDefault();
      event.stopPropagation();
      cell.classList.remove('drop-target');
      if (isExternalDrag(event)) {
        const ext = getExternalDrop(event);
        if (ext) openExternalBookmarkModal(ext.url, ext.title, { area: 'essential', slot, item }, ext.faviconCache);
        return;
      }
      handleEssentialSlotDrop(slot);
    });

    elements.essentialsGrid.appendChild(cell);
  }
}

function renderNav() {
  clearNavWidgetTimers();
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

  const boardIcon = document.createElement('span');
  boardIcon.className = 'nav-board-icon';
  boardIcon.appendChild(icon('icon-board'));
  el.appendChild(boardIcon);

  const label = document.createElement('div');
  label.className = 'nav-board-title';
  label.textContent = board.title;
  const info = document.createElement('div');
  info.className = 'nav-board-info';
  info.appendChild(label);
  el.appendChild(info);

  const { bookmarks, folders } = getImportManagerCounts();
  if (bookmarks > 0 || folders > 0) {
    const chips = document.createElement('span');
    chips.className = 'count-chip-row nav-count-chips';
    renderCountChipsInto(chips, { bookmarks, folders });
    el.appendChild(chips);
  }

  el.addEventListener('click', () => {
    state.activeBoardId = board.id;
    closeSearchModal();
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

  if (item.type === 'widget') {
    const def = WIDGET_REGISTRY[item.widgetType];
    el.classList.add('nav-widget-item');
    if (def) {
      const body = document.createElement('div');
      body.className = 'nav-widget-body';
      el.appendChild(body);
      def.render(item, body, 'navpane');
    }
    el.addEventListener('contextmenu', e => {
      e.preventDefault();
      e.stopPropagation();
      handleNavContextMenu(e, item, parent, depth);
    });
    el.addEventListener('dragstart', e => {
      if (e.target.closest('input, textarea, button, label, select')) { e.preventDefault(); return; }
      e.stopPropagation();
      dragPayload = { area: 'nav', itemId: item.id, itemType: 'widget', widgetType: item.widgetType, parentId: parent ? parent.id : null };
      e.dataTransfer.setData('text/plain', item.id);
      e.dataTransfer.effectAllowed = 'move';
      applyDragImage(e, el);
    });
    el.addEventListener('dragend', () => { el.classList.remove('dragging'); dragPayload = null; removeDragPlaceholders(); });
    el.addEventListener('dragover', e => handleNavItemDragOver(e, item, parent));
    el.addEventListener('dragleave', e => {
      if (el.contains(e.relatedTarget)) return;
      el.classList.remove('drop-target', 'drop-position-before', 'drop-position-after');
      el.removeAttribute('data-drop-position');
    });
    el.addEventListener('drop', e => {
      e.preventDefault();
      e.stopPropagation();
      el.classList.remove('drop-target', 'drop-position-before', 'drop-position-after');
      el.removeAttribute('data-drop-position');
      handleNavDrop(e, item, parent);
    });
    return el;
  }

  if (item.type === 'title') el.classList.add(item.title ? 'nav-title' : 'nav-divider');

  if (item.type === 'collection') {
    el.classList.add('nav-collection-item');
    const collIcon = document.createElement('span');
    collIcon.className = 'nav-collection-icon';
    collIcon.appendChild(icon('icon-collection'));
    el.appendChild(collIcon);
    const info = document.createElement('div');
    info.className = 'nav-board-info';
    const titleRow = document.createElement('div');
    titleRow.className = 'nav-title-row';
    const label = document.createElement('div');
    label.className = 'nav-board-title';
    label.textContent = item.title || 'Untitled Collection';
    titleRow.appendChild(label);
    const collectionInboxCounts = getCollectionInboxCounts(item);
    if (collectionInboxCounts.bookmarks + collectionInboxCounts.folders > 0) {
      const indicator = document.createElement('span');
      indicator.className = 'collection-tab-inbox-indicator nav-item-inbox-indicator';
      indicator.title = 'Contained board inbox has items';
      titleRow.appendChild(indicator);
    }
    info.appendChild(titleRow);
    if (item.tags?.length) {
      const tagsEl = document.createElement('div');
      tagsEl.className = 'nav-board-tags';
      renderTagsInto(tagsEl, item.tags);
      info.appendChild(tagsEl);
    }
    el.appendChild(info);
    const isActive = state.activeCollectionId === item.id;
    if (isActive) el.classList.add('is-active');
    el.addEventListener('click', () => {
      state.activeCollectionId = item.id;
      if (!item.boardIds?.length) {
        state.activeBoardId = null;
      } else if (!item.boardIds.includes(state.activeBoardId)) {
        state.activeBoardId = item.boardIds[0];
      }
      closeSearchModal();
      renderAll();
      saveState();
    });
  }

  if (item.type === 'folder') {
    el.classList.add('folder-card');

    const header = document.createElement('div');
    header.className = 'folder-header';

    const collapseBtn = document.createElement('button');
    collapseBtn.type = 'button';
    collapseBtn.className = 'collapse-btn';
    collapseBtn.title = item.collapsed ? 'Expand' : 'Collapse';
    collapseBtn.setAttribute('aria-label', item.collapsed ? 'Expand folder' : 'Collapse folder');
    collapseBtn.appendChild(icon(item.collapsed ? 'icon-folder-closed' : 'icon-folder-open'));
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
    const folderInboxCounts = getNavFolderInboxCounts(item);
    if (folderInboxCounts.bookmarks + folderInboxCounts.folders > 0) {
      const indicator = document.createElement('span');
      indicator.className = 'collection-tab-inbox-indicator nav-folder-inbox-indicator';
      indicator.title = 'Contained board inbox has items';
      header.appendChild(indicator);
    }
    el.appendChild(header);
  } else if (item.type !== 'collection') {
    if (item.type !== 'title' || item.title) {
      if (item.type === 'board') {
        const boardIcon = document.createElement('span');
        boardIcon.className = 'nav-board-icon';
        boardIcon.appendChild(icon('icon-board'));
        el.appendChild(boardIcon);
        const info = document.createElement('div');
        info.className = 'nav-board-info';
        const titleRow = document.createElement('div');
        titleRow.className = 'nav-title-row';
        const label = document.createElement('div');
        label.className = 'nav-board-title';
        label.textContent = item.title || 'Untitled Board';
        titleRow.appendChild(label);
        info.appendChild(titleRow);
        el.appendChild(info);
      } else {
        const label = document.createElement('div');
        label.textContent = item.title || '';
        el.appendChild(label);
      }
    }
  }

  if (item.type === 'board') {
    const board = state.boards.find(b => b.id === item.boardId);
    if (board?.tags?.length) {
      const tagsEl = document.createElement('div');
      tagsEl.className = 'nav-board-tags';
      renderTagsInto(tagsEl, board.tags);
      el.querySelector('.nav-board-info')?.appendChild(tagsEl);
    }
    const { bookmarks: ibm, folders: ifl } = getBoardInboxCounts(board);
    if (ibm + ifl > 0) {
      const indicator = document.createElement('span');
      indicator.className = 'collection-tab-inbox-indicator nav-item-inbox-indicator';
      indicator.title = 'Inbox has items';
      el.querySelector('.nav-title-row')?.appendChild(indicator);
    }
    if (board?.locked) el.classList.add('board-locked');
    const lockBtn = document.createElement('button');
    lockBtn.type = 'button';
    lockBtn.className = 'item-lock-btn' + (board?.locked ? ' is-locked' : '');
    lockBtn.title = board?.locked ? 'Unlock board' : 'Lock board';
    lockBtn.appendChild(icon(board?.locked ? 'icon-lock-closed' : 'icon-lock-open'));
    lockBtn.addEventListener('click', e => {
      e.stopPropagation();
      e.preventDefault();
      if (board) { board.locked = !board.locked; saveState(); renderNav(); if (state.activeBoardId === board.id) renderBoard(); }
    });
    el.appendChild(lockBtn);
    el.addEventListener('click', () => {
      if (item.boardId) {
        state.activeBoardId = item.boardId;
        state.activeCollectionId = null;
        closeSearchModal();
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
    el.classList.remove('dragging');
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
  const collection = state.activeCollectionId
    ? findCollectionById(state.activeCollectionId) || findBoardCollection(state.activeBoardId)
    : null;
  const folder = !collection ? findBoardFolder(state.activeBoardId) : null;
  const board = getActiveBoard();

  // Tab bar — shown for both collection and folder contexts
  const tabBar = elements.collectionTabBar;
  if (collection) {
    tabBar.classList.remove('hidden');
    elements.mainPanel.classList.add('has-context-tabs');
    renderCollectionTabBar(collection);
  } else if (folder) {
    tabBar.classList.remove('hidden');
    elements.mainPanel.classList.add('has-context-tabs');
    renderFolderTabBar(folder);
  } else {
    tabBar.classList.add('hidden');
    elements.mainPanel.classList.remove('has-context-tabs');
  }

  if (!board) {
    elements.mainPanel.classList.add('no-board');
    elements.mainPanel.style.backgroundImage = '';
    elements.boardTitle.textContent = collection ? collection.title : '';
    elements.speedDial.innerHTML = '';
    elements.bookmarkColumns.innerHTML = '';
    lastRenderedBoardId = null;
    if (collection) {
      const speedDialPanel = elements.mainPanel.querySelector('.speed-dial-panel');
      if (speedDialPanel) speedDialPanel.classList.remove('hidden');
      renderSpeedDial(collection, true);
      elements.mainPanel.classList.remove('no-board');
    }
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
  elements.boardTitle.textContent = collection
    ? collection.title
    : folder
      ? board.title
      : board.title;
  elements.bookmarkColumns.style.setProperty('--columns', board.columnCount);
  applyBoardBackground(board);
  elements.boardSettingsBtn.disabled = !!board.locked;
  const inboxUnavailable = !!board.locked || !!board.isImportManager;
  elements.inboxBtn.disabled = inboxUnavailable;
  elements.inboxBtn.classList.toggle('hidden', !!board.isImportManager);
  if (inboxUnavailable && typeof inboxPanelOpen !== 'undefined' && inboxPanelOpen) hideInboxPanel();

  const speedDialPanel = elements.mainPanel.querySelector('.speed-dial-panel');
  if (collection) {
    // Use the collection's speed dial; suppress the board's
    if (speedDialPanel) speedDialPanel.classList.remove('hidden');
    renderSpeedDial(collection, true);
  } else {
    if (speedDialPanel) speedDialPanel.classList.toggle('hidden', board.showSpeedDial === false);
    renderSpeedDial(board, false);
  }

  renderColumns(board);
}

function renderSpeedDial(source, isCollection = false) {
  const board = isCollection ? null : source;
  elements.speedDial.innerHTML = '';
  normalizeSpeedDialSlots(source);
  const slotCount = getSpeedDialSlotCount(source);
  for (let slot = 0; slot < slotCount; slot++) {
    const item = source.speedDial[slot] || null;
    const cell = document.createElement('div');
    cell.className = `speed-slot ${item ? 'filled' : 'empty'}`;
    cell.dataset.slot = slot;
    cell.addEventListener('contextmenu', event => {
      event.preventDefault();
      event.stopPropagation();
      if (item) {
        if (isCollection) handleCollectionSpeedDialContextMenu(event, item, source, slot);
        else if (!getActiveBoard()?.locked) handleSpeedDialContextMenu(event, item, slot);
      } else {
        if (!isCollection && getActiveBoard()?.locked) return;
        contextTarget = isCollection
          ? { area: 'collection-speed-dial', collectionId: source.id, slot }
          : { area: 'speed-dial', slot };
        showContextMenu(event.clientX, event.clientY, [
          { label: 'Add bookmark', action: 'addSpeedDialBookmark' }
        ]);
      }
    });
    cell.addEventListener('dragover', event => handleSpeedDialSlotDragOver(event, source, slot, isCollection));
    cell.addEventListener('dragleave', () => {
      cell.classList.remove('drop-target');
      cell.querySelectorAll('.drag-preview').forEach(el => el.remove());
    });
    cell.addEventListener('drop', event => handleSpeedDialSlotDrop(event, source, slot, isCollection));

    if (!item) {
      elements.speedDial.appendChild(cell);
      continue;
    }

    const link = document.createElement('a');
    link.className = 'speed-link';
    link.dataset.itemId = item.id;
    link.dataset.slot = slot;
    link.href = item.url || '#';
    link.target = '_blank';
    link.rel = 'noreferrer noopener';
    link.draggable = true;
    link.dataset.tooltip = buildTooltip(item, board);

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
      if (!isCollection && board?.locked) { event.preventDefault(); return; }
      event.stopPropagation();
      dragPayload = isCollection
        ? { area: 'collection-speed-dial', itemId: item.id, collectionId: source.id, slot }
        : { area: 'speed-dial', itemId: item.id, slot };
      event.dataTransfer.setData('text/plain', item.id);
      event.dataTransfer.effectAllowed = 'move';
      applyDragImage(event, link);
    });
    link.addEventListener('dragend', () => {
      link.classList.remove('dragging');
      dragPayload = null;
      removeDragPlaceholders();
    });
    cell.appendChild(link);
    elements.speedDial.appendChild(cell);
  }
}

function renderCollectionTabBar(collection) {
  const tabBar = elements.collectionTabBar;
  tabBar.innerHTML = '';

  // Tracks last indicator position key so we only touch the DOM when position changes.
  let _tabIndicatorKey = '';
  const _clearTabIndicator = () => {
    _tabIndicatorKey = '';
    tabBar.querySelectorAll('.tab-drop-indicator').forEach(el => el.remove());
  };

  // Reorder tabs within the collection or accept a nav board drop
  const _tabDragOver = (e, refTab) => {
    if (!dragPayload) return;
    const isTabReorder = dragPayload.area === 'collection-tab' && dragPayload.collectionId === collection.id;
    const isNavBoard = dragPayload.area === 'nav';
    if (!isTabReorder && !isNavBoard) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    const rect = (refTab || tabBar).getBoundingClientRect();
    const pos = refTab && e.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
    // Skip DOM update when position hasn't changed (dragover fires many times per second).
    const key = `${refTab?.dataset?.boardId || 'end'}:${pos}`;
    if (_tabIndicatorKey === key) return;
    _tabIndicatorKey = key;
    const sentinel = refTab ? (pos === 'before' ? refTab : refTab.nextSibling) : null;
    tabBar.querySelectorAll('.tab-drop-indicator').forEach(el => el.remove());
    let ghost;
    if (isTabReorder) {
      const srcTab = tabBar.querySelector(`.collection-tab[data-board-id="${CSS.escape(dragPayload.boardId)}"]`);
      if (srcTab) {
        ghost = srcTab.cloneNode(true);
        ghost.removeAttribute('draggable');
        ghost.classList.remove('dragging', 'active');
      }
    }
    if (!ghost) {
      ghost = document.createElement('div');
      if (isNavBoard && dragPayload.itemId) {
        const navPath = findNavItemPath(dragPayload.itemId);
        const board = navPath?.item?.boardId ? state.boards.find(b => b.id === navPath.item.boardId) : null;
        const lbl = document.createElement('span');
        lbl.textContent = board?.title || navPath?.item?.title || 'Board';
        ghost.appendChild(lbl);
      }
    }
    ghost.className = 'collection-tab tab-drop-indicator';
    tabBar.insertBefore(ghost, sentinel);
  };
  const _tabDrop = (e, refTab) => {
    _clearTabIndicator();
    if (!dragPayload) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = refTab?.getBoundingClientRect();
    const pos = refTab && rect && e.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
    const refBoardId = refTab?.dataset.boardId;

    if (dragPayload.area === 'collection-tab' && dragPayload.collectionId === collection.id) {
      if (dragPayload.boardId === refBoardId) { dragPayload = null; return; }
      pushUndoSnapshot();
      const ids = collection.boardIds || [];
      const fromIdx = ids.indexOf(dragPayload.boardId);
      if (fromIdx === -1) { dragPayload = null; return; }
      ids.splice(fromIdx, 1);
      const toIdx = refBoardId ? ids.indexOf(refBoardId) : ids.length;
      ids.splice(pos === 'after' && refBoardId ? toIdx + 1 : Math.max(0, toIdx), 0, dragPayload.boardId);
      dragPayload = null; renderAll(); saveState(); return;
    }
    if (dragPayload.area === 'nav') {
      const path = findNavItemPath(dragPayload.itemId);
      if (!path || path.item.type !== 'board') { dragPayload = null; return; }
      pushUndoSnapshot();
      const removed = removeNavItemById(dragPayload.itemId);
      if (removed?.boardId) {
        if (!collection.boardIds) collection.boardIds = [];
        const refIdx = refBoardId ? collection.boardIds.indexOf(refBoardId) : -1;
        const insertAt = refIdx === -1 ? collection.boardIds.length : (pos === 'after' ? refIdx + 1 : refIdx);
        collection.boardIds.splice(insertAt, 0, removed.boardId);
        state.activeBoardId = removed.boardId;
        state.activeCollectionId = collection.id;
      }
      dragPayload = null; renderAll(); saveState(); return;
    }
    dragPayload = null;
  };

  (collection.boardIds || []).forEach(boardId => {
    const board = state.boards.find(b => b.id === boardId);
    if (!board) return;
    const tab = document.createElement('div');
    tab.className = 'collection-tab' + (boardId === state.activeBoardId ? ' active' : '');
    tab.dataset.boardId = boardId;
    const tabLabel = document.createElement('span');
    tabLabel.className = 'collection-tab-label';
    tabLabel.textContent = board.title || 'Untitled Board';
    tab.appendChild(tabLabel);
    const counts = getBoardInboxCounts(board);
    if (counts.bookmarks + counts.folders > 0) {
      const indicator = document.createElement('span');
      indicator.className = 'collection-tab-inbox-indicator';
      indicator.title = 'Inbox has items';
      tab.appendChild(indicator);
    }
    tab.addEventListener('click', () => {
      state.activeBoardId = boardId;
      renderAll();
      saveState();
    });
    tab.addEventListener('contextmenu', e => {
      e.preventDefault();
      e.stopPropagation();
      handleCollectionTabContextMenu(e, boardId, collection);
    });
    tab.draggable = true;
    tab.addEventListener('dragstart', e => {
      e.stopPropagation();
      dragPayload = { area: 'collection-tab', boardId, collectionId: collection.id };
      e.dataTransfer.setData('text/plain', boardId);
      e.dataTransfer.effectAllowed = 'move';
      requestAnimationFrame(() => tab.classList.add('dragging'));
    });
    tab.addEventListener('dragend', () => { tab.classList.remove('dragging'); dragPayload = null; removeDragPlaceholders(); _clearTabIndicator(); });
    tab.addEventListener('dragover', e => _tabDragOver(e, tab));
    tab.addEventListener('drop', e => _tabDrop(e, tab));
    tabBar.appendChild(tab);
  });

  // Add board button
  const addBtn = document.createElement('div');
  addBtn.className = 'collection-tab-add';
  addBtn.title = 'Add board to collection';
  addBtn.appendChild(icon('icon-board-add'));
  addBtn.addEventListener('click', () => {
    pushUndoSnapshot();
    createBoardInCollection(collection, 'New Board');
    renderAll();
    saveState();
    showBoardSettingsPanel(true);
  });
  addBtn.addEventListener('contextmenu', e => {
    e.preventDefault();
    e.stopPropagation();
    contextTarget = { area: 'collection-tab-bar', collectionId: collection.id };
    showContextMenu(e.clientX, e.clientY, [{ label: 'Add board', action: 'addBoardToCollection' }]);
  });
  tabBar.appendChild(addBtn);

  // Accept nav board drops anywhere on the tab bar (between tabs or at the end).
  // When the ghost indicator has pointer-events:none, cursor events fall through to tabBar —
  // in that case just accept the drop without repositioning to avoid flicker.
  tabBar.addEventListener('dragover', e => {
    if (e.target.closest('.collection-tab')) return; // handled by individual tab
    if (!dragPayload) return;
    const isTabReorder = dragPayload.area === 'collection-tab' && dragPayload.collectionId === collection.id;
    const isNavBoard = dragPayload.area === 'nav';
    if (!isTabReorder && !isNavBoard) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    if (!tabBar.querySelector('.tab-drop-indicator')) _tabDragOver(e, null);
  });
  tabBar.addEventListener('dragleave', e => {
    if (tabBar.contains(e.relatedTarget)) return;
    _clearTabIndicator();
  });
  tabBar.addEventListener('drop', e => {
    if (e.target.closest('.collection-tab')) return;
    _tabDrop(e, null);
  });
}

function renderFolderTabBar(folder) {
  const tabBar = elements.collectionTabBar;
  tabBar.innerHTML = '';

  const boardNavItems = (folder.children || []).filter(c => c.type === 'board');
  boardNavItems.forEach(navItem => {
    const board = state.boards.find(b => b.id === navItem.boardId);
    const tab = document.createElement('div');
    tab.className = 'collection-tab' + (navItem.boardId === state.activeBoardId ? ' active' : '');
    tab.dataset.boardId = navItem.boardId || '';
    tab.dataset.navItemId = navItem.id;
    const tabLabel = document.createElement('span');
    tabLabel.className = 'collection-tab-label';
    tabLabel.textContent = board?.title || navItem.title || 'Untitled Board';
    tab.appendChild(tabLabel);
    if (board) {
      const counts = getBoardInboxCounts(board);
      if (counts.bookmarks + counts.folders > 0) {
        const indicator = document.createElement('span');
        indicator.className = 'collection-tab-inbox-indicator';
        indicator.title = 'Inbox has items';
        tab.appendChild(indicator);
      }
    }
    if (board?.locked) tab.classList.add('tab-locked');
    tab.addEventListener('click', () => {
      if (!navItem.boardId) return;
      state.activeBoardId = navItem.boardId;
      state.activeCollectionId = null;
      renderAll();
      saveState();
    });
    tab.addEventListener('contextmenu', e => {
      e.preventDefault();
      e.stopPropagation();
      handleFolderTabContextMenu(e, navItem, folder);
    });
    tab.draggable = true;
    tab.addEventListener('dragstart', e => {
      e.stopPropagation();
      dragPayload = { area: 'folder-tab', navItemId: navItem.id, boardId: navItem.boardId, folderId: folder.id };
      e.dataTransfer.setData('text/plain', navItem.boardId || '');
      e.dataTransfer.effectAllowed = 'move';
      requestAnimationFrame(() => tab.classList.add('dragging'));
    });
    tab.addEventListener('dragend', () => { tab.classList.remove('dragging'); dragPayload = null; removeDragPlaceholders(); });
    tabBar.appendChild(tab);
  });

  // Add board button
  const addBtn = document.createElement('div');
  addBtn.className = 'collection-tab-add';
  addBtn.title = 'Add board to folder';
  addBtn.appendChild(icon('icon-board-add'));
  addBtn.addEventListener('click', () => {
    pushUndoSnapshot();
    createBoardInFolder(folder, 'New Board');
    renderAll();
    saveState();
    showBoardSettingsPanel(true);
  });
  addBtn.addEventListener('contextmenu', e => {
    e.preventDefault();
    e.stopPropagation();
    contextTarget = { area: 'folder-tab-bar', folderId: folder.id };
    showContextMenu(e.clientX, e.clientY, [{ label: 'Add board', action: 'addBoardToFolder' }]);
  });
  tabBar.appendChild(addBtn);
}

function renderColumns(board) {
  clearColumnWidgetTimers();
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
