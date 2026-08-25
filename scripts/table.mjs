// table — every level, every model, side by side.
//
// The one place to look before playing. It reports the board the player actually gets
// (`levelDefFor`, so hand-built levels are the hand-built ones) against the sheet's target.
//
//   node scripts/table.mjs        # levels 1..29
//   node scripts/table.mjs 45     # further out, onto the fallback curve
//   N=150 node scripts/table.mjs  # more games per point
//
// ⚠ None of these are calibrated winrates. They are bot scores, and the play log says a person
// sits well above them — 8 wins in 10 on levels the blend averaged 54%. Read the winrate section
// of CLAUDE.md before quoting any of it as a prediction about players.

import { writeFileSync } from "node:fs";
import { loadGame, rate, best, cuongxs1Rate, D_SLIP, noiseAt } from "./bots.mjs";

const M = await loadGame();
const { levelDefFor, isHandmade, targetWin, SHEET, WIN_TOL, Game, TRAY_N } = M;

/**
 * What the board is made of, as the player meets it.
 *
 * ⚠ Two different views, and mixing them misreports two columns. **Structure** — pairs, boxes,
 * crates, hatches — is read off the `LevelDef`, because that is what was built. **Face-down
 * trays** are read off a *settled* `Game`, because a "?" beside a gap is face-up before the first
 * frame and counting the drawing's would claim face-down trays the player never sees.
 */
function makeup(def) {
  const g = new Game(def);
  let trays = 0;
  let pairs = 0;
  for (const t of def.tiles) {
    if (!t) continue;
    trays += t.wide ? 2 : 1;
    if (t.wide) pairs++;
  }
  for (const d of def.disp) if (d) trays += d.queue.length;
  for (const l of def.lids) trays += l.tiles.length;
  return {
    size: `${def.cols}x${def.rows}`,
    trays,
    marbles: trays * TRAY_N,
    colors: def.colors.length,
    pairs,
    chocs: def.lids.length,
    crates: def.blocked.filter(Boolean).length,
    hatches: def.disp.filter(Boolean).length,
    hidden: g.tiles.filter((t) => t && t.hidden).length,
    hiddenBox: def.boxHidden.flat().filter(Boolean).length,
    shape: def.shape ?? "",
  };
}

const UPTO = Number(process.argv[2] || SHEET.length);
const N = Number(process.env.N || 60);

console.log(`${N} van/diem — nhieu khoang ±${noiseAt(N)} diem, nen chenh duoi ~${noiseAt(N) * 2} la khong co nghia.`);
console.log("");
console.log("lv | target |   B  |   D  | (B+D)/2 | Cuongxs1 | nguon  | lech (B+D)/2");
console.log("---|--------|------|------|---------|----------|--------|-------------");

const sums = { b: 0, d: 0, bd: 0, cx: 0 };
let n = 0;
const csv = [];
const pct = (x) => Math.round(x * 100);
for (let lv = 1; lv <= UPTO; lv++) {
  const def = levelDefFor(lv);
  const want = targetWin(lv);
  const b = best(M, def, N);
  const d = rate(M, def, "greedy", N, D_SLIP);
  const bd = (b + d) / 2;
  const cx = cuongxs1Rate(M, def, N).rate;

  sums.b += b;
  sums.d += d;
  sums.bd += bd;
  sums.cx += cx;
  n++;
  const mk = makeup(def);
  csv.push([
    lv,
    isHandmade(lv) ? "vẽ tay" : "máy sinh",
    mk.size,
    mk.trays,
    mk.marbles,
    mk.colors,
    mk.pairs,
    mk.chocs,
    mk.crates,
    mk.hatches,
    mk.hidden,
    mk.hiddenBox,
    pct(want),
    pct(b),
    pct(d),
    pct(bd),
    pct(cx),
    pct(bd) - pct(want),
    Math.abs(bd - want) > WIN_TOL ? "lệch" : "",
  ]);

  const off = Math.round((bd - want) * 100);
  const p = (x) => String(Math.round(x * 100)).padStart(3) + "%";
  console.log(
    `L${String(lv).padEnd(2)}|  ${p(want)} | ${p(b)} | ${p(d)} |  ${p(bd)}  |   ${p(cx)}   |` +
      `${isHandmade(lv) ? " ve tay |" : "        |"}` +
      ` ${(off > 0 ? "+" : "") + off}`.padStart(6) +
      (Math.abs(bd - want) > WIN_TOL ? "  ⚠" : ""),
  );
}

const avg = (x) => String(Math.round((x / n) * 100)).padStart(3) + "%";
console.log("");
console.log(`Trung binh ${n} level:  B ${avg(sums.b)}   D ${avg(sums.d)}   (B+D)/2 ${avg(sums.bd)}   Cuongxs1 ${avg(sums.cx)}`);
console.log("");
console.log("B        = loi choi tot nhat trong 4 bot (2 cach cham diem x bam-ngay/biet-nhin)");
console.log(`D        = bam-ngay nhung dang tri ${Math.round(D_SLIP * 100)}% so nuoc`);
console.log("(B+D)/2  = thuoc ma cot target duoc dinh nghia tren do");
console.log("Cuongxs1 = biet moi thong tin an, lay mau theo trong so thay vi luon chon nuoc tot nhat");

// ── CSV ──────────────────────────────────────────────────────────────────────
//
//   node scripts/table.mjs 45 --csv winrate.csv
//
// ⚠ Two things make this open cleanly in Excel and neither is optional on a Vietnamese Windows.
// A **BOM**, or the accented headers arrive as mojibake; and a leading **`sep=,`** line, because
// Excel splits on the *locale's* list separator — which is `;` here — so a comma-separated file
// otherwise lands with all 45 levels crammed into column A. `sep=,` overrides that per file.
//
// ⚠ Percentages are written as plain integers, not as 0.xx or with a `%`. Excel reads a bare
// `85%` as text in some locales and `0.85` displays as 0.85 until someone formats the column;
// an integer is a number everywhere and needs no formatting to be sortable and chartable.
const csvArg = process.argv.indexOf("--csv");
if (csvArg > 0 && process.argv[csvArg + 1]) {
  const dest = process.argv[csvArg + 1];
  const head = [
    "level", "nguon", "co bàn", "so khay", "so bi", "so mau",
    "khay doi", "socola", "thung go", "cua xa", "khay ?", "hop bi an",
    "dich", "B", "D", "(B+D)/2", "Cuongxs1", "lech", "canh bao",
  ];
  const cell = (v) => {
    const s = String(v ?? "");
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [
    "sep=,",
    head.join(","),
    ...csv.map((r) => r.map(cell).join(",")),
    "",
    // ⚠ Padded to the header's width. A short row makes Excel offset every cell after it, so the
    // averages land under the wrong columns and read as board counts.
    ["trung binh", "", "", "", "", "", "", "", "", "", "", "", "",
      pct(sums.b / n), pct(sums.d / n), pct(sums.bd / n), pct(sums.cx / n), "", ""].join(","),
    "",
    [`${N} van/diem, nhieu ~±${noiseAt(N)} diem`].join(","),
    ["⚠ Day la diem cua BOT, khong phai winrate nguoi choi."].map(cell).join(","),
  ];
  writeFileSync(dest, "﻿" + lines.join("\r\n"), "utf8");
  console.log("");
  console.log(`Da ghi ${csv.length} level vao ${dest}`);
}
