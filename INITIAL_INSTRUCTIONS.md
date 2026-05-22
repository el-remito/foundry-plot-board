# Foundry VTT — Collaborative Board Module
## Design Instructions for Claude Code

---

## Overview

Build a Foundry VTT v14 module that transforms any scene into a collaborative freeform board. Players can place text cards, images, and draw connection lines between them. The GM toggles any scene into board mode; the board replaces the scene's normal view with a full-screen interactive canvas. All changes sync in real time between all connected clients and persist via Foundry's world storage.

---

## Module Identity

- **Module ID**: `scene-board`
- **Name**: Scene Board
- **Minimum Foundry version**: `14`
- **Verified Foundry version**: `14`
- **Authors**: (leave blank)
- **Languages**: English

---

## Architecture

### Board Activation

- The GM can right-click any scene in the sidebar and toggle "Board Mode" on or off via a context menu item added by the module.
- When the GM **enables** board mode on a scene, the module does two things atomically:
  1. Sets a scene flag: `scene.setFlag('scene-board', 'isBoardScene', true)`
  2. Grants all players Owner-level access to that scene: `await scene.update({ ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER } })`
- When the GM **disables** board mode, the module reverses both:
  1. Sets `scene.setFlag('scene-board', 'isBoardScene', false)`
  2. Restores default scene ownership: `await scene.update({ ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE } })`
- Because players have Owner-level access to the board scene, they can call `scene.setFlag()` directly — no GM proxy socket routing is needed for persistence.
- When a board-mode scene is activated (becomes the viewed scene), the module renders the board layer. When a non-board scene is active, the module is completely invisible.

### Rendering Layer

- The board is a full-screen `<div>` injected into `document.body` with `position: fixed`, `inset: 0`, and a high `z-index` that sits above the Foundry canvas but below Foundry's UI chrome (sidebar, hotbar, etc).
- The board layer contains:
  - An SVG element for connection lines (rendered beneath cards)
  - A card container div for all card elements
  - A toolbar for player actions

### Data Model

All board state is stored as a scene flag: `scene.getFlag('scene-board', 'boardState')`.

```js
// boardState shape
{
  cards: [
    {
      id: string,         // nanoid or crypto.randomUUID()
      x: number,          // position from left (px, relative to board)
      y: number,          // position from top (px, relative to board)
      w: number,          // width in px (default: 200)
      h: number,          // height in px (default: 120)
      text: string,       // card label/content
      color: string,      // hex color for card background
      imageUrl: string|null, // data URL or external URL for image cards
      type: 'text'|'image'
    }
  ],
  connections: [
    {
      id: string,
      fromCardId: string,
      toCardId: string,
      color: string       // hex color for line (default: #888888)
    }
  ]
}
```

### Real-Time Sync

Use `game.socket` for real-time sync between clients:

- Socket name: `module.scene-board`
- Because players have Owner-level access to the board scene, **any client** (player or GM) writes board state directly via `scene.setFlag()` — no GM proxy needed.
- After writing to the scene flag, the acting client broadcasts the updated `boardState` to all other connected clients via the socket so their view updates immediately without requiring a reload.
- All clients listen for socket messages and re-render the board on receipt.
- On scene activation, each client loads the current `boardState` from the scene flag and renders it.

> Since the world is hosted on The Forge, scene flag writes persist server-side regardless of who is or isn't connected. There is no GM-must-be-online dependency.

### Save Debouncing

- `scene.setFlag()` must **never** be called on every interaction event. Instead, schedule saves with a 300ms debounce: reset the timer on each change, and only write to the scene flag when the timer fires.
- This is critical for drag and resize operations, which fire many events per second. Without debouncing, a single card drag would trigger dozens of flag writes.
- The socket broadcast (for live updates to other clients) is **not** debounced — it fires immediately so other clients see smooth movement. Only the persistent flag write is debounced.

### Socket Message Shape

Every socket message must include a `sceneId` field. Receivers must silently ignore messages whose `sceneId` does not match `canvas.scene?.id`. This prevents messages from one board scene interfering with another if multiple board scenes exist.

```js
// Outgoing message shape
{
  action: 'boardUpdate',
  boardState: { ... },    // full updated boardState
  sceneId: canvas.scene.id,
  userId: game.user.id,
  timestamp: Date.now()
}

// Receiver guard
game.socket.on('module.scene-board', (payload) => {
  if (payload.sceneId !== canvas.scene?.id) return;
  // ... handle message
});
```

### Drag and Resize Suppression

- During a card drag, **do not** emit socket messages or schedule flag writes on every `pointermove` event — this would flood other clients and cause jitter.
- Instead: on `pointerdown`, set a local `isDragging = true` flag. On `pointermove`, update the card's DOM position locally only. On `pointerup`, commit the final position to `boardState`, trigger the debounced save, and emit a single socket message with the final state.
- Apply the same pattern for card resize operations.

---

## Features

### 1. Toolbar

A minimal floating toolbar anchored to the top-center of the board. Contains:

- **Add Text Card** button — creates a new text card at the center of the viewport
- **Add Image Card** button — opens a file picker or accepts a pasted image (see below)
- **Connect** toggle button — enters connection-drawing mode
- **Delete** button — deletes the currently selected card or connection (enabled only when something is selected)
- **Clear Board** button — GM only; clears all cards and connections after a confirmation dialog

### 2. Text Cards

- Rendered as absolutely-positioned `<div>` elements inside the card container.
- Each card has a colored header bar (using the card's `color` value) and a text body area.
- Double-clicking the text body opens it for inline editing (`contenteditable`). Clicking outside commits the edit.
- Cards are draggable. Drag updates `x` and `y` in the board state and syncs to all clients.
- Cards are resizable via a resize handle in the bottom-right corner. Resize updates `w` and `h`.
- Right-clicking a card opens a small context menu:
  - Change color (show 8 preset swatches)
  - Delete card
- Clicking a card selects it (highlighted border). Only one card selected at a time.

### 3. Image Cards

- Same structure as text cards, but the body displays an `<img>` element instead of text.
- Images can be added two ways:
  1. **Paste**: Player presses Ctrl+V anywhere on the board; if the clipboard contains an image, an image card is created at the center of the viewport using a data URL.
  2. **Upload**: Clicking "Add Image Card" in the toolbar opens a native `<input type="file" accept="image/*">`. The selected image is read as a data URL and stored in `imageUrl`.
- Image cards have a text label below the image (`text` field), editable by double-clicking.
- **Important**: Store images as data URLs in `boardState`. Do not integrate with Foundry's FilePicker or asset system.

### 4. Connection Lines

- Connection lines are rendered as `<line>` elements inside the SVG layer.
- Each line connects the center point of two cards.
- When the **Connect** toolbar button is active:
  - Clicking a card selects it as the connection source (highlighted in a distinct color).
  - Clicking a second card creates a connection between the two and exits connect mode.
  - Pressing Escape cancels connect mode.
- Clicking a connection line selects it (highlight the line). The Delete button removes it.
- Connection lines have a default color of `#888888`. Right-clicking a selected line offers a color picker (same 8 swatches as cards).
- Lines update dynamically when cards are moved (recalculate center points on drag).

### 5. Pan and Zoom

- The board supports pan and zoom so players can spread cards across a large virtual space.
- Implement via a CSS `transform: translate() scale()` on a single inner container div that holds both the SVG and the card container.
- **Pan**: Middle-mouse-button drag, or Space+drag.
- **Zoom**: Mouse wheel. Clamp zoom between 0.2x and 3x.
- Pan/zoom state is **not** persisted to world storage — it is local per client and resets on scene reload.

---

## Visual Design

The board should feel like a physical corkboard or planning surface. Design direction: **utilitarian craft** — like a real ops room or investigation board. Not a digital product, not a game UI. Think analog textures meeting clean function.

- **Board background**: A subtle dark linen or cork texture using a CSS repeating pattern or SVG noise filter. Not a flat color.
- **Cards**: Slightly off-white (`#f5f0e8`) with a faint drop shadow. The colored header strip is 8px tall at the top of the card.
- **Card text**: A monospace or typewriter-style font (e.g. `'Courier New'` or load `'Special Elite'` from Google Fonts).
- **Connection lines**: 2px solid lines with a slight opacity (0.75). No arrows, no curves — straight lines only.
- **Toolbar**: Semi-transparent dark panel (`rgba(20,20,20,0.85)`), pill-shaped, centered at top of viewport. Icons + short text labels.
- **Selection highlight**: A sharp `2px solid #f0c040` border (amber) on selected cards.
- **Connect mode source card**: `2px solid #40a0f0` border (blue) to distinguish source from selected.

---

## File Structure

```
scene-board/
├── module.json
├── scene-board.js        # Main entry point
├── board.js              # Board rendering, interaction, sync logic
├── board.css             # All board styles
└── templates/
    └── (none required — board is built entirely in JS)
```

All JS should be vanilla ES modules (no build step required). Use `import` statements and declare `"esmodules": ["scene-board.js"]` in `module.json`.

---

## Key Foundry v14 API Notes

- Register the socket: `game.socket.on('module.scene-board', handler)` inside the `ready` hook.
- Listen for scene changes: `Hooks.on('canvasReady', ...)` — this fires when a scene is activated.
- Scene flags read: `canvas.scene.getFlag('scene-board', 'boardState')`
- Scene flags write (any client, since players have Owner access): `await canvas.scene.setFlag('scene-board', 'boardState', newState)`
- Grant players Owner access when enabling board mode: `await scene.update({ ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER } })`
- Restore default access when disabling board mode: `await scene.update({ ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE } })`
- Add scene context menu item: `Hooks.on('getSceneDirectoryEntryContext', (html, options) => { options.push(...) })`
- Check if current user is GM: `game.user.isGM`

---

## Constraints and Edge Cases

- If two clients edit simultaneously, last-write-wins is acceptable. No conflict resolution needed.
- If `boardState` flag is null (new board scene), initialize with `{ cards: [], connections: [] }`.
- If a card referenced by a connection is deleted, also delete any connections referencing that card ID.
- The board layer must be removed from the DOM when switching away from a board scene. Use the `canvasReady` hook to detect scene switches and teardown/reinitialize accordingly.
- Do not interfere with Foundry's normal scene rendering for non-board scenes. The module should be completely inert when a board scene is not active.
- All player roles (Player, Trusted Player, Assistant GM) can create, move, edit, and delete cards and connections. Only GM can clear the entire board.
