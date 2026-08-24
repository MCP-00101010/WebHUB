// Phase 2: deterministic intake automation, Firefox session workflows,
// backup inspection/restore, and portable scoped transfer.

const PHASE_TWO_BUNDLE_KIND = 'morpheus-portable-bundle';
const PHASE_TWO_BUNDLE_VERSION = 1;
let activePhaseTwoSection = 'automation';
let phaseTwoAutomationPreview = [];
let phaseTwoBackups = [];
let phaseTwoSelectedBackup = '';
let phaseTwoPendingBundle = null;
let phaseTwoEditingRuleId = null;
let phaseTwoAutomationBuilderGoal = 'tag';

function phaseTwoId(prefix) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`}`;
}

function phaseTwoNormalizeUrl(value) {
  try {
    const parsed = new URL(String(value || '').trim());
    parsed.hostname = parsed.hostname.toLowerCase();
    parsed.hash = '';
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^(utm_.+|fbclid|gclid|mc_cid|mc_eid)$/i.test(key)) parsed.searchParams.delete(key);
    }
    if (parsed.pathname !== '/') parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    parsed.searchParams.sort();
    return parsed.toString();
  } catch { return String(value || '').trim(); }
}

function normalizeAutomationRule(rule = {}, index = 0) {
  const conditions = rule.conditions || {};
  const actions = rule.actions || {};
  return {
    id: String(rule.id || phaseTwoId('automation')),
    name: String(rule.name || `Rule ${index + 1}`).trim() || `Rule ${index + 1}`,
    enabled: rule.enabled !== false,
    stop: rule.stop !== false,
    conditions: {
      hostname: String(conditions.hostname || '').trim().toLowerCase(),
      urlText: String(conditions.urlText || '').trim().toLowerCase(),
      titleText: String(conditions.titleText || '').trim().toLowerCase(),
      source: String(conditions.source || '').trim().toLowerCase(),
      tags: Array.isArray(conditions.tags) ? conditions.tags.map(String).map(value => value.trim().toLowerCase()).filter(Boolean) : [],
      duplicate: ['yes', 'no'].includes(conditions.duplicate) ? conditions.duplicate : 'any'
    },
    actions: {
      addTags: Array.isArray(actions.addTags) ? actions.addTags.map(String).map(value => value.trim()).filter(Boolean) : [],
      titlePrefix: String(actions.titlePrefix || ''),
      titleReplacement: String(actions.titleReplacement || ''),
      routeBoardId: String(actions.routeBoardId || ''),
      routeTabId: String(actions.routeTabId || ''),
      normalizeUrl: actions.normalizeUrl === true,
      rejectDuplicate: actions.rejectDuplicate === true
    }
  };
}

function evaluateAutomationRules(records, rules, options = {}) {
  const knownUrls = new Set((options.knownUrls || []).map(phaseTwoNormalizeUrl).filter(Boolean));
  const tagNameFor = typeof options.tagNameFor === 'function' ? options.tagNameFor : value => String(value || '');
  const normalizedRules = (rules || []).map(normalizeAutomationRule).filter(rule => rule.enabled);
  return (records || []).map((record, recordIndex) => {
    const item = record.item || record;
    const originalUrl = String(item.url || '');
    const comparableUrl = phaseTwoNormalizeUrl(originalUrl);
    const duplicate = knownUrls.has(comparableUrl) || (records || []).some((other, otherIndex) => {
      const otherItem = other.item || other;
      return otherIndex < recordIndex && phaseTwoNormalizeUrl(otherItem.url) === comparableUrl;
    });
    const tagNames = (item.tags || []).map(tagNameFor).map(value => String(value).toLowerCase());
    const proposed = { title: item.title || originalUrl, url: originalUrl, addTags: [], routeBoardId: '', routeTabId: '', rejected: false };
    const matchedRules = [];
    for (const rule of normalizedRules) {
      const condition = rule.conditions;
      let hostname = '';
      try { hostname = new URL(proposed.url).hostname.toLowerCase(); } catch {}
      const matches = (!condition.hostname || hostname === condition.hostname || hostname.endsWith(`.${condition.hostname}`))
        && (!condition.urlText || proposed.url.toLowerCase().includes(condition.urlText))
        && (!condition.titleText || proposed.title.toLowerCase().includes(condition.titleText))
        && (!condition.source || String(record.source || '').toLowerCase() === condition.source)
        && (!condition.tags.length || condition.tags.every(tag => tagNames.includes(tag)))
        && (condition.duplicate === 'any' || (condition.duplicate === 'yes') === duplicate);
      if (!matches) continue;
      matchedRules.push(rule.id);
      if (rule.actions.titleReplacement) proposed.title = rule.actions.titleReplacement;
      if (rule.actions.titlePrefix) proposed.title = `${rule.actions.titlePrefix}${proposed.title}`;
      if (rule.actions.normalizeUrl) proposed.url = phaseTwoNormalizeUrl(proposed.url);
      proposed.addTags.push(...rule.actions.addTags);
      if (rule.actions.routeBoardId && rule.actions.routeTabId) {
        proposed.routeBoardId = rule.actions.routeBoardId;
        proposed.routeTabId = rule.actions.routeTabId;
      }
      if (rule.actions.rejectDuplicate && duplicate) proposed.rejected = true;
      if (rule.stop) break;
    }
    const conflicts = [];
    if (item.locked) conflicts.push('Item is locked');
    if (proposed.routeTabId && typeof options.destinationExists === 'function' && !options.destinationExists(proposed.routeBoardId, proposed.routeTabId)) conflicts.push('Destination is missing');
    return { record, duplicate, matchedRules, proposed: { ...proposed, addTags: [...new Set(proposed.addTags)] }, conflicts };
  });
}

function phaseTwoWalkItems(items, source, output, parent = items) {
  for (const item of (items || [])) {
    if (!item) continue;
    if (item.type === 'bookmark') output.push({ item, parent, source });
    if (Array.isArray(item.children)) phaseTwoWalkItems(item.children, source, output, item.children);
  }
  return output;
}

function phaseTwoCollectAutomationRecords(scope = 'inbox') {
  const records = [];
  if (scope === 'import-manager') return phaseTwoWalkItems(state.importManager?.items || [], 'import-manager', records);
  const board = typeof getActiveBoard === 'function' ? getActiveBoard() : state.boards?.find(entry => entry.id === state.activeBoardId);
  const tab = typeof getBoardTab === 'function' ? getBoardTab(board, state.activeTabId) : board?.tabs?.find(entry => entry.id === state.activeTabId);
  const inbox = typeof getBoardInbox === 'function' ? getBoardInbox(board, tab) : tab?.inbox;
  return phaseTwoWalkItems(inbox?.items || [], 'inbox', records);
}

function phaseTwoDestinationExists(boardId, tabId) {
  const board = state.boards?.find(entry => entry.id === boardId);
  return !!board?.tabs?.some(tab => tab.id === tabId && !tab.locked);
}

function phaseTwoKnownUrls(excludedItems = new Set()) {
  if (typeof collectStoredBookmarks !== 'function') return [];
  return collectStoredBookmarks().filter(entry => !excludedItems.has(entry.item)).map(entry => entry.item.url);
}

function phaseTwoTagNameFor(tagId) {
  return state.tags?.find(tag => tag.id === tagId)?.name || tagId;
}

function phaseTwoResolveTagIds(names) {
  return names.map(name => {
    let tag = state.tags?.find(entry => entry.name.toLowerCase() === name.toLowerCase());
    if (!tag && typeof createTag === 'function') tag = createTag(name);
    return tag?.id || name;
  });
}

function phaseTwoPreviewAutomation(scope) {
  const records = phaseTwoCollectAutomationRecords(scope);
  phaseTwoAutomationPreview = evaluateAutomationRules(records, state.automationRules || [], {
    knownUrls: phaseTwoKnownUrls(new Set(records.map(record => record.item))),
    tagNameFor: phaseTwoTagNameFor,
    destinationExists: phaseTwoDestinationExists
  });
  return phaseTwoAutomationPreview;
}

function phaseTwoApplyAutomationRecords(records, options = {}) {
  const results = evaluateAutomationRules(records, state.automationRules || [], {
    knownUrls: phaseTwoKnownUrls(new Set(records.map(record => record.item))),
    tagNameFor: phaseTwoTagNameFor,
    destinationExists: phaseTwoDestinationExists
  }).filter(result => result.matchedRules.length && !result.conflicts.length);
  if (!results.length) return 0;
  if (options.pushUndo !== false && typeof pushUndoSnapshot === 'function') pushUndoSnapshot();
  let changed = 0;
  for (const result of results) {
    const { item, parent } = result.record;
    const next = result.proposed;
    if (next.rejected) {
      const index = parent.indexOf(item);
      if (index >= 0) { parent.splice(index, 1); changed++; }
      continue;
    }
    item.title = next.title;
    item.url = next.url;
    item.tags = [...new Set([...(item.tags || []), ...phaseTwoResolveTagIds(next.addTags)])];
    if (next.routeTabId) {
      const board = state.boards.find(entry => entry.id === next.routeBoardId);
      const tab = board?.tabs?.find(entry => entry.id === next.routeTabId);
      const inbox = tab && (typeof getBoardInbox === 'function' ? getBoardInbox(board, tab) : tab.inbox);
      if (inbox && inbox.items !== parent) {
        const index = parent.indexOf(item);
        if (index >= 0) parent.splice(index, 1);
        inbox.items.push(item);
      }
    }
    changed++;
  }
  if (options.persist !== false) saveState();
  if (options.render !== false) renderAll();
  return changed;
}

function phaseTwoApplyAutomation(scope) {
  return phaseTwoApplyAutomationRecords(phaseTwoCollectAutomationRecords(scope));
}

function sanitizeBrowserSession(session = {}) {
  const tabs = dedupeSessionTabs((session.tabs || []).filter(tab => /^https?:\/\//i.test(String(tab?.url || ''))).map(tab => ({
    title: String(tab.title || tab.url || ''),
    url: String(tab.url),
    pinned: tab.pinned === true,
    active: tab.active === true,
    group: tab.group ? { title: String(tab.group.title || ''), color: String(tab.group.color || '') } : null
  })));
  const createdAt = session.createdAt || new Date().toISOString();
  return {
    id: String(session.id || phaseTwoId('session')),
    title: String(session.title || 'Browser Session').trim() || 'Browser Session',
    createdAt,
    updatedAt: session.updatedAt || createdAt,
    lastLaunchedAt: session.lastLaunchedAt || null,
    tabs
  };
}

function dedupeSessionTabs(tabs) {
  const seen = new Set();
  return (tabs || []).filter(tab => {
    const key = phaseTwoNormalizeUrl(tab.url);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function phaseTwoCollectBookmarkItems(items, output = []) {
  for (const item of (items || [])) {
    if (item?.type === 'bookmark' && /^https?:\/\//i.test(item.url || '')) output.push({ title: item.title || item.url, url: item.url, pinned: false, active: false, group: null });
    if (item?.children) phaseTwoCollectBookmarkItems(item.children, output);
  }
  return output;
}

function phaseTwoHubLaunchSources() {
  const sources = [];
  for (const board of (state.boards || [])) for (const tab of (board.tabs || [])) {
    const tabs = [];
    for (const column of (tab.columns || [])) phaseTwoCollectBookmarkItems(column.items, tabs);
    phaseTwoCollectBookmarkItems(tab.inbox?.items, tabs);
    sources.push({ id: `tab|${board.id}|${tab.id}`, title: `Tab: ${board.title} / ${tab.title}`, tabs });
    const visitFolders = items => (items || []).forEach(item => {
      if (item?.type === 'folder') {
        sources.push({ id: `folder|${item.id}`, title: `Folder: ${item.title}`, tabs: phaseTwoCollectBookmarkItems(item.children, []) });
        visitFolders(item.children);
      }
    });
    for (const column of (tab.columns || [])) visitFolders(column.items);
    visitFolders(tab.inbox?.items);
  }
  for (const set of (state.sets || [])) {
    const items = typeof resolveSetItems === 'function' ? resolveSetItems(set) : set.items;
    sources.push({ id: `set|${set.id}`, title: `Set: ${set.title}`, tabs: phaseTwoCollectBookmarkItems(items, []) });
  }
  return sources;
}

function phaseTwoSanitizePortable(value, options = {}) {
  if (Array.isArray(value)) return value.map(item => phaseTwoSanitizePortable(item, options));
  if (!value || typeof value !== 'object') return value;
  const blocked = new Set(['databasePath', 'serviceApiKeys', 'browserId', 'tabId', 'windowId', 'runtimeState', 'cache']);
  const copy = {};
  for (const [key, child] of Object.entries(value)) {
    if (blocked.has(key) || /credential|secret|nativePath/i.test(key)) continue;
    if (key === 'appKey') continue;
    if (key === 'faviconCache' && !options.includeFavicons) continue;
    if (key === 'iconCache' && !options.includeFavicons) continue;
    if (key === 'backgroundImage' && !options.includeBackgrounds) { copy[key] = ''; continue; }
    copy[key] = phaseTwoSanitizePortable(child, options);
  }
  return copy;
}

function createPortableBundle(root, scope = 'active-tab', options = {}) {
  const activeBoard = root.boards?.find(board => board.id === root.activeBoardId) || root.boards?.[0] || null;
  const activeTab = activeBoard?.tabs?.find(tab => tab.id === root.activeTabId) || activeBoard?.tabs?.[0] || null;
  let payload;
  if (scope === 'active-board') payload = { boards: activeBoard ? [activeBoard] : [] };
  else if (scope === 'active-tab') payload = { tabs: activeTab ? [activeTab] : [] };
  else if (scope === 'active-inbox') payload = { items: activeTab?.inbox?.items || [] };
  else if (scope === 'selected') {
    const selected = options.selectedIds instanceof Set ? options.selectedIds : new Set(options.selectedIds || []);
    const items = [];
    const visit = value => (value || []).forEach(item => { if (selected.has(item?.id)) items.push(item); if (item?.children) visit(item.children); });
    activeTab?.columns?.forEach(column => visit(column.items));
    visit(activeTab?.inbox?.items);
    payload = { items };
  } else if (scope === 'set') payload = { sets: root.sets?.filter(set => set.id === options.setId) || [] };
  else if (scope === 'folder') {
    let folder = null;
    const visit = values => (values || []).some(item => {
      if (item?.id === options.folderId && item.type === 'folder') { folder = item; return true; }
      return item?.children ? visit(item.children) : false;
    });
    for (const board of (root.boards || [])) for (const tab of (board.tabs || [])) { for (const column of (tab.columns || [])) visit(column.items); visit(tab.inbox?.items); }
    payload = { items: folder ? [folder] : [] };
  }
  else if (scope === 'smart-results') payload = { items: (options.items || []).map(result => result.item || result.entry?.item || result).filter(Boolean) };
  else payload = { boards: root.boards || [], navItems: root.navItems || [], sets: root.sets || [], tags: root.tags || [], settings: root.settings || {} };
  const dependencies = {
    tags: options.includeTags === false ? [] : (root.tags || []),
    sets: options.includeSets === false ? [] : (root.sets || [])
  };
  if (options.includeUsage && options.usage) payload.usage = options.usage;
  return {
    kind: PHASE_TWO_BUNDLE_KIND,
    version: PHASE_TWO_BUNDLE_VERSION,
    createdAt: new Date().toISOString(),
    scope,
    manifest: {
      includes: Object.keys(payload),
      dependencies: Object.keys(dependencies).filter(key => dependencies[key].length),
      omitted: ['credentials', 'native paths', 'application bindings', 'browser tab/window IDs', 'runtime caches', ...(!options.includeFavicons ? ['favicon and application icon cache'] : []), ...(!options.includeBackgrounds ? ['background assets'] : []), ...(!options.includeUsage ? ['usage statistics'] : [])],
      sanitized: true
    },
    dependencies: phaseTwoSanitizePortable(dependencies, options),
    payload: phaseTwoSanitizePortable(payload, options)
  };
}

function validatePortableBundle(bundle) {
  if (!bundle || bundle.kind !== PHASE_TWO_BUNDLE_KIND) return { ok: false, error: 'Not a Morpheus portable bundle' };
  if (!Number.isInteger(bundle.version) || bundle.version > PHASE_TWO_BUNDLE_VERSION) return { ok: false, error: 'Bundle version is newer than this Hub supports' };
  return { ok: true, scope: bundle.scope, counts: {
    boards: bundle.payload?.boards?.length || 0,
    tabs: bundle.payload?.tabs?.length || 0,
    items: bundle.payload?.items?.length || 0,
    sets: bundle.payload?.sets?.length || 0,
    tags: bundle.dependencies?.tags?.length || bundle.payload?.tags?.length || 0
  } };
}

function phaseTwoRemapTreeIds(value, idMap = new Map()) {
  const copy = structuredClone(value);
  const visit = node => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (typeof node.id === 'string') {
      const old = node.id;
      if (!idMap.has(old)) idMap.set(old, phaseTwoId(old.split('-')[0] || 'item'));
      node.id = idMap.get(old);
    }
    for (const [key, child] of Object.entries(node)) {
      if (key.endsWith('Id') && typeof child === 'string' && idMap.has(child)) node[key] = idMap.get(child);
      else visit(child);
    }
  };
  visit(copy);
  return copy;
}

function phaseTwoResetApplicationBindings(value) {
  const visit = node => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (node.type === 'application') {
      const token = globalThis.crypto?.randomUUID?.().replace(/-/g, '')
        || `${Date.now()}${Math.random().toString(36).slice(2, 14)}`;
      node.appKey = `app_${token}`.slice(0, 79);
    }
    Object.values(node).forEach(visit);
  };
  visit(value);
  return value;
}

function importPortableBundle(bundle, root, options = {}) {
  const validation = validatePortableBundle(bundle);
  if (!validation.ok) return validation;
  const mode = ['merge', 'copy', 'replace'].includes(options.mode) ? options.mode : 'merge';
  const remap = mode === 'copy';
  const payload = phaseTwoResetApplicationBindings(remap ? phaseTwoRemapTreeIds(bundle.payload) : structuredClone(bundle.payload || {}));
  if (mode === 'replace' && payload.boards) root.boards = payload.boards;
  else if (payload.boards) root.boards.push(...payload.boards.filter(board => mode === 'copy' || !root.boards.some(existing => existing.id === board.id)));
  if (payload.sets) root.sets.push(...payload.sets.filter(set => mode === 'copy' || !root.sets.some(existing => existing.id === set.id)));
  if (payload.tabs?.length) {
    const board = root.boards.find(entry => entry.id === root.activeBoardId) || root.boards[0];
    if (board) board.tabs.push(...payload.tabs);
  }
  if (payload.items?.length) {
    const board = root.boards.find(entry => entry.id === (options.destinationBoardId || root.activeBoardId)) || root.boards[0];
    const tab = board?.tabs?.find(entry => entry.id === (options.destinationTabId || root.activeTabId)) || board?.tabs?.[0];
    if (tab?.inbox) {
      const known = new Set((typeof collectStoredBookmarks === 'function' ? collectStoredBookmarks(root) : []).map(entry => phaseTwoNormalizeUrl(entry.item.url)));
      tab.inbox.items.push(...payload.items.filter(item => mode === 'copy' || item.type !== 'bookmark' || !known.has(phaseTwoNormalizeUrl(item.url))));
    }
  }
  const incomingTags = bundle.dependencies?.tags || payload.tags || [];
  for (const tag of incomingTags) if (!root.tags.some(existing => existing.id === tag.id || existing.name?.toLowerCase() === tag.name?.toLowerCase())) root.tags.push(tag);
  return { ok: true, mode, ...validation.counts };
}

function summarizePhaseTwoState(root) {
  const summary = { schemaVersion: root?.schemaVersion || 0, boards: root?.boards?.length || 0, tabs: 0, bookmarks: 0, applications: 0, folders: 0, sets: root?.sets?.length || 0, tags: root?.tags?.length || 0, settings: root?.settings ? Object.keys(root.settings).length : 0 };
  const walk = values => (values || []).forEach(item => { if (item?.type === 'bookmark') summary.bookmarks++; if (item?.type === 'application') summary.applications++; if (item?.type === 'folder') summary.folders++; if (item?.children) walk(item.children); });
  for (const board of (root?.boards || [])) for (const tab of (board.tabs || [])) { summary.tabs++; for (const column of (tab.columns || [])) walk(column.items); walk(tab.inbox?.items); }
  return summary;
}

function comparePhaseTwoSummaries(current, backup) {
  const keys = ['schemaVersion', 'boards', 'tabs', 'bookmarks', 'applications', 'folders', 'sets', 'tags', 'settings'];
  return keys.map(key => ({ key, current: Number(current?.[key] || 0), backup: Number(backup?.[key] || 0), delta: Number(backup?.[key] || 0) - Number(current?.[key] || 0) }));
}

function restorePhaseTwoBackupScope(backupState, target, scope = 'full', itemQuery = '') {
  if (scope === 'full') return parseStateJson(JSON.stringify(backupState));
  if (scope === 'boards') { target.boards = structuredClone(backupState.boards || []); target.navItems = structuredClone(backupState.navItems || []); }
  else if (scope === 'sets') target.sets = structuredClone(backupState.sets || []);
  else if (scope === 'board') {
    const query = String(itemQuery || '').trim().toLowerCase();
    const board = (backupState.boards || []).find(item => String(item.id || '').toLowerCase() === query || String(item.title || '').toLowerCase() === query);
    if (!board) throw new Error('No backup board matched that ID/title');
    const restored = phaseTwoRemapTreeIds(board);
    target.boards.push(restored);
    target.navItems.push({ id: phaseTwoId('nav'), type: 'board', title: restored.title, boardId: restored.id });
  }
  else if (scope === 'set') {
    const query = String(itemQuery || '').trim().toLowerCase();
    const set = (backupState.sets || []).find(item => String(item.id || '').toLowerCase() === query || String(item.title || '').toLowerCase() === query);
    if (!set) throw new Error('No backup Set matched that ID/title');
    target.sets.push(phaseTwoRemapTreeIds(set));
  }
  else if (scope === 'tags') target.tags = structuredClone(backupState.tags || []);
  else if (scope === 'settings') target.settings = { ...target.settings, ...structuredClone(backupState.settings || {}) };
  else if (scope === 'import-manager') target.importManager = structuredClone(backupState.importManager || { items: [], lastImportedAt: null });
  else if (scope === 'item') {
    const query = String(itemQuery || '').trim().toLowerCase();
    let match = null;
    const visit = items => { for (const item of (items || [])) { if (!match && (String(item.id || '').toLowerCase() === query || String(item.title || '').toLowerCase() === query) && ['bookmark', 'folder'].includes(item.type)) match = item; if (!match && item.children) visit(item.children); } };
    for (const board of (backupState.boards || [])) for (const tab of (board.tabs || [])) { for (const column of (tab.columns || [])) visit(column.items); visit(tab.inbox?.items); }
    if (!match) throw new Error('No backup bookmark or folder matched that ID/title');
    const board = target.boards.find(entry => entry.id === target.activeBoardId) || target.boards[0];
    const tab = board?.tabs?.find(entry => entry.id === target.activeTabId) || board?.tabs?.[0];
    if (!tab?.inbox) throw new Error('The active destination has no Inbox');
    tab.inbox.items.push(phaseTwoRemapTreeIds(match));
  }
  return target;
}

function describeAutomationRule(rawRule) {
  const rule = normalizeAutomationRule(rawRule);
  const conditions = [];
  if (rule.conditions.hostname) conditions.push(`website is ${rule.conditions.hostname}`);
  if (rule.conditions.urlText) conditions.push(`address contains “${rule.conditions.urlText}”`);
  if (rule.conditions.titleText) conditions.push(`title contains “${rule.conditions.titleText}”`);
  if (rule.conditions.source) conditions.push(`source is ${rule.conditions.source === 'import-manager' ? 'Import Manager' : rule.conditions.source === 'extension' ? 'Firefox delivery' : 'Tab Inbox'}`);
  if (rule.conditions.tags.length) conditions.push(`has ${rule.conditions.tags.join(', ')}`);
  if (rule.conditions.duplicate === 'yes') conditions.push('it is a duplicate');
  if (rule.conditions.duplicate === 'no') conditions.push('it is not a duplicate');
  const actions = [];
  if (rule.actions.addTags.length) actions.push(`add ${rule.actions.addTags.join(', ')}`);
  if (rule.actions.titleReplacement) actions.push(`rename it to “${rule.actions.titleReplacement}”`);
  else if (rule.actions.titlePrefix) actions.push(`add “${rule.actions.titlePrefix}” to its title`);
  if (rule.actions.routeTabId) actions.push('move it to the chosen Tab Inbox');
  if (rule.actions.normalizeUrl) actions.push('clean its URL');
  if (rule.actions.rejectDuplicate) actions.push('discard it when duplicated');
  return `When ${conditions.length ? conditions.join(' and ') : 'any bookmark arrives'}, ${actions.length ? actions.join(' and ') : 'leave it unchanged'}.`;
}

// --- Phase 2 UI ---

function phaseTwoDownloadJson(data, filename) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function phaseTwoButton(label, handler, primary = false) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = primary ? 'primary-btn' : 'secondary-btn';
  button.textContent = label;
  button.addEventListener('click', handler);
  return button;
}

function phaseTwoField(label, control) {
  const wrapper = document.createElement('label');
  wrapper.className = 'phase2-field';
  const title = document.createElement('span');
  title.textContent = label;
  wrapper.append(title, control);
  return wrapper;
}

function phaseTwoInput(placeholder = '') {
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = placeholder;
  return input;
}

function phaseTwoSelect(options) {
  const select = document.createElement('select');
  for (const [value, label] of options) select.add(new Option(label, value));
  return select;
}

function phaseTwoSectionNav(container) {
  const nav = document.createElement('div');
  nav.className = 'phase2-nav';
  for (const [id, label] of [['automation', 'Automation'], ['sessions', 'Sessions'], ['backups', 'Backups'], ['transfer', 'Export / Import']]) {
    const button = phaseTwoButton(label, () => { activePhaseTwoSection = id; renderHubToolsPanel(); });
    button.classList.toggle('active', activePhaseTwoSection === id);
    nav.appendChild(button);
  }
  container.appendChild(nav);
}

function phaseTwoRenderAutomation(container) {
  const intro = document.createElement('div');
  intro.className = 'phase2-automation-intro';
  const introTitle = document.createElement('strong'); introTitle.textContent = 'What should happen to incoming bookmarks?';
  const introText = document.createElement('span'); introText.textContent = 'Choose one simple job. Rules run automatically when Firefox sends a bookmark, and can also be tested on the current Inbox or Import Manager.';
  intro.append(introTitle, introText); container.appendChild(intro);

  const editing = (state.automationRules || []).find(rule => rule.id === phaseTwoEditingRuleId) || null;
  const inferGoal = rule => rule?.actions?.routeTabId ? 'route' : (rule?.actions?.titlePrefix || rule?.actions?.titleReplacement) ? 'rename' : (rule?.actions?.normalizeUrl || rule?.actions?.rejectDuplicate) ? 'clean' : 'tag';
  if (editing) phaseTwoAutomationBuilderGoal = inferGoal(editing);
  const recipes = [
    ['tag', 'Add tags', 'Example: tag every YouTube link “video”.'],
    ['rename', 'Change names', 'Example: add “[Work]” before matching titles.'],
    ['route', 'Move bookmarks', 'Example: send GitHub links to a Work Inbox.'],
    ['clean', 'Clean incoming links', 'Remove tracking parameters or discard duplicates.']
  ];
  const recipeGrid = document.createElement('div'); recipeGrid.className = 'phase2-recipe-grid';
  for (const [id, label, help] of recipes) {
    const button = document.createElement('button'); button.type = 'button'; button.className = `phase2-recipe${phaseTwoAutomationBuilderGoal === id ? ' active' : ''}`;
    const title = document.createElement('strong'); title.textContent = label;
    const detail = document.createElement('span'); detail.textContent = help;
    button.append(title, detail);
    button.addEventListener('click', () => { phaseTwoAutomationBuilderGoal = id; phaseTwoEditingRuleId = null; renderHubToolsPanel(); });
    recipeGrid.appendChild(button);
  }
  container.appendChild(recipeGrid);

  const builder = document.createElement('div'); builder.className = 'phase2-rule-builder';
  const builderTitle = document.createElement('h4'); builderTitle.textContent = editing ? `Edit “${editing.name}”` : `New “${recipes.find(recipe => recipe[0] === phaseTwoAutomationBuilderGoal)?.[1]}” rule`;
  builder.appendChild(builderTitle);
  const conditionValues = editing?.conditions || {};
  let initialCondition = 'hostname'; let initialValue = '';
  for (const [key, value] of [['hostname', conditionValues.hostname], ['urlText', conditionValues.urlText], ['titleText', conditionValues.titleText], ['source', conditionValues.source], ['tags', conditionValues.tags?.join(', ')], ['duplicate', conditionValues.duplicate !== 'any' ? conditionValues.duplicate : '']]) {
    if (value) { initialCondition = key; initialValue = value; break; }
  }
  const conditionType = phaseTwoSelect([['hostname', 'Website/domain is'], ['urlText', 'Address contains'], ['titleText', 'Bookmark title contains'], ['source', 'Bookmark came from'], ['tags', 'Bookmark already has tag(s)'], ['duplicate', 'Bookmark is a duplicate'], ['any', 'Any incoming bookmark']]);
  conditionType.value = initialCondition;
  const matchValue = phaseTwoInput('example.com'); matchValue.value = initialValue;
  const updateMatchInput = () => {
    const placeholders = { hostname: 'youtube.com', urlText: '/watch or ?category=work', titleText: 'invoice', source: 'inbox, import-manager, or extension', tags: 'research, later' };
    matchValue.placeholder = placeholders[conditionType.value] || '';
    matchValue.classList.toggle('hidden', ['duplicate', 'any'].includes(conditionType.value));
  };
  conditionType.addEventListener('change', () => { matchValue.value = ''; updateMatchInput(); updateSummary(); });
  updateMatchInput();

  const goalControls = document.createElement('div'); goalControls.className = 'phase2-goal-controls';
  const addTags = phaseTwoInput('video, work'); addTags.value = editing?.actions?.addTags?.join(', ') || '';
  const renameMode = phaseTwoSelect([['prefix', 'Add text before the current title'], ['replace', 'Replace the whole title']]);
  if (editing?.actions?.titleReplacement) renameMode.value = 'replace';
  const renameText = phaseTwoInput('[Work] '); renameText.value = editing?.actions?.titleReplacement || editing?.actions?.titlePrefix || '';
  const route = phaseTwoSelect(state.boards.flatMap(board => (board.tabs || []).map(tab => [`${board.id}|${tab.id}`, `${board.title} → ${tab.title} Inbox`])));
  if (editing?.actions?.routeTabId) route.value = `${editing.actions.routeBoardId}|${editing.actions.routeTabId}`;
  const cleanChecks = document.createElement('div'); cleanChecks.className = 'phase2-checks';
  const normalize = document.createElement('input'); normalize.type = 'checkbox'; normalize.checked = editing ? editing.actions.normalizeUrl : true;
  const reject = document.createElement('input'); reject.type = 'checkbox'; reject.checked = editing?.actions?.rejectDuplicate === true;
  const normalizeLabel = document.createElement('label'); normalizeLabel.append(normalize, document.createTextNode('Remove common tracking parameters'));
  const rejectLabel = document.createElement('label'); rejectLabel.append(reject, document.createTextNode('Discard duplicate URLs'));
  cleanChecks.append(normalizeLabel, rejectLabel);
  if (phaseTwoAutomationBuilderGoal === 'tag') goalControls.appendChild(phaseTwoField('Tags to add', addTags));
  else if (phaseTwoAutomationBuilderGoal === 'rename') goalControls.append(phaseTwoField('How to rename', renameMode), phaseTwoField('Text', renameText));
  else if (phaseTwoAutomationBuilderGoal === 'route') goalControls.appendChild(phaseTwoField('Move to', route));
  else goalControls.appendChild(cleanChecks);

  const stepGrid = document.createElement('div'); stepGrid.className = 'phase2-builder-steps';
  const makeStep = (number, title, content) => { const step = document.createElement('section'); const heading = document.createElement('strong'); heading.textContent = `${number}. ${title}`; step.append(heading, content); return step; };
  const matchControls = document.createElement('div'); matchControls.className = 'phase2-builder-match'; matchControls.append(conditionType, matchValue);
  stepGrid.append(makeStep('1', 'Choose the job', document.createTextNode(recipes.find(recipe => recipe[0] === phaseTwoAutomationBuilderGoal)?.[1] || 'Automation')), makeStep('2', 'Which bookmarks?', matchControls), makeStep('3', 'What should happen?', goalControls));
  builder.appendChild(stepGrid);

  const advanced = document.createElement('details'); advanced.className = 'phase2-rule-advanced';
  const advancedSummary = document.createElement('summary'); advancedSummary.textContent = 'Advanced options';
  const advancedGrid = document.createElement('div'); advancedGrid.className = 'phase2-form-grid phase2-form-grid--advanced';
  const name = phaseTwoInput('Optional rule name'); name.value = editing?.name || '';
  const source = phaseTwoSelect([['', 'Any source'], ['inbox', 'Tab Inbox'], ['import-manager', 'Import Manager'], ['extension', 'Firefox delivery']]); source.value = conditionValues.source || '';
  const extraTags = phaseTwoInput('Optional required tags'); extraTags.value = conditionValues.tags?.join(', ') || '';
  const duplicate = phaseTwoSelect([['any', 'Duplicate or unique'], ['yes', 'Duplicates only'], ['no', 'Unique bookmarks only']]); duplicate.value = conditionValues.duplicate || 'any';
  const stopLabel = document.createElement('label'); const stop = document.createElement('input'); stop.type = 'checkbox'; stop.checked = editing?.stop !== false; stopLabel.append(stop, document.createTextNode('Stop after this rule matches'));
  advancedGrid.append(phaseTwoField('Rule name', name), phaseTwoField('Also limit by source', source), phaseTwoField('Also require tags', extraTags), phaseTwoField('Duplicate filter', duplicate), stopLabel);
  advanced.append(advancedSummary, advancedGrid); builder.appendChild(advanced);

  const summary = document.createElement('div'); summary.className = 'phase2-rule-sentence';
  const buildDraft = () => {
    const conditions = { hostname: '', urlText: '', titleText: '', source: '', tags: [], duplicate: 'any' };
    const type = conditionType.value; const value = matchValue.value.trim();
    if (type === 'duplicate') conditions.duplicate = 'yes';
    else if (type !== 'any') conditions[type] = type === 'tags' ? value.split(',') : value;
    if (type !== 'source' && source.value) conditions.source = source.value;
    if (type !== 'tags' && extraTags.value.trim()) conditions.tags = extraTags.value.split(',');
    if (type !== 'duplicate' && duplicate.value !== 'any') conditions.duplicate = duplicate.value;
    const actions = { addTags: [], titlePrefix: '', titleReplacement: '', routeBoardId: '', routeTabId: '', normalizeUrl: false, rejectDuplicate: false };
    if (phaseTwoAutomationBuilderGoal === 'tag') actions.addTags = addTags.value.split(',');
    if (phaseTwoAutomationBuilderGoal === 'rename') actions[renameMode.value === 'replace' ? 'titleReplacement' : 'titlePrefix'] = renameText.value;
    if (phaseTwoAutomationBuilderGoal === 'route') [actions.routeBoardId, actions.routeTabId] = route.value.split('|');
    if (phaseTwoAutomationBuilderGoal === 'clean') { actions.normalizeUrl = normalize.checked; actions.rejectDuplicate = reject.checked; }
    const fallbackName = `${recipes.find(recipe => recipe[0] === phaseTwoAutomationBuilderGoal)?.[1] || 'Automation'}: ${type === 'any' ? 'all incoming bookmarks' : value || conditionType.options[conditionType.selectedIndex].text}`;
    return normalizeAutomationRule({ id: editing?.id, name: name.value.trim() || fallbackName, enabled: editing?.enabled !== false, stop: stop.checked, conditions, actions });
  };
  function updateSummary() { summary.textContent = describeAutomationRule(buildDraft()); }
  [matchValue, addTags, renameText, name, extraTags].forEach(input => input.addEventListener('input', updateSummary));
  [conditionType, source, duplicate, renameMode, route, normalize, reject, stop].forEach(input => input.addEventListener('change', updateSummary));
  updateSummary(); builder.appendChild(summary);
  const builderActions = document.createElement('div'); builderActions.className = 'phase2-row';
  const saveRule = phaseTwoButton(editing ? 'Save Changes' : 'Create Rule', () => {
    const draft = buildDraft();
    const hasConditionValue = ['any', 'duplicate'].includes(conditionType.value) || matchValue.value.trim();
    const hasAction = draft.actions.addTags.length || draft.actions.titlePrefix || draft.actions.titleReplacement || draft.actions.routeTabId || draft.actions.normalizeUrl || draft.actions.rejectDuplicate;
    if (!hasConditionValue) { showNotice('Enter what the rule should match.'); matchValue.focus(); return; }
    if (!hasAction) { showNotice('Choose what should happen when the rule matches.'); return; }
    pushUndoSnapshot();
    const index = state.automationRules.findIndex(rule => rule.id === draft.id);
    if (index >= 0) state.automationRules[index] = draft; else state.automationRules.push(draft);
    phaseTwoEditingRuleId = null; saveState(); renderHubToolsPanel(); _phaseOneSetToolsStatus(editing ? 'Automation rule updated' : 'Automation rule created');
  }, true);
  builderActions.appendChild(saveRule);
  if (editing) builderActions.appendChild(phaseTwoButton('Cancel Editing', () => { phaseTwoEditingRuleId = null; renderHubToolsPanel(); }));
  builder.appendChild(builderActions); container.appendChild(builder);

  const rulesHeader = document.createElement('div'); rulesHeader.className = 'phase2-section-heading';
  const rulesTitle = document.createElement('h4'); rulesTitle.textContent = `Your rules (${state.automationRules.length})`;
  const ruleTools = document.createElement('div'); ruleTools.className = 'phase2-row';
  ruleTools.appendChild(phaseTwoButton('Export', () => phaseTwoDownloadJson({ kind: 'morpheus-automation-rules', version: 1, rules: state.automationRules }, 'morpheus-automation-rules.json')));
  const file = document.createElement('input'); file.type = 'file'; file.accept = '.json'; file.hidden = true;
  file.addEventListener('change', () => { const selected = file.files?.[0]; if (!selected) return; const reader = new FileReader(); reader.onload = () => { try { const parsed = JSON.parse(reader.result); if (!Array.isArray(parsed.rules)) throw new Error('Rules are missing'); pushUndoSnapshot(); state.automationRules = parsed.rules.map(normalizeAutomationRule); saveState(); renderHubToolsPanel(); } catch (error) { showNotice(error.message); } }; reader.readAsText(selected); });
  ruleTools.append(phaseTwoButton('Import', () => file.click()), file); rulesHeader.append(rulesTitle, ruleTools); container.appendChild(rulesHeader);
  const list = document.createElement('div'); list.className = 'phase2-list';
  (state.automationRules || []).forEach((raw, index) => {
    const rule = normalizeAutomationRule(raw, index); state.automationRules[index] = rule;
    const row = document.createElement('div'); row.className = 'phase2-card phase2-rule-card';
    const check = document.createElement('input'); check.type = 'checkbox'; check.checked = rule.enabled; check.title = rule.enabled ? 'Rule enabled' : 'Rule disabled';
    check.addEventListener('change', () => { rule.enabled = check.checked; saveState(); row.classList.toggle('is-disabled', !check.checked); });
    row.classList.toggle('is-disabled', !rule.enabled);
    const description = document.createElement('div'); description.className = 'phase2-card-main';
    const title = document.createElement('strong'); title.textContent = rule.name;
    const sentence = document.createElement('span'); sentence.textContent = describeAutomationRule(rule);
    const flow = document.createElement('small'); flow.textContent = rule.stop ? 'Stops here after a match' : 'Then checks the next rule too';
    description.append(title, sentence, flow);
    const actions = document.createElement('div'); actions.className = 'phase2-row';
    actions.append(phaseTwoButton('Edit', () => { phaseTwoEditingRuleId = rule.id; renderHubToolsPanel(); }), phaseTwoButton('↑', () => { if (index) { [state.automationRules[index - 1], state.automationRules[index]] = [state.automationRules[index], state.automationRules[index - 1]]; saveState(); renderHubToolsPanel(); } }), phaseTwoButton('↓', () => { if (index < state.automationRules.length - 1) { [state.automationRules[index + 1], state.automationRules[index]] = [state.automationRules[index], state.automationRules[index + 1]]; saveState(); renderHubToolsPanel(); } }), phaseTwoButton('Delete', () => { pushUndoSnapshot(); state.automationRules.splice(index, 1); if (phaseTwoEditingRuleId === rule.id) phaseTwoEditingRuleId = null; saveState(); renderHubToolsPanel(); }));
    row.append(check, description, actions); list.appendChild(row);
  });
  if (!list.children.length) { const empty = document.createElement('div'); empty.className = 'phase2-empty-rules'; empty.textContent = 'No rules yet. Start with one of the four jobs above—nothing runs until you create a rule.'; list.appendChild(empty); }
  container.appendChild(list);

  const testPanel = document.createElement('div'); testPanel.className = 'phase2-test-panel';
  const testText = document.createElement('div'); const testTitle = document.createElement('strong'); testTitle.textContent = 'Test before changing anything'; const testHelp = document.createElement('span'); testHelp.textContent = 'Preview shows exactly which current bookmarks match. Applying creates one Undo step.'; testText.append(testTitle, testHelp);
  const toolbar = document.createElement('div'); toolbar.className = 'phase2-row';
  const scope = phaseTwoSelect([['inbox', 'Active Tab Inbox'], ['import-manager', 'Import Manager']]);
  const previewBox = document.createElement('div'); previewBox.className = 'phase2-preview hidden';
  const renderPreview = () => {
    const results = phaseTwoPreviewAutomation(scope.value); previewBox.innerHTML = ''; previewBox.classList.remove('hidden');
    const matched = results.filter(result => result.matchedRules.length);
    if (!results.length) previewBox.textContent = 'The selected intake is empty.';
    else if (!matched.length) previewBox.textContent = `${results.length} bookmark${results.length === 1 ? '' : 's'} checked; none matched.`;
    else matched.forEach(result => { const row = document.createElement('div'); row.textContent = `${result.record.item.title || result.record.item.url} → ${result.proposed.rejected ? 'discard duplicate' : result.proposed.routeTabId ? 'move to another Inbox' : 'update'}${result.conflicts.length ? ` (${result.conflicts.join(', ')})` : ''}`; previewBox.appendChild(row); });
  };
  toolbar.append(scope, phaseTwoButton('Preview Matches', renderPreview), phaseTwoButton('Apply to Current Items', () => { const count = phaseTwoApplyAutomation(scope.value); _phaseOneSetToolsStatus(`Automation updated ${count} item${count === 1 ? '' : 's'}`); renderHubToolsPanel(); }, true));
  testPanel.append(testText, toolbar, previewBox); container.appendChild(testPanel);
}

function phaseTwoRenderSessions(container) {
  const status = document.createElement('p'); status.className = 'maintenance-detail';
  status.textContent = bridge?.supports?.('browserSessions') ? 'Firefox session bridge is available. Browser tab/window IDs are never saved.' : 'Install or reload the Firefox extension to capture and launch sessions.';
  container.appendChild(status);
  const controls = document.createElement('div'); controls.className = 'phase2-row';
  const scope = phaseTwoSelect([['active-tab', 'Active tab'], ['window', 'Current window'], ['highlighted', 'Selected tabs'], ['group', 'Current group']]);
  const capture = async targetType => {
    try {
      const result = await bridge.captureBrowserSession(scope.value);
      const session = sanitizeBrowserSession(result);
      if (!session.tabs.length) throw new Error('No supported web tabs were returned');
      if (targetType === 'session') { pushUndoSnapshot(); state.savedSessions.push(session); saveState(); renderHubToolsPanel(); if (typeof _savedSessionsRefreshWidgets === 'function') _savedSessionsRefreshWidgets(); return; }
      const board = getActiveBoard(); const tab = getBoardTab(board, state.activeTabId); const inbox = getBoardInbox(board, tab);
      const bookmarks = session.tabs.map(browserTab => ({ id: phaseTwoId('bm'), type: 'bookmark', title: browserTab.title, url: browserTab.url, tags: [], faviconCache: '' }));
      let createdSet = null;
      pushUndoSnapshot();
      if (targetType === 'set') {
        createdSet = createSet(session.title, { items: [] });
        bookmarks.forEach(bookmark => addBookmarkToSet(createdSet, bookmark));
      } else if (targetType === 'folder') {
        inbox.items.push({ id: phaseTwoId('folder'), type: 'folder', title: session.title, collapsed: true, tags: [], sharedTags: [], children: bookmarks });
      } else inbox.items.push(...bookmarks);
      saveState(); renderAll();
      if (createdSet && typeof showSetManagerForSet === 'function') {
        hideHubToolsPanel();
        showSetManagerForSet(createdSet.id, { focusTitle: true });
      } else {
        _phaseOneSetToolsStatus(`Captured ${session.tabs.length} tab${session.tabs.length === 1 ? '' : 's'} to ${targetType === 'folder' ? 'a new Inbox folder' : 'the active Inbox'}`);
      }
    } catch (error) { showNotice(error.message || String(error)); }
  };
  controls.append(scope, phaseTwoButton('Save Session', () => capture('session'), true), phaseTwoButton('To Inbox', () => capture('inbox')), phaseTwoButton('To New Folder', () => capture('folder')), phaseTwoButton('To New Set', () => capture('set')), phaseTwoButton('Load Recently Closed', async () => { try { const result = await bridge.captureBrowserSession('recent'); const session = sanitizeBrowserSession({ ...result, title: 'Recently Closed' }); pushUndoSnapshot(); state.savedSessions.push(session); saveState(); renderHubToolsPanel(); if (typeof _savedSessionsRefreshWidgets === 'function') _savedSessionsRefreshWidgets(); } catch (error) { showNotice(error.message); } }));
  container.appendChild(controls);
  const launchSources = phaseTwoHubLaunchSources();
  const launchRow = document.createElement('div'); launchRow.className = 'phase2-row';
  const launchSource = phaseTwoSelect(launchSources.map(source => [source.id, `${source.title} (${source.tabs.length})`]));
  const stagger = phaseTwoSelect([['0', 'No delay'], ['125', '125 ms stagger'], ['250', '250 ms stagger'], ['500', '500 ms stagger']]); stagger.value = '125';
  launchRow.append(launchSource, stagger, phaseTwoButton('Launch Hub Collection', async () => {
    const source = launchSources.find(entry => entry.id === launchSource.value); const tabs = dedupeSessionTabs(source?.tabs || []);
    const run = async () => { try { const result = await bridge.launchBrowserSession(tabs, { staggerMs: Number(stagger.value), recreateGroups: true }); _phaseOneSetToolsStatus(`Opened ${result.opened || 0}; ${result.failed || 0} failed`); } catch (error) { showNotice(error.message); } };
    if (tabs.length > 10) showConfirmDialog(`Open ${tabs.length} tabs?`, run, 'Open Tabs'); else run();
  }, true));
  container.appendChild(launchRow);
  const list = document.createElement('div'); list.className = 'phase2-list';
  (state.savedSessions || []).forEach((raw, index) => {
    const normalizedSession = sanitizeBrowserSession(raw); Object.assign(raw, normalizedSession); const session = raw;
    const row = document.createElement('div'); row.className = 'phase2-card';
    const main = document.createElement('div'); main.className = 'phase2-card-main'; main.innerHTML = `<strong>${session.title.replace(/[<>&]/g, '')}</strong><span>${session.tabs.length} tabs · ${new Date(session.createdAt).toLocaleString()}</span>`;
    const actions = document.createElement('div'); actions.className = 'phase2-row';
    actions.append(phaseTwoButton('Launch', async () => { const tabs = dedupeSessionTabs(session.tabs); const run = async () => { try { const result = await bridge.launchBrowserSession(tabs, { staggerMs: 125, recreateGroups: true }); session.lastLaunchedAt = new Date().toISOString(); session.updatedAt = session.lastLaunchedAt; state.savedSessions[index] = session; saveState(); _phaseOneSetToolsStatus(`Opened ${result.opened || tabs.length} tab${tabs.length === 1 ? '' : 's'}${result.groupingSupported === false ? '; groups were not available' : ''}`); renderHubToolsPanel(); if (typeof _savedSessionsRefreshWidgets === 'function') _savedSessionsRefreshWidgets(); } catch (error) { showNotice(error.message); } }; if (tabs.length > 10) showConfirmDialog(`Open ${tabs.length} tabs?`, run, 'Open Tabs'); else run(); }, true), phaseTwoButton('Delete', () => { pushUndoSnapshot(); state.savedSessions.splice(index, 1); saveState(); renderHubToolsPanel(); if (typeof _savedSessionsRefreshWidgets === 'function') _savedSessionsRefreshWidgets(); }));
    row.append(main, actions); list.appendChild(row);
  });
  if (!list.children.length) { const empty = document.createElement('p'); empty.className = 'hub-tools-empty'; empty.textContent = 'No saved sessions yet.'; list.appendChild(empty); }
  container.appendChild(list);
}

async function phaseTwoRefreshBackups() {
  phaseTwoBackups = await bridge.listDatabaseBackups();
  renderHubToolsPanel();
}

function phaseTwoRenderBackups(container) {
  const intro = document.createElement('p'); intro.className = 'maintenance-detail';
  intro.textContent = bridge?.supports?.('backupTimeline') ? 'Backups are read from the configured database backup directory and checked before preview.' : 'Backup timeline requires the native Firefox bridge and a configured shared database.';
  container.append(intro);
  const toolbar = document.createElement('div'); toolbar.className = 'phase2-row';
  const restoreScope = phaseTwoSelect([['full', 'Full Hub'], ['boards', 'Boards + navigation'], ['board', 'One board'], ['sets', 'Sets only'], ['set', 'One Set'], ['tags', 'Tags only'], ['settings', 'Settings only'], ['import-manager', 'Import Manager only'], ['item', 'One bookmark/folder']]);
  const itemQuery = phaseTwoInput('Item ID or exact title'); itemQuery.className = 'phase2-backup-item-query';
  restoreScope.addEventListener('change', () => itemQuery.classList.toggle('hidden', !['item', 'board', 'set'].includes(restoreScope.value)));
  itemQuery.classList.add('hidden');
  toolbar.append(phaseTwoButton('Refresh Timeline', () => phaseTwoRefreshBackups(), true), phaseTwoButton('Create Safety Backup', async () => { try { await bridge.createDatabaseSafetyBackup(); await phaseTwoRefreshBackups(); _phaseOneSetToolsStatus('Safety backup created'); } catch (error) { showNotice(error.message); } }), restoreScope, itemQuery); container.appendChild(toolbar);
  const list = document.createElement('div'); list.className = 'phase2-list';
  for (const backup of phaseTwoBackups) {
    const row = document.createElement('div'); row.className = `phase2-card${phaseTwoSelectedBackup === backup.name ? ' selected' : ''}`;
    const main = document.createElement('div'); main.className = 'phase2-card-main'; main.innerHTML = `<strong>${new Date(backup.modifiedMs).toLocaleString()}</strong><span>${Math.round((backup.size || 0) / 1024)} KiB · ${backup.integrity === 'ok' ? 'Integrity OK' : backup.integrity} · schema ${backup.summary?.schemaVersion || '?'}</span>`;
    row.append(main, phaseTwoButton('Compare', async () => { phaseTwoSelectedBackup = backup.name; try { const loaded = await bridge.readDatabaseBackup(backup.name); const changes = comparePhaseTwoSummaries(summarizePhaseTwoState(state), loaded.summary || summarizePhaseTwoState(JSON.parse(loaded.content))); _phaseOneSetToolsStatus(changes.map(change => `${change.key} ${change.delta >= 0 ? '+' : ''}${change.delta}`).join(' · ')); renderHubToolsPanel(); } catch (error) { showNotice(error.message); } }), phaseTwoButton('Restore…', async () => {
      if (backup.integrity !== 'ok') { showNotice('This backup failed its integrity check.'); return; }
      let loaded; try { loaded = await bridge.readDatabaseBackup(backup.name); } catch (error) { showNotice(error.message); return; }
      const restore = async () => {
        const previous = JSON.stringify(state);
        try {
          await bridge.createDatabaseSafetyBackup();
          const parsed = JSON.parse(loaded.content); const databasePath = state.databasePath; pushUndoSnapshot();
          state = restorePhaseTwoBackupScope(parsed, state, restoreScope.value, itemQuery.value);
          state.databasePath = databasePath;
          const result = await saveState();
          if (!result?.ok || result.conflict) throw new Error(result?.conflict ? 'The shared database changed during restore' : 'The restored state could not be saved');
          renderAll(); renderHubToolsPanel(); _phaseOneSetToolsStatus(`${restoreScope.options[restoreScope.selectedIndex].text} restored; a safety backup was created first`);
        } catch (error) { state = parseStateJson(previous); renderAll(); showNotice(`Restore rolled back: ${error.message}`); }
      };
      showConfirmDialog(`Restore ${restoreScope.options[restoreScope.selectedIndex].text} from ${new Date(backup.modifiedMs).toLocaleString()}? A safety backup will be created first.`, restore, 'Restore Backup');
    }, true)); list.appendChild(row);
  }
  if (!phaseTwoBackups.length) { const empty = document.createElement('p'); empty.className = 'hub-tools-empty'; empty.textContent = 'Refresh to load the backup timeline.'; list.appendChild(empty); }
  container.appendChild(list);
}

function phaseTwoRenderTransfer(container) {
  const exportCard = document.createElement('div'); exportCard.className = 'phase2-transfer-card';
  const heading = document.createElement('h4'); heading.textContent = 'Portable export';
  const folders = phaseTwoHubLaunchSources().filter(entry => entry.id.startsWith('folder|'));
  const scope = phaseTwoSelect([['active-tab', 'Active tab'], ['active-board', 'Active board'], ['active-inbox', 'Active Tab Inbox'], ['selected', 'Selected items'], ['folder', 'Folder'], ['set', 'Set'], ['smart-results', 'Current Smart View result'], ['all', 'Whole Hub (sanitized)']]);
  const set = phaseTwoSelect((state.sets || []).map(entry => [entry.id, entry.title]));
  const folder = phaseTwoSelect(folders.map(entry => [entry.id.split('|')[1], entry.title.replace(/^Folder: /, '')]));
  const includeFavicons = document.createElement('input'); includeFavicons.type = 'checkbox';
  const includeBackgrounds = document.createElement('input'); includeBackgrounds.type = 'checkbox';
  const includeTags = document.createElement('input'); includeTags.type = 'checkbox'; includeTags.checked = true;
  const includeSets = document.createElement('input'); includeSets.type = 'checkbox'; includeSets.checked = true;
  const includeUsage = document.createElement('input'); includeUsage.type = 'checkbox';
  const checks = document.createElement('div'); checks.className = 'phase2-checks';
  for (const [input, text] of [[includeTags, 'Include tags'], [includeSets, 'Include referenced Sets'], [includeFavicons, 'Include favicon cache'], [includeBackgrounds, 'Include backgrounds'], [includeUsage, 'Include local usage']]) { const label = document.createElement('label'); label.append(input, document.createTextNode(text)); checks.append(label); }
  exportCard.append(heading, scope, set, folder, checks, phaseTwoButton('Download Bundle', () => {
    const smartItems = typeof getSmartViewResults === 'function' ? getSmartViewResults(typeof activeSmartViewId === 'string' ? activeSmartViewId : 'recent', { days: 'all', limit: 'all' }) : [];
    const usage = includeUsage.checked && typeof getBookmarkActivityState === 'function' ? getBookmarkActivityState() : null;
    const bundle = createPortableBundle(state, scope.value, { setId: set.value, folderId: folder.value, items: smartItems, selectedIds: typeof selectedItemIds === 'undefined' ? [] : selectedItemIds, includeTags: includeTags.checked, includeSets: includeSets.checked, includeFavicons: includeFavicons.checked, includeBackgrounds: includeBackgrounds.checked, includeUsage: includeUsage.checked, usage });
    phaseTwoDownloadJson(bundle, `morpheus-${scope.value}-${new Date().toISOString().slice(0, 10)}.json`);
  }, true));
  const importCard = document.createElement('div'); importCard.className = 'phase2-transfer-card';
  const importHeading = document.createElement('h4'); importHeading.textContent = 'Portable import';
  const file = document.createElement('input'); file.type = 'file'; file.accept = '.json';
  const preview = document.createElement('div'); preview.className = 'phase2-preview'; preview.textContent = 'Choose a bundle to preview its scope, dependencies, and item counts.';
  const mode = phaseTwoSelect([['merge', 'Merge (skip duplicates)'], ['copy', 'Import as copies (new IDs)'], ['replace', 'Replace matching scope']]);
  const destination = phaseTwoSelect(state.boards.flatMap(board => (board.tabs || []).map(tab => [`${board.id}|${tab.id}`, `Destination: ${board.title} / ${tab.title}`])));
  const apply = phaseTwoButton('Apply Import', () => {
    if (!phaseTwoPendingBundle) return;
    const run = () => { const [destinationBoardId, destinationTabId] = destination.value.split('|'); pushUndoSnapshot(); const result = importPortableBundle(phaseTwoPendingBundle, state, { mode: mode.value, destinationBoardId, destinationTabId }); if (!result.ok) { showNotice(result.error); return; } saveState(); renderAll(); renderHubToolsPanel(); _phaseOneSetToolsStatus(`Portable import completed in ${mode.value} mode; Undo is available`); };
    if (mode.value === 'replace') showConfirmDialog('Replace data in the matching bundle scope? A single Undo snapshot will be kept.', run, 'Replace Scope'); else run();
  }, true); apply.disabled = true;
  file.addEventListener('change', () => { const selected = file.files?.[0]; if (!selected) return; const reader = new FileReader(); reader.onload = () => { try { const parsed = JSON.parse(reader.result); const validation = validatePortableBundle(parsed); if (!validation.ok) throw new Error(validation.error); phaseTwoPendingBundle = parsed; preview.textContent = `${validation.scope}: ${Object.entries(validation.counts).map(([key, count]) => `${count} ${key}`).join(', ')}. Sensitive settings, native paths, browser IDs, and runtime caches are excluded.`; apply.disabled = false; } catch (error) { phaseTwoPendingBundle = null; apply.disabled = true; preview.textContent = error.message; } }; reader.readAsText(selected); });
  importCard.append(importHeading, file, preview, mode, destination, apply);
  const grid = document.createElement('div'); grid.className = 'phase2-transfer-grid'; grid.append(exportCard, importCard); container.appendChild(grid);
}

function renderPhaseTwoTools(container) {
  if (!Array.isArray(state.automationRules)) state.automationRules = [];
  if (!Array.isArray(state.savedSessions)) state.savedSessions = [];
  phaseTwoSectionNav(container);
  const section = document.createElement('section'); section.className = 'phase2-section'; container.appendChild(section);
  if (activePhaseTwoSection === 'sessions') phaseTwoRenderSessions(section);
  else if (activePhaseTwoSection === 'backups') phaseTwoRenderBackups(section);
  else if (activePhaseTwoSection === 'transfer') phaseTwoRenderTransfer(section);
  else phaseTwoRenderAutomation(section);
}
