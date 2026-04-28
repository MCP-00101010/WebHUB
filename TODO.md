# TODO for Morpheus WebHub

## Theme Settings

- we can save the current theme... however we have actually no way of editing theme colors in the Hub. Theme Editor is needed inside the Theme Settings.

## Load/Save Database

- occasionally the hub randomly detects "The shared database changed on disk before this browser finished saving to F:\Projects\Coding\Morpheus WebHub\extension\native\morpheus-webhub.json. Reload the latest shared copy now?". Never able to 100% reproduce this problem but mostly seems to occur when i make changes in quick succession. particular when changing/adding something and then going into an edit/create dialogue. the most occurrences of this problem are when adjusting the amount of speed dial slots in board settings

## Boards

- board UI: Board Title Bar, Speed Dial, Tab Bar and Sets Bar should all be inside the same UI container. just draw one outside box and place them all inside it rather than each of them being in their own containers.
- newly created boards come with an empty dummy board which the user needs to edit. instead create the board with no tabs. as we activate the new board automatically, just open the Create Tab Modal after a new board is create so the user can design the new tab straight away.
- move the "new tab" icon in the tab bar to left next to the last tab.
- create "tab settings" icon in the tab bar (align right) that opens the currently active tabs settings modal. 
- tabs in the tab bar don't need to show tab icon in front of them.
- tags between Boards and Tabs seem to overlap. when adding user defined or shared tags to a board, they disappear and the boards seems to get its tags from the currently active tab instead. double-check tag logic and check that children inside boards inherit their tags correctly.
- boards / tabs settings for "pass-on-to-children" and "strip-on-move" dont persist. they both are enabled by default particular "strip-on-move" occassionally reverts back to disabled by itself. potentially another issue with the settings not properly split between board and board-owned tabs?
- after moving a bookmark it to a tab inbox it randomly got an inherited tag called tag-1777384364108-rf10. this might be related to the issue listed before this one.
- locking/unlocking boards in the sidebar currently does not work. the icon appears when hoovering over board name but clicking it does nothing.
- when deleting an inactive tab in the tab pane via context menu, the currently active tab changes. not needed. stay on active tab. active tab only needs to change when we delete the currently active tab.

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
