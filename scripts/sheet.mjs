// sheet — check every shipped level against Manythings/winrate Marble sort - Sheet1.csv.
//
// The tuner searches for a winrate; this checks the *ingredients*. They are separate failures:
// a level can land 80% while quietly carrying 3 colours where the sheet asked for 7, because
// `applySheet` raises floors and nothing until now read the built board back.
//
// It also checks the hatch-direction rule, which no other tool covers: hatches face down only
// up to SIDEWAYS_FROM, and may turn left or right after it.
//
//   node scripts/sheet.mjs        # every sheet level
//   node scripts/sheet.mjs 12     # just level 12

import { loadGame, bd } from "./bots.mjs";

const M = await loadGame();
const { levelDefFor, isHandmade, SHEET, SIDEWAYS_FROM, WIN_TOL, targetWin, Game } = M;

const only = process.argv[2] ? Number(process.argv[2]) : 0;
const N = Number(process.env.N || 40);
const MEASURE = process.env.NOWIN !== "1";

console.log(`Doi chieu ${only ? "level " + only : SHEET.length + " level"} voi sheet.`);
console.log("");
console.log("lv | khay | mau | khay? | cua xa | thung | huong     | nguon  | (B+D)/2 vs muc tieu");

let bad = 0;
for (let level = 1; level <= SHEET.length; level++) {
  if (only && level !== only) continue;
  const s = SHEET[level - 1];
  const def = levelDefFor(level);

  // Read the board the way the player meets it: settled, so a hatch has already pushed and a
  // `?` beside a gap is already face-up. Counting the raw def overstates the face-down trays.
  const g = new Game(def);
  const hatches = def.disp.filter((d) => d).length;
  // ⚠ Trays come from the *def*, before settling. Counting the settled grid and then adding the
  // def's hatch queues double-counts every tray a hatch has already pushed out — it reported a
  // level-2 board of 13 trays as 15, and made its box derivation look 6 boxes short when it was
  // exact.
  // ⚠ Count the trays still inside the hatches. `structure` spends the tray budget on the grid
  // *and* the hatch queues (`target = tiles - dispensers * DISPENSER_HOLD`), so reading the grid
  // alone reports a level-25 board as 5 trays against a floor of 14 and invents a failure.
  const heldColors = def.disp.flatMap((d) => (d ? d.queue : []));
  const trays = def.tiles.filter(Boolean).length + heldColors.length;
  const colors = new Set([...def.tiles.filter(Boolean).map((t) => t.color), ...heldColors]).size;
  // Face-down trays the player actually meets: the ones still `?` after the board settles, plus
  // the ones waiting inside a hatch, which come out `?`. Counting the raw def instead counts
  // tiles that flip face-up before the first frame.
  const heldHidden = def.disp.reduce((k, d) => k + (d ? d.hiddenQ.filter(Boolean).length : 0), 0);
  const hidden = g.tiles.filter((t) => t && t.hidden).length + heldHidden;
  // ⚠ The field is `blocked`, not `crate`. Reading a name the def does not have is silently 0,
  // and 0 against every floor reads as the generator ignoring the sheet entirely — it did not.
  const crates = (def.blocked ?? []).filter(Boolean).length;
  const dirs = def.disp.filter(Boolean).map((d) => d.dir ?? "down");

  const fails = [];
  const need = (got, min, name) => { if (got < min) fails.push(`${name} ${got}<${min}`); };
  need(trays, s.trays, "khay");
  need(colors, s.colors, "mau");
  need(hidden, s.hidden, "khay?");
  need(hatches, s.hatches, "cuaxa");
  need(crates, s.crates, "thung");
  if (level <= SIDEWAYS_FROM && dirs.some((d) => d !== "down"))
    fails.push(`huong ${dirs.join("/")} truoc L${SIDEWAYS_FROM}`);

  let winCol = "-";
  if (MEASURE) {
    const r = bd(M, def, N);
    const want = targetWin(level);
    const off = Math.abs(r.raw - want);
    if (off > WIN_TOL) fails.push(`winrate ${Math.round(r.raw * 100)}% vs ${Math.round(want * 100)}%`);
    winCol =
      `${String(Math.round(r.raw * 100)).padStart(3)}% vs ${String(Math.round(want * 100)).padStart(3)}%` +
      ` (B ${Math.round(r.b * 100)} / D ${Math.round(r.d * 100)})`;
  }

  const p = (a, b) => `${String(a).padStart(2)}/${b}`;
  console.log(
    `L${String(level).padEnd(2)}| ${p(trays, s.trays)} | ${p(colors, s.colors)} | ` +
      ` ${p(hidden, s.hidden)} |  ${p(hatches, s.hatches)}  | ${p(crates, s.crates)} | ` +
      `${(dirs.join(",") || "-").padEnd(11)}|${isHandmade(level) ? " ve tay |" : "        |"} ${winCol}` +
      (fails.length ? `  ⚠ ${fails.join(", ")}` : ""),
  );
  if (fails.length) bad++;
}

console.log("");
console.log(bad ? `⚠ ${bad} level chua dat.` : "Tat ca level dat sheet.");
process.exit(bad ? 1 : 0);
