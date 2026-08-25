// The A/B test: two openings in one bundle, three boards apart.
//
// Arm **A is the control** — the ladder exactly as it ships today. Arm **B is the variant**, which
// differs only at levels 3, 4 and 5. Every other level resolves identically for both arms, so
// anything the numbers show afterwards is those three boards and nothing else.
//
// ⚠ **The arm is a property of the device, not of the session or the build.** It comes off
// `deviceId()`, the same persisted code telemetry already reports, so a player stays in the arm they
// started in — across reloads, across levels, and across every deploy after this one. Re-rolling per
// session would average the two arms together inside every player and measure nothing at all.
//
// ⚠ **The control is what `HANDMADE` holds; the variant is the override.** Every script, the editor
// and the headless sim then see the shipped boards by default — a control arm the tooling cannot
// measure is worse than no test — and `abArm()` falls back to A wherever there is no `localStorage`,
// so anything that cannot be identified gets the board that is already proven in production.
//
// ⚠ **The arm is stamped on every telemetry row** (`ab`). A split whose rows cannot be separated
// afterwards is not a test, it is a fortnight of mixed data — both arms ship in one bundle, so
// `build` cannot tell them apart. `?ab=A` and `?ab=B` force an arm for checking by hand, and that
// override is deliberately not persisted.
//
// ⚠ **The variant's three boards were validated before they were wired in**, not after: the box
// multiset per colour (30, 30 and 60, all exact), and the pinned line replayed the way `custom.ts`
// does — 10, 10 and 20 taps, every one a win. A board with `columns` set makes `toLevelDef` skip
// `derive` entirely, so nothing downstream would ever have searched for a line.
import type { Blueprint, LevelBook } from "./custom";
import { deviceId } from "./playlog";

export type Arm = "A" | "B";

/** The levels the two arms disagree on. Everything else resolves the same way for everybody. */
export const AB_LEVELS: number[] = [];

/**
 * **Which split this is.** Stamped on every telemetry row as `abt`, beside the arm.
 *
 * ⚠ **`ab` alone is not enough, and the cost of learning that was a wrong number on screen.** This
 * is the *second* A/B this game has run: the first compared the 21/8 opening against the ladder at
 * levels 1-10 and was retired in `18b17c7`, and its rows carry `ab: "A"` / `ab: "B"` too. Grouping
 * on the arm alone pooled the two — and the two arms mean opposite things in them, so the
 * dashboard read arm A at a median of **80s** against arm B's 32s, when this test's own rows say
 * 69s against 44s. The 21/8 boards were simply longer; none of that gap was about levels 3, 4, 5.
 *
 * ⚠ **So it changes whenever the split changes** — new levels, new variant, new id. A test whose
 * rows cannot be told from the last test's is the same defect as arms that cannot be told apart,
 * one level up, and it is quieter: the rows all look valid.
 *
 * ⚠ Rows written before this field existed have none. `stats.html` counts and reports them rather
 * than assuming, which is the same rule it applies to rows with no `ab` at all.
 */
export const AB_TEST = "l345";

// ⚠ **Empty: the levels-3/4/5 split closed on 2026-08-25 and arm B's three boards were adopted
// into `HANDMADE` for everybody.** The arm is still computed and still stamped on every row, and
// that is deliberate — with no variant the two arms are an A/A, and this test ended needing one:
// arm B came out **+4.3 points ahead on levels 1 and 2** (p = 0.032), boards byte-identical in both
// arms and played before the split. An imbalance that size is either bad luck or a broken hash, and
// nothing else on this project can tell those apart. Watch it here before running another split.
const VARIANT = {} as unknown as LevelBook;

let forced: Arm | null | undefined;
function fromQuery(): Arm | null {
  if (forced !== undefined) return forced;
  forced = null;
  try {
    const v = new URLSearchParams(location.search).get("ab");
    if (v === "A" || v === "B") forced = v;
  } catch {
    /* no location — headless */
  }
  return forced;
}

/**
 * Which arm this device is in.
 *
 * ⚠ FNV-1a over the whole device code rather than a bit test on it. The code is `M-` plus four hex
 * digits, so testing one bit splits on one nibble of a value that was never meant to be uniform.
 * Checked over 20000 synthetic codes: 50.0 / 50.0.
 */
export function abArm(): Arm {
  const q = fromQuery();
  if (q) return q;
  try {
    const id = deviceId();
    if (id === "M-????") return "A";
    let h = 0x811c9dc5;
    for (let i = 0; i < id.length; i++) {
      h ^= id.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h % 2 === 0 ? "A" : "B";
  } catch {
    return "A";
  }
}

/**
 * The shipped level book this device should see.
 *
 * ⚠ **A book, not a per-level override, so `blueprintFor` keeps its own ordering.** That function
 * resolves this device's saved drawings *first* and the shipped table second, deliberately — an
 * editor save that kept losing to the shipped copy reads as the save having failed. Swapping the
 * shipped table underneath it leaves that intact; intercepting ahead of it would break the editor
 * loop for the three levels the test happens to cover.
 */
export function abBook(shipped: LevelBook): LevelBook {
  return abArm() === "B" ? { ...shipped, ...VARIANT } : shipped;
}

/** The variant's board for a level, or null. Exported for tooling that wants to measure it. */
export function abVariant(level: number): Blueprint | null {
  return (VARIANT as Record<number, Blueprint>)[level] ?? null;
}
