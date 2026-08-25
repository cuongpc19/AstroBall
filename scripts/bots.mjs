// The bots, in ONE place.
//
// ⚠ Why this file exists: sim.mjs, winrate.mjs and tune.mjs each grew their own copy of the
// same three bots, and the copies drifted. On level 10 the sim reported best play at 17% while
// winrate reported 55% — for what was supposed to be the identical measurement. Every number
// either of them had produced was therefore incomparable with the other, and there was no way
// to tell from the output which one to believe.
//
// The same lesson the sibling Pixel Flow project records about its calibration constants:
// one definition, imported everywhere, or the tuner ends up optimising something the report is
// not showing.

import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

/** Bundle src/game and hand back the engine. Every tool shares this entry point. */
export async function loadGame() {
  const src = fileURLToPath(new URL("../src/game/", import.meta.url));
  const bundle = await esbuild.build({
    stdin: {
      // ⚠ `./board` too. It owns `levelDefFor`, the single answer to "which board is level N" —
      // without it a script calls `makeLevel` and measures the generated board for a level the
      // player is being served a hand-built one.
      contents:
        'export * from "./level";\n' +
        'export * from "./logic";\n' +
        'export * from "./config";\n' +
        'export * from "./board";\n' +
        'export * from "./custom";\n' +
        'export * from "./handmade";\n' +
        // The replay parser lives with the recorder, so the wire format cannot drift apart.
        'export * from "./replay";\n',
      resolveDir: src,
      loader: "ts",
    },
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
  });
  return import(
    "data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].text).toString("base64")
  );
}

export function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Holes still open in boxes of colour `c` that the player can actually see. */
function openHoles(M, g, c) {
  let want = 0;
  for (const b of g.boxes) {
    if (b.stack.length && b.stack[0] === c) want += M.BOX_SLOTS - b.filled;
  }
  return want;
}

/**
 * Marbles of colour `c` already spoken for: riding the belt, queued at the neck, still falling,
 * or parked in the magnet. Every one of them is going to take a hole that is currently counted
 * as open.
 */
function committed(g, c) {
  let n = 0;
  for (const k of g.belt) if (k === c) n++;
  for (const k of g.pending) if (k === c) n++;
  for (const k of g.inFlight) if (k === c) n++;
  for (const k of g.magnet) if (k === c) n++;
  return n;
}

/**
 * How a thinking bot values tipping a tray of colour `c`.
 *
 *   net  — holes standing open **minus everything already committed**. The default.
 *   open — holes standing open, minus what is on the belt at weight 1. The original.
 *
 * ⚠ The weights in `open` are 10 against 1, which is the whole problem: a box with three holes
 * and three matching marbles already on the belt needs nothing, and still scores 30 - 3 = 27 —
 * comfortably the highest on the board. So the bot tips nine more marbles for a colour with no
 * room left and they ride the belt forever. `net` sees that need as 0, and gets the follow-on
 * free: once the committed marbles will fill the box, that box clears and its colour stops being
 * on top, so there is nothing left to aim at. Measured over 29 levels, best play went 78% -> 95%.
 *
 * ⚠ The trailing terms in `net` only decide ties and getting them wrong is expensive. Scoring
 * `need * 10 - sent` alone prefers a colour with **no box open at all** (0 - 0) over one with a
 * hole left and three marbles already coming (0 - 3), so a quarter of all its taps went to
 * colours nothing could accept — level 8 fell from 100% to 65%. Rewarding "has somewhere to go"
 * first and penalising over-supply second put the average at 95% with no level under 50%.
 *
 * ⚠ Neither looks past the *top* box of a column. The one below may be hidden, and a bot that
 * reads a hidden colour is not measuring a game anybody can play.
 */
/**
 * What tipping the tile at `i` is worth, in the units `score` works in.
 *
 * ⚠ A linked pair drops **half of each of two colours**, so scoring it on `color` alone judges an
 * eighteen-marble piece by the nine marbles of its left half — and the left half is the arbitrary
 * one, since which colour ended up on which side is a coin flip in the drawing. A pair whose right
 * half is exactly what an open box wants reads as worthless, and one whose right half is a colour
 * nothing can accept reads as a clean move.
 *
 * The **mean**, not the sum. `score` is a per-tray desirability that other candidates are ranked
 * against, and summing would make any pair outrank any single tray on arithmetic alone — while the
 * belt, which a pair eats half of, is usually the binding constraint. `patient` is what weighs the
 * load, through `beltFree() >= load(i)`.
 */
function tileValue(M, g, i, score) {
  const t = g.tiles[i];
  const v = score(M, g, t.color);
  if (!t.wide) return v;
  return (v + score(M, g, t.mate ?? t.color)) / 2;
}

const SCORERS = {
  net: (M, g, c) => {
    const holes = openHoles(M, g, c);
    const sent = committed(g, c);
    return Math.max(0, holes - sent) * 10 + holes - sent;
  },
  // ⚠ Belt only, never `committed`. This is kept byte-for-byte because it is the bot every
  // number published before 2026-08-11 was measured against; widening it would silently rewrite
  // history. It also still wins outright on some boards — see `best`.
  open: (M, g, c) => {
    let onBelt = 0;
    for (const k of g.belt) if (k === c) onBelt++;
    return openHoles(M, g, c) * 10 - onBelt;
  },
};

// ── Method Cuongxs1 ──────────────────────────────────────────────────────────
//
// A different shape from the bots above. Those pick the single highest-scoring tray; this one
// turns the scores into **weights and samples from them**, so the same board played fifty times
// takes fifty different lines. It is meant to model a player who can see everything and still
// has to choose — not one who is careless (that is what `slip` already does) but one for whom
// several taps look reasonable and the choice is genuinely open.
//
// ⚠ It is an *oracle*: it reads the hatch queues, the colours of face-down trays, and the colours
// of boxes buried below the top of their column. None of that is on screen. That is deliberate —
// the point is to measure how much of a level's difficulty survives when the hidden information
// is handed over, i.e. how much of it is planning rather than guessing.

/**
 * The colours a tile actually drops — **two** for a linked pair, one otherwise.
 *
 * ⚠ Everything downstream that says "the colour of this tray" has to go through here now that
 * pairs ship. A pair is two trays with two colours emptied by one tap, so on the supply side it
 * stocks both colours and on the demand side it serves both; reading `.color` counts half of it
 * and the half it counts is arbitrary — which colour ended up on the left is a coin flip in the
 * drawing.
 */
function coloursOf(t) {
  return t.wide ? [t.color, t.mate ?? t.color] : [t.color];
}

/**
 * Trays standing with their eggs proud: on the board, face-up, and with a lane out.
 *
 * ⚠ `liftable`, not `canEscape` — an arrow-locked tray has a lane out and still cannot be poured.
 * This is Cuongxs1's idea of what the player can see, so a bot counting a locked tray as available
 * is a bot planning moves the board refuses, and its map-gain term would credit the tap that opens
 * it twice.
 */
function availableTrays(g) {
  const out = [];
  for (let i = 0; i < g.tiles.length; i++) {
    const t = g.tiles[i];
    if (t && !t.hidden && g.liftable(i)) out.push(i);
  }
  return out;
}

/**
 * Colour of the box at depth `k` of each column — depth 0 is the open one.
 *
 * The oracle reads straight through `boxHidden`. The **blind** variant does not: a box the player
 * cannot see contributes nothing, which is the whole difference being measured. Depth 0 is never
 * hidden, so blindness only ever bites below the top.
 */
function boxRow(g, k, blind = false) {
  const out = [];
  g.boxes.forEach((b, j) => {
    if (b.stack.length <= k) return;
    if (blind && g.boxIsHidden(j, k)) return;
    out.push(b.stack[k]);
  });
  return out;
}

/** Ticks to let the marbles travel before asking whether a move killed us. */
export const FATAL_HORIZON = 30;

/**
 * Share of the legal taps, over a played game, that turn out to be fatal within `FATAL_HORIZON`.
 *
 * ⚠ This is a *different axis from winrate* and the play log says it may be the more useful one.
 * Level 36 took the player seven attempts and level 39 one, while every winrate model ranked 39
 * as the harder of the two — but the trap rate puts 36 well above 39. A board can be hard because
 * it is long and tight (winrate) or because it punishes the opening (this), and the two are not
 * the same thing to anyone holding it.
 *
 * ⚠ Measured *immediately* after a tap it reads 0% on every board: the marbles have not travelled
 * yet. The clock has to run.
 */
export function trapRate(M, def, seed) {
  const rng = makeRng(seed);
  const g = new M.Game(def);
  let traps = 0;
  let probes = 0;
  for (let t = 0; g.status === "play" && t < 2000; t++) {
    const open = [];
    for (let i = 0; i < g.tiles.length; i++) if (g.canTap(i)) open.push(i);
    if (open.length) {
      for (const i of open) {
        const snap = g.snapshot();
        g.tap(i);
        g.arriveAll();
        for (let k = 0; k < FATAL_HORIZON && g.status === "play"; k++) g.tick();
        if (g.status === "lost" || g.isStuck()) traps++;
        probes++;
        g.restore(snap);
      }
      g.tap(open[(rng() * open.length) | 0]);
      g.arriveAll();
    }
    g.tick();
  }
  return probes ? traps / probes : 0;
}

const countOf = (arr, c) => arr.reduce((n, x) => n + (x === c ? 1 : 0), 0);

/**
 * Demand for colour `c` at box depth `row`, in **boxes**, with everything already on its way
 * subtracted.
 *
 * ⚠ This subtraction applies to every formula in the method, on instruction: *"all my formulas
 * have to subtract the marbles about to be eaten and the boxes about to be cleared"*. Counting
 * boxes raw is what wrecked it — a box with three holes and nine marbles already heading for it
 * still read as demand, so the model sent nine more. Measured across 29 levels, 45-48% of its
 * taps went to a colour with no room left, it lost with the belt at 30/30 every single time, and
 * levels the other bots clear at 80% scored 4%.
 *
 * "Boxes about to be cleared" falls out of the same arithmetic: once the marbles in flight cover
 * a box's remaining holes, its net demand is zero, so it stops attracting taps — and when it
 * pops, its colour is no longer on top.
 *
 * Depth 0 is the open box, so its demand is the holes still standing minus what is coming.
 * Depth 1 has received nothing yet, but the marbles that *overshoot* the open box are still
 * circulating when it opens, so the surplus carries over and is subtracted there instead.
 */
function demandBoxes(M, g, c, row, blind = false) {
  const open = openHoles(M, g, c);
  const sent = committed(g, c);
  if (row === 0) return Math.max(0, open - sent) / M.BOX_SLOTS;
  const spare = Math.max(0, sent - open);
  const behind = countOf(boxRow(g, row, blind), c) * M.BOX_SLOTS;
  return Math.max(0, behind - spare) / M.BOX_SLOTS;
}

/**
 * How much tapping `i` opens the board up, 0 … 1.
 *
 * Measured by actually doing it: snapshot, tap, look at which trays now stand available that did
 * not before, restore. That one move covers all three ways the board opens — a neighbour gaining
 * a lane, a face-down tray revealing, and a hatch shoving its next tray out — without this having
 * to reimplement any of the rules. ⚠ Reimplementing them is how `level.ts` ended up carrying a
 * second copy of the escape test.
 *
 * A newly opened tray is worth 0.15 if a box on top still needs its colour and 0.08 if one a row
 * down does. ⚠ "Still needs" — not "is that colour". Unlocking a tray for a box that already has
 * its marbles coming is not opening the board up, it is queueing more of what is already stuck.
 */
function mapGain(M, g, i, blind = false) {
  const before = new Set(availableTrays(g));
  const snap = g.snapshot();
  if (g.tap(i) == null) return { gain: 0, fatal: false };
  let gain = 0;
  for (const j of availableTrays(g)) {
    if (before.has(j)) continue;
    // A newly opened pair is two trays' worth of unlocking, so each of its colours is asked
    // separately — unlocking a pair whose right half is wanted is a real gain even when its
    // left half is a colour nothing can take.
    for (const c of coloursOf(g.tiles[j])) {
      if (demandBoxes(M, g, c, 0, blind) > 0) gain += 0.15;
      if (demandBoxes(M, g, c, 1, blind) > 0) gain += 0.08;
    }
  }
  // ⚠ There is no lookahead here, and that is a result rather than an omission.
  //
  // Running the clock 30 ticks after each candidate and refusing the moves that turn out dead
  // moved the average 37% -> 38% — inside the ±4 that 60 games carry — and it moved *down* on the
  // boards it was meant to help, because on a tight board almost every move looks dead at 30
  // ticks and filtering leaves too few. What the probe produces is a good **difficulty
  // statistic** (see `trapRate`); it is not a good policy.
  g.restore(snap);
  const fatal = false;
  return { gain: Math.min(1, gain), fatal };
}

/**
 * Relative weight of tapping each of `open`, measured against the boxes at depth `row`:
 *
 *     (boxes of this colour still short at `row`) × 49 / (available trays of it × (2 − map gain))
 *
 * Reading it: demand on top, supply underneath. A colour two boxes want and one tray can serve is
 * worth far more than one four trays can serve. Opening the board divides by as little as 1
 * instead of 2, so a tap that unlocks something is worth up to double.
 *
 * `gains` is passed in rather than computed here because `mapGain` costs a snapshot, a tap and a
 * restore per candidate — the fallback below re-weighs the same turn and must not pay for it
 * twice.
 */
function cuongxs1Weights(M, g, open, avail, gains, row, blind = false) {
  const supplyOf = avail.flatMap((k) => coloursOf(g.tiles[k]));
  const raw = open.map((i, k) => {
    // A linked pair is weighed as the **mean** of its two halves — it serves both demands with
    // one tap, but it also drops eighteen marbles, so it does not get to be worth twice a single
    // tray for free. A pair whose halves are one wanted colour and one dead colour lands
    // halfway, which is what it is.
    const cs = coloursOf(g.tiles[i]);
    let sum = 0;
    for (const c of cs) {
      const supply = countOf(supplyOf, c) || 1;
      sum += (demandBoxes(M, g, c, row, blind) * 49) / (supply * (2 - gains[k]));
    }
    return sum / cs.length;
  });
  return polarise(raw);
}

/**
 * Collapse the weights to two levels: 95 for a candidate that is *clearly* the best, 5 for any
 * other candidate that has somewhere to go at all.
 *
 * ⚠ This is the model saying the player is **good**. Given a board where one tap is plainly
 * better than the rest, a competent person takes it — they do not roll dice weighted by how much
 * better it is. Sampling in proportion to the raw score modelled someone who sometimes passes up
 * an obvious move, which is a different (and weaker) player.
 *
 * "Clearly the best" is more than half the weight on the turn. At most one candidate can hold
 * that, so a turn either has a stand-out — taken ~90% of the time with three candidates — or it
 * has none, and then every option with demand is equally likely. That second case is where the
 * difficulty now lives: a board is hard when it keeps failing to present a stand-out.
 *
 * ⚠ A candidate nothing is short of stays at **0** and is still refused outright. Polarising it
 * to 5 would let the model dump a colour no box can take, which is the defect that cost 45% of
 * its taps before.
 */
function polarise(raw) {
  const total = raw.reduce((a, b) => a + b, 0);
  if (total <= 0) return raw;
  return raw.map((w) => (w <= 0 ? 0 : w / total > 0.5 ? 95 : 5));
}

/**
 * Play one game by sampling from those weights.
 *
 * ⚠ A colour no box is open for weighs exactly zero, so on a turn where nothing on the board fits
 * anything on top, every candidate is zero and there is nothing to sample from. The board still
 * has to move. **Fall through to the second row of boxes** — what is coming next once the open
 * ones clear — and weigh the same turn against that instead. Only if that is also empty does it
 * pick uniformly, which by then means no box anywhere, at any depth, wants anything available.
 *
 * ⚠ It stops at the second row rather than walking the stack down. Deeper boxes are further from
 * anything the turn can affect, and a model that chooses on what is five boxes away is choosing on
 * information no plan can act upon.
 */
/**
 * How long the rail has to go quiet before a bot will pour again, in ticks.
 *
 * ⚠ **Every bot in this file taps on every single tick a legal tray exists.** `patient` and
 * Cuongxs1's belt discipline only *filter out* trays the rail has no room for — neither can decline
 * a turn while a tray still fits. So they play at maximum pour rate, on a machine whose only way to
 * lose is congestion, and a person does the opposite: pour one tray, watch it go round, pour again.
 * Measured on level 20, same seed, same scoring: pouring flat out loses with the rail at 30/30
 * after 22 taps; waiting for the rail to settle **wins** with a peak of 24 and all 34 trays poured.
 *
 * ⚠ **0 is the old behaviour**, kept reachable so every number published before this can still be
 * reproduced — the same reason the `open` scorer is still in the pool. Every number in this project
 * dated before 2026-08-20 was measured at 0.
 *
 * ⚠ **24 was chosen by the data, not by argument.** Ranked on 2061 real games over 27 levels with
 * `PURE=1 N=40 MINLV=15 npm run winrate -- --models`, leave-one-out log-likelihood against a
 * constant's -700.0:
 *
 * | model    | settle 0 | 8      | 16     | 24         | 34     |
 * |----------|----------|--------|--------|------------|--------|
 * | (B+D)/2  | -680.8   | -682.5 | -657.3 | **-647.7** | -650.0 |
 * | Cuongxs1 | -710.2   | -707.3 | -691.4 | -694.5     | -698.1 |
 *
 * Both families improve by a wide margin — 33 LL points for (B+D)/2, 19 for Cuongxs1 — and both
 * put their optimum in the 16-24 band. 24 is (B+D)/2's best and within 3 points of Cuongxs1's, so
 * one number serves both. `BELT_SLOTS` is 30, so it reads as "pour again once the rail has been
 * quiet for about four fifths of a lap".
 *
 * ⚠ **The ranking as a whole does not crown a model, and must not be read as doing so.** `random`
 * came second and `slip0.80` first, which are not credible models of a player who wins 89% of
 * their games — the real winrate is nearly flat across these levels, so almost nothing separates
 * the candidates and the fitted slope collapses to 0.46. What is solid here is the **within-family**
 * comparison: same data, same candidates, one parameter changed. Pixel Flow's warning stands.
 *
 * ⚠ **Adopting this invalidates the ladder.** `LADDER`, `VARIANTS`, the `SHEET` check and the box
 * order search in `custom.ts` were all landed against settle 0. Retune before trusting any of them.
 */
export const SETTLE = Number(process.env.SETTLE ?? 24);

/**
 * Should this bot decline the turn and let the rail run?
 *
 * The rule is "pour the next tray once the last one has finished being eaten": hold while the belt
 * is still draining, give up once it has been flat for `settle` ticks. State lives in the caller so
 * one game cannot leak into the next.
 *
 * ⚠ **Only while waiting can still achieve something.** If nothing on the rail fits an open box,
 * waiting changes nothing and the bot must pour or the game deadlocks — Cuongxs1's note records a
 * bot sitting on level 9 for 28,000 ticks with one tray left and three free slots that were never
 * going to become nine. `hasPendingMatch` is the same guard, reused rather than rewritten.
 */
export function holdForBelt(g, st, settle) {
  const used = g.beltUsed();
  if (used < st.used) st.quiet = 0;
  else st.quiet++;
  st.used = used;
  if (settle <= 0) return false;
  if (!g.hasPendingMatch()) return false;
  return st.quiet < settle;
}

export function playCuongxs1(M, def, seed, keepLog = false, opt = {}) {
  const { discipline = true, blind = false, rollouts = 0, settle = SETTLE } = opt;
  const st = { used: 0, quiet: 0 };
  const rng = makeRng(seed);
  const g = new M.Game(def);
  const log = [];
  for (let ticks = 0; g.status === "play" && ticks < 60000; ticks++) {
    const hold = holdForBelt(g, st, settle);
    let open = [];
    if (!hold) for (let i = 0; i < g.tiles.length; i++) if (g.canTap(i)) open.push(i);

    // ⚠ Belt discipline, and the model had none — it tipped whenever the *chute* had room, which
    // is `greedy`'s behaviour, not a person's. Anyone watching the rail fill up stops. Adding it
    // is worth 6 points on average across the shipped levels and 27 on the worst of them.
    //
    // ⚠ But patience alone deadlocks, and that is measured too: a bot that simply refuses to tip
    // a tray the rail cannot hold sat on level 9 for 28,000 ticks with one tray left and three
    // free slots that were never going to become nine. So decline the turn **only while waiting
    // can still achieve something** — if nothing on the belt fits any open box, waiting changes
    // nothing and the tray goes anyway.
    if (discipline && g.hasPendingMatch()) {
      const room = open.filter((i) => g.beltFree() >= g.load(i));
      open = room;
    }

    if (open.length) {
      const avail = availableTrays(g);
      const probe = open.map((i) => mapGain(M, g, i, blind));
      const gains = probe.map((p) => p.gain);
      // Drop the suicidal moves — unless every move is suicidal, in which case the board is
      // already lost and refusing to move only changes how it is recorded.
      const safe = open.filter((_, k) => !probe[k].fatal);
      if (safe.length && safe.length < open.length) {
        const keep = open.map((_, k) => !probe[k].fatal);
        open = open.filter((_, k) => keep[k]);
        for (let k = gains.length - 1; k >= 0; k--) if (!keep[k]) gains.splice(k, 1);
      }
      const sum = (a) => a.reduce((x, y) => x + y, 0);
      let row = 0;
      let w = cuongxs1Weights(M, g, open, avail, gains, 0, blind);
      if (sum(w) <= 0) {
        row = 1;
        w = cuongxs1Weights(M, g, open, avail, gains, 1, blind);
      }
      const total = sum(w);
      let pick;
      if (total <= 0) {
        row = -1;
        pick = open[(rng() * open.length) | 0];
      } else {
        let r = rng() * total;
        pick = open[open.length - 1];
        for (let k = 0; k < open.length; k++) {
          r -= w[k];
          if (r <= 0) {
            pick = open[k];
            break;
          }
        }
      }
      // ⚠ Rollout lookahead: for each candidate, play the rest of the game out `rollouts` times
      // with the cheap policy and keep the tap that finished most often. This is the one thing a
      // person does that none of the other models do — they try a line in their head before
      // committing to it.
      //
      // ⚠ Ruinously expensive by comparison. Every decision costs `candidates × rollouts` whole
      // games, and a game has ~30 decisions, so one measured game is several hundred simulated
      // ones. Off by default; turn it on for a handful of levels, not for a sweep.
      if (rollouts > 0 && open.length > 1) {
        const snap = g.snapshot();
        let bestTap = pick;
        let bestScore = -1;
        for (const cand of open) {
          let wins = 0;
          for (let r = 0; r < rollouts; r++) {
            g.restore(snap);
            g.tap(cand);
            g.arriveAll();
            wins += rollout(M, g, rng, { discipline, blind }) ? 1 : 0;
          }
          if (wins > bestScore) {
            bestScore = wins;
            bestTap = cand;
          }
        }
        g.restore(snap);
        pick = bestTap;
      }

      if (keepLog) {
        log.push({
          tick: ticks,
          tap: pick,
          color: g.tiles[pick].color,
          belt: g.beltUsed(),
          // 0 = weighed against the open boxes, 1 = against the row behind them, -1 = uniform.
          row,
          choices: open.map((i, k) => ({
            tray: i,
            // Both halves of a linked pair — the trace is read to explain a choice, and one
            // colour would explain the wrong piece.
            color: coloursOf(g.tiles[i]).join("+"),
            weight: Number(w[k].toFixed(2)),
            p: total > 0 ? Number((w[k] / total).toFixed(3)) : 1 / open.length,
          })),
        });
      }
      g.tap(pick);
      g.arriveAll();
    }
    g.tick();
  }
  return { win: g.status === "won", peak: g.maxBelt, taps: g.taps, log };
}

/**
 * Play a position out to the end with the cheap policy. Used only by the rollout lookahead, which
 * needs a fast opinion about "does this line finish", not a good one.
 */
function rollout(M, g, rng, opt) {
  const st = { used: 0, quiet: 0 };
  for (let t = 0; g.status === "play" && t < 4000; t++) {
    const hold = holdForBelt(g, st, opt.settle ?? SETTLE);
    let open = [];
    if (!hold) for (let i = 0; i < g.tiles.length; i++) if (g.canTap(i)) open.push(i);
    if (opt.discipline && g.hasPendingMatch()) open = open.filter((i) => g.beltFree() >= g.load(i));
    if (open.length) {
      // No map-gain probe in here: it costs a snapshot per candidate and this runs thousands of
      // times. Weigh on demand alone.
      const avail = availableTrays(g);
      const supplyOf = avail.flatMap((k) => coloursOf(g.tiles[k]));
      const demand = (i, row) => {
        const cs = coloursOf(g.tiles[i]);
        let sum = 0;
        for (const c of cs) sum += demandBoxes(M, g, c, row, opt.blind) / (countOf(supplyOf, c) || 1);
        return sum / cs.length;
      };
      let w = open.map((i) => demand(i, 0));
      if (w.reduce((a, b) => a + b, 0) <= 0) w = open.map((i) => demand(i, 1));
      const tot = w.reduce((a, b) => a + b, 0);
      let p = open[(rng() * open.length) | 0];
      if (tot > 0) {
        let r = rng() * tot;
        for (let k = 0; k < open.length; k++) {
          r -= w[k];
          if (r <= 0) {
            p = open[k];
            break;
          }
        }
      }
      g.tap(p);
      g.arriveAll();
    }
    g.tick();
  }
  return g.status === "won";
}

/**
 * Replay the generator's own recorded winning line. This is the "perfect game" the model starts
 * from: a line that is known to clear the board, played by something that knows every hidden
 * colour — which is precisely what `refTaps` is.
 *
 * ⚠ It is *a* winning line, not a proven optimal one. Nothing here searches for a better one.
 */
export function playPerfect(M, def, keepLog = false) {
  const g = new M.Game(def);
  const log = [];
  for (const idx of def.refTaps) {
    let guard = 0;
    while (!g.canTap(idx) && g.status === "play" && guard++ < 20000) {
      g.arriveAll();
      g.tick();
    }
    if (g.status !== "play") break;
    if (keepLog) log.push({ tap: idx, color: g.tiles[idx].color, belt: g.beltUsed() });
    g.tap(idx);
    g.arriveAll();
  }
  let guard = 0;
  while (g.status === "play" && guard++ < 20000) {
    g.arriveAll();
    g.tick();
  }
  return { win: g.status === "won", peak: g.maxBelt, taps: g.taps, log };
}

/**
 * Method Cuongxs1's score for a board: one perfect game to establish the line exists, then `n`
 * sampled games, and **only the sampled games count**. The perfect game is a check, not a result
 * — folding it in would add a guaranteed win to every level and lift every score by 1/(n+1).
 */
export function cuongxs1Rate(M, def, n = 50, settle = SETTLE) {
  const perfect = playPerfect(M, def);
  let wins = 0;
  for (let s = 0; s < n; s++) if (playCuongxs1(M, def, seedFor(def.level, s), false, { settle }).win) wins++;
  return { perfect: perfect.win, rate: wins / n, games: n };
}

/**
 * Play one game.
 *
 *   greedy  — empties the tray a box is hungriest for, every chance it gets. No self-control.
 *   patient — same choice, but refuses to tip a tray the *rail* has no room for.
 *   random  — tips any legal tray. The careless player.
 *
 * Suffix `-open` swaps in the legacy scoring. `greedy` and `greedy-open` differ in nothing else,
 * so the pair measures that one idea and nothing more.
 *
 * `slip` is how often a thinking bot just taps something anyway; it interpolates greedy → random.
 */
export function play(M, def, mode, seed, slip = 0, settle = SETTLE) {
  const st = { used: 0, quiet: 0 };
  const rng = makeRng(seed);
  const g = new M.Game(def);
  const legacy = mode.endsWith("-open");
  const base = legacy ? mode.slice(0, -5) : mode;
  const score = SCORERS[legacy ? "open" : "net"];
  for (let ticks = 0; g.status === "play" && ticks < 60000; ticks++) {
    const hold = holdForBelt(g, st, settle);
    let open = [];
    if (!hold) for (let i = 0; i < g.tiles.length; i++) if (g.canTap(i)) open.push(i);
    if (base === "patient") open = open.filter((i) => g.beltFree() >= g.load(i));
    if (open.length) {
      let pick = open[(rng() * open.length) | 0];
      if (base !== "random" && rng() >= slip) {
        let best = -Infinity;
        for (const i of open) {
          // The jitter breaks ties randomly. Without it the bot is deterministic and reports
          // 0% or 100% and nothing in between, which says more about the bot than the level.
          const s = tileValue(M, g, i, score) + rng() * 0.5;
          if (s > best) {
            best = s;
            pick = i;
          }
        }
      }
      g.tap(pick);
      g.arriveAll();
    }
    g.tick();
  }
  return { win: g.status === "won", peak: g.maxBelt, taps: g.taps };
}

/** Seeds are a pure function of level and index, so any two tools measuring the same thing
 *  play the same games and can be compared directly. */
export const seedFor = (level, i) => level * 7919 + i * 104729 + 1;

export function rate(M, def, mode, n, slip = 0, settle = SETTLE) {
  let w = 0;
  for (let s = 0; s < n; s++) if (play(M, def, mode, seedFor(def.level, s), slip, settle).win) w++;
  return w / n;
}

/**
 * Best play: whichever bot we can write does best on this board.
 *
 * ⚠ Four entries, not two. The two scorings fail on different boards — `net` averages 95% across
 * the sheet but drops level 8 to 77%, where `open` still wins 100%, because on that board dumping
 * a colour no box can take is what frees the cells other trays need to escape. B is meant to be
 * the *ceiling*, so a strategy that wins a board belongs in the pool whatever its average.
 *
 * ⚠ Taking the max of four noisy estimates is optimistic by roughly the noise floor. At 150 games
 * that is about a point, which is inside the ±1.5 the measurement carries anyway; at 12 games it
 * would not be, so do not read a pooled B off a cheap run.
 */
export const best = (M, def, n, settle = SETTLE) =>
  Math.max(
    rate(M, def, "greedy", n, 0, settle),
    rate(M, def, "patient", n, 0, settle),
    rate(M, def, "greedy-open", n, 0, settle),
    rate(M, def, "patient-open", n, 0, settle),
  );

/**
 * The (B + D)/2 blend, after the shape Pixel Flow settled on. B is the optimistic model, D its
 * skill-slip Monte-Carlo — which ran at SKILL 0.75 there, so slip 0.25 here.
 *
 * ⚠ Returns the gap as well. A mean is only meaningful when the halves roughly agree: Pixel
 * Flow had a level read a plausible 58% that was the average of 98 and 48, a number neither
 * model believed. Callers must not quietly average that away.
 */
export const D_SLIP = Number(process.env.D_SLIP ?? 0.25);
export function bd(M, def, n, settle = SETTLE) {
  const b = best(M, def, n, settle);
  const d = rate(M, def, "greedy", n, D_SLIP, settle);
  return { b, d, raw: (b + d) / 2, gap: Math.abs(b - d) };
}

/**
 * How much of a difference is real: re-running one fixed configuration with only the seed
 * changed gives ±5 points at 12 games per level, ±2 at 30. A *separation* figure carries about
 * ±7 at 12. Anything smaller is noise.
 */
export const NOISE_AT_12 = 5;
export const noiseAt = (n) => Math.round(NOISE_AT_12 * Math.sqrt(12 / n));
