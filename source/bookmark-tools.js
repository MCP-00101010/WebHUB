const BOOKMARK_ACTIVITY_STORAGE_KEY = 'morpheus-webhub-bookmark-activity-v1';
const BOOKMARK_MAINTENANCE_STORAGE_KEY = 'morpheus-webhub-bookmark-maintenance-v1';
const BOOKMARK_ACTIVITY_HISTORY_LIMIT = 20;
const DEFAULT_TRACKING_PARAMETERS = Object.freeze([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id',
  'fbclid', 'gclid', 'dclid', 'gbraid', 'wbraid', 'mc_cid', 'mc_eid'
]);
const ESSENTIALS_VIEW_DEFINITIONS = Object.freeze([
  { id: 'essentials', label: 'Essentials' },
  { id: 'recent', label: 'Recently Opened', days: 30 },
  { id: 'most-used', label: 'Most Used', days: 'all' },
  { id: 'neglected', label: 'Neglected', days: 90 },
  { id: 'added', label: 'Newly Added', days: 30 }
]);
const SMART_VIEW_DEFINITIONS = Object.freeze([
  { id: 'recent', label: 'Recently Opened' },
  { id: 'most-used', label: 'Most Used' },
  { id: 'neglected', label: 'Neglected' },
  { id: 'never-opened', label: 'Never Opened' },
  { id: 'added', label: 'Added Recently' },
  { id: 'duplicates', label: 'Duplicates' },
  { id: 'broken', label: 'Broken Links' },
  { id: 'redirected', label: 'Redirected' },
  { id: 'missing-favicon', label: 'Missing Favicons' }
]);

let bookmarkActivityCache = null;
let bookmarkMaintenanceCache = null;
let activeHubToolsTab = 'smart';
let activeSmartViewId = 'recent';
let activeMaintenanceViewId = 'host';
let pendingHostMigrationPlan = [];
let pendingTrackingCleanupPlan = [];
let activeHealthScanController = null;
let activeFaviconInspectionPromise = null;
let phaseOneFeaturesInitialized = false;

function _phaseOneReadJsonStorage(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null');
    return value && typeof value === 'object' ? value : fallback;
  } catch {
    return fallback;
  }
}

function _phaseOneWriteJsonStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    console.warn(`Morpheus: failed to store ${key}`, error);
    return false;
  }
}

function getBookmarkActivityState() {
  if (bookmarkActivityCache) return bookmarkActivityCache;
  const stored = _phaseOneReadJsonStorage(BOOKMARK_ACTIVITY_STORAGE_KEY, {});
  bookmarkActivityCache = {
    version: 1,
    trackingEnabled: stored.trackingEnabled !== false,
    essentialsView: ESSENTIALS_VIEW_DEFINITIONS.some(definition => definition.id === stored.essentialsView)
      ? stored.essentialsView
      : 'essentials',
    bookmarks: stored.bookmarks && typeof stored.bookmarks === 'object' ? stored.bookmarks : {}
  };
  return bookmarkActivityCache;
}

function saveBookmarkActivityState() {
  return _phaseOneWriteJsonStorage(BOOKMARK_ACTIVITY_STORAGE_KEY, getBookmarkActivityState());
}

function getEssentialsViewDefinition(viewId = getBookmarkActivityState().essentialsView) {
  return ESSENTIALS_VIEW_DEFINITIONS.find(definition => definition.id === viewId) || ESSENTIALS_VIEW_DEFINITIONS[0];
}

function getEssentialsViewId() {
  return getEssentialsViewDefinition().id;
}

function setEssentialsView(viewId, options = {}) {
  const definition = getEssentialsViewDefinition(viewId);
  const activity = getBookmarkActivityState();
  activity.essentialsView = definition.id;
  saveBookmarkActivityState();
  if (options.render !== false && typeof renderEssentials === 'function') renderEssentials();
  return definition.id;
}

function cycleEssentialsView(direction = 1) {
  const currentIndex = ESSENTIALS_VIEW_DEFINITIONS.findIndex(definition => definition.id === getEssentialsViewId());
  const offset = Number(direction) < 0 ? -1 : 1;
  const nextIndex = (currentIndex + offset + ESSENTIALS_VIEW_DEFINITIONS.length) % ESSENTIALS_VIEW_DEFINITIONS.length;
  return setEssentialsView(ESSENTIALS_VIEW_DEFINITIONS[nextIndex].id);
}

function getEssentialsActivityResults(viewId, options = {}) {
  const definition = getEssentialsViewDefinition(viewId);
  if (definition.id === 'essentials') return [];
  return getSmartViewResults(definition.id, {
    root: options.root || state,
    now: options.now || Date.now(),
    days: definition.days,
    limit: options.limit || 10
  });
}

function getBookmarkMaintenanceState() {
  if (bookmarkMaintenanceCache) return bookmarkMaintenanceCache;
  const stored = _phaseOneReadJsonStorage(BOOKMARK_MAINTENANCE_STORAGE_KEY, {});
  bookmarkMaintenanceCache = {
    version: 1,
    health: stored.health && typeof stored.health === 'object' ? stored.health : {},
    ignoredDuplicateUrls: Array.isArray(stored.ignoredDuplicateUrls) ? stored.ignoredDuplicateUrls : [],
    ignoredHealthUrls: Array.isArray(stored.ignoredHealthUrls) ? stored.ignoredHealthUrls : []
  };
  for (const record of Object.values(bookmarkMaintenanceCache.health)) {
    if (record?.state === 'network-error' && /bridge error|extension relay|not registered|unsupported message/i.test(record.error || '')) {
      record.state = 'unavailable';
      record.error = 'Link Health was unavailable in the installed extension. Reload or update the extension, then scan again.';
    }
  }
  return bookmarkMaintenanceCache;
}

function saveBookmarkMaintenanceState() {
  return _phaseOneWriteJsonStorage(BOOKMARK_MAINTENANCE_STORAGE_KEY, getBookmarkMaintenanceState());
}

function _phaseOneInferCreatedAt(itemId, fallback = Date.now()) {
  const matches = String(itemId || '').match(/\d{13}/g) || [];
  for (const match of matches) {
    const timestamp = Number(match);
    if (timestamp >= 946684800000 && timestamp <= Date.now() + 86400000) return timestamp;
  }
  return fallback;
}

function _phaseOneBookmarkEntryKey(area, item, parts = []) {
  return [area, ...parts, item?.id || item?.url || 'bookmark'].join(':');
}

function collectStoredBookmarks(root = state) {
  const entries = [];
  const seenItems = new WeakSet();

  const addEntry = (item, metadata, parentList = null, slotMode = false) => {
    if (!item || item.type !== 'bookmark' || !item.url || seenItems.has(item)) return;
    seenItems.add(item);
    const entry = {
      key: metadata.key,
      item,
      area: metadata.area,
      location: metadata.location,
      boardId: metadata.boardId || '',
      tabId: metadata.tabId || '',
      columnId: metadata.columnId || '',
      setId: metadata.setId || '',
      parentId: metadata.parentId || '',
      locked: metadata.locked === true,
      parentList,
      remove() {
        if (!parentList) return false;
        const index = parentList.indexOf(item);
        if (index === -1) return false;
        if (slotMode) parentList[index] = null;
        else parentList.splice(index, 1);
        return true;
      }
    };
    entries.push(entry);
  };

  const walkItems = (items, metadata, folderPath = [], inheritedLocked = false, parentId = '') => {
    for (const item of (items || [])) {
      if (!item) continue;
      const locked = inheritedLocked || item.locked === true || metadata.locked === true;
      const location = [...metadata.locationParts, ...folderPath].join(' / ');
      if (item.type === 'bookmark') {
        addEntry(item, {
          ...metadata,
          key: _phaseOneBookmarkEntryKey(metadata.area, item, [metadata.boardId, metadata.tabId, metadata.columnId, ...folderPath]),
          location,
          parentId,
          locked
        }, items);
      } else if (item.type === 'folder' && !isDynamicFolder(item)) {
        walkItems(item.children || [], metadata, [...folderPath, item.title || 'Untitled Folder'], locked, item.id || '');
      }
    }
  };

  for (let slot = 0; slot < (root.essentials || []).length; slot++) {
    const item = root.essentials[slot];
    addEntry(item, {
      key: _phaseOneBookmarkEntryKey('essential', item, [slot]),
      area: 'essential',
      location: `Essentials / Slot ${slot + 1}`
    }, root.essentials, true);
  }

  for (const board of (root.boards || [])) {
    for (let slot = 0; slot < (board.speedDial || []).length; slot++) {
      const item = board.speedDial[slot];
      addEntry(item, {
        key: _phaseOneBookmarkEntryKey('speed-dial', item, [board.id, slot]),
        area: 'speed-dial',
        location: `${board.title || 'Untitled Board'} / Speed Dial`,
        boardId: board.id,
        locked: board.locked === true
      }, board.speedDial, true);
    }

    for (const tab of getBoardTabs(board)) {
      for (const column of (tab.columns || [])) {
        walkItems(column.items || [], {
          area: 'board',
          locationParts: [board.title || 'Untitled Board', tab.title || 'Untitled Tab', column.title || 'Untitled Column'],
          boardId: board.id,
          tabId: tab.id,
          columnId: column.id,
          locked: board.locked === true
        });
      }
      const inbox = getBoardInbox(board, tab);
      walkItems(inbox?.items || [], {
        area: 'inbox',
        locationParts: [board.title || 'Untitled Board', tab.title || 'Untitled Tab', 'Inbox'],
        boardId: board.id,
        tabId: tab.id,
        columnId: inbox?.id || '',
        locked: board.locked === true
      });
    }
  }

  walkItems(root.importManager?.items || [], {
    area: 'import-manager',
    locationParts: ['Import Manager']
  });

  for (const set of (root.sets || [])) {
    if (isDynamicSet(set)) continue;
    for (const item of (set.items || [])) {
      addEntry(item, {
        key: _phaseOneBookmarkEntryKey('set', item, [set.id]),
        area: 'set',
        location: `Set / ${set.title || 'Untitled Set'}`,
        setId: set.id
      }, set.items);
    }
  }

  return entries;
}

function findStoredBookmarkEntry(itemId, root = state) {
  if (!itemId) return null;
  return collectStoredBookmarks(root).find(entry => entry.item.id === itemId) || null;
}

function syncBookmarkActivityInventory(root = state, now = Date.now()) {
  const activity = getBookmarkActivityState();
  const liveIds = new Set();
  let changed = false;
  for (const entry of collectStoredBookmarks(root)) {
    const id = entry.item.id;
    if (!id) continue;
    liveIds.add(id);
    if (!activity.bookmarks[id]) {
      activity.bookmarks[id] = {
        firstSeenAt: _phaseOneInferCreatedAt(id, now),
        lastOpenedAt: null,
        openCount: 0,
        recent: []
      };
      changed = true;
    }
  }
  for (const id of Object.keys(activity.bookmarks)) {
    if (!liveIds.has(id)) {
      delete activity.bookmarks[id];
      changed = true;
    }
  }
  if (changed) saveBookmarkActivityState();
  return activity;
}

function recordBookmarkOpen(item, openedAt = Date.now()) {
  if (!item?.id || !item.url) return false;
  const activity = getBookmarkActivityState();
  if (activity.trackingEnabled === false) return false;
  const record = activity.bookmarks[item.id] || {
    firstSeenAt: _phaseOneInferCreatedAt(item.id, openedAt),
    lastOpenedAt: null,
    openCount: 0,
    recent: []
  };
  record.lastOpenedAt = openedAt;
  record.openCount = Math.max(0, Number(record.openCount) || 0) + 1;
  record.recent = [openedAt, ...(Array.isArray(record.recent) ? record.recent : [])]
    .filter(value => Number.isFinite(Number(value)))
    .slice(0, BOOKMARK_ACTIVITY_HISTORY_LIMIT);
  activity.bookmarks[item.id] = record;
  saveBookmarkActivityState();
  updateBookmarkActivitySettingsUi();
  return true;
}

function openHubBookmark(item, target = '_blank', features = 'noreferrer noopener') {
  if (!item?.url) return null;
  recordBookmarkOpen(item);
  return window.open(item.url, target, features);
}

function setBookmarkActivityTrackingEnabled(enabled) {
  const activity = getBookmarkActivityState();
  activity.trackingEnabled = enabled !== false;
  saveBookmarkActivityState();
  updateBookmarkActivitySettingsUi();
  if (typeof renderEssentials === 'function' && getEssentialsViewId() !== 'essentials') renderEssentials();
}

function clearBookmarkActivityStatistics(root = state) {
  const current = getBookmarkActivityState();
  bookmarkActivityCache = {
    version: 1,
    trackingEnabled: current.trackingEnabled !== false,
    essentialsView: getEssentialsViewDefinition(current.essentialsView).id,
    bookmarks: {}
  };
  syncBookmarkActivityInventory(root);
  saveBookmarkActivityState();
  updateBookmarkActivitySettingsUi();
  if (typeof renderEssentials === 'function' && getEssentialsViewId() !== 'essentials') renderEssentials();
}

function _phaseOneNormalizeHostnameInput(value) {
  const trimmed = String(value || '').trim().toLowerCase().replace(/^https?:\/\//i, '').replace(/\/$/, '');
  if (!trimmed || /[\/?#@]/.test(trimmed)) return '';
  try {
    const parsed = new URL(`https://${trimmed}`);
    if (parsed.hostname !== trimmed || parsed.port) return '';
    return parsed.hostname.toLowerCase();
  } catch {
    return '';
  }
}

function replaceExactUrlHostname(url, oldHostname, newHostname) {
  const oldHost = _phaseOneNormalizeHostnameInput(oldHostname);
  const newHost = _phaseOneNormalizeHostnameInput(newHostname);
  if (!oldHost || !newHost || !/^https?:\/\//i.test(url || '')) return '';
  let parsed;
  try { parsed = new URL(url); } catch { return ''; }
  if (parsed.hostname.toLowerCase() !== oldHost) return '';
  const match = String(url).match(/^(https?:\/\/)([^/?#]+)([\s\S]*)$/i);
  if (!match) return '';
  const atIndex = match[2].lastIndexOf('@');
  const userInfo = atIndex === -1 ? '' : match[2].slice(0, atIndex + 1);
  const hostPort = atIndex === -1 ? match[2] : match[2].slice(atIndex + 1);
  const port = hostPort.slice(oldHost.length);
  if (hostPort.slice(0, oldHost.length).toLowerCase() !== oldHost || (port && !/^:\d+$/.test(port))) return '';
  return `${match[1]}${userInfo}${newHost}${port}${match[3]}`;
}

function bookmarkEntryMatchesScope(entry, scope = 'all', context = {}) {
  if (scope === 'all') return true;
  if (scope === 'current-board') return !!context.activeBoardId && entry.boardId === context.activeBoardId;
  if (scope === 'active-tab') return !!context.activeTabId && entry.tabId === context.activeTabId && entry.area !== 'inbox';
  if (scope === 'inbox') return entry.area === 'inbox' && (!context.activeTabId || entry.tabId === context.activeTabId);
  if (scope === 'import-manager') return entry.area === 'import-manager';
  if (scope === 'essentials') return entry.area === 'essential' || entry.area === 'speed-dial';
  if (scope === 'sets') return entry.area === 'set';
  return false;
}

function planBookmarkHostMigration(oldHostname, newHostname, options = {}) {
  const oldHost = _phaseOneNormalizeHostnameInput(oldHostname);
  const newHost = _phaseOneNormalizeHostnameInput(newHostname);
  if (!oldHost || !newHost || oldHost === newHost) return [];
  const root = options.root || state;
  const context = {
    activeBoardId: options.activeBoardId ?? root.activeBoardId,
    activeTabId: options.activeTabId ?? root.activeTabId
  };
  return collectStoredBookmarks(root)
    .filter(entry => !entry.locked && bookmarkEntryMatchesScope(entry, options.scope || 'all', context))
    .map(entry => ({ entry, oldUrl: entry.item.url, newUrl: replaceExactUrlHostname(entry.item.url, oldHost, newHost) }))
    .filter(change => !!change.newUrl && change.newUrl !== change.oldUrl);
}

function _phaseOneTrackingParameterSet(parameters = DEFAULT_TRACKING_PARAMETERS) {
  return new Set((parameters || []).map(value => String(value || '').trim().toLowerCase()).filter(Boolean));
}

function removeTrackingParametersFromUrl(url, parameters = DEFAULT_TRACKING_PARAMETERS) {
  if (!/^https?:\/\//i.test(url || '')) return '';
  let parsed;
  try { parsed = new URL(url); } catch { return ''; }
  const configured = _phaseOneTrackingParameterSet(parameters);
  let changed = false;
  for (const key of [...parsed.searchParams.keys()]) {
    const lower = key.toLowerCase();
    if (configured.has(lower) || (configured.has('utm_*') && lower.startsWith('utm_'))) {
      parsed.searchParams.delete(key);
      changed = true;
    }
  }
  return changed ? parsed.toString() : '';
}

function planTrackingParameterCleanup(parameters = DEFAULT_TRACKING_PARAMETERS, options = {}) {
  const root = options.root || state;
  const context = {
    activeBoardId: options.activeBoardId ?? root.activeBoardId,
    activeTabId: options.activeTabId ?? root.activeTabId
  };
  return collectStoredBookmarks(root)
    .filter(entry => !entry.locked && bookmarkEntryMatchesScope(entry, options.scope || 'all', context))
    .map(entry => ({ entry, oldUrl: entry.item.url, newUrl: removeTrackingParametersFromUrl(entry.item.url, parameters) }))
    .filter(change => !!change.newUrl && change.newUrl !== change.oldUrl);
}

function normalizeBookmarkUrlForDuplicate(url, options = {}) {
  if (!/^https?:\/\//i.test(url || '')) return String(url || '').trim().toLowerCase();
  try {
    const parsed = new URL(url);
    parsed.protocol = parsed.protocol.toLowerCase();
    parsed.hostname = parsed.hostname.toLowerCase();
    if (options.keepFragment !== true) parsed.hash = '';
    if (options.removeTracking !== false) {
      const cleaned = removeTrackingParametersFromUrl(parsed.toString(), options.trackingParameters || DEFAULT_TRACKING_PARAMETERS);
      if (cleaned) return normalizeBookmarkUrlForDuplicate(cleaned, { ...options, removeTracking: false });
    }
    if (options.keepTrailingSlash !== true && parsed.pathname !== '/' && parsed.pathname.endsWith('/')) parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    return parsed.toString();
  } catch {
    return String(url || '').trim().toLowerCase();
  }
}

function findBookmarkDuplicateGroups(options = {}) {
  const groups = new Map();
  const ignored = new Set(options.includeIgnored ? [] : getBookmarkMaintenanceState().ignoredDuplicateUrls);
  for (const entry of collectStoredBookmarks(options.root || state)) {
    const normalizedUrl = normalizeBookmarkUrlForDuplicate(entry.item.url, options);
    if (!normalizedUrl || ignored.has(normalizedUrl)) continue;
    if (!groups.has(normalizedUrl)) groups.set(normalizedUrl, []);
    groups.get(normalizedUrl).push(entry);
  }
  return [...groups.entries()]
    .filter(([, entries]) => entries.length > 1)
    .map(([normalizedUrl, entries]) => ({ normalizedUrl, entries }))
    .sort((a, b) => b.entries.length - a.entries.length || a.normalizedUrl.localeCompare(b.normalizedUrl));
}

function applyBookmarkUrlChanges(changes, label = 'bookmark URLs') {
  const applicable = (changes || []).filter(change => change?.entry?.item && change.newUrl && change.entry.item.url !== change.newUrl && !change.entry.locked);
  if (!applicable.length) return 0;
  if (typeof pushUndoSnapshot === 'function') pushUndoSnapshot();
  for (const change of applicable) {
    change.entry.item.url = change.newUrl;
    change.entry.item.faviconCache = '';
  }
  if (typeof invalidateDerivedCaches === 'function') invalidateDerivedCaches();
  if (typeof renderAll === 'function') renderAll();
  if (typeof saveState === 'function') void saveState();
  syncBookmarkActivityInventory();
  console.info(`Morpheus: updated ${applicable.length} ${label}`);
  return applicable.length;
}

function mergeBookmarkDuplicateGroup(group) {
  const mutable = (group?.entries || []).filter(entry => !entry.locked);
  if (mutable.length < 2) return { merged: 0, locked: (group?.entries || []).length - mutable.length };
  const keeper = mutable[0];
  if (typeof pushUndoSnapshot === 'function') pushUndoSnapshot();
  for (const duplicate of mutable.slice(1)) {
    keeper.item.tags = [...new Set([...(keeper.item.tags || []), ...(duplicate.item.tags || [])])];
    if (!keeper.item.faviconCache && duplicate.item.faviconCache) keeper.item.faviconCache = duplicate.item.faviconCache;
    duplicate.remove();
  }
  if (typeof invalidateDerivedCaches === 'function') invalidateDerivedCaches();
  if (typeof renderAll === 'function') renderAll();
  if (typeof saveState === 'function') void saveState();
  syncBookmarkActivityInventory();
  return { merged: mutable.length - 1, locked: (group?.entries || []).length - mutable.length, keeper };
}

function ignoreBookmarkDuplicateGroup(normalizedUrl) {
  const maintenance = getBookmarkMaintenanceState();
  if (!maintenance.ignoredDuplicateUrls.includes(normalizedUrl)) maintenance.ignoredDuplicateUrls.push(normalizedUrl);
  saveBookmarkMaintenanceState();
}

function ignoreBookmarkHealthUrl(url) {
  const maintenance = getBookmarkMaintenanceState();
  if (url && !maintenance.ignoredHealthUrls.includes(url)) maintenance.ignoredHealthUrls.push(url);
  if (url) delete maintenance.health[url];
  saveBookmarkMaintenanceState();
}

function classifyBookmarkHealthResult(result, originalUrl) {
  const status = Number(result?.status || 0);
  const finalUrl = result?.finalUrl || originalUrl || '';
  if (!result || result.available === false) return 'unavailable';
  if (result.errorType === 'relay') return 'unavailable';
  if (result.errorType === 'unsupported') return 'unsupported';
  if (result.errorType === 'timeout') return 'timeout';
  if (result.errorType === 'dns') return 'dns-error';
  if (result.errorType === 'network') return 'network-error';
  if (status === 401 || status === 403) return 'restricted';
  if (status >= 400) return 'http-error';
  if (result.reachable === false || result.error) return 'network-error';
  if (finalUrl && normalizeBookmarkUrlForDuplicate(finalUrl) !== normalizeBookmarkUrlForDuplicate(originalUrl)) return 'redirected';
  return 'healthy';
}

async function runBookmarkHealthScan(entries, options = {}) {
  const maintenance = getBookmarkMaintenanceState();
  const ignored = new Set(options.includeIgnored ? [] : maintenance.ignoredHealthUrls);
  const uniqueUrls = [...new Set((entries || []).map(entry => entry.item?.url).filter(url => url && !ignored.has(url)))];
  const results = [];
  const concurrency = Math.max(1, Math.min(8, Number(options.concurrency) || 4));
  let cursor = 0;

  const awaitWithCancellation = promise => {
    if (!options.signal) return Promise.resolve(promise);
    if (options.signal.aborted) return Promise.resolve(null);
    return new Promise(resolve => {
      let settled = false;
      const finish = value => {
        if (settled) return;
        settled = true;
        options.signal.removeEventListener('abort', abort);
        resolve(value);
      };
      const abort = () => finish(null);
      options.signal.addEventListener('abort', abort, { once: true });
      Promise.resolve(promise).then(finish, error => finish({ reachable: false, status: 0, error: error?.message || String(error) }));
    });
  };

  const worker = async () => {
    while (cursor < uniqueUrls.length) {
      if (options.signal?.aborted) return;
      const index = cursor++;
      const url = uniqueUrls[index];
      let response = null;
      try {
        const request = typeof bridge !== 'undefined' && typeof bridge.checkUrl === 'function'
          ? bridge.checkUrl(url)
          : { available: false, error: 'Extension relay unavailable' };
        response = await awaitWithCancellation(request);
      } catch (error) {
        response = { reachable: false, status: 0, finalUrl: url, error: error?.message || String(error) };
      }
      if (options.signal?.aborted) return;
      const record = {
        url,
        state: classifyBookmarkHealthResult(response, url),
        status: Number(response?.status || 0),
        finalUrl: response?.finalUrl || url,
        error: response?.error || '',
        checkedAt: Date.now()
      };
      maintenance.health[url] = record;
      results.push(record);
      options.onProgress?.({ completed: results.length, total: uniqueUrls.length, record });
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, uniqueUrls.length || 1) }, () => worker()));
  saveBookmarkMaintenanceState();
  return results;
}

function getEffectiveBookmarkFaviconState(item) {
  if (typeof getBookmarkFaviconResolutionState === 'function') return getBookmarkFaviconResolutionState(item);
  return item?.faviconCache ? 'available' : 'missing';
}

function getSmartViewResults(viewId, options = {}) {
  const root = options.root || state;
  const entries = collectStoredBookmarks(root);
  const activity = syncBookmarkActivityInventory(root, options.now || Date.now());
  const health = getBookmarkMaintenanceState().health;
  const now = Number(options.now || Date.now());
  const days = options.days === 'all' ? Infinity : Math.max(1, Number(options.days) || 30);
  const cutoff = Number.isFinite(days) ? now - days * 86400000 : 0;
  const withData = entries.map(entry => ({ entry, activity: activity.bookmarks[entry.item.id] || {}, health: health[entry.item.url] || null }));
  let results = [];

  if (viewId === 'recent') {
    results = withData.filter(result => Number(result.activity.lastOpenedAt || 0) >= cutoff)
      .sort((a, b) => Number(b.activity.lastOpenedAt || 0) - Number(a.activity.lastOpenedAt || 0));
  } else if (viewId === 'most-used') {
    results = withData.filter(result => Number(result.activity.openCount || 0) > 0)
      .sort((a, b) => Number(b.activity.openCount || 0) - Number(a.activity.openCount || 0) || Number(b.activity.lastOpenedAt || 0) - Number(a.activity.lastOpenedAt || 0));
  } else if (viewId === 'neglected') {
    const neglectedCutoff = now - (Number.isFinite(days) ? days : 90) * 86400000;
    results = withData
      .filter(result => Number(result.activity.openCount || 0) > 0 && Number(result.activity.lastOpenedAt || 0) > 0 && Number(result.activity.lastOpenedAt || 0) < neglectedCutoff)
      .sort((a, b) => Number(a.activity.lastOpenedAt || 0) - Number(b.activity.lastOpenedAt || 0));
  } else if (viewId === 'never-opened') {
    results = withData.filter(result => Number(result.activity.openCount || 0) === 0)
      .sort((a, b) => Number(b.activity.firstSeenAt || 0) - Number(a.activity.firstSeenAt || 0));
  } else if (viewId === 'added') {
    results = withData.filter(result => Number(result.activity.firstSeenAt || 0) >= cutoff)
      .sort((a, b) => Number(b.activity.firstSeenAt || 0) - Number(a.activity.firstSeenAt || 0));
  } else if (viewId === 'duplicates') {
    results = findBookmarkDuplicateGroups({ root }).flatMap(group => group.entries.map(entry => ({ entry, duplicateCount: group.entries.length, normalizedUrl: group.normalizedUrl })));
  } else if (viewId === 'broken') {
    const brokenStates = new Set(['broken', 'timeout', 'dns-error', 'network-error', 'http-error', 'unsupported']);
    results = withData.filter(result => brokenStates.has(result.health?.state)).sort((a, b) => Number(b.health.checkedAt || 0) - Number(a.health.checkedAt || 0));
  } else if (viewId === 'redirected') {
    results = withData.filter(result => result.health?.state === 'redirected').sort((a, b) => Number(b.health.checkedAt || 0) - Number(a.health.checkedAt || 0));
  } else if (viewId === 'missing-favicon') {
    results = withData.filter(result => getEffectiveBookmarkFaviconState(result.entry.item) === 'missing');
  }

  const limit = options.limit === 'all' ? Infinity : Math.max(1, Number(options.limit) || 50);
  return Number.isFinite(limit) ? results.slice(0, limit) : results;
}

// --- Phase 1 UI ---

async function inspectStoredBookmarkFavicons(entries = collectStoredBookmarks(), options = {}) {
  if (typeof resolveFaviconSource !== 'function') return { checked: 0, missing: entries.length, cached: 0 };
  const groups = new Map();
  let checked = 0;
  let cached = 0;
  for (const entry of (entries || [])) {
    if (getEffectiveBookmarkFaviconState(entry.item) === 'available') continue;
    let origin = '';
    try {
      const parsed = new URL(entry.item.url);
      if (/^https?:$/.test(parsed.protocol) && parsed.hostname) origin = parsed.origin;
    } catch {}
    if (!origin) continue;
    if (!groups.has(origin)) groups.set(origin, []);
    groups.get(origin).push(entry);
  }

  const pending = [...groups.values()];
  let cursor = 0;
  const concurrency = Math.max(1, Math.min(8, Number(options.concurrency) || 4));
  const worker = async () => {
    while (cursor < pending.length) {
      const group = pending[cursor++];
      const source = await resolveFaviconSource(group[0].item, { forceNative: options.forceNative === true }).catch(() => '');
      checked++;
      if (source?.startsWith('data:')) {
        for (const entry of group) {
          if (entry.item.faviconCache === source) continue;
          entry.item.faviconCache = source;
          cached++;
        }
      }
      options.onProgress?.({ checked, total: pending.length });
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, pending.length || 1) }, () => worker()));
  if (cached && typeof saveState === 'function') await saveState();
  const missing = (entries || []).filter(entry => getEffectiveBookmarkFaviconState(entry.item) === 'missing').length;
  return { checked, missing, cached };
}

function updateBookmarkActivitySettingsUi() {
  const checkbox = document.getElementById('stgBookmarkActivityTracking');
  const summary = document.getElementById('stgBookmarkActivitySummary');
  const activity = getBookmarkActivityState();
  if (checkbox) checkbox.checked = activity.trackingEnabled !== false;
  if (summary) {
    const records = Object.values(activity.bookmarks || {});
    const opened = records.filter(record => Number(record.openCount || 0) > 0);
    const total = opened.reduce((sum, record) => sum + Number(record.openCount || 0), 0);
    summary.textContent = opened.length ? `${opened.length} bookmarks opened ${total} times locally.` : 'No local activity recorded.';
  }
}

function closeEssentialsViewMenu(options = {}) {
  const menu = document.getElementById('essentialsViewMenu');
  const button = document.getElementById('essentialsViewMenuBtn');
  if (!menu || !button) return;
  menu.classList.add('hidden');
  button.setAttribute('aria-expanded', 'false');
  if (options.restoreFocus === true) button.focus();
}

function updateEssentialsViewControls() {
  const definition = getEssentialsViewDefinition();
  const label = document.getElementById('essentialsViewLabel');
  const menuButton = document.getElementById('essentialsViewMenuBtn');
  if (label) label.textContent = definition.label;
  if (menuButton) menuButton.setAttribute('aria-label', `Essentials view: ${definition.label}. Choose another view`);
  document.querySelectorAll('[data-essentials-view]').forEach(button => {
    const active = button.dataset.essentialsView === definition.id;
    button.classList.toggle('active', active);
    button.setAttribute('aria-checked', active ? 'true' : 'false');
  });
}

function toggleEssentialsViewMenu() {
  const menu = document.getElementById('essentialsViewMenu');
  const button = document.getElementById('essentialsViewMenuBtn');
  if (!menu || !button) return;
  const opening = menu.classList.contains('hidden');
  menu.classList.toggle('hidden', !opening);
  button.setAttribute('aria-expanded', opening ? 'true' : 'false');
  if (opening) {
    updateEssentialsViewControls();
    (menu.querySelector('[data-essentials-view].active') || menu.querySelector('[data-essentials-view]'))?.focus();
  }
}

function initializeEssentialsViewControls() {
  const menuButton = document.getElementById('essentialsViewMenuBtn');
  const menu = document.getElementById('essentialsViewMenu');
  document.getElementById('essentialsViewPreviousBtn')?.addEventListener('click', () => {
    closeEssentialsViewMenu();
    cycleEssentialsView(-1);
  });
  document.getElementById('essentialsViewNextBtn')?.addEventListener('click', () => {
    closeEssentialsViewMenu();
    cycleEssentialsView(1);
  });
  menuButton?.addEventListener('click', event => {
    event.stopPropagation();
    toggleEssentialsViewMenu();
  });
  menu?.querySelectorAll('[data-essentials-view]').forEach(button => {
    button.addEventListener('click', () => {
      closeEssentialsViewMenu();
      setEssentialsView(button.dataset.essentialsView);
      menuButton?.focus();
    });
  });
  menu?.addEventListener('keydown', event => {
    const items = [...menu.querySelectorAll('[role="menuitemradio"], [role="menuitem"]')];
    const currentIndex = items.indexOf(document.activeElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      closeEssentialsViewMenu({ restoreFocus: true });
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const offset = event.key === 'ArrowDown' ? 1 : -1;
      items[(currentIndex + offset + items.length) % items.length]?.focus();
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      items[event.key === 'Home' ? 0 : items.length - 1]?.focus();
    }
  });
  document.addEventListener('click', event => {
    if (!event.target.closest('.essentials-view-picker')) closeEssentialsViewMenu();
  });
  updateEssentialsViewControls();
}

function _phaseOneSetToolsStatus(message = '') {
  const status = document.getElementById('hubToolsStatus');
  if (status) status.textContent = message;
}

function showHubToolsPanel(tab = 'smart') {
  const panel = document.getElementById('hubToolsPanel');
  if (!panel) return;
  activeHubToolsTab = ['smart', 'maintenance', 'workflows'].includes(tab) ? tab : 'smart';
  panel.classList.remove('hidden');
  panel.querySelectorAll('.hub-tools-tab').forEach(button => {
    const active = button.dataset.hubToolsTab === activeHubToolsTab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  if (!panel.dataset.draggableAttached && typeof makeDraggable === 'function') {
    makeDraggable(panel, document.getElementById('hubToolsDragHandle'));
    panel.dataset.draggableAttached = 'true';
    centerPanel(panel);
  }
  syncBookmarkActivityInventory();
  renderHubToolsPanel();
}

function hideHubToolsPanel() {
  activeHealthScanController?.abort();
  activeHealthScanController = null;
  document.getElementById('hubToolsPanel')?.classList.add('hidden');
  _phaseOneSetToolsStatus('');
}

function renderHubToolsPanel() {
  const body = document.getElementById('hubToolsBody');
  if (!body) return;
  body.innerHTML = '';
  if (activeHubToolsTab === 'workflows' && typeof renderPhaseTwoTools === 'function') renderPhaseTwoTools(body);
  else if (activeHubToolsTab === 'maintenance') renderBookmarkMaintenance(body);
  else renderSmartViews(body);
}

function _phaseOneFormatDate(timestamp) {
  if (!Number(timestamp)) return 'Never';
  try { return new Date(Number(timestamp)).toLocaleString(); } catch { return 'Unknown'; }
}

function _phaseOneCreateResultCard(result, options = {}) {
  const entry = result.entry || result;
  const item = entry.item;
  const row = document.createElement('div');
  row.className = 'phase1-result';
  row.dataset.bookmarkId = item.id || '';

  const iconWrap = document.createElement('span');
  iconWrap.className = 'phase1-result-icon';
  if (item.url) {
    const img = document.createElement('img');
    setFavicon(img, item, 32);
    img.alt = '';
    iconWrap.appendChild(img);
  }
  row.appendChild(iconWrap);

  const main = document.createElement('div');
  main.className = 'phase1-result-main';
  const title = document.createElement('div');
  title.className = 'phase1-result-title';
  title.textContent = item.title || item.url || 'Untitled Bookmark';
  main.appendChild(title);
  const location = document.createElement('div');
  location.className = 'phase1-result-location';
  location.textContent = entry.location || '';
  main.appendChild(location);
  const url = document.createElement('div');
  url.className = 'phase1-result-url';
  url.textContent = options.detail || item.url || '';
  main.appendChild(url);
  row.appendChild(main);

  const actions = document.createElement('div');
  actions.className = 'phase1-result-actions';
  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'secondary-btn';
  open.textContent = 'Open';
  open.addEventListener('click', () => openHubBookmark(item));
  actions.appendChild(open);
  const locate = document.createElement('button');
  locate.type = 'button';
  locate.className = 'secondary-btn';
  locate.textContent = 'Locate';
  locate.addEventListener('click', () => locateStoredBookmarkEntry(entry));
  actions.appendChild(locate);
  if (!entry.locked && ['essential', 'speed-dial', 'board', 'inbox', 'import-manager'].includes(entry.area)) {
    const move = document.createElement('button');
    move.type = 'button';
    move.className = 'secondary-btn';
    move.textContent = 'Move';
    move.addEventListener('click', () => moveStoredBookmarkEntry(entry));
    actions.appendChild(move);
  }
  row.appendChild(actions);
  return row;
}

function contextTargetForStoredBookmarkEntry(entry) {
  if (!entry?.item) return null;
  if (entry.area === 'essential') {
    return { area: 'essential', slot: state.essentials.indexOf(entry.item), item: entry.item };
  }
  if (entry.area === 'speed-dial') {
    const board = state.boards.find(candidate => candidate.id === entry.boardId);
    return { area: 'speed-dial-item', slot: board?.speedDial?.indexOf(entry.item) ?? -1, itemId: entry.item.id, item: entry.item };
  }
  if (entry.area === 'import-manager') {
    return { area: 'import-manager-item', itemId: entry.item.id, parentId: entry.parentId || null, item: entry.item };
  }
  if (entry.area === 'board' || entry.area === 'inbox') {
    return {
      area: 'board-item', boardId: entry.boardId, tabId: entry.tabId, columnId: entry.columnId,
      parentId: entry.parentId || null, itemId: entry.item.id, item: entry.item, depth: entry.parentId ? 2 : 1
    };
  }
  if (entry.area === 'set') return { area: 'set-item', setId: entry.setId, itemId: entry.item.id, item: entry.item };
  return null;
}

function moveStoredBookmarkEntry(entry) {
  if (!entry || entry.locked) return;
  const target = contextTargetForStoredBookmarkEntry(entry);
  if (!target) return;
  if (entry.boardId) {
    state.activeBoardId = entry.boardId;
    if (entry.tabId) state.activeTabId = entry.tabId;
    renderAll();
  }
  contextTarget = target;
  hideHubToolsPanel();
  _showMoveToBoardModal(target, 'Move bookmark to Tab Inbox');
}

function exportBookmarkActivity() {
  const activity = getBookmarkActivityState();
  const inventory = new Map(collectStoredBookmarks().map(entry => [entry.item.id, entry]));
  const bookmarks = Object.entries(activity.bookmarks).map(([id, record]) => {
    const entry = inventory.get(id);
    return {
      id,
      title: entry?.item?.title || '',
      url: entry?.item?.url || '',
      location: entry?.location || '',
      firstSeenAt: record.firstSeenAt || null,
      lastOpenedAt: record.lastOpenedAt || null,
      openCount: Number(record.openCount || 0),
      recent: Array.isArray(record.recent) ? record.recent : []
    };
  });
  const blob = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), bookmarks }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `morpheus-bookmark-activity-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function locateStoredBookmarkEntry(entry) {
  if (!entry) return;
  if (entry.boardId) {
    state.activeBoardId = entry.boardId;
    if (entry.tabId) state.activeTabId = entry.tabId;
    const board = state.boards.find(candidate => candidate.id === entry.boardId);
    if (board && entry.item?.id) unfoldBoardItemAncestors(board, entry.item.id);
    renderAll();
    void saveState();
    hideHubToolsPanel();
    requestAnimationFrame(() => {
      const escapeValue = globalThis.CSS?.escape ? CSS.escape(entry.item.id) : String(entry.item.id).replace(/["\\]/g, '\\$&');
      const element = document.querySelector(`[data-item-id="${escapeValue}"]`);
      element?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
      element?.classList.add('selected');
      setTimeout(() => element?.classList.remove('selected'), 1400);
    });
    return;
  }
  if (entry.area === 'set' && typeof showSetManagerForSet === 'function') {
    hideHubToolsPanel();
    showSetManagerForSet(entry.setId);
    return;
  }
  if (entry.area === 'import-manager' && typeof showImportManagerPanel === 'function') {
    hideHubToolsPanel();
    showImportManagerPanel();
    return;
  }
  if (entry.area === 'essential') {
    hideHubToolsPanel();
    document.getElementById('essentialsSection')?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  }
}

function renderSmartViews(container) {
  const tabs = document.createElement('div');
  tabs.className = 'smart-view-tabs';
  for (const definition of SMART_VIEW_DEFINITIONS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `smart-view-tab${definition.id === activeSmartViewId ? ' active' : ''}`;
    button.textContent = definition.label;
    button.addEventListener('click', () => {
      activeSmartViewId = definition.id;
      renderHubToolsPanel();
    });
    tabs.appendChild(button);
  }
  container.appendChild(tabs);

  const toolbar = document.createElement('div');
  toolbar.className = 'hub-tools-toolbar';
  const period = document.createElement('select');
  period.id = 'smartViewPeriod';
  period.setAttribute('aria-label', 'Smart View period');
  period.innerHTML = '<option value="7">Last 7 days</option><option value="30" selected>Last 30 days</option><option value="90">Last 90 days</option><option value="all">All time</option>';
  const limit = document.createElement('select');
  limit.id = 'smartViewLimit';
  limit.setAttribute('aria-label', 'Smart View result limit');
  limit.innerHTML = '<option value="25">25 results</option><option value="50" selected>50 results</option><option value="100">100 results</option><option value="all">All results</option>';
  const exportButton = document.createElement('button');
  exportButton.type = 'button';
  exportButton.className = 'secondary-btn';
  exportButton.textContent = 'Export Activity';
  const resetButton = document.createElement('button');
  resetButton.type = 'button';
  resetButton.className = 'secondary-btn';
  resetButton.textContent = 'Reset Activity';
  toolbar.appendChild(period);
  toolbar.appendChild(limit);
  toolbar.appendChild(exportButton);
  toolbar.appendChild(resetButton);
  container.appendChild(toolbar);

  const list = document.createElement('div');
  list.className = 'hub-tools-result-list';
  container.appendChild(list);

  const refresh = () => {
    const results = getSmartViewResults(activeSmartViewId, { days: period.value, limit: limit.value });
    list.innerHTML = '';
    if (!results.length) {
      const empty = document.createElement('div');
      empty.className = 'hub-tools-empty';
      empty.textContent = activeSmartViewId === 'broken' || activeSmartViewId === 'redirected'
        ? 'No matching results. Run a link-health scan from Maintenance first.'
        : 'No bookmarks match this view yet.';
      list.appendChild(empty);
    } else {
      for (const result of results) {
        let detail = result.entry.item.url;
        if (activeSmartViewId === 'recent') detail = `Last opened ${_phaseOneFormatDate(result.activity?.lastOpenedAt)}`;
        if (activeSmartViewId === 'most-used') detail = `${result.activity?.openCount || 0} opens · Last ${_phaseOneFormatDate(result.activity?.lastOpenedAt)}`;
        if (activeSmartViewId === 'neglected') detail = `Last opened ${_phaseOneFormatDate(result.activity?.lastOpenedAt)}`;
        if (activeSmartViewId === 'added') detail = `Added ${_phaseOneFormatDate(result.activity?.firstSeenAt)}`;
        if (activeSmartViewId === 'duplicates') detail = `${result.duplicateCount} copies · ${result.normalizedUrl}`;
        if (activeSmartViewId === 'broken') detail = `${result.health?.status || 'Network error'} · ${result.health?.error || result.entry.item.url}`;
        if (activeSmartViewId === 'redirected') detail = `Redirects to ${result.health?.finalUrl || ''}`;
        list.appendChild(_phaseOneCreateResultCard(result, { detail }));
      }
    }
    _phaseOneSetToolsStatus(`${results.length} result${results.length === 1 ? '' : 's'}`);
  };
  period.addEventListener('change', refresh);
  limit.addEventListener('change', refresh);
  exportButton.addEventListener('click', exportBookmarkActivity);
  resetButton.addEventListener('click', () => {
    showConfirmDialog('Clear all bookmark usage statistics stored in this browser?', () => {
      clearBookmarkActivityStatistics();
      refresh();
      _phaseOneSetToolsStatus('Local bookmark activity statistics were cleared');
    }, 'Clear Statistics');
  });
  refresh();
  if (activeSmartViewId === 'missing-favicon' && !activeFaviconInspectionPromise) {
    const unchecked = collectStoredBookmarks().filter(entry => getEffectiveBookmarkFaviconState(entry.item) === 'unchecked');
    if (unchecked.length) {
      _phaseOneSetToolsStatus(`Checking favicon availability for ${unchecked.length} bookmark${unchecked.length === 1 ? '' : 's'}…`);
      activeFaviconInspectionPromise = inspectStoredBookmarkFavicons(unchecked, {
        concurrency: 4,
        onProgress: ({ checked, total }) => _phaseOneSetToolsStatus(`Checked ${checked} of ${total} favicon source${total === 1 ? '' : 's'}…`)
      }).then(result => {
        if (activeHubToolsTab === 'smart' && activeSmartViewId === 'missing-favicon') {
          renderHubToolsPanel();
          _phaseOneSetToolsStatus(`${result.missing} confirmed missing favicon${result.missing === 1 ? '' : 's'}`);
        }
      }).finally(() => { activeFaviconInspectionPromise = null; });
    }
  }
}

function renderBookmarkMaintenance(container) {
  const tabs = document.createElement('div');
  tabs.className = 'maintenance-tabs';
  const definitions = [
    ['host', 'URL Migration'],
    ['duplicates', 'Duplicates'],
    ['health', 'Link Health'],
    ['cleanup', 'Tracking & Favicons']
  ];
  for (const [id, label] of definitions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `maintenance-tab${id === activeMaintenanceViewId ? ' active' : ''}`;
    button.textContent = label;
    button.addEventListener('click', () => {
      activeMaintenanceViewId = id;
      renderHubToolsPanel();
    });
    tabs.appendChild(button);
  }
  container.appendChild(tabs);
  const section = document.createElement('div');
  section.className = 'settings-section span-full';
  container.appendChild(section);
  if (activeMaintenanceViewId === 'duplicates') renderDuplicateMaintenance(section);
  else if (activeMaintenanceViewId === 'health') renderHealthMaintenance(section);
  else if (activeMaintenanceViewId === 'cleanup') renderCleanupMaintenance(section);
  else renderHostMigrationMaintenance(section);
}

function _phaseOneCreateScopeSelect() {
  const select = document.createElement('select');
  select.setAttribute('aria-label', 'Bookmark scope');
  select.innerHTML = '<option value="all">Entire Hub</option><option value="current-board">Current board</option><option value="active-tab">Active tab</option><option value="inbox">Active tab Inbox</option><option value="import-manager">Import Manager</option><option value="essentials">Essentials & speed dials</option><option value="sets">Manual Sets</option>';
  return select;
}

function _phaseOneRenderChangePreview(container, plan) {
  container.innerHTML = '';
  if (!plan.length) {
    const empty = document.createElement('div');
    empty.className = 'hub-tools-empty';
    empty.textContent = 'No matching URLs found.';
    container.appendChild(empty);
    return;
  }
  plan.slice(0, 500).forEach((change, index) => {
    const row = document.createElement('div');
    row.className = 'maintenance-preview-row';
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = true;
    check.dataset.changeIndex = String(index);
    const label = document.createElement('label');
    label.className = 'maintenance-url-change';
    const location = document.createElement('span');
    location.className = 'maintenance-detail';
    location.textContent = change.entry.location;
    const oldUrl = document.createElement('code');
    oldUrl.textContent = change.oldUrl;
    const newUrl = document.createElement('code');
    newUrl.textContent = `→ ${change.newUrl}`;
    label.append(location, oldUrl, newUrl);
    row.append(check, label);
    container.appendChild(row);
  });
}

function renderHostMigrationMaintenance(container) {
  container.innerHTML = '<div class="settings-section-label">Bulk URL Migration</div><div class="settings-help">Matches an exact hostname only and preserves the rest of each URL. Locked items are excluded.</div>';
  const form = document.createElement('div');
  form.className = 'maintenance-form';
  const oldHost = document.createElement('input');
  oldHost.placeholder = 'Old hostname, e.g. s.to';
  const newHost = document.createElement('input');
  newHost.placeholder = 'New hostname, e.g. serienstream.to';
  const scope = _phaseOneCreateScopeSelect();
  const preview = document.createElement('button');
  preview.type = 'button';
  preview.className = 'secondary-btn';
  preview.textContent = 'Preview';
  form.append(oldHost, newHost, scope, preview);
  container.appendChild(form);
  const summary = document.createElement('div');
  summary.className = 'maintenance-summary';
  const apply = document.createElement('button');
  apply.type = 'button';
  apply.className = 'primary-btn';
  apply.textContent = 'Apply Selected';
  apply.disabled = true;
  summary.appendChild(apply);
  container.appendChild(summary);
  const list = document.createElement('div');
  list.className = 'maintenance-group-list';
  container.appendChild(list);

  preview.addEventListener('click', () => {
    pendingHostMigrationPlan = planBookmarkHostMigration(oldHost.value, newHost.value, { scope: scope.value });
    _phaseOneRenderChangePreview(list, pendingHostMigrationPlan);
    apply.disabled = pendingHostMigrationPlan.length === 0;
    _phaseOneSetToolsStatus(`${pendingHostMigrationPlan.length} URL${pendingHostMigrationPlan.length === 1 ? '' : 's'} would change`);
  });
  apply.addEventListener('click', () => {
    const selected = [...list.querySelectorAll('input[data-change-index]:checked')]
      .map(input => pendingHostMigrationPlan[Number(input.dataset.changeIndex)])
      .filter(Boolean);
    if (!selected.length) return;
    showConfirmDialog(`Update ${selected.length} bookmark URL${selected.length === 1 ? '' : 's'}?`, () => {
      const count = applyBookmarkUrlChanges(selected, 'bookmark URLs');
      pendingHostMigrationPlan = [];
      renderHubToolsPanel();
      _phaseOneSetToolsStatus(`Updated ${count} bookmark URL${count === 1 ? '' : 's'}`);
    }, `Update ${selected.length}`);
  });
}

function renderDuplicateMaintenance(container) {
  container.innerHTML = '<div class="settings-section-label">Duplicate Bookmarks</div><div class="settings-help">Choose which URL differences to ignore. Merging keeps the first editable copy and combines tags and favicon data.</div>';
  const controls = document.createElement('div');
  controls.className = 'maintenance-form';
  const fragmentLabel = document.createElement('label');
  fragmentLabel.className = 'maintenance-check-label';
  fragmentLabel.innerHTML = '<input type="checkbox"> Keep fragments distinct';
  const fragment = fragmentLabel.querySelector('input');
  const trackingLabel = document.createElement('label');
  trackingLabel.className = 'maintenance-check-label';
  trackingLabel.innerHTML = '<input type="checkbox" checked> Ignore tracking parameters';
  const tracking = trackingLabel.querySelector('input');
  const slashLabel = document.createElement('label');
  slashLabel.className = 'maintenance-check-label';
  slashLabel.innerHTML = '<input type="checkbox" checked> Ignore trailing slashes';
  const slash = slashLabel.querySelector('input');
  controls.append(fragmentLabel, trackingLabel, slashLabel);
  container.appendChild(controls);
  const list = document.createElement('div');
  list.className = 'maintenance-group-list';
  container.appendChild(list);
  const renderGroups = () => {
    list.innerHTML = '';
    const options = { keepFragment: fragment.checked, removeTracking: tracking.checked, keepTrailingSlash: !slash.checked };
    const groups = findBookmarkDuplicateGroups(options);
    if (!groups.length) list.innerHTML = '<div class="hub-tools-empty">No unignored duplicate groups found.</div>';
    for (const group of groups) {
      const block = document.createElement('div');
      block.className = 'maintenance-group';
      const header = document.createElement('div');
      header.className = 'maintenance-group-header';
      const title = document.createElement('strong');
      title.textContent = `${group.entries.length} copies · ${group.normalizedUrl}`;
      const merge = document.createElement('button');
      merge.type = 'button';
      merge.className = 'secondary-btn';
      merge.textContent = 'Merge Editable Copies';
      const ignore = document.createElement('button');
      ignore.type = 'button';
      ignore.className = 'secondary-btn';
      ignore.textContent = 'Exclude Group';
      header.append(title, merge, ignore);
      block.appendChild(header);
      for (const entry of group.entries) {
        const detail = document.createElement('div');
        detail.className = 'maintenance-detail';
        detail.textContent = `${entry.locked ? 'Locked · ' : ''}${entry.location}`;
        block.appendChild(detail);
      }
      merge.addEventListener('click', () => {
        showConfirmDialog(`Merge editable copies of “${group.entries[0].item.title || group.normalizedUrl}”?`, () => {
          const result = mergeBookmarkDuplicateGroup(group);
          renderHubToolsPanel();
          _phaseOneSetToolsStatus(`Merged ${result.merged} duplicate${result.merged === 1 ? '' : 's'}${result.locked ? `; ${result.locked} locked copies kept` : ''}`);
        }, 'Merge Copies');
      });
      ignore.addEventListener('click', () => {
        ignoreBookmarkDuplicateGroup(group.normalizedUrl);
        renderGroups();
      });
      list.appendChild(block);
    }
    _phaseOneSetToolsStatus(`${groups.length} duplicate group${groups.length === 1 ? '' : 's'}`);
  };
  [fragment, tracking, slash].forEach(control => control.addEventListener('change', renderGroups));
  renderGroups();
}

function renderHealthMaintenance(container) {
  container.innerHTML = '<div class="settings-section-label">Link Health</div><div class="settings-help">Checks unique HTTP(S) URLs through the current authenticated Firefox extension with bounded concurrency. Results stay in this browser.</div>';
  const form = document.createElement('div');
  form.className = 'maintenance-form';
  const scope = _phaseOneCreateScopeSelect();
  const scan = document.createElement('button');
  scan.type = 'button';
  scan.className = 'primary-btn';
  scan.textContent = 'Scan Links';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'secondary-btn';
  cancel.textContent = 'Cancel';
  cancel.disabled = !activeHealthScanController;
  const acceptSelected = document.createElement('button');
  acceptSelected.type = 'button';
  acceptSelected.className = 'secondary-btn';
  acceptSelected.textContent = 'Accept Selected Redirects';
  acceptSelected.disabled = true;
  form.append(scope, scan, cancel, acceptSelected);
  container.appendChild(form);
  const progress = document.createElement('progress');
  progress.className = 'maintenance-health-progress';
  progress.max = 1;
  progress.value = 0;
  container.appendChild(progress);
  const list = document.createElement('div');
  list.className = 'maintenance-group-list';
  container.appendChild(list);

  const renderCached = () => {
    list.innerHTML = '';
    const context = { activeBoardId: state.activeBoardId, activeTabId: state.activeTabId };
    const entries = collectStoredBookmarks().filter(entry => bookmarkEntryMatchesScope(entry, scope.value, context));
    const maintenance = getBookmarkMaintenanceState();
    const ignored = new Set(maintenance.ignoredHealthUrls);
    const health = maintenance.health;
    const records = entries.map(entry => ({ entry, record: health[entry.item.url] }))
      .filter(result => result.record && !ignored.has(result.entry.item.url));
    records.sort((a, b) => Number(b.record.checkedAt || 0) - Number(a.record.checkedAt || 0));
    if (!records.length) list.innerHTML = '<div class="hub-tools-empty">No cached health results for this scope.</div>';
    for (const result of records.slice(0, 500)) {
      const row = _phaseOneCreateResultCard(result.entry, {
        detail: result.record.state === 'redirected'
          ? `${result.record.status || ''} → ${result.record.finalUrl}`
          : `${result.record.status || 'Network error'} ${result.record.error || ''}`.trim()
      });
      const badge = document.createElement('span');
      badge.className = `maintenance-status-badge ${result.record.state}`;
      badge.textContent = result.record.state;
      row.querySelector('.phase1-result-actions')?.prepend(badge);
      if (result.record.state === 'redirected' && result.record.finalUrl) {
        const select = document.createElement('input');
        select.type = 'checkbox';
        select.className = 'maintenance-redirect-select';
        select.setAttribute('aria-label', `Select redirect for ${result.entry.item.title || result.entry.item.url}`);
        select.dataset.bookmarkKey = result.entry.key;
        select.addEventListener('change', () => {
          acceptSelected.disabled = !list.querySelector('.maintenance-redirect-select:checked');
        });
        row.querySelector('.phase1-result-actions')?.prepend(select);
        const accept = document.createElement('button');
        accept.type = 'button';
        accept.className = 'secondary-btn';
        accept.textContent = 'Accept Redirect';
        accept.addEventListener('click', () => {
          showConfirmDialog(`Update this bookmark to ${result.record.finalUrl}?`, () => {
            applyBookmarkUrlChanges([{ entry: result.entry, oldUrl: result.entry.item.url, newUrl: result.record.finalUrl }], 'redirected URL');
            renderHubToolsPanel();
          }, 'Update URL');
        });
        row.querySelector('.phase1-result-actions')?.appendChild(accept);
      }
      const exclude = document.createElement('button');
      exclude.type = 'button';
      exclude.className = 'secondary-btn';
      exclude.textContent = 'Exclude';
      exclude.addEventListener('click', () => {
        ignoreBookmarkHealthUrl(result.entry.item.url);
        renderCached();
      });
      row.querySelector('.phase1-result-actions')?.appendChild(exclude);
      list.appendChild(row);
    }
    acceptSelected.disabled = true;
    _phaseOneSetToolsStatus(`${records.length} cached result${records.length === 1 ? '' : 's'}`);
  };

  scope.addEventListener('change', renderCached);
  cancel.addEventListener('click', () => activeHealthScanController?.abort());
  acceptSelected.addEventListener('click', () => {
    const keys = new Set([...list.querySelectorAll('.maintenance-redirect-select:checked')].map(input => input.dataset.bookmarkKey));
    if (!keys.size) return;
    const maintenance = getBookmarkMaintenanceState();
    const changes = collectStoredBookmarks().filter(entry => keys.has(entry.key)).map(entry => ({
      entry,
      oldUrl: entry.item.url,
      newUrl: maintenance.health[entry.item.url]?.finalUrl || ''
    })).filter(change => change.newUrl && change.newUrl !== change.oldUrl && !change.entry.locked);
    if (!changes.length) return;
    showConfirmDialog(`Accept ${changes.length} selected redirect${changes.length === 1 ? '' : 's'}?`, () => {
      const count = applyBookmarkUrlChanges(changes, 'redirected URLs');
      renderHubToolsPanel();
      _phaseOneSetToolsStatus(`Accepted ${count} redirect${count === 1 ? '' : 's'}`);
    }, `Accept ${changes.length}`);
  });
  scan.addEventListener('click', async () => {
    if (activeHealthScanController) return;
    if (typeof bridge === 'undefined' || typeof bridge.checkUrl !== 'function' || (typeof bridge.supports === 'function' && !bridge.supports('urlHealth'))) {
      const detectedVersion = typeof bridge?.getDiagnostics === 'function' ? bridge.getDiagnostics()?.extensionVersion : '';
      const message = `Link Health requires extension 1.0.25 or newer${detectedVersion ? `; detected ${detectedVersion}` : ''}. Reload the extension in about:debugging or install the current build, then reload the Hub.`;
      _phaseOneSetToolsStatus(message);
      showNotice(message);
      return;
    }
    const context = { activeBoardId: state.activeBoardId, activeTabId: state.activeTabId };
    const entries = collectStoredBookmarks().filter(entry => bookmarkEntryMatchesScope(entry, scope.value, context));
    if (!entries.length) return;
    activeHealthScanController = new AbortController();
    scan.disabled = true;
    cancel.disabled = false;
    progress.max = new Set(entries.map(entry => entry.item.url)).size || 1;
    progress.value = 0;
    try {
      await runBookmarkHealthScan(entries, {
        signal: activeHealthScanController.signal,
        concurrency: 4,
        onProgress: ({ completed, total }) => {
          progress.max = total || 1;
          progress.value = completed;
          _phaseOneSetToolsStatus(`Checked ${completed} of ${total}`);
        }
      });
    } finally {
      activeHealthScanController = null;
      scan.disabled = false;
      cancel.disabled = true;
      renderCached();
    }
  });
  renderCached();
}

function renderCleanupMaintenance(container) {
  container.innerHTML = '<div class="settings-section-label">Tracking Parameters and Favicons</div><div class="settings-help">Preview URL cleanup before applying it. Favicon checks distinguish untested bookmarks from icons already resolved by the normal Hub display pipeline.</div>';
  const form = document.createElement('div');
  form.className = 'maintenance-form';
  const parameters = document.createElement('input');
  parameters.value = DEFAULT_TRACKING_PARAMETERS.join(', ');
  parameters.setAttribute('aria-label', 'Tracking parameters');
  const scope = _phaseOneCreateScopeSelect();
  const preview = document.createElement('button');
  preview.type = 'button';
  preview.className = 'secondary-btn';
  preview.textContent = 'Preview Cleanup';
  form.append(parameters, scope, preview);
  container.appendChild(form);
  const summary = document.createElement('div');
  summary.className = 'maintenance-summary';
  const apply = document.createElement('button');
  apply.type = 'button';
  apply.className = 'primary-btn';
  apply.textContent = 'Remove Selected Parameters';
  apply.disabled = true;
  const refreshFavicons = document.createElement('button');
  refreshFavicons.type = 'button';
  refreshFavicons.className = 'secondary-btn';
  const faviconEntries = collectStoredBookmarks();
  const uncheckedCount = faviconEntries.filter(entry => getEffectiveBookmarkFaviconState(entry.item) === 'unchecked').length;
  const missingCount = faviconEntries.filter(entry => getEffectiveBookmarkFaviconState(entry.item) === 'missing').length;
  const faviconCandidateCount = uncheckedCount + missingCount;
  refreshFavicons.textContent = uncheckedCount
    ? `Check ${faviconCandidateCount} Potential Favicons`
    : `Repair ${missingCount} Missing Favicon${missingCount === 1 ? '' : 's'}`;
  refreshFavicons.disabled = faviconCandidateCount === 0;
  summary.append(apply, refreshFavicons);
  container.appendChild(summary);
  const list = document.createElement('div');
  list.className = 'maintenance-group-list';
  container.appendChild(list);

  preview.addEventListener('click', () => {
    const configured = parameters.value.split(',').map(value => value.trim()).filter(Boolean);
    pendingTrackingCleanupPlan = planTrackingParameterCleanup(configured, { scope: scope.value });
    _phaseOneRenderChangePreview(list, pendingTrackingCleanupPlan);
    apply.disabled = pendingTrackingCleanupPlan.length === 0;
    _phaseOneSetToolsStatus(`${pendingTrackingCleanupPlan.length} URL${pendingTrackingCleanupPlan.length === 1 ? '' : 's'} can be cleaned`);
  });
  apply.addEventListener('click', () => {
    const selected = [...list.querySelectorAll('input[data-change-index]:checked')]
      .map(input => pendingTrackingCleanupPlan[Number(input.dataset.changeIndex)])
      .filter(Boolean);
    if (!selected.length) return;
    showConfirmDialog(`Remove configured tracking parameters from ${selected.length} URL${selected.length === 1 ? '' : 's'}?`, () => {
      const count = applyBookmarkUrlChanges(selected, 'cleaned URLs');
      pendingTrackingCleanupPlan = [];
      renderHubToolsPanel();
      _phaseOneSetToolsStatus(`Cleaned ${count} URL${count === 1 ? '' : 's'}`);
    }, `Clean ${selected.length}`);
  });
  refreshFavicons.addEventListener('click', async () => {
    const candidates = collectStoredBookmarks().filter(entry => getEffectiveBookmarkFaviconState(entry.item) !== 'available');
    if (!candidates.length) return;
    refreshFavicons.disabled = true;
    try {
      const result = await inspectStoredBookmarkFavicons(candidates, {
        forceNative: true,
        concurrency: 4,
        onProgress: ({ checked, total }) => {
          refreshFavicons.textContent = `Checking ${checked} of ${total} favicon source${total === 1 ? '' : 's'}…`;
        }
      });
      renderAll();
      renderHubToolsPanel();
      _phaseOneSetToolsStatus(`${result.cached} favicon cache${result.cached === 1 ? '' : 's'} updated; ${result.missing} confirmed missing`);
    } catch (error) {
      refreshFavicons.disabled = false;
      _phaseOneSetToolsStatus(`Favicon check failed: ${error?.message || String(error)}`);
    }
  });
}

function initializePhaseOneFeatures() {
  if (phaseOneFeaturesInitialized) {
    syncBookmarkActivityInventory();
    updateBookmarkActivitySettingsUi();
    updateEssentialsViewControls();
    return;
  }
  phaseOneFeaturesInitialized = true;
  syncBookmarkActivityInventory();
  updateBookmarkActivitySettingsUi();
  initializeEssentialsViewControls();

  document.getElementById('quickHubToolsBtn')?.addEventListener('click', () => showHubToolsPanel('smart'));
  document.getElementById('essentialsSmartViewsBtn')?.addEventListener('click', () => {
    closeEssentialsViewMenu();
    showHubToolsPanel('smart');
  });
  document.getElementById('searchSmartViewsBtn')?.addEventListener('click', () => {
    if (typeof hideSearchModal === 'function') hideSearchModal();
    showHubToolsPanel('smart');
  });
  document.getElementById('hubToolsDoneBtn')?.addEventListener('click', hideHubToolsPanel);
  document.getElementById('hubToolsPanel')?.addEventListener('click', event => {
    const tab = event.target.closest('.hub-tools-tab');
    if (!tab) return;
    activeHubToolsTab = tab.dataset.hubToolsTab;
    document.querySelectorAll('.hub-tools-tab').forEach(button => {
      const active = button === tab;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    renderHubToolsPanel();
  });
  document.getElementById('stgBookmarkActivityTracking')?.addEventListener('change', event => {
    setBookmarkActivityTrackingEnabled(event.target.checked);
  });
  document.getElementById('stgBookmarkActivityExport')?.addEventListener('click', exportBookmarkActivity);
  document.getElementById('stgBookmarkActivityClear')?.addEventListener('click', () => {
    showConfirmDialog('Clear all bookmark usage statistics stored in this browser?', () => {
      clearBookmarkActivityStatistics();
      showNotice('Local bookmark activity statistics were cleared.');
    }, 'Clear Statistics');
  });
  window.addEventListener('morpheus:open-command-palette', event => {
    const initialization = typeof hubInitializationPromise !== 'undefined' ? hubInitializationPromise : null;
    void Promise.resolve(initialization).then(() => {
      openCommandPalette();
      bridge.respondToPush(event.detail?.pushRequestId, { ok: true });
    }).catch(error => bridge.respondToPush(event.detail?.pushRequestId, { ok: false, error: error?.message || String(error) }));
  });
}
