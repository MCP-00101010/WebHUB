# TODO for Morpheus WebHub

## Optimization

- auto-export on a schedule (e.g. daily JSON backup written to Downloads)

## UI

- board tab bar as alternative navigation style (tabs across the top instead of sidebar list) — select a board folder in the navpane and the boards in that folder populate the tab bar
- tag manager panel (list all known tags, click to add/remove from a bookmark, rename/delete tags globally)

## Customization

- custom CSS input field in global settings for power users (low priority)

## Widgets

- weather widget (current conditions, configurable location)
- news feed / RSS widget (fetch and display headlines from a feed URL)

## Drag and Drop

- previews: render the actual item instead of the blue placeholder frame; only update when item order changes to reduce flicker
- allow folders and bookmarks to DnD onto boards in the navpane → send to target board's inbox

## Firefox Extension — Remaining

- [ ] Chromium shim — same bridge interface backed by File System Access API for Chrome/Edge
- [ ] Watch for external file changes — detect if the JSON was modified externally (e.g. Dropbox/OneDrive sync) and prompt the user to reload
- [ ] Configurable paths — let the user set the database path in extension settings (enables cloud folder sync via Dropbox, Proton Drive, etc.)

## Compatibility / Portability / Readability

- add native File System Access API support for Chromium browsers (Chrome, Edge, Opera)
- write user-facing documentation (installation, usage, extension setup, file structure)
- add localisation support
- code restructuring: JSDoc comments on all major functions and data types

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

### Phase 9 — Advanced navigation & DnD

*Last because board tab bar depends on the folder-of-boards concept being fully exercised, and DnD preview improvements should cover widgets (Phase 8) in one pass.*

- Board tab bar (folder-selected boards populate the tab strip)
- DnD live previews — render actual item instead of blue placeholder frame

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
