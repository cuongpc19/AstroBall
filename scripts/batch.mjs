// batch — build a run of hand-shaped levels to a target, with chocolate boxes, linked pairs and
// crates as the ingredients.
//
//   node scripts/batch.mjs choc  --out a.txt     # 46-55: 1-2 chocolate boxes, Cuongxs1 80% -> 30%
//   node scripts/batch.mjs block --out b.txt     # 56-85: 30 levels in the 26-35 shape, (B+D)/2 80%
//
// ⚠ **Which ruler a batch is scored on is part of its spec, not a detail.** The 46-55 run names
// Cuongxs1; the 56-85 run has no model named so it uses (B+D)/2, which is what `SHEET`'s target
// column is defined on. Scoring one batch on the other's ruler is the mistake `CLAUDE.md` records
// twice — level 8 once read "27 points too hard" purely because the threshold and the measurement
// were different metrics.
//
// ⚠ **Trays are packed and the shape is cut out of casing.** A light board is a *smaller* packed
// block, never the same block with holes punched in it: gaps between trays make every tray
// tappable from the first frame, which is the same tray count and none of the game.

import { writeFileSync } from "node:fs";
import { loadGame, rate, best, cuongxs1Rate, playPerfect, D_SLIP } from "./bots.mjs";

const M = await loadGame();
const { HANDMADE, levelDefFor, PALETTE } = M;

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const WHICH = process.argv[2] || "choc";
const TRIES = Number(process.env.TRIES || 44);
const SCREEN = Number(process.env.SCREEN || 10);
const CONFIRM = Number(process.env.CONFIRM || 30);

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

// ── Silhouettes ──────────────────────────────────────────────────────────────
//
//   `.` casing   `_` open cavity   `#` tray   `H` hatch   `X` crate
//   `<` tray that may become a linked-pair anchor (claims the cell to its right)
//   `C` tray that may become a chocolate box (claims the 2x2 with it as top-left)

/** 5x5 and 6x6, for the chocolate run. A 2x2 box is a quarter of a 5x5 board, so these stay open
 *  enough that losing four cells to it does not seal the rest in. */
const MAPS_CHOC = [
  { style: "khoi-5", sizes: [["H###.", "C####", "#####", "#####", ".###."]] },
  { style: "tru-5", sizes: [["H.###", "#.C##", "#.###", "#.###", "#.###"]] },
  { style: "thoi-6", sizes: [["..H#..", ".C####", "######", ".C####", "..##..", "..##.."]] },
  { style: "khung-6", sizes: [[".H###.", "C####.", "#__###", "#__C##", "######", ".####."]] },
  { style: "bac-6", sizes: [["...H##", "..C###", ".C####", "######", "..####", "...###"]] },
];

/**
 * The 26-35 shape: a packed slab, cut small out of a bigger grid.
 *
 * ⚠ **Grid size and board size are not the same thing, and at an 80% target the difference is the
 * whole design.** A 7x7 filled edge to edge is 45 trays — 405 marbles onto a belt of 30 — and no
 * stack order on earth makes that 80%; the first draft of these was exactly that and every one
 * came in at 25-45%. So the *grid* is 7x7 where the brief asks for it and the *silhouette* inside
 * it is 14-18 trays, packed solid, the way levels 3-8 are built. Packed and small, never large
 * and sparse.
 */
const MAPS_BLOCK = [
  { style: "slab-6x5", sizes: [[".H###.", ".C###.", ".<###.", "..##..", "..##.."]] },
  { style: "slab-7x4", sizes: [["..H##..", "..C###.", ".<####.", "..###.."]] },
  { style: "tall-5x6", sizes: [[".H##.", ".C##.", "#<###", ".###.", ".###.", "..#.."]] },
  { style: "wide-7x4", sizes: [["..H###.", "..C###.", ".<####.", "..###.."]] },
  { style: "big-7x7", sizes: [["...H...", "..###..", ".#C###.", ".<####.", "..###..", "...#...", "...#..."]] },
];

/** The "different style" ones — outlines and towers rather than slabs. */
const MAPS_ODD = [
  // A hollow frame in a 7-wide grid: the cavity is the only lane, so the ring peels from the
  // inside out as well as the outside in.
  { style: "khung-7x5", sizes: [[".##H##.", ".#___#.", ".C___#.", ".#___#.", ".<####."]] },
  // A diagonal drift — every row steps one to the right.
  { style: "cheo-6x6", sizes: [[".H##..", ".C##..", "..###.", "..<##.", "...##.", "...##."]] },
  // ⚠ Pillars, and **every pillar reaches the bottom row**. One walled on both sides that stops
  // short of it is sealed forever, and the only symptom is "no winning line" on every trial.
  { style: "cot-7x4", sizes: [["H.###.#", "#.C##.#", "#.###.#", "#.###.#"]] },
  // Two towers on a shared base: nothing crosses until the base opens.
  { style: "thap-6x6", sizes: [[".H..H.", ".#..#.", ".#..#.", ".C###.", ".<###.", "..##.."]] },
  // A T: a wide brim over a narrow stem, so the brim has to go first.
  { style: "chu-t-7x5", sizes: [[".H###..", ".C####.", "...##..", "...<#..", "...##.."]] },
];

for (const table of [MAPS_CHOC, MAPS_BLOCK, MAPS_ODD]) {
  for (const m of table) {
    m.sizes = m.sizes.map((art) => {
      const rows = art.length;
      const cols = art[0].length;
      if (art.some((r) => r.length !== cols)) throw new Error(`${m.style}: rows differ in width`);
      const bad = art.join("").replace(/[.#_HX<C]/g, "");
      if (bad) throw new Error(`${m.style}: unknown glyph ${JSON.stringify(bad)}`);
      const size = { art, rows, cols };
      const stuck = unpeelable(size);
      if (stuck.length) {
        for (let y = 0; y < rows; y++) {
          console.error("  " + [...art[y]].map((c, x) => (stuck.includes(y * cols + x) ? "!" : c)).join(""));
        }
        throw new Error(`${m.style}: ${stuck.length} o bi nhot vinh vien`);
      }
      size.trays = art.join("").replace(/[^#<C]/g, "").length;
      size.hatches = art.join("").replace(/[^H]/g, "").length;
      return size;
    });
  }
}

/**
 * Cells this silhouette can never open, by the escape rule alone.
 *
 * ⚠ Checked on the drawing, because the only symptom otherwise is the builder reporting "no
 * winning line" on every single trial — which reads as the target being unreachable rather than
 * as a hole in the art. Casing is **solid**: `cellFree` says so, and a walled board's edge not
 * being a way out is the whole point of walling it.
 */
function unpeelable(size) {
  const { art, rows, cols } = size;
  const solid = new Array(rows * cols).fill(false);
  const tray = new Array(rows * cols).fill(false);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const ch = art[y][x];
      solid[y * cols + x] = ch !== "_";
      tray[y * cols + x] = ch === "#" || ch === "<" || ch === "C";
    }
  }
  const free = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows && !solid[y * cols + x];
  for (let pass = 0; pass < rows * cols; pass++) {
    let moved = false;
    for (let i = 0; i < solid.length; i++) {
      if (!tray[i] || !solid[i]) continue;
      const x = i % cols;
      const y = (i / cols) | 0;
      if (y === rows - 1 || free(x - 1, y) || free(x + 1, y) || free(x, y - 1) || free(x, y + 1)) {
        solid[i] = false;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return solid.map((s, i) => (s && tray[i] ? i : -1)).filter((i) => i >= 0);
}

function layout(map) {
  const out = [];
  for (let y = 0; y < map.rows; y++) {
    for (let x = 0; x < map.cols; x++) {
      const ch = map.art[y][x];
      if (ch === ".") out.push({ kind: "wall" });
      else if (ch === "_") out.push({ kind: "hole" });
      else if (ch === "H") out.push({ kind: "hatch" });
      else if (ch === "X") out.push({ kind: "crate" });
      else out.push({ kind: "tray", pair: ch === "<", choc: ch === "C" });
    }
  }
  return out;
}

/** Chocolate-box anchors: `want` of them, each owning a clean 2x2 of trays that nothing else has. */
function chocSlots(map, base, r, want, taken) {
  const out = [];
  for (const a of shuffled(r, base.map((c, i) => (c.choc ? i : -1)).filter((i) => i >= 0))) {
    if (out.length >= want) break;
    if (a % map.cols >= map.cols - 1) continue;
    const cells = [a, a + 1, a + map.cols, a + map.cols + 1];
    if (cells.some((k) => k >= base.length || base[k]?.kind !== "tray" || taken.has(k))) continue;
    cells.forEach((k) => taken.add(k));
    out.push(a);
  }
  return out;
}

/** Linked-pair anchors, avoiding anything a chocolate box already claimed. */
function pairSlots(map, base, r, want, taken) {
  const out = [];
  for (const a of shuffled(r, base.map((c, i) => (c.pair ? i : -1)).filter((i) => i >= 0))) {
    if (out.length >= want) break;
    if (a % map.cols >= map.cols - 1) continue;
    if (taken.has(a) || taken.has(a + 1) || base[a + 1]?.kind !== "tray") continue;
    taken.add(a);
    taken.add(a + 1);
    out.push(a);
  }
  return out;
}

function draw(map, seed, pool, opt) {
  const r = rng32(seed);
  const base = layout(map);
  const cols = map.cols;
  const pick = () => pool[(r() * pool.length) | 0];
  const taken = new Set();
  const chocs = chocSlots(map, base, r, opt.chocs, taken);
  const pairs = pairSlots(map, base, r, opt.pairs, taken);
  const chocCover = new Set(chocs.flatMap((a) => [a + 1, a + cols, a + cols + 1]));
  const pairMate = new Set(pairs.map((a) => a + 1));
  // Crates come out of plain tray cells, never out of a piece: a crate on a chocolate box's 2x2
  // would leave it with fewer than four trays to hide and `gridDef` would drop the box.
  const crates = new Set(
    shuffled(
      r,
      base.map((c, i) => (c.kind === "tray" && !taken.has(i) ? i : -1)).filter((i) => i >= 0),
    ).slice(0, opt.crates),
  );

  const cells = base.map((c, i) => {
    if (c.kind === "wall") return { kind: "wall" };
    if (c.kind === "hole") return { kind: "floor" };
    if (c.kind === "crate" || crates.has(i)) return { kind: "crate" };
    if (c.kind === "hatch") {
      const q = [0, 1, 2].map(pick);
      return { kind: "hatch", queue: q, hiddenQ: q.map(() => r() < opt.hiddenQ), dir: "down" };
    }
    if (chocCover.has(i) || pairMate.has(i)) return { kind: "floor" };
    if (chocs.includes(i)) {
      // ⚠ A single-colour box holds four trays of its own colour — that is the convention the
      // ribbon draws. A rainbow box's four are free, and are drawn free here on purpose so the
      // two kinds do not look the same on the board.
      const rainbow = r() < opt.rainbow;
      const border = rainbow ? null : pick();
      const under = [0, 1, 2, 3].map(() => ({
        color: rainbow ? pick() : border,
        hidden: r() < opt.hidden,
      }));
      // `need` is patched once the whole board is known — see `fixChocNeeds`.
      return { kind: "choc", need: 1, border, under };
    }
    if (pairs.includes(i)) {
      const color = pick();
      let mate = pick();
      for (let n = 0; n < 8 && mate === color && pool.length > 1; n++) mate = pick();
      return { kind: "tile", color, mate, wide: true, hidden: r() < opt.hidden };
    }
    return { kind: "tile", color: pick(), hidden: r() < opt.hidden };
  });

  const bp = { cols, rows: map.rows, cells, boxHiddenFrac: opt.hiddenBox };
  fixChocNeeds(bp, r, opt);
  return bp;
}

/**
 * Set every chocolate box's counter to something the board can actually feed it.
 *
 * ⚠ This is the one way to make an unwinnable level with a chocolate box, and it fails silently.
 * The four trays under a box cannot be tapped while it is closed, so they never count toward
 * opening it — and `isWon` refuses to finish while any box is still on the board. A counter one
 * higher than the supply outside is a level nobody can clear, not a hard one.
 */
function fixChocNeeds(bp, r, opt) {
  const boxes = bp.cells.map((c, i) => (c.kind === "choc" ? i : -1)).filter((i) => i >= 0);
  for (const i of boxes) {
    const box = bp.cells[i];
    const wants = (col) => box.border === null || box.border === col;
    let supply = 0;
    bp.cells.forEach((c, k) => {
      if (k === i) return;
      if (c.kind === "tile" && c.color !== undefined) {
        if (wants(c.color)) supply++;
        if (c.wide && wants(c.mate ?? c.color)) supply++;
      }
      if (c.kind === "hatch") for (const q of c.queue ?? []) if (wants(q)) supply++;
      if (c.kind === "choc") for (const u of c.under ?? []) if (wants(u.color)) supply++;
    });
    // Part of the way through, not right at the end: a box that opens on the last tap hands back
    // four trays with nothing left to drain them into.
    box.need = Math.max(1, Math.min(supply, Math.round(supply * (0.3 + r() * opt.needSpan))));
  }
}

// ── The runs ─────────────────────────────────────────────────────────────────

const RUNS = {
  // 46-55: chocolate boxes, scored on Cuongxs1, walking 80% down to 30%.
  choc: {
    from: 46,
    to: 55,
    model: "cx",
    maps: (lv) => MAPS_CHOC[(lv - 46) % MAPS_CHOC.length],
    target: (lv) => 0.8 - ((lv - 46) / 9) * 0.5,
    opts: (lv, t) => ({
      chocs: 1 + ((lv + t) % 2),
      pairs: 0,
      crates: 0,
      rainbow: 0.5,
      hidden: [0, 0.15, 0.3][t % 3],
      hiddenQ: [0, 0.4][t % 2],
      hiddenBox: 0.4,
      needSpan: 0.3,
      colours: 5 + (t % 3),
    }),
  },
  // 56-85: the 26-35 shape at a much gentler target. Every third level gets a chocolate box, a
  // linked pair or a crate or two, so half the run carries something beyond plain trays.
  block: {
    from: 56,
    to: 85,
    model: "bd",
    maps: (lv) => {
      const k = lv - 56;
      // ⚠ Four of the thirty are the odd-shaped ones, spread out rather than bunched: a run of
      // thirty slabs with four outlines at the end reads as two batches, not one ladder.
      return k % 7 === 3 ? MAPS_ODD[((k / 7) | 0) % MAPS_ODD.length] : MAPS_BLOCK[k % MAPS_BLOCK.length];
    },
    target: () => 0.8,
    opts: (lv, t) => {
      const k = lv - 56;
      return {
        chocs: k % 6 === 2 ? 1 : 0,
        pairs: k % 6 === 4 ? 1 + (t % 2) : 0,
        crates: k % 3 === 0 ? 1 + (t % 3) : 0,
        rainbow: 0.5,
        hidden: [0.1, 0.25, 0.4][t % 3],
        hiddenQ: [0, 0.4][t % 2],
        hiddenBox: 0.4,
        needSpan: 0.35,
        colours: 5 + (t % 3),
      };
    },
  },
};

const run = RUNS[WHICH];
if (!run) throw new Error(`khong biet dot "${WHICH}" — chon: ${Object.keys(RUNS).join(", ")}`);
// An optional slice, for re-running one level without rebuilding the batch. ⚠ Everything the run
// decides is keyed off the level number, never off the position in the range, so a slice gets the
// silhouette and ingredients that level shipped with rather than index 0's.
const slice = process.argv[3] && /^\d+(-\d+)?$/.test(process.argv[3]) ? process.argv[3].split("-").map(Number) : null;
const FROM = slice ? slice[0] : run.from;
const TO = slice ? (slice[1] ?? slice[0]) : run.to;

function scoreAll(def, n) {
  const b = best(M, def, n);
  const d = rate(M, def, "greedy", n, D_SLIP);
  return { B: b, D: d, BD: (b + d) / 2, CX: cuongxs1Rate(M, def, n).rate };
}
const readOn = (s) => (run.model === "cx" ? s.CX : s.BD);

const TOL = run.model === "cx" ? 0.06 : 0.1;
console.log(`Dot "${WHICH}": level ${FROM}-${TO}, ${TRIES} bien the/level, cham theo ${run.model === "cx" ? "Cuongxs1" : "(B+D)/2"}.`);
console.log("");

const out = {};
for (let level = FROM; level <= TO; level++) {
  const style = run.maps(level);
  const want = run.target(level);
  let picked = null;
  const why = { threw: 0, noline: 0, missing: 0 };

  for (let t = 0; t < TRIES; t++) {
    const r = rng32(level * 7919 + t * 104729 + 17);
    const opt = run.opts(level, t);
    const map = style.sizes[t % style.sizes.length];
    const pool = shuffled(r, PALETTE.map((_, i) => i)).slice(0, opt.colours);
    const bp = draw(map, level * 31 + t, pool, opt);

    let def;
    try {
      HANDMADE[level] = bp;
      def = levelDefFor(level);
    } catch {
      why.threw++;
      continue;
    }
    if (!def.refTaps?.length || !playPerfect(M, def).win) {
      why.noline++;
      continue;
    }
    // The pieces the brief asked for have to survive `gridDef`, which silently drops a box or a
    // pair with no room. Counting them on the finished board is the only honest check.
    const gotChoc = def.lids.length;
    const gotPair = def.tiles.filter((x) => x && x.wide).length;
    if (gotChoc < opt.chocs || gotPair < opt.pairs) {
      why.missing++;
      continue;
    }

    const quick = scoreAll(def, SCREEN);
    if (picked && Math.abs(readOn(quick) - want) > 0.28) continue;
    const s = scoreAll(def, CONFIRM);
    // Never ship a level best play cannot clear: landing one model's curve is not the same as
    // being a board anybody wins.
    if (s.B < 0.12) continue;
    const err = Math.abs(readOn(s) - want);
    if (!picked || err < picked.err) picked = { bp, def, s, err, opt, map, gotChoc, gotPair };
    if (err <= 0.03) break;
  }

  if (!picked) {
    delete HANDMADE[level];
    console.log(`L${level}: khong dung duoc board nao — ${why.threw} loi, ${why.noline} khong co duong thang, ${why.missing} mat manh ghep.`);
    continue;
  }
  HANDMADE[level] = picked.bp;
  out[level] = picked.bp;
  const p = (x) => String(Math.round(x * 100)).padStart(3) + "%";
  const s = picked.s;
  const bits = [
    picked.gotChoc ? `${picked.gotChoc} socola` : "",
    picked.gotPair ? `${picked.gotPair} khay doi` : "",
    picked.bp.cells.filter((c) => c.kind === "crate").length ? `${picked.bp.cells.filter((c) => c.kind === "crate").length} thung` : "",
  ].filter(Boolean);
  console.log(
    `L${level}: ${style.style} ${picked.bp.cols}x${picked.bp.rows} | ${bits.join(", ") || "khay thuong"} | ` +
      `${run.model === "cx" ? "Cuongxs1" : "(B+D)/2"} ${p(readOn(s))} (dich ${p(want)}) | ` +
      `B ${p(s.B)} D ${p(s.D)} CX ${p(s.CX)}${picked.err > TOL ? "  <-- lech" : ""}`,
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
