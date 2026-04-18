# Changelog

All notable changes to Morpheus WebHub are documented here.
Format: `[version] — date` followed by Added / Changed / Fixed sections.

---

## [0.7.0] — 2026-04-18

### Added

- **Tag inheritance system**: folders and boards now carry `sharedTags[]` that propagate to all descendants; computed on-the-fly at render time — never stored in state
- **Two tag types on folders/boards**: `sharedTags[]` (inherited by children) and `labels[]` (folder/board-only, not inherited)
- **`inheritTags` flag** on folders and boards (default `true`): controls whether this node passes its `sharedTags` down to children
- **`autoRemoveTags` flag** on folders (default `false`): when `true`, strips parent's `sharedTags` from an item's `tags[]` when moved out
- **Three-section tag display**: inherited (grey italic, read-only) | shared tags (blue) | labels (amber) — shown on folder headers and bookmark cards
- **Folder context menu**: "Edit tags", "✓/○ Pass tags to children" toggle, "✓/○ Strip tags on move out" toggle
- **Board settings panel**: Shared Tags, Labels, and Inherit Tags inputs wired up with live updates
- **Extended search**: folders, boards, and inherited tags are now searchable; clicking a folder result navigates into it; clicking a board result switches to that board
- **`computeInheritedTags(item, board)`** helper in state.js: walks parent chain recursively without a separate buildParentMap step
- **`editFolderTags(itemId, sharedTags, labels)`** state function
- **`tagGroups: []`** scaffolded in defaultSettings (design TBD)

### Changed

- Modal second tags row (Labels) shown only for folders/boards; hidden for bookmarks
- `getKnownTags()` now collects sharedTags and labels from folders and boards for autocomplete
- DnD drop handlers apply `autoRemoveTags` logic on item move-out across all three drop targets
- Grid column overflow fixed: `.folder-children` uses `grid-template-columns: minmax(0, 1fr)`

---

## [0.6.1] — 2026-04-18

### Fixed

- Empty column drag indicator now appears at the top of the column, not the bottom
- Nested folder items no longer overflow column boundaries at narrow widths (`.folder-children` grid constrained to `minmax(0, 1fr)`; `min-width: 0` on column items)
- "Add Tags", "Move to Board" (bulk and context menu) modals no longer show the redundant Name field; focus lands directly on the relevant input
- Bulk delete confirmation button now shows the correct item count instead of always "1 Item"

### Changed

- Tag autocomplete replaced with inline address-bar-style completion: the best match is shown as selected text in the input field; Tab or ArrowRight accepts it
- Tag autocomplete now also active in the bulk "Add Tags" modal

---

## [0.6.0] — 2026-04-18

### Added

- Bulk select: item checkboxes appear on hover; floating bulk toolbar with Delete, Add Tags, Move to Board, and Deselect actions; Escape clears selection
- "Move to board" in bookmark context menu (visible when more than one board exists)
- Browser bookmark HTML import (Netscape format) — imports into the active board's first column, preserving folder structure
- Duplicate URL detection — inline amber warning in the add-bookmark modal when the URL already exists anywhere in the hub
- Smart tag autocomplete — dropdown of known tags while typing in the tags field; Tab accepts the top suggestion

---

## [0.5.0] — 2026-04-18

### Added

- Undo / redo: Ctrl+Z / Ctrl+Y (or Ctrl+Shift+Z); 50-step in-memory snapshot stack; undo and redo buttons in the board header (disabled when stack is empty)
- Recently Deleted buffer: persistent trash (max 20 items, separate localStorage key); draggable trash panel with per-item restore and permanent delete; trash button with item-count badge in the sidebar footer; Clear All action
- Essentials: configurable display count (1–24) via stepper in Behavior settings; warning shown when stored essentials exceed the current display count; bookmarks assigned to the dropped slot rather than the first free slot

---

## [0.4.0] — 2026-04-18

### Added

- Bookmark management: create, edit, delete bookmarks with favicons, tags, and drag-and-drop
- Board system: multiple boards with configurable column counts (3–5)
- Speed Dial bar per board; show/hide toggle per board in board settings
- Essentials strip in sidebar for quick-access bookmarks; global show/hide toggle
- Navigation panel: boards, folders, titles, dividers — all draggable and nestable
- Search/filter across all boards, speed dial, and essentials (live, grouped by source)
- Board settings: background image (URL or drag-drop), container opacity
- Global Settings — Style tab: typography (font, size, weight, style, alignment, color) for all text elements; tag colors; title/divider line color, style, and thickness
- Global Settings — Behavior tab: icon size (S/M/L) for speed dial and essentials; show/hide essentials; warn-on-close; per-type delete confirmations; JSON export/import
- Settings panel split into Style and Behavior tabs
- Sidebar collapse toggle (chevron button); smooth transition
- Smooth fade-in animation when switching between boards
- Keyboard shortcuts: `/` or `Ctrl+F` to focus search; `N` to add bookmark to last-used column
- Context menu: Open all bookmarks in folder; Duplicate bookmark; Refresh favicon
- Tooltip system (JS-positioned, viewport-aware, shows title + URL + tags)
- About dialog with version number
- Empty column placeholder text ("Right-click to add")
- Version constant (`APP_VERSION = '0.4.0'`) and version badge in sidebar footer
