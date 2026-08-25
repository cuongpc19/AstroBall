// Every graphic in the game is drawn into a canvas at boot — there is no public/art, so
// there is nothing to load, nothing to cache-bust and nothing to keep in sync with the
// palette in config.ts.
//
// Textures are baked at TS× and drawn back at 1/TS so they stay sharp on a 2× phone while
// the rest of the game keeps working in flat design units.

import Phaser from "phaser";
import { BOX_SLOTS, CELL_PITCH, L, PALETTE, TRAY_N, UI, type Color } from "./config";

export const TS = 2;

/**
 * Eggs on the face of a tray tile — one per marble it holds, in a 3x3. Deliberately tied to
 * TRAY_N rather than hard-coded: the tile is the player's only warning of how much belt a tap
 * is about to spend, and it lying about that is worse than no marking at all.
 *
 * ⚠ **"Egg" is the codebase's word for the marking, not a description of the drawing.**
 * `logic.ts` decides whether a tray's eggs stand proud, `GameScene` bounces them back up when a
 * lane opens, and the editor has an `.eggs` class — renaming them in this one file would split a
 * vocabulary four files have to agree on. Since the re-skin each one is drawn as a small
 * asteroid, which is what `trayFace` below calls them.
 */
const EGGS = TRAY_N;
const EGG_COLS = 3;

/** Hole geometry for the active box — shared with GameScene so the marbles land in them. */
export const HOLE_R = 11;
export const HOLE_STEP = HOLE_R * 2.6;

const hex = (n: number) => "#" + n.toString(16).padStart(6, "0");

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const k = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + k, y);
  ctx.lineTo(x + w - k, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + k);
  ctx.lineTo(x + w, y + h - k);
  ctx.quadraticCurveTo(x + w, y + h, x + w - k, y + h);
  ctx.lineTo(x + k, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - k);
  ctx.lineTo(x, y + k);
  ctx.quadraticCurveTo(x, y, x + k, y);
  ctx.closePath();
}

// ── Rock ─────────────────────────────────────────────────────────────────────
//
// Every piece the player sorts is stone now, and two things make stone read at 15px: an outline
// that is *not* a circle, and craters. Both live here rather than being copied into each bake,
// because the asteroid on the belt and the little one on the tray it fell out of have to look
// like the same material or the tray stops explaining what it is about to spend.
//
// ⚠ **Seeded, never `Math.random()`.** `bakeAll` runs once per scene — Home, Game and the editor
// each bake their own copy of the same key — so a random lump would hand two scenes two different
// rocks under one texture name, and the marble the player watched fall would change shape when
// the win panel came up. The seed is the palette index, so blue is always the same blue rock.

/** xorshift32 — small, deterministic, and good enough for lumps and craters. */
function seeded(seed: number): () => number {
  let s = (Math.imul(seed, 2654435761) >>> 0) || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

/**
 * An irregular closed outline around `(cx, cy)` with mean radius `r`. `bump` is how far the
 * radius is allowed to wander in — 0.14 is a worn pebble, 0.3 a freshly shattered chunk.
 *
 * ⚠ **Every lobe sits *inside* `r`, never outside it.** `L.marbleR` is a gameplay number: a
 * marble seats in a `HOLE_R` socket and the belt spaces them at `2 * marbleR`, so a lobe that
 * bulged past `r` would be a rock that visibly overlaps the one behind it on the rail and hangs
 * over the lip of the bay it just landed in. Wander inward and the silhouette is still stone.
 *
 * Drawn as quadratics *through the midpoints* with the sampled points as controls: the corners
 * get rounded off, so the result is weathered rock rather than a cut gem.
 */
function rockPath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  rnd: () => number,
  lobes = 10,
  bump = 0.16,
) {
  const pts: number[][] = [];
  for (let i = 0; i < lobes; i++) {
    const a = (i / lobes) * Math.PI * 2;
    const rad = r * (1 - bump * rnd());
    pts.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad]);
  }
  const mid = (i: number) => [
    (pts[i][0] + pts[(i + 1) % lobes][0]) / 2,
    (pts[i][1] + pts[(i + 1) % lobes][1]) / 2,
  ];
  ctx.beginPath();
  const start = mid(lobes - 1);
  ctx.moveTo(start[0], start[1]);
  for (let i = 0; i < lobes; i++) {
    const n = mid(i);
    ctx.quadraticCurveTo(pts[i][0], pts[i][1], n[0], n[1]);
  }
  ctx.closePath();
}

/**
 * Craters, scattered inside the body. Each is a dark bowl with a lit lip on the side the light
 * comes from — up-left, the same direction every other piece in this file is lit from.
 *
 * ⚠ **The lip is not optional.** A dark blob on a sphere is a smudge; a dark blob with a bright
 * crescent above it is a hole. Two passes, the lit one first and slightly larger, is the whole
 * trick — the same one `trayFace` uses to make its rocks bulge off the plate.
 *
 * ⚠ Deliberately **low contrast against the body**: colour is the entire sort, and craters loud
 * enough to be admired at 4x are craters that break a 15px marble into two colours on a phone.
 * Caller is expected to `clip()` to the rock first — these run past the edge on purpose so the
 * ones near the rim come out as bitten-off arcs rather than tidy circles.
 */
function craters(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  rnd: () => number,
  n: number,
  dark: string,
  light: string,
) {
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2;
    const d = r * (0.12 + rnd() * 0.72);
    const x = cx + Math.cos(a) * d;
    const y = cy + Math.sin(a) * d;
    const cr = r * (0.11 + rnd() * 0.17);
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = light;
    ctx.beginPath();
    ctx.ellipse(x - cr * 0.22, y - cr * 0.3, cr * 1.08, cr * 0.98, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.ellipse(x, y, cr, cr * 0.85, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/**
 * A dusting of stars over a rect, for the neutral hardware — the sealed bay, the face-down tile,
 * the loose boulder. Never over a coloured face: a coloured face is carrying the sort, and specks
 * of white on it are specks of a second colour.
 */
function starfield(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  rnd: () => number,
  n: number,
) {
  ctx.fillStyle = "#ffffff";
  for (let i = 0; i < n; i++) {
    ctx.globalAlpha = 0.18 + rnd() * 0.45;
    ctx.beginPath();
    ctx.arc(x + rnd() * w, y + rnd() * h, 0.5 + rnd() * 0.9, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

type Draw = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

function bake(scene: Phaser.Scene, key: string, w: number, h: number, draw: Draw) {
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.createCanvas(key, Math.ceil(w * TS), Math.ceil(h * TS));
  if (!tex) return;
  const ctx = tex.getContext();
  ctx.save();
  ctx.scale(TS, TS);
  draw(ctx, w, h);
  ctx.restore();
  tex.refresh();
}

/** Add a baked texture at design-unit size. */
export function img(scene: Phaser.Scene, key: string, x = 0, y = 0): Phaser.GameObjects.Image {
  return scene.add.image(x, y, key).setScale(1 / TS);
}

/**
 * One large crater, placed by the caller rather than scattered. Same two-pass bowl as `craters`
 * but with a full lit lip, an inner shadow and a raised outer wall, because at this size the
 * detail is legible and a plain dark disc reads as a hole punched through the rock.
 *
 * ⚠ **A rock needs exactly one of these.** It is what gives the lump a scale — a scatter of
 * same-sized pocks and nothing else reads as a golf ball, which is the failure the first pass of
 * this re-skin shipped.
 */
function bigCrater(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  dark: string,
  light: string,
) {
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = light;
  ctx.beginPath();
  ctx.ellipse(x - r * 0.16, y - r * 0.2, r * 1.16, r * 1.04, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 0.62;
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.ellipse(x, y, r, r * 0.88, 0, 0, Math.PI * 2);
  ctx.fill();
  // The far wall of the bowl catches the light the near wall shades.
  ctx.globalAlpha = 0.4;
  ctx.fillStyle = light;
  ctx.beginPath();
  ctx.ellipse(x + r * 0.16, y + r * 0.2, r * 0.66, r * 0.56, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

/**
 * Mineral grain — flecks of the swatch's own light and dark, no white. It is what stops a lump
 * with craters on it reading as a *smooth* lump with craters on it, and it costs one pass.
 *
 * ⚠ Uses the swatch, never white, and never over more than a fifth alpha: the piece is 15px wide
 * on a phone and every neutral speck on it is a speck of a colour the player might sort by.
 */
function grain(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  rnd: () => number,
  n: number,
  light: string,
  dark: string,
) {
  for (let i = 0; i < n; i++) {
    ctx.globalAlpha = 0.08 + rnd() * 0.13;
    ctx.fillStyle = rnd() > 0.5 ? light : dark;
    ctx.beginPath();
    ctx.ellipse(x + rnd() * w, y + rnd() * h, 0.6 + rnd() * 1.5, 0.5 + rnd() * 1.1, rnd() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// ── Keys ─────────────────────────────────────────────────────────────────────

export const K = {
  marble: (c: Color) => `mb${c}`,
  /** `raised` is the tappable look; the flat one reads as sealed. */
  tray: (c: Color, raised: boolean) => (raised ? `tr${c}` : `trf${c}`),
  /** the x2 tray, two cells wide */
  trayWide: (c: Color, raised: boolean) => (raised ? `trw${c}` : `trwf${c}`),
  trayHidden: "trH",
  dispenser: "disp",
  crate: "crate",
  bar: "bar",
  /** The clip that holds a linked pair together. */
  link: "link",
  /**
   * The arrow lock: a chevron on a dark disc, sitting on the face of a sealed tray and pointing
   * at the neighbour that has to be poured first.
   *
   * ⚠ **One texture, baked pointing up, turned by the scene** — the same trick the hatch shutter
   * uses. Four baked arrows would be four chances for one of them to be drawn a pixel off centre,
   * and the rotation is exactly what the rule is about.
   */
  arrow: "arrow",
  lid: "lid",
  /**
   * The two ribbons tied round a chocolate box, in the colour that counts toward opening it.
   * `null` is the rainbow box, whose ribbons run through every colour because a tray of *any*
   * colour counts.
   */
  lidRibbon: (c: Color | null) => (c === null ? "lidRibR" : `lidRib${c}`),
  /** The pale disc the counter sits on, so the number stays legible over dark chocolate. */
  lidDial: "lidDial",
  boxHidden: "bxHid",
  cell: "cell",
  box: (c: Color) => `bx${c}`,
  boxOpen: (c: Color) => `bxo${c}`,
  cleat: (light: boolean) => (light ? "cleatL" : "cleatD"),
  spark: "spark",
  ring: "ring",
  /** The pointing hand every coach mark travels on. */
  hand: "hand",
  rays: "rays",
  flash: "flash",
  btn: (kind: string) => `btn_${kind}`,
  icon: (kind: string) => `ic_${kind}`,
  star: (on: boolean) => (on ? "starOn" : "starOff"),
  coin: "coin",
  /** The home screen's daily-reward button: a tear-off calendar with a coin on it. */
  calendar: "cal",
  /** Day seven's prize. Bigger than a coin because it has to look like more than a coin. */
  chest: "chest",
  /** The padlock on a daily-reward day the player has not reached yet. */
  lock: "lock",
};

// ── The bakery ───────────────────────────────────────────────────────────────

export function bakeAll(scene: Phaser.Scene) {
  const R = L.marbleR;

  PALETTE.forEach((sw, c) => {
    // Asteroid: a lump of tinted rock, lit up-left, cratered, with the unlit third falling away
    // down-right. Three passes on the same seed — a dark lump, the lit body a shade smaller, and
    // the craters clipped to it — so the outline is a true rim of shadow all the way round rather
    // than a stroke that happens to follow a circle.
    //
    // ⚠ **Colour still has to be the first thing read at 15px** — it is the entire sort, on a
    // rail that never stops moving. So the specular went from a hard glass dot at 0.85 to a soft
    // shoulder at 0.42, and the craters stay low-contrast: the silhouette and the terminator do
    // the "rock", not detail the player has to stop and look at.
    bake(scene, K.marble(c), R * 2, R * 2, (ctx) => {
      const seed = c * 97 + 11;
      const lump = (r: number) => rockPath(ctx, R, R, r, seeded(seed), 11, 0.2);

      ctx.fillStyle = hex(sw.dark);
      lump(R - 0.4);
      ctx.fill();

      // ⚠ The ramp ends on `dark` and the light is **off-centre**, not centred with a white core.
      // A radial that starts white in the middle is a glass bead — that is literally what this
      // sprite used to be, and the note that used to sit here said the specular dot was the thing
      // selling it. Stone is lit from one side and falls off to nothing on the other.
      const g = ctx.createRadialGradient(R * 0.58, R * 0.52, R * 0.06, R * 0.95, R * 0.98, R * 1.25);
      g.addColorStop(0, hex(sw.light));
      g.addColorStop(0.34, hex(sw.base));
      g.addColorStop(0.86, hex(sw.dark));
      g.addColorStop(1, hex(sw.dark));
      ctx.fillStyle = g;
      lump(R - 1.7);
      ctx.fill();

      ctx.save();
      lump(R - 1.7);
      ctx.clip();
      // One big crater and three small, not five even ones: a scatter of same-sized pocks reads
      // as a golf ball. The big one is what gives the rock a scale to be read against.
      craters(ctx, R + R * 0.18, R + R * 0.3, R * 0.92, seeded(seed + 29), 3, hex(sw.dark), hex(sw.light));
      bigCrater(ctx, R - R * 0.3, R - R * 0.06, R * 0.34, hex(sw.dark), hex(sw.light));
      grain(ctx, 0, 0, R * 2, R * 2, seeded(seed + 61), 22, hex(sw.light), hex(sw.dark));
      // The terminator. Weighted to the far side rather than laid flat over the whole rock, or the
      // swatch reads a full step darker than the tray it came off — the same trap the box body is
      // carrying a comment about.
      const t = ctx.createRadialGradient(R * 0.5, R * 0.45, R * 0.3, R, R, R * 1.35);
      t.addColorStop(0, "rgba(0,0,0,0)");
      t.addColorStop(1, "rgba(8,5,26,0.42)");
      ctx.fillStyle = t;
      ctx.fillRect(0, 0, R * 2, R * 2);
      ctx.restore();

      // Rim light along the lit edge, and it has to **fade around the body** rather than stop.
      // A white arc of constant weight is a drawn outline — it reads as a sticker. Stroking the
      // lump itself with a gradient that runs out before the dark side keeps the piece legible
      // against both grounds it lives on (the pale cabinet floor, the near-black rail housing)
      // without ever looking traced.
      const rim = ctx.createLinearGradient(R * 0.2, R * 0.2, R * 1.5, R * 1.5);
      rim.addColorStop(0, "rgba(255,255,255,0.8)");
      rim.addColorStop(0.5, "rgba(255,255,255,0.12)");
      rim.addColorStop(1, "rgba(255,255,255,0)");
      ctx.strokeStyle = rim;
      ctx.lineWidth = 1.5;
      lump(R - 2.1);
      ctx.stroke();
    });

    // Tray tile — a cargo plate off the side of the rig, in two states, and the gap between them
    // has to be obvious at arm's length on a phone: a plate with a lane out is loaded with nine
    // asteroids, a boxed-in one is a hull panel bolted shut over them. Presence-versus-absence
    // beats any amount of shading — it survives every colour in the palette and reads without
    // comparing two tiles side by side.
    //
    // ⚠ **The plate and the rocks carry the swatch; the metal never does.** Colour is the whole
    // sort. Tint the bolts and the bezel too and there is nothing neutral left for the eye to
    // measure against, and the two swatches that already sit closest together — teal and cyan,
    // pink and magenta — stop being two tiles.
    const trayFace = (
      ctx: CanvasRenderingContext2D,
      w: number,
      h: number,
      raised: boolean,
      cells = 1,
    ) => {
      ctx.fillStyle = hex(sw.dark);
      rr(ctx, 1, 4, w - 2, h - 4, 13);
      ctx.fill();
      const g = ctx.createLinearGradient(0, 0, 0, h);
      if (raised) {
        // ⚠ **Lifted from light/base/base, and the lift is a measurement, not taste.** The cargo
        // well below subtracts from the tile, and `drawBody` opposite is tuned to the loaded
        // tray's mean lightness rather than its stops (the note there is a real bug report). Shot
        // off level 12 and averaged over the whole face: the old ramp with a well under it came
        // out 20 luma below the box of the same colour — pink 160 against 179, red 103 against
        // 118. This ramp plus the well at 0.16 puts both back within a couple of points.
        g.addColorStop(0, hex(sw.light));
        g.addColorStop(0.42, hex(sw.light));
        g.addColorStop(1, hex(sw.base));
      } else {
        g.addColorStop(0, hex(sw.base));
        g.addColorStop(0.5, hex(sw.base));
        g.addColorStop(1, hex(sw.dark));
      }
      ctx.fillStyle = g;
      rr(ctx, 1, 1, w - 2, h - 7, 13);
      ctx.fill();

      const eggCols = EGG_COLS * cells;
      const rows = Math.ceil(EGGS / EGG_COLS);
      const er = 6.2;
      const spanX = (w - 16) / eggCols;
      const spanY = (h - 22) / rows;
      if (raised) {
        // The cargo well the rocks sit in, recessed into the plate.
        //
        // ⚠ **Without it the nine rocks vanish.** Plate and rock are the same swatch — they have
        // to be, the tile is one colour and that colour is the sort — so lit rock on lit plate is
        // a bump map at best. Dropping the floor a third of a step is what puts them *on* the tile
        // instead of *in* it, and it is also the only reason the tile reads as a container.
        //
        // ⚠ It is paid back on the rocks, not left to darken the tile. `drawBody` opposite is
        // tuned against the **mean lightness** of a loaded tray (the note there is a real bug
        // report), so a well that only subtracted would make every box in the game read lighter
        // than the trays feeding it. The rocks below start at white for that reason.
        ctx.globalAlpha = 0.16;
        ctx.fillStyle = hex(sw.dark);
        rr(ctx, 6, 6, w - 12, h - 19, 10);
        ctx.fill();
        ctx.globalAlpha = 1;
        // A lit hairline along the *far* wall — bottom and right — which is where light from
        // up-left lands once the floor is dropped. On the near wall it would read as a raised pad.
        ctx.globalAlpha = 0.3;
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.moveTo(8, h - 14.5);
        ctx.lineTo(w - 10, h - 14.5);
        ctx.stroke();
        ctx.globalAlpha = 1;
        for (let i = 0; i < EGGS * cells; i++) {
          const cx = 8 + spanX * ((i % eggCols) + 0.5);
          const cy = 8 + spanY * (((i / eggCols) | 0) + 0.5);
          // ⚠ Seeded off the *slot*, not off the colour alone, so the nine are nine different
          // rocks. A 3x3 of one repeated lump reads as a moulded pattern — which is exactly what
          // the nine eggs this replaced actually were.
          const seed = c * 131 + i * 17 + 3;
          const lump = (r: number, dx = 0, dy = 0) =>
            rockPath(ctx, cx + dx, cy + dy, r, seeded(seed), 7, 0.3);
          // Cast down-right, then light up-left: the pair is what sells the bulge off the plate.
          ctx.globalAlpha = 0.5;
          ctx.fillStyle = hex(sw.dark);
          lump(er, 0.6, 1.9);
          ctx.fill();
          ctx.globalAlpha = 1;
          // ⚠ Only the **outer sixth** goes to `dark`. The box body opposite is tuned to match the
          // mean lightness of a loaded tray rather than its stops (see the note there), so taking
          // the whole ramp down a step is enough to make every box in the game read lighter than
          // the trays feeding it. That was a real report once already.
          const bg = ctx.createRadialGradient(cx - er * 0.42, cy - er * 0.46, 0.5, cx, cy, er * 1.1);
          bg.addColorStop(0, hex(sw.light));
          bg.addColorStop(0.46, hex(sw.base));
          bg.addColorStop(0.85, hex(sw.base));
          bg.addColorStop(1, hex(sw.dark));
          ctx.fillStyle = bg;
          lump(er);
          ctx.fill();
          ctx.save();
          lump(er);
          ctx.clip();
          bigCrater(ctx, cx + er * 0.24, cy + er * 0.26, er * 0.42, hex(sw.dark), hex(sw.light));
          craters(ctx, cx, cy, er, seeded(seed + 5), 2, hex(sw.dark), hex(sw.light));
          grain(ctx, cx - er, cy - er, er * 2, er * 2, seeded(seed + 41), 7, hex(sw.light), hex(sw.dark));
          ctx.restore();
          // Same fading rim as the marble, at a third of the weight: at 12px a constant white
          // outline on nine rocks is nine white rings, and the tile stops being a colour.
          const rim = ctx.createLinearGradient(cx - er, cy - er, cx + er, cy + er);
          rim.addColorStop(0, "rgba(255,255,255,0.72)");
          rim.addColorStop(0.55, "rgba(255,255,255,0.08)");
          rim.addColorStop(1, "rgba(255,255,255,0)");
          ctx.strokeStyle = rim;
          ctx.lineWidth = 1;
          lump(er - 0.5);
          ctx.stroke();
        }
      } else {
        // Sealed: a hull panel over the load, recessed, with a bolt at each corner. It reads as
        // a lid rather than as a tray whose rocks happen to be badly lit — and the bolts are the
        // only place a locked tray says "machine", which is the thing that has hold of it.
        ctx.globalAlpha = 0.24;
        ctx.fillStyle = hex(sw.dark);
        rr(ctx, 7, 6, w - 14, h - 18, 9);
        ctx.fill();
        ctx.globalAlpha = 1;
        const bolt = (bx: number, by: number) => {
          ctx.fillStyle = "rgba(14,10,34,0.42)";
          ctx.beginPath();
          ctx.arc(bx, by + 0.9, 2.9, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#d3dcf2";
          ctx.beginPath();
          ctx.arc(bx, by, 2.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#7c8bb0";
          ctx.beginPath();
          ctx.arc(bx + 0.3, by + 0.4, 1.2, 0, Math.PI * 2);
          ctx.fill();
        };
        bolt(13, 12);
        bolt(w - 13, 12);
        bolt(13, h - 17);
        bolt(w - 13, h - 17);
      }
      ctx.strokeStyle = hex(sw.dark);
      ctx.globalAlpha = raised ? 0.55 : 0.75;
      ctx.lineWidth = 2;
      rr(ctx, 2, 2, w - 4, h - 8, 12);
      ctx.stroke();
      ctx.globalAlpha = 1;
      // The bezel: one lit hairline just inside the rim. Same job it does on the buttons — it
      // turns a gradient in a rounded box into a plate seated in a frame.
      ctx.strokeStyle = "#ffffff";
      ctx.globalAlpha = raised ? 0.3 : 0.18;
      ctx.lineWidth = 1.2;
      rr(ctx, 4, 4, w - 8, h - 12, 10);
      ctx.stroke();
      ctx.globalAlpha = 1;
    };
    bake(scene, K.tray(c, true), L.cell, L.cell, (ctx, w, h) => trayFace(ctx, w, h, true));
    bake(scene, K.tray(c, false), L.cell, L.cell, (ctx, w, h) => trayFace(ctx, w, h, false));
    // The x2 tray spans two cells and carries twice the eggs, so the size of the thing you
    // are about to dump on the belt is legible before you read the badge.
    const ww = L.cell + CELL_PITCH;
    bake(scene, K.trayWide(c, true), ww, L.cell, (ctx, w, h) => trayFace(ctx, w, h, true, 2));
    bake(scene, K.trayWide(c, false), ww, L.cell, (ctx, w, h) => trayFace(ctx, w, h, false, 2));

    // Box: the docking bay the asteroids are landed in. Two variants — sealed, and the active one
    // with its sockets open. Only the top box of a column is ever drawn open.
    const bw = L.box.w;
    const bh = L.box.h;
    const drawBody = (ctx: CanvasRenderingContext2D) => {
      ctx.fillStyle = hex(sw.dark);
      rr(ctx, 1, 3, bw - 2, bh - 3, 10);
      ctx.fill();
      // ⚠ The light stop runs to 0.7, not 0.35, and the inner stroke is softer than the tray's.
      // A box is a flat bar and a tray is nine lit rocks with a highlight on each, so the same
      // swatch drawn the same way reads *darker* on the box — measured over the whole sprite,
      // orange came out #ff8e1a against the tray's #fc9d39. Reported from real play as the box
      // orange being darker than the tray orange, and the palette was identical: the rocks were
      // doing it. Match the mean lightness rather than the stops.
      const g = ctx.createLinearGradient(0, 0, 0, bh);
      g.addColorStop(0, hex(sw.light));
      g.addColorStop(0.7, hex(sw.base));
      g.addColorStop(1, hex(sw.base));
      ctx.fillStyle = g;
      rr(ctx, 1, 1, bw - 2, bh - 6, 10);
      ctx.fill();
      ctx.strokeStyle = hex(sw.dark);
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 2;
      rr(ctx, 2, 2, bw - 4, bh - 7, 9);
      ctx.stroke();
      ctx.globalAlpha = 1;

      // The bay's end plates, bolted on, one at each end.
      //
      // ⚠ **Steel on every colour, and 6px wide, and neither is a style choice.** Neutral,
      // because these are the only part of a box that does not change with the swatch, and a
      // column of five reading as one rack of hardware is what tells the player the stack is a
      // queue rather than five loose bars. 6px, because the outermost socket already reaches
      // bw/2 + HOLE_STEP + HOLE_R — about 90 of 100 — so anything wider is drawn across a hole
      // a marble has to land in.
      const cap = (x: number) => {
        ctx.fillStyle = "rgba(16,12,38,0.32)";
        rr(ctx, x, 6, 6, bh - 15, 3);
        ctx.fill();
        ctx.fillStyle = "rgba(222,230,250,0.5)";
        rr(ctx, x, 5, 6, bh - 15, 3);
        ctx.fill();
        ctx.fillStyle = "rgba(28,24,58,0.4)";
        ctx.beginPath();
        ctx.arc(x + 3, 10, 1.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x + 3, bh - 14, 1.5, 0, Math.PI * 2);
        ctx.fill();
      };
      cap(2);
      cap(bw - 8);

      // A lit seam along the top lip — the bay's own guide light, in its own colour. It is the
      // edge the marbles cross, and it is the only part of a sealed box that says the thing is
      // powered rather than parked.
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = hex(sw.light);
      rr(ctx, 12, 3, bw - 24, 2.4, 1.2);
      ctx.fill();
      ctx.globalAlpha = 1;
    };
    bake(scene, K.box(c), bw, bh, drawBody);
    bake(scene, K.boxOpen(c), bw, bh, (ctx) => {
      drawBody(ctx);
      const hr = HOLE_R;
      for (let i = 0; i < BOX_SLOTS; i++) {
        const cx = bw / 2 + (i - (BOX_SLOTS - 1) / 2) * HOLE_STEP;
        const cy = bh / 2 - 2;
        // Collar, then a shaft that darkens with depth, then a lit arc along the *lower* wall —
        // which is the wall a light coming from up-left actually reaches once the hole is
        // recessed. Put that arc on the top edge instead and the socket inverts into a bubble.
        ctx.fillStyle = hex(sw.dark);
        ctx.beginPath();
        ctx.arc(cx, cy, hr, 0, Math.PI * 2);
        ctx.fill();
        const sg = ctx.createRadialGradient(cx - hr * 0.35, cy - hr * 0.45, 1, cx, cy + 1, hr);
        sg.addColorStop(0, "rgba(14,11,32,0.72)");
        sg.addColorStop(1, "#06050f");
        ctx.fillStyle = sg;
        ctx.beginPath();
        ctx.arc(cx, cy + 1, hr - 1.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.8;
        ctx.strokeStyle = hex(sw.light);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(cx, cy + 0.5, hr - 2.4, Math.PI * 0.14, Math.PI * 0.86);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    });
  });

  // The clip joining a linked pair. Drawn as its own small sprite between the two trays rather
  // than baked into a double-width face: a pair carries two colours, and baking every
  // combination would be PALETTE² textures at boot for a thing 18px wide.
  /**
   * ⚠ **Dark on the tray, not tinted with it.** The tray underneath is a locked one, so it is
   * already wearing the flat face, and a chevron in the tray's own colour on a tray's own colour
   * is the one combination that disappears at arm's length — the same trap the box-clear burst
   * fell into on a white cabinet. Ink and white read on all seven.
   */
  bake(scene, K.arrow, 34, 34, (ctx, w) => {
    const r = w / 2;
    const stroke = (color: string, dy: number, width: number) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(r, r + 9 + dy);
      ctx.lineTo(r, r - 7 + dy);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(r - 7, r - 2 + dy);
      ctx.lineTo(r, r - 9.5 + dy);
      ctx.lineTo(r + 7, r - 2 + dy);
      ctx.stroke();
    };
    // ⚠ **A shadow under it, not a disc behind it.** White alone is the request and white alone is
    // unreadable on the pale half of the palette — yellow and cyan trays are nearly white
    // themselves, and this sits on the *flat* face, which is the tray's own colour with no eggs to
    // break it up. So the arrow stays purely white and the contrast comes from underneath: one
    // darker pass, offset down and drawn fatter, which reads as depth on the dark swatches and as
    // an outline on the light ones. Same trick as the eggs on `trayFace`.
    ctx.globalAlpha = 0.4;
    stroke("#101a30", 2, 8.5);
    ctx.globalAlpha = 1;
    stroke("#ffffff", 0, 5);
  });

  bake(scene, K.link, 22, 30, (ctx, w, h) => {
    ctx.fillStyle = hex(UI.machineEdge);
    rr(ctx, 0, 0, w, h, 7);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    rr(ctx, 2, 2, w - 4, h - 7, 5);
    ctx.fill();
    ctx.fillStyle = hex(UI.panelDeep);
    rr(ctx, 6, 8, w - 12, h - 16, 3);
    ctx.fill();
  });

  // A tile whose colour is still unknown. Cannot be tapped, so it reads as inert: raw slate with
  // the dust still on it, no swatch and no rocks showing.
  bake(scene, K.trayHidden, L.cell, L.cell, (ctx, w, h) => {
    ctx.fillStyle = "#3a4157";
    rr(ctx, 1, 4, w - 2, h - 4, 13);
    ctx.fill();
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#7d89a3");
    g.addColorStop(1, "#5e6885");
    ctx.fillStyle = g;
    rr(ctx, 1, 1, w - 2, h - 7, 13);
    ctx.fill();
    // ⚠ Still a **blue** slate, not neutralised to grey by the reskin. `PALETTE` has a grey in it
    // and the note there says in as many words that this tile is what a grey tray has to stay
    // clear of. The dust and the craters are the reskin; the hue is load-bearing.
    ctx.save();
    rr(ctx, 3, 3, w - 6, h - 11, 11);
    ctx.clip();
    starfield(ctx, 0, 0, w, h, seeded(9001), 16);
    craters(ctx, w * 0.3, h * 0.68, 13, seeded(9002), 3, "#2f3545", "#a3aec1");
    ctx.restore();
    ctx.fillStyle = "#e6ecf9";
    ctx.font = `700 ${Math.round(h * 0.52)}px "Lilita One", Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("?", w / 2, h / 2 - 1);
  });

  // Empty grid slot.
  bake(scene, K.cell, L.cell, L.cell, (ctx, w, h) => {
    ctx.fillStyle = hex(UI.cell);
    rr(ctx, 2, 2, w - 4, h - 4, 12);
    ctx.fill();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    rr(ctx, 3, 3, w - 6, h - 6, 11);
    ctx.stroke();
    ctx.globalAlpha = 1;
  });

  // The hatch. It is a machine part, not a tile: a housing with a roller shutter across the
  // bottom, and the count on its face is how many trays are still behind the door. Trays are
  // pushed out from under the shutter into the cell below, so the door has to read as a door.
  bake(scene, K.dispenser, L.cell, L.cell, (ctx, w, h) => {
    const doorTop = h - 21;
    ctx.fillStyle = "#2f3a4f";
    rr(ctx, 1, 3, w - 2, h - 3, 13);
    ctx.fill();

    // Housing face, lit from above.
    const g = ctx.createLinearGradient(0, 0, 0, doorTop);
    g.addColorStop(0, "#b6cbec");
    g.addColorStop(1, "#7f99c6");
    ctx.fillStyle = g;
    rr(ctx, 2, 2, w - 4, doorTop - 2, 12);
    ctx.fill();
    ctx.strokeStyle = "#61789f";
    ctx.lineWidth = 2;
    rr(ctx, 3, 3, w - 6, doorTop - 4, 11);
    ctx.stroke();

    // Rails either side of the opening.
    ctx.fillStyle = "#5a6c8c";
    rr(ctx, 3, doorTop - 4, 6, 22, 3);
    ctx.fill();
    rr(ctx, w - 9, doorTop - 4, 6, 22, 3);
    ctx.fill();

    // Roller shutter: slats, then a heavier lip along the bottom edge.
    ctx.fillStyle = "#3d4a63";
    rr(ctx, 7, doorTop - 2, w - 14, 20, 5);
    ctx.fill();
    ctx.strokeStyle = "#55658a";
    ctx.lineWidth = 1.6;
    for (let k = 0; k < 3; k++) {
      const y = doorTop + 2.5 + k * 5;
      ctx.beginPath();
      ctx.moveTo(10, y);
      ctx.lineTo(w - 10, y);
      ctx.stroke();
    }
    ctx.fillStyle = "#26303f";
    rr(ctx, 6, h - 8, w - 12, 6, 3);
    ctx.fill();
  });

  // Belt tread. One sprite per cleat, because the tread has to travel with the marbles —
  // baked into the housing it would sit still and the marbles would read as sliding along a
  // dead track instead of being carried by a moving belt.
  ([true, false] as const).forEach((light) => {
    // Sized just under a marble so a seated marble covers its hole exactly, the way it does
    // on the reference machine.
    bake(scene, K.cleat(light), 30, 32, (ctx, w, h) => {
      ctx.fillStyle = hex(light ? UI.beltLight : UI.beltDeep);
      ctx.beginPath();
      ctx.ellipse(w / 2, h / 2, 10.2, 11, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = light ? 0.2 : 0.32;
      ctx.fillStyle = light ? "#ffffff" : hex(UI.belt);
      ctx.beginPath();
      ctx.ellipse(w / 2, h / 2 - 2, 7.3, 7.6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    });
  });

  // A boulder: the one thing on the board the player can do nothing about. Raw, uncut rock among
  // all that machined plate, so it reads as "not part of the puzzle" at a glance — the same job
  // the wooden crate did before the rig went to space, said in the new material.
  //
  // ⚠ **Its lightness is the separator from the `brown` swatch.** Brown was added to `PALETTE`
  // knowing it collides with this tile, and the argument written there is that the two sit in
  // different bands of lightness and that this one carries texture a tray face does not. So: kept
  // dark, kept dusty, and given a hard fracture across it. A boulder rendered as a smooth
  // mid-tone lump is a brown tray with the rocks rubbed off, which is exactly the mistake that
  // costs a player a move rather than just a sort.
  bake(scene, K.crate, L.cell, L.cell, (ctx, w, h) => {
    ctx.fillStyle = "#231c30";
    rockPath(ctx, w / 2, h / 2 + 2, w / 2 - 2, seeded(777), 11, 0.2);
    ctx.fill();
    const g = ctx.createRadialGradient(w * 0.36, h * 0.32, 3, w / 2, h / 2, w * 0.62);
    g.addColorStop(0, "#7c7490");
    g.addColorStop(0.5, "#514a68");
    g.addColorStop(1, "#2c2540");
    ctx.fillStyle = g;
    rockPath(ctx, w / 2, h / 2, w / 2 - 3.5, seeded(777), 11, 0.2);
    ctx.fill();
    ctx.save();
    rockPath(ctx, w / 2, h / 2, w / 2 - 3.5, seeded(777), 11, 0.2);
    ctx.clip();
    craters(ctx, w / 2, h / 2, w / 2 - 3.5, seeded(778), 7, "#221b31", "#9a93ad");
    // The fracture: one dark split across the face with a lit lip above it. This is the detail
    // that stops the boulder reading as a very dark tray.
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = "#0f0b1a";
    ctx.lineWidth = 3.4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(w * 0.17, h * 0.37);
    ctx.lineTo(w * 0.42, h * 0.52);
    ctx.lineTo(w * 0.34, h * 0.69);
    ctx.lineTo(w * 0.6, h * 0.81);
    ctx.stroke();
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = "#b3aac6";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(w * 0.17, h * 0.37 - 1.6);
    ctx.lineTo(w * 0.42, h * 0.52 - 1.6);
    ctx.lineTo(w * 0.34, h * 0.69 - 1.6);
    ctx.lineTo(w * 0.6, h * 0.81 - 1.6);
    ctx.stroke();
    ctx.globalAlpha = 1;
    starfield(ctx, 0, 0, w, h, seeded(779), 6);
    ctx.restore();
  });

  // A box whose colour has not been revealed yet: the bay is there, the guide lights are not lit.
  bake(scene, K.boxHidden, L.box.w, L.box.h, (ctx, w, h) => {
    ctx.fillStyle = "#333a52";
    rr(ctx, 1, 3, w - 2, h - 3, 10);
    ctx.fill();
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#7b86a4");
    g.addColorStop(1, "#535d78");
    ctx.fillStyle = g;
    rr(ctx, 1, 1, w - 2, h - 6, 10);
    ctx.fill();
    ctx.save();
    rr(ctx, 2, 2, w - 4, h - 8, 9);
    ctx.clip();
    starfield(ctx, 0, 0, w, h, seeded(4242), 20);
    ctx.restore();
    ctx.fillStyle = "#e8eefa";
    ctx.font = `700 ${Math.round(h * 0.62)}px "Lilita One", Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("?", w / 2, h / 2 - 2);
  });

  // The x2 bar. Bolted across two cells, and everything standing above it drops double —
  // so it is drawn as hardware, not as a tile.
  const barW = L.cell + CELL_PITCH;
  bake(scene, K.bar, barW, 30, (ctx, w, h) => {
    ctx.fillStyle = "#2f7a2f";
    rr(ctx, 1, 4, w - 2, h - 4, 9);
    ctx.fill();
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#8ae06a");
    g.addColorStop(1, "#4bb43f");
    ctx.fillStyle = g;
    rr(ctx, 1, 1, w - 2, h - 7, 9);
    ctx.fill();
    ctx.strokeStyle = "#2f7a2f";
    ctx.lineWidth = 2;
    rr(ctx, 3, 3, w - 6, h - 11, 7);
    ctx.stroke();
  });

  // The chocolate box: a 2x2 slab with a dial. The four trays it hides only join the board once
  // the dial reaches zero.
  //
  // ⚠ Drawn as **chocolate**, not as a chrome plate. The plate version was the same shape in the
  // machine's own two tones, and against a white cavity floor it read as a piece of the cabinet —
  // a panel that happened to have a number on it — rather than as something sitting *on* the
  // board waiting to be broken. Every other obstacle here says what it is by its material (the
  // crate is wood, the hatch is a shutter), and this one has to as well.
  const lidW = L.cell + CELL_PITCH;
  bake(scene, K.lid, lidW, lidW, (ctx, w, h) => {
    // The dark underside, so the slab sits proud of the floor rather than lying flat on it.
    ctx.fillStyle = "#3d2412";
    rr(ctx, 2, 6, w - 4, h - 6, 16);
    ctx.fill();
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#8a5a2f");
    g.addColorStop(1, "#5d3618");
    ctx.fillStyle = g;
    rr(ctx, 2, 2, w - 4, h - 10, 16);
    ctx.fill();
    // Moulded squares — four of them, one per tray underneath, which is also the count the box
    // is standing in for.
    const pad = 12;
    const cell = (w - pad * 3) / 2;
    for (let i = 0; i < 4; i++) {
      const x = pad + (i % 2) * (cell + pad);
      const y = pad + ((i / 2) | 0) * (cell + pad) - 4;
      ctx.fillStyle = "rgba(255,225,190,0.16)";
      rr(ctx, x, y, cell, cell, 7);
      ctx.fill();
      ctx.strokeStyle = "rgba(45,25,10,0.45)";
      ctx.lineWidth = 3;
      rr(ctx, x, y, cell, cell, 7);
      ctx.stroke();
    }
  });

  // The ribbons — two bands crossing the slab, the way a box of chocolates is tied.
  //
  // ⚠ **The ribbon is the rule, not decoration.** Its colour is the colour that counts toward
  // opening the box, so it has to be the loudest thing on the piece after the number. A single
  // colour on both bands means only that colour counts; a rainbow band means any tray does.
  // Drawn as a cross rather than as a rim because a rim reads as "a tray of this colour" — the
  // box would look like one more tile in the row — while a ribbon plainly wraps something.
  const RIB = 18;
  const ribbon = (key: string, paint: (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) => void) =>
    bake(scene, key, lidW, lidW, (ctx, w, h) => {
      // Vertical band, then horizontal, then a shadow line under each so they sit on the slab
      // rather than being painted onto it.
      paint(ctx, (w - RIB) / 2, 0, RIB, h);
      paint(ctx, 0, (h - RIB) / 2 - 2, w, RIB);
      ctx.fillStyle = "rgba(30,16,6,0.28)";
      ctx.fillRect((w - RIB) / 2 - 3, 0, 3, h);
      ctx.fillRect(0, (h - RIB) / 2 - 5, w, 3);
    });
  ribbon(K.lidRibbon(null), (ctx, x, y, w, h) => {
    // Every colour along the band's length, so "any colour counts" is legible without a legend.
    const along = w > h;
    const g = ctx.createLinearGradient(x, y, along ? x + w : x, along ? y : y + h);
    PALETTE.forEach((sw, i) => g.addColorStop(i / Math.max(1, PALETTE.length - 1), hex(sw.base)));
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
  });
  PALETTE.forEach((sw, c) =>
    ribbon(K.lidRibbon(c), (ctx, x, y, w, h) => {
      ctx.fillStyle = hex(sw.base);
      ctx.fillRect(x, y, w, h);
      // A highlight down the middle of the band, so it reads as satin rather than as a painted
      // stripe. Along the band's own axis, or it would look like a seam across it.
      ctx.fillStyle = hex(sw.light);
      if (w > h) ctx.fillRect(x, y + 3, w, 4);
      else ctx.fillRect(x + 3, y, 4, h);
    }),
  );

  // The counter's backing. Cream and plain: the ribbon already carries the colour, and a second
  // coloured ring around the number would say the same thing twice and crowd a 30px disc.
  const ringR = 30;
  bake(scene, K.lidDial, ringR * 2, ringR * 2, (ctx) => {
    ctx.fillStyle = "rgba(40,22,10,0.35)";
    ctx.beginPath();
    ctx.arc(ringR, ringR + 2, ringR - 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#f7f1e4";
    ctx.beginPath();
    ctx.arc(ringR, ringR, ringR - 2, 0, Math.PI * 2);
    ctx.fill();
  });

  bakeEffects(scene);
  bakeChrome(scene);
}

/** Sparkle, shockwave, sunburst and glow — everything the celebration is built from. */
function bakeEffects(scene: Phaser.Scene) {
  // Four-point twinkle. Drawn as two crossed tapers rather than a star polygon so the arms
  // stay needle-thin when it is scaled up.
  bake(scene, K.spark, 40, 40, (ctx, w, h) => {
    const cx = w / 2;
    const cy = h / 2;
    const arm = (rot: number, len: number, wide: number) => {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rot);
      const g = ctx.createLinearGradient(0, -len, 0, len);
      g.addColorStop(0, "rgba(255,255,255,0)");
      g.addColorStop(0.5, "#ffffff");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(0, -len);
      ctx.quadraticCurveTo(wide, 0, 0, len);
      ctx.quadraticCurveTo(-wide, 0, 0, -len);
      ctx.fill();
      ctx.restore();
    };
    arm(0, 19, 3.6);
    arm(Math.PI / 2, 19, 3.6);
    arm(Math.PI / 4, 11, 2.2);
    arm(-Math.PI / 4, 11, 2.2);
  });

  /**
   * The tutorial's pointing hand.
   *
   * ⚠ Baked, not an emoji or a font glyph. `LilitaOne.ttf` here is a Latin-only subset and the
   * canvas fallback for a pictograph is whatever the OS happens to have — a different shape on
   * every device, and nothing at all on some Androids. A drawn hand is the same hand everywhere.
   *
   * ⚠ Outlined in ink, like every other piece: it has to sit legibly on the white cabinet *and*
   * on a saturated tray, and a plain white hand vanishes against the first.
   */
  // The pointing hand every coach mark travels on.
  //
  // ⚠ **Two details carry the whole drawing, and three earlier versions failed for want of them.**
  // A finger rising out of a fist is the rude gesture — reported off a real screen, twice, and
  // correctly, because that is the silhouette. What separates a *pointing* hand from it is:
  //
  //   1. **The thumb protrudes**, as its own rounded lobe clear of the palm with a crease where it
  //      folds across. A bump tucked flat against the side is not enough — that shipped, and still
  //      read wrong.
  //   2. **The three folded fingers are separate humps** with creases between them. Smoothed into
  //      one curve, what is left is a fist with one finger out, whatever else is added.
  //
  // Drawn side by side at 6x, 2x and 1x, a version missing either one reverts. Both are load-bearing.
  //
  // ⚠ The **fingertip sits on the sprite's horizontal centre** (x = 43 of 86), which is why the
  // canvas is wider than the drawing needs and carries dead margin on the left. Every call site
  // places this by an offset from the thing it points at, so an off-centre tip would silently
  // re-aim the level-1 walkthrough and the magnet lesson together — a change to what the player is
  // told to touch, made from inside a drawing routine. Pad the canvas; never move the tip.
  bake(scene, K.hand, 86, 70, (ctx) => {
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.lineWidth = 4;
    ctx.strokeStyle = UI.ink;
    ctx.fillStyle = "#ffffff";

    ctx.beginPath();
    ctx.moveTo(36, 36);
    ctx.lineTo(36, 12);                       // index finger, left side
    ctx.quadraticCurveTo(36, 4, 43, 4);       // the tip — on the sprite's centre line
    ctx.quadraticCurveTo(50, 4, 50, 12);
    ctx.lineTo(50, 26);                       // index finger, right side
    ctx.quadraticCurveTo(50, 21, 56, 21);     // folded finger 1
    ctx.quadraticCurveTo(62, 21, 62, 28);
    ctx.quadraticCurveTo(62, 24, 68, 24);     // folded finger 2
    ctx.quadraticCurveTo(74, 24, 74, 31);
    ctx.quadraticCurveTo(74, 28, 78, 29);     // folded finger 3
    ctx.quadraticCurveTo(82, 31, 82, 37);
    ctx.lineTo(82, 48);                       // outside of the palm
    ctx.quadraticCurveTo(82, 64, 64, 64);
    ctx.lineTo(48, 64);
    ctx.quadraticCurveTo(37, 64, 34, 54);     // heel
    ctx.lineTo(31, 50);
    ctx.quadraticCurveTo(20, 50, 19, 42);     // the thumb, out clear of the palm
    ctx.quadraticCurveTo(18, 34, 28, 33);
    ctx.quadraticCurveTo(34, 33, 36, 36);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // The creases: two between the folded fingers, one where the thumb folds across the palm.
    // Without them the right side is one smooth lump and the left side is a mitten.
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(62, 29);
    ctx.lineTo(62, 40);
    ctx.moveTo(74, 32);
    ctx.lineTo(74, 43);
    ctx.moveTo(33, 38);
    ctx.quadraticCurveTo(39, 45, 40, 54);
    ctx.stroke();
  });

  // Expanding shockwave for a marble seating in its hole.
  bake(scene, K.ring, 64, 64, (ctx, w) => {
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 5;
    ctx.globalAlpha = 0.95;
    ctx.beginPath();
    ctx.arc(w / 2, w / 2, w / 2 - 5, 0, Math.PI * 2);
    ctx.stroke();
  });

  // Sunburst behind the win panel; it is slowly rotated in the scene.
  bake(scene, K.rays, 520, 520, (ctx, w) => {
    const cx = w / 2;
    const n = 16;
    // All wedges as one path, filled with a radial fade. Flat wedges have a hard outer edge
    // and read as cut paper; light has to fall off, and additive blending only sells it if
    // there is real brightness near the middle to add.
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const spread = Math.PI / n / 1.6;
      ctx.moveTo(cx, cx);
      ctx.lineTo(cx + Math.cos(a - spread) * cx, cx + Math.sin(a - spread) * cx);
      ctx.lineTo(cx + Math.cos(a + spread) * cx, cx + Math.sin(a + spread) * cx);
      ctx.closePath();
    }
    const rg = ctx.createRadialGradient(cx, cx, cx * 0.05, cx, cx, cx);
    rg.addColorStop(0, "rgba(255,255,255,1)");
    rg.addColorStop(0.45, "rgba(255,255,255,0.55)");
    rg.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = rg;
    ctx.fill();
  });

  // Soft radial glow, used behind the machine and to punch a star pop.
  bake(scene, K.flash, 160, 160, (ctx, w) => {
    const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    g.addColorStop(0, "rgba(255,255,255,0.95)");
    g.addColorStop(0.45, "rgba(255,255,255,0.35)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, w);
  });
}

function bakeChrome(scene: Phaser.Scene) {
  // Every button in the game is this: a bezel, a lit hairline inside it, a panel, one gloss.
  //
  // ⚠ **The hairline is what makes these read as hardware.** Without it the control is a gradient
  // in a rounded box — the thing a web page draws — and at 46px on a phone that is a swatch, not a
  // switch. One lit line just inside the edge turns it into a panel seated in a frame, and it
  // costs nothing on any of the faces because it is white at low alpha rather than a colour that
  // would have to be picked per button.
  const face = (
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    top: string,
    bot: string,
    edge: string,
    r: number,
  ) => {
    ctx.fillStyle = edge;
    rr(ctx, 1, 4, w - 2, h - 4, r);
    ctx.fill();
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, top);
    g.addColorStop(1, bot);
    ctx.fillStyle = g;
    rr(ctx, 1, 1, w - 2, h - 7, r);
    ctx.fill();
    ctx.globalAlpha = 0.45;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.3;
    rr(ctx, 3.6, 3.6, w - 7.2, h - 12.2, Math.max(2, r - 3));
    ctx.stroke();
    ctx.globalAlpha = 1;
    // ⚠ The gloss keeps its exact weight and box. Three of these faces were measured against the
    // HUD's other pills for mean brightness — see the notes on `purpleSq` and `greenOff` — and
    // this rect is a term in every one of those numbers.
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = "#ffffff";
    rr(ctx, 6, 5, w - 12, h * 0.3, r * 0.6);
    ctx.fill();
    ctx.globalAlpha = 1;
  };

  const S = L.boostSize;
  bake(scene, K.btn("green"), S, S, (ctx, w, h) =>
    face(ctx, w, h, "#7fe06a", "#3fb43f", "#2c8330", 17),
  );
  // ⚠ The "not yet" face, and it is **muted green, not grey**. It used to be #a9b5a9 → #7e8a7e,
  // whose top edge reads as off-white — and this is the state the button spends most of a level in,
  // because with a magnet in hand it greys whenever the belt has no plan for one, which is nearly
  // always true at the start of a board. Reported as "the button is green but the background is
  // still white": the white *was* this face. Darker and less saturated than the live face, so it
  // still reads as unavailable, but it is recognisably the same control rather than a pale disc.
  bake(scene, K.btn("greenOff"), S, S, (ctx, w, h) =>
    face(ctx, w, h, "#5f9c62", "#40734a", "#2b4d35", 17),
  );
  // ⚠ The middle stop comes from `UI.pill`, not from a literal beside the other two. The booster's
  // mount is drawn in that same token on a phone, and two hexes that have to stay equal are two
  // hexes that will not.
  bake(scene, K.btn("purple"), 120, 46, (ctx, w, h) =>
    face(ctx, w, h, "#a596f2", hex(UI.pill), "#5b48ab", 20),
  );
  // The booster's face on a phone, where it stands in a row of purple pills rather than out on the
  // violet. It has to read as bright as the level pill beside it, and these three stops are what
  // measures that way — the pill's own ramp lifted **half a step**.
  //
  // ⚠ **The pill's exact stops are not the answer, and that is not obvious.** Brightness is read
  // over the whole control, and a magnet covering half of a 56px square is a lot of dark where the
  // pill's thin lettering is almost none. Measured as the mean over each control, against the pill's
  // 169/255: the pill's own ramp gives 160, a full step up gives 177-182, half a step gives 168-171.
  // ⚠ So do not "tidy" this back to `UI.pill` and the pill's neighbours. It would look like removing
  // a duplicate and it is the one thing that has already been tried and reported from a real phone
  // as the button being too dark.
  // ⚠ **There is no muted twin and nothing dims this face** — see `GameScene.boosterBtn` and the
  // note on the locked alpha in `refreshHud`. Dimming is how "not yet" and "locked" are said out on
  // the violet; in a bright row a dimmed square reads as the one control that failed to draw.
  bake(scene, K.btn("purpleSq"), S, S, (ctx, w, h) =>
    face(ctx, w, h, "#b7a9f8", "#9280e6", "#6d59c2", 17),
  );
  bake(scene, K.btn("gold"), 46, 46, (ctx, w, h) =>
    face(ctx, w, h, "#ffd964", "#f5a91a", "#c67a06", 14),
  );
  bake(scene, K.btn("wide"), 260, 76, (ctx, w, h) =>
    face(ctx, w, h, "#7fe06a", "#3fb43f", "#2c8330", 24),
  );
  bake(scene, K.btn("wideBlue"), 260, 76, (ctx, w, h) =>
    face(ctx, w, h, "#8fb6ff", "#4a7de0", "#2c53a3", 24),
  );

  // Booster icons, drawn as paths so they scale with the buttons and cost no bytes.
  bake(scene, K.icon("magnet"), 44, 44, (ctx) => {
    ctx.lineCap = "butt";
    ctx.lineWidth = 11;
    ctx.strokeStyle = "#e33b3b";
    ctx.beginPath();
    ctx.arc(22, 24, 13, Math.PI, 0);
    ctx.stroke();
    ctx.strokeStyle = "#dfe6f5";
    ctx.beginPath();
    ctx.moveTo(9, 24);
    ctx.lineTo(9, 34);
    ctx.moveTo(35, 24);
    ctx.lineTo(35, 34);
    ctx.stroke();
  });

  bake(scene, K.icon("wrench"), 44, 44, (ctx) => {
    ctx.save();
    ctx.translate(22, 22);
    ctx.rotate(-Math.PI / 4);
    ctx.fillStyle = "#f5a623";
    ctx.fillRect(-4.5, -14, 9, 28);
    ctx.beginPath();
    ctx.arc(0, -14, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 14, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.arc(0, -14, 3.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 14, 3.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });

  bake(scene, K.icon("undo"), 44, 44, (ctx) => {
    ctx.strokeStyle = "#dfe6f5";
    ctx.lineWidth = 7;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(22, 24, 12, Math.PI * 0.85, Math.PI * 2.25);
    ctx.stroke();
    ctx.fillStyle = "#dfe6f5";
    ctx.beginPath();
    ctx.moveTo(4, 16);
    ctx.lineTo(20, 14);
    ctx.lineTo(11, 27);
    ctx.closePath();
    ctx.fill();
  });

  bake(scene, K.icon("gear"), 40, 40, (ctx) => {
    ctx.fillStyle = "#f3f6fc";
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const b = a + Math.PI / 8;
      ctx.lineTo(20 + Math.cos(a) * 18, 20 + Math.sin(a) * 18);
      ctx.lineTo(20 + Math.cos(b) * 18, 20 + Math.sin(b) * 18);
      const c = b + Math.PI / 16;
      ctx.lineTo(20 + Math.cos(c) * 12, 20 + Math.sin(c) * 12);
    }
    ctx.closePath();
    ctx.fill();
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.arc(20, 20, 6.5, 0, Math.PI * 2);
    ctx.fill();
  });

  const starPath = (ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) => {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rad = i % 2 ? r * 0.45 : r;
      ctx.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
    }
    ctx.closePath();
  };
  bake(scene, K.star(true), 52, 52, (ctx) => {
    starPath(ctx, 26, 26, 24);
    ctx.fillStyle = "#ffc21e";
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#c67a06";
    ctx.stroke();
  });
  bake(scene, K.star(false), 52, 52, (ctx) => {
    starPath(ctx, 26, 26, 24);
    ctx.fillStyle = "#7c88a6";
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#5a6480";
    ctx.stroke();
  });

  // The daily-reward calendar. Same construction as everything else here — flat blocks of colour
  // with one darker edge underneath, no gradients past a single highlight, so it sits beside the
  // trays and the boxes rather than looking imported from another game.
  //
  // ⚠ A **tear-off** calendar: rings across the top and a red header. A plain rounded square with
  // a coin on it is a wallet, not a day, and the whole point of the icon is that it means "today".
  bake(scene, K.calendar, 64, 64, (ctx) => {
    ctx.fillStyle = "#c2410c";
    rr(ctx, 6, 12, 52, 48, 10);
    ctx.fill();
    ctx.fillStyle = "#f97316";              // red header band
    rr(ctx, 6, 12, 52, 18, 10);
    ctx.fill();
    ctx.fillStyle = "#fff7ed";              // the page
    rr(ctx, 9, 28, 46, 28, 7);
    ctx.fill();
    // Two rings biting over the header, which is what makes it read as a calendar at 40px.
    ctx.fillStyle = "#cbd5e1";
    for (const x of [22, 42]) {
      rr(ctx, x - 4, 5, 8, 16, 4);
      ctx.fill();
    }
    // A coin on the page — the reward, in the same gold as the wallet counter.
    ctx.fillStyle = "#c67a06";
    ctx.beginPath();
    ctx.arc(32, 43, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffc21e";
    ctx.beginPath();
    ctx.arc(32, 42, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffe07a";
    ctx.beginPath();
    ctx.arc(32, 42, 6, 0, Math.PI * 2);
    ctx.fill();
  });

  // Day seven. ⚠ Drawn open with coins spilling out rather than shut: a closed box is the
  // chocolate obstacle, which the player has been taught means "in your way".
  bake(scene, K.chest, 56, 48, (ctx) => {
    ctx.fillStyle = "#7c3f12";              // the body
    rr(ctx, 4, 20, 48, 26, 6);
    ctx.fill();
    ctx.fillStyle = "#a45a1c";
    rr(ctx, 7, 23, 42, 20, 4);
    ctx.fill();
    ctx.fillStyle = "#7c3f12";              // the lid, thrown back
    rr(ctx, 6, 4, 44, 14, 6);
    ctx.fill();
    ctx.fillStyle = "#a45a1c";
    rr(ctx, 9, 6, 38, 9, 4);
    ctx.fill();
    ctx.fillStyle = "#ffc21e";              // the coins, between lid and body
    for (const [x, y, r] of [[18, 20, 7], [30, 18, 8], [41, 21, 6]]) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#ffe07a";
    for (const [x, y, r] of [[18, 19, 3], [30, 17, 4], [41, 20, 3]]) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#ffd964";              // the clasp
    rr(ctx, 24, 26, 8, 10, 2);
    ctx.fill();
  });

  // The padlock on a locked daily-reward day.
  //
  // ⚠ Baked, not an emoji. A pictograph falls back to whatever the OS ships — a different shape on
  // every device and nothing at all on some Androids — and this one carries a rule ("you cannot
  // take this yet"), so it has to look the same everywhere the rule applies.
  bake(scene, K.lock, 34, 40, (ctx) => {
    ctx.strokeStyle = "#8fa6c4";            // the shackle, behind the body
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(17, 17, 9, Math.PI, 0);
    ctx.stroke();
    ctx.fillStyle = "#54708f";              // the body
    rr(ctx, 3, 16, 28, 22, 5);
    ctx.fill();
    ctx.fillStyle = "#8fa6c4";
    rr(ctx, 5, 18, 24, 18, 4);
    ctx.fill();
    ctx.fillStyle = "#39506c";               // the keyhole
    ctx.beginPath();
    ctx.arc(17, 25, 3.4, 0, Math.PI * 2);
    ctx.fill();
    rr(ctx, 15.4, 25, 3.2, 7, 1.4);
    ctx.fill();
  });

  bake(scene, K.coin, 34, 34, (ctx) => {
    ctx.fillStyle = "#c67a06";
    ctx.beginPath();
    ctx.arc(17, 17, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffc21e";
    ctx.beginPath();
    ctx.arc(17, 16, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffe07a";
    ctx.beginPath();
    ctx.arc(17, 16, 9, 0, Math.PI * 2);
    ctx.fill();
  });
}
