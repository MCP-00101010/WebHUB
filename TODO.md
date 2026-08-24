# TODO for Morpheus WebHub

This file tracks outstanding work only. Completed changes and their validation belong in `CHANGELOG.md`.

## Reliability and Regression Monitoring

- Continue monitoring the persistence and extension-startup work from 0.11.68–0.11.80 and the hardened 0.11.125–0.11.145 / extension 1.0.27 bridge for:
  - false “shared database changed on disk before this browser finished saving” warnings
  - delayed extension popup actions or relay injection failures
  - incorrect cache-recovery prompts
  - shared-database loading or transport errors
  - regressions during rapid extension Inbox sends or extension reloads
- Periodically verify the multiple-Hub-tab scenario, including active-tab routing and session-token renewal after extension or Hub reloads.

## Improvements

### Bottom-aligned sidebar widget reordering

- Revisit upward drag-and-drop placement within the bottom-aligned widget group. The flicker-free full-widget preview is stable, but a widget currently cannot be moved above the group's existing top entry.
- Preserve the standard Hub destination-preview appearance without reintroducing the bottom-anchored geometry feedback loop fixed in 0.11.119.

### Background image performance

- Review loading and rendering with databases containing many tabs and background images.
- Look for avoidable rerenders, duplicate decoding paths, and retained image data beyond the existing import-time downscaling pass.

### Tag inheritance

- Revisit a per-item “ignore inheritance” option after the current tag-inheritance system has had enough real-world use to reveal its edge cases.

## Widget Roadmap

Future network- and native-dependent widgets should use the existing shared SDK, cache, scheduler, and capability layers. Runtime samples, histories, and view preferences should remain local unless users explicitly choose to share them.

### Application Launcher follow-ups

- Add bounded installed-application discovery after the explicit picker workflow has had real-world use: Start Menu entries on Windows, application bundles on macOS, and desktop entries on Linux.
- Improve native icon extraction on macOS and Linux while retaining the current generic icon fallback and portable unbound placeholders.

### Daily Briefing

- Combine today's Calendar events, Weather, Global Hazards, Football Tracker matches, Media Watchlist releases, RSS headlines, tasks, and service warnings in one configurable summary.
- Read from existing widget caches and shared services instead of repeating provider requests, and degrade cleanly when a source widget or credential is unavailable.
- Allow users to choose sections, ordering, item limits, and notification timing while keeping private source data browser-local where required.

### Widget presets and templates

- Let users save a configured widget as a reusable preset, create new instances from presets, and duplicate presets into another board or tab.
- Define whether portable configuration, local-only preferences, credentials, caches, and runtime state are copied, referenced, or omitted.
- Include optional presets in scoped exports with migration, naming-conflict, unavailable-capability, and Undo coverage.

### Shared profiles and variables

- Add reusable profiles for values such as Home/Work location, favourite team, timezone, units, and other settings shared by multiple widgets.
- Let widget settings reference a profile value or override it locally, with a clear preview of which widgets will be affected by profile edits.
- Keep credentials and machine-local paths outside ordinary shared variables and define safe import/export behaviour for missing profiles.

### Clipboard and Snippet Shelf

- Store pinned text, links, code snippets, and explicitly pasted clipboard entries with search, tags, copy actions, and optional expiry.
- Keep clipboard content browser-local by default; require explicit opt-in for any automatic capture supported by the extension or native host.
- Bound history size and retention, exclude sensitive fields where detectable, and test clipboard-permission denial, rich-text sanitisation, and widget teardown.

### Habit and Routine Tracker

- Support daily and weekly habits, target counts, streaks, compact history, and optional reminders using the existing notification service.
- Allow routines to link to a Set, saved session, Focus preset, Calendar view, or fixed Hub command without duplicating those features.
- Keep completion history local by default and test timezone changes, missed days, reminder recovery, duplicate notifications, and data export.

### Local transport departures

- Show favourite stops, upcoming bus/train departures, platform information, and disruption notices where a suitable regional API or GTFS feed is available.
- Design a provider-neutral adapter because coverage, authentication, live-data quality, and rate limits vary substantially by region.
- Cache conservatively, make location use optional, and provide clear scheduled-versus-live data and provider attribution.

### Offline Reading Queue

- Capture articles through the extension into a sanitised reading view with source URL, metadata, reading progress, and bounded optional offline content.
- Keep captured content and reading state local by default, enforce storage quotas, and provide per-item removal plus cache management.
- Test page-permission failures, paywalls, dynamic pages, unsafe markup, duplicate captures, unavailable images, and restoration after reload.

### Kiosk and display mode

- Add a full-screen read-only presentation mode for one board or a rotating set of boards, with optional schedules and hidden editing controls.
- Pause or reduce expensive refresh and animation work when a board is not visible, and offer subtle movement options for burn-in mitigation.
- Provide an immediate secure exit, prevent accidental destructive actions, and test full-screen permission loss, sleep/wake, offline operation, and multi-monitor use.

## Browser and Bridge Backlog

- Keep Firefox/Zen plus the native host as the active browser-integration and persistence target.
- Prefer generic extension/native-host service capabilities so future widgets do not require frequent AMO re-signing for one-off integrations.

### Extension-required Hub migration

Make the current Firefox/Zen extension a required Hub component. The extension must become the sole authority for loading and saving the shared Hub database; the native host remains optional for disk-backed storage and native-only integrations. Removing browser-only operation must not remove or migrate intentionally browser-local widget data.

#### Target architecture

- Route every main-database load, save, import, reload, Inbox delivery, and recovery operation through the authenticated extension bridge.
- Use the native shared database when the native host and a database path are available; otherwise use a versioned extension-owned storage record rather than page `localStorage`.
- Add revision and content-hash metadata, compare-and-swap writes, an extension-wide serialized save queue, and change broadcasts to every registered Hub tab for both authoritative storage modes.
- Require each save to include the revision it loaded. Never report success until the authoritative target has accepted the snapshot.
- Keep platform-specific disk, credentials, filesystem, Git, and system-monitoring capabilities behind the optional native-host boundary.

#### Protected local widget and UI storage

- Retire only the full Hub snapshot key `morpheus-webhub-state` and its recovery metadata after migration; never use `localStorage.clear()` or broadly delete Morpheus-prefixed records.
- Preserve `morpheus-widget-sdk-cache:v1:*`, widget view state, histories, provider caches, local notification data, command recents, modal positions, explicit local opt-ins, and other intentionally browser-local records.
- Preserve the `morpheus-widget-sdk-assets-v1` IndexedDB database, including installed Translator models and other bounded binary assets.
- Keep widget cache ownership, quotas, expiry, instance cleanup, privacy boundaries, and the global meaningful-view-state persistence rule unchanged.
- Add migration tests that snapshot representative widget `localStorage` and IndexedDB data before cutover and prove it remains intact and usable afterward.

#### Secrets and credentials

- Preserve the existing stable global credential names, including NASA, TMDB, football-data.org, Sportmonks, API-Football, and Nexus Mods entries, and continue using Windows Credential Manager through the native host when available.
- Load and initialise secrets only after the authoritative Hub database has been loaded. Do not clear a legacy database or per-widget key until writing and rereading its secure credential succeeds.
- If the native host is unavailable, retain existing in-memory and legacy values without clearing or overwriting stored credentials. Rehydrate secrets and refresh affected widgets when the native host reconnects.
- Continue excluding secrets from ordinary exports, extension storage, diagnostics, caches, and migration summaries.
- Test existing secure keys, legacy shared-database keys, old per-widget keys, failed secure writes, native-host loss during startup, reconnection, and export sanitisation.

#### Preparation and migration release

- Ship an intermediate release that adds the authoritative extension-storage protocol while browser-only startup is still temporarily available, and warn that the following release will require the extension.
- Detect legacy page snapshots. If no authoritative snapshot exists, copy the legacy data through the extension and verify its stored hash before marking migration complete.
- When page, extension, and native-disk snapshots differ, show bounded summaries and require an explicit choice; never silently overwrite divergent data.
- Create a native safety backup or downloadable recovery export before replacing authoritative data, and store a migration receipt with source, destination, revision/hash, and completion time but no private content.
- Retain the legacy page snapshot temporarily as read-only recovery data after successful migration, then remove it only in the later enforcement release.
- Test local-only, extension-only, disk-only, identical, divergent, corrupt, over-quota, interrupted, retried, and already-completed migrations.

#### Required-extension startup and runtime behaviour

- Before loading or rendering Hub data, wait for an authenticated extension handshake and verify the minimum extension version and baseline capabilities.
- When the extension is missing, outdated, disabled, or unable to access the local Hub file, show a dedicated blocking setup screen with Retry, precise installation/permission guidance, diagnostics, and a legacy-data export rescue action. Do not initialise an empty Hub behind it.
- If the extension disconnects during a session, keep the last rendered Hub available read-only, block mutations/imports/deliveries, preserve any in-flight unsaved snapshot in memory, and retry the connection automatically.
- On reconnection, compare authoritative revisions before retrying a save or reloading. Never silently fall back to page-database storage.
- Keep non-mutating actions such as opening an ordinary bookmark available where safe, and show a clear persistent connection/save state rather than transient notices alone.

#### Enforcement and cleanup release

- Remove browser-only startup, load, reload, save, local-cache promotion, and cache-versus-shared recovery paths after the migration release has been validated.
- Make `saveState()` always use the extension authority, route JSON import through the extension, and remove direct main-database writes from Settings and other page modules.
- Move authoritative external-change detection and multi-tab revision broadcasts into the extension; retain explicit conflict handling for in-flight local edits and native files changed by external tools.
- Replace browser-only/manual-fallback wording in Settings, About, setup guidance, project documentation, bridge comments, and architectural rules.
- Keep bridge-availability checks as runtime failure assertions and reconnect handling. Native-host-dependent features must remain individually capability-gated.

#### Cutover validation

- Test missing, disabled, outdated, late-installed, reloaded, and permission-restricted extensions, including Firefox local-file access changes.
- Test rapid edits, simultaneous Hub tabs, extension Inbox deliveries, extension/background restart during saves, stale revisions, duplicate requests, and reconnection with pending work.
- Test native-host disconnect/recovery, path changes, external disk edits, compare-and-swap conflicts, corrupt files, storage quota exhaustion, and backup restoration.
- Prove after cutover that the main Hub database is never loaded from or saved to page `localStorage`, while all intended widget-local storage and stored secrets continue to work.
- Run the complete JavaScript and native-host suites, migration fixtures, syntax checks, version alignment, extension manifest validation, and `web-ext lint` before each rollout release.

### Deferred compatibility — Chromium bridge

This is a low-priority compatibility update for a possible future need, not part of the active delivery roadmap.

- Revisit only when Chromium support is requested or there is a concrete Chrome/Edge use case to validate.
- Define a browser-neutral storage capability interface matching the existing load, version/hash, conflict, backup, and atomic-save semantics.
- Add a Chromium implementation using the File System Access API where available, with user-activation-aware file selection and clear handling when a file handle cannot be retained.
- Preserve the Firefox/Zen extension plus optional native-host path. Any future Chromium implementation must provide an equivalent authenticated, versioned storage authority rather than restoring browser-only/manual operation.
- Test Chrome and Edge startup, permission loss, external file changes, concurrent tabs, large chunked snapshots, recovery prompts, and migration between bridge implementations before any release.

## Known Platform Limitations

- Firefox 153+ disables extension access to local files by default. File-based Hubs require “Access local files on your computer” under the extension’s Permissions in `about:addons`; 0.11.79 detects and explains this state.
- Firefox/Zen intentionally withholds the absolute source path of files dragged from Windows Explorer. The Hub can create application items directly from readable `.url` files and allowlisted launcher URIs, but `.exe`, `.com`, and binary `.lnk` drops must use the native application picker so the approved device-local binding receives the real path. Image drops are unaffected because the Hub reads and saves a copy of their contents rather than retaining the source path.
- Firefox/Zen does not expose external bookmark-drag payload data during `dragover`, so the Hub cannot render an item-specific insertion preview until `drop`. External browser drags therefore use a dashed placeholder.
- Dragging a bookmark folder directly from Firefox/Zen imports only the first bookmark. The HTML drag-and-drop API exposes a single URL rather than the folder tree; full-folder import requires extension interception and relay support.

## Documentation, Localisation, and Code Health

Post-feature-freeze work, best done once the user-facing string surface is stable:

1. **Code structure** — continue decomposing the remaining large rendering and widget modules, and add JSDoc-style comments to major functions and data types. State-schema and widget-network responsibilities were split out in 0.11.125, followed by the Calendar implementation in 0.11.126–0.11.128.
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

- **Browser and OS boundaries:** keep platform-specific work behind the page-side bridge. Firefox/Zen is the active target and the extension is planned to become mandatory; the native host remains an optional capability boundary for disk, credentials, files, Git, and system integrations.
- **Authoritative persistence baseline:** after the extension-required migration, all main Hub database access must pass through the authenticated extension. Native disk is preferred for large Hubs; versioned extension storage may serve smaller non-native setups. Page storage remains reserved for explicitly local widget/UI data and migration recovery only.
- **Bridge-gated operation:** after cutover, the Hub must block database-backed operation without the required extension. Continue gating native-host-dependent features on `bridge.nativeIsAvailable()` and declared capabilities, with clear recovery guidance.
- **Inbox as universal intake:** every external delivery path should target a per-tab Inbox, including cross-board moves, extension sends, and Import Manager transfers.
