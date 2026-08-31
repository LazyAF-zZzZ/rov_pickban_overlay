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

Current state: **0 type errors under `strict`, 159 tests passing.** Creating a
tournament, adding a team with its players in one form, uploading logos,
drawing single/double elimination, round robin and group brackets, recording
Bo3/Bo5 results, opening a match in the control panel and having its draft
recorded all work end to end in the browser.

### The 2026-08-31 session

Eleven changes, none committed. Listed in the order they were asked for, because
later ones depend on earlier ones.

1. **Esc goes back a page.** `goBack()` in `public/js/lib/app-client.js`, on a
   `window` bubble listener. It stands down for typing fields, for
   `defaultPrevented`, and whenever a `.modal-backdrop` is visible — a modal's
   own Esc-to-close must win. History is only used when the previous page was
   this app (same-origin referrer); otherwise it falls back to
   `[data-esc-back]`, then `/`. Following browser history blindly would walk
   the operator out of the tool mid-event.

2. **Deleting a tournament, hard.** `DELETE /api/tournaments/:id` with
   `ON DELETE CASCADE` behind it — no soft-delete flag, no orphan rows. The
   store counts teams, matches and games **before** deleting so the toast can
   say what went; the route captures `wasLive` before and calls `clearLive()`
   after, or the overlay keeps pointing at a tournament that no longer exists.
   The confirmation lives in one place, `public/js/lib/tournament-ui.js`, and
   adds an extra line when that tournament is on air right now.

3. **Every operator page redesigned.** `public/css/theme.css` is the new design
   system: black, white and gold, one system font, no glow and no neon. Gold
   means "happening now" and nothing else; blue and red mean team sides only.
   Broadcast pages were deliberately left out — see the rule in `CLAUDE.md`.

4. **Presets removed.** `presets.html`, `presets.js`, `api-presets.ts`,
   `store/presets.ts` and `data/presets.json` are all gone; the registry team
   picker on the Control Panel replaced what they were for. They are not coming
   back.

5. **Overlay sound effects.** `public/js/overlay-sfx.js`, Web Audio rather than
   `<audio>` — see §9 for why that was not a style choice. Opt-in per source
   with `?sfx=1`, one `GainNode` per event, files dropped into
   `USER_SOUND_DIR` by fixed name. Per-event levels (pick / ban / timer) live in
   `state.sfx`, ride `CARRIED_OVER_KEYS`, and have sliders on the Control
   Panel. The ten-second countdown ticks once per second, not once at ten.

6. **OBS browser sources on the Control Panel.** `public/js/lib/obs-sources.js`,
   one shared list, overlays default to the `?sfx=1` variant. Copy-to-clipboard
   races a 600ms timeout and falls back to `execCommand`, and clicking the URL
   selects it — see §9.

7. **An in-app guide at `/guide`.** Nine numbered steps, bilingual, no external
   resources, including the point the user asked for explicitly: the overlay
   source must stay open in the live scene or OBS mixes no audio from it.

8. **Thai, and Thai is the default.** `public/js/lib/i18n.js`, ~196 entries
   keyed by the English source string. See the section in `CLAUDE.md`; the
   remaining work is in §8.

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

Sections run Winners → groups → Losers → Grand final, and match numbers follow
that same reading order. Connectors are drawn with CSS pseudo-elements, and clicking
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

**Pages sync themselves in real time.** Tournament, match session, team
registry, team profile, control panel and analytics all follow changes made
anywhere else, with no refresh. Two operators on two screens now see the same
thing, which is the case the tool is actually used in.

The mechanism generalises the analytics room from Phase 8 rather than adding a
second one. `server/services/sync.ts` emits `dataChanged` into one room with a
topic — `teams`, `tournaments`, `roster`, `matches`, `games` or `live` — plus
the ids it concerns. It carries **no data**: pages filter to different scopes, so
one payload cannot serve them all, and each page refetches only what it shows.
Overlays never join the room, so they pay nothing for operator churn. A test
asserts exactly that.

**Auto-refresh must never overwrite what someone is typing.** A refresh landing
mid-edit wipes a half-typed roster, and during an event that is worse than being
briefly stale. `deferWhileEditing(root, run)` runs the refresh immediately when
nobody is editing inside that region, and otherwise waits until they finish and
then runs it once, however many signals arrived meanwhile.

It waits on a **timer, not `focusout`**. Focus events do not fire at all while
the window is unfocused — which is the normal state when the operator has tabbed
over to OBS with the cursor still parked in a field. The event version leaves
that page stale forever; the timer does not care whether the window has focus.

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
| Existing presets | **Removed 2026-08-28** | The team registry does the same job better; see §2 |
| Teams | Global registry + per-game snapshot | See §4 |
| Team logos | Global, keyed by server-generated team id | Never named from user-typed team names |
| 128 limit | Per-tournament roster, not the registry | The directory may hold hundreds over time |
| Operator UI stack | Stay on Electron/Node + HTML | See Appendix A |
| Language | TypeScript, `strict` | The id graph ahead is where types earn their keep |
| Operator UI look | Black, white and gold, one token file | Decided 2026-08-28; see §2 |

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

### Presets, and why they are gone

Presets were a saved copy of a whole match state — team names, players, score and the
draft — kept in `presets.json` under a name the operator typed. They predate the team
registry, and once the registry existed they were the second, worse place the same
information lived: a preset held a frozen copy of a lineup, while a registered team is
one record shared by every tournament, carries a logo and accumulates match history.

Removed on 2026-08-28: the page, `api-presets.ts`, `store/presets.ts`, `presets.json`
and the nav link. Nothing was migrated — the user's presets file was empty.

The one thing presets did that tournaments did not is now on the Control Panel itself.
**`POST /api/teams/:id/live` with `{ team: 'teamBlue' | 'teamRed' }` loads a registered
team into one side of the overlay**, and each team panel has a "From registry" picker
that calls it. It fills the name, the roster and the logo, and deliberately touches
**one side only** — the other side, the score and any draft already typed must survive,
because the operator picks the second team while the first is already set up. A one-off
match outside any tournament is now: open Control, pick both teams, go.

`carryOverSettings` survives the removal. It was shared with preset loading, but its
real job is putting a match on air without resetting the theme, hotkeys or overlay size.

### The operator theme

`public/css/theme.css` holds every colour, the type scale and the chrome each operator
page repeats (top bar, nav, buttons, panels, fields, badges, the confirm box, the toast).
Each page's own stylesheet keeps only what is unique to it, and every operator page links
`theme.css` first. The three pages that carry their styles inline — Control, Design,
Hotkeys — link it too and their `<style>` blocks now start below the shared layer.

The palette is black through dark grey, near-white text, and gold as the single accent.
**Gold means "this is what is happening now"**: the current page in the nav, the primary
action in a form, the focused field, the match on air, the draft slot whose turn it is.
Spread it wider than that and it stops meaning anything.

Blue and red survive as **team sides**, never as decoration — the blue panel on the Control
Panel, the side chips in Analytics, the two sides of a match row. Red doubles as the
colour of destructive actions, which reads as a different context and does not collide.
There is no green and no purple; every "positive" or "live" state is gold now.

The broadcast pages are deliberately outside this system. `overlay`, `overlay-1440`,
`result` and `overlay-teams` keep their own look, which the user edits from the Design
page, and they must never link `theme.css` — a theme change on the operator side must not
be able to alter what viewers see mid-broadcast.

---

## 3. Data layout

```
DATA_DIR/
  state.json       live broadcast match   (existing, unchanged)
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

**A logo names its own file.** `state.*.logo` is `{ v, ext, src }`, where `src`
is either a match slot (`blue-team` / `red-team`) or a registry team id.

It used to carry only `{ v, ext }`, and the pages derived the filename from the
**side** — blue always meant `blue-team.<ext>`. That was wrong twice over.
Switching sides swapped the metadata but not the files, so the picture never
changed. Worse, putting a tournament match on air copied the registry team's
`{ v, ext }` into state while the overlay still fetched `blue-team.<ext>` — so a
leftover slot upload was shown as the competing team's logo, live.

Nothing renames files. `src` travels with the team object, so switching sides is
still a pure state swap, undo keeps working, and no filesystem work happens
during a broadcast action. `isLogoSource` accepts only a reserved slot name or a
value passing `isSafeMediaId`, so the field can never become a path.

Logos saved before the field existed have no `src` and fall back to the old
side-based name, so existing `state.json` files keep working untouched.

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

**Capture continuously, not at the end.** Every RESET MATCH and every match put on air
replaces the current pick/ban data. Mirror each pick and ban into the game record
as it happens, so nothing is lost if the operator forgets to save, and
"real time" needs no extra machinery.

This must ship with or before the first playable match. Games drafted before
capture exists are unrecoverable.

**The same deadline applied twice, and the second time was nearly missed.**
Draft capture shipped in Phase 5, but *per-game winners* did not. `games.setWinner`
existed from Phase 5 and was called from nowhere, so `games.winner` was NULL for
every game ever recorded — win rate had no numerator, and no way to reconstruct
one. A Bo3 that ends 2-1 records the series winner; nothing says who took game 2.

**The score can be typed in either place, and they stay in step.** The box on
the Control Panel and the boxes in the bracket both write to
`matches.score_a/score_b`, and each reflects back to the other — no reopening
the match to make the numbers agree.

The Control Panel box used to write only to overlay state. That looked harmless
and was not: the bracket kept the old score, no game winner was recorded, and
`nextGameNo` reads from the **match record**, so reopening the match handed back
the *same* game number. `restoreDraft` then loaded the previous game's draft and
the new one overwrote it. Scoring on the wrong page destroyed a game's picks.

Two details that are easy to get wrong:

- **A clamped score must be reflected back.** A Bo5 caps at 3, so typing 9 stores
  3 — and the overlay is corrected to 3 rather than left showing a number the
  bracket disagrees with.
- **Which side is blue is not a given.** `goLive` puts side A on blue, but
  `switchTeams` swaps the overlay wholesale. The mapping is resolved against the
  game's frozen `blueName`/`redName` rather than assuming blue is always A.

A standalone quick match has no live pointer, so scoring one touches no
tournament at all.

**The winner now comes from the series score**, in `server/services/series.ts`.
Typing 1-0 on the match session page records game 1 to the side that gained the
point. It was briefly a manual BLUE/RED press on the Control Panel's ON AIR bar,
which meant one fact entered twice in two places — and a fact only ever recorded
by remembering to record it.

It guesses only when the answer is certain:

| Score change | What it records |
|---|---|
| one side +1 | that side won the game just played |
| one side +2 | that side won both of those games — still unambiguous |
| both sides gained | **nothing** — the count is known, the order is not |
| score lowered | clears the winners of games that no longer happened |

Refusing the ambiguous case matters more than covering it. A wrong winner flows
into hero win rates and nobody ever notices; an empty one is visible and can be
filled in by hand.

Lowering the score has to clear, not just stop. Reopening that match reuses the
same game number, so a stale winner would end up attached to a freshly drafted
game.

**The ON AIR bar is now just the words "ON AIR".** It used to also carry the
tournament name, round, game number, "draft is being recorded", the winner
buttons and a link back to the tournament — a lot of reading on a page that has
to be scanned at a glance mid-draft.

The override buttons went with it. `PUT /api/games/:gameId/winner` still exists
and still works, but nothing in the app calls it, so the ambiguous case (both
sides gaining at once) can no longer be corrected without hitting the API by
hand. If that turns up in practice, the natural home for the control is beside
the score boxes in the match session, not back on the Control Panel.

A match scored without ever going on air has no game record, so there is nothing
to attribute — and none is invented. Any game played before capture existed has
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

- **The Thai translation is complete for chrome and JS messages, but not audited page by
  page.** `i18n.js` carries ~196 entries covering the top bar, every button, form label and
  toast. Strings with data interpolated into them (`\`Deleted ${name}\``) are still English,
  because the English sentence is the translation key and a key cannot contain a team name.
  Those need splitting into a translated frame plus a substituted value before they can move.

- **The user guide now lives in two places and they can drift.** `/guide` (in-app, bilingual,
  offline) and `docs/USER_GUIDE.md` (for reading on GitHub) carry the same content by hand.
  The in-app one is the copy users actually see; if only one gets updated, make it that one.

- **Overlay sound effects: files are still drop-in, but levels are now proper settings.**
  `state.sfx` carries a per-event level (pick / ban / timer) through `CARRIED_OVER_KEYS`, and
  the Control Panel has sliders that reach a running overlay through `stateUpdate`. What is
  still missing is the upload path — see below.
- **Overlay sound effects are the minimal version.** Added 2026-08-29: fixed filenames
  dropped into `USER_SOUND_DIR`, opt-in per source with `?sfx=1`, hooked to pick, ban and
  the ten-second timer warning. There is no UI — no upload slots on the Design page, no
  volume sliders, no per-event enable, and the file names cannot be changed. Deliberate: the
  open question was whether OBS's browser would play audio at all without a user gesture, and
  that is cheap to answer with files on disk and expensive to answer after building an upload
  flow. Promote it to the media pattern (slot table in `domain/media.ts`, magic-byte
  validation, a `v` counter in state, `sfx` added to `CARRIED_OVER_KEYS` and to the
  `sanitizeState` whitelist) once it has been used on a real broadcast.

- **A relative asset path on a nested page breaks silently** — see §9. `/tournament/:id`, `/tournament/:id/bracket` and now `/teams/:id` are all affected. Any new nested page must use absolute `/js/` and `/css/` paths; tests cover the tournament and team pages.
- **A match played without going on air has no team snapshot.** Scores can be typed straight into the tournament page, which never creates a game record. If an opponent is deleted later, that row loses its name for good — see §4. Creating the snapshot at draw time would close the gap.
- **`public/js/` is now type-checked, though still `.js`.** `npm run typecheck:web`
  runs `tsc --checkJs` over every browser script, with `types/web.d.ts` declaring
  the shared contract (`window.RovClient`, `window.RovTeamUI`, `window.HotkeyUtils`,
  `io`, and the expando properties the code hangs on DOM nodes).

  It checks **one page at a time**, reading each page's `<script src>` list to
  decide which files form a program. That matters: these are classic scripts
  sharing one global scope per page, so checking them all together produces a
  hundred phantom "cannot redeclare `socket`" errors between files that never
  meet in a browser. Per page, the check mirrors what actually loads — which is
  exactly what catches a file using a name nobody on that page defined.

  It found the Phase 3 bug class again on its first run: `focusActiveSlot` in
  `control.js` read `idx` and `total`, both locals of `updateDraftUI`. Every
  draft phase change threw `ReferenceError`, froze the status text and skipped
  the rest of the `stateUpdate` handler. Also fixed: `THEME_VARS` needed a type
  annotation, and two numbers were being assigned to string DOM properties.

  Renaming the files to `.ts` is still not done, and is now the smaller half of
  the job. It buys stricter inference at the cost of a build step and a serving
  strategy for the output; the checker above gets the bug-catching without
  either. Do it when something needs types the JSDoc form cannot express.
- **Global hotkeys via Electron `globalShortcut`.** Agreed but not built. Lets a
  caster drive the draft while OBS has focus. The app's own hotkeys page
  currently implies this is impossible — true for a browser page, not for the
  Electron main process.
- **The losers bracket has now been seen rendered**, and looking at it was
  worth it. Two things were wrong that no test caught. The sections came out
  ordered Grand final → Losers → Winners, because the API sends
  `ORDER BY bracket` and alphabetically `grand < losers < main` — the page read
  from the end of the tournament backwards. And the converging connector lines
  were drawn on every round of the losers bracket, claiming pairs of matches
  merge when losers-bracket rounds alternate between merging and taking on the
  teams dropping down from the winners side. Both fixed; sections now sort by
  path through the tournament, and connectors are drawn only where the next
  round really has half as many matches.
- **A 128-team bracket has been drawn and scored through the boxes.** 127
  matches over 7 rounds, 128 score fields on the playable round, 5032px tall
  and scrolling vertically only. Recording 2-0 marked the match complete and
  advanced the winner into round 2 with the count moving to `1 / 127 played`.
  The fields are 24x21px, which is small but workable; that is the honest
  ceiling of typing scores into a bracket this size.
- **The match session page is still at `/tournament/:id/bracket`.** The name
  describes the view, not the job it now does. Renaming it to `/matches` would
  read better but breaks bookmarks and a test; not worth doing on its own,
  worth folding into any later change that touches those routes.
- **All four test goals are met.** 1: the 128-team cap is enforced in the store
  and refuses the 129th. 2: Bo1/3/5/7 all decide on a strict majority through
  one `seriesWinner`. 3: round robin uses the circle method so no team can
  appear twice in a round, by construction rather than by retrying. 4: the room
  for future work is the migration runner, the pure `domain/` layer and the
  139-test suite.

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
  wholesale on RESET MATCH and when a match is put on air.
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
- **A file named after a slot cannot follow the thing that moves.** Team logos
  were stored as `blue-team.<ext>` / `red-team.<ext>`, so the filename encoded
  *which side of the screen*, while the metadata in state belonged to *a team*.
  Every operation that moved a team between sides — switching, or going live
  with a tournament match — broke the link silently and showed the wrong
  picture. Store the identity in state and let the render follow it; do not
  rename files to keep a positional name true.
- **Focus events do not fire when the window is not focused.** `focusout`,
  `blur`, even a direct listener on the element: all silent while
  `document.hasFocus()` is false, though `document.activeElement` still moves.
  Anything that waits for the user to "finish editing" must poll instead, or it
  waits forever the moment they alt-tab to OBS.
- **Cutting a range between two markers hits the first closing marker, not
  yours.** Removing the winner controls from `control.js` by slicing from a
  comment to the next `renderLiveBar();` cut to the call *inside*
  `setGameWinner`, leaving an orphan `} catch`. `npm run check` caught it
  because it parses every file — which is exactly why that check exists.
- **`String.replace` swaps the first match, which is rarely the one you meant.**
  A codemod anchored on `renderLiveBar();` landed the real-time subscription
  inside `setGameWinner` instead of at the end of `control.js`. It parsed, it
  type-checked, and it simply never ran until someone recorded a winner. When
  scripting an edit, anchor on something unique or assert the match count.
- **Classic scripts share one global scope per page, so type-check per page.**
  Throwing every file in `public/js/` at `tsc` at once reports ~100 phantom
  "cannot redeclare `socket`" errors between files that never load together.
  `tools/check-web-types.js` reads each page's `<script src>` list and checks
  that set as one program, which is what the browser actually does.
- **A variable used in the wrong function is invisible until it runs.**
  `focusActiveSlot` read `idx` and `total`, which belong to `updateDraftUI`.
  Nothing failed at load; it threw only when the draft phase changed, froze the
  status text and silently dropped the rest of the `stateUpdate` handler. Tests
  never touched it because it is browser-only. This is the second bug of exactly
  this shape in the project, which is why the checker now exists.
- **Grouping by a database column gives you alphabetical order, not meaningful
  order.** `matches` comes back `ORDER BY bracket`, and `grand < losers < main`,
  so the bracket page rendered the grand final first and the winners bracket
  last — the tournament read backwards. Any section list built by grouping on a
  column name needs an explicit order of its own.
- **A converging connector line is a claim about where teams go.** Drawing one
  wherever a round is not the last assumes every round halves. Winners brackets
  do; losers brackets alternate between merging their own winners and absorbing
  the teams dropping down, so half their rounds keep the same match count.
  Drawing the merge there tells the viewer the wrong path. Draw it only when
  the next round genuinely has half as many matches.
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
- **One colour token block per app, not one per page.** The palette used to be copied into
  `app.css` and into four inline `<style>` blocks. Nobody kept them in step: each page's
  logo had drifted to a different colour, and the same button had two focus colours
  depending on which page it was on. Colours live in `css/theme.css` only. A page that
  needs a colour uses a token; a page that needs a *new* colour is a design decision, not a
  local edit.
- **`Number(params.get('x'))` is 0 when the parameter is absent, not NaN.** The overlay's
  sound volume read `Number(params.get('vol'))` and range-checked the result, so with no
  `&vol=` in the URL the gain node was set to **zero** and every sound played at silence.
  It survived several rounds of debugging because the `/sfx-test` page connects straight to
  `ctx.destination` and never touches that gain node — so the diagnostic was audible while
  the overlay was not, which read as 'the overlay is broken' rather than 'the volume is 0'.
  Check for `null` before converting, always.
- **`<audio>` can hang forever with no error, so overlay sound uses Web Audio.** On the
  user's own machine every `<audio>` element stalled at `readyState 0` — no `error`, no
  event, `play()` returning a promise that neither resolved nor rejected — while the same
  file fetched fine over HTTP and played through `decodeAudioData`. Two rounds of debugging
  went into autoplay policy and OBS settings before the API itself turned out to be the
  culprit. Both `overlay-sfx.js` and the `/sfx-test` diagnostic use `AudioContext`; a
  diagnostic written against the broken API is worse than none.
- **Deleting a tournament is a hard delete, and `PRAGMA foreign_keys = ON` is what
  makes it one.** `DELETE FROM tournaments` only removes one row; the bracket, its
  games and their draft slots go with it because of the `ON DELETE CASCADE` chain in
  `migrations.ts`. Turn that pragma off in `db.ts` and the delete still "works" —
  the list looks clean while orphaned matches and drafts stay in the file and keep
  turning up in cross-tournament statistics. `tournaments.remove()` counts what it
  is about to destroy *before* firing the delete, and the API returns those numbers so
  the operator sees what a confirmation actually cost. Covered by a store test that
  counts every table afterwards.
- **A live pointer left over a deleted tournament goes stale silently.** The FK sets
  `live_match.match_id` to NULL on its own, but nothing tells the open pages, so they
  keep showing a match that no longer exists. The DELETE route checks `describeLive()`
  *before* removing and calls `clearLive()` afterwards to broadcast the change.
- **Esc belongs to `app-client.js`, so a page that wants it must claim it.**
  Esc goes back a page for every operator page, from a `window` listener that
  runs last. A page keeping Esc for itself has to call `preventDefault()` or
  `stopPropagation()` — the confirm box in `control.js` and `RovClient.confirmBox()` do,
  which is why cancelling a box does not also leave the page. Typing fields are
  skipped by `event.target`, not `document.activeElement`: the hero box blurs
  itself on Esc, so by the time the shared listener runs the focus is gone.
- **`history.length` counts the blank page a new browser tab starts on.** Going
  back from a page opened straight into a fresh tab lands on `about:blank`, not
  in the app. `goBack()` also requires a same-origin `document.referrer`, and
  otherwise falls back to the page's own `[data-esc-back]` link, then home.
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
