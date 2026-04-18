# TODO for Morpheus WebHUB

## File structure

## Optimization

- add undo/redo for deletions — easy to accidentally remove something with no recovery
- add a "recently deleted" buffer as an alternative recovery mechanism for accidental deletes
- auto-export on a schedule (e.g. daily JSON backup written to Downloads)

## UI

- ~~sidebar collapse toggle — chevron button to hide the sidebar and give the board full width~~ ✓
- ~~smooth transition / animation when switching boards~~ ✓
- ~~keyboard shortcut to focus search bar (`/` or `Ctrl+F`)~~ ✓
- ~~keyboard shortcut `N` for new bookmark in the focused column~~ ✓
- ~~Global Settings panel getting a little bit cluttered. Split between behavioral and style settings.~~ ✓
- board tab bar as alternative navigation style (tabs across the top instead of sidebar list) (possibly a great QoL thing. but i will eventually have a rather big collection of boards. thats why i want to be able to store boards inside folders. possible solution: select a board folder in the navpane and the boards in this folder will go into the board tab bar)
- ~~Global Settings: Select Icon size for Speed Dial / Essentials via radio buttons. Give small/medium/large options. set them with sensible values.~~ ✓
- ~~Essentials: enable/disable the display of the Essential rows in global settings behavioral settings. (not every user might want them). If disabled, don't delete any stored essentials. just don't show them.~~ ✓
- ~~Essentials: Adjust the amount of Essentials displayed. Add Setting to Essentials box in global behavioral settings. Spread them equally amongst rows based on icon size / sidebar width. If amount of displayed essentials is less than actually stored essentials, don't delete them. just don't display them.~~ ✓ Essentials refactored to compact bookmark list; display count stepper in Behavior settings (1–24)
- ~~Speed Dial: enable/disable the display of the speed dial bar in the board settings. if disabled don't delete the speed dial bookmarks. just don't display the bar.~~ ✓
- smart tags prediction: when the user adds tags, predict the tag while typing based on the list of already known tags. tab-key to complete tag. also possibly have a separate edit tags panel available via context menu with extended tab management. List all known tags, add tags to bookmark by clicking on them, remove tag by clicking on it etc. (Or better to add this to the general create/edit bookmark panel?)

## Bookmarks

- ~~"Open all" context menu option on folders — opens every bookmark in the folder as new tabs~~ ✓
- ~~favicon refresh option on right-click context menu (force re-fetch, clear stale cache)~~ ✓
- ~~duplicate / copy bookmark via context menu~~ ✓
- "Move to board" option in bookmark context menu (alternative to cross-board drag)
- bulk operations: multi-select bookmarks for bulk delete, tag, or move
- browser bookmark import — parse the standard HTML export format all browsers produce
- duplicate bookmark detection / warning when adding a URL already in the hub

## Board Backgrounds

- background image browser using `webkitdirectory` folder picker — user selects their `backgrounds` folder once, app shows a thumbnail grid, clicking a thumbnail sets it as the board background (stored as data URL, same path as drag-drop). Browser remembers the last-used folder so subsequent opens land there automatically. Starting directory cannot be set programmatically — user navigates there manually the first time. (probably no longer needed if we use a firefox extension to handle file access for us)

## Customization

- theme support for the whole ui? -> standard color themes for ui elements, maybe support for downloadable themes like dracula or cattpuchin similar to how VSCode or Windows Terminal do it.
- custom CSS input field in global settings for power users (save for late, not urgent. very specific)

## Widgets

- widget support as a new board item type alongside bookmarks, folders, titles and dividers
- to-do list widget (checklist with add/remove/check-off)
- clock widget (live time display, configurable timezone/format)
- weather widget (current conditions, configurable location)
- image widget (display a static image or gif inline in a column) (allow the fetch from url for things like NASA image of the day)
- news feed / RSS widget (fetch and display headlines from a feed URL)
- notes widget (freeform text / markdown block)
- countdown widget (days until a target date and or time)

## Drag and Drop functionality

- previews: instead of rendering these blue frames to indicate where the object we are currently drag will end up when we drop it, can we render the actual object? to reduce the little flicker, only update the preview when the order of objects on screen does actually change. (Modernization/QoL)

## Firefox Extension (Native Bridge) (!! Should be added sooner rather than later as features like backgound image browser and loading/saving of color schemes and font settings depend on it)

A companion Firefox extension + native messaging host that gives the app true file system access without any browser security prompts after initial install. Transforms Morpheus WebHub into a proper local-first app.

**Extension capabilities (via content script → background worker → native host):**
- **Auto-save** — write the JSON database to a fixed local path on every change, no "Save As" dialog
- **Auto-load** — read the JSON from that path on startup and inject it into the page before the app initialises, replacing the current import flow entirely
- **Background folder browser** — serve a directory listing of `./backgrounds` (and subfolders) as a thumbnail grid inside the board settings panel
- **Theme Browser** serve a directtory listing of `./themes` (and subfolders) inside the Hub's theme settings dialog. also allow the Hub to save the current color theme.
- **Watch for external file changes** — detect if the JSON was modified externally (e.g. Dropbox/OneDrive sync) and prompt the user to reload
- **Configurable paths** — let the user set the database path and backgrounds folder path in extension settings. (!great - allows the database to be stored in a cloud folder like Dropbox or Proton Drive. Allows sync between multiple systems/browsers)
- send the currently open browser tab as a bookmark to the hub. maybe into some form of "inbox" folder that shows up in the context menu in the hub when something is in it. the user then selects the incoming bookmark from the list and it gets inserted where the user invoked the context menu (essentials/speedial/in one of the columns in the bookmarks pane - great QoL!)
- Should the extension replace the current manual load/save database or be an alternative? Not everyone might want to grant a browser extension access to their file system. (if extension installed -> let the extension handle file access etc, if not the user has to do it all manually)

**Architecture:**
```
WebHub page → postMessage → content script → background worker → native messaging host (Python or Node) → file system
```

**Implementation phases:**
1. Native messaging host — tiny Python/Node script that reads/writes files and lists directories
2. Firefox extension — manifest v2/v3, content script injected on the WebHub file:// page
3. Page-side bridge — thin JS module that wraps postMessage calls with promises, falls back gracefully if extension is not installed
4. Background folder browser UI — thumbnail grid in board settings, reusing existing data URL + background image pipeline
5. Auto-save/load wiring — replace manual export/import with silent file reads/writes

How do we handle the Hub run on different browsers then? As I understand Chrome based Browsers support File Access API natively. Just want to ensure the hub ultimately runs on all major browsers (personally only use Firefox/Zen atm - but in the bigger picture it should run anywhere). How about Edge/Opera? On a similar note: Will implementing the firefox extension and supporting File Access API on Chromium based browsers keep the Hub OS agnostic?

## Storage

---

## Compatibility / Portability / Readability

- add native File Access API to the Hub for users on Chromium based Browsers so the extension is ony needed on Firefox Browsers.
- Write Documentation for the Hub
- Add localisation for other languages to the Hub
- (Re-) Structure the code with readability in mind. Add human-readable comments to the code to explain what each data type is, what each function does etc.
- ~~add a version numbering system to the code~~ ✓ `APP_VERSION = '0.4.0'` in app.js; version badge in sidebar footer
- ~~add an About dialog~~ ✓ About panel accessible from the version badge
- ~~add a changelog~~ ✓ `CHANGELOG.md` created at project root

## Action Plan

Strategic implementation order based on dependency analysis. Each phase minimises the risk of having to rewrite code added in an earlier phase.

---

### ~~Phase 1~~ — Polish & quick wins ✓ *Completed 2026-04-18*

- ~~Version number + About dialog~~ ✓ `APP_VERSION = '0.4.0'`, sidebar badge, About panel
- ~~Changelog~~ ✓ `CHANGELOG.md` created, updated on every commit from here
- ~~Settings panel split (behavioral / style tabs)~~ ✓ Style / Behavior tabs in Global Settings
- ~~Icon size radio buttons for Speed Dial / Essentials~~ ✓ S/M/L radios in Behavior tab
- ~~Essentials show/hide toggle + Speed Dial show/hide per-board toggle~~ ✓
- ~~Keyboard shortcuts (`/` for search focus, `N` for new bookmark)~~ ✓ also `Ctrl+F`
- ~~Sidebar collapse toggle~~ ✓ chevron button, animated transition
- ~~Smooth board switch transition~~ ✓ fade-in animation on board change
- ~~"Open all" context menu on folders~~ ✓
- ~~Favicon refresh on right-click, duplicate/copy bookmark~~ ✓

---

### Phase 2 — State architecture stabilisation
*State schema changes. Must land before widgets or the extension touch state, to avoid migrating twice.*

- ~~**Essentials refactor** — convert fixed 10-slot array to a proper bookmark list with a configurable display count.~~ ✓ Compact array, display count 1–24 in settings, full DnD migration
- Undo / redo + recently-deleted buffer — also touches state internals; bundle with the essentials refactor session to keep migrations together.

---

### Phase 3 — Bookmark management features
*Self-contained feature set with no impact on other phases.*

- "Move to board" context menu option
- Bulk select / bulk operations (delete, tag, move)
- Browser bookmark HTML import
- Duplicate URL detection on add
- Smart tag prediction — autocomplete while typing tags using the known-tag list; Tab to complete. Optionally, a tag manager panel (list all tags, click to add/remove from a bookmark). Build after bulk-tag operations so the tag data model is settled.

---

### Phase 4 — Firefox extension & native bridge
*Unlocks background browser, theme file I/O, auto-save/load, and the bookmark inbox. Build the API contract first so the UI built in later phases doesn't need rewriting.*

1. **Design the postMessage API spec** — define all message types and response shapes before writing a single line of extension code. This is the most important design decision in this phase.
2. Native messaging host (Python or Node, ~50 lines)
3. Firefox extension (Manifest V3, content script on `file://` pages)
4. Page-side bridge module — wraps postMessage in promises, **gracefully falls back** if extension is absent (existing manual export/import remains the fallback path)
5. Chromium / File Access API shim — implement the same bridge interface using `window.showOpenFilePicker` / `showDirectoryPicker` so the hub works on Chrome/Edge without the extension
6. Auto-save / auto-load wiring — replace manual export/import with silent reads/writes when bridge is available
7. Background folder browser UI (reuses existing data URL + background image pipeline)
8. Bookmark inbox — "send current tab" button in extension → inbox folder in hub

---

### Phase 5 — Theme system
*Depends on Phase 4 for file save/load. Must audit CSS variables before building the picker or theme files will be incomplete.*

1. Audit and lock all CSS custom properties — produce a definitive list of what a theme file must contain
2. Define theme JSON schema
3. Built-in themes: default dark, light, Dracula, Catppuccin Mocha (at minimum)
4. Theme picker UI in global settings
5. Extension: scan `./themes` folder, load selected theme, save current theme as file

---

### Phase 6 — Widget framework
*Comes after state is stable (Phase 2) and before DnD improvements, because widgets may have variable heights that affect drag behaviour. Build the framework before individual widgets so each widget slots in cleanly.*

1. Design widget item type in state schema (type, config object, live data store)
2. Widget rendering framework — how widgets size, resize, and sit alongside bookmarks in columns
3. Widget settings modal pattern (reuse existing modal infrastructure)
4. Individual widgets in complexity order:
   - Clock (simplest — pure JS, no external data)
   - Notes (freeform text / markdown)
   - To-do list (local state, checklist)
   - Countdown (target date/time)
   - Image (URL or local via extension bridge)
   - Weather (external API, configurable location)
   - News feed / RSS (external fetch, configurable URL)

---

### Phase 7 — Advanced navigation & DnD
*Last because board tab bar depends on the folder-of-boards concept being fully exercised, and DnD preview improvements should cover widgets (Phase 6) in one pass rather than being done twice.*

- Board tab bar (folder-selected boards populate the tab strip)
- DnD live previews — render actual item instead of blue placeholder frame

---

### Phase 8 — Documentation, localization & code health
*Post-feature-freeze. Adding i18n infrastructure mid-build means re-extracting strings from every new feature added after. Do this once, at the end, when the string surface is stable.*

1. **Code restructuring** — reorganise source files for readability; add JSDoc-style comments to all major functions and data types. No behavioural changes.
2. **Localisation (i18n)** — extract all user-facing strings into a locale file (`en.json`); wire a locale-loader so additional language files can be dropped in. Provide at least English + one additional language as proof-of-concept.
3. **Documentation** — write user-facing `README.md` covering installation, usage, file structure, and the extension setup. Write a brief developer guide covering state schema, rendering pipeline, and bridge API.

---

### Cross-cutting notes

- **Browser / OS agnosticism:** the page-side bridge (Phase 4, step 4–5) is the key. The hub itself stays vanilla JS with zero dependencies. The bridge abstracts file access behind a common interface — extension on Firefox/Zen, File Access API on Chromium, manual fallback everywhere else. No platform-specific code leaks into the app itself. The Chromium File Access API shim (Phase 4 step 5) also satisfies the *Compatibility* section item for native Chromium support.
- **Extension as optional enhancement:** the hub must remain fully functional without the extension. The bridge fallback path ensures this. Gate every extension-dependent UI element on `bridge.isAvailable()`.
- **Settings panel real-estate:** the split in Phase 1 is a prerequisite for Phase 5 (theme picker) and Phase 6 (widget global defaults). Do it early or the panel becomes unmanageable.
- **`webkitdirectory` background picker:** deprioritised — superseded by the extension background browser in Phase 4. Only implement if the extension stalls.
- **Versioning & changelog:** both established in Phase 1. Every git commit from that point forward should include a `CHANGELOG.md` entry. The version constant lives in a single place in `app.js` (or a dedicated `version.js`) — never hardcoded in multiple files.
- **Code comments & readability:** add comments incrementally as you touch each area rather than doing one big sweep mid-project. The Phase 8 pass is for the final structured cleanup, not an excuse to defer all commenting.
