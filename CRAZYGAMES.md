# Shipping to CrazyGames

What to actually do, in order. Written after the first submission so the second one is a
five-minute job instead of an afternoon of rediscovery.

Two paths: **§1 every update** (the one you will use), **§2 first submission only**.

---

## 1. Every update

```bash
npx tsc --noEmit                 # must be clean; build:crazy runs it too, but fail fast
git commit -am "…"               # BEFORE building — see the trap below
npm run build:crazy
```

⚠ **Commit first.** Every telemetry row carries `build`, the short commit hash, and the stats
page's build filter is what separates games played on this version from the last one. Build on a
dirty tree and every row is stamped with the *previous* commit — the level fingerprint still
saves you, but the build column becomes a lie, and it is the column you reach for when two
versions disagree.

`build:crazy` self-checks and refuses nothing quietly. It must print:

```
Ban "crazy": 5 file · 1.70 MB
  ✓ duoi 20 MB — du dieu kien len trang chu ban mobile
  ✓ duong dan tuong doi
  ✓ co SDK CrazyGames (1 file)
```

Then upload:

> Developer Portal → your game → **Builds / Files** → drag the **contents of `dist/`** into the
> upload zone → save → submit for review.

⚠ **Do not zip it.** The upload box rejects archives with *"Archive files are not supported,
please drag and drop the files directly in the upload zone"*. Drag the folder; the browser keeps
the subdirectory tree. The sibling project lost two attempts to this.

⚠ **Drag `dist/`, never the repo.** `editor.html`, `stats.html` and `tools/iframe-test.html` are
all excluded from `dist` on purpose — a dev tool in front of a reviewer is a failed review.

### If the privacy page changed

`public/privacy.html` ships inside the bundle *and* is hosted for the submission form, so both
need updating:

```bash
npx firebase-tools deploy --only hosting     # → https://ball-flow-d1d9a.web.app/privacy.html
```

⚠ **It must match what the game actually collects.** Add a telemetry field and that page is wrong
the same day. See [ANALYTICS.md](ANALYTICS.md) §7.

### If the database rules changed

```bash
npx firebase-tools deploy --only database
```

---

## 2. First submission only

Done once, kept here because "once" turns out to mean "once per game".

- [x] **Payment details set up** — must be done *before* submitting, not after approval
- [x] Developer Portal account
- [ ] Run the portal's **Quality Assurance Tool**, clear every warning
- [x] Three covers: [store/crazygames/](store/crazygames/) — 1920×1080 · 800×1200 · 800×800
- [x] Two preview videos, 15-20s, opening on their own cover ([§4](#4-the-preview-videos))
- [x] Privacy policy URL: `https://ball-flow-d1d9a.web.app/privacy.html`

Form answers that have consequences:

| field | answer | why |
|---|---|---|
| Game engine | **HTML5** | not "Externally hosted (iframe)" — that is for games you host yourself |
| Orientation | **Portrait** | the board is 540×1160, 1:2.15; there is no landscape layout |
| Supports mobile | **tick** | declaring portrait lets them handle device rotation |
| SDK muting | **tick** | already implemented; leaving it unticked makes the mute handling inert |
| Saves progress | **Yes, using the Data Module** | *and switch the Progress Save feature on* — the module does nothing while the toggle is off |
| Online game | **no** | no multiplayer |
| Privacy policy | the URL above | ⚠ form only |

⚠ **The privacy link goes in the form AND in the game, but never as an outbound link in the UI.**
Outbound links are banned; the in-game route is Settings → PRIVACY, which opens the copy that
ships inside the bundle, same origin.

---

## 3. Verifying before upload

The build script covers the four hard limits. These are the ones it cannot see:

```bash
# does the actual bundle boot? (not the dev server — the built files)
npx vite preview --port 4173
npm run shot -- --page index.html
```

⚠ `npm run shot -- --level N` **cannot drive a production build**: it waits on `window.__game`,
which only exists in DEV. It will report *"game never booted"* about a bundle that booted
perfectly. Use `--page index.html` and look at the screenshot instead.

What the console should show on a `crazy` build, in this order — if any line is missing, the
platform layer is not wired:

```
CrazyGames HTML SDK initialized
Local data handler initialized
Requesting game loading start … stop
Get "bf_level" / "bf_stars" / "bf_coins" / "bf_mute"
Phaser v3.90.0 (WebGL | Web Audio)
```

Then check it survives the iframe sizes the host uses — [tools/iframe-test.html](tools/iframe-test.html)
renders 800×450, 390×844, 1280×720 and 1920×1080 against `localhost:4173`.

⚠ **800×450 is the one to actually look at.** The game is portrait in a 16:9 frame, so at the
smallest size it is only **209 px wide** — 39% of the 540-unit design. The nine pips on a tray
face are what tell a player which trays can move; if they stop reading at that size, the escape
rule is invisible.

---

## 4. The preview videos

Both live in [store/crazygames/](store/crazygames/) and are rebuilt by one ffmpeg command each
(the script is in the session scratchpad; the recipe is below).

| | source | length |
|---|---|---|
| `preview-landscape-1920x1080.mp4` | desktop capture, cropped `504:1080:708:0` | 15.6s |
| `preview-portrait-1080x1620.mp4` | phone screen recording | 19.5s |

Rules learned the hard way:

- **15-20 seconds.** Outside that window it is rejected.
- **Open on the matching static cover**, ~0.6s, then hard-cut to gameplay. The store crossfades
  thumbnail → video on hover, so a matching first frame means no jump.
- ⚠ **No black bars — they are explicitly banned.** The game is 1:2.15 and neither store frame is,
  so the sides are filled with a blurred, darkened copy of the gameplay itself. Landscape fills
  only 26% of the width with game; that is the format's fault, not the crop's.
- ⚠ **No mouse cursor** — it is on their prohibited list. Xbox Game Bar captures it by default;
  the toggle is Settings → Gaming → Captures. On this machine `CursorCaptureEnabled` is already 0.
- Recording: `Win + Alt + R` starts and stops. Output lands in `%USERPROFILE%\Videos\Captures`.
  ⚠ It records the **focused window** — Alt-Tab mid-take and the recording ends there.

---

## 5. Things that must never change after launch

- ⚠ **The `bf_` storage prefix.** Automatic Progress Save backs up `localStorage` verbatim, so
  renaming a key after launch restores old names into a game that reads new ones and every player
  loses everything. It moved `ms_` → `bf_` on 2026-08-13, which was free only because nobody had
  played yet. It is not free again.
- ⚠ **The Capacitor app id** `com.marblesort.game` — still the pre-rename name. Free to change
  now, impossible after an Android release.

---

## 6. What Basic Launch actually grades

Not just a quality review: it is a **two-week limited-traffic run**, and their QA watches
engagement while it runs. Those numbers decide Full Launch.

| metric | good | ours |
|---|---|---|
| avg session length | 10+ min | — |
| day-1 retention | 10-15% | localStorage + Progress Save |
| reached gameplay | 80%+ | one tap from Home |
| load time | < 10s | 1.70 MB total |
| build size | < 20 MB | **1.70 MB** ✓ |

⚠ **"Time to gameplay" is measured to the `gameplayStart` call**, not to first paint. That is why
`startAnalytics()` loads gtag.js on reaching a *level* rather than at boot, and why nothing may be
added to the boot path without checking this number.

Watch the real ones at [ANALYTICS.md](ANALYTICS.md) → Firebase Realtime, and
https://ball-flow-d1d9a.web.app/stats.html for per-level drop-off.
