let dragPayload = null;
let _dropTarget = null;
let _dropPos    = null;

function _canDropAsNavWidget() {
  if (!dragPayload || dragPayload.area !== 'board' || dragPayload.itemType !== 'widget') return false;
  return !!WIDGET_REGISTRY[dragPayload.widgetType]?.allowedIn?.includes('navpane');
}

function _canDropAsColumnWidget() {
  if (!dragPayload || dragPayload.area !== 'nav' || dragPayload.itemType !== 'widget') return false;
  return !!WIDGET_REGISTRY[dragPayload.widgetType]?.allowedIn?.includes('column');
}

// Returns true when the active drag payload contains a bookmark or folder
// that can be sent to another board's inbox.
function _canSendToInbox() {
  if (!dragPayload) return false;
  if (dragPayload.area === 'board') return ['bookmark', 'folder'].includes(dragPayload.itemType);
  if (dragPayload.area === 'speed-dial') return true;
  if (dragPayload.area === 'essential') return !!state.essentials[dragPayload.slot];
  if (dragPayload.area === 'collection-speed-dial') return true;
  if (dragPayload.area === 'nav') {
    const path = findNavItemPath(dragPayload.itemId);
    const item = path?.list.find(i => i.id === dragPayload.itemId);
    return !!item && ['bookmark', 'folder'].includes(item.type);
  }
  return false;
}

function isExternalDrag(event) {
  return !dragPayload;
}

function getExternalDrop(event) {
  // Firefox rich bookmark drag — includes the cached favicon as iconuri
  const mozPlace = event.dataTransfer.getData('application/x-moz-place') ||
                   event.dataTransfer.getData('application/x-moz-place+json');
  if (mozPlace) {
    try {
      const data = JSON.parse(mozPlace);
      if (data.uri) {
        const faviconCache = (data.iconuri && data.iconuri.startsWith('data:')) ? data.iconuri : '';
        return { url: data.uri, title: data.title || '', faviconCache };
      }
    } catch {}
  }
  const mozUrl = event.dataTransfer.getData('text/x-moz-url');
  if (mozUrl) {
    const [url, title] = mozUrl.split('\n');
    return { url: (url || '').trim(), title: (title || '').trim(), faviconCache: '' };
  }
  const uriList = event.dataTransfer.getData('text/uri-list');
  if (uriList) {
    const url = uriList.split('\n').map(l => l.trim()).find(l => l && !l.startsWith('#'));
    if (url) return { url, title: '', faviconCache: '' };
  }
  const text = event.dataTransfer.getData('text/plain');
  if (text?.trim().match(/^https?:\/\//)) return { url: text.trim(), title: '', faviconCache: '' };
  return null;
}

function removeDragPlaceholders() {
  _dropTarget = null;
  _dropPos    = null;
  document.querySelectorAll('.drag-placeholder, .drag-preview').forEach(el => el.remove());
  document.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target'));
  document.querySelectorAll('.drop-position-before, .drop-position-after').forEach(el => {
    el.classList.remove('drop-position-before', 'drop-position-after');
    el.removeAttribute('data-drop-position');
  });
}

function createDragPlaceholder(kind) {
  if (dragPayload?.itemId) {
    // Precise per-context selectors prevent matching the wrong area's element
    const selector = kind === 'nav'
      ? `.nav-item[data-id="${CSS.escape(dragPayload.itemId)}"]`
      : kind === 'speed-dial'
        ? `.speed-link[data-item-id="${CSS.escape(dragPayload.itemId)}"]`
        : `.board-column-item[data-item-id="${CSS.escape(dragPayload.itemId)}"]`;
    const sourceEl = document.querySelector(selector);
    if (sourceEl) {
      const clone = sourceEl.cloneNode(true);
      clone.classList.add('drag-preview');
      clone.classList.remove('selected', 'drop-position-before', 'drop-position-after', 'dragging');
      clone.removeAttribute('draggable');
      clone.removeAttribute('data-drop-position');
      if (kind === 'speed-dial') clone.dataset.previewAxis = 'h';
      clone.querySelectorAll('[data-drop-position]').forEach(el => {
        el.removeAttribute('data-drop-position');
        el.classList.remove('drop-position-before', 'drop-position-after', 'selected');
      });
      return clone;
    }
    // Element doesn't exist in target context yet — render a fresh preview
    const fresh = _renderCrossContextPreview(kind);
    if (fresh) return fresh;
  }
  // collection-tab → nav: synthesise a nav board item that matches what will be created on drop
  if (kind === 'nav' && dragPayload?.area === 'collection-tab' && dragPayload?.boardId) {
    const board = state.boards.find(b => b.id === dragPayload.boardId);
    const el = document.createElement('div');
    el.className = 'nav-item drag-preview';
    el.dataset.type = 'board';
    const info = document.createElement('div');
    info.className = 'nav-board-info';
    const lbl = document.createElement('div');
    lbl.className = 'nav-board-title';
    lbl.textContent = board?.title || 'Untitled Board';
    info.appendChild(lbl);
    if (board?.tags?.length && typeof renderTagsInto === 'function') {
      const tagsEl = document.createElement('div');
      tagsEl.className = 'nav-board-tags';
      renderTagsInto(tagsEl, board.tags);
      info.appendChild(tagsEl);
    }
    el.appendChild(info);
    return el;
  }
  const placeholder = document.createElement('div');
  placeholder.className = `drag-placeholder ${kind}-placeholder`;
  return placeholder;
}

function _renderCrossContextPreview(kind) {
  const board = getActiveBoard();

  if (kind === 'board') {
    let item = null;
    if (dragPayload.area === 'speed-dial') {
      item = board?.speedDial.find(i => i.id === dragPayload.itemId);
    } else if (dragPayload.area === 'essential') {
      item = state.essentials.find?.(i => i?.id === dragPayload.itemId)
          ?? (dragPayload.slot != null ? state.essentials[dragPayload.slot] : null);
    } else if (dragPayload.area === 'collection-speed-dial') {
      const coll = state.navItems.find(i => i.id === dragPayload.collectionId);
      item = coll?.speedDial?.find(i => i.id === dragPayload.itemId) ?? null;
    } else if (dragPayload.area === 'nav') {
      const p = findNavItemPath(dragPayload.itemId);
      item = p?.list.find(i => i.id === dragPayload.itemId);
    }
    if (!item) return null;
    const el = item.type === 'widget'
      ? createWidgetElement(item, '_preview')
      : createBoardItemElement(item, '_preview');
    if (!el) return null;
    el.classList.add('drag-preview');
    el.removeAttribute('draggable');
    return el;
  }

  if (kind === 'speed-dial') {
    let item = null;
    if (dragPayload.area === 'board') {
      const p = findBoardItemInColumns(board, dragPayload.itemId);
      item = p?.list.find(i => i.id === dragPayload.itemId);
    } else if (dragPayload.area === 'essential') {
      item = dragPayload.slot != null ? state.essentials[dragPayload.slot] : null;
    }
    if (!item) return null;
    const link = document.createElement('a');
    link.className = 'speed-link drag-preview';
    link.dataset.previewAxis = 'h';
    if (item.url) {
      const img = document.createElement('img');
      setFavicon(img, item, 256);
      img.draggable = false;
      link.appendChild(img);
    } else {
      const fb = document.createElement('span');
      fb.className = 'speed-link-fallback';
      fb.textContent = item.title ? item.title[0].toUpperCase() : '?';
      link.appendChild(fb);
    }
    return link;
  }

  if (kind === 'nav') {
    let item = null;
    if (dragPayload.area === 'board') {
      const p = findBoardItemInColumns(board, dragPayload.itemId);
      item = p?.list.find(i => i.id === dragPayload.itemId);
    }
    if (!item || item.type !== 'widget') return null;
    const def = WIDGET_REGISTRY[item.widgetType];
    if (!def) return null;
    const el = document.createElement('div');
    el.className = 'nav-item nav-widget-item drag-preview';
    const body = document.createElement('div');
    body.className = 'nav-widget-body';
    el.appendChild(body);
    def.render(item, body, 'navpane');
    return el;
  }

  return null;
}

// Reposition existing nav preview clone in-place (no destroy/recreate → no flicker).
// Falls back to animated insertion when no preview exists yet.
function _moveNavPreview(parentEl, beforeEl) {
  document.querySelectorAll('.drag-placeholder').forEach(el => el.remove());
  document.querySelectorAll('.drop-position-before, .drop-position-after').forEach(el => {
    el.classList.remove('drop-position-before', 'drop-position-after');
    el.removeAttribute('data-drop-position');
  });
  document.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target'));
  const existing = document.querySelector('.drag-preview');
  if (existing && existing.classList.contains('nav-item')) {
    parentEl.insertBefore(existing, beforeEl || null);
  } else {
    if (existing) existing.remove();
    _insertDragPreview(createDragPlaceholder('nav'), parentEl, beforeEl);
  }
}

function _insertDragPreview(clone, parent, beforeEl) {
  const isH = clone.dataset.previewAxis === 'h';
  if (isH) {
    clone.style.maxWidth = '0';
    clone.style.minWidth = '0';
    clone.style.overflow = 'hidden';
    clone.style.opacity = '0';
    clone.style.flexShrink = '0';
  } else {
    clone.style.maxHeight = '0';
    clone.style.overflow = 'hidden';
    clone.style.opacity = '0';
  }
  if (beforeEl != null) parent.insertBefore(clone, beforeEl);
  else parent.appendChild(clone);
  clone.offsetHeight;
  clone.style.transition = isH
    ? 'max-width 130ms ease, opacity 80ms ease'
    : 'max-height 130ms ease, opacity 80ms ease';
  requestAnimationFrame(() => {
    if (isH) clone.style.maxWidth = '400px';
    else clone.style.maxHeight = '400px';
    clone.style.opacity = '0.5';
  });
}

function applyDragImage(event, element) {
  const clone = element.cloneNode(true);
  clone.style.cssText = 'position:fixed;top:-9999px;left:-9999px;margin:0;';
  document.body.appendChild(clone);
  const rect = element.getBoundingClientRect();
  event.dataTransfer.setDragImage(clone, event.clientX - rect.left, event.clientY - rect.top);
  requestAnimationFrame(() => { clone.remove(); element.classList.add('dragging'); });
}

// Shared extraction logic for folder header/container drops.
// Returns the extracted item or null on failure.
function _extractDraggedItem(board) {
  if (dragPayload.area === 'board') {
    const oldFound = findBoardItemInColumns(board, dragPayload.itemId);
    const oldParent = oldFound?.parent;
    const dragged = removeBoardItemById(dragPayload.itemId);
    if (dragged && oldParent?.autoRemoveTags && oldParent.sharedTags?.length) {
      dragged.tags = (dragged.tags || []).filter(t => !oldParent.sharedTags.includes(t));
    }
    return dragged;
  }
  if (dragPayload.area === 'speed-dial') {
    const sdIdx = board.speedDial.findIndex(i => i.id === dragPayload.itemId);
    if (sdIdx === -1) return null;
    const [dragged] = board.speedDial.splice(sdIdx, 1);
    dragged.type = 'bookmark';
    if (!dragged.tags) dragged.tags = [];
    return dragged;
  }
  if (dragPayload.area === 'essential') {
    const dragged = state.essentials[dragPayload.slot];
    if (!dragged) return null;
    state.essentials[dragPayload.slot] = null; trimEssentialsTail();
    dragged.type = 'bookmark';
    if (!dragged.tags) dragged.tags = [];
    return dragged;
  }
  if (dragPayload.area === 'collection-speed-dial') return _extractCollectionSpeedDialItem();
  return null;
}

function _extractCollectionSpeedDialItem() {
  const coll = state.navItems.find(i => i.id === dragPayload.collectionId);
  if (!coll) return null;
  const idx = (coll.speedDial || []).findIndex(i => i.id === dragPayload.itemId);
  if (idx === -1) return null;
  const [item] = coll.speedDial.splice(idx, 1);
  item.type = 'bookmark';
  if (!item.tags) item.tags = [];
  return item;
}

function createEssentialSlotPreview() {
  if (!dragPayload) return null;
  let item = null;
  const board = getActiveBoard();
  if (dragPayload.area === 'board') {
    item = findBoardItemInColumns(board, dragPayload.itemId)?.item;
  } else if (dragPayload.area === 'speed-dial') {
    item = board?.speedDial.find(i => i.id === dragPayload.itemId);
  } else if (dragPayload.area === 'essential') {
    item = state.essentials[dragPayload.slot];
  } else if (dragPayload.area === 'collection-speed-dial') {
    const coll = state.navItems.find(i => i.id === dragPayload.collectionId);
    item = coll?.speedDial?.find(i => i.id === dragPayload.itemId) ?? null;
  }
  if (!item) return null;
  const wrapper = document.createElement('div');
  wrapper.className = 'drag-preview essential-slot-preview';
  if (item.url) {
    const img = document.createElement('img');
    setFavicon(img, item, 64);
    img.alt = '';
    img.draggable = false;
    wrapper.appendChild(img);
  } else {
    const fb = document.createElement('span');
    fb.className = 'essential-slot-fallback';
    fb.textContent = item.title ? item.title[0].toUpperCase() : '?';
    wrapper.appendChild(fb);
  }
  return wrapper;
}

// --- Essential slot drop ---

function handleEssentialSlotDrop(targetSlot) {
  if (!dragPayload) return;
  pushUndoSnapshot();
  const board = getActiveBoard();

  if (dragPayload.area === 'essential') {
    const srcSlot = dragPayload.slot;
    if (srcSlot === targetSlot) { dragPayload = null; return; }
    const srcItem = state.essentials[srcSlot];
    while (state.essentials.length <= Math.max(srcSlot, targetSlot)) state.essentials.push(null);
    state.essentials[targetSlot] = srcItem;
    state.essentials[srcSlot] = null;
    trimEssentialsTail();
  } else if (dragPayload.area === 'speed-dial') {
    const sdIdx = board.speedDial.findIndex(i => i.id === dragPayload.itemId);
    if (sdIdx === -1) { dragPayload = null; return; }
    const [item] = board.speedDial.splice(sdIdx, 1);
    item.type = 'bookmark';
    if (!item.tags) item.tags = [];
    const existing = state.essentials[targetSlot];
    if (existing) board.speedDial.push(existing);
    while (state.essentials.length < targetSlot) state.essentials.push(null);
    state.essentials[targetSlot] = item;
  } else if (dragPayload.area === 'board') {
    const item = removeBoardItemById(dragPayload.itemId);
    if (!item) { dragPayload = null; return; }
    item.type = 'bookmark';
    if (!item.tags) item.tags = [];
    const existing = state.essentials[targetSlot];
    if (existing) addBoardItemToColumn(dragPayload.sourceColumnId || board.columns[0].id, existing);
    while (state.essentials.length < targetSlot) state.essentials.push(null);
    state.essentials[targetSlot] = item;
  } else if (dragPayload.area === 'collection-speed-dial') {
    const item = _extractCollectionSpeedDialItem();
    if (!item) { dragPayload = null; return; }
    const existing = state.essentials[targetSlot];
    if (existing) {
      const coll = state.navItems.find(i => i.id === dragPayload.collectionId);
      if (coll) { if (!coll.speedDial) coll.speedDial = []; coll.speedDial.push(existing); }
    }
    while (state.essentials.length < targetSlot) state.essentials.push(null);
    state.essentials[targetSlot] = item;
  } else {
    dragPayload = null;
    return;
  }

  dragPayload = null;
  renderAll();
  saveState();
}

// Reposition an existing board drag-preview without animation when staying in the
// same container. Animates in a fresh preview only when entering a new container.
function _moveBoardPreview(parentEl, beforeEl) {
  document.querySelectorAll('.drag-placeholder').forEach(el => el.remove());
  document.querySelectorAll('.drop-position-before, .drop-position-after').forEach(el => {
    el.classList.remove('drop-position-before', 'drop-position-after');
    el.removeAttribute('data-drop-position');
  });
  document.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target'));
  const existing = document.querySelector('.drag-preview:not(.essential-slot-preview)');
  if (existing && existing.parentElement === parentEl) {
    parentEl.insertBefore(existing, beforeEl || null);
  } else {
    if (existing) existing.remove();
    _insertDragPreview(createDragPlaceholder('board'), parentEl, beforeEl);
  }
}

// Shared "drop into folder" activation used by both the header and tag-grid dragover
// handlers. Keyed on the folder card element so any subelement of the folder top
// section hits the same guard and does not re-trigger on micro-movements.
function activateFolderDrop(event, folderCardEl, folderItem, columnId, depth) {
  if (!dragPayload || (dragPayload.area !== 'board' && dragPayload.area !== 'speed-dial' && dragPayload.area !== 'essential' && dragPayload.area !== 'collection-speed-dial')) return;
  event.preventDefault();
  event.stopPropagation();
  if (_dropTarget === folderCardEl) return;
  _dropTarget = folderCardEl;
  _dropPos    = null;
  const childrenContainer = folderCardEl.querySelector('.folder-children');
  if (childrenContainer) {
    _moveBoardPreview(childrenContainer, null);
    childrenContainer.classList.add('drop-target');
  }
}

// --- Board item drag & drop ---

function handleBoardItemDragOver(event, targetItem, columnId, parentFolder, depth) {
  if (!dragPayload) return;
  if (getActiveBoard()?.locked) return;
  if (dragPayload.area !== 'board' && dragPayload.area !== 'speed-dial' && dragPayload.area !== 'essential' && dragPayload.area !== 'collection-speed-dial' && !(dragPayload.area === 'nav' && _canDropAsColumnWidget())) return;
  // Reject dragover when this item lives inside a locked folder (inherited lock).
  if (event.currentTarget.parentElement?.closest('.board-column-item.is-locked')) return;

  // Dragging over an expanded folder card (including padding areas not covered by
  // header/tagGrid/children handlers) should drop into it, not reorder it.
  // Collapsed folders and locked folders (direct or inherited) fall through to
  // normal before/after reorder.
  if (targetItem.type === 'folder' && !targetItem.collapsed && !targetItem.locked && !event.currentTarget.classList.contains('is-locked')) {
    activateFolderDrop(event, event.currentTarget, targetItem, columnId, depth);
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  event.dataTransfer.dropEffect = 'move';

  const itemEl = event.currentTarget;
  const rect = itemEl.getBoundingClientRect();
  const position = event.clientY - rect.top < rect.height / 2 ? 'before' : 'after';
  if (_dropTarget === itemEl && _dropPos === position) return;

  _dropTarget = itemEl;
  _dropPos    = position;
  _moveBoardPreview(itemEl.parentElement, position === 'before' ? itemEl : itemEl.nextSibling);
  itemEl.dataset.dropPosition = position;
  itemEl.classList.toggle('drop-position-before', position === 'before');
  itemEl.classList.toggle('drop-position-after', position === 'after');
}

function handleBoardItemDrop(event, targetItem, columnId, parentFolder, depth) {
  if (!dragPayload) return;
  if (getActiveBoard()?.locked) return;
  const isNavColWidget = dragPayload.area === 'nav' && _canDropAsColumnWidget();
  if (!isNavColWidget && dragPayload.area !== 'board' && dragPayload.area !== 'speed-dial' && dragPayload.area !== 'essential' && dragPayload.area !== 'collection-speed-dial') return;
  if (dragPayload.itemId === targetItem.id) return;
  if (event.currentTarget.parentElement?.closest('.board-column-item.is-locked')) return;

  event.preventDefault();
  event.stopPropagation();
  const position = _dropPos || 'before';
  removeDragPlaceholders();
  pushUndoSnapshot();

  const board = getActiveBoard();

  if (isNavColWidget) {
    const widget = removeNavItemById(dragPayload.itemId);
    if (!widget) { dragPayload = null; return; }
    const targetPath = findBoardItemInColumns(board, targetItem.id);
    if (targetPath) {
      const ti = targetPath.list.findIndex(i => i.id === targetItem.id);
      targetPath.list.splice(Math.max(0, position === 'after' ? ti + 1 : ti), 0, widget);
    } else {
      addBoardItemToColumn(columnId, widget);
    }
    dragPayload = null; renderAll(); saveState(); return;
  }

  const targetPath = findBoardItemInColumns(board, targetItem.id);

  if (dragPayload.area === 'speed-dial' || dragPayload.area === 'essential' || dragPayload.area === 'collection-speed-dial') {
    let extracted;
    if (dragPayload.area === 'speed-dial') {
      const sdIdx = board.speedDial.findIndex(i => i.id === dragPayload.itemId);
      if (sdIdx === -1) { dragPayload = null; return; }
      [extracted] = board.speedDial.splice(sdIdx, 1);
    } else if (dragPayload.area === 'collection-speed-dial') {
      extracted = _extractCollectionSpeedDialItem();
      if (!extracted) { dragPayload = null; return; }
    } else {
      extracted = state.essentials[dragPayload.slot];
      if (!extracted) { dragPayload = null; return; }
      state.essentials[dragPayload.slot] = null; trimEssentialsTail();
    }
    extracted.type = 'bookmark';
    if (!extracted.tags) extracted.tags = [];
    if (!targetPath) {
      addBoardItemToColumn(columnId, extracted);
    } else {
      const targetIndex = targetPath.list.findIndex(i => i.id === targetItem.id);
      targetPath.list.splice(Math.max(0, position === 'after' ? targetIndex + 1 : targetIndex), 0, extracted);
    }
    dragPayload = null; renderAll(); saveState(); return;
  }

  const draggedPath = findBoardItemInColumns(board, dragPayload.itemId);

  if (!targetPath) {
    const dragged = removeBoardItemById(dragPayload.itemId);
    if (dragged) addBoardItemToColumn(columnId, dragged);
    dragPayload = null; renderAll(); saveState(); return;
  }

  const targetIndex = targetPath.list.findIndex(item => item.id === targetItem.id);
  if (targetIndex === -1) { dragPayload = null; return; }

  const draggedIndex = draggedPath && draggedPath.list === targetPath.list
    ? draggedPath.list.findIndex(item => item.id === dragPayload.itemId)
    : -1;

  const dragged = removeBoardItemById(dragPayload.itemId);
  if (!dragged) return;

  let destinationIndex = position === 'after' ? targetIndex + 1 : targetIndex;
  if (draggedIndex !== -1 && draggedIndex < targetIndex) destinationIndex -= 1;
  destinationIndex = Math.max(0, Math.min(destinationIndex, targetPath.list.length));
  targetPath.list.splice(destinationIndex, 0, dragged);

  dragPayload = null;
  renderAll();
  saveState();
}

// --- Board column drag & drop ---

function handleBoardColumnDragOver(event) {
  if (getActiveBoard()?.locked) return;
  if (dragPayload && dragPayload.area !== 'board' && dragPayload.area !== 'speed-dial' && dragPayload.area !== 'essential' && dragPayload.area !== 'collection-speed-dial' && !(dragPayload.area === 'nav' && _canDropAsColumnWidget())) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  event.stopPropagation();

  const columnEl = event.currentTarget;
  const itemEls = Array.from(columnEl.querySelectorAll(':scope > .board-column-item:not(.drag-preview)'));

  if (itemEls.length === 0) {
    if (_dropTarget === columnEl && _dropPos === 'start') return;
    _dropTarget = columnEl; _dropPos = 'start';
    _moveBoardPreview(columnEl, columnEl.firstChild);
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
    if (_dropTarget === columnEl && _dropPos === 'end') return;
    _dropTarget = columnEl; _dropPos = 'end';
    _moveBoardPreview(columnEl, null);
    return;
  }

  if (_dropTarget === nearestEl && _dropPos === nearestPos) return;
  _dropTarget = nearestEl; _dropPos = nearestPos;
  _moveBoardPreview(nearestEl.parentElement, nearestPos === 'before' ? nearestEl : nearestEl.nextSibling);
  nearestEl.dataset.dropPosition = nearestPos;
  nearestEl.classList.toggle('drop-position-before', nearestPos === 'before');
  nearestEl.classList.toggle('drop-position-after', nearestPos === 'after');
}

function handleBoardColumnDrop(event, columnId) {
  event.preventDefault();
  event.stopPropagation();
  event.currentTarget.classList.remove('drop-target');

  // Capture position globals before removeDragPlaceholders clears them.
  const savedTarget = _dropTarget;
  const savedPos    = _dropPos;
  removeDragPlaceholders();

  if (getActiveBoard()?.locked) return;

  if (isExternalDrag(event)) {
    const ext = getExternalDrop(event);
    if (ext) openExternalBookmarkModal(ext.url, ext.title, { area: 'board-empty', columnId }, ext.faviconCache);
    return;
  }

  const isNavColWidget = dragPayload && dragPayload.area === 'nav' && _canDropAsColumnWidget();
  if (!isNavColWidget && (!dragPayload || (dragPayload.area !== 'board' && dragPayload.area !== 'speed-dial' && dragPayload.area !== 'essential' && dragPayload.area !== 'collection-speed-dial'))) return;
  pushUndoSnapshot();

  const board = getActiveBoard();
  const column = board.columns.find(col => col.id === columnId);
  if (!column) return;

  let stateInsertIndex = column.items.length;
  if (savedTarget?.dataset.itemId) {
    const refIdx = column.items.findIndex(i => i.id === savedTarget.dataset.itemId);
    if (refIdx !== -1) stateInsertIndex = savedPos === 'after' ? refIdx + 1 : refIdx;
  }

  if (isNavColWidget) {
    const widget = removeNavItemById(dragPayload.itemId);
    if (!widget) { dragPayload = null; return; }
    column.items.splice(Math.max(0, Math.min(stateInsertIndex, column.items.length)), 0, widget);
    dragPayload = null; renderAll(); saveState(); return;
  }

  let draggedItem;
  if (dragPayload.area === 'board') {
    const origIdx = column.items.findIndex(i => i.id === dragPayload.itemId);
    const oldFound = findBoardItemInColumns(board, dragPayload.itemId);
    const oldParent = oldFound?.parent;
    draggedItem = removeBoardItemById(dragPayload.itemId);
    if (draggedItem && origIdx !== -1 && origIdx < stateInsertIndex) stateInsertIndex -= 1;
    if (draggedItem && oldParent?.autoRemoveTags && oldParent.sharedTags?.length) {
      draggedItem.tags = (draggedItem.tags || []).filter(t => !oldParent.sharedTags.includes(t));
    }
  } else if (dragPayload.area === 'speed-dial') {
    const sdIdx = board.speedDial.findIndex(i => i.id === dragPayload.itemId);
    if (sdIdx === -1) { dragPayload = null; return; }
    [draggedItem] = board.speedDial.splice(sdIdx, 1);
    draggedItem.type = 'bookmark';
    if (!draggedItem.tags) draggedItem.tags = [];
  } else if (dragPayload.area === 'collection-speed-dial') {
    draggedItem = _extractCollectionSpeedDialItem();
    if (!draggedItem) { dragPayload = null; return; }
  } else {
    draggedItem = state.essentials[dragPayload.slot];
    if (!draggedItem) { dragPayload = null; return; }
    state.essentials[dragPayload.slot] = null; trimEssentialsTail();
    draggedItem.type = 'bookmark';
    if (!draggedItem.tags) draggedItem.tags = [];
  }
  if (!draggedItem) return;

  column.items.splice(Math.max(0, Math.min(stateInsertIndex, column.items.length)), 0, draggedItem);

  dragPayload = null;
  renderAll();
  saveState();
}

// --- Board folder drag & drop ---

function handleBoardFolderHeaderDragOver(event, folderCardEl, folderItem, columnId, depth) {
  if (folderItem.locked || folderCardEl.classList.contains('is-locked')) return;
  activateFolderDrop(event, folderCardEl, folderItem, columnId, depth);
}

function handleBoardFolderHeaderDrop(event, folderItem, columnId, depth) {
  if (!dragPayload || (dragPayload.area !== 'board' && dragPayload.area !== 'speed-dial' && dragPayload.area !== 'essential' && dragPayload.area !== 'collection-speed-dial')) return;
  if (dragPayload.itemId === folderItem.id) return;
  if (folderItem.locked || event.currentTarget.closest('.board-column-item.is-locked')) { event.preventDefault(); event.stopPropagation(); return; }
  event.preventDefault();
  event.stopPropagation();
  removeDragPlaceholders();
  event.currentTarget.classList.remove('drop-target');

  if (dragPayload.itemType === 'folder' && depth >= 2) {
    showNotice('Folders can only be nested two levels deep.');
    dragPayload = null; return;
  }
  if (isDescendant(dragPayload.itemId, folderItem)) {
    showNotice('Cannot move a folder into one of its own subfolders.');
    dragPayload = null; return;
  }

  pushUndoSnapshot();
  const board = getActiveBoard();
  const dragged = _extractDraggedItem(board);
  if (!dragged) { dragPayload = null; return; }

  folderItem.children = folderItem.children || [];
  folderItem.children.push(dragged);

  dragPayload = null;
  renderAll();
  saveState();
}

function handleBoardFolderContainerDragOver(event, folderCardEl, folderItem, columnId, depth) {
  if (folderItem.locked || folderCardEl.classList.contains('is-locked')) return;
  if (!dragPayload || (dragPayload.area !== 'board' && dragPayload.area !== 'speed-dial' && dragPayload.area !== 'essential' && dragPayload.area !== 'collection-speed-dial')) return;
  event.preventDefault();
  event.stopPropagation();
  event.dataTransfer.dropEffect = 'move';

  const containerEl = event.currentTarget;
  containerEl.classList.add('drop-target');

  // Position-aware preview within the folder's children — same logic as column dragover.
  const itemEls = Array.from(containerEl.querySelectorAll(':scope > .board-column-item:not(.drag-preview)'));

  if (itemEls.length === 0) {
    if (_dropTarget === containerEl && _dropPos === 'start') return;
    _dropTarget = containerEl; _dropPos = 'start';
    _moveBoardPreview(containerEl, containerEl.firstChild);
    return;
  }

  let nearestEl = null, nearestPos = null, nearestDist = Infinity;
  for (const el of itemEls) {
    const rect = el.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const dist = Math.abs(event.clientY - midY);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearestEl = el;
      nearestPos = event.clientY <= midY ? 'before' : 'after';
    }
  }

  if (!nearestEl) {
    if (_dropTarget === containerEl && _dropPos === 'end') return;
    _dropTarget = containerEl; _dropPos = 'end';
    _moveBoardPreview(containerEl, null);
    return;
  }

  if (_dropTarget === nearestEl && _dropPos === nearestPos) return;
  _dropTarget = nearestEl; _dropPos = nearestPos;
  _moveBoardPreview(nearestEl.parentElement, nearestPos === 'before' ? nearestEl : nearestEl.nextSibling);
  nearestEl.dataset.dropPosition = nearestPos;
  nearestEl.classList.toggle('drop-position-before', nearestPos === 'before');
  nearestEl.classList.toggle('drop-position-after', nearestPos === 'after');
}

function handleBoardFolderContainerDrop(event, folderItem, columnId, depth) {
  if (!dragPayload || (dragPayload.area !== 'board' && dragPayload.area !== 'speed-dial' && dragPayload.area !== 'essential' && dragPayload.area !== 'collection-speed-dial')) return;
  if (dragPayload.itemId === folderItem.id) return;
  if (folderItem.locked || event.currentTarget.closest('.board-column-item.is-locked')) { event.preventDefault(); event.stopPropagation(); return; }
  event.preventDefault();
  event.stopPropagation();

  // Capture position before removeDragPlaceholders clears them.
  const dropTargetEl = _dropTarget;
  const dropPos = _dropPos;

  removeDragPlaceholders();
  event.currentTarget.classList.remove('drop-target');

  if (dragPayload.itemType === 'folder' && depth >= 2) {
    showNotice('Folders can only be nested two levels deep.');
    dragPayload = null; return;
  }
  if (isDescendant(dragPayload.itemId, folderItem)) {
    showNotice('Cannot move a folder into one of its own subfolders.');
    dragPayload = null; return;
  }

  pushUndoSnapshot();
  const board = getActiveBoard();
  const dragged = _extractDraggedItem(board);
  if (!dragged) { dragPayload = null; return; }

  folderItem.children = folderItem.children || [];
  const targetItemId = dropTargetEl?.dataset?.itemId;
  if (targetItemId && dropPos) {
    const targetIdx = folderItem.children.findIndex(c => c.id === targetItemId);
    if (targetIdx !== -1) {
      const insertIdx = Math.max(0, Math.min(
        dropPos === 'after' ? targetIdx + 1 : targetIdx,
        folderItem.children.length
      ));
      folderItem.children.splice(insertIdx, 0, dragged);
    } else {
      folderItem.children.push(dragged);
    }
  } else {
    folderItem.children.push(dragged);
  }

  dragPayload = null;
  renderAll();
  saveState();
}

// --- Speed dial drag & drop ---

function handleSpeedDialItemDragOver(event, item) {
  if (getActiveBoard()?.locked) return;
  if (!dragPayload) return;
  if (dragPayload.area !== 'speed-dial' && dragPayload.area !== 'essential' && dragPayload.area !== 'collection-speed-dial' && !(dragPayload.area === 'board' && dragPayload.itemType === 'bookmark')) return;
  event.preventDefault();
  event.stopPropagation();
  event.dataTransfer.dropEffect = 'move';

  const el = event.currentTarget;
  const rect = el.getBoundingClientRect();
  const position = event.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
  if (_dropTarget === el && _dropPos === position) return;

  removeDragPlaceholders();
  _dropTarget = el; _dropPos = position;
  el.dataset.dropPosition = position;
  _insertDragPreview(createDragPlaceholder('speed-dial'), el.parentElement, position === 'before' ? el : el.nextSibling);
}

function handleSpeedDialItemDrop(event, targetItem) {
  if (!dragPayload || getActiveBoard()?.locked) return;
  event.preventDefault();
  event.stopPropagation();
  const position = _dropPos || 'before';
  removeDragPlaceholders();
  pushUndoSnapshot();

  const board = getActiveBoard();

  if (dragPayload.area === 'speed-dial') {
    if (dragPayload.itemId === targetItem.id) { dragPayload = null; return; }
    const draggedIdx = board.speedDial.findIndex(i => i.id === dragPayload.itemId);
    const targetIdx  = board.speedDial.findIndex(i => i.id === targetItem.id);
    if (draggedIdx === -1 || targetIdx === -1) { dragPayload = null; return; }
    const [dragged] = board.speedDial.splice(draggedIdx, 1);
    let insertIdx = position === 'after' ? targetIdx + 1 : targetIdx;
    if (draggedIdx < targetIdx) insertIdx -= 1;
    board.speedDial.splice(Math.max(0, insertIdx), 0, dragged);
  } else if (dragPayload.area === 'essential') {
    const essItem = state.essentials[dragPayload.slot];
    if (!essItem) { dragPayload = null; return; }
    state.essentials[dragPayload.slot] = null; trimEssentialsTail();
    essItem.type = 'bookmark';
    if (!essItem.tags) essItem.tags = [];
    const targetIdx = board.speedDial.findIndex(i => i.id === targetItem.id);
    board.speedDial.splice(Math.max(0, position === 'after' ? targetIdx + 1 : targetIdx), 0, essItem);
  } else if (dragPayload.area === 'collection-speed-dial') {
    const coll = state.navItems.find(i => i.id === dragPayload.collectionId);
    if (!coll?.speedDial) { dragPayload = null; return; }
    if (dragPayload.itemId === targetItem.id) { dragPayload = null; return; }
    const draggedIdx = coll.speedDial.findIndex(i => i.id === dragPayload.itemId);
    const targetIdx  = coll.speedDial.findIndex(i => i.id === targetItem.id);
    if (draggedIdx === -1 || targetIdx === -1) { dragPayload = null; return; }
    const [dragged] = coll.speedDial.splice(draggedIdx, 1);
    let insertIdx = position === 'after' ? targetIdx + 1 : targetIdx;
    if (draggedIdx < targetIdx) insertIdx -= 1;
    coll.speedDial.splice(Math.max(0, insertIdx), 0, dragged);
  } else if (dragPayload.area === 'board' && dragPayload.itemType === 'bookmark') {
    const dragged = removeBoardItemById(dragPayload.itemId);
    if (!dragged) { dragPayload = null; return; }
    dragged.type = 'bookmark';
    if (!dragged.tags) dragged.tags = [];
    const targetIdx = board.speedDial.findIndex(i => i.id === targetItem.id);
    board.speedDial.splice(Math.max(0, position === 'after' ? targetIdx + 1 : targetIdx), 0, dragged);
  } else {
    dragPayload = null;
    return;
  }

  dragPayload = null;
  renderAll();
  saveState();
}

function handleSpeedDialContainerDragOver(event) {
  if (getActiveBoard()?.locked) return;
  if (dragPayload && dragPayload.area !== 'speed-dial' && dragPayload.area !== 'essential' && dragPayload.area !== 'collection-speed-dial' && !(dragPayload.area === 'board' && dragPayload.itemType === 'bookmark')) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';

  const linkEls = Array.from(elements.speedDial.querySelectorAll('.speed-link:not(.drag-preview)'));
  if (linkEls.length === 0) {
    if (_dropTarget === elements.speedDial && _dropPos === 'end') return;
    removeDragPlaceholders();
    _dropTarget = elements.speedDial;
    _dropPos = 'end';
    _insertDragPreview(createDragPlaceholder('speed-dial'), elements.speedDial, null);
    return;
  }

  let nearestEl = linkEls[linkEls.length - 1];
  let nearestPos = 'after';
  for (const el of linkEls) {
    const rect = el.getBoundingClientRect();
    if (event.clientX <= rect.right) {
      nearestEl = el;
      nearestPos = event.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
      break;
    }
  }

  if (_dropTarget === nearestEl && _dropPos === nearestPos) return;
  removeDragPlaceholders();
  _dropTarget = nearestEl; _dropPos = nearestPos;
  nearestEl.dataset.dropPosition = nearestPos;
  _insertDragPreview(createDragPlaceholder('speed-dial'), nearestEl.parentElement, nearestPos === 'before' ? nearestEl : nearestEl.nextSibling);
}

function handleSpeedDialContainerDrop(event) {
  event.preventDefault();
  if (getActiveBoard()?.locked) { removeDragPlaceholders(); return; }
  if (isExternalDrag(event)) {
    removeDragPlaceholders();
    const ext = getExternalDrop(event);
    if (ext) openExternalBookmarkModal(ext.url, ext.title, { area: 'speed-dial' }, ext.faviconCache);
    return;
  }
  if (!dragPayload) return;

  // When a collection is active, drops go to the collection's speed dial
  const activeCollection = state.activeCollectionId
    ? state.navItems.find(i => i.id === state.activeCollectionId)
    : null;
  const board = activeCollection ? null : getActiveBoard();
  const speedDialTarget = activeCollection || board;
  if (!speedDialTarget) { removeDragPlaceholders(); return; }
  if (!speedDialTarget.speedDial) speedDialTarget.speedDial = [];

  pushUndoSnapshot();
  const refEl  = _dropTarget;
  const refPos = _dropPos;
  let stateInsertIndex = speedDialTarget.speedDial.length;
  if (refEl?.dataset.itemId) {
    const refIdx = speedDialTarget.speedDial.findIndex(i => i.id === refEl.dataset.itemId);
    if (refIdx !== -1) stateInsertIndex = refPos === 'after' ? refIdx + 1 : refIdx;
  }

  removeDragPlaceholders();

  const sdArea = activeCollection ? 'collection-speed-dial' : 'speed-dial';
  if (dragPayload.area === sdArea || dragPayload.area === 'speed-dial') {
    const origIdx = speedDialTarget.speedDial.findIndex(i => i.id === dragPayload.itemId);
    if (origIdx === -1) { dragPayload = null; return; }
    const [dragged] = speedDialTarget.speedDial.splice(origIdx, 1);
    if (origIdx < stateInsertIndex) stateInsertIndex -= 1;
    speedDialTarget.speedDial.splice(Math.max(0, Math.min(stateInsertIndex, speedDialTarget.speedDial.length)), 0, dragged);
  } else if (dragPayload.area === 'essential') {
    const essItem = state.essentials[dragPayload.slot];
    if (!essItem) { dragPayload = null; return; }
    state.essentials[dragPayload.slot] = null; trimEssentialsTail();
    essItem.type = 'bookmark';
    if (!essItem.tags) essItem.tags = [];
    speedDialTarget.speedDial.splice(Math.max(0, Math.min(stateInsertIndex, speedDialTarget.speedDial.length)), 0, essItem);
  } else if (dragPayload.area === 'board' && dragPayload.itemType === 'bookmark') {
    const dragged = removeBoardItemById(dragPayload.itemId);
    if (!dragged) { dragPayload = null; return; }
    dragged.type = 'bookmark';
    if (!dragged.tags) dragged.tags = [];
    speedDialTarget.speedDial.splice(Math.max(0, Math.min(stateInsertIndex, speedDialTarget.speedDial.length)), 0, dragged);
  } else {
    dragPayload = null;
    return;
  }

  dragPayload = null;
  renderAll();
  saveState();
}

// --- Nav drag & drop ---

function handleNavItemDragOver(event, item, parent) {
  // Board item as inbox target — any bookmark/folder from any source
  if (item.type === 'board' && _canSendToInbox()) {
    if (item.boardId !== state.activeBoardId) {
      const targetBoard = state.boards.find(b => b.id === item.boardId);
      if (!targetBoard?.locked) {
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'move';
        event.currentTarget.classList.add('drop-target');
      }
    }
    return;
  }
  // Collection as drop target for nav board items or collection tabs
  if (item.type === 'collection') {
    const isNavBoard = dragPayload?.area === 'nav' && dragPayload?.itemType !== 'widget';
    const isCollTab = dragPayload?.area === 'collection-tab' && dragPayload?.collectionId !== item.id;
    if (isNavBoard || isCollTab) {
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'move';
      event.currentTarget.classList.add('drop-target');
      return;
    }
  }
  // Accept collection-tab drags dropped onto a non-collection nav item (remove from collection → standalone)
  if (dragPayload?.area === 'collection-tab' && item.type !== 'collection') {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    const element = event.currentTarget;
    const rect = element.getBoundingClientRect();
    const position = event.clientY - rect.top < rect.height / 2 ? 'before' : 'after';
    if (_dropTarget === element && _dropPos === position) return;
    _dropTarget = element; _dropPos = position;
    element.dataset.dropPosition = position;
    _moveNavPreview(element.parentElement, position === 'before' ? element : element.nextSibling);
    return;
  }
  // Accept folder-tab drags (removing a board from a folder back to nav)
  if (dragPayload?.area === 'folder-tab') {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    const element = event.currentTarget;
    const rect = element.getBoundingClientRect();
    const position = event.clientY - rect.top < rect.height / 2 ? 'before' : 'after';
    if (_dropTarget === element && _dropPos === position) return;
    _dropTarget = element; _dropPos = position;
    element.dataset.dropPosition = position;
    _moveNavPreview(element.parentElement, position === 'before' ? element : element.nextSibling);
    return;
  }
  const isBoardWidget = dragPayload?.area === 'board' && _canDropAsNavWidget();
  if (!dragPayload || (dragPayload.area !== 'nav' && !isBoardWidget)) return;
  event.preventDefault();
  event.stopPropagation();
  event.dataTransfer.dropEffect = 'move';

  const element = event.currentTarget;
  const rect = element.getBoundingClientRect();
  const position = event.clientY - rect.top < rect.height / 2 ? 'before' : 'after';

  if (_dropTarget === element && _dropPos === position) return;
  _dropTarget = element; _dropPos = position;
  element.dataset.dropPosition = position;
  _moveNavPreview(element.parentElement, position === 'before' ? element : element.nextSibling);
}

function handleNavDrop(event, targetItem, parent) {
  if (dragPayload?.area === 'board' && _canDropAsNavWidget()) {
    const position = _dropPos || 'before';
    removeDragPlaceholders();
    pushUndoSnapshot();
    const widget = removeBoardItemById(dragPayload.itemId);
    if (!widget) { dragPayload = null; return; }
    const targetPath = findNavItemPath(targetItem.id);
    if (targetPath) {
      const ti = targetPath.list.findIndex(i => i.id === targetItem.id);
      targetPath.list.splice(Math.max(0, position === 'after' ? ti + 1 : ti), 0, widget);
    } else {
      state.navItems.push(widget);
    }
    dragPayload = null; renderAll(); saveState(); return;
  }
  if (targetItem.type === 'board' && _canSendToInbox()) {
    if (targetItem.boardId === state.activeBoardId) { dragPayload = null; return; }
    removeDragPlaceholders();
    pushUndoSnapshot();
    const targetBoard = state.boards.find(b => b.id === targetItem.boardId);
    if (!targetBoard || targetBoard.locked) { dragPayload = null; return; }
    const inbox = getBoardInbox(targetBoard);
    if (!inbox) { dragPayload = null; return; }
    let dragged = null;
    const board = getActiveBoard();
    if (dragPayload.area === 'board') {
      dragged = removeBoardItemById(dragPayload.itemId);
    } else if (dragPayload.area === 'nav') {
      dragged = removeNavItemById(dragPayload.itemId);
    } else if (dragPayload.area === 'speed-dial') {
      const idx = board.speedDial.findIndex(i => i.id === dragPayload.itemId);
      if (idx !== -1) { [dragged] = board.speedDial.splice(idx, 1); dragged.type = 'bookmark'; if (!dragged.tags) dragged.tags = []; }
    } else if (dragPayload.area === 'essential') {
      dragged = state.essentials[dragPayload.slot];
      if (dragged) { state.essentials[dragPayload.slot] = null; trimEssentialsTail(); dragged.type = 'bookmark'; if (!dragged.tags) dragged.tags = []; }
    }
    if (!dragged) { dragPayload = null; return; }
    inbox.items.push(dragged);
    dragPayload = null; renderAll(); saveState(); return;
  }
  // Collection tab dragged back to nav
  if (dragPayload?.area === 'collection-tab') {
    const srcColl = state.navItems.find(i => i.id === dragPayload.collectionId);
    if (!srcColl) { dragPayload = null; return; }
    removeDragPlaceholders();
    pushUndoSnapshot();
    const boardId = dragPayload.boardId;
    srcColl.boardIds = (srcColl.boardIds || []).filter(id => id !== boardId);
    const board = state.boards.find(b => b.id === boardId);
    if (board) {
      if (srcColl.autoRemoveTags && srcColl.sharedTags?.length) {
        const toStrip = new Set(srcColl.sharedTags);
        board.tags = (board.tags || []).filter(t => !toStrip.has(t));
      }
      const navItem = { id: `nav-${boardId}`, type: 'board', title: board.title, boardId };
      const targetPath = findNavItemPath(targetItem.id);
      if (targetPath) {
        const position = _dropPos || 'before';
        const ti = targetPath.list.findIndex(i => i.id === targetItem.id);
        targetPath.list.splice(Math.max(0, position === 'after' ? ti + 1 : ti), 0, navItem);
      } else {
        state.navItems.push(navItem);
      }
    }
    if (state.activeBoardId === boardId) {
      state.activeCollectionId = srcColl.boardIds.length ? srcColl.id : null;
      if (srcColl.boardIds.length) state.activeBoardId = srcColl.boardIds[0];
      else state.activeCollectionId = null;
    }
    dragPayload = null; renderAll(); saveState(); return;
  }

  // Folder tab dragged back to nav
  if (dragPayload?.area === 'folder-tab') {
    const srcFolder = _findNavItem(dragPayload.folderId);
    if (!srcFolder) { dragPayload = null; return; }
    removeDragPlaceholders();
    pushUndoSnapshot();
    const navItem = (srcFolder.children || []).find(c => c.id === dragPayload.navItemId);
    srcFolder.children = (srcFolder.children || []).filter(c => c.id !== dragPayload.navItemId);
    if (navItem) {
      const targetPath = findNavItemPath(targetItem.id);
      const position = _dropPos || 'before';
      if (targetPath) {
        const ti = targetPath.list.findIndex(i => i.id === targetItem.id);
        targetPath.list.splice(Math.max(0, position === 'after' ? ti + 1 : ti), 0, navItem);
      } else {
        state.navItems.push(navItem);
      }
    }
    dragPayload = null; renderAll(); saveState(); return;
  }

  // Nav board dropped onto collection
  if (targetItem.type === 'collection' && dragPayload?.area === 'nav') {
    const navItem = findNavItemPath(dragPayload.itemId);
    if (!navItem || navItem.item.type !== 'board') { dragPayload = null; return; }
    removeDragPlaceholders();
    pushUndoSnapshot();
    const removed = removeNavItemById(dragPayload.itemId);
    if (removed?.boardId) {
      if (!targetItem.boardIds) targetItem.boardIds = [];
      targetItem.boardIds.push(removed.boardId);
      state.activeBoardId = removed.boardId;
      state.activeCollectionId = targetItem.id;
    }
    dragPayload = null; renderAll(); saveState(); return;
  }

  if (!dragPayload || dragPayload.area !== 'nav') return;
  if (dragPayload.itemId === targetItem.id) return;
  const position = _dropPos || 'before';
  removeDragPlaceholders();
  pushUndoSnapshot();

  const targetPath = findNavItemPath(targetItem.id);
  const draggedPath = findNavItemPath(dragPayload.itemId);

  if (targetItem.type === 'folder') {
    const dragged = removeNavItemById(dragPayload.itemId);
    if (!dragged) return;
    targetItem.children = targetItem.children || [];
    targetItem.children.push(dragged);
    dragPayload = null; renderNav(); saveState(); return;
  }

  if (!targetPath) {
    const dragged = removeNavItemById(dragPayload.itemId);
    if (dragged) state.navItems.push(dragged);
    dragPayload = null; renderNav(); saveState(); return;
  }

  const targetIndex = targetPath.list.findIndex(item => item.id === targetItem.id);
  if (targetIndex === -1) { dragPayload = null; return; }

  const draggedIndex = draggedPath && draggedPath.list === targetPath.list
    ? draggedPath.list.findIndex(item => item.id === dragPayload.itemId)
    : -1;

  const dragged = removeNavItemById(dragPayload.itemId);
  if (!dragged) return;

  let destinationIndex = position === 'after' ? targetIndex + 1 : targetIndex;
  if (draggedIndex !== -1 && draggedIndex < targetIndex) destinationIndex -= 1;
  destinationIndex = Math.max(0, Math.min(destinationIndex, targetPath.list.length));
  targetPath.list.splice(destinationIndex, 0, dragged);

  dragPayload = null;
  renderNav();
  saveState();
}

function handleNavListDragOver(event) {
  if (!dragPayload) return;
  if (dragPayload.area !== 'nav' && dragPayload.area !== 'folder-tab' && dragPayload.area !== 'collection-tab' && !_canDropAsNavWidget()) return;
  // Always accept the drop so the browser fires the drop event even when the
  // cursor is over the preview clone's transparent space.
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  event.stopPropagation();
  // If an item-level preview is already positioned, cursor is over the clone's
  // transparent space — don't override preview position with end-of-list.
  if (_dropTarget !== null && _dropTarget !== elements.navList) return;
  if (_dropTarget === elements.navList) return;
  removeDragPlaceholders();
  _dropTarget = elements.navList; _dropPos = 'end';
  _insertDragPreview(createDragPlaceholder('nav'), elements.navList, null);
}

function handleNavListDrop(event) {
  event.preventDefault();
  if (!dragPayload) { removeDragPlaceholders(); return; }

  // Capture item-level position before removeDragPlaceholders clears globals.
  // When cursor is over a preview clone, the drop fires on the navList container
  // even though the intended position is at a specific nav item slot.
  const savedTarget = _dropTarget;
  const savedPos    = _dropPos;
  removeDragPlaceholders();

  if (_canDropAsNavWidget()) {
    pushUndoSnapshot();
    const widget = removeBoardItemById(dragPayload.itemId);
    if (!widget) { dragPayload = null; return; }
    if (savedTarget && savedTarget !== elements.navList && savedTarget.dataset.id) {
      const targetPath = findNavItemPath(savedTarget.dataset.id);
      if (targetPath) {
        const ti = targetPath.list.findIndex(i => i.id === savedTarget.dataset.id);
        if (ti !== -1) { targetPath.list.splice(Math.max(0, savedPos === 'after' ? ti + 1 : ti), 0, widget); dragPayload = null; renderAll(); saveState(); return; }
      }
    }
    state.navItems.push(widget);
    dragPayload = null; renderAll(); saveState(); return;
  }

  // Folder tab dropped onto nav list (remove from folder → add to nav root or target position)
  if (dragPayload.area === 'folder-tab') {
    const srcFolder = _findNavItem(dragPayload.folderId);
    if (!srcFolder) { dragPayload = null; return; }
    pushUndoSnapshot();
    const navItem = (srcFolder.children || []).find(c => c.id === dragPayload.navItemId);
    srcFolder.children = (srcFolder.children || []).filter(c => c.id !== dragPayload.navItemId);
    if (navItem) {
      if (savedTarget && savedTarget !== elements.navList && savedTarget.dataset.id) {
        const targetPath = findNavItemPath(savedTarget.dataset.id);
        const position = savedPos || 'before';
        if (targetPath) {
          const ti = targetPath.list.findIndex(i => i.id === savedTarget.dataset.id);
          targetPath.list.splice(Math.max(0, position === 'after' ? ti + 1 : ti), 0, navItem);
        } else {
          state.navItems.push(navItem);
        }
      } else {
        state.navItems.push(navItem);
      }
    }
    dragPayload = null; renderAll(); saveState(); return;
  }

  // Collection tab dropped onto empty nav list space (remove from collection → insert into nav)
  if (dragPayload.area === 'collection-tab') {
    const srcColl = state.navItems.find(i => i.id === dragPayload.collectionId);
    if (!srcColl) { dragPayload = null; return; }
    pushUndoSnapshot();
    const boardId = dragPayload.boardId;
    srcColl.boardIds = (srcColl.boardIds || []).filter(id => id !== boardId);
    const board = state.boards.find(b => b.id === boardId);
    if (board) {
      if (srcColl.autoRemoveTags && srcColl.sharedTags?.length) {
        const toStrip = new Set(srcColl.sharedTags);
        board.tags = (board.tags || []).filter(t => !toStrip.has(t));
      }
      const navItem = { id: `nav-${boardId}`, type: 'board', title: board.title, boardId };
      if (savedTarget && savedTarget !== elements.navList && savedTarget.dataset.id) {
        const targetPath = findNavItemPath(savedTarget.dataset.id);
        const position = savedPos || 'before';
        if (targetPath) {
          const ti = targetPath.list.findIndex(i => i.id === savedTarget.dataset.id);
          targetPath.list.splice(Math.max(0, position === 'after' ? ti + 1 : ti), 0, navItem);
        } else {
          state.navItems.push(navItem);
        }
      } else {
        state.navItems.push(navItem);
      }
    }
    if (state.activeBoardId === boardId) {
      if (srcColl.boardIds.length) {
        state.activeBoardId = srcColl.boardIds[0];
        state.activeCollectionId = srcColl.id;
      } else {
        state.activeCollectionId = null;
      }
    }
    dragPayload = null; renderAll(); saveState(); return;
  }

  if (dragPayload.area !== 'nav') return;
  pushUndoSnapshot();

  if (savedTarget && savedTarget !== elements.navList && savedTarget.dataset.id) {
    const targetId   = savedTarget.dataset.id;
    const position   = savedPos || 'before';
    const targetPath = findNavItemPath(targetId);
    const draggedPath = findNavItemPath(dragPayload.itemId);
    const dragged    = removeNavItemById(dragPayload.itemId);
    if (!dragged) { dragPayload = null; return; }
    if (targetPath) {
      const targetIndex  = targetPath.list.findIndex(i => i.id === targetId);
      const draggedIndex = draggedPath && draggedPath.list === targetPath.list
        ? draggedPath.list.findIndex(i => i.id === dragged.id)
        : -1;
      let dest = position === 'after' ? targetIndex + 1 : targetIndex;
      if (draggedIndex !== -1 && draggedIndex < targetIndex) dest -= 1;
      targetPath.list.splice(Math.max(0, Math.min(dest, targetPath.list.length)), 0, dragged);
    } else {
      state.navItems.push(dragged);
    }
    dragPayload = null; renderNav(); saveState(); return;
  }

  const dragged = removeNavItemById(dragPayload.itemId);
  if (!dragged) { dragPayload = null; return; }
  state.navItems.push(dragged);
  dragPayload = null;
  renderNav();
  saveState();
}
