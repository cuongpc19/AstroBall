// What a revive does to a board, checked against real jams.
//
// ⚠ The rule this exists to defend: **supply equals demand, per colour**. Every board the
// generator ships has exactly as many marbles of a colour — in trays, hatches, chute and belt —
// as its boxes of that colour have holes. A revive that took six marbles off the rail and left
// their boxes standing would leave six holes nothing can ever fill; one that took two boxes off
// and left their marbles circulating would leave six marbles nothing can ever eat. Either way the
// player is handed a level that is dead and does not say so, several minutes before it admits it.
//
// So the two halves of "6 marbles and 2 boxes" are the same number twice, and this script is what
// says so out loud: play thousands of games into a genuine jam, take the revive, and re-derive
// both sides.
//
//   node scripts/revive.mjs           # levels 1..45, 40 games each
//   node scripts/revive.mjs 20 12     # levels 1..20, 12 games each

import { loadGame, seedFor, makeRng } from "./bots.mjs";

const M = await loadGame();
const { levelDefFor, Game, BOX_SLOTS, TRAY_N, REVIVE_BOXES, REVIVE_MARBLES } = M;

const UPTO = Number(process.argv[2] ?? 45);
const GAMES = Number(process.argv[3] ?? 40);

/** Every marble still in the world, by colour. */
function supply(g) {
  const m = new Map();
  const add = (c, n = 1) => m.set(c, (m.get(c) ?? 0) + n);
  for (const c of g.belt) if (c !== null) add(c);
  for (const c of g.pending) add(c);
  for (const c of g.inFlight) add(c);
  for (const c of g.magnet) add(c);
  for (let i = 0; i < g.tiles.length; i++) {
    const t = g.tiles[i];
    if (!t) continue;
    // A linked pair is two trays with two colours, and a bar under it doubles both halves.
    const load = g.load(i);
    if (t.wide) {
      add(t.color, load / 2);
      add(t.mate ?? t.color, load / 2);
    } else add(t.color, load);
  }
  for (const d of g.disp) if (d) for (const c of d.queue) add(c, TRAY_N);
  for (const lid of g.lids) for (const t of lid.tiles) if (t) add(t.color, TRAY_N);
  return m;
}

/** Every hole still waiting for one, by colour. */
function demand(g) {
  const m = new Map();
  for (const b of g.boxes) {
    b.stack.forEach((c, k) => {
      const holes = k === 0 ? BOX_SLOTS - b.filled : BOX_SLOTS;
      m.set(c, (m.get(c) ?? 0) + holes);
    });
  }
  return m;
}

function mismatches(g) {
  const s = supply(g);
  const d = demand(g);
  const out = [];
  for (const c of new Set([...s.keys(), ...d.keys()])) {
    const a = s.get(c) ?? 0;
    const b = d.get(c) ?? 0;
    if (a !== b) out.push(`colour ${c}: ${a} marbles vs ${b} holes`);
  }
  return out;
}

/** Careless play, which is what actually jams a board. Runs on until the game says it is over. */
function playOn(g, rng) {
  let ticks = 0;
  while (g.status === "play" && ticks < 60000) {
    const open = [];
    for (let i = 0; i < g.tiles.length; i++) if (g.canTap(i)) open.push(i);
    if (open.length) {
      g.tap(open[(rng() * open.length) | 0]);
      g.arriveAll();
    }
    g.tick();
    ticks++;
  }
  return ticks;
}

let jams = 0;
let offered = 0;
let noPlan = 0;
let broken = 0;
let ranOn = 0;
let wonAfter = 0;
const rows = new Map();

for (let lvl = 1; lvl <= UPTO; lvl++) {
  const def = levelDefFor(lvl);
  for (let s = 0; s < GAMES; s++) {
    const rng = makeRng(seedFor(lvl, s));
    const g = new Game(def);
    playOn(g, rng);
    if (g.status !== "lost") continue;
    jams++;

    const before = mismatches(g);
    if (before.length) {
      console.log(`level ${lvl} seed ${s}: board already inconsistent before the revive — ${before[0]}`);
      broken++;
      continue;
    }

    const plan = g.revivePlan();
    if (!plan) {
      noPlan++;
      continue;
    }
    offered++;

    const beltWas = g.beltUsed();
    const boxesWere = g.boxes.reduce((a, b) => a + b.stack.length, 0);
    const picks = g.useRevive();
    const boxesNow = g.boxes.reduce((a, b) => a + b.stack.length, 0);

    const errs = [];
    if (picks.length !== REVIVE_BOXES) errs.push(`removed ${picks.length} boxes`);
    if (beltWas - g.beltUsed() !== REVIVE_MARBLES) errs.push(`freed ${beltWas - g.beltUsed()} slots`);
    if (boxesWere - boxesNow !== REVIVE_BOXES) errs.push(`stacks lost ${boxesWere - boxesNow}`);
    if (g.status !== "play") errs.push(`status ${g.status}`);
    errs.push(...mismatches(g));
    if (errs.length) {
      broken++;
      if (broken < 8) console.log(`level ${lvl} seed ${s}: ${errs.join("; ")}`);
      continue;
    }
    for (const p of picks) rows.set(p.idx, (rows.get(p.idx) ?? 0) + 1);

    // A revive that hands back a board which dies on the very next tick has sold nothing.
    if (playOn(g, rng) > 1) ranOn++;
    if (g.status === "won") wonAfter++;
  }
}

const pct = (n) => (offered ? ((100 * n) / offered).toFixed(0) : "0") + "%";
console.log(
  `\njams ${jams}   revive offered ${offered}   no plan ${noPlan}   BROKEN ${broken}\n` +
    `boards that played on after the revive: ${ranOn} (${pct(ranOn)}), of which won: ${wonAfter}\n` +
    "boxes taken, by row of the well: " +
    [...rows]
      .sort((a, b) => a[0] - b[0])
      .map(([k, v]) => `row ${k + 1}: ${v}`)
      .join("   "),
);
process.exit(broken ? 1 : 0);
