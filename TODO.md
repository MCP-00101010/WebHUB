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

## Product Feature Roadmap

Implement these in phases so the shared indexing, activity, bridge, and widget infrastructure can be reused by later work.

### Phase 2 — Workflow automation, sessions, and recovery

Status: completed in Hub 0.11.135 / Firefox extension 1.0.26, with the guided Automation builder and capture-to-Set handoff refined in Hub 0.11.136.

#### Inbox Automation Rules

- [x] Define ordered rules with conditions for hostname, URL/path text, title, source, tags, and duplicate state, plus actions for tagging, renaming, routing, URL normalization, and rejecting duplicates.
- [x] Reuse the same rule evaluator for per-tab Inbox deliveries and Import Manager batches while preserving Inbox as the universal external intake path.
- [x] Add a dry-run view showing matched rules, proposed actions, conflicts, and final destinations before committing a batch.
- [x] Prevent loops and ambiguous routing with deterministic rule order, one-pass defaults, explicit stop/continue behavior, and validation for missing or locked targets.
- [x] Add import/export for rule sets and tests covering order, multiple matches, nested destinations, deleted targets, retries, delivery deduplication, and Undo.

#### Browser Session Capture and Launch

- [x] Extend the bridge capability model to query open tabs, windows, tab groups, and recently closed sessions without exposing browser-only IDs to persisted Hub state.
- [x] Add capture flows for the active tab, current window, selected tabs, or a browser tab group, targeting a Set, a tab Inbox, or a new folder.
- [x] Add launch actions for a bookmark folder, Set, board tab, or saved session, with deduplication, configurable staggered opening, and confirmation above a safe tab-count threshold.
- [x] Where supported, recreate named and coloured browser tab groups; degrade to an ordered set of tabs when grouping is unavailable.
- [x] Add permission/status messaging and tests for missing permissions, private windows, unavailable grouping, duplicate URLs, partial failures, and active-Hub routing.

#### Backup Timeline and Selective Restore

- [x] Add native-host APIs that enumerate managed database backups with timestamp, size, version/hash, and integrity status while keeping paths contained within the configured backup directory.
- [x] Build a timeline UI that compares backup summaries: boards, tabs, bookmarks, folders, Sets, tags, settings, and schema version.
- [x] Support previewing and restoring one bookmark, folder subtree, board, Set, or the complete snapshot, with ID/reference repair and collision handling.
- [x] Create a safety backup before every restore, use the normal conflict-detection and atomic-write path, and never overwrite a newer shared snapshot silently.
- [x] Test corrupt backups, schema upgrades, missing references, partial restores, ID collisions, concurrent Hub tabs, and full rollback.

#### Scoped Export and Sharing

- [x] Add export scopes for a board, tab, folder, Set, Smart View result, or selected items using a versioned portable bundle format.
- [x] Allow optional inclusion of tags, referenced Sets, backgrounds, cached favicons, usage statistics, and other dependent assets.
- [x] Exclude credentials, native paths, browser session IDs, caches, and local-only runtime state by default; show a manifest of included and omitted data.
- [x] Add import preview with merge/copy/replace choices, ID remapping, duplicate detection, destination selection, and one-step Undo.
- [x] Test round trips, nested references, dynamic rules, missing dependencies, older bundle versions, and sanitized exports.

### Phase 3 — Extensibility

#### Widget and Integration SDK

Status: SDK foundation completed in Hub 0.11.137; substantial built-in extraction completed in Hub 0.11.143; shared-service migration completed in Hub 0.11.144; initial SDK-backed widget roadmap completed in Hub 0.11.145.

- [x] Move the substantial widgets into their own script/style modules before expanding the catalogue further, while preserving ordered classic-script loading until a supported module strategy is chosen. Calendar, Weather, Weather Map, ISS Tracker, Astronomy, RSS Reader, IP Info, and NASA APOD are now separated.
- [x] Formalize the widget descriptor contract: ID, name, category, description, allowed locations, defaults, settings schema, render/reload lifecycle, cleanup, migration, and responsive-size hints.
- [x] Add declared capabilities for network domains, extension relay, native host, secure credentials, filesystem paths, geolocation, notifications, timers, and local cache use.
- [x] Introduce shared scheduling, visibility-aware refresh, bounded networking, backoff, cache quotas, error states, settings validation, migrations, and teardown, and route the common widget framework seams through them.
- [x] Move widget-specific direct fetch, relay, secure-credential, animation-timer, and legacy cache paths onto shared SDK services. Existing browser-local caches migrate into SDK namespaces on first use.
- [x] Provide a development template, validation utility, fixture harness, and contract tests for registration, settings drafts, persistence boundaries, lifecycle cleanup, and unavailable capabilities.
- [x] Keep third-party integrations opt-in and distinguish trusted built-in widgets from future locally installed packages before supporting external widget code.

## Widget Roadmap

Build network- and native-dependent widgets on the shared SDK, cache, scheduler, and capability layers above; lightweight local widgets may land while that extraction is underway. Runtime samples, histories, and view preferences should remain local unless users explicitly choose to share them.

### Application Launcher and application shortcuts

- Decide whether launchable applications should be a first-class Hub item type alongside bookmarks or a dedicated widget, while retaining normal drag, move, tag, search, export, and layout behaviour.
- Allow users to create an application shortcut by dropping an application, approved executable path, or application link onto the Hub.
- Keep executable discovery and launches behind narrow native-host capabilities with explicit path approval, fixed open/reveal actions, missing-application handling, and platform-neutral page-side contracts.
- Define portable import/export behaviour that excludes unsafe machine-local paths by default and provides clear placeholders when a shortcut is unavailable on another system.

### Nexus Mods Tracker

- Confirm Nexus Mods API availability, authentication terms, rate limits, and redistribution constraints before implementation.
- Let users select one or more games and browse recently added and recently updated mods with compact metadata and direct Nexus Mods page links.
- Store the API key through the shared secure-credential flow, cache bounded provider responses locally, refresh conservatively, and handle unavailable games, deleted mods, rate limits, and provider outages.
- Keep the tracker read-only: do not download, install, endorse, or otherwise mutate Nexus Mods data.

### Universal Search settings and provider catalogue

- Replace the crowded inline provider editor with a compact provider list and an Add/Edit Provider sub-modal.
- Expand the built-in provider catalogue beyond the initial sites, including DuckDuckGo, Amazon, Wolfram Alpha, and other broadly useful search targets.
- Group or filter provider templates by purpose, keep custom HTTPS templates available, and preserve aliases, ordering, default-provider selection, and existing local recent-search privacy rules.
- Add usability and migration tests for the simplified modal, built-in catalogue additions, custom providers, duplicate aliases, and existing saved configurations.

### Focus Session

Status: completed in Hub 0.11.141.

- [x] Add Pomodoro and custom work/break sequences with pause, resume, skip, reset, and optional daily totals.
- [x] Allow a focus preset to open a chosen Set or folder at session start and optionally show upcoming Calendar conflicts without modifying calendar sources.
- [x] Keep active timers and history browser-local, recover an interrupted timer after reload, and avoid background throttling drift by calculating from absolute timestamps.
- [x] Add optional notifications behind an explicit permission and test reload recovery, sleep/wake, overdue timers, disabled notifications, and multiple widget instances.

### Service Monitor

Status: completed in Hub 0.11.145.

- [x] Support user-defined HTTPS endpoints with expected status, timeout, check interval, and optional text/JSON assertion using bounded relay requests.
- [x] Show current state, response time, last success, recent failures, and a compact local uptime history with manual refresh.
- [x] Add conservative schedules, exponential backoff, visibility awareness, and optional notifications without persisting monitoring samples to the shared database.
- [x] Test CORS fallback, redirects, certificates/network errors, rate limiting, offline state, secret-free configuration, and widget teardown.

### System Monitor

Status: completed in Hub 0.11.145.

- [x] Add narrowly scoped native-host endpoints for CPU, memory, disk, network, uptime, battery, and platform metadata, returning only requested metrics.
- [x] Provide configurable metric cards, warning thresholds, refresh intervals, and compact history graphs stored locally with bounded retention.
- [x] Gate the widget on native capability detection and clearly explain unavailable or permission-restricted metrics.
- [x] Test platform-specific omissions, multiple disks/adapters, sleep/wake, high-frequency refresh limits, native disconnects, and privacy boundaries.

### Git Workspace

Status: completed in Hub 0.11.145.

- [x] Let users explicitly approve local repository paths through the native picker and store only the selected configuration required to reopen them.
- [x] Expose branch, clean/dirty state, ahead/behind counts, last commit, staged/unstaged totals, and optional repository links without running arbitrary shell text.
- [x] Add actions to open the repository folder, configured terminal, or remote page through fixed native capabilities.
- [x] Test non-repositories, worktrees, detached HEAD, unavailable Git, large repositories, inaccessible paths, and containment of approved paths.

### Media Watchlist

Status: completed in Hub 0.11.145; episode-level series tracking added in Hub 0.11.150, tabbed season navigation in Hub 0.11.151, settings-based title management in Hub 0.11.152, multi-community Fandom links in Hub 0.11.153, episode wiki lookup in Hub 0.11.154, localized episode lookup in Hub 0.11.155, canonical wiki-language resolution in Hub 0.11.156, and persistent local view state in Hub 0.11.157.

- [x] Define provider-neutral watchlist records for films and series, including provider ID, watched state, progress, rating, notes, and notification preference.
- [x] Add an optional metadata provider through the shared credential/network layer with local caching, rate-limit handling, bounded payloads, and manual matching.
- [x] Surface upcoming seasons, episodes, and releases through both the widget and an optional read-only Calendar source.
- [x] Support import/export independently of provider availability and test remakes/duplicate titles, timezone boundaries, missing metadata, provider outages, and cache expiry.
- [x] Add lazy-loaded TMDB season and episode browsing, aired-episode checkboxes, season-wide watched controls, specials visibility, progress summaries, and next-episode guidance while keeping provider metadata in the local cache.
- [x] Link each title to multiple Fandom communities, including language-specific editions, with verified community URLs, per-community article search, labels, ordering, a preferred source, and a compact card menu.
- [x] Add episode-row context menus that search every linked wiki using the episode title or a season/episode identifier.
- [x] Localize episode lookup terms through TMDB for each wiki language, cache only compact translated names locally, and fall back to a language-neutral episode identifier when no translation exists.
- [x] Restore expanded title details, selected season tabs, and Specials visibility after Hub reloads using bounded browser-local view state.

### Recent Downloads and Files

Status: completed in Hub 0.11.145.

- [x] Add native capabilities for user-approved directories with bounded recent-file enumeration, safe metadata, and fixed open/reveal actions.
- [x] Provide filters for directory, file type, age, and result count, with clear missing-path and permission states.
- [x] Keep recent-file results local, avoid recursively indexing unapproved locations, and never execute files through arbitrary command strings.
- [x] Test renamed/deleted files, inaccessible directories, multiple roots, network drives, large folders, path containment, and native disconnects.

### Calculator and Converter

Status: completed in Hub 0.11.139; astronomical distance and bit conversion added in Hub 0.11.140.

- [x] Implement a local expression parser without `eval`, covering arithmetic, percentages, memory/history, and copyable results.
- [x] Add unit, date/duration, storage, temperature, angle, and time-zone conversions with explicit source and target units.
- [x] Support column and sidebar layouts plus optional command-palette evaluation using the same parser.
- [x] Test precedence, invalid input, locale decimal handling, precision, extreme values, daylight-saving transitions, and copy behavior.

### Saved Sessions

Status: completed in Hub 0.11.142.

- [x] Build on Browser Session Capture and Launch to list named sessions with tab count, group colour, last launched time, and a small favicon preview.
- [x] Add create, replace, rename, duplicate, launch, append-current-tabs, and delete actions with safe large-session confirmation.
- [x] Store portable URL/title/group metadata in the Hub while keeping transient browser tab/window IDs local to the extension runtime.
- [x] Test stale favicons, duplicate URLs, unsupported grouping, missing permissions, partial launch failure, and cross-browser degradation.

### Universal Search Launcher

Status: completed in Hub 0.11.145.

- [x] Add configurable search providers with name, keyword alias, query URL template, icon, and default-provider selection.
- [x] Match Hub bookmarks, boards, tabs, folders, Sets, tags, and command-palette actions locally before offering an external search.
- [x] Support aliases such as `g`, `yt`, or `imdb`, URL detection, direct navigation, keyboard-only operation, and optional recent searches stored locally.
- [x] Sanitize templates and queries, require HTTPS by default, and test reserved aliases, duplicate providers, malformed templates, encoded characters, and empty input.

### Translator

Status: completed in Hub 0.11.158; strict Firefox `file://` startup was moved to lazy in-page execution in Hub 0.11.161 after worker fallbacks remained unreliable, and text interaction was corrected in Hub 0.11.162.

- [x] Add English-to-German and German-to-English translation with Mozilla's Bergamot WASM engine, running entirely in a dedicated local worker.
- [x] Download each language model only on demand through a fixed Firefox-extension allowlist, verify every asset with SHA-256, and store it in a quota-limited browser-local IndexedDB cache.
- [x] Keep translation text and history out of the shared Hub database, default to no local text retention, and expose remembered text and recent history only as explicit per-widget options.
- [x] Add responsive board/sidebar layouts, direction swapping, copy/clear controls, keyboard translation, model install/remove management, download progress, and offline/privacy status.
- [x] Test model manifests and relay boundaries, WASM integrity, binary cache isolation/quota handling, persistence privacy defaults, responsive integration, and a real English-to-German Bergamot inference.

## Suggested Delivery Order

1. Saved Sessions completed in Hub 0.11.142.
2. Focus Session completed in Hub 0.11.141. Calculator and Converter completed in Hub 0.11.139 and expanded in Hub 0.11.140.
3. Widget and Integration SDK extraction plus Service Monitor, System Monitor, Git Workspace, Media Watchlist, Recent Downloads and Files, and Universal Search Launcher completed in Hub 0.11.145.
4. Private local Bergamot translation completed in Hub 0.11.158.

## Browser and Bridge Backlog

- Keep Firefox/Zen plus the native host as the active browser-integration and persistence target.
- Prefer generic extension/native-host service capabilities so future widgets do not require frequent AMO re-signing for one-off integrations.

### Deferred compatibility — Chromium bridge

This is a low-priority compatibility update for a possible future need, not part of the active delivery roadmap.

- Revisit only when Chromium support is requested or there is a concrete Chrome/Edge use case to validate.
- Define a browser-neutral storage capability interface matching the existing load, version/hash, conflict, backup, and atomic-save semantics.
- Add a Chromium implementation using the File System Access API where available, with user-activation-aware file selection and clear handling when a file handle cannot be retained.
- Preserve the Firefox/Zen extension plus native-host path and the browser-only/manual fallback rather than making Chromium capabilities a universal assumption.
- Test Chrome and Edge startup, permission loss, external file changes, concurrent tabs, large chunked snapshots, recovery prompts, and migration between bridge implementations before any release.

## Known Platform Limitations

- Firefox 153+ disables extension access to local files by default. File-based Hubs require “Access local files on your computer” under the extension’s Permissions in `about:addons`; 0.11.79 detects and explains this state.
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

- **Browser and OS agnosticism:** keep platform-specific work behind the page-side bridge. Firefox/Zen plus the native host is the current target; possible future Chromium support may use the File System Access API, while other environments retain manual fallback.
- **Disk persistence baseline:** large Hubs depend on the extension and native host. Browser storage is only a small fallback or emergency cache.
- **Bridge-gated enhancements:** gate extension-dependent actions on `bridge.isAvailable()` or `bridge.nativeIsAvailable()` and clearly warn when disk-backed storage is unavailable.
- **Inbox as universal intake:** every external delivery path should target a per-tab Inbox, including cross-board moves, extension sends, and Import Manager transfers.
