import fs from "node:fs";
import { M, MAPS } from "./remap.mjs";
import { attempt } from "./rebuild.mjs";

const all = Object.keys(M.HANDMADE).map(Number).sort((a, b) => a - b);
// Feature debuts, read off the drawings — not a written-down table, which the ladder would outrun.
const firstOf = {};
for (const n of all) {
  const cs = M.HANDMADE[n].cells ?? [];
  const has = { hatch: cs.some((c) => c.kind === "hatch"), crate: cs.some((c) => c.kind === "crate"),
    pair: cs.some((c) => c.kind === "tile" && c.wide), lid: cs.some((c) => c.kind === "choc"),
    arrow: cs.some((c) => c.kind === "tile" && c.arrow), hidden: cs.some((c) => c.kind === "tile" && c.hidden) };
  for (const [k, v] of Object.entries(has)) if (v && firstOf[k] == null) firstOf[k] = n;
}
const debut = new Set(Object.values(firstOf));
const targets = all.filter((n) => n >= 22 && n % 5 !== 0 && !debut.has(n));
console.log(`Giu nguyen: chia het 5, va cac moc feature ${[...debut].filter((n) => n >= 22).join(",")}`);
console.log(`Dung lai ${targets.length} level.\n`);

const out = [];
const fails = [];
const usedMap = new Map();
let dropped = 0;
for (const lv of targets) {
  let done = null, spare = null;
  // ⚠ Maps are drawn from a deck walked per level, so one seed cannot keep handing back the
  // same unlucky silhouette. A run that had to give a piece up is kept only as a fallback:
  // "drop it if the map is too small" is the last resort, not the first fit.
  for (let t = 0; t < 60 && !done; t++) {
    const r = attempt(lv, (lv * 7 + t * 13) % MAPS.length, lv * 1000 + t);
    if (!r.ok) continue;
    const d = r.plan.dropped;
    if (!d.choc && !d.hatch && !d.pairs) done = r;
    else if (!spare) spare = r;
  }
  done = done ?? spare;
  if (!done) { fails.push(lv); continue; }
  const old = M.HANDMADE[lv];
  const bp = { ...done.bp };
  if (old.hard != null) bp.hard = old.hard;
  if (old.boxAvoidTop) bp.boxAvoidTop = old.boxAvoidTop;
  const d = done.plan.dropped;
  if (d.choc || d.hatch || d.pairs) dropped++;
  usedMap.set(done.map, (usedMap.get(done.map) ?? 0) + 1);
  out.push({ lv, bp, map: done.map, trays: done.plan.trays.length, cols: done.paints.colours.size, hid: done.paints.hidden, arr: done.paints.arrows, d });
}

const lines = out.map((o) => `  ${o.lv}: ${JSON.stringify(o.bp)},`);
fs.mkdirSync("scripts/.tmp", { recursive: true });
fs.writeFileSync("scripts/.tmp/remap-block.txt", lines.join("\n") + "\n");
console.log(`Dung duoc ${out.length}/${targets.length}. That bai: ${fails.length ? fails.join(",") : "khong co"}`);
console.log(`Co level phai bo bot mieng: ${dropped}`);
console.log(`Map da dung: ${usedMap.size}/${MAPS.length} loai`);
console.log(`\nDa ghi scripts/.tmp/remap-block.txt (${(fs.statSync("scripts/.tmp/remap-block.txt").size / 1024).toFixed(0)} KB)`);
fs.writeFileSync("scripts/.tmp/remap-report.txt", out.map((o) =>
  `L${String(o.lv).padEnd(3)} ${o.map.padEnd(18)} ${String(o.trays).padStart(2)} khay  ${o.cols} mau  ?${String(o.hid).padStart(2)}  mui ten ${o.arr}` +
  (o.d.choc || o.d.hatch || o.d.pairs ? `  BO: ${JSON.stringify(o.d)}` : "")).join("\n") + "\n");
