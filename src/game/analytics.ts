// Google Analytics 4 — only for the "who is playing, from where, for how long" dashboard in the
// Firebase console. **Not** for winrate: that lives in the Realtime Database (`telemetry.ts`),
// because GA samples, lags 24-48 hours in its reports, and will not hand back individual games.
//
// ⚠ **Do not use the Firebase SDK for this.** `firebase-app` + `firebase-analytics` is ~31 KB
// gzipped **into the bundle**, and at runtime they still fetch `gtag.js` (145 KB) anyway — paying
// twice for one thing. Calling gtag.js directly adds **zero bytes** to the bundle and reports to
// the same GA4 property, because it is the same measurement id. Time-to-gameplay is a metric
// CrazyGames grades on, so 31 KB is not a rounding error here.
//
// ⚠ **`gtag` must be a real `function`, pushing `arguments`.** This is the defect that made the
// sibling project's first analytics build send **nothing at all**: gtag.js only processes
// `dataLayer` entries that are `arguments` objects. A real array is treated as a GTM-style push
// and **ignored in silence** — no error, no warning, an empty dashboard and no way to tell why.
// An arrow function has no `arguments`, so it cannot be one.
//
// ⚠ **Loaded late, on reaching a level** — never at boot. A 145 KB request to another origin at
// startup lands exactly when the network is busiest, and time-to-gameplay is the thing it would
// damage.
//
// ⚠ **Being blocked is normal.** The script may simply never arrive (adblock, CSP). Everything
// here has to survive that silently — same rule as `crazy.ts`.

/**
 * GA4 measurement id for the `ball-flow-d1d9a` Firebase project.
 *
 * ⚠ Empty means *off*: no script tag, no events, no errors. Filling it in is the whole activation
 * step — see `ANALYTICS.md`.
 */
const ID = "G-DZH9MTW427";

declare global {
  interface Window {
    dataLayer?: unknown[];
  }
}

let started = false;
/** Did gtag.js actually arrive? Reported with every telemetry row — see `sendRun`. */
let loaded = false;

function gtag(...args: unknown[]) {
  void args; // it is `arguments` that gets pushed — see the note at the top of this file
  try {
    window.dataLayer = window.dataLayer || [];
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer.push(arguments);
  } catch {
    /* no window — nothing to do */
  }
}

/**
 * Load gtag.js. Safe to call on every level; only the first call does anything.
 *
 * ⚠ **Skipped on localhost.** Every Vite hot reload would otherwise count as a fresh player, which
 * corrupts precisely the number GA is here to show. Test games still reach the Realtime Database —
 * `telemetry.ts` records everything and filters on read — only GA is spared them.
 */
export function startAnalytics() {
  if (started || !ID) return;
  started = true;
  try {
    if (/^localhost$|^127\.|^\[::1\]$/.test(location.hostname)) return;
    const el = document.createElement("script");
    el.async = true;
    el.src = `https://www.googletagmanager.com/gtag/js?id=${ID}`;
    el.onload = () => {
      loaded = true;
    };
    document.head.appendChild(el);
    gtag("js", new Date());
    // `beacon` so the last event of a session still leaves as the tab closes — the same reason
    // `sendRun` uses keepalive.
    gtag("config", ID, { transport_type: "beacon" });
  } catch {
    /* could not create a script tag — the game must not break over a tracker */
  }
}

/** Whether gtag.js loaded. See the field note in `sendRun`. */
export function gaLoaded(): boolean {
  return loaded;
}

/**
 * One GA event. Safe before the script lands: `dataLayer` queues it and gtag.js drains the queue.
 *
 * ⚠ GA4 drops malformed events **in silence**: names and parameter names ≤ 40 characters,
 * letters/digits/underscore only, not starting with a digit; string values ≤ 100 characters; ≤ 25
 * parameters; and the prefixes `firebase_`, `google_`, `ga_` are reserved.
 *
 * ⚠ A new parameter is invisible in reports until it is declared as a custom dimension in the GA4
 * admin, and that is **not retroactive**. See `ANALYTICS.md` §3.
 */
export function track(name: string, params: Record<string, unknown> = {}) {
  if (!started) return;
  gtag("event", name, params);
}
