// --- Inbox panel ---

const INBOX_POS_KEY = 'morpheus-inbox-pos';
let inboxPanelOpen = false;

function saveInboxPos() {
  const panel = document.getElementById('inboxPanel');
  if (!panel) return;
  const rect = panel.getBoundingClientRect();
  localStorage.setItem(INBOX_POS_KEY, JSON.stringify({ x: rect.left, y: rect.top }));
}

function showInboxPanel() {
  inboxPanelOpen = true;
  const panel = document.getElementById('inboxPanel');
  panel.classList.remove('hidden');
  panel.classList.add('draggable');
  try {
    const pos = JSON.parse(localStorage.getItem(INBOX_POS_KEY));
    if (pos) { panel.style.left = pos.x + 'px'; panel.style.top = pos.y + 'px'; }
    else centerPanel(panel);
  } catch { centerPanel(panel); }
  makeDraggable(panel, document.getElementById('inboxPanelHeader'), saveInboxPos);
  renderInboxPanel();
}

function hideInboxPanel() {
  inboxPanelOpen = false;
  document.getElementById('inboxPanel').classList.add('hidden');
}

function attachInboxListeners() {
  document.getElementById('inboxBtn').addEventListener('click', () => {
    if (inboxPanelOpen) hideInboxPanel(); else showInboxPanel();
  });
  document.getElementById('inboxPanelClose').addEventListener('click', hideInboxPanel);

  const body = document.getElementById('inboxPanelBody');
  body.addEventListener('dragover', e => {
    if (!dragPayload || dragPayload.area !== 'board') return;
    if (getActiveBoard()?.locked) return;
    e.preventDefault();
    body.classList.add('drag-over');
  });
  body.addEventListener('dragleave', e => {
    if (!body.contains(e.relatedTarget)) body.classList.remove('drag-over');
  });
  body.addEventListener('drop', e => {
    e.preventDefault();
    body.classList.remove('drag-over');
    if (!dragPayload || dragPayload.area !== 'board') return;
    if (getActiveBoard()?.locked) { dragPayload = null; return; }
    pushUndoSnapshot();
    const inbox = getBoardInbox(getActiveBoard());
    if (!inbox) return;
    const dragged = removeBoardItemById(dragPayload.itemId);
    if (dragged) inbox.items.push(dragged);
    dragPayload = null;
    renderInboxPanel();
    renderBoard();
    renderNav();
    saveState();
  });
}

// --- Browser bookmark import ---

function parseBookmarkHtml(htmlText) {
  const doc = new DOMParser().parseFromString(htmlText, 'text/html');
  function parseDL(dl) {
    const items = [];
    if (!dl) return items;
    const children = Array.from(dl.children);
    for (let i = 0; i < children.length; i++) {
      const el = children[i];
      if (el.tagName !== 'DT') continue;
      const a = el.querySelector(':scope > A');
      const h3 = el.querySelector(':scope > H3');
      if (a) {
        items.push({
          id: `bm-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          type: 'bookmark',
          title: a.textContent.trim() || a.href,
          url: a.href,
          tags: [],
          faviconCache: ''
        });
      } else if (h3) {
        // DL may be a direct child of DT or a sibling (possibly after a <P> from "<DL><p>")
        let subDL = el.querySelector(':scope > DL');
        if (!subDL) {
          let j = i + 1;
          while (j < children.length && children[j].tagName !== 'DT' && children[j].tagName !== 'DL') j++;
          if (j < children.length && children[j].tagName === 'DL') { subDL = children[j]; i = j; }
        }
        items.push({
          id: `bm-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          type: 'folder',
          title: h3.textContent.trim(),
          collapsed: true,
          tags: [],
          sharedTags: [],
          inheritTags: true,
          autoRemoveTags: false,
          children: parseDL(subDL)
        });
      }
    }
    return items;
  }
  return parseDL(doc.querySelector('DL'));
}

function attachBookmarkImportListener() {
  const bmImportFile = document.getElementById('importBookmarksFile');
  if (!bmImportFile) return;
  bmImportFile.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const items = parseBookmarkHtml(ev.target.result);
      if (!items.length) { alert('No bookmarks found in file.'); return; }
      pushUndoSnapshot();
      const importBoard = getOrCreateImportManagerBoard();
      const targetCol = importBoard.columns.find(c => !c.isInbox);
      targetCol.items.push(...items);
      state.activeBoardId = importBoard.id;
      renderAll();
      saveState();
      hideSettingsPanel();
      const { bookmarks, folders } = getImportManagerCounts();
      alert(`Imported ${bookmarks} bookmarks in ${folders} folders into Import Manager.`);
    };
    reader.readAsText(file);
    bmImportFile.value = '';
  });
}
