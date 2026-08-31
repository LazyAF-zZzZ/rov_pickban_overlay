# ROV Overlay Tool

Local-first Arena of Valor draft pick/ban overlay for OBS. Node + Express + Socket.IO,
wrapped in Electron. **All user data stays on the user's device** — no accounts, no cloud.

## Commands

```bash
npm run build      # tsc: server/ + tests/ -> build/
npm run typecheck  # tsc --noEmit, no output written
npm run typecheck:web # tsc --checkJs over public/js/, one page at a time
npm start          # build, then run the server
npm run app        # build, then run the Electron app
npm test           # build, then node --test over build/tests/
npm run check      # no stray control characters; .js files also parse-checked
npm run dist       # build, then the Windows installer + portable exe
```

Every runnable script builds first, so a stale `build/` can never be what runs.

## Layout

The server is **TypeScript** under `server/`, compiled to `build/server/`. Root `server.js`
stays plain JavaScript — it is the entry point Electron requires, and it fails loudly if
`build/` is missing rather than crashing obscurely.

`build/` is the tsc output. `dist/` is electron-builder's output. They are different
directories and neither is committed.

Browser scripts in `public/js/` are plain JavaScript, served directly as classic scripts,
so there is no bundler in the path. They are **type-checked all the same**: `npm run
typecheck:web` runs `tsc --checkJs` over them, one page at a time, using the shared
contract in `types/web.d.ts`. Per page matters — classic scripts share a global scope,
so checking every file at once invents redeclaration errors between files that never
meet in a browser. Annotate with JSDoc casts when the compiler cannot see what an
element is; they are comments, so nothing changes at runtime.

The real code is in `server/`:

| Folder | Holds | Depends on |
|---|---|---|
| `config.js` | ports, token, all directory paths | nothing |
| `lib/` | `json`, `sanitize` — no app knowledge | nothing |
| `domain/` | `heroes`, `draft`, `match`, `settings`, `media` — pure rules | `lib` |
| `store/` | `live-state`, teams, tournaments, matches — things with state | `domain` |
| `services/` | `draft-engine` — the running clock | `store` |
| `http/`, `sockets/` | transport only, no rules | everything |

Dependencies point one way, downward. Anything in `domain/` must stay pure and testable
without starting a server — that is what makes the test suite cheap to extend.

Browser pages are classic scripts (no bundler, no modules). Shared client code follows the
IIFE-plus-global pattern: `public/js/lib/app-client.js` exports `window.RovClient`,
`public/js/lib/team-ui.js` exports `window.RovTeamUI`, `public/js/hotkey-utils.js` exports
`window.HotkeyUtils`. New control pages load `socket.io.js`, then `app-client.js`, then their
own script.

**A quick match outside any tournament is built from the team registry, not from saved
copies.** Presets were removed on 2026-08-28 — the registry holds team names, rosters and
logos in one place, shared by every tournament. `POST /api/teams/:id/live` with
`{ team: 'teamBlue' | 'teamRed' }` loads one registered team into one side of the overlay
and is what the Control Panel's "From registry" picker calls. It must keep touching **one
side only**: the other side, the score and any draft already entered have to survive,
because the second team is always picked while the first is already set up.

**Every operator page links `public/css/theme.css` first, and colours live only there.**
It holds the tokens, the type scale and the shared chrome (top bar, nav, `.tlink`, panels,
fields, badges, modal, toast); each page's own CSS holds only what is unique to it. The
theme is black, white and gold: gold marks *what is happening now* (current page, primary
action, focused field, the match on air) and nothing else, blue and red mean *team sides*
(red also means destructive), and there is no green or purple to reach for. Never link
`theme.css` from `overlay`, `overlay-1440`, `result` or `overlay-teams` — those are
broadcast graphics the user themes from the Design page, and operator styling must not be
able to change what viewers see mid-match.

**Any page that can delete a tournament loads `tournament-ui.js` before its own script.**
Same rule and same failure as `team-ui.js`: the page destructures `window.RovTournamentUI`
on its first line and dies blank without it. It holds `confirmAndDelete`, the one copy of
the wording that warns what a delete destroys — the home list and `/tournament/:id` must not
grow separate versions of that warning. It reads `window.RovClient` at load time, so it
loads after `app-client.js`. A test in `tournament-api.test.ts` asserts both.

**Deleting a tournament is a hard delete and `PRAGMA foreign_keys = ON` is what makes it
one.** The bracket, its games and their draft slots disappear through the `ON DELETE CASCADE`
chain in `migrations.ts`, not through any code in `remove()`. Without that pragma the delete
still returns success while orphaned matches and drafts stay behind and keep feeding the
statistics. `remove()` counts them before deleting, because after the delete every count is
zero, and the API hands those numbers back for the UI to report.

**Esc goes back a page, and `app-client.js` owns that binding.** Its `window`
keydown listener runs after everything else on the page, so a page that needs Esc for
its own thing must call `preventDefault()` or `stopPropagation()` — both confirm
boxes do. It reads `event.target` rather than `document.activeElement` to skip typing
fields, because a field can blur itself on Esc before the shared listener runs. Pages
with a parent mark their back link `data-esc-back`; it is the fallback when there is
no in-app history to return to.

**Any page that renders a team roster loads `team-ui.js` before its own script.** It holds
`buildPlayerRows`, `logoImage`, `sendLogo` and the defensive `on()` binder. Forget the tag and
the page dies at its first line, where it destructures `window.RovTeamUI` — blank page, no
handlers, and an error pointing at code that reads fine. A test in `team-api.test.ts` asserts
both the presence and the ordering for every page that needs it.

## Rules that are not obvious

**`server.js` must keep starting the server when required.** `electron-main.js` does
`require(path.join(__dirname, 'server.js'))` right after setting `ROV_USER_DATA_DIR` and
`ROV_USER_MEDIA_DIR`. Config reads those at require time. Import it earlier and the paths
come out empty.

**`config.ts` computes `ROOT_DIR` as two levels up**, because it runs from
`build/server/config.js`, not `server/config.js`. Get this wrong and hero images, `public/`,
and the data directory all resolve to nowhere — while the server still starts.

**New folders must be added to `build.files` in `package.json`.** electron-builder lists
paths explicitly, and it ships **`build/server/**/*`, not `server/**/*`** — the compiled
output, never the TypeScript source. A missing entry builds a clean `.exe` that crashes on
launch.

**Keep `strict` on, and keep network input typed `unknown`.** `lib/sanitize.ts` takes
`unknown` rather than `any` on purpose: `any` silences the checker exactly where the values
are least trustworthy. Sanitizers are the boundary where `unknown` becomes a real type.

**`sanitizeState` is a whitelist.** It rebuilds state from a fixed key list, so unknown keys
are dropped on the next save. Old save files upgrade themselves for free — but it also means
**tournament data must live in its own file**, never inside `state.json`, or opening the app
with an older build would erase it.

**`getState()` / `setState()`, never a captured reference.** State is *replaced* wholesale on
RESET MATCH and on putting a match on air. A module holding the old object keeps mutating a
detached copy: the UI
updates while the file on disk quietly goes stale.

**Media filenames never come from user text.** `domain/media.js` maps fixed slot names to
fixed filenames. For per-team logos, derive the name from a server-generated id and check it
with `isSafeMediaId` — never from a team name someone typed.

**Hero identity is an image filename** (`public/images/heroes/airi.png` → `"airi"`), and
`sanitizeHero` returns `null` for anything unknown. Renaming a hero image silently voids
historical records that reference the old name. Stored game history must be treated as opaque
strings and **not** re-sanitized against the live roster.

**OBS freezes browser sources that are off-scene**, so `animationend` may never fire. Any
entrance animation needs a timer fallback — see `public/js/overlay.js`.

**Overlay sound is opt-in per source, and silent until the first state is drawn.**
`public/js/overlay-sfx.js` loads before `overlay.js` (which calls `RovSfx` on the first
state — without the tag the overlay throws mid-render and freezes on air, so a test asserts
the order). Two rules it exists to enforce: only the one source carrying `?sfx=1` plays,
because the 1080p overlay, the 1440p overlay and the result screen all receive the same
state and would otherwise echo each other; and `play()` swallows everything until
`RovSfx.arm()` is called at the end of the first `updateOverlay`, because that first state
is the whole board arriving at once — without the gate, refreshing the source mid-draft
fires a pick sound for every hero already on screen. Files live in the user's media
directory (`USER_SOUND_DIR`), served at `/sounds`, with fixed names from a table in the
module — never from user text, same rule as `domain/media.ts`. `/sfx-test` is the diagnostic:
it reports which files the server can see and whether the browser allows autoplay, printed on
the page rather than logged, because it is meant to be opened as a browser source inside OBS
where there is no console. Keep it working when the folder is empty — that is the only state
in which anyone opens it.

**Sound levels are per event and live in state, not in the URL.** `state.sfx` holds a 0..1
level for `pick`, `ban` and `timer`, sanitized by `sanitizeSfx` and listed in
`CARRIED_OVER_KEYS`, so RESET MATCH and putting the next match on air leave them alone —
the same treatment as theme and hotkeys. State was the right home rather than a URL
parameter because the operator adjusts levels mid-event: the value rides the existing
`stateUpdate`, so an overlay already running in OBS follows instantly, where a URL change
would mean editing the browser source and refreshing it mid-broadcast. The overlay keeps one
GainNode per event so lowering one does not touch the others, and an invalid level falls
back to the default rather than to 0 — silence is indistinguishable from a fault.

**Read URL parameters with a null check, never bare `Number()`.** `params.get('vol')`
returns `null` when absent and `Number(null)` is `0`, which passes a `0..1` range check — the
overlay's gain node sat at zero and every sound played silently. The `/sfx-test` page hid it
by bypassing that gain node, so the diagnostic worked while the real thing did not.

**Overlay sound plays at full scale by default; attenuate in a mixer, not in the app.**
Level is already multiplied down by the Windows Volume Mixer, the system master and the OBS
mixer. A fourth reduction inside the app is invisible and turns "too quiet to notice" into
"broken" — one real case measured 19% (Chrome in the mixer) x 47% (master) x 0.7 (the app)
and read as silence. `&vol=` still exists for deliberate trimming.

**Overlay sound uses Web Audio, never `<audio>`, and that is not a style preference.**
On a real user machine `<audio>` hung at `readyState 0` forever — no error, no playback,
`networkState` stuck at LOADING — while `fetch` returned the same file fine and playing from
an in-memory blob hung identically, ruling out the network and Range requests. The same file
decoded through `AudioContext.decodeAudioData` and played, with the context clock advancing.
So `overlay-sfx.js` fetches and decodes each sound once at startup and plays a fresh
`BufferSource` per event. `sfx-test.js` must use Web Audio for the same reason — a
diagnostic built on the broken API reports the opposite of the truth on the one machine that
needs it. Web Audio is better here anyway: overlapping sounds are free, and decoding up front
removes the first-play delay.

The same module handles the browser-versus-OBS split for autoplay. A normal browser
refuses to play audio on a page nobody has clicked, so when a play is rejected the overlay
shows a "Click to enable sound" chip and calls `AudioContext.resume()` from the resulting
gesture handler — the call must start inside that handler or the gesture expires and the
unlock silently fails. That chip must never appear in OBS: obs-browser lifts the
restriction, and nobody is there to click, so it would sit on the broadcast forever. The
check is `window.obsstudio`, which obs-browser injects and a normal browser does not have.
**No escape sequences for control characters in source.** Writing them as backslash-u
escapes through some tooling turns them into real bytes in the file. `lib/sanitize.js`
compares char codes instead, and `npm run check` fails the build if raw control bytes
appear anywhere.

**Pages refresh themselves when data changes elsewhere.** `server/services/sync.ts` emits
`dataChanged` into one Socket.IO room with a topic (`teams`, `tournaments`, `roster`,
`matches`, `games`, `live`) and the ids involved — a signal, never the data, because each
page filters to its own scope. Every write endpoint calls `notifyData`; a new one that does
not is a page that silently goes stale. Overlays never join the room.

**Never let an auto-refresh overwrite a field being edited.** Use
`RovClient.deferWhileEditing(root, run)`: it refreshes now if nobody is typing inside
`root`, and otherwise waits until they stop. It polls rather than listening for `focusout`,
because focus events do not fire at all while the window is unfocused — exactly what happens
when the operator tabs over to OBS with the cursor still in a field.

## Standing rule: keep the plan current

**Any work that touches a phase must update `docs/TOURNAMENT_PLAN.md` in the same
change.** Not afterwards, not "later" — the same commit or the one straight after.

That document is the single source of truth for this upgrade and is written to
stand alone for a session with no conversation history. If it drifts, the next
session builds against a design that no longer exists. This already happened
once: the plan still described JSON files after Phase 1 had shipped SQLite.

What to update when a phase moves:
- §0 status — commit id, test count, what is next
- §7 phase table — mark the phase done with its commit
- §8 open items — remove what is finished, add what the work exposed
- §9 traps — add anything that cost real debugging time

## Where new work goes

- new page → `public/<name>.html` + `public/js/<name>.js`, route in `server/http/pages.ts`.
  A page served under a path segment (`/teams/:id`) must use absolute `/js/` and `/css/` hrefs
- new API → a new `server/http/api-<thing>.ts`, mounted in `server/index.ts`
- new rules → `server/domain/`, with tests in `tests/`
- new persisted data → its own module in `server/store/`; for tournament data that means a
  new step appended to `server/store/migrations.ts` — never edit a released step

## Conventions

Comments explain *why*, in Thai, and are load-bearing — several encode bugs that already
happened. Keep them when moving code. Two-space indent, single quotes, semicolons.
