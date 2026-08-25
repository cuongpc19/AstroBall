// Watch a real game back, move by move.
//
//   node scripts/replay.mjs                    # pull from Firebase, list what has replays
//   node scripts/replay.mjs --level 3          # every recorded game of level 3, verified
//   node scripts/replay.mjs --level 3 --lose   # only the ones they lost
//   node scripts/replay.mjs --id 5 --trace     # game #5 from the list, tap by tap
//   node scripts/replay.mjs --file playlog.jsonl   # local rows instead of Firebase
//
// ⚠ **It verifies before it reports.** Each game is re-run through the real `logic.ts`, and the
// result is compared with what the player's device said happened. A replay that lands somewhere
// else is printed as SAI and nothing is concluded from it — the whole point of a replay is that it
// is the same game, and a silent divergence would turn this into a very convincing fiction
// generator. Every row also prints `taps` and `peak` from both sides for the same reason.
//
// ⚠ Rows written before replays existed have no `rep` and are skipped, not guessed at.

import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { loadGame } from "./bots.mjs";

const M = await loadGame();
const { Game, levelDefFor, levelFingerprint, parseReplay, BELT_SLOTS, PALETTE } = M;

const arg = (k, d = null) => {
  const i = process.argv.indexOf(k);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const has = (k) => process.argv.includes(k);

const TMP = "scripts/.reps.json";

/**
 * Same route as `pull-runs.mjs`: the CLI authenticates as project owner; reads are closed to all.
 *
 * ⚠ **`/reps`, not `/runs`.** Since 2026-08-23 the moves live in their own node: `rep` was 61% of
 * every byte `/runs` weighed — 9.1 MB of 14.9 over a seven-day window — and `public/stats.html`,
 * which never reads it, had to download the lot on every load, until it stopped loading on a phone
 * at all. RTDB's REST API cannot return a row without one of its fields, so splitting the node was
 * the only way to shrink that query.
 *
 * ⚠ **A `/reps` row is the whole game row *plus* `rep`**, which is why nothing below changes: this
 * tool reads `lvl`, `sig`, `result`, `ms`, `taps`, `peak` and `used` off it, and a lean
 * `{run, rep}` row would have needed a join against `/runs` that does not exist here.
 *
 * ⚠ **The 11,638 games recorded before the split were migrated in**, keeping their original push
 * keys, so this reads exactly the history it read before. `/runs` is not consulted and must not be
 * added back: its `rep` fields were deleted in the same operation, so pulling it would cost 5.8 MB
 * to find nothing.
 */
function fromFirebase() {
  const r = spawnSync("npx", ["-y", "firebase-tools", "database:get", "/reps", "-o", TMP], {
    encoding: "utf8",
    shell: true,
  });
  if (r.status !== 0) {
    const said = [r.stdout, r.stderr].map((s) => (s || "").trim()).filter(Boolean).join("\n");
    console.error(said || "firebase-tools that bai");
    process.exit(1);
  }
  const obj = JSON.parse(fs.readFileSync(TMP, "utf8")) || {};
  fs.unlinkSync(TMP);
  return Object.values(obj);
}

function fromFile(path) {
  return fs
    .readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

// ── load ────────────────────────────────────────────────────────────────────

const file = arg("--file");
let rows = file ? fromFile(file) : fromFirebase();
if (!has("--all")) rows = rows.filter((r) => r.from !== "localhost");
rows = rows.filter((r) => typeof r.rep === "string" && r.rep.length);

const wantLevel = arg("--level") ? Number(arg("--level")) : null;
if (wantLevel !== null) rows = rows.filter((r) => r.lvl === wantLevel);
if (has("--lose")) rows = rows.filter((r) => r.result === "lose");
if (has("--win")) rows = rows.filter((r) => r.result === "win");
rows.sort((a, b) => (a.at || 0) - (b.at || 0));

if (!rows.length) {
  console.log("Khong co van nao co ban ghi nuoc di.");
  console.log("Ban ghi chi co tu build sau khi them replay.ts — van cu khong co truong `rep`.");
  process.exit(0);
}

// ── replay one game ─────────────────────────────────────────────────────────

/**
 * Re-run a recorded game through the real engine.
 *
 * ⚠ The event ticks drive the clock, not the other way round: run `tick()` until the counter
 * reaches the event's stamp, then apply it. Applying events in order and ticking a fixed number of
 * times between them would drift the moment one tick was skipped, and the drift is silent.
 */
function replay(row, trace) {
  const def = levelDefFor(row.lvl);
  const sig = levelFingerprint(def);
  const { events, truncated } = parseReplay(row.rep);
  const g = new Game(def);
  const lines = [];
  const undo = [];
  let bad = null;

  for (const e of events) {
    // Catch the clock up to this event.
    let guard = 0;
    while (g.ticks < e.tick && g.status === "play" && guard++ < 5000) g.tick();
    if (e.kind === "t") {
      const tile = g.tiles[g.anchorAt(e.arg)] ?? null;
      const load = g.load(e.arg);
      const before = g.beltUsed();
      // ⚠ Snapshot before the tap, exactly as `GameScene` does, or an undo event later has the
      // wrong board to go back to and everything after it is a different game.
      undo.push(g.snapshot());
      const col = g.tap(e.arg);
      if (col === null && !bad) bad = `tick ${e.tick}: tap o ${e.arg} bi engine tu choi`;
      if (trace)
        lines.push(
          `  t${String(e.tick).padStart(4)}  do khay ${String(e.arg).padStart(2)}  ` +
            `mau ${col === null ? "?" : name(col)}  ${load} bi  ray ${before}/${BELT_SLOTS}`,
        );
    } else if (e.kind === "a") {
      for (const c of e.colors) g.arrive(c);
    } else if (e.kind === "w") {
      g.useWrench(e.arg);
      if (trace) lines.push(`  t${String(e.tick).padStart(4)}  co le  cot ${e.arg}`);
    } else if (e.kind === "m") {
      g.useMagnet();
      if (trace) lines.push(`  t${String(e.tick).padStart(4)}  nam cham`);
    } else if (e.kind === "u") {
      const s = undo.pop();
      if (s) g.restore(s);
      if (trace) lines.push(`  t${String(e.tick).padStart(4)}  undo`);
    } else if (e.kind === "r") {
      g.useRevive();
      if (trace) lines.push(`  t${String(e.tick).padStart(4)}  REVIVE`);
    }
  }
  // Play the tail out — the last events are followed by however many ticks it took to finish.
  let guard = 0;
  while (g.status === "play" && guard++ < 5000) g.tick();

  const got = g.status === "won" ? "win" : "lose";
  if (sig !== row.sig) bad = `ban co da doi (van tay ${row.sig} -> ${sig})`;
  else if (got !== row.result) bad = `ket qua lech: may ghi ${row.result}, phat lai ra ${got}`;
  else if (truncated) bad = "ban ghi bi cat vi qua dai";
  return { g, lines, bad, got };
}

const name = (c) => (PALETTE?.[c]?.name ? PALETTE[c].name : `#${c}`);

// ── report ──────────────────────────────────────────────────────────────────

const id = arg("--id") ? Number(arg("--id")) : null;
const trace = has("--trace") || id !== null;
const show = id !== null ? [rows[id]].filter(Boolean) : rows;
if (id !== null && !show.length) {
  console.error(`Khong co van #${id}. Co ${rows.length} van.`);
  process.exit(1);
}

console.log(`${show.length} van co ban ghi nuoc di.\n`);
console.log("#   | lv  | ket qua | tap  | peak  | thoi gian | booster        | phat lai");
console.log("----|-----|---------|------|-------|-----------|----------------|----------");

let okN = 0;
let badN = 0;
for (const [i, row] of show.entries()) {
  const n = id !== null ? id : i;
  const r = replay(row, trace);
  if (r.bad) badN++;
  else okN++;
  const used = (row.used || []).join(",") || "-";
  console.log(
    `${String(n).padEnd(4)}| ${String(row.lvl).padEnd(4)}| ${row.result.padEnd(8)}| ` +
      `${String(row.taps).padEnd(5)}| ${String(row.peak).padEnd(6)}| ` +
      `${String(Math.round((row.ms || 0) / 1000) + "s").padEnd(10)}| ${used.padEnd(15)}| ` +
      (r.bad ? `SAI — ${r.bad}` : "khop"),
  );
  if (trace) {
    for (const l of r.lines) console.log(l);
    console.log(
      `  ket thuc: ${r.got}, ray ${r.g.beltUsed()}/${BELT_SLOTS}, ${r.g.taps} tap, dinh ${r.g.maxBelt}\n`,
    );
  }
}

console.log("");
console.log(`${okN} khop, ${badN} sai.`);
if (badN) {
  console.log("");
  console.log("⚠ Van 'SAI' KHONG duoc dung de ket luan gi. Phat lai ra ket qua khac tuc la ban");
  console.log("  ghi va ban co khong con noi ve cung mot van — thuong la vi level da duoc sua");
  console.log("  sau khi nguoi do choi (van tay khac).");
}
