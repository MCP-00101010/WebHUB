# TODO for Morpheus WebHub

## Load/Save Database

- monitor the 0.11.68 persistence changes and 0.11.69–0.11.80 extension-startup follow-ups for any remaining false "shared database changed on disk before this browser finished saving" warnings, delayed popup actions, relay injection failures, cache-recovery prompts, or shared-load transport errors, especially around rapid extension inbox sends and extension reloads
- verify the multi-tab regression scenario periodically even though normal usage usually has only one hub open

## Known Bugs/Issues

- no currently open code issues; Firefox 153+ now disables extension access to local files by default, so file-based hubs require “Access local files on your computer” under the extension's Permissions in `about:addons` (0.11.79 detects and explains this state)

## Improvements

- ✓ Folder titles/dividers and transient Inbox/Import Manager lock removal completed 2026-08-03. See [0.11.81] in CHANGELOG.
- background image performance and memory pass
  - continue reviewing the wider background image loading/rendering path for databases with many tabs that have backgrounds.
  - follow up beyond the current import-time downscaling pass if there are still avoidable rerenders, duplicate decoding paths, or retained image data causing pressure.
- lightweight bookmark usage metadata
  - add optional local-only bookmark usage fields such as `lastOpenedAt` and `openCount`, updated only when bookmarks are launched through the hub.
  - explore generated Essentials alternatives such as `Recent bookmarks` and `Most used bookmarks` as read-only usage-driven views alongside the current manual Essentials workflow.
  - include a way to clear/reset usage stats if this ships.

## Dynamic Sets and Folders

- ✓ *Completed 2026-05-09*
- See [0.11.58] in CHANGELOG.

## Drag and Drop

- ✓ Multi-selected Inbox/Import Manager bookmark dragging, full-selection cursor/insertion previews, and direct tab-name Inbox drops completed 2026-08-03. See [0.11.81]–[0.11.84] in CHANGELOG.
- Known limitation: when dragging a bookmark directly from the browser (Firefox/Zen) into the Hub, no item-specific preview can be rendered during the drag. The HTML DnD API does not allow reading `dataTransfer` payload during `dragover`; only on `drop`. A dashed-outline placeholder is shown instead. A proper preview would require browser extension integration.
- Known limitation: dragging a bookmark folder from Firefox/Zen only imports the first bookmark, not the folder structure. The HTML DnD API only exposes `text/x-moz-url` / `text/uri-list` as a single URL for browser bookmark drags. Full folder import would require the Firefox extension to intercept the drag and relay the bookmark tree.

## Firefox Extension / Bridge

- ✓ Extension Board/Tab targeting with a remembered selection completed 2026-08-03. See [0.11.81] in CHANGELOG.
- Extension/native-host persistence work began in [0.11.66]; the relay and shared-database reliability follow-ups are tracked through [0.11.80] in CHANGELOG.
- Prefer generic extension/native-host capabilities for service integrations up front so future widgets do not force frequent AMO re-signing for one-off extension changes.
- Chromium shim: same bridge interface backed by File System Access API for Chrome/Edge.

## Documentation, Localization & Code Health

Post-feature-freeze work, best done once the string surface is stable:

1. **Code restructuring** — reorganise source files for readability; add JSDoc-style comments to all major functions and data types.
2. **Localisation (i18n)** — extract all user-facing strings into a locale file such as `en.json`; wire a locale-loader so additional language files can be dropped in.
3. **Documentation** — user-facing `README.md` covering installation, usage, file structure, and extension setup; brief developer guide covering state schema, rendering pipeline, and bridge API.

## UI Pattern Notes

- **Content modal styling rule:** create/edit content modals should visually follow the live UI transparency language. Use the same panel tint/opacity source as sidebar cards for the modal shell, keep radius/border/shadow so it still reads as a focused layer, then make inner content sections flatter:
  - transparent inner sections instead of heavy nested cards, but keep a subtle border so complex modals still retain structure
  - reduced horizontal padding inside those sections
  - centered top-level section labels using the existing uppercase muted label style
  - compact spacing between title input, sections, and actions
  - content aligned to the true text rail, not to icon/checkbox gutters
  - readonly/inherited fields should match the width and height of editable fields unless there is a clear reason not to
  - input placeholder text should be italic by default
  - visual radio-button controls should use a consistent `26px` height across the UI
- **Tag card order/layout rule for content modals:** when a create/edit modal has a tag section, use this presentation order and structure:
  - primary editable `Tags` field first, spanning full width with no redundant inline `Tags` label in front of it
  - `Shared` field next, if present, shown as its own full-width block with a centered, uppercase muted label above it
  - `Inherited` field after `Shared`, if present, also shown as its own full-width readonly block with the same centered, uppercase muted label style
  - avoid decorative divider lines between `Tags` / `Shared` / `Inherited`; use spacing and label treatment instead
- **Utility modal footer rule:** utility modals should use a real footer area for their bottom action buttons, not rely on parent panel padding. The footer should have consistent inset/padding and a top divider line across all utility modals.
  - Utility modals currently include: `Search`, `Inbox`, `Import Manager`, `Sets`, `Tag Manager`, and `Trash`.
- **Utility modal header rule:** utility modals should use one shared header pattern, with the modal title styled as a full-width title line at the bottom of the header, using the global font color and a divider line underneath.
  - Use a single-row header variant for simple utility modals (`Search`, `Inbox`, `Tag Manager`, `Trash`).
  - Use a stacked header variant when header actions are present (`Import Manager`, `Sets`), with actions above and the title line below.
  - Utility modal shells should use the same sidebar-opacity-based panel surface as sidebar cards and the other transparent utility panels.
  - Utility modals that are meant to share this transparent/sidebar-opacity look should not sit under the dark modal overlay; otherwise the overlay will make them read denser than the other utility panels.
- Apply this rule to create/edit content modals first (bookmark, folder, similar edit/create flows) before considering broader settings-panel restyles.

## Cross-Cutting Notes

- **Browser / OS agnosticism:** the page-side bridge is the key abstraction. Extension on Firefox/Zen, File System Access API on Chromium, manual fallback everywhere else. No platform-specific code in the app itself.
- **Extension/native host as persistence baseline:** large hubs depend on the extension + native host for reliable disk-backed storage. Browser storage may remain as a small fallback/emergency cache, but full database persistence should not rely on `localStorage` or extension `storage.local`.
- **Bridge-gated enhancement UI:** gate extension-dependent actions on `bridge.isAvailable()` / `bridge.nativeIsAvailable()` and clearly warn when disk-backed storage is unavailable.
- **Inbox as the universal delivery mechanism:** the per-tab inbox is the single intake point for all external delivery, including move-to-board, extension tab sender, and Import Manager.
- **Tag inheritance before ignore-toggle:** the per-item "ignore inheritance" flag is intentionally deferred until the core system has been live long enough to understand edge cases.
