const STORAGE_KEY = 'morpheus-webhub-state';
const MAX_FAVICON_CACHE_BYTES = 2 * 1024 * 1024;

let isDirty = false;

const defaultSettings = {
  warnOnClose: false,
  confirmDeleteBoard: false,
  confirmDeleteBookmark: false,
  confirmDeleteFolder: false,
  confirmDeleteTitleDivider: false,
  bookmarkFontSize: 14,
  bookmarkFontFamily: '',
  bookmarkBold: false, bookmarkItalic: false, bookmarkUnderline: false,
  showTags: true,
  folderFontSize: 15,
  folderFontFamily: '',
  folderBold: false, folderItalic: false, folderUnderline: false,
  titleFontSize: 12,
  titleLineThickness: 1,
  titleLineColor: '',
  titleLineStyle: 'solid',
  titleFontFamily: '',
  titleBold: false, titleItalic: false, titleUnderline: false,
  hubNameFontSize: 18,
  hubNameFontFamily: '',
  hubNameBold: false, hubNameItalic: false, hubNameUnderline: false,
  hubNameTextAlign: 'left', hubNameColor: '',
  boardTitleFontSize: 22,
  boardTitleFontFamily: '',
  boardTitleBold: false, boardTitleItalic: false, boardTitleUnderline: false,
  boardTitleTextAlign: 'left', boardTitleColor: '',
  boardFontSize: 14,
  boardFontFamily: '',
  boardBold: false, boardItalic: false, boardUnderline: false,
  boardTextAlign: 'left', boardColor: '',
  bookmarkTextAlign: 'left', bookmarkColor: '',
  folderTextAlign: 'left', folderColor: '',
  titleColor: '',
  tagColors: {},
  tagGroups: [],
  activeThemeName: 'default-dark',
  customThemes: [],
  speedDialIconSize: 'medium',
  essentialsIconSize: 'medium',
  showEssentials: true,
  essentialsDisplayCount: 10
};

const defaultState = {
  activeBoardId: 'board-1',
  hubName: 'Morpheus WebHub',
  lastExported: null,
  settings: { ...defaultSettings },
  essentials: [],
  boards: [
    {
      id: 'board-1',
      title: 'Home Board',
      columnCount: 3,
      backgroundImage: '',
      containerOpacity: 100,
      sharedTags: [],
      tags: [],
      inheritTags: true,
      speedDial: [
        { id: 'sd-1', type: 'bookmark', title: 'Inbox', url: 'https://mail.example.com', tags: [] },
        { id: 'sd-2', type: 'bookmark', title: 'Docs', url: 'https://www.example.com', tags: [] }
      ],
      columns: [
        { id: 'col-1', title: 'Column 1', items: [] },
        { id: 'col-2', title: 'Column 2', items: [] },
        { id: 'col-3', title: 'Column 3', items: [] },
        { id: 'board-1-inbox', title: 'Inbox', isInbox: true, items: [] }
      ]
    }
  ],
  navItems: [
    { id: 'nav-1', type: 'board', title: 'Home Board', boardId: 'board-1' },
    { id: 'nav-2', type: 'divider' },
    {
      id: 'nav-3',
      type: 'folder',
      title: 'Projects',
      children: [
        { id: 'nav-3-1', type: 'board', title: 'Work Board', boardId: null }
      ]
    }
  ]
};

let state = loadState();

function migrateItems(items) {
  for (const item of (items || [])) {
    if (item.type === 'divider') { item.type = 'title'; item.title = ''; }
    if (item.type === 'bookmark') {
      if (!item.tags) item.tags = [];
      if (item.faviconCache === undefined) item.faviconCache = '';
    }
    if (item.type === 'folder') {
      if (!item.sharedTags) item.sharedTags = [];
      if (item.labels && !item.tags) item.tags = item.labels;
      delete item.labels;
      if (!item.tags) item.tags = [];
      if (item.inheritTags === undefined) item.inheritTags = true;
      if (item.autoRemoveTags === undefined) item.autoRemoveTags = false;
    }
    if (item.children) migrateItems(item.children);
  }
}

function collectReferencedBoardIds(items) {
  const ids = new Set();
  for (const item of (items || [])) {
    if (item.type === 'board' && item.boardId) ids.add(item.boardId);
    if (item.children) for (const id of collectReferencedBoardIds(item.children)) ids.add(id);
  }
  return ids;
}

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return defaultState;
  try {
    const parsed = JSON.parse(saved);
    for (const board of (parsed.boards || [])) {
      if (board.backgroundImage === undefined) board.backgroundImage = '';
      if (board.containerOpacity === undefined) board.containerOpacity = 100;
      if (board.showSpeedDial === undefined) board.showSpeedDial = true;
      if (!board.sharedTags) board.sharedTags = [];
      if (board.labels && !board.tags) board.tags = board.labels;
      delete board.labels;
      if (!board.tags) board.tags = [];
      if (board.inheritTags === undefined) board.inheritTags = true;
      if (!board.columns.some(c => c.isInbox)) {
        board.columns.push({ id: `${board.id}-inbox`, title: 'Inbox', isInbox: true, items: [] });
      }
      for (const item of (board.speedDial || [])) {
        if (!item.type) item.type = 'bookmark';
        if (!item.tags) item.tags = [];
        if (item.faviconCache === undefined) item.faviconCache = '';
      }
      for (const col of (board.columns || [])) {
        migrateItems(col.items);
      }
    }
    migrateItems(parsed.navItems);
    if (!parsed.hubName) parsed.hubName = 'Morpheus WebHub';
    if (!parsed.settings) parsed.settings = { ...defaultSettings };
    else parsed.settings = { ...defaultSettings, ...parsed.settings };
    if (!parsed.settings.tagColors || typeof parsed.settings.tagColors !== 'object') parsed.settings.tagColors = {};
    // Migrate: strip trailing nulls from old fixed-slot saves; preserve interior gaps
    parsed.essentials = parsed.essentials || [];
    while (parsed.essentials.length > 0 && !parsed.essentials[parsed.essentials.length - 1]) parsed.essentials.pop();
    for (const e of parsed.essentials) {
      if (!e) continue;
      if (!e.tags) e.tags = [];
      if (e.faviconCache === undefined) e.faviconCache = '';
    }
    // Remove boards with no nav item referencing them (keep Import Manager)
    const referencedIds = collectReferencedBoardIds(parsed.navItems);
    parsed.boards = (parsed.boards || []).filter(b => referencedIds.has(b.id) || b.isImportManager);
    if (!parsed.boards.some(b => b.id === parsed.activeBoardId)) {
      const first = parsed.boards[0] || null;
      parsed.activeBoardId = first ? first.id : null;
    }
    return parsed;
  } catch (error) {
    console.warn('Failed to parse saved state, resetting', error);
    return defaultState;
  }
}

function saveState() {
  const json = JSON.stringify(state);
  localStorage.setItem(STORAGE_KEY, json);
  isDirty = true;
  if (typeof bridge !== 'undefined' && bridge.isAvailable()) {
    bridge.saveState(json); // fire-and-forget; extension storage is a backup
  }
}

function getActiveBoard() {
  if (!state.activeBoardId) return null;
  return state.boards.find(b => b.id === state.activeBoardId) || null;
}

function isValidUrl(value) {
  if (!value || !value.trim()) return false;
  let v = value.trim();
  if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
  try {
    const url = new URL(v);
    return ['http:', 'https:'].includes(url.protocol) && url.hostname.includes('.');
  } catch {
    return false;
  }
}

function normalizeUrl(value) {
  const v = value.trim();
  return /^https?:\/\//i.test(v) ? v : 'https://' + v;
}

function isDescendant(itemId, targetFolder) {
  if (!targetFolder || targetFolder.type !== 'folder' || !Array.isArray(targetFolder.children)) return false;
  for (const child of targetFolder.children) {
    if (child.id === itemId) return true;
    if (child.type === 'folder' && isDescendant(itemId, child)) return true;
  }
  return false;
}

// --- Nav state ---

function findNavItemPath(itemId, list = state.navItems, parent = null) {
  for (const item of list) {
    if (item.id === itemId) return { list, parent, item };
    if (item.type === 'folder' && Array.isArray(item.children)) {
      const nested = findNavItemPath(itemId, item.children, item);
      if (nested) return nested;
    }
  }
  return null;
}

function findNavBoardItem(boardId, list = state.navItems) {
  for (const item of list) {
    if (item.type === 'board' && item.boardId === boardId) return item;
    if (item.type === 'folder' && Array.isArray(item.children)) {
      const found = findNavBoardItem(boardId, item.children);
      if (found) return found;
    }
  }
  return null;
}

function findNextNavBoard(list) {
  for (const item of list) {
    if (item.type === 'board' && item.boardId) return item;
    if (item.type === 'folder' && Array.isArray(item.children)) {
      const found = findNextNavBoard(item.children);
      if (found) return found;
    }
  }
  return null;
}

function removeNavItemById(itemId, list = state.navItems) {
  const index = list.findIndex(item => item.id === itemId);
  if (index !== -1) return list.splice(index, 1)[0];
  for (const item of list) {
    if (item.type === 'folder' && Array.isArray(item.children)) {
      const removed = removeNavItemById(itemId, item.children);
      if (removed) return removed;
    }
  }
  return null;
}

function referencedBoardIds() {
  return collectReferencedBoardIds(state.navItems);
}

function deleteBoardAndNavItem(navItemId, boardId) {
  removeNavItemById(navItemId);
  // Remove by explicit boardId and also sweep any boards no longer in nav
  const referenced = referencedBoardIds();
  state.boards = state.boards.filter(b => referenced.has(b.id) || b.isImportManager);
  const activeStillExists = state.boards.some(b => b.id === state.activeBoardId);
  if (!activeStillExists) {
    const next = findNextNavBoard(state.navItems);
    state.activeBoardId = next ? next.boardId : null;
  }
}

function syncBoardTitleInNav(boardId, title) {
  const navItem = findNavBoardItem(boardId);
  if (navItem) navItem.title = title;
}

// --- Board state ---

function findBoardItemInList(list, itemId, parent = null) {
  for (const item of list) {
    if (item.id === itemId) return { item, list, parent };
    if (item.type === 'folder' && Array.isArray(item.children)) {
      const nested = findBoardItemInList(item.children, itemId, item);
      if (nested) return nested;
    }
  }
  return null;
}

function findBoardItemInColumns(board, itemId) {
  for (const column of board.columns) {
    const found = findBoardItemInList(column.items, itemId);
    if (found) return found;
  }
  return null;
}

function removeBoardItemById(itemId) {
  const board = getActiveBoard();
  for (const column of board.columns) {
    const found = findBoardItemInList(column.items, itemId);
    if (found) {
      const index = found.list.findIndex(item => item.id === itemId);
      if (index !== -1) return found.list.splice(index, 1)[0];
    }
  }
  return null;
}

function addBoardItemToColumn(columnId, item) {
  const board = getActiveBoard();
  const column = board.columns.find(col => col.id === columnId);
  if (column) column.items.push(item);
}

// --- Create / add ---

function createBoard(title) {
  const id = `board-${Date.now()}`;
  state.boards.push({
    id,
    title,
    columnCount: 3,
    backgroundImage: '',
    containerOpacity: 100,
    showSpeedDial: true,
    sharedTags: [],
    tags: [],
    inheritTags: true,
    speedDial: [],
    columns: [
      { id: `${id}-col-1`, title: 'Column 1', items: [] },
      { id: `${id}-col-2`, title: 'Column 2', items: [] },
      { id: `${id}-col-3`, title: 'Column 3', items: [] },
      { id: `${id}-inbox`, title: 'Inbox', isInbox: true, items: [] }
    ]
  });
  state.activeBoardId = id;
  state.navItems.push({ id: `nav-${id}`, type: 'board', title, boardId: id });
}

function addNavSection(item) {
  item.id = `id-${Date.now()}`;
  if (item.type === 'folder') item.children = [];
  state.navItems.push(item);
}

function addBookmark(title, url, columnId, tags = []) {
  if (!isValidUrl(url)) { alert('Please enter a valid URL.'); return; }
  const board = getActiveBoard();
  const column = board.columns.find(col => col.id === columnId) || board.columns[0];
  column.items.push({ id: `bm-${Date.now()}`, type: 'bookmark', title, url: normalizeUrl(url), tags, faviconCache: '' });
}

function addSpeedDialBookmark(title, url, tags = []) {
  if (!isValidUrl(url)) { alert('Please enter a valid URL.'); return; }
  const board = getActiveBoard();
  board.speedDial.push({ id: `bm-${Date.now()}`, type: 'bookmark', title, url: normalizeUrl(url), tags, faviconCache: '' });
}

function addBookmarkItem(type, title, columnId, options = {}) {
  const board = getActiveBoard();
  const column = board.columns.find(col => col.id === columnId) || board.columns[0];
  const item = { id: `id-${Date.now()}`, type, title };
  if (type === 'folder') {
    item.children = [];
    item.tags = options.tags || [];
    item.sharedTags = options.sharedTags || [];
    item.inheritTags = options.inheritTags !== undefined ? options.inheritTags : true;
    item.autoRemoveTags = options.autoRemoveTags || false;
  }
  column.items.push(item);
}

function updateBoardSettings(title, columnCount) {
  const board = getActiveBoard();
  board.title = title;
  const newCount = parseInt(columnCount, 10) || 3;
  const regularCols = board.columns.filter(c => !c.isInbox);
  const inboxCol = board.columns.find(c => c.isInbox);
  if (newCount < regularCols.length) {
    const removed = regularCols.slice(newCount);
    const lastKept = regularCols[newCount - 1];
    for (const col of removed) lastKept.items.push(...col.items);
    board.columns = [...regularCols.slice(0, newCount), ...(inboxCol ? [inboxCol] : [])];
  } else {
    while (regularCols.length < newCount) {
      regularCols.push({
        id: `col-${Date.now()}-${regularCols.length + 1}`,
        title: `Column ${regularCols.length + 1}`,
        items: []
      });
    }
    board.columns = [...regularCols, ...(inboxCol ? [inboxCol] : [])];
  }
  board.columnCount = newCount;
  syncBoardTitleInNav(board.id, board.title);
}

// --- Context-driven mutations (called from UI handlers) ---

function deleteBoardTarget(contextTarget) {
  if (!contextTarget || contextTarget.area !== 'board-item') return;
  removeBoardItemById(contextTarget.itemId);
}

function renameContextItem(text, contextTarget) {
  if (!contextTarget) return;
  if (contextTarget.area === 'board-item') {
    const board = getActiveBoard();
    const found = findBoardItemInColumns(board, contextTarget.itemId);
    if (found?.item) found.item.title = text;
  } else if (contextTarget.area === 'nav-item') {
    const path = findNavItemPath(contextTarget.itemId);
    if (path?.item) {
      path.item.title = text;
      if (path.item.type === 'board' && path.item.boardId) {
        const board = state.boards.find(b => b.id === path.item.boardId);
        if (board) board.title = text;
      }
    }
  }
}

function editBookmarkContext(title, url, tags = [], contextTarget) {
  if (!contextTarget || contextTarget.area !== 'board-item') return;
  const board = getActiveBoard();
  const found = findBoardItemInColumns(board, contextTarget.itemId);
  if (found?.item?.type === 'bookmark') {
    if (normalizeUrl(url) !== found.item.url) found.item.faviconCache = '';
    found.item.title = title;
    found.item.url = normalizeUrl(url);
    found.item.tags = tags;
  }
}

function trimEssentialsTail() {
  while (state.essentials.length > 0 && !state.essentials[state.essentials.length - 1]) state.essentials.pop();
}

function setEssential(slot, title, url, tags = []) {
  if (!isValidUrl(url)) { alert('Please enter a valid URL.'); return false; }
  const item = { id: `id-${Date.now()}`, type: 'bookmark', title, url: normalizeUrl(url), tags, faviconCache: '' };
  while (state.essentials.length < slot) state.essentials.push(null);
  state.essentials[slot] = item;
  return true;
}

function removeEssential(slot) {
  state.essentials[slot] = null;
  trimEssentialsTail();
}

// --- Tag inheritance ---

function computeInheritedTags(item, board) {
  if (!board) return [];
  function findParentChain(targetId, items, chain) {
    for (const i of (items || [])) {
      if (i.id === targetId) return chain;
      if (i.type === 'folder' && i.children) {
        const found = findParentChain(targetId, i.children, [...chain, i]);
        if (found) return found;
      }
    }
    return null;
  }
  let chain = null;
  for (const col of (board.columns || [])) {
    chain = findParentChain(item.id, col.items, [board]);
    if (chain) break;
  }
  if (!chain) return [];
  const tags = [];
  for (const ancestor of chain) {
    if (ancestor.inheritTags !== false && ancestor.sharedTags) tags.push(...ancestor.sharedTags);
  }
  return [...new Set(tags)];
}

// --- Bookmark management utilities ---

function findDuplicateUrl(url) {
  if (!url || !url.trim()) return null;
  const normalized = normalizeUrl(url);
  const walk = (items, location) => {
    for (const item of (items || [])) {
      if (item?.type === 'bookmark' && item.url === normalized) return { item, location };
      if (item?.children) { const r = walk(item.children, location); if (r) return r; }
    }
    return null;
  };
  for (const e of state.essentials) {
    if (e?.type === 'bookmark' && e.url === normalized) return { item: e, location: 'Essentials' };
  }
  for (const board of state.boards) {
    for (const sd of board.speedDial) {
      if (sd.url === normalized) return { item: sd, location: `${board.title} (Speed Dial)` };
    }
    for (const col of board.columns) {
      const r = walk(col.items, board.title);
      if (r) return r;
    }
  }
  return null;
}

function getKnownTags() {
  const tags = new Set();
  const walk = (items) => {
    for (const item of (items || [])) {
      if (item?.tags) item.tags.forEach(t => tags.add(t));
      if (item?.sharedTags) item.sharedTags.forEach(t => tags.add(t));
      if (item?.children) walk(item.children);
    }
  };
  walk(state.essentials);
  for (const board of state.boards) {
    if (board.sharedTags) board.sharedTags.forEach(t => tags.add(t));
    if (board.tags) board.tags.forEach(t => tags.add(t));
    walk(board.speedDial);
    for (const col of board.columns) walk(col.items);
  }
  return Array.from(tags).sort();
}

function getBoardInbox(board) {
  return board?.columns.find(c => c.isInbox) || null;
}

function getBoardInboxCount(board) {
  return getBoardInbox(board)?.items.length || 0;
}

function getBoardInboxCounts(board) {
  const inbox = getBoardInbox(board);
  if (!inbox) return { bookmarks: 0, folders: 0 };
  return {
    bookmarks: countItemsRecursive(inbox.items, 'bookmark'),
    folders:   countItemsRecursive(inbox.items, 'folder')
  };
}

function getImportManagerBoard() {
  return state.boards.find(b => b.isImportManager) || null;
}

function getOrCreateImportManagerBoard() {
  let board = getImportManagerBoard();
  if (!board) {
    const id = 'board-import-manager';
    board = {
      id,
      title: 'Import Manager',
      isImportManager: true,
      columnCount: 1,
      backgroundImage: '',
      containerOpacity: 100,
      showSpeedDial: false,
      sharedTags: [],
      tags: [],
      inheritTags: true,
      speedDial: [],
      columns: [
        { id: `${id}-col-1`, title: 'Imports', items: [] },
        { id: `${id}-inbox`, title: 'Inbox', isInbox: true, items: [] }
      ]
    };
    state.boards.push(board);
  }
  return board;
}

function importManagerHasItems() {
  const board = getImportManagerBoard();
  return board ? board.columns.filter(c => !c.isInbox).some(c => c.items.length > 0) : false;
}

function countItemsRecursive(items, type = null) {
  let n = 0;
  for (const item of (items || [])) {
    if (!type || item.type === type) n++;
    if (item.children) n += countItemsRecursive(item.children, type);
  }
  return n;
}

function getImportManagerCounts() {
  const board = getImportManagerBoard();
  if (!board) return { bookmarks: 0, folders: 0 };
  const cols = board.columns.filter(c => !c.isInbox);
  return {
    bookmarks: cols.reduce((s, c) => s + countItemsRecursive(c.items, 'bookmark'), 0),
    folders:   cols.reduce((s, c) => s + countItemsRecursive(c.items, 'folder'), 0)
  };
}

function getImportManagerItemCount() {
  const { bookmarks, folders } = getImportManagerCounts();
  return bookmarks + folders;
}

function editFolder(itemId, title, tags, sharedTags, inheritTags, autoRemoveTags) {
  const board = getActiveBoard();
  const found = findBoardItemInColumns(board, itemId);
  if (found?.item?.type === 'folder') {
    found.item.title = title;
    found.item.tags = tags;
    found.item.sharedTags = sharedTags;
    found.item.inheritTags = inheritTags;
    found.item.autoRemoveTags = autoRemoveTags;
  }
}

// --- Undo snapshot ---

function restoreStateSnapshot(jsonStr) {
  state = JSON.parse(jsonStr);
}

// --- Recently deleted (trash) ---

const TRASH_KEY = 'morpheus-webhub-trash';
const MAX_TRASH_ITEMS = 20;

let recentlyDeleted = loadTrash();

function loadTrash() {
  try { return JSON.parse(localStorage.getItem(TRASH_KEY) || '[]'); } catch { return []; }
}

function saveTrash() {
  localStorage.setItem(TRASH_KEY, JSON.stringify(recentlyDeleted));
}

function pushToTrash(item, source) {
  recentlyDeleted.unshift({ trashId: `trash-${Date.now()}`, item: JSON.parse(JSON.stringify(item)), source, deletedAt: Date.now() });
  if (recentlyDeleted.length > MAX_TRASH_ITEMS) recentlyDeleted.length = MAX_TRASH_ITEMS;
  saveTrash();
}

function restoreFromTrash(trashId) {
  const idx = recentlyDeleted.findIndex(e => e.trashId === trashId);
  if (idx === -1) return false;
  const { item, source } = recentlyDeleted[idx];
  recentlyDeleted.splice(idx, 1);
  saveTrash();
  if (source.area === 'essential') {
    const restored = JSON.parse(JSON.stringify(item));
    while (state.essentials.length <= source.slot) state.essentials.push(null);
    if (!state.essentials[source.slot]) {
      state.essentials[source.slot] = restored;
    } else {
      let slot = 0;
      while (slot < state.essentials.length && state.essentials[slot]) slot++;
      while (state.essentials.length < slot) state.essentials.push(null);
      state.essentials[slot] = restored;
    }
  } else if (source.area === 'speed-dial') {
    const board = state.boards.find(b => b.id === source.boardId) || state.boards.find(b => b.id === state.activeBoardId);
    if (board) board.speedDial.push(JSON.parse(JSON.stringify(item)));
  } else if (source.area === 'nav-board') {
    if (item.board) state.boards.push(JSON.parse(JSON.stringify(item.board)));
    const navItem = JSON.parse(JSON.stringify(item.navItem));
    if (source.parentId) {
      const pp = findNavItemPath(source.parentId);
      if (pp?.item?.type === 'folder') { pp.item.children = pp.item.children || []; pp.item.children.push(navItem); return true; }
    }
    state.navItems.push(navItem);
  } else if (source.area === 'nav-item') {
    const restored = JSON.parse(JSON.stringify(item));
    if (source.parentId) {
      const pp = findNavItemPath(source.parentId);
      if (pp?.item?.type === 'folder') { pp.item.children = pp.item.children || []; pp.item.children.push(restored); return true; }
    }
    state.navItems.push(restored);
  } else if (source.area === 'board-item') {
    const board = state.boards.find(b => b.id === source.boardId) || getActiveBoard();
    if (board) {
      const col = board.columns.find(c => c.id === source.columnId) || board.columns[0];
      if (col) col.items.push(JSON.parse(JSON.stringify(item)));
    }
  }
  return true;
}

function removeTrashItem(trashId) {
  const idx = recentlyDeleted.findIndex(e => e.trashId === trashId);
  if (idx !== -1) { recentlyDeleted.splice(idx, 1); saveTrash(); }
}

function clearTrash() {
  recentlyDeleted = [];
  saveTrash();
}

function trimFaviconCache(skipItem = null) {
  const candidates = [];
  const walk = (list) => {
    for (const item of (list || [])) {
      if (item && item.faviconCache && item !== skipItem) candidates.push(item);
      if (item && item.children) walk(item.children);
    }
  };
  walk(state.essentials);
  for (const board of state.boards) {
    walk(board.speedDial);
    for (const col of board.columns) walk(col.items);
  }
  let total = candidates.reduce((s, i) => s + i.faviconCache.length, 0);
  if (skipItem?.faviconCache) total += skipItem.faviconCache.length;
  for (const item of candidates) {
    if (total <= MAX_FAVICON_CACHE_BYTES) break;
    total -= item.faviconCache.length;
    item.faviconCache = '';
  }
}
