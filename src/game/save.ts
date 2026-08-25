// Progress + wallet. Small enough to keep in key-value storage; every key is prefixed `bf_`
// so a browser that still holds another build's keys is ignored rather than misread.
//
// ⚠ Through `platform.storage`, never `localStorage` directly. On CrazyGames that routes to the
// host's data module so a save follows the player between devices — and it writes to *both*, so
// a session where the SDK is down still leaves a fresh local copy rather than a stale one frozen
// at whenever the SDK last worked.
//
// ⚠ And the prefix is now frozen. Automatic Progress Save backs `localStorage` up verbatim, so
// renaming `bf_*` after launch restores the old names into a game that reads the new ones and
// every player loses everything. Before launch it is free; after, it never is.

import { FREE_MAGNETS } from "./config";
import { platform } from "../platform";

const K_LEVEL = "bf_level";
const K_STARS = "bf_stars";
const K_COINS = "bf_coins";
const K_MUTE = "bf_mute";
/** Has the player been walked through level 1 yet? */
const K_TUTOR = "bf_tutor";
/**
 * Which one-off mechanic explanations have already been shown (`?` trays, hatches, crates, linked
 * pairs, chocolate boxes).
 *
 * ⚠ A **new** key, never a rename. Automatic Progress Save backs `localStorage` up verbatim, so
 * renaming an existing `bf_` key after launch restores the old name into a game reading the new
 * one and wipes the player out. Adding keys is free; renaming them is not.
 */
const K_COACH = "bf_coach";
/**
 * How many times each level has been started. The star rating past level `STAR_ALWAYS_TO` is read
 * off this, so it has to survive a reload — a counter held in the scene would reset every time the
 * player closed the tab and hand back a free three stars.
 *
 * ⚠ A **new** key, never a rename of an existing one. CrazyGames' Automatic Progress Save backs
 * localStorage up verbatim, so renaming a key after launch restores old names into a game that
 * reads new ones and every player loses that progress.
 */
const K_TRIES = "bf_tries";
/**
 * The login streak: `{ streak, last }`, where `last` is a local `YYYY-MM-DD`.
 *
 * ⚠ A **new** key. CrazyGames' Automatic Progress Save mirrors localStorage verbatim, so renaming
 * one after launch restores the old name into a game that reads the new one and the player loses
 * whatever it held.
 */
const K_DAILY = "bf_daily";
/**
 * The day the daily reward was last **offered** — not claimed. `bf_daily` records the claim.
 *
 * ⚠ Two keys because they answer two different questions, and one of them decides whether the
 * player's run gets interrupted. A win routes the player home to the card, and the gate for that
 * used to be "is there something to take", which stays true all day for anyone who does not take
 * it — so every single win kicked them back to the home screen. Measured on one day of real play:
 * 121 forced returns across 72 devices, one player sent home **50 times**.
 *
 * ⚠ Stamped when the offer is **shown**, not when it is pressed. A player who saw CLAIM REWARD and
 * chose HOME has been asked; asking again after the next win is the same interruption.
 *
 * ⚠ A **new** key — see the note on `K_DAILY`.
 */
const K_OFFERED = "bf_dailyoffer";
/**
 * Magnets the player **owns**. The badge under the button is this number.
 *
 * ⚠ A **new** key, never a rename of a shipped one. CrazyGames' Automatic Progress Save mirrors
 * localStorage verbatim, so renaming after launch restores the old name into a game that reads the
 * new one. This key was renamed once, from `bf_freemag`, before any build carrying it was uploaded
 * — the only window in which that is free.
 *
 * ⚠ It defaults to `FREE_MAGNETS`, not 0, so a player already partway up the ladder when this ships
 * gets them too. Defaulting to zero would silently withhold what the tutorial is about to promise.
 */
const K_MAGNET = "bf_magnet";

/**
 * Every key this game owns.
 *
 * ⚠ **A reset cannot enumerate `localStorage` and call it done.** On CrazyGames the host store is
 * the one that is read first, and a player who arrives on a new device has their cloud save in the
 * host store with `localStorage` still empty — so a loop over `localStorage` finds nothing to
 * delete and the reset silently does nothing at all. This list is what has to be cleared.
 *
 * ⚠ Add a key above, add it here. There is nothing that can check it for you.
 */
export const SAVE_KEYS = [
  K_LEVEL,
  K_STARS,
  K_COINS,
  K_MUTE,
  K_TUTOR,
  K_COACH,
  K_TRIES,
  K_DAILY,
  K_OFFERED,
  K_MAGNET,
] as const;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = platform.storage.getItem(key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    platform.storage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode — progress just won't persist */
  }
}

export const save = {
  /**
   * Magnet boosters in hand. One is spent per use; at zero the button asks whether to buy.
   *
   * ⚠ Clamped at read as well as at write. A hand-edited or corrupted value must not hand out an
   * endless booster, and this is a number a curious player can reach from the console in one line.
   */
  get magnets(): number {
    const n = read<number>(K_MAGNET, FREE_MAGNETS);
    return Number.isFinite(n) ? Math.max(0, Math.min(99, Math.floor(n))) : 0;
  },
  set magnets(v: number) {
    write(K_MAGNET, Math.max(0, Math.min(99, Math.floor(v))));
  },

  /** highest level the player has unlocked (1-based) */
  get unlocked() {
    return Math.max(1, read<number>(K_LEVEL, 1));
  },
  set unlocked(v: number) {
    write(K_LEVEL, Math.max(this.unlocked, v));
  },

  /** How many times level `n` has been started, 0 if never. */
  tries(n: number): number {
    return read<Record<string, number>>(K_TRIES, {})[String(n)] ?? 0;
  },
  /**
   * Count one more go at level `n` and return the new total.
   *
   * ⚠ Counted when the level **starts**, not when it ends. Counting on finish would let a player
   * who is losing hit RESTART before the board dies and come back to "first try" — the boards are
   * deterministic, so a second look at one is real information. The cost is that opening a level
   * to peek at it spends a go, which is the cheaper of the two mistakes.
   */
  noteTry(n: number): number {
    const all = read<Record<string, number>>(K_TRIES, {});
    all[String(n)] = (all[String(n)] ?? 0) + 1;
    write(K_TRIES, all);
    return all[String(n)];
  },

  /** Day key the reward was last offered on, or "" — see `K_OFFERED`. */
  get dailyOffered(): string {
    return read<string>(K_OFFERED, "");
  },
  set dailyOffered(v: string) {
    write(K_OFFERED, v);
  },

  /** Login streak state. `last` empty means the player has never claimed. */
  get daily(): { streak: number; last: string } {
    const v = read<{ streak?: number; last?: string }>(K_DAILY, {});
    return { streak: Math.max(0, v.streak ?? 0), last: v.last ?? "" };
  },
  set daily(v: { streak: number; last: string }) {
    write(K_DAILY, v);
  },

  stars(n: number): number {
    return read<Record<string, number>>(K_STARS, {})[String(n)] ?? 0;
  },
  setStars(n: number, s: number) {
    const all = read<Record<string, number>>(K_STARS, {});
    if ((all[String(n)] ?? 0) >= s) return;
    all[String(n)] = s;
    write(K_STARS, all);
  },
  get totalStars() {
    return Object.values(read<Record<string, number>>(K_STARS, {})).reduce((a, b) => a + b, 0);
  },

  get coins() {
    // ⚠ A new player starts on **nothing** and earns their way in — `WIN_COINS` = 20 a level,
    // against 40 for an undo and 50 for a revive. So the first two levels have no boosters and
    // the first three have no revive, which means a jam in that stretch has exactly one outcome:
    // the JAMMED card. That is the decision; the levels down there are the gentle ones and are
    // meant to be winnable without help.
    return read<number>(K_COINS, 0);
  },
  set coins(v: number) {
    write(K_COINS, Math.max(0, Math.round(v)));
  },

  get muted() {
    return read<boolean>(K_MUTE, false);
  },
  set muted(v: boolean) {
    write(K_MUTE, v);
  },

  /**
   * Whether the level-1 walkthrough has been seen.
   *
   * ⚠ Written when the walkthrough **finishes**, not when it starts. A player who bounces off the
   * first screen and comes back gets it again, which is the point of it; marking it on entry means
   * the one person who most needs it is the one guaranteed to miss it.
   */
  get tutorialDone() {
    return read<boolean>(K_TUTOR, false);
  },
  set tutorialDone(v: boolean) {
    write(K_TUTOR, v);
  },

  /** Mechanic explanations already shown. */
  get coachSeen(): string[] {
    const v = read<string[]>(K_COACH, []);
    return Array.isArray(v) ? v : [];
  },
  /**
   * ⚠ Marked when the card is **dismissed**, not when it appears — same rule as `tutorialDone`.
   * A card that flashed by while the player was mid-tap has not taught anything, and this is the
   * only chance it gets.
   */
  markCoach(id: string) {
    const seen = this.coachSeen;
    if (seen.includes(id)) return;
    seen.push(id);
    write(K_COACH, seen);
  },
};
