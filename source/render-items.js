// --- Tag chip rendering ---

function resolveTag(tagId) {
  const found = (state.tags || []).find(t => t.id === tagId);
  return found || { id: tagId, name: tagId, groupId: null, color: null };
}

function applyTagColor(chip, tagId) {
  const tag = resolveTag(tagId);
  const color = tag.color || (state.settings.tagGroups || []).find(g => g.id === tag.groupId)?.color || null;
  if (color) {
    chip.style.background = hexToRgba(color, 0.15);
    chip.style.color = color;
  }
}

function applyChipTooltip(chip, tagId) {
  const tag = resolveTag(tagId);
  const grp = (state.settings.tagGroups || []).find(g => g.id === tag.groupId);
  const ambiguous = grp && (state.tags || []).filter(t => t.name.toLowerCase() === tag.name.toLowerCase()).length > 1;
  chip.dataset.tooltip = ambiguous ? `${tag.name} · ${grp.name}` : tag.name;
  const color = tag.color || grp?.color || null;
  if (color) chip.dataset.tooltipColor = color;
  else delete chip.dataset.tooltipColor;
}

function makeTagChip(tagId) {
  const chip = document.createElement('span');
  chip.className = 'tag-chip';
  const tag = resolveTag(tagId);
  chip.textContent = tag.name;
  applyChipTooltip(chip, tagId);
  applyTagColor(chip, tagId);
  return chip;
}

function renderTagsInto(container, tagIds) {
  (tagIds || []).forEach(id => container.appendChild(makeTagChip(id)));
}

function appendTagRow(grid, labelText, tagIds) {
  const lbl = document.createElement('span');
  lbl.className = 'item-tag-label';
  lbl.textContent = labelText;
  const chips = document.createElement('div');
  chips.className = 'item-tag-chips';
  renderTagsInto(chips, tagIds);
  grid.appendChild(lbl);
  grid.appendChild(chips);
}

// --- Board item element ---

function createBoardItemElement(item, columnId, depth = 1, parentFolder = null, inheritedLock = false) {
  if (item.type === 'widget') return createWidgetElement(item, columnId) || document.createElement('div');

  const effectiveLocked = inheritedLock || !!item.locked;

  const itemEl = document.createElement('div');
  itemEl.className = 'board-column-item';
  itemEl.dataset.itemId = item.id;
  itemEl.dataset.columnId = columnId;
  itemEl.dataset.itemType = item.type;
  itemEl.draggable = !effectiveLocked;
  if (effectiveLocked) itemEl.classList.add('is-locked');

  if (item.type === 'folder' || item.type === 'bookmark') {
    if (item.type === 'folder') itemEl.classList.add('folder-card');
    else itemEl.classList.add('bookmark-item');
    if (selectedItemIds?.has(item.id)) itemEl.classList.add('selected');

    // --- Header row: checkbox + icon + name ---
    const header = document.createElement('div');
    header.className = 'item-header';

    const checkbox = document.createElement('div');
    checkbox.className = 'item-checkbox';
    if (!effectiveLocked) {
      checkbox.addEventListener('click', e => { e.stopPropagation(); e.preventDefault(); toggleItemSelection(item.id, itemEl, 'board'); });
    }
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
        const inInbox = isInboxColumnId(columnId);
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

    const lockBtn = document.createElement('button');
    lockBtn.type = 'button';
    lockBtn.className = 'item-lock-btn';
    if (effectiveLocked) lockBtn.classList.add('is-locked');
    if (inheritedLock) lockBtn.classList.add('is-inherited');
    lockBtn.title = item.locked ? 'Unlock item' : (inheritedLock ? 'Locked by parent' : 'Lock item');
    lockBtn.appendChild(icon(effectiveLocked ? 'icon-lock-closed' : 'icon-lock-open'));
    lockBtn.addEventListener('click', e => {
      e.stopPropagation();
      e.preventDefault();
      if (inheritedLock) return;
      item.locked = !item.locked;
      saveState();
      const inInbox = isInboxColumnId(columnId);
      if (inInbox) renderInboxPanel(); else renderBoard();
    });
    header.appendChild(lockBtn);

    itemEl.appendChild(header);

    // --- Tag grid ---
    const board = getActiveBoard();
    const inherited = computeInheritedTags(item, board);
    const ownTags = item.tags || [];
    const sharedTags = item.type === 'folder' ? (item.sharedTags || []) : [];
    const allTags = [...new Set([...ownTags, ...inherited, ...sharedTags])];

    if (allTags.length) {
      const tagsEl = document.createElement('div');
      tagsEl.className = 'item-tag-chips';
      renderTagsInto(tagsEl, allTags);
      itemEl.appendChild(tagsEl);
    }

    // --- Bookmark-specific ---
    if (item.type === 'bookmark') {
      itemEl.dataset.tooltip = buildTooltip(item, getActiveBoard());
      itemEl.addEventListener('click', () => window.open(item.url, '_blank'));
    }

    // --- Folder-specific: drag on header, tag grid, and children container ---
    if (item.type === 'folder') {
      // Both header and tag grid route through activateFolderDrop, keyed on the
      // folder card element, so micro-movements between them don't retrigger.
      const onFolderTopDragOver = event => handleBoardFolderHeaderDragOver(event, itemEl, item, columnId, depth);
      const onFolderTopDragleave = event => {
        if (itemEl.contains(event.relatedTarget)) return;
        const cc = itemEl.querySelector('.folder-children');
        if (cc) cc.classList.remove('drop-target');
      };
      const onFolderTopDrop = event => {
        event.preventDefault();
        event.stopPropagation();
        handleBoardFolderHeaderDrop(event, item, columnId, depth);
      };

      header.addEventListener('dragover', onFolderTopDragOver);
      header.addEventListener('dragleave', onFolderTopDragleave);
      header.addEventListener('drop', onFolderTopDrop);

      // Wire the tag grid (if present) so it doesn't bubble to handleBoardItemDragOver
      const tagGrid = itemEl.querySelector('.item-tag-grid');
      if (tagGrid) {
        tagGrid.addEventListener('dragover', onFolderTopDragOver);
        tagGrid.addEventListener('dragleave', onFolderTopDragleave);
        tagGrid.addEventListener('drop', onFolderTopDrop);
      }

      if (!item.collapsed) {
        const childrenContainer = document.createElement('div');
        childrenContainer.className = 'folder-children';
        childrenContainer.addEventListener('dragover', event => handleBoardFolderContainerDragOver(event, itemEl, item, columnId, depth));
        childrenContainer.addEventListener('dragleave', event => {
          // Only remove drop-target when leaving the whole folder card, not just the children area.
          // This prevents the highlight from flickering when moving between header and children.
          if (itemEl.contains(event.relatedTarget)) return;
          event.currentTarget.classList.remove('drop-target');
        });
        childrenContainer.addEventListener('drop', event => {
          event.preventDefault();
          event.stopPropagation();
          handleBoardFolderContainerDrop(event, item, columnId, depth);
        });
        itemEl.appendChild(childrenContainer);
        if (Array.isArray(item.children)) {
          item.children.forEach(child => childrenContainer.appendChild(createBoardItemElement(child, columnId, depth + 1, item, effectiveLocked)));
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
    handleBoardContextMenu(event, item, columnId, parentFolder, depth, effectiveLocked, inheritedLock);
  });

  itemEl.addEventListener('dragstart', event => {
    if (effectiveLocked) { event.preventDefault(); return; }
    event.stopPropagation();
    dragPayload = { area: 'board', itemId: item.id, itemType: item.type, sourceColumnId: columnId, sourceParentId: parentFolder ? parentFolder.id : null };
    event.dataTransfer.setData('text/plain', item.id);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.dropEffect = 'move';
    applyDragImage(event, itemEl);
  });

  itemEl.addEventListener('dragend', () => { itemEl.classList.remove('dragging'); dragPayload = null; removeDragPlaceholders(); });

  itemEl.addEventListener('dragover', event => handleBoardItemDragOver(event, item, columnId, parentFolder, depth));
  itemEl.addEventListener('dragleave', event => {
    if (itemEl.contains(event.relatedTarget)) return;
    itemEl.classList.remove('drop-target', 'drop-position-before', 'drop-position-after');
    itemEl.removeAttribute('data-drop-position');
    const cc = itemEl.querySelector('.folder-children');
    if (cc) cc.classList.remove('drop-target');
  });
  itemEl.addEventListener('drop', event => handleBoardItemDrop(event, item, columnId, parentFolder, depth));

  return itemEl;
}
