# Changelog

All notable changes to Morpheus WebHub are documented here.
Format: `[version] — date` followed by Added / Changed / Fixed sections.

---

## [0.9.0] — 2026-04-19

### Added

- **Firefox extension** (`extension/`) — MV2, persistent background, content script on `file://*/*`
  - **Popup**: shows current tab title/URL, "Send to inbox" button, live status indicator
  - **Background script**: tracks the registered Morpheus tab; routes send-tab messages from popup to content script
  - **Content script**: detects Morpheus pages via `<meta name="morpheus-webhub">`; registers with background; bridges `postMessage` ↔ `browser.storage.local` and `browser.runtime`
  - **SVG icons** (48 × 48 and 96 × 96) with the Morpheus "M" mark
- **`source/bridge.js`** — page-side bridge module (IIFE, no dependencies)
  - Pings extension on load; exposes `bridge.isAvailable()`, `bridge.whenReady`, `bridge.saveState()`, `bridge.loadState()`
  - Listens for `MW_RECEIVE_TAB` push and fires `morpheus:receive-tab` CustomEvent
  - All methods no-op gracefully when extension is absent
- **`<meta name="morpheus-webhub" content="1.0">`** in `index.html` — lets the content script identify the page without URL matching
- **Receive-tab handler** in `app.js` — listens for `morpheus:receive-tab`, pushes bookmark into active board's inbox, updates badge and panel
- **Bridge storage backup**: `saveState()` fire-and-forgets to `browser.storage.local` when bridge is available; on startup, restores from bridge storage if `localStorage` is empty

### Changed

- `saveState()` in `state.js` writes to bridge storage in addition to `localStorage` when extension is present

---

## [0.8.1] — 2026-04-19

### Changed

- **Refactored source files**: split large `app.js` and `render.js` into five focused modules:
  - `source/render-items.js` — tag chip helpers (`applyTagColor`, `makeTagChip`, `renderTagsInto`, `createTagSection`) and `createBoardItemElement`
  - `source/modal.js` — tag autocomplete, generic modal, folder modal, `openExternalBookmarkModal`
  - `source/context.js` — context menu rendering and all `handle*ContextMenu` handlers
  - `source/settings.js` — board settings panel, global settings panel, font/color helpers, `attachSettingsListeners`
  - `source/import.js` — inbox panel, browser bookmark HTML parser, `attachBookmarkImportListener`
- Removed duplicate `item.tags` check in `renderSearchResults.matchesQuery`
- Removed dead `countBookmarks` function (superseded by `countItemsRecursive` in state.js)

---

## [0.8.0] — 2026-04-19

### Added

- **Per-board inbox**: each board has a hidden `{ isInbox: true }` column in `board.columns`; rendered as a floating draggable panel with position saved to `localStorage`
- **Inbox toggle button** in board header with badge showing total item count; panel header shows two badges (bookmarks / folders) using recursive counts
- **Nav inbox badges**: board nav items show two right-aligned badges (accent for bookmarks, muted for folders) when inbox is non-empty
- **Import Manager**: special persistent board pinned to the top of the nav when non-empty, hidden when empty; accepts HTML bookmark imports instead of the active board
- **Import Manager nav item**: two count badges (bookmarks / folders); accent-coloured border distinguishes it from regular boards
- **Robust bookmark HTML parser**: handles both nested and sibling `<DL>` layouts including Firefox's `<DL><p>` pattern; skips intermediate `<P>` elements when looking for a folder's child `<DL>`
- **Import alert** reports "X bookmarks in Y folders" using recursive counts
- **"Move to board"** added to folder context menu (was bookmark-only); correctly shows when on the Import Manager with at least one regular board
- `getBoardInbox()`, `getBoardInboxCount()`, `getBoardInboxCounts()` helpers in state.js
- `countItemsRecursive(items, type)` helper; `getImportManagerCounts()`, `getImportManagerItemCount()` in state.js
- `getImportManagerBoard()`, `getOrCreateImportManagerBoard()`, `importManagerHasItems()` in state.js
- `createImportManagerNavItem()` in render.js

### Changed

- `updateBoardSettings` and board settings column-count radio listener preserve the inbox column when resizing
- `loadState()` and `deleteBoardAndNavItem()` exempt the Import Manager board from the nav-reference sweep so it is never silently deleted
- HTML bookmark import routes to Import Manager (creates it if absent) and switches the active board to it; all imported folders start collapsed
- "Move to board" and "Bulk Move to Board" target lists exclude the Import Manager
- Inbox panel width matches a 3-column board column (`calc((100vw - 320px - 72px) / 3)`)
- Context menu `z-index` raised from 30 to 300 so it renders above the inbox panel (200)

### Fixed

- Folder expand/collapse inside the inbox panel called `renderBoard()` instead of `renderInboxPanel()`; now detects inbox column by `isInbox` flag and calls the correct renderer
- Import Manager board silently deleted when any regular board was deleted (`deleteBoardAndNavItem` sweep)
- "Move to board" option not appearing on Import Manager when only one regular board existed — context menu now uses `isImportManager`-aware logic for both single-item and bulk moves
- Context menu rendered behind the inbox panel due to lower z-index

---

## [0.7.1] — 2026-04-19

### Added

- **Folder modal**: unified create/edit panel with editable name in header (same pattern as board settings), Tags, Shared Tags, and two toggle rows with clear "shared tags" wording; replaces the four separate context menu entries
- **`attachTagAutocomplete(input)`** helper — wires inline tag prediction (Tab/ArrowRight to accept) to any input; used by bookmark modal, folder modal, and board settings tag fields
- **Tag autocomplete on board settings**: `bstgSharedTags` and `bstgTags` now have inline prediction

### Changed

- `labels` renamed to `tags` on folder and board objects; backward-compat migration preserves existing data
- Folder context menu simplified to a single "Edit folder" entry
- All tag chips rendered through `makeTagChip` / `renderTagsInto` — identical appearance everywhere (no amber/grey variants)
- `createTagSection` no longer accepts a chipClass argument; all chips use the same style
- `getTagSuggestions` / `renderTagSuggestions` now take the input element as a parameter instead of hardcoding `modalInput3`
- Inherited tag chips no longer styled differently from user-defined tag chips

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
