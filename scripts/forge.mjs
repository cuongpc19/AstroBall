// forge — build hand-built levels to a difficulty brief.
//
// Takes the *map* of an existing drawing — where the walls, crates, hatches and floor are — and
// re-rolls everything the map does not fix: which colour sits on each tray, which trays start
// face-down, what each hatch holds. The box stacks then come from `toLevelDef`, which aims them
// at the level's target, so the three levers the brief named (colours, `?` trays, box order) are
// all in play at once.
//
//   node scripts/forge.mjs 26-30 --from 20,24,25 --under 0.20
//
// ⚠ It searches, it does not design. The map is the part a person drew and this never touches it;
// everything it changes is the part that was arbitrary anyway.
//
// ⚠ Every candidate has to stay winnable. A board no one can clear is not a hard level, it is a
// broken one, and the check is `refTaps` — the winning line `toLevelDef` recorded while building
// the boxes. No line, no ship.

import { writeFileSync } from "node:fs";
import { loadGame, rate, best, cuongxs1Rate, playPerfect, D_SLIP } from "./bots.mjs";

const M = await loadGame();
const { HANDMADE, levelDefFor, PALETTE } = M;

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const RANGE = (process.argv[2] || "26-30").split("-").map(Number);
const FROM = arg("from", "20,24,25").split(",").map(Number);
const UNDER = Number(arg("under", 0.2));
const TRIES = Number(process.env.TRIES || 60);
const SCREEN = Number(process.env.SCREEN || 24);
const CONFIRM = Number(process.env.CONFIRM || 100);
/** No model may sit under this. Below it the level stops rewarding play and starts rewarding luck. */
const FLOOR = Number(process.env.FLOOR || 0.05);

function rng32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A variant of `src`: same map, new colours and new face-down trays.
 *
 * `colors` is how many of the palette are in play — more colours means each one has fewer boxes
 * open for it at any moment, which is the single strongest lever there is. `hidden` is the share
 * of trays that start face-down; most of them flip on the first frame unless the block is packed,
 * so it is a weak lever on its own and a real one on a dense map.
 */
function variant(src, seed, colors, hidden) {
  const r = rng32(seed);
  const pick = () => (r() * colors) | 0;
  return {
    cols: src.cols,
    rows: src.rows,
    cells: src.cells.map((c) => {
      if (c.kind === "tile") return { kind: "tile", color: pick(), hidden: r() < hidden };
      if (c.kind === "hatch") {
        const queue = (c.queue ?? []).map(pick);
        return { kind: "hatch", queue, hiddenQ: queue.map(() => r() < hidden), dir: c.dir ?? "down" };
      }
      return { ...c };
    }),
  };
}

/** Every model, on one board. The brief is a ceiling on all of them, so all of them get measured. */
function scoreAll(def, n) {
  const b = best(M, def, n);
  const d = rate(M, def, "greedy", n, D_SLIP);
  const cx = cuongxs1Rate(M, def, n).rate;
  return {
    B: b, D: d, BD: (b + d) / 2, CX: cx,
    worst: Math.max(b, d, (b + d) / 2, cx),
    least: Math.min(b, d, (b + d) / 2, cx),
  };
}

const [lo, hi] = RANGE;
const want = hi - lo + 1;
console.log(`Dung ${want} level ${lo}-${hi} tu map cua ${FROM.join(", ")}. Muc tieu: MOI mo hinh < ${Math.round(UNDER * 100)}%.`);
console.log(`Bang mau co ${PALETTE.length} mau. ${TRIES} bien the/level, sang loc ${SCREEN} van, xac nhan ${CONFIRM} van.`);
console.log("");

const out = {};
for (let k = 0; k < want; k++) {
  const level = lo + k;
  const src = HANDMADE[FROM[k % FROM.length]];
  let bestPick = null;

  for (let t = 0; t < TRIES; t++) {
    // Walk the levers rather than rolling them: colour count is the strongest, so sweep it, and
    // let the seed vary everything else.
    const colors = Math.min(PALETTE.length, 6 + (t % 3));
    const hidden = 0.15 + ((t % 4) * 0.15);
    const bp = variant(src, level * 7919 + t * 104729 + 13, colors, hidden);
    // ⚠ Build it the way the game will, by putting the drawing where the game looks for it and
    // asking `levelDefFor`. Calling `toLevelDef` with a target of my own choosing measured a
    // board nobody would ever be served: the box-order search aims at `targetWin(level)`, and a
    // target of 0.12 picked a different stack order than the shipped 0.15 — level 26 measured at
    // 19% and shipped at 63%.
    let def;
    try {
      HANDMADE[level] = bp;
      def = levelDefFor(level);
    } catch {
      continue;
    }
    // ⚠ Winnable first. Everything else is a number about a board nobody can clear otherwise.
    if (!def.refTaps?.length || !playPerfect(M, def).win) continue;

    const quick = scoreAll(def, SCREEN);
    if (quick.worst > UNDER + 0.12) continue;
    const s = scoreAll(def, CONFIRM);
    // Under the ceiling, as close under it as possible, and **not a lottery**.
    //
    // ⚠ The ceiling alone is not enough. The first pass produced a level whose worst model read
    // 17% and whose best play read **3%** — a board where planning buys almost nothing and the
    // wins are luck. That satisfies "every model under 20" and is not a hard level, it is a wall.
    // So the floor matters too: every model has to clear FLOOR, and among the candidates that do,
    // the one whose spread is tightest under the ceiling wins.
    const ok = s.worst < UNDER && s.least >= FLOOR;
    const rank = ok ? UNDER - s.worst + (UNDER - s.least) * 0.5 : 10 + s.worst - s.least;
    if (!bestPick || rank < bestPick.rank) bestPick = { bp, def, s, rank, colors, hidden };
    if (ok && UNDER - s.worst < 0.04 && s.least > UNDER - 0.1) break;
  }

  if (!bestPick) {
    delete HANDMADE[level];
    console.log(`L${level}: khong tim duoc bien the nao dat.`);
    continue;
  }
  // Leave the winner in place: the next level's search must see the same table the game will.
  HANDMADE[level] = bestPick.bp;
  const p = (x) => String(Math.round(x * 100)).padStart(3) + "%";
  const s = bestPick.s;
  console.log(
    `L${level}: ${bestPick.colors} mau, ${Math.round(bestPick.hidden * 100)}% khay ? | ` +
      `B ${p(s.B)}  D ${p(s.D)}  (B+D)/2 ${p(s.BD)}  Cuongxs1 ${p(s.CX)}  -> ${p(s.least)}..${p(s.worst)}` +
      (s.worst < UNDER ? "  ✓" : "  ⚠ chua dat"),
  );
  out[level] = bestPick.bp;
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
