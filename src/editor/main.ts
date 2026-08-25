// Level editor. Draws a `Blueprint`; `custom.ts` turns that into the same `LevelDef` the
// generator produces, so nothing here needs its own idea of what a board is.
//
// DOM rather than Phaser on purpose: the editor is mostly buttons, dropdowns and a text field,
// and every one of those is free in HTML and hand-built in canvas. The cost is that the board
// preview is an approximation of the machine rather than the machine — good enough to design
// against, and "Chơi thử" opens the real thing one click away.

import {
  BELT_SLOTS,
  BOX_COLS,
  BOX_SLOTS,
  BOX_VISIBLE,
  GRID_ROWS,
  PALETTE,
  TICK_MS,
  TRAY_N,
  type Color,
} from "../game/config";
import {
  blankBlueprint,
  checkBlueprint,
  deriveColumns,
  dropLevel,
  fromLevelDef,
  loadBook,
  loadCustom,
  putLevel,
  saveCustom,
  chocCells,
  lineFor,
  toLevelDef,
  trayCounts,
  type Blueprint,
  type Cell,
  type CellKind,
} from "../game/custom";
import { Game, stepTarget, type ArrowDir, type Dir, type LevelDef } from "../game/logic";
import { HANDMADE } from "../game/handmade";
import { makeLevel, targetWin } from "../game/level";

type Tool = "pick" | "wall" | "floor" | "tile" | "hiddenTile" | "hatch" | "crate" | "pair" | "choc" | "arrow";

const TOOLS: { id: Tool; label: string; key: string; hint: string }[] = [
  // ⚠ First in the list and on key 0, because it is the only tool that **cannot** damage the
  // drawing. Every other tool paints on contact: to reach an arrow tray's direction you had to
  // click it with the arrow tool, and one wrong tool selected meant the piece was overwritten
  // before you saw what it was. Reaching a piece to read or adjust it should not be a bet.
  { id: "pick", label: "Chọn / xem", key: "0", hint: "bấm vào một vật thể để sửa nó — không vẽ đè" },
  { id: "wall", label: "Thành máy", key: "1", hint: "vẽ viền — ngoài hình" },
  { id: "floor", label: "Ô trống", key: "2", hint: "trong hình, khay trượt sang được" },
  { id: "tile", label: "Ô màu", key: "3", hint: "khay, hiện màu" },
  { id: "hiddenTile", label: "Ô màu ẩn (?)", key: "4", hint: "vào game hiện dấu ?" },
  { id: "hatch", label: "Cửa xả", key: "5", hint: "có số và hàng đợi màu" },
  { id: "crate", label: "Thùng gỗ", key: "6", hint: "vật cản, không bao giờ mất" },
  { id: "pair", label: "Khay đôi", key: "7", hint: "hai khay dính nhau, một chạm rơi cả hai" },
  { id: "choc", label: "Hộp socola", key: "8", hint: "che 2x2, đổ đủ số khay thì vỡ" },
  { id: "arrow", label: "Khay mũi tên", key: "9", hint: "khoá đến khi đổ xong khay nó chỉ vào" },
];

/**
 * Tools whose click means **edit this piece**, not paint over it — so the cell they land on stays
 * selected and its panel stays open.
 *
 * ⚠ One definition, three call sites. This list lived inline in all three (the end of `apply`,
 * the tool buttons, the number keys) and had already drifted: two of them named the arrow tool and
 * the third did not. Adding "pick" to two of the three left the select tool selecting a cell and
 * then dropping it again on the same click, which looks exactly like a tool that does nothing.
 */
const KEEPS_SELECTION = new Set<Tool>(["pick", "hatch", "pair", "choc", "arrow"]);

const hex = (c: Color) => "#" + PALETTE[c % PALETTE.length].base.toString(16).padStart(6, "0");

let bp: Blueprint = loadCustom() ?? blankBlueprint(6, GRID_ROWS);
let tool: Tool = "wall";
/** Which way the next arrow tray will point. Sticky, so a row of them is one click each. */
let arrowDir: ArrowDir = "down";
let color: Color = 0;
let selected = -1;
/** which tray of the open hatch the colour buttons are aimed at */
let slot = 0;
/** Which half of the open linked pair a colour click lands on: 0 left, 1 right. */
let pairHalf = 0;
/** Which of the four trays under the open chocolate box a colour click lands on. */
let chocSlot = 0;
let painting = false;

/** What a fresh hatch starts with. The generator uses two; nothing in the engine caps it. */
const HATCH_DEFAULT = 2;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const boardEl = $("board");
const wellEl = $("well");
const wellAutoEl = $("wellAuto") as HTMLButtonElement;
const wellStateEl = $("wellState");
const beltEl = $("belt");
const playRunEl = $("playRun") as HTMLButtonElement;
const playAgainEl = $("playAgain") as HTMLButtonElement;
const playSpeedEl = $("playSpeed") as HTMLSelectElement;
const playSpeedWrap = $("playSpeedWrap");
const playNoteEl = $("playNote");
const toolsEl = $("tools");
const swatchesEl = $("swatches");
const hatchBox = $("hatchBox");
const pairBox = $("pairBox");
const pairSlots = $("pairSlots");
const pairHidden = $<HTMLInputElement>("pairHidden");
const chocBox = $("chocBox");
const arrowBox = $("arrowBox");
const aDir = $("aDir") as HTMLSelectElement;
const aWhere = $("aWhere");
const chocNeed = $<HTMLInputElement>("chocNeed");
const chocRainbow = $<HTMLInputElement>("chocRainbow");
const chocBorder = $("chocBorder");
const chocSlots = $("chocSlots");
const chocUnder = $("chocUnder");
const chocHidden = $<HTMLInputElement>("chocHidden");
const chocSupply = $("chocSupply");
const queueEl = $("queue");
const qHidden = $<HTMLInputElement>("qhidden");
const qCount = $<HTMLInputElement>("qCount");
const qDir = $<HTMLSelectElement>("qDir");
const qWhich = $("qWhich");
const statsEl = $("stats");
const issuesEl = $("issues");
const jsonEl = $<HTMLTextAreaElement>("json");
const colsEl = $<HTMLSelectElement>("cols");
const rowsEl = $<HTMLSelectElement>("rows");
const lvlEl = $<HTMLInputElement>("lvlNum");
const bookEl = $("book");
const badgeEl = $("badge");
const playLvlEl = $<HTMLAnchorElement>("playLvl");
const lookLvlEl = $<HTMLAnchorElement>("lookLvl");
const playUrl = $("playUrl");
const measureEl = $<HTMLInputElement>("measure");

// ── Painting ─────────────────────────────────────────────────────────────────

function apply(i: number) {
  const cur = bp.cells[i];
  switch (tool) {
    // Selects and nothing else. The four contextual panels already key off `selected` plus the
    // cell's own kind, so pointing at a hatch opens the queue editor, at a pair the colour pair,
    // at an arrow tray the direction — no per-kind branch here, and a piece added later is
    // reachable the day it exists.
    case "pick":
      selected = i;
      break;
    case "wall":
      bp.cells[i] = { kind: "wall" };
      break;
    case "floor":
      bp.cells[i] = { kind: "floor" };
      break;
    case "crate":
      bp.cells[i] = { kind: "crate" };
      break;
    case "tile":
      bp.cells[i] = { kind: "tile", color, hidden: false };
      break;
    case "hiddenTile":
      bp.cells[i] = { kind: "tile", color, hidden: true };
      break;
    case "arrow":
      // ⚠ Keeps the arrow of a tray that already has one, so clicking it just selects it — the
      // direction is the part you come back to adjust, and re-stamping it with the panel's current
      // value on every click makes the board fight the panel.
      bp.cells[i] = {
        kind: "tile",
        color,
        hidden: false,
        arrow: cur.kind === "tile" && cur.arrow ? cur.arrow : arrowDir,
      };
      selected = i;
      break;
    case "pair": {
      // ⚠ The pair covers the cell to its right, so it needs one to cover. Refusing here rather
      // than placing a half-pair matters: `gridDef` silently degrades a pair with no room back
      // to a single tray, and a tool that looks like it worked and did not is worse than one
      // that plainly declines.
      const x = i % bp.cols;
      if (x >= bp.cols - 1) break;
      if (cur.kind !== "tile" || !cur.wide) {
        bp.cells[i] = { kind: "tile", color, wide: true, mate: color, hidden: !!cur.hidden };
        bp.cells[i + 1] = { kind: "floor" };
      }
      selected = i;
      break;
    }
    case "choc": {
      // ⚠ It claims a whole 2x2, so it needs one. Refusing beats placing three quarters of a
      // box: `gridDef` drops a box with no room and a tool that looks like it worked and did
      // not is worse than one that plainly declines.
      const x = i % bp.cols;
      const y = (i / bp.cols) | 0;
      if (x >= bp.cols - 1 || y >= bp.rows - 1) break;
      if (cur.kind !== "choc") {
        // The four trays underneath start as whatever colour is on the brush, so the box is a
        // real board element the moment it lands rather than a shell to be filled in first.
        bp.cells[i] = {
          kind: "choc",
          need: 4,
          border: null,
          under: [0, 1, 2, 3].map(() => ({ color, hidden: false })),
        };
        for (const k of chocCells(i, bp.cols).slice(1)) bp.cells[k] = { kind: "floor" };
      }
      selected = i;
      chocSlot = 0;
      break;
    }
    case "hatch":
      // Clicking a hatch that already exists selects it for editing instead of wiping its
      // queue — the queue is the expensive part to type in and the easiest to lose.
      if (cur.kind !== "hatch") {
        bp.cells[i] = {
          kind: "hatch",
          queue: new Array<Color>(HATCH_DEFAULT).fill(color),
          hiddenQ: new Array<boolean>(HATCH_DEFAULT).fill(false),
        };
        slot = 0;
      }
      selected = i;
      break;
  }
  if (!KEEPS_SELECTION.has(tool) && selected === i) selected = -1;
  commit();
}

// ── Preview ──────────────────────────────────────────────────────────────────

/**
 * A real `Game` built from the drawing, settled, used only to *render* it.
 *
 * ⚠ Do not reimplement the reveal or escape rules here. A "?" tile with an empty neighbour turns
 * face-up on the first frame, a hatch pushes its first tray out before the player sees anything,
 * and a tray with no open side sits flat — draw the blueprint literally and the editor shows
 * four face-down tiles the player will never see face-down. `level.ts` already keeps one
 * byte-for-byte copy of the escape test and the file says what that costs; a third copy in the
 * editor would drift the same way, and the whole point of a design view is that it agrees.
 */
let preview: Game | null = null;
/**
 * The def `preview` was built from, kept because the panel has to read `refTaps` off it.
 *
 * ⚠ Not rebuilt separately for that question. `toLevelDef` runs the box search and replays any
 * stored line; asking it twice is both the expensive thing on this page and a chance for the two
 * answers to differ.
 */
let previewDef: LevelDef | null = null;

function rebuildPreview() {
  try {
    // ⚠ **Built the way `board.ts` builds it — level number and the slot's target included.** With
    // neither, `toLevelDef` derives the box stacks against target 1, i.e. the easiest order it can
    // find, and hides nothing: level is 0, which is below `BOX_HIDDEN_FROM`. So the well the editor
    // drew was a different well from the one the player gets, in both its order and its `?`s — on
    // the one board where the two most obviously have to agree. Same three-step resolution the rest
    // of the editor uses; `lastLevel` is the level the badge is talking about.
    previewDef = toLevelDef(bp, lastLevel, targetWin(lastLevel));
    preview = new Game(previewDef);
  } catch {
    // A drawing mid-edit can be nonsense (no colours yet, so no boxes). Fall back to drawing
    // the blueprint as-is rather than blanking the board while the designer is working.
    preview = null;
    previewDef = null;
  }
}

// ── Rendering ────────────────────────────────────────────────────────────────

function edgesFor(i: number): string[] {
  // A rim segment wherever floor meets casing or the grid's own border, so the union of the
  // playable cells comes out with one outline instead of a box drawn round every cell.
  const solid = (k: number, ok: boolean) => (ok ? bp.cells[k].kind === "wall" : true);
  const x = i % bp.cols;
  const y = (i / bp.cols) | 0;
  if (bp.cells[i].kind === "wall") return [];
  const out: string[] = [];
  if (solid(i - bp.cols, y > 0)) out.push("t");
  if (solid(i + bp.cols, y < bp.rows - 1)) out.push("b");
  if (solid(i - 1, x > 0)) out.push("l");
  if (solid(i + 1, x < bp.cols - 1)) out.push("r");
  return out;
}

/**
 * The two ribbons, drawn as this cell's quarter of a cross centred on the whole 2x2.
 *
 * ⚠ Per cell rather than per box because the four cells are four separate DOM nodes — so each
 * draws the bands along the two edges facing the box's centre, and together they make one cross.
 * A cross drawn inside each cell instead gives four little crosses, which reads as four boxes.
 */
function paintRibbon(face: HTMLElement, box: Cell, dx: number, dy: number) {
  const rainbow = (box.border ?? null) === null;
  const paint = rainbow
    ? "linear-gradient(var(--dir), #ff5252, #ffb300, #ffee58, #66bb6a, #26c6da, #5c6bc0, #ab47bc)"
    : hex(box.border as Color);
  for (const vertical of [true, false]) {
    const band = document.createElement("div");
    band.className = "ribbon";
    band.style.setProperty("--dir", vertical ? "to bottom" : "to right");
    band.style.background = paint;
    if (vertical) {
      band.style.top = "0";
      band.style.bottom = "0";
      band.style.width = "9px";
      // dx 0 is the left cell, so its band hugs the right edge — where the box's centre is.
      band.style[dx === 0 ? "right" : "left"] = "-4px";
    } else {
      band.style.left = "0";
      band.style.right = "0";
      band.style.height = "9px";
      band.style[dy === 0 ? "bottom" : "top"] = "-4px";
    }
    face.appendChild(band);
  }
}

/** Index of the chocolate box covering cell `i` from elsewhere, or -1. */
function chocOwner(i: number): number {
  const x = i % bp.cols;
  const y = (i / bp.cols) | 0;
  for (const [dx, dy] of [
    [1, 0],
    [0, 1],
    [1, 1],
  ]) {
    const ax = x - dx;
    const ay = y - dy;
    if (ax < 0 || ay < 0) continue;
    const a = ay * bp.cols + ax;
    if (bp.cells[a]?.kind === "choc") return a;
  }
  return -1;
}

function render() {
  // ⚠ Cell size follows the widest side, the same way `gridMetrics` shrinks the real board — a
  // 7x7 at the old fixed 62px is 434px of grid in a panel built for 6.
  const px = Math.round(Math.min(62, 380 / Math.max(bp.cols, bp.rows)));
  boardEl.style.gridTemplateColumns = `repeat(${bp.cols}, ${px}px)`;
  boardEl.style.gridAutoRows = `${px}px`;
  boardEl.replaceChildren();

  for (let i = 0; i < bp.cols * bp.rows; i++) {
    const c = bp.cells[i];
    const el = document.createElement("div");
    el.className = `cell ${c.kind}${selected === i ? " sel" : ""}`;
    el.dataset.i = String(i);

    for (const e of edgesFor(i)) {
      const seg = document.createElement("div");
      seg.className = `edge ${e}`;
      el.appendChild(seg);
    }

    const face = document.createElement("div");
    face.className = "face";
    const pt = preview?.tiles[i] ?? null;

    // ⚠ During a run the *drawing* still says "tile" for a tray that has already been poured, and
    // the settled-tile fallback below would then paint it back onto the board. Emptied is emptied:
    // the model is the truth while it is running.
    const poured = !!play && c.kind === "tile" && !pt && !preview?.tiles[i - 1]?.wide;
    if (c.kind === "tile" && c.color !== undefined && !poured) {
      // Face-down only if it is *still* face-down once the board has settled.
      const stillHidden = pt ? pt.hidden : !!c.hidden;
      if (stillHidden) {
        // ⚠ Grey, the same inert slate the game bakes into `trayHidden` — a "?" tile shows no
        // colour at all until it turns over. Painting it its real colour with a "?" on top was
        // convenient for drawing and simply wrong about the game: the whole point of the tile is
        // that the colour is the thing being withheld.
        face.style.backgroundColor = "#7b89a4";
        face.textContent = "?";
        // The colour is still the designer's to know, so it goes in a corner chip — editor-only
        // information, kept clearly outside the tile's own face.
        const chip = document.createElement("span");
        chip.className = "swatchdot";
        chip.style.backgroundColor = hex(c.color);
        el.appendChild(chip);
      } else {
        // ⚠ backgroundColor, not the `background` shorthand: set inline, the shorthand resets
        // background-image to none and the nine eggs the .eggs class draws vanish.
        face.style.backgroundColor = hex(c.color);
        // Eggs standing proud is the game's own readout for "this tray can move", so the editor
        // has to use it for the same thing or the two pictures disagree at a glance.
        // ⚠ `liftable`, the same test the game draws from — `canEscape` alone says an arrow-locked
        // tray can move, and the editor would then promise something the game refuses.
        if (!preview || preview.liftable(i)) face.classList.add("eggs");
      }
      if (c.hidden && !stillHidden) el.classList.add("revealed");
      // The arrow lock. Drawn from the **settled** board, like everything else here: an arrow whose
      // target cell was already empty in the drawing opens before the first frame, and showing it
      // would be the editor promising a piece the player never meets.
      const stillLocked = pt ? !!pt.arrow : !!c.arrow;
      if (c.arrow) {
        const mark = document.createElement("span");
        mark.className = "arrowMark" + (stillLocked ? "" : " gone");
        mark.textContent = { up: "↑", down: "↓", left: "←", right: "→" }[c.arrow];
        el.appendChild(mark);
      }
      // A linked pair: draw the clip on this cell's right edge and paint the neighbouring cell
      // with the mate's colour. The blueprint stores the pair once, at the left cell, so the
      // right cell is plain floor and would otherwise render as an empty slot.
      if (c.wide) el.classList.add("linked");
    } else if (c.kind === "floor" && bp.cells[i - 1]?.kind === "tile" && bp.cells[i - 1]?.wide && i % bp.cols > 0) {
      const left = bp.cells[i - 1];
      // ⚠ The anchor's settled tile, not this cell's — the pair is stored once, so `preview
      // .tiles[i]` is null here and falling back to the *drawing* would keep the right half
      // grey after settling had already turned the piece face-up. Face-down and raised/flat
      // both belong to the piece; only the colour is this half's own.
      const anchor = preview?.tiles[i - 1] ?? null;
      const stillHidden = anchor ? anchor.hidden : !!left.hidden;
      if (stillHidden) {
        face.style.backgroundColor = "#7b89a4";
        face.textContent = "?";
        const chip = document.createElement("span");
        chip.className = "swatchdot";
        chip.style.backgroundColor = hex(left.mate ?? left.color ?? 0);
        el.appendChild(chip);
      } else {
        face.style.backgroundColor = hex(left.mate ?? left.color ?? 0);
        if (!preview || preview.liftable(i - 1)) face.classList.add("eggs");
      }
      if (left.hidden && !stillHidden) el.classList.add("revealed");
      el.classList.add("linkedRight");
    } else if (c.kind === "choc") {
      face.textContent = String(c.need ?? 1);
      face.classList.add("chocFace", "chocNum");
      paintRibbon(face, c, 0, 0);
      const rainbow = (c.border ?? null) === null;
      el.title = rainbow
        ? `Vỡ sau khi đổ ${c.need} khay bất kỳ màu`
        : `Vỡ sau khi đổ ${c.need} khay màu ${PALETTE[(c.border as Color) % PALETTE.length].name}`;
    } else if (c.kind === "floor" && chocOwner(i) >= 0) {
      // One of the three cells the box covers. Drawn as part of the box, not as empty floor —
      // the blueprint stores the piece once, at its top-left, so these would otherwise render as
      // holes in the middle of it.
      const at = chocOwner(i);
      face.classList.add("chocFace");
      paintRibbon(face, bp.cells[at], i % bp.cols === at % bp.cols ? 0 : 1, i - at < bp.cols ? 0 : 1);
    } else if (c.kind === "hatch") {
      // The count the *player* sees: settle() has already pushed one tray out.
      face.textContent = String(preview?.disp[i]?.queue.length ?? (c.queue ?? []).length);
      // Which side the shutter is on, drawn as a bar along that edge — the same thing the
      // rotated housing says in the game.
      face.classList.add("shutter-" + (c.dir ?? "down"));
    } else if (c.kind === "floor" && pt) {
      // The tray a hatch above has already shoved down here before the level even starts.
      face.classList.add("ghost");
      if (pt.hidden) {
        face.style.backgroundColor = "#7b89a4";
        face.textContent = "?";
      } else {
        face.style.backgroundColor = hex(pt.color);
        face.classList.add("eggs");
      }
      el.title = "Khay cửa xả đẩy xuống ngay khi vào màn";
    }
    el.appendChild(face);
    boardEl.appendChild(el);
  }

  renderWell();
  if (play) renderPlay();
}

/**
 * The box well, under the board, in the order the machine stacks it.
 *
 * The editor draws trays and nothing else — the boxes are *derived* from them, and their order is
 * the single biggest lever a drawing has over whether the level can be won at all (six random
 * drawings off one layout scored 100, 100, 23, 0, 100, 100). Until now that half of the level was
 * invisible here: you drew the trays, pressed save, and found out in play.
 *
 * ⚠ Read off the settled `Game`, never re-derived. `preview` is already the real thing — asking it
 * for `boxes[j].stack` and `boxIsHidden` is one source of truth for what the player will see, and
 * a second copy of the hidden-box rule here would drift from `logic.ts` the way every other
 * duplicated rule in this project has.
 */
function renderWell() {
  wellEl.replaceChildren();
  // ⚠ Pinned or derived is not a detail the designer can be left to infer: pinned means the board
  // stops rebuilding itself against the slot it sits in, which is the difference between moving a
  // level and rewriting it. Say which, and always offer the way back.
  const pinned = !!bp.columns?.length;
  wellStateEl.textContent = pinned
    ? "Thứ tự đang giữ nguyên — thêm/bớt khay chỉ thêm hoặc bớt hộp. Kéo hộp để đổi chỗ."
    : "Chưa có hộp nào để giữ";
  wellStateEl.classList.toggle("on", pinned);
  // ⚠ Always offered while there is an order at all. It is the only thing that re-deals the well,
  // and a control that appears and disappears is one the designer has to go looking for at exactly
  // the moment they have decided the order is wrong.
  wellAutoEl.hidden = !pinned;
  wellAutoEl.textContent = "Sắp lại tự động";
  wellAutoEl.title = "Bỏ thứ tự hiện tại và để máy xếp lại, nhắm vào độ khó của level này";
  // Same rule as the button beside them: offered whenever there is an order to shuffle.
  for (const b of shuffleBtns) b.hidden = !pinned;
  const g = preview;
  const stacks = g ? g.boxes.map((b) => b.stack) : [];
  if (!stacks.some((st) => st.length)) {
    const p = document.createElement("span");
    p.className = "none";
    // Not an error state: a drawing with no trays yet has no boxes to derive, and saying so beats
    // an empty strip that looks like a well that failed to draw.
    p.textContent = g ? "Chưa có khay nào, nên chưa sinh ra hộp" : "Bản vẽ chưa dựng được (thiếu màu?)";
    wellEl.appendChild(p);
    return;
  }

  for (let j = 0; j < BOX_COLS; j++) {
    const col = document.createElement("div");
    col.className = "wcol";
    const cap = document.createElement("span");
    cap.className = "wcap";
    cap.textContent = `CỘT ${j + 1}`;
    col.appendChild(cap);

    stacks[j].forEach((color, k) => {
      const hidden = g!.boxIsHidden(j, k);
      const b = document.createElement("div");
      b.className = `wbox${k === 0 ? " open" : ""}${hidden ? " hid" : ""}${k >= BOX_VISIBLE ? " deep" : ""}`;
      b.style.backgroundColor = hex(color);
      b.dataset.col = String(j);
      b.dataset.idx = String(k);
      // Only the open box shows its holes, exactly as on the machine: the ones behind it are shut.
      if (k === 0) {
        // Holes already filled are shown filled — during a run that is the level's progress, and
        // it is the thing you watch to see a colour arriving that nothing can accept.
        const filled = g!.boxes[j].filled;
        for (let h = 0; h < BOX_SLOTS; h++) {
          const hole = document.createElement("span");
          hole.className = `whole${h < filled ? " on" : ""}`;
          if (h < filled) hole.style.backgroundColor = hex(color);
          b.appendChild(hole);
        }
      }
      b.title =
        `Hộp ${k + 1} của cột ${j + 1}` +
        (k === 0 ? " — đang mở" : "") +
        (hidden ? " — người chơi chưa thấy màu (?)" : "") +
        (k >= BOX_VISIBLE ? ` — sâu hơn ${BOX_VISIBLE} hộp, chưa hiện trên máy` : "");
      col.appendChild(b);
    });

    wellEl.appendChild(col);
  }
}

// ── Playing it here ──────────────────────────────────────────────────────────

/**
 * The drawing, played in the editor.
 *
 * ⚠ **The model, not the machine.** `Game` owns every rule — taps, escapes, the belt, the boxes —
 * and none of them need Phaser or Matter, so the editor can run the real engine and draw the result
 * into the DOM it already has. What it cannot reproduce is the *physics*: marbles here reach the
 * rail through `arriveAll()`, the headless convention, so the chute never backs up and the hopper
 * pressure a real player feels is missing. That makes this the wrong tool for judging pacing and
 * the right one for judging **box order**, which is what it exists for — and it is the same loop
 * the bot check and the box search measure, so its verdict and theirs cannot disagree.
 *
 * ⚠ It does not replace `Chơi thử`. That opens the real machine one click away, and anything about
 * feel has to be answered there.
 */
let play: Game | null = null;
let playTimer: number | null = null;
/**
 * Every tap of this run, with the tick it happened on.
 *
 * ⚠ The tick matters as much as the cell. Rearranging the well restarts the run, and replaying the
 * taps back to back would be a different game that happens to start the same way — the belt state
 * a tray lands in is decided by *when* it was poured. The engine is deterministic once the taps and
 * their ticks are fixed, so this replays exactly.
 */
let playTaps: { at: number; idx: number }[] = [];

function stopPlay() {
  if (playTimer !== null) clearInterval(playTimer);
  playTimer = null;
  play = null;
  beltEl.hidden = true;
  playNoteEl.hidden = true;
  playAgainEl.hidden = true;
  playSpeedWrap.hidden = true;
  playRunEl.textContent = "▶ Chơi thử tại đây";
  document.body.classList.remove("playing");
}

/** One step of the headless loop, exactly as `playOnce` runs it: everything lands, then a tick. */
function playStep() {
  if (!play) return;
  play.arriveAll();
  play.tick();
  if (play.status !== "play" && playTimer !== null) {
    clearInterval(playTimer);
    playTimer = null;
  }
  render();
}

function startPlay(replay: { at: number; idx: number }[] = []) {
  if (!previewDef) return;
  stopPlay();
  play = new Game(previewDef);
  playTaps = [];
  // ⚠ `preview` is what every renderer here already draws from, and a running game *is* a settled
  // `Game`. Pointing it at the live one makes the board, the eggs and the well follow the play for
  // free — a second rendering path for "the same board, but moving" is how the two drift.
  preview = play;
  for (const t of replay) {
    while (play.ticks < t.at && play.status === "play") {
      play.arriveAll();
      play.tick();
    }
    if (play.status !== "play") break;
    if (play.canTap(t.idx)) {
      play.tap(t.idx);
      playTaps.push({ at: play.ticks, idx: t.idx });
    }
  }
  beltEl.hidden = false;
  playNoteEl.hidden = false;
  playAgainEl.hidden = false;
  playSpeedWrap.hidden = false;
  playRunEl.textContent = "■ Dừng, quay lại vẽ";
  document.body.classList.add("playing");
  playTimer = setInterval(playStep, TICK_MS / Number(playSpeedEl.value)) as unknown as number;
  render();
}

/** The rail and the run's own numbers, under the board. */
function renderPlay() {
  const g = play;
  if (!g) return;
  beltEl.replaceChildren();
  for (let k = 0; k < BELT_SLOTS; k++) {
    const c = g.belt[k];
    const d = document.createElement("div");
    d.className = `bslot${c === null ? " empty" : ""}${k === 0 ? " entry" : ""}`;
    if (c !== null) d.style.backgroundColor = hex(c);
    d.title = k === 0 ? "Chỗ bi mới vào rail" : `Ô rail ${k + 1}`;
    beltEl.appendChild(d);
  }
  const used = g.belt.filter((c) => c !== null).length;
  const waiting = g.pending.length + g.inFlight.length;
  playNoteEl.className = `hint playnote${g.status === "won" ? " won" : g.status === "lost" ? " lost" : ""}`;
  playNoteEl.textContent =
    g.status === "won"
      ? `Thắng sau ${g.taps} lần đổ. Rail cao nhất ${g.maxBelt}/${BELT_SLOTS}.`
      : g.status === "lost"
        ? `Kẹt sau ${g.taps} lần đổ — rail ${used}/${BELT_SLOTS}, không màu nào trên rail vào được hộp đang mở. ` +
          `Đây là lúc kéo lại thứ tự hộp.`
        : `Đang chơi · rail ${used}/${BELT_SLOTS}${waiting ? ` (+${waiting} đang rơi)` : ""} · ` +
          `đã đổ ${g.taps} khay · còn ${g.remaining()} bi. Bấm khay để đổ.`;
}

playRunEl.onclick = () => (play ? (stopPlay(), rebuildPreview(), render()) : startPlay());
playAgainEl.onclick = () => startPlay();
playSpeedEl.onchange = () => {
  if (!play || playTimer === null) return;
  clearInterval(playTimer);
  playTimer = setInterval(playStep, TICK_MS / Number(playSpeedEl.value)) as unknown as number;
};

/**
 * Arranging the well by hand.
 *
 * The stacks are normally *derived* — `search` builds ~10 candidate layouts, scores each with bot
 * games and keeps whichever lands nearest the slot's target. That is the right default and it is
 * not a design tool: a designer who wants this colour third and that one last has no way to say so.
 * Dragging a box says it.
 *
 * ⚠ **A hand-arranged order is a pinned order.** `Blueprint.columns` is what carries it, and from
 * then on `toLevelDef` skips the search entirely — the board no longer rebuilds itself against the
 * slot it sits in, which is exactly what pinning is for and exactly what makes it a commitment. The
 * label above the well says which state it is in and offers the way back.
 *
 * ⚠ **The line has to be re-found on every move.** A pinned board skips `derive`, so nothing
 * produces a `refTaps` for it — and `Blueprint.refTaps`' own note says a level with no line is one
 * every tool reports as unsolvable, with `hint()` degraded to the first tappable cell it can see.
 * So each drop calls `lineFor` for the new stacks. If that comes back empty the arrangement is kept
 * (the designer is mid-thought) and the panel says so as a **fatal** issue rather than the editor
 * silently pinning a board nothing can win.
 *
 * ⚠ Moves only ever *reorder*: a box is spliced out and spliced back in. Adding or dropping one
 * would break the arithmetic every board depends on — each colour needs exactly `TRAY_N /
 * BOX_SLOTS` boxes per tray, and one box too few is a level that cannot be finished by anyone.
 */
let dragBox: { col: number; idx: number } | null = null;
let dropAt: { col: number; idx: number } | null = null;

/** The stacks as they stand, from the settled preview — the same thing the well draws. */
function wellStacks(): Color[][] {
  return preview ? preview.boxes.map((b) => [...b.stack]) : [];
}

/** Where in the well is this point: which column, and which gap between boxes. */
function dropPoint(x: number, y: number): { col: number; idx: number } | null {
  const cols = [...wellEl.querySelectorAll<HTMLElement>(".wcol")];
  if (!cols.length) return null;
  // Nearest column by horizontal distance, so a drop just past the last column still lands rather
  // than being refused — the well is narrow and the pointer leaves it easily.
  let col = 0;
  let bestDx = Infinity;
  cols.forEach((c, j) => {
    const r = c.getBoundingClientRect();
    const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
    if (dx < bestDx) {
      bestDx = dx;
      col = j;
    }
  });
  const boxes = [...cols[col].querySelectorAll<HTMLElement>(".wbox")];
  let idx = boxes.length;
  for (let k = 0; k < boxes.length; k++) {
    const r = boxes[k].getBoundingClientRect();
    if (y < r.top + r.height / 2) {
      idx = k;
      break;
    }
  }
  return { col, idx };
}

function paintDropMark() {
  wellEl.querySelectorAll(".wmark").forEach((m) => m.remove());
  if (!dropAt) return;
  const col = wellEl.querySelectorAll<HTMLElement>(".wcol")[dropAt.col];
  if (!col) return;
  const mark = document.createElement("div");
  mark.className = "wmark";
  const boxes = col.querySelectorAll<HTMLElement>(".wbox");
  col.insertBefore(mark, boxes[dropAt.idx] ?? null);
}

/** Splice the dragged box into its new place, pin the result, and go looking for a line. */
function applyMove(from: { col: number; idx: number }, to: { col: number; idx: number }) {
  const cols = wellStacks();
  if (!cols.length) return;
  const [moved] = cols[from.col].splice(from.idx, 1);
  if (moved === undefined) return;
  // ⚠ Taking the box out shifts everything after it, so an insertion point *below* it in the same
  // column is one place too far. Off by one here silently swaps two boxes instead of moving one.
  const at = from.col === to.col && to.idx > from.idx ? to.idx - 1 : to.idx;
  cols[to.col].splice(Math.min(at, cols[to.col].length), 0, moved);
  pinCols(cols);
}

/**
 * Adopt an arrangement: pin it, find it a line, redraw, and put a run back on its feet.
 *
 * ⚠ One definition for every way the well can be rearranged — the drag and all four shuffles.
 * Each of them has to do the same three things, and the one that gets forgotten is the line: a
 * pinned board skips `derive`, so nothing else will ever produce a `refTaps` for it.
 * ⚠ Searched **inline here**, unlike the edit path where it is debounced: these are single
 * deliberate presses, not a drag-paint firing once per cell, and ~200ms once is worth the panel
 * telling the truth immediately.
 */
function pinCols(cols: Color[][]) {
  const wasPlaying = !!play;
  const sofar = [...playTaps];
  bp.columns = cols;
  bp.refTaps = lineFor(bp, cols);
  commit();
  // Rearranging under a running game replays it against the new stacks — the whole point of being
  // able to do it mid-run.
  if (wasPlaying) startPlay(sofar);
}

/**
 * The well read as one list, **row by row from the top**: the four open boxes first, then the four
 * behind them, and so on.
 *
 * ⚠ That order is what "the first 12 boxes" means, and it is not the same as reading a column at a
 * time. The player meets the well in rows — every column's open box is live at once — so a range
 * counted down one column and then back to the top of the next would scramble boxes the player
 * reaches minutes apart while leaving a whole row untouched.
 */
function wellSlots(cols: Color[][]): { col: number; idx: number }[] {
  const deepest = Math.max(0, ...cols.map((c) => c.length));
  const out: { col: number; idx: number }[] = [];
  for (let d = 0; d < deepest; d++) {
    for (let j = 0; j < cols.length; j++) if (d < cols[j].length) out.push({ col: j, idx: d });
  }
  return out;
}

/**
 * Shuffle the boxes that occupy one stretch of the well, leaving every other box where it is.
 *
 * `from`/`to` are 1-based positions in `wellSlots` order, `to` past the end meaning "to the bottom".
 * Both are clamped, so a range wider than the well shuffles what there is rather than refusing —
 * these are exploratory buttons and a press that does nothing looks broken.
 *
 * ⚠ The colours move between **slots**, so the multiset is untouched by construction: the level
 * still has exactly the boxes its trays need. That is the one property a shuffle must not break.
 * ⚠ `Math.random`, deliberately. Everything else in this file is seeded off the drawing so the
 * level the editor measured is the level the player gets — but this is a design tool being pressed
 * repeatedly to *look for* an arrangement, and a seeded shuffle would hand back the same one every
 * time. What gets pinned afterwards is fixed, which is where determinism actually matters.
 */
function shuffleRange(from: number, to: number) {
  const cols = wellStacks();
  const slots = wellSlots(cols);
  // A negative `from` counts back from the bottom — "the last 30" is a stretch measured from the
  // end, and the well's depth changes with every tray added.
  const lo = from < 0 ? Math.max(0, slots.length + from) : Math.max(0, from - 1);
  const hi = Math.min(slots.length, to);
  if (hi - lo < 2) return;
  const picked = slots.slice(lo, hi);
  const colours = picked.map(({ col, idx }) => cols[col][idx]);
  for (let i = colours.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [colours[i], colours[j]] = [colours[j], colours[i]];
  }
  picked.forEach(({ col, idx }, k) => {
    cols[col][idx] = colours[k];
  });
  pinCols(cols);
}

wellEl.addEventListener("pointerdown", (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>(".wbox");
  if (!el || !preview) return;
  dragBox = { col: Number(el.dataset.col), idx: Number(el.dataset.idx) };
  el.classList.add("dragging");
  wellEl.setPointerCapture(e.pointerId);
  // Or the browser starts a text selection over the well and the drag reads as a smudge.
  e.preventDefault();
});

wellEl.addEventListener("pointermove", (e) => {
  if (!dragBox) return;
  dropAt = dropPoint(e.clientX, e.clientY);
  paintDropMark();
});

function endDrag() {
  const from = dragBox;
  const to = dropAt;
  dragBox = null;
  dropAt = null;
  wellEl.querySelectorAll(".wmark").forEach((m) => m.remove());
  wellEl.querySelectorAll(".dragging").forEach((b) => b.classList.remove("dragging"));
  if (!from || !to) return;
  // A drop back where it started is not a move, and pinning on it would turn every stray click
  // into a commitment the designer never made.
  if (from.col === to.col && (to.idx === from.idx || to.idx === from.idx + 1)) return;
  applyMove(from, to);
}

wellEl.addEventListener("pointerup", endDrag);
wellEl.addEventListener("pointercancel", endDrag);

/**
 * The shuffle buttons, in the ranges asked for. Positions count from the top of the well, row by
 * row — see `wellSlots`.
 *
 * ⚠ Meant to be pressed **repeatedly and in combination**: each one re-rolls only its own stretch,
 * so shuffling the first twelve and then the tail is two independent decisions rather than one
 * cancelling the other.
 */
const SHUFFLES: { id: string; label: string; from: number; to: number; hint: string }[] = [
  { id: "sh12", label: "Trộn 12 hộp đầu", from: 1, to: 12, hint: "Xáo ngẫu nhiên 12 hộp đầu tiên tính từ trên xuống (3 hàng đầu)" },
  { id: "sh16", label: "Trộn 16 hộp đầu", from: 1, to: 16, hint: "Xáo ngẫu nhiên 16 hộp đầu tiên tính từ trên xuống (4 hàng đầu)" },
  { id: "shTail", label: "Trộn 30 hộp cuối", from: -30, to: Infinity, hint: "Xáo ngẫu nhiên 30 hộp cuối cùng của giếng" },
  { id: "sh1230", label: "Trộn hộp 12–30", from: 12, to: 30, hint: "Xáo ngẫu nhiên các hộp ở vị trí 12 đến 30" },
  // The two bands the shipped run of levels 14-205 was shuffled on that had no button here. Both
  // are ranges like the others, so they cost a row of this table and nothing else.
  { id: "sh2436", label: "Trộn hộp 24–36", from: 24, to: 36, hint: "Xáo ngẫu nhiên các hộp ở vị trí 24 đến 36 (hàng 6 đến 9)" },
  { id: "shTail15", label: "Trộn 15 hộp cuối", from: -15, to: Infinity, hint: "Xáo ngẫu nhiên 15 hộp cuối cùng của giếng" },
];

wellAutoEl.onclick = () => {
  // Back under the normal derivation: the search rebuilds the stacks against this slot's target.
  delete bp.columns;
  delete bp.refTaps;
  commit();
};

// ⚠ Built once and only toggled afterwards. Rebuilding them inside `renderWell` would re-create
// four nodes on every commit — including every cell of a drag-paint — and drop the button under
// the pointer mid-click.
const shuffleBtns = SHUFFLES.map((sh) => {
  const b = document.createElement("button");
  b.id = sh.id;
  b.className = "ghost";
  b.textContent = sh.label;
  b.title = sh.hint;
  b.onclick = () => shuffleRange(sh.from, sh.to);
  wellAutoEl.parentElement!.appendChild(b);
  return b;
});

aDir.addEventListener("change", () => {
  arrowDir = aDir.value as ArrowDir;
  const c = activeArrow();
  if (c) c.arrow = arrowDir;
  commit();
});

function renderTools() {
  toolsEl.replaceChildren();
  for (const t of TOOLS) {
    const b = document.createElement("button");
    b.className = "tool";
    b.setAttribute("aria-pressed", String(tool === t.id));
    b.onclick = () => {
      tool = t.id;
      if (!KEEPS_SELECTION.has(t.id)) selected = -1;
      commit();
    };

    const chip = document.createElement("span");
    chip.className = "chip";
    chip.style.background =
      t.id === "pick"
        ? "transparent"
        : t.id === "wall"
        ? "var(--body)"
        : t.id === "floor"
          ? "var(--slot)"
          : t.id === "crate"
            ? "#8a5a33"
            : t.id === "hatch"
              ? "#5b6a86"
              : hex(color);
    if (t.id === "wall" || t.id === "floor") chip.style.border = "1px solid #c8d1e2";
    // A dashed ring rather than a colour: this tool paints nothing, so a filled swatch would
    // promise a material it never lays down.
    if (t.id === "pick") chip.style.border = "2px dashed #8c98b4";

    const label = document.createElement("span");
    label.textContent = t.label;
    const key = document.createElement("span");
    key.className = "key";
    key.textContent = t.key;

    b.append(chip, label, key);
    b.title = t.hint;
    toolsEl.appendChild(b);
  }
}

function renderSwatches() {
  swatchesEl.replaceChildren();
  PALETTE.forEach((sw, idx) => {
    const b = document.createElement("button");
    b.className = "sw";
    b.style.background = hex(idx);
    b.title = sw.name;
    b.setAttribute("aria-pressed", String(color === idx));
    b.onclick = () => {
      color = idx;
      // With a hatch open, a colour means "this is what the tray I am pointing at is" — and
      // then step on. Filling the row is the common case, so the step is automatic; going back
      // to fix one entry is a click on its chip.
      const c = activeHatch();
      if (c) {
        const queue = [...(c.queue ?? [])];
        if (queue.length) {
          queue[slot] = idx;
          c.queue = queue;
          if (slot < queue.length - 1) slot++;
        }
      }
      // Same idea for a linked pair: point at a half, pick a colour, and it steps to the other
      // one so both get set in two clicks.
      const pr = activePair();
      if (pr) {
        if (pairHalf === 0) pr.color = idx;
        else pr.mate = idx;
        pairHalf = pairHalf === 0 ? 1 : 0;
      }
      // ⚠ A chocolate box is deliberately **not** driven from here. It has its own two palettes —
      // one for the ribbon, one for the four trays — because this row is the brush and a click on
      // it was silently doing a third job with nothing on screen to say so.
      commit();
    };
    swatchesEl.appendChild(b);
  });
}

/**
 * Bring a contextual panel into view the moment it opens.
 *
 * ⚠ **A panel that opens below the fold has not opened**, as far as the hand is concerned. The
 * tool list is 507px tall on its own, so at an 800px-high window the arrow tray's direction picker
 * lands at y 799 — one pixel under the edge. Reported as "chưa chọn được chiều mũi tên", and the
 * picker was there and working the whole time; nothing on screen said so.
 *
 * ⚠ Only on the **transition** from hidden to shown. `commit()` re-renders every panel on every
 * keystroke and every painted cell, so scrolling whenever an open panel happens to be off-screen
 * would drag the page out from under a drag-paint.
 */
const wasOpen = new WeakMap<HTMLElement, boolean>();
function reveal(box: HTMLElement) {
  const open = !box.hidden;
  const before = wasOpen.get(box) ?? false;
  wasOpen.set(box, open);
  if (!open || before) return;
  const r = box.getBoundingClientRect();
  if (r.top >= 0 && r.bottom <= window.innerHeight) return;
  box.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

/** The linked pair currently open for editing, or null. */
function activePair(): Cell | null {
  const c = selected >= 0 ? bp.cells[selected] : null;
  return c && c.kind === "tile" && c.wide ? c : null;
}

/** The cell the arrow panel is aimed at: the selected one, if it is an arrow tray. */
function activeArrow() {
  const c = bp.cells[selected];
  return c && c.kind === "tile" && c.arrow ? c : null;
}

function renderArrow() {
  const c = activeArrow();
  if (!c) {
    arrowBox.hidden = true;
    reveal(arrowBox);
    return;
  }
  arrowBox.hidden = false;
  aDir.value = c.arrow ?? "down";
  // ⚠ Says what the arrow is actually pointing **at**, not just which way it faces. The rule is
  // about the neighbouring tray, and "chỉ xuống" is only half of it — the half that cannot tell
  // you the arrow is aimed at a crate.
  const at = stepTarget(selected, c.arrow ?? "down", bp.cols, bp.rows);
  const NAME: Record<string, string> = {
    wall: "thành máy — không bao giờ mở được",
    crate: "thùng gỗ — không bao giờ mở được",
    floor: "ô trống — mở ngay từ đầu",
    tile: "một khay — phải đổ khay đó trước",
    hatch: "cửa xả",
    choc: "hộp socola",
  };
  aWhere.textContent =
    at < 0 ? "Chỉ ra ngoài mép bảng — không bao giờ mở được." : "Đang chỉ vào " + (NAME[bp.cells[at].kind] ?? "?") + ".";
  reveal(arrowBox);
}

function renderPair() {
  const c = activePair();
  if (!c) {
    pairBox.hidden = true;
    reveal(pairBox);
    return;
  }
  pairBox.hidden = false;
  pairHidden.checked = !!c.hidden;
  pairSlots.replaceChildren();
  [
    ["Trái", c.color ?? 0],
    ["Phải", c.mate ?? c.color ?? 0],
  ].forEach(([label, col], k) => {
    const b = document.createElement("button");
    b.className = `qslot${pairHalf === k ? " sel" : ""}`;
    b.style.background = hex(col as Color);
    b.title = String(label);
    b.textContent = String(label);
    b.onclick = () => {
      pairHalf = k;
      render();
    };
    pairSlots.appendChild(b);
  });
  reveal(pairBox);
}

/** Paint the selected tray under a chocolate box, then step to the next one. */
function setChocSlotColor(c: Cell, idx: Color) {
  const under = [...(c.under ?? [])];
  if (!under.length) return;
  under[chocSlot] = { ...under[chocSlot], color: idx };
  c.under = under;
  if (chocSlot < under.length - 1) chocSlot++;
}

/** The chocolate box currently open for editing, or null. */
function activeChoc(): Cell | null {
  const c = selected >= 0 ? bp.cells[selected] : null;
  return c && c.kind === "choc" ? c : null;
}

function renderChoc() {
  const c = activeChoc();
  if (!c) {
    chocBox.hidden = true;
    reveal(chocBox);
    return;
  }
  chocBox.hidden = false;
  chocNeed.value = String(c.need ?? 1);
  chocRainbow.checked = (c.border ?? null) === null;
  // The ribbon swatches only mean anything on a single-colour box, so they go away on a rainbow
  // one rather than sitting there inert.
  chocBorder.hidden = chocRainbow.checked;
  chocBorder.replaceChildren();
  PALETTE.forEach((sw, idx) => {
    const b = document.createElement("button");
    b.className = `sw${c.border === idx ? " sel" : ""}`;
    b.style.background = hex(idx);
    b.title = sw.name;
    b.onclick = () => {
      // ⚠ **The ribbon does not touch the four trays inside, and it used to.** A single-colour
      // ribbon is the box's *unlock condition* — which colour of tray, poured on the board
      // outside, brings the counter down — and nothing more. `creditLids` compares `lid.color`
      // against the tray just poured and never reads `lid.tiles`, so the four hidden trays may be
      // four different colours and the engine has always allowed it. Repainting them here made a
      // rule out of a convention and quietly cost every such box three of its colours.
      // `Tô cả 4 cùng màu` is still there for when that really is what you want.
      c.border = idx;
      commit();
    };
    chocBorder.appendChild(b);
  });

  chocSlots.replaceChildren();
  const under = c.under ?? [];
  under.forEach((u, k) => {
    const b = document.createElement("button");
    b.className = `qslot${chocSlot === k ? " sel" : ""}`;
    b.style.background = hex(u.color);
    b.textContent = u.hidden ? "?" : "";
    b.title = ["trên trái", "trên phải", "dưới trái", "dưới phải"][k];
    b.onclick = () => {
      chocSlot = k;
      render();
    };
    chocSlots.appendChild(b);
  });

  // ⚠ Its own palette, right under the four slots. The main swatch row also drove these, which
  // is the other half of why picking colours here was awkward: that row is the *brush*, so it was
  // doing two unrelated jobs at once and nothing on screen said which one a click would hit.
  chocUnder.replaceChildren();
  PALETTE.forEach((sw, idx) => {
    const b = document.createElement("button");
    b.className = `sw${under[chocSlot]?.color === idx ? " sel" : ""}`;
    b.style.background = hex(idx);
    b.title = sw.name;
    b.onclick = () => {
      setChocSlotColor(c, idx);
      commit();
    };
    chocUnder.appendChild(b);
  });
  chocHidden.checked = !!under[chocSlot]?.hidden;
  // How many trays of the right kind the rest of the board can actually offer. ⚠ The four trays
  // under the box can never count toward opening it — they are not tappable while it is closed —
  // so this is the number the counter has to stay under or the box never opens at all.
  chocSupply.textContent = `Bàn có ${chocSupplyCount(c)} khay thỏa mãn (không tính 4 khay bị che)`;
  reveal(chocBox);
}

/** Trays outside this box that would count toward its counter. */
function chocSupplyCount(c: Cell): number {
  let n = 0;
  const wants = (col: Color) => (c.border ?? null) === null || c.border === col;
  bp.cells.forEach((cell, i) => {
    if (i === selected) return;
    if (cell.kind === "tile" && cell.color !== undefined) {
      if (wants(cell.color)) n++;
      if (cell.wide && wants(cell.mate ?? cell.color)) n++;
    }
    if (cell.kind === "hatch") for (const q of cell.queue ?? []) if (wants(q)) n++;
    // Another box's four trays only count once *that* box has burst, which may never happen —
    // but it is still supply the player can reach, so it counts.
    if (cell.kind === "choc") for (const u of cell.under ?? []) if (wants(u.color)) n++;
  });
  return n;
}

/** The hatch currently open for editing, or null. */
function activeHatch(): Cell | null {
  const c = selected >= 0 ? bp.cells[selected] : null;
  return c && c.kind === "hatch" ? c : null;
}

/**
 * Set how many trays the hatch holds. Growing repeats the last colour rather than inventing
 * one: the row is filled left to right straight after, and a colour you chose is a better
 * starting point than a colour nobody picked.
 */
function setHatchCount(c: Cell, n: number) {
  const queue = [...(c.queue ?? [])];
  const hid = [...(c.hiddenQ ?? [])];
  while (queue.length > n) {
    queue.pop();
    hid.pop();
  }
  while (queue.length < n) {
    queue.push(queue[queue.length - 1] ?? color);
    hid.push(false);
  }
  c.queue = queue;
  c.hiddenQ = hid;
  if (slot >= n) slot = n - 1;
}

function renderHatch() {
  const c = activeHatch();
  if (!c) {
    hatchBox.hidden = true;
    reveal(hatchBox);
    return;
  }
  hatchBox.hidden = false;
  const queue = c.queue ?? [];
  qCount.value = String(queue.length);
  qDir.value = c.dir ?? "down";
  if (slot < 0 || slot >= queue.length) slot = 0;
  qWhich.textContent = queue.length ? `đang sửa khay ${slot + 1}/${queue.length}` : "";
  qHidden.checked = !!c.hiddenQ?.[slot];

  queueEl.replaceChildren();
  queue.forEach((col, k) => {
    const b = document.createElement("button");
    b.className = "qchip";
    b.style.background = hex(col);
    b.setAttribute("aria-pressed", String(slot === k));
    b.textContent = c.hiddenQ?.[k] ? "?" : "";
    b.title = `Khay ${k + 1}`;
    const idx = document.createElement("span");
    idx.className = "idx";
    idx.textContent = String(k + 1);
    b.appendChild(idx);
    b.onclick = () => {
      slot = k;
      commit();
    };
    queueEl.appendChild(b);
  });
  reveal(hatchBox);
}

// ── Status ───────────────────────────────────────────────────────────────────

function renderStatus() {
  const counts = trayCounts(bp);
  const trays = [...counts.values()].reduce((a, b) => a + b, 0);
  const columns = deriveColumns(bp);
  const boxes = columns.reduce((a, c) => a + c.length, 0);

  statsEl.replaceChildren();
  const stat = (k: string, v: string) => {
    const row = document.createElement("div");
    row.className = "stat";
    const a = document.createElement("span");
    a.textContent = k;
    const b = document.createElement("b");
    b.textContent = v;
    row.append(a, b);
    statsEl.appendChild(row);
  };
  stat("Số khay", String(trays));
  stat("Số bi", String(trays * TRAY_N));
  stat("Số màu", String(counts.size));
  stat("Số hộp sinh ra", `${boxes} (${BOX_SLOTS} lỗ mỗi hộp)`);

  // What the ladder puts at this level number. A hand-built board carries no difficulty label
  // of its own, so the only honest way to say "this is heavy for level 3" is to say what the
  // generator makes for level 3 — and 13 trays where it makes 9 is the whole story.
  // ⚠ Only when asked. Building the reference calls `makeLevel`, which regenerates and re-plays
  // a board until it is provably playable — ~90ms, on a panel that redraws per brush stroke.
  const ref = measureEl.checked ? generatedShape(lastLevel) : null;
  if (ref) stat(`Level ${lastLevel} máy sinh`, `${ref.trays} khay · ${ref.colors} màu`);

  // ⚠ Everything that calls addIssue has to come *after* this line. Warnings raised above it
  // are added and then wiped in the same frame, which looks exactly like a condition that never
  // fired — and the one that got lost this way was the heaviest signal on the panel.
  issuesEl.replaceChildren();
  const problems = checkBlueprint(bp);
  for (const p of problems) addIssue(p.fatal ? "fatal" : "warn", p.text);

  if (droppedOnOpen.length) {
    addIssue(
      "warn",
      `Bảng máy sinh có ${droppedOnOpen.join(" và ")} — editor chưa có công cụ cho những thứ đó ` +
        `nên chúng không được mở ra. Lưu đè lên level này là mất chúng.`,
    );
  }

  // ⚠ A chocolate box whose counter is higher than the board can ever feed it never opens, and
  // `isWon` refuses to finish while any box is still on the board — so the level is unwinnable,
  // not merely hard. The four trays underneath cannot count toward their own box (nothing can
  // tap them while it is closed), which is exactly the trap: a rainbow box over a corner of a
  // 20-tray board looks like it has plenty of supply and does not.
  bp.cells.forEach((cell, i) => {
    if (cell.kind !== "choc") return;
    const was = selected;
    selected = i;
    const supply = chocSupplyCount(cell);
    selected = was;
    const need = cell.need ?? 1;
    if (need > supply) {
      const kind = (cell.border ?? null) === null ? "bất kỳ màu" : `màu ${PALETTE[(cell.border as Color) % PALETTE.length].name}`;
      addIssue(
        "fatal",
        `Hộp socola ở ô ${i} cần đổ ${need} khay ${kind} nhưng bàn chỉ có ${supply} — hộp không ` +
          `bao giờ mở được, và màn chỉ thắng khi mọi hộp đã vỡ. Bốn khay bị che không tự tính cho hộp che chúng.`,
      );
    }
  });

  // ⚠ The board has to offer a first move. `isStuck` judges a level dead when nothing on the
  // belt fits a box and no tray can be tapped — which on an untouched board means the player
  // sees JAMMED before making a single move. A grid packed edge to edge does exactly that: every
  // tray is hemmed in by another tray, none of them is sealed by casing, and no per-cell check
  // catches it. Ask the engine, which is the only thing that knows.
  if (preview && !preview.hasAvailableTap() && trays > 0) {
    addIssue(
      "fatal",
      "Không ô nào bấm được ngay từ đầu — vào màn là JAMMED luôn. Khay chỉ đi được khi có " +
        "ít nhất một ô trống sát cạnh; bảng kín mít hoặc bị thành máy bó sát thì không khay nào nhúc nhích.",
    );
  }

  if (measureEl.checked && ref && (trays > ref.trays + 2 || counts.size > ref.colors + 1)) {
    addIssue(
      "warn",
      `Nặng hơn level ${lastLevel} bình thường (${ref.trays} khay, ${ref.colors} màu). ` +
        `Càng nhiều bi thì ray càng dễ đầy trước khi hộp kịp mở.`,
    );
  }

  // The one thing about a drawing that is invisible until you play it: a "?" tile next to a gap
  // is face-up before the first frame, so placing four of them along an open edge buys nothing.
  let popped = 0;
  for (let i = 0; i < bp.cells.length; i++) {
    const c = bp.cells[i];
    if (c.kind === "tile" && c.hidden && preview && preview.tiles[i] && !preview.tiles[i]!.hidden) {
      popped++;
    }
  }
  if (popped) {
    addIssue(
      "warn",
      `${popped} ô ? lộ màu ngay khi vào màn — khay hở một hướng thì không thể là khay ?. ` +
        `Kín cả bốn phía mới úp được, và hàng dưới cùng thì luôn hở (miệng phễu).`,
    );
  }

  // ⚠ A pinned order with no line is the one failure this feature can create, so it is checked
  // here rather than left to the bot rate below — the bots can win a board whose *reference* line
  // is missing, and it is the reference line that `hint()` and every offline tool replay as the
  // proof it is winnable. `toLevelDef` has already replayed whatever is stored and dropped it if it
  // no longer wins, so an empty `refTaps` on a pinned drawing means exactly what it says.
  if (bp.columns?.length && !previewDef?.refTaps.length) {
    addIssue(
      "fatal",
      "Thứ tự hộp đang ghim nhưng chưa tìm được lời giải nào — level này có thể không thắng được. " +
        "Kéo lại vài hộp, hoặc bấm Sắp lại tự động.",
    );
  }

  if (lastRate) {
    const { wins, runs } = lastRate;
    const pct = Math.round((wins / runs) * 100);
    addIssue(
      wins === 0 ? "fatal" : pct < 40 ? "warn" : "ok",
      wins === 0
        ? `Bot chơi ${runs} ván, thắng 0 — bảng này có thể không giải được.`
        : `Bot thắng ${pct}% (${wins}/${runs}). Bot không dùng booster hay undo.`,
    );
  } else if (!issuesEl.childElementCount) {
    // ⚠ Ask the panel what is already on it, not the individual conditions. Listing them by hand
    // means every new check has to be added here too, and the one that got missed printed
    // "chưa thấy lỗi" directly underneath a fatal error.
    addIssue("ok", "Chưa thấy lỗi cấu trúc.");
  }
}

/**
 * Last measured bot rate, refreshed in the background after the board settles.
 *
 * ⚠ Debounced, and never inline in `commit()`. A drag-paint commits once per cell, and playing
 * a board through to a win or a jam is not free — running it per stroke turns painting a wall
 * into a slideshow. The number being a moment out of date costs nothing; the editor showing it
 * at all is the point, because "press Kiểm tra" is a step nobody remembers until the level is
 * already jamming in play.
 */
let lastRate: { wins: number; runs: number } | null = null;
let rateTimer = 0;

function scheduleBotCheck() {
  lastRate = null;
  clearTimeout(rateTimer);
  if (!measureEl.checked) return;
  rateTimer = window.setTimeout(() => {
    if (!trayCounts(bp).size) return;
    lastRate = botTrials(12);
    renderStatus();
  }, 350);
}

/**
 * Trays and colours the generator puts at a level number. Cached: `makeLevel` regenerates and
 * re-plays a board until it is provably playable, which is ~90ms — fine once, not on every
 * brush stroke.
 */
const shapeCache = new Map<number, { trays: number; colors: number }>();
function generatedShape(level: number): { trays: number; colors: number } | null {
  const hit = shapeCache.get(level);
  if (hit) return hit;
  try {
    const d = makeLevel(level);
    const trays =
      d.tiles.filter(Boolean).length +
      d.disp.reduce((a, x) => a + (x ? x.queue.length : 0), 0);
    const out = { trays, colors: d.colors.length };
    shapeCache.set(level, out);
    return out;
  } catch {
    return null;
  }
}

function addIssue(kind: "ok" | "warn" | "fatal", text: string) {
  const row = document.createElement("div");
  row.className = `issue ${kind}`;
  const dot = document.createElement("span");
  dot.className = "dot";
  const t = document.createElement("span");
  t.textContent = text;
  row.append(dot, t);
  issuesEl.appendChild(row);
}

/**
 * Play the board with a plain greedy bot, a few times over.
 *
 * ⚠ This proves the board *can* be cleared, not that it is fair — the same distinction the
 * generator draws between `verify()` and `playableRate()`. A board a bot clears 1 time in 20 is
 * solvable and miserable, so the count is reported rather than reduced to a pass or a fail.
 */
function botTrials(runs = 20): { wins: number; runs: number } {
  let wins = 0;
  for (let r = 0; r < runs; r++) {
    const g = new Game(toLevelDef(bp));
    let guard = 0;
    while (g.status === "play" && guard++ < 20000) {
      const open: number[] = [];
      for (let i = 0; i < g.tiles.length; i++) if (g.canTap(i)) open.push(i);
      // Prefer a tray whose colour a box is waiting for; otherwise take any legal tap. The
      // shuffle is what makes repeat runs differ — one deterministic run says almost nothing.
      const ready = open.filter((i) => {
        const t = g.tiles[i];
        return t && !t.hidden && g.boxes.some((b) => b.stack[0] === t.color);
      });
      const pool = ready.length ? ready : open;
      if (pool.length && g.capacity() >= TRAY_N) {
        g.tap(pool[(Math.random() * pool.length) | 0]);
      }
      g.arriveAll();
      g.tick();
    }
    if (g.status === "won") wins++;
  }
  return { wins, runs };
}

// ── Saved levels ─────────────────────────────────────────────────────────────

function currentLevel(): number {
  return Math.max(1, Math.round(Number(lvlEl.value) || 1));
}

/** Which level the drawing on screen belongs to. The badge and the panel both follow it. */
let lastLevel = 1;
/**
 * Where the drawing on screen came from — a device save, the shipped table, the generator, nothing,
 * or the scratch slot with no level attached to it.
 */
let origin: "saved" | "shipped" | "generated" | "blank" | "scratch" = "saved";

/**
 * Which level the scratch drawing belongs to, remembered across reloads.
 *
 * ⚠ Without this the editor reopens showing the scratch board — the drawing you were last working
 * on, which is the point of the scratch slot — while the level box sits at its HTML default of 1.
 * The badge then says "Level 1" about a board that has nothing to do with level 1, and comparing
 * it against the game reads as the two disagreeing. Reported exactly that way.
 */
const LEVEL_KEY = "bf_editor_level";

function setLastLevel(n: number) {
  lastLevel = n;
  try {
    localStorage.setItem(LEVEL_KEY, String(n));
  } catch {
    /* storage unavailable — the label is lost on reload, the drawing is not */
  }
}
/** Features the generated board had that the editor cannot represent yet. */
let droppedOnOpen: string[] = [];

/**
 * Switch to a level: load its board, or start blank if nothing is saved there.
 *
 * ⚠ Unguarded on purpose — switching level never asks. Flipping between levels to compare them
 * is the common move and a modal on every hop is noise; the badge already reads "có sửa chưa
 * lưu" while there is unsaved work, which is the same information without stopping the hand.
 * The cost is real and accepted: an unsaved drawing is gone once you switch away from it.
 *
 * ⚠ Still driven by `change` rather than `input`. Typing "12" passes through "1" on the way, so
 * an `input` handler would load level 1 and wipe the board between two keystrokes — and with no
 * confirm left, nothing at all would stand between a keystroke and the loss.
 */
function openLevel(n: number) {
  // A different board arrives: whatever pin it carries is its own, and must not be judged against
  // the drawing that was on screen a moment ago.
  pinSig = null;
  const saved = loadBook()[n];
  const ship = HANDMADE[n];
  origin = "saved";
  droppedOnOpen = [];
  if (saved?.cells?.length) {
    bp = JSON.parse(JSON.stringify(saved)) as Blueprint;
  } else if (ship?.cells?.length) {
    // ⚠ The shipped hand-built table sits **between** this device's saves and the generator —
    // the same three-step order `blueprintFor` serves the game, and this has to stay in step
    // with it. Skipping this step is what made the editor open a generated 6x5 board for level
    // 32 while the game played the shipped 7x7 one: two different boards under one number, with
    // the badge cheerfully calling the wrong one "máy sinh".
    bp = JSON.parse(JSON.stringify(ship)) as Blueprint;
    origin = "shipped";
  } else {
    // Nothing hand-built here, so open what the level *currently is* — the generator's board —
    // rather than a blank grid. Starting from the real thing is the difference between editing
    // a level and re-typing one.
    try {
      const { bp: made, dropped } = fromLevelDef(makeLevel(n));
      bp = made;
      origin = "generated";
      droppedOnOpen = dropped;
    } catch {
      bp = blankBlueprint(bp.cols, bp.rows);
      origin = "blank";
    }
  }
  lvlEl.value = String(n);
  colsEl.value = String(bp.cols);
  rowsEl.value = String(bp.rows ?? GRID_ROWS);
  selected = -1;
  slot = 0;
  setLastLevel(n);
  commit();
}

/**
 * Four states, not two: no board here yet, saved on this device, shipped in `HANDMADE`, or the
 * generator's. Each needs its own wording — "có sửa chưa lưu" is the one worth a colour, because
 * without it "Level 7" reads as "level 7 is this" and unsaved edits look shipped.
 *
 * ⚠ The three sources are tested in the same order `openLevel` opens them and `blueprintFor`
 * serves them. A badge that names a different source than the one on screen is worse than no
 * badge: it is what you check first when the editor and the game disagree.
 */
function renderBadge() {
  // The badge describes the board on screen, so it follows `lastLevel`. Following the input box
  // would have it report on a level you have only started typing and not switched to.
  const n = lastLevel;
  const saved = loadBook()[n];
  const ship = HANDMADE[n];
  const same = (b?: Blueprint) => !!b && JSON.stringify(b) === JSON.stringify(bp);
  if (origin === "scratch") {
    // ⚠ Checked before the level-number branches, because in this state there *is* no level
    // number — `lastLevel` is only the HTML default. Letting it fall through would print
    // "Level 1 · ..." about a drawing that was never level 1's, which is the exact confusion
    // this state exists to name.
    badgeEl.className = "badge";
    badgeEl.textContent = "Bản nháp · chưa gắn với level nào";
  } else if (saved?.cells?.length) {
    const dirty = !same(saved);
    badgeEl.className = "badge " + (dirty ? "dirty" : "saved");
    badgeEl.textContent = `Level ${n} · ${dirty ? "có sửa chưa lưu" : "đã lưu"}`;
  } else if (ship?.cells?.length) {
    // ⚠ A shipped board is neither "đã lưu" (it is not in this device's book, so the game will
    // keep serving the shipped copy until you press Lưu) nor "máy sinh" (it is hand-built and
    // off the tuned curve entirely). Saying either sends you hunting in the wrong place.
    const dirty = !same(ship);
    badgeEl.className = "badge " + (dirty ? "dirty" : "");
    badgeEl.textContent = `Level ${n} · bản ship${dirty ? ", có sửa chưa lưu" : ", chưa sửa"}`;
  } else if (origin === "generated") {
    // ⚠ Say where it came from. "Chưa lưu" on a board full of tiles reads as work about to be
    // lost; this one is the generator's and can be regenerated at any time by not saving it.
    badgeEl.className = "badge";
    badgeEl.textContent = `Level ${n} · máy sinh, chưa sửa`;
  } else {
    badgeEl.className = "badge";
    badgeEl.textContent = `Level ${n} · chưa lưu`;
  }
}

/** Keep the "play" links pointed at the level in the box, and show the URL for a blocked tab. */
function renderPlayLinks() {
  const n = currentLevel();
  playLvlEl.href = `./index.html?level=${n}`;
  lookLvlEl.href = `./index.html?level=${n}&preview=1`;
  playUrl.textContent = `index.html?level=${n}&preview=1`;
}

function renderBook() {
  const book = loadBook();
  const nums = Object.keys(book)
    .map(Number)
    .sort((a, b) => a - b);
  bookEl.replaceChildren();
  if (!nums.length) {
    const p = document.createElement("span");
    p.className = "empty-note";
    p.textContent = "Chưa lưu level nào.";
    bookEl.appendChild(p);
    return;
  }
  for (const n of nums) {
    const saved = book[n];
    const trays = [...trayCounts(saved).values()].reduce((a, b) => a + b, 0);
    const row = document.createElement("div");
    row.className = "bookrow";

    const num = document.createElement("span");
    num.className = "n";
    num.textContent = `Level ${n}`;
    const meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent = `${saved.cols} cột · ${trays} khay`;

    const open = document.createElement("button");
    open.textContent = "Mở";
    open.onclick = () => openLevel(n);
    const del = document.createElement("button");
    del.textContent = "Xoá";
    del.onclick = () => {
      dropLevel(n);
      renderBook();
    };

    row.append(num, meta, open, del);
    bookEl.appendChild(row);
  }
}

qCount.oninput = () => {
  const c = activeHatch();
  if (!c) return;
  setHatchCount(c, Math.max(1, Math.min(9, Math.round(Number(qCount.value) || 1))));
  commit();
};

qDir.onchange = () => {
  const c = activeHatch();
  if (!c) return;
  c.dir = qDir.value as Dir;
  commit();
};

qHidden.onchange = () => {
  const c = activeHatch();
  if (!c?.queue?.length) return;
  const hid = [...(c.hiddenQ ?? [])];
  hid[slot] = qHidden.checked;
  c.hiddenQ = hid;
  commit();
};

// `change`, not `input`: typing "12" passes through "1" on the way.
lvlEl.onchange = () => openLevel(currentLevel());

$("saveLvl").onclick = () => {
  const n = currentLevel();
  putLevel(n, bp);
  setLastLevel(n);
  renderBook();
  renderBadge();
  addIssue("ok", `Đã lưu vào level ${n} (trong trình duyệt máy này).`);
};

// ⚠ A real link, not window.open. A popup blocker swallows window.open silently — the click
// does nothing at all and there is no error anywhere to find. The href is kept current by
// `renderPlayLinks`; this handler only has to get the board into storage before the browser
// follows it, which it does, because click handlers run before navigation.
$("playLvl").onclick = () => {
  const n = currentLevel();
  putLevel(n, bp);
  setLastLevel(n);
  renderBook();
  renderBadge();
};

$("exportAll").onclick = () => {
  const book = loadBook();
  const nums = Object.keys(book)
    .map(Number)
    .sort((a, b) => a - b);
  jsonEl.value = nums.length
    ? nums.map((n) => `  ${n}: ${JSON.stringify(book[n])},`).join("\n")
    : "// chưa lưu level nào";
  jsonEl.select();
  addIssue("ok", "Dán khối này vào HANDMADE trong src/game/handmade.ts.");
};

// ── Wiring ───────────────────────────────────────────────────────────────────

/**
 * Keep the box order across a tray edit, instead of deriving a fresh one.
 *
 * ⚠ **Adding a tray used to reshuffle the whole well**, and it looked like a bug because nothing
 * about it is local: the boxes are derived, and `derive` does not extend an arrangement — it builds
 * ~10 fresh candidates from the new drawing, scores each with bot games and keeps whichever lands
 * nearest the slot's target. One new tray is a different drawing, so a different candidate wins and
 * every column is re-dealt. Reported from real use as the order "tự dưng thay đổi".
 *
 * So an edit now **patches** the order it already had: the boxes a colour has gained are appended,
 * the ones it no longer needs are taken away, and everything else stays exactly where it was.
 *
 * ⚠ The multiset is not negotiable — each tray needs `TRAY_N / BOX_SLOTS` boxes of its own colour
 * or the level cannot be finished by anyone — so this fixes the counts and only the counts.
 * ⚠ **Surplus goes from the deepest box up, and new boxes go to the shortest column.** What the
 * player meets first is what the design is about; taking a box off the top would rewrite the part
 * of the level that was already settled, and piling every new box onto one column would bury it.
 * ⚠ Returns null when there is nothing to keep — no previous order, or no trays left — and the
 * caller falls back to a normal derivation.
 */
function patchColumns(cols: Color[][]): Color[][] | null {
  const counts = trayCounts(bp);
  if (!counts.size || !cols.some((c) => c.length)) return null;
  const per = TRAY_N / BOX_SLOTS;
  const need = new Map<Color, number>();
  for (const [color, trays] of counts) need.set(color, trays * per);

  const work = cols.map((c) => [...c]);
  const have = new Map<Color, number>();
  for (const c of work) for (const col of c) have.set(col, (have.get(col) ?? 0) + 1);

  // Too many of a colour: drop them from the bottom of the well upward.
  for (const [color, n] of have) {
    let surplus = n - (need.get(color) ?? 0);
    for (let depth = Math.max(...work.map((c) => c.length)) - 1; depth >= 0 && surplus > 0; depth--) {
      for (let j = work.length - 1; j >= 0 && surplus > 0; j--) {
        if (work[j][depth] === color) {
          work[j].splice(depth, 1);
          surplus--;
        }
      }
    }
  }
  // Too few: add them to whichever column is shortest, so the well stays level.
  for (const [color, want] of need) {
    let missing = want - (have.get(color) ?? 0);
    while (missing > 0) {
      let shortest = 0;
      for (let j = 1; j < work.length; j++) if (work[j].length < work[shortest].length) shortest = j;
      work[shortest].push(color);
      missing--;
    }
  }
  return work.some((c) => c.length) ? work : null;
}

/**
 * The tray drawing, as a string. Everything the box stacks are derived *from*, and nothing else —
 * a selection, a level number or a hand-arranged well must not read as a changed board.
 */
const traySig = (b: Blueprint) => JSON.stringify([b.cols, b.rows, b.cells]);
/**
 * The drawing the pinned stacks belong to, or null while nothing is pinned.
 *
 * ⚠ Null also means "just loaded, do not judge yet" — the first commit after a blueprint arrives
 * adopts whatever pin came with it instead of dropping it. Every place that replaces `bp` sets this
 * back to null for exactly that reason.
 */
let pinSig: string | null = null;

/**
 * Redraw everything from the drawing and save it.
 *
 * ⚠ **Ends any run in progress.** Every edit here rebuilds the def the run is playing, and a game
 * carrying on against a board that no longer exists is the worst of both. The one edit that should
 * *not* end it — rearranging the well — restarts it and replays the taps, which is the whole loop
 * this pairs with: play until it jams, drag a box, watch the same game again.
 */
function commit() {
  if (play) stopPlay();
  // ⚠ Editing the trays invalidates any frozen box stacks. `Blueprint.columns` pins the boxes so a
  // level can be moved between slots without being rebuilt; the moment the drawing changes, those
  // stacks describe a board that no longer exists — wrong colours, wrong count — and the level is
  // unwinnable in a way nothing on screen would explain. Dropping them here puts the board back
  // under the normal derivation, which is what an edited drawing should be under.
  // ⚠ **Only when the trays actually changed**, which is what that paragraph means and is not what
  // it used to do: the delete ran on *every* commit, and everything goes through commit — opening a
  // level, picking a cell, editing a hatch queue. Two things fell out of that. A shipped board with
  // pinned stacks (levels 15-115 all have them) was un-pinned the instant it was opened here, so
  // the editor showed a re-derived well rather than the one that ships. And a well arranged by hand
  // survived exactly until the next click, which makes the tool look broken rather than strict.
  const sig = traySig(bp);
  if (bp.columns?.length && pinSig !== null && pinSig !== sig) {
    // ⚠ **Patched, not dropped.** Dropping put the drawing back under the derivation, which is the
    // correct board and the wrong *behaviour*: the designer added one tray and the whole well was
    // re-dealt. Nothing here moves until they ask for it — `Sắp lại tự động` is the ask.
    const patched = patchColumns(bp.columns);
    if (patched) {
      bp.columns = patched;
      // ⚠ The line is **not** searched for here. `lineFor` plays up to `LINE_TRIES` games — ~200ms
      // — and `commit` runs once per cell of a drag-paint, so doing it inline would put a fifth of
      // a second between the brush and the screen. It is left stale on purpose: `toLevelDef`
      // replays a stored line and discards it if it no longer wins, so nothing downstream can be
      // fooled by it, and `scheduleLine` finds a fresh one once the hand stops.
    } else {
      delete bp.columns;
      delete bp.refTaps;
    }
  }
  saveCustom(bp);
  rebuildPreview();
  // ⚠ **Adopt whatever the derivation produced**, so the *next* edit has an order to keep. Without
  // this only boards that were already pinned are stable and a drawing being built from scratch
  // still re-deals itself on every stroke — which is the case the report came from.
  if (!bp.columns?.length && previewDef?.columns?.some((c) => c.length)) {
    bp.columns = previewDef.columns.map((c) => [...c]);
    bp.refTaps = [...previewDef.refTaps];
    saveCustom(bp);
  }
  pinSig = bp.columns?.length ? traySig(bp) : null;
  render();
  renderTools();
  renderSwatches();
  renderHatch();
  renderPair();
  renderChoc();
  renderArrow();
  renderStatus();
  renderBook();
  renderBadge();
  renderPlayLinks();
  scheduleBotCheck();
  scheduleLine();
}

/**
 * Find a winning line for the stacks now on the drawing, once the editing has stopped.
 *
 * ⚠ Debounced for the same reason the bot check is: a drag-paint commits once per cell, and this
 * plays up to `LINE_TRIES` games. Unlike the bot check it is **not** behind `Đo độ khó` — the line
 * is not a measurement, it is the level's proof that it can be won, and a board saved without one
 * is a board every tool downstream reports as unsolvable.
 *
 * ⚠ Skipped while `previewDef` already has one: `toLevelDef` replays whatever is stored and keeps
 * it only if it still wins, so a non-empty `refTaps` there means the stored line survived the edit
 * and searching again would spend 200ms to find the same thing.
 */
let lineTimer = 0;
function scheduleLine() {
  clearTimeout(lineTimer);
  lineTimer = window.setTimeout(() => {
    // A run owns `preview` while it is going, and the board it is playing is already fixed.
    if (play || !bp.columns?.length || previewDef?.refTaps.length) return;
    const line = lineFor(bp, bp.columns);
    if (!line.length) return;                    // the panel's fatal warning is the right answer
    bp.refTaps = line;
    saveCustom(bp);
    rebuildPreview();
    renderStatus();
  }, 400);
}

boardEl.addEventListener("pointerdown", (e) => {
  const t = (e.target as HTMLElement).closest(".cell") as HTMLElement | null;
  if (!t) return;
  const i = Number(t.dataset.i);
  // ⚠ While a run is on the board is being **played**, not drawn on. Painting through would edit
  // the drawing under a game already running on the old one — and `render()` draws them both from
  // the same elements, so the damage would not even be visible until the run ended.
  if (play) {
    if (play.status === "play" && play.canTap(i)) {
      play.tap(i);
      playTaps.push({ at: play.ticks, idx: i });
      render();
    }
    return;
  }
  painting = true;
  boardEl.setPointerCapture(e.pointerId);
  apply(i);
});
boardEl.addEventListener("pointermove", (e) => {
  if (!painting) return;
  // Drag-paint has to hit-test the point rather than trust the event target: pointer capture
  // sends every move to the cell the drag started in.
  const t = document.elementFromPoint(e.clientX, e.clientY)?.closest(".cell") as HTMLElement | null;
  if (!t) return;
  const i = Number(t.dataset.i);
  // Dragging never re-enters the hatch editor; it would reselect on every pixel of movement.
  if (tool === "hatch" || tool === "pair" || tool === "choc" || tool === "arrow" || tool === "pick") return;
  apply(i);
});
const stopPaint = () => (painting = false);
boardEl.addEventListener("pointerup", stopPaint);
boardEl.addEventListener("pointercancel", stopPaint);
window.addEventListener("blur", stopPaint);

window.addEventListener("keydown", (e) => {
  if ((e.target as HTMLElement)?.tagName === "TEXTAREA") return;
  const t = TOOLS.find((x) => x.key === e.key);
  if (t) {
    tool = t.id;
    if (!KEEPS_SELECTION.has(t.id)) selected = -1;
    commit();
  }
});

// Off by default: while a level is being drawn, a winrate is a distraction, and the structural
// checks below it are the ones that catch a board that cannot be played at all.
try {
  measureEl.checked = !!localStorage.getItem("bf_editor_measure");
} catch {
  /* storage unavailable */
}

// ⚠ Boot does NOT open a level: `bp` is the scratch drawing, deliberately, so reopening the
// editor gives you back the board you were working on. What it must not do is *label* that
// drawing with a level number it never came from. Three ways to find the right label, in
// falling order of confidence, and the last one is admitting there is none:
//
//   1. the drawing is byte-identical to a save  -> it is that level
//   2. a level was remembered when it was opened -> it is that level
//   3. neither                                   -> it is a loose drawing, and the badge says so
//
// Left to the HTML default the box reads "1" and the badge asserted "Level 1" over a drawing
// with nothing to do with level 1 — which, held up against the game, reads as the editor and
// the game disagreeing about a level. Reported exactly that way.
{
  const book = loadBook();
  const mine = JSON.stringify(bp);
  const match = Object.keys(book).find((k) => JSON.stringify(book[Number(k)]) === mine);
  let stored: number | null = null;
  try {
    const v = Number(localStorage.getItem(LEVEL_KEY));
    stored = Number.isFinite(v) && v >= 1 ? v : null;
  } catch {
    /* storage unavailable */
  }
  if (match) lvlEl.value = match;
  else if (stored != null) lvlEl.value = String(stored);
  else if (loadCustom()) origin = "scratch";
  lastLevel = currentLevel();
}

colsEl.value = String(bp.cols);
rowsEl.value = String(bp.rows ?? GRID_ROWS);
const resize = () => {
  const cols = Number(colsEl.value);
  const rows = Number(rowsEl.value);
  const next = blankBlueprint(cols, rows);
  // Keep what still fits, so changing either side is a crop rather than a reset.
  for (let y = 0; y < Math.min(rows, bp.rows); y++) {
    for (let x = 0; x < Math.min(cols, bp.cols); x++) {
      next.cells[y * cols + x] = bp.cells[y * bp.cols + x];
    }
  }
  bp = next;
  pinSig = null;                       // a new drawing: whatever pin it carries is its own
  selected = -1;
  commit();
};
colsEl.onchange = resize;
rowsEl.onchange = resize;

pairHidden.onchange = () => {
  const c = activePair();
  if (c) c.hidden = pairHidden.checked;
  commit();
};

chocNeed.onchange = () => {
  const c = activeChoc();
  if (c) c.need = Math.max(1, Math.round(Number(chocNeed.value) || 1));
  commit();
};

chocRainbow.onchange = () => {
  const c = activeChoc();
  // Coming off rainbow, land on the brush colour rather than colour 0 — the designer has one
  // selected and it is nearly always the one they mean.
  if (c) c.border = chocRainbow.checked ? null : color;
  commit();
};

chocHidden.onchange = () => {
  const c = activeChoc();
  if (!c) return;
  const under = [...(c.under ?? [])];
  if (under[chocSlot]) under[chocSlot] = { ...under[chocSlot], hidden: chocHidden.checked };
  c.under = under;
  commit();
};

$("chocSame").onclick = () => {
  const c = activeChoc();
  if (!c) return;
  // Whatever the selected tray is, applied to all four. The way to build a one-colour box on a
  // rainbow ribbon, which the ribbon swatches deliberately cannot do.
  const col = c.under?.[chocSlot]?.color ?? color;
  c.under = (c.under ?? []).map((u) => ({ ...u, color: col }));
  commit();
};

$("pairDrop").onclick = () => {
  const c = activePair();
  if (!c || selected < 0) return;
  // Splitting leaves two ordinary trays, one per half, keeping the colours already chosen —
  // throwing the right half away would lose a colour the person picked on purpose.
  const right = c.mate ?? c.color ?? 0;
  bp.cells[selected] = { kind: "tile", color: c.color ?? 0, hidden: !!c.hidden };
  if (selected % bp.cols < bp.cols - 1) {
    bp.cells[selected + 1] = { kind: "tile", color: right, hidden: !!c.hidden };
  }
  selected = -1;
  commit();
};

$("clear").onclick = () => {
  bp = blankBlueprint(bp.cols, bp.rows);
  pinSig = null;
  selected = -1;
  commit();
};

// The panel already shows a 12-game reading. This is the same measurement taken properly:
// ⚠ the noise floor at 12 games is ±5 points, so a 12-game number is for spotting a board that
// cannot be won at all, not for placing one on the curve.
// Works whether or not the panel is measuring continuously — this is the "tell me now" button.
$("check").onclick = () => {
  clearTimeout(rateTimer);
  lastRate = botTrials(60);
  renderStatus();
};

measureEl.onchange = () => {
  try {
    localStorage.setItem("bf_editor_measure", measureEl.checked ? "1" : "");
  } catch {
    /* storage unavailable */
  }
  commit();
};

// Same again: the header links open the scratch board, and commit() has already stored it.
$("play").onclick = () => saveCustom(bp);
$("look").onclick = () => saveCustom(bp);
// Both level links save first, so what opens is the drawing on screen and not the last save.
$("lookLvl").onclick = () => {
  const n = currentLevel();
  putLevel(n, bp);
  setLastLevel(n);
  renderBook();
  renderBadge();
};

$("export").onclick = () => {
  jsonEl.value = JSON.stringify(bp);
  jsonEl.select();
};

$("import").onclick = () => {
  try {
    const next = JSON.parse(jsonEl.value) as Blueprint;
    if (!next?.cells?.length || !next.cols) throw new Error("thiếu cells hoặc cols");
    // Trust the file for size but not for contents: an unknown kind would render as nothing
    // and quietly drop the cell.
    const ok: CellKind[] = ["floor", "wall", "tile", "hatch", "crate"];
    next.rows = next.rows || GRID_ROWS;
    next.cells = Array.from({ length: next.cols * next.rows }, (_, i) => {
      const c = next.cells[i] as Cell | undefined;
      return c && ok.includes(c.kind) ? c : { kind: "floor" };
    });
    bp = next;
    pinSig = null;                     // a pasted drawing may bring its own pinned stacks
    selected = -1;
    colsEl.value = String(bp.cols);
  rowsEl.value = String(bp.rows ?? GRID_ROWS);
    commit();
  } catch (err) {
    addIssue("fatal", `JSON không đọc được: ${(err as Error).message}`);
  }
};

commit();
