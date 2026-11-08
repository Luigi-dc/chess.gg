import { describe, expect, test } from 'bun:test'
import { Chess } from 'chess.js'
import {
  actorFor,
  newGame,
  joinGame,
  moveGame,
  settleClock,
  publicGame,
  type Game,
} from '../src/shared/game'

const white = { id: 'white', name: 'White', sub: 'private-white-sub' }
const black = { id: 'black', name: 'Black', sub: null }
function playing() {
  return joinGame(
    newGame(
      white,
      { minutes: 3, increment: 2, public: false, color: 'w' },
      1000,
    ),
    black,
    2000,
  )
}
function moves(game: Game, sequence: string[]) {
  let now = game.tickAt
  for (const san of sequence) {
    const chess = new Chess()
    if (game.pgn) chess.loadPgn(game.pgn)
    const actor = chess.turn() === 'w' ? white.id : black.id
    const move = chess.move(san)
    game = moveGame(
      game,
      actor,
      move.from,
      move.to,
      move.promotion,
      (now += 100),
    )
  }
  return game
}
describe('authoritative chess games', () => {
  test('account seats follow the verified subject, never a signed-out cookie', () => {
    const game = playing()
    expect(actorFor(game, { ...white, id: 'a-new-browser' })).toBe(white.id)
    expect(actorFor(game, { ...white, sub: null })).toBe('')
    expect(actorFor(game, { ...white, sub: 'someone-else' })).toBe('')
    expect(actorFor(game, black)).toBe(black.id)
    expect(actorFor(game, { ...black, id: 'someone-else' })).toBe('')
  })
  test('joining starts the clock, does not allow a third player, and a retry preserves the clock', () => {
    const game = playing()
    expect(game.status).toBe('playing')
    expect(joinGame(game, black, 3000)).toBe(game)
    expect(() => joinGame(game, { ...black, id: 'intruder' }, 3000)).toThrow(
      'two players',
    )
  })
  test('rejects illegal moves, wrong turns and nonplayers', () => {
    const game = playing()
    expect(() => moveGame(game, white.id, 'e2', 'e5', undefined, 3000)).toThrow(
      'not legal',
    )
    expect(() => moveGame(game, black.id, 'e7', 'e5', undefined, 3000)).toThrow(
      'turn',
    )
    expect(() =>
      moveGame(game, 'intruder', 'e2', 'e4', undefined, 3000),
    ).toThrow('turn')
    expect(() => moveGame(game, white.id, 'e2', 'e4', 'k', 3000)).toThrow(
      'Invalid',
    )
    expect(game.moves).toHaveLength(0)
  })
  test('subtracts elapsed server time and applies increment only to the mover', () => {
    const game = moveGame(playing(), white.id, 'e2', 'e4', undefined, 7000)
    expect(game.whiteMs).toBe(177000)
    expect(game.blackMs).toBe(180000)
    expect(game.tickAt).toBe(7000)
  })
  test('checkmate is durable and prevents further play', () => {
    const game = moves(playing(), ['f3', 'e5', 'g4', 'Qh4#'])
    expect(game.result).toBe('0-1')
    expect(game.reason).toBe('Checkmate')
    expect(() => moveGame(game, white.id, 'a2', 'a3', undefined, 5000)).toThrow(
      'not in play',
    )
  })
  test('castling moves both pieces', () => {
    const game = moves(playing(), [
      'e4',
      'e5',
      'Nf3',
      'Nc6',
      'Bc4',
      'Nf6',
      'O-O',
    ])
    const board = new Chess(game.fen)
    expect(board.get('g1')?.type).toBe('k')
    expect(board.get('f1')?.type).toBe('r')
    expect(board.get('h1')).toBeUndefined()
  })
  test('en passant removes the captured pawn', () => {
    const game = moves(playing(), ['e4', 'a6', 'e5', 'd5', 'exd6'])
    expect(new Chess(game.fen).get('d5')).toBeUndefined()
    expect(new Chess(game.fen).get('d6')?.color).toBe('w')
  })
  test('repetition detection survives reconstruction from stored history', () => {
    const game = moves(playing(), [
      'Nf3',
      'Nf6',
      'Ng1',
      'Ng8',
      'Nf3',
      'Nf6',
      'Ng1',
      'Ng8',
    ])
    expect(game.result).toBe('½-½')
    expect(game.reason).toBe('Threefold repetition')
  })
  test('promotion requires an explicit legal choice, including underpromotion', () => {
    const chess = new Chess('7k/P7/8/8/8/8/8/4K3 w - - 0 1')
    const game = { ...playing(), fen: chess.fen(), pgn: chess.pgn() }
    expect(() =>
      moveGame(game, white.id, 'a7', 'a8', undefined, 2100),
    ).toThrow()
    const promoted = moveGame(game, white.id, 'a7', 'a8', 'n', 2100)
    expect(new Chess(promoted.fen).get('a8')?.type).toBe('n')
    expect(promoted.reason).toBe('Insufficient material')
  })
  test('an expired clock defeats even an otherwise legal move', () => {
    const game = moveGame(playing(), white.id, 'e2', 'e4', undefined, 183000)
    expect(game.result).toBe('0-1')
    expect(game.moves).toHaveLength(0)
    expect(game.whiteMs).toBe(0)
    expect(settleClock(game, 500000)).toBe(game)
  })
  test('a player with only a king cannot win on time', () => {
    const chess = new Chess('7k/8/8/8/8/8/P7/4K3 w - - 0 1')
    expect(
      settleClock({ ...playing(), fen: chess.fen(), pgn: chess.pgn() }, 183000)
        .result,
    ).toBe('½-½')
  })
  test('public views never reveal player identifiers or account subjects', () => {
    const result = publicGame(playing(), white.id, 2500)
    expect(result.seat).toBe('w')
    expect(result.white).toEqual({ name: 'White' })
    expect(JSON.stringify(result)).not.toContain('private-white-sub')
  })
})
