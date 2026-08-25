// Pull real games back from Firebase into playlog.jsonl.
//
//   node scripts/pull-runs.mjs            # show the tally, write nothing
//   node scripts/pull-runs.mjs --write    # merge into playlog.jsonl, skipping duplicates
//   node scripts/pull-runs.mjs --all      # count test games too (default hides localhost)
//
// Why it exists: `npm run winrate -- --fit` refuses to hand over calibration coefficients that
// cannot beat guessing a constant, and it can only be run on games played by people. This is the
// only path those games have from a stranger's browser to this machine.
//
// ⚠ The RTDB rules close reads to **everyone** (see `database.rules.json`), deliberately — the
// database URL is visible in the game bundle, so an open read is a public download of the log.
// There is no read account and no uid in the rules, because nothing reads from a browser. Two
// ways in, both of which bypass the rules as project owner:
//
//   1. **The Firebase CLI** (default). Already logged in on this machine, and `.firebaserc` pins
//      the project, so there is nothing to configure and no secret to leak. Slower — it shells
//      out — but that cost is paid once per pull.
//   2. `FB_SECRET=<secret> node scripts/pull-runs.mjs` — a legacy database secret, from
//      Firebase console → ⚙ Project settings → Service accounts → Database secrets. Faster, and
//      the only route if the CLI is not around. ⚠ Never commit it: it is full admin on the
//      database, and Google has been retiring these, so do not build anything on it.
//
// The sibling project's rules DO carry a uid — because it also has a `stats.html` that reads
// `/runs` from a browser after a Google sign-in, and that needs an allow-list of exactly one
// account. There is no such page here. Add one and the uid comes back with it.
import fs from "node:fs";
import { spawnSync } from "node:child_process";

/**
 * The database root, no trailing slash. **Only needed for the `FB_SECRET` route** — the CLI reads
 * the instance from `.firebaserc`.
 *
 * ⚠ If set, it must match `ENDPOINT` in `src/game/telemetry.ts` minus the `/runs.json`.
 */
const DB = "https://ball-flow-d1d9a-default-rtdb.asia-southeast1.firebasedatabase.app";
const OUT = "playlog.jsonl";
const TMP = "scripts/.runs.json";
const WRITE = process.argv.includes("--write");
const ALL = process.argv.includes("--all");
const SECRET = process.env.FB_SECRET;

/** Read `/runs` through the CLI, which authenticates as the logged-in owner. */
function readViaCli() {
  // ⚠ Spawned from Node, not from a shell. Under Git Bash a bare `/runs` argument is rewritten
  // into a Windows path (`C:/Program Files/Git/runs`) before the CLI ever sees it, and the read
  // then fails on a path that does not exist.
  const r = spawnSync("npx", ["-y", "firebase-tools", "database:get", "/runs", "-o", TMP], {
    encoding: "utf8",
    shell: true,
  });
  if (r.status !== 0) {
    // ⚠ Print BOTH streams. The CLI puts its real diagnosis on stdout and leaves stderr empty, so
    // reporting stderr alone turns "no database instance exists" into a blank line and sends you
    // hunting for a login problem you do not have.
    const said = [r.stdout, r.stderr].map((s) => (s || "").trim()).filter(Boolean).join("\n");
    console.error(said || "firebase-tools that bai, khong noi ly do");
    console.error("\nChua tao database? Xem ANALYTICS.md muc 1. Chua dang nhap? npx firebase-tools login");
    process.exit(1);
  }
  const txt = fs.readFileSync(TMP, "utf8");
  fs.unlinkSync(TMP);
  return JSON.parse(txt);
}

let raw;
if (SECRET) {
  if (!DB) {
    console.error("Dat DB o dau file nay de dung FB_SECRET, hoac bo FB_SECRET di de dung CLI.");
    process.exit(1);
  }
  const res = await fetch(`${DB}/runs.json?auth=${encodeURIComponent(SECRET)}`);
  if (!res.ok) {
    console.error(`Doc that bai: HTTP ${res.status} ${res.statusText}`);
    process.exit(1);
  }
  raw = await res.json();
} else {
  raw = readViaCli();
}
if (!raw) {
  console.log("Chua co van nao.");
  process.exit(0);
}

// RTDB returns { "<push-id>": {…} } — keep the push id as the de-duplication key.
const all = Object.entries(raw).map(([id, v]) => ({ id, ...v }));
// ⚠ Two kinds of row. A start row is written when the player reaches the board and has no result,
// so counting it as a game halves every winrate here. Rows from builds before start-logging carry
// no `ev` at all — those are ends, and reading a missing field as "start" would throw away the
// entire history instead.
// ⚠ Ends are **named**, not inferred. `ev !== "start"` was correct while there were two kinds of
// row; the day a third arrived (`ev: "daily"`, a claimed login reward) it silently became "anything
// that is not a start is a played level", which files every claim as a game with no result.
const rows = all.filter((r) => r.ev === "end" || r.ev === undefined);
const starts = all.filter((r) => r.ev === "start");
const claims = all.filter((r) => r.ev === "daily");
// A start whose `run` never came back as an end is someone who walked away mid-level. Only starts
// carrying a `run` can be judged: the id is what pairs the two, and a start from an older build
// has none.
const ended = new Set(rows.map((r) => r.run).filter(Boolean));
const quit = starts.filter((r) => r.run && !ended.has(r.run)).length;
console.log(`Tai ve ${rows.length} van` + (starts.length ? `, ${starts.length} luot vao man (${quit} bo giua chung).` : "."));
if (claims.length) {
  const who = new Set(claims.map((r) => r.dev)).size;
  const coins = claims.reduce((a, r) => a + (r.coins || 0), 0);
  console.log(`Thuong dang nhap: ${claims.length} lan nhan boi ${who} nguoi, ${coins} xu.`);
}

const isTest = (r) => /^localhost$|^127\.|^192\.168\.|^\[::1\]$/.test(r.from ?? "");
const scored = ALL ? rows : rows.filter((r) => !isTest(r));

const byHost = {};
const byLevel = {};
for (const r of rows) byHost[`${r.host ?? "?"}@${r.from ?? "?"}`] = (byHost[`${r.host ?? "?"}@${r.from ?? "?"}`] ?? 0) + 1;
for (const r of scored) {
  const b = (byLevel[r.lvl ?? "?"] = byLevel[r.lvl ?? "?"] ?? { n: 0, win: 0, sigs: new Set() });
  b.n++;
  if (r.result === "win") b.win++;
  if (r.sig) b.sigs.add(r.sig);
}
console.log("Theo nguon:", Object.entries(byHost).map(([k, v]) => `${k}=${v}`).join("  "));
if (!ALL) console.log(`Bo ${rows.length - scored.length} van test (them --all de dem ca).`);

// ⚠ gtag.js blocked vs code broken — the one bit that separates them. See analytics.ts.
const withGa = rows.filter((r) => r.ga !== undefined);
if (withGa.length) {
  const ok = withGa.filter((r) => r.ga === 1).length;
  console.log(`gtag.js toi noi: ${ok}/${withGa.length} van` + (ok === 0 ? "  ← bi chan, khong phai loi code" : ""));
}

const levels = Object.keys(byLevel).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
console.log("\nlv  | van | thang | winrate THAT");
for (const lv of levels) {
  const b = byLevel[lv];
  // ⚠ More than one fingerprint under one level number means the board was rebuilt mid-sample.
  // Averaging across that is fitting to a level nobody can play any more — the exact mistake the
  // fingerprint exists to catch.
  const notes = [b.n < 5 ? "(qua it van)" : "", b.sigs.size > 1 ? `⚠ ${b.sigs.size} ban level khac nhau` : ""]
    .filter(Boolean)
    .join(" ");
  console.log(
    `L${String(lv).padEnd(3)}| ${String(b.n).padStart(3)} | ${String(b.win).padStart(5)} | ` +
      `${String(Math.round((100 * b.win) / b.n)).padStart(3)}%  ${notes}`,
  );
}

if (!WRITE) {
  console.log("\n(xem thoi — them --write de gop vao playlog.jsonl)");
  process.exit(0);
}

const seen = new Set();
if (fs.existsSync(OUT)) {
  for (const line of fs.readFileSync(OUT, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line);
      if (o._fb) seen.add(o._fb);
    } catch {
      /* broken line — ignore */
    }
  }
}
const out = [];
for (const r of rows) {
  if (seen.has(r.id)) continue;
  const { id, ...rest } = r;
  out.push(JSON.stringify({ ...rest, _fb: id })); // _fb = the de-duplication key
}
if (out.length) fs.appendFileSync(OUT, out.join("\n") + "\n");
console.log(`\nDa them ${out.length} van moi vao ${OUT} (bo qua ${rows.length - out.length} van da co).`);
console.log("Buoc tiep: PURE=1 npm run winrate -- --fit");
