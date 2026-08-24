const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

test('game shortcuts launch through opaque bindings and retain no native paths', async () => {
  let launched = '';
  let forgotten = '';
  let opened = null;
  let revealed = '';
  const notices = [];
  const item = {
    id: 'game-item-1', type: 'game', title: 'Jetpac', gameKey: 'game_abcdefghijklmnop',
    tags: ['Games', 'ZX Spectrum'], thumbnailCache: 'data:image/png;base64,aQ=='
  };
  const context = vm.createContext({
    console, Map, Promise, Date, Math,
    bridge: {
      supports: capability => capability === 'emuguiService',
      getGameStatus: async gameKey => ({ gameKey, state: 'ready', title: 'Jetpac', thumbnailCache: '' }),
      launchGame: async gameKey => { launched = gameKey; return true; },
      openGameInEmuGui: async (gameKey, options) => { opened = { gameKey, options }; return true; },
      revealGame: async gameKey => { revealed = gameKey; return true; },
      forgetGame: async gameKey => { forgotten = gameKey; return true; }
    },
    saveState: async () => ({ ok: true }),
    renderBoard: () => {},
    renderAll: () => {},
    showNotice: message => notices.push(message),
    setTimeout,
    clearTimeout
  });
  const filename = path.join(__dirname, '..', 'source', 'game-launcher.js');
  vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });

  const status = await context.refreshGameStatus(item, { render: false });
  assert.equal(status.state, 'ready');
  assert.equal(await context.launchGameShortcut(item), true);
  assert.equal(launched, item.gameKey);
  assert.equal(await context.openGameShortcutInEmuGui(item, { rebind: true }), true);
  assert.deepEqual(JSON.parse(JSON.stringify(opened)), { gameKey: item.gameKey, options: { rebind: true } });
  assert.equal(await context.revealGameShortcut(item), true);
  assert.equal(revealed, item.gameKey);
  assert.equal(await context.forgetGameShortcut(item), true);
  assert.equal(forgotten, item.gameKey);
  assert.equal(context.getGameStatus(item).state, 'unbound');
  assert.equal(/path|command|argument/i.test(JSON.stringify(item)), false);
  assert.match(notices.at(-1), /no longer bound/i);
});

test('game system descriptors cover current and planned emulator families', () => {
  const context = vm.createContext({ console, Map, Promise, Date, Math });
  const filename = path.join(__dirname, '..', 'source', 'game-launcher.js');
  vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  const cases = [
    [{ tags: ['Games', 'ZX Spectrum'] }, ['zx-spectrum', 'icon-system-zx-spectrum']],
    [{ systemId: 'atari-st', systemName: 'Atari ST' }, ['atari-st', 'icon-system-atari-st']],
    [{ systemName: 'Game Boy Color' }, ['game-boy', 'icon-system-game-boy']],
    [{ systemName: 'Super Nintendo' }, ['snes', 'icon-system-snes']],
    [{ systemId: 'scummvm', systemName: 'ScummVM' }, ['scummvm', 'icon-system-scummvm']],
    [{ systemId: 'dosbox', systemName: 'DOSBox' }, ['dosbox', 'icon-system-dosbox']],
    [{ tags: ['Games', 'Arcade'] }, ['mame', 'icon-system-mame']]
  ];
  for (const [item, expected] of cases) {
    const descriptor = context.getGameSystemDescriptor(item);
    assert.deepEqual([descriptor.id, descriptor.iconId], expected);
  }
});

test('game status refresh backfills portable system identity', async () => {
  let saves = 0;
  let statusOptions = null;
  const item = { type: 'game', title: 'Jetpac', gameKey: 'game_abcdefghijklmnop', tags: ['Games'] };
  const context = vm.createContext({
    console, Map, Promise, Date, Math,
    bridge: {
      supports: () => true,
      getGameStatus: async (gameKey, options) => {
        statusOptions = options;
        return { gameKey, state: 'ready', title: 'Jetpac', systemId: 'zx-spectrum', systemName: 'ZX Spectrum', emulatorName: 'EightyOne', profileName: 'Spectrum 48K', thumbnailCache: 'data:image/jpeg;base64,aW1hZ2U=' };
      }
    },
    saveState: async () => { saves += 1; return { ok: true }; },
    renderBoard: () => {}
  });
  const filename = path.join(__dirname, '..', 'source', 'game-launcher.js');
  vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  await context.refreshGameStatus(item, { render: false });
  assert.equal(item.systemId, 'zx-spectrum');
  assert.equal(item.systemName, 'ZX Spectrum');
  assert.equal(item.thumbnailCache, 'data:image/jpeg;base64,aW1hZ2U=');
  assert.equal(item.emulatorName, 'EightyOne');
  assert.equal(item.profileName, 'Spectrum 48K');
  assert.equal(statusOptions.includeThumbnail, true);
  assert.equal(saves, 1);
});

test('an EmuGUI rebind refreshes every matching Hub card without changing its opaque key', async () => {
  const first = { id: 'game-1', type: 'game', title: 'Jetpac', gameKey: 'game_abcdefghijklmnop' };
  const second = { id: 'game-2', type: 'game', title: 'Jetpac copy', gameKey: 'game_abcdefghijklmnop' };
  const state = { boards: [{ id: 'board-1', tabs: [{ id: 'tab-1', columns: [{ id: 'column-1', items: [first, second] }], inbox: { id: 'inbox-1', items: [] } }] }] };
  let saves = 0;
  const notices = [];
  const context = vm.createContext({
    console, Map, WeakMap, Promise, Date, Math, state,
    bridge: { supports: () => true },
    getBoardTabs: board => board.tabs || [],
    getBoardInbox: (_board, tab) => tab.inbox,
    isDynamicFolder: () => false,
    saveState: async () => { saves += 1; return { ok: true, persisted: 'shared' }; },
    renderAll: () => {},
    showNotice: message => notices.push(message)
  });
  const filename = path.join(__dirname, '..', 'source', 'game-launcher.js');
  vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });

  const result = await context.applyExternalGameBindingUpdate({
    gameKey: 'game_abcdefghijklmnop', state: 'ready', systemId: 'zx-spectrum', systemName: 'ZX Spectrum',
    emulatorName: 'EightyOne', profileName: 'Spectrum 128K', thumbnailCache: 'data:image/png;base64,aQ=='
  });

  assert.equal(result.ok, true);
  assert.equal(saves, 1);
  assert.equal(first.profileName, 'Spectrum 128K');
  assert.equal(second.profileName, 'Spectrum 128K');
  assert.equal(first.gameKey, 'game_abcdefghijklmnop');
  assert.match(notices.at(-1), /rebound/i);
});

test('game state migration strips native launch material', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'source', 'state.js'), 'utf8');
  assert.match(source, /if \(item\.type === 'game'\)/);
  assert.match(source, /delete item\.romPath/);
  assert.match(source, /delete item\.emulatorPath/);
  const contextSource = fs.readFileSync(path.join(__dirname, '..', 'source', 'context.js'), 'utf8');
  const modalSource = fs.readFileSync(path.join(__dirname, '..', 'source', 'modal.js'), 'utf8');
  assert.match(contextSource, /Edit game shortcut/);
  assert.match(modalSource, /case 'editGame'/);
  assert.match(source, /item\.systemId =/);
});

test('game cards use system icons while rich tooltips retain artwork and launch details', () => {
  const boardRenderer = fs.readFileSync(path.join(__dirname, '..', 'source', 'render-items.js'), 'utf8');
  const searchRenderer = fs.readFileSync(path.join(__dirname, '..', 'source', 'render.js'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'source', 'styles.css'), 'utf8');
  const document = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(boardRenderer, /renderGameSystemIcon\(favicon, item\)/);
  assert.match(searchRenderer, /renderGameSystemIcon\(iconEl, item\)/);
  assert.match(styles, /\.bookmark-favicon\.game-system-icon/);
  assert.match(styles, /\.game-tooltip-thumbnail/);
  assert.match(styles, /\.game-tooltip-detail/);
  for (const id of ['zx-spectrum', 'atari-st', 'game-boy', 'snes', 'scummvm', 'dosbox', 'mame', 'generic']) {
    assert.match(document, new RegExp(`id="icon-system-${id}"`));
  }
});

test('game tooltip details expose safe display labels rather than binding IDs', () => {
  const context = vm.createContext({ console, Map, WeakMap, Promise, Date, Math });
  const filename = path.join(__dirname, '..', 'source', 'game-launcher.js');
  vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  const details = context.getGameTooltipDetails({
    title: 'Jetpac', systemId: 'zx-spectrum', emulatorName: 'EightyOne', profileName: 'Spectrum 48K',
    thumbnailCache: 'data:image/png;base64,aQ==', emulatorId: 'hidden-emulator-id', profileId: 'hidden-profile-id'
  });
  assert.deepEqual(JSON.parse(JSON.stringify(details)), {
    title: 'Jetpac', system: 'ZX Spectrum', emulator: 'EightyOne', profile: 'Spectrum 48K', thumbnail: 'data:image/png;base64,aQ=='
  });
  assert.doesNotMatch(JSON.stringify(details), /hidden-/);
});

test('stored games are indexed across columns, folders, and Inboxes for the command palette', () => {
  const launched = [];
  const state = {
    boards: [{ id: 'board-1', title: 'Home', tabs: [{
      id: 'tab-1', title: 'Main',
      columns: [{ id: 'column-1', title: 'Games', items: [{
        id: 'folder-1', type: 'folder', title: 'Spectrum', children: [{
          id: 'game-1', type: 'game', title: 'Jetpac', gameKey: 'game_abcdefghijklmnop', tags: ['ZX Spectrum']
        }]
      }] }],
      inbox: { id: 'inbox-1', items: [{ id: 'game-2', type: 'game', title: 'Knight Lore', gameKey: 'game_qrstuvwxyz123456' }] }
    }] }],
    sets: [], tags: []
  };
  const context = vm.createContext({
    console, Map, Promise, Date, Math, state,
    bridge: { supports: () => true },
    getBoardTabs: board => board.tabs || [],
    getBoardInbox: (_board, tab) => tab.inbox,
    isDynamicFolder: () => false,
    getGameStatus: () => ({ state: 'ready' }),
    launchGameShortcut: item => launched.push(item.title),
    resolveTag: id => ({ name: id }),
    localStorage: { getItem: () => null, setItem: () => {} },
    SMART_VIEW_DEFINITIONS: [], WIDGET_REGISTRY: {},
    collectStoredBookmarks: () => [], resolveSetItems: () => []
  });
  const launcher = path.join(__dirname, '..', 'source', 'game-launcher.js');
  vm.runInContext(fs.readFileSync(launcher, 'utf8'), context, { filename: launcher });
  const stored = Array.from(context.collectStoredGames());
  assert.deepEqual(stored.map(entry => entry.item.title), ['Jetpac', 'Knight Lore']);
  assert.match(stored[0].location, /Home \/ Main \/ Games \/ Spectrum/);
  context.launchGameShortcut = item => launched.push(item.title);

  const palette = path.join(__dirname, '..', 'source', 'command-palette.js');
  vm.runInContext(fs.readFileSync(palette, 'utf8'), context, { filename: palette });
  const entries = Array.from(context.buildCommandPaletteEntries()).filter(entry => entry.group === 'Games');
  assert.deepEqual(entries.map(entry => entry.label), ['Jetpac', 'Knight Lore']);
  entries[0].run();
  assert.deepEqual(launched, ['Jetpac']);
});
