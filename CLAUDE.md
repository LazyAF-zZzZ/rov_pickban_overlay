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
| `store/` | `live-state`, `presets` — things with state | `domain` |
| `services/` | `draft-engine` — the running clock | `store` |
| `http/`, `sockets/` | transport only, no rules | everything |

Dependencies point one way, downward. Anything in `domain/` must stay pure and testable
without starting a server — that is what makes the test suite cheap to extend.

Browser pages are classic scripts (no bundler, no modules). Shared client code follows the
IIFE-plus-global pattern: `public/js/lib/app-client.js` exports `window.RovClient`,
`public/js/lib/team-ui.js` exports `window.RovTeamUI`, `public/js/hotkey-utils.js` exports
`window.HotkeyUtils`. New control pages load `socket.io.js`, then `app-client.js`, then their
own script.

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
preset load and reset. A module holding the old object keeps mutating a detached copy: the UI
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

**No escape sequences for control characters in source.** Writing them as backslash-u
escapes through some tooling turns them into real bytes in the file. `lib/sanitize.js`
compares char codes instead, and `npm run check` fails the build if raw control bytes
appear anywhere.

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
