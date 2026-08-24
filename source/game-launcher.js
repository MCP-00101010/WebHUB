const gameStatusCache = new Map();
const gameStatusRequests = new Map();
const gameTooltipItems = new WeakMap();

const GAME_SYSTEMS = Object.freeze({
  'zx-spectrum': { label: 'ZX Spectrum', iconId: 'icon-system-zx-spectrum' },
  'atari-st': { label: 'Atari ST', iconId: 'icon-system-atari-st' },
  'game-boy': { label: 'Game Boy', iconId: 'icon-system-game-boy' },
  snes: { label: 'Super Nintendo', iconId: 'icon-system-snes' },
  scummvm: { label: 'ScummVM', iconId: 'icon-system-scummvm' },
  dosbox: { label: 'DOSBox', iconId: 'icon-system-dosbox' },
  mame: { label: 'Arcade / MAME', iconId: 'icon-system-mame' }
});

function getGameSystemDescriptor(item = {}) {
  const values = [item.systemId, item.systemName, ...(Array.isArray(item.tags) ? item.tags : [])]
    .map(value => String(value || '').trim()).filter(Boolean);
  const text = values.join(' ').toLowerCase().replace(/[_-]/g, ' ');
  const compact = text.replace(/[^a-z0-9+]+/g, '');
  let id = String(item.systemId || '').trim().toLowerCase();
  const matches = aliases => aliases.some(alias => text.includes(alias) || compact.includes(alias.replace(/[^a-z0-9+]+/g, '')));
  if (matches(['zx spectrum', 'spectrum', 'eightyone', 'spectaculator'])) id = 'zx-spectrum';
  else if (matches(['atari st', 'steem', 'hatari'])) id = 'atari-st';
  else if (matches(['game boy', 'gameboy', 'visualboy', 'sameboy', 'gambatte'])) id = 'game-boy';
  else if (matches(['super nintendo', 'snes', 'snes9x', 'bsnes'])) id = 'snes';
  else if (matches(['scummvm', 'scumm vm'])) id = 'scummvm';
  else if (matches(['dosbox', 'ms dos', 'dos game'])) id = 'dosbox';
  else if (matches(['mame', 'arcade'])) id = 'mame';
  const known = GAME_SYSTEMS[id];
  if (known) return { id, ...known };
  const label = String(item.systemName || '').trim();
  return id && label ? { id, label, iconId: 'icon-system-generic' } : null;
}

function renderGameSystemIcon(container, item) {
  const system = getGameSystemDescriptor(item);
  container.classList.add('game-system-icon');
  container.dataset.system = system?.id || 'generic';
  container.title = system?.label || 'Game';
  container.appendChild(icon(system?.iconId || 'icon-system-generic'));
  return container;
}

function registerGameTooltipTarget(target, item) {
  target.dataset.tooltip = item.title || 'Game';
  target.dataset.tooltipKind = 'game';
  gameTooltipItems.set(target, item);
}

function getGameTooltipDetails(item = {}) {
  const system = getGameSystemDescriptor(item);
  return {
    title: String(item.title || 'Game'),
    system: system?.label || String(item.systemName || 'Game system'),
    emulator: String(item.emulatorName || 'Unknown emulator'),
    profile: String(item.profileName || 'Automatic'),
    thumbnail: /^data:image\/(?:png|jpe?g|gif|webp|avif);base64,/i.test(String(item.thumbnailCache || '')) ? item.thumbnailCache : ''
  };
}

function renderGameTooltip(container, target) {
  const details = getGameTooltipDetails(gameTooltipItems.get(target));
  container.replaceChildren();
  if (details.thumbnail) {
    const image = document.createElement('img');
    image.className = 'game-tooltip-thumbnail';
    image.src = details.thumbnail;
    image.alt = '';
    container.appendChild(image);
  }
  const body = document.createElement('div');
  body.className = 'game-tooltip-body';
  const title = document.createElement('strong');
  title.className = 'game-tooltip-title';
  title.textContent = details.title;
  body.appendChild(title);
  const system = document.createElement('span');
  system.className = 'game-tooltip-system';
  system.textContent = details.system;
  body.appendChild(system);
  for (const [label, value] of [['Emulator', details.emulator], ['Profile', details.profile]]) {
    const row = document.createElement('div');
    row.className = 'game-tooltip-detail';
    const key = document.createElement('span');
    key.textContent = label;
    const text = document.createElement('span');
    text.textContent = value;
    row.append(key, text);
    body.appendChild(row);
  }
  container.appendChild(body);
}

function getGameStatus(item) {
  if (!item?.gameKey) return { state: 'unbound', title: item?.title || 'Game', thumbnailCache: '' };
  return gameStatusCache.get(item.gameKey) || {
    state: typeof bridge !== 'undefined' && bridge.supports?.('emuguiService') ? 'checking' : 'unavailable',
    title: item.title || 'Game',
    thumbnailCache: item.thumbnailCache || ''
  };
}

function getGameStatusMessage(status, title = 'This game') {
  const messages = {
    unbound: `${title} is not set up on this device.`,
    'library-missing': `${title}'s EmuGUI library is not currently active.`,
    'game-missing': `${title} is missing from its EmuGUI library.`,
    'emulator-missing': `${title}'s emulator is unavailable.`,
    'profile-missing': `${title}'s emulator profile is unavailable.`,
    incompatible: `${title}'s saved emulator configuration is incompatible.`,
    changed: `${title}'s source configuration has changed and should be rebound.`,
    unavailable: 'Morpheus EmuGUI is unavailable.'
  };
  return status?.error || messages[status?.state] || `${title} is not ready to launch.`;
}

function getGameStatusPresentation(status = {}) {
  const labels = {
    checking: 'Checking',
    unbound: 'Set up',
    'library-missing': 'Library',
    'game-missing': 'Missing',
    'emulator-missing': 'Emulator',
    'profile-missing': 'Profile',
    incompatible: 'Incompatible',
    changed: 'Changed',
    unavailable: 'Offline'
  };
  return {
    label: status.state === 'ready' ? 'Ready' : (labels[status.state] || 'Unavailable'),
    title: status.state === 'ready' ? 'Ready to launch' : getGameStatusMessage(status, 'This game')
  };
}

async function refreshGameStatus(item, options = {}) {
  if (!item?.gameKey || typeof bridge?.getGameStatus !== 'function') return getGameStatus(item);
  if (gameStatusRequests.has(item.gameKey)) return gameStatusRequests.get(item.gameKey);
  const previous = gameStatusCache.get(item.gameKey);
  const request = bridge.getGameStatus(item.gameKey, { includeThumbnail: !item.thumbnailCache }).then(status => {
    const normalized = status || { gameKey: item.gameKey, state: 'unbound', title: item.title || 'Game', thumbnailCache: '' };
    gameStatusCache.set(item.gameKey, normalized);
    let changed = previous?.state !== normalized.state;
    let portableMetadataChanged = false;
    if (normalized.thumbnailCache && normalized.thumbnailCache !== item.thumbnailCache) {
      item.thumbnailCache = normalized.thumbnailCache;
      changed = true;
      portableMetadataChanged = true;
    }
    for (const field of ['systemId', 'systemName', 'emulatorName', 'profileName']) {
      const value = String(normalized[field] || '');
      if (value && value !== item[field]) {
        item[field] = value;
        changed = true;
        portableMetadataChanged = true;
      }
    }
    if (portableMetadataChanged) void saveState();
    if (options.render !== false && changed && typeof renderBoard === 'function') renderBoard();
    return normalized;
  }).catch(error => {
    const status = { gameKey: item.gameKey, state: 'unavailable', title: item.title || 'Game', thumbnailCache: item.thumbnailCache || '', error: error?.message || '' };
    gameStatusCache.set(item.gameKey, status);
    return status;
  }).finally(() => gameStatusRequests.delete(item.gameKey));
  gameStatusRequests.set(item.gameKey, request);
  return request;
}

async function launchGameShortcut(item) {
  if (!item?.gameKey) return false;
  try {
    await bridge.launchGame(item.gameKey);
    gameStatusCache.set(item.gameKey, { ...getGameStatus(item), state: 'ready' });
    return true;
  } catch (error) {
    const status = await refreshGameStatus(item, { render: false });
    renderBoard();
    showNotice(status.state === 'ready'
      ? (error?.message || `${item.title || 'The game'} could not be launched.`)
      : getGameStatusMessage(status, item.title || 'This game'));
    return false;
  }
}

async function openGameShortcutInEmuGui(item, options = {}) {
  if (!item?.gameKey) return false;
  try {
    await bridge.openGameInEmuGui(item.gameKey, { rebind: options.rebind === true });
    return true;
  } catch (error) {
    const status = await refreshGameStatus(item, { render: false });
    showNotice(status.state === 'ready'
      ? (error?.message || 'The game could not be opened in EmuGUI.')
      : getGameStatusMessage(status, item.title || 'This game'));
    return false;
  }
}

async function revealGameShortcut(item) {
  if (!item?.gameKey) return false;
  try {
    await bridge.revealGame(item.gameKey);
    return true;
  } catch (error) {
    const status = await refreshGameStatus(item, { render: false });
    showNotice(status.state === 'ready'
      ? (error?.message || 'The game file could not be revealed.')
      : getGameStatusMessage(status, item.title || 'This game'));
    return false;
  }
}

async function applyExternalGameBindingUpdate(source = {}) {
  const gameKey = String(source.gameKey || '').trim();
  if (!/^game_[a-zA-Z0-9_-]{12,75}$/.test(gameKey)) throw new Error('The updated game binding is invalid.');
  const entries = collectStoredGames().filter(entry => entry.item.gameKey === gameKey);
  if (!entries.length) throw new Error('The game shortcut is no longer in this Hub.');
  const thumbnail = String(source.thumbnailCache || '');
  if (thumbnail && (!/^data:image\/(?:png|jpe?g|gif|webp|avif);base64,/i.test(thumbnail) || thumbnail.length > 700000)) {
    throw new Error('The updated game thumbnail is invalid.');
  }
  for (const { item } of entries) {
    for (const [field, limit] of [['systemName', 80], ['emulatorName', 120], ['profileName', 120]]) {
      item[field] = String(source[field] || '').trim().slice(0, limit);
    }
    const systemId = String(source.systemId || '').trim().toLowerCase();
    item.systemId = /^[a-z0-9][a-z0-9_-]{0,47}$/.test(systemId) ? systemId : '';
    if (thumbnail) item.thumbnailCache = thumbnail;
  }
  const status = { ...source, gameKey, state: 'ready', thumbnailCache: thumbnail || entries[0].item.thumbnailCache || '' };
  gameStatusCache.set(gameKey, status);
  const saved = await saveState();
  renderAll();
  showNotice(`${entries[0].item.title || 'Game'} was rebound on this device.`);
  return { ok: saved?.ok !== false, persisted: saved?.persisted || '' };
}

async function forgetGameShortcut(item) {
  if (!item?.gameKey) return false;
  try {
    await bridge.forgetGame(item.gameKey);
    gameStatusCache.set(item.gameKey, { gameKey: item.gameKey, state: 'unbound', title: item.title || 'Game', thumbnailCache: item.thumbnailCache || '' });
    renderAll();
    showNotice(`${item.title || 'Game'} is no longer bound on this device.`);
    return true;
  } catch (error) {
    showNotice(error?.message || 'The game binding could not be removed.');
    return false;
  }
}

function duplicateGameShortcut(context = contextTarget) {
  const board = getBoardForContext(context);
  const found = board ? findBoardItemInColumns(board, context?.itemId) : null;
  if (!found?.item || found.item.type !== 'game') return false;
  pushUndoSnapshot();
  const copy = cloneData(found.item);
  copy.id = `game-item-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  copy.title = `${copy.title || 'Game'} (copy)`;
  found.list.splice(found.list.indexOf(found.item) + 1, 0, copy);
  renderAll();
  void saveState();
  return true;
}

function collectStoredGames(root = state) {
  const entries = [];
  const walk = (items, metadata, path = [], inheritedLocked = false) => {
    for (const item of (items || [])) {
      if (!item) continue;
      const locked = inheritedLocked || item.locked === true || metadata.locked === true;
      if (item.type === 'game') {
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
