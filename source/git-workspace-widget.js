// --- Git Workspace widget ---------------------------------------------------
// The shared state contains opaque approval handles, never filesystem paths.

const _gitWorkspaceRuntime = new Map();
const GIT_WORKSPACE_CACHE_KEY = 'status';

function _gitWorkspaceRepos(widget) {
  widget.config = widget.config || {};
  const seen = new Set();
  widget.config.repositories = (Array.isArray(widget.config.repositories) ? widget.config.repositories : []).slice(0, 12).map(entry => {
    const handle = String(entry?.handle || '').trim().slice(0, 80);
    if (!handle || seen.has(handle)) return null;
    seen.add(handle);
    return { handle, label: String(entry?.label || 'Repository').trim().slice(0, 160) || 'Repository' };
  }).filter(Boolean);
  widget.config.refreshSeconds = [30, 60, 300, 900].includes(Number(widget.config.refreshSeconds)) ? Number(widget.config.refreshSeconds) : 60;
  widget.config.showLastCommit = widget.config.showLastCommit !== false;
  return widget.config.repositories;
}

function _gitWorkspaceCached(widget) {
  const value = WidgetSDK.cache.get('gitWorkspace', widget.id, GIT_WORKSPACE_CACHE_KEY);
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function _gitWorkspaceAvailable() {
  try { return WidgetSDK.nativeHost.supports('gitWorkspace', 'gitWorkspace'); } catch { return false; }
}

async function _gitWorkspaceRefresh(widget, options = {}) {
  const repositories = _gitWorkspaceRepos(widget);
  const runtime = _gitWorkspaceRuntime.get(widget.id) || { loading: false, errors: {} };
  _gitWorkspaceRuntime.set(widget.id, runtime);
  if (runtime.loading) return;
  runtime.loading = true; runtime.errors = {};
  const cached = _gitWorkspaceCached(widget);
  await Promise.all(repositories.map(async repository => {
    try {
      const status = await WidgetSDK.nativeHost.invoke('gitWorkspace', 'getGitWorkspaceStatus', repository.handle);
      if (!status) throw new Error('No repository information was returned.');
      cached[repository.handle] = status;
    } catch (error) { runtime.errors[repository.handle] = error?.message || 'Unable to inspect repository.'; }
  }));
  try { WidgetSDK.cache.set('gitWorkspace', widget.id, GIT_WORKSPACE_CACHE_KEY, cached); } catch {}
  runtime.loading = false;
  if (!options.silent) { _refreshWidget(widget.id, 'column'); _refreshWidget(widget.id, 'navpane'); }
}

function _gitWorkspaceRemoteUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' ? url.href : ''; } catch { return ''; }
}

function _gitWorkspaceButton(label, title, handler) {
  const button = document.createElement('button'); button.type = 'button'; button.className = 'git-workspace-action'; button.textContent = label; button.title = title;
  button.addEventListener('click', async event => { event.stopPropagation(); button.disabled = true; try { await handler(); } catch (error) { if (typeof showNotice === 'function') showNotice(error?.message || 'Action failed.'); } finally { button.disabled = false; } });
  return button;
}

function _gitWorkspaceRender(widget, element, context) {
  const repositories = _gitWorkspaceRepos(widget);
  const cached = _gitWorkspaceCached(widget);
  const runtime = _gitWorkspaceRuntime.get(widget.id) || { loading: false, errors: {} };
  _gitWorkspaceRuntime.set(widget.id, runtime);
  element.className = `git-workspace-widget${context === 'navpane' ? ' is-compact' : ''}`;
  const rerender = () => { if (element.isConnected) { element.innerHTML = ''; _gitWorkspaceRender(widget, element, context); } };
  _setWidgetRefresher(widget.id, context, rerender);
  const header = document.createElement('div'); header.className = 'git-workspace-header';
  const summary = document.createElement('span'); summary.textContent = repositories.length ? `${repositories.length} repositor${repositories.length === 1 ? 'y' : 'ies'}` : 'No repositories';
  header.appendChild(summary); element.appendChild(header);
  if (!_gitWorkspaceAvailable()) { const unavailable = document.createElement('div'); unavailable.className = 'widget-empty-state is-error'; unavailable.textContent = 'Git Workspace requires the Firefox extension, native host, and Git. Reconnect them, then reload this widget.'; element.appendChild(unavailable); return; }
  if (!repositories.length) { const empty = document.createElement('div'); empty.className = 'widget-empty-state'; empty.textContent = 'Approve a repository folder in widget settings.'; element.appendChild(empty); return; }
  const list = document.createElement('div'); list.className = 'git-workspace-list';
  repositories.forEach(repository => {
    const status = cached[repository.handle]; const error = runtime.errors[repository.handle];
    const card = document.createElement('article'); card.className = `git-workspace-card${status?.clean ? ' is-clean' : status ? ' is-dirty' : ''}`;
    const top = document.createElement('div'); top.className = 'git-workspace-card-top';
    const identity = document.createElement('div'); identity.className = 'git-workspace-identity';
    const name = document.createElement('div'); name.className = 'git-workspace-name'; name.textContent = status?.label || repository.label;
    const branch = document.createElement('div'); branch.className = 'git-workspace-branch'; branch.textContent = error ? error : status ? `${status.detached ? 'Detached at' : 'Branch'} ${status.branch}` : 'Awaiting repository status';
    identity.append(name, branch);
    const badge = document.createElement('span'); badge.className = `git-workspace-badge ${status?.clean ? 'is-clean' : status ? 'is-dirty' : ''}`; badge.textContent = status ? (status.clean ? 'Clean' : 'Changes') : 'Unknown';
    top.append(identity, badge); card.appendChild(top);
    if (status) {
      const counts = document.createElement('div'); counts.className = 'git-workspace-counts';
      [['Staged', status.staged], ['Unstaged', status.unstaged], ['Ahead', status.ahead], ['Behind', status.behind]].forEach(([label, value]) => { const item = document.createElement('span'); item.textContent = `${label} ${value || 0}`; counts.appendChild(item); });
      card.appendChild(counts);
      if (widget.config.showLastCommit && status.lastCommit?.subject) { const commit = document.createElement('div'); commit.className = 'git-workspace-commit'; commit.textContent = `${status.lastCommit.shortHash || ''} · ${status.lastCommit.subject}`; commit.title = status.lastCommit.timestamp ? new Date(status.lastCommit.timestamp).toLocaleString() : ''; card.appendChild(commit); }
    }
    const actions = document.createElement('div'); actions.className = 'git-workspace-actions';
    actions.append(
      _gitWorkspaceButton('Folder', `Open ${repository.label} folder`, () => WidgetSDK.nativeHost.invoke('gitWorkspace', 'openApprovedDirectory', repository.handle, 'git', 'folder')),
      _gitWorkspaceButton('Terminal', `Open terminal in ${repository.label}`, () => WidgetSDK.nativeHost.invoke('gitWorkspace', 'openApprovedDirectory', repository.handle, 'git', 'terminal'))
    );
    const remoteUrl = _gitWorkspaceRemoteUrl(status?.remoteUrl);
    if (remoteUrl) actions.appendChild(_gitWorkspaceButton('Remote', 'Open repository remote', () => { window.open(remoteUrl, '_blank', 'noopener'); }));
    card.appendChild(actions); list.appendChild(card);
  });
  element.appendChild(list);
  if (!runtime.loading && repositories.some(repository => !cached[repository.handle])) void _gitWorkspaceRefresh(widget);
  _setWidgetTimer(widget.id, context, () => _gitWorkspaceRefresh(widget), widget.config.refreshSeconds * 1000);
}

function _gitWorkspaceRenderSettings(widget, container) {
  const repositories = _gitWorkspaceRepos(widget);
  container.innerHTML = `<div class="git-workspace-settings-list"></div><button type="button" class="secondary-btn git-workspace-add">Approve repository folder</button>
    <div class="settings-row"><span>Refresh interval</span><select class="settings-select" data-cfg="refreshSeconds">${[[30,'30 seconds'],[60,'1 minute'],[300,'5 minutes'],[900,'15 minutes']].map(([value,label]) => `<option value="${value}" ${widget.config.refreshSeconds === value ? 'selected' : ''}>${label}</option>`).join('')}</select></div>
    <div class="settings-row"><span>Show last commit</span><label class="settings-toggle"><input type="checkbox" data-cfg="showLastCommit" ${widget.config.showLastCommit ? 'checked' : ''}/><span class="toggle-track"></span></label></div>
    <div class="settings-help">Folder paths are kept by the native host behind opaque approval handles. Git operations are fixed read-only commands; no shell text can be supplied.</div><div class="git-workspace-settings-status settings-muted"></div>`;
  const list = container.querySelector('.git-workspace-settings-list'); const status = container.querySelector('.git-workspace-settings-status');
  const renderRows = () => {
    list.innerHTML = '';
    repositories.forEach((repository, index) => {
      const row = document.createElement('div'); row.className = 'git-workspace-settings-row';
      const input = document.createElement('input'); input.className = 'settings-text-input'; input.value = repository.label; input.maxLength = 160; input.addEventListener('input', () => { repository.label = input.value; });
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'icon-btn is-danger'; remove.textContent = '×'; remove.title = 'Remove repository'; remove.addEventListener('click', () => { repositories.splice(index, 1); renderRows(); });
      row.append(input, remove); list.appendChild(row);
    });
    if (!repositories.length) { const empty = document.createElement('div'); empty.className = 'settings-muted'; empty.textContent = 'No repository folders approved.'; list.appendChild(empty); }
    container.querySelector('.git-workspace-add').disabled = repositories.length >= 12;
  };
  container.querySelector('.git-workspace-add').addEventListener('click', async () => {
    status.textContent = 'Waiting for folder selection…';
    try {
      const directory = await WidgetSDK.nativeHost.invoke('gitWorkspace', 'approveDirectory', 'git', 'Approve a Git repository folder');
      if (directory?.handle && !repositories.some(repository => repository.handle === directory.handle)) repositories.push({ handle: directory.handle, label: directory.label || 'Repository' });
      status.textContent = directory ? 'Repository approved.' : 'Folder selection cancelled.'; renderRows();
    } catch (error) { status.textContent = error?.message || 'Repository approval failed.'; status.classList.add('is-error'); }
  });
  renderRows();
}

WIDGET_REGISTRY['gitWorkspace'] = {
  id: 'gitWorkspace', name: 'Git Workspace', category: 'Personal & Productivity', description: 'Track approved repositories, branches, changes, sync state, and recent commits through fixed native capabilities.',
  allowedIn: ['column', 'navpane'], liveSettingsPreview: false, reloadLabel: 'Refresh repositories',
  defaultConfig: { repositories: [], refreshSeconds: 60, showLastCommit: true }, defaultData: {},
  settingsSchema: { type: 'object', properties: { repositories: { type: 'array' }, refreshSeconds: { type: 'number' }, showLastCommit: { type: 'boolean' } }, additionalProperties: false },
  capabilities: { nativeHost: { optional: true }, filesystemPaths: { optional: true }, timers: true, localCache: { quotaBytes: 256 * 1024 } }, responsive: { minWidth: 260, preferredWidth: 560, compactBelow: 340 },
  migrate(widget) { widget.config = { ...this.defaultConfig, ...(widget.config || {}) }; widget.data = {}; _gitWorkspaceRepos(widget); return widget; }, reload(widget) { return _gitWorkspaceRefresh(widget); },
  onSettingsCommit(widget) { _gitWorkspaceRuntime.delete(widget.id); }, cleanup(widget) { _gitWorkspaceRuntime.delete(widget.id); }, render(widget, element, context) { _gitWorkspaceRender(widget, element, context); }, renderSettings(widget, container) { _gitWorkspaceRenderSettings(widget, container); }
};
