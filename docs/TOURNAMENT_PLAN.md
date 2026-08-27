# Tournament Management Upgrade — Plan and Decisions

This is the working design document for turning the ROV pick/ban overlay into a
full tournament management app in the spirit of Challonge, with **every piece of
user data stored locally on the user's device**. No accounts, no cloud, no hosting.

It is written to stand alone: if you pick this up in a fresh session, with no
conversation history, everything needed to continue is here or in `CLAUDE.md`.

---

## 0. Where things stand

**Last updated 2026-08-12.** Everything up to `014bafe` is committed **and
pushed**. Everything after it is committed on the branch `tournament-phases-6-7-8`
and **not yet merged or pushed**.

| Commit | What |
|---|---|
| `07914a2` | Phase 0 — split `server.js` into modules, shared client lib, 23 tests, `npm run check` |
| `168e21b` | Phase 1 — SQLite data layer for tournaments and teams, 16 more tests |
| `8f57759` | TypeScript conversion of `server/` and `tests/` |
| `7b00e06` | This document brought up to date |
| `bf76d9e` | Phase 2 — home is the tournament list, `/tournament/:id` detail page |
| `16fe9bb` | Phase 3 — team registry UI, per-team logos, rosters, cap in the UI |
| `a3cf985` | Phase 4 — bracket generation, random draw, series results |
| `dcee2c3` | Double elimination with grand-final reset |
| `72ddb6f` | Phase 5 — match to control panel, live pointer, **draft capture** |
| `418b23d` | Bracket page at `/tournament/:id/bracket` |
| `23bd837` | Phase 6 — `/teams` directory, `/teams/:id` profile with match history |
| `23bd837` | Match session split out of the tournament page, bracket-only |
| `23bd837` | Teams section on the tournament page: foldable and compact |
| `23bd837` | Phase 8 — `/analytics`, per-game winner capture, live room |
| `23bd837` | Phase 7 — `/overlay-teams` team list with staggered slide-in |

Current state: **0 type errors under `strict`, 139 tests passing.** Creating a
tournament, adding a team with its players in one form, uploading logos,
drawing single/double elimination, round robin and group brackets, recording
Bo3/Bo5 results, opening a match in the control panel and having its draft
recorded all work end to end in the browser.

**The team registry has its own pages now.** `/teams` lists every team ever
created with a search box and a one-form create; `/teams/:id` is the profile —
roster editing, logo, the tournaments entered, and match history across all of
them. Both were driven in a real browser, not only through tests: creating a
team, drawing a bracket, playing it out and deleting an opponent all render as
intended.

Record counting has one rule worth keeping: **a bye is listed but never counted
as played.** Counting it would flatter whichever team happened to draw the odd
slot.

**Draft capture is live.** Every pick and ban is mirrored into its game record
the moment it is made — no save step, nothing to forget. This was the deadline
item: games drafted before capture existed would have been unrecoverable.

`tournament.db` is created on first use of a tournament feature, not at
startup, so anyone using only the overlay never grows a database file. It is
gitignored — it is user data, not source.

**The match session is its own page.** `/tournament/:id/bracket` is no longer a
read-only bracket view — it is where matches are *run*. It owns DRAW MATCHES
(seeded or random), CLEAR, score entry, and putting a match on air. The
tournament page keeps only pre-match setup — details, teams, OBS URLs — plus a
progress count and a link through.

The split follows how the tool is actually used: entering teams and choosing a
format happens once, before the event; drawing and scoring happens live, under
time pressure, and wants a page with nothing else on it.

**The Teams section on the tournament page folds, and its rows are compact.**
One row is a single 40px line — small logo, name, tag, seed and player count
inline, with the remove button reduced to `✕`. Twelve teams take 535px instead
of roughly 930. The fold state is remembered in `localStorage`, because teams
are arranged once at the start while the page is reopened all event; having to
re-fold on every visit would annoy more than the missing button ever did. The
count badge stays in the header when folded, so the section still reports how
many teams are in.

Density is a `.team.compact` modifier, **not** a change to `.team` — `/teams`
uses the same class with more badges per row and a search box to cut the list
down, so it keeps the roomier layout.

**The bracket is the only match view.** The flat list that used to sit on the
tournament page is gone rather than duplicated. Two views of one dataset drift,
and the list had already drifted — it labelled rounds `Round N` while the
bracket called the same rounds Final / Semifinals. Scores are typed directly
into the boxes in the bracket.

Rounds are columns, connectors are drawn with CSS pseudo-elements, and clicking
a playable match puts it on air and opens the control panel. Late rounds are
named Final / Semifinals / Quarterfinals rather than by number — **but only for
elimination formats.** Round robin keeps `Round N`; its last round is not a
final, every team is still playing.

The layout uses one rule: every round column is the same height and its slots
share it with `flex: 1`. Round 2 has half as many slots, so each is twice as
tall, and centring the box in its slot lands it exactly between the two feeding
it. No pixel maths, and it holds for any bracket size.

**Every phase in the table below is now built.** Phase 8 was done ahead of
Phase 7, out of order, because the plan's own analytics section was the thing
being worked from at the time.

**The `/teams` collision, for the record.** Appendix A below was written
before the directory existed and lists `/teams` as an overlay route; Phase 6
took that path for the operator page, so the overlay uses `/overlay-teams`. There is a
comment on the route table in `server/http/pages.ts` saying so.

**Phase 7 is built.** `/overlay-teams` shows the roster of a tournament as a
staggered slide-in, for the pre-show. It is **not** `/teams` — that is the
operator directory from Phase 6, and a test now asserts the two stay apart.

URL options, all optional: `?tournament=<id>` (defaults to the live match's
tournament, then the newest one), `?title=`, `?subtitle=`, `?columns=1..6`,
`?roster=off`, `?stagger=<ms>`. The tournament page's OBS section lists it with
the id already in the URL, ready to paste.

**The entrance guarantees its own end state.** Cards start at `opacity: 0` and
are carried in by the animation, so an animation that never runs means a blank
graphic on air — worse than no animation at all. A timer adds `.settled` after
`stagger x (n-1) + duration + 600ms`, which forces the final state outright.
Verified by pausing every animation and confirming: `animationend` fired zero
times, and all six cards still ended at full opacity.

Two things only showed up by running it, not by reading it:

- **`Number(null)` is `0`, and `0` passes `Number.isFinite`.** The parameter
  parser returned 0 for anything not supplied, so the default stagger never
  applied and every card entered at once. Nothing errored; the feature this
  phase is named after was simply absent.
- **A 90ms stagger x 64 teams is a six-second entrance.** The step now shrinks
  so the whole cascade lands inside ~2.2s, unless `?stagger=` was given
  explicitly, in which case the operator's choice is respected.

**Large rosters scale rather than clip.** Only nine rows fit at full size, so
past ~45 teams the last cards fell off the canvas — and `overflow: hidden` cut
them silently, which on a broadcast graphic means teams missing from the list
with nobody noticing. The grid now measures its real extent and scales to fit;
64 teams render at 0.75 with every card inside 1920x1080.

Measure that extent from the last card's `getBoundingClientRect().bottom`, not
`scrollHeight`. With `overflow: visible` the content is not in a scrollable
region, so `scrollHeight` equals `clientHeight` and reports "never overflowing".
The first version did exactly that and the scaling never once ran.

### Starting a fresh session

Read this file and `CLAUDE.md`, then `git log --oneline -12`. Run `npm test`
and `npm run check` to confirm the baseline before changing anything.

The standing rule from the user: **any phase work updates this document in the
same change** — there is a section on it in `CLAUDE.md`.

**Double elimination is implemented**, with the grand-final reset: the losers
bracket winner must beat the winners bracket winner twice, because the winners
side has not lost yet. If the winners side takes the first grand final, the
reset match is emptied so it cannot be played.

Losers routing is the fragile part, so the tests play whole brackets out and
assert nobody survives a second loss, every destination exists, and no two
matches feed the same slot.

---

## 1. Confirmed decisions

Decided with the user. Do not re-open without a reason.

| Decision | Choice | Why |
|---|---|---|
| Storage | Local only, SQLite | Matches the free non-commercial license; no ops cost |
| Round robin size | Capped 24 teams; group stage above that | 128-team RR is 8,128 matches — unusable as one bracket |
| Concurrent matches | One live match at a time | There is one overlay; other matches keep their own saved drafts |
| Existing presets | Kept as standalone quick-match | Still useful outside tournaments; nothing migrated |
| Teams | Global registry + per-game snapshot | See §4 |
| Team logos | Global, keyed by server-generated team id | Never named from user-typed team names |
| 128 limit | Per-tournament roster, not the registry | The directory may hold hundreds over time |
| Operator UI stack | Stay on Electron/Node + HTML | See Appendix A |
| Language | TypeScript, `strict` | The id graph ahead is where types earn their keep |

---

## 2. Tech stack decisions and the reasoning

**SQLite via `node:sqlite`, not `better-sqlite3`.** `better-sqlite3` is a native
module that needs rebuilding for each Electron version — historically the step
that breaks on upgrade. `node:sqlite` ships inside Node itself. Verified working
in Electron 43 (Node 24.17) by direct probe before committing to it. Zero
dependencies, nothing extra for electron-builder to get wrong. `DatabaseSync` is
synchronous, matching the existing `readFileSync` style, so no async rewrite.

**TypeScript 5.9, deliberately not 7.x.** npm installs 7.x by default now; it
failed immediately because TS 7 (the Go rewrite) has already removed
`moduleResolution: node10`. Too new to sit under a tool used live on stream.

**Compiler output is `build/`, not `dist/`.** `dist/` is electron-builder's
output directory. Sharing it would have the two build systems overwriting each
other.

**`@types/express` pinned to `^4.17`.** npm installs v5 by default, which
describes Express 5 — the project runs Express 4.22.

**Only `server/` and `tests/` are TypeScript.** `public/js/` is still plain
JavaScript, served as classic `<script>` tags with no bundler. See §8.

---

## 3. Data layout

```
DATA_DIR/
  state.json       live broadcast match   (existing, unchanged)
  presets.json     quick-match presets    (existing, unchanged)
  tournament.db    SQLite: tournaments, teams, rosters, matches, games, drafts
```

**Tournament data must never live inside `state.json`.** `sanitizeState` rebuilds
state from a fixed key list, so unknown keys are dropped on the next save. A
separate file means an older build simply ignores it instead of erasing it.

No migration script is needed for existing users. `sanitizeState` already fills
missing keys from defaults, which is why today's older `state.json` still loads.

**Schema** lives in `server/store/migrations.ts` as numbered steps tracked in
`PRAGMA user_version`. Append new steps only — never edit a released one, or
machines that upgraded and machines that installed fresh end up with different
schemas. Current step 1 creates: `teams`, `team_players`, `tournaments`,
`tournament_teams`. Step 2 adds `matches`. Step 3 adds `games`, `game_slots`
and `live_match`. Step 4 adds loser-routing columns to `matches`.

Foreign keys and WAL are enabled on open. `openDatabase(path)` takes a path so
tests use `':memory:'` and never touch the user's file.

---

## 4. Teams: registry plus snapshot

`teams` is the canonical, editable team profile — name, tag, logo, current roster
of five slots with one captain.

Each **game record** stores a frozen copy of
`{teamId, name, logo, players}` as they were at that match.

The reason for both: the registry is the team *as it is today*; the snapshot is
*who actually played*. Without the snapshot, editing a roster next season
silently rewrites last season's match pages and corrupts the pick/ban statistics
that depend on them.

Team ids are generated server-side (`server/domain/ids.ts`) and validated with
`isSafeMediaId` before being used as a filename. Logos live at
`media/team-logos/<teamId>.<ext>`, alongside the live match's `blue-team` and
`red-team` slot logos.

Sharing that folder is safe because the two naming schemes cannot collide —
slot logos are fixed words, registry logos are `t` + hex — but `isTeamLogoId`
rejects the reserved slot names anyway, in case the id format ever changes.
A test creates a team literally named `../../evil name` and asserts the file
still lands as `<id>.png`.

A team is created **with its players in one form** — name, tag, five player
slots with a captain, and optionally a logo, all in a single CREATE & ADD.
The logo still uploads after creation because its filename comes from the
server-generated id, but that is hidden from the user.

The create form and the edit panel share one `buildPlayerRows` helper. They
were written twice at first, which is how the two drift apart. It now lives in
`public/js/lib/team-ui.js` as `window.RovTeamUI`, together with `logoImage`,
`sendLogo` and the defensive `on()` binder, because Phase 6 added two more
pages that needed all four. **Any page loading it must include the script tag
before its own** — a test asserts this for all three pages that do.

**Phase 6 cashed in the snapshot.** `server/store/history.ts` reads a team's
matches from every tournament at once. Opponent names normally come from the
registry by join, but when an opponent has been deleted `matches.team_b_id` is
NULL (`ON DELETE SET NULL`) and the join yields nothing — so the query falls
back to the frozen `blue_name`/`red_name` on the game record. The profile shows
that name greyed out and unlinked, with a tooltip saying where it came from.
Without the snapshot, a deleted team would turn every match it ever played into
"opponent unknown".

The fallback matches on **team id, not on side**, so it does not depend on
`goLive` always putting side A on blue.

Its limit, worth knowing: the snapshot is written when a match goes **on air**,
not when the bracket is drawn. A match whose score was typed in without ever
opening it in the control panel has no game record, so a later deletion of the
opponent leaves that row with no name to recover.

---

## 5. Formats and limits

Implemented in `server/domain/tournament.ts`, enforced in
`server/store/tournaments.ts` — **in the store, not the page.** The UI should
also block it for good UX, but the rule holds even if the page is bypassed.

| Format | Min | Max |
|---|---|---|
| `single_elim` | 2 | 128 |
| `double_elim` | 4 | 128 |
| `round_robin` | 2 | **24** |
| `group_stage` | 4 | 128 |

Series length per match: Bo1 / Bo3 / Bo5 / Bo7. Bo2 and Bo4 are rejected — they
cannot decide a winner.

**Changing to a format with a lower cap is refused, not truncated.** 30 teams
switching to round robin returns an error and drops nobody. Silently deleting
six teams because someone changed a dropdown is the worse failure.

Random seeding uses a Fisher-Yates shuffle with an injectable RNG, so tests get
deterministic draws. **Round robin uses the circle method**, which
makes "no team appears twice in a round" true by construction rather than by
retrying until it looks right. Implemented in `server/domain/bracket.ts`.

`DRAFT_SEQUENCE` in `server/domain/draft.ts` is still a fixed 16-phase, 4-ban
sequence. Draft format needs to become per-tournament configuration before match
records reference it. Add new sequences as separate tables — do not edit the
existing one, because saved matches will reference it.

---

## 6. Analytics

**Built.** `/analytics`, with scope filters for tournament and team. The metric
table below is implemented in `server/domain/analytics.ts` (pure maths) over
`server/store/analytics.ts` (one grouped query). Recompute-on-read, as planned.

**Capture continuously, not at the end.** Today every RESET MATCH and preset load
destroys the current pick/ban data. Mirror each pick and ban into the game record
as it happens, so nothing is lost if the operator forgets to save, and
"real time" needs no extra machinery.

This must ship with or before the first playable match. Games drafted before
capture exists are unrecoverable.

**The same deadline applied twice, and the second time was nearly missed.**
Draft capture shipped in Phase 5, but *per-game winners* did not. `games.setWinner`
existed from Phase 5 and was called from nowhere, so `games.winner` was NULL for
every game ever recorded — win rate had no numerator, and no way to reconstruct
one. A Bo3 that ends 2-1 records the series winner; nothing says who took game 2.

Fixed by a **WHO WON GAME N?** control on the Control Panel's ON AIR bar, writing
through `PUT /api/games/:gameId/winner`. Pressing the already-chosen side clears
it, so a misclick needs no separate undo. Any game played before this existed has
no win rate and never will.

**Denominator is games, not draft slots.** Dividing by slots makes every hero's
share sum to 100%, which answers no useful question.

| Metric | Meaning |
|---|---|
| Pick rate | games picked ÷ games |
| Ban rate | games banned ÷ games |
| Presence | games picked **or** banned ÷ games — lead with this |
| Win rate | wins ÷ games picked **that have a recorded winner** |
| Ban priority | restricted to first-phase bans |

Win rate deviates from the original wording on purpose. Dividing by every game a
hero was picked in counts games nobody recorded a winner for as losses, which
silently understates every hero as soon as one game is missed. The denominator is
games with a winner, the page reports how many that is, and a hero with none
shows `—` rather than `0.0%` — "not measured" and "never won" must not look alike.

**First-phase bans are ban `idx` 0 and 1.** `DRAFT_SEQUENCE` phases 1-4 write
`blueBan0/redBan0/blueBan1/redBan1`; the second ban phase (9-12) writes idx 2-3.
So ban priority needs no schema change — it falls out of the index already
stored. A test pins this to the sequence so a future draft format cannot quietly
break it.

Scale: 129 heroes, 18 consumed per game, so a typical hero sits near 7.8% pick /
6.2% ban / 14% presence. Signal is in the top ~30.

Only count games whose draft is **locked**; render an in-progress draft as a
separate live layer, never folded into the percentages, or every hero's rate
lurches downward mid-draft.

Cost is negligible — 300 games × 18 slots is a sub-millisecond loop, so recompute
on read rather than maintaining incremental counters. Broadcast to a Socket.IO
**room** so only the analytics page pays for the payload.

**The room carries a signal, not a payload.** Clients view different scopes (all
games / one tournament / one team), so one broadcast payload cannot serve them.
The server emits a bare `analyticsChanged` to the `analytics` room and each page
refetches its own scope. It fires on two edges only: a draft locking, and a
winner being recorded — the only two moments the locked numbers can move.

The lock edge is rising-only. Capture runs on every pick, so emitting whenever
the draft *is* locked would tell the page to refetch on every later keystroke.

**The live layer hides itself once the draft completes.** A finished draft is
already inside the percentages, so leaving it on screen under "not counted until
the draft is complete" states the opposite of the truth. The page recomputes
completeness from the state it already receives rather than asking the server.

---

## 7. Phases

| Phase | Work | Status |
|---|---|---|
| 0 | Modularize `server.js`, shared client lib, tests, `npm run check` | done `07914a2` |
| — | TypeScript conversion | done `8f57759` |
| 1 | Tournament + team data layer (SQLite) | done `168e21b` |
| 2 | Home becomes the tournament list; `/tournament/:id` | done `bf76d9e` |
| 3 | Team registry UI, logos, rosters, 128 cap in the UI | done `16fe9bb` |
| 4 | Formats, bracket generation, random matching | done `a3cf985` + double elim |
| 5 | Match → control panel, live pointer, draft capture | done `72ddb6f` |
| 6 | `/teams` directory and `/teams/:id` profile with history | done `23bd837` |
| 7 | Team-list overlay with staggered slide-in, at `/overlay-teams` | done `23bd837` |
| 8 | Pick/ban analytics, live, per tournament and per team | done `23bd837` |

The team-list overlay must not rely on `animationend` alone — OBS freezes browser
sources that are off-scene, so the event may never fire. Use the timer fallback
pattern already in `public/js/overlay.js`.

---

## 8. Open items

- **A relative asset path on a nested page breaks silently** — see §9. `/tournament/:id`, `/tournament/:id/bracket` and now `/teams/:id` are all affected. Any new nested page must use absolute `/js/` and `/css/` paths; tests cover the tournament and team pages.
- **A match played without going on air has no team snapshot.** Scores can be typed straight into the tournament page, which never creates a game record. If an opponent is deleted later, that row loses its name for good — see §4. Creating the snapshot at draw time would close the gap.
- **`public/js/` is not TypeScript, and it has now cost a real bug.** Phase 3
  shipped `tournament.js` referencing `controlToken` without destructuring it
  from `window.RovClient`. Logo upload threw `ReferenceError`, the `catch`
  turned it into a toast, and it looked like an upload failure. A compiler would
  have caught it before the browser did. Converting needs a second tsconfig
  (browser target, no module syntax, `window.RovClient` globals) and a serving
  strategy for the output. This is the strongest remaining argument for doing it.
- **Global hotkeys via Electron `globalShortcut`.** Agreed but not built. Lets a
  caster drive the draft while OBS has focus. The app's own hotkeys page
  currently implies this is impossible — true for a browser page, not for the
  Electron main process.
- **The losers bracket has never been seen rendered.** `bracket.js` groups by
  the `bracket` column so it should section into Winners / Losers / Grand final
  on its own, but that is inference, not observation. Draw a double-elimination
  bracket and look at it before trusting the layout. This matters more now that
  the bracket is the only way to see or score a match.
- **The match session page is still at `/tournament/:id/bracket`.** The name
  describes the view, not the job it now does. Renaming it to `/matches` would
  read better but breaks bookmarks and a test; not worth doing on its own,
  worth folding into any later change that touches those routes.
- **A 128-team bracket has never been scored through the boxes.** Score entry
  moved into the match boxes, which are ~24px wide. That is comfortable at four
  teams; it is untested at the sizes where the bracket scrolls in both
  directions.
- **All four test goals are met.** 1: the 128-team cap is enforced in the store
  and refuses the 129th. 2: Bo1/3/5/7 all decide on a strict majority through
  one `seriesWinner`. 3: round robin uses the circle method so no team can
  appear twice in a round, by construction rather than by retrying. 4: the room
  for future work is the migration runner, the pure `domain/` layer and the
  127-test suite.

---

## 9. Traps already paid for

Each of these cost real debugging time. They are also in `CLAUDE.md`.

- **`config.ts` computes `ROOT_DIR` two levels up**, because at runtime it lives
  at `build/server/config.js`. Get it wrong and `public/`, hero images and the
  data directory resolve to nowhere *while the server still starts*.
- **`build.files` ships `build/server/**/*`, not `server/**/*`** — the compiled
  output, never the source. A missing entry builds a clean `.exe` that dies on
  launch.
- **`require('./server/index')` never `require('./server')`.** Node resolves
  files before folders, so the short form loads `server.js` into itself.
- **`getState()`/`setState()`, never a captured reference.** State is replaced
  wholesale on preset load and reset.
- **No escape sequences for control characters in source.** Some tooling turns
  them into real bytes, including NUL. `npm run check` fails the build if raw
  control bytes appear anywhere.
- **Hero identity is an image filename.** Renaming a hero image voids historical
  records referencing the old name. Stored history is opaque — never re-sanitize
  it against the live roster.
- **`switchTeams` swaps sides wholesale.** Side-split statistics need the side
  recorded at capture time.
- **Nested pages must use absolute asset paths.** `/tournament/:id` is one level
  deeper than the rest and `/tournament/:id/bracket` is two; a relative
  `js/x.js` resolves under the tournament path and 404s. Covered by a test in
  `tournament-api.test.ts`.
- **Closing a SQLite database before deleting its folder** — Windows refuses the
  delete while WAL handles are open. Test cleanup calls `closeDatabase()` first.
- **In an elimination bracket, `null` means two different things.** In round 1
  it means "no team here" (a bye). In every later round it means "the winner is
  not known yet". Treating them alike gave every bye-winner a free ride to the
  final without playing. **Byes can only exist in round 1.** Tests assert both
  that rule and that a bracket always takes exactly `n-1` played matches.
- **`matches.team_a_id` uses `ON DELETE SET NULL`, not `CASCADE`.** Deleting a
  team mid-tournament must empty its slots, not delete the schedule around it.
- **Reopening a live match must restore its saved draft first.** Draft capture
  is attached to `emitState`, so putting a match back on air with a blank draft
  makes the very next emit overwrite the stored one with emptiness — simply
  looking at a match would erase it. `goLive` calls `restoreDraft` before
  `setState`, and a regression test covers it.
- **An empty opponent slot means two different things, again.** Same shape as
  the bye trap above, one level up. In a team's history a NULL opponent is
  either "the other semifinal has not been played, so nobody is here yet" or
  "somebody was here and their team was deleted". `history.ts` splits them on
  the match status: only a **complete** match with an empty slot is a deleted
  opponent, and only then does it read the frozen name off the game record.
  Treating them alike shows "to be decided" on matches that were played and
  won years ago. Both directions have a test.
- **A page using `buildPlayerRows` must load `/js/lib/team-ui.js` before its
  own script.** Miss the tag and the page dies on the destructure line at the
  top of the file — nothing renders, no handler binds, and the console error
  points at a line that looks fine. `team-api.test.ts` asserts the tag is
  present *and* ordered first on all three pages that need it.
- **An entrance animation that carries an element in must be able to finish
  without running.** OBS freezes off-scene browser sources, so `animationend`
  can never fire. If the element's resting state is `opacity: 0` and only the
  animation makes it visible, a frozen source shows an empty graphic forever.
  Every such animation needs a timer that forces the end state outright, not
  just one that cleans up a transient class.
- **`Number(null)` is `0`, and `0` is finite.** `Number(params.get('x'))` for a
  parameter that was not supplied gives 0, which sails past `Number.isFinite`
  and becomes a real value instead of falling back to the default. Check for
  `null` and empty string *before* converting.
- **`scrollHeight` equals `clientHeight` when overflow is visible.** Content
  that spills out of a non-scrolling container is not in the scrollable overflow
  region, so `scrollHeight` reports no overflow no matter how far it spills.
  Measure the last child's `getBoundingClientRect().bottom` instead. An
  overflow check written the first way never fires, and on a broadcast graphic
  that means teams silently missing off the bottom of the canvas.
- **A store method nobody calls is not a feature.** `games.setWinner` was written
  in Phase 5, fully implemented, covered by the type checker — and reached from
  no route, service or handler for three phases. Nothing failed, no test broke;
  the column was simply always NULL. Grep for a caller before assuming stored
  data exists, especially data that cannot be reconstructed later.
- **Never let "not measured" render the same as "measured zero".** A hero with no
  recorded winner has `winRate: null` and shows `—`; a hero that lost every game
  shows `0.0%`. Collapsing null to 0 would have made every hero look terrible in
  exact proportion to how often the operator forgot to press the button.
- **`Get-Content -Raw` + `Set-Content -Encoding utf8` destroys Thai comments.**
  PowerShell 5.1 reads a BOM-less UTF-8 file as the ANSI codepage, so writing it
  back as UTF-8 double-encodes every non-ASCII byte, and `-Encoding utf8` adds a
  BOM on top. Nine files of load-bearing comments were mangled in one command.
  It is reversible (read bytes as UTF-8, re-encode as CP1252, strip the stray
  leading byte) but the fix is not to do it: **edit HTML with the Edit tool, not
  with shell text rewriting.**
- **A control that lives inside a foldable section must open the fold itself.**
  The add-team form sits inside the part that folds away, but its button sits in
  the header that stays. Pressing + ADD TEAM while folded set `hidden = false`
  on a panel nobody could see — a button that visibly does nothing. It now
  unfolds first, then opens the panel.
- **A clickable box with an input inside it eats the input's clicks.** The whole
  match box is the "put this on air" button, and the score fields sit inside it.
  Without `stopPropagation` on `click`, `mousedown` and `dblclick`, trying to
  type a score navigates to the Control Panel instead. Verified by clicking the
  field and asserting the URL did not change.
- **Naming rounds Final / Semifinals only makes sense when losing eliminates.**
  `roundTitle` keyed off the bracket being `main`, which round robin also uses,
  so a three-round round robin announced "Quarterfinals, Semifinals, Final"
  while every team was still playing. It takes the `elimination` flag now. The
  bug predates the match-session split but was invisible while the flat list,
  which said `Round N`, was the view people used.
- **Driving the app in a browser writes to real local data.** A verification
  pass that puts a match on air rewrites the tracked `data/state.json`, and any
  tournament feature creates `data/tournament.db`. Stop the server before
  deleting the db (Windows holds WAL handles) and `git checkout -- data/state.json`
  afterwards, or the next commit carries a stranger's test match.

---

## Appendix A — the C# native option (deferred, not rejected)

Considered 2026-08-06: build every operator page in C# and keep only the overlays
in HTML/CSS/JS.

```
C# desktop app (WPF / WinUI 3 / Avalonia)
   ├── operator UI: tournaments, teams, brackets, control panel, analytics
   ├── data: SQLite
   └── embedded ASP.NET Core (Kestrel) + SignalR
          └── serves only /overlay, /overlay-1440, /result, /teams
```

**Gains:** native global hotkeys, virtualized grids for 128-team rosters, typing
throughout, far smaller install than Electron, faster startup. Use **WebView2**
for the Design page preview so the overlay CSS is never re-implemented in XAML.

**Costs:** rewriting ~4,000 lines of working operator UI; two languages
permanently; the state contract becomes an API boundary where one `sanitizeState`
serves both sides today; Windows-only unless Avalonia.

**The split is not clean.** Data entry and large grids favour C#; brackets and
analytics charts are easier in HTML/SVG. A 128-team bracket with connector lines
is harder in XAML than in SVG.

**Timing:** the cheap moment to switch is *before* the tournament UI exists.
Afterwards, switching discards far more than the control panel does today.

**Deferred because** the deciding factor is C#/XAML proficiency, and learning WPF
while designing a tournament system means two hard problems at once. The module
boundaries map onto C# almost 1:1 (`domain/` → domain classes, `store/` →
repositories, `sockets/` → SignalR hubs), so this document and that structure are
the starting point if it is ever picked up.

**Revisit if:** C# fluency arrives, Electron install size becomes a real
complaint, or operator UI performance suffers at 128 teams.
