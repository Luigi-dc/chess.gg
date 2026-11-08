import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Chess, type Color, type Square } from 'chess.js'
import {
  ArrowDownUp,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  Copy,
  Flag,
  History,
  Link2,
  LoaderCircle,
  Palette,
  Plus,
  RotateCcw,
  Shuffle,
  Swords,
  Trophy,
  Users,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'
import { Board } from './Board'
import { Piece } from './Piece'
import {
  CONTROLS,
  finish,
  moveGame,
  newGame,
  publicGame,
  remaining,
  settleClock,
  type Game,
  type PublicGame,
} from '../shared/game'
import { connectRealtime } from '../../freebuff-realtime/browser.js'

type Session = {
  name: string
  signedIn: boolean
  authEnabled: boolean
  realtime: boolean
}
async function api<T>(path: string, data?: unknown): Promise<T> {
  const response = await fetch(
    `/api${path}`,
    data === undefined
      ? { cache: 'no-store' }
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        },
  )
  const body = (await response.json()) as T & { error?: string }
  if (!response.ok)
    throw new Error(body.error || 'Connection interrupted. Try again.')
  return body as T
}
function time(ms: number) {
  const seconds = Math.ceil(Math.max(0, ms) / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
function useNow() {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 100)
    return () => clearInterval(timer)
  }, [])
  return now
}
function PlayerBar({
  name,
  color,
  ms,
  active,
  you,
  waiting,
  connected,
}: {
  name: string
  color: Color
  ms: number
  active: boolean
  you: boolean
  waiting?: boolean
  connected?: boolean
}) {
  return (
    <div className={`player-bar ${active ? 'active' : ''}`}>
      <div className={`player-avatar ${color}`}>
        <Piece type="k" color={color} />
      </div>
      <div className="player-identity">
        <strong>{name}</strong>
        <span>
          {waiting
            ? 'Open seat'
            : you
              ? 'You'
              : color === 'w'
                ? 'White pieces'
                : 'Black pieces'}
          {connected && <i className="presence-dot" title="Connected" />}
        </span>
      </div>
      <div
        className={`clock ${active ? 'ticking' : ''} ${ms < 30000 && active ? 'low' : ''}`}
      >
        <Clock3 size={17} />
        <span>{time(ms)}</span>
      </div>
    </div>
  )
}
const blank = new Chess()
export function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [game, setGame] = useState<PublicGame | null>(null)
  const [practice, setPractice] = useState<Game | null>(null)
  const [lobby, setLobby] = useState<PublicGame[]>([])
  const [games, setGames] = useState<PublicGame[]>([])
  const [stats, setStats] = useState<{
    played: number
    wins: number
    draws: number
  } | null>(null)
  const [panel, setPanel] = useState<'play' | 'history'>('play')
  const [control, setControl] = useState(2)
  const [color, setColor] = useState<'w' | 'b' | 'random'>('random')
  const [flipped, setFlipped] = useState(false)
  const [sound, setSound] = useState(true)
  const [theme, setTheme] = useState(0)
  const [review, setReview] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [code, setCode] = useState('')
  const [joinOpen, setJoinOpen] = useState(false)
  const [confirm, setConfirm] = useState<'resign' | 'help' | null>(null)
  const [copied, setCopied] = useState(false)
  const [connection, setConnection] = useState('connecting')
  const [peers, setPeers] = useState(0)
  const [ready, setReady] = useState(false)
  const moveList = useRef<HTMLDivElement>(null)
  const dialog = useRef<HTMLElement>(null)
  const now = useNow()
  const offset = useRef(0),
    lastRevision = useRef(-1),
    gameId = useRef<string | null>(null),
    audio = useRef<AudioContext | null>(null)
  const current = practice ? publicGame(practice, 'practice-you', now) : game
  const active = current?.status === 'playing',
    waiting = current?.status === 'waiting'
  const orientation: Color = (current?.seat === 'b') !== flipped ? 'b' : 'w'
  const turn = (current?.fen.split(' ')[1] || 'w') as Color
  const visible = useMemo(() => {
    const chess = new Chess()
    if (current?.pgn) chess.loadPgn(current.pgn)
    if (review !== null) {
      while (chess.history().length > review) chess.undo()
    }
    return { fen: chess.fen(), pgn: chess.pgn(), check: chess.inCheck() }
  }, [current?.pgn, review])
  const accept = useCallback((next: PublicGame) => {
    if (gameId.current !== next.id) {
      gameId.current = next.id
      lastRevision.current = -1
      setReview(null)
      setFlipped(false)
    }
    if (next.revision < lastRevision.current) return
    lastRevision.current = next.revision
    offset.current = next.serverNow - Date.now()
    setGame(next)
  }, [])
  const refresh = useCallback(
    async (id: string) => {
      const next = await api<PublicGame>(`/games/${id}`)
      if (gameId.current === id) accept(next)
    },
    [accept],
  )
  useEffect(() => {
    let live = true
    api<Session>('/session', {})
      .then(async (s) => {
        if (!live) return
        setSession(s)
        setReady(true)
        const id = new URL(location.href).searchParams.get('game')
        if (id) {
          const next = await api<PublicGame>(`/games/${encodeURIComponent(id)}`)
          if (live) accept(next)
        }
      })
      .catch((e) => {
        if (live) setError(e.message)
      })
    return () => {
      live = false
    }
  }, [accept])
  useEffect(() => {
    if (!ready) return
    let live = true
    const load = () =>
      api<PublicGame[]>('/games')
        .then((result) => {
          if (live) setLobby(result)
        })
        .catch(() => {})
    void load()
    const timer = setInterval(() => {
      if (!document.hidden) void load()
    }, 8000)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [ready, game?.id])
  useEffect(() => {
    if (!ready || panel !== 'history') return
    api<{ games: PublicGame[]; stats: typeof stats }>('/history')
      .then((result) => {
        setGames(result.games)
        setStats(result.stats)
      })
      .catch((e) => setError(e.message))
  }, [ready, panel])
  useEffect(() => {
    if (
      !game ||
      practice ||
      game.status === 'cancelled' ||
      game.status === 'finished'
    )
      return
    const id = game.id
    const sync = () => {
      if (!document.hidden)
        void refresh(id).catch(() => {
          /* The next snapshot repairs transient HTTP failures. */
        })
    }
    const timer = setInterval(sync, 4000)
    window.addEventListener('online', sync)
    document.addEventListener('visibilitychange', sync)
    const socket =
      session?.realtime && game.seat
        ? connectRealtime({
            room: `game:${id}`,
            onStatus: (status: string) => setConnection(status),
            onMessage: (message: {
              type: string
              members?: unknown[]
              userId?: string | null
            }) => {
              if (
                message.type === 'ready' ||
                (message.type === 'broadcast' && message.userId === null)
              )
                sync()
              if (message.type === 'presence')
                setPeers(message.members?.length || 0)
            },
          })
        : null
    return () => {
      clearInterval(timer)
      socket?.close()
      window.removeEventListener('online', sync)
      document.removeEventListener('visibilitychange', sync)
      setPeers(0)
    }
  }, [
    game?.id,
    game?.seat,
    game?.status,
    practice !== null,
    ready,
    session?.realtime,
    refresh,
  ])
  useEffect(() => {
    if (!practice || practice.status !== 'playing' || turn !== 'b') return
    const worker = new Worker(new URL('./computer.ts', import.meta.url), {
      type: 'module',
    })
    const snapshot = practice
    worker.onmessage = ({
      data,
    }: MessageEvent<{ move: string; revision: number }>) => {
      const chess = new Chess()
      if (snapshot.pgn) chess.loadPgn(snapshot.pgn)
      const move = chess.move(data.move)
      if (move)
        setPractice((previous) =>
          previous?.revision === data.revision
            ? {
                ...moveGame(
                  previous,
                  'practice-computer',
                  move.from,
                  move.to,
                  move.promotion,
                  Date.now(),
                ),
                revision: previous.revision + 1,
              }
            : previous,
        )
    }
    const timer = setTimeout(
      () =>
        worker.postMessage({ pgn: snapshot.pgn, revision: snapshot.revision }),
      420,
    )
    return () => {
      clearTimeout(timer)
      worker.terminate()
    }
  }, [practice?.revision, practice?.status, turn])
  useEffect(() => {
    if (!current?.moves.length || !sound) return
    try {
      audio.current ??= new AudioContext()
      const ctx = audio.current,
        oscillator = ctx.createOscillator(),
        gain = ctx.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.setValueAtTime(500, ctx.currentTime)
      oscillator.frequency.exponentialRampToValueAtTime(
        180,
        ctx.currentTime + 0.055,
      )
      gain.gain.setValueAtTime(0.07, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08)
      oscillator.connect(gain)
      gain.connect(ctx.destination)
      oscillator.start()
      oscillator.stop(ctx.currentTime + 0.09)
    } catch {
      /* Audio is optional, including browsers that require a gesture. */
    }
  }, [current?.moves.length, sound])
  useEffect(() => {
    if (practice?.status !== 'playing') return
    const settled = settleClock(practice, now)
    if (settled !== practice) setPractice(settled)
  }, [now, practice])
  useEffect(() => {
    if (current?.status === 'playing') window.scrollTo({ top: 0 })
  }, [current?.id, current?.status])
  useEffect(() => {
    if (review === null && moveList.current)
      moveList.current.scrollTop = moveList.current.scrollHeight
  }, [current?.moves.length, review])
  useEffect(() => {
    if (!joinOpen && !confirm) return
    const previous = document.activeElement as HTMLElement | null
    const root = dialog.current
    const focusable = () =>
      Array.from(
        root?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input, a[href]',
        ) ?? [],
      )
    const preferred = root?.querySelector<HTMLElement>('input, [autofocus]')
    ;(preferred ?? focusable()[0])?.focus()
    const trap = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setJoinOpen(false)
        setConfirm(null)
      }
      if (event.key !== 'Tab') return
      const elements = focusable(),
        first = elements[0],
        last = elements.at(-1)
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }
    document.addEventListener('keydown', trap)
    return () => {
      document.removeEventListener('keydown', trap)
      previous?.focus()
    }
  }, [joinOpen, confirm])
  const run = async (task: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await task()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const openGame = (next: PublicGame) => {
    setPractice(null)
    accept(next)
    setPanel('play')
    window.scrollTo({ top: 0 })
    history.replaceState(null, '', `?game=${next.id}`)
  }
  const create = (isPublic: boolean) =>
    run(async () =>
      openGame(
        await api<PublicGame>('/games', {
          ...CONTROLS[control],
          public: isPublic,
          color,
        }),
      ),
    )
  const join = (id: string) =>
    run(async () => {
      openGame(
        await api<PublicGame>(`/games/${encodeURIComponent(id)}/join`, {}),
      )
      setJoinOpen(false)
    })
  const action = (name: string, data: object = {}) =>
    run(async () => {
      if (!game) return
      try {
        accept(
          await api<PublicGame>(`/games/${game.id}/${name}`, {
            revision: game.revision,
            ...data,
          }),
        )
        setReview(null)
      } catch (e) {
        await refresh(game.id)
        throw e
      }
    })
  const move = (from: Square, to: Square, promotion?: string) => {
    if (practice) {
      try {
        setPractice({
          ...moveGame(
            practice,
            'practice-you',
            from,
            to,
            promotion,
            Date.now(),
          ),
          revision: practice.revision + 1,
        })
      } catch (e) {
        setError((e as Error).message)
      }
    } else void action('move', { from, to, promotion })
  }
  const startPractice = () => {
    const game = newGame(
      { id: 'practice-you', name: session?.name || 'You', sub: null },
      { ...CONTROLS[control], public: false, color: 'w' },
      now,
    )
    setPractice({
      ...game,
      black: { id: 'practice-computer', name: 'The house', sub: null },
      status: 'playing',
    })
    setReview(null)
    setFlipped(false)
    setGame(null)
    gameId.current = null
    setPanel('play')
    window.scrollTo({ top: 0 })
    history.replaceState(null, '', location.pathname)
  }
  const home = () => {
    setGame(null)
    setPractice(null)
    gameId.current = null
    setPanel('play')
    setReview(null)
    setError('')
    history.replaceState(null, '', location.pathname)
  }
  const copy = () =>
    run(async () => {
      await navigator.clipboard.writeText(
        `${location.origin}/?game=${current!.id}`,
      )
      setCopied(true)
      setTimeout(() => setCopied(false), 2200)
    })
  const signIn = `/auth/freebuff/signin?returnTo=${encodeURIComponent(location.pathname + location.search)}`
  const count = current?.moves.length || 0
  const clock = (side: Color) =>
    current
      ? remaining(current, side, practice ? now : now + offset.current)
      : CONTROLS[control].minutes * 60000
  const topColor = orientation === 'w' ? 'b' : 'w',
    bottomColor = orientation
  const player = (side: Color) =>
    current ? (side === 'w' ? current.white : current.black) : null
  const status = waiting
    ? 'Waiting for a player'
    : current?.status === 'finished'
      ? current.reason
      : active
        ? visible.check
          ? 'Check'
          : turn === current?.seat
            ? 'Your move'
            : 'Their move'
        : ''
  return (
    <div
      className={`app theme-${theme} ${!current || waiting || panel === 'history' ? 'setup' : 'in-game'}`}
    >
      <aside className="sidebar">
        <a
          className="brand"
          href="/"
          onClick={(e) => {
            e.preventDefault()
            home()
          }}
        >
          <svg viewBox="0 0 40 40" aria-hidden="true">
            <path d="M9 7h6v6h3V7h4v6h3V7h6v12l-5 5v8H14v-8l-5-5zM11 34h18" />
          </svg>
          <span>
            chess<span className="brand-period">.gg</span>
          </span>
        </a>
        <nav aria-label="Main navigation">
          <button
            className={panel === 'play' ? 'nav-item selected' : 'nav-item'}
            onClick={() => setPanel('play')}
          >
            <Swords size={19} />
            Play
            <ArrowRight className="nav-arrow" size={16} />
          </button>
          <button
            className={panel === 'history' ? 'nav-item selected' : 'nav-item'}
            onClick={() => setPanel('history')}
          >
            <History size={19} />
            Your games
          </button>
        </nav>
        <div className="sidebar-bottom">
          <button className="nav-item" onClick={() => setConfirm('help')}>
            <CircleHelp size={18} />
            How to play
          </button>
          <div className="account">
            <div className="account-avatar">
              {(session?.name || 'Guest').slice(0, 1)}
            </div>
            <div>
              <strong>
                {session?.signedIn ? session.name : 'Guest player'}
              </strong>
              {session?.signedIn ? (
                <form method="post" action="/auth/freebuff/signout">
                  <button>Sign out</button>
                </form>
              ) : session?.authEnabled ? (
                <a href={signIn}>
                  Sign in with Freebuff <ArrowRight size={12} />
                </a>
              ) : null}
            </div>
          </div>
        </div>
      </aside>
      <main>
        <header className="page-header">
          <div>
            <h1>{panel === 'history' ? 'Your games' : 'Play chess'}</h1>
          </div>
          <div className="header-actions">
            <span className="quiet-badge">
              <i /> {practice ? 'Practice' : 'Casual chess'}
            </span>
            <button
              className="icon-button"
              aria-label="Change board colors"
              title="Change board colors"
              onClick={() => setTheme((theme + 1) % 3)}
            >
              <Palette size={19} />
            </button>
          </div>
        </header>
        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button
              className="icon-button"
              aria-label="Dismiss error"
              onClick={() => setError('')}
            >
              <X size={16} />
            </button>
          </div>
        )}
        <div className="game-layout">
          <section className="board-column" aria-label="Game">
            <PlayerBar
              color={topColor}
              name={
                player(topColor)?.name ||
                (current ? 'Waiting for someone…' : 'Your opponent')
              }
              ms={clock(topColor)}
              active={!!active && turn === topColor}
              you={current?.seat === topColor}
              waiting={waiting && !player(topColor)}
              connected={peers > 1}
            />
            <Board
              fen={visible.fen || blank.fen()}
              pgn={visible.pgn}
              orientation={orientation}
              turn={turn}
              enabled={
                !!active && current?.seat === turn && review === null && !busy
              }
              onMove={move}
            />
            <PlayerBar
              color={bottomColor}
              name={
                player(bottomColor)?.name ||
                (current ? 'Waiting for someone…' : session?.name || 'You')
              }
              ms={clock(bottomColor)}
              active={!!active && turn === bottomColor}
              you={!current || current?.seat === bottomColor}
              waiting={waiting && !player(bottomColor)}
            />
            <div className="board-footer">
              <span className={active ? 'turn-status' : ''}>
                {active && <i />}
                {review !== null ? `Move ${Math.ceil(review / 2)}` : status}
              </span>
              <div>
                <button
                  className="icon-button"
                  title="Flip board"
                  aria-label="Flip board"
                  onClick={() => setFlipped(!flipped)}
                >
                  <ArrowDownUp size={17} />
                </button>
                <button
                  className="icon-button"
                  title={sound ? 'Mute sound' : 'Enable sound'}
                  aria-label={sound ? 'Mute sound' : 'Enable sound'}
                  onClick={() => setSound(!sound)}
                >
                  {sound ? <Volume2 size={17} /> : <VolumeX size={17} />}
                </button>
              </div>
            </div>
          </section>
          <aside className="game-panel">
            {panel === 'history' ? (
              <>
                <div className="panel-heading">
                  <h2>Your games</h2>
                  <button
                    className="icon-button"
                    aria-label="Back to play"
                    onClick={() => setPanel('play')}
                  >
                    <X size={18} />
                  </button>
                </div>
                {stats && (
                  <div className="stats">
                    <div>
                      <strong>{stats.played}</strong>
                      <span>Played</span>
                    </div>
                    <div>
                      <strong>{stats.wins || 0}</strong>
                      <span>Won</span>
                    </div>
                    <div>
                      <strong>{stats.draws || 0}</strong>
                      <span>Drawn</span>
                    </div>
                    <div>
                      <strong>
                        {stats.played - (stats.wins || 0) - (stats.draws || 0)}
                      </strong>
                      <span>Lost</span>
                    </div>
                  </div>
                )}
                <div className="history-list">
                  {games.length ? (
                    games.map((g) => (
                      <button
                        className="history-game"
                        key={g.id}
                        onClick={() =>
                          run(async () =>
                            openGame(await api<PublicGame>(`/games/${g.id}`)),
                          )
                        }
                      >
                        <div>
                          <strong>
                            {(g.seat === 'w' ? g.black : g.white)?.name ||
                              'Open seat'}
                          </strong>
                          <span>
                            {new Date(g.createdAt).toLocaleDateString(
                              undefined,
                              { month: 'short', day: 'numeric' },
                            )}{' '}
                            · {g.minutes} + {g.increment}
                          </span>
                        </div>
                        <span className="game-result">
                          {g.result ||
                            (g.status === 'waiting'
                              ? 'Waiting'
                              : g.status === 'cancelled'
                                ? 'Cancelled'
                                : 'In play')}
                        </span>
                        <ChevronRight size={16} />
                      </button>
                    ))
                  ) : (
                    <div className="empty-history">
                      <History size={30} strokeWidth={1.3} />
                      <p>Your first game is waiting.</p>
                      <button
                        className="text-button"
                        onClick={() => setPanel('play')}
                      >
                        Let’s play <ArrowRight size={15} />
                      </button>
                    </div>
                  )}
                </div>
                {!session?.signedIn && session?.authEnabled && (
                  <a className="signin-note" href={signIn}>
                    Sign in with Freebuff to save your record{' '}
                    <ArrowRight size={15} />
                  </a>
                )}
              </>
            ) : current ? (
              <>
                <div className="panel-heading">
                  <div>
                    <span className="eyebrow">
                      {practice
                        ? 'Practice'
                        : current.public
                          ? 'Open game'
                          : 'Friendly game'}
                    </span>
                    <h2>
                      {current.minutes} <span className="time-plus">+</span>{' '}
                      {current.increment}
                      <small>{current.minutes < 10 ? 'Blitz' : 'Rapid'}</small>
                    </h2>
                  </div>
                  <button
                    className="icon-button"
                    aria-label="Return to lobby"
                    title="Return to lobby"
                    onClick={home}
                  >
                    <ArrowLeft size={18} />
                  </button>
                </div>
                {waiting ? (
                  <div className="waiting-content">
                    <div className="waiting-symbol">
                      <Piece type="n" color="w" />
                      <span className="waiting-pulse" />
                    </div>
                    <h3>
                      {current.seat ? 'Waiting for a player' : 'Join this game'}
                    </h3>
                    {current.seat ? (
                      <>
                        <div className="invite-code">
                          <span>{current.code}</span>
                          <button
                            className="icon-button"
                            title="Copy game code"
                            aria-label="Copy game code"
                            onClick={() =>
                              run(async () => {
                                await navigator.clipboard.writeText(
                                  current.code,
                                )
                                setCopied(true)
                                setTimeout(() => setCopied(false), 2200)
                              })
                            }
                          >
                            {copied ? <Check size={16} /> : <Copy size={16} />}
                          </button>
                        </div>
                        <button
                          className="primary"
                          disabled={busy}
                          onClick={copy}
                        >
                          {copied ? <Check size={17} /> : <Link2 size={17} />}{' '}
                          {copied ? 'Copied' : 'Copy invite link'}
                        </button>
                        <span className="waiting-note">
                          {current.public
                            ? 'Your game is also in the open lobby.'
                            : 'Anyone with the link can join.'}
                        </span>
                        <button
                          className="text-button muted"
                          onClick={() => action('cancel')}
                          disabled={busy}
                        >
                          Cancel game
                        </button>
                      </>
                    ) : (
                      <button
                        className="primary"
                        disabled={busy}
                        onClick={() => join(current.id)}
                      >
                        Join game <ArrowRight size={18} />
                      </button>
                    )}
                  </div>
                ) : (
                  <>
                    <div className="game-state">
                      <span>
                        <i
                          className={`connection-dot ${connection === 'connected' || practice ? 'online' : ''}`}
                        />
                        {current.status === 'finished'
                          ? 'Game complete'
                          : practice
                            ? 'Playing the house'
                            : connection === 'connected'
                              ? 'Connected'
                              : 'Syncing'}
                      </span>
                      <span>
                        {current.seat
                          ? current.seat === 'w'
                            ? 'You’re white'
                            : 'You’re black'
                          : 'Spectating'}
                      </span>
                    </div>
                    {current.status === 'finished' && (
                      <div className="result-card">
                        <Trophy size={25} strokeWidth={1.5} />
                        <h3>
                          {current.result === '½-½'
                            ? 'A well-played draw.'
                            : `${current.result === '1-0' ? 'White' : 'Black'} wins.`}
                        </h3>
                        <span>{current.reason}</span>
                        <strong>{current.result}</strong>
                        <button
                          className="primary"
                          onClick={practice ? startPractice : home}
                        >
                          Play again <RotateCcw size={16} />
                        </button>
                      </div>
                    )}
                    {current.status === 'cancelled' ? (
                      <div className="empty-history">
                        <p>Game cancelled.</p>
                        <button className="primary" onClick={home}>
                          New game
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="moves-heading">
                          <span>Moves</span>
                          {count > 0 && (
                            <button
                              className="text-button"
                              onClick={() => {
                                const blob = new Blob([current.pgn], {
                                    type: 'application/x-chess-pgn',
                                  }),
                                  url = URL.createObjectURL(blob),
                                  a = document.createElement('a')
                                a.href = url
                                a.download = 'chess-gg-game.pgn'
                                a.click()
                                URL.revokeObjectURL(url)
                              }}
                            >
                              Export
                            </button>
                          )}
                        </div>
                        <div className="move-list" ref={moveList}>
                          {count ? (
                            Array.from(
                              { length: Math.ceil(count / 2) },
                              (_, i) => (
                                <div className="move-row" key={i}>
                                  <span>{i + 1}.</span>
                                  {[i * 2, i * 2 + 1].map((index) => (
                                    <button
                                      key={index}
                                      disabled={!current.moves[index]}
                                      className={
                                        (review ?? count) === index + 1
                                          ? 'current-move'
                                          : ''
                                      }
                                      onClick={() =>
                                        setReview(
                                          index + 1 === count
                                            ? null
                                            : index + 1,
                                        )
                                      }
                                    >
                                      {current.moves[index] || ''}
                                    </button>
                                  ))}
                                </div>
                              ),
                            )
                          ) : (
                            <div className="empty-moves">
                              <span>1.</span>
                              <span>White to move</span>
                            </div>
                          )}
                        </div>
                        <div className="replay-controls">
                          <button
                            className="icon-button"
                            aria-label="First position"
                            disabled={!count}
                            onClick={() => setReview(0)}
                          >
                            <ChevronFirst size={19} />
                          </button>
                          <button
                            className="icon-button"
                            aria-label="Previous move"
                            disabled={!count || review === 0}
                            onClick={() =>
                              setReview(Math.max(0, (review ?? count) - 1))
                            }
                          >
                            <ChevronLeft size={19} />
                          </button>
                          <button
                            className="icon-button"
                            aria-label="Next move"
                            disabled={review === null}
                            onClick={() =>
                              setReview(
                                (review ?? count) + 1 >= count
                                  ? null
                                  : (review ?? count) + 1,
                              )
                            }
                          >
                            <ChevronRight size={19} />
                          </button>
                          <button
                            className="icon-button"
                            aria-label="Live board"
                            disabled={review === null}
                            onClick={() => setReview(null)}
                          >
                            <ChevronLast size={19} />
                          </button>
                        </div>
                      </>
                    )}
                    {current.drawOffer && active && (
                      <div className="draw-notice">
                        {current.drawOffer === current.seat ? (
                          <span>Draw offered</span>
                        ) : (
                          <>
                            <span>Draw?</span>
                            <button onClick={() => action('draw')}>
                              Accept
                            </button>
                            <button onClick={() => action('decline')}>
                              Decline
                            </button>
                          </>
                        )}
                      </div>
                    )}
                    {active && current.seat && (
                      <div className="game-actions">
                        {!practice && (
                          <button
                            onClick={() => action('draw')}
                            disabled={busy || !!current.drawOffer}
                          >
                            <span className="draw-icon">½</span>Offer draw
                          </button>
                        )}
                        <button
                          onClick={() => setConfirm('resign')}
                          disabled={busy}
                        >
                          <Flag size={15} />
                          Resign
                        </button>
                      </div>
                    )}
                  </>
                )}
              </>
            ) : (
              <>
                <div className="panel-heading">
                  <h2>New game</h2>
                  <span className="panel-emblem">
                    <Swords size={19} />
                  </span>
                </div>
                <div className="new-game-controls">
                  <div className="control-label">Time control</div>
                  <div className="time-controls">
                    {CONTROLS.map((c, i) => (
                      <button
                        key={c.minutes}
                        className={control === i ? 'chosen' : ''}
                        onClick={() => setControl(i)}
                      >
                        <strong>
                          {c.minutes} <span>+</span> {c.increment}
                        </strong>
                        <small>{c.minutes < 10 ? 'Blitz' : 'Rapid'}</small>
                      </button>
                    ))}
                  </div>
                  <div className="side-controls">
                    <span>Play as</span>
                    <div role="group" aria-label="Your pieces">
                      <button
                        className={color === 'w' ? 'chosen' : ''}
                        aria-label="White"
                        aria-pressed={color === 'w'}
                        title="White"
                        onClick={() => setColor('w')}
                      >
                        <Piece type="k" color="w" />
                      </button>
                      <button
                        className={color === 'random' ? 'chosen' : ''}
                        aria-label="Random side"
                        aria-pressed={color === 'random'}
                        title="Random"
                        onClick={() => setColor('random')}
                      >
                        <Shuffle size={19} />
                      </button>
                      <button
                        className={color === 'b' ? 'chosen' : ''}
                        aria-label="Black"
                        aria-pressed={color === 'b'}
                        title="Black"
                        onClick={() => setColor('b')}
                      >
                        <Piece type="k" color="b" />
                      </button>
                    </div>
                  </div>
                  <button
                    className="primary"
                    disabled={busy || !ready}
                    onClick={() => create(true)}
                  >
                    {busy ? (
                      <LoaderCircle className="spin" size={18} />
                    ) : (
                      <Swords size={18} />
                    )}
                    Play online
                    <ArrowRight size={17} />
                  </button>
                  <button
                    className="secondary"
                    disabled={busy || !ready}
                    onClick={() => create(false)}
                  >
                    <Link2 size={17} />
                    Invite a friend
                  </button>
                  <button
                    className="text-button practice-button"
                    onClick={startPractice}
                  >
                    Practice with the computer <ArrowRight size={14} />
                  </button>
                </div>
                <div className="lobby">
                  <div className="lobby-heading">
                    <h3>Open games</h3>
                    <span className="count-badge">{lobby.length}</span>
                    <button
                      className="icon-button"
                      title="Join with a code"
                      aria-label="Join with a code"
                      onClick={() => setJoinOpen(true)}
                    >
                      <Plus size={17} />
                    </button>
                  </div>
                  {lobby.length ? (
                    <div className="lobby-list">
                      {lobby.map((g) => (
                        <button
                          key={g.id}
                          onClick={() => join(g.id)}
                          disabled={busy}
                        >
                          <div className="lobby-avatar">
                            <Users size={16} />
                          </div>
                          <div>
                            <strong>{(g.white || g.black)?.name}</strong>
                            <span>
                              {g.minutes} + {g.increment} ·{' '}
                              {g.minutes < 10 ? 'Blitz' : 'Rapid'}
                            </span>
                          </div>
                          <ArrowRight size={17} />
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="empty-lobby">
                      <Users size={24} strokeWidth={1.3} />
                      <p>No open games yet</p>
                    </div>
                  )}
                  <button
                    className="text-button join-code"
                    onClick={() => setJoinOpen(true)}
                  >
                    Have a game code? <ArrowRight size={14} />
                  </button>
                </div>
              </>
            )}
          </aside>
        </div>
      </main>
      {(joinOpen || confirm) && (
        <div
          className="modal-backdrop"
          onClick={() => {
            setJoinOpen(false)
            setConfirm(null)
          }}
        >
          <section
            className="modal"
            ref={dialog}
            role="dialog"
            aria-modal="true"
            aria-label={
              joinOpen
                ? 'Join a game'
                : confirm === 'help'
                  ? 'How to play'
                  : 'Resign game'
            }
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setJoinOpen(false)
                setConfirm(null)
              }
            }}
          >
            <button
              className="modal-close icon-button"
              aria-label="Close dialog"
              onClick={() => {
                setJoinOpen(false)
                setConfirm(null)
              }}
            >
              <X size={19} />
            </button>
            {joinOpen ? (
              <>
                <Link2 className="modal-symbol" size={27} />
                <h2>Join a game</h2>
                {error && (
                  <p role="alert" className="modal-error">
                    {error}
                  </p>
                )}
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    const parsed = code.includes('?game=')
                      ? code.split('?game=')[1]?.split('&')[0]
                      : code.trim().toLowerCase()
                    if (parsed) void join(parsed)
                  }}
                >
                  <label htmlFor="game-code">Game code or invite link</label>
                  <input
                    autoFocus
                    id="game-code"
                    autoComplete="off"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="e.g. h7kn4m2p"
                    required
                  />
                  <button className="primary" disabled={busy || !code.trim()}>
                    Join game <ArrowRight size={17} />
                  </button>
                </form>
              </>
            ) : confirm === 'help' ? (
              <>
                <h2>Make your move.</h2>
                <p>
                  Click a piece, then a highlighted square. Or simply drag it.
                </p>
                <p>
                  Invite a friend with a link or join an open game. No account
                  needed.
                </p>
                <button
                  className="primary"
                  autoFocus
                  onClick={() => setConfirm(null)}
                >
                  Got it
                </button>
              </>
            ) : (
              <>
                <Flag className="modal-symbol" size={26} />
                <h2>Resign this game?</h2>
                <div className="modal-actions">
                  <button
                    className="secondary"
                    autoFocus
                    onClick={() => setConfirm(null)}
                  >
                    Keep playing
                  </button>
                  <button
                    className="primary"
                    onClick={() => {
                      setConfirm(null)
                      if (practice)
                        setPractice(
                          finish(practice, '0-1', 'Resignation', Date.now()),
                        )
                      else void action('resign')
                    }}
                  >
                    Resign
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
