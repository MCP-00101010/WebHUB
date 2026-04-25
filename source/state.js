const STORAGE_KEY = 'morpheus-webhub-state';
const MAX_FAVICON_CACHE_BYTES = 2 * 1024 * 1024;
const DEFAULT_SPEED_DIAL_SLOT_COUNT = 8;

let isDirty = false;

function cloneData(value) {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

const defaultSettings = {
  warnOnClose: false,
  confirmDeleteBoard: false,
  confirmDeleteBookmark: false,
  confirmDeleteFolder: false,
  confirmDeleteTitleDivider: false,
  confirmDeleteTag: false,
  globalFontScale: 'medium',
  globalFontColor: '#e5e7eb',
  globalFontColorFromTheme: true,
  showAdvancedStyleSettings: false,
  styleOverrides: {
    hubName: false,
    boardTitle: false,
    board: false,
    bookmark: false,
    folder: false,
    collection: false,
    title: false
  },
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
  collectionFontSize: 15,
  collectionFontFamily: '',
  collectionBold: false, collectionItalic: false, collectionUnderline: false,
  collectionTextAlign: 'left', collectionColor: '',
  titleColor: '',
  tagGroups: [],
  activeThemeName: 'default-dark',
  customThemes: [],
  speedDialIconSize: 'medium',
  essentialsIconSize: 'medium',
  showEssentials: true,
  essentialsDisplayCount: 10,
  baseTagSuggestions: [
    'work',
    'personal',
    'reference',
    'research',
    'reading',
    'tools',
    'docs',
    'learning',
    'project',
    'archive',
    'priority',
    'later',
    'finance',
    'shopping',
    'media',
    'gaming',
    'development',
    'design',
    'writing',
    'health',
    'travel',
    'news',
    'science',
    'fiction'
  ]
};

const defaultState = {
  activeBoardId: 'board-1',
  activeCollectionId: null,
  hubName: 'Morpheus WebHub',
  lastExported: null,
  tags: [],
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

function migrateStyleSettings(settings) {
  if (!settings.styleOverrides) settings.styleOverrides = cloneData(defaultSettings.styleOverrides);
  else settings.styleOverrides = { ...defaultSettings.styleOverrides, ...settings.styleOverrides };
  if (settings.styleOverridesMigrated) return;

  const differs = (key, fallback) => settings[key] !== undefined && settings[key] !== fallback;
  settings.styleOverrides.hubName = differs('hubNameFontSize', 18) || !!settings.hubNameFontFamily || !!settings.hubNameBold || !!settings.hubNameItalic || !!settings.hubNameUnderline || differs('hubNameTextAlign', 'left') || !!settings.hubNameColor;
  settings.styleOverrides.boardTitle = differs('boardTitleFontSize', 22) || !!settings.boardTitleFontFamily || !!settings.boardTitleBold || !!settings.boardTitleItalic || !!settings.boardTitleUnderline || differs('boardTitleTextAlign', 'left') || !!settings.boardTitleColor;
  settings.styleOverrides.board = differs('boardFontSize', 14) || !!settings.boardFontFamily || !!settings.boardBold || !!settings.boardItalic || !!settings.boardUnderline || differs('boardTextAlign', 'left') || !!settings.boardColor;
  settings.styleOverrides.bookmark = differs('bookmarkFontSize', 14) || !!settings.bookmarkFontFamily || !!settings.bookmarkBold || !!settings.bookmarkItalic || !!settings.bookmarkUnderline || differs('bookmarkTextAlign', 'left') || !!settings.bookmarkColor;
  settings.styleOverrides.folder = differs('folderFontSize', 15) || !!settings.folderFontFamily || !!settings.folderBold || !!settings.folderItalic || !!settings.folderUnderline || differs('folderTextAlign', 'left') || !!settings.folderColor;
  settings.styleOverrides.collection = differs('collectionFontSize', 15) || !!settings.collectionFontFamily || !!settings.collectionBold || !!settings.collectionItalic || !!settings.collectionUnderline || differs('collectionTextAlign', 'left') || !!settings.collectionColor;
  settings.styleOverrides.title = differs('titleFontSize', 12) || differs('titleLineThickness', 1) || !!settings.titleLineColor || differs('titleLineStyle', 'solid') || !!settings.titleFontFamily || !!settings.titleBold || !!settings.titleItalic || !!settings.titleUnderline || !!settings.titleColor;
  settings.styleOverridesMigrated = true;
}

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
    if (item.type === 'collection') {
      if (!item.speedDial) item.speedDial = [];
      normalizeSpeedDialSlots(item);
      for (const sd of item.speedDial) {
        if (!sd) continue;
        if (!sd.type) sd.type = 'bookmark';
        if (!sd.tags) sd.tags = [];
        if (sd.faviconCache === undefined) sd.faviconCache = '';
      }
      if (!item.tags) item.tags = [];
      if (!item.sharedTags) item.sharedTags = [];
      if (!item.boardIds) item.boardIds = [];
      if (item.inheritTags === undefined) item.inheritTags = true;
      if (item.autoRemoveTags === undefined) item.autoRemoveTags = false;
    }
    if (item.children) migrateItems(item.children);
  }
}

// --- Tag ID helpers ---

function getTagById(id) {
  return (state.tags || []).find(t => t.id === id) || null;
}

function createTag(name, groupId = null, color = null) {
  const id = 'tag-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
  const tag = { id, name, groupId, color };
  if (!state.tags) state.tags = [];
  state.tags.push(tag);
  return tag;
}

function deleteTag(id) {
  if (!state.tags) return;
  state.tags = state.tags.filter(t => t.id !== id);
  // Strip the ID from all items that reference it
  const strip = items => { for (const item of (items || [])) { if (item?.tags) item.tags = item.tags.filter(tid => tid !== id); if (item?.sharedTags) item.sharedTags = item.sharedTags.filter(tid => tid !== id); if (item?.children) strip(item.children); } };
  strip(state.essentials);
  for (const board of state.boards) { strip([board]); strip(board.speedDial); for (const col of board.columns) strip(col.items); }
  for (const item of state.navItems) { if (item.type === 'collection') strip([item]); }
}

// --- One-time migration: string-name tags → ID-based tag objects ---

function migrateToIdTags(parsed) {
  if (Array.isArray(parsed.tags)) return; // already migrated

  parsed.tags = [];
  const nameToId = new Map();
  let seq = 0;
  const ts = Date.now();

  function findGroupId(name) {
    for (const g of (parsed.settings?.tagGroups || [])) {
      if ((g.tags || []).includes(name)) return g.id;
    }
    return null;
  }

  function getOrCreate(name) {
    if (nameToId.has(name)) return nameToId.get(name);
    const id = `tag-${ts}-${seq++}`;
    const color = parsed.settings?.tagColors?.[name] || null;
    parsed.tags.push({ id, name, groupId: findGroupId(name), color });
    nameToId.set(name, id);
    return id;
  }

  function migrateItemTags(item) {
    if (!item) return;
    if (Array.isArray(item.tags))       item.tags       = item.tags.map(t => getOrCreate(t));
    if (Array.isArray(item.sharedTags)) item.sharedTags = item.sharedTags.map(t => getOrCreate(t));
    if (item.children) item.children.forEach(migrateItemTags);
    if (item.type === 'collection') (item.speedDial || []).forEach(migrateItemTags);
  }

  for (const board of (parsed.boards || [])) {
    migrateItemTags(board);
    (board.speedDial || []).forEach(migrateItemTags);
    for (const col of (board.columns || [])) col.items.forEach(migrateItemTags);
  }
  (parsed.navItems  || []).forEach(migrateItemTags);
  (parsed.essentials|| []).forEach(migrateItemTags);

  for (const g of (parsed.settings?.tagGroups || [])) delete g.tags;
  if (parsed.settings) delete parsed.settings.tagColors;
}

function collectReferencedBoardIds(items) {
  const ids = new Set();
  for (const item of (items || [])) {
    if (item.type === 'board' && item.boardId) ids.add(item.boardId);
    if (item.type === 'collection') for (const id of (item.boardIds || [])) ids.add(id);
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
      normalizeSpeedDialSlots(board);
      if (!board.sharedTags) board.sharedTags = [];
      if (board.labels && !board.tags) board.tags = board.labels;
      delete board.labels;
      if (!board.tags) board.tags = [];
      if (board.inheritTags === undefined) board.inheritTags = true;
      if (!board.columns.some(c => c.isInbox)) {
        board.columns.push({ id: `${board.id}-inbox`, title: 'Inbox', isInbox: true, items: [] });
      }
      for (const item of (board.speedDial || [])) {
        if (!item) continue;
        if (!item.type) item.type = 'bookmark';
        if (!item.tags) item.tags = [];
        if (item.faviconCache === undefined) item.faviconCache = '';
      }
      for (const col of (board.columns || [])) {
        migrateItems(col.items);
      }
    }
    migrateItems(parsed.navItems);
    if (parsed.activeCollectionId === undefined) parsed.activeCollectionId = null;
    if (!parsed.hubName) parsed.hubName = 'Morpheus WebHub';
    if (!parsed.settings) parsed.settings = { ...defaultSettings };
    else parsed.settings = { ...defaultSettings, ...parsed.settings };
    migrateStyleSettings(parsed.settings);
    // Tag ID migration — must run before essentials migration (which also has tags)
    migrateToIdTags(parsed);
    parsed.tags = parsed.tags || [];
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
  trimFaviconCache();
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

function findCollectionById(collectionId) {
  const path = findNavItemPath(collectionId);
  return path?.item?.type === 'collection' ? path.item : null;
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

function getBoardNavInheritedTags(boardId) {
  const tags = [];
  function collect(items, chain) {
    for (const item of (items || [])) {
      if (item.type === 'board' && item.boardId === boardId) {
        for (const f of chain) if (f.inheritTags !== false && f.sharedTags) tags.push(...f.sharedTags);
        return true;
      }
      if (item.type === 'folder' && item.children) {
        if (collect(item.children, [...chain, item])) return true;
      }
    }
    return false;
  }
  collect(state.navItems, []);
  const collection = findBoardCollection(boardId);
  if (collection?.inheritTags !== false && collection?.sharedTags?.length) tags.push(...collection.sharedTags);
  return [...new Set(tags)];
}

function findNavParentFolder(boardId, list = state.navItems, parent = null) {
  for (const item of list) {
    if (item.type === 'board' && item.boardId === boardId) return parent;
    if (item.type === 'folder' && Array.isArray(item.children)) {
      const found = findNavParentFolder(boardId, item.children, item);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

function collectFolderAncestorTags(board, folderId) {
  if (!folderId || !board) return [];
  const found = findBoardItemInColumns(board, folderId);
  if (!found?.item) return [];
  const parentTags = found.parent ? collectFolderAncestorTags(board, found.parent.id) : [];
  return [...parentTags, ...(found.item.sharedTags || [])];
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

function unfoldBoardItemAncestors(board, itemId) {
  const search = (list) => {
    for (const item of list) {
      if (item.id === itemId) return true;
      if (item.type === 'folder' && Array.isArray(item.children)) {
        if (search(item.children)) {
          item.collapsed = false;
          return true;
        }
      }
    }
    return false;
  };
  for (const column of board.columns) search(column.items);
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

function createBoardRecord(title, options = {}) {
  const id = options.id || `board-${Date.now()}`;
  const columnCount = options.columnCount || 3;
  const columnTitles = options.columnTitles || [];
  const columns = Array.from({ length: columnCount }, (_, i) => ({
    id: `${id}-col-${i + 1}`,
    title: columnTitles[i] || `Column ${i + 1}`,
    items: []
  }));
  columns.push({ id: `${id}-inbox`, title: 'Inbox', isInbox: true, items: [] });
  return {
    id,
    title,
    columnCount,
    backgroundImage: '',
    containerOpacity: 100,
    showSpeedDial: options.showSpeedDial !== false,
    sharedTags: [],
    tags: [],
    inheritTags: true,
    speedDialSlotCount: DEFAULT_SPEED_DIAL_SLOT_COUNT,
    speedDial: [],
    columns,
    ...(options.extra || {})
  };
}

function createBoard(title) {
  const id = `board-${Date.now()}`;
  state.boards.push(createBoardRecord(title, { id }));
  state.activeBoardId = id;
  state.navItems.push({ id: `nav-${id}`, type: 'board', title, boardId: id });
}

function addNavSection(item) {
  item.id = `id-${Date.now()}`;
  if (item.type === 'folder') item.children = [];
  state.navItems.push(item);
}

function addBookmark(title, url, columnId, tags = [], faviconCache = '') {
  if (!isValidUrl(url)) { alert('Please enter a valid URL.'); return; }
  const board = getActiveBoard();
  const column = board.columns.find(col => col.id === columnId) || board.columns[0];
  column.items.push({ id: `bm-${Date.now()}`, type: 'bookmark', title, url: normalizeUrl(url), tags, faviconCache });
}

function addSpeedDialBookmark(title, url, tags = [], faviconCache = '') {
  if (!isValidUrl(url)) { alert('Please enter a valid URL.'); return; }
  const collection = contextTarget?.collectionId
    ? findCollectionById(contextTarget.collectionId)
    : state.activeCollectionId
      ? findCollectionById(state.activeCollectionId)
      : null;
  const target = collection || getActiveBoard();
  if (!target) return;
  const slot = Number.isInteger(contextTarget?.slot) ? contextTarget.slot : firstEmptySpeedDialSlot(target);
  if (!setSpeedDialSlot(target, slot, { id: `bm-${Date.now()}`, type: 'bookmark', title, url: normalizeUrl(url), tags, faviconCache })) {
    alert('That speed dial slot is already occupied.');
  }
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

// --- Context-driven mutations (called from UI handlers) ---

function getBoardForContext(ct) {
  if (ct?.boardId) return state.boards.find(b => b.id === ct.boardId) || getActiveBoard();
  return getActiveBoard();
}

function deleteBoardTarget(contextTarget) {
  if (!contextTarget || contextTarget.area !== 'board-item') return;
  const board = getBoardForContext(contextTarget);
  for (const column of board.columns) {
    const found = findBoardItemInList(column.items, contextTarget.itemId);
    if (found) {
      const index = found.list.findIndex(item => item.id === contextTarget.itemId);
      if (index !== -1) { found.list.splice(index, 1); return; }
    }
  }
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
  const board = getBoardForContext(contextTarget);
  const found = findBoardItemInColumns(board, contextTarget.itemId);
  if (found?.item?.type === 'bookmark') {
    if (normalizeUrl(url) !== found.item.url) found.item.faviconCache = '';
    found.item.title = title;
    found.item.url = normalizeUrl(url);
    found.item.tags = tags;
  }
}

function findBoardCollection(boardId) {
  function search(items) {
    for (const item of (items || [])) {
      if (item.type === 'collection' && (item.boardIds || []).includes(boardId)) return item;
      if (item.children) { const r = search(item.children); if (r) return r; }
    }
    return null;
  }
  return search(state.navItems);
}

function findBoardFolder(boardId) {
  function search(items) {
    for (const item of (items || [])) {
      if (item.type === 'folder' && item.children) {
        for (const child of item.children) {
          if (child.type === 'board' && child.boardId === boardId) return item;
        }
        const r = search(item.children);
        if (r) return r;
      }
    }
    return null;
  }
  return search(state.navItems);
}

function createCollection(title) {
  const id = `col-${Date.now()}`;
  const navItem = { id, type: 'collection', title, speedDialSlotCount: DEFAULT_SPEED_DIAL_SLOT_COUNT, speedDial: [], boardIds: [], tags: [], sharedTags: [], inheritTags: true, autoRemoveTags: false };
  state.navItems.push(navItem);
  state.activeCollectionId = id;
  return navItem;
}

function createBoardInCollection(collection, title) {
  const id = `board-${Date.now()}`;
  state.boards.push(createBoardRecord(title, { id }));
  if (!collection.boardIds) collection.boardIds = [];
  collection.boardIds.push(id);
  state.activeBoardId = id;
  state.activeCollectionId = collection.id;
}

function createBoardInFolder(folder, title) {
  const id = `board-${Date.now()}`;
  state.boards.push(createBoardRecord(title, { id }));
  if (!folder.children) folder.children = [];
  folder.children.push({ id: `nav-${Date.now()}`, type: 'board', title, boardId: id });
  state.activeBoardId = id;
  state.activeCollectionId = null;
  return state.boards.find(b => b.id === id);
}

function trimEssentialsTail() {
  while (state.essentials.length > 0 && !state.essentials[state.essentials.length - 1]) state.essentials.pop();
}

function normalizeSpeedDialSlots(target) {
  if (!target) return;
  if (!Array.isArray(target.speedDial)) target.speedDial = [];
  const currentLength = target.speedDial.length;
  const fallbackCount = Math.max(DEFAULT_SPEED_DIAL_SLOT_COUNT, currentLength);
  target.speedDialSlotCount = Math.max(1, Math.min(48, parseInt(target.speedDialSlotCount, 10) || fallbackCount));
  if (target.speedDialSlotCount < currentLength) target.speedDialSlotCount = currentLength;
}

function getSpeedDialSlotCount(target) {
  normalizeSpeedDialSlots(target);
  return target?.speedDialSlotCount || DEFAULT_SPEED_DIAL_SLOT_COUNT;
}

function firstEmptySpeedDialSlot(target) {
  const count = getSpeedDialSlotCount(target);
  for (let slot = 0; slot < count; slot++) if (!target.speedDial[slot]) return slot;
  return -1;
}

function findSpeedDialSlot(target, itemId) {
  normalizeSpeedDialSlots(target);
  return (target?.speedDial || []).findIndex(item => item?.id === itemId);
}

function setSpeedDialSlot(target, slot, item) {
  normalizeSpeedDialSlots(target);
  if (!target || slot < 0 || slot >= getSpeedDialSlotCount(target) || target.speedDial[slot]) return false;
  while (target.speedDial.length <= slot) target.speedDial.push(null);
  target.speedDial[slot] = item;
  return true;
}

function removeSpeedDialItemById(target, itemId) {
  const slot = findSpeedDialSlot(target, itemId);
  if (slot === -1) return null;
  const item = target.speedDial[slot];
  target.speedDial[slot] = null;
  return item;
}

function setEssential(slot, title, url, tags = [], faviconCache = '', replace = false) {
  if (!isValidUrl(url)) { alert('Please enter a valid URL.'); return false; }
  if (state.essentials[slot] && !replace) { alert('That essentials slot is already occupied.'); return false; }
  const item = { id: `id-${Date.now()}`, type: 'bookmark', title, url: normalizeUrl(url), tags, faviconCache };
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
  const collection = findBoardCollection(board.id);
  if (collection?.inheritTags !== false && collection?.sharedTags?.length) tags.push(...collection.sharedTags);
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
      if (!sd) continue;
      if (sd.url === normalized) return { item: sd, location: `${board.title} (Speed Dial)` };
    }
    for (const col of board.columns) {
      const r = walk(col.items, board.title);
      if (r) return r;
    }
  }
  return null;
}

function getBoardInbox(board) {
  return board?.columns.find(c => c.isInbox) || null;
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
    board = createBoardRecord('Import Manager', {
      id,
      columnCount: 1,
      columnTitles: ['Imports'],
      showSpeedDial: false,
      extra: { isImportManager: true }
    });
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

function editFolder(itemId, title, tags, sharedTags, inheritTags, autoRemoveTags) {
  let item = findBoardItemInColumns(getActiveBoard(), itemId)?.item;
  if (!item) item = findNavItemPath(itemId)?.item;
  if (item?.type === 'folder') {
    item.title = title;
    item.tags = tags;
    item.sharedTags = sharedTags;
    item.inheritTags = inheritTags;
    item.autoRemoveTags = autoRemoveTags;
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
  recentlyDeleted.unshift({ trashId: `trash-${Date.now()}`, item: cloneData(item), source, deletedAt: Date.now() });
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
    const restored = cloneData(item);
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
    if (board) {
      const slot = source.slot ?? firstEmptySpeedDialSlot(board);
      if (!setSpeedDialSlot(board, slot, cloneData(item))) {
        const fallback = firstEmptySpeedDialSlot(board);
        if (fallback !== -1) setSpeedDialSlot(board, fallback, cloneData(item));
      }
    }
  } else if (source.area === 'nav-board') {
    if (item.board) state.boards.push(cloneData(item.board));
    const navItem = cloneData(item.navItem);
    if (source.parentId) {
      const pp = findNavItemPath(source.parentId);
      if (pp?.item?.type === 'folder') { pp.item.children = pp.item.children || []; pp.item.children.push(navItem); return true; }
    }
    state.navItems.push(navItem);
  } else if (source.area === 'collection-board') {
    if (item.board && !state.boards.some(b => b.id === item.board.id)) state.boards.push(cloneData(item.board));
    const coll = findCollectionById(source.collectionId);
    if (coll && item.board) {
      coll.boardIds = coll.boardIds || [];
      if (!coll.boardIds.includes(item.board.id)) coll.boardIds.push(item.board.id);
    } else if (item.board) {
      state.navItems.push({ id: `nav-${item.board.id}`, type: 'board', title: item.board.title, boardId: item.board.id });
    }
  } else if (source.area === 'folder-board') {
    if (item.board && !state.boards.some(b => b.id === item.board.id)) state.boards.push(cloneData(item.board));
    const navItem = item.navItem
      ? cloneData(item.navItem)
      : item.board
        ? { id: `nav-${item.board.id}`, type: 'board', title: item.board.title, boardId: item.board.id }
        : null;
    if (navItem) {
      const pp = findNavItemPath(source.folderId);
      if (pp?.item?.type === 'folder') {
        pp.item.children = pp.item.children || [];
        if (!pp.item.children.some(c => c.id === navItem.id || c.boardId === navItem.boardId)) pp.item.children.push(navItem);
      } else if (!state.navItems.some(ni => ni.id === navItem.id || ni.boardId === navItem.boardId)) {
        state.navItems.push(navItem);
      }
    }
  } else if (source.area === 'nav-item') {
    const restored = cloneData(item);
    if (source.parentId) {
      const pp = findNavItemPath(source.parentId);
      if (pp?.item?.type === 'folder') { pp.item.children = pp.item.children || []; pp.item.children.push(restored); return true; }
    }
    state.navItems.push(restored);
  } else if (source.area === 'board-item') {
    const board = state.boards.find(b => b.id === source.boardId) || getActiveBoard();
    if (board) {
      const col = board.columns.find(c => c.id === source.columnId) || board.columns[0];
      if (col) col.items.push(cloneData(item));
    }
  } else if (source.area === 'collection') {
    const restored = cloneData(item.collection || item);
    for (const board of (item.boards || [])) {
      if (!state.boards.some(b => b.id === board.id)) state.boards.push(cloneData(board));
    }
    state.navItems = state.navItems.filter(ni => !(ni.type === 'board' && (restored.boardIds || []).includes(ni.boardId)));
    state.navItems.push(restored);
  }
  return true;
}

function cleanTrashAfterRestore() {
  const liveIds = new Set();
  const walkItems = (list) => { for (const item of (list || [])) { if (item?.id) liveIds.add(item.id); if (item?.children) walkItems(item.children); } };
  const walkNav = (items) => { for (const ni of (items || [])) { liveIds.add(ni.id); if (ni.type === 'collection') for (const i of (ni.speedDial || [])) if (i?.id) liveIds.add(i.id); if (ni.children) walkNav(ni.children); } };
  for (const board of (state.boards || [])) { liveIds.add(board.id); for (const col of (board.columns || [])) walkItems(col.items); for (const i of (board.speedDial || [])) if (i?.id) liveIds.add(i.id); }
  for (const item of (state.essentials || [])) { if (item?.id) liveIds.add(item.id); }
  walkNav(state.navItems);
  const prev = recentlyDeleted.length;
  recentlyDeleted = recentlyDeleted.filter(e => {
    const id = e.item?.board?.id ?? e.item?.collection?.id ?? e.item?.id;
    return !liveIds.has(id);
  });
  if (recentlyDeleted.length !== prev) saveTrash();
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
