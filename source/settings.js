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
  const inCollection = !!findBoardCollection(board.id);
  const sdNote = document.getElementById('bstgCollectionSpeedDialNote');
  if (sdNote) sdNote.classList.toggle('hidden', !inCollection);
  document.getElementById('bstgShowSpeedDial').disabled = inCollection;
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
  initChipInput(bstgSharedTagsEl, tagChipOpts());

  const bstgTagsEl = document.getElementById('bstgTags');
  bstgTagsEl.addEventListener('input', e => {
    const board = getActiveBoard();
    if (!board) return;
    board.tags = e.target.value.trim().split(/\s+/).filter(Boolean);
  });
  initChipInput(bstgTagsEl, tagChipOpts());

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
  bookmarkColor: '#e5e7eb', folderColor: '#e5e7eb', collectionColor: '#e5e7eb',
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

function populateFontSelects() {
  ['stgHubNameFamily','stgBoardTitleFamily','stgBoardFamily','stgBookmarkFamily','stgFolderFamily','stgCollectionFamily','stgTitleFamily'].forEach(id => {
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

function showSettingsPanel(tab = 'general') {
  document.getElementById('modalCard').classList.add('hidden');
  const panel = document.getElementById('settingsPanel');
  panel.classList.remove('hidden');
  elements.modalOverlay.classList.remove('hidden');
  centerPanel(panel);
  makeDraggable(panel, document.getElementById('stgDragHandle'));
  const targetTab = panel.querySelector(`.settings-tab[data-tab="${tab}"]`);
  if (targetTab) {
    panel.querySelectorAll('.settings-tab').forEach(t => t.classList.toggle('active', t === targetTab));
    const body = panel.querySelector('.settings-body[data-active-tab]');
    if (body) body.dataset.activeTab = tab;
  }
  const s = state.settings;
  document.getElementById('stgHubName').value = state.hubName || '';
  document.getElementById('stgBookmarkFont').value = s.bookmarkFontSize;
  document.getElementById('stgShowTags').checked = s.showTags;
  document.getElementById('stgWarnOnClose').checked = s.warnOnClose;
  document.getElementById('stgConfirmDeleteBoard').checked = s.confirmDeleteBoard;
  document.getElementById('stgConfirmDeleteBookmark').checked = s.confirmDeleteBookmark;
  document.getElementById('stgConfirmDeleteFolder').checked = s.confirmDeleteFolder;
  document.getElementById('stgConfirmDeleteTitleDivider').checked = s.confirmDeleteTitleDivider;
  document.getElementById('stgConfirmDeleteTag').checked = s.confirmDeleteTag;
  document.getElementById('stgFolderFont').value = s.folderFontSize;
  document.getElementById('stgCollectionFont').value = s.collectionFontSize || 15;
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
  document.getElementById('stgFolderFamily').value      = s.folderFontFamily || '';
  document.getElementById('stgCollectionFamily').value  = s.collectionFontFamily || '';
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
  renderThemePicker();
  renderTagGroups();
}

function hideSettingsPanel() {
  document.getElementById('settingsPanel').classList.add('hidden');
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
      pushUndoSnapshot();
      tag.groupId = null;
      saveState();
      updateUndoRedoUI();
      renderTagGroups();
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
        const conflict = (state.tags || []).find(t => t.id !== tag.id && t.groupId === group.id && t.name.toLowerCase() === tag.name.toLowerCase());
        if (conflict) {
          showConfirmDialog(`Group "${group.name || '(unnamed)'}" already has a tag named "${tag.name}".\nMerge into it? All references will be updated.`, () => {
            pushUndoSnapshot();
            mergeTags(tag.id, conflict.id);
            saveState();
            updateUndoRedoUI();
            renderTagGroups();
          }, 'Merge');
          return;
        }
        pushUndoSnapshot();
        tag.groupId = group.id;
        saveState();
        updateUndoRedoUI();
        renderTagGroups();
      });
      menu.appendChild(btn);
    });
  }

  const divider = document.createElement('div');
  divider.style.cssText = 'height:1px;background:var(--border);margin:4px 0;';
  menu.appendChild(divider);
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
    for (const col of board.columns) replaceIn(col.items);
  }
  replaceIn(state.essentials);
  deleteTag(sourceId);
}

function buildTagUsage(tagId) {
  const r = { boards: 0, folders: 0, bookmarks: 0 };
  const walk = items => {
    for (const item of (items || [])) {
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
    for (const col of board.columns) walk(col.items);
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
  for (const board of state.boards) { tally(board.speedDial); for (const col of board.columns) tally(col.items); }
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
    resolveInput: typed => {
      const lc = typed.toLowerCase();
      // Only reuse a tag already in this group — same name in another group is a separate tag
      const inGroup = (state.tags || []).find(t => t.name.toLowerCase() === lc && t.groupId === group.id);
      if (inGroup) return inGroup.id;
      return createTag(typed, null, null).id;
    }
  };
}

function renderTagGroups() {
  if (!state.settings.tagGroups) state.settings.tagGroups = [];
  const list = document.getElementById('tagGroupList');
  list.innerHTML = '';
  const groups = state.settings.tagGroups;
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

    // Header row
    const header = document.createElement('div');
    header.className = 'tag-group-header';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'tag-group-name-input';
    nameInput.value = group.name || '';
    nameInput.placeholder = 'Group name';
    nameInput.disabled = !!group.locked;
    nameInput.addEventListener('focus', () => pushUndoSnapshot());
    nameInput.addEventListener('input', () => { group.name = nameInput.value; saveState(); updateUndoRedoUI(); });

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
      pushUndoSnapshot();
      (state.tags || []).filter(t => t.groupId === group.id).forEach(t => { t.groupId = null; });
      state.settings.tagGroups = state.settings.tagGroups.filter(g => g.id !== group.id);
      saveState();
      updateUndoRedoUI();
      renderTagGroups();
    });

    header.appendChild(nameInput);
    header.appendChild(sortBtn);
    header.appendChild(colorWrap);
    header.appendChild(lockWrap);
    header.appendChild(delBtn);

    // Tag chip input — IDs stored in hidden input, names displayed as chips
    const groupTagObjs = (state.tags || []).filter(t => t.groupId === group.id);
    const sortedTagObjs = sortGroupTags(groupTagObjs, group.tagSort, tagCounts);

    const hiddenInput = document.createElement('input');
    hiddenInput.type = 'text';
    hiddenInput.placeholder = 'Add tags…';
    hiddenInput.value = sortedTagObjs.map(t => t.id).join(' ');

    block.appendChild(header);
    block.appendChild(hiddenInput);
    list.appendChild(block);

    initChipInput(hiddenInput, tagGroupChipOpts(group));

    const wrapper = block.querySelector('.chip-input-wrapper');
    if (wrapper) {
      const color = group.color || '#6d7cff';
      wrapper.querySelectorAll('.chip-live').forEach(chip => applyGroupColor(chip, color));
      const observer = new MutationObserver(() => {
        wrapper.querySelectorAll('.chip-live').forEach(chip => applyGroupColor(chip, group.color || '#6d7cff'));
      });
      observer.observe(wrapper, { childList: true });
      if (group.locked) {
        const textInput = wrapper.querySelector('.chip-text-input');
        if (textInput) textInput.disabled = true;
      }
    }

    // Context menu on chips — use chip.dataset.value (the tag ID)
    const attachChipCtx = chip => {
      if (chip.dataset.ctx) return;
      chip.dataset.ctx = '1';
      chip.addEventListener('contextmenu', e => {
        e.preventDefault();
        const tagId = chip.dataset.value;
        if (tagId) showTagChipContextMenu(e.clientX, e.clientY, tagId, group.id);
      });
    };
    if (wrapper) {
      wrapper.querySelectorAll('.chip-live').forEach(attachChipCtx);
      new MutationObserver(() => wrapper.querySelectorAll('.chip-live').forEach(attachChipCtx))
        .observe(wrapper, { childList: true });
    }

    hiddenInput.addEventListener('input', () => {
      pushUndoSnapshot();
      const newIds = new Set(hiddenInput.value.trim().split(/\s+/).filter(Boolean));
      // Move removed tags to unsorted
      (state.tags || []).filter(t => t.groupId === group.id && !newIds.has(t.id))
        .forEach(t => { t.groupId = null; });
      // Assign all chip IDs to this group
      newIds.forEach(id => {
        const tag = getTagById(id);
        if (tag) tag.groupId = group.id;
      });
      saveState();
      updateUndoRedoUI();
    });
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

  const chipRow = document.createElement('div');
  chipRow.className = 'chip-input-wrapper tag-group-unsorted-chips';

  if (unsorted.length) {
    unsorted.forEach(tag => {
      const chip = document.createElement('span');
      chip.className = 'tag-chip chip-live';
      chip.dataset.value = tag.id;
      const label = document.createElement('span');
      label.textContent = tag.name;
      chip.appendChild(label);
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'chip-remove-btn';
      delBtn.textContent = '\u00d7';
      delBtn.title = 'Delete tag';
      delBtn.addEventListener('mousedown', e => {
        e.preventDefault();
        e.stopPropagation();
        confirmDelete('confirmDeleteTag', tagUsageMessage(tag.id, tag.name), () => {
          pushUndoSnapshot();
          deleteTag(tag.id);
          saveState();
          updateUndoRedoUI();
          renderTagGroups();
        });
      });
      chip.appendChild(delBtn);
      applyTagColor(chip, tag.id);
      chip.addEventListener('contextmenu', e => {
        e.preventDefault();
        showTagChipContextMenu(e.clientX, e.clientY, tag.id, null);
      });
      chipRow.appendChild(chip);
    });
  } else {
    const placeholder = document.createElement('span');
    placeholder.className = 'settings-muted';
    placeholder.style.fontSize = '0.8rem';
    placeholder.textContent = 'All tags are grouped.';
    chipRow.appendChild(placeholder);
  }

  uBlock.appendChild(chipRow);
  list.appendChild(uBlock);
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
  numSetting('stgCollectionFont', 'collectionFontSize', 10, 24);
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
  familySetting('stgCollectionFamily', 'collectionFontFamily');
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

  document.getElementById('stgAddGroupBtn').addEventListener('click', () => {
    if (!state.settings.tagGroups) state.settings.tagGroups = [];
    pushUndoSnapshot();
    state.settings.tagGroups.push({ id: 'grp-' + Date.now(), name: '', color: '#6d7cff', locked: false });
    saveState();
    updateUndoRedoUI();
    renderTagGroups();
  });

  document.getElementById('stgUndoBtn').addEventListener('click', () => { undo(); renderTagGroups(); });
  document.getElementById('stgRedoBtn').addEventListener('click', () => { redo(); renderTagGroups(); });

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
