// Real games, recorded on the device.
//
// Why this exists: every difficulty number in this project so far comes from a bot, and bots
// are systematically wrong about people. The sibling Pixel Flow project scored five different
// bot models against 67 real games across 21 levels, and **not one of them beat guessing a
// single constant** (log-likelihood -46.4 for the constant; the best model managed -48.6).
// What did work was averaging two oppositely-biased models and bending the result through a
// logistic curve fitted on real games — but that needs real games first, and this file is how
// they get collected.
//
// The build is static (GitHub Pages / a Capacitor APK), so there is no server to post to.
// Runs accumulate in localStorage and Settings copies them out as JSONL, one game per line,
// ready to be pasted straight into `playlog.jsonl` on the dev machine.

const KEY_RUNS = "bf_runs";
const KEY_DEVICE = "bf_device";
/** localStorage is ~5MB; a run is small, but there is no reason to keep years of them. */
const MAX_RUNS = 400;

export interface PlayRun {
  /** which device produced it — a phone and a desktop play very differently */
  dev: string;
  day: string;
  ts: number;
  lvl: number;
  /**
   * ⚠ Fingerprint of the level's *content* at the time it was played. Without it a refit
   * silently mixes games from boards that no longer exist — and this generator gets retuned
   * constantly, so a level's content changes under the same number all the time.
   */
  sig: string;
  result: "win" | "lose";
  /** wall-clock milliseconds spent in the level */
  ms: number;
  /** taps made, and how full the belt ever got — the two things skill shows up in */
  taps: number;
  peak: number;
  belt: number;
  stars: number;
  /** boosters spent, so a win bought with coins is not read as a win on skill */
  used: string[];
  /**
   * Every move of the game, in order — see `replay.ts` for the format.
   *
   * ⚠ Optional, and readers must cope with it missing: rows written before this existed have no
   * `rep`, and they are the only games from the first weeks of real play. Treating absence as an
   * error would throw away the data the whole log was built to collect.
   */
  rep?: string;
}

export function deviceId(): string {
  try {
    let d = localStorage.getItem(KEY_DEVICE);
    if (!d) {
      d = "M-" + Math.floor(Math.random() * 0xffff).toString(16).toUpperCase().padStart(4, "0");
      localStorage.setItem(KEY_DEVICE, d);
    }
    return d;
  } catch {
    return "M-????";
  }
}

function today(): string {
  const t = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`;
}

export function loadRuns(): PlayRun[] {
  try {
    const raw = localStorage.getItem(KEY_RUNS);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/**
 * Store one finished game. Drops the oldest when over the cap, and if the write still fails
 * keeps dropping and retrying — losing an old game beats losing the one just played.
 */
export function saveRun(run: Omit<PlayRun, "dev" | "day" | "ts">) {
  try {
    const runs = loadRuns();
    runs.push({ dev: deviceId(), day: today(), ts: Date.now(), ...run });
    while (runs.length > MAX_RUNS) runs.shift();
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        localStorage.setItem(KEY_RUNS, JSON.stringify(runs));
        return;
      } catch {
        if (runs.length < 8) return;
        runs.splice(0, Math.ceil(runs.length / 4));
      }
    }
  } catch {
    /* storage unavailable — playing without a log is fine */
  }
}

/** One JSON object per line, the exact shape `scripts/winrate.mjs` reads. */
export function exportJsonl(): string {
  return loadRuns()
    .map((r) => JSON.stringify(r))
    .join("\n");
}

export function clearRuns() {
  try {
    localStorage.removeItem(KEY_RUNS);
  } catch {
    /* nothing to clear */
  }
}

/** Win/loss tally per level, for showing the player what has actually been collected. */
export function summary(): { runs: number; levels: number; wins: number } {
  const runs = loadRuns();
  const levels = new Set(runs.map((r) => r.lvl));
  return { runs: runs.length, levels: levels.size, wins: runs.filter((r) => r.result === "win").length };
}

/**
 * Copy to clipboard, falling back to a hidden textarea because the async clipboard API is
 * unavailable on plain-http origins — which is exactly how the game is reached from a phone
 * on the local network.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    // ⚠ Only defined in a secure context. A phone reaching the dev server over plain
    // `http://192.168.x.x` has no `navigator.clipboard` at all, so this throws and we fall
    // through — which is the case the fallback below exists for, not an edge case.
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      // ⚠ Not `opacity: 0`. A textarea the browser considers invisible cannot be selected on
      // mobile, so `execCommand` returned false and the button reported failure with no way off
      // the device. Park it off-screen but fully rendered instead, and select by range —
      // `.select()` alone does nothing on iOS.
      ta.style.position = "fixed";
      ta.style.top = "-1000px";
      ta.style.left = "0";
      ta.setAttribute("readonly", "");
      document.body.appendChild(ta);
      ta.contentEditable = "true";
      ta.select();
      ta.setSelectionRange(0, text.length);
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/**
 * Push the log to the dev server, which appends it to `playlog.jsonl`.
 *
 * Returns how many games landed, or `null` when there is nothing listening — a static build has
 * no sink, so the caller has to fall back to the clipboard.
 */
export async function uploadRuns(): Promise<{ added: number; skipped: number } | null> {
  const body = exportJsonl();
  if (!body) return { added: 0, skipped: 0 };
  try {
    const res = await fetch("/__playlog", { method: "POST", body });
    if (!res.ok) return null;
    return (await res.json()) as { added: number; skipped: number };
  } catch {
    return null;
  }
}
