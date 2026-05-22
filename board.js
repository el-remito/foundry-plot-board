const MODULE_ID = 'foundry-plot-board';

// Default palettes — used as fallbacks when settings haven't loaded
const CARD_COLORS = [
  { label: 'Cream',    value: '#e8dfc8' },
  { label: 'Rose',     value: '#e8c8c8' },
  { label: 'Sage',     value: '#c8dfc8' },
  { label: 'Sky',      value: '#c8d8e8' },
  { label: 'Lavender', value: '#d8c8e8' },
  { label: 'Amber',    value: '#e8d8a0' },
  { label: 'Peach',    value: '#e8cdb8' },
];

const LINE_COLORS = [
  { label: 'Tan',      value: '#c8b89a' },
  { label: 'Rose',     value: '#d4a89a' },
  { label: 'Sage',     value: '#a8c4b8' },
  { label: 'Sky',      value: '#a8b8c8' },
  { label: 'Lavender', value: '#b8a8c8' },
  { label: 'Straw',    value: '#c8c4a8' },
  { label: 'Peach',    value: '#c4b0a0' },
];

const LINE_DEFAULT_COLOR = LINE_COLORS[0].value;

export class BoardLayer {
  constructor() {
    this._el                   = null;
    this._svgEl                = null;
    this._cardEl               = null;
    this._state                = { cards: [], connections: [] };
    this._onHide               = null;
    this._selectedId           = null;
    this._selectedConnectionId = null;
    this._saveTimer            = null;
    this._contextMenu          = null;
    // Connect mode
    this._isConnectMode        = false;
    this._connectSourceId      = null;
    this._connectBtn           = null;
    // Keyboard handler ref for cleanup
    this._keyHandler           = null;
    // Sidebar ResizeObserver ref for cleanup
    this._sidebarObserver      = null;
    // Pan / zoom
    this._panX                 = 0;
    this._panY                 = 0;
    this._zoom                 = 1;
    this._transformEl          = null;
    // Clipboard paste handler
    this._pasteHandler         = null;
  }

  // ── Public API ─────────────────────────────────────────────────

  show(onHide) {
    this._onHide = onHide ?? null;
    this.hide();

    const el = document.createElement('div');
    el.id = 'foundry-plot-board-layer';
    document.body.appendChild(el);
    this._el = el;

    // Clip board's right edge to sidebar and track it
    this._updateBoardBounds();
    const sidebar = document.querySelector('#sidebar');
    if (sidebar) {
      this._sidebarObserver = new ResizeObserver(() => this._updateBoardBounds());
      this._sidebarObserver.observe(sidebar);
    }

    this._buildToolbar(el);
    this._buildExitBtn(el);

    // Transform container (pan/zoom wrapper for SVG + cards)
    const transformEl = document.createElement('div');
    transformEl.className = 'sb-transform-container';
    el.appendChild(transformEl);
    this._transformEl = transformEl;

    // SVG layer (behind cards, inside transform)
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = 'pb-svg';
    transformEl.appendChild(svg);
    this._svgEl = svg;

    const cardContainer = document.createElement('div');
    cardContainer.id = 'pb-card-container';
    transformEl.appendChild(cardContainer);
    this._cardEl = cardContainer;

    // Deselect on board background click
    el.addEventListener('pointerdown', (e) => {
      if (e.target === el || e.target === transformEl || e.target === cardContainer) {
        this._select(null);
      }
      this._closeContextMenu();
    });

    // ── Pan / Zoom ─────────────────────────────────────────────────

    // Wheel → zoom toward cursor
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      const factor  = e.deltaY < 0 ? 1.1 : 0.9;
      const newZoom = Math.min(3.0, Math.max(0.2, this._zoom * factor));
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      this._panX = mx - (mx - this._panX) * (newZoom / this._zoom);
      this._panY = my - (my - this._panY) * (newZoom / this._zoom);
      this._zoom = newZoom;
      this._applyTransform();
    }, { passive: false });

    // Left-click drag on empty board background → pan
    let isPanning = false, panStartX = 0, panStartY = 0, panOrigX = 0, panOrigY = 0, panMoved = false;
    el.addEventListener('pointerdown', (e) => {
      if (e.button === 0 && (e.target === el || e.target === transformEl || e.target === cardContainer)) {
        isPanning = true;
        panMoved  = false;
        panStartX = e.clientX; panStartY = e.clientY;
        panOrigX  = this._panX; panOrigY  = this._panY;
        el.setPointerCapture(e.pointerId);
        // No preventDefault — let the deselect listener also fire
      }
    });
    el.addEventListener('pointermove', (e) => {
      if (!isPanning) return;
      const dx = e.clientX - panStartX;
      const dy = e.clientY - panStartY;
      if (!panMoved && Math.hypot(dx, dy) > 4) panMoved = true;
      if (panMoved) {
        this._panX = panOrigX + dx;
        this._panY = panOrigY + dy;
        this._applyTransform();
      }
    });
    el.addEventListener('pointerup', (e) => {
      if (isPanning && e.button === 0) { isPanning = false; panMoved = false; }
    });

    // ── Keyboard ──────────────────────────────────────────────────

    this._keyHandler = (e) => {
      if (e.key === 'Escape' && this._isConnectMode) this._exitConnectMode();
    };
    document.addEventListener('keydown', this._keyHandler);

    // ── Paste → image card ────────────────────────────────────────

    this._pasteHandler = (e) => {
      // Don't intercept when a card body/label is being edited
      if (document.activeElement?.contentEditable === 'true') return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            this._readImageFile(file, (url) => this._createImageCard(url));
          }
          break;
        }
      }
    };
    document.addEventListener('paste', this._pasteHandler);

    // Load persisted state
    const raw = canvas.scene?.getFlag(MODULE_ID, 'boardState');
    this._state = raw ? foundry.utils.deepClone(raw) : { cards: [], connections: [] };
    this._renderAllCards();
  }

  hide() {
    document.getElementById('foundry-plot-board-layer')?.remove();
    if (this._keyHandler) {
      document.removeEventListener('keydown', this._keyHandler);
      this._keyHandler = null;
    }
    if (this._pasteHandler) {
      document.removeEventListener('paste', this._pasteHandler);
      this._pasteHandler = null;
    }
    this._sidebarObserver?.disconnect();
    this._sidebarObserver = null;
    this._el                   = null;
    this._svgEl                = null;
    this._cardEl               = null;
    this._transformEl          = null;
    this._isConnectMode        = false;
    this._connectSourceId      = null;
    this._connectBtn           = null;
    this._selectedConnectionId = null;
    this._panX                 = 0;
    this._panY                 = 0;
    this._zoom                 = 1;
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
    const addImg  = this._toolBtn('🖼 Image Card', false, () => this._addImageCard());

    const connect = this._toolBtn('⟷ Connect', false, () => this._toggleConnectMode());
    connect.id = 'pb-btn-connect';
    this._connectBtn = connect;

    const del = this._toolBtn('🗑 Delete', false, () => this._deleteSelected());
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

  // ── Sidebar clipping ───────────────────────────────────────────

  _updateBoardBounds() {
    const w = document.querySelector('#sidebar')?.getBoundingClientRect().width ?? 0;
    if (this._el) this._el.style.right = w + 'px';
  }

  // ── Transform helpers ──────────────────────────────────────────

  _applyTransform() {
    if (this._transformEl) {
      this._transformEl.style.transform =
        `translate(${this._panX}px, ${this._panY}px) scale(${this._zoom})`;
    }
  }

  // Convert viewport clientX/clientY to board-space coordinates
  _toBoard(clientX, clientY) {
    return {
      x: (clientX - this._panX) / this._zoom,
      y: (clientY - this._panY) / this._zoom,
    };
  }

  // ── Image card ─────────────────────────────────────────────────

  _addImageCard() {
    const input = document.createElement('input');
    input.type   = 'file';
    input.accept = 'image/*';
    input.style.cssText = 'position:fixed;opacity:0;width:0;height:0;';
    document.body.appendChild(input);
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file) this._readImageFile(file, (url) => this._createImageCard(url));
      input.remove();
    });
    input.addEventListener('cancel', () => input.remove());
    input.click();
  }

  _readImageFile(file, cb) {
    const reader = new FileReader();
    reader.addEventListener('load', () => cb(reader.result));
    reader.readAsDataURL(file);
  }

  _createImageCard(imageUrl) {
    const center = this._toBoard(this._el.clientWidth / 2, this._el.clientHeight / 2);
    const card = {
      id:       crypto.randomUUID(),
      type:     'image',
      x:        Math.round(center.x - 160),
      y:        Math.round(center.y - 120),
      w:        320,
      h:        240,
      color:    CARD_COLORS[0].value,
      imageUrl,
      text:     '',
    };
    this._state.cards.push(card);
    this._renderCard(card);
    this._select(card.id);
    this._save();
  }

  // ── Label edit (image cards) ────────────────────────────────────

  _attachLabelEdit(el, card, label) {
    label.addEventListener('blur', () => {
      label.contentEditable = 'false';
      card.text = label.textContent ?? '';
      this._save();
    });
    label.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || e.key === 'Enter') label.blur();
      e.stopPropagation();
    });
  }

  // ── Card creation ──────────────────────────────────────────────

  _addCard() {
    const center = this._toBoard(this._el.clientWidth / 2, this._el.clientHeight / 2);
    const card = {
      id:    crypto.randomUUID(),
      type:  'text',
      x:     Math.round(center.x - 120),
      y:     Math.round(center.y - 80),
      w:     240,
      h:     160,
      color: CARD_COLORS[0].value,
      text:  '',
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
    this._renderAllLines();
  }

  _renderCard(card) {
    const el = document.createElement('div');
    el.className = 'sb-card';
    el.dataset.id = card.id;
    el.style.left       = card.x + 'px';
    el.style.top        = card.y + 'px';
    el.style.width      = card.w + 'px';
    el.style.height     = card.h + 'px';
    el.style.background = card.color;

    const header = document.createElement('div');
    header.className = 'sb-card-header';

    const body = document.createElement('div');
    body.className = 'sb-card-body';

    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'sb-resize-handle';

    el.append(header, body, resizeHandle);
    this._cardEl.appendChild(el);

    if (card.type === 'image') {
      el.classList.add('sb-card-image');
      const img = document.createElement('img');
      img.className = 'sb-card-img';
      img.src       = card.imageUrl ?? '';
      img.draggable = false;

      const label = document.createElement('div');
      label.className       = 'sb-card-label';
      label.contentEditable = 'false';
      label.textContent     = card.text ?? '';

      body.append(img);
      header.append(label);
      this._attachLabelEdit(el, card, label);
    } else {
      body.contentEditable = 'false';
      body.innerHTML = card.text ?? '';
      this._attachEdit(el, card, body);
    }

    this._attachDrag(el, card);
    this._attachResize(el, card, resizeHandle);
    this._attachContextMenu(el, card);

    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      if (this._isConnectMode) {
        this._handleConnectClick(card.id);
        e.stopPropagation();
        return;
      }
      this._select(card.id);
      e.stopPropagation();
    });
  }

  _cardEl_forId(id) {
    return this._cardEl?.querySelector(`.sb-card[data-id="${id}"]`) ?? null;
  }

  // ── Selection ──────────────────────────────────────────────────

  _select(id) {
    this._deselectConnection();
    this._cardEl?.querySelectorAll('.sb-card.sb-selected')
      .forEach(el => el.classList.remove('sb-selected'));
    this._selectedId = id;
    if (id) this._cardEl_forId(id)?.classList.add('sb-selected');
  }

  _selectConnection(id) {
    // Deselect any card
    this._cardEl?.querySelectorAll('.sb-card.sb-selected')
      .forEach(el => el.classList.remove('sb-selected'));
    this._selectedId = null;
    // Deselect previous connection
    this._deselectConnection();
    this._selectedConnectionId = id;
    // Highlight new connection
    if (id) {
      const group = this._svgEl?.querySelector(`g[data-conn-id="${id}"]`);
      const visLine = group?.querySelector('line');
      visLine?.setAttribute('stroke', '#f0c040');
      visLine?.setAttribute('stroke-width', '3');
      visLine?.setAttribute('opacity', '1');
    }
  }

  _deselectConnection() {
    if (!this._selectedConnectionId) return;
    const conn = this._state.connections.find(c => c.id === this._selectedConnectionId);
    const group = this._svgEl?.querySelector(`g[data-conn-id="${this._selectedConnectionId}"]`);
    if (group && conn) {
      const visLine = group.querySelector('line');
      visLine?.setAttribute('stroke', conn.color ?? LINE_DEFAULT_COLOR);
      visLine?.setAttribute('stroke-width', '2');
      visLine?.setAttribute('opacity', '0.75');
    }
    this._selectedConnectionId = null;
  }

  // ── Drag ───────────────────────────────────────────────────────

  _attachDrag(el, card) {
    let startX, startY, origX, origY, dragging = false;

    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
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
      card.x = origX + (e.clientX - startX) / this._zoom;
      card.y = origY + (e.clientY - startY) / this._zoom;
      el.style.left = card.x + 'px';
      el.style.top  = card.y + 'px';
      this._updateLinesForCard(card.id);
    });

    el.addEventListener('pointerup', (e) => {
      if (!dragging) return;
      dragging = false;
      card.x = origX + (e.clientX - startX) / this._zoom;
      card.y = origY + (e.clientY - startY) / this._zoom;
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
      card.w = Math.max(120, origW + (e.clientX - startX) / this._zoom);
      card.h = Math.max(80,  origH + (e.clientY - startY) / this._zoom);
      el.style.width  = card.w + 'px';
      el.style.height = card.h + 'px';
      this._updateLinesForCard(card.id);
    });

    handle.addEventListener('pointerup', (e) => {
      if (!resizing) return;
      resizing = false;
      card.w = Math.max(120, origW + (e.clientX - startX) / this._zoom);
      card.h = Math.max(80,  origH + (e.clientY - startY) / this._zoom);
      this._save();
    });
  }

  // ── Inline edit ────────────────────────────────────────────────

  _attachEdit(el, card, body) {
    body.addEventListener('blur', () => {
      body.contentEditable = 'false';
      el.querySelector('.pb-format-bar')?.remove();
      card.text = body.innerHTML;
      this._save();
    });

    body.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        body.innerHTML = card.text ?? ''; // revert
        body.blur();
      }
      e.stopPropagation();
    });
  }

  // ── Color palette helpers ──────────────────────────────────────

  _getCardColors() {
    try {
      return Array.from({ length: 7 }, (_, i) => ({
        label: `Color ${i + 1}`,
        value: game.settings.get(MODULE_ID, `cardColor${i}`) ?? CARD_COLORS[i]?.value,
      }));
    } catch { return CARD_COLORS; }
  }

  _getLineColors() {
    try {
      return Array.from({ length: 7 }, (_, i) => ({
        label: `Color ${i + 1}`,
        value: game.settings.get(MODULE_ID, `lineColor${i}`) ?? LINE_COLORS[i]?.value,
      }));
    } catch { return LINE_COLORS; }
  }

  // ── Format bar ─────────────────────────────────────────────────

  _attachFormatBar(cardEl, body) {
    cardEl.querySelector('.pb-format-bar')?.remove(); // idempotent
    const bar = document.createElement('div');
    bar.className = 'pb-format-bar';

    const btn = (html, action) => {
      const b = document.createElement('button');
      b.className = 'pb-format-btn';
      b.innerHTML = html;
      b.addEventListener('mousedown', (e) => { e.preventDefault(); action(); });
      return b;
    };

    // Text-color picker button
    const colorBtn = document.createElement('button');
    colorBtn.className = 'pb-format-btn';
    colorBtn.title = 'Text color';
    colorBtn.innerHTML = '🎨';
    colorBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const inp = document.createElement('input');
      inp.type = 'color';
      inp.style.cssText = 'position:fixed;opacity:0;width:0;height:0;';
      document.body.appendChild(inp);
      inp.addEventListener('input', () => {
        document.execCommand('foreColor', false, inp.value);
      });
      inp.addEventListener('change', () => inp.remove());
      inp.click();
    });

    // Step the font size of the current selection by delta px.
    // execCommand('fontSize') only accepts 1-7, so we wrap with size=7
    // then immediately replace the size attribute with a px inline style.
    const adjustSize = (delta) => {
      const sel = window.getSelection();
      let currentPx = 13; // card body default
      if (sel && sel.rangeCount > 0) {
        const node = sel.getRangeAt(0).commonAncestorContainer;
        const target = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
        const computed = parseFloat(window.getComputedStyle(target).fontSize);
        if (!isNaN(computed)) currentPx = computed;
      }
      const newPx = Math.max(6, Math.round(currentPx + delta));
      document.execCommand('fontSize', false, '7');
      body.querySelectorAll('font[size="7"]').forEach(f => {
        f.style.fontSize = newPx + 'px';
        f.removeAttribute('size');
      });
    };

    bar.append(
      btn('<b>B</b>', () => document.execCommand('bold')),
      btn('<i>I</i>', () => document.execCommand('italic')),
      btn('<u>U</u>', () => document.execCommand('underline')),
      btn('<s>S</s>', () => document.execCommand('strikeThrough')),
      colorBtn,
      btn('A−', () => adjustSize(-4)),
      btn('A＋', () => adjustSize(+4)),
    );

    // Insert before the header strip (first child)
    cardEl.insertBefore(bar, cardEl.firstChild);
  }

  // ── Context menu ───────────────────────────────────────────────

  _attachContextMenu(el, card) {
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._select(card.id);
      this._openCardContextMenu(e.clientX, e.clientY, card);
    });
  }

  _openCardContextMenu(x, y, card) {
    this._closeContextMenu();

    const menu = document.createElement('div');
    menu.id = 'pb-context-menu';
    menu.style.left = x + 'px';
    menu.style.top  = y + 'px';

    const editBtn = document.createElement('button');
    editBtn.className = 'pb-menu-item';
    editBtn.textContent = card.type === 'image' ? '✏ Edit Label' : '✏ Edit Text';
    editBtn.addEventListener('click', () => {
      this._closeContextMenu();
      const cardEl = this._cardEl_forId(card.id);
      if (card.type === 'image') {
        const labelEl = cardEl?.querySelector('.sb-card-label');
        if (labelEl) { labelEl.contentEditable = 'true'; labelEl.focus(); }
      } else {
        const body = cardEl?.querySelector('.sb-card-body');
        if (body && cardEl) {
          body.contentEditable = 'true';
          this._attachFormatBar(cardEl, body);
          body.focus();
        }
      }
    });

    const swatches = document.createElement('div');
    swatches.className = 'pb-color-swatches';

    for (const { label, value } of this._getCardColors()) {
      const swatch = document.createElement('button');
      swatch.className = 'pb-swatch';
      swatch.title = label;
      swatch.style.background = value;
      if (value === card.color) swatch.classList.add('pb-swatch-active');
      swatch.addEventListener('click', () => {
        card.color = value;
        const cardEl = this._cardEl_forId(card.id);
        if (cardEl) cardEl.style.background = value;
        swatches.querySelectorAll('.pb-swatch').forEach(s => s.classList.remove('pb-swatch-active'));
        swatch.classList.add('pb-swatch-active');
        this._save();
        this._closeContextMenu();
      });
      swatches.appendChild(swatch);
    }

    // 8th swatch — free-form color picker
    const customSwatch = document.createElement('button');
    customSwatch.className = 'pb-swatch pb-swatch-custom';
    customSwatch.title = 'Custom color';
    customSwatch.addEventListener('click', () => {
      const inp = document.createElement('input');
      inp.type = 'color';
      inp.value = card.color;
      inp.style.cssText = 'position:fixed;opacity:0;width:0;height:0;';
      document.body.appendChild(inp);
      inp.addEventListener('input', () => {
        card.color = inp.value;
        const cardEl = this._cardEl_forId(card.id);
        if (cardEl) cardEl.style.background = inp.value;
        this._save();
      });
      inp.addEventListener('change', () => { inp.remove(); this._closeContextMenu(); });
      inp.click();
    });
    swatches.appendChild(customSwatch);

    const sep = document.createElement('hr');
    sep.className = 'pb-menu-separator';

    const delBtn = document.createElement('button');
    delBtn.className = 'pb-menu-item pb-menu-delete';
    delBtn.textContent = '🗑 Delete Card';
    delBtn.addEventListener('click', () => {
      this._deleteCard(card.id);
      this._closeContextMenu();
    });

    menu.append(editBtn, swatches, sep, delBtn);
    this._mountContextMenu(menu);
  }

  _openLineContextMenu(x, y, conn) {
    this._closeContextMenu();

    const menu = document.createElement('div');
    menu.id = 'pb-context-menu';
    menu.style.left = x + 'px';
    menu.style.top  = y + 'px';

    const swatches = document.createElement('div');
    swatches.className = 'pb-color-swatches';

    for (const { label, value } of this._getLineColors()) {
      const swatch = document.createElement('button');
      swatch.className = 'pb-swatch';
      swatch.title = label;
      swatch.style.background = value;
      if (value === conn.color) swatch.classList.add('pb-swatch-active');
      swatch.addEventListener('click', () => {
        conn.color = value;
        this._selectedConnectionId = null; // deselect so new color shows
        this._renderAllLines();
        this._save();
        this._closeContextMenu();
      });
      swatches.appendChild(swatch);
    }

    // 8th swatch — free-form color picker
    const customSwatch = document.createElement('button');
    customSwatch.className = 'pb-swatch pb-swatch-custom';
    customSwatch.title = 'Custom color';
    customSwatch.addEventListener('click', () => {
      const inp = document.createElement('input');
      inp.type = 'color';
      inp.value = conn.color ?? LINE_DEFAULT_COLOR;
      inp.style.cssText = 'position:fixed;opacity:0;width:0;height:0;';
      document.body.appendChild(inp);
      inp.addEventListener('input', () => {
        conn.color = inp.value;
        this._selectedConnectionId = null;
        this._renderAllLines();
        this._save();
      });
      inp.addEventListener('change', () => { inp.remove(); this._closeContextMenu(); });
      inp.click();
    });
    swatches.appendChild(customSwatch);

    const sep = document.createElement('hr');
    sep.className = 'pb-menu-separator';

    const delBtn = document.createElement('button');
    delBtn.className = 'pb-menu-item pb-menu-delete';
    delBtn.textContent = '🗑 Delete Connection';
    delBtn.addEventListener('click', () => {
      this._deleteConnection(conn.id);
      this._closeContextMenu();
    });

    menu.append(swatches, sep, delBtn);
    this._mountContextMenu(menu);
  }

  _mountContextMenu(menu) {
    document.body.appendChild(menu);
    this._contextMenu = menu;

    const outsideHandler = (e) => {
      if (this._contextMenu?.contains(e.target)) {
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

  // ── Connect mode ───────────────────────────────────────────────

  _toggleConnectMode() {
    if (this._isConnectMode) {
      this._exitConnectMode();
    } else {
      this._isConnectMode = true;
      this._connectBtn?.classList.add('pb-btn-active');
      this._el?.classList.add('pb-connect-mode');
    }
  }

  _exitConnectMode() {
    this._isConnectMode = false;
    this._connectBtn?.classList.remove('pb-btn-active');
    this._el?.classList.remove('pb-connect-mode');
    if (this._connectSourceId) {
      this._cardEl_forId(this._connectSourceId)?.classList.remove('pb-connect-source');
      this._connectSourceId = null;
    }
  }

  _handleConnectClick(cardId) {
    if (!this._connectSourceId) {
      // Set source
      this._connectSourceId = cardId;
      this._cardEl_forId(cardId)?.classList.add('pb-connect-source');
    } else if (this._connectSourceId === cardId) {
      // Clicked same card — cancel
      this._exitConnectMode();
    } else {
      // Create connection
      const conn = {
        id:         crypto.randomUUID(),
        fromCardId: this._connectSourceId,
        toCardId:   cardId,
        color:      LINE_DEFAULT_COLOR,
      };
      this._state.connections.push(conn);
      this._renderLine(conn);
      this._exitConnectMode();
      this._save();
    }
  }

  // ── SVG line rendering ─────────────────────────────────────────

  _renderAllLines() {
    if (!this._svgEl) return;
    this._svgEl.innerHTML = '';
    for (const conn of this._state.connections) this._renderLine(conn);
  }

  _renderLine(conn) {
    const from = this._state.cards.find(c => c.id === conn.fromCardId);
    const to   = this._state.cards.find(c => c.id === conn.toCardId);
    if (!from || !to || !this._svgEl) return;

    const x1 = from.x + from.w / 2;
    const y1 = from.y + from.h / 2;
    const x2 = to.x   + to.w   / 2;
    const y2 = to.y   + to.h   / 2;

    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    group.dataset.connId = conn.id;

    const isSelected = conn.id === this._selectedConnectionId;

    // Visible line
    const visLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    visLine.setAttribute('x1', x1); visLine.setAttribute('y1', y1);
    visLine.setAttribute('x2', x2); visLine.setAttribute('y2', y2);
    visLine.setAttribute('stroke',       isSelected ? '#f0c040' : (conn.color ?? LINE_DEFAULT_COLOR));
    visLine.setAttribute('stroke-width', isSelected ? '3' : '2');
    visLine.setAttribute('opacity',      isSelected ? '1' : '0.75');
    visLine.setAttribute('pointer-events', 'none');

    // Wide transparent hit target
    const hitLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    hitLine.setAttribute('x1', x1); hitLine.setAttribute('y1', y1);
    hitLine.setAttribute('x2', x2); hitLine.setAttribute('y2', y2);
    hitLine.setAttribute('stroke', 'transparent');
    hitLine.setAttribute('stroke-width', '14');
    hitLine.setAttribute('pointer-events', 'stroke');
    hitLine.style.cursor = 'pointer';

    hitLine.addEventListener('click', (e) => {
      this._selectConnection(conn.id);
      e.stopPropagation();
    });

    hitLine.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._selectConnection(conn.id);
      this._openLineContextMenu(e.clientX, e.clientY, conn);
    });

    group.append(visLine, hitLine);
    this._svgEl.appendChild(group);
  }

  // Update line endpoints when a card moves or resizes
  _updateLinesForCard(cardId) {
    const card = this._state.cards.find(c => c.id === cardId);
    if (!card || !this._svgEl) return;

    const cx = card.x + card.w / 2;
    const cy = card.y + card.h / 2;

    for (const conn of this._state.connections) {
      if (conn.fromCardId !== cardId && conn.toCardId !== cardId) continue;
      const group = this._svgEl.querySelector(`g[data-conn-id="${conn.id}"]`);
      if (!group) continue;

      group.querySelectorAll('line').forEach(line => {
        if (conn.fromCardId === cardId) {
          line.setAttribute('x1', cx);
          line.setAttribute('y1', cy);
        }
        if (conn.toCardId === cardId) {
          line.setAttribute('x2', cx);
          line.setAttribute('y2', cy);
        }
      });
    }
  }

  // ── Delete / Clear ─────────────────────────────────────────────

  _deleteSelected() {
    if (this._selectedConnectionId) {
      this._deleteConnection(this._selectedConnectionId);
    } else if (this._selectedId) {
      this._deleteCard(this._selectedId);
    }
  }

  _deleteCard(id) {
    this._state.cards = this._state.cards.filter(c => c.id !== id);

    // Remove SVG groups for connections involving this card
    const toRemove = this._state.connections.filter(
      cn => cn.fromCardId === id || cn.toCardId === id
    );
    toRemove.forEach(cn => {
      this._svgEl?.querySelector(`g[data-conn-id="${cn.id}"]`)?.remove();
      if (this._selectedConnectionId === cn.id) this._selectedConnectionId = null;
    });
    this._state.connections = this._state.connections.filter(
      cn => cn.fromCardId !== id && cn.toCardId !== id
    );

    this._cardEl_forId(id)?.remove();
    if (this._selectedId === id) this._selectedId = null;
    this._save();
  }

  _deleteConnection(id) {
    this._state.connections = this._state.connections.filter(c => c.id !== id);
    this._svgEl?.querySelector(`g[data-conn-id="${id}"]`)?.remove();
    if (this._selectedConnectionId === id) this._selectedConnectionId = null;
    this._save();
  }

  _clearBoard() {
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
      this._selectedId = null;
      this._selectedConnectionId = null;
      this._renderAllCards();
      this._save();
    });

    cancel.addEventListener('click', () => dialog.remove());
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
