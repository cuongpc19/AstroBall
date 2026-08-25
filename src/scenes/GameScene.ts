// The machine: trays at the top, a funnel, a looping conveyor, and the boxes that eat the
// marbles. Everything here is presentation and input — the rules live in game/logic.ts and
// this scene is not allowed to make decisions the headless sim cannot reproduce.

import Phaser from "phaser";
import {
  BELT_SLOTS,
  BOX_COLS,
  BOX_SLOTS,
  BOX_VISIBLE,
  COMBO_RUN,
  GAME_H,
  GAME_W,
  STAGE_PAD,
  WIDE_HUD,
  L,
  PALETTE,
  SHOW_BOOSTERS,
  TICK_MS,
  TICK_MS_DRAINED,
  UI,
  BELT_CLEATS,
  BELT_ENTRY_D,
  BELT_PERIM,
  BELT_SPACING,
  FEED_FROM,
  beltPointAt,
  boxColX,
  cleatLight,
  gridMetrics,
  type GridMetrics,
  slotPos,
  type Color,
} from "../game/config";
import { Game, boardBounds, hint, levelFingerprint, starsFor, type RevivePick, type TickEvents } from "../game/logic";
import { Tutorial } from "./tutorial";
import { Coach } from "./coach";
import {
  SHOW_LEVEL_TAGS,
  TAG_LOOK,
  featureProgress,
  levelDefFor,
  levelTag,
  type FeatureProgress,
} from "../game/board";
import { dailyOfferable, markDailyOffered } from "../game/daily";
import { platform } from "../platform";
import { loadCustom, toLevelDef } from "../game/custom";
import { save } from "../game/save";
import { clearRuns, copyToClipboard, exportJsonl, saveRun, summary, uploadRuns } from "../game/playlog";
import { openPrivacyPolicy } from "../game/privacy";
import { sendRun, sendStart } from "../game/telemetry";
import { Replay } from "../game/replay";
import { startAnalytics, track } from "../game/analytics";
import { sfx } from "../game/audio";
import { HOLE_STEP, K, TS, bakeAll, img } from "../game/textures";
import { dismissBootSplash, matchPageToCanvas, pageBackdrop } from "../game/bootsplash";
import { MagnetTutor } from "./magnetTutor";
import { teachAll } from "../game/teach";
import { FREE_MAGNETS, MAGNET_TUTOR_LEVEL } from "../game/config";

export { GAME_W, GAME_H };

// ⚠ `revive` is not a booster button — it is only ever offered by the jam pop-up — but its price
// belongs in the same table as the others or the two drift and the badge stops matching the till.
/**
 * ⚠ Magnet and revive do the **same thing to the board** and are priced apart on purpose. The
 * revive is only offered when the board is already dead; the magnet is available whenever a plan
 * exists, so it is strictly the more useful of the two and costs 20% more. Pricing them equal would
 * make the revive the dominant way to buy the effect — wait for the jam, pay less.
 */
const COST = { magnet: 60, revive: 50 };
/**
 * Coins a win pays, flat — not scaled by stars.
 *
 * ⚠ Write it once. The reward was spelled out twice, once into the wallet and once into the
 * overlay that announces it, and two copies of a number the player is shown *and* paid is the
 * one place a drift is unarguable: the card says one figure and the till gives another.
 * ⚠ **20 since 2026-08-20, up from 10**, and the ratio it is read against moved with it: a revive
 * is now two and a half wins and a magnet three, where they were five and six. That was a
 * deliberate loosening — a player who jams in the first handful of levels was facing a revive they
 * could not pay for, so the jam had exactly one outcome and the booster row was decoration until
 * about level 5. It is still not free: a booster is meant to be a decision, and at the old
 * 40 + stars×10 a single win paid for one outright, which is the thing to stay away from.
 *
 * ⚠ The three other files that quote this number in prose — `daily.ts`, `save.ts`, `main.ts` —
 * were updated with it. A constant written into four comments drifts the moment one is missed, and
 * a comment that quietly disagrees with the code is worse than no comment.
 */
const WIN_COINS = 20;

// `SHOW_BOOSTERS` is imported from config: the layout moves with it, so the flag has to be
// somewhere both this file and `L` can read. What this file adds on top:
//
// ⚠ The buttons are **hidden, not torn out**. Two things read the containers rather than draw
// them — `refreshHud`
// reaches into each container's face to swap the affordable/unaffordable texture. Skipping the
// construction takes both with it, and they fail at the moment a booster is next used, i.e. only
// once the flag is turned back on, which is the worst time to find out.
// ⚠ `onBooster` is gated too, not just the pixels: an invisible button is still reachable from
// `window.__ms` and from `npm run shot -- --exercise`, which calls it directly rather than
// clicking. Without the gate those still spend real coins against a HUD showing none.
/** The three the HUD carries. Revive is priced here but never built as a button. */
/**
 * The booster row. **One button.**
 *
 * ⚠ The wrench (cycle a box column) and undo were taken off on 2026-08-19. They are gone from the
 * row, not from `logic.ts` — `useWrench` and `restore` are still there and still tested, so putting
 * either back is adding a button rather than rewriting a rule.
 *
 * ⚠ Magnet no longer means what it used to. It was "pull the most useless colour off the belt into
 * a holder"; it now does exactly what a revive does — takes two boxes off the board together with
 * the six belt marbles that were going to fill them. Same rule, same code (`Game.revivePlan` /
 * `useRevive`), reached from a button instead of only from the jam pop-up.
 */
type BoosterKind = "magnet";
const FONT = '"Lilita One", Arial, sans-serif';
/**
 * Tint per row of a box column, top (live) to bottom (deepest in the well).
 *
 * ⚠ **All white — the queue is never tinted.** This used to darken with depth so the stack read
 * as sinking into the well, and a tint multiplies: the blue-grey `0x95a1ba` turned the orange box
 * `#ff8a14` into `#95570f`, which is brown. Cool colours came through it almost unchanged, so
 * only orange gave it away — reported from real play as "the bars at the bottom are brown, why do
 * they turn orange as they rise". Neutral greys fix the hue rotation but not the complaint: the
 * same colour still reads as two different colours at two depths, and the box queue is exactly
 * what the player has to plan against. Depth is already carried by the open box's holes and by
 * the well's own recess; it does not need to be paid for in colour.
 */
const SHADE = [0xffffff, 0xffffff, 0xffffff, 0xffffff, 0xffffff];

/** A marble's last state on physics, carried across the handoff onto the rail. */
interface FeedPt {
  x: number;
  y: number;
  rot: number;
}

interface Falling {
  body: MatterJS.BodyType;
  sprite: Phaser.GameObjects.Image;
  color: Color;
  /** when it was dropped — a marble that never reaches the neck has to be rescued */
  born: number;
}

/**
 * How long a marble may spend in the chute before it is taken anyway. A neck one marble wide
 * can arch, and an arched marble that logic still counts as in flight would hang the level
 * forever with no way for the player to tell why.
 */
const CHUTE_TIMEOUT_MS = 6000;

/**
 * Air drag applied only below L.funnel.brake. Drag alone sets the terminal speed, so no
 * velocity clamping is needed — but it has to leave the marbles genuinely rolling: too much
 * and they stall on the slope instead of reaching the neck and the rail.
 */
const CONE_DRAG = 0.09;
/** Contact friction down there too, so they slide off the cone walls rather than stick. */
const CONE_FRICTION = 0.008;

/**
 * The horizontal centre of the design box.
 *
 * ⚠ Every dialog, button, toast and HUD pill hangs off this, **never off a literal 270**. The
 * design box is 540 wide on a phone and wider in the landscape layout, so a literal centre is a
 * layout that silently left-aligns itself the day the box widens — 34 separate times.
 */
const CX = GAME_W / 2;
/**
 * The whole canvas, machine plus the two pads. `root` is shifted right by `STAGE_PAD`, so in
 * root-local space the stage runs from `-STAGE_PAD` to `GAME_W + STAGE_PAD` — and `CX` is still
 * its middle, which is what keeps every card and dimmer in this file centred without being touched.
 */
const STAGE_W = GAME_W + 2 * STAGE_PAD;

/** Where the booster badge hangs — the button's lower-right corner, so it follows its size. */
const BADGE_AT = Math.round(L.boostSize * 0.44);

/** `0x2f2c63` -> `#2f2c63`, so CSS and the canvas quote the same palette entry. */
const hexOf = (n: number) => "#" + n.toString(16).padStart(6, "0");

export class GameScene extends Phaser.Scene {
  private level = 1;
  /** playing the editor's scratch board rather than a level */
  private custom = false;
  /** drawn but never run — a look at the board, not a game of it */
  private preview = false;
  private board!: Game;

  private root!: Phaser.GameObjects.Container;
  private gridLayer!: Phaser.GameObjects.Container;
  private fallLayer!: Phaser.GameObjects.Container;
  private beltLayer!: Phaser.GameObjects.Container;
  private boxLayer!: Phaser.GameObjects.Container;
  private fxLayer!: Phaser.GameObjects.Container;
  private uiLayer!: Phaser.GameObjects.Container;

  private cellSprites: Phaser.GameObjects.Image[] = [];
  private tileSprites: Phaser.GameObjects.Image[] = [];
  private dispSprites: Phaser.GameObjects.Image[] = [];
  private crateSprites: Phaser.GameObjects.Image[] = [];
  /** One per cell, shown between the halves of a linked pair. */
  private linkSprites: Phaser.GameObjects.Image[] = [];
  /** The arrow lock badge, one per cell, hidden unless that tray is sealed by one. */
  private arrowSprites: Phaser.GameObjects.Image[] = [];
  private fixtures!: Phaser.GameObjects.Container;
  private badgeLabels: Phaser.GameObjects.Text[] = [];
  private beltSprites: Phaser.GameObjects.Image[] = [];
  private cleatSprites: Phaser.GameObjects.Image[] = [];
  /** how far the tread has travelled along the ring, in path units */
  private beltTravel = 0;
  /** ms between ticks right now — drops once the grid is drained */
  private tickMs = TICK_MS;
  private lastClackAt = 0;
  private levelStart = 0;
  /**
   * Which go at this level this is, 1 for the first. Read from the save at level start and held
   * here so `finish()` cannot count itself — it is the number of goes *including* this one.
   */
  private tries = 1;
  /** boosters spent this level — a win bought with coins is not a win on skill */
  private boostersUsed: string[] = [];
  /**
   * Every move of this attempt, in order, for `npm run replay`.
   *
   * ⚠ Attached to the `Game`, not driven from here. The engine records from its own mutators, so
   * a path through `window.__ms`, a booster, or a physics backstop is logged exactly like a finger
   * on the glass — see the note on `Game.rec`.
   */
  private replay = new Replay();
  /** The magnet lesson, on `MAGNET_TUTOR_LEVEL` and only until it has been seen once. */
  private magTutor: MagnetTutor | null = null;
  /** Scene clock reading at which the SUPER HARD plate is gone and the chute strip is free again. */
  private hardWarnUntil = 0;
  /**
   * Cell size and origin for the board in play.
   *
   * ⚠ Not `L.cell` and `CELL_PITCH` any more. A board may be up to GRID_MAX in either direction
   * and the cabinet cannot grow, so a big board gets smaller cells — 7x7 lands on 57 against the
   * usual 64. Everything that positions or sizes something on the grid has to read this, or the
   * pieces and the slots disagree by 7px a cell and drift further the wider the board gets.
   */
  private gm!: GridMetrics;
  /** Sprites are baked at `L.cell`; a shrunk board scales them down by this. */
  private get gmScale() {
    return this.gm.cell / L.cell;
  }
  private boxCols: Phaser.GameObjects.Container[] = [];
  private boxImages: Phaser.GameObjects.Image[][] = [];
  private boxFill: Phaser.GameObjects.Image[][] = [];

  private falling: Falling[] = [];
  /**
   * Where each marble handed to the belt actually left the chute from, in the order they were
   * handed over — so the slide onto the rail can start from the body the player was watching
   * instead of from a fixed point under the neck.
   *
   * A queue rather than one slot because `arrive()` puts the marble in `pending`, and a congested
   * rail can hold it there for several ticks before it is placed. One point in, one point out.
   */
  private feedQueue: FeedPt[] = [];
  /** The point the marble being placed *this* tick came from. Null falls back to `FEED_FROM`. */
  private feedNow: FeedPt | null = null;
  private undoStack: ReturnType<Game["snapshot"]>[] = [];

  private lastTickAt = 0;

  /**
   * ⚠ **The gameplay signal lives in the flag, not at the call sites.**
   *
   * `gameplayStart`/`gameplayStop` are how the host knows when it may interrupt with an ad, so
   * every pause, modal and end-of-level has to be bracketed. Six places in this file set this
   * flag today; annotating each one means the seventh, added next year, becomes an ad dropped
   * into the middle of a turn. Emitting from the setter covers that one for free.
   */
  private _paused = true;
  private get paused() {
    return this._paused;
  }
  private set paused(v: boolean) {
    if (v === this._paused) return;
    this._paused = v;
    if (v) platform.gameplayStop();
    else platform.gameplayStart();
  }
  /** Tear-down for the revive offer while it is up, so buying one can close its own card. */
  private reviveClose: (() => void) | null = null;
  /** The level-1 walkthrough while it is on screen. Null everywhere else. */
  private tutorial: Tutorial | null = null;
  private coach: Coach | null = null;

  private coinLabel!: Phaser.GameObjects.Text;
  private boosterBtns: Record<string, Phaser.GameObjects.Container> = {};
  /**
   * ⚠ A `Graphics`, not a circle, because the badge has to hold either two digits or the word
   * FREE and a count. Sized for the digits it clips the word; sized for the word it is a lozenge
   * hanging off the corner of a button that costs 60. It is redrawn to fit whatever it says.
   */
  /**
   * ⚠ Held by reference, not looked up as `container.list[0]`.
   *
   * `refreshHud` used to index the face out of the container, and adding a white pad in front of it
   * made index 0 a `Graphics` — `face.setTexture is not a function`, thrown during `create`, which
   * killed the whole scene before anything drew. A positional lookup into a display list is a
   * dependency on the order things happen to be added in.
   */
  private boosterFace!: Phaser.GameObjects.Image;
  private boosterBadge!: Phaser.GameObjects.Graphics;
  private boosterCost!: Phaser.GameObjects.Text;
  /** The padlock shown in place of the count while the magnet is still locked. */
  private boosterLock!: Phaser.GameObjects.Image;

  /**
   * Is the magnet still locked on this board?
   *
   * ⚠ **`MAGNET_TUTOR_LEVEL` is the one source**, the same constant that decides where the lesson
   * runs and what the results-card progress bar counts down to. Before this existed the bar
   * promised MAGNET at level 6 while the button sat live and stocked from level 1 — and the play
   * log caught a player at **level 2** firing it twice. Three places reading one constant is what
   * stops the game contradicting itself again.
   */
  private get magnetLocked(): boolean {
    return this.level < MAGNET_TUTOR_LEVEL;
  }

  constructor() {
    super("Game");
  }

  init(data: { level?: number; custom?: boolean; preview?: boolean }) {
    this.level = Math.max(1, data?.level ?? save.unlocked);
    this.custom = !!data?.custom;
    this.preview = !!data?.preview;
  }

  create() {
    bakeAll(this);
    // ⚠ Put the design box back to the machine's own shape. `HomeScene` widens it to fill a
    // landscape frame, and it is **this** scene's job to undo that rather than Home's on the way
    // out: `?level=N` and `?custom=1` start here with Home never having run, so a reset written
    // over there would be a reset that half the entry points never reach. The height never moves,
    // which is what makes it safe to recover the device pixel ratio from it.
    const dpr = this.scale.height / GAME_H || 1;
    const want = Math.round(STAGE_W * dpr);
    if (Math.abs(this.scale.width - want) > 1) this.scale.setGameSize(want, Math.round(GAME_H * dpr));
    // ⚠ Here as well as in `HomeScene`. `?level=N` and `?custom=1` make this the *first* scene,
    // and the poster is a full-screen div over the canvas — miss it and the board is invisible.
    dismissBootSplash();
    // The bars either side of the canvas, matched to the board's own gradient. ⚠ Same two colours
    // the scene paints with, read from `UI` rather than typed again — a hex copied into CSS is a
    // second definition of a colour, and it drifts the first time the palette is touched.
    matchPageToCanvas(this, pageBackdrop(hexOf(UI.bgTop), hexOf(UI.bgBottom)));
    // ⚠ Leaving the level is hooked **once, here**, rather than at every route out. There are
    // several ways off this scene — the win card, the lose card, the pause menu, the home
    // button — and the one that gets missed leaves the host believing a turn is still running,
    // so it never shows an ad. `once` rather than `on`: `create` runs again on every restart.
    this.events.once("shutdown", () => {
      this._paused = true;
      platform.gameplayStop();
      // Its tweens loop forever and its timer fires on a scene that is going away.
      this.tutorial?.destroy();
      this.tutorial = null;
      this.coach?.destroy();
      this.coach = null;
      this.magTutor?.destroy();
      this.magTutor = null;
    });
    this.resetLevel();
    this.devAutoWin();
  }

  /**
   * "HARD" / "SUPER HARD" — shown on entry to a board the ladder bills as a spike.
   *
   * ⚠ **Which boards, from the level number** (`levelTag`): every 15th is super hard, and past
   * level 10 every 5th that is not already one is hard. Chosen deliberately over the per-board
   * `Blueprint.hard` flag, whose note in `custom.ts` argues the other way — the trade accepted here
   * is that reordering the ladder moves the labels with the *numbers* rather than with the boards.
   * `def.hard` is still honoured as a manual override for a board that is a spike wherever it sits.
   *
   * Why warn at all: the ladder is not monotonic on purpose, and a board that wins 16% sitting
   * between boards that win 60% reads as the game breaking rather than as a spike. A player who
   * loses four times without being told anything concludes they have hit the end of what they can
   * do; a player who was told it is a hard one is playing a hard one.
   *
   * ⚠ **It never blocks a tap.** Same rule as the level-1 walkthrough: a card that swallows input
   * also swallows `window.__ms.tap()` and every `npm run shot` run, so the one screen a reviewer is
   * most likely to look at becomes the one nothing can drive. It sits above the chute, fades in,
   * holds, and leaves on its own.
   *
   * ⚠ **Every level, not just the first attempt.** The temptation is to show it once and mark it
   * seen, as `coach` and the walkthrough do. But those teach something that stays learned, and this
   * is a warning about the board in front of you — a player coming back to it a week later needs it
   * more than they did the first time, not less.
   */
  private hardWarning() {
    this.hardWarnUntil = 0;
    // ⚠ The editor's scratch board has no place on the ladder, so the number rule cannot speak for
    // it — only an explicit flag on the drawing can.
    // ⚠ Order: the board's own label, then the old boolean, then the slot's number rule. A drawing
    // that says `tag: "none"` is declining a badge its slot would otherwise hand it — which is the
    // only way to move a board out of a 15th slot without the SUPER HARD promise following it.
    const own = this.board.def.tag;
    // ⚠ The switch is read here, after the three sources are resolved rather than inside any one
    // of them: a drawing carrying `tag: "hard"` would otherwise walk straight past a rule that
    // only silenced the level number. See `SHOW_LEVEL_TAGS`.
    const tag = !SHOW_LEVEL_TAGS
      ? null
      : own === "none"
        ? null
        : own ?? (this.board.def.hard ? "superhard" : this.custom ? null : levelTag(this.level));
    if (!tag) return;
    const look = TAG_LOOK[tag];
    // Below the board's own lowest row, in the throat of the chute.
    //
    // ⚠ **Measured off the board, not pinned to `funnel.shoulder`.** A fixed offset is right for a
    // 5-row board and wrong for a 6-row one: the extra row reaches down to the funnel and the plate
    // then rests on its trays. Seen on level 30, where three trays in the bottom row sat half
    // behind the warning. Covering a tray is not cosmetic here — raised-or-flat eggs are how the
    // board says whether a tray can move, so the plate was hiding the thing the player has to read
    // to pick a first move. Exactly the trap the level-1 caption already hit from the other side,
    // where `shoulder + 26` landed on the bottom row of a `cross`.
    //
    // ⚠ Lowest row **of the board**, not of the grid: a 4-row shape drawn on a 6-row grid must not
    // push the plate down past two empty rows of casing.
    const b = this.board;
    let lowest = 0;
    for (let ry = b.rows - 1; ry >= 0; ry--) {
      let any = false;
      for (let x = 0; x < b.cols; x++) if (!b.wall[ry * b.cols + x]) any = true;
      if (any) {
        lowest = ry;
        break;
      }
    }
    // One cell below the last row, then clear of the rim the cavity draws around it.
    const y = Math.max(L.funnel.shoulder + 44, this.gm.y + (lowest + 1) * this.gm.pitch + 40);
    // ⚠ The plate is measured off the text, not a fixed width — "HARD" is less than half as wide as
    // "SUPER HARD", and a plate sized for the longer one leaves the shorter word adrift in it.
    const txt = this.add
      .text(CX, y, look.text, { fontFamily: FONT, fontSize: "40px", color: "#ffffff" })
      .setOrigin(0.5)
      .setStroke(hexOf(look.shadow), 9);
    const w = txt.width + 56;
    const plate = this.add.graphics();
    plate.fillStyle(look.shadow, 1).fillRoundedRect(CX - w / 2, y - 34, w, 62, 18);
    plate.fillStyle(look.face, 1).fillRoundedRect(CX - w / 2 + 4, y - 30, w - 8, 54, 15);

    const c = this.add.container(0, 0, [plate, txt]).setAlpha(0);
    // Above the HUD, like the walkthrough's own layer — under it, the coin counter and the level
    // pill draw over the warning.
    this.uiLayer.add(c);

    // Drops in, holds long enough to read twice, leaves. 2.4s total: long enough that a player
    // looking at the board still catches it, short enough that it is gone before the first pour
    // lands at the neck and the marbles need that strip.
    c.setScale(0.7);
    this.tweens.add({ targets: c, alpha: 1, scale: 1, duration: 260, ease: "Back.easeOut" });
    // When the strip is free again, so `startCoach` knows how long to hold off.
    this.hardWarnUntil = this.time.now + 2400 + 380;
    this.time.delayedCall(2400, () => {
      this.tweens.add({
        targets: c,
        alpha: 0,
        y: -26,
        duration: 380,
        onComplete: () => c.destroy(),
      });
    });
  }

  /**
   * `?win=1` — clear the level on sight. For reaching a screen that only exists after a win, which
   * is otherwise several minutes of real play away and, on a level tuned to 32%, several attempts.
   *
   * ⚠ **Dev server only.** `import.meta.env.DEV` is false in every build, so Vite drops the branch
   * entirely — the same gate `main.ts` puts on `window.__game`. Unguarded this ships, and a URL that
   * clears a level is the first thing a reviewer tries and the last thing the play log survives:
   * every use writes a "win" into the row the difficulty curve is calibrated from.
   *
   * ⚠ **Fires once per page load, not once per level.** Firing on every `create` would auto-win
   * whatever NEXT LEVEL lands on, and then the button that exists to let you keep playing is the
   * one thing that stops you.
   */
  private devAutoWin() {
    if (!import.meta.env.DEV) return;
    // ⚠ The URL is read **inside** the guard, not in a static initialiser. A static field runs at
    // class-definition time whatever the build, so the first version shipped a live
    // `URLSearchParams(location.search).get("win")` into the production bundle. The method body
    // was empty there and the cheat was dead — but anyone reading the bundle finds a game that
    // looks for `?win` at boot, and "it is harmless, trust the minifier" is not something a
    // reviewer can check. Nothing about the cheat should exist outside the dev server.
    if (GameScene.autoWinUsed) return;
    let want = false;
    try {
      want = !!new URLSearchParams(location.search).get("win");
    } catch {
      /* no URL API — nothing to do */
    }
    if (!want) return;
    GameScene.autoWinUsed = true;
    // After a beat, so the board is on screen behind the card rather than the card arriving over
    // a blank machine — this is used to look at the win screen, and its backdrop is part of it.
    this.time.delayedCall(400, () => this.finish(true));
  }

  /**
   * Whether `?win=1` has already been spent this page load.
   *
   * Static, because `create` runs again on every restart and an instance field would be rebuilt
   * along with the scene — which is exactly the once-per-level behaviour the note above rejects.
   * A bare `false` is all that reaches a production bundle.
   */
  private static autoWinUsed = false;

  // ── Build ──────────────────────────────────────────────────────────────────

  private resetLevel() {
    // A scene restart keeps the same Matter world, so last level's chute walls and any
    // marbles still in the air have to go before the new ones are built.
    const world = this.matter.world.localWorld as unknown as { bodies: MatterJS.BodyType[] };
    this.matter.world.remove(world.bodies.slice());
    this.children.removeAll(true);
    this.tweens.killAll();
    this.time.removeAllEvents();

    this.falling = [];
    this.feedQueue = [];
    this.feedNow = null;
    this.undoStack = [];
    this.paused = false;
    this.reviveClose = null;
    this.cellSprites = [];
    this.tileSprites = [];
    this.dispSprites = [];
    this.crateSprites = [];
    this.linkSprites = [];
    this.arrowSprites = [];
    this.badgeLabels = [];
    this.beltSprites = [];
    this.cleatSprites = [];
    this.beltTravel = 0;
    this.boxCols = [];
    this.boxImages = [];
    this.boxFill = [];

    // A hand-built board goes through the same `Game` as a generated one — the editor produces
    // a `LevelDef`, not a second idea of what a board is, so every rule applies to it unchanged.
    // `custom` is the editor's scratch slot; otherwise a level may have a board saved against
    // its number, and only if it has neither does the generator run.
    // ⚠ Everything but the editor's scratch slot goes through `levelDefFor`, which is the single
    // definition of "which board is level N" the measurement scripts import too. Resolving it
    // here as well is how the tooling ended up auditing a generated board for a level the player
    // was being served a hand-built one.
    const scratch = this.custom ? loadCustom() : null;
    this.board = new Game(scratch ? toLevelDef(scratch, this.level) : levelDefFor(this.level));
    this.replay = new Replay();
    this.board.rec = this.replay;
    this.gm = gridMetrics(this.board.cols, this.board.rows, boardBounds(this.board.def));

    this.cameras.main.setBackgroundColor(UI.bg);
    const scale = this.scale.width / STAGE_W;
    // ⚠ Shifted, not re-origined. Every coordinate in `config.ts` is in the machine's own 540-wide
    // space and so is Matter — moving the container leaves all of that alone and moves the hit
    // zones with it, because Phaser tests those through the transform.
    this.root = this.add.container(STAGE_PAD * scale, 0).setScale(scale);

    // Depth order matters here. The belt housing goes down *after* the falling marbles, so a
    // marble dropping into the neck slides behind its chrome rim instead of floating over the
    // front of the machine.
    this.buildMachine();
    this.gridLayer = this.add.container(0, 0);
    this.fallLayer = this.add.container(0, 0);
    this.root.add([this.gridLayer, this.fallLayer]);

    this.buildBeltHousing();
    this.beltLayer = this.add.container(0, 0);
    this.boxLayer = this.add.container(0, 0);
    this.fxLayer = this.add.container(0, 0);
    this.uiLayer = this.add.container(0, 0);
    this.root.add([this.beltLayer, this.boxLayer, this.fxLayer, this.uiLayer]);

    this.buildGrid();
    this.buildBelt();
    this.buildBoxes();
    this.buildWalls();
    this.buildHud();

    this.fixtures = this.add.container(0, 0);
    this.gridLayer.add(this.fixtures);
    this.refreshFixtures();
    this.refreshGrid();
    this.refreshBoxes();
    this.refreshHud();
    this.startTutorial();
    this.hardWarning();
    this.startMagnetTutor();
    this.startCoach();

    // ⚠ Analytics starts **here**, on reaching a board, not at boot — the script is 145 KB from
    // another origin and time-to-gameplay is graded. And not for a hand-built board: the editor's
    // scratch slot is a level no ladder ever produced, so counting it would pollute the one report
    // that is meant to say which shipped levels people play.
    if (!this.custom && !this.preview) {
      startAnalytics();
      track("level_start", { level: this.level });
      // ⚠ The same fingerprint the end row carries. Without it a start cannot be attributed to a
      // board, and this generator gets retuned constantly — "level 34" is a different level from
      // one week to the next.
      sendStart({ lvl: this.level, sig: levelFingerprint(this.board.def) });
    }

    this.lastTickAt = this.time.now;
    this.levelStart = this.time.now;
    // ⚠ Not for the editor's scratch board or a preview: neither is a level anyone is scored on,
    // and `preview` in particular is opened over and over from the editor while drawing.
    this.tries = this.custom || this.preview ? 1 : save.noteTry(this.level);
    this.boostersUsed = [];
    this.tickMs = TICK_MS;
    // Driven from update() rather than a TimerEvent: the interval has to change partway
    // through a level, and re-arming a looping timer mid-flight drops or doubles a tick.
    this.matter.world.off("collisionstart");
    this.matter.world.on("collisionstart", (e: { pairs: { collision: { depth: number } }[] }) =>
      this.onCollide(e),
    );

    // Design view: the real machine, drawn and then left alone. `paused` already stops the tick
    // loop and every input path, and `finish()` only ever runs off a tick — so nothing evaluates
    // the board, and a layout that would be JAMMED on move zero can still be looked at. That is
    // the whole point: judging a board is a separate job from seeing it.
    if (this.preview) {
      this.paused = true;
      this.add
        // ⚠ Into the HUD column on a wide frame. Left on the old row it lands at y 46 over a
        // cabinet whose top edge is now at 20 — a label printed across the machine it labels.
        .text(WIDE_HUD ? L.hudCol.x : CX, (WIDE_HUD ? L.hudCol.levelY : L.hudY) - 2, "PREVIEW", {
          fontFamily: FONT,
          fontSize: "28px",
          color: "#ffffff",
        })
        .setOrigin(0.5)
        .setStroke(UI.ink, 6)
        .setDepth(50);
    }

    if (import.meta.env.DEV) this.exposeTestHooks();
  }

  private buildMachine() {
    // Backdrop first: a vertical gradient with a soft glow behind the machine, so the cabinet
    // sits in a lit room instead of on a flat colour field.
    const bg = this.add.graphics();
    bg.fillGradientStyle(UI.bgTop, UI.bgTop, UI.bgBottom, UI.bgBottom, 1);
    bg.fillRect(-STAGE_PAD, 0, STAGE_W, GAME_H);
    this.root.add(bg);
    // ⚠ Off the cabinet, not the old hardcoded 520. The machine rides up by `HUD_LIFT` on a wide
    // frame and a glow left behind sits under its feet instead of behind it.
    const halo = img(this, K.flash, CX, L.machine.y + L.machine.h / 2 - 29)
      .setScale(5.2 / TS)
      .setAlpha(0.13);
    halo.setTintFill(UI.glow);
    this.root.add(halo);

    const g = this.add.graphics();
    const m = L.machine;

    g.fillStyle(0x252350, 0.35).fillRoundedRect(m.x - 8, m.y + 12, m.w + 16, m.h, 44);
    g.fillStyle(UI.machineEdge, 1).fillRoundedRect(m.x - 4, m.y + 6, m.w + 8, m.h, 40);
    g.fillStyle(UI.machine, 1).fillRoundedRect(m.x, m.y, m.w, m.h, 38);
    // Highlight along the top lip — one line that reads as a moulded plastic edge.
    g.fillStyle(0xffffff, 0.5).fillRoundedRect(m.x + 14, m.y + 7, m.w - 28, 12, 6);

    // The chute: straight sides down from the grid, then a short cone into a neck barely
    // wider than one marble. Coning the whole height instead would leave a big empty wedge
    // across the middle of the machine and let the marbles spread out as they fall.
    const f = L.funnel;
    /**
     * ⚠ **Straight, and it was tried curved on 2026-08-19.** The physics wall is a 33° line and
     * cannot become a curve: any curve between the same two points averages the same slope, so part
     * of it is shallower than 33° and that is where marbles stop sliding. Drawing a curve over a
     * straight wall was the compromise — 16px of bow, 8px of deviation at mid-height — and it read
     * exactly as what it was: the marbles slid down an invisible line with a band of white between
     * them and the wall they were supposed to be touching. It also did not look like the reference,
     * which is a shorter funnel, not a curved one.
     */
    g.fillStyle(0xeef3fb, 1);
    g.beginPath();
    g.moveTo(f.mouthL, f.shoulder);
    g.lineTo(f.mouthR, f.shoulder);
    g.lineTo(f.mouthR, f.top);
    g.lineTo(f.neckR, f.neckY + 16);
    g.lineTo(f.neckL, f.neckY + 16);
    g.lineTo(f.mouthL, f.top);
    g.closePath();
    g.fillPath();
    g.lineStyle(5, UI.machineEdge, 1);
    g.beginPath();
    g.moveTo(f.mouthL, f.shoulder);
    g.lineTo(f.mouthL, f.top);
    g.lineTo(f.neckL, f.neckY + 16);
    g.strokePath();
    g.beginPath();
    g.moveTo(f.mouthR, f.shoulder);
    g.lineTo(f.mouthR, f.top);
    g.lineTo(f.neckR, f.neckY + 16);
    g.strokePath();

    // Cavity last, over the funnel: where the board reaches the bottom row its floor *is* the
    // top of the chute, and that only reads if the white runs through uninterrupted.
    this.drawGridCavity(g);

    this.root.add(g);
  }

  private buildBeltHousing() {
    const b = L.belt;
    const g = this.add.graphics();
    const ow = 2 * (b.hx + b.shell);
    const oh = 2 * b.shell;
    g.fillStyle(UI.machineEdge, 1).fillRoundedRect(
      b.cx - ow / 2,
      b.cy - oh / 2 + 4,
      ow,
      oh,
      b.shell,
    );
    g.fillStyle(UI.chrome, 1).fillRoundedRect(b.cx - ow / 2, b.cy - oh / 2, ow, oh, b.shell);

    // The groove is cut wide enough that a marble riding the centreline sits fully inside
    // it rather than half-on the chrome.
    const iw = 2 * (b.hx + b.r + 14);
    const ih = 2 * (b.r + 14);
    g.fillStyle(UI.beltDeep, 1).fillRoundedRect(b.cx - iw / 2, b.cy - ih / 2, iw, ih, ih / 2);
    g.fillStyle(UI.belt, 1).fillRoundedRect(
      b.cx - iw / 2 + 3,
      b.cy - ih / 2 + 3,
      iw - 6,
      ih - 6,
      ih / 2,
    );

    // The centre rail that splits the two runs.
    g.fillStyle(UI.chrome, 1).fillRoundedRect(b.cx - b.hx - 6, b.cy - 5, 2 * b.hx + 12, 10, 5);
    this.root.add(g);

    // Recessed well the box columns drop into.
    const wellTop = L.box.top - 12;
    // White floor with a slate lip, the same two tones as the tray cavity — the machine has one
    // recess treatment and both ends of it should be the same material.
    const well = this.add.graphics();
    const wx = L.machine.x + 10;
    const ww = L.machine.w - 20;
    // ⚠ The well ends with the cabinet, not at the canvas edge. It used to run to `GAME_H` because
    // the two happened to coincide; once the machine rides up for the hidden booster row they do
    // not, and a well drawn past the cabinet's own bottom hangs out below it.
    const wellH = L.machine.y + L.machine.h - wellTop;
    well.fillStyle(UI.panelDeep, 1);
    well.fillRoundedRect(wx - 7, wellTop - 7, ww + 14, wellH, 32);
    well.fillStyle(UI.panel, 1);
    well.fillRoundedRect(wx, wellTop, ww, wellH, 26);
    for (let j = 0; j < BOX_COLS; j++) {
      well.fillStyle(UI.panelDeep, 0.22);
      well.fillRoundedRect(boxColX(j) - L.box.w / 2 - 3, wellTop + 8, L.box.w + 6, wellH - 8, 12);
    }
    this.root.add(well);

    /**
     * ⚠ **Do not clip the columns with a geometry mask.** It was tried, to stop the deepest box
     * dipping below the floor during a clear (see `slideColumn`), and it is a trap: Phaser renders a
     * mask object through its *own* transform and ignores the container it belongs to, so a mask
     * built in design units lands `root.scaleX` away from the thing it is masking. `root.scaleX` is
     * the device pixel ratio — **1 in the headless browser every screenshot is taken in**, and 2 on
     * a real phone. It therefore passed every check here and shipped a build whose box well was
     * completely empty on the reporter's screen. `slideColumn` pins the box instead.
     */
  }

  /**
   * The recessed well the trays sit in, drawn as the union of the playable cells so its rim
   * traces the board's outline — the shape the reference machine has and the reason a walled
   * level reads at a glance. Casing cells get no cavity, so the cabinet body shows through.
   *
   * Drawn as two passes of the same union rather than by tracing the boundary: once dilated in
   * the rim colour, once inset in the panel colour. The dilated union *is* the outline, corners
   * rounded and all — a traced path would need its own convex/concave corner arithmetic and
   * would have to be redone for every silhouette.
   *
   * ⚠ Each cell's rounded rect must overlap its neighbour's by more than the corner radius, or
   * the union keeps the individual corners and the well comes out as a string of beads instead
   * of one shape.
   */
  private drawGridCavity(g: Phaser.GameObjects.Graphics) {
    const b = this.board;
    const gm = this.gm;
    const m = L.machine;
    const RIM = 9;
    const PAD = 12;
    const R = 20;
    const cellX = (i: number) => gm.x + (i % b.cols) * gm.pitch + gm.cell / 2;
    const cellY = (i: number) => gm.y + ((i / b.cols) | 0) * gm.pitch + gm.cell / 2;

    // The mouth: the board's *lowest* row, not the grid's. A shape only four rows tall would
    // otherwise hang above the shelf with its own rim running parallel to it, and two lines a
    // few pixels apart read as a mistake rather than as a shelf.
    //
    // ⚠ Lowest row that has any floor, not "every column's own lowest cell". Per column, a
    // tapering silhouette like `diamond` would pour white down its shoulders too and come out
    // as a rectangle again — the taper is the shape.
    let mouth = -1;
    for (let y = b.rows - 1; y >= 0 && mouth < 0; y--) {
      for (let x = 0; x < b.cols; x++) if (!b.wall[y * b.cols + x]) mouth = y;
    }

    // The shelf the board stands on, spanning the whole cabinet. Drawn first so the cavity's
    // own passes paint over it wherever the board opens through — a line straight across the
    // mouth would wall off the marbles' only way down.
    g.fillStyle(UI.panelDeep, 1);
    g.fillRoundedRect(m.x + 8, L.funnel.shoulder - 2, m.w - 16, 5, 3);

    // ⚠ The drop from the mouth to the chute is part of the cavity, so it goes through *both*
    // passes — rim then fill. Painting it in fill only (the obvious shortcut, since the point is
    // to open the floor) leaves that stretch with no sides at all: the board's throat runs down
    // to the funnel as bare white with the rim stopping dead at the last row of cells.
    const drop = (grow: number, extra: number) =>
      mouth < 0 ? 0 : L.funnel.shoulder + extra - (cellY(mouth * b.cols) - gm.cell / 2 - grow);

    for (const [grow, colour, radius, extra] of [
      [PAD + RIM, UI.panelDeep, R + RIM, 2],
      // The fill runs deeper than the rim by more than the rim is thick, so the rim's own
      // bottom edge — and its rounded bottom corners — end up underneath it and the throat
      // stays open.
      [PAD, UI.panel, R, 2 + RIM + 8],
    ] as const) {
      g.fillStyle(colour, 1);
      const half = gm.cell / 2 + grow;
      const tall = Math.max(half * 2, drop(grow, extra));
      for (let i = 0; i < b.cols * b.rows; i++) {
        if (b.wall[i]) continue;
        const h = ((i / b.cols) | 0) === mouth ? tall : half * 2;
        g.fillRoundedRect(cellX(i) - half, cellY(i) - half, half * 2, h, radius);
      }
    }
  }

  private buildGrid() {
    const { cols, rows } = this.board;
    const gm = this.gm;
    const k = this.gmScale;
    const cellX = (i: number) => gm.x + (i % cols) * gm.pitch + gm.cell / 2;
    const cellY = (i: number) => gm.y + ((i / cols) | 0) * gm.pitch + gm.cell / 2;

    // Every empty-cell backing plate goes down first, as one layer. Interleaving them with
    // the tiles would let the plate of cell n+1 paint over the right half of an x2 tray
    // anchored at cell n.
    for (let i = 0; i < cols * rows; i++) {
      const back = img(this, K.cell, cellX(i), cellY(i)).setScale(k / TS);
      this.cellSprites.push(back);
      this.gridLayer.add(back);
    }

    for (let i = 0; i < cols * rows; i++) {
      const x = cellX(i);
      const y = cellY(i);

      const tile = img(this, K.trayHidden, x, y).setVisible(false).setScale(k / TS);
      const link = img(this, K.link, x + gm.pitch / 2, y).setVisible(false).setScale(k / TS);
      this.linkSprites.push(link);
      const arrow = img(this, K.arrow, x, y).setVisible(false).setScale(k / TS);
      this.arrowSprites.push(arrow);
      const disp = img(this, K.dispenser, x, y).setVisible(false).setScale(k / TS);
      const crate = img(this, K.crate, x, y).setVisible(false).setScale(k / TS);
      this.crateSprites.push(crate);
      // One label per cell, shared by the hatch count and the x2 badge — a cell is never
      // both a hatch and a tray.
      const label = this.add
        .text(x, y - 10 * k, "", { fontFamily: FONT, fontSize: `${Math.round(28 * k)}px`, color: "#ffffff" })
        .setOrigin(0.5)
        .setStroke(UI.ink, 6)
        .setVisible(false);
      this.tileSprites.push(tile);
      this.dispSprites.push(disp);
      this.badgeLabels.push(label);

      const zone = this.add
        .rectangle(x, y, gm.cell, gm.cell, 0xffffff, 0)
        .setInteractive({ useHandCursor: true });
      // Either half of an x2 tray taps the tray.
      zone.on("pointerdown", () => {
        // ⚠ The lesson's gate lives **here**, on the pointer, so `window.__ms.tap()` and every
        // `npm run shot` run walk past it. Putting it in `onTapCell` would make the one level a
        // reviewer is most likely to be shown the one nothing can drive.
        if (this.magTutor && !this.magTutor.finished) {
          const ok = this.magTutor.allowedCells();
          const a0 = this.board.anchorAt(i);
          if (!ok.includes(a0 < 0 ? i : a0)) {
            sfx.deny();
            return;
          }
        }
        const a = this.board.anchorAt(i);
        this.onTapCell(a < 0 ? i : a);
      });

      // ⚠ **The arrow goes in after the tile**, so it sits on the tray's face rather than under it,
      // and it goes in *here* rather than being left in the scene root — a sprite outside
      // `gridLayer` keeps its design-unit coordinates but loses the layer's transform, which drew
      // the six badges of level 200 in a neat row across the top of the cabinet.
      this.gridLayer.add([crate, tile, link, arrow, disp, label, zone]);
    }
  }

  private buildBelt() {
    // Tread first so the marbles ride on top of it.
    for (let i = 0; i < BELT_CLEATS; i++) {
      const c = img(this, K.cleat(cleatLight(i)), 0, 0);
      this.cleatSprites.push(c);
      this.beltLayer.add(c);
    }
    for (let i = 0; i < BELT_SLOTS; i++) {
      const s = img(this, K.marble(0), 0, 0).setVisible(false);
      this.beltSprites.push(s);
      this.beltLayer.add(s);
    }
  }

  private buildBoxes() {
    for (let j = 0; j < BOX_COLS; j++) {
      const c = this.add.container(0, 0);
      const images: Phaser.GameObjects.Image[] = [];
      const fill: Phaser.GameObjects.Image[] = [];
      for (let k = 0; k < BOX_VISIBLE; k++) {
        const y = L.box.top + k * (L.box.h + L.box.vgap) + L.box.h / 2;
        images.push(img(this, K.box(0), boxColX(j), y).setVisible(false));
      }
      for (let k = 0; k < BOX_SLOTS; k++) {
        fill.push(img(this, K.marble(0), 0, 0).setVisible(false));
      }
      c.add(images);
      c.add(fill);

      const glow = this.add
        .rectangle(boxColX(j), L.box.top + L.box.h / 2, L.box.w + 10, L.box.h + 10, 0xffffff, 0.35)
        .setVisible(false);
      c.add(glow);

      const zone = this.add
        .rectangle(boxColX(j), L.box.top + L.box.h / 2, L.box.w, L.box.h, 0xffffff, 0)
        .setInteractive({ useHandCursor: true });
      c.add(zone);

      this.boxCols.push(c);
      this.boxImages.push(images);
      this.boxFill.push(fill);
      this.boxLayer.add(c);
    }
  }

  /**
   * Static Matter geometry for the chute. The neck is closed — marbles pile up on it and
   * are lifted onto the belt one per tick, which is exactly the queue the video shows.
   */
  private buildWalls() {
    const f = L.funnel;
    const wall = (x1: number, y1: number, x2: number, y2: number) => {
      const len = Math.hypot(x2 - x1, y2 - y1);
      this.matter.add.rectangle((x1 + x2) / 2, (y1 + y2) / 2, len, 16, {
        isStatic: true,
        angle: Math.atan2(y2 - y1, x2 - x1),
        friction: 0.02,
      });
    };
    wall(f.mouthL - 6, L.gridPanel.y, f.mouthL - 6, f.top);
    wall(f.mouthR + 6, L.gridPanel.y, f.mouthR + 6, f.top);
    wall(f.mouthL, f.top, f.neckL, f.neckY);
    wall(f.mouthR, f.top, f.neckR, f.neckY);
    wall(f.neckL - 4, f.neckY, f.neckR + 4, f.neckY);
    // Short lips either side of the neck so a marble resting on the floor cannot be squeezed
    // out sideways by the weight of the pile above it.
    wall(f.neckL, f.neckY - 18, f.neckL, f.neckY);
    wall(f.neckR, f.neckY - 18, f.neckR, f.neckY);
  }

  // ── HUD ────────────────────────────────────────────────────────────────────

  /**
   * A dimmer over the **whole canvas**, pads included.
   *
   * ⚠ Not `GAME_W` wide. On a wide frame that leaves the two pads — and the HUD column standing in
   * one of them — at full brightness beside a dimmed machine, which reads as the card having failed
   * to cover the screen rather than as a modal.
   */
  private stageDim(colour: number, alpha: number) {
    return this.add.rectangle(CX, GAME_H / 2, STAGE_W, GAME_H, colour, alpha);
  }

  private buildHud() {
    // Where each control sits. ⚠ **One set of coordinates, chosen once** — the wide layout is the
    // same four controls in a column beside the machine, not a second HUD. Writing it as two
    // branches of `img(...)` calls is how the coin label ends up on the row in one and the column
    // in the other, and only one of them gets fixed the next time.
    const col = WIDE_HUD;
    const hc = L.hudCol;
    // ⚠ **The row reads left to right: gear, level, booster, coin.** The pill used to sit at `CX`
    // with the coin at `CX + 160`, which left the middle of the line empty and the booster stranded
    // on a row of its own below. Pulling the pill left against the gear and the coin right against
    // the cabinet wall opens a 188px gap in the middle, and that gap is what the booster's row cost.
    const gearX = col ? hc.x : CX - 210;
    const gearY = col ? hc.gearY : L.hudY;
    const pillX = col ? hc.x : CX - 118;
    const pillY = col ? hc.levelY : L.hudY;
    const coinX = col ? hc.x : CX + 190;
    const coinY = col ? hc.coinY : L.hudY;

    const gear = img(this, K.btn("gold"), gearX, gearY);
    const gearIcon = img(this, K.icon("gear"), gearX, gearY).setScale(0.55 / TS);
    const gearZone = this.add
      .rectangle(gearX, gearY, 60, 60, 0xffffff, 0)
      .setInteractive({ useHandCursor: true });
    gearZone.on("pointerdown", () => this.openSettings());

    const pill = img(this, K.btn("purple"), pillX, pillY);
    const lvl = this.add
      .text(pillX, pillY - 2, this.custom ? "Editor" : `Level ${this.level}`, {
        fontFamily: FONT,
        fontSize: "26px",
        color: "#ffffff",
      })
      .setOrigin(0.5)
      .setStroke(UI.ink, 5);

    // ⚠ The coin and its number are placed **off the pill**, not off `CX`. On the row the pill was
    // at CX+160 with the coin at CX+118 and the label at CX+174 — three numbers that only agree by
    // arithmetic, and moving the pill into a column left the coin sitting on the machine.
    const coinBg = img(this, K.btn("purple"), coinX, coinY);
    const coin = img(this, K.coin, coinX - 42, coinY).setScale(0.9 / TS);
    this.coinLabel = this.add
      .text(coinX + 14, coinY - 2, String(save.coins), {
        fontFamily: FONT,
        fontSize: "24px",
        color: "#ffffff",
      })
      .setOrigin(0.5)
      .setStroke(UI.ink, 5);

    this.uiLayer.add([gear, gearIcon, pill, lvl, coinBg, coin, this.coinLabel, gearZone]);

    // Centred on its own row, because it is the only one. Left at 180 it reads as the first of a
    // row whose other two buttons failed to draw.
    this.buildBooster("magnet", col ? hc.x : L.boostX, col ? hc.boostY : L.boostY);
  }

  /**
   * The booster's two faces, live and not-yet.
   *
   * ⚠ **One function, three call sites.** `refreshHud` sets this texture from two different
   * branches and `buildBooster` from a third; written inline, the phone would keep the green face
   * in whichever branch was added last, and it would be the locked state — the one a reviewer sees
   * for the first five levels and nobody tests.
   */
  private boosterBtn(on: boolean): string {
    if (WIDE_HUD) return K.btn(on ? "green" : "greenOff");
    /**
     * ⚠ **One face on a phone, and nothing else dims either — so "not yet" is not shown there at
     * all.** Out on the violet the face goes to "greenOff" whenever the belt has no plan for the
     * booster, which is most of a level. In the HUD row the button has to be the same purple as the
     * level pill and the coin, and everything tried for saying "not yet" on top of that was worse
     * than saying nothing: a darker square reads as the one control that failed to draw, and a
     * greyed magnet reads as a broken icon. Pressing it with no plan still refuses, with the deny
     * sound — the state is audible rather than visible. Deliberate, and asked for.
     */
    return K.btn("purpleSq");
  }


  private buildBooster(kind: BoosterKind, x: number, y: number) {
    const c = this.add.container(x, y);
    /**
     * A green pad behind the button.
     *
     * ⚠ The booster is the only control that sits out on the violet, away from both the HUD pills
     * and the white cabinet — which makes it the easiest thing on screen to miss and the one thing
     * the player has been taught to press. The pad gives it a ground of its own, so it reads as
     * mounted on the machine rather than floating over it.
     *
     * ⚠ Sized off `boostSize` like the icon and the badge, and drawn **first** so the button sits on
     * top of it. Two faint rings outside the white rather than a stroked border: an outline at this
     * size reads as a second button around the first.
     */
    const pad = this.add.graphics();
    const R = L.boostSize / 2;
    // ⚠ 14px of white all round, not 5. At 5 the pad was a rim the eye read as anti-aliasing on the
    // button's own edge — present in the pixels and absent to anyone looking at the screen. A pad
    // meant to draw attention has to be wider than the thing it sits under is thick.
    const PAD = 14;
    // ⚠ Green since 2026-08-20, reported as the white being hard to look at. The white read as a
    // plain disc with an icon punched out of it — the green button inside was almost entirely
    // covered by the icon, so the control the player sees *is* the pad.
    //
    // ⚠ The solid ring is `greenEdge`, **darker** than the button face, not `green`. A mount has to
    // be darker than the thing mounted on it or the two merge into one flat blob: the face is baked
    // #7fe06a → #3fb43f → #2c8330, and against a pad of the same brightness its light top edge —
    // the only thing making it read as raised — disappears.
    // ⚠ **No disc at all on a phone — the square face is the whole button.** All three of these are
    // `fillRoundedRect` at a corner radius of half the side, which is a circle; the square the player
    // sees is the face drawn on top of them. Out in the wide layout's pad the booster stands alone on
    // the violet and the disc is what gives it a ground of its own. In the HUD row it has no such
    // problem — it is one of four controls on a line — and the disc there is a 74px green circle
    // behind a 56px purple square, which is two shapes doing one job.
    if (WIDE_HUD) {
      pad.fillStyle(UI.green, 0.16).fillRoundedRect(-R - PAD - 20, -R - PAD - 20, 2 * (R + PAD + 20), 2 * (R + PAD + 20), R + PAD + 20);
      pad.fillStyle(UI.green, 0.34).fillRoundedRect(-R - PAD - 9, -R - PAD - 9, 2 * (R + PAD + 9), 2 * (R + PAD + 9), R + PAD + 9);
      pad.fillStyle(UI.green, 1).fillRoundedRect(-R - PAD, -R - PAD, 2 * (R + PAD), 2 * (R + PAD), R + PAD);
    }

    // ⚠ The frame is drawn **around** the icon again, not hidden behind it. On the HUD line there
    // was no room for both and the icon won; on its own row the button reads as a button, which is
    // what a control the player is asked to press has to look like.
    const face = img(this, this.boosterBtn(true), 0, 0).setScale(L.boostSize / 76);
    this.boosterFace = face;
    // ⚠ The icon is 44px baked and is drawn at 54 — **larger than its 60px frame allows for**, so it
    // breaks slightly out of the button. At 1.32 it came out 58px wide inside a 60px face and the
    // magnet ran into the level pill beside it; the gap between the gear and the pill is 127px and
    // the whole control has to live inside it.
    // ⚠ Derived from the frame, never typed in beside it. The icon sits at 77% of the button and
    // has to stay there — the two were set independently once and the next size change left a
    // 43px magnet in a 46px frame, filling it corner to corner.
    const icon = img(this, K.icon(kind), 0, -2).setScale((L.boostSize * 0.77) / 44 / TS);
    const badge = this.add.graphics();
    const cost = this.add
      .text(BADGE_AT, BADGE_AT - 1, "", { fontFamily: FONT, fontSize: "16px", color: "#ffffff" })
      .setOrigin(0.5);
    this.boosterBadge = badge;
    this.boosterCost = cost;
    // ⚠ Built here and only toggled later, never created inside `refreshHud` — that runs on every
    // tick, and an image added there would stack one sprite per frame on a locked board.
    const lock = img(this, K.lock, 26, 24).setScale(0.62 / TS).setVisible(false);
    this.boosterLock = lock;
    const zone = this.add
      // ⚠ 56, not `boostSize`. The frame is 30 and the icon overhangs it; a hit zone cut to the
      // frame would be a control you have to hit dead centre of the thing you can barely see.
      .rectangle(0, 0, L.boostSize + 12, L.boostSize + 12, 0xffffff, 0)
      .setInteractive({ useHandCursor: true });
    zone.on("pointerdown", () => {
      if (this.magTutor && !this.magTutor.finished && !this.magTutor.allowBooster()) {
        sfx.deny();
        return;
      }
      this.onBooster(kind);
    });
    // ⚠ Badge under the text, both above the face — drawn after `cost` the graphics would cover
    // the very number it exists to frame. The lock sits in the same corner as the count, because
    // it says the same kind of thing: what this button has for you right now.
    c.add([pad, face, icon, badge, cost, lock, zone]);
    // Built either way so the layout and the fly-to target survive; only the pixels and the
    // hit test go away while the row is hidden.
    if (!SHOW_BOOSTERS) {
      c.setVisible(false);
      zone.disableInteractive();
    }
    this.uiLayer.add(c);
    this.boosterBtns[kind] = c;
  }

  // ── Input ──────────────────────────────────────────────────────────────────

  private onTapCell(i: number) {
    if (this.paused || this.board.status !== "play") return;

    // ⚠ Through `anchorAt`, always. A linked pair is stored once at its left cell and covers the
    // cell to its right, so a tap on that right cell finds no tile of its own — refusing it
    // would make half the piece dead to the touch, which is the opposite of what the clip
    // between them promises.
    const a = this.board.anchorAt(i);
    const tile = a >= 0 ? this.board.tiles[a] : null;
    if (!tile || tile.hidden) {
      sfx.deny();
      this.shake(this.tileSprites[i]);
      return;
    }
    if (!this.board.canEscape(a)) {
      sfx.deny();
      // Both halves, or the pair rocks about its clip like two separate trays.
      this.shake(this.tileSprites[a]);
      if (tile.wide) this.shake(this.tileSprites[a + 1]);
      return;
    }
    // Read the load before tapping — tap() clears the tile, and an x2 tray owes twice as
    // many marbles as a plain one. Spawning the wrong number leaves phantoms in flight that
    // never arrive, and the level can then never be won.
    const load = this.board.load(a);
    if (this.board.capacity() < load) {
      sfx.deny();
      this.flashBeltFull();
      return;
    }

    this.undoStack.push(this.board.snapshot());
    if (this.undoStack.length > 30) this.undoStack.shift();

    // ⚠ Capture both colours before tapping — `tap()` clears the tile, and a linked pair owes
    // half of *each*. Spawning `load` marbles of the anchor's colour puts nine of the wrong
    // colour on screen and the belt then contradicts them one by one.
    const half = tile.wide ? load / 2 : load;
    const drops: { color: Color; dx: number }[] = [];
    for (let k = 0; k < half; k++) {
      drops.push({ color: tile.color, dx: 0 });
      // The right half pours out of its own cell, a whole pitch across, not out of a wider
      // scatter around the left one — the picture is two trays tipping together.
      if (tile.wide) drops.push({ color: tile.mate ?? tile.color, dx: this.gm.pitch });
    }
    this.board.tap(a);
    sfx.release();
    this.spawnTray(this.tileSprites[a].x, this.tileSprites[a].y, drops);
    this.refreshGrid();
    // ⚠ The counter on a chocolate box moves on the **tap**, so it has to be redrawn on the tap.
    // `refreshGrid` only touches the tray sprites; leaving the box to the next tick meant the
    // player poured a tray the box plainly wanted and watched the number sit there.
    this.refreshFixtures();
    this.board.lastOpened.forEach((at) => this.playLidOpen(at));
    this.board.lastUnlocked.forEach((at) => this.playUnlock(at));
    // Only after the pour actually happened — every early return above is a tap the player made
    // and the board refused, which is not the thing step 1 is waiting to see.
    this.tutorial?.noteTap();
    this.coach?.noteTap();
    this.magTutor?.noteTap(a);
  }


  private onBooster(_kind: BoosterKind) {
    // ⚠ Gated here rather than only at the button, because the button is not the only caller:
    // `window.__ms` and `--exercise` reach this directly.
    if (!SHOW_BOOSTERS) return;
    if (this.paused || this.board.status !== "play") return;

    // ⚠ Refused **here**, not only by dimming the button. The button is not the only caller —
    // `window.__ms.scene.onBooster()` and `npm run shot -- --exercise` reach this directly, and a
    // lock that only exists in the HUD is not a rule. Same reasoning as the `SHOW_BOOSTERS` line
    // above it.
    //
    // ⚠ The toast names the level. "Not yet" leaves the player pressing it again every board to
    // find out whether this is the one.
    if (this.magnetLocked) {
      sfx.deny();
      this.toast(`Unlocks at level ${MAGNET_TUTOR_LEVEL}`);
      return;
    }

    // ⚠ Nothing is taken from the board before it is known the player can pay — `useRevive` changes
    // it, and a booster that has already fired cannot be refused afterwards.
    //
    // ⚠ At zero the press is a **question**, not a purchase. The player asked for the effect, not
    // to spend 60 coins, and a button that quietly takes the money is a button they stop trusting.
    // ⚠ No board test here. Buying is stock for later, not a move — see the note in `refreshHud`.
    if (save.magnets <= 0) {
      this.askBuyMagnet();
      return;
    }

    // ⚠ **The same rule the revive runs, not a second copy of it.** `revivePlan` is what guarantees
    // a box leaves with exactly the `BOX_SLOTS` marbles that were going to fill it; anything that
    // frees belt slots without taking their boxes, or takes boxes without their marbles, leaves the
    // level unwinnable several minutes before it says so. That arithmetic is the whole feature, and
    // it is already proven by `npm run revive` over 1450 real jams.
    const picks = this.board.useRevive();
    if (!picks) {
      sfx.deny();
      // ⚠ Says which of the two conditions failed. "Nothing to pull" is what the old magnet said and
      // it left the player guessing whether the button was broken.
      this.toast("No two boxes ready yet");
      return;
    }

    save.magnets = save.magnets - 1;
    // ⚠ **Firing it at all is what marks it learned — not finishing the lesson.** The lesson only
    // wrote `markCoach("magnet")` from its own completion path, so a player who found the button on
    // their own was still owed a lesson, and got one levels later: a card explaining a booster they
    // had already been using, which gates the board for three beats to teach nothing. The question
    // the gate is really asking is "does this player know what the magnet is", and pressing it is a
    // better answer than sitting through a card about it.
    //
    // ⚠ Here, not in `startMagnetTutor`. Only this path knows the press actually went through —
    // above it, an empty stock opens the buy card and a board with no plan is refused, and neither
    // of those has taught the player anything.
    //
    // ⚠ `teachAll()` guarded, like every other write of a coach mark: `?teach=1` is for looking at
    // the lessons, and looking at one must not spend it on the device you then hand to a playtester.
    if (!teachAll()) save.markCoach("magnet");
    // ⚠ Logged either way. `PURE=1` keeps a level that leaned on a booster out of the model
    // ranking, and a free booster is exactly as much help as a bought one.
    this.boostersUsed.push("magnet");
    sfx.booster();
    this.magnetPull();
    this.magTutor?.noteBooster();
    this.playRevive(picks, true);
  }



  // ── Marbles in the chute ───────────────────────────────────────────────────

  /**
   * Tip a tray into the chute. `x`/`y` is the *anchor* cell's centre and each drop carries its
   * own offset from it, so a linked pair pours out of two cells in two colours rather than out
   * of one cell in one.
   */
  private spawnTray(x: number, y: number, drops: { color: Color; dx: number }[]) {
    drops.forEach((d, i) => {
      this.time.delayedCall(i * 55, () => {
        const jx = d.dx + (Math.random() - 0.5) * 26;
        this.dropMarble(x + jx, y + (Math.random() - 0.5) * 14, d.color);
      });
    });
  }

  private dropMarble(x: number, y: number, color: Color) {
    // Barely bouncy, quite draggy: marbles are meant to settle and creep down the cone one
    // at a time, not ricochet. The gravity that goes with this is set in main.ts.
    const body = this.matter.add.circle(x, y, L.marbleR, {
      restitution: 0.18,
      friction: 0.05,
      frictionAir: 0.004,
      density: 0.005,
    });
    const sprite = img(this, K.marble(color), x, y);
    this.fallLayer.add(sprite);
    this.falling.push({ body, sprite, color, born: this.time.now });
  }

  /** Lift the lowest settled marble off the neck and hand it to the belt queue. */
  private drainFunnel() {
    if (this.board.pending.length) return;
    // Nothing leaves the neck until the rail directly below it is clear. This is what makes
    // the chute back up visibly when the belt is congested, instead of quietly swallowing
    // marbles into an off-screen queue.
    if (!this.board.entryFreeNextTick()) return;
    let best: Falling | null = null;
    for (const f of this.falling) {
      if (f.body.position.y < L.funnel.neckY - 46) continue;
      if (!best || f.body.position.y > best.body.position.y) best = f;
    }
    // Backstop: logic is owed marbles but there is not a single body in the chute to supply
    // them. Nothing should get here, but if anything ever does the level would hang forever
    // with no way for the player to tell why, so pay the debt straight from the queue.
    if (!best && !this.falling.length && this.board.inFlight.length) {
      this.feedQueue.push({ x: FEED_FROM.x, y: FEED_FROM.y, rot: 0 });
      this.board.arrive(this.board.inFlight[0]);
      return;
    }

    // Nothing has reached the neck. If something has been stuck up there long enough, take
    // the oldest one regardless — see CHUTE_TIMEOUT_MS.
    if (!best) {
      for (const f of this.falling) {
        if (this.time.now - f.born < CHUTE_TIMEOUT_MS) continue;
        if (!best || f.born < best.born) best = f;
      }
    }
    if (!best) return;
    // ⚠ Read the body's real position and spin **before** destroying it. This is the whole join
    // between the two halves of the drop: the chute is physics and the rail is interpolation, and
    // the player is following one ball across the seam.
    this.feedQueue.push({
      x: best.body.position.x,
      y: best.body.position.y,
      rot: best.sprite.rotation,
    });
    this.matter.world.remove(best.body);
    best.sprite.destroy();
    this.falling.splice(this.falling.indexOf(best), 1);
    this.board.arrive(best.color);
  }

  // ── The clock ──────────────────────────────────────────────────────────────

  /**
   * Marbles knocking down the chute. Rate-limited hard — Matter reports a burst of pairs on
   * a single pile-up, and playing all of them turns the ASMR into a buzz.
   */
  private onCollide(e: { pairs: { collision: { depth: number } }[] }) {
    if (this.paused || !this.falling.length) return;
    if (this.time.now - this.lastClackAt < 45) return;
    this.lastClackAt = this.time.now;
    const depth = e.pairs[0]?.collision?.depth ?? 0;
    sfx.tumble(Math.min(2, depth));
  }

  private onTick() {
    if (this.paused || this.board.status !== "play") return;

    // A marble that squeezed past the walls would otherwise be lost forever, and the level
    // could never be won because logic still counts it as in flight.
    for (const f of [...this.falling]) {
      if (f.body.position.y > GAME_H + 60 || f.body.position.x < -60 || f.body.position.x > GAME_W + 60) {
        this.matter.world.remove(f.body);
        f.sprite.destroy();
        this.falling.splice(this.falling.indexOf(f), 1);
        // Its real position is off-screen, so the neck is the only honest place to feed it from.
        this.feedQueue.push({ x: FEED_FROM.x, y: FEED_FROM.y, rot: 0 });
        this.board.arrive(f.color);
      }
    }

    this.drainFunnel();
    // The tread travels exactly one marble-slot per tick, same as the marbles, so the two
    // stay locked together and the belt reads as carrying them.
    this.beltTravel = (this.beltTravel + BELT_SPACING) % BELT_PERIM;
    // ⚠ Two conditions, not one. The lesson ends by the **booster firing**, which happens outside
    // this block — so testing `!finished` before calling `tick` and again inside it meant the
    // finishing path was never reached and the lesson was never marked seen. It replayed on every
    // visit to the level, gating the board each time.
    if (this.magTutor) {
      if (!this.magTutor.finished) this.magTutor.tick();
      if (this.magTutor.finished) {
        save.markCoach("magnet");
        this.magTutor.destroy();
        this.magTutor = null;
        // The board is the player's again, and whatever piece the coach wanted to explain can have
        // its turn now.
        this.startCoach();
      }
    }
    const ev = this.board.tick();
    // `tick` is what moves a marble out of `pending` and onto the entry slot, and it sets exactly
    // one `fresh` when it does. Consuming here keeps the queue in step with the belt no matter how
    // many ticks the marble spent waiting for the rail to clear.
    if (this.board.fresh[0]) this.feedNow = this.feedQueue.shift() ?? null;
    this.lastTickAt += this.tickMs;
    // A long stall (tab in the background) must not leave the clock owing dozens of ticks.
    if (this.time.now - this.lastTickAt > this.tickMs * 4) this.lastTickAt = this.time.now;
    this.applyEvents(ev);

    if (ev.status === "won") this.finish(true);
    // The rail filled up and nothing on it fits a box — the one position a revive exists for.
    // Offer it *before* `finish`, which writes the play log: a game that carries on is not over,
    // and logging it here would record a loss the player then went on to win.
    else if (ev.status === "lost") {
      const plan = this.board.revivePlan();
      if (plan) this.offerRevive(plan);
      else this.finish(false);
    }
  }

  private applyEvents(ev: TickEvents) {
    for (const m of ev.matched) {
      const from = slotPos(m.slot, 0);
      const ghost = img(this, K.marble(m.color), from.x, from.y);
      this.fxLayer.add(ghost);
      const hole = this.holePos(m.col, m.filled - 1);
      this.tweens.add({
        targets: ghost,
        x: hole.x,
        y: hole.y,
        duration: 150,
        ease: "Quad.easeIn",
        onComplete: () => {
          ghost.destroy();
          this.refreshBoxes();
          this.seatFx(hole.x, hole.y, m.color, m.filled);
        },
      });
      sfx.collect(m.filled / BOX_SLOTS);
      if (m.popped) this.popBox(m.col, m.color);
    }
    if (ev.matched.length || ev.emitted.length || ev.revealed.length) this.refreshBoxes();
    if (ev.emitted.length || ev.revealed.length || ev.unlocked.length) this.refreshGrid();
    ev.unlocked.forEach((cell) => this.playUnlock(cell));
    // Any box clear can move a counter, so redraw the fixtures whenever one popped.
    if (ev.matched.some((m) => m.popped)) this.refreshFixtures();
    ev.opened.forEach((at) => this.playLidOpen(at));
    ev.emitted.forEach((cell) => this.playEmit(cell));
  }

  /** A hatch shoving the next tray out from under its shutter. */
  private playEmit(cell: number) {
    const ts = this.tileSprites[cell];
    if (!ts.visible) return;
    const restY = ts.y;
    ts.setY(restY - this.gm.pitch * 0.55).setAlpha(0.2);
    this.tweens.add({ targets: ts, y: restY, alpha: 1, duration: 240, ease: "Back.easeOut" });

    const gate = this.dispSprites[cell - this.board.cols];
    if (gate?.visible) {
      const gy = gate.y;
      this.tweens.add({ targets: gate, y: gy + 5, duration: 90, yoyo: true, ease: "Quad.easeOut" });
    }
    sfx.pick();
  }

  /** A marble landing in its hole: a shockwave, a twinkle, and the box flinching. */
  private seatFx(x: number, y: number, color: Color, filled: number) {
    sfx.seat(filled / BOX_SLOTS);

    const ring = img(this, K.ring, x, y).setScale(0.2 / TS).setAlpha(1);
    ring.setTintFill(PALETTE[color].dark);
    this.fxLayer.add(ring);
    this.tweens.add({
      targets: ring,
      scale: 1.5 / TS,
      alpha: 0,
      duration: 340,
      ease: "Quad.easeOut",
      onComplete: () => ring.destroy(),
    });

    const spark = img(this, K.spark, x, y - 2).setScale(0.15 / TS);
    this.fxLayer.add(spark);
    this.tweens.add({
      targets: spark,
      scale: 1.3 / TS,
      alpha: 0,
      angle: 90,
      duration: 360,
      ease: "Quad.easeOut",
      onComplete: () => spark.destroy(),
    });
  }

  /**
   * A chocolate box breaking up, and the four trays underneath joining the board.
   *
   * ⚠ Slower and heavier than the box-clear burst, deliberately. A box in the well clears several
   * times a level so it gets punctuation; a chocolate box comes off **once**, after the player
   * spent a dozen taps earning it, and a 500ms firework threw that away. The shards are chocolate
   * tones and they *fall* — they arc outward and then down, so it reads as something breaking
   * rather than something exploding.
   */
  private playLidOpen(at: number) {
    const gm = this.gm;
    const x = gm.x + (at % this.board.cols) * gm.pitch + gm.cell / 2 + gm.pitch / 2;
    const y = gm.y + ((at / this.board.cols) | 0) * gm.pitch + gm.cell / 2 + gm.pitch / 2;
    sfx.boxClear();

    const flash = img(this, K.flash, x, y).setScale(0.8 / TS).setAlpha(0.85);
    this.fxLayer.add(flash);
    this.tweens.add({
      targets: flash,
      scale: 3.2 / TS,
      alpha: 0,
      duration: 720,
      ease: "Quad.easeOut",
      onComplete: () => flash.destroy(),
    });

    // Chocolate, not confetti: three tones off the slab itself.
    const CRUMB = [0x8a5a2f, 0x6b4423, 0x4a2c14];
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + (i % 2) * 0.2;
      const far = 52 + (i % 3) * 22;
      const sp = img(this, K.spark, x, y).setScale(0.25 / TS);
      sp.setTintFill(CRUMB[i % CRUMB.length]);
      this.fxLayer.add(sp);
      // Out first, then down — two tweens rather than one, because a single straight line to the
      // destination is what makes a burst read as a firework.
      this.tweens.add({
        targets: sp,
        x: x + Math.cos(a) * far,
        y: y + Math.sin(a) * far * 0.7,
        scale: { from: 0.95 / TS, to: 0.6 / TS },
        angle: (i % 2 ? 1 : -1) * 180,
        duration: 340,
        ease: "Quad.easeOut",
        onComplete: () => {
          this.tweens.add({
            targets: sp,
            y: sp.y + 90,
            scale: 0.15 / TS,
            alpha: 0,
            duration: 520,
            ease: "Quad.easeIn",
            onComplete: () => sp.destroy(),
          });
        },
      });
    }

    this.refreshFixtures();
    this.refreshGrid();
    // The four trays fade up rather than blinking in, so the eye follows them out from under the
    // shards instead of finding them already there.
    for (const cell of [at, at + 1, at + this.board.cols, at + this.board.cols + 1]) {
      const s = this.tileSprites[cell];
      if (!s?.visible) continue;
      s.setAlpha(0);
      this.tweens.add({ targets: s, alpha: 1, duration: 420, delay: 160 });
    }
  }

  private popBox(j: number, color: Color) {
    // Three boxes in a row lights the rim. `boxClear` returns the run the bell is already counting,
    // so the sound and the fireworks land together.
    //
    // ⚠ **Every third box of a run, not every box from the third on.** Left firing on all of 3..8
    // that is six bursts inside a couple of seconds — the box-clear punctuation rule broken by the
    // very effect meant to reward beating it.
    //
    // ⚠ In practice that means **3 and 6, and no more**: the run saturates at 8, because
    // `boxClear` clamps to its `CHAIN_STEPS` table so the bell has somewhere to stop climbing. A
    // run of 12 therefore gets the same bursts as a run of 6. Measured, not assumed — the
    // arithmetic reads as though 9 and 12 would fire. Left as it is (a monster run should not turn
    // into a fireworks display), and written down so the next person does not "fix" the multiple
    // and get nothing new.
    const run = sfx.boxClear();
    if (run >= COMBO_RUN && run % COMBO_RUN === 0) this.comboFireworks(color);
    const x = boxColX(j);
    const y = L.box.top + L.box.h / 2;

    // Flash first — it covers the frame where the box is swapped out. Kept small and brief:
    // a box clears several times a level, so this has to be a punctuation mark, not an event.
    const flash = img(this, K.flash, x, y).setScale(0.7 / TS).setAlpha(0.7);
    this.fxLayer.add(flash);
    this.tweens.add({
      targets: flash,
      scale: 1.7 / TS,
      alpha: 0,
      duration: 300,
      ease: "Quad.easeOut",
      onComplete: () => flash.destroy(),
    });

    // A shockwave in the box's own dark tone. White-on-white would vanish against the well.
    const wave = img(this, K.ring, x, y).setScale(0.35 / TS).setAlpha(0.6);
    wave.setTintFill(PALETTE[color].dark);
    this.fxLayer.add(wave);
    this.tweens.add({
      targets: wave,
      scale: 2 / TS,
      alpha: 0,
      duration: 340,
      ease: "Cubic.easeOut",
      onComplete: () => wave.destroy(),
    });

    // Sparks thrown out along the bar, so the burst reads as the *box* bursting rather than
    // a puff at its centre.
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.random() * 0.4;
      const dist = 20 + Math.random() * 24;
      const sp = img(this, K.spark, x + Math.cos(a) * 10, y + Math.sin(a) * 6).setScale(
        0.15 / TS,
      );
      sp.setTintFill(i % 3 === 0 ? 0xfff3b0 : PALETTE[color].base);
      this.fxLayer.add(sp);
      this.tweens.add({
        targets: sp,
        x: x + Math.cos(a) * dist * 1.5,
        y: y + Math.sin(a) * dist * 0.8,
        scale: { from: 0.8 / TS, to: 0.06 / TS },
        angle: Math.random() * 120 - 60,
        alpha: { from: 0.85, to: 0 },
        duration: 320 + Math.random() * 140,
        ease: "Quad.easeOut",
        onComplete: () => sp.destroy(),
      });
    }

    const ghost = img(this, K.box(color), x, y);
    this.fxLayer.add(ghost);
    this.tweens.add({
      targets: ghost,
      y: y - 44,
      alpha: 0,
      scale: 1.12 / TS,
      angle: Math.random() * 14 - 7,
      duration: 260,
      ease: "Quad.easeIn",
      onComplete: () => ghost.destroy(),
    });

    // Slide the rest of the column up into the gap. No camera shake — several boxes clear per
    // level and shaking the whole machine each time is exhausting rather than satisfying.
    this.slideColumn(j);
  }

  /**
   * Three boxes eaten in a row: small fireworks up the two rims of the cabinet.
   *
   * ⚠ **Up the rims, not over the well.** The reward for a run lands while the run is still going,
   * so anything drawn across the box row or the belt hides the next marble arriving — the player
   * is congratulated by having the thing they are playing taken off screen. The cabinet's
   * shoulders are the only strip of the machine nothing is ever read off, which is exactly what
   * makes them the place to put this.
   *
   * ⚠ **Three shells a side**, not one big burst. Depth is what makes it read as a display rather
   * than a pop, and the win screen is still where the budget goes (`confetti`, the star pops).
   *
   * ⚠ It grows **upward and in count, never wider.** The launch sits 34px in from the cabinet edge
   * and the sparks already reach within a few pixels of the canvas on both sides, so scaling the
   * horizontal throw is how this starts getting cropped by the screen — and a firework clipped by
   * the screen edge reads as a rendering fault, not as a firework. More shells, a bigger ring, more
   * and larger sparks, a longer fall: all free. A wider `far`: not.
   *
   * ⚠ It runs about 1.7s, and the length lives in the **stagger and the falling embers**, not in
   * the climb. Slowing the rocket to fill the same time makes it read as sluggish rather than
   * longer — a shell that crawls has not been launched. So the second shell hangs back further
   * and the sparks fall further over more time; the climb is barely touched.
   *
   * Tinted with the colour just eaten plus a deep gold, so the burst points back at what earned it
   * rather than being generic celebration confetti.
   *
   * ⚠ **No additive blending and no pale tones**, which is the whole reason the first version
   * photographed as an empty machine. The rims are part of the cabinet and the cabinet is *white*;
   * a gold spark on ADD over white is white, so the effect ran perfectly and could not be seen.
   * Same trap the box-clear burst is tinted out of, met on a lighter surface still. Saturated fill,
   * and a ring rather than a flash for the pop — an outline survives a light ground, a glow does not.
   */
  private comboFireworks(color: Color) {
    const y0 = L.box.top + 14;                       // launch: down at the well, where it was earned
    const y1 = L.funnel.shoulder + 16;               // burst: up alongside the board itself
    const tint = [PALETTE[color].base, 0xf08a1c, PALETTE[color].dark];

    for (const side of [-1, 1]) {
      // ⚠ 34px in from the cabinet edge, not 10. At 10 the burst ring hung half off the canvas —
      // a firework cropped by the screen edge reads as a rendering fault, not as a firework. This
      // is the middle of the shoulder, which is the widest clear strip the rim has (48 - 14).
      const x = side < 0 ? L.machine.x + 34 : L.machine.x + L.machine.w - 34;
      for (let shell = 0; shell < 3; shell++) {
        const burstY = y1 + shell * 46;              // each stops lower, so the three stack

        // The shell: a spark stretched along its flight, so it reads as a streak rather than a
        // dot sliding. The climb is what makes the pop a consequence instead of an appearance.
        const rocket = img(this, K.spark, x, y0).setScale(0.34 / TS, 1.5 / TS);
        rocket.setTintFill(tint[1]);
        this.fxLayer.add(rocket);
        this.tweens.add({
          targets: rocket,
          y: burstY,
          alpha: { from: 1, to: 0.75 },
          duration: 430,
          delay: shell * 300,
          ease: "Quad.easeOut",
          onComplete: () => {
            rocket.destroy();
            this.comboBurst(x, burstY, tint);
          },
        });
      }
    }
  }

  /** One pop: a ring going out and a scatter of sparks that arc out and then drop. */
  private comboBurst(x: number, y: number, tint: number[]) {
    const ring = img(this, K.ring, x, y).setScale(0.16 / TS).setAlpha(0.95);
    ring.setTintFill(tint[1]);
    this.fxLayer.add(ring);
    this.tweens.add({
      targets: ring,
      scale: 1.35 / TS,
      alpha: 0,
      duration: 480,
      ease: "Cubic.easeOut",
      onComplete: () => ring.destroy(),
    });

    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + Math.random() * 0.3;
      // ⚠ Unchanged. This is the one number that decides whether the burst fits on the canvas.
      const far = 24 + Math.random() * 20;
      const sp = img(this, K.spark, x, y).setScale(0.1 / TS);
      sp.setTintFill(tint[i % tint.length]);
      this.fxLayer.add(sp);
      // Out, then down. One straight tween to the far point is a starburst decal; the fall is
      // what makes it a firework — the same reason `playLidOpen` throws its shards in two legs.
      this.tweens.add({
        targets: sp,
        x: x + Math.cos(a) * far,
        y: y + Math.sin(a) * far,
        scale: { from: 1.1 / TS, to: 0.38 / TS },
        duration: 300,
        ease: "Quad.easeOut",
        onComplete: () => {
          this.tweens.add({
            targets: sp,
            y: sp.y + 78 + Math.random() * 50,
            scale: 0.02 / TS,
            alpha: 0,
            duration: 640,
            ease: "Quad.easeIn",
            onComplete: () => sp.destroy(),
          });
        },
      });
    }
  }

  private holePos(j: number, hole: number) {
    return {
      x: boxColX(j) + (hole - (BOX_SLOTS - 1) / 2) * HOLE_STEP,
      y: L.box.top + L.box.h / 2 - 2,
    };
  }

  // ── Refresh ────────────────────────────────────────────────────────────────

  /**
   * Bars and lids. Rebuilt wholesale rather than kept in sync: a lid comes off exactly once
   * per level, so there is nothing to gain from diffing and a stale sprite would sit on the
   * board forever.
   */
  private refreshFixtures() {
    const g = this.board;
    const gm = this.gm;
    const cx = (i: number) => gm.x + (i % g.cols) * gm.pitch + gm.cell / 2;
    const cy = (i: number) => gm.y + ((i / g.cols) | 0) * gm.pitch + gm.cell / 2;
    this.fixtures.removeAll(true);

    for (const b of g.bars) {
      const bar = img(this, K.bar, cx(b) + gm.pitch / 2, cy(b));
      const label = this.add
        .text(cx(b) + gm.pitch / 2, cy(b) - 1, "x2", {
          fontFamily: FONT,
          fontSize: "22px",
          color: "#ffffff",
        })
        .setOrigin(0.5)
        .setStroke(UI.ink, 5);
      this.fixtures.add([bar, label]);
    }

    for (const lid of g.lids) {
      const x = cx(lid.at) + gm.pitch / 2;
      const y = cy(lid.at) + gm.pitch / 2;
      const plate = img(this, K.lid, x, y);
      const ribbon = img(this, K.lidRibbon(lid.color), x, y);
      const dial = img(this, K.lidDial, x, y).setScale(1.05 / TS);
      const n = this.add
        .text(x, y - 1, String(lid.need), {
          fontFamily: FONT,
          fontSize: "30px",
          color: "#4a2c14",
        })
        .setOrigin(0.5);
      this.fixtures.add([plate, ribbon, dial, n]);
    }
  }

  private refreshGrid() {
    const g = this.board;
    const gm = this.gm;
    // The right half of a linked pair has no tile of its own — `anchorAt` makes it answer for the
    // left one — so its sprite has to be driven from here or it renders as an empty cell with a
    // clip floating beside it.
    //
    // ⚠ Only the **colour** differs between the halves. Raised/flat and face-down are properties
    // of the piece, not of a cell: one tap empties both, so if either half has a way out the
    // whole pair moves, and both halves have to say so. Two halves disagreeing about whether
    // they can move is the clip claiming they are one piece while the eggs say they are two.
    const mates = new Map<number, { color: Color; raised: boolean; hidden: boolean }>();
    for (let i = 0; i < g.tiles.length; i++) {
      const t = g.tiles[i];
      if (t?.wide) {
        mates.set(i + 1, { color: t.mate ?? t.color, raised: g.canEscape(i), hidden: t.hidden });
      }
      this.linkSprites[i]?.setVisible(!!t?.wide);
    }
    for (let i = 0; i < g.tiles.length; i++) {
      const tile = g.tiles[i];
      const disp = g.disp[i];
      const ts = this.tileSprites[i];
      const ds = this.dispSprites[i];
      const label = this.badgeLabels[i];
      const homeX = gm.x + (i % g.cols) * gm.pitch + gm.cell / 2;
      const homeY = gm.y + ((i / g.cols) | 0) * gm.pitch + gm.cell / 2;

      // Casing gets no backing plate at all, so the panel shows through as solid body. A crate
      // is an object sitting *in* a slot and keeps its slot; a wall is the absence of one, and
      // that difference is the whole tell — a sunken slot says "a tray could slide here".
      this.cellSprites[i].setVisible(!g.wall[i]);
      this.crateSprites[i].setVisible(g.blocked[i]);
      // Hidden by default and turned back on only by the tile branch below, so every early
      // `continue` — a hatch, an empty cell, the mate half of a pair — leaves no badge behind.
      this.arrowSprites[i]?.setVisible(false);
      ds.setVisible(!!disp);
      if (disp) {
        // The housing is baked with its shutter along the bottom, so turning the whole sprite is
        // what turns the hatch. +90° swings the bottom edge round to the left, -90° to the right.
        const dir = disp.dir ?? "down";
        ds.setRotation(dir === "left" ? Math.PI / 2 : dir === "right" ? -Math.PI / 2 : 0);
        // Keep the count off the shutter, whichever side it ends up on — the number is the one
        // thing about a hatch the board actually shows, and a rotated housing would cover it.
        const lx = dir === "left" ? homeX + 7 : dir === "right" ? homeX - 7 : homeX;
        const ly = dir === "down" ? homeY - 10 : homeY - 1;
        label.setVisible(true).setText(String(disp.queue.length)).setPosition(lx, ly);
        ts.setVisible(false);
        continue;
      }

      if (!tile) {
        const mate = mates.get(i);
        if (mate) {
          ts.setVisible(true)
            .setTexture(mate.hidden ? K.trayHidden : K.tray(mate.color, mate.raised))
            .setPosition(homeX, homeY)
            .setData("homeX", homeX);
        } else {
          ts.setVisible(false);
        }
        label.setVisible(false);
        continue;
      }

      // ⚠ `liftable`, not `canEscape`: a tray held shut by an arrow has a way out and still cannot
      // be poured, and raised eggs are the board's promise that it can.
      const raised = g.liftable(i);
      // Remember where the sprite belongs. `shake` restores to this rather than to wherever the
      // sprite happens to be, which is what stops repeated taps walking a locked tray sideways.
      // A linked pair is two ordinary trays with a clip between them, never one double-width
      // sprite: it carries two colours and baking every combination would be PALETTE² textures
      // at boot for an 18px detail. So the anchor draws exactly like a single tray — its own
      // colour — and the block above draws the mate's half with the same raised and face-down
      // state. Only the colour is per-half.
      ts.setVisible(true)
        .setTexture(tile.hidden ? K.trayHidden : K.tray(tile.color, raised))
        .setPosition(homeX, homeY)
        .setData("homeX", homeX);
      label.setVisible(false);
      // The arrow badge, turned to face the cell it is waiting on. Baked pointing up, so up is
      // rotation 0. It is only ever on a tray that is showing its colour: a face-down tray has
      // nothing to say yet, and stacking two locks on one tile reads as neither.
      const arrow = this.arrowSprites[i];
      if (tile.arrow && !tile.hidden) {
        const turn =
          tile.arrow === "right" ? Math.PI / 2 : tile.arrow === "down" ? Math.PI : tile.arrow === "left" ? -Math.PI / 2 : 0;
        arrow.setVisible(true).setPosition(homeX, homeY).setRotation(turn).setAlpha(1).setScale(this.gm.cell / L.cell / TS);
      } else {
        arrow.setVisible(false);
      }
    }
  }

  /**
   * A tray whose arrow lock just opened.
   *
   * ⚠ **The badge leaves, and the tray answers.** The whole rule is "pour that one and this one
   * wakes up", so both halves of that sentence have to be visible in the same beat: the arrow flies
   * off towards the cell it was pointing at — the one the player just emptied, which is where their
   * eye already is — and the tray it was sitting on gives a short bounce as its eggs come up.
   * `refreshGrid` has already swapped the flat face for the raised one by the time this runs.
   */
  private playUnlock(cell: number) {
    const badge = this.arrowSprites[cell];
    const ts = this.tileSprites[cell];
    if (badge) {
      badge.setVisible(true).setAlpha(1);
      // It has already been cleared off the tile by now, so the direction comes from where the
      // sprite is pointing rather than from the model.
      const turn = badge.rotation;
      this.tweens.add({
        targets: badge,
        x: badge.x + Math.sin(turn) * this.gm.pitch * 0.7,
        y: badge.y - Math.cos(turn) * this.gm.pitch * 0.7,
        alpha: 0,
        scale: badge.scale * 1.5,
        duration: 300,
        ease: "Quad.easeOut",
        onComplete: () => badge.setVisible(false).setScale(this.gm.cell / L.cell / TS),
      });
    }
    if (ts?.visible) {
      this.tweens.add({
        targets: ts,
        scale: { from: ts.scale * 0.86, to: ts.scale },
        duration: 260,
        ease: "Back.easeOut",
      });
    }
    sfx.pick();
  }

  /**
   * The stack rising by one box after the top one comes off.
   *
   * ⚠ **The column is drawn one box taller than the well is.** Sliding it is done by offsetting the
   * whole container by a box and tweening it home — the right picture for the boxes already on
   * screen, and the wrong one for the deepest, which has nowhere to come from: for those 240ms it
   * sits a full box *below* the well floor, hanging under the cabinet on a tall frame and sliced
   * off by the canvas edge on a short one.
   *
   * So that one sprite is **pinned**: its own y cancels the container's for the length of the
   * tween, and it fades up in place while everything above it slides. Nothing is ever drawn against
   * the rim, and it costs no height — buying the 45px instead is ~8% off how big the game draws on
   * every desktop, where `GAME_H` is clamped to the machine's own height.
   *
   * ⚠ Both callers go through here. They looked like two lines worth inlining and they are the same
   * animation; the box-clear one and the chocolate-burst one drifting apart is how one of them ends
   * up with the artefact and the other does not.
   */
  private slideColumn(j: number) {
    const col = this.boxCols[j];
    const step = L.box.h + L.box.vgap;
    col.y = step;
    const deepest = this.boxImages[j][BOX_VISIBLE - 1];
    const baseY = deepest ? deepest.y : 0;
    if (deepest?.visible) deepest.setAlpha(0);
    this.tweens.add({
      targets: col,
      y: 0,
      duration: 240,
      ease: "Back.easeOut",
      onUpdate: () => {
        if (!deepest) return;
        deepest.y = baseY - col.y;
        deepest.alpha = Math.min(1, Math.max(0, 1 - col.y / step));
      },
      onComplete: () => {
        if (!deepest) return;
        deepest.y = baseY;
        deepest.alpha = 1;
      },
    });
  }

  private refreshBoxes() {
    const g = this.board;
    for (let j = 0; j < BOX_COLS; j++) {
      const stack = g.boxes[j].stack;
      for (let k = 0; k < BOX_VISIBLE; k++) {
        const s = this.boxImages[j][k];
        if (k >= stack.length) {
          s.setVisible(false);
          continue;
        }
        const hidden = g.boxIsHidden(j, k);
        s.setVisible(true).setTexture(
          hidden ? K.boxHidden : k === 0 ? K.boxOpen(stack[k]) : K.box(stack[k]),
        );
        // Shade the queue rather than fading it: a faded box reads as "disabled", a shaded
        // one reads as "further down the well", which is what it actually is.
        s.setTint(SHADE[Math.min(k, SHADE.length - 1)]);
      }
      for (let k = 0; k < BOX_SLOTS; k++) {
        const m = this.boxFill[j][k];
        const on = stack.length > 0 && k < g.boxes[j].filled;
        m.setVisible(on);
        if (on) {
          const p = this.holePos(j, k);
          m.setTexture(K.marble(stack[0])).setPosition(p.x, p.y).setScale(0.78 / TS);
        }
      }
    }
  }

  private refreshHud() {
    this.coinLabel.setText(String(save.coins));
    if (!SHOW_BOOSTERS) return;
    // ⚠ Greyed on **either** reason it cannot be used: no coins, or no plan on this board. A button
    // that looks live and then refuses is worse than one that never offered — and "no two boxes
    // whose colour has six marbles on the rail" is the common case early in a level, when the belt
    // is nearly empty.
    const face = this.boosterFace;
    // ⚠ **This is the face, not the icon**, and the name has been lying since it was written:
    // index 1 of `[pad, face, icon, badge, …]` is the face. Left as it is because what it does —
    // fade the button while the booster is locked — is right, and is what shipped; renaming it to
    // `face` collides with the real `face` two lines up. The magnet itself is `this.boosterIcon`.
    const icon = this.boosterBtns.magnet.list[1] as Phaser.GameObjects.Image;
    const own = save.magnets;

    // ⚠ **Locked reads as locked, and it is drawn before every other state is considered.** Dimmed
    // face, faded icon, a padlock where the count would be — and no number, because a count on a
    // button that cannot fire is the button telling the player they have something they do not.
    // Shown rather than hidden: the results card is already counting down to MAGNET, so a button
    // that simply appears at level 6 would be the reward arriving with no build-up. This is the
    // build-up.
    this.boosterLock.setVisible(this.magnetLocked);
    // ⚠ **This fades the face, not the magnet** — `icon` is index 1; see the note where it is read.
    // ⚠ **And it does not fade at all on a phone.** 0.45 alpha over the violet is very nearly black,
    // which put a black square in a row of bright purple pills for the first five levels — the run
    // every new player and every reviewer sees, and it was reported from a real phone as simply
    // "button rất tối". Out on the wide layout's pad the booster stands alone and dimming is how the
    // locked state reads; in the row the padlock says it on its own, and the missing count says it
    // again.
    icon.setAlpha(this.magnetLocked && WIDE_HUD ? 0.45 : 1);
    if (this.magnetLocked) {
      face.setTexture(this.boosterBtn(false));
      this.boosterCost.setText("");
      this.boosterBadge.clear();
      return;
    }
    // ⚠ **Two different presses, so two different tests.** With one in hand the press *uses* it, and
    // that needs a plan on the board — greyed without one, because a booster that fires and does
    // nothing is worse than a button that says not yet. At zero the press *buys* one, and buying
    // has nothing to do with the state of the belt: a player who wants to stock up between jams is
    // doing something sensible, and greying the button then hides the price behind a control they
    // have been taught not to press.
    const usable = own > 0 ? !!this.board.revivePlan() : true;
    face.setTexture(this.boosterBtn(usable));

    // ⚠ **The badge is how many you have, and at zero there is no badge at all.** It said the price
    // before, which put a red 60 on a button the player already owned two free uses of — the number
    // most likely to be read as "this costs 60" at exactly the moment it did not.
    // ⚠ A **+** at zero, never a 0. "0" says the thing is empty and stops there; "+" says it can be
    // filled, which is exactly what pressing it now does. An absent badge said neither.
    this.boosterCost.setText(own > 0 ? String(own) : "+");
    this.boosterBadge.clear();
    const w = Math.max(32, this.boosterCost.width + 18);
    const h = 30;
    this.boosterCost.setPosition(BADGE_AT, BADGE_AT);
    this.boosterBadge
      .fillStyle(0xffffff, 1)
      .fillRoundedRect(BADGE_AT - w / 2 - 3, BADGE_AT - h / 2 - 3, w + 6, h + 6, (h + 6) / 2);
    this.boosterBadge
      .fillStyle(own > 0 ? 0x2e9b57 : 0xf0a020, 1)
      .fillRoundedRect(BADGE_AT - w / 2, BADGE_AT - h / 2, w, h, h / 2);
  }

  // ── Frame ──────────────────────────────────────────────────────────────────

  update() {
    // Once nothing is left to decide, run the belt out at speed rather than making the player
    // watch the last few marbles do a lap at puzzle pace.
    const wanted = this.board.gridEmpty() ? TICK_MS_DRAINED : TICK_MS;
    if (wanted !== this.tickMs) {
      // Re-base the phase so the change does not jump the marbles mid-glide.
      const frac = Phaser.Math.Clamp((this.time.now - this.lastTickAt) / this.tickMs, 0, 1);
      this.lastTickAt = this.time.now - frac * wanted;
      this.tickMs = wanted;
    }
    if (!this.paused && this.board.status === "play") {
      let guard = 0;
      while (this.time.now - this.lastTickAt >= this.tickMs && guard++ < 4) this.onTick();
    }

    // ⚠ The highest marble in the chute is **exempt from the brake**, and that is not a tweak to
    // the drag — it is the difference between a queue and a straggler.
    //
    // The brake exists so a *pile* creeps into the neck at a watchable pace, and it works because
    // the marbles above supply the push. The topmost one has nothing above it, so once it crosses
    // `brake` with the speed it had spent waiting on the pile — i.e. none — `CONE_DRAG` is enough
    // to stop it starting. Measured on a real pour: the last marble of a tray took **939 ms to
    // cover the 28 px** from `brake` to the pick-up zone, where a marble arriving with the pile's
    // momentum crosses the same stretch in 154 ms. That is the dawdle at the tail of every pour.
    //
    // Exempting the top one leaves the pile behaviour untouched (everything with a marble above it
    // still brakes) and lets the straggler close the gap, which is what a real hopper does.
    // ⚠ Not `falling.length === 1`. The straggler is a straggler whether or not the ones ahead of
    // it have already been taken, and by the time it is genuinely alone it has already dawdled.
    let topY = Infinity;
    for (const f of this.falling) topY = Math.min(topY, f.body.position.y);
    for (const f of this.falling) {
      // Fall out of the tray at full speed, then hit the brakes on the way into the cone.
      // The drop is meant to feel like a tray being emptied; the last stretch into the neck
      // is meant to be watched, and one global gravity cannot do both.
      const tail = f.body.position.y <= topY + 2;
      const slow = f.body.position.y > L.funnel.brake && !tail;
      f.body.frictionAir = slow ? CONE_DRAG : 0.004;
      f.body.friction = slow ? CONE_FRICTION : 0.05;
      f.sprite.setPosition(f.body.position.x, f.body.position.y);
      f.sprite.setRotation(f.body.angle);
    }

    const frac = Phaser.Math.Clamp((this.time.now - this.lastTickAt) / this.tickMs, 0, 1);

    // Same pitch and same offset as the marbles, so a marble always sits dead centre in a
    // hole. beltTravel is always a whole number of slots, which keeps them locked even
    // mid-interpolation.
    const tread = this.beltTravel + frac * BELT_SPACING;
    for (let i = 0; i < BELT_CLEATS; i++) {
      const p = beltPointAt(BELT_ENTRY_D + i * BELT_SPACING + tread);
      this.cleatSprites[i].setPosition(p.x, p.y);
    }
    for (let i = 0; i < BELT_SLOTS; i++) {
      const c = this.board.belt[i];
      const s = this.beltSprites[i];
      if (c === null) {
        s.setVisible(false);
        continue;
      }
      // A marble that has just been placed on the entry has no previous slot to travel from.
      // Rather than have it blink into existence on the rail, slide it down out of the chute over
      // the tick — that is the last stretch of the drop the player has been watching.
      if (this.board.fresh[i]) {
        const to = slotPos(i, 0);
        // ⚠ **From where the body actually was**, not from a fixed point under the neck. Measured
        // over a real pour: `drainFunnel` takes the lowest marble within 46px of the neck, which
        // is often one still resting on the *cone slope* — recorded at (299, 571) while the fixed
        // feed point is (270, 590). So the ball the eye was following blinked out and another
        // appeared 29px to the left and 19px lower, on the same frame. That sideways hop is what
        // reads as the drop not being one movement.
        const from = this.feedNow ?? { x: FEED_FROM.x, y: FEED_FROM.y, rot: 0 };
        // Hang back, then drop. The marble it is replacing is still clearing the entry, and
        // touching down early has the two overlapping right where the player is looking. The wait
        // is shorter than it was (0.15, not 0.4) because starting up in the chute already puts
        // clear air between them — the delay was standing in for the distance.
        const drop = Phaser.Math.Easing.Quadratic.In(Math.max(0, (frac - 0.15) / 0.85));
        s.setVisible(true)
          .setTexture(K.marble(c))
          .setPosition(Phaser.Math.Linear(from.x, to.x, drop), Phaser.Math.Linear(from.y, to.y, drop));
        // ⚠ And carry the spin off. Every marble on the rail is drawn upright, so its highlight
        // points the same way as its neighbours'; a tumbling ball that snaps upright the instant
        // it is handed over is the same discontinuity as the hop, in the one part of the texture
        // the eye tracks. Wrapped, or a ball at 3.1 rad unwinds the long way round.
        s.setRotation(from.rot + Phaser.Math.Angle.Wrap(-from.rot) * drop);
        continue;
      }
      const p = slotPos(i - 1, frac);
      // Settled marbles are upright — and this also scrubs the residue of the slide above, since
      // the sprites are reused per slot and `drop` never quite reaches 1 on the last frame.
      s.setVisible(true).setTexture(K.marble(c)).setPosition(p.x, p.y).setRotation(0);
    }
  }

  // ── Revive ─────────────────────────────────────────────────────────────────

  /** Centre y of the box sitting `idx` deep in a column — where a revive takes one *from*. */
  private boxRowY(idx: number) {
    return L.box.top + idx * (L.box.h + L.box.vgap) + L.box.h / 2;
  }

  /**
   * The rail filled and jammed. Say so, show what a revive would take off, and let the player buy
   * it or refuse.
   *
   * ⚠ The pop-up animates **the real plan** — the two boxes it names are the two `revivePlan`
   * picked and the six marbles are their colours. A generic "some marbles get cleared" cartoon
   * would be selling something the player cannot check against the board they are looking at, and
   * the board is right there behind the dim.
   */
  private offerRevive(plan: RevivePick[]) {
    this.paused = true;
    sfx.deny();

    const c = this.add.container(0, 0);
    const midY = GAME_H / 2 - 40;
    c.add(this.stageDim(0x0d0a2a, 0.78));

    const panel = this.add.graphics();
    panel.fillStyle(0x1d1a45, 0.55).fillRoundedRect(58, midY - 196, 424, 496, 36);
    panel.fillStyle(UI.machineEdge, 1).fillRoundedRect(60, midY - 202, 420, 488, 34);
    panel.fillStyle(UI.machine, 1).fillRoundedRect(66, midY - 208, 408, 480, 32);
    panel.fillStyle(0xd8556a, 1).fillRoundedRect(66, midY - 208, 408, 84, 32);
    panel.fillStyle(0xd8556a, 1).fillRect(66, midY - 154, 408, 30);
    c.add(panel);

    c.add(
      this.add
        .text(CX, midY - 166, "BELT FULL!", { fontFamily: FONT, fontSize: "40px", color: "#ffffff" })
        .setOrigin(0.5)
        .setStroke(UI.ink, 8),
    );
    c.add(
      this.add
        .text(CX, midY - 96, "The rail is packed and nothing fits.\nRevive clears 6 marbles and 2 boxes.", {
          fontFamily: FONT,
          fontSize: "22px",
          color: "#3b465f",
          align: "center",
          lineSpacing: 6,
        })
        .setOrigin(0.5),
    );

    const demo = this.buildReviveDemo(c, plan, midY);

    let done = false;
    // ⚠ Every looping tween on this card has to be named and stopped. The results overlay gets
    // away with leaving its rays spinning because it only ever dies on a scene restart, and
    // `resetLevel` kills every tween in the scene; this card is torn down mid-level, and an
    // endlessly repeating tween on a destroyed sprite is a leak per revive bought.
    let pulse: Phaser.Tweens.Tween | null = null;
    const close = () => {
      if (done) return;
      done = true;
      this.reviveClose = null;
      pulse?.remove();
      demo.stop();
      c.destroy();
    };
    this.reviveClose = close;

    const afford = save.coins >= COST.revive;
    const btn = this.add.container(CX, midY + 146);
    const face = img(this, K.btn("wide"), 0, 0);
    if (!afford) face.setTint(0x9aa3b8);
    const label = this.add
      .text(-30, -3, "REVIVE", { fontFamily: FONT, fontSize: "27px", color: "#ffffff" })
      .setOrigin(0.5)
      .setStroke(UI.ink, 6);
    const coin = img(this, K.coin, 48, 0).setScale(0.9 / TS);
    const price = this.add
      .text(68, -2, String(COST.revive), {
        fontFamily: FONT,
        fontSize: "24px",
        color: afford ? "#ffd964" : "#ffb4b4",
      })
      .setOrigin(0, 0.5)
      .setStroke(UI.ink, 5);
    const zone = this.add.rectangle(0, 0, 260, 76, 0xffffff, 0).setInteractive({ useHandCursor: true });
    zone.on("pointerdown", () => this.acceptRevive());
    btn.add([face, label, coin, price, zone]);
    c.add(btn);
    // The one thing on the card that keeps moving, so the offer reads as live rather than as an
    // error dialog with a button on it.
    pulse = this.tweens.add({
      targets: btn,
      scale: 1.05,
      duration: 620,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });

    c.add(
      this.button(CX, midY + 232, "NO THANKS", "wideBlue", () => {
        close();
        this.finish(false);
      }),
    );

    this.uiLayer.add(c);
  }

  /**
   * The looping picture inside the pop-up: a packed strip of rail, and the six marbles peeling off
   * it into the two boxes that are about to go. Rebuilt from the plan, so its colours are the
   * board's own.
   */
  private buildReviveDemo(into: Phaser.GameObjects.Container, plan: RevivePick[], midY: number) {
    const railY = midY - 34;
    const boxY = midY + 60;

    const rail = this.add.graphics();
    rail.fillStyle(UI.beltDeep, 1).fillRoundedRect(115, railY - 26, 310, 52, 26);
    rail.fillStyle(UI.belt, 1).fillRoundedRect(119, railY - 22, 302, 44, 22);
    into.add(rail);

    // Red wash over the rail, breathing — this is the "it is full" half of the message and it has
    // to still be saying it while the marbles are mid-flight.
    const warn = this.add.rectangle(CX, railY, 310, 52, 0xff4040, 0.22);
    into.add(warn);
    this.tweens.add({
      targets: warn,
      alpha: 0.05,
      duration: 700,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });

    const boxes = plan.map((p, k) => {
      const x = CX + (k - (plan.length - 1) / 2) * 118;
      return img(this, K.boxOpen(p.color), x, boxY);
    });
    into.add(boxes);

    // ⚠ A **packed** strip, not just the six that leave. Drawing only the six had them all fly off
    // and leave the rail bare, which says the opposite of what the card is for: the six coming off
    // a full belt is the whole offer, and a rail that empties itself makes the problem look solved
    // by itself. The other marbles are the real belt's own colours and they stay put — what the
    // player is left with is a rail with six gaps in it, which is exactly what they get.
    const filler = this.board.belt.filter((c): c is Color => c !== null);
    // Which of the twelve go: three on the left for the first box, three on the right for the
    // second, spaced so the ones that stay read as the rail rather than as a gap.
    const leaving = new Map<number, number>();
    plan.forEach((_, k) => [0, 2, 4].forEach((s) => leaving.set(s + k * 7, k)));
    const marbles: Phaser.GameObjects.Image[] = [];
    const owner: number[] = [];
    for (let k = 0; k < 12; k++) {
      const x = CX + (k - 5.5) * 25;
      const box = leaving.get(k);
      const color = box === undefined ? filler[(k * 5) % Math.max(1, filler.length)] ?? 0 : plan[box].color;
      const m = img(this, K.marble(color), x, railY).setData("restX", x);
      marbles.push(m);
      owner.push(box ?? -1);
    }
    into.add(marbles);

    // ⚠ Every cycle **fills back in** rather than snapping back to its start state. Leaving the
    // marbles and the boxes gone until the next loop spent a third of it looking at an empty
    // card, which reads as something having broken rather than as a loop.
    const cycle = () => {
      marbles.forEach((m, i) => {
        const rest = m.getData("restX") as number;
        m.setPosition(rest, railY).setScale(1 / TS).setAlpha(1);
        if (owner[i] < 0) return;
        const b = boxes[owner[i]];
        this.tweens.add({
          targets: m,
          x: b.x,
          y: boxY,
          scale: 0.55 / TS,
          alpha: 0,
          delay: 420 + i * 55,
          duration: 300,
          ease: "Quad.easeIn",
        });
      });
      boxes.forEach((b, k) => {
        b.setPosition(b.x, boxY).setScale(1 / TS).setAlpha(0);
        this.tweens.add({ targets: b, alpha: 1, delay: k * 60, duration: 200 });
        this.tweens.add({
          targets: b,
          y: boxY - 26,
          alpha: 0,
          scale: 1.15 / TS,
          // After the last marble has landed in it, not while one is still on its way.
          delay: 1400 + k * 90,
          duration: 300,
          ease: "Quad.easeIn",
        });
      });
    };

    cycle();
    const loop = this.time.addEvent({ delay: 1900, loop: true, callback: cycle });
    return {
      stop: () => {
        loop.remove();
        // Tweens outlive their targets otherwise, and the container is about to be destroyed.
        this.tweens.killTweensOf([...marbles, ...boxes, warn]);
      },
    };
  }

  private acceptRevive() {
    const close = this.reviveClose;
    if (!close) return;
    if (save.coins < COST.revive) {
      sfx.deny();
      this.toast("Not enough coins");
      return;
    }
    // Re-planned rather than trusting the one the pop-up was drawn from. Nothing has touched the
    // board while it was up, so the two agree — but the plan is the rule and the picture is not.
    const picks = this.board.useRevive();
    if (!picks) {
      sfx.deny();
      close();
      this.finish(false);
      return;
    }

    save.coins = save.coins - COST.revive;
    // Logged like any other booster, so `PURE=1` keeps a bought level out of the model ranking.
    this.boostersUsed.push("revive");
    close();
    sfx.booster();
    this.playRevive(picks);
  }

  /**
   * The magnet firing: the button kicks, and a ring goes out from it down the machine.
   *
   * ⚠ It exists because the delivery animation alone does not say *magnet*. Six marbles gliding
   * into their boxes is the picture a revive draws, and it is the right picture for what happens to
   * the board — but the player pressed a button with a horseshoe on it, and nothing on screen came
   * from that button. The ring is the only part of this that ties the effect to its cause.
   */
  /**
   * "Buy a magnet for 60?" — shown only when the player has none left and pressed anyway.
   *
   * ⚠ It buys and **stops there**. Firing the booster on the way out was the first shape of this,
   * and it forced the purchase to happen only when the board already had a plan — which turned
   * "buy one for later" into an offer the game refuses most of the time. Buying is stock; the badge
   * then reads 1 and the next press is the one that spends it.
   */
  private askBuyMagnet() {
    // ⚠ Looked for in `uiLayer`, which is where it is added — `this.children` is the scene root and
    // never sees it, so the guard silently never fired and a second press stacked a second card on
    // a paused board.
    if (this.uiLayer.list.some((o) => o.name === "buyCard")) return;
    this.paused = true;
    sfx.pick();
    const c = this.add.container(0, 0).setName("buyCard").setDepth(120);
    const midY = GAME_H / 2;
    const dim = this.stageDim(0x0d0a2a, 0.78);
    dim.setInteractive();
    c.add(dim);

    const W = 408;
    // ⚠ Tall enough for the two buttons **stacked**. Side by side they cannot fit: `button` bakes a
    // fixed 260x76 face, so a pair needs 520px of a card 408px wide — they overlapped each other and
    // hung out past the bottom edge. Stacking also matches the results card, which is the only other
    // place in the game offering a choice.
    // ⚠ Tall enough for the two stacked buttons **and** the refusal line between them and the
    // price. At 452 the message sat under the BUY face and only its top half was readable — the
    // half that says "Not enough", with the number it is about hidden.
    const H = 480;
    const X = (GAME_W - W) / 2;
    const Y = midY - H / 2;
    const panel = this.add.graphics();
    panel.fillStyle(0x1d1a45, 0.55).fillRoundedRect(X - 6, Y + 6, W + 12, H, 34);
    panel.fillStyle(UI.machineEdge, 1).fillRoundedRect(X - 4, Y - 4, W + 8, H, 32);
    panel.fillStyle(UI.machine, 1).fillRoundedRect(X, Y, W, H, 30);
    panel.fillStyle(0x4bc84b, 1).fillRoundedRect(X, Y, W, 78, 30);
    panel.fillStyle(0x4bc84b, 1).fillRect(X, Y + 48, W, 30);
    c.add(panel);

    c.add(
      this.add
        .text(GAME_W / 2, Y + 38, "BUY A MAGNET?", { fontFamily: FONT, fontSize: "34px", color: "#ffffff" })
        .setOrigin(0.5)
        .setStroke(UI.ink, 7),
    );
    c.add(img(this, K.icon("magnet"), GAME_W / 2, Y + 128).setScale(1.7 / TS));
    c.add(
      this.add
        .text(GAME_W / 2, Y + 190, "Lifts 6 balls off the belt\ninto 2 boxes.", {
          fontFamily: FONT,
          fontSize: "21px",
          color: "#3b465f",
          align: "center",
          lineSpacing: 4,
        })
        .setOrigin(0.5),
    );

    const enough = save.coins >= COST.magnet;
    const coin = img(this, K.coin, GAME_W / 2 - 34, Y + 246).setScale(1 / TS);
    // ⚠ `shake` restores to `homeX`, and without this it falls back to wherever the sprite happens
    // to be — so a second press while the first nudge is running captures an already-offset x as
    // home and the coin ratchets left, 6px a press. Exactly the trap the tray shake documents.
    coin.setData("homeX", coin.x);
    c.add(coin);
    c.add(
      this.add
        .text(GAME_W / 2 + 2, Y + 246, String(COST.magnet), {
          fontFamily: FONT,
          fontSize: "30px",
          // ⚠ Red when they cannot afford it. The card still opens — being told the price is the
          // point — but it must not look like an offer that will go through.
          color: enough ? "#8a5a06" : "#d2452f",
        })
        .setOrigin(0, 0.5),
    );

    // ⚠ The refusal has to be **on the card**. `toast` draws into `fxLayer`, and `uiLayer` is
    // created after it and therefore on top — so a toast raised while this card is up renders
    // behind its own dimmer and is never seen. Pressing BUY without the coins looked like a dead
    // button, which is the worst thing a purchase can look like.
    const why = this.add
      .text(GAME_W / 2, Y + 278, "", { fontFamily: FONT, fontSize: "19px", color: "#d2452f" })
      .setOrigin(0.5);
    c.add(why);

    const close = () => {
      c.destroy();
      this.paused = false;
      this.lastTickAt = this.time.now;
      this.refreshHud();
    };
    c.add(
      // ⚠ Always the green face: there is no `wideOff` texture and inventing one for this card
      // would be a fourth button style. The price in red above is what says they cannot afford it,
      // and pressing BUY without the coins says so out loud rather than doing nothing.
      this.button(GAME_W / 2, Y + 336, "BUY", "wide", () => {
        if (save.coins < COST.magnet) {
          sfx.deny();
          why.setText(`Not enough coins — you have ${save.coins}`);
          // A nudge on the price as well as the words, so the eye is sent to the number the
          // sentence is about. Through `shake`, which owns the rest position — see `homeX` above.
          this.shake(coin);
          return;
        }
        save.coins = save.coins - COST.magnet;
        save.magnets = save.magnets + 1;
        sfx.booster();
        close();
      }),
    );
    c.add(this.button(GAME_W / 2, Y + 418, "NO", "wideBlue", close));
    this.uiLayer.add(c);
  }

  private magnetPull() {
    const btn = this.boosterBtns.magnet;
    if (!btn) return;
    this.tweens.add({
      targets: btn,
      scale: { from: 1, to: 1.22 },
      duration: 140,
      yoyo: true,
      ease: "Back.easeOut",
    });
    const ring = img(this, K.ring, btn.x, btn.y).setScale(0.2 / TS).setAlpha(0.9);
    this.fxLayer.add(ring);
    this.tweens.add({
      targets: ring,
      scale: 2.6 / TS,
      alpha: 0,
      duration: 420,
      ease: "Cubic.easeOut",
      onComplete: () => ring.destroy(),
    });
  }

  /**
   * Play a taken plan out on screen: the six marbles fly to the two boxes they were owed to, the
   * boxes burst, and the clock is held until they have visibly gone.
   *
   * ⚠ **One body, two doors.** The jam pop-up and the Magnet button do exactly the same thing to
   * the board, and a second copy of this would drift — the fly-out timing, the undo wipe and the
   * clock hold are all part of the rule being legible, not decoration on top of it.
   *
   * ⚠ The board is **already changed** when this runs: `useRevive` has been called and the belt
   * sprites read straight off it. So these ghosts are covering a swap that has happened, not a
   * decision still being made — which is why the clock resumes on a timer rather than on input.
   */
  private playRevive(picks: RevivePick[], pulled = false) {
    // ⚠ Rewinding across a revive would restore the jammed board *with its boxes back on it* and
    // the player would be sold the same revive twice. A revive is not a move; it is where the
    // history starts again.
    this.undoStack = [];
    this.paused = true;
    if (pulled) return this.magnetLift(picks);

    let last = 0;
    picks.forEach((p, k) => {
      const to = { x: boxColX(p.col), y: this.boxRowY(p.idx) };
      p.slots.forEach((slot, i) => {
        const from = slotPos(slot, 0);
        const delay = k * 120 + i * 90;
        last = Math.max(last, delay + 320);
        const ghost = img(this, K.marble(p.color), from.x, from.y);
        this.fxLayer.add(ghost);
        this.tweens.add({
          targets: ghost,
          x: to.x,
          y: to.y,
          scale: 0.5 / TS,
          alpha: 0,
          delay,
          duration: 320,
          ease: "Quad.easeIn",
          onComplete: () => ghost.destroy(),
        });
      });
      this.time.delayedCall(last, () => this.reviveBurst(p.col, p.idx, p.color));
    });

    // Hold the clock until the marbles have visibly gone. The board is already changed underneath
    // — the belt sprites read straight off it — so this is the ghosts covering the swap, not a
    // decision waiting to be made.
    this.time.delayedCall(last + 260, () => {
      this.refreshBoxes();
      this.paused = false;
      this.lastTickAt = this.time.now;
    });
    this.refreshHud();
  }

  /**
   * The magnet's own animation: **pick the six marbles up, hold them where they can be counted,
   * then set them into the two boxes.** Three beats, deliberately slow.
   *
   * ⚠ It is a rewrite of the straight glide, not a decoration on it, and the reason is that the
   * glide could not be read. Six marbles sliding from rail to boxes on staggered curves is a
   * scatter — by the time the eye has found one, the others have arrived. What makes an effect
   * legible is a moment where nothing moves: the marbles rise, they *stop* in a row above the
   * machine, and only then do they go in. The hold is the part that does the explaining.
   *
   * ⚠ They rise **straight up**, not toward the button. A marble that veers sideways on the way up
   * is being thrown; one that lifts off the rail is being picked up, which is what the magnet is
   * doing to it.
   *
   * ⚠ They are laid out in **plan order**, so the three destined for the first box are together and
   * the next three follow. Sorted by belt position instead, the row would have to unshuffle itself
   * on the way down and the two groups would cross.
   */
  private magnetLift(picks: RevivePick[]) {
    const ghosts: { g: Phaser.GameObjects.Image; pick: RevivePick }[] = [];
    picks.forEach((p) =>
      p.slots.forEach((slot) => {
        const from = slotPos(slot, 0);
        const g = img(this, K.marble(p.color), from.x, from.y);
        this.fxLayer.add(g);
        ghosts.push({ g, pick: p });
      }),
    );
    if (!ghosts.length) {
      this.paused = false;
      this.lastTickAt = this.time.now;
      return;
    }

    // The empty triangle of the chute, above the belt and below the funnel mouth — the one strip
    // of the machine with nothing on it, and directly under the button that was pressed.
    const HOVER_Y = L.belt.cy - 96;
    const PITCH = 34;
    const LIFT = 460;
    const STAGGER = 80;
    const HOLD = 320;
    const PLACE = 420;

    ghosts.forEach((o, n) => {
      const x = CX + (n - (ghosts.length - 1) / 2) * PITCH;
      this.tweens.add({
        targets: o.g,
        x,
        y: HOVER_Y,
        scale: 1.35 / TS,
        delay: n * STAGGER,
        duration: LIFT,
        // Eases *out*: fast off the rail, slowing as it arrives, which is what being lifted looks
        // like. Ease-in would read as the marble falling upwards.
        ease: "Sine.easeOut",
      });
    });
    const lifted = (ghosts.length - 1) * STAGGER + LIFT;

    // A breath with the row hanging there. ⚠ Do not trim this to save time — it is the beat that
    // lets the player see six marbles and two boxes, and without it the whole thing is a blur.
    let end = lifted + HOLD;
    picks.forEach((p, k) => {
      const mine = ghosts.filter((o) => o.pick === p);
      const to = { x: boxColX(p.col), y: this.boxRowY(p.idx) };
      const at = lifted + HOLD + k * 220;
      mine.forEach((o, i) => {
        this.tweens.add({
          targets: o.g,
          x: to.x + (i - (mine.length - 1) / 2) * 18,
          y: to.y,
          scale: 0.55 / TS,
          delay: at + i * 90,
          duration: PLACE,
          // Ease-in: it accelerates into the hole rather than drifting to a stop above it.
          ease: "Quad.easeIn",
          onComplete: () => o.g.destroy(),
        });
      });
      const landed = at + (mine.length - 1) * 90 + PLACE;
      end = Math.max(end, landed);
      this.time.delayedCall(landed, () => this.reviveBurst(p.col, p.idx, p.color));
    });

    this.time.delayedCall(end + 300, () => {
      this.refreshBoxes();
      this.paused = false;
      this.lastTickAt = this.time.now;
    });
    this.refreshHud();
  }

  /** A box taken off from partway down a column, and the stack under it closing the gap. */
  private reviveBurst(col: number, idx: number, color: Color) {
    const x = boxColX(col);
    const y = this.boxRowY(idx);
    sfx.boxClear();

    const flash = img(this, K.flash, x, y).setScale(0.7 / TS).setAlpha(0.8);
    this.fxLayer.add(flash);
    this.tweens.add({
      targets: flash,
      scale: 1.9 / TS,
      alpha: 0,
      duration: 320,
      onComplete: () => flash.destroy(),
    });

    const wave = img(this, K.ring, x, y).setScale(0.35 / TS).setAlpha(0.65);
    wave.setTintFill(PALETTE[color].dark);
    this.fxLayer.add(wave);
    this.tweens.add({
      targets: wave,
      scale: 2.2 / TS,
      alpha: 0,
      duration: 380,
      ease: "Cubic.easeOut",
      onComplete: () => wave.destroy(),
    });

    const ghost = img(this, K.box(color), x, y);
    this.fxLayer.add(ghost);
    this.tweens.add({
      targets: ghost,
      y: y - 40,
      alpha: 0,
      scale: 1.12 / TS,
      angle: Math.random() * 12 - 6,
      duration: 280,
      ease: "Quad.easeIn",
      onComplete: () => ghost.destroy(),
    });

    this.refreshBoxes();
    // Only the part of the column *below* the gap moved, but the whole stack is one container, so
    // sliding it is the same picture for one box as it is for the top one.
    this.slideColumn(col);
  }

  // ── End of level ───────────────────────────────────────────────────────────

  private finish(won: boolean) {
    this.paused = true;
    // A flourish on the host page. Only on a win — it marks something going well, and firing it
    // on a loss would be the opposite of what it is for.
    if (won) platform.happytime();
    this.time.removeAllEvents();
    // Record the game before anything else touches the board. Bot numbers are guesses about
    // people; these are the only real data the tuning will ever have.
    //
    // ⚠ Never a hand-built board. The play log exists to calibrate the *generator's* curve, and
    // "level 0" from the editor is a board no ladder ever produced — it would be fitted against
    // a target it was never asked to hit.
    if (!this.custom) {
      const run = {
        lvl: this.level,
        sig: levelFingerprint(this.board.def),
        result: (won ? "win" : "lose") as "win" | "lose",
        ms: Math.round(this.time.now - this.levelStart),
        taps: this.board.taps,
        peak: this.board.maxBelt,
        belt: BELT_SLOTS,
        stars: won ? starsFor(this.level, this.tries) : 0,
        used: [...this.boostersUsed],
        // ⚠ The moves, so a losing row can be watched rather than guessed at. Sent as one string
        // because RTDB charges by the byte and an array of 200 objects is mostly punctuation.
        rep: this.replay.toString(),
      };
      saveRun(run); // the copy on this device, which Settings can export by hand…
      sendRun(run); // …and the copy that actually reaches us from a stranger
      // ⚠ Level and result only. Everything richer — the fingerprint, boosters, peak belt — is
      // already in the row above, where it can be sliced without GA's 24-48h lag and without
      // declaring a custom dimension per field. GA is here for "how many, from where".
      track("level_end", { level: this.level, result: run.result, seconds: Math.round(run.ms / 1000) });
    }
    if (this.custom) {
      // The editor's scratch board has no level number and no history, so a first-try win is the
      // only thing it can honestly say.
      const stars = won ? 3 : 0;
      if (won) sfx.win();
      else sfx.deny();
      this.overlay(won ? "LEVEL CLEAR!" : "JAMMED!", stars, 0);
      return;
    }
    if (won) {
      const stars = starsFor(this.level, this.tries);
      // Only ever raises, so replaying a level to look at it cannot take a star back off it.
      save.setStars(this.level, stars);
      save.unlocked = this.level + 1;
      save.coins = save.coins + WIN_COINS;
      sfx.win();
      // ⚠ Asked for `this.level`, the level just cleared — the bar is the reward for *this* game.
      this.overlay("LEVEL CLEAR!", stars, WIN_COINS, featureProgress(this.level));
    } else {
      sfx.deny();
      this.overlay("JAMMED!", 0, 0);
    }
  }

  private overlay(title: string, stars: number, coins: number, feat: FeatureProgress | null = null) {
    const c = this.add.container(0, 0);
    const midY = GAME_H / 2 - 40;
    // Everything below the stars slides down to make room for the bar. One number rather than two
    // sets of coordinates, so the card without a bar stays exactly the card it has always been.
    const dy = feat ? 66 : 0;
    c.add(this.stageDim(0x0d0a2a, 0.78));

    if (stars) {
      // Slow sunburst behind everything. It is the one element that keeps moving, which is
      // what stops a static results card feeling like an error dialog.
      // Additive, or the wedges sit on the dimmed machine as grey stripes instead of light.
      const rays = img(this, K.rays, CX, midY - 40).setScale(1.9 / TS).setAlpha(0.6);
      rays.setTintFill(0xffd75e).setBlendMode(Phaser.BlendModes.ADD);
      c.add(rays);
      this.tweens.add({ targets: rays, angle: 360, duration: 26000, repeat: -1 });
      this.tweens.add({
        targets: rays,
        alpha: 0.32,
        duration: 1600,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      });
    }

    const panel = this.add.graphics();
    panel.fillStyle(0x1d1a45, 0.55).fillRoundedRect(58, midY - 172, 424, 408 + dy, 36);
    panel.fillStyle(UI.machineEdge, 1).fillRoundedRect(60, midY - 178, 420, 400 + dy, 34);
    panel.fillStyle(UI.machine, 1).fillRoundedRect(66, midY - 184, 408, 392 + dy, 32);
    panel.fillStyle(stars ? 0x4bc84b : 0xd8556a, 1).fillRoundedRect(66, midY - 184, 408, 84, 32);
    panel.fillStyle(stars ? 0x4bc84b : 0xd8556a, 1).fillRect(66, midY - 130, 408, 30);
    c.add(panel);

    c.add(
      this.add
        .text(CX, midY - 142, title, { fontFamily: FONT, fontSize: "40px", color: "#ffffff" })
        .setOrigin(0.5)
        .setStroke(UI.ink, 8),
    );

    if (stars) {
      for (let i = 0; i < 3; i++) {
        const big = i === 1;
        const target = (big ? 1.35 : 1.05) / TS;
        const sx = CX + (i - 1) * 84;
        const sy = midY - 40 - (big ? 14 : 0);
        const s = img(this, K.star(i < stars), sx, sy).setScale(0.1);
        c.add(s);
        this.tweens.add({
          targets: s,
          scale: target,
          duration: 300,
          delay: 200 + 180 * i,
          ease: "Back.easeOut",
          onComplete: () => {
            if (i >= stars) return;
            sfx.starPop(i);
            // Punch of light on landing, plus a scatter of twinkles.
            const fl = img(this, K.flash, sx, sy).setScale(0.25 / TS).setAlpha(0.75);
            fl.setTintFill(0xffe07a).setBlendMode(Phaser.BlendModes.ADD);
            c.add(fl);
            this.tweens.add({
              targets: fl,
              scale: 1.0 / TS,
              alpha: 0,
              duration: 420,
              onComplete: () => fl.destroy(),
            });
            for (let k = 0; k < 6; k++) {
              const a = Math.random() * Math.PI * 2;
              const d = 30 + Math.random() * 40;
              const sp = img(this, K.spark, sx, sy).setScale(0.08 / TS);
              sp.setTintFill(0xffe07a);
              c.add(sp);
              this.tweens.add({
                targets: sp,
                x: sx + Math.cos(a) * d,
                y: sy + Math.sin(a) * d,
                scale: { from: 0.45 / TS, to: 0.02 / TS },
                alpha: { from: 1, to: 0 },
                duration: 500,
                onComplete: () => sp.destroy(),
              });
            }
          },
        });
      }

      if (feat) this.featureBar(c, midY + 24, feat);

      const coin = img(this, K.coin, 232, midY + 62 + dy).setScale(1.1 / TS);
      const txt = this.add
        .text(258, midY + 60 + dy, `+${coins}`, {
          fontFamily: FONT,
          fontSize: "30px",
          color: "#ffd964",
        })
        .setOrigin(0, 0.5)
        .setStroke(UI.ink, 6);
      c.add([coin, txt]);
      this.confetti(c);
    } else {
      c.add(
        this.add
          .text(CX, midY - 20, "The belt is full and\nnothing else fits a box.", {
            fontFamily: FONT,
            fontSize: "23px",
            color: "#3b465f",
            align: "center",
          })
          .setOrigin(0.5),
      );
      c.add(
        this.add
          .text(CX, midY + 40, "Undo a move, or start the level over.", {
            fontFamily: FONT,
            fontSize: "19px",
            color: "#7c88a6",
            align: "center",
          })
          .setOrigin(0.5),
      );
    }

    // ⚠ A win with a reward waiting sends the player **home**, not on to the next board. The reward
    // lives on the home screen; handing them "NEXT LEVEL" here means the feature's whole job is to
    // be skipped past.
    //
    // ⚠ **Gated on the daily rule, not on `this.level === DAILY_FROM`.** The equality test only ever
    // fired for someone who cleared level 5 *after* this shipped — a player already at level 16 when
    // they got the update will never clear level 5 again, so the one route to a feature they have
    // never seen was a pulsing icon in the corner and nothing else. `dailyOfferable()` asks the
    // question that actually matters: is the gate passed and is there something to take.
    //
    // ⚠ Safe to ask here because `save.unlocked` is raised a few lines above, before the card is
    // drawn — so the level-5 win that crosses the line reads `6 > 5` and still routes, exactly as
    // the equality test used to. Asking before the bump would silently drop that case.
    //
    // ⚠ **Once a day, and `dailyOfferable` is what makes that true.** The comment here used to say
    // "it re-fires on the first win of each day" and the code did not: the gate was "is there
    // something to take", which stays true all day for anyone who does not take it, so *every* win
    // sent them home. 121 forced returns across 72 devices in one day of real play, one player 50
    // times. The stamp goes down when the offer is **drawn**, not when it is pressed — a player who
    // saw CLAIM REWARD and chose HOME has been asked.
    //
    // A loss never routes (`stars` is 0), so nobody is pulled off a board they are still fighting.
    const toDaily = !!stars && !this.custom && dailyOfferable();
    if (toDaily) markDailyOffered();
    const primary = toDaily ? "CLAIM REWARD" : stars ? "NEXT LEVEL" : "TRY AGAIN";
    c.add(
      this.button(CX, midY + 130 + dy, primary, "wide", () => {
        if (toDaily) {
          this.scene.start("Home", { daily: true });
          return;
        }
        if (stars) this.level++;
        this.scene.restart({ level: this.level });
      }),
    );
    c.add(this.button(CX, midY + 212 + dy, "HOME", "wideBlue", () => this.scene.start("Home")));

    this.uiLayer.add(c);
  }

  /**
   * "You are this far from something new."
   *
   * ⚠ It **animates from where the player was**, not from zero and not straight to the answer. A
   * bar that is simply drawn at 63% is a fact; a bar that visibly moves from 56% to 63% is the
   * reward for the level they just played, which is the only reason it is on this card at all.
   * When the last level crossed a milestone the previous value belongs to a different piece, so it
   * starts at empty instead of jumping backwards.
   */
  private featureBar(into: Phaser.GameObjects.Container, y: number, feat: FeatureProgress) {
    const X0 = 92;
    const W = 300;
    const H = 26;
    const before = featureProgress(this.level - 1);
    const from = before && before.id === feat.id ? before.pct : 0;

    const track = this.add.graphics();
    track.fillStyle(0x2f3550, 1).fillRoundedRect(X0, y - H / 2, W, H, H / 2);
    into.add(track);

    // Redrawn every frame of the tween rather than scaled: a scaled rounded rect squashes its own
    // end caps, so a bar at 10% comes out as a flat sliver with one round end.
    const fill = this.add.graphics();
    into.add(fill);
    const paint = (p: number) => {
      fill.clear();
      const w = Math.max(H, W * p);
      if (p <= 0.001) return;
      fill.fillStyle(0x5ecfe0, 1).fillRoundedRect(X0 + 3, y - H / 2 + 3, w - 6, H - 6, (H - 6) / 2);
    };
    paint(from);

    // The prize on the end of the bar. A frame rather than a bare sprite: these are board pieces,
    // and a tray floating on a results card reads as a stray sprite until something holds it.
    const BX = 424;
    const badge = this.add.graphics();
    badge.fillStyle(0xb4801a, 1).fillRoundedRect(BX - 34, y - 34, 68, 68, 16);
    badge.fillStyle(0xffc21e, 1).fillRoundedRect(BX - 30, y - 30, 60, 60, 13);
    // ⚠ A slate plate inside the gold, and it is not decoration. Two of the three pieces are pale
    // — the hatch housing is near-white — and sat straight on the gold they read as an empty
    // frame. The board they come from is a light cavity in a slate rim, so this is the same
    // ground they are legible against in play.
    badge.fillStyle(UI.panelDeep, 1).fillRoundedRect(BX - 25, y - 25, 50, 50, 10);
    into.add(badge);

    // ⚠ Each piece drawn the way the board draws it. A linked pair is **two trays and a clip**,
    // never one double-width face — using the old wide-tray texture here would teach the icon and
    // then contradict it on the board fifteen levels later.
    const icons: Phaser.GameObjects.Image[] =
      feat.id === "pair"
        ? [img(this, K.tray(2, true), BX - 12, y), img(this, K.link, BX, y), img(this, K.tray(5, true), BX + 12, y)]
        : [
            img(
              this,
              // ⚠ Explicit per id, not a two-way test. It was `hatch ? dispenser : lid`, so the
              // magnet — added later and matching neither branch — would have drawn a chocolate
              // lid: a milestone illustrated with the wrong piece entirely.
              feat.id === "hatch" ? K.dispenser : feat.id === "magnet" ? K.icon("magnet") : K.lid,
              BX,
              y,
            ),
          ];
    for (const ic of icons) {
      // Fitted from the texture's own size — the pieces are baked at wildly different scales (a
      // chocolate box is two cells across, the clip between a linked pair is a few pixels).
      const fit = feat.id === "pair" ? 24 : 44;
      ic.setScale(Math.min(fit / ic.width, fit / ic.height));
      into.add(ic);
    }

    const label = this.add
      .text(CX, y + 30, `${Math.round(from * 100)}% TO NEXT FEATURE`, {
        fontFamily: FONT,
        fontSize: "20px",
        color: "#b58a2b",
      })
      .setOrigin(0.5);
    into.add(label);

    const at = { p: from };
    this.tweens.add({
      targets: at,
      p: feat.pct,
      duration: 900,
      delay: 700,
      ease: "Cubic.easeOut",
      onUpdate: () => {
        paint(at.p);
        label.setText(`${Math.round(at.p * 100)}% TO NEXT FEATURE`);
      },
      onComplete: () => {
        if (feat.pct < 1) return;
        // Full. Say what it unlocked rather than leaving the player to read the icon.
        label.setText(`${feat.label} UNLOCKED!`);
        this.tweens.add({ targets: [badge, ...icons], scale: "*=1.12", duration: 260, yoyo: true, repeat: 2 });
      },
    });
  }

  /** Paper falling past the results card. Plain tweened sprites — no emitter to tear down. */
  private confetti(into: Phaser.GameObjects.Container) {
    for (let i = 0; i < 26; i++) {
      const x = 40 + Math.random() * (GAME_W - 80);
      const p = img(this, K.spark, x, -30 - Math.random() * 260).setScale(
        (0.35 + Math.random() * 0.4) / TS,
      );
      p.setTintFill(PALETTE[(Math.random() * PALETTE.length) | 0].light);
      into.add(p);
      this.tweens.add({
        targets: p,
        y: GAME_H + 40,
        x: x + (Math.random() - 0.5) * 120,
        angle: Math.random() * 720 - 360,
        duration: 2600 + Math.random() * 2200,
        delay: Math.random() * 900,
        repeat: -1,
        ease: "Sine.easeIn",
      });
    }
  }

  private button(x: number, y: number, label: string, face: string, onTap: () => void) {
    const c = this.add.container(x, y);
    const bg = img(this, K.btn(face), 0, 0);
    const t = this.add
      .text(0, -3, label, { fontFamily: FONT, fontSize: "27px", color: "#ffffff" })
      .setOrigin(0.5)
      .setStroke(UI.ink, 6);
    const zone = this.add.rectangle(0, 0, 260, 76, 0xffffff, 0).setInteractive({ useHandCursor: true });
    zone.on("pointerdown", () => {
      sfx.pick();
      onTap();
    });
    c.add([bg, t, zone]);
    return c;
  }

  private openSettings() {
    if (this.paused) return;
    this.paused = true;

    /**
     * ⚠ The play-log controls are **dropped from the `crazy` build**. They send finished games to
     * a dev server or the clipboard and wipe the local log — tools for tuning the difficulty
     * curve, with no meaning to a player and no place in front of a reviewer.
     *
     * ⚠ Gated on the **target**, not on `import.meta.env.DEV`. The playtesting that feeds the log
     * happens on a real `build:web` served over a tunnel to a phone, so a DEV gate would delete
     * the one route the data has off the device.
     */
    const devTools = __TARGET__ !== "crazy";
    const st = devTools ? summary() : null;

    // The panel is sized from what is actually in it, so dropping two rows does not leave a
    // stretch of empty machine below the last button.
    const rows = 5 + (devTools ? (st!.runs > 0 ? 2 : 1) : 0);
    const top = GAME_H / 2 - 210;
    const height = 140 + rows * 90 + (devTools ? 30 : 0);

    const c = this.add.container(0, 0);
    c.add(this.stageDim(0x101a33, 0.7));
    const panel = this.add.graphics();
    panel.fillStyle(UI.machine, 1).fillRoundedRect(66, top, 408, height, 30);
    c.add(panel);
    c.add(
      this.add
        .text(CX, top + 50, "PAUSED", { fontFamily: FONT, fontSize: "38px", color: "#ffffff" })
        .setOrigin(0.5)
        .setStroke(UI.ink, 8),
    );
    const close = () => {
      c.destroy();
      this.paused = false;
      this.lastTickAt = this.time.now;
    };

    let y = top + 140;
    const row = () => {
      const at = y;
      y += 90;
      return at;
    };
    c.add(
      this.button(CX, row(), save.muted ? "SOUND ON" : "SOUND OFF", "wideBlue", () => {
        save.muted = !save.muted;
        close();
        this.openSettings();
      }),
    );
    c.add(this.button(CX, row(), "RESTART LEVEL", "wide", () => this.scene.restart({ level: this.level })));
    c.add(this.button(CX, row(), "HOME", "wideBlue", () => this.scene.start("Home")));
    // ⚠ Shipped in **every** build, unlike the play-log rows above it. The host requires a game
    // that collects anything beyond their SDK's own events to show the notice in-game rather than
    // only answer the form field, and a privacy page that exists but cannot be reached from the
    // game is the failure that rule is written against. Opens a sibling page in a new tab, so the
    // level being played is never navigated away from.
    c.add(this.button(CX, row(), "PRIVACY", "wide", () => openPrivacyPolicy()));
    c.add(this.button(CX, row(), "RESUME", "wideBlue", close));

    if (!devTools) {
      this.uiLayer.add(c);
      return;
    }

    // Getting the play log off a phone. The deployed build is static, so there is nothing to
    // post to — the games have to be carried out by hand.
    //
    // ⚠ Try the dev server first, clipboard second. The clipboard is the route that does not work
    // where the playtesting actually happens: a phone on the LAN reaches the dev server over
    // plain http, which is not a secure context, so `navigator.clipboard` is missing and the
    // button could only ever report failure.
    c.add(
      this.button(CX, row(), `SEND ${st!.runs} GAMES`, "wideBlue", () => {
        void uploadRuns().then((up) => {
          if (up) {
            this.toast(up.added ? `${up.added} games sent to PC` : "already sent");
            return;
          }
          void copyToClipboard(exportJsonl()).then((ok) =>
            this.toast(ok ? `${st!.runs} games copied` : "Copy failed"),
          );
        });
      }),
    );
    c.add(
      this.add
        .text(CX, y - 45, `${st!.levels} levels · ${st!.wins} won`, {
          fontFamily: FONT,
          fontSize: "17px",
          color: "#ffffff",
        })
        .setOrigin(0.5)
        .setAlpha(0.7),
    );
    // Wiping it needs its own control, and it must not be `?reset=1`. That wipes every `bf_` key,
    // which includes `bf_levels` — the editor's saved drawings — so the obvious way to clear a
    // play log would also delete the hand-built levels. Two taps, because there is no undo.
    if (st!.runs > 0) {
      let armed = false;
      const wipe = this.button(CX, row(), "CLEAR LOG", "wide", () => {
        const label = wipe.getAt(1) as Phaser.GameObjects.Text;
        if (!armed) {
          armed = true;
          label.setText("SURE? TAP AGAIN");
          return;
        }
        clearRuns();
        label.setText("CLEARED");
        this.toast("Play log cleared");
      });
      c.add(wipe);
    }
    this.uiLayer.add(c);
  }

  // ── Small feedback ─────────────────────────────────────────────────────────

  /**
   * Put the level-1 walkthrough on screen, if this player still needs it.
   *
   * ⚠ Its layer goes on **after** `uiLayer`, so the hand and the caption sit over the HUD rather
   * than under it — a coach mark the machine can cover is a coach mark nobody reads.
   * ⚠ The tray it points at comes from `hint()`, the engine's own next-best tap, not from a
   * hardcoded cell index. Level 1 is generated, so the board changes whenever the ladder is
   * retuned, and a fixed index would sooner or later point at an empty cell.
   */
  private startTutorial() {
    this.tutorial?.destroy();
    this.tutorial = null;
    if (this.custom || this.preview || !Tutorial.wanted(this.level)) return;

    const at = this.nextTrayMark();
    if (!at) return;
    this.tutorial = new Tutorial(this, this.coachLayer());
    this.tutorial.start(at, () => this.nextTrayMark());
  }

  /**
   * Where the walkthrough should point, or null if pointing anywhere would be wrong.
   *
   * ⚠ The scene answers this, not the tutorial: grid metrics live here (`this.gm`), and so does
   * the knowledge that the board is paused or the level already over — a hand bouncing on a tray
   * under the dimmed results card is worse than no hand at all.
   */
  private nextTrayMark(): { x: number; y: number } | null {
    if (this.paused || this.board.status !== "play") return null;
    const idx = hint(this.board);
    if (idx < 0) return null;
    const gm = this.gm;
    return {
      x: gm.x + (idx % this.board.cols) * gm.pitch + gm.cell / 2,
      y: gm.y + ((idx / this.board.cols) | 0) * gm.pitch + gm.cell / 2,
    };
  }

  /**
   * The first unexplained piece on this board gets one card.
   *
   * ⚠ Never at the same time as the level-1 walkthrough. That runs four steps deep and owns the
   * same strip of chute, so two plates would sit on top of each other — and level 1 carries none
   * of these pieces anyway, so the guard costs nothing and only ever fires if the ladder is
   * rebuilt with a mechanic on the first board.
   */
  /**
   * Open the magnet lesson, if this is its level and it has not been taught.
   *
   * ⚠ **Before `startCoach`**, and `startCoach` stands down while it is open — both draw in the
   * same strip of chute, and stacked they are two captions on top of each other. The magnet lesson
   * wins the tie because it gates input: a coach card explaining a crate, shown while the player is
   * being told to pour a specific tray, is instructions the game is simultaneously refusing.
   *
   * ⚠ Marked seen when it **finishes**, not when it opens — the same rule `tutorialDone` and
   * `markCoach` already follow. A lesson abandoned halfway has taught nothing, and this is the only
   * board it can be taught on.
   */
  private startMagnetTutor() {
    this.magTutor?.destroy();
    this.magTutor = null;
    if (!SHOW_BOOSTERS) return;
    if (this.custom || this.preview) return;
    if (save.coachSeen.includes("magnet")) return;
    // ⚠ **`>=`, not `===`.** Pinning it to one level only works for a player who arrives at that
    // level; anyone already past it when this shipped would never be taught the booster at all —
    // and they are the players with the most levels left to use it on. So level 6 is where it is
    // taught to someone climbing the ladder, and for everyone else it is the **first board at or
    // after where they already are** that can carry the lesson.
    if (this.level < MAGNET_TUTOR_LEVEL) return;
    // ⚠ **Never on a multiple of five.** Those are the milestone boards — the ones rebuilt to sit in
    // the 10-20% band — and the lesson gates input for its first three beats. Teaching on a level
    // the player is expected to lose spends their attention on the wrong thing and spends a free
    // booster on a board that was meant to be hard. It waits for the next one; the lesson is not
    // owed to any particular level, only to the first suitable one.
    if (this.level % 5 === 0) return;
    const target = MagnetTutor.pick(this.board);
    // ⚠ No suitable tray, no lesson — try again on the next board. Its middle beat waits for a
    // magnet plan that the wrong tray can never produce, and a lesson that cannot end is a level
    // that cannot be played.
    if (target < 0) return;
    // ⚠ The lesson **hands over the boosters it is about to spend**. `FREE_MAGNETS` reaches most
    // players through the save default, but a player who somehow arrives here at zero would be
    // shown the buy card at the exact moment the lesson says "press it" — teaching a purchase
    // instead of a booster.
    if (save.magnets < FREE_MAGNETS) save.magnets = FREE_MAGNETS;
    this.refreshHud();
    this.magTutor = new MagnetTutor(this, this.coachLayer(), this.board, {
      cellAt: (cell) => ({
        x: this.gm.x + (cell % this.board.cols) * this.gm.pitch + this.gm.cell / 2,
        y: this.gm.y + ((cell / this.board.cols) | 0) * this.gm.pitch + this.gm.cell / 2,
        // ⚠ From `gm`, never `L.cell`. A 7x7 board is drawn at 57 and the two are 7px apart per
        // cell — the note at the top of this file about mixing them applies to markers too.
        size: this.gm.cell,
      }),
      buttonAt: () => ({ x: this.boosterBtns.magnet.x, y: this.boosterBtns.magnet.y }),
    });
    this.magTutor.start(target, PALETTE[this.board.tiles[target]!.color].name);
  }

  private startCoach() {
    // ⚠ Stands down while the magnet lesson is running — see `startMagnetTutor`.
    if (this.magTutor && !this.magTutor.finished) return;
    this.coach?.destroy();
    this.coach = null;
    if (this.custom || this.preview || this.tutorial) return;
    if (!Coach.wanted(this.board)) return;
    // ⚠ **Takes its turn after the SUPER HARD warning.** Both draw on the same plate in the same
    // strip of chute, and stacked they are two unreadable captions rather than one of each — seen
    // in a screenshot of level 15, where "Crates never move and never clear" landed squarely on
    // top of the warning. The warning goes first because it frames the level the player is about
    // to start; the card explains a piece and keeps just as well a couple of seconds later.
    if (this.hardWarnUntil > this.time.now) {
      this.time.delayedCall(this.hardWarnUntil - this.time.now, () => this.startCoach());
      return;
    }

    // `off` is in cells, so a piece covering 2x2 rings its middle rather than its top-left corner.
    const locate = (cell: number, off?: { x: number; y: number }) => {
      const gm = this.gm;
      return {
        x: gm.x + ((cell % this.board.cols) + (off?.x ?? 0)) * gm.pitch + gm.cell / 2,
        y: gm.y + (((cell / this.board.cols) | 0) + (off?.y ?? 0)) * gm.pitch + gm.cell / 2,
      };
    };
    this.coach = new Coach(this, this.coachLayer(), this.board, locate);
    this.coach.start();
  }

  /**
   * A layer of its own, added last.
   *
   * ⚠ After `uiLayer`, so the ring and the caption sit over the HUD rather than under it.
   */
  private coachLayer(): Phaser.GameObjects.Container {
    const layer = this.add.container(0, 0);
    this.root.add(layer);
    return layer;
  }

  private toast(msg: string) {
    const t = this.add
      .text(CX, 700, msg, { fontFamily: FONT, fontSize: "26px", color: "#ffffff" })
      .setOrigin(0.5)
      .setStroke(UI.ink, 6);
    this.fxLayer.add(t);
    this.tweens.add({ targets: t, y: 660, alpha: 0, duration: 900, onComplete: () => t.destroy() });
  }

  /**
   * Nudge something to say "no".
   *
   * ⚠ The rest position comes from the sprite's own `homeX`, not from `o.x` at the moment of the
   * call. Reading the live x means a second tap while the first nudge is still running captures
   * an already-offset value as "home" and restores to it — so a locked tray tapped over and over
   * ratchets right across the board, 5px a go. Killing the running tween first is not enough on
   * its own either: it stops wherever it happens to be.
   */
  private shake(o: Phaser.GameObjects.Image) {
    const home = (o.getData("homeX") as number | undefined) ?? o.x;
    this.tweens.killTweensOf(o);
    o.x = home;
    this.tweens.add({
      targets: o,
      x: home + 5,
      duration: 45,
      yoyo: true,
      repeat: 3,
      onComplete: () => (o.x = home),
    });
  }

  /** Flash the chute, not the belt — the hopper is what is actually out of room. */
  private flashBeltFull() {
    this.toast("The chute is full!");
    const f = L.funnel;
    const r = this.add
      .rectangle(GAME_W / 2, (f.top + f.neckY) / 2, f.mouthR - f.mouthL, f.neckY - f.top, 0xff4040, 0.3)
      .setVisible(true);
    this.fxLayer.add(r);
    this.tweens.add({ targets: r, alpha: 0, duration: 420, onComplete: () => r.destroy() });
  }


  // ── Dev hook ───────────────────────────────────────────────────────────────
  // Keeping this is what makes the game measurable from a headless browser.

  private exposeTestHooks() {
    (window as unknown as Record<string, unknown>).__ms = {
      scene: this,
      state: () => ({
        level: this.level,
        status: this.board.status,
        belt: [...this.board.belt],
        boxes: this.board.boxes.map((b) => ({ stack: [...b.stack], filled: b.filled })),
        tiles: this.board.tiles.map((t) => (t ? (t.hidden ? "?" : PALETTE[t.color].name) : null)),
        capacity: this.board.capacity(),
        remaining: this.board.remaining(),
      }),
      tap: (i: number) => this.onTapCell(i),
      /**
       * Put the revive offer on screen without playing a level into a jam.
       *
       * ⚠ It stuffs the rail with colours whose boxes are buried, which is enough to *draw* the
       * offer and is not a position the game could have reached — supply no longer matches demand.
       * For looking at the card only; never measure anything from a board this touched.
       */
      jam: () => {
        const g = this.board;
        const buried: Color[] = [];
        g.boxes.forEach((b) => b.stack.forEach((c, k) => k > 0 && buried.push(c)));
        const a = buried[0] ?? 0;
        const b = buried.find((c) => c !== a) ?? a;
        for (let i = 0; i < BELT_SLOTS; i++) g.belt[i] = i % 2 ? a : b;
        g.fresh.fill(false);
        const plan = g.revivePlan();
        if (plan) this.offerRevive(plan);
        return !!plan;
      },
      revivePlan: () => this.board.revivePlan(),
      takeRevive: () => this.acceptRevive(),
      hint: () => hint(this.board),
      goto: (n: number) => this.scene.restart({ level: n }),
    };
  }
}
