# Morpheus WebHub

Morpheus WebHub is a local browser-style bookmark manager built with HTML, CSS, and JavaScript.
It organizes bookmarks in boards, supports speed dial, nested folders, drag-and-drop reordering, and local persistence.

## Purpose

This document describes the product design, implementation status, and recommended improvements.
It is written for an AI agent or developer who will continue building and refining the app.

## High-level product model

- Left sidebar: navigation panel containing boards, folders, titles, and dividers.
- Main area: active board workspace with speed dial and multi-column bookmark layout.
- Each board includes a title, utility toolbar, speed dial section, and bookmark columns.
- Items can be bookmarks, folders, titles, or dividers.
- Folders can contain nested items, up to two levels deep.
- All changes persist locally using `localStorage`.

## Current feature status

### Implemented

- Board structure with multiple columns.
- Speed dial section with bookmark icons and titles.
- Add Folder, Bookmark, Title, and Divider controls for the active board.
- Board settings dialog for editing the board title.
- Drag-and-drop reordering of items within a board.
- Drag-and-drop reordering of items inside navigation.
- Nested folder support for bookmarks and nav items (up to two levels).
- Drop-on-folder behavior moves items into the folder.
- Context menus for board items and navigation items.
- Add-new-item context menu on empty navigation panel area.
- Local state persistence via `localStorage`.
- Separate board and navigation domains: items do not move across panels.
- Favicon loading for bookmark items.

### Partially implemented / unclear

- Board settings currently support title updates, but background image selection is not fully implemented.
- Sidebar resizing is not clearly implemented yet.
- Folder collapse/expand behavior is not fully specified and may not be active.
- The visual design of the speed dial may still need polish for icon-only display.

### Not implemented / missing

- Folder icon selection during folder creation.
- Background image picker for the bookmarks pane.
- Board column count selection with reliable behavior beyond default values.
- Explicit drag handle or improved drag preview animation beyond placeholders.
- More robust keyboard accessibility and mobile-first behavior.

## Feature breakdown

### Navigation panel

- Supports boards, folders, titles, and dividers.
- Items are reorderable by drag and drop.
- Folders can contain nested children.
- Right-click on items opens context actions.
- Empty-space context menu allows adding boards, folders, titles, or dividers.
- Navigation items cannot be moved into the board content area.

### Board workspace

- Board title is displayed prominently at the top.
- Controls exist to add folders, bookmarks, titles, and dividers.
- Speed dial shows bookmark icons and links.
- Bookmark columns display folders, bookmarks, titles, and dividers.
- Drag-and-drop ordering works within columns and folders.
- Dropping on a folder moves the dragged item into that folder.

### Bookmarks and folders

- Bookmarks display site favicon and label.
- Titles display text separators.
- Dividers display horizontal rules.
- Folders can contain bookmarks and nested subfolders.
- Nested folder depth is limited to two levels.

## Suggested improvements

1. Add folder icon selection during folder creation.
2. Implement a background picker in board settings.
3. Add explicit sidebar width drag resize behavior.
4. Add collapsible folder controls on the board and nav panels.
5. Improve live drag preview with a stronger placeholder and optional animation.
6. Add board column count controls in the settings modal.
7. Refine speed dial styling to show only icons when space is tight.
8. Add undo/restore support for accidental drag-and-drop moves.

## Developer notes for AI agents

- Use `app.js` as the main state and rendering source.
- Keep `localStorage` as the persistence mechanism.
- Focus on consistent drag/drop semantics across navigation and board domains.
- Preserve existing folder nesting rules and avoid deeper nesting beyond two levels.
- Prioritize UI clarity: item insertion preview, drop target feedback, and context-menu behavior.

## Goals for next iteration

- Finish board settings controls, including column count and background selection.
- Add clearer folder UI state (collapsed/expanded).
- Improve sidebar resizing and responsive layout.
- Polish speed dial icon-only presentation.
- Maintain the current working drag/drop model while removing edge case bugs.
