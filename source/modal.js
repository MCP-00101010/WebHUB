// --- Inherited tag helpers ---

function getContextInheritedTags(contextTarget) {
  const board = getActiveBoard();
  if (!board) return [];
  const area = contextTarget?.area;
  if (area === 'speed-dial' || area === 'speed-dial-item') {
    return [...(board.sharedTags || [])];
  }
  if (area === 'board-item' || area === 'board-empty' || area === 'board-subfolder') {
    const boardTags = board.sharedTags || [];
    let parentFolderId = null;
    if (area === 'board-subfolder') parentFolderId = contextTarget.item?.id;
    else if (contextTarget.parentId) parentFolderId = contextTarget.parentId;
    const folderTags = parentFolderId ? collectFolderAncestorTags(board, parentFolderId) : [];
    return [...new Set([...boardTags, ...folderTags])];
  }
  return [];
}

function getBoardInheritedTags() {
  const board = getActiveBoard();
  if (!board) return [];
  return getBoardNavInheritedTags(board.id);
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
    document.getElementById('modalSpeedDialSlots').value = options.speedDialSlotCount || DEFAULT_SPEED_DIAL_SLOT_COUNT;
    const showToggle = document.getElementById('cmCollectionShowSpeedDial');
    if (showToggle) showToggle.checked = options.collectionShowSpeedDial !== false;
  }
  const sharedTagsOptsEl = document.getElementById('modalSharedTagsOptions');
  if (sharedTagsOptsEl) {
    sharedTagsOptsEl.classList.toggle('hidden', !options.showSharedTagsOptions);
    document.getElementById('cmInheritTags').checked = options.inheritTags !== false;
    document.getElementById('cmAutoRemove').checked = options.autoRemoveTags === true;
  }
  elements.modalSelectRow.classList.toggle('hidden', !options.showSelect);
  elements.modalInput1.placeholder = options.placeholder1 || 'Enter name';
  elements.modalInput2.placeholder = options.placeholder2 || 'Enter URL';
  const selectLabel = document.getElementById('modalSelectLabel');
  if (selectLabel) selectLabel.textContent = options.selectLabel || 'Select';
  if (options.selectOptions) {
    elements.modalSelect.innerHTML = '';
    options.selectOptions.forEach(({ value, label }) => elements.modalSelect.appendChild(new Option(label, value)));
  } else {
    elements.modalSelect.value = options.selectValue || '';
  }
  document.getElementById('modalDuplicateWarning')?.classList.add('hidden');
  const inherited = options.inheritedTags || [];
  const inheritedRow = document.getElementById('modalInheritedTagsRow');
  const inheritedSpan = document.getElementById('modalInheritedTags');
  if (inheritedRow && inheritedSpan) {
    inheritedSpan.innerHTML = '';
    renderTagsInto(inheritedSpan, inherited);
    inheritedRow.classList.toggle('hidden', inherited.length === 0);
  }
  if (showName) elements.modalInput1.focus();
  else if (options.showTags) elements.modalInput3.focus();
  else if (options.showSelect) elements.modalSelect.focus();
}

function applyModalCollectionSpeedDialSlots() {
  if (activeModal !== 'editCollection') return null;
  const slotsInput = document.getElementById('modalSpeedDialSlots');
  const speedDialSection = document.getElementById('modalSpeedDialSection');
  if (!slotsInput || speedDialSection?.classList.contains('hidden')) return null;
  const coll = contextTarget?.collectionId
    ? findCollectionById(contextTarget.collectionId)
    : findCollectionById(state.activeCollectionId);
  if (!coll) return null;
  normalizeSpeedDialSlots(coll);
  const requested = Math.max(1, Math.min(48, parseInt(slotsInput.value, 10) || DEFAULT_SPEED_DIAL_SLOT_COUNT));
  const lastFilled = coll.speedDial.reduce((idx, item, i) => item ? i : idx, -1);
  coll.speedDialSlotCount = Math.max(requested, lastFilled + 1, 1);
  slotsInput.value = coll.speedDialSlotCount;
  return coll;
}

function handleModalSpeedDialSlotsInput() {
  const coll = applyModalCollectionSpeedDialSlots();
  if (!coll) return;
  if (state.activeCollectionId === coll.id || findBoardCollection(state.activeBoardId)?.id === coll.id) {
    renderBoard();
  }
  saveState();
}

function handleModalCollectionShowSpeedDialChange() {
  if (activeModal !== 'editCollection') return;
  const coll = contextTarget?.collectionId
    ? findCollectionById(contextTarget.collectionId)
    : findCollectionById(state.activeCollectionId);
  if (!coll) return;
  coll.showSpeedDial = document.getElementById('cmCollectionShowSpeedDial').checked;
  if (state.activeCollectionId === coll.id || findBoardCollection(state.activeBoardId)?.id === coll.id) {
    renderBoard();
  }
  saveState();
}

function hideModal() {
  activeModal = null;
  document.getElementById('modalCard').classList.add('hidden');
  elements.modalOverlay.classList.add('hidden');
  document.getElementById('tagSuggestions')?.classList.add('hidden');
  document.getElementById('modalDuplicateWarning')?.classList.add('hidden');
  document.getElementById('modalSharedTagsRow')?.classList.add('hidden');
  document.getElementById('modalSharedTagsOptions')?.classList.add('hidden');
  document.getElementById('modalSpeedDialSection')?.classList.add('hidden');
  document.getElementById('modalInheritedTagsRow')?.classList.add('hidden');
}

function handleModalSubmit(event) {
  event.preventDefault();
  const value1 = elements.modalInput1.value.trim();
  const value2 = elements.modalInput2.value.trim();
  const value3 = elements.modalInput3.value.trim();
  const value4 = elements.modalInput4.value.trim();
  const tags = value3 ? value3.split(/\s+/).filter(Boolean) : [];
  const sharedTagsFromModal = value4 ? value4.split(/\s+/).filter(Boolean) : [];

  const noNameRequired = ['moveToBoard', 'bulkMoveToBoard', 'bulkAddTags'];
  if (!value1 && !noNameRequired.includes(activeModal)) return;

  pushUndoSnapshot();
  const area = contextTarget?.area;

  switch (activeModal) {
    case 'addBookmark': {
      const fc = contextTarget?.faviconCache || '';
      if (area === 'speed-dial' || area === 'speed-dial-item' || area === 'collection-speed-dial') {
        addSpeedDialBookmark(value1, value2, tags, fc);
      } else if (area === 'set') {
        const set = findSetById(contextTarget.setId);
        if (!set) return;
        const result = addBookmarkToSet(set, { title: value1, url: value2, tags, faviconCache: fc });
        if (!result.ok) {
          alert(result.reason === 'duplicate' ? 'That URL is already in this set.' : 'Please enter a valid URL.');
          return;
        }
      } else if (area === 'essential') {
        if (!setEssential(contextTarget.slot, value1, value2, tags, fc)) return;
        hideModal(); renderEssentials(); saveState(); return;
      } else if (area === 'board-folder-item') {
        if (!isValidUrl(value2)) { alert('Please enter a valid URL.'); return; }
        contextTarget.item.children.push({ id: `bm-${Date.now()}`, type: 'bookmark', title: value1, url: normalizeUrl(value2), tags, faviconCache: fc });
        contextTarget.item.collapsed = false;
      } else {
        addBookmark(value1, value2, contextTarget?.columnId, tags, fc);
      }
      break;
    }
    case 'editBookmark':
      if (area === 'speed-dial-item') {
        if (!isValidUrl(value2)) { alert('Please enter a valid URL.'); return; }
        const board = getActiveBoard();
        const sdItem = board.speedDial.find(i => i?.id === contextTarget?.itemId);
        if (sdItem) { if (normalizeUrl(value2) !== sdItem.url) sdItem.faviconCache = ''; sdItem.title = value1; sdItem.url = normalizeUrl(value2); sdItem.tags = tags; }
      } else if (area === 'collection-speed-dial') {
        if (!isValidUrl(value2)) { alert('Please enter a valid URL.'); return; }
        const coll = findCollectionById(contextTarget.collectionId);
        const sdItem = coll?.speedDial.find(i => i?.id === contextTarget?.itemId);
        if (sdItem) { if (normalizeUrl(value2) !== sdItem.url) sdItem.faviconCache = ''; sdItem.title = value1; sdItem.url = normalizeUrl(value2); sdItem.tags = tags; }
      } else if (area === 'set-item') {
        if (!isValidUrl(value2)) { alert('Please enter a valid URL.'); return; }
        const set = findSetById(contextTarget.setId);
        const found = findSetItemById(set, contextTarget.itemId);
        if (!found?.item) break;
        const normalized = normalizeUrl(value2);
        const duplicate = (set.items || []).some(entry => entry.id !== found.item.id && entry.url === normalized);
        if (duplicate) { alert('That URL is already in this set.'); return; }
        if (normalized !== found.item.url) found.item.faviconCache = '';
        found.item.title = value1;
        found.item.url = normalized;
        found.item.tags = tags;
        touchSet(set);
      } else if (area === 'essential') {
        if (!setEssential(contextTarget.slot, value1, value2, tags, '', true)) return;
        hideModal(); renderEssentials(); saveState(); return;
      } else {
        editBookmarkContext(value1, value2, tags, contextTarget);
      }
      break;
    case 'addFolder': {
      const parent = contextTarget?.item;
      if (area === 'nav-empty') {
        addNavSection({ type: 'folder', title: value1 });
      } else if (area === 'nav-subfolder') {
        if (parent) { parent.children = parent.children || []; parent.children.push({ id: `id-${Date.now()}`, type: 'folder', title: value1, children: [] }); parent.collapsed = false; }
      }
      break;
    }
    case 'addTitle':
      if (area === 'nav-empty') addNavSection({ type: 'title', title: value1 });
      else addBookmarkItem('title', value1, contextTarget?.columnId);
      break;
    case 'renameItem':
      renameContextItem(value1, contextTarget);
      break;
    case 'renameCollection': {
      const coll = findCollectionById(state.activeCollectionId);
      if (coll && value1.trim()) coll.title = value1.trim();
      break;
    }
    case 'editCollection': {
      const coll = contextTarget?.collectionId
        ? findCollectionById(contextTarget.collectionId)
        : findCollectionById(state.activeCollectionId);
      if (!coll) break;
      if (value1.trim()) coll.title = value1.trim();
      applyModalCollectionSpeedDialSlots();
      const sdSection = document.getElementById('modalSpeedDialSection');
      if (sdSection && !sdSection.classList.contains('hidden')) {
        coll.showSpeedDial = document.getElementById('cmCollectionShowSpeedDial').checked;
      }
      coll.tags = tags;
      coll.sharedTags = sharedTagsFromModal;
      const sharedTagsOptsEl2 = document.getElementById('modalSharedTagsOptions');
      if (sharedTagsOptsEl2 && !sharedTagsOptsEl2.classList.contains('hidden')) {
        coll.inheritTags = document.getElementById('cmInheritTags').checked;
        coll.autoRemoveTags = document.getElementById('cmAutoRemove').checked;
      }
      break;
    }
    case 'addCollection': {
      const coll = createCollection(value1);
      const sdSection = document.getElementById('modalSpeedDialSection');
      if (sdSection && !sdSection.classList.contains('hidden')) {
        normalizeSpeedDialSlots(coll);
        const slotsInput = document.getElementById('modalSpeedDialSlots');
        const requested = Math.max(1, Math.min(48, parseInt(slotsInput?.value, 10) || DEFAULT_SPEED_DIAL_SLOT_COUNT));
        coll.speedDialSlotCount = Math.max(requested, 1);
        coll.showSpeedDial = document.getElementById('cmCollectionShowSpeedDial')?.checked !== false;
      }
      coll.tags = tags;
      coll.sharedTags = sharedTagsFromModal;
      const sharedTagsOptsEl3 = document.getElementById('modalSharedTagsOptions');
      if (sharedTagsOptsEl3 && !sharedTagsOptsEl3.classList.contains('hidden')) {
        coll.inheritTags = document.getElementById('cmInheritTags').checked;
        coll.autoRemoveTags = document.getElementById('cmAutoRemove').checked;
      }
      renderAll();
      saveState();
      break;
    }
    case 'moveToBoard': {
      const targetBoard = state.boards.find(b => b.id === elements.modalSelect.value);
      if (!targetBoard || !contextTarget?.item) break;
      const area = contextTarget.area;
      const capturedItem = cloneData(contextTarget.item);
      if (!capturedItem.tags) capturedItem.tags = [];
      if (area === 'speed-dial-item') {
        capturedItem.type = 'bookmark';
        const board = getActiveBoard();
        removeSpeedDialItemById(board, contextTarget.itemId);
      } else if (area === 'collection-speed-dial') {
        capturedItem.type = 'bookmark';
        const coll = findCollectionById(contextTarget.collectionId);
        if (coll) removeSpeedDialItemById(coll, contextTarget.itemId);
      } else if (area === 'essential') {
        capturedItem.type = 'bookmark';
        removeEssential(contextTarget.slot);
        trimEssentialsTail();
      } else {
        deleteBoardTarget(contextTarget);
      }
      (getBoardInbox(targetBoard) || targetBoard.columns[0]).items.push(capturedItem);
      break;
    }
    case 'bulkAddTags': {
      const newTags = value3 ? value3.split(/\s+/).filter(Boolean) : [];
      if (!newTags.length) { hideModal(); return; }
      const board = getActiveBoard();
      for (const itemId of selectedItemIds) {
        const found = findBoardItemInColumns(board, itemId);
        if (found?.item) found.item.tags = [...new Set([...(found.item.tags || []), ...newTags])];
      }
      clearSelection();
      break;
    }
    case 'bulkMoveToBoard': {
      const targetBoard = state.boards.find(b => b.id === elements.modalSelect.value);
      if (!targetBoard) break;
      const board = getActiveBoard();
      const toMove = [];
      for (const itemId of selectedItemIds) {
        const found = findBoardItemInColumns(board, itemId);
        if (found?.item) toMove.push(found);
      }
      toMove.forEach(({ item, list }) => {
        list.splice(list.indexOf(item), 1);
        (getBoardInbox(targetBoard) || targetBoard.columns[0]).items.push(item);
      });
      clearSelection();
      break;
    }
    default:
      break;
  }

  hideModal();
  renderAll();
  saveState();
}

// --- Folder modal ---

let folderModalMode = 'create';

function showFolderModal(mode, ct) {
  folderModalMode = mode;
  if (ct) contextTarget = ct;
  document.getElementById('modalCard').classList.add('hidden');
  const panel = document.getElementById('folderModal');
  panel.classList.remove('hidden');
  elements.modalOverlay.classList.remove('hidden');
  const submitBtn = document.getElementById('folderModalSubmitBtn');
  document.getElementById('fmSubtitle').textContent = mode === 'edit' ? 'Edit Folder' : 'New Folder';
  if (mode === 'edit') {
    submitBtn.textContent = 'Save';
    let folderItem = null;
    if (contextTarget.area === 'nav-item') {
      folderItem = findNavItemPath(contextTarget.itemId)?.item;
    } else {
      folderItem = findBoardItemInColumns(getActiveBoard(), contextTarget.itemId)?.item;
    }
    if (folderItem) {
      document.getElementById('fmName').value = folderItem.title || '';
      document.getElementById('fmTags').value = (folderItem.tags || []).join(' ');
      document.getElementById('fmSharedTags').value = (folderItem.sharedTags || []).join(' ');
      document.getElementById('fmInheritTags').checked = folderItem.inheritTags !== false;
      document.getElementById('fmAutoRemove').checked = folderItem.autoRemoveTags === true;
    }
  } else {
    submitBtn.textContent = 'Create';
    document.getElementById('fmName').value = '';
    document.getElementById('fmTags').value = '';
    document.getElementById('fmSharedTags').value = '';
    document.getElementById('fmInheritTags').checked = true;
    document.getElementById('fmAutoRemove').checked = true;
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
  document.getElementById('folderModal').classList.add('hidden');
  document.getElementById('modalCard').classList.remove('hidden');
  elements.modalOverlay.classList.add('hidden');
}

function handleFolderModalSubmit() {
  const name = document.getElementById('fmName').value.trim();
  if (!name) { document.getElementById('fmName').focus(); return; }
  const tags = document.getElementById('fmTags').value.trim().split(/\s+/).filter(Boolean);
  const sharedTags = document.getElementById('fmSharedTags').value.trim().split(/\s+/).filter(Boolean);
  const inheritTags = document.getElementById('fmInheritTags').checked;
  const autoRemoveTags = document.getElementById('fmAutoRemove').checked;
  pushUndoSnapshot();
  if (folderModalMode === 'edit') {
    editFolder(contextTarget.itemId, name, tags, sharedTags, inheritTags, autoRemoveTags);
  } else {
    const area = contextTarget?.area;
    const parent = contextTarget?.item;
    if (area === 'nav-empty') {
      addNavSection({ type: 'folder', title: name, tags, sharedTags, inheritTags, autoRemoveTags });
    } else if (area === 'nav-subfolder') {
      if (parent) {
        parent.children = parent.children || [];
        parent.children.push({ id: `id-${Date.now()}`, type: 'folder', title: name, children: [], tags, sharedTags, inheritTags, autoRemoveTags });
        parent.collapsed = false;
      }
    } else if (area === 'board-subfolder') {
      if (parent) {
        parent.children = parent.children || [];
        parent.children.push({ id: `id-${Date.now()}`, type: 'folder', title: name, children: [], tags, sharedTags, inheritTags, autoRemoveTags });
        parent.collapsed = false;
      }
    } else {
      addBookmarkItem('folder', name, contextTarget?.columnId, { tags, sharedTags, inheritTags, autoRemoveTags });
    }
  }
  hideFolderModal();
  renderAll();
  saveState();
}

function attachFolderModalListeners() {
  document.getElementById('folderModalCancelBtn').addEventListener('click', hideFolderModal);
  document.getElementById('folderModalSubmitBtn').addEventListener('click', handleFolderModalSubmit);
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
    showTags: true
  });
}
