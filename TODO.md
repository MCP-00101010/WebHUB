# TODO for Morpheus WebHUB

## Optimization

- auto-export on a schedule (e.g. daily JSON backup written to Downloads)

## UI

- board tab bar as alternative navigation style (tabs across the top instead of sidebar list) (possibly a great QoL thing. but i will eventually have a rather big collection of boards. thats why i want to be able to store boards inside folders. possible solution: select a board folder in the navpane and the boards in this folder will go into the board tab bar)
- tag manager panel (list all known tags, click to add/remove from a bookmark, rename/delete tags globally)

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

- add native File Access API to the Hub for users on Chromium based Browsers so the extension is only needed on Firefox Browsers.
- Write Documentation for the Hub
- Add localisation for other languages to the Hub
- (Re-) Structure the code with readability in mind. Add human-readable comments to the code to explain what each data type is, what each function does etc.

## Current issues / bugs

- ~~when dragging an object into an empty column, the blue preview indicator shows at the bottom of the column but the object gets inserted at the top.~~ ✓ *Fixed [0.6.1]*
- ~~objects in columns seem to be rendered outside column boundaries occasionally. particular objects in nested folders as they are indented a little.~~ ✓ *Fixed [0.6.1]*
- ~~in bulk operations: bulk adding tags panel has a name field which we don't need.~~ ✓ *Fixed [0.6.1]*
- ~~in bulk operations: move to board panel has a name field.~~ ✓ *Fixed [0.6.1]*
- ~~in bulk operations: delete confirmation button always says "Delete 1 Item" regardless of how many items are selected.~~ ✓ *Fixed [0.6.1]*
- ~~smart tag prediction: the drop down menu can get pretty long.~~ ✓ *Fixed [0.6.1] — inline address-bar-style prediction; wired to all tag inputs in [0.7.1]*
  - hub should have a list of generally used tags baked into its config as a base. (QoL — open)
  
## Tag Manager

after importing my 650 strong bookmark library from firefox into the hub I think we need a sophisticated and advanced tag management system that can handle bookmark collection of any size. I have a couple of ideas for that:
- assign tags to a folder -> bookmarks and subfolders in this folder automatically inherit the tags from their parent folder. (should work with nested folder as well):
  - Folder "Physics" has tags [Science Physics] from user
    - Folder "Astronomy" has tag [Astronomy] from user and inherits [Science Physics] from parent
      - Bookmark "JWST" inherits [Science Physics Astronomy] automatically from parent
    - Folder Optics has tag [Optics] from user and inherits [Science Physics] from parent
      - Bookmark "Photon Theory" inherits [Sciene Physics Optics] from parent
      - 
folders need a toggle-able flag wether or not to pass on tags to their children and another flag to remove the folders tags from a child when the child gets moved out of that folder (useful for incoming or unsorted folders/tags). This has obviously an impacty on DnD logic. Tags have to be auto-added to a bookmark when it gets created inside a folder or dragged into a folder and removed if a bookmark is moved out this folder (respecting if auto-inherit and auto-remove for this folder are enabled/disabled).
same logic should be added to boards. Boards can pass tags to child folders and bookmarks. folders pass on tags to subfolders and child bookmarks.

-> add tags to boards and folders
-> give boards and folders a setting to enable/disable passing their tags on to their children
-> give boards and folders a setting to enable/disable to auto-remove their tags from their children when the children leaves the parent
-> when passing on tags, check if the child already has the tag to avoid double-tagging
-> when auto removing check if the trait is already gone (the user might have removed the tag)

-> we need to split tags on folders and bookmarks into inherited tags and user-added tags so the user always knows where the tags came from

-> Maybe (??) add an option to folders and bookmark to ignore tag inheritance from their parents. if the object already has inherited tags when this option gets activated, clear the inherited tags. if it gets deactivated again, recurse through all parent levels and get the add inherited tags to the object. However this gets complicated if a folder that ignores inheritance has children... do they then also ignore inheritance? Complicated...

on top of that i'd like to build a solid database of already known tags, structured by Subject/Theme/Relation ... something like this:

science { biology chemistry physics mathematics }

ratings { 1-star 2-star 3-star 4-star 5-star}

fiction-genres { sci-fi fantasy horror mystery drama comedy thriller adventure }

we assign a color to each group name (lets say science is green). then any tag in the science group will also be green (maybe a lighter green?)
a tag in one category could also have its own subcategory (physics is a tag in the science category but can be its own group with {astronomy astro-physics optics relativity mechanics}) etc. how do we auto-assign color here ???

and so on and so.... very complex subject that needs some thought. 

## Import Manager

another idea i had after importing my 650 strong bookmark library is to create an Import Manager. Instead of importing the whole bookmarks file into the active board, importing html bookmarks files from a browser opens the Import Manager. The Import Manager visualizes the whole bookmark file in tree-form. from there the user can edit folders and bookmarks the same way as in the hub (change names, add/remove tags etc), remove bookmarks and folders (and with them their children) from the Import Manager or send them to a Board in the Hub (which removes them from the Import Manager). Data in the Import Manager is persistent (so will be part of our database) so the user can close the Import Manager and come back to it another time to continue sorting his bookmarks.
This could make use of the inbox feature i described in the firefox extension logic. instead of a global incoming box each board should have one. A board with an incoming box that contains any objects shows a visual indicator somewhere near the board name in board pane. the user can open the inbox and drag and drop objects into the board. (Could this be rendered like a floating column so the user can drag it around?)
(To avoid creating a whole new UI for this, we can just create Board called "Import Manager" with no speed dial pane and only one column. Can get a very long column depending how many bookmarks we are importing but that would provide all the functionality we need). The Import Manager will be visible on first position in the navpane when it contains any objects, otherwise its hidden. 

## Action Plan

Strategic implementation order based on dependency analysis. Each phase minimises the risk of having to rewrite code added in an earlier phase.

---

### Phase 1 — Polish & quick wins ✓ *Completed 2026-04-18*

See [0.4.0] in CHANGELOG.

---

### Phase 2 — State architecture stabilisation ✓ *Completed 2026-04-18*

See [0.5.0] in CHANGELOG.

---

### Phase 3 — Bookmark management features ✓ *Completed 2026-04-18*

See [0.6.0] in CHANGELOG.

---

### Phase 3.5 — Bug fixes & small UX ✓ *Completed 2026-04-18*

See [0.6.1] in CHANGELOG.

---

### Phase 4 — Tag system overhaul ✓ *Completed 2026-04-18*

*See [0.7.0] in CHANGELOG.*

*Foundational. Touches state schema, DnD logic, and every item-facing UI. Must land before widgets (which may also carry tags) and before the extension (tag propagation is independent of file I/O).*

**State schema changes:**
- Add `tags[]` and `inheritedTags[]` to folder and board objects (bookmark already has `tags[]`)
- Add `inheritTags: boolean` flag to boards and folders (default `true`) — controls whether this node passes its tags down to children
- Add `autoRemoveTags: boolean` flag to boards and folders (default `false`) — when `true`, removes this node's tags from a child when the child is moved out
- `inheritedTags` is always computed/derived — never manually set by the user; shown read-only in the UI

**Tag propagation logic:**
- On item creation inside a folder/board: compute and apply `inheritedTags` by walking up the parent chain
- On DnD move: remove `inheritedTags` from old parent chain (if `autoRemoveTags` is set), add `inheritedTags` from new parent chain (if `inheritTags` is set); always check for duplicates before adding
- Helper: `computeInheritedTags(itemId)` — walks parent chain, collects tags from all ancestors where `inheritTags === true`

**Tag categories & colours:**
- Built-in tag database: predefined groups (science, ratings, fiction-genres, etc.) each with an assigned colour
- Tags in a group inherit the group colour (lighter tint for child tags)
- Tag category editor in the Tag Manager panel: add/rename/delete groups, assign colours, move tags between groups
- Unknown tags (not in any group) render in a neutral colour

**Tag Manager panel (new UI):**
- Lists all known tags across the entire database
- Click a tag to see which items carry it
- Rename or delete a tag globally (renames/removes it from every item)
- Assign tags to groups / drag tags between groups

**Deferred (implement once inheritance is stable):**
- Per-item "ignore inheritance" toggle — when activated, clears inherited tags and stops receiving them from any ancestor; when deactivated, re-derives inherited tags by walking the parent chain. Children of an ignoring-folder edge case requires separate design session before implementation.

---

### Phase 5 — Board inbox & Import Manager ✓ *Completed 2026-04-19*

See [0.8.0] in CHANGELOG.

---

### Phase 6 — Firefox extension & native bridge
*Inbox from Phase 5 is already in place — extension just needs to write to it. Build the API contract first.*

1. **Design the postMessage API spec** — define all message types and response shapes before writing a single line of extension code. This is the most important design decision in this phase.
2. Native messaging host (Python or Node, ~50 line
3. s)
4. Firefox extension (Manifest V3, content script on `file://` pages)
5. Page-side bridge module — wraps postMessage in promises, **gracefully falls back** if extension is absent (existing manual export/import remains the fallback path)
6. Chromium / File Access API shim — implement the same bridge interface using `window.showOpenFilePicker` / `showDirectoryPicker` so the hub works on Chrome/Edge without the extension
7. Auto-save / auto-load wiring — replace manual export/import with silent reads/writes when bridge is available
8. Background folder browser UI (reuses existing data URL + background image pipeline)
9. Theme file browser (scans `./themes` folder, used by Phase 7)
10. "Send current tab" button in extension → active board's inbox column

---

### Phase 7 — Theme system
*Depends on Phase 6 for file save/load. Must audit CSS variables before building the picker or theme files will be incomplete.*

1. Audit and lock all CSS custom properties — produce a definitive list of what a theme file must contain
2. Define theme JSON schema
3. Built-in themes: default dark, light, Dracula, Catppuccin Mocha (at minimum)
4. Theme picker UI in global settings
5. Extension: scan `./themes` folder, load selected theme, save current theme as file

---

### Phase 8 — Widget framework
*Comes after state is stable and after tag system (widgets may carry tags). Build the framework before individual widgets so each widget slots in cleanly.*

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

### Phase 9 — Advanced navigation & DnD
*Last because board tab bar depends on the folder-of-boards concept being fully exercised, and DnD preview improvements should cover widgets (Phase 8) in one pass rather than being done twice.*

- Board tab bar (folder-selected boards populate the tab strip)
- DnD live previews — render actual item instead of blue placeholder frame

---

### Phase 10 — Documentation, localization & code health

*Post-feature-freeze. Adding i18n infrastructure mid-build means re-extracting strings from every new feature added after. Do this once, at the end, when the string surface is stable.*

1. **Code restructuring** — reorganise source files for readability; add JSDoc-style comments to all major functions and data types. No behavioural changes.
2. **Localisation (i18n)** — extract all user-facing strings into a locale file (`en.json`); wire a locale-loader so additional language files can be dropped in. Provide at least English + one additional language as proof-of-concept.
3. **Documentation** — write user-facing `README.md` covering installation, usage, file structure, and the extension setup. Write a brief developer guide covering state schema, rendering pipeline, and bridge API.

---

### Cross-cutting notes

- **Browser / OS agnosticism:** the page-side bridge (Phase 6, step 4–5) is the key. The hub itself stays vanilla JS with zero dependencies. The bridge abstracts file access behind a common interface — extension on Firefox/Zen, File Access API on Chromium, manual fallback everywhere else. No platform-specific code leaks into the app itself. The Chromium File Access API shim (Phase 6 step 5) also satisfies the *Compatibility* section item for native Chromium support.
- **Extension as optional enhancement:** the hub must remain fully functional without the extension. The bridge fallback path ensures this. Gate every extension-dependent UI element on `bridge.isAvailable()`.
- **Inbox as the universal delivery mechanism:** the per-board inbox (Phase 5) is the single intake point for all external delivery — "move to board", the Firefox extension tab sender, and the Import Manager all funnel through it. Keep the inbox path stable; do not bypass it.
- **Tag inheritance before ignore-toggle:** the "ignore inheritance" per-item flag is intentionally deferred. Do not implement it until the core inherit/auto-remove system has been live for at least one phase and edge cases are understood.
- **Settings panel real-estate:** the split in Phase 1 is a prerequisite for Phase 7 (theme picker) and Phase 8 (widget global defaults). Do it early or the panel becomes unmanageable.
- **`webkitdirectory` background picker:** deprioritised — superseded by the extension background browser in Phase 6. Only implement if the extension stalls.
- **Versioning & changelog:** both established in Phase 1. Every git commit from that point forward should include a `CHANGELOG.md` entry. The version constant lives in a single place in `app.js` (or a dedicated `version.js`) — never hardcoded in multiple files.
- **Code comments & readability:** add comments incrementally as you touch each area rather than doing one big sweep mid-project. The Phase 10 pass is for the final structured cleanup, not an excuse to defer all commenting.
