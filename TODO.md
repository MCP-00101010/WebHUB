# TODO for Morpheus WebHub

## Optimization

- Auto-export on a schedule, such as a daily JSON backup written to Downloads.

## UI

### Group A — Bug fixes

- [x] **Collection create/cancel** — `addCollection` creates the record before the modal opens; cancel still leaves the collection in state. Fix: defer `createCollection` to modal submit; cancel discards with no side-effects.
- [x] **Strip on leave default** — `cmAutoRemove` (strip shared tags on board removal) initialises unchecked. Default it to checked everywhere a parent object with shared tags is created or edited.
- [x] **Collection settings icon** — when a collection is active, the name-pane settings button opens board settings. Guard it: if `state.activeCollectionId` is set, open the collection edit modal instead.

### Group B — Modal presentation

- [x] **Bookmark modal URL section** — wrap the URL row in a `settings-section` with a "URL" label to match the visual style of other sections.
- [x] **Folder modal size** — folder create/edit modal stretches to full modal height. Constrain to `fit-content`; remove excess padding so it only shows name and any folder options.
- [x] **Widget modal tweaks** — remove `(optional)` from name placeholders; apply the same `fit-content` sizing fix; ensure all widget modals are draggable (see Group D).

### Group C — Name pane icons

- [ ] **Icon size + alignment** — reduce undo/redo/inbox/settings icons in the board name pane to match the sidebar settings icon size; anchor them top-right; reposition the inbox counter chips adjacent to the inbox icon.
- [ ] **Board settings icon in collection tab bar** — add a small settings button to the right end of the collection tab bar (aligned under the name-pane settings icon) that opens board settings for the active board.

### Group D — Major layout restructures

- [ ] **Create/edit board modal layout** — two-column layout: tags + speed dial on the left, opacity + background image on the right; show a background preview in the drop zone if an image is already set; shrink modal to fit content.
- [ ] **Draggable modals** — add `mousedown` drag handling on `.modal-card-header` to allow free repositioning of all edit/create modals.

## Current Bugs/Issues:

- ~~**Nav board deletion regression**~~ — Fixed v0.11.37. Root cause: `saveTrash()` threw `QuotaExceededError` when a board with a large background image was pushed to trash, aborting deletion before `deleteBoardAndNavItem` ran. See [0.11.37] in CHANGELOG.


## Widgets

- Weather widget with current conditions and configurable location.
- News feed / RSS widget that fetches and displays headlines from a feed URL.

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
