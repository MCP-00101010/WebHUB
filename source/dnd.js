let dragPayload = null;
let _dropTarget = null;
let _dropPos    = null;

function isExternalDrag(event) {
  return !dragPayload;
}

function getExternalDrop(event) {
  const mozUrl = event.dataTransfer.getData('text/x-moz-url');
  if (mozUrl) {
    const [url, title] = mozUrl.split('\n');
    return { url: (url || '').trim(), title: (title || '').trim() };
  }
  const uriList = event.dataTransfer.getData('text/uri-list');
  if (uriList) {
    const url = uriList.split('\n').map(l => l.trim()).find(l => l && !l.startsWith('#'));
    if (url) return { url, title: '' };
  }
  const text = event.dataTransfer.getData('text/plain');
  if (text?.trim().match(/^https?:\/\//)) return { url: text.trim(), title: '' };
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
  if (dragPayload?.itemId && kind !== 'speed-dial') {
    const selector = kind === 'nav'
      ? `.nav-item[data-id="${CSS.escape(dragPayload.itemId)}"]`
      : `[data-item-id="${CSS.escape(dragPayload.itemId)}"]`;
    const sourceEl = document.querySelector(selector);
    if (sourceEl) {
      const clone = sourceEl.cloneNode(true);
      clone.classList.add('drag-preview');
      clone.classList.remove('selected', 'drop-position-before', 'drop-position-after');
      clone.removeAttribute('draggable');
      clone.removeAttribute('data-drop-position');
      clone.querySelectorAll('[data-drop-position]').forEach(el => {
        el.removeAttribute('data-drop-position');
        el.classList.remove('drop-position-before', 'drop-position-after', 'selected');
      });
      return clone;
    }
  }
  const placeholder = document.createElement('div');
  placeholder.className = `drag-placeholder ${kind}-placeholder`;
  return placeholder;
}

function applyDragImage(event, element) {
  const clone = element.cloneNode(true);
  clone.style.cssText = 'position:fixed;top:-9999px;left:-9999px;margin:0;';
  document.body.appendChild(clone);
  const rect = element.getBoundingClientRect();
  event.dataTransfer.setDragImage(clone, event.clientX - rect.left, event.clientY - rect.top);
  requestAnimationFrame(() => clone.remove());
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
  } else {
    dragPayload = null;
    return;
  }

  dragPayload = null;
  renderAll();
  saveState();
}

// --- Board item drag & drop ---

function handleBoardItemDragOver(event, targetItem, columnId, parentFolder, depth) {
  if (!dragPayload || (dragPayload.area !== 'board' && dragPayload.area !== 'speed-dial' && dragPayload.area !== 'essential')) return;
  event.preventDefault();
  event.stopPropagation();
  event.dataTransfer.dropEffect = 'move';

  const itemEl = event.currentTarget;
  const rect = itemEl.getBoundingClientRect();
  const position = event.clientY - rect.top < rect.height / 2 ? 'before' : 'after';
  if (_dropTarget === itemEl && _dropPos === position) return;

  removeDragPlaceholders();
  _dropTarget = itemEl;
  _dropPos    = position;
  itemEl.dataset.dropPosition = position;
  itemEl.classList.toggle('drop-position-before', position === 'before');
  itemEl.classList.toggle('drop-position-after', position === 'after');
  const preview = createDragPlaceholder('board');
  if (position === 'before') itemEl.parentElement.insertBefore(preview, itemEl);
  else itemEl.parentElement.insertBefore(preview, itemEl.nextSibling);
}

function handleBoardItemDrop(event, targetItem, columnId, parentFolder, depth) {
  if (!dragPayload || (dragPayload.area !== 'board' && dragPayload.area !== 'speed-dial' && dragPayload.area !== 'essential')) return;
  if (dragPayload.itemId === targetItem.id) return;

  event.preventDefault();
  event.stopPropagation();
  removeDragPlaceholders();
  pushUndoSnapshot();

  const board = getActiveBoard();
  const position = event.currentTarget.dataset.dropPosition || 'before';
  const targetPath = findBoardItemInColumns(board, targetItem.id);

  if (dragPayload.area === 'speed-dial' || dragPayload.area === 'essential') {
    let extracted;
    if (dragPayload.area === 'speed-dial') {
      const sdIdx = board.speedDial.findIndex(i => i.id === dragPayload.itemId);
      if (sdIdx === -1) { dragPayload = null; return; }
      [extracted] = board.speedDial.splice(sdIdx, 1);
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
    dragPayload = null;
    renderAll();
    saveState();
    return;
  }

  const draggedPath = findBoardItemInColumns(board, dragPayload.itemId);

  if (!targetPath) {
    const dragged = removeBoardItemById(dragPayload.itemId);
    if (dragged) addBoardItemToColumn(columnId, dragged);
    dragPayload = null;
    renderAll();
    saveState();
    return;
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
  if (!dragPayload && !isExternalDrag(event)) return;
  if (dragPayload && dragPayload.area !== 'board' && dragPayload.area !== 'speed-dial' && dragPayload.area !== 'essential') return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  event.stopPropagation();

  const columnEl = event.currentTarget;
  const itemEls = Array.from(columnEl.querySelectorAll(':scope > .board-column-item:not(.drag-preview)'));

  if (itemEls.length === 0) {
    if (_dropTarget === columnEl && _dropPos === 'start') return;
    removeDragPlaceholders();
    _dropTarget = columnEl; _dropPos = 'start';
    columnEl.classList.add('drop-target');
    columnEl.prepend(createDragPlaceholder('board'));
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
    removeDragPlaceholders();
    _dropTarget = columnEl; _dropPos = 'end';
    columnEl.classList.add('drop-target');
    columnEl.append(createDragPlaceholder('board'));
    return;
  }

  if (_dropTarget === nearestEl && _dropPos === nearestPos) return;
  removeDragPlaceholders();
  _dropTarget = nearestEl; _dropPos = nearestPos;
  nearestEl.dataset.dropPosition = nearestPos;
  nearestEl.classList.toggle('drop-position-before', nearestPos === 'before');
  nearestEl.classList.toggle('drop-position-after', nearestPos === 'after');
  const colPreview = createDragPlaceholder('board');
  if (nearestPos === 'before') nearestEl.parentElement.insertBefore(colPreview, nearestEl);
  else nearestEl.parentElement.insertBefore(colPreview, nearestEl.nextSibling);
}

function handleBoardColumnDrop(event, columnId) {
  event.preventDefault();
  event.stopPropagation();
  event.currentTarget.classList.remove('drop-target');
  removeDragPlaceholders();

  if (isExternalDrag(event)) {
    const ext = getExternalDrop(event);
    if (ext) openExternalBookmarkModal(ext.url, ext.title, { area: 'board-empty', columnId });
    return;
  }

  if (!dragPayload || (dragPayload.area !== 'board' && dragPayload.area !== 'speed-dial' && dragPayload.area !== 'essential')) return;
  pushUndoSnapshot();

  const board = getActiveBoard();
  const column = board.columns.find(col => col.id === columnId);
  if (!column) { removeDragPlaceholders(); return; }

  // Read insertion intent from the active indicator BEFORE modifying state
  const columnEl = event.currentTarget;
  const indicatedEl = columnEl.querySelector('[data-drop-position]');
  let stateInsertIndex = column.items.length;

  if (indicatedEl) {
    const refId = indicatedEl.dataset.itemId;
    const refPos = indicatedEl.dataset.dropPosition;
    const refIdx = column.items.findIndex(i => i.id === refId);
    if (refIdx !== -1) {
      stateInsertIndex = refPos === 'after' ? refIdx + 1 : refIdx;
    }
  }

  removeDragPlaceholders();

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
  } else {
    draggedItem = state.essentials[dragPayload.slot];
    if (!draggedItem) { dragPayload = null; return; }
    state.essentials[dragPayload.slot] = null; trimEssentialsTail();
    draggedItem.type = 'bookmark';
    if (!draggedItem.tags) draggedItem.tags = [];
  }
  if (!draggedItem) return;

  stateInsertIndex = Math.max(0, Math.min(stateInsertIndex, column.items.length));
  column.items.splice(stateInsertIndex, 0, draggedItem);

  dragPayload = null;
  renderAll();
  saveState();
}

// --- Board folder drag & drop ---

function handleBoardFolderHeaderDragOver(event, folderItem, columnId, depth) {
  if (!dragPayload || (dragPayload.area !== 'board' && dragPayload.area !== 'speed-dial' && dragPayload.area !== 'essential')) return;
  if (depth >= 2) return;
  event.preventDefault();
  event.stopPropagation();
  const header = event.currentTarget;
  if (header.classList.contains('drop-target')) return;
  removeDragPlaceholders();
  header.classList.add('drop-target');
  const childrenContainer = header.parentElement.querySelector('.folder-children');
  if (childrenContainer) childrenContainer.appendChild(createDragPlaceholder('board'));
}

function handleBoardFolderHeaderDrop(event, folderItem, columnId, depth) {
  if (!dragPayload || (dragPayload.area !== 'board' && dragPayload.area !== 'speed-dial' && dragPayload.area !== 'essential')) return;
  if (dragPayload.itemId === folderItem.id) return;
  event.preventDefault();
  event.stopPropagation();
  removeDragPlaceholders();
  event.currentTarget.classList.remove('drop-target');
  pushUndoSnapshot();

  const board = getActiveBoard();
  let dragged;
  if (dragPayload.area === 'board') {
    const oldFound = findBoardItemInColumns(board, dragPayload.itemId);
    const oldParent = oldFound?.parent;
    dragged = removeBoardItemById(dragPayload.itemId);
    if (dragged && oldParent?.autoRemoveTags && oldParent.sharedTags?.length) {
      dragged.tags = (dragged.tags || []).filter(t => !oldParent.sharedTags.includes(t));
    }
  } else if (dragPayload.area === 'speed-dial') {
    const sdIdx = board.speedDial.findIndex(i => i.id === dragPayload.itemId);
    if (sdIdx === -1) { dragPayload = null; return; }
    [dragged] = board.speedDial.splice(sdIdx, 1);
    dragged.type = 'bookmark';
    if (!dragged.tags) dragged.tags = [];
  } else {
    dragged = state.essentials[dragPayload.slot];
    if (!dragged) { dragPayload = null; return; }
    state.essentials[dragPayload.slot] = null; trimEssentialsTail();
    dragged.type = 'bookmark';
    if (!dragged.tags) dragged.tags = [];
  }
  if (!dragged) return;

  if (depth >= 2 && dragged.type === 'folder') {
    alert('Cannot nest folders deeper than two levels.');
    addBoardItemToColumn(columnId, dragged);
  } else if (isDescendant(dragged.id, folderItem)) {
    alert('Cannot move an item into one of its own descendants.');
    addBoardItemToColumn(columnId, dragged);
  } else {
    folderItem.children = folderItem.children || [];
    folderItem.children.push(dragged);
  }

  dragPayload = null;
  renderAll();
  saveState();
}

function handleBoardFolderContainerDragOver(event, folderItem, columnId, depth) {
  if (!dragPayload || (dragPayload.area !== 'board' && dragPayload.area !== 'speed-dial' && dragPayload.area !== 'essential')) return;
  if (depth >= 2) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  event.stopPropagation();
  const container = event.currentTarget;
  if (container.classList.contains('drop-target')) return;
  removeDragPlaceholders();
  container.classList.add('drop-target');
  container.appendChild(createDragPlaceholder('board'));
}

function handleBoardFolderContainerDrop(event, folderItem, columnId, depth) {
  if (!dragPayload || (dragPayload.area !== 'board' && dragPayload.area !== 'speed-dial' && dragPayload.area !== 'essential')) return;
  if (dragPayload.itemId === folderItem.id) return;
  event.preventDefault();
  event.stopPropagation();
  removeDragPlaceholders();
  event.currentTarget.classList.remove('drop-target');
  pushUndoSnapshot();

  const board = getActiveBoard();
  let dragged;
  if (dragPayload.area === 'board') {
    const oldFound = findBoardItemInColumns(board, dragPayload.itemId);
    const oldParent = oldFound?.parent;
    dragged = removeBoardItemById(dragPayload.itemId);
    if (dragged && oldParent?.autoRemoveTags && oldParent.sharedTags?.length) {
      dragged.tags = (dragged.tags || []).filter(t => !oldParent.sharedTags.includes(t));
    }
  } else if (dragPayload.area === 'speed-dial') {
    const sdIdx = board.speedDial.findIndex(i => i.id === dragPayload.itemId);
    if (sdIdx === -1) { dragPayload = null; return; }
    [dragged] = board.speedDial.splice(sdIdx, 1);
    dragged.type = 'bookmark';
    if (!dragged.tags) dragged.tags = [];
  } else {
    dragged = state.essentials[dragPayload.slot];
    if (!dragged) { dragPayload = null; return; }
    state.essentials[dragPayload.slot] = null; trimEssentialsTail();
    dragged.type = 'bookmark';
    if (!dragged.tags) dragged.tags = [];
  }
  if (!dragged) return;

  if (depth >= 2 && dragged.type === 'folder') {
    alert('Cannot nest folders deeper than two levels.');
    addBoardItemToColumn(columnId, dragged);
  } else if (isDescendant(dragged.id, folderItem)) {
    alert('Cannot move an item into one of its own descendants.');
    addBoardItemToColumn(columnId, dragged);
  } else {
    folderItem.children = folderItem.children || [];
    folderItem.children.push(dragged);
  }

  dragPayload = null;
  renderAll();
  saveState();
}

// --- Speed dial drag & drop ---

function handleSpeedDialItemDragOver(event, item) {
  if (!dragPayload) return;
  if (dragPayload.area !== 'speed-dial' && dragPayload.area !== 'essential' && !(dragPayload.area === 'board' && dragPayload.itemType === 'bookmark')) return;
  event.preventDefault();
  event.stopPropagation();
  event.dataTransfer.dropEffect = 'move';

  const el = event.currentTarget;
  const rect = el.getBoundingClientRect();
  const position = event.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
  if (el.dataset.dropPosition === position) return;

  removeDragPlaceholders();
  el.dataset.dropPosition = position;
  el.classList.toggle('drop-position-before', position === 'before');
  el.classList.toggle('drop-position-after', position === 'after');
  const placeholder = createDragPlaceholder('speed-dial');
  if (position === 'before') {
    el.parentElement.insertBefore(placeholder, el);
  } else {
    el.parentElement.insertBefore(placeholder, el.nextSibling);
  }
}

function handleSpeedDialItemDrop(event, targetItem) {
  if (!dragPayload) return;
  event.preventDefault();
  event.stopPropagation();
  removeDragPlaceholders();
  pushUndoSnapshot();

  const board = getActiveBoard();
  const position = event.currentTarget.dataset.dropPosition || 'before';

  if (dragPayload.area === 'speed-dial') {
    if (dragPayload.itemId === targetItem.id) { dragPayload = null; return; }
    const draggedIdx = board.speedDial.findIndex(i => i.id === dragPayload.itemId);
    const targetIdx = board.speedDial.findIndex(i => i.id === targetItem.id);
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
    const insertIdx = position === 'after' ? targetIdx + 1 : targetIdx;
    board.speedDial.splice(Math.max(0, insertIdx), 0, essItem);
  } else if (dragPayload.area === 'board' && dragPayload.itemType === 'bookmark') {
    const dragged = removeBoardItemById(dragPayload.itemId);
    if (!dragged) { dragPayload = null; return; }
    dragged.type = 'bookmark';
    if (!dragged.tags) dragged.tags = [];
    const targetIdx = board.speedDial.findIndex(i => i.id === targetItem.id);
    const insertIdx = position === 'after' ? targetIdx + 1 : targetIdx;
    board.speedDial.splice(Math.max(0, insertIdx), 0, dragged);
  } else {
    dragPayload = null;
    return;
  }

  dragPayload = null;
  renderAll();
  saveState();
}

function handleSpeedDialContainerDragOver(event) {
  if (!dragPayload && !isExternalDrag(event)) return;
  if (dragPayload && dragPayload.area !== 'speed-dial' && dragPayload.area !== 'essential' && !(dragPayload.area === 'board' && dragPayload.itemType === 'bookmark')) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';

  const linkEls = Array.from(elements.speedDial.querySelectorAll('.speed-link'));
  if (linkEls.length === 0) return;

  // Find nearest item by cursor X — covers left padding and gaps between items
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

  if (nearestEl.dataset.dropPosition === nearestPos) return;
  removeDragPlaceholders();
  nearestEl.dataset.dropPosition = nearestPos;
  nearestEl.classList.toggle('drop-position-before', nearestPos === 'before');
  nearestEl.classList.toggle('drop-position-after', nearestPos === 'after');
}

function handleSpeedDialContainerDrop(event) {
  event.preventDefault();
  if (isExternalDrag(event)) {
    removeDragPlaceholders();
    const ext = getExternalDrop(event);
    if (ext) openExternalBookmarkModal(ext.url, ext.title, { area: 'speed-dial' });
    return;
  }
  if (!dragPayload) return;
  pushUndoSnapshot();
  const board = getActiveBoard();
  if (!board) { removeDragPlaceholders(); return; }

  // Read insertion intent from the active indicator BEFORE modifying state
  const indicatedEl = elements.speedDial.querySelector('.speed-link[data-drop-position]');
  let stateInsertIndex = board.speedDial.length;

  if (indicatedEl?.dataset.itemId) {
    const refIdx = board.speedDial.findIndex(i => i.id === indicatedEl.dataset.itemId);
    if (refIdx !== -1) {
      stateInsertIndex = indicatedEl.dataset.dropPosition === 'after' ? refIdx + 1 : refIdx;
    }
  }

  removeDragPlaceholders();

  if (dragPayload.area === 'speed-dial') {
    const origIdx = board.speedDial.findIndex(i => i.id === dragPayload.itemId);
    if (origIdx === -1) { dragPayload = null; return; }
    const [dragged] = board.speedDial.splice(origIdx, 1);
    if (origIdx < stateInsertIndex) stateInsertIndex -= 1;
    board.speedDial.splice(Math.max(0, Math.min(stateInsertIndex, board.speedDial.length)), 0, dragged);
  } else if (dragPayload.area === 'essential') {
    const essItem = state.essentials[dragPayload.slot];
    if (!essItem) { dragPayload = null; return; }
    state.essentials[dragPayload.slot] = null; trimEssentialsTail();
    essItem.type = 'bookmark';
    if (!essItem.tags) essItem.tags = [];
    board.speedDial.splice(Math.max(0, Math.min(stateInsertIndex, board.speedDial.length)), 0, essItem);
  } else if (dragPayload.area === 'board' && dragPayload.itemType === 'bookmark') {
    const dragged = removeBoardItemById(dragPayload.itemId);
    if (!dragged) { dragPayload = null; return; }
    dragged.type = 'bookmark';
    if (!dragged.tags) dragged.tags = [];
    board.speedDial.splice(Math.max(0, Math.min(stateInsertIndex, board.speedDial.length)), 0, dragged);
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
  if (dragPayload?.area === 'board' && item.type === 'board') {
    if (!['bookmark', 'folder'].includes(dragPayload.itemType)) return;
    if (item.boardId === state.activeBoardId) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    event.currentTarget.classList.add('drop-target');
    return;
  }
  if (!dragPayload || dragPayload.area !== 'nav') return;
  event.preventDefault();
  event.stopPropagation();
  event.dataTransfer.dropEffect = 'move';

  const element = event.currentTarget;
  const rect = element.getBoundingClientRect();
  const position = event.clientY - rect.top < rect.height / 2 ? 'before' : 'after';
  if (element.dataset.dropPosition === position) return;

  if (_dropTarget === element && _dropPos === position) return;
  removeDragPlaceholders();
  _dropTarget = element; _dropPos = position;
  element.dataset.dropPosition = position;
  element.classList.toggle('drop-position-before', position === 'before');
  element.classList.toggle('drop-position-after', position === 'after');
  const preview = createDragPlaceholder('nav');
  if (position === 'before') element.parentElement.insertBefore(preview, element);
  else element.parentElement.insertBefore(preview, element.nextSibling);
}

function handleNavDrop(event, targetItem, parent) {
  if (dragPayload?.area === 'board' && targetItem.type === 'board') {
    if (!['bookmark', 'folder'].includes(dragPayload.itemType)) { dragPayload = null; return; }
    removeDragPlaceholders();
    pushUndoSnapshot();
    const targetBoard = state.boards.find(b => b.id === targetItem.boardId);
    if (!targetBoard) { dragPayload = null; return; }
    const inbox = getBoardInbox(targetBoard);
    if (!inbox) { dragPayload = null; return; }
    const dragged = removeBoardItemById(dragPayload.itemId);
    if (!dragged) { dragPayload = null; return; }
    inbox.items.push(dragged);
    dragPayload = null;
    renderAll();
    saveState();
    return;
  }
  if (!dragPayload || dragPayload.area !== 'nav') return;
  if (dragPayload.itemId === targetItem.id) return;
  event.preventDefault();
  event.stopPropagation();
  removeDragPlaceholders();
  pushUndoSnapshot();

  const targetPath = findNavItemPath(targetItem.id);
  const draggedPath = findNavItemPath(dragPayload.itemId);
  const position = event.currentTarget.dataset.dropPosition || 'before';

  if (targetItem.type === 'folder') {
    const dragged = removeNavItemById(dragPayload.itemId);
    if (!dragged) return;
    targetItem.children = targetItem.children || [];
    targetItem.children.push(dragged);
    dragPayload = null;
    renderNav();
    saveState();
    return;
  }

  if (!targetPath) {
    const dragged = removeNavItemById(dragPayload.itemId);
    if (dragged) state.navItems.push(dragged);
    dragPayload = null;
    renderNav();
    saveState();
    return;
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
  if (!dragPayload || dragPayload.area !== 'nav') return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  event.stopPropagation();
  if (_dropTarget === elements.navList) return;
  removeDragPlaceholders();
  _dropTarget = elements.navList; _dropPos = 'end';
  elements.navList.appendChild(createDragPlaceholder('nav'));
}

function handleNavListDrop(event) {
  event.preventDefault();
  removeDragPlaceholders();
  if (!dragPayload || dragPayload.area !== 'nav') return;
  pushUndoSnapshot();
  const dragged = removeNavItemById(dragPayload.itemId);
  if (!dragged) return;
  state.navItems.push(dragged);
  dragPayload = null;
  renderNav();
  saveState();
}
