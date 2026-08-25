// A second, narrower shuffle on 40% of the rebuilt levels: boxes 12 to 30 only.
import fs from "node:fs";
import { M, rngOf, shuffled } from "./remap.mjs";
import { samePool } from "./rebuild.mjs";

const rebuilt = [];
for (const l of fs.readFileSync("scripts/.tmp/remap-block.txt", "utf8").replace(/\n+$/, "").split("\n"))
  rebuilt.push(Number(l.match(/^  (\d+):/)[1]));

// ⚠ Seeded, so the pick is reproducible and can be re-run to the same 58 levels.
const pick = shuffled(rngOf(20260821), rebuilt).slice(0, Math.round(rebuilt.length * 0.4)).sort((a, b) => a - b);
console.log(`${rebuilt.length} level da dung lai -> chon ${pick.length} (40%).`);

/** The well read row by row from the top — the order the range is counted in. */
function wellSlots(cols) {
  const deepest = Math.max(0, ...cols.map((c) => c.length));
  const out = [];
  for (let d = 0; d < deepest; d++)
    for (let j = 0; j < cols.length; j++) if (d < cols[j].length) out.push({ col: j, idx: d });
  return out;
}

/**
 * Shuffle boxes 12 to 30, counted from the top of the well.
 *
 * ⚠ 1-based and inclusive, matching the editor's own button: position 12 is slot index 11. Only
 * this stretch moves; everything above and below stays exactly where the first pass left it.
 */
function shuffle1230(cols, rnd) {
  const out = cols.map((c) => [...c]);
  const slots = wellSlots(out);
  const lo = 11, hi = Math.min(slots.length, 30);
  if (hi - lo < 2) return out;
  const ix = Array.from({ length: hi - lo }, (_, i) => lo + i);
  const cs = shuffled(rnd, ix.map((k) => out[slots[k].col][slots[k].idx]));
  ix.forEach((k, n) => { out[slots[k].col][slots[k].idx] = cs[n]; });
  return out;
}

const lines = [];
const failed = [];
let moved = 0;
for (const lv of pick) {
  const bp = M.HANDMADE[lv];
  let done = null;
  for (let s = 0; s < 24 && !done; s++) {
    const cols = shuffle1230(bp.columns, rngOf(lv * 7919 + s * 104729 + 1));
    if (!samePool(bp.columns, cols)) throw new Error(`L${lv}: tron lam hong cung/cau`);
    if (JSON.stringify(cols) === JSON.stringify(bp.columns)) continue;   // a no-op roll
    const line = M.lineFor({ ...bp, columns: cols }, cols, 5000 + s * 23);
    if (!line.length) continue;
    const full = { ...bp, columns: cols, refTaps: line };
    // The same gate as the rebuild: the game's own path, not the finder that fed it.
    if (!M.toLevelDef(full, lv, M.targetWin(lv)).refTaps?.length) continue;
    done = full;
  }
  if (!done) { failed.push(lv); continue; }
  moved++;
  lines.push(`  ${lv}: ${JSON.stringify(done)},`);
}
fs.writeFileSync("scripts/.tmp/shuffle1230-block.txt", lines.join("\n") + "\n");
console.log(`Tron duoc ${moved}/${pick.length}. Khong tron duoc (giu nguyen): ${failed.length ? failed.join(",") : "khong co"}`);
console.log(`Da ghi scripts/.tmp/shuffle1230-block.txt`);
