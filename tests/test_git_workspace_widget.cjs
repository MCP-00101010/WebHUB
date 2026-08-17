const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'source', 'git-workspace-widget.js'), 'utf8');
function context() {
  const sandbox = vm.createContext({ WIDGET_REGISTRY: {}, URL, console, WidgetSDK: { cache: { get: () => null, set() {} }, nativeHost: { supports: () => false } }, document: {} });
  vm.runInContext(source, sandbox); return sandbox;
}

test('Git Workspace stores only unique opaque handles and labels', () => {
  const sandbox = context();
  const result = vm.runInContext(`(() => { const widget = { config: { repositories: [
    { handle: 'dir_abcdefghijklmnop', label: 'One', path: 'C:/secret' },
    { handle: 'dir_abcdefghijklmnop', label: 'Duplicate' }, { handle: '', label: 'Empty' }
  ], refreshSeconds: 1 } }; _gitWorkspaceRepos(widget); return widget.config; })()`, sandbox);
  assert.equal(result.repositories.length, 1);
  assert.equal(result.repositories[0].handle, 'dir_abcdefghijklmnop');
  assert.equal(Object.hasOwn(result.repositories[0], 'path'), false);
  assert.equal(result.refreshSeconds, 60);
});

test('Git Workspace accepts HTTPS remotes only and has no shell/fetch/storage escape hatch', () => {
  const sandbox = context();
  assert.match(vm.runInContext(`_gitWorkspaceRemoteUrl('https://github.com/example/project')`, sandbox), /^https:/);
  assert.equal(vm.runInContext(`_gitWorkspaceRemoteUrl('javascript:alert(1)')`, sandbox), '');
  assert.doesNotMatch(source, /\blocalStorage\b|\bfetch\s*\(|child_process|exec\s*\(/);
  assert.match(source, /WidgetSDK\.nativeHost\.invoke/);
});
