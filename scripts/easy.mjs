// easy — build a run of gentle levels to a Cuongxs1 floor, with a fixed feature mix.
//
//   node scripts/easy.mjs 86-115 --out block.txt      # the 30-level easy run
//   node scripts/easy.mjs 6 --floor 0.80 --out l6.txt # one level, its own floor
//   node scripts/easy.mjs 86-115 --maps               # just print the silhouettes
//
// The brief: 30 easy levels, Cuongxs1 above 90%, every one carrying at least one hatch, boards
// 5x5 or 6x6, four or five silhouettes, and a fixed mix of features —
// 10% linked pairs, 60% "?" trays, 10% crates, 10% chocolate boxes.
//
// ⚠ Scored on **Cuongxs1**, because that is the model the brief names. B and D are measured and
// printed alongside but never optimised: on easy boards the three models agree closely, and the
// moment they stop agreeing the printout is the only place it shows.
//
// ⚠ A **floor**, not a target. "Above 90%" is one-sided, so the cost is the distance below the
// floor and anything above it is free. Aiming at 0.95 as a *target* would actively reject the
// 100% boards, which is the opposite of what an easy run wants.
//
// ⚠ The mix is exact and assigned per level, not sampled. 3 + 18 + 3 + 3 = 27 of 30, and the
// remaining 3 are deliberately plain — a run where every board has a gimmick has no baseline to
// read the gimmicks against.

import { writeFileSync } from "node:fs";
import { loadGame, rate, best, cuongxs1Rate, playPerfect, D_SLIP } from "./bots.mjs";

const M = await loadGame();
const { HANDMADE, levelDefFor, PALETTE, TRAY_N, BOX_SLOTS } = M;

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : dflt;
};
const RANGE = (process.argv[2] || "86-115").split("-").map(Number);
/**
 * `--levels 32,33,41`: build exactly these, instead of a contiguous range.
 *
 * ⚠ For rebuilding a scatter of levels inside a finished ladder. The 19 boards that came out
 * under 15 trays are not contiguous, and running the range form over 32-71 would rebuild the 21
 * levels in between that were never asked about.
 */
const LEVELS = arg("levels", "") ? arg("levels", "").split(",").map(Number) : null;
const FLOOR = Number(arg("floor", 0.9));
/**
 * `--target X`: aim **at** X rather than above `--floor`.
 *
 * ⚠ A floor and a target are different jobs and the cost function has to say which. A floor is
 * one-sided — anything above it is free — which is right for an easy run and wrong for a rebuild:
 * asked to lift a 100% board to "around 85%", a floor of 0.85 accepts the 100% board unchanged and
 * reports success. Overshooting has to cost as much as falling short.
 */
const TARGET = Number(arg("target", 0));
const TRIES = Number(process.env.TRIES || 140);
const SCREEN = Number(process.env.SCREEN || 16);
const CONFIRM = Number(process.env.CONFIRM || 80);

/**
 * How far the other ruler may sit **below** the Cuongxs1 reading before the board is refused.
 *
 * The mirror of `GAP_OK` in `pairs.mjs`, flipped because the brief is flipped. There the risk was
 * a board the named model calls hard and everything else calls easy; here it is a board Cuongxs1
 * breezes through while best play or careless play does not — an "easy" level that is only easy
 * for the one model it was measured with.
 */
const GAP_OK = 0.15;

/**
 * `--ruler bd`: aim at **(B+D)/2** instead of Cuongxs1.
 *
 * ⚠ Not a preference — the two rulers disagree by up to 50 points on one board (measured here:
 * L85 reads Cuongxs1 74% and (B+D)/2 11%, L75 reads 34% and 64%), so which one a rebuild is aimed
 * at *is* the brief. Cuongxs1 is right when the brief names it, as the 86-115 run's did. (B+D)/2
 * is right when a level is being re-aimed inside the shipped ladder, because that is the ruler
 * `TARGET`, `targetWin` and `npm run sim` are all defined on — aiming at the other one and then
 * reading the result off `sim` is the "check both sides are the same metric" trap CLAUDE.md
 * records three times over.
 */
const RULER = arg("ruler", "cx") === "bd" ? "BD" : "CX";

/**
 * `--minb X`: refuse any board whose **best play** scores below X.
 *
 * ⚠ The guard that a low target needs and a floor does not. Aiming at 10% says nothing about
 * whether 10% is the shape of a hard board or of a broken one: L105 and L110 currently read 1% on
 * (B+D)/2 with best play at 1% and 3%, which is not a difficult level but one no line wins. The
 * same lesson `pairs.mjs` records — it floors best play at 10% because a board can land the named
 * model's curve while being a board *nobody* clears.
 */
const MIN_B = Number(arg("minb", 0));

/**
 * `--maxgap X`: under `--ruler bd`, refuse a board Cuongxs1 reads more than X above the aim.
 *
 * ⚠ The difference between a level that is hard to *plan* and one that is merely hard to *see*.
 * Cuongxs1 is an oracle — it reads face-down trays and hatch queues — so the gap between it and
 * (B+D)/2 is precisely the share of a board's difficulty that is hidden information. Left
 * unguarded, aiming at 10% happily returns a board of face-down trays that any player who could
 * see them would walk through: level 10 came back at (B+D)/2 21% with Cuongxs1 at 78%. That is
 * cheap difficulty, and it is the kind that reads as unfair rather than as hard.
 */
const MAX_GAP = Number(arg("maxgap", 0));

/**
 * `--hidden X`: pin the share of trays drawn face-down instead of sweeping 0.25 / 0.40 / 0.55.
 *
 * ⚠ For a level the sweep cannot get low enough on its own. The sweep's job is to *find* a board
 * near a target, and it stops at the first setting that lands — which means a board asked for 6%
 * and stuck at 12% never sees the high end of the range at all. Pinning it high is a different
 * request: make this board harder to *read*, then find the winrate from there.
 *
 * ⚠ The share is of the drawing, not of the finished board. A "?" tray with a way out is face-up
 * before the first frame — that is the reveal rule, and it is why 0.7 here does not put 70% of the
 * board face-down. The printed `N?` counts what survives settling, which is the only number worth
 * reading.
 */
const WANT_HIDDEN = Number(arg("hidden", 0));

/**
 * `--pairs N` and `--withchoc`: put linked pairs and a chocolate box on the board **on top of**
 * whatever `--feature` it was assigned.
 *
 * ⚠ These break the one-feature-per-board rule this script was written around, deliberately and
 * only when asked. That rule exists so the 86-115 run can read what each feature costs; it is the
 * wrong rule for a level being driven to a winrate the plain levers cannot reach, because these
 * two are by far the heaviest things in the game and everything else has already been spent.
 *
 * A linked pair is `2 * TRAY_N` = 18 marbles out of two cells on one tap — **more than half a
 * 30-slot belt**. CLAUDE.md measures two forced pairs taking level 20 from 74% to 43% and level 28
 * from 88% to 35%. A chocolate box locks four trays behind a counter, so it blocks escape lanes and
 * "?" reveals for everything around it until enough trays have been poured.
 *
 * ⚠ Expect more rejected candidates, not fewer. The same note records a 26-tray packed slab that
 * had a winning line with no pairs and **none at all with one** — a packed board plus a pair is
 * often simply unwinnable, and `playPerfect` throws those away. Raise TRIES rather than reading a
 * failed run as "the target is unreachable".
 */
/**
 * `--mintrays N`, `--minhidden N`, `--minhatch N`: **reject** any board under these, rather than
 * merely preferring boards near them.
 *
 * ⚠ `--trays` is a *tiebreak* — it nudges the cost by 0.002 per tray, so a board one tray short
 * that lands the winrate beats a board on size that misses by a point. Asked for 22 trays it came
 * back with 21 and reported success, because by its own arithmetic that was the better board. A
 * floor is a different instruction: below it the board does not exist, whatever it scores.
 *
 * ⚠ Counted the way the player meets them — grid tiles (a linked pair is two), plus hatch queues,
 * plus the four trays parked under a chocolate lid. That is the same count `table.mjs` prints, and
 * counting only the grid understates a two-hatch board by six.
 */
const MIN_TRAYS = Number(arg("mintrays", 0));
const MIN_HIDDEN = Number(arg("minhidden", 0));
const MIN_HATCH = Number(arg("minhatch", 0));

const WANT_PAIRS = Number(arg("pairs", 0));
const WITH_CHOC = process.argv.includes("--withchoc");

/**
 * `--choc1`: draw the chocolate box **single-colour** — both ribbons and all four trays under it
 * in one colour — instead of the rainbow border this script has always used.
 *
 * ⚠ A single-colour counter counts only trays of *its* colour, and **the four trays it is sitting
 * on cannot be tapped while it is shut**, so they never count toward opening it. The number has to
 * be reachable from the trays outside the box, hatch queues included. `isWon` refuses to finish
 * while any lid is still on the board, so a counter one too high is not a hard level — it is an
 * unwinnable one, and nothing on screen says so. `keeps()` below counts the real supply and throws
 * the board away if it is short. That check is the only reason this flag is safe to have.
 *
 * ⚠ Design convention, not an engine rule: a single-colour box holds four trays of its own colour.
 * The ribbons are how the player is told which kind it is, so they must agree with what is under
 * the lid.
 */
const CHOC_ONE = process.argv.includes("--choc1");

/**
 * `--nohatch` turns every `H` in the maps into an ordinary tray.
 *
 * ⚠ For levels *below* where the hatch is introduced. The shipped run has no hatch until level 8,
 * so rebuilding level 6 with one would teach a mechanic two levels early — an easier board that is
 * also a worse one. The brief's "at least one hatch" applies to the 86-115 run, not to everything
 * this script can build.
 */
const NO_HATCH = process.argv.includes("--nohatch");
/** `--trays N`: aim the size tiebreak at N trays (grid + hatch queues) instead of at the smallest. */
const WANT_TRAYS = Number(arg("trays", 0));
/**
 * `--colors N`: pin the palette size instead of letting the sweep pick 3, 4 or 5.
 *
 * ⚠ For a level being slotted into an existing ladder, where the neighbours' colour count is part
 * of the design rather than something to be searched. The sweep is free to hand back a 3-colour
 * board because 3 colours score well against a floor — and a board that is easier than the level
 * *before* it is a step backwards in the run however good its winrate looks.
 */
const WANT_COLORS = Number(arg("colors", 0));
/**
 * `--style khoi`: use one silhouette instead of trying all of them in rotation.
 *
 * ⚠ For a level whose *shape* is the thing being specified. The rotation stops at the first style
 * that clears the floor, and "clears the floor" says nothing about how the board reads: a two-tower
 * board opens exactly one tray per tower, so it scores 100% while offering the player no choice at
 * all. That is a fine board and a poor level-2, and no winrate can tell the two apart.
 */
const WANT_STYLE = arg("style", "");
/**
 * `--big` swaps in the heavy silhouettes.
 *
 * ⚠ The default maps top out around 16 trays **on purpose** — a tray is `TRAY_N` marbles against a
 * belt of 30, so the easy run needs a board that is mostly casing. Asking those maps for 24 trays
 * cannot work: `--trays` only moves the size tiebreak, it cannot conjure cells the drawing does not
 * have, and the request comes back with the biggest board on file and no warning that it missed.
 */
const BIG = process.argv.includes("--big");

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
 * Five silhouettes, each drawn 5x5 and 6x6.
 *
 *   `.` casing (outside the board)   `_` open cavity floor
 *   `#` tray                        `H` hatch
 *   `<` tray that may become a pair anchor — the cell to its right must be a tray
 *
 * ⚠ **Every map carries an `H`.** The brief asks for it on all 30, and a hatch is not decoration
 * here: it holds `DISPENSER_HOLD` trays that arrive one at a time, so it is the one piece that
 * keeps a *small* board from being fully readable on the first frame. Without it an eight-tray
 * easy board is a list of buttons.
 *
 * ⚠ **Packed trays, shape cut out of casing** — the same rule `pairs.mjs` records. Trays scattered
 * with gaps are all tappable from the first frame: the same tray count and none of the game. `_`
 * appears only where the hole is the feature (the middle of `khung`).
 *
 * ⚠ **These are deliberately light.** A tray is `TRAY_N` = 9 marbles against a belt of 30, so a
 * packed 6x6 is 36 trays and 324 marbles — an order of magnitude past anything that reads as easy.
 * Grid trays plus hatch queues wants to land around 9-16 here, which is why a 6x6 board is mostly
 * casing. The size pair is the coarse difficulty knob; colour count is the fine one.
 */
const MAPS_LIGHT = [
  // Khối — a solid slab with the corners taken off. The plainest shape and the densest: the
  // baseline the other four are read against.
  // ⚠ Every shape **sits on the grid's last row**. Blank rows go at the top, never the bottom:
  // the last row is the chute mouth and the only edge that is an exit, so a shape floating above
  // an all-casing bottom row is sealed and the level is dead on arrival.
  {
    style: "khoi",
    sizes: [
      [".....", ".H#..", ".###.", ".###.", "..#.."],
      ["......", "......", "..H#..", ".<###.", ".####.", "..##.."],
    ],
  },
  // Bậc thang — a staircase. Only the step ends are ever open, so it unwinds in one order.
  {
    style: "bac-thang",
    sizes: [
      [".....", "...H#", "...##", "..<##", "...#."],
      ["......", "......", "....H#", "...<##", "..<###", "...##."],
    ],
  },
  // Thoi — a diamond. Each row narrower than the one below, so the shoulders open first and the
  // middle is the last thing to go.
  {
    style: "thoi",
    sizes: [
      ["..H..", ".<#..", ".###.", ".###.", "..#.."],
      ["......", "..H#..", ".<##..", "#<###.", ".<##..", "..#..."],
    ],
  },
  // Hai tháp — two towers split by a wall column. Nothing crosses, so a colour stranded in the
  // wrong tower stays stranded.
  //
  // ⚠ Both towers have to reach the last row. A tower stopping short is walled on three sides and
  // sealed forever — the failure `pairs.mjs` records against its tapered pillars.
  {
    style: "hai-thap",
    sizes: [
      [".....", "H#.#.", "#<.#.", "##.#.", ".#.#."],
      ["......", "......", "......", "H<#.<#", ".##.#.", "..#.#."],
    ],
  },
  // Khung — a hollow frame, the one style where `_` is the point: the cavity is the only lane
  // through, so the ring peels from the inside out as well as the outside in.
  {
    style: "khung",
    sizes: [
      [".....", ".H#..", ".###.", ".#_#.", ".###."],
      ["......", "......", ".H##..", ".####.", ".#__#.", ".####."],
    ],
  },
];

/**
 * The heavy set (`--big`): packed 6x6 and 7x6, 21-24 trays before the hatch queue.
 *
 * ⚠ These exist because a *rebuild* is not a fresh easy run. The light set above is deliberately
 * mostly casing; asked for 24 trays it can only hand back its largest board, which is 16. Density
 * is the whole point here — the complaint these answer is boards that *look* empty, and a board
 * whose trays are hidden in a hatch queue looks exactly as empty as before however the total reads.
 *
 * ⚠ Still packed, still sitting on the grid's last row. A heavier board is a *bigger slab*, never
 * the same slab with holes punched in it: gaps make every tray tappable from the first frame,
 * which is the same tray count and none of the game.
 */
const MAPS_HEAVY = [
  // Khối nhỏ — a packed 5x5, and the only heavy map that is not 6 or 7 wide.
  //
  // ⚠ It exists for the **early** levels. Levels 8 and 10 are packed 5x5 boards of ~20 trays, and
  // the rest of this set starts at 6x6 — rebuilding one of them from those maps hands level 8 a
  // board wider than level 20's, which reads as the ladder jumping rather than as the level
  // getting harder. The light set cannot do it either: its 5x5s are mostly casing and top out
  // around 11 trays, under the sheet's floor of 14.
  {
    style: "khoi-nho",
    sizes: [
      [".....", "H####", "#####", "#####", ".####"],
      [".....", ".H###", "#<###", "#####", "#####"],
      [".....", "H####", "#####", "#####", "#####"],
      ["....#", "H####", "#<###", "#####", "#####"],
    ],
  },
  // Khối nặng — the plain slab, and the densest thing here.
  {
    style: "khoi-nang",
    sizes: [
      ["......", ".H###.", ".<####", ".#####", ".<####", "..###."],
      [".......", ".H####.", ".<#####", ".######", ".<#####", "..####."],
    ],
  },
  // Bậc nặng — a staircase widening downward; only the step ends open.
  {
    style: "bac-nang",
    sizes: [
      ["......", "...H##", "..<###", ".<####", "######", "..####"],
      [".......", "....H##", "..<####", ".<#####", "#######", "..#####"],
    ],
  },
  // Thoi nặng — a diamond. Shoulders open first, the middle goes last.
  {
    style: "thoi-nang",
    sizes: [
      ["..H#..", ".<###.", "######", "#<####", ".<###.", "..##.."],
      ["...H#..", "..<####", ".<#####", "#######", ".<#####", "..####."],
    ],
  },
  // Khung nặng — a slab with a cavity through it, the one place `_` earns its keep.
  {
    style: "khung-nang",
    sizes: [
      ["......", ".H###.", ".<####", ".#__##", ".<####", ".#####"],
      [".......", ".H####.", ".<#####", ".#__###", ".<#####", ".######"],
    ],
  },
  // Khối to — the largest board this set will draw: 32 and 36 trays on a 7x6.
  //
  // ⚠ It exists for a target the rest of the set cannot reach. At 29 trays the heavy maps bottom
  // out around 10% on (B+D)/2 while best play still clears 20% — the belt is 30 slots and a board
  // that size simply cannot be made to jam more often without taking the winning line away
  // entirely. More trays is the honest lever: 36 trays is 324 marbles through a 30-slot rail.
  //
  // ⚠ Six rows, not seven. A 7x7 board is inside `GRID_MAX` and `gridMetrics` shrinks the cells to
  // fit it, but nothing shipped has ever been 7 rows — every art decision in this project was
  // settled against 5, and 6 is as far as the ladder has actually been driven. A silhouette is not
  // the place to find out what a 57px cell looks like.
  {
    style: "khoi-to",
    sizes: [
      [".......", ".H#####", "#<#####", "#######", "#<#####", "..#####"],
      ["......#", "H######", "#<#####", "#######", "#<#####", "#######"],
    ],
  },
  // Khối hai cửa — the only silhouette here with **two** hatches, and the only one that reaches
  // 33 and 39 trays.
  //
  // ⚠ Both hatches sit with a tray directly beneath them. A hatch pushes into the cell below and
  // that cell has to be floor the queue can reach; a hatch over casing holds three trays nothing
  // can ever collect, which is an unwinnable level rather than a hard one.
  //
  // ⚠ A hatch cell is solid to the escape rule and is **not** a tray, so it never opens a lane for
  // its neighbours the way a tapped tray does. Two of them buried inside the slab would seal the
  // cells around them permanently — that is why both sit on the top edge.
  {
    style: "khoi-hai-cua",
    sizes: [
      [".......", ".H###H.", "#<#####", "#######", "#<#####", "..#####"],
      ["...H..#", "H######", "#<#####", "#######", "#<#####", "#######"],
    ],
  },
  // Hai tháp nặng — two blocks split by a casing column. Nothing crosses, so a colour in the
  // wrong tower stays there. ⚠ Both towers reach the last row or the short one is sealed.
  {
    style: "thap-nang",
    sizes: [
      ["......", "H###.#", "<###.#", "####.#", "<###.#", ".###.#"],
      [".......", "H####.#", "<####.#", "#####.#", "<####.#", ".####.#"],
    ],
  },
];

const MAPS = BIG ? MAPS_HEAVY : MAPS_LIGHT;

// ── Map validation ───────────────────────────────────────────────────────────
// Done on the drawing rather than left to the line search. A cell the escape rule can never open
// makes every trial report "no winning line", which reads as the floor being unreachable rather
// than as a hole in the art — `pairs.mjs` paid for that lesson with a tapered pillar.

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
    if (!hatches && !NO_HATCH) {
      throw new Error(`style ${m.style} ${cols}x${rows}: khong co cua xa — brief doi moi board co it nhat 1`);
    }
    const stuck = unpeelable({ art, rows, cols });
    // ⚠ `total` is trays the player actually meets. A hatch holds `DISPENSER_HOLD` = 3 of them,
    // but under --nohatch its cell is an ordinary tray worth 1 — counting it as 3 either way made
    // the size tiebreak aim two trays high on every hatch-free board.
    const total = trays + hatches * (NO_HATCH ? 1 : 3);
    return { art, rows, cols, trays, hatches, total, stuck };
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

/** Cells this silhouette can never open, by the escape rule alone. Casing is solid, not an exit. */
function unpeelable(size) {
  const { art, rows, cols } = size;
  const solid = new Array(rows * cols).fill(false);
  const tray = new Array(rows * cols).fill(false);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const ch = art[y][x];
      const i = y * cols + x;
      solid[i] = ch !== "_";
      tray[i] = ch === "#" || ch === "<";
    }
  }
  const free = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows && !solid[y * cols + x];
  // ⚠ The chute mouth is the **grid's last row**, `rows - 1`, and nothing else. Reading it as the
  // board's lowest *occupied* row looks like the more thoughtful rule and is simply a second,
  // disagreeing copy of the escape test: `isSealed` in custom.ts and `canEscape` in logic.ts both
  // say `y === rows - 1`. With the lenient version three of five silhouettes passed validation and
  // then produced no winning line on any of 40 trials, because a shape floating above an all-casing
  // bottom row has its real bottom row sealed. A map must **sit on** the last row.
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

// ── The feature mix ──────────────────────────────────────────────────────────

/**
 * Which feature each level of a 30-long run carries. Exactly 3 pairs, 18 "?", 3 crates, 3 choc,
 * 3 plain — the brief's percentages, spelled out rather than sampled.
 *
 * ⚠ Interleaved on purpose. Sorting the run by feature gives the player three pair levels in a
 * row and then eighteen of the same thing; the mix is meant to be felt as variety, and variety is
 * a property of the *order*, not of the tally.
 * ⚠ Mutually exclusive, which is what makes the four percentages add to 90 with 10 left over. A
 * "?" tray on a crate board would be a fifth category nobody asked for and would blur the reading
 * of what each feature costs.
 */
const MIX = [
  "hidden", "pair", "hidden", "hidden", "crate", "hidden", "hidden", "choc", "hidden", "plain",
  "hidden", "hidden", "pair", "hidden", "hidden", "crate", "hidden", "hidden", "choc", "hidden",
  "plain", "hidden", "hidden", "pair", "hidden", "crate", "hidden", "choc", "hidden", "plain",
];

/** The 2x2 a chocolate box covers, from its anchor. Mirrors `chocCells` in custom.ts. */
const chocAt = (a, cols) => [a, a + 1, a + cols, a + cols + 1];

/** Cells of the map, tagged. */
function layout(map) {
  const out = [];
  for (let y = 0; y < map.rows; y++) {
    for (let x = 0; x < map.cols; x++) {
      const ch = map.art[y][x];
      if (ch === ".") out.push({ kind: "wall" });
      else if (ch === "_") out.push({ kind: "hole" });
      else if (ch === "H") out.push(NO_HATCH ? { kind: "tray", x, y, slot: false } : { kind: "hatch" });
      else out.push({ kind: "tray", x, y, slot: ch === "<" });
    }
  }
  return out;
}

/** Pair anchors: both cells plain trays, and no two pairs touching end to end. */
function slotsFor(map, base, r, want) {
  const cands = [];
  base.forEach((c, a) => {
    if (!c.slot) return;
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

/** Anchors whose whole 2x2 is plain tray — the only place a chocolate box can land. */
function chocSlots(map, base, r) {
  const out = [];
  for (let y = 0; y < map.rows - 1; y++) {
    for (let x = 0; x < map.cols - 1; x++) {
      const a = y * map.cols + x;
      if (chocAt(a, map.cols).every((k) => base[k]?.kind === "tray")) out.push(a);
    }
  }
  return shuffled(r, out);
}

/**
 * A drawing: the map's trays coloured from `pool`, carrying whichever single feature the level
 * was assigned.
 */
function draw(map, seed, pool, opt) {
  const r = rng32(seed);
  const base = layout(map);
  const cols = map.cols;
  const pick = () => pool[(r() * pool.length) | 0];

  const anchors = opt.pairs > 0 ? slotsFor(map, base, r, opt.pairs) : [];
  const mates = new Set(anchors.map((a) => a + 1));

  // ⚠ The chocolate box is claimed before anything else is drawn, because it swallows four tray
  // cells whole and everything downstream has to see them as spoken for.
  // ⚠ Chosen once, before the cells are drawn: the ribbons and all four trays underneath have to
  // be the same colour, and picking per tray would give a single-colour box a rainbow interior.
  const chocColor = opt.choc1 ? pick() : null;
  let choc = null;
  if (opt.choc) {
    // ⚠ The box may not land on a pair. `chocSlots` reads `base`, which knows nothing about the
    // anchors chosen a few lines up, so without this the 2x2 can swallow half a linked pair and
    // leave its mate pointing at a cell the lid has taken.
    const free = (a) => chocAt(a, cols).every((k) => !anchors.includes(k) && !mates.has(k));
    const a = chocSlots(map, base, r).find(free);
    if (a == null) return null;
    choc = { at: a, cells: new Set(chocAt(a, cols)) };
  }

  // Crates replace trays outright. Taken from the *top* of the board: a crate low down sits on the
  // chute mouth where everything is already open and changes nothing, while one higher up is the
  // obstacle it is meant to be.
  const crates = new Set();
  if (opt.feature === "crate") {
    const cand = base
      .map((c, i) => (c.kind === "tray" && !mates.has(i) ? i : -1))
      .filter((i) => i >= 0 && (i / cols | 0) < map.rows - 1);
    for (const i of shuffled(r, cand).slice(0, opt.crates)) crates.add(i);
  }

  const cells = base.map((c, i) => {
    if (c.kind === "wall") return { kind: "wall" };
    if (c.kind === "hole") return { kind: "floor" };
    if (c.kind === "hatch") {
      const q = [0, 1, 2].map(pick);
      // ⚠ A face-down tray inside a hatch counts as a "?" the player meets, so it only belongs on
      // the levels the mix assigned one to.
      return { kind: "hatch", queue: q, hiddenQ: q.map(() => opt.hide && r() < opt.hiddenQ), dir: "down" };
    }
    if (choc?.cells.has(i)) {
      if (i !== choc.at) return { kind: "floor" };
      return {
        kind: "choc",
        need: opt.chocNeed,
        // ⚠ Rainbow border: it counts a tray of any colour. A single-colour border can outrun its
        // own supply — the four trays underneath cannot be tapped while the box is shut, so the
        // count has to be reachable from the trays *outside* — and an unreachable counter is an
        // unwinnable level, not a hard one. On an easy run that trade is never worth taking.
        border: chocColor,
        under: [0, 1, 2, 3].map(() => ({ color: chocColor ?? pick(), hidden: false })),
      };
    }
    if (crates.has(i)) return { kind: "crate" };
    if (mates.has(i)) return { kind: "floor" };
    if (anchors.includes(i)) {
      // Two colours, and they must differ — a pair whose halves match is an ordinary double-load
      // tray wearing a clip, and the only thing the piece is for is gone.
      const color = pick();
      let mate = pick();
      for (let n = 0; n < 8 && mate === color && pool.length > 1; n++) mate = pick();
      return { kind: "tile", color, mate, wide: true, hidden: false };
    }
    return { kind: "tile", color: pick(), hidden: opt.hide && r() < opt.hidden };
  });
  // ⚠ No hidden boxes anywhere in this run. They are invisible to every bot — the models read
  // `boxes` directly — so they would make the board harder for a person and not at all for the
  // number this run is being signed off on.
  return { cols, rows: map.rows, cells, boxHiddenFrac: 0 };
}

/**
 * ⚠ `cx` is optional because Cuongxs1 is by far the most expensive model here — it snapshots the
 * board and replays a tap to measure map gain for *every* candidate tray, on every turn. Under
 * `--ruler bd` nothing in the search reads it, so paying for it on all ~700 candidates buys one
 * printed column. Measured: the crate group had not finished a single level in twelve minutes with
 * it on. The pick is re-scored with it below, so the row still prints both rulers.
 */
function scoreAll(def, n, cx = true) {
  const b = best(M, def, n);
  const d = rate(M, def, "greedy", n, D_SLIP);
  return { B: b, D: d, BD: (b + d) / 2, CX: cx ? cuongxs1Rate(M, def, n).rate : NaN };
}

/** What the finished board actually carries — read off the `LevelDef`, never off the drawing. */
function has(def) {
  let trays = 0;
  for (const t of def.tiles) if (t) trays += t.wide ? 2 : 1;
  for (const d of def.disp ?? []) if (d) trays += d.queue.length;
  for (const l of def.lids ?? []) trays += l.tiles.length;
  return {
    trays,
    pairs: def.tiles.filter((t) => t && t.wide).length,
    hidden: def.tiles.filter((t) => t && t.hidden).length,
    crates: (def.blocked ?? []).filter(Boolean).length,
    choc: (def.lids ?? []).length,
    hatch: (def.disp ?? []).filter(Boolean).length,
  };
}

/** Does the board carry the feature it was built for, and a hatch? */
function keeps(def, feature) {
  const h = has(def);
  if (!NO_HATCH && !h.hatch) return "mat cua xa";
  // ⚠ `--colors` slices the *pool*, and a pool is not a board: the trays are coloured by drawing
  // from it at random, so a 6-colour pool routinely paints a 5-colour board. That is a silently
  // different level — colour count is the strongest fine knob left once size is fixed, and for
  // levels 1-29 it is also a floor the sheet checks. Read it off the finished def, like everything
  // else here.
  if (WANT_COLORS && def.colors.length < WANT_COLORS) return "thieu mau";
  if (feature === "pair" && !h.pairs) return "mat khay doi";
  if (feature === "hidden" && !h.hidden) return "mat khay ?";
  if (feature === "crate" && !h.crates) return "mat thung go";
  if (feature === "choc" && !h.choc) return "mat socola";
  if (WANT_PAIRS && h.pairs < WANT_PAIRS) return `chi co ${h.pairs}/${WANT_PAIRS} khay doi`;
  if (WITH_CHOC && !h.choc) return "mat socola";
  if (MIN_TRAYS && h.trays < MIN_TRAYS) return `chi co ${h.trays}/${MIN_TRAYS} khay`;
  if (MIN_HIDDEN && h.hidden < MIN_HIDDEN) return `chi co ${h.hidden}/${MIN_HIDDEN} khay ?`;
  if (MIN_HATCH && h.hatch < MIN_HATCH) return `chi co ${h.hatch}/${MIN_HATCH} cua xa`;
  // ⚠ The supply check for a single-colour lid. Counted the way `creditLids` counts: a tray of the
  // lid's colour anywhere the player can actually tap it — on the grid, either half of a linked
  // pair, or waiting in a hatch queue. The four trays under the lid are deliberately not in
  // `def.tiles`, so they cannot creep into their own supply.
  for (const lid of def.lids ?? []) {
    if (lid.color == null) continue;
    let supply = 0;
    for (const t of def.tiles) {
      if (!t) continue;
      if (t.color === lid.color) supply++;
      if (t.wide && t.mate === lid.color) supply++;
    }
    for (const d of def.disp ?? []) if (d) for (const c of d.queue) if (c === lid.color) supply++;
    if (supply < lid.need) return `socola can ${lid.need} khay mau do, ngoai hop chi co ${supply}`;
  }
  return null;
}

// ── Build ────────────────────────────────────────────────────────────────────

const [lo, hi] = RANGE;
const TODO = LEVELS ?? Array.from({ length: hi - lo + 1 }, (_, k) => lo + k);
const COUNT = TODO.length;
/** How close to `--target` still counts as landed. Beyond it the search keeps looking. */
const GOOD = TARGET ? 0.04 : 0;
console.log(
  TARGET
    ? `Dung ${COUNT} level (${TODO.join(",")}), dich ${RULER === "BD" ? "(B+D)/2" : "Cuongxs1"} ` +
      `${Math.round(TARGET * 100)}%±${Math.round(GOOD * 100)}${MIN_B ? `, san B >= ${Math.round(MIN_B * 100)}%` : ""}, ` +
      `${TRIES} bien the/level.`
    : `De: ${COUNT} level ${lo}-${hi}, san ${RULER === "BD" ? "(B+D)/2" : "Cuongxs1"} >= ${Math.round(FLOOR * 100)}%, ${TRIES} bien the/level.`,
);
if (COUNT === MIX.length) {
  const tally = MIX.reduce((a, k) => ((a[k] = (a[k] || 0) + 1), a), {});
  console.log(`Mix: ${Object.entries(tally).map(([k, v]) => `${k} ${v}`).join("  ")}  (moi board deu co cua xa)`);
}
console.log("");

const out = {};
const rows = [];
for (const level of TODO) {
  const idx = TODO.indexOf(level);
  const feature = COUNT === MIX.length ? MIX[idx] : arg("feature", "hidden");
  let picked = null;
  let built = 0;
  const why = { threw: 0, noline: 0, lost: {} };

  // ⚠ Styles are tried in a rotation **starting** at the level's own, not fixed to it. A chocolate
  // box needs a 2x2 of plain trays and a linked pair needs two side by side, and not every
  // silhouette offers them — pinned to one style, a level whose feature its shape cannot host
  // produces nothing at all and the run comes back with a hole in it. Starting at `level % 5`
  // keeps the variety; falling through keeps the level.
  const order = WANT_STYLE
    ? MAPS.filter((m) => m.style === WANT_STYLE)
    : MAPS.map((_, k) => MAPS[(level + k) % MAPS.length]);
  if (WANT_STYLE && !order.length) throw new Error(`--style ${WANT_STYLE}: khong co silhouette nao ten vay`);
  for (const style of order) {
   for (let t = 0; t < TRIES; t++) {
    const r = rng32(level * 7919 + t * 104729 + 11);
    const map = style.sizes[(t / 5) % style.sizes.length | 0];
    const opt = {
      feature,
      // ⚠ `--pairs`/`--withchoc` add to the assigned feature; the feature itself still implies its
      // own one. A level assigned "pair" with no flag keeps exactly the single pair it always had.
      // ⚠ `--hidden X` implies face-down trays, not just their share. Reading the share while
      // leaving the switch on `feature === "hidden"` meant a board asked for 50% face-down under a
      // `choc` or `pair` feature got exactly none, silently.
      hide: feature === "hidden" || WANT_HIDDEN > 0,
      choc: feature === "choc" || WITH_CHOC,
      choc1: CHOC_ONE,
      pairs: WANT_PAIRS || (feature === "pair" ? 1 : 0),
      crates: 1 + (t % 2),
      chocNeed: 2 + (t % 2),
      hidden: WANT_HIDDEN || [0.25, 0.4, 0.55][t % 3],
      hiddenQ: WANT_HIDDEN || [0.34, 0.67][t % 2],
    };
    // Colour count is the fine difficulty knob and the strongest one left once size is fixed:
    // fewer colours means more of the belt can drain into the four open boxes at any moment.
    const pool = shuffled(r, PALETTE.map((_, i) => i)).slice(0, WANT_COLORS || 3 + (t % 3));
    const bp = draw(map, level * 31 + t, pool, opt);
    if (!bp) {
      why.threw++;
      continue;
    }

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
    const missing = keeps(def, feature);
    if (missing) {
      why.lost[missing] = (why.lost[missing] || 0) + 1;
      continue;
    }
    built++;

    // Two-stage, or the winner's curse eats the result: screen cheaply, re-measure the survivors.
    const quick = scoreAll(def, SCREEN, RULER === "CX");
    if (picked && (TARGET ? Math.abs(quick[RULER] - TARGET) > 0.28 : quick[RULER] < FLOOR - 0.1)) continue;
    const s = scoreAll(def, CONFIRM, RULER === "CX" || !!MAX_GAP);
    // ⚠ Before the gap guard, because it is a different question: the gap asks whether the two
    // models agree, this asks whether the board is winnable at all.
    if (s.B < MIN_B) continue;
    // ⚠ A ceiling on the *other* ruler's distance below this one. A board Cuongxs1 clears 95% of
    // the time while best play manages 60% is not an easy level, it is a level one model happens
    // to be good at — and the run is being signed off on that one model.
    // ⚠ Only under the Cuongxs1 ruler. Its job is to catch a board that is easy for the one model
    // being optimised and hard for everything else — which cannot happen when the thing being
    // optimised is (B+D)/2 itself, and the guard then merely rejects every board an oracle reads
    // higher than a one-ply bot does, i.e. most hard boards. `--minb` is the guard on that side.
    if (RULER === "CX" && s.BD < s.CX - GAP_OK) continue;
    if (MAX_GAP && s.CX - s[RULER] > MAX_GAP) continue;
    // The floor is one-sided: below it costs, above it is free. Ties break toward the *smaller*
    // board, because on an easy run a shorter level is a better one.
    // ⚠ Two-sided under `--target`, one-sided under `--floor`. See the note on TARGET.
    const err = TARGET ? Math.abs(s[RULER] - TARGET) : Math.max(0, FLOOR - s[RULER]);
    // ⚠ The floor is one-sided, so among boards that clear it the tiebreak decides everything —
    // and what it should prefer depends on the job. A fresh easy run wants the *smallest* board
    // that clears; a level being rebuilt inside an existing ladder wants one that still looks like
    // its neighbours, or it reads as a hole rather than a breather. `--trays N` aims at a size.
    // ⚠ Alternating, not "smallest wins". Left to prefer the smaller board every time, 27 of 30
    // came out 5x5 — five silhouettes and one size reads as one board recoloured thirty ways, and
    // the brief asked for variety. Odd levels aim at the big variant, even at the small; both
    // clear the floor, so this costs nothing but the tiebreak.
    const wantBig = !WANT_TRAYS && idx % 2 === 1;
    const size = WANT_TRAYS ? Math.abs(map.total - WANT_TRAYS) : wantBig ? -map.total : map.total;
    const cost = err + 0.002 * size;
    if (!picked || cost < picked.cost) picked = { bp, def, s, cost, err, opt, map, style: style.style };
    if (err <= GOOD && !WANT_TRAYS && !wantBig && map === style.sizes[0]) break;
   }
   // Only fall through to the next silhouette if this one gave nothing that clears the floor —
   // ⚠ unless a size is being aimed at, in which case every style has to be weighed. Breaking at
   // the first style that merely clears the floor is how a `--trays 14` request kept returning an
   // 11-tray board: the size target was never allowed to reach the silhouette that could hit it.
   if (picked && picked.err <= GOOD && !WANT_TRAYS) break;
  }

  if (!picked) {
    delete HANDMADE[level];
    const lost = Object.entries(why.lost).map(([k, v]) => `${v} ${k}`).join(", ") || "0 mat dac tinh";
    console.log(`L${level}: khong dung duoc board nao — ${built} hop le, ${why.threw} loi dung, ${why.noline} khong co duong thang, ${lost}.`);
    continue;
  }
  HANDMADE[level] = picked.bp;
  out[level] = picked.bp;
  // The search may have skipped Cuongxs1 entirely; fill it in once, for the board that won.
  if (Number.isNaN(picked.s.CX)) picked.s.CX = cuongxs1Rate(M, picked.def, CONFIRM).rate;
  rows.push({ level, feature, picked, style: picked.style });
  const p = (x) => String(Math.round(x * 100)).padStart(3) + "%";
  const s = picked.s;
  const h = has(picked.def);
  const marbles = (h.pairs * 2 + picked.def.tiles.filter((t) => t && !t.wide).length) * TRAY_N;
  // ⚠ Names the ruler it actually missed. Under `--target` a board can sit three points *above*
  // the aim and still be flagged, and calling that "below the floor" reads as the opposite failure.
  const flag =
    picked.err > GOOD
      ? `  <-- ${TARGET ? "lech dich" : "duoi san"} ${Math.round(picked.err * 100)} diem`
      : "";
  console.log(
    `L${level}: ${picked.style} ${picked.bp.cols}x${picked.bp.rows} [${feature}] ` +
      `${h.pairs}doi ${h.hidden}? ${h.crates}go ${h.choc}choc ${h.hatch}xa | ` +
      `${RULER === "BD" ? `(B+D)/2 ${p(s.BD)} | Cuongxs1 ${p(s.CX)}` : `Cuongxs1 ${p(s.CX)} | (B+D)/2 ${p(s.BD)}`} ` +
        `| B ${p(s.B)} D ${p(s.D)} | ${marbles} bi${flag}`,
  );
}

console.log("");
const ok = rows.filter((r) => r.picked.err <= GOOD).length;
console.log(
  TARGET
    ? `${ok}/${rows.length} level trong ±${Math.round(GOOD * 100)} diem quanh dich ${Math.round(TARGET * 100)}%.`
    : `${ok}/${rows.length} level dat san ${Math.round(FLOOR * 100)}%.`,
);
if (rows.length) {
  const tally = rows.reduce((a, r) => ((a[r.feature] = (a[r.feature] || 0) + 1), a), {});
  console.log(`Da build: ${Object.entries(tally).map(([k, v]) => `${k} ${v}`).join("  ")}`);
  const styles = new Set(rows.map((r) => r.style));
  console.log(`Kieu board: ${styles.size} (${[...styles].join(", ")})`);
  const noHatch = rows.filter((r) => has(r.picked.def).hatch === 0).length;
  console.log(
    NO_HATCH
      ? "--nohatch: khong level nao co cua xa (co y)"
      : noHatch
        ? `⚠ ${noHatch} level KHONG co cua xa`
        : "Moi level deu co cua xa ✓",
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
