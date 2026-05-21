const MODULE_ID = 'foundry-plot-board';

const CARD_COLORS = [
  { label: 'Cream',  value: '#e8dfc8' },
  { label: 'Rose',   value: '#e8c8c8' },
  { label: 'Sage',   value: '#c8dfc8' },
  { label: 'Sky',    value: '#c8d8e8' },
  { label: 'Lavender', value: '#d8c8e8' },
  { label: 'Amber',  value: '#e8d8a0' },
  { label: 'Peach',  value: '#e8cdb8' },
  { label: 'Slate',  value: '#c8cdd8' },
];

export class BoardLayer {
  constructor() {
    this._el         = null;
    this._cardEl     = null;   // card container div
    this._state      = { cards: [], connections: [] };
    this._onHide     = null;
    this._selectedId = null;
    this._saveTimer  = null;
    this._contextMenu = null;
  }

  // ── Public API ─────────────────────────────────────────────────

  show(onHide) {
    this._onHide = onHide ?? null;
    this.hide();

    const el = document.createElement('div');
    el.id = 'foundry-plot-board-layer';
    document.body.appendChild(el);
    this._el = el;

    this._buildToolbar(el);
    this._buildExitBtn(el);

    const cardContainer = document.createElement('div');
    cardContainer.id = 'pb-card-container';
    el.appendChild(cardContainer);
    this._cardEl = cardContainer;

    // Deselect + close context menu on board click
    el.addEventListener('pointerdown', (e) => {
      if (e.target === el || e.target === cardContainer) {
        this._select(null);
      }
      this._closeContextMenu();
    });

    // Load persisted state
    const raw = canvas.scene?.getFlag(MODULE_ID, 'boardState');
    this._state = raw ? foundry.utils.deepClone(raw) : { cards: [], connections: [] };
    this._renderAllCards();
  }

  hide() {
    document.getElementById('foundry-plot-board-layer')?.remove();
    this._el     = null;
    this._cardEl = null;
    this._closeContextMenu();
  }

  onSocketMessage(payload) {
    // Implemented in Milestone 5
  }

  // ── Toolbar ────────────────────────────────────────────────────

  _buildToolbar(parent) {
    const bar = document.createElement('div');
    bar.id = 'pb-toolbar';

    const addText = this._toolBtn('＋ Text Card', false, () => this._addCard());
    const addImg  = this._toolBtn('🖼 Image Card', true);
    const connect = this._toolBtn('⟷ Connect',   true);
    const del     = this._toolBtn('🗑 Delete',    false, () => this._deleteSelected());
    del.id = 'pb-btn-delete';

    bar.append(addText, addImg, connect, del);

    if (game.user?.isGM) {
      const clear = this._toolBtn('✕ Clear Board', false, () => this._clearBoard());
      clear.id = 'pb-btn-clear';
      bar.appendChild(clear);
    }

    parent.appendChild(bar);
  }

  _toolBtn(label, disabled, onClick) {
    const btn = document.createElement('button');
    btn.className = 'pb-tool-btn';
    btn.textContent = label;
    btn.disabled = disabled;
    if (onClick) btn.addEventListener('click', onClick);
    return btn;
  }

  _buildExitBtn(parent) {
    const exitBtn = document.createElement('button');
    exitBtn.id = 'pb-exit-btn';
    exitBtn.textContent = '✕ Exit Board Mode';
    exitBtn.addEventListener('click', () => {
      this.hide();
      this._onHide?.();
    });
    parent.appendChild(exitBtn);
  }

  // ── Card creation ──────────────────────────────────────────────

  _addCard() {
    const card = {
      id:      crypto.randomUUID(),
      x:       Math.round((this._el.clientWidth  / 2) - 120),
      y:       Math.round((this._el.clientHeight / 2) - 80),
      w:       240,
      h:       160,
      color:   CARD_COLORS[0].value,
      text:    '',
    };
    this._state.cards.push(card);
    this._renderCard(card);
    this._select(card.id);
    this._save();
  }

  // ── Card rendering ─────────────────────────────────────────────

  _renderAllCards() {
    if (!this._cardEl) return;
    this._cardEl.innerHTML = '';
    for (const card of this._state.cards) this._renderCard(card);
  }

  _renderCard(card) {
    const el = document.createElement('div');
    el.className = 'sb-card';
    el.dataset.id = card.id;
    el.style.left   = card.x + 'px';
    el.style.top    = card.y + 'px';
    el.style.width  = card.w + 'px';
    el.style.height = card.h + 'px';

    el.style.background = card.color;

    const header = document.createElement('div');
    header.className = 'sb-card-header';

    const body = document.createElement('div');
    body.className = 'sb-card-body';
    body.contentEditable = 'false';
    body.textContent = card.text;

    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'sb-resize-handle';

    el.append(header, body, resizeHandle);
    this._cardEl.appendChild(el);

    // Interactions
    this._attachDrag(el, card);
    this._attachResize(el, card, resizeHandle);
    this._attachEdit(el, card, body);
    this._attachContextMenu(el, card);

    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      this._select(card.id);
      e.stopPropagation();
    });
  }

  _cardEl_forId(id) {
    return this._cardEl?.querySelector(`.sb-card[data-id="${id}"]`) ?? null;
  }

  // ── Selection ──────────────────────────────────────────────────

  _select(id) {
    // Clear previous
    this._cardEl?.querySelectorAll('.sb-card.sb-selected')
      .forEach(el => el.classList.remove('sb-selected'));
    this._selectedId = id;
    if (id) this._cardEl_forId(id)?.classList.add('sb-selected');
  }

  // ── Drag ───────────────────────────────────────────────────────

  _attachDrag(el, card) {
    let startX, startY, origX, origY, dragging = false;

    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      // Don't start drag from resize handle or body in edit mode
      if (e.target.classList.contains('sb-resize-handle')) return;
      if (e.target.contentEditable === 'true') return;

      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      origX  = card.x;
      origY  = card.y;
      el.setPointerCapture(e.pointerId);
      e.stopPropagation();
    });

    el.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      el.style.left = (origX + dx) + 'px';
      el.style.top  = (origY + dy) + 'px';
    });

    el.addEventListener('pointerup', (e) => {
      if (!dragging) return;
      dragging = false;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      card.x = origX + dx;
      card.y = origY + dy;
      this._save();
    });
  }

  // ── Resize ─────────────────────────────────────────────────────

  _attachResize(el, card, handle) {
    let startX, startY, origW, origH, resizing = false;

    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      resizing = true;
      startX = e.clientX;
      startY = e.clientY;
      origW  = card.w;
      origH  = card.h;
      handle.setPointerCapture(e.pointerId);
      e.stopPropagation();
    });

    handle.addEventListener('pointermove', (e) => {
      if (!resizing) return;
      const w = Math.max(120, origW + (e.clientX - startX));
      const h = Math.max(80,  origH + (e.clientY - startY));
      el.style.width  = w + 'px';
      el.style.height = h + 'px';
    });

    handle.addEventListener('pointerup', (e) => {
      if (!resizing) return;
      resizing = false;
      card.w = Math.max(120, origW + (e.clientX - startX));
      card.h = Math.max(80,  origH + (e.clientY - startY));
      this._save();
    });
  }

  // ── Inline edit ────────────────────────────────────────────────

  _attachEdit(el, card, body) {
    // Edit is triggered via the right-click context menu ("✏ Edit Text")
    // Only blur + keydown are needed here.

    body.addEventListener('blur', () => {
      body.contentEditable = 'false';
      card.text = body.textContent;
      this._save();
    });

    body.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        body.textContent = card.text; // revert
        body.blur();
      }
      e.stopPropagation();
    });
  }

  // ── Context menu (color picker + delete) ──────────────────────

  _attachContextMenu(el, card) {
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._select(card.id);
      this._openContextMenu(e.clientX, e.clientY, card);
    });
  }

  _openContextMenu(x, y, card) {
    this._closeContextMenu();

    const menu = document.createElement('div');
    menu.id = 'pb-context-menu';
    menu.style.left = x + 'px';
    menu.style.top  = y + 'px';

    const editBtn = document.createElement('button');
    editBtn.className = 'pb-menu-item';
    editBtn.textContent = '✏ Edit Text';
    editBtn.addEventListener('click', () => {
      this._closeContextMenu();
      const cardEl = this._cardEl_forId(card.id);
      const body = cardEl?.querySelector('.sb-card-body');
      if (body) {
        body.contentEditable = 'true';
        body.focus();
      }
    });

    const swatches = document.createElement('div');
    swatches.className = 'pb-color-swatches';

    for (const { label, value } of CARD_COLORS) {
      const swatch = document.createElement('button');
      swatch.className = 'pb-swatch';
      swatch.title = label;
      swatch.style.background = value;
      if (value === card.color) swatch.classList.add('pb-swatch-active');
      swatch.addEventListener('click', () => {
        card.color = value;
        // Update whole card background in DOM
        const cardEl = this._cardEl_forId(card.id);
        if (cardEl) cardEl.style.background = value;
        // Refresh swatch active state
        swatches.querySelectorAll('.pb-swatch').forEach(s => s.classList.remove('pb-swatch-active'));
        swatch.classList.add('pb-swatch-active');
        this._save();
        this._closeContextMenu();
      });
      swatches.appendChild(swatch);
    }

    const separator = document.createElement('hr');
    separator.className = 'pb-menu-separator';

    const delBtn = document.createElement('button');
    delBtn.className = 'pb-menu-item pb-menu-delete';
    delBtn.textContent = '🗑 Delete Card';
    delBtn.addEventListener('click', () => {
      this._deleteCard(card.id);
      this._closeContextMenu();
    });

    menu.append(editBtn, swatches, separator, delBtn);
    document.body.appendChild(menu);
    this._contextMenu = menu;

    // Close on next click outside the menu
    const outsideHandler = (e) => {
      if (this._contextMenu?.contains(e.target)) {
        // Click was inside the menu — let it process, then re-arm
        document.addEventListener('pointerdown', outsideHandler, { once: true });
        return;
      }
      this._closeContextMenu();
    };
    setTimeout(() => {
      document.addEventListener('pointerdown', outsideHandler, { once: true });
    }, 0);
  }

  _closeContextMenu() {
    this._contextMenu?.remove();
    this._contextMenu = null;
  }

  // ── Delete / Clear ─────────────────────────────────────────────

  _deleteSelected() {
    if (this._selectedId) this._deleteCard(this._selectedId);
  }

  _deleteCard(id) {
    this._state.cards       = this._state.cards.filter(c => c.id !== id);
    this._state.connections = this._state.connections.filter(
      cn => cn.fromCardId !== id && cn.toCardId !== id
    );
    this._cardEl_forId(id)?.remove();
    if (this._selectedId === id) this._selectedId = null;
    this._save();
  }

  _clearBoard() {
    // Remove any existing dialog first
    document.getElementById('pb-clear-dialog')?.remove();

    const sceneName = canvas.scene?.name ?? '';

    const dialog = document.createElement('div');
    dialog.id = 'pb-clear-dialog';

    dialog.innerHTML = `
      <div id="pb-clear-box">
        <p class="pb-clear-warning">⚠ This will permanently erase all cards and connections.</p>
        <p class="pb-clear-label">Type <strong>${sceneName}</strong> to confirm:</p>
        <input id="pb-clear-input" type="text" autocomplete="off" spellcheck="false"
               placeholder="${sceneName}">
        <div class="pb-clear-buttons">
          <button id="pb-clear-cancel">Cancel</button>
          <button id="pb-clear-confirm" disabled>Clear Board</button>
        </div>
      </div>`;

    this._el.appendChild(dialog);

    const input   = dialog.querySelector('#pb-clear-input');
    const confirm = dialog.querySelector('#pb-clear-confirm');
    const cancel  = dialog.querySelector('#pb-clear-cancel');

    input.addEventListener('input', () => {
      confirm.disabled = input.value !== sceneName;
    });

    confirm.addEventListener('click', () => {
      dialog.remove();
      this._state = { cards: [], connections: [] };
      this._renderAllCards();
      this._selectedId = null;
      this._save();
    });

    cancel.addEventListener('click', () => dialog.remove());

    // Stop board interactions while dialog is open
    dialog.addEventListener('pointerdown', e => e.stopPropagation());

    input.focus();
  }

  // ── Persistence ────────────────────────────────────────────────

  _save() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(async () => {
      await canvas.scene?.setFlag(MODULE_ID, 'boardState', this._state);
    }, 300);
  }
}
