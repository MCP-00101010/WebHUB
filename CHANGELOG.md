# Changelog

All notable changes to Morpheus WebHub are documented here.
Format: `[version] — date` followed by Added / Changed / Fixed sections.

---

## [0.11.36] — 2026-04-25

### Fixed

- **Bookmark modal URL section** — URL row is now a `settings-section` with a "URL" label and input styling matching other modal sections; duplicate-URL warning moved inside the section.
- **Folder modal size** — folder modal now uses `height: auto` so it only occupies what it needs instead of stretching to full panel height.
- **Widget modal tweaks** — widget title placeholder no longer shows "(optional)"; widget settings panel also uses `height: auto`.
- **Context menu always closes** — context menu button handlers now use `try/catch/finally` so the menu is dismissed even when an action throws, and errors are surfaced as a notice dialog instead of being silently swallowed.
- **Nav board deletion error reporting** — `renderAll()` inside the delete-nav-item callback is now wrapped in a try/catch; if rendering fails after a successful deletion, the nav is refreshed via `renderNav()` and an error notice is shown rather than leaving the UI in a stale state.

---

## [0.11.35] — 2026-04-25

### Fixed

- **Collection create/cancel** — creating a collection no longer writes to state or renders in the nav until the modal is confirmed. Cancelling the New Collection modal now discards with no side-effects.
- **Strip on leave default** — the "Strip on leave" / auto-remove-tags toggle now defaults to enabled when creating a new collection, board, or folder that exposes shared tags.
- **Collection settings icon** — the settings button in the board name pane now opens the Edit Collection modal when a collection is active, instead of the board settings panel.

---

## [0.11.34] — 2026-04-25

### Added

- **Collection speed dial section in Edit Collection modal** — speed dial settings (Show toggle and Slots input) are now in a dedicated "Speed Dial" section below Tags, instead of being appended inside the Tags section.
- **Show toggle for collection speed dial** — collections now have a `showSpeedDial` flag; the "Show" toggle in the new Speed Dial section controls whether the speed dial bar is visible when that collection is active. Changes apply live.

---

## [0.11.33] — 2026-04-25

### Added

- **Speed dial slot grid** — speed dial is now a fixed-slot grid (default 8, configurable 1–48) instead of a free list; empty slots show as dashed cells and accept drops. Board settings and collection edit modal both expose a Slots input.
- **Board icon in nav** — board items in the sidebar now show a small grid icon (tinted accent when active), matching the collection icon treatment.
- **Inbox dot indicators** — collection tabs, folder headers, and nav board items now display a small accent dot when any contained board has inbox items, replacing the previous count chips.
- **`findCollectionById` helper** — centralized lookup via `findNavItemPath` so nested collections are found correctly everywhere.
- **Slot-based speed dial helpers** — `normalizeSpeedDialSlots`, `getSpeedDialSlotCount`, `firstEmptySpeedDialSlot`, `findSpeedDialSlot`, `setSpeedDialSlot`, `removeSpeedDialItemById` added to state.js.

### Changed

- **Board title display** — when a collection is active the main title bar now shows only the collection title; folder context shows only the board title.
- **Delete collection** — now deletes contained boards outright (with trash restore support) instead of scattering them back to the nav.
- **Speed dial drag image** — `applyDragImage` now preserves the source element's exact pixel dimensions and fixes img sizing inside the clone.
- **Essentials slot drop** — filled essential slots no longer accept drops.
- **Import manager board** — inbox button is hidden (not just disabled) when the import manager board is active; clicking the inbox button while on the import manager is a no-op.

### Fixed

- **Delete board from collection/folder** — now pushes the board to trash with restore support (`collection-board` / `folder-board` areas).
- **Restore collection from trash** — now re-adds all contained boards to state, not just the nav item.
- **Null slot guards** — null entries in `speedDial` arrays no longer crash search, tag merge, `findDuplicateUrl`, or migration loops.
- **`addSpeedDialBookmark`** — uses `contextTarget.collectionId` when set, and places the new item in the correct slot.
- **Duplicate speed dial item** — uses `firstEmptySpeedDialSlot` instead of `splice`, so it respects the slot grid.
- **Collection speed dial edit** — editing a bookmark in a collection speed dial now correctly looks up the item from the collection, not the active board.
- **Edit essential bookmark** — `setEssential` now accepts a `replace` flag so editing an existing slot works correctly.

---

## [0.11.32] — 2026-04-25

### Fixed

- **Tag Manager drag and drop regression** — restored tag chip drag/drop between Unsorted and existing or newly-created groups. Tag drags now keep the active tag ID in memory during `dragover`, and entire group blocks accept drops instead of relying only on the chip input row.
- **Legacy tag group records** — old tag groups now normalize missing/default fields and string boolean values so groups are not accidentally treated as locked.
- **Tag deletion from Tag Manager** — clicking a chip's × button now reliably routes through a delegated Tag Manager handler before chip drag/edit behavior can intercept it.
- **Tag delete confirmation crash** — tag usage counting now skips null item slots, so delete confirmation modals open correctly when enabled.

---

## [0.11.31] — 2026-04-23

### Fixed

- **Tag Manager chip × button** — clicking × on tag chips now correctly deletes the tag; draggable parent chip no longer intercepts the mousedown via Firefox's drag machinery (capture-phase guard disables `draggable` for the duration of the click).
- **Tag Manager chip label click** — clicking a chip's label in the Tag Manager no longer triggers deletion; `beforeRemove` now only acts on `editMode = false` (the × button path).

---

## [0.11.30] — 2026-04-23

### Added

- **Tag Manager group creation from tags** — tag chip context menus can now create an inline unnamed group, move the selected tag into it, and focus the new group name field.
- **Tag Manager drag and drop** — tags can now be dragged between groups and Unsorted, inserted at the cursor position, and reordered within a group using an in-row chip preview clone.
- **Collapsible tag groups** — tag groups can now be collapsed and expanded to save space while keeping drop support on group headers.

### Fixed

- **Tag Manager delete confirmations** — deleting tag groups and deleting tags from any Tag Manager group now respect the tag-delete confirmation setting; deleting a group deletes its tags instead of moving them to Unsorted.

---

## [0.11.28] — 2026-04-23

### Added

- **Base tag suggestions** — tag autocomplete now includes a configurable default suggestion set without creating saved tags until a suggestion is committed.
- **Extension status in About** — the About tab now shows extension/native-host connection state and lists available extension-backed features.

### Changed

- **Code quality cleanup** — centralised board creation, drag/drop area checks, drag decoration cleanup, and deep-clone handling; removed unused widget-picker UI/code and dead helper functions.
- **Favicon cache trimming** — save operations now run the existing favicon cache trimmer before persistence.

### Fixed

- **Unsorted tag management** — Unsorted now uses the shared chip-input behavior, supports manual additions, deletes tags correctly, and refreshes the orphan counter after deletion.
- **Create widget cancel** — cancelling the new-widget settings dialog no longer creates a widget.
- **Folder internal reordering** — moving items within a folder no longer trips the self-subfolder safety check.
- **Navpane bottom drops** — dragging below the final nav item now shows the preview at the bottom and inserts there reliably.

---

## [0.11.27] — 2026-04-23

### Fixed

- **Source element unhiding on cursor move (all DnD areas)** — `removeDragPlaceholders()` was called on every `dragover` event to swap in the new placeholder, and it contained `querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'))`. This removed the hide-class from the source element on the very first cursor movement, making it reappear. Removed the blanket `.dragging` cleanup from `removeDragPlaceholders()` and instead each `dragend` handler now explicitly removes `.dragging` from the specific element it dragged (nav items, speed dial links, essentials, board items, widgets, tabs). The effect is now consistent across all DnD areas.

---

## [0.11.26] — 2026-04-23

### Fixed

- **Gap where dragged item was** — `.dragging` used `opacity: 0` which hid the element visually but kept it in the layout flow, leaving a blank space. Changed to `display: none !important` so the element is fully removed from the layout.
- **Column preview clone invisible** — `createDragPlaceholder` clones the source element after `.dragging` is applied, so the clone inherited the class. With `display: none !important` on `.dragging`, the clone was invisible even after `drag-preview` was added. Added `'dragging'` to the `classList.remove` call so clones always start visible.

---

## [0.11.25] — 2026-04-23

### Fixed

- **Nav pane preview wrong font/color** — the synthetic nav item created for collection-tab → nav drags was missing `data-type="board"`, so the `[data-type="board"]` CSS rules (`font-size`, `font-family`, `font-weight`, `font-style`, `color`, `text-align`, `display: flex`, `align-items: center`) did not apply. Added `el.dataset.type = 'board'` to make the preview render identically to the dropped item.

---

## [0.11.24] — 2026-04-23

### Fixed

- **Collection tab bar drag flicker** — the per-tab `dragleave` handler was removing the indicator whenever the cursor entered the ghost element (which has `pointer-events:none`, causing events to pass through to `tabBar`); this created a remove/re-add loop that flickered. Removed the per-tab `dragleave` handler entirely — the indicator is now only cleared when the cursor leaves the entire `tabBar`. Added position-change tracking (`_tabIndicatorKey`) so the DOM is only modified when the logical drop position changes. The `tabBar.dragover` handler now silently accepts the drop without repositioning when an indicator is already placed.
- **Ghost tab clone fidelity** — the cloned tab now strips `.dragging` and `.active` before insertion so it appears in its resting (non-active) style. The nav pane preview for collection-tab drags now includes board tags (matching the exact appearance the item would have after being dropped).

---

## [0.11.23] — 2026-04-23

### Fixed

- **Collection tab bar drag indicator** — `_tabDragOver` was inserting a 3px vertical bar (`div.tab-drop-indicator`) as the drop indicator. It now inserts a ghost tab clone (for reorders, a clone of the dragged tab; for nav board drops, a new tab div with the board title). CSS updated to override the thin-bar styles on `.collection-tab.tab-drop-indicator`.
- **Nav preview clone for collection-tab drags** — `createDragPlaceholder('nav')` only checked `dragPayload.itemId` and fell back to a dashed placeholder when dragging a collection tab (which sets `boardId`, not `itemId`). A new branch synthesises a nav board preview element from the board title before reaching the fallback.
- **Drop from collection tab bar to empty nav space** — `handleNavListDragOver` blocked `collection-tab` drags (preventing `preventDefault` from being called on empty nav space, so the drop event never fired). Added `collection-tab` to the allowed areas. `handleNavListDrop` now has a `collection-tab` branch that removes the board from the collection and inserts a new nav item at the drop position, matching the logic already present in `handleNavDrop`.

---

## [0.11.22] — 2026-04-23

### Fixed

- **Collection speed dial reordering** — `handleSpeedDialItemDragOver/Drop` and `handleSpeedDialContainerDragOver` were missing `collection-speed-dial` in their area guards, so dragging to reorder items in the collection speed bar had no effect. All three guards and the item-drop handler now handle `collection-speed-dial`.
- **Dragged element visible alongside preview clone** — elements that initiate a drag (board items, speed dial links, nav items, collection/folder tabs) now receive a `.dragging` class one animation frame after dragstart (after the drag image snapshot is captured), hiding the original. The class is removed when `removeDragPlaceholders` is called on dragend.

### Added

- **Collection tab bar DnD** — tabs in the collection tab bar can now be reordered by dragging. Nav board items can be dragged directly onto the collection tab bar to add them to the collection (with a vertical bar indicator showing the insertion point). The existing support for dragging a collection tab back onto a nav item to remove it from the collection now also shows a position preview and inserts at the correct position.

---

## [0.11.21] — 2026-04-23

### Fixed

- **Undo/redo/inbox/settings icon color** — `.icon-btn` was inheriting `var(--text)` from the shared button rule, making those icons brighter than sidebar icons (trash, search filter, etc.) which explicitly use `var(--text-muted)`. Added `color: var(--text-muted)` to `.icon-btn` with `color: var(--text)` on hover, matching the sidebar button pattern.

---

## [0.11.20] — 2026-04-23

### Fixed

- **Speed dial favicons drawn on white square** — the service request size was being passed as 256 for speed dial items. `faviconV2` doesn't support that size and errors, falling back to DuckDuckGo's `.ico` which has a white background baked in. All service requests are now capped at 64px; CSS controls the actual display size.

---

## [0.11.19] — 2026-04-23

### Fixed

- **Favicon for browser-dragged bookmarks** — Firefox includes `application/x-moz-place` in bookmark drags which contains `iconuri` (the favicon data URL the browser has cached). The hub now reads this on drop and uses it as `faviconCache` when creating the bookmark — no service lookup needed, the correct icon appears immediately.
- **Favicon service fallback chain** — switched the primary lookup from Google's `/s2/favicons` (which always returns HTTP 200 even for unknown sites, returning a generic globe instead of triggering fallbacks) to Google's `faviconV2` endpoint which returns HTTP 404 for unknowns, allowing the `onerror` chain to properly try DuckDuckGo → direct `/favicon.ico` → `/s2/favicons` in sequence.

---

## [0.11.18] — 2026-04-23

### Fixed

- **Favicon regression (0.11.17)** — the `fetch()`-based data-URL caching was silently failing for all cross-origin favicon services because browsers block reading the response body without CORS headers. This caused `img.src` to be overwritten with a bare `favicon.ico` URL that often doesn't exist, rendering alt text instead of an icon. Replaced with a simple `<img>` `onerror` chain: Google → DuckDuckGo → direct `/favicon.ico`. No `fetch()` required; the browser handles the requests natively without CORS restrictions.

---

## [0.11.17] — 2026-04-23

### Fixed

- **Favicon loading reliability** — replaced single-service Google fetch with a parallel race between Google and DuckDuckGo favicon services; added direct `/favicon.ico` fallback. (Superseded by 0.11.18.)

---

## [0.11.16] — 2026-04-23

### Fixed

- **Undo/redo leaves stale trash entries** — after undoing a deletion, the restored item is now removed from the Recently Deleted panel automatically. Applies to redo as well. If the trash panel is open, it refreshes immediately.
- **Board tab bar stale after closing settings with no rename** — `hideBoardSettingsPanel` now refreshes the collection/folder tab bar when the title input is empty (placeholder fallback path), matching the existing live-update on every keystroke.

### Changed

- **Trash panel label for deleted collections** — restored-collection entries now show "Collection" in the trash panel meta line instead of "Item".

---

## [0.11.15] — 2026-04-23

### Changed

- **"Move to board" list sorting** — all board selectors (modal dropdown, search-result submenu, bulk-move dropdown) now sort: standalone boards A-Z first, then collection boards grouped by collection name A-Z, then board name A-Z within each collection.

---

## [0.11.14] — 2026-04-22

### Added

- **Collections in trash** — deleting a collection now pushes it to Recently Deleted. Restoring puts the collection back in the nav and un-promotes its boards (removes the stub nav entries that were created on delete).
- **Collection speed dial → DnD to columns / essentials** — bookmarks in a collection's speed dial can now be dragged into board columns, board sub-folders, and essential slots (was silently rejected before). Displaced essentials are returned to the collection speed dial.
- **Collection speed dial → "Move to board"** — right-clicking a collection speed dial bookmark now offers "Move to board", identical to the regular speed dial item menu.

### Changed

- **Move to board board list** — boards that live inside a collection are now labelled `Collection — Board` instead of just `Board` in all "Move to board" dropdowns (modal selector and search-result submenu).
- **Shared tags input placeholder** — changed from "shared tag1 tag2" to "tag1 tag2" to match all other tag input fields.

---

## [0.11.13] — 2026-04-22

### Added

- **Collection `inheritTags` / `autoRemoveTags` toggles** — the Edit Collection modal now shows "Pass to items" and "Strip on remove" toggles below the Shared Tags input, matching the equivalent controls in folder and board settings. Collections missing these fields are migrated on load (defaults: `inheritTags: true`, `autoRemoveTags: false`).
- `autoRemoveTags` logic on collection removal — when "Strip on remove" is enabled, removing a board from a collection (via context menu or DnD to nav) strips the collection's shared tags from the board's own tag list.

### Fixed

- **Boards not displaying inherited tags** — `getBoardInheritedTags()` in modal.js was only looking one level up (immediate nav parent folder). It now calls `getBoardNavInheritedTags(boardId)` from state.js, which walks the full ancestor chain (nested folders + collection) and respects each ancestor's `inheritTags` flag.
- **`computeInheritedTags` ignoring collection `inheritTags`** — the in-board tag computation now checks `collection.inheritTags !== false` before appending collection shared tags, consistent with folder ancestry logic.

---

## [0.11.12] — 2026-04-22

### Added

- **Collection tags modal** — the "New Collection" and "Edit Collection" dialogs now include a Tags chip input (collection's own tags) and a Shared Tags chip input (inherited by all boards in the collection), matching the layout used in other create/edit modals.

### Fixed

- **Double border on modal tag input** — `.chip-text-input { border: none }` was being overridden by the more-specific `.tag-field-row .tags-input-container input` rule; added `!important` to `.chip-text-input` border reset.
- **Empty collection shows last active board title** — clicking a collection with no boards now sets `activeBoardId = null` so the title bar shows only the collection name.
- **Speed dial DnD adds to wrong target** — dragging a bookmark onto the speed dial pane while a collection is active now adds to the collection's speed dial, not the last active board's speed dial.
- **Speed dial "Add bookmark" context menu adds to wrong target** — same fix applied to `addSpeedDialBookmark()`; collection speed dial is targeted when `state.activeCollectionId` is set.

---

## [0.11.11] — 2026-04-22

### Added

- **Collection style settings** — Collections section in the Style tab of global settings: font size, font family, bold/italic/underline, text align, and color. These control how collection names appear in the nav pane.

### Fixed

- Collection name shown twice in the nav pane. The nav item renderer was falling through to a generic label-append branch after already building the collection's info element.

---

## [0.11.10] — 2026-04-22

### Added

- **Board tab bar** — when the active board lives inside a nav folder, a tab bar appears above the speed dial showing all boards in that folder. Click a tab to switch boards. Active tab is highlighted with an accent bottom border. Right-click a tab for Edit / Remove from folder / Delete. Drag a tab to the nav to pull the board out of the folder. "Add board" button appends a new board to the folder.
- **"Add board" in folder context menu** — right-clicking a nav folder now offers "Add board", creating a new board directly inside that folder.
- `findBoardFolder(boardId)` helper in state.js to locate the immediate parent folder of a board.

### Changed

- Board title header shows `Folder — Board` format when the active board is in a nav folder (mirrors the `Collection — Board` format).

---

## [0.11.9] — 2026-04-22

### Added

- **Collections** — new nav item type that groups boards into a tabbed workspace. Click a collection to activate it; boards appear in a scrollable tab bar above the speed dial. Context menus on collections and tabs support add/delete/rename/unlock operations. DnD: drop a board nav item onto a collection to add it; drag a tab back to the nav to remove it from the collection.
- **Collection speed dial** — when a board lives inside a collection, its individual speed dial is hidden; the collection's own speed dial is shown instead. The board settings speed dial toggle is disabled with an explanatory note when the board is in a collection.
- **Collection tag inheritance** — `sharedTags` on a collection are appended to every board's inherited-tag set, exactly like folder-level inheritance.
- **Search tag picker** — a collapsible side panel in the search modal lists every tag that appears in the current text-match results. Click chips to filter results by tag. Supports AND/OR toggle and A-Z / Group / Count sort modes. Pre-selects the tag when opened via "Search for tag" from the tag manager.

### Changed

- Search modal now uses a two-column layout (results + tag picker panel) when the picker is open.
- Empty search term now matches all items (so the tag picker can filter the full database without needing a text query).

---

## [0.11.8] — 2026-04-21

### Changed

- **Tag autocomplete** now suggests plain tag names (not `name · Group`); for same-name tags across multiple groups the autocomplete still completes the name, but committing (Space/Enter) shows a group-picker dropdown instead of silently picking the wrong one
- **Tag manager group inputs** have autocomplete disabled (`noAutocomplete: true`) — users type the tag name directly; same-name handling is done via the group picker if triggered from outside

### Fixed

- `chip-input`: `resolveInput` now receives `(typed, textInput, hiddenInput)` so disambiguation code can show a picker and defer chip commit (return `null`) without clearing the typed text
- `chipifyWord` only clears the text input when a chip was actually committed; text is preserved when the group picker opens

---

## [0.11.7] — 2026-04-21

### Added

- **Tag disambiguation in autocomplete**: when two tags share the same name in different groups (e.g. "python" in "Coding" and "Snakes"), suggestions and committed chips now show `python · GroupName`; chip inputs resolve the qualified format `name · GroupName` to the correct tag ID
- **Delete tags from Unsorted**: Unsorted chips now show a × button to permanently remove a tag from all items and state
- **Orphan tag cleanup**: if any tags are unreferenced by all items, an `× N orphans` pill appears in the Unsorted header; clicking it batch-deletes all zero-use tags with a single undo snapshot

---

## [0.11.6] — 2026-04-20

### Changed

- **Tag system refactored to ID-based** (Phases A–C): tags are now objects `{id, name, groupId, color}` stored in `state.tags`; all bookmarks/folders store tag IDs instead of name strings
- **Migration**: existing string-name tags are automatically migrated on first load — tag colours and group memberships are preserved
- **Tag manager** group editor now reads/writes `state.tags` directly via `groupId`; adding a tag to a group sets its `groupId`, removing moves it to Unsorted; deleting a group moves all its tags to Unsorted rather than deleting them
- **Chip inputs** for tags (modal, folder modal, board settings, tag manager groups) now store IDs and display names via `displayOf`/`resolveInput` opts; tag autocomplete excludes already-committed chips by ID
- **Context menu** in tag manager uses tag IDs; right-clicking an Unsorted chip now offers all groups; right-clicking a grouped chip offers "Unsorted" plus all other groups

### Fixed

- Tag autocomplete bug where exact-match filter was inverted (`!t.name === lc` → `t.name !== lc`)
- Tag autocomplete now correctly excludes already-committed chips (was using text input value; now uses hidden input IDs)

---

## [0.11.5] — 2026-04-21

### Added

- **Tag Manager panel** in Settings → Tag Manager tab: replaces "Coming soon" placeholder
- **Tag groups**: create named groups with a colour swatch, lock toggle, and × delete button; each group has a chip input for adding tags (chips render in group colour)
- **Unsorted category**: always-visible read-only section at the bottom showing all tags not assigned to any group; shows "All tags are grouped." when empty
- **Tag sort per group**: sort icon button on each group header opens a dropdown — A→Z, Z→A, Most used (by bookmark count); active sort shown with accent checkmark in dropdown
- **Tag chip context menu**: right-click any chip in the tag manager to get a "Move to group" menu listing all other groups with colour dots
- **Undo/redo in tag manager**: undo/redo buttons in the Tag Groups header row; all mutations push undo snapshots; synced with global undo stack
- **Settings panel fixed height**: 720 px tall regardless of active tab

### Changed

- `updateUndoRedoUI` now syncs `#stgUndoBtn` / `#stgRedoBtn` in addition to the main toolbar buttons

---

## [0.11.4] — 2026-04-20

### Added

- **Item lock feature**: lock icon on every board bookmark/folder item; hover-only when unlocked, permanently visible in accent colour when locked; toggled via lock icon click or context menu ("Lock item" / "Unlock item")
- **Inherited lock**: locking a folder locks all children recursively — child lock icons show in accent colour with "Locked by parent" tooltip and cannot be unlocked directly
- **Board-level locking**: lock icon on board nav items (hover-reveal when unlocked, accent-coloured when locked); toggled via lock button or nav context menu ("Lock board" / "Unlock board")
- **Locked board enforcement**: locked boards are fully read-only — all DnD blocked (column drops, item reordering, speed dial, inbox); context menus suppressed on items, speed dial (links and empty space), and columns; board settings and inbox buttons disabled; inbox panel closes and cannot be re-opened; board edit/delete removed from nav context menu while locked; locked boards excluded from all "Move to board" target lists

### Fixed

- **DnD preview in locked folders**: drag preview clone no longer appears inside locked folders (direct or inherited lock)
- **DnD drop into locked folders**: items can no longer be dropped into locked folders via any path (folder header, children container, or item-level reordering)
- **Folder reposition on failed nesting**: dragging a folder into a too-deep target no longer moves it to the bottom; validation runs before extraction
- **Themed error dialogs**: nesting/descendant error messages now use the app's modal style instead of the native browser `alert()`

---

## [0.11.29] — 2026-04-20

### Added

- **Sidebar collapse edge tab**: thin tab anchored to the right border of the sidebar at mid-height; replaces the collapse button in the header/footer; chevron rotates 180° in collapsed state
- **About tab in Settings**: settings panel now has an About tab (first in the tab list) containing the version number and app description

### Changed

- **Version number opens Settings at About tab**: clicking the version badge in the sidebar footer now opens the settings panel defaulted to the About tab
- **Standalone About dialog removed**: merged into the Settings panel; footer is now just trash + version — clean and uncluttered
- **Settings panel no longer in footer**: global settings accessible via version number (About tab) or any other tab via settings panel; `showSettingsPanel(tab)` now accepts an optional tab name

---

## [0.11.28] — 2026-04-20

### Added

- **Search highlight on "Open in board"**: after navigating, the target item scrolls into view and pulses with an accent-colored glow for ~1.6s so it's immediately visible even inside large folders

---

## [0.11.27] — 2026-04-20

### Fixed

- **"Open in board" now unfolds ancestor folders**: when navigating to a deeply nested item via search, all parent folders in the path are expanded before rendering so the item is immediately visible

---

## [0.11.26] — 2026-04-20

### Added

- **Search filter panel**: funnel icon button beside the search input toggles a compact filter bar with two groups — "Match" (Name / Tags) and "Show" (Bookmarks / Folders / Boards); chips toggle independently; icon gets an accent dot indicator when any filter is non-default; panel collapses via the button or Escape

### Changed

- `renderSearchResults` now respects `searchFilters`: name/URL matching and tag matching are gated by their respective chips; result types (bookmark, folder, board) are individually suppressible

---

## [0.11.25] — 2026-04-20

### Added

- **Search result tooltips**: bookmark, folder, and board results now show tooltips on hover (matching board items, speed dial, and essentials)
- **Search result context menus**: right-clicking a search result now opens the appropriate context menu — bookmarks get Edit / Duplicate / Refresh favicon / Move to board / Open in board / Delete; folders get Edit / Open in board / Delete; essentials and speed dial items delegate to their existing handlers; boards delegate to the nav context menu
- **"Open in board" action**: navigates to the board containing the item and closes search, available for bookmark and folder search results

### Fixed

- **`createBoardSearchResultItem` used undefined `body` variable**: board search results with tags would throw a ReferenceError; fixed `body.appendChild` → `el.appendChild` and removed the phantom `el.appendChild(body)` call
- **Cross-board edit/delete/duplicate/favicon-refresh**: all board-item context actions now use `getBoardForContext()` to resolve the correct board from `contextTarget.boardId`, so they work correctly on items from non-active boards (e.g. from search results)

### Changed

- **Removed dead CSS**: `.bookmark-body` and `.bookmark-tags` rules removed from `styles.css` (no JS callers remain; replaced by `.item-header` / `.item-tag-chips`)

---

## [0.11.24] — 2026-04-20

### Added

- **"Move to board" for speed dial and essentials**: both areas now have a Move to board context menu option; removes the item from its source and delivers it to the target board's inbox
- **Search results use unified item layout**: bookmark, folder, and board results now use the same `item-header` structure as board column items (favicon + name row, tag chips below) instead of the old `bookmark-body` layout; folder results use SVG folder icon; board results use the board icon

### Fixed

- **`moveToBoard` modal handler**: now correctly removes speed dial / essential items from their source before inserting into the target board's inbox (previously `deleteBoardTarget` was a no-op for non-board areas)

---

## [0.11.23] — 2026-04-20

### Fixed

- **Inbox rendering**: `renderInboxPanel` was passing `null`/`0` as depth/parentFolder to `createBoardItemElement`; corrected to use the function's defaults (depth=1, parentFolder=null), fixing depth-gated context menu options and drag payloads for inbox items

---

## [0.11.22] — 2026-04-20

### Added

- **Context menu parity — speed dial**: Duplicate and Refresh favicon actions now available on speed dial bookmarks (matching board bookmark menus)
- **Context menu parity — essentials**: Duplicate and Refresh favicon actions now available on essential slot bookmarks

### Fixed

- **Duplicate / Refresh favicon cross-area**: both actions now work in all contexts (board column, speed dial, essential) — previously they only operated on board-column items
- **Edit essential modal**: now passes `inheritedTags` to the bookmark modal, matching the edit path for board and speed dial bookmarks

---

## [0.11.21] — 2026-04-20

### Fixed

- **DnD dotted outlines removed** — `.drop-target` no longer shows a dashed outline anywhere (columns, inbox, essentials, folder children); the preview clone and favicon preview are the sole drop indicators

---

## [0.11.20] — 2026-04-20

### Fixed

- **DnD folder reordering** — items dragged within a folder now land at the correct position instead of always appending to the bottom; `handleBoardFolderContainerDragOver` now does full position-aware preview (nearest-item mid-point logic matching column dragover) instead of always pushing preview to the end
- **DnD nested folder preview** — removed the `depth >= 2` guard from `activateFolderDrop`; preview now appears correctly inside nested folders; actual folder-in-folder nesting is still blocked at drop time by the existing depth check in the drop handler
- **DnD collapsed folder drag** — dragging over a collapsed folder now correctly shows before/after reorder indicators instead of silently delegating to `activateFolderDrop` with no visible feedback

---

## [0.11.19] — 2026-04-20

### Fixed

- **DnD folder flickering** — dragging onto folder cards (header, tag grid, or card padding) now consistently activates folder-drop mode without flickering; child items no longer jump around when hovering over the folder name; dragging between header and children area no longer drops and re-animates the preview

---

## [0.11.18] — 2026-04-20

### Fixed

- **DnD column flicker** — board item/column/folder dragover handlers now reposition the existing preview clone in-place instead of destroying and re-animating it on every cursor movement within the same container; animation only plays when crossing into a new container for the first time

---

## [0.11.17] — 2026-04-20

### Changed

- **Essentials DnD** — removed dashed drop-target outline from essentials slots; the favicon preview is now the sole drop indicator

---

## [0.11.16] — 2026-04-20

### Fixed

- **Essentials DnD preview** — dragging any bookmark over an essentials slot now shows a semi-transparent favicon preview inside the slot, matching the behaviour of speed-dial and column previews

---

## [0.11.15] — 2026-04-20

### Fixed

- **DnD stuck preview** — dragging a board item into an empty speed-dial no longer leaves the column preview clone behind; `handleSpeedDialContainerDragOver` now inserts a placeholder and clears prior previews instead of returning early when speed-dial has no items
- **DnD stuck preview (essentials)** — entering an essentials slot now calls `removeDragPlaceholders()` on first entry so any column preview is cleared before the slot highlight appears

---

## [0.11.14] — 2026-04-20

### Fixed

- **Tag input backspace** — autocomplete suggestions are now dismissed (not deleted) when backspace is pressed; subsequent backspace strokes correctly erase typed characters; backspace on an empty chip input still pops the last chip back to editable text and further backspacing works normally

---

## [0.11.13] — 2026-04-20

### Changed

- **Unified bookmark and folder item layout** — both now render a single header row (checkbox → icon → name) with a grid tag display below (Tags / Inherited / Shared columns) matching the modal tag section style; folder icon remains the collapse toggle; tag visibility still controlled by the show-tags setting

---

## [0.11.12] — 2026-04-20

### Fixed

- **Nav pane folder context menu** — "Rename folder" replaced with "Edit folder" which opens the full folder settings modal (name, tags, shared tags, inherit/auto-remove toggles); `editFolder` and `showFolderModal` now resolve the folder from nav items when the context originates from the nav pane

---

## [0.11.11] — 2026-04-20

### Added

- **Chip tokenizer for tag inputs** — tag input fields in bookmark modal, folder modal, and board settings now display each entered tag as a coloured chip; clicking a chip returns it to editable text; Space/Tab/Enter commits the current word as a chip; Backspace on empty input pops the last chip back to text

---

## [0.11.10] — 2026-04-20

### Changed

- **Tag section field width** — reduced section padding and column gap so entry fields use ~90% of the box width; label font tightened to minimise column footprint

---

## [0.11.9] — 2026-04-20

### Changed

- **Tag section grid layout** — labels (Tags / Inherited / Shared) and fields are now in a true two-column CSS grid; label column is auto-width with right-aligned text, field column stretches to fill remaining space; all label edges align across rows; toggle row spans both columns

---

## [0.11.8] — 2026-04-20

### Changed

- **Tag section layout refined** — labels (Tags / Inherited / Shared) are right-aligned in a fixed-width column; fields stretch to fill remaining space; Inherited field styled as a non-editable input box (same border/radius/padding as editable inputs); order is Tags → Inherited → Shared → toggles; both toggles condensed into a single row

---

## [0.11.7] — 2026-04-20

### Changed

- **Tag section standardization** — all modals with tag fields (bookmark, folder, board) now group every tag-related control inside a boxed "Tags" section (`settings-section`); consistent order throughout: Tags → Shared tags → Pass/Strip toggles → Inherited
- **Tag input design unified** — folder and board tag inputs now use the same `form-row` layout and input styling (border-radius 12px, padded) as the bookmark modal; inputs are wrapped in `tags-input-container` for correct positioning context

---

## [0.11.6] — 2026-04-20

### Added

- **Nav pane: board tags display** — board items in the nav pane now show their own tags as chips below the board title
- **Folder context menu: Add bookmark** — right-clicking a folder now includes "Add bookmark", which opens the bookmark modal and inserts directly into that folder's children

### Changed

- **Inherited tags now render as chips** — the "Inherited" row in bookmark, folder, and board modals now displays tags as styled tag chips instead of plain italic text

---

## [0.11.5] — 2026-04-20

### Added

- **Nav context menu: Edit board** — right-clicking a board in the nav pane now shows "Edit board" which opens the full board settings panel (same as clicking the gear on an active board), replacing the old rename-only modal

### Changed

- **Modals: name field moved to header** — all create/edit modals using `#modalCard` now have the name input in a styled draggable header at the top, matching the folder and board settings panel layout; the modal card is now draggable by its header
- **Tooltip fix** — tooltip text now wraps correctly within its bounding box; removed `white-space: pre` which was causing text to overflow the container

---

## [0.11.4] — 2026-04-20

### Added

- **Settings: Global Settings restructure** — tabs reorganised to General / Tag Manager / Theme / Style; hub name is now an editable field in the panel header; Icon Sizes and Essentials moved to Style tab; Tag Colors section removed (placeholder reserved for future Tag Manager feature)
- **Settings: Board settings — autoRemoveTags toggle** — boards now expose a "Strip on move out" toggle matching the existing folder behaviour
- **Settings: Board settings — inherited tags display** — boards inside a nav folder now show the folder's shared tags as a read-only "Inherited" row
- **Modals: inherited tags display** — bookmark, folder, and board create/edit modals now show a read-only "Inherited" row listing tags the item will receive from its parent folder or board
- **Modals: tooltip icons** — "Pass to children/items" and "Strip on move out" toggles in folder and board modals now carry `?` tooltip icons explaining the mechanics
- **Folder icons** — folder expand/collapse indicators replaced with distinct open/closed folder SVG icons instead of generic chevrons

### Changed

- **Modals: create placeholders** — all create modals now use "New \<type>" placeholder text (New Bookmark, New Folder, New Title) instead of generic labels
- **Bugs fixed: confirm dialog z-index** — confirmation dialog now renders above the inbox panel (z-index 250 vs. 200)
- **Bugs fixed: cancelled modal ghost** — `hideModal()` now explicitly hides `#modalCard`; widget panels hide it before showing, preventing stale modal content appearing behind a new panel

## [0.11.3] — 2026-04-19

### Fixed

- **DnD: navpane inbox drop for bookmarks** — board nav items now accept bookmarks and folders dragged from any source (board column, nav list, speed dial, essentials), not just board columns; items are correctly extracted and normalised per source before being pushed to the target board's inbox
- **DnD: navpane board items as position anchors** — when dragging a widget cross-context into the navpane, board nav items (the majority of nav entries) were exiting the dragover handler early, making the middle of the list unreachable; they now correctly serve as position anchors
- **Modal: modalCard hidden state** — `modalCard` was not having its `hidden` class removed on open, causing display issues in some modal flows

### Changed

- **Extension: native messaging routing** — all bridge messages except `MW_PING` are now routed through the background script, enabling file-based save/load via the native host; `MW_REGISTER` sends the page URL so the background can derive the save path
- **Extension: manifest** — added `nativeMessaging` permission and `browser_specific_settings` gecko block for proper add-on ID assignment
- **Extension: popup** — separate status rows for Morpheus hub presence and native file save availability; clearer call-to-action when hub is not open

---

## [0.11.2] — 2026-04-19

### Fixed

- **DnD: widget drag to navpane middle positions** — board nav items were exiting the dragover handler early for widget drags, making them invisible as position anchors; the middle of the navpane was effectively a dead zone when dropping widgets from columns into the nav list
- **DnD: cross-context preview style** — dragging a widget from a column into the navpane now shows a navpane-style preview clone instead of the column card style; `_moveNavPreview` discards wrong-context clones and renders fresh in target context
- **DnD: speed dial drop position** — leftmost drop and container-level drops now read position globals before `removeDragPlaceholders()` clears them
- **DnD: navpane reorder drop** — `handleNavListDrop` captures `_dropTarget`/`_dropPos` before cleanup so drops that land on the container (cursor over clone) still insert at the correct item-level position
- **DnD: essential slot indicator** — drop target outline now uses `var(--accent)` instead of a hardcoded colour
- **DnD: speed dial shadow indicators** — removed stale CSS box-shadow rules that showed alongside the live preview

### Changed

- **DnD: navpane live preview** — preview clone is repositioned in-place (`insertBefore`) rather than destroyed and recreated, eliminating flicker during nav list reordering
- **DnD: cross-context previews** — `_renderCrossContextPreview` renders items in the target context style for all cross-context drag combinations (board↔nav, board↔speed-dial, essential↔board, column widget↔navpane)

---

## [0.11.1] — 2026-04-19

### Added

- **Notes widget** — freeform text, editable inline in the column; textarea auto-saves on blur; settings panel offers a larger editing area
- **To-do list widget** — checklist with inline add (Enter or + button) and per-row delete; checked items strike through; settings panel shows done/total count and a "Clear completed" button
- **Image widget** — displays any image URL; config: URL, fit (contain/cover/fill), optional caption; shows a placeholder prompt when no URL is set

---

## [0.11.0] — 2026-04-19

### Added

- **Widget framework** — new board item type alongside bookmarks, folders, titles, and dividers
  - `source/widgets.js` — `WIDGET_REGISTRY` pattern; adding a widget requires one object in one file
  - `WIDGET_REGISTRY[type]` fields: `name`, `description`, `allowedIn` (array of contexts), `defaultConfig`, `defaultData`, `render(widget, el, context)`, `renderSettings(widget, container)`
  - `render` context is `'column'` or `'navpane'` — same function produces full card or compact strip
  - Timer management keyed by `"widgetId:context"` to prevent accumulation on re-render; `clearColumnWidgetTimers()` / `clearNavWidgetTimers()` called at start of each render pass
  - Widget settings panel (`widgetSettingsPanel` in HTML) — title input + dynamic settings via `[data-cfg]` attributes; AbortController cleans up listeners on close; Cancel reverts config
  - Widget picker panel (`widgetPickerPanel`) — lists widgets allowed in the current context; AbortController cleanup
- **Clock widget** — live time display; column: large time + optional date; navpane: compact time; config: 24h/12h format, show seconds, show date, timezone (IANA string)
- **Countdown widget** — counts down to a target datetime; column: label + formatted time remaining; navpane: compact remaining; config: label, target date
- "Add widget" option in column right-click context menu
- "Add widget" option in navpane right-click context menu (shows only navpane-allowed widgets)
- Widget right-click menu: "Widget settings" and "Delete widget"

### Changed

- `renderColumns` now calls `clearColumnWidgetTimers()` before rebuilding DOM
- `renderNav` now calls `clearNavWidgetTimers()` before rebuilding DOM
- `createBoardItemElement` delegates `type === 'widget'` items to `createWidgetElement`
- `createNavItem` handles `type === 'widget'` — renders compact widget strip in navpane

---

## [0.10.0] — 2026-04-19

### Added

- **Theme system** — Global Settings → Style tab now has a Theme section at the top
  - 7 built-in themes: Default Dark, Light, Dracula, Catppuccin Mocha, Midnight (dark blue), Crimson (dark red), Nebula (dark purple)
  - Theme picker renders color-swatch cards; clicking applies immediately and persists to state
  - "Save current as theme…" button — captures all active CSS color variables as a named custom theme; stored in `state.settings.customThemes[]`
  - Custom themes show a delete (×) button on hover
  - If native host is connected, custom themes are also written to `./themes/<id>.json`; themes in that folder are loaded and shown alongside built-ins
- **`source/themes.js`** — `BUILTIN_THEMES`, `applyTheme(theme)`, `getThemeById(id)`, `getAllThemes()`
- **`themes/` folder** — 4 built-in theme JSON files for sharing and reference
- **`--accent-glow` CSS variable** — derived from `--accent` at 20% opacity; body radial gradient now uses it so the glow color follows the active theme's accent
- **Extension: `LIST_DIR` native message** — lists files in a directory with optional extension filter
- **Extension: `MW_LIST_THEMES` / `MW_WRITE_THEME`** — background routes to native host; reads/writes JSON theme files in `./themes/` next to `index.html`
- **Bridge: `listThemes()` / `saveTheme(theme)`** — page-side bridge methods for theme file access

### Changed

- `applySettings()` in `render.js` now calls `applyTheme()` at the end, keeping colors in sync with the active theme on every settings change
- **CSS fully variabilized** — all hardcoded dark hex values (`#141518`, `#16181d`, `#24262a`, sidebar gradient, board/column/speed-dial backgrounds), semi-transparent white surfaces (`rgba(255,255,255,…)`), and accent tints (`rgba(109,124,255,…)`) replaced with CSS variables; light and custom themes now render correctly across every UI element
- New CSS variables: `--panel-r/g/b` (RGB split for alpha-composited panel backgrounds), `--surface-1/2` (theme-aware hover/active surfaces), `--accent-chip/hover/selected/selected-border/glow`

---

## [0.9.1] — 2026-04-19

### Added

- **Native messaging host** (`extension/native/`)
  - `morpheus_host.py` — handles `READ_FILE`, `WRITE_FILE`, `OPEN_FILE_PICKER`, `PING`; cross-platform file picker via tkinter with PowerShell fallback on Windows
  - `morpheus_host.bat` — Windows launcher (path written by installer)
  - `install.ps1` — Windows installer: detects Python, writes launcher `.bat`, writes native messaging manifest to `%APPDATA%\Mozilla\NativeMessagingHosts\`, registers registry key under `HKCU\Software\Mozilla\NativeMessagingHosts\`
  - `install.sh` — Linux/macOS installer
- **Extension ID** (`morpheus-webhub@local`) added to manifest — required for native messaging and permanent installation
- **`nativeMessaging` permission** added to manifest
- `background.js` now connects to native host: `WRITE_FILE` (debounced 800 ms), `READ_FILE`, `OPEN_FILE_PICKER`; falls back to `browser.storage.local` when host unavailable
- `content.js` sends page URL on registration (used to derive JSON save path next to `index.html`); relays all bridge messages to background
- **"Browse…" button** in board settings background panel — calls `bridge.openFilePicker('image')` → native file picker → sets `board.backgroundImage` as data URL
- Popup now shows two status rows: Morpheus open/closed + file save enabled/storage-only
- `bridge.nativeIsAvailable()` and `bridge.openFilePicker()` added to page bridge

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
