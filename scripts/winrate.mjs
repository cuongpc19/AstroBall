// winrate — what a PERSON is likely to score, not what a bot scores.
//
// Why this file exists, and why sim.mjs is not enough:
//
// The sibling Pixel Flow project scored five different bot models against 67 real games over
// 21 levels. **Not one of them beat guessing a single constant.** Log-likelihood: constant
// -46.4, then E -48.6, D -54.3, A -57.0, B -74.2, C -84.9. A bot winrate is a measurement of
// the bot, and quoting it as if it predicted player behaviour is simply wrong.
//
// What did work there: two models biased in *opposite* directions, averaged, then bent through
// a logistic curve fitted on real games — LL -39.4, leave-one-out cross-validated. The fitted
// slope came out near 1.0, so the whole correction was a constant offset in logit space: the
// bots were about 0.66 logit more optimistic than people.
//
// ⚠ WHICH MODEL THIS PROJECT WILL USE IS NOT DECIDED, and must not be decided by argument.
// Pixel Flow's own note: "I once asserted B was the most accurate; wrong, full analysis put B
// 4th of 5." The candidates are in MODELS below; `--models` ranks them on real games and only
// then does one become official. Until that has run, this refuses to call anything a winrate.
//
//   node scripts/winrate.mjs 20-40     -> per-level bot scores, beside any real games
//   node scripts/winrate.mjs --models  -> rank every candidate (log-likelihood + leave-one-out)
//   SLIP=0.3 MODEL=slip0.3 node scripts/winrate.mjs 20-40   -> report through one model
//
// Real games come from the game itself: Settings -> COPY N GAMES, pasted into playlog.jsonl.

import { readFileSync, existsSync } from "node:fs";
import { loadGame, rate as botRate, best as botBest, bd, cuongxs1Rate, noiseAt, D_SLIP } from "./bots.mjs";

const M = await loadGame();
// ⚠ **`levelDefFor`, never the generator.** 205 of the levels a player can reach are hand-built,
// so scoring the generated board measures one nobody plays — and every real game is then thrown
// away on a fingerprint that could never match. This file's whole job is ranking models against
// real games, and it was scoring the wrong board at all four sites: `--fit` and `--models` had
// never seen a single real game.
const { levelDefFor, levelFingerprint } = M;

// ── the calibration ─────────────────────────────────────────────────────────
// ⚠ ONE definition, used by every consumer. Pixel Flow learned this the hard way: coefficients
// copied into two files drift apart and the tuner ends up optimising a curve the report is not
// showing. Refit with --models after each playtest and use the values it prints.

/** Fitted on 0 real games so far — an identity, i.e. "we have no idea yet, and we say so". */
export const A_CAL = Number(process.env.A_CAL ?? 0);
export const B_CAL = Number(process.env.B_CAL ?? 1);
/** Which model the report speaks through. Unset = none chosen, and it says so loudly. */
export const OFFICIAL = process.env.MODEL || null;
/** Real games needed before a ranking means anything. */
const MIN_GAMES = 40;

const clamp01 = (p) => Math.min(0.97, Math.max(0.03, p));
const logit = (p) => Math.log(clamp01(p) / (1 - clamp01(p)));
const sigmoid = (z) => 1 / (1 + Math.exp(-z));
export const calibrate = (raw) => sigmoid(A_CAL + B_CAL * logit(raw));

// ── models ──────────────────────────────────────────────────────────────────
// All of these come from scripts/bots.mjs. ⚠ Do not inline a copy here: sim.mjs and this file
// each grew their own and drifted until they disagreed by 38 points on the same measurement.

/**
 * The candidates. `slip` is the interesting family: greedy, but tapping at random with
 * probability p. p = 0 is perfect play, p = 1 is careless, and a person sits between — so if
 * any single model works, it is probably one of these.
 */
/**
 * ⚠ **The `s<N>` suffix is how long the rail must go quiet before the bot pours again.** Without
 * it every model here plays at maximum pour rate on a machine whose only way to lose is congestion
 * — see `holdForBelt` in bots.mjs. It is scanned rather than chosen, for the same reason `slip` is:
 * this file exists so the data picks the model, and Pixel Flow's note is that arguing about which
 * model is right produced a confidently stated wrong answer.
 */
export const SETTLE_SCAN = [0, 8, 16, 24, 34];
export const MODELS = {
  greedy: (def, n) => botRate(M, def, "greedy", n),
  patient: (def, n) => botRate(M, def, "patient", n),
  random: (def, n) => botRate(M, def, "random", n),
  best: (def, n) => botBest(M, def, n),
  bd: (def, n) => bd(M, def, n).raw,
};
for (const st of SETTLE_SCAN) {
  if (st) MODELS[`bd_s${st}`] = (def, n) => bd(M, def, n, st).raw;
  MODELS[`cx_s${st}`] = (def, n) => cuongxs1Rate(M, def, Math.min(n, 30), st).rate;
}

export const SLIP_SCAN = Array.from({ length: 19 }, (_, i) => i * 0.05);
export const slipModel = (p) => (def, n) => botRate(M, def, "greedy", n, p);
if (process.env.SLIP != null) {
  MODELS[`slip${process.env.SLIP}`] = slipModel(Number(process.env.SLIP));
}
export const bdParts = (def, n) => bd(M, def, n);

// ── real games ──────────────────────────────────────────────────────────────

/**
 * Read playlog.jsonl, keeping only games whose fingerprint matches the board the generator
 * builds *today*. A level's content changes every time the curve is retuned, and counting a
 * game played on last week's board is fitting to a level that no longer exists.
 */
function realGames(want) {
  const out = {};
  if (!existsSync("playlog.jsonl")) return out;
  let stale = 0;
  let noSig = 0;
  let boosted = 0;
  for (const line of readFileSync("playlog.jsonl", "utf8").trim().split(/\r?\n/)) {
    let r;
    try {
      r = JSON.parse(line);
    } catch {
      continue;
    }
    if (!r || r.lvl == null || (r.result !== "win" && r.result !== "lose")) continue;
    if (process.env.STALE !== "1") {
      if (r.sig == null) {
        noSig++;
        continue;
      }
      const sig = want(r.lvl);
      if (sig && r.sig !== sig) {
        stale++;
        continue;
      }
    }
    // The bots have no boosters and no undo, so a win bought with coins is not a game they
    // could ever have played. PURE=1 drops those rather than letting them flatter the model.
    if (process.env.PURE === "1" && Array.isArray(r.used) && r.used.length) {
      boosted++;
      continue;
    }
    out[r.lvl] = out[r.lvl] || [0, 0];
    out[r.lvl][1]++;
    if (r.result === "win") out[r.lvl][0]++;
  }
  if (boosted) console.error(`(bo ${boosted} van co dung booster — PURE=1)`);
  if (stale || noSig) {
    console.error(`(bo ${noSig} van khong co van tay + ${stale} van tren ban cu — STALE=1 de dem het)`);
  }
  return out;
}

const sigOf = (lvl) => {
  try {
    return levelFingerprint(levelDefFor(lvl));
  } catch {
    return null;
  }
};

// ── ranking the candidates ──────────────────────────────────────────────────

function llOf(keys, R, pred) {
  return keys.reduce((acc, k) => {
    const [w, n] = R[k];
    const p = Math.min(0.999, Math.max(0.001, pred(k)));
    return acc + w * Math.log(p) + (n - w) * Math.log(1 - p);
  }, 0);
}

/** Gradient ascent on the Bernoulli log-likelihood. Two parameters; nothing fancier needed. */
function fitCurve(keys, R, X) {
  let a = 0;
  let b = 1;
  for (let it = 0; it < 120000; it++) {
    let ga = 0;
    let gb = 0;
    for (const k of keys) {
      const [w, n] = R[k];
      const x = logit(X[k]);
      const p = sigmoid(a + b * x);
      ga += w - n * p;
      gb += (w - n * p) * x;
    }
    a += (0.005 * ga) / keys.length;
    b += (0.005 * gb) / keys.length;
  }
  return [a, b];
}

if (process.argv.includes("--models") || process.argv.includes("--fit")) {
  const N = Number(process.env.N || 120);
  const R = realGames(sigOf);
  // ⚠ **Two filters, and the ranking is meaningless without either.**
  //
  // A level with one or two games contributes a 0%/100% point, and the curve fit chases it — the
  // exact mistake Pixel Flow's note warns about, arriving through the back door as sample size.
  //
  // And levels past the hand-built ladder are not levels. `HANDMADE` stops, `levelDefFor` falls
  // through to the generator, and the generator hands out a **nine-tray board at every level** — one
  // player ran 206 to 372 winning all 130 games in nine taps each. Leaving those in makes "predict
  // high everywhere" the winning model, on 167 boards nobody designed.
  const MIN_PER_LEVEL = Number(process.env.MINLV || 8);
  const TOP = Math.max(...Object.keys(M.HANDMADE).map(Number));
  const all = Object.keys(R).map(Number).sort((a, b) => a - b);
  const levels = all.filter((k) => k <= TOP && R[k][1] >= MIN_PER_LEVEL);
  const dropped = all.length - levels.length;
  if (dropped) {
    console.log(
      `(bo ${all.filter((k) => k > TOP).length} level ngoai bac thang dung tay (>${TOP}) ` +
        `+ ${all.filter((k) => k <= TOP && R[k][1] < MIN_PER_LEVEL).length} level duoi ${MIN_PER_LEVEL} van — MINLV de doi)`,
    );
  }
  const games = levels.reduce((a, k) => a + R[k][1], 0);

  if (games < MIN_GAMES || levels.length < 5) {
    console.log(
      [
        `Moi co ${games} van tren ${levels.length} level.`,
        `Can >= ${MIN_GAMES} van / >= 5 level moi xep hang duoc mo hinh.`,
        "",
        "Choi roi vao Settings -> COPY N GAMES, dan vao playlog.jsonl.",
        "Khong co van that thi KHONG cach nao biet mo hinh nao dung — va doan thi dung la",
        "sai lam ma Pixel Flow da tra gia de hoc.",
      ].join("\n"),
    );
    process.exit(0);
  }

  const base = levels.reduce((a, k) => a + R[k][0], 0) / games;
  const llConst = llOf(levels, R, () => base);
  console.log(`Xep hang tren ${games} van / ${levels.length} level (N=${N} van bot moi level)`);
  console.log(`  chuan de so — doan bua ${(base * 100).toFixed(0)}%: LL ${llConst.toFixed(1)}`);
  console.log("");
  console.log("mo hinh     | LL tho  | LL da nan (leave-one-out) | hon doan bua?");

  // Candidates: the fixed models, plus the whole slip family so p is chosen by the data.
  const candidates = Object.entries(MODELS).concat(
    SLIP_SCAN.map((p) => [`slip${p.toFixed(2)}`, slipModel(p)]),
  );

  const rows = [];
  const defs = {};
  for (const k of levels) defs[k] = levelDefFor(k);
  for (const [name, model] of candidates) {
    const X = {};
    for (const k of levels) X[k] = model(defs[k], N);
    const llRaw = llOf(levels, R, (k) => X[k]);
    // Leave-one-out, so a model cannot be praised on the data it was fitted to.
    let loo = 0;
    for (const k of levels) {
      const [a, b] = fitCurve(
        levels.filter((j) => j !== k),
        R,
        X,
      );
      loo += llOf([k], R, (j) => sigmoid(a + b * logit(X[j])));
    }
    const [a, b] = fitCurve(levels, R, X);
    rows.push({ name, llRaw, loo, a, b });
  }
  rows.sort((p, q) => q.loo - p.loo);
  // A 19-point slip scan would bury the fixed models in the listing; show the best few of each.
  const shown = rows.filter((r) => !r.name.startsWith("slip")).concat(
    rows.filter((r) => r.name.startsWith("slip")).slice(0, 4),
  );
  shown.sort((p, q) => q.loo - p.loo);
  for (const r of shown) {
    console.log(
      `${r.name.padEnd(12)}| ${r.llRaw.toFixed(1).padStart(7)} | ${r.loo.toFixed(1).padStart(24)} | ` +
        (r.loo > llConst ? "CO" : "khong"),
    );
  }

  const win = rows[0];
  console.log("");
  if (win.loo > llConst) {
    console.log(`✓ Mo hinh tot nhat: ${win.name}. Dung no bang:`);
    const slipP = win.name.startsWith("slip") ? win.name.slice(4) : null;
    console.log(
      (slipP ? `    SLIP=${slipP} MODEL=slip${slipP} ` : `    MODEL=${win.name} `) +
        `A_CAL=${win.a.toFixed(4)} B_CAL=${win.b.toFixed(4)} npm run winrate`,
    );
    console.log("");
    console.log("  Nho: hon doan bua chua chac da la TOT — xem khoang cach LL co dang ke khong.");
  } else {
    console.log(`✗ KHONG mo hinh nao thang duoc doan bua mot hang so (${(base * 100).toFixed(0)}%).`);
    console.log("  Dung chon mo hinh nao ca, va dung bao cao diem bot nhu winrate nguoi choi.");
    console.log("  Day dung la ket qua Pixel Flow gap voi ca 5 mo hinh dau tien cua no.");
  }
  process.exit(0);
}

// ── --build: generate a run of levels and grade them ────────────────────────

if (process.argv.includes("--build")) {
  const arg = process.argv[process.argv.indexOf("--build") + 1];
  const upto = Number(arg && !arg.startsWith("--") ? arg : 20);
  const N = Number(process.env.N || 60);
  const R = realGames(sigOf);

  console.log(`Build ${upto} level — cham bang (B + D)/2, B = choi tot nhat, D = slip ${D_SLIP}`);
  console.log(`  Nhieu o N=${N}: +-${noiseAt(N)} diem. Nan: ${A_CAL === 0 && B_CAL === 1 ? "CHUA (dang la don vi)" : `${A_CAL.toFixed(3)}/${B_CAL.toFixed(3)}`}`);
  console.log("");
  console.log("lv | dang     | tap x2 ?  |   B |   D | (B+D)/2 | lech | van that");

  let flagged = 0;
  for (let n = 1; n <= upto; n++) {
    const t0 = Date.now();
    const def = levelDefFor(n);
    const ms = Date.now() - t0;
    const { b, d, raw, gap } = bdParts(def, N);
    const wide = def.tiles.filter((t) => t && t.wide).length;
    const hid = def.tiles.filter((t) => t && t.hidden).length;
    // A wide gap means the mean is a number neither half believes — flag, do not average away.
    const warn = gap > 0.35 ? " <- B/D CAI NHAU" : "";
    if (gap > 0.35) flagged++;
    console.log(
      `L${String(n).padEnd(2)}| ${String(def.shape ?? "").padEnd(9)}| ${String(def.refTaps.length).padStart(3)} ${String(wide).padStart(2)} ${String(hid).padStart(2)}  |` +
        ` ${String(Math.round(b * 100)).padStart(3)}% | ${String(Math.round(d * 100)).padStart(3)}% |` +
        `   ${String(Math.round(calibrate(raw) * 100)).padStart(3)}%  | ${String(Math.round(gap * 100)).padStart(3)}% |` +
        ` ${(R[n] ? `${Math.round((100 * R[n][0]) / R[n][1])}% (${R[n][0]}/${R[n][1]})` : "-")}${warn}  ${ms}ms`,
    );
  }
  console.log("");
  console.log(
    flagged
      ? `⚠ ${flagged}/${upto} level co B va D cai nhau > 35 diem — o do con so trung binh KHONG co nghia.`
      : `✓ B va D dong thuan tren ca ${upto} level (lech <= 35 diem).`,
  );
  console.log("⚠ Cot (B+D)/2 CHUA duoc hieu chuan tren nguoi that, nen no van la diem bot.");
  process.exit(0);
}

// ── report ──────────────────────────────────────────────────────────────────

const spec = process.argv[2] || "20-40";
const nums = spec.includes("-")
  ? (() => {
      const [x, y] = spec.split("-").map(Number);
      const r = [];
      for (let i = x; i <= y; i++) r.push(i);
      return r;
    })()
  : spec.split(",").map(Number);

const RN = Number(process.env.N || 60);
const R = realGames(sigOf);

if (!OFFICIAL) {
  console.log("⚠ CHUA CHON MO HINH. Cac cot duoi la DIEM BOT, khong phai winrate nguoi choi.");
  console.log("  Chay --models sau khi co van that de bo so lieu tu chon.");
  console.log(`  Nhieu o N=${RN}: khoang +-${noiseAt(RN)} diem — chenh nho hon the la nhieu.`);
  console.log("");
} else {
  console.log(`Winrate du doan qua mo hinh "${OFFICIAL}" (nan ${A_CAL.toFixed(3)}/${B_CAL.toFixed(3)})`);
  console.log("");
}

// Default view: the two extremes plus whatever slip was pinned, so the spread is visible.
const cols = OFFICIAL
  ? [OFFICIAL]
  : ["best", ...Object.keys(MODELS).filter((k) => k.startsWith("slip")), "random"];
for (const c of cols) {
  if (!MODELS[c]) {
    console.error(`Khong co mo hinh "${c}". Co: ${Object.keys(MODELS).join(", ")}`);
    process.exit(1);
  }
}
console.log(`lv   | ${cols.map((c) => c.padStart(7)).join(" |")} |${OFFICIAL ? " du doan |" : ""} van that`);
const pct = (r) => (r ? `${Math.round((100 * r[0]) / r[1])}% (${r[0]}/${r[1]})` : "-");
for (const n of nums) {
  const def = levelDefFor(n);
  const vals = cols.map((c) => MODELS[c](def, RN));
  const shown = OFFICIAL ? `  ${String(Math.round(calibrate(vals[0]) * 100)).padStart(3)}%   |` : "";
  console.log(
    `L${String(n).padEnd(4)}| ${vals.map((v) => `${String(Math.round(v * 100)).padStart(6)}%`).join(" |")} |${shown} ${pct(R[n])}`,
  );
}
