let dragPayload = null;
let _dropTarget = null;
let _dropPos    = null;

const BOARD_DROP_AREAS = ['board', 'speed-dial', 'essential', 'import-manager'];

function _isBoardDropArea(area = dragPayload?.area) {
  return BOARD_DROP_AREAS.includes(area);
}

function _canDropOnBoard(allowNavWidget = false) {
  if (!dragPayload) return false;
  return _isBoardDropArea() || (allowNavWidget && dragPayload.area === 'nav' && _canDropAsColumnWidget());
}

function _canDropAsNavWidget() {
  if (!dragPayload || dragPayload.area !== 'board' || dragPayload.itemType !== 'widget') return false;
  return !!WIDGET_REGISTRY[dragPayload.widgetType]?.allowedIn?.includes('navpane');
}

function _canDropAsColumnWidget() {
  if (!dragPayload || dragPayload.area !== 'nav' || dragPayload.itemType !== 'widget') return false;
  return !!WIDGET_REGISTRY[dragPayload.widgetType]?.allowedIn?.includes('column');
}

function _currentDropEffect() {
  return dragPayload?.fromDynamicFolderView ? 'copy' : 'move';
}

// Returns true when the active drag payload contains a bookmark or folder
// that can be sent to another board's inbox.
function _canSendToInbox() {
  if (!dragPayload) return false;
  if (dragPayload.area === 'board') return ['bookmark', 'folder'].includes(dragPayload.itemType);
  if (dragPayload.area === 'import-manager') return ['bookmark', 'folder'].includes(dragPayload.itemType);
  if (dragPayload.area === 'speed-dial') return true;
  if (dragPayload.area === 'essential') return !!state.essentials[dragPayload.slot];
  if (dragPayload.area === 'nav') {
    const path = findNavItemPath(dragPayload.itemId);
    const item = path?.list.find(i => i.id === dragPayload.itemId);
    return !!item && ['bookmark', 'folder'].includes(item.type);
  }
  return false;
}

function _findDraggedImportManagerItem() {
  if (dragPayload?.area !== 'import-manager') return null;
  return findImportManagerItemById(dragPayload.itemId)?.item || null;
}

function _takeImportManagerDraggedItem() {
  if (dragPayload?.area !== 'import-manager') return null;
  const item = removeImportManagerItemById(dragPayload.itemId);
  if (item?.type === 'bookmark' && !item.tags) item.tags = [];
  return item;
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
  _clearDropDecorations();
}

function _clearDropDecorations(removePreviews = true) {
  const removable = removePreviews ? '.drag-placeholder, .drag-preview' : '.drag-placeholder';
  document.querySelectorAll(removable).forEach(el => el.remove());
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
  const placeholder = document.createElement('div');
  placeholder.className = `drag-placeholder ${kind}-placeholder`;
  return placeholder;
}

function _renderCrossContextPreview(kind) {
  const board = getActiveBoard();

  if (kind === 'board') {
    let item = null;
    if (dragPayload.area === 'speed-dial') {
      item = board?.speedDial.find(i => i?.id === dragPayload.itemId);
    } else if (dragPayload.area === 'essential') {
      item = state.essentials.find?.(i => i?.id === dragPayload.itemId)
          ?? (dragPayload.slot != null ? state.essentials[dragPayload.slot] : null);
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
  _clearDropDecorations(false);
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
  const rect = element.getBoundingClientRect();
  clone.style.cssText = `position:fixed;top:-9999px;left:-9999px;margin:0;width:${rect.width}px;height:${rect.height}px;`;
  clone.querySelectorAll('img').forEach(img => {
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.maxWidth = '100%';
    img.style.maxHeight = '100%';
    img.style.objectFit = 'contain';
    img.style.display = 'block';
  });
  document.body.appendChild(clone);
  event.dataTransfer.setDragImage(clone, event.clientX - rect.left, event.clientY - rect.top);
  requestAnimationFrame(() => {
    clone.remove();
    if (!dragPayload?.fromDynamicFolderView) element.classList.add('dragging');
  });
}

function _normalizeDraggedBookmark(item) {
  if (!item) return null;
  item.type = 'bookmark';
  if (!item.tags) item.tags = [];
  return item;
}

function _cloneBookmarkForDragCopy(item) {
  if (!item?.url) return null;
  return _normalizeDraggedBookmark({
    id: `bm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type: 'bookmark',
    title: item.title || item.url || 'Untitled Bookmark',
    url: item.url,
    tags: Array.isArray(item.tags) ? [...item.tags] : [],
    faviconCache: typeof item.faviconCache === 'string' ? item.faviconCache : ''
  });
}

function _takeDraggedBoardItem(board) {
  if (dragPayload?.area !== 'board') return null;
  if (dragPayload.fromDynamicFolderView && dragPayload.itemType === 'bookmark') {
    const item = findBoardItemInColumns(board, dragPayload.itemId)?.item || null;
    return _cloneBookmarkForDragCopy(item);
  }
  return removeBoardItemById(dragPayload.itemId);
}

function _takeDraggedBookmarkItem(board) {
  if (!dragPayload) return null;
  if (dragPayload.area === 'speed-dial') {
    return _normalizeDraggedBookmark(removeSpeedDialItemById(board, dragPayload.itemId));
  }
  if (dragPayload.area === 'board' && dragPayload.itemType === 'bookmark') {
    return _normalizeDraggedBookmark(_takeDraggedBoardItem(board));
  }
  if (dragPayload.area === 'import-manager' && dragPayload.itemType === 'bookmark') {
    return _normalizeDraggedBookmark(_takeImportManagerDraggedItem());
  }
  if (dragPayload.area === 'essential') {
    const item = state.essentials[dragPayload.slot];
    if (!item) return null;
    state.essentials[dragPayload.slot] = null;
    trimEssentialsTail();
    return _normalizeDraggedBookmark(item);
  }
  return null;
}

// Shared extraction logic for folder header/container drops.
// Returns the extracted item or null on failure.
function _extractDraggedItem(board) {
  if (dragPayload.area === 'board') {
    // Inherited/shared tags are computed dynamically, so moving an item out of a
    // parent must not mutate the item's explicit tags.
    return _takeDraggedBoardItem(board);
  }
  if (dragPayload.area === 'import-manager') {
    return _takeImportManagerDraggedItem();
  }
  if (dragPayload.area === 'speed-dial') {
    return _takeDraggedBookmarkItem(board);
  }
  if (dragPayload.area === 'essential') {
    return _takeDraggedBookmarkItem(board);
  }
  return null;
}

function _draggedFolderChildType() {
  if (!dragPayload) return null;
  if (dragPayload.area === 'board' || dragPayload.area === 'import-manager') return dragPayload.itemType || null;
  if (dragPayload.area === 'speed-dial' || dragPayload.area === 'essential') return 'bookmark';
  return null;
}

function _canDropIntoFolder(folderItem) {
  if (!_canDropOnBoard()) return false;
  const itemType = _draggedFolderChildType();
  if (!itemType) return false;
  return canInsertIntoFolder(folderItem, itemType);
}

function createEssentialSlotPreview() {
  if (!dragPayload) return null;
  let item = null;
  const board = getActiveBoard();
  if (dragPayload.area === 'board') {
    item = findBoardItemInColumns(board, dragPayload.itemId)?.item;
  } else if (dragPayload.area === 'import-manager') {
    item = _findDraggedImportManagerItem();
  } else if (dragPayload.area === 'speed-dial') {
    item = board?.speedDial.find(i => i?.id === dragPayload.itemId);
  } else if (dragPayload.area === 'essential') {
    item = state.essentials[dragPayload.slot];
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

function createExternalSlotPreview() {
  const wrapper = document.createElement('div');
  wrapper.className = 'drag-preview essential-slot-preview';
  const previewIcon = typeof icon === 'function' ? icon('icon-bookmark-add') : null;
  if (previewIcon) {
    previewIcon.classList.add('external-slot-preview-icon');
    wrapper.appendChild(previewIcon);
  } else {
    const fallback = document.createElement('span');
    fallback.className = 'essential-slot-fallback';
    fallback.textContent = '+';
    wrapper.appendChild(fallback);
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
  } else if (
    dragPayload.area === 'speed-dial'
    || (dragPayload.area === 'board' && dragPayload.itemType === 'bookmark')
    || (dragPayload.area === 'import-manager' && dragPayload.itemType === 'bookmark')
  ) {
    const item = _takeDraggedBookmarkItem(board);
    if (!item) { dragPayload = null; return; }
    while (state.essentials.length <= targetSlot) state.essentials.push(null);
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
  _clearDropDecorations(false);
  const existing = document.querySelector('.drag-preview:not(.essential-slot-preview)');
  if (existing && existing.parentElement === parentEl) {
    parentEl.insertBefore(existing, beforeEl || null);
  } else {
    if (existing) existing.remove();
    _insertDragPreview(createDragPlaceholder('board'), parentEl, beforeEl);
  }
}

function _activateFolderDropTarget(event, folderCardEl, canDrop) {
  if (!canDrop()) return;
  event.preventDefault();
  event.stopPropagation();
  if (_dropTarget === folderCardEl) return;
  _dropTarget = folderCardEl;
  _dropPos = null;
  const childrenContainer = folderCardEl.querySelector('.folder-children');
  if (childrenContainer) {
    _moveBoardPreview(childrenContainer, null);
    childrenContainer.classList.add('drop-target');
  }
}

function _handleVerticalItemDragOver(event) {
  event.preventDefault();
  event.stopPropagation();
  event.dataTransfer.dropEffect = _currentDropEffect();

  const itemEl = event.currentTarget;
  const rect = itemEl.getBoundingClientRect();
  const position = event.clientY - rect.top < rect.height / 2 ? 'before' : 'after';
  if (_dropTarget === itemEl && _dropPos === position) return;

  _dropTarget = itemEl;
  _dropPos = position;
  _moveBoardPreview(itemEl.parentElement, position === 'before' ? itemEl : itemEl.nextSibling);
  itemEl.dataset.dropPosition = position;
  itemEl.classList.toggle('drop-position-before', position === 'before');
  itemEl.classList.toggle('drop-position-after', position === 'after');
}

function _handleVerticalContainerDragOver(event, { markDropTarget = false, useNearest = false } = {}) {
  event.preventDefault();
  event.stopPropagation();
  event.dataTransfer.dropEffect = _currentDropEffect();

  const containerEl = event.currentTarget;
  if (markDropTarget) containerEl.classList.add('drop-target');
  const itemEls = Array.from(containerEl.querySelectorAll(':scope > .board-column-item:not(.drag-preview)'));

  if (itemEls.length === 0) {
    if (_dropTarget === containerEl && _dropPos === 'start') return;
    _dropTarget = containerEl;
    _dropPos = 'start';
    _moveBoardPreview(containerEl, containerEl.firstChild);
    return;
  }

  let nearestEl = null;
  let nearestPos = 'after';

  if (useNearest) {
    let nearestDist = Infinity;
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
  } else {
    for (const el of itemEls) {
      const rect = el.getBoundingClientRect();
      if (event.clientY <= rect.bottom) {
        nearestEl = el;
        nearestPos = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
        break;
      }
    }
  }

  if (!nearestEl) {
    if (_dropTarget === containerEl && _dropPos === 'end') return;
    _dropTarget = containerEl;
    _dropPos = 'end';
    _moveBoardPreview(containerEl, null);
    return;
  }

  if (_dropTarget === nearestEl && _dropPos === nearestPos) return;
  _dropTarget = nearestEl;
  _dropPos = nearestPos;
  _moveBoardPreview(nearestEl.parentElement, nearestPos === 'before' ? nearestEl : nearestEl.nextSibling);
  nearestEl.dataset.dropPosition = nearestPos;
  nearestEl.classList.toggle('drop-position-before', nearestPos === 'before');
  nearestEl.classList.toggle('drop-position-after', nearestPos === 'after');
}

function _insertDraggedRelativeToTarget(list, targetId, draggedId, draggedPath, dragged, position) {
  const targetIndex = list.findIndex(item => item.id === targetId);
  if (targetIndex === -1) return false;
  const draggedIndex = draggedPath && draggedPath.list === list
    ? draggedPath.list.findIndex(item => item.id === draggedId)
    : -1;
  let destinationIndex = position === 'after' ? targetIndex + 1 : targetIndex;
  if (draggedIndex !== -1 && draggedIndex < targetIndex) destinationIndex -= 1;
  destinationIndex = Math.max(0, Math.min(destinationIndex, list.length));
  list.splice(destinationIndex, 0, dragged);
  return true;
}

function _resolveDropTargetInsertIndex(list, dropTargetEl, dropPos, draggedIndex = -1) {
  let insertIndex = list.length;
  const targetItemId = dropTargetEl?.dataset?.itemId;
  if (targetItemId && dropPos) {
    const targetIdx = list.findIndex(item => item.id === targetItemId);
    if (targetIdx !== -1) insertIndex = dropPos === 'after' ? targetIdx + 1 : targetIdx;
  }
  if (draggedIndex !== -1 && draggedIndex < insertIndex) insertIndex -= 1;
  return Math.max(0, Math.min(insertIndex, list.length));
}

function _insertDraggedAtDropTarget(list, dragged, dropTargetEl, dropPos, draggedIndex = -1) {
  list.splice(_resolveDropTargetInsertIndex(list, dropTargetEl, dropPos, draggedIndex), 0, dragged);
}

function _finalizeFolderDrop(event, folderItem, depth, takeDraggedItem, isOwnDescendant, { useSavedDropPosition = false } = {}) {
  const dropTargetEl = useSavedDropPosition ? _dropTarget : null;
  const dropPos = useSavedDropPosition ? _dropPos : null;

  event.preventDefault();
  event.stopPropagation();
  removeDragPlaceholders();
  event.currentTarget.classList.remove('drop-target');

  if (dragPayload.itemType === 'folder' && depth >= 2) {
    showNotice('Folders can only be nested two levels deep.');
    dragPayload = null;
    return;
  }
  if (isOwnDescendant(folderItem)) {
    showNotice('Cannot move a folder into one of its own subfolders.');
    dragPayload = null;
    return;
  }
  if (!canInsertIntoFolder(folderItem, _draggedFolderChildType())) {
    showNotice('Dynamic folders only accept bookmarks.');
    dragPayload = null;
    return;
  }

  pushUndoSnapshot();
  const dragged = takeDraggedItem();
  if (!dragged) { dragPayload = null; return; }

  folderItem.children = folderItem.children || [];
  _insertDraggedAtDropTarget(folderItem.children, dragged, dropTargetEl, dropPos);

  dragPayload = null;
  renderAll();
  saveState();
}

// --- Board item drag & drop ---

function handleBoardItemDragOver(event, targetItem, columnId, parentFolder, depth) {
  if (getActiveBoard()?.locked) return;
  if (!_canDropOnBoard(true)) return;
  // Reject dragover when this item lives inside a locked folder (inherited lock).
  if (event.currentTarget.parentElement?.closest('.board-column-item.is-locked')) return;

  // Dragging over an expanded folder card (including padding areas not covered by
  // header/tagGrid/children handlers) should drop into it, not reorder it.
  // Collapsed folders and locked folders (direct or inherited) fall through to
  // normal before/after reorder.
  if (targetItem.type === 'folder' && !targetItem.collapsed && !targetItem.locked && !event.currentTarget.classList.contains('is-locked')) {
    _activateFolderDropTarget(event, event.currentTarget, () => _canDropIntoFolder(targetItem));
    return;
  }

  _handleVerticalItemDragOver(event);
}

function handleBoardItemDrop(event, targetItem, columnId, parentFolder, depth) {
  if (!dragPayload) return;
  if (getActiveBoard()?.locked) return;
  const isNavColWidget = dragPayload.area === 'nav' && _canDropAsColumnWidget();
  if (!isNavColWidget && !_isBoardDropArea()) return;
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

  if (dragPayload.area === 'speed-dial' || dragPayload.area === 'essential' || dragPayload.area === 'import-manager') {
    const extracted = dragPayload.area === 'import-manager'
      ? _takeImportManagerDraggedItem()
      : _takeDraggedBookmarkItem(board);
    if (!extracted) { dragPayload = null; return; }
    if (!targetPath) {
      addBoardItemToColumn(columnId, extracted);
    } else if (!_insertDraggedRelativeToTarget(targetPath.list, targetItem.id, dragPayload.itemId, null, extracted, position)) {
      dragPayload = null;
      return;
    }
    dragPayload = null; renderAll(); saveState(); return;
  }

  const draggedPath = dragPayload.area === 'board'
    ? findBoardItemInColumns(board, dragPayload.itemId)
    : null;

  if (!targetPath) {
    const dragged = dragPayload.area === 'board'
      ? _takeDraggedBoardItem(board)
      : null;
    if (dragged) addBoardItemToColumn(columnId, dragged);
    dragPayload = null; renderAll(); saveState(); return;
  }

  const dragged = _takeDraggedBoardItem(board);
  if (!dragged) return;
  if (!_insertDraggedRelativeToTarget(targetPath.list, targetItem.id, dragPayload.itemId, draggedPath, dragged, position)) {
    dragPayload = null;
    return;
  }

  dragPayload = null;
  renderAll();
  saveState();
}

// --- Board column drag & drop ---

function handleBoardColumnDragOver(event) {
  if (getActiveBoard()?.locked) return;
  if (dragPayload && !_canDropOnBoard(true)) return;
  _handleVerticalContainerDragOver(event);
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
  if (!isNavColWidget && !_canDropOnBoard()) return;
  pushUndoSnapshot();

  const board = getActiveBoard();
  const column = board.columns.find(col => col.id === columnId);
  if (!column) return;

  if (isNavColWidget) {
    const widget = removeNavItemById(dragPayload.itemId);
    if (!widget) { dragPayload = null; return; }
    _insertDraggedAtDropTarget(column.items, widget, savedTarget, savedPos);
    dragPayload = null; renderAll(); saveState(); return;
  }

  let draggedItem;
  let draggedIndex = -1;
  if (dragPayload.area === 'board') {
    if (!dragPayload.fromDynamicFolderView) draggedIndex = column.items.findIndex(i => i.id === dragPayload.itemId);
    draggedItem = _takeDraggedBoardItem(board);
  } else if (dragPayload.area === 'import-manager') {
    draggedItem = _takeImportManagerDraggedItem();
    if (!draggedItem) { dragPayload = null; return; }
  } else {
    draggedItem = _takeDraggedBookmarkItem(board);
    if (!draggedItem) { dragPayload = null; return; }
  }
  if (!draggedItem) return;

  _insertDraggedAtDropTarget(column.items, draggedItem, savedTarget, savedPos, draggedIndex);

  dragPayload = null;
  renderAll();
  saveState();
}

// --- Board folder drag & drop ---

function handleBoardFolderHeaderDragOver(event, folderCardEl, folderItem, columnId, depth) {
  if (folderItem.locked || folderCardEl.classList.contains('is-locked')) return;
  _activateFolderDropTarget(event, folderCardEl, () => _canDropIntoFolder(folderItem));
}

function _isDroppingFolderIntoOwnDescendant(board, targetFolder) {
  if (dragPayload?.itemType !== 'folder') return false;
  if (dragPayload.itemId === targetFolder.id) return true;
  const dragged = findBoardItemInColumns(board, dragPayload.itemId)?.item;
  return dragged?.type === 'folder' && isDescendant(targetFolder.id, dragged);
}

function handleBoardFolderHeaderDrop(event, folderItem, columnId, depth) {
  if (!_canDropIntoFolder(folderItem)) return;
  if (dragPayload.itemId === folderItem.id) return;
  if (folderItem.locked || event.currentTarget.closest('.board-column-item.is-locked')) { event.preventDefault(); event.stopPropagation(); return; }
  const board = getActiveBoard();
  _finalizeFolderDrop(
    event,
    folderItem,
    depth,
    () => _extractDraggedItem(board),
    targetFolder => _isDroppingFolderIntoOwnDescendant(board, targetFolder)
  );
}

function handleBoardFolderContainerDragOver(event, folderCardEl, folderItem, columnId, depth) {
  if (folderItem.locked || folderCardEl.classList.contains('is-locked')) return;
  if (!_canDropIntoFolder(folderItem)) return;
  _handleVerticalContainerDragOver(event, { markDropTarget: true, useNearest: true });
}

function handleBoardFolderContainerDrop(event, folderItem, columnId, depth) {
  if (!_canDropIntoFolder(folderItem)) return;
  if (dragPayload.itemId === folderItem.id) return;
  if (folderItem.locked || event.currentTarget.closest('.board-column-item.is-locked')) { event.preventDefault(); event.stopPropagation(); return; }
  const board = getActiveBoard();
  _finalizeFolderDrop(
    event,
    folderItem,
    depth,
    () => _extractDraggedItem(board),
    targetFolder => _isDroppingFolderIntoOwnDescendant(board, targetFolder),
    { useSavedDropPosition: true }
  );
}

// --- Import Manager drag & drop ---

function _canDropOnImportManager() {
  return dragPayload?.area === 'import-manager';
}

function _isDroppingImportManagerFolderIntoOwnDescendant(targetFolder) {
  if (dragPayload?.itemType !== 'folder') return false;
  if (dragPayload.itemId === targetFolder.id) return true;
  const dragged = _findDraggedImportManagerItem();
  return dragged?.type === 'folder' && isDescendant(targetFolder.id, dragged);
}

function handleImportManagerItemDragOver(event, targetItem, parentFolder, depth) {
  if (!_canDropOnImportManager()) return;

  if (targetItem.type === 'folder' && !targetItem.collapsed) {
    _activateFolderDropTarget(event, event.currentTarget, _canDropOnImportManager);
    return;
  }

  _handleVerticalItemDragOver(event);
}

function handleImportManagerItemDrop(event, targetItem, parentFolder, depth) {
  if (!_canDropOnImportManager()) return;
  if (dragPayload.itemId === targetItem.id) return;

  event.preventDefault();
  event.stopPropagation();
  const position = _dropPos || 'before';
  removeDragPlaceholders();
  pushUndoSnapshot();

  const targetPath = findImportManagerItemById(targetItem.id);
  if (!targetPath) { dragPayload = null; return; }

  const draggedPath = findImportManagerItemById(dragPayload.itemId);
  const dragged = _takeImportManagerDraggedItem();
  if (!dragged) { dragPayload = null; return; }
  if (!_insertDraggedRelativeToTarget(targetPath.list, targetItem.id, dragPayload.itemId, draggedPath, dragged, position)) {
    dragPayload = null;
    return;
  }

  dragPayload = null;
  renderAll();
  saveState();
}

function handleImportManagerListDragOver(event) {
  if (!_canDropOnImportManager()) return;
  _handleVerticalContainerDragOver(event);
}

function handleImportManagerListDrop(event) {
  if (!_canDropOnImportManager()) return;
  event.preventDefault();
  event.stopPropagation();

  const savedTarget = _dropTarget;
  const savedPos = _dropPos;
  removeDragPlaceholders();
  pushUndoSnapshot();

  const rootItems = state.importManager?.items || [];
  const draggedPath = findImportManagerItemById(dragPayload.itemId);
  const dragged = _takeImportManagerDraggedItem();
  if (!dragged) { dragPayload = null; return; }

  const draggedIndex = draggedPath && draggedPath.list === rootItems
    ? draggedPath.list.findIndex(item => item.id === dragPayload.itemId)
    : -1;
  _insertDraggedAtDropTarget(rootItems, dragged, savedTarget, savedPos, draggedIndex);

  dragPayload = null;
  renderAll();
  saveState();
}

function handleImportManagerFolderHeaderDragOver(event, folderCardEl, folderItem, depth) {
  _activateFolderDropTarget(event, folderCardEl, _canDropOnImportManager);
}

function handleImportManagerFolderHeaderDrop(event, folderItem, depth) {
  if (!_canDropOnImportManager()) return;
  if (dragPayload.itemId === folderItem.id) return;
  _finalizeFolderDrop(
    event,
    folderItem,
    depth,
    _takeImportManagerDraggedItem,
    _isDroppingImportManagerFolderIntoOwnDescendant
  );
}

function handleImportManagerFolderContainerDragOver(event, folderCardEl, folderItem, depth) {
  if (!_canDropOnImportManager()) return;
  _handleVerticalContainerDragOver(event, { markDropTarget: true, useNearest: true });
}

function handleImportManagerFolderContainerDrop(event, folderItem, depth) {
  if (!_canDropOnImportManager()) return;
  if (dragPayload.itemId === folderItem.id) return;
  _finalizeFolderDrop(
    event,
    folderItem,
    depth,
    _takeImportManagerDraggedItem,
    _isDroppingImportManagerFolderIntoOwnDescendant,
    { useSavedDropPosition: true }
  );
}

// --- Speed dial drag & drop ---

function _speedDialAreaAllowed(area) {
  return area === 'speed-dial'
    || area === 'essential'
    || (area === 'board' && dragPayload.itemType === 'bookmark')
    || (area === 'import-manager' && dragPayload.itemType === 'bookmark');
}

function handleSpeedDialSlotDragOver(event, target, slot) {
  if (getActiveBoard()?.locked) return;
  if (target?.speedDial?.[slot]) return;
  if (!dragPayload && !isExternalDrag(event)) return;
  if (dragPayload && !_speedDialAreaAllowed(dragPayload.area)) return;
  if (dragPayload?.area === 'speed-dial' && dragPayload.slot === slot) return;
  event.preventDefault();
  event.stopPropagation();
  event.dataTransfer.dropEffect = dragPayload ? _currentDropEffect() : 'copy';
  const cell = event.currentTarget;
  if (!cell.classList.contains('drop-target')) {
    removeDragPlaceholders();
    cell.classList.add('drop-target');
    const preview = dragPayload ? createEssentialSlotPreview() : createExternalSlotPreview();
    if (preview) cell.appendChild(preview);
  }
}

function _takeSpeedDialDragItem(target, slot) {
  if (dragPayload.area !== 'speed-dial') return _takeDraggedBookmarkItem(getActiveBoard());
  const source = getActiveBoard();
  if (!source) return null;
  if (source === target && dragPayload.slot === slot) return null;
  return removeSpeedDialItemById(source, dragPayload.itemId);
}

function handleSpeedDialSlotDrop(event, target, slot) {
  if (getActiveBoard()?.locked) return;
  if (target?.speedDial?.[slot]) { event.preventDefault(); event.stopPropagation(); return; }
  event.preventDefault();
  event.stopPropagation();
  event.currentTarget.classList.remove('drop-target');
  event.currentTarget.querySelectorAll('.drag-preview').forEach(el => el.remove());
  if (isExternalDrag(event)) {
    const ext = getExternalDrop(event);
    if (ext) openExternalBookmarkModal(ext.url, ext.title, { area: 'speed-dial', slot }, ext.faviconCache);
    return;
  }
  if (!dragPayload || !_speedDialAreaAllowed(dragPayload.area)) return;
  pushUndoSnapshot();
  const item = _takeSpeedDialDragItem(target, slot);
  if (!item || !setSpeedDialSlot(target, slot, item)) {
    dragPayload = null;
    renderAll();
    saveState();
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
    const isSameActiveBoardDrag = dragPayload?.area === 'board' && item.boardId === state.activeBoardId;
    if (!isSameActiveBoardDrag) {
      const targetBoard = state.boards.find(b => b.id === item.boardId);
      if (!targetBoard?.locked) {
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = _currentDropEffect();
        event.currentTarget.classList.add('drop-target');
      }
    }
    return;
  }
  // Accept folder-tab drags (removing a board from a folder back to nav)
  if (dragPayload?.area === 'folder-tab') {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = _currentDropEffect();
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
  event.dataTransfer.dropEffect = _currentDropEffect();

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
    if (dragPayload?.area === 'board' && targetItem.boardId === state.activeBoardId) { dragPayload = null; return; }
    removeDragPlaceholders();
    pushUndoSnapshot();
    const targetBoard = state.boards.find(b => b.id === targetItem.boardId);
    if (!targetBoard || targetBoard.locked) { dragPayload = null; return; }
    const inbox = getBoardInbox(targetBoard);
    if (!inbox) { dragPayload = null; return; }
    let dragged = null;
    const board = getActiveBoard();
    if (dragPayload.area === 'board') {
      dragged = _takeDraggedBoardItem(board);
    } else if (dragPayload.area === 'import-manager') {
      dragged = _takeImportManagerDraggedItem();
    } else if (dragPayload.area === 'nav') {
      dragged = removeNavItemById(dragPayload.itemId);
    } else if (dragPayload.area === 'speed-dial' || dragPayload.area === 'essential') {
      dragged = _takeDraggedBookmarkItem(board);
    }
    if (!dragged) { dragPayload = null; return; }
    inbox.items.push(dragged);
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
  if (dragPayload.area !== 'nav' && dragPayload.area !== 'folder-tab' && !_canDropAsNavWidget()) return;
  // Always accept the drop so the browser fires the drop event even when the
  // cursor is over the preview clone's transparent space.
  event.preventDefault();
  event.dataTransfer.dropEffect = _currentDropEffect();
  event.stopPropagation();
  // If an item-level preview is already positioned, cursor is over the clone's
  // transparent space — don't override preview position unless the cursor has
  // moved into the blank space below the final nav item.
  const navItems = Array.from(elements.navList.querySelectorAll(':scope > .nav-item:not(.drag-preview)'));
  const lastItem = navItems[navItems.length - 1] || null;
  const afterLastItem = !lastItem || event.clientY > lastItem.getBoundingClientRect().bottom;
  if (_dropTarget !== null && _dropTarget !== elements.navList && !afterLastItem) return;
  if (_dropTarget === elements.navList) return;
  _dropTarget = elements.navList; _dropPos = 'end';
  _moveNavPreview(elements.navList, null);
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
