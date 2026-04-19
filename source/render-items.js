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

// --- Board item element ---

function createBoardItemElement(item, columnId, depth = 1, parentFolder = null) {
  if (item.type === 'widget') return createWidgetElement(item, columnId) || document.createElement('div');

  const itemEl = document.createElement('div');
  itemEl.className = 'board-column-item';
  itemEl.dataset.itemId = item.id;
  itemEl.dataset.columnId = columnId;
  itemEl.dataset.itemType = item.type;
  itemEl.draggable = true;

  if (item.type === 'folder') {
    itemEl.classList.add('folder-card');
    if (selectedItemIds?.has(item.id)) itemEl.classList.add('selected');

    const header = document.createElement('div');
    header.className = 'folder-header';

    const folderCheckbox = document.createElement('div');
    folderCheckbox.className = 'item-checkbox';
    folderCheckbox.addEventListener('click', e => { e.stopPropagation(); e.preventDefault(); toggleItemSelection(item.id, itemEl); });
    header.appendChild(folderCheckbox);

    const collapseBtn = document.createElement('button');
    collapseBtn.type = 'button';
    collapseBtn.className = 'collapse-btn';
    collapseBtn.title = item.collapsed ? 'Expand' : 'Collapse';
    collapseBtn.setAttribute('aria-label', item.collapsed ? 'Expand folder' : 'Collapse folder');
    collapseBtn.appendChild(icon(item.collapsed ? 'icon-chevron-right' : 'icon-chevron-down'));
    collapseBtn.addEventListener('click', event => {
      event.stopPropagation();
      item.collapsed = !item.collapsed;
      saveState();
      const inInbox = state.boards.some(b => b.columns.some(c => c.isInbox && c.id === columnId));
      if (inInbox) renderInboxPanel(); else renderBoard();
    });

    const title = document.createElement('div');
    title.className = 'folder-title';
    title.textContent = item.title;

    header.appendChild(collapseBtn);
    header.appendChild(title);
    itemEl.appendChild(header);

    const board = getActiveBoard();
    const folderTagArea = document.createElement('div');
    folderTagArea.className = 'folder-tag-area';
    const inherited = computeInheritedTags(item, board);
    if (inherited.length) folderTagArea.appendChild(createTagSection('Inherited', inherited));
    if (item.sharedTags?.length) folderTagArea.appendChild(createTagSection('Shared', item.sharedTags));
    if (item.tags?.length) folderTagArea.appendChild(createTagSection('Tags', item.tags));
    if (folderTagArea.children.length) itemEl.appendChild(folderTagArea);

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
  } else if (item.type === 'bookmark') {
    itemEl.classList.add('bookmark-item');
    if (selectedItemIds?.has(item.id)) itemEl.classList.add('selected');

    const bmCheckbox = document.createElement('div');
    bmCheckbox.className = 'item-checkbox';
    bmCheckbox.addEventListener('click', e => { e.stopPropagation(); e.preventDefault(); toggleItemSelection(item.id, itemEl); });
    itemEl.appendChild(bmCheckbox);

    const favicon = document.createElement('span');
    favicon.className = 'bookmark-favicon';
    if (item.url) {
      const faviconImg = document.createElement('img');
      setFavicon(faviconImg, item, 64);
      faviconImg.alt = '';
      faviconImg.draggable = false;
      favicon.appendChild(faviconImg);
    }
    itemEl.appendChild(favicon);

    const body = document.createElement('div');
    body.className = 'bookmark-body';

    const label = document.createElement('span');
    label.className = 'bookmark-label';
    label.textContent = item.title || item.url || 'Untitled Bookmark';
    body.appendChild(label);

    const bmBoard = getActiveBoard();
    const bmInherited = computeInheritedTags(item, bmBoard);
    if (bmInherited.length) {
      const iSection = createTagSection('Inherited', bmInherited);
      iSection.classList.add('bookmark-tags');
      body.appendChild(iSection);
    }

    if (item.tags && item.tags.length > 0) {
      const tagsEl = document.createElement('div');
      tagsEl.className = 'bookmark-tags';
      renderTagsInto(tagsEl, item.tags);
      body.appendChild(tagsEl);
    }

    itemEl.appendChild(body);
    itemEl.dataset.tooltip = buildTooltip(item);
    itemEl.addEventListener('click', () => window.open(item.url, '_blank'));
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
