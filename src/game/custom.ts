// Hand-built levels: the model the editor draws on, and the translation from it into the
// `LevelDef` the engine already understands.
//
// The editor deliberately does **not** get its own idea of what a board is. It edits a grid of
// cells and this file turns that into a `LevelDef`, so a hand-built level is the same object a
// generated one is and every rule, every bot and the fingerprint all apply to it unchanged.

import {
  boxHiddenFrom, BOX_COLS, BOX_SLOTS, GRID_ROWS, TRAY_N, type Color } from "./config";
import { Game, dispTarget, stepTarget, type ArrowDir, type Dir, type LevelDef } from "./logic";

export type CellKind = "floor" | "wall" | "tile" | "hatch" | "crate" | "choc";

export interface Cell {
  kind: CellKind;
  /** tile only */
  color?: Color;
  /** tile only — placed with a colour, but the player sees "?" until a neighbour frees up */
  hidden?: boolean;
  /** hatch only, in the order they are pushed out */
  queue?: Color[];
  hiddenQ?: boolean[];
  /** hatch only — which side the shutter is on. Absent means down. */
  dir?: Dir;
  /**
   * tile only — a **linked pair**: this tray and the one in the cell to its right are clipped
   * together and empty on one tap. `mate` is the right half's colour. The cell to the right must
   * be left as floor; the pair covers it.
   */
  wide?: boolean;
  mate?: Color;
  /**
   * tile only — an **arrow lock**: the tray is sealed until the neighbouring cell the arrow points
   * at is empty. See `Tile.arrow`.
   *
   * ⚠ An arrow that points off the board, or at casing, a crate or a bar, never opens — the level
   * cannot be won. `problems` raises that as fatal, because nothing in the engine will.
   */
  arrow?: ArrowDir;
  /**
   * choc only — the counter on the box's face: how many trays must be tipped before it bursts.
   */
  need?: number;
  /**
   * choc only — the border colour. `null`/absent is the rainbow border, which counts a tray of
   * **any** colour; a colour counts only trays of that colour.
   */
  border?: Color | null;
  /**
   * choc only — the four trays the box hides, in reading order (top-left, top-right, bottom-left,
   * bottom-right).
   *
   * ⚠ They live on the box cell rather than on the three cells it covers, the same way a hatch
   * carries its queue. Drawing them as ordinary tiles and laying the box on top reads as the
   * simpler design and is not: `gridDef` would have to blank three neighbouring cells, and
   * "which cells does this box own" would then be answerable two different ways — from the box or
   * from the cells — which is exactly how the right half of a linked pair kept going missing.
   */
  under?: { color: Color; hidden?: boolean }[];
}

/** The four cells a chocolate box at `at` covers, in reading order. */
export function chocCells(at: number, cols: number): number[] {
  return [at, at + 1, at + cols, at + cols + 1];
}

export interface Blueprint {
  cols: number;
  rows: number;
  cells: Cell[];
  /**
   * Share of the boxes *below* the top of each column whose colour is hidden — the `?` boxes.
   *
   * ⚠ Hand-built levels had none at all: `toLevelDef` set every entry false, so a drawing could
   * not express the thing the reference machine leans on hardest. Index 0 is never hidden; the
   * open box has to show what it wants.
   *
   * ⚠ **No bot can see this.** B and D never look below the top box, and Cuongxs1 reads straight
   * through `boxHidden` by design. So this makes a level harder for a person and *not at all* for
   * any model — it can never be traded off against the other levers on the same scale.
   */
  boxHiddenFrac?: number;
  /**
   * Colours kept **off the top of every box column**, and allowed at most once one row down.
   *
   * ⚠ It has to live here, in the drawing, and be honoured by the derivation. Reordering the
   * stacks after `toLevelDef` looks equivalent and is not: the boxes are *derived*, so the game
   * rebuilds them from the blueprint and any post-hoc reordering is thrown away before anyone
   * plays it.
   *
   * What it buys: the trays wearing those colours have nowhere to go, so a model that refuses a
   * colour nothing is short of refuses them outright, and the board keeps offering turns with no
   * stand-out move. That is where the difficulty lives once the weights are bipolar.
   */
  boxAvoidTop?: Color[];
  /**
   * A winning tap order for this drawing, found elsewhere and carried with it.
   *
   * ⚠ Why a board would need one. `search` looks for a line by playing the **greedy family** up
   * to `LINE_TRIES` times, and on a hard enough board that family wins zero games out of sixty —
   * level 31 is one, and it is genuinely winnable (Cuongxs1 clears it about 8% of the time, and a
   * person has cleared it). More greedy attempts do not help; a different policy does, and that
   * policy is Node-only. So the line is found offline and stored here.
   *
   * ⚠ **Verified on load, never trusted.** `toLevelDef` replays it and keeps it only if it still
   * wins, falling back to the search otherwise — so editing the drawing cannot leave a stale line
   * behind, and no hash or invalidation bookkeeping is needed.
   */
  refTaps?: number[];
  /**
   * The box stacks, frozen onto the drawing instead of derived from it.
   *
   * ⚠ **This is what makes a level movable.** Everything else here describes the tray grid; the
   * boxes are normally rebuilt on load by `derive(bp, target)`, and the target is `targetWin(level)`
   * — the slot's, not the board's. So "moving a level" moved only its top half and handed it a
   * freshly-built bottom half aimed at wherever it landed. Measured: a board reading 100% at level
   * 23 read 7% at level 19, same trays, different boxes, because the search aimed at 50% instead of
   * 80% and picked the other side of its candidate pool.
   *
   * With the stacks stored, the whole level travels: same trays, same boxes, same difficulty, at
   * any slot. Set it only when you mean to pin a board — a drawing still being edited must leave it
   * empty, or the boxes stop following the trays.
   *
   * ⚠ Store `refTaps` alongside it. The two are captured from one derivation and the line is only
   * a winning line *for those stacks*; freezing one without the other leaves the level with no
   * reference line, which every tool reports as "unsolvable".
   */
  columns?: Color[][];
  /**
   * Warn the player before they start: this board is far harder than its neighbours.
   *
   * ⚠ **On the drawing, not in a table of level numbers.** A `const SUPER_HARD = [15]` somewhere is
   * a second copy of the ladder, and the ladder moves — a level was inserted at slot 2 and another
   * deleted at 13 in a single day, and levels 15 and 85 traded places an hour later. The flag has
   * to travel with the board it describes, exactly like `columns` and `refTaps`, or it ends up
   * pointing at whatever board happens to have inherited the number. `coach.ts` and
   * `featureProgress` avoid the same trap by reading the board rather than a list.
   *
   * It says nothing about how hard the board *is* — it is a label a person applies deliberately.
   * There is no runtime difficulty number to derive it from: every winrate in this project comes
   * from bots run offline.
   */
  hard?: boolean;
  /**
   * The badge this board shows, instead of the one its slot would give it: `"hard"`,
   * `"superhard"`, or `"none"` to show nothing at all.
   *
   * ⚠ **`"none"` is the reason this exists rather than a second boolean.** `levelTag` labels every
   * 15th slot SUPER HARD from the number alone — a promise the ladder makes — so a board that is
   * *moved* into one of those slots has no way to decline it. `hard: true` could only ever add a
   * badge; this can also take one away.
   *
   * ⚠ Like `hard`, it travels **with the drawing** rather than living in a table of level numbers.
   * The ladder moves — two levels traded places the day this was added — and a label pinned to a
   * number ends up describing whatever board inherited it.
   */
  tag?: "hard" | "superhard" | "none";
}

/** The drawing currently open in the editor. One slot, overwritten as you draw. */
export const CUSTOM_KEY = "bf_custom";
/** Boards saved against a level number on this device, before they are pasted into handmade.ts. */
export const LEVELS_KEY = "bf_levels";

export function blankBlueprint(cols = 6, rows = GRID_ROWS): Blueprint {
  return {
    cols,
    rows,
    cells: Array.from({ length: cols * rows }, () => ({ kind: "floor" }) as Cell),
  };
}

/** Every tray the board will drop, hatch queues included. One tray is `TRAY_N` marbles. */
export function trayCounts(bp: Blueprint): Map<Color, number> {
  const n = new Map<Color, number>();
  const add = (c: Color) => n.set(c, (n.get(c) ?? 0) + 1);
  for (const cell of bp.cells) {
    if (cell.kind === "tile" && cell.color !== undefined) {
      add(cell.color);
      // A linked pair is *two* trays. Counting it once leaves the box derivation a boxful short
      // and the level unwinnable by arithmetic alone.
      if (cell.wide) add(cell.mate ?? cell.color);
    }
    if (cell.kind === "hatch") (cell.queue ?? []).forEach(add);
    // ⚠ The four trays under a chocolate box are trays like any other — they join the board when
    // it bursts and they pour nine marbles each. Leaving them out of the count is four boxfuls
    // the derivation never opens, and the level is unwinnable by arithmetic alone.
    if (cell.kind === "choc") (cell.under ?? []).forEach((u) => add(u.color));
  }
  return n;
}

export interface Problem {
  fatal: boolean;
  text: string;
}

/**
 * ⚠ The board has to hand the boxes a whole number of boxfuls, or the level cannot be won.
 *
 * A tray is `TRAY_N` marbles and a box holds `BOX_SLOTS`, so each tray needs exactly
 * `TRAY_N / BOX_SLOTS` boxes of its colour. That division has to come out even — with 9 and 3
 * it always does, but the check stays because those two are the constants most likely to be
 * retuned, and the failure it guards against is a level that looks fine and can never finish.
 */
export function checkBlueprint(bp: Blueprint): Problem[] {
  const out: Problem[] = [];
  const counts = trayCounts(bp);
  const perTray = TRAY_N / BOX_SLOTS;

  if (!counts.size) out.push({ fatal: true, text: "Chưa có ô màu nào trên bảng." });
  if (!Number.isInteger(perTray)) {
    out.push({
      fatal: true,
      text: `TRAY_N (${TRAY_N}) không chia hết cho BOX_SLOTS (${BOX_SLOTS}) — không bảng nào thắng được.`,
    });
  }

  // ⚠ Sealed means *permanently* sealed: every side is casing, a crate, or the board edge.
  //
  // Not "has no empty neighbour right now" — a tray in the middle of a packed block has none
  // either, and peeling a block from its shell inwards is the game. Flagging those would put a
  // warning on almost every board worth building and train the designer to ignore the panel.
  const sealed: number[] = [];
  for (let i = 0; i < bp.cells.length; i++) {
    const k = bp.cells[i].kind;
    // ⚠ A chocolate box counts too, and it is checked on **all four** of its cells. The box
    // itself is never tapped, but the four trays it hands back are — and a box wedged into a
    // walled corner releases four trays with nowhere to go, which is a level that cannot finish
    // and no per-cell check on the drawing would otherwise see, because those cells read as
    // plain floor until the box bursts.
    if (k === "choc") {
      if (chocCells(i, bp.cols).every((c) => c < bp.cells.length && isSealed(bp, c))) sealed.push(i);
      continue;
    }
    if (k !== "tile" && k !== "hatch") continue;
    if (isSealed(bp, i)) sealed.push(i);
  }
  if (sealed.length) {
    out.push({
      fatal: true,
      text: `${sealed.length} ô bị thành máy hoặc thùng gỗ bịt cả bốn phía — không bao giờ bấm được.`,
    });
  }

  // A hatch shoves its trays into the neighbouring cell it faces. Without one it holds them
  // forever and the level can never finish.
  const SIDE: Record<Dir, string> = { down: "bên dưới", left: "bên trái", right: "bên phải" };
  for (let i = 0; i < bp.cells.length; i++) {
    const c = bp.cells[i];
    if (c.kind !== "hatch") continue;
    const dir = c.dir ?? "down";
    const out2 = dispTarget(i, dir, bp.cols, bp.rows);
    if (out2 < 0) {
      out.push({ fatal: true, text: `Cửa xả quay ra mép bảng — không có ô ${SIDE[dir]} để đẩy khay ra.` });
      continue;
    }
    const k = bp.cells[out2].kind;
    if (k === "wall" || k === "crate") {
      out.push({
        fatal: true,
        text: `Cửa xả có ${k === "wall" ? "thành máy" : "thùng gỗ"} ngay ${SIDE[dir]} — khay không ra được.`,
      });
    }
  }

  /**
   * Arrow locks. The tray opens when the cell it points at is empty, so an arrow aimed at
   * something that can never empty is a tray that can never be poured.
   *
   * ⚠ **Nothing in the engine refuses this** — it is a perfectly legal board that simply cannot be
   * won, and `isWon` needs every tray gone. It has to be caught here or it ships.
   *
   * ⚠ An arrow pointing at an **empty cell** is legal but pointless: it opens on the first settle,
   * before the player sees it, so the piece they were shown never existed. That is a warning, not
   * a fatal — the same shape as the `?` marker for a face-down tray that flips before frame one.
   */
  const WAY: Record<ArrowDir, string> = {
    up: "bên trên",
    down: "bên dưới",
    left: "bên trái",
    right: "bên phải",
  };
  for (let i = 0; i < bp.cells.length; i++) {
    const c = bp.cells[i];
    if (c.kind !== "tile" || !c.arrow) continue;
    const at = stepTarget(i, c.arrow, bp.cols, bp.rows);
    const where = `Khay mũi tên ở ô (${(i % bp.cols) + 1},${((i / bp.cols) | 0) + 1})`;
    if (at < 0) {
      out.push({ fatal: true, text: `${where} chỉ ra mép bảng — không có ô ${WAY[c.arrow]} nào để đổ.` });
      continue;
    }
    const k = bp.cells[at].kind;
    if (k === "wall" || k === "crate") {
      out.push({
        fatal: true,
        text: `${where} chỉ vào ${k === "wall" ? "thành máy" : "thùng gỗ"} — không bao giờ mở được.`,
      });
    } else if (k === "floor") {
      out.push({
        fatal: false,
        text: `${where} chỉ vào ô trống — nó mở ngay từ đầu, người chơi sẽ không thấy mũi tên.`,
      });
    }
    if (c.hidden) {
      out.push({
        fatal: false,
        text: `${where} vừa là khay ? vừa có mũi tên — chồng hai khoá lên một ô thì không đọc ra khoá nào.`,
      });
    }
  }

  /**
   * Arrow chains that never open — the deadlock the per-arrow check above cannot see.
   *
   * ⚠ **Two arrows pointing at each other is a legal board and a dead one**, and so is any longer
   * ring. Each of them passes the target test on its own: every arrow points at a real tray, and
   * nothing is aimed at casing. Only the chain as a whole is impossible, so it has to be asked as a
   * chain — which is what makes this worth a fixpoint rather than another per-cell test.
   *
   * A cell **can empty** if it is not a tray, or if it is a tray whose arrow (if any) points at a
   * cell that can empty. Start from the cells that need nothing and grow the set until it stops
   * growing; any arrow tray left outside it is in a ring, or hanging off one.
   */
  const canEmpty = bp.cells.map((c) => c.kind !== "tile" || !c.arrow);
  for (let pass = 0; pass < bp.cells.length; pass++) {
    let grew = false;
    for (let i = 0; i < bp.cells.length; i++) {
      if (canEmpty[i]) continue;
      const c = bp.cells[i];
      if (c.kind !== "tile" || !c.arrow) continue;
      const at = stepTarget(i, c.arrow, bp.cols, bp.rows);
      if (at >= 0 && canEmpty[at]) {
        canEmpty[i] = true;
        grew = true;
      }
    }
    if (!grew) break;
  }
  const stuck = bp.cells
    .map((_, i) => i)
    .filter((i) => !canEmpty[i] && bp.cells[i].kind === "tile" && bp.cells[i].arrow);
  // ⚠ One line for the whole ring, not one per cell. A four-arrow loop reported four times reads
  // as four separate faults and sends you fixing them one at a time; it is a single mistake.
  if (stuck.length) {
    const list = stuck.map((i) => `(${(i % bp.cols) + 1},${((i / bp.cols) | 0) + 1})`).join(" ");
    out.push({
      fatal: true,
      text: `Mũi tên khoá vòng tròn — các khay ${list} chờ lẫn nhau nên không khay nào mở được.`,
    });
  }

  return out;
}

/**
 * Every side is something that will never move: casing, a crate, or the board's own edge.
 *
 * ⚠ Matches `canEscape`. The top and side edges count as solid — a tray in the top row hemmed
 * in on its other three sides is boxed in — but the **bottom** edge is the mouth of the chute,
 * so nothing in the last row is ever sealed.
 */
function isSealed(bp: Blueprint, i: number): boolean {
  const x = i % bp.cols;
  const y = (i / bp.cols) | 0;
  if (y === bp.rows - 1) return false;
  const solid = (k: number, inside: boolean) => {
    if (!inside) return true;
    const kind = bp.cells[k].kind;
    return kind === "wall" || kind === "crate";
  };
  return (
    solid(i - 1, x > 0) &&
    solid(i + 1, x < bp.cols - 1) &&
    solid(i - bp.cols, y > 0) &&
    solid(i + bp.cols, y < bp.rows - 1)
  );
}

/**
 * A tap order the drawn board actually permits, as the sequence of colours it drops.
 *
 * Played on a real `Game` so the escape rule, the "?" reveals and the hatch pushes are the
 * engine's own and not a copy. The board's colours never reach the boxes here — the chute is
 * emptied after every tap so `capacity()` can never be what stops a tap — because all this
 * stage is for is the order the grid can be taken apart in.
 */
function drainOrder(bp: Blueprint, rand: () => number): Color[] {
  const g = new Game(gridDef(bp));
  const order: Color[] = [];
  for (let guard = 0; guard < 400; guard++) {
    const open: number[] = [];
    for (let i = 0; i < g.tiles.length; i++) if (g.canTap(i)) open.push(i);
    if (!open.length) break;
    const idx = open[(rand() * open.length) | 0];
    const load = g.load(idx);
    const c = g.tap(idx);
    if (c === null) break;
    for (let k = 0; k < load / TRAY_N; k++) order.push(c);
    // Nothing downstream of the grid matters to this stage, and a full chute would start
    // refusing taps and cut the order short.
    g.inFlight.length = 0;
    g.pending.length = 0;
  }
  return order;
}

/**
 * The box stacks, built by **playing the board** rather than by dealing out its colours.
 *
 * ⚠ A multiset of the right boxes is not enough: the *order* decides whether the level can be
 * won at all. Interleaving colours evenly — the obvious way, and what this did first — puts a
 * colour's later boxes underneath other colours, so a tray tapped once its own column has moved
 * on has nowhere to land, rides the belt, and the level jams with the board still half full.
 * That was reported from real play on a hand-built level and it was this function's fault, not
 * the drawing's.
 *
 * So do what the generator does: take a tap order the grid permits, run the belt, and open a box
 * for whatever is piling up on it. The stacks then *are* the record of a playthrough that worked.
 */
function layout(bp: Blueprint, rand: () => number): Color[][] {
  const avoid = bp.boxAvoidTop ?? [];
  /** How many of the avoided colours are already sitting one row down. The brief allows one. */
  let secondRowUsed = 0;
  const counts = trayCounts(bp);
  const perTray = Math.max(1, Math.round(TRAY_N / BOX_SLOTS));

  const owed = new Map<Color, number>();
  counts.forEach((trays, c) => owed.set(c, trays * perTray));
  const total = [...owed.values()].reduce((a, b) => a + b, 0);
  const cap = new Array<number>(BOX_COLS).fill(Math.floor(total / BOX_COLS));
  for (let i = 0; i < total % BOX_COLS; i++) cap[i]++;

  const columns: Color[][] = Array.from({ length: BOX_COLS }, () => []);
  const active: (Color | null)[] = new Array(BOX_COLS).fill(null);
  const filled = new Array<number>(BOX_COLS).fill(0);
  const belt = new Map<Color, number>();

  const openBoxes = () => {
    for (let j = 0; j < BOX_COLS; j++) {
      if (active[j] !== null || columns[j].length >= cap[j]) continue;
      let eligible = [...owed.entries()].filter(([, n]) => n > 0);
      if (!eligible.length) continue;
      // Depth 0 never takes an avoided colour; depth 1 takes at most one across the whole well.
      const depth = columns[j].length;
      if (avoid.length && depth <= 1) {
        const allow = depth === 1 && secondRowUsed === 0;
        const clean = eligible.filter(([c]) => !avoid.includes(c));
        // ⚠ Fall back to the unfiltered list rather than stalling. A column with nothing but
        // avoided colours left still has to open something, and a well that stops opening boxes
        // is a board that cannot be finished at all.
        if (clean.length && !allow) eligible = clean;
      }
      // Serve whatever is piling up. That is the whole trick: the stack ends up ordered by
      // when each colour actually arrives, which is what makes it drainable.
      const waiting = eligible.filter(([c]) => (belt.get(c) ?? 0) > 0);
      const [c] = (waiting.length ? waiting : eligible).reduce((a, b) =>
        (belt.get(b[0]) ?? 0) > (belt.get(a[0]) ?? 0) ? b : a,
      );
      owed.set(c, owed.get(c)! - 1);
      if (avoid.includes(c) && columns[j].length === 1) secondRowUsed++;
      columns[j].push(c);
      active[j] = c;
      filled[j] = 0;
    }
  };

  const drain = () => {
    for (let guard = 0; guard < 20000; guard++) {
      let moved = false;
      for (let j = 0; j < BOX_COLS; j++) {
        const c = active[j];
        if (c === null || (belt.get(c) ?? 0) <= 0) continue;
        belt.set(c, belt.get(c)! - 1);
        if (++filled[j] >= BOX_SLOTS) {
          active[j] = null;
          filled[j] = 0;
        }
        moved = true;
      }
      if (!moved) return;
      openBoxes();
    }
  };

  for (const c of drainOrder(bp, rand)) {
    belt.set(c, (belt.get(c) ?? 0) + TRAY_N);
    openBoxes();
    drain();
  }

  // Anything still owed — a colour the grid could not reach, or boxes left over once the caps
  // filled up. Appended rather than dropped: the count has to stay exact or the level is
  // unwinnable by arithmetic alone.
  for (const [c, n] of owed) for (let i = 0; i < n; i++) columns[shortest(columns)].push(c);
  return columns;
}

function shortest(columns: Color[][]): number {
  let best = 0;
  for (let j = 1; j < columns.length; j++) if (columns[j].length < columns[best].length) best = j;
  return best;
}

/**
 * One greedy playthrough. Prefers a tray a box is already open for, otherwise takes any legal
 * tap — the same shape as the `greedy` bot the balance work uses, kept here because that one
 * lives in `scripts/bots.mjs` and never runs in a browser.
 */
/**
 * The browser's copy of the bot, and it has to be **the same player the target is defined on**.
 *
 * ⚠ This was a fourth, much weaker model: it picked at random among trays whose colour had an
 * open box. Aiming the box search at a `(B+D)/2` target while scoring candidates with that is
 * comparing two different rulers, and it moved level 25 *away* from its target — 18% to 11% —
 * while the search believed it was closing in. Whenever a threshold is checked against a target,
 * both sides have to be the same measurement.
 *
 * ⚠ It cannot import `scripts/bots.mjs` — that is Node-only and this runs in the browser — so it
 * is a copy by necessity. Keep the scoring below identical to `SCORERS.net` there.
 */
function trayScore(g: Game, c: Color): number {
  let holes = 0;
  for (const b of g.boxes) if (b.stack.length && b.stack[0] === c) holes += BOX_SLOTS - b.filled;
  let sent = 0;
  for (const k of g.belt) if (k === c) sent++;
  for (const k of g.pending) if (k === c) sent++;
  for (const k of g.inFlight) if (k === c) sent++;
  for (const k of g.magnet) if (k === c) sent++;
  return Math.max(0, holes - sent) * 10 + holes - sent;
}

/**
 * What tipping the tile at `i` is worth. Matches `tileValue` in `scripts/bots.mjs` — same reason
 * as `trayScore`: this is the browser's copy of that bot and the two have to be one player.
 *
 * ⚠ A linked pair drops half of each of two colours, and which colour landed on which side is a
 * coin flip in the drawing. Scoring `color` alone judges the piece by its arbitrary half. The
 * mean rather than the sum, so a pair does not outrank every single tray on arithmetic alone.
 */
function tileValue(g: Game, i: number): number {
  const t = g.tiles[i]!;
  const v = trayScore(g, t.color);
  if (!t.wide) return v;
  return (v + trayScore(g, t.mate ?? t.color)) / 2;
}

/**
 * One game. `patient` refuses a tray the belt has no room for; `slip` is how often it abandons
 * the scoring and taps whatever it happened to pick first.
 */
export function playOnce(
  def: LevelDef,
  rand: () => number,
  patient = false,
  slip = 0,
  line?: number[],
): boolean {
  const g = new Game(def);
  for (let guard = 0; g.status === "play" && guard < 30000; guard++) {
    let open: number[] = [];
    for (let i = 0; i < g.tiles.length; i++) if (g.canTap(i)) open.push(i);
    if (patient) open = open.filter((i) => g.beltFree() >= g.load(i));
    if (open.length) {
      let pick = open[(rand() * open.length) | 0];
      if (rand() >= slip) {
        let best = -Infinity;
        for (const i of open) {
          // The jitter breaks ties randomly; without it the bot reports 0% or 100% and nothing
          // in between, which says more about the bot than the board.
          const v = tileValue(g, i) + rand() * 0.5;
          if (v > best) {
            best = v;
            pick = i;
          }
        }
      }
      g.tap(pick);
      line?.push(pick);
    }
    g.arriveAll();
    g.tick();
  }
  return g.status === "won";
}

/**
 * The board's score on the **same blend the sheet's targets are written in**: best play averaged
 * with a careless 25%-slip player.
 *
 * ⚠ An approximation of `bd()` in `scripts/bots.mjs`, not a copy of it. That pools four bots —
 * two scorings × greedy/patient — and this pools two, because the search runs on every editor
 * keystroke and in the level loader. Expect it to read a point or two under the reported figure.
 */
export function winRate(def: LevelDef, runs: number, rand: () => number): number {
  const half = Math.max(1, Math.floor(runs / 3));
  const won = (n: number, patient: boolean, slip: number) => {
    let w = 0;
    for (let i = 0; i < n; i++) if (playOnce(def, rand, patient, slip)) w++;
    return w / n;
  };
  const b = Math.max(won(half, false, 0), won(half, true, 0));
  const d = won(runs - 2 * half, false, D_SLIP);
  return (b + d) / 2;
}

/** Matches `D_SLIP` in scripts/bots.mjs. One number, two files — keep them equal. */
const D_SLIP = 0.25;

/**
 * ⚠ One layout is not enough, and this is the second time the same lesson has been paid for.
 *
 * `layout` records *one* tap order. The player takes a different one, and a stack ordered for a
 * line nobody walks can still jam — six random drawings measured 100, 100, 23, 0, 100, 100. So
 * build several candidates and keep the one that actually plays, which is the two-stage search
 * `tune.mjs` already does for the generator's own boards.
 *
 * Cheap because it stops at the first layout that clears every trial, which most drawings hit on
 * the first or second try.
 */
// ⚠ These are a time budget, not a quality dial. The search runs at level load and on every
// editor commit, and the bot it scores with now thinks about every candidate on every tick rather
// than picking at random — at 14 × 8 screening plus 4 × 24 confirming, a 31-tray board took 905ms
// to open. Trimmed to fit roughly the 300ms a generated board already costs.
const CANDIDATES = 10;
const TRIALS = 6;
/** Survivors re-measured at full strength. */
const FINALISTS = 3;
/** Games in that re-measurement. */
const CONFIRM = 12;
/** Close enough to the aim to stop looking. */
const AIM_TOL = 0.08;

/**
 * A tap order that clears this drawing with **these** box stacks, found by playing until something
 * wins. Empty if `LINE_TRIES` attempts all lost.
 *
 * ⚠ A generated level carries one in `refTaps` — the line its own construction recorded — and
 * several tools replay it as the proof that the board is solvable. A hand-built board had none, so
 * every one of them reported its reference line as *lost*: an empty list replayed, nothing tapped,
 * no win. The line was never missing from the level, only from the drawing's def.
 *
 * ⚠ Exported because **the editor can now arrange the stacks by hand**, and a hand-arranged order
 * is a pinned order: `toLevelDef` skips `derive` when `columns` is set, so the line that would have
 * come with a derivation never happens. One definition rather than a second copy in the editor —
 * this file's own note on the escape test says what a second copy costs.
 *
 * ⚠ The line belongs to the stacks it was found for. Move one box and it is stale, which is why
 * `toLevelDef` replays a stored line and drops it if it no longer wins.
 */
export function lineFor(bp: Blueprint, cols: Color[][], salt = 3000): number[] {
  const def = { ...gridDef(bp), columns: cols, boxHidden: cols.map((c) => c.map(() => false)) };
  for (let attempt = 0; attempt < LINE_TRIES; attempt++) {
    const line: number[] = [];
    if (playOnce(def, seededRand(bp, salt + attempt), attempt % 2 === 1, 0, line)) return line;
  }
  return [];
}

function search(bp: Blueprint, target: number): { cols: Color[][]; line: number[] } {
  const grid = gridDef(bp);
  const withBoxes = (cols: Color[][]) => ({
    ...grid,
    columns: cols,
    boxHidden: cols.map((c) => c.map(() => false)),
  });
  const score = (cols: Color[][], runs: number, salt: number) =>
    winRate(withBoxes(cols), runs, seededRand(bp, salt));

  const findLine = (cols: Color[][], salt: number): number[] => lineFor(bp, cols, salt);

  // Stage 1 — screen every candidate cheaply.
  const screened: { cols: Color[][]; rate: number }[] = [];
  for (let attempt = 0; attempt < CANDIDATES; attempt++) {
    const cols = layout(bp, seededRand(bp, attempt));
    screened.push({ cols, rate: score(cols, TRIALS, 1000 + attempt) });
  }
  screened.sort((a, b) => Math.abs(a.rate - target) - Math.abs(b.rate - target));

  // Stage 2 — re-measure the survivors properly and report *that* number.
  //
  // ⚠ Not optional, and it is the same winner's curse the level tuner pays for. Picking the
  // closest of ten eight-game measurements picks the layout whose *measured* rate happened to
  // land on target, not the one whose true rate is there — eight games carry about ±17 points.
  let best = screened[0];
  let bestErr = Infinity;
  for (const c of screened.slice(0, FINALISTS)) {
    const rate = score(c.cols, CONFIRM, 2000 + screened.indexOf(c));
    const err = Math.abs(rate - target);
    if (err < bestErr) {
      bestErr = err;
      best = { cols: c.cols, rate };
    }
    if (err <= AIM_TOL) break;
  }
  return { cols: best.cols, line: findLine(best.cols, 3000) };
}

/** Attempts allowed when looking for a winning line. A board the bots clear one game in twenty
 *  needs a generous budget, and this runs once per drawing and is then cached. */
const LINE_TRIES = 40;

/**
 * Deterministic per drawing: the same board must come out the same every time it is opened, or
 * the level the editor measured is not the level the player gets.
 */
function seededRand(bp: Blueprint, salt: number): () => number {
  let s = (0x9e3779b9 ^ bp.cols ^ (salt * 0x27d4eb2d)) >>> 0;
  for (const c of bp.cells) {
    const tag = c.kind.charCodeAt(0) * 31 + (c.color ?? 15) + (c.hidden ? 7 : 0);
    s = (Math.imul(s ^ tag, 0x85ebca6b) + 0x165667b1) >>> 0;
  }
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

// The search plays dozens of games, and `toLevelDef` is called on every editor keystroke.
const colCache = new Map<string, { cols: Color[][]; line: number[] }>();

/**
 * The box stacks for a drawing, aimed at `target`.
 *
 * ⚠ It aims, it does not maximise. The order of a colour's boxes is the single biggest lever a
 * drawing has over how hard it plays — six random drawings off one layout scored 100, 100, 23, 0,
 * 100, 100 — so picking the *easiest* order throws that lever away and hands every hand-built
 * level whatever difficulty the drawing happens to have. Asked for directly: "the boxes have to
 * be built in an order that hits the target winrate".
 *
 * ⚠ The target is passed in rather than looked up. This file stays free of the generator so the
 * editor can import it without pulling the difficulty ladder in; `board.ts` knows both and joins
 * them. Default 1 means "as winnable as possible", which is right for a drawing with no level
 * number behind it — the editor's scratch board.
 */
export function deriveColumns(bp: Blueprint, target = 1): Color[][] {
  return derive(bp, target).cols.map((c) => [...c]);
}

function derive(bp: Blueprint, target: number): { cols: Color[][]; line: number[] } {
  if (!trayCounts(bp).size) {
    return { cols: Array.from({ length: BOX_COLS }, () => []), line: [] };
  }
  // ⚠ The target is part of the key. Two levels can share a drawing and want different orders.
  const key = `${target}|${JSON.stringify(bp)}`;
  let hit = colCache.get(key);
  if (!hit) {
    hit = search(bp, target);
    if (colCache.size > 32) colCache.delete(colCache.keys().next().value as string);
    colCache.set(key, hit);
  }
  return hit;
}

/**
 * The board without its boxes.
 *
 * Split out to break a loop: the box stacks are built by *playing* the board, playing needs a
 * `LevelDef`, and a `LevelDef` needs the box stacks. Nothing about the grid — escapes, reveals,
 * hatch pushes, `canTap` — reads `columns`, so a board with none is exactly right for that pass.
 */
function gridDef(bp: Blueprint, level = 0): LevelDef {
  const n = bp.cols * bp.rows;
  const tiles: LevelDef["tiles"] = new Array(n).fill(null);
  const disp: LevelDef["disp"] = new Array(n).fill(null);
  const blocked = new Array<boolean>(n).fill(false);
  const wall = new Array<boolean>(n).fill(false);
  const lids: LevelDef["lids"] = [];

  for (let i = 0; i < n; i++) {
    const c = bp.cells[i] ?? { kind: "floor" as const };
    if (c.kind === "choc") {
      // ⚠ Needs a whole 2x2 to sit on, and every cell of it has to be free. Drawn against the
      // right or bottom edge, or over a neighbour that is anything but floor, it would claim
      // cells it does not own — and `lidAt` would then report a tray's cell as covered, locking
      // a tray nothing can ever reach. Refuse rather than place three quarters of a box.
      const room =
        i % bp.cols < bp.cols - 1 &&
        i + bp.cols + 1 < n &&
        chocCells(i, bp.cols)
          .slice(1)
          .every((k) => (bp.cells[k]?.kind ?? "floor") === "floor");
      const under = c.under ?? [];
      if (room && under.length === 4) {
        lids.push({
          at: i,
          need: Math.max(1, c.need ?? 1),
          color: c.border ?? null,
          tiles: under.map((u) => ({ color: u.color, hidden: !!u.hidden, wide: false })),
        });
      }
      continue;
    }
    if (c.kind === "tile" && c.color !== undefined) {
      // ⚠ A linked pair only counts as one if the cell to its right is genuinely free. Drawn over
      // a wall or another tray it would cover a cell it does not own, and `anchorAt` would hand
      // taps on that cell to the wrong tile.
      const room = (i % bp.cols) < bp.cols - 1 && (bp.cells[i + 1]?.kind ?? "floor") === "floor";
      const wide = !!c.wide && room;
      tiles[i] = {
        color: c.color,
        hidden: !!c.hidden,
        wide,
        mate: wide ? (c.mate ?? c.color) : undefined,
        arrow: c.arrow,
      };
    } else if (c.kind === "hatch") {
      const queue = [...(c.queue ?? [])];
      disp[i] = { queue, hiddenQ: queue.map((_, k) => !!c.hiddenQ?.[k]), dir: c.dir ?? "down" };
    } else if (c.kind === "crate") {
      blocked[i] = true;
    } else if (c.kind === "wall") {
      wall[i] = true;
    }
  }

  return {
    level,
    cols: bp.cols,
    rows: bp.rows,
    blocked,
    wall,
    boxHidden: [],
    tiles,
    disp,
    lids,
    bars: [],
    columns: Array.from({ length: BOX_COLS }, () => []),
    colors: [...trayCounts(bp).keys()],
    shape: "custom",
    // No recorded line: a hand-built board was never solved by the generator, so there is
    // nothing honest to hand the hint button.
    refTaps: [],
  };
}

export function toLevelDef(bp: Blueprint, level = 0, target = 1): LevelDef {
  const def = gridDef(bp, level);
  // ⚠ Frozen stacks win over the search. A pinned board is one whose difficulty has already been
  // measured and placed, and re-deriving it against this slot's target is exactly what made a
  // level change difficulty by moving. Skipping `derive` also skips its bot games, so a pinned
  // board loads in microseconds instead of ~24ms.
  const { cols, line } = bp.columns?.length
    ? { cols: bp.columns, line: [] as number[] }
    : derive(bp, target);
  def.columns = cols.map((c) => [...c]);
  // Deterministic per drawing, like everything else here: the level the editor measured has to be
  // the level the player gets.
  // ⚠ From `BOX_HIDDEN_FROM` up the rule wins over the drawing, because it is a property of the
  // *slot* rather than of the board — and because 185 shipped blueprints carry an explicit 0 that a
  // `??` fallback would never get past. Below that level the drawing still owns it.
  const frac = boxHiddenFrom(level, target, bp.boxHiddenFrac ?? 0);
  const rand = seededRand(bp, 7777);
  def.boxHidden = def.columns.map((c) => c.map((_, k) => k > 0 && rand() < frac));
  // The winning line the box search walked. A generated board carries the equivalent, and the
  // tools that replay it as proof of solvability should not have to care which kind they got.
  //
  // A line stored on the drawing wins only if it still clears the board — see `Blueprint.refTaps`.
  def.refTaps = bp.refTaps?.length && replayWins(def, bp.refTaps) ? [...bp.refTaps] : line;
  def.hard = bp.hard;
  def.tag = bp.tag;
  return def;
}

/** Does this tap order still clear the board? The same replay `verify()` uses on generated levels. */
function replayWins(def: LevelDef, taps: number[]): boolean {
  const g = new Game(def);
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

/**
 * A board turned back into a drawing, so a generated level can be opened in the editor and
 * worked on rather than retyped.
 *
 * ⚠ Still lossy, and the losses have to be reported by the caller. `bars` (x2) has no tool in the
 * editor yet, so a level carrying one comes back without it — quietly dropping a level's hardest
 * feature and calling it "opened" is worse than refusing.
 */
export function fromLevelDef(def: LevelDef): { bp: Blueprint; dropped: string[] } {
  const n = def.cols * def.rows;
  const cells: Cell[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const t = def.tiles[i];
    const d = def.disp[i];
    // ⚠ `wide`/`mate` are **not** carried here — see the "lossy" note on this function — but the
    // arrow is, because it is a whole obstacle rather than a detail of one: a board opened without
    // its arrows plays as a completely different level, and the editor would then save that back.
    if (t) cells[i] = { kind: "tile", color: t.color, hidden: t.hidden, arrow: t.arrow };
    else if (d)
      cells[i] = { kind: "hatch", queue: [...d.queue], hiddenQ: [...d.hiddenQ], dir: d.dir ?? "down" };
    else if (def.blocked?.[i]) cells[i] = { kind: "crate" };
    else if (def.wall?.[i]) cells[i] = { kind: "wall" };
    else cells[i] = { kind: "floor" };
  }
  // ⚠ Chocolate boxes go back **last**, over whatever the loop above put in their four cells. A
  // box's cells hold no tiles in the def — the trays are parked inside the lid — so the loop
  // reads them as floor, which is right for the three it covers and wrong for its own cell.
  for (const lid of def.lids ?? []) {
    const cover = chocCells(lid.at, def.cols);
    cover.slice(1).forEach((k) => {
      if (k < n) cells[k] = { kind: "floor" };
    });
    cells[lid.at] = {
      kind: "choc",
      need: lid.need,
      border: lid.color,
      under: lid.tiles.map((t) => ({ color: t.color, hidden: t.hidden })),
    };
  }
  const dropped: string[] = [];
  if (def.bars?.length) dropped.push(`${def.bars.length} thanh x2`);
  return { bp: { cols: def.cols, rows: def.rows, cells }, dropped };
}

export function saveCustom(bp: Blueprint): void {
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(bp));
  } catch {
    /* storage unavailable — the editor keeps it in memory */
  }
}

export function loadCustom(): Blueprint | null {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY);
    if (!raw) return null;
    const bp = JSON.parse(raw) as Blueprint;
    if (!bp?.cells?.length || !bp.cols) return null;
    return bp;
  } catch {
    return null;
  }
}

// ── Saving against a level number ────────────────────────────────────────────

export type LevelBook = Record<number, Blueprint>;

export function loadBook(): LevelBook {
  try {
    const raw = localStorage.getItem(LEVELS_KEY);
    if (!raw) return {};
    const book = JSON.parse(raw) as LevelBook;
    return book && typeof book === "object" ? book : {};
  } catch {
    return {};
  }
}

export function saveBook(book: LevelBook): void {
  try {
    localStorage.setItem(LEVELS_KEY, JSON.stringify(book));
  } catch {
    /* storage unavailable */
  }
}

export function putLevel(level: number, bp: Blueprint): LevelBook {
  const book = loadBook();
  book[level] = JSON.parse(JSON.stringify(bp)) as Blueprint;
  saveBook(book);
  return book;
}

export function dropLevel(level: number): LevelBook {
  const book = loadBook();
  delete book[level];
  saveBook(book);
  return book;
}

/**
 * The board for a level, hand-built if there is one.
 *
 * ⚠ Order matters and it is not the obvious one. The device's own saves win over the shipped
 * table so that drawing a level and pressing play shows *that* drawing — otherwise editing a
 * level that already ships would silently keep serving the shipped copy and read as the save
 * having failed. `generate` is passed in rather than imported so this file stays free of the
 * generator, and the editor can call it without pulling the ladder in.
 */
export function blueprintFor(level: number, shipped: LevelBook): Blueprint | null {
  const mine = loadBook()[level];
  if (mine?.cells?.length) return mine;
  const ship = shipped[level];
  return ship?.cells?.length ? ship : null;
}
