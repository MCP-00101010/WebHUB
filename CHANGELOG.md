# Changelog

All notable changes to Morpheus WebHub are documented here.
Format: `[version] — date` followed by Added / Changed / Fixed sections.

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
