# Morpheus WebHub Widget SDK

The Widget SDK is a classic-script API for trusted built-ins and explicitly enabled local packages. It does not load remote JavaScript. Built-in descriptors are normalized automatically; local packages register through `WidgetSDK.registry.register()`.

## Descriptor contract

Every widget declares:

- `id`, `name`, `category`, `description`, and `allowedIn`
- `defaultConfig`, `defaultData`, and an object-shaped `settingsSchema`
- `render(widget, element, context)` and optional `reload`, `cleanup`, and `migrate` hooks
- `responsive` width/height hints
- `capabilities` selected from `network`, `extensionRelay`, `nativeHost`, `secureCredentials`, `filesystemPaths`, `geolocation`, `notifications`, `timers`, `localCache`, and `assetCache`

Network capabilities list exact hostnames. Use `user-configured` only when the URL is part of the user's widget configuration. Mark a capability `{ optional: true }` when the widget can still provide a useful reduced experience without it.

## Runtime services

- `WidgetSDK.runtime.schedule(key, task, intervalMs)` provides one visibility-aware schedule per key, error backoff, and cancellation.
- `WidgetSDK.runtime.requestFrame(key, callback)` provides a cancellable animation frame that is included in widget teardown.
- `WidgetSDK.network.request(...)` is used by the Hub network helper to enforce declared domains, concurrency, timeouts, and response-size bounds.
- `WidgetSDK.cache.get/set/remove(widgetType, widgetId, key)` stores small browser-local, expiring values within a per-widget quota; `migrateLegacy(...)` moves an older local-storage entry into that namespace once.
- `WidgetSDK.assets.metadata/list/get/set/remove/clear(widgetType, key)` stores explicitly declared large binary assets in IndexedDB, outside portable Hub state and the small local-storage cache.
- `WidgetSDK.extensionRelay.invoke(widgetType, method, ...args)` and `supports(...)` gate optional extension operations behind the descriptor capability.
- `WidgetSDK.nativeHost.invoke(widgetType, method, ...args)` and `supports(...)` gate fixed-purpose native operations behind the descriptor capability and native availability.
- `WidgetSDK.credentials.status/get/set/remove(...)` provides the secure-credential boundary without exposing the bridge to widget implementations.
- `WidgetSDK.settings.validateDraft(descriptor, widget)` validates configuration before persistence.
- `WidgetSDK.runtime.teardown(widget)` cancels schedules and requests, then invokes cleanup exactly once.

View preferences and small samples belong in `WidgetSDK.cache`; downloaded binary resources belong in `WidgetSDK.assets`; portable configuration belongs in `widget.config`; user content belongs in `widget.data`. Never place credentials, filesystem paths, browser tab IDs, or cache payloads in shared widget state.

Meaningful UI state is restorable by default. A widget should save selected tabs, filters, pages/items, expanded or collapsed details and attribution, map/globe cameras, focus modes, and meaningful scroll positions as bounded per-instance `view` data in `WidgetSDK.cache`. Restore it after widget and Hub reloads, keep it out of portable configuration and content, and remove it from the widget's `dispose` hook. State that is intentionally transient should be documented and covered by a test. Universal Search's unfinished query and keyboard-highlighted result are deliberate transient exceptions; completed recent searches may still be remembered locally when enabled.

## Develop locally

1. Copy `widget-template.js` and `widget-template.css` under a new local package directory.
2. Keep the package disabled in production while developing. The fixture's Enable button sets the browser-local opt-in flag.
3. Open `fixture.html`, register the package, exercise resize/reload/cleanup, and inspect the descriptor report.
4. Validate a JSON manifest with `node validate-widget-manifest.cjs manifest.example.json`.
5. Add contract tests before placing a script in the Hub's ordered script list.

Local packages are deliberately opt-in. Registration marks them as untrusted and does not grant capabilities; a future installer can build on this boundary without treating external code as a built-in.
