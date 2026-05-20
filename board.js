const MODULE_ID = 'foundry-plot-board';

export class BoardLayer {
  constructor() {
    this._el = null;
    this._state = { cards: [], connections: [] };
  }

  show(onHide) {
    this._onHide = onHide ?? null;
    this.hide();

    const el = document.createElement('div');
    el.id = 'foundry-plot-board-layer';
    document.body.appendChild(el);
    this._el = el;

    // Temporary exit button — replaced by the full toolbar in Milestone 2
    const exitBtn = document.createElement('button');
    exitBtn.id = 'pb-exit-btn';
    exitBtn.textContent = '✕ Exit Board Mode';
    exitBtn.addEventListener('click', () => {
      this.hide();
      this._onHide?.();
    });
    el.appendChild(exitBtn);

    const raw = canvas.scene?.getFlag(MODULE_ID, 'boardState');
    this._state = raw ?? { cards: [], connections: [] };
  }

  hide() {
    document.getElementById('foundry-plot-board-layer')?.remove();
    this._el = null;
  }

  onSocketMessage(_payload) {
    // Implemented in Milestone 5
  }
}
