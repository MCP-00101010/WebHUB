# TODO for Morpheus WebHub

This file tracks outstanding work only. Completed changes and their validation belong in `CHANGELOG.md`.

## Reliability and Regression Monitoring

- Continue monitoring the persistence and extension-startup work from 0.11.68–0.11.80 for:
  - false “shared database changed on disk before this browser finished saving” warnings
  - delayed extension popup actions or relay injection failures
  - incorrect cache-recovery prompts
  - shared-database loading or transport errors
  - regressions during rapid extension Inbox sends or extension reloads
- Periodically verify the multiple-Hub-tab scenario, even though normal usage usually has only one Hub open.

## Improvements

### Bottom-aligned sidebar widget reordering

- Revisit upward drag-and-drop placement within the bottom-aligned widget group. The flicker-free full-widget preview is stable, but a widget currently cannot be moved above the group's existing top entry.
- Preserve the standard Hub destination-preview appearance without reintroducing the bottom-anchored geometry feedback loop fixed in 0.11.119.

### Background image performance

- Review loading and rendering with databases containing many tabs and background images.
- Look for avoidable rerenders, duplicate decoding paths, and retained image data beyond the existing import-time downscaling pass.

### Bookmark usage metadata

- Consider optional local-only fields such as `lastOpenedAt` and `openCount`, updated only when a bookmark is opened through the Hub.
- Explore read-only `Recent bookmarks` and `Most used bookmarks` Essentials views alongside the existing manual workflow.
- Include a way to clear or reset usage statistics if this ships.

### Tag inheritance

- Revisit a per-item “ignore inheritance” option after the current tag-inheritance system has had enough real-world use to reveal its edge cases.

## Browser and Bridge Backlog

- Add a Chromium bridge implementation backed by the File System Access API for Chrome and Edge.
- Prefer generic extension/native-host service capabilities so future widgets do not require frequent AMO re-signing for one-off integrations.

## Known Platform Limitations

- Firefox 153+ disables extension access to local files by default. File-based Hubs require “Access local files on your computer” under the extension’s Permissions in `about:addons`; 0.11.79 detects and explains this state.
- Firefox/Zen does not expose external bookmark-drag payload data during `dragover`, so the Hub cannot render an item-specific insertion preview until `drop`. External browser drags therefore use a dashed placeholder.
- Dragging a bookmark folder directly from Firefox/Zen imports only the first bookmark. The HTML drag-and-drop API exposes a single URL rather than the folder tree; full-folder import requires extension interception and relay support.

## Documentation, Localisation, and Code Health

Post-feature-freeze work, best done once the user-facing string surface is stable:

1. **Code structure** — reorganise source files for readability and add JSDoc-style comments to major functions and data types.
2. **Localisation** — extract user-facing strings into a locale file such as `en.json` and support additional drop-in language files.
3. **Documentation** — add a user-facing `README.md` covering installation, usage, file structure, and extension setup, plus a brief developer guide for the state schema, rendering pipeline, and bridge API.

## UI Implementation Guidelines

### Content modals

- Use the same panel tint and opacity source as sidebar cards while retaining the modal radius, border, and shadow.
- Keep inner sections flatter: transparent surfaces, subtle borders, reduced horizontal padding, and compact spacing.
- Centre top-level section labels using the existing uppercase muted-label style.
- Align content to the true text rail rather than icon or checkbox gutters.
- Match readonly and inherited field dimensions to editable fields unless there is a clear reason not to.
- Use italic input placeholders and a consistent `26px` height for visual radio controls.
- Apply this pattern to bookmark, folder, and similar create/edit flows before broader settings-panel restyles.

For modal tag sections, use this order:

1. Editable `Tags`, full width, without a redundant inline label.
2. `Shared`, when present, as a full-width block with a centred uppercase muted label.
3. `Inherited`, when present, as a full-width readonly block with the same label treatment.

Use spacing rather than decorative divider lines between these tag fields.

### Utility modals

- Use a real footer with consistent inset, padding, and a top divider for bottom action buttons.
- Use a shared header pattern with the modal title as a full-width bottom line in the global font colour.
- Use single-row headers for Search, Inbox, Tag Manager, and Trash.
- Use stacked headers when actions are present, currently Import Manager and Sets.
- Match the transparent/sidebar-opacity surface used by sidebar cards.
- Do not place transparent utility modals beneath the dark modal overlay.

## Architectural Constraints

- **Browser and OS agnosticism:** keep platform-specific work behind the page-side bridge. Firefox/Zen uses the extension, Chromium should use the File System Access API, and other environments retain manual fallback.
- **Disk persistence baseline:** large Hubs depend on the extension and native host. Browser storage is only a small fallback or emergency cache.
- **Bridge-gated enhancements:** gate extension-dependent actions on `bridge.isAvailable()` or `bridge.nativeIsAvailable()` and clearly warn when disk-backed storage is unavailable.
- **Inbox as universal intake:** every external delivery path should target a per-tab Inbox, including cross-board moves, extension sends, and Import Manager transfers.
