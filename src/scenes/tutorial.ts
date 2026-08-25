// The level-1 walkthrough.
//
// Four coach marks, in the order the machine actually works: pour a tray, watch the marbles ride
// the belt, watch one drop into a box of its colour, fill every box.
//
// ⚠ **It never blocks input.** Every step advances on something the player did or on a timer; none
// of them swallows a tap. A tutorial that gates taps would also gate `window.__ms.tap()` and every
// `npm run shot` run, so the one screen every reviewer sees would be the one nothing can drive.
// The cost is that a player can tap past it, which is the right trade — they have already learned
// the thing the step was about.
//
// ⚠ **English, like the rest of the UI.** `public/fonts/LilitaOne.ttf` is a Latin-only subset with
// no Vietnamese glyphs; non-ASCII falls back to Arial glyph-by-glyph and looks broken. Swapping in
// a full Lilita One is what unblocks Vietnamese copy here and everywhere else.
//
// ⚠ Presentation only. It reads the board to find a tray worth pointing at and otherwise decides
// nothing — no rule lives here, so the headless sim is unaffected by its existence.

import Phaser from "phaser";
import { GAME_W, L, UI } from "../game/config";
import { save } from "../game/save";
import { K, TS, img } from "../game/textures";
import { teachAll } from "../game/teach";

const FONT = '"Lilita One", Arial, sans-serif';

/**
 * `UI.ink` as a number, for `Graphics.fillStyle`.
 *
 * ⚠ Derived from the string rather than written out again. The palette keeps ink as a CSS string
 * because every other use is a text stroke; a second literal here is one more copy of a colour to
 * drift, and this file would be the one nobody thinks to update.
 */
const INK = Phaser.Display.Color.HexStringToColor(UI.ink).color;

/**
 * How long the player may sit doing nothing before the walkthrough points at another tray.
 *
 * ⚠ The clock only runs **after the four captions are done**. Started at the first pour it would
 * fire in the middle of them — the belt caption alone runs 2.2s and the box caption 2.8s — and the
 * nudge draws on the same plate, so the two would take turns overwriting each other while the
 * player watched. The walkthrough has to finish saying its piece before it starts nagging.
 */
const IDLE_MS = 5000;

/**
 * The pulsing ring that marks a thing on the board.
 *
 * ⚠ Sized to ring the target, not to sit inside it. `img` already applies 1/TS, so these are
 * multiples of the 64-unit texture: 0.85 starts just outside a 64px cell and 1.5 pushes clear of
 * it. At the first draft's 0.6 the ring landed *within* the tray face and read as a decoration
 * painted on the tile rather than as a pointer at it.
 *
 * ⚠ Shared with `coach.ts`. A second copy would drift, and the two are meant to be the same
 * marker — a player should not have to learn two visual languages for "look here".
 */
export function coachRing(scene: Phaser.Scene, x: number, y: number, grow = 1): Phaser.GameObjects.Image {
  const ring = img(scene, K.ring, x, y).setAlpha(0.95).setScale((0.85 * grow) / TS);
  ring.setTint(UI.gold);
  scene.tweens.add({ targets: ring, scale: (1.5 * grow) / TS, alpha: 0, duration: 1100, repeat: -1 });
  return ring;
}

/**
 * The same marker, turned up: **a steady ring plus two staggered pulses.**
 *
 * ⚠ Why the plain one is not enough here. `coachRing` is a single expanding pulse that fades to
 * nothing, so for a good part of every 1.1s cycle there is *nothing on screen* — fine for a ring
 * sitting on a tray the caption is already naming, and not fine for the booster, which is a small
 * button outside the machine, above the HUD, in a part of the screen the player has never had to
 * look at. The steady ring is what makes it continuously visible; the pulses are what make it move.
 *
 * ⚠ Still gold, still the same texture, still the same shape. Louder is a matter of how much of it
 * there is — a different colour or a different marker would be a second visual language for the
 * one thing the player is being asked to look at.
 *
 * ⚠ Returned as a container so the caller destroys one object. Three loose images on a layer is
 * three chances to leave one spinning after the lesson ends.
 */
export function coachRingBold(
  scene: Phaser.Scene,
  x: number,
  y: number,
  grow = 1,
): Phaser.GameObjects.Container {
  const c = scene.add.container(x, y);
  const steady = img(scene, K.ring, 0, 0).setTint(UI.gold).setAlpha(0.9).setScale((1.05 * grow) / TS);
  c.add(steady);
  scene.tweens.add({
    targets: steady,
    alpha: { from: 0.5, to: 1 },
    scale: { from: (1.0 * grow) / TS, to: (1.15 * grow) / TS },
    duration: 540,
    yoyo: true,
    repeat: -1,
    ease: "Sine.easeInOut",
  });
  // ⚠ Two, half a cycle apart. One pulse leaves a gap; two overlap so the outward movement never
  // stops, which is what the eye actually catches from the corner of the screen.
  for (let k = 0; k < 2; k++) {
    const r = img(scene, K.ring, 0, 0).setTint(UI.gold).setAlpha(0.95).setScale((0.95 * grow) / TS);
    c.add(r);
    scene.tweens.add({
      targets: r,
      scale: (1.9 * grow) / TS,
      alpha: 0,
      duration: 1100,
      delay: k * 550,
      repeat: -1,
    });
  }
  return c;
}

/**
 * The caption, on a plate.
 *
 * ⚠ A plate behind the words, not bare text. The caption sits over the chute, which is white
 * cabinet at the start and full of falling marbles a second later; white-stroked text on that is
 * unreadable exactly when it most needs reading.
 *
 * ⚠ Below the grid, in the throat of the chute — `shoulder` is where the cabinet walls start
 * running in, and everything above it belongs to the board. The first draft used `shoulder - 34`
 * and the plate landed squarely on the bottom row of cells.
 *
 * ⚠ `+ 44`, not the `+ 26` this started at. A silhouette whose lowest row sits on the chute mouth
 * — a `cross`, most of level 6 — hangs its bottom tray past `shoulder`, and at 26 the plate rested
 * on that tray's face. Covering a tray is not a cosmetic problem here: raised-or-flat eggs are how
 * the board says whether a tray can move, so the card would be hiding the very thing it is
 * explaining.
 */
export function coachPlate(scene: Phaser.Scene, text: string) {
  const y = L.funnel.shoulder + 44;
  // ⚠ Wrapped, and the plate is measured from the result. The plate width was capped at the screen
  // and the label was not, so a caption a few characters too long simply ran out past both ends of
  // its own background — white text on whatever the chute happened to contain. That is a trap for
  // whoever writes the *next* card, not a fault in any existing one, so it is fixed here rather
  // than by keeping every string short enough to get away with.
  const label = scene.add
    .text(GAME_W / 2, y, text, {
      fontFamily: FONT,
      fontSize: "21px",
      color: "#ffffff",
      align: "center",
      wordWrap: { width: GAME_W - 84 },
    })
    .setOrigin(0.5)
    .setDepth(1);
  const w = Math.min(GAME_W - 40, label.width + 44);
  const h = label.height + 22;
  const plate = scene.add.graphics();
  plate.fillStyle(INK, 0.82);
  plate.fillRoundedRect(GAME_W / 2 - w / 2, y - h / 2, w, h, Math.min(22, h / 2));
  return { plate, label };
}

/** What each step says, and how it ends. */
type Step = {
  text: string;
  /** Where the hand and ring sit, or null for a caption with no pointer. */
  at?: { x: number; y: number } | null;
  /** Advance after this many ms. Absent means "wait for the player". */
  after?: number;
};

export class Tutorial {
  private scene: Phaser.Scene;
  private layer: Phaser.GameObjects.Container;
  private hand: Phaser.GameObjects.Image | null = null;
  private ring: Phaser.GameObjects.Image | null = null;
  private label: Phaser.GameObjects.Text | null = null;
  private plate: Phaser.GameObjects.Graphics | null = null;
  private timer: Phaser.Time.TimerEvent | null = null;
  /** Kept apart from `timer`, which belongs to the step sequence and is cleared with the marks. */
  private idle: Phaser.Time.TimerEvent | null = null;
  /** Asked for a fresh tray to point at; null while there is nothing worth pointing at. */
  private nextTray: (() => { x: number; y: number } | null) | null = null;
  private steps: Step[] = [];
  private at = -1;
  private done = false;

  constructor(scene: Phaser.Scene, layer: Phaser.GameObjects.Container) {
    this.scene = scene;
    this.layer = layer;
  }

  /** Is the walkthrough wanted on this level, for this player? */
  static wanted(level: number): boolean {
    return level === 1 && (!save.tutorialDone || teachAll());
  }

  /**
   * `tray` is where the first pour should be pointed — the scene knows the grid metrics, this
   * does not. Passing it in beats recomputing the layout here and drifting from `gridMetrics`.
   */
  start(tray: { x: number; y: number }, nextTray?: () => { x: number; y: number } | null) {
    this.nextTray = nextTray ?? null;
    this.steps = [
      { text: "Tap a tray to pour its marbles", at: tray },
      // The bottom run is the one that matters: it is the only stretch that passes over the boxes.
      { text: "They ride the belt", at: { x: L.belt.cx, y: L.belt.cy + L.belt.r }, after: 2200 },
      { text: "A marble drops into a box of its own colour", at: { x: GAME_W / 2, y: L.box.top + L.box.h / 2 }, after: 2800 },
      { text: "Fill every box to clear the level", at: null, after: 2600 },
    ];
    this.show(0);
  }

  /** The player poured a tray. The first step is waiting on that; afterwards it resets the clock. */
  noteTap() {
    if (this.at === 0) {
      this.show(1);
      return;
    }
    // ⚠ Only once the captions are finished. A pour during them must not clear the caption the
    // player is in the middle of reading — the tap they just made is what it was telling them to do.
    if (this.done) {
      this.clear();
      this.armIdle();
    }
  }

  private show(i: number) {
    this.clear();
    const step = this.steps[i];
    if (!step) return this.finish();
    this.at = i;
    this.draw(step.text, step.at ?? null);
    if (step.after) {
      this.timer = this.scene.time.delayedCall(step.after, () => this.show(i + 1));
    }
  }

  /**
   * Put a mark and a caption on screen. Split out of `show` because the idle nudge draws exactly
   * the same thing off a different trigger — a second copy would be a second visual language for
   * "look here", which is the thing `coachRing` exists to prevent.
   */
  private draw(text: string, at: { x: number; y: number } | null) {
    const step = { text, at };

    if (step.at) {
      // ⚠ Ring first, then hand: the hand has to read *on top of* the ring, and a container draws
      // in insertion order.
      this.ring = coachRing(this.scene, step.at.x, step.at.y);
      this.layer.add(this.ring);

      // Offset down-right of the target so the fingertip lands on it rather than the palm.
      this.hand = img(this.scene, K.hand, step.at.x + 16, step.at.y + 40);
      this.layer.add(this.hand);
      this.scene.tweens.add({
        targets: this.hand,
        y: step.at.y + 52,
        duration: 620,
        yoyo: true,
        repeat: -1,
        ease: "Sine.inOut",
      });
    }

    const { plate, label } = coachPlate(this.scene, step.text);
    this.plate = plate;
    this.label = label;
    this.layer.add([plate, label]);
  }

  /**
   * Start the idle clock. Re-arming rather than firing once: a player who stalls twice needs the
   * same help the second time, and a nudge that is spent after one use leaves them exactly where
   * they were. It costs nothing while they are playing, because every pour resets it.
   */
  private armIdle() {
    this.idle?.remove();
    this.idle = this.scene.time.delayedCall(IDLE_MS, () => this.showNudge());
  }

  /**
   * Five seconds without a pour: point at the next tray worth tapping.
   *
   * ⚠ The tray comes from the scene, freshly, every time — never from a position captured at
   * `start()`. The board has moved on by now: the tray the walkthrough opened with is gone, and
   * hatches and reveals will have changed which cells are even tappable.
   */
  private showNudge() {
    const at = this.nextTray?.() ?? null;
    // Nothing to point at — paused, or the level is over, or no tray can move yet. Ask again
    // rather than giving up, since all three of those are temporary.
    if (!at) return this.armIdle();
    this.clear();
    this.at = -1;
    this.draw("Tap another tray to keep going", at);
  }

  private clear() {
    this.timer?.remove();
    this.timer = null;
    for (const o of [this.hand, this.ring, this.label, this.plate]) {
      if (o) {
        this.scene.tweens.killTweensOf(o);
        o.destroy();
      }
    }
    this.hand = this.ring = null;
    this.label = null;
    this.plate = null;
  }

  private finish() {
    if (this.done) return;
    this.done = true;
    this.clear();
    // ⚠ Marked here, at the end, not at `start()`. A player who quits on the first screen and
    // comes back gets the walkthrough again — they are precisely the player it exists for.
    // ⚠ Never while replaying (`?teach=`): looking at the walkthrough must not consume it.
    if (!teachAll()) save.tutorialDone = true;
    // ⚠ `tutorialDone` is still written **here**, not after the nudges. The four captions are the
    // walkthrough; the nudge is a safety net under a player who has stalled, and it can go on
    // firing for the rest of the level without that meaning the walkthrough is unfinished.
    this.armIdle();
  }

  /** Tear-down for a scene shutdown or a level restart mid-walkthrough. */
  destroy() {
    this.idle?.remove();
    this.idle = null;
    this.nextTray = null;
    this.clear();
  }
}
