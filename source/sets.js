const SETS_MANAGER_POS_KEY = 'morpheus-sets-manager-pos';

let setsManagerPanelOpen = false;
let selectedSetId = null;

function _setPanelCountLabel(count) {
  return `${count} bookmark${count === 1 ? '' : 's'}`;
}

function _saveSetPanelPos() {
  const panel = document.getElementById('setsManagerPanel');
  if (!panel) return;
  const rect = panel.getBoundingClientRect();
  localStorage.setItem(SETS_MANAGER_POS_KEY, JSON.stringify({ x: rect.left, y: rect.top }));
}

function _restoreSetPanelPos(panel) {
  try {
    const pos = JSON.parse(localStorage.getItem(SETS_MANAGER_POS_KEY));
    if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
      panel.style.left = `${pos.x}px`;
      panel.style.top = `${pos.y}px`;
      return true;
    }
  } catch {}
  return false;
}

function _ensureSelectedSet() {
  if (!Array.isArray(state.sets) || state.sets.length === 0) {
    selectedSetId = null;
    return null;
  }
  const selected = findSetById(selectedSetId);
  if (selected) return selected;
  selectedSetId = state.sets[0].id;
  return state.sets[0];
}

function showSetManagerPanel() {
  setsManagerPanelOpen = true;
  const panel = document.getElementById('setsManagerPanel');
  if (!panel) return;
  panel.classList.remove('hidden');
  panel.classList.add('draggable');
  if (!_restoreSetPanelPos(panel)) centerPanel(panel);
  makeDraggable(panel, document.getElementById('setsManagerHeader'), _saveSetPanelPos);
  _ensureSelectedSet();
  renderSetManagerPanel();
}

function hideSetManagerPanel() {
  setsManagerPanelOpen = false;
  document.getElementById('setsManagerPanel')?.classList.add('hidden');
}

function showSetManagerForSet(setId, options = {}) {
  const set = findSetById(setId);
  if (!set) return;
  selectedSetId = set.id;
  showSetManagerPanel();
  if (options.focusTitle) {
    requestAnimationFrame(() => document.getElementById('setsManagerTitleInput')?.focus());
  }
}

function openSetById(setId) {
  const set = findSetById(setId);
  const urls = collectSetUrls(set);
  if (!urls.length) {
    showNotice('This set has no bookmarks to open yet.');
    return;
  }
  for (let i = urls.length - 1; i >= 0; i--) {
    const url = urls[i];
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noreferrer noopener';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
  }
}

function _createSetPreviewFavicon(item) {
  const chip = document.createElement('span');
  chip.className = 'sets-preview-favicon';
  if (item?.url) {
    const img = document.createElement('img');
    setFavicon(img, item, 32);
    img.alt = '';
    img.draggable = false;
    chip.appendChild(img);
  } else {
    chip.textContent = (item?.title || '?').slice(0, 1).toUpperCase();
  }
  return chip;
}

function createSetManagerItem(set, item) {
  const el = document.createElement('div');
  el.className = 'board-column-item bookmark-item set-manager-item';
  el.dataset.itemId = item.id;
  el.dataset.setId = set.id;
  el.dataset.tooltip = buildTooltip(item);
  el.draggable = true;

  const header = document.createElement('div');
  header.className = 'item-header';
  const favicon = document.createElement('span');
  favicon.className = 'bookmark-favicon';
  if (item.url) {
    const img = document.createElement('img');
    setFavicon(img, item, 64);
    img.alt = '';
    img.draggable = false;
    favicon.appendChild(img);
  }
  header.appendChild(favicon);

  const name = document.createElement('span');
  name.className = 'bookmark-label';
  name.textContent = item.title || item.url || 'Untitled Bookmark';
  header.appendChild(name);
  el.appendChild(header);

  if (item.url) {
    const url = document.createElement('span');
    url.className = 'search-result-url';
    url.textContent = item.url;
    el.appendChild(url);
  }
  if (item.tags?.length) {
    const tagsEl = document.createElement('div');
    tagsEl.className = 'item-tag-chips';
    renderTagsInto(tagsEl, item.tags);
    el.appendChild(tagsEl);
  }

  el.addEventListener('click', () => {
    if (item.url) window.open(item.url, '_blank', 'noreferrer noopener');
  });
  el.addEventListener('contextmenu', event => {
    event.preventDefault();
    event.stopPropagation();
    contextTarget = { area: 'set-item', setId: set.id, itemId: item.id, item };
    showContextMenu(event.clientX, event.clientY, [
      { label: 'Open in new tab', action: 'openNewTab' },
      { label: 'Open in new window', action: 'openNewWindow' },
      { label: 'Edit bookmark', action: 'editBookmark' },
      { label: 'Remove from set', action: 'deleteSetItem' }
    ]);
  });
  el.addEventListener('dragstart', event => {
    dragPayload = { area: 'set-manager', setId: set.id, itemId: item.id, itemType: 'bookmark' };
    event.dataTransfer.setData('text/plain', item.id);
    event.dataTransfer.effectAllowed = 'move';
    applyDragImage(event, el);
  });
  el.addEventListener('dragend', () => {
    el.classList.remove('dragging');
    dragPayload = null;
    removeDragPlaceholders();
    _clearSetDropDecorations();
  });

  return el;
}

function renderSetManagerPanel() {
  const listEl = document.getElementById('setsManagerList');
  const emptyEl = document.getElementById('setsManagerEmpty');
  const detailCard = document.getElementById('setsManagerDetailCard');
  const previewEl = document.getElementById('setsManagerPreview');
  const titleInput = document.getElementById('setsManagerTitleInput');
  if (!listEl || !emptyEl || !detailCard || !previewEl || !titleInput) return;

  const selected = _ensureSelectedSet();
  listEl.innerHTML = '';

  for (const set of (state.sets || [])) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = `sets-manager-row${set.id === selectedSetId ? ' active' : ''}`;
    row.dataset.setId = set.id;

    const iconWrap = document.createElement('span');
    iconWrap.className = 'sets-manager-row-icon';
    iconWrap.appendChild(icon('icon-set'));
    row.appendChild(iconWrap);

    const info = document.createElement('span');
    info.className = 'sets-manager-row-info';
    const title = document.createElement('span');
    title.className = 'sets-manager-row-title';
    title.textContent = set.title || 'Untitled Set';
    const meta = document.createElement('span');
    meta.className = 'sets-manager-row-meta';
    meta.textContent = _setPanelCountLabel((set.items || []).length);
    info.appendChild(title);
    info.appendChild(meta);
    row.appendChild(info);

    const chips = document.createElement('span');
    chips.className = 'sets-preview-strip';
    (set.items || []).slice(0, 3).forEach(item => chips.appendChild(_createSetPreviewFavicon(item)));
    row.appendChild(chips);

    row.addEventListener('click', () => {
      selectedSetId = set.id;
      renderSetManagerPanel();
    });
    row.addEventListener('contextmenu', event => {
      event.preventDefault();
      event.stopPropagation();
      contextTarget = { area: 'set', setId: set.id, item: set };
      showContextMenu(event.clientX, event.clientY, [
        { label: 'Open set', action: 'openSet' },
        { label: 'Manage set', action: 'editSet' },
        { label: 'Delete set', action: 'deleteSet' }
      ]);
    });

    listEl.appendChild(row);
  }

  if (!selected) {
    emptyEl.classList.remove('hidden');
    detailCard.classList.add('hidden');
    previewEl.innerHTML = '';
    titleInput.value = '';
    return;
  }

  emptyEl.classList.add('hidden');
  detailCard.classList.remove('hidden');
  if (document.activeElement !== titleInput) titleInput.value = selected.title || '';
  document.getElementById('setsManagerDetailMeta').textContent = _setPanelCountLabel((selected.items || []).length);
  previewEl.innerHTML = '';
  previewEl.classList.remove('drag-over');

  if (!(selected.items || []).length) {
    const empty = document.createElement('div');
    empty.className = 'sets-empty sets-empty--compact';
    empty.textContent = 'Drag bookmarks here to copy them into this set, or use Add Bookmark.';
    previewEl.appendChild(empty);
    return;
  }

  selected.items.forEach(item => previewEl.appendChild(createSetManagerItem(selected, item)));
}

function _clearSetDropDecorations() {
  document.querySelectorAll('#setsManagerPreview .drop-target').forEach(el => el.classList.remove('drop-target'));
  document.querySelectorAll('#setsManagerPreview .drop-position-before, #setsManagerPreview .drop-position-after').forEach(el => {
    el.classList.remove('drop-position-before', 'drop-position-after');
    el.removeAttribute('data-drop-position');
  });
  document.getElementById('setsManagerPreview')?.classList.remove('drag-over');
}

function _canCopyBookmarkIntoSet() {
  if (!dragPayload) return false;
  if (dragPayload.area === 'board') return dragPayload.itemType === 'bookmark';
  if (dragPayload.area === 'speed-dial') return true;
  if (dragPayload.area === 'collection-speed-dial') return true;
  if (dragPayload.area === 'essential') return !!state.essentials?.[dragPayload.slot];
  if (dragPayload.area === 'set-manager') return dragPayload.setId !== selectedSetId;
  return false;
}

function _getBookmarkFromSetDragPayload() {
  if (!dragPayload) return null;
  if (dragPayload.area === 'board') {
    if (dragPayload.itemType !== 'bookmark') return null;
    return findBoardItemInColumns(getActiveBoard(), dragPayload.itemId)?.item || null;
  }
  if (dragPayload.area === 'speed-dial') {
    return getActiveBoard()?.speedDial?.find(item => item?.id === dragPayload.itemId) || null;
  }
  if (dragPayload.area === 'collection-speed-dial') {
    return findCollectionById(dragPayload.collectionId)?.speedDial?.find(item => item?.id === dragPayload.itemId) || null;
  }
  if (dragPayload.area === 'essential') {
    return state.essentials?.[dragPayload.slot] || null;
  }
  if (dragPayload.area === 'set-manager') {
    return findSetById(dragPayload.setId)?.items?.find(item => item?.id === dragPayload.itemId) || null;
  }
  return null;
}

function _resolveSetDropPosition(event, element) {
  const rect = element.getBoundingClientRect();
  return event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
}

function _reorderSetItem(set, draggedItemId, targetItemId, position) {
  const fromIndex = (set.items || []).findIndex(item => item.id === draggedItemId);
  const targetIndex = (set.items || []).findIndex(item => item.id === targetItemId);
  if (fromIndex === -1 || targetIndex === -1) return false;
  let insertIndex = targetIndex + (position === 'after' ? 1 : 0);
  const [dragged] = set.items.splice(fromIndex, 1);
  if (fromIndex < insertIndex) insertIndex--;
  set.items.splice(insertIndex, 0, dragged);
  touchSet(set);
  return true;
}

function _createSetDropGhost() {
  const el = document.createElement('div');
  el.className = 'board-column-item bookmark-item drag-preview set-manager-item';

  const header = document.createElement('div');
  header.className = 'item-header';
  const iconWrap = document.createElement('span');
  iconWrap.className = 'bookmark-favicon';
  const previewIcon = typeof icon === 'function' ? icon('icon-bookmark-add') : null;
  if (previewIcon) iconWrap.appendChild(previewIcon);
  else iconWrap.textContent = '+';
  header.appendChild(iconWrap);

  const name = document.createElement('span');
  name.className = 'bookmark-label';
  name.textContent = 'Drop bookmark here';
  header.appendChild(name);
  el.appendChild(header);

  return el;
}

function _createSetDragPreview(bookmark) {
  if (!bookmark) return _createSetDropGhost();
  const set = { id: '__preview__' };
  const previewItem = {
    id: `preview-${bookmark.id || normalizeUrl(bookmark.url || '') || 'bookmark'}`,
    title: bookmark.title || bookmark.url || 'Untitled Bookmark',
    url: bookmark.url || '',
    tags: Array.isArray(bookmark.tags) ? bookmark.tags : [],
    faviconCache: bookmark.faviconCache || ''
  };
  const el = createSetManagerItem(set, previewItem);
  el.classList.add('drag-preview');
  el.removeAttribute('draggable');
  el.removeAttribute('data-drop-position');
  el.querySelectorAll('[data-drop-position]').forEach(node => node.removeAttribute('data-drop-position'));
  return el;
}

function _resolveSetPreviewBookmark(event) {
  return dragPayload ? _getBookmarkFromSetDragPayload() : getExternalDrop(event);
}

function _moveSetPreview(parentEl, beforeEl, event) {
  _clearDropDecorations(false);
  const existing = document.querySelector('#setsManagerPreview .drag-preview');
  if (existing && existing.parentElement === parentEl) {
    parentEl.insertBefore(existing, beforeEl || null);
  } else {
    if (existing) existing.remove();
    const preview = _createSetDragPreview(_resolveSetPreviewBookmark(event));
    _insertDragPreview(preview, parentEl, beforeEl);
  }
}

function handleSetManagerBodyDragOver(event) {
  const set = _ensureSelectedSet();
  if (!set) return;
  const isInternalReorder = dragPayload?.area === 'set-manager' && dragPayload?.setId === set.id;
  const isCopyDrag = _canCopyBookmarkIntoSet();
  if (!isInternalReorder && !isCopyDrag && !isExternalDrag(event)) return;
  event.preventDefault();
  event.stopPropagation();
  const preview = document.getElementById('setsManagerPreview');
  if (!preview) return;

  const itemEls = Array.from(preview.querySelectorAll(':scope > .set-manager-item:not(.drag-preview):not(.dragging)'));
  if (itemEls.length === 0) {
    if (_dropTarget === preview && _dropPos === 'start') return;
    _dropTarget = preview;
    _dropPos = 'start';
    _moveSetPreview(preview, preview.firstChild, event);
    return;
  }

  let nearestEl = null;
  let nearestPos = 'after';
  for (const el of itemEls) {
    const rect = el.getBoundingClientRect();
    if (event.clientY <= rect.bottom) {
      nearestEl = el;
      nearestPos = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
      break;
    }
  }

  if (!nearestEl) {
    if (_dropTarget === preview && _dropPos === 'end') return;
    _dropTarget = preview;
    _dropPos = 'end';
    _moveSetPreview(preview, null, event);
    return;
  }

  if (_dropTarget === nearestEl && _dropPos === nearestPos) return;
  _dropTarget = nearestEl;
  _dropPos = nearestPos;
  _moveSetPreview(preview, nearestPos === 'before' ? nearestEl : nearestEl.nextSibling, event);
  nearestEl.dataset.dropPosition = nearestPos;
  nearestEl.classList.toggle('drop-position-before', nearestPos === 'before');
  nearestEl.classList.toggle('drop-position-after', nearestPos === 'after');
}

function handleSetManagerBodyDrop(event) {
  const set = _ensureSelectedSet();
  const body = document.getElementById('setsManagerPreview');
  if (!set) return;
  event.preventDefault();
  event.stopPropagation();
  const savedTarget = _dropTarget;
  const savedPos = _dropPos;
  _clearSetDropDecorations();

  if (dragPayload?.area === 'set-manager' && dragPayload?.setId === set.id) {
    if (!savedTarget || savedTarget === body) {
      const lastItemId = set.items[set.items.length - 1]?.id;
      if (!lastItemId || dragPayload.itemId === lastItemId) { dragPayload = null; return; }
      pushUndoSnapshot();
      _reorderSetItem(set, dragPayload.itemId, lastItemId, 'after');
      dragPayload = null;
      renderSetManagerPanel();
      saveState();
      return;
    }
    const targetItemId = savedTarget.dataset.itemId;
    if (!targetItemId || dragPayload.itemId === targetItemId) { dragPayload = null; return; }
    pushUndoSnapshot();
    _reorderSetItem(set, dragPayload.itemId, targetItemId, savedPos || 'before');
    dragPayload = null;
    renderSetManagerPanel();
    saveState();
    return;
  }

  const bookmark = isExternalDrag(event) ? getExternalDrop(event) : _getBookmarkFromSetDragPayload();
  if (!bookmark) return;
  pushUndoSnapshot();
  let insertIndex = set.items.length;
  if (savedTarget && savedTarget !== body) {
    const targetIndex = (set.items || []).findIndex(entry => entry.id === savedTarget.dataset.itemId);
    if (targetIndex !== -1) {
      insertIndex = targetIndex + ((savedPos || 'before') === 'after' ? 1 : 0);
    }
  } else if (savedPos === 'start') {
    insertIndex = 0;
  }
  const result = addBookmarkToSet(set, bookmark, { index: insertIndex });
  if (!result.ok) {
    showNotice(result.reason === 'duplicate' ? 'That URL is already in this set.' : 'Unable to add bookmark to this set.');
    return;
  }
  dragPayload = null;
  renderSetManagerPanel();
  saveState();
}

function attachSetPanelListeners() {
  document.getElementById('quickSetsBtn')?.addEventListener('click', () => {
    if (setsManagerPanelOpen) hideSetManagerPanel();
    else showSetManagerPanel();
  });

  document.getElementById('setsManagerDoneBtn')?.addEventListener('click', hideSetManagerPanel);
  document.getElementById('setsManagerNewBtn')?.addEventListener('click', () => {
    pushUndoSnapshot();
    const set = createSet('New Set');
    selectedSetId = set.id;
    renderAll();
    saveState();
    showSetManagerPanel();
    requestAnimationFrame(() => document.getElementById('setsManagerTitleInput')?.focus());
  });
  document.getElementById('setsManagerOpenBtn')?.addEventListener('click', () => {
    if (selectedSetId) openSetById(selectedSetId);
  });
  document.getElementById('setsManagerAddBtn')?.addEventListener('click', () => {
    if (!selectedSetId) return;
    contextTarget = { area: 'set', setId: selectedSetId };
    showModal('addBookmark', {
      title: 'Add Bookmark to Set',
      placeholder1: 'Bookmark title',
      showUrl: true,
      placeholder2: 'Bookmark URL',
      showTags: true,
      contextTarget
    });
  });
  document.getElementById('setsManagerDeleteBtn')?.addEventListener('click', () => {
    const set = findSetById(selectedSetId);
    if (!set) return;
    contextTarget = { area: 'set', setId: set.id, item: set };
    handleContextMenuAction('deleteSet');
  });
  document.getElementById('setsManagerTitleInput')?.addEventListener('input', event => {
    const set = _ensureSelectedSet();
    if (!set) return;
    set.title = event.target.value.trim() || 'Untitled Set';
    touchSet(set);
    renderSetManagerPanel();
    saveState();
  });

  const body = document.getElementById('setsManagerPreview');
  body?.addEventListener('contextmenu', event => {
    if (event.target.closest('.set-manager-item')) return;
    event.preventDefault();
    const set = _ensureSelectedSet();
    if (!set) return;
    contextTarget = { area: 'set', setId: set.id, item: set };
    showContextMenu(event.clientX, event.clientY, [
      { label: 'Add bookmark', action: 'addSetBookmark' },
      { label: 'Open set', action: 'openSet' }
    ]);
  });
  body?.addEventListener('dragover', handleSetManagerBodyDragOver);
  body?.addEventListener('dragleave', event => {
    const nextEl = document.elementFromPoint(event.clientX, event.clientY);
    if (nextEl && body.contains(nextEl)) return;
    _clearSetDropDecorations();
  });
  body?.addEventListener('drop', handleSetManagerBodyDrop);
}
