import type Phaser from "phaser";

/**
 * Take down the HTML boot poster in `index.html`.
 *
 * ⚠ **Every scene that can be the first one on screen has to call this**, not just Home. The
 * poster is a full-screen `div` at `z-index: 10`, so whatever fails to dismiss it does not
 * degrade — it covers the running game completely, and the player is left looking at a title
 * that pulses forever over a board they cannot see or touch.
 *
 * That is exactly what `?level=N` and `?custom=1` did: `main.ts` stops Home and starts Game
 * directly, so `HomeScene.create` — the only place that used to remove the poster — never ran.
 * Reported from a phone as "chỉ hiển thị AstroBall rồi mãi không play được", and it took the
 * request log to find, because every URL anyone tested from a desktop went to `/` and worked.
 * The editor's two "open the game" links are `?level=N` and `?custom=1`, so every hand-built
 * board previewed that way had been showing a dead poster too.
 *
 * Idempotent, so calling it from a scene that restarts costs nothing.
 */
/**
 * Paint the page behind the canvas.
 *
 * ⚠ Not decoration. Phaser's FIT scaler keeps the 540-wide design box's aspect, so on a 16:9 desktop
 * frame roughly three quarters of the window is page rather than canvas — the bars are the larger
 * surface, and a colour that disagrees with the scene reads as the game sitting in a hole.
 *
 * ⚠ Per scene, because the two screens do not share a background: Home is flat dark violet, the
 * board runs a gradient into a much lighter violet at its foot. One CSS value has to be wrong on one
 * of them, and the wrongness lands exactly where the eye checks — the corner where bar meets canvas.
 */
/**
 * The backdrop for the strip of page either side of the canvas.
 *
 * ⚠ **It is the majority of a desktop screen.** The design box is 540 wide against a 16:9 page, so
 * the canvas is about a quarter of the width and the other three quarters are this. A flat field
 * that size does not read as a background, it reads as a game that failed to fill its window.
 *
 * ⚠ Nothing here can make the game *bigger* — that is set by the design box's aspect and the
 * machine's own height, and the vertical budget was measured with no slack left in it. What this
 * does is make the space around it deliberate: a pool of light where the machine stands, falling
 * away to a darker edge, so the eye is sent to the middle instead of to the emptiness.
 *
 * ⚠ Costs nothing on a phone, where the canvas covers the width and none of it is visible.
 *
 * @param top    the colour at the head of the page
 * @param bottom the colour at its foot — pass the same value for a flat scene
 */
export function pageBackdrop(top: string, bottom: string): string {
  return [
    // Vignette first, so it is the topmost layer and darkens whatever the glow spills onto.
    "radial-gradient(ellipse 110% 85% at 50% 50%, rgba(0,0,0,0) 42%, rgba(9,7,30,0.55) 100%)",
    // The pool of light, centred a little above the middle where the board sits.
    "radial-gradient(ellipse 46% 62% at 50% 42%, rgba(255,255,255,0.13), rgba(255,255,255,0) 72%)",
    `linear-gradient(${top} 0%, ${bottom} 100%)`,
  ].join(", ");
}

export function setPageBackground(css: string): void {
  try {
    document.documentElement.style.background = css;
    document.body.style.background = css;
  } catch {
    /* no DOM — the headless sim never calls this */
  }
}

/**
 * How many colour stops the bar gradient carries. Twenty over a ~1000px page is a stop every 50px,
 * which is finer than any gradient the two scenes actually draw — the cost of another stop is a few
 * characters of CSS, and the cost of too few is a visible band.
 */
const EDGE_STOPS = 20;

/** How dark the far edges of the page go. Zero at the seam, so it can never reintroduce a step. */
const EDGE_ALPHA = 0.55;
const EDGE_CLEAR = "rgba(9,7,30,0)";

/**
 * Build the bar background out of colours read off the canvas's own edge.
 *
 * @param cols  one colour per stop, top of the canvas to its foot
 * @param b     where the canvas sits on the page, in page pixels
 */
function edgeBackdrop(
  cols: string[],
  b: { x: number; y: number; width: number; height: number },
  winW: number,
  winH: number,
): string {
  const pct = (v: number) => Math.max(0, Math.min(100, v)).toFixed(2);
  const top = (100 * b.y) / winH;
  const span = (100 * b.height) / winH;
  const stops = cols.map((c, i) => `${c} ${pct(top + (span * i) / (cols.length - 1))}%`);
  // ⚠ Hold the end colours out to the edges of the page. A canvas that does not reach them —
  // a portrait window, where the bars are above and below rather than beside — would otherwise
  // fade the last sampled colour into nothing over the strip the eye is actually looking at.
  stops.unshift(`${cols[0]} 0%`);
  stops.push(`${cols[cols.length - 1]} 100%`);
  const leftN = (100 * b.x) / winW;
  const rightN = (100 * (b.x + b.width)) / winW;
  const left = pct(leftN);
  const right = pct(rightN);
  // ⚠ **The shade is scaled to how much page there is to shade.** It exists to stop a field the
  // size of three quarters of a desktop window reading as emptiness — and at full strength across
  // a *narrow* bar it does the opposite: 0.55 alpha falling to nothing over 9px is not framing, it
  // is a hard dark stripe hugging the edge of the game. Reported from an iPhone 16 in the host's
  // frame as "sọc sọc", where the bars are 13px of a 393px screen and the seam moved 128/765 of
  // the colour range inside them. Full strength from a quarter of the width out; nothing at all
  // when the bar is a rounding error.
  const bar = Math.min(leftN, 100 - rightN) / 100;
  const shade = `rgba(9,7,30,${Math.min(EDGE_ALPHA, bar * 2.2).toFixed(3)})`;
  return [
    // ⚠ The vignette is **anchored to the canvas**, not to the middle of the page: transparent
    // from edge to edge of the canvas and only darkening outside it. Centred on the page instead
    // it lands some shade on the seam itself, which is the one place that has to match exactly.
    `linear-gradient(to right, ${shade} 0%, ${EDGE_CLEAR} ${left}%, ${EDGE_CLEAR} ${right}%, ${shade} 100%)`,
    `linear-gradient(to bottom, ${stops.join(", ")})`,
  ].join(", ");
}

/**
 * Paint the letterbox bars with the canvas's **own edge colours**, so the picture runs across the
 * seam instead of stopping at it.
 *
 * ⚠ **A colour written by hand cannot match, because the canvas edge is not one colour.** Measured
 * down the seam of a 1898x982 frame: Home runs #302e58 at the top, #423973 where the cover's glow
 * passes, #322d58 at the foot — and the board is worse, because `GameScene` draws a halo behind the
 * machine that no CSS gradient was imitating. The bar was out by up to 31/255 on Home and **114/255**
 * on the board, which is the hard vertical line either side of the game. Any single flat colour, and
 * any hand-tuned gradient, is wrong at some height; the only thing that is right at every height is
 * the canvas itself. So read it.
 *
 * ⚠ Sampled **after the first frame renders**, via the renderer's own snapshot — a WebGL canvas
 * cannot be read back on demand without `preserveDrawingBuffer`, which costs every frame of the
 * game to serve one read. `fallback` is what shows until the read lands, so it must be a sane
 * background in its own right, not a placeholder.
 *
 * ⚠ Costs nothing on a phone: the canvas covers the width, there are no bars, and the whole thing
 * returns before it snapshots anything.
 */
export function matchPageToCanvas(scene: Phaser.Scene, fallback: string): void {
  setPageBackground(fallback);
  const run = () => {
    try {
      if (typeof document === "undefined" || typeof window === "undefined") return;
      const cv = scene.game.canvas;
      const b = scene.scale.canvasBounds;
      const winW = window.innerWidth;
      const winH = window.innerHeight;
      if (!cv || !cv.height || !winW || !winH || b.width <= 0 || b.height <= 0) return;
      // The canvas already covers the window — there is no bar to paint.
      if (b.width >= winW - 1 && b.height >= winH - 1) return;
      const renderer = scene.game.renderer as { snapshotArea?: (...a: never[]) => unknown };
      if (typeof renderer.snapshotArea !== "function") return;
      // Three columns rather than one, averaged: the outermost is where a rounded canvas corner or
      // a half-covered device pixel lands, and one bad column would tint the whole bar.
      const strip = Math.min(3, cv.width);
      (
        renderer.snapshotArea as unknown as (
          x: number,
          y: number,
          w: number,
          h: number,
          cb: (img: unknown) => void,
        ) => void
      )(0, 0, strip, cv.height, (img) => {
        // ⚠ **Where the canvas sits is read here, not where the snapshot was asked for.** The
        // colours come back a frame or more later, and in between the canvas can have moved: this
        // runs from `create()`, one statement after `setGameSize`, and again on the trailing edge
        // of a resize the browser may not have laid out yet. Placing the bars against the box the
        // canvas had *before* all that puts the transparent window and the seam in different
        // places, and the strip between them is the one part of the page painted in canvas colours
        // with none of the shade — a light band hugging the game on both sides.
        const nb = scene.scale.canvasBounds;
        const w2 = window.innerWidth;
        const h2 = window.innerHeight;
        if (!w2 || !h2 || nb.width <= 0 || nb.height <= 0) return;
        // It grew to cover the window while we were waiting — there is no bar left to paint.
        if (nb.width >= w2 - 1 && nb.height >= h2 - 1) return;
        readStrip(img, nb, w2, h2);
      });
    } catch {
      /* no canvas, no WebGL, or a browser that refuses the read — the fallback stands */
    }
  };
  run();

  // A desktop window being resized changes both the seam's position and the colours behind it.
  // ⚠ Debounced through the scene's own clock and torn down on shutdown, or the listeners stack
  // up one per level and every resize fires a snapshot for each level ever played.
  let pending: Phaser.Time.TimerEvent | null = null;
  const again = () => {
    pending?.remove();
    pending = scene.time.delayedCall(180, run);
  };
  scene.scale.on("resize", again);
  scene.events.once("shutdown", () => {
    pending?.remove();
    scene.scale.off("resize", again);
  });
}

/** Turn the snapshot strip into a gradient and hang it on the page. */
function readStrip(
  img: unknown,
  b: { x: number; y: number; width: number; height: number },
  winW: number,
  winH: number,
): void {
  try {
    const src = img as HTMLImageElement;
    if (!src || !src.width || !src.height) return;
    const off = document.createElement("canvas");
    off.width = src.width;
    off.height = src.height;
    const ctx = off.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(src, 0, 0);
    const px = ctx.getImageData(0, 0, off.width, off.height).data;
    const cols: string[] = [];
    for (let i = 0; i < EDGE_STOPS; i++) {
      const y = Math.round((i / (EDGE_STOPS - 1)) * (off.height - 1));
      let r = 0;
      let g = 0;
      let bl = 0;
      for (let x = 0; x < off.width; x++) {
        const p = (y * off.width + x) * 4;
        r += px[p];
        g += px[p + 1];
        bl += px[p + 2];
      }
      const n = off.width;
      cols.push(`rgb(${Math.round(r / n)},${Math.round(g / n)},${Math.round(bl / n)})`);
    }
    setPageBackground(edgeBackdrop(cols, b, winW, winH));
  } catch {
    /* the fallback stands */
  }
}

export function dismissBootSplash(): void {
  const boot = document.getElementById("boot");
  if (!boot) return;
  boot.classList.add("hide");
  // Fade out first, then take the node out entirely rather than leaving an invisible
  // full-screen div sitting on top of the canvas swallowing taps.
  setTimeout(() => boot.remove(), 400);
}
