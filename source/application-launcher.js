const applicationStatusCache = new Map();
const applicationStatusRequests = new Map();

function createApplicationKey() {
  const token = globalThis.crypto?.randomUUID?.().replace(/-/g, '')
    || `${Date.now()}${Math.random().toString(36).slice(2, 14)}`;
  return `app_${token}`.slice(0, 79);
}

function createApplicationItem(application, options = {}) {
  return {
    id: options.id || `app-item-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type: 'application',
    title: String(options.title || application?.label || 'Application').slice(0, 160),
    appKey: application?.appKey || options.appKey || createApplicationKey(),
    applicationKind: String(application?.kind || options.applicationKind || '').slice(0, 40),
    tags: Array.isArray(options.tags) ? [...options.tags] : [],
    iconCache: String(application?.iconDataUrl || options.iconCache || '')
  };
}

function getApplicationStatus(item) {
  if (!item?.appKey) return { state: 'unbound', label: item?.title || 'Application', kind: '', iconDataUrl: '' };
  return applicationStatusCache.get(item.appKey) || {
    state: typeof bridge !== 'undefined' && bridge.supports?.('applicationLauncher') ? 'checking' : 'unavailable',
    label: item.title || 'Application',
    kind: item.applicationKind || '',
    iconDataUrl: item.iconCache || ''
  };
}

async function refreshApplicationStatus(item, options = {}) {
  if (!item?.appKey || typeof bridge === 'undefined' || typeof bridge.getApplicationStatus !== 'function') return getApplicationStatus(item);
  if (applicationStatusRequests.has(item.appKey)) return applicationStatusRequests.get(item.appKey);
  const previous = applicationStatusCache.get(item.appKey);
  const request = bridge.getApplicationStatus(item.appKey).then(status => {
    const normalized = status || { appKey: item.appKey, state: 'unbound', label: item.title || 'Application', kind: '', iconDataUrl: '' };
    applicationStatusCache.set(item.appKey, normalized);
    let stateChanged = previous?.state !== normalized.state;
    if (normalized.iconDataUrl && item.iconCache !== normalized.iconDataUrl) {
      item.iconCache = normalized.iconDataUrl;
      stateChanged = true;
      void saveState();
    }
    if (normalized.kind && item.applicationKind !== normalized.kind) {
      item.applicationKind = normalized.kind;
      stateChanged = true;
    }
    if (options.render !== false && stateChanged && typeof renderBoard === 'function') renderBoard();
    return normalized;
  }).catch(error => {
    const status = { appKey: item.appKey, state: 'unavailable', label: item.title || 'Application', kind: item.applicationKind || '', iconDataUrl: item.iconCache || '', error: error?.message || '' };
    applicationStatusCache.set(item.appKey, status);
    return status;
  }).finally(() => applicationStatusRequests.delete(item.appKey));
  applicationStatusRequests.set(item.appKey, request);
  return request;
}

function _applicationTargetList(context) {
  if (!context) return null;
  if (context.area === 'board-folder-item' && context.item?.type === 'folder' && !isDynamicFolder(context.item)) {
    context.item.children = context.item.children || [];
    context.item.collapsed = false;
    return context.item.children;
  }
  const board = getBoardForContext(context) || getActiveBoard();
  if (!board) return null;
  return getBoardItemContainers(board).find(container => container.id === context.columnId)?.items
    || getBoardTab(board)?.columns?.[0]?.items
    || null;
}

function _storeApprovedApplication(application, context) {
  if (!application) return null;
  const target = _applicationTargetList(context);
  if (!target) {
    showNotice('Select an unlocked board column first.');
    return null;
  }
  pushUndoSnapshot();
  const item = createApplicationItem(application);
  target.push(item);
  applicationStatusCache.set(item.appKey, application);
  renderAll();
  void saveState();
  showNotice(`Added ${item.title}.`);
  return item;
}

function _parseInternetShortcut(text = '') {
  let inShortcutSection = false;
  const targets = [];
  const iconHints = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      inShortcutSection = trimmed.toLowerCase() === '[internetshortcut]';
    } else if (inShortcutSection && /^url=/i.test(trimmed)) {
      targets.push(trimmed.slice(4).trim());
    } else if (inShortcutSection && /^iconfile=/i.test(trimmed)) {
      iconHints.push(trimmed.slice(9).trim());
    }
  }
  if (targets.length !== 1) throw new Error('The dropped Internet Shortcut must contain one application target.');
  return { targetUri: targets[0], iconHint: iconHints.length === 1 ? iconHints[0] : '' };
}

async function _readDroppedShortcutText(file) {
  if (!file || Number(file.size || 0) > 64 * 1024) throw new Error('The dropped shortcut is too large.');
  if (typeof file.arrayBuffer !== 'function') throw new Error('Firefox did not expose the dropped shortcut contents.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const utf16 = (bytes[0] === 0xff && bytes[1] === 0xfe) || bytes.some((value, index) => index < 64 && index % 2 === 1 && value === 0);
  return new TextDecoder(utf16 ? 'utf-16le' : 'utf-8').decode(bytes);
}

async function addDroppedApplicationShortcut(drop, context) {
  if (!drop?.application) return null;
  if (!drop.targetUri && (!/\.url$/i.test(drop.title || '') || !drop.file)) {
    showNotice('Firefox did not expose a readable application link. Choose it once in the native picker.');
    return addApplicationShortcut(context, { pickerTitle: `Select ${drop.title || 'application'}` });
  }
  if (typeof bridge === 'undefined' || !bridge.nativeIsAvailable?.() || !bridge.supports?.('applicationLauncher')) {
    showNotice('Application shortcuts require the Morpheus extension and native host.');
    return null;
  }
  try {
    const parsed = drop.targetUri
      ? { targetUri: drop.targetUri, iconHint: '' }
      : _parseInternetShortcut(await _readDroppedShortcutText(drop.file));
    const title = String(drop.title || 'Application').replace(/\.url$/i, '') || 'Application';
    const application = await bridge.approveApplicationLink('', title, parsed.targetUri, parsed.iconHint);
    return _storeApprovedApplication(application, context);
  } catch (error) {
    showNotice(error?.message || 'The dropped application link could not be approved.');
    return null;
  }
}

async function addApplicationShortcut(context = contextTarget, options = {}) {
  if (typeof bridge === 'undefined' || !bridge.nativeIsAvailable?.() || !bridge.supports?.('applicationLauncher')) {
    showNotice('Application shortcuts require the Morpheus extension and native host.');
    return null;
  }
  try {
    const pickerTitle = String(options.pickerTitle || 'Select an application').slice(0, 160);
    const application = await bridge.approveApplication('', pickerTitle);
    if (!application) return null;
    return _storeApprovedApplication(application, context);
  } catch (error) {
    showNotice(error?.message || 'The application could not be approved.');
    return null;
  }
}

async function rebindApplicationShortcut(item) {
  if (!item) return false;
  try {
    const application = await bridge.approveApplication(item.appKey, `Select ${item.title || 'application'}`);
    if (!application) return false;
    applicationStatusCache.set(item.appKey, application);
    if (application.iconDataUrl) item.iconCache = application.iconDataUrl;
    if (application.kind) item.applicationKind = application.kind;
    renderAll();
    void saveState();
    showNotice(`${item.title || application.label} is ready on this device.`);
    return true;
  } catch (error) {
    showNotice(error?.message || 'The application could not be rebound.');
    return false;
  }
}

async function launchApplicationShortcut(item) {
  if (!item?.appKey) return false;
  try {
    await bridge.launchApplication(item.appKey);
    applicationStatusCache.set(item.appKey, { ...getApplicationStatus(item), state: 'ready' });
    return true;
  } catch (error) {
    const status = await refreshApplicationStatus(item, { render: false });
    renderBoard();
    showNotice(status.state === 'unbound'
      ? `${item.title} needs to be set up on this device.`
      : (error?.message || `${item.title} could not be launched.`));
    return false;
  }
}

async function revealApplicationShortcut(item) {
  if (!item?.appKey) return false;
  try {
    await bridge.revealApplication(item.appKey);
    return true;
  } catch (error) {
    showNotice(error?.message || `${item.title || 'The application'} could not be revealed.`);
    return false;
  }
}

async function forgetApplicationShortcut(item) {
  if (!item?.appKey) return false;
  try {
    await bridge.forgetApplication(item.appKey);
    applicationStatusCache.set(item.appKey, {
      appKey: item.appKey,
      label: item.title || 'Application',
      kind: item.applicationKind || '',
      state: 'unbound',
      iconDataUrl: item.iconCache || ''
    });
    renderAll();
    showNotice(`${item.title || 'Application'} is no longer bound on this device.`);
    return true;
  } catch (error) {
    showNotice(error?.message || 'The device binding could not be removed.');
    return false;
  }
}

function duplicateApplicationShortcut(context = contextTarget) {
  const board = getBoardForContext(context);
  const found = board ? findBoardItemInColumns(board, context?.itemId) : null;
  if (!found?.item || found.item.type !== 'application') return false;
  pushUndoSnapshot();
  const copy = cloneData(found.item);
  copy.id = `app-item-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  copy.title = `${copy.title || 'Application'} (copy)`;
  found.list.splice(found.list.indexOf(found.item) + 1, 0, copy);
  renderAll();
  void saveState();
  return true;
}

function collectStoredApplications(root = state) {
  const entries = [];
  const walk = (items, metadata, path = [], inheritedLocked = false) => {
    for (const item of (items || [])) {
      if (!item) continue;
      const locked = inheritedLocked || item.locked === true || metadata.locked === true;
      if (item.type === 'application') {
        entries.push({
          key: [metadata.area, metadata.boardId || '', metadata.tabId || '', metadata.columnId || '', ...path, item.id].join(':'),
          item,
          ...metadata,
          location: [...metadata.locationParts, ...path].join(' / '),
          locked
        });
      } else if (item.type === 'folder' && !isDynamicFolder(item)) {
        walk(item.children || [], metadata, [...path, item.title || 'Untitled Folder'], locked);
      }
    }
  };
  for (const board of (root.boards || [])) {
    for (const tab of getBoardTabs(board)) {
      for (const column of (tab.columns || [])) {
        walk(column.items || [], { area: 'board', boardId: board.id, tabId: tab.id, columnId: column.id, locationParts: [board.title || 'Untitled Board', tab.title || 'Untitled Tab', column.title || 'Untitled Column'], locked: board.locked === true });
      }
      const inbox = getBoardInbox(board, tab);
      walk(inbox?.items || [], { area: 'inbox', boardId: board.id, tabId: tab.id, columnId: inbox?.id || '', locationParts: [board.title || 'Untitled Board', tab.title || 'Untitled Tab', 'Inbox'], locked: board.locked === true });
    }
  }
  return entries;
}
