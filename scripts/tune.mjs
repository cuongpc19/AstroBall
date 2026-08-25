// tune — find the difficulty scalar for each level that lands on the target curve.
//
// The ladder in level.ts used to be hand-written: "colours go up every 3 levels, trays every
// 2". That produces whatever it produces — measured against the target it was flat at ~97% for
// fifteen levels and then fell 23 points in one step. This searches instead.
//
// For each level it scans `d` (0 = gentlest, 1 = everything on), builds the board that `d`
// implies, scores it, and keeps the board closest to `targetWin(level)`. The output is the
// LADDER and VARIANTS arrays to paste back into level.ts.
//
// ⚠ The score is (B + D)/2 — a BOT number. Landing the curve means the bots see the intended
// shape; it is not a promise about people. See the winrate section of CLAUDE.md.
//
// ⚠ The ingredients are NOT `paramsFromD` alone. `applySheet` raises the floors the level sheet
// asks for (trays, colours, face-down trays, hatches, crates, hatch directions), so the tuner
// has to search the same board the game will build — otherwise it tunes a board nobody plays.
//
//   node scripts/tune.mjs           # levels 1..29 (the sheet)
//   node scripts/tune.mjs 45        # past the sheet, onto the fallback curve
//   node scripts/tune.mjs 25-29     # just that stretch — same numbers, less waiting
//   N=60 node scripts/tune.mjs      # more games per point (slower, less noise)
//
// ⚠ Keep VARIANTS the same as the run that produced the rest of the table. A level retuned at 28
// boards and one retuned at 64 are both *valid* — they land the same target — but they pick
// different boards, so mixing them makes the table a record of two different searches.

import { writeFileSync } from "node:fs";
import { loadGame, bd } from "./bots.mjs";

const M = await loadGame();
const { makeLevelWith, paramsFromD, applySheet, targetWin, WIN_TOL, SHEET } = M;

// `29` means 1..29; `25-29` means just that stretch. Each level is searched independently and
// the search is deterministic, so retuning a range gives byte-identical results to retuning
// everything — the range only saves the time. Rows outside it are left alone, so paste the
// printed slice over the matching entries rather than replacing the whole array.
const RANGE = String(process.argv[2] || SHEET.length);
const FROM = RANGE.includes("-") ? Number(RANGE.split("-")[0]) : 1;
const UPTO = Number(RANGE.split("-").pop());
/** Games per measurement. 40 carries about ±3 points; the search does not need better. */
const N = Number(process.env.N || 40);
/** How close counts as landed. The sheet says ±10 points, so that is the default. */
const TOL = Number(process.env.TOL || WIN_TOL);
/** Boards screened per difficulty step. The spread at d = 1 runs 13%-73%, so this needs to be
 *  generous or the target simply is not in the sample. */
const VARIANTS = Number(process.env.VARIANTS || 28);
/** Screening games — cheap and noisy on purpose. */
const SCREEN_N = Number(process.env.SCREEN_N || 16);
/** How many survivors get re-measured properly. */
const FINALISTS = 4;

/**
 * How far B and D may drift apart before the mean stops meaning anything.
 *
 * Asked for directly: "ưu tiên 2 phép đo không quá cách xa kết quả nhau". A level that reads
 * 50% because best play wins 90% and slip-0.25 wins 10% is not a 50% level — it is two
 * different levels depending on who is holding it, and `npm run levels` already flags the
 * gap. So the search cost is the distance from target *plus* whatever the gap exceeds this.
 */
// ⚠ 0.20, not 0.35, and the difference is not cosmetic. At 0.35 the shipped table had four sheet
// levels sitting 25-33 points apart — level 20 read 36% as the mean of best play on 20% and
// careless play on 53%, i.e. the careless bot beating the thinking one by a third of the range.
// Retuning at 0.20 pulled those four to 15, 3, 5 and 3 and cost at most 3 points of accuracy on
// the target. Tightening it further starts trading real accuracy away.
const GAP_OK = Number(process.env.GAP_OK || 0.2);
const GAP_W = Number(process.env.GAP_W || 0.5);

const costOf = (s, want) =>
  Math.abs(s.raw - want) + GAP_W * Math.max(0, s.gap - GAP_OK);

// Building a board is far more expensive than playing one (playableRate runs inside
// makeLevelWith), and the screen/confirm split asks for the same board twice. Cache it.
const built = new Map();
function boardFor(level, d, variant) {
  const key = `${level}|${d}|${variant}`;
  let def = built.get(key);
  if (!def) {
    def = makeLevelWith(level, applySheet(paramsFromD(d, level), level), variant);
    built.set(key, def);
  }
  return def;
}

function score(level, d, variant, n) {
  return bd(M, boardFor(level, d, variant), n);
}

console.log(`Tune level ${FROM}..${UPTO} theo Manythings/winrate Marble sort - Sheet1.csv`);
console.log(`${N} van/diem, dung sai ${Math.round(TOL * 100)}%, phat khi |B-D| > ${Math.round(GAP_OK * 100)}%`);
console.log("");
console.log("lv | muc tieu |   d   | bd |    B |    D | (B+D)/2 | lech | |B-D|");

const ladder = [];
const variants = [];
const rows = [];
const t0 = Date.now();

// Search BOTH axes, because neither alone can land the curve.
//
// A fixed `d` scored anywhere from 30% to 86% across levels — board luck swamps the knob, so
// the knob alone cannot hit a target. But the knob alone is also what decides whether a target
// is reachable at all: at d = 0.08 the board is three colours and six trays, and no board made
// of those ingredients scores below 100%, however many are tried.
//
// ⚠ The walk is NOT monotone any more. It used to start each level at the previous level's `d`
// so the ladder could only climb, which was right for a curve that only fell. The sheet does
// not: it spikes to 40% at level 20 and returns to 80% at 21, on purpose. Carrying the spike's
// `d` forward would make every level after a spike as hard as the spike.
for (let level = FROM; level <= UPTO; level++) {
  const want = targetWin(level);
  let found = null;

  for (let dRaw = 0; dRaw <= 1.0001; dRaw += 0.05) {
    const d = Math.min(1, Number(dRaw.toFixed(3)));

    // Stage 1 — screen cheaply.
    const screened = [];
    for (let v = 0; v < VARIANTS; v++) {
      const s = score(level, d, v, SCREEN_N);
      screened.push({ v, cost: costOf(s, want), raw: s.raw });
    }
    screened.sort((a, b) => a.cost - b.cost);

    // Stage 2 — re-measure the survivors at full strength.
    //
    // ⚠ This stage is not optional. Taking the best of 40 noisy measurements systematically
    // picks boards whose *measured* score happened to land on target, not boards whose *true*
    // score is on target — the winner's curse. Screening at 16 games and confirming at N
    // separates the two, and the confirmed number is the one reported.
    // ⚠ Never spread the blend in here. `bd()` names its halves b and d, and `d` is also the
    // difficulty knob — a spread silently overwrites the knob with the D model's score, and
    // the LADDER comes out holding winrates. It did, and the table looked entirely plausible.
    let atD = null;
    for (const c of screened.slice(0, FINALISTS)) {
      const s = score(level, d, c.v, N);
      const cost = costOf(s, want);
      const cand = { knob: d, v: c.v, cost, err: Math.abs(s.raw - want),
                     b: s.b, slip: s.d, raw: s.raw, gap: s.gap };
      if (!atD || cost < atD.cost) atD = cand;
    }

    if (!found || atD.cost < found.cost) found = atD;
    if (atD.err <= TOL && atD.gap <= GAP_OK) break;
    // Every board at this d already undershoots — a harder d will only undershoot further.
    if (atD.raw < want - TOL) break;
  }

  built.clear();
  ladder.push(found.knob);
  variants.push(found.v);
  rows.push({ level, want, ...found });
  const pc = (x) => String(Math.round(x * 100)).padStart(3);
  console.log(
    `L${String(level).padEnd(2)}|    ${pc(want)}%  | ${found.knob.toFixed(3)} | ` +
      `${String(found.v).padStart(2)} | ${pc(found.b)}% | ${pc(found.slip)}% | ` +
      `   ${pc(found.raw)}%  | ${pc(found.err)}% | ${pc(found.gap)}%`,
  );
}

console.log("");
console.log(`Xong trong ${((Date.now() - t0) / 1000).toFixed(0)}s. Dan doan nay vao level.ts:`);
console.log("");
// Print each row on its own console.log — building the block with an escaped newline inside
// a string literal is one shell layer too many, and it has silently broken twice.
const emit = (name, arr, f) => {
  console.log(`${name} — dan de len entry ${FROM}..${UPTO}:`);
  for (let i = 0; i < arr.length; i += 10) {
    console.log("  " + arr.slice(i, i + 10).map(f).join(", ") + ",");
  }
  console.log("];");
};
emit("LADDER", ladder, (v) => v.toFixed(3));
console.log("");
emit("VARIANTS", variants, (v) => String(v));

const out = process.env.OUT;
if (out) writeFileSync(out, JSON.stringify({ ladder, variants, rows }, null, 1));
