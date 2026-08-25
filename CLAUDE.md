# Marble Sort — project notes for Claude

**2026-08-07: scaffolded from the Beads Out project** (`github.com/cuongpc19/BeadsOut`)
following its `NEW-GAME.md` checklist, then built out from the reference material in
`Manythings/` (a gameplay clip, a screenshot and `Motagame.txt`).

⚠ This file originally specified a *classic tube-sort* — pouring marbles between glass
tubes. That is **not** the game. The reference material describes a different machine, and
the code implements the machine. Everything below matches the code.

## THE mechanic

A vending-machine-shaped board with three tiers, top to bottom:

1. **Tray grid** — a `cols × 5` grid of tiles, each tile a slab of `TRAY_N` marbles of one
   colour. Tap a tile and it empties down the chute.
2. **Chute** — straight sides down from the grid, then a short cone into a neck barely wider
   than one marble. Marbles fall on **real Matter.js physics** and pile up at the neck.
   ⚠ The drop is **fast out of the tray and slow through the cone** — that is deliberate and
   it is done *per body*: gravity stays at full strength and `GameScene.update` raises
   `frictionAir` to `CONE_DRAG` once a marble passes **`L.funnel.brake`** — not `funnel.top`.
   A single global gravity cannot do both, and lowering it makes the tray dribble out instead
   of emptying. Braking from the mouth of the cone is just as wrong the other way: the
   marbles hang about halfway down and never reach the neck and the rail.
3. **Conveyor** — a closed stadium-shaped ring of `BELT_SLOTS` positions. Marbles leave the
   neck one per tick and ride round the loop forever until something eats them.
   ⚠ A marble only leaves the neck when the rail directly beneath it will be clear on the
   next shift (`Game.entryFreeNextTick`), so the chute visibly backs up when the belt is
   congested — that backlog is the warning the player needs.
   ⚠ A tap is gated on **chute** room (`CHUTE_CAP`), not belt room. The tray tips even with the
   rail full and its marbles wait in the hopper. Read the note on `CHUTE_CAP` before changing
   it: it is far more expensive than it looks, because gating on belt room *was* the game's
   main skill test.
   ⚠ The tread is **sprites that travel**, not decoration baked into the housing: cleats
   advance one `BELT_SPACING` per tick, exactly like the marbles, so the belt reads as
   *carrying* them. Baked in place, the same scene reads as marbles sliding along a dead
   track. `npm run shot -- --level 5 --taps 1 --belt` asserts they are still moving.
   ⚠ There is **exactly one cleat per slot**, on the slot's own path offset — any other count
   puts the two on different pitches and marbles only line up with a hole now and again. That
   makes `BELT_SLOTS` a multiple of `2 * CLEAT_GROUP` (30 = 6 x 5), or the dark/light banding
   fails to close and a seam travels round the loop forever.
4. **Box columns** — `BOX_COLS` stacks of boxes under the belt's bottom run. Only the top box
   of each column is open; it shows `BOX_SLOTS` holes and accepts only its own colour. A
   marble riding over a column drops in automatically if the colour matches. Fill all the
   holes and the box pops off, promoting the next box in that column.

A tray only leaves the grid if **at least one of its four neighbouring cells is empty**
(`Game.canEscape`) — one open side is enough; the tray slides into the gap.

⚠ **The board edge on its own is not an exit** — except the bottom. A tile in the top row whose
other three sides are occupied is boxed in and stays locked. Counting the empty space beyond the
edge as an open side hands every edge tile a free way out, and the corners of a block open when
they visibly cannot.

⚠ **The bottom row is the exception, and it is not arbitrary.** That row sits on the mouth of the
chute and the cavity is *drawn* opening into the funnel there, closed by its rim everywhere else.
The art has to answer "can this move" — that is the entire job of the raised/flat eggs — and it
can only do that if the one edge drawn as a hole behaves like one. Reported from real play as
"the cells at the bottom are right over the funnel, there's no border under them, why are they
flat", and the reporter was right: the picture and the rule had been saying different things ever
since the cavity was opened into the chute.

⚠ It is **adjacency, not a clear lane to the edge**. Requiring the whole row or column to be
empty out to the border locks tiles that plainly have a gap beside them — a tile with one empty
neighbour and a wall behind it read as sealed, which is wrong and was reported from real play.
`level.ts` keeps a byte-for-byte copy of this test; if the two ever disagree, a "proven" level
jams on its own solution. That is what makes the grid a puzzle rather than a
list of buttons — a packed block is peeled from its shell inwards. The tray art carries the
answer: **eggs standing proud = it will move, eggs pressed flat = locked**, so the rule is
readable without tapping anything. The two looks are **presence versus absence** of the eggs,
not shading — shading has to be compared against a neighbour to be read, and it does not
survive every colour in the palette.

- **Win**: every box filled, belt empty.
- **Lose**: nothing can move. ⚠ Judge that on the *belt*, not on the trays: if the belt is full
  and nothing on it fits an open box, no marble can leave, none can get on, and the open boxes
  never change — so the position is dead however many trays are left. Asking "is a tray still
  tappable" first let a visibly jammed board run forever while the player kept tipping trays
  into a chute that could never drain. `Game.isStuck` checks belt drainage first, and only then
  falls through to the trays.

## Revive — the only thing that un-loses a level

The rail fills and nothing on it fits a box. Instead of the JAMMED card, the player is offered a
**revive**: `REVIVE_BOXES` = 2 boxes come off the board and `REVIVE_MARBLES` = 6 marbles come off
the belt, for coins, as often as they can pay. `Game.revivePlan` / `Game.useRevive` own the whole
rule; the scene only draws it. `npm run revive` is the check.

⚠ **The two numbers are one number.** Six marbles and two boxes is not a pair of dials — a box is
`BOX_SLOTS` holes, and a board is only winnable while every colour has exactly as many marbles in
the world as it has holes waiting. Free six belt slots without taking their boxes and six holes can
never be filled; take two boxes without their marbles and six marbles can never be eaten. Either
way the level is dead several minutes before it says so, and the player will read it as their own
mistake. So a box and its `BOX_SLOTS` marbles leave together, always.

- A box only qualifies if its colour has `BOX_SLOTS` marbles **on the belt**. The rail is what is
  jammed; clearing a colour still sitting in a tray relieves nothing.
- Order: **row 2 of the well first** (stack index 1), left to right, then rows 3, 4, … the same way.
  The open box is considered last and only while **untouched** — taking one the player has already
  put marbles into throws that progress away, and its part-filled holes would make the marbles
  removed something other than six. Measured over 1450 real jams: row 2 covers 76% of the picks and
  the open box was never needed, because a colour the open box accepts is not a colour that jams.
- ⚠ **No half revives.** `revivePlan` returns null unless it can find the full two, and the pop-up
  is not offered at all in that case. Three slots freed is not worth the coins, and an offer that
  quietly under-delivers is worse than the honest JAMMED card.
- ⚠ **Undo is cleared by a revive.** Rewinding across one restores the jammed board *with its boxes
  back on it*, and the player is then sold the same revive twice.
- ⚠ **Offer it before `finish()`**, which writes the play log. A game that carries on is not over,
  and logging there records a loss the player then went on to win. A revive is pushed onto
  `boostersUsed`, so `PURE=1` keeps a bought level out of the model ranking like any other booster.
- The pop-up animates **the real plan** — its two boxes and six marbles are the ones about to go,
  and the rest of the strip is the belt's own colours, sitting still. ⚠ Drawing only the six had
  them all fly off and leave the rail bare, which says the opposite of what the card is for: what
  the player is buying is six gaps in a full rail, not an empty one.
- `npm run shot -- --level 12 --taps 3 --jam` draws the card and buys it. ⚠ Its `__ms.jam()` hook
  stuffs the rail to *make* the offer appear — supply no longer matches demand on a board it has
  touched, so it proves the card renders and nothing whatever about the rules.

Over 1450 jams from levels 1-45: a plan was available in every one, the arithmetic held every time,
every revived board played on, and 10% of them went on to be **won** by the same careless play that
jammed them.

Board modifiers, all from the reference material:

- **`?` tiles** — colour hidden, cannot be tapped. Reveals as soon as the tray has **a way out**,
  so a face-down block peels from its edges inward.
  ⚠ **The reveal test is `canEscape`, the same test the eggs are drawn from — one test, not two.**
  Revealing on "has an empty orthogonal neighbour" instead is identical everywhere except the
  bottom row, where the chute mouth is an exit that is not a neighbouring cell: a tray boxed in
  down there stood its eggs proud — the board's own promise that it will move — and stayed
  face-down, i.e. untappable. Shipped that way in level 38 and reported from real play as
  *"khay mà hở 1 hướng thì không thể là khay ?"*. **A tray with a way out is never a `?`.**
  ⚠ Three places have to agree, and two of them are copies: `Game.settleInto`, the generator's
  own `settle` in `level.ts`, and the top-up in `hiddenMin` — which must count the bottom row as
  **open**, or it reads that row as the most enclosed part of the board and spends the whole
  face-down quota on cells that flip before the first frame.
- **Chocolate boxes** — `lids[]`: a 2x2 slab over four trays with a counter on its face. While it
  is closed its four cells are as good as crates — nothing taps them, and they block escape lanes
  and `?` reveals for everything around them. Every tray the player tips brings the counter down
  by one; at zero the box bursts and the four trays join the board.
  ⚠ **It counts trays tipped, not boxes filled**, and that was the other way round first. A tray
  is `TRAY_N` = 9 marbles and a box holds `BOX_SLOTS` = 3, so the same board offers three times as
  many box-clears as tray-taps and a counter written for one clock is meaningless on the other.
  The rule the player is told is "how many trays you have to pour", so that is what the number is.
  ⚠ Two kinds, and **the ribbons say which**: two bands crossing the slab, the way a box of
  chocolates is tied. One colour on both bands counts only trays of that colour; bands running
  through the whole palette count any tray. The ribbon is the other half of the rule, so it is the
  loudest thing on the piece after the number — and it is a **cross, not a rim**: a rim reads as
  "a tray of this colour" and the box comes out looking like one more tile in the row, where a
  ribbon plainly wraps something.
  ⚠ **The ribbon is the unlock condition, not a description of the contents.** A single-colour
  ribbon says which colour of tray, poured *outside* the box, brings the counter down —
  `creditLids` compares `lid.color` against the tray just poured and never reads `lid.tiles`. So
  **the four trays inside may be four different colours**, on a single-colour box as much as a
  rainbow one, and the engine has always allowed it. The editor used to repaint all four the moment
  you picked a ribbon, which turned a convention into a rule and cost every such box three of its
  colours; it no longer does. `Tô cả 4 cùng màu` is still there for when a one-colour interior is
  actually what you want.
  ⚠ **A single-colour counter can outrun its own supply, and the failure is silent.** The four
  trays underneath cannot be tapped while the box is closed, so they never count toward opening
  it — `need` has to be reachable from the trays *outside*, hatch queues included. `isWon` refuses
  to finish while any box is still on the board, so a counter one too high is an unwinnable level,
  not a hard one. The editor raises it as fatal and prints the real supply.
  ⚠ **It all happens on the pour, not when the marbles arrive.** Tipping the tray is the whole
  action the counter counts; the nine marbles then spend seconds falling through the cone and
  shuffling round the rail, and a counter that waits for them reads as broken — the player taps a
  tray the box plainly wanted and nothing moves. So `creditLids` runs inside `tap`, `settle`
  returns its `TickEvents` so the box can burst on that same tap, and `Game.lastOpened` carries
  which one to the scene. Three places have to agree or the number lies: the count, the burst, and
  **`GameScene.refreshFixtures`, which `onTapCell` must call** — `refreshGrid` only touches tray
  sprites, so leaving the box to the next tick left the number sitting still on screen while the
  model had already moved it.
  ⚠ `openLids` is still called from `tick` as well, and neither call is redundant: only `tap` can
  bring a counter down, but only `tick` runs while the player is doing nothing.
  ⚠ The burst is **slower and heavier** than the box-clear burst, on purpose. A box in the well
  clears several times a level so it gets punctuation; a chocolate box comes off once, after a
  dozen taps spent earning it. Chocolate-toned shards that arc out and then *fall*, over ~860ms,
  and the four trays fade up rather than blinking in.
  ⚠ A linked pair credits **both** halves, matching `trayCounts` counting it as two trays.
  ⚠ `trayCounts` must include the four trays underneath or the box derivation is four boxfuls
  short and the level is unwinnable by arithmetic alone.
  The editor draws them with tool **8**. ⚠ Its panel carries **its own two swatch rows** — one for
  the ribbon, one for the four trays — and neither is the main palette. Driving them off the main
  row was reported as the colour picking being awkward, and the reason is that the main row is the
  *brush*: a click on it was silently doing a third job with nothing on screen to say which. Both
  rows mark their live swatch (`.sw.sel`, alongside the brush row's `aria-pressed`), because a
  swatch row you have to click to find out is the rest of the awkwardness.
  The generator can place one (`Params.lids`) but its gate is `d >= 0.6 && level % 4 === 0`, and
  the sheet pins `d` near 0 — **no shipped level has one**.
- **Arrow trays** — a tray with an arrow on its face pointing at one of its four neighbours. It is
  **sealed until that cell is empty**: eggs flat, taps refused, exactly like a `?`. Pour the tray it
  points at and it wakes up. `Tile.arrow`, and `stepTarget` is the one place a direction becomes a
  cell index (`dispTarget` delegates to it, so a hatch and an arrow cannot disagree about "left").
  ⚠ **`ArrowDir` is wider than `Dir` on purpose.** A hatch shutter can never face *up* — there is
  nothing above to catch the tray — but an arrow only points, so all four make sense. One type for
  both would either hand hatches an illegal direction or leave the arrow unable to say "that one".
  ⚠ **It clears for good, like a `?` reveal.** A hatch can refill the cell that was emptied, and a
  lock that snapped shut again after the player had already satisfied it is the board taking back
  what it gave. `settleInto` deletes the field rather than deriving the state, so nothing can
  re-close it.
  ⚠ **`liftable`, not `canEscape`, is now what the eggs are drawn from** — in `GameScene`, in the
  editor's preview, and in `bots.mjs`'s `availableTrays`. An arrow-locked tray has a way out and
  still cannot be poured; raised eggs are the board's promise that it will move, so the two must
  never disagree. This is the same one-test rule the `?` reveal has, with one more term in it.
  ⚠ **It opens on the pour, not on the next tick** — `Game.lastUnlocked`, the same channel as
  `lastOpened` for chocolate boxes and for the same reason: the marbles then spend seconds falling,
  and an arrow still sitting on a tray the model has already freed reads as the tap not working.
  ⚠ **Two ways to build one that can never open, and the engine refuses neither.** An arrow aimed
  at casing, a crate, a bar or off the board never opens; and any *ring* of arrows waiting on each
  other deadlocks while every arrow in it passes the per-arrow test. `checkBlueprint` raises both as
  fatal, the ring via a fixpoint over "can this cell ever empty" — one message for the whole ring,
  because it is one mistake, not four.
  ⚠ **The arrow is white, with a shadow under it rather than a disc behind it.** White alone is
  unreadable on the pale half of the palette — a yellow or cyan tray is nearly white itself, and the
  badge sits on the *flat* face, which is the tray's own colour with no eggs to break it up. So one
  darker pass goes down first, offset and fatter, which reads as depth on the dark swatches and as
  an outline on the light ones. Same trick as the eggs on `trayFace`. The editor's CSS mirrors it
  with `text-shadow`, because the two pictures have to agree.
  The editor draws them with tool **9**, and its panel says what the arrow is pointing *at* rather
  than which way it faces — "chỉ xuống" cannot tell you the arrow is aimed at a crate.
  Nine shipped boards carry them: **41**, where the piece is introduced, and **42, 51, 56, 63, 64,
  67, 68, 78** — the easiest 20% of the 42-80 run, three arrows each, placed by
  `node scripts/arrows.mjs 42-80 --share 0.2 --arrows 3 --write`.
  **Levels 86-205 are a run built from arrows**: the 40 boards of 46-85 laid down three times, each
  pass with a different set of locks, by `node scripts/arrowset.mjs --from 46-85 --to 86 --copies 3
  --arrows 5 --write`. 120 levels, 586 arrows, every one of them proved solvable.
  ⚠ **Interleaved, not grouped.** Pass 1 lays the 40 boards down in order, then pass 2 lays the same
  40 down again. Grouped the other way (three copies of a board back to back) the player reads it as
  the game repeating itself; a pass apart it reads as a board they know with a new problem on it,
  which is the only thing the copy has to offer.
  ⚠ **The copy takes the resolved board, not the drawing.** Only 14 of the 40 sources pin their box
  stacks; the rest are derived on load against the slot's own target, so copying the drawing alone
  produces a different level from the one being copied. `levelDefFor` is asked for the stacks and
  they are frozen onto the copy.
  ⚠ **The quota is what the shape allows.** 76 boards took the full 5, but source 68 has exactly
  **one** cell in the middle of its silhouette, and 71 and 84 have two — no search can do better, so
  their copies carry 1-2. A board that cannot take its quota drops to fewer rather than being
  skipped, because a gap in the run falls through to the generator and produces a board with no
  arrows at all.
  ⚠ This **replaced the old 86-115**, the deliberately-easy run built by `easy.mjs`. It is in git
  history and nowhere else.
  ⚠ **Adding a lock invalidates the board's pinned line.** These boards ship with `refTaps` frozen
  onto the drawing, and a locked tray can make that exact order illegal — `toLevelDef` then drops
  the line and the level is left with no proof of solvability and nothing for the hint button. The
  script searches for a fresh line and pins it, then replays it exactly the way `custom.ts` does
  before trusting one. **Never add an arrow to a pinned board by hand without redoing the line.**
  ⚠ It never touches a **linked pair**: a pair is one piece across two cells and its right half has
  no tile of its own, so a lock on the anchor is a lock the geometry cannot see from the cell alone.
  ⚠ The generator never makes one. **Level 41 is where the piece is introduced**, hand-built and
  deliberately gentle (B 90% / D 93%): the last row is the only thing tappable at the start, every
  arrow above points at the row below, and the top row is locked by the ordinary escape rule
  instead — so both reasons a tray sits flat are on the same board. It is also **the smallest board
  for miles**, 12 trays against 30 on level 40, which is the trade a teaching board makes: a new
  piece needs one with nothing else going on, and level 40 next door is a spike, so the breather
  lands well. `FEATURES` counts down to it as ARROW TRAY, and the coach card fires there.
  ⚠ Level 200 is a **spare slot** — unreachable in normal play — holding the tuned, pinned board
  that used to be level 41, kept rather than thrown away when the demo was swapped up.
- **Hatches** — a housing with a roller shutter and a count on its face, holding
  `DISPENSER_HOLD` trays. It shoves the next one out from under the shutter into the cell
  directly below whenever that cell frees up.
- **x2 bars** — a fixture bolted **across two cells**, stored in `bars[]` by its left cell. It is
  not a tray: it never clears, never taps, and `cellFree` reports its cells occupied forever. What
  it does is double the load of every tray **above** it in either of its two columns
  (`Game.doubled` — `by > y`), so one tap drops `2 * TRAY_N` = 18 marbles, half the belt.
  ⚠ **A bar belongs on its own empty pair of cells, low on the board, with trays stacked above
  it.** It must never share a cell with a tray, a crate or a hatch, and never sit at the same
  height as the trays it is meant to double — reported from a level design as "the x2 bar has to
  go underneath, it can't be in the same place as a tray". Two reasons, and the second is the
  expensive one:
  - The bar is read *positionally*, not as a flag. A tray sitting **on** a bar cell is not
    doubled by it (`by > y` is false), yet `cellFree` still calls that cell occupied after the
    tray is tapped — so the player sees an x2 that does nothing and a hole that never opens a
    lane. Both look like bugs and neither is recoverable.
  - The bar has to be legible as *a thing the column pours through*. Level with its trays it
    reads as one more tile in the row.
  `level.ts` places bars correctly but its test is weak — it only asks that **something** is
  occupied above (`level.ts` ~654: "a bar with nothing over it does nothing at all"), which still
  permits a bar shoulder-to-shoulder with crates. ⚠ The **editor cannot place one at all**:
  `Blueprint.cells` has no bar kind, so `custom.ts` always emits `bars: []` and `fromLevelDef`
  drops them. A hand-built level that needs an x2 has to be finished by hand in `handmade.ts`,
  and nothing in the editor will check it.
- **Legacy `wide` trays** — the old double-width tray, kept only so saved boards still parse.
  `Game.span` returns 1 for everything now. Do not build new levels on it.
- **Linked pairs** — two trays clipped together across two cells, **each with its own colour**, and
  one tap empties both. Stored once at the left cell with `wide: true` and `mate` for the right
  half's colour; `Game.anchorAt` is what makes the right cell answer for it, so everything asking
  "is this cell free" must go through `cellFree`.
  ⚠ **Not the same thing as an x2 bar**, and the two multiply: a bar doubles whatever stands over
  it, so a linked pair above one drops four trays' worth. Anything gating on room asks `load()`.
  ⚠ It is drawn as **two ordinary tray sprites plus a small clip**, never one double-width face.
  A pair carries two colours and baking every combination would be PALETTE² textures at boot for
  an 18px detail. The right half has no tile of its own, so `refreshGrid` has to drive its sprite
  from the anchor or it renders as an empty cell with a clip floating beside it.
  ⚠ **Only the colour is per-half. Raised/flat and face-down belong to the piece**, and both
  halves have to say the same thing — one tap empties both, so if either half has a way out the
  whole pair moves. Two halves disagreeing is the clip claiming they are one piece while the eggs
  say they are two. The traps, all of which were live: the wide branch of `refreshGrid` ignored
  `hidden` and drew a face-down pair in full colour; the editor drove the right half's face-down
  state off the *drawing* rather than the settled anchor; and `onTapCell` looked up `tiles[i]`
  directly, so tapping the right half found nothing there and denied the tap — half a piece dead
  to the touch. Go through `anchorAt`, always.
  ⚠ **The drop is two colours out of two cells.** `tap()` queues half of each, so spawning `load`
  marbles of the anchor's colour puts nine of the wrong colour on screen and the belt contradicts
  them one at a time. `spawnTray` takes a colour *and an x offset* per marble for this.
  ⚠ **Every bot has to score both halves.** `SCORERS`/`trayScore` read `.color`, which judges an
  eighteen-marble two-colour piece by its left half — and which colour landed on the left is a
  coin flip in the drawing. `tileValue` (`bots.mjs` and its browser copy in `custom.ts`) and
  `coloursOf` (Cuongxs1's supply and demand) are the fix. The **mean** of the halves, not the sum:
  a pair serves two demands with one tap but also eats half the belt, so it does not get to
  outrank every single tray on arithmetic alone.
  ⚠ **A pair is 18 marbles on a belt of 30, and that is enough to break a board on its own.** A
  26-tray packed slab found a winning line with no pairs — at peak belt 30/30, already at the
  limit — and none at all with one. Boards carrying pairs need real gaps; `scripts/pairs.mjs`
  draws them at 16-22 trays and sweeps a density knob for exactly this.
  The editor draws them with tool **7**: the tool claims the cell to its right, and the panel sets
  each half's colour (point at a half, pick a colour, it steps to the other). `Tách đôi` splits one
  back into two ordinary trays, keeping both colours.
  The generator can build them too — `Params.pairs` — and it **defaults to 0**. Turning it on
  changes what every board is made of and costs a full retune, so the capability ships switched
  off and gets switched on deliberately. Measured with 2 pairs forced on: level 20 went 74% -> 43%
  and level 28 88% -> 35% on (B+D)/2, and every board still cleared `verify`.
  ⚠ `span()` in **both** `logic.ts` and `tapOrder` was a stub returning 1. Both have to be real or
  the escape test reads only the left cell and the generator hands out a tap order the real board
  refuses.
  ⚠ `paint` draws the two halves **separately**. Spending one colour on the whole pair makes it an
  ordinary double-load tray and throws away the only thing the piece is for.
  ⚠ `trayCounts` counts a pair as **two** trays. Counting it once leaves the box derivation a
  boxful short and the level unwinnable by arithmetic alone.
- **Map shapes** — ten silhouettes, expressed as **masks** over the grid rather than column
  heights, because the real machine's boards are arbitrary outlines (crosses, L-shapes, hollow
  frames) and a heights array can only describe something hanging from the top. They matter
  *because* of the escape rule: a notch or a hole is an open side for everything beside it.
- **Crates** — cells permanently in the way. Never hold a tray, never clear, count as occupied
  for both escape lanes and "?" reveals. The only board element the player can do nothing at
  all about, which is what makes them shape a level rather than pace one.
- **`?` boxes** — a box below the top of its column with its colour hidden until it rises.
  ⚠ **The bot-based tuner is blind to this**: bots read `boxes` directly, so hiding a colour
  changes nothing they can measure. It makes the game harder for a person and *not at all* for
  the tuner, so it can never be traded off against the other levers on the same scale, and it must
  never be tuned by bot — its real cost only a play log can show.
  ⚠ **From `BOX_HIDDEN_FROM` = 21 the stacks are mostly `?`**, 70% on an easy slot rising to 90%
  on a hard one, straight off `targetWin`. `boxHiddenFrom` in `config.ts` is the one rule, called
  by `toLevelDef` and by `makeLevel` so a hand-built and a generated board at the same level number
  hide the same share.
  ⚠ **The rule beats the drawing above that level**, deliberately: 185 shipped blueprints carry an
  explicit `boxHiddenFrac: 0` that a `??` fallback would never get past, and the density is a
  property of the *slot* rather than of the board. Below 21 the drawing still owns it. It is a
  **floor** — a drawing asking for more keeps it — the same convention as the sheet.
  ⚠ **The open box is never hidden.** `Game.isBoxHidden` is `idx > 0 && …`, so the player can always
  see what the board is asking for right now; what goes away is planning two rows ahead.
  ⚠ **Chosen because the tuner's blindness is the point.** Over 12 hours of real play people cleared
  level 20 at 91% and level 25 at 86% against bot scores of 18% and 1% — those boards are hard for
  something that pours flat out and easy for someone who can read the stack. Every bot number is
  unchanged by this, and that is the intended shape: the lever is aimed at the gap itself.
  ⚠ **Every fingerprint from 21 up changes**, so telemetry for those levels restarts from here.

Difficulty levers, in the order they should be reached for: **colour count**, **tray count**,
**`sloppy`** (how careless the generator lets its own reference solve be, which is what
tangles the box stacks), then grid size and hidden fraction.

## Rules that must hold

- ⚠ **Every generated level must be provably solvable.** `level.ts` builds a board *from* a
  solution and then replays that exact tap order through the real engine in `logic.ts`
  (`verify()`); a board that does not clear is thrown away and regenerated. Do NOT ship a
  level the engine has not cleared — a jammed-from-the-start board is unrecoverable and the
  player cannot tell it apart from their own mistake.
- ⚠ **A pinned board needs its line pinned too.** `Blueprint.columns` and `Blueprint.refTaps` are
  captured from one derivation and belong together: with `columns` frozen, `toLevelDef` skips
  `derive` entirely, so `line` comes back empty and a board with no stored `refTaps` ends up with
  **no line at all** — no build-time proof it can be won, and `hint()` degraded to "the first cell
  the scan finds tappable". Seven shipped boards (3, 4, 5, 7, 9, 13, 14) were in that state; they
  were solvable in fact, which is exactly why nothing caught it. Lines were searched for and pinned.
  The cheap standing check is that every entry in `HANDMADE` replays its `refTaps` to a win.
- ⚠ **`derive()` finding no line is not evidence the board cannot be won.** It runs its own search,
  and that search taps whenever a tray is legal — on a machine whose only way to lose is congestion,
  that is the worst policy there is. Two hand-edited boards were reported as unsolvable on that
  basis while `best()` was winning **30-38%** of games on them, which is proof a winning order
  exists. A search that adds the two things `patient` has — the belt-room filter
  (`beltFree() >= load(i)`) and `holdForBelt`'s settle wait — found lines for both on the first
  few seeds. So: **a bot winrate above zero outranks a failed derivation**, and a board is only
  condemned when the bots cannot win it either. The cost of getting this backwards is throwing away
  a good board; the cost of the reverse is shipping a dead one, so check the bots first and say
  which test failed.
- ⚠ **Solvable is not the same as playable, and shipping on `verify()` alone is not enough.**
  `verify` replays the generator's *own recorded line*, which the player cannot see. Levels 21
  and 27 both passed it and then won 7% and 0% of 120 games played by bots that had to work it
  out as they went. Every board now also has to clear `MIN_PLAYABLE` in `playableRate()` —
  twelve games, alternating greedy and patient, needing 25% wins — before it ships. That costs
  ~90 ms a level to generate (with the early exit; ~170 ms without), paid once at level load.
- **Never let a tray commit marbles it has nowhere to land.** `capacity()` subtracts belt
  contents *and* everything already spoken for — queued at the neck, still falling, parked in
  the magnet. Double-booking any of those strands marbles and the level can never be won.
- **Undo must restore the exact board**, not re-derive it. `snapshot()`/`restore()` take a
  whole-board copy; the physics marbles are then thrown away and re-dropped to match.
- **The scene may not make decisions the headless sim cannot reproduce.** `GameScene` owns
  pixels and physics only; every rule lives in `logic.ts`, which never imports Phaser.

## The level-1 walkthrough — `src/scenes/tutorial.ts`

Four coach marks in the order the machine works: pour a tray, the marbles ride the belt, one drops
into a box of its colour, fill every box. Shown only on level 1 and only while `save.tutorialDone`
is false (`bf_tutor`).

- ⚠ **It never blocks input.** Steps advance on something the player did or on a timer; none of
  them swallows a tap. Gating taps would also gate `window.__ms.tap()` and every `npm run shot`
  run — the one screen every reviewer sees would be the one nothing can drive. A player tapping
  past a step has already learned what it was about.
- ⚠ **`tutorialDone` is written when it finishes, not when it starts.** A player who bounces off
  the first screen and comes back gets it again; they are exactly who it exists for.
- ⚠ The tray it points at comes from `hint()`, the engine's own next-best tap — **not** a hardcoded
  cell. Level 1 is generated, so its board changes whenever the ladder is retuned and a fixed index
  would eventually point at an empty cell.
- **The idle nudge**: `IDLE_MS` = 5s after the last pour with nothing tapped, the hand and ring come
  back on the next tray `hint()` picks. It re-arms rather than firing once — a player who stalls
  twice needs the same help the second time.
  ⚠ **The clock only starts once the four captions are done.** Armed from the first pour it fires
  in the middle of them (the belt caption alone runs 2.2s, the box caption 2.8s) and the nudge
  draws on the same plate, so the two take turns overwriting each other while the player watches.
  ⚠ **`tutorialDone` is still written when the captions finish**, not after the nudges. The
  walkthrough is the four cards; the nudge is a safety net that may go on firing all level.
  ⚠ The position is asked of the **scene**, fresh, every time (`GameScene.nextTrayMark`) — it
  returns null while the game is paused or over, because a hand bouncing on a tray under the
  dimmed results card is worse than no hand. A position captured at `start()` would also be a tray
  that is long gone by the time the nudge fires.
  `npm run shot -- --level 1 --tutor` drives it: pours once, waits out the captions, then sits
  still for the five seconds — which is the one thing a normal `--taps` run never reproduces, and
  the exact failure mode of a mis-wired timer, since doing nothing looks like not being there.
- ⚠ **English.** `public/fonts/LilitaOne.ttf` is a Latin-only subset, so Vietnamese copy here falls
  back to Arial glyph-by-glyph and looks broken — the same constraint as the rest of the UI.
- The caption sits at `funnel.shoulder + 44`, in the throat of the chute. Above that is the board:
  the first draft used `shoulder - 34` and the plate landed on the bottom row of cells. It is drawn
  on a plate rather than as stroked text, because by step 2 the chute behind it is full of marbles.
  ⚠ It was `+ 26` until the coach cards below reached a `cross` silhouette, whose lowest row sits
  **on** the chute mouth and hangs past `shoulder` — the plate then rested on that tray's face.
  Covering a tray is not cosmetic here: raised-or-flat eggs are how the board says whether a tray
  can move, so the card was hiding the thing it was explaining.
- The pointing hand is **baked** (`K.hand`), not an emoji: a pictograph falls back to whatever the
  OS has, which is a different shape per device and nothing at all on some Androids.
- ⚠ Its layer is added **after** `uiLayer`, so the hand and caption sit over the HUD rather than
  under it.

## The difficulty badge — `levelTag`, `Blueprint.tag`

Every 15th slot is billed **SUPER HARD** and, past level 10, every 5th slot that is not already one
is **HARD**. Read off the *number*, because it is a promise the ladder makes and `targetWin` already
digs a dip at 15, 20, 25 and 30 to keep it — a badge read off a live bot score would flicker every
time a level was retuned.

⚠ **A drawing can overrule its slot** (`Blueprint.tag` → `LevelDef.tag`), and `"none"` is the reason
that field is not just a second boolean: `hard: true` could only ever *add* a badge, so a board
moved into a 15th slot had no way to decline the SUPER HARD promise that came with the address. The
scene asks the board first, then the old `hard` flag, then the number.

⚠ **Presentation only.** No rule reads it and no bot can see it, so it can never move a measured
winrate — the same standing as `hard`.

⚠ **The 25-tray spike has been moved twice**, both on instruction, on 2026-08-21. It was level 15
(badged SUPER HARD by the number rule), went to **11** badged `hard`, and is now **12**. The board
it displaced each time took its old slot: the 11-tray board that was 11 is now **15** with
`tag: "none"` so that slot shows nothing, and the 14-tray board that was 12 is now **11**.
Measured after the second swap (`npm run levels 16`, which is `levelDefFor` and not the generator):
L10 20%, L11 95%, **L12 61%**, L13 91%, L14 51%, L15 97%, L16 83% on (B+D)/2 — so the spike still
reads as the hard board of its neighbourhood, and 11 is now a breather.
⚠ **The board moving down had to have its stacks pinned first.** It carried none, so the move alone
would have rebuilt its boxes against slot 15's target — the same trap `Blueprint.columns` exists for.
The stacks and line it actually plays with were frozen onto the drawing before it moved.
⚠ **Slot 15's `targetWin` still asks for a dip** it no longer gets: the board sitting there now
reads 97%. The badge is gone, the curve's intent is not, so the sheet check and any retune will
still expect a spike at 15.
⚠ `npm run sim` **cannot see any of this** — it measures `makeLevel`, the generator. For a shipped
board use `npm run levels`, which goes through `levelDefFor`.

## Teaching the pieces — `src/scenes/coach.ts`

The walkthrough teaches the *machine*. It cannot teach the *pieces*, because none of them are on
level 1: measured over the shipped ladder, the `?` tray arrives on **6**, the hatch on **8**, the
crate on **11**, the linked pair on **15**, the chocolate box on **31**. A player meeting a
chocolate box thirty levels in has no way to guess its number counts *trays poured* rather than
boxes filled — and that is exactly the misreading the number is most likely to get.

So **three** pieces get one card each, once ever: the hatch, the arrow tray and the chocolate box.
A ring on the piece and a caption on the same plate the walkthrough uses (one definition,
`coachRing`/`coachPlate`, exported from `tutorial.ts` — two copies would drift, and the player
should not have to learn two visual languages for "look here").

⚠ **Crates, `?` trays and linked pairs deliberately have no card.** They had one and it was taken
out, on instruction. Each of the three says what it is on its own face: a crate never looks
tappable, a `?` turns over the moment it can move, and a pair is drawn with a clip across two trays
that empty together on the first tap of it. A card costs a card's worth of attention whatever it
explains, and spending it on those means the three that genuinely cannot be guessed — a hatch's
number, an arrow pointing at a *different* tray, a chocolate box counting **trays poured** rather
than boxes filled — arrive to a player who has already learned to dismiss the plate they appear on.
Adding one back is a decision about attention, not about coverage.
⚠ Their `?teach=` ids (`crate`, `hidden`, `pair`) now do nothing, and `FEATURES` still counts down
to **LINKED TRAYS** on the results card — that is a "something new is coming" teaser, not an
explanation, and it is kept on purpose for the one piece of the three that changes how much of the
rail a single tap eats.

- ⚠ **Driven by what is on the board, not by level number.** A table of "level 8 → hatch" is a
  second copy of the ladder, and the ladder moves — levels 15-115 have already been reordered
  once. `Coach.pick` reads the settled `Game`, so it cannot drift, and a board that gains a
  mechanic earlier explains it earlier for free.
- ⚠ **Eligibility is "present and unseen", not "this is its first level".** One card per level, so
  if two new pieces ever land on one board the second is not lost — it fires on the next board
  carrying it. Levels with pairs alone: 15, 24, 25, 36, 47, 54, 60, 65, 75, 95, 108, 109.
- ⚠ **`save.markCoach` runs on dismiss, not on show** — same rule as `tutorialDone`. A card that
  flashed by while the player was mid-tap has taught nothing, and this is its only chance.
- ⚠ **Never at the same time as the level-1 walkthrough.** Both own the same strip of chute.
- `bf_coach` is a **new** key, never a rename — see the storage-key warning in the CrazyGames
  section.
- No x2 bar card: `bars` is empty on every shipped level, so there is nothing to explain. Ship one
  and it needs its own entry in `MARKS`.

## The daily reward — `src/game/daily.ts`

Three days, 100/150/250 coins and 0/1/2 magnets, resetting the moment a day is missed. Unlocked
after clearing `DAILY_FROM` = 10.

⚠ **`DAILY_FROM` has been 10, then 5, then 10 again, each time on purpose.** The note on the
constant carries what each move was for; do not read the history as a value to restore. The live
cost of 10 is that a player jamming in the first few levels cannot afford the 50-coin revive on
`WIN_COINS` = 10 a win, which is exactly what the drop to 5 was for. The card is drawn by `HomeScene`; the rule is a pure function of
the clock and the save.

**A win routes the player home to it** instead of offering NEXT LEVEL — the reward lives on the home
screen, and handing them NEXT LEVEL means the feature's whole job is to be skipped. Both of the ways
that went wrong were found in one day of real telemetry, and neither was visible from the code:

- ⚠ **Offering and claiming are two different questions, and two different keys.** The gate was
  `dailyReady()` — "is there something to take" — which stays true all day for anyone who does not
  take it, so **every** win kicked them back to the home screen. 121 forced returns across 72
  devices in a day; one player sent home **50 times**. `dailyOfferable()` adds `bf_dailyoffer`, the
  day the offer was *shown*, and it is stamped when CLAIM REWARD is **drawn**, not pressed: a player
  who saw it and chose HOME has been asked. The reward is never withheld — the calendar badge is
  still on the home screen and `dailyReady()` still governs that.
- ⚠ **The card opened 420ms after the home screen, which was live the whole time.** The player has
  just tapped CLAIM REWARD and their finger is over the middle of the screen, where PLAY now is —
  **36% of forced returns were back in a level inside 2 seconds**, 52% inside 3. Most of the people
  this feature interrupts never saw it. `showDaily()` is called straight from `create()` now, so its
  dimmer is up on the first frame and there is no window to tap through.

⚠ **A claim that is not in the telemetry is not a claim that did not happen.** `send()` is
fire-and-forget and `database.rules.json` validates the row shape, so until `ev: "daily"` was added
there every claim was refused at the door in silence. It made the claim rate read 15% when the
measurable figure was 35%, and the give-away was that all ten rows arrived after 14:04 on a build
that had been live since 00:06. **Every new event type needs the rule redeployed**, and any funnel
computed from a new event type should be checked for a start time that looks like a deploy.

## Layout

## ⚠ Nothing may be positioned from the bottom with a number

`GAME_H` is **not a constant**. It is the frame's own aspect clamped between `H_MIN` and `H_MAX`,
so it is 1160 on a phone and **958 in a desktop CrazyGames frame** — the machine's own height plus
a skirt. Two things shipped broken because they were written as if 1160 were guaranteed, and both
were reported from the live frame as *"phần dưới của game bị khuất, vào game k click được button
play"*:

- The home screen's PLAY button was at y 952, which is 34px **below the bottom edge of the canvas**
  at 918. The game looked launched and could not be started. Bottom furniture is now
  `GAME_H - PLAY_UP`, offsets measured up from the foot of the box.
- `MACHINE_H` subtracted `MACHINE_Y` — the cabinet's y *before* the booster row lifts it — instead
  of its real top edge, so the machine reported itself `BOOST_LIFT` = 40px shorter than it is.
  `H_MIN` is derived from that report, so the game declared it could live in a box whose bottom
  40px were the box well, and the last row of boxes was cut off. `MACHINE_TOP` exists so the
  subtraction cannot be written the wrong way again.

⚠ **Never clip a container with a geometry mask.** The box well was given one, to stop the deepest
box dipping below its floor during a clear, and it emptied the whole well on a real phone. Phaser
renders a mask object through its **own** transform and ignores the container it belongs to, so a
mask built in design units lands `root.scaleX` away from what it is masking — and `root.scaleX` is
the device pixel ratio. That is **1 in the headless browser every screenshot is taken in** and 2 on
a phone, so it passed every check here and shipped. `scripts/shot.mjs --dpr 2` is the second axis:
shoot the layout at 1, and anything touching a transform at 2.

⚠ **A column is drawn one box taller than the well is.** `slideColumn` offsets the whole container
by a box and tweens it home, which is the right picture for the boxes already on screen and the
wrong one for the deepest, which has nowhere to come from. That one sprite is **pinned** — its own y
cancels the container's for the length of the tween — and fades up in place. Buying the 45px instead
is ~8% off how big the game draws on every desktop, where `GAME_H` is clamped to the machine.
⚠ Both callers go through `slideColumn`; the box-clear and the chocolate-burst drifting apart is how
one of them ends up with the artefact and the other does not.

⚠ **`WELL_FLOOR` is not padding.** Sized to the stack exactly, the last row lands flush on the rim
and the two rounded edges sit a pixel apart — which reads as the bottom row being cut off, and was
reported that way. Its 12px is what says "this is the bottom" instead of "there is more below".

## The letterbox bars are read off the canvas, not written by hand

The design box is 540 wide against a 16:9 desktop frame, so **about three quarters of the window is
page rather than canvas**. `pageBackdrop` used to paint that with a flat violet under a radial glow
and a vignette, tuned by eye — and it was wrong at every height, because the canvas edge is not one
colour. Measured down the seam of a 1898x982 frame: Home runs #302e58 at the top, #423973 where the
cover's own glow passes and #322d58 at the foot, while the board is a gradient **plus a halo behind
the machine** that nothing in CSS was imitating. The bar was out by up to 31/255 on Home and
**114/255 on the board**. Reported as the game being visibly cut off from its own background.

`matchPageToCanvas` samples the canvas's first three columns after the first frame renders and turns
them into a 20-stop `linear-gradient`. Worst-case error is now **7/255 on Home and 5 on the board**.

- ⚠ **Sampled, because no hand-written value can be right at every height.** A flat colour, a
  two-stop gradient and a glow are all approximations of a curve the canvas already has. Read it.
- ⚠ **Via `renderer.snapshotArea`, not `readPixels`.** A WebGL canvas cannot be read back on demand
  without `preserveDrawingBuffer`, which taxes every frame of the game to serve one read.
- ⚠ **The `fallback` argument is what shows until the read lands**, so it has to be a sane background
  in its own right — `pageBackdrop` still is, and is still what both scenes pass.
- ⚠ **The vignette is anchored to the canvas**, transparent from its left edge to its right and only
  darkening outside. Centred on the *page* instead — which is what a `radial-gradient at 50% 50%`
  does — it lands some shade on the seam itself, the one place that has to match exactly.
- ⚠ **It does not cost nothing on a phone, and the first version said it did.** Inside the host's
  frame a phone gets bars of about 13px a side, so the sampler runs — and the vignette, written for
  the ~460px bars of a desktop, compressed 0.55 alpha into 9px and drew a **hard dark stripe** down
  both edges of the game. Measured on a 393x660 frame: 128/765 of colour range inside the bar.
  Reported from an iPhone 16 as "sọc sọc". The shade is now scaled to the bar's own width — full
  strength from a quarter of the page out, nothing when the bar is a rounding error — which takes
  the same measurement to **12/765**.
- ⚠ Costs nothing on a phone: the canvas covers the width, so it returns before snapshotting.
- It re-runs on resize, debounced, and unhooks on `shutdown` — otherwise the listeners stack up one
  per level and every resize fires a snapshot for each level ever played.
- Check it with `npm run shot -- --size 1920x1080` and compare the pixel columns either side of the
  seam. Both scenes need checking: they draw completely different backgrounds.

## Home is the one screen that may be wide

`GAME_H` is derived from the cabinet, so **the board can never be anything but a portrait strip** —
widening its design box only adds empty canvas either side of a machine that cannot grow into it.
Home has no machine on it: it is a picture and two buttons, and on a 16:9 frame it was using 28% of
the width. `HomeScene.sizeStage` calls `setGameSize` to make the design box the shape of the window,
and lays out landscape from `WIDE_FROM` = 1.2 up: cover on the left, PLAY and the wallet in a column
beside it. Below that ratio nothing changes — a phone is pixel-identical.

- ⚠ **`GameScene.create` puts the box back**, not `HomeScene` on the way out. `?level=N` and
  `?custom=1` start on the board with Home never having run, so a reset written over there is a
  reset half the entry points never reach.
- ⚠ **The height never moves**, which is the only reason `this.scale.height / GAME_H` can be trusted
  as the device pixel ratio. The width cannot: by the second visit to Home it has been widened once
  already and no longer divides back.
- ⚠ **Do not fill the width by scaling the cover up.** Covering a 16:9 box with the 2:3 render keeps
  37% of its height, and the 37% in the middle is the tray — the lettering at the top goes, and that
  lettering is the only place the game's name appears anywhere on the screen.
- ⚠ **The gap either side of the art is the render's own edge column, stretched.** Two frames added
  to the texture (`edgeL`/`edgeR`), not a flat fill: its edges are near-flat violet but not *one*
  violet — #302e58 at the top, #353260 where the glow passes, back down at the foot — so any single
  colour draws a soft rectangle around the art at exactly the height the eye is already on.
- ⚠ **Art and column are laid out as one centred group** (`WIDE_COL`), not pinned to a share of the
  width. At 21:9 a fixed share leaves them at 31% and 76% with a third of the screen of nothing in
  between; capping the column puts the slack in the outside margins, where it reads as framing.
- ⚠ **The PLAY button's scale is capped against the column.** Just past `WIDE_FROM` — a 5:4 monitor —
  the space beside the art is 475 units and the button at 1.7 is 442 of them.
- ⚠ The resize handler is **guarded on the width actually changing**: `setGameSize` emits `resize`
  itself, so an unguarded handler restarts the scene, which resizes, which restarts it, forever.
- The scrim over the lower third is portrait-only. It exists because PLAY lands on the funnel;
  in the wide layout the button has its own column and the scrim would only dim the picture.
- Check it at three ratios — `npm run shot -- --size 1280x1024`, `1920x1080`, `2560x1080` — plus a
  phone, plus `--level 6` so the trip back to the portrait box is exercised.

## The board's own wide layout — the HUD moves aside and the machine grows

⚠ **Height buys width, and the HUD strip was the most expensive height on the screen.** `H_MIN` is
the machine's own bottom edge, `GAME_H` clamps to it on every landscape frame, and FIT then sets the
canvas from `frameH / GAME_H` — so the 114px of HUD sitting on top of the cabinet was costing the
desktop build 114px it paid for in width. On a landscape frame the HUD now goes into a **column
beside the machine** and the machine rides up into the space. Measured on a 1898x982 frame: `H_MIN`
970 → 856, and the cabinet 518px wide → **587px. 13% bigger, for nothing.**

- `WIDE_HUD` in `config.ts` is the switch, at frame ratio **1.2**. ⚠ It must stay the same number as
  `HomeScene`'s `WIDE_FROM`: the two screens hand off to each other, and a frame that gets the wide
  home screen and the portrait board reads as the game changing shape when you press PLAY.
- ⚠ **Read once at module load**, exactly like `GAME_H` — the whole layout derives from it. A phone
  that is rotated keeps the layout it booted with, which is what `GAME_H` has always done.
- ⚠ `HUD_LIFT` comes off `FUNNEL_SHOULDER`, `GRID_TOP` **and** `MACHINE_Y` together, so `MACHINE_H`
  is unchanged and the block moves as one. Take it off one of the three and the chute's 33° becomes
  something shallower — the angle at which the marbles stop sliding.
- `STAGE_PAD` = 156 is added **each side**, not just the left. The right one is empty, and it is
  there so the machine stays centred and every `GAME_W / 2` in `GameScene` — every card, every
  dimmer, every `CX` — goes on meaning the middle of the screen without being touched.
  ⚠ It is genuinely free, and provably so: FIT takes `min(frameW/852, frameH/856)`, and 852/856 is
  0.995 — far under the 1.2 that earns the layout in the first place — so the width can never be
  what binds. Widen `STAGE_PAD` past that ratio and the pads start costing the machine its size.
- ⚠ `root` is **shifted**, not re-origined: `root.x = STAGE_PAD * scale`. Every coordinate in
  `config.ts` is in the machine's own 540-wide space and so is Matter; moving the container leaves
  all of it alone and carries the hit zones with it, because Phaser tests those through the
  transform. Re-origining would strand the physics at the old offset.
- ⚠ **Dimmers must be `STAGE_W` wide** — `stageDim()`, not a `GAME_W`-wide rectangle. At `GAME_W`
  the two pads and the HUD standing in one of them stay at full brightness beside a dimmed machine,
  which reads as the card having failed to cover the screen.
- ⚠ The background halo is anchored to `L.machine`, not to the old hardcoded y 520. A glow left
  behind sits under the machine's feet instead of behind it. Same for the PREVIEW label, which at
  `L.hudY` would print across a cabinet whose top edge is now at y 20.
- The four controls have **one set of coordinates chosen by a flag**, not two branches of drawing
  code. Two branches is how the coin label ends up on the row in one and the column in the other.
- **Portrait is untouched** — `STAGE_PAD` and `HUD_LIFT` are both 0, and a phone is pixel-identical.
- Check it with `npm run shot -- --size 1920x1080 --level 4`, plus `--pause`, `--auto` (the result
  card), `--tutor`, a phone size, and `--page "index.html?level=4"` for the entry that never runs Home.

## Board size — up to 7x7, and the chute never moves

`gridMetrics(cols, rows)` in `config.ts` owns cell size and origin. A board may be up to `GRID_MAX`
= 7 in either direction; the cabinet cannot grow, so a bigger board gets **smaller cells** — 7x7
lands on 57 against the usual 64. Sprites are baked at `L.cell` and scaled by `cell / L.cell`.

- ⚠ **A 5-row board must stay pixel-identical.** Cell 64, pitch 71, centred in `gridPanel`. Every
  shipped level is 5 rows and every art decision was settled against those numbers.
- ⚠ **Cells are sized against the *shape*, not against `cols x rows`.** A board is declared on a
  grid and then a silhouette is cut out of it, so the declaration is an upper bound and usually not
  the board: **71 of the 115 shipped levels** declare a grid bigger than the shape inside it, and
  level 7 declares 6x6 for a board that is 5x5. Sizing off the declaration drew it at 45px in a
  cabinet it used two thirds of — reported as *"level này sao bé thế"*. `boardBounds` (casing out,
  crates in — a crate is inside the board) feeds `gridMetrics`, which centres the **occupied** part
  and still returns `x`/`y` as the origin of cell (0,0), so every caller keeps reading
  `gm.x + col * gm.pitch`. Rows of pure casing may fall outside the panel and that costs nothing:
  `drawGridCavity` draws playable cells only, and a pointer out there hits a walled cell.
  Result: **91 of 115 levels at the full 56px**, 18 at 45 (really six rows), 6 at 38 (really seven).
- ⚠ **A board may not grow *down* into the funnel.** `GRID_MAX_H` was 60px more than the panel the
  grid sits in, so every board over five rows — **63 of the 115 shipped levels** — hung past the
  bottom of the cavity and covered the top of the chute. At six rows that is 57px of a 136px funnel:
  the V loses half its height and the board looks like it is sitting on the belt. Reported from
  level 40. It is now `FUNNEL_SHOULDER - GRID_TOP`, so the cap and the panel cannot drift apart.
  ⚠ The price is **smaller cells on tall boards** — six rows land on 45 and seven on 38, against 56
  — and that is the trade being made knowingly. The alternative is more height, and height is the
  one thing the desktop has none of: `GAME_H` is clamped to the machine there, so every pixel spent
  on the grid comes off how big the game draws on every PC. Four- and five-row boards are untouched.
- ⚠ **The chute is fixed and must not be shortened to make room.** It was tried: compressing it
  from 186px to 120px so a 7-row grid would fit takes the cone from 33° to 22.5°, and at 22.5° the
  marbles stop sliding — they string out along the slope and sit there, which is the failure the
  `brake` note describes reached from the other side. `GRID_MAX_H` stops the grid at
  `funnel.top` instead, so the grid grows into the space *above* the chute.
  Screenshot after eight taps on level 5 if this is ever touched again.
- Everything that positions or sizes something on the grid reads `this.gm` in `GameScene`, never
  `L.cell` or `CELL_PITCH`. Mixing them puts the pieces and the slots 7px apart per cell.
- The editor has both **Số cột** and **Số hàng**, 4-7 each, and its DOM cells shrink by the same
  rule. Resizing crops rather than resets.

`config.ts` holds every constant *and* the layout, in design units (a 540×1160 box).
`GameScene` draws into one container scaled to the real canvas, so nothing else has to know
about the device pixel ratio. Matter runs in design units too.

⚠ Depth order in `resetLevel` is load-bearing: the belt housing is drawn **after** `fallLayer`
so a marble dropping into the neck slides behind its chrome rim instead of floating over the
front of the machine. Drawing the whole machine up front puts the marbles on top of it.

`TICK_MS` is a pure pacing dial — the sim counts ticks, not milliseconds, so it changes how
the game feels without moving a single balance number. The clock is driven from `update()`
with an accumulator, **not** a `TimerEvent`, because the interval has to change mid-level:
once `Game.gridEmpty()` is true there is nothing left to decide, so the last lap runs at
`TICK_MS_DRAINED`. Re-arming a looping TimerEvent mid-flight drops or doubles a tick, and the
phase has to be re-based on the switch or the marbles jump mid-glide.

⚠ The belt's bottom straight (`L.belt.hx`) must span the whole box row. A marble has to
physically travel over a column to drop into it, so a column poking out past the straight
gets served from its edge — or not at all. `SLOT_COLUMN` is the check: every column should
get the same number of slots.

## ⚠ A bot winrate is not a player winrate

Every difficulty number in this project comes from a bot, and bots are systematically wrong
about people. The sibling **Pixel Flow** project (`c:/CuongPC/Game/Pixel Flow`) scored five
different bot models against 67 real games across 21 levels. **Not one beat guessing a single
constant** — log-likelihood: constant -46.4, then E -48.6, D -54.3, A -57.0, B -74.2, C -84.9.

What worked there: two models biased in *opposite* directions, averaged, then bent through a
logistic curve fitted on real games (LL -39.4, leave-one-out cross-validated). The fitted slope
came out near 1.0, so the entire correction was a constant offset in logit space — the bots
were about 0.66 logit more optimistic than people.

⚠ **Which model this project will use is not decided, and must not be decided by argument.**
Pixel Flow's own note is the warning: *"I once asserted B was the most accurate; wrong, full
analysis put B 4th of 5."* The candidates live in `MODELS` in `scripts/winrate.mjs` — greedy,
patient, random, best-of, and a `slip` **family** (greedy that taps at random with probability
p, so p interpolates between perfect and careless play). `npm run winrate -- --models` scans p
across 0…0.9 and ranks everything on real games by log-likelihood with leave-one-out, refusing
to crown anything that cannot beat guessing a constant.

If forced to bet before the data exists: the slip family, because Pixel Flow's best single
model (D) was itself "Monte-Carlo playAverage, **skill-slip**". But that is a bet, and D still
lost to a constant on its own — it only worked blended with B and calibrated. Expect the same
here, and do not write the bet down as a finding.

⚠ Run the ranking with `PURE=1`. The bots have no boosters and no undo, so a level bought with
coins is not a game they could ever have played; counting it flatters whichever model happens
to be optimistic. The play log records `used[]` for exactly this.

## The difficulty ladder is searched, not written

`level.ts` used to carry a hand-written ladder — "colours up every 3 levels, trays every 2".
Measured against a target curve it was flat at ~97% for fifteen levels and then fell 23 points
in a single step. It is now produced by `npm run tune`, which writes the `LADDER` and
`VARIANTS` tables to paste back.

Three things that search had to get right, each of which was wrong first:

- **Take the gentlest `d` that reaches the target, not the nearest.** Searching for "the `d`
  whose score is closest to target" handed level 1 a `d` of 0.800, because at that end of the
  curve almost every setting scores ~99% and 0.800 landed a point nearer. Walk `d` upward and
  stop at the first setting that lands.
  ⚠ The walk used to *start* at the previous level's `d`, forcing the ladder monotone. That was
  right for a curve that only falls and is wrong for the sheet, which spikes to 40% at level 20
  and returns to 80% at 21 on purpose — carrying the spike's `d` forward makes every level after
  a spike as hard as the spike. Each level now walks from 0.
- **⚠ The knob alone cannot land a curve.** With `d` pinned at 1.0, one level scored 86% and
  another 30% — board luck swamps the ingredients. So the search has two axes: `d` picks the
  ingredients (and decides whether the target is reachable at all — at `d` = 0.08 the board is
  three colours and six trays and *no* board of those ingredients scores under 100%), and
  `VARIANTS` picks which board gets made from them.
- **⚠ Two-stage selection, or the winner's curse eats the result.** Taking the best of 40
  noisy measurements selects boards whose *measured* score happened to land on target, not
  boards whose *true* score is on target. Screen cheaply (20 games), then re-measure the
  survivors properly, and report the re-measured number.

`TARGET` in `level.ts` is the design intent as control points. Change it there, then retune —
hand-editing a LADDER or VARIANTS entry silently detaches that level from the curve.

## The level sheet — `Manythings/winrate Marble sort - Sheet1.csv`

Levels 1-29 are specified by hand in that sheet and transcribed into `SHEET` in `level.ts`: trays,
colours, face-down trays, hatches, crates, and a target winrate ±10 points. Past 29 the old
interpolated `TARGET` curve takes over. `applySheet` raises a generated `Params` to those floors
and `npm run sheet` checks every shipped board against them.

- ⚠ **Floors, never caps.** The row says "at least 6 colours"; clamping back down to 6 when the
  tuner found a seventh lands the winrate throws the tuning away. The row constrains the design,
  the winrate is the goal.
- ⚠ **A blank cell is no constraint, not "carry the row above".** Rows 17, 18, 21, 22, 23, 26 and
  27 ask only for a winrate and leave the ingredients open — that is the sheet giving the player
  a breather after a spike, and inheriting the previous row's numbers erases it.
- ⚠ **Variety must not ride on `d`.** The sheet pins everything that decides the winrate, so the
  tuner lands all 29 levels with `d` at or near **0** — and at `d < 0.1` `shapeFor` returns
  `block` and `paramsFromD` returns 4 columns. Every one of the 29 came out as the same slab on
  the same narrow grid: the silhouette lever, the walled-board lever and the board growing at all
  were switched off by a knob that no longer had to move. Board width, silhouette and walling now
  come from the **level number** (`colsForSheet`, `shapeForSheet`, `WALL_FROM`); `d` keeps the
  difficulty extras. The tuner still lands the target through `VARIANTS`.
- ⚠ **A hatch holds `DISPENSER_HOLD` of the sheet's trays, so the tray count is not the board.**
  Level 20 asks for fourteen and starts *eight* on the grid; drawn as a full-width `arrow` that
  is two thin rows with an open side everywhere, and the escape rule never bites. Levels whose
  on-grid tray count is under `WIDE_NEEDS` get a compact silhouette instead, and the block window
  sizes itself. ⚠ Narrowing the **grid** looks like the same fix and is not: at four columns
  levels 19 and 29 fell outside the sheet's ±10 at *every* setting of `d`, because a cramped
  board is harder, not denser.
- ⚠ **Do not wall a board whose trays are mostly in hatches.** Level 25 starts five of fourteen
  on the grid; compact that is a three-wide block, and walling it seals three of six columns into
  casing — 8% against a target of 30%, unreachable at every `d`. Walling is a rule change and it
  needs a board to change the rule on.
- ⚠ **"Số khay ?" means face-down trays the player actually meets.** `hiddenFrac` scatters `?` by
  probability, most land on the block's outside edge, and the reveal rule flips those before the
  first frame — so a board can satisfy the count at build time and show the player fewer. Count
  only the ones that survive, and top up in this order: **enclosed grid cells, then hatch queues,
  then exposed cells as a last resort.** The queues matter: an eight-tray slab four wide has
  exactly two enclosed cells, so a quota of five is structurally unreachable on the grid, and a
  tray that comes out of a hatch face-down is face-down in every way that counts.
- ⚠ The top-up has to run **after** crates and casing are placed and use the engine's own idea of
  a solid neighbour (`cellFree`: crates, walls, bars, lids and hatch cells all count as solid).
  Testing enclosure earlier reads cells as exposed that the finished board has sealed.
- Hatches hold `DISPENSER_HOLD` = 3 trays and face **down only up to `SIDEWAYS_FROM` = 15**; above
  that they may turn left or right. A sideways shutter is a second thing to read on a board and
  the early levels are where the first one is still being learned.
- The tuner's cost is `|score − target| + 0.5 × max(0, |B−D| − GAP_OK)`. Landing the mean is not
  enough on its own: a level reading 50% because best play wins 90% and slip-0.25 wins 10% is two
  different levels depending on who is holding it. `GAP_OK` is **0.20**, measured: at 0.35 four
  sheet levels shipped 25-33 points apart (level 20 read 36% as the mean of 20% and 53%), and
  retuning at 0.20 pulled them to 15, 3, 5 and 3 for at most 3 points of target accuracy.
- The sheet's hardest rows need a **wide board search**, not a harder `d`. At `VARIANTS` 28 level
  25 could not get past 19% against a target of 30% at any `d`; at 64 it landed 35%. When a level
  is stuck below target with the ladder already at 0, the ingredients are fixed by the sheet and
  the only axis left is which board gets made from them.

## What a bot is actually scoring — and the defect that was in it for weeks

A thinking bot picks the tray whose colour the open boxes want most. The original scoring was

```
holes standing open in boxes of this colour × 10  −  marbles of this colour on the belt
```

⚠ **The weights are 10 against 1, and that makes the second term nearly inert.** A box with three
holes and three matching marbles already on the belt needs *nothing* and still scores 30 − 3 = 27,
comfortably the highest on the board — so the bot tips nine more marbles for a colour with no room
left and they ride the belt forever. Reported by the person playing, not found by the tooling:
*"it should subtract the marbles about to be eaten, and the boxes about to clear"*.

The fix is to score **net need** — holes open minus everything already committed, where committed
means the belt *and* the neck queue *and* the marbles still falling *and* the magnet. Floored at
zero. The "box about to clear" case comes free: once the committed marbles will fill it, the box
pops, its colour stops being on top, and there is nothing left to aim at.

Measured over the 29 sheet levels: **best play 78% → 96%**, better on 19 levels, worse on none.

- ⚠ **The tie-break is not a detail.** `need × 10 − sent` alone prefers a colour with *no box open
  at all* (0 − 0) over one with a hole left and three marbles coming (0 − 3). A quarter of that
  bot's taps went to colours nothing could accept and level 8 fell 100% → 65%. Reward "has
  somewhere to go" first, penalise over-supply second.
- ⚠ **Sometimes dumping a useless colour is correct**, so do not forbid it. Penalising a
  zero-hole colour outright fixed level 8 outright *and cost 6 points of average* — on some boards
  emptying a tray nothing can accept is what frees the cells other trays need to escape.
- ⚠ **Keep the old scoring.** It still wins outright on boards where the new one does not, so it
  belongs in the pool B maximises over; and it is the bot every number published before
  2026-08-11 was measured against, so deleting it would silently rewrite them all.
- ⚠ **A better player is not automatically a better model of people.** This one also fit the real
  play log better — (B+D)/2 scored −3.69 against a constant's −5.00, where the old blend tied the
  constant at −5.00 — but that was **ten games**, worth about one game of log-likelihood. Direction,
  not proof.
- ⚠ **Adopting it invalidates the ladder.** Every level was tuned against the old bot, so B jumping
  18 points means every board has to be rebuilt harder to land the same sheet target. Retune.

## Method Cuongxs1 — `npm run cuongxs1`

A different shape from the bots above, and it answers a different question. They pick the single
highest-scoring tray; this one turns the scores into **weights and samples**, so one board played
fifty times takes fifty different lines. It models a player for whom several taps look reasonable
and the choice is genuinely open — not one who is careless, which is what `slip` already covers.

Named by the person who specified it. It is an **oracle**: it reads hatch queues, the colours of face-down trays, and box colours buried
below the top of a column. None of that is on screen. That is the point — it measures how much of
a level's difficulty survives when the hidden information is handed over, i.e. how much is
planning rather than guessing.

Each board gets one **perfect game** (the generator's own `refTaps`, replayed) to show a winning
line exists, then N sampled games. ⚠ Only the sampled games score. Folding the perfect game in
would add a guaranteed win to every level.

Weight of tapping a tray:

```
(boxes of this colour still short) × 49 / (available trays of this colour × (2 − map gain))
```

Demand over supply, halved again by whether the tap opens the board. `map gain` is 0…1, measured
by actually doing the tap on a snapshot and diffing which trays now stand available — that one
move covers a neighbour gaining a lane, a `?` revealing, and a hatch shoving its next tray out,
without reimplementing any rule. Each newly opened tray is worth 0.15 if a box on top still needs
its colour and 0.08 if one a row down does.

⚠ **"Still short", everywhere in the method** — marbles already on their way are subtracted from
every demand it computes, on instruction: *"all my formulas have to subtract the marbles about to
be eaten and the boxes about to be cleared"*. Counting boxes raw is what wrecked the first
version: a box with three holes and nine marbles already heading for it still read as demand, so
the model sent nine more. **45-48% of its taps went to a colour with no room left**, it lost with
the belt at 30/30 in every single losing game, and levels the other bots clear at 80% scored 4%.
Fixing it took the average from 57% to 82% and halved the mean distance from target.

Two details the arithmetic has to get right:

- "Boxes about to be cleared" needs no separate rule. Once the marbles in flight cover a box's
  remaining holes its net demand is zero, so it stops attracting taps — and when it pops, its
  colour is no longer on top.
- The second row has received nothing yet, so there is nothing of its own to subtract. What
  carries over is the **surplus**: marbles that overshot the open box are still circulating when
  the one behind it opens. Subtract that instead.

Three things the formula does not specify, decided here and worth knowing before reading its
numbers:

- ⚠ **A colour nothing is short of weighs exactly zero**, so the model refuses it. With seven
  colours and four box columns, several colours are always zero.
- ⚠ **When every candidate weighs zero at the top row it falls through to the second**, and only
  if that is empty too does it pick uniformly. Uniform is a last resort worth about 5% of its
  decisions; the second row carries about 11%.
- The expression is a **weight, not a probability** — normalised across the candidates of that
  turn, so the ×49 cancels and only the ratios matter.

⚠ `refTaps` is *a* winning line, not a proven optimal one — it is what the generator happened to
record. Nothing here searches for a better one.

## The bots could not wait, and that is where the whole difficulty model was wrong

Every bot in `bots.mjs` tapped **on every single tick a legal tray existed**. `patient` and
Cuongxs1's belt discipline only ever *filtered out* trays the rail had no room for; neither could
decline a turn while a tray still fit. So they played at maximum pour rate — on a machine whose only
way to lose is congestion. A person does the opposite: pour one tray, watch it go round, pour again.

Measured on level 20, same seed and same scoring: pouring flat out **loses** with the rail at 30/30
after 22 taps; waiting for the rail to settle **wins**, peak 24, all 34 trays poured.

`holdForBelt` is the fix, shared by `play`, `playCuongxs1` and `rollout`: hold while the belt is
still draining, give up once it has been flat for `SETTLE` ticks.

- ⚠ **Only while waiting can still achieve something** (`hasPendingMatch`). Without that guard a bot
  sat on level 9 for 28,000 ticks with one tray left and three free slots that were never going to
  become nine — the deadlock Cuongxs1's own note already records.
- ⚠ **`SETTLE=0` is the old behaviour byte for byte** — `holdForBelt` returns before it touches the
  RNG or the board. Every number published before 2026-08-20 stays reproducible, the same way the
  `open` scorer is still in the pool.
- ⚠ **24 was chosen by the data.** Leave-one-out LL on 2061 real games over 27 levels, constant
  baseline -700.0: (B+D)/2 goes -680.8 → **-647.7**, Cuongxs1 -710.2 → -691.4, both optima in the
  16-24 band. The full table is on the constant in `bots.mjs`.
- ⚠ **The ranking does not crown a model and must not be read as doing so.** `random` came second
  and `slip0.80` first, which are not credible models of a player winning 89% of their games: the
  real winrate is nearly flat across these levels, so little separates the candidates and the fitted
  slope collapses to 0.46. What is solid is the **within-family** comparison — same data, same
  candidates, one parameter moved.
- ⚠ **It invalidates the ladder, and the ladder has not been retuned.** What the shipped levels now
  read, against what they were built to:

  | lv | target | settle 0 | settle 24 |
  |----|--------|----------|-----------|
  | 20 | 40% | 18% | **60%** |
  | 25 | 6%  | 1%  | **35%** |
  | 35 | 5%  | 0%  | **23%** |
  | 45 | 25% | 5%  | **32%** |
  | 50 | 25% | 24% | **54%** |

  Real players over 12 hours won level 20 at 91% and level 25 at 86%, so the new numbers are the
  ones moving toward the truth — but `LADDER`, `VARIANTS`, the `SHEET` check and the box-order
  search in `custom.ts` were all landed against settle 0 and are now measuring something else.
  **Retune before trusting any of them.**

## ⚠ `winrate.mjs` was scoring boards nobody plays

`sigOf`, the `--models` level set, `--build` and the main table all called **`makeLevel`** — the
generator — while 205 of the levels a player reaches are hand-built. So it scored a board nobody
plays, and every real game was then discarded on a fingerprint that could never match: `--fit` and
`--models` had **never seen a single real game** since `HANDMADE` existed. All four now call
`levelDefFor`, the one answer to "which board is level N".

Two filters had to go in with it, and the ranking is meaningless without either:

- ⚠ **A per-level minimum** (`MINLV`, default 8). A level with one game contributes a 0%/100% point
  and the curve fit chases it.
- ⚠ **Nothing past the hand-built ladder.** `HANDMADE` stops at 205, `levelDefFor` falls through to
  the generator, and **the generator hands out a nine-tray board at every level** — `makeLevel(110)`
  is nine trays too, it is simply never seen because hand-built boards cover 1-205. One player ran
  206 → 372 winning all 130 games at nine taps each. Left in, they were 167 of the 251 levels in the
  ranking, the baseline read 89%, and "predict high everywhere" won.
  ⚠ **That cliff is live and shipping.** Past 205 the game runs forever on a trivial board. It needs
  content, a cap, or a generator that does not produce nine-tray boards.

## ⚠ One bot, one definition — scripts/bots.mjs

`sim.mjs`, `winrate.mjs` and `tune.mjs` each grew their own copy of the same three bots, and
the copies drifted: on level 10 the sim reported best play at 17% while winrate reported 55%,
for what was meant to be the identical measurement. Every number either had ever produced was
incomparable with the other, and nothing in the output said which to believe.

They now all import from `scripts/bots.mjs`, which owns the bots, the seeding
(`seedFor(level, i)` — so two tools measuring the same thing play the same games), the (B+D)/2
blend, and the noise floor. ⚠ Do not inline "just this one bot" into a script.

The same trap the calibration constants have: one definition, imported, or the tuner optimises
something the report is not showing.

## ⚠ The noise floor: ±5 points

Re-running one fixed configuration with only the seed changed, over levels 20-40:

| bot | 12 games/level | 30 games/level |
|-----|----------------|----------------|
| greedy | ±5 | ±2 |
| patient | ±3 | — |
| random | ±5 | — |

So a **separation** figure carries about ±7 at the default of 12. **Anything under that is
noise.** Several conclusions stated confidently during the build were inside it and should not
have been: doubles every-3rd-level vs none (sep 52 vs 53), map shapes costing "4 points",
belt 30 vs 32. The ones that were real were large — `TRAY_N` 9 vs 6 (50 points), the tray cap
(15), the chute size (29), the escape rule (bots move in opposite directions).

Before reporting any comparison, ask whether it clears ±7. If not, say it is a null result.

`npm run sim` judges each level against `targetWin(level)`, not a flat 50% — the curve
deliberately asks for 25% by level 20, so "loses more often than it wins" down there is the
design working. What it flags is a level 25+ points *below* what it was asked to be.

⚠ And it judges on **(B+D)/2**, the same ruler `TARGET` is defined on. Comparing best-play
against a (B+D)/2 target flagged level 8 as 27 points too hard when the tuner had it landing
within 4 — two different measurements, and the mismatch reads as a real defect in the game
rather than in the tooling. Whenever a threshold is compared against a target, check both sides
are the same metric.

So: **never quote `npm run sim` numbers as winrates.** They compare configurations, which is
what they are good for. For a number about players:

- `npm run winrate 20-40` — blends the optimistic and pessimistic bots and bends the result
  through the calibration. It prints a loud warning while the curve is still an identity,
  which it is until real games exist.
- Real games are collected by the game itself: every finished level is written to
  localStorage with a **content fingerprint**, and Settings → COPY N GAMES puts them on the
  clipboard as JSONL for `playlog.jsonl`.
- `npm run winrate -- --fit` refits the curve, and refuses to hand over coefficients that do
  not beat guessing a constant under leave-one-out.

⚠ The fingerprint (`levelFingerprint` in `logic.ts`) is not optional. This generator gets
retuned constantly, so "level 27" is a different board this week than last; a refit that mixes
in games from a board that no longer exists is fitting to nothing. Games without a matching
fingerprint are discarded, not guessed at.

⚠ Keep `A_CAL`/`B_CAL` in exactly one place (`scripts/winrate.mjs`). Pixel Flow's note about
this is blunt: coefficients copied into two files drift, and the tuner ends up optimising a
curve the report is not showing.

## The live dashboard — `public/stats.html`

Every finished game is also posted to a Realtime Database (`telemetry.ts`), and this page reads it
back: summary cards, a by-day table and a by-level table. Behind a Google sign-in, and shipped in
`public/` for exactly one reason — Firebase Hosting serves it. ⚠ `build-target.mjs` **deletes it
from every build**, so it can never ride into an upload; anything else dropped in `public/` for a
dev purpose needs the same treatment or it ships.

- The window is either a **preset** ("last N hours/days", always ending at now) or a **custom
  range** with two fixed edges — the shape that answers "what happened during that patch" rather
  than "what happened recently". Grain switch: **theo giờ** / **theo ngày**.
  ⚠ **The pickers are read as VN (+7), not as the browser's zone**, because `day()` buckets every
  row in VN and the by-day table is labelled that way. Read as local time on a machine set to
  anything else, 20/8 00:00 → 21/8 00:00 would straddle two of the rows it is meant to select — and
  since every machine this is used from is already in VN, the failure would only ever appear on
  someone else's screen.
  ⚠ **"đến" is exclusive by the hour and inclusive by the day.** 08:00 → 14:00 means six hours;
  20/8 → 20/8 means the whole of the 20th, not nothing. So the day grain adds 24h and the hour grain
  does not.
  ⚠ **`endAt` needs `orderBy` as much as `startAt` does.** Built from `since` alone, a query with
  only an end edge sends no `orderBy` and silently pulls the entire log.
  ⚠ **`const VN` had to move above the picker code.** `const` is not hoisted like `var`, and the
  range helpers read the offset while the module is still evaluating — a declaration further down is
  a ReferenceError that takes the whole page with it, i.e. a blank dashboard rather than a wrong
  number. `node --check` cannot see this; only loading the page can.
  ⚠ The range label prints **both** the window asked for and the span the rows cover, and rewrites
  itself on the empty path too — left alone it kept the previous window on screen, so a custom range
  that matched nothing looked exactly like a range that had loaded something.
- **Winrate** appears three ways and they are not interchangeable. Per game, per player (did this
  person ever clear it), and **clean winrate** — games with no booster and no revive. Clean is the
  one to compare against a bot, for the same reason `PURE=1` exists: a level bought with coins is
  not a game any bot could have played, and the whole ladder is tuned against them.
- **% of L1** in the by-level table is the **funnel**: that row's `Starts (user)` over level 1's.
  ⚠ **It divides the two numbers on the row, and that is the requirement.** It was first written as
  the *cohort* — the intersection of the two device sets, i.e. of the people who started level 1
  inside the window, how many reached this board — which is the more defensible statistic and was
  rejected on sight in real use: a row reading 15 beside a base of 131 and printing 10% instead of
  11% reads as arithmetic that failed, and a dashboard nobody can check by hand is a dashboard
  nobody believes. The cohort number is still computed and lives in the cell's **hover**, together
  with how many of the players here started level 1 before the window.
  ⚠ **So it can exceed 100%**, and is highlighted when it does. Someone on level 30 today mostly
  started level 1 weeks ago, so a short window counts them here and not at level 1. For the same
  reason the column **rises as the window shortens**, which is the opposite of what a funnel should
  do — read it on 7 or 30 days. That asymmetry is the price of the readable arithmetic, which is
  why the hover exists rather than the caveat being left to memory.
  ⚠ **Uncoloured otherwise, and `<1%` is not `0%`.** A funnel decays by construction, so banding it
  on the absolute value paints the whole bottom of the ladder red for behaving like a ladder; the
  step is what matters and Drop-off beside it already flags that. And deep down the base is hundreds
  against a handful, so whole percent rounds a level somebody did reach to "0%".
- **Lost or retried** and **% of starts** — players the board gave trouble to: **lost at least
  once, or re-entered it, or started it more than twice**, the union, one player counted once
  however many of the three they hit.
  ⚠ **A retry is inferred from a second start row, because the log has no retry event.** `tries` is
  counted on the device (`save.noteTry`) and never sent. So the second and third clauses are one
  signal at two strengths, and the hover splits all three — which is the only way to see whether a
  level's number is people failing or people re-entering.
  ⚠ **A reload re-enters the board**, and so does returning from an ad. Neither is a retry the
  player would recognise and both land in this column, so a large gap between "lost" and
  "re-entered" in the hover is a reason to check before calling the board hard.
  ⚠ **Not the complement of Completed**, and they overlap on purpose. Read together they separate a
  board that teaches (nearly everyone struggles once, nearly everyone finishes) from a wall (same
  number, half the Completed).
  ⚠ **Counted over the start-logged population only** — the same people the denominator counts. A
  player who lost on a build too old to send a start row belongs in no ratio that excludes them
  downstairs; counting them upstairs only is what makes a percentage print over 100.
  ⚠ The complement is **intersected**, never subtracted: `Completed` includes those old-build
  players, so `started − completed` can come out negative.
  ⚠ **Uncoloured**, like `% of L1`: the ladder aims some levels at 25%, so players losing there is
  the design working. Banding it would paint the intended shape of the game as a fault.
- **D1 retention** is a **cohort**: of the players whose *first* game was that day, the share who
  came back on **exactly** the next day. This is the number CrazyGames reports.
  ⚠ **It is not the "% returning" column beside it**, and reading one as the other is the whole
  reason both are on screen. "% returning" is the share of that day's players who had ever played
  before — it counts someone last seen a fortnight ago, so it climbs as the game ages whatever
  happens to new players. Ported from Pixel Flow, which learned the distinction the same way.
  - ⚠ **Two decimals, unlike every other percentage on the page.** D1 sits in the low single
    digits over a cohort of a few hundred, and whole percent prints 5/247 and 6/247 as the same
    "2%" — two different days reading identically is worse than no column.
  - ⚠ **Blank, never 0%, where there is no answer.** The newest cohort has not had its next day
    yet, and an hour bucket has no next day at all. A zero there reads as a collapse and it is the
    row the eye lands on first.
  - ⚠ **Both are computed only from the loaded window.** Someone who played before it counts as
    new, so early rows understate returning and put strangers in the cohort. To read one day's D1,
    load a window starting several days earlier.
- **Median *and* mean** time per player. Measured on Pixel Flow's real log the two came out 2:54
  against 13:20 — a handful of players who sit down for an hour drag the mean up, and the mean
  alone says the game is four times stickier than it is.
- **Time per attempt is the median too**, in both tables (`Time` by level, `Time/game` by day), with
  the mean and the sample size in the cell's hover. Same tail as above on a single board: an attempt
  is timed until the player finishes it, so a tab left open on the level writes a half-hour game.
  ⚠ **A row with no `ms` is dropped from the series, not pushed in as 0.** A mean absorbs a zero —
  the sum does not grow — but a median is a *position* in the sorted series, so every missing row
  shoves the middle one step down and a level reads faster the more of its data is absent. No rows
  with a length at all is `—`.
  ⚠ It counts **attempts, not players**, and losses as well as wins; abandoned attempts report no
  length and are in neither figure.
- ⚠ The **fingerprint column** in the by-level table is why winrate is not read out of Google
  Analytics: two fingerprints under one level number means two different boards averaged into one
  convincing-looking figure.
- The device code is a random 16-bit number, so strangers collide; and a row is only written when
  a game **ends**, so anyone who opens the game and quits mid-level is invisible here.

## Measuring — do this before tuning anything

- `npm run sim` — headless, ~0.3 ms/level. Plays every level with **two opposite bots**
  (greedy and random) and prints clear rate and peak belt occupancy for each. Use it for all
  balance work. A lever that moves only one bot is a real lever; one that moves neither is a
  null result a single bot would have hidden. Hold everything fixed but one variable.
- `npm run shot -- --level 12 --taps 6 --exercise` — drives the **real game** in headless
  Chrome over raw CDP (no Playwright download), taps through it, fires every booster, and
  writes screenshots plus the console log to `scripts/.shots/`. Needs `npm run dev` running;
  pass `MS_URL` if Vite picked a port other than 5173. `--belt` asserts the tread is moving.

  ⚠ **Never clean up after it with `taskkill /F /IM chrome.exe`.** That matches by image name
  and kills every Chrome on the machine, including the browser the person at the keyboard is
  using. The script launches its own instance on its own profile and shuts it down through
  CDP `Browser.close`; if something looks stuck, fix the shutdown path in `scripts/shot.mjs`
  rather than reaching for a kill-by-name. Verify with: snapshot the chrome.exe PID set
  before and after a run — no pre-existing PID may disappear.

Tuning that was already paid for, so it does not need re-deriving. Note the shape of the
result each time: what matters is the **gap** between the two bots, not the greedy number on
its own — a change that lifts greedy by lifting random too has made the game worse.

- `TRAY_N` is 9, matching the reference machine and the nine eggs on the tile. A tray needs
  `TRAY_N / BOX_SLOTS` = 3 boxes of its colour open at once or the remainder strands. It is
  the most expensive constant in the game: on the belt of 30 that suited trays of six it puts
  greedy at 45%. Paid for by `BELT_SLOTS` 30 → 36 (marbles to r=12) and the tray cap 16 → 11,
  which leaves marbles-per-level almost unchanged (11 x 9 = 99 against 16 x 6 = 96).
- ⚠ **Do not "cluster" box colours in the generator** to feed a big tray. It sounds right — the
  reference often shows three columns in one colour — and it measures worse (45% → 34%): with
  four columns showing two colours, only two tray colours can drain at all, and everything
  else clogs. Spread beats cluster.
- `hiddenFrac` is close to a **null result on the greedy bot**. Cheap flavour, not a lever.
- `sloppy` is a **null result on separation** (cap 0.75 / 0.85 / 0.92 → 41 / 41 / 36).
- Making the board edge stop counting as an exit costs greedy ~6 points **and lifts the random
  bot**: with fewer legal taps there is less room to pick a bad one. Still the right rule.
- ⚠ `CHUTE_CAP` cannot be read with the greedy and random bots alone, and getting this wrong
  once already produced a confidently stated, wrong conclusion. Over 630 games per setting
  (30 per level, levels 20-40):

  | hopper | greedy | patient | random |
  |--------|--------|---------|--------|
  | 18     | 86%    | 76%     | 26%    |
  | 21     | 81%    | **86%** | 26%    |
  | 27     | 57%    | 67%     | 25%    |
  | 36     | 52%    | 48%     | 25%    |

  **The random bot does not move at all.** A hopper changes nothing about colour matching, so
  careless play jams exactly as often whatever its size — an early 12-trial sample suggested
  otherwise and was pure noise. What a big hopper actually does is punish *greed*: the greedy
  bot has no self-control and dumps every tray it can, so more room to over-commit makes it
  worse. That reads as "harder" and is not.

  The `patient` bot exists to separate the two. It makes the same choice but refuses to tip a
  tray the rail has no room for. Below 21 the hopper is small enough that using it is always
  right and patience is a pure handicap; from 21 up patience overtakes greed, which is the
  point where restraint becomes a genuine skill rather than a missed opportunity.
- x2 bars are the harshest thing in the game — a tray over one is `2 * TRAY_N` = 18 marbles, half
  the belt. At the full tray cap every board carrying a bar is a coin flip (several at 0%). Fixed
  by shortening it: `tiles - bars * 2`. Swept at 2 / 3 / 4 units → separation 54 / 47 / 47, so **2**.
- Shrinking the belt so the cleat banding closes is free; belt capacity is coarse.
- Stars are scored on **peak belt occupancy**, not moves — every level takes exactly one tap
  per tray, so a move count would score nothing.
- **Current shipped band over levels 20–40: greedy 85%, random 31%** (separation 54, the
  widest measured). The greedy bot is one-ply and uses no boosters or undo, so a human should
  sit above it.

## Walled boards — the silhouette as a rim

`wall[]` on `LevelDef` marks cells that are not part of the board at all: solid casing.
Mechanically identical to a crate, but a different thing to the player and drawn as one — a
crate is an obstacle *inside* the board, a wall **is the board's edge**, and the edge is not an
exit. So the same silhouette played walled is a different puzzle: the outer ring is peeled from
the inside out instead of from the outside in.

- ⚠ **Only the margin becomes casing.** A cell is inside if the mask has cells on both sides of
  it along its row **or** along its column. That keeps two kinds of negative space open: a hole
  the outline encloses (`frame`'s hollow middle) and a channel running clean through it
  (`pillars`' gaps). Both are the shape's own features — the open air that gives its trays a
  lane — and sealing them inverts the silhouette lever instead of adding to it.
  Flooding in from the grid border, the obvious way to write this, gets the holes right and the
  channels wrong: a channel touches the border, so it floods, and `pillars` came out as separate
  towers with nothing between them.
- ⚠ **A walled board needs slack in the cavity.** With the outside solid the only escape lanes
  left are mask cells the fill did not take, so a mask sized exactly to the tray budget seals
  every tray in on four sides and the level is dead on arrival. Walled boards get half the tray
  budget again as room.
- ⚠ **A hatch keeps the cell directly beneath it.** That one cell has to stay floor or the level
  cannot finish. Exempting its whole column is what left the outer columns standing open.

## The silhouette has to be *drawn*, not cropped

⚠ Fit the mask to the tray budget; do not draw it full-size and let the fill crop it. The fill
takes `target` cells top-down and the budget (6-15) is half a 6x5 grid, so a full-height
`diamond`, `cross`, `frame` and `tee` all truncate to **the same two-row slab** and the whole
shape lever becomes invisible. Shipped that way for weeks; 7 of 10 shapes were in use and none
of them read.

- ⚠ An outline needs an interior. Squeezed to two rows a `frame` is every cell border, i.e. a
  solid slab. Minimum height 3 for `frame`/`cross`/`diamond`/`tee`/`arrow`.
- ⚠ `shapeFor` normalises `d` against **the range LADDER occupies** (0.20…0.85), not 0…1.
  Scaling raw `d` left the window short of both ends and `castle`, `block` and `pillars` never
  came up once in 45 levels — including `pillars`, the hardest silhouette measured. A lever the
  ladder cannot reach is not a lever.

## Drawing the machine — three tones, one recess

`machine` is the cabinet interior, **white**. `panelDeep` is the rim, the only slate in the
machine. `panel` is the cavity floor, white again. The box well at the bottom uses the same two
tones — one recess treatment, both ends of it the same material.

⚠ Collapsing this to two tones fails in both directions, and both were shipped and rejected:
filling the cavity with slate makes the board a dark sticker on a white box; painting the whole
cabinet slate makes the casing read as the hole rather than the solid part.

`drawGridCavity` draws the union of the playable cells **twice** — once dilated in the rim
colour, once inset in the panel colour. The dilated union *is* the outline, corners rounded and
all; tracing the boundary would need its own convex/concave corner arithmetic, redone per
silhouette. ⚠ Each cell's rounded rect must overlap its neighbour's by more than the corner
radius or the union keeps the individual corners and the well comes out as a string of beads.

The cavity always opens into the chute. The mouth is the board's **lowest row, not the grid's**:
a four-row shape would otherwise hang above the shelf with its own rim parallel to it, and two
lines a few pixels apart read as a mistake. ⚠ Lowest row *of the board*, not each column's own
lowest cell — per column, `diamond` pours white down its shoulders and comes out a rectangle
again. ⚠ And the drop from mouth to funnel goes through **both** passes: painted in fill only
(the obvious shortcut, since the point is to open the floor) it has no sides at all.

## Hand-built levels — `editor.html`

DOM, not Phaser: the editor is mostly buttons and dropdowns, every one free in HTML and
hand-built in canvas. It edits a `Blueprint`; `custom.ts` turns that into the same `LevelDef`
the generator produces, so a hand-built board is not a second idea of what a board is and every
rule, bot and fingerprint applies to it unchanged.

Resolution order in `blueprintFor`: this device's saved levels, then the shipped `HANDMADE`
table, then the generator. ⚠ Device first is deliberate — otherwise editing a level that already
ships keeps serving the shipped copy and reads as the save having failed.

Picking a level opens **the board that level actually is**, not a blank grid — starting from the
real thing is the difference between editing a level and retyping one. Where nothing is saved and
nothing ships, that is the generator's board, and `fromLevelDef` is the inverse mapping. It is
still ⚠ **lossy**: `bars` (x2) has no tool yet, so a level carrying one comes back without it and
the panel has to say so. Silently dropping a level's hardest feature and calling it "opened" is
worse than refusing. Chocolate boxes **do** round-trip now, and they go back **last**, over
whatever the cell loop put in their four cells — a box's trays are parked inside the lid, not on
the grid, so the loop reads all four as floor.

⚠ **Boot does not open a level, and must not pretend it did.** `bp` starts from the scratch slot
(`ms_custom`) on purpose — reopening the editor gives back the drawing you were working on. But
the Level box sits at its HTML default of "1", so the badge asserted "Level 1" over a drawing that
had nothing to do with level 1; held up against the game that reads as the editor and the game
disagreeing about a level, and it was reported exactly that way. The label is now found in falling
order of confidence: byte-identical to a save → that level; a level remembered in `ms_editor_level`
when it was opened → that level; neither → `Bản nháp · chưa gắn với level nào`. ⚠ The scratch state
is tested **before** the level-number branches, or it falls through and prints the lie again.

⚠ **`openLevel` must walk all three steps, in `blueprintFor`'s order.** It checked the device's
saves and then jumped straight to `makeLevel`, skipping `HANDMADE` — so level 32 opened as a
generated 6x5 in the editor while the game played the shipped 7x7: two different boards under one
number. Reported from a side-by-side screenshot. The badge made it worse by reading "máy sinh,
chưa sửa", a true sentence about the wrong board, which sends you hunting in the generator. A
shipped board is **neither** "đã lưu" (it is not in this device's book, and the game keeps serving
the shipped copy until you press Lưu) **nor** "máy sinh" (it is hand-built and off the tuned curve
entirely) — it says `bản ship`. Anything else that turns a level number into a board has to walk
the same three steps in the same order, or it is showing a board nothing plays.

- **The well is drawn under the board**, in the machine's own order: the open box on top of each
  column, its queue descending behind it, holes only on the open one. The editor draws trays and
  nothing else, so until this existed the half of the level that decides whether it can be won was
  invisible here — you drew, saved, and found out in play.
  ⚠ **Read off the settled `Game`** (`boxes[j].stack`, `boxIsHidden`), never re-derived. A second
  copy of the hidden-box rule in the editor would drift from `logic.ts` like every other duplicated
  rule in this file.
  ⚠ **A `?` box shows its colour *and* the mark.** The player sees a grey box; the designer has to
  see what is hiding under it or the queue cannot be read — the same bargain the `?` trays on the
  board already make with their corner dot.
  ⚠ **It scrolls itself.** A stack is `trays × TRAY_N / BOX_SLOTS / BOX_COLS` deep — level 30 is 31
  boxes a column, ~700px — so an uncapped well pushes the legend and, on a short window, the board
  off the page. Boxes past `BOX_VISIBLE` are dimmed: still real, just not on the player's screen.
  ⚠ **This forced `rebuildPreview` to build the def the way `board.ts` does** —
  `toLevelDef(bp, lastLevel, targetWin(lastLevel))`. It was `toLevelDef(bp)`: level 0, target 1, so
  the stacks were derived against the *easiest* order and nothing was ever hidden (0 is below
  `BOX_HIDDEN_FROM`). The editor was showing a different well from the one the player gets, in both
  its order and its `?`s. Checked by dumping `__ms.state().boxes` from the real game at level 30 and
  the editor's well side by side: all four columns identical, 31/31/31/30 boxes.
- **The drawing can be played in the editor** — `▶ Chơi thử tại đây` runs the real `Game` against
  the DOM board: tap a tray and it pours, the rail fills slot by slot under the board, boxes fill
  and pop in the well. It exists to close the loop with the well: play until it jams, drag a box,
  watch the same game again.
  ⚠ **The model, not the machine.** Marbles reach the rail through `arriveAll()`, the headless
  convention, so the chute never backs up and the hopper pressure a real player feels is missing.
  That makes it the wrong tool for pacing and the right one for **box order** — and it is the same
  loop `playOnce` runs, so its verdict and the bot check's cannot disagree. `Chơi thử` still opens
  the real machine, and anything about feel has to be answered there.
  ⚠ **Rearranging mid-run replays the run**, it does not discard it. `playTaps` records the tick of
  every tap as well as the cell: the engine is deterministic once taps and ticks are fixed, so the
  same game replays exactly against the new stacks — which is the only way to see whether the move
  helped. Replaying taps back to back instead would be a different game that happens to start the
  same way, because the belt state a tray lands in is decided by *when* it was poured.
  ⚠ **`commit()` ends a run**, because every edit rebuilds the def the run is playing on. The well
  drag is the one exception and restarts it.
  ⚠ **A poured tray has to be drawn from the model, not the drawing.** `bp.cells[i]` still says
  "tile" for a tray the run has emptied, and the settled-tile fallback in `render` would paint it
  back onto the board mid-game.
  ⚠ **Board taps play instead of paint while a run is on.** Painting through would edit the drawing
  under a game already running on the old one, and both are drawn from the same elements — the
  damage would not be visible until the run ended.
- ⚠ **An edit patches the box order; it never re-deals it.** Adding one tray used to reshuffle the
  whole well, and it read as a bug because nothing about it is local: `derive` does not extend an
  arrangement, it builds ~10 fresh candidates from the new drawing, scores each with bot games and
  keeps whichever lands nearest the slot's target — so one new tray means a different candidate wins
  and every column is re-dealt. Reported from real use as the order "tự dưng thay đổi".
  `patchColumns` now fixes the multiset and only the multiset: the boxes a colour gained are
  appended, the ones it no longer needs are taken away, everything else stays put.
  ⚠ **Surplus comes off the deepest box up, new boxes go to the shortest column.** What the player
  meets first is what the design is about, and piling every new box onto one column buries it.
  ⚠ **The derivation is adopted onto the drawing** the first time a well exists, so a board being
  built from scratch has an order to keep rather than re-dealing itself on every stroke.
  ⚠ **The price, and it is real: a board that holds its order is no longer aimed at its slot.**
  `toLevelDef` skips the search whenever `columns` is set, so the difficulty search that targets
  `targetWin(level)` only runs when asked. `Sắp lại tự động` is the ask, and it is the only thing
  that re-deals the well.
  ⚠ **The line is not searched for on the edit path.** `lineFor` plays up to `LINE_TRIES` games —
  ~200ms — and `commit` runs once per cell of a drag-paint. It is left stale deliberately
  (`toLevelDef` replays a stored line and drops it if it no longer wins, so nothing downstream is
  fooled) and `scheduleLine` finds a fresh one 400ms after the hand stops. ⚠ That debounce is *not*
  behind `Đo độ khó`, unlike the bot check: a line is not a measurement, it is the level's proof it
  can be won.
- **The well can be arranged by hand** — drag a box to another place in any column. The derivation
  is the right default and it is not a design tool: it builds ~10 candidate layouts, scores each
  with bot games and keeps whichever lands nearest the slot's target, and a designer who wants this
  colour third and that one last has no way to say so. Dragging says it.
  ⚠ **Four shuffle buttons** sit beside `Sắp lại tự động`: the first 12 boxes, the first 16, the
  last 30, and positions 12-30. They re-roll only their own stretch, so pressing several in turn is
  several independent decisions rather than one cancelling the last.
  ⚠ **Positions count row by row from the top of the well**, not down one column and back up the
  next — every column's open box is live at once, so a range counted per column would scramble
  boxes the player meets minutes apart while leaving a whole row untouched. `wellSlots` is that
  order, and it is what "the first 12" means.
  ⚠ **Colours move between slots, so the multiset is untouched by construction** — the level still
  has exactly the boxes its trays need, which is the one property a shuffle must not break.
  ⚠ **`Math.random`, deliberately**, where everything else in the editor is seeded off the drawing.
  These are buttons pressed repeatedly to *look for* an arrangement; a seeded shuffle would hand
  back the same one every time. What gets pinned afterwards is fixed, which is where determinism
  matters.
  ⚠ The line is found **inline** on these presses, unlike the edit path where it is debounced: one
  deliberate press is worth ~200ms of `lineFor` for a panel that tells the truth immediately.
  ⚠ **A hand-arranged order is a pinned order** (`Blueprint.columns`), so from then on the board
  stops rebuilding itself against the slot it sits in. The label above the well says which state it
  is in — derived or pinned — and `Sắp lại tự động` is the way back.
  ⚠ **The line is re-found on every drop** (`lineFor`, exported from `custom.ts` so there is one
  definition rather than a copy in the editor). A pinned board skips `derive`, so nothing else
  produces a `refTaps` for it, and `Blueprint.refTaps` already says what a level with no line costs:
  every tool reports it unsolvable and `hint()` degrades to the first tappable cell. If the search
  comes back empty the arrangement is kept — the designer is mid-thought — and the panel raises it
  as **fatal**. ~200ms a drop.
  ⚠ Moves only ever **reorder**: spliced out, spliced back in. Adding or dropping a box breaks the
  arithmetic every board depends on. And taking the box out shifts everything after it, so an
  insertion point below it in the same column is one place too far — off by one there swaps two
  boxes instead of moving one.
- ⚠ **`commit()` drops the pinned stacks only when the *trays* changed**, compared against a
  signature of `[cols, rows, cells]` taken when the pin was adopted. It used to delete `columns` on
  **every** commit, and everything goes through commit — opening a level, picking a cell, editing a
  hatch queue. Two things fell out of that, and the first had been shipping for a while: a board
  with pinned stacks was un-pinned the instant it was opened here, so the editor drew a re-derived
  well rather than the one that ships (they happened to agree while the derivation was unchanged,
  which is exactly why nothing caught it). The second is that a hand-arranged well survived until
  the next click. Every site that replaces `bp` sets the signature back to null, which means "just
  loaded, adopt whatever pin came with it".
- Boxes are **derived**, not drawn — the editor only draws the tray grid. Each tray needs
  `TRAY_N / BOX_SLOTS` boxes of its colour, so the multiset is fixed; the **order** is not, and
  the order is what decides whether the level can be won.
  ⚠ Dealing the colours out evenly, which is the obvious way and what this did first, buries a
  colour's later boxes under other colours: a tray tapped once its own column has moved on has
  nowhere to land, rides the belt, and the level jams with the board still half full. Reported
  from real play as "I only drew the top board and it says JAMMED" — and it was the derivation's
  fault, not the drawing's. Measured 82% against 100% for the same board laid out properly.
  So do what `paint()` does: take a tap order the grid permits (played on a real `Game`, so the
  escape rule and the reveals are the engine's own), run the belt, and open a box for whatever is
  piling up. The stacks then *are* the record of a playthrough that worked.
- ⚠ **One layout is not enough** — the same lesson the generator pays for twice. A stack ordered
  for a line nobody walks still jams: six random drawings scored 100, 100, 23, 0, 100, 100 off a
  single layout. Build ~10 candidates, score each with a handful of bot games, keep the best,
  stop early on a clean sweep. All six then scored 100. Cost is ~24 ms worst case and it is
  cached per drawing, because `toLevelDef` runs on every editor keystroke.
- ⚠ **The search aims at `targetWin(level)`, so a board's difficulty is a property of the *slot*,
  not of the drawing.** Move a level and its top half travels while its bottom half is rebuilt for
  wherever it landed. Measured on a real reorder: a board reading 100% at level 23 read **7%** at
  level 19 — same trays, and the search had the same candidate pool (it is seeded off the drawing),
  but it aimed at 50% instead of 80% and the pool's two nearest candidates straddled that target,
  so it took the hard side.
  ⚠ And it scores those candidates on **(B+D)/2** (`winRate` in `custom.ts`), which is not
  Cuongxs1. The two rulers disagree by up to 48 points on one board, so a ladder sorted on
  Cuongxs1 is being rebuilt by a search optimising something else. Same trap as everywhere else in
  this file: check both sides of a comparison are the same metric.
  **The fix is `Blueprint.columns`** — freeze the stacks (and `refTaps` with them) onto the drawing
  and `toLevelDef` skips the search entirely, so the whole level travels. Levels 15-115 are pinned
  this way. A drawing still being edited must leave it empty, or the boxes stop following the trays.
- ⚠ Derivation must be **deterministic per drawing**, seeded off the cells. Otherwise the level
  the editor measured is not the level the player gets.
- ⚠ **Sealed means permanently sealed** — every side casing, crate or board edge. Not "has no
  empty neighbour right now": a tray inside a packed block has none either, and peeling a block
  from its shell inwards is the game. Warning on those would flag every board worth building.
- The editor's bot check reports a **rate, not a pass** — the `verify()` / `playableRate()`
  distinction again. A board a bot clears 1 time in 20 is solvable and miserable. It runs on its
  own after every edit (debounced ~350ms, 12 games), because "press the check button" is a step
  nobody remembers until the level is already jamming in play. ⚠ Debounced and never inline in
  `commit()`: a drag-paint commits once per cell.
- The panel also prints what the **generator** puts at that level number. A hand-built board
  carries no difficulty label of its own, so the only honest way to say "this is heavy for level
  3" is to say the generator makes 9 trays there and this one has 13. First real report of a
  hand-built level was exactly that: a level-20-sized board saved as level 3, jamming on the
  belt, and nothing on screen said so.
- **Tool 0, `Chọn / xem`, selects without painting.** Every other tool paints on contact, so
  reaching an arrow tray's direction meant clicking it with the arrow tool and one wrong tool
  destroyed the piece before you saw what it was. It sets `selected` and nothing else; the four
  contextual panels already key off `selected` plus the cell's own kind, so a piece added later is
  reachable the day it exists without a new branch here.
  ⚠ **"Which tools own their selection" lived in three inline copies** — the end of `apply`, the
  tool buttons, the number keys — and they had already drifted: two named the arrow tool and one did
  not. Adding the new tool to two of the three left it selecting a cell and dropping it again inside
  the same click, which looks exactly like a dead tool. One `KEEPS_SELECTION`, three readers.
- ⚠ **A contextual panel that opens below the fold has not opened.** The tool list alone is 507px,
  so on an 800px-high window the arrow tray's direction picker landed at y **799** — one pixel under
  the edge. Reported as "chưa chọn được chiều mũi tên", and the picker was there and working the
  whole time. Two fixes, and both were needed: `Lưu vào level` moved to the left column so the
  panel stack starts higher, and every contextual panel now scrolls itself into view.
  ⚠ Only on the **transition** from hidden to shown. `commit()` re-renders every panel on every
  painted cell, so scrolling whenever an open panel happens to be off-screen drags the page out from
  under a drag-paint.
- ⚠ Every `addIssue` has to come **after** `issuesEl.replaceChildren()`. A warning raised above
  it is added and wiped in the same frame, which reads exactly like a condition that never
  fired — and the one lost that way was the heaviest signal on the panel.
- ⚠ The two "open the game" controls are real `<a target="_blank">`, not `window.open`. A popup
  blocker swallows `window.open` silently: the click does nothing and there is no error anywhere
  to find. The URL is also printed next to the button for a blocked tab.
- ⚠ A level in `HANDMADE` is **off the tuned curve**. `npm run tune` searches LADDER and VARIANTS
  for the generator and a hand-built board ignores both; `npm run sim` is the only thing that
  says whether it belongs where you put it.
- The editor's scratch board is never written to the play log — the log calibrates the
  *generator's* curve, and a drawing is a board no ladder ever produced.
- A hatch has a **direction** (`Dir` on `Dispenser`): its shutter faces down, left or right, and
  it pushes into that neighbour. Absent means down, so every board built before this still reads.
  ⚠ The `Game` constructor must **spread** the stored dispenser rather than list its fields —
  rebuilding it by hand is exactly how `dir` was dropped the first time, and every hatch went on
  facing down however the board was drawn, in silence. The fingerprint carries it too.
- A hatch is edited as **a count and then its trays in order**, not as a list you append to:
  set how many it holds, then fill left to right, the selection stepping on by itself. Appending
  leaves the count implicit, which is the one thing about a hatch the board actually shows.
- ⚠ `.box { display: flex }` beats the browser's own `[hidden] { display: none }`, so a panel
  toggled with `.hidden` stays on screen showing its **empty** state. The hatch panel looked
  broken for exactly this reason, and the empty state is convincing enough to send you hunting
  in the render code. `.box[hidden] { display: none }` is not optional.
- ⚠ The board paints on `pointerdown`, so a synthetic `.click()` in a test does nothing. Drive it
  with `new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, clientX, clientY })`, and
  re-query the cell **after** every commit — each one rebuilds the board and detaches the old
  nodes, so a reference taken earlier fires into nothing and the test silently passes.
- Changing the level number loads that level's board, or blanks it, and **never asks**. Hopping
  between levels to compare them is the common move, so a confirm on every hop is noise; the
  badge already says "có sửa chưa lưu" while work is unsaved, which is the same information
  without stopping the hand. Accepted cost: an unsaved drawing is gone once you switch away.
  ⚠ On `change`, not `input`: typing "12" passes through "1", and an `input` handler would load
  level 1 and wipe the board between two keystrokes — with no confirm left, that is the only
  thing standing between a keystroke and the loss.
- ⚠ **The editor renders a real settled `Game`, never the blueprint literally.** Drawn literally
  it disagrees with the game on three things at once, all of which happen before the first frame:
  a `?` tile beside a gap is already face-up, a hatch has already pushed one tray out, and a tray
  with no open side sits flat. Reported from a side-by-side: four `?` tiles in the drawing, none
  of them `?` in play. Reimplementing the rules in the editor would be a third copy of the escape
  test — `level.ts` already keeps the second, and this file says what that costs.
  What the editor adds on top is a marker on cells whose `?` does not survive settling, because
  "you drew this face-down and it is not" is invisible in a picture that agrees with the game.

## What came from the scaffolding (do not re-invent)

- `src/main.ts` — Phaser boot, DPR capped at 2, 60fps cap, Matter enabled, `?reset=1` wipes
  saved state, and `window.__game` exposed in dev. ⚠ **No dev wallet float.** A dev build briefly
  topped the wallet up to 1000 at boot, and that made the economy unreadable from the machine it
  is being tuned on: 1000 coins is twenty revives, while a real new player starts on **nothing**
  (`save.coins` defaults to 0) and earns `WIN_COINS` = 10 a level. Grant coins deliberately instead
  — `localStorage.setItem('bf_coins','200'); location.reload()` — so a test wallet is visible
  rather than standing silently behind every session. `GameScene` adds `window.__ms`
  (`state()`, `tap()`, `hint()`, `goto()`). **Those hooks are what make anything measurable
  — keep them.**
  ⚠ **The HTML boot poster is dismissed by `dismissBootSplash()`, and every scene that can be
  the first one on screen has to call it** — Home *and* Game. It is a full-screen div at
  `z-index: 10`, so a scene that forgets does not degrade: it covers the running game completely
  and the player watches the title pulse forever over a board they cannot see or touch. Owned
  privately by `HomeScene` at first, which broke **`?level=N` and `?custom=1`** — `main.ts` stops
  Home and starts Game directly, so `HomeScene.create` never ran. Reported from a phone as *"chỉ
  hiển thị AstroBall rồi mãi không play được"* and misread as a network problem for an hour,
  because every URL tested from a desktop went to `/` and worked. What found it was a one-page
  HTTP server run purely to prove the phone could reach the machine: its request log showed the
  phone asking for `/?level=31`, and the query string *was* the bug. **When a report and every
  local test disagree, log what the device actually asked for.** The editor's two "open the game"
  links are those same two URLs, so every hand-built board previewed that way was dead too.
- **`?reset=1` must run after `platform.init()`.** It was a top-level IIFE in `main.ts`, so it ran
  before the CrazyGames SDK had loaded: `sdk` was still null inside `platform.storage.removeItem`,
  the host branch was a silent no-op, and only `localStorage` was cleared. `dualStore.getItem` reads
  **the host store first**, so every value came straight back and the reset appeared to do nothing.
  ⚠ **It reproduces only if the keys were written through `save.ts`.** Seeding `localStorage` by hand
  to test it writes one store and passes on a build where real progress does not — which is exactly
  how it shipped. Seed with `CrazyGames.SDK.data.setItem` as well, or play the levels.
  ⚠ It clears **`SAVE_KEYS`**, not the keys `localStorage` happens to hold: a player arriving on a
  new device has their cloud save in the host store and nothing local, so the enumeration finds
  nothing to delete. Add a key to `save.ts`, add it to that list — nothing can check it for you.
- `src/game/save.ts` — localStorage behind the `ms_` prefix. ⚠ The prefix must stay distinct
  from other games or they share storage.
- `src/game/audio.ts` — synthesised WebAudio, no sample files. The marble knocks (`sfx.tumble`)
  are driven off **real Matter `collisionstart` events**, rate-limited to one every 45ms —
  Matter reports a burst of pairs for a single pile-up, and playing them all turns the ASMR
  into a buzz. Never loop a canned rattle instead: the whole point of the physics is that the
  rhythm is never the same twice. Remember `matter.world.off("collisionstart")` on restart,
  or listeners stack up across levels.
- Celebration art is baked in `bakeEffects` (spark, ring, sunburst, glow). ⚠ The box well is a
  **light** surface, so a white-on-white burst vanishes — the shockwaves are tinted with the
  box's own `dark` swatch and the sparks with its `base`. Fire them on demand to look at them:
  `npm run shot -- --level 12 --taps 2 --fx`; catching them mid-playthrough is hopeless at
  ~400ms. ⚠ Keep the box-clear burst **restrained** — a box clears several times per level, so
  it is punctuation, not an event. No camera shake: shaking the whole machine that often is
  exhausting rather than satisfying. The win screen is where the budget goes.
- `scripts/build-apk.mjs` · `scripts/setup-android.mjs` — Android packaging; the launcher
  icon is an SVG, there is no icon file. `capacitor.config.ts` — `com.marblesort.game`.

Conventions kept from the previous project:

1. **Bake every graphic at boot** (`textures.ts`), no `public/art/`.
   ⚠ **One exception, and it is deliberate:** `src/assets/home-cover.webp`, the 3D cover render on
   the home screen. There is no procedure that draws it. Imported rather than dropped in
   `public/` so Vite fingerprints it and it ships in `assets/` — 34 KB, against a 20 MB budget.
   ⚠ **The render carried a Gemini sparkle watermark** at 989-1025 x 1525-1561, which showed on
   screen as a small ✦ near the foot of the art. Painted out by bridging each row between the clean
   pixels either side of it — the backdrop there is a near-flat violet, so a 37px linear span is
   indistinguishable from what was under it — and re-encoded at webp q82, which came back **smaller**
   than the original (50122 B against 52262) for a mean deviation of 1.6/765 over the whole image.
   ⚠ Home paints its own two violets (`COVER_BG` sampled from the render's corner pixels,
   `HOME_FOOT`) instead of `UI.bgTop`/`UI.bgBottom`, and has **no halo and no rays**. Those sat
   behind the cover, so all they could do was brighten what it was *not* covering; at 5.6x the
   halo reached past its lower edge, and the band hiding that edge then masked a bright glow above
   and nothing below. That step — not any colour mismatch — was the hard horizontal line across
   the screen, and feathering the seam could not fix a discontinuity that was not at the seam.
2. **Generate levels from the level number with a seeded RNG**, no level files.
3. **Write the headless simulator early**, not last.

⚠ **The bundled `public/fonts/LilitaOne.ttf` is a Latin-only subset — no Vietnamese glyphs**
(no Ơ Ư Ế Đ Ă …). UI strings are therefore English, matching the reference game's own UI.
Swapping in a full Lilita One (Google Fonts serves a `vietnamese` subset) is what unblocks
Vietnamese copy; until then non-ASCII text falls back to Arial glyph-by-glyph and looks
broken.

## CrazyGames — one codebase, one build flag

`VITE_TARGET=web|crazy|android` (default `web`) picks a platform through `src/platform/`:
`base.ts` is the interface, `none.ts` the no-op web build, `crazy.ts` the CrazyGames SDK.
`npm run build:crazy` · `npm run build:web` — each builds and then **checks itself**.

⚠ **The door is an alias, not a runtime `if`.** `vite.config.ts` maps `virtual:platform` to one
implementation, so the other never enters the module graph. CrazyGames bans third-party ad
networks outright, and a runtime switch would keep the other store's SDK in the same bundle
however carefully the branch is guarded. `build-target.mjs` proves it every build: the web bundle
must contain **zero** files mentioning `crazygames`, the crazy bundle at least one.

⚠ **Nothing may read progress before `platform.init()` resolves.** The host preloads the player's
cloud save *during* init; a read before that returns the local copy, and the next write pushes
that stale copy over their real save. `main.ts` awaits init before the Phaser game exists, so
there is no loading-screen cap to race — and `crazy.ts` owns a 2.5s timeout because an adblocked
SDK script **never fires `onerror`** and would otherwise park those players forever.

⚠ **The gameplay signal lives in the `paused` flag, not at the call sites.** `gameplayStart/Stop`
is how the host knows when it may interrupt with an ad. Six places in `GameScene` set that flag;
emitting from the setter means the seventh, added later, is covered for free. Leaving the level is
hooked **once** on `shutdown` for the same reason. ⚠ `_paused` starts **true** so the first
`paused = false` actually fires a start — left at false the setter sees no change and the host
never learns the very first level began, which is the one level every reviewer plays.

⚠ **Storage keys are frozen from launch.** Automatic Progress Save backs `localStorage` up
verbatim, so renaming the prefix after launch restores old names into a game that reads new ones
and every player loses everything. The prefix moved `ms_` → **`bf_`** on 2026-08-13 with the
rename to **AstroBall**, which was free only because nobody had played yet. It is not free again.

⚠ The **editor is dropped from the crazy build** (`rollupOptions.input`), and `tools/iframe-test.html`
lives outside `dist/`. A dev tool that reaches a reviewer is the same mistake as a test harness in
the upload.

Current: **1.59 MB, 3 files**, relative paths — comfortably inside the 20 MB that qualifies for
the mobile homepage, which is a competitive advantage worth defending rather than a detail.
Reference material in `Manythings/CRAZYGAMES*.md` (written for the sibling "Hop In!" project).

## Commands

- Typecheck: `npx tsc --noEmit` · Dev: `npm run dev` · Android: `npm run apk`
- Level editor: `npm run editor` (or `/editor.html` on the dev server). `?level=N` and
  `?custom=1` on the game URL open a board directly, skipping the home screen.
- Screenshot a non-game page: `npm run shot -- --page editor.html [--js "<snippet>"]` —
  `--js` runs before the shot and reloads, for pages that boot from localStorage.
- Balance (bot-vs-bot): `npm run sim [levels]` · Predicted winrate: `npm run winrate 20-40`
- Check levels 1-29 against the sheet: `npm run sheet` (`NOWIN=1` for ingredients only, ~1s)
- Retune the ladder after any rule change: `npm run tune 20` (slow — it is playing thousands
  of games), then paste `LADDER` and `VARIANTS` into `level.ts`.
- Build + grade a run of levels: `npm run levels 20` (B = best play, D = slip 0.25, the
  (B+D)/2 shape Pixel Flow settled on). It flags any level where B and D disagree by more than
  35 points, because a mean of two models that disagree is a number neither of them believes.
- Build the **linked-pair** levels: `node scripts/pairs.mjs 40-45 --out block.txt`. Silhouettes are
  drawn as ASCII in the script (`<` marks a cell that may become a pair anchor); it sweeps pair
  count, board density, face-down share and colour count, and aims each level at a **Cuongxs1**
  target. Paste the block into `handmade.ts`. ⚠ It floors best play at 10%: the brief names one
  model's curve, and a board can land that curve while being a board *nobody* wins — one trial
  read Cuongxs1 30% with B and D both 0/20.
- Build an **easy run** to a Cuongxs1 floor: `node scripts/easy.mjs 86-115 --out block.txt`. Same
  shape as `pairs.mjs` — ASCII silhouettes, swept knobs, two-stage selection — but aimed at a
  **floor** rather than a target, because "above 90%" is one-sided and a target would reject the
  100% boards. `MIX` spells the feature blend out per level (exactly 3 pairs / 18 `?` / 3 crates /
  3 chocolate / 3 plain over 30) rather than sampling it, and the four are mutually exclusive.
  Built levels **86-115** this way.
  - ⚠ Its `unpeelable` check must use `y === rows - 1` for the chute mouth, exactly like
    `isSealed` and `canEscape`. Reading it as the board's lowest *occupied* row looks like the
    more careful rule and is a third disagreeing copy of the escape test: three of five
    silhouettes passed validation and then produced no winning line on any trial, because a shape
    floating above an all-casing bottom row has its real bottom row sealed. **Shapes sit on the
    last row; blank rows go at the top.**
  - ⚠ The size tiebreak decides everything once the floor is one-sided. Left preferring the
    smallest board, 27 of 30 came out 5x5 — five silhouettes at one size reads as one board
    recoloured thirty times. It now alternates, and `--trays N` aims at a size for a level being
    rebuilt inside an existing ladder.
  - ⚠ `--nohatch` exists because the shipped run has **no hatch before level 8**. Rebuilding an
    early level with one is an easier board that teaches a mechanic two levels early.
- Check the revive against real jams: `npm run revive` (levels 1-45; `npm run revive 20 12` for a
  quick pass). Exits non-zero if any revived board's marbles and holes stop matching.
- Rank the candidate models after a playtest: `PURE=1 npm run winrate -- --models`
- Real-game screenshots: `npm run shot -- --level N`
- `?reset=1` on the URL wipes saved progress — the way to reset on a phone.
