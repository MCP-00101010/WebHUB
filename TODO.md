# TODO for Morpheus WebHub

## Optimization

- Auto-export on a schedule, such as a daily JSON backup written to Downloads.

## UI

- Trash, Search, Inbox and Global Settings Modals should use the same layout/css for their headers as the edit/create modals. (use bookmark modal for reference)
- footer divider line in navpane should follow global divider line style settings.

## Widgets



## Drag and Drop

- Known limitation: when dragging a bookmark directly from the browser (Firefox/Zen) into the Hub, no item-specific preview can be rendered during the drag. The HTML DnD API does not allow reading `dataTransfer` payload during `dragover`; only on `drop`. A dashed-outline placeholder is shown instead. A proper preview would require browser extension integration.
- Known limitation: dragging a bookmark folder from Firefox/Zen only imports the first bookmark, not the folder structure. The HTML DnD API only exposes `text/x-moz-url` / `text/uri-list` as a single URL for browser bookmark drags. Full folder import would require the Firefox extension to intercept the drag and relay the bookmark tree.

## Firefox Extension / Bridge

- Completed 2026-04-26: shared database path is now explicit instead of being derived from the `file://` page location.
- Completed 2026-04-26: Firefox and Zen can now point at the same browser-independent JSON database path.
- Completed 2026-04-26: the preferred shared path is now carried in the hub state as `databasePath`, with a bootstrap `config.json` next to the native host as the initial/fallback path.
- Completed 2026-04-26: the active shared path is exposed in Hub settings and shown read-only in the About tab and extension popup.
- Completed 2026-04-26: localhost support is now wired into the extension bridge so the hub can be served from a local webserver without losing extension features.
- Completed 2026-04-26: extension storage is now treated as a best-effort backup mirror only; the shared disk file is the primary persistence target when native messaging is available.
- Completed 2026-04-26: page-side bridge connection retries now recover from false "extension disconnected" startup races, and the native-host path picker now returns the selected save path reliably on Windows.
- Completed 2026-04-26: shared-disk polling now detects external JSON changes from the other browser or sync tools and auto-reloads or prompts safely depending on whether this tab has newer unsynced edits.
- Completed 2026-04-26: stale-write protection now blocks silent cross-browser clobbering by comparing file versions before every shared-disk save.
- Completed 2026-04-26: file-version / modified-time metadata is now checked before save, with a user-visible reload flow when the disk changed since this tab last loaded or saved.
- Add background asset management: when a board background image is picked from disk, copy it into a managed sibling assets folder and store a stable relative path instead of inflating the JSON with data URLs.
- Add theme file lifecycle support beyond write-only save: disk delete/update/refresh should stay in sync with in-app theme state.
- Chromium shim: same bridge interface backed by File System Access API for Chrome/Edge.

## Compatibility / Portability / Readability

- Add native File System Access API support for Chromium browsers.
- Write user-facing documentation for installation, usage, extension setup, and file structure.
- Add localisation support.
- Restructure source files for readability.
- Add JSDoc comments for major functions and data types.

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
