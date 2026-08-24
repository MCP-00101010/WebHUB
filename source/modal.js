// --- Inherited tag helpers ---

function getContextBoardAndTab(contextTarget) {
  const board = contextTarget?.boardId
    ? state.boards.find(b => b.id === contextTarget.boardId) || getActiveBoard()
    : getActiveBoard();
  if (!board) return { board: null, tab: null };

  let tab = null;
  if (contextTarget?.tabId) tab = findBoardTabById(board, contextTarget.tabId);
  if (!tab && contextTarget?.columnId) tab = findBoardTabByColumnId(board, contextTarget.columnId);
  if (!tab && contextTarget?.itemId) tab = findBoardTabContainingItem(board, contextTarget.itemId);
  if (!tab && contextTarget?.parentId) tab = findBoardTabContainingItem(board, contextTarget.parentId);
  if (!tab) tab = getBoardTab(board);

  return { board, tab };
}

function getContextInheritedTags(contextTarget) {
  const area = contextTarget?.area;
  if (area === 'nav-subfolder' || area === 'nav-item') {
    const collectNavFolderTags = folder => {
      const tags = [];
      let current = folder;
      while (current?.type === 'folder') {
        if (current.sharedTags?.length) tags.unshift(...current.sharedTags);
        current = findNavItemPath(current.id)?.parent || null;
      }
      return [...new Set(tags)];
    };
    if (area === 'nav-subfolder') return collectNavFolderTags(contextTarget?.item || null);
    const path = contextTarget?.itemId ? findNavItemPath(contextTarget.itemId) : null;
    return filterInheritedTagIdsForItem(path?.item || contextTarget?.item || null, collectNavFolderTags(path?.parent || null));
  }
  const { board, tab } = getContextBoardAndTab(contextTarget);
  if (!board) return [];
  if (area === 'speed-dial' || area === 'speed-dial-item' || area === 'essential') {
    return filterInheritedTagIdsForItem(contextTarget?.item || null, getBoardInheritedTagIds(board));
  }
  if (area === 'board-item' || area === 'board-empty' || area === 'board-subfolder' || area === 'board-folder-item') {
    const inheritedBoardAndTabTags = getTabInheritedTagIds(board, tab || getBoardTab(board));
    let parentFolderId = null;
    if (area === 'board-subfolder') parentFolderId = contextTarget.item?.id;
    else if (contextTarget.parentId) parentFolderId = contextTarget.parentId;
    else if (contextTarget.itemId) parentFolderId = findBoardItemInColumns(board, contextTarget.itemId)?.parent?.id || null;
    const folderTags = parentFolderId ? collectFolderAncestorTags(board, parentFolderId) : [];
    const inheritedTags = [...new Set([...inheritedBoardAndTabTags, ...folderTags])];
    const currentItem = area === 'board-item'
      ? (contextTarget?.itemId ? findBoardItemInColumns(board, contextTarget.itemId)?.item : contextTarget?.item || null)
      : (area === 'board-empty' || area === 'board-subfolder' || area === 'board-folder-item'
      ? null
      : contextTarget?.item || null);
    return filterInheritedTagIdsForItem(currentItem, inheritedTags);
  }
  return [];
}

function getBoardInheritedTags() {
  const board = getActiveBoard();
  if (!board) return [];
  return getBoardInheritedTagIds(board);
}

function tagDisplayName(id) {
  const tag = getTagById(id);
  return tag ? tag.name : id;
}

// --- Group picker (disambiguation when same name exists in multiple groups) ---

let _tagGroupPicker = null;

function hideTagGroupPicker() {
  if (_tagGroupPicker) { _tagGroupPicker.remove(); _tagGroupPicker = null; }
  document.removeEventListener('mousedown', _tagGroupPickerOutside, true);
}

function _tagGroupPickerOutside(e) {
  if (_tagGroupPicker && !_tagGroupPicker.contains(e.target)) hideTagGroupPicker();
}

function showTagGroupPicker(matches, typedName, hiddenInput) {
  hideTagGroupPicker();
  const wrapper = hiddenInput.closest ? hiddenInput.closest('.chip-input-wrapper') : null;

  const picker = document.createElement('div');
  picker.className = 'context-menu';
  picker.style.cssText = 'position:fixed;z-index:9999;';

  const header = document.createElement('div');
  header.style.cssText = 'padding:4px 12px 2px;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-muted);pointer-events:none;';
  header.textContent = `"${typedName}" — pick group`;
  picker.appendChild(header);

  matches.forEach(({ tag, groupName, groupColor }) => {
    const btn = document.createElement('button');
    btn.style.cssText = 'display:flex;align-items:center;gap:7px;';
    if (groupColor) {
      const dot = document.createElement('span');
      dot.style.cssText = `width:8px;height:8px;border-radius:50%;background:${groupColor};flex-shrink:0;`;
      btn.appendChild(dot);
    }
    btn.appendChild(document.createTextNode(groupName));
    btn.addEventListener('mousedown', e => {
      e.preventDefault();
      hideTagGroupPicker();
      if (hiddenInput._addValueDirect) hiddenInput._addValueDirect(tag.id);
    });
    picker.appendChild(btn);
  });

  document.body.appendChild(picker);
  _tagGroupPicker = picker;
  picker.style.left = '0';
  picker.style.top = '0';
  const pw = picker.offsetWidth, ph = picker.offsetHeight;
  let left, top;
  if (wrapper) {
    const rect = wrapper.getBoundingClientRect();
    left = rect.left;
    top = rect.bottom + 2;
  } else {
    left = window.innerWidth / 2 - pw / 2;
    top = window.innerHeight / 2 - ph / 2;
  }
  picker.style.left = `${Math.min(left, window.innerWidth - pw - 4)}px`;
  picker.style.top  = `${Math.min(top, window.innerHeight - ph - 4)}px`;
  document.addEventListener('mousedown', _tagGroupPickerOutside, true);
}

function tagChipOpts() {
  return {
    displayOf: id => tagDisplayName(id),
    resolveInput: (typed, textInput, hiddenInput) => {
      const lc = typed.toLowerCase();
      const currentIds = new Set((hiddenInput?.value || '').split(/\s+/).filter(Boolean));
      // Exclude already-committed tags so the picker only shows remaining options
      const matches = (state.tags || []).filter(t => t.name.toLowerCase() === lc && !currentIds.has(t.id));
      if (matches.length > 1) {
        // Ambiguous — show group picker; chip commit deferred to picker click
        const pickerMatches = matches.map(t => {
          const g = (state.settings.tagGroups || []).find(g => g.id === t.groupId);
          return { tag: t, groupName: g?.name || 'Unsorted', groupColor: g?.color || null };
        });
        showTagGroupPicker(pickerMatches, typed, hiddenInput);
        return null;
      }
      if (matches.length === 1) return matches[0].id;
      return createTag(typed).id;
    }
  };
}

// --- Tag autocomplete ---

function getTagSuggestions(partial, hiddenInput) {
  if (!partial) return [];
  const currentIds = new Set((hiddenInput?.value || '').split(/\s+/).filter(Boolean));
  const lc = partial.toLowerCase();
  const seen = new Set();
  const results = [];
  const addSuggestion = name => {
    const nameLc = name.toLowerCase();
    if (!nameLc.startsWith(lc) || nameLc === lc || seen.has(nameLc)) return;
    seen.add(nameLc);
    results.push(name);
  };
  for (const t of (state.tags || [])) {
    if (currentIds.has(t.id)) continue;
    addSuggestion(t.name);
  }
  for (const name of (state.settings.baseTagSuggestions || [])) addSuggestion(name);
  return results;
}

function renderTagSuggestions(textInput, hiddenInput) {
  const pos = textInput.selectionStart;
  if (pos !== textInput.value.length) return;
  const val = textInput.value;
  const partial = val.split(/\s+/).pop();
  if (!partial) return;
  const suggestions = getTagSuggestions(partial, hiddenInput);
  if (!suggestions.length) return;
  const completion = suggestions[0].slice(partial.length);
  if (!completion) return;
  textInput.value = val + completion;
  textInput.setSelectionRange(val.length, textInput.value.length);
}

function attachTagAutocomplete(textInput, hiddenInput) {
  let lastKey = null;
  textInput.addEventListener('keydown', e => {
    lastKey = e.key;
    const start = textInput.selectionStart;
    const end = textInput.selectionEnd;
    if ((e.key === 'Tab' || e.key === 'ArrowRight') && start !== end && end === textInput.value.length) {
      e.preventDefault();
      const accepted = textInput.value.slice(0, end);
      textInput.value = accepted;
      textInput.setSelectionRange(accepted.length, accepted.length);
      // Immediately commit: shows picker for multi-group, adds chip for single-group
      if (hiddenInput._commit) hiddenInput._commit();
      else { textInput.value = accepted + ' '; textInput.setSelectionRange(accepted.length + 1, accepted.length + 1); }
    } else if (e.key === 'Backspace' && start !== end && end === textInput.value.length) {
      e.preventDefault();
      textInput.value = textInput.value.slice(0, start);
      textInput.setSelectionRange(start, start);
    }
  });
  textInput.addEventListener('input', () => {
    if (lastKey === 'Backspace' || lastKey === 'Delete') return;
    renderTagSuggestions(textInput, hiddenInput);
  });
}

// --- Generic modal ---

let modalBoardTabTargets = null;

function showModal(type, options = {}) {
  activeModal = type;
  if (options.contextTarget) contextTarget = options.contextTarget;
  const modalCard = document.getElementById('modalCard');
  modalCard.classList.remove('hidden');
  elements.modalOverlay.classList.remove('hidden');
  centerPanel(modalCard);
  elements.modalTitle.textContent = options.title || 'Action';
  elements.modalInput1.value = options.value1 || '';
  elements.modalInput2.value = options.value2 || '';
  elements.modalInput3.value = options.value3 || '';
  elements.modalInput4.value = options.value4 || '';
  const showName = options.showName !== false;
  elements.modalInput1.classList.toggle('hidden', !showName);
  elements.modalUrlRow.classList.toggle('hidden', !options.showUrl);
  elements.modalTagsRow.classList.toggle('hidden', !options.showTags);
  document.getElementById('modalSharedTagsRow').classList.toggle('hidden', !options.showSharedTags);
  const speedDialSection = document.getElementById('modalSpeedDialSection');
  if (speedDialSection) {
    speedDialSection.classList.toggle('hidden', !options.showSpeedDialSlots);
    document.getElementById('modalSpeedDialSlots').value = options.speedDialSlotCount || getDefaultSpeedDialSlotCount();
    const showToggle = document.getElementById('cmCollectionShowSpeedDial');
    if (showToggle) showToggle.checked = options.collectionShowSpeedDial !== false;
    const wrapTabsRow = document.getElementById('modalWrapTabsRow');
    if (wrapTabsRow) wrapTabsRow.classList.toggle('hidden', !options.showWrapTabs);
    const wrapTabsToggle = document.getElementById('cmWrapTabs');
    if (wrapTabsToggle) wrapTabsToggle.checked = options.wrapTabs === true;
  }
  const showBoardTabSelect = options.showBoardTabSelect === true;
  elements.modalSelectRow.classList.toggle('hidden', !(options.showSelect || showBoardTabSelect));
  elements.modalSelectSecondaryRow.classList.toggle('hidden', !showBoardTabSelect);
  elements.modalInput1.placeholder = options.placeholder1 || 'Enter name';
  elements.modalInput2.placeholder = options.placeholder2 || 'Enter URL';
  const submitBtn = document.getElementById('modalSubmitBtn');
  if (submitBtn) submitBtn.textContent = options.submitLabel || 'Save';
  const selectLabel = document.getElementById('modalSelectLabel');
  if (selectLabel) selectLabel.textContent = options.selectLabel || 'Select';
  const selectSecondaryLabel = document.getElementById('modalSelectSecondaryLabel');
  if (selectSecondaryLabel) selectSecondaryLabel.textContent = options.selectSecondaryLabel || 'Select';
  if (showBoardTabSelect) {
    modalBoardTabTargets = buildModalBoardTabTargets(options.inboxTargetExclusions || {});
    syncModalBoardTabSelectors(options.selectValue || '', options.selectSecondaryValue || '');
    elements.modalSelect.onchange = () => syncModalBoardTabSelectors(elements.modalSelect.value);
  } else if (options.selectOptions) {
    modalBoardTabTargets = null;
    elements.modalSelect.innerHTML = '';
    options.selectOptions.forEach(({ value, label }) => elements.modalSelect.appendChild(new Option(label, value)));
    elements.modalSelectSecondary.innerHTML = '';
    elements.modalSelect.onchange = null;
  } else {
    modalBoardTabTargets = null;
    elements.modalSelect.value = options.selectValue || '';
    elements.modalSelectSecondary.value = options.selectSecondaryValue || '';
    elements.modalSelect.onchange = null;
  }
  document.getElementById('modalDuplicateWarning')?.classList.add('hidden');
  const inherited = options.inheritedTags ?? getContextInheritedTags(options.contextTarget || contextTarget);
  const inheritedRow = document.getElementById('modalInheritedTagsRow');
  const inheritedSpan = document.getElementById('modalInheritedTags');
  if (inheritedRow && inheritedSpan) {
    inheritedSpan.innerHTML = '';
    renderTagsInto(inheritedSpan, inherited);
    inheritedRow.classList.toggle('hidden', inherited.length === 0);
  }
  if (showName) elements.modalInput1.focus();
  else if (options.showTags) elements.modalInput3.focus();
  else if (showBoardTabSelect || options.showSelect) elements.modalSelect.focus();
}

function showBoardMetaModal(mode = 'edit', board = null) {
  const targetBoard = board || getActiveBoardContainer();
  if (mode === 'edit' && !targetBoard) return;
  if (mode === 'edit') contextTarget = { boardId: targetBoard.id, item: targetBoard };
  showModal(mode === 'edit' ? 'editCollection' : 'addCollection', {
    title: mode === 'edit' ? 'Edit Board' : 'New Board',
    placeholder1: 'Board Name',
    value1: mode === 'edit' ? (targetBoard.title || '') : '',
    showTags: true,
    showSharedTags: true,
    showSpeedDialSlots: true,
    showWrapTabs: true,
    speedDialSlotCount: mode === 'edit' ? getSpeedDialSlotCount(targetBoard) : getDefaultSpeedDialSlotCount(),
    collectionShowSpeedDial: mode === 'edit' ? targetBoard.showSpeedDial !== false : true,
    wrapTabs: mode === 'edit' ? targetBoard.wrapTabBar === true : false,
    value3: mode === 'edit' ? (targetBoard.tags || []).join(' ') : '',
    value4: mode === 'edit' ? (targetBoard.sharedTags || []).join(' ') : ''
  });
}

function applyModalCollectionSpeedDialSlots() {
  if (activeModal !== 'editCollection') return null;
  const slotsInput = document.getElementById('modalSpeedDialSlots');
  const speedDialSection = document.getElementById('modalSpeedDialSection');
  if (!slotsInput || speedDialSection?.classList.contains('hidden')) return null;
  const board = contextTarget?.boardId
    ? state.boards.find(b => b.id === contextTarget.boardId)
    : getActiveBoardContainer();
  if (!board) return null;
  normalizeSpeedDialSlots(board);
  const requested = Math.max(1, Math.min(48, parseInt(slotsInput.value, 10) || getDefaultSpeedDialSlotCount()));
  const lastFilled = board.speedDial.reduce((idx, item, i) => item ? i : idx, -1);
  board.speedDialSlotCount = Math.max(requested, lastFilled + 1, 1);
  slotsInput.value = board.speedDialSlotCount;
  return board;
}

function handleModalSpeedDialSlotsInput() {
  const board = applyModalCollectionSpeedDialSlots();
  if (!board) return;
  renderBoard();
  saveState();
}

function handleModalCollectionShowSpeedDialChange() {
  if (activeModal !== 'editCollection') return;
  const board = contextTarget?.boardId
    ? state.boards.find(b => b.id === contextTarget.boardId)
    : getActiveBoardContainer();
  if (!board) return;
  board.showSpeedDial = document.getElementById('cmCollectionShowSpeedDial').checked;
  renderBoard();
  saveState();
}

function parseBoardTabTargetValue(value) {
  const [boardId, tabId] = String(value || '').split('::');
  if (!boardId || !tabId) return { board: null, tab: null };
  const board = state.boards.find(entry => entry.id === boardId) || null;
  const tab = board ? findBoardTabById(board, tabId) : null;
  return { board, tab };
}

function buildModalBoardTabTargets(options = {}) {
  const excludeBoardId = options.excludeBoardId || null;
  const excludeTabId = options.excludeTabId || null;
  return [...state.boards]
    .filter(board => !board.locked)
    .map(board => ({
      board,
      tabs: (board.tabs || []).filter(tab => !(board.id === excludeBoardId && tab.id === excludeTabId))
    }))
    .filter(entry => entry.tabs.length)
    .sort((a, b) => (a.board.title || '').localeCompare(b.board.title || ''));
}

function syncModalBoardTabSelectors(preferredBoardId = '', preferredTabId = '') {
  if (!modalBoardTabTargets?.length) {
    elements.modalSelect.innerHTML = '';
    elements.modalSelectSecondary.innerHTML = '';
    return;
  }
  elements.modalSelect.innerHTML = '';
  modalBoardTabTargets.forEach(({ board }) => {
    elements.modalSelect.appendChild(new Option(board.title || 'Untitled Board', board.id));
  });
  const selectedBoardId = modalBoardTabTargets.some(entry => entry.board.id === preferredBoardId)
    ? preferredBoardId
    : modalBoardTabTargets[0].board.id;
  elements.modalSelect.value = selectedBoardId;
  const selectedEntry = modalBoardTabTargets.find(entry => entry.board.id === selectedBoardId) || modalBoardTabTargets[0];
  elements.modalSelectSecondary.innerHTML = '';
  selectedEntry.tabs.forEach(tab => {
    elements.modalSelectSecondary.appendChild(new Option(tab.title || 'Untitled Tab', tab.id));
  });
  const nextTabId = selectedEntry.tabs.some(tab => tab.id === preferredTabId)
    ? preferredTabId
    : selectedEntry.tabs[0]?.id || '';
  elements.modalSelectSecondary.value = nextTabId;
}

function getModalBoardTabTarget() {
  if (modalBoardTabTargets?.length) {
    const selectedEntry = modalBoardTabTargets.find(entry => entry.board.id === elements.modalSelect.value) || null;
    const tab = selectedEntry
      ? selectedEntry.tabs.find(entry => entry.id === elements.modalSelectSecondary.value) || null
      : null;
    return { board: selectedEntry?.board || null, tab };
  }
  return parseBoardTabTargetValue(elements.modalSelect.value);
}

function shouldKeepModalOverlayVisible() {
  const persistentPanelIds = [
    'settingsPanel',
    'boardSettingsPanel',
    'trashPanel',
    'folderModal',
    'searchModal',
    'tagManagerPanel',
    'widgetSettingsPanel',
    'inboxPanel',
    'notificationCenterPanel'
  ];
  if (persistentPanelIds.some(id => {
    const el = document.getElementById(id);
    return el && !el.classList.contains('hidden');
  })) return true;
  if (typeof importManagerPanelOpen !== 'undefined' && importManagerPanelOpen) return true;
  return false;
}

function hideModal() {
  activeModal = null;
  modalBoardTabTargets = null;
  document.getElementById('modalCard').classList.add('hidden');
  if (!shouldKeepModalOverlayVisible()) elements.modalOverlay.classList.add('hidden');
  document.getElementById('tagSuggestions')?.classList.add('hidden');
  document.getElementById('modalDuplicateWarning')?.classList.add('hidden');
  document.getElementById('modalSharedTagsRow')?.classList.add('hidden');
  document.getElementById('modalSpeedDialSection')?.classList.add('hidden');
  document.getElementById('modalInheritedTagsRow')?.classList.add('hidden');
  elements.modalSelect.onchange = null;
}

function _submitBookmarkModal(mode, { value1, value2, tags, ensureUndo }) {
  const area = contextTarget?.area;
  const fc = contextTarget?.faviconCache || '';

  if (mode === 'add') {
    if (area === 'speed-dial' || area === 'speed-dial-item') {
      if (!isValidUrl(value2)) { alert('Please enter a valid URL.'); return 'abort'; }
      const target = getActiveBoardContainer();
      if (!target) return 'abort';
      const slot = Number.isInteger(contextTarget?.slot) ? contextTarget.slot : firstEmptySpeedDialSlot(target);
      if (slot === -1 || target.speedDial?.[slot]) {
        alert('That speed dial slot is already occupied.');
        return 'abort';
      }
      ensureUndo();
      return addSpeedDialBookmark(value1, value2, tags, fc) ? 'continue' : 'abort';
    }
    if (area === 'set') {
      const set = findSetById(contextTarget.setId);
      if (!set) return 'abort';
      if (isDynamicSet(set)) { alert('Dynamic sets update from rules and cannot be edited manually.'); return 'abort'; }
      if (!isValidUrl(value2)) { alert('Please enter a valid URL.'); return 'abort'; }
      if ((set.items || []).some(entry => entry.url === normalizeUrl(value2))) {
        alert('That URL is already in this set.');
        return 'abort';
      }
      ensureUndo();
      const result = addBookmarkToSet(set, { title: value1, url: value2, tags, faviconCache: fc });
      if (!result.ok) {
        alert(result.reason === 'duplicate'
          ? 'That URL is already in this set.'
          : result.reason === 'dynamic'
            ? 'Dynamic sets update from rules and cannot be edited manually.'
            : 'Please enter a valid URL.');
        return 'abort';
      }
      return 'continue';
    }
    if (area === 'essential') {
      if (!isValidUrl(value2)) { alert('Please enter a valid URL.'); return 'abort'; }
      if (state.essentials[contextTarget.slot]) { alert('That essentials slot is already occupied.'); return 'abort'; }
      ensureUndo();
      if (!setEssential(contextTarget.slot, value1, value2, tags, fc)) return 'abort';
      hideModal();
      renderEssentials();
      saveState();
      return 'complete';
    }
    if (area === 'board-folder-item') {
      if (isDynamicFolder(contextTarget.item)) {
        alert('Dynamic folders update from rules and cannot be edited manually.');
        return 'abort';
      }
      if (!isValidUrl(value2)) { alert('Please enter a valid URL.'); return 'abort'; }
      ensureUndo();
      contextTarget.item.children.push({ id: `bm-${Date.now()}`, type: 'bookmark', title: value1, url: normalizeUrl(value2), tags, faviconCache: fc });
      contextTarget.item.collapsed = false;
      return 'continue';
    }
    if (!isValidUrl(value2)) { alert('Please enter a valid URL.'); return 'abort'; }
    ensureUndo();
    return addBookmark(value1, value2, contextTarget?.columnId, tags, fc) ? 'continue' : 'abort';
  }

  if (area === 'speed-dial-item') {
    if (!isValidUrl(value2)) { alert('Please enter a valid URL.'); return 'abort'; }
    const board = getActiveBoard();
    const sdItem = board.speedDial.find(i => i?.id === contextTarget?.itemId);
    if (!sdItem) return 'abort';
    ensureUndo();
    if (normalizeUrl(value2) !== sdItem.url) sdItem.faviconCache = '';
    sdItem.title = value1;
    sdItem.url = normalizeUrl(value2);
    sdItem.tags = tags;
    return 'continue';
  }
  if (area === 'set-item') {
    if (!isValidUrl(value2)) { alert('Please enter a valid URL.'); return 'abort'; }
    const set = findSetById(contextTarget.setId);
    if (isDynamicSet(set)) { alert('Dynamic sets update from rules and cannot be edited manually.'); return 'abort'; }
    const found = findSetItemById(set, contextTarget.itemId);
    if (!found?.item) return 'abort';
    const normalized = normalizeUrl(value2);
    const duplicate = (set.items || []).some(entry => entry.id !== found.item.id && entry.url === normalized);
    if (duplicate) { alert('That URL is already in this set.'); return 'abort'; }
    ensureUndo();
    if (normalized !== found.item.url) found.item.faviconCache = '';
    found.item.title = value1;
    found.item.url = normalized;
    found.item.tags = tags;
    touchSet(set);
    return 'continue';
  }
  if (area === 'essential') {
    if (!isValidUrl(value2)) { alert('Please enter a valid URL.'); return 'abort'; }
    ensureUndo();
    if (!setEssential(contextTarget.slot, value1, value2, tags, '', true)) return 'abort';
    hideModal();
    renderEssentials();
    saveState();
    return 'complete';
  }
  if (!isValidUrl(value2)) { alert('Please enter a valid URL.'); return 'abort'; }
  const board = getBoardForContext(contextTarget);
  const found = board ? findBoardItemInColumns(board, contextTarget.itemId) : null;
  if (!found?.item || found.item.type !== 'bookmark') return 'abort';
  ensureUndo();
  return editBookmarkContext(value1, value2, tags, contextTarget) ? 'continue' : 'abort';
}

function _submitCollectionModal(mode, { value1, tags, sharedTagsFromModal, ensureUndo }) {
  if (mode === 'edit') {
    const board = contextTarget?.boardId
      ? state.boards.find(b => b.id === contextTarget.boardId)
      : getActiveBoardContainer();
    if (!board) return 'abort';
    ensureUndo();
    if (value1.trim()) {
      board.title = value1.trim();
      const navItem = findNavBoardItem(board.id);
      if (navItem) navItem.title = board.title;
    }
    applyModalCollectionSpeedDialSlots();
    const sdSection = document.getElementById('modalSpeedDialSection');
    if (sdSection && !sdSection.classList.contains('hidden')) {
      board.showSpeedDial = document.getElementById('cmCollectionShowSpeedDial').checked;
      const wrapTabsRow = document.getElementById('modalWrapTabsRow');
      if (wrapTabsRow && !wrapTabsRow.classList.contains('hidden')) {
        board.wrapTabBar = document.getElementById('cmWrapTabs').checked;
      }
    }
    board.tags = tags;
    board.sharedTags = sharedTagsFromModal;
    return 'continue';
  }

  const slotsInput = document.getElementById('modalSpeedDialSlots');
  const requested = Math.max(1, Math.min(48, parseInt(slotsInput?.value, 10) || getDefaultSpeedDialSlotCount()));
  ensureUndo();
  const board = createBoard(value1, {
    showSpeedDial: document.getElementById('cmCollectionShowSpeedDial')?.checked !== false,
    speedDialSlotCount: requested,
    wrapTabBar: document.getElementById('cmWrapTabs')?.checked === true,
    tags,
    sharedTags: sharedTagsFromModal,
    createEmpty: true
  });
  if (board) createBoardTab(board, 'New Tab');
  hideModal();
  renderAll();
  saveState();
  if (board) showBoardSettingsPanel(true);
  return 'complete';
}

function _submitMoveToBoardModal(ensureUndo) {
  const { board: targetBoard, tab: targetTab } = getModalBoardTabTarget();
  if (!targetBoard || !targetTab) return 'abort';
  const area = contextTarget.area;
  const targetInbox = getBoardInbox(targetBoard, targetTab);
  if (!targetInbox) return 'abort';

  if (area === 'import-manager-all') {
    const items = cloneData(state.importManager?.items || []);
    if (!items.length) return 'abort';
    ensureUndo();
    stripTransientItemLocks(items);
    targetInbox.items.push(...items);
    clearImportManager();
    return 'continue';
  }

  let capturedItem = null;
  if (area === 'import-manager-item') {
    ensureUndo();
    const removed = removeImportManagerItemById(contextTarget.itemId);
    if (!removed) return 'abort';
    capturedItem = cloneData(removed);
    if (!capturedItem.tags) capturedItem.tags = [];
  } else {
    if (!contextTarget?.item) return 'abort';
    ensureUndo();
    capturedItem = cloneData(contextTarget.item);
    if (!capturedItem.tags) capturedItem.tags = [];
    if (area === 'speed-dial-item') {
      capturedItem.type = 'bookmark';
      const board = getActiveBoard();
      removeSpeedDialItemById(board, contextTarget.itemId);
    } else if (area === 'essential') {
      capturedItem.type = 'bookmark';
      removeEssential(contextTarget.slot);
      trimEssentialsTail();
    } else {
      if (contextTarget?.inDynamicFolder && capturedItem.type === 'bookmark') {
        capturedItem.id = `bm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      } else {
        deleteBoardTarget(contextTarget);
      }
    }
  }

  stripTransientItemLocks([capturedItem]);
  targetInbox.items.push(capturedItem);
  return 'continue';
}

function _submitBulkAddTagsModal(value3, ensureUndo) {
  const newTags = value3 ? value3.split(/\s+/).filter(Boolean) : [];
  if (!newTags.length) {
    hideModal();
    return 'complete';
  }
  if (selectionContext === 'import-manager') {
    for (const itemId of selectedItemIds) {
      const found = findImportManagerItemPath(itemId);
      if (found?.item) {
        ensureUndo();
        found.item.tags = [...new Set([...(found.item.tags || []), ...newTags])];
      }
    }
    clearSelection();
    return 'continue';
  }
  const board = getActiveBoard();
  for (const itemId of selectedItemIds) {
    const found = findBoardItemInColumns(board, itemId);
    if (found?.item) {
      ensureUndo();
      found.item.tags = [...new Set([...(found.item.tags || []), ...newTags])];
    }
  }
  clearSelection();
  return 'continue';
}

function _submitBulkMoveToBoardModal(ensureUndo) {
  const { board: targetBoard, tab: targetTab } = getModalBoardTabTarget();
  if (!targetBoard || !targetTab) return 'abort';
  const targetInbox = getBoardInbox(targetBoard, targetTab);
  if (!targetInbox) return 'abort';
  if (selectionContext === 'import-manager') {
    const toMove = collectSelectedImportManagerItems(selectedItemIds);
    toMove.forEach(item => {
      ensureUndo();
      const removed = removeImportManagerItemById(item.id);
      if (removed) {
        stripTransientItemLocks([removed]);
        targetInbox.items.push(removed);
      }
    });
    clearSelection();
    return 'continue';
  }
  const board = getActiveBoard();
  const toMove = [];
  for (const itemId of selectedItemIds) {
    const found = findBoardItemInColumns(board, itemId);
    if (found?.item) toMove.push(found);
  }
  toMove.forEach(({ item, list }) => {
    ensureUndo();
    list.splice(list.indexOf(item), 1);
    stripTransientItemLocks([item]);
    targetInbox.items.push(item);
  });
  clearSelection();
  return 'continue';
}

async function handleModalSubmit(event) {
  event.preventDefault();
  const value1 = elements.modalInput1.value.trim();
  const value2 = elements.modalInput2.value.trim();
  const value3 = elements.modalInput3.value.trim();
  const value4 = elements.modalInput4.value.trim();
  const tags = value3 ? value3.split(/\s+/).filter(Boolean) : [];
  const sharedTagsFromModal = value4 ? value4.split(/\s+/).filter(Boolean) : [];

  const noNameRequired = ['moveToBoard', 'bulkMoveToBoard', 'bulkAddTags'];
  if (!value1 && !noNameRequired.includes(activeModal)) return;

  let undoCaptured = false;
  const ensureUndo = () => {
    if (!undoCaptured) {
      pushUndoSnapshot();
      undoCaptured = true;
    }
  };
  const area = contextTarget?.area;

  switch (activeModal) {
    case 'addBookmark':
    case 'editBookmark': {
      const result = _submitBookmarkModal(activeModal === 'addBookmark' ? 'add' : 'edit', { value1, value2, tags, ensureUndo });
      if (result === 'abort') return;
      if (result === 'complete') return;
      break;
    }
    case 'editApplication': {
      const board = getBoardForContext(contextTarget);
      const found = board ? findBoardItemInColumns(board, contextTarget?.itemId) : null;
      if (!found?.item || found.item.type !== 'application') return;
      ensureUndo();
      found.item.title = value1.slice(0, 160);
      found.item.tags = tags;
      break;
    }
    case 'addFolder': {
      const parent = contextTarget?.item;
      if (area === 'nav-empty') {
        ensureUndo();
        addNavSection({ type: 'folder', title: value1 });
      } else if (area === 'nav-subfolder') {
        if (parent) {
          ensureUndo();
          parent.children = parent.children || [];
          parent.children.push(createFolderRecord(value1));
          parent.collapsed = false;
        }
      }
      break;
    }
    case 'addTitle':
      ensureUndo();
      if (area === 'nav-empty') addNavSection({ type: 'title', title: value1 });
      else if (area === 'board-folder-item' && contextTarget?.item && !isDynamicFolder(contextTarget.item)) {
        contextTarget.item.children = contextTarget.item.children || [];
        contextTarget.item.children.push({
          id: `id-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          type: 'title',
          title: value1
        });
        contextTarget.item.collapsed = false;
      }
      else addBookmarkItem('title', value1, contextTarget?.columnId);
      break;
    case 'themeName':
      if (typeof _themeNameModalSubmit === 'function') {
        const result = await _themeNameModalSubmit(value1);
        if (result === false) return;
      }
      break;
    case 'renameItem':
      ensureUndo();
      renameContextItem(value1, contextTarget);
      break;
    case 'editCollection':
    case 'addCollection': {
      const result = _submitCollectionModal(activeModal === 'editCollection' ? 'edit' : 'add', { value1, tags, sharedTagsFromModal, ensureUndo });
      if (result === 'abort') return;
      if (result === 'complete') return;
      break;
    }
    case 'moveToBoard': {
      const result = _submitMoveToBoardModal(ensureUndo);
      if (result === 'abort') return;
      break;
    }
    case 'bulkAddTags': {
      const result = _submitBulkAddTagsModal(value3, ensureUndo);
      if (result === 'complete' || result === 'abort') return;
      break;
    }
    case 'bulkMoveToBoard': {
      const result = _submitBulkMoveToBoardModal(ensureUndo);
      if (result === 'abort') return;
      break;
    }
    default:
      break;
  }

  hideModal();
  renderAll();
  saveState();
}

// --- Dynamic rule editor ---

let dynamicRuleEditorTarget = null;
let dynamicRuleEditorOriginalRules = null;
let dynamicSortMenu = null;

function _focusChipTextInput(inputId) {
  const hiddenInput = document.getElementById(inputId);
  hiddenInput?.nextElementSibling?.focus();
}

function _resolveDynamicRuleEditorTarget(target = dynamicRuleEditorTarget) {
  if (!target?.targetType) return null;
  if (target.targetType === 'set') return findSetById(target.setId);
  if (target.targetType !== 'folder') return null;

  const ct = target.contextTarget || target;
  if (ct?.area === 'nav-item' || ct?.area === 'nav-subfolder') {
    return ct?.itemId ? findNavItemPath(ct.itemId)?.item || null : ct?.item || null;
  }
  const board = ct?.boardId
    ? state.boards.find(entry => entry.id === ct.boardId) || null
    : getBoardForContext(ct);
  if (!board) return null;
  if (ct?.itemId) return findBoardItemInColumns(board, ct.itemId)?.item || null;
  return ct?.item || null;
}

function _isDynamicRuleEditorTargetValid(target, item) {
  if (!target || !item) return false;
  if (target.targetType === 'set') return isDynamicSet(item);
  if (target.targetType === 'folder') return isDynamicFolder(item);
  return false;
}

function _dynamicRuleEditorTargetBadge(target) {
  return target?.targetType === 'folder' ? 'Dynamic Folder' : 'Dynamic Set';
}

function _dynamicSortButtonTitle(sortMode) {
  const label = DYNAMIC_SORT_LABELS[normalizeDynamicSortMode(sortMode)] || DYNAMIC_SORT_LABELS.source;
  return `Sort dynamic results: ${label}`;
}

function _dynamicSortButtonLabel(sortMode) {
  return DYNAMIC_SORT_LABELS[normalizeDynamicSortMode(sortMode)] || DYNAMIC_SORT_LABELS.source;
}

function hideDynamicSortMenu() {
  if (dynamicSortMenu) {
    dynamicSortMenu.remove();
    dynamicSortMenu = null;
  }
  document.removeEventListener('mousedown', _dynamicSortMenuOutside, true);
}

function _dynamicSortMenuOutside(event) {
  if (dynamicSortMenu && !dynamicSortMenu.contains(event.target)) hideDynamicSortMenu();
}

function showDynamicSortMenu(anchorEl, target) {
  const resolvedTarget = _resolveDynamicRuleEditorTarget(target);
  if (!_isDynamicRuleEditorTargetValid(target, resolvedTarget)) {
    showNotice('This sort menu is only available for dynamic sets and folders.');
    return;
  }

  hideDynamicSortMenu();
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.style.cssText = 'position:fixed;z-index:9999;';

  ['source', 'title-asc', 'title-desc', 'url-asc', 'url-desc'].forEach(mode => {
    const btn = document.createElement('button');
    const isActive = normalizeDynamicSortMode(resolvedTarget.sortMode) === mode;
    btn.style.display = 'flex';
    btn.style.alignItems = 'center';
    btn.style.gap = '8px';
    if (isActive) btn.style.color = 'var(--accent)';
    const check = document.createElement('span');
    check.textContent = '✓';
    check.style.cssText = `visibility:${isActive ? 'visible' : 'hidden'};font-size:0.85rem;flex-shrink:0;`;
    btn.appendChild(check);
    btn.appendChild(document.createTextNode(_dynamicSortButtonLabel(mode)));
    btn.addEventListener('click', () => {
      hideDynamicSortMenu();
      if (normalizeDynamicSortMode(resolvedTarget.sortMode) === mode) return;
      pushUndoSnapshot();
      resolvedTarget.sortMode = mode;
      if (target.targetType === 'set') touchSet(resolvedTarget);
      const activeFolderSortBtn = document.getElementById('fmSortBtn');
      if (target.targetType === 'folder' && activeFolderSortBtn) {
        activeFolderSortBtn.title = _dynamicSortButtonTitle(mode);
        activeFolderSortBtn.setAttribute('aria-label', _dynamicSortButtonTitle(mode));
      }
      renderAll();
      saveState();
    });
    menu.appendChild(btn);
  });

  document.body.appendChild(menu);
  dynamicSortMenu = menu;
  const rect = anchorEl.getBoundingClientRect();
  let left = rect.left;
  let top = rect.bottom + 2;
  menu.style.left = '0';
  menu.style.top = '0';
  const menuWidth = menu.offsetWidth;
  const menuHeight = menu.offsetHeight;
  left = Math.min(left, window.innerWidth - menuWidth - 4);
  top = Math.min(top, window.innerHeight - menuHeight - 4);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  document.addEventListener('mousedown', _dynamicSortMenuOutside, true);
}

function _readDynamicRuleEditorRules() {
  return normalizeDynamicRules({
    includeTags: document.getElementById('dynamicRuleIncludeTags').value.trim().split(/\s+/).filter(Boolean),
    excludeTags: document.getElementById('dynamicRuleExcludeTags').value.trim().split(/\s+/).filter(Boolean)
  });
}

function _refreshDynamicRuleEditorPreview(target = dynamicRuleEditorTarget) {
  if (!target) return;
  if (target.targetType === 'set') {
    renderSetManagerPanel();
    return;
  }
  renderAll();
}

function _applyDynamicRuleEditorPreview() {
  const target = dynamicRuleEditorTarget;
  const resolvedTarget = _resolveDynamicRuleEditorTarget(target);
  if (!_isDynamicRuleEditorTargetValid(target, resolvedTarget)) return;
  resolvedTarget.rules = _readDynamicRuleEditorRules();
  _refreshDynamicRuleEditorPreview(target);
}

function showDynamicRuleEditor(target) {
  const panel = document.getElementById('dynamicRuleEditorPanel');
  if (!panel) return;
  const resolvedTarget = _resolveDynamicRuleEditorTarget(target);
  if (!_isDynamicRuleEditorTargetValid(target, resolvedTarget)) {
    showNotice('This rule editor is only available for dynamic sets and folders.');
    return;
  }

  dynamicRuleEditorTarget = target;
  dynamicRuleEditorOriginalRules = normalizeDynamicRules(resolvedTarget.rules);
  document.getElementById('dynamicRuleEditorTargetBadge').textContent = _dynamicRuleEditorTargetBadge(target);
  document.getElementById('dynamicRuleEditorTargetName').textContent = resolvedTarget.title || 'Untitled Collection';
  document.getElementById('dynamicRuleIncludeTags').value = dynamicRuleEditorOriginalRules.includeTags.join(' ');
  document.getElementById('dynamicRuleExcludeTags').value = dynamicRuleEditorOriginalRules.excludeTags.join(' ');

  panel.classList.remove('hidden');
  panel.classList.add('draggable');
  centerPanel(panel);
  makeDraggable(panel, document.getElementById('dynamicRuleEditorHeader'));
  requestAnimationFrame(() => _focusChipTextInput('dynamicRuleIncludeTags'));
}

function hideDynamicRuleEditor(options = {}) {
  hideDynamicSortMenu();
  const shouldRestore = options.restore !== false;
  if (shouldRestore) {
    const target = dynamicRuleEditorTarget;
    const resolvedTarget = _resolveDynamicRuleEditorTarget(target);
    if (_isDynamicRuleEditorTargetValid(target, resolvedTarget) && dynamicRuleEditorOriginalRules) {
      resolvedTarget.rules = normalizeDynamicRules(dynamicRuleEditorOriginalRules);
      _refreshDynamicRuleEditorPreview(target);
    }
  }
  document.getElementById('dynamicRuleEditorPanel')?.classList.add('hidden');
  dynamicRuleEditorTarget = null;
  dynamicRuleEditorOriginalRules = null;
}

function handleDynamicRuleEditorSave() {
  const target = dynamicRuleEditorTarget;
  const resolvedTarget = _resolveDynamicRuleEditorTarget(target);
  if (!_isDynamicRuleEditorTargetValid(target, resolvedTarget)) {
    hideDynamicRuleEditor();
    showNotice('That dynamic collection is no longer available.');
    return;
  }

  const nextRules = _readDynamicRuleEditorRules();
  const originalRules = normalizeDynamicRules(dynamicRuleEditorOriginalRules);

  resolvedTarget.rules = originalRules;
  pushUndoSnapshot();
  resolvedTarget.rules = nextRules;
  if (target.targetType === 'set') touchSet(resolvedTarget);
  hideDynamicRuleEditor({ restore: false });
  renderAll();
  saveState();
}

function attachDynamicRuleEditorListeners() {
  document.getElementById('dynamicRuleEditorCancelBtn')?.addEventListener('click', hideDynamicRuleEditor);
  document.getElementById('dynamicRuleEditorSaveBtn')?.addEventListener('click', handleDynamicRuleEditorSave);
  initChipInput(document.getElementById('dynamicRuleIncludeTags'), tagChipOpts());
  initChipInput(document.getElementById('dynamicRuleExcludeTags'), tagChipOpts());
  document.getElementById('dynamicRuleIncludeTags')?.addEventListener('input', _applyDynamicRuleEditorPreview);
  document.getElementById('dynamicRuleExcludeTags')?.addEventListener('input', _applyDynamicRuleEditorPreview);
}

// --- Folder modal ---

let folderModalMode = 'create';
let folderModalTargetMode = 'static';

function _findFolderItemForContext(ct = contextTarget) {
  if (!ct) return null;
  if (ct.area === 'nav-item') return findNavItemPath(ct.itemId)?.item || null;
  const board = getBoardForContext(ct);
  return board ? findBoardItemInColumns(board, ct.itemId)?.item || null : null;
}

function showFolderModal(mode, ct, options = {}) {
  folderModalMode = mode;
  if (ct) contextTarget = ct;
  const modalCard = document.getElementById('modalCard');
  const panel = document.getElementById('folderModal');
  const folderItem = mode === 'edit' ? _findFolderItemForContext(contextTarget) : null;
  folderModalTargetMode = mode === 'edit'
    ? normalizeFolderMode(folderItem?.folderMode ?? folderItem?.mode)
    : normalizeFolderMode(options.folderMode);
  panel.dataset.restoreModalCard = modalCard.classList.contains('hidden') ? 'false' : 'true';
  modalCard.classList.add('hidden');
  panel.classList.remove('hidden');
  elements.modalOverlay.classList.remove('hidden');
  const submitBtn = document.getElementById('folderModalSubmitBtn');
  const dynamicMode = folderModalTargetMode === 'dynamic';
  const sortBtn = document.getElementById('fmSortBtn');
  document.getElementById('fmSubtitle').textContent = mode === 'edit'
    ? (dynamicMode ? 'Edit Dynamic Folder' : 'Edit Folder')
    : (dynamicMode ? 'New Dynamic Folder' : 'New Folder');
  document.getElementById('fmName').placeholder = dynamicMode ? 'New Dynamic Folder' : 'New Folder';
  document.getElementById('fmModeBadge')?.classList.toggle('hidden', !dynamicMode);
  sortBtn?.classList.toggle('hidden', !(mode === 'edit' && dynamicMode));
  if (sortBtn) {
    const sortTitle = _dynamicSortButtonTitle(folderItem?.sortMode);
    sortBtn.title = sortTitle;
    sortBtn.setAttribute('aria-label', sortTitle);
  }
  document.getElementById('fmRulesBtn')?.classList.toggle('hidden', !(mode === 'edit' && dynamicMode));
  if (mode === 'edit') {
    submitBtn.textContent = 'Save';
    if (folderItem) {
      document.getElementById('fmName').value = folderItem.title || '';
      document.getElementById('fmTags').value = (folderItem.tags || []).join(' ');
      document.getElementById('fmSharedTags').value = (folderItem.sharedTags || []).join(' ');
    }
  } else {
    submitBtn.textContent = 'Create';
    document.getElementById('fmName').value = '';
    document.getElementById('fmTags').value = '';
    document.getElementById('fmSharedTags').value = '';
  }
  centerPanel(panel);
  makeDraggable(panel, document.getElementById('folderModalHeader'));
  const inherited = getContextInheritedTags(contextTarget);
  const fmInheritedRow = document.getElementById('fmInheritedTagsRow');
  const fmInheritedSpan = document.getElementById('fmInheritedTags');
  if (fmInheritedRow && fmInheritedSpan) {
    fmInheritedSpan.innerHTML = '';
    renderTagsInto(fmInheritedSpan, inherited);
    fmInheritedRow.classList.toggle('hidden', inherited.length === 0);
  }
  document.getElementById('fmName').focus();
}

function hideFolderModal() {
  hideDynamicSortMenu();
  const panel = document.getElementById('folderModal');
  const restoreModalCard = panel.dataset.restoreModalCard === 'true';
  panel.classList.add('hidden');
  delete panel.dataset.restoreModalCard;
  if (restoreModalCard) {
    document.getElementById('modalCard').classList.remove('hidden');
    elements.modalOverlay.classList.remove('hidden');
  } else if (!shouldKeepModalOverlayVisible()) {
    elements.modalOverlay.classList.add('hidden');
  }
}

function handleFolderModalSubmit() {
  const name = document.getElementById('fmName').value.trim();
  if (!name) { document.getElementById('fmName').focus(); return; }
  const tags = document.getElementById('fmTags').value.trim().split(/\s+/).filter(Boolean);
  const sharedTags = document.getElementById('fmSharedTags').value.trim().split(/\s+/).filter(Boolean);
  pushUndoSnapshot();
  if (folderModalMode === 'edit') {
    editFolder(contextTarget.itemId, name, tags, sharedTags, contextTarget);
  } else {
    const area = contextTarget?.area;
    const parent = contextTarget?.item;
    if (area === 'nav-empty') {
      addNavSection({ type: 'folder', title: name, tags, sharedTags });
    } else if (area === 'nav-subfolder') {
      if (parent) {
        parent.children = parent.children || [];
        parent.children.push(createFolderRecord(name, { tags, sharedTags }));
        parent.collapsed = false;
      }
    } else if (area === 'board-subfolder') {
      if (parent) {
        if (!canInsertIntoFolder(parent, 'folder')) {
          showNotice('Dynamic folders cannot contain subfolders.');
          return;
        }
        parent.children = parent.children || [];
        parent.children.push(createFolderRecord(name, { tags, sharedTags, folderMode: folderModalTargetMode }));
        parent.collapsed = false;
      }
    } else {
      addBookmarkItem('folder', name, contextTarget?.columnId, { tags, sharedTags, folderMode: folderModalTargetMode });
    }
  }
  hideFolderModal();
  renderAll();
  saveState();
}

function attachFolderModalListeners() {
  document.getElementById('folderModalCancelBtn').addEventListener('click', hideFolderModal);
  document.getElementById('folderModalSubmitBtn').addEventListener('click', handleFolderModalSubmit);
  document.getElementById('fmRulesBtn').addEventListener('click', () => {
    const folderItem = _findFolderItemForContext(contextTarget);
    if (!isDynamicFolder(folderItem)) return;
    showDynamicRuleEditor({ targetType: 'folder', contextTarget: { ...contextTarget } });
  });
  document.getElementById('fmSortBtn').addEventListener('click', event => {
    const folderItem = _findFolderItemForContext(contextTarget);
    if (!isDynamicFolder(folderItem)) return;
    showDynamicSortMenu(event.currentTarget, { targetType: 'folder', contextTarget: { ...contextTarget } });
  });
  document.getElementById('fmName').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); handleFolderModalSubmit(); }
  });
  initChipInput(document.getElementById('fmTags'), tagChipOpts());
  initChipInput(document.getElementById('fmSharedTags'), tagChipOpts());
}

// --- External bookmark modal (called from dnd and essentials) ---

function openExternalBookmarkModal(url, title, target, faviconCache = '') {
  contextTarget = { ...target, faviconCache };
  showModal('addBookmark', {
    title: 'New Bookmark',
    placeholder1: 'New Bookmark',
    value1: title,
    showUrl: true,
    placeholder2: 'Bookmark URL',
    value2: url,
    showTags: true,
    inheritedTags: getContextInheritedTags(contextTarget)
  });
}
