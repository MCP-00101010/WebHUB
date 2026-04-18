# TODO for Morpheus WebHUB

## File structure

## Optimization

- add undo/redo for deletions — easy to accidentally remove something with no recovery
- add a "recently deleted" buffer as an alternative recovery mechanism for accidental deletes
- auto-export on a schedule (e.g. daily JSON backup written to Downloads)

## UI

- sidebar collapse toggle — chevron button to hide the sidebar and give the board full width
- smooth transition / animation when switching boards
- keyboard shortcut to focus search bar (`/` or `Ctrl+F`)
- keyboard shortcut `N` for new bookmark in the focused column
- Global Settings panel getting a little bit cluttered. Split between behavioral and style settings.
- board tab bar as alternative navigation style (tabs across the top instead of sidebar list) (possibly a great QoL thing. but i will eventually have a rather big collection of boards. thats why i want to be able to store boards inside folders. possible solution: select a board folder in the navpane and the boards in this folder will go into the board tab bar)
- Global Settings: Select Icon size for Speed Dial / Essentials via radio buttons. Give small/medium/large options. set them with sensible values.
- Essentials: enable/disable the display of the Essential rows in global settings behavioral settings. (not every user might want them). If disabled, don't delete any stored essentials. just don't show them.
- Essentials: Adjust the amount of Essentials displayed. Spread them equally amongst rows based on icon size / sidebar width. If amount of displayed essentials is less than actually stored essentials, don't delete them. just don't display them. (probably means essentials have to be stored in a list of type bookmarks to work properly)
- Speed Dial: enable/disable the display of the speed dial bar in the board settings. if disabled don't delete the speed dial bookmarks. just don't display the bar.

## Bookmarks

- "Open all" context menu option on folders — opens every bookmark in the folder as new tabs
- favicon refresh option on right-click context menu (force re-fetch, clear stale cache)
- duplicate / copy bookmark via context menu
- "Move to board" option in bookmark context menu (alternative to cross-board drag)
- bulk operations: multi-select bookmarks for bulk delete, tag, or move
- browser bookmark import — parse the standard HTML export format all browsers produce
- duplicate bookmark detection / warning when adding a URL already in the hub

## Board Backgrounds

- background image browser using `webkitdirectory` folder picker — user selects their `backgrounds` folder once, app shows a thumbnail grid, clicking a thumbnail sets it as the board background (stored as data URL, same path as drag-drop). Browser remembers the last-used folder so subsequent opens land there automatically. Starting directory cannot be set programmatically — user navigates there manually the first time.

## Customization

- theme support for the whole ui? -> standard color themes for ui elements, maybe support for downloadable themes like dracula or cattpuchin similar to how VSCode or Windows Terminal do it.
- custom CSS input field in global settings for power users (save for late, not urgent. very specific)

## Widgets

- widget support as a new board item type alongside bookmarks, folders, titles and dividers
- to-do list widget (checklist with add/remove/check-off)
- clock widget (live time display, configurable timezone/format)
- weather widget (current conditions, configurable location)
- image widget (display a static image or gif inline in a column)
- news feed / RSS widget (fetch and display headlines from a feed URL)
- notes widget (freeform text / markdown block)
- countdown widget (days until a target date)

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
- **Configurable paths** — let the user set the database path and backgrounds folder path in extension settings.
- send the currently open browser tab as a bookmark to the hub. maybe into some form of "inbox" folder that shows up in the context menu in the hub when something is in it. the user then selects the incoming bookmark from the list and it gets inserted where the user invoked the context menu (essentials/speedial/in one of the columns in the bookmarks pane - great QoL!)

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

## Storage
