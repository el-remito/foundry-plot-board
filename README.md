# Plot Board — Foundry VTT Module

A collaborative freeform planning board for Foundry VTT v14. Turn any scene into a corkboard
where players and GMs can place cards, write notes, attach images, and draw connection lines
between them — all synced in real time.

## Features

- **Text cards** — Add sticky-note-style cards anywhere on the board. Rich-text formatting:
  bold, italic, underline, strikethrough, text color, and adjustable font size.
- **Image cards** — Drop in images via file picker or paste from clipboard (Ctrl+V).
  Each image card has an editable caption label.
- **Connection lines** — Draw lines between cards to map relationships. Click to select,
  right-click to recolor, delete to remove.
- **Color palettes** — 7 configurable card colors and 7 configurable line colors (set in
  Module Settings), plus a free-form custom color picker on every swatch grid.
- **Pan & zoom** — Scroll to zoom (0.2× – 3×). Click-drag on the empty board to pan.
- **Real-time sync** — All changes are broadcast instantly to every connected client via
  Foundry's built-in socket system.
- **Persistent state** — The board survives page refreshes. State is stored in a companion
  JournalEntry so players can save changes without a GM present.
- **Board Mode toggle** — Enable per scene via Scene Config → Miscellaneous tab.
  Toggling ownership for all players automatically.
- **GM tools** — Clear Board (requires typing the scene name to confirm). GM-only toolbar button.
- **Sidebar harmony** — The board overlay clips to the Foundry sidebar so the scene list,
  actors panel, and other tools remain fully accessible.

## Installation

1. Copy (or symlink) this folder into `{Foundry Data}/Data/modules/foundry-plot-board`.
2. In Foundry → **Add-on Modules**, enable **Plot Board**.
3. Reload the world.

## Usage

1. Open any scene's config (double-click the scene in the sidebar).
2. Go to the **Miscellaneous** tab and tick **Board Mode**.
3. The board overlay appears immediately. Use the toolbar to add cards and connections.
4. Exit the board via the **✕ Exit Board Mode** button (top-right). A **▶ Open Plot Board**
   button appears next to the sidebar to re-enter.

## Changelog

### v1.1.0 — 2026-05-25
- **Fixed:** Players received a "no permission" warning when saving board changes
- **Fixed:** Changes made by players were lost on page refresh (not persisted)
- Board state is now stored in a player-writable JournalEntry instead of the scene flag,
  allowing any connected user to persist changes without a GM present
- The companion JournalEntry is placed in a GM-only hidden folder so it does not appear
  in the player sidebar

### v1.0.0 — 2026-05-22
Initial release.

- Text cards with drag, resize, inline rich-text editing, and color picker
- Image cards via file picker or clipboard paste, with editable caption
- Connection lines between cards with color picker
- Pan (click-drag on empty board) and zoom (mouse wheel)
- Real-time sync via Foundry socket
- Persistent board state via scene flags
- Board Mode toggle in Scene Config (Miscellaneous tab)
- Configurable 7-color palettes for cards and lines (Module Settings)
- Custom color picker (8th swatch) on every color grid
- Cork-texture board background, Special Elite typewriter font
- Sidebar-aware overlay with ResizeObserver tracking
- GM-only Clear Board with scene-name confirmation dialog
