# EmuGUI and Morpheus WebHub Integration Plan

## Goal

Keep Morpheus EmuGUI as the complete game-library manager while making Morpheus WebHub the convenient launcher for a small selection of frequently played games.

EmuGUI remains responsible for collections, metadata, artwork, scraping, emulator configuration, and launch testing. WebHub receives compact game shortcuts from EmuGUI and organises them like bookmarks and applications in columns, folders, tabs, Inboxes, Hub Search, and the command palette.

Replace EmuGUI's manually started localhost server with the existing Morpheus WebHub extension and persistent native-host architecture. The Firefox extension acts as the authenticated broker and UI host; filesystem access, collection maintenance, and emulator launches remain in Python native services.

## Product Boundaries

### EmuGUI Responsibilities

- Discover, add, select, scan, and rebuild game collections.
- Maintain `collection-metadata.json` and future versioned library formats.
- Parse TOSEC and other collection naming conventions.
- Edit, preview, rename, move, import, restore, and remove game files safely.
- Manage incoming, review, language, and trash workflows.
- Scrape and edit metadata and artwork.
- Manage emulator executables, launch adapters, profiles, profile-selection rules, helpers, and configuration files.
- Test a game launch before creating a WebHub shortcut.
- Track full-library favourites and recent games where useful to EmuGUI.
- Send selected games to the active WebHub Inbox with a compact launcher payload.

### WebHub Responsibilities

- Receive games explicitly sent by EmuGUI.
- Store games as first-class `game` items alongside bookmarks, folders, applications, and widgets.
- Display a game name, bounded thumbnail, Hub tags, and native binding state.
- Organise game items in board columns, folders, tabs, and Inboxes.
- Support normal Hub movement, Send To, tags, locks, Undo, Trash, duplication, search, and command-palette behaviour.
- Launch a game through an opaque device-local binding.
- Reveal the game file, open the game in EmuGUI, rebind it, or forget its device binding.
- Preserve safe unbound placeholders when portable Hub data is opened on another device.

### Out of Scope for WebHub

- Scanning or browsing entire ROM collections.
- Scraping or editing game metadata.
- Managing incoming files, trash, POKs, or collection maintenance.
- Configuring emulator paths, profiles, helpers, or command templates.
- Storing ROM paths, emulator paths, working directories, profile paths, or launch arguments in the portable Hub database.
- Importing tens of thousands of games into the main Hub state.

## Target Architecture

```text
                    Morpheus WebHub Extension
                  +----------------------------+
WebHub page <---->| authenticated message hub  |<----> EmuGUI extension page
                  +-------------+--------------+
                                | persistent native connection
                                v
                  Morpheus native host
                  |- existing WebHub services
                  `- EmuGUI service
                     |- collection management
                     |- metadata and artwork
                     |- scraper jobs
                     |- emulator profiles
                     `- game launch adapters
```

Firefox extension code cannot directly scan arbitrary collections or launch local processes. The extension replaces the HTTP transport and manual server lifecycle, not the native Python backend. The native host performs the privileged work through bounded, authenticated operations.

## Compact WebHub Game Item

The portable Hub item should contain only presentation data and an opaque device binding:

```js
{
  id: "game-item-...",
  type: "game",
  title: "Jetpac",
  gameKey: "game_opaque_device_binding",
  tags: ["ZX Spectrum", "Games"],
  thumbnailCache: "data:image/webp;base64,..."
}
```

Optional non-sensitive source IDs may be retained to assist explicit rebinding, but they must never grant launch authority by themselves.

The Hub item must not contain:

- ROM, disk-image, manifest, or game-directory paths.
- Emulator, helper, working-directory, or profile paths.
- Raw command strings, argument templates, environment variables, or shell text.
- Scraper credentials or full EmuGUI metadata records.

Thumbnails should be resized before delivery, encoded in a safe image format, and subject to strict dimension and byte limits. Portable exports should follow the Hub's existing option for excluding favicon and application/game image caches.

## Device-Local Game Binding

When EmuGUI sends a game, the native service creates or reuses a local binding:

```text
gameKey
  libraryId
  stable gameId
  launcherAdapterId
  emulatorId
  profileId or bounded profile-selection rule
```

At launch time, the native host resolves the current game target from EmuGUI's library metadata. This allows file moves and renames performed by EmuGUI to flow through to existing Hub shortcuts when the stable game ID is retained.

Updating an emulator or profile in EmuGUI should update all bindings that reference its ID. Deleting or invalidating a referenced library, game, emulator, or profile should produce a clear Hub status instead of silently falling back to another executable.

Recommended binding states:

- `ready`
- `unbound`
- `library-missing`
- `game-missing`
- `emulator-missing`
- `profile-missing`
- `incompatible`
- `changed`
- `unavailable`

Imported game items must receive a fresh unbound key unless the user explicitly rebinds them. A public library/game identity may assist the rebind UI but must never automatically acquire an existing device approval.

## Send to WebHub Workflow

Add **Send to WebHub** for one or more selected EmuGUI games:

1. Confirm that the selected game has a valid launch target.
2. Choose an emulator/profile or accept the tested EmuGUI default.
3. Prepare a bounded launcher thumbnail from the selected artwork.
4. Select or enter WebHub tags, optionally using suggestions from the active Hub.
5. Ask the native service to create or reuse the game binding.
6. Deliver the compact game item through the extension to the active Hub tab's Inbox.
7. Let the user move the item into any normal Hub column or folder.

Repeated sends of the same library/game/emulator/profile combination should normally reuse the same `gameKey`. Multiple Hub cards may reference one binding, matching duplicated application-card behaviour. Delivery IDs must still prevent accidental duplicates caused by retries.

## Extension and Native-Service Integration

### Separate EmuGUI Logic from HTTP

Refactor the business logic in `server.py` into transport-independent modules, for example:

```text
emugui_core/
  collections.py
  metadata.py
  artwork.py
  scraping.py
  jobs.py
  state.py
  launchers/
    base.py
    zx_spectrum.py
```

Keep the existing HTTP handler as a temporary adapter during migration. EmuGUI must remain usable through the current server until the extension-hosted UI reaches parity.

### Package the EmuGUI Frontend with the Extension

- Keep the EmuGUI repository as the canonical source for its frontend and core logic.
- Add a deterministic build/sync step that vendors a versioned EmuGUI frontend and native-core snapshot into the WebHub extension package.
- Record the source version or content hash so the packaged copy cannot drift silently.
- Open EmuGUI as an extension-owned page from a toolbar, menu, or WebHub action.
- Replace frontend calls such as `fetch('/api/games')` with authenticated extension RPC calls.
- Avoid depending on hardcoded development repository paths in packaged releases.

An extension-owned page is preferred over an arbitrary `file://` EmuGUI page because it has a trusted extension origin and does not require granting a local page the full EmuGUI mutation surface.

### Separate Client Capabilities

The extension must distinguish trusted WebHub and EmuGUI clients:

- WebHub receives only narrow game binding, status, launch, reveal, rebind, forget, and open-in-EmuGUI capabilities.
- The extension-owned EmuGUI page receives collection, metadata, artwork, scraper, profile, maintenance, and launcher capabilities.
- A WebHub page must never be able to call EmuGUI rename, delete, scrape, import, or arbitrary filesystem operations.
- EmuGUI operations should use their own authenticated session and request namespace.

### Namespaced Native Operations

Candidate EmuGUI operations include:

- `EMUGUI_LIST_COLLECTIONS`
- `EMUGUI_SELECT_COLLECTION`
- `EMUGUI_SEARCH_GAMES`
- `EMUGUI_GET_GAME`
- `EMUGUI_UPDATE_METADATA`
- `EMUGUI_SCRAPE_PREVIEW`
- `EMUGUI_APPLY_SCRAPE`
- `EMUGUI_MANAGE_EMULATORS`
- `EMUGUI_MANAGE_PROFILES`
- `EMUGUI_LAUNCH_GAME`
- `EMUGUI_CREATE_HUB_BINDING`
- `EMUGUI_JOB_STATUS`

Long collection scans, imports, metadata operations, and scraper requests should retain a bounded background-job model with progress and cancellation where safe. The extension should route job polling over its persistent native connection.

Candidate WebHub-facing game operations include:

- `GAME_STATUS`
- `LAUNCH_GAME`
- `REVEAL_GAME`
- `REBIND_GAME`
- `FORGET_GAME`
- `OPEN_GAME_IN_EMUGUI`

The Hub must invoke launches through the persistent native connection so emulator processes survive the native-message response lifecycle.

## Emulator Adapter Contract

Future systems must use launch adapters rather than adding system-specific fields and code throughout WebHub.

An approved emulator definition may contain:

- Stable emulator and adapter IDs.
- Display name.
- Executable and working-directory paths stored only in native configuration.
- Supported system IDs and target kinds.
- Supported file extensions where applicable.
- An argument-vector template with a small fixed placeholder allowlist.
- Optional approved helper/configuration/profile files.
- Adapter-specific preparation and running-instance capabilities.

Argument templates must be arrays of process arguments, never shell command strings. The page must not submit templates or arbitrary arguments during a launch request.

Launch-target kinds should support:

- `file` for ordinary ROM, snapshot, tape, or disk-image launches.
- `engine-target` for ScummVM-style configured game IDs.
- `machine` for MAME-style driver and ROM-set launches.
- `manifest` for DOSBox, multi-disc, multi-file, or per-game configuration launches.
- Narrowly allowlisted `protocol` targets where appropriate.

## ZX Spectrum Adapter

The first adapter must preserve current EmuGUI behaviour:

- `.tap`, `.tzx`, `.z80`, `.sna`, `.szx`, and `.rom` support as appropriate per emulator.
- EightyOne launch support.
- Managed EightyOne profile selection from explicit game settings and system/tag rules.
- Safe profile copying to the configured EightyOne target before launch.
- Spectaculator direct launch.
- SpecStub support for sending a game to an existing Spectaculator instance.
- A clear running-instance choice when reuse is unavailable or not requested.
- Window restoration/focus behaviour.
- Immediate process-exit detection and useful launch errors.
- EmuGUI recent-play tracking.
- Existing POK functionality inside EmuGUI; it is not required on the Hub card for the first release.

WebHub calls only `LAUNCH_GAME(gameKey)`. All ZX-specific behaviour remains in the native adapter.

## First-Class WebHub Game Items

Implement `type: "game"` across the Hub's generic item pipelines:

- Shared-state normalisation and migrations.
- Card rendering with a bounded thumbnail and status fallback.
- Board columns and ordinary folders.
- Per-tab Inbox intake and badges.
- Cross-tab and cross-board Send To actions.
- Internal drag-and-drop and multi-item movement.
- Tags, locks, Undo, Trash, and duplication.
- Hub Search and command-palette launch results.
- Portable bundle sanitisation and unbound import behaviour.
- Status refresh and cached thumbnail updates.

Initial context actions:

- **Launch Game**
- **Open in EmuGUI**
- **Reveal Game File**
- **Rebind on This Device**
- **Forget Device Binding**
- Existing edit-title, tag, lock, duplicate, move, Send To, and delete actions where applicable.

The Hub should not provide emulator/profile editors or a collection browser. Emulator changes belong in EmuGUI; **Open in EmuGUI** should navigate to the source game and its launch configuration when possible.

## Migration from the Manual Server

Implementation status as of 2026-08-24:

- [x] Made EmuGUI library construction lazy so its core can be imported by another transport without scanning a collection at import time.
- [x] Added a tested, bounded read-service contract for status, paginated game search, and individual game lookup while retaining the existing HTTP UI and adding a temporary `/api/read-rpc` adapter.
- [x] Connected the WebHub extension and native host to the configured EmuGUI checkout for a first path-free `EMUGUI_STATUS` capability.
- [x] Added reusable device-local bindings plus bounded `GAME_STATUS`, persistent `LAUNCH_GAME`, and `FORGET_GAME` operations; native paths and launch arguments never enter portable Hub state.
- [x] Added **Send to WebHub** to EmuGUI's game details and context menu, delivering the selected game through the extension to the active Hub Inbox with an opaque binding, name, tags, and optional bounded thumbnail.
- [x] Added first-class Hub `game` items across state migration, Inbox counts, cards, folders, drag-and-drop, context actions, search, duplication, status, and launch handling.
- [x] Added the game-shortcut lifecycle in WebHub 0.11.214 / extension 1.0.47: **Open in EmuGUI**, **Reveal game file**, in-place **Rebind in EmuGUI**, and precise library/game/emulator/profile failure states. Rebinding keeps EmuGUI authoritative and updates the existing Hub card instead of creating a duplicate.
- [ ] Continue extracting mutation, job, artwork, and launch operations before moving the EmuGUI frontend into the extension.

1. Freeze the current EmuGUI server as the behaviour reference.
2. Add tests around collection loading, metadata actions, jobs, emulator/profile resolution, and ZX launches before extraction.
3. Extract `emugui_core` while retaining the HTTP adapter.
4. Add EmuGUI namespaced native operations and extension routing.
5. Package the EmuGUI frontend as an extension-owned page and replace its HTTP calls with RPC.
6. Verify feature parity for current management workflows.
7. [Completed in WebHub 0.11.209 / extension 1.0.42] Add native game bindings and **Send to WebHub**.
8. [Completed in WebHub 0.11.209 / extension 1.0.42] Add first-class Hub game items and launch/status actions.
9. [Completed in WebHub 0.11.214 / extension 1.0.47] Add open, reveal, in-place rebind, selected-game handoff, and actionable binding states.
10. Validate real EightyOne, Spectaculator, managed-profile, running-instance, and missing-file scenarios.
11. Remove the requirement to run `Start Morpheus EmuGUI.bat` only after extension-hosted parity is proven.
12. Retain an optional development HTTP adapter if it remains useful for standalone frontend work.

Do not copy scraper secrets from EmuGUI's current JSON configuration into the extension or Hub database. Move them explicitly to Windows Credential Manager through the existing native secret service, with verified write-before-delete migration.

## Future Systems

Adding a system should require a new EmuGUI/native launch adapter, not a new WebHub item model.

- **ScummVM** — configured engine target IDs, optional configuration file, and game data directory.
- **Steem SSE / Hatari** — Atari ST disk images, machine profiles, and optional multi-disk handling.
- **Game Boy / Game Boy Color / SNES** — ordinary file targets with emulator-specific argument profiles.
- **DOSBox** — per-game manifests containing configuration, working directory, and approved mount/start information.
- **MAME** — driver/ROM-set identifiers, BIOS/device requirements, and native-only argument profiles.
- **Disc and multi-file systems** — manifests defining ordered media and optional launch selections.

A WebHub game card remains a title, thumbnail, tags, and opaque `gameKey` regardless of system.

## Validation Requirements

### Security and Data Boundaries

- Prove that the Hub database and ordinary portable exports contain no native paths or command templates.
- Reject unknown bindings, adapters, emulators, profiles, placeholders, and launch-target kinds.
- Confine every relative game/artwork path to its approved library root, including symlink and traversal cases.
- Launch with argument arrays and `shell=False` semantics only.
- Keep EmuGUI mutation capabilities unavailable to WebHub sessions.
- Bound native request/response sizes, thumbnails, metadata strings, search pages, job histories, and configuration counts.
- Keep scraper credentials out of extension storage, diagnostics, logs, Hub state, and portable bundles.

### Behaviour

- Test first send, repeated send, retry deduplication, multi-game send, and no-active-Hub handling.
- Test game movement through columns, folders, tabs, Inboxes, search, Undo, Trash, duplication, and portable import/export.
- Test missing library, missing game, moved game, renamed game, missing emulator, missing profile, changed profile, and explicit rebind states.
- Test multiple Hub cards sharing one binding and forgetting a binding referenced by several cards.
- Test extension restart, native-host restart, EmuGUI page reload, Hub reload, long job continuation, and native reconnection.
- Test thumbnail optimisation, unavailable artwork, corrupt images, cache exclusion, and fallback rendering.

### Real ZX Spectrum Matrix

- Launch representative 48K and 128K games with EightyOne.
- Verify managed profile selection and copying.
- Launch with Spectaculator when it is stopped.
- Reuse a running Spectaculator instance through SpecStub.
- Start a second instance when explicitly requested and supported.
- Verify useful errors for immediate exit, missing helper, missing ROM, and unavailable collection.
- Confirm emulator processes survive the native-message response.

## MVP Completion Criteria

The first integration release is complete when:

- EmuGUI opens as an extension-owned page without manually starting its HTTP server.
- Existing EmuGUI collection-management workflows remain available.
- A selected Spectrum game can be sent explicitly to the active WebHub Inbox.
- The delivered item contains only a name, bounded thumbnail, Hub tags, and opaque binding.
- Game items can be organised in ordinary Hub columns and folders and found through Hub Search.
- Clicking a game item launches it with the emulator/profile chosen in EmuGUI.
- **Open in EmuGUI** reaches the source game's configuration.
- EightyOne and Spectaculator behaviour matches the current launcher, including managed profiles and running-instance handling.
- Missing or changed device resources produce recoverable item states.
- No ROM or emulator paths enter portable Hub state.
- No scraping or collection-maintenance interface is added to WebHub.

EmuGUI remains the workshop; Morpheus WebHub becomes the shelf of games used most often.
