// Persisted-state versioning and non-destructive structural repair.

const CURRENT_STATE_SCHEMA_VERSION = 1;

function collectReferencedBoardIds(items) {
  const ids = new Set();
  for (const item of (items || [])) {
    if (item.type === 'board' && item.boardId) ids.add(item.boardId);
    if (item.children) for (const id of collectReferencedBoardIds(item.children)) ids.add(id);
  }
  return ids;
}

function repairOrphanedBoardNavItems(parsed) {
  if (!Array.isArray(parsed.navItems)) parsed.navItems = [];
  const referencedIds = collectReferencedBoardIds(parsed.navItems);
  const usedNavIds = new Set();
  const collectNavIds = items => (items || []).forEach(item => {
    if (item?.id) usedNavIds.add(item.id);
    if (item?.children) collectNavIds(item.children);
  });
  collectNavIds(parsed.navItems);
  for (const board of (parsed.boards || [])) {
    if (!board?.id || referencedIds.has(board.id)) continue;
    let navId = `nav-${board.id}`;
    let suffix = 2;
    while (usedNavIds.has(navId)) navId = `nav-${board.id}-${suffix++}`;
    parsed.navItems.push({
      id: navId,
      type: 'board',
      title: board.title || 'Recovered Board',
      boardId: board.id
    });
    usedNavIds.add(navId);
    referencedIds.add(board.id);
  }
}

function migrateStateSchema(parsed) {
  const sourceVersion = Number.isInteger(parsed.schemaVersion) ? parsed.schemaVersion : 0;
  // Version 1 formalizes the normalized tab-based board schema. The legacy
  // normalizers in state.js remain the migration body for unversioned data.
  parsed.schemaVersion = Math.max(sourceVersion, CURRENT_STATE_SCHEMA_VERSION);
  return parsed;
}
