// Rebuild the silhouette of a hand-built level, keeping every piece it carries, then re-derive and
// shuffle its box well.
import { M, MAPS, inventory, layoutOf, coloursFor, rngOf, shuffled } from "./remap.mjs";

/**
 * Colours drawn from the **original eight** only.
 *
 * ⚠ Not `PALETTE.length`. Teal sits between green and cyan, lime beside green, magenta beside
 * pink — and brown and grey collide with the crate and the face-down tile. On a 15px marble those
 * are not extra colours, they are extra ways to mis-sort. Eight is also exactly what level 41 up
 * is asked for, so the top of the range needs no widening.
 */
const COLOURS = [0, 1, 2, 3, 4, 5, 6, 7];

/** The well read row by row from the top — the order every range below is counted in. */
function wellSlots(cols) {
  const deepest = Math.max(0, ...cols.map((c) => c.length));
  const out = [];
  for (let d = 0; d < deepest; d++)
    for (let j = 0; j < cols.length; j++) if (d < cols[j].length) out.push({ col: j, idx: d });
  return out;
}

/**
 * The two-step shuffle, exactly as specified.
 *
 * ⚠ **It is a permutation of positions.** Colours only change places, so every colour keeps its
 * box count and every column keeps its length — supply still matches demand, which is the one
 * property a shuffle must not break. Asserted below rather than assumed.
 */
export function shuffleWell(cols, rnd) {
  const out = cols.map((c) => [...c]);
  const slots = wellSlots(out);
  const N = slots.length;
  const permute = (ix) => {
    if (ix.length < 2) return;
    const cs = shuffled(rnd, ix.map((k) => out[slots[k].col][slots[k].idx]));
    ix.forEach((k, n) => { out[slots[k].col][slots[k].idx] = cs[n]; });
  };
  const range = (from, to) => {
    const lo = Math.max(0, from), hi = Math.min(N, to);
    return Array.from({ length: Math.max(0, hi - lo) }, (_, i) => lo + i);
  };
  // Step 1 — three bands, 1-based positions.
  const bands = [range(0, 12), range(23, 36), range(N - 15, N)];
  for (const b of bands) permute(b);
  // Step 2 — the rows those bands never reached, cut into runs, each run into blocks of <= 4.
  const touched = new Set();
  for (const b of bands) for (const k of b) touched.add(slots[k].idx);
  const deepest = Math.max(0, ...out.map((c) => c.length));
  const free = [];
  for (let d = 0; d < deepest; d++) if (!touched.has(d)) free.push(d);
  const runs = [];
  for (const d of free) {
    const last = runs[runs.length - 1];
    if (last && last[last.length - 1] === d - 1) last.push(d);
    else runs.push([d]);
  }
  for (const run of runs)
    for (let i = 0; i < run.length; i += 4) {
      const block = new Set(run.slice(i, i + 4));
      permute(slots.map((s, k) => (block.has(s.idx) ? k : -1)).filter((k) => k >= 0));
    }
  return out;
}

/** Same multiset per colour, same length per column. */
export function samePool(a, b) {
  const tally = (cols) => { const m = new Map(); for (const c of cols) for (const v of c) m.set(v, (m.get(v) ?? 0) + 1); return m; };
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i].length !== b[i].length) return false;
  const x = tally(a), y = tally(b);
  if (x.size !== y.size) return false;
  for (const [k, v] of x) if (y.get(k) !== v) return false;
  return true;
}

/** Lay the level's pieces into a silhouette and fill the rest with trays. */
export function draw(lv, mapIdx, rnd) {
  const inv = inventory(M.HANDMADE[lv]);
  const { name, C, R, kind } = layoutOf(mapIdx);
  const cells = kind.map((k) => (k === "wall" ? { kind: "wall" } : k === "crate" ? { kind: "crate" } : { kind: "tile" }));
  const idx = (x, y) => y * C + x;
  const xy = (i) => [i % C, (i / C) | 0];
  const isFree = (i) => i >= 0 && i < cells.length && cells[i].kind === "tile";
  let free = cells.map((c, i) => (c.kind === "tile" ? i : -1)).filter((i) => i >= 0);

  // Crates first: the map may already carry some, so top up or convert back.
  let crates = cells.filter((c) => c.kind === "crate").length;
  for (const i of shuffled(rnd, free)) {
    if (crates >= inv.crates) break;
    // ⚠ Never the last row: it is the chute mouth, and walling it there is how a shape ends up
    // with its real bottom row sealed.
    if (xy(i)[1] === R - 1) continue;
    cells[i] = { kind: "crate" }; crates++;
  }
  if (crates > inv.crates) for (let i = 0; i < cells.length && crates > inv.crates; i++)
    if (cells[i].kind === "crate") { cells[i] = { kind: "tile" }; crates--; }
  free = cells.map((c, i) => (c.kind === "tile" ? i : -1)).filter((i) => i >= 0);

  // Chocolate: a 2x2 of trays, all four inside the shape.
  const chocAt = [];
  for (const c of inv.choc) {
    const spot = shuffled(rnd, free).find((i) => {
      const [x, y] = xy(i);
      if (x + 1 >= C || y + 1 >= R) return false;
      return [i, i + 1, i + C, i + C + 1].every((k) => isFree(k) && !chocAt.some((s) => [s, s + 1, s + C, s + C + 1].includes(k)));
    });
    if (spot == null) continue;                       // map too small for it — dropped, and reported
    chocAt.push(spot);
    // ⚠ A **rainbow** counter is raised to 6-8. Any tray counts toward it, so three is barely a
    // gate — the box opens on almost the first thing the player does. A single-colour counter is
    // left alone: it only counts its own colour, so the same number is already several times the
    // work, and raising it can outrun the supply on the board.
    const need = c.border == null ? 6 + ((rnd() * 3) | 0) : c.need;
    cells[spot] = { kind: "choc", need, border: c.border, under: c.under.map((t) => ({ ...t })) };
    for (const k of [spot + 1, spot + C, spot + C + 1]) cells[k] = { kind: "floor" };
  }
  free = cells.map((c, i) => (c.kind === "tile" ? i : -1)).filter((i) => i >= 0);

  // Hatches: the cell the shutter pushes into has to be a tray cell.
  const step = { down: C, left: -1, right: 1 };
  let hatches = 0;
  for (const h of inv.hatch) {
    const dir = h.dir ?? "down";
    const spot = shuffled(rnd, free).find((i) => {
      const [x, y] = xy(i);
      if (dir === "left" && x === 0) return false;
      if (dir === "right" && x === C - 1) return false;
      if (dir === "down" && y === R - 1) return false;
      return isFree(i + step[dir]);
    });
    if (spot == null) continue;
    cells[spot] = { kind: "hatch", queue: [...h.queue], hiddenQ: [...h.hiddenQ], dir };
    hatches++;
    free = free.filter((i) => i !== spot);
  }

  // Linked pairs: two trays side by side, the right cell given up to the piece.
  let pairs = 0;
  for (let p = 0; p < inv.pairs; p++) {
    const spot = shuffled(rnd, free).find((i) => xy(i)[0] + 1 < C && isFree(i + 1));
    if (spot == null) break;
    cells[spot] = { kind: "tile", wide: true };
    cells[spot + 1] = { kind: "floor" };
    pairs++;
    free = free.filter((i) => i !== spot && i !== spot + 1);
  }

  const trays = cells.map((c, i) => (c.kind === "tile" ? i : -1)).filter((i) => i >= 0);
  return { name, C, R, cells, trays, dropped: { choc: inv.choc.length - chocAt.length, hatch: inv.hatch.length - hatches, pairs: inv.pairs - pairs }, inv };
}

/** Neighbours that are inside the board and hold something — the engine's idea of "not a way out". */
const solidAround = (cells, C, R, i) => {
  const x = i % C, y = (i / C) | 0;
  let n = 0;
  for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= C || ny >= R) { n++; continue; }
    const k = cells[ny * C + nx];
    if (k.kind !== "floor") n++;
  }
  return n;
};

/** Finish a drawing: colours, the face-down trays, and the arrow locks. */
export function paint(lv, plan, rnd) {
  const { C, R, cells, trays, inv } = plan;
  const want = coloursFor(lv);
  const pool = shuffled(rnd, COLOURS).slice(0, Math.min(want, COLOURS.length));
  // ⚠ A single-colour chocolate box counts only trays of its own colour, and the four inside it
  // cannot be tapped while it is shut — so its colour has to be on the board *outside* it, often
  // enough to reach the counter. Seeding the pool with it is cheaper than discovering the fatal.
  for (const c of cells) if (c.kind === "choc" && c.border != null && !pool.includes(c.border)) pool[pool.length - 1] = c.border;

  // ⚠ The four trays inside a chocolate box are recoloured too, single-colour ribbon or not.
  // The ribbon is the box's unlock condition — which colour poured *outside* counts it down — and
  // `creditLids` never reads what is inside. Leaving them all one colour was an old editor habit,
  // and on a board asked for eight colours it wastes four trays on one of them.
  for (const c of cells) if (c.kind === "choc") for (const u of c.under ?? []) u.color = null;
  const inBox = cells.flatMap((c) => (c.kind === "choc" ? (c.under ?? []) : []));
  const order = shuffled(rnd, trays);
  order.forEach((i, k) => {
    const col = pool[k % pool.length];
    cells[i].color = col;
    if (cells[i].wide) cells[i].mate = pool[(k + 1 + ((rnd() * (pool.length - 1)) | 0)) % pool.length];
  });

  inBox.forEach((u, k) => { u.color = pool[(k + order.length) % pool.length]; });

  // Face-down trays, preferring the enclosed ones: a tray with a way out is never a "?", so a
  // quota spent on the outside edge is a quota the player never meets.
  // ⚠ A fifth more than the level carried, rounded up. Placed enclosed-first because a tray with
  // a way out is never a "?" — the reveal runs before the first frame, so a quota spent on the
  // outside edge is a quota the player never meets.
  const wantHidden = Math.ceil(inv.hidden * 1.2);
  const byEnclosure = [...trays].sort((a, b) => solidAround(cells, C, R, b) - solidAround(cells, C, R, a));
  let hid = 0;
  for (const i of byEnclosure) { if (hid >= wantHidden) break; cells[i].hidden = true; hid += cells[i].wide ? 2 : 1; }

  // Arrow locks. ⚠ They only ever point at a tray that is **not itself an arrow**, so the "waiting
  // on each other" ring `checkBlueprint` refuses cannot form by construction.
  const step = { down: C, left: -1, right: 1 };
  let arrows = 0;
  for (const i of shuffled(rnd, trays)) {
    if (arrows >= inv.arrows) break;
    if (cells[i].wide || cells[i].arrow) continue;
    const dirs = shuffled(rnd, ["down", "left", "right"]);
    for (const d of dirs) {
      const x = i % C, y = (i / C) | 0;
      if (d === "left" && x === 0) continue;
      if (d === "right" && x === C - 1) continue;
      if (d === "down" && y === R - 1) continue;
      const t = cells[i + step[d]];
      if (!t || t.kind !== "tile" || t.arrow || t.wide) continue;
      cells[i].arrow = d; arrows++; break;
    }
  }
  return { hidden: hid, arrows, colours: new Set(cells.flatMap((c) => (c.kind === "tile" ? [c.color, c.mate] : c.kind === "hatch" ? c.queue : c.kind === "choc" ? (c.under ?? []).map((t) => t.color) : [])).filter((v) => v != null)) };
}

/** One full attempt: draw, derive, shuffle, look for a line. Returns null if it does not hold up. */
export function attempt(lv, mapIdx, seed) {
  const rnd = rngOf(seed);
  const plan = draw(lv, mapIdx, rnd);
  const paints = paint(lv, plan, rnd);
  const bp = { cols: plan.C, rows: plan.R, cells: plan.cells, boxHiddenFrac: 0 };
  const fatal = M.checkBlueprint(bp).filter((p) => p.level === "bad");
  if (fatal.length) return { ok: false, why: fatal[0].text, map: plan.name };
  if (paints.colours.size < coloursFor(lv)) return { ok: false, why: `chi ${paints.colours.size} mau`, map: plan.name };
  // ⚠ Under-delivering the "?" quota silently is worse than trying another silhouette: the count
  // is what was asked for, and a map with too few enclosed cells simply cannot carry it.
  const wantHidden = Math.ceil(inventory(M.HANDMADE[lv]).hidden * 1.2);
  if (paints.hidden < wantHidden) return { ok: false, why: `chi ${paints.hidden}/${wantHidden} khay ?`, map: plan.name };
  const base = M.deriveColumns(bp, M.targetWin(lv));
  if (!base.some((c) => c.length)) return { ok: false, why: "khong dung duoc gieng hop", map: plan.name };
  for (let s = 0; s < 12; s++) {
    const cols = shuffleWell(base, rngOf(seed * 31 + s * 7 + 1));
    if (!samePool(base, cols)) return { ok: false, why: "TRON LAM HONG CUNG/CAU", map: plan.name };
    const line = M.lineFor({ ...bp, columns: cols }, cols, 3000 + s * 17);
    if (!line.length) continue;
    // ⚠ **`lineFor` finding a line is not the same as the game keeping it.** `toLevelDef` replays
    // a stored line through `replayWins` and drops it if it does not win — and it *can* disagree:
    // two levels out of 145 came back with an empty `refTaps` after passing the finder. A board
    // with no line has no proof it can be won and nothing for the hint button, so the gate is the
    // real path, not the search that fed it.
    const full = { ...bp, columns: cols, refTaps: line };
    if (!M.toLevelDef(full, lv, M.targetWin(lv)).refTaps?.length) continue;
    return { ok: true, bp: full, map: plan.name, plan, paints, tries: s + 1 };
  }
  return { ok: false, why: "tron xong khong con duong thang", map: plan.name };
}
