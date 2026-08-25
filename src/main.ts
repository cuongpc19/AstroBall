import Phaser from "phaser";
import { platform } from "./platform";
import { GameScene, GAME_W, GAME_H } from "./scenes/GameScene";
import { HomeScene } from "./scenes/HomeScene";
import { SAVE_KEYS } from "./game/save";

// Warm the game font before Phaser draws any canvas text — a canvas texture baked
// with a font that has not finished loading keeps the fallback shape forever.
try {
  document.fonts?.load('32px "Lilita One"');
} catch {
  /* no Font Loading API — the font still swaps in when ready */
}

/**
 * Wipe saved progress: `?reset=1`. The only way to start over on a phone, where there is no
 * DevTools console — and the way this project resets between playtests.
 *
 * ⚠ **It must run after `platform.init()`, and it did not.** As a top-level IIFE it ran before the
 * CrazyGames SDK had loaded, so `sdk` was still null inside `platform.storage.removeItem` and the
 * host branch was a silent no-op — `localStorage` was cleared and the host store was not. `getItem`
 * reads the **host store first**, so every value came straight back and the reset appeared to do
 * nothing. Reported as "k được" on a build where it demonstrably worked with seeded local keys,
 * because seeding by hand writes only the local store and never reproduces it. Progress earned by
 * *playing* goes through `save.ts` into both.
 *
 * ⚠ **Clear `SAVE_KEYS`, not the keys `localStorage` happens to hold.** A player arriving on a new
 * device has their cloud save in the host store and nothing local at all, so the enumeration finds
 * nothing to delete.
 *
 * ⚠ Nothing may read progress before this, which is the same rule `platform.init()` already has —
 * `save` is all getters, and the Phaser game does not exist yet when this runs.
 */
function applyReset() {
  try {
    const p = new URLSearchParams(location.search);
    if (!p.get("reset")) return;
    const keys = new Set<string>(SAVE_KEYS);
    for (const k of Object.keys(localStorage)) if (k.startsWith("bf_")) keys.add(k);
    for (const k of keys) {
      localStorage.removeItem(k);
      platform.storage.removeItem(k);
    }
    p.delete("reset");
    const qs = p.toString();
    history.replaceState(null, "", location.pathname + (qs ? "?" + qs : "") + location.hash);
  } catch {
    /* storage unavailable */
  }
}

// ⚠ **No dev wallet float.** A dev build used to top the wallet up to 1000 at boot, and that made
// the economy unreadable from the machine it is being tuned on: 1000 coins is twenty revives, while
// a real new player starts on **nothing** and earns `WIN_COINS` = 20 a level. To exercise a booster
// now, grant the coins deliberately in the console —
// `localStorage.setItem('bf_coins','200'); location.reload()` — so the grant is visible instead of
// standing silently behind every dev session.
//
// ⚠ **Nothing reads progress before `platform.init()` resolves.** The host preloads the player's
// cloud save *during* init, so an early read hands back the local copy — and the next write then
// pushes that stale copy over their real save. Awaiting here, before the Phaser game exists at
// all, means there is no loading-screen cap to race: the HTML boot poster stays up until this
// resolves, and `crazy.ts` owns a 2.5s timeout so an adblocked SDK cannot hang it.
//
// ⚠ Wrapped in an async function rather than a top-level `await`: the build targets browsers back
// to Chrome 87, where top-level await does not exist, and raising the target to reach it would
// drop older phones for one keyword.
async function boot() {
  await platform.init();
  applyReset();
  platform.loadingStart();

  // Render at the device pixel ratio so the baked textures stay crisp, capped at 2 —
  // a 3x canvas is 2.25x the fragments per frame for no visible gain on a 2D game.
  const DPR = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: "game",
    width: Math.round(GAME_W * DPR),
    height: Math.round(GAME_H * DPR),
    // ⚠ **The same violet as the page and as `#boot`, and it must stay that way.** This is the
    // colour the canvas is cleared to every frame, under everything the scenes draw — so it is
    // what shows through any pixel of canvas nothing has covered yet. It said "#b3ddf5" from the
    // day the project was scaffolded off Beads Out: a pale sky blue, i.e. the one near-white in
    // the whole stack, sitting where a hairline down the edge of the canvas would pick it up.
    // Nobody ever saw it on purpose, because the boot poster covers the canvas until a scene is
    // up, which is exactly why it survived. Matching it to the page costs nothing and means a
    // pixel that goes uncovered is invisible instead of white.
    backgroundColor: "#2f2c63",
    render: { powerPreference: "low-power" },
    // Marbles tumble down the chute on real physics — that fall is the whole tactile pay-off
    // of a tap, and hand-animating it would never pile up the same way twice. Full gravity:
    // the drop out of the tray is meant to be quick. Only the last stretch is slowed, and
    // GameScene does that per-body once a marble enters the cone.
    physics: {
      default: "matter",
      matter: { gravity: { x: 0, y: 1.05 }, enableSleeping: false, debug: false },
    },
    // Hard-cap at 60: on a 120Hz phone Phaser would otherwise render twice as often
    // as the game is designed for, doubling heat for nothing. The host requires the game to
    // behave the same on a 120Hz phone as on a 60Hz one, and this is how that is met.
    fps: { target: 60, limit: 60 },
    // FIT scales the fixed-size canvas to whatever the host frame is while keeping the ratio,
    // which is the whole of the 800x450 -> 1920x1080 requirement: both are 16:9.
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [HomeScene, GameScene],
  });

  // Straight into a board, skipping the home screen. ?custom=1 plays the editor's scratch slot;
  // ?level=N plays that level exactly as a player would get it, hand-built board and all. The
  // editor opens these in a new tab, so going back to the drawing is just switching tabs.
  try {
    const q = new URLSearchParams(location.search);
    const custom = !!q.get("custom");
    const preview = !!q.get("preview");
    const level = Number(q.get("level")) || 0;
    if (custom || level) {
      game.events.once("ready", () => {
        game.scene.stop("Home");
        game.scene.start("Game", { level: level || 1, custom, preview });
      });
    }
  } catch {
    /* no URL API — fall through to the normal boot */
  }

  game.events.once("ready", () => platform.loadingStop());

  // Dev-only handle so a headless browser / the console can poke at scene state.
  // ⚠ `scripts/shot.mjs` waits on this to know the game has booted — removing it breaks every
  // screenshot and every `--belt` assertion.
  if (import.meta.env.DEV) (window as any).__game = game;
}

void boot();
