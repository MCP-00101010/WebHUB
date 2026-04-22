# TODO for Morpheus WebHub

## Optimization

- auto-export on a schedule (e.g. daily JSON backup written to Downloads)

## UI

- ✓ *Completed 2026-04-22* Collections: nav item type grouping boards into a tabbed workspace with shared speed dial and tag inheritance — see [0.11.9] in CHANGELOG.

## Customization

- have icons in the board name bar adhere to theme style
- have all font color adhere to theme style (maybe a toggle in style settings panel to enable/disable - if enabled, also disable all font color selectors in the style settings dialouge.)
- 
- custom CSS input field in global settings for power users (low priority)

## Widgets

- weather widget (current conditions, configurable location)
- news feed / RSS widget (fetch and display headlines from a feed URL)

## Drag and Drop

- ✓ *Fixed 2026-04-20* — Visual: column preview clone stuck when dragging to empty speed-dial or essentials. Fixed by handling the empty speed-dial case in `handleSpeedDialContainerDragOver` and calling `removeDragPlaceholders()` on first entry into an essentials cell.
- Known limitation: when dragging a bookmark directly from the browser (Firefox/Zen) into the Hub, no item-specific preview can be rendered during the drag. The HTML DnD API does not allow reading `dataTransfer` payload during `dragover` — only on `drop`. A dashed-outline placeholder is shown instead. A proper preview would require browser extension integration.
- Known limitation: dragging a bookmark folder from Firefox/Zen only imports the first bookmark, not the folder structure. The HTML DnD API only exposes `text/x-moz-url` / `text/uri-list` (single URL) for browser bookmark drags — folder structure is not accessible. Full folder import would require the Firefox extension to intercept the drag and relay the bookmark tree.

## Firefox Extension — Remaining

- Visual / Feature: In the Hubs about dialogue, show if the Hub is connected to the Extension and if so, which features the extension provides.
  
- [ ] Chromium shim — same bridge interface backed by File System Access API for Chrome/Edge
- [ ] Watch for external file changes — detect if the JSON was modified externally (e.g. Dropbox/OneDrive sync) and prompt the user to reload
- [ ] Configurable paths — path stored as a top-level field in the JSON itself (not in browser extension storage), so it is shared across all browsers automatically; a small bootstrap `config.json` next to the native host binary holds the initial/fallback path; the hub settings panel exposes a path field (gated on `bridge.isAvailable()`); the extension popup shows the resolved path read-only

## Compatibility / Portability / Readability

- add native File System Access API support for Chromium browsers (Chrome, Edge, Opera)
- write user-facing documentation (installation, usage, extension setup, file structure)
- add localisation support
- code restructuring: JSDoc comments on all major functions and data types

## UI Standardization

### Context menu parity

- ✓ *Completed 2026-04-20* Speed dial bookmarks: Duplicate and Refresh favicon added — see [0.11.22]
- ✓ *Completed 2026-04-20* Essentials: Duplicate and Refresh favicon added — see [0.11.22]
- ✓ *Completed 2026-04-20* Search results: tooltips and full context menus (Edit, Duplicate, Refresh favicon, Move to board, Open in board, Delete) — see [0.11.25]
- Nav folders: "Add bookmark" not applicable (nav folders hold boards/sub-folders, not bookmarks); "Open all" could open all boards in folder — low priority

### Edit modal unification

- ✓ *Completed 2026-04-20* All bookmark edit paths (board, inbox, speed dial, essential) route through the same `editBookmark` modal with `inheritedTags` — see [0.11.22]

### Bulk selection parity

- ✓ *Completed 2026-04-20* Inbox panel: bulk selection already works — checkboxes are rendered by `createBoardItemElement`, toolbar is viewport-fixed, operations use `findBoardItemInColumns` which covers inbox columns; fixed incorrect depth/parentFolder args in `renderInboxPanel` — see [0.11.23]
- Speed dial / Essentials: bulk-select not applicable — these are small curated lists, per-item actions are sufficient

---

## Open bugs / QoL

- hub should have a list of commonly used tags baked into its config as a base suggestion set

## Tag Manager

### Core panel

- Tag Manager panel: list all known tags; click a tag to see which items carry it; rename/delete globally; assign to groups; drag tags between groups
- Tag categories & colors: predefined tag groups (science, ratings, fiction-genres, etc.) each with an assigned color; tags inherit group color; tag category editor in settings
- Per-item "ignore inheritance" toggle (deferred — implement once core inherit/auto-remove has been stable; edge case for children of an ignoring folder needs design)

### Filtering & discovery

- Sort tags by usage count (most-used first), name, or group
- Search/filter the tag list as you type
- Orphan tag detection — highlight tags with zero items; bulk-clean option to remove them all

### Bulk operations

- Replace — swap one tag for another across all items
- Multi-select tags → batch delete or batch group-assign

### Tag detail view

- Click a tag → slide-in panel listing every item that carries it
- From that panel: remove the tag from individual items, or navigate directly to the board the item lives in

### Groups / categories

- Collapse/expand groups in the tag list

### Smart suggestions

- When tagging a bookmark, suggest tags already common on other items in the same board

---

## Action Plan

Strategic implementation order based on dependency analysis.

---

### Phase 1 — Polish & quick wins ✓ *Completed 2026-04-18*

See [0.4.0] in CHANGELOG.

---

### Phase 2 — State architecture stabilisation ✓ *Completed 2026-04-18*

See [0.5.0] in CHANGELOG.

---

### Phase 3 — Bookmark management features ✓ *Completed 2026-04-18*

See [0.6.0] in CHANGELOG.

---

### Phase 3.5 — Bug fixes & small UX ✓ *Completed 2026-04-18*

See [0.6.1] in CHANGELOG.

---

### Phase 4 — Tag system overhaul ✓ *Completed 2026-04-18*

See [0.7.0] and [0.7.1] in CHANGELOG.

---

### Phase 5 — Board inbox & Import Manager ✓ *Completed 2026-04-19*

See [0.8.0] and [0.8.1] in CHANGELOG.

---

### Phase 6 — Firefox extension & native bridge ✓ *Completed 2026-04-19*

See [0.9.0] and [0.9.1] in CHANGELOG.

Remaining open items: Chromium shim, external file change detection, configurable paths (see Firefox Extension — Remaining above).

**Configurable paths — architecture decision:** path will be stored as a top-level field in the JSON file itself, not in browser extension storage. This keeps the setting consistent across all browsers (Firefox, Zen, Chrome, etc.) since they all read the same JSON. A bootstrap `config.json` next to the native host binary holds the initial path for first-run and fallback. The hub settings panel exposes the path field; the extension popup shows it read-only.

---

### Phase 7 — Theme system ✓ *Completed 2026-04-19*

See [0.10.0] in CHANGELOG.

---

### Phase 8 — Widget framework ✓ *Completed 2026-04-19*

See [0.11.0] in CHANGELOG.

Remaining widgets (not yet built):
- Weather (external API, configurable location)
- News feed / RSS (external fetch, configurable URL)

---

### Phase 9 — UI polish & modal standardization ✓ *Completed 2026-04-20*

See [0.11.3] and [0.11.4] in CHANGELOG.

---

### Phase 10 — Advanced navigation *(in progress)*

- Collections — ✓ done in [0.11.9]
- Board tab bar (folder-selected boards populate the tab strip) — ✓ done in [0.11.10]
- DnD live previews — ✓ done in [0.11.2]

---

### Phase 10 — Documentation, localization & code health

*Post-feature-freeze. Do this once, at the end, when the string surface is stable.*

1. **Code restructuring** — reorganise source files for readability; add JSDoc-style comments to all major functions and data types
2. **Localisation (i18n)** — extract all user-facing strings into a locale file (`en.json`); wire a locale-loader so additional language files can be dropped in
3. **Documentation** — user-facing `README.md` covering installation, usage, file structure, and extension setup; brief developer guide covering state schema, rendering pipeline, and bridge API

---

### Cross-cutting notes

- **Browser / OS agnosticism:** the page-side bridge is the key abstraction — extension on Firefox/Zen, File System Access API on Chromium, manual fallback everywhere else. No platform-specific code in the app itself.
- **Extension as optional enhancement:** the hub must remain fully functional without the extension. Gate every extension-dependent UI element on `bridge.isAvailable()`.
- **Inbox as the universal delivery mechanism:** the per-board inbox is the single intake point for all external delivery — move-to-board, extension tab sender, and Import Manager all funnel through it.
- **Tag inheritance before ignore-toggle:** the per-item "ignore inheritance" flag is intentionally deferred until the core system has been live long enough to understand edge cases.
