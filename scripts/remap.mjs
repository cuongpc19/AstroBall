// Rebuild the silhouette of a hand-built level, keeping every piece it carries.
//
// ⚠ Writes to a block file, never to handmade.ts — see the note at the bottom.
import { loadGame } from "./bots.mjs";

/** The silhouettes, all inside GRID_MAX 7 and all sitting on the last row. */
export const MAPS = [
  ["hai cum roi",    ["###.###", "###.###", "###.###", "###.###", "###.###"]],
  ["rang cua",       [".##.###", "#######", "#######", "##.####", ".###.#."]],
  ["cay lech",       ["..##...", ".####..", "#####..", ".######", ".####.."]],
  ["bac thang rong", ["#......", "##.....", "###....", "#####..", "#######"]],
  ["khung co khe",   ["#######", "#.....#", "#.###.#", "#.....#", "##.####"]],
  ["chu T lech",     ["#######", "..###..", "..###..", ".####..", ".####.."]],
  ["cheo",           ["....###", "..####.", ".####..", "####...", "###...."]],
  ["long ho",        ["..###..", ".#####.", "##.x.##", ".#####.", "..###.."]],
  ["hai chan",       ["..###..", ".#####.", "#######", "#.###.#", "##...##"]],
  ["chu H",          ["##...##", "##...##", "#######", "##...##", "##...##"]],
  ["chu U",          ["##...##", "##...##", "##...##", "##...##", "#######"]],
  ["kim tu thap",    ["...#...", "..###..", ".#####.", "#######", "#######"]],
  ["dong ho cat",    ["#######", ".#####.", "..###..", ".#####.", "#######"]],
  ["vuong mien",     ["#.#.#.#", "#######", "#######", "#######", ".#####."]],
  ["ba cot",         ["#..#..#", "#..#..#", "#..#..#", "#######", "#######"]],
  ["zic zac",        ["####...", "..####.", "...####", ".####..", "####..."]],
  ["mui ten len",    ["...#...", "..###..", ".#####.", "###.###", "##...##"]],
  ["cau vom",        ["#######", "#######", "##...##", "##...##", "##...##"]],
  ["coi xay",        ["###..#.", "###..#.", "..###..", ".#..###", ".#..###"]],
  ["nhan day",       [".#####.", "##...##", "#..x..#", "##...##", ".#####."]],
  ["hai lo",         ["#######", "#.#.#.#", "#######", "#.#.#.#", "#######"]],
  ["bac thang doi",  ["...#...", "..###..", ".#####.", "#######", "#..#..#"]],
  ["luoi cua",       [".#.#.#.", "#######", "#######", "#.#.#.#", "#######"]],
  ["hoc tu",         ["###.###", "#.#.#.#", "###.###", "#.#.#.#", "###.###"]],
  // ⚠ Chep BANG MAT tu anh trong Manythings/map idea — bat duoc dang hinh, khong phai ban sao
  // tung o: anh chup nho, co watermark de len vien, va mot phan hang duoi la gieng hop chu khong
  // phai luoi khay.
  ["tk: vien khuyet",  [".#..#.", ".####.", "######", "######"]],
  ["tk: qua ta",       ["..##..", "######", "..##..", "..##..", "######"]],
  ["tk: vong rong",    ["######", "#....#", "#....#", "#....#", "######"]],
  ["tk: hai canh",     ["..###..", "#######", "##...##", "##...##", "#######"]],
  ["tk: T co than",    ["#####", "#####", "..#..", ".###.", "#####"]],
  ["tk: thap len",     ["..####.", ".######", "#######", "#######", "######."]],
  ["tk: bac phai",     ["##....", "#####.", "######", "#####.", "###..."]],
  ["tk: vuong khuyet", ["#####", "#####", "#####", "#####", "##.##"]],
];
for (const [n, r] of MAPS) {
  const C = Math.max(...r.map((x) => x.length));
  if (C > 7 || r.length > 7) throw new Error(`${n}: ${C}x${r.length} vuot 7x7`);
  if (!r.every((x) => x.length === C)) throw new Error(`${n}: hang khong deu`);
  if (!r[r.length - 1].includes("#")) throw new Error(`${n}: khong cham hang cuoi`);
}

export const rngOf = (seed) => () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

/** What a level carries, so the rebuild can put the same pieces back. */
export function inventory(bp) {
  const inv = { hatch: [], choc: [], arrows: 0, hidden: 0, pairs: 0, crates: 0, trays: 0, colours: new Set() };
  for (const c of bp.cells ?? []) {
    if (c.kind === "hatch") { inv.hatch.push({ queue: [...(c.queue ?? [])], hiddenQ: [...(c.hiddenQ ?? [])], dir: c.dir }); (c.queue ?? []).forEach((x) => inv.colours.add(x)); inv.trays += (c.queue ?? []).length; }
    else if (c.kind === "crate") inv.crates++;
    // ⚠ `under`, not `tiles`: the four trays live on the box cell, like a hatch's queue.
    else if (c.kind === "choc") { const u = (c.under ?? []).map((t) => ({ ...t })); inv.choc.push({ need: c.need, border: c.border ?? null, under: u }); inv.trays += u.length; u.forEach((t) => inv.colours.add(t.color)); }
    else if (c.kind === "tile") {
      inv.trays += c.wide ? 2 : 1;
      if (c.wide) inv.pairs++;
      if (c.arrow) inv.arrows++;
      if (c.hidden) inv.hidden += c.wide ? 2 : 1;
      inv.colours.add(c.color); if (c.wide) inv.colours.add(c.mate ?? c.color);
    }
  }
  return inv;
}

const M = await loadGame();
export { M };

if ((process.argv[1] ?? "").endsWith("remap.mjs")) {
  const lv = Number(process.argv[2] || 22);
  const bp = M.HANDMADE[lv];
  const inv = inventory(bp);
  console.log(`L${lv}: ${bp.cols}x${bp.rows}`);
  console.log(`  khay ${inv.trays}, mau ${inv.colours.size} [${[...inv.colours].sort((a,b)=>a-b).join(",")}]`);
  console.log(`  cua xa ${inv.hatch.length} ${JSON.stringify(inv.hatch)}`);
  console.log(`  socola ${inv.choc.length} ${JSON.stringify(inv.choc.map((c) => ({ need: c.need, border: c.border })))}`);
  console.log(`  mui ten ${inv.arrows}, khay ? ${inv.hidden}, khay doi ${inv.pairs}, thung go ${inv.crates}`);
}

/**
 * How many colours a level must carry.
 *
 * ⚠ Asked for as two rules, not one: six from level 22, **more than seven** — so eight — from 41.
 * More colours is the cheapest real difficulty there is, because every extra colour is one more
 * way for a tray to have nowhere to go.
 */
export const coloursFor = (lv) => (lv > 40 ? 8 : 6);

/** Cells of the map, in reading order, with what the silhouette says each one is. */
export function layoutOf(mapIdx) {
  const [name, rows] = MAPS[mapIdx];
  const C = rows[0].length, R = rows.length;
  const kind = [];
  for (let y = 0; y < R; y++) for (let x = 0; x < C; x++) {
    const ch = rows[y][x];
    kind.push(ch === "." ? "wall" : ch === "x" ? "crate" : "free");
  }
  return { name, C, R, kind };
}

const shuffled = (rnd, a) => {
  const out = [...a];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
};
export { shuffled };
