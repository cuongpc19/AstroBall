import Phaser from "phaser";
import { GAME_H, GAME_W, L, UI } from "../game/config";
import { save } from "../game/save";
import { DAILY_DAYS, DAILY_FROM, DAILY_ON, claimDaily, dailyPrize, dailyState } from "../game/daily";
import { sendDaily } from "../game/telemetry";
import { sfx } from "../game/audio";
import { K, TS, bakeAll, img } from "../game/textures";
import { dismissBootSplash, matchPageToCanvas, pageBackdrop } from "../game/bootsplash";
// ⚠ The one graphic in the game that is **not** baked at boot. Everything else in `textures.ts`
// is drawn procedurally on purpose — no `public/art/`, nothing to keep in sync — but this is a 3D
// render and there is no procedure that produces it. Imported rather than dropped in `public/`
// so Vite fingerprints it and it ships in `assets/` with the rest of the bundle. 34 KB.
import homeCover from "../assets/home-cover.webp";

const FONT = '"Lilita One", Arial, sans-serif';

/** The cover render's own flat background, sampled from its corner pixels. */
const COVER_BG = 0x322d58;
/**
 * ⚠ Flat, not a gradient, and that is the whole reason the page background is set per scene: Home
 * paints its own two violets and has no halo, so the board's gradient would run light at the foot
 * of the bars against a Home that stays dark — a step the eye lands on straight away.
 */
const PAGE_BG = "#322d58";
/**
 * The home screen's bottom furniture, measured **up from the foot of the design box**.
 *
 * ⚠ **Nothing here may be an absolute y.** These were 952 and 1062, which is the same as pinning
 * them to a 1160-tall box — and `GAME_H` is not 1160. It is derived from the frame's own aspect and
 * comes out **918 in a desktop CrazyGames frame**, so the PLAY button was drawn 34px below the
 * bottom edge of the canvas: invisible, unclickable, and the one control the whole screen exists
 * for. The game looked launched and was not playable. Reported from the live frame.
 *
 * The offsets are the old numbers subtracted from 1160, so a tall phone is pixel-identical and only
 * a short box moves. Anything else added down here has to be written the same way.
 */
const PLAY_UP = 208;
const WALLET_UP = 98;

/**
 * Where the box stops being portrait furniture and becomes a landscape menu.
 *
 * ⚠ Home is the **one** screen that can be wide, and the reason is that it is the one screen with
 * no machine on it. `GAME_H` is derived from the cabinet, so the board can never be anything but a
 * portrait strip; the home screen is a picture and two buttons, and on a 16:9 frame it was using
 * 28% of the width and leaving the rest to the letterbox.
 *
 * 1.2 rather than 1.0, because a nearly-square frame has no room to put a column beside a 2:3
 * render — the art alone is two thirds of the height in width.
 */
const WIDE_FROM = 1.2;

/**
 * How much room the column beside the art may take, as a multiple of the art's own width.
 *
 * ⚠ The art and the column are laid out as **one group, centred**, rather than the art being
 * pinned to a share of the width. On a 21:9 monitor a fixed share leaves the two at 31% and 76%
 * with a third of the screen of nothing between them; capping the column and centring what is
 * left keeps the pair together and puts the slack in the outside margins, where it reads as
 * framing instead of as a gap.
 *
 * ⚠ It was 1.35 and the group then ran within 9% of both edges of a 16:9 frame — reported as
 * "sát 2 cạnh màn hình quá". At 0.95 the margin is 16% a side, and the column still holds the
 * button at its full 1.7.
 */
const WIDE_COL = 0.95;

/** How far the cover's own edge column is stretched to fill the rest of the box. */
const EDGE_SLICE = 6;

/** The unscaled width of the `wide` button face, from `textures.ts`. */
const BTN_W = 260;

export class HomeScene extends Phaser.Scene {
  /** Redrawn after a claim, so the wallet on the home screen agrees with the card. */
  private coinTxt!: Phaser.GameObjects.Text;
  /** Open the streak card as soon as the screen exists — set by whoever sent the player here. */
  private openDaily = false;
  /** The "something to take" badge and its breath, so a claim can put them out. */
  private dailyDot: Phaser.GameObjects.Arc | null = null;
  private dailyPulse: Phaser.Tweens.Tween | null = null;
  /** The design box Home is drawing in. `W` is `GAME_W` on a phone and much wider on a desktop. */
  private W = GAME_W;
  private H = GAME_H;
  /** Where the wallet row ended up, so a claimed coin knows where to fly. */
  private walletX = GAME_W / 2;
  private walletY = GAME_H - WALLET_UP;
  /** Where the top-left button sits — the group's edge on a wide box, the canvas corner otherwise. */
  private cornerL = 70;

  constructor() {
    super("Home");
  }

  init(data: { daily?: boolean }) {
    this.openDaily = !!data?.daily;
  }

  preload() {
    this.load.image("homeCover", homeCover);
  }

  create() {
    bakeAll(this);
    this.cameras.main.setBackgroundColor(UI.bg);
    this.sizeStage();
    const { W, H } = this;
    const wide = W / H >= WIDE_FROM;
    const root = this.add.container(0, 0).setScale(this.scale.width / W);

    // A flat ground in the render's own violet. ⚠ Not decoration — it is what the letterbox bars
    // are painted with on a frame wider than 9:19, and what shows for the frame or two before the
    // image decodes. Nothing else draws it, because the cover now fills the screen.
    const bg = this.add.graphics();
    bg.fillStyle(COVER_BG, 1);
    bg.fillRect(0, 0, W, H);
    root.add(bg);
    // ⚠ No halo and no rotating rays here any more. They sat behind the cover, where the only
    // thing they could do was brighten everything the cover was *not* covering — and at 5.6x
    // scale the halo reached well past the cover's lower edge, so the band that hides that edge
    // masked a bright glow above it and nothing below. That step, not any colour mismatch, was
    // the horizontal line across the screen. The render carries its own glow; the screen does
    // not need a second one.

    // Drop the HTML boot splash now that there is something real to look at.
    // ⚠ Shared with `GameScene`, not inlined here — see the note in `bootsplash.ts` for what
    // owning it privately cost.
    dismissBootSplash();
    // Flat scene, so both stops are the same colour — the glow and the vignette do the rest.
    matchPageToCanvas(this, pageBackdrop(PAGE_BG, PAGE_BG));

    // The cover art, which carries the game's name itself — so there is no canvas title over it.
    // Two titles saying the same thing in two typefaces is worse than either alone, and the
    // render's own lettering is the one the store page shows.
    // ⚠ **Cover fit, not contain** — the render fills the whole screen and there is no painted
    // background under it at all. The 2:3 render is 810 tall at full width, so anything short of
    // this leaves a strip of flat violet below it, and then the join between two purples has to
    // be hidden however long the fade is. Scaled to the full 1160 it is 773 wide instead, which
    // bleeds 116px off each side — the lettering sits between 19% and 61% of the width, so it
    // clears that comfortably. The buttons then float over the art rather than sitting under it.
    // ⚠ Wide, the cover is fitted to the **height** and moved left rather than being blown up to
    // fill the width. Covering a 16:9 box with a 2:3 render keeps 37% of its height, and the 37%
    // in the middle is the tray — the lettering at the top and the funnel at the foot both go,
    // and the lettering is the only place the game's name appears at all.
    const scale = wide ? H / 1620 : Math.max(W / 1080, H / 1620);
    const artW = 1080 * scale;
    const colWant = wide ? Math.min(W - artW, artW * WIDE_COL) : 0;
    const groupL = wide ? (W - artW - colWant) / 2 : 0;
    const groupR = wide ? groupL + artW + colWant : W;
    const artCx = wide ? groupL + artW / 2 : W / 2;
    // ⚠ The two corner buttons line up with the **group**, not with the canvas. Pinned to the
    // canvas they are the only things left touching the edges once everything else has been
    // pulled in, so they read as the layout having missed them.
    const cornerR = wide ? groupR - 36 : W - 70;
    this.cornerL = wide ? groupL + 36 : 70;
    const cover = this.add.image(artCx, H / 2, "homeCover");
    cover.setDisplaySize(artW, 1620 * scale);
    // ⚠ The gap either side is filled by **stretching the render's own edge column**, not by a
    // colour picked to look close. Its edges are near-flat violet but not one violet — they run
    // #302e58 at the top, #353260 where the glow passes and back down — so any flat fill draws a
    // soft vertical rectangle around the art at exactly the height the eye is already looking.
    // Two frames off the same texture cost nothing and cannot drift.
    const tex = this.textures.get("homeCover");
    const src = tex.getSourceImage() as { width: number; height: number };
    if (!tex.has("edgeL")) {
      tex.add("edgeL", 0, 0, 0, EDGE_SLICE, src.height);
      tex.add("edgeR", 0, src.width - EDGE_SLICE, 0, EDGE_SLICE, src.height);
    }
    const artL = artCx - artW / 2;
    const artR = artCx + artW / 2;
    if (artL > 0) {
      const e = this.add.image(0, 0, "homeCover", "edgeL").setOrigin(0, 0);
      e.setDisplaySize(artL + 1, H);
      root.add(e);
    }
    if (artR < W) {
      const e = this.add.image(artR - 1, 0, "homeCover", "edgeR").setOrigin(0, 0);
      e.setDisplaySize(W - artR + 1, H);
      root.add(e);
    }
    root.add(cover);

    // ⚠ A scrim, not a panel. With the render running edge to edge the PLAY button lands on the
    // funnel and the stars sit on its stem — legible, but the two fight each other. This darkens
    // the lower third *through* the art rather than covering it, so the funnel still reads and
    // the UI has a ground under it. Fully transparent where it starts, so there is no line.
    // ⚠ Portrait only. It is there because the PLAY button lands on the funnel; on a wide box the
    // button has its own column beside the art and the scrim would only be dimming the picture.
    if (!wide) {
      const scrim = this.add.graphics();
      scrim.fillGradientStyle(COVER_BG, COVER_BG, COVER_BG, COVER_BG, 0, 0, 0.82, 0.82);
      scrim.fillRect(0, H * 0.6, W, H * 0.4);
      root.add(scrim);
    }
    // A slow breath, the same idle the old title had. A completely still home screen reads as a
    // screenshot rather than as a game waiting for you.
    this.tweens.add({
      targets: cover,
      scaleX: cover.scaleX * 1.03,
      scaleY: cover.scaleY * 1.03,
      duration: 2600,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });

    // One button, always. ⚠ With START OVER gone there is no route back to level 1 from here —
    // `?reset=1` is the only one left, and inside the host's iframe the player cannot edit the
    // URL. That is the trade: a single uncluttered call to action against no way to replay from
    // the start.
    const level = save.unlocked;
    // The call to action and the wallet: stacked at the foot of a portrait box, and centred in the
    // space left of the art on a wide one. ⚠ Both come off the same two numbers, so they can never
    // drift apart — the coin that flies out of a claimed reward aims at `walletY` too.
    const colW = colWant;
    const uiCx = wide ? artR + colW / 2 : W / 2;
    // ⚠ Capped against the column, not a flat 1.7. Just past `WIDE_FROM` — a 5:4 desktop, which is
    // still a common monitor — the space beside the art is only 475 units wide and a 442-unit
    // button lands 16 units off the picture.
    const playScale = wide ? Math.min(1.7, (colW * 0.78) / BTN_W) : 1.35;
    const playY = wide ? H * 0.5 : H - PLAY_UP;
    this.walletX = uiCx;
    this.walletY = wide ? playY + 118 : H - WALLET_UP;
    const { walletX: wx, walletY: wy } = this;
    root.add(
      // ⚠ Bigger on a wide box, not the same button moved sideways. The column beside the art is
      // half the screen with two things in it; at the portrait size the call to action reads as
      // something the layout forgot to finish.
      this.button(uiCx, playY, level > 1 ? `LEVEL ${level}` : "PLAY", "wide", () =>
        this.scene.start("Game", { level }),
        playScale,
      ),
    );

    const ws = wide ? 1.25 : 1;
    const stars = img(this, K.star(true), wx - 90 * ws, wy).setScale((0.8 * ws) / TS);
    const starTxt = this.add
      .text(wx - 56 * ws, wy - 2, String(save.totalStars), {
        fontFamily: FONT,
        fontSize: `${Math.round(30 * ws)}px`,
        color: "#ffffff",
      })
      .setOrigin(0, 0.5)
      .setStroke(UI.ink, 6);
    const coin = img(this, K.coin, wx + 40 * ws, wy).setScale(ws / TS);
    const coinTxt = this.add
      .text(wx + 66 * ws, wy - 2, String(save.coins), {
        fontFamily: FONT,
        fontSize: `${Math.round(30 * ws)}px`,
        color: "#ffffff",
      })
      .setOrigin(0, 0.5)
      .setStroke(UI.ink, 6);
    root.add([stars, starTxt, coin, coinTxt]);
    // Held so a claim can update it in place — rebuilding the scene to change one number would
    // restart the cover's breath and re-run the boot splash dismissal.
    this.coinTxt = coinTxt;

    const mute = img(this, K.btn("gold"), cornerR, 70);
    const muteTxt = this.add
      .text(cornerR, 68, save.muted ? "🔇" : "🔊", { fontSize: "24px" })
      .setOrigin(0.5);
    const muteZone = this.add
      .rectangle(cornerR, 70, 60, 60, 0xffffff, 0)
      .setInteractive({ useHandCursor: true });
    muteZone.on("pointerdown", () => {
      save.muted = !save.muted;
      muteTxt.setText(save.muted ? "🔇" : "🔊");
    });
    root.add([mute, muteTxt, muteZone]);

    // ⚠ Top **left**, mirroring the mute button rather than joining it. The two are different
    // kinds of thing — one is a setting, the other is a reward waiting to be taken — and a badge
    // that pulses next to a speaker icon reads as "the sound is broken".
    if (DAILY_ON && save.unlocked > DAILY_FROM) this.buildDailyButton(root);

    root.add(
      this.add
        .text(uiCx, H - 40, `v${__APP_VERSION__} · ${__APP_BUILD__}`, {
          fontFamily: FONT,
          fontSize: "16px",
          color: "#ffffff",
        })
        .setOrigin(0.5)
        .setAlpha(0.55),
    );

    // Dragging a desktop window between shapes changes which layout this screen should be in.
    this.scale.on("resize", this.onResize, this);
    this.events.once("shutdown", () => this.scale.off("resize", this.onResize, this));
  }

  /**
   * Widen the canvas to the shape of the window, for this scene only.
   *
   * ⚠ **The board can never do this and Home has to undo it**, which is why `GameScene.create`
   * sets the size back rather than trusting whoever left. `GAME_H` is derived from the cabinet,
   * so a wide box on the board is empty canvas either side of a machine that cannot grow into it;
   * Home is a picture and two buttons and has nothing to lose by filling the frame.
   *
   * ⚠ The **height never changes**, so `this.scale.height / GAME_H` is the device pixel ratio at
   * every point in the game's life — including the second visit to this screen, when the width has
   * already been widened once and can no longer be divided to recover it.
   */
  private sizeStage() {
    this.H = GAME_H;
    this.W = this.wantedW();
    const dpr = this.scale.height / GAME_H || 1;
    const want = Math.round(this.W * dpr);
    if (Math.abs(this.scale.width - want) > 1) this.scale.setGameSize(want, Math.round(GAME_H * dpr));
  }

  /**
   * The design width the current frame asks for, without applying it.
   *
   * ⚠ Never narrower than `GAME_W`. A portrait phone would otherwise ask for a box *taller* than
   * 540 x GAME_H, and FIT would letterbox the home screen on the one device that has no letterbox
   * anywhere else in the game.
   */
  private wantedW(): number {
    const box = this.scale.parentSize;
    const pw = box.width || window.innerWidth || GAME_W;
    const ph = box.height || window.innerHeight || GAME_H;
    return Math.max(GAME_W, Math.round(GAME_H * (pw / ph)));
  }

  /**
   * Lay the screen out again when the frame changes shape.
   *
   * ⚠ Guarded on the width **actually** changing, and it has to be: `setGameSize` emits `resize`
   * itself, so an unguarded handler restarts the scene, which resizes, which restarts it, forever.
   * The 3-unit slack absorbs the rounding in `wantedW`.
   */
  private onResize() {
    if (Math.abs(this.wantedW() - this.W) > 3) this.scene.restart();
  }

  /**
   * The daily-reward button, and the red dot that says there is something in it.
   *
   * ⚠ The dot is driven by `claimable`, not by whether the feature exists. A badge that is always
   * on is furniture within a day and the player stops seeing it — which is the one thing a daily
   * reward cannot afford, since it only works if they come back tomorrow and notice.
   */
  private buildDailyButton(root: Phaser.GameObjects.Container) {
    const x = this.cornerL;
    const y = 70;
    const st = dailyState();

    const frame = img(this, K.btn("gold"), x, y);
    const cal = img(this, K.calendar, x, y).setScale(0.86 / TS);
    root.add([frame, cal]);

    if (st.claimable) {
      const dot = this.add.circle(x + 22, y - 20, 11, 0xe33b3b).setStrokeStyle(3, 0xffffff);
      root.add(dot);
      this.dailyDot = dot;
      // A slow breath on the whole button, not a flash on the dot. The home screen already has the
      // cover art breathing; a second, faster rhythm on top of it reads as an error indicator.
      this.dailyPulse = this.tweens.add({
        targets: [frame, cal, dot],
        scale: "*=1.08",
        duration: 780,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      });
    }

    const zone = this.add.rectangle(x, y, 76, 76, 0xffffff, 0).setInteractive({ useHandCursor: true });
    zone.on("pointerdown", () => {
      sfx.pick();
      this.showDaily();
    });
    root.add(zone);

    /**
     * Sent here by a win — open the card without making them hunt for a button they have never seen
     * before.
     *
     * ⚠ **Now, not on a timer.** This was `delayedCall(420, …)`, and for 0.42s the home screen was
     * fully live with PLAY in the middle of it. The player has just tapped CLAIM REWARD on the
     * results card and their finger is already there, so a second tap went straight into the next
     * level and the card opened onto a scene that was closing. Measured: **36% of forced returns
     * were back in a level inside 2 seconds** and 52% inside 3 — most of the people this feature
     * interrupts never saw it. Opening here puts the card's own dimmer, which swallows taps, up on
     * the first frame, so there is no window to tap through.
     */
    if (this.openDaily) this.showDaily();
  }

  /**
   * The three-day card.
   *
   * ⚠ Every day is on screen, including the ones already banked and the ones still to come. A card
   * that showed only today would be a coin popup; what makes a streak work is seeing day 3's 250
   * while standing on day 1.
   *
   * ⚠ The three states are told apart by **presence, not brightness** — a live day has a red tab
   * and a cream face, a locked day has a padlock, a banked day has a tick. Shading alone has to be
   * compared against a neighbour to be read, and day 3 has no brighter neighbour to compare with.
   * Same reasoning as the raised/flat eggs on a tray.
   */
  private showDaily() {
    // ⚠ Guarded here as well as at the button. `init` can still be handed `{daily: true}` by a
    // stale scene transition or a hand-typed restart, and a card with no way to reach it is worse
    // than one that is simply absent.
    if (!DAILY_ON) return;
    if (this.children.getByName("dailyCard")) return;
    const c = this.add.container(0, 0).setName("dailyCard").setDepth(100);
    c.setScale(this.scale.width / this.W);
    const st = dailyState();
    const midY = this.H / 2;

    const dim = this.add.rectangle(this.W / 2, this.H / 2, this.W, this.H, 0x0d0a2a, 0.78);
    dim.setInteractive();     // swallows taps on the art behind, which would otherwise start a level
    c.add(dim);

    const W = 478;
    const HH = 520;
    const X = (this.W - W) / 2;
    const Y = midY - HH / 2;
    const panel = this.add.graphics();
    panel.fillStyle(0x0a1730, 0.55).fillRoundedRect(X - 8, Y + 8, W + 16, HH, 36);
    panel.fillStyle(0x0e2145, 1).fillRoundedRect(X - 6, Y - 6, W + 12, HH, 34);
    panel.fillStyle(0x16305a, 1).fillRoundedRect(X, Y, W, HH, 30);
    c.add(panel);

    c.add(
      this.add
        .text(this.W / 2, Y + 52, "DAILY BONUS", { fontFamily: FONT, fontSize: "40px", color: "#ffd453" })
        .setOrigin(0.5)
        .setStroke("#7a3d06", 9),
    );
    // ⚠ Two lines, not one. "Claim your gift!" over a card whose button says COME BACK TOMORROW is
    // the card arguing with itself, and the state where there is nothing to take is exactly the one
    // a player is most likely to misread as broken.
    c.add(
      this.add
        .text(this.W / 2, Y + 100, st.claimable ? "Thanks for playing! Claim your gift!" : "See you tomorrow!", {
          fontFamily: FONT,
          fontSize: "19px",
          color: "#a9c2e6",
        })
        .setOrigin(0.5),
    );

    // ⚠ `DAILY_DAYS` drives the loop, never a literal 3. The table in `daily.ts` is the one
    // definition of how long a cycle is; a second one here is a silently wrong card the day it moves.
    const CW = 140;
    const CH = 258;
    const gap = 14;
    for (let d = 1; d <= DAILY_DAYS; d++) {
      const cx = this.W / 2 + (d - 1 - (DAILY_DAYS - 1) / 2) * (CW + gap);
      this.dailyCell(c, cx, Y + 150 + CH / 2, CW, CH, d, st);
    }

    // ⚠ **One Claim button for the card, not one per column.** Only ever one day is takeable, so a
    // button on every cell is two that do nothing beside one that does, and the player has to read
    // three columns to find out which. The single button also has somewhere to say why it is off,
    // which a missing button does not.
    const bY = Y + HH - 62;
    if (st.claimable) {
      c.add(this.wideBtn(this.W / 2, bY, "CLAIM", 0x4bc84b, 0x2f8f2f, () => this.doClaim(c)));
    } else {
      c.add(this.wideBtn(this.W / 2, bY, "COME BACK TOMORROW", 0x3f5578, 0x2b3c56, () => c.destroy(), 20));
    }

    // The close cross — the way out that takes nothing.
    const kx = X + W - 30;
    const ky = Y + 22;
    const cross = this.add.graphics();
    cross.fillStyle(0x8f2f2f, 1).fillCircle(kx, ky + 3, 23);
    cross.fillStyle(0xe04b4b, 1).fillCircle(kx, ky, 23);
    c.add(cross);
    c.add(
      this.add
        .text(kx, ky - 2, "X", { fontFamily: FONT, fontSize: "24px", color: "#ffffff" })
        .setOrigin(0.5)
        .setStroke(UI.ink, 4),
    );
    const closeHit = this.add.rectangle(kx, ky, 62, 62, 0xffffff, 0).setInteractive({ useHandCursor: true });
    closeHit.on("pointerdown", () => {
      sfx.pick();
      c.destroy();
    });
    c.add(closeHit);
  }

  /**
   * One day of the streak: banked, live, or still locked.
   *
   * ⚠ The reward is read from `dailyPrize`, never from the tables directly. The card and the payout
   * have to agree, and the only way to guarantee that is for both to ask the same function — a card
   * promising 150 over a `claimDaily` paying 100 is the worst bug this feature can have.
   */
  private dailyCell(
    into: Phaser.GameObjects.Container,
    cx: number,
    cy: number,
    w: number,
    h: number,
    day: number,
    st: { day: number; claimable: boolean; done: number },
  ) {
    const banked = day <= st.done;
    const live = day === st.day && st.claimable;
    const top = cy - h / 2;

    // Body. Live is cream inside a gold rim; locked is the reference's blue; banked is sunk back
    // into the panel so it reads as spent rather than as one more offer.
    const rim = live ? 0xf5c344 : banked ? 0x22385a : 0x2f74b4;
    const face = live ? 0xfdf4dc : banked ? 0x1b3050 : 0x3d8fd6;
    const g = this.add.graphics();
    g.fillStyle(rim, 1).fillRoundedRect(cx - w / 2, top, w, h, 18);
    g.fillStyle(face, 1).fillRoundedRect(cx - w / 2 + 5, top + 5, w - 10, h - 10, 14);
    into.add(g);

    // The day tab. Red on the live day — the only hue on the card that is not blue or gold, so the
    // eye lands on it before it has read a word.
    const tabW = w - 26;
    const tabH = 40;
    const tab = this.add.graphics();
    tab
      .fillStyle(live ? 0xd93b32 : banked ? 0x2b4468 : 0x2f74b4, 1)
      .fillRoundedRect(cx - tabW / 2, top + 12, tabW, tabH, 12);
    into.add(tab);
    into.add(
      this.add
        .text(cx, top + 32, "Day " + day, {
          fontFamily: FONT,
          fontSize: "22px",
          color: live ? "#ffffff" : banked ? "#7f93b3" : "#dceaf9",
        })
        .setOrigin(0.5),
    );

    const prize = dailyPrize(day);
    const ink = live ? "#7a5a12" : banked ? "#6d81a1" : "#ffffff";
    const edge = live ? 0 : 4;

    // ⚠ The prize block is centred on what this day actually pays, not pinned to the top. Day 1 has
    // no magnet row, and pinned it left a third of the column empty below the coin — which reads as
    // a reward that failed to draw rather than as one item. `drop` re-centres the shorter block.
    const drop = prize.magnets ? 0 : 30;

    // Coins, every day. Sized a little by the day so the cycle reads as building before the numbers
    // have been compared at all.
    into.add(img(this, K.coin, cx, top + 106 + drop).setScale((1.35 + day * 0.12) / TS));
    into.add(
      this.add
        .text(cx, top + 148 + drop, String(prize.coins), { fontFamily: FONT, fontSize: "27px", color: ink })
        .setOrigin(0.5)
        .setStroke(UI.ink, edge),
    );

    // Magnets, only on the days that pay them. ⚠ Nothing at all on day 1, rather than a greyed
    // slot: an empty slot is one more thing the player has to work out is not a reward.
    if (prize.magnets) {
      into.add(img(this, K.icon("magnet"), cx - 16, top + 198).setScale(1.05 / TS));
      into.add(
        this.add
          .text(cx + 22, top + 198, "x" + prize.magnets, { fontFamily: FONT, fontSize: "23px", color: ink })
          .setOrigin(0.5)
          .setStroke(UI.ink, edge),
      );
    }

    if (banked) {
      // Sunk **and** ticked. The sinking alone is only legible beside a brighter column, and on the
      // last day of a finished cycle there is not one.
      into.add(
        this.add
          .text(cx, cy + h / 2 - 30, "✓", { fontFamily: FONT, fontSize: "38px", color: "#4bc86e" })
          .setOrigin(0.5),
      );
    } else if (!live) {
      // The padlock, hung off the bottom-right corner as in the reference — over the rim rather
      // than inside the face, so it reads as fastening the card shut.
      const lx = cx + w / 2 - 16;
      const ly = cy + h / 2 - 14;
      const halo = this.add.graphics();
      halo.fillStyle(0x0e2145, 1).fillCircle(lx, ly, 25);
      halo.fillStyle(0xdfe8f5, 1).fillCircle(lx, ly, 21);
      into.add(halo);
      into.add(img(this, K.lock, lx, ly).setScale(0.92 / TS));
    }
  }

  /**
   * A card-sized button.
   *
   * ⚠ Drawn at this size rather than `button()` scaled down: `button()` bakes a 260px face with a
   * 25px label, and squeezing that into a card left the word eight pixels tall while the tap target
   * shrank with it. A small button is its own shape, not a big one seen from far away.
   */
  private wideBtn(
    x: number,
    y: number,
    label: string,
    top: number,
    shadow: number,
    onTap: () => void,
    size = 26,
  ) {
    const c = this.add.container(x, y);
    const bw = 300;
    const bh = 62;
    const g = this.add.graphics();
    g.fillStyle(shadow, 1).fillRoundedRect(-bw / 2, -bh / 2 + 5, bw, bh, 16);
    g.fillStyle(top, 1).fillRoundedRect(-bw / 2, -bh / 2, bw, bh - 5, 16);
    const t = this.add
      .text(0, -2, label, { fontFamily: FONT, fontSize: size + "px", color: "#ffffff" })
      .setOrigin(0.5)
      .setStroke(UI.ink, 5);
    const hit = this.add.rectangle(0, 0, bw + 10, bh + 14, 0xffffff, 0).setInteractive({ useHandCursor: true });
    hit.on("pointerdown", () => {
      sfx.pick();
      onTap();
    });
    c.add([g, t, hit]);
    return c;
  }

  /** Take today's reward, then rebuild the card so every state on it is the new one. */
  private doClaim(card: Phaser.GameObjects.Container) {
    // ⚠ Read the day **before** claiming. `claimDaily` advances the streak, so asking afterwards
    // reports the day the player will take tomorrow rather than the one they were just paid for.
    const day = dailyState().day;
    const prize = claimDaily();
    // ⚠ Logged after the null check, never before it. `claimDaily` returns null when there is
    // nothing to take — a row written there would record a reward the player never received, and
    // this whole log exists to answer how many of them are actually collected.
    if (!prize) return;
    sendDaily({ lvl: save.unlocked, day, coins: prize.coins, magnets: prize.magnets });
    sfx.win();
    this.coinTxt.setText(String(save.coins));

    // ⚠ Put the badge out here, not on the next visit to this screen. The card closes back onto the
    // home screen, and a red dot still sitting on the icon says there is something to take when
    // there is not — the player taps it again and is shown a card with nothing on it for them.
    this.dailyPulse?.remove();
    this.dailyPulse = null;
    this.dailyDot?.destroy();
    this.dailyDot = null;

    // Coins flying to the wallet. The number changing on its own is a fact; watching it arrive is
    // the reward — same reasoning as the feature bar on the results card.
    for (let i = 0; i < 8; i++) {
      const s = img(this, K.coin, this.W / 2, this.H / 2 - 40).setScale(1.2 / TS).setDepth(200);
      this.tweens.add({
        targets: s,
        x: this.walletX + 40,
        y: this.walletY,
        scale: 0.5 / TS,
        duration: 520,
        delay: i * 55,
        ease: "Quad.easeIn",
        onComplete: () => s.destroy(),
      });
    }

    // ⚠ **Magnets are paid silently, on purpose.** They are credited by `claimDaily` above; what is
    // deliberately absent is any animation for them. There is no magnet counter on the home screen
    // for a sprite to land on, so a magnet flying anywhere would be flying at nothing — and a
    // caption in mid-air is a second, competing announcement over the coins already in flight. The
    // card the player just read is where the magnet was promised, and the rebuilt card below is
    // where the tick confirming it appears.

    card.destroy();
    this.time.delayedCall(700, () => this.showDaily());
  }

  /**
   * `scale` grows the whole container — face, label, stroke and hit zone together. Enlarging the
   * sprite alone would leave the tap target at its old size, which is the sort of thing that only
   * shows up as "the button sometimes does not work" on a phone.
   */
  private button(x: number, y: number, label: string, face: string, onTap: () => void, scale = 1) {
    const c = this.add.container(x, y).setScale(scale);
    const bg = img(this, K.btn(face), 0, 0);
    const t = this.add
      .text(0, -3, label, { fontFamily: FONT, fontSize: "25px", color: "#ffffff" })
      .setOrigin(0.5)
      .setStroke(UI.ink, 6);
    const zone = this.add
      .rectangle(0, 0, 260, L.boostSize, 0xffffff, 0)
      .setInteractive({ useHandCursor: true });
    zone.on("pointerdown", () => {
      sfx.pick();
      onTap();
    });
    c.add([bg, t, zone]);
    return c;
  }
}
