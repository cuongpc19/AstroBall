// pairs — build the linked-pair levels, 40-45, to a falling Cuongxs1 curve.
//
//   node scripts/pairs.mjs 40-45 --out block.txt
//
// The brief: every board carries one, two or three **linked pairs** — two trays clipped
// together, each with its own colour, one tap emptying both — and the Cuongxs1 winrate walks
// from about 50% down to about 5% across the six.
//
// ⚠ Why a pair is the difficulty lever here and not just decoration: `load()` on a pair is
// `2 * TRAY_N` = 18 marbles, **half the belt**, in two colours at once. The player cannot tip
// one for the colour they want without also tipping the colour they do not, so every pair is a
// commitment the belt has to absorb. That is a different pressure from anything else on the
// board, and it is why the curve can be walked with pair count alone once the colours are set.
//
// ⚠ A pair is drawn as its **anchor plus a floor cell to its right**. The blueprint stores the
// piece once; `gridDef` silently degrades a pair with no room back to a single tray, so a map
// whose pair slot runs off the silhouette loses the piece without saying so. `slotsFor` refuses
// those rather than placing half a pair.
//
// Scored on Cuongxs1 because that is what the brief names. B and D are printed alongside — a
// level the sampling model finds hard and best play finds trivial is two different levels
// depending on who is holding it, and the printout is the only place that shows up.

import { writeFileSync } from "node:fs";
import { loadGame, rate, best, cuongxs1Rate, playPerfect, D_SLIP } from "./bots.mjs";

const M = await loadGame();
const { HANDMADE, levelDefFor, PALETTE } = M;

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const RANGE = (process.argv[2] || "40-45").split("-").map(Number);
const TRIES = Number(process.env.TRIES || 110);
const SCREEN = Number(process.env.SCREEN || 16);
const CONFIRM = Number(process.env.CONFIRM || 80);

/** Where the curve is asked to land, level -> Cuongxs1 winrate. */
const TARGET = { 40: 0.5, 41: 0.41, 42: 0.32, 43: 0.23, 44: 0.14, 45: 0.05 };
/** How far off target a board may land and still ship. */
const TOL = 0.05;
/**
 * How far **above** the Cuongxs1 target `(B+D)/2` may sit before the board is refused.
 *
 * Below is fine and common — the sampling model reads most boards as easier than best play does.
 * Above is the failure: a board the named model calls hard and every other model calls easy.
 * Matches `GAP_OK` in `tune.mjs`, and for the same reason.
 */
const GAP_OK = 0.2;

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
 * Six **styles**, one per level, each drawn at three sizes.
 *
 *   `.` casing (outside the board)   `_` open cavity floor
 *   `#` tray                        `H` hatch
 *   `<` tray that may become a pair anchor — the cell to its right must be a tray
 *
 * ⚠ **The trays are packed, and the shape is cut out of casing.** This is how levels 1-30 are
 * built and the reason is the escape rule: a packed block has to be peeled from the chute mouth
 * upwards, one open side at a time, which is the puzzle. Trays scattered with gaps between them
 * are all tappable from the first frame — the same tray count, none of the game. The first draft
 * of these six thinned by punching holes and came out exactly that way; `_` now appears only
 * where a hole is the *feature* (the hollow of `khung`).
 *
 * ⚠ **Then difficulty cannot be walked with density, so it is walked with size.** Each style is
 * drawn small / medium / large and the trial picks one, because tray count is the hard constraint
 * here and it is tighter than it looks: a pair is 18 marbles on a belt of 30, so a board the
 * greedy bot could just about drain becomes one it cannot the moment a pair goes on it. A 26-tray
 * packed slab found a winning line with 0 pairs — at peak belt 30/30, already at the limit — and
 * none at all with 1. Grid trays plus hatch queues wants to land around 16-24.
 *
 * ⚠ Every `<` is a *candidate*, and there are more of them than any board uses: the trial picks
 * which become pairs, so one drawing yields visibly different boards rather than one board
 * recoloured.
 */
const MAPS = [
  // Trụ — pillars. Wall columns run the full height, so each pillar drains on its own and the
  // board is really three narrow puzzles that share one belt.
  //
  // ⚠ **Every pillar has to reach the bottom row.** A one-wide pillar walled on both sides and
  // stopping short of it is sealed forever — the drawing that tapered the pillars into a base
  // locked six cells and the only symptom was "no winning line" on every trial.
  {
    style: "tru",
    sizes: [
      ["H.##.#", "#.<#.#", "#.<#.#", "#.##.#"],
      ["H.##.#", "#.<#.#", "#.<#.#", "#.<#.#", "#.##.#"],
      ["H.##.#", "#.<#.#", "#.<#.#", "#.<#.#", "#.<#.#", "#.##.#"],
    ],
  },
  // Thoi — a diamond. Every row is narrower than the one under it, so the shoulders open first
  // and the middle is the last thing to go.
  {
    style: "thoi",
    sizes: [
      ["..H#..", ".<###.", ".####.", "..##.."],
      ["..H#..", ".<###.", "#<####", ".<###.", "..##.."],
      ["...H...", ".<####.", "#<#####", ".<####.", "..###.."],
    ],
  },
  // Hai tháp — two towers split by a wall column. Nothing crosses, so a colour stranded in the
  // wrong tower stays stranded.
  {
    style: "hai-thap",
    sizes: [
      ["H#.##", "#<.<#", "#####", ".###."],
      ["H#.##", "#<.<#", "#<.<#", "#####", ".###."],
      ["H##.##", "#<#.<#", "######", ".####."],
    ],
  },
  // Bậc thang — a staircase. Only the step ends are ever open, so the board unwinds in one order
  // and a pair on a step is a commitment made at a fixed moment.
  {
    style: "bac-thang",
    sizes: [
      ["....H#", "...<##", "..<###", "...##."],
      ["....H#", "...<##", "..<###", ".<####", "..<##."],
      [".....H#", "....<##", "...<###", "..<####", ".<#####", "..<###."],
    ],
  },
  // Khung — a hollow frame, the one style where `_` is the point: the cavity is the only lane
  // through, so the ring is peeled from the inside out as well as the outside in.
  {
    style: "khung",
    sizes: [
      [".H##.", "#<#<#", "#___#", "##<##", ".###."],
      [".H##..", "#<##<#", "#___#_", "##<###", ".####."],
      [".H###.", "#<###<", "#____#", "#____#", "##<###", ".####."],
    ],
  },
  // Khối khoét góc — a solid slab with its corners taken off. The plainest silhouette and the
  // densest: almost nothing is open until the bottom row has gone.
  {
    style: "khoi-khoet-goc",
    sizes: [
      [".H##.", "#<<##", "#####", ".###."],
      [".H##..", "#<<###", "######", ".####.", "..##.."],
      [".H###..", "#<<####", "#######", ".#####."],
    ],
  },
];

for (const m of MAPS) {
  m.sizes = m.sizes.map((art) => {
    const rows = art.length;
    const cols = art[0].length;
    if (art.some((r) => r.length !== cols)) {
      throw new Error(`style ${m.style}: rows differ in width — ${JSON.stringify(art)}`);
    }
    const bad = art.join("").replace(/[.#_H<]/g, "");
    if (bad) throw new Error(`style ${m.style}: unknown glyph ${JSON.stringify(bad)}`);
    const trays = art.join("").replace(/[^#<]/g, "").length;
    const hatches = art.join("").replace(/[^H]/g, "").length;
    const stuck = unpeelable({ art, rows, cols });
    return { art, rows, cols, trays, hatches, total: trays + hatches * 3, stuck };
  });
  const dead = m.sizes.filter((s) => s.stuck.length);
  if (dead.length) {
    for (const s of dead) {
      console.error(`⚠ ${m.style} ${s.cols}x${s.rows}: ${s.stuck.length} o khong bao gio bam duoc`);
      for (let y = 0; y < s.rows; y++) {
        console.error("    " + [...s.art[y]].map((c, x) => (s.stuck.includes(y * s.cols + x) ? "!" : c)).join(""));
      }
    }
    throw new Error(`style ${m.style}: silhouette co o bi nhot vinh vien`);
  }
}

/**
 * Cells this silhouette can never open, by the escape rule alone.
 *
 * ⚠ Worth doing on the drawing rather than waiting for the line search to fail. A one-wide pillar
 * walled on both sides and not reaching the bottom row is **sealed forever** — nothing can ever
 * be tapped beside it and nothing above it, so the level is dead on arrival. The first `tru`
 * drawing had two of those and the only symptom was the builder reporting "no winning line" for
 * every trial, which reads as the target being unreachable rather than as a hole in the art.
 *
 * Peel repeatedly: the bottom row is always open (the chute mouth), and anything with a cleared
 * cell beside it opens next. Hatch cells count as solid — conservative, since a hatch does retire
 * once its queue empties, so a warning here is worth reading rather than obeying blindly.
 */
function unpeelable(size) {
  const { art, rows, cols } = size;
  const solid = new Array(rows * cols).fill(false);
  const tray = new Array(rows * cols).fill(false);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const ch = art[y][x];
      const i = y * cols + x;
      // ⚠ Casing is **solid**, not an exit — `cellFree` says so, and the whole point of a walled
      // board is that its edge is not a way out. Only `_`, an open cavity cell, is free.
      solid[i] = ch !== "_";
      tray[i] = ch === "#" || ch === "<";
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

if (process.argv.includes("--maps")) {
  for (const m of MAPS) {
    console.log(m.style);
    for (const s of m.sizes) {
      console.log(`  ${s.cols}x${s.rows}  ${String(s.trays).padStart(2)} khay + ${s.hatches * 3} trong cua xa = ${s.total}`);
      for (const row of s.art) console.log("    " + row);
    }
  }
  process.exit(0);
}

/** Cells of the map, tagged: "wall" outside the silhouette, "hole" open floor, else a tray. */
function layout(map) {
  const out = [];
  for (let y = 0; y < map.rows; y++) {
    for (let x = 0; x < map.cols; x++) {
      const ch = map.art[y][x];
      if (ch === ".") out.push({ kind: "wall" });
      else if (ch === "_") out.push({ kind: "hole" });
      else if (ch === "H") out.push({ kind: "hatch" });
      else out.push({ kind: "tray", x, y, slot: ch === "<" });
    }
  }
  return out;
}

/**
 * Pick `want` pair anchors from the map's candidates.
 *
 * ⚠ Both cells must be plain tray cells, and no two pairs may touch end to end — a pair whose
 * right cell is another pair's anchor would have `anchorAt` handing taps on one piece to the
 * other. Refusing here is the difference between a piece that is missing and a piece that is
 * wrong.
 */
function slotsFor(map, base, r, want) {
  const cands = [];
  base.forEach((c, a) => {
    if (!c.slot) return;
    // Not off the right-hand edge, and the cell it claims must be a plain tray.
    if (a % map.cols === map.cols - 1) return;
    if (base[a + 1]?.kind !== "tray") return;
    cands.push(a);
  });
  const taken = new Set();
  const out = [];
  for (const a of shuffled(r, cands)) {
    if (out.length >= want) break;
    if (taken.has(a) || taken.has(a + 1) || taken.has(a - 1)) continue;
    taken.add(a);
    taken.add(a + 1);
    out.push(a);
  }
  return out;
}

/** A drawing: the map's trays coloured from `pool`, with `want` of them clipped into pairs. */
function draw(map, seed, pool, opt) {
  const r = rng32(seed);
  const base = layout(map);
  const cols = map.cols;
  const pick = () => pool[(r() * pool.length) | 0];
  const anchors = slotsFor(map, base, r, opt.pairs);
  const mates = new Set(anchors.map((a) => a + 1));

  // ⚠ No thinning knob. Punching holes into the block to lighten it is what made the first six
  // boards read as loose confetti — the size variants carry that job now, so a light board is a
  // *smaller* packed block rather than the same block with bites out of it.
  const cells = base.map((c, i) => {
    if (c.kind === "wall") return { kind: "wall" };
    if (c.kind === "hole") return { kind: "floor" };
    if (c.kind === "hatch") {
      const q = [0, 1, 2].map(pick);
      return { kind: "hatch", queue: q, hiddenQ: q.map(() => r() < opt.hiddenQ), dir: "down" };
    }
    // The pair's right cell is floor in the drawing: the piece is stored once, at its anchor.
    if (mates.has(i)) return { kind: "floor" };
    if (anchors.includes(i)) {
      // ⚠ Two colours, and they must **differ**. Drawing both halves the same is what one trial
      // shipped for level 44: the piece is then an ordinary double-load tray wearing a clip, and
      // the only thing a linked pair is for — one tap committing to two colours at once — is
      // gone. Picking twice at random hands that out roughly one board in six.
      const color = pick();
      let mate = pick();
      for (let n = 0; n < 8 && mate === color && pool.length > 1; n++) mate = pick();
      return {
        kind: "tile",
        color,
        mate,
        wide: true,
        hidden: opt.hidePairs && r() < opt.hidden,
      };
    }
    return { kind: "tile", color: pick(), hidden: r() < opt.hidden };
  });
  return { cols, rows: map.rows, cells, boxHiddenFrac: opt.hiddenBox };
}

function scoreAll(def, n) {
  const b = best(M, def, n);
  const d = rate(M, def, "greedy", n, D_SLIP);
  return { B: b, D: d, BD: (b + d) / 2, CX: cuongxs1Rate(M, def, n).rate };
}

/** How many linked pairs the finished board actually carries. */
function pairCount(def) {
  return def.tiles.filter((t) => t && t.wide).length;
}

const [lo, hi] = RANGE;
console.log(`Khay doi: ${hi - lo + 1} level ${lo}-${hi}, ${TRIES} bien the/level.`);
console.log(`Muc tieu Cuongxs1: ${Object.entries(TARGET).map(([k, v]) => `L${k} ${Math.round(v * 100)}%`).join("  ")}`);
console.log("");

const out = {};
for (let level = lo; level <= hi; level++) {
  const want = TARGET[level] ?? 0.05;
  // ⚠ Keyed off the level, not the position in the range, so re-running one level on its own
  // gets the silhouette it shipped with rather than index 0's.
  const style = MAPS[level % MAPS.length];
  let picked = null;
  let built = 0;
  // ⚠ Counted, not guessed at. A map whose pair slots run off its own silhouette produces zero
  // valid boards and the loop reports only "none" — which reads as the target being out of
  // reach when the real fault is the drawing.
  const why = { threw: 0, noline: 0, nopair: 0 };

  for (let t = 0; t < TRIES; t++) {
    const r = rng32(level * 7919 + t * 104729 + 11);
    // The knobs, swept per trial. **Size** is the coarse one — marbles per level is trays × 9
    // against a belt of 30, so one size step outweighs any amount of recolouring — then colour
    // count and face-down share, then pair count.
    const map = style.sizes[(t / 4) % style.sizes.length | 0];
    const opt = {
      pairs: 1 + (t % 3),
      hidden: [0, 0.15, 0.3, 0.45][t % 4],
      hiddenQ: [0, 0.35, 0.6][t % 3],
      hiddenBox: 0.5,
      hidePairs: level >= 43,
    };
    const pool = shuffled(r, PALETTE.map((_, i) => i)).slice(0, 5 + (t % 3));
    const bp = draw(map, level * 31 + t, pool, opt);

    let def;
    try {
      HANDMADE[level] = bp;
      def = levelDefFor(level);
    } catch {
      why.threw++;
      continue;
    }
    // The generator's own recorded line has to clear the real engine, and the board has to
    // actually carry the piece it was built for.
    if (!def.refTaps?.length || !playPerfect(M, def).win) {
      why.noline++;
      continue;
    }
    if (pairCount(def) < 1) {
      why.nopair++;
      continue;
    }
    built++;

    // Two-stage, or the winner's curse eats the result: screen cheaply, and only re-measure
    // properly the boards that look like they landed.
    const quick = scoreAll(def, SCREEN);
    if (picked && Math.abs(quick.CX - want) > 0.25) continue;
    const s = scoreAll(def, CONFIRM);
    // ⚠ A floor on best play, not on Cuongxs1. The brief names a Cuongxs1 curve, and a board can
    // land it while being a board *nobody* wins — one trial measured Cuongxs1 at 30% with B and D
    // both at 0/20. Solvable is not playable, and a level whose reference line is the only line
    // is the failure `playableRate` exists to catch.
    if (s.B < 0.1) continue;
    // ⚠ And a ceiling on the *other* ruler. The cost only scores Cuongxs1, so nothing stopped a
    // board reading 5% there while best play and slip-0.25 both cleared it a third of the time —
    // which is what the first two-pair level 45 did: Cuongxs1 5%, (B+D)/2 34%, i.e. the same
    // board difficulty as level 41 in every lens but one. A level whose two rulers disagree by
    // 29 points is two different levels depending on who is holding it, and the last level on
    // the ladder is the worst place to ship that.
    if (s.BD > want + GAP_OK) continue;
    // ⚠ A small bribe for carrying more than one pair, worth one point of target accuracy each.
    // Left alone the search picks a single pair on every board — two is 36 marbles of commitment
    // on a belt of 30 and it fails the line search far more often, so a straight cost comparison
    // never sees a two-pair board it likes. The brief asks for one, two *or* three; this is what
    // stops all six coming out the same.
    // ⚠ `err` kept apart from `cost`. The bribe makes cost a ranking number, not a distance, and
    // reporting it as "how far off target" would understate every multi-pair board.
    const err = Math.abs(s.CX - want);
    const cost = err - 0.01 * (pairCount(def) - 1);
    if (!picked || cost < picked.cost) picked = { bp, def, s, cost, err, opt, map };
    if (err <= 0.02 && pairCount(def) > 1) break;
  }

  if (!picked) {
    delete HANDMADE[level];
    console.log(
      `L${level}: khong dung duoc board nao — ${built} hop le, ` +
        `${why.threw} loi dung board, ${why.noline} khong co duong thang, ${why.nopair} mat khay doi.`,
    );
    continue;
  }
  HANDMADE[level] = picked.bp;
  out[level] = picked.bp;
  const p = (x) => String(Math.round(x * 100)).padStart(3) + "%";
  const s = picked.s;
  const qs = picked.bp.cells.filter((c) => c.kind === "tile" && c.hidden).length;
  const flag = picked.err > TOL ? "  <-- lech muc tieu" : "";
  console.log(
    `L${level}: ${style.style} ${picked.bp.cols}x${picked.bp.rows}, ${picked.map.trays} khay, ` +
      `${pairCount(picked.def)} khay doi, ${qs} khay ? | ` +
      `Cuongxs1 ${p(s.CX)} (dich ${p(want)}) | B ${p(s.B)} D ${p(s.D)} (B+D)/2 ${p(s.BD)}${flag}`,
  );
  for (const row of picked.map.art) console.log("      " + row);
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
