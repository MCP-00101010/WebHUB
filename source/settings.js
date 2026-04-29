// --- Board settings panel ---

let boardSettingsCreatingId = null;
let _boardSettingsCancelSnapshot = null;
let _pendingDatabasePath = '';

function showBoardSettingsPanel(isNew = false) {
  const board = getActiveBoard();
  const tab = getActiveTab();
  if (!board || !tab) return;
  if (!isNew) {
    pushUndoSnapshot();
    _boardSettingsCancelSnapshot = { board: cloneData(board), activeTabId: state.activeTabId };
  } else {
    _boardSettingsCancelSnapshot = null;
  }
  boardSettingsCreatingId = isNew ? tab.id : null;
  document.getElementById('modalCard').classList.add('hidden');
  const panel = document.getElementById('boardSettingsPanel');
  document.getElementById('boardSettingsDoneBtn').textContent = isNew ? 'Create' : 'OK';
  document.getElementById('bstgSubtitle').textContent = isNew ? 'New Tab' : 'Edit Tab';
  panel.classList.remove('hidden');
  elements.modalOverlay.classList.remove('hidden');
  centerPanel(panel);
  makeDraggable(panel, document.getElementById('bstgHeader'));
  const titleEl = document.getElementById('bstgTitle');
  titleEl.placeholder = tab.title || 'New Tab';
  titleEl.value = isNew ? '' : tab.title;
  titleEl.focus();
  const colRadio = document.querySelector(`input[name="bstgCols"][value="${tab.columnCount}"]`);
  if (colRadio) colRadio.checked = true;
  document.getElementById('bstgBgUrl').value = tab.backgroundImage || '';
  const bgFitRadio = document.querySelector(`input[name="bstgBgFit"][value="${tab.backgroundFit || 'cover'}"]`);
  if (bgFitRadio) bgFitRadio.checked = true;
  updateBgDropZonePreview(tab.backgroundImage || '');
  document.getElementById('bstgOpacity').value = tab.containerOpacity ?? 100;
  document.getElementById('bstgOpacityVal').textContent = tab.containerOpacity ?? 100;
  document.getElementById('bstgShowSpeedDial').checked = board.showSpeedDial !== false;
  document.getElementById('bstgSpeedDialSlots').value = getSpeedDialSlotCount(board);
  document.getElementById('bstgSpeedDialSection')?.classList.add('hidden');
  document.getElementById('bstgTags').value = (tab.tags || []).join(' ');
  document.getElementById('bstgSharedTags').value = (tab.sharedTags || []).join(' ');
  document.getElementById('bstgInheritTags').checked = tab.inheritTags !== false;
  document.getElementById('bstgAutoRemove').checked = isNew ? true : tab.autoRemoveTags === true;
  const bstgInherited = getBoardInheritedTags();
  const bstgInheritedRow = document.getElementById('bstgInheritedTagsRow');
  const bstgInheritedSpan = document.getElementById('bstgInheritedTags');
  if (bstgInheritedRow && bstgInheritedSpan) {
    bstgInheritedSpan.innerHTML = '';
    renderTagsInto(bstgInheritedSpan, bstgInherited);
    bstgInheritedRow.classList.toggle('hidden', bstgInherited.length === 0);
  }
}

function hideBoardSettingsPanel() {
  // If the title field is empty, fall back to the placeholder (the original title)
  const titleEl = document.getElementById('bstgTitle');
  const board = getActiveBoard();
  const tab = getActiveTab();
  if (board && tab && !titleEl.value.trim()) {
    tab.title = titleEl.placeholder || 'New Tab';
    syncBoardCompatibilityFields(board, tab.id);
    renderBoard();
  }
  document.getElementById('boardSettingsDoneBtn').textContent = 'OK';
  document.getElementById('boardSettingsPanel').classList.add('hidden');
  document.getElementById('modalCard').classList.remove('hidden');
  elements.modalOverlay.classList.add('hidden');
  boardSettingsCreatingId = null;
  _boardSettingsCancelSnapshot = null;
  saveState();
}

function _findNavBoardItem(items, boardId) {
  for (const i of (items || [])) {
    if (i.boardId === boardId) return i;
    if (i.children) { const f = _findNavBoardItem(i.children, boardId); if (f) return f; }
  }
  return null;
}

function cancelBoardSettingsPanel() {
  if (boardSettingsCreatingId) {
    const board = getActiveBoardContainer();
    if (board) removeBoardTab(board, boardSettingsCreatingId, { allowEmpty: true });
    renderAll();
    saveState();
  } else if (_boardSettingsCancelSnapshot) {
    const idx = state.boards.findIndex(b => b.id === _boardSettingsCancelSnapshot.board.id);
    if (idx !== -1) state.boards[idx] = _boardSettingsCancelSnapshot.board;
    state.activeTabId = _boardSettingsCancelSnapshot.activeTabId || state.activeTabId;
    _boardSettingsCancelSnapshot = null;
    renderAll();
  }
  _boardSettingsCancelSnapshot = null;
  document.getElementById('boardSettingsPanel').classList.add('hidden');
  document.getElementById('modalCard').classList.remove('hidden');
  elements.modalOverlay.classList.add('hidden');
  boardSettingsCreatingId = null;
}

function updateBgDropZonePreview(imageUrl) {
  const dz = document.getElementById('bstgDropZone');
  if (imageUrl) {
    dz.style.backgroundImage = `url(${JSON.stringify(imageUrl)})`;
    dz.classList.add('has-preview');
  } else {
    dz.style.backgroundImage = '';
    dz.classList.remove('has-preview');
  }
}

function attachBoardSettingsListeners() {
  document.getElementById('bstgTitle').addEventListener('input', e => {
    const board = getActiveBoard();
    const tab = getActiveTab();
    if (!board || !tab) return;
    tab.title = e.target.value || e.target.placeholder;
    syncBoardCompatibilityFields(board, tab.id);
    renderBoard();
  });

  document.querySelectorAll('input[name="bstgCols"]').forEach(radio => {
    radio.addEventListener('change', e => {
      const board = getActiveBoard();
      const tab = getActiveTab();
      if (!board || !tab) return;
      const newCount = parseInt(e.target.value, 10) || 3;
      const regularCols = [...tab.columns];
      if (newCount < regularCols.length) {
        const removed = regularCols.slice(newCount);
        const lastKept = regularCols[newCount - 1];
        for (const col of removed) lastKept.items.push(...col.items);
        tab.columns = regularCols.slice(0, newCount);
      } else {
        while (regularCols.length < newCount) {
          regularCols.push({ id: `col-${Date.now()}-${regularCols.length + 1}`, title: `Column ${regularCols.length + 1}`, items: [] });
        }
        tab.columns = regularCols;
      }
      tab.columnCount = newCount;
      syncBoardCompatibilityFields(board, tab.id);
      renderBoard();
    });
  });

  const applyBg = () => {
    const board = getActiveBoard();
    const tab = getActiveTab();
    if (!board || !tab) return;
    syncBoardCompatibilityFields(board, tab.id);
    applyBoardBackground(board);
  };

  document.getElementById('bstgBgUrl').addEventListener('input', e => {
    const tab = getActiveTab();
    if (!tab) return;
    tab.backgroundImage = e.target.value.trim();
    updateBgDropZonePreview(tab.backgroundImage);
    applyBg();
  });

  const dropZone = document.getElementById('bstgDropZone');
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const tab = getActiveTab();
      if (!tab) return;
      tab.backgroundImage = ev.target.result;
      document.getElementById('bstgBgUrl').value = '';
      updateBgDropZonePreview(tab.backgroundImage);
      applyBg();
    };
    reader.readAsDataURL(file);
  });

  document.getElementById('bstgBgBrowse').addEventListener('click', async () => {
    if (!bridge.nativeIsAvailable()) {
      alert('File browsing requires the native messaging host.\nSee extension/native/install.ps1 to set it up.');
      return;
    }
    const result = await bridge.openFilePicker('image', 'Select background image');
    if (!result) return;
    const tab = getActiveTab();
    if (!tab) return;
    tab.backgroundImage = result.dataUrl;
    document.getElementById('bstgBgUrl').value = '';
    updateBgDropZonePreview(tab.backgroundImage);
    applyBg();
  });

  document.getElementById('bstgBgClear').addEventListener('click', () => {
    const tab = getActiveTab();
    if (!tab) return;
    tab.backgroundImage = '';
    document.getElementById('bstgBgUrl').value = '';
    updateBgDropZonePreview('');
    applyBg();
  });

  document.querySelectorAll('input[name="bstgBgFit"]').forEach(radio => {
    radio.addEventListener('change', e => {
      const tab = getActiveTab();
      if (!tab) return;
      tab.backgroundFit = e.target.value === 'contain' ? 'contain' : 'cover';
      applyBg();
    });
  });

  document.getElementById('bstgOpacity').addEventListener('input', e => {
    const tab = getActiveTab();
    if (!tab) return;
    tab.containerOpacity = parseInt(e.target.value);
    document.getElementById('bstgOpacityVal').textContent = tab.containerOpacity;
    applyBg();
  });

  document.getElementById('bstgShowSpeedDial').addEventListener('change', e => {
    const board = getActiveBoard();
    if (!board) return;
    board.showSpeedDial = e.target.checked;
    renderBoard();
  });

  document.getElementById('bstgSpeedDialSlots').addEventListener('input', e => {
    const board = getActiveBoard();
    if (!board) return;
    normalizeSpeedDialSlots(board);
    const requested = Math.max(1, Math.min(48, parseInt(e.target.value, 10) || DEFAULT_SPEED_DIAL_SLOT_COUNT));
    const lastFilled = board.speedDial.reduce((idx, item, i) => item ? i : idx, -1);
    board.speedDialSlotCount = Math.max(requested, lastFilled + 1, 1);
    e.target.value = board.speedDialSlotCount;
    renderBoard();
  });

  const bstgSharedTagsEl = document.getElementById('bstgSharedTags');
  bstgSharedTagsEl.addEventListener('input', e => {
    const board = getActiveBoard();
    const tab = getActiveTab();
    if (!board || !tab) return;
    tab.sharedTags = e.target.value.trim().split(/\s+/).filter(Boolean);
    syncBoardCompatibilityFields(board, tab.id);
    renderBoard();
  });
  initChipInput(bstgSharedTagsEl, tagChipOpts());

  const bstgTagsEl = document.getElementById('bstgTags');
  bstgTagsEl.addEventListener('input', e => {
    const board = getActiveBoard();
    const tab = getActiveTab();
    if (!board || !tab) return;
    tab.tags = e.target.value.trim().split(/\s+/).filter(Boolean);
    syncBoardCompatibilityFields(board, tab.id);
  });
  initChipInput(bstgTagsEl, tagChipOpts());

  document.getElementById('bstgInheritTags').addEventListener('change', e => {
    const board = getActiveBoard();
    const tab = getActiveTab();
    if (!board || !tab) return;
    tab.inheritTags = e.target.checked;
    syncBoardCompatibilityFields(board, tab.id);
    renderBoard();
  });

  document.getElementById('bstgAutoRemove').addEventListener('change', e => {
    const board = getActiveBoard();
    const tab = getActiveTab();
    if (!board || !tab) return;
    tab.autoRemoveTags = e.target.checked;
    syncBoardCompatibilityFields(board, tab.id);
  });

  document.getElementById('boardSettingsDoneBtn').addEventListener('click', hideBoardSettingsPanel);
  document.getElementById('boardSettingsCancelBtn').addEventListener('click', cancelBoardSettingsPanel);
}

// --- Theme picker ---

const THEME_EDITOR_COLOR_FIELDS = [
  { key: 'bg', label: 'Background' },
  { key: 'panel', label: 'Panel' },
  { key: 'panelStrong', label: 'Panel strong' },
  { key: 'panelMuted', label: 'Panel muted' },
  { key: 'border', label: 'Border' },
  { key: 'text', label: 'Text' },
  { key: 'textMuted', label: 'Text muted' },
  { key: 'accent', label: 'Accent' },
  { key: 'accentStrong', label: 'Accent strong' },
  { key: 'danger', label: 'Danger' }
];

let _themeEditorDraft = null;
let _themeNameModalSubmit = null;
let _themeEditorSelection = null;
let _themeEditorSavedTheme = null;
let _themeGroupCollapsed = { builtin: false, custom: false };

function cloneThemeForEditor(theme) {
  const base = cloneData(theme || getThemeById('default-dark'));
  const defaults = cloneData(getThemeById('default-dark'));
  base.id = base.id || defaults.id;
  base.name = base.name || defaults.name;
  base.builtin = !!base.builtin;
  base.colorScheme = base.colorScheme === 'light' ? 'light' : 'dark';
  base.colors = { ...(defaults.colors || {}), ...(base.colors || {}) };
  return base;
}

function inferThemeSelection(theme) {
  if (theme && !theme.builtin && (state.settings.customThemes || []).some(t => t.id === theme.id)) {
    return { source: 'custom', id: theme.id || '' };
  }
  return { source: 'builtin', id: theme?.id || getResolvedThemeId(state.settings.activeThemeName || 'default-dark') };
}

function getThemeSelectionKey(selection = _themeEditorSelection) {
  if (!selection) return '';
  return `${selection.source || 'builtin'}:${selection.id || ''}`;
}

function loadThemeEditor(theme = null, selection = null) {
  const loadedTheme = cloneThemeForEditor(theme || getThemeById(state.settings.activeThemeName || 'default-dark'));
  _themeEditorDraft = cloneThemeForEditor(loadedTheme);
  _themeEditorSavedTheme = cloneThemeForEditor(loadedTheme);
  _themeEditorSelection = selection || inferThemeSelection(theme || loadedTheme);
  if (_themeEditorSelection?.source) _themeGroupCollapsed[_themeEditorSelection.source] = false;
  renderThemeEditor();
}

function showThemeNameModal({ title, submitLabel, initialName = '', placeholder = 'Theme name', onSubmit }) {
  _themeNameModalSubmit = async value => {
    try {
      return await onSubmit(value);
    } finally {
      _themeNameModalSubmit = null;
    }
  };
  showModal('themeName', {
    title,
    value1: initialName,
    placeholder1: placeholder,
    submitLabel
  });
}

function _themeEditorApplyDraft() {
  if (!_themeEditorDraft) return;
  applyTheme(_themeEditorDraft);
}

function _themeEditorIsValidHex(value) {
  return /^#[0-9a-f]{6}$/i.test((value || '').trim());
}

function _themeEditorSerialize(theme) {
  const normalized = cloneThemeForEditor(theme);
  return JSON.stringify({
    id: normalized.id,
    name: normalized.name,
    builtin: normalized.builtin,
    colorScheme: normalized.colorScheme,
    colors: normalized.colors
  });
}

function _themeEditorGetSavedTheme() {
  return cloneThemeForEditor(_themeEditorSavedTheme || getThemeById(state.settings.activeThemeName || 'default-dark'));
}

function _themeEditorSlugify(name) {
  return (name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || `theme-${Date.now()}`;
}

function _themeEditorCanDirectSave() {
  if (!_themeEditorDraft || _themeEditorDraft.builtin) return false;
  return (state.settings.customThemes || []).some(theme => theme.id === _themeEditorDraft.id);
}

function _themeEditorCanDeleteSavedTheme() {
  if (!_themeEditorDraft) return false;
  return !!(!_themeEditorDraft.builtin && _themeEditorDraft.id === state.settings.activeThemeName);
}

function _themeEditorResolveSourceThemeId(theme = _themeEditorDraft) {
  const draftSourceId = theme?.sourceThemeId;
  if (draftSourceId && draftSourceId !== theme?.id && getThemeById(draftSourceId)) return draftSourceId;
  const activeId = state.settings.activeThemeName || 'default-dark';
  if (activeId && activeId !== theme?.id && getThemeById(activeId)) return activeId;
  return 'default-dark';
}

function _themeEditorAllThemeNames() {
  return getAllThemes().map(theme => theme.name || '').filter(Boolean);
}

function _themeEditorEnsureUniqueName(baseName) {
  const existing = new Set(_themeEditorAllThemeNames());
  if (!existing.has(baseName)) return baseName;
  let i = 2;
  while (existing.has(`${baseName} ${i}`)) i++;
  return `${baseName} ${i}`;
}

function _themeEditorEnsureUniqueId(baseId) {
  const existing = new Set(getAllThemes().map(theme => theme.id));
  if (!existing.has(baseId)) return baseId;
  let i = 2;
  while (existing.has(`${baseId}-${i}`)) i++;
  return `${baseId}-${i}`;
}

function _themeEditorUpdateActionButtons() {
  const duplicateBtn = document.getElementById('stgDuplicateThemeBtn');
  const deleteBtn = document.getElementById('stgDeleteThemeBtn');
  const saveBtn = document.getElementById('stgSaveThemeBtn');
  const saveAsBtn = document.getElementById('stgSaveThemeAsBtn');
  if (duplicateBtn) duplicateBtn.disabled = !_themeEditorDraft;
  if (deleteBtn) deleteBtn.disabled = !_themeEditorCanDeleteSavedTheme();
  if (saveBtn) {
    saveBtn.disabled = !_themeEditorDraft;
    saveBtn.textContent = _themeEditorCanDirectSave() ? 'Save' : 'Save As…';
  }
  if (saveAsBtn) saveAsBtn.disabled = !_themeEditorDraft;
}

function _themePickerBuildBadges(card, { isActive, isEdited, isBuiltin }) {
  let badges = card.querySelector('.theme-card-badges');
  if (!badges) {
    badges = document.createElement('div');
    badges.className = 'theme-card-badges';
    card.prepend(badges);
  }
  badges.innerHTML = '';

  if (isActive) {
    const activeBadge = document.createElement('span');
    activeBadge.className = 'theme-card-badge theme-card-badge--active';
    activeBadge.textContent = 'Active';
    badges.appendChild(activeBadge);
  }

  if (isEdited) {
    const editedBadge = document.createElement('span');
    editedBadge.className = 'theme-card-badge theme-card-badge--edited';
    editedBadge.textContent = 'Edited';
    badges.appendChild(editedBadge);
  } else if (!isBuiltin) {
    const customBadge = document.createElement('span');
    customBadge.className = 'theme-card-badge theme-card-badge--custom';
    customBadge.textContent = 'Custom';
    badges.appendChild(customBadge);
  }
}

function toggleThemeGroupCollapsed(source) {
  if (!source) return;
  _themeGroupCollapsed[source] = !_themeGroupCollapsed[source];
  syncThemeGroupVisibility();
}

function syncThemeGroupVisibility() {
  document.querySelectorAll('.theme-group').forEach(section => {
    const source = section.dataset.themeGroup || '';
    const collapsed = !!_themeGroupCollapsed[source];
    section.classList.toggle('is-collapsed', collapsed);
    const toggle = section.querySelector('.theme-group-toggle');
    if (toggle) toggle.textContent = collapsed ? '+' : '−';
  });
}

function syncThemePickerUiState() {
  const container = document.getElementById('stgThemePicker');
  if (!container) return;
  const active = getResolvedThemeId(state.settings.activeThemeName || 'default-dark');
  const selectedKey = getThemeSelectionKey() || `builtin:${active}`;
  const hasEditedPreview = themeEditorHasUnsavedPreview();
  container.querySelectorAll('.theme-card').forEach(card => {
    const isActive = card.dataset.themeKey === selectedKey;
    const isEdited = isActive && hasEditedPreview;
    const isBuiltin = card.dataset.themeBuiltin === '1';
    card.classList.toggle('active', isActive);
    card.classList.toggle('theme-card--edited', isEdited);
    _themePickerBuildBadges(card, { isActive, isEdited, isBuiltin });
  });
  syncThemeGroupVisibility();
}

function themeEditorHasUnsavedPreview() {
  if (!_themeEditorDraft) return false;
  return _themeEditorSerialize(_themeEditorDraft) !== _themeEditorSerialize(_themeEditorGetSavedTheme());
}

function updateThemeEditorDraftUiState() {
  const meta = document.getElementById('stgThemeEditorMeta');
  const revertBtn = document.getElementById('stgThemeEditorRevertBtn');
  const draft = _themeEditorDraft;
  const dirty = themeEditorHasUnsavedPreview();
  if (meta && draft) {
    meta.textContent = `${draft.builtin ? 'Built-in' : 'Custom'} theme · ${dirty ? 'preview modified' : 'live preview'}`;
  }
  if (revertBtn) revertBtn.disabled = !dirty;
  _themeEditorUpdateActionButtons();
  syncThemePickerUiState();
}

function revertThemeEditorToSavedTheme() {
  const saved = _themeEditorGetSavedTheme();
  _themeEditorDraft = saved;
  applyTheme(saved);
  renderThemeEditor();
}

function createNewThemeDraft() {
  const draft = cloneThemeForEditor(getThemeById('default-dark'));
  draft.id = `draft-${Date.now()}`;
  draft.name = 'New Theme';
  draft.builtin = false;
  _themeEditorDraft = draft;
  _themeEditorSelection = { source: 'draft', id: draft.id };
  _themeEditorApplyDraft();
  renderThemeEditor();
}

async function duplicateThemeDraft() {
  const source = cloneThemeForEditor(_themeEditorDraft || _themeEditorGetSavedTheme());
  const sourceThemeId = source.id;
  showThemeNameModal({
    title: 'Duplicate Theme',
    submitLabel: 'Duplicate',
    initialName: `${source.name || 'Theme'} Copy`,
    onSubmit: async requestedName => {
      if (!requestedName?.trim()) return false;
      const duplicateName = _themeEditorEnsureUniqueName(requestedName.trim());
      source.id = _themeEditorEnsureUniqueId(_themeEditorSlugify(duplicateName));
      source.name = duplicateName;
      source.builtin = false;
      source.sourceThemeId = sourceThemeId;
      await persistThemeDraft(source);
      return true;
    }
  });
}

async function persistThemeDraft(theme) {
  if (!theme) return;
  if (!state.settings.customThemes) state.settings.customThemes = [];
  if (!Array.isArray(state.settings.deletedThemeIds)) state.settings.deletedThemeIds = [];
  const savedTheme = cloneThemeForEditor(theme);
  savedTheme.builtin = false;
  savedTheme.sourceThemeId = _themeEditorResolveSourceThemeId(savedTheme);
  const idx = state.settings.customThemes.findIndex(t => t.id === savedTheme.id);
  if (idx >= 0) state.settings.customThemes[idx] = savedTheme;
  else state.settings.customThemes.push(savedTheme);
  state.settings.deletedThemeIds = state.settings.deletedThemeIds.filter(id => id !== savedTheme.id);
  state.settings.activeThemeName = savedTheme.id;
  _themeEditorDraft = cloneThemeForEditor(savedTheme);
  _themeEditorSavedTheme = cloneThemeForEditor(savedTheme);
  _themeEditorSelection = { source: 'custom', id: savedTheme.id };
  applyTheme(savedTheme);
  saveState();
  await renderThemePicker();
}

async function deleteThemeDraft() {
  if (!_themeEditorCanDeleteSavedTheme()) return;
  const themeId = _themeEditorDraft.id;
  const fallbackId = _themeEditorResolveSourceThemeId(_themeEditorDraft);
  if (!Array.isArray(state.settings.deletedThemeIds)) state.settings.deletedThemeIds = [];
  state.settings.customThemes = (state.settings.customThemes || []).filter(theme => theme.id !== themeId);
  if (!state.settings.deletedThemeIds.includes(themeId)) state.settings.deletedThemeIds.push(themeId);
  state.settings.activeThemeName = fallbackId;
  const fallback = getThemeById(fallbackId) || getThemeById('default-dark');
  _themeEditorDraft = cloneThemeForEditor(fallback);
  _themeEditorSavedTheme = cloneThemeForEditor(fallback);
  _themeEditorSelection = inferThemeSelection(fallback);
  applyTheme(fallback);
  saveState();
  await renderThemePicker();
}

async function saveThemeDraftAs() {
  if (!_themeEditorDraft) return;
  const defaultName = _themeEditorDraft.name || 'New Theme';
  showThemeNameModal({
    title: 'Save Theme As',
    submitLabel: 'Save',
    initialName: defaultName,
    onSubmit: async name => {
      if (!name?.trim()) return false;
      const trimmed = name.trim();
      const theme = cloneThemeForEditor(_themeEditorDraft);
      theme.id = _themeEditorSlugify(trimmed);
      theme.name = trimmed;
      theme.builtin = false;
      await persistThemeDraft(theme);
      return true;
    }
  });
}

async function saveThemeDraft() {
  if (!_themeEditorDraft) return;
  if (_themeEditorCanDirectSave()) {
    const theme = cloneThemeForEditor(_themeEditorDraft);
    theme.builtin = false;
    await persistThemeDraft(theme);
    return;
  }
  await saveThemeDraftAs();
}

function renderThemeEditor() {
  const container = document.getElementById('stgThemeEditor');
  if (!container) return;
  if (!_themeEditorDraft) _themeEditorDraft = cloneThemeForEditor(getThemeById(state.settings.activeThemeName || 'default-dark'));

  const draft = _themeEditorDraft;
  container.innerHTML = '';

  const card = document.createElement('div');
  card.className = 'theme-editor-card';

  const header = document.createElement('div');
  header.className = 'theme-editor-header';

  const titleWrap = document.createElement('div');
  titleWrap.className = 'theme-editor-title-wrap';

  const title = document.createElement('div');
  title.className = 'theme-editor-title';
  title.textContent = draft.name || 'Untitled Theme';
  titleWrap.appendChild(title);

  const meta = document.createElement('div');
  meta.id = 'stgThemeEditorMeta';
  meta.className = 'theme-editor-meta';
  meta.textContent = `${draft.builtin ? 'Built-in' : 'Custom'} theme · ${themeEditorHasUnsavedPreview() ? 'preview modified' : 'live preview'}`;
  titleWrap.appendChild(meta);

  header.appendChild(titleWrap);

  const headerControls = document.createElement('div');
  headerControls.className = 'theme-editor-header-controls';

  const schemeGroup = document.createElement('div');
  schemeGroup.className = 'theme-editor-scheme';
  ['dark', 'light'].forEach(value => {
    const label = document.createElement('label');
    label.className = 'theme-editor-scheme-option';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'themeEditorScheme';
    input.value = value;
    input.checked = draft.colorScheme === value;
    input.addEventListener('change', () => {
      draft.colorScheme = value;
      _themeEditorApplyDraft();
      updateThemeEditorDraftUiState();
    });
    const span = document.createElement('span');
    span.textContent = value === 'dark' ? 'Dark' : 'Light';
    label.appendChild(input);
    label.appendChild(span);
    schemeGroup.appendChild(label);
  });
  headerControls.appendChild(schemeGroup);

  const revertBtn = document.createElement('button');
  revertBtn.type = 'button';
  revertBtn.id = 'stgThemeEditorRevertBtn';
  revertBtn.className = 'secondary-btn theme-editor-revert-btn';
  revertBtn.textContent = 'Revert Preview';
  revertBtn.disabled = !themeEditorHasUnsavedPreview();
  revertBtn.addEventListener('click', () => revertThemeEditorToSavedTheme());
  headerControls.appendChild(revertBtn);

  header.appendChild(headerControls);
  card.appendChild(header);

  const colorGrid = document.createElement('div');
  colorGrid.className = 'theme-editor-grid';

  THEME_EDITOR_COLOR_FIELDS.forEach(field => {
    const row = document.createElement('label');
    row.className = 'theme-editor-row';

    const name = document.createElement('span');
    name.className = 'theme-editor-row-label';
    name.textContent = field.label;
    row.appendChild(name);

    const controls = document.createElement('div');
    controls.className = 'theme-editor-row-controls';

    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.className = 'theme-editor-color';
    colorInput.value = draft.colors[field.key];

    const textInput = document.createElement('input');
    textInput.type = 'text';
    textInput.className = 'theme-editor-text';
    textInput.value = draft.colors[field.key];
    textInput.spellcheck = false;

    colorInput.addEventListener('input', () => {
      draft.colors[field.key] = colorInput.value;
      textInput.value = colorInput.value;
      textInput.classList.remove('is-invalid');
      _themeEditorApplyDraft();
      updateThemeEditorDraftUiState();
    });

    textInput.addEventListener('input', () => {
      const value = textInput.value.trim();
      const valid = _themeEditorIsValidHex(value);
      textInput.classList.toggle('is-invalid', !valid && value.length > 0);
      if (!valid) return;
      draft.colors[field.key] = value;
      colorInput.value = value;
      _themeEditorApplyDraft();
      updateThemeEditorDraftUiState();
    });

    textInput.addEventListener('blur', () => {
      if (_themeEditorIsValidHex(textInput.value)) return;
      textInput.value = draft.colors[field.key];
      textInput.classList.remove('is-invalid');
    });

    controls.appendChild(colorInput);
    controls.appendChild(textInput);
    row.appendChild(controls);
    colorGrid.appendChild(row);
  });

  card.appendChild(colorGrid);

  const advanced = document.createElement('div');
  advanced.className = 'theme-editor-advanced';

  const radiusRow = document.createElement('label');
  radiusRow.className = 'theme-editor-inline-row';
  const radiusLabel = document.createElement('span');
  radiusLabel.textContent = 'Radius';
  const radiusInput = document.createElement('input');
  radiusInput.type = 'text';
  radiusInput.className = 'theme-editor-text';
  radiusInput.value = draft.colors.radius || '';
  radiusInput.spellcheck = false;
  radiusInput.addEventListener('input', () => {
    draft.colors.radius = radiusInput.value.trim() || '18px';
    _themeEditorApplyDraft();
    updateThemeEditorDraftUiState();
  });
  radiusRow.appendChild(radiusLabel);
  radiusRow.appendChild(radiusInput);

  const shadowRow = document.createElement('label');
  shadowRow.className = 'theme-editor-inline-row theme-editor-inline-row--wide';
  const shadowLabel = document.createElement('span');
  shadowLabel.textContent = 'Shadow';
  const shadowInput = document.createElement('input');
  shadowInput.type = 'text';
  shadowInput.className = 'theme-editor-text';
  shadowInput.value = draft.colors.shadow || '';
  shadowInput.spellcheck = false;
  shadowInput.addEventListener('input', () => {
    draft.colors.shadow = shadowInput.value.trim() || '0 20px 40px rgba(0,0,0,0.35)';
    _themeEditorApplyDraft();
    updateThemeEditorDraftUiState();
  });
  shadowRow.appendChild(shadowLabel);
  shadowRow.appendChild(shadowInput);

  advanced.appendChild(radiusRow);
  advanced.appendChild(shadowRow);
  card.appendChild(advanced);

  const note = document.createElement('div');
  note.className = 'theme-editor-note';
  note.textContent = 'Changes preview immediately. Use Save or Save As… to keep the current look.';
  card.appendChild(note);

  container.appendChild(card);
  updateThemeEditorDraftUiState();
}

async function renderThemePicker() {
  const container = document.getElementById('stgThemePicker');
  const active = getResolvedThemeId(state.settings.activeThemeName || 'default-dark');
  const hasEditedPreview = themeEditorHasUnsavedPreview();
  if (state.settings.activeThemeName !== active) state.settings.activeThemeName = active;
  if (!Array.isArray(state.settings.deletedThemeIds)) state.settings.deletedThemeIds = [];

  const builtinThemes = BUILTIN_THEMES;
  const customThemes = (state.settings.customThemes || []).filter(theme => !state.settings.deletedThemeIds.includes(theme.id));

  container.innerHTML = '';
  const groups = [
    { title: 'Built-in', className: 'theme-group--builtin', source: 'builtin', themes: builtinThemes },
    { title: 'Custom', className: 'theme-group--custom', source: 'custom', themes: customThemes }
  ];

  groups.forEach(group => {
    if (!group.themes.length) return;

    const section = document.createElement('section');
    section.className = `theme-group ${group.className}`;
    section.dataset.themeGroup = group.source;

    const header = document.createElement('div');
    header.className = 'theme-group-header';
    header.role = 'button';
    header.tabIndex = 0;
    header.addEventListener('click', () => toggleThemeGroupCollapsed(group.source));
    header.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      toggleThemeGroupCollapsed(group.source);
    });

    const title = document.createElement('div');
    title.className = 'theme-group-title';
    title.textContent = group.title;
    header.appendChild(title);

    const count = document.createElement('div');
    count.className = 'theme-group-count';
    count.textContent = `${group.themes.length} theme${group.themes.length !== 1 ? 's' : ''}`;
    header.appendChild(count);

    const toggle = document.createElement('div');
    toggle.className = 'theme-group-toggle';
    toggle.textContent = '−';
    header.appendChild(toggle);

    section.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'theme-picker';

    group.themes.forEach(theme => {
      const selection = { source: group.source, id: theme.id };
      const isActive = getThemeSelectionKey(selection) === (getThemeSelectionKey() || `builtin:${active}`);
      const isEdited = isActive && hasEditedPreview;
      const card = document.createElement('div');
      card.className = 'theme-card'
        + (isActive ? ' active' : '')
        + (group.source === 'custom' ? ' theme-card--custom' : '')
        + (isEdited ? ' theme-card--edited' : '');
      card.dataset.themeId = theme.id;
      card.dataset.themeBuiltin = theme.builtin ? '1' : '0';
      card.dataset.themeKey = getThemeSelectionKey(selection);
      _themePickerBuildBadges(card, { isActive, isEdited, isBuiltin: !!theme.builtin });

      const swatches = document.createElement('div');
      swatches.className = 'theme-swatches';
      for (const color of [theme.colors.bg, theme.colors.panel, theme.colors.accent, theme.colors.text]) {
        const s = document.createElement('div');
        s.className = 'theme-swatch';
        s.style.background = color;
        swatches.appendChild(s);
      }

      const name = document.createElement('div');
      name.className = 'theme-name';
      name.textContent = theme.name;

      card.appendChild(swatches);
      card.appendChild(name);

      card.addEventListener('click', async () => {
        state.settings.activeThemeName = theme.id;
        applyTheme(theme);
        loadThemeEditor(theme, selection);
        saveState();
        syncThemePickerUiState();
      });

      grid.appendChild(card);
    });

    section.appendChild(grid);
    container.appendChild(section);
  });

  syncThemeGroupVisibility();
  if (!_themeEditorDraft || _themeEditorDraft.id !== active) loadThemeEditor(getThemeById(active));
  else renderThemeEditor();
}


// --- Global settings panel ---

const COLOR_DEFAULTS = {
  hubNameColor: '#e5e7eb', boardTitleColor: '#e5e7eb', boardColor: '#e5e7eb',
  bookmarkColor: '#e5e7eb', folderColor: '#e5e7eb',
  titleColor: '#9ca3af', titleLineColor: '#3a3c42'
};

const FONT_OPTIONS = [
  { value: '', label: 'Default' },
  { value: 'system-ui, sans-serif', label: 'System UI' },
  { value: 'Arial, sans-serif', label: 'Arial' },
  { value: 'Verdana, sans-serif', label: 'Verdana' },
  { value: 'Trebuchet MS, sans-serif', label: 'Trebuchet MS' },
  { value: 'Georgia, serif', label: 'Georgia' },
  { value: "'Times New Roman', serif", label: 'Times New Roman' },
  { value: "'Courier New', monospace", label: 'Courier New' },
  { value: 'Consolas, monospace', label: 'Consolas' },
];

const STYLE_SECTIONS = ['hubName', 'boardTitle', 'board', 'bookmark', 'folder', 'title'];

function populateFontSelects() {
  ['stgHubNameFamily','stgBoardTitleFamily','stgBoardFamily','stgBookmarkFamily','stgFolderFamily','stgTitleFamily'].forEach(id => {
    const sel = document.getElementById(id);
    if (sel.options.length) return;
    FONT_OPTIONS.forEach(({ value, label }) => {
      const opt = new Option(label, value);
      opt.style.fontFamily = value || 'inherit';
      sel.appendChild(opt);
    });
  });
}

function ensureStyleSettings() {
  if (!state.settings.styleOverrides) state.settings.styleOverrides = {};
  STYLE_SECTIONS.forEach(section => {
    if (state.settings.styleOverrides[section] !== true) state.settings.styleOverrides[section] = false;
  });
  if (!state.settings.globalFontScale) state.settings.globalFontScale = 'medium';
  if (!state.settings.globalFontColor) state.settings.globalFontColor = '#e5e7eb';
  if (state.settings.globalFontColorFromTheme === undefined) state.settings.globalFontColorFromTheme = true;
  if (state.settings.showAdvancedStyleSettings === undefined) state.settings.showAdvancedStyleSettings = false;
}

function updateStyleAdvancedUI() {
  ensureStyleSettings();
  document.querySelectorAll('.style-advanced-section').forEach(section => {
    section.classList.toggle('hidden', !state.settings.showAdvancedStyleSettings);
    const key = section.dataset.styleSection;
    const enabled = !!state.settings.styleOverrides[key];
    section.classList.toggle('style-advanced-section--disabled', !enabled);
    section.querySelectorAll('input, select, button').forEach(control => {
      if (control.matches('[data-style-override]')) return;
      control.disabled = !enabled;
    });
  });
  document.querySelectorAll('[data-style-override]').forEach(input => {
    input.checked = !!state.settings.styleOverrides[input.dataset.styleOverride];
  });
}

function updateEssentialsWarning() {
  const count = state.settings.essentialsDisplayCount || 10;
  const hasHidden = state.essentials.slice(count).some(Boolean);
  document.getElementById('stgEssHiddenWarning').classList.toggle('hidden', !hasHidden);
}

function updateLastExportedLabel() {
  const el = document.getElementById('stgLastExported');
  if (!state.lastExported) { el.textContent = 'Never exported'; return; }
  const d = new Date(state.lastExported);
  el.textContent = `Last exported: ${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

async function getBridgeStorageInfo() {
  if (typeof bridge === 'undefined') {
    return { extensionReady: false, nativeReady: false, databasePath: null };
  }
  await bridge.whenReady;
  const extensionReady = bridge.isAvailable();
  const nativeReady = extensionReady && bridge.nativeIsAvailable();
  const info = extensionReady ? await bridge.getStorageInfo() : null;
  return {
    extensionReady,
    nativeReady,
    databasePath: info?.databasePath || null
  };
}

async function updateDatabasePathControls() {
  const input = document.getElementById('stgDatabasePath');
  const browseBtn = document.getElementById('stgDatabasePathBrowse');
  const applyBtn = document.getElementById('stgDatabasePathApply');
  const statusEl = document.getElementById('stgDatabasePathStatus');
  if (!input || !browseBtn || !applyBtn || !statusEl) return;

  const info = await getBridgeStorageInfo();
  const savedPath = state.databasePath || info.databasePath || '';
  const draftPath = _pendingDatabasePath.trim();
  const displayedPath = draftPath || savedPath;
  input.value = displayedPath;
  input.disabled = !info.nativeReady;
  browseBtn.disabled = !info.nativeReady;
  applyBtn.disabled = !info.nativeReady;

  if (!info.extensionReady) {
    statusEl.textContent = 'Extension not detected. Using browser localStorage only.';
    return;
  }
  if (!info.nativeReady) {
    statusEl.textContent = 'Extension connected, but native host is unavailable. Shared disk sync is off.';
    return;
  }
  statusEl.textContent = savedPath
    ? `Shared file active: ${savedPath}`
    : draftPath
      ? 'Path selected but not applied yet.'
      : 'Native host is available, but no shared database path is configured yet.';
}

async function updateAboutBridgeStatus() {
  const extensionEl = document.getElementById('aboutExtensionStatus');
  const nativeEl = document.getElementById('aboutNativeStatus');
  const databasePathEl = document.getElementById('aboutDatabasePath');
  const featuresEl = document.getElementById('aboutExtensionFeatures');
  const storageNoteEl = document.getElementById('aboutStorageNote');
  if (!extensionEl || !nativeEl || !databasePathEl || !featuresEl || !storageNoteEl) return;

  const info = await getBridgeStorageInfo();
  extensionEl.textContent = info.extensionReady ? 'Connected' : 'Not detected';
  nativeEl.textContent = info.nativeReady ? 'Available' : (info.extensionReady ? 'Not available' : 'Not connected');
  databasePathEl.textContent = info.databasePath || (info.nativeReady ? 'Not configured' : 'Unavailable');

  const features = [];
  if (info.extensionReady) {
    features.push('extension storage backup', 'send current tab to board inbox');
    if (info.nativeReady) features.push('shared JSON file sync', 'background image picker', 'theme file import/export');
  }
  featuresEl.textContent = features.length
    ? `Extension features: ${features.join(', ')}.`
    : 'Extension features: unavailable. The hub is running in localStorage-only mode.';

  storageNoteEl.textContent = info.nativeReady && info.databasePath
    ? `Primary storage is the shared disk file at ${info.databasePath}. localStorage is only a browser-local cache.`
    : 'Without the native host, the hub stores data in browser localStorage. Use Export JSON in General to keep regular backups.';

  updateSidebarExtensionStatus(info);
}

async function updateSidebarExtensionStatus(info = null) {
  const el = document.getElementById('sidebarExtensionStatus');
  if (!el) return;
  const bridgeInfo = info || await getBridgeStorageInfo();
  const detected = bridgeInfo.extensionReady;
  el.textContent = detected ? 'Extension detected' : 'Extension not detected';
  el.classList.toggle('is-detected', detected);
  el.classList.toggle('is-missing', !detected);
}

function showSettingsPanel(tab = 'general') {
  document.getElementById('modalCard').classList.add('hidden');
  const panel = document.getElementById('settingsPanel');
  panel.classList.remove('hidden');
  elements.modalOverlay.classList.remove('hidden');
  centerPanel(panel);
  makeDraggable(panel, panel.querySelector('.settings-header'));
  const targetTab = panel.querySelector(`.settings-tab[data-tab="${tab}"]`);
  const body = panel.querySelector('.settings-body[data-active-tab]');
  if (targetTab) {
    panel.querySelectorAll('.settings-tab').forEach(t => t.classList.toggle('active', t === targetTab));
  } else {
    panel.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
  }
  if (body && panel.querySelector(`[data-tab="${tab}"]`)) body.dataset.activeTab = tab;
  const s = state.settings;
  ensureStyleSettings();
  document.getElementById('stgHubName').value = state.hubName || '';
  document.querySelectorAll(`input[name="stgGlobalFontScale"]`).forEach(r => { r.checked = r.value === (s.globalFontScale || 'medium'); });
  document.getElementById('stgGlobalFontColor').value = s.globalFontColor || '#e5e7eb';
  document.getElementById('stgGlobalThemeColor').checked = s.globalFontColorFromTheme !== false;
  document.getElementById('stgGlobalFontColor').disabled = s.globalFontColorFromTheme !== false;
  document.getElementById('stgShowAdvancedStyle').checked = !!s.showAdvancedStyleSettings;
  document.getElementById('stgBookmarkFont').value = s.bookmarkFontSize;
  document.getElementById('stgShowTags').checked = s.showTags;
  document.getElementById('stgWarnOnClose').checked = s.warnOnClose;
  document.getElementById('stgSharedAutoRefreshNotice').checked = s.sharedAutoRefreshNotice !== false;
  document.getElementById('stgConfirmDeleteBoard').checked = s.confirmDeleteBoard;
  document.getElementById('stgConfirmDeleteBookmark').checked = s.confirmDeleteBookmark;
  document.getElementById('stgConfirmDeleteFolder').checked = s.confirmDeleteFolder;
  document.getElementById('stgConfirmDeleteTitleDivider').checked = s.confirmDeleteTitleDivider;
  document.getElementById('stgConfirmDeleteTag').checked = s.confirmDeleteTag;
  document.getElementById('stgApiKeyNasa').value = s.serviceApiKeys?.nasa || '';
  document.getElementById('stgFolderFont').value = s.folderFontSize;
  document.getElementById('stgTitleFont').value = s.titleFontSize;
  document.getElementById('stgLineThicknessVal').textContent = s.titleLineThickness;
  document.getElementById('stgBoardTitleFont').value = s.boardTitleFontSize;
  document.getElementById('stgBoardFont').value = s.boardFontSize;
  _themeEditorDraft = null;
  _themeEditorSelection = null;
  _themeEditorSavedTheme = null;
  populateFontSelects();
  document.getElementById('stgHubNameFont').value      = s.hubNameFontSize || 18;
  document.getElementById('stgHubNameFamily').value    = s.hubNameFontFamily || '';
  document.getElementById('stgBoardTitleFamily').value = s.boardTitleFontFamily || '';
  document.getElementById('stgBoardFamily').value      = s.boardFontFamily || '';
  document.getElementById('stgBookmarkFamily').value   = s.bookmarkFontFamily || '';
  document.getElementById('stgFolderFamily').value      = s.folderFontFamily || '';
  document.getElementById('stgTitleFamily').value       = s.titleFontFamily || '';
  document.querySelectorAll('.fmt-btn').forEach(btn => btn.classList.toggle('active', !!s[btn.dataset.fmt]));
  document.querySelectorAll('.align-btn').forEach(btn => btn.classList.toggle('active', (s[btn.dataset.alignKey] || 'left') === btn.dataset.alignVal));
  Object.entries(COLOR_DEFAULTS).forEach(([key, def]) => {
    document.getElementById('stg' + key[0].toUpperCase() + key.slice(1)).value = s[key] || def;
  });
  document.getElementById('stgTitleLineStyle').value = s.titleLineStyle || 'solid';
  const sdSizeRadio = document.querySelector(`input[name="stgSpeedDialSize"][value="${s.speedDialIconSize || 'medium'}"]`);
  if (sdSizeRadio) sdSizeRadio.checked = true;
  const essSizeRadio = document.querySelector(`input[name="stgEssentialsSize"][value="${s.essentialsIconSize || 'medium'}"]`);
  if (essSizeRadio) essSizeRadio.checked = true;
  document.getElementById('stgShowEssentials').checked = s.showEssentials !== false;
  document.getElementById('stgEssCountVal').textContent = s.essentialsDisplayCount || 10;
  updateLastExportedLabel();
  updateEssentialsWarning();
  updateStyleAdvancedUI();
  renderThemePicker();
  renderTagGroups();
  updateDatabasePathControls();
  updateAboutBridgeStatus();
}

function showTagManagerPanel() {
  document.getElementById('modalCard').classList.add('hidden');
  const panel = document.getElementById('tagManagerPanel');
  if (!panel) return;
  panel.classList.remove('hidden');
  elements.modalOverlay.classList.remove('hidden');
  centerPanel(panel);
  makeDraggable(panel, panel.querySelector('.settings-header'));
  renderTagGroups();
  updateUndoRedoUI();
}

function hideSettingsPanel() {
  if (themeEditorHasUnsavedPreview()) {
    const savedTheme = _themeEditorGetSavedTheme();
    _themeEditorDraft = savedTheme;
    applyTheme(savedTheme);
  }
  renderAll();
  document.getElementById('settingsPanel').classList.add('hidden');
  document.getElementById('modalCard').classList.remove('hidden');
  elements.modalOverlay.classList.add('hidden');
  saveState();
}

function hideTagManagerPanel() {
  renderAll();
  document.getElementById('tagManagerPanel')?.classList.add('hidden');
  document.getElementById('modalCard').classList.remove('hidden');
  elements.modalOverlay.classList.add('hidden');
  saveState();
}


function applyGroupColor(chip, color) {
  chip.style.background = hexToRgba(color, 0.15);
  chip.style.color = color;
}

function setGroupLocked(block, locked) {
  block.querySelector('.tag-group-name-input').disabled = locked;
  block.querySelector('.tag-group-del-btn').disabled = locked;
  const textInput = block.querySelector('.chip-text-input');
  if (textInput) textInput.disabled = locked;
}

function normalizeTagGroupRecord(group) {
  if (!group) return group;
  if (!group.id) group.id = `grp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  if (group.name == null) group.name = '';
  if (!group.color) group.color = '#6d7cff';
  group.locked = group.locked === true || group.locked === 'true';
  group.collapsed = group.collapsed === true || group.collapsed === 'true';
  return group;
}

function eventTargetElement(event) {
  const target = event?.target;
  if (target instanceof Element) return target;
  return target?.parentElement || null;
}

function handleTagManagerRemovePointer(event) {
  const removeBtn = eventTargetElement(event)?.closest('.chip-remove-btn');
  if (!removeBtn) return;
  const list = document.getElementById('tagGroupList');
  if (!list?.contains(removeBtn)) return;
  const chip = removeBtn.closest('.chip-live');
  const tagId = chip?.dataset.value;
  if (!tagId) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  deleteTagsWithConfirmation([tagId]);
}

function ensureTagManagerDeleteDelegation() {
  const list = document.getElementById('tagGroupList');
  if (!list || list.dataset.deleteDelegationAttached) return;
  list.dataset.deleteDelegationAttached = '1';
  if ('PointerEvent' in window) list.addEventListener('pointerdown', handleTagManagerRemovePointer, true);
  else list.addEventListener('mousedown', handleTagManagerRemovePointer, true);
}

function deleteUnsortedTagById(tagId) {
  const tag = getTagById(tagId);
  if (!tag || tag.groupId) return;
  confirmDelete('confirmDeleteTag', tagUsageMessage(tag.id, tag.name), () => {
    pushUndoSnapshot();
    deleteTag(tag.id);
    saveState();
    updateUndoRedoUI();
    renderTagGroups();
  });
}

function confirmDeleteTags(tagIds, onConfirm) {
  const tags = tagIds.map(getTagById).filter(Boolean);
  if (!tags.length) return;
  if (tags.length === 1) {
    const tag = tags[0];
    confirmDelete('confirmDeleteTag', tagUsageMessage(tag.id, tag.name), onConfirm);
    return;
  }
  confirmDelete('confirmDeleteTag', `Delete ${tags.length} tags? This removes them from every item that uses them.`, onConfirm);
}

function confirmDeleteTagGroup(group, tagCount, onConfirm) {
  const name = group.name || 'Group name';
  const suffix = tagCount
    ? ` This will also delete its ${tagCount} tag${tagCount === 1 ? '' : 's'} from every item that uses them.`
    : '';
  confirmDelete('confirmDeleteTag', `Delete tag group "${name}"?${suffix}`, onConfirm);
}

function deleteTagsWithConfirmation(tagIds) {
  confirmDeleteTags(tagIds, () => {
    pushUndoSnapshot();
    tagIds.forEach(deleteTag);
    saveState();
    updateUndoRedoUI();
    renderTagGroups();
  });
}

function createTagGroupRecord(name = '') {
  return {
    id: `grp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    color: '#6d7cff',
    locked: false,
    collapsed: false
  };
}

let _focusTagGroupId = null;

function moveTagToGroup(tagId, targetGroupId, onDone = renderTagGroups) {
  const tag = getTagById(tagId);
  if (!tag || tag.groupId === targetGroupId) return;
  const targetGroup = targetGroupId ? (state.settings.tagGroups || []).find(g => g.id === targetGroupId) : null;
  if (targetGroupId && !targetGroup) return;

  const conflict = targetGroupId
    ? (state.tags || []).find(t => t.id !== tag.id && t.groupId === targetGroupId && t.name.toLowerCase() === tag.name.toLowerCase())
    : null;

  const finish = () => {
    saveState();
    updateUndoRedoUI();
    onDone();
  };

  if (conflict) {
    showConfirmDialog(`Group "${targetGroup.name || '(unnamed)'}" already has a tag named "${tag.name}".\nMerge into it? All references will be updated.`, () => {
      pushUndoSnapshot();
      mergeTags(tag.id, conflict.id);
      finish();
    }, 'Merge');
    return;
  }

  pushUndoSnapshot();
  tag.groupId = targetGroupId || null;
  finish();
}

function createGroupAndMoveTag(tagId) {
  const tag = getTagById(tagId);
  if (!tag) return;
  if (!state.settings.tagGroups) state.settings.tagGroups = [];
  pushUndoSnapshot();
  const group = createTagGroupRecord();
  state.settings.tagGroups.push(group);
  tag.groupId = group.id;
  _focusTagGroupId = group.id;
  saveState();
  updateUndoRedoUI();
  renderTagGroups();
}

let _tagSortMenu = null;

function hideTagSortMenu() {
  if (_tagSortMenu) { _tagSortMenu.remove(); _tagSortMenu = null; }
  document.removeEventListener('mousedown', _tagSortMenuOutside, true);
}

function _tagSortMenuOutside(e) {
  if (_tagSortMenu && !_tagSortMenu.contains(e.target)) hideTagSortMenu();
}

const TAG_SORT_LABELS = { az: 'A → Z', za: 'Z → A', count: 'Most used' };

function showTagSortMenu(anchorEl, group) {
  hideTagSortMenu();
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.style.cssText = 'position:fixed;z-index:9999;';

  ['az', 'za', 'count'].forEach(mode => {
    const btn = document.createElement('button');
    const isActive = group.tagSort === mode;
    btn.style.display = 'flex';
    btn.style.alignItems = 'center';
    btn.style.gap = '8px';
    if (isActive) btn.style.color = 'var(--accent)';
    const check = document.createElement('span');
    check.textContent = '✓';
    check.style.cssText = `visibility:${isActive ? 'visible' : 'hidden'};font-size:0.85rem;flex-shrink:0;`;
    btn.appendChild(check);
    btn.appendChild(document.createTextNode(TAG_SORT_LABELS[mode]));
    btn.addEventListener('click', () => {
      hideTagSortMenu();
      group.tagSort = (group.tagSort === mode) ? null : mode;
      saveState();
      renderTagGroups();
    });
    menu.appendChild(btn);
  });

  document.body.appendChild(menu);
  _tagSortMenu = menu;
  const rect = anchorEl.getBoundingClientRect();
  let left = rect.left, top = rect.bottom + 2;
  menu.style.left = '0'; menu.style.top = '0';
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  left = Math.min(left, window.innerWidth - mw - 4);
  top = Math.min(top, window.innerHeight - mh - 4);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  document.addEventListener('mousedown', _tagSortMenuOutside, true);
}

let _tagChipMenu = null;

function hideTagChipMenu() {
  if (_tagChipMenu) { _tagChipMenu.remove(); _tagChipMenu = null; }
  document.removeEventListener('mousedown', _tagChipMenuOutside, true);
}

function _tagChipMenuOutside(e) {
  if (_tagChipMenu && !_tagChipMenu.contains(e.target)) hideTagChipMenu();
}

function showTagChipContextMenu(x, y, tagId, sourceGroupId) {
  hideTagChipMenu();
  const tag = getTagById(tagId);
  if (!tag) return;
  const groups = state.settings.tagGroups || [];
  const targets = sourceGroupId ? groups.filter(g => g.id !== sourceGroupId) : [...groups];

  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.style.cssText = 'position:fixed;z-index:9999;';

  const header = document.createElement('div');
  header.style.cssText = 'padding:4px 12px 2px;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-muted);pointer-events:none;';
  header.textContent = 'Move to group';
  menu.appendChild(header);

  if (sourceGroupId) {
    const btn = document.createElement('button');
    btn.textContent = '\u00a0Unsorted';
    btn.addEventListener('click', () => {
      hideTagChipMenu();
      moveTagToGroup(tag.id, null);
    });
    menu.appendChild(btn);
  }

  if (!targets.length) {
    const empty = document.createElement('button');
    empty.textContent = sourceGroupId ? 'No other groups' : 'No groups yet';
    empty.disabled = true;
    menu.appendChild(empty);
  } else {
    targets.forEach(group => {
      const btn = document.createElement('button');
      btn.style.display = 'flex';
      btn.style.alignItems = 'center';
      btn.style.gap = '7px';
      if (group.color) {
        const dot = document.createElement('span');
        dot.style.cssText = `width:8px;height:8px;border-radius:50%;background:${group.color};flex-shrink:0;`;
        btn.appendChild(dot);
      }
      btn.appendChild(document.createTextNode(group.name || '(unnamed)'));
      btn.addEventListener('click', () => {
        hideTagChipMenu();
        moveTagToGroup(tag.id, group.id);
      });
      menu.appendChild(btn);
    });
  }

  const divider = document.createElement('div');
  divider.style.cssText = 'height:1px;background:var(--border);margin:4px 0;';
  menu.appendChild(divider);

  const newGroupBtn = document.createElement('button');
  newGroupBtn.textContent = 'New group from tag\u2026';
  newGroupBtn.addEventListener('click', () => {
    hideTagChipMenu();
    createGroupAndMoveTag(tag.id);
  });
  menu.appendChild(newGroupBtn);

  const refBtn = document.createElement('button');
  refBtn.textContent = 'Find references\u2026';
  refBtn.addEventListener('click', () => { hideTagChipMenu(); openSearchModal({ tagId }); });
  menu.appendChild(refBtn);

  document.body.appendChild(menu);
  _tagChipMenu = menu;
  menu.style.left = '0';
  menu.style.top = '0';
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  menu.style.left = `${Math.min(x, window.innerWidth - mw - 4)}px`;
  menu.style.top  = `${Math.min(y, window.innerHeight - mh - 4)}px`;
  document.addEventListener('mousedown', _tagChipMenuOutside, true);
}

function mergeTags(sourceId, targetId) {
  const replaceIn = list => {
    if (!list) return;
    for (const item of list) {
      if (!item) continue;
      const replaceField = field => {
        if (!item[field]) return;
        if (!item[field].includes(sourceId)) return;
        item[field] = [...new Set(item[field].map(id => id === sourceId ? targetId : id))];
      };
      replaceField('tags');
      replaceField('sharedTags');
      if (item.children) replaceIn(item.children);
    }
  };
  for (const board of state.boards) {
    replaceIn(board.speedDial);
    for (const tab of getBoardTabs(board)) {
      for (const col of (tab.columns || [])) replaceIn(col.items);
      replaceIn(getBoardInbox(board, tab)?.items || []);
    }
  }
  replaceIn(state.essentials);
  deleteTag(sourceId);
}

function buildTagUsage(tagId) {
  const r = { boards: 0, folders: 0, bookmarks: 0 };
  const walk = items => {
    for (const item of (items || [])) {
      if (!item) continue;
      if ([...(item.tags || []), ...(item.sharedTags || [])].includes(tagId)) {
        if (item.type === 'folder') r.folders++;
        else r.bookmarks++;
      }
      if (item.children) walk(item.children);
    }
  };
  for (const board of state.boards) {
    if ([...(board.tags || []), ...(board.sharedTags || [])].includes(tagId)) r.boards++;
    walk(board.speedDial);
    for (const tab of getBoardTabs(board)) {
      for (const col of (tab.columns || [])) walk(col.items);
      walk(getBoardInbox(board, tab)?.items || []);
    }
  }
  walk(state.essentials);
  return r;
}

function tagUsageMessage(tagId, tagName) {
  const u = buildTagUsage(tagId);
  const parts = [];
  if (u.boards) parts.push(`${u.boards} board${u.boards > 1 ? 's' : ''}`);
  if (u.folders) parts.push(`${u.folders} folder${u.folders > 1 ? 's' : ''}`);
  if (u.bookmarks) parts.push(`${u.bookmarks} bookmark${u.bookmarks > 1 ? 's' : ''}`);
  const usage = parts.length ? `Used by: ${parts.join(', ')}.` : 'Not used by any items.';
  return `Delete tag "${tagName}"?\n${usage}`;
}

function buildTagCounts() {
  const counts = {};
  const tally = items => { for (const item of (items || [])) { [...(item?.tags || []), ...(item?.sharedTags || [])].forEach(t => { counts[t] = (counts[t] || 0) + 1; }); if (item?.children) tally(item.children); } };
  tally(state.essentials);
  for (const board of state.boards) {
    tally(board.speedDial);
    for (const tab of getBoardTabs(board)) {
      for (const col of (tab.columns || [])) tally(col.items);
      tally(getBoardInbox(board, tab)?.items || []);
    }
  }
  return counts;
}

function sortGroupTags(tagObjects, mode, counts) {
  if (!mode) return [...tagObjects];
  const list = [...tagObjects];
  if (mode === 'az') list.sort((a, b) => a.name.localeCompare(b.name));
  else if (mode === 'za') list.sort((a, b) => b.name.localeCompare(a.name));
  else if (mode === 'count') list.sort((a, b) => (counts[b.id] || 0) - (counts[a.id] || 0));
  return list;
}

function tagGroupChipOpts(group) {
  return {
    noAutocomplete: true,
    displayOf: id => getTagById(id)?.name || id,
    beforeRemove: (id, editMode) => {
      if (!editMode) deleteTagsWithConfirmation([id]);
      return false;
    },
    resolveInput: typed => {
      const lc = typed.toLowerCase();
      // Only reuse a tag already in this group — same name in another group is a separate tag
      const inGroup = (state.tags || []).find(t => t.name.toLowerCase() === lc && t.groupId === group.id);
      if (inGroup) return inGroup.id;
      return createTag(typed, null, null).id;
    }
  };
}

function getTagDragId(e) {
  return _tagDragTagId || e.dataTransfer?.getData('text/x-morpheus-tag-id') || e.dataTransfer?.getData('text/plain') || '';
}

let _tagDragPreview = null;
let _tagDragSourceChip = null;
let _tagDragTagId = null;

function getTagGroupColor(groupId) {
  if (!groupId) return 'var(--text-muted)';
  return (state.settings.tagGroups || []).find(g => g.id === groupId)?.color || '#6d7cff';
}

function setTagDropPreviewColor(groupId) {
  if (!_tagDragPreview) return;
  const color = getTagGroupColor(groupId);
  _tagDragPreview.style.background = groupId ? hexToRgba(color, 0.15) : 'var(--panel-muted)';
  _tagDragPreview.style.color = color;
  _tagDragPreview.style.borderColor = groupId ? color : 'var(--border)';
}

function createTagDropPreview(chip, groupId) {
  removeTagDropPreview();
  _tagDragPreview = chip.cloneNode(true);
  _tagDragPreview.classList.remove('dragging');
  _tagDragPreview.classList.add('tag-drag-preview', 'drag-preview');
  _tagDragPreview.draggable = false;
  setTagDropPreviewColor(groupId);
  return _tagDragPreview;
}

function removeTagDropPreview() {
  if (_tagDragPreview) {
    _tagDragPreview.remove();
    _tagDragPreview = null;
  }
}

function useTransparentTagDragImage(e) {
  const img = document.createElement('canvas');
  img.width = 1;
  img.height = 1;
  e.dataTransfer.setDragImage(img, 0, 0);
}

function getTagDropBeforeChip(wrapper, e, dragTagId) {
  const chips = Array.from(wrapper.querySelectorAll('.chip-live:not(.tag-drag-preview):not(.dragging)'))
    .filter(chip => chip.dataset.value !== dragTagId);
  for (const chip of chips) {
    const rect = chip.getBoundingClientRect();
    if (e.clientY < rect.top) return chip;
    const inRow = e.clientY <= rect.bottom;
    if (inRow && e.clientX < rect.left + rect.width / 2) return chip;
  }
  return null;
}

function placeTagDropPreview(targetEl, e, targetGroupId, dragTagId) {
  if (!_tagDragPreview && _tagDragSourceChip) createTagDropPreview(_tagDragSourceChip, targetGroupId);
  if (!_tagDragPreview) return null;
  setTagDropPreviewColor(targetGroupId);

  if (targetEl.classList.contains('chip-input-wrapper')) {
    const beforeChip = getTagDropBeforeChip(targetEl, e, dragTagId);
    const textInput = targetEl.querySelector('.chip-text-input');
    targetEl.insertBefore(_tagDragPreview, beforeChip || textInput || null);
    return beforeChip?.dataset.value || null;
  }

  const block = targetEl.closest('.tag-group-block');
  if (!block) return null;
  let collapsedPreviewRow = block.querySelector('.tag-collapsed-drop-preview');
  if (!collapsedPreviewRow) {
    collapsedPreviewRow = document.createElement('div');
    collapsedPreviewRow.className = 'chip-input-wrapper tag-collapsed-drop-preview';
    block.insertBefore(collapsedPreviewRow, targetEl.nextSibling);
  }
  collapsedPreviewRow.appendChild(_tagDragPreview);
  return null;
}

function getTagDropSurface(container, e) {
  if (container.classList.contains('chip-input-wrapper') || container.classList.contains('tag-group-header')) {
    return container;
  }
  const hoveredWrapper = eventTargetElement(e)?.closest('.chip-input-wrapper');
  if (hoveredWrapper && container.contains(hoveredWrapper)) return hoveredWrapper;
  const openWrapper = container.querySelector(':scope > .chip-input-wrapper');
  return openWrapper || container.querySelector(':scope > .tag-group-header') || container;
}

function cleanupTagDragState() {
  removeTagDropPreview();
  document.querySelectorAll('.tag-drop-target').forEach(el => el.classList.remove('tag-drop-target'));
  document.querySelectorAll('.tag-collapsed-drop-preview').forEach(el => el.remove());
  _tagDragSourceChip = null;
  _tagDragTagId = null;
}

function findLastTagIndexInGroup(groupId) {
  for (let i = (state.tags || []).length - 1; i >= 0; i--) {
    if ((state.tags[i].groupId || null) === (groupId || null)) return i;
  }
  return -1;
}

function moveTagToGroupAt(tagId, targetGroupId, beforeTagId) {
  const tag = getTagById(tagId);
  if (!tag) return;
  const targetGroup = targetGroupId ? (state.settings.tagGroups || []).find(g => g.id === targetGroupId) : null;
  if (targetGroupId && !targetGroup) return;
  if (targetGroup?.locked) return;

  const conflict = targetGroupId
    ? (state.tags || []).find(t => t.id !== tag.id && t.groupId === targetGroupId && t.name.toLowerCase() === tag.name.toLowerCase())
    : null;
  if (conflict) {
    showConfirmDialog(`Group "${targetGroup.name || '(unnamed)'}" already has a tag named "${tag.name}".\nMerge into it? All references will be updated.`, () => {
      pushUndoSnapshot();
      mergeTags(tag.id, conflict.id);
      saveState();
      updateUndoRedoUI();
      renderTagGroups();
    }, 'Merge');
    return;
  }

  const tags = state.tags || [];
  const oldIndex = tags.findIndex(t => t.id === tagId);
  if (oldIndex < 0) return;
  pushUndoSnapshot();
  const [moved] = tags.splice(oldIndex, 1);
  moved.groupId = targetGroupId || null;
  if (targetGroup) targetGroup.tagSort = null;

  let insertIndex = beforeTagId ? tags.findIndex(t => t.id === beforeTagId) : -1;
  if (insertIndex < 0) {
    const lastTargetIndex = findLastTagIndexInGroup(targetGroupId);
    insertIndex = lastTargetIndex >= 0 ? lastTargetIndex + 1 : tags.length;
  }
  tags.splice(insertIndex, 0, moved);
  saveState();
  updateUndoRedoUI();
  renderTagGroups();
}

function attachTagChipInteractions(wrapper, sourceGroupId) {
  const attach = chip => {
    if (chip.dataset.tagInteractions) return;
    chip.dataset.tagInteractions = '1';
    chip.draggable = true;
    chip.addEventListener('mousedown', e => {
      const removeBtn = eventTargetElement(e)?.closest('.chip-remove-btn');
      if (!removeBtn) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      chip.draggable = false;
      const restoreDraggable = () => {
        chip.draggable = true;
        document.removeEventListener('mouseup', restoreDraggable);
        document.removeEventListener('dragend', restoreDraggable);
      };
      document.addEventListener('mouseup', restoreDraggable, { once: true });
      document.addEventListener('dragend', restoreDraggable, { once: true });
    }, true);
    chip.addEventListener('contextmenu', e => {
      e.preventDefault();
      const tagId = chip.dataset.value;
      if (tagId) showTagChipContextMenu(e.clientX, e.clientY, tagId, sourceGroupId);
    });
    chip.addEventListener('dragstart', e => {
      const tagId = chip.dataset.value;
      if (!tagId) return;
      const sourceGroup = sourceGroupId ? (state.settings.tagGroups || []).find(g => g.id === sourceGroupId) : null;
      if (sourceGroup?.locked) {
        e.preventDefault();
        return;
      }
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/x-morpheus-tag-id', tagId);
      e.dataTransfer.setData('text/plain', tagId);
      useTransparentTagDragImage(e);
      _tagDragSourceChip = chip;
      _tagDragTagId = tagId;
      createTagDropPreview(chip, sourceGroupId);
      chip.classList.add('dragging');
    });
    chip.addEventListener('dragend', () => {
      chip.classList.remove('dragging');
      cleanupTagDragState();
    });
  };
  wrapper.querySelectorAll('.chip-live:not(.tag-drag-preview)').forEach(attach);
  new MutationObserver(() => wrapper.querySelectorAll('.chip-live:not(.tag-drag-preview)').forEach(attach))
    .observe(wrapper, { childList: true });
}

function configureTagDropTarget(wrapper, targetGroupId) {
  wrapper.addEventListener('dragover', e => {
    const tagId = getTagDragId(e);
    const tag = getTagById(tagId);
    if (!tag) return;
    const targetGroup = targetGroupId ? (state.settings.tagGroups || []).find(g => g.id === targetGroupId) : null;
    if (targetGroup?.locked) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const surface = getTagDropSurface(wrapper, e);
    surface.classList.add('tag-drop-target');
    placeTagDropPreview(surface, e, targetGroupId, tagId);
  });
  wrapper.addEventListener('dragleave', e => {
    if (!wrapper.contains(e.relatedTarget)) wrapper.classList.remove('tag-drop-target');
  });
  wrapper.addEventListener('drop', e => {
    const tagId = getTagDragId(e);
    if (!tagId) return;
    const surface = getTagDropSurface(wrapper, e);
    const beforeTagId = placeTagDropPreview(surface, e, targetGroupId, tagId);
    e.preventDefault();
    e.stopPropagation();
    surface.classList.remove('tag-drop-target');
    cleanupTagDragState();
    moveTagToGroupAt(tagId, targetGroupId, beforeTagId);
  });
}

function renderTagGroups() {
  if (!state.settings.tagGroups) state.settings.tagGroups = [];
  const list = document.getElementById('tagGroupList');
  ensureTagManagerDeleteDelegation();
  list.innerHTML = '';
  const groups = state.settings.tagGroups.map(normalizeTagGroupRecord);
  state.settings.tagGroups = groups;
  const tagCounts = buildTagCounts();

  if (!groups.length) {
    const empty = document.createElement('p');
    empty.className = 'settings-muted';
    empty.style.padding = '4px 0 8px';
    empty.textContent = 'No groups yet. Click + Add Group to create one.';
    list.appendChild(empty);
  }

  groups.forEach(group => {
    const block = document.createElement('div');
    block.className = 'tag-group-block';
    block.classList.toggle('collapsed', !!group.collapsed);
    block.dataset.groupId = group.id;

    // Header row
    const header = document.createElement('div');
    header.className = 'tag-group-header';

    const collapseBtn = document.createElement('button');
    collapseBtn.type = 'button';
    collapseBtn.className = 'icon-btn tag-group-collapse-btn';
    collapseBtn.title = group.collapsed ? 'Expand group' : 'Collapse group';
    collapseBtn.innerHTML = '<svg width="12" height="12" aria-hidden="true"><use href="#icon-chevron-down"/></svg>';
    collapseBtn.addEventListener('click', () => {
      group.collapsed = !group.collapsed;
      saveState();
      renderTagGroups();
    });

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'tag-group-name-input';
    nameInput.value = group.name || '';
    nameInput.placeholder = 'Group name';
    nameInput.disabled = !!group.locked;
    nameInput.addEventListener('focus', () => pushUndoSnapshot());
    nameInput.addEventListener('input', () => { group.name = nameInput.value; saveState(); updateUndoRedoUI(); });
    if (_focusTagGroupId === group.id) {
      requestAnimationFrame(() => {
        nameInput.focus();
        nameInput.select();
      });
      _focusTagGroupId = null;
    }

    // Sort button
    const sortBtn = document.createElement('button');
    sortBtn.type = 'button';
    sortBtn.className = 'icon-btn tag-group-sort-btn';
    sortBtn.title = group.tagSort ? `Sort: ${TAG_SORT_LABELS[group.tagSort]}` : 'Sort tags';
    sortBtn.classList.toggle('active', !!group.tagSort);
    sortBtn.innerHTML = '<svg width="14" height="14" aria-hidden="true"><use href="#icon-sort"/></svg>';
    sortBtn.addEventListener('click', () => showTagSortMenu(sortBtn, group));

    // Color swatch + hidden native color picker
    const colorWrap = document.createElement('span');
    colorWrap.className = 'tag-group-color-wrap';
    const colorSwatch = document.createElement('button');
    colorSwatch.type = 'button';
    colorSwatch.className = 'tag-group-color-swatch';
    colorSwatch.style.background = group.color || '#6d7cff';
    colorSwatch.title = 'Pick group color';
    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.value = group.color || '#6d7cff';
    colorInput.style.cssText = 'position:absolute;opacity:0;pointer-events:none;width:0;height:0;';
    colorSwatch.addEventListener('click', () => { pushUndoSnapshot(); colorInput.click(); });
    colorInput.addEventListener('input', () => {
      group.color = colorInput.value;
      colorSwatch.style.background = colorInput.value;
      block.querySelectorAll('.chip-live').forEach(chip => applyGroupColor(chip, colorInput.value));
      saveState();
      updateUndoRedoUI();
    });
    colorWrap.appendChild(colorSwatch);
    colorWrap.appendChild(colorInput);

    // Lock toggle
    const lockWrap = document.createElement('span');
    lockWrap.className = 'tag-group-lock-wrap';
    const lockLbl = document.createElement('span');
    lockLbl.className = 'settings-muted';
    lockLbl.textContent = 'Lock';
    const lockToggle = document.createElement('label');
    lockToggle.className = 'settings-toggle';
    const lockCheck = document.createElement('input');
    lockCheck.type = 'checkbox';
    lockCheck.checked = !!group.locked;
    const lockTrack = document.createElement('span');
    lockTrack.className = 'toggle-track';
    lockToggle.appendChild(lockCheck);
    lockToggle.appendChild(lockTrack);
    lockCheck.addEventListener('change', () => {
      pushUndoSnapshot();
      group.locked = lockCheck.checked;
      setGroupLocked(block, group.locked);
      saveState();
      updateUndoRedoUI();
    });
    lockWrap.appendChild(lockLbl);
    lockWrap.appendChild(lockToggle);

    // Delete button — moves group's tags to unsorted, then removes group
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'icon-btn tag-group-del-btn';
    delBtn.title = 'Delete group';
    delBtn.textContent = '×';
    delBtn.disabled = !!group.locked;
    delBtn.addEventListener('click', () => {
      const groupTagCount = (state.tags || []).filter(t => t.groupId === group.id).length;
      confirmDeleteTagGroup(group, groupTagCount, () => {
        pushUndoSnapshot();
        const groupTagIds = (state.tags || []).filter(t => t.groupId === group.id).map(t => t.id);
        groupTagIds.forEach(deleteTag);
        state.settings.tagGroups = state.settings.tagGroups.filter(g => g.id !== group.id);
        saveState();
        updateUndoRedoUI();
        renderTagGroups();
      });
    });

    header.appendChild(collapseBtn);
    header.appendChild(nameInput);
    header.appendChild(sortBtn);
    header.appendChild(colorWrap);
    header.appendChild(lockWrap);
    header.appendChild(delBtn);
    if (group.collapsed) configureTagDropTarget(header, group.id);

    // Tag chip input — IDs stored in hidden input, names displayed as chips
    const groupTagObjs = (state.tags || []).filter(t => t.groupId === group.id);
    const sortedTagObjs = sortGroupTags(groupTagObjs, group.tagSort, tagCounts);

    const hiddenInput = document.createElement('input');
    hiddenInput.type = 'text';
    hiddenInput.placeholder = 'Add tags…';
    hiddenInput.value = sortedTagObjs.map(t => t.id).join(' ');

    block.appendChild(header);
    if (!group.collapsed) block.appendChild(hiddenInput);
    list.appendChild(block);
    configureTagDropTarget(block, group.id);

    if (!group.collapsed) {
      initChipInput(hiddenInput, tagGroupChipOpts(group));

      const wrapper = block.querySelector('.chip-input-wrapper');
      if (wrapper) {
        const color = group.color || '#6d7cff';
        wrapper.querySelectorAll('.chip-live').forEach(chip => applyGroupColor(chip, color));
        const observer = new MutationObserver(() => {
          wrapper.querySelectorAll('.chip-live').forEach(chip => applyGroupColor(chip, group.color || '#6d7cff'));
        });
        observer.observe(wrapper, { childList: true });
        attachTagChipInteractions(wrapper, group.id);
        configureTagDropTarget(wrapper, group.id);
        if (group.locked) {
          const textInput = wrapper.querySelector('.chip-text-input');
          if (textInput) textInput.disabled = true;
        }
      }

      let currentIds = new Set(sortedTagObjs.map(t => t.id));
      hiddenInput.addEventListener('input', () => {
        const newIds = new Set(hiddenInput.value.trim().split(/\s+/).filter(Boolean));
        const removed = [...currentIds].filter(id => !newIds.has(id));
        if (removed.length) {
          hiddenInput.value = [...currentIds].join(' ');
          deleteTagsWithConfirmation(removed);
          return;
        }
        pushUndoSnapshot();
        // Assign all chip IDs to this group
        newIds.forEach(id => {
          const tag = getTagById(id);
          if (tag) tag.groupId = group.id;
        });
        saveState();
        updateUndoRedoUI();
        if (removed.length) renderTagGroups();
        else currentIds = newIds;
      });
    }
  });

  // --- Unsorted block (always shown) ---
  const unsorted = (state.tags || []).filter(t => !t.groupId).sort((a, b) => a.name.localeCompare(b.name));
  const orphans = (state.tags || []).filter(t => !tagCounts[t.id] && !t.groupId);

  const uBlock = document.createElement('div');
  uBlock.className = 'tag-group-block tag-group-block--unsorted';

  const uHeader = document.createElement('div');
  uHeader.className = 'tag-group-header';
  const uLabel = document.createElement('span');
  uLabel.className = 'tag-group-name-input tag-group-name--readonly';
  uLabel.textContent = '\u00a0Unsorted';
  uHeader.appendChild(uLabel);

  if (orphans.length) {
    const cleanBtn = document.createElement('button');
    cleanBtn.type = 'button';
    cleanBtn.className = 'tag-orphan-clean-btn';
    cleanBtn.textContent = `\u00d7 ${orphans.length} orphan${orphans.length > 1 ? 's' : ''}`;
    cleanBtn.title = 'Remove tags not used by any item';
    cleanBtn.addEventListener('click', () => {
      const n = orphans.length;
      confirmDelete('confirmDeleteTag', `Remove ${n} unused tag${n > 1 ? 's' : ''}?`, () => {
        pushUndoSnapshot();
        orphans.forEach(t => deleteTag(t.id));
        saveState();
        updateUndoRedoUI();
        renderTagGroups();
      });
    });
    uHeader.appendChild(cleanBtn);
  }

  uBlock.appendChild(uHeader);

  const hiddenInput = document.createElement('input');
  hiddenInput.type = 'text';
  hiddenInput.placeholder = 'Add unsorted tags…';
  hiddenInput.value = unsorted.map(t => t.id).join(' ');
  uBlock.appendChild(hiddenInput);
  initChipInput(hiddenInput, {
    noAutocomplete: true,
    displayOf: id => getTagById(id)?.name || id,
    beforeRemove: (id, editMode) => {
      if (!editMode) deleteTagsWithConfirmation([id]);
      return false;
    },
    resolveInput: typed => {
      const lc = typed.toLowerCase();
      const existing = (state.tags || []).find(t => t.name.toLowerCase() === lc && !t.groupId);
      if (existing) return existing.id;
      return createTag(typed, null, null).id;
    }
  });
  configureTagDropTarget(uBlock, null);
  const wrapper = uBlock.querySelector('.chip-input-wrapper');
  if (wrapper) {
    wrapper.classList.add('tag-group-unsorted-chips');
    attachTagChipInteractions(wrapper, null);
    configureTagDropTarget(wrapper, null);
    if (!unsorted.length) {
      const placeholder = document.createElement('span');
      placeholder.className = 'settings-muted tag-group-empty-note';
      placeholder.textContent = 'No unsorted tags.';
      wrapper.insertBefore(placeholder, wrapper.querySelector('.chip-text-input'));
    }
  }
  let currentIds = new Set(unsorted.map(t => t.id));
  hiddenInput.addEventListener('input', () => {
    const nextIds = new Set(hiddenInput.value.trim().split(/\s+/).filter(Boolean));
    const removed = [...currentIds].filter(id => !nextIds.has(id));
    const added = [...nextIds].filter(id => !currentIds.has(id));
    if (removed.length) {
      hiddenInput.value = [...currentIds].join(' ');
      deleteTagsWithConfirmation(removed);
      return;
    }
    added.forEach(id => {
      const tag = getTagById(id);
      if (tag) tag.groupId = null;
    });
    if (added.length) {
      saveState();
      updateUndoRedoUI();
      renderTagGroups();
      return;
    }
    currentIds = nextIds;
  });
  list.appendChild(uBlock);
}

function attachSettingsListeners() {
  const ensureServiceApiKeySettings = () => {
    if (!state.settings.serviceApiKeys || typeof state.settings.serviceApiKeys !== 'object') {
      state.settings.serviceApiKeys = { nasa: '' };
    } else if (typeof state.settings.serviceApiKeys.nasa !== 'string') {
      state.settings.serviceApiKeys.nasa = '';
    }
  };

  document.getElementById('stgHubName').addEventListener('input', e => {
    state.hubName = e.target.value || 'Morpheus WebHub';
    elements.hubNameEl.textContent = state.hubName;
    document.title = state.hubName;
  });

  document.getElementById('stgApiKeyNasa').addEventListener('input', e => {
    ensureServiceApiKeySettings();
    state.settings.serviceApiKeys.nasa = e.target.value.trim();
  });

  document.querySelectorAll('input[name="stgGlobalFontScale"]').forEach(radio => {
    radio.addEventListener('change', e => {
      state.settings.globalFontScale = e.target.value;
      applySettings();
    });
  });
  document.getElementById('stgGlobalFontColor').addEventListener('input', e => {
    state.settings.globalFontColor = e.target.value;
    applySettings();
  });
  document.getElementById('stgGlobalThemeColor').addEventListener('change', e => {
    state.settings.globalFontColorFromTheme = e.target.checked;
    document.getElementById('stgGlobalFontColor').disabled = e.target.checked;
    applySettings();
  });
  document.getElementById('stgShowAdvancedStyle').addEventListener('change', e => {
    state.settings.showAdvancedStyleSettings = e.target.checked;
    updateStyleAdvancedUI();
    saveState();
  });
  document.querySelectorAll('[data-style-override]').forEach(input => {
    input.addEventListener('change', e => {
      ensureStyleSettings();
      state.settings.styleOverrides[e.target.dataset.styleOverride] = e.target.checked;
      updateStyleAdvancedUI();
      applySettings();
    });
  });

  const numSetting = (id, key, min, max) => {
    document.getElementById(id).addEventListener('input', e => {
      state.settings[key] = Math.min(max, Math.max(min, parseInt(e.target.value) || min));
      applySettings();
    });
  };

  numSetting('stgBoardFont',      'boardFontSize',      10, 24);
  numSetting('stgBookmarkFont',   'bookmarkFontSize',   10, 24);
  numSetting('stgFolderFont',     'folderFontSize',     10, 24);
  numSetting('stgTitleFont',      'titleFontSize',       8, 24);
  numSetting('stgBoardTitleFont', 'boardTitleFontSize', 14, 48);
  numSetting('stgHubNameFont',    'hubNameFontSize',    10, 48);

  const boolSetting = (id, key) => document.getElementById(id).addEventListener('change', e => {
    state.settings[key] = e.target.checked;
    saveState();
  });
  boolSetting('stgShowTags',                 'showTags');
  boolSetting('stgWarnOnClose',              'warnOnClose');
  boolSetting('stgSharedAutoRefreshNotice',  'sharedAutoRefreshNotice');
  boolSetting('stgConfirmDeleteBoard',       'confirmDeleteBoard');
  boolSetting('stgConfirmDeleteBookmark',    'confirmDeleteBookmark');
  boolSetting('stgConfirmDeleteFolder',      'confirmDeleteFolder');
  boolSetting('stgConfirmDeleteTitleDivider','confirmDeleteTitleDivider');
  boolSetting('stgConfirmDeleteTag',        'confirmDeleteTag');
  document.getElementById('stgShowTags').addEventListener('change', () => applySettings());

  const thicknessEl = document.getElementById('stgLineThicknessVal');
  document.getElementById('stgLineThicknessMinus').addEventListener('click', () => {
    if (state.settings.titleLineThickness > 1) { state.settings.titleLineThickness--; thicknessEl.textContent = state.settings.titleLineThickness; applySettings(); }
  });
  document.getElementById('stgLineThicknessPlus').addEventListener('click', () => {
    if (state.settings.titleLineThickness < 8) { state.settings.titleLineThickness++; thicknessEl.textContent = state.settings.titleLineThickness; applySettings(); }
  });

  const familySetting = (id, key) => document.getElementById(id).addEventListener('change', e => { state.settings[key] = e.target.value; applySettings(); });
  familySetting('stgHubNameFamily',    'hubNameFontFamily');
  familySetting('stgBoardTitleFamily', 'boardTitleFontFamily');
  familySetting('stgBoardFamily',      'boardFontFamily');
  familySetting('stgBookmarkFamily',   'bookmarkFontFamily');
  familySetting('stgFolderFamily',     'folderFontFamily');
  familySetting('stgTitleFamily',      'titleFontFamily');

  document.querySelectorAll('.fmt-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.settings[btn.dataset.fmt] = !state.settings[btn.dataset.fmt];
      btn.classList.toggle('active', state.settings[btn.dataset.fmt]);
      applySettings();
    });
  });

  document.querySelectorAll('.align-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.alignKey;
      state.settings[key] = btn.dataset.alignVal;
      document.querySelectorAll(`.align-btn[data-align-key="${key}"]`).forEach(b => b.classList.toggle('active', b.dataset.alignVal === btn.dataset.alignVal));
      applySettings();
    });
  });

  Object.entries(COLOR_DEFAULTS).forEach(([key]) => {
    const inputId = 'stg' + key[0].toUpperCase() + key.slice(1);
    document.getElementById(inputId).addEventListener('input', e => { state.settings[key] = e.target.value; applySettings(); });
  });
  document.querySelectorAll('.color-reset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.colorKey;
      state.settings[key] = '';
      document.getElementById('stg' + key[0].toUpperCase() + key.slice(1)).value = COLOR_DEFAULTS[key];
      applySettings();
    });
  });

  document.getElementById('stgTitleLineStyle').addEventListener('change', e => { state.settings.titleLineStyle = e.target.value; applySettings(); });

  document.getElementById('stgShowEssentials').addEventListener('change', e => {
    state.settings.showEssentials = e.target.checked;
    renderEssentials();
    saveState();
  });

  const essCountEl = document.getElementById('stgEssCountVal');
  document.getElementById('stgEssCountMinus').addEventListener('click', () => {
    if (state.settings.essentialsDisplayCount > 1) { state.settings.essentialsDisplayCount--; essCountEl.textContent = state.settings.essentialsDisplayCount; updateEssentialsWarning(); renderEssentials(); saveState(); }
  });
  document.getElementById('stgEssCountPlus').addEventListener('click', () => {
    if (state.settings.essentialsDisplayCount < 24) { state.settings.essentialsDisplayCount++; essCountEl.textContent = state.settings.essentialsDisplayCount; updateEssentialsWarning(); renderEssentials(); saveState(); }
  });

  document.querySelectorAll('input[name="stgSpeedDialSize"]').forEach(radio => {
    radio.addEventListener('change', e => { state.settings.speedDialIconSize = e.target.value; applySettings(); saveState(); });
  });
  document.querySelectorAll('input[name="stgEssentialsSize"]').forEach(radio => {
    radio.addEventListener('change', e => { state.settings.essentialsIconSize = e.target.value; applySettings(); saveState(); });
  });

  document.querySelectorAll('.settings-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.settings-tab').forEach(t => t.classList.toggle('active', t === tab));
      const body = document.querySelector('.settings-body[data-active-tab]');
      if (body) body.dataset.activeTab = tab.dataset.tab;
    });
  });

  document.getElementById('stgNewThemeBtn').addEventListener('click', () => createNewThemeDraft());
  document.getElementById('stgDuplicateThemeBtn').addEventListener('click', async () => { await duplicateThemeDraft(); });
  document.getElementById('stgDeleteThemeBtn').addEventListener('click', async () => { await deleteThemeDraft(); });
  document.getElementById('stgSaveThemeBtn').addEventListener('click', async () => { await saveThemeDraft(); });
  document.getElementById('stgSaveThemeAsBtn').addEventListener('click', async () => { await saveThemeDraftAs(); });

  document.getElementById('stgAddGroupBtn').addEventListener('click', () => {
    if (!state.settings.tagGroups) state.settings.tagGroups = [];
    pushUndoSnapshot();
    const group = createTagGroupRecord();
    state.settings.tagGroups.push(group);
    _focusTagGroupId = group.id;
    saveState();
    updateUndoRedoUI();
    renderTagGroups();
  });

  document.getElementById('stgUndoBtn').addEventListener('click', () => { undo(); renderTagGroups(); });
  document.getElementById('stgRedoBtn').addEventListener('click', () => { redo(); renderTagGroups(); });

  document.getElementById('settingsDoneBtn').addEventListener('click', hideSettingsPanel);
  document.getElementById('tagManagerDoneBtn')?.addEventListener('click', hideTagManagerPanel);

  const databasePathInput = document.getElementById('stgDatabasePath');
  const applyDatabasePath = async path => {
    const trimmed = (path || '').trim();
    if (typeof bridge === 'undefined') return;
    await bridge.whenReady;
    if (!bridge.nativeIsAvailable()) {
      showNotice('Shared database paths require the native messaging host.');
      return;
    }
    if (!trimmed) {
      showNotice('Choose or enter a path for the shared database JSON file.');
      return;
    }
    const res = await bridge.setDatabasePath(trimmed);
    if (!res?.databasePath) {
      showNotice('Failed to update the shared database path.');
      return;
    }
    _pendingDatabasePath = '';
    state.databasePath = res.databasePath;
    resetSharedDiskBaseline(res.databasePath);
    saveState({ skipDiskSync: true });
    await updateDatabasePathControls();
    await updateAboutBridgeStatus();
    if (typeof startSharedDiskPolling === 'function') startSharedDiskPolling();
  };

  databasePathInput.addEventListener('input', () => {
    _pendingDatabasePath = databasePathInput.value.trim();
  });

  document.getElementById('stgDatabasePathApply').addEventListener('click', async () => {
    await applyDatabasePath(databasePathInput.value);
  });

  document.getElementById('stgDatabasePathBrowse').addEventListener('click', async () => {
    if (typeof bridge === 'undefined') return;
    await bridge.whenReady;
    if (!bridge.nativeIsAvailable()) {
      showNotice('Shared database paths require the native messaging host.');
      return;
    }
    const picked = await bridge.pickDatabasePath('Choose shared database location', 'morpheus-webhub.json');
    if (!picked?.path) {
      showNotice(picked?.error
        ? `No path was returned from the extension: ${picked.error}`
        : 'No path was returned from the extension. If the popup still says connected, reload the hub page and try again.');
      return;
    }
    _pendingDatabasePath = picked.path;
    databasePathInput.value = picked.path;
    await updateDatabasePathControls();
  });

  document.getElementById('stgExportBtn').addEventListener('click', () => {
    state.lastExported = new Date().toISOString();
    saveState();
    isDirty = false;
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `morpheus-webhub-${state.lastExported.slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    updateLastExportedLabel();
  });

  const importFile = document.getElementById('stgImportFile');
  document.getElementById('stgImportBtn').addEventListener('click', () => importFile.click());
  document.getElementById('stgReloadHubBtn').addEventListener('click', () => {
    if (typeof reloadHubDataManually === 'function') reloadHubDataManually();
  });
  importFile.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async ev => {
      try {
        const parsed = JSON.parse(ev.target.result);
        if (!parsed.boards || !parsed.navItems) { alert('Invalid file: not a Morpheus WebHub export.'); return; }
        if (parsed.databasePath && typeof bridge !== 'undefined') {
          await bridge.whenReady;
          if (bridge.nativeIsAvailable()) await bridge.setDatabasePath(parsed.databasePath);
        }
        localStorage.setItem('morpheus-webhub-state', ev.target.result);
        location.reload();
      } catch { alert('Failed to read file. Make sure it is a valid JSON export.'); }
    };
    reader.readAsText(file);
    importFile.value = '';
  });
}
