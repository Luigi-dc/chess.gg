import { Hono } from 'hono'
import {
  createFreebuffAuth,
  isSameOriginRequest,
  type FreebuffAuth,
} from '@freebuff/auth'
import { getCookie, setCookie } from 'hono/cookie'
import { bodyLimit } from 'hono/body-limit'
import {
  CONTROLS,
  actorFor,
  GameError,
  finish,
  joinGame,
  moveGame,
  newGame,
  publicGame,
  seatFor,
  settleClock,
  type Game,
  type Player,
} from '../shared/game'
import {
  createRealtimeTicket,
  publishRealtime,
} from '../../freebuff-realtime/server.js'

type Env = {
  ASSETS: Fetcher
  DB: D1Database
  REALTIME?: DurableObjectNamespace
  FREEBUFF_CLIENT_ID?: string
  FREEBUFF_ISSUER?: string
  APP_ORIGIN: string
}
type Context = { Bindings: Env; Variables: { player: Player } }
let cached: { key: string; auth: FreebuffAuth } | undefined
function authFor(env: Env) {
  if (!env.FREEBUFF_CLIENT_ID) return null
  const key = `${env.FREEBUFF_CLIENT_ID}|${env.FREEBUFF_ISSUER}|${env.APP_ORIGIN}`
  if (cached?.key !== key)
    cached = {
      key,
      auth: createFreebuffAuth({
        clientId: env.FREEBUFF_CLIENT_ID,
        issuer: env.FREEBUFF_ISSUER,
        baseUrl: env.APP_ORIGIN,
        allowInsecureLocalhost: env.APP_ORIGIN.startsWith('http://127.0.0.1:'),
      }),
    }
  return cached.auth
}
const initialized = new WeakMap<D1Database, Promise<unknown>>()
function initialize(db: D1Database) {
  let pending = initialized.get(db)
  if (!pending) {
    pending = db
      .batch([
        db.prepare(
          'CREATE TABLE IF NOT EXISTS players (id TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL, name TEXT NOT NULL, expires_at INTEGER NOT NULL, last_create INTEGER NOT NULL DEFAULT 0)',
        ),
        db.prepare(
          'CREATE TABLE IF NOT EXISTS games (id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL, revision INTEGER NOT NULL, status TEXT NOT NULL, public INTEGER NOT NULL, white_id TEXT, black_id TEXT, white_sub TEXT, black_sub TEXT, created_at INTEGER NOT NULL, state TEXT NOT NULL)',
        ),
        db.prepare(
          'CREATE INDEX IF NOT EXISTS games_lobby ON games(status, public, created_at)',
        ),
        db.prepare(
          'CREATE INDEX IF NOT EXISTS games_white ON games(white_id, created_at)',
        ),
        db.prepare(
          'CREATE INDEX IF NOT EXISTS games_black ON games(black_id, created_at)',
        ),
        db.prepare(
          'CREATE INDEX IF NOT EXISTS games_white_sub ON games(white_sub, status, created_at)',
        ),
        db.prepare(
          'CREATE INDEX IF NOT EXISTS games_black_sub ON games(black_sub, status, created_at)',
        ),
      ])
      .catch((error) => {
        initialized.delete(db)
        throw error
      })
    initialized.set(db, pending)
  }
  return pending
}
async function hash(value: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
    ),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('')
}
async function load(db: D1Database, key: string) {
  if (!/^[a-z0-9-]{8,36}$/.test(key)) return null
  const row = await db
    .prepare('SELECT state FROM games WHERE id = ? OR code = ? LIMIT 1')
    .bind(key, key)
    .first<{ state: string }>()
  return row ? (JSON.parse(row.state) as Game) : null
}
async function save(db: D1Database, before: Game, next: Game) {
  next = { ...next, revision: before.revision + 1 }
  const result = await db
    .prepare(
      'UPDATE games SET state = ?, revision = ?, status = ?, white_id = ?, black_id = ?, white_sub = ?, black_sub = ? WHERE id = ? AND revision = ?',
    )
    .bind(
      JSON.stringify(next),
      next.revision,
      next.status,
      next.white?.id ?? null,
      next.black?.id ?? null,
      next.white?.sub ?? null,
      next.black?.sub ?? null,
      next.id,
      before.revision,
    )
    .run()
  if (result.meta.changes !== 1)
    throw new GameError('The game changed. Try again.')
  return next
}
async function broadcast(env: Env, game: Game) {
  if (!env.REALTIME) return
  try {
    await publishRealtime(env, {
      room: `game:${game.id}`,
      event: 'changed',
      data: { revision: game.revision },
    })
  } catch {
    console.warn(
      'Realtime publication unavailable; clients will refresh the snapshot.',
    )
  }
}
function view(game: Game, player: Player, now: number) {
  return publicGame(game, actorFor(game, player), now)
}
const app = new Hono<Context>()
app.use(
  '/api/*',
  bodyLimit({
    maxSize: 4096,
    onError: (c) => c.json({ error: 'Request too large.' }, 413),
  }),
)
app.use('/api/*', async (c, next) => {
  c.header('Cache-Control', 'private, no-store')
  if (!c.env.DB || !c.env.APP_ORIGIN)
    return c.json({ error: 'The game database is not connected.' }, 503)
  if (
    c.req.method !== 'GET' &&
    !isSameOriginRequest(c.req.raw, c.env.APP_ORIGIN)
  )
    return c.json({ error: 'Cross-origin request refused.' }, 403)
  if (
    c.req.method !== 'GET' &&
    !c.req.header('content-type')?.startsWith('application/json')
  )
    return c.json({ error: 'Send JSON.' }, 415)
  if (Number(c.req.header('content-length') ?? 0) > 4096)
    return c.json({ error: 'Request too large.' }, 413)
  await initialize(c.env.DB)
  const token = getCookie(
    c,
    c.env.APP_ORIGIN.startsWith('https:') ? '__Host-chess-gg' : 'chess-gg-local',
  )
  const stored =
    token && /^[a-f0-9]{64}$/.test(token)
      ? await c.env.DB.prepare(
          'SELECT id, name FROM players WHERE token_hash = ? AND expires_at > ?',
        )
          .bind(await hash(token), Date.now())
          .first<{ id: string; name: string }>()
      : null
  const user = await authFor(c.env)?.getUser(c.req.raw)
  if (stored)
    c.set('player', {
      ...stored,
      name: user?.name?.slice(0, 40) || stored.name,
      sub: user?.sub ?? null,
    })
  else if (c.req.path !== '/api/session')
    return c.json({ error: 'Refresh to join as a guest.' }, 401)
  await next()
})
app.post('/api/session', async (c) => {
  let player = c.get('player')
  const user = await authFor(c.env)?.getUser(c.req.raw)
  if (!player) {
    const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join('')
    player = {
      id: crypto.randomUUID(),
      name:
        user?.name?.slice(0, 40) ||
        `Guest ${Math.floor(1000 + Math.random() * 9000)}`,
      sub: user?.sub ?? null,
    }
    await c.env.DB.prepare(
      'INSERT INTO players (id, token_hash, name, expires_at) VALUES (?, ?, ?, ?)',
    )
      .bind(
        player.id,
        await hash(token),
        player.name,
        Date.now() + 30 * 86400000,
      )
      .run()
    const secure = c.env.APP_ORIGIN.startsWith('https:')
    setCookie(c, secure ? '__Host-chess-gg' : 'chess-gg-local', token, {
      httpOnly: true,
      secure,
      sameSite: 'Lax',
      path: '/',
      maxAge: 30 * 86400,
    })
  }
  return c.json({
    name: player.name,
    signedIn: !!user,
    authEnabled: !!c.env.FREEBUFF_CLIENT_ID,
    realtime: !!c.env.REALTIME,
  })
})
app.get('/api/games', async (c) => {
  const rows = await c.env.DB.prepare(
    'SELECT state FROM games WHERE status = ? AND public = 1 AND created_at > ? ORDER BY created_at DESC LIMIT 20',
  )
    .bind('waiting', Date.now() - 1800000)
    .all<{ state: string }>()
  return c.json(
    rows.results.map((row) =>
      view(JSON.parse(row.state), c.get('player'), Date.now()),
    ),
  )
})
app.get('/api/history', async (c) => {
  const player = c.get('player')
  const rows = await c.env.DB.prepare(
    'SELECT state FROM games WHERE ((white_id = ? AND white_sub IS NULL) OR (black_id = ? AND black_sub IS NULL) OR white_sub = ? OR black_sub = ?) ORDER BY created_at DESC LIMIT 50',
  )
    .bind(player.id, player.id, player.sub, player.sub)
    .all<{ state: string }>()
  const games = rows.results.map((row) => {
    const game = JSON.parse(row.state) as Game
    const id =
      player.sub && game.white?.sub === player.sub
        ? game.white.id
        : player.sub && game.black?.sub === player.sub
          ? game.black.id
          : player.id
    return publicGame(game, id, Date.now())
  })
  // Aggregate completed games for this authenticated account, with indexed predicates.
  const stats = player.sub
    ? await c.env.DB.prepare(
        `SELECT COUNT(*) AS played, SUM(CASE WHEN (white_sub = ? AND json_extract(state, '$.result') = '1-0') OR (black_sub = ? AND json_extract(state, '$.result') = '0-1') THEN 1 ELSE 0 END) AS wins, SUM(CASE WHEN json_extract(state, '$.result') = '½-½' THEN 1 ELSE 0 END) AS draws FROM games WHERE status = 'finished' AND (white_sub = ? OR black_sub = ?)`,
      )
        .bind(player.sub, player.sub, player.sub, player.sub)
        .first()
    : null
  return c.json({ games, stats })
})
app.post('/api/games', async (c) => {
  const body = await c.req.json<{
    minutes: number
    increment: number
    public: boolean
    color: string
  }>()
  if (
    !CONTROLS.some(
      (t) => t.minutes === body.minutes && t.increment === body.increment,
    ) ||
    typeof body.public !== 'boolean' ||
    !['w', 'b', 'random'].includes(body.color)
  )
    return c.json({ error: 'Choose a time control and a side.' }, 400)
  const player = c.get('player')
  const admitted = await c.env.DB.prepare(
    'UPDATE players SET last_create = ? WHERE id = ? AND last_create < ?',
  )
    .bind(Date.now(), player.id, Date.now() - 5000)
    .run()
  if (!admitted.meta.changes)
    return c.json({ error: 'Wait a moment before creating another game.' }, 429)
  const active = await c.env.DB.prepare(
    "SELECT id FROM games WHERE status IN ('waiting', 'playing') AND (white_id = ? OR black_id = ?) AND created_at > ? LIMIT 5",
  )
    .bind(player.id, player.id, Date.now() - 86400000)
    .all()
  if (active.results.length >= 5)
    return c.json({ error: 'Finish or cancel an existing game first.' }, 409)
  const game = newGame(
    player,
    {
      ...body,
      color:
        body.color === 'random'
          ? Math.random() < 0.5
            ? 'w'
            : 'b'
          : (body.color as 'w' | 'b'),
    },
    Date.now(),
  )
  await c.env.DB.prepare(
    'INSERT INTO games (id, code, revision, status, public, white_id, black_id, white_sub, black_sub, created_at, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(
      game.id,
      game.code,
      0,
      game.status,
      Number(game.public),
      game.white?.id ?? null,
      game.black?.id ?? null,
      game.white?.sub ?? null,
      game.black?.sub ?? null,
      game.createdAt,
      JSON.stringify(game),
    )
    .run()
  return c.json(publicGame(game, player.id, Date.now()), 201)
})
app.get('/api/games/:id', async (c) => {
  let game = await load(c.env.DB, c.req.param('id'))
  if (!game) return c.json({ error: 'Game not found.' }, 404)
  const settled = settleClock(game, Date.now())
  if (settled !== game) {
    try {
      game = await save(c.env.DB, game, settled)
      c.executionCtx.waitUntil(broadcast(c.env, game))
    } catch (error) {
      if (!(error instanceof GameError)) throw error
      game = (await load(c.env.DB, game.id))!
    }
  }
  return c.json(view(game, c.get('player'), Date.now()))
})
app.post('/api/games/:id/:action', async (c) => {
  const game = await load(c.env.DB, c.req.param('id'))
  if (!game) return c.json({ error: 'Game not found.' }, 404)
  const player = c.get('player'),
    action = c.req.param('action'),
    now = Date.now()
  const body = await c.req.json<{
    revision?: number
    from?: string
    to?: string
    promotion?: string
  }>()
  const actor = actorFor(game, player)
  const seat = seatFor(game, actor)
  let next: Game
  if (action === 'join') next = actor ? game : joinGame(game, player, now)
  else {
    if (!seat)
      return c.json({ error: 'Only the players can change this game.' }, 403)
    if (body.revision !== game.revision)
      return c.json({ error: 'The board changed. Try again.' }, 409)
    next = settleClock(game, now)
    if (next === game) {
      if (action === 'cancel' && game.status === 'waiting')
        next = { ...game, status: 'cancelled' }
      else if (game.status !== 'playing')
        return c.json({ error: 'This game is not in play.' }, 409)
      else if (action === 'move')
        next = moveGame(
          game,
          actor,
          body.from ?? '',
          body.to ?? '',
          body.promotion,
          now,
        )
      else if (action === 'resign')
        next = finish(game, seat === 'w' ? '0-1' : '1-0', 'Resignation', now)
      else if (action === 'draw')
        next =
          game.drawOffer && game.drawOffer !== seat
            ? finish(game, '½-½', 'Draw agreed', now)
            : { ...game, drawOffer: seat }
      else if (action === 'decline') next = { ...game, drawOffer: null }
      else return c.json({ error: 'Unknown action.' }, 400)
    }
  }
  if (next !== game) next = await save(c.env.DB, game, next)
  c.executionCtx.waitUntil(broadcast(c.env, next))
  return c.json(view(next, player, Date.now()))
})
app.post('/api/realtime/ticket', async (c) => {
  if (!c.env.REALTIME) return c.json({ error: 'Realtime unavailable.' }, 503)
  const { room } = await c.req.json<{ room: string }>()
  if (typeof room !== 'string' || !room.startsWith('game:'))
    return c.json({ error: 'Invalid room.' }, 400)
  const game = await load(c.env.DB, room.slice(5))
  if (!game || !actorFor(game, c.get('player')))
    return c.json({ error: 'Join the game first.' }, 403)
  return c.json(
    await createRealtimeTicket(c.env, {
      room: `game:${game.id}`,
      userId: c.get('player').id,
      origin: c.env.APP_ORIGIN,
      publish: false,
      presence: true,
    }),
  )
})
app.onError((error, c) => {
  if (error instanceof GameError) return c.json({ error: error.message }, 409)
  if (error instanceof SyntaxError)
    return c.json({ error: 'Invalid request.' }, 400)
  console.error('Chess request failed', error.name)
  return c.json({ error: 'Could not complete that request. Try again.' }, 500)
})
app.notFound((c) =>
  c.req.path.startsWith('/auth/')
    ? c.json(
        {
          error: 'Sign in with Freebuff has not been enabled for this preview.',
        },
        503,
      )
    : c.req.path.startsWith('/api/')
      ? c.json({ error: 'Not found.' }, 404)
      : c.env.ASSETS.fetch(c.req.raw),
)
export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const handler = (req: Request) => Promise.resolve(app.fetch(req, env, ctx))
    return authFor(env)?.wrap(handler)(request) ?? handler(request)
  },
}
