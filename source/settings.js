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
  const titleEl = document.getElementById('bstgTitle');
  titleEl.placeholder = isNew ? board.title : 'Board Name';
  titleEl.value = isNew ? '' : board.title;
  const colRadio = document.querySelector(`input[name="bstgCols"][value="${board.columnCount}"]`);
  if (colRadio) colRadio.checked = true;
  document.getElementById('bstgBgUrl').value = board.backgroundImage || '';
  updateBgDropZonePreview(board.backgroundImage || '');
  document.getElementById('bstgOpacity').value = board.containerOpacity ?? 100;
  document.getElementById('bstgOpacityVal').textContent = board.containerOpacity ?? 100;
  document.getElementById('bstgShowSpeedDial').checked = board.showSpeedDial !== false;
  document.getElementById('bstgSpeedDialSlots').value = getSpeedDialSlotCount(board);
  const inCollection = !!findBoardCollection(board.id);
  const sdNote = document.getElementById('bstgCollectionSpeedDialNote');
  if (sdNote) sdNote.classList.toggle('hidden', !inCollection);
  document.getElementById('bstgShowSpeedDial').disabled = inCollection;
  document.getElementById('bstgSpeedDialSlots').disabled = inCollection;
  document.getElementById('bstgTags').value = (board.tags || []).join(' ');
  document.getElementById('bstgSharedTags').value = (board.sharedTags || []).join(' ');
  document.getElementById('bstgInheritTags').checked = board.inheritTags !== false;
  document.getElementById('bstgAutoRemove').checked = isNew ? true : board.autoRemoveTags === true;
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
  if (board && !titleEl.value.trim()) {
    board.title = titleEl.placeholder || 'New Board';
    const navItem = _findNavBoardItem(state.navItems, board.id);
    if (navItem) navItem.title = board.title;
    if (!elements.collectionTabBar.classList.contains('hidden')) {
      const coll = state.activeCollectionId ? findCollectionById(state.activeCollectionId) : null;
      if (coll) renderCollectionTabBar(coll);
      else { const folder = findBoardFolder(board.id); if (folder) renderFolderTabBar(folder); }
    }
  }
  document.getElementById('boardSettingsDoneBtn').textContent = 'OK';
  document.getElementById('boardSettingsPanel').classList.add('hidden');
  document.getElementById('modalCard').classList.remove('hidden');
  elements.modalOverlay.classList.add('hidden');
  boardSettingsCreatingId = null;
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
    const navItem = findNavBoardItem(boardSettingsCreatingId);
    if (navItem) deleteBoardAndNavItem(navItem.id, boardSettingsCreatingId);
    renderAll();
    saveState();
  }
  hideBoardSettingsPanel();
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
    if (!board) return;
    board.title = e.target.value || e.target.placeholder;
    elements.boardTitle.textContent = board.title;
    const findNavItem = (items) => { for (const i of items) { if (i.boardId === board.id) return i; if (i.children) { const f = findNavItem(i.children); if (f) return f; } } return null; };
    const navItem = findNavItem(state.navItems);
    if (navItem) navItem.title = board.title;
    renderNav();
    // Refresh tab bar if visible (collection or folder context)
    if (!elements.collectionTabBar.classList.contains('hidden')) {
      const coll = state.activeCollectionId ? findCollectionById(state.activeCollectionId) : null;
      if (coll) renderCollectionTabBar(coll);
      else { const folder = findBoardFolder(board.id); if (folder) renderFolderTabBar(folder); }
    }
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
    updateBgDropZonePreview(board.backgroundImage);
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
      updateBgDropZonePreview(board.backgroundImage);
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
    updateBgDropZonePreview(board.backgroundImage);
    applyBg();
  });

  document.getElementById('bstgBgClear').addEventListener('click', () => {
    const board = getActiveBoard();
    if (!board) return;
    board.backgroundImage = '';
    document.getElementById('bstgBgUrl').value = '';
    updateBgDropZonePreview('');
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

const STYLE_SECTIONS = ['hubName', 'boardTitle', 'board', 'bookmark', 'folder', 'collection', 'title'];

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

async function updateAboutBridgeStatus() {
  if (typeof bridge !== 'undefined') await bridge.whenReady;
  const extensionEl = document.getElementById('aboutExtensionStatus');
  const nativeEl = document.getElementById('aboutNativeStatus');
  const featuresEl = document.getElementById('aboutExtensionFeatures');
  if (!extensionEl || !nativeEl || !featuresEl) return;

  const extensionReady = typeof bridge !== 'undefined' && bridge.isAvailable();
  const nativeReady = extensionReady && bridge.nativeIsAvailable();
  extensionEl.textContent = extensionReady ? 'Connected' : 'Not detected';
  nativeEl.textContent = nativeReady ? 'Available' : (extensionReady ? 'Not available' : 'Not connected');

  const features = [];
  if (extensionReady) {
    features.push('extension storage backup', 'send current tab to board inbox');
    if (nativeReady) features.push('native JSON file sync', 'background image picker', 'theme file import/export');
  }
  featuresEl.textContent = features.length
    ? `Extension features: ${features.join(', ')}.`
    : 'Extension features: unavailable. The hub is running in localStorage-only mode.';
}

function showSettingsPanel(tab = 'general') {
  document.getElementById('modalCard').classList.add('hidden');
  const panel = document.getElementById('settingsPanel');
  panel.classList.remove('hidden');
  elements.modalOverlay.classList.remove('hidden');
  centerPanel(panel);
  makeDraggable(panel, document.getElementById('stgDragHandle'));
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
  updateStyleAdvancedUI();
  renderThemePicker();
  renderTagGroups();
  updateAboutBridgeStatus();
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
    for (const col of board.columns) replaceIn(col.items);
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
  document.getElementById('stgHubName').addEventListener('input', e => {
    state.hubName = e.target.value || 'Morpheus WebHub';
    elements.hubNameEl.textContent = state.hubName;
    document.title = state.hubName;
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
  numSetting('stgCollectionFont', 'collectionFontSize', 10, 24);
  numSetting('stgTitleFont',      'titleFontSize',       8, 24);
  numSetting('stgBoardTitleFont', 'boardTitleFontSize', 14, 48);
  numSetting('stgHubNameFont',    'hubNameFontSize',    10, 48);

  const boolSetting = (id, key) => document.getElementById(id).addEventListener('change', e => {
    state.settings[key] = e.target.checked;
    saveState();
  });
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
