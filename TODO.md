# TODO for Morpheus WebHub

## Theme Settings

- we can save the current theme... however we have actually no way of editing theme colors in the Hub. Theme Editor is needed inside the Theme Settings.

## Inbox Model Cleanup

- stop treating inbox as a hidden compatibility column inside normal tab columns
- move inbox to an explicit tab-owned field such as `tab.inbox`
- update inbox counts, badges, and indicators to read from the explicit tab inbox model
- preserve folder structure and affordances cleanly if/when Import Manager gains drag-and-drop delivery later

## Sets

- when deleting a set it should show up in the trash

## Drag and Drop

- Known limitation: when dragging a bookmark directly from the browser (Firefox/Zen) into the Hub, no item-specific preview can be rendered during the drag. The HTML DnD API does not allow reading `dataTransfer` payload during `dragover`; only on `drop`. A dashed-outline placeholder is shown instead. A proper preview would require browser extension integration.
- Known limitation: dragging a bookmark folder from Firefox/Zen only imports the first bookmark, not the folder structure. The HTML DnD API only exposes `text/x-moz-url` / `text/uri-list` as a single URL for browser bookmark drags. Full folder import would require the Firefox extension to intercept the drag and relay the bookmark tree.

## Firefox Extension / Bridge

- Add a generic secret-storage bridge so API keys are kept out of hub state, exports, and the shared JSON database. Use OS-backed storage where available (Windows Credential Manager, Linux Secret Service/keyring), with a clearly labeled fallback only if no secure store exists.
- Prefer adding generic extension/native-host capabilities for service integrations up front (for example secret get/set and other reusable bridge actions) so future widgets do not force frequent AMO re-signing for one-off extension changes.
- Add background asset management: when a tab background image is picked from disk, copy it into a managed sibling assets folder and store a stable relative path instead of inflating the JSON with data URLs.
- Add theme file lifecycle support beyond write-only save: disk delete/update/refresh should stay in sync with in-app theme state.
- Chromium shim: same bridge interface backed by File System Access API for Chrome/Edge.

## Tag Manager

- when clicking on a tag, we should be able to rename it.

## Documentation, Localization & Code Health

Post-feature-freeze work, best done once the string surface is stable:

1. **Code restructuring** — reorganise source files for readability; add JSDoc-style comments to all major functions and data types.
2. **Localisation (i18n)** — extract all user-facing strings into a locale file such as `en.json`; wire a locale-loader so additional language files can be dropped in.
3. **Documentation** — user-facing `README.md` covering installation, usage, file structure, and extension setup; brief developer guide covering state schema, rendering pipeline, and bridge API.

## Cross-Cutting Notes

- **Browser / OS agnosticism:** the page-side bridge is the key abstraction. Extension on Firefox/Zen, File System Access API on Chromium, manual fallback everywhere else. No platform-specific code in the app itself.
- **Extension as optional enhancement:** the hub must remain fully functional without the extension. Gate every extension-dependent UI element on `bridge.isAvailable()`.
- **Inbox as the universal delivery mechanism:** the per-tab inbox is the single intake point for all external delivery, including move-to-board, extension tab sender, and Import Manager.
- **Tag inheritance before ignore-toggle:** the per-item "ignore inheritance" flag is intentionally deferred until the core system has been live long enough to understand edge cases.
