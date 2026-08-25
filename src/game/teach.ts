// Replaying the teaching bits on demand, for looking at them.
//
// The walkthrough and the coach cards are each shown **once ever** and then marked in storage,
// which is right for a player and useless for anyone checking they still read well. The only way
// to see one again was to clear `bf_tutor` / `bf_coach` by hand in a console, per card, per
// change — so in practice they were checked once and never again.
//
//   ?teach=1        replay everything on this board, from the first step
//   ?teach=lid      replay one card by id: hatch | arrow | lid
//
// ⚠ Crates, `?` trays and linked pairs no longer have a card, so their old ids do nothing here —
// see the note on `MARKS`. They are read off their own faces; the three that are left are the ones
// a player cannot guess.
//
// ⚠ **Replay mode writes nothing.** Neither `tutorialDone` nor `markCoach` fires while it is on,
// so looking at a card does not consume it — otherwise checking a card would silently spend the
// one showing a real player was going to get, on the same device you then hand to a playtester.
//
// ⚠ Read **once**, at module load. `location.search` cannot change without a reload, and reading
// it per frame would put a string parse in the tick.
//
// ⚠ Not gated on `import.meta.env.DEV`. It is inert without the query parameter, it exposes no
// state and changes no rule — and gating it would remove it from exactly the build worth checking,
// which is the one that ships. `__TARGET__` builds are what reviewers see, and the same URL has to
// work there.

function param(): string {
  try {
    return new URLSearchParams(location.search).get("teach") ?? "";
  } catch {
    return "";
  }
}

const TEACH = param();

/** Is replay on at all? */
export const teachAll = () => TEACH !== "";

/** A specific card was asked for, or "" for "whatever this board offers next". */
export const teachOnly = () => (TEACH === "1" ? "" : TEACH);
