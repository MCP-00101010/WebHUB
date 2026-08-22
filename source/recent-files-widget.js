// --- Recent Downloads and Files widget -------------------------------------
// Approved roots are represented by opaque handles in shared state.

const _recentFilesRuntime = new Map();
const RECENT_FILES_CACHE_KEY = 'results';

function _recentFilesRoots(widget) {
  widget.config = widget.config || {};
  const seen = new Set();
  widget.config.roots = (Array.isArray(widget.config.roots) ? widget.config.roots : []).slice(0, 12).map(entry => {
    const handle = String(entry?.handle || '').trim().slice(0, 80);
    if (!handle || seen.has(handle)) return null;
    seen.add(handle); return { handle, label: String(entry?.label || 'Folder').trim().slice(0, 160) || 'Folder' };
  }).filter(Boolean);
  widget.config.extensions = [...new Set(String(widget.config.extensions || '').toLowerCase().split(/[\s,;]+/).map(value => value.replace(/^\./, '')).filter(value => /^[a-z0-9]{1,16}$/.test(value)))].slice(0, 20).join(', ');
  widget.config.maxAgeHours = [24, 72, 168, 720, 8760].includes(Number(widget.config.maxAgeHours)) ? Number(widget.config.maxAgeHours) : 168;
  widget.config.resultCount = [10, 20, 30, 50, 100].includes(Number(widget.config.resultCount)) ? Number(widget.config.resultCount) : 30;
  widget.config.recursive = widget.config.recursive === true;
  return widget.config.roots;
}

function _recentFilesExtensions(widget) { return _recentFilesRoots(widget) && widget.config.extensions ? widget.config.extensions.split(/,\s*/).filter(Boolean) : []; }
function _recentFilesAvailable() { try { return WidgetSDK.nativeHost.supports('recentFiles', 'recentFiles'); } catch { return false; } }

function _recentFilesCached(widget) {
  const value = WidgetSDK.cache.get('recentFiles', widget.id, RECENT_FILES_CACHE_KEY);
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

async function _recentFilesRefresh(widget) {
  const roots = _recentFilesRoots(widget); const runtime = _recentFilesRuntime.get(widget.id) || { loading: false, errors: {} };
  _recentFilesRuntime.set(widget.id, runtime); if (runtime.loading) return;
  runtime.loading = true; runtime.errors = {}; const cached = _recentFilesCached(widget);
  await Promise.all(roots.map(async root => {
    try {
      const result = await WidgetSDK.nativeHost.invoke('recentFiles', 'listRecentFiles', {
        handle: root.handle, extensions: _recentFilesExtensions(widget), maxAgeHours: widget.config.maxAgeHours,
        limit: widget.config.resultCount, recursive: widget.config.recursive
      });
      if (!result) throw new Error('No file results were returned.');
      cached[root.handle] = result;
    } catch (error) { runtime.errors[root.handle] = error?.message || 'Unable to enumerate this folder.'; }
  }));
  try { WidgetSDK.cache.set('recentFiles', widget.id, RECENT_FILES_CACHE_KEY, cached, { ttlMs: 7 * 86400000 }); } catch {}
  runtime.loading = false; _refreshWidget(widget.id, 'column'); _refreshWidget(widget.id, 'navpane');
}

function _recentFilesSize(value) {
  const bytes = Math.max(0, Number(value) || 0); if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KiB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MiB`;
  return `${(bytes / 1073741824).toFixed(1)} GiB`;
}

function _recentFilesIcon(extension) {
  const groups = { image: ['jpg','jpeg','png','gif','webp','svg','avif'], archive: ['zip','7z','rar','tar','gz'], document: ['pdf','doc','docx','odt','txt','md'], media: ['mp3','flac','wav','mp4','mkv','webm'], code: ['js','ts','py','html','css','json','xml','c','cpp','rs'] };
  const match = Object.entries(groups).find(([, values]) => values.includes(String(extension || '').toLowerCase()));
  return { image: '▧', archive: '▣', document: '▤', media: '▶', code: '</>' }[match?.[0]] || '□';
}

function _recentFilesAction(widget, handle, file, action) {
  return async () => {
    try { await WidgetSDK.nativeHost.invoke('recentFiles', 'openApprovedFile', handle, file.relativePath, action); }
    catch (error) { if (typeof showNotice === 'function') showNotice(error?.message || 'The file may have been renamed or deleted.'); }
  };
}

function _recentFilesRender(widget, element, context) {
  const roots = _recentFilesRoots(widget); const cached = _recentFilesCached(widget); const runtime = _recentFilesRuntime.get(widget.id) || { loading: false, errors: {} }; _recentFilesRuntime.set(widget.id, runtime);
  element.className = `recent-files-widget${context === 'navpane' ? ' is-compact' : ''}`;
  const rerender = () => { if (element.isConnected) { element.innerHTML = ''; _recentFilesRender(widget, element, context); } }; _setWidgetRefresher(widget.id, context, rerender);
  const header = document.createElement('div'); header.className = 'recent-files-header';
  const summary = document.createElement('span'); summary.textContent = roots.length ? `${roots.length} approved folder${roots.length === 1 ? '' : 's'}` : 'No folders';
  header.appendChild(summary); element.appendChild(header);
  if (!_recentFilesAvailable()) { const unavailable = document.createElement('div'); unavailable.className = 'widget-empty-state is-error'; unavailable.textContent = 'Recent Files requires the Firefox extension and native host. Reconnect them, then reload this widget.'; element.appendChild(unavailable); return; }
  if (!roots.length) { const empty = document.createElement('div'); empty.className = 'widget-empty-state'; empty.textContent = 'Approve a downloads or working folder in widget settings.'; element.appendChild(empty); return; }
  const merged = [];
  roots.forEach(root => {
    const result = cached[root.handle];
    (result?.files || []).forEach(file => merged.push({ root, file }));
    if (runtime.errors[root.handle]) { const error = document.createElement('div'); error.className = 'widget-error-state'; error.textContent = `${root.label}: ${runtime.errors[root.handle]}`; element.appendChild(error); }
  });
  merged.sort((a, b) => b.file.modifiedAt - a.file.modifiedAt);
  const list = document.createElement('div'); list.className = 'recent-files-list';
  merged.slice(0, widget.config.resultCount).forEach(({ root, file }) => {
    const row = document.createElement('div'); row.className = 'recent-files-row';
    const icon = document.createElement('span'); icon.className = 'recent-files-icon'; icon.textContent = _recentFilesIcon(file.extension);
    const identity = document.createElement('div'); identity.className = 'recent-files-identity';
    const name = document.createElement('div'); name.className = 'recent-files-name'; name.textContent = file.name; name.title = file.relativePath;
    const meta = document.createElement('div'); meta.className = 'recent-files-meta'; meta.textContent = `${root.label} · ${_recentFilesSize(file.sizeBytes)} · ${new Date(file.modifiedAt).toLocaleString()}`;
    identity.append(name, meta);
    const actions = document.createElement('div'); actions.className = 'recent-files-actions';
    const open = document.createElement('button'); open.type = 'button'; open.textContent = 'Open'; open.addEventListener('click', _recentFilesAction(widget, root.handle, file, 'open'));
    const reveal = document.createElement('button'); reveal.type = 'button'; reveal.textContent = 'Reveal'; reveal.addEventListener('click', _recentFilesAction(widget, root.handle, file, 'reveal'));
    actions.append(open, reveal); row.append(icon, identity, actions); list.appendChild(row);
  });
  if (!merged.length && !runtime.loading && !Object.keys(runtime.errors).length) { const empty = document.createElement('div'); empty.className = 'widget-empty-state'; empty.textContent = 'No files match the current type and age filters.'; list.appendChild(empty); }
  element.appendChild(list);
  if (!runtime.loading && roots.some(root => !cached[root.handle])) void _recentFilesRefresh(widget);
  _setWidgetTimer(widget.id, context, () => _recentFilesRefresh(widget), 5 * 60 * 1000);
}

function _recentFilesRenderSettings(widget, container) {
  const roots = _recentFilesRoots(widget);
  container.innerHTML = `<div class="recent-files-settings-list"></div><button type="button" class="secondary-btn recent-files-add">Approve folder</button>
    <div class="settings-row"><span>File extensions</span><input class="settings-text-input" data-cfg="extensions" value="${String(widget.config.extensions).replace(/"/g, '&quot;')}" placeholder="Blank for all, or pdf, zip, jpg"/></div>
    <div class="settings-row"><span>Maximum age</span><select class="settings-select" data-cfg="maxAgeHours">${[[24,'24 hours'],[72,'3 days'],[168,'7 days'],[720,'30 days'],[8760,'1 year']].map(([value,label]) => `<option value="${value}" ${widget.config.maxAgeHours === value ? 'selected' : ''}>${label}</option>`).join('')}</select></div>
    <div class="settings-row"><span>Maximum results</span><select class="settings-select" data-cfg="resultCount">${[10,20,30,50,100].map(value => `<option value="${value}" ${widget.config.resultCount === value ? 'selected' : ''}>${value}</option>`).join('')}</select></div>
    <div class="settings-row"><span>Include subfolders (3 levels)</span><label class="settings-toggle"><input type="checkbox" data-cfg="recursive" ${widget.config.recursive ? 'checked' : ''}/><span class="toggle-track"></span></label></div>
    <div class="settings-help">Only approved roots are scanned. Enumeration is limited to 5,000 entries, three levels, three seconds, and 100 returned files. Results stay local and actions are fixed Open/Reveal operations.</div><div class="recent-files-settings-status settings-muted"></div>`;
  const list = container.querySelector('.recent-files-settings-list'); const status = container.querySelector('.recent-files-settings-status');
  const renderRows = () => {
    list.innerHTML = '';
    roots.forEach((root, index) => { const row = document.createElement('div'); row.className = 'recent-files-settings-row'; const label = document.createElement('input'); label.className = 'settings-text-input'; label.value = root.label; label.addEventListener('input', () => { root.label = label.value; }); const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'icon-btn is-danger'; remove.textContent = '×'; remove.addEventListener('click', () => { roots.splice(index, 1); renderRows(); }); row.append(label, remove); list.appendChild(row); });
    if (!roots.length) { const empty = document.createElement('div'); empty.className = 'settings-muted'; empty.textContent = 'No folders approved.'; list.appendChild(empty); }
    container.querySelector('.recent-files-add').disabled = roots.length >= 12;
  };
  container.querySelector('.recent-files-add').addEventListener('click', async () => {
    status.textContent = 'Waiting for folder selection…';
    try { const directory = await WidgetSDK.nativeHost.invoke('recentFiles', 'approveDirectory', 'recent-files', 'Approve a downloads or working folder'); if (directory?.handle && !roots.some(root => root.handle === directory.handle)) roots.push({ handle: directory.handle, label: directory.label || 'Folder' }); status.textContent = directory ? 'Folder approved.' : 'Selection cancelled.'; renderRows(); }
    catch (error) { status.textContent = error?.message || 'Folder approval failed.'; status.classList.add('is-error'); }
  });
  renderRows();
}

WIDGET_REGISTRY['recentFiles'] = {
  id: 'recentFiles', name: 'Recent Downloads & Files', category: 'System & Network', description: 'Browse bounded recent-file metadata from explicitly approved folders with safe Open and Reveal actions.',
  allowedIn: ['column', 'navpane'], liveSettingsPreview: false, reloadLabel: 'Refresh recent files',
  defaultConfig: { roots: [], extensions: '', maxAgeHours: 168, resultCount: 30, recursive: false }, defaultData: {},
  settingsSchema: { type: 'object', properties: { roots: { type: 'array' }, extensions: { type: 'string' }, maxAgeHours: { type: 'number' }, resultCount: { type: 'number' }, recursive: { type: 'boolean' } }, additionalProperties: false },
  capabilities: { nativeHost: { optional: true }, filesystemPaths: { optional: true }, timers: true, localCache: { quotaBytes: 512 * 1024 } }, responsive: { minWidth: 240, preferredWidth: 560, compactBelow: 340 },
  migrate(widget) { widget.config = { ...this.defaultConfig, ...(widget.config || {}) }; widget.data = {}; _recentFilesRoots(widget); return widget; }, reload(widget) { return _recentFilesRefresh(widget); }, onSettingsCommit(widget) { _recentFilesRuntime.delete(widget.id); }, cleanup(widget) { _recentFilesRuntime.delete(widget.id); }, render(widget, element, context) { _recentFilesRender(widget, element, context); }, renderSettings(widget, container) { _recentFilesRenderSettings(widget, container); }
};
