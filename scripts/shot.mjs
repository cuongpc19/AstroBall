// Drive the real game in a headless browser and bring back a screenshot plus whatever the
// console said. This is the other half of the measurement story: scripts/sim.mjs proves the
// rules, this proves the machine actually draws and does not throw.
//
// It talks raw CDP over Node's built-in WebSocket, so there is no Playwright/Puppeteer
// download to keep working — just a Chromium already on the machine.
//
//   node scripts/shot.mjs                       # boot, screenshot the home screen
//   node scripts/shot.mjs --level 7 --taps 6    # start level 7, tap 6 trays, screenshot
//   node scripts/shot.mjs --level 3 --auto      # play level 3 to the end with the hint order
//   node scripts/shot.mjs --page editor.html    # any other page; skips the Phaser boot wait
//
// Output lands in scripts/.shots/.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, ".shots");
// Not 9222: on Windows some vendor helper apps (Lenovo Vantage, for one) already hold
// that port with their own embedded browser, and CDP would attach to that instead.
const PORT = Number(process.env.MS_CDP_PORT ?? 9333);
// ⚠ The trailing slash is not cosmetic: every use below is `URL_BASE + page`, so an MS_URL
// given without one builds "http://localhost:5173editor.html", which the browser cannot navigate
// to — it stays on whatever page was already open and the run screenshots the wrong thing while
// reporting success.
const URL_BASE = (process.env.MS_URL ?? "http://localhost:5173/").replace(/\/?$/, "/");

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return dflt;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : true;
};

const BROWSERS = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cdpTargets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  return res.json();
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.waiting = new Map();
    this.logs = [];
    ws.addEventListener("message", (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && this.waiting.has(msg.id)) {
        this.waiting.get(msg.id)(msg);
        this.waiting.delete(msg.id);
      }
      if (msg.method === "Runtime.consoleAPICalled") {
        this.logs.push(
          `[${msg.params.type}] ` + msg.params.args.map((a) => a.value ?? a.description).join(" "),
        );
      }
      if (msg.method === "Runtime.exceptionThrown") {
        const d = msg.params.exceptionDetails;
        this.logs.push(`[error] ${d.exception?.description ?? d.text}`);
      }
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve) => {
      this.waiting.set(id, resolve);
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /** Evaluate in the page and return the JSON value. */
  async eval(expr) {
    const r = await this.send("Runtime.evaluate", {
      expression: `JSON.stringify((()=>{${expr}})())`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.result?.exceptionDetails) {
      throw new Error(r.result.exceptionDetails.exception?.description ?? "eval failed");
    }
    const v = r.result?.result?.value;
    return v == null ? null : JSON.parse(v);
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const exe = BROWSERS.find((p) => existsSync(p));
  if (!exe) throw new Error("no Chromium-based browser found");

  // Browser frame, `WxH`. Default is the phone box the art was designed against.
  const SIZE = (arg("size", "540x1160") + "").replace("x", ",");
  const DPR = Number(arg("dpr", 1)) || 1;
  const profile = join(OUT, "profile"); // gitignored; reused so Chrome starts warm
  const child = spawn(
    exe,
    [
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      "--headless=new",
      "--no-first-run",
      "--disable-gpu",
      // ⚠ `--size 1280x720` is the only way to see the desktop layout. `GAME_H` flexes with the
      // frame's aspect ratio (see config.ts), and at the default phone shape it is clamped to 1160
      // — so every screenshot taken here exercises the *phone* build and says nothing whatever
      // about how the game looks in a 16:9 iframe, which is every frame the host uses.
      `--window-size=${SIZE}`,
      // ⚠ `--dpr 2` is the second axis, and it is not cosmetic. `GameScene.root` is scaled by the
      // device pixel ratio, so anything that has to agree with the game's own transform — a mask, a
      // hit test built in screen space, a value read back off the canvas — is right by coincidence
      // at DPR 1 and wrong everywhere else. This browser is DPR 1 by default, which is why a build
      // whose box well was empty on a phone passed every screenshot taken here. Shoot the layout at
      // 1 and anything that touches a transform at 2.
      ...(DPR === 1 ? [] : [`--force-device-scale-factor=${DPR}`]),
      "--hide-scrollbars",
      URL_BASE,
    ],
    { stdio: "ignore", detached: false },
  );

  // A managed Windows browser can open its own tabs on first run, so pick the tab actually
  // pointed at the dev server rather than whichever one happens to be first.
  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(250);
    try {
      const pages = (await cdpTargets()).filter((t) => t.type === "page");
      target = pages.find((t) => t.url.startsWith(URL_BASE)) ?? pages.find((t) => t.url === "about:blank") ?? null;
    } catch {
      /* browser still starting */
    }
  }
  if (!target) throw new Error("browser never opened a usable page");

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  const cdp = new Cdp(ws);
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  // A plain page (the level editor) has no Phaser in it, so there is no `__game` to wait on
  // and none of the level driving below applies — navigate, settle, shoot, done.
  const page = arg("page", "");
  if (page && page !== true) {
    await cdp.send("Page.navigate", { url: URL_BASE + page });
    // ⚠ 2s is enough for a static page and not for one that boots Phaser — an iframe harness shows
    // the boot poster and the shot then "succeeds" on a picture of the loading screen. --wait is
    // how you pay for a page that has real work to do before it is worth photographing.
    await sleep(Number(arg("wait", 2000)) || 2000);
    // --js runs before the shot, so a page that boots from storage can be given something to
    // show. It reloads afterwards, because storage is read once at start-up.
    const js = arg("js", "");
    if (js && js !== true) {
      await cdp.eval(String(js) + "; return 1;");
      await cdp.send("Page.reload");
      await sleep(2000);
    }
    // --then runs on the reloaded page, for state that lives in the DOM rather than storage
    // (a selection, an open panel) and so cannot be seeded before boot.
    const then = arg("then", "");
    if (then && then !== true) {
      await cdp.eval(String(then) + "; return 1;");
      // Long enough for a tween or a debounced redraw the snippet kicked off to finish — a
      // probe that reads mid-animation measures the animation, not the result.
      await sleep(1400);
    }
    const r = await cdp.send("Page.captureScreenshot", { format: "png" });
    const file = join(OUT, `page-${String(page).replace(/[^\w.-]+/g, "_")}.png`);
    writeFileSync(file, Buffer.from(r.result.data, "base64"));
    console.log(cdp.logs.join("\n") || "console clean ✓");
    console.log("shots:\n" + file);
    await shutdown(cdp, ws, child);
    return;
  }

  if (!target.url.startsWith(URL_BASE)) {
    await cdp.send("Page.navigate", { url: URL_BASE });
    await sleep(1500);
  }

  // Wait for the Phaser game to boot.
  let ready = false;
  for (let i = 0; i < 80 && !ready; i++) {
    await sleep(250);
    ready = await cdp.eval("return !!window.__game && window.__game.isRunning");
  }
  if (!ready) {
    console.log(cdp.logs.join("\n"));
    throw new Error("game never booted — is `npm run dev` running?");
  }

  const level = Number(arg("level", 0));
  const shots = [];

  const snap = async (name) => {
    const r = await cdp.send("Page.captureScreenshot", { format: "png" });
    const file = join(OUT, `${name}.png`);
    writeFileSync(file, Buffer.from(r.result.data, "base64"));
    shots.push(file);
  };

  await sleep(900); // let the HTML boot splash finish fading out
  await snap("00-home");

  if (level) {
    await cdp.eval(
      `window.__game.scene.stop("Home"); window.__game.scene.start("Game", { level: ${level} }); return 1;`,
    );
    await sleep(1200);
    await snap(`01-level${level}`);

    const taps = arg("auto", false) ? 999 : Number(arg("taps", 0));
    for (let n = 0; n < taps; n++) {
      const ok = await cdp.eval(`
        const ms = window.__ms; if (!ms) return null;
        const s = ms.state(); if (s.status !== "play") return { done: s.status };
        const i = ms.hint(); if (i < 0) return { wait: 1 };
        ms.tap(i); return { tapped: i };
      `);
      if (ok?.done) {
        await sleep(600);
        await snap(`03-${ok.done}`);
        break;
      }
      await sleep(ok?.wait ? 900 : 1400);
    }
    if (taps && !shots.some((s) => s.includes("03-"))) await snap("02-mid");

    if (arg("pause", false)) {
      await cdp.eval(`window.__ms.scene.openSettings(); return 1;`);
      await sleep(400);
      await snap("06-pause");
    }

    // Dump whatever real games the browser has accumulated, so a headless run can prove the
    // play log is actually being written rather than silently swallowed.
    if (arg("log", false)) {
      const runs = await cdp.eval(`return JSON.parse(localStorage.getItem("ms_runs") || "[]");`);
      console.log(`playlog → ${runs.length} van`);
      for (const r of runs.slice(-4)) {
        console.log(`  L${r.lvl} sig=${r.sig} ${r.result} ${r.taps} tap dinh ${r.peak}/${r.belt} ${r.stars}*`);
      }
    }

    // Fire the celebration effects on demand — they are over in half a second, so catching
    // them by chance during a playthrough is hopeless.
    if (arg("fx", false)) {
      await cdp.eval(`const s = window.__ms.scene;
        s.seatFx(s.holePos(0, 1).x, s.holePos(0, 1).y, 3, 2);
        s.popBox(2, 5);
        return 1;`);
      await sleep(150);
      await snap("05-fx");
    }

    // `--eval "<js>"`: run a snippet against the live game and print what it returns.
    //
    // ⚠ The general form the bespoke flags below are special cases of. Each of those exists because
    // it needs several evals with waits in between; a one-shot probe does not, and adding a flag
    // per question is how a tool ends up with twenty of them. `window.__ms` is the door.
    const ev = arg("eval", "");
    if (ev && ev !== true) {
      // ⚠ Not through `cdp.eval`. That helper wraps the body in `JSON.stringify(...)`, so a snippet
      // returning a promise is stringified as `{}` before anything can await it — and `{}` looks
      // like a probe that ran and found nothing rather than one that never ran. Anything that has
      // to wait a frame (a scene restart, a tween) is exactly what this flag is for, so it takes
      // the raw path and awaits properly.
      const r = await cdp.send("Runtime.evaluate", {
        expression: `(async () => { ${ev} })()`,
        awaitPromise: true,
        returnByValue: true,
      });
      const err = r.result?.exceptionDetails?.exception?.description;
      console.log("eval → " + (err ?? JSON.stringify(r.result?.result?.value, null, 1)));
      // A snippet is almost always run to *change* something on screen, so shoot what it left.
      await snap("13-eval");
    }

    // The revive offer. Its card animates on a two-second loop, so one still frame cannot show
    // it — take one early and one mid-flight, then buy it and shoot the board it hands back.
    //
    // ⚠ `__ms.jam()` stuffs the rail to *draw* the offer; supply no longer matches demand on a
    // board it has touched, so this proves the card renders and nothing about the rules. The
    // arithmetic is checked headlessly against real jams instead.
    if (arg("jam", false)) {
      // Top the wallet up first: the profile is reused between runs, so a few runs in a row would
      // otherwise leave the browser too poor to buy the thing under test and the flag would go
      // quietly green having shot the refusal instead.
      const plan = await cdp.eval(`
        localStorage.setItem("ms_coins", "999");
        return window.__ms.jam() ? window.__ms.revivePlan() : null;`);
      console.log("revive plan → " + JSON.stringify(plan));
      await sleep(450);
      await snap("07-revive");
      await sleep(900);
      await snap("08-revive-fly");
      await cdp.eval(`window.__ms.takeRevive(); return 1;`);
      await sleep(1400);
      await snap("09-revived");
      console.log("after revive → " + JSON.stringify(await cdp.eval("return window.__ms.state().belt.filter(Boolean).length;")));
    }

    // The level-1 walkthrough and its idle nudge. ⚠ Timed UI: the nudge is five seconds of the
    // player doing nothing, which is precisely the thing a normal `--taps` run never reproduces
    // and precisely the failure mode of a timer that was wired up wrong — it does nothing, and
    // nothing looks the same as not being there.
    if (arg("tutor", false)) {
      await cdp.eval(`localStorage.removeItem("bf_tutor"); window.__ms.goto(1); return 1;`);
      await sleep(1600);
      await snap("10-tutor-step1");
      // ⚠ Read the tutorial object, NOT `coachLayer()` — that method *builds* a fresh container
      // every call, so probing through it returns an empty one and reports the feature missing.
      const marks = () => cdp.eval(`
        const t = window.__ms.scene.tutorial;
        if (!t) return null;
        return { step: t.at, done: t.done, caption: t.label ? t.label.text : null,
                 hand: !!t.hand, ring: !!t.ring, idleArmed: !!t.idle };`);
      console.log("tutor step 1 → " + JSON.stringify(await marks()));
      await cdp.eval(`window.__ms.tap(window.__ms.hint()); return 1;`);
      // The four captions run about 7.6s between them; watch the last one clear.
      await sleep(9500);
      await snap("11-tutor-done");
      console.log("after captions → " + JSON.stringify(await marks()));
      // ...then sit perfectly still for the five seconds the nudge is waiting on.
      await sleep(5800);
      await snap("12-tutor-nudge");
      console.log("after 5s idle → " + JSON.stringify(await marks()));
    }

    // The belt tread has to travel with the marbles, and no still frame can show that.
    if (arg("belt", false)) {
      const sample = () =>
        cdp.eval(`const s = window.__ms.scene;
          return { cleat: s.cleatSprites[0].x, marble: s.beltTravel };`);
      const a = await sample();
      await sleep(400);
      const b = await sample();
      console.log(
        `belt → cleat x ${a.cleat.toFixed(1)} → ${b.cleat.toFixed(1)}, ` +
          `travel ${a.marble.toFixed(1)} → ${b.marble.toFixed(1)} ` +
          (a.cleat !== b.cleat && a.marble !== b.marble ? "✓ moving" : "✗ STATIC"),
      );
    }

    // Smoke-test every interactive path that a bot playthrough never touches.
    if (arg("exercise", false)) {
      const trace = await cdp.eval(`
        const ms = window.__ms, sc = ms.scene, out = [];
        const before = ms.state();
        sc.onBooster("magnet");  out.push("magnet:" + JSON.stringify(sc.board.magnet));
        sc.onBooster("wrench");  sc.onTapColumn(0); out.push("wrench:armed=" + sc.wrenchArmed);
        sc.onBooster("undo");    out.push("undo:" + (ms.state().remaining !== before.remaining));
        sc.openSettings();       out.push("settings:paused=" + sc.paused);
        return out;
      `);
      console.log("exercise → " + JSON.stringify(trace));
      await sleep(400);
      await snap("04-exercise");
    }
    console.log(JSON.stringify(await cdp.eval("return window.__ms.state();"), null, 1).slice(0, 900));
  }

  const errors = cdp.logs.filter((l) => l.startsWith("[error]") || l.startsWith("[warning]"));
  console.log(errors.length ? "\nCONSOLE:\n" + errors.join("\n") : "\nconsole clean ✓");
  console.log("\nshots:\n" + shots.join("\n"));

  await shutdown(cdp, ws, child);
}

/**
 * Shut down *our* browser and nothing else.
 *
 * ⚠ Never reach for `taskkill /IM chrome.exe` here. It matches by image name, so it kills
 * every Chrome on the machine — including whatever the person at the keyboard had open.
 * `Browser.close` targets the one instance this script attached to; the PID-scoped taskkill
 * is only a fallback, because on Windows Chrome's launcher process usually exits straight
 * away and `child.kill()` then reaps nothing, leaving the real browser holding the profile.
 */
async function shutdown(cdp, ws, child) {
  try {
    await Promise.race([cdp.send("Browser.close"), sleep(3000)]);
  } catch {
    /* browser already gone */
  }
  try {
    ws.close();
  } catch {
    /* socket already closed */
  }
  if (child?.pid && !child.killed) {
    try {
      if (process.platform === "win32") {
        spawn("taskkill", ["/F", "/T", "/PID", String(child.pid)], { stdio: "ignore" });
      } else {
        child.kill();
      }
    } catch {
      /* nothing left to kill */
    }
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

// A crash between launch and shutdown used to strand the browser, which is what made it
// tempting to clean up with a blunt kill-by-name. Close it on the way out instead.
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => process.exit(1));
}
