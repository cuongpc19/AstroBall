// CrazyGames. Loaded only by the `crazy` build — see `index.ts`.
//
// ⚠ **Everything here has to survive the SDK never arriving.** An adblocker that blocks
// `crazygames-sdk-v3.js` does not fire `onerror` on the script tag, so waiting on it without a
// timeout parks that whole class of player on the loading screen forever. `init()` owns a
// timeout and resolves either way; every method below no-ops when `sdk` is null.

import { localStore, type Platform, type PlatformStorage } from "./base";

/**
 * ⚠ Must stay **below** whatever cap the boot screen uses, and `main.ts` awaits this before it
 * creates the Phaser game — so there is no cap to race. If a timed splash is ever added, this
 * number has to stay under it: the host preloads the player's cloud save during `init()`, and a
 * splash that gives up first opens the game on local data, whose next write overwrites the
 * player's real save with it.
 */
const INIT_TIMEOUT_MS = 2500;

/**
 * Their script. **Loaded from here, at runtime — never from a tag in `index.html`.**
 *
 * ⚠ A classic `<script src>` in `<head>` blocks the HTML parser, and the game bundle is
 * `type="module"` and therefore deferred: deferred scripts run only after parsing finishes. So a
 * slow answer from this host stopped the parser, the parser stopped the module, and the game never
 * started however completely it had downloaded — no error, every capability present, just no
 * canvas. Reproduced by holding the request open over CDP: nothing at 14s, against 3s when it was
 * let through. An element created here cannot do that, because the document finished parsing long
 * before this code runs.
 *
 * ⚠ The platform hosts the file and forbids bundling it, so it has to stay a network fetch of
 * their URL. This is the same shape the sibling Pixel Flow project has always used.
 */
const SDK_URL = "https://sdk.crazygames.com/crazygames-sdk-v3.js";

/**
 * Budget for fetching the script alone, inside the overall `INIT_TIMEOUT_MS`.
 *
 * ⚠ Needed **on top of** `onerror`, not instead of it: an adblocked request can hang without ever
 * firing either handler, and `init()` is awaited before the Phaser game exists. Pixel Flow measured
 * this fetch from Vietnam on 2026-08-08 at 7.9s cold and 1.0-1.4s warm — so a cold, uncached player
 * will genuinely lose the SDK here. That is the trade taken deliberately: a session without cloud
 * save is a degraded session, a session that never boots is a lost player.
 */
const LOAD_TIMEOUT_MS = 2000;

/**
 * Put their script in the page and resolve when it is there — or when it is clearly not coming.
 *
 * Resolves `true`/`false` rather than throwing; nothing above needs to know which.
 */
function loadSdkScript(): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    try {
      // Already there — a host page that preloads it, or a second call.
      if ((window as unknown as { CrazyGames?: unknown }).CrazyGames) return done(true);
      const el = document.createElement("script");
      el.src = SDK_URL;
      el.async = true;
      el.onload = () => done(true);
      el.onerror = () => done(false);
      document.head.appendChild(el);
      setTimeout(() => done(false), LOAD_TIMEOUT_MS);
    } catch {
      done(false);
    }
  });
}

type Sdk = {
  init(): Promise<void>;
  game: {
    loadingStart(): void;
    loadingStop(): void;
    gameplayStart(): void;
    gameplayStop(): void;
    happytime(): void;
    /** Host settings. `muteAudio` true means silence the game. */
    settings?: { muteAudio?: boolean };
    addSettingsChangeListener?(cb: (s: { muteAudio?: boolean }) => void): void;
  };
  data: { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void };
  user: { systemInfo?: { locale?: string; countryCode?: string } };
  ad?: unknown;
};

let sdk: Sdk | null = null;
let muted = false;
let mutedSeeded = false;
const muteListeners: ((m: boolean) => void)[] = [];

/**
 * Seed the mute flag from `?muteAudio=true`.
 *
 * ⚠ **This is the flag their QA tests with**, and without it the game only ever goes quiet when
 * a live SDK says so — which is exactly the case a reviewer loading the URL by hand does not
 * have. It also makes the path exercisable locally, where the SDK never completes a handshake.
 *
 * ⚠ Read **lazily, on first use**, never at module load. A top-level side effect here is what
 * stops a bundler dropping this file from the web build — the sibling project hit that twice in
 * one day and only caught it by grepping the finished bundle.
 */
function seedMuted() {
  if (mutedSeeded) return;
  mutedSeeded = true;
  try {
    muted = new URLSearchParams(location.search).get("muteAudio") === "true";
  } catch {
    /* no location — leave it off */
  }
}

function setMuted(v: boolean) {
  mutedSeeded = true; // an explicit value from the SDK outranks the query param
  if (v === muted) return;
  muted = v;
  for (const cb of muteListeners) {
    try {
      cb(v);
    } catch {
      /* one bad listener must not stop the others */
    }
  }
}

/**
 * Write to **both** stores, read the host's first.
 *
 * ⚠ Writing to both is not belt and braces. A session where the SDK is unavailable must still
 * leave a *fresh* local copy; writing only to the host leaves the local one frozen at whenever
 * the SDK last worked, and that stale copy is what the next offline session shows the player.
 */
const dualStore: PlatformStorage = {
  getItem(key) {
    if (sdk) {
      try {
        const v = sdk.data.getItem(key);
        if (v != null) return v;
      } catch {
        /* fall through to local */
      }
    }
    return localStore.getItem(key);
  },
  setItem(key, value) {
    localStore.setItem(key, value);
    try {
      sdk?.data.setItem(key, value);
    } catch {
      /* host storage unavailable — the local write already happened */
    }
  },
  removeItem(key) {
    localStore.removeItem(key);
    try {
      sdk?.data.removeItem(key);
    } catch {
      /* as above */
    }
  },
};

/**
 * Whether the host has muted us.
 *
 * ⚠ Read **live from the SDK**, with the listener only as a mirror. `SDK.game.settings.muteAudio`
 * is the truth; a locally cached flag is one missed callback away from playing sound over a page
 * the player silenced. Test it with `?muteAudio=true` on the URL, which the host honours.
 */
function readMute() {
  seedMuted();
  try {
    const live = sdk?.game.settings?.muteAudio;
    if (typeof live === "boolean") return live;
  } catch {
    /* settings not exposed on this SDK build — fall back to the seeded/listener value */
  }
  return muted;
}

export const platform: Platform = {
  name: "crazy",

  async init() {
    const start = Date.now();
    // ⚠ Fetch first, then poll. The poll below still exists because `onload` firing does not mean
    // `window.CrazyGames.SDK` is assigned yet on every build of their script, and because a host
    // page may have loaded it already — in which case `loadSdkScript` returns immediately and the
    // poll finds it on its first tick.
    await loadSdkScript();
    const found = await new Promise<Sdk | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), INIT_TIMEOUT_MS);
      const tick = () => {
        const s = (window as unknown as { CrazyGames?: { SDK?: Sdk } }).CrazyGames?.SDK;
        if (s) {
          clearTimeout(timer);
          resolve(s);
        } else if (Date.now() - start < INIT_TIMEOUT_MS) {
          setTimeout(tick, 60);
        }
      };
      tick();
    });
    if (!found) return;
    try {
      // ⚠ `init()` is async and must be awaited before anything else is touched — including the
      // first storage read, because this is where the player's cloud save is preloaded.
      await Promise.race([
        found.init(),
        new Promise<void>((r) => setTimeout(r, Math.max(0, INIT_TIMEOUT_MS - (Date.now() - start)))),
      ]);
      sdk = found;
    } catch {
      sdk = null;
    }
    // ⚠ `addSettingsChangeListener`, not a window event. There is no `wgVolumeChange` — that was
    // a guess, and a wrong one: with it the game would have reported "not muted" forever while
    // happily playing over a page the player had silenced, and the submission form's "supports
    // CrazyGames muting audio through SDK" box would have been a false declaration.
    try {
      setMuted(!!sdk?.game.settings?.muteAudio);
      sdk?.game.addSettingsChangeListener?.((next) => setMuted(!!next?.muteAudio));
    } catch {
      /* older SDK without settings — the in-game toggle stays the only control */
    }
  },

  storage: dualStore,

  loadingStart() {
    try {
      sdk?.game.loadingStart();
    } catch {}
  },
  loadingStop() {
    try {
      sdk?.game.loadingStop();
    } catch {}
  },
  gameplayStart() {
    try {
      sdk?.game.gameplayStart();
    } catch {}
  },
  gameplayStop() {
    try {
      sdk?.game.gameplayStop();
    } catch {}
  },
  happytime() {
    try {
      sdk?.game.happytime();
    } catch {}
  },

  preferredLang() {
    // ⚠ English is mandatory and is the fallback, never Vietnamese. The UI is already English
    // throughout — the bundled Lilita One is a Latin-only subset with no Vietnamese glyphs — so
    // this exists for the day a second language is added.
    // ⚠ `locale`, not `countryCode`. The country someone is sitting in is not the language they
    // read, and the sibling project reads `systemInfo.locale` for exactly this.
    try {
      const l = sdk?.user.systemInfo?.locale;
      return l ? String(l).toLowerCase() : null;
    } catch {
      return null;
    }
  },

  hostMuted: readMute,
  onHostMuteChange(cb) {
    muteListeners.push(cb);
  },
};
