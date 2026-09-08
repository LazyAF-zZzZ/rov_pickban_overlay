# Tournament Management Upgrade — Plan and Decisions

This is the working design document for turning the ROV pick/ban overlay into a
full tournament management app in the spirit of Challonge, with **every piece of
user data stored locally on the user's device**. No accounts, no cloud, no hosting.

It is written to stand alone: if you pick this up in a fresh session, with no
conversation history, everything needed to continue is here or in `CLAUDE.md`.

---

## 0. Where things stand

**Last updated 2026-09-08, released as v2.0.0.** The branch is `main`.
Everything described in this document is committed. The table below carries the
ids for the 2026-08-31 session, one commit per numbered item; everything after
`a47e980` went in as the single 2.0.0 release commit.

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
| `b50f62e` | Esc goes back a page |
| `a793e8b` | Deleting a tournament is a hard delete, with the damage reported |
| `8031612` | One design system for every operator page |
| `008fe36` | Presets removed; the team registry replaces them |
| `8de6d54` | Overlay sound effects |
| `78b6b95` | One shared list of OBS browser-source URLs |
| `c52a591` | The user guide ships in the app at `/guide` |
| `5a4f35c` | Thai, and Thai is the default |
| `e4c363b` | The operator's own data leaves the repository |
| `fa2655c` | Bulk team delete |
| `53a12f1` | §8: the team snapshot is frozen at the draw, not at kick-off |
| `c9be021` | §8: system-wide hotkeys through Electron `globalShortcut` |
| `a47e980` | §8: messages that carry data are translated, through `tf()` |

Work after `a47e980` — the 2026-09-02 bug-hunting pass, the page-switch polish,
the position icons, the previous-draft overlays with the round counter, the
2026-09-06 defect passes over them, backup and restore, standings and playoff
promotion, head to head, the tournament pick/ban history page, the team
picks/bans board, the operator UI pass, the broadcast-graphic work (hero icons,
ban marks, the timer glow, and the previous-draft board merged then reduced to
one page), the structure pass and the two audit passes — is described below and
**shipped in v2.0.0**. Before that release it sat as 106 uncommitted files
against a single commit, which was the largest standing risk in the project for
weeks; the release closed it.

Current state: **0 type errors under `strict`, 342 tests passing.** Creating a
tournament, adding a team with its players in one form, uploading logos,
drawing single/double elimination, round robin and group brackets, recording
Bo3/Bo5 results, opening a match in the control panel and having its draft
recorded all work end to end in the browser.

### The 2026-09-02 session — a bug-hunting pass

No new features. A read-through of the whole tree looking for defects, then
fixing what was found. Everything below was reproduced before it was fixed and
verified after. Three of them changed behaviour that the test suite had been
asserting from too narrow an angle, so the tests were widened rather than
adjusted to match the new output.

1. **Double elimination could not be finished unless the team count was a power
   of two.** The worst bug in the tree. A first-round bye has no loser to send
   down, so the losers-bracket slot waiting for that loser stayed empty forever;
   the match never became playable, nothing advanced out of it, and the whole
   losers bracket plus the grand final stalled. Five teams left **8 of 15
   matches unplayable** — the tournament simply could not be completed.

   `collapseStarvedLosers()` in `domain/bracket.ts` now runs as the last step of
   `doubleElimination()`: a losers match nobody feeds is deleted, and one with a
   single feeder is replaced by a direct pass-through to wherever its winner
   would have gone. It repeats until stable, because deleting one match starves
   the next. Sizes 4 to 40 were played out through the real store afterwards:
   every one completes in exactly `2n - 2` matches with nobody losing more than
   twice. §7's test list was widened from `[4, 8, 16, 32]` to include odd sizes;
   `playOut()` in the test also had to learn to advance a bye's winner, which it
   never did, which is *why* the gap went unseen for so long.

2. **Per-format minimum team counts were never enforced.** `canGenerateMatches()`
   existed in `domain/tournament.ts` and nothing ever called it; `generate()`
   only checked for two teams. Double elimination with 2-3 teams and a group
   stage with 2-3 teams returned an empty match list *and reported success* —
   after `generate()` had already deleted the previous bracket. The operator saw
   a bracket vanish with no explanation.

3. **Correcting a recorded score left the old winner in the next round.**
   `advance()` only ever ran when there was a winner, so changing 2-0 back to
   1-1 took the result away without taking the team back out. The bracket then
   showed a team that had not qualified, and if the other slot happened to be
   filled, that phantom match could be put on air. `clearDestinations()` now
   withdraws both the winner and the loser before the new result is written.

4. **Every success toast lost its colour.** `showToast` defaulted to type
   `'green'` and mapped it to `var(--green)`, which this theme never defines —
   it is black, white and gold. An unresolvable `var()` is not ignored: the
   property falls back to `unset`, and for `border-left-color` that is
   `currentColor`, so the bar rendered in the text colour instead of gold. Now
   mapped to `var(--gold)`, which is what the stylesheet already used.

5. **`/hotkeys` never read `globalHotkeys` back off `stateUpdate`.**
   `saveGlobal()` deliberately waits for the server to answer rather than
   trusting its own input, but the socket handler only ever applied
   `state.hotkeys`. The row kept showing the old key, and in the desktop app the
   three-second accelerator poll re-rendered from the stale copy — ticking
   "enabled" visibly untick itself a moment later while the setting was in fact
   saved.

6. **Uploading a team logo did not reach a team already on air.** State holds a
   copy of the logo's `v`/`ext` taken when the team went up, and the overlay
   deliberately only touches `<img src>` when that stamp changes, so the old
   image stayed on the broadcast. `refreshLiveTeamLogo()` now pushes the new
   version into whichever side carries that team's id. Fixing it also required
   `sanitizeLogo` to stop discarding `src` when there is no image yet — `src`
   says *which team the side is showing*, which is a different question from
   *whether it has a picture*, and a team with no logo was losing that link.

A second sweep over the same tree, going after classes of defect that reading
alone does not reach — cross-checks of every `getElementById` against its page's
markup, every JS-toggled class against the CSS, every shared global against
script order, and property tests over all four bracket formats. Those four came
back clean. What they did not cover turned up five more:

7. **Swapping sides on the overlay recorded every draft against the wrong
   team.** The worst of the second pass, and silent: it corrupts the stored
   record rather than the screen. `game_slots.side` is turned into a team
   through `games.blue_team_id`, which is frozen as match team A; the "swap
   sides" button moves the display only. So after one press, per-team analytics
   returned **the opponent's entire hero pool**, and hero win rates **inverted** —
   `g.winner` is stored in match space while `s.side` was being written in
   screen space, so a hero on the winning team counted as a loss. Reproduced
   through the real UI button and the real sockets before and after.

   `captureDraft` now writes slots in record space. The orientation test is one
   function, `isDisplaySwapped()` in `domain/match.ts`, because `series.ts`
   needs the same answer for score mapping and had its own name-only copy —
   which also got the answer wrong when two teams share a name (the registry
   does not forbid it) or when a team is renamed mid-game. It compares
   `logo.src` (the registry id, which travels with the team through a swap) and
   falls back to names.

8. **Any exception in a socket handler killed the whole server.** socket.io does
   not catch handler errors; they become an `uncaughtException` and Node exits —
   verified directly. One server serves the overlay and the control panel, so a
   single failed command takes the broadcast off air. The realistic trigger is a
   command that touches SQLite (`updateScore` writes through to the bracket):
   `SQLITE_BUSY` when something else holds the `.db` open, a full disk, a failed
   first open. Now guarded at `controlEvent`/`rawEvent`, the one choke point
   every command passes through, and reported to the operator as a `controlError`
   rather than swallowed.

9. **`state.json` was written non-atomically.** `writeFileSync` truncates the
   real file before refilling it, and that file is rewritten every second while
   the draft clock runs. Force-closing the app in that window — which is how
   people close it — left a truncated file, and the next start fell back to
   defaults: team names, players, draft and a day of theme work gone, silently,
   because the load path was `quiet`. Now written to a temp file and renamed,
   and a file that exists but will not parse is always reported even under
   `quiet` (that flag means "no file yet is fine", not "losing data is fine").

10. **Changing the series length after the draw did nothing.** `best_of` is
    copied onto each match at draw time and nothing updated it afterwards, so
    the tournament page and the bracket header both read "Bo5" while every match
    was still decided at two wins and a typed 3-0 was clamped to 2-0 without a
    word. Now propagated to matches nobody has played yet; finished and
    in-progress matches keep the length they were actually played under, since
    retiming those would turn a settled result back into an unfinished one and
    strand a team that had already advanced.

A third sweep, again starting from generalised checks rather than reading:
every `var(--x)` against the stylesheets each page actually links (the `--green`
bug, generalised — clean), every client `fetch` URL against the registered
routes, and every exported rule against its callers (the `canGenerateMatches`
bug, generalised). The route check is what paid: it showed `DELETE
/api/live-match` exists and **no page ever calls it**, so nothing in the UI can
take a match off air. Pulling that thread found the worst pair of the three
sessions.

11. **RESET MATCH erased the draft it had just recorded.** The recorder is
    attached to `emitState` and writes whatever is on screen into whatever game
    the live pointer names — it never asked whether those are the same thing.
    RESET MATCH replaces the state wholesale with an empty board and does not
    clear the pointer, so the next emit wrote emptiness over the finished game's
    draft. The game stayed `draft_locked = 1`, so analytics kept counting it as
    a completed game **with zero heroes**, quietly deflating every pick and ban
    rate in the tournament. Clearing the board for the next game is a routine
    press, and this is the exact mirror of the `goLive`/`restoreDraft` trap §9
    already records — that direction was plugged, this one was not.

12. **A practice match from the registry overwrote the last tournament draft.**
    Same root cause, different door. With no way to take a match off air, an
    operator who finishes a tournament game and picks two teams from the
    registry for a knockabout is still pointed at the tournament game; the
    practice draft was written straight over it, keeping the real teams' names.

    Both are fixed at the recorder, which is the one place that cannot be
    bypassed: `orientationOf()` in `domain/match.ts` now answers `same` /
    `swapped` / `different`, and `captureDraft` writes nothing when the board on
    screen is not the game it was asked to record. It compares registry ids
    first and only falls back to names, and the name path is deliberately
    generous — answering `different` by mistake would silently stop recording a
    real match, which is just as bad as the bug. RESET MATCH additionally
    releases the pointer, because an empty board is not any match and leaving
    the ON AIR chip up would be the screen lying about what is being recorded.
    Reopening the match from the bracket still restores the whole draft, so
    nothing is lost either way — verified end to end.

A fourth sweep found much less, which is the point of recording it: the guide
was in sync with `docs/USER_GUIDE.md`, the `.settled` and `no-anim` escape
hatches the broadcast graphics depend on were all present in CSS, socket events
matched in both directions, and fuzzing all 29 sanitizers with 49 hostile
inputs (cyclic, 2000-deep, null-prototype, throwing `valueOf`) produced no
prototype pollution and no reachable throw — everything that did throw was a
value JSON cannot carry. Two real defects survived that:

13. **Undo carried the previous match onto the one now on air.** `undoStack`
    lives at module scope and was never cleared, while `setState` replaces the
    whole match. Open the next fixture, press Ctrl+Z once — a shortcut bound by
    default and deliberately live even while typing — and the previous match's
    teams, players, logos and picks go back on the broadcast. Seen directly:
    "Bravo vs Charlie" on air became "Alpha vs Delta". `setState` now clears the
    stack, since undo history belongs to the match being replaced.

14. **The installer shipped the operator's own uploaded team logos.**
    `build.files` takes `public/**/*` wholesale and only excluded `data/`, so
    every logo and background the operator uploaded went into `app.asar` and out
    to everyone who downloaded the build. Not hypothetical — the installer
    already sitting in `dist/` contains `blue-team.png` and `red-team.png` from
    this machine. `.gitignore` had the same gap in miniature: it ignored
    `team-logos/*.png` but not `.jpg` or `.webp`, both of which the uploader
    accepts, so a JPEG logo would have been committed. Both now cover all three
    extensions, with a test pinning the rule to the uploader's own type table so
    the two cannot drift apart again.

    Anything already distributed from `dist/` still carries those images; a
    rebuild is what removes them.

Smaller ones in the same pass: `describeLive()` labelled double-elimination
matches "Group losers - round 1"; `resumeDraft()` would start a 60-second timer
on the non-existent phase past the end of the sequence and write `state.json`
once a second for a minute with nothing visible on screen; the Electron main
process threw an unhandled rejection when the server failed to start, leaving
the app running with no window and no message; `result.js` set `img.src = ''` to
clear a pick, which makes the browser fetch the page itself and fire `onerror`,
hiding the slot permanently; `/overlay-analytics?mode=constructor` reached
`Object.prototype` and printed "undefined" on a broadcast graphic; the home page
never refreshed its tournament list on `dataChanged`; and a null-guard in
`control.js`'s player swap was checked and then ignored on the next line.

### Page-switch polish, same session

Asked for an animation when moving between operator pages. What it actually
exposed was two language bugs; the animation itself ended up being the least
interesting part.

15. **Every page flashed English before switching to Thai.** `i18n.js` is the
    first of the scripts at the bottom of `<body>`, but it deferred all its work
    to `DOMContentLoaded` — which does not fire when parsing ends, it waits for
    every remaining script to load *and run*, socket.io.js at 155 KB included.
    So the fully-parsed English body sat paintable the whole time: measured at
    13.9 ms → 27.8 ms on `/`, and that is a warm localhost cache. It now
    translates the moment it executes, which is guaranteed to be before
    socket.io.js is even fetched, since synchronous scripts run in document
    order. The `DOMContentLoaded` listener stays as a safety net.

16. **`/guide` had no `data-i18n` at all.** It was the only operator page whose
    nav links carried none, so its top bar was permanently English — which reads
    as "the header reverts when I open the guide". The existing nav test checked
    hrefs and order, which is exactly why it never caught this; it now also
    asserts every nav link is translatable. The guide also kept its own language
    memory (`rovGuideLang`) and its own English/ไทย buttons, so a Thai choice
    made anywhere else never reached it. That second toggle is gone — the guide
    follows `RovI18n` and re-renders on `onChange`. Both languages still sit in
    the markup with English visible and Thai `hidden`, so the page still reads
    if the script dies.

**The animation: cross-document View Transitions were tried and rejected.**
`@view-transition { navigation: auto; }` in `theme.css` is elegant — no JS, no
link interception, and `theme.css` is already the operator/broadcast boundary so
the OBS graphics could never inherit it. It works when it works. But Chromium
skips a cross-document transition whenever the new document is not ready to
render promptly, and it skipped constantly around `/control`, warm cache and
all (verified: not the `view-transition-name` on the sticky topbar, and not raw
page weight — it skipped at 19 ms `DOMContentLoaded`). The reason is structural:
these pages build most of their UI in JS after load, and that API wants pages
that render their final content from HTML. An effect that appears maybe half the
time reads as a fault, not as polish.

Replaced with a plain `body` fade-in, which has nothing to negotiate and cannot
be skipped. Two details that are deliberate: it animates **opacity only**, because
a `transform` on `body` would make it the containing block for the fixed-position
toast and disturb the sticky top bar; and it starts at **0.55, not 0**, because
starting from invisible makes the page feel slow to arrive — the perceived lag
came from that, not from the duration.

### Most picked / most banned were already built, and unreachable

Asked for as a new overlay. It was not new: `/overlay-analytics` has taken
`?mode=presence|pick|ban|win` since Phase 8, with the right colours and labels already in
the `MODES` table. What was missing is that the OBS source list offered one generic
"Stats board" row and nothing else, so the only way to find the modes was to read the
source of a browser script.

This is the `?sfx=1` lesson exactly: a parameter the operator has to remember is a
parameter nobody uses, and the failure is invisible — you do not get an error, you just
never learn the feature exists. `obs-sources.js` entries can now carry their own `query`,
and **Most picked** and **Most banned** are listed as their own rows.

Worth remembering when the next "can we add X" arrives: check whether X is already in
there behind a URL parameter. Two of the four ranking modes had been shipped and unused
for months.

**The two rows were removed again later the same session, on the user's instruction.**
The modes themselves are untouched — `/overlay-analytics?mode=pick` and `?mode=ban` work
exactly as before; what went is the pair of ready-made rows in the OBS list, which sat
directly under a **Stats board** row pointing at the same page. Anyone who wants one
appends `&mode=pick` to the Stats board URL.

The `query` support in `pathFor()` stays, even with nothing using it. Deleting it would
mean a `query:` added back one day is dropped from the copied URL in silence, with no
error and a source that looks like it works — the same invisible failure this entry was
written about in the first place.

### Pick / ban history for a tournament

Asked for directly, after the head-to-head graphic turned out not to be the thing that
was wanted. The head-to-head stays; this is a separate page.

It answers a question nothing else could: **what has actually been played in this event.**
The pieces that existed each answered something adjacent — `games.forMatch()` is one match
at a time, `/analytics` is totals per hero, `/overlay-prev-*` is the series currently being
run, `matchup` is one pair of teams. None of them is "show me the drafts, in order".

`store/drafts.ts` reads every game in the tournament that has at least one recorded slot.
Two things it deliberately does differently from analytics:

- **Partial drafts are included**, marked `draftLocked: false`. Analytics counts only
  locked drafts because a half-finished one drags every hero's rate down. A history has
  the opposite duty: it must show what happened, including the game that was abandoned
  halfway.
- **Empty rows are excluded.** `games.freeze()` reserves game 1 at the draw, before anyone
  has played. Those rows are not history, they are space waiting to be filled.

Slots are fetched once for the whole tournament and distributed in memory rather than
queried per game — an event can run to a hundred-plus games, and per-game queries would
mean hundreds of round trips for one page load.

The page lives at **`/tournament/:id/drafts`**, following `/tournament/:id/bracket`: a
sub-page of the tournament, reached from it, carrying the standard nav without adding a
nav entry. Adding one would mean editing all ten operator pages and the test that asserts
they match, for a page that only makes sense inside one tournament.

Two filters, both client-side because the whole payload is smaller than a single hero
portrait: by team, and by hero name — the hero filter highlights the matching tiles so you
can see *where* in the draft it appeared, not just that the game matched. The team list is
built from the games themselves, not the registry, so a team dropped from the tournament
can still be filtered to; its drafts are still part of what happened.

Hero names are passed through raw, as everywhere else that reads stored history — a hero
whose image file was renamed must still show as having been picked.

### The team picks/bans board, laid out like head to head

Asked for as "most pick/ban overlay for the tournament", then narrowed to "make the
combined board, of the two teams in the matchup, and make it look like head to head".

The scope is the whole feature. `/overlay-matchup` already showed two teams' most-picked
and most-banned side by side, but **only from games those two teams played against each
other**, and the most common moment to put a matchup graphic on air is the one where that
set is empty: the first round, where nobody has met anybody. `/overlay-team-drafts` asks
the same shape of question against a wider set — **every game each team has played in
this tournament** — so the board is full before the first match of the event rather than
after the last.

No new store. `analytics.read()` has taken `{ tournamentId, teamId }` since Phase 8, and
`rankHeroes()` is the same ranker the stats board uses, so the ordering matches what the
operator already sees at `/analytics`. `GET /api/team-drafts` is the whole server side.

It resolves its two teams the way `/api/matchup` does: `?a=&b=&tournament=` if given,
otherwise the match currently on air. One browser source, copied once, follows the event.

**The page links `/css/overlay-matchup.css` on purpose.** The request was that it look
like head to head, and the only way to guarantee that over time is for there to be one
stylesheet, not two that agree today. It reuses the `mu-*` class names for the same reason.
The centre tally is the one place the two graphics differ in meaning — head to head shows
games won against each other, this shows games played in the event — so a `scope` line
underneath always names what the number counts. Without it the same layout would read as
a head-to-head score.

Three things found while building it:

- **`top` as a variable name in a classic script collides with `window.top`.** Same trap
  `overlay-analytics.js` already hit and solved by calling it `topCount`.
- **`clampNumber()` is wrong for a URL parameter.** It returns the minimum for anything
  non-numeric, so `?top=abc` — or `?top=` — produced a board with one hero per row. That
  does not read as a typo on air, it reads as "this team has only ever picked one hero".
  URL parameters fall back to the *default*, never to the floor. Same family as the `?vol=`
  bug that silenced the whole event.
- **The ban row is bans the team cast, not bans against it.** `analytics.read({ teamId })`
  filters slots to the side that team played, and a blue ban slot is a ban blue made. The
  first label said "Most banned against them" and was flatly wrong; head to head had the
  wording right already — "Most banned by them".

`tests/team-drafts.test.ts` covers the scoping, the on-air fallback, the 404 and 400
paths, and `top`. Its load-bearing test is the one that puts `/api/matchup` and
`/api/team-drafts` side by side on two teams that have not met: head to head comes back
blank, this comes back full. If those two ever agree, this page has no reason to exist.

### Second audit pass: the token boundary, traversal, and the installer

Three areas the earlier passes never touched.

**The control token had never been tested with a token actually set.** Every earlier check —
including 638 fuzzed requests — ran with `CONTROL_TOKEN=''`, which is the developer default
and disables the gate entirely. So the gate itself was unverified. With a real token: **23
write routes x 2 attempts each** (no token, wrong token) — all 46 refused with 401/403, the
correct token still returns 200, and on the socket side three control events were refused
with `controlError` while `/api/state` came back byte-identical. A static scan agrees: all 30
write routes carry `requireControl`. Worth writing down that the static scan alone would not
have been evidence — a route can name the middleware and still be reachable if it is mounted
in the wrong order.

**Path traversal: 70 crafted URLs across five served prefixes** — `../`, `..\`, `%2e%2e%2f`,
double-encoded `%252e`, `....//`, mixed separators — against decoy files planted outside the
media root. Nothing outside the served folders came back.

That probe did surface one gap in `isSafeMediaId`, and it is worth being precise that it was
**not reachable**: lowercase Windows device names (`aux`, `con`, `nul`, `com1`…) passed the
validator. Windows resolves those to devices even with an extension, so `aux.png` is not a
file. It could not be reached because ids come from `newId()` and the logo upload requires
the team to already exist, so nobody can choose `aux` as an id. It is refused now anyway, for
the same reason `newId()` re-checks its own output: the next person to allow a
caller-supplied id will not have to remember this. A test covers the device names, that
near-misses like `aux2` and `com10` still pass, and that 200 generated ids stay valid.

**The installer was never verified this session**, which matters because the session added
files (`lib/hero-art.js`, `lib/overlay-common.js`, `overlay-prev.html`, the 129-file
`heroes-icons` folder) and deleted two pages, and `build.files` lists paths explicitly. A
missing entry builds a clean `.exe` that dies on launch. `npm run dist` completed, and
unpacking `app.asar` confirms the contents rather than the exit code:

- everything added this session is present, plus 129 hero images, 129 hero icons, 5 position
  icons and the 3 sound files
- the two deleted pages are absent
- **51 compiled server files, 0 `.ts` sources, 0 tests** — the compiled output ships, never
  the source
- **no `state.json`, no `tournament.db`, no uploaded logos or skins**
- the sound files are extracted to `app.asar.unpacked`, so the packaged app can still open
  that folder and take new ones

The position icons are also in place at last — all five names match `POSITIONS`, all five
return 200, and all five render on the overlay. They are drawn as CSS backgrounds, not
`<img>`, which is why a first probe counting `<img>` elements reported zero.

### The deep audit, and the error shape it found

Asked for as "check more" after the first pass came back green. The first pass verified the
tree was consistent; this one attacked it.

**638 HTTP requests of hostile input** across every GET route and 17 write routes — empty
strings, `NaN`, `1e309`, 5000-character names, `../../etc/passwd`, `'; DROP TABLE teams;--`,
bodies that are arrays, numbers, `null`, and objects whose `toString` throws. **No 5xx and no
dropped connections.** Then **580 socket messages** across all 29 events with the same
payloads: the server did not crash, threw no unhandled rejection, and the client stayed
connected.

What that found is the one place the error contract was not honoured. Every endpoint answers
`{ error }` as JSON, and the browser's `fetchJson` reads `data.error` — but a body that
`express.json()` cannot parse never reaches a route. It fell through to Express's default
error handler, which answers **`text/html` carrying the exception and a full stack trace**,
including absolute paths on the machine running it. Two costs: the operator saw a bare "Bad
Request" instead of a reason, and the response leaked filesystem paths. The default bind is
`127.0.0.1`, which is what keeps this small, but `HOST` is overridable from the environment.

`createApp()` now ends with a four-parameter error handler that answers JSON and names
nothing internal. A test asserts the status, the content type, the presence of `error`, and
the absence of `file:line`, `node_modules` and exception names. Unmatched routes still return
Express's own 404 — no error is thrown there, so it never reaches the handler, which is
correct.

Everything else came back clean, and the checks are worth keeping:

- **Database**: `foreign_keys = 1` (the cascade deletes depend on it), WAL, `user_version 5`,
  `integrity_check ok`, no foreign-key violations, and `migrate()` run twice in a row is a
  no-op rather than an error.
- **Corrupt `state.json`**: seven shapes — truncated mid-object, empty, a bare array, a
  string, `null`, wrong types throughout, plain garbage — and every one recovers to a valid
  default board rather than crashing at startup.
- **CSS**: 52 variables declared, 51 used, every `var()` resolves. This is the check for the
  `--green` bug, where an undeclared variable silently turned `border-left-color` into
  `currentColor`.
- **Tests**: 1142 assertions across 333 tests, 3.4 per test, and **none without an
  assertion**. Four were flagged by a first scan and all four were false positives — two call
  an asserting helper, two had assertions the brace-counter cut off. Worth recording because
  the naive version of that scan lies.
- **Structure**: every route resolves to a file, every HTML file is routed, all 44 JS/CSS
  files are referenced, no page references a missing asset, and the four pages served under a
  path segment all use absolute asset paths.
- **Dead code**: exactly two exported values in the whole server are unreferenced anywhere,
  including their own file — `HOTKEY_MODIFIER_CODES` and `getDraftSeconds`. The first is a
  second copy of the modifier table that `public/js/hotkey-utils.js` owns and actually uses;
  `CLAUDE.md`'s claim that `toAccelerator()` is "the only key table in the project" is
  therefore not quite true.

Three stale claims in `CLAUDE.md` were corrected while checking, which matters more than it
sounds because that file is loaded into every session: it still said `/tournament/:id`
renders the OBS source list, and its `theme.css` and `i18n.js` broadcast-page lists still
named four pages when there are nine. Both lists now say "every `/overlay*` route" and point
at the `PAGES`-derived test — the reason those rules never actually broke is that the test
derives the list instead of repeating it.

### Structure pass: the shared overlay helpers, and what the duplication was hiding

Asked for as "improve all function and code structure". Rather than refactor broadly on a
tree with a hundred uncommitted files, the work started by measuring where duplication had
actually produced drift, on the theory that duplication only matters when the copies disagree.

The measurement, across the six broadcast graphics:

| helper | copies | distinct versions |
|---|---|---|
| `intParam` | 6 | 1 |
| `note` | 6 | 1 |
| `settleSoon` | 6 | **5** |
| `fitToStage` | 4 | **4** |
| `applyTheme` | 2 | **2** |

**The drift was hiding a real bug.** `/overlay-standings` had the shortest `fitToStage`, and
the reason it was short is that it never received the fix the other three did: it measured
`lastCard.bottom - container.top`, where the container is not translated but every card still
sits at the first frame of its entrance animation — `translateY(24px)` on `.st-group`. So it
over-measured the content by 24px and could scale the whole board down when nothing was
overflowing. `overlay-prev.js` and `overlay-teams.js` carry a comment explaining exactly this,
because they hit it and fixed it; standings was never updated. It now measures first-card top
to last-card bottom, where the shared translate cancels out.

`intParam` and `note` — the two that had **not** drifted — moved into
`public/js/lib/overlay-common.js` as `window.RovOverlay`, twelve copies down to two functions.
They were the safe half: byte-identical, so extraction cannot change behaviour, and a test now
asserts every one of the six pages loads the helper before its own script and defines neither
function itself.

Two things worth noting about the extraction. The bug history in the comments was **moved, not
deleted** — the `?vol=` silence and the `?stagger=0` cards-all-at-once case now live with the
function they describe, and the orphaned copies were removed from the pages. And the call sites
are `window.RovOverlay.x(...)` rather than a bare `RovOverlay.x(...)`, matching how
`RovHeroArt` is already used, because `typecheck:web` cannot resolve a bare global from a
`Window` declaration.

`settleSoon`, `fitToStage` and `applyTheme` were deliberately **left alone**. Their versions
differ for real reasons — different entrance timings, different things being measured, a
different subset of theme variables — so unifying them is a design job with behaviour at
stake on six live graphics, not a mechanical extraction. They are the obvious next step, and
the standings bug is the argument for doing it.

Not done, and ranked for whoever picks this up next:

1. **`server/http/api-tournaments.ts` is 522 lines and 26 routes** — five times the next
   biggest API module, and it holds at least four unrelated concerns: tournaments and their
   teams, the match session (live match, games, results), the read-only broadcast feeds
   (analytics, matchup, team-drafts, drafts, standings), and playoffs. `CLAUDE.md` says a new
   API goes in its own `api-<thing>.ts`; that convention quietly stopped being followed. The
   split is mechanical — the routes already group cleanly — but it touches the one file every
   recent feature lands in, so it wants a commit behind it first.
2. **`public/js/control.js` is 1356 lines**, the largest file in the project by 350 lines. It
   holds the hero typeahead, the draft board, the timer, sound levels, team loading and the
   hotkey bindings.
3. **`settleSoon` / `fitToStage` / `applyTheme`**, per above.

### Deleting the split pages, and the tournament page's OBS list

Two removals asked for together, the day the merged board landed.

**`/overlay-prev-picks` and `/overlay-prev-bans` are gone** — HTML files, routes, and the
`data-kind` machinery that selected between them. The previous entry kept them routed on the
argument that their URLs might be sitting in someone's OBS scene; the user decided otherwise,
which is their call, and an operator who has one in a scene will see it 404 rather than sit
blank. `overlay-prev.js` is now a single-mode script: `GROUPS` is a constant, the title is a
constant, and `<body>` carries no `data-kind`. A test asserts both routes return **404** and
are absent from `PAGES`, so they cannot creep back unnoticed.

Deleting the modes exposed a bug that had been sitting in the merged board since it was
built. `signatureOf()` — the guard that stops the row list being rebuilt on every clock tick
— still read `KIND === 'bans' ? bans : picks`, i.e. it watched **one** of the two. Two things
were wrong with that at once: with `KIND` deleted it would have thrown a `ReferenceError` mid
render, and even before that it meant a change to a ban never triggered a redraw, so the ban
half of the merged board would have gone stale on air with nothing to show why. It now hashes
picks and bans for both sides. Verified in the page: two round sets differing only in bans
produce different signatures, and identical data still matches.

**The OBS browser source list is off the tournament page**, leaving the Control Panel as its
only home. The section, the `#sources` div, the `obs-sources.js` tag, `renderSources()` and
the `obsSection` reveal are all gone, and the page footer now points at the Control Panel
instead of explaining how to paste URLs it no longer offers.

One consequence worth recording, because it is not obvious and was not free: **the tournament
page was the only place that produced tournament-scoped URLs.** It called
`renderObsSources(el, { tournamentId })`, which is what appended `?tournament=<id>` to
Standings, Team list and Stats board. The Control Panel deliberately passes no id — it is not
tied to a tournament, so those three fall back to guessing from the match on air, which is
right for that page and wrong for someone preparing a specific event's scenes in advance.
Anyone who needs a scoped URL now has to append `?tournament=<id>` by hand, taking the id out
of the tournament page's own address. That is exactly the "parameter you have to remember"
shape this project has been burned by twice (`?sfx=1`, `?mode=pick`), so if scoped sources
turn out to matter, the fix is to put a copy affordance back somewhere — not to expect people
to remember.

### Previous picks and bans, merged into one board

Asked for directly, and it reverses the earlier instruction that split them — the original
brief was "separate pick/ban overlay ... so you can bring up one without the other". Having
run it, the operator wanted one browser source instead of two.

`/overlay-prev` is the merged board and the only one listed in the OBS sources. The two
single-kind pages **still work**; they are just unlisted. That is deliberate: their URLs may
already be sitting in an OBS scene, and deleting a route turns a live browser source into a
blank rectangle with nothing anywhere saying why. Unlisting costs a line of documentation;
unrouting costs someone their scene mid-event. A test asserts both — the merged board is the
one listed, and the old two still answer 200.

Three pages, one script, still. `<body data-kind>` now takes `both` alongside `picks` and
`bans`, and the render loop was generalised from "one row of N slots" to "a list of groups",
which is one group for the old pages and two for the merged one. Two things had to move off
the page level to make that work, because a single page now holds both kinds at once:

- **`--pv-cols` moved from `<body>` to each group**, so a 5-slot group and a 4-slot group can
  sit in the same row. Each group's `flex-grow` is its slot count, which is what keeps every
  tile the same square size across both groups — split evenly instead, and the four ban tiles
  come out visibly larger than the five pick tiles.
- **The ban greyscale moved from `body[data-kind="bans"] .pv-art` to `.pv-slots.bans .pv-art`.**
  A page-level selector cannot distinguish two kinds on one page.

The red side reverses its group order (`flex-direction: row-reverse`), so the board is
symmetric about the centre split: each team's picks sit under its own name, and the bans meet
in the middle. The stylesheet already mirrors that side for the team name and alignment;
leaving the groups unmirrored put blue's bans next to red's picks, which read as a mistake.

Merging widens rather than heightens, so the height budget is unchanged — measured at six
rounds, the worst case for a Bo7: `fitToStage` scales to 0.846 and the last row ends 62px
inside the 1080 stage, with no overflow, at both 1920 and 2560.

### The yellow glow around the timer

Reported as a "yellow light box" around the clock on the main overlay. It was a leftover,
not a design choice, and the diagnosis is the interesting part.

`.timer` is styled twice in `overlay.css`, both at the top level, so the second wins. The
first (line 493) is the old boxed clock: dark plate, `border: 2px solid #ffcc00`, and
`box-shadow: 0 0 22px rgba(250, 204, 21, 0.25)`. The later block in the layout section
retired that look with `background: none` and `border: none` — but never cleared the
`box-shadow`. Measured in the browser before touching anything: `borderStyle: none`,
`backgroundColor: rgba(0, 0, 0, 0)`, and `boxShadow: rgba(250, 204, 21, 0.25) 0px 0px 22px`.
So the glow was still being drawn with no box left for it to be the edge of, which on air
reads as a yellow halo floating around the digits.

Fixed where the rest of that retirement already lives — `box-shadow: none` next to the
existing `background: none` / `border: none`, rather than editing the base rule, because the
base rule is not fully dead: its `min-width: 108px` is still what stops the clock jittering
as digits change, and the later block does not restate it.

Confirmed gone at both 1920 and 2560 (`/overlay-1440` shares this stylesheet — the 1440 sheet
is permanently disabled, see `overlay-size.js`). The urgent state was checked separately: at
under ten seconds `timerUrgent` still animates the digits red, adds no glow of its own, and
the clock returns to `box-shadow: none` afterwards. The black `text-shadow` stays — that is
legibility over video, and it is not yellow.

The other yellow glow in the file, `@keyframes pulse` on `.pick-slot.picking`, was left
alone: it marks the slot being picked right now, which is a different thing entirely.

### The cross over banned heroes, removed

Asked for on the main overlay and the previous-bans board, right after the icons landed —
and the two changes are connected. The cross was drawn dead centre of the slot, which is
where a full-body portrait's face was *not*. Once the slots switched to square icons, the
face moved into the middle and the cross sat straight on top of the one thing a viewer uses
to tell which hero was banned.

Two rules gone: `.ban-slot::after` in `overlay.css` (a 48px `X`, plus the `font-size: 34px`
override for the 1440 layout, now dead) and the rotated red bar in
`body[data-kind="bans"] .pv-slot.filled::after` in `overlay-prev.css`.

Nothing else was needed to keep a ban readable, which is why this is safe. The main overlay
still greys and dims the icon (`grayscale(0.8) brightness(0.5)`), still draws a red border
and red glow on `.ban-slot.filled`, and still prints BAN beside the row. The previous-bans
board still greys its tiles to `grayscale(1) brightness(0.62)`, still carries the team colour
bar, and its heading says PREVIOUS BANS. Confirmed on air-sized graphics with eight real
bans: `::after` computes to `none` on every filled slot at both 1920 and 2560, the filter and
border are untouched, previous *picks* is unaffected, and its `::before` team-colour bar is
still 4px — that pseudo-element is a different one on the same element and had to survive.

**The result screen was left alone deliberately.** `result.css` draws its own cross on
`.ban-icon-slot::after` — a `✕` at 138 and an `X` recolour for 1440 at 332 — and it was not
in the request. It is now the only broadcast graphic that marks bans with a symbol; worth
matching next time someone touches that page.

### Hero icons on the broadcast graphics

Asked for on the stats board, the previous pick/ban boards and head to head. The team
picks/bans board went with them: it shares `overlay-matchup.css` on purpose, so leaving it
on full-body art would have split the one thing that keeps those two graphics identical.

Every one of those slots is a small square — `.an-face` is 64x64, `.pv-slot` is `aspect-ratio:
1/1`, `.mu-art` is 92x92 — and all of them were loading `images/heroes`, which is full-body
art. Shrunk into a square and cropped, that leaves shoulders and background. `overlay.js` and
`result.js` had already worked this out for their ban slots and were reaching for
`images/heroes-icons`; the rule just had no home, so four other files never learned it.

`public/js/lib/hero-art.js` is that home. `paint()` for slots drawn with `background-image`,
`image()` for the two drawn with `<img>`, and both fall back to the full art when an icon is
missing — necessary because these graphics read stored history, and a hero whose image file
was renamed is still referenced by old drafts. Coverage is 1:1 across both folders today,
but nothing enforces that.

`background-image` has no `onerror`, so `paint()` fires a probe `Image()` at the icon and
swaps the background only if it fails. That costs no extra network: the probe and the
background request the same URL and the second comes from cache. Measured on head to head —
**18 tiles, 18 requests**, not 36.

The crop offset had to change with the art. `.mu-art` and `.pv-art` were
`background-position: center 18%`, which exists to pull a face up out of a full-body frame.
An icon is already a centred face, so 18% cut the top of the head off; both are now `center`.

Verified by deleting files rather than trusting the code. With `heroes-icons/airi.png`
removed, that one tile fell back to `images/heroes/airi.png` and loaded while every other
tile stayed on icons, on both the `<img>` and the `background-image` paths. With **both**
files removed the stats board showed its "AI" placeholder and the matchup tile went empty —
and the request count was exactly two, then silence, held over eight seconds. That last check
is the point of the one-shot rule: the earlier version of this fallback managed 640 requests
a second on a live graphic.

A test in `tournament-api.test.ts` holds the wiring: each of the five pages loads
`hero-art.js` before its own script, none of them links `theme.css`, and none still writes an
`/images/heroes` path by hand. Confirmed to fail on a removed script tag.
### The operator UI pass

Asked for as "how to improve operator ui", then all five findings built. The findings came
from walking the pages with a seeded eight-team playoff at 1600x1000, not from reading.

**Hero icons in the draft boxes and in the suggestion list.** The single highest-frequency
interaction in the product — eighteen boxes a game, up to five games a series — was the one
place the UI made you read instead of look. The typeahead was already good (ranked
prefix-then-word-start, taken heroes excluded, Enter commits, empty box lists everything);
what it showed was `textContent = hero` across 129 romanized names that blur together under
draft pressure: `aleister` / `alice` / `allain`, `ata` / `aya`. A typo that lands on a
different *real* hero passes every check in the system and appears on air.

It uses **`public/images/heroes-icons`**, not `public/images/heroes` — the latter is
full-body art for the overlay, and shrinking it to a 28px square leaves shoulders and
background. Coverage is exactly 1:1 with the hero list, checked.

Two details that matter. The list renders up to 129 rows when the box is empty, so the
`<img>` carry `loading="lazy"`; measured 13 of 13 loaded for a filtered list, and the rest
of the 2.6 MB never fetched until scrolled to. And the committed value is painted as a
`background-image` on the input, because an `<input>` cannot hold an `<img>` — with
`.has-art` adding the left padding, overridden for the shorter ban boxes, which have higher
CSS specificity than the plain class.

**The 1080px content cap.** `.wrap { max-width: 1080px }` used 68% of a 1600px window, and
the machine running this sits on a desk beside OBS. Now 1320px: measured 83%, and the home
tournament grid goes from three columns to four for free, since it was already
`repeat(auto-fill, minmax(300px, 1fr))`. Prose does not follow — `.hint` and `.pagenote` cap
at 84ch, because a help sentence 1300px wide is harder to read, not easier. The bracket page
was *not* the cap's fault: it never used `.wrap` at all.

**Untranslated English on a Thai-default UI.** Scanned every operator page: nine prose
blocks on `/bracket`, `/control`, `/design` and `/hotkeys`, plus the footers on Home and
`/teams` which are built in JS. The Design page had the mirror-image bug — Thai hard-coded
into `design.js`, so pressing EN left Thai on screen — and its entire theme-editor label
set was raw English drawn from a table in JS, which the scan missed because each label is
short. All of it now goes through `data-i18n` or `t()`, with 25 new entries.

`design.js` also had to subscribe to `RovI18n.onChange`: the translator only walks
`[data-i18n]` nodes that already exist, so a page that draws its own labels has to redraw
them itself. That means caching the last state, because the redraw needs the current values
back and the next `stateUpdate` may be a long way off when the draft clock is not running.

**The tournament page opened on the form nobody needs.** Name, format, series length and
note are set once when the event is created; the page is opened all week to reach the teams,
the bracket and the matches, which all sat below that panel. The details panel now folds,
collapsed by default, mirroring the teams fold that was already there — same button shape,
same `localStorage` handling, and its stored value is read inverted so "nothing remembered"
means collapsed.

Two things checked and deliberately **not** changed: the draft's focus handling already
auto-focuses the active slot on a phase change, marks it `.slot-active`, resolves two-slot
phases to the first empty box and refuses to steal focus mid-typing; and the suggestion list
already filters out heroes taken elsewhere in the draft. Both were better than the guesses
that would have replaced them.

### The pass over the team picks/bans board, same session

A defect hunt over the finished feature and the code it sits next to. Three bugs, all
found by measurement rather than by reading, and two of them were older than the feature.

**A team deleted from the registry lost its name on air, while keeping its data.**
`games.blue_team_id` has no foreign key to `teams` (see `migrations.ts`), so deleting a
team leaves every game row still pointing at its id — which is deliberate, and is what
lets the statistics keep counting those games. But `/api/team-drafts` read the name from
`teams.get()` alone, so the board came back with every hero tile filled and the team name
an empty string: the title read "FLASH WOLVES vs " and the card said "RED". `matchup.ts`
had already solved this with a local `nameOf()` that falls back to the frozen copy. That
logic now lives where it belongs, as `games.frozenName()`, since the frozen copy is the
games store's own data; new code should call it rather than growing a third copy.

**An error message stuck to the broadcast forever after one failed fetch.** Both this
board and head to head skip the redraw when the data has not changed — correct, and the
reason the entrance animation does not replay on every `?refresh=` tick. But the note was
being set *after* that early return. Measured on a real page: fetch fails once,
"Could not load the team picks and bans." appears, the next fetch succeeds with identical
data, the signature matches, `render` returns, and the message stays up. On a board left
running all event with `?refresh=`, one blip is permanent. The note is now decided before
the signature check, on every successful load; verified that the message clears on
recovery *and* that three identical loads still rebuild nothing.

**A 404 that sent the reader to the wrong parameter.** Naming both teams but forgetting
`?tournament=` answered "No match is on air, and no teams were named" — the two teams
having been named. The message now says which part is missing, and `a === b` is checked
before the on-air lookup so a typo reports itself as a typo rather than as an empty studio.

One gap in the tests rather than in the product: nothing asserted that the URLs in
`obs-sources.js` resolve. That list is copied into OBS without ever being opened in a
browser, so a typo becomes an empty browser source sitting in a scene, which reads as a
broken feature rather than as a bad path. `tournament-api.test.ts` now walks every `path:`
in the file, asserts it is a real route and fetches it, and checks each `query:` entry is a
`key=value` pair. Confirmed to fail on a one-character change to a path.

### Standings, playoffs, and head to head

Two gaps closed together, because they turned out to be halves of one thing.

**The group stage used to stop halfway through the tournament.** `group_stage`
generated the fixtures inside each group and returned. Nothing computed a table, and
there was no way to carry the top teams into a knockout round. Organisers tallied points
by hand, then built a *second* tournament and re-added the teams — so the group results
and the playoff results lived in two records that did not know about each other, and
analytics counted one event as two.

`domain/standings.ts` is pure: matches in, table out. Three points a win, then game
difference, then games won, then matches won. It deliberately does **not** use
head-to-head as a tiebreak — it sounds fairer until three teams beat each other in a
circle, at which point the rule decides nothing and the program has to guess. Saying
"level, settle it yourself" is more honest, because organisers already have their own
rule for it. Rows that cannot be separated are marked `tied`, and the page says so.

**Promotion refuses rather than guesses.** `promoteFromGroups` stops if any group still
has matches to play, and stops if the last qualifying place is level with the first
place out. Guessing there means the wrong team advances and nobody finds out until the
bracket has been drawn and played. Winners are interleaved (all the first places, then
all the second places) so group winners do not meet in round one.

`drawPlayoffs()` is additive — the one thing it must never do is call `clear()`, because
the group results are the reason those teams are there and every group draft hangs off
those match rows by `ON DELETE CASCADE`. Redrawing replaces the playoff, but only while
none of it has been played.

**Head to head puts data on air that was already being collected.** Every draft has been
stored per side with a winner since Phase 5 and never shown to viewers.
`store/matchup.ts` answers "these two teams": series and games each has won, and what
each side picked and banned *against this opponent specifically*. It reads sides from
the frozen game copy, never from the match row, because the on-screen sides swap — using
the match row would credit each team with the other one's heroes.

`/overlay-standings` and `/overlay-matchup` are broadcast graphics on the usual terms: no
operator stylesheet, no translator, `.settled` forced by timer. The matchup graphic takes
no ids by default and follows whatever is on air, so one URL lasts the whole event.

**Three bugs this work exposed, all found by running it rather than reading it:**

1. The playoff bracket appeared as a fifth *group* on the standings board, because groups
   are derived from the bracket names present in the fixtures. It would also have blocked
   the next promotion with "Group playoff still has matches to play". `KNOCKOUT_BRACKETS`
   now lives in `domain/bracket.ts` and standings filters on it.
2. The ON AIR bar read "Group playoff - round 1" — the exact mistake the comment above
   `label()` warns about, reproduced the moment a new bracket name existed. Fixed there
   and in the two client copies (`team.js`, `bracket.js`).
3. `fetchJson` never set a JSON content-type, so a POST body was silently dropped and the
   server fell back to defaults. Measured: the promote button sent `perGroup: 2` and the
   server read `1`, so one team per group went through, with no error anywhere. Every
   existing caller happened to set the header by hand; mine was the first that did not.

### Backup and restore

Asked for after the question "can we make it like OBS, that can export data and
import". Yes — and it fits here better than it fits OBS, for one reason: OBS exports
a scene collection that **references media by absolute path**, so moving machines
breaks every image. This data set is tiny (112 KB of database, 93 KB of logos), so the
images are embedded and the file works wherever it lands. No new dependency; the three
runtime deps stay three.

**Rows, not a copy of the .db file.** A binary copy is welded to the schema it was
taken from — restore it onto a machine that has run further migrations and it is wrong
or broken. Reading rows out and writing them back through current SQL means a v1 file
still restores after migration step 9. It is also readable by eye, which matters more
than it sounds for a tool people have to trust with a whole season.

**The security work came first, and deliberately.** A backup file is the only place in
this app that takes a whole blob of *someone else's* data — these get passed round on
Discord. The attacker wants two things: to write a file anywhere on a Windows box, and
to run script in the app's origin, which is the origin holding the control token for
the overlay that is on air. `tests/backup-hostile.test.ts` was written before the
importer existed and asks only "can it refuse", not "can it import":

- **The file never names a file or a path.** Keys become filenames, so they go through
  `isTeamLogoId` (not just `isSafeMediaId` — that would let a file overwrite the live
  `blue-team` / `red-team` slots mid-broadcast), paths are built by `teamLogoFilePath`,
  and `assertInsideMediaDir` re-checks the resolved path. That last one is redundant
  today; it is there for the day someone loosens the id regex.
- **Bytes must match the type claimed.** Same `SKIN_MAGIC` check as uploads. No SVG.
- **Rebuild from known keys**, never merge — which is what makes `__proto__` inert.
- **Caps on everything**, refusing rather than truncating.
- **One transaction.** A half-restored machine is what you would be unpicking an hour
  before an event; a refused restore you find out about immediately. Images are written
  only after the database commits, because file writes do not roll back.
- **`nosniff`** on the served media, so a byte check that ever fails still cannot become
  script in the app origin.

**The preview screen is the riskiest new UI**, because it is the one place that renders
strings from a stranger's file, and a template literal there would be an XSS into the
token-holding origin. It builds every node with `textContent`, and a parse-based test
holds that — plus the ordering preview -> confirm -> write, so the question is always
asked before anything is touched.

Verified end to end through the real UI, not just the API: four teams, a bracket, a
recorded 2-1 result and an uploaded logo; wiped the machine (logo 404); restored from
the file picker; result came back `2-1 complete`, logo back at 200 with `nosniff`. Then
four hostile files through the same picker — the traversal id and the HTML-as-PNG were
both dropped, the preview honestly reported 1 team and 0 logos, and nothing was injected
into the page.

**Still to come:** per-tournament export (share one event) and a Look preset (theme +
skins), both reusing this envelope and this importer. `kind` already exists in the file
for exactly that, and `readBackup` refuses anything that is not `full` for now.

### The 2026-09-06 third pass — bracket corruption, found by fuzzing the store

A different technique this time: run randomised sequences of operations a real
operator can perform against the store, and assert the invariants that must never
break after **every** step. Two bugs came out of it that reading the code had not,
both of them silent corruption of tournament records.

**Correcting a mis-typed score silently rewrote the rest of the bracket.**
`clearDestinations` pulls the old winner out of the downstream slot, but nothing
ever invalidated that downstream match's own *result*. So a match played by one
pair kept its score and winner after a different pair moved in. Measured on a
four-team bracket: ALPHA beat DELTA, then beat BRAVO in the final; correcting
round 1 to DELTA left the final reading **"DELTA vs BRAVO, 1-0, complete, winner
ALPHA"** — a team knocked out in round 1 still recorded as champion, and already
advanced onward in any deeper bracket.

The fix cascades: when a result's winner changes, every destination that had a
result is reset to pending and the reset follows onward. The condition is
deliberately **"did the winner change"**, not "was `clearDestinations` called" —
`setResult` clears and refills destinations on every save that had a prior
winner, even an identical one, so keying off the clear would mean re-saving the
same score wiped the whole bracket below it. There is a test for that direction
specifically.

**Shortening a series stranded games that had already been drafted.** Retiming
was allowed on any match at `status = 'pending' AND score 0-0`. But drafts are
captured automatically the moment the operator touches the board, while scores
are typed by hand — so a match drafted through five games with no score entered
looked untouched. Cut Bo7 to Bo3 and games 4-7 kept their drafts in the database:
still counted by analytics, no longer reachable from the UI, because the round
counter clamps to `bestOf`. The predicate now also requires no recorded draft and
no game winner, and — since the count shown to the operator and the update itself
were two hand-written copies of the same WHERE clause — it lives in one constant
that both use.

**On the fuzzer's own test.** A trimmed, fixed-seed version now ships as
`bracket-invariants.test.ts`. It is honest about what it is: with the fixes
removed it still passes, because these two sequences need three things to line up
and the seeds do not reach them at that scale. The actual guards are the scripted
tests in `match-store.test.ts` and `tournament-store.test.ts`, and each was
checked by deleting its fix and confirming it goes red. The randomised file is a
net for the *next* unknown bug, not proof about these two — a distinction worth
keeping, because a randomised test that cannot fail looks like coverage and is
not.

**One thing the fuzzer flagged that turned out to be correct.** Deleting a team
leaves `matches.winner_id` pointing at the removed row while both team slots go
NULL (`winner_id` has no foreign key; the slots have `ON DELETE SET NULL`). That
looks like dangling data, but `history.ts` depends on it: it is the only thing
left that can say the surviving team *lost* that match. Nulling it would turn a
recorded loss into "unknown". Left alone, and the invariant was relaxed instead.

### The 2026-09-06 second pass — a runaway on the broadcast graphics

Four more, all outside the round work. The first is the worst thing found in any
of these passes.

**A missing hero image made the overlay ask for it forever.** `updateBans` in
both `overlay.js` and `result.js` fell back from the icon to the full art by
assigning `img.src` inside `onerror` — without replacing `onerror` first. When
the fallback is also missing, the error fires again, the same URL is written to
`src` again, and writing `src` re-runs the fetch even when the value has not
changed. Measured in the browser: **1607 error events in 2.5 seconds**, roughly
640 requests a second, with no end and nothing on screen to show for it. It
would sit on the live overlay burning a core and flooding the local server.

Nothing triggers it today — all 129 heroes have both files — but the path is one
the project documents as normal: stored drafts are deliberately *not*
re-sanitized against the live roster, so an old game can name a hero whose image
was since renamed or removed, and replaying it is enough.

The fix replaces `onerror` before touching `src`, so the fallback is attempted
once and then the image is dropped. Worth being precise about why it terminates:
it is **not** the `remove()`. A detached image keeps loading perfectly well —
the demo probe kept firing after `img.remove()` and logged over 260,000 requests
before the tab was navigated away. What stops it is not assigning `src` again.
`media.test.ts` now parses every file under `public/js` and fails any `onerror`
that retries a `src` without replacing itself.

**`localStorage` throws; it does not merely return null.** A browser told to
block site data raises `SecurityError` on the property access itself. Two places
were unguarded while three others already had try/catch with comments explaining
exactly this. One of the two was `app-client.js`, on its second statement — so
the throw would happen before `window.RovClient` was ever assigned, and every
operator page would die blank on the line where it destructures that object. The
other ran at load in `design.js`, which would have stopped `buildThemeEditor()`
and `buildDesignGrid()` from ever running.

**The Electron hotkey poller re-registered in response to its own report.** The
"has anything changed" signature was taken over the whole `GET
/api/global-hotkeys` body — which includes `held`, the field the main process
itself POSTs back after registering. So the first poll registered and reported,
the second poll saw a body that now differed only by its own report, and released
and re-registered every system-wide key for nothing, about two seconds after
launch. The signature is now taken over `enabled` and `accelerators` only.

The same change closes a gap in the other direction: `reportHeldAccelerators()`
swallows its errors and has a 1.5s timeout, so one failed POST used to mean
`/hotkeys` claimed every key was registered for the rest of the session. The
poller now re-reports whenever the server's idea of `held` differs from its own.

**And `npm run check` earned its keep again.** The edit that added that
comparison wrote `join(' ')` and the space arrived on disk as a NUL byte — the
exact hazard the check exists for, caught before it shipped. Rewritten with
`JSON.stringify`, which needs no separator character at all.

### The 2026-09-06 pass — defects in the round work, and two older ones

A hunt over the round system written the day before, then wider. Seven defects,
each reproduced before the fix and re-checked after.

**Undo reached back into the previous round.** The worst of them. `setState`
clears the undo stack because the stack belongs to the match it was recorded
against — but the quick-match branch of `stepRound` changes rounds *without*
going through `setState`, so the stack survived. Measured: draft four heroes in
round 1, step forward, pick one in round 2, press Ctrl+Z three times, and the
board reads `airi, aleister` — `aleister` was never picked in round 2. In a
tournament the next `emitState` mirrors that fabricated board into game 2's
draft slots and the statistics take it as real. `clearUndo()` on the quick path.

**Re-airing a finished series invented a game.** Pre-existing, and older than the
round work. `nextGameNo` is the score sum plus one, so a Bo3 that ended 2-1 gave
game 4 and a Bo5 that ended 3-0 gave game 4 — both games nobody played. Each
viewing wrote an empty `games` row; measured on a Bo5, the rows left behind were
`1` and `4`, with no 2 or 3. Clamping to `bestOf` catches the Bo3 case and misses
the Bo5 one, because 4 is not greater than 5. The question is "is the series
decided", not "is the number too big" — `airingGameNo()` asks `seriesWinner()`
and opens the last game actually played. The explicit path (`stepRound`) still
clamps to `bestOf` only: game 3 of a Bo3 is always a legitimate destination even
before the operator has typed game 2's score.

**The previous-draft board dropped rounds off the bottom.** One round is about
210px, so five fill the stage and a Bo7 can need six. Measured at six rounds:
the last row ended at 1559px against a 1080 stage, and `body{overflow:hidden}`
took the rest silently. `fitToStage()` now scales the list. Two traps in doing
it: copying `overlay-teams.js`'s width compensation does nothing here, because
square tiles get taller as they get wider and the two effects cancel exactly
(measured: still 366px over); and measuring the last row against the container's
top counts the 26px entrance offset. Scale only, origin `top center`, and
measure first-row-top to last-row-bottom.

**`getComputedStyle` padding against `getBoundingClientRect` coordinates.** The
fit maths mixed pre-scale and post-scale units, so at 1440 it thought it had 21px
more room than it did. Same bug in the shipped `overlay-teams.js`, which is where
the pattern came from. Here the answer is simpler than a correction factor:
`.pv-list` is `flex: 1` with `min-height: 0`, so its own height *is* the space
available, already scaled. `overlay-teams.js` has no `min-height: 0`, so its grid
grows to its content and that shortcut does not apply — it multiplies the padding
by the stage's own scale instead.

**Sides swapped mid-series, the old rounds did not follow.** `switchTeams` swaps
the live board and leaves `state.rounds` alone, so the banner read BRAVO/ALPHA
while the round cards still read ALPHA/BRAVO — two graphics in one scene
disagreeing about which team is which. Fixed in the graphic rather than the
handler: each round card carries the names of who played it, so the page compares
them against the live sides and flips when they cross. That covers the swap
button, an undo after a swap, and anything added later, with no server state to
keep in sync.

**`clampNumber` on a signed input.** `clampNumber(undefined, -1, 1)` is `-1`, so a
`stepRound` message with no `delta` would have stepped *backwards*. Same family as
`Number(null) === 0`.

**`resetGlobalHotkeys` switched the feature off.** Found by wiring up the RESET
button the system-wide panel never had — the handler existed and nothing could
reach it, which is the "an endpoint no page calls is a question" trap. It replaced
the whole object with the defaults, `enabled: false` included, so resetting the
*bindings* would have killed every system-wide key mid-event. The symptom is keys
that do nothing, which reads as a fault rather than as a switch. It now keeps
`enabled` where it was.

Also: `sanitizeRounds` trimmed the newest rounds instead of the oldest, the
opposite of `fileRound`; `roundsBefore` let empty rows eat the cap; and one round
error carried a number, so it could never match a translation key while its two
siblings could.

### Previous pick/ban overlays, and the round counter

Asked for: a graphic showing the draft of the earlier games in the series, with
picks and bans on **separate** pages, each round labelled with its own number;
and a round control on the Control Panel, since that is what makes the graphic
possible. Scope was set explicitly — it collects only the match currently on
air, or the one being run from the Control Panel. The round counter is manual,
and auto-synced while a tournament match is on air.

**The round is not a second counter.** While a tournament match is on air,
`state.round` *is* `games.game_no` for that match — the same number the series
score already derives. Stepping the round moves the live pointer to the next
game through `goLive(matchId, gameNo)`, and `goLive` sets `state.round` from
the game it opened. That is what "auto-synced" means here, and it is stronger
than following the score after the fact: there is only one number, so there is
nothing to drift. For a quick match there is no row to bind to, so it is a
plain counter in state.

**Previous drafts live in `state.rounds`, and that is the only thing the
graphic reads.** Two sources fill it. For a tournament match, `roundsBefore()`
reads `games`/`game_slots` for every earlier game — which is why rounds 1 and 2
are still there after a restart, and why `goLive` rebuilding state from
`defaultState` does not lose them. For a quick match nothing is in the database
at all (`attachDraftCapture` returns early without a `gameId`), so the board is
filed into the array on the way past. Both paths end at the same two keys, so
the graphic never has to know which kind of match is on air, and never needs an
endpoint or a token. `MAX_ROUNDS` caps the pile at 15: the whole array is
written to `state.json` on every draft change and rides `stateUpdate` once a
second while the clock runs.

**Never clear the board before moving the pointer.** Draft capture is attached
to `emitState`, so an empty board emitted while the pointer still names the
game just played writes that emptiness straight over its draft — and the game
stays `draft_locked = 1`, so the statistics keep counting it. `stepRound` hands
the whole move to `goLive`, which replaces state and repoints in one step.
`tests/rounds.test.ts` asserts game 1 still holds its picks after stepping to
game 2 and emitting again.

Neither key is in `CARRIED_OVER_KEYS` — both belong to the match, so RESET
MATCH takes them with it. `dropDuplicateHeroes` only walks the live board, which
is what lets the same hero appear in round 1 and round 3 without one erasing
the other.

**Two pages, one script.** `/overlay-prev-picks` and `/overlay-prev-bans` load
the same `overlay-prev.js` and differ only by `<body data-kind>`. (Both were
deleted on 2026-09-08 and replaced by the single merged `/overlay-prev` — see
"Previous picks and bans, merged into one board" and "Deleting the split pages"
above. `data-kind` went with them.) It is a
broadcast graphic: no `theme.css`, no translator, colours from `state.theme`,
`.settled` forced by a timer because OBS freezes off-scene sources. The row
list is rebuilt only when a signature of the round data changes — without that
the entrance animation restarts every second the clock is running. Team colour
had to be painted **on top** of the hero art (a bar at the slot's foot plus a
centre divider): the art covers the tile completely, so a tinted background
behind it never appeared and ten tiles read as one strip.

The operator/broadcast split test now derives its list from `PAGES` instead of
a hand-written array of five, and matches on `<link>`/`<script>` tags rather
than raw text — the old version would have skipped these two pages entirely,
and a comment saying "do not link theme.css" would have failed it.

### Player positions on the banner

Asked for: each pick slot on the overlay banner shows the icon of that player's
position (Jungle / Carry / Mid lane / Off lane / Support), with the hero art
landing on top once the operator picks one. The position is collected in the
team registry.

**`role` became `position`, and stopped being free text.** The registry already
had a `role` column and a text box feeding it, but nothing anywhere read the
value back — it was write-only. That made it the right field to take over, and
both databases were checked as empty first, so nothing was lost. It is now a
closed set of five slugs in `domain/position.ts`, because the value is turned
straight into a filename: `public/images/positions/<slug>.png`. Free text cannot
do that job — "Jungle", "jungle" and " jungle " have to resolve to one icon, and
an unrecognised word must never become a path. Migration step 5 renames the
column rather than adding a second one, so no dead `role` is left for the next
reader to wonder about. `sanitizePosition` also accepts the human labels, so
anything hand-typed into the old box still lands on its slug.

**`TeamState.positions` rides in the state**, one entry per pick slot, next to
`players`. The graphic cannot ask the registry itself — it holds no control
token, and a quick match is not backed by a registered team at all — so the
value has to travel with `stateUpdate` like everything else the overlay draws.
`goLive` and `loadTeamIntoSide` both copy it across.

**The icon layer is built in JS, not in the markup.** `overlay.html` and
`overlay-1440.html` carry ten pick slots each; hand-editing twenty places across
two files and then forgetting one of them later is precisely the failure
`team-ui.js` exists to avoid. Both pages already load the same `overlay.js`, so
`renderPositionIcon()` inserts a `.position-icon` layer as the slot's first
child. It is deliberately *not* painted onto `.pick-slot` itself, because that
element carries the team-coloured gradient which an inline background would eat.
`.hero-image` is `position: relative` and comes later in the DOM, so it covers
the icon with no z-index needed; the layer is also faded out on `.filled`, in
case a hero PNG has transparent edges. The background is only rewritten when the
position actually changes — state arrives once a second while the clock runs,
and reassigning it every time makes the image blink on air.

Icons live in `public/images/positions/` under fixed names, with a README that
says which. They are app artwork like the hero images: committed, and shipped
inside the installer — unlike team logos, which are private to whoever uploaded
them. A missing file simply means no icon; nothing breaks.

The browser needs its own copy of the five positions, since classic scripts
cannot import from `server/`. `tests/position.test.ts` parses `team-ui.js` and
asserts the two lists still agree on both values and labels.

### The 2026-08-31 session

Ten changes, one commit each, listed in the order they were asked for because
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

9. **The operator's own data is out of git.** `state.json`, `tournament.db` and
   uploaded logos are gitignored and excluded from `build.files`. Real user
   data still exists in `%APPDATA%\rov-overlay-tool\`, untouched — only the
   repo copies went.

10. **Bulk team delete.** Tick teams, delete once.
    `POST /api/teams/bulk-delete` — one endpoint, one `notifyData`, logo files
    included. See `CLAUDE.md` for why it is not N single deletes.

**The state at the end of the split.** All ten landed clean on `fa2655c`,
with `docs:` stamping the commit ids straight after.

Two notes for anyone reading the history. The commits reconstruct the session
after the fact, so a few lines land one commit away from the topic they belong
to: the `/guide` route in `pages.ts` arrives with the sound commit, and the
`.tcard-del` and bulk-select rules arrive with the theme rewrite that rewrote
that stylesheet wholesale. And one bug was fixed while splitting: `deleteButton(t)`
in `home.js` shadowed the i18n `t()`, so `t('DELETE')` threw and no tournament
card rendered.

### Clearing §8, same session

With the split committed, the three open items in §8 that were actually
open — as opposed to notes or deliberate deferrals — were taken in order.

11. **The team snapshot is frozen at the draw.** `games.freeze()` writes game 1
    the moment both teams of a match are known, so a match scored straight into
    the bracket can still name its opponent after that team is deleted. It was
    the last way left to lose a result permanently. See §4.

12. **System-wide hotkeys.** `state.globalHotkeys` plus `globalShortcut` in the
    Electron main process, off until switched on, and never a bare key. See §9
    for the three rules and why one of them is about telling the truth rather
    than about safety.

13. **Messages that carry data are translated.** `tf('Deleted {name}', …)` —
    the frame is the key, the values ride separately. See §8.

**Where that leaves things.** `npm run check`, `npm run typecheck`,
`npm run typecheck:web` and `npm test` (198) are all clean on `a47e980`.
Nothing is pushed yet; the thirteen commits above and the two documentation
commits between them sit on local `main`.

What is left in §8 is deliberate: renaming `public/js` to TypeScript, the
sound upload flow, renaming the match-session route, and reading every screen
in Thai to fix what sounds wrong — a language job rather than a code one.

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

**The stats board is the second broadcast graphic.** `/overlay-analytics` ranks
the heroes of one tournament for the screen, the way `/overlay-teams` does its
roster. It is **not** `/analytics` — that is the operator page from Phase 8, and
a test asserts the two stay apart, the same collision `/teams` had.

URL options, all optional: `?tournament=<id>` (defaults to the live match's
tournament, then the newest one), `?mode=presence|pick|ban|win`, `?top=1..20`,
`?columns=1|2`, `?title=`, `?subtitle=`, `?minGames=<n>`, `?stagger=<ms>`,
`?refresh=<seconds>`. The tournament page's OBS section lists it with the id
already in the URL, ready to paste.

**The ranking is a server rule, not page decoration.** `rankHeroes()` in
`domain/analytics.ts` picks and orders; `/api/analytics` takes `mode`, `top` and
`minDecided` and returns the ranked slice. Putting it in `domain/` is what makes
it testable, and the operator page — which sends none of those — is unchanged.

Two rules there are about not lying to viewers rather than about layout. **A win
rate needs a floor of decided games** (default 3): "100% win rate" from one game
is arithmetically true and reads on screen as "the strongest hero in the event".
And **the summary always counts the whole tournament**, never the trimmed board,
or a `top=10` graphic would tell viewers the event had ten heroes in it.

Heroes with nothing to say in a mode are left out rather than listed as zero — a
row of zeroes takes the place of a row with data and makes the graphic look like
it failed to load.

**The bar scales against the best hero on the board, not against 100%.** The most
contested hero in a real event sits around 30-40% presence, so a 0-100 scale makes
every bar short and nearly identical. Win rate is the exception and keeps 0-100,
because 50% is a real line there.

**Everything that animates is forced to its end state.** Rows start at
`opacity: 0`, bars at `width: 0`, and the numbers count up from zero — three ways
for a frozen source to end up showing a blank board, or worse, a board where
every hero reads 0%. One timer adds `.settled`, which kills the animations, sets
the bars to their real width and writes the final numbers.

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

**The snapshot is taken at the draw, not at kick-off.** `games.freeze()` writes
game 1 of a match the moment both its teams are known — when the bracket is
drawn, and again when a winner is pushed into the next round. It used to be
written only by `goLive()`, which meant a match whose score was typed straight
into the bracket had no game record at all, and a later deletion of the opponent
left that row with no name to recover. That was the last way to lose a result
permanently.

`freeze()` will rewrite an existing game 1 — its ids and its names — but only
while that game is **untouched**: no draft slots, no winner. Both halves matter.
Rewriting is needed because correcting an earlier round changes who advances, so
a pairing frozen for the next round can become one that never happened. Refusing
to rewrite a touched game is needed because a game with a draft on it is a game
somebody played, and renaming its sides is falsifying a record.

The rows it creates are empty: no slots, `draft_locked = 0`. Analytics counts
only `draft_locked = 1`, so they change no statistic. What they carry is the
pairing, which is the part that cannot be reconstructed later.

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
| — | Stats board overlay at `/overlay-analytics`, ranked per tournament | done |
| — | Position icons behind the pick slots, collected in the registry | done |
| — | Round counter on the Control Panel, bound to `games.game_no` | done |
| — | Previous-draft overlays; merged into `/overlay-prev` on 2026-09-08 | done |
| — | Defect pass over the round work, plus two older bugs it exposed | done |
| — | Second defect pass: image-fallback runaway, localStorage, hotkey poller | done |
| — | Third pass: store fuzzing finds bracket-cascade and retime corruption | done |
| — | Backup and restore, one embedded-media JSON file, hostile-input tested | done |
| — | Group standings, promotion into a playoff bracket, `/overlay-standings` | done |
| — | Head-to-head `/overlay-matchup` from drafts already stored | done |
| — | Pick/ban history per tournament at `/tournament/:id/drafts` | done |

The team-list overlay must not rely on `animationend` alone — OBS freezes browser
sources that are off-scene, so the event may never fire. Use the timer fallback
pattern already in `public/js/overlay.js`.

---

## 8. Open items

- **Messages that carry data are translated too, through `tf()`.** The frame is the key and
  the values are passed separately: `tf('Deleted {name}', { name: team.name })`. That was the
  last thing keeping toasts in English — the English sentence is the translation key, and a
  key cannot contain a team name. `i18n.js` now carries ~250 entries.

  Two rules the tests hold. A Thai frame must use exactly the placeholders its key has:
  one missing and the value silently disappears, one extra and the word `{name}` appears on
  screen. And every `tf()` frame must have a Thai entry, unlike a plain `t()` string, which
  falls back to English harmlessly — half a sentence in each language reads as a fault
  rather than as an untranslated string.

  What is left is the page-by-page audit: reading each screen in Thai and fixing what sounds
  wrong, which is a language job rather than a code one.

- **Sound files moved to `public/images/sounds`, and stay there in every mode.** They used
  to follow `ROV_USER_MEDIA_DIR`, which put them in `%APPDATA%\rov-overlay-tool\media\sounds`
  under the desktop app and in the project folder when run from source — two locations for
  one thing, and the app read whichever the mode implied. `USER_SOUND_DIR` is now the project
  folder outright, on the user's instruction: sounds are dropped in by hand rather than
  uploaded, and they should travel with the app.

  That makes them part of the build, so `asarUnpack` keeps the folder outside `app.asar` —
  otherwise a packaged app would hold them inside a single file that nobody can open or add
  to. `ROV_USER_SOUND_DIR` overrides the path, and exists so tests can point at an empty
  folder rather than reading whatever the developer has on disk.

  The three default sounds are committed and ship with the installer, like hero images and
  unlike team logos — a download plays sound out of the box instead of starting silent, and
  a test asserts all three files are in the tree so a build cannot go quiet without anyone
  noticing. Verified by building the installer and running the packaged app: it reports the
  unpacked folder, finds all three files and serves them at full size.

  Still open, and unchanged by this: `build.files` ships `public/**/*` with no exclusions,
  so the installer also carries whatever dev-mode team logos are in `public/images/team-logos`
  when it is built. `CLAUDE.md` claims an exclusion that `package.json` does not have.

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
- **Global hotkeys are built, and switched off until asked for.** `state.globalHotkeys`
  holds `{ enabled, bindings }`, rides `CARRIED_OVER_KEYS`, and is set from the panel on
  `/hotkeys`. The Electron main process polls `GET /api/global-hotkeys` every two seconds
  and registers what it finds through `globalShortcut`; a press comes back as
  `POST /api/global-hotkeys/fire`. See §9 for the two rules that keep it safe and the one
  that keeps it honest.

  What is deliberately not there: a way to bind a bare key (see §9), and any action beyond
  the five the Control Panel already has. Picking heroes needs a hero name, which a
  keystroke cannot carry.
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
- **A bye has no loser, and the losers bracket is built assuming it does.**
  The other half of the trap above. Every first-round bye starves a slot in
  losers round 1 that nothing else can ever fill, so that match never becomes
  playable and everything downstream of it stalls — at five teams, 8 of 15
  matches were unreachable and the tournament could not be finished at all.
  `collapseStarvedLosers()` deletes a losers match nobody feeds and turns one
  with a single feeder into a pass-through, repeating until stable. Do not
  "fix" this by seeding phantom teams or by letting a one-sided losers match
  count as a bye: byes can only exist in round 1 of the winners bracket.
- **Test a bracket at sizes that are not powers of two.** This is how the bug
  above survived so long. `[4, 8, 16, 32]` produce no byes at all, so every
  structural assertion passed while the sizes real events actually use were
  broken. The helper `playOut()` in `double-elim.test.ts` also silently did not
  advance a bye's winner, which made byes untestable even if a size had been
  added. Sizes now include 5, 6, 7, 9, 11, 12 and 21.
- **A rule with no caller is not a rule.** `canGenerateMatches()` sat in
  `domain/tournament.ts`, fully written and fully tested, and `generate()` never
  called it — so per-format minimums were never enforced anywhere. Grep for a
  caller before trusting that a validator is wired in.
- **Recording a result pushes teams forward; correcting one has to pull them
  back.** `advance()` and `dropLoser()` only run when there is a winner, so
  taking a result away used to leave the team it had promoted sitting in the
  next round. Any change to `setResult` must keep `clearDestinations()` running
  first, or the bracket starts showing teams that never qualified.
- **An unresolvable `var()` is not a no-op.** `var(--green)` where `--green` is
  undefined does not leave the previous value alone — the property falls back to
  its `unset` value, which for the non-inherited `border-left-color` is
  `currentColor`. Every success toast quietly rendered in the text colour. There
  is no green in this theme; gold is the affirmative colour.
- **A page that waits for the server to echo a setting back must actually read
  it.** `/hotkeys` deliberately does not trust its own input for system-wide
  bindings — the server decides what is registrable — but its `stateUpdate`
  handler only applied `state.hotkeys` and ignored `state.globalHotkeys`, so the
  echo never arrived and a three-second poll kept redrawing from a stale copy.
- **`logo.src` answers "which team is on this side", not "does it have a
  picture".** `sanitizeLogo` used to drop `src` whenever `v` was 0, so a team
  loaded onto the overlay before it had a logo lost the only link back to its
  registry id — and uploading a logo afterwards had no way to find the side to
  refresh. Keep `src` on an empty logo; every consumer already checks `v` and
  `ext` before it touches the filename.
- **`img.src = ''` is a request, not a reset.** Clearing a picked hero in
  `result.js` that way makes the browser fetch the page's own URL as an image,
  get HTML, and fire `onerror` — which set `display: none` and left the slot
  invisible until a refresh. Use `removeAttribute('src')`.
- **"Blue" means two different things, and `switchTeams` is where they part.**
  In the frozen game record blue is always match team A; on the overlay it is
  whichever side is being shown blue. Anything converting between the two must
  go through `isDisplaySwapped()` in `domain/match.ts` — there is exactly one
  copy on purpose. Writing draft slots in screen space attributed both teams'
  picks to their opponent and inverted every hero win rate, and nothing on
  screen looked wrong; the damage was only visible in the statistics afterwards.
  Compare by `logo.src` (the registry id travels with the team through a swap),
  not by name: names can be duplicated across teams and edited mid-game.
- **socket.io does not catch exceptions thrown in event handlers.** They reach
  `uncaughtException` and Node exits, taking the overlay off air along with the
  control panel. Every socket command goes through `controlEvent`/`rawEvent`,
  and the try/catch lives there — do not add a bare `socket.on` for anything
  that can touch the database.
- **`writeFileSync` over a live file is not atomic.** It truncates first, so a
  crash or a force-close mid-write leaves a corrupt file. `state.json` is
  rewritten once a second while the draft clock runs, which makes that window
  routine rather than theoretical. `writeJson` writes a `.tmp` and renames.
- **A `quiet` load must not be quiet about corruption.** "The file is not there
  yet" is normal on first run; "the file is there and unreadable" means the
  operator's data is about to be replaced by defaults, and staying silent about
  it makes a data loss look like an empty app.
- **The draft recorder must check that the board is the game it is recording.**
  It is attached to `emitState` and writes the screen into whatever game the
  live pointer names. Every path that replaces the state wholesale — RESET
  MATCH, loading a team from the registry — leaves that pointer behind and
  turns the next emit into an overwrite of a finished game's draft, with the
  game still `draft_locked` so the statistics keep counting it at zero heroes.
  `captureDraft` asks `orientationOf()` first and refuses on `different`. Keep
  the name fallback generous: a wrong `different` silently stops recording a
  real match, which costs as much as the overwrite it prevents.
- **A script at the bottom of `<body>` that waits for `DOMContentLoaded` is not
  early — it is last.** That event waits for every remaining script to load and
  execute, so anything the page needs applied *before first paint* must be done
  synchronously at execution time instead. This is what made every operator page
  flash English before switching to Thai.
- **Cross-document View Transitions are best-effort and this app is a bad fit.**
  Chromium skips them whenever the new document is not ready to render promptly,
  and these pages build most of their UI in JS after load. It was skipped
  constantly around `/control` — not because of page weight (19 ms
  `DOMContentLoaded`) and not because of the `view-transition-name` on the
  sticky topbar; both were ruled out. Use a plain load animation instead: an
  effect that fires half the time reads as a fault.
- **`transform` on `body` is not free.** It makes `body` the containing block
  for `position: fixed` descendants (the toast) and disturbs the sticky top bar.
  Animate `opacity` alone unless there is a reason not to.
- **Module-level state must be cleared when the thing it belongs to is
  replaced.** `setState` swaps the whole match; anything scoped to the old match
  and living outside it has to go with it. The undo stack did not, so one
  Ctrl+Z after switching fixtures put the previous match back on air. The live
  pointer had the same shape of bug. When adding state beside `gameState`, ask
  what `setState` should do to it.
- **`build.files` takes `public/**/*` wholesale, and uploads live under
  `public/`.** Every uploaded logo and background needs an explicit `!` entry or
  the installer ships the build machine's own images to everyone. Cover every
  extension the uploader accepts (`SKIN_TYPES`), not just `.png` — the same gap
  was in `.gitignore`, where a `.jpg` logo would have been committed.
- **An endpoint no page calls is a question, not dead weight.** `DELETE
  /api/live-match` existed and nothing invoked it, which is what exposed that a
  match can never be taken off air — and that everything downstream assumed
  somebody would. Cross-check client `fetch` URLs against registered routes;
  the gap in either direction usually means a missing wiring rather than a
  spare route.
- **`best_of` is copied onto each match at draw time.** Changing the
  tournament's series length afterwards has to be pushed out to the matches, or
  the setting appears to apply and does not. Only ever retime matches nobody has
  played — rewriting a finished one un-finishes a recorded result and strands
  whoever advanced from it.
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
- **A translation table is an object literal, so a repeated key wins in silence and a
  key cannot be a concatenation.** Both happened while adding `tf()` frames. The duplicate
  was caught only because `typecheck:web` runs `tsc` over `i18n.js`; a test now checks it
  directly, along with placeholder parity between each key and its Thai value — a frame
  whose translation misspells `{name}` prints `{name}` on the operator's screen, with no
  error anywhere.
- **A system-wide shortcut is taken from every program on the machine, so a bare key
  is never allowed.** `toAccelerator()` returns `null` unless the binding carries at
  least one modifier, and `sanitizeGlobalHotkeys` drops anything it refuses back to the
  default. Registering a bare `Space` globally would mean the machine could not type a
  space until the app was closed, and nobody would guess why. The same function is the
  only key table in the project: the server validates with it and Electron registers
  what it returns, so a key cannot pass one and fail the other.
- **`globalShortcut.register()` returns `false` when another program already holds the
  key, and that is not an error anyone can see.** On the machine this was built on,
  `Control+Alt+Space` was already taken. Four of five keys registered and the fifth
  silently did nothing — which is the same symptom as a broken feature. The main
  process now reports which accelerators it actually got back to
  `POST /api/global-hotkeys/registered`, and `/hotkeys` marks the rest in red. Any
  future shortcut work has to keep that loop: silence has to be visible somewhere.
- **The Electron main process has no socket, so it polls.** It cannot `require` the
  server either — the app supports attaching to a server someone else started (see
  `startServerIfNeeded`), where there is nothing in-process to require. A two-second
  poll of `localhost` is the one path that works in both cases, and it re-registers
  only when the answer changes: unregistering and re-registering every tick would leave
  a gap in which the keys do nothing, twice a minute.
- **An empty game row is not a played game, and the difference is one column.**
  Freezing the pairing at the draw creates a `games` row for every match, played or
  not. That is safe only because `analytics` divides by `COUNT(*) WHERE draft_locked = 1`,
  not by `COUNT(*)`. Anything that later counts games must use the same filter, or
  every hero's rate falls by however many matches happen to be scheduled.
- **`history.length` counts the blank page a new browser tab starts on.** Going
  back from a page opened straight into a fresh tab lands on `about:blank`, not
  in the app. `goBack()` also requires a same-origin `document.referrer`, and
  otherwise falls back to the page's own `[data-esc-back]` link, then home.
- **Driving the app in a browser writes to real local data.** A verification
  pass that puts a match on air rewrites the tracked `data/state.json`, and any
  tournament feature creates `data/tournament.db`. Stop the server before
  deleting the db (Windows holds WAL handles) and `git checkout -- data/state.json`
  afterwards, or the next commit carries a stranger's test match.
- **`clampNumber` returns `min` for anything it cannot read, which is a trap for
  signed inputs.** `clampNumber(undefined, -1, 1)` is `-1`, so a `stepRound`
  payload that arrived without a `delta` would have walked the round *backwards*
  rather than doing nothing. Same family as `Number(null) === 0` passing a
  `0..1` range check. For a value whose sign is the instruction, test
  `Number.isFinite` yourself and derive the sign.

  It is a trap for **URL parameters** too, for the same reason and with a worse
  symptom: `clampNumber(req.query.top, 1, 10)` turns `?top=abc` — or an empty
  `?top=` — into a one-hero board rather than the default five, and a graphic
  showing one hero does not look like a typo on air, it looks like a fact about
  the team. Anything typed into a URL falls back to its *default*, never to the
  floor. Both `/api/team-drafts` and `overlay-team-drafts.js` do the
  `Number.isFinite` check themselves for exactly this.
- **`top` is not a usable variable name in a browser script.** Classic scripts
  share the global scope with `window.top`, so `const top = ...` at file scope
  either throws or shadows something the page needs. `overlay-analytics.js` and
  `overlay-team-drafts.js` both call it `topCount`.
- **A "skip the redraw if nothing changed" guard also skips clearing the
  message.** Any status text set *after* the signature check is unreachable on
  the load that would clear it, because that load is the one whose data matches.
  Measured: one failed fetch pins "Could not load…" to the broadcast permanently,
  since every later success returns early. Decide the message *above* the guard,
  from the freshly loaded data; only the DOM rebuild belongs below it.
- **A team id in a `games` row outlives the team.** `games.blue_team_id` /
  `red_team_id` carry no foreign key, on purpose — that is what keeps a deleted
  team's matches in the statistics. So any lookup that turns one of those ids
  into a name must fall back to the frozen `blue_name` / `red_name`
  (`games.frozenName()`), or the graphic shows full data under a blank name,
  which reads on air as a broken source rather than as a deleted team.
- **The translator only walks `[data-i18n]` nodes that already exist.** A page
  that draws its own labels from a table in JS is invisible to it: those strings
  are right on load (because `t()` ran) and then freeze in the loading language
  when the TH/EN button is pressed. Such a page must subscribe to
  `RovI18n.onChange` and redraw itself — and therefore has to cache the state it
  redraws from, since the next `stateUpdate` can be a long way off when the draft
  clock is not running. `design.js` is the worked example.
- **Two hero image folders, and they are not interchangeable.**
  `public/images/heroes` is full-body art for the overlay;
  `public/images/heroes-icons` is the square portrait, and it is the one to use
  anywhere small — the operator's draft boxes and suggestion list, and every
  broadcast graphic that draws a square tile. Shrinking the full-body art to
  28px, or to a 64-92px tile, leaves shoulders and background, which is
  unrecognisable. Coverage is 1:1 across both folders; keep it that way when
  heroes are added. Nothing picks a folder by hand any more —
  `public/js/lib/hero-art.js` is the only place that decides, and a test asserts
  the pages that draw heroes load it and contain no `/images/heroes` path of
  their own.
- **Swapping full art for an icon means changing the crop too.** A square tile
  showing full-body art needs `background-position: center 18%` to pull the face
  up into frame. An icon is already a centred face, so the same 18% cuts the top
  of the head off — the art and the crop offset are one decision, not two.
- **`background-image` has no `onerror`.** A tile that needs a fallback has to
  probe with an `Image()` and swap the background from its error handler. It
  costs no extra request — probe and background fetch the same URL and the
  second is served from cache (measured: 18 tiles, 18 requests). The one-shot
  rule still applies to the probe: set `src` once, never reassign it.
- **Retiring a boxed look means clearing `box-shadow` as well.**
  `background: none` and `border: none` leave a glow behind that now has no box
  to be the edge of, and on air that reads as a coloured halo floating around the
  content. `overlay.css` styles `.timer` twice at the top level for exactly this
  reason; the second block is where the retirement lives, and it had cleared the
  plate and border but not the shadow. When a selector is styled twice in one
  file, check the *computed* style in the browser rather than reading either rule
  — that is what found this one.
- **A broadcast graphic redraws once a second whether it has news or not.**
  `stateUpdate` arrives on every clock tick, so any page that rebuilds its DOM
  from state restarts its entrance animation continuously — visible on air as a
  permanent flicker. Compare a signature of the data you actually draw and
  return early. `/overlay-prev-*` does; measured 0 rebuilds across six seconds
  of a running clock, and exactly 1 when the round actually stepped.
- **Team colour has to be painted on top of hero art, not behind it.** The
  portrait fills its tile, so a tinted tile background is never visible. Ten
  tiles then read as one strip with no sign of where one team ends. Use a bar at
  the slot's foot (`::before` with a `z-index`) and a real divider column.
- **A shared fetch helper that leaves `Content-Type` to its callers will be forgotten.**
  `fetch()` labels a string body `text/plain`, `express.json()` only parses
  `application/json`, so the body vanishes and the server proceeds on defaults with no
  error anywhere. Measured: a button sent `perGroup: 2`, the server read `1`. Set the
  header in the helper whenever there is a body.
- **Anything derived from "the bracket names present in the fixtures" changes the day a
  new bracket name exists.** Adding `playoff` made it appear as an extra group in the
  standings and made the ON AIR bar say "Group playoff". Both places assumed anything
  that is not `main`/`losers`/`grand` is a group. Keep the knockout names in one exported
  list and filter on it.
- **A tiebreak rule that cannot always decide is worse than admitting a tie.**
  Head-to-head fails outright when three teams beat each other in a circle. Standings
  rank on measurable totals, mark level rows, and promotion refuses to draw while the cut
  line is tied — because a wrong promotion is only discovered after the bracket is played.
- **A file the user imports is the only place this app takes a stranger's data whole.**
  It must never name a file or a path; keys that become filenames go through
  `isTeamLogoId` and are re-checked against the media root after resolution. Bytes are
  trusted only after a magic-byte check, objects are rebuilt from known keys rather than
  merged, and the whole write is one transaction with the images written last, because
  file writes do not roll back.
- **Do not compute a path back to the project root by counting `../`.** At runtime the
  file lives under `build/`, so `require('../../package.json')` from `server/http/`
  resolves to `build/package.json` and throws at module load — which took out every
  test that builds the app. Use `ROOT_DIR` from `config`, which already knows.
- **A parse-based test must strip comments before it searches.** A file that does the
  right thing usually says so in a comment — "never build this with innerHTML" — and a
  raw substring search then fails on the very comment you wanted. Second time this bit;
  the first was `theme.css`.
- **Error text from the server needs a Thai entry too.** `t()` keys on the whole English
  sentence, so a refusal invented in `domain/` and never added to `i18n.js` appears in
  English beside Thai UI and reads as a fault. A test now derives the list by actually
  triggering each refusal rather than trusting anyone to keep a list.
- **`express.json({ limit })` mounted globally caps every route.** The 64 KB limit is
  right for every existing API and far too small for a backup with images in it. A route
  that needs more must be mounted *before* the global parser with its own limit —
  body-parser skips a request whose body is already parsed, so the order is the whole
  mechanism. Bigger is not free either: the file is one `JSON.parse` on the event loop
  that also serves the overlay currently on air.
- **Emptying a slot is not the same as invalidating the result that filled it.**
  `clearDestinations` pulled the old winner out of the next match but left that
  match's score, status and winner untouched, so a bracket kept a champion who
  had been knocked out in round one. Whenever an input to a recorded outcome
  changes, the outcome has to go too — and onward, recursively.
- **Key an invalidation off the net change, not off the intermediate state.**
  `setResult` clears and refills destinations on *every* save that had a prior
  winner, identical scores included. Triggering the cascade on "the slot was
  cleared" would have made re-saving the same result destroy the whole bracket
  below it. Compare old winner to new winner instead.
- **"Nobody has played it" cannot mean "nobody typed a score".** Drafts are
  captured automatically; scores are entered by hand. A match drafted through
  five games with no score looked untouched to the retime rule, so shortening the
  series stranded those games past `bestOf` — still counted by analytics, no
  longer reachable in the UI.
- **A count and the update it describes must not be two hand-written copies of
  one WHERE clause.** They drift, and the symptom is a dialog reporting a number
  that does not match what changed. Put the predicate in one constant.
- **A randomised test that cannot fail is not coverage.** Always delete the fix
  and confirm the test goes red. The fuzz file here still passes without either
  fix — the real guards are the scripted tests, and the fuzz run is a net for
  unknown bugs. Say which is which in the file, or a later reader will trust the
  wrong one.
- **An `onerror` that retries by writing `src` must replace itself first.**
  Assigning `src` re-runs the fetch even when the value is unchanged, so a
  fallback to a file that is also missing loops forever — 640 requests a second,
  measured, on a graphic that is on air. And `remove()` does not stop it: a
  detached image keeps loading. Not writing `src` again is what stops it.
- **`localStorage` throws on the property access when site data is blocked.** It
  does not return null. An unguarded read at the top of a shared module takes
  every page that depends on it down before its global is ever assigned. Wrap
  every read and write, including the ones that look too early to fail.
- **Do not build a "has it changed" signature from a payload that contains your
  own output.** The Electron poller hashed the whole hotkey response, `held`
  included — the very field it POSTs back — so it re-registered every key in
  response to its own report. Hash only the inputs that decide the work.
- **A fire-and-forget report needs a way to notice it was lost.** The held-keys
  POST swallows errors and can time out; one failure used to leave `/hotkeys`
  lying about registration for the rest of the session. The poll now compares
  what the server thinks with what is actually held, and re-sends on a mismatch.
- **Module state cleared by `setState` is not cleared by anything that changes
  the match *without* it.** The undo stack is emptied in `setState` because it
  belongs to one match; the quick-match round step changes rounds in place, so
  the stack survived and Ctrl+Z pulled the previous round's draft onto the
  current board — then the recorder wrote that fabrication to the database as
  the game's real draft. Any new path that ends one "unit of work" has to clear
  what was scoped to it; `setState` is not the only door.
- **"Is the number too big" is not the same question as "does this exist".**
  The next game of a series is the score sum plus one, which invents a game the
  moment the series is decided — and clamping to `bestOf` only catches it when
  the series went the distance. A Bo5 won 3-0 asks for game 4, which is under
  the cap and still never played. Ask `seriesWinner()`.
- **Compensating a scale by widening only works when height does not follow
  width.** `overlay-teams.js` widens by `1/s` before scaling by `s` so the grid
  does not shrink to the left. Copy that onto a layout of square tiles and the
  two cancel exactly — the rendered height does not move at all. Scale alone and
  centre the origin.
- **`getComputedStyle` returns pre-transform lengths; `getBoundingClientRect`
  returns post-transform ones.** Subtracting one from the other is wrong by the
  scale factor — 21px at the 4/3 the 1440 overlays use, enough to clip the last
  row exactly when the fitting code was supposed to prevent that. Prefer a rect
  that already includes the scale (a `flex: 1` box with `min-height: 0` measures
  the available space directly), or multiply the padding by
  `rect.height / offsetHeight`.
- **`clampNumber` returns `min` for anything it cannot read, which is a trap for
  signed inputs.** `clampNumber(undefined, -1, 1)` is `-1`, so a step command
  with a missing `delta` walks backwards instead of doing nothing. Same family
  as `Number(null) === 0` passing a `0..1` check. When the sign *is* the
  instruction, test `Number.isFinite` yourself.
- **A reset that replaces a whole settings object also resets the switch that
  turns the feature on.** `resetGlobalHotkeys` did, so resetting the bindings
  would have silently killed every system-wide key mid-event — and a key that
  does nothing reads as a fault, not as a setting. Reset the parts the button
  names, and keep the enable flag.
- **A test that lists pages by hand stops covering the project the day someone
  adds a page.** The operator/broadcast theme split was checked against five
  hard-coded routes; two new overlays would have gone unchecked with the suite
  still green. Derive the list from `PAGES`. And match on `<link href>` /
  `<script src>`, not on raw text: a page carrying the comment "never link
  `theme.css` here" — exactly the comment wanted — fails a substring test, and
  the easy fix is to delete the warning.

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
