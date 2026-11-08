import { Chess, type Color, type Square } from 'chess.js'

export const CONTROLS = [
  { minutes: 3, increment: 2 },
  { minutes: 5, increment: 0 },
  { minutes: 10, increment: 0 },
  { minutes: 15, increment: 10 },
] as const
export type Player = { id: string; name: string; sub: string | null }
export type Game = {
  id: string
  code: string
  revision: number
  public: boolean
  status: 'waiting' | 'playing' | 'finished' | 'cancelled'
  white: Player | null
  black: Player | null
  pgn: string
  fen: string
  moves: string[]
  minutes: number
  increment: number
  whiteMs: number
  blackMs: number
  tickAt: number
  createdAt: number
  result: '1-0' | '0-1' | '½-½' | null
  reason: string | null
  drawOffer: Color | null
}
export type PublicGame = Omit<Game, 'white' | 'black'> & {
  white: { name: string } | null
  black: { name: string } | null
  seat: Color | null
  serverNow: number
}
export class GameError extends Error {}
export function chessFor(game: Pick<Game, 'pgn'>) {
  const chess = new Chess()
  if (game.pgn) chess.loadPgn(game.pgn)
  return chess
}
export function seatFor(game: Game, id: string): Color | null {
  return game.white?.id === id ? 'w' : game.black?.id === id ? 'b' : null
}
export function remaining(
  game: Pick<Game, 'status' | 'fen' | 'whiteMs' | 'blackMs' | 'tickAt'>,
  color: Color,
  now: number,
) {
  const ticking = game.status === 'playing' && game.fen.split(' ')[1] === color
  return Math.max(
    0,
    (color === 'w' ? game.whiteMs : game.blackMs) -
      (ticking ? Math.max(0, now - game.tickAt) : 0),
  )
}
export function finish(
  game: Game,
  result: Game['result'],
  reason: string,
  now: number,
): Game {
  return {
    ...game,
    whiteMs: remaining(game, 'w', now),
    blackMs: remaining(game, 'b', now),
    status: 'finished',
    result,
    reason,
    drawOffer: null,
    tickAt: now,
  }
}
export function settleClock(game: Game, now: number): Game {
  if (game.status !== 'playing') return game
  const turn = game.fen.split(' ')[1] as Color
  if (remaining(game, turn, now) > 0) return game
  // A bare king cannot win on time. Other low-material positions are handled
  // by chess.js's insufficient-material detection after every legal move.
  const other = turn === 'w' ? 'b' : 'w'
  const hasMaterial = new Chess(game.fen)
    .board()
    .flat()
    .some((p) => p?.color === other && p.type !== 'k')
  return finish(
    game,
    hasMaterial ? (turn === 'w' ? '0-1' : '1-0') : '½-½',
    hasMaterial ? 'Time out' : 'Insufficient material',
    now,
  )
}
export function moveGame(
  game: Game,
  actor: string,
  from: string,
  to: string,
  promotion: string | undefined,
  now: number,
): Game {
  const settled = settleClock(game, now)
  if (settled !== game) return settled
  if (game.status !== 'playing')
    throw new GameError('This game is not in play.')
  const chess = chessFor(game)
  const seat = seatFor(game, actor)
  if (!seat || seat !== chess.turn()) throw new GameError('Wait for your turn.')
  if (
    !/^[a-h][1-8]$/.test(from) ||
    !/^[a-h][1-8]$/.test(to) ||
    (promotion && !/^[qrbn]$/.test(promotion))
  )
    throw new GameError('Invalid move.')
  try {
    chess.move({ from: from as Square, to: to as Square, promotion })
  } catch {
    throw new GameError('That move is not legal.')
  }
  let next: Game = {
    ...game,
    pgn: chess.pgn(),
    fen: chess.fen(),
    moves: chess.history(),
    tickAt: now,
    drawOffer: null,
    whiteMs:
      remaining(game, 'w', now) + (seat === 'w' ? game.increment * 1000 : 0),
    blackMs:
      remaining(game, 'b', now) + (seat === 'b' ? game.increment * 1000 : 0),
  }
  if (chess.isCheckmate())
    next = finish(next, seat === 'w' ? '1-0' : '0-1', 'Checkmate', now)
  else if (chess.isDraw())
    next = finish(
      next,
      '½-½',
      chess.isStalemate()
        ? 'Stalemate'
        : chess.isThreefoldRepetition()
          ? 'Threefold repetition'
          : chess.isInsufficientMaterial()
            ? 'Insufficient material'
            : 'Fifty-move rule',
      now,
    )
  return next
}
export function newGame(
  player: Player,
  options: {
    minutes: number
    increment: number
    public: boolean
    color: Color
  },
  now: number,
): Game {
  if (
    !CONTROLS.some(
      (c) => c.minutes === options.minutes && c.increment === options.increment,
    )
  )
    throw new GameError('Choose a time control.')
  return {
    id: crypto.randomUUID(),
    code: Array.from(
      crypto.getRandomValues(new Uint8Array(8)),
      (n) => 'abcdefghjkmnpqrstuvwxyz23456789'[n % 29],
    ).join(''),
    revision: 0,
    public: options.public,
    status: 'waiting',
    white: options.color === 'w' ? player : null,
    black: options.color === 'b' ? player : null,
    pgn: '',
    fen: new Chess().fen(),
    moves: [],
    minutes: options.minutes,
    increment: options.increment,
    whiteMs: options.minutes * 60000,
    blackMs: options.minutes * 60000,
    tickAt: now,
    createdAt: now,
    result: null,
    reason: null,
    drawOffer: null,
  }
}
export function joinGame(game: Game, player: Player, now: number): Game {
  if (seatFor(game, player.id)) return game
  if (game.status !== 'waiting')
    throw new GameError('This game already has two players.')
  return {
    ...game,
    white: game.white ?? player,
    black: game.black ?? player,
    status: 'playing',
    tickAt: now,
  }
}
export function publicGame(game: Game, id: string, now: number): PublicGame {
  return {
    ...game,
    white: game.white && { name: game.white.name },
    black: game.black && { name: game.black.name },
    seat: seatFor(game, id),
    serverNow: now,
  }
}

// Authenticated seats follow their Freebuff subject across devices. A guest
// cookie alone never grants access to a seat belonging to a signed-in account.
export function actorFor(game: Game, player: Player) {
  for (const member of [game.white, game.black]) {
    if (
      member &&
      (member.sub ? member.sub === player.sub : member.id === player.id)
    )
      return member.id
  }
  return ''
}
