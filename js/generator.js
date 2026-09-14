// Puzzle generation for Crosswap.
//
// The board is a 7x7 lattice: a cell exists wherever its column or row is even,
// leaving 9 gaps at (odd, odd). Rows/columns 0, 2, 4, 6 are full lines of 7 cells
// and must each contain 1..7 exactly once. Gaps hold sum clues whose arrows point
// at one horizontal and one vertical neighbour, and no cell is pointed at twice.
//
// Every puzzle starts with the 12 inner line crossings in place, needs exactly
// MIN_SWAPS swaps, and has exactly one solution given what the player can see
// (checked with CrosswapSolver, which must be loaded first).
(function (global) {
  'use strict';

  const Solver = global.CrosswapSolver;
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

  // Crossings of two full lines, except the four corners, start in place.
  function isFixedPos(pos) {
    const x = pos % SIZE;
    const y = Math.floor(pos / SIZE);
    const corner = (x === 0 || x === SIZE - 1) && (y === 0 || y === SIZE - 1);
    return x % 2 === 0 && y % 2 === 0 && !corner;
  }

  const TILE_POSITIONS = [];
  for (let pos = 0; pos < SIZE * SIZE; pos++) {
    if (isTilePos(pos)) TILE_POSITIONS.push(pos);
  }
  const SCRAMBLE_POSITIONS = TILE_POSITIONS.filter((pos) => !isFixedPos(pos));

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

  // Choices for the three gaps along one line: some `first`s followed by the
  // rest `second`s (e.g. L L R). A gap pointing `second` (right/down) is never
  // followed by one pointing `first` (left/up), so they never share a tile.
  function lineChoices(first, second) {
    const split = Math.floor(Math.random() * 4);
    return [0, 1, 2].map((i) => (i < split ? first : second));
  }

  // One clue per gap, pointing at two perpendicular neighbours: one to the left
  // or right, and one above or below. Horizontal and vertical targets are
  // different cells, so choosing each gap row and gap column as above keeps
  // every clue's tiles distinct.
  function generateClues(solution) {
    const across = [0, 1, 2].map(() => lineChoices('L', 'R'));
    const upDown = [0, 1, 2].map(() => lineChoices('U', 'D'));
    const clues = [];
    [1, 3, 5].forEach((y, row) => {
      [1, 3, 5].forEach((x, col) => {
        const picked = [across[row][col], upDown[col][row]];
        const directions = Object.keys(DIRECTIONS).filter((d) => picked.includes(d)).join('');
        let value = 0;
        for (const d of directions) {
          const [dx, dy] = DIRECTIONS[d];
          value += solution[(y + dy) * SIZE + x + dx];
        }
        clues.push({ x, y, directions, value });
      });
    });
    return clues;
  }

  // True when every clue points at one horizontal and one vertical neighbour
  // and no two clues point at the same cell.
  function cluesValid(clues) {
    const targets = new Set();
    for (const { x, y, directions } of clues) {
      if (directions.length !== 2 || !/[LR]/.test(directions) || !/[UD]/.test(directions)) return false;
      for (const d of directions) {
        const [dx, dy] = DIRECTIONS[d];
        const pos = (y + dy) * SIZE + x + dx;
        if (targets.has(pos)) return false;
        targets.add(pos);
      }
    }
    return true;
  }

  // Scramble the non-fixed tiles. Usually all of them move, sometimes one or two
  // stay put. The moving tiles are split into cycles, each holding distinct
  // values, and every tile takes the value of the next tile in its cycle. A cycle
  // of n tiles takes n - 1 swaps, so the lengths are chosen to total MIN_SWAPS
  // (mostly pairs plus a few longer cycles). Repeated values in different cycles
  // can open shortcuts, so the exact minimum is checked before accepting.
  function scramble(solution) {
    for (;;) {
      const stay = [0, 0, 1, 2][Math.floor(Math.random() * 4)];
      const moving = shuffle(SCRAMBLE_POSITIONS).slice(stay);
      const cycleCount = moving.length - MIN_SWAPS;
      const lengths = new Array(cycleCount).fill(2);
      for (let extra = moving.length - 2 * cycleCount; extra > 0; extra--) {
        lengths[Math.floor(Math.random() * cycleCount)]++;
      }

      const board = solution.slice();
      let offset = 0;
      let valid = true;
      for (const length of lengths) {
        const cycle = moving.slice(offset, offset + length);
        offset += length;
        if (new Set(cycle.map((pos) => solution[pos])).size !== length) {
          valid = false;
          break;
        }
        cycle.forEach((pos, i) => { board[pos] = solution[cycle[(i + 1) % length]]; });
      }
      if (valid && Solver.minSwaps(board, solution) === MIN_SWAPS) return board;
    }
  }

  function createPuzzle() {
    for (;;) {
      const solution = generateSolution();
      for (let attempt = 0; attempt < 10; attempt++) {
        const clues = generateClues(solution);
        const board = scramble(solution);
        const { count, exhausted } = Solver.countSolutions(board, solution, clues);
        if (count === 1 && !exhausted) return { solution, clues, board };
      }
    }
  }

  global.Crosswap = { SIZE, MAX_SWAPS, MIN_SWAPS, isTilePos, isFixedPos, createPuzzle, generateClues, cluesValid };
})(window);
