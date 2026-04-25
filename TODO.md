# TODO for Morpheus WebHub

## Optimization

- Auto-export on a schedule, such as a daily JSON backup written to Downloads.

## Customization

- Simplify Customization. Change Style settings modal:
    - create a global settings section on top. it needs options for font sizes (small, medium, large - give it sensible presets. Hub Name, Board Names, Collection Names should just be slighly larger.) & font color. 
    - add a toggle to get font color from theme settings - overrides global font color if enabled.
    - move all other style settings related options into an "advanced settings" section below global settings. add a toggle to "show advanced settings" in global settings.
    - add a checkbox to every advanced settings section next to their name, when activated these settings override global settings.
 

## Widgets

- Weather widget with current conditions and configurable location.
- News feed / RSS widget that fetches and displays headlines from a feed URL.
- Search bar widget for search engines.
- Search bar widgets for specific sites such as Amazon, eBay, Reddit, etc.

## Drag and Drop

- Known limitation: when dragging a bookmark directly from the browser (Firefox/Zen) into the Hub, no item-specific preview can be rendered during the drag. The HTML DnD API does not allow reading `dataTransfer` payload during `dragover`; only on `drop`. A dashed-outline placeholder is shown instead. A proper preview would require browser extension integration.
- Known limitation: dragging a bookmark folder from Firefox/Zen only imports the first bookmark, not the folder structure. The HTML DnD API only exposes `text/x-moz-url` / `text/uri-list` as a single URL for browser bookmark drags. Full folder import would require the Firefox extension to intercept the drag and relay the bookmark tree.

## Firefox Extension / Bridge

- Chromium shim: same bridge interface backed by File System Access API for Chrome/Edge.
- Watch for external file changes, such as Dropbox/OneDrive sync, and prompt the user to reload.
- Configurable paths: path stored as a top-level field in the JSON itself, not in browser extension storage. A bootstrap `config.json` next to the native host binary holds the initial/fallback path. The hub settings panel exposes the path field when `bridge.isAvailable()`; the extension popup shows the resolved path read-only.

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
