# Telemetry and analytics — what to set up, and how to read it

Two data sources, for two different questions. Reading the wrong one gives a confident wrong
answer, so start at §0.

The **code is finished and switched off**. Three values turn it on (§1); nothing else is
conditional.

---

## 0. Which source answers which question

| question | source | why |
|---|---|---|
| How many people are playing? From which countries? | **Firebase Analytics** | GA resolves country from IP; we hold no such data |
| Session length, weekly/monthly returners | **Firebase Analytics** | GA builds these; computing them by hand is worse |
| **Winrate of level N** | **Realtime Database** (`npm run pull`) | see the warning below |
| Which level players quit on | Realtime Database | GA cannot tell one revision of a level from another |
| Who used boosters / revived | Realtime Database | not sent to GA (§5) |

> ⚠ **Never measure winrate with GA.** GA records only the level *number*. This generator gets
> retuned constantly, so games from a board that no longer exists sit under the same number and GA
> will average them into one convincing figure. Every row in the Realtime Database carries
> `sig`, the **level fingerprint**, and `pull-runs.mjs` flags any level showing more than one
> fingerprint in the window being read. This is the exact mistake that wrecked a calibration pass
> on the sibling project.

---

## 1. The project, and what is still switched off

Firebase project **`ball-flow-d1d9a`** (project number 733192915298), web app *AstroBall*
`1:733192915298:web:e0042ef6e15211f577443b`. Pinned in [.firebaserc](.firebaserc), so every
`firebase` command here needs no `--project`.

| | value | state |
|---|---|---|
| GA4 measurement id | `G-DZH9MTW427` | **live** — [src/game/analytics.ts](src/game/analytics.ts) |
| Realtime Database | `ball-flow-d1d9a-default-rtdb`, Singapore | **live** — [src/game/telemetry.ts](src/game/telemetry.ts) |

Endpoint: `https://ball-flow-d1d9a-default-rtdb.asia-southeast1.firebasedatabase.app/runs.json`.

⚠ **That URL exists twice** — here and, minus `/runs.json`, in
[scripts/pull-runs.mjs](scripts/pull-runs.mjs). They cannot share a constant: one ships to
browsers and the other must never. Change one, change both.

Verified end to end on 14 Aug 2026: a level played headless from a LAN address produced one row
carrying `lvl`, `sig`, `result`, `ms`, `taps`, `peak`, `stars`, `build`, `dev`, `host`, `from`,
`ga`. (`used` is absent when no booster was spent — RTDB drops empty arrays, and absent means
none.)

Rules are deployed and were checked against the live database rather than assumed:

| probe | result |
|---|---|
| `GET /runs.json` with no auth | `Permission denied` ✓ |
| `POST /runs.json` with `{"junk":1}` | `Permission denied` ✓ (the `.validate` shape check) |
| a real game from the game itself | written ✓ |

Redeploy after editing [database.rules.json](database.rules.json):

```bash
npx firebase-tools deploy --only database
```

⚠ **Never skip that step on a fresh database.** It starts in test mode — world-readable — and
then locks itself completely after 30 days. The shape here is the only workable one:
**write-only**. Anyone may add a row, nobody may read one, because the database URL is visible in
the game bundle and there is no way around that for browser-sent telemetry.

Optional, and the cheapest way to get the privacy-policy URL the submission form asks for:

```bash
npx firebase-tools deploy --only hosting   # serves public/ → https://<project>.web.app/privacy.html
```

---

## 2. Reading the game data

```bash
npm run pull              # tally only, writes nothing
npm run pull -- --write   # merge into playlog.jsonl
npm run pull -- --all     # count test games too
```

No credentials to set up: it shells out to the Firebase CLI, which is already logged in and reads
as project **owner**, bypassing the rules. That is why the rules need no read account and no uid.

### The dashboard — https://ball-flow-d1d9a.web.app/stats.html

[public/stats.html](public/stats.html), deployed to Firebase Hosting. Players, games, winrate and
drop-off by day and by level, with a **peak-belt** column — the measure stars are scored on, so a
level sitting near 100% is one nobody has slack on.

Reads are allowed for exactly one uid, `bTh6GMIhhYdbJauI3Fm5k9AhQk93`, because the page reads
`/runs` **from a browser** and a browser gets no owner privilege — `npm run pull` works only
because the CLI authenticates as the project owner and never consults the rules.

⚠ **Never widen that to `auth != null`.** It reads as "signed-in users only" and means *any Google
account on earth*; anyone can make one in a minute.

Checked against the live database after deploying, rather than assumed:

| probe | result |
|---|---|
| the deployed `.read` on `/runs` | carries the uid ✓ |
| `GET /runs.json` with no auth | `Permission denied` ✓ |
| `npm run pull` (owner, via CLI) | still reads ✓ |

Signing in from a different Google account will simply return `Permission denied` — that is the
rule working, not a fault.

⚠ **`stats.html` is deleted from `dist/` by [build-target.mjs](scripts/build-target.mjs).** It sits
in `public/` only so Firebase Hosting serves it, and Vite copies `public/` verbatim — without that
line it rides into the CrazyGames upload, which is the same mistake as shipping the level editor.

There is a second route, `FB_SECRET=<secret> npm run pull`, using a legacy database secret from
⚙ Project settings → **Service accounts → Database secrets** (it also needs `DB` filled in at the
top of the script). It is faster and works without the CLI. ⚠ Never commit it — it is full admin
on the database — and do not build on it: Google has been retiring database secrets.

Test games are recorded like any other but carry the hostname they were played on, and `--all` is
what counts them. Filtering on read rather than blocking on write is deliberate: a blocked row is
gone forever, a filtered one is still there when the question changes.

Then the thing all of this is for:

```bash
PURE=1 npm run winrate -- --fit
```

⚠ `PURE=1` drops games bought with boosters. The bots have neither boosters nor undo, so a bought
level is not a game they could ever have played, and counting it flatters whichever model happens
to be optimistic.

---

## 3. Per-level reporting in GA — declare it or see nothing

The game sends two events (see [src/game/analytics.ts](src/game/analytics.ts)):

| event | parameters | fired |
|---|---|---|
| `level_start` | `level` | on reaching a board |
| `level_end` | `level`, `result` (`win`/`lose`), `seconds` | on the win/lose card |

Plus GA's own `first_visit`, `session_start`, `page_view`, `user_engagement`.

`Analytics → Events` shows how often each fired. Splitting by level needs one more step, **without
which GA never shows the parameter at all**:

> GA4 → `Admin` → `Custom definitions` → `Create custom dimension`
> - Dimension name `level` · Scope **Event** · Event parameter `level`
> - Same again for `result`.
>
> ⚠ **Not retroactive.** It applies from the moment it is declared, so declare it early, and
> expect 24-48 hours before it appears in reports.

---

## 4. Three screens, three different lags

| screen | lag | use when |
|---|---|---|
| **Realtime** | ~1 minute | just deployed, want to know it works |
| **DebugView** | instant | testing yourself, event by event |
| **Dashboard** / reports | **24-48 hours** | trends |

**A Dashboard of zeros does not mean it is broken.** It aggregates once a day, so the first day
after switching Analytics on reads zero everywhere while data is flowing. Check Realtime instead.

---

## 5. What GA deliberately does not get

Kept out to keep the payload small: boosters used, revives, coins, taps, peak belt occupancy, the
level fingerprint. All of it is already in the Realtime Database, sliceable without GA's lag and
without declaring a dimension per field. Add `track(...)` calls only if you specifically want to
cut one of them by country or by session.

---

## 6. When something looks broken

**Step 1 — did the script even arrive?** Every row carries `ga`: `1` = gtag.js loaded, `0` =
blocked (adblock or the host page's CSP). `npm run pull` prints the ratio. All zeros means the
script is blocked, not that the code is wrong — and no amount of GA work will fix it, so use the
database instead.

**Step 2 — DebugView.** Open the game with `?debug_mode=1`, then `Analytics → DebugView`. Events
appear within seconds with their parameters. Fastest way to check a new `track(...)` without
waiting a day.

**Step 3 — the two mistakes already paid for:**

1. **Pushing an array into `dataLayer` instead of `arguments`.** gtag.js only processes entries
   that are `arguments` objects; a real array is read as a GTM-style push and **ignored in
   silence**. This made the sibling project's first analytics build send nothing at all. The
   `gtag` helper must stay a plain `function` — an arrow has no `arguments`.
2. **Turning Analytics on in the console and assuming that is it.** That creates an empty GA4
   property. With no events sent, every panel stays at zero.

---

## 7. Two things not to break

- **`gtag.js` is not in the bundle**, and it loads when the player reaches a *level*, not at boot.
  Time-to-gameplay is a metric CrazyGames grades on, and a 145 KB cross-origin request at startup
  is exactly what the boot path was trimmed to avoid. Do not move `startAnalytics()` earlier.
- **[public/privacy.html](public/privacy.html) must match what is actually collected.** It already
  names Google Analytics and the Realtime Database and lists the fields. Add a field here and that
  page is wrong the same day — and CrazyGames requires it to be right. It is reachable in-game from
  Settings → PRIVACY.

---

## 8. What no source has

A row is written only when a level **ends**. Someone who opens the game and quits mid-level never
appears in the database. GA does see them (`first_visit` fires on arrival), so for "how many people
bounce immediately" GA is the only answer — that, and CrazyGames' own dashboard.
