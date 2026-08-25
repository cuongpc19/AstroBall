// Does a recorded game replay to the same ending? Nothing else about this feature matters.
//
// Plays real levels with marbles arriving on a *staggered, uneven* schedule — the thing the
// headless sim does not do and the thing that makes a real game unreproducible without the log.
import { loadGame, makeRng } from "./bots.mjs";

const M = await loadGame();
const { Game, levelDefFor, Replay, parseReplay, BELT_SLOTS } = M;

/** Cheap policy: tap whatever the belt can take, preferring a colour a box still wants. */
function pick(g, rng) {
  const cand = [];
  for (let i = 0; i < g.tiles.length; i++) {
    const a = g.anchorAt(i);
    if (a !== i) continue;
    const t = g.tiles[i];
    if (!t || t.hidden || !g.canEscape(i)) continue;
    if (g.capacity() < g.load(i)) continue;
    const want = g.boxes.some((b) => b.stack[0] === t.color) ? 1 : 0;
    cand.push({ i, want });
  }
  if (!cand.length) return -1;
  const best = Math.max(...cand.map((c) => c.want));
  const top = cand.filter((c) => c.want === best);
  return top[Math.floor(rng() * top.length)].i;
}

/** One game with lumpy arrivals, recording as it goes. */
function play(level, seed) {
  const g = new Game(levelDefFor(level));
  const rec = new Replay();
  g.rec = rec;
  const rng = makeRng(seed);
  const undo = [];
  let guard = 0;
  while (g.status === "play" && guard++ < 4000) {
    // Arrivals: a random slice of what is in flight lands this tick, in a shuffled order — the
    // pile-up in the cone does not deliver first-in-first-out.
    if (g.inFlight.length) {
      const n = 1 + Math.floor(rng() * 3);
      for (let k = 0; k < n && g.inFlight.length; k++) {
        g.arrive(g.inFlight[Math.floor(rng() * g.inFlight.length)]);
      }
    }
    // Occasionally do something other than tap, so the log's rarer events get exercised.
    const roll = rng();
    if (roll < 0.02 && undo.length) {
      g.restore(undo.pop());
    } else if (roll < 0.04) {
      g.useMagnet();
    } else if (roll < 0.06) {
      for (let j = 0; j < g.boxes.length; j++) if (g.canWrench(j)) { g.useWrench(j); break; }
    } else if (rng() < 0.35) {
      const i = pick(g, rng);
      if (i >= 0) {
        undo.push(g.snapshot());
        g.tap(i);
      }
    }
    g.tick();
  }
  return { result: g.status === "won" ? "win" : "lose", taps: g.taps, peak: g.maxBelt, rep: rec.toString() };
}

/** Re-run the recording the way scripts/replay.mjs does. */
function replay(level, rep) {
  const g = new Game(levelDefFor(level));
  const { events } = parseReplay(rep);
  const undo = [];
  for (const e of events) {
    let guard = 0;
    while (g.ticks < e.tick && g.status === "play" && guard++ < 5000) g.tick();
    if (e.kind === "t") { undo.push(g.snapshot()); g.tap(e.arg); }
    else if (e.kind === "a") for (const c of e.colors) g.arrive(c);
    else if (e.kind === "w") g.useWrench(e.arg);
    else if (e.kind === "m") g.useMagnet();
    else if (e.kind === "u") { const s = undo.pop(); if (s) g.restore(s); }
    else if (e.kind === "r") g.useRevive();
  }
  let guard = 0;
  while (g.status === "play" && guard++ < 5000) g.tick();
  return { result: g.status === "won" ? "win" : "lose", taps: g.taps, peak: g.maxBelt };
}

const LEVELS = [1, 3, 8, 12, 16, 21, 32, 47, 60, 88, 106];
let ok = 0, bad = 0, bytes = 0, n = 0;
for (const lv of LEVELS) {
  for (let s = 0; s < 12; s++) {
    const a = play(lv, lv * 1000 + s);
    const b = replay(lv, a.rep);
    n++;
    bytes += a.rep.length;
    const same = a.result === b.result && a.taps === b.taps && a.peak === b.peak;
    if (same) ok++;
    else {
      bad++;
      if (bad <= 6)
        console.log(
          `SAI L${lv} seed ${s}: that ${a.result}/${a.taps}tap/${a.peak} vs phat lai ${b.result}/${b.taps}tap/${b.peak}`,
        );
    }
  }
}
console.log("");
console.log(`${n} van: ${ok} khop, ${bad} sai`);
console.log(`kich thuoc ban ghi trung binh: ${Math.round(bytes / n)} byte`);
process.exit(bad ? 1 : 0);
