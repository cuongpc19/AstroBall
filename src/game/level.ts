// Levels are a pure function of the level number — there are no level files, so adding
// level 400 costs nothing and a player's level 12 is the same board as everyone else's.
//
// ⚠ The hard rule: a level is only returned once it has been *cleared*, by replaying the
// generator's own tap order through the real engine in logic.ts. A board that is stuck
// from the first move is unrecoverable and the player cannot tell it apart from their own
// mistake, so nothing unproven ships.

import {
  boxHiddenFrom, BELT_SLOTS, BOX_COLS, BOX_SLOTS, GRID_COLS, GRID_ROWS, TRAY_N, type Color } from "./config";
import {
  Game,
  dispTarget,
  type Dir,
  type Dispenser,
  type LevelDef,
  type Lid,
  type Tile,
} from "./logic";

// ── Seeded RNG ───────────────────────────────────────────────────────────────

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;

/** Tiles one dispenser holds back. Kept small: they come out of the same tray budget as the
 *  visible block, and a greedy dispenser leaves too few tiles on the board to make a shape. */
const DISPENSER_HOLD = 3;

const pick = <T>(rng: Rng, arr: T[]): T => arr[(rng() * arr.length) | 0];
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function shuffle<T>(rng: Rng, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ── Difficulty curve ─────────────────────────────────────────────────────────

/**
 * Board silhouettes. They exist because the escape rule reads the *shape* of the block —
 * a notch or a punched hole is a lane out for everything beside it, so the silhouette is
 * what decides which trays are live, not just how many there are.
 */
export type Shape =
  | "block"
  | "castle"
  | "holes"
  | "pillars"
  | "steps"
  | "cross"
  | "diamond"
  | "frame"
  | "tee"
  | "arrow";
export const SHAPES: Shape[] = [
  "block",
  "castle",
  "holes",
  "pillars",
  "steps",
  "cross",
  "diamond",
  "frame",
  "tee",
  "arrow",
];

/**
 * Which cells a silhouette is allowed to use. Everything is expressed as a **mask** rather
 * than as column heights, because the real machine's boards are arbitrary outlines — crosses,
 * L-shapes, hollow frames — and a heights array can only ever describe something hanging from
 * the top.
 *
 * The mask is the candidate set; `structure` then fills as much of it as the tray budget
 * allows, top rows first. So a mask bigger than the budget comes out as the top of that shape,
 * which still reads as the shape.
 */
function maskOf(
  shape: Shape,
  cols: number,
  rows: number,
  from: number,
  w: number,
  h: number,
): boolean[] {
  const m = new Array<boolean>(cols * rows).fill(false);
  const cx = from + (w - 1) / 2;
  const cy = (h - 1) / 2;
  const set = (x: number, y: number) => {
    if (x >= 0 && y >= 0 && x < cols && y < rows) m[y * cols + x] = true;
  };
  const inWin = (x: number) => x >= from && x < from + w;

  for (let y = 0; y < h && y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!inWin(x)) continue;
      const rx = x - from;
      switch (shape) {
        case "pillars":
          // Every third column left out, so each pillar has open air either side.
          if (rx % 3 !== 2) set(x, y);
          break;
        case "cross":
          // A plus: the middle two columns and the middle two rows.
          if (Math.abs(x - cx) <= 0.6 || Math.abs(y - cy) <= 0.6) set(x, y);
          break;
        case "diamond":
          if (Math.abs(x - cx) + Math.abs(y - cy) <= Math.max(1.5, Math.min(w, h) / 2)) set(x, y);
          break;
        case "frame":
          // Hollow: border only, so the inside is open air and every tile has a lane.
          if (rx === 0 || rx === w - 1 || y === 0 || y === h - 1) set(x, y);
          break;
        case "tee":
          if (y <= 1 || Math.abs(x - cx) <= 0.6) set(x, y);
          break;
        case "arrow":
          // Widest at the top, narrowing down — an L/wedge outline.
          if (rx >= Math.floor(y / 2) && rx < w - Math.floor(y / 2)) set(x, y);
          break;
        default:
          set(x, y);
      }
    }
  }
  return m;
}

/**
 * The silhouettes ordered easy → hard, **measured**, not guessed. Holding every other lever
 * still and changing only the shape (90 games each at slip 0.25):
 *
 *   castle 97% · block 91% · steps 91% · holes 90% · pillars 87%   (averaged)
 *   and at the hard end (d = 0.85) the spread opens right out:
 *   castle 93% · holes 80% · block 77% · steps 76% · pillars 68%
 *
 * ⚠ An earlier measurement put the whole shape lever at "about 4 points", i.e. inside the
 * noise floor — that was taken *before* the escape rule stopped treating the board edge as an
 * exit. Once the silhouette decides which trays are live, a notch or a gap is worth 25 points.
 * Any conclusion about shapes from before that rule is void.
 */
const SHAPE_ORDER: Shape[] = [
  "castle",
  "block",
  "tee",
  "steps",
  "arrow",
  "holes",
  "cross",
  "diamond",
  "frame",
  "pillars",
];
/** Shapes available at once. Four keeps the run varied without blurring the ramp. */
const SHAPE_SPAN = 4;

/**
 * Slide a window along the ordering: gentle silhouettes early, awkward ones late.
 *
 * ⚠ Normalise against the range the LADDER actually occupies, not 0…1. The tuned ladder runs
 * 0.20 → 0.85, so scaling raw `d` left the window short of both ends and `castle`, `block` and
 * `pillars` never came up once in 45 levels — including `pillars`, the hardest silhouette
 * measured. A lever the ladder cannot reach is not a lever.
 */
const D_LO = 0.2;
const D_HI = 0.85;
function shapeFor(d: number, level: number): Shape {
  if (d < 0.1) return "block";
  const t = clamp((d - D_LO) / (D_HI - D_LO), 0, 1);
  // floor, not round: rounding pushes the window off index 0 by level 3, and the only levels
  // gentle enough to sit at the easy end are too few to also land on `castle`'s slot in the
  // window. Flooring keeps the window's foot on the easiest shape a little longer.
  const start = Math.floor(t * (SHAPE_ORDER.length - SHAPE_SPAN));
  return SHAPE_ORDER[start + (level % SHAPE_SPAN)];
}

export interface Params {
  colors: number;
  /** target tray *units* — a double tile spends two of them */
  tiles: number;
  cols: number;
  rows: number;
  dispensers: number;
  /** x2 bars: every tray above one drops double */
  bars: number;
  /** hatch lids, each hiding four trays behind a counter */
  lids: number;
  /** crates: cells permanently in the way, shaping the board and blocking escape lanes */
  crates: number;
  /**
   * Linked pairs: two trays clipped together across two cells, each with its own colour, both
   * emptied by one tap.
   *
   * ⚠ Defaults to 0 and stays there until a level asks for it. Turning it on changes what every
   * board is made of, which invalidates `LADDER` and `VARIANTS` and costs a full retune — so the
   * capability ships switched off and gets switched on deliberately, once.
   */
  pairs: number;
  /** share of the boxes below the top of each column whose colour is hidden */
  boxHiddenFrac: number;
  hiddenFrac: number;
  /** at least this many trays start face-down, whatever `hiddenFrac` happens to pick */
  hiddenMin: number;
  /** which ways a hatch may face on this board */
  hatchDirs: Dir[];
  shape: Shape;
  /**
   * Cast the silhouette as a cavity in solid casing rather than a block sitting in open floor.
   *
   * It is the escape rule seen from the other side: an empty cell beside a tray is a way out,
   * and casing is not. So the same silhouette played walled is a different puzzle — the outer
   * ring is peeled from the inside out instead of from the outside in.
   */
  walled: boolean;
  /** how often the generator lets its own reference solve be careless — the direct knob
   *  on how tangled the resulting box stacks are */
  sloppy: number;
}

/**
 * The target winrate curve, as control points (level, winrate). Everything else in this
 * section exists to hit it.
 *
 * ⚠ This is the *design intent*, not a measurement. What a level actually scores is checked
 * with `npm run levels`, and the number that check reports is still a **bot** score — see the
 * winrate section of CLAUDE.md before treating it as a prediction about people.
 *
 * ⚠ These numbers are **bot** targets, and the bots here are markedly worse than a competent
 * player. Twelve logged games from one real player: 12/12 wins, no boosters, including 3/3 on
 * levels the bots rated 47-50%. The curve was compressed roughly 2x in response — what used to
 * arrive at level 25 now arrives at 12.
 *
 * The size of that compression is a **judgement call, not a fit**. Twelve games with zero
 * losses give an unbounded estimate for the bot-to-human offset; it cannot be fitted until the
 * log contains losses. Get games with losses on the current build, then
 * `PURE=1 npm run winrate -- --models` and let the fit replace this guess.
 */
export const TARGET: [number, number][] = [
  [1, 0.95],
  [5, 0.65],
  [12, 0.35],
  [20, 0.25],
];

/**
 * The hand-written level sheet — `Manythings/winrate Marble sort - Sheet1.csv`.
 *
 * Each row is a **floor**, not a recipe: at least this many trays, colours, face-down trays,
 * hatches and crates. Everything above the floor is the generator's to choose, and what it
 * chooses is what `npm run tune` searches until the board lands on `win`.
 *
 * ⚠ A blank cell in the sheet is *no constraint*, which is 0 here — not "carry the row above".
 * Rows 17, 18, 21, 22, 23, 26 and 27 are deliberately loose: the sheet asks only for a winrate
 * there and leaves the ingredients open.
 */
export interface Spec {
  trays: number;
  colors: number;
  hidden: number;
  hatches: number;
  crates: number;
  /** target winrate on (B+D)/2, ±10 points */
  win: number;
}

// prettier-ignore
export const SHEET: Spec[] = [
  // ⚠ **Rows 1-9 re-specified on 2026-08-22, as their boards were rebuilt** — the only way this
  // column may be touched, one row at a time and never as a sweep. The nine were an introduction
  // that opened on 8 trays and reached 16 by level 7; they now open on 2 and reach 10. Leaving the
  // old rows would not be harmless history: the next `npm run tune` reads them as the design, and
  // it would rebuild all nine back to fourteen trays and quietly undo the whole thing.
  //
  // ⚠ The `win` column went to 1.00 on 1-8 because that is what they **measure**, not to make them
  // easy. Every one reads B 100% / D 100% over 20 games.
  { trays:  8, colors: 4, hidden: 0, hatches: 0, crates: 0, win: 1.00 }, //  1
  // ⚠ **Do not edit a `win` here to re-aim a level that already ships.** This column is not just
  // the tuner's goal — `board.ts` feeds `targetWin(level)` into `toLevelDef`, so for every
  // hand-built board it is also what the box-order search aims at, and the stacks are a pure
  // function of (drawing, target). Change the number and the board changes under a level nobody
  // touched. Measured on 2026-08-13 when the whole column was re-specified at once: L26 went
  // 15% -> 60%, L29 7% -> 43%, L31 0% -> 45%, L34 2% -> 48%, and L7 fell 100% -> 63%. All nine
  // were levels that were not being worked on. Re-aim a level **when its board is rebuilt**, one
  // row at a time, not as a sweep.
  { trays: 10, colors: 4, hidden: 0, hatches: 0, crates: 0, win: 1.00 }, //  2
  { trays: 10, colors: 4, hidden: 0, hatches: 0, crates: 0, win: 1.00 }, //  3
  // ⚠ 4 and 5 re-specified on 2026-08-25, as their boards were replaced by the A/B variant's —
  // one row at a time, the only way this column may be touched. 4 went 12 trays / 4 colours to
  // 10 / 5, and 5 went 14 / 5 to 13 / 6. The `win` targets are untouched: both pin `columns`, so
  // nothing reads them at load, and moving them would rewrite the design rather than record it.
  { trays: 10, colors: 5, hidden: 0, hatches: 0, crates: 0, win: 1.00 }, //  4
  { trays: 13, colors: 6, hidden: 0, hatches: 0, crates: 0, win: 0.90 }, //  5
  { trays: 10, colors: 4, hidden: 0, hatches: 0, crates: 0, win: 0.90 }, //  6
  { trays: 14, colors: 5, hidden: 0, hatches: 0, crates: 0, win: 0.90 }, //  7
  // ⚠ 8 and 10 were re-aimed on 2026-08-19, **as their boards were rebuilt** and one row at a
  // time, which is the only way this column may be touched (see the warning above). Both rows
  // still said 1.00 while the boards they describe measured 84% and 32% on (B+D)/2 — the ruler
  // `scripts/sheet.mjs` judges them with — so the number was not a goal any more, it was a stale
  // claim. Worse for 8: its blueprint pins no `columns`, so `targetWin(8)` is what the box-order
  // search aims at, and a 1.00 there hands a level meant to be harder its *easiest* stack order.
  { trays: 10, colors: 3, hidden: 0, hatches: 3, crates: 0, win: 0.90 }, //  8
  { trays: 14, colors: 6, hidden: 0, hatches: 1, crates: 0, win: 0.90 }, //  9
  { trays:  8, colors: 4, hidden: 0, hatches: 0, crates: 0, win: 1.00 }, // 10
  { trays: 13, colors: 6, hidden: 3, hatches: 0, crates: 0, win: 0.75 }, // 11
  { trays: 14, colors: 6, hidden: 0, hatches: 0, crates: 0, win: 0.85 }, // 12
  // ⚠ The board that was re-aimed here on 2026-08-19 (with 19 and 22) now sits at **12**: rows
  // 12 and 13 were swapped on 2026-08-23 along with their boards, so its 0.85 travelled with it.
  // The rule that re-aiming happens one row at a time, as a board is rebuilt, still stands.
  { trays: 13, colors: 6, hidden: 2, hatches: 0, crates: 0, win: 0.80 }, // 13
  { trays: 14, colors: 6, hidden: 0, hatches: 1, crates: 0, win: 0.12 }, // 14
  { trays: 14, colors: 6, hidden: 4, hatches: 1, crates: 1, win: 0.30 }, // 15
  { trays: 14, colors: 6, hidden: 5, hatches: 2, crates: 2, win: 0.80 }, // 16
  { trays:  9, colors: 4, hidden: 0, hatches: 0, crates: 0, win: 1.00 }, // 17
  { trays: 14, colors: 6, hidden: 0, hatches: 0, crates: 0, win: 0.80 }, // 18
  { trays: 14, colors: 6, hidden: 4, hatches: 1, crates: 2, win: 0.33 }, // 19
  // ⚠ **17 and 20 swapped on 2026-08-23**, boards and rows together. Slot 20 promises HARD by
  // number and now holds the board that was carrying `tag: "hard"` at 17 — 25 trays, a 31-tap
  // line — so the badge and the board finally agree. What moved to 17 is the 10-tray star, which
  // has no tag, so that slot now shows nothing. The 1.00 that used to be on row 20 went with it.
  { trays: 14, colors: 6, hidden: 0, hatches: 2, crates: 2, win: 0.80 }, // 20
  { trays: 14, colors: 6, hidden: 0, hatches: 0, crates: 0, win: 0.80 }, // 21
  { trays: 14, colors: 6, hidden: 0, hatches: 0, crates: 0, win: 0.71 }, // 22
  { trays: 14, colors: 6, hidden: 0, hatches: 0, crates: 0, win: 0.80 }, // 23
  // ⚠ 24 and 26 re-aimed on 2026-08-19 as their boards were rebuilt to 30%, one row at a time.
  // Neither pins `columns`, so this number is re-read on **every load** — the box-order search
  // runs at `toLevelDef` — and leaving 0.80 on a board that plays at 32% has the search hunting
  // for the gentlest stacks it can find under a level deliberately built to be harder.
  { trays: 14, colors: 6, hidden: 4, hatches: 2, crates: 1, win: 0.32 }, // 24
  // ⚠ 25 re-aimed the same way on the same day: its board measured 16% on (B+D)/2 against the
  // 0.30 written here, and it was rebuilt to 6%. Same reason as 8 — this number is what the
  // box-order search aims at, so leaving 0.30 in place would build the gentlest stacks it can find
  // underneath a board asked to be a wall. It stays inside `SPIKES` either way (<= 0.40).
  { trays: 14, colors: 7, hidden: 5, hatches: 3, crates: 1, win: 0.06 }, // 25
  // ⚠ Rows 26-30 no longer come from the CSV. They were re-specified when those five levels were
  // hand-built to a brief of "every model under 20%", and the target here is what the box-order
  // search aims at — leaving the CSV's 80% in place would have had it building the *easiest*
  // stack order for a level meant to be brutal. Revert these five to 0.80 / 0.80 / 0.30 / 0.20
  // and delete row 30 to put the sheet back exactly as the CSV has it.
  { trays: 14, colors: 7, hidden: 4, hatches: 2, crates: 1, win: 0.27 }, // 26
  { trays: 14, colors: 7, hidden: 4, hatches: 2, crates: 1, win: 0.15 }, // 27
  { trays: 14, colors: 7, hidden: 4, hatches: 2, crates: 1, win: 0.15 }, // 28
  { trays: 14, colors: 7, hidden: 4, hatches: 2, crates: 1, win: 0.15 }, // 29
  { trays: 14, colors: 7, hidden: 4, hatches: 2, crates: 1, win: 0.15 }, // 30
  // ⚠ 5%, and that is a *bot* number. The play log puts this player about 3.5 logit above the
  // bots, which turns a bot 5% into roughly 60% for them — so this row is not "almost nobody
  // wins", it is "hard for the person it was drawn for". Read it with the calibration or not at
  // all.
  { trays: 14, colors: 7, hidden: 8, hatches: 2, crates: 0, win: 0.05 }, // 31
  { trays: 14, colors: 7, hidden: 8, hatches: 2, crates: 0, win: 0.80 }, // 32
  { trays: 14, colors: 7, hidden: 8, hatches: 2, crates: 0, win: 0.80 }, // 33
  { trays: 14, colors: 7, hidden: 8, hatches: 2, crates: 0, win: 0.05 }, // 34
  { trays: 14, colors: 7, hidden: 8, hatches: 2, crates: 0, win: 0.05 }, // 35
  { trays: 14, colors: 7, hidden: 8, hatches: 2, crates: 0, win: 0.05 }, // 36
  { trays: 14, colors: 7, hidden: 8, hatches: 2, crates: 0, win: 0.05 }, // 37
  { trays: 14, colors: 7, hidden: 8, hatches: 2, crates: 0, win: 0.05 }, // 38
  { trays: 14, colors: 7, hidden: 8, hatches: 2, crates: 0, win: 0.05 }, // 39
  { trays: 14, colors: 7, hidden: 8, hatches: 2, crates: 0, win: 0.05 }, // 40
  { trays: 14, colors: 7, hidden: 8, hatches: 2, crates: 0, win: 0.05 }, // 41
  { trays: 14, colors: 7, hidden: 8, hatches: 2, crates: 0, win: 0.05 }, // 42
  { trays: 14, colors: 7, hidden: 8, hatches: 2, crates: 0, win: 0.05 }, // 43
];

export function specFor(level: number): Spec | null {
  const i = Math.max(1, Math.round(level)) - 1;
  return i < SHEET.length ? SHEET[i] : null;
}

/**
 * How wide of the sheet's target a level is allowed to land. The sheet says ±10%.
 */
export const WIN_TOL = 0.1;

export function targetWin(level: number): number {
  const spec = specFor(level);
  if (spec) return spec.win;
  // Past the sheet, fall back to the old interpolated curve so the game still has a shape.
  const l = Math.max(1, level);
  if (l <= TARGET[0][0]) return TARGET[0][1];
  for (let i = 1; i < TARGET.length; i++) {
    const [x0, y0] = TARGET[i - 1];
    const [x1, y1] = TARGET[i];
    if (l <= x1) return y0 + ((y1 - y0) * (l - x0)) / (x1 - x0);
  }
  return TARGET[TARGET.length - 1][1];
}

/** Levels the sheet asks to be much harder than their neighbours. Derived, not hand-listed. */
export const SPIKES = new Set(
  SHEET.map((s, i) => (s.win <= 0.4 ? i + 1 : 0)).filter((n) => n > 0),
);

/**
 * How hard level N is set to be, on one scale from 0 (gentlest) to 1 (everything on).
 *
 * ⚠ Found by measurement, not by hand: `npm run tune` scans this scalar per level until the
 * board scores the target above, then prints this table to paste back. Hand-editing an entry
 * silently detaches that level from the curve — retune instead.
 *
 * Levels past the end of the table hold the last value.
 */
const LADDER: number[] = [
  0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
  0.0, 0.0, 0.0, 0.0, 0.1, 0.1, 0.0, 0.0, 0.2, 0.0,
  0.0, 0.0, 0.0, 0.05, 0.05, 0.1, 0.2, 0.3, 0.25, 0.7,
  0.25, 0.6, 0.5, 0.4, 0.55, 0.5, 0.45, 0.75, 0.45, 0.65,
  0.6, 0.35, 0.35, 0.4, 0.35,
];

export function difficultyFor(level: number): number {
  const i = Math.max(1, Math.round(level)) - 1;
  return i < LADDER.length ? LADDER[i] : LADDER[LADDER.length - 1];
}

/**
 * Which generated board a level uses.
 *
 * ⚠ The difficulty scalar alone cannot land a target curve, and this was measured, not
 * assumed: with `d` pinned at 1.0, one level scored 86% and another 30%. Board luck swamps the
 * knob. So the knob sets the *ingredients* and this picks *which board made from them* — the
 * tuner scans variants per level and keeps the one that lands on target.
 *
 * Same rule as LADDER: hand-editing an entry detaches that level from the curve. Retune.
 */
const VARIANTS: number[] = [
  0, 0, 0, 0, 18, 10, 2, 9, 41, 42,
  13, 4, 53, 62, 9, 19, 27, 62, 13, 8,
  20, 59, 3, 15, 1, 47, 49, 21, 20, 25,
  15, 15, 12, 0, 4, 18, 14, 18, 10, 10,
  21, 27, 16, 9, 21,
];

export function variantFor(level: number): number {
  const i = Math.max(1, Math.round(level)) - 1;
  return i < VARIANTS.length ? VARIANTS[i] : 0;
}

/**
 * One knob, every lever. Each of these was swept individually first (see CLAUDE.md); what
 * this does is put them on a single axis so a tuner can search it.
 *
 * The level number still gets a say in two places that are about *variety* rather than
 * difficulty: which silhouette comes up, and which levels carry an x2 tray.
 */
export function paramsFromD(d0: number, level: number): Params {
  const d = clamp(d0, 0, 1);
  const l = Math.max(1, level);
  const colors = clamp(Math.round(3 + d * 5), 3, 8);
  // An x2 bar doubles everything above it, so a board carrying one has to be shorter.
  const bars = d >= 0.45 && l % 3 === 0 ? 1 : 0;
  const lids = d >= 0.6 && l % 4 === 0 ? 1 : 0;
  const tiles = Math.max(colors, Math.round(6 + d * 9) - bars * 2);
  return {
    colors,
    tiles,
    cols: d < 0.25 ? 4 : d < 0.6 ? 5 : 6,
    rows: GRID_ROWS,
    dispensers: d < 0.3 ? 0 : d < 0.65 ? 1 : 2,
    bars,
    lids,
    // Crates arrive once the board is big enough that losing a cell is interesting rather
    // than just cramped.
    crates: d < 0.35 ? 0 : d < 0.7 ? 1 : 2,
    // Hiding what is coming up the box stack is the cheapest difficulty there is: it changes
    // no rule, only what the player can plan against.
    boxHiddenFrac: clamp((d - 0.3) * 0.7, 0, 0.45),
    hiddenFrac: clamp((d - 0.2) * 0.55, 0, 0.4),
    pairs: 0,
    hiddenMin: 0,
    // ⚠ Set here, not only in `applySheet` — the sheet stops at level 29 and `applySheet` returns
    // its input untouched past it, so leaving the rule there alone made every hatch from level 30
    // on face down again.
    hatchDirs: l <= SIDEWAYS_FROM ? ["down"] : ["down", "left", "right"],
    shape: shapeFor(d, l),
    // Every third level once the boards are big enough to have an outside worth sealing. Kept
    // to a minority on purpose: walled is a change of rule, and a rule that is always on stops
    // being something the player reads off the board.
    walled: d >= 0.22 && l % 3 === 1,
    sloppy: clamp(0.12 + d * 0.63, 0.12, 0.75),
  };
}

/**
 * Raise a parameter set to the sheet's floors for that level.
 *
 * ⚠ Floors only, never caps. The sheet says "at least 6 colours"; if the tuner found that a
 * seventh lands the winrate, clamping back down to 6 would throw the tuning away and leave the
 * level off its target — the row is a constraint on the *design*, and the winrate is the goal.
 */
export function applySheet(p: Params, level: number): Params {
  const s = specFor(level);
  if (!s) return p;
  const colors = Math.max(p.colors, s.colors);
  return {
    ...p,
    colors,
    tiles: Math.max(p.tiles, s.trays, colors),
    cols: Math.max(p.cols, colsForSheet(level)),
    dispensers: Math.max(p.dispensers, s.hatches),
    crates: Math.max(p.crates, s.crates),
    hiddenMin: Math.max(p.hiddenMin, s.hidden),
    shape: shapeForSheet(level),
    // ⚠ And never wall a board whose trays are mostly inside hatches. Level 25 starts five of
    // its fourteen on the grid; drawn compact that is a three-wide block, and walling it seals
    // three of the six columns into casing — the level fell to 8% against a target of 30%, out
    // of reach at every setting of `d`. Walling is a rule change, and it needs a board to change
    // the rule *on*.
    walled: level >= WALL_FROM && level % 3 === 1 && onGridTrays(s) >= WIDE_NEEDS,
    // Hatches only face down for the first stretch — a sideways shutter is a second thing to
    // read on a board, and the early levels are where the first one is still being learned.
    hatchDirs: level <= SIDEWAYS_FROM ? ["down"] : ["down", "left", "right"],
  };
}

/**
 * Board width, silhouette and walling on a sheet level — **from the level number, not from `d`**.
 *
 * ⚠ This is not decoration, and leaving it on `d` was measured wrong. The sheet pins the
 * ingredients that actually decide the winrate (trays, colours, hatches, crates, face-down
 * trays), so the tuner lands every one of the 29 levels with `d` at or near 0 — and at `d` < 0.1
 * `shapeFor` returns `block` and `paramsFromD` returns 4 columns. All 29 levels came out as the
 * same slab on the same narrow grid: the silhouette lever, the walled-board lever and the board
 * growing at all were switched off by a knob that no longer had to move.
 *
 * So variety rides the level number and difficulty rides `d`. The tuner still lands the target,
 * because it searches boards (VARIANTS) inside whatever shape the level was given.
 */
function colsForSheet(level: number): number {
  return level <= 3 ? 4 : level <= 12 ? 5 : GRID_COLS;
}

/** How many of the sheet's trays actually start on the grid — a hatch holds the rest. */
function onGridTrays(s: Spec): number {
  return Math.max(2, s.trays - s.hatches * DISPENSER_HOLD);
}

/**
 * Silhouettes that spread across every column. The rest are drawn into a block window sized to
 * the tray count, so they stay dense whatever the grid is.
 */
const WIDE_SHAPES = new Set<Shape>(["pillars", "cross", "frame", "tee", "diamond", "arrow"]);
const COMPACT_SHAPES: Shape[] = ["block", "castle", "steps", "holes"];
/** Below this many trays on the grid, a wide silhouette has nothing to fill itself with. */
const WIDE_NEEDS = 10;

function shapeForSheet(level: number): Shape {
  // The first three levels teach the tap; a silhouette there is one thing too many to read.
  if (level <= 3) return "block";
  const s = specFor(level)!;
  // ⚠ A wide silhouette on a board whose trays are mostly inside hatches is two thin rows with
  // an open side everywhere, and the escape rule never bites. Level 20 asks for fourteen trays
  // and starts eight of them on the grid; drawn as an `arrow` across six columns it was visibly
  // empty. Narrowing the *grid* instead looked like the same fix and was not — it took levels 19
  // and 29 outside the sheet's ±10 at every setting of `d`, because a cramped board is harder,
  // not denser. Pick a compact shape and let its own window do the sizing.
  const t = clamp((level - 1) / Math.max(1, SHEET.length - 1), 0, 1);
  const start = Math.floor(t * (SHAPE_ORDER.length - SHAPE_SPAN));
  const shape = SHAPE_ORDER[start + (level % SHAPE_SPAN)];
  if (!WIDE_SHAPES.has(shape) || onGridTrays(s) >= WIDE_NEEDS) return shape;
  return COMPACT_SHAPES[level % COMPACT_SHAPES.length];
}

/** Walled boards start once the grid is wide enough to have an outside worth sealing. */
const WALL_FROM = 13;

/** Below this, every hatch faces down. Above it the generator may turn them. */
export const SIDEWAYS_FROM = 15;

export function params(level: number): Params {
  return applySheet(paramsFromD(difficultyFor(level), level), level);
}

// ── Stage A: structure ───────────────────────────────────────────────────────
// Where the tiles sit, which are double-width, which start face-down, which cells dispense.
// Deliberately colour-blind: escapes, reveals and dispensers all depend only on the shape of
// the board, so the tap order this produces stays valid whatever colours stage B paints on.

interface Structure {
  cols: number;
  rows: number;
  /** cell index → a tile covers this cell at the start (both halves of a double) */
  occupied: boolean[];
  /** cell index → a tile *starts* here (false for the right half of a double) */
  isAnchor: boolean[];
  /** top-left cell of each x2 bar */
  barAt: number[];
  /** top-left cell of the hatch lid, or -1 */
  lidAt: number;
  hiddenAt: boolean[];
  /** cell index → number of tiles the dispenser there will push out */
  dispAt: number[];
  /** cell index → which way that dispenser faces */
  dispDir: Dir[];
  dispHidden: boolean[][];
  /** Cells that anchor a linked pair; the cell to the right is its other half. */
  pairAt: boolean[];
  blockedAt: boolean[];
  /** casing: outside the silhouette, so the outline itself is the board's edge */
  wallAt: boolean[];
  /** total tray units, which is what stage B has to find colours and boxes for */
  units: number;
}

function structure(rng: Rng, p: Params): Structure {
  const { cols, rows } = p;
  const n = cols * rows;
  const occupied = new Array<boolean>(n).fill(false);
  const isAnchor = new Array<boolean>(n).fill(false);
  const barAt: number[] = [];
  let lidAt = -1;
  const hiddenAt = new Array<boolean>(n).fill(false);
  const dispAt = new Array<number>(n).fill(0);
  const dispDir = new Array<Dir>(n).fill("down");
  const dispHidden: boolean[][] = Array.from({ length: n }, () => []);
  const pairAt = new Array<boolean>(n).fill(false);
  const blockedAt = new Array<boolean>(n).fill(false);

  const dispCols = shuffle(
    rng,
    Array.from({ length: cols }, (_, j) => j),
  ).slice(0, p.dispensers);
  const held = dispCols.length * DISPENSER_HOLD;
  const target = Math.max(2, p.tiles - held);

  const isDisp = (x: number) => dispCols.includes(x);
  const firstRow = (x: number) => (isDisp(x) ? 1 : 0);

  // The block sits in a window of columns rather than spread over the whole grid: a "?" tile
  // only stays face-down while all four neighbours are occupied, and a scattered board
  // reveals the lot on the first frame. Pillars need the full width to fit their gaps.
  // Outlines only read as outlines at full width; a slab is better kept compact so its
  // interior can hold face-down tiles.
  const wideWindow =
    p.shape === "pillars" ||
    p.shape === "cross" ||
    p.shape === "frame" ||
    p.shape === "tee" ||
    p.shape === "diamond" ||
    p.shape === "arrow";
  const blockW = wideWindow ? cols : clamp(Math.round(Math.sqrt(target * 1.6)), 3, cols);
  const from = blockW >= cols ? 0 : (rng() * (cols - blockW + 1)) | 0;

  const bannedIn = (mask: boolean[], x: number, y: number): boolean => {
    if (!mask[y * cols + x]) return true;
    if (y < firstRow(x)) return true;
    // Battlement: alternate columns start one row lower, notching the top edge.
    if (p.shape === "castle" && (x - from) % 2 === 1 && y === firstRow(x)) return true;
    return false;
  };
  const roomIn = (mask: boolean[]): number => {
    let k = 0;
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (!bannedIn(mask, x, y)) k++;
    return k;
  };

  // ⚠ Fit the silhouette to the tray budget, do not draw it full-size and let the fill crop it.
  // The fill takes `target` cells top-down, and the budget (6-15) is half a 6x5 grid — so a
  // full-height diamond, cross, frame and tee all truncate to *the same* two-row slab and the
  // whole shape lever becomes invisible. Take the shortest height that still has room for the
  // board: the outline then comes out whole, just smaller.
  // ⚠ An outline needs an interior to be an outline. Squeezed to two rows a `frame` is every
  // cell border, i.e. a solid slab, and `cross` is its own bar — the shapes come out whole but
  // unrecognisable, which is the same bug in a smaller box.
  const minH =
    p.shape === "frame" ||
    p.shape === "cross" ||
    p.shape === "diamond" ||
    p.shape === "tee" ||
    p.shape === "arrow"
      ? 3
      : 2;
  // ⚠ A walled board needs slack inside the cavity, not a snug fit. With the outside solid the
  // only escape lanes left are the mask cells the fill did not take, so a mask sized exactly to
  // the budget seals every tray in on all four sides and the level is dead on arrival.
  const slack = p.walled ? Math.max(4, Math.round(target * 0.5)) : 0;
  const want = target + slack + (p.shape === "holes" ? 3 : 0);
  let mask = maskOf(p.shape, cols, rows, from, blockW, rows);
  for (let h = minH; h <= rows; h++) {
    const m = maskOf(p.shape, cols, rows, from, blockW, h);
    if (roomIn(m) >= want) {
      mask = m;
      break;
    }
  }
  const banned = (x: number, y: number): boolean => bannedIn(mask, x, y);

  // Fill by score, highest first: rows go top-down, and `steps` leans the fill to the right
  // so the block comes out as a staircase.
  const cand: { i: number; score: number }[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (banned(x, y)) continue;
      const lean = p.shape === "steps" ? (x - from) * 0.45 : 0;
      cand.push({ i: y * cols + x, score: -y + lean + rng() * 0.2 });
    }
  }
  cand.sort((a, b) => b.score - a.score);

  // `holes` overfills, then punches enclosed cells back out — the gaps land in the middle of
  // the slab, which is exactly where an escape lane is worth the most.
  const punches = p.shape === "holes" ? Math.min(3, Math.max(1, Math.floor(target / 5))) : 0;
  for (const c of cand.slice(0, target + punches)) occupied[c.i] = true;

  for (let k = 0; k < punches; k++) {
    const enclosed: number[] = [];
    for (let i = 0; i < n; i++) {
      if (!occupied[i]) continue;
      const x = i % cols;
      const y = (i / cols) | 0;
      const solid = (nx: number, ny: number) =>
        nx < 0 || ny < 0 || nx >= cols || ny >= rows || occupied[ny * cols + nx];
      if (solid(x - 1, y) && solid(x + 1, y) && solid(x, y - 1) && solid(x, y + 1)) {
        enclosed.push(i);
      }
    }
    if (!enclosed.length) break;
    occupied[pick(rng, enclosed)] = false;
  }

  // x2 bars go in an empty pair of cells with occupied cells above them — a bar with nothing
  // over it does nothing at all, and the player would rightly read that as a bug.
  if (p.bars > 0) {
    const spots: number[] = [];
    for (let i = 0; i < n; i++) {
      const x = i % cols;
      const y = (i / cols) | 0;
      if (x >= cols - 1) continue;
      if (occupied[i] || occupied[i + 1] || dispAt[i] > 0 || dispAt[i + 1] > 0) continue;
      let above = false;
      for (let r = 0; r < y && !above; r++) above = occupied[r * cols + x] || occupied[r * cols + x + 1];
      if (above) spots.push(i);
    }
    shuffle(rng, spots)
      .slice(0, p.bars)
      .forEach((i) => barAt.push(i));
  }

  // A hatch lid needs a 2x2 of *occupied* cells to sit over — those four trays are what it
  // hides, so they have to exist.
  if (p.lids > 0) {
    const spots: number[] = [];
    for (let i = 0; i < n; i++) {
      const x = i % cols;
      const y = (i / cols) | 0;
      if (x >= cols - 1 || y >= rows - 1) continue;
      const quad = [i, i + 1, i + cols, i + cols + 1];
      if (quad.every((k) => occupied[k] && dispAt[k] === 0)) spots.push(i);
    }
    if (spots.length) lidAt = pick(rng, spots);
  }

  for (let i = 0; i < n; i++) {
    if (!occupied[i]) continue;
    isAnchor[i] = true;
    hiddenAt[i] = rng() < p.hiddenFrac;
  }

  /** Cells a hatch pushes into. Nothing permanent may take one, or that hatch never empties. */
  const chuteCells = new Set<number>();
  for (const j of dispCols) {
    dispAt[j] = DISPENSER_HOLD;
    // ⚠ A hatch may only face a cell it can actually push into, and **no two may share one**.
    // Two separate bugs, both shipped:
    //
    //   - Aimed at another hatch, the target never frees, so it stood there holding all three
    //     trays forever (levels 20 and 29). Reported from play as "why is it pointing at another
    //     hatch".
    //   - Aimed at the *same* cell as another hatch, `assemble` keys its owner map by target
    //     cell, so the second hatch silently overwrites the first: on level 29 one ended up with
    //     six trays and the other with an empty queue. That one is invisible on the board — the
    //     empty hatch just never does anything — and it is why the face-down quota came up short.
    //
    // Sideways targets sit in row 0, whose cell index *is* the column index; `down` lands in row
    // 1 and is unique per column, so it can never collide either way. That makes it a safe
    // fallback when a hatch has no legal turn.
    const usable = p.hatchDirs.filter((d) => {
      const t = dispTarget(j, d, cols, rows);
      return t >= 0 && !dispCols.includes(t) && !chuteCells.has(t);
    });
    dispDir[j] = pick(rng, usable.length ? usable : ["down"]);
    chuteCells.add(dispTarget(j, dispDir[j], cols, rows));
    for (let k = 0; k < DISPENSER_HOLD; k++) dispHidden[j].push(rng() < p.hiddenFrac);
  }

  // One unit per covered cell, so a double is worth two — which means the marble budget is
  // just the cell count and stage B's bookkeeping does not change at all.
  // Crates go in cells the block does not use, adjacent to it — out in open space they would
  // be invisible, and inside it they would just be a smaller block.
  if (p.crates > 0) {
    const touching: number[] = [];
    for (let i = 0; i < n; i++) {
      // ⚠ A crate on a hatch's target cell seals the hatch just as thoroughly as another hatch
      // does — the casing pass already exempts these cells and the crate pass has to as well.
      if (occupied[i] || dispAt[i] > 0 || chuteCells.has(i)) continue;
      const x = i % cols;
      const y = (i / cols) | 0;
      const near =
        (x > 0 && occupied[i - 1]) ||
        (x < cols - 1 && occupied[i + 1]) ||
        (y > 0 && occupied[i - cols]) ||
        (y < rows - 1 && occupied[i + cols]);
      if (near) touching.push(i);
    }
    shuffle(rng, touching)
      .slice(0, p.crates)
      .forEach((i) => {
        blockedAt[i] = true;
      });
  }

  // On a walled board everything outside the silhouette is casing rather than open floor, so
  // the outline reads as the board's rim and the trays on it are hemmed in. Built last, once
  // crates, bars and the lid have taken their cells, and never over a dispenser column: the
  // hatch has to have somewhere to shove its trays or the level cannot finish.
  // ⚠ Only the *margin* becomes casing — everything the outline reaches around stays floor.
  //
  // A cell counts as inside if the silhouette has mask cells on both sides of it along its row
  // **or** along its column. That keeps two different kinds of negative space open: a hole the
  // outline encloses (`frame`'s hollow middle) and a channel that runs clean through it
  // (`pillars`' gaps). Both are the shape's own features — the open air that gives its trays a
  // lane — and sealing them inverts the silhouette lever instead of adding to it.
  //
  // Flooding in from the grid border, which is the obvious way to write this, gets the holes
  // right and the channels wrong: a channel touches the border, so it floods, and `pillars`
  // came out as separate towers with no way between them.
  const wallAt = new Array<boolean>(n).fill(false);
  if (p.walled) {
    const barCell = new Set(barAt.flatMap((b) => [b, b + 1]));
    // A hatch shoves its trays into the cell directly beneath it, one at a time — that single
    // cell has to stay floor or the level cannot finish. The rest of its column may be casing;
    // exempting the whole column is what left the outer columns standing open.
    const chute = chuteCells;

    const NONE = [Infinity, -Infinity];
    const rowSpan = Array.from({ length: rows }, () => [...NONE]);
    const colSpan = Array.from({ length: cols }, () => [...NONE]);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (!mask[y * cols + x]) continue;
        rowSpan[y][0] = Math.min(rowSpan[y][0], x);
        rowSpan[y][1] = Math.max(rowSpan[y][1], x);
        colSpan[x][0] = Math.min(colSpan[x][0], y);
        colSpan[x][1] = Math.max(colSpan[x][1], y);
      }
    }

    for (let i = 0; i < n; i++) {
      if (mask[i] || occupied[i] || blockedAt[i] || barCell.has(i)) continue;
      if (chute.has(i) || dispAt[i] > 0) continue;
      const x = i % cols;
      const y = (i / cols) | 0;
      const inRow = x >= rowSpan[y][0] && x <= rowSpan[y][1];
      const inCol = y >= colSpan[x][0] && y <= colSpan[x][1];
      if (!inRow && !inCol) wallAt[i] = true;
    }
  }

  // ⚠ The sheet asks for a *count* of face-down trays, and `hiddenFrac` is a probability — on a
  // fourteen-tray board it lands short of four often enough to matter. Top up deliberately.
  //
  // ⚠ And it has to be topped up **here**, after crates and casing are placed, using the engine's
  // own idea of a solid neighbour. A "?" beside an empty cell is face-up before the first frame,
  // so a quota filled with those satisfies the number and shows the player nothing — level 29
  // asked for three and settled with zero. Crates and walls count as solid to the reveal rule,
  // and both are placed after the trays, so testing enclosure any earlier reads a cell as exposed
  // that the finished board has sealed.
  if (p.hiddenMin > 0) {
    const solid = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= cols || y >= rows) return true;
      const k = y * cols + x;
      return occupied[k] || blockedAt[k] || wallAt[k] || dispAt[k] > 0;
    };
    const enclosed: number[] = [];
    const exposed: number[] = [];
    // ⚠ Count only the face-down trays that *survive*. `hiddenFrac` scatters `?` by probability
    // and most of them land on the block's outside edge, where the reveal rule flips them before
    // the first frame — counting those toward the quota is how level 29 shipped asking for three
    // and showing two.
    let alive = dispHidden.flat().filter(Boolean).length;
    for (let i = 0; i < n; i++) {
      if (!occupied[i]) continue;
      const x = i % cols;
      const y = (i / cols) | 0;
      // ⚠ The bottom row is open by definition — it sits on the mouth of the chute and drops
      // straight down, so the reveal rule flips a "?" there before the first frame however
      // solid its four neighbours are. Testing only the neighbours reads that row as the most
      // enclosed part of the board, which is where the top-up would then spend the whole quota.
      const open =
        y === rows - 1 || !solid(x - 1, y) || !solid(x + 1, y) || !solid(x, y - 1) || !solid(x, y + 1);
      if (hiddenAt[i]) {
        if (!open) alive++;
        continue;
      }
      (open ? exposed : enclosed).push(i);
    }
    let need = p.hiddenMin - alive;
    // Enclosed first — those are the ones that survive settling.
    for (const i of shuffle(rng, enclosed)) {
      if (need <= 0) break;
      hiddenAt[i] = true;
      need--;
    }
    // ⚠ Then the hatch queues, before falling back to exposed cells. A slab of eight trays four
    // wide has exactly two enclosed cells, so a quota of five is structurally unreachable on the
    // grid — and a tray that comes out of a hatch face-down is face-down to the player in every
    // way that counts. Spilling into the queues meets the sheet honestly; spilling into exposed
    // cells only meets the number, because those flip face-up before the first frame.
    for (const j of dispCols) {
      for (let k = 0; k < dispHidden[j].length && need > 0; k++) {
        if (dispHidden[j][k]) continue;
        dispHidden[j][k] = true;
        need--;
      }
    }
    for (const i of shuffle(rng, exposed)) {
      if (need <= 0) break;
      hiddenAt[i] = true;
      need--;
    }
  }

  // Linked pairs, last of the fixtures: two occupied cells side by side, clipped together.
  //
  // ⚠ Placed after bars, lids and crates so a pair can never straddle one of them. A pair covers
  // its right-hand cell — `isAnchor` there goes false — and if that cell also belonged to
  // something else, two things would claim it and `anchorAt` would hand taps to whichever
  // answered first.
  if (p.pairs > 0) {
    const spots: number[] = [];
    for (let i = 0; i < n; i++) {
      const x = i % cols;
      if (x >= cols - 1) continue;
      if (!occupied[i] || !occupied[i + 1]) continue;
      if (dispAt[i] > 0 || dispAt[i + 1] > 0) continue;
      if (blockedAt[i] || blockedAt[i + 1]) continue;
      if (barAt.some((b) => b === i || b + 1 === i || b === i + 1 || b + 1 === i + 1)) continue;
      if (lidAt >= 0 && [lidAt, lidAt + 1, lidAt + cols, lidAt + cols + 1].some((k) => k === i || k === i + 1)) continue;
      spots.push(i);
    }
    for (const i of shuffle(rng, spots)) {
      if (pairAt.filter(Boolean).length >= p.pairs) break;
      if (pairAt[i] || (i % cols > 0 && pairAt[i - 1]) || pairAt[i + 1]) continue;
      pairAt[i] = true;
      isAnchor[i + 1] = false;
    }
  }

  // A tray above a bar spends two units of the marble budget, because it drops twice as many.
  const isDoubled = (i: number) => {
    const x = i % cols;
    const y = (i / cols) | 0;
    return barAt.some((b) => {
      const bx = b % cols;
      const by = (b / cols) | 0;
      return by > y && (bx === x || bx + 1 === x);
    });
  };
  let units = dispCols.length * DISPENSER_HOLD;
  for (let i = 0; i < n; i++) if (occupied[i]) units += isDoubled(i) ? 2 : 1;

  return {
    cols,
    rows,
    occupied,
    isAnchor,
    barAt,
    lidAt,
    hiddenAt,
    dispAt,
    dispDir,
    dispHidden,
    pairAt,
    blockedAt,
    wallAt,
    units,
  };
}

// ── Stage A2: a tap order the board actually permits ─────────────────────────

export interface Tap {
  idx: number;
  /** a linked pair — two trays, two colours, one tap */
  pair?: boolean;
  /** stands above an x2 bar, so it spends two units */
  doubled: boolean;
}

/** Where in the tap order the hatch lid comes off, or -1 if there is no lid. */
let lidOpensAt = -1;

/**
 * Play the structure with the colours left blank: repeatedly clear a tray that is face-up
 * and has a lane out, and let dispensers and reveals settle. The result is an order the
 * player can physically follow. Returns null if the board would strand tiles.
 */
function tapOrder(rng: Rng, s: Structure): Tap[] | null {
  lidOpensAt = -1;
  const { cols, rows } = s;
  const n = cols * rows;

  /** cell → index of the tile covering it, or -1 */
  const anchorOf = new Array<number>(n).fill(-1);
  const lidCells =
    s.lidAt >= 0 ? [s.lidAt, s.lidAt + 1, s.lidAt + cols, s.lidAt + cols + 1] : [];
  const underLid = new Set(lidCells);
  const hidden = new Array<boolean>(n).fill(false);
  const queue: boolean[][] = Array.from({ length: n }, (_, i) => [...s.dispHidden[i]]);
  const dispLeft = [...s.dispAt];

  for (let i = 0; i < n; i++) {
    if (!s.occupied[i]) continue;
    if (s.isAnchor[i]) {
      anchorOf[i] = i;
      hidden[i] = s.hiddenAt[i];
      // The right half of a pair points back at the anchor: occupied, never its own tap, and
      // `free()` reports it taken because `anchorOf` is not negative.
      if (s.pairAt[i]) anchorOf[i + 1] = i;
    }
  }

  const isBar = (k: number) => s.barAt.some((b) => k === b || k === b + 1);
  // While the lid is on, its cells are as solid as a crate.
  const free = (k: number) =>
    !s.blockedAt[k] &&
    !s.wallAt[k] &&
    !isBar(k) &&
    !underLid.has(k) &&
    anchorOf[k] < 0 &&
    dispLeft[k] === 0;
  // ⚠ Was a stub returning 1. It has to be real for linked pairs or the escape test reads only
  // the left cell, and the generator hands out a tap order the real board refuses.
  const span = (a: number) => (s.pairAt[a] ? 2 : 1);

  const settle = () => {
    for (let pass = 0; pass < 8; pass++) {
      let changed = false;

      for (let i = 0; i < n; i++) {
        if (dispLeft[i] <= 0) continue;
        const out = dispTarget(i, s.dispDir[i], cols, rows);
        if (out < 0 || !free(out)) continue;
        anchorOf[out] = out;
        hidden[out] = queue[i].shift() ?? false;
        dispLeft[i]--;
        changed = true;
      }

      // ⚠ The reveal test *is* the escape test — see `Game.canEscape`. A tray with a way out
      // stands its eggs proud, and a "?" that looks tappable and is not is the one thing the
      // tray art must never say. `canEscape` is declared below; it only reads `free`/`span`,
      // both of which are already closed over here.
      for (let a = 0; a < n; a++) {
        if (anchorOf[a] !== a || !hidden[a]) continue;
        if (canEscape(a)) {
          hidden[a] = false;
          changed = true;
        }
      }

      if (!changed) break;
    }
  };

  // Same escape test as Game.canEscape — the generator must not hand out a tap order the
  // real board would refuse, or a "proven" level jams on its own solution.
  const canEscape = (a: number) => {
    const x0 = a % cols;
    const y = (a / cols) | 0;
    const x1 = x0 + span(a) - 1;
    // The bottom row sits on the mouth of the chute and drops straight down.
    if (y === rows - 1) return true;
    if (x0 > 0 && free(y * cols + x0 - 1)) return true;
    if (x1 < cols - 1 && free(y * cols + x1 + 1)) return true;
    for (let c = x0; c <= x1; c++) {
      if (y > 0 && free((y - 1) * cols + c)) return true;
      if (y < rows - 1 && free((y + 1) * cols + c)) return true;
    }
    return false;
  };

  const isDoubled = (i: number) => {
    const x = i % cols;
    const y = (i / cols) | 0;
    return s.barAt.some((b) => {
      const bx = b % cols;
      const by = (b / cols) | 0;
      return by > y && (bx === x || bx + 1 === x);
    });
  };

  settle();
  let startAnchors = 0;
  for (let a = 0; a < n; a++) if (anchorOf[a] === a && !underLid.has(a)) startAnchors++;
  const taps: Tap[] = [];
  let units = 0;
  while (units < s.units) {
    const open: number[] = [];
    for (let a = 0; a < n; a++) {
      if (underLid.has(a)) continue;
      if (anchorOf[a] === a && !hidden[a] && canEscape(a)) open.push(a);
    }
    // Take the lid off around the middle of the board rather than at the very end. Waiting
    // until nothing else is reachable put the counter at 25 of a level's 36 box clears, which
    // reads as a wall you stare at rather than a door that opens partway through.
    const left = open.length;
    if (underLid.size && left <= Math.ceil(startAnchors * 0.45)) {
      lidOpensAt = taps.length;
      underLid.clear();
      settle();
      continue;
    }
    if (!open.length && underLid.size) {
      lidOpensAt = taps.length;
      underLid.clear();
      settle();
      continue;
    }
    if (!open.length) return null;
    const a = pick(rng, open);
    anchorOf[a] = -1;
    // Both halves leave together, so the right cell has to free with the left or the board
    // keeps a phantom tray nothing can tap.
    if (s.pairAt[a]) anchorOf[a + 1] = -1;
    const w = (s.pairAt[a] ? 2 : 1) * (isDoubled(a) ? 2 : 1);
    taps.push({ idx: a, doubled: isDoubled(a), pair: s.pairAt[a] });
    units += w;
    settle();
  }
  return taps;
}

// ── Stage B: colours and box stacks ──────────────────────────────────────────
// Colours are painted onto the fixed tap order while a coarse belt model runs alongside,
// and each box is opened only when there is something on the belt worth opening it for.
// The level is therefore assembled *from* a solution rather than searched for afterwards.

interface Painted {
  tapColors: Color[];
  /** the right half's colour for a linked-pair tap, null otherwise */
  tapMates: (Color | null)[];
  columns: Color[][];
  /** boxes cleared before the lid comes off — the counter printed on it */
  lidNeed: number;
  /** the same, counted per colour, for a single-colour lid */
  lidNeedByColor: number[];
}

function paint(
  rng: Rng,
  p: Params,
  taps: Tap[],
  units: number,
  lidAtTap: number,
): Painted | null {
  const colors = Array.from({ length: p.colors }, (_, i) => i);
  if (units < p.colors) return null;

  // Tray units per colour, every colour getting at least one.
  const trays = new Array<number>(p.colors).fill(1);
  for (let i = p.colors; i < units; i++) trays[(rng() * p.colors) | 0]++;

  const pool: Color[] = [];
  trays.forEach((n, c) => {
    for (let i = 0; i < n; i++) pool.push(c);
  });
  shuffle(rng, pool);

  const boxNeed = trays.map((n) => (n * TRAY_N) / BOX_SLOTS);
  const totalBoxes = boxNeed.reduce((a, b) => a + b, 0);
  const colCap = new Array<number>(BOX_COLS).fill(Math.floor(totalBoxes / BOX_COLS));
  for (let i = 0; i < totalBoxes % BOX_COLS; i++) colCap[i]++;

  const columns: Color[][] = Array.from({ length: BOX_COLS }, () => []);
  const active: (Color | null)[] = new Array(BOX_COLS).fill(null);
  const filled = new Array<number>(BOX_COLS).fill(0);
  const belt = new Array<number>(p.colors).fill(0);
  const beltSize = () => belt.reduce((a, b) => a + b, 0);

  const openBoxes = () => {
    for (let j = 0; j < BOX_COLS; j++) {
      if (active[j] !== null || columns[j].length >= colCap[j]) continue;
      const eligible = colors.filter((c) => boxNeed[c] > 0);
      if (!eligible.length) continue;
      // Normally serve whatever is piling up on the belt; being deliberately careless some
      // of the time is what stops every level from being a gimme.
      let c: Color;
      const onBelt = eligible.filter((k) => belt[k] > 0);
      if (onBelt.length && rng() > p.sloppy) {
        c = onBelt.reduce((a, b) => (belt[b] > belt[a] ? b : a));
      } else {
        c = pick(rng, eligible);
      }
      boxNeed[c]--;
      columns[j].push(c);
      active[j] = c;
      filled[j] = 0;
    }
  };

  // Box completions so far, total and per colour. The lid counter is read off these.
  let cleared = 0;
  const clearedBy = new Array<number>(p.colors).fill(0);
  let lidNeed = 0;
  let lidNeedByColor = new Array<number>(p.colors).fill(0);

  const drain = (): boolean => {
    let moved = false;
    for (let guard = 0; guard < 5000; guard++) {
      let step = false;
      for (let j = 0; j < BOX_COLS; j++) {
        const c = active[j];
        if (c === null || belt[c] <= 0) continue;
        belt[c]--;
        filled[j]++;
        step = true;
        moved = true;
        if (filled[j] >= BOX_SLOTS) {
          cleared++;
          clearedBy[c]++;
          active[j] = null;
          filled[j] = 0;
        }
      }
      openBoxes();
      if (!step) break;
    }
    return moved;
  };

  openBoxes();
  const tapColors: Color[] = [];
  const tapMates: (Color | null)[] = [];

  /**
   * What a chocolate box's counter would read if it were set to come off right here.
   *
   * ⚠ Counted in **trays tipped**, matching `Game.creditLids` — it used to be counted in boxes
   * cleared, and a tray is nine marbles against a box's three, so the same line offers roughly
   * three times as many box-clears as tray-taps. A counter written on one clock is meaningless
   * on the other, and the number is the whole of what the player is told.
   *
   * A linked pair counts **twice**, once per half, because that is what `creditLids` does with
   * the two colours it pours.
   */
  const creditsSoFar = () => {
    const byColor = new Array<number>(p.colors).fill(0);
    for (const c of tapColors) byColor[c]++;
    for (const m of tapMates) if (m !== null) byColor[m]++;
    const total = tapColors.length + tapMates.filter((m) => m !== null).length;
    return { total, byColor };
  };

  let t = -1;
  for (const tap of taps) {
    t++;
    if (t === lidAtTap) {
      const so = creditsSoFar();
      lidNeed = so.total;
      lidNeedByColor = so.byColor;
    }
    // Units per half. A pair is two halves; a bar doubles each of them.
    const half = tap.doubled ? 2 : 1;
    const w = half * (tap.pair ? 2 : 1);
    const load = w * TRAY_N;

    // Make room for the tray that is about to fall.
    for (let guard = 0; beltSize() + load > BELT_SLOTS; guard++) {
      if (guard > 40 || !drain()) return null;
    }

    // A double empties two units of the *same* colour at once, so it can only be painted a
    // colour with two units still unspent.
    const left = new Array<number>(p.colors).fill(0);
    for (const c of pool) left[c]++;
    const openColors = new Set(active.filter((c): c is Color => c !== null));
    // Prefer emptying a tray a box is currently waiting on, so the belt keeps flowing.
    const take = (need: number): Color | null => {
      const candidates = colors.filter((k) => left[k] >= need);
      if (!candidates.length) return null;
      const wanted = candidates.filter((k) => openColors.has(k));
      const c = wanted.length && rng() > p.sloppy ? pick(rng, wanted) : pick(rng, candidates);
      for (let k = 0; k < need; k++) pool.splice(pool.indexOf(c), 1);
      left[c] -= need;
      return c;
    };

    const c = take(half);
    if (c === null) return null;
    // ⚠ The two halves are drawn separately. Spending one colour for the whole pair would make
    // it an ordinary double-load tray and throw away the only thing the piece is for.
    const mate = tap.pair ? take(half) : null;
    if (tap.pair && mate === null) return null;

    tapColors.push(c);
    tapMates.push(mate);
    belt[c] += half * TRAY_N;
    if (mate !== null) belt[mate] += half * TRAY_N;
    drain();
  }

  // Everything has been tapped; the belt must now empty completely.
  for (let guard = 0; beltSize() > 0; guard++) {
    if (guard > 200 || !drain()) return null;
  }
  if (boxNeed.some((n) => n > 0)) return null;
  if (lidAtTap >= 0 && lidAtTap >= taps.length) {
    const so = creditsSoFar();
    lidNeed = so.total;
    lidNeedByColor = so.byColor;
  }

  return { tapColors, tapMates, columns, lidNeed, lidNeedByColor };
}

// ── Assembly + proof ─────────────────────────────────────────────────────────

function assemble(
  level: number,
  p: Params,
  s: Structure,
  taps: Tap[],
  q: Painted,
  rng: Rng,
): LevelDef {
  const n = p.cols * p.rows;
  const tiles: (Tile | null)[] = new Array(n).fill(null);
  const disp: (Dispenser | null)[] = new Array(n).fill(null);

  const seen = new Set<number>();
  const dispOwner = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    if (s.dispAt[i] > 0) {
      disp[i] = { queue: [], hiddenQ: [], dir: s.dispDir[i] };
      const out = dispTarget(i, s.dispDir[i], p.cols, p.rows);
      if (out >= 0) dispOwner.set(out, i);
    }
  }

  // Walk the tap order forward and drop each tap's colour where that tap happened. A cell
  // fed by a dispenser is tapped more than once, so later visits fill the dispenser queue —
  // which is why the first visit has to match an *anchor* of the starting board, not just
  // any occupied cell (the right half of a double is occupied but never tapped).
  taps.forEach((tap, t) => {
    const color = q.tapColors[t];
    if (s.isAnchor[tap.idx] && !seen.has(tap.idx)) {
      seen.add(tap.idx);
      const mate = q.tapMates[t];
      tiles[tap.idx] = {
        color,
        hidden: s.hiddenAt[tap.idx],
        wide: mate !== null,
        mate: mate ?? undefined,
      };
      return;
    }
    const owner = dispOwner.get(tap.idx);
    if (owner !== undefined && disp[owner]) {
      const d = disp[owner]!;
      d.queue.push(color);
      d.hiddenQ.push(s.dispHidden[owner][d.queue.length - 1] ?? false);
    }
  });

  const used = new Set<Color>();
  q.columns.forEach((st) => st.forEach((c) => used.add(c)));

  // Hide a share of each column below its top box. Index 0 is never hidden: the player must
  // always be able to see what is currently being filled.
  // ⚠ Through `boxHiddenFrom` as well, so a generated board and a hand-built one at the same level
  // number hide the same share. Two rules would mean the piece meant something different depending
  // on which half of the ladder you were standing on.
  const bhFrac = boxHiddenFrom(level, targetWin(level), p.boxHiddenFrac);
  const boxHidden = q.columns.map((stack) =>
    stack.map((_, k) => k > 0 && rng() < bhFrac),
  );

  // Lift the lid's four trays off the grid and park them behind the counter.
  const lids: Lid[] = [];
  if (s.lidAt >= 0) {
    const cells = [s.lidAt, s.lidAt + 1, s.lidAt + p.cols, s.lidAt + p.cols + 1];
    const under = cells.map((c) => tiles[c]).filter((t): t is Tile => !!t);
    if (under.length === 4) {
      cells.forEach((c) => {
        tiles[c] = null;
      });
      // Rainbow counts every tray tipped; a single-colour box only counts its own, so its counter
      // is read off that colour's tally or it would never reach zero.
      const rainbow = rng() < 0.5;
      // For a single-colour box, take the colour tipped most often by the opening point.
      // ⚠ Using whichever colour happened to be *under* the box is doubly wrong: those four trays
      // cannot be tapped while it is closed, so they never count toward opening it — and the
      // counters it produced were 1, technically a gate but one the player passes without
      // noticing it was there.
      let colour = 0;
      q.lidNeedByColor.forEach((v, c) => {
        if (v > q.lidNeedByColor[colour]) colour = c;
      });
      const need = rainbow ? q.lidNeed : q.lidNeedByColor[colour];
      lids.push({
        at: s.lidAt,
        need: Math.max(2, need),
        color: rainbow ? null : colour,
        tiles: under,
      });
    }
  }

  return {
    level,
    cols: p.cols,
    rows: p.rows,
    tiles,
    lids,
    bars: [...s.barAt],
    disp,
    blocked: [...s.blockedAt],
    wall: [...s.wallAt],
    boxHidden,
    columns: q.columns,
    colors: [...used].sort((a, b) => a - b),
    shape: p.shape,
    refTaps: taps.map((t) => t.idx),
  };
}

/**
 * Replay the generator's own tap order through the real engine. This is the proof — the
 * coarse belt model in stage B ignores where marbles physically sit on the ring, and the
 * real one does not.
 */
export function verify(def: LevelDef): boolean {
  const g = new Game(def);
  for (const idx of def.refTaps) {
    let guard = 0;
    while (!g.canTap(idx) && g.status === "play" && guard++ < 3000) {
      g.arriveAll();
      g.tick();
    }
    if (!g.canTap(idx)) return false;
    g.tap(idx);
    g.arriveAll();
  }
  let guard = 0;
  while (g.status === "play" && guard++ < 20000) {
    g.arriveAll();
    g.tick();
  }
  return g.status === "won";
}

/**
 * Play the board the way a person would — best guess at each step, sometimes holding a tray
 * back rather than filling the hopper — and report how often that wins.
 *
 * `verify` only proves a board is *solvable*, which is not the same as *playable*: a level can
 * pass verification on the generator's own recorded line and still be a board no one can
 * actually read their way through. Levels 21 and 27 both did exactly that, winning 7% and 0%
 * of 120 played games while being formally proven.
 */
function playableRate(def: LevelDef, runs: number, need = 0): number {
  let wins = 0;
  for (let r = 0; r < runs; r++) {
    // Stop as soon as the verdict cannot change. Most candidates are decided in three or four
    // games, and this is the difference between a level loading instantly and visibly hitching
    // on a phone.
    if (need > 0) {
      if (wins >= need) break;
      if (wins + (runs - r) < need) break;
    }
    const rng = mulberry32(def.level * 2654435761 + r * 40503 + 7);
    const patient = r % 2 === 1;
    const g = new Game(def);
    for (let ticks = 0; g.status === "play" && ticks < 40000; ticks++) {
      let open: number[] = [];
      for (let i = 0; i < g.tiles.length; i++) if (g.canTap(i)) open.push(i);
      if (patient) open = open.filter((i) => g.beltFree() >= g.load(i));
      if (open.length) {
        let pick = open[0];
        let bestScore = -Infinity;
        for (const i of open) {
          const c = g.tiles[i]!.color;
          let want = 0;
          for (const b of g.boxes) {
            if (b.stack.length && b.stack[0] === c) want += BOX_SLOTS - b.filled;
          }
          let onBelt = 0;
          for (const k of g.belt) if (k === c) onBelt++;
          const score = want * 10 - onBelt + rng() * 0.5;
          if (score > bestScore) {
            bestScore = score;
            pick = i;
          }
        }
        g.tap(pick);
        g.arriveAll();
      }
      g.tick();
    }
    if (g.status === "won") wins++;
  }
  return wins / runs;
}

/**
 * Floor a generated board has to clear before it ships — and it has to move with the target.
 * A flat 25% would reject every level aimed at 30% for being exactly as hard as asked, and
 * quietly drag the whole late game back up the curve.
 */
function minPlayable(d: number, level?: number): number {
  // A spike is meant to be a wall, so the floor drops for it — but never to zero: even a wall
  // has to be beatable, or it is just a dead end with a retry button.
  if (level != null && SPIKES.has(level)) return 0.06;
  return clamp(0.3 - d * 0.18, 0.12, 0.3);
}

/** Recover the difficulty scalar from a parameter set, so the floor works for any of them. */
function pDifficulty(p: Params): number {
  return clamp((p.colors - 3) / 5, 0, 1);
}

/**
 * Boards already built this session. A level is a pure function of its number, and the scene
 * rebuilds it on every restart — most take under 200ms, but one in twenty exhausts the search
 * and costs closer to a second, which is a visible hitch every time the player retries.
 */
const memo = new Map<number, LevelDef>();

/** Build (and prove) the board for a level number. Deterministic: same number, same board. */
export function makeLevel(level: number): LevelDef {
  const key = Math.max(1, Math.round(level));
  const hit = memo.get(key);
  if (hit) return hit;
  const def = makeLevelWith(key, params(key), variantFor(key));
  // Bounded: a session that walks 200 levels should not hold 200 boards.
  if (memo.size > 24) memo.delete(memo.keys().next().value!);
  memo.set(key, def);
  return def;
}

/**
 * The same builder, driven by explicit parameters. This is what `npm run tune` searches over
 * and what the shape comparison uses — measuring a lever means holding every other one still,
 * which is impossible if the only entry point derives its parameters from the level number.
 */
export function makeLevelWith(level: number, p: Params, variant = 0): LevelDef {
  let fallback: LevelDef | null = null;
  let fallbackRate = -1;
  for (let attempt = 0; attempt < 400; attempt++) {
    const rng = mulberry32(level * 0x9e3779b1 + attempt * 0x85ebca6b + variant * 0x27d4eb2d + 12345);
    const s = structure(rng, p);
    if (s.units < p.colors) continue;
    const taps = tapOrder(rng, s);
    if (!taps) continue;
    const q = paint(rng, p, taps, s.units, lidOpensAt);
    if (!q) continue;
    const def = assemble(level, p, s, taps, q, rng);
    // ⚠ Backstop for the hatch invariants. A hatch that ends up holding nothing is invisible on
    // the board — it just sits there and never does anything — so the only way this ever surfaced
    // was a face-down-tray count coming up one short. `structure` guarantees each hatch a target
    // cell of its own now; this is here so the next thing that breaks it fails loudly instead.
    if (def.disp.some((d) => d && d.queue.length === 0)) continue;

    // Playability first, and it *replaces* verify() rather than following it.
    //
    // A bot that wins the board has solved it — that is a stronger proof than replaying the
    // generator's own recorded line, and it is the only one that also shows a player could
    // find it. Running verify() first meant paying for a full replay on every candidate that
    // was then thrown out anyway, which had level 9 taking 2.7 seconds to generate.
    const runs = 12;
    const floor = minPlayable(pDifficulty(p), level);
    const rate = playableRate(def, runs, Math.ceil(runs * floor));
    if (rate >= floor) return def;
    if (rate > fallbackRate) {
      fallbackRate = rate;
      fallback = def;
    }
  }
  // Nothing cleared the playability bar in 400 tries. Ship the most playable board seen rather
  // than dropping to level 1, which would silently rob the player of the level they asked for
  // — but ONLY if a bot actually won it at least once. A board no bot ever cleared is not
  // proven solvable at all, and shipping it would quietly reintroduce the one thing this
  // generator exists to prevent.
  if (fallback && fallbackRate > 0) return fallback;
  if (fallback && verify(fallback)) return fallback;
  if (level !== 1) return makeLevel(1);
  throw new Error("level generator could not produce a solvable board");
}
