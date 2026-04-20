// --- Board settings panel ---

let boardSettingsCreatingId = null;

function showBoardSettingsPanel(isNew = false) {
  const board = getActiveBoard();
  if (!board) return;
  if (!isNew) pushUndoSnapshot();
  boardSettingsCreatingId = isNew ? board.id : null;
  document.getElementById('modalCard').classList.add('hidden');
  const panel = document.getElementById('boardSettingsPanel');
  document.getElementById('boardSettingsDoneBtn').textContent = isNew ? 'Create' : 'OK';
  document.getElementById('boardSettingsCancelBtn').classList.toggle('hidden', !isNew);
  panel.classList.remove('hidden');
  elements.modalOverlay.classList.remove('hidden');
  centerPanel(panel);
  makeDraggable(panel, document.getElementById('bstgHeader'));
  document.getElementById('bstgTitle').value = board.title;
  const colRadio = document.querySelector(`input[name="bstgCols"][value="${board.columnCount}"]`);
  if (colRadio) colRadio.checked = true;
  document.getElementById('bstgBgUrl').value = board.backgroundImage || '';
  document.getElementById('bstgOpacity').value = board.containerOpacity ?? 100;
  document.getElementById('bstgOpacityVal').textContent = board.containerOpacity ?? 100;
  document.getElementById('bstgShowSpeedDial').checked = board.showSpeedDial !== false;
  document.getElementById('bstgTags').value = (board.tags || []).join(' ');
  document.getElementById('bstgSharedTags').value = (board.sharedTags || []).join(' ');
  document.getElementById('bstgInheritTags').checked = board.inheritTags !== false;
  document.getElementById('bstgAutoRemove').checked = board.autoRemoveTags === true;
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
  document.getElementById('boardSettingsDoneBtn').textContent = 'OK';
  document.getElementById('boardSettingsPanel').classList.add('hidden');
  document.getElementById('modalCard').classList.remove('hidden');
  elements.modalOverlay.classList.add('hidden');
  boardSettingsCreatingId = null;
  saveState();
}

function cancelBoardSettingsPanel() {
  if (boardSettingsCreatingId) {
    const navItem = findNavBoardItem(boardSettingsCreatingId);
    if (navItem) deleteBoardAndNavItem(navItem.id, boardSettingsCreatingId);
    renderAll();
    saveState();
  }
  hideBoardSettingsPanel();
}

function attachBoardSettingsListeners() {
  document.getElementById('bstgTitle').addEventListener('input', e => {
    const board = getActiveBoard();
    if (!board) return;
    board.title = e.target.value;
    elements.boardTitle.textContent = board.title;
    const findNavItem = (items) => { for (const i of items) { if (i.boardId === board.id) return i; if (i.children) { const f = findNavItem(i.children); if (f) return f; } } return null; };
    const navItem = findNavItem(state.navItems);
    if (navItem) navItem.title = board.title;
    renderNav();
  });

  document.querySelectorAll('input[name="bstgCols"]').forEach(radio => {
    radio.addEventListener('change', e => {
      const board = getActiveBoard();
      if (!board) return;
      const newCount = parseInt(e.target.value, 10) || 3;
      const regularCols = board.columns.filter(c => !c.isInbox);
      const inboxCol = board.columns.find(c => c.isInbox);
      if (newCount < regularCols.length) {
        const removed = regularCols.slice(newCount);
        const lastKept = regularCols[newCount - 1];
        for (const col of removed) lastKept.items.push(...col.items);
        board.columns = [...regularCols.slice(0, newCount), ...(inboxCol ? [inboxCol] : [])];
      } else {
        while (regularCols.length < newCount) {
          regularCols.push({ id: `col-${Date.now()}-${regularCols.length + 1}`, title: `Column ${regularCols.length + 1}`, items: [] });
        }
        board.columns = [...regularCols, ...(inboxCol ? [inboxCol] : [])];
      }
      board.columnCount = newCount;
      renderBoard();
    });
  });

  const applyBg = () => { const board = getActiveBoard(); if (board) applyBoardBackground(board); };

  document.getElementById('bstgBgUrl').addEventListener('input', e => {
    const board = getActiveBoard();
    if (!board) return;
    board.backgroundImage = e.target.value.trim();
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
      const board = getActiveBoard();
      if (!board) return;
      board.backgroundImage = ev.target.result;
      document.getElementById('bstgBgUrl').value = '';
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
    const board = getActiveBoard();
    if (!board) return;
    board.backgroundImage = result.dataUrl;
    document.getElementById('bstgBgUrl').value = '';
    applyBg();
  });

  document.getElementById('bstgBgClear').addEventListener('click', () => {
    const board = getActiveBoard();
    if (!board) return;
    board.backgroundImage = '';
    document.getElementById('bstgBgUrl').value = '';
    applyBg();
  });

  document.getElementById('bstgOpacity').addEventListener('input', e => {
    const board = getActiveBoard();
    if (!board) return;
    board.containerOpacity = parseInt(e.target.value);
    document.getElementById('bstgOpacityVal').textContent = board.containerOpacity;
    applyBg();
  });

  document.getElementById('bstgShowSpeedDial').addEventListener('change', e => {
    const board = getActiveBoard();
    if (!board) return;
    board.showSpeedDial = e.target.checked;
    renderBoard();
  });

  const bstgSharedTagsEl = document.getElementById('bstgSharedTags');
  bstgSharedTagsEl.addEventListener('input', e => {
    const board = getActiveBoard();
    if (!board) return;
    board.sharedTags = e.target.value.trim().split(/\s+/).filter(Boolean);
    renderBoard();
  });
  initChipInput(bstgSharedTagsEl);

  const bstgTagsEl = document.getElementById('bstgTags');
  bstgTagsEl.addEventListener('input', e => {
    const board = getActiveBoard();
    if (!board) return;
    board.tags = e.target.value.trim().split(/\s+/).filter(Boolean);
  });
  initChipInput(bstgTagsEl);

  document.getElementById('bstgInheritTags').addEventListener('change', e => {
    const board = getActiveBoard();
    if (!board) return;
    board.inheritTags = e.target.checked;
    renderBoard();
  });

  document.getElementById('bstgAutoRemove').addEventListener('change', e => {
    const board = getActiveBoard();
    if (!board) return;
    board.autoRemoveTags = e.target.checked;
  });

  document.getElementById('boardSettingsDoneBtn').addEventListener('click', hideBoardSettingsPanel);
  document.getElementById('boardSettingsCancelBtn').addEventListener('click', cancelBoardSettingsPanel);
}

// --- Theme picker ---

async function renderThemePicker() {
  const container = document.getElementById('stgThemePicker');
  const hint = document.getElementById('stgThemeHint');
  const active = state.settings.activeThemeName || 'default-dark';

  let diskThemes = [];
  if (typeof bridge !== 'undefined' && bridge.nativeIsAvailable()) {
    diskThemes = await bridge.listThemes();
    const count = diskThemes.length;
    hint.textContent = count ? `${count} theme${count !== 1 ? 's' : ''} in ./themes/` : '';
  } else {
    hint.textContent = '';
  }

  const allThemes = [...getAllThemes()];
  for (const dt of diskThemes) {
    if (!allThemes.find(t => t.id === dt.id)) allThemes.push(dt);
  }

  container.innerHTML = '';
  for (const theme of allThemes) {
    const card = document.createElement('div');
    card.className = 'theme-card' + (theme.id === active ? ' active' : '');
    card.dataset.themeId = theme.id;

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

    if (!theme.builtin) {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'theme-delete-btn';
      del.title = 'Delete theme';
      del.textContent = '×';
      del.addEventListener('click', e => {
        e.stopPropagation();
        state.settings.customThemes = (state.settings.customThemes || []).filter(t => t.id !== theme.id);
        if (state.settings.activeThemeName === theme.id) {
          state.settings.activeThemeName = 'default-dark';
          applyTheme(getThemeById('default-dark'));
        }
        saveState();
        renderThemePicker();
      });
      card.appendChild(del);
    }

    card.addEventListener('click', () => {
      state.settings.activeThemeName = theme.id;
      applyTheme(theme);
      saveState();
      container.querySelectorAll('.theme-card').forEach(c =>
        c.classList.toggle('active', c.dataset.themeId === theme.id));
    });

    container.appendChild(card);
  }
}


// --- Global settings panel ---

const COLOR_DEFAULTS = {
  hubNameColor: '#e5e7eb', boardTitleColor: '#e5e7eb', boardColor: '#e5e7eb',
  bookmarkColor: '#e5e7eb', folderColor: '#e5e7eb', titleColor: '#9ca3af', titleLineColor: '#3a3c42'
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

function showSettingsPanel() {
  document.getElementById('modalCard').classList.add('hidden');
  const panel = document.getElementById('settingsPanel');
  panel.classList.remove('hidden');
  elements.modalOverlay.classList.remove('hidden');
  centerPanel(panel);
  makeDraggable(panel, document.getElementById('stgDragHandle'));
  const s = state.settings;
  document.getElementById('stgHubName').value = state.hubName || '';
  document.getElementById('stgBookmarkFont').value = s.bookmarkFontSize;
  document.getElementById('stgShowTags').checked = s.showTags;
  document.getElementById('stgWarnOnClose').checked = s.warnOnClose;
  document.getElementById('stgConfirmDeleteBoard').checked = s.confirmDeleteBoard;
  document.getElementById('stgConfirmDeleteBookmark').checked = s.confirmDeleteBookmark;
  document.getElementById('stgConfirmDeleteFolder').checked = s.confirmDeleteFolder;
  document.getElementById('stgConfirmDeleteTitleDivider').checked = s.confirmDeleteTitleDivider;
  document.getElementById('stgFolderFont').value = s.folderFontSize;
  document.getElementById('stgTitleFont').value = s.titleFontSize;
  document.getElementById('stgLineThicknessVal').textContent = s.titleLineThickness;
  document.getElementById('stgBoardTitleFont').value = s.boardTitleFontSize;
  document.getElementById('stgBoardFont').value = s.boardFontSize;
  populateFontSelects();
  document.getElementById('stgHubNameFont').value      = s.hubNameFontSize || 18;
  document.getElementById('stgHubNameFamily').value    = s.hubNameFontFamily || '';
  document.getElementById('stgBoardTitleFamily').value = s.boardTitleFontFamily || '';
  document.getElementById('stgBoardFamily').value      = s.boardFontFamily || '';
  document.getElementById('stgBookmarkFamily').value   = s.bookmarkFontFamily || '';
  document.getElementById('stgFolderFamily').value     = s.folderFontFamily || '';
  document.getElementById('stgTitleFamily').value      = s.titleFontFamily || '';
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
  renderThemePicker();
}

function hideSettingsPanel() {
  document.getElementById('settingsPanel').classList.add('hidden');
  document.getElementById('modalCard').classList.remove('hidden');
  elements.modalOverlay.classList.add('hidden');
  saveState();
}

function populateTagColors() {
  const tags = new Set();
  const walk = items => { for (const item of (items || [])) { if (item?.tags) item.tags.forEach(t => tags.add(t)); if (item?.children) walk(item.children); } };
  walk(state.essentials);
  for (const board of state.boards) { walk(board.speedDial); for (const col of board.columns) walk(col.items); }

  const container = document.getElementById('stgTagColors');
  container.innerHTML = '';
  if (!tags.size) {
    const empty = document.createElement('span');
    empty.className = 'settings-muted';
    empty.textContent = 'No tags in use yet.';
    container.appendChild(empty);
    return;
  }
  [...tags].sort().forEach(tag => {
    const row = document.createElement('div');
    row.className = 'tag-color-row';
    const label = document.createElement('span');
    label.textContent = tag;
    const group = document.createElement('div');
    group.className = 'color-picker-group';
    const input = document.createElement('input');
    input.type = 'color';
    input.className = 'color-input';
    input.value = state.settings.tagColors[tag] || '#6d7cff';
    input.addEventListener('input', e => { state.settings.tagColors[tag] = e.target.value; renderAll(); saveState(); });
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'color-reset-btn';
    reset.title = 'Reset to default';
    reset.textContent = '×';
    reset.addEventListener('click', () => { delete state.settings.tagColors[tag]; input.value = '#6d7cff'; renderAll(); saveState(); });
    group.appendChild(input);
    group.appendChild(reset);
    row.appendChild(label);
    row.appendChild(group);
    container.appendChild(row);
  });
}

function attachSettingsListeners() {
  document.getElementById('stgHubName').addEventListener('input', e => {
    state.hubName = e.target.value || 'Morpheus WebHub';
    elements.hubNameEl.textContent = state.hubName;
    document.title = state.hubName;
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

  const boolSetting = (id, key) => document.getElementById(id).addEventListener('change', e => { state.settings[key] = e.target.checked; });
  boolSetting('stgShowTags',                 'showTags');
  boolSetting('stgWarnOnClose',              'warnOnClose');
  boolSetting('stgConfirmDeleteBoard',       'confirmDeleteBoard');
  boolSetting('stgConfirmDeleteBookmark',    'confirmDeleteBookmark');
  boolSetting('stgConfirmDeleteFolder',      'confirmDeleteFolder');
  boolSetting('stgConfirmDeleteTitleDivider','confirmDeleteTitleDivider');
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

  document.getElementById('stgSaveThemeBtn').addEventListener('click', async () => {
    const name = prompt('Theme name:');
    if (!name?.trim()) return;
    const cs = getComputedStyle(document.documentElement);
    const get = v => cs.getPropertyValue(v).trim();
    const id = name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const theme = {
      id, name: name.trim(), builtin: false,
      colorScheme: document.documentElement.style.colorScheme || 'dark',
      colors: {
        bg: get('--bg'), panel: get('--panel'), panelStrong: get('--panel-strong'),
        panelMuted: get('--panel-muted'), border: get('--border'),
        text: get('--text'), textMuted: get('--text-muted'),
        accent: get('--accent'), accentStrong: get('--accent-strong'),
        danger: get('--danger'), radius: get('--radius'), shadow: get('--shadow')
      }
    };
    if (!state.settings.customThemes) state.settings.customThemes = [];
    const idx = state.settings.customThemes.findIndex(t => t.id === id);
    if (idx >= 0) state.settings.customThemes[idx] = theme;
    else state.settings.customThemes.push(theme);
    state.settings.activeThemeName = id;
    saveState();
    if (typeof bridge !== 'undefined' && bridge.nativeIsAvailable()) await bridge.saveTheme(theme);
    renderThemePicker();
  });

  document.getElementById('settingsDoneBtn').addEventListener('click', hideSettingsPanel);

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
  importFile.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const parsed = JSON.parse(ev.target.result);
        if (!parsed.boards || !parsed.navItems) { alert('Invalid file: not a Morpheus WebHub export.'); return; }
        localStorage.setItem('morpheus-webhub-state', ev.target.result);
        location.reload();
      } catch { alert('Failed to read file. Make sure it is a valid JSON export.'); }
    };
    reader.readAsText(file);
    importFile.value = '';
  });
}
