import { Chess, type PieceSymbol } from 'chess.js'
const values: Record<PieceSymbol, number> = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 20000,
}
function score(chess: Chess) {
  if (chess.isCheckmate()) return chess.turn() === 'w' ? 100000 : -100000
  if (chess.isDraw()) return 0
  return chess
    .board()
    .flat()
    .reduce((sum, p) => {
      if (!p) return sum
      const center =
        3.5 -
        Math.abs(p.square.charCodeAt(0) - 97 - 3.5) +
        3.5 -
        Math.abs(Number(p.square[1]) - 1 - 3.5)
      return (
        sum +
        (p.color === 'b' ? 1 : -1) *
          (values[p.type] +
            (p.type === 'n' || p.type === 'p' ? center * 5 : center))
      )
    }, 0)
}
self.onmessage = (event: MessageEvent<{ pgn: string; revision: number }>) => {
  const chess = new Chess()
  if (event.data.pgn) chess.loadPgn(event.data.pgn)
  let best = -Infinity,
    chosen: string | null = null
  for (const move of chess.moves()) {
    chess.move(move)
    let worst = chess.isGameOver() ? score(chess) : Infinity
    for (const reply of chess.moves()) {
      chess.move(reply)
      worst = Math.min(worst, score(chess))
      chess.undo()
    }
    chess.undo()
    if (worst > best || (worst === best && Math.random() < 0.3)) {
      best = worst
      chosen = move
    }
  }
  self.postMessage({ move: chosen, revision: event.data.revision })
}
