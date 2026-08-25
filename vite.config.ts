import { defineConfig } from "vite";
import { appendFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const root = fileURLToPath(new URL(".", import.meta.url));

// Build stamp derived from git so it bumps itself every commit (no manual edits).
// Falls back to package.json when git isn't available (e.g. a stripped tarball).
function buildVersion(): { version: string; build: string } {
  try {
    const count = execSync("git rev-list --count HEAD", { cwd: root }).toString().trim();
    const hash = execSync("git rev-parse --short HEAD", { cwd: root }).toString().trim();
    return { version: `0.0.${count}`, build: hash };
  } catch {
    try {
      const pkg = JSON.parse(readFileSync(root + "package.json", "utf8"));
      return { version: String(pkg.version ?? "0.0.0"), build: "local" };
    } catch {
      return { version: "0.0.0", build: "local" };
    }
  }
}
const VERSION = buildVersion();

/**
 * Dev-only sink for the play log: the game POSTs its finished games here and they land in
 * `playlog.jsonl` next to the source.
 *
 * ⚠ It exists because the clipboard route does not work where the playtesting happens.
 * `navigator.clipboard` is only defined in a secure context, and a phone on the LAN reaches the
 * dev server over plain `http://192.168.x.x` — which is not one. The `execCommand` fallback is
 * deprecated on mobile and fails too, so "COPY N GAMES" simply reported failure and there was no
 * way off the device at all.
 *
 * ⚠ Dev server only. A static build (Pages, Capacitor) has nothing to post to, so the game must
 * keep the clipboard path working as well — never make this the only route off a device.
 *
 * ⚠ It writes to disk and the dev server listens on the LAN, so it is deliberately narrow:
 * append only, never read or delete, one shape of object, and a hard cap on the body. On a café
 * network anyone could still fill the file with junk; the fingerprint check downstream discards
 * anything that does not match a real board, and `npm run dev` is not meant to be public.
 */
const NEWLINE = new RegExp("\r?\n");

function playlogSink() {
  const FILE = root + "playlog.jsonl";
  const MAX = 256 * 1024;
  const ok = (r: unknown): boolean => {
    const x = r as Record<string, unknown>;
    return (
      !!x &&
      typeof x.lvl === "number" &&
      typeof x.sig === "string" &&
      typeof x.ts === "number" &&
      (x.result === "win" || x.result === "lose") &&
      Array.isArray(x.used)
    );
  };
  return {
    name: "playlog-sink",
    configureServer(server: { middlewares: { use: (p: string, h: unknown) => void } }) {
      server.middlewares.use("/__playlog", (req: any, res: any) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          return res.end("POST only");
        }
        let body = "";
        req.on("data", (c: Buffer) => {
          body += c;
          if (body.length > MAX) req.destroy();
        });
        req.on("end", () => {
          let rows: unknown[];
          try {
            rows = String(body)
              .trim()
              .split(NEWLINE)
              .filter(Boolean)
              .map((l) => JSON.parse(l));
          } catch {
            res.statusCode = 400;
            return res.end("bad jsonl");
          }
          const good = rows.filter(ok);
          if (!good.length) {
            res.statusCode = 400;
            return res.end("no runs");
          }
          // Skip anything already on disk, so pressing the button twice is harmless.
          let seen = new Set<number>();
          try {
            seen = new Set(
              readFileSync(FILE, "utf8").trim().split(NEWLINE).filter(Boolean)
                .map((l) => (JSON.parse(l) as { ts: number }).ts),
            );
          } catch {
            /* first run */
          }
          const fresh = good.filter((r) => !seen.has((r as { ts: number }).ts));
          if (fresh.length) {
            const LF = String.fromCharCode(10);
            appendFileSync(FILE, fresh.map((r) => JSON.stringify(r)).join(LF) + LF);
          }
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ added: fresh.length, skipped: good.length - fresh.length }));
        });
      });
    },
  };
}

/**
 * Which host this build is for: `web` (self-hosted, the default), `crazy` (CrazyGames) or
 * `android` (Capacitor, later).
 *
 * ⚠ **One codebase, one build flag — no fork, no second folder.** And the split is at the
 * *bundler*, not at runtime: CrazyGames bans third-party ad networks outright, so a runtime
 * switch that keeps another store's SDK in the same bundle is a compliance failure however
 * carefully the branch is guarded.
 */
const TARGET = process.env.VITE_TARGET ?? "web";
if (!["web", "crazy", "android"].includes(TARGET)) {
  throw new Error(`VITE_TARGET="${TARGET}" khong hop le — chon web | crazy | android`);
}

/**
 * Where the CrazyGames SDK tag used to be put into `index.html`. **It is not put there any more.**
 *
 * ⚠ It is still a real `<script src>` on their domain — the platform hosts the file and forbids
 * bundling it — but `crazy.ts` now creates that element itself at runtime, the way the sibling
 * Pixel Flow project has always done it.
 *
 * What leaving it in the HTML cost: a classic `<script src>` in `<head>` blocks the HTML parser,
 * and the game bundle is `type="module"` and therefore deferred — deferred scripts run only once
 * parsing has finished. A slow answer from `sdk.crazygames.com` stopped the parser, the parser
 * stopped the module, and the game never started however completely it had downloaded. Reproduced
 * by holding that one request open over CDP: no canvas at 14s, against 3s when it was let through.
 * That is the failure the boot watchdog kept reporting from CrazyGames QA — every capability
 * present, no error caught, no canvas.
 *
 * `async` fixed the blocking. Injecting from script removes the whole class of failure, because an
 * element created by JavaScript cannot block a parser that finished long ago. Pixel Flow measured
 * the request from Vietnam on 2026-08-08 at **7.9s cold** (1.2s of it DNS), 1.0-1.4s warm — which
 * is what makes this a real risk rather than a theoretical one.
 *
 * ⚠ `build-target.mjs` still requires the crazy bundle to mention `crazygames`, and it still does:
 * the URL now lives in the bundled `crazy.ts` instead of in `index.html`. Do not relax that check
 * on the grounds that the tag is gone.
 *
 * ⚠ **`async`, and this is load-bearing.** Without it the tag is a classic parser-blocking script
 * in `<head>`, while the game bundle is `type="module"` and therefore deferred — deferred scripts
 * run only once the document has finished parsing. So a slow or hanging request to
 * `sdk.crazygames.com` stops the parser, the parser stops the module, and the game never starts
 * however completely it has downloaded. Reproduced with CDP holding that one request open: canvas
 * still absent at 14s, against 3s when the request is allowed through.
 *
 * That is exactly the failure the boot watchdog reported from CrazyGames QA — every capability
 * present, no error caught, no canvas — and it is intermittent because it depends entirely on how
 * fast a third-party host answers.
 *
 * ⚠ `defer` does **not** fix it: deferred scripts execute in document order, so a hanging SDK
 * still holds the module behind it. Only `async` decouples them.
 *
 * ⚠ The cost, stated plainly: `async` means the SDK may in principle arrive after `crazy.ts` has
 * given up polling (2.5s), and that session then runs with no SDK — no cloud save, no ads, no
 * gameplay signal. In practice it starts downloading when the parser reaches this tag, long before
 * the 1.6 MB bundle has finished, so it wins that race with room to spare. Losing the SDK for one
 * session is a degraded session; blocking on it is a dead game.
 */
function crazySdkTag() {
  return {
    name: "crazy-sdk-tag",
    transformIndexHtml(html: string) {
      // ⚠ A deliberate no-op, kept and kept wired up so that anyone going looking for "where does
      // the SDK tag come from" lands on the reason above rather than on an absence.
      return html;
    },
  };
}

// base: "./" keeps asset paths relative — required so the same build works on the
// web, inside the Capacitor wrapper (file://) and inside the CrazyGames iframe.
export default defineConfig({
  base: "./",
  plugins: [playlogSink(), crazySdkTag()],
  resolve: {
    alias: {
      // The platform door. Aliasing rather than branching keeps the unselected implementation
      // out of the module graph entirely, so `grep -rc crazygames dist/` is a real proof.
      "virtual:platform": root + `src/platform/${TARGET === "crazy" ? "crazy" : "none"}.ts`,
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(VERSION.version),
    __APP_BUILD__: JSON.stringify(VERSION.build),
    __TARGET__: JSON.stringify(TARGET),
  },
  server: {
    host: true,
    port: 5173,
    // Cloudflare Quick Tunnel URLs, so the game is playable on a phone off-network.
    allowedHosts: [".trycloudflare.com"],
  },
  build: {
    outDir: "dist",
    assetsInlineLimit: 0,
    // The editor is a second page rather than a scene: it is almost entirely form controls,
    // and every one of those is free in HTML and hand-built in canvas.
    rollupOptions: {
      // ⚠ The editor is a **dev tool** and is dropped from the `crazy` build. It is a second
      // page with its own bundle, a "play this level" link and a localStorage scratch slot —
      // shipping it to a reviewer is the same mistake as leaving a test harness in `dist/`,
      // and it spends payload on something no player can reach from the game.
      input:
        TARGET === "crazy"
          ? { main: root + "index.html" }
          : { main: root + "index.html", editor: root + "editor.html" },
    },
  },
});
