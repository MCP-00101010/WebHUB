// --- Tag chip rendering ---

function applyTagColor(chip, tag) {
  const color = state.settings.tagColors?.[tag];
  if (color) {
    chip.style.background = hexToRgba(color, 0.15);
    chip.style.color = color;
  }
}

function makeTagChip(tag) {
  const chip = document.createElement('span');
  chip.className = 'tag-chip';
  chip.textContent = tag;
  applyTagColor(chip, tag);
  return chip;
}

function renderTagsInto(container, tags) {
  (tags || []).forEach(t => container.appendChild(makeTagChip(t)));
}

function createTagSection(labelText, tags) {
  const section = document.createElement('div');
  section.className = 'tag-section';
  const lbl = document.createElement('span');
  lbl.className = 'tag-section-label';
  lbl.textContent = labelText;
  section.appendChild(lbl);
  tags.forEach(t => section.appendChild(makeTagChip(t)));
  return section;
}

function appendTagRow(grid, labelText, tags) {
  const lbl = document.createElement('span');
  lbl.className = 'item-tag-label';
  lbl.textContent = labelText;
  const chips = document.createElement('div');
  chips.className = 'item-tag-chips';
  renderTagsInto(chips, tags);
  grid.appendChild(lbl);
  grid.appendChild(chips);
}

// --- Board item element ---

function createBoardItemElement(item, columnId, depth = 1, parentFolder = null) {
  if (item.type === 'widget') return createWidgetElement(item, columnId) || document.createElement('div');

  const itemEl = document.createElement('div');
  itemEl.className = 'board-column-item';
  itemEl.dataset.itemId = item.id;
  itemEl.dataset.columnId = columnId;
  itemEl.dataset.itemType = item.type;
  itemEl.draggable = true;

  if (item.type === 'folder' || item.type === 'bookmark') {
    if (item.type === 'folder') itemEl.classList.add('folder-card');
    else itemEl.classList.add('bookmark-item');
    if (selectedItemIds?.has(item.id)) itemEl.classList.add('selected');

    // --- Header row: checkbox + icon + name ---
    const header = document.createElement('div');
    header.className = 'item-header';

    const checkbox = document.createElement('div');
    checkbox.className = 'item-checkbox';
    checkbox.addEventListener('click', e => { e.stopPropagation(); e.preventDefault(); toggleItemSelection(item.id, itemEl); });
    header.appendChild(checkbox);

    if (item.type === 'folder') {
      const collapseBtn = document.createElement('button');
      collapseBtn.type = 'button';
      collapseBtn.className = 'collapse-btn';
      collapseBtn.title = item.collapsed ? 'Expand' : 'Collapse';
      collapseBtn.setAttribute('aria-label', item.collapsed ? 'Expand folder' : 'Collapse folder');
      collapseBtn.appendChild(icon(item.collapsed ? 'icon-folder-closed' : 'icon-folder-open'));
      collapseBtn.addEventListener('click', event => {
        event.stopPropagation();
        item.collapsed = !item.collapsed;
        saveState();
        const inInbox = state.boards.some(b => b.columns.some(c => c.isInbox && c.id === columnId));
        if (inInbox) renderInboxPanel(); else renderBoard();
      });
      header.appendChild(collapseBtn);
    } else {
      const favicon = document.createElement('span');
      favicon.className = 'bookmark-favicon';
      if (item.url) {
        const faviconImg = document.createElement('img');
        setFavicon(faviconImg, item, 64);
        faviconImg.alt = '';
        faviconImg.draggable = false;
        favicon.appendChild(faviconImg);
      }
      header.appendChild(favicon);
    }

    const name = document.createElement('span');
    name.className = item.type === 'folder' ? 'folder-title' : 'bookmark-label';
    name.textContent = item.type === 'folder' ? item.title : (item.title || item.url || 'Untitled Bookmark');
    header.appendChild(name);

    itemEl.appendChild(header);

    // --- Tag grid ---
    const board = getActiveBoard();
    const inherited = computeInheritedTags(item, board);
    const ownTags = item.tags || [];
    const sharedTags = item.type === 'folder' ? (item.sharedTags || []) : [];

    if (ownTags.length || inherited.length || sharedTags.length) {
      const tagGrid = document.createElement('div');
      tagGrid.className = 'item-tag-grid';
      if (ownTags.length) appendTagRow(tagGrid, 'Tags', ownTags);
      if (inherited.length) appendTagRow(tagGrid, 'Inherited', inherited);
      if (sharedTags.length) appendTagRow(tagGrid, 'Shared', sharedTags);
      itemEl.appendChild(tagGrid);
    }

    // --- Bookmark-specific ---
    if (item.type === 'bookmark') {
      itemEl.dataset.tooltip = buildTooltip(item);
      itemEl.addEventListener('click', () => window.open(item.url, '_blank'));
    }

    // --- Folder-specific: drag on header + children container ---
    if (item.type === 'folder') {
      header.addEventListener('dragover', event => handleBoardFolderHeaderDragOver(event, item, columnId, depth));
      header.addEventListener('dragleave', event => {
        if (header.contains(event.relatedTarget)) return;
        header.classList.remove('drop-target');
      });
      header.addEventListener('drop', event => {
        event.preventDefault();
        event.stopPropagation();
        handleBoardFolderHeaderDrop(event, item, columnId, depth);
      });

      if (!item.collapsed) {
        const childrenContainer = document.createElement('div');
        childrenContainer.className = 'folder-children';
        childrenContainer.addEventListener('dragover', event => handleBoardFolderContainerDragOver(event, item, columnId, depth));
        childrenContainer.addEventListener('dragleave', event => {
          if (event.currentTarget.contains(event.relatedTarget)) return;
          event.currentTarget.classList.remove('drop-target');
        });
        childrenContainer.addEventListener('drop', event => {
          event.preventDefault();
          event.stopPropagation();
          handleBoardFolderContainerDrop(event, item, columnId, depth);
        });
        itemEl.appendChild(childrenContainer);
        if (Array.isArray(item.children)) {
          item.children.forEach(child => childrenContainer.appendChild(createBoardItemElement(child, columnId, depth + 1, item)));
        }
      }
    }
  } else if (item.type === 'title') {
    if (item.title) {
      itemEl.classList.add('title-item');
      const titleSpan = document.createElement('span');
      titleSpan.textContent = item.title;
      itemEl.appendChild(titleSpan);
    } else {
      itemEl.classList.add('divider-item');
    }
  }

  itemEl.addEventListener('contextmenu', event => {
    event.preventDefault();
    event.stopPropagation();
    handleBoardContextMenu(event, item, columnId, parentFolder, depth);
  });

  itemEl.addEventListener('dragstart', event => {
    event.stopPropagation();
    dragPayload = { area: 'board', itemId: item.id, itemType: item.type, sourceColumnId: columnId, sourceParentId: parentFolder ? parentFolder.id : null };
    event.dataTransfer.setData('text/plain', item.id);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.dropEffect = 'move';
    applyDragImage(event, itemEl);
  });

  itemEl.addEventListener('dragend', () => { dragPayload = null; removeDragPlaceholders(); });

  itemEl.addEventListener('dragover', event => handleBoardItemDragOver(event, item, columnId, parentFolder, depth));
  itemEl.addEventListener('dragleave', event => {
    if (itemEl.contains(event.relatedTarget)) return;
    itemEl.classList.remove('drop-target', 'drop-position-before', 'drop-position-after');
    itemEl.removeAttribute('data-drop-position');
  });
  itemEl.addEventListener('drop', event => handleBoardItemDrop(event, item, columnId, parentFolder, depth));

  return itemEl;
}
