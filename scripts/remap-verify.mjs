// Independent check of the block: parse it back, run it through the real engine, prove every claim.
import fs from "node:fs";
import { loadGame, playPerfect } from "./bots.mjs";
const M = await loadGame();
const txt = fs.readFileSync("scripts/.tmp/remap-block.txt", "utf8").trim().split("\n");
const built = new Map();
for (const line of txt) {
  const m = line.match(/^\s*(\d+):\s*(\{.*\}),\s*$/);
  if (!m) throw new Error("dong khong doc duoc: " + line.slice(0, 60));
  built.set(Number(m[1]), JSON.parse(m[2]));
}
console.log(`Doc lai ${built.size} level tu file khoi.\n`);

const inv = (bp) => {
  const v = { hatch: 0, choc: 0, under: 0, arrows: 0, hidden: 0, pairs: 0, crates: 0, trays: 0, cols: new Set() };
  for (const c of bp.cells ?? []) {
    if (c.kind === "hatch") { v.hatch++; v.trays += c.queue.length; c.queue.forEach((x) => v.cols.add(x)); }
    else if (c.kind === "crate") v.crates++;
    else if (c.kind === "choc") { v.choc++; v.under += (c.under ?? []).length; v.trays += (c.under ?? []).length; (c.under ?? []).forEach((t) => v.cols.add(t.color)); }
    else if (c.kind === "tile") { v.trays += c.wide ? 2 : 1; if (c.wide) v.pairs++; if (c.arrow) v.arrows++; if (c.hidden) v.hidden += c.wide ? 2 : 1; v.cols.add(c.color); if (c.wide) v.cols.add(c.mate ?? c.color); }
  }
  return v;
};

let bad = [];
const note = (lv, why) => bad.push(`L${lv}: ${why}`);
for (const [lv, bp] of built) {
  const o = inv(M.HANDMADE[lv]), n = inv(bp);
  // 1. pieces kept
  for (const k of ["hatch", "choc", "under", "arrows", "hidden", "pairs", "crates"])
    if (k === "hidden") { const want = Math.ceil(o.hidden * 1.2); if (n.hidden < want) note(lv, `khay ?: ${o.hidden} -> ${n.hidden}, can >= ${want}`); }
    else if (n[k] !== o[k]) note(lv, `${k}: cu ${o[k]} -> moi ${n[k]}`);
  // 2. colours
  const want = lv > 40 ? 8 : 6;
  if (n.cols.size < want) note(lv, `chi ${n.cols.size} mau, can >= ${want}`);
  // 3. supply == demand, per colour
  const def = M.toLevelDef(bp, lv, M.targetWin(lv));
  const need = new Map(), have = new Map();
  for (const c of def.columns) for (const v of c) need.set(v, (need.get(v) ?? 0) + M.BOX_SLOTS);
  const add = (col, k) => have.set(col, (have.get(col) ?? 0) + k);
  for (const t of def.tiles) { if (!t) continue; add(t.color, M.TRAY_N); if (t.wide) add(t.mate ?? t.color, M.TRAY_N); }
  for (const d of def.disp ?? []) if (d) for (const c of d.queue) add(c, M.TRAY_N);
  for (const l of def.lids ?? []) for (const t of l.tiles) add(t.color, M.TRAY_N);
  // A box that hides no trays is a box the arithmetic cannot see: check the shape, not just the sum.
  for (const c of bp.cells) if (c.kind === "choc" && (c.under ?? []).length !== 4) note(lv, `socola giau ${(c.under ?? []).length} khay, phai la 4`);
  for (const [c, v] of have) if ((need.get(c) ?? 0) !== v) note(lv, `mau ${c}: bi ${v} vs lo ${need.get(c) ?? 0}`);
  // 4. actually winnable, replayed through the real engine
  if (!def.refTaps?.length) note(lv, "khong co refTaps sau toLevelDef");
  else if (!playPerfect(M, def).win) note(lv, "refTaps KHONG thang");
  // 5. inside 7x7
  if (bp.cols > 7 || bp.rows > 7) note(lv, `${bp.cols}x${bp.rows} vuot 7x7`);
  // A rainbow counter has to be reachable from the trays outside the box, or the level cannot end.
  for (const c of bp.cells) if (c.kind === "choc" && (c.border ?? null) === null) {
    if (c.need < 6 || c.need > 8) note(lv, `socola cau vong dem ${c.need}, phai 6-8`);
    if (c.need > n.trays - 4) note(lv, `socola dem ${c.need} > ${n.trays - 4} khay ngoai hop`);
  }
}
// 6. nothing outside the target set was touched
const all = Object.keys(M.HANDMADE).map(Number);
for (const lv of built.keys()) if (lv < 22 || lv % 5 === 0) note(lv, "KHONG DUOC SUA level nay");
console.log(bad.length ? `LOI (${bad.length}):\n  ` + bad.slice(0, 25).join("\n  ") : "Tat ca dat: mieng giu nguyen, du mau, cung=cau, refTaps thang, trong 7x7 ✓");
