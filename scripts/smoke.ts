// Exercises the real Worker and database. Run only against this template's
// disposable local database or its dedicated preview, never a production site.
// bun scripts/smoke.ts http://127.0.0.1:5184
import assert from 'node:assert/strict'
const origin = process.argv[2]
if (!origin) throw new Error('Pass the local or isolated preview origin.')
class Client {
  cookie = ''
  async request(
    path: string,
    body?: unknown,
    expected = 200,
    customOrigin = origin,
  ) {
    const response = await fetch(origin + '/api' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: customOrigin,
        Cookie: this.cookie,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const cookie = response.headers.get('set-cookie')
    if (cookie) this.cookie = cookie.split(';')[0]
    const data = (await response.json()) as any
    assert.equal(response.status, expected, JSON.stringify(data))
    return data
  }
}
const a = new Client(),
  b = new Client(),
  stranger = new Client()
await Promise.all([
  a.request('/session', {}),
  b.request('/session', {}),
  stranger.request('/session', {}),
])
await a.request(
  '/games',
  { minutes: 10, increment: 0, public: true, color: 'w' },
  403,
  'https://foreign.example',
)
let game = await a.request(
  '/games',
  { minutes: 10, increment: 0, public: true, color: 'w' },
  201,
)
assert.equal(game.seat, 'w')
assert.equal(game.white.id, undefined)
assert.ok((await b.request('/games')).some((g: any) => g.id === game.id))
const races = await Promise.allSettled([
  b.request(`/games/${game.code}/join`, {}),
  stranger.request(`/games/${game.code}/join`, {}),
])
assert.equal(
  races.filter((r) => r.status === 'fulfilled').length,
  1,
  'Only one opponent can claim the seat',
)
const opponent = races[0].status === 'fulfilled' ? b : stranger
const outsider = opponent === b ? stranger : b
game = await a.request(`/games/${game.id}`)
assert.equal(game.status, 'playing')
await outsider.request(
  `/games/${game.id}/move`,
  { revision: game.revision, from: 'e2', to: 'e4' },
  403,
)
await outsider.request(
  '/realtime/ticket',
  { room: `game:${game.id}`, userId: 'forged', publish: true },
  403,
)
await opponent.request(
  `/games/${game.id}/move`,
  { revision: game.revision, from: 'e7', to: 'e5' },
  409,
)
await a.request(
  `/games/${game.id}/move`,
  { revision: game.revision, from: 'e2', to: 'e5' },
  409,
)
const ticket = await opponent.request('/realtime/ticket', {
  room: `game:${game.id}`,
})
assert.equal(typeof ticket.websocketUrl, 'string')
const socket = new WebSocket(ticket.websocketUrl, {
  headers: { Origin: origin },
})
const messages: any[] = []
socket.addEventListener('message', (e) =>
  messages.push(JSON.parse(String(e.data))),
)
async function until(predicate: () => boolean) {
  const end = Date.now() + 12000
  while (!predicate()) {
    if (Date.now() > end)
      throw new Error('Timed out waiting for realtime message')
    await Bun.sleep(50)
  }
}
await until(() => messages.some((m) => m.type === 'ready'))
const old = game.revision
game = await a.request(`/games/${game.id}/move`, {
  revision: old,
  from: 'f2',
  to: 'f3',
})
await until(() =>
  messages.some(
    (m) => m.type === 'broadcast' && m.data?.revision === game.revision,
  ),
)
assert.equal(messages.find((m) => m.type === 'broadcast').userId, null)
await a.request(
  `/games/${game.id}/move`,
  { revision: old, from: 'e2', to: 'e4' },
  409,
)
game = await opponent.request(`/games/${game.id}/move`, {
  revision: game.revision,
  from: 'e7',
  to: 'e5',
})
game = await a.request(`/games/${game.id}/move`, {
  revision: game.revision,
  from: 'g2',
  to: 'g4',
})
game = await opponent.request(`/games/${game.id}/move`, {
  revision: game.revision,
  from: 'd8',
  to: 'h4',
})
assert.equal(game.result, '0-1')
assert.equal(game.reason, 'Checkmate')
const reloaded = await a.request(`/games/${game.id}`)
assert.equal(reloaded.pgn, game.pgn)
assert.ok(
  (await a.request('/history')).games.some(
    (g: any) => g.id === game.id && g.result === '0-1',
  ),
)
socket.close()
console.log(
  'Passed: guest sessions, public lobby, invite codes, join race, origin protection, seat authorization, illegal/stale moves, realtime delivery, checkmate, reload and history.',
)
process.exit(0)
