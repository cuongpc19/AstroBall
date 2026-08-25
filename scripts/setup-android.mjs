// Re-apply every hand-made tweak to the generated android/ folder, so that folder can
// stay OUT of git and still be rebuilt exactly: `npx cap add android` regenerates a
// stock project, then this script turns it back into ours.
//
// 1. LAUNCHER ICONS. The game ships no art files — every graphic is baked at runtime —
//    so the icon is drawn here as an SVG (a tube of marbles, the game's whole idea) and
//    rasterised by sharp. Per density bucket it writes:
//      ic_launcher.png            legacy square icon (rounded corners)
//      ic_launcher_round.png      legacy circular icon
//      ic_launcher_foreground.png adaptive-icon foreground (transparent, safe-zone sized)
//    plus drawable/ic_launcher_background.xml (the adaptive background gradient).
// 2. PORTRAIT LOCK in AndroidManifest.xml — the game is designed portrait-only.
//
// Run: node scripts/setup-android.mjs     (then rebuild the APK with `npm run apk`)
import sharp from "sharp";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const RES = root + "android/app/src/main/res/";

// Tube navy, lightened at the top so the square reads as a lit surface.
const BG_TOP = "#3d5a80";
const BG_BOTTOM = "#1b2a41";

// The game's marble palette, stacked bottom to top in the icon.
const MARBLES = ["#2f6fe0", "#e32d2d", "#f7d117", "#2fb32f"];

// density bucket -> [legacy icon px, adaptive foreground px (108dp)]
const BUCKETS = {
  mdpi: [48, 108],
  hdpi: [72, 162],
  xhdpi: [96, 216],
  xxhdpi: [144, 324],
  xxxhdpi: [192, 432],
};

/** A glass tube holding a stack of marbles, on a transparent square. */
function ringSvg(size, frac) {
  const w = size * frac * 0.42;
  const h = size * frac;
  const x = (size - w) / 2;
  const y = (size - h) / 2;
  const r = w / 2;
  const m = w * 0.78; // marble diameter
  const marbles = MARBLES.map((color, i) => {
    const cy = y + h - r - i * m * 0.98 - m * 0.1;
    const cx = size / 2;
    return (
      `<circle cx="${cx}" cy="${cy.toFixed(2)}" r="${(m / 2).toFixed(2)}" fill="${color}"/>` +
      `<circle cx="${(cx - m * 0.17).toFixed(2)}" cy="${(cy - m * 0.19).toFixed(2)}" r="${(m * 0.17).toFixed(2)}" fill="#ffffff" opacity="0.6"/>`
    );
  }).join("");
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
      `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" ` +
      `rx="${r.toFixed(2)}" fill="#ffffff" opacity="0.18"/>` +
      marbles +
      `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" ` +
      `rx="${r.toFixed(2)}" fill="none" stroke="#dbe6f5" stroke-width="${(size * 0.022).toFixed(2)}" opacity="0.85"/>` +
      `</svg>`,
  );
}

const bgSvg = (size) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0" stop-color="${BG_TOP}"/><stop offset="1" stop-color="${BG_BOTTOM}"/>` +
      `</linearGradient></defs><rect width="${size}" height="${size}" fill="url(#g)"/></svg>`,
  );
const roundMask = (size, r) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="#fff"/></svg>`,
  );
const circleMask = (size) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`,
  );

for (const [bucket, [icon, fg]] of Object.entries(BUCKETS)) {
  const dir = `${RES}mipmap-${bucket}/`;
  mkdirSync(dir, { recursive: true });

  const square = await sharp(bgSvg(icon))
    .composite([{ input: await sharp(ringSvg(icon, 0.72)).png().toBuffer() }])
    .png()
    .toBuffer();
  await sharp(square)
    .composite([{ input: roundMask(icon, Math.round(icon * 0.2)), blend: "dest-in" }])
    .png()
    .toFile(dir + "ic_launcher.png");
  await sharp(square)
    .composite([{ input: circleMask(icon), blend: "dest-in" }])
    .png()
    .toFile(dir + "ic_launcher_round.png");

  // adaptive foreground: transparent, art kept inside the 66% safe zone
  writeFileSync(dir + "ic_launcher_foreground.png", await sharp(ringSvg(fg, 0.5)).png().toBuffer());
  console.log(`[icons] ${bucket}: ${icon}px icon, ${fg}px foreground`);
}

// Adaptive background as a gradient drawable (the flat @color stays for old launchers).
mkdirSync(RES + "drawable", { recursive: true });
mkdirSync(RES + "mipmap-anydpi-v26", { recursive: true });
writeFileSync(
  RES + "drawable/ic_launcher_background.xml",
  `<?xml version="1.0" encoding="utf-8"?>\n<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">\n` +
    `    <gradient android:startColor="${BG_TOP}" android:endColor="${BG_BOTTOM}" android:angle="270"/>\n</shape>\n`,
);
for (const name of ["ic_launcher.xml", "ic_launcher_round.xml"]) {
  writeFileSync(
    RES + "mipmap-anydpi-v26/" + name,
    `<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n` +
      `    <background android:drawable="@drawable/ic_launcher_background"/>\n` +
      `    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n</adaptive-icon>\n`,
  );
}
console.log("[icons] done");

// ---- Portrait lock ---------------------------------------------------------
// Capacitor's stock manifest lets the activity rotate; the board layout is portrait-only,
// so pin it. Idempotent: skips if the attribute is already there.
const MANIFEST = root + "android/app/src/main/AndroidManifest.xml";
if (existsSync(MANIFEST)) {
  const xml = readFileSync(MANIFEST, "utf8");
  if (xml.includes("android:screenOrientation")) {
    console.log("[manifest] portrait lock already present");
  } else {
    const anchor = '            android:name=".MainActivity"';
    if (!xml.includes(anchor)) throw new Error("MainActivity line not found — manifest layout changed");
    writeFileSync(MANIFEST, xml.replace(anchor, '            android:screenOrientation="portrait"\n' + anchor));
    console.log("[manifest] portrait lock added");
  }
} else {
  console.log("[manifest] android/ not generated yet — run `npx cap add android` first");
}
