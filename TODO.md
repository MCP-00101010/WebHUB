# TODO for Morpheus WebHub

## Optimization

- auto-export on a schedule (e.g. daily JSON backup written to Downloads)

## UI

- ✓ *Completed 2026-04-22* Collections: nav item type grouping boards into a tabbed workspace with shared speed dial and tag inheritance — see [0.11.9] in CHANGELOG.
- ✓ *Fixed 2026-04-22* edit/create bookmark modal double border on tag chip input — see [0.11.12]

## Trash / Undo-Redo

- ✓ *Fixed 2026-04-23* undo/redo now auto-removes restored items from trash — see [0.11.16]

## Collections

- ✓ *Fixed 2026-04-22* shared tag input placeholder now matches other tag fields — see [0.11.14]
- ✓ *Fixed 2026-04-22* collections pushed to trash on delete; restore un-promotes boards — see [0.11.14]
- ✓ *Fixed 2026-04-22* collection speed dial bookmarks can now be dragged to columns and essentials — see [0.11.14]
- ✓ *Fixed 2026-04-22* collection speed dial bookmarks now have "Move to board" context menu option — see [0.11.14]
- ✓ *Fixed 2026-04-22* "Move to board" list labels collection boards as "Collection — Board" — see [0.11.14]
- ✓ *Fixed 2026-04-22* empty collection showed last active board name in title bar — see [0.11.12]
- ✓ *Fixed 2026-04-22* collection shared tags modal lacked "Pass to items" / "Strip on remove" toggles — see [0.11.13]
- ✓ *Fixed 2026-04-22* boards not displaying inherited tags from ancestor folders/collections — see [0.11.13]
- ✓ *Fixed 2026-04-23* tab bar now refreshes when closing board settings with an empty title — see [0.11.16]
- ✓ *Fixed 2026-04-22* board tab bar icon removed — see bd5a442
- ✓ *Fixed 2026-04-22* speed dial DnD and context-menu "Add bookmark" were targeting last active board instead of collection — see [0.11.12]
- ✓ *Fixed 2026-04-22* collection create/edit modal now includes Tags and Shared Tags chip inputs — see [0.11.12]

## Customization

- have all font color adhere to theme style (maybe a toggle in style settings panel to enable/disable - if enabled, also disable all font color selectors in the style settings dialouge.)

## Widgets

- ✓ *Fixed 2026-04-23* cancelling the create-widget settings dialog no longer creates the widget
- weather widget (current conditions, configurable location)
- news feed / RSS widget (fetch and display headlines from a feed URL)
- search bar widget (for search engines)
- search bar widgets for specific sites (amazon, ebay, reddit etc.)

## Drag and Drop

- ✓ *Fixed 2026-04-23* collection speed dial items can now be reordered by drag and drop — see [0.11.22]
- ✓ *Fixed 2026-04-23* nav boards can be dragged onto the collection tab bar to add to the collection; tabs can be reordered within the bar; collection tabs can be dragged back to the nav to remove from collection — see [0.11.22]
- ✓ *Fixed 2026-04-23* dragged element is now hidden (opacity 0) during the drag so only the preview clone is visible — see [0.11.22]
- ✓ *Fixed 2026-04-23* folder-internal reordering no longer trips the self-subfolder safety check
- ✓ *Fixed 2026-04-23* navpane bottom drops now show the preview clone at the end and insert at the bottom
- ✓ *Fixed 2026-04-20* — Visual: column preview clone stuck when dragging to empty speed-dial or essentials. Fixed by handling the empty speed-dial case in `handleSpeedDialContainerDragOver` and calling `removeDragPlaceholders()` on first entry into an essentials cell.
- Known limitation: when dragging a bookmark directly from the browser (Firefox/Zen) into the Hub, no item-specific preview can be rendered during the drag. The HTML DnD API does not allow reading `dataTransfer` payload during `dragover` — only on `drop`. A dashed-outline placeholder is shown instead. A proper preview would require browser extension integration.
- Known limitation: dragging a bookmark folder from Firefox/Zen only imports the first bookmark, not the folder structure. The HTML DnD API only exposes `text/x-moz-url` / `text/uri-list` (single URL) for browser bookmark drags — folder structure is not accessible. Full folder import would require the Firefox extension to intercept the drag and relay the bookmark tree.

## Firefox Extension — Remaining

- ✓ *Fixed 2026-04-23* About dialog now shows extension/native-host status and available extension-backed features
  
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

### Edit modal unification

- ✓ *Completed 2026-04-20* All bookmark edit paths (board, inbox, speed dial, essential) route through the same `editBookmark` modal with `inheritedTags` — see [0.11.22]

### Bulk selection parity

- ✓ *Completed 2026-04-20* Inbox panel: bulk selection already works — checkboxes are rendered by `createBoardItemElement`, toolbar is viewport-fixed, operations use `findBoardItemInColumns` which covers inbox columns; fixed incorrect depth/parentFolder args in `renderInboxPanel` — see [0.11.23]
- Speed dial / Essentials: bulk-select not applicable — these are small curated lists, per-item actions are sufficient

---

## Open bugs / QoL

- ✓ *Fixed 2026-04-23* hub now has configurable base tag suggestions that feed autocomplete without creating tags until selected

## Tag Manager

- ✓ *Completed 2026-04-23* Tag context menu can create a new group and move the tag into it.
- ✓ *Completed 2026-04-23* Tags can be moved between groups and Unsorted, inserted at cursor position, and reordered within groups via drag and drop.
- ✓ *Completed 2026-04-23* Tag groups can be collapsed/expanded to save screen space.

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
