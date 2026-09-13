(function () {
  'use strict';

  const NW = window.Crosswap;
  const SIZE = NW.SIZE;
  const MAX_STARS = NW.MAX_SWAPS - NW.MIN_SWAPS;
  const UNDO_WINDOW_MS = 10000;
  const DRAG_THRESHOLD_PX = 6;
  const GAME_KEY = 'crosswap.game.v1';
  const STATS_KEY = 'crosswap.stats.v1';
  const DIRECTION_NAMES = { L: 'left', U: 'up', R: 'right', D: 'down' };

  const $ = (id) => document.getElementById(id);
  const els = {
    board: $('board'),
    swapsLeft: $('swaps-left'),
    swapsLabel: $('swaps-label'),
    stars: $('stars'),
    undo: $('btn-undo'),
    undoFill: $('undo-fill'),
    undoTime: $('undo-time'),
    newGame: $('btn-new'),
    result: $('result'),
    resultTitle: $('result-title'),
    resultText: $('result-text'),
    next: $('btn-next'),
    help: $('help'),
    stats: $('stats'),
    statsBody: $('stats-body'),
    btnHelp: $('btn-help'),
    btnStats: $('btn-stats'),
  };

  let state = null;
  let tileEls = [];
  const posToTile = new Array(SIZE * SIZE).fill(-1);
  let selected = -1;
  let drag = null;

  // ---------- Persistence ----------

  const storage = {
    get(key) {
      try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage unavailable */ }
    },
  };

  const saveGame = () => storage.set(GAME_KEY, state);

  function isValidGame(g) {
    return !!g && g.version === 1 && Array.isArray(g.tiles) && g.tiles.length === 40 &&
      Array.isArray(g.solution) && Array.isArray(g.clues) && Array.isArray(g.moves);
  }

  function loadStats() {
    const s = Object.assign({ played: 0, won: 0, streak: 0, best: 0 }, storage.get(STATS_KEY) || {});
    if (!Array.isArray(s.stars) || s.stars.length !== MAX_STARS + 1) s.stars = new Array(MAX_STARS + 1).fill(0);
    return s;
  }

  function recordResult(won) {
    const s = loadStats();
    s.played++;
    if (won) {
      s.won++;
      s.streak++;
      s.best = Math.max(s.best, s.streak);
      s.stars[Math.min(state.swapsLeft, MAX_STARS)]++;
    } else {
      s.streak = 0;
    }
    storage.set(STATS_KEY, s);
  }

  // ---------- Game state ----------

  function createGame() {
    const puzzle = NW.createPuzzle();
    const tiles = [];
    puzzle.board.forEach((v, pos) => { if (NW.isTilePos(pos)) tiles.push({ v, p: pos }); });
    return {
      version: 1,
      solution: puzzle.solution,
      clues: puzzle.clues,
      tiles,
      swapsLeft: NW.MAX_SWAPS,
      status: 'playing', // 'playing' | 'won' | 'lost'
      moves: [],         // { a, b, t } — tile ids swapped and when
      recorded: false,   // result written to stats (final, no more undo)
      revealed: [],      // tile ids moved into place after a loss
    };
  }

  function indexTiles() {
    posToTile.fill(-1);
    state.tiles.forEach((t, id) => { posToTile[t.p] = id; });
  }

  const isCorrect = (id) => state.tiles[id].v === state.solution[state.tiles[id].p];
  const isSolved = () => state.tiles.every((_, id) => isCorrect(id));
  const canMove = (id) => state.status === 'playing' && !isCorrect(id);

  // The most recent swap, if it's still inside the undo window.
  function undoableMove(now = Date.now()) {
    if (state.recorded) return null;
    const m = state.moves[state.moves.length - 1];
    if (!m) return null;
    const age = now - m.t;
    return age >= 0 && age < UNDO_WINDOW_MS ? m : null;
  }

  function swapPositions(a, b) {
    const ta = state.tiles[a];
    const tb = state.tiles[b];
    [ta.p, tb.p] = [tb.p, ta.p];
    indexTiles();
  }

  function swap(a, b) {
    if (a === b || !canMove(a) || !canMove(b)) return;
    swapPositions(a, b);
    state.swapsLeft--;
    state.moves.push({ a, b, t: Date.now() });
    selected = -1;

    if (isSolved()) {
      state.status = 'won';
      state.recorded = true;
      recordResult(true);
    } else if (state.swapsLeft === 0) {
      // Not final yet: the player can still undo during the window.
      state.status = 'lost';
    }
    saveGame();
    render();
    if (state.status === 'won') els.board.classList.add('won');
  }

  function undo() {
    const m = undoableMove();
    if (!m) return;
    state.moves.pop();
    swapPositions(m.a, m.b);
    state.swapsLeft++;
    state.status = 'playing';
    selected = -1;
    saveGame();
    render();
  }

  // Once the undo window after the final swap closes, record the loss and slide
  // every misplaced tile into its solution position.
  function finalizeLoss() {
    state.recorded = true;
    recordResult(false);

    const wrong = state.tiles.map((_, id) => id).filter((id) => !isCorrect(id));
    const openByValue = {};
    for (const id of wrong) {
      const pos = state.tiles[id].p;
      (openByValue[state.solution[pos]] = openByValue[state.solution[pos]] || []).push(pos);
    }
    for (const id of wrong) {
      const t = state.tiles[id];
      t.p = openByValue[t.v].pop();
    }
    state.revealed = wrong;
    selected = -1;
    indexTiles();
    saveGame();
    render();
  }

  function startNewGame() {
    state = createGame();
    selected = -1;
    indexTiles();
    buildBoard();
    saveGame();
    render();
  }

  function requestNewGame() {
    if (state.status === 'playing' && state.swapsLeft < NW.MAX_SWAPS &&
        !window.confirm('Start a new puzzle? You will lose your progress on this one.')) {
      return;
    }
    if (state.status === 'lost' && !state.recorded) recordResult(false);
    startNewGame();
  }

  // ---------- Rendering ----------

  function place(el, pos) {
    el.style.setProperty('--x', pos % SIZE);
    el.style.setProperty('--y', Math.floor(pos / SIZE));
  }

  function buildBoard() {
    const board = els.board;
    board.textContent = '';
    board.classList.remove('won');

    for (let pos = 0; pos < SIZE * SIZE; pos++) {
      if (!NW.isTilePos(pos)) continue;
      const slot = document.createElement('div');
      slot.className = 'cell slot';
      place(slot, pos);
      board.appendChild(slot);
    }

    for (const clue of state.clues) {
      const el = document.createElement('div');
      el.className = 'cell clue';
      el.setAttribute('role', 'img');
      const names = clue.directions.split('').map((d) => DIRECTION_NAMES[d]);
      el.setAttribute('aria-label', `Clue: tiles ${names.join(' and ')} sum to ${clue.value}`);
      place(el, clue.y * SIZE + clue.x);
      for (const d of clue.directions) {
        const arrow = document.createElement('span');
        arrow.className = `arrow ${d}`;
        el.appendChild(arrow);
      }
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = clue.value;
      el.appendChild(tag);
      board.appendChild(el);
    }

    tileEls = state.tiles.map((t, id) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'cell tile';
      el.dataset.id = id;
      const face = document.createElement('span');
      face.className = 'face';
      face.textContent = t.v;
      el.appendChild(face);
      board.appendChild(el);
      return el;
    });
  }

  function buildStars() {
    for (let i = 0; i < MAX_STARS; i++) {
      const star = document.createElement('span');
      star.className = 'star';
      els.stars.appendChild(star);
    }
  }

  function render() {
    const now = Date.now();
    state.tiles.forEach((t, id) => {
      const el = tileEls[id];
      const x = t.p % SIZE;
      const y = Math.floor(t.p / SIZE);
      const correct = isCorrect(id);
      const revealed = state.revealed.includes(id);
      place(el, t.p);
      el.style.setProperty('--d', x + y);
      el.classList.toggle('correct', correct && !revealed);
      el.classList.toggle('revealed', revealed);
      el.classList.toggle('selected', id === selected);
      el.setAttribute('aria-disabled', String(!canMove(id)));
      el.setAttribute('aria-label', `${t.v}, row ${y + 1}, column ${x + 1}${correct && !revealed ? ', correct' : ''}${id === selected ? ', selected' : ''}`);
    });

    els.swapsLeft.textContent = state.swapsLeft;
    els.swapsLabel.textContent = state.swapsLeft === 1 ? 'swap remaining' : 'swaps remaining';
    const starCount = Math.min(state.swapsLeft, MAX_STARS);
    Array.from(els.stars.children).forEach((star, i) => star.classList.toggle('on', i < starCount));

    renderUndo(now);
    renderResult(now);
  }

  function renderUndo(now) {
    const m = state.status === 'won' ? null : undoableMove(now);
    els.undo.disabled = !m;
    if (m) {
      const left = UNDO_WINDOW_MS - (now - m.t);
      els.undoFill.style.width = `${(left / UNDO_WINDOW_MS) * 100}%`;
      els.undoTime.textContent = `${Math.ceil(left / 1000)}s`;
    } else {
      els.undoFill.style.width = '0%';
      els.undoTime.textContent = '';
    }
  }

  function renderResult(now) {
    const { result, resultTitle, resultText, next } = els;
    if (state.status === 'playing') {
      result.hidden = true;
      return;
    }
    result.hidden = false;
    if (state.status === 'won') {
      const stars = Math.min(state.swapsLeft, MAX_STARS);
      resultTitle.textContent = 'Solved!';
      resultText.textContent = stars > 0
        ? `${'★'.repeat(stars)}  ${stars} star${stars === 1 ? '' : 's'}: you had ${state.swapsLeft} swap${state.swapsLeft === 1 ? '' : 's'} left.`
        : 'Solved on your last swap.';
      next.hidden = false;
    } else if (state.recorded) {
      resultTitle.textContent = 'Out of swaps';
      resultText.textContent = 'The grey tiles have moved to where they belong.';
      next.hidden = false;
    } else {
      const m = undoableMove(now);
      const secs = m ? Math.ceil((UNDO_WINDOW_MS - (now - m.t)) / 1000) : 0;
      resultTitle.textContent = 'Out of swaps';
      resultText.textContent = `Undo your last swap within ${secs}s to keep playing.`;
      next.hidden = true;
    }
  }

  function renderStats() {
    const s = loadStats();
    const winPct = s.played ? Math.round((s.won / s.played) * 100) : 0;
    const top = Math.max(...s.stars);
    const rows = [];
    for (let n = MAX_STARS; n >= 0; n--) {
      const width = top ? Math.max(8, (s.stars[n] / top) * 100) : 8;
      rows.push(
        `<div class="dist-row"><span>${n}★</span>` +
        `<span class="dist-bar${s.stars[n] && s.stars[n] === top ? ' best' : ''}" style="width:${width}%">${s.stars[n]}</span></div>`
      );
    }
    els.statsBody.innerHTML =
      '<div class="stat-grid">' +
      `<div><strong>${s.played}</strong><span>Played</span></div>` +
      `<div><strong>${winPct}</strong><span>Win %</span></div>` +
      `<div><strong>${s.streak}</strong><span>Streak</span></div>` +
      `<div><strong>${s.best}</strong><span>Best streak</span></div>` +
      '</div>' +
      `<div class="dist"><h3>Stars per win</h3>${rows.join('')}</div>`;
  }

  // ---------- Input ----------

  function tileAtPoint(clientX, clientY) {
    const rect = els.board.getBoundingClientRect();
    const x = Math.floor(((clientX - rect.left) / rect.width) * SIZE);
    const y = Math.floor(((clientY - rect.top) / rect.height) * SIZE);
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return -1;
    return posToTile[y * SIZE + x];
  }

  function tap(id) {
    if (!canMove(id)) return;
    if (selected === -1) selected = id;
    else if (selected === id) selected = -1;
    else return swap(selected, id);
    render();
  }

  function setDropTarget(id) {
    if (drag.target === id) return;
    if (drag.target >= 0) tileEls[drag.target].classList.remove('drop-target');
    drag.target = id;
    if (id >= 0) tileEls[id].classList.add('drop-target');
  }

  function endDrag() {
    const d = drag;
    drag = null;
    d.el.classList.remove('dragging');
    d.el.style.removeProperty('--dx');
    d.el.style.removeProperty('--dy');
    if (d.target >= 0) tileEls[d.target].classList.remove('drop-target');
    return d;
  }

  els.board.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.tile');
    if (!el || e.button > 0 || drag) return;
    const id = Number(el.dataset.id);
    if (!canMove(id)) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    drag = { id, el, pointerId: e.pointerId, sx: e.clientX, sy: e.clientY, moved: false, target: -1 };
  });

  els.board.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const dx = e.clientX - drag.sx;
    const dy = e.clientY - drag.sy;
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      drag.moved = true;
      drag.el.classList.add('dragging');
      if (selected !== -1) {
        selected = -1;
        render();
      }
    }
    drag.el.style.setProperty('--dx', `${dx}px`);
    drag.el.style.setProperty('--dy', `${dy}px`);
    const target = tileAtPoint(e.clientX, e.clientY);
    setDropTarget(target !== drag.id && target >= 0 && canMove(target) ? target : -1);
  });

  els.board.addEventListener('pointerup', (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const d = endDrag();
    if (!d.moved) tap(d.id);
    else if (d.target >= 0) swap(d.id, d.target);
  });

  els.board.addEventListener('pointercancel', (e) => {
    if (drag && e.pointerId === drag.pointerId) endDrag();
  });

  // Keyboard activation (Enter/Space) arrives as a click with detail 0.
  els.board.addEventListener('click', (e) => {
    const el = e.target.closest('.tile');
    if (el && e.detail === 0) tap(Number(el.dataset.id));
  });

  document.addEventListener('keydown', (e) => {
    if (document.querySelector('dialog[open]')) return;
    const key = e.key.toLowerCase();
    if ((key === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey) || (key === 'u' && !e.ctrlKey && !e.metaKey && !e.altKey)) {
      e.preventDefault();
      undo();
    } else if (key === 'escape' && selected !== -1) {
      selected = -1;
      render();
    }
  });

  els.undo.addEventListener('click', undo);
  els.newGame.addEventListener('click', requestNewGame);
  els.next.addEventListener('click', startNewGame);
  els.btnHelp.addEventListener('click', () => els.help.showModal());
  els.btnStats.addEventListener('click', () => {
    renderStats();
    els.stats.showModal();
  });
  for (const dialog of [els.help, els.stats]) {
    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  }

  // ---------- Boot ----------

  const saved = storage.get(GAME_KEY);
  state = isValidGame(saved) ? saved : createGame();
  state.revealed = state.revealed || [];
  // Games saved before clues always pointed at perpendicular tiles get fresh
  // clues for the same solution, so progress on the board is kept.
  const perpendicular = (c) => c.directions.length === 2 && /[LR]/.test(c.directions) && /[UD]/.test(c.directions);
  if (!state.clues.every(perpendicular)) state.clues = NW.generateClues(state.solution);
  indexTiles();
  buildBoard();
  buildStars();
  render();
  saveGame();
  if (!saved) els.help.showModal();

  setInterval(() => {
    if (state.status === 'lost' && !state.recorded && !undoableMove()) {
      finalizeLoss();
      return;
    }
    const now = Date.now();
    renderUndo(now);
    if (state.status === 'lost') renderResult(now);
  }, 100);
})();
