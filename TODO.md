# TODO for Morpheus WebHub

## Optimization

- auto-export on a schedule (e.g. daily JSON backup written to Downloads)

## UI

- New Feature: board tab bar as alternative navigation style (tabs across the top instead of sidebar list) — select a board folder in the navpane and the boards in that folder populate the tab bar
- New Feature: tag manager panel (list all known tags, click to add/remove from a bookmark, rename/delete tags globally)

## Customization

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

- Speed dial bookmarks: add Duplicate and Refresh favicon actions (board bookmarks have them)
- Essentials: add Duplicate and Refresh favicon actions (currently only Edit/Delete)
- Nav folders: add "Add bookmark" and "Open all" actions (board folders have them)

### Edit modal unification

- Route all bookmark edits through one modal regardless of source area (board, inbox, speed dial, essential currently diverge slightly)
- Essentials and speed dial "edit" should open the same full bookmark modal as board items

### Bulk selection parity

- Inbox panel: add checkbox + bulk toolbar (same item types as board columns but no selection mechanism)
- Speed dial / Essentials: evaluate if bulk-select makes sense for these areas

---

## Open bugs / QoL

- hub should have a list of commonly used tags baked into its config as a base suggestion set

## Tag Manager

- Tag Manager panel: list all known tags; click a tag to see which items carry it; rename/delete globally; assign to groups; drag tags between groups
- Tag categories & colours: predefined tag groups (science, ratings, fiction-genres, etc.) each with an assigned colour; tags inherit group colour; tag category editor in settings
- Per-item "ignore inheritance" toggle (deferred — implement once core inherit/auto-remove has been stable; edge case for children of an ignoring folder needs design)

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

- Board tab bar (folder-selected boards populate the tab strip)
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
