// Build for one host, and check the things a checklist would otherwise be trusted to remember.
//
//   node scripts/build-target.mjs crazy
//   node scripts/build-target.mjs web
//
// ⚠ A wrapper rather than `VITE_TARGET=crazy vite build` in package.json, because that form is
// shell syntax: it works in bash and is a syntax error in cmd.exe, which is what `npm run` uses
// on Windows by default. The check at the end is the point — the four hard limits and the
// platform split are cheap to verify and expensive to discover at the upload screen.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TARGET = process.argv[2] ?? "web";
if (!["web", "crazy", "android"].includes(TARGET)) {
  console.error(`target "${TARGET}" khong hop le — chon web | crazy | android`);
  process.exit(1);
}

const run = (cmd, args) =>
  execFileSync(cmd, args, { cwd: ROOT, stdio: "inherit", shell: true, env: { ...process.env, VITE_TARGET: TARGET } });

rmSync(join(ROOT, "dist"), { recursive: true, force: true });
run("npx", ["tsc", "--noEmit"]);
run("npx", ["vite", "build"]);

// ── Checks ───────────────────────────────────────────────────────────────────

const DIST = join(ROOT, "dist");

// ⚠ **`stats.html` is dropped from every build.** It lives in `public/` so Firebase Hosting serves
// it — that is the only reason it is there — and Vite copies `public/` verbatim, so without this it
// rides into the upload. It is an internal dashboard behind a Google sign-in, and a reviewer
// finding it is the same mistake as shipping the level editor. Removed *before* the file list is
// taken, so the counts below describe what actually gets uploaded.
//
// ⚠ Deleted rather than declared a problem: it will be there after **every** build, so failing on
// it would mean a build that never passes, and a check that always fails gets ignored.
rmSync(join(DIST, "stats.html"), { force: true });

const files = [];
(function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else files.push(p);
  }
})(DIST);

const bytes = files.reduce((a, f) => a + statSync(f).size, 0);
const mb = (n) => (n / 1024 / 1024).toFixed(2) + " MB";
const html = readFileSync(join(DIST, "index.html"), "utf8");
// Absolute paths break inside the host's iframe — `base: "./"` should make this impossible, but
// a hand-written tag in index.html would slip past it.
const absolute = html.match(/(?:src|href)="\/[^"]*"/g) ?? [];

const problems = [];
if (files.length > 1500) problems.push(`${files.length} file — tran la 1500`);
if (bytes > 250 * 1024 * 1024) problems.push(`${mb(bytes)} — tran la 250 MB`);
if (absolute.length) problems.push(`co duong dan tuyet doi: ${absolute.join(" ")}`);

// ⚠ The platform split, proved rather than assumed. A `web` build carrying one line of the host
// SDK would be a compliance failure on the store it *is* meant for, and the whole reason the
// door is an alias instead of a runtime `if`.
//
// ⚠ **`privacy.html` is exempt, and only it.** The policy page names CrazyGames as a data
// processor and links to their own policy — that is prose a privacy notice is *supposed* to
// carry, in every build, and it is not a line of anyone's SDK. Scanning for the brand string
// caught it and failed the web build, which would have pushed the fix towards deleting the
// processor's name from a legal document to satisfy a build script. The guard is about code
// entering the bundle; keep it pointed at code.
const sdkHits = files.filter(
  (f) => !f.endsWith("privacy.html") && readFileSync(f, "utf8").includes("crazygames"),
).length;
if (TARGET === "crazy" && sdkHits === 0) problems.push("ban crazy khong co SDK CrazyGames nao");
if (TARGET !== "crazy" && sdkHits > 0) problems.push(`ban ${TARGET} con ${sdkHits} file nhac toi crazygames`);

// The local iframe harness must never reach a reviewer.
if (existsSync(join(DIST, "iframe-test.html"))) problems.push("iframe-test.html lot vao dist");
if (TARGET === "crazy" && existsSync(join(DIST, "editor.html"))) problems.push("editor.html lot vao ban crazy");

console.log("");
console.log(`Ban "${TARGET}": ${files.length} file · ${mb(bytes)}`);
console.log(bytes <= 20 * 1024 * 1024 ? "  ✓ duoi 20 MB — du dieu kien len trang chu ban mobile" : "  ⚠ tren 20 MB — mat suat trang chu mobile");
console.log(absolute.length ? "  ⚠ co duong dan tuyet doi" : "  ✓ duong dan tuong doi");
console.log(`  ${TARGET === "crazy" ? "✓ co" : "✓ khong co"} SDK CrazyGames (${sdkHits} file)`);

if (problems.length) {
  console.log("");
  for (const p of problems) console.log(`  ✗ ${p}`);
  process.exit(1);
}
