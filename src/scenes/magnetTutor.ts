// Teaching the magnet booster — a scripted lesson on one level, once ever.
//
// The walkthrough on level 1 teaches the machine; `coach.ts` teaches the pieces on the board. This
// is a third thing and it is different in kind: it teaches a *button*, and a button cannot be
// explained by pointing at it, because what it does only makes sense in a position the player has
// to be standing in first. So the lesson builds the position — two trays of a colour nothing can
// accept — and only then names the button.
//
// ⚠ **It gates input, and that breaks the rule the level-1 walkthrough follows.** That rule exists
// for a good reason (a card that swallows taps also swallows `window.__ms.tap()` and every
// `npm run shot` run, so the one screen a reviewer sees is the one nothing can drive). The gate
// here is therefore installed at the **pointer handler**, not inside `onTapCell` — so a synthetic
// tap through `__ms` walks straight past it and every tool still works. Blocking was asked for
// deliberately: the lesson's third beat is "wait", and a player who pours another tray during it
// has changed the position the fourth beat is about to explain.
//
// ⚠ **But the gate is now bounded, because unbounded it was the worst screen in the game.** The
// "press" beat waits for the player to find a 60px button on the HUD, and until they do, every
// tray refuses the tap. Measured on real telemetry: level 6 was abandoned on **24% of entries
// against 10% for every other level**, and the abandoned attempts produce no end row at all —
// not a loss, nothing. One device entered it three times in 37 seconds. That is what a board
// that answers every touch with a refusal looks like from the player's side.
//
// So `RELEASE_MS` caps any beat that blocks. When it fires the lesson simply ends: the board is
// the player's again and the magnet counts as taught. They keep the two magnets it granted, so
// the button is still there to be discovered. Teaching a booster is worth a few seconds of the
// player's attention; it is not worth the player.
//
// ⚠ **Which trays it points at come from the board, not from a list.** The level number is pinned
// (`MAGNET_TUTOR_LEVEL`) because "where to teach this" is a design decision, but everything inside
// is derived — recolour level 6 and the lesson follows it.

import Phaser from "phaser";
import { GAME_H } from "../game/config";
import { Game } from "../game/logic";
import { coachPlate, coachRingBold } from "./tutorial";
import { K, TS, img } from "../game/textures";

/** Beats of the lesson, in order. */
type Beat = "tap" | "wait" | "press" | "done";

/**
 * Where the hand starts its run: **the middle of the screen**.
 *
 * ⚠ Not an offset from the button. A short hop starting just beneath it is only visible to someone
 * already looking at the button — precisely the player who did not need a hand. The eye has spent
 * three beats down among the trays and the rail, so the run has to begin where the eye already is
 * and carry it all the way up.
 */
const START_Y = GAME_H / 2;

/**
 * How long a blocking beat may hold the board before the lesson gives up on itself.
 *
 * ⚠ Per beat, not for the lesson as a whole. "wait" normally ends in about two seconds when the
 * marbles reach the rail, so this never fires there — but it is the same failure if it ever hangs,
 * and one rule covering both is better than a second timer written later for the case that was
 * missed. "press" is the one that needed it.
 */
const RELEASE_MS = 5000;

export interface MagnetTutorHooks {
  /**
   * Screen position of a grid cell's centre, **and how big a cell is**.
   *
   * ⚠ The size is not decoration. A board may be up to 7x7 and the cell shrinks to fit (64 on a
   * 5-row board, 57 on a 7x7), so a marker sized by a fixed number is right on one board and wrong
   * on the next. The ring is drawn to the cell.
   */
  cellAt(cell: number): { x: number; y: number; size: number };
  /** Screen position of the magnet button. */
  buttonAt(): { x: number; y: number };
}

/**
 * Diameter of `coachRingBold`'s steady circle at `grow = 1`, in design units.
 *
 * ⚠ Derived from how that helper draws — a 64px texture at `1.05 * grow / TS` — so that asking for
 * "a ring one cell wide" is arithmetic rather than a number found by squinting at a screenshot.
 * It only has to be revisited if the helper's own scale changes.
 */
const RING_UNIT = (64 * 1.05) / TS;

export class MagnetTutor {
  private beat: Beat = "tap";
  /** The one tray the lesson opens on. */
  private target = -1;
  /** Its colour's name, for the captions — the lesson does not know it is blue. */
  private colorName = "";
  /** Either marker — the plain ring on a tray, the heavy one on the button. */
  private ring: Phaser.GameObjects.GameObject | null = null;
  private plate: Phaser.GameObjects.Graphics | null = null;
  private label: Phaser.GameObjects.Text | null = null;
  /** The pointing hand that runs up to the booster on the last beat. */
  private hand: Phaser.GameObjects.Image | null = null;
  private timer: Phaser.Time.TimerEvent | null = null;
  /** When the current beat began — the watchdog measures from here. Stamped by `draw`. */
  private beatAt = 0;

  constructor(
    private scene: Phaser.Scene,
    private layer: Phaser.GameObjects.Container,
    private board: Game,
    private hooks: MagnetTutorHooks,
  ) {}

  /**
   * Can this lesson run on this board at all?
   *
   * ⚠ Asked before anything is drawn, because a lesson that starts and then cannot finish is worse
   * than one that never ran: its third beat waits for a magnet plan, and with the wrong two trays
   * that wait never ends. So the trays are chosen first and the lesson only opens if a pair exists.
   */
  static pick(board: Game): number {
    // A colour worth teaching with is one **no open box accepts** — pouring it is what creates the
    // jam the magnet undoes — and which has boxes waiting further down, so a plan can form.
    const open = new Set(board.boxes.map((b) => b.stack[0]));
    const deeper = new Map<number, number>();
    board.boxes.forEach((b) =>
      b.stack.forEach((c, k) => {
        if (k > 0) deeper.set(c, (deeper.get(c) ?? 0) + 1);
      }),
    );
    const free: number[] = [];
    for (let i = 0; i < board.tiles.length; i++) {
      const t = board.tiles[i];
      if (!t || t.hidden || t.wide) continue;
      if (board.anchorAt(i) !== i) continue;
      if (!board.canEscape(i)) continue;
      free.push(i);
    }
    // ⚠ **One tray is enough, and it has to be.** A tray is `TRAY_N` = 9 marbles and a plan needs
    // `2 * BOX_SLOTS` = 6 of one colour on the rail, so a single pour covers it with three to
    // spare. Asking for a second was padding: it made the lesson longer without making it clearer,
    // and it halved the number of boards the lesson could run on.
    let best = -1;
    let bestDeep = 0;
    for (const [color, n] of deeper) {
      if (open.has(color)) continue;
      if (n < 2) continue;
      // ⚠ Lowest row first. A tray on the bottom row sits on the chute mouth and can always be
      // poured, so the lesson cannot be blocked by its own only instruction.
      const mine = free.filter((i) => board.tiles[i]!.color === color).sort((a, b) => b - a);
      if (mine.length && n > bestDeep) {
        best = mine[0];
        bestDeep = n;
      }
    }
    return best;
  }

  start(target: number, colorName: string) {
    this.target = target;
    this.colorName = colorName;
    this.beat = "tap";
    this.draw();
  }

  get finished(): boolean {
    return this.beat === "done";
  }

  /** Cells the player may pour right now. Empty array means "none". */
  allowedCells(): number[] {
    return this.beat === "tap" ? [this.target] : [];
  }

  /** May the magnet button be pressed right now? */
  allowBooster(): boolean {
    return this.beat === "press";
  }

  /** A tray was poured. */
  noteTap(cell: number) {
    if (this.beat !== "tap" || cell !== this.target) return;
    this.beat = "wait";
    this.draw();
  }

  /** The magnet fired. */
  noteBooster() {
    if (this.beat !== "press") return;
    this.beat = "done";
    this.clear();
  }

  /**
   * Called every tick while the lesson is open.
   *
   * ⚠ The "wait" beat ends when a plan actually exists, **not** on a timer. The marbles take as
   * long as the physics takes — a fixed delay would point at the button on a board where pressing
   * it does nothing, which teaches the opposite of the lesson.
   */
  tick() {
    // ⚠ Checked before anything else, and it ends the lesson rather than merely un-gating it.
    // Leaving the card up but tappable sounds gentler and is worse: `finished` would stay false,
    // so the lesson would still be owed and would re-arm on the next level, and the next, gating
    // the board for another eight seconds each time. One exit, the same one the press uses.
    //
    // ⚠ Driven off `tick`, which `GameScene` only calls while the game is running — so a player
    // who opens settings and reads for a minute is not timed out by a clock they could not see.
    if (this.beat !== "tap" && this.scene.time.now - this.beatAt > RELEASE_MS) {
      this.beat = "done";
      this.clear();
      return;
    }
    if (this.beat !== "wait") return;
    if (this.board.revivePlan()) {
      this.beat = "press";
      this.draw();
    }
  }

  private draw() {
    this.clear();
    // Every beat change goes through here, so this is the one place the watchdog has to be reset.
    this.beatAt = this.scene.time.now;
    let at: { x: number; y: number } | null = null;
    let text = "";
    let grow = 1;
    /** Where the hand runs, if this beat has one: start y, end y, and how long the trip takes. */
    let run: { x: number; from: number; to: number; ms: number } | null = null;
    if (this.beat === "tap") {
      const cell = this.hooks.cellAt(this.target);
      at = cell;
      // ⚠ **Sized to the cell, and much bigger than it was.** The plain ring pulsed from 27px out
      // to 48px inside a 64px tray — it never reached the tray's own edge, so the loudest thing on
      // screen was smaller than the thing it was pointing at, and the first instruction of the
      // lesson was the easiest one to miss. This makes the steady circle exactly one cell across
      // and the pulses roughly two, on any board size.
      grow = cell.size / RING_UNIT;
      // ⚠ And a hand, for the same reason it was needed on the button: a ring says "something here",
      // a hand says "this one". The trip is short and local — unlike the button's, which has to
      // carry the eye off the board entirely — because the player is already looking at the grid.
      run = { x: cell.x, from: cell.y + cell.size * 2.2, to: cell.y + 38, ms: 900 };
      text = `Pour this ${this.colorName} tray`;
    } else if (this.beat === "wait") {
      // ⚠ Names the colour it actually picked. It said "blue" while the tray was chosen from the
      // board — right on level 6 and wrong on every other board the lesson can now run on.
      text = `No box wants ${this.colorName} — watch them pile up`;
    } else if (this.beat === "press") {
      at = this.hooks.buttonAt();
      // ⚠ Much bigger than a tray ring, because it is pointing at something much smaller and much
      // further from where the player has been looking: a 76px button above the HUD, after four
      // beats spent entirely on the board.
      grow = 1.75;
      // ⚠ Offset to the **left** of centre, unlike the tray's hand. The fingertip still has to land
      // on the button, but the count badge sits at the button's bottom-right — and on the right the
      // hand covered it at the exact moment the lesson says "press this", hiding how many the
      // player has to press it with.
      run = { x: at.x - 20, from: START_Y, to: at.y + 46, ms: 1250 };
      text = "The magnet lifts 6 balls off the belt into 2 boxes";
    }
    if (at) {
      // ⚠ Both marked beats use the **bold** ring now. The plain one is a single pulse that fades
      // to nothing, so for much of every 1.1s cycle there is nothing on screen at all — which is
      // survivable for a caption the player is already reading and not survivable for the one
      // instruction the whole lesson is waiting on.
      this.ring = coachRingBold(this.scene, at.x, at.y, grow);
      this.layer.add(this.ring);
    }

    // ⚠ A hand that **travels**, on both beats that ask the player to touch something.
    //
    // The ring alone was not enough here and the reason is where the player is looking. Three beats
    // have just been spent on the board — pour this tray, watch them pile up — so the eye is down
    // among the trays and the rail. The button is a 76px square above the HUD, in a strip nothing
    // has asked them to look at yet, and a pulse that appears up there is competing with a belt
    // full of marbles moving in the other direction. A hand that sets off from where they *are* and
    // climbs to where they need to look drags the eye with it; a hand that simply appears on the
    // button is one more thing blinking in a corner.
    //
    // ⚠ It starts **below** the button and ends on it — never the reverse. Travel direction is the
    // whole message: it reads as "come up here", where downward would read as the button doing
    // something to the board.
    if (run) {
      const hand = img(this.scene, K.hand, run.x, run.from);
      this.hand = hand;
      this.layer.add(hand);
      // ⚠ Fades out and restarts rather than sliding back down. A hand that retreats has just
      // undone the instruction it delivered, and on a loop the eye ends up following the *return*
      // trip — which points away from the button.
      this.scene.tweens.chain({
        targets: hand,
        loop: -1,
        tweens: [
          // ⚠ The duration belongs to the trip, not to the hand. The button's run crosses most of
          // the screen and at 900ms read as something being flicked upward rather than travelling;
          // the tray's run is a couple of cells and at 1250ms it would crawl.
          { alpha: { from: 0, to: 1 }, y: { from: run.from, to: run.to }, duration: run.ms, ease: "Sine.easeOut" },
          { alpha: 0, duration: 280, delay: 420 },
        ],
      });
    }
    if (text) {
      // ⚠ The same plate the walkthrough and the coach cards use, in the same strip of chute. Three
      // different-looking captions would be three visual languages for "look here".
      // ⚠ It places itself at `funnel.shoulder + 44` — the throat of the chute — and that position
      // is not a parameter. Every caption in the game sits there, so moving one is teaching the
      // player to look in two places.
      const { plate, label } = coachPlate(this.scene, text);
      this.plate = plate;
      this.label = label;
      this.layer.add([plate, label]);
    }
  }

  private clear() {
    this.timer?.remove();
    this.timer = null;
    // ⚠ Kill the tween before destroying the target. A chained tween holds its own reference and
    // goes on ticking a destroyed image, which throws on the next frame rather than here — the
    // sort of error that gets blamed on whatever ran next.
    if (this.hand) this.scene.tweens.killTweensOf(this.hand);
    this.ring?.destroy();
    this.plate?.destroy();
    this.label?.destroy();
    this.hand?.destroy();
    this.ring = null;
    this.plate = null;
    this.label = null;
    this.hand = null;
  }

  destroy() {
    this.clear();
  }
}
