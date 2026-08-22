# Morpheus WebHub

Morpheus WebHub is a local-first bookmark workspace built with HTML, CSS, and JavaScript. It runs directly from `file://`, needs no web server, and can use a Firefox extension plus native host for a shared JSON database and OS integrations.

## Product model

- The sidebar contains boards, folders, titles, dividers, and compact widgets.
- Each board has one or more tabs. A tab owns its columns, background, set bar, and Inbox.
- Board content can contain bookmarks, folders, titles, dividers, and registered widgets.
- External bookmark deliveries target a tab Inbox or the Import Manager.
- Sets provide reusable manual or rule-driven bookmark collections.
- Tags may be assigned directly or inherited through navigation, boards, tabs, and folders.

## Current feature status

Implemented areas include multi-tab boards, configurable columns and backgrounds, speed dials, sets and dynamic folders, nested navigation, tag inheritance, Inbox and Import Manager workflows, trash plus Undo/Redo, responsive sidebar sizing, multi-item selection and drag previews, themes, extension relay, atomic shared-database persistence, and a categorized widget library.

The widget library currently includes clocks, countdowns, notes, to-do lists, images, Calculator and Converter, local Bergamot translation, Focus Sessions, a multi-provider Football Tracker for leagues, domestic cups and international tournaments, Global Hazards, Saved Sessions, service and system monitoring, approved Git and recent-file views, Media Watchlist, Universal Search, NASA APOD, basic and mapped weather forecasts, astronomy/night-sky information, an interactive ISS tracker, RSS feeds, a unified read-only Calendar, and IP/VPN information with an optional Cloudflare speed test.

Outstanding product and platform work is tracked only in `TODO.md`; completed work belongs in `CHANGELOG.md`.

## Persistence model

- The Firefox extension and native host provide the primary shared JSON database for large Hubs.
- Writes use version/hash conflict detection, a native lock, backups, and atomic replacement.
- Chunked reads reject and retry if the database changes partway through transfer.
- Browser `localStorage` is a recovery cache and browser-only fallback, not a silent replacement for an unavailable configured shared database.
- Persisted state carries an explicit schema version. Loading repairs missing navigation references rather than deleting otherwise valid boards.

## Architecture

- `source/state-schema.js`: persisted schema version and non-destructive structural repairs.
- `source/state.js`: normalized state, selectors, mutations, recovery cache, and shared-save coordination.
- `source/render.js` and `source/render-items.js`: page composition, search, navigation, boards, and item rendering.
- `source/widgets.js`: shared widget framework plus lightweight built-ins; substantial widgets live in paired standalone `*-widget.js` / `*-widget.css` modules.
- `source/widget-sdk.js`: descriptor normalization, capability gates, bounded networking, extension and credential gateways, small local-cache quotas, large IndexedDB asset caches, scheduling, managed animation frames, and teardown.
- `source/calendar-widget.js` / `source/calendar-widget.css`: unified private/public calendar sources, ICS parsing, secure credentials, and agenda/month presentation.
- `source/*-widget.js` / `source/*-widget.css`: standalone built-ins, including service/system monitoring, approved Git/file views, media tracking, local Bergamot translation, and universal local/web search.
- `source/widget-network.js`: SDK-routed widget requests and shared Open-Meteo geocoding UI.
- `source/dnd.js`: navigation, board, sidebar, set, and Import Manager drag/drop adapters.
- `source/bridge.js`: page-side extension transport.
- `extension/background.js`: registered-Hub routing and native-service boundary.
- `extension/native/morpheus_host.py`: atomic file I/O, chunk transport, backup retention, file pickers, downloads, secret storage, aggregate system metrics, opaque directory approvals, fixed Git inspection, and bounded recent-file enumeration/actions.

Scripts run as ordered classic scripts to retain direct local-file operation. Top-level declarations must therefore remain unique; `tests/test_global_script_symbols.cjs` enforces this until remaining code is moved behind explicit namespaces or modules.

## Development rules

- Treat `state.js` as the state/persistence layer, `render.js` as the composition layer, and `app.js` as startup and UI orchestration.
- Never silently replace a configured shared database with an empty browser cache.
- Use widget draft state for settings previews; only Done may commit and persist changes.
- Keep page-originated extension commands bound to the exact registered Hub session.
- Keep platform-specific behavior behind the bridge/native-host boundary.
- Preserve consistent drag/drop semantics and the existing folder-depth limit.
- Prefer targeted rendering for small changes and preserve expensive map/globe instances when their widget state has not changed.
- Treat meaningful widget UI state as restorable by default. Selected tabs, filters, pages/items, expanded or collapsed panels and provider attribution, map/globe cameras, focus modes, and meaningful scroll positions must survive Hub reloads through bounded per-instance `WidgetSDK.cache` view state. Keep that state browser-local and out of portable `widget.config` / `widget.data`; clear it when the widget is deleted. Only deliberately transient interactions may reset, and that exception should be explicit and tested. Universal Search's unfinished query and keyboard-highlighted result are deliberate transient exceptions; completed recent searches may still be remembered locally when enabled.
