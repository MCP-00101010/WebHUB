const STORAGE_KEY = 'morpheus-webhub-state';

const defaultSettings = {
  bookmarkFontSize: 14,
  showTags: true,
  folderFontSize: 15,
  titleFontSize: 12,
  titleLineThickness: 1,
  boardTitleFontSize: 22,
  boardFontSize: 14
};

const defaultState = {
  activeBoardId: 'board-1',
  hubName: 'Morpheus WebHub',
  settings: { ...defaultSettings },
  essentials: Array(10).fill(null),
  boards: [
    {
      id: 'board-1',
      title: 'Home Board',
      columnCount: 3,
      background: '',
      speedDial: [
        { id: 'sd-1', type: 'bookmark', title: 'Inbox', url: 'https://mail.example.com', tags: [] },
        { id: 'sd-2', type: 'bookmark', title: 'Docs', url: 'https://www.example.com', tags: [] }
      ],
      columns: [
        { id: 'col-1', title: 'Column 1', items: [] },
        { id: 'col-2', title: 'Column 2', items: [] },
        { id: 'col-3', title: 'Column 3', items: [] }
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
    if (item.type === 'bookmark' && !item.tags) item.tags = [];
    if (item.children) migrateItems(item.children);
  }
}

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return defaultState;
  try {
    const parsed = JSON.parse(saved);
    for (const board of (parsed.boards || [])) {
      for (const item of (board.speedDial || [])) {
        if (!item.type) item.type = 'bookmark';
        if (!item.tags) item.tags = [];
      }
      for (const col of (board.columns || [])) {
        migrateItems(col.items);
      }
    }
    migrateItems(parsed.navItems);
    if (!parsed.hubName) parsed.hubName = 'Morpheus WebHub';
    if (!parsed.settings) parsed.settings = { ...defaultSettings };
    else parsed.settings = { ...defaultSettings, ...parsed.settings };
    if (!parsed.essentials) parsed.essentials = Array(10).fill(null);
    while (parsed.essentials.length < 10) parsed.essentials.push(null);
    for (let i = 0; i < parsed.essentials.length; i++) {
      const e = parsed.essentials[i];
      if (e && !e.tags) e.tags = [];
    }
    return parsed;
  } catch (error) {
    console.warn('Failed to parse saved state, resetting', error);
    return defaultState;
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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

function deleteBoardAndNavItem(navItemId, boardId) {
  removeNavItemById(navItemId);
  state.boards = state.boards.filter(b => b.id !== boardId);
  if (state.activeBoardId === boardId) {
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
    background: '',
    speedDial: [],
    columns: [
      { id: `${id}-col-1`, title: 'Column 1', items: [] },
      { id: `${id}-col-2`, title: 'Column 2', items: [] },
      { id: `${id}-col-3`, title: 'Column 3', items: [] }
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
  column.items.push({ id: `bm-${Date.now()}`, type: 'bookmark', title, url: normalizeUrl(url), tags });
}

function addSpeedDialBookmark(title, url, tags = []) {
  if (!isValidUrl(url)) { alert('Please enter a valid URL.'); return; }
  const board = getActiveBoard();
  board.speedDial.push({ id: `bm-${Date.now()}`, type: 'bookmark', title, url: normalizeUrl(url), tags });
}

function addBookmarkItem(type, title, columnId) {
  const board = getActiveBoard();
  const column = board.columns.find(col => col.id === columnId) || board.columns[0];
  const item = { id: `id-${Date.now()}`, type, title };
  if (type === 'folder') item.children = [];
  column.items.push(item);
}

function updateBoardSettings(title, columnCount) {
  const board = getActiveBoard();
  board.title = title;
  board.columnCount = parseInt(columnCount, 10) || 3;
  board.columns = board.columns.slice(0, board.columnCount);
  while (board.columns.length < board.columnCount) {
    board.columns.push({
      id: `col-${Date.now()}-${board.columns.length + 1}`,
      title: `Column ${board.columns.length + 1}`,
      items: []
    });
  }
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
    found.item.title = title;
    found.item.url = normalizeUrl(url);
    found.item.tags = tags;
  }
}

function setEssential(slot, title, url, tags = []) {
  if (!isValidUrl(url)) { alert('Please enter a valid URL.'); return false; }
  state.essentials[slot] = { id: `id-${Date.now()}`, type: 'bookmark', title, url: normalizeUrl(url), tags };
  return true;
}

function removeEssential(slot) {
  state.essentials[slot] = null;
}
