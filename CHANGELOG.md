# Changelog

All notable changes to Morpheus WebHub are documented here.
Format: `[version] — date` followed by Added / Changed / Fixed sections.

---

## [0.11.125] — 2026-08-05

### Added

- **Explicit persisted-state schema** — moved version-1 serialization and normalization into a dedicated schema module. Saved snapshots now omit redundant active-tab compatibility aliases, while loading repairs orphaned boards by restoring navigation entries instead of deleting their data.
- **Shared widget networking** — added bounded-fetch and Open-Meteo geocoding helpers with stale-response protection for weather, astronomy, and ISS requests.

### Changed

- **Transactional widget settings** — settings now edit a full title/config/data draft. Live previews remain visible while editing, Cancel restores every field, and Done creates one undoable persisted change without saving intermediate keystrokes.
- **Current project guide** — rewrote `PROJECT.md` around the actual state schema, rendering pipeline, extension bridge, native host, widget runtime, and validation workflow.

### Fixed

- **Search completeness** — persistent search indexing now covers every tab Inbox and the Import Manager, avoids duplicate dynamic-folder results, and preserves the correct context-menu behavior for Import Manager matches.
- **Interaction correctness** — Ctrl+Z/Ctrl+Y no longer intercept text-field editing; alpha tag chips receive their board context explicitly; external links use isolated window features; and duplicate classic-script helper declarations can no longer silently override one another.
- **Chunked-read consistency** — large database reads carry an expected file version through every chunk, reject mid-transfer changes or incomplete byte counts, and retry once from a fresh snapshot.
- **Widget lifecycle cleanup** — deleting widgets now clears their timers, runtime instances, pending requests, and browser-local caches. Unchanged MapLibre, ISS, column, and sidebar widget nodes survive unrelated Hub rerenders.
- **Path and theme handling** — extension path conversion preserves POSIX file paths, while native theme writes validate identifiers and remain contained within the configured theme directory.

### Security

- **Authenticated Hub relay sessions** — extension services now require the exact registered Hub tab, URL, and per-registration session token. Active-Hub routing is stable across multiple open Hub tabs, reloads renew the session, and inactive registrations no longer steal extension deliveries.

### Performance

- **Lighter persistence monitoring** — file polling no longer hashes unchanged databases, duplicate five-second timers are merged, and rapid saves coalesce backup creation within a short safety window.
- **Incremental rendering and search** — unchanged widgets reuse their DOM and live runtimes, while search data is rebuilt only after Hub mutations instead of on every query.
- **Bounded favicon work** — favicon discovery deduplicates by origin, limits fallback providers, prefers native/direct sources, and batches cache persistence.

### Tests

- Added regression coverage for global classic-script symbols, complete widget-setting rollback, Hub relay sessions, chunk-version enforcement, path conversion, theme containment, state-schema repair, render reuse, and lifecycle cleanup.
- Passed all 107 JavaScript regression tests, 7 native-host persistence tests, JavaScript syntax checks, and `web-ext lint` with no errors. The existing native Python-file notice and installer-shell-file warning remain.

## [0.11.124] — 2026-08-05

### Changed

- **Categorized widget library** — board and sidebar `Add widget` context menus now group widgets under `Personal & Productivity`, `Weather & Network`, `Space & Astronomy`, and `Content & Feeds`. Each group is ordered consistently and its widgets are sorted alphabetically.
- **Registry-driven organization** — widget definitions now own their category metadata. Future missing or unknown categories fall back to `Other`, while placement filtering continues to hide widgets that are not valid in the selected board or sidebar location.
- **Recursive context submenus** — context menus can now render nested submenu levels without closing their parent level. Every submenu is kept within the viewport and hovering a sibling clears only the deeper levels it supersedes.

### Tests

- Added regression coverage for all widget category assignments, board/sidebar filtering, alphabetical ordering, action prefixes, fallback-ready grouping, and recursive submenu rendering.
- Passed all 100 JavaScript regression tests.

---

## [0.11.123] — 2026-08-03

### Added

- **Sidebar widget controls** — sidebar widgets now expose the same hover/focus settings button as column widgets and show a reload button whenever their widget definition supports manual refresh. Sidebar settings retain placement controls, and action clicks remain excluded from widget dragging.

### Changed

- **Compact IP Info status** — combined the separate IP-check and speed-test metadata footers into one single-line status row. Checks performed together collapse to `IP + speed`, elapsed times use compact units, jitter remains visible, and source links are grouped at the right.
- **Shared widget actions** — column and sidebar widgets now use one settings/reload implementation so control labels, loading animation, and refresh behavior stay consistent.

### Tests

- Expanded IP Info and sidebar-widget regression coverage for the consolidated status line and shared settings/reload controls.
- Passed all 98 JavaScript regression tests.

---

## [0.11.122] — 2026-08-03

### Fixed

- **Cloudflare speed tests in file-based Hubs** — the vendored speed-test adapter now resolves absolute API URLs without passing Firefox's literal `"null"` `file://` origin to the URL constructor. Relative URLs fall back to the full page URL, allowing the same adapter to remain safe in both file and hosted Hubs.

### Tests

- Added a regression test reproducing Firefox's `file://` null-origin environment and verifying that the Cloudflare endpoint resolves successfully.
- Passed all 98 JavaScript regression tests.

---

## [0.11.121] — 2026-08-03

### Added

- **IP Info connection-speed measurements** — the IP widget can now show Cloudflare-measured download speed, upload speed, latency, and jitter. Measurements run unobtrusively on Hub load, after a detected public-IP change, or through the widget's manual reload action.
- **Local Cloudflare engine** — pinned `@cloudflare/speedtest` 1.13.0 and its MIT licence inside the Hub so the widget remains dependency-free at runtime.

### Changed

- **Bounded, local-only speed results** — automatic tests use a custom sequence capped at approximately 32 MB, omit the packet-loss phase, and never run merely because an unchanged IP reaches its normal refresh interval. Completed results are cached only in browser storage, outside the Hub database, and Cloudflare's final-results reporting endpoint is disabled.
- **Speed-test control** — IP Info settings can disable connection testing while leaving public-IP monitoring active.

### Tests

- Added regression coverage for Hub-load/manual speed requests, public-IP-change triggering, unchanged-IP suppression, bounded transfer size, disabled result reporting, local cache isolation, and the pinned browser asset.
- Passed all 97 JavaScript regression tests.

---

## [0.11.120] — 2026-08-03

### Changed

- **Consistent IP Info footer** — removed the IP widget's unique divider above its source and last-checked footer so it matches the footer treatment used by other widgets.

### Tests

- Added regression coverage ensuring the IP Info footer remains divider-free.
- Passed all 5 focused IP Info widget tests.

---

## [0.11.119] — 2026-08-03

### Fixed

- **Consistent bottom-widget drag preview** — reordering bottom-aligned sidebar widgets once again uses the same full-widget destination preview as drag-and-drop elsewhere in the Hub. Only the preview's height expansion animation is skipped in the bottom-anchored group, preventing its upward growth from moving the drop target back and forth through the cursor.

### Tests

- Updated sidebar drag regression coverage for full-height bottom-group previews without layout animation.
- Passed all 95 JavaScript regression tests.

---

## [0.11.118] — 2026-08-03

### Fixed

- **Flicker-free bottom reordering** — bottom-aligned sidebar widgets no longer insert a full-height destination clone while being reordered. The dragged widget remains visible in the cursor ghost, while a non-layout-changing accent line marks the destination above or below the target. This removes the target-geometry feedback loop that caused rapid preview oscillation.

### Tests

- Added regression coverage for clone-free bottom-widget destinations, stable group-end indicators, and absolutely positioned insertion feedback that does not alter widget geometry.
- Passed all 95 JavaScript regression tests.

---

## [0.11.117] — 2026-08-03

### Changed

- **Upward bottom-widget tolerance** — when a lower bottom-aligned widget is dragged upward, the target widget now uses a larger upper insertion zone. This makes placing the dragged widget above the current top item substantially easier without changing the existing downward-drop behaviour.

### Tests

- Added regression coverage for direction-aware bottom-widget insertion thresholds.
- Passed all 95 JavaScript regression tests.

---

## [0.11.116] — 2026-08-03

### Fixed

- **Bottom-widget reordering** — the rendered normal/bottom partition is now also applied to the in-memory navigation order before drag indices are calculated. Bottom-aligned widgets can therefore be reordered reliably instead of snapping back to their previous positions.
- **Stable bottom drag previews** — the flexible bottom spacing now belongs to a dedicated non-draggable group container rather than the first widget. Insertion previews remain inside the correct group, eliminating the layout feedback loop that caused flicker and jumps into the upper sidebar.
- **Placement-aware drops** — item-level drops stay within the dragged widget's normal or bottom placement group. Dragging through blank sidebar space also places the preview at the correct end of that group.

### Tests

- Expanded sidebar drag regression coverage for state-order normalisation, isolated bottom-group layout, placement matching, and group-aware end previews.
- Passed all 95 JavaScript regression tests.

---

## [0.11.115] — 2026-08-03

### Added

- **Bottom-aligned sidebar widgets** — top-level sidebar widgets now offer an `Align at sidebar bottom` setting. Enabled widgets form a group at the bottom of the available sidebar space, which is particularly useful for persistent information such as IP Info.

### Changed

- **Reorderable bottom group** — bottom placement does not fix widgets to absolute coordinates. The group preserves the underlying sidebar order, so multiple bottom-aligned widgets can still be rearranged with the existing drag-and-drop controls. When the sidebar contents overflow, the group participates in normal scrolling.

### Tests

- Added regression coverage for the sidebar-only placement option, stable normal/bottom partitioning, relative ordering within the bottom group, and automatic bottom spacing.
- Passed all 95 JavaScript regression tests.

---

## [0.11.114] — 2026-08-03

### Changed

- **IP address-family placement** — when enabled, the IP Info widget now shows `(IPv4)` or `(IPv6)` immediately after the public address instead of placing it in the location details line.

### Tests

- Added regression coverage for the inline address-family label and its secondary typography.

---

## [0.11.113] — 2026-08-03

### Added

- **Sidebar IP Info** — IP Info can now be added to the navigation sidebar and refreshes its browser-local result correctly in either widget location.

### Changed

- **Consistent small-widget presentation** — Clock and Countdown now use the same complete markup, typography, date/label content, and timing behaviour in the sidebar as they do in a board column. The sidebar widget host now gives these regular widget layouts the full available width.
- **Sidebar widget interaction** — interactive widget surfaces no longer accidentally begin a sidebar drag, matching their behaviour in board columns.

### Tests

- Added regression coverage for IP Info sidebar eligibility and refresh, full Clock and Countdown sidebar rendering, context-aware timers, full-width hosting, and interactive drag guards.
- Passed all 94 JavaScript regression tests.

---

## [0.11.112] — 2026-08-03

### Added

- **IP Info widget** — added a compact VPN-check widget showing the browser's current public IP address, approximate country with emoji flag, and optional city, network provider, ASN, and IPv4/IPv6 type.
- **Change indication and refresh controls** — the widget checks once on each Hub load, refreshes every 15 minutes by default, supports intervals from five minutes to manual-only, provides an immediate reload action, and highlights a detected IP-address change.
- **Resilient free data sources** — ipwho.is supplies the no-key geolocation result; if it is unavailable, ipify provides an IP-only fallback with a clear partial-result notice.

### Changed

- **Local-only network state** — IP results, timestamps, and refresh status stay in browser-local storage and never alter the shared Hub database.

### Tests

- Added coverage for response normalization, flag generation, session refresh, local caching, VPN-relevant fields, ipify fallback, settings, and widget presentation.
- Passed all 91 JavaScript regression tests.

---

## [0.11.111] — 2026-08-03

### Fixed

- **ISS info-line persistence** — the ISS globe now remembers whether its map attribution/info line is open or closed when the widget is moved, recreated, or the Hub is reloaded. The preference remains browser-local with the globe camera and Focus ISS state.

### Tests

- Added regression coverage for capturing and restoring the ISS attribution control state without changing the Hub database.
- Passed all 86 JavaScript regression tests.

---

## [0.11.110] — 2026-08-03

### Changed

- **RSS tab spacing** — added breathing room between the feed-tab buttons and their horizontal scrollbar.

### Tests

- Added regression coverage for the RSS tab-strip scrollbar spacing.

---

## [0.11.109] — 2026-08-03

### Changed

- **Roomier RSS settings** — RSS Reader settings now use a wider responsive panel with full-width name and URL fields, stacked mobile rows, and an always-visible outlined remove-feed button.
- **Visible RSS widget titles** — an RSS Reader now displays its configured widget title above the feed tabs; untitled readers retain the previous compact layout.

### Tests

- Added regression coverage for the RSS-specific settings width, responsive feed editor, visible remove action, and optional widget heading.
- Passed all 85 JavaScript regression tests.

---

## [0.11.108] — 2026-08-03

### Added

- **Tabbed RSS/Atom reader** — added a configurable feed reader widget with an aggregated chronological **All** tab, a **Starred** tab, and one tab per feed. Feeds can be named, reordered, removed, searched, refreshed, and displayed in compact or expanded layouts with optional article images.
- **Local reading state** — unread status, favourites, active tab, search text, and cached articles remain browser-local so feed traffic and article history do not enlarge or churn the shared Hub database.

### Changed

- **Extension 1.0.21 feed relay** — the Hub first fetches feeds directly, then uses a tightly bounded extension relay when browser CORS rules block the request. Relay requests are restricted to Hub pages, omit cookies, time out after 15 seconds, and reject responses over 2 MiB.
- **Combined-feed cleanup** — the aggregated and starred views sort articles chronologically and collapse duplicates, including links that differ only by common tracking parameters.

### Tests

- Added RSS/Atom parser, tab aggregation, deduplication, favourites, local-cache, CORS fallback, permission, and relay access-control regression coverage.
- Validated parsing against the live BBC News RSS feed, passed all 85 JavaScript regression tests, and passed extension manifest lint with no errors.

---

## [0.11.107] — 2026-08-03

### Fixed

- **Clickable north reset** — replaced MapLibre's apparently inert stock compass with an explicit Hub control that resets globe bearing, pitch, and roll. Right-button dragging can now rotate the bearing, making the reset action both usable and visibly meaningful.

### Tests

- Added regression coverage for the north button's pointer interaction, full orientation reset, and enabled bearing rotation.
- Passed all 77 JavaScript regression tests.

---

## [0.11.106] — 2026-08-03

### Added

- **Focus ISS control** — added a top-left globe toggle that continuously keeps the live ISS position centred. Its on/off state is stored with the browser-local globe view and does not affect the Hub database.

### Fixed

- **Day/night rendering** — replaced the dateline-crossing hemispherical ring with an antimeridian-safe terminator curve and polar night polygon, preventing MapLibre from triangulating the night shade into an incorrect wedge across the globe.

### Tests

- Added coverage for continuous terminator/polygon coordinates, persistent local focus state, live recentering, and focus-control styling.
- Passed all 76 JavaScript regression tests.

---

## [0.11.105] — 2026-08-03

### Fixed

- **ISS globe startup** — wait for the remote MapLibre style to finish loading before enabling globe projection and adding ISS overlays. This prevents the premature `Style is not done loading` failure that left a flat basemap with no marker, track, terminator, altitude, or speed.
- **ISS startup diagnostics** — failures during post-style globe and overlay setup now remain visible in the widget instead of escaping from the map load callback.

### Tests

- Added regression coverage to prevent projection setup from moving ahead of MapLibre's style-loaded event.
- Passed all 75 JavaScript regression tests.

---

## [0.11.104] — 2026-08-03

### Added

- **Interactive ISS Tracker widget** — added a rotatable, zoomable 3D Earth with a live ISS marker, previous and upcoming orbital ground track, current coordinates, altitude, and orbital speed.
- **Live day/night view** — added a calculated night-side shade and moving solar terminator so the globe shows where daylight currently ends.
- **Resilient keyless tracking** — current ISS orbital elements refresh from Where The ISS At with CelesTrak fallback, while pinned Satellite.js performs SGP4 propagation locally without an API key.

### Changed

- **Database isolation** — ISS orbital cache and globe camera state remain in browser-local storage and never update the Hub database.

### Tests

- Added deterministic coverage for TLE propagation, antimeridian-safe tracks, solar terminator geometry, local caching, data-source fallback, and widget integration.
- Passed all 74 JavaScript regression tests across widgets, persistence, drag/drop, extension relay, and native database handling.

---

## [0.11.103] — 2026-08-03

### Changed

- **Chronological daylight events** — the Astronomy widget now orders sunset, dark-sky start, dawn, and sunrise by their actual upcoming timestamps instead of keeping a fixed label order.

### Tests

- Added regression coverage for daylight cards spanning the current evening and following morning.

---

## [0.11.102] — 2026-08-03

### Added

- **Astronomy & Night Sky widget** — added a local-first sky dashboard with a dynamically shaded NASA/LRO Moon image, phase name, illumination, lunar age, moonrise/set, and the next primary lunar phase.
- **Tonight at a glance** — added local sunrise, sunset, dark-sky dusk/dawn, and naked-eye planet visibility with best viewing time, direction, altitude, and magnitude.
- **Meteor showers and events** — added active/upcoming major showers with peak rate and Moon interference, plus calculated equinoxes, solstices, local solar eclipses, lunar eclipses, planetary elongations/oppositions, and a packaged NASA/JPL comet close-approach snapshot.
- **Flexible sky location** — the widget can automatically inherit the first configured Weather widget location or use its own Open-Meteo location search, with 30/90/180/365-day event horizons and individual section toggles.
- **Pinned astronomy assets** — vendored Astronomy Engine 2.1.19 with its MIT licence and bundled NASA's LRO Moon mosaic so core calculations and Moon rendering work without runtime API credentials.

### Changed

- **Database isolation** — hourly astronomy recalculation and manual reload use runtime memory only; generated sky data and external catalogues are not written into the shared Hub database.

### Tests

- Added fixed-date London coverage for Moon conditions, sunrise/sunset, visible planets, active showers, eclipses, equinoxes, and comet ordering, plus location inheritance, phase-mask, local-asset, settings, and responsive-style checks.
- Passed 65 JavaScript regression tests covering the new widget and existing extension, persistence, drag/drop, selection, Weather, and Weather Map behavior.

---

## [0.11.101] — 2026-08-03

### Fixed

- **Stable Weather Map settings** — typing in the origin search, moving the origin zoom slider, or changing other Weather Map controls now updates only the settings preview instead of repeatedly destroying and rebuilding the live widget behind the modal.
- **Origin changes apply on Done** — committing a new origin location or zoom now destroys the previous map without recapturing its old camera under the new origin, clears the obsolete browser-local view, and renders at the newly configured origin.

### Tests

- Added regression coverage for deferred Weather Map settings rendering and origin commits that discard the previous camera without mutating the new configuration.

---

## [0.11.100] — 2026-08-03

### Added

- **Weather Map origin and current view** — settings now distinguish the shared origin location/zoom from the browser-local current map centre/zoom created by live map interaction.
- **Origin zoom control** — Weather Map settings include a 3–13 zoom slider with quarter-level steps and a non-interactive MapLibre preview showing the configured origin location, zoom, marker, and basemap.
- **Reset-to-origin action** — the Weather Map now has a reload-style action beside its settings icon that clears only its browser-local view, returns to the configured origin centre and zoom, and refreshes forecast data there.

### Tests

- Added coverage for zoom normalization, origin defaults, reset-to-origin database isolation, settings/preview wiring, and preview styling.

---

## [0.11.99] — 2026-08-03

### Changed

- **Browser-local Weather Map view** — map camera and zoom, locally dragged forecast centre, active overlays, selected forecast hour, and attribution state now survive Hub reloads in a widget-specific browser preference record.
- **Shared database isolation** — interacting with the Weather Map no longer changes its shared widget coordinates or attribution configuration and no longer invokes a Hub database save. Configured location, units, and basemap remain normal shared widget settings.

### Tests

- Added coverage for restoring Weather Map view state after runtime reset, retaining local forecast centres across data requests, and leaving widget database data untouched by map interactions.

---

## [0.11.98] — 2026-08-03

### Changed

- **Weather startup refresh** — both the basic Weather and Weather Map widgets now force one fresh Open-Meteo request when the Hub page loads or reloads, even when a saved response is still inside its normal cache lifetime.
- **Hourly forecast refresh** — each weather widget checks the clock once per minute and refreshes once when a new hour begins. Ordinary widget rerenders within the same hour do not make duplicate requests.

### Tests

- Added coverage for per-hour refresh claims, startup/hour scheduling in both weather widgets, and Weather Map forced refreshes against a fresh cache.

---

## [0.11.97] — 2026-08-03

### Added

- **Weather reload action** — the basic Weather widget now has a reload icon beside its settings icon that immediately requests fresh Open-Meteo data, bypassing the normal 30-minute cache and retry delay.

### Changed

- **Reload feedback** — the new action spins and remains disabled while its request is running, while the widget continues showing its saved forecast with a refreshing status.

### Tests

- Added coverage for forced refreshes against a fresh cache, Weather-only action registration, icon placement, and loading feedback styling.

---

## [0.11.96] — 2026-08-03

### Fixed

- **Hourly forecast drag isolation** — the hourly scroller now resolves its containing widget when interaction begins, after the forecast has joined the live DOM, so horizontal dragging disables widget movement and scrolls the forecast as intended.

### Tests

- Added a regression case covering handlers installed while the hourly forecast is detached and pointer interaction after it is attached to its widget.

---

## [0.11.95] — 2026-08-03

### Changed

- **Readable hourly strip** — the basic Weather widget's 24-hour forecast now stays on one row with approximately eight hours visible at once.
- **Grab-to-scroll forecast** — drag left or right anywhere over the hourly strip to browse the remaining hours without moving the widget itself; mouse and touch pointers are supported.

### Tests

- Added coverage for pointer-driven scrolling, widget-drag isolation, the single-row eight-card layout, and grab cursor feedback.

---

## [0.11.94] — 2026-08-03

### Added

- **Optional 24-hour Weather forecast** — the basic Weather widget can now show the next 24 hours between current conditions and the daily forecast, including time, temperature, rain chance, and a day/night-aware condition icon.
- **Responsive hourly layout** — hourly cards use two rows of 12 at ordinary widget widths, expand to one row of 24 in very wide widgets, and remain horizontally scrollable in narrow columns.

### Changed

- **Hourly-aware Weather cache** — cached Weather responses now include the required hourly fields; switching the new display toggle reuses the current response without making another request.

### Tests

- Added coverage for hourly request parameters, current-hour extraction, the 24-hour display toggle, cache reuse, and responsive hourly styling.

---

## [0.11.93] — 2026-08-03

### Added

- **Current-time reset** — Weather Map timelines now include a **Now** button that stops playback and jumps to the forecast frame nearest the current time and date.
- **Full-width forecast scales** — precipitation, temperature, and cloud overlays now use wide colour gradients with their values printed directly at the corresponding colour stops.

### Changed

- **Cleaner wind presentation** — removed the redundant wind-speed legend because each animated wind marker already displays its local speed.
- **Stable legend rendering** — quantitative scales are only rebuilt when units or enabled overlays change, rather than on every forecast animation frame.

### Tests

- Added coverage for nearest-current-hour selection, unit-specific legend values, wind-legend removal, the Now control, and full-width labelled gradient styling.

---

## [0.11.92] — 2026-08-03

### Fixed

- **Weather Map drag flicker** — forecast refreshes after map recentering now update the existing MapLibre source, markers, timeline, status, and controls in place instead of destroying and recreating the canvas.
- **Continuous forecast display** — the previous overlays remain visible while a new map-centre forecast is loading, including when a request fails or is superseded by a later drag.

### Tests

- Added regression coverage ensuring the post-fetch Weather Map refresher does not destroy the map, clear the widget DOM, or invoke a full widget render.

---

## [0.11.91] — 2026-08-03

### Changed

- **Persistent attribution control** — Weather Maps remember whether the compact attribution line is expanded or collapsed across location refreshes, widget moves, column rerenders, and Hub reloads.
- **Theme-aware zoom controls** — replaced MapLibre's fixed dark plus/minus artwork with CSS-drawn icons that inherit the active Hub panel, text, border, hover, and accent colors.

### Tests

- Added coverage for attribution-state carry-over and capture, saved Weather Map defaults, and theme-variable navigation-control styling.

---

## [0.11.90] — 2026-08-03

### Added

- **Map-driven location changes** — dragging a Weather Map now recentres its Open-Meteo forecast grid, updates the displayed coordinates, persists the new location, and leaves Hub widget dragging disabled while the pointer is over the map.
- **Camera preservation** — weather maps retain their centre and zoom while widgets are moved or board columns rerender.
- **Responsive map sizing** — MapLibre canvases now observe their container and resize after attachment, widget movement, and column-width changes.

### Changed

- **Higher map zoom** — increased the maximum zoom from 9 to 13 and enabled normal wheel zoom over the map.
- **Cleaner wind display** — removed the dark circular backgrounds from wind markers while retaining high-contrast arrows and speed labels.

### Fixed

- **Stale recentre requests** — forecast responses are now associated with the coordinates that initiated them, preventing rapid consecutive map drags from caching data for the wrong centre.

### Tests

- Added coverage for camera carry-over, camera capture, higher zoom, container resize handling, map-drag location updates, stale-request protection, and marker styling.

---

## [0.11.89] — 2026-08-03

### Added

- **Combined weather overlays** — wind, rain, temperature, and cloud controls are now independent toggles, allowing any combination of forecast layers to be displayed together.
- **Animated weather** — wind arrows flow in the forecast direction and rain fields pulse to make changing intensity easier to read; decorative motion respects the reduced-motion preference.
- **Forecast playback** — added play and pause controls that animate all enabled layers together across the 48-hour forecast timeline.

### Changed

- **Overlay composition** — temperature, cloud, and rain now use dedicated stacked MapLibre layers with individual legends and visibility state.
- **Map lifecycle cleanup** — forecast playback timers and rain animation frames are stopped whenever a weather map is destroyed.

### Tests

- Added coverage for multi-layer state, independently visible map layers, forecast animation controls, reduced-motion handling, and animation teardown.

---

## [0.11.88] — 2026-08-03

### Added

- **Regional Weather Map widget** — added an interactive OpenFreeMap basemap with Open-Meteo forecast layers for wind, rain, temperature, and cloud cover around a selected location.
- **Forecast timeline** — weather maps include an hourly slider covering the next 48 hours, with layer-specific legends and metric or imperial measurements.
- **Pinned local map runtime** — vendored MapLibre GL JS 5.24.0 and its BSD licence so executable map code is loaded locally rather than from a third-party script CDN.

### Changed

- **Widget interaction handling** — interactive widget surfaces no longer start a widget drag while the user is manipulating a map.
- **Map lifecycle cleanup** — MapLibre instances and wind markers are explicitly destroyed before board-column rerenders to avoid retained WebGL contexts.

### Tests

- Added coverage for Weather Map registration, regional grid bounds, batched Open-Meteo request parameters, forecast-layer extraction, pinned map assets, map teardown, and map-control styling; reran the complete JavaScript suite.

---

## [0.11.87] — 2026-08-03

### Added

- **Weather units** — weather widgets can switch between metric measurements (°C, km/h and mm) and imperial measurements (°F, mph and inches).
- **Forecast orientation** — forecast days can be displayed as the existing vertical list or as a horizontally scrolling row of compact day cards.

### Tests

- Extended weather-widget coverage for unit-specific Open-Meteo parameters, unit-aware cache invalidation, layout-only cache reuse, and horizontal forecast styling.

---

## [0.11.86] — 2026-08-03

### Added

- **Open-Meteo weather widget** — added a column widget with searchable global location selection, current conditions, precipitation probability, and a configurable 1–16 day forecast.
- **Local forecast cache** — weather responses refresh every 30 minutes and stay in a widget-specific browser cache, preventing background forecast updates from rewriting the shared Hub database.

### Tests

- Added coverage for widget registration, forecast-length limits, Open-Meteo request construction, cache invalidation, shared-state isolation, and weather UI styling.

---

## [0.11.85] — 2026-08-03

### Changed

- **Larger selection hit target** — bookmark and folder selection checkboxes retain their existing 15px visual size but now accept clicks within an additional 5px invisible margin on every side, reducing accidental bookmark opens.

### Tests

- Verified JavaScript syntax, selection event propagation, and stylesheet consistency after the hit-target adjustment.

---

## [0.11.84] — 2026-08-03

### Fixed

- **Consistent multi-drag styling** — removed the extra accent frame and surface around grouped cursor and insertion previews so they match the established single-bookmark preview treatment.
- **Complete source disappearance** — every bookmark participating in a multi-drag now disappears from its source while dragging and is restored together if the drag is cancelled. Hidden source nodes are excluded from insertion-position calculations.

### Tests

- Extended multi-drag coverage to verify that all source elements receive and clear the shared dragging state.

---

## [0.11.83] — 2026-08-03

### Changed

- **Full insertion-point preview** — multi-bookmark drags now render the complete ordered bookmark stack at the prospective insertion point as the pointer moves through columns, folders, Inboxes, and the Import Manager. The placeholder expands to the group's real height so larger selections are not clipped.

### Tests

- Extended multi-drag regression coverage to verify that the insertion placeholder contains every dragged bookmark in payload order.

---

## [0.11.82] — 2026-08-03

### Changed

- **Full multi-drag preview** — dragging multiple selected Inbox or Import Manager bookmarks now renders every dragged bookmark as a compact ordered stack instead of showing only the bookmark under the pointer with a numeric badge. Hidden selected items are reconstructed from state so the preview remains complete.

### Tests

- Added regression coverage that the multi-drag image contains every selected bookmark in payload order; reran JavaScript syntax and drag-and-drop tests.

---

## [0.11.81] — 2026-08-03

### Added

- **Folder titles and dividers** — static folder context menus can now add nested titles and dividers, expanding the folder immediately so the new structure is visible.
- **Multi-selection drag and drop** — dragging a selected bookmark in an Inbox or the Import Manager carries the selected bookmark group in tree order and shows the group count on the drag preview.
- **Direct tab Inbox drops** — bookmarks and supported grouped drags can be dropped on a board tab name to move them directly into that tab's Inbox, with the tab indicator refreshed immediately.
- **Extension target picker** — extension 1.0.20 can send the current browser tab to a selected Hub Board/Tab and remembers the last valid destination for repeat sends.

### Changed

- **Transient areas stay unlocked** — Inbox and Import Manager items no longer expose item-lock controls; legacy lock flags are removed while loading and whenever items enter an Inbox.

### Tests

- Added coverage for transient lock normalization, selected-bookmark tree ordering, extension target discovery, popup target selection, and background relay routing.
- Ran JavaScript syntax checks and every CommonJS regression file directly; all passed. The aggregate Node test runner could not spawn workers in the sandbox, so the equivalent test files were executed serially in-process.

---

## [0.11.80] — 2026-08-03

### Fixed

- **Immediate tab Inbox indicator** — receiving a bookmark from the extension now rerenders the active board's tab bar alongside the sidebar and Inbox badge, so the destination tab's red dot appears immediately without switching tabs or reloading the Hub.

### Tests

- Added a regression assertion that external Inbox delivery refreshes the board-tab indicators between the navigation and global Inbox badge updates.

---

## [0.11.79] — 2026-08-03

### Fixed

- **Firefox 153 local-file permission diagnosis** — detects Firefox's new, default-off “Access local files on your computer” permission and shows the exact `about:addons` action in both the extension popup and the file-based Hub instead of reporting a generic missing relay.
- **Correct extension-root injection** — programmatic relay recovery now injects `/content.js` from the extension root; the former relative `content.js` path was resolved beside the Hub's `index.html` and caused the popup's “unexpected error”.
- **Self-healing Hub registration** — page pings register their sender, discovery retries a failed initial registration, startup/status scans recover already-open Hub tabs, and stale or navigated relay tabs are cleared and rediscovered before delivery.
- **Durable Import Manager delivery** — extension imports now prepare against the latest shared snapshot, deduplicate retries by delivery ID, and rebase once after a real shared-database conflict, matching Inbox delivery guarantees.
- **Accurate shared-data polling and startup** — polling compares JSON semantically, while a successful shared read that returns no data is treated as a load failure instead of presenting an empty database.
- **Recoverable native messaging** — persistent and one-shot native requests have bounded timeouts; disconnects clear stale availability and later storage checks can reconnect and reload the shared-path configuration without an extension reload.

### Tests

- Added relay-path, failed-registration, stale-registry, Firefox 153 permission, Import Manager idempotency/rebase, native reconnect, semantic polling, and empty-shared-read regressions.
- Verified Firefox 153 against the exact `file:///F:/Projects/Coding/Morpheus%20WebHub/index.html` URL with the local-file opt-in gate enabled for the isolated test profile; the relay connected, the native shared database loaded eight boards, and the Hub left its protected startup state.

---

## [0.11.78] — 2026-08-03

### Fixed

- **Reverted the regressed Hub/extension discovery layer** — restored the pre-session single-Hub registration contract: the declarative `document_idle` relay registers its tab, and the background routes status and deliveries directly to that registered tab. The proactive tab registry, discovery scan, and background injection path have been removed.
- **Restored the proven Firefox file match** — returned the manifest to the exact previously working `file://*/*` content-script declaration without the added explicit origin permissions.
- **Active-tab recovery from the popup** — when Firefox has not attached the declarative relay to an open local Hub, opening the extension popup on that Hub injects the idempotent relay using the existing `activeTab` grant and immediately re-registers it.
- **Database fixes preserved** — semantic shared/cache comparison, protected shared loading, chunked reads, correlated saves, and persistence acknowledgements remain in place; this rollback does not touch the database or native-host protocol.

### Tests

- Updated relay tests around the restored registration contract and added popup fallback-injection coverage while retaining the shared-load, FIFO, acknowledgement, and semantic-snapshot regressions.

---

## [0.11.77] — 2026-08-03

### Fixed

- **Restored the proven Firefox relay transport** — returned the page bridge to one declarative `document_idle` content script using the repository's previously working `file://*/*` match, removing the startup activation wrapper and background reinjection path that regressed live Hub detection.
- **Non-invasive open-Hub discovery** — the background now discovers an existing relay through a normal extension message instead of executing scripts in the page.
- **Reliable extension deliveries retained** — tab and bookmark sends still wait for an explicit Hub persistence acknowledgement, without altering the known-good page-request relay.

### Tests

- Added end-to-end relay coverage for registration, page ping, background discovery, pushed-tab delivery, and Hub acknowledgement.

---

## [0.11.76] — 2026-08-03

### Fixed

- **Late relay recovery updates the live Hub** — when the extension relay arrives after the initial bridge attempts have expired, its ready announcement now starts a fresh connection and immediately refreshes extension, native-host, and shared-storage state.
- **Early relay attachment with the corrected Firefox origin match** — the content relay now starts before deferred Hub scripts, using the canonical `file:///*` match pattern and explicit local-origin permission introduced in the preceding fixes.

### Tests

- Added coverage for reconnecting after the initial bridge sequence has fully timed out and retained the early-page marker/first-ping regression.

---

## [0.11.75] — 2026-08-03

### Fixed

- **No false cache-update prompt after delayed relay recovery** — shared and browser-cached snapshots are now compared as JSON data rather than as raw serialized text, so harmless whitespace or object-property ordering differences no longer look like newer local edits.

### Tests

- Added snapshot comparison coverage for equivalent reformatted JSON, real array-order changes, and malformed input.

---

## [0.11.74] — 2026-08-03

### Fixed

- **Background-controlled relay injection** — the extension background now verifies Morpheus tabs and explicitly injects the relay whenever Firefox's declarative content-script matcher has not attached it, both during extension startup/reload and when a page finishes loading.
- **Explicit hub origin permissions** — added file, localhost, and loopback host permissions so the fallback injector has unambiguous access to supported hub URLs.
- **Duplicate-injection protection** — the relay is idempotent, preventing duplicate listeners if Firefox's declarative injection and the background fallback both run.
- **Visible extension build** — the popup now displays its manifest version, making it possible to confirm which temporary extension build Firefox is running.

### Tests

- Extended manifest and relay coverage for explicit local-file permission and idempotent fallback injection.

---

## [0.11.73] — 2026-08-03

### Fixed

- **Reliable Firefox relay lifecycle** — restored the content script to Firefox's previously working `document_idle` injection phase after live diagnostics showed `document_start` was not attaching on the local hub page.
- **Fast idle-phase handshake** — the relay now announces when it attaches and the page immediately replays any pending bridge request, preserving fast detection without relying on document-start injection.

### Tests

- Added coverage for a first bridge ping sent before relay attachment and verified that the relay-ready announcement causes the same pending request to be replayed and completed.

---

## [0.11.72] — 2026-08-03

### Fixed

- **Firefox local-file relay injection** — corrected the content-script match pattern from the hosted-URL form `file://*/*` to Firefox's hostless file-URL form `file:///*`, matching hub URLs such as `file:///F:/Projects/.../index.html`.
- **Trustworthy displayed version** — the sidebar and About panel now receive their version from the running application script instead of retaining a stale hardcoded `0.11.67` label.
- **Actionable relay status** — the sidebar now distinguishes a relay that was never injected from an injected relay whose extension background failed, with the underlying error available as a tooltip.

### Tests

- Added a manifest regression assertion for the canonical Firefox file-URL match pattern and retained document-start registration coverage.

---

## [0.11.71] — 2026-08-03

### Fixed

- **End-to-end shared database chunking** — shared JSON now remains in bounded 256 KiB chunks across native messaging, extension messaging, and the page bridge instead of being recombined into one multi-megabyte extension response before reaching the hub.
- **Accurate desktop-sync status** — settings now calculate native readiness after the authoritative storage lookup completes rather than retaining the initial fast-handshake value.
- **Visible startup diagnostics** — if an authoritative shared load still fails, the protected empty-fallback notice now includes the actual transport error while automatic recovery continues.

### Tests

- Added a 700 KB multi-chunk page-bridge regression proving that shared state is reconstructed exactly without falling back to the legacy whole-database message.

---

## [0.11.70] — 2026-08-03

### Fixed

- **Immediate page bridge startup** — the extension relay now attaches at document start, before the hub's deferred scripts can send their first ping; handshake attempts also use short bounded timeouts instead of accumulating five-second stalls.
- **No false empty shared database** — a configured shared-file read failure is no longer replaced with extension-local storage. When that fallback is empty, the hub keeps its data area hidden and retries rather than presenting it as the real database.
- **Faster shared database loading** — startup probing, configuration lookup, and chunked database reads now reuse one native-host connection instead of launching a new Python process for every chunk.

### Tests

- Added regression coverage for document-start ping delivery, shared-read failure isolation, and persistent native-host reuse during startup.

---

## [0.11.69] — 2026-08-03

### Fixed

- **Fast extension discovery** — hub registration and bridge pings now acknowledge extension presence immediately instead of waiting for the native-host probe and database-path lookup to finish.
- **Popup delivery action recovery** — the extension popup now refreshes hub/storage status while open and enables Inbox and Import Manager delivery as soon as an open hub is discovered.
- **Open-hub rediscovery** — status checks and send actions can rebuild the hub-tab registry directly from verified Morpheus pages, including after an extension reload or an initial registration race.

### Tests

- Added regression coverage for native-startup-independent handshakes, status-time hub rediscovery, and popup actions becoming enabled after a delayed hub registration.

---

## [0.11.68] — 2026-08-03

### Changed

- **Durable extension delivery** — inbox and Import Manager sends now carry a delivery ID and wait for the hub to acknowledge the corresponding save before the popup reports success.
- **Hub tab routing** — the extension now tracks all registered hub tabs and preserves the last genuinely active hub as the delivery target instead of allowing inactive polling traffic to steal it.

### Fixed

- **Correlated shared-database saves** — replaced the extension-wide save debouncer with a FIFO that keeps every snapshot, expected version, and result paired with its original caller, preventing stale tabs from being told that a different tab's snapshot was saved.
- **Inbox rollback recovery** — external inbox additions are idempotent, refresh stale shared state before mutation, and safely reapply once if the disk changes during delivery.
- **Inactive-tab background writes** — hidden hub tabs no longer persist asynchronous favicon or APOD results produced from potentially stale state.
- **Atomic shared-database writes** — native conditional writes now use a cross-process lock, content hashes, and atomic file replacement so two native-host processes cannot both replace the same baseline and metadata-only file changes do not create false conflicts.

### Tests

- Added regression coverage for extension FIFO response correlation, inactive-tab delivery targeting, page-side save coalescing, native conflict detection, metadata-only changes, identical snapshots, and concurrent writers.

---

## [0.11.67] — 2026-07-22

### Fixed

- **Shared database recovery guard** — restored hub detection after extension reloads and added browser/native safeguards so a tiny fallback browser cache cannot overwrite a large shared database after Firefox local-file permissions change.

---

## [0.11.66] — 2026-05-29

### Added

- **Extension Import Manager delivery** — added a popup action and bridge flow that sends the current browser tab directly into the hub Import Manager, including Firefox-provided favicon data when available.
- **Managed background assets** — tab background images picked from disk or loaded from web URLs are now copied into managed `assets/backgrounds/...` files and stored by path instead of embedding large data URLs in the shared JSON database.
- **Native favicon fallback** — the native host can now fetch page HTML, parse declared favicon/touch-icon links, download the best candidate, and return a cached data URL for stubborn sites.
- **Generic secret bridge** — added reusable extension/native secret get/set/delete/list actions with Windows Credential Manager support for the NASA APOD API key.
- **Native database backups** — the native host now creates rotating `before-write` JSON backups before replacing the shared database file.

### Changed

- **Disk-backed persistence** — large hubs now treat the extension/native shared database as the primary persistence path and avoid mirroring the full database into extension storage when disk storage is available.
- **Shared database reads** — extension/native shared-database loading now uses chunked file reads so large JSON files are not limited by native messaging response size.
- **Secret persistence** — the NASA APOD widget now reads its API key from the secret cache/Credential Manager path instead of relying on the shared JSON database.
- **Settings organization** — moved visual toggles into a dedicated UI settings tab and clarified shared data file, desktop sync, and API key status wording.
- **Temporary extension setup** — native-host installers now accept explicit extension IDs so temporary/debug extension IDs can be allowed during development.

### Fixed

- **Browser quota failures** — saving no longer fails just because browser storage or extension storage is full when the shared disk database is available.
- **Shared database recovery safety** — pending disk saves keep an emergency browser snapshot, startup detects when local cache looks newer than the shared database, and sync pauses/prompts instead of silently accepting an older disk snapshot.
- **External-change reload loop** — accepting a freshly loaded shared snapshot now clears stale queued writes and updates the shared-disk baseline so the hub does not repeatedly reload the same file change.
- **Secret migration safety** — JSON API keys are scrubbed only after secure storage is verified and migration/write succeeds, preventing keys from disappearing when the native bridge is temporarily unavailable.
- **Favicon refresh behavior** — `Refresh favicon` now forces the native favicon lookup once before public favicon services can return a generic successful icon.

---

## [0.11.58] — 2026-05-09

### Added

- **Dynamic sets** — added live tag-rule-based sets with shared include/exclude rule editing, tab set bar support, resolved counts/previews, and dedicated Set Manager controls for creating, editing, sorting, and inspecting dynamic results.
- **Dynamic folders** — added live tag-rule-based folders for board columns with dedicated open/closed icons, shared rule editing, per-folder sort modes, and in-column quick actions for editing rules and sort order.

### Changed

- **Dynamic collection UX** — dynamic sets and folders now behave as read-only live views, including live rule-preview updates in the Set Manager, shared sort modes (`source`, title, and URL ordering), and streamlined header controls across the Set Manager, folder modal, and board column UI.
- **Project tracking** — the Dynamic Sets and Folders implementation checklist is now complete and rolled into this release.

### Fixed

- **Dynamic collection interactions** — blocked invalid manual edits against dynamic sets/folders across context menus, drag/drop, modal flows, and Add-to-Set paths while keeping normal manual sets and folders unchanged.
- **Dynamic folder copy/move semantics** — dragging or sending bookmarks from inside a dynamic folder now creates safe copies where appropriate instead of mutating the underlying source bookmark or causing items to disappear from other folders.
- **Dynamic persistence and recovery** — dynamic set/folder fields now survive normalization, export/import, trash restore, and shared-database save/load consistently, including restoring board items back into their original parent folders when possible.

---

## [0.11.57] — 2026-05-07

### Changed

- **Inbox destination picker** — `Move to tab inbox` / `Send to tab inbox` flows now use separate board and tab selectors instead of one long combined destination list.
- **Sidebar collapse tab surface** — the nav collapse button now sits flush with the sidebar and uses the same opacity treatment as the sidebar surface so it reads as one piece.
- **Large background import handling** — oversized data-URL background images picked from disk or the native file picker are now downscaled before being stored to reduce memory/state bloat.

### Fixed

- **Local development URLs** — bookmark create/edit validation now accepts localhost, loopback IPv4, and IPv6-style dev URLs instead of rejecting them as invalid.
- **Tag Manager move-to-group menu** — the move menu no longer shows a dead-end `No other groups` row when there is nothing actionable to move to.
- **Search result inbox move flow** — bookmark search-result context menus now use the same cleaner move-to-inbox flow as the rest of the app.

---

## [0.11.56] — 2026-05-02

### Changed

- **Shared-tag model simplification** — boards, tabs, and folders no longer expose per-object `Pass to...` / `Strip on...` toggles; shared tags now always propagate by design.
- **Shared-tag persistence cleanup** — legacy `inheritTags` / `autoRemoveTags` fields are now stripped from runtime state and saved snapshots, with the live shared database migrated to remove those obsolete fields.
- **Import Manager tree workflow** — Import Manager now uses the same nested tree interaction model as the main hub instead of a flatter bespoke list path.

### Fixed

- **Inherited tag dedupe** — items that already own a tag explicitly no longer surface the same tag again as inherited when moved under a parent sharing that tag.
- **Import Manager drag and drop** — folders and bookmarks in Import Manager now support internal nesting/reordering and drag cleanly into board, inbox, and bookmark-target destinations.
- **Import Manager send target** — Import Manager items can now be sent directly to the active tab inbox from the context menu when a valid active tab target exists.

---

## [0.11.55] — 2026-04-29

### Changed

- **Sidebar overhaul** — rebuilt the sidebar into a transparent structural shell with separate top, Essentials, and navigation cards, removed the old `Essentials` / `Boards` section labels, and moved trash, extension status, and version actions into the new top card.
- **Sidebar background treatment** — the active tab background now spans the whole app shell instead of stopping at the board pane, so the sidebar and content area share the same backdrop.
- **Sidebar opacity controls** — Global Settings now lets sidebar cards inherit the active tab container opacity by default or use a dedicated sidebar opacity override instead.
- **Edit/create modal unification** — create/edit flows across the hub now use the shared transparent shell, flatter inner sections, and aligned tag-field layouts, with widget editing left on the older styling for now.
- **Utility modal refresh** — Search, Inbox, Import Manager, Tag Manager, Trash, and most utility surfaces now follow the shared header/footer/panel treatment, leaving only minor follow-up polish work around Sets Manager.
- **Modal pattern rules** — documented the current hub modal styling rules and remaining rollout expectations in the `UI Pattern Notes` section of `TODO.md` so the remaining cleanup work has a clear visual contract.
- **Tag Manager rename flow** — tags can now be renamed inline directly on their chips with double-click, keeping the Tag Manager interaction style lightweight and consistent.

### Fixed

- **Set deletion safety** — deleting a set now sends it to Trash so it can be restored instead of being removed permanently.
- **Set ID collisions** — new sets now use stronger generated IDs so restored or future sets are far less likely to accidentally collide with older deleted set references.

---

## [0.11.54] — 2026-04-29

### Added

- **Live Theme Editor** — Theme Settings now includes a full in-app editor for theme colors, scheme, radius, and shadow with immediate preview while you edit.

### Changed

- **Theme workflow** — added `New`, `Duplicate`, `Save`, `Save As…`, `Delete`, and `Revert Preview` flows for custom themes, using hub-native modals instead of system prompts.
- **Theme picker polish** — built-in and custom themes now have clearer active and edited states, plus collapsible sections to reduce scrolling while editing.
- **Theme scope simplification** — removed the temporary disk-theme UI path again so themes stay focused on built-ins and in-app custom themes only.

### Fixed

- **Theme modal layering** — duplicate/save-as naming modals now stay above Settings without closing the underlying settings panel.
- **Theme delete fallback** — deleting a duplicated custom theme now returns to its source theme instead of always falling back to `Default Dark`.

---

## [0.11.53] — 2026-04-28

### Changed

- **Board/tab data split cleanup** — board-level and tab-level metadata now stay separated more reliably, with corrected inheritance layering for board tags, tab tags, nav-folder inheritance, and pass-on/strip settings.
- **Board creation flow** — new boards now support a true empty state, open straight into `Create Tab`, and can remain empty if tab creation is cancelled or the last tab is deleted later.
- **Board shell polish** — the board title bar, speed dial, tab bar, and set bar now share one outer shell, tabs use cleaner text-only labels, and the active tab settings entry lives on the right side of the tab bar.

### Fixed

- **Board lock coverage** — locked boards now consistently block tab and set-bar mutations, including add/remove/reorder actions from the board shell.
- **Tab behavior edge cases** — deleting an inactive tab no longer changes the active tab, and empty boards now keep enough shell UI visible to let you add tabs back in normally.
- **False shared-disk save conflicts** — shared-disk writes now run through a single-flight queue so bursts of local edits do not race the bridge against itself and trigger spurious save-conflict warnings as easily.

---

## [0.11.52] — 2026-04-28

### Added

- **Manual hub reload control** — General Settings now includes a `Reload Now` action that reloads from the shared database when available, otherwise from the browser cache.

### Changed

- **Shared/local startup authority** — hub startup now decides the authoritative source up front, preferring the shared database when the extension/native host is available and otherwise falling back cleanly to browser cache.
- **Warm browser-cache metadata** — local cache now keeps source/freshness metadata alongside the saved snapshot so the app can reason about shared-vs-local recovery without guessing.
- **Auto-refresh notice preference** — General Settings now includes a toggle for whether automatic shared-disk refreshes show a post-refresh notice or stay silent.

### Fixed

- **In-app shared-disk reloads** — external shared-disk changes now reload data in-app instead of relying on normal page refreshes, while transient panels/modals are cleared safely during reload.
- **Recovered shared-storage reconciliation** — when the extension/native host comes back, the hub now compares cached local state against shared state, prompts to push the newer local copy when appropriate, and pauses sync safely if you decline.
- **Bridge availability tracking** — bridge connection status now updates more honestly after failed calls, which improves storage-status UI and recovery detection when the extension/native host disappears or returns.

---

## [0.11.51] — 2026-04-28

### Changed

- **Explicit tab inbox model** — tab inboxes are now stored as real `tab.inbox` state instead of hidden pseudo-columns, while preserving the current inbox UI and delivery behavior.
- **Backlog cleanup** — removed the now-actioned Inbox Model Cleanup section from `TODO.md`.

### Fixed

- **Tab inbox accounting** — inbox badges, counts, search/trash helpers, tag usage/counts, duplicate URL detection, and favicon cleanup now read from the explicit per-tab inbox model instead of the old hidden-column compatibility path.

---

## [0.11.50] — 2026-04-28

### Added

- **Global sets** — added reusable bookmark launch groups with a dedicated Sets Manager, live inline editing, search integration, bookmark context-menu `Add to Set...`, and bulk-open support.
- **Tab set bars** — tabs can now link global sets directly in the board shell, with context-menu launch/manage/remove actions and DnD from the Sets Manager.
- **Import Manager panel** — bookmark HTML imports now stage in a dedicated Import Manager utility panel with its own sidebar entry, item tree, bulk selection, and tab-inbox delivery flow.

### Changed

- **Board/tab overhaul** — replaced the old collection-aware runtime model with top-level boards that own embedded tabs, board-level speed dial, and tab-level set bars.
- **Board and tab editing flow** — board creation/editing now uses the old collection-style modal role, while tab editing uses the old board-settings modal role.
- **Import delivery model** — inbox delivery is now tab-aware across Import Manager sends, bulk move flows, and extension tab send, and the Import Manager button now shows a staged-item indicator badge.
- **UI shell cleanup** — Tag Manager, Sets Manager, and settings-style panels now follow the current modal/header patterns more closely, drag from their headers, and use the updated sidebar/footer presentation.
- **Project backlog cleanup** — removed actioned overhaul and UI items from `TODO.md` so the backlog reflects only remaining work.

### Fixed

- **Set DnD polish** — set-manager reordering and copy-in drops now use stable preview-clone behavior without flicker, hidden-source glitches, or incorrect bottom-drop handling.
- **Import Manager pseudo-board leftovers** — removed the remaining board/nav behavior assumptions so Import Manager no longer appears as a fake board or empty-state main-panel content.
- **Tag and bookmark modal regressions** — restored inherited-tag display in bookmark/folder modals and fixed collection-speed-dial-era edit flows that surfaced blank bookmark edit dialogs.
- **Collection-era behavior leftovers** — removed old collection-specific search, trash, move, tag inheritance, modal, context-menu, and DnD paths that no longer belonged to the live board/tab model.

---

## [0.11.48] — 2026-04-26

### Added

- **NASA APOD widget** — added a new widget that displays NASA's Astronomy Picture of the Day, including support for image and video entries, refresh, and per-day caching.
- **API Keys settings tab** — Global Settings now includes a dedicated API Keys tab, starting with a shared NASA key used by APOD widgets.

### Changed

- **AMO packaging flow** — added a dedicated AMO packaging script that strips non-store files and writes normalized archive paths so the Firefox signing upload matches Mozilla's validation requirements.
- **API key handling** — the APOD widget now reads its key from shared settings instead of per-widget config, and existing widget-level NASA keys are migrated automatically.
- **Project cleanup** — removed outdated extension artifacts and tightened `.gitignore` coverage around generated packaging output and local native-host files.

### Fixed

- **Shared-disk conflict protection** — cross-browser saves now compare file-version metadata before writing, emit a user-visible conflict flow when the on-disk JSON changed, and avoid silently clobbering newer data.
- **API key leakage in widget state** — obsolete APOD key copies are stripped from widget config and cache data so the same key is no longer duplicated across multiple saved records.
- **Firefox AMO upload validation** — the signed-upload artifact now includes the required `data_collection_permissions` manifest entry and excludes native helper files from the store package.

---

## [0.11.47] — 2026-04-26

### Changed

- **Shared extension database path** — the Firefox bridge no longer derives `morpheus-webhub.json` from the page URL. The active database path is now explicit, browser-independent, and can be shared between Firefox and Zen.
- **Hub data settings** — Global Settings now exposes the shared database path when the native bridge is available, including browse/apply flow plus read-only path display in About.
- **Extension popup status** — the popup now reports the resolved shared database path so the browser-side status matches what the hub shows.
- **Localhost bridge support** — the extension content script now runs on `http://localhost/*` and `http://127.0.0.1/*` in addition to `file://`, allowing the hub to be served from a local webserver without losing bridge features.

### Fixed

- **Native host configuration bootstrap** — the native host now supports `config.json` for shared database path discovery and persistence, including a Windows save-path picker flow that reliably returns the selected JSON path.
- **False disconnected state** — the page-side bridge now retries its handshake and reconnects on later bridge calls so the hub no longer gets stuck reporting the extension as disconnected while the popup/native host are actually available.
- **Primary persistence target** — when native messaging is available, the shared on-disk database is treated as authoritative and extension storage is only a best-effort backup mirror, avoiding quota-related save failures on larger databases.

---

## [0.11.46] — 2026-04-26

### Fixed

- Removed the redundant un-themed `border-bottom` from `.modal-card-header`, `.bstg-header`, and `#wstgHeader`. The title input's accent underline (shown on focus when modals open) is the sole header divider.

## [0.11.45] — 2026-04-26

### Fixed

- Folder modal header now uses `modal-card-header` class (matching the bookmark modal) instead of the overridden `settings-header` variant, giving it the correct column layout.

## [0.11.44] — 2026-04-26

### Fixed

- Navpane "Add folder" and "Add subfolder" now open the same `folderModal` panel as board folders, giving them the correct subtitle header and the full tags section (Tags, Shared, Inherit, Auto-remove).

## [0.11.43] — 2026-04-26

### Changed

- Clock widget timezone field replaced with a datalist-backed autocomplete input populated from `Intl.supportedValuesOf('timeZone')`. The detected local timezone is shown as a hint below the field, and a "Use local" button fills the input with it in one click.

## [0.11.42] — 2026-04-26

### Fixed

- Clock widget format radio buttons now share a `name` attribute, ensuring only one can be selected at a time.

## [0.11.41] — 2026-04-26

### Changed

- **U1** All edit/create modals now have a consistent header: "NEW/EDIT \<TYPE>" subtitle, name input with auto-focus, and `var(--border)` divider line. Board, folder, and widget settings panels brought in line with the bookmark modal reference.
- **U2** Board settings panel Cancel button is now always visible (not only during create). Cancelling an edit restores the original board state without saving.
- **U3** Active board icon in the navpane now changes to accent color, matching active collection icon behaviour.
- **U4** Board names, collection names, and folder names all use the same 8 px gap between icon and label.
- **U5** Right-clicking empty space in the board tab bar (collection and folder contexts) shows an "Add board" context menu.
- **U6** Background image URL input in the board settings panel now sits flush left next to the "URL" label and stretches to fill the remaining width.
- **W1** Widget cards inherit theme font family and title line style/color/thickness from global style settings.
- **W2** Clock widget 12 h / 24 h format is now selected with radio buttons instead of a dropdown.
- **W3** To-do widget in columns no longer renders a duplicate divider below the widget title.
- **W4** To-do settings modal: removed redundant "Clear Completed" label; button renamed "Clear completed" and aligned bottom-left.
- **W5** Countdown widget blocks saving when the target date is in the past, with an inline error message.
- **W6** Countdown widget defaults to midnight (00:00) when no time component is provided, instead of failing.
- **W7** Note settings modal: removed "Content" label; textarea stretches to fill the full modal width.

## [0.11.40] — 2026-04-26

### Changed

- **Board settings panel two-column layout** — Tags and Speed Dial sections move to the left column; Background Image and Container Transparency move to the right. The panel now sizes to fit content (`height: auto`, max `calc(100vh - 40px)`, width capped at 780 px).
- **Background image drop-zone preview** — the drop zone shows the current background image as a cover preview when one is set; the preview updates live as the URL is typed, a file is dropped or browsed, or the image is cleared.
- **Draggable modals** — all create/edit modals are now draggable: `showModal` calls `centerPanel` so the card is positioned with `fixed` coordinates rather than flowing inside the overlay grid, allowing it to be freely repositioned by dragging the header.

---

## [0.11.39] — 2026-04-26

### Fixed

- **Collection tab bar button styling** — add-board and board-settings buttons in the collection tab bar now match the 18 px icon size used in the board name pane and no longer display a bordered frame; hover uses the same subtle background as the name-pane buttons.

---

## [0.11.38] — 2026-04-26

### Changed

- **Name pane icon size + alignment** — undo/redo/inbox/settings buttons in the board header are now 28 × 28 px with 18 px SVG icons (down from 36 × 36 / 20 px), use a transparent resting background, and are top-aligned so they anchor to the top-right corner when the board title wraps.
- **Inbox count chips inline** — the inbox item-count chips are now displayed inline to the right of the inbox icon inside the button, replacing the old absolutely-positioned row that floated above the header.
- **Board settings button in collection tab bar** — a small settings button now appears at the right end of the collection tab bar (aligned under the name-pane gear icon) and opens board settings for the active board. The add-board button is also pushed to the right alongside it via `margin-left: auto`.

---

## [0.11.37] — 2026-04-26

### Fixed

- **Nav board / collection deletion quota error** — `saveTrash()` now handles `QuotaExceededError` gracefully: it retries by stripping `backgroundImage` from stored boards, then progressively drops the oldest trash entries, so deletion never fails due to localStorage being full.

---

## [0.11.36] — 2026-04-25

### Fixed

- **Bookmark modal URL section** — URL row is now a `settings-section` with a "URL" label and input styling matching other modal sections; duplicate-URL warning moved inside the section.
- **Folder modal size** — folder modal now uses `height: auto` so it only occupies what it needs instead of stretching to full panel height.
- **Widget modal tweaks** — widget title placeholder no longer shows "(optional)"; widget settings panel also uses `height: auto`.
- **Context menu always closes** — context menu button handlers now use `try/catch/finally` so the menu is dismissed even when an action throws, and errors are surfaced as a notice dialog instead of being silently swallowed.
- **Nav board deletion error reporting** — `renderAll()` inside the delete-nav-item callback is now wrapped in a try/catch; if rendering fails after a successful deletion, the nav is refreshed via `renderNav()` and an error notice is shown rather than leaving the UI in a stale state.

---

## [0.11.35] — 2026-04-25

### Fixed

- **Collection create/cancel** — creating a collection no longer writes to state or renders in the nav until the modal is confirmed. Cancelling the New Collection modal now discards with no side-effects.
- **Strip on leave default** — the "Strip on leave" / auto-remove-tags toggle now defaults to enabled when creating a new collection, board, or folder that exposes shared tags.
- **Collection settings icon** — the settings button in the board name pane now opens the Edit Collection modal when a collection is active, instead of the board settings panel.

---

## [0.11.34] — 2026-04-25

### Added

- **Collection speed dial section in Edit Collection modal** — speed dial settings (Show toggle and Slots input) are now in a dedicated "Speed Dial" section below Tags, instead of being appended inside the Tags section.
- **Show toggle for collection speed dial** — collections now have a `showSpeedDial` flag; the "Show" toggle in the new Speed Dial section controls whether the speed dial bar is visible when that collection is active. Changes apply live.

---

## [0.11.33] — 2026-04-25

### Added

- **Speed dial slot grid** — speed dial is now a fixed-slot grid (default 8, configurable 1–48) instead of a free list; empty slots show as dashed cells and accept drops. Board settings and collection edit modal both expose a Slots input.
- **Board icon in nav** — board items in the sidebar now show a small grid icon (tinted accent when active), matching the collection icon treatment.
- **Inbox dot indicators** — collection tabs, folder headers, and nav board items now display a small accent dot when any contained board has inbox items, replacing the previous count chips.
- **`findCollectionById` helper** — centralized lookup via `findNavItemPath` so nested collections are found correctly everywhere.
- **Slot-based speed dial helpers** — `normalizeSpeedDialSlots`, `getSpeedDialSlotCount`, `firstEmptySpeedDialSlot`, `findSpeedDialSlot`, `setSpeedDialSlot`, `removeSpeedDialItemById` added to state.js.

### Changed

- **Board title display** — when a collection is active the main title bar now shows only the collection title; folder context shows only the board title.
- **Delete collection** — now deletes contained boards outright (with trash restore support) instead of scattering them back to the nav.
- **Speed dial drag image** — `applyDragImage` now preserves the source element's exact pixel dimensions and fixes img sizing inside the clone.
- **Essentials slot drop** — filled essential slots no longer accept drops.
- **Import manager board** — inbox button is hidden (not just disabled) when the import manager board is active; clicking the inbox button while on the import manager is a no-op.

### Fixed

- **Delete board from collection/folder** — now pushes the board to trash with restore support (`collection-board` / `folder-board` areas).
- **Restore collection from trash** — now re-adds all contained boards to state, not just the nav item.
- **Null slot guards** — null entries in `speedDial` arrays no longer crash search, tag merge, `findDuplicateUrl`, or migration loops.
- **`addSpeedDialBookmark`** — uses `contextTarget.collectionId` when set, and places the new item in the correct slot.
- **Duplicate speed dial item** — uses `firstEmptySpeedDialSlot` instead of `splice`, so it respects the slot grid.
- **Collection speed dial edit** — editing a bookmark in a collection speed dial now correctly looks up the item from the collection, not the active board.
- **Edit essential bookmark** — `setEssential` now accepts a `replace` flag so editing an existing slot works correctly.

---

## [0.11.32] — 2026-04-25

### Fixed

- **Tag Manager drag and drop regression** — restored tag chip drag/drop between Unsorted and existing or newly-created groups. Tag drags now keep the active tag ID in memory during `dragover`, and entire group blocks accept drops instead of relying only on the chip input row.
- **Legacy tag group records** — old tag groups now normalize missing/default fields and string boolean values so groups are not accidentally treated as locked.
- **Tag deletion from Tag Manager** — clicking a chip's × button now reliably routes through a delegated Tag Manager handler before chip drag/edit behavior can intercept it.
- **Tag delete confirmation crash** — tag usage counting now skips null item slots, so delete confirmation modals open correctly when enabled.

---

## [0.11.31] — 2026-04-23

### Fixed

- **Tag Manager chip × button** — clicking × on tag chips now correctly deletes the tag; draggable parent chip no longer intercepts the mousedown via Firefox's drag machinery (capture-phase guard disables `draggable` for the duration of the click).
- **Tag Manager chip label click** — clicking a chip's label in the Tag Manager no longer triggers deletion; `beforeRemove` now only acts on `editMode = false` (the × button path).

---

## [0.11.30] — 2026-04-23

### Added

- **Tag Manager group creation from tags** — tag chip context menus can now create an inline unnamed group, move the selected tag into it, and focus the new group name field.
- **Tag Manager drag and drop** — tags can now be dragged between groups and Unsorted, inserted at the cursor position, and reordered within a group using an in-row chip preview clone.
- **Collapsible tag groups** — tag groups can now be collapsed and expanded to save space while keeping drop support on group headers.

### Fixed

- **Tag Manager delete confirmations** — deleting tag groups and deleting tags from any Tag Manager group now respect the tag-delete confirmation setting; deleting a group deletes its tags instead of moving them to Unsorted.

---

## [0.11.28] — 2026-04-23

### Added

- **Base tag suggestions** — tag autocomplete now includes a configurable default suggestion set without creating saved tags until a suggestion is committed.
- **Extension status in About** — the About tab now shows extension/native-host connection state and lists available extension-backed features.

### Changed

- **Code quality cleanup** — centralised board creation, drag/drop area checks, drag decoration cleanup, and deep-clone handling; removed unused widget-picker UI/code and dead helper functions.
- **Favicon cache trimming** — save operations now run the existing favicon cache trimmer before persistence.

### Fixed

- **Unsorted tag management** — Unsorted now uses the shared chip-input behavior, supports manual additions, deletes tags correctly, and refreshes the orphan counter after deletion.
- **Create widget cancel** — cancelling the new-widget settings dialog no longer creates a widget.
- **Folder internal reordering** — moving items within a folder no longer trips the self-subfolder safety check.
- **Navpane bottom drops** — dragging below the final nav item now shows the preview at the bottom and inserts there reliably.

---

## [0.11.27] — 2026-04-23

### Fixed

- **Source element unhiding on cursor move (all DnD areas)** — `removeDragPlaceholders()` was called on every `dragover` event to swap in the new placeholder, and it contained `querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'))`. This removed the hide-class from the source element on the very first cursor movement, making it reappear. Removed the blanket `.dragging` cleanup from `removeDragPlaceholders()` and instead each `dragend` handler now explicitly removes `.dragging` from the specific element it dragged (nav items, speed dial links, essentials, board items, widgets, tabs). The effect is now consistent across all DnD areas.

---

## [0.11.26] — 2026-04-23

### Fixed

- **Gap where dragged item was** — `.dragging` used `opacity: 0` which hid the element visually but kept it in the layout flow, leaving a blank space. Changed to `display: none !important` so the element is fully removed from the layout.
- **Column preview clone invisible** — `createDragPlaceholder` clones the source element after `.dragging` is applied, so the clone inherited the class. With `display: none !important` on `.dragging`, the clone was invisible even after `drag-preview` was added. Added `'dragging'` to the `classList.remove` call so clones always start visible.

---

## [0.11.25] — 2026-04-23

### Fixed

- **Nav pane preview wrong font/color** — the synthetic nav item created for collection-tab → nav drags was missing `data-type="board"`, so the `[data-type="board"]` CSS rules (`font-size`, `font-family`, `font-weight`, `font-style`, `color`, `text-align`, `display: flex`, `align-items: center`) did not apply. Added `el.dataset.type = 'board'` to make the preview render identically to the dropped item.

---

## [0.11.24] — 2026-04-23

### Fixed

- **Collection tab bar drag flicker** — the per-tab `dragleave` handler was removing the indicator whenever the cursor entered the ghost element (which has `pointer-events:none`, causing events to pass through to `tabBar`); this created a remove/re-add loop that flickered. Removed the per-tab `dragleave` handler entirely — the indicator is now only cleared when the cursor leaves the entire `tabBar`. Added position-change tracking (`_tabIndicatorKey`) so the DOM is only modified when the logical drop position changes. The `tabBar.dragover` handler now silently accepts the drop without repositioning when an indicator is already placed.
- **Ghost tab clone fidelity** — the cloned tab now strips `.dragging` and `.active` before insertion so it appears in its resting (non-active) style. The nav pane preview for collection-tab drags now includes board tags (matching the exact appearance the item would have after being dropped).

---

## [0.11.23] — 2026-04-23

### Fixed

- **Collection tab bar drag indicator** — `_tabDragOver` was inserting a 3px vertical bar (`div.tab-drop-indicator`) as the drop indicator. It now inserts a ghost tab clone (for reorders, a clone of the dragged tab; for nav board drops, a new tab div with the board title). CSS updated to override the thin-bar styles on `.collection-tab.tab-drop-indicator`.
- **Nav preview clone for collection-tab drags** — `createDragPlaceholder('nav')` only checked `dragPayload.itemId` and fell back to a dashed placeholder when dragging a collection tab (which sets `boardId`, not `itemId`). A new branch synthesises a nav board preview element from the board title before reaching the fallback.
- **Drop from collection tab bar to empty nav space** — `handleNavListDragOver` blocked `collection-tab` drags (preventing `preventDefault` from being called on empty nav space, so the drop event never fired). Added `collection-tab` to the allowed areas. `handleNavListDrop` now has a `collection-tab` branch that removes the board from the collection and inserts a new nav item at the drop position, matching the logic already present in `handleNavDrop`.

---

## [0.11.22] — 2026-04-23

### Fixed

- **Collection speed dial reordering** — `handleSpeedDialItemDragOver/Drop` and `handleSpeedDialContainerDragOver` were missing `collection-speed-dial` in their area guards, so dragging to reorder items in the collection speed bar had no effect. All three guards and the item-drop handler now handle `collection-speed-dial`.
- **Dragged element visible alongside preview clone** — elements that initiate a drag (board items, speed dial links, nav items, collection/folder tabs) now receive a `.dragging` class one animation frame after dragstart (after the drag image snapshot is captured), hiding the original. The class is removed when `removeDragPlaceholders` is called on dragend.

### Added

- **Collection tab bar DnD** — tabs in the collection tab bar can now be reordered by dragging. Nav board items can be dragged directly onto the collection tab bar to add them to the collection (with a vertical bar indicator showing the insertion point). The existing support for dragging a collection tab back onto a nav item to remove it from the collection now also shows a position preview and inserts at the correct position.

---

## [0.11.21] — 2026-04-23

### Fixed

- **Undo/redo/inbox/settings icon color** — `.icon-btn` was inheriting `var(--text)` from the shared button rule, making those icons brighter than sidebar icons (trash, search filter, etc.) which explicitly use `var(--text-muted)`. Added `color: var(--text-muted)` to `.icon-btn` with `color: var(--text)` on hover, matching the sidebar button pattern.

---

## [0.11.20] — 2026-04-23

### Fixed

- **Speed dial favicons drawn on white square** — the service request size was being passed as 256 for speed dial items. `faviconV2` doesn't support that size and errors, falling back to DuckDuckGo's `.ico` which has a white background baked in. All service requests are now capped at 64px; CSS controls the actual display size.

---

## [0.11.19] — 2026-04-23

### Fixed

- **Favicon for browser-dragged bookmarks** — Firefox includes `application/x-moz-place` in bookmark drags which contains `iconuri` (the favicon data URL the browser has cached). The hub now reads this on drop and uses it as `faviconCache` when creating the bookmark — no service lookup needed, the correct icon appears immediately.
- **Favicon service fallback chain** — switched the primary lookup from Google's `/s2/favicons` (which always returns HTTP 200 even for unknown sites, returning a generic globe instead of triggering fallbacks) to Google's `faviconV2` endpoint which returns HTTP 404 for unknowns, allowing the `onerror` chain to properly try DuckDuckGo → direct `/favicon.ico` → `/s2/favicons` in sequence.

---

## [0.11.18] — 2026-04-23

### Fixed

- **Favicon regression (0.11.17)** — the `fetch()`-based data-URL caching was silently failing for all cross-origin favicon services because browsers block reading the response body without CORS headers. This caused `img.src` to be overwritten with a bare `favicon.ico` URL that often doesn't exist, rendering alt text instead of an icon. Replaced with a simple `<img>` `onerror` chain: Google → DuckDuckGo → direct `/favicon.ico`. No `fetch()` required; the browser handles the requests natively without CORS restrictions.

---

## [0.11.17] — 2026-04-23

### Fixed

- **Favicon loading reliability** — replaced single-service Google fetch with a parallel race between Google and DuckDuckGo favicon services; added direct `/favicon.ico` fallback. (Superseded by 0.11.18.)

---

## [0.11.16] — 2026-04-23

### Fixed

- **Undo/redo leaves stale trash entries** — after undoing a deletion, the restored item is now removed from the Recently Deleted panel automatically. Applies to redo as well. If the trash panel is open, it refreshes immediately.
- **Board tab bar stale after closing settings with no rename** — `hideBoardSettingsPanel` now refreshes the collection/folder tab bar when the title input is empty (placeholder fallback path), matching the existing live-update on every keystroke.

### Changed

- **Trash panel label for deleted collections** — restored-collection entries now show "Collection" in the trash panel meta line instead of "Item".

---

## [0.11.15] — 2026-04-23

### Changed

- **"Move to board" list sorting** — all board selectors (modal dropdown, search-result submenu, bulk-move dropdown) now sort: standalone boards A-Z first, then collection boards grouped by collection name A-Z, then board name A-Z within each collection.

---

## [0.11.14] — 2026-04-22

### Added

- **Collections in trash** — deleting a collection now pushes it to Recently Deleted. Restoring puts the collection back in the nav and un-promotes its boards (removes the stub nav entries that were created on delete).
- **Collection speed dial → DnD to columns / essentials** — bookmarks in a collection's speed dial can now be dragged into board columns, board sub-folders, and essential slots (was silently rejected before). Displaced essentials are returned to the collection speed dial.
- **Collection speed dial → "Move to board"** — right-clicking a collection speed dial bookmark now offers "Move to board", identical to the regular speed dial item menu.

### Changed

- **Move to board board list** — boards that live inside a collection are now labelled `Collection — Board` instead of just `Board` in all "Move to board" dropdowns (modal selector and search-result submenu).
- **Shared tags input placeholder** — changed from "shared tag1 tag2" to "tag1 tag2" to match all other tag input fields.

---

## [0.11.13] — 2026-04-22

### Added

- **Collection `inheritTags` / `autoRemoveTags` toggles** — the Edit Collection modal now shows "Pass to items" and "Strip on remove" toggles below the Shared Tags input, matching the equivalent controls in folder and board settings. Collections missing these fields are migrated on load (defaults: `inheritTags: true`, `autoRemoveTags: false`).
- `autoRemoveTags` logic on collection removal — when "Strip on remove" is enabled, removing a board from a collection (via context menu or DnD to nav) strips the collection's shared tags from the board's own tag list.

### Fixed

- **Boards not displaying inherited tags** — `getBoardInheritedTags()` in modal.js was only looking one level up (immediate nav parent folder). It now calls `getBoardNavInheritedTags(boardId)` from state.js, which walks the full ancestor chain (nested folders + collection) and respects each ancestor's `inheritTags` flag.
- **`computeInheritedTags` ignoring collection `inheritTags`** — the in-board tag computation now checks `collection.inheritTags !== false` before appending collection shared tags, consistent with folder ancestry logic.

---

## [0.11.12] — 2026-04-22

### Added

- **Collection tags modal** — the "New Collection" and "Edit Collection" dialogs now include a Tags chip input (collection's own tags) and a Shared Tags chip input (inherited by all boards in the collection), matching the layout used in other create/edit modals.

### Fixed

- **Double border on modal tag input** — `.chip-text-input { border: none }` was being overridden by the more-specific `.tag-field-row .tags-input-container input` rule; added `!important` to `.chip-text-input` border reset.
- **Empty collection shows last active board title** — clicking a collection with no boards now sets `activeBoardId = null` so the title bar shows only the collection name.
- **Speed dial DnD adds to wrong target** — dragging a bookmark onto the speed dial pane while a collection is active now adds to the collection's speed dial, not the last active board's speed dial.
- **Speed dial "Add bookmark" context menu adds to wrong target** — same fix applied to `addSpeedDialBookmark()`; collection speed dial is targeted when `state.activeCollectionId` is set.

---

## [0.11.11] — 2026-04-22

### Added

- **Collection style settings** — Collections section in the Style tab of global settings: font size, font family, bold/italic/underline, text align, and color. These control how collection names appear in the nav pane.

### Fixed

- Collection name shown twice in the nav pane. The nav item renderer was falling through to a generic label-append branch after already building the collection's info element.

---

## [0.11.10] — 2026-04-22

### Added

- **Board tab bar** — when the active board lives inside a nav folder, a tab bar appears above the speed dial showing all boards in that folder. Click a tab to switch boards. Active tab is highlighted with an accent bottom border. Right-click a tab for Edit / Remove from folder / Delete. Drag a tab to the nav to pull the board out of the folder. "Add board" button appends a new board to the folder.
- **"Add board" in folder context menu** — right-clicking a nav folder now offers "Add board", creating a new board directly inside that folder.
- `findBoardFolder(boardId)` helper in state.js to locate the immediate parent folder of a board.

### Changed

- Board title header shows `Folder — Board` format when the active board is in a nav folder (mirrors the `Collection — Board` format).

---

## [0.11.9] — 2026-04-22

### Added

- **Collections** — new nav item type that groups boards into a tabbed workspace. Click a collection to activate it; boards appear in a scrollable tab bar above the speed dial. Context menus on collections and tabs support add/delete/rename/unlock operations. DnD: drop a board nav item onto a collection to add it; drag a tab back to the nav to remove it from the collection.
- **Collection speed dial** — when a board lives inside a collection, its individual speed dial is hidden; the collection's own speed dial is shown instead. The board settings speed dial toggle is disabled with an explanatory note when the board is in a collection.
- **Collection tag inheritance** — `sharedTags` on a collection are appended to every board's inherited-tag set, exactly like folder-level inheritance.
- **Search tag picker** — a collapsible side panel in the search modal lists every tag that appears in the current text-match results. Click chips to filter results by tag. Supports AND/OR toggle and A-Z / Group / Count sort modes. Pre-selects the tag when opened via "Search for tag" from the tag manager.

### Changed

- Search modal now uses a two-column layout (results + tag picker panel) when the picker is open.
- Empty search term now matches all items (so the tag picker can filter the full database without needing a text query).

---

## [0.11.8] — 2026-04-21

### Changed

- **Tag autocomplete** now suggests plain tag names (not `name · Group`); for same-name tags across multiple groups the autocomplete still completes the name, but committing (Space/Enter) shows a group-picker dropdown instead of silently picking the wrong one
- **Tag manager group inputs** have autocomplete disabled (`noAutocomplete: true`) — users type the tag name directly; same-name handling is done via the group picker if triggered from outside

### Fixed

- `chip-input`: `resolveInput` now receives `(typed, textInput, hiddenInput)` so disambiguation code can show a picker and defer chip commit (return `null`) without clearing the typed text
- `chipifyWord` only clears the text input when a chip was actually committed; text is preserved when the group picker opens

---

## [0.11.7] — 2026-04-21

### Added

- **Tag disambiguation in autocomplete**: when two tags share the same name in different groups (e.g. "python" in "Coding" and "Snakes"), suggestions and committed chips now show `python · GroupName`; chip inputs resolve the qualified format `name · GroupName` to the correct tag ID
- **Delete tags from Unsorted**: Unsorted chips now show a × button to permanently remove a tag from all items and state
- **Orphan tag cleanup**: if any tags are unreferenced by all items, an `× N orphans` pill appears in the Unsorted header; clicking it batch-deletes all zero-use tags with a single undo snapshot

---

## [0.11.6] — 2026-04-20

### Changed

- **Tag system refactored to ID-based** (Phases A–C): tags are now objects `{id, name, groupId, color}` stored in `state.tags`; all bookmarks/folders store tag IDs instead of name strings
- **Migration**: existing string-name tags are automatically migrated on first load — tag colours and group memberships are preserved
- **Tag manager** group editor now reads/writes `state.tags` directly via `groupId`; adding a tag to a group sets its `groupId`, removing moves it to Unsorted; deleting a group moves all its tags to Unsorted rather than deleting them
- **Chip inputs** for tags (modal, folder modal, board settings, tag manager groups) now store IDs and display names via `displayOf`/`resolveInput` opts; tag autocomplete excludes already-committed chips by ID
- **Context menu** in tag manager uses tag IDs; right-clicking an Unsorted chip now offers all groups; right-clicking a grouped chip offers "Unsorted" plus all other groups

### Fixed

- Tag autocomplete bug where exact-match filter was inverted (`!t.name === lc` → `t.name !== lc`)
- Tag autocomplete now correctly excludes already-committed chips (was using text input value; now uses hidden input IDs)

---

## [0.11.5] — 2026-04-21

### Added

- **Tag Manager panel** in Settings → Tag Manager tab: replaces "Coming soon" placeholder
- **Tag groups**: create named groups with a colour swatch, lock toggle, and × delete button; each group has a chip input for adding tags (chips render in group colour)
- **Unsorted category**: always-visible read-only section at the bottom showing all tags not assigned to any group; shows "All tags are grouped." when empty
- **Tag sort per group**: sort icon button on each group header opens a dropdown — A→Z, Z→A, Most used (by bookmark count); active sort shown with accent checkmark in dropdown
- **Tag chip context menu**: right-click any chip in the tag manager to get a "Move to group" menu listing all other groups with colour dots
- **Undo/redo in tag manager**: undo/redo buttons in the Tag Groups header row; all mutations push undo snapshots; synced with global undo stack
- **Settings panel fixed height**: 720 px tall regardless of active tab

### Changed

- `updateUndoRedoUI` now syncs `#stgUndoBtn` / `#stgRedoBtn` in addition to the main toolbar buttons

---

## [0.11.4] — 2026-04-20

### Added

- **Item lock feature**: lock icon on every board bookmark/folder item; hover-only when unlocked, permanently visible in accent colour when locked; toggled via lock icon click or context menu ("Lock item" / "Unlock item")
- **Inherited lock**: locking a folder locks all children recursively — child lock icons show in accent colour with "Locked by parent" tooltip and cannot be unlocked directly
- **Board-level locking**: lock icon on board nav items (hover-reveal when unlocked, accent-coloured when locked); toggled via lock button or nav context menu ("Lock board" / "Unlock board")
- **Locked board enforcement**: locked boards are fully read-only — all DnD blocked (column drops, item reordering, speed dial, inbox); context menus suppressed on items, speed dial (links and empty space), and columns; board settings and inbox buttons disabled; inbox panel closes and cannot be re-opened; board edit/delete removed from nav context menu while locked; locked boards excluded from all "Move to board" target lists

### Fixed

- **DnD preview in locked folders**: drag preview clone no longer appears inside locked folders (direct or inherited lock)
- **DnD drop into locked folders**: items can no longer be dropped into locked folders via any path (folder header, children container, or item-level reordering)
- **Folder reposition on failed nesting**: dragging a folder into a too-deep target no longer moves it to the bottom; validation runs before extraction
- **Themed error dialogs**: nesting/descendant error messages now use the app's modal style instead of the native browser `alert()`

---

## [0.11.29] — 2026-04-20

### Added

- **Sidebar collapse edge tab**: thin tab anchored to the right border of the sidebar at mid-height; replaces the collapse button in the header/footer; chevron rotates 180° in collapsed state
- **About tab in Settings**: settings panel now has an About tab (first in the tab list) containing the version number and app description

### Changed

- **Version number opens Settings at About tab**: clicking the version badge in the sidebar footer now opens the settings panel defaulted to the About tab
- **Standalone About dialog removed**: merged into the Settings panel; footer is now just trash + version — clean and uncluttered
- **Settings panel no longer in footer**: global settings accessible via version number (About tab) or any other tab via settings panel; `showSettingsPanel(tab)` now accepts an optional tab name

---

## [0.11.28] — 2026-04-20

### Added

- **Search highlight on "Open in board"**: after navigating, the target item scrolls into view and pulses with an accent-colored glow for ~1.6s so it's immediately visible even inside large folders

---

## [0.11.27] — 2026-04-20

### Fixed

- **"Open in board" now unfolds ancestor folders**: when navigating to a deeply nested item via search, all parent folders in the path are expanded before rendering so the item is immediately visible

---

## [0.11.26] — 2026-04-20

### Added

- **Search filter panel**: funnel icon button beside the search input toggles a compact filter bar with two groups — "Match" (Name / Tags) and "Show" (Bookmarks / Folders / Boards); chips toggle independently; icon gets an accent dot indicator when any filter is non-default; panel collapses via the button or Escape

### Changed

- `renderSearchResults` now respects `searchFilters`: name/URL matching and tag matching are gated by their respective chips; result types (bookmark, folder, board) are individually suppressible

---

## [0.11.25] — 2026-04-20

### Added

- **Search result tooltips**: bookmark, folder, and board results now show tooltips on hover (matching board items, speed dial, and essentials)
- **Search result context menus**: right-clicking a search result now opens the appropriate context menu — bookmarks get Edit / Duplicate / Refresh favicon / Move to board / Open in board / Delete; folders get Edit / Open in board / Delete; essentials and speed dial items delegate to their existing handlers; boards delegate to the nav context menu
- **"Open in board" action**: navigates to the board containing the item and closes search, available for bookmark and folder search results

### Fixed

- **`createBoardSearchResultItem` used undefined `body` variable**: board search results with tags would throw a ReferenceError; fixed `body.appendChild` → `el.appendChild` and removed the phantom `el.appendChild(body)` call
- **Cross-board edit/delete/duplicate/favicon-refresh**: all board-item context actions now use `getBoardForContext()` to resolve the correct board from `contextTarget.boardId`, so they work correctly on items from non-active boards (e.g. from search results)

### Changed

- **Removed dead CSS**: `.bookmark-body` and `.bookmark-tags` rules removed from `styles.css` (no JS callers remain; replaced by `.item-header` / `.item-tag-chips`)

---

## [0.11.24] — 2026-04-20

### Added

- **"Move to board" for speed dial and essentials**: both areas now have a Move to board context menu option; removes the item from its source and delivers it to the target board's inbox
- **Search results use unified item layout**: bookmark, folder, and board results now use the same `item-header` structure as board column items (favicon + name row, tag chips below) instead of the old `bookmark-body` layout; folder results use SVG folder icon; board results use the board icon

### Fixed

- **`moveToBoard` modal handler**: now correctly removes speed dial / essential items from their source before inserting into the target board's inbox (previously `deleteBoardTarget` was a no-op for non-board areas)

---

## [0.11.23] — 2026-04-20

### Fixed

- **Inbox rendering**: `renderInboxPanel` was passing `null`/`0` as depth/parentFolder to `createBoardItemElement`; corrected to use the function's defaults (depth=1, parentFolder=null), fixing depth-gated context menu options and drag payloads for inbox items

---

## [0.11.22] — 2026-04-20

### Added

- **Context menu parity — speed dial**: Duplicate and Refresh favicon actions now available on speed dial bookmarks (matching board bookmark menus)
- **Context menu parity — essentials**: Duplicate and Refresh favicon actions now available on essential slot bookmarks

### Fixed

- **Duplicate / Refresh favicon cross-area**: both actions now work in all contexts (board column, speed dial, essential) — previously they only operated on board-column items
- **Edit essential modal**: now passes `inheritedTags` to the bookmark modal, matching the edit path for board and speed dial bookmarks

---

## [0.11.21] — 2026-04-20

### Fixed

- **DnD dotted outlines removed** — `.drop-target` no longer shows a dashed outline anywhere (columns, inbox, essentials, folder children); the preview clone and favicon preview are the sole drop indicators

---

## [0.11.20] — 2026-04-20

### Fixed

- **DnD folder reordering** — items dragged within a folder now land at the correct position instead of always appending to the bottom; `handleBoardFolderContainerDragOver` now does full position-aware preview (nearest-item mid-point logic matching column dragover) instead of always pushing preview to the end
- **DnD nested folder preview** — removed the `depth >= 2` guard from `activateFolderDrop`; preview now appears correctly inside nested folders; actual folder-in-folder nesting is still blocked at drop time by the existing depth check in the drop handler
- **DnD collapsed folder drag** — dragging over a collapsed folder now correctly shows before/after reorder indicators instead of silently delegating to `activateFolderDrop` with no visible feedback

---

## [0.11.19] — 2026-04-20

### Fixed

- **DnD folder flickering** — dragging onto folder cards (header, tag grid, or card padding) now consistently activates folder-drop mode without flickering; child items no longer jump around when hovering over the folder name; dragging between header and children area no longer drops and re-animates the preview

---

## [0.11.18] — 2026-04-20

### Fixed

- **DnD column flicker** — board item/column/folder dragover handlers now reposition the existing preview clone in-place instead of destroying and re-animating it on every cursor movement within the same container; animation only plays when crossing into a new container for the first time

---

## [0.11.17] — 2026-04-20

### Changed

- **Essentials DnD** — removed dashed drop-target outline from essentials slots; the favicon preview is now the sole drop indicator

---

## [0.11.16] — 2026-04-20

### Fixed

- **Essentials DnD preview** — dragging any bookmark over an essentials slot now shows a semi-transparent favicon preview inside the slot, matching the behaviour of speed-dial and column previews

---

## [0.11.15] — 2026-04-20

### Fixed

- **DnD stuck preview** — dragging a board item into an empty speed-dial no longer leaves the column preview clone behind; `handleSpeedDialContainerDragOver` now inserts a placeholder and clears prior previews instead of returning early when speed-dial has no items
- **DnD stuck preview (essentials)** — entering an essentials slot now calls `removeDragPlaceholders()` on first entry so any column preview is cleared before the slot highlight appears

---

## [0.11.14] — 2026-04-20

### Fixed

- **Tag input backspace** — autocomplete suggestions are now dismissed (not deleted) when backspace is pressed; subsequent backspace strokes correctly erase typed characters; backspace on an empty chip input still pops the last chip back to editable text and further backspacing works normally

---

## [0.11.13] — 2026-04-20

### Changed

- **Unified bookmark and folder item layout** — both now render a single header row (checkbox → icon → name) with a grid tag display below (Tags / Inherited / Shared columns) matching the modal tag section style; folder icon remains the collapse toggle; tag visibility still controlled by the show-tags setting

---

## [0.11.12] — 2026-04-20

### Fixed

- **Nav pane folder context menu** — "Rename folder" replaced with "Edit folder" which opens the full folder settings modal (name, tags, shared tags, inherit/auto-remove toggles); `editFolder` and `showFolderModal` now resolve the folder from nav items when the context originates from the nav pane

---

## [0.11.11] — 2026-04-20

### Added

- **Chip tokenizer for tag inputs** — tag input fields in bookmark modal, folder modal, and board settings now display each entered tag as a coloured chip; clicking a chip returns it to editable text; Space/Tab/Enter commits the current word as a chip; Backspace on empty input pops the last chip back to text

---

## [0.11.10] — 2026-04-20

### Changed

- **Tag section field width** — reduced section padding and column gap so entry fields use ~90% of the box width; label font tightened to minimise column footprint

---

## [0.11.9] — 2026-04-20

### Changed

- **Tag section grid layout** — labels (Tags / Inherited / Shared) and fields are now in a true two-column CSS grid; label column is auto-width with right-aligned text, field column stretches to fill remaining space; all label edges align across rows; toggle row spans both columns

---

## [0.11.8] — 2026-04-20

### Changed

- **Tag section layout refined** — labels (Tags / Inherited / Shared) are right-aligned in a fixed-width column; fields stretch to fill remaining space; Inherited field styled as a non-editable input box (same border/radius/padding as editable inputs); order is Tags → Inherited → Shared → toggles; both toggles condensed into a single row

---

## [0.11.7] — 2026-04-20

### Changed

- **Tag section standardization** — all modals with tag fields (bookmark, folder, board) now group every tag-related control inside a boxed "Tags" section (`settings-section`); consistent order throughout: Tags → Shared tags → Pass/Strip toggles → Inherited
- **Tag input design unified** — folder and board tag inputs now use the same `form-row` layout and input styling (border-radius 12px, padded) as the bookmark modal; inputs are wrapped in `tags-input-container` for correct positioning context

---

## [0.11.6] — 2026-04-20

### Added

- **Nav pane: board tags display** — board items in the nav pane now show their own tags as chips below the board title
- **Folder context menu: Add bookmark** — right-clicking a folder now includes "Add bookmark", which opens the bookmark modal and inserts directly into that folder's children

### Changed

- **Inherited tags now render as chips** — the "Inherited" row in bookmark, folder, and board modals now displays tags as styled tag chips instead of plain italic text

---

## [0.11.5] — 2026-04-20

### Added

- **Nav context menu: Edit board** — right-clicking a board in the nav pane now shows "Edit board" which opens the full board settings panel (same as clicking the gear on an active board), replacing the old rename-only modal

### Changed

- **Modals: name field moved to header** — all create/edit modals using `#modalCard` now have the name input in a styled draggable header at the top, matching the folder and board settings panel layout; the modal card is now draggable by its header
- **Tooltip fix** — tooltip text now wraps correctly within its bounding box; removed `white-space: pre` which was causing text to overflow the container

---

## [0.11.4] — 2026-04-20

### Added

- **Settings: Global Settings restructure** — tabs reorganised to General / Tag Manager / Theme / Style; hub name is now an editable field in the panel header; Icon Sizes and Essentials moved to Style tab; Tag Colors section removed (placeholder reserved for future Tag Manager feature)
- **Settings: Board settings — autoRemoveTags toggle** — boards now expose a "Strip on move out" toggle matching the existing folder behaviour
- **Settings: Board settings — inherited tags display** — boards inside a nav folder now show the folder's shared tags as a read-only "Inherited" row
- **Modals: inherited tags display** — bookmark, folder, and board create/edit modals now show a read-only "Inherited" row listing tags the item will receive from its parent folder or board
- **Modals: tooltip icons** — "Pass to children/items" and "Strip on move out" toggles in folder and board modals now carry `?` tooltip icons explaining the mechanics
- **Folder icons** — folder expand/collapse indicators replaced with distinct open/closed folder SVG icons instead of generic chevrons

### Changed

- **Modals: create placeholders** — all create modals now use "New \<type>" placeholder text (New Bookmark, New Folder, New Title) instead of generic labels
- **Bugs fixed: confirm dialog z-index** — confirmation dialog now renders above the inbox panel (z-index 250 vs. 200)
- **Bugs fixed: cancelled modal ghost** — `hideModal()` now explicitly hides `#modalCard`; widget panels hide it before showing, preventing stale modal content appearing behind a new panel

## [0.11.3] — 2026-04-19

### Fixed

- **DnD: navpane inbox drop for bookmarks** — board nav items now accept bookmarks and folders dragged from any source (board column, nav list, speed dial, essentials), not just board columns; items are correctly extracted and normalised per source before being pushed to the target board's inbox
- **DnD: navpane board items as position anchors** — when dragging a widget cross-context into the navpane, board nav items (the majority of nav entries) were exiting the dragover handler early, making the middle of the list unreachable; they now correctly serve as position anchors
- **Modal: modalCard hidden state** — `modalCard` was not having its `hidden` class removed on open, causing display issues in some modal flows

### Changed

- **Extension: native messaging routing** — all bridge messages except `MW_PING` are now routed through the background script, enabling file-based save/load via the native host; `MW_REGISTER` sends the page URL so the background can derive the save path
- **Extension: manifest** — added `nativeMessaging` permission and `browser_specific_settings` gecko block for proper add-on ID assignment
- **Extension: popup** — separate status rows for Morpheus hub presence and native file save availability; clearer call-to-action when hub is not open

---

## [0.11.2] — 2026-04-19

### Fixed

- **DnD: widget drag to navpane middle positions** — board nav items were exiting the dragover handler early for widget drags, making them invisible as position anchors; the middle of the navpane was effectively a dead zone when dropping widgets from columns into the nav list
- **DnD: cross-context preview style** — dragging a widget from a column into the navpane now shows a navpane-style preview clone instead of the column card style; `_moveNavPreview` discards wrong-context clones and renders fresh in target context
- **DnD: speed dial drop position** — leftmost drop and container-level drops now read position globals before `removeDragPlaceholders()` clears them
- **DnD: navpane reorder drop** — `handleNavListDrop` captures `_dropTarget`/`_dropPos` before cleanup so drops that land on the container (cursor over clone) still insert at the correct item-level position
- **DnD: essential slot indicator** — drop target outline now uses `var(--accent)` instead of a hardcoded colour
- **DnD: speed dial shadow indicators** — removed stale CSS box-shadow rules that showed alongside the live preview

### Changed

- **DnD: navpane live preview** — preview clone is repositioned in-place (`insertBefore`) rather than destroyed and recreated, eliminating flicker during nav list reordering
- **DnD: cross-context previews** — `_renderCrossContextPreview` renders items in the target context style for all cross-context drag combinations (board↔nav, board↔speed-dial, essential↔board, column widget↔navpane)

---

## [0.11.1] — 2026-04-19

### Added

- **Notes widget** — freeform text, editable inline in the column; textarea auto-saves on blur; settings panel offers a larger editing area
- **To-do list widget** — checklist with inline add (Enter or + button) and per-row delete; checked items strike through; settings panel shows done/total count and a "Clear completed" button
- **Image widget** — displays any image URL; config: URL, fit (contain/cover/fill), optional caption; shows a placeholder prompt when no URL is set

---

## [0.11.0] — 2026-04-19

### Added

- **Widget framework** — new board item type alongside bookmarks, folders, titles, and dividers
  - `source/widgets.js` — `WIDGET_REGISTRY` pattern; adding a widget requires one object in one file
  - `WIDGET_REGISTRY[type]` fields: `name`, `description`, `allowedIn` (array of contexts), `defaultConfig`, `defaultData`, `render(widget, el, context)`, `renderSettings(widget, container)`
  - `render` context is `'column'` or `'navpane'` — same function produces full card or compact strip
  - Timer management keyed by `"widgetId:context"` to prevent accumulation on re-render; `clearColumnWidgetTimers()` / `clearNavWidgetTimers()` called at start of each render pass
  - Widget settings panel (`widgetSettingsPanel` in HTML) — title input + dynamic settings via `[data-cfg]` attributes; AbortController cleans up listeners on close; Cancel reverts config
  - Widget picker panel (`widgetPickerPanel`) — lists widgets allowed in the current context; AbortController cleanup
- **Clock widget** — live time display; column: large time + optional date; navpane: compact time; config: 24h/12h format, show seconds, show date, timezone (IANA string)
- **Countdown widget** — counts down to a target datetime; column: label + formatted time remaining; navpane: compact remaining; config: label, target date
- "Add widget" option in column right-click context menu
- "Add widget" option in navpane right-click context menu (shows only navpane-allowed widgets)
- Widget right-click menu: "Widget settings" and "Delete widget"

### Changed

- `renderColumns` now calls `clearColumnWidgetTimers()` before rebuilding DOM
- `renderNav` now calls `clearNavWidgetTimers()` before rebuilding DOM
- `createBoardItemElement` delegates `type === 'widget'` items to `createWidgetElement`
- `createNavItem` handles `type === 'widget'` — renders compact widget strip in navpane

---

## [0.10.0] — 2026-04-19

### Added

- **Theme system** — Global Settings → Style tab now has a Theme section at the top
  - 7 built-in themes: Default Dark, Light, Dracula, Catppuccin Mocha, Midnight (dark blue), Crimson (dark red), Nebula (dark purple)
  - Theme picker renders color-swatch cards; clicking applies immediately and persists to state
  - "Save current as theme…" button — captures all active CSS color variables as a named custom theme; stored in `state.settings.customThemes[]`
  - Custom themes show a delete (×) button on hover
  - If native host is connected, custom themes are also written to `./themes/<id>.json`; themes in that folder are loaded and shown alongside built-ins
- **`source/themes.js`** — `BUILTIN_THEMES`, `applyTheme(theme)`, `getThemeById(id)`, `getAllThemes()`
- **`themes/` folder** — 4 built-in theme JSON files for sharing and reference
- **`--accent-glow` CSS variable** — derived from `--accent` at 20% opacity; body radial gradient now uses it so the glow color follows the active theme's accent
- **Extension: `LIST_DIR` native message** — lists files in a directory with optional extension filter
- **Extension: `MW_LIST_THEMES` / `MW_WRITE_THEME`** — background routes to native host; reads/writes JSON theme files in `./themes/` next to `index.html`
- **Bridge: `listThemes()` / `saveTheme(theme)`** — page-side bridge methods for theme file access

### Changed

- `applySettings()` in `render.js` now calls `applyTheme()` at the end, keeping colors in sync with the active theme on every settings change
- **CSS fully variabilized** — all hardcoded dark hex values (`#141518`, `#16181d`, `#24262a`, sidebar gradient, board/column/speed-dial backgrounds), semi-transparent white surfaces (`rgba(255,255,255,…)`), and accent tints (`rgba(109,124,255,…)`) replaced with CSS variables; light and custom themes now render correctly across every UI element
- New CSS variables: `--panel-r/g/b` (RGB split for alpha-composited panel backgrounds), `--surface-1/2` (theme-aware hover/active surfaces), `--accent-chip/hover/selected/selected-border/glow`

---

## [0.9.1] — 2026-04-19

### Added

- **Native messaging host** (`extension/native/`)
  - `morpheus_host.py` — handles `READ_FILE`, `WRITE_FILE`, `OPEN_FILE_PICKER`, `PING`; cross-platform file picker via tkinter with PowerShell fallback on Windows
  - `morpheus_host.bat` — Windows launcher (path written by installer)
  - `install.ps1` — Windows installer: detects Python, writes launcher `.bat`, writes native messaging manifest to `%APPDATA%\Mozilla\NativeMessagingHosts\`, registers registry key under `HKCU\Software\Mozilla\NativeMessagingHosts\`
  - `install.sh` — Linux/macOS installer
- **Extension ID** (`morpheus-webhub@local`) added to manifest — required for native messaging and permanent installation
- **`nativeMessaging` permission** added to manifest
- `background.js` now connects to native host: `WRITE_FILE` (debounced 800 ms), `READ_FILE`, `OPEN_FILE_PICKER`; falls back to `browser.storage.local` when host unavailable
- `content.js` sends page URL on registration (used to derive JSON save path next to `index.html`); relays all bridge messages to background
- **"Browse…" button** in board settings background panel — calls `bridge.openFilePicker('image')` → native file picker → sets `board.backgroundImage` as data URL
- Popup now shows two status rows: Morpheus open/closed + file save enabled/storage-only
- `bridge.nativeIsAvailable()` and `bridge.openFilePicker()` added to page bridge

---

## [0.9.0] — 2026-04-19

### Added

- **Firefox extension** (`extension/`) — MV2, persistent background, content script on `file://*/*`
  - **Popup**: shows current tab title/URL, "Send to inbox" button, live status indicator
  - **Background script**: tracks the registered Morpheus tab; routes send-tab messages from popup to content script
  - **Content script**: detects Morpheus pages via `<meta name="morpheus-webhub">`; registers with background; bridges `postMessage` ↔ `browser.storage.local` and `browser.runtime`
  - **SVG icons** (48 × 48 and 96 × 96) with the Morpheus "M" mark
- **`source/bridge.js`** — page-side bridge module (IIFE, no dependencies)
  - Pings extension on load; exposes `bridge.isAvailable()`, `bridge.whenReady`, `bridge.saveState()`, `bridge.loadState()`
  - Listens for `MW_RECEIVE_TAB` push and fires `morpheus:receive-tab` CustomEvent
  - All methods no-op gracefully when extension is absent
- **`<meta name="morpheus-webhub" content="1.0">`** in `index.html` — lets the content script identify the page without URL matching
- **Receive-tab handler** in `app.js` — listens for `morpheus:receive-tab`, pushes bookmark into active board's inbox, updates badge and panel
- **Bridge storage backup**: `saveState()` fire-and-forgets to `browser.storage.local` when bridge is available; on startup, restores from bridge storage if `localStorage` is empty

### Changed

- `saveState()` in `state.js` writes to bridge storage in addition to `localStorage` when extension is present

---

## [0.8.1] — 2026-04-19

### Changed

- **Refactored source files**: split large `app.js` and `render.js` into five focused modules:
  - `source/render-items.js` — tag chip helpers (`applyTagColor`, `makeTagChip`, `renderTagsInto`, `createTagSection`) and `createBoardItemElement`
  - `source/modal.js` — tag autocomplete, generic modal, folder modal, `openExternalBookmarkModal`
  - `source/context.js` — context menu rendering and all `handle*ContextMenu` handlers
  - `source/settings.js` — board settings panel, global settings panel, font/color helpers, `attachSettingsListeners`
  - `source/import.js` — inbox panel, browser bookmark HTML parser, `attachBookmarkImportListener`
- Removed duplicate `item.tags` check in `renderSearchResults.matchesQuery`
- Removed dead `countBookmarks` function (superseded by `countItemsRecursive` in state.js)

---

## [0.8.0] — 2026-04-19

### Added

- **Per-board inbox**: each board has a hidden `{ isInbox: true }` column in `board.columns`; rendered as a floating draggable panel with position saved to `localStorage`
- **Inbox toggle button** in board header with badge showing total item count; panel header shows two badges (bookmarks / folders) using recursive counts
- **Nav inbox badges**: board nav items show two right-aligned badges (accent for bookmarks, muted for folders) when inbox is non-empty
- **Import Manager**: special persistent board pinned to the top of the nav when non-empty, hidden when empty; accepts HTML bookmark imports instead of the active board
- **Import Manager nav item**: two count badges (bookmarks / folders); accent-coloured border distinguishes it from regular boards
- **Robust bookmark HTML parser**: handles both nested and sibling `<DL>` layouts including Firefox's `<DL><p>` pattern; skips intermediate `<P>` elements when looking for a folder's child `<DL>`
- **Import alert** reports "X bookmarks in Y folders" using recursive counts
- **"Move to board"** added to folder context menu (was bookmark-only); correctly shows when on the Import Manager with at least one regular board
- `getBoardInbox()`, `getBoardInboxCount()`, `getBoardInboxCounts()` helpers in state.js
- `countItemsRecursive(items, type)` helper; `getImportManagerCounts()`, `getImportManagerItemCount()` in state.js
- `getImportManagerBoard()`, `getOrCreateImportManagerBoard()`, `importManagerHasItems()` in state.js
- `createImportManagerNavItem()` in render.js

### Changed

- `updateBoardSettings` and board settings column-count radio listener preserve the inbox column when resizing
- `loadState()` and `deleteBoardAndNavItem()` exempt the Import Manager board from the nav-reference sweep so it is never silently deleted
- HTML bookmark import routes to Import Manager (creates it if absent) and switches the active board to it; all imported folders start collapsed
- "Move to board" and "Bulk Move to Board" target lists exclude the Import Manager
- Inbox panel width matches a 3-column board column (`calc((100vw - 320px - 72px) / 3)`)
- Context menu `z-index` raised from 30 to 300 so it renders above the inbox panel (200)

### Fixed

- Folder expand/collapse inside the inbox panel called `renderBoard()` instead of `renderInboxPanel()`; now detects inbox column by `isInbox` flag and calls the correct renderer
- Import Manager board silently deleted when any regular board was deleted (`deleteBoardAndNavItem` sweep)
- "Move to board" option not appearing on Import Manager when only one regular board existed — context menu now uses `isImportManager`-aware logic for both single-item and bulk moves
- Context menu rendered behind the inbox panel due to lower z-index

---

## [0.7.1] — 2026-04-19

### Added

- **Folder modal**: unified create/edit panel with editable name in header (same pattern as board settings), Tags, Shared Tags, and two toggle rows with clear "shared tags" wording; replaces the four separate context menu entries
- **`attachTagAutocomplete(input)`** helper — wires inline tag prediction (Tab/ArrowRight to accept) to any input; used by bookmark modal, folder modal, and board settings tag fields
- **Tag autocomplete on board settings**: `bstgSharedTags` and `bstgTags` now have inline prediction

### Changed

- `labels` renamed to `tags` on folder and board objects; backward-compat migration preserves existing data
- Folder context menu simplified to a single "Edit folder" entry
- All tag chips rendered through `makeTagChip` / `renderTagsInto` — identical appearance everywhere (no amber/grey variants)
- `createTagSection` no longer accepts a chipClass argument; all chips use the same style
- `getTagSuggestions` / `renderTagSuggestions` now take the input element as a parameter instead of hardcoding `modalInput3`
- Inherited tag chips no longer styled differently from user-defined tag chips

---

## [0.7.0] — 2026-04-18

### Added

- **Tag inheritance system**: folders and boards now carry `sharedTags[]` that propagate to all descendants; computed on-the-fly at render time — never stored in state
- **Two tag types on folders/boards**: `sharedTags[]` (inherited by children) and `labels[]` (folder/board-only, not inherited)
- **`inheritTags` flag** on folders and boards (default `true`): controls whether this node passes its `sharedTags` down to children
- **`autoRemoveTags` flag** on folders (default `false`): when `true`, strips parent's `sharedTags` from an item's `tags[]` when moved out
- **Three-section tag display**: inherited (grey italic, read-only) | shared tags (blue) | labels (amber) — shown on folder headers and bookmark cards
- **Folder context menu**: "Edit tags", "✓/○ Pass tags to children" toggle, "✓/○ Strip tags on move out" toggle
- **Board settings panel**: Shared Tags, Labels, and Inherit Tags inputs wired up with live updates
- **Extended search**: folders, boards, and inherited tags are now searchable; clicking a folder result navigates into it; clicking a board result switches to that board
- **`computeInheritedTags(item, board)`** helper in state.js: walks parent chain recursively without a separate buildParentMap step
- **`editFolderTags(itemId, sharedTags, labels)`** state function
- **`tagGroups: []`** scaffolded in defaultSettings (design TBD)

### Changed

- Modal second tags row (Labels) shown only for folders/boards; hidden for bookmarks
- `getKnownTags()` now collects sharedTags and labels from folders and boards for autocomplete
- DnD drop handlers apply `autoRemoveTags` logic on item move-out across all three drop targets
- Grid column overflow fixed: `.folder-children` uses `grid-template-columns: minmax(0, 1fr)`

---

## [0.6.1] — 2026-04-18

### Fixed

- Empty column drag indicator now appears at the top of the column, not the bottom
- Nested folder items no longer overflow column boundaries at narrow widths (`.folder-children` grid constrained to `minmax(0, 1fr)`; `min-width: 0` on column items)
- "Add Tags", "Move to Board" (bulk and context menu) modals no longer show the redundant Name field; focus lands directly on the relevant input
- Bulk delete confirmation button now shows the correct item count instead of always "1 Item"

### Changed

- Tag autocomplete replaced with inline address-bar-style completion: the best match is shown as selected text in the input field; Tab or ArrowRight accepts it
- Tag autocomplete now also active in the bulk "Add Tags" modal

---

## [0.6.0] — 2026-04-18

### Added

- Bulk select: item checkboxes appear on hover; floating bulk toolbar with Delete, Add Tags, Move to Board, and Deselect actions; Escape clears selection
- "Move to board" in bookmark context menu (visible when more than one board exists)
- Browser bookmark HTML import (Netscape format) — imports into the active board's first column, preserving folder structure
- Duplicate URL detection — inline amber warning in the add-bookmark modal when the URL already exists anywhere in the hub
- Smart tag autocomplete — dropdown of known tags while typing in the tags field; Tab accepts the top suggestion

---

## [0.5.0] — 2026-04-18

### Added

- Undo / redo: Ctrl+Z / Ctrl+Y (or Ctrl+Shift+Z); 50-step in-memory snapshot stack; undo and redo buttons in the board header (disabled when stack is empty)
- Recently Deleted buffer: persistent trash (max 20 items, separate localStorage key); draggable trash panel with per-item restore and permanent delete; trash button with item-count badge in the sidebar footer; Clear All action
- Essentials: configurable display count (1–24) via stepper in Behavior settings; warning shown when stored essentials exceed the current display count; bookmarks assigned to the dropped slot rather than the first free slot

---

## [0.4.0] — 2026-04-18

### Added

- Bookmark management: create, edit, delete bookmarks with favicons, tags, and drag-and-drop
- Board system: multiple boards with configurable column counts (3–5)
- Speed Dial bar per board; show/hide toggle per board in board settings
- Essentials strip in sidebar for quick-access bookmarks; global show/hide toggle
- Navigation panel: boards, folders, titles, dividers — all draggable and nestable
- Search/filter across all boards, speed dial, and essentials (live, grouped by source)
- Board settings: background image (URL or drag-drop), container opacity
- Global Settings — Style tab: typography (font, size, weight, style, alignment, color) for all text elements; tag colors; title/divider line color, style, and thickness
- Global Settings — Behavior tab: icon size (S/M/L) for speed dial and essentials; show/hide essentials; warn-on-close; per-type delete confirmations; JSON export/import
- Settings panel split into Style and Behavior tabs
- Sidebar collapse toggle (chevron button); smooth transition
- Smooth fade-in animation when switching between boards
- Keyboard shortcuts: `/` or `Ctrl+F` to focus search; `N` to add bookmark to last-used column
- Context menu: Open all bookmarks in folder; Duplicate bookmark; Refresh favicon
- Tooltip system (JS-positioned, viewport-aware, shows title + URL + tags)
- About dialog with version number
- Empty column placeholder text ("Right-click to add")
- Version constant (`APP_VERSION = '0.4.0'`) and version badge in sidebar footer
