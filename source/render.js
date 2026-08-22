const elements = {
  appShell: document.querySelector('.app-shell'),
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
  modalSelectSecondaryRow: document.getElementById('modalSelectSecondaryRow'),
  modalSelectSecondary: document.getElementById('modalSelectSecondary'),
  modalCancelBtn: document.getElementById('modalCancelBtn'),
  contextMenu: document.getElementById('contextMenu'),
  quickSearchBtn: document.getElementById('quickSearchBtn'),
  quickTagManagerBtn: document.getElementById('quickTagManagerBtn'),
  quickSetsBtn: document.getElementById('quickSetsBtn'),
  speedDialToggleBtn: document.getElementById('speedDialToggleBtn'),
  setBarToggleBtn: document.getElementById('setBarToggleBtn'),
  searchModal: document.getElementById('searchModal'),
  searchModalInput: document.getElementById('searchModalInput'),
  searchModalResults: document.getElementById('searchModalResults'),
  collectionTabBar: document.getElementById('collectionTabBar'),
  tabSetBar: document.getElementById('tabSetBar')
};

const searchFilters = {
  name: true,
  url: true,
  tags: false,
  typeBookmark: true,
  typeFolder: true,
  typeBoard: true
};

let activeTagFilters = new Set();
let _tagFilterMode = 'or';
let _tagPickerSort = 'az';
const nativeFaviconMisses = new Set();
const nativeFaviconRefreshRequests = new Set();
const faviconResolutionPromises = new Map();
const resolvedFaviconSources = new Map();
const failedFaviconOrigins = new Set();
const FAVICON_CANDIDATE_TIMEOUT_MS = 5000;
let faviconCacheSaveTimer = null;
let searchDataCacheSequence = -1;
let persistentSearchDataCache = new WeakMap();
let searchIndexSequence = -1;
let persistentSearchIndex = [];

function resolveSidebarContainerAlpha(board = getActiveBoard()) {
  const settings = state.settings || {};
  if (settings.sidebarUseActiveTabOpacity !== false) return (board?.containerOpacity ?? 100) / 100;
  return Math.min(100, Math.max(10, settings.sidebarOpacity ?? 100)) / 100;
}

function resolveUiPanelAlpha() {
  const settings = state.settings || {};
  return Math.min(100, Math.max(10, settings.sidebarOpacity ?? 100)) / 100;
}

function requestNativeFaviconRefresh(item) {
  const url = typeof item?.url === 'string' ? item.url.trim() : '';
  if (!/^https?:\/\//i.test(url)) return;
  try {
    const origin = new URL(url).origin;
    nativeFaviconMisses.delete(origin);
    failedFaviconOrigins.delete(origin);
    resolvedFaviconSources.delete(origin);
    faviconResolutionPromises.delete(origin);
  } catch {}
  nativeFaviconRefreshRequests.add(url);
}

function getBookmarkFaviconResolutionState(item) {
  if (item?.faviconCache) return 'available';
  const url = typeof item?.url === 'string' ? item.url.trim() : '';
  if (!url) return 'missing';
  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol) || !parsed.hostname) return 'missing';
    if (resolvedFaviconSources.has(parsed.origin)) return 'available';
    if (failedFaviconOrigins.has(parsed.origin)) return 'missing';
    return 'unchecked';
  } catch {
    return 'missing';
  }
}

function scheduleFaviconCacheSave() {
  if (faviconCacheSaveTimer) return;
  faviconCacheSaveTimer = setTimeout(() => {
    faviconCacheSaveTimer = null;
    if (!document.hidden) saveState();
  }, 500);
}

function loadFaviconCandidate(src) {
  return new Promise(resolve => {
    const probe = new Image();
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      probe.onload = null;
      probe.onerror = null;
      resolve(value);
    };
    const timer = setTimeout(() => finish(''), FAVICON_CANDIDATE_TIMEOUT_MS);
    probe.onload = () => finish(src);
    probe.onerror = () => finish('');
    probe.src = src;
  });
}

async function resolveFaviconSource(item, options = {}) {
  if (!item?.url) return '';
  let parsed;
  try { parsed = new URL(item.url); } catch { return ''; }
  if (!/^https?:$/.test(parsed.protocol) || !parsed.hostname) return '';
  const requestUrl = item.url.trim();
  const cacheKey = parsed.origin;
  const forceNative = options.forceNative === true;
  if (!forceNative && resolvedFaviconSources.has(cacheKey)) return resolvedFaviconSources.get(cacheKey);
  if (!forceNative && failedFaviconOrigins.has(cacheKey)) return '';
  if (!forceNative && faviconResolutionPromises.has(cacheKey)) return faviconResolutionPromises.get(cacheKey);

  const request = (async () => {
    if (
      typeof bridge !== 'undefined' && typeof bridge.fetchFavicon === 'function'
      && (forceNative || !nativeFaviconMisses.has(cacheKey))
    ) {
      const nativeResult = await bridge.fetchFavicon(requestUrl).catch(() => null);
      if (nativeResult?.dataUrl) return nativeResult.dataUrl;
      nativeFaviconMisses.add(cacheKey);
    }

    const candidates = [
      `${parsed.origin}/favicon.ico`,
      `${parsed.origin}/favicon.svg`,
      `${parsed.origin}/apple-touch-icon.png`,
      `${parsed.origin}/favicon-32x32.png`,
      `https://icons.duckduckgo.com/ip3/${parsed.hostname}.ico`
    ];
    for (const candidate of candidates) {
      const loaded = await loadFaviconCandidate(candidate);
      if (loaded) return loaded;
    }
    return loadFaviconCandidate(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(parsed.hostname)}&sz=64`);
  })().then(src => {
    if (src) {
      resolvedFaviconSources.set(cacheKey, src);
      failedFaviconOrigins.delete(cacheKey);
    } else {
      resolvedFaviconSources.delete(cacheKey);
      failedFaviconOrigins.add(cacheKey);
    }
    return src;
  }).finally(() => {
    if (faviconResolutionPromises.get(cacheKey) === request) faviconResolutionPromises.delete(cacheKey);
  });
  if (!forceNative) faviconResolutionPromises.set(cacheKey, request);
  return request;
}

function setFavicon(img, item, sz) {
  if (item.faviconCache) {
    img.src = item.faviconCache;
    try {
      const origin = new URL(item.url).origin;
      resolvedFaviconSources.set(origin, item.faviconCache);
      failedFaviconOrigins.delete(origin);
    } catch {}
    return;
  }
  if (!item.url) return;
  const requestUrl = item.url.trim();
  const forceNative = nativeFaviconRefreshRequests.delete(requestUrl);
  let origin = '';
  try { origin = new URL(requestUrl).origin; } catch {}
  if (forceNative) {
    if (origin) {
      nativeFaviconMisses.delete(origin);
      faviconResolutionPromises.delete(origin);
      resolvedFaviconSources.delete(origin);
      failedFaviconOrigins.delete(origin);
    }
  } else if (origin && resolvedFaviconSources.has(origin)) {
    img.src = resolvedFaviconSources.get(origin);
    return;
  }
  resolveFaviconSource(item, { forceNative }).then(src => {
    if (!src || document.hidden) return;
    img.onerror = null;
    img.src = src;
    if (src.startsWith('data:') && item.faviconCache !== src) {
      item.faviconCache = src;
      scheduleFaviconCacheSave();
    }
  });
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
      } else if (item.type === 'folder') {
        walk(item.children);
      }
    }
  };
  walk(folder?.children);
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
  const style = getActiveThemeStyleSettings();
  const r = document.documentElement.style;
  const overrides = style.styleOverrides || {};
  const fontPresets = {
    small: { base: 12, hub: 16, boardTitle: 18, nav: 13, title: 11 },
    medium: { base: 14, hub: 18, boardTitle: 22, nav: 14, title: 12 },
    large: { base: 16, hub: 21, boardTitle: 26, nav: 16, title: 14 }
  };
  const preset = fontPresets[style.globalFontScale || 'medium'] || fontPresets.medium;
  const globalColor = style.globalFontColorFromTheme === false
    ? (style.globalFontColor || '#e5e7eb')
    : 'var(--accent)';
  const globalMutedColor = style.globalFontColorFromTheme === false
    ? (style.globalFontColor || '#e5e7eb')
    : 'var(--accent)';
  const sectionColor = (section, key, fallback = globalColor) => {
    if (!overrides[section]) return fallback;
    if (style[`${key}FromTheme`] === true) return THEME_STYLE_COLOR_FALLBACKS[key] || fallback;
    return style[key] || fallback;
  };
  const sectionSize = (section, key, fallback) => overrides[section] ? (style[key] || fallback) : fallback;

  r.setProperty('--board-font-size', `${sectionSize('board', 'boardFontSize', preset.nav)}px`);
  r.setProperty('--bookmark-font-size', `${sectionSize('bookmark', 'bookmarkFontSize', preset.base)}px`);
  r.setProperty('--folder-font-size', `${sectionSize('folder', 'folderFontSize', preset.nav + 1)}px`);
  r.setProperty('--title-font-size', `${sectionSize('title', 'titleFontSize', preset.title)}px`);
  r.setProperty('--title-line-thickness', `${overrides.title ? style.titleLineThickness : 1}px`);
  r.setProperty('--global-font-color', globalColor);
  r.setProperty('--board-title-font-size', `${sectionSize('boardTitle', 'boardTitleFontSize', preset.boardTitle)}px`);
  r.setProperty('--tags-display', s.showTags ? 'flex' : 'none');
  r.setProperty('--tags-grid-display', s.showTags ? 'grid' : 'none');
  r.setProperty('--sidebar-container-alpha', resolveSidebarContainerAlpha());
  r.setProperty('--ui-panel-alpha', resolveUiPanelAlpha());

  const ff = (section, key) => overrides[section] ? (style[key] || 'inherit') : 'inherit';
  const fw = (section, key, def = 'normal') => overrides[section] ? (style[key] ? 'bold' : def) : def;
  const fi = (section, key) => overrides[section] && style[key] ? 'italic' : 'normal';
  const td = (section, key) => overrides[section] && style[key] ? 'underline' : 'none';
  const align = (section, key) => overrides[section] ? (style[key] || 'left') : 'left';

  r.setProperty('--bookmark-font-family',        ff('bookmark', 'bookmarkFontFamily'));
  r.setProperty('--bookmark-font-weight',         fw('bookmark', 'bookmarkBold'));
  r.setProperty('--bookmark-font-style',          fi('bookmark', 'bookmarkItalic'));
  r.setProperty('--bookmark-text-decoration',     td('bookmark', 'bookmarkUnderline'));

  r.setProperty('--folder-font-family',           ff('folder', 'folderFontFamily'));
  r.setProperty('--folder-font-weight',           fw('folder', 'folderBold', '600'));
  r.setProperty('--folder-font-style',            fi('folder', 'folderItalic'));
  r.setProperty('--folder-text-decoration',       td('folder', 'folderUnderline'));

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
  r.setProperty('--hub-name-color',               sectionColor('hubName', 'hubNameColor'));
  r.setProperty('--board-title-color',            sectionColor('boardTitle', 'boardTitleColor'));
  r.setProperty('--board-color',                  sectionColor('board', 'boardColor'));
  r.setProperty('--bookmark-color',               sectionColor('bookmark', 'bookmarkColor'));
  r.setProperty('--folder-color',                 sectionColor('folder', 'folderColor'));
  r.setProperty('--title-color',                  sectionColor('title', 'titleColor', globalMutedColor));
  r.setProperty('--title-line-color',             overrides.title
    ? (style.titleLineColorFromTheme === true
        ? (THEME_STYLE_COLOR_FALLBACKS.titleLineColor || globalColor)
        : (style.titleLineColor || 'rgba(255,255,255,0.12)'))
    : globalColor);
  r.setProperty('--title-line-style',             overrides.title ? (style.titleLineStyle || 'solid') : 'solid');

  const sdSizes = { small: '34px', medium: '44px', large: '56px' };
  r.setProperty('--speed-link-size', sdSizes[s.speedDialIconSize] || '44px');
  const essCols = { small: 8, medium: 6, large: 4 };
  r.setProperty('--essentials-cols', essCols[s.essentialsIconSize] || 6);

  const activeThemeId = getResolvedThemeId(s.activeThemeName || 'default-dark');
  if (s.activeThemeName !== activeThemeId) s.activeThemeName = activeThemeId;
  applyTheme(getThemeById(activeThemeId));
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function updateInboxBadge() {
  const board = getActiveBoard();
  const { bookmarks, folders } = getBoardInboxCounts(board, getActiveTab());
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

function renderInboxPanel(options = {}) {
  if (!options.reuseDerivedCaches) invalidateDerivedCaches();
  const board = state.activeBoardId
    ? state.boards.find(entry => entry.id === state.activeBoardId) || null
    : null;
  let activeTab = null;
  if (board) {
    activeTab = getBoardTab(board, state.activeTabId);
    if (activeTab) {
      if (state.activeTabId !== activeTab.id) state.activeTabId = activeTab.id;
      syncBoardCompatibilityFields(board, activeTab.id);
    }
  }
  const inbox = getBoardInbox(board, activeTab);
  const body = document.getElementById('inboxPanelBody');
  if (!body) return;
  body.innerHTML = '';
  const { bookmarks, folders } = getBoardInboxCounts(board, activeTab);
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
  invalidateDerivedCaches();
  syncBoardCompatibilityState();
  if (state.activeBoardId && !state.activeTabId) {
    const activeBoard = state.boards.find(b => b.id === state.activeBoardId);
    state.activeTabId = activeBoard?.tabs?.[0]?.id || null;
  }
  applySettings();
  elements.hubNameEl.textContent = state.hubName || 'Morpheus WebHub';
  document.title = state.hubName || 'Morpheus WebHub';
  renderNav();
  renderEssentials();
  renderBoard({ reuseDerivedCaches: true });
  updateInboxBadge();
  if (typeof updateImportManagerBadge === 'function') updateImportManagerBadge();
  if (typeof inboxPanelOpen !== 'undefined' && inboxPanelOpen) renderInboxPanel({ reuseDerivedCaches: true });
  if (typeof importManagerPanelOpen !== 'undefined' && importManagerPanelOpen && typeof renderImportManagerPanel === 'function') {
    renderImportManagerPanel();
  }
  if (!elements.searchModal.classList.contains('hidden')) {
    const q = elements.searchModalInput.value.trim();
    if (q || activeTagFilters.size > 0) renderSearchResults({ reuseDerivedCaches: true });
  }
  if (typeof setsManagerPanelOpen !== 'undefined' && setsManagerPanelOpen && typeof renderSetManagerPanel === 'function') {
    renderSetManagerPanel();
  }
}

function _showTagPicker(show) {
  const pickerEl = document.getElementById('searchTagPicker');
  pickerEl.classList.toggle('hidden', !show);
  const toggleBtn = document.getElementById('searchTagFilterToggleBtn');
  if (toggleBtn) toggleBtn.classList.toggle('active', show);
}

let searchRenderTimer = null;

function scheduleSearchResultsRender(options = {}) {
  const delay = options.delay ?? 120;
  if (searchRenderTimer) clearTimeout(searchRenderTimer);
  searchRenderTimer = setTimeout(() => {
    searchRenderTimer = null;
    renderSearchResults(options);
  }, delay);
}

function _cancelScheduledSearchRender() {
  if (!searchRenderTimer) return;
  clearTimeout(searchRenderTimer);
  searchRenderTimer = null;
}

function _activateBoardSelection(boardId, tabId = null) {
  const board = state.boards.find(entry => entry.id === boardId) || null;
  if (!board) return false;
  const nextTabId = tabId || board.tabs?.[0]?.id || null;
  if (state.activeBoardId === board.id && state.activeTabId === nextTabId) return false;
  state.activeBoardId = board.id;
  state.activeTabId = nextTabId;
  return true;
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
  _cancelScheduledSearchRender();
  elements.searchModal.classList.add('hidden');
  elements.searchModalInput.value = '';
  activeTagFilters = new Set();
  _tagFilterMode = 'or';
  document.getElementById('searchTagModeBtn').dataset.mode = 'or';
  document.getElementById('searchTagModeBtn').textContent = 'ANY';
  _showTagPicker(false);
  elements.searchModalResults.innerHTML = '';
}

function renderSearchResults(options = {}) {
  _cancelScheduledSearchRender();
  if (!options.reuseDerivedCaches) invalidateDerivedCaches();
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

  const mutationSequence = typeof getLocalStateMutationSequence === 'function'
    ? getLocalStateMutationSequence()
    : -1;
  if (searchDataCacheSequence !== mutationSequence) {
    searchDataCacheSequence = mutationSequence;
    persistentSearchDataCache = new WeakMap();
  }
  const searchDataCache = persistentSearchDataCache;
  const getSearchData = (item, board) => {
    let perBoard = searchDataCache.get(item);
    if (!perBoard) {
      perBoard = new Map();
      searchDataCache.set(item, perBoard);
    }
    const boardKey = board?.id || '';
    if (perBoard.has(boardKey)) return perBoard.get(boardKey);
    const tagIds = [...new Set([
      ...(item.tags || []),
      ...(item.sharedTags || []),
      ...(board ? computeInheritedTags(item, board) : [])
    ])];
    const tagNames = [];
    for (const id of tagIds) {
      const tag = resolveTag(id);
      if (tag?.name) tagNames.push(tag.name.toLowerCase());
    }
    const data = {
      titleLower: (item.title || '').toLowerCase(),
      urlLower: (item.url || '').toLowerCase(),
      tagIds,
      tagNames
    };
    perBoard.set(boardKey, data);
    return data;
  };

  const matchesText = (item, board, data) => {
    if (!typeAllowed(item)) return false;
    if (!q) return true;
    if (searchFilters.name && data.titleLower.includes(q)) return true;
    if (searchFilters.url && data.urlLower && data.urlLower.includes(q)) return true;
    if (searchFilters.tags && data.tagNames.some(name => name.includes(q))) return true;
    return false;
  };

  const matchesTagFilter = data => {
    if (!hasTagFilters) return true;
    if (_tagFilterMode === 'and') return [...activeTagFilters].every(id => data.tagIds.includes(id));
    return [...activeTagFilters].some(id => data.tagIds.includes(id));
  };

  const buildSearchIndex = () => {
    const index = [];
    const collectFromList = (items, board, columnId) => {
    const hits = [];
    for (const item of (items || [])) {
      const childItems = item.type === 'folder'
        ? (isDynamicFolder(item) ? [] : (item.children || []))
        : item.children;
      if (item.type === 'title') {
        if (childItems) hits.push(...collectFromList(childItems, board, columnId));
        continue;
      }
      const data = getSearchData(item, board);
      hits.push({ item, meta: { area: 'board-item', boardId: board.id, columnId }, board, searchData: data });
      if (childItems) hits.push(...collectFromList(childItems, board, columnId));
    }
    return hits;
    };

    state.essentials.forEach((item, slot) => {
      if (!item) return;
      index.push({ item, meta: { area: 'essential', slot }, board: null, searchData: getSearchData(item, null) });
    });
    (state.sets || []).forEach(set => {
      const item = { id: set.id, type: 'set', title: set.title, itemCount: resolveSetItems(set).length };
      index.push({ item, meta: { area: 'set', setId: set.id }, board: null, searchData: getSearchData(item, null) });
    });
    for (const board of state.boards) {
      index.push({ item: board, meta: { area: 'board-item', boardId: board.id }, board: null, searchData: getSearchData(board, null) });
      board.speedDial.forEach(item => {
        if (item) index.push({ item, meta: { area: 'speed-dial-item', boardId: board.id }, board, searchData: getSearchData(item, board) });
      });
      for (const tab of getBoardTabs(board)) {
        (tab.columns || []).forEach(column => index.push(...collectFromList(column.items, board, column.id)));
        const inbox = getTabInbox(tab, tab.id);
        if (inbox) index.push(...collectFromList(inbox.items, board, inbox.id));
      }
    }
    const collectImports = items => {
      for (const item of (items || [])) {
        index.push({
          item,
          meta: { area: 'import-manager-item', itemId: item.id },
          board: null,
          searchData: getSearchData(item, null)
        });
        if (item.children) collectImports(item.children);
      }
    };
    collectImports(state.importManager?.items || []);
    return index;
  };

  if (searchIndexSequence !== mutationSequence) {
    searchIndexSequence = mutationSequence;
    persistentSearchIndex = buildSearchIndex();
  }
  const allBaseHits = persistentSearchIndex.filter(hit => matchesText(hit.item, hit.board, hit.searchData));

  const finalHits = hasTagFilters ? allBaseHits.filter(h => matchesTagFilter(h.searchData)) : allBaseHits;

  const groupMap = new Map();
  for (const h of finalHits) {
    const label = h.meta.area === 'essential'
      ? 'Essentials'
      : h.meta.area === 'set'
        ? 'Sets'
        : h.meta.area === 'import-manager-item'
          ? 'Import Manager'
        : (h.board?.title || state.boards.find(b => b.id === h.meta.boardId)?.title || '');
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
  for (const hit of baseHits) {
    for (const id of (hit.searchData?.tagIds || [])) {
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
  if (meta.area === 'set') return createSetSearchResultItem(item, meta);
  if (item.type === 'folder') return createFolderSearchResultItem(item, meta);
  if (item.type === 'board') return createBoardSearchResultItem(item, meta);

  const el = document.createElement('a');
  el.className = 'board-column-item bookmark-item';
  el.href = item.url || '#';
  el.target = '_blank';
  el.rel = 'noreferrer noopener';
  el.draggable = false;
  el.dataset.bookmarkId = item.id || '';
  el.dataset.tooltip = buildTooltip(item);
  el.dataset.tooltipKind = 'bookmark';
  el.addEventListener('click', () => recordBookmarkOpen(item));
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

function createSetSearchResultItem(item, meta = {}) {
  const set = findSetById(meta.setId || item.id);
  const setItems = resolveSetItems(set);
  const el = document.createElement('div');
  el.className = 'board-column-item bookmark-item set-search-result';
  el.dataset.setId = meta.setId || item.id;
  el.draggable = false;
  el.style.cursor = 'pointer';
  el.dataset.tooltip = set ? `${set.title}\n${setItems.length} bookmark${setItems.length === 1 ? '' : 's'}` : (item.title || 'Set');
  el.addEventListener('contextmenu', e => handleSearchResultContextMenu(e, item, meta));
  el.addEventListener('click', () => {
    openSetById(meta.setId || item.id);
    closeSearchModal();
  });

  const header = document.createElement('div');
  header.className = 'item-header';
  const setIcon = document.createElement('span');
  setIcon.className = 'bookmark-favicon';
  setIcon.appendChild(icon('icon-set'));
  header.appendChild(setIcon);
  const name = document.createElement('span');
  name.className = 'bookmark-label';
  name.textContent = item.title || 'Untitled Set';
  header.appendChild(name);
  el.appendChild(header);

  const metaEl = document.createElement('span');
  metaEl.className = 'search-result-url';
  const count = setItems.length;
  metaEl.textContent = `${count} bookmark${count === 1 ? '' : 's'}`;
  el.appendChild(metaEl);

  if (setItems.length) {
    const preview = document.createElement('div');
    preview.className = 'sets-preview-strip';
    setItems.slice(0, 4).forEach(setItem => {
      const chip = document.createElement('span');
      chip.className = 'sets-preview-favicon';
      if (setItem.url) {
        const img = document.createElement('img');
        setFavicon(img, setItem, 32);
        img.alt = '';
        img.draggable = false;
        chip.appendChild(img);
      } else {
        chip.textContent = (setItem.title || '?').slice(0, 1).toUpperCase();
      }
      preview.appendChild(chip);
    });
    el.appendChild(preview);
  }

  return el;
}

function createFolderSearchResultItem(item, meta = {}) {
  const board = meta.boardId ? state.boards.find(entry => entry.id === meta.boardId) || null : null;
  const folderChildren = resolveFolderChildren(item, board);
  const bookmarkChildren = folderChildren.filter(child => child?.type === 'bookmark');
  const dynamicFolder = isDynamicFolder(item);
  const el = document.createElement('div');
  el.className = 'board-column-item folder-card';
  el.draggable = false;
  el.dataset.tooltip = item.title || 'Untitled Folder';
  el.addEventListener('contextmenu', e => handleSearchResultContextMenu(e, item, meta));

  const header = document.createElement('div');
  header.className = 'item-header';
  const folderIcon = dynamicFolder
    ? (item.collapsed ? 'icon-dynamic-folder-closed' : 'icon-dynamic-folder-open')
    : (item.collapsed ? 'icon-folder-closed' : 'icon-folder-open');
  header.appendChild(icon(folderIcon));
  const name = document.createElement('span');
  name.className = 'folder-title';
  name.textContent = item.title || 'Untitled Folder';
  header.appendChild(name);
  el.appendChild(header);

  const countEl = document.createElement('span');
  countEl.className = 'search-result-url';
  countEl.textContent = `${bookmarkChildren.length} bookmark${bookmarkChildren.length === 1 ? '' : 's'}`;
  el.appendChild(countEl);

  const allTags = [...(item.sharedTags || []), ...(item.tags || [])];
  if (allTags.length && state.settings.showFolderTags !== false) {
    const tagsEl = document.createElement('div');
    tagsEl.className = 'item-tag-chips';
    renderTagsInto(tagsEl, allTags);
    el.appendChild(tagsEl);
  }
  if (bookmarkChildren.length) {
    const preview = document.createElement('div');
    preview.className = 'sets-preview-strip';
    bookmarkChildren.slice(0, 4).forEach(bookmark => {
      const chip = document.createElement('span');
      chip.className = 'sets-preview-favicon';
      if (bookmark.url) {
        const img = document.createElement('img');
        setFavicon(img, bookmark, 32);
        img.alt = '';
        img.draggable = false;
        chip.appendChild(img);
      } else {
        chip.textContent = (bookmark.title || '?').slice(0, 1).toUpperCase();
      }
      preview.appendChild(chip);
    });
    el.appendChild(preview);
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
    if (!_activateBoardSelection(item.id)) {
      closeSearchModal();
      return;
    }
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

function _essentialsActivityDetail(viewId, result) {
  const formatDate = typeof _phaseOneFormatDate === 'function'
    ? _phaseOneFormatDate
    : timestamp => new Date(timestamp).toLocaleDateString();
  if (viewId === 'recent') return `Last opened ${formatDate(result.activity?.lastOpenedAt)}`;
  if (viewId === 'most-used') return `${result.activity?.openCount || 0} opens · Last ${formatDate(result.activity?.lastOpenedAt)}`;
  if (viewId === 'neglected') return `Last opened ${formatDate(result.activity?.lastOpenedAt)}`;
  if (viewId === 'added') return `Added ${formatDate(result.activity?.firstSeenAt)}`;
  return '';
}

function _renderEssentialsActivityView(viewId, displayCount) {
  const activity = getBookmarkActivityState();
  const results = getEssentialsActivityResults(viewId, { limit: displayCount });
  if (activity.trackingEnabled === false && viewId !== 'added') {
    const empty = document.createElement('div');
    empty.className = 'essentials-activity-empty';
    empty.textContent = 'Bookmark activity tracking is off.';
    elements.essentialsGrid.appendChild(empty);
    return;
  }
  if (!results.length) {
    const emptyMessages = {
      recent: 'No recently opened bookmarks yet.',
      'most-used': 'No bookmark usage recorded yet.',
      neglected: 'No neglected bookmarks.',
      added: 'No newly added bookmarks.'
    };
    const empty = document.createElement('div');
    empty.className = 'essentials-activity-empty';
    empty.textContent = emptyMessages[viewId] || 'No bookmarks to show.';
    elements.essentialsGrid.appendChild(empty);
    return;
  }

  for (const result of results) {
    const item = result.entry.item;
    const detail = _essentialsActivityDetail(viewId, result);
    const cell = document.createElement('div');
    cell.className = 'essential-slot filled essentials-activity-slot';
    cell.dataset.activityBookmarkId = item.id || '';

    const link = document.createElement('a');
    link.href = item.url;
    link.target = '_blank';
    link.rel = 'noreferrer noopener';
    link.dataset.bookmarkId = item.id || '';
    link.dataset.tooltip = [buildTooltip(item), detail, result.entry.location].filter(Boolean).join('\n');
    link.dataset.tooltipKind = 'bookmark';
    link.addEventListener('click', () => {
      recordBookmarkOpen(item);
      requestAnimationFrame(() => renderEssentials());
    });

    const img = document.createElement('img');
    setFavicon(img, item, 64);
    img.alt = item.title || '';
    img.draggable = false;
    link.appendChild(img);
    cell.appendChild(link);

    if (viewId === 'most-used') {
      const count = document.createElement('span');
      count.className = 'essentials-activity-count';
      count.textContent = String(result.activity?.openCount || 0);
      count.setAttribute('aria-hidden', 'true');
      cell.appendChild(count);
    }

    cell.addEventListener('contextmenu', event => handleEssentialsActivityContextMenu(event, result.entry));
    elements.essentialsGrid.appendChild(cell);
  }
}

function renderEssentials() {
  const section = document.getElementById('essentialsSection');
  const visible = state.settings.showEssentials !== false;
  if (section) section.classList.toggle('hidden', !visible);
  if (!visible) { elements.essentialsGrid.innerHTML = ''; return; }
  elements.essentialsGrid.innerHTML = '';
  const displayCount = state.settings.essentialsDisplayCount || 10;
  const viewId = typeof getEssentialsViewId === 'function' ? getEssentialsViewId() : 'essentials';
  section.dataset.essentialsView = viewId;
  elements.essentialsGrid.classList.toggle('is-activity-view', viewId !== 'essentials');
  if (typeof updateEssentialsViewControls === 'function') updateEssentialsViewControls();
  if (viewId !== 'essentials') {
    _renderEssentialsActivityView(viewId, displayCount);
    return;
  }
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
      link.dataset.bookmarkId = item.id || '';
      link.dataset.tooltip = buildTooltip(item);
      link.dataset.tooltipKind = 'bookmark';
      link.addEventListener('click', () => recordBookmarkOpen(item));

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
      event.dataTransfer.dropEffect = dragPayload ? _currentDropEffect() : 'copy';
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

let navWidgetReusePool = null;

function renderNav() {
  const reusableWidgets = new Map();
  elements.navList.querySelectorAll('.nav-widget-item[data-id]').forEach(element => {
    reusableWidgets.set(element.dataset.id, element);
    element.remove();
  });
  const nextWidgetIds = new Set();
  const collectWidgetIds = items => (items || []).forEach(item => {
    if (item?.type === 'widget') nextWidgetIds.add(item.id);
    if (item?.children) collectWidgetIds(item.children);
  });
  collectWidgetIds(state.navItems);
  for (const widgetId of reusableWidgets.keys()) {
    if (!nextWidgetIds.has(widgetId)) clearWidgetContextRuntime(widgetId, 'navpane');
  }
  navWidgetReusePool = reusableWidgets;
  elements.navList.innerHTML = '';
  const orderedItems = _orderedNavItemsForRender(state.navItems);
  if (orderedItems.some((item, index) => item !== state.navItems[index])) {
    state.navItems.splice(0, state.navItems.length, ...orderedItems);
  }
  const bottomGroup = document.createElement('div');
  bottomGroup.className = 'nav-bottom-widget-group';
  orderedItems.forEach(item => {
    const element = createNavItem(item);
    element.classList.remove('nav-widget-item--bottom');
    if (_isBottomAlignedNavWidget(item)) {
      element.classList.add('nav-widget-item--bottom');
      bottomGroup.appendChild(element);
    } else {
      elements.navList.appendChild(element);
    }
  });
  if (bottomGroup.childElementCount) elements.navList.appendChild(bottomGroup);
  navWidgetReusePool = null;
}

function _isBottomAlignedNavWidget(item) {
  return item?.type === 'widget' && item.config?.sidebarBottom === true;
}

function _orderedNavItemsForRender(items) {
  const list = Array.isArray(items) ? items : [];
  return [
    ...list.filter(item => !_isBottomAlignedNavWidget(item)),
    ...list.filter(item => _isBottomAlignedNavWidget(item))
  ];
}

function createNavItem(item, depth = 0, parent = null) {
  if (item.type === 'widget') {
    const reusable = navWidgetReusePool?.get(item.id) || null;
    const parentId = parent?.id || '';
    if (
      reusable
      && reusable.dataset.parentId === parentId
      && reusable.dataset.widgetRenderSignature === _widgetRenderSignature(item)
    ) return reusable;
    if (reusable) clearWidgetContextRuntime(item.id, 'navpane');
  }
  const el = document.createElement('div');
  el.className = 'nav-item';
  el.dataset.id = item.id;
  el.dataset.type = item.type;
  el.draggable = true;
  if (parent?.type === 'folder') el.classList.add('nav-folder-child');
  el.dataset.parentId = parent?.id || '';

  if (item.type === 'widget') {
    const def = WIDGET_REGISTRY[item.widgetType];
    el.classList.add('nav-widget-item');
    if (def) {
      const body = document.createElement('div');
      body.className = 'nav-widget-body';
      _appendWidgetActionButtons(el, item, body, 'navpane', {
        sidebarBottomAvailable: !parent,
        onSettingsRefresh: () => renderNav()
      });
      el.appendChild(body);
      if (typeof WidgetSDK !== 'undefined') WidgetSDK.runtime.render(def, item, body, 'navpane');
      else def.render(item, body, 'navpane');
      el.dataset.widgetRenderSignature = _widgetRenderSignature(item);
    }
    let dragStartedOnInteractiveControl = false;
    el.addEventListener('mousedown', event => {
      dragStartedOnInteractiveControl = _widgetInteractiveDragTarget(event.target);
    }, true);
    el.addEventListener('mouseup', () => { dragStartedOnInteractiveControl = false; }, true);
    el.addEventListener('contextmenu', e => {
      if (_widgetInteractiveDragTarget(e.target)) { e.stopPropagation(); return; }
      e.preventDefault();
      e.stopPropagation();
      handleNavContextMenu(e, item, parent, depth);
    });
    el.addEventListener('dragstart', e => {
      if (dragStartedOnInteractiveControl || _widgetInteractiveDragTarget(e.target)) {
        e.preventDefault();
        dragStartedOnInteractiveControl = false;
        return;
      }
      e.stopPropagation();
      dragPayload = { area: 'nav', itemId: item.id, itemType: 'widget', widgetType: item.widgetType, parentId: parent ? parent.id : null };
      e.dataTransfer.setData('text/plain', item.id);
      e.dataTransfer.effectAllowed = 'move';
      applyDragImage(e, el);
    });
    el.addEventListener('dragend', () => { dragStartedOnInteractiveControl = false; el.classList.remove('dragging'); dragPayload = null; removeDragPlaceholders(); });
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
  } else {
    if (item.type !== 'title' || item.title) {
      if (item.type === 'board') {
        if (item.boardId === state.activeBoardId) el.classList.add('active');
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
      if (board) {
        pushUndoSnapshot();
        board.locked = !board.locked;
        renderAll();
        saveState();
      }
    });
    el.appendChild(lockBtn);
    el.addEventListener('click', () => {
      if (item.boardId) {
        state.activeBoardId = item.boardId;
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
  const shell = elements.appShell;
  const mp = elements.mainPanel;
  const backgroundImage = board.backgroundImage ? `url(${JSON.stringify(board.backgroundImage)})` : '';
  const backgroundFit = board.backgroundFit === 'contain'
    ? 'contain'
    : board.backgroundFit === 'fill'
      ? '100% 100%'
      : 'cover';
  const containerAlpha = (board.containerOpacity ?? 100) / 100;
  const sidebarAlpha = resolveSidebarContainerAlpha(board);
  const uiPanelAlpha = resolveUiPanelAlpha();
  document.documentElement.style.setProperty('--container-alpha', containerAlpha);
  document.documentElement.style.setProperty('--sidebar-container-alpha', sidebarAlpha);
  document.documentElement.style.setProperty('--ui-panel-alpha', uiPanelAlpha);
  if (shell) {
    shell.style.backgroundImage = backgroundImage;
    shell.style.backgroundSize = backgroundFit;
    shell.style.setProperty('--container-alpha', containerAlpha);
    shell.style.setProperty('--sidebar-container-alpha', sidebarAlpha);
  }
  mp.style.backgroundImage = '';
  mp.style.backgroundSize = '';
  mp.style.setProperty('--container-alpha', containerAlpha);
}

function _clearBoardShellDropDecorations() {
  document.querySelectorAll('#collectionTabBar .drop-position-before, #collectionTabBar .drop-position-after, #tabSetBar .drop-position-before, #tabSetBar .drop-position-after').forEach(el => {
    el.classList.remove('drop-position-before', 'drop-position-after');
    el.removeAttribute('data-drop-position');
  });
}

function _createBoardShellPreview(selector, fallbackFactory = null) {
  const sourceEl = selector ? document.querySelector(selector) : null;
  let preview = sourceEl ? sourceEl.cloneNode(true) : (fallbackFactory ? fallbackFactory() : null);
  if (!preview) return null;
  preview.classList.add('drag-preview');
  preview.classList.remove('active', 'dragging', 'drop-position-before', 'drop-position-after');
  preview.removeAttribute('draggable');
  preview.dataset.previewAxis = 'h';
  return preview;
}

function _moveBoardShellPreview(parentEl, beforeEl, preview) {
  _clearDropDecorations(false);
  _clearBoardShellDropDecorations();
  const existing = parentEl.querySelector(':scope > .drag-preview');
  if (existing) {
    parentEl.insertBefore(existing, beforeEl || null);
    return;
  }
  if (!preview) return;
  _insertDragPreview(preview, parentEl, beforeEl);
}

function _resolveHorizontalDrop(itemEls, clientX, clientY = null) {
  let nearestEl = null;
  let nearestPos = 'after';
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const el of itemEls) {
    const rect = el.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const dx = clientX - centerX;
    const dy = clientY === null ? 0 : (clientY - centerY);
    const distance = (dx * dx) + (dy * dy);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestEl = el;
      nearestPos = clientX < centerX ? 'before' : 'after';
    }
  }
  return { nearestEl, nearestPos };
}

function _findBarItemAtPoint(itemEls, clientX, clientY) {
  return itemEls.find(el => {
    const rect = el.getBoundingClientRect();
    return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
  }) || null;
}

function _setTabDropDecoration(tabEl, position) {
  if (!tabEl) return;
  tabEl.dataset.dropPosition = position;
  tabEl.classList.toggle('drop-position-before', position === 'before');
  tabEl.classList.toggle('drop-position-after', position === 'after');
}

function _handleBoardTabBarDragOver(event, board, activeTab) {
  const tabBar = elements.collectionTabBar;
  if (!tabBar || !board || !Array.isArray(board.tabs)) return;
  if (board.locked) return;
  const isInternalTab = dragPayload?.area === 'board-tab' && dragPayload?.boardId === board.id;
  if (!isInternalTab) return;
  event.preventDefault();
  event.stopPropagation();
  event.dataTransfer.dropEffect = 'move';

  const itemEls = Array.from(tabBar.querySelectorAll(':scope > .collection-tab[data-tab-id]:not(.drag-preview):not(.dragging)'));
  const { nearestEl, nearestPos } = _resolveHorizontalDrop(itemEls, event.clientX, event.clientY);
  const beforeEl = nearestEl ? (nearestPos === 'before' ? nearestEl : nearestEl.nextSibling) : tabBar.querySelector('.collection-tab-add') || null;
  const keyTarget = nearestEl ? `${nearestEl.dataset.tabId}:${nearestPos}` : 'end';
  if (_dropTarget === keyTarget) return;
  _dropTarget = keyTarget;
  _dropPos = nearestPos;
  const preview = _createBoardShellPreview(`#collectionTabBar .collection-tab[data-tab-id="${CSS.escape(dragPayload.tabId)}"]`);
  _moveBoardShellPreview(tabBar, beforeEl, preview);
  if (nearestEl) _setTabDropDecoration(nearestEl, nearestPos);
}

function _handleBoardTabBarDrop(event, board) {
  const tabBar = elements.collectionTabBar;
  if (!tabBar || !board) return;
  if (board.locked) return;
  const isInternalTab = dragPayload?.area === 'board-tab' && dragPayload?.boardId === board.id;
  if (!isInternalTab) return;
  event.preventDefault();
  event.stopPropagation();

  const preview = tabBar.querySelector(':scope > .drag-preview');
  const targetEl = _findBarItemAtPoint(
    Array.from(tabBar.querySelectorAll(':scope > .collection-tab[data-tab-id]:not(.drag-preview):not(.dragging)')),
    event.clientX,
    event.clientY
  );
  let position = 'after';
  let targetTabId = null;
  if (targetEl) {
    const rect = targetEl.getBoundingClientRect();
    position = event.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
    targetTabId = targetEl.dataset.tabId;
  } else if (preview?.nextElementSibling?.dataset?.tabId) {
    position = 'before';
    targetTabId = preview.nextElementSibling.dataset.tabId;
  }

  removeDragPlaceholders();
  _clearBoardShellDropDecorations();
  if (!dragPayload) return;
  if (dragPayload.tabId === targetTabId && position !== 'after') { dragPayload = null; return; }
  pushUndoSnapshot();
  reorderBoardTab(board, dragPayload.tabId, targetTabId, position);
  dragPayload = null;
  renderAll();
  saveState();
}

function _handleTabSetBarDragOver(event, board, activeTab) {
  const setBar = elements.tabSetBar;
  if (!setBar || !board || !activeTab) return;
  if (board.locked) return;
  const isInternalSet = dragPayload?.area === 'tab-set-link' && dragPayload?.boardId === board.id && dragPayload?.tabId === activeTab.id;
  const isManagerSet = dragPayload?.area === 'set-row';
  if (!isInternalSet && !isManagerSet) return;
  event.preventDefault();
  event.stopPropagation();
  event.dataTransfer.dropEffect = isInternalSet ? 'move' : 'copy';

  const itemEls = Array.from(setBar.querySelectorAll(':scope > .set-bar-item[data-set-id]:not(.drag-preview):not(.dragging)'));
  const { nearestEl, nearestPos } = _resolveHorizontalDrop(itemEls, event.clientX);
  const beforeEl = nearestEl ? (nearestPos === 'before' ? nearestEl : nearestEl.nextSibling) : setBar.querySelector('.collection-tab-add') || null;
  const keyTarget = nearestEl ? `${nearestEl.dataset.setId}:${nearestPos}` : 'end';
  if (_dropTarget === keyTarget) return;
  _dropTarget = keyTarget;
  _dropPos = nearestPos;
  const preview = isInternalSet
    ? _createBoardShellPreview(`#tabSetBar .set-bar-item[data-set-id="${CSS.escape(dragPayload.setId)}"]`)
    : _createBoardShellPreview(`.sets-manager-row[data-set-id="${CSS.escape(dragPayload.setId)}"]`, () => {
        const set = findSetById(dragPayload.setId);
        const setItems = resolveSetItems(set);
        const el = document.createElement('div');
        el.className = 'collection-tab set-bar-item';
        const iconEl = document.createElement('span');
        iconEl.className = 'collection-tab-icon';
        iconEl.appendChild(icon('icon-set'));
        el.appendChild(iconEl);
        const label = document.createElement('span');
        label.className = 'collection-tab-label';
        label.textContent = set?.title || 'Untitled Set';
        el.appendChild(label);
        const count = document.createElement('span');
        count.className = 'set-bar-item-count';
        count.textContent = `${setItems.length}`;
        el.appendChild(count);
        return el;
      });
  _moveBoardShellPreview(setBar, beforeEl, preview);
  if (nearestEl) _setTabDropDecoration(nearestEl, nearestPos);
}

function _handleTabSetBarDrop(event, board, activeTab) {
  const setBar = elements.tabSetBar;
  if (!setBar || !board || !activeTab) return;
  if (board.locked) return;
  const isInternalSet = dragPayload?.area === 'tab-set-link' && dragPayload?.boardId === board.id && dragPayload?.tabId === activeTab.id;
  const isManagerSet = dragPayload?.area === 'set-row';
  if (!isInternalSet && !isManagerSet) return;
  event.preventDefault();
  event.stopPropagation();

  const preview = setBar.querySelector(':scope > .drag-preview');
  const targetEl = Array.from(setBar.querySelectorAll(':scope > .set-bar-item[data-set-id]:not(.drag-preview):not(.dragging)')).find(el => {
    const rect = el.getBoundingClientRect();
    return event.clientX >= rect.left && event.clientX <= rect.right;
  }) || null;
  let position = 'after';
  let targetSetId = null;
  if (targetEl) {
    const rect = targetEl.getBoundingClientRect();
    position = event.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
    targetSetId = targetEl.dataset.setId;
  } else if (preview?.nextElementSibling?.dataset?.setId) {
    position = 'before';
    targetSetId = preview.nextElementSibling.dataset.setId;
  }

  const draggedSetId = dragPayload?.setId || null;
  removeDragPlaceholders();
  _clearBoardShellDropDecorations();
  if (!draggedSetId) { dragPayload = null; return; }
  pushUndoSnapshot();
  insertSetLinkIntoTab(activeTab, draggedSetId, targetSetId, position);
  syncBoardCompatibilityFields(board, activeTab.id);
  dragPayload = null;
  renderAll();
  saveState();
}

function renderBoardTabBar(board, activeTab) {
  const tabBar = elements.collectionTabBar;
  if (!tabBar) return;
  tabBar.innerHTML = '';
  if (!board) {
    tabBar.classList.add('hidden');
    return;
  }

  tabBar.classList.remove('hidden');
  tabBar.classList.toggle('collection-tab-bar--wrap', board.wrapTabBar === true);

  (board.tabs || []).forEach(tab => {
    const tabEl = document.createElement('div');
    tabEl.className = 'collection-tab' + (tab.id === activeTab?.id ? ' active' : '');
    tabEl.dataset.tabId = tab.id;
    tabEl.draggable = !board.locked;

    const label = document.createElement('span');
    label.className = 'collection-tab-label';
    label.textContent = tab.title || 'Untitled Tab';
    tabEl.appendChild(label);

    const counts = getBoardInboxCounts(board, tab);
    if (counts.bookmarks + counts.folders > 0) {
      const indicator = document.createElement('span');
      indicator.className = 'collection-tab-inbox-indicator';
      indicator.title = 'Inbox has items';
      tabEl.appendChild(indicator);
    }

    tabEl.addEventListener('click', () => {
      if (state.activeTabId === tab.id) return;
      state.activeTabId = tab.id;
      renderAll();
      saveState();
    });
    tabEl.addEventListener('contextmenu', event => {
      event.preventDefault();
      event.stopPropagation();
      if (board.locked) return;
      contextTarget = { area: 'board-tab', boardId: board.id, tabId: tab.id, item: tab };
      const actions = [
        { label: 'Edit tab', action: 'editBoardTab' },
        { label: 'Delete tab', action: 'deleteBoardTab' }
      ];
      showContextMenu(event.clientX, event.clientY, actions);
    });
    tabEl.addEventListener('dragover', event => handleBoardTabInboxDragOver(event, board, tab));
    tabEl.addEventListener('dragleave', event => {
      if (!tabEl.contains(event.relatedTarget)) tabEl.classList.remove('drop-target');
    });
    tabEl.addEventListener('drop', event => handleBoardTabInboxDrop(event, board, tab));
    tabEl.addEventListener('dragstart', event => {
      if (board.locked) { event.preventDefault(); return; }
      dragPayload = { area: 'board-tab', boardId: board.id, tabId: tab.id };
      event.dataTransfer.setData('text/plain', tab.id);
      event.dataTransfer.effectAllowed = 'move';
      applyDragImage(event, tabEl);
      requestAnimationFrame(() => tabEl.classList.add('dragging'));
    });
    tabEl.addEventListener('dragend', () => {
      tabEl.classList.remove('dragging');
      dragPayload = null;
      removeDragPlaceholders();
      _clearBoardShellDropDecorations();
    });

    tabBar.appendChild(tabEl);
  });

  const addBtn = document.createElement('div');
  addBtn.className = 'collection-tab-add';
  addBtn.title = 'New Tab';
  addBtn.appendChild(icon('icon-board-add'));
  addBtn.addEventListener('click', () => {
    if (board.locked) return;
    pushUndoSnapshot();
    createBoardTab(board, 'New Tab');
    renderAll();
    saveState();
    showBoardSettingsPanel(true);
  });
  addBtn.addEventListener('contextmenu', event => {
    event.preventDefault();
    event.stopPropagation();
    if (board.locked) return;
    contextTarget = { area: 'board-tab-bar', boardId: board.id };
    showContextMenu(event.clientX, event.clientY, [{ label: 'New Tab', action: 'addBoardTab' }]);
  });
  tabBar.appendChild(addBtn);

  const spacer = document.createElement('div');
  spacer.className = 'collection-tab-bar-spacer';
  tabBar.appendChild(spacer);

  const actionGroup = document.createElement('div');
  actionGroup.className = 'collection-tab-actions';
  tabBar.appendChild(actionGroup);

  const settingsBtn = document.createElement('button');
  settingsBtn.type = 'button';
  settingsBtn.className = 'collection-tab-settings-btn';
  settingsBtn.title = activeTab ? 'Tab settings' : 'No active tab';
  settingsBtn.setAttribute('aria-label', activeTab ? 'Tab settings' : 'No active tab');
  settingsBtn.disabled = board.locked || !activeTab;
  settingsBtn.appendChild(icon('icon-settings'));
  settingsBtn.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    if (board.locked || !activeTab) return;
    if (_activateBoardSelection(board.id, activeTab.id)) {
      renderAll();
      saveState();
    }
    showBoardSettingsPanel();
  });
  const setBarToggleBtn = elements.setBarToggleBtn;
  if (setBarToggleBtn) {
    const setBarToggleLabel = !activeTab
      ? 'No active tab'
      : (activeTab.showSetBar === false ? 'Show set bar' : 'Hide set bar');
    setBarToggleBtn.className = 'icon-btn collection-tab-settings-btn collection-tab-set-toggle';
    setBarToggleBtn.title = setBarToggleLabel;
    setBarToggleBtn.setAttribute('aria-label', setBarToggleLabel);
    setBarToggleBtn.disabled = !!board.locked || !activeTab;
    actionGroup.appendChild(setBarToggleBtn);
  }

  actionGroup.appendChild(settingsBtn);

  tabBar.oncontextmenu = event => {
    if (event.target.closest('.collection-tab, .collection-tab-add, .collection-tab-settings-btn')) return;
    event.preventDefault();
    if (board.locked) return;
    contextTarget = { area: 'board-tab-bar', boardId: board.id };
    showContextMenu(event.clientX, event.clientY, [{ label: 'New Tab', action: 'addBoardTab' }]);
  };
  tabBar.ondragover = event => _handleBoardTabBarDragOver(event, board, activeTab);
  tabBar.ondragleave = event => {
    if (tabBar.contains(event.relatedTarget)) return;
    removeDragPlaceholders();
    _clearBoardShellDropDecorations();
  };
  tabBar.ondrop = event => _handleBoardTabBarDrop(event, board);
}

function renderTabSetBar(board, activeTab) {
  const setBar = elements.tabSetBar;
  if (!setBar) return;
  setBar.innerHTML = '';
  if (!board || !activeTab || activeTab.showSetBar === false) {
    setBar.classList.add('hidden');
    return;
  }

  setBar.classList.remove('hidden');
  const setIds = Array.isArray(activeTab.setBar) ? activeTab.setBar : [];
  const linkedSets = setIds
    .map(setId => findSetById(setId))
    .filter(Boolean);

  linkedSets.forEach(set => {
    const setItems = resolveSetItems(set);
    const setEl = document.createElement('div');
    setEl.className = 'collection-tab set-bar-item';
    setEl.dataset.setId = set.id;
    setEl.draggable = !board.locked;

    const iconEl = document.createElement('span');
    iconEl.className = 'collection-tab-icon';
    iconEl.appendChild(icon('icon-set'));
    setEl.appendChild(iconEl);

    const label = document.createElement('span');
    label.className = 'collection-tab-label';
    label.textContent = set.title || 'Untitled Set';
    setEl.appendChild(label);

    const count = document.createElement('span');
    count.className = 'set-bar-item-count';
    count.textContent = `${setItems.length}`;
    setEl.appendChild(count);

    setEl.addEventListener('click', () => openSetById(set.id));
    setEl.addEventListener('contextmenu', event => {
      event.preventDefault();
      event.stopPropagation();
      contextTarget = { area: 'tab-set-link', boardId: board.id, tabId: activeTab.id, setId: set.id, item: set };
      const actions = [
        { label: 'Open set', action: 'openSet' },
        { label: 'Manage set', action: 'editSet' }
      ];
      if (!board.locked) actions.push({ label: 'Remove from bar', action: 'removeSetFromTabBar' });
      showContextMenu(event.clientX, event.clientY, actions);
    });
    setEl.addEventListener('dragstart', event => {
      if (board.locked) { event.preventDefault(); return; }
      dragPayload = { area: 'tab-set-link', boardId: board.id, tabId: activeTab.id, setId: set.id };
      event.dataTransfer.setData('text/plain', set.id);
      event.dataTransfer.effectAllowed = 'move';
      applyDragImage(event, setEl);
      requestAnimationFrame(() => setEl.classList.add('dragging'));
    });
    setEl.addEventListener('dragend', () => {
      setEl.classList.remove('dragging');
      dragPayload = null;
      removeDragPlaceholders();
      _clearBoardShellDropDecorations();
    });

    setBar.appendChild(setEl);
  });

  const availableSetActions = (state.sets || [])
    .filter(set => !setIds.includes(set.id))
    .sort((a, b) => (a.title || '').localeCompare(b.title || ''))
    .map(set => ({ label: set.title || 'Untitled Set', action: `addSetToTabBar:${set.id}` }));

  const addBtn = document.createElement('div');
  addBtn.className = 'collection-tab-add';
  addBtn.title = 'Add set to tab bar';
  addBtn.appendChild(icon('icon-set'));
  addBtn.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    if (board.locked) return;
    contextTarget = { area: 'tab-set-bar', boardId: board.id, tabId: activeTab.id };
    const rect = addBtn.getBoundingClientRect();
    showContextMenu(rect.left, rect.bottom + 4, availableSetActions.length ? availableSetActions : [{ label: 'No unlinked sets available', action: '' }]);
  });
  addBtn.addEventListener('contextmenu', event => {
    event.preventDefault();
    event.stopPropagation();
    if (board.locked) return;
    contextTarget = { area: 'tab-set-bar', boardId: board.id, tabId: activeTab.id };
    showContextMenu(event.clientX, event.clientY, availableSetActions.length ? availableSetActions : [{ label: 'No unlinked sets available', action: '' }]);
  });
  setBar.appendChild(addBtn);
  setBar.ondragover = event => _handleTabSetBarDragOver(event, board, activeTab);
  setBar.ondragleave = event => {
    if (setBar.contains(event.relatedTarget)) return;
    removeDragPlaceholders();
    _clearBoardShellDropDecorations();
  };
  setBar.ondrop = event => _handleTabSetBarDrop(event, board, activeTab);
}

function renderBoard(options = {}) {
  if (!options.reuseDerivedCaches) invalidateDerivedCaches();
  const board = state.activeBoardId
    ? state.boards.find(entry => entry.id === state.activeBoardId) || null
    : null;
  let activeTab = null;
  if (board) {
    activeTab = getBoardTab(board, state.activeTabId);
    if (activeTab) {
      if (state.activeTabId !== activeTab.id) state.activeTabId = activeTab.id;
      syncBoardCompatibilityFields(board, activeTab.id);
    }
  }

  renderBoardTabBar(board, activeTab);
  renderTabSetBar(board, activeTab);
  const hasShellBars = !!(board && (((board.tabs || []).length > 0) || !activeTab || (activeTab && activeTab.showSetBar !== false)));
  elements.mainPanel.classList.toggle('has-context-tabs', !!hasShellBars);

  if (!board) {
    elements.mainPanel.classList.add('no-board');
    elements.mainPanel.style.backgroundImage = '';
    document.documentElement.style.setProperty('--container-alpha', 1);
    document.documentElement.style.setProperty('--sidebar-container-alpha', resolveSidebarContainerAlpha(null));
    document.documentElement.style.setProperty('--ui-panel-alpha', resolveUiPanelAlpha());
    if (elements.appShell) {
      elements.appShell.style.backgroundImage = '';
      elements.appShell.style.setProperty('--sidebar-container-alpha', resolveSidebarContainerAlpha(null));
    }
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
  elements.bookmarkColumns.style.setProperty('--columns', activeTab?.columnCount || Math.max(1, board.columnCount || 1));
  applyBoardBackground(board);
  elements.boardSettingsBtn.disabled = !!board.locked;
  elements.speedDialToggleBtn?.classList.toggle('is-inactive', board.showSpeedDial === false);
  elements.setBarToggleBtn?.classList.toggle('is-inactive', activeTab?.showSetBar === false);
  const inboxUnavailable = !!board.locked || !activeTab;
  elements.inboxBtn.disabled = inboxUnavailable;
  if (inboxUnavailable && typeof inboxPanelOpen !== 'undefined' && inboxPanelOpen) hideInboxPanel();

  const speedDialPanel = elements.mainPanel.querySelector('.speed-dial-panel');
  if (speedDialPanel) speedDialPanel.classList.toggle('hidden', board.showSpeedDial === false);
  renderSpeedDial(board, false);

  renderColumns(board, activeTab);
}

function renderSpeedDial(board) {
  elements.speedDial.innerHTML = '';
  normalizeSpeedDialSlots(board);
  const slotCount = getSpeedDialSlotCount(board);
  for (let slot = 0; slot < slotCount; slot++) {
    const item = board.speedDial[slot] || null;
    const cell = document.createElement('div');
    cell.className = `speed-slot ${item ? 'filled' : 'empty'}`;
    cell.dataset.slot = slot;
    cell.addEventListener('contextmenu', event => {
      event.preventDefault();
      event.stopPropagation();
      if (item) {
        if (!getActiveBoard()?.locked) handleSpeedDialContextMenu(event, item, slot);
      } else {
        if (getActiveBoard()?.locked) return;
        contextTarget = { area: 'speed-dial', slot };
        showContextMenu(event.clientX, event.clientY, [
          { label: 'Add bookmark', action: 'addSpeedDialBookmark' }
        ]);
      }
    });
    cell.addEventListener('dragover', event => handleSpeedDialSlotDragOver(event, board, slot, false));
    cell.addEventListener('dragleave', () => {
      cell.classList.remove('drop-target');
      cell.querySelectorAll('.drag-preview').forEach(el => el.remove());
    });
    cell.addEventListener('drop', event => handleSpeedDialSlotDrop(event, board, slot, false));

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
    link.dataset.bookmarkId = item.id || '';
    link.dataset.tooltip = buildTooltip(item, board);
    link.dataset.tooltipKind = 'bookmark';
    link.addEventListener('click', () => recordBookmarkOpen(item));

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
      if (board?.locked) { event.preventDefault(); return; }
      event.stopPropagation();
      dragPayload = { area: 'speed-dial', itemId: item.id, slot };
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

function renderColumns(board, activeTab = null) {
  const reusableWidgets = new Map();
  elements.bookmarkColumns.querySelectorAll('.widget-card[data-item-id]').forEach(element => {
    reusableWidgets.set(element.dataset.itemId, element);
    element.remove();
  });
  elements.bookmarkColumns.innerHTML = '';
  const columns = activeTab?.columns || board.columns || [];
  const nextWidgetIds = new Set(columns.flatMap(column => (column.items || []))
    .filter(item => item?.type === 'widget')
    .map(item => item.id));
  for (const [widgetId] of reusableWidgets) {
    if (!nextWidgetIds.has(widgetId)) clearWidgetContextRuntime(widgetId, 'column');
  }
  columns.forEach(column => {
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

    column.items.forEach(item => {
      const reusable = item?.type === 'widget' ? reusableWidgets.get(item.id) : null;
      const canReuse = reusable
        && reusable.dataset.columnId === column.id
        && reusable.dataset.widgetRenderSignature === _widgetRenderSignature(item);
      if (canReuse) {
        columnEl.appendChild(reusable);
        requestAnimationFrame(() => resizeWidgetRuntime(item.id));
      } else {
        if (reusable) clearWidgetContextRuntime(item.id, 'column');
        columnEl.appendChild(createBoardItemElement(item, column.id, 1, null));
      }
    });
    if (column.items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'column-empty-state';
      empty.textContent = 'Right-click to add';
      columnEl.appendChild(empty);
    }
    elements.bookmarkColumns.appendChild(columnEl);
  });
}
