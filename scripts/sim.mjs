// Headless simulator. Written early on purpose: driving the real scene in a browser costs
// ~30s per data point, which is too slow to take more than one or two samples, and single
// samples are noisy enough to point tuning in the wrong direction.
//
// Three bots run every level, and the spread between them is the whole point — a lever that
// moves only one of them is a real lever; a lever that moves none is a null result a single
// bot would have hidden.
//
//   greedy  — tips the best tray it can, every chance it gets. No self-control.
//   patient — same choice, but refuses to tip a tray the *rail* has no room for.
//   random  — tips any legal tray. The careless player.
//
// The patient bot exists because greedy alone misreads CHUTE_CAP: a bigger hopper makes
// greedy worse, which looks like "harder" but is really "more rope for a bot that cannot
// stop itself". Where patient overtakes greedy is where restraint has become a real skill.
//
//   node scripts/sim.mjs               # levels 1..40
//   node scripts/sim.mjs 60            # levels 1..60
//   node scripts/sim.mjs 1 12          # levels 1..12, verbose per level
//
// The game modules are TypeScript with extensionless imports, which Node cannot resolve on
// its own, so they are bundled through esbuild (already present as a Vite dependency) and
// imported from memory. No build step, no generated files to keep in sync.

import { loadGame, rate, best, bd, noiseAt } from "./bots.mjs";

const M = await loadGame();
const { makeLevel, params, targetWin, BELT_SLOTS, TRAY_N } = M;

const MAX_TICKS = 60000;

function trials(def, mode, n) {

  return { rate: mode === "best" ? best(M, def, n) : rate(M, def, mode, n) };
}

const upto = Number(process.argv[2] ?? 40);
const verboseFrom = Number(process.argv[3] ?? 0);
const N = 12;

console.log(
  ["lvl", "col", "taps", "shape", "x2", "hide", "greedy", "muctieu", "patient", "random", "gen"]
    .map((s) => s.padStart(8))
    .join(""),
);

let genTotal = 0;
let hardLevels = [];
for (let level = 1; level <= upto; level++) {
  const t0 = performance.now();
  const def = makeLevel(level);
  const dt = performance.now() - t0;
  genTotal += dt;

  const p = params(level);
  const G = trials(def, "greedy", N);
  const P = trials(def, "patient", N);
  const R = trials(def, "random", N);
  // Solvability is already guaranteed by level.ts, which will not return a board it has not
  // cleared. What is flagged here is difficulty: a level that *best play* loses more often
  // than it wins is tuned wrong, whereas the odd loss is the game working.
  //
  // Best play is the better of greedy and patient, never greedy alone — greedy has no
  // self-control, so on a generous CHUTE_CAP it fails levels that are perfectly fair to a
  // player who knows when to hold a tray back.
  // ⚠ Judge against the target on the SAME ruler the target is defined on — (B+D)/2, not
  // best play. Comparing best-play against a (B+D)/2 target flagged level 8 as 27 points too
  // hard when the tuner had it landing within 4; the two numbers simply measure different
  // things, and the mismatch reads as a real defect.
  //
  // The curve deliberately asks for 25% by level 20, so "loses more often than it wins" down
  // there is the design working. What is worth flagging is a level far BELOW what it was
  // asked to be.
  const blend = bd(M, def, N).raw;
  const want = targetWin(level);
  if (blend < want - 0.25) {
    hardLevels.push(`${level} (${(blend * 100).toFixed(0)}% vs muc tieu ${(want * 100).toFixed(0)}%)`);
  }

  const row = [
    level,
    def.colors.length,
    def.refTaps.length,
    p.shape,
    def.tiles.filter((t) => t && t.wide).length,
    p.hiddenFrac.toFixed(2),
    `${(G.rate * 100).toFixed(0)}%`,
    `${Math.round(targetWin(level) * 100)}%`,
    `${(P.rate * 100).toFixed(0)}%`,
    `${(R.rate * 100).toFixed(0)}%`,
    `${dt.toFixed(0)}ms`,
  ];
  console.log(row.map((s) => String(s).padStart(8)).join(""));

  if (verboseFrom && level <= verboseFrom) {
    const boxes = def.columns.map((s) => s.length).join("/");
    console.log(`         boxes per column ${boxes}   total marbles ${def.refTaps.length * TRAY_N}`);
  }
}

console.log(`\ngeneration: ${(genTotal / upto).toFixed(1)} ms/level average`);
console.log(
  hardLevels.length
    ? `⚠ kho hon muc tieu >25 diem o: ${hardLevels.join(", ")}`
    : "✓ moi level deu bam muc tieu trong 25 diem",
);
