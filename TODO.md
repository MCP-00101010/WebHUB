# TODO for Morpheus WebHub

## Optimization

- Auto-export on a schedule, such as a daily JSON backup written to Downloads.

## UI

- Trash, Search, Inbox and Global Settings Modals should use the same layout/css for their headers as the edit/create modals. (use bookmark modal for reference)
- footer divider line in navpane should follow global divider line style settings.

## Sets

- Completed 2026-04-26: global sets are now implemented as bookmark-only launch groups with a dedicated Sets Manager, Set Editor, copy-only bookmark membership, URL uniqueness per set, search integration, and bookmark context-menu `Add to Set...` actions.


## Drag and Drop

- Known limitation: when dragging a bookmark directly from the browser (Firefox/Zen) into the Hub, no item-specific preview can be rendered during the drag. The HTML DnD API does not allow reading `dataTransfer` payload during `dragover`; only on `drop`. A dashed-outline placeholder is shown instead. A proper preview would require browser extension integration.
- Known limitation: dragging a bookmark folder from Firefox/Zen only imports the first bookmark, not the folder structure. The HTML DnD API only exposes `text/x-moz-url` / `text/uri-list` as a single URL for browser bookmark drags. Full folder import would require the Firefox extension to intercept the drag and relay the bookmark tree.

## Firefox Extension / Bridge

- Completed 2026-04-26: shared database path, localhost bridge support, best-effort extension-storage mirroring, shared-disk polling, and stale-write/conflict protection are all now in place. See [0.11.48] and [0.11.47] in `CHANGELOG.md`.
- Add a generic secret-storage bridge so API keys are kept out of hub state, exports, and the shared JSON database. Use OS-backed storage where available (Windows Credential Manager, Linux Secret Service/keyring), with a clearly labeled fallback only if no secure store exists.
- Prefer adding generic extension/native-host capabilities for service integrations up front (for example secret get/set and other reusable bridge actions) so future widgets do not force frequent AMO re-signing for one-off extension changes.
- Add background asset management: when a board background image is picked from disk, copy it into a managed sibling assets folder and store a stable relative path instead of inflating the JSON with data URLs.
- Add theme file lifecycle support beyond write-only save: disk delete/update/refresh should stay in sync with in-app theme state.
- Chromium shim: same bridge interface backed by File System Access API for Chrome/Edge.

## UI Standardization

- Speed dial / Essentials: bulk-select is probably not applicable because these are small curated lists, but revisit if workflows change.

## Documentation, Localization & Code Health

Post-feature-freeze work, best done once the string surface is stable:

1. **Code restructuring** — reorganise source files for readability; add JSDoc-style comments to all major functions and data types.
2. **Localisation (i18n)** — extract all user-facing strings into a locale file such as `en.json`; wire a locale-loader so additional language files can be dropped in.
3. **Documentation** — user-facing `README.md` covering installation, usage, file structure, and extension setup; brief developer guide covering state schema, rendering pipeline, and bridge API.

## Cross-Cutting Notes

- **Browser / OS agnosticism:** the page-side bridge is the key abstraction. Extension on Firefox/Zen, File System Access API on Chromium, manual fallback everywhere else. No platform-specific code in the app itself.
- **Extension as optional enhancement:** the hub must remain fully functional without the extension. Gate every extension-dependent UI element on `bridge.isAvailable()`.
- **Inbox as the universal delivery mechanism:** the per-board inbox is the single intake point for all external delivery, including move-to-board, extension tab sender, and Import Manager.
- **Tag inheritance before ignore-toggle:** the per-item "ignore inheritance" flag is intentionally deferred until the core system has been live long enough to understand edge cases.
