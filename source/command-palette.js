const COMMAND_PALETTE_RECENTS_KEY = 'morpheus-webhub-command-palette-recents-v1';
const COMMAND_PALETTE_RESULT_LIMIT = 80;

let commandPaletteInitialized = false;
let commandPaletteEntries = [];
let commandPaletteVisibleEntries = [];
let commandPaletteSelectedIndex = 0;
let commandPalettePreviousFocus = null;
let commandPaletteIndexDirty = true;

function invalidateCommandPaletteIndex() {
  commandPaletteIndexDirty = true;
}

function _commandPaletteReadRecents() {
  try {
    const value = JSON.parse(localStorage.getItem(COMMAND_PALETTE_RECENTS_KEY) || '[]');
    return Array.isArray(value) ? value.filter(entry => typeof entry === 'string').slice(0, 20) : [];
  } catch {
    return [];
  }
}

function _commandPaletteRemember(entryId) {
  if (!entryId) return;
  const recents = [entryId, ..._commandPaletteReadRecents().filter(id => id !== entryId)].slice(0, 20);
  try { localStorage.setItem(COMMAND_PALETTE_RECENTS_KEY, JSON.stringify(recents)); } catch {}
}

function _commandPaletteNormalizeText(value) {
  return String(value || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}

function scoreCommandPaletteEntry(entry, query) {
  const normalizedQuery = _commandPaletteNormalizeText(query).trim();
  if (!normalizedQuery) return 1;
  const haystack = _commandPaletteNormalizeText(`${entry.label} ${entry.detail || ''} ${entry.keywords || ''}`);
  const words = normalizedQuery.split(/\s+/).filter(Boolean);
  let score = 0;
  for (const word of words) {
    const directIndex = haystack.indexOf(word);
    if (directIndex !== -1) {
      score += 120 - Math.min(80, directIndex);
      if (_commandPaletteNormalizeText(entry.label).startsWith(word)) score += 80;
      continue;
    }
    let cursor = 0;
    let gapPenalty = 0;
    for (const char of word) {
      const next = haystack.indexOf(char, cursor);
      if (next === -1) return 0;
      gapPenalty += Math.max(0, next - cursor);
      cursor = next + 1;
    }
    score += Math.max(10, 60 - gapPenalty);
  }
  return score;
}

function _commandPaletteOpenNewBookmark() {
  const board = getActiveBoard();
  const tab = getActiveTab();
  if (!board || !tab || board.locked || !(tab.columns || []).length) {
    showNotice('Select an unlocked board tab with at least one column first.');
    return;
  }
  const columnId = lastActiveColumnId || tab.columns[0].id;
  contextTarget = { area: 'board-empty', columnId };
  showModal('addBookmark', {
    title: 'New Bookmark',
    placeholder1: 'New Bookmark',
    showUrl: true,
    placeholder2: 'Bookmark URL',
    showTags: true,
    inheritedTags: getContextInheritedTags(contextTarget)
  });
}

function _commandPaletteOpenNewApplication() {
  const board = getActiveBoard();
  const tab = getActiveTab();
  if (!board || !tab || board.locked || !(tab.columns || []).length) {
    showNotice('Select an unlocked board tab with at least one column first.');
    return;
  }
  contextTarget = { area: 'board-empty', columnId: lastActiveColumnId || tab.columns[0].id };
  void addApplicationShortcut(contextTarget);
}

function _commandPaletteActivateBoard(board, tab = null) {
  if (!board) return;
  state.activeBoardId = board.id;
  state.activeTabId = tab?.id || getBoardTabs(board)[0]?.id || null;
  renderAll();
  void saveState();
}

function _commandPaletteStoredFolders() {
  const folders = [];
  const walk = (items, metadata, path = []) => {
    for (const item of (items || [])) {
      if (item?.type !== 'folder') continue;
      const location = [...metadata.locationParts, ...path].join(' / ');
      folders.push({ item, ...metadata, location, parentPath: path });
      if (!isDynamicFolder(item)) walk(item.children || [], metadata, [...path, item.title || 'Untitled Folder']);
    }
  };
  for (const board of (state.boards || [])) {
    for (const tab of getBoardTabs(board)) {
      for (const column of (tab.columns || [])) {
        walk(column.items || [], { area: 'board', boardId: board.id, tabId: tab.id, columnId: column.id, locationParts: [board.title || 'Untitled Board', tab.title || 'Untitled Tab', column.title || 'Untitled Column'] });
      }
      const inbox = getBoardInbox(board, tab);
      walk(inbox?.items || [], { area: 'inbox', boardId: board.id, tabId: tab.id, columnId: inbox?.id || '', locationParts: [board.title || 'Untitled Board', tab.title || 'Untitled Tab', 'Inbox'] });
    }
  }
  walk(state.importManager?.items || [], { area: 'import-manager', locationParts: ['Import Manager'] });
  return folders;
}

function _commandPaletteStoredWidgets() {
  const widgets = [];
  const walkBoardItems = (items, metadata) => {
    for (const item of (items || [])) {
      if (item?.type === 'widget') widgets.push({ item, ...metadata });
      if (item?.type === 'folder' && !isDynamicFolder(item)) walkBoardItems(item.children || [], metadata);
    }
  };
  for (const board of (state.boards || [])) {
    for (const tab of getBoardTabs(board)) {
      for (const column of (tab.columns || [])) {
        walkBoardItems(column.items || [], { area: 'board', boardId: board.id, tabId: tab.id, columnId: column.id, location: `${board.title || 'Untitled Board'} / ${tab.title || 'Untitled Tab'} / ${column.title || 'Untitled Column'}` });
      }
      const inbox = getBoardInbox(board, tab);
      walkBoardItems(inbox?.items || [], { area: 'board', boardId: board.id, tabId: tab.id, columnId: inbox?.id || '', location: `${board.title || 'Untitled Board'} / ${tab.title || 'Untitled Tab'} / Inbox` });
    }
  }
  const walkNav = (items, parentId = null) => {
    for (const item of (items || [])) {
      if (item?.type === 'widget') widgets.push({ item, area: 'nav-item', parentId, location: 'Sidebar' });
      if (item?.children) walkNav(item.children, item.id);
    }
  };
  walkNav(state.navItems || []);
  return widgets;
}

function _commandPaletteOpenFolder(folder) {
  closeCommandPalette();
  if (folder.area === 'import-manager') {
    showImportManagerPanel();
    return;
  }
  locateStoredBookmarkEntry({ ...folder, item: folder.item });
}

function _commandPaletteOpenWidget(widgetEntry) {
  if (widgetEntry.boardId) {
    state.activeBoardId = widgetEntry.boardId;
    state.activeTabId = widgetEntry.tabId;
    renderAll();
  }
  contextTarget = widgetEntry.area === 'nav-item'
    ? { area: 'nav-item', itemId: widgetEntry.item.id, parentId: widgetEntry.parentId, item: widgetEntry.item }
    : { area: 'board-item', boardId: widgetEntry.boardId, tabId: widgetEntry.tabId, columnId: widgetEntry.columnId, itemId: widgetEntry.item.id, item: widgetEntry.item };
  handleContextMenuAction('editWidget');
}

function _commandPaletteRunBookmarkAction(entry, action) {
  const target = contextTargetForStoredBookmarkEntry(entry);
  if (!target) return;
  if (entry.locked && action !== 'open') {
    showNotice('This bookmark or its board is locked.');
    return;
  }
  if (entry.boardId) {
    state.activeBoardId = entry.boardId;
    if (entry.tabId) state.activeTabId = entry.tabId;
    renderAll();
  }
  contextTarget = target;
  if (action === 'open') openHubBookmark(entry.item);
  else if (action === 'edit') _showEditBookmarkModal(target);
  else if (action === 'tag') _showEditBookmarkModal(target, { title: 'Edit Bookmark Tags' });
  else if (action === 'move' || action === 'inbox') _showMoveToBoardModal(target, action === 'inbox' ? 'Send bookmark to Tab Inbox' : 'Move bookmark to Tab Inbox');
  else if (action === 'set') {
    showContextMenu(Math.max(8, window.innerWidth / 2 - 130), Math.max(8, window.innerHeight / 3), [
      { label: 'Add to Set…', action: '', submenu: _buildAddToSetSubmenu() }
    ]);
  }
}

function _commandPaletteLocateBookmark(entry) {
  closeCommandPalette();
  locateStoredBookmarkEntry(entry);
}

function _commandPaletteRunApplicationAction(entry, action = 'launch') {
  if (!entry?.item) return;
  if (entry.boardId) {
    state.activeBoardId = entry.boardId;
    if (entry.tabId) state.activeTabId = entry.tabId;
    renderAll();
  }
  contextTarget = { area: 'board-item', boardId: entry.boardId, tabId: entry.tabId, columnId: entry.columnId, itemId: entry.item.id, item: entry.item };
  if (action === 'launch' || action === 'open') void launchApplicationShortcut(entry.item);
  else if (action === 'edit' || action === 'tag') _showEditApplicationModal(contextTarget, action === 'tag' ? { title: 'Edit Application Tags' } : {});
  else if (action === 'move' || action === 'inbox') _showMoveToBoardModal(contextTarget, 'Move application to Tab Inbox');
}

function buildCommandPaletteEntries() {
  const entries = [];
  const add = entry => entries.push(entry);
  const addCommand = (id, label, detail, run, keywords = '', shortcut = '') => add({
    id: `command:${id}`,
    group: 'Commands',
    label,
    detail,
    keywords,
    shortcut,
    run
  });

  addCommand('smart-views', 'Open Smart Views', 'Bookmark activity, duplicates, health, and favicon views', () => showHubToolsPanel('smart'), 'recent most used never opened added');
  addCommand('maintenance', 'Open Bookmark Maintenance', 'URL migration, duplicates, link health, and tracking cleanup', () => showHubToolsPanel('maintenance'), 'replace hostname redirect broken links');
  addCommand('workflows', 'Open Workflows', 'Inbox automation, browser sessions, backup timeline, and portable transfer', () => showHubToolsPanel('workflows'), 'rules session backup export import restore');
  addCommand('search', 'Open Search', 'Search the complete Hub', () => openSearchModal({}), 'find filter', 'Ctrl+F');
  addCommand('new-bookmark', 'Create Bookmark', 'Add a bookmark to the active column', _commandPaletteOpenNewBookmark, 'new add');
  addCommand('new-application', 'Create Application Shortcut', 'Choose an approved application for the active column', _commandPaletteOpenNewApplication, 'new add app launcher executable');
  addCommand('inbox', 'Open Active Inbox', 'Review externally delivered and moved items', () => showInboxPanel(), 'incoming');
  addCommand('import-manager', 'Open Import Manager', 'Review browser bookmark imports', () => showImportManagerPanel(), 'imports');
  addCommand('sets', 'Open Sets Manager', 'Manage manual and dynamic Sets', () => showSetManagerPanel(), 'collections');
  addCommand('tags', 'Open Tag Manager', 'Manage tags, groups, and colours', () => showTagManagerPanel(), 'labels');
  addCommand('trash', 'Open Recently Deleted', 'Restore or permanently remove deleted items', () => showTrashPanel(), 'trash restore');
  addCommand('settings', 'Open Settings', 'Configure the Hub', () => showSettingsPanel('general'), 'preferences');

  for (const definition of SMART_VIEW_DEFINITIONS) {
    add({
      id: `smart:${definition.id}`,
      group: 'Smart Views',
      label: definition.label,
      detail: 'Open this read-only bookmark view',
      keywords: `smart view ${definition.id}`,
      run() {
        activeSmartViewId = definition.id;
        showHubToolsPanel('smart');
      }
    });
  }

  for (const board of (state.boards || [])) {
    add({
      id: `board:${board.id}`,
      group: 'Boards',
      label: board.title || 'Untitled Board',
      detail: `${getBoardTabs(board).length} tab${getBoardTabs(board).length === 1 ? '' : 's'}`,
      keywords: 'board switch navigate',
      run: () => _commandPaletteActivateBoard(board)
    });
    for (const tab of getBoardTabs(board)) {
      add({
        id: `tab:${board.id}:${tab.id}`,
        group: 'Tabs',
        label: tab.title || 'Untitled Tab',
        detail: board.title || 'Untitled Board',
        keywords: 'tab switch navigate',
        run: () => _commandPaletteActivateBoard(board, tab)
      });
    }
  }

  for (const folder of _commandPaletteStoredFolders()) {
    add({
      id: `folder:${folder.area}:${folder.boardId || ''}:${folder.item.id}`,
      group: 'Folders',
      label: folder.item.title || 'Untitled Folder',
      detail: folder.location,
      keywords: `folder ${isDynamicFolder(folder.item) ? 'dynamic smart' : ''}`,
      run: () => _commandPaletteOpenFolder(folder)
    });
  }

  for (const entry of collectStoredBookmarks()) {
    add({
      id: `bookmark:${entry.key}`,
      group: 'Bookmarks',
      label: entry.item.title || entry.item.url || 'Untitled Bookmark',
      detail: `${entry.location} · ${entry.item.url}`,
      keywords: `bookmark ${entry.item.url} ${(entry.item.tags || []).map(id => resolveTag(id)?.name || '').join(' ')}`,
      run: () => openHubBookmark(entry.item),
      locate: () => _commandPaletteLocateBookmark(entry)
    });
  }

  for (const entry of (typeof collectStoredApplications === 'function' ? collectStoredApplications() : [])) {
    const status = getApplicationStatus(entry.item);
    add({
      id: `application:${entry.key}`,
      group: 'Applications',
      label: entry.item.title || 'Application',
      detail: `${entry.location} · ${status.state === 'ready' ? 'Ready' : status.state}`,
      keywords: `application app launch ${(entry.item.tags || []).map(id => resolveTag(id)?.name || '').join(' ')}`,
      run: () => void launchApplicationShortcut(entry.item)
    });
  }

  for (const set of (state.sets || [])) {
    const count = resolveSetItems(set).length;
    add({
      id: `set:${set.id}`,
      group: 'Sets',
      label: set.title || 'Untitled Set',
      detail: `${count} bookmark${count === 1 ? '' : 's'}`,
      keywords: 'set collection',
      run: () => openSetById(set.id)
    });
  }

  for (const tag of (state.tags || [])) {
    add({
      id: `tag:${tag.id}`,
      group: 'Tags',
      label: tag.name || tag.id,
      detail: 'Search bookmarks with this tag',
      keywords: 'tag label filter',
      run: () => openSearchModal({ tagId: tag.id })
    });
  }

  for (const widgetEntry of _commandPaletteStoredWidgets()) {
    const definition = WIDGET_REGISTRY[widgetEntry.item.widgetType] || {};
    add({
      id: `widget:${widgetEntry.area}:${widgetEntry.item.id}`,
      group: 'Widgets',
      label: widgetEntry.item.title || definition.name || 'Widget',
      detail: widgetEntry.location,
      keywords: `widget ${definition.category || ''} ${widgetEntry.item.widgetType || ''}`,
      run: () => _commandPaletteOpenWidget(widgetEntry)
    });
  }

  for (const [widgetType, definition] of Object.entries(WIDGET_REGISTRY)) {
    if (!definition.allowedIn?.includes('column')) continue;
    add({
      id: `action:add-widget:${widgetType}`,
      group: 'Actions',
      label: `Add ${definition.name || widgetType} Widget`,
      detail: 'Add to the active column',
      keywords: `create widget ${definition.category || ''}`,
      run() {
        const board = getActiveBoard();
        const tab = getActiveTab();
        if (!board || board.locked || !(tab?.columns || []).length) {
          showNotice('Select an unlocked board tab with at least one column first.');
          return;
        }
        contextTarget = { area: 'board-empty', columnId: lastActiveColumnId || tab.columns[0].id };
        handleContextMenuAction(`addWidget:${widgetType}`);
      }
    });
  }

  const settingsPages = [
    ['general', 'General Settings'], ['ui', 'UI Settings'], ['api-keys', 'API Keys'],
    ['theme', 'Theme Settings'], ['style', 'Style Settings'], ['about', 'About Morpheus WebHub']
  ];
  for (const [tab, label] of settingsPages) {
    add({
      id: `settings:${tab}`,
      group: 'Settings',
      label,
      detail: 'Open this Settings page',
      keywords: `preferences configuration ${tab}`,
      run: () => showSettingsPanel(tab)
    });
  }

  commandPaletteEntries = entries;
  commandPaletteIndexDirty = false;
  return entries;
}

function _commandPaletteContextualEntries(query, baseEntries) {
  const match = String(query || '').trim().match(/^(open|launch|edit|move|tag|add to set|set|send to inbox|inbox)\s+(.+)$/i);
  if (!match) return [];
  const requested = match[1].toLowerCase();
  const term = match[2];
  const action = requested === 'add to set' || requested === 'set' ? 'set'
    : requested === 'send to inbox' || requested === 'inbox' ? 'inbox'
      : requested;
  const label = action === 'set' ? 'Add to Set' : action === 'inbox' ? 'Send to Inbox' : action[0].toUpperCase() + action.slice(1);
  const storedByPaletteId = new Map(collectStoredBookmarks().map(entry => [`bookmark:${entry.key}`, entry]));
  const bookmarkEntries = action === 'launch' ? [] : baseEntries.filter(entry => entry.group === 'Bookmarks')
    .map(entry => {
      const storedEntry = storedByPaletteId.get(entry.id);
      if (!storedEntry) return null;
      return {
        id: `bookmark-action:${action}:${storedEntry.key}`,
        group: 'Bookmark Actions',
        label: `${label}: ${entry.label}`,
        detail: `${storedEntry.locked ? 'Locked · ' : ''}${entry.detail}`,
        keywords: `${term} ${entry.keywords || ''}`,
        run: () => _commandPaletteRunBookmarkAction(storedEntry, action)
      };
    }).filter(Boolean);
  const applicationByPaletteId = new Map((typeof collectStoredApplications === 'function' ? collectStoredApplications() : []).map(entry => [`application:${entry.key}`, entry]));
  const applicationEntries = ['open', 'launch', 'edit', 'move', 'tag', 'inbox'].includes(action)
    ? baseEntries.filter(entry => entry.group === 'Applications').map(entry => {
        const storedEntry = applicationByPaletteId.get(entry.id);
        if (!storedEntry) return null;
        const applicationAction = action === 'open' ? 'launch' : action;
        return {
          id: `application-action:${applicationAction}:${storedEntry.key}`,
          group: 'Application Actions',
          label: `${applicationAction[0].toUpperCase() + applicationAction.slice(1)}: ${entry.label}`,
          detail: entry.detail,
          keywords: `${term} ${entry.keywords || ''}`,
          run: () => _commandPaletteRunApplicationAction(storedEntry, applicationAction)
        };
      }).filter(Boolean)
    : [];
  return [...bookmarkEntries, ...applicationEntries];
}

function _commandPaletteCalculatorEntry(query) {
  const trimmed = String(query || '').trim();
  if (!trimmed.startsWith('=') || typeof _calculatorEvaluateExpression !== 'function') return null;
  const expression = trimmed.slice(1).trim();
  if (!expression) {
    return {
      id: 'calculator:help',
      group: 'Calculator',
      label: 'Enter an expression after =',
      detail: 'Example: = (12 + 8) * 5%',
      keywords: trimmed,
      run: () => openCommandPalette('=')
    };
  }
  try {
    const formatted = _calculatorFormatNumber(_calculatorEvaluateExpression(expression), 12);
    return {
      id: `calculator:${expression}`,
      group: 'Calculator',
      label: formatted,
      detail: `${expression} = ${formatted}`,
      shortcut: 'Enter Copy',
      keywords: trimmed,
      run: async () => {
        const copied = await _calculatorCopyText(formatted);
        showNotice(copied ? `Copied ${formatted}.` : 'Could not copy the result.');
      }
    };
  } catch (error) {
    return {
      id: `calculator:error:${expression}`,
      group: 'Calculator',
      label: 'Invalid expression',
      detail: error?.message || 'Check the expression and try again.',
      keywords: trimmed,
      run: () => openCommandPalette(trimmed)
    };
  }
}

function _commandPaletteFilteredEntries(query = '') {
  const recents = _commandPaletteReadRecents();
  const recentRank = new Map(recents.map((id, index) => [id, recents.length - index]));
  const baseEntries = commandPaletteIndexDirty || !commandPaletteEntries.length ? buildCommandPaletteEntries() : commandPaletteEntries;
  const calculatorEntry = _commandPaletteCalculatorEntry(query);
  const entries = [...(calculatorEntry ? [calculatorEntry] : []), ..._commandPaletteContextualEntries(query, baseEntries), ...baseEntries];
  return entries
    .map(entry => ({ entry, score: entry === calculatorEntry ? Number.MAX_SAFE_INTEGER : scoreCommandPaletteEntry(entry, query) }))
    .filter(result => result.score > 0)
    .sort((a, b) => {
      if (!query.trim()) {
        const recentDifference = (recentRank.get(b.entry.id) || 0) - (recentRank.get(a.entry.id) || 0);
        if (recentDifference) return recentDifference;
        if (a.entry.group === 'Commands' && b.entry.group !== 'Commands') return -1;
        if (b.entry.group === 'Commands' && a.entry.group !== 'Commands') return 1;
      }
      return b.score - a.score || a.entry.label.localeCompare(b.entry.label);
    })
    .slice(0, COMMAND_PALETTE_RESULT_LIMIT)
    .map(result => result.entry);
}

function renderCommandPaletteResults() {
  const input = document.getElementById('commandPaletteInput');
  const results = document.getElementById('commandPaletteResults');
  if (!input || !results) return;
  commandPaletteVisibleEntries = _commandPaletteFilteredEntries(input.value);
  commandPaletteSelectedIndex = Math.max(0, Math.min(commandPaletteSelectedIndex, commandPaletteVisibleEntries.length - 1));
  results.innerHTML = '';

  if (!commandPaletteVisibleEntries.length) {
    const empty = document.createElement('div');
    empty.className = 'hub-tools-empty';
    empty.textContent = 'No matching bookmarks or commands.';
    results.appendChild(empty);
    input.removeAttribute('aria-activedescendant');
    return;
  }

  let previousGroup = '';
  commandPaletteVisibleEntries.forEach((entry, index) => {
    if (entry.group !== previousGroup) {
      const group = document.createElement('div');
      group.className = 'command-palette-group-label';
      group.textContent = entry.group;
      results.appendChild(group);
      previousGroup = entry.group;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.id = `command-palette-option-${index}`;
    button.className = `command-palette-result${index === commandPaletteSelectedIndex ? ' active' : ''}`;
    button.setAttribute('role', 'option');
    button.setAttribute('aria-selected', index === commandPaletteSelectedIndex ? 'true' : 'false');
    button.dataset.resultIndex = String(index);
    const main = document.createElement('span');
    main.className = 'command-palette-result-main';
    const label = document.createElement('span');
    label.className = 'command-palette-result-label';
    label.textContent = entry.label;
    const detail = document.createElement('span');
    detail.className = 'command-palette-result-detail';
    detail.textContent = entry.detail || '';
    main.append(label, detail);
    const shortcut = document.createElement('span');
    shortcut.className = 'command-palette-result-shortcut';
    shortcut.textContent = entry.shortcut || (entry.locate ? 'Alt+Enter Locate' : '');
    button.append(main, shortcut);
    button.addEventListener('mousemove', () => {
      if (commandPaletteSelectedIndex === index) return;
      commandPaletteSelectedIndex = index;
      _commandPaletteUpdateSelection();
    });
    button.addEventListener('click', () => runCommandPaletteEntry(index));
    results.appendChild(button);
  });
  input.setAttribute('aria-activedescendant', `command-palette-option-${commandPaletteSelectedIndex}`);
}

function _commandPaletteUpdateSelection() {
  const input = document.getElementById('commandPaletteInput');
  document.querySelectorAll('.command-palette-result').forEach(button => {
    const active = Number(button.dataset.resultIndex) === commandPaletteSelectedIndex;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
    if (active) button.scrollIntoView({ block: 'nearest' });
  });
  if (commandPaletteVisibleEntries.length) input?.setAttribute('aria-activedescendant', `command-palette-option-${commandPaletteSelectedIndex}`);
}

function runCommandPaletteEntry(index = commandPaletteSelectedIndex, options = {}) {
  const entry = commandPaletteVisibleEntries[index];
  if (!entry) return;
  _commandPaletteRemember(entry.id);
  closeCommandPalette();
  if (options.locate && entry.locate) entry.locate();
  else entry.run?.();
}

function openCommandPalette(query = '') {
  const overlay = document.getElementById('commandPaletteOverlay');
  const input = document.getElementById('commandPaletteInput');
  if (!overlay || !input) return;
  commandPalettePreviousFocus = document.activeElement;
  overlay.classList.remove('hidden');
  input.value = query;
  commandPaletteSelectedIndex = 0;
  renderCommandPaletteResults();
  requestAnimationFrame(() => input.focus());
}

function closeCommandPalette() {
  const overlay = document.getElementById('commandPaletteOverlay');
  if (!overlay || overlay.classList.contains('hidden')) return;
  overlay.classList.add('hidden');
  document.getElementById('commandPaletteInput')?.removeAttribute('aria-activedescendant');
  if (commandPalettePreviousFocus?.isConnected) commandPalettePreviousFocus.focus();
  commandPalettePreviousFocus = null;
}

function initializeCommandPalette() {
  if (commandPaletteInitialized) return;
  commandPaletteInitialized = true;
  const input = document.getElementById('commandPaletteInput');
  const overlay = document.getElementById('commandPaletteOverlay');
  input?.addEventListener('input', () => {
    commandPaletteSelectedIndex = 0;
    renderCommandPaletteResults();
  });
  input?.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      commandPaletteSelectedIndex = Math.min(commandPaletteVisibleEntries.length - 1, commandPaletteSelectedIndex + 1);
      _commandPaletteUpdateSelection();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      commandPaletteSelectedIndex = Math.max(0, commandPaletteSelectedIndex - 1);
      _commandPaletteUpdateSelection();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      runCommandPaletteEntry(commandPaletteSelectedIndex, { locate: event.altKey });
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeCommandPalette();
    }
  });
  overlay?.addEventListener('mousedown', event => {
    if (event.target === overlay) closeCommandPalette();
  });
  overlay?.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const focusable = [...overlay.querySelectorAll('input:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])')]
      .filter(element => element.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  document.addEventListener('keydown', event => {
    if (event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      if (overlay?.classList.contains('hidden')) openCommandPalette();
      else closeCommandPalette();
      return;
    }
    if (event.key === 'Escape' && !overlay?.classList.contains('hidden')) {
      event.preventDefault();
      closeCommandPalette();
    }
  });
}
