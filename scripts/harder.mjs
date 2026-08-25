// harder — rebuild named levels to a fraction of the winrate they have now.
//
//   node scripts/harder.mjs --levels 10 --factor 0.8 --out block10.txt        # 80% of what it scores now
//   node scripts/harder.mjs --levels 20,25 --target 0.20 --out block.txt       # land on 20%, whatever it scores now
//   node scripts/harder.mjs --levels 30 --target 0.10 FLOOR=0.06 --out b30.txt
//
// "40% harder" means the new board should score 0.6x what the old one scores, so the brief is
// relative and the baseline has to be measured before anything is built. That measurement is the
// first thing this does, on the shipped board, through `levelDefFor` — the board the player is
// actually served.
//
// ⚠ **The silhouette is never touched — but empty floor inside it may be filled.** Walls, crates,
// hatches, chocolate boxes and linked pairs are what a person drew and none of them move. What this
// changes is the part that was arbitrary anyway: which colour sits on each tray, which trays start
// face-down, the order of the box stacks, and **how many trays stand on the board's own free
// floor**. Adding trays is the strongest lever there is, on instruction — "cần khó thì thêm khay ?
// vào hoặc khay thường".
//
// ⚠ **Filling floor is not free, and the board fights back.** A tray escapes only if one of its
// four neighbours is empty, so every cell filled takes an escape lane away from everything beside
// it. Fill enough and the block seals and the level is dead on arrival — which is why `FILL_MAX`
// caps how much of the free floor may be taken, and why every candidate still has to be cleared by
// `playPerfect` before it is measured at all. A board that fails that is discarded, not shipped
// with a warning.
//
// ⚠ **The box stacks are aimed at the NEW target, and then pinned.** `toLevelDef` runs its
// box-order search against whatever target it is handed, and `levelDefFor` hands it
// `targetWin(level)` — the old, easier one. So the search is driven here with the new target and
// the winner's `columns` + `refTaps` are frozen onto the drawing, exactly as levels 15-115 already
// are. Without the pin the game would rebuild the stacks against the old target on load and serve
// a board nobody measured. Every result is re-read back through `levelDefFor` and fingerprinted to
// prove that did not happen.
//
// ⚠ **Two-stage selection.** Taking the best of N noisy measurements selects boards whose
// *measured* score landed on target, not boards whose true score did. Screen cheaply, re-measure
// the survivors properly, and report the re-measured number.

import { writeFileSync } from "node:fs";
import { loadGame, rate, best, cuongxs1Rate, playPerfect, D_SLIP, noiseAt } from "./bots.mjs";

const M = await loadGame();
const { HANDMADE, levelDefFor, levelFingerprint, toLevelDef, PALETTE } = M;

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const LEVELS = arg("levels", "10").split(",").map(Number);
const FACTOR = Number(arg("factor", 0.6));
/**
 * Absolute target, if given — `--target 0.2` aims every named level at 20% regardless of where it
 * sits now, and `--factor` is ignored.
 *
 * ⚠ An absolute brief can ask for something a drawing cannot reach. A map with eleven trays and
 * four colours has a floor under it that no recolouring gets below, and the honest answer there is
 * "closest I could get", printed as such — not a board bent into a lottery to make the number.
 */
const TARGET = arg("target", "") ? Number(arg("target")) : null;
const BASE_N = Number(process.env.BASE || 120);
const TRIES = Number(process.env.TRIES || 90);
const SCREEN = Number(process.env.SCREEN || 20);
const CONFIRM = Number(process.env.CONFIRM || 90);
/**
 * Best play may not fall below this.
 *
 * ⚠ A board can hit any mean by being a lottery — `forge.mjs` produced one whose worst model read
 * 17% and whose best play read 3%, i.e. planning bought nothing. A level like that is a wall, not
 * a hard level, and the mean says nothing about who is holding it.
 */
const FLOOR = Number(process.env.FLOOR || 0.15);
/** Tolerated distance between best play and careless play. Measured; see CLAUDE.md. */
const GAP_OK = 0.2;
/**
 * At most this share of the board's free floor may be filled with new trays.
 *
 * ⚠ Not a taste knob. The escape rule is adjacency, so free floor *is* the board's supply of
 * moves; taking all of it leaves a packed slab whose only openings are the bottom row over the
 * chute. Swept 0.3 / 0.5 / 0.7 — past 0.5 the discard rate from `playPerfect` climbs fast and the
 * survivors are lotteries rather than hard boards.
 */
const FILL_MAX = Number(process.env.FILL || 0.5);

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
 * A variant of a drawing: same map, new colours, new face-down trays, stacks unpinned.
 *
 * ⚠ Every field of a cell is carried through and only `color`/`hidden` overwritten. Rebuilding a
 * tile as `{kind, color, hidden}` — which is what `forge.mjs` does — silently drops `wide` and
 * `mate`, so every linked pair on the board would come back as two ordinary trays. Levels 15, 25
 * and 45 all carry pairs.
 *
 * ⚠ `columns` and `refTaps` are dropped on purpose: they are the pin, and leaving them makes
 * `toLevelDef` skip the search entirely, so every candidate would come back byte-identical.
 */
function variant(src, seed, colors, hidden, keepColors, addFrac) {
  const r = rng32(seed);
  const pick = () => (r() * colors) | 0;
  const { columns, refTaps, ...rest } = src;

  // Which empty floor cells could take a tray. Chosen before anything else is rolled so the same
  // seed fills the same cells whatever the colour sweep is doing.
  const free = [];
  src.cells.forEach((c, i) => {
    if (c.kind === "floor") free.push(i);
  });
  // Shuffle, then take the first n — scattering the new trays rather than filling a corner. A
  // corner fill is a different board shape; a scatter is the same board with more on it.
  for (let i = free.length - 1; i > 0; i--) {
    const j = (r() * (i + 1)) | 0;
    [free[i], free[j]] = [free[j], free[i]];
  }
  const add = new Set(free.slice(0, Math.round(free.length * addFrac)));

  return {
    ...rest,
    cells: src.cells.map((c, i) => {
      // ⚠ New trays get the same `hidden` roll as the old ones, so "add ? trays" and "add ordinary
      // trays" are one lever with a dial rather than two that have to be balanced against each
      // other. At hidden 0 they are all ordinary; at hidden 1 they are all face-down.
      if (c.kind === "floor" && add.has(i)) return { kind: "tile", color: pick(), hidden: r() < hidden };
      if (c.kind === "tile") {
        const out = { ...c, hidden: r() < hidden };
        if (!keepColors) {
          out.color = pick();
          if (c.wide) out.mate = pick();
        }
        return out;
      }
      if (c.kind === "hatch") {
        const queue = (c.queue ?? []).map((q) => (keepColors ? q : pick()));
        return { ...c, queue, hiddenQ: queue.map(() => r() < hidden) };
      }
      if (c.kind === "choc") {
        // ⚠ `border` is the ribbon: a colour means "counts only trays of that colour", null means
        // the rainbow ribbon that counts any. A single-colour box holds four trays of its own
        // colour — a design convention, but the piece is unreadable without it, so the four move
        // together with the ribbon or not at all.
        const one = c.border !== null && c.border !== undefined;
        const col = keepColors ? c.border : pick();
        return {
          ...c,
          border: one ? col : c.border,
          under: (c.under ?? []).map((u) => ({
            color: keepColors ? u.color : one ? col : pick(),
            hidden: r() < hidden,
          })),
        };
      }
      return { ...c };
    }),
  };
}

const score = (def, n) => {
  const b = best(M, def, n);
  const d = rate(M, def, "greedy", n, D_SLIP);
  return { B: b, D: d, BD: (b + d) / 2 };
};

const p = (x) => String(Math.round(x * 100)).padStart(3) + "%";

console.log(
  TARGET !== null
    ? `Dung lai ${LEVELS.length} level, nham thang vao ${Math.round(TARGET * 100)}% (do goc o ${BASE_N} van de bao cao).`
    : `Do lai ${LEVELS.length} level o ${BASE_N} van, roi dung lai o ${Math.round(FACTOR * 100)}% con so do.`,
);
console.log(`${TRIES} bien the/level · sang loc ${SCREEN} van · xac nhan ${CONFIRM} van (nhieu ±${noiseAt(CONFIRM)} diem).`);
console.log("");

const out = {};
const report = [];
for (const level of LEVELS) {
  const src = HANDMADE[level];
  if (!src) {
    console.log(`L${level}: khong co trong HANDMADE — bo qua.`);
    continue;
  }
  // Baseline on the board the player is served today.
  const before = score(levelDefFor(level), BASE_N);
  const cxBefore = cuongxs1Rate(M, levelDefFor(level), BASE_N).rate;
  const T = TARGET !== null ? TARGET : before.BD * FACTOR;

  let win = null;
  for (let t = 0; t < TRIES; t++) {
    // Candidate 0 keeps the drawing's own colours and only re-derives the stacks — the cheapest
    // possible change, and sometimes enough. After that, sweep the two levers.
    const keep = t === 0;
    const colors = Math.min(PALETTE.length, 5 + (t % 4));
    const hidden = 0.1 + (t % 5) * 0.14;
    // ⚠ Walked, not rolled. Tray count is the strongest lever on the board, so it gets the outer
    // sweep and the colour/face-down dials vary underneath it — rolling all three together hides
    // which one landed the target and makes the result impossible to reason about afterwards.
    const addFrac = keep ? 0 : Math.min(FILL_MAX, ((t / 6) | 0) * 0.1);
    const bp = variant(src, level * 7919 + t * 104729 + 17, colors, hidden, keep, addFrac);
    let def;
    try {
      def = toLevelDef(bp, level, T);
    } catch {
      continue;
    }
    // ⚠ Winnable first, or every number below is about a board nobody can clear.
    if (!def.refTaps?.length || !playPerfect(M, def).win) continue;

    const q = score(def, SCREEN);
    // ⚠ Scaled to the target. A flat ±0.22 window is most of the range when aiming at 10%, so the
    // cheap stage stops rejecting anything and every candidate pays for a full confirm run.
    if (Math.abs(q.BD - T) > Math.max(0.12, Math.min(0.22, T * 0.9))) continue;
    const s = score(def, CONFIRM);
    if (s.B < FLOOR) continue;
    // Land the mean, and refuse a mean that is the average of two different levels.
    const cost = Math.abs(s.BD - T) + 0.5 * Math.max(0, Math.abs(s.B - s.D) - GAP_OK);
    if (!win || cost < win.cost) win = { bp, def, s, cost, colors, hidden, keep, addFrac, trays: def.tiles.filter(Boolean).length };
    if (cost < 0.02) break;
  }

  if (!win) {
    console.log(`L${level}: khong tim duoc bien the nao dat muc tieu ${p(T)}.`);
    continue;
  }

  // ⚠ Pin, then re-read through the game's own path and compare fingerprints. Without this the
  // block below is a board that was measured and a board that ships, and no guarantee they match.
  const pinned = { ...win.bp, columns: win.def.columns.map((c) => [...c]), refTaps: [...win.def.refTaps] };
  HANDMADE[level] = pinned;
  const served = levelDefFor(level);
  const same = levelFingerprint(served) === levelFingerprint(win.def);
  const after = same ? win.s : score(served, CONFIRM);
  const cxAfter = cuongxs1Rate(M, served, CONFIRM).rate;

  out[level] = pinned;
  report.push({ level, before, cxBefore, T, after, cxAfter, same, win });
  console.log(
    `L${level}: ${p(before.BD)} -> ${p(after.BD)}  (muc tieu ${p(T)}, lech ${(Math.round((after.BD - T) * 100) > 0 ? "+" : "") + Math.round((after.BD - T) * 100)})` +
      `  | B ${p(after.B)} D ${p(after.D)} Cuongxs1 ${p(cxBefore)}->${p(cxAfter)}` +
      `  | ${win.keep ? "giu mau cu" : win.colors + " mau"}, ${Math.round(win.hidden * 100)}% khay ?` +
      `, +${Math.round(win.addFrac * 100)}% san -> ${win.trays} khay tren luoi` +
      (same ? "" : "  ⚠ VAN TAY LECH SAU KHI GHIM"),
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

const bad = report.filter((r) => !r.same);
if (bad.length) {
  console.log("");
  console.log(`⚠ ${bad.length} level co van tay lech sau khi ghim — ban do va ban ship khong giong nhau. Dung dan.`);
  process.exit(1);
}
