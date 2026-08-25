// Every move a player made, in order, small enough to ride along with the finished game.
//
// Why it exists: the play log says a level was lost after 14 taps with the belt at 30/30. It does
// not say *which* trays were tapped, in what order, or what the board looked like when it went
// wrong — so a level reading 47% is a fact with no explanation attached, and the only way to get
// one has been to guess and then try to reproduce it by hand. Every level-3 investigation so far
// has been that guess.
//
// ⚠ **This is a replay, not a summary.** The engine is deterministic, so the board plus this
// string reproduces the game exactly — `npm run replay` re-runs it through the real `logic.ts` and
// checks it lands on the same result. That check is the whole value: a "replay" that ends
// differently from the game it claims to describe is worse than no replay, because it looks
// authoritative while being fiction. Anything that cannot be replayed is a bug in this file.
//
// ⚠ **Marble arrivals are recorded too, and they are most of the bytes.** The headless bots use
// `arriveAll()` — every marble of a tap lands at once — while a real game drops them through
// Matter and they arrive over several ticks in whatever order the pile-up settles. That timing
// changes which marble reaches the belt entry first, and from there the whole game. Replaying real
// play with `arriveAll()` produced a different outcome often enough to be useless, so the arrivals
// are in the log.
//
// Format — events separated by `,`, each `<tick><kind><arg>`:
//
//   14t7     tick 14: tapped the tray anchored at cell 7
//   16a334   tick 16: three marbles reached the neck — colours 3, 3, 4, in that order
//   22w2     tick 22: wrench on box column 2
//   25m      tick 25: magnet
//   31u      tick 31: undo
//   40r      tick 40: revive
//
// Arrivals in the same tick are merged into one event, which is where most of the compression
// comes from — a tray is nine marbles and they land in bursts.

/** Recorder interface, so `logic.ts` does not have to know about the encoding. */
export interface Rec {
  ev(tick: number, kind: string, arg?: string): void;
}

/**
 * Hard cap on events. A normal game is 60-200; this is roughly ten times the longest real game
 * seen, and it exists so a stuck session cannot post a megabyte row.
 *
 * ⚠ Truncation is **marked**, never silent. A log that quietly stops at the cap replays to a
 * "loss" the player never had, and it would be indistinguishable from a real one.
 */
export const REPLAY_CAP = 2000;

export class Replay implements Rec {
  private parts: string[] = [];
  /** Open arrival run: arrivals in the same tick merge into one event. */
  private arrAt = -1;
  private arr = "";
  private cut = false;

  ev(tick: number, kind: string, arg = ""): void {
    if (kind === "a") {
      // Same tick as the run being built? Extend it rather than starting a new event.
      if (tick === this.arrAt) {
        this.arr += arg;
        return;
      }
      this.flush();
      this.arrAt = tick;
      this.arr = arg;
      return;
    }
    this.flush();
    this.push(`${tick}${kind}${arg}`);
  }

  private flush() {
    if (this.arrAt < 0) return;
    this.push(`${this.arrAt}a${this.arr}`);
    this.arrAt = -1;
    this.arr = "";
  }

  private push(s: string) {
    if (this.parts.length >= REPLAY_CAP) {
      this.cut = true;
      return;
    }
    this.parts.push(s);
  }

  /** The wire form. Empty string when nothing happened, which is a game worth nothing anyway. */
  toString(): string {
    this.flush();
    return this.parts.join(",") + (this.cut ? ",!" : "");
  }

  /** How many events are in it — for a size sanity check at the call site. */
  get length(): number {
    return this.parts.length + (this.arrAt >= 0 ? 1 : 0);
  }
}

export interface ReplayEvent {
  tick: number;
  kind: "t" | "a" | "w" | "m" | "u" | "r";
  /** tap: cell index · wrench: column · arrival: the colours that landed, in order */
  arg: number;
  colors: number[];
}

/**
 * Parse a recorded string back into events.
 *
 * Lives here rather than in the reading script because the two have to agree byte for byte, and
 * this file is the one that decides the format. A second copy in `scripts/` is the same trap the
 * bots were in before `bots.mjs` existed.
 */
export function parseReplay(s: string): { events: ReplayEvent[]; truncated: boolean } {
  const events: ReplayEvent[] = [];
  let truncated = false;
  for (const part of (s || "").split(",")) {
    if (part === "!") {
      truncated = true;
      continue;
    }
    const m = /^(\d+)([tawmur])(.*)$/.exec(part);
    if (!m) continue;
    const tick = Number(m[1]);
    const kind = m[2] as ReplayEvent["kind"];
    const rest = m[3];
    events.push({
      tick,
      kind,
      arg: rest === "" ? -1 : Number(rest),
      colors: kind === "a" ? [...rest].map((c) => parseInt(c, 36)) : [],
    });
  }
  return { events, truncated };
}
