import { BoardLayer } from './board.js';

const MODULE_ID = 'foundry-plot-board';
let board = null;

function _setResumeBtn(visible) {
  document.getElementById('pb-board-resume')?.remove();
  if (!visible) return;
  const btn = document.createElement('button');
  btn.id = 'pb-board-resume';
  btn.textContent = '▶ Open Plot Board';
  btn.addEventListener('click', () => {
    btn.remove();
    if (!board) board = new BoardLayer();
    board.show(() => _setResumeBtn(true));
  });
  document.body.appendChild(btn);
}

// ── Socket registration ────────────────────────────────────────
Hooks.once('ready', () => {
  game.socket.on(`module.${MODULE_ID}`, (payload) => {
    board?.onSocketMessage(payload);
  });
});

// ── Board Mode toggle — injected into Scene Config (Miscellaneous tab) ──
// renderSceneConfig fires reliably in both ApplicationV1 and ApplicationV2
Hooks.on('renderSceneConfig', (app, html) => {
  if (!game.user?.isGM) return;

  const doc = app.document ?? app.object; // ApplicationV2 vs older
  const el  = html instanceof jQuery ? html[0] : html;

  // Both the nav <a> and the content <div> share data-tab="misc" in v14.
  // Target the content panel via its unique data-application-part attribute.
  const tab = el.querySelector('[data-application-part="misc"]')
           ?? el.querySelector('div[data-tab="misc"]')
           ?? el.querySelector('div[data-tab="miscellaneous"]');
  if (!tab) return;

  const checked = doc.getFlag(MODULE_ID, 'isBoardScene') ?? false;

  const group = document.createElement('div');
  group.className = 'form-group';
  group.innerHTML = `
    <label>Board Mode</label>
    <div class="form-fields">
      <input type="checkbox" id="pb-board-mode" ${checked ? 'checked' : ''}>
    </div>
    <p class="hint">Turn this scene into a collaborative Plot Board.</p>`;
  tab.appendChild(group);

  group.querySelector('#pb-board-mode').addEventListener('change', async (e) => {
    const on = e.target.checked;
    await doc.setFlag(MODULE_ID, 'isBoardScene', on);
    await doc.update({
      ownership: {
        default: on
          ? CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER
          : CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE
      }
    });
    // canvasReady only fires on scene load — trigger board directly if this is the active scene
    if (canvas.scene?.id === doc.id) {
      if (on) {
        _setResumeBtn(false);
        if (!board) board = new BoardLayer();
        board.show(() => _setResumeBtn(true));
      } else {
        board?.hide();
        _setResumeBtn(false);
      }
    }
  });
});

// ── Board layer lifecycle ──────────────────────────────────────
Hooks.on('canvasReady', () => {
  const isBoard = canvas.scene?.getFlag(MODULE_ID, 'isBoardScene') ?? false;
  if (isBoard) {
    _setResumeBtn(false);
    if (!board) board = new BoardLayer();
    board.show(() => _setResumeBtn(true));
  } else {
    board?.hide();
    _setResumeBtn(false);
  }
});
