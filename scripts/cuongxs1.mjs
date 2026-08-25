// Cuongxs1 — the all-seeing sampling model, named by the person who specified it.
//
// One perfect game to show a winning line exists, then N games where every genuine choice is
// **sampled** from a weight rather than taken by argmax. It is a model of a player who can see
// everything and still has to decide, which is a different failure from the careless player the
// `slip` family models.
//
//   node scripts/cuongxs1.mjs            # every sheet level, 50 sampled games each
//   node scripts/cuongxs1.mjs 20         # one level, plus the first few decision points
//   node scripts/cuongxs1.mjs 20 --log   # every decision point of one sampled game
//   N=200 node scripts/cuongxs1.mjs      # more games per level
//
// ⚠ These are NOT calibrated winrates and must not be quoted as such. Nothing here has been
// scored against real games, and the ladder is tuned on (B+D)/2 — see the winrate section of
// CLAUDE.md before treating any number below as a statement about people.

import { loadGame, playCuongxs1, playPerfect, cuongxs1Rate } from "./bots.mjs";

const M = await loadGame();
const { levelDefFor, isHandmade, SHEET, BELT_SLOTS } = M;

const arg = process.argv[2];
const wantLog = process.argv.includes("--log");
const N = Number(process.env.N || 50);

if (arg && !arg.startsWith("--")) {
  const lv = Number(arg);
  const def = levelDefFor(lv);

  const p = playPerfect(M, def, true);
  console.log(`Level ${lv} — van hoan hao: ${p.win ? "THANG" : "THUA"}, ${p.taps} nuoc, dinh bang ${p.peak}/${BELT_SLOTS}`);
  console.log("  thu tu bam: " + p.log.map((s) => `o${s.tap}`).join(" "));
  console.log("");

  const s = playCuongxs1(M, def, 12345, true);
  console.log(`Mot van lay mau: ${s.win ? "THANG" : "THUA"}, ${s.taps} nuoc, dinh bang ${s.peak}/${BELT_SLOTS}`);
  console.log("");
  const steps = wantLog ? s.log : s.log.slice(0, 4);
  console.log(wantLog ? "Moi diem can nhac:" : `${steps.length} diem can nhac dau tien (them --log de xem het):`);
  const why = { 0: "theo box hang 1", 1: "hang 1 rong -> theo hang 2", "-1": "ca 2 hang rong -> boc deu" };
  for (const step of steps) {
    console.log(
      `  nhip ${step.tick}, bang ${step.belt}/${BELT_SLOTS} [${why[step.row]}] -> chon o${step.tap} (mau ${step.color})`,
    );
    for (const c of step.choices) {
      console.log(
        `      o${String(c.tray).padStart(2)}  mau ${c.color}  trong so ${String(c.weight).padStart(7)}` +
          `  xac suat ${(c.p * 100).toFixed(1).padStart(5)}%`,
      );
    }
  }
  console.log("");
  const r = cuongxs1Rate(M, def, N);
  console.log(`${N} van lay mau: thang ${Math.round(r.rate * 100)}%`);
} else {
  console.log(`Method Cuongxs1, ${N} van lay mau moi level. KHONG phai winrate da hieu chinh.`);
  console.log("");
  console.log("lv | van hoan hao | Cuongxs1 | nguon  | muc tieu sheet");
  const t0 = Date.now();
  let bad = 0;
  for (let lv = 1; lv <= SHEET.length; lv++) {
    const r = cuongxs1Rate(M, levelDefFor(lv), N);
    if (!r.perfect) bad++;
    console.log(
      `L${String(lv).padEnd(2)}|    ${r.perfect ? "thang" : "⚠ THUA"}     |   ${String(Math.round(r.rate * 100)).padStart(3)}%   |` +
        `${isHandmade(lv) ? " ve tay |" : "        |"}      ${String(Math.round(M.targetWin(lv) * 100)).padStart(3)}%`,
    );
  }
  console.log("");
  console.log(`${((Date.now() - t0) / 1000).toFixed(0)}s.` + (bad ? `  ⚠ ${bad} level co duong thang khong chay duoc.` : ""));
}
