// The whole game, with no Phaser in it.
//
// GameScene owns pixels and physics; this file owns truth. Keeping them apart is what
// lets scripts/sim.mjs play thousands of levels a second to check they are solvable and
// to tune difficulty — driving the real scene costs ~30s per data point, which is far too
// slow to sample more than once or twice.

import type { Rec } from "./replay";
import {
  BELT_SLOTS,
  CHUTE_CAP,
  BOX_COLS,
  BOX_SLOTS,
  SLOT_COLUMN,
  STAR_ALWAYS_TO,
  STAR_TWO_TRIES,
  TRAY_N,
  type Color,
  type GridBox,
} from "./config";

/** Marbles the magnet can hold off-belt at once. */
export const MAGNET_N = 6;

/** Boxes a revive takes off the board. */
export const REVIVE_BOXES = 2;
/**
 * Marbles a revive clears off the belt. Not an independent dial: a box is `BOX_SLOTS` holes, and
 * the marbles have to leave with the box that wanted them — see `Game.revivePlan`.
 */
export const REVIVE_MARBLES = REVIVE_BOXES * BOX_SLOTS;

/** One box a revive removes, and the belt slots that empty with it. */
export interface RevivePick {
  col: number;
  /** where it sits in its column — 0 is the open box on top, 1 is row 2 of the well */
  idx: number;
  color: Color;
  /** belt slots this box takes with it, `BOX_SLOTS` of them */
  slots: number[];
}


export interface Tile {
  color: Color;
  /** true while the player cannot see the colour — a "?" tile. Hidden tiles cannot be tapped. */
  hidden: boolean;
  /**
   * A **linked pair**: two trays clipped together, covering this cell and the one to its right.
   * One tap empties both, and they carry different colours — `color` on the left, `mate` on the
   * right. Stored once, at the left cell; `anchorAt` is what makes the right cell answer for it.
   *
   * ⚠ Not the same thing as an x2 bar. A bar is a fixture bolted to the board that doubles every
   * tray *above* it; this is one object made of two trays, and the two stack: a linked pair over
   * a bar drops four trays' worth.
   */
  wide: boolean;
  /** Right half's colour. Absent means the same as `color` — how boards written before linked
   *  pairs existed still parse. */
  mate?: Color;
  /**
   * An **arrow lock**: this tray is sealed until the cell the arrow points at is empty.
   *
   * The arrow is drawn on the tray's face pointing at its neighbour, and the rule is exactly what
   * the picture says — pour *that* one first and this one wakes up. While it is on, the tray taps
   * like a `?`: not at all, and its eggs lie flat, because raised eggs are the board's promise that
   * a tray will move.
   *
   * ⚠ **It clears for good, like a `?` reveal — it does not come back.** A hatch can push a new
   * tray into the cell that was emptied, and a lock that snapped shut again after the player had
   * already satisfied it would be the board taking back something it had given. `settleInto` clears
   * the field rather than deriving the state each time, so there is nothing left to re-close.
   *
   * ⚠ **An arrow pointing off the board, or at casing, a crate or a bar, never opens.** Nothing in
   * the engine refuses that — it is a legal board that cannot be won — so the editor rejects it as
   * fatal and `custom.ts` checks it on every keystroke.
   */
  arrow?: ArrowDir;
}

/**
 * A chocolate box: a 2x2 plate sitting over four trays, with a counter on its face.
 *
 * The counter comes down by one every time a **tray is emptied** — any tray if `color` is null
 * (the rainbow border), or only a tray of that colour otherwise. At zero the box bursts and the
 * four trays underneath join the board.
 *
 * ⚠ It counts **trays tipped, not boxes filled**. That was the other way round first, and the two
 * are wildly different clocks: a tray is `TRAY_N` = 9 marbles and a box holds `BOX_SLOTS` = 3, so
 * the same board offers three times as many box-clears as tray-taps and a counter written for one
 * is meaningless on the other. The rule the player is told is "how many trays you have to pour",
 * so that is what the number has to be.
 *
 * ⚠ **A single-colour counter can outrun its own supply.** The trays under the box cannot be
 * tapped while it is closed, so they never count toward opening it — `need` has to be reachable
 * from the trays *outside*, including hatch queues, or the box never opens and the level is
 * unwinnable. `isWon` refuses to finish while any box is still on the board, so this is not a
 * soft failure.
 *
 * While it is closed its four cells are as good as crates: nothing taps them, and they block
 * escape lanes and "?" reveals for everything around them.
 */
export interface Lid {
  /** top-left of the 2x2 it covers */
  at: number;
  need: number;
  /** null = rainbow border, i.e. a tray of any colour counts */
  color: Color | null;
  /** the four trays underneath, in reading order */
  tiles: Tile[];
}

/** Which way a hatch faces. Its shutter is on that side and its trays come out there. */
export type Dir = "down" | "left" | "right";

/**
 * Four ways, for the arrow lock.
 *
 * ⚠ Wider than `Dir` on purpose: a hatch shutter can never face **up** — it would push a tray into
 * the cell above and there is nothing there to catch it — but an arrow only points, so all four
 * make sense. Keeping them one type would either give hatches an illegal direction or leave the
 * arrow unable to say "the one above".
 */
export type ArrowDir = Dir | "up";

/** The neighbouring cell in `dir`, or -1 if that is off the board. */
export function stepTarget(i: number, dir: ArrowDir, cols: number, rows: number): number {
  const x = i % cols;
  const y = (i / cols) | 0;
  if (dir === "left") return x > 0 ? i - 1 : -1;
  if (dir === "right") return x < cols - 1 ? i + 1 : -1;
  if (dir === "up") return y > 0 ? i - cols : -1;
  return y < rows - 1 ? i + cols : -1;
}

/** Sits in a cell and pushes tiles into the neighbouring cell it faces, as that cell empties. */
export interface Dispenser {
  queue: Color[];
  hiddenQ: boolean[];
  /** Absent means "down" — every board built before hatches could turn. */
  dir?: Dir;
}

/** The cell a hatch at `i` pushes into, or -1 if it faces off the board. */
export function dispTarget(i: number, dir: Dir | undefined, cols: number, rows: number): number {
  return stepTarget(i, dir ?? "down", cols, rows);
}

export interface LevelDef {
  level: number;
  cols: number;
  rows: number;
  /**
   * cols*rows — a crate. Permanently in the way: never holds a tray, never clears, and counts
   * as occupied for both escape lanes and "?" reveals. It is the only board element the player
   * can do nothing at all about, which is what makes it shape a level rather than pace one.
   */
  blocked: boolean[];
  /**
   * cols*rows — cells that are not part of the board at all: solid machine casing.
   *
   * Mechanically identical to a crate, but it is a different thing to the player and has to
   * look like one. A crate is an obstacle *inside* the board; a wall **is the board's edge**,
   * and the edge is not an exit. On a walled level the silhouette's outline is a hard rim, so
   * a tray on the outside of a `diamond` is hemmed in rather than free to slide into the space
   * beside it — which is the whole point of asking for it.
   */
  wall: boolean[];
  /**
   * Per column, per box: hide this box's colour until it reaches the top of its stack. The
   * information the player is missing, not a rule change — a hidden box still behaves exactly
   * like the colour it is.
   */
  boxHidden: boolean[][];
  /** cols*rows, row-major */
  tiles: (Tile | null)[];
  /** cols*rows, row-major */
  disp: (Dispenser | null)[];
  /** closed lids, each covering a 2x2 of cells */
  lids: Lid[];
  /**
   * x2 bars, by the top-left of the two cells each spans.
   *
   * A bar is a fixture bolted to the board, not a tray: it never clears, and every tray in
   * either of its two columns *above* it empties twice the marbles. That is why it is stored
   * as a board feature and read by `load()` rather than as a flag on the tiles — which tiles
   * are doubled changes as the board empties and refills from a hatch.
   */
  bars: number[];
  /** BOX_COLS stacks of box colours; index 0 of each is the active box */
  columns: Color[][];
  /** palette indices this level draws from */
  colors: Color[];
  /**
   * Hand-marked as far harder than its neighbours — see `Blueprint.hard`. Presentation only; no
   * rule reads it, and the headless sim is unaffected.
   */
  hard?: boolean;
  /**
   * The difficulty badge this board carries, overriding the one its slot number would give it.
   *
   * `"none"` is a real value and the reason this is not just a second boolean: the number rule in
   * `levelTag` labels every 15th level SUPER HARD whatever is standing there, so a board moved into
   * such a slot needs a way to say the promise does not apply to it. Absent means "let the slot
   * decide", which is what almost every board wants.
   *
   * ⚠ Presentation only, exactly like `hard`. Nothing in the engine reads it and the bots cannot
   * see it, so it can never move a measured winrate.
   */
  tag?: "hard" | "superhard" | "none";
  /** silhouette the board was built from — reporting only, the engine never reads it */
  shape?: string;
  /** the tap order the generator solved it with — proof it is winnable, and the hint source */
  refTaps: number[];
}

export interface BoxCol {
  stack: Color[];
  filled: number;
}

export interface MatchEvent {
  slot: number;
  col: number;
  color: Color;
  /** holes filled after this marble landed, 1..BOX_SLOTS */
  filled: number;
  /** the box completed and popped off */
  popped: boolean;
}

export interface TickEvents {
  /** where the board stands after this tick — the scene reacts to won/lost from here */
  status: Status;
  matched: MatchEvent[];
  entered: Color | null;
  released: Color[];
  emitted: number[];
  revealed: number[];
  /** trays whose arrow lock opened this tick */
  unlocked: number[];
  /** lids that came off this tick, by their top-left cell */
  opened: number[];
}

export interface Snapshot {
  lids: string;
  boxHidden: string;
  tiles: string;
  disp: string;
  belt: (Color | null)[];
  fresh: boolean[];
  boxes: string;
  pending: Color[];
  inFlight: Color[];
  magnet: Color[];
  taps: number;
  maxBelt: number;
}

export type Status = "play" | "won" | "lost";

/**
 * The bounding box of the cells that are part of the board — everything else is casing.
 *
 * ⚠ Casing only. A crate is *inside* the board and counts, which is the same distinction
 * `drawGridCavity` draws and `cellFree` enforces; dropping crates out of the box would shrink the
 * cavity away from an obstacle the player can see.
 */
export function boardBounds(def: LevelDef): GridBox {
  const wall = def.wall ?? [];
  let x0 = def.cols;
  let y0 = def.rows;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < def.rows; y++) {
    for (let x = 0; x < def.cols; x++) {
      if (wall[y * def.cols + x]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  // A board that is casing end to end cannot be played, but it must still be drawable.
  if (x1 < 0) return { x: 0, y: 0, w: def.cols, h: def.rows };
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export class Game {
  readonly def: LevelDef;
  readonly cols: number;
  readonly rows: number;

  tiles: (Tile | null)[];
  disp: (Dispenser | null)[];
  lids: Lid[];
  bars: number[];
  blocked: boolean[];
  wall: boolean[];
  boxHidden: boolean[][];
  boxes: BoxCol[];

  /** Ring of conveyor positions. Slot 0 is under the funnel; contents shift 0→1→2… */
  belt: (Color | null)[];
  /**
   * Marbles that entered on the *current* tick. They have no previous slot to glide from,
   * so the renderer parks them on the entry instead of interpolating from off-track.
   */
  fresh: boolean[];

  /** Reached the bottom of the funnel, queued for the next free entry slot. */
  pending: Color[];
  /** Still tumbling down the funnel. Purely a reservation as far as logic is concerned. */
  inFlight: Color[];
  /** Held by the magnet booster; returns to the belt once a matching box opens. */
  magnet: Color[];

  status: Status = "play";
  taps = 0;
  /**
   * Ticks since the level began.
   *
   * ⚠ **Monotonic — deliberately not in `Snapshot`, so undo does not rewind it.** It timestamps
   * the replay log, and a replay is a record of what the player did in the order they did it. A
   * counter that went backwards on undo would stamp two different moves with the same tick and
   * the log could no longer be replayed at all.
   */
  ticks = 0;
  /**
   * Optional move recorder. Null in the headless sim and in every bot — only the real game attaches
   * one.
   *
   * ⚠ **Hooked here, inside the engine, not at the call sites in `GameScene`.** Three separate
   * paths call `arrive()` (the neck, the timeout backstop, and the marble that escaped the chute)
   * and a fourth would be added the next time the physics needed one. Recording from the mutator
   * means the fourth is covered for free — the same reasoning as the `paused` setter emitting the
   * gameplay signal.
   */
  rec: Rec | null = null;
  /** Peak belt occupancy over the run — the metric the star rating is scored on. */
  maxBelt = 0;
  /**
   * Chocolate boxes the most recent `tap` burst, by their top-left cell.
   *
   * Transient: read it straight after the tap or not at all. It exists because a box now comes
   * off on the tap itself, and the scene needs to know which one to play the burst on.
   */
  lastOpened: number[] = [];
  /**
   * Arrow locks the most recent `tap` opened.
   *
   * ⚠ **Same channel, and for the same reason as `lastOpened`.** The unlock happens on the pour —
   * that is the entire rule, "empty this one and that one wakes" — and the marbles then spend
   * seconds falling. A scene that waited for the next `tick` to animate it would leave the arrow
   * sitting on a tray the model had already freed, which reads as the tap not having worked.
   */
  lastUnlocked: number[] = [];

  constructor(def: LevelDef) {
    this.def = def;
    this.cols = def.cols;
    this.rows = def.rows;
    this.tiles = def.tiles.map((t) => (t ? { ...t } : null));
    // ⚠ Spread, don't list the fields. Rebuilding the object by hand is how `dir` got dropped
    // the first time: every hatch kept facing down however the board was drawn, silently.
    this.disp = def.disp.map((d) =>
      d ? { ...d, queue: [...d.queue], hiddenQ: [...d.hiddenQ] } : null,
    );
    this.lids = (def.lids ?? []).map((l) => ({ ...l, tiles: l.tiles.map((t) => ({ ...t })) }));
    this.bars = [...(def.bars ?? [])];
    this.blocked = def.blocked ? [...def.blocked] : new Array(def.cols * def.rows).fill(false);
    this.wall = def.wall ? [...def.wall] : new Array(def.cols * def.rows).fill(false);
    this.boxHidden = (def.boxHidden ?? def.columns.map(() => [])).map((c) => [...c]);
    this.boxes = def.columns.map((stack) => ({ stack: [...stack], filled: 0 }));
    this.belt = new Array(BELT_SLOTS).fill(null);
    this.fresh = new Array(BELT_SLOTS).fill(false);
    this.pending = [];
    this.inFlight = [];
    this.magnet = [];
    this.settle();
  }

  // ── Cells ──────────────────────────────────────────────────────────────────
  // A double tray is stored once, at its left cell, and answers for both. Everything that
  // asks "is this cell free" has to go through here or the right half reads as empty.

  /** Index of the tile covering cell `k`, or -1. */
  anchorAt(k: number): number {
    if (k < 0 || k >= this.tiles.length) return -1;
    if (this.tiles[k]) return k;
    if (k % this.cols > 0 && this.tiles[k - 1]?.wide) return k - 1;
    return -1;
  }

  cellFree(k: number): boolean {
    if (this.blocked[k] || this.wall[k] || this.isBar(k)) return false;
    if (this.lidAt(k) >= 0) return false;
    return this.anchorAt(k) < 0 && !this.disp[k];
  }

  /** Index of the closed lid covering cell `k`, or -1. */
  lidAt(k: number): number {
    for (let i = 0; i < this.lids.length; i++) {
      const a = this.lids[i].at;
      const x = a % this.cols;
      const kx = k % this.cols;
      if ((k === a || k === a + 1 || k === a + this.cols || k === a + this.cols + 1) && kx >= x) {
        return i;
      }
    }
    return -1;
  }

  /** Is this box's colour still hidden from the player? Only ever true below the top. */
  boxIsHidden(col: number, idx: number): boolean {
    return idx > 0 && !!this.boxHidden[col]?.[idx];
  }

  /** Cells this tile covers: two for a linked pair, one otherwise. */
  span(idx: number): number {
    return this.tiles[idx]?.wide ? 2 : 1;
  }

  /** Is there an x2 bar below this cell, in its own column? */
  doubled(idx: number): boolean {
    const x = idx % this.cols;
    const y = (idx / this.cols) | 0;
    for (const b of this.bars) {
      const bx = b % this.cols;
      const by = (b / this.cols) | 0;
      if (by > y && (bx === x || bx + 1 === x)) return true;
    }
    return false;
  }

  /**
   * Marbles the tile at `idx` would empty onto the belt.
   *
   * ⚠ The two doublings multiply. A linked pair is two trays, a bar doubles whatever stands over
   * it, and a linked pair standing over a bar is four trays' worth — half the belt and then some.
   * Anything gating on room has to ask this rather than assume `TRAY_N`.
   */
  load(idx: number): number {
    const t = this.tiles[idx];
    return TRAY_N * (t?.wide ? 2 : 1) * (this.doubled(idx) ? 2 : 1);
  }

  /** Bar cells are fixtures: nothing taps them and nothing moves through them. */
  isBar(k: number): boolean {
    for (const b of this.bars) if (k === b || k === b + 1) return true;
    return false;
  }

  // ── Queries ────────────────────────────────────────────────────────────────

  beltUsed(): number {
    let n = 0;
    for (const c of this.belt) if (c !== null) n++;
    return n;
  }

  /** Free slots on the belt right now. */
  beltFree(): number {
    return BELT_SLOTS - this.beltUsed();
  }

  /** Marbles between the tray and the rail: still falling, or queued at the neck. */
  chuteUsed(): number {
    return this.inFlight.length + this.pending.length;
  }

  /**
   * Room for another tray. The belt is *not* part of this: a tray may be tipped even with the
   * rail full, and its marbles wait in the hopper. What must not be over-committed is the
   * hopper itself, or marbles would have nowhere to be while they wait.
   */
  capacity(): number {
    return CHUTE_CAP - this.chuteUsed();
  }

  /**
   * A tray can only leave the grid if it has somewhere to leave *to*: one of the four
   * directions must hold **at least one cell**, and every cell that way must be clear of
   * tiles and dispensers. This is what turns the grid from a list of buttons into a puzzle —
   * a packed block has to be peeled from its shell inwards.
   *
   * ⚠ The board edge on its own is *not* an exit. A tile in the top row with neighbours on
   * its other three sides is boxed in and stays locked; treating the zero-cell lane above it
   * as clear would quietly hand every edge tile a free way out, and the corners of a block
   * would open when they visibly cannot.
   *
   * Purely a property of the board, so the raised/flat look of a tile can be driven straight
   * off it without flickering every time the belt happens to fill up.
   *
   * ⚠ This is **also** the reveal test for a "?" tray, and the two must stay the same test.
   * Revealing on "has an empty orthogonal neighbour" instead looks identical everywhere except
   * the bottom row, where the chute mouth is an exit that is not a neighbouring cell — so a
   * boxed-in tray down there stood its eggs proud (the board's own promise that it will move)
   * and stayed face-down, i.e. untappable. Shipped that way in level 38. **A tray with a way
   * out is never a "?"**: one test, so the picture and the rule cannot drift apart.
   */
  canEscape(idx: number): boolean {
    if (!this.tiles[idx]) return false;
    const x0 = idx % this.cols;
    const y = (idx / this.cols) | 0;
    const x1 = x0 + this.span(idx) - 1;

    // The bottom row sits on the mouth of the chute, so *that* edge is a way out — a tray there
    // drops straight down rather than sliding sideways first.
    //
    // ⚠ The other three edges still do not count, and the difference is not arbitrary: the
    // cavity is drawn opening into the funnel along the bottom and closed by its rim everywhere
    // else. The art has to be able to answer "can this move", and it can only do that if the
    // one edge that is drawn as a hole is the one edge that behaves like one.
    if (y === this.rows - 1) return true;

    // Otherwise one open side is enough — the tray slides into the gap. The board edge does not
    // count: a tile in the top row hemmed in on its other three sides is boxed in.
    if (x0 > 0 && this.cellFree(y * this.cols + x0 - 1)) return true;
    if (x1 < this.cols - 1 && this.cellFree(y * this.cols + x1 + 1)) return true;
    for (let c = x0; c <= x1; c++) {
      if (y > 0 && this.cellFree((y - 1) * this.cols + c)) return true;
      if (y < this.rows - 1 && this.cellFree((y + 1) * this.cols + c)) return true;
    }
    return false;
  }

  /**
   * Whether a tray's eggs stand proud — a way out **and** nothing holding it shut.
   *
   * ⚠ **The art is drawn from this, and so is the board half of `canTap`.** Raised eggs are the
   * board's promise that a tray will move, so anything that refuses a tap has to press them flat
   * or the picture is lying. `canEscape` alone was that test until the arrow lock arrived; a tray
   * whose arrow is still on has a way out and cannot be poured, and the two must not disagree.
   */
  liftable(idx: number): boolean {
    const t = this.tiles[idx];
    if (!t || t.arrow) return false;
    return this.canEscape(idx);
  }

  canTap(idx: number): boolean {
    if (this.status !== "play") return false;
    const t = this.tiles[idx];
    if (!t || t.hidden) return false;
    if (!this.liftable(idx)) return false;
    return this.capacity() >= this.load(idx);
  }

  hasAvailableTap(): boolean {
    for (let i = 0; i < this.tiles.length; i++) if (this.canTap(i)) return true;
    return false;
  }

  /** Is anything on the belt (or in the magnet) able to land in a box as things stand? */
  hasPendingMatch(): boolean {
    for (const c of this.belt) if (c !== null && this.boxAccepting(c)) return true;
    for (const c of this.magnet) if (this.boxAccepting(c)) return true;
    return false;
  }

  private boxAccepting(c: Color): boolean {
    for (const b of this.boxes) {
      if (b.stack.length && b.stack[0] === c && b.filled < BOX_SLOTS) return true;
    }
    return false;
  }

  isWon(): boolean {
    if (this.beltUsed() || this.pending.length || this.inFlight.length || this.magnet.length) {
      return false;
    }
    for (const t of this.tiles) if (t) return false;
    for (const d of this.disp) if (d && d.queue.length) return false;
    return !this.lids.length;
  }

  /**
   * Dead — judged on whether anything *can still move*, not on whether a tray is tappable.
   *
   * ⚠ The trap: with a hopper, "there is still a tray you could tap" is not the same as "the
   * game can still progress". If the belt is full and nothing on it fits an open box, then no
   * marble can leave the belt, no marble can get on, and open boxes only change when one
   * fills — so the position is dead however many trays are left. Checking `hasAvailableTap`
   * first let a jammed board run forever while the player kept tipping trays into a chute
   * that could never drain.
   */
  isStuck(): boolean {
    if (this.status !== "play") return false;
    if (this.isWon()) return false;

    // Can anything leave the belt right now?
    for (const c of this.belt) if (c !== null && this.boxAccepting(c)) return false;

    // Nothing can leave. If nothing can get on either, the open boxes are frozen forever.
    if (this.beltFree() === 0) return true;

    // The belt has room, so a marble still to arrive might match.
    if (this.chuteUsed() || this.magnet.length) return false;
    return !this.hasAvailableTap();
  }

  /**
   * Will the slot under the funnel be clear after the next shift? The marble about to arrive
   * there is whatever currently sits in the last slot, so that is what decides it.
   *
   * The chute is gated on this: a marble waits in the neck until the rail below it is actually
   * empty, rather than being spirited away into a queue the player cannot see.
   */
  entryFreeNextTick(): boolean {
    return this.belt[BELT_SLOTS - 1] === null;
  }

  /**
   * Every tray is gone and the chute is clear — the belt is just finishing up. There is
   * nothing left to decide, so the scene runs the clock faster from here.
   */
  gridEmpty(): boolean {
    if (this.inFlight.length || this.pending.length || this.lids.length) return false;
    for (const t of this.tiles) if (t) return false;
    for (const d of this.disp) if (d && d.queue.length) return false;
    return true;
  }

  /** Marbles still to be placed — drives the progress bar. */
  remaining(): number {
    let n = 0;
    for (const b of this.boxes) n += b.stack.length * BOX_SLOTS - b.filled;
    return n;
  }

  totalMarbles(): number {
    return this.def.columns.reduce((a, s) => a + s.length, 0) * BOX_SLOTS;
  }

  // ── Player actions ─────────────────────────────────────────────────────────

  /** Empty a tray onto the funnel. Returns its colour, or null if the tap was illegal. */
  tap(idx: number): Color | null {
    if (!this.canTap(idx)) return null;
    const t = this.tiles[idx]!;
    const load = this.load(idx);
    this.tiles[idx] = null;
    // A linked pair drops half of each colour. Emitting `load` of `color` would quietly turn the
    // right-hand tray into a second one of the left's colour, which is the whole point of the
    // piece reversed.
    const half = t.wide ? load / 2 : load;
    for (let i = 0; i < half; i++) this.inFlight.push(t.color);
    if (t.wide) for (let i = 0; i < half; i++) this.inFlight.push(t.mate ?? t.color);
    this.taps++;
    this.rec?.ev(this.ticks, "t", String(idx));
    this.creditLids(t.wide ? [t.color, t.mate ?? t.color] : [t.color]);
    // Chocolate boxes this tap burst, for the scene to animate. A field rather than a return
    // value because every caller of `tap` wants the colour and only one wants this.
    const ev = this.settle();
    this.lastOpened = ev.opened;
    this.lastUnlocked = ev.unlocked;
    return t.color;
  }

  /** A tumbling marble reached the neck of the funnel and joined the queue for the belt. */
  arrive(color: Color): void {
    const i = this.inFlight.indexOf(color);
    if (i < 0) return;
    this.inFlight.splice(i, 1);
    this.pending.push(color);
    // ⚠ Recorded because a real game's marbles arrive on physics time, not all at once like
    // `arriveAll()`. Which marble reaches the belt entry first decides the rest of the game, so a
    // replay without these is a different game that happens to start the same way.
    this.rec?.ev(this.ticks, "a", color.toString(36));
  }

  /** Drop every in-flight marble straight into the queue — what the headless sim uses. */
  arriveAll(): void {
    this.pending.push(...this.inFlight);
    this.inFlight.length = 0;
  }

  // ── Boosters ───────────────────────────────────────────────────────────────

  /**
   * Which colour the magnet would take: the most numerous belt colour that has no box
   * open for it. Vacuuming a colour that is already draining would only slow the player down.
   */
  magnetTarget(): Color | null {
    const count = new Map<Color, number>();
    for (const c of this.belt) {
      if (c === null || this.boxAccepting(c)) continue;
      count.set(c, (count.get(c) ?? 0) + 1);
    }
    let best: Color | null = null;
    let bestN = 0;
    for (const [c, n] of count) {
      if (n > bestN) {
        best = c;
        bestN = n;
      }
    }
    return best;
  }

  useMagnet(): Color[] {
    const target = this.magnetTarget();
    if (target === null || this.magnet.length) return [];
    const taken: Color[] = [];
    for (let i = 0; i < BELT_SLOTS && taken.length < MAGNET_N; i++) {
      if (this.belt[i] === target) {
        this.belt[i] = null;
        this.fresh[i] = false;
        taken.push(target);
      }
    }
    this.magnet.push(...taken);
    if (taken.length) this.rec?.ev(this.ticks, "m");
    return taken;
  }

  canWrench(j: number): boolean {
    const b = this.boxes[j];
    return this.status === "play" && b.filled === 0 && b.stack.length > 1;
  }

  /** Send an untouched active box to the back of its own column, promoting the next one. */
  useWrench(j: number): boolean {
    if (!this.canWrench(j)) return false;
    const b = this.boxes[j];
    b.stack.push(b.stack.shift()!);
    // The mask travels with the box, or cycling a column would reveal colours for free.
    const h = this.boxHidden[j];
    if (h?.length) h.push(h.shift()!);
    this.rec?.ev(this.ticks, "w", String(j));
    return true;
  }

  // ── Revive ─────────────────────────────────────────────────────────────────

  /**
   * Which boxes a revive takes off the board, and the belt slots that empty with them.
   *
   * ⚠ **A box and its marbles leave together, or the level becomes unwinnable.** Supply and
   * demand are equal on every board the generator ships: a colour has exactly as many marbles
   * in trays, chute and belt as its boxes have holes. Deleting six marbles to free the rail
   * leaves six holes nothing can ever fill; deleting two boxes leaves six marbles nothing can
   * ever eat. So a revive is one operation — take a box off, take its `BOX_SLOTS` marbles off
   * the belt — and that is what makes "6 marbles and 2 boxes" the same number twice, not two
   * numbers that happen to be quoted together.
   *
   * The order boxes are considered in, which is the design's own:
   * - **Row 2 of the well first** (stack index 1), left to right, then rows 3, 4, … the same way.
   * - The **open box is last** and only while it is still untouched. Taking a box the player has
   *   already put marbles into throws that progress away, and its part-filled holes would make
   *   the marbles-removed count something other than six.
   * - A box only qualifies if its colour has `BOX_SLOTS` marbles **on the belt** — the rail is
   *   what is jammed, and clearing a colour that is still sitting in a tray relieves nothing.
   *
   * Returns null unless a **full** revive is available. Half of one — three slots freed — is not
   * worth the coins and the pop-up should not be offered at all.
   */
  revivePlan(): RevivePick[] | null {
    const spare = new Map<Color, number>();
    for (const c of this.belt) if (c !== null) spare.set(c, (spare.get(c) ?? 0) + 1);

    let deepest = 0;
    for (const b of this.boxes) deepest = Math.max(deepest, b.stack.length);
    // Row 2 of the well is stack index 1; the open box on top comes last, not first.
    const rows: number[] = [];
    for (let k = 1; k < deepest; k++) rows.push(k);
    rows.push(0);

    const picks: RevivePick[] = [];
    for (const k of rows) {
      for (let j = 0; j < this.boxes.length && picks.length < REVIVE_BOXES; j++) {
        const b = this.boxes[j];
        if (k >= b.stack.length) continue;
        if (k === 0 && b.filled > 0) continue;
        const color = b.stack[k];
        const left = spare.get(color) ?? 0;
        if (left < BOX_SLOTS) continue;
        // Two boxes of one colour need six of that colour on the rail, not three twice.
        spare.set(color, left - BOX_SLOTS);
        picks.push({ col: j, idx: k, color, slots: [] });
      }
      if (picks.length >= REVIVE_BOXES) break;
    }
    if (picks.length < REVIVE_BOXES) return null;

    const taken = new Set<number>();
    for (const p of picks) {
      for (let i = 0; i < BELT_SLOTS && p.slots.length < BOX_SLOTS; i++) {
        if (this.belt[i] === p.color && !taken.has(i)) {
          taken.add(i);
          p.slots.push(i);
        }
      }
    }
    return picks;
  }

  /**
   * Take the plan. The board goes back to "play" — a revive is the one thing that un-loses a
   * level, so the status it was killed with has to be lifted here rather than by the scene.
   */
  useRevive(): RevivePick[] | null {
    const picks = this.revivePlan();
    if (!picks) return null;

    for (const p of picks) {
      for (const s of p.slots) {
        this.belt[s] = null;
        this.fresh[s] = false;
      }
    }
    // Deepest index first: splicing a column shifts everything under it.
    for (const p of [...picks].sort((a, b) => b.idx - a.idx)) {
      this.boxes[p.col].stack.splice(p.idx, 1);
      // The mask is parallel to the stack — leave it and every box below inherits the wrong one.
      this.boxHidden[p.col]?.splice(p.idx, 1);
    }
    this.status = "play";
    this.rec?.ev(this.ticks, "r");
    return picks;
  }

  // ── The clock ──────────────────────────────────────────────────────────────

  tick(): TickEvents {
    const ev: TickEvents = {
      status: this.status,
      matched: [],
      entered: null,
      released: [],
      emitted: [],
      revealed: [],
      unlocked: [],
      opened: [],
    };
    if (this.status !== "play") return ev;
    this.ticks++;

    // Advance the belt one slot: whatever sat in i now sits in i+1, and the marble that
    // ran off the end comes back round to the entry.
    this.belt.unshift(this.belt.pop()!);
    this.fresh.unshift(this.fresh.pop()!);
    this.fresh.fill(false);

    // Deliver into boxes. One marble per column per tick — two at once reads as a glitch
    // and collapses the "pock… pock… pock" that makes the fill feel good.
    const used = new Set<number>();
    for (let i = 0; i < BELT_SLOTS; i++) {
      const c = this.belt[i];
      if (c === null) continue;
      const j = SLOT_COLUMN[i];
      if (j < 0 || used.has(j)) continue;
      const b = this.boxes[j];
      if (!b.stack.length || b.stack[0] !== c || b.filled >= BOX_SLOTS) continue;
      this.belt[i] = null;
      b.filled++;
      used.add(j);
      const popped = b.filled >= BOX_SLOTS;
      ev.matched.push({ slot: i, col: j, color: c, filled: b.filled, popped });
      if (popped) {
        b.stack.shift();
        this.boxHidden[j]?.shift();
        b.filled = 0;
      }
    }

    // The magnet hands a marble back the moment a box opens for it.
    if (this.magnet.length) {
      const idx = this.magnet.findIndex((c) => this.boxAccepting(c));
      if (idx >= 0 && this.pending.length < 3) {
        const c = this.magnet.splice(idx, 1)[0];
        this.pending.push(c);
        ev.released.push(c);
      }
    }

    // Feed one marble from the funnel neck onto the entry slot, if it is clear.
    if (this.belt[0] === null && this.pending.length) {
      const c = this.pending.shift()!;
      this.belt[0] = c;
      this.fresh[0] = true;
      ev.entered = c;
    }

    this.maxBelt = Math.max(this.maxBelt, this.beltUsed());
    // Before settling, so the four trays a box just handed back take part in this tick's reveals
    // and hatch pushes rather than waiting a further tick to notice the board changed.
    this.openLids(ev);
    this.settleInto(ev);

    if (this.isWon()) this.status = "won";
    else if (this.isStuck()) this.status = "lost";
    ev.status = this.status;
    return ev;
  }

  /**
   * A tray was tipped: bring every chocolate box that wanted it down by one.
   *
   * `poured` is the colours that actually left the grid, so a linked pair credits **both** of its
   * halves — it is two trays with two colours and `trayCounts` counts it as two everywhere else.
   *
   * ⚠ **The moment of the pour, not the moment the marbles arrive.** Tipping the tray is the
   * whole action the counter is counting; the nine marbles then spend several seconds falling
   * through the cone and shuffling round the rail, and a counter that waits for them reads as
   * broken — the player taps a tray the box plainly wanted and nothing happens. Reported as
   * *"chỉ cần đổ thôi là count cũng giảm 1 rồi, không cần phải chờ cho đến khi bi chạy hết lên
   * ray"*. `tap` settles straight after this, so a box that hits zero bursts on the same tap.
   */
  private creditLids(poured: Color[]): void {
    for (const lid of this.lids) {
      for (const c of poured) {
        if (lid.color !== null && lid.color !== c) continue;
        lid.need--;
      }
    }
  }

  /**
   * Take off every chocolate box whose counter has run out, and hand back the four trays.
   *
   * Called from `settle` (so a tap that empties the last tray bursts the box in the same breath)
   * and again from `tick` before its own settle, so the four trays a box hands back take part in
   * that tick's reveals and hatch pushes rather than waiting a further tick to notice the board
   * changed. Both are needed and neither is redundant: only `tap` can bring a counter down, but
   * only `tick` runs while the player is doing nothing.
   */
  private openLids(ev: TickEvents): void {
    for (let i = this.lids.length - 1; i >= 0; i--) {
      const lid = this.lids[i];
      if (lid.need > 0) continue;
      const cells = [lid.at, lid.at + 1, lid.at + this.cols, lid.at + this.cols + 1];
      this.lids.splice(i, 1);
      cells.forEach((cell, k) => {
        const t = lid.tiles[k];
        if (t && cell < this.tiles.length) this.tiles[cell] = { ...t };
      });
      ev.opened.push(lid.at);
      ev.emitted.push(...cells);
    }
  }

  // ── Grid upkeep ────────────────────────────────────────────────────────────

  /**
   * Take off any chocolate box that has run out, then run the grid to a fixed point.
   *
   * Returns what happened, because `tap` needs it: a box bursts on the **tap that empties the
   * last tray it wanted**, not on the tick after, and the scene has to be told which one so it
   * can play the burst. Discard the result anywhere the caller does not care.
   */
  private settle(): TickEvents {
    const ev: TickEvents = {
      status: this.status,
      matched: [],
      entered: null,
      released: [],
      emitted: [],
      revealed: [],
      unlocked: [],
      opened: [],
    };
    this.openLids(ev);
    this.settleInto(ev);
    return ev;
  }

  /**
   * Dispensers push, then "?" tiles next to a gap turn face-up — and each can trigger the
   * other, so run both to a fixed point rather than once each.
   */
  private settleInto(ev: TickEvents): void {
    for (let pass = 0; pass < 8; pass++) {
      let changed = false;

      for (let i = 0; i < this.disp.length; i++) {
        const d = this.disp[i];
        if (!d) continue;
        // A spent dispenser still occupies its cell, which would keep a neighbouring "?"
        // face-down forever. Retire it.
        if (!d.queue.length) {
          this.disp[i] = null;
          changed = true;
          continue;
        }
        const out = dispTarget(i, d.dir, this.cols, this.rows);
        if (out < 0) continue;
        if (!this.cellFree(out)) continue;
        this.tiles[out] = {
          color: d.queue.shift()!,
          hidden: d.hiddenQ.shift() ?? false,
          wide: false,
        };
        ev.emitted.push(out);
        if (!d.queue.length) this.disp[i] = null;
        changed = true;
      }

      for (let i = 0; i < this.tiles.length; i++) {
        const t = this.tiles[i];
        if (!t || !t.hidden) continue;
        if (this.canEscape(i)) {
          t.hidden = false;
          ev.revealed.push(i);
          changed = true;
        }
      }

      // Arrow locks. ⚠ Inside the same settle loop as the reveals and the hatches, so one tap can
      // open a chain: pouring a tray frees its cell, which opens the arrow pointing at it, whose
      // own cell is what the next arrow is waiting on. Run as a separate pass afterwards it would
      // take one player tap per link, and the board would look like it was thinking in slow motion.
      for (let i = 0; i < this.tiles.length; i++) {
        const t = this.tiles[i];
        if (!t?.arrow) continue;
        const at = stepTarget(i, t.arrow, this.cols, this.rows);
        // ⚠ Off the board never opens, and neither does casing or a crate — `cellFree` says so.
        // That is an unwinnable board, caught in the editor, not something to paper over here.
        if (at < 0 || !this.cellFree(at)) continue;
        delete t.arrow;
        ev.unlocked.push(i);
        changed = true;
      }

      if (!changed) break;
    }
  }

  // ── Undo ───────────────────────────────────────────────────────────────────
  // A move stack of deltas would have to re-derive the board, and every re-derivation is
  // a chance to drift; a snapshot restores the exact board it was taken from.

  snapshot(): Snapshot {
    return {
      lids: JSON.stringify(this.lids),
      boxHidden: JSON.stringify(this.boxHidden),
      tiles: JSON.stringify(this.tiles),
      disp: JSON.stringify(this.disp),
      belt: [...this.belt],
      fresh: [...this.fresh],
      boxes: JSON.stringify(this.boxes),
      pending: [...this.pending],
      inFlight: [...this.inFlight],
      magnet: [...this.magnet],
      taps: this.taps,
      maxBelt: this.maxBelt,
    };
  }

  restore(s: Snapshot): void {
    // ⚠ Before the state is replaced, so the tick stamp is the one the undo happened on. After the
    // restore it would still be right — `ticks` is not in the snapshot — but reading it here says
    // out loud that it is deliberately outside the rewind.
    this.rec?.ev(this.ticks, "u");
    this.lids = JSON.parse(s.lids);
    this.boxHidden = JSON.parse(s.boxHidden);
    this.tiles = JSON.parse(s.tiles);
    this.disp = JSON.parse(s.disp);
    this.belt = [...s.belt];
    this.fresh = [...s.fresh];
    this.boxes = JSON.parse(s.boxes);
    this.pending = [...s.pending];
    this.inFlight = [...s.inFlight];
    this.magnet = [...s.magnet];
    this.taps = s.taps;
    this.maxBelt = s.maxBelt;
    this.status = "play";
  }
}

/**
 * Hash of a level's *content*, not its number.
 *
 * ⚠ Every recorded game carries one. The generator gets retuned constantly, so "level 27"
 * means a different board this week than last; without a fingerprint, refitting the winrate
 * curve quietly mixes games played on boards that no longer exist. Discard, do not guess.
 *
 * FNV-1a over the parts a player actually faces — layout, colours, and the box stacks. Not
 * `refTaps`: that is the generator's own working, and two identical boards found by different
 * routes are the same board to the person playing it.
 */
export function levelFingerprint(d: LevelDef): string {
  const tiles = d.tiles
    .map((t) =>
      t
        ? `${t.color}${t.hidden ? "?" : ""}${t.wide ? `w${t.mate ?? t.color}` : ""}${t.arrow ? `>${t.arrow[0]}` : ""}`
        : ".",
    )
    .join(",");
  const disp = d.disp.map((x) => (x ? `${x.dir ?? "down"}:${x.queue.join("")}` : "-")).join(",");
  const cols = d.columns.map((c) => c.join("")).join("|");
  const blocked = (d.blocked ?? []).map((b) => (b ? "1" : "0")).join("");
  const wall = (d.wall ?? []).map((b) => (b ? "1" : "0")).join("");
  const bars = (d.bars ?? []).join(",");
  const lids = (d.lids ?? [])
    .map((l) => `${l.at}:${l.need}:${l.color ?? "r"}:${l.tiles.map((t) => t.color).join("")}`)
    .join(",");
  const hid = (d.boxHidden ?? []).map((c) => c.map((b) => (b ? "1" : "0")).join("")).join("|");
  const s = `${d.cols}x${d.rows}|${tiles}|${disp}|${cols}|${blocked}|${wall}|${hid}|${lids}|${bars}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/**
 * Stars for clearing `level` on attempt number `attempt` (1 = won it first go).
 *
 *   levels 1..STAR_ALWAYS_TO   any win is three stars
 *   after that                 1 go = 3, 2..STAR_TWO_TRIES goes = 2, more = 1
 *
 * ⚠ **Not a property of the board any more.** This used to be `Game.stars()`, scored on peak belt
 * occupancy — the reasoning being that belt headroom is the only thing skill buys, since every
 * level takes exactly one tap per tray and a move count would score nothing. That reasoning still
 * holds for *measuring a board*, and the play log still carries `peak` and `belt` for exactly
 * that. What it does not do is tell the player anything they can act on: nobody watches the rail's
 * high-water mark, so the rating arrived unexplained. Persistence is what makes attempts legible
 * instead — "you got it first try" is a sentence the player can check against their own memory.
 *
 * ⚠ Which means it needs a **counter that outlives the `Game` object**, so this takes the count as
 * an argument and stays pure. `Game` has no idea how many times the level has been opened, and
 * giving it one would put a save-file concern inside the headless sim.
 */
export function starsFor(level: number, attempt: number): number {
  if (level <= STAR_ALWAYS_TO) return 3;
  if (attempt <= 1) return 3;
  if (attempt <= STAR_TWO_TRIES) return 2;
  return 1;
}

/** Cell index of the tap the reference solution would make next, or -1. */
export function hint(g: Game): number {
  for (const idx of g.def.refTaps) if (g.canTap(idx)) return idx;
  for (let i = 0; i < g.tiles.length; i++) if (g.canTap(i)) return i;
  return -1;
}

export { BOX_COLS, BOX_SLOTS, TRAY_N, BELT_SLOTS };
