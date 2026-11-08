# chess.gg

A standalone chess template on Freebuff Sites. Original SVG pieces, a responsive
board, drag or click moves, four time controls, public games, private invite links
and codes, move replay, game exports, a small practice opponent and optional Sign
in with Freebuff. No account is required to play another person.

## Run

```sh
bun install
# Terminal 1: local managed realtime helper
bun run dev:realtime
# Terminal 2: app + local D1, at http://127.0.0.1:5184
bun run dev
```

Use two different browser profiles to play both sides. Two tabs in one profile
are the same guest. The computer is available without a second player; it runs
in a browser Worker so its search does not block board interaction.

```sh
bun run typecheck
bunx bun@1.3.14 test tests
bun scripts/smoke.ts http://127.0.0.1:5184
bun run build
```

The smoke test creates a disposable game and plays it to checkmate. It verifies
simultaneous seat claims, legal moves, stale revisions, same-origin protection,
nonmember rejection, a real WebSocket update, reload persistence and history.
Run it only against a local database or a dedicated preview.

## Deploy to Preview

Follow the repository's Freebuff Sites workflow: create the site, attach its
Preview D1 database as `DB`, enable Sign in with Freebuff for Preview, then
deploy `deploy.json`. Its `realtime: true` provisions the managed realtime helper.
The platform injects `APP_ORIGIN`, `FREEBUFF_CLIENT_ID` and `FREEBUFF_ISSUER`.
Local `wrangler.jsonc` values and database ids are never deployed as platform
configuration. No API key, session secret or external chess service is needed.

The hosted demo is at
https://site-9026a518791f45bbb3fe07b01ec05260.freebuff.page.
It has its own isolated database and realtime helper. Projects created from
this template provision their own resources; they do not share the demo's games
or accounts. Publishing the starter catalog does not promote the demo's data.

The generated `freebuff-realtime/worker.js` is **local development only**. Sites
deploys its own managed helper. Never upload the local helper as an app Worker.
Stop both local processes when finished.

## Where things live

- `src/styles.css`: colors, typography, responsive layout and board animation.
- `src/app/Piece.tsx`: the original, consistently shaded Staunton vector set.
- `src/app/Board.tsx`: stable piece identities, castling/capture animations,
  pointer handling, legal destinations, keyboard buttons and promotion.
- `src/shared/game.ts`: chess.js validation, history, game outcomes and clocks.
- `src/worker/index.ts`: guest sessions, Freebuff auth, D1, lobby and game APIs.
- `src/app/computer.ts`: a modest two-ply practice opponent, not an engine rating.

## State and identity

The server validates every online move. A compare-and-set on the game's revision
commits the entire state, clock and outcome atomically. Concurrent joins or moves
cannot overwrite each other. Published events contain only a revision; clients
fetch authoritative state, ignore older revisions and resync after reconnect.
A four-second snapshot fallback repairs a missed publication and resolves clocks
even if realtime is unavailable. Clocks use server time; an expired clock is
settled when the game is next read or changed. Guests cannot publish game events.

D1 stores this site's games and a SHA-256 hash of each random guest credential.
The credential lives only in an HttpOnly, SameSite cookie (Secure on hosted
origins). Invites identify a game, never authorize a player's moves. Games and
stats are casual, with no matchmaking rating or anti-cheat claim.

Signing in before creating or joining a game associates that seat with the
server-verified Freebuff `sub`. That account can resume on another device and
its wins, losses and draws persist. Guest history remains in that browser;
signing in does not retroactively claim guest results. Signing out does not
permit the guest cookie to control the account's seats.

The lobby shows up to 20 public waiting games created in the last 30 minutes.
Game history shows the latest 50; signed-in stats aggregate completed account
games. Game creation has a per-session cooldown and active-game cap. The managed
realtime limits still apply; this is a small casual chess room, not a tournament
service. No platform Postgres schema, auth provider or dispatcher is changed.

All visible copy uses sentence case. Fonts are bundled locally. No tracking,
remote image requests or purchased chess artwork are required.
