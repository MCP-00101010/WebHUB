const STORAGE_KEY = 'morpheus-webhub-state';
const LOCAL_CACHE_META_KEY = 'morpheus-webhub-state-meta';
const MAX_FAVICON_CACHE_BYTES = 2 * 1024 * 1024;
const DEFAULT_SPEED_DIAL_SLOT_COUNT = 8;
const COLLAPSED_SIDEBAR_WIDTH = 10;
const EXPANDED_SIDEBAR_WIDTH = 320;
const SHARED_DISK_SAVE_DEBOUNCE_MS = 250;

let isDirty = false;

function cloneData(value) {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

const defaultThemeStyleSettings = {
  globalFontScale: 'medium',
  globalFontColor: '#e5e7eb',
  globalFontColorFromTheme: true,
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
  folderFontSize: 15,
  folderFontFamily: '',
  folderBold: false, folderItalic: false, folderUnderline: false,
  titleFontSize: 12,
  titleLineThickness: 1,
  titleLineColor: '',
  titleLineColorFromTheme: false,
  titleLineStyle: 'solid',
  titleFontFamily: '',
  titleBold: false, titleItalic: false, titleUnderline: false,
  hubNameFontSize: 18,
  hubNameFontFamily: '',
  hubNameBold: false, hubNameItalic: false, hubNameUnderline: false,
  hubNameTextAlign: 'left', hubNameColor: '', hubNameColorFromTheme: false,
  boardTitleFontSize: 22,
  boardTitleFontFamily: '',
  boardTitleBold: false, boardTitleItalic: false, boardTitleUnderline: false,
  boardTitleTextAlign: 'left', boardTitleColor: '', boardTitleColorFromTheme: false,
  boardFontSize: 14,
  boardFontFamily: '',
  boardBold: false, boardItalic: false, boardUnderline: false,
  boardTextAlign: 'left', boardColor: '', boardColorFromTheme: false,
  bookmarkTextAlign: 'left', bookmarkColor: '', bookmarkColorFromTheme: false,
  folderTextAlign: 'left', folderColor: '', folderColorFromTheme: false,
  titleColor: '', titleColorFromTheme: false
};

const THEME_STYLE_COLOR_FALLBACKS = Object.freeze({
  hubNameColor: 'var(--accent)',
  boardTitleColor: 'var(--accent)',
  boardColor: 'var(--accent)',
  bookmarkColor: 'var(--accent)',
  folderColor: 'var(--accent)',
  titleColor: 'var(--accent)',
  titleLineColor: 'var(--accent)'
});

const THEME_STYLE_SETTING_KEYS = Object.freeze(Object.keys(defaultThemeStyleSettings));

const defaultSettings = {
  warnOnClose: false,
  confirmDeleteBoard: false,
  confirmDeleteTab: false,
  confirmDeleteSet: false,
  confirmDeleteBookmark: false,
  confirmDeleteFolder: false,
  confirmDeleteTitleDivider: false,
  confirmDeleteTag: false,
  showBookmarkTooltips: true,
  sharedAutoRefreshNotice: true,
  showAdvancedStyleSettings: false,
  ...cloneData(defaultThemeStyleSettings),
  showBookmarkTags: true,
  showFolderTags: true,
  tagGroups: [],
  serviceApiKeys: {
    nasa: ''
  },
  activeThemeName: 'default-dark',
  customThemes: [],
  deletedThemeIds: [],
  themeStyleProfiles: {},
  speedDialIconSize: 'medium',
  essentialsIconSize: 'medium',
  showEssentials: true,
  essentialsDisplayCount: 10,
  sidebarUseActiveTabOpacity: true,
  sidebarOpacity: 100,
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
      wrapTabBar: false,
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
          showSetBar: true,
          setBar: [],
          columns: [
            { id: 'col-1', title: 'Column 1', items: [] },
            { id: 'col-2', title: 'Column 2', items: [] },
            { id: 'col-3', title: 'Column 3', items: [] }
          ],
          inbox: { id: 'board-1-tab-1-inbox', title: 'Inbox', isInbox: true, items: [] }
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

let state = cloneData(defaultState);
let sharedDiskBaselineVersion = null;
let sharedDiskBaselineHash = '';
let sharedDiskBaselinePath = '';
let sharedDiskWritesBlocked = false;
let sharedDiskHasPendingChanges = false;
let sharedDiskSaveInFlight = false;
let sharedDiskQueuedSnapshot = null;
let sharedDiskQueuedPath = '';
let sharedDiskQueuedSequence = 0;
let sharedDiskFlushTimer = null;
let sharedDiskSaveGeneration = 0;
let sharedDiskSaveSequence = 0;
let sharedDiskSaveWaiters = [];
let localStateMutationSequence = 0;
let localCacheMeta = loadLocalCacheMeta();
let localCacheQuotaNoticeShown = false;
let inheritedTagContextCache = new WeakMap();
let boardNavInheritedTagsCache = new Map();
let liveBookmarkSourceCache = null;

function invalidateDerivedCaches() {
  inheritedTagContextCache = new WeakMap();
  boardNavInheritedTagsCache = new Map();
  liveBookmarkSourceCache = null;
}

function normalizeLocalCacheMeta(meta) {
  return {
    cachedAt: typeof meta?.cachedAt === 'string' ? meta.cachedAt : null,
    source: meta?.source === 'shared' ? 'shared' : 'local',
    snapshotHash: typeof meta?.snapshotHash === 'string' ? meta.snapshotHash : '',
    databasePath: typeof meta?.databasePath === 'string' ? meta.databasePath.trim() : '',
    sharedBaselineVersion: meta?.sharedBaselineVersion ?? null,
    sharedBaselinePath: typeof meta?.sharedBaselinePath === 'string' ? meta.sharedBaselinePath.trim() : '',
    sharedSeenAt: typeof meta?.sharedSeenAt === 'string' ? meta.sharedSeenAt : null
  };
}

function loadLocalCacheMeta() {
  try {
    return normalizeLocalCacheMeta(JSON.parse(localStorage.getItem(LOCAL_CACHE_META_KEY) || 'null'));
  } catch {
    return normalizeLocalCacheMeta(null);
  }
}

function computeSnapshotHash(text) {
  const value = String(text || '');
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function jsonValuesMatch(left, right) {
  const pending = [[left, right]];
  while (pending.length) {
    const [leftValue, rightValue] = pending.pop();
    if (Object.is(leftValue, rightValue)) continue;
    if (
      leftValue === null || rightValue === null ||
      typeof leftValue !== 'object' || typeof rightValue !== 'object'
    ) return false;

    const leftIsArray = Array.isArray(leftValue);
    if (leftIsArray !== Array.isArray(rightValue)) return false;
    if (leftIsArray) {
      if (leftValue.length !== rightValue.length) return false;
      for (let i = 0; i < leftValue.length; i++) pending.push([leftValue[i], rightValue[i]]);
      continue;
    }

    const leftKeys = Object.keys(leftValue);
    const rightKeys = Object.keys(rightValue);
    if (leftKeys.length !== rightKeys.length) return false;
    for (const key of leftKeys) {
      if (!Object.prototype.hasOwnProperty.call(rightValue, key)) return false;
      pending.push([leftValue[key], rightValue[key]]);
    }
  }
  return true;
}

function snapshotsMatch(left, right) {
  const leftSnapshot = String(left || '');
  const rightSnapshot = String(right || '');
  if (computeSnapshotHash(leftSnapshot) === computeSnapshotHash(rightSnapshot)) return true;
  try {
    return jsonValuesMatch(JSON.parse(leftSnapshot), JSON.parse(rightSnapshot));
  } catch {
    return false;
  }
}

function isStorageQuotaError(error) {
  return error?.name === 'QuotaExceededError' ||
    error?.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    error?.code === 22 ||
    error?.code === 1014 ||
    /quota/i.test(error?.message || '');
}

function notifyLocalCacheQuota(sharedSaveTarget = false) {
  if (localCacheQuotaNoticeShown) return;
  localCacheQuotaNoticeShown = true;
  const message = sharedSaveTarget
    ? 'Browser cache is full; continuing to save changes to the shared database.'
    : 'Browser storage is full. Changes are kept in this tab, but may not survive a reload until storage is freed or shared storage is available.';
  if (typeof showNotice === 'function') showNotice(message);
  else console.warn(`Morpheus: ${message}`);
}

function clearTrashCacheForQuotaRecovery() {
  try {
    localStorage.removeItem('morpheus-webhub-trash');
    if (Array.isArray(recentlyDeleted)) recentlyDeleted = [];
    if (typeof updateTrashBadge === 'function') updateTrashBadge();
  } catch {}
}

function clearFullLocalCacheSnapshot() {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}

function persistLocalCacheMeta(metaPatch = {}) {
  localCacheMeta = normalizeLocalCacheMeta({ ...localCacheMeta, ...metaPatch });
  try {
    localStorage.setItem(LOCAL_CACHE_META_KEY, JSON.stringify(localCacheMeta));
  } catch (error) {
    console.warn('Morpheus: failed to persist local cache metadata', error);
  }
  return localCacheMeta;
}

function getLocalCacheMeta() {
  return cloneData(localCacheMeta);
}

function migrateStyleSettings(settings) {
  if (!settings.styleOverrides) settings.styleOverrides = cloneData(defaultSettings.styleOverrides);
  else settings.styleOverrides = { ...defaultSettings.styleOverrides, ...settings.styleOverrides };
  if (settings.showBookmarkTags === undefined) settings.showBookmarkTags = settings.showTags !== false;
  if (settings.showFolderTags === undefined) settings.showFolderTags = settings.showTags !== false;
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

function normalizeThemeStyleSettings(style) {
  const normalized = { ...cloneData(defaultThemeStyleSettings), ...(style || {}) };
  normalized.styleOverrides = {
    ...cloneData(defaultThemeStyleSettings.styleOverrides),
    ...(style?.styleOverrides || {})
  };
  Object.keys(defaultThemeStyleSettings.styleOverrides).forEach(section => {
    normalized.styleOverrides[section] = normalized.styleOverrides[section] === true;
  });
  return normalized;
}

function buildLegacyThemeStyleSettings(settings) {
  const legacy = {};
  THEME_STYLE_SETTING_KEYS.forEach(key => {
    if (key === 'styleOverrides') {
      legacy.styleOverrides = cloneData(settings.styleOverrides || defaultThemeStyleSettings.styleOverrides);
      return;
    }
    if (settings[key] !== undefined) legacy[key] = cloneData(settings[key]);
  });
  return normalizeThemeStyleSettings(legacy);
}

function migrateThemeStyleProfiles(settings) {
  const rawProfiles = settings.themeStyleProfiles && typeof settings.themeStyleProfiles === 'object' && !Array.isArray(settings.themeStyleProfiles)
    ? settings.themeStyleProfiles
    : {};
  const normalizedProfiles = {};
  Object.entries(rawProfiles).forEach(([themeId, profile]) => {
    if (typeof themeId !== 'string' || !themeId.trim()) return;
    normalizedProfiles[themeId] = normalizeThemeStyleSettings(profile);
  });
  settings.themeStyleProfiles = normalizedProfiles;

  const activeThemeId = getResolvedThemeId(settings.activeThemeName || defaultSettings.activeThemeName);
  const activeProfile = settings.themeStyleProfiles[activeThemeId];
  if (!settings.themeStyleProfilesMigrated || !activeProfile) {
    const legacyProfile = buildLegacyThemeStyleSettings(settings);
    settings.themeStyleProfiles[activeThemeId] = normalizeThemeStyleSettings({
      ...(activeProfile || {}),
      ...legacyProfile,
      styleOverrides: {
        ...(activeProfile?.styleOverrides || {}),
        ...(legacyProfile.styleOverrides || {})
      }
    });
  }
  settings.themeStyleProfilesMigrated = true;
}

function getThemeStyleProfile(themeId = null, { create = true } = {}) {
  if (!state?.settings) return normalizeThemeStyleSettings(null);
  const resolvedThemeId = getResolvedThemeId(themeId || state.settings.activeThemeName || defaultSettings.activeThemeName);
  if (!state.settings.themeStyleProfiles || typeof state.settings.themeStyleProfiles !== 'object' || Array.isArray(state.settings.themeStyleProfiles)) {
    state.settings.themeStyleProfiles = {};
  }
  let profile = state.settings.themeStyleProfiles[resolvedThemeId];
  if (!profile) {
    if (!create) return normalizeThemeStyleSettings(null);
    profile = normalizeThemeStyleSettings(null);
    state.settings.themeStyleProfiles[resolvedThemeId] = profile;
    return profile;
  }
  const normalized = normalizeThemeStyleSettings(profile);
  state.settings.themeStyleProfiles[resolvedThemeId] = normalized;
  return normalized;
}

function setThemeStyleProfile(themeId, profile) {
  if (!state?.settings) return normalizeThemeStyleSettings(profile);
  const resolvedThemeId = getResolvedThemeId(themeId || state.settings.activeThemeName || defaultSettings.activeThemeName);
  if (!state.settings.themeStyleProfiles || typeof state.settings.themeStyleProfiles !== 'object' || Array.isArray(state.settings.themeStyleProfiles)) {
    state.settings.themeStyleProfiles = {};
  }
  const normalized = normalizeThemeStyleSettings(profile);
  state.settings.themeStyleProfiles[resolvedThemeId] = normalized;
  return normalized;
}

function getActiveThemeStyleSettings(options) {
  return getThemeStyleProfile(state?.settings?.activeThemeName, options);
}

function duplicateThemeStyleProfile(sourceThemeId, targetThemeId) {
  if (!targetThemeId) return normalizeThemeStyleSettings(null);
  const source = getThemeStyleProfile(sourceThemeId, { create: false });
  return setThemeStyleProfile(targetThemeId, cloneData(source));
}

function removeThemeStyleProfile(themeId) {
  if (!state?.settings?.themeStyleProfiles || !themeId) return;
  delete state.settings.themeStyleProfiles[themeId];
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

function normalizeDynamicRuleTagIds(tagIds) {
  if (!Array.isArray(tagIds)) return [];
  return [...new Set(tagIds
    .map(tagId => typeof tagId === 'string' ? tagId.trim() : '')
    .filter(Boolean))];
}

function normalizeDynamicRules(rules) {
  return {
    includeTags: normalizeDynamicRuleTagIds(rules?.includeTags),
    excludeTags: normalizeDynamicRuleTagIds(rules?.excludeTags)
  };
}

const DYNAMIC_SORT_LABELS = Object.freeze({
  source: 'Source order',
  'title-asc': 'Title A → Z',
  'title-desc': 'Title Z → A',
  'url-asc': 'URL A → Z',
  'url-desc': 'URL Z → A'
});

const SERVICE_SECRET_KEYS = Object.freeze({
  nasa: 'service.nasa.apiKey'
});

let serviceSecretCache = Object.fromEntries(Object.keys(SERVICE_SECRET_KEYS).map(key => [key, '']));
let serviceSecretsCanScrubState = false;

function getServiceSecret(serviceName) {
  const value = serviceSecretCache?.[serviceName];
  if (typeof value === 'string' && value) return value.trim();
  const legacy = state?.settings?.serviceApiKeys?.[serviceName];
  return typeof legacy === 'string' ? legacy.trim() : '';
}

function setServiceSecretCache(serviceName, value) {
  if (!Object.prototype.hasOwnProperty.call(SERVICE_SECRET_KEYS, serviceName)) return;
  serviceSecretCache[serviceName] = typeof value === 'string' ? value.trim() : '';
}

function setServiceSecretsCanScrubState(value) {
  serviceSecretsCanScrubState = value === true;
}

function canScrubStoredServiceApiKeys() {
  return serviceSecretsCanScrubState === true;
}

function clearStoredServiceApiKeys(root = state) {
  if (!root?.settings) return;
  if (!root.settings.serviceApiKeys || typeof root.settings.serviceApiKeys !== 'object') {
    root.settings.serviceApiKeys = cloneData(defaultSettings.serviceApiKeys);
  }
  Object.keys(root.settings.serviceApiKeys).forEach(key => {
    root.settings.serviceApiKeys[key] = '';
  });
}

function normalizeDynamicSortMode(mode) {
  return Object.prototype.hasOwnProperty.call(DYNAMIC_SORT_LABELS, mode) ? mode : 'source';
}

function normalizeSetMode(mode) {
  return mode === 'dynamic' ? 'dynamic' : 'manual';
}

function normalizeFolderMode(mode) {
  return mode === 'dynamic' ? 'dynamic' : 'static';
}

function coerceNavFolderModes(items) {
  for (const item of (items || [])) {
    if (!item || item.type !== 'folder') continue;
    item.folderMode = 'static';
    item.rules = normalizeDynamicRules(null);
    item.sortMode = normalizeDynamicSortMode(item.sortMode);
    if (Array.isArray(item.children)) coerceNavFolderModes(item.children);
  }
}

function createFolderRecord(title, options = {}) {
  const folder = {
    id: options.id || `id-${Date.now()}`,
    type: 'folder',
    title: (title || '').trim() || 'New Folder',
    collapsed: options.collapsed === true,
    tags: Array.isArray(options.tags) ? [...options.tags] : [],
    sharedTags: Array.isArray(options.sharedTags) ? [...options.sharedTags] : [],
    children: cloneData(Array.isArray(options.children) ? options.children : []),
    folderMode: normalizeFolderMode(options.folderMode ?? options.mode),
    rules: normalizeDynamicRules(options.rules),
    sortMode: normalizeDynamicSortMode(options.sortMode)
  };
  if (options.locked === true) folder.locked = true;
  migrateItems(folder.children);
  return folder;
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
      if (!Array.isArray(item.children)) item.children = [];
      item.folderMode = normalizeFolderMode(item.folderMode ?? item.mode);
      item.rules = normalizeDynamicRules(item.rules);
      item.sortMode = normalizeDynamicSortMode(item.sortMode);
      delete item.mode;
      delete item.inheritTags;
      delete item.autoRemoveTags;
    }
    if (item.children) migrateItems(item.children);
  }
}

function stripLegacySharedTagToggleFieldsInItems(items) {
  for (const item of (items || [])) {
    if (!item) continue;
    if (item.type === 'folder') {
      delete item.inheritTags;
      delete item.autoRemoveTags;
    }
    if (item.children) stripLegacySharedTagToggleFieldsInItems(item.children);
  }
}

function stripLegacySharedTagToggleFields(root = state) {
  for (const board of (root?.boards || [])) {
    if (!board) continue;
    delete board.inheritTags;
    delete board.autoRemoveTags;
    for (const tab of getBoardTabs(board)) {
      delete tab.inheritTags;
      delete tab.autoRemoveTags;
      for (const col of (tab.columns || [])) stripLegacySharedTagToggleFieldsInItems(col.items);
      stripLegacySharedTagToggleFieldsInItems(getBoardInbox(board, tab)?.items || []);
    }
  }
  stripLegacySharedTagToggleFieldsInItems(root?.navItems || []);
  stripLegacySharedTagToggleFieldsInItems(root?.importManager?.items || []);
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

function generateSetId() {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `set-${uuid}`;
  return `set-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeSetRecord(set, index = 0) {
  const createdAt = typeof set?.createdAt === 'string' ? set.createdAt : new Date().toISOString();
  const updatedAt = typeof set?.updatedAt === 'string' ? set.updatedAt : createdAt;
  return {
    id: set?.id || generateSetId(),
    title: (set?.title || '').trim() || 'Untitled Set',
    mode: normalizeSetMode(set?.mode),
    rules: normalizeDynamicRules(set?.rules),
    sortMode: normalizeDynamicSortMode(set?.sortMode),
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
    id: options.id || generateSetId(),
    title: (title || '').trim() || 'New Set',
    mode: options.mode,
    rules: options.rules,
    sortMode: options.sortMode,
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
  if (isDynamicSet(set)) return { ok: false, reason: 'dynamic' };
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
  if (isDynamicSet(set)) return null;
  if (!set?.items) return null;
  const index = set.items.findIndex(item => item.id === itemId);
  if (index === -1) return null;
  const [removed] = set.items.splice(index, 1);
  touchSet(set);
  return removed;
}

function moveSetItem(set, itemId, targetIndex) {
  if (isDynamicSet(set)) return false;
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

function restoreSetFromTrashItem(item) {
  if (!item) return false;
  if (!Array.isArray(state.sets)) state.sets = [];
  const normalized = normalizeSetRecord(item, state.sets.length);
  if (state.sets.some(set => set.id === normalized.id)) {
    normalized.id = generateSetId();
  }
  state.sets.push(normalized);
  return true;
}

function normalizeRestoredBoardItem(item) {
  if (!item) return null;
  const restored = cloneData(item);
  migrateItems([restored]);
  return restored;
}

function collectSetUrls(set) {
  return resolveSetItems(set).filter(item => item?.url).map(item => item.url);
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
  if (Array.isArray(board.tabs)) return board.tabs;
  return [board];
}

function clearBoardCompatibilityFields(board) {
  if (!board) return;
  board.columnCount = 0;
  board.backgroundImage = '';
  board.backgroundFit = 'cover';
  board.containerOpacity = 100;
  board.columns = [];
  board.inbox = null;
}

function normalizeBoardInboxRecord(inbox, tabId) {
  const normalized = inbox && typeof inbox === 'object'
    ? { ...inbox }
    : { id: `${tabId}-inbox`, title: 'Inbox', isInbox: true, items: [] };
  normalized.id = normalized.id || `${tabId}-inbox`;
  normalized.title = normalized.title || 'Inbox';
  normalized.isInbox = true;
  if (!Array.isArray(normalized.items)) normalized.items = [];
  migrateItems(normalized.items);
  return normalized;
}

function ensureBoardTabColumns(tab, fallbackId) {
  const tabId = tab?.id || fallbackId || `tab-${Date.now()}`;
  const requestedCount = Math.max(1, parseInt(tab?.columnCount, 10) || 0);
  const existingColumns = Array.isArray(tab?.columns) ? tab.columns : [];
  const regularColumns = existingColumns.filter(col => !col?.isInbox);
  const targetCount = Math.max(requestedCount || regularColumns.length || 3, regularColumns.length || 0, 1);
  while (regularColumns.length < targetCount) {
    regularColumns.push({
      id: `${tabId}-col-${regularColumns.length + 1}`,
      title: `Column ${regularColumns.length + 1}`,
      items: []
    });
  }
  return regularColumns;
}

function normalizeBoardTabRecord(tab, boardId, index = 0) {
  const id = tab?.id || `${boardId}-tab-${index + 1}`;
  const columns = ensureBoardTabColumns({ ...tab, id }, id);
  const legacyInbox = Array.isArray(tab?.columns) ? tab.columns.find(col => col?.isInbox) : null;
  const inbox = normalizeBoardInboxRecord(tab?.inbox || legacyInbox, id);
  const normalized = {
    id,
    title: (tab?.title || '').trim() || (index === 0 ? 'Home' : `Tab ${index + 1}`),
    columnCount: columns.length,
    backgroundImage: typeof tab?.backgroundImage === 'string' ? tab.backgroundImage : '',
    backgroundFit: tab?.backgroundFit === 'contain' ? 'contain' : (tab?.backgroundFit === 'fill' ? 'fill' : 'cover'),
    containerOpacity: tab?.containerOpacity === undefined ? 100 : tab.containerOpacity,
    sharedTags: Array.isArray(tab?.sharedTags) ? tab.sharedTags : [],
    tags: Array.isArray(tab?.tags) ? tab.tags : [],
    showSetBar: tab?.showSetBar !== false,
    setBar: Array.isArray(tab?.setBar) ? [...new Set(tab.setBar.filter(Boolean))] : [],
    columns,
    inbox,
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
  board.columns = tab.columns;
  board.inbox = tab.inbox;
  return board;
}

function syncBoardCompatibilityState() {
  for (const board of (state?.boards || [])) {
    syncBoardCompatibilityFields(board);
  }
}

function normalizeBoardRecord(board, index = 0) {
  const id = board?.id || `board-${Date.now()}-${index}`;
  const tabs = Array.isArray(board?.tabs)
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
        columns: board?.columns,
        locked: board?.locked
      }, id, 0)];
  const normalized = {
    ...board,
    id,
    title: (board?.title || '').trim() || `Board ${index + 1}`,
    sharedTags: Array.isArray(board?.sharedTags) ? board.sharedTags : [],
    tags: Array.isArray(board?.tags) ? board.tags : [],
    wrapTabBar: board?.wrapTabBar === true,
    showSpeedDial: board?.showSpeedDial !== false,
    speedDialSlotCount: board?.speedDialSlotCount,
    speedDial: Array.isArray(board?.speedDial) ? board.speedDial : [],
    tabs,
    columnCount: Array.isArray(board?.columns) ? board.columns.length : 0,
    backgroundImage: typeof board?.backgroundImage === 'string' ? board.backgroundImage : '',
    backgroundFit: board?.backgroundFit === 'contain' ? 'contain' : (board?.backgroundFit === 'fill' ? 'fill' : 'cover'),
    containerOpacity: board?.containerOpacity === undefined ? 100 : board.containerOpacity,
    columns: Array.isArray(board?.columns) ? board.columns : [],
    inbox: board?.inbox || null
  };
  delete normalized.inheritTags;
  delete normalized.autoRemoveTags;
  normalizeSpeedDialSlots(normalized);
  for (const item of (normalized.speedDial || [])) {
    if (!item) continue;
    if (!item.type) item.type = 'bookmark';
    if (!item.tags) item.tags = [];
    if (item.faviconCache === undefined) item.faviconCache = '';
  }
  if (tabs.length) syncBoardCompatibilityFields(normalized, tabs[0]?.id);
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
      strip(getTabInbox(tab, tab.id)?.items || []);
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
      (getTabInbox(tab, tab.id)?.items || []).forEach(migrateItemTags);
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
    coerceNavFolderModes(parsed.navItems);
    if (!parsed.hubName) parsed.hubName = 'Morpheus WebHub';
    if (!parsed.settings) parsed.settings = { ...defaultSettings };
    else parsed.settings = { ...defaultSettings, ...parsed.settings };
    migrateStyleSettings(parsed.settings);
    migrateThemeStyleProfiles(parsed.settings);
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
    stripLegacySharedTagToggleFields(parsed);
    return parsed;
  } catch (error) {
    console.warn('Failed to parse saved state, resetting', error);
    return cloneData(defaultState);
  }
}

function loadState() {
  return parseStateJson(localStorage.getItem(STORAGE_KEY));
}

function ensureLocalCacheMetadata(snapshot = null, options = {}) {
  const currentSnapshot = snapshot ?? localStorage.getItem(STORAGE_KEY) ?? '';
  if (localCacheMeta.cachedAt && localCacheMeta.snapshotHash) return localCacheMeta;
  const source = options.source === 'shared'
    ? 'shared'
    : options.source === 'local'
      ? 'local'
      : (localCacheMeta.source || 'local');
  return persistLocalCacheMeta({
    cachedAt: localCacheMeta.cachedAt || new Date().toISOString(),
    source,
    snapshotHash: computeSnapshotHash(currentSnapshot),
    databasePath: options.databasePath ?? state?.databasePath ?? localCacheMeta.databasePath ?? '',
    sharedBaselineVersion: options.sharedBaselineVersion ?? sharedDiskBaselineVersion ?? localCacheMeta.sharedBaselineVersion ?? null,
    sharedBaselinePath: options.sharedBaselinePath ?? getSharedDiskBaselinePath() ?? localCacheMeta.sharedBaselinePath ?? '',
    sharedSeenAt: options.sharedSeenAt ?? localCacheMeta.sharedSeenAt ?? null
  });
}

function persistStateToLocalCache(json = null, options = {}) {
  const snapshot = json ?? serializeStateSnapshot();
  const sharedSaveTarget = options.sharedSaveTarget === true;
  const source = options.source === 'shared' ? 'shared' : 'local';
  let stored = false;

  try {
    localStorage.setItem(STORAGE_KEY, snapshot);
    stored = true;
    localCacheQuotaNoticeShown = false;
  } catch (error) {
    if (!isStorageQuotaError(error)) throw error;
    console.warn('Morpheus: local browser cache quota exceeded', error);
    clearTrashCacheForQuotaRecovery();
    try {
      localStorage.setItem(STORAGE_KEY, snapshot);
      stored = true;
      localCacheQuotaNoticeShown = false;
    } catch (retryError) {
      if (!isStorageQuotaError(retryError)) throw retryError;
      clearFullLocalCacheSnapshot();
      notifyLocalCacheQuota(sharedSaveTarget || source === 'shared');
    }
  }

  const now = new Date().toISOString();
  const sharedVersion = options.sharedBaselineVersion ?? sharedDiskBaselineVersion ?? null;
  const sharedPath = (options.sharedBaselinePath ?? getSharedDiskBaselinePath() ?? '').trim();
  const metaPatch = {
    databasePath: (options.databasePath ?? state?.databasePath ?? '').trim(),
    sharedBaselineVersion: sharedVersion,
    sharedBaselinePath: sharedPath,
    sharedSeenAt: source === 'shared'
      ? now
      : (options.sharedSeenAt ?? localCacheMeta.sharedSeenAt ?? null)
  };
  if (stored) {
    metaPatch.cachedAt = now;
    metaPatch.source = source;
    metaPatch.snapshotHash = computeSnapshotHash(snapshot);
  } else {
    metaPatch.cachedAt = null;
    metaPatch.source = source;
    metaPatch.snapshotHash = '';
  }
  persistLocalCacheMeta(metaPatch);
  return snapshot;
}

function setSharedDiskBaseline(fileInfo, path = state?.databasePath || '') {
  sharedDiskBaselineVersion = fileInfo?.version || null;
  sharedDiskBaselineHash = fileInfo?.contentHash || '';
  sharedDiskBaselinePath = (path || '').trim();
  sharedDiskWritesBlocked = false;
  sharedDiskHasPendingChanges = !!sharedDiskQueuedSnapshot;
  persistLocalCacheMeta({
    databasePath: (state?.databasePath || sharedDiskBaselinePath || '').trim(),
    sharedBaselineVersion: sharedDiskBaselineVersion,
    sharedBaselinePath: sharedDiskBaselinePath,
    sharedSeenAt: new Date().toISOString()
  });
}

function acceptSharedDiskSnapshot(fileInfo, path = state?.databasePath || '') {
  sharedDiskSaveGeneration += 1;
  resolveSharedDiskSaveWaiters(Infinity, {
    ok: false,
    conflict: false,
    reloaded: true,
    databasePath: (path || '').trim()
  });
  sharedDiskQueuedSnapshot = null;
  sharedDiskQueuedPath = '';
  sharedDiskQueuedSequence = 0;
  clearSharedDiskFlushTimer();
  setSharedDiskBaseline(fileInfo, path);
  sharedDiskHasPendingChanges = false;
}

function resetSharedDiskBaseline(path = state?.databasePath || '') {
  sharedDiskBaselineVersion = null;
  sharedDiskBaselineHash = '';
  sharedDiskBaselinePath = (path || '').trim();
  sharedDiskWritesBlocked = false;
  sharedDiskHasPendingChanges = !!sharedDiskQueuedSnapshot;
  persistLocalCacheMeta({
    databasePath: (state?.databasePath || sharedDiskBaselinePath || '').trim(),
    sharedBaselineVersion: null,
    sharedBaselinePath: sharedDiskBaselinePath
  });
}

function getSharedDiskBaselineVersion() {
  return sharedDiskBaselineVersion;
}

function getSharedDiskBaselineHash() {
  return sharedDiskBaselineHash;
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

function sharedDiskSaveIsPending() {
  return sharedDiskSaveInFlight || !!sharedDiskQueuedSnapshot || !!sharedDiskFlushTimer;
}

async function waitForSharedDiskSaveIdle(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (sharedDiskSaveIsPending() && !sharedDiskWritesBlocked) {
    if (!sharedDiskSaveInFlight && sharedDiskQueuedSnapshot) void flushSharedDiskSaveQueue();
    if (!sharedDiskSaveIsPending() || sharedDiskWritesBlocked) break;
    if (Date.now() >= deadline) return false;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  return !sharedDiskSaveIsPending() && !sharedDiskWritesBlocked;
}

function getLocalStateMutationSequence() {
  return localStateMutationSequence;
}

function resolveSharedDiskSaveWaiters(maxSequence, result) {
  const remaining = [];
  for (const waiter of sharedDiskSaveWaiters) {
    if (waiter.sequence <= maxSequence) waiter.resolve(result);
    else remaining.push(waiter);
  }
  sharedDiskSaveWaiters = remaining;
}

function clearSharedDiskFlushTimer() {
  if (!sharedDiskFlushTimer) return;
  clearTimeout(sharedDiskFlushTimer);
  sharedDiskFlushTimer = null;
}

function scheduleSharedDiskFlush() {
  if (sharedDiskWritesBlocked || sharedDiskSaveInFlight || !sharedDiskQueuedSnapshot) return;
  clearSharedDiskFlushTimer();
  sharedDiskFlushTimer = setTimeout(() => {
    sharedDiskFlushTimer = null;
    void flushSharedDiskSaveQueue();
  }, SHARED_DISK_SAVE_DEBOUNCE_MS);
}

function blockSharedDiskSync(path = state?.databasePath || sharedDiskBaselinePath || '') {
  sharedDiskWritesBlocked = true;
  sharedDiskHasPendingChanges = true;
  sharedDiskBaselinePath = (path || '').trim();
  sharedDiskQueuedSnapshot = null;
  sharedDiskQueuedPath = '';
  sharedDiskQueuedSequence = 0;
  clearSharedDiskFlushTimer();
  persistLocalCacheMeta({
    databasePath: (state?.databasePath || sharedDiskBaselinePath || '').trim(),
    sharedBaselinePath: sharedDiskBaselinePath
  });
}

function notifySharedDiskConflict(detail = {}) {
  blockSharedDiskSync(detail.databasePath || getSharedDiskBaselinePath());
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
  stripLegacySharedTagToggleFields(state);
  if (canScrubStoredServiceApiKeys()) clearStoredServiceApiKeys(state);
  return JSON.stringify(state);
}

function queueSharedDiskSave(snapshot, path = state?.databasePath || sharedDiskBaselinePath || '') {
  if (sharedDiskWritesBlocked) {
    return Promise.resolve({
      ok: false,
      conflict: true,
      databasePath: (path || '').trim()
    });
  }
  const sequence = ++sharedDiskSaveSequence;
  sharedDiskQueuedSnapshot = snapshot;
  sharedDiskQueuedPath = (path || '').trim();
  sharedDiskQueuedSequence = sequence;
  sharedDiskHasPendingChanges = true;
  scheduleSharedDiskFlush();
  return new Promise(resolve => {
    sharedDiskSaveWaiters.push({ sequence, resolve });
  });
}

async function flushSharedDiskSaveQueue() {
  if (sharedDiskSaveInFlight || sharedDiskWritesBlocked) return;
  if (typeof bridge === 'undefined' || !bridge.isAvailable() || !bridge.nativeIsAvailable()) return;
  clearSharedDiskFlushTimer();

  while (sharedDiskQueuedSnapshot && !sharedDiskWritesBlocked && bridge.isAvailable() && bridge.nativeIsAvailable()) {
    const saveGeneration = sharedDiskSaveGeneration;
    const snapshot = sharedDiskQueuedSnapshot;
    const path = sharedDiskQueuedPath || (state?.databasePath || sharedDiskBaselinePath || '').trim();
    const expectedVersion = sharedDiskBaselineVersion;
    const expectedHash = sharedDiskBaselineHash;
    const snapshotSequence = sharedDiskQueuedSequence;
    sharedDiskQueuedSnapshot = null;
    sharedDiskQueuedPath = '';
    sharedDiskQueuedSequence = 0;
    sharedDiskSaveInFlight = true;

    try {
      const result = await bridge.saveState(snapshot, { expectedVersion, expectedHash });
      if (saveGeneration !== sharedDiskSaveGeneration) break;
      if (!result?.ok) {
        if (!sharedDiskQueuedSnapshot) {
          sharedDiskQueuedSnapshot = snapshot;
          sharedDiskQueuedPath = path;
          sharedDiskQueuedSequence = snapshotSequence;
        }
        sharedDiskHasPendingChanges = true;
        break;
      }
      if (result.conflict) {
        resolveSharedDiskSaveWaiters(Infinity, result);
        notifySharedDiskConflict({
          fileInfo: result.fileInfo || null,
          databasePath: result.databasePath || path || state.databasePath || ''
        });
        break;
      }
      if (result.fileInfo) {
        setSharedDiskBaseline(result.fileInfo, result.databasePath || path || state.databasePath || '');
      } else {
        resetSharedDiskBaseline(result.databasePath || path || state.databasePath || '');
      }
      persistStateToLocalCache(snapshot, {
        source: 'shared',
        databasePath: result.databasePath || path || state.databasePath || '',
        sharedBaselineVersion: result.fileInfo?.version ?? sharedDiskBaselineVersion ?? null,
        sharedBaselinePath: result.databasePath || path || state.databasePath || ''
      });
      resolveSharedDiskSaveWaiters(snapshotSequence, result);
      if (sharedDiskQueuedSnapshot) sharedDiskHasPendingChanges = true;
    } catch {
      if (saveGeneration !== sharedDiskSaveGeneration) break;
      if (!sharedDiskQueuedSnapshot) {
        sharedDiskQueuedSnapshot = snapshot;
        sharedDiskQueuedPath = path;
        sharedDiskQueuedSequence = snapshotSequence;
      }
      sharedDiskHasPendingChanges = true;
      break;
    } finally {
      sharedDiskSaveInFlight = false;
    }
  }

  if (sharedDiskQueuedSnapshot && !sharedDiskWritesBlocked && !sharedDiskSaveInFlight) scheduleSharedDiskFlush();
}

function saveState(options = {}) {
  const { skipDiskSync = false } = options;
  localStateMutationSequence += 1;
  invalidateDerivedCaches();
  const json = serializeStateSnapshot();
  isDirty = true;
  let queuedSharedDiskSave = false;
  let sharedSavePromise = null;
  if (typeof bridge !== 'undefined' && bridge.isAvailable()) {
    const shouldSyncSharedDisk = !skipDiskSync && bridge.nativeIsAvailable() && !!(state.databasePath || sharedDiskBaselinePath);
    if (shouldSyncSharedDisk && getSharedDiskBaselinePath() !== (state.databasePath || '').trim()) {
      resetSharedDiskBaseline(state.databasePath || '');
    }
    if (shouldSyncSharedDisk && !sharedDiskWritesBlocked) {
      sharedSavePromise = queueSharedDiskSave(json, state.databasePath || sharedDiskBaselinePath);
      queuedSharedDiskSave = true;
    }
  }
  try {
    persistStateToLocalCache(json, { sharedSaveTarget: queuedSharedDiskSave });
  } catch (error) {
    console.warn('Morpheus: failed to persist local browser cache', error);
    if (!queuedSharedDiskSave) throw error;
  }
  return sharedSavePromise || Promise.resolve({
    ok: true,
    conflict: false,
    persisted: 'local',
    databasePath: state.databasePath || sharedDiskBaselinePath || ''
  });
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
  if (!Array.isArray(board.tabs)) return board;
  if (!board.tabs.length) return null;
  const preferredTabId = tabId || (board.id === state.activeBoardId ? state.activeTabId : null);
  return board.tabs.find(tab => tab.id === preferredTabId) || board.tabs[0] || null;
}

function getActiveTab() {
  if (!state.activeBoardId) return null;
  const board = state.boards.find(b => b.id === state.activeBoardId) || null;
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

function getTabInbox(tab, fallbackTabId = null) {
  if (!tab) return null;
  if (!tab.inbox || typeof tab.inbox !== 'object') {
    tab.inbox = normalizeBoardInboxRecord(null, tab.id || fallbackTabId || `tab-${Date.now()}`);
  }
  return tab.inbox;
}

function getBoardItemContainers(board, tab = null) {
  const sourceTab = tab || getBoardTab(board);
  if (!sourceTab) return [];
  const containers = Array.isArray(sourceTab.columns) ? [...sourceTab.columns] : [];
  const inbox = getTabInbox(sourceTab, sourceTab.id);
  if (inbox) containers.push(inbox);
  return containers;
}

function isInboxColumnId(columnId) {
  if (!columnId) return false;
  return state.boards.some(board => getBoardTabs(board).some(tab => getTabInbox(tab, tab.id)?.id === columnId));
}

function findBoardTabByInboxId(board, inboxId) {
  if (!board || !inboxId) return null;
  return getBoardTabs(board).find(tab => getTabInbox(tab, tab.id)?.id === inboxId) || null;
}

function findBoardTabByColumnId(board, columnId) {
  if (!board || !columnId) return null;
  return getBoardTabs(board).find(tab => (tab.columns || []).some(column => column.id === columnId)) || null;
}

function findBoardTabContainingItem(board, itemId) {
  if (!board || !itemId) return null;
  for (const tab of getBoardTabs(board)) {
    for (const container of getBoardItemContainers(board, tab)) {
      if (findBoardItemInList(container.items, itemId)) return tab;
    }
  }
  return null;
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
    columns: options.columns,
    inbox: options.inbox
  }, board.id, board.tabs.length);
  board.tabs.push(tab);
  state.activeTabId = tab.id;
  syncBoardCompatibilityFields(board, tab.id);
  return tab;
}

function removeBoardTab(board, tabId, options = {}) {
  if (!board || !Array.isArray(board.tabs) || board.tabs.length === 0) return false;
  const index = board.tabs.findIndex(tab => tab.id === tabId);
  if (index === -1) return false;
  const deletingActiveTab = board.id === state.activeBoardId && state.activeTabId === tabId;
  board.tabs.splice(index, 1);
  if (!board.tabs.length) {
    state.activeTabId = null;
    clearBoardCompatibilityFields(board);
    return true;
  }
  if (deletingActiveTab) {
    const fallback = board.tabs[Math.max(0, index - 1)] || board.tabs[0] || null;
    state.activeTabId = fallback?.id || null;
  }
  syncBoardCompatibilityFields(board, deletingActiveTab ? state.activeTabId : (state.activeTabId || board.tabs[0]?.id || null));
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
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    const hostname = (url.hostname || '').trim().toLowerCase();
    if (!hostname) return false;
    if (hostname === 'localhost') return true;
    if ((hostname.startsWith('[') && hostname.endsWith(']')) || hostname.includes(':')) return true;
    const isIpv4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(hostname);
    return hostname.includes('.') || isIpv4;
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
  if (boardNavInheritedTagsCache.has(boardId)) return boardNavInheritedTagsCache.get(boardId);
  const tags = [];
  function collect(items, chain = []) {
    for (const item of (items || [])) {
      if (item.type === 'board' && item.boardId === boardId) {
        for (const f of chain) if (f.sharedTags) tags.push(...f.sharedTags);
        return true;
      }
      if (item.type === 'folder' && item.children) {
        chain.push(item);
        if (collect(item.children, chain)) return true;
        chain.pop();
      }
    }
    return false;
  }
  collect(state.navItems);
  const inherited = [...new Set(tags)];
  boardNavInheritedTagsCache.set(boardId, inherited);
  return inherited;
}

function getBoardInheritedTagIds(board) {
  if (!board) return [];
  const inheritedFromNav = getBoardNavInheritedTags(board.id);
  const ownShared = board.sharedTags || [];
  return [...new Set([...inheritedFromNav, ...ownShared])];
}

function getTabInheritedTagIds(board, tab) {
  if (!board || !tab) return [];
  const inheritedFromBoard = getBoardInheritedTagIds(board);
  const tabShared = tab.sharedTags || [];
  return [...new Set([...inheritedFromBoard, ...tabShared])];
}

function collectFolderAncestorTags(board, folderId) {
  if (!folderId || !board) return [];
  const found = findBoardItemInColumns(board, folderId);
  if (!found?.item) return [];
  const parentTags = found.parent ? collectFolderAncestorTags(board, found.parent.id) : [];
  const ownShared = found.item.sharedTags || [];
  return [...parentTags, ...ownShared];
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
  for (const column of getBoardItemContainers(board)) {
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
  for (const column of getBoardItemContainers(board)) search(column.items);
}

function removeBoardItemById(itemId) {
  const board = getActiveBoard();
  for (const column of getBoardItemContainers(board)) {
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
  const createEmpty = options.createEmpty === true;
  const tabs = createEmpty ? [] : [normalizeBoardTabRecord({
    id: options.initialTabId || `${id}-tab-1`,
    title: options.initialTabTitle || title,
    columnCount: options.columnCount || 3,
    columns: options.columns,
    backgroundImage: options.backgroundImage,
    backgroundFit: options.backgroundFit,
    containerOpacity: options.containerOpacity,
    sharedTags: options.tabSharedTags,
    tags: options.tabTags,
    showSetBar: options.showSetBar,
    setBar: options.setBar,
    inbox: options.inbox,
    locked: options.locked
  }, id, 0)];
  const board = {
    id,
    title,
    wrapTabBar: options.wrapTabBar === true,
    showSpeedDial: options.showSpeedDial !== false,
    speedDialSlotCount: options.speedDialSlotCount || getDefaultSpeedDialSlotCount(),
    speedDial: Array.isArray(options.speedDial) ? options.speedDial : [],
    sharedTags: Array.isArray(options.sharedTags) ? options.sharedTags : [],
    tags: Array.isArray(options.tags) ? options.tags : [],
    tabs,
    columnCount: tabs[0]?.columnCount || 0,
    backgroundImage: tabs[0]?.backgroundImage || '',
    backgroundFit: tabs[0]?.backgroundFit || 'cover',
    containerOpacity: tabs[0]?.containerOpacity ?? 100,
    columns: tabs[0]?.columns || [],
    inbox: tabs[0]?.inbox || null,
    ...(options.extra || {})
  };
  if (tabs[0]) syncBoardCompatibilityFields(board, tabs[0].id);
  normalizeSpeedDialSlots(board);
  return board;
}

function createBoard(title, options = {}) {
  const id = options.id || `board-${Date.now()}`;
  const board = createBoardRecord(title, {
    id,
    wrapTabBar: options.wrapTabBar,
    showSpeedDial: options.showSpeedDial,
    speedDialSlotCount: options.speedDialSlotCount,
    speedDial: options.speedDial,
    sharedTags: options.sharedTags,
    tags: options.tags,
    initialTabTitle: options.initialTabTitle || title,
    createEmpty: options.createEmpty === true
  });
  state.boards.push(board);
  state.activeBoardId = id;
  state.activeTabId = board.tabs?.[0]?.id || null;
  state.navItems.push({ id: `nav-${id}`, type: 'board', title, boardId: id });
  return board;
}

function addNavSection(item) {
  const nextId = item.id || `id-${Date.now()}`;
  if (item.type === 'folder') {
    const folder = createFolderRecord(item.title, { ...item, id: nextId, folderMode: 'static', rules: null });
    coerceNavFolderModes([folder]);
    state.navItems.push(folder);
    return;
  }
  state.navItems.push({ ...item, id: nextId });
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
  const item = type === 'folder'
    ? createFolderRecord(title, { ...options, id: `id-${Date.now()}` })
    : { id: `id-${Date.now()}`, type, title };
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
  for (const column of getBoardItemContainers(board)) {
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
    const board = getBoardForContext(contextTarget);
    if (!board) return;
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
  const board = createBoardRecord(title, { id, createEmpty: true });
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
  const fallbackCount = Math.max(getDefaultSpeedDialSlotCount(), currentLength);
  target.speedDialSlotCount = Math.max(1, Math.min(48, parseInt(target.speedDialSlotCount, 10) || fallbackCount));
  if (target.speedDialSlotCount < currentLength) target.speedDialSlotCount = currentLength;
}

function getDefaultSpeedDialSlotCount() {
  const sizeName = state?.settings?.speedDialIconSize || defaultSettings.speedDialIconSize || 'medium';
  const slotSize = ({ small: 34, medium: 44, large: 56 })[sizeName] || 44;
  const fallback = ({ small: 14, medium: 12, large: 10 })[sizeName] || 12;
  if (typeof document === 'undefined') return fallback;

  const appShell = document.querySelector('.app-shell');
  const mainPanel = document.getElementById('mainPanel');
  const speedDial = document.getElementById('speedDial');
  const sidebarCollapsed = !!appShell?.classList.contains('sidebar-collapsed');
  const gap = 8;

  let paneWidth = 0;
  if (!sidebarCollapsed && speedDial?.clientWidth) {
    paneWidth = speedDial.clientWidth;
  } else if (mainPanel?.clientWidth) {
    paneWidth = mainPanel.clientWidth;
    if (sidebarCollapsed) paneWidth -= (EXPANDED_SIDEBAR_WIDTH - COLLAPSED_SIDEBAR_WIDTH);
    paneWidth -= 68;
  } else if (typeof window !== 'undefined' && window.innerWidth) {
    paneWidth = window.innerWidth - EXPANDED_SIDEBAR_WIDTH - 68;
  }

  if (!Number.isFinite(paneWidth) || paneWidth <= 0) return fallback;
  return Math.max(1, Math.min(48, Math.floor((paneWidth + gap) / (slotSize + gap)) || fallback));
}

function getSpeedDialSlotCount(target) {
  normalizeSpeedDialSlots(target);
  return target?.speedDialSlotCount || getDefaultSpeedDialSlotCount();
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

function filterInheritedTagIdsForItem(item, tagIds = []) {
  const explicitTagIds = new Set([
    ...(item?.tags || []),
    ...(item?.sharedTags || [])
  ]);
  return [...new Set((tagIds || []).filter(tagId => !explicitTagIds.has(tagId)))];
}

function _buildBoardInheritedTagContext(board) {
  const itemContexts = new Map();
  const navInherited = getBoardNavInheritedTags(board.id);
  const boardInherited = [...new Set([...navInherited, ...(board.sharedTags || [])])];

  const walkItems = (items, tab, inheritedTagIds) => {
    for (const item of (items || [])) {
      if (!item?.id) continue;
      itemContexts.set(item.id, { inheritedTagIds });
      if (item.type === 'folder' && Array.isArray(item.children) && item.children.length) {
        const childInheritedTagIds = item.sharedTags?.length
          ? [...new Set([...inheritedTagIds, ...item.sharedTags])]
          : inheritedTagIds;
        walkItems(item.children, tab, childInheritedTagIds);
      }
    }
  };

  for (const tab of getBoardTabs(board)) {
    const tabInherited = tab?.sharedTags?.length
      ? [...new Set([...boardInherited, ...tab.sharedTags])]
      : boardInherited;
    for (const container of getBoardItemContainers(board, tab)) {
      walkItems(container.items, tab, tabInherited);
    }
  }

  return { itemContexts };
}

function getBoardInheritedTagContext(board) {
  if (!board) return null;
  let cached = inheritedTagContextCache.get(board);
  if (!cached) {
    cached = _buildBoardInheritedTagContext(board);
    inheritedTagContextCache.set(board, cached);
  }
  return cached;
}

function computeInheritedTags(item, board) {
  if (!board) return [];
  const context = getBoardInheritedTagContext(board);
  const inheritedTagIds = context?.itemContexts.get(item?.id)?.inheritedTagIds || [];
  return filterInheritedTagIdsForItem(item, inheritedTagIds);
}

function isDynamicSet(set) {
  return normalizeSetMode(set?.mode) === 'dynamic';
}

function isDynamicFolder(folder) {
  return folder?.type === 'folder' && normalizeFolderMode(folder?.folderMode ?? folder?.mode) === 'dynamic';
}

function canInsertIntoFolder(folder, itemOrType) {
  if (folder?.type !== 'folder') return false;
  if (isDynamicFolder(folder)) return false;
  return true;
}

function getEffectiveTagIdsForBookmark(item, board = null) {
  return [...new Set([
    ...(item?.tags || []),
    ...(item?.sharedTags || []),
    ...(board ? computeInheritedTags(item, board) : [])
  ])];
}

function createBookmarkSource(item, options = {}) {
  if (!item || item.type !== 'bookmark' || !item.url) return null;
  return {
    key: options.key ? `${options.key}:${item.id || item.url}` : (item.id || item.url),
    item,
    board: options.board || null,
    tab: options.tab || null,
    containerId: options.containerId || null,
    location: options.location || 'unknown',
    slot: Number.isInteger(options.slot) ? options.slot : null,
    effectiveTagIds: getEffectiveTagIdsForBookmark(item, options.board || null)
  };
}

function _collectBookmarkSourcesFromItems(items, sources, options = {}) {
  for (const item of (items || [])) {
    if (!item) continue;
    if (item.type === 'bookmark' && item.url) {
      const source = createBookmarkSource(item, options);
      if (source) sources.push(source);
      continue;
    }
    if (item.type === 'folder' && Array.isArray(item.children) && !isDynamicFolder(item)) {
      _collectBookmarkSourcesFromItems(item.children, sources, options);
    }
  }
}

function collectRealBookmarkSources() {
  if (liveBookmarkSourceCache) return liveBookmarkSourceCache;

  const sources = [];

  for (const board of (state.boards || [])) {
    for (const tab of getBoardTabs(board)) {
      for (const container of getBoardItemContainers(board, tab)) {
        _collectBookmarkSourcesFromItems(container.items, sources, {
          key: `board:${board.id}:${tab.id}:${container.id}`,
          board,
          tab,
          containerId: container.id,
          location: container.isInbox ? 'board-inbox' : 'board-column'
        });
      }
    }
  }

  liveBookmarkSourceCache = sources;
  return sources;
}

function matchesDynamicRules(tagIds = [], rules = null) {
  const normalizedRules = normalizeDynamicRules(rules);
  const tagSet = new Set(tagIds || []);
  return normalizedRules.includeTags.every(tagId => tagSet.has(tagId))
    && normalizedRules.excludeTags.every(tagId => !tagSet.has(tagId));
}

function resolveDynamicBookmarkSources(rules, options = {}) {
  const sources = Array.isArray(options.sources) ? options.sources : collectRealBookmarkSources();
  return sources.filter(source => matchesDynamicRules(source.effectiveTagIds, rules));
}

function sortDynamicBookmarkSources(sources = [], sortMode = 'source') {
  const normalizedMode = normalizeDynamicSortMode(sortMode);
  if (normalizedMode === 'source') return sources;
  const sorted = [...sources];
  const compareText = (left, right) => left.localeCompare(right, undefined, { sensitivity: 'base', numeric: true });
  const valueFor = (source, field) => {
    const item = source?.item || {};
    if (field === 'url') return (item.url || '').trim();
    return (item.title || item.url || '').trim();
  };
  sorted.sort((a, b) => {
    if (normalizedMode === 'title-asc' || normalizedMode === 'title-desc') {
      const direction = normalizedMode === 'title-asc' ? 1 : -1;
      const primary = compareText(valueFor(a, 'title'), valueFor(b, 'title'));
      if (primary) return primary * direction;
      const secondary = compareText(valueFor(a, 'url'), valueFor(b, 'url'));
      if (secondary) return secondary * direction;
      return compareText(a?.key || '', b?.key || '') * direction;
    }
    const direction = normalizedMode === 'url-asc' ? 1 : -1;
    const primary = compareText(valueFor(a, 'url'), valueFor(b, 'url'));
    if (primary) return primary * direction;
    const secondary = compareText(valueFor(a, 'title'), valueFor(b, 'title'));
    if (secondary) return secondary * direction;
    return compareText(a?.key || '', b?.key || '') * direction;
  });
  return sorted;
}

function resolveSetItems(set, options = {}) {
  if (!set) return [];
  if (!isDynamicSet(set)) return Array.isArray(set.items) ? set.items : [];
  return sortDynamicBookmarkSources(resolveDynamicBookmarkSources(set.rules, options), set.sortMode).map(source => source.item);
}

function resolveFolderChildren(folder, board = null, options = {}) {
  if (folder?.type !== 'folder') return [];
  if (!isDynamicFolder(folder)) return Array.isArray(folder.children) ? folder.children : [];
  return sortDynamicBookmarkSources(resolveDynamicBookmarkSources(folder.rules, { ...options, board }), folder.sortMode).map(source => source.item);
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
    for (const tab of getBoardTabs(board)) {
      const inboxHit = walk(getBoardInbox(board, tab)?.items, `${board.title} / ${tab.title || 'Untitled Tab'} (Inbox)`);
      if (inboxHit) return inboxHit;
    }
  }
  return null;
}

function getBoardInbox(board, tab = null) {
  const sourceTab = tab || getBoardTab(board);
  if (!sourceTab) return board?.inbox || null;
  return getTabInbox(sourceTab, sourceTab.id);
}

function getBoardInboxCounts(board, tab = null) {
  if (!board) return { bookmarks: 0, folders: 0 };
  if (tab) {
    const inbox = getBoardInbox(board, tab);
    if (!inbox) return { bookmarks: 0, folders: 0 };
    return {
      bookmarks: countItemsRecursive(inbox.items, 'bookmark'),
      folders: countItemsRecursive(inbox.items, 'folder')
    };
  }
  let bookmarks = 0;
  let folders = 0;
  for (const boardTab of getBoardTabs(board)) {
    const inbox = getBoardInbox(board, boardTab);
    bookmarks += countItemsRecursive(inbox?.items, 'bookmark');
    folders += countItemsRecursive(inbox?.items, 'folder');
  }
  return { bookmarks, folders };
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

function editFolder(itemId, title, tags, sharedTags, ct = null) {
  const board = getBoardForContext(ct);
  let item = board ? findBoardItemInColumns(board, itemId)?.item : null;
  if (!item) item = findNavItemPath(itemId)?.item;
  if (item?.type === 'folder') {
    item.title = title;
    item.tags = tags;
    item.sharedTags = sharedTags;
    item.folderMode = normalizeFolderMode(item.folderMode);
    item.rules = normalizeDynamicRules(item.rules);
    item.sortMode = normalizeDynamicSortMode(item.sortMode);
  }
}

// --- Undo snapshot ---

function restoreStateSnapshot(jsonStr) {
  state = parseStateJson(jsonStr);
  invalidateDerivedCaches();
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
    const restored = normalizeRestoredBoardItem(item);
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
      const restored = normalizeRestoredBoardItem(item);
      if (!setSpeedDialSlot(board, slot, restored)) {
        const fallback = firstEmptySpeedDialSlot(board);
        if (fallback !== -1) setSpeedDialSlot(board, fallback, normalizeRestoredBoardItem(item));
      }
    }
  } else if (source.area === 'nav-board') {
    if (item.board) state.boards.push(cloneData(item.board));
    const navItem = cloneData(item.navItem);
    coerceNavFolderModes([navItem]);
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
      coerceNavFolderModes([navItem]);
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
    coerceNavFolderModes([restored]);
    if (source.parentId) {
      const pp = findNavItemPath(source.parentId);
      if (pp?.item?.type === 'folder') { pp.item.children = pp.item.children || []; pp.item.children.push(restored); return true; }
    }
    state.navItems.push(restored);
  } else if (source.area === 'board-item') {
    const board = state.boards.find(b => b.id === source.boardId) || getActiveBoard();
    if (board) {
      const inboxTab = source.columnId ? findBoardTabByInboxId(board, source.columnId) : null;
      const col = inboxTab
        ? getBoardInbox(board, inboxTab)
        : (board.columns.find(c => c.id === source.columnId) || board.columns[0] || getBoardInbox(board));
      const restored = normalizeRestoredBoardItem(item);
      if (source.parentId) {
        const parent = findBoardItemInColumns(board, source.parentId)?.item;
        if (parent?.type === 'folder' && canInsertIntoFolder(parent, restored?.type)) {
          parent.children = parent.children || [];
          parent.children.push(restored);
          return true;
        }
      }
      if (col) col.items.push(restored);
    }
  } else if (source.area === 'set') {
    return restoreSetFromTrashItem(item);
  }
  return true;
}

function cleanTrashAfterRestore() {
  const liveIds = new Set();
  const walkItems = (list) => { for (const item of (list || [])) { if (item?.id) liveIds.add(item.id); if (item?.children) walkItems(item.children); } };
  const walkNav = (items) => { for (const ni of (items || [])) { liveIds.add(ni.id); if (ni.children) walkNav(ni.children); } };
  for (const board of (state.boards || [])) {
    liveIds.add(board.id);
    for (const col of (board.columns || [])) walkItems(col.items);
    for (const tab of getBoardTabs(board)) walkItems(getBoardInbox(board, tab)?.items || []);
    for (const i of (board.speedDial || [])) if (i?.id) liveIds.add(i.id);
  }
  for (const set of (state.sets || [])) if (set?.id) liveIds.add(set.id);
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
    for (const tab of getBoardTabs(board)) walk(getBoardInbox(board, tab)?.items || []);
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
