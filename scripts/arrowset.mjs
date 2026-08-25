// Build a run of levels by copying an existing run and locking a few trays with arrows.
//
//   node scripts/arrowset.mjs --from 46-85 --to 86 --copies 3 --arrows 5 [--write] [--limit N]
//
// 40 source boards x 3 passes = 120 levels. **Interleaved, not grouped**: pass 1 lays the 40 boards
// down in order, then pass 2 lays the same 40 down again with a different set of locks, then pass 3.
// Grouped the other way the player meets the same layout three times in a row and reads it as the
// game repeating itself; a pass apart, it reads as a board they have seen before with a new problem
// on it, which is the whole idea of the copy.
//
// ⚠ **The copy takes the *resolved* board, not the drawing.** Only 14 of the 40 sources pin their
// box stacks, so the rest are derived on load against the slot's own target — copy the drawing
// alone and the copy is a different level from the one being copied. `levelDefFor` is asked for the
// stacks and they are frozen onto the copy, which also skips `derive` and its bot games at load.
//
// ⚠ **Never an arrow on a face-down tray.** `refreshGrid` draws the badge only on a tray showing
// its colour, so a lock on a `?` is a tray that cannot be tapped with nothing on screen saying why.
// That shipped once and was reported as "tôi có thấy đâu".
//
// ⚠ **Solvability is proved for every board, and it is the only gate** — on instruction, winrate is
// not considered. The proof is a line found here and pinned, replayed through the real engine the
// way `custom.ts` replays a stored line before trusting it. A board that cannot take its full quota
// of locks and still be won drops to fewer locks rather than being skipped, so the run has no gaps.

import fs from "node:fs";
import { loadGame, makeRng } from "./bots.mjs";

const M = await loadGame();
const arg = (k, d = null) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const [FROM, TO_SRC] = (arg("from", "46-85") + "").split("-").map(Number);
const START = Number(arg("to", 86));
const COPIES = Number(arg("copies", 3));
const ARROWS = Number(arg("arrows", 5));
const LIMIT = Number(arg("limit", 0));
const WRITE = process.argv.includes("--write");

const DIRS = [
  ["up", (i, c) => i - c, (i, c, r) => Math.floor(i / c) > 0],
  ["down", (i, c) => i + c, (i, c, r) => Math.floor(i / c) < r - 1],
  ["left", (i, c) => i - 1, (i, c) => i % c > 0],
  ["right", (i, c) => i + 1, (i, c) => i % c < c - 1],
];

/** Trays in the middle of the shape: four neighbours on the board, face-up, not half a pair. */
function interior(bp) {
  const { cols, rows, cells } = bp;
  const out = [];
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
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

/** Would these arrows wait on each other forever? The fixpoint `checkBlueprint` runs. */
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

/** A winning tap order, or null. Greedy first here — these boards are not the easy run. */
function findLine(def, tries) {
  for (let s = 0; s < tries; s++) {
    const rng = makeRng(s * 7919 + 13);
    const greedy = s % 4 !== 0;
    const g = new M.Game(def);
    const taps = [];
    for (let t = 0; g.status === "play" && t < 40000; t++) {
      const open = [];
      for (let i = 0; i < g.tiles.length; i++) if (g.canTap(i)) open.push(i);
      if (open.length) {
        let pick = open[(rng() * open.length) | 0];
        if (greedy) {
          let best = -Infinity;
          for (const i of open) {
            const c = g.tiles[i].color;
            let need = 0;
            for (const b of g.boxes) if (b.stack[0] === c) need += 3 - b.filled;
            const sent =
              g.belt.filter((x) => x === c).length +
              g.pending.filter((x) => x === c).length +
              g.inFlight.filter((x) => x === c).length;
            const v = Math.max(0, need - sent) * 10 + (need > 0 ? 5 : 0) + rng() * 2;
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

/** One copy: the source board, its resolved stacks, and `want` locks that still leave it winnable. */
function build(srcLevel, slot, want, seed) {
  const src = M.HANDMADE[srcLevel];
  const resolved = M.levelDefFor(srcLevel);
  const base = {
    ...src,
    cells: src.cells.map((c) => ({ ...c })),
    columns: resolved.columns.map((c) => [...c]),
    refTaps: [],
  };
  const inner = interior(base);
  const rng = makeRng(seed);
  for (let n = want; n >= 0; n--) {
    for (let attempt = 0; attempt < (n ? 6 : 1); attempt++) {
      const bp = { ...base, cells: base.cells.map((c) => ({ ...c })) };
      const order = inner
        .map((i) => [rng(), i])
        .sort((a, b) => a[0] - b[0])
        .map((x) => x[1]);
      const placed = [];
      for (const i of order) {
        if (placed.length >= n) break;
        const ways = DIRS.filter(
          ([, step, fits]) => fits(i, bp.cols, bp.rows) && bp.cells[step(i, bp.cols)].kind === "tile",
        );
        if (!ways.length) continue;
        bp.cells[i] = { ...bp.cells[i], arrow: ways[(rng() * ways.length) | 0][0] };
        if (!ringFree(bp)) {
          bp.cells[i] = { ...base.cells[i] };
          continue;
        }
        placed.push(i);
      }
      if (placed.length < n) continue;
      if (bp.cells.some((c) => c.kind === "tile" && c.arrow && c.hidden)) {
        throw new Error("mui ten dat nham len khay ?");
      }
      if (M.checkBlueprint(bp).some((p) => p.fatal)) continue;
      const probe = M.toLevelDef({ ...bp, refTaps: [] }, slot);
      const line = findLine(probe, n ? 120 : 400);
      if (!line) continue;
      bp.refTaps = line;
      const def = M.toLevelDef(bp, slot);
      if (!def.refTaps.length || !replayWins(def, def.refTaps)) continue;
      return { bp, count: placed.length };
    }
  }
  return null;
}

// ── build the run ───────────────────────────────────────────────────────────
const sources = [];
for (let n = FROM; n <= TO_SRC; n++) if (M.HANDMADE[n]) sources.push(n);
const total = sources.length * COPIES;
console.log(`${sources.length} ban goc (${FROM}-${TO_SRC}) x ${COPIES} lan = ${total} level, dat vao ${START}-${START + total - 1}`);

const out = {};
const tally = {};
let slot = START;
let done = 0;
const t0 = Date.now();
outer: for (let pass = 0; pass < COPIES; pass++) {
  for (const srcLevel of sources) {
    if (LIMIT && done >= LIMIT) break outer;
    const r = build(srcLevel, slot, ARROWS, slot * 104729 + pass * 7919 + 11);
    if (!r) {
      console.log(`  L${slot} (chep tu ${srcLevel}): KHONG dung duoc`);
    } else {
      out[slot] = r.bp;
      tally[r.count] = (tally[r.count] ?? 0) + 1;
      if (r.count < 3) console.log(`  L${slot} (tu ${srcLevel}): chi dat duoc ${r.count} mui ten`);
    }
    slot++;
    done++;
    if (done % 20 === 0) console.log(`  ... ${done}/${LIMIT || total}  (${Math.round((Date.now() - t0) / 1000)}s)`);
  }
}

console.log(`\nxong ${Object.keys(out).length} level trong ${Math.round((Date.now() - t0) / 1000)}s`);
console.log(
  "so mui ten moi level: " +
    Object.keys(tally)
      .sort((a, b) => b - a)
      .map((k) => `${k} mui ten: ${tally[k]} level`)
      .join("   "),
);

if (!WRITE) {
  console.log("\n(chay lai voi --write de ghi vao handmade.ts)");
} else {
  let src = fs.readFileSync("src/game/handmade.ts", "utf8");
  const lines = [];
  for (const [n, bp] of Object.entries(out)) {
    const re = new RegExp(`^  ${n}: \\{.*\\},$`, "m");
    if (re.test(src)) src = src.replace(re, `  ${n}: ${JSON.stringify(bp)},`);
    else lines.push(`  ${n}: ${JSON.stringify(bp)},`);
  }
  if (lines.length) {
    const at = src.lastIndexOf("\n};");
    src = src.slice(0, at) + "\n" + lines.join("\n") + src.slice(at);
  }
  fs.writeFileSync("src/game/handmade.ts", src);
  console.log(`\nda ghi ${Object.keys(out).length} level vao src/game/handmade.ts`);
}
