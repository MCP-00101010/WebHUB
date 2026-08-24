const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

let approvedTargetUri = '';
let approvedIconHint = '';
let noticeMessage = '';

const state = {
  boards: [{
    id: 'board-1', title: 'Home',
    tabs: [{
      id: 'tab-1', title: 'Main',
      columns: [{ id: 'column-1', title: 'Apps', items: [
        { id: 'app-1', type: 'application', title: 'Editor', appKey: 'app_abcdefghijklmnop', applicationKind: 'executable', tags: ['work'], iconCache: '' },
        { id: 'folder-1', type: 'folder', title: 'Games', children: [
          { id: 'app-2', type: 'application', title: 'Game', appKey: 'app_qrstuvwxyz123456', applicationKind: 'shortcut', tags: [], iconCache: '' }
        ] }
      ] }],
      inbox: { id: 'inbox-1', items: [] }
    }]
  }]
};

const context = vm.createContext({
  console, state, Date, Math, Map, Promise, structuredClone, TextDecoder, Uint8Array,
  bridge: {
    supports: capability => capability === 'applicationLauncher',
    nativeIsAvailable: () => true,
    getApplicationStatus: async appKey => ({ appKey, label: 'Editor', kind: 'executable', state: 'ready', iconDataUrl: '' }),
    approveApplicationLink: async (_appKey, title, targetUri, iconHint) => {
      approvedTargetUri = targetUri;
      approvedIconHint = iconHint;
      return { appKey: 'app_baldursgate3test', label: title, kind: 'protocol-link', state: 'ready', iconDataUrl: '' };
    }
  },
  getBoardTabs: board => board.tabs,
  getBoardInbox: (_board, tab) => tab.inbox,
  getBoardForContext: () => state.boards[0],
  getActiveBoard: () => state.boards[0],
  getBoardItemContainers: board => board.tabs[0].columns,
  getBoardTab: board => board.tabs[0],
  isDynamicFolder: folder => folder.folderMode === 'dynamic',
  saveState: () => Promise.resolve(),
  renderBoard: () => {},
  renderAll: () => {},
  pushUndoSnapshot: () => {},
  showNotice: message => { noticeMessage = message; },
  setTimeout,
  clearTimeout
});

const filename = path.join(__dirname, '..', 'source', 'application-launcher.js');
vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });

const created = vm.runInContext("createApplicationItem({ appKey: 'app_abcdefghijklmnop', label: 'Useful App', kind: 'executable', iconDataUrl: 'data:image/png;base64,aQ==' })", context);
assert.equal(created.type, 'application');
assert.equal(created.title, 'Useful App');
assert.equal(created.appKey, 'app_abcdefghijklmnop');
assert.equal('path' in created, false, 'page application records must not contain executable paths');

const entries = vm.runInContext('collectStoredApplications(state)', context);
assert.equal(entries.length, 2);
assert.equal(entries[1].location, 'Home / Main / Apps / Games');

const status = vm.runInContext('refreshApplicationStatus(state.boards[0].tabs[0].columns[0].items[0], { render: false })', context);
const shortcutBytes = Uint8Array.from(Buffer.from('[InternetShortcut]\r\nURL=steam://rungameid/1086940\r\nIconFile=C:\\Program Files (x86)\\Steam\\steam\\games\\bg3.ico\r\nIconIndex=0\r\n', 'utf8'));
context.drop = {
  application: true,
  title: "Baldur's Gate 3.url",
  file: { size: shortcutBytes.byteLength, arrayBuffer: async () => shortcutBytes.buffer }
};
context.dropContext = { area: 'board-empty', columnId: 'column-1' };
const dropped = vm.runInContext('addDroppedApplicationShortcut(drop, dropContext)', context);

Promise.all([status, dropped]).then(([result, droppedItem]) => {
  assert.equal(result.state, 'ready');
  assert.equal(approvedTargetUri, 'steam://rungameid/1086940');
  assert.equal(approvedIconHint, 'C:\\Program Files (x86)\\Steam\\steam\\games\\bg3.ico');
  assert.equal(droppedItem.title, "Baldur's Gate 3");
  assert.equal(droppedItem.applicationKind, 'protocol-link');
  assert.equal(state.boards[0].tabs[0].columns[0].items.at(-1), droppedItem);
  assert.equal(noticeMessage, "Added Baldur's Gate 3.");
  console.log('Application launcher tests passed');
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
