// Turn a few interior trays into arrow trays, on the easiest levels of a run.
//
//   node scripts/arrows.mjs 42-80 --share 0.2 --arrows 3 [--write]
//
// ⚠ **Interior means interior to the *shape*, not to the grid.** A tray on the outer ring of the
// silhouette has casing or open air on at least one side; the arrow has to point at another tray,
// and a cell whose four neighbours are all part of the board is the only kind that always has one.
// It is also the kind a player reads as "inside", which is what the brief asked for.
//
// ⚠ **Solvability is re-proved, never assumed.** These boards ship with a pinned `refTaps`, and a
// lock can make that exact order illegal — `toLevelDef` then throws the line away and the level is
// left with no proof at all and nothing for the hint button. So every edited board gets a fresh
// line searched for and pinned, replayed through the real engine exactly the way `custom.ts`
// replays it before trusting one.
//
// ⚠ Winrate is deliberately **not** a gate here, on instruction. It is still printed, because a
// board that swung twenty points is worth knowing about even when nothing is going to be done.

import fs from "node:fs";
import { loadGame, bd, makeRng } from "./bots.mjs";

const M = await loadGame();
const arg = (k, d = null) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const range = (process.argv[2] ?? "42-80").split("-").map(Number);
const SHARE = Number(arg("share", 0.2));
const WANT = Number(arg("arrows", 3));
const WRITE = process.argv.includes("--write");

const DIRS = [
  ["up", (i, c) => i - c, (i, c, r) => Math.floor(i / c) > 0],
  ["down", (i, c) => i + c, (i, c, r) => Math.floor(i / c) < r - 1],
  ["left", (i, c) => i - 1, (i, c) => i % c > 0],
  ["right", (i, c) => i + 1, (i, c) => i % c < c - 1],
];

/** Cells whose four orthogonal neighbours are all on the board: not casing, not off the grid. */
function interior(bp) {
  const { cols, rows, cells } = bp;
  const out = [];
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    // ⚠ Linked pairs are left alone. A pair is one piece across two cells and its right half has no
    // tile of its own, so a lock on the anchor is a lock on something the geometry here cannot see.
    //
    // ⚠ **And never a face-down tray.** `refreshGrid` draws the arrow only on a tray that is
    // showing its colour — two locks stacked on one tile read as neither — so an arrow on a `?`
    // draws nothing at all while the tray stays face-down. The first run of this script put all
    // three of level 51 on `?` trays: three trays locked, untappable, with nothing on screen saying
    // why. Reported as "tôi có thấy đâu", and it was invisible because it genuinely was not drawn.
    if (c.kind !== "tile" || c.arrow || c.wide || c.hidden) continue;
    let ok = true;
    for (const [, step, fits] of DIRS) {
      if (!fits(i, cols, rows) || cells[step(i, cols)].kind === "wall") {
        ok = false;
        break;
      }
    }
    if (ok) out.push(i);
  }
  return out;
}

/** Would this set of arrows deadlock? The same fixpoint `checkBlueprint` runs. */
function ringFree(bp) {
  const can = bp.cells.map((c) => c.kind !== "tile" || !c.arrow);
  for (let pass = 0; pass < bp.cells.length; pass++) {
    let grew = false;
    for (let i = 0; i < bp.cells.length; i++) {
      if (can[i]) continue;
      const d = DIRS.find((x) => x[0] === bp.cells[i].arrow);
      if (!d || !d[2](i, bp.cols, bp.rows)) continue;
      if (can[d[1](i, bp.cols)]) {
        can[i] = true;
        grew = true;
      }
    }
    if (!grew) break;
  }
  return bp.cells.every((c, i) => can[i] || c.kind !== "tile" || !c.arrow);
}

/** A winning tap order, or null. Random play first — these are the easy boards — then greedy. */
function findLine(def, tries = 600) {
  for (let s = 0; s < tries; s++) {
    const rng = makeRng(s * 7919 + 13);
    const greedy = s >= tries / 2;
    const g = new M.Game(def);
    const taps = [];
    for (let t = 0; g.status === "play" && t < 40000; t++) {
      const open = [];
      for (let i = 0; i < g.tiles.length; i++) if (g.canTap(i)) open.push(i);
      if (open.length) {
        let pick = open[(rng() * open.length) | 0];
        if (greedy) {
          // Net need: holes open in boxes of this colour, minus everything already committed.
          let best = -Infinity;
          for (const i of open) {
            const c = g.tiles[i].color;
            let need = 0;
            for (const b of g.boxes) if (b.stack[0] === c) need += 3 - b.filled;
            const sent =
              g.belt.filter((x) => x === c).length +
              g.pending.filter((x) => x === c).length +
              g.inFlight.filter((x) => x === c).length;
            const v = Math.max(0, need - sent) * 10 + (need > 0 ? 5 : 0) + rng();
            if (v > best) {
              best = v;
              pick = i;
            }
          }
        }
        g.tap(pick);
        taps.push(pick);
        g.arriveAll();
      }
      g.tick();
    }
    if (g.status === "won") return taps;
  }
  return null;
}

/** Exactly how `custom.ts` proves a stored line before keeping it. */
function replayWins(def, taps) {
  const g = new M.Game(def);
  for (const idx of taps) {
    let guard = 0;
    while (!g.canTap(idx) && g.status === "play" && guard++ < 20000) {
      g.arriveAll();
      g.tick();
    }
    if (g.status !== "play") break;
    g.tap(idx);
    g.arriveAll();
  }
  for (let guard = 0; g.status === "play" && guard < 20000; guard++) {
    g.arriveAll();
    g.tick();
  }
  return g.status === "won";
}

// ── pick the easiest share of the run ───────────────────────────────────────
const levels = [];
for (let n = range[0]; n <= range[1]; n++) {
  if (!M.HANDMADE[n]) continue;
  const r = bd(M, M.levelDefFor(n), 20);
  levels.push({ n, score: (r.b + r.d) / 2 });
}
levels.sort((a, b) => b.score - a.score);
const take = Math.max(1, Math.round(levels.length * SHARE));
const chosen = levels.slice(0, take).sort((a, b) => a.n - b.n);
console.log(`${levels.length} level hand-built trong ${range[0]}-${range[1]}, lay ${take} ban de nhat:`);
console.log("  " + chosen.map((c) => `L${c.n} (${Math.round(100 * c.score)}%)`).join("  "));
console.log("");

// ── place the arrows ────────────────────────────────────────────────────────
const out = {};
for (const { n, score } of chosen) {
  const src = M.HANDMADE[n];
  const inner = interior(src);
  let done = null;
  // Seeded, so re-running this produces the same boards.
  const rng = makeRng(n * 104729 + 7);
  const order = inner
    .map((i) => [rng(), i])
    .sort((a, b) => a[0] - b[0])
    .map((x) => x[1]);
  for (let attempt = 0; attempt < 40 && !done; attempt++) {
    const bp = { ...src, cells: src.cells.map((c) => ({ ...c })) };
    const placed = [];
    for (const i of order) {
      if (placed.length >= WANT) break;
      // ⚠ Point it at a **tray**, never at open floor: an arrow whose target is already empty opens
      // on the first settle, so the piece the board was drawn with is one the player never meets.
      const ways = DIRS.filter(
        ([, step, fits]) => fits(i, bp.cols, bp.rows) && bp.cells[step(i, bp.cols)].kind === "tile",
      );
      if (!ways.length) continue;
      const w = ways[(rng() * ways.length) | 0];
      bp.cells[i] = { ...bp.cells[i], arrow: w[0] };
      if (!ringFree(bp)) {
        bp.cells[i] = { ...src.cells[i] };
        continue;
      }
      placed.push(i);
    }
    if (placed.length < Math.min(2, WANT)) continue;
    if (M.checkBlueprint(bp).some((p) => p.fatal)) continue;
    // Belt and braces: the board must not carry a lock the player cannot see.
    if (bp.cells.some((c) => c.kind === "tile" && c.arrow && c.hidden)) {
      throw new Error("mui ten dat nham len khay ? — xem ghi chu trong interior()");
    }
    const probe = M.toLevelDef({ ...bp, refTaps: [] }, n);
    const line = findLine(probe);
    if (!line) continue;
    bp.refTaps = line;
    const def = M.toLevelDef(bp, n);
    if (!def.refTaps.length || !replayWins(def, def.refTaps)) continue;
    done = { bp, placed, def };
  }
  if (!done) {
    console.log(`  L${n}: khong dat duoc mui ten nao giai duoc — bo qua`);
    continue;
  }
  const r = bd(M, done.def, 20);
  const where = done.placed.map((i) => `(${(i % src.cols) + 1},${((i / src.cols) | 0) + 1})`).join(" ");
  console.log(
    `  L${n}: ${done.placed.length} mui ten o ${where}  ·  giai duoc ✓  ·  ` +
      `de ${Math.round(100 * score)}% -> B ${Math.round(100 * r.b)}% D ${Math.round(100 * r.d)}%`,
  );
  out[n] = done.bp;
}

if (!WRITE) {
  console.log("\n(chay lai voi --write de ghi vao handmade.ts)");
} else {
  let src = fs.readFileSync("src/game/handmade.ts", "utf8");
  for (const [n, bp] of Object.entries(out)) {
    const re = new RegExp(`^  ${n}: \\{.*\\},$`, "m");
    if (!re.test(src)) throw new Error(`khong thay dong cho level ${n}`);
    src = src.replace(re, `  ${n}: ${JSON.stringify(bp)},`);
  }
  fs.writeFileSync("src/game/handmade.ts", src);
  console.log(`\nda ghi ${Object.keys(out).length} level vao src/game/handmade.ts`);
}
