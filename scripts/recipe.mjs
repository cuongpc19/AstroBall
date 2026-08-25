// recipe — build levels to the "starved corner" brief.
//
// The brief, as specified:
//
//   1) a corner packed with `?` trays, ringed by coloured trays whose colours appear **nowhere**
//      in box row 1 and **exactly once** in box row 2;
//   2) the rest of the board in other colours; the box stacks then derived backwards from that.
//
// Why it should be hard, in the model's own terms: a colour nothing is short of weighs zero, so
// the ring is refused outright while row 1 lasts. The board keeps presenting turns with no
// stand-out, which after the bipolar change is exactly where the difficulty lives — a turn with a
// clear best move is taken ~90% of the time, and a turn without one is a coin toss.
//
//   node scripts/recipe.mjs 34-38 --hidden 0.5
//
// ⚠ The `?` **boxes** are invisible to every model here. B and D never look below the top box,
// and Cuongxs1 reads straight through `boxHidden` by design. They make the level harder for a
// person and not at all for the tooling, so nothing below measures them — they are placed because
// the brief asks for them, and their effect can only be seen in a play log.

import { writeFileSync } from "node:fs";
import { loadGame, rate, best, cuongxs1Rate, playPerfect, D_SLIP } from "./bots.mjs";

const M = await loadGame();
const { HANDMADE, levelDefFor, PALETTE, GRID_MAX } = M;

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const RANGE = (process.argv[2] || "34-38").split("-").map(Number);
const HIDDEN_BOX = Number(arg("hidden", 0.5));
const TRIES = Number(process.env.TRIES || 90);
const SCREEN = Number(process.env.SCREEN || 16);
const CONFIRM = Number(process.env.CONFIRM || 80);

function rng32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const shuffled = (r, a) => {
  const x = [...a];
  for (let i = x.length - 1; i > 0; i--) {
    const j = (r() * (i + 1)) | 0;
    [x[i], x[j]] = [x[j], x[i]];
  }
  return x;
};

/**
 * Five silhouettes, each with the `?` corner somewhere different.
 *
 * ⚠ Deliberately not one shape re-coloured five times. The corner is the whole idea, and a corner
 * reads differently depending on which way the board opens away from it — top-left against a
 * full block is a different puzzle from bottom-right against a notch.
 */
/**
 * The same idea with the choke point **in the middle** instead of in a corner.
 *
 * ⚠ A corner `?` block is partly ringed by casing, and casing counts as solid to the reveal rule
 * — so a corner does half the work of enclosing itself. A central block has to be ringed by real
 * trays on all four sides, which means the ring is bigger, every one of its colours is starved,
 * and the board has to be peeled inward from the outside before the `?` are even reachable.
 */
const MAPS_MID = [
  // 6x6, a 2x2 of `?` dead centre.
  { cols: 6, rows: 6, span: [[0, 5], [0, 5], [0, 5], [0, 5], [0, 5], [1, 4]], hatch: [[0, 1], [0, 4]], q: (x, y) => y >= 2 && y <= 3 && x >= 2 && x <= 3 },
  // 7x5, a horizontal bar of `?` across the middle row.
  { cols: 7, rows: 5, span: [[0, 6], [0, 6], [0, 6], [0, 6], [1, 5]], hatch: [[0, 0], [0, 6]], q: (x, y) => y === 2 && x >= 2 && x <= 4 },
  // 5x6 tall: a 2x3 of `?` in the middle, very little room either side.
  { cols: 5, rows: 6, span: [[0, 4], [0, 4], [0, 4], [0, 4], [0, 4], [1, 3]], hatch: [[0, 2]], q: (x, y) => y >= 2 && y <= 3 && x >= 1 && x <= 3 },
  // 7x6 with the corners cut, `?` in a plus shape at the centre.
  { cols: 7, rows: 6, span: [[1, 5], [0, 6], [0, 6], [0, 6], [0, 6], [1, 5]], hatch: [[1, 0], [1, 6]], q: (x, y) => (y >= 2 && y <= 3 && x >= 3 && x <= 4) || (y === 2 && x === 2) },
  // 6x5, a wide bar of `?` with one row above and two below.
  { cols: 6, rows: 5, span: [[0, 5], [0, 5], [0, 5], [0, 5], [1, 4]], hatch: [[0, 0], [0, 5]], q: (x, y) => y === 2 && x >= 1 && x <= 4 },
];

const MAPS = [
  // 6x6, the shape the reference level uses: narrow top, wide body, `?` filling the top rows.
  { cols: 6, rows: 6, span: [[1, 4], [0, 5], [0, 5], [0, 5], [0, 5], [1, 4]], hatch: [[3, 2], [3, 3]], q: (x, y) => y <= 2 },
  // 6x5 block with the corner bottom-left, so the `?` sit *under* the coloured ring.
  { cols: 6, rows: 5, span: [[0, 5], [0, 5], [0, 5], [0, 5], [0, 4]], hatch: [[1, 4]], q: (x, y) => y >= 2 && x <= 2 },
  // 7x5, corner top-right. ⚠ The first draft let the silhouette shrink away from under the `?`
  // block, which left it with open air on two sides — the reveal rule flipped it before the first
  // frame and there was no corner left to starve. Keep the rows under it full.
  { cols: 7, rows: 5, span: [[0, 6], [0, 6], [0, 6], [0, 6], [1, 5]], hatch: [[3, 1]], q: (x, y) => y <= 1 && x >= 4 },
  // 5x6 tall and narrow — the corner has fewer ways out.
  { cols: 5, rows: 6, span: [[0, 4], [0, 4], [0, 4], [0, 4], [0, 4], [1, 3]], hatch: [[3, 1], [3, 3]], q: (x, y) => y <= 1 },
  // 7x6 with a hollow middle, corner bottom-right.
  { cols: 7, rows: 6, span: [[1, 5], [0, 6], [0, 6], [0, 6], [0, 6], [1, 5]], hatch: [[2, 0], [2, 6]], hole: (x, y) => y >= 2 && y <= 3 && x >= 2 && x <= 4, q: (x, y) => y >= 4 && x >= 4 },
];

/** Cells of the map, tagged: "wall" outside the silhouette, "hole" open floor, else a tray. */
function layout(map) {
  const out = [];
  for (let y = 0; y < map.rows; y++) {
    const [lo, hi] = map.span[y];
    for (let x = 0; x < map.cols; x++) {
      if (x < lo || x > hi) out.push({ kind: "wall" });
      else if (map.hole?.(x, y)) out.push({ kind: "hole" });
      else if (map.hatch.some(([hy, hx]) => hy === y && hx === x)) out.push({ kind: "hatch" });
      else out.push({ kind: "tray", x, y, q: !!map.q(x, y) });
    }
  }
  return out;
}

/**
 * A drawing: `?` in the corner the map marks, the cells touching it drawn from `ring`, and
 * everything else from the rest of the palette.
 */
function draw(map, seed, ring, rest, hiddenBox) {
  const r = rng32(seed);
  const base = layout(map);
  const cols = map.cols;
  const isQ = (i) => base[i]?.kind === "tray" && base[i].q;
  const touchesQ = (i) => {
    const x = i % cols;
    const y = (i / cols) | 0;
    return [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].some(
      ([nx, ny]) => nx >= 0 && ny >= 0 && nx < cols && ny < map.rows && isQ(ny * cols + nx),
    );
  };
  const cells = base.map((c, i) => {
    if (c.kind === "wall") return { kind: "wall" };
    if (c.kind === "hole") return { kind: "floor" };
    if (c.kind === "hatch") {
      const q = [0, 1, 2].map(() => rest[(r() * rest.length) | 0]);
      return { kind: "hatch", queue: q, hiddenQ: q.map(() => r() < 0.4), dir: "down" };
    }
    if (c.q) return { kind: "tile", color: rest[(r() * rest.length) | 0], hidden: true };
    const pool = touchesQ(i) ? ring : rest;
    return { kind: "tile", color: pool[(r() * pool.length) | 0], hidden: r() < 0.15 };
  });
  return { cols, rows: map.rows, cells, boxHiddenFrac: hiddenBox, boxAvoidTop: ring };
}

/** Does the finished board honour the brief? */
function fits(def, ring) {
  const row1 = def.columns.map((c) => c[0]).filter((c) => c !== undefined);
  const row2 = def.columns.map((c) => c[1]).filter((c) => c !== undefined);
  const inRing = (c) => ring.includes(c);
  return {
    ok: !row1.some(inRing) && row2.filter(inRing).length === 1,
    row1,
    row2,
  };
}

function scoreAll(def, n) {
  const b = best(M, def, n);
  const d = rate(M, def, "greedy", n, D_SLIP);
  const cx = cuongxs1Rate(M, def, n).rate;
  return { B: b, D: d, BD: (b + d) / 2, CX: cx, worst: Math.max(b, d, (b + d) / 2, cx) };
}

const [lo, hi] = RANGE;
console.log(`Cong thuc "${process.argv.includes("--middle") ? "nut that o giua" : "goc doi"}": ${hi - lo + 1} level ${lo}-${hi}, ${TRIES} bien the/level.`);
console.log(`Box an ${Math.round(HIDDEN_BOX * 100)}% (tu tang 2 tro xuong) — khong mo hinh nao thay duoc.`);
console.log("");

const out = {};
for (let k = 0; k <= hi - lo; k++) {
  const level = lo + k;
  // ⚠ Keyed off the level, not the position in the range. Re-running one level on its own gave
  // it index 0 and quietly handed it a silhouette another level already had.
  const table = process.argv.includes("--middle") ? MAPS_MID : MAPS;
  const map = table[level % table.length];
  let picked = null;
  let seenFits = 0;

  for (let t = 0; t < TRIES; t++) {
    const r = rng32(level * 7919 + t * 104729 + 5);
    const all = PALETTE.map((_, i) => i);
    const perm = shuffled(r, all);
    // The ring is small — two or three colours the open boxes will not want for a long time.
    const ring = perm.slice(0, 2 + (t % 2));
    const rest = perm.slice(ring.length, ring.length + 4 + (t % 2));
    const bp = draw(map, level * 31 + t, ring, rest, HIDDEN_BOX);

    let def;
    try {
      HANDMADE[level] = bp;
      def = levelDefFor(level);
    } catch {
      continue;
    }
    if (!def.refTaps?.length || !playPerfect(M, def).win) continue;

    const f = fits(def, ring);
    if (!f.ok) continue;
    seenFits++;

    const quick = scoreAll(def, SCREEN);
    const s = quick.worst > 0.45 ? quick : scoreAll(def, CONFIRM);
    // Hard, but not a lottery — the same floor the other forge uses.
    if (!picked || s.worst < picked.s.worst) picked = { bp, def, s, ring, rest, f };
    if (s.worst < 0.2) break;
  }

  if (!picked) {
    delete HANDMADE[level];
    console.log(`L${level}: khong dung duoc board nao dat cong thuc (${seenFits} board hop le).`);
    continue;
  }
  HANDMADE[level] = picked.bp;
  out[level] = picked.bp;
  const p = (x) => String(Math.round(x * 100)).padStart(3) + "%";
  const s = picked.s;
  const qs = picked.bp.cells.filter((c) => c.kind === "tile" && c.hidden).length;
  console.log(
    `L${level}: ${map.cols}x${map.rows}, ${qs} khay ?, vanh mau [${picked.ring.join(",")}] | ` +
      `hang1 [${picked.f.row1.join(",")}] hang2 [${picked.f.row2.join(",")}] | ` +
      `B ${p(s.B)} D ${p(s.D)} (B+D)/2 ${p(s.BD)} Cuongxs1 ${p(s.CX)}`,
  );
}

const dest = arg("out", "");
if (dest) {
  writeFileSync(
    dest,
    Object.keys(out)
      .map(Number)
      .sort((a, b) => a - b)
      .map((n) => `  ${n}: ${JSON.stringify(out[n])},`)
      .join("\n") + "\n",
  );
  console.log("");
  console.log(`Da ghi ${Object.keys(out).length} level vao ${dest}.`);
}
