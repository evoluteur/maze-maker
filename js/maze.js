/* Maze Maker: generates square, circular, triangular and heart-shaped mazes with a choice of
   algorithms, lets you solve them with the keyboard or a finger, shows the
   solution, and exports PNG/SVG. Plain JS, no dependencies.

   A maze here is a grid of cells (a square grid, rings of cells around a
   center, a triangle of triangles, or a square grid cut to a heart) and a
   set of passages between neighboring cells. The algorithms
   all carve a spanning tree: every cell is reachable and there is exactly
   one path between any two cells (a "perfect" maze). The Loops setting then
   opens some dead ends, which adds loops and more than one way through.
   Every maze comes from a seed, so the same settings and seed always draw
   the same maze. */

const $ = (id) => document.getElementById(id);

// the shape buttons show an outline of the shape (drawn with currentColor)
const shapeIcon = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${d}"/></svg>`;
const SHAPES = [
  { id: "square", label: "Square", icon: shapeIcon("M4 4h16v16H4z") },
  { id: "circle", label: "Circle", icon: shapeIcon("M3.5 12a8.5 8.5 0 1 0 17 0a8.5 8.5 0 1 0-17 0z") },
  { id: "triangle", label: "Triangle", icon: shapeIcon("M12 3.5 21.2 19.5H2.8z") },
  { id: "hexagon", label: "Hexagon", icon: shapeIcon("M21 12 16.5 19.8H7.5L3 12 7.5 4.2H16.5z") },
  { id: "star", label: "Star", icon: shapeIcon("M12 2.4 14.9 7.4H20.7L17.8 12.4 20.7 17.4H14.9L12 22.4 9.1 17.4H3.3L6.2 12.4 3.3 7.4H9.1z") },
  { id: "heart", label: "Heart", icon: shapeIcon("M12 20.5C6.5 16.6 3 13.4 3 9.3 3 6.6 5 4.5 7.6 4.5c1.8 0 3.4 1 4.4 2.6 1-1.6 2.6-2.6 4.4-2.6 2.6 0 4.6 2.1 4.6 4.8 0 4.1-3.5 7.3-9 11.2z") },
];

const ALGOS = [
  { id: "backtracker", label: "Backtracker",
    note: "Depth-first: it carves as far as it can, and backs up only when it is stuck. Long winding corridors, few dead ends, and a long solution." },
  { id: "prim", label: "Prim",
    note: "Grows out from one cell, adding a random cell from its edge at each step. Lots of short dead ends and a bushy look; the solution is fairly direct." },
  { id: "kruskal", label: "Kruskal",
    note: "Knocks down random walls anywhere, as long as they join two separate regions, until everything is one. An even texture with many short dead ends." },
  { id: "wilson", label: "Wilson",
    note: "Random walks that erase their own loops. Every possible maze of this size is equally likely: the unbiased one." },
  { id: "huntkill", label: "Hunt & Kill",
    note: "Like the Backtracker, it carves a random walk until it is stuck, but then it hunts for an unvisited cell next to the maze and starts again from there. Long corridors with a slightly more even texture." },
  { id: "growing", label: "Growing Tree",
    note: "Keeps a list of cells to grow from, and picks the newest one half of the time and a random one otherwise: a mix of the Backtracker and Prim, between long corridors and short dead ends." },
  { id: "aldous", label: "Aldous-Broder",
    note: "A pure random walk that knocks down a wall each time it steps into a new cell. Like Wilson, every possible maze is equally likely; it is the simplest algorithm, and the slowest." },
];

const LOOKS = [
  { id: "paper", label: "Paper", bg: "#f4efe3", floor: "#fffdf7", wall: "#26231f", walk: "#e0533d", heat: "#2f7bd9" },
  { id: "blueprint", label: "Blueprint", bg: "#10335e", floor: "#174579", wall: "#e8f1ff", walk: "#ffcf4a", heat: "#6ad1ff" },
  { id: "hedge", label: "Hedge", bg: "#1f3a1c", floor: "#e0d3ae", wall: "#3f7a34", walk: "#b3261e", heat: "#e0892d" },
  { id: "stone", label: "Stone", bg: "#1c2230", floor: "#2c3446", wall: "#c9c2b1", walk: "#ffb13b", heat: "#ffb13b" },
  { id: "night", label: "Night", bg: "#0e1020", floor: "#141833", wall: "#6f8dff", walk: "#ffd76a", heat: "#ff5fa2" },
];

const newSeed = () => Math.floor(Math.random() * 1e6);

const DEFAULTS = {
  shape: "square",
  algo: "backtracker",
  size: 20, // cells across
  loops: 0, // percent of dead ends opened into loops
  length: "any", // solution length: any, short, medium or long
  seed: newSeed(),
  look: "paper",
  wall: 14, // wall thickness, in percent of the cell size
  heat: false, // color the cells by their distance from the entrance
  speed: 5,
};
let S = { ...DEFAULTS };
try {
  Object.assign(S, JSON.parse(localStorage.getItem("maze-settings") || "{}"));
} catch (e) {}
const save = () => {
  try {
    localStorage.setItem("maze-settings", JSON.stringify(S));
  } catch (e) {}
};

const W = 20; // cell size
const f2 = (v) => String(Math.round(v * 100) / 100);
const P = (p) => `${f2(p[0])} ${f2(p[1])}`;

// seeded random numbers (mulberry32)
const rngOf = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const pick = (arr, rnd) => arr[Math.floor(rnd() * arr.length)];
const shuffle = (arr, rnd) => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

// ---------------------------------------------------------------- grids
// A grid knows its cells and neighbors, where they are, how to draw a cell
// and the floor, and which walls stand given the passages (lk(a, b) tells
// whether two cells are linked).

// A square grid, cut to a shape by a mask (the square itself, or a heart).
// The entrance is on the top edge of the start cell, the exit on the bottom
// edge of the goal cell.
const maskGrid = (kind, n, inside, label) => {
  const cols = n, rows = n;
  const at = new Int32Array(cols * rows).fill(-1); // grid position -> cell id
  const rc = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (inside(r, c)) { at[r * cols + c] = rc.length; rc.push([r, c]); }
  const idAt = (r, c) => (r >= 0 && r < rows && c >= 0 && c < cols ? at[r * cols + c] : -1);
  const N = rc.length;
  const nb = rc.map(([r, c]) => [idAt(r - 1, c), idAt(r, c + 1), idAt(r + 1, c), idAt(r, c - 1)].filter((x) => x >= 0));
  // entrance: the middle of the topmost run of cells on the left half; exit: the middle of the bottom run
  const runMid = (r, from, to) => {
    const cs = [];
    for (let c = from; c < to; c++) if (idAt(r, c) >= 0) cs.push(c);
    return cs.length ? idAt(r, cs[Math.floor((cs.length - 1) / 2)]) : -1;
  };
  let start = -1, goal = -1;
  if (kind === "square") { start = 0; goal = N - 1; }
  else {
    for (let r = 0; r < rows && start < 0; r++) start = runMid(r, 0, Math.ceil(cols / 2));
    for (let r = rows - 1; r >= 0 && goal < 0; r--) goal = runMid(r, 0, cols);
  }
  const center = (i) => [(rc[i][1] + 0.5) * W, (rc[i][0] + 0.5) * W];
  const go = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
  const rect = (i) => `M${rc[i][1] * W} ${rc[i][0] * W}h${W}v${W}h${-W}Z`;
  return {
    kind, N, nb, start, goal, label,
    view: [-W, -W, cols * W + 2 * W, rows * W + 2 * W],
    center,
    enter: [center(start)[0], rc[start][0] * W - W * 0.9],
    exit: [center(goal)[0], (rc[goal][0] + 1) * W + W * 0.9],
    cellAt: (x, y) => idAt(Math.floor(y / W), Math.floor(x / W)),
    step: (i, key) => {
      const d = go[key];
      const x = d ? idAt(rc[i][0] + d[0], rc[i][1] + d[1]) : -1;
      return x >= 0 ? [x] : [];
    },
    cellShape: rect,
    floorD: () => (kind === "square" ? `M0 0h${cols * W}v${rows * W}h${-cols * W}Z` : rc.map((_, i) => rect(i)).join("")),
    seg: (a, b) => ` L${P(center(b))}`,
    // walls along the grid lines, merged into runs: a wall stands between
    // a cell and the outside, or between two cells that are not linked
    walls: (lk) => {
      const wall = (a, b) => (a < 0 || b < 0 ? a !== b : !lk(a, b));
      const open = (a, b) => (a === start && b < 0) || (a < 0 && b === goal); // entrance above start, exit below goal
      let d = "";
      for (let r = 0; r <= rows; r++) {
        let run = -1;
        for (let c = 0; c <= cols; c++) {
          const a = idAt(r - 1, c), b = idAt(r, c);
          const on = c < cols && wall(a, b) && !open(b, a);
          if (on && run < 0) run = c;
          if (!on && run >= 0) { d += `M${run * W} ${r * W}H${c * W}`; run = -1; }
        }
      }
      for (let c = 0; c <= cols; c++) {
        let run = -1;
        for (let r = 0; r <= rows; r++) {
          const on = r < rows && wall(idAt(r, c - 1), idAt(r, c));
          if (on && run < 0) run = r;
          if (!on && run >= 0) { d += `M${c * W} ${run * W}V${r * W}`; run = -1; }
        }
      }
      return d;
    },
  };
};

const squareGrid = (n) => maskGrid("square", n, () => true, `${n} × ${n}`);

// The classic heart curve, (x² + y² - 1)³ = x²y³, sampled at the cell
// centers; stray cells not joined to the rest are dropped.
const heartGrid = (n) => {
  const inHeart = (r, c) => {
    const x = (((c + 0.5) / n) * 2 - 1) * 1.2;
    const y = 1.25 - ((r + 0.5) / n) * 2.35;
    const q = x * x + y * y - 1;
    return q * q * q - x * x * y * y * y <= 0;
  };
  // keep the largest 4-connected region
  const comp = new Int32Array(n * n).fill(-1);
  let best = -1, bestSize = 0;
  for (let s = 0; s < n * n; s++) {
    if (comp[s] >= 0 || !inHeart(Math.floor(s / n), s % n)) continue;
    const q = [s];
    comp[s] = s;
    for (let h = 0; h < q.length; h++) {
      const r = Math.floor(q[h] / n), c = q[h] % n;
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const rr = r + dr, cc = c + dc, t = rr * n + cc;
        if (rr >= 0 && rr < n && cc >= 0 && cc < n && comp[t] < 0 && inHeart(rr, cc)) { comp[t] = s; q.push(t); }
      }
    }
    if (q.length > bestSize) { bestSize = q.length; best = s; }
  }
  return maskGrid("heart", n, (r, c) => comp[r * n + c] === best, `${n} across`);
};

// A big triangle cut into small ones: row r (from the top) has 2r + 1
// triangles, pointing up at even positions and down at odd ones. The
// entrance is under the bottom left corner, the exit under the bottom right.
const triangleGrid = (n) => {
  const s = W * 1.6, h = (s * Math.sqrt(3)) / 2;
  const off = (r) => r * r; // id of the first cell of row r
  const N = n * n;
  const row = new Int32Array(N), pos = new Int32Array(N);
  for (let r = 0; r < n; r++) for (let k = 0; k <= 2 * r; k++) { row[off(r) + k] = r; pos[off(r) + k] = k; }
  const id = (r, k) => (r >= 0 && r < n && k >= 0 && k <= 2 * r ? off(r) + k : -1);
  const up = (i) => pos[i] % 2 === 0;
  // across the horizontal edge: below an upward triangle, above a downward one
  const vert = (i) => (up(i) ? id(row[i] + 1, pos[i] + 1) : id(row[i] - 1, pos[i] - 1));
  const verts = (i) => {
    const r = row[i], m = Math.floor(pos[i] / 2), x0 = -r * s / 2 + m * s, x1 = -(r + 1) * s / 2 + m * s;
    return up(i)
      ? [[x0, r * h], [x1 + s, (r + 1) * h], [x1, (r + 1) * h]]
      : [[x0, r * h], [x0 + s, r * h], [x1 + s, (r + 1) * h]];
  };
  const center = (i) => {
    const v = verts(i);
    return [(v[0][0] + v[1][0] + v[2][0]) / 3, (v[0][1] + v[1][1] + v[2][1]) / 3];
  };
  const nb = [];
  for (let i = 0; i < N; i++) nb.push([id(row[i], pos[i] - 1), id(row[i], pos[i] + 1), vert(i)].filter((x) => x >= 0));
  const start = id(n - 1, 0), goal = id(n - 1, 2 * n - 2);
  const side = n * s + 2 * W; // a square view, with the triangle in the middle
  const inTri = (p, v) => {
    const cross = (a, b) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    const d = [cross(v[0], v[1]), cross(v[1], v[2]), cross(v[2], v[0])];
    return !(d.some((x) => x < 0) && d.some((x) => x > 0));
  };
  const seg = (a, b) => `M${P(a)}L${P(b)}`;
  return {
    kind: "triangle", N, nb, start, goal, seams: true,
    label: `${n} rows`,
    view: [-side / 2, (n * h) / 2 - side / 2, side, side],
    center,
    enter: [center(start)[0], n * h + W * 0.9],
    exit: [center(goal)[0], n * h + W * 0.9],
    cellAt: (x, y) => {
      const r = Math.floor(y / h);
      if (r < 0 || r >= n) return -1;
      const m = Math.floor((x + ((r + 1) * s) / 2) / s);
      for (let k = 2 * m - 2; k <= 2 * m + 2; k++) {
        const i = id(r, k);
        if (i >= 0 && inTri([x, y], verts(i))) return i;
      }
      return -1;
    },
    // left and right step along the row, up and down cross the flat edge
    step: (i, key) => {
      if (key === "ArrowLeft") return [id(row[i], pos[i] - 1)].filter((x) => x >= 0);
      if (key === "ArrowRight") return [id(row[i], pos[i] + 1)].filter((x) => x >= 0);
      if ((key === "ArrowDown" && up(i)) || (key === "ArrowUp" && !up(i))) return [vert(i)].filter((x) => x >= 0);
      return [];
    },
    cellShape: (i) => { const v = verts(i); return `M${P(v[0])}L${P(v[1])}L${P(v[2])}Z`; },
    floorD: () => `M0 0L${P([(n * s) / 2, n * h])}L${P([(-n * s) / 2, n * h])}Z`,
    seg: (a, b) => ` L${P(center(b))}`,
    // each cell draws its left edge, and an upward cell its bottom edge;
    // the last cell of a row draws the right side of the big triangle
    walls: (lk) => {
      let d = "";
      for (let i = 0; i < N; i++) {
        const v = verts(i), r = row[i], k = pos[i];
        const left = id(r, k - 1);
        if (left < 0 || !lk(i, left)) d += seg(v[0], v[2]);
        if (k === 2 * r) d += seg(v[0], v[1]);
        if (up(i)) {
          const below = vert(i);
          const open = r === n - 1 && (i === start || i === goal);
          if (!open && (below < 0 || !lk(i, below))) d += seg(v[2], v[1]);
        }
      }
      return d;
    },
  };
};

// A six-pointed star on the triangle lattice. Each of the two big triangles
// has sides of 3m small cells, so every edge of the star falls on cell walls
// and the outline stays straight. Row r, column k: a triangle points up or
// down in turn along the row. The entrance is on the flat top of the upper
// left point, the exit under the flat bottom of the lower right point.
const starGrid = (m) => {
  const s = W * 1.6, h = (s * Math.sqrt(3)) / 2;
  const R = 4 * m, C = 6 * m;
  const X = (3 * m * s) / 2; // the star's axis
  const p = (3 * m + 1) % 2; // puts the lattice corners on the star's corners
  const isUp = (r, k) => (r + k + p) % 2 === 0;
  const vertsRK = (r, k) => {
    const x0 = (k * s) / 2;
    return isUp(r, k)
      ? [[x0 + s / 2, r * h], [x0 + s, (r + 1) * h], [x0, (r + 1) * h]]
      : [[x0, r * h], [x0 + s, r * h], [x0 + s / 2, (r + 1) * h]];
  };
  const inTri = (pt, v) => {
    const cross = (a, b) => (b[0] - a[0]) * (pt[1] - a[1]) - (b[1] - a[1]) * (pt[0] - a[0]);
    const d = [cross(v[0], v[1]), cross(v[1], v[2]), cross(v[2], v[0])];
    return !(d.some((x) => x < 0) && d.some((x) => x > 0));
  };
  const bigUp = [[X, 0], [X + 1.5 * m * s, 3 * m * h], [X - 1.5 * m * s, 3 * m * h]];
  const bigDown = [[X - 1.5 * m * s, m * h], [X + 1.5 * m * s, m * h], [X, 4 * m * h]];
  const at = new Int32Array(R * C).fill(-1);
  const rc = [];
  for (let r = 0; r < R; r++) {
    for (let k = 0; k < C; k++) {
      const v = vertsRK(r, k);
      const c = [(v[0][0] + v[1][0] + v[2][0]) / 3, (v[0][1] + v[1][1] + v[2][1]) / 3];
      if (inTri(c, bigUp) || inTri(c, bigDown)) { at[r * C + k] = rc.length; rc.push([r, k]); }
    }
  }
  const idAt = (r, k) => (r >= 0 && r < R && k >= 0 && k < C ? at[r * C + k] : -1);
  const N = rc.length;
  const up = (i) => isUp(rc[i][0], rc[i][1]);
  const verts = (i) => vertsRK(rc[i][0], rc[i][1]);
  const vertRK = (i) => (up(i) ? [rc[i][0] + 1, rc[i][1]] : [rc[i][0] - 1, rc[i][1]]);
  const vert = (i) => idAt(...vertRK(i));
  const nb = rc.map(([r, k], i) => [idAt(r, k - 1), idAt(r, k + 1), vert(i)].filter((x) => x >= 0));
  const center = (i) => {
    const v = verts(i);
    return [(v[0][0] + v[1][0] + v[2][0]) / 3, (v[0][1] + v[1][1] + v[2][1]) / 3];
  };
  // entrance: the leftmost cell of row m (the tip of the upper left point, a
  // downward cell with a flat top); exit: the rightmost cell of row 3m - 1
  let start = -1, goal = -1;
  for (let k = 0; k < C && start < 0; k++) start = idAt(m, k);
  for (let k = C - 1; k >= 0 && goal < 0; k--) goal = idAt(3 * m - 1, k);
  const midX = (i, a, b) => (verts(i)[a][0] + verts(i)[b][0]) / 2;
  const side = Math.max(3 * m * s, 4 * m * h) + 2 * W;
  const seg = (a, b) => `M${P(a)}L${P(b)}`;
  return {
    kind: "star", N, nb, start, goal, seams: true,
    label: `${N} cells`,
    view: [X - side / 2, 2 * m * h - side / 2, side, side],
    center,
    enter: [midX(start, 0, 1), m * h - W * 0.9],
    exit: [midX(goal, 2, 1), 3 * m * h + W * 0.9],
    cellAt: (x, y) => {
      const r = Math.floor(y / h), k0 = Math.floor(x / (s / 2));
      for (let k = k0 - 2; k <= k0 + 1; k++) {
        const i = idAt(r, k);
        if (i >= 0 && inTri([x, y], verts(i))) return i;
      }
      return -1;
    },
    step: (i, key) => {
      const [r, k] = rc[i];
      if (key === "ArrowLeft") return [idAt(r, k - 1)].filter((x) => x >= 0);
      if (key === "ArrowRight") return [idAt(r, k + 1)].filter((x) => x >= 0);
      if ((key === "ArrowDown" && up(i)) || (key === "ArrowUp" && !up(i))) return [vert(i)].filter((x) => x >= 0);
      return [];
    },
    cellShape: (i) => { const v = verts(i); return `M${P(v[0])}L${P(v[1])}L${P(v[2])}Z`; },
    floorD: () => [bigUp, bigDown].map((t) => `M${P(t[0])}L${P(t[1])}L${P(t[2])}Z`).join(""),
    seg: (a, b) => ` L${P(center(b))}`,
    // each cell draws its left edge, its right edge on the outline, and its
    // flat edge when it is an upward cell or sits on the outline
    walls: (lk) => {
      let d = "";
      for (let i = 0; i < N; i++) {
        const v = verts(i), [r, k] = rc[i];
        const left = idAt(r, k - 1), right = idAt(r, k + 1), other = vert(i);
        if (left < 0 || !lk(i, left)) d += seg(v[0], v[2]);
        if (right < 0) d += up(i) ? seg(v[0], v[1]) : seg(v[1], v[2]);
        if (up(i)) {
          if (!(i === goal && other < 0) && (other < 0 || !lk(i, other))) d += seg(v[2], v[1]);
        } else if (other < 0 && i !== start) d += seg(v[0], v[1]);
      }
      return d;
    },
  };
};

// A big hexagon of hexagonal cells (a honeycomb), in axial coordinates
// (q, r); every cell has up to six neighbors. The entrance is on the left
// corner, the exit on the right one.
const hexGrid = (n) => {
  const a = W * 0.62; // cell radius, center to corner
  const D = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]]; // at 0, 60, ... 300 degrees
  const key = (q, r) => `${q},${r}`;
  const qr = [], at = new Map();
  for (let r = -(n - 1); r <= n - 1; r++) {
    for (let q = -(n - 1); q <= n - 1; q++) {
      if (Math.abs(q + r) > n - 1) continue;
      at.set(key(q, r), qr.length);
      qr.push([q, r]);
    }
  }
  const N = qr.length;
  const idAt = (q, r) => (at.has(key(q, r)) ? at.get(key(q, r)) : -1);
  const nbDir = (i, d) => idAt(qr[i][0] + D[d][0], qr[i][1] + D[d][1]);
  const nb = qr.map((_, i) => D.map((_, d) => nbDir(i, d)).filter((x) => x >= 0));
  const center = (i) => [a * Math.sqrt(3) * (qr[i][0] + qr[i][1] / 2), a * 1.5 * qr[i][1]];
  const corner = (i, deg) => {
    const [x, y] = center(i), t = (deg * Math.PI) / 180;
    return [x + a * Math.cos(t), y + a * Math.sin(t)];
  };
  const start = idAt(-(n - 1), 0), goal = idAt(n - 1, 0);
  const w = (2 * n - 1) * Math.sqrt(3) * a, side = w + 2 * W;
  const edge = (i, d) => `M${P(corner(i, 60 * d - 30))}L${P(corner(i, 60 * d + 30))}`;
  return {
    kind: "hexagon", N, nb, start, goal, seams: true,
    label: `${n} rings`,
    view: [-side / 2, -side / 2, side, side],
    center,
    enter: [center(start)[0] - a * 1.8, 0],
    exit: [center(goal)[0] + a * 1.8, 0],
    cellAt: (x, y) => {
      const fq = ((Math.sqrt(3) / 3) * x - y / 3) / a, fr = ((2 / 3) * y) / a, fs = -fq - fr;
      let q = Math.round(fq), r = Math.round(fr);
      const s = Math.round(fs);
      const dq = Math.abs(q - fq), dr = Math.abs(r - fr), ds = Math.abs(s - fs);
      if (dq > dr && dq > ds) q = -r - s;
      else if (dr > ds) r = -q - s;
      return idAt(q, r);
    },
    // left and right go straight across; up and down try both slanted neighbors
    step: (i, k) => {
      const dirs = { ArrowRight: [0], ArrowLeft: [3], ArrowUp: [5, 4], ArrowDown: [1, 2] }[k] || [];
      return dirs.map((d) => nbDir(i, d)).filter((x) => x >= 0);
    },
    cellShape: (i) => [0, 1, 2, 3, 4, 5].map((c, j) => `${j ? "L" : "M"}${P(corner(i, 60 * c - 30))}`).join("") + "Z",
    floorD() { return qr.map((_, i) => this.cellShape(i)).join(""); },
    seg: (a2, b) => ` L${P(center(b))}`,
    // each cell draws its walls toward the three neighbors at 0, 60 and
    // 120 degrees, and any wall on the outline
    walls: (lk) => {
      let d = "";
      for (let i = 0; i < N; i++) {
        for (let dd = 0; dd < 6; dd++) {
          const o = nbDir(i, dd);
          if (o < 0) {
            if ((i === start && dd === 3) || (i === goal && dd === 0)) continue;
            d += edge(i, dd);
          } else if (dd < 3 && !lk(i, o)) d += edge(i, dd);
        }
      }
      return d;
    },
  };
};

// Rings of cells around a center cell; a ring splits its cells in two when
// they would get much wider than they are deep. Angles are measured from
// the bottom (where the entrance is), toward +x.
const pt = (rad, th) => [rad * Math.sin(th), rad * Math.cos(th)];
const arcD = (rad, a0, a1) => {
  const parts = Math.max(1, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 2)));
  let d = `M${P(pt(rad, a0))}`;
  for (let k = 1; k <= parts; k++) {
    d += `A${f2(rad)} ${f2(rad)} 0 0 ${a1 > a0 ? 0 : 1} ${P(pt(rad, a0 + ((a1 - a0) * k) / parts))}`;
  }
  return d;
};

const circleGrid = (R) => {
  const counts = [1];
  for (let i = 1; i < R; i++) {
    const ratio = Math.max(1, Math.round((2 * Math.PI * i) / counts[i - 1]));
    counts.push(counts[i - 1] * ratio);
  }
  const off = [0];
  for (let i = 1; i < R; i++) off.push(off[i - 1] + counts[i - 1]);
  const N = off[R - 1] + counts[R - 1];
  const ring = new Int32Array(N), idx = new Int32Array(N);
  for (let i = 0; i < R; i++) for (let j = 0; j < counts[i]; j++) { ring[off[i] + j] = i; idx[off[i] + j] = j; }
  const span = (i) => (2 * Math.PI) / counts[i];
  const base = -span(R - 1) / 2; // centers the entrance cell on the bottom
  const a0 = (c) => base + idx[c] * span(ring[c]);
  const mid = (c) => a0(c) + span(ring[c]) / 2;
  const parent = (c) => (ring[c] <= 1 ? 0 : off[ring[c] - 1] + Math.floor(idx[c] / (counts[ring[c]] / counts[ring[c] - 1])));
  const around = (c, k) => off[ring[c]] + ((idx[c] + k + counts[ring[c]]) % counts[ring[c]]);
  const children = (c) => {
    const i = ring[c];
    if (i >= R - 1) return [];
    const ratio = counts[i + 1] / counts[i];
    return Array.from({ length: ratio }, (_, k) => off[i + 1] + idx[c] * ratio + k);
  };
  const nb = [];
  for (let c = 0; c < N; c++) {
    nb.push(c === 0 ? children(0) : [around(c, 1), around(c, -1), parent(c), ...children(c)]);
  }
  const center = (c) => (c === 0 ? [0, 0] : pt((ring[c] + 0.5) * W, mid(c)));
  const start = off[R - 1];
  return {
    kind: "circle", N, nb, start, goal: 0, seams: true,
    label: `${R} rings`,
    view: [-(R + 1) * W, -(R + 1) * W, 2 * (R + 1) * W, 2 * (R + 1) * W],
    center,
    enter: pt((R + 0.9) * W, 0),
    exit: null, // the goal is the center
    cellAt: (x, y) => {
      const i = Math.floor(Math.hypot(x, y) / W);
      if (i >= R) return -1;
      if (i === 0) return 0;
      let th = Math.atan2(x, y) - base;
      th = ((th % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      return off[i] + Math.min(counts[i] - 1, Math.floor(th / span(i)));
    },
    // left/right go around the ring, up goes in toward the center, down goes out
    step: (c, key) => {
      if (key === "ArrowLeft") return c ? [around(c, -1)] : [];
      if (key === "ArrowRight") return c ? [around(c, 1)] : [];
      if (key === "ArrowUp") return c ? [parent(c)] : [];
      if (key === "ArrowDown") return children(c);
      return [];
    },
    cellShape: (c) => {
      if (c === 0) return `M${-W} 0a${W} ${W} 0 1 0 ${2 * W} 0a${W} ${W} 0 1 0 ${-2 * W} 0Z`;
      const i = ring[c], s = a0(c), e = s + span(i), r0 = i * W, r1 = (i + 1) * W;
      return `M${P(pt(r1, s))}A${r1} ${r1} 0 0 0 ${P(pt(r1, e))}L${P(pt(r0, e))}A${r0} ${r0} 0 0 1 ${P(pt(r0, s))}Z`;
    },
    floorD: () => { const r = R * W; return `M${-r} 0a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`; },
    // along a ring the path follows the arc, in and out it goes straight
    seg: (a, b) => {
      if (a && b && ring[a] === ring[b]) {
        let dth = mid(b) - mid(a);
        dth = Math.atan2(Math.sin(dth), Math.cos(dth));
        const rad = (ring[a] + 0.5) * W;
        return ` A${f2(rad)} ${f2(rad)} 0 0 ${dth > 0 ? 0 : 1} ${P(center(b))}`;
      }
      return ` L${P(center(b))}`;
    },
    // the outer wall, open on the entrance cell, then for each cell its
    // inner arc and its wall on the counterclockwise side
    walls: (lk) => {
      const so = span(R - 1);
      let d = arcD(R * W, a0(start) + so, a0(start) + 2 * Math.PI);
      for (let c = 1; c < N; c++) {
        const i = ring[c], s = a0(c);
        if (!lk(c, parent(c))) d += arcD(i * W, s, s + span(i));
        if (!lk(c, around(c, -1))) d += `M${P(pt(i * W, s))}L${P(pt((i + 1) * W, s))}`;
      }
      return d;
    },
  };
};

const gridOf = () => {
  if (S.shape === "circle") return circleGrid(Math.max(3, Math.round(S.size / 2)));
  if (S.shape === "triangle") return triangleGrid(Math.max(4, Math.round(S.size * 0.8)));
  if (S.shape === "hexagon") return hexGrid(Math.max(3, Math.round(S.size / 2)));
  if (S.shape === "star") return starGrid(Math.max(2, Math.round(S.size * 0.3)));
  if (S.shape === "heart") return heartGrid(Math.max(12, S.size + 4)); // the heart leaves the corners empty
  return squareGrid(S.size);
};

// ---------------------------------------------------------------- algorithms

const GEN = {
  backtracker: (G, link, rnd) => {
    const seen = new Uint8Array(G.N);
    const stack = [Math.floor(rnd() * G.N)];
    seen[stack[0]] = 1;
    while (stack.length) {
      const c = stack[stack.length - 1];
      const opts = G.nb[c].filter((x) => !seen[x]);
      if (!opts.length) { stack.pop(); continue; }
      const x = pick(opts, rnd);
      link(c, x);
      seen[x] = 1;
      stack.push(x);
    }
  },
  prim: (G, link, rnd) => {
    const inMaze = new Uint8Array(G.N), inFront = new Uint8Array(G.N), front = [];
    const add = (c) => {
      inMaze[c] = 1;
      for (const x of G.nb[c]) if (!inMaze[x] && !inFront[x]) { inFront[x] = 1; front.push(x); }
    };
    add(Math.floor(rnd() * G.N));
    while (front.length) {
      const k = Math.floor(rnd() * front.length);
      const c = front[k];
      front[k] = front[front.length - 1];
      front.pop();
      link(c, pick(G.nb[c].filter((x) => inMaze[x]), rnd));
      add(c);
    }
  },
  kruskal: (G, link, rnd) => {
    const edges = [];
    for (let c = 0; c < G.N; c++) for (const x of G.nb[c]) if (x > c) edges.push([c, x]);
    shuffle(edges, rnd);
    const up = new Int32Array(G.N).map((_, i) => i);
    const find = (c) => { while (up[c] !== c) { up[c] = up[up[c]]; c = up[c]; } return c; };
    for (const [a, b] of edges) {
      const ra = find(a), rb = find(b);
      if (ra !== rb) { up[ra] = rb; link(a, b); }
    }
  },
  wilson: (G, link, rnd) => {
    const inTree = new Uint8Array(G.N), next = new Int32Array(G.N);
    inTree[Math.floor(rnd() * G.N)] = 1;
    const order = shuffle(Array.from({ length: G.N }, (_, i) => i), rnd);
    for (const s of order) {
      let c = s;
      while (!inTree[c]) { next[c] = pick(G.nb[c], rnd); c = next[c]; } // walk; revisits overwrite: loops erase themselves
      for (c = s; !inTree[c]; c = next[c]) { inTree[c] = 1; link(c, next[c]); }
    }
  },
  huntkill: (G, link, rnd) => {
    const seen = new Uint8Array(G.N);
    let c = Math.floor(rnd() * G.N), left = G.N - 1, lo = 0;
    seen[c] = 1;
    while (left > 0) {
      const opts = G.nb[c].filter((x) => !seen[x]);
      if (opts.length) { // kill: walk on to a random unvisited neighbor
        const x = pick(opts, rnd);
        link(c, x);
        seen[x] = 1;
        left--;
        c = x;
        continue;
      }
      // hunt: the first unvisited cell next to the maze, joined to a random visited neighbor
      while (seen[lo]) lo++;
      for (let i = lo; i < G.N; i++) {
        if (seen[i]) continue;
        const done = G.nb[i].filter((x) => seen[x]);
        if (!done.length) continue;
        link(i, pick(done, rnd));
        seen[i] = 1;
        left--;
        c = i;
        break;
      }
    }
  },
  growing: (G, link, rnd) => {
    const seen = new Uint8Array(G.N);
    const active = [Math.floor(rnd() * G.N)];
    seen[active[0]] = 1;
    while (active.length) {
      const k = rnd() < 0.5 ? active.length - 1 : Math.floor(rnd() * active.length);
      const c = active[k];
      const opts = G.nb[c].filter((x) => !seen[x]);
      if (!opts.length) { active.splice(k, 1); continue; }
      const x = pick(opts, rnd);
      link(c, x);
      seen[x] = 1;
      active.push(x);
    }
  },
  aldous: (G, link, rnd) => {
    const seen = new Uint8Array(G.N);
    let c = Math.floor(rnd() * G.N), left = G.N - 1;
    seen[c] = 1;
    while (left > 0) {
      const x = pick(G.nb[c], rnd);
      if (!seen[x]) { link(c, x); seen[x] = 1; left--; }
      c = x;
    }
  },
};

// Open some dead ends into a neighbor, preferably another dead end.
const braid = (G, links, link, p, rnd) => {
  if (p <= 0) return;
  const ends = shuffle([...Array(G.N).keys()].filter((c) => links[c].size === 1), rnd);
  for (const c of ends) {
    if (links[c].size !== 1 || rnd() >= p) continue;
    const closed = G.nb[c].filter((x) => !links[c].has(x));
    const best = closed.filter((x) => links[x].size === 1);
    if (closed.length) link(c, pick(best.length ? best : closed, rnd));
  }
};

const bfs = (G, links, from) => {
  const dist = new Int32Array(G.N).fill(-1), prev = new Int32Array(G.N).fill(-1);
  const q = [from];
  dist[from] = 0;
  for (let h = 0; h < q.length; h++) {
    const c = q[h];
    for (const x of links[c]) if (dist[x] < 0) { dist[x] = dist[c] + 1; prev[x] = c; q.push(x); }
  }
  return { dist, prev };
};

const generate = (seed = S.seed) => {
  const G = gridOf();
  const rnd = rngOf(seed);
  const links = G.nb.map(() => new Set());
  const link = (a, b) => { links[a].add(b); links[b].add(a); };
  (GEN[S.algo] || GEN.backtracker)(G, link, rnd);
  braid(G, links, link, S.loops / 100, rnd);
  const { dist, prev } = bfs(G, links, G.start);
  const sol = [];
  for (let c = G.goal; c >= 0; c = prev[c]) sol.unshift(c);
  const deadEnds = links.filter((l) => l.size === 1).length;
  return { G, links, dist, sol, deadEnds, maxDist: Math.max(...dist), seed };
};

// ---------------------------------------------------------------- drawing

const lookOf = () => LOOKS.find((l) => l.id === S.look) || LOOKS[0];

// the path through a list of cells, center to center
const cellsD = (G, cells, ends) => {
  if (!cells.length) return "";
  let d = ends ? `M${P(G.enter)} L${P(G.center(cells[0]))}` : `M${P(G.center(cells[0]))}`;
  for (let k = 1; k < cells.length; k++) d += G.seg(cells[k - 1], cells[k]);
  if (ends && G.exit && cells[cells.length - 1] === G.goal) d += ` L${P(G.exit)}`;
  if (!ends && cells.length === 1) d += ` L${P(G.center(cells[0]))}`;
  return d;
};

const mazeSVG = (M, forExport) => {
  const c = lookOf();
  const { G } = M;
  const [vx, vy, vw, vh] = G.view;
  const ww = Math.max(0.8, (S.wall / 100) * W);
  const lane = W - ww;
  let o = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vx} ${vy} ${vw} ${vh}"${forExport ? "" : ' class="plain"'} role="img" aria-label="${(SHAPES.find((x) => x.id === G.kind) || SHAPES[0]).label}-shaped maze, ${G.label}">`;
  o += `<rect class="bg" x="${vx}" y="${vy}" width="${vw}" height="${vh}" fill="${c.bg}"/>`;
  o += `<path class="floor" d="${G.floorD()}" fill="${c.floor}"/>`;
  if (S.heat) {
    // opaque colors, mixed from the floor to the heat color, so the thin
    // stroke that hides the seams between cells doesn't show as a grid
    const rgb = (h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16));
    const [f, t] = [rgb(c.floor), rgb(c.heat)];
    const mix = (u) => "#" + f.map((v, k) => Math.round(v + (t[k] - v) * u).toString(16).padStart(2, "0")).join("");
    o += `<g class="heat" stroke-width="0.5">`;
    for (let i = 0; i < G.N; i++) {
      const col = mix(0.06 + (0.7 * M.dist[i]) / Math.max(1, M.maxDist));
      o += `<path d="${G.cellShape(i)}" fill="${col}" stroke="${col}"/>`;
    }
    o += "</g>";
  }
  const solD = cellsD(G, M.sol, true);
  if (!forExport) {
    o += `<path id="solution" d="${solD}" fill="none" stroke="${c.walk}" stroke-width="${f2(lane * 0.3)}" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="0.85" style="display:none"/>`;
  } else if (solShown) {
    o += `<path d="${solD}" fill="none" stroke="${c.walk}" stroke-width="${f2(lane * 0.3)}" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="0.85"/>`;
  }
  o += `<path class="walls" d="${G.walls((a, b) => M.links[a].has(b))}" fill="none" stroke="${c.wall}" stroke-width="${f2(ww)}" stroke-linecap="${G.seams ? "round" : "square"}" stroke-linejoin="round"/>`;
  if (!forExport) {
    o += `<path id="trail" d="" fill="none" stroke="${c.heat}" stroke-width="${f2(lane * 0.22)}" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="0.75"/>`;
    o += `<circle id="player" r="${f2(lane * 0.3)}" fill="${c.walk}" stroke="${c.floor}" stroke-width="${f2(lane * 0.06)}"/>`;
  }
  return o + "</svg>";
};

// ---------------------------------------------------------------- state and UI

let M = null;
let solShown = false; // the solution is fully drawn
let pos = 0, trail = [], moves = 0, won = false;

const setPressed = (id, items, cur) => {
  document.querySelectorAll(`#${id} button`).forEach((b, i) => {
    const on = items[i].id === cur;
    b.className = on ? "selected" : "";
    b.setAttribute("aria-pressed", on);
  });
};

const syncHash = () => {
  const q = new URLSearchParams({ shape: S.shape, algo: S.algo, size: S.size, loops: S.loops, seed: S.seed, length: S.length });
  try { history.replaceState(null, "", "#" + q); } catch (e) {}
};
const readHash = () => {
  const q = new URLSearchParams(location.hash.slice(1));
  if (SHAPES.some((s) => s.id === q.get("shape"))) S.shape = q.get("shape");
  if (GEN[q.get("algo")]) S.algo = q.get("algo");
  if (LENGTHS.some((l) => l.id === q.get("length"))) S.length = q.get("length");
  for (const [k, lo, hi] of [["size", 6, 60], ["loops", 0, 100], ["seed", 0, 1e9]]) {
    const v = parseInt(q.get(k), 10);
    if (Number.isFinite(v)) S[k] = Math.min(hi, Math.max(lo, v));
  }
};

const note = (t) => { $("play-note").textContent = t; };

// Solution length: generate a dozen mazes from the seeds that follow and
// keep the one with the shortest, the middle or the longest solution. It
// always takes the same few tries, and the same seed and length always give
// the same maze (the link keeps both).
const LENGTHS = [
  { id: "any", label: "Any" },
  { id: "short", label: "Short", rank: 0 },
  { id: "medium", label: "Medium", rank: 0.5 },
  { id: "long", label: "Long", rank: 1 },
];
const TRIES = 12;
const findMaze = () => {
  const len = LENGTHS.find((l) => l.id === S.length);
  if (!len || len.rank === undefined) return generate(S.seed);
  const ms = [];
  for (let k = 0; k < TRIES; k++) ms.push(generate((S.seed + k) % 1e9));
  ms.sort((x, y) => x.sol.length - y.sol.length);
  return ms[Math.round(len.rank * (TRIES - 1))];
};

const regenerate = () => {
  M = findMaze();
  solShown = false;
  resetPlayer();
  draw();
  syncHash();
};

const draw = () => {
  stopSolve();
  $("maze").innerHTML = mazeSVG(M, false);
  if (solShown) {
    const s = $("solution");
    s.style.display = "";
  }
  $("solve").textContent = solShown ? "Hide solution" : "Show solution";
  drawPlayer();
  setPressed("shape-chips", SHAPES, S.shape);
  setPressed("algo-chips", ALGOS, S.algo);
  setPressed("look-chips", LOOKS, S.look);
  $("algo-note").textContent = (ALGOS.find((a) => a.id === S.algo) || ALGOS[0]).note;
  $("size-val").textContent = M.G.label;
  $("loops-val").textContent = S.loops + "%";
  $("wall-val").textContent = S.wall + "%";
  $("speed-val").textContent = S.speed;
  $("seed").value = S.seed;
  const pct = Math.round((100 * M.sol.length) / M.G.N);
  $("stats").innerHTML = [
    ["Cells", M.G.N.toLocaleString()],
    ["Dead ends", M.deadEnds.toLocaleString()],
    ["Solution", `${M.sol.length} cells`],
    ["Covers", `${pct}% of the maze`],
  ]
    .map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`)
    .join("");
};

// ---------------------------------------------------------------- playing

const resetPlayer = () => {
  pos = M.G.start;
  trail = [pos];
  moves = 0;
  won = false;
  note("");
};

const drawPlayer = () => {
  const dot = $("player"), tr = $("trail");
  if (!dot) return;
  const [x, y] = M.G.center(pos);
  dot.setAttribute("cx", f2(x));
  dot.setAttribute("cy", f2(y));
  tr.setAttribute("d", trail.length > 1 ? cellsD(M.G, trail, false) : "");
};

const moveTo = (c) => {
  if (won || !M.links[pos].has(c)) return false;
  if (trail.length > 1 && trail[trail.length - 2] === c) trail.pop();
  else trail.push(c);
  pos = c;
  moves++;
  if (pos === M.G.goal) {
    won = true;
    const best = M.sol.length - 1;
    note(moves === best
      ? `You made it in ${moves} moves, the shortest way. Well done!`
      : `You made it in ${moves} moves. The shortest way takes ${best}.`);
  } else note("");
  drawPlayer();
  return true;
};

// follow the passages to a nearby cell (for dragging across a few cells at once)
const pathTo = (target, maxSteps) => {
  if (target < 0 || target === pos) return null;
  const prev = new Map([[pos, -1]]);
  let layer = [pos];
  for (let s = 0; s < maxSteps && layer.length; s++) {
    const nx = [];
    for (const c of layer) {
      for (const x of M.links[c]) {
        if (prev.has(x)) continue;
        prev.set(x, c);
        if (x === target) {
          const p = [];
          for (let k = x; k !== pos; k = prev.get(k)) p.unshift(k);
          return p;
        }
        nx.push(x);
      }
    }
    layer = nx;
  }
  return null;
};

const cellFromEvent = (e) => {
  const svg = $("maze").querySelector("svg");
  const m = svg && svg.getScreenCTM();
  if (!m) return -1;
  const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
  return M.G.cellAt(p.x, p.y);
};
// a drag only takes over the page when it starts next to the player, so the
// page still scrolls when you swipe elsewhere on the maze
const nearPlayer = (e) => {
  const c = cellFromEvent(e);
  return c === pos || !!pathTo(c, 2) || M.G.nb[pos].includes(c);
};

const setupPlay = () => {
  const box = $("maze");
  let dragging = false;
  box.addEventListener("keydown", (e) => {
    const key = { w: "ArrowUp", s: "ArrowDown", a: "ArrowLeft", d: "ArrowRight" }[e.key] || e.key;
    if (!key.startsWith("Arrow")) return;
    e.preventDefault();
    for (const c of M.G.step(pos, key)) if (moveTo(c)) break;
  });
  box.addEventListener("touchstart", (e) => {
    const t = e.touches[0];
    if (t && nearPlayer(t)) e.preventDefault();
  }, { passive: false });
  box.addEventListener("pointerdown", (e) => {
    box.focus({ preventScroll: true });
    const c = cellFromEvent(e);
    const p = pathTo(c, 6);
    if (p) p.forEach(moveTo);
    dragging = nearPlayer(e);
    if (dragging) box.setPointerCapture(e.pointerId);
  });
  box.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const p = pathTo(cellFromEvent(e), 4);
    if (p) p.forEach(moveTo);
  });
  const end = () => { dragging = false; };
  box.addEventListener("pointerup", end);
  box.addEventListener("pointercancel", end);
};

// ---------------------------------------------------------------- solution

let raf = null;
const stopSolve = () => {
  if (raf) cancelAnimationFrame(raf);
  raf = null;
};
const hideSolution = () => {
  stopSolve();
  solShown = false;
  const path = $("solution");
  if (path) path.style.display = "none";
  $("solve").textContent = "Show solution";
};
const solve = () => {
  const path = $("solution");
  if (!path) return;
  if (raf || solShown) return hideSolution();
  const len = path.getTotalLength();
  path.style.display = "";
  path.setAttribute("stroke-dasharray", `${len} ${len}`);
  $("solve").textContent = "Hide solution";
  let at = 0, last = performance.now();
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const step = (now) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    at = reduce ? len : Math.min(len, at + dt * S.speed * 70);
    path.setAttribute("stroke-dashoffset", f2(len - at));
    if (at < len) raf = requestAnimationFrame(step);
    else { raf = null; solShown = true; path.removeAttribute("stroke-dasharray"); path.removeAttribute("stroke-dashoffset"); }
  };
  raf = requestAnimationFrame(step);
};

// ---------------------------------------------------------------- export

const download = (blob, name) => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};
const fileName = (ext) => `maze-${S.shape}-${S.algo}-${S.size}-${M.seed}${solShown ? "-solved" : ""}.${ext}`;
const exportSVG = () => download(new Blob([mazeSVG(M, true)], { type: "image/svg+xml" }), fileName("svg"));
const exportPNG = () => {
  const px = 2000;
  const svg = mazeSVG(M, true).replace("<svg ", `<svg width="${px}" height="${px}" `);
  const img = new Image();
  img.onload = () => {
    const cv = document.createElement("canvas");
    cv.width = cv.height = px;
    cv.getContext("2d").drawImage(img, 0, 0, px, px);
    cv.toBlob((b) => download(b, fileName("png")));
  };
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
};

// ---------------------------------------------------------------- setup

const chips = (id, items, choose) => {
  const box = $(id);
  box.innerHTML = "";
  items.forEach((it) => {
    const b = document.createElement("button");
    b.type = "button";
    if (it.icon) {
      b.innerHTML = it.icon;
      b.title = it.label;
      b.setAttribute("aria-label", it.label);
    } else b.textContent = it.label;
    b.onclick = () => choose(it);
    box.appendChild(b);
  });
};

const initMaze = () => {
  readHash();
  if (!LOOKS.some((l) => l.id === S.look)) S.look = DEFAULTS.look;
  if (!GEN[S.algo]) S.algo = DEFAULTS.algo;
  if (!SHAPES.some((s) => s.id === S.shape)) S.shape = DEFAULTS.shape;
  save();
  const change = (k, v) => { S[k] = v; save(); regenerate(); };
  chips("shape-chips", SHAPES, (s) => change("shape", s.id));
  chips("algo-chips", ALGOS, (a) => change("algo", a.id));
  chips("look-chips", LOOKS, (l) => { S.look = l.id; save(); draw(); });
  const slider = (id, k, redo) => {
    const el = $(id);
    el.value = S[k];
    el.oninput = () => { S[k] = +el.value; save(); redo(); };
  };
  slider("size", "size", regenerate);
  slider("loops", "loops", regenerate);
  const length = $("length");
  length.innerHTML = LENGTHS.map((l) => `<option value="${l.id}">${l.label}</option>`).join("");
  if (!LENGTHS.some((l) => l.id === S.length)) S.length = DEFAULTS.length;
  length.value = S.length;
  length.onchange = () => change("length", length.value);
  slider("wall", "wall", draw);
  slider("speed", "speed", () => { $("speed-val").textContent = S.speed; });
  const heat = $("l-heat");
  heat.checked = !!S.heat;
  heat.onchange = () => { S.heat = heat.checked; save(); draw(); };
  $("new").onclick = () => change("seed", newSeed());
  $("seed").onchange = () => {
    const v = parseInt($("seed").value, 10);
    if (Number.isFinite(v) && v >= 0) change("seed", Math.min(1e9, v));
    else $("seed").value = S.seed;
  };
  $("solve").onclick = solve;
  // start over: the dot goes back to the entrance, and the trail and the solution go away
  $("reset").onclick = () => { hideSolution(); resetPlayer(); drawPlayer(); $("maze").focus({ preventScroll: true }); };
  $("export-png").onclick = exportPNG;
  $("export-svg").onclick = exportSVG;
  $("print").onclick = () => window.print();
  addEventListener("hashchange", () => { readHash(); save(); regenerate(); ["size", "loops", "length"].forEach((k) => ($(k).value = S[k])); });
  setupPlay();
  regenerate();
};
