# Plot Board — Foundry VTT Module

## What this is
A Foundry VTT v14 module (id: `foundry-plot-board`) that turns any scene into a
collaborative freeform planning board. Players place text/image cards and draw
connection lines between them. The GM enables Board Mode per scene. All state
syncs in real time via sockets and persists via scene flags.

## File structure
```
foundry-plot-board/   ← repo root = the Foundry module folder (symlinked into Data/modules/)
├── module.json       — manifest (id, version, esmodules, styles)
├── plot-board.js     — entry point: Hooks, settings registration, socket handler, resume button
├── board.js          — BoardLayer class: all rendering, interaction, pan/zoom, sync logic
└── board.css         — all styles (board overlay, toolbar, cards, SVG lines, dialogs)
```

No build step. Vanilla ES modules throughout.

## Development setup
Symlink the repo root into `{Foundry Data}/modules/foundry-plot-board`.
Reload Foundry after JS/CSS changes (no HMR).

## Architecture

### Entry point (`plot-board.js`)
- `Hooks.once('init')` — registers 14 world-scoped settings (7 card colors + 7 line colors)
- `Hooks.once('ready')` — registers socket listener: `game.socket.on('module.foundry-plot-board', payload => board?.onSocketMessage(payload))`
- `Hooks.on('canvasReady')` — shows or hides the board based on the `isBoardScene` flag
- `Hooks.on('renderSceneConfig')` — injects the **Board Mode** checkbox into the Miscellaneous tab
- `_setResumeBtn(visible)` — manages the `#pb-board-resume` button (outside the board layer, tracks sidebar width via ResizeObserver)

### Board class (`board.js`) — `export class BoardLayer`
- `show(onHide)` / `hide()` — mount/unmount the full-screen overlay DOM
- `onSocketMessage(payload)` — receives `boardUpdate` from other clients, calls `_renderAllCards()`
- `_save()` — emits socket payload immediately + debounced (300ms) `scene.setFlag` write
- `_renderAllCards()` / `_renderCard(card)` — full re-render from `this._state`
- `_renderAllLines()` / `_renderLine(conn)` / `_updateLinesForCard(cardId)` — SVG connection management
- `_attachDrag` / `_attachResize` — pointer event handlers; deltas divided by `this._zoom`
- `_attachEdit` / `_attachFormatBar` / `_attachLabelEdit` — inline editing
- `_openCardContextMenu` / `_openLineContextMenu` / `_mountContextMenu` — right-click menus
- `_getCardColors()` / `_getLineColors()` — reads from `game.settings`, falls back to hardcoded constants
- `_toBoard(clientX, clientY)` — converts viewport coords to board-space (accounting for pan/zoom)
- `_applyTransform()` — writes `translate(panX, panY) scale(zoom)` to `.sb-transform-container`

### Data model
Stored in `scene.getFlag('foundry-plot-board', 'boardState')`:
```json
{
  "cards": [
    {
      "id": "<uuid>",
      "type": "text | image",
      "x": 120, "y": 80,
      "w": 240, "h": 160,
      "color": "#e8dfc8",
      "text": "<html or plain text>",
      "imageUrl": "<data URL, image cards only>"
    }
  ],
  "connections": [
    {
      "id": "<uuid>",
      "fromCardId": "<uuid>",
      "toCardId": "<uuid>",
      "color": "#c8b89a"
    }
  ]
}
```

### Key patterns
- **Context menus**: `pointerdown` outside handler re-registers itself if click is *inside* menu (prevents premature dismiss)
- **Font size**: `execCommand('fontSize', false, '7')` + find `<font size="7">` and swap to `font-size: Npx` inline style
- **Pan target check**: pan only activates when `e.target` is the board layer, transform container, or card container — never on cards/lines
- **Image card DOM**: label lives inside `.sb-card-header` (guaranteed always-visible); body contains only `<img>`
- **Sidebar clipping**: board `right` is set dynamically via `ResizeObserver` on `#sidebar`

### Scene flags
- `foundry-plot-board.isBoardScene` (Boolean) — marks a scene as a board scene
- `foundry-plot-board.boardState` (Object) — the full board state

### Socket protocol
Event name: `module.foundry-plot-board`
Payload: `{ action: 'boardUpdate', boardState, sceneId, userId }`
Receivers guard on `sceneId === canvas.scene?.id` and `userId !== game.user?.id`.
