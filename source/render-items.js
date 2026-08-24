// --- Tag chip rendering ---

function resolveTag(tagId) {
  const found = (state.tags || []).find(t => t.id === tagId);
  return found || { id: tagId, name: tagId, groupId: null, color: null };
}

function applyTagColor(chip, tagId, boardContext = false) {
  const tag = resolveTag(tagId);
  const color = tag.color || (state.settings.tagGroups || []).find(g => g.id === tag.groupId)?.color || null;
  if (color) {
    chip.style.background = hexToRgba(color, boardContext || chip.closest('.board-column-item') ? 0.22 : 0.15);
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

function makeTagChip(tagId, boardContext = false) {
  const chip = document.createElement('span');
  chip.className = 'tag-chip';
  const tag = resolveTag(tagId);
  chip.textContent = tag.name;
  applyChipTooltip(chip, tagId);
  applyTagColor(chip, tagId, boardContext);
  return chip;
}

function renderTagsInto(container, tagIds, boardContext = false) {
  (tagIds || []).forEach(id => container.appendChild(makeTagChip(id, boardContext)));
}

// --- Board item element ---

function createBoardItemElement(item, columnId, depth = 1, parentFolder = null, inheritedLock = false) {
  if (item.type === 'widget') return createWidgetElement(item, columnId) || document.createElement('div');

  const inInbox = isInboxColumnId(columnId);
  const effectiveLocked = !inInbox && (inheritedLock || !!item.locked);
  const board = getActiveBoard();
  const dynamicFolder = isDynamicFolder(item);
  const insideDynamicFolderView = isDynamicFolder(parentFolder);

  const itemEl = document.createElement('div');
  itemEl.className = 'board-column-item';
  itemEl.dataset.itemId = item.id;
  itemEl.dataset.columnId = columnId;
  itemEl.dataset.itemType = item.type;
  itemEl.draggable = !effectiveLocked;
  if (effectiveLocked) itemEl.classList.add('is-locked');
  if (parentFolder) itemEl.classList.add('board-folder-child');

  if (item.type === 'folder' || item.type === 'bookmark' || item.type === 'application' || item.type === 'game') {
    if (item.type === 'folder') itemEl.classList.add('folder-card');
    else {
      itemEl.classList.add('bookmark-item');
      if (item.type === 'application') itemEl.classList.add('application-item');
      if (item.type === 'game') itemEl.classList.add('game-item');
    }
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
      const collapseIcon = dynamicFolder
        ? (item.collapsed ? 'icon-dynamic-folder-closed' : 'icon-dynamic-folder-open')
        : (item.collapsed ? 'icon-folder-closed' : 'icon-folder-open');
      collapseBtn.appendChild(icon(collapseIcon));
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
      if (item.type === 'application') {
        if (item.iconCache) {
          const applicationImg = document.createElement('img');
          applicationImg.src = item.iconCache;
          applicationImg.alt = '';
          applicationImg.draggable = false;
          favicon.appendChild(applicationImg);
        } else {
          favicon.appendChild(icon('icon-application'));
        }
      } else if (item.type === 'game') {
        renderGameSystemIcon(favicon, item);
      } else if (item.url) {
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
    name.textContent = item.type === 'folder'
      ? item.title
      : item.type === 'application'
        ? (item.title || 'Application')
        : item.type === 'game'
          ? (item.title || 'Game')
        : (item.title || item.url || 'Untitled Bookmark');
    header.appendChild(name);

    if (item.type === 'application') {
      const status = getApplicationStatus(item);
      if (status.state !== 'ready') {
        const badge = document.createElement('span');
        badge.className = `application-status application-status--${status.state}`;
        badge.textContent = status.state === 'checking' ? 'Checking'
          : status.state === 'missing' ? 'Missing'
            : status.state === 'changed' ? 'Changed'
              : status.state === 'unbound' ? 'Set up'
                : 'Unavailable';
        badge.title = status.state === 'unbound'
          ? 'Set up this application on this device'
          : `Application status: ${status.state}`;
        header.appendChild(badge);
      }
      if (!applicationStatusCache.has(item.appKey) && !applicationStatusRequests.has(item.appKey)) {
        void refreshApplicationStatus(item);
      }
    }

    if (item.type === 'game') {
      const status = getGameStatus(item);
      if (status.state !== 'ready') {
        const presentation = getGameStatusPresentation(status);
        const badge = document.createElement('span');
        badge.className = `application-status application-status--${status.state}`;
        badge.textContent = presentation.label;
        badge.title = presentation.title;
        header.appendChild(badge);
      }
      if (!gameStatusCache.has(item.gameKey) && !gameStatusRequests.has(item.gameKey)) void refreshGameStatus(item);
    }

    if (item.type === 'folder' && dynamicFolder) {
      const sortBtn = document.createElement('button');
      sortBtn.type = 'button';
      sortBtn.className = 'item-sort-btn';
      sortBtn.title = _dynamicSortButtonTitle(item.sortMode);
      sortBtn.setAttribute('aria-label', _dynamicSortButtonTitle(item.sortMode));
      sortBtn.appendChild(icon('icon-sort'));
      sortBtn.addEventListener('click', event => {
        event.stopPropagation();
        event.preventDefault();
        if (getActiveBoard()?.locked || effectiveLocked) return;
        showDynamicSortMenu(event.currentTarget, {
          targetType: 'folder',
          contextTarget: {
            area: 'board-item',
            itemId: item.id,
            columnId,
            parentId: parentFolder ? parentFolder.id : null,
            item,
            depth
          }
        });
      });
      header.appendChild(sortBtn);

      const rulesBtn = document.createElement('button');
      rulesBtn.type = 'button';
      rulesBtn.className = 'item-rule-btn';
      rulesBtn.title = 'Edit dynamic rules';
      rulesBtn.setAttribute('aria-label', 'Edit dynamic rules');
      rulesBtn.appendChild(icon('icon-filter'));
      rulesBtn.addEventListener('click', event => {
        event.stopPropagation();
        event.preventDefault();
        if (getActiveBoard()?.locked || effectiveLocked) return;
        showDynamicRuleEditor({
          targetType: 'folder',
          contextTarget: {
            area: 'board-item',
            itemId: item.id,
            columnId,
            parentId: parentFolder ? parentFolder.id : null,
            item,
            depth
          }
        });
      });
      header.appendChild(rulesBtn);
    }

    if (!inInbox) {
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
        renderBoard();
      });
      header.appendChild(lockBtn);
    }

    itemEl.appendChild(header);

    // --- Tag grid ---
    const inherited = computeInheritedTags(item, board);
    const ownTags = item.tags || [];
    const sharedTags = item.type === 'folder' ? (item.sharedTags || []) : [];
    const allTags = [...new Set([...ownTags, ...inherited, ...sharedTags])];

    const showTagChips = item.type === 'folder'
      ? state.settings.showFolderTags !== false
      : state.settings.showBookmarkTags !== false;

    if (allTags.length && showTagChips) {
      const tagsEl = document.createElement('div');
      tagsEl.className = 'item-tag-chips';
      renderTagsInto(tagsEl, allTags, true);
      itemEl.appendChild(tagsEl);
    }

    // --- Bookmark-specific ---
    if (item.type === 'bookmark') {
      itemEl.dataset.bookmarkId = item.id || '';
      itemEl.dataset.tooltip = buildTooltip(item, getActiveBoard());
      itemEl.dataset.tooltipKind = 'bookmark';
      itemEl.addEventListener('click', () => openHubBookmark(item));
    }

    if (item.type === 'application') {
      itemEl.dataset.tooltip = `${item.title || 'Application'}\nApplication shortcut`;
      itemEl.dataset.tooltipKind = 'application';
      itemEl.addEventListener('click', () => void launchApplicationShortcut(item));
    }

    if (item.type === 'game') {
      registerGameTooltipTarget(itemEl, item);
      itemEl.addEventListener('click', () => void launchGameShortcut(item));
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
        if (!dynamicFolder) {
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
        }
        itemEl.appendChild(childrenContainer);
        const children = resolveFolderChildren(item, board);
        children.forEach(child => childrenContainer.appendChild(createBoardItemElement(child, columnId, depth + 1, item, effectiveLocked)));
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
    const fromDynamicFolderView = item.type === 'bookmark' && isDynamicFolder(parentFolder);
    const inboxItems = inInbox ? (getBoardInbox(getActiveBoard(), getActiveTab())?.items || []) : [];
    const selectedDragItems = inInbox && item.type === 'bookmark' && selectedItemIds?.has(item.id) && selectionContext === 'board'
      ? collectSelectedBookmarksInTree(selectedItemIds, inboxItems)
      : [];
    dragPayload = {
      area: 'board',
      itemId: item.id,
      itemIds: selectedDragItems.length > 1 ? selectedDragItems.map(selected => selected.id) : undefined,
      itemType: item.type,
      sourceColumnId: columnId,
      sourceParentId: parentFolder ? parentFolder.id : null,
      fromDynamicFolderView
    };
    event.dataTransfer.setData('text/plain', item.id);
    event.dataTransfer.effectAllowed = fromDynamicFolderView ? 'copy' : 'move';
    event.dataTransfer.dropEffect = fromDynamicFolderView ? 'copy' : 'move';
    applyDragImage(event, itemEl);
  });

  itemEl.addEventListener('dragend', () => {
    itemEl.classList.remove('dragging');
    clearMultiDragSourceElements();
    dragPayload = null;
    removeDragPlaceholders();
  });

  if (!insideDynamicFolderView) {
    itemEl.addEventListener('dragover', event => handleBoardItemDragOver(event, item, columnId, parentFolder, depth));
    itemEl.addEventListener('dragleave', event => {
      if (itemEl.contains(event.relatedTarget)) return;
      itemEl.classList.remove('drop-target', 'drop-position-before', 'drop-position-after');
      itemEl.removeAttribute('data-drop-position');
      const cc = itemEl.querySelector('.folder-children');
      if (cc) cc.classList.remove('drop-target');
    });
    itemEl.addEventListener('drop', event => handleBoardItemDrop(event, item, columnId, parentFolder, depth));
  }

  return itemEl;
}
