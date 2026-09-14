// Solving helpers used to vet generated Crosswap puzzles.
//
// Boards and solutions are arrays of 49 grid cells (row by row, 0 in the gaps).
(function (global) {
  'use strict';

  const SIZE = 7;
  const CELLS = SIZE * SIZE;
  const DIRECTIONS = { L: [-1, 0], U: [0, -1], R: [1, 0], D: [0, 1] };
  const ALL_VALUES = 0b11111110; // bits 1..7

  const isTilePos = (pos) => (pos % SIZE) % 2 === 0 || Math.floor(pos / SIZE) % 2 === 0;
  const TILE_POSITIONS = [];
  for (let pos = 0; pos < CELLS; pos++) if (isTilePos(pos)) TILE_POSITIONS.push(pos);

  // The eight full lines (rows and columns 0, 2, 4, 6) and the lines each cell is on.
  const LINES = [];
  for (const k of [0, 2, 4, 6]) {
    const row = [];
    const col = [];
    for (let i = 0; i < SIZE; i++) {
      row.push(k * SIZE + i);
      col.push(i * SIZE + k);
    }
    LINES.push(row, col);
  }
  const CELL_LINES = Array.from({ length: CELLS }, () => []);
  LINES.forEach((line, li) => line.forEach((pos) => CELL_LINES[pos].push(li)));

  function popcount(mask) {
    let n = 0;
    for (; mask; mask &= mask - 1) n++;
    return n;
  }

  // Count the arrangements consistent with what the player can see: green tiles
  // are fixed, every other tile is not its current number, the board's numbers
  // are used exactly once each, every full line holds 1..7 and clue sums hold.
  // Stops at `limit` solutions; `exhausted` means the search gave up early.
  function countSolutions(board, solution, clues, { limit = 2, nodeLimit = 20000 } = {}) {
    const assign = new Array(CELLS).fill(0);
    const counts = new Array(8).fill(0);
    const lineUsed = new Array(LINES.length).fill(0);
    const unknown = [];

    const place = (pos, v) => {
      assign[pos] = v;
      counts[v]--;
      for (const li of CELL_LINES[pos]) lineUsed[li] |= 1 << v;
    };
    const unplace = (pos, v) => {
      assign[pos] = 0;
      counts[v]++;
      for (const li of CELL_LINES[pos]) lineUsed[li] &= ~(1 << v);
    };

    for (const pos of TILE_POSITIONS) counts[board[pos]]++;
    for (const pos of TILE_POSITIONS) {
      if (board[pos] === solution[pos]) place(pos, board[pos]);
      else unknown.push(pos);
    }

    const cellClues = Array.from({ length: CELLS }, () => []);
    for (const { x, y, directions, value } of clues) {
      const targets = directions.split('').map((d) => (y + DIRECTIONS[d][1]) * SIZE + x + DIRECTIONS[d][0]);
      for (const pos of targets) cellClues[pos].push({ targets, value });
    }

    function domain(pos) {
      let mask = ALL_VALUES & ~(1 << board[pos]);
      for (const li of CELL_LINES[pos]) mask &= ~lineUsed[li];
      for (let v = 1; v <= 7; v++) if (counts[v] <= 0) mask &= ~(1 << v);
      for (const { targets, value } of cellClues[pos]) {
        let known = 0;
        let open = 0;
        for (const t of targets) {
          if (t === pos) continue;
          if (assign[t]) known += assign[t];
          else open++;
        }
        // Values v with open*1 <= value - known - v <= open*7.
        const lo = Math.max(1, value - known - 7 * open);
        const hi = Math.min(7, value - known - open);
        mask &= lo > hi ? 0 : ((1 << (hi + 1)) - 1) & ~((1 << lo) - 1);
      }
      return mask;
    }

    let found = 0;
    let nodes = 0;
    let exhausted = false;

    (function search() {
      if (++nodes > nodeLimit) {
        exhausted = true;
        return;
      }
      let best = -1;
      let bestMask = 0;
      let bestSize = 8;
      for (const pos of unknown) {
        if (assign[pos]) continue;
        const mask = domain(pos);
        const size = popcount(mask);
        if (size === 0) return;
        if (size < bestSize) {
          best = pos;
          bestMask = mask;
          bestSize = size;
          if (size === 1) break;
        }
      }
      if (best === -1) {
        found++;
        return;
      }
      for (let v = 1; v <= 7; v++) {
        if (!(bestMask & (1 << v))) continue;
        place(best, v);
        search();
        unplace(best, v);
        if (found >= limit || exhausted) return;
      }
    })();

    return { count: found, exhausted };
  }

  // Fewest swaps to turn `board` into `solution`. With repeated numbers this is
  // (misplaced tiles) - (most cycles the "needs value -> holds value" moves can
  // be split into), found by an exhaustive memoised search over those moves.
  function minSwaps(board, solution) {
    const edges = new Array(64).fill(0);
    let misplaced = 0;
    for (const pos of TILE_POSITIONS) {
      if (board[pos] !== solution[pos]) {
        edges[solution[pos] * 8 + board[pos]]++;
        misplaced++;
      }
    }

    const memo = new Map();
    function mostCycles() {
      const key = edges.join(',');
      if (memo.has(key)) return memo.get(key);
      let start = -1;
      for (let v = 1; v <= 7 && start < 0; v++) {
        for (let w = 1; w <= 7; w++) if (edges[v * 8 + w]) { start = v; break; }
      }
      let best = 0;
      if (start >= 0) {
        const visited = new Set([start]);
        (function walk(v) {
          for (let w = 1; w <= 7; w++) {
            if (!edges[v * 8 + w]) continue;
            edges[v * 8 + w]--;
            if (w === start) best = Math.max(best, 1 + mostCycles());
            else if (!visited.has(w)) {
              visited.add(w);
              walk(w);
              visited.delete(w);
            }
            edges[v * 8 + w]++;
          }
        })(start);
      }
      memo.set(key, best);
      return best;
    }

    return misplaced - mostCycles();
  }

  global.CrosswapSolver = { countSolutions, minSwaps };
})(window);
