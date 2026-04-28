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
  titleColor: '',
  tagGroups: [],
  serviceApiKeys: {
    nasa: ''
  },
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
  activeTabId: 'board-1-tab-1',
  databasePath: '',
  hubName: 'Morpheus WebHub',
  lastExported: null,
  tags: [],
  sets: [],
  importManager: {
    items: [],
    lastImportedAt: null
  },
  settings: { ...defaultSettings },
  essentials: [],
  boards: [
    {
      id: 'board-1',
      title: 'Home Board',
      sharedTags: [],
      tags: [],
      inheritTags: true,
      autoRemoveTags: false,
      showSpeedDial: true,
      speedDialSlotCount: DEFAULT_SPEED_DIAL_SLOT_COUNT,
      speedDial: [
        { id: 'sd-1', type: 'bookmark', title: 'Inbox', url: 'https://mail.example.com', tags: [] },
        { id: 'sd-2', type: 'bookmark', title: 'Docs', url: 'https://www.example.com', tags: [] }
      ],
      tabs: [
        {
          id: 'board-1-tab-1',
          title: 'Home',
          columnCount: 3,
          backgroundImage: '',
          backgroundFit: 'cover',
          containerOpacity: 100,
          sharedTags: [],
          tags: [],
          inheritTags: true,
          autoRemoveTags: false,
          showSetBar: true,
          setBar: [],
          columns: [
            { id: 'col-1', title: 'Column 1', items: [] },
            { id: 'col-2', title: 'Column 2', items: [] },
            { id: 'col-3', title: 'Column 3', items: [] },
            { id: 'board-1-tab-1-inbox', title: 'Inbox', isInbox: true, items: [] }
          ]
        }
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
let sharedDiskBaselineVersion = null;
let sharedDiskBaselinePath = '';
let sharedDiskWritesBlocked = false;
let sharedDiskHasPendingChanges = false;

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
  settings.styleOverrides.title = differs('titleFontSize', 12) || differs('titleLineThickness', 1) || !!settings.titleLineColor || differs('titleLineStyle', 'solid') || !!settings.titleFontFamily || !!settings.titleBold || !!settings.titleItalic || !!settings.titleUnderline || !!settings.titleColor;
  settings.styleOverridesMigrated = true;
}

function migrateServiceApiKeys(settings) {
  if (!settings.serviceApiKeys || typeof settings.serviceApiKeys !== 'object') {
    settings.serviceApiKeys = cloneData(defaultSettings.serviceApiKeys);
    return;
  }
  settings.serviceApiKeys = { ...defaultSettings.serviceApiKeys, ...settings.serviceApiKeys };
  Object.keys(settings.serviceApiKeys).forEach(key => {
    if (typeof settings.serviceApiKeys[key] !== 'string') settings.serviceApiKeys[key] = '';
    else settings.serviceApiKeys[key] = settings.serviceApiKeys[key].trim();
  });
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
    if (item.children) migrateItems(item.children);
  }
}

function normalizeSetItems(items) {
  const out = [];
  const seenUrls = new Set();
  for (const item of (items || [])) {
    if (!item || item.type && item.type !== 'bookmark') continue;
    if (!item.url || !isValidUrl(item.url)) continue;
    const normalizedUrl = normalizeUrl(item.url);
    if (seenUrls.has(normalizedUrl)) continue;
    seenUrls.add(normalizedUrl);
    out.push({
      id: item.id || `set-bm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: 'bookmark',
      title: item.title || normalizedUrl,
      url: normalizedUrl,
      tags: Array.isArray(item.tags) ? item.tags : [],
      faviconCache: typeof item.faviconCache === 'string' ? item.faviconCache : ''
    });
  }
  return out;
}

function normalizeSetRecord(set, index = 0) {
  const createdAt = typeof set?.createdAt === 'string' ? set.createdAt : new Date().toISOString();
  const updatedAt = typeof set?.updatedAt === 'string' ? set.updatedAt : createdAt;
  return {
    id: set?.id || `set-${Date.now()}-${index}`,
    title: (set?.title || '').trim() || 'Untitled Set',
    items: normalizeSetItems(set?.items),
    createdAt,
    updatedAt
  };
}

function normalizeImportManagerState(importManager) {
  const items = cloneData(Array.isArray(importManager?.items) ? importManager.items : []);
  migrateItems(items);
  return {
    items,
    lastImportedAt: typeof importManager?.lastImportedAt === 'string' ? importManager.lastImportedAt : null
  };
}

function touchSet(set) {
  if (set) set.updatedAt = new Date().toISOString();
}

function createSetRecord(title, options = {}) {
  const createdAt = options.createdAt || new Date().toISOString();
  return normalizeSetRecord({
    id: options.id || `set-${Date.now()}`,
    title: (title || '').trim() || 'New Set',
    items: options.items || [],
    createdAt,
    updatedAt: options.updatedAt || createdAt
  });
}

function createSet(title = 'New Set', options = {}) {
  const set = createSetRecord(title, options);
  if (!Array.isArray(state.sets)) state.sets = [];
  state.sets.push(set);
  return set;
}

function findSetById(setId) {
  return (state.sets || []).find(set => set.id === setId) || null;
}

function findSetItemById(set, itemId) {
  if (!set) return null;
  const index = (set.items || []).findIndex(item => item.id === itemId);
  if (index === -1) return null;
  return { item: set.items[index], index };
}

function createSetBookmarkRecord(title, url, tags = [], faviconCache = '') {
  return {
    id: `set-bm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type: 'bookmark',
    title: title || normalizeUrl(url),
    url: normalizeUrl(url),
    tags: Array.isArray(tags) ? [...tags] : [],
    faviconCache: typeof faviconCache === 'string' ? faviconCache : ''
  };
}

function addBookmarkToSet(set, bookmark, options = {}) {
  if (!set || !bookmark?.url || !isValidUrl(bookmark.url)) return { ok: false, reason: 'invalid' };
  const normalizedUrl = normalizeUrl(bookmark.url);
  if ((set.items || []).some(item => item.url === normalizedUrl)) return { ok: false, reason: 'duplicate' };
  const record = createSetBookmarkRecord(bookmark.title || normalizedUrl, normalizedUrl, bookmark.tags || [], bookmark.faviconCache || '');
  if (!Array.isArray(set.items)) set.items = [];
  const index = Number.isInteger(options.index) ? Math.max(0, Math.min(options.index, set.items.length)) : set.items.length;
  set.items.splice(index, 0, record);
  touchSet(set);
  return { ok: true, item: record };
}

function removeSetItemById(set, itemId) {
  if (!set?.items) return null;
  const index = set.items.findIndex(item => item.id === itemId);
  if (index === -1) return null;
  const [removed] = set.items.splice(index, 1);
  touchSet(set);
  return removed;
}

function moveSetItem(set, itemId, targetIndex) {
  if (!set?.items) return false;
  const currentIndex = set.items.findIndex(item => item.id === itemId);
  if (currentIndex === -1) return false;
  const boundedIndex = Math.max(0, Math.min(targetIndex, set.items.length - 1));
  if (currentIndex === boundedIndex) return false;
  const [item] = set.items.splice(currentIndex, 1);
  set.items.splice(boundedIndex, 0, item);
  touchSet(set);
  return true;
}

function deleteSetById(setId) {
  if (!Array.isArray(state.sets)) return false;
  const index = state.sets.findIndex(set => set.id === setId);
  if (index === -1) return false;
  state.sets.splice(index, 1);
  return true;
}

function collectSetUrls(set) {
  return (set?.items || []).filter(item => item?.url).map(item => item.url);
}

function migrateWidgetServiceSettings(parsed) {
  const serviceKeys = parsed.settings?.serviceApiKeys;
  if (!serviceKeys) return;

  const visitItem = item => {
    if (!item) return;
    if (item.type === 'widget' && item.widgetType === 'nasaApod' && item.config && typeof item.config === 'object') {
      const oldKey = typeof item.config.apiKey === 'string' ? item.config.apiKey.trim() : '';
      if (oldKey && !serviceKeys.nasa) serviceKeys.nasa = oldKey;
      delete item.config.apiKey;
      if (item.data?.apodCache && typeof item.data.apodCache === 'object') {
        delete item.data.apodCache.apiKey;
      }
    }
    if (item.children) item.children.forEach(visitItem);
  };

  (parsed.essentials || []).forEach(visitItem);
  (parsed.navItems || []).forEach(visitItem);
  for (const board of (parsed.boards || [])) {
    for (const tab of getBoardTabs(board)) {
      for (const col of (tab.columns || [])) {
        (col.items || []).forEach(visitItem);
      }
    }
  }
}

function getBoardTabs(board) {
  if (!board) return [];
  return Array.isArray(board.tabs) && board.tabs.length ? board.tabs : [board];
}

function ensureBoardTabColumns(tab, fallbackId) {
  const tabId = tab?.id || fallbackId || `tab-${Date.now()}`;
  const requestedCount = Math.max(1, parseInt(tab?.columnCount, 10) || 0);
  const existingColumns = Array.isArray(tab?.columns) ? tab.columns : [];
  const regularColumns = existingColumns.filter(col => !col?.isInbox);
  const inboxColumn = existingColumns.find(col => col?.isInbox) || { id: `${tabId}-inbox`, title: 'Inbox', isInbox: true, items: [] };
  const targetCount = Math.max(requestedCount || regularColumns.length || 3, regularColumns.length || 0, 1);
  while (regularColumns.length < targetCount) {
    regularColumns.push({
      id: `${tabId}-col-${regularColumns.length + 1}`,
      title: `Column ${regularColumns.length + 1}`,
      items: []
    });
  }
  return [...regularColumns, inboxColumn];
}

function normalizeBoardTabRecord(tab, boardId, index = 0) {
  const id = tab?.id || `${boardId}-tab-${index + 1}`;
  const columns = ensureBoardTabColumns({ ...tab, id }, id);
  const normalized = {
    id,
    title: (tab?.title || '').trim() || (index === 0 ? 'Home' : `Tab ${index + 1}`),
    columnCount: columns.filter(col => !col.isInbox).length,
    backgroundImage: typeof tab?.backgroundImage === 'string' ? tab.backgroundImage : '',
    backgroundFit: tab?.backgroundFit === 'contain' ? 'contain' : 'cover',
    containerOpacity: tab?.containerOpacity === undefined ? 100 : tab.containerOpacity,
    sharedTags: Array.isArray(tab?.sharedTags) ? tab.sharedTags : [],
    tags: Array.isArray(tab?.tags) ? tab.tags : [],
    inheritTags: tab?.inheritTags !== false,
    autoRemoveTags: tab?.autoRemoveTags === true,
    showSetBar: tab?.showSetBar !== false,
    setBar: Array.isArray(tab?.setBar) ? [...new Set(tab.setBar.filter(Boolean))] : [],
    columns,
    locked: tab?.locked === true
  };
  for (const col of normalized.columns) {
    if (!Array.isArray(col.items)) col.items = [];
    migrateItems(col.items);
  }
  return normalized;
}

function syncBoardCompatibilityFields(board, preferredTabId = null) {
  if (!board || !Array.isArray(board.tabs) || !board.tabs.length) return board;
  const preferred = preferredTabId
    || (board.id === state?.activeBoardId ? state?.activeTabId : null)
    || board.tabs[0]?.id;
  const tab = board.tabs.find(entry => entry.id === preferred) || board.tabs[0];
  if (!tab) return board;
  board.columnCount = tab.columnCount;
  board.backgroundImage = tab.backgroundImage;
  board.backgroundFit = tab.backgroundFit;
  board.containerOpacity = tab.containerOpacity;
  board.sharedTags = tab.sharedTags;
  board.tags = tab.tags;
  board.inheritTags = tab.inheritTags;
  board.autoRemoveTags = tab.autoRemoveTags;
  board.columns = tab.columns;
  board.locked = tab.locked === true;
  return board;
}

function syncBoardCompatibilityState() {
  for (const board of (state?.boards || [])) {
    syncBoardCompatibilityFields(board);
  }
}

function normalizeBoardRecord(board, index = 0) {
  const id = board?.id || `board-${Date.now()}-${index}`;
  const tabs = Array.isArray(board?.tabs) && board.tabs.length
    ? board.tabs.map((tab, tabIndex) => normalizeBoardTabRecord(tab, id, tabIndex))
    : [normalizeBoardTabRecord({
        id: board?.tabId || `${id}-tab-1`,
        title: board?.tabTitle || board?.title || 'Home',
        columnCount: board?.columnCount,
        backgroundImage: board?.backgroundImage,
        backgroundFit: board?.backgroundFit,
        containerOpacity: board?.containerOpacity,
        sharedTags: board?.sharedTags,
        tags: board?.tags,
        inheritTags: board?.inheritTags,
        autoRemoveTags: board?.autoRemoveTags,
        columns: board?.columns,
        locked: board?.locked
      }, id, 0)];
  const normalized = {
    ...board,
    id,
    title: (board?.title || '').trim() || `Board ${index + 1}`,
    sharedTags: Array.isArray(board?.sharedTags) ? board.sharedTags : [],
    tags: Array.isArray(board?.tags) ? board.tags : [],
    inheritTags: board?.inheritTags !== false,
    autoRemoveTags: board?.autoRemoveTags === true,
    showSpeedDial: board?.showSpeedDial !== false,
    speedDialSlotCount: board?.speedDialSlotCount,
    speedDial: Array.isArray(board?.speedDial) ? board.speedDial : [],
    tabs
  };
  normalizeSpeedDialSlots(normalized);
  for (const item of (normalized.speedDial || [])) {
    if (!item) continue;
    if (!item.type) item.type = 'bookmark';
    if (!item.tags) item.tags = [];
    if (item.faviconCache === undefined) item.faviconCache = '';
  }
  syncBoardCompatibilityFields(normalized, tabs[0]?.id);
  return normalized;
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
  strip(state.sets?.flatMap(set => set.items) || []);
  for (const board of state.boards) {
    strip([board]);
    strip(board.speedDial);
    for (const tab of getBoardTabs(board)) {
      for (const col of (tab.columns || [])) strip(col.items);
    }
  }
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
  }

  for (const board of (parsed.boards || [])) {
    migrateItemTags(board);
    (board.speedDial || []).forEach(migrateItemTags);
    for (const tab of getBoardTabs(board)) {
      for (const col of (tab.columns || [])) col.items.forEach(migrateItemTags);
    }
  }
  (parsed.navItems  || []).forEach(migrateItemTags);
  (parsed.essentials|| []).forEach(migrateItemTags);
  (parsed.sets || []).forEach(set => (set.items || []).forEach(migrateItemTags));
  (parsed.importManager?.items || []).forEach(migrateItemTags);

  for (const g of (parsed.settings?.tagGroups || [])) delete g.tags;
  if (parsed.settings) delete parsed.settings.tagColors;
}

function collectReferencedBoardIds(items) {
  const ids = new Set();
  for (const item of (items || [])) {
    if (item.type === 'board' && item.boardId) ids.add(item.boardId);
    if (item.children) for (const id of collectReferencedBoardIds(item.children)) ids.add(id);
  }
  return ids;
}

function parseStateJson(saved) {
  if (!saved) return cloneData(defaultState);
  try {
    const parsed = JSON.parse(saved);
    if (typeof parsed.databasePath !== 'string') parsed.databasePath = '';
    else parsed.databasePath = parsed.databasePath.trim();
    parsed.activeTabId = typeof parsed.activeTabId === 'string' ? parsed.activeTabId : null;
    parsed.sets = Array.isArray(parsed.sets)
      ? parsed.sets.map((set, index) => normalizeSetRecord(set, index))
      : [];
    parsed.importManager = normalizeImportManagerState(parsed.importManager);
    parsed.boards = Array.isArray(parsed.boards)
      ? parsed.boards.map((board, index) => normalizeBoardRecord(board, index))
      : [];
    const legacyImportBoard = parsed.boards.find(board => board?.isImportManager);
    if (legacyImportBoard) {
      const legacyItems = [];
      for (const tab of getBoardTabs(legacyImportBoard)) {
        for (const col of (tab.columns || [])) {
          if (!col?.isInbox && Array.isArray(col.items) && col.items.length) legacyItems.push(...cloneData(col.items));
        }
      }
      if (legacyItems.length) {
        parsed.importManager.items.push(...legacyItems);
        if (!parsed.importManager.lastImportedAt) parsed.importManager.lastImportedAt = new Date().toISOString();
      }
    }
    migrateItems(parsed.navItems);
    if (!parsed.hubName) parsed.hubName = 'Morpheus WebHub';
    if (!parsed.settings) parsed.settings = { ...defaultSettings };
    else parsed.settings = { ...defaultSettings, ...parsed.settings };
    migrateStyleSettings(parsed.settings);
    migrateServiceApiKeys(parsed.settings);
    migrateWidgetServiceSettings(parsed);
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
    // Remove boards with no nav item referencing them
    const referencedIds = collectReferencedBoardIds(parsed.navItems);
    parsed.boards = (parsed.boards || []).filter(b => referencedIds.has(b.id));
    if (!parsed.boards.some(b => b.id === parsed.activeBoardId)) {
      const first = parsed.boards[0] || null;
      parsed.activeBoardId = first ? first.id : null;
    }
    const activeBoard = parsed.boards.find(b => b.id === parsed.activeBoardId) || parsed.boards[0] || null;
    for (const board of parsed.boards) syncBoardCompatibilityFields(board);
    if (activeBoard) {
      const activeTab = activeBoard.tabs?.find(tab => tab.id === parsed.activeTabId) || activeBoard.tabs?.[0] || null;
      parsed.activeTabId = activeTab?.id || null;
      syncBoardCompatibilityFields(activeBoard, parsed.activeTabId);
    } else {
      parsed.activeTabId = null;
    }
    return parsed;
  } catch (error) {
    console.warn('Failed to parse saved state, resetting', error);
    return cloneData(defaultState);
  }
}

function loadState() {
  return parseStateJson(localStorage.getItem(STORAGE_KEY));
}

function setSharedDiskBaseline(fileInfo, path = state?.databasePath || '') {
  sharedDiskBaselineVersion = fileInfo?.version || null;
  sharedDiskBaselinePath = (path || '').trim();
  sharedDiskWritesBlocked = false;
  sharedDiskHasPendingChanges = false;
}

function resetSharedDiskBaseline(path = state?.databasePath || '') {
  sharedDiskBaselineVersion = null;
  sharedDiskBaselinePath = (path || '').trim();
  sharedDiskWritesBlocked = false;
  sharedDiskHasPendingChanges = false;
}

function getSharedDiskBaselineVersion() {
  return sharedDiskBaselineVersion;
}

function getSharedDiskBaselinePath() {
  return sharedDiskBaselinePath || state?.databasePath || '';
}

function hasPendingSharedDiskChanges() {
  return sharedDiskHasPendingChanges;
}

function sharedDiskSyncIsBlocked() {
  return sharedDiskWritesBlocked;
}

function notifySharedDiskConflict(detail = {}) {
  sharedDiskWritesBlocked = true;
  sharedDiskHasPendingChanges = true;
  window.dispatchEvent(new CustomEvent('morpheus:shared-disk-conflict', {
    detail: {
      ...detail,
      databasePath: detail.databasePath || getSharedDiskBaselinePath()
    }
  }));
}

function serializeStateSnapshot() {
  syncBoardCompatibilityState();
  trimFaviconCache();
  return JSON.stringify(state);
}

function saveState(options = {}) {
  const { skipDiskSync = false } = options;
  const json = serializeStateSnapshot();
  localStorage.setItem(STORAGE_KEY, json);
  isDirty = true;
  if (typeof bridge !== 'undefined' && bridge.isAvailable()) {
    const shouldSyncSharedDisk = !skipDiskSync && bridge.nativeIsAvailable() && !!(state.databasePath || sharedDiskBaselinePath);
    if (shouldSyncSharedDisk && getSharedDiskBaselinePath() !== (state.databasePath || '').trim()) {
      resetSharedDiskBaseline(state.databasePath || '');
    }
    if (shouldSyncSharedDisk && sharedDiskWritesBlocked) return;
    if (shouldSyncSharedDisk) sharedDiskHasPendingChanges = true;
    bridge.saveState(json, {
      expectedVersion: shouldSyncSharedDisk ? sharedDiskBaselineVersion : null
    }).then(result => {
      if (!result?.ok) return;
      if (result.conflict) {
        notifySharedDiskConflict({
          fileInfo: result.fileInfo || null,
          databasePath: result.databasePath || state.databasePath || ''
        });
        return;
      }
      if (shouldSyncSharedDisk && result.fileInfo) {
        setSharedDiskBaseline(result.fileInfo, result.databasePath || state.databasePath || '');
      }
    }).catch(() => {});
  }
}

function getActiveBoard() {
  if (!state.activeBoardId) return null;
  const board = state.boards.find(b => b.id === state.activeBoardId) || null;
  if (board) syncBoardCompatibilityFields(board, state.activeTabId);
  return board;
}

function getActiveBoardContainer() {
  return getActiveBoard();
}

function getBoardTab(board, tabId = null) {
  if (!board) return null;
  if (!Array.isArray(board.tabs) || !board.tabs.length) return board;
  return board.tabs.find(tab => tab.id === (tabId || state.activeTabId)) || board.tabs[0] || null;
}

function getActiveTab() {
  const board = getActiveBoardContainer();
  if (!board) return null;
  const tab = getBoardTab(board, state.activeTabId);
  if (tab) {
    if (state.activeTabId !== tab.id) state.activeTabId = tab.id;
    syncBoardCompatibilityFields(board, tab.id);
  }
  return tab;
}

function findBoardTabById(board, tabId) {
  if (!board || !Array.isArray(board.tabs)) return null;
  return board.tabs.find(tab => tab.id === tabId) || null;
}

function createBoardTab(board, title = 'New Tab', options = {}) {
  if (!board) return null;
  if (!Array.isArray(board.tabs)) board.tabs = [];
  const tab = normalizeBoardTabRecord({
    id: options.id || `${board.id}-tab-${Date.now()}`,
    title,
    columnCount: options.columnCount || 3,
    showSetBar: options.showSetBar,
    setBar: options.setBar,
    columns: options.columns
  }, board.id, board.tabs.length);
  board.tabs.push(tab);
  state.activeTabId = tab.id;
  syncBoardCompatibilityFields(board, tab.id);
  return tab;
}

function removeBoardTab(board, tabId) {
  if (!board || !Array.isArray(board.tabs) || board.tabs.length <= 1) return false;
  const index = board.tabs.findIndex(tab => tab.id === tabId);
  if (index === -1) return false;
  board.tabs.splice(index, 1);
  const fallback = board.tabs[Math.max(0, index - 1)] || board.tabs[0] || null;
  state.activeTabId = fallback?.id || null;
  syncBoardCompatibilityFields(board, state.activeTabId);
  return true;
}

function reorderBoardTab(board, draggedTabId, targetTabId = null, position = 'after') {
  if (!board || !Array.isArray(board.tabs) || board.tabs.length <= 1) return false;
  const fromIndex = board.tabs.findIndex(tab => tab.id === draggedTabId);
  if (fromIndex === -1) return false;
  const [dragged] = board.tabs.splice(fromIndex, 1);
  let insertIndex = board.tabs.length;
  if (targetTabId) {
    const targetIndex = board.tabs.findIndex(tab => tab.id === targetTabId);
    if (targetIndex === -1) {
      board.tabs.splice(fromIndex, 0, dragged);
      return false;
    }
    insertIndex = targetIndex + (position === 'after' ? 1 : 0);
  }
  board.tabs.splice(Math.max(0, Math.min(insertIndex, board.tabs.length)), 0, dragged);
  syncBoardCompatibilityFields(board, state.activeTabId);
  return true;
}

function insertSetLinkIntoTab(tab, setId, targetSetId = null, position = 'after') {
  if (!tab || !setId) return false;
  if (!Array.isArray(tab.setBar)) tab.setBar = [];
  tab.setBar = tab.setBar.filter(id => id !== setId);
  let insertIndex = tab.setBar.length;
  if (targetSetId) {
    const targetIndex = tab.setBar.findIndex(id => id === targetSetId);
    if (targetIndex !== -1) insertIndex = targetIndex + (position === 'after' ? 1 : 0);
  }
  tab.setBar.splice(Math.max(0, Math.min(insertIndex, tab.setBar.length)), 0, setId);
  return true;
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
  state.boards = state.boards.filter(b => referenced.has(b.id));
  const activeStillExists = state.boards.some(b => b.id === state.activeBoardId);
  if (!activeStillExists) {
    const next = findNextNavBoard(state.navItems);
    state.activeBoardId = next ? next.boardId : null;
    state.activeTabId = state.activeBoardId ? (state.boards.find(b => b.id === state.activeBoardId)?.tabs?.[0]?.id || null) : null;
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
  const initialTab = normalizeBoardTabRecord({
    id: options.initialTabId || `${id}-tab-1`,
    title: options.initialTabTitle || title,
    columnCount: options.columnCount || 3,
    columns: options.columns,
    backgroundImage: options.backgroundImage,
    backgroundFit: options.backgroundFit,
    containerOpacity: options.containerOpacity,
    sharedTags: options.tabSharedTags || options.sharedTags,
    tags: options.tabTags || options.tags,
    inheritTags: options.tabInheritTags ?? options.inheritTags,
    autoRemoveTags: options.tabAutoRemoveTags ?? options.autoRemoveTags,
    showSetBar: options.showSetBar,
    setBar: options.setBar,
    locked: options.locked
  }, id, 0);
  const board = {
    id,
    title,
    showSpeedDial: options.showSpeedDial !== false,
    speedDialSlotCount: options.speedDialSlotCount || DEFAULT_SPEED_DIAL_SLOT_COUNT,
    speedDial: Array.isArray(options.speedDial) ? options.speedDial : [],
    sharedTags: Array.isArray(options.sharedTags) ? options.sharedTags : [],
    tags: Array.isArray(options.tags) ? options.tags : [],
    inheritTags: options.inheritTags !== false,
    autoRemoveTags: options.autoRemoveTags === true,
    tabs: [initialTab],
    ...(options.extra || {})
  };
  syncBoardCompatibilityFields(board, initialTab.id);
  normalizeSpeedDialSlots(board);
  return board;
}

function createBoard(title, options = {}) {
  const id = options.id || `board-${Date.now()}`;
  const board = createBoardRecord(title, {
    id,
    showSpeedDial: options.showSpeedDial,
    speedDialSlotCount: options.speedDialSlotCount,
    speedDial: options.speedDial,
    sharedTags: options.sharedTags,
    tags: options.tags,
    inheritTags: options.inheritTags,
    autoRemoveTags: options.autoRemoveTags,
    initialTabTitle: options.initialTabTitle || title
  });
  state.boards.push(board);
  state.activeBoardId = id;
  state.activeTabId = board.tabs?.[0]?.id || null;
  state.navItems.push({ id: `nav-${id}`, type: 'board', title, boardId: id });
  return board;
}

function addNavSection(item) {
  item.id = `id-${Date.now()}`;
  if (item.type === 'folder') item.children = [];
  state.navItems.push(item);
}

function addBookmark(title, url, columnId, tags = [], faviconCache = '') {
  if (!isValidUrl(url)) { alert('Please enter a valid URL.'); return false; }
  const board = getActiveBoard();
  const column = board.columns.find(col => col.id === columnId) || board.columns[0];
  column.items.push({ id: `bm-${Date.now()}`, type: 'bookmark', title, url: normalizeUrl(url), tags, faviconCache });
  return true;
}

function addSpeedDialBookmark(title, url, tags = [], faviconCache = '') {
  if (!isValidUrl(url)) { alert('Please enter a valid URL.'); return false; }
  const target = getActiveBoardContainer();
  if (!target) return false;
  const slot = Number.isInteger(contextTarget?.slot) ? contextTarget.slot : firstEmptySpeedDialSlot(target);
  if (!setSpeedDialSlot(target, slot, { id: `bm-${Date.now()}`, type: 'bookmark', title, url: normalizeUrl(url), tags, faviconCache })) {
    alert('That speed dial slot is already occupied.');
    return false;
  }
  return true;
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
  if (ct?.boardId) {
    const board = state.boards.find(b => b.id === ct.boardId) || getActiveBoardContainer();
    return board || null;
  }
  return getActiveBoardContainer();
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
  } else if (contextTarget.area === 'board-tab') {
    const board = state.boards.find(b => b.id === contextTarget.boardId) || getActiveBoardContainer();
    const tab = findBoardTabById(board, contextTarget.tabId);
    if (tab) {
      tab.title = text;
      syncBoardCompatibilityFields(board, tab.id);
    }
  }
}

function editBookmarkContext(title, url, tags = [], contextTarget) {
  if (!contextTarget || contextTarget.area !== 'board-item') return false;
  if (!isValidUrl(url)) {
    alert('Please enter a valid URL.');
    return false;
  }
  const board = getBoardForContext(contextTarget);
  const found = findBoardItemInColumns(board, contextTarget.itemId);
  if (found?.item?.type === 'bookmark') {
    if (normalizeUrl(url) !== found.item.url) found.item.faviconCache = '';
    found.item.title = title;
    found.item.url = normalizeUrl(url);
    found.item.tags = tags;
    return true;
  }
  return false;
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

function createBoardInFolder(folder, title) {
  const id = `board-${Date.now()}`;
  const board = createBoardRecord(title, { id });
  state.boards.push(board);
  if (!folder.children) folder.children = [];
  folder.children.push({ id: `nav-${Date.now()}`, type: 'board', title, boardId: id });
  state.activeBoardId = id;
  state.activeTabId = board.tabs?.[0]?.id || null;
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

function getBoardInbox(board, tab = null) {
  const sourceTab = tab || (board?.tabs ? getBoardTab(board, tab?.id || state.activeTabId) : null);
  const columns = sourceTab?.columns || board?.columns || [];
  return columns.find(c => c.isInbox) || null;
}

function getBoardInboxCounts(board, tab = null) {
  const inbox = getBoardInbox(board, tab);
  if (!inbox) return { bookmarks: 0, folders: 0 };
  return {
    bookmarks: countItemsRecursive(inbox.items, 'bookmark'),
    folders:   countItemsRecursive(inbox.items, 'folder')
  };
}

function importManagerHasItems() {
  return Array.isArray(state.importManager?.items) && state.importManager.items.length > 0;
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
  const items = state.importManager?.items || [];
  return {
    bookmarks: countItemsRecursive(items, 'bookmark'),
    folders:   countItemsRecursive(items, 'folder')
  };
}

function findImportManagerItemInList(list, itemId, parent = null) {
  for (const item of (list || [])) {
    if (item.id === itemId) return { item, list, parent };
    if (item.type === 'folder' && Array.isArray(item.children)) {
      const nested = findImportManagerItemInList(item.children, itemId, item);
      if (nested) return nested;
    }
  }
  return null;
}

function findImportManagerItemById(itemId) {
  return findImportManagerItemInList(state.importManager?.items || [], itemId);
}

function removeImportManagerItemById(itemId, list = state.importManager?.items || []) {
  const index = list.findIndex(item => item?.id === itemId);
  if (index !== -1) return list.splice(index, 1)[0];
  for (const item of list) {
    if (item?.type === 'folder' && Array.isArray(item.children)) {
      const removed = removeImportManagerItemById(itemId, item.children);
      if (removed) return removed;
    }
  }
  return null;
}

function collectSelectedImportManagerItems(selectionIds, list = state.importManager?.items || [], ancestorSelected = false, out = []) {
  const selectedSet = selectionIds instanceof Set ? selectionIds : new Set(selectionIds || []);
  for (const item of (list || [])) {
    const isSelected = selectedSet.has(item?.id);
    if (isSelected && !ancestorSelected) {
      out.push(item);
      continue;
    }
    if (item?.type === 'folder' && Array.isArray(item.children) && item.children.length) {
      collectSelectedImportManagerItems(selectedSet, item.children, ancestorSelected || isSelected, out);
    }
  }
  return out;
}

function clearImportManager() {
  if (!state.importManager) state.importManager = { items: [], lastImportedAt: null };
  state.importManager.items = [];
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
  state = parseStateJson(jsonStr);
}

// --- Recently deleted (trash) ---

const TRASH_KEY = 'morpheus-webhub-trash';
const MAX_TRASH_ITEMS = 20;

let recentlyDeleted = loadTrash();

function loadTrash() {
  try { return JSON.parse(localStorage.getItem(TRASH_KEY) || '[]'); } catch { return []; }
}

function saveTrash() {
  const tryStore = data => {
    try { localStorage.setItem(TRASH_KEY, JSON.stringify(data)); return true; }
    catch (e) { if (e.name !== 'QuotaExceededError') throw e; return false; }
  };
  if (tryStore(recentlyDeleted)) return;
  // Strip large backgroundImages to reclaim space
  const slim = recentlyDeleted.map(e => {
    const b = e.item?.board;
    if (!b?.backgroundImage) return e;
    return { ...e, item: { ...e.item, board: { ...b, backgroundImage: '' } } };
  });
  if (tryStore(slim)) return;
  // Drop oldest entries one by one until it fits
  for (let i = slim.length - 1; i > 0; i--) {
    if (tryStore(slim.slice(0, i))) return;
  }
  localStorage.removeItem(TRASH_KEY);
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
  }
  return true;
}

function cleanTrashAfterRestore() {
  const liveIds = new Set();
  const walkItems = (list) => { for (const item of (list || [])) { if (item?.id) liveIds.add(item.id); if (item?.children) walkItems(item.children); } };
  const walkNav = (items) => { for (const ni of (items || [])) { liveIds.add(ni.id); if (ni.children) walkNav(ni.children); } };
  for (const board of (state.boards || [])) { liveIds.add(board.id); for (const col of (board.columns || [])) walkItems(col.items); for (const i of (board.speedDial || [])) if (i?.id) liveIds.add(i.id); }
  for (const item of (state.essentials || [])) { if (item?.id) liveIds.add(item.id); }
  walkNav(state.navItems);
  const prev = recentlyDeleted.length;
  recentlyDeleted = recentlyDeleted.filter(e => {
    const id = e.item?.board?.id ?? e.item?.id;
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
  walk(state.importManager?.items || []);
  let total = candidates.reduce((s, i) => s + i.faviconCache.length, 0);
  if (skipItem?.faviconCache) total += skipItem.faviconCache.length;
  for (const item of candidates) {
    if (total <= MAX_FAVICON_CACHE_BYTES) break;
    total -= item.faviconCache.length;
    item.faviconCache = '';
  }
}
