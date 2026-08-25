// Every tunable number the game is built on. Layout lives here too, in *design units*
// (a 540-wide portrait box); GameScene draws into a container scaled to the real canvas,
// so nothing below ever has to know the device pixel ratio.
//
// The one rule: logic.ts and level.ts must stay importable from plain Node (the headless
// sim drives them), so this file must never import Phaser.

export const GAME_W = 540;

/**
 * The design box is 540 wide and **flexes in height** to the frame it is running in.
 *
 * Why it cannot stay a constant: Phaser's FIT scaler grows the design box until one axis fills
 * the frame, and in any 16:9 frame — which is every iframe size the host uses — that axis is the
 * height. The width is then whatever the ratio leaves: `width = height × (GAME_W / GAME_H)`. At a
 * fixed 1160 that is 0.466, so the game rendered as a 298px ribbon down the middle of a 1243px
 * page while three quarters of the frame sat empty. Nothing had shrunk; a taller, thinner box
 * scaled to the same height is simply narrower.
 *
 * ⚠ **The clamp is what makes it safe, and both ends are measured, not chosen.**
 *
 * `MAX` is today's shape, so a tall phone gets exactly the layout every art decision was made
 * against — this must not become a redesign of the phone build.
 *
 * `MIN` is where the machine physically ends: `L.machine.y + L.machine.h` = 1066, plus a 14px
 * skirt. Everything below that was empty violet. Going tighter would mean cutting real content,
 * and the only content left to cut is load-bearing — the chute is 186px at a 33° cone and
 * shortening it stops the marbles sliding (see the note on `funnel`), and the grid is five rows
 * at pitch 71.
 *
 * ⚠ So the flex is 1080…1160, worth about 7% on a desktop frame and nothing at all on a phone.
 * Matching the sibling project's 0.625 would need `GAME_H` near 864, which is less than the grid
 * and the chute alone — that is a second layout (the box well beside the machine rather than
 * under it), not a number.
 *
 * ⚠ Read **once**, at module load. A mid-session resize does not re-run it: the Phaser canvas is
 * built from this value, so changing it later would mean rebuilding the game. Rotating a phone
 * keeps the shape it booted with, which is the same behaviour the sibling project ships.
 *
 * ⚠ The `typeof window` guard is not defensive dressing — `logic.ts` and `level.ts` import this
 * file and the headless sim runs them in plain Node. Without it every script dies at import.
 */
/**
 * The three HUD boosters (magnet, wrench, undo). Set to `false` to take the row away; the layout
 * below closes the gap on its own.
 *
 * ⚠ It lives here, not in `GameScene`, because the *layout* depends on it: hiding the row without
 * closing the hole it leaves is a strip of empty machine between the HUD and the cabinet. One
 * flag, read by both, or the pixels and the buttons disagree about whether boosters exist.
 * ⚠ Revive is not one of these. It is priced alongside them but is never a button — the jam
 * pop-up is its only door — so it stays live while this is off.
 *
 * ⚠ **Declared up here, above `GAME_H`, because the design box's height is derived from it.** With
 * the row on, the cabinet sits 84px lower and the box well ends 84px further down — so the shortest
 * box the game may be drawn in depends on this flag. It used to be declared below and the height
 * was a hardcoded 1080, which was correct only while the row was hidden: turning boosters on cut
 * 70px off the bottom of the machine on every frame shorter than about 2.15:1, taking the whole
 * bottom row of boxes off screen.
 */
export const SHOW_BOOSTERS = true;

/**
 * Magnets the player starts with, given outright.
 *
 * ⚠ Two, and the number is not arbitrary: one is a demonstration, two is a decision. The tutorial
 * spends the first *for* them, so the second is the first time they choose to use it — and choosing
 * is the thing that has to happen before a price means anything.
 */
export const FREE_MAGNETS = 2;

/**
 * The level that teaches the magnet.
 *
 * ⚠ A level number, which this project otherwise avoids — `coach.ts` and `featureProgress` both
 * read the board precisely so they cannot drift when the ladder moves, and it has moved three times
 * in a day. This one cannot be derived: "where the magnet should be taught" is a design decision,
 * not a property of a board. What *is* derived is everything inside the lesson — which trays it
 * points at come from the board, so a recoloured level 6 still teaches correctly.
 *
 * ⚠ The board here has to be able to produce a magnet plan after two taps, or the lesson stalls at
 * the step that waits for one. Level 6 can: its open boxes are all cyan and it holds four blue
 * trays over blue boxes one row down, so two blue taps put 18 marbles on the rail that nothing
 * accepts — which is the exact position the magnet exists for.
 */
export const MAGNET_TUTOR_LEVEL = 6;

/**
 * Dead space taken out of the column so the desktop build can be wider.
 *
 * ⚠ **Why height buys width.** Phaser's FIT scaler uses one ratio for everything —
 * `frame height / GAME_H` — so the design box's *width* has no effect at all: widening it only adds
 * empty canvas. The single lever on how big the game draws is `GAME_H`, and every pixel of margin
 * in the column is paid for in width on a landscape frame.
 *
 * ⚠ **None of this moves a piece of the machine relative to another.** It removes margin: the space
 * above the HUD, the slack the grid panel carried around a 5-row board, part of the cabinet's top
 * rim, and the skirt under it. The grid, the chute, the belt and the box well keep their sizes and
 * their spacing exactly.
 *
 * ⚠ `CHUTE_KEEP` is not a saving and must never become one. Every `y` in `funnel` already shifts
 * together through `BOOST_LIFT`; these shifts join it for the same reason — move one end of the
 * cone without the other and the 33° becomes something shallower, which is the angle at which the
 * marbles stop sliding. See the note on `funnel`.
 */
/**
 * How far the machine rides up now that the booster row is gone.
 *
 * The row used to span `boostY ± boostSize / 2` = 114…190 with the cabinet starting at 198. There
 * is one booster left and it sits **in the HUD**, so the row is not there at all and the cabinet
 * starts where it began.
 *
 * ⚠ **This is the whole of the desktop win, and it is not cosmetic.** `GAME_H` cannot be shorter
 * than the machine's own bottom edge, and Phaser's FIT scaler sets the canvas width from the design
 * box's aspect — so 84px of empty row cost the desktop build 84px of height it then paid for in
 * width. With the row present the flex range collapsed to a single value (1164…1164) and the
 * desktop canvas sat at 288px of a 1258px page; without it the range is 1080…1164 again and the
 * canvas is 311px. A tall phone is unaffected either way: at 2.16:1 it takes `H_MAX` and always
 * did.
 *
 * ⚠ Applied to the constants, not to a container. Every consumer reads `L` — the art, the Matter
 * funnel walls, the belt path, the pointer-to-cell mapping — so moving the numbers moves all of
 * them together. Shifting a render container instead leaves the physics and the hit tests behind
 * at the old offset, and the marbles drift out of the funnel they are supposed to be inside.
 * ⚠ The cabinet keeps its height and rides up **whole**. Growing `machine.h` to keep its bottom
 * edge pinned was tried first and it just moved the hole: the well got 84px taller while still
 * drawing `BOX_VISIBLE` = 5 boxes, so the empty strip reappeared inside the well. Stretching one
 * end of the machine to hide a gap at the other end is the original defect upside-down. The whole
 * block moves, and the background shows below it — which is what a machine standing on a floor
 * looks like anyway.
 */
// ⚠ Always lifted now: the booster sits **in the HUD**, beside the level pill, so the row it used
// to have is gone whether boosters are on or off. That row was 90px of empty column, and on a
// landscape frame every pixel of column height is paid for in width — see the note on TRIM_TOP.
// ⚠ **84 again: the booster is back on the HUD line and has no row of its own.** It sat under the
// level pill for a while, which cost 40px of column — and on this layout a pixel of column is paid
// for in width on every desktop frame. The row is gone because the line had space once the pill
// moved left against the gear and the coin moved right against the wall; the booster took the gap
// in the middle that opened up between them.
// ⚠ **94 since the booster's two soft rings came off on a phone.** The button keeps its seat in
// the middle of the HUD line, but the pad it sits on went from ±57 to ±37 — the rings were the
// widest thing on the row by a long way, and the cabinet had to start clear of them. Ten pixels
// here and eight on `TRIM_TOP` take the strip above the cabinet from 90 to 72, which leaves the
// solid pad overlapping the cabinet's top rim by about three pixels. That overlap is allowed
// deliberately: the rim is white casing with nothing on it, and three pixels of it is a far better
// use of the column than eighteen pixels of empty violet.
// ⚠ **This lever is portrait-only even though nothing here says so.** `HUD_LIFT` subtracts
// `BOOST_LIFT` and `MACHINE_TOP` adds it back, so on a wide frame the cabinet's top edge is
// `WIDE_MACHINE_TOP` whatever this is — and `FUNNEL_SHOULDER_BASE` and `GRID_TOP` cancel it the
// same way. Changing it cannot move the desktop layout by a pixel.
const BOOST_LIFT = 94;

/**
 * Is the frame landscape enough to put the HUD in a column beside the machine?
 *
 * ⚠ **Read once, at module load, exactly like `GAME_H` below it** — the whole layout is derived
 * from it, and half of that derivation is baked into textures. A phone that is rotated keeps the
 * layout it booted with, which is the behaviour `GAME_H` has always had.
 *
 * ⚠ 1.2, the same threshold `HomeScene` uses, and it must stay the same: the two screens hand off
 * to each other and a frame that gets the wide home screen and the portrait board reads as the game
 * changing shape when you press PLAY.
 */
export const WIDE_HUD =
  typeof window !== "undefined" && window.innerHeight > 0
    ? window.innerWidth / window.innerHeight >= 1.2
    : false;

/**
 * Empty design space added **each side** of the machine on a wide frame. The HUD lives in the left
 * one; the right one is there so the machine stays centred and every `GAME_W / 2` in `GameScene`
 * goes on meaning the middle of the screen.
 *
 * ⚠ It is free. Phaser's FIT scaler takes `min(frameW / boxW, frameH / boxH)`, and on any frame
 * wide enough to earn this the height is what binds — so the extra width costs nothing at all and
 * the machine is drawn at exactly the size `GAME_H` alone decides.
 *
 * 156 holds the 120px level pill with 18px of margin, and leaves 32px between the column and the
 * cabinet's left wall.
 */
export const STAGE_PAD = WIDE_HUD ? 156 : 0;

/**
 * How far the machine rides up once the HUD is no longer sitting on top of it.
 *
 * ⚠ **This is the point of the whole exercise, and it is width, not height.** `H_MIN` is the
 * machine's own bottom edge, `GAME_H` clamps to it on every landscape frame, and FIT then sets the
 * canvas from `frameH / GAME_H` — so 114px of HUD strip was costing the desktop build 114px of
 * height it paid for in width. Measured on a 1898x982 frame: `H_MIN` 970 -> 856, and the machine
 * goes from 547px wide to 620px. **13% bigger, for free.**
 *
 * ⚠ Subtracted from `FUNNEL_SHOULDER`, `GRID_TOP` **and** `MACHINE_Y` together, so `MACHINE_H` is
 * unchanged and the whole block moves as one. Take it off one of the three and the chute's 33°
 * becomes something shallower, which is the angle at which the marbles stop sliding.
 *
 * Defined below, once the trims it is measured against exist.
 */

/** Margin above the HUD: 24 was a comfortable gap on a phone and is pure cost on a desktop frame. */
// ⚠ 16 -> 24 once the booster's rings came off: the HUD line no longer carries a 114px-tall green
// pad that ran off the top of the canvas at y −11, so the row can sit closer to the edge. It moves
// the HUD and the machine together, and it cancels on a wide frame for the same reason
// `BOOST_LIFT` does.
const TRIM_TOP = 24;
/** The cabinet's top rim, 42px of grey bar above the grid cavity. 26 still reads as a lip. */
const TRIM_RIM = 16;
/** `gridPanel` carried 382 for a grid that is 348 at five rows — 34 of centring slack. */
const TRIM_PANEL = 34;
/** Skirt under the cabinet, 14 -> 6. */
const TRIM_SKIRT = 8;
/** The two gaps around the booster row, 14 and 8, taken to 8 and 6. */
const TRIM_GAPS = 8;

/** Where the cabinet's top edge sits on a wide frame: a margin, not a gap. */
const WIDE_MACHINE_TOP = 20;
/**
 * ⚠ **Derived from `BOOST_LIFT`, never typed in.** This was a hardcoded 114, chosen because it
 * put the cabinet's top edge at y 20. `MACHINE_TOP` is `198 - TRIM_TOP - TRIM_GAPS - HUD_LIFT`
 * minus `BOOST_LIFT`, so the moment the booster left its row and `BOOST_LIFT` went 40 -> 84 the
 * same 114 put that edge at **-24** and the top row of every board was clipped off the top of the
 * canvas — on desktop only, where `WIDE_HUD` is the layout, and therefore on none of the phone
 * screenshots. Pinning the edge instead of the lift means the next change to the booster cannot
 * do it again.
 */
const HUD_LIFT = WIDE_HUD ? 198 - TRIM_TOP - TRIM_GAPS - BOOST_LIFT - WIDE_MACHINE_TOP : 0;


/**
 * The rail and the balls, both bigger.
 *
 * ⚠ **They are one number, not two.** `BELT_SLOTS` is 30 and must stay 30 — belt capacity is one of
 * the most expensive constants in the game — so the gap between neighbouring marbles is
 * `perimeter / 30 - 2 * marbleR`. Growing the ball without growing the loop closes that gap to
 * nothing and the rail becomes a solid bar of touching marbles. The loop grows through `r` (its
 * cap radius) and `hx` (its half-length); the ball grows to match, and the gap is checked.
 *
 * ⚠ `hx` cannot grow far. The bottom straight has to span the box row — a marble only drops into a
 * column by physically travelling over it — and the housing has to stay inside the cabinet, which
 * is 26…514. At `hx` 200 the shell reaches 32…508.
 */
const BELT_R = 32;
/**
 * Belt half-length, 190 -> 202.
 *
 * ⚠ Bounded at both ends and the window is narrow. Too short and the bottom straight stops
 * spanning the box row; too long and the housing reaches the cabinet wall. At 204 it touched
 * 26..514 exactly — the rail looked like it was bursting out of the machine — which is why the
 * cabinet widened to 14..526 and this pulled back to 202, leaving 14px of shoulder either side.
 */
const BELT_HX = 202;
const BELT_SHELL = BELT_R + 8;
/**
 * Ball radius, 14 -> 15.
 *
 * ⚠ **Seven percent is the ceiling, and `SLOT_COLUMN` is what sets it.** A bigger ball needs a
 * wider gap on the rail, the gap comes from `perimeter / BELT_SLOTS`, and a wider gap means fewer
 * slots pass over each 100px box column. Swept every combination of ball, cap radius and half-length
 * that fits inside the cabinet: at r 16 the count drops from **3 slots per column to 2**, which is a
 * third fewer chances for a marble to fall into a box on each lap. That is a balance change, not a
 * look — nothing in the tuning has ever measured it — so the ball stops here.
 */
const MARBLE_R = 15;

/**
 * Clearance the box lids need below the rail, on top of the housing.
 *
 * ⚠ Reported from a screenshot as the rail "sitting on" the boxes. The balls reach 7px past the
 * shell and the lids were 10px below it — three pixels of daylight. Restoring the 15px the original
 * layout had costs 12px of height, which is 1.5% of the desktop width the trims bought. Worth it:
 * a rail that looks like it is grinding on the lids is a machine that looks broken.
 */
const BALL_CLEAR = 26;

/** Everything below the grid rises by this much; the machine loses it from its height. */
const TIGHTEN = TRIM_RIM + TRIM_PANEL;

// ── The chute, derived from its own geometry ────────────────────────────────
//
// ⚠ **The height is not a choice.** The walls must sit at `FUNNEL_ANGLE` or the marbles stop
// sliding — measured: at 22.5° they string out along the slope and never reach the neck. So the
// drop is whatever that angle needs to cross the horizontal distance from the cavity wall to the
// neck, and the only way to make the chute shorter is to shorten that distance: a narrower grid
// (breaks the pinned cell 64 / pitch 71) or a wider neck (breaks the single-file queue). Every
// other rearrangement — one segment, two, a shoulder and a cone — comes out at exactly the same
// number, because the angle and the run are what fix it.
/** Slope of the chute walls, from horizontal. Below ~30° the marbles stop sliding. */
const FUNNEL_ANGLE = 33;
/**
 * Where the taper begins: the cavity walls themselves, 48/492 -> 34/506.
 *
 * ⚠ **The cavity is the board's width, so widening it is the only way a board gets wider.** It
 * sat 34px inside each cabinet wall, which on a phone is 34px of white either side of every
 * board. 20px is as close as it can come: the belt housing reaches 32..508 and the cavity must
 * not read as wider than the rail it pours onto.
 *
 * ⚠ **It costs height, so the desktop does not get it.** `FUNNEL_DROP` is the run from wall to
 * neck at 33°, and 14px more run either side is ~9px more chute. The angle cannot absorb it —
 * below about 30° the marbles stop sliding — so the machine simply gets taller, and on a wide
 * frame `GAME_H` is clamped to the machine, so 9px of height is ~1% off how big the game draws.
 * A phone has height to spare and no width to spare; a landscape frame is the exact opposite.
 *
 * ⚠ **Same test as `HUD_LIFT`, deliberately.** `WIDE_HUD` is decided from the frame alone, before
 * anything about the machine exists, which is what makes it usable here — the honest condition is
 * "does this frame have height going spare", and that is `GRID_GROW`, which cannot be asked
 * because it is derived from the chute this very constant defines.
 */
const FUNNEL_WALL_L = WIDE_HUD ? 48 : 34;
const FUNNEL_WALL_R = GAME_W - FUNNEL_WALL_L;
const FUNNEL_NECK_L = 248;
const FUNNEL_NECK_R = 292;
const FUNNEL_SHOULDER_BASE = 622 - BOOST_LIFT - TRIM_TOP - TRIM_GAPS - TIGHTEN - 40 - HUD_LIFT;
/** Top of the cavity. The grid lives between this and `FUNNEL_SHOULDER`, and nowhere else. */
const GRID_TOP = 240 - BOOST_LIFT - TRIM_TOP - TRIM_GAPS - TRIM_RIM - HUD_LIFT;
const FUNNEL_DROP = Math.round(
  (FUNNEL_NECK_L - FUNNEL_WALL_L) * Math.tan((FUNNEL_ANGLE * Math.PI) / 180),
);

/** Height of the visible stack of boxes in one column. */
const BOX_VISIBLE_H = 5 * (42 + 3);
/**
 * Floor showing under the deepest box.
 *
 * ⚠ **The well has to read as a recess the boxes sit *in*.** Sized to the stack exactly, the
 * last row lands flush on the rim and the two rounded edges sit a pixel apart, which reads as the
 * bottom row being cut off rather than as a floor.
 */
const WELL_FLOOR = 12;
/**
 * How far the balls reach below the belt centreline, r + marbleR, **not** shell.
 *
 * ⚠ The balls hang past the chrome: 32 + 15 = 47 against a 40px shell. Deriving the box lids
 * from the shell put them five pixels under the balls, which reads as the rail grinding on them.
 */
const BELT_REACH = BELT_R + MARBLE_R;

const MACHINE_Y = 198 - TRIM_TOP - TRIM_GAPS - HUD_LIFT;
/**
 * The cabinet's actual top edge. `MACHINE_Y` is the number before the booster row lifts it.
 *
 * ⚠ **Everything that turns a design-space y into a height must subtract this, never
 * `MACHINE_Y`.** They differ by `BOOST_LIFT`, and getting it wrong makes the cabinet report itself
 * 40px shorter than it is. `H_MIN` is derived from that report, so the game then declares it can
 * live in a box whose bottom 40px are the box well, and on a desktop frame the last row of boxes
 * is cut off by the edge of the canvas. Shipped that way and reported from the live frame.
 */
const MACHINE_TOP = MACHINE_Y - BOOST_LIFT;

// ── How much taller the grid may be on this frame ────────────────────────────
//
// ⚠ **The board grows into height the frame is not using, and only into that.** The machine has
// a fixed height of its own; a portrait phone at 2.16:1 leaves ~240px of background below it,
// while a 16:9 desktop frame leaves none at all — `GAME_H` is clamped to the machine there, which
// is why every pixel of column on this layout has been fought over. So the growth is measured
// rather than chosen: whatever the frame has spare, less a skirt, capped.
//
// ⚠ **It is a two-pass derivation and it has to be.** `GRID_GROW` needs `GAME_H`, which needs
// `H_MIN`, which needs the machine's height, which needs `GRID_GROW`. The cycle breaks by deriving
// the machine **once without any growth** — `H_MIN_BASE` — clamping the frame against that, and
// only then spending what is left. Because the growth slides the chute, the belt and the well down
// as one block, the grown `H_MIN` is exactly `H_MIN_BASE + GRID_GROW`, which by construction still
// fits inside `GAME_H`.
//
// ⚠ **Everything below the grid moves; nothing stretches.** The cone keeps its 33° because both
// ends slide together. Moving one end alone is the 22.5° at which marbles stop sliding altógether,
// which the note on `funnel` describes.
const _BELT_CY_BASE = FUNNEL_SHOULDER_BASE + 6 + FUNNEL_DROP + 4 + BELT_SHELL;
const _WELL_BOTTOM_BASE = _BELT_CY_BASE + BELT_REACH + BALL_CLEAR + BOX_VISIBLE_H + WELL_FLOOR;
const H_MIN_BASE = _WELL_BOTTOM_BASE + 6 + 14 - TRIM_SKIRT;
const H_MAX = Math.max(1160, H_MIN_BASE);
const _aspect =
  typeof window !== "undefined" && window.innerWidth > 0
    ? window.innerHeight / window.innerWidth
    : H_MAX / GAME_W;
export const GAME_H = Math.round(
  GAME_W * Math.min(Math.max(_aspect, H_MIN_BASE / GAME_W), H_MAX / GAME_W),
);
/** Background left under the cabinet even on the tallest frame, so it stands on a floor. */
const GROW_KEEP = 44;
/**
 * ⚠ **The ceiling is what the grid can use, not what the frame can spare.** Past the point where
 * every board reaches `L.cell`, more height only pushes the machine down the screen: the cells stop
 * growing because `gridMetrics` caps them, and the rest becomes a taller empty cavity. Seven rows
 * at the full cell need 434px against a base of 308, so 130 is the last pixel that buys anything.
 */
const GROW_CAP = 130;
const GRID_GROW = Math.max(0, Math.min(GAME_H - H_MIN_BASE - GROW_KEEP, GROW_CAP));

/** The chute's shoulder, after the grid has taken whatever height this frame had spare. */
const FUNNEL_SHOULDER = FUNNEL_SHOULDER_BASE + GRID_GROW;
/** A lip, so the wall does not spring straight out of the cavity's rounded corner. */
const FUNNEL_TOP = FUNNEL_SHOULDER + 6;

/** Belt centreline: just under the chute's neck, plus its own housing. */
const BELT_CY = FUNNEL_TOP + FUNNEL_DROP + 4 + BELT_SHELL;
/** Foot of the box well, in design space: the lowest thing the cabinet has to contain. */
const WELL_BOTTOM = BELT_CY + BELT_REACH + BALL_CLEAR + BOX_VISIBLE_H + WELL_FLOOR;
// The cabinet ends just under the well, whose foot is derived from the chute above it.
const MACHINE_H = WELL_BOTTOM + 6 - MACHINE_TOP;


/**
 * Where the cabinet actually ends, and the one check the two-pass derivation owes.
 *
 * ⚠ `GAME_H` was clamped against `H_MIN_BASE`, the machine **before** the grid grew. The growth
 * then pushes the cabinet's foot down by exactly `GRID_GROW`, so the arithmetic that keeps it on
 * screen is `GRID_GROW <= GAME_H - H_MIN_BASE - GROW_KEEP` — which is how `GRID_GROW` is defined,
 * and therefore true by construction. It is asserted anyway: the last two times the bottom of this
 * machine went off the bottom of the canvas, it was a height derived from the wrong end, it was
 * invisible on every desktop here, and it was reported from a live phone as a game that could not
 * be started.
 */
const MACHINE_BOTTOM = MACHINE_TOP + MACHINE_H;
if (MACHINE_BOTTOM + 14 - TRIM_SKIRT > GAME_H) {
  console.warn(
    `[layout] day may (${MACHINE_BOTTOM}) vuot qua khung ${GAME_H} — GRID_GROW ${GRID_GROW} qua lon`,
  );
}

// ── Core rules ───────────────────────────────────────────────────────────────
/**
 * Marbles packed into one tray tile — the single biggest lever on how hot the belt runs.
 * One box only takes BOX_SLOTS, so a tray needs TRAY_N / BOX_SLOTS boxes of its colour open
 * at once or the remainder strands on the belt.
 *
 * Nine, matching the reference machine and the nine eggs drawn on the tile. It is expensive:
 * on the belt of 30 that suited trays of six, it drops the greedy bot to 45%. Paid for by
 * widening the belt to 36 (marbles down to r=12) and cutting the tray cap 16 → 11, which
 * leaves total marbles per level almost unchanged (11 x 9 = 99 against 16 x 6 = 96).
 */
export const TRAY_N = 9;
/**
 * From this level up, the box stacks are mostly `?` — the colours below the open box are hidden.
 *
 * ⚠ **Nothing below the top of a column is ever hidden**; the open box always shows its colour.
 * `Game.isBoxHidden` is `idx > 0 && …`, so the rule is about the second row down and everything
 * under it, and a player can always see what the board is asking for *right now*.
 */
export const BOX_HIDDEN_FROM = 21;

/**
 * What share of the boxes below the top of each column have their colour hidden.
 *
 * ⚠ **This is the one difficulty lever the tuner cannot see.** Bots read `boxes` directly, so
 * hiding a colour changes nothing any of them measure — `npm run sim`, `npm run tune` and the
 * `(B+D)/2` targets will all read exactly the same before and after. It costs a *person* the
 * ability to plan two rows ahead and costs a bot nothing at all, so it can never be traded off
 * against tray count or colour count on the same scale, and it must never be tuned by bot.
 *
 * ⚠ That blindness is precisely why it is the right lever here. Measured over 12 hours of real
 * play, people were clearing level 20 at 91% and level 25 at 86% against bot scores of 18% and 1%
 * — the boards are hard for something that pours flat out and easy for someone who can read the
 * stack. Taking the stack away is aimed at the gap itself.
 *
 * Easy slots get 70%, hard ones up to 90%, straight off the slot's own target winrate.
 *
 * ⚠ **A floor, never a cap** — same convention as the sheet. A drawing that asks for more keeps it.
 */
export function boxHiddenFrom(level: number, target: number, drawn = 0): number {
  if (level < BOX_HIDDEN_FROM) return drawn;
  const t = Math.max(0.05, Math.min(0.9, target));
  return Math.max(drawn, 0.9 - 0.2 * ((t - 0.05) / 0.85));
}

/** Holes in one box. Fill them all and the box pops off, exposing the next one below. */
export const BOX_SLOTS = 3;
/** Box columns at the bottom of the machine. Also the number of simultaneously open colours. */
export const BOX_COLS = 4;

/**
 * Boxes cleared in a row before the cabinet throws fireworks.
 *
 * ⚠ `sfx.boxClear` owns what "in a row" means — its `CHAIN_MS` window — and this only says how
 * long. The visual is not a second reward on its own schedule; it is the top of the one the ear is
 * already following, so a run that makes the bell climb has to be a run that lights the rim.
 *
 * ⚠ **One tier, at three.** A second tier at two was built and taken straight back out: two boxes
 * in a row is not rare enough to be worth marking, so it fired most of the time and turned the
 * fireworks into background noise — which costs the three-in-a-row burst the only thing it has,
 * being unusual. Rewarding less is what makes the reward land.
 */
export const COMBO_RUN = 3;
/**
 * Positions on the conveyor ring. This is the whole difficulty budget — fill it and you lose.
 *
 * Must stay a multiple of 2*CLEAT_GROUP: there is exactly one cleat per slot so every marble
 * sits dead centre in a hole, which means the dark/light banding has to close cleanly around
 * the loop or a seam travels round the belt forever. 30 = 6 x 5.
 */
export const BELT_SLOTS = 30;
/**
 * Marbles the chute will hold back while the belt is busy. A tap is gated on *this*, not on
 * free belt slots: the tray tips regardless and its marbles queue in the hopper until the rail
 * under the neck comes free, which is what the reference machine does — its funnel is often
 * carrying far more than the belt has room for.
 *
 * ⚠ Do not tune this against the greedy and random bots alone; see the table in CLAUDE.md.
 * A hopper changes nothing about colour matching, so the random bot sits at 26% whatever its
 * size. What grows with it is the rope available to a player with no self-control. 21 is the
 * smallest size at which the `patient` bot — same choices, but it refuses to tip a tray the
 * rail has no room for — starts to *beat* the greedy one, which is the point where knowing
 * when not to tip becomes a skill instead of a missed opportunity. Below that the hopper is
 * small enough that using it is always right; well above it (27, 36) even patient play falls
 * to 67% and 48%.
 */
export const CHUTE_CAP = 27;

/**
 * Up to and including this level, **winning is three stars**, however it was won.
 *
 * The opening run is where a player is still learning what the machine does, and a star rating
 * that judges them while they are learning is a rating of the tutorial, not of them.
 */
export const STAR_ALWAYS_TO = 20;
/**
 * Past `STAR_ALWAYS_TO`: first go is three stars, up to this many goes is two, after that one.
 */
export const STAR_TWO_TRIES = 5;

/** Rows in the tray grid. Columns vary by level. */
export const GRID_ROWS = 5;
/** Widest the *generator* builds. Hand-built boards may go up to GRID_MAX. */
export const GRID_COLS = 6;
/** Hard ceiling on a board in either direction. Past this the cells stop being tappable. */
export const GRID_MAX = 7;
/** How many boxes of a column are drawn before the stack runs off the bottom. */
export const BOX_VISIBLE = 5;

/**
 * Conveyor advances one slot per tick, and it is also the cadence marbles feed onto the belt
 * at. Purely a pacing dial — the sim counts ticks, not milliseconds, so changing it moves how
 * the game *feels* without touching a single balance number.
 *
 * Set from a real play log: twelve levels averaged 70 seconds each, two of them ran past 110.
 * For a game meant to be picked up between other things that is too long, and the belt speed
 * is most of it.
 */
export const TICK_MS = 165;

/**
 * Tick rate once every tray is gone and only the belt is still working. Nothing is left to
 * decide at that point, so the normal pace is just a wait — run the last lap at speed.
 */
export const TICK_MS_DRAINED = 90;

// ── Marble colours ───────────────────────────────────────────────────────────
export type Color = number;

export interface Swatch {
  name: string;
  base: number;
  light: number;
  dark: number;
}

export const PALETTE: Swatch[] = [
  { name: "blue", base: 0x2b5ce8, light: 0x6d92ff, dark: 0x1a3a9e },
  { name: "green", base: 0x23bb45, light: 0x62e37c, dark: 0x137a2b },
  { name: "orange", base: 0xff8a14, light: 0xffb862, dark: 0xc25c00 },
  { name: "yellow", base: 0xffd020, light: 0xffe883, dark: 0xc99a00 },
  { name: "cyan", base: 0x55d9f5, light: 0xa6efff, dark: 0x1f9cba },
  { name: "purple", base: 0xa341f0, light: 0xc989ff, dark: 0x6d1cab },
  { name: "pink", base: 0xff86c4, light: 0xffbadd, dark: 0xc94a8d },
  { name: "red", base: 0xec3d3d, light: 0xff8080, dark: 0xa71c1c },
  // ⚠ **Three added after the first eight, and the choice is constrained by what is already here.**
  // A marble is 15px and a tray face is a flat square of one colour, so two swatches that read as
  // the same colour at that size are not two pieces — they are one piece the player will mis-sort.
  // Teal sits between green and cyan and survives only because cyan is a pale wash and this is
  // saturated; lime is pushed yellow-ward hard enough to clear green; magenta is the deep end of
  // pink. Brown was rejected — it is the crate colour — and grey with it, because a face-down tray
  // is grey and the whole point of that tile is that it reads as "colour unknown".
  //
  // ⚠ **Adding entries does not change a single generated level.** `paramsFromD` caps colours at a
  // literal 8, not at `PALETTE.length`, and every level in `SHEET` names its own count. Only a
  // hand-built board can reach these, which is the intent: they are for the editor.
  { name: "teal", base: 0x109c8d, light: 0x4fd8c6, dark: 0x0a6459 },
  { name: "lime", base: 0x9ad514, light: 0xc6f25c, dark: 0x638c00 },
  { name: "magenta", base: 0xd81b9c, light: 0xff62c8, dark: 0x8f0a66 },
  /**
   * ⚠ **Brown and grey each collide with a piece that is not a tray, and both were added anyway.**
   * Requested twice; the risk is written down here rather than argued about.
   *
   *   brown vs the **crate**  — the crate face is a #b98a52 -> #8d6236 tan with planks and a brace
   *     drawn on it. This brown is deliberately much darker so the two do not sit in the same band
   *     of lightness, and the crate keeps its woodgrain, which is the other half of telling them
   *     apart. A crate is the one thing on the board the player can do nothing about, so reading a
   *     tray as a crate costs them the move rather than just the sort.
   *
   *   grey vs the **face-down "?" tile** — that tile is #8d9bb4 -> #75839c, a *blue* slate. This
   *     grey is neutral, no blue cast, and darker. The "?" glyph is the real separator; the danger
   *     is the 15px marble on the rail, where there is no glyph and no tile, only the colour.
   *
   * Watch both on a phone before shipping a board that uses them next to a crate or a "?".
   */
  { name: "brown", base: 0x7a4b22, light: 0xb07a4a, dark: 0x4a2a10 },
  { name: "grey", base: 0x7e8388, light: 0xb4babf, dark: 0x4d5257 },
];

// ── Chrome ───────────────────────────────────────────────────────────────────
export const UI = {
  bg: 0x3d3a7a,
  bgTop: 0x2f2c63,
  bgBottom: 0x6a4f9e,
  glow: 0x8f7ce8,
  // ⚠ Three tones, not two, and only the middle one is solid slate.
  //
  //   machine   — the cabinet interior, white. It is the *ground* the board sits on.
  //   panelDeep — the rim around the cavity. The only slate in the machine, and what makes the
  //               silhouette read: a walled level's casing is this colour, so the board's own
  //               outline and its edge are visibly the same material.
  //   panel     — the cavity floor, white again, so it runs continuous into the funnel below.
  //
  // Filling the cavity with slate (or painting the whole cabinet slate) both collapse it to two
  // tones and lose the outline: the first makes the board a dark sticker on a white box, the
  // second makes the casing read as the hole rather than the solid part.
  machine: 0xdfe6f5,
  machineEdge: 0xa9b6d6,
  panel: 0xf4f7fd,
  panelDeep: 0x9fb0cb,
  cell: 0xe4ebf8,
  belt: 0x6f7686,
  beltDeep: 0x565d6b,
  beltLight: 0x8b93a3,
  chrome: 0xf3f6fc,
  ink: "#2b3550",
  /**
   * The level pill and the coin, and now the mount under the booster too.
   *
   * ⚠ **The middle stop of the `btn("purple")` bake, and `textures.ts` reads it from here.** It was
   * 0x8f7ce8 and nothing read it at all: the pills were three hex literals a hundred lines away in
   * the bake, so this token was a colour the game did not use, sitting under the name of a colour it
   * did. Anything that has to match the pills — the booster's mount does, on a phone — would have
   * been a fourth copy.
   */
  pill: 0x7f6ada,
  pillEdge: 0x6a56c4,
  gold: 0xffc21e,
  green: 0x4bc84b,
  greenEdge: 0x2f8f2f,
};

// ── Layout, in design units ──────────────────────────────────────────────────



export const L = {
  hudY: 62 - TRIM_TOP,
  // Row gaps close up with everything else; the buttons keep their size.
  /**
   * The booster's seat, in the gap between the gear and the level pill.
   *
   * ⚠ Measured against the HUD, not chosen: the gear ends at x 83 and the level pill starts at 210,
   * so a 76px button centred at 140 clears both by about 20px. Its badge hangs to the lower right
   * and reaches ~191, still short of the pill. Move any of those three and this has to move too —
   * there is no room to absorb a shift.
   */
  /**
   * The booster's seat: on the HUD line, tucked against the level pill.
   *
   * ⚠ Measured, not chosen. The pill spans CX±60 and the gear ends at CX-187, so a 60px button
   * centred at CX-100 leaves 10px to the pill and 27px to the gear. Its badge hangs to the lower
   * right and reaches CX-64 — still clear. Move the pill or the gear and this has to move with them.
   */
  /**
   * ⚠ **On the HUD line, in the gap between the level pill and the coin.** The pill ends at 212 and
   * the coin starts at 400, so 306 is the middle of that 188px gap. The booster's pad reaches ±57 —
   * far wider than its 46px frame — so it needs the whole gap, not just the button's worth of it.
   * Move the pill or the coin and this has to move with them; there is no slack either side.
   */
  boostX: 306,
  boostY: 62 - TRIM_TOP,
  /**
   * The green frame behind the magnet. **Half the icon**, on purpose.
   *
   * ⚠ Not the tap target. The frame is what is drawn; the hit zone is sized separately and stays
   * finger-sized — shrinking a button's art and its hit area together is how a control ends up
   * "sometimes not working" on a phone and nowhere else.
   */
  boostSize: 46,
  /**
   * The HUD's column on a wide frame, in root-local design space — so `x` is **negative**, out in
   * the pad to the left of the machine.
   *
   * ⚠ Only read when `WIDE_HUD`. On a phone `STAGE_PAD` is 0, this column would sit on top of the
   * cabinet, and `hudY`/`boostX`/`boostY` above are still the layout.
   */
  hudCol: {
    x: -STAGE_PAD / 2,
    gearY: 52,
    levelY: 118,
    coinY: 180,
    boostY: 276,
  },

  // ⚠ Widened 488 -> 512 to make room for the bigger rail. The grid cavity did not move (48..492);
  // what grew is the shoulder either side of it, which is where the rail now ends.
  machine: { x: 14, y: MACHINE_TOP, w: 512, h: MACHINE_H },

  gridPanel: { x: FUNNEL_WALL_L, y: GRID_TOP, w: FUNNEL_WALL_R - FUNNEL_WALL_L, h: FUNNEL_SHOULDER - GRID_TOP },
  /**
   * Tray size — the **cap**, and the size the sprites are baked at. 56 -> 64, back where it began.
   *
   * ⚠ This is a ceiling, not the size a board draws at: `gridMetrics` takes the smaller of what
   * the width allows, what the height allows, and this. It went down to 56 to buy column height
   * for the booster's own row; that row is gone, the grid has taken the height back, and leaving
   * the cap at 56 would mean the extra room bought nothing at all.
   *
   * ⚠ **A cap below what the panel can fit is invisible.** Every board measured 56 exactly while
   * the panel could fit 82 — the numbers looked like a width limit and were the cap, which is the
   * kind of thing that gets diagnosed twice.
   */
  cell: 64,
  gap: 7,

  // The chute proper starts well below the grid — above `top` the walls run straight down,
  // so the funnel reads as a tight hopper on the machine rather than a big empty wedge.
  // The neck is barely wider than one marble, which forces the queue single-file.
  // `brake` is where marbles start creeping, not `top`: braking from the mouth of the cone
  // makes them hang about halfway down and never reach the rail. They should tumble most of
  // the chute at speed and only slow over the last stretch into the neck.
  // ⚠ One chute, the same for every board size, and **do not shorten it**. A chute that moved
  // or resized with the grid would give each board a different drop, so the feel of the fall —
  // the thing the physics exists for — would change level to level. The grid grows into the
  // space above it instead, and `GRID_MAX_H` is what stops it reaching the cone.
  //
  // ⚠ Squeezing this to make room for a 7-row grid was tried and it broke the drop: compressing
  // 186px to 120px takes the cone from 33° to 22.5°, and at 22.5° the marbles stop sliding.
  // They strung out along the slope and sat there — the exact failure the note above `brake`
  // describes, reached from the other direction. Screenshot after eight taps on level 5 if this
  // is ever changed again.
  // ⚠ Every y here carries `BOOST_LIFT` so the chute keeps its exact length and cone angle — the
  // whole assembly slides, none of it stretches. Lifting `top` without `neckY` shortens the cone,
  // which is the 33°→22.5° failure the note above warns about, arrived at by accident.
  funnel: {
    shoulder: FUNNEL_SHOULDER,
    top: FUNNEL_TOP,
    brake: FUNNEL_TOP + Math.round(FUNNEL_DROP * 0.43),
    // ⚠ **The taper starts at the cavity wall, not inside it.** It used to begin at 54/486 — six
    // pixels in from the cabinet — which made the chute a wide wedge with a short vertical lip on
    // top. Starting it at the wall turns the whole thing into one continuous funnel, which is what
    // the reference machine looks like *and* is shorter: the 200px of horizontal run is now all
    // doing work instead of 194 of it, so the same 33° covers the distance in less height.
    mouthL: FUNNEL_WALL_L,
    mouthR: FUNNEL_WALL_R,
    // The neck runs all the way down to the belt housing. Ending it higher leaves marbles
    // popping onto the rail out of thin air, with a gap of empty machine in between.
    neckY: FUNNEL_TOP + FUNNEL_DROP,
    // ⚠ Widened with the ball, by the same proportion. The neck is "barely wider than one marble"
    // and that is what forces the queue single-file: 28 in 40 becomes 30 in 44. Widen it further and
    // two balls sit abreast, which is the whole mechanic gone.
    neckL: FUNNEL_NECK_L,
    neckR: FUNNEL_NECK_R,
  },

  // hx is sized so the belt's bottom run spans the whole box row — a marble has to
  // physically travel over a column to be able to drop into it, so any column sticking out
  // past the straight would be served from its edge instead of its middle.
  belt: {
    cx: 270,
    cy: BELT_CY,
    hx: BELT_HX,
    r: BELT_R,
    shell: BELT_SHELL,
  },
  marbleR: MARBLE_R,

  // ⚠ The gap under the rail is measured from the **balls**, not from the housing. A marble sits at
  // `cy ± (r + marbleR)` = 47 either side of the belt centre while the shell is only 40, so the balls
  // hang 7px below the chrome. Sizing this off the shell put them 3px from the box lids — visibly
  // resting on them.  is what they actually occupy.
  box: {
    top: BELT_CY + BELT_R + MARBLE_R + BALL_CLEAR,
    w: 100,
    gap: 6,
    h: 42,
    vgap: 3,
  },
};

export const CELL_PITCH = L.cell + L.gap;

/** Centre x of box column `j` — the conveyor's bottom run passes right over these. */
export function boxColX(j: number): number {
  const total = BOX_COLS * L.box.w + (BOX_COLS - 1) * L.box.gap;
  return (GAME_W - total) / 2 + L.box.w / 2 + j * (L.box.w + L.box.gap);
}

/**
 * Cell size and origin for a board of this shape.
 *
 * ⚠ A 5-row board must come out **pixel-identical to before this existed**: cell 64, pitch 71,
 * vertically centred in `gridPanel`. Every level shipped so far is 5 rows and every screenshot,
 * every art decision and the whole feel of the drop was settled against those numbers.
 *
 * Bigger boards shrink the cell instead of growing the panel, because the panel cannot grow
 * sideways — the cabinet is only so wide — and cannot grow down without eating the chute. A 7x7
 * lands on cell 58, which is still comfortably above the marble radius.
 */
export const GRID_GAP = 7;
/** The most room the grid may take. Width is the cabinet minus its shoulders; height stops at the
 *  mouth of the cone — a tray drawn any lower would sit inside the chute. */
const GRID_MAX_W = FUNNEL_WALL_R - FUNNEL_WALL_L - 3;
/**
 * The grid stops **at the shoulder of the chute**, and this is that number rather than one typed
 * next to it.
 *
 * ⚠ **A board may not grow down into the funnel.** It was 60px more than the panel it sits in, so
 * every board over five rows — **63 of the 115 shipped levels** — hung past the bottom of the
 * cavity and covered the top of the chute. At six rows that was 57px of a 136px funnel: the V had
 * lost half its height and the board looked like it was sitting on the belt. Reported from level 40.
 *
 * ⚠ The consequence is that tall boards get **smaller cells**, and that is the trade being made
 * knowingly: a six-row board lands on 45 rather than 55. The alternative is more height, and height
 * is the one thing the desktop layout has none of — `GAME_H` is clamped to the machine there, so
 * every pixel spent here is a pixel off how big the game draws on every PC.
 *
 * ⚠ Five-row boards are untouched: 308 fits five cells of `L.cell` exactly.
 */
const GRID_MAX_H = FUNNEL_SHOULDER - GRID_TOP;

/**
 * The part of the grid a board actually occupies, in cells — everything outside it is casing.
 *
 * ⚠ **This is what the cells are sized against, not `cols x rows`.** A board is declared on a grid
 * and then a silhouette is cut out of it, so the declared size is an upper bound and often not the
 * board: **71 of the 115 shipped levels** declare a grid bigger than the shape inside it, and level
 * 7 declares 6x6 for a board that is 5x5. Sizing off the declaration made those levels draw at 45px
 * cells inside a cabinet they used two thirds of — reported as *"level này sao bé thế"*. Sizing off
 * the shape puts 39 of them back on the full `L.cell`.
 */
export interface GridBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GridMetrics {
  cell: number;
  pitch: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** y of the lowest cell's bottom edge — where the chute has to start. */
  bottom: number;
}

export function gridMetrics(cols: number, rows: number, used?: GridBox): GridMetrics {
  // ⚠ Sized and centred on the **shape**, indexed from the declared grid. `x`/`y` stay the origin
  // of cell (0,0) so every caller keeps reading `gm.x + col * gm.pitch`; they are simply shifted so
  // that the occupied part lands in the middle of the cabinet. Rows of pure casing may then fall
  // outside the panel, which costs nothing — `drawGridCavity` draws playable cells only, and a
  // pointer landing out there hits a walled cell and is refused like any other.
  const box = used ?? { x: 0, y: 0, w: cols, h: rows };
  const fitW = Math.floor((GRID_MAX_W + GRID_GAP) / Math.max(1, box.w)) - GRID_GAP;
  const fitH = Math.floor((GRID_MAX_H + GRID_GAP) / Math.max(1, box.h)) - GRID_GAP;
  const cell = Math.max(28, Math.min(L.cell, fitW, fitH));
  const pitch = cell + GRID_GAP;
  const w = cols * pitch - GRID_GAP;
  const h = rows * pitch - GRID_GAP;
  // ⚠ Centred in the panel, and `GRID_MAX_H` guarantees it fits. This used to say that a board
  // taller than the panel "hangs from its top edge and takes the extra height out of the chute
  // below", and it did — 57px of it on a six-row board. Cells shrink instead; the chute is not
  // spare room.
  const uw = box.w * pitch - GRID_GAP;
  const uh = box.h * pitch - GRID_GAP;
  const x = Math.round((GAME_W - uw) / 2) - box.x * pitch;
  const y = Math.round(L.gridPanel.y + Math.max(0, L.gridPanel.h - uh) / 2) - box.y * pitch;
  return { cell, pitch, x, y, w, h, bottom: y + h };
}

/** Top-left of the tray grid. Kept for callers that only care where it starts. */
export function gridOrigin(cols: number, rows = GRID_ROWS): { x: number; y: number } {
  const m = gridMetrics(cols, rows);
  return { x: m.x, y: m.y };
}

// ── The conveyor path ────────────────────────────────────────────────────────
// A stadium: top straight (travelled right→left), left cap, bottom straight
// (left→right, over the boxes), right cap. Distance 0 is the right end of the top
// straight, so the funnel drops in at distance `hx` — dead centre of the top run.

const B = L.belt;
export const BELT_STRAIGHT = 2 * B.hx;
export const BELT_CAP = Math.PI * B.r;
export const BELT_PERIM = 2 * BELT_STRAIGHT + 2 * BELT_CAP;
/** Gap between neighbouring marbles on the belt. */
export const BELT_SPACING = BELT_PERIM / BELT_SLOTS;
/** Path distance of the slot a marble drops into, measured from distance 0. */
export const BELT_ENTRY_D = B.hx;

export interface BeltPoint {
  x: number;
  y: number;
  /** true while the point is on the bottom straight, the only stretch that feeds boxes */
  onBottom: boolean;
}

/** Point on the conveyor centreline at path distance `d` (wraps). */
export function beltPointAt(d: number): BeltPoint {
  let t = d % BELT_PERIM;
  if (t < 0) t += BELT_PERIM;

  // top straight: right → left
  if (t < BELT_STRAIGHT) {
    return { x: B.cx + B.hx - t, y: B.cy - B.r, onBottom: false };
  }
  t -= BELT_STRAIGHT;

  // left cap: sweeps from the top-left round to the bottom-left
  if (t < BELT_CAP) {
    const a = -Math.PI / 2 - (t / BELT_CAP) * Math.PI;
    return { x: B.cx - B.hx + B.r * Math.cos(a), y: B.cy + B.r * Math.sin(a), onBottom: false };
  }
  t -= BELT_CAP;

  // bottom straight: left → right, directly above the boxes
  if (t < BELT_STRAIGHT) {
    return { x: B.cx - B.hx + t, y: B.cy + B.r, onBottom: true };
  }
  t -= BELT_STRAIGHT;

  // right cap: bottom-right back up to the top-right
  const a = Math.PI / 2 - (t / BELT_CAP) * Math.PI;
  return { x: B.cx + B.hx + B.r * Math.cos(a), y: B.cy + B.r * Math.sin(a), onBottom: false };
}

/**
 * For every belt slot, which box column sits under it (or -1).
 *
 * Precomputed once because the tick loop asks this for all 32 slots, every tick. A slot
 * is "over" a column whenever its centre falls inside the column's width, so a marble
 * lingers over a column for several slots — that is what lets a marble already sitting
 * there drop the instant that column's next box turns its colour.
 */
export const SLOT_COLUMN: number[] = (() => {
  const out: number[] = [];
  for (let i = 0; i < BELT_SLOTS; i++) {
    const p = beltPointAt(BELT_ENTRY_D + i * BELT_SPACING);
    let col = -1;
    if (p.onBottom) {
      for (let j = 0; j < BOX_COLS; j++) {
        if (Math.abs(p.x - boxColX(j)) <= L.box.w / 2) {
          col = j;
          break;
        }
      }
    }
    out.push(col);
  }
  return out;
})();

/** Point a marble leaves the neck from, where its slide onto the rail begins. */
export const FEED_FROM = { x: L.belt.cx, y: L.funnel.neckY - 14 };

/** World position of belt slot `i`, interpolated `frac` of the way to the next slot. */
export function slotPos(i: number, frac: number): BeltPoint {
  return beltPointAt(BELT_ENTRY_D + (i + frac) * BELT_SPACING);
}

/**
 * Cleats drawn on the belt surface, in repeating groups of three dark then three light.
 *
 * Exactly one per marble slot, sharing the slot's own path offset. Any other count and the
 * two run on different pitches, so a marble only lines up with a hole now and then and the
 * rest of the time sits visibly off-centre.
 */
export const CLEAT_GROUP = 3;
export const BELT_CLEATS = BELT_SLOTS;

export function cleatPos(i: number): BeltPoint {
  return beltPointAt(BELT_ENTRY_D + i * BELT_SPACING);
}

/** true for the lighter half of each six-cleat band. */
export function cleatLight(i: number): boolean {
  return Math.floor(i / CLEAT_GROUP) % 2 === 1;
}
