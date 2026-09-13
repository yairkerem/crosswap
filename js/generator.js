// Puzzle generation for Crosswap.
//
// The board is a 7x7 lattice: a cell exists wherever its column or row is even,
// leaving 9 gaps at (odd, odd). Rows/columns 0, 2, 4, 6 are full lines of 7 cells
// and must each contain 1..7 exactly once. Gaps hold sum clues joined to two
// adjacent cells.
(function (global) {
  'use strict';

  const SIZE = 7;
  const MAX_SWAPS = 20;
  const MIN_SWAPS = 15;
  const VALUES = [1, 2, 3, 4, 5, 6, 7];
  const DIRECTIONS = { L: [-1, 0], U: [0, -1], R: [1, 0], D: [0, 1] };

  function isTilePos(pos) {
    const x = pos % SIZE;
    const y = Math.floor(pos / SIZE);
    return x % 2 === 0 || y % 2 === 0;
  }

  const TILE_POSITIONS = [];
  for (let pos = 0; pos < SIZE * SIZE; pos++) {
    if (isTilePos(pos)) TILE_POSITIONS.push(pos);
  }

  function shuffle(items) {
    const a = items.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Fill the 4x4 grid of row/column intersections so no line repeats a value,
  // then complete each full line with its three missing values in random order.
  function generateSolution() {
    const cross = [[], [], [], []];

    function fill(k) {
      if (k === 16) return true;
      const r = k >> 2;
      const c = k & 3;
      for (const v of shuffle(VALUES)) {
        if (cross[r].slice(0, c).includes(v)) continue;
        let clash = false;
        for (let i = 0; i < r; i++) if (cross[i][c] === v) clash = true;
        if (clash) continue;
        cross[r][c] = v;
        if (fill(k + 1)) return true;
      }
      return false;
    }
    fill(0);

    const grid = new Array(SIZE * SIZE).fill(0);
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) grid[2 * r * SIZE + 2 * c] = cross[r][c];
    }
    for (let r = 0; r < 4; r++) {
      const missing = shuffle(VALUES.filter((v) => !cross[r].includes(v)));
      [1, 3, 5].forEach((x, i) => { grid[2 * r * SIZE + x] = missing[i]; });
    }
    for (let c = 0; c < 4; c++) {
      const column = cross.map((row) => row[c]);
      const missing = shuffle(VALUES.filter((v) => !column.includes(v)));
      [1, 3, 5].forEach((y, i) => { grid[y * SIZE + 2 * c] = missing[i]; });
    }
    return grid;
  }

  // One clue per gap, joined to two of its four neighbours.
  function generateClues(solution) {
    const clues = [];
    for (const y of [1, 3, 5]) {
      for (const x of [1, 3, 5]) {
        const picked = shuffle(Object.keys(DIRECTIONS)).slice(0, 2);
        const directions = Object.keys(DIRECTIONS).filter((d) => picked.includes(d)).join('');
        let value = 0;
        for (const d of directions) {
          const [dx, dy] = DIRECTIONS[d];
          value += solution[(y + dy) * SIZE + x + dx];
        }
        clues.push({ x, y, directions, value });
      }
    }
    return clues;
  }

  // Apply MIN_SWAPS disjoint swaps between tiles of different values. That leaves
  // exactly 2 * MIN_SWAPS misplaced tiles, and since a swap fixes at most two
  // tiles, the puzzle needs exactly MIN_SWAPS swaps to solve.
  function scramble(solution) {
    for (;;) {
      const order = shuffle(TILE_POSITIONS);
      const used = new Set();
      const pairs = [];
      for (let i = 0; i < order.length && pairs.length < MIN_SWAPS; i++) {
        const a = order[i];
        if (used.has(a)) continue;
        for (let j = i + 1; j < order.length; j++) {
          const b = order[j];
          if (!used.has(b) && solution[a] !== solution[b]) {
            used.add(a);
            used.add(b);
            pairs.push([a, b]);
            break;
          }
        }
      }
      if (pairs.length === MIN_SWAPS) {
        const board = solution.slice();
        for (const [a, b] of pairs) [board[a], board[b]] = [board[b], board[a]];
        return board;
      }
    }
  }

  function createPuzzle() {
    const solution = generateSolution();
    return { solution, clues: generateClues(solution), board: scramble(solution) };
  }

  global.Crosswap = { SIZE, MAX_SWAPS, MIN_SWAPS, isTilePos, createPuzzle };
})(window);
