import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Loader2, Music2, Pause, Play, Search, SkipForward, Swords, Trophy, Volume2, X } from 'lucide-react'
import { useStorePick } from '../store/useStore'
import { smallCoverUrl, CATEGORY_LABELS } from '../lib/juicewrldApi'
import {
  connectMatchSocket,
  pollMatchQueue,
  leaveMatchQueueRest,
  isMatchSocketOpen,
  sendMatchGuess,
  sendQueueJoin,
  sendQueueLeave,
  sendLeaveMatch,
  ackMatchSocket,
  puzzleFromMatchRound,
  type MatchPhase,
  type OpponentProgress,
  type MatchEndPayload,
} from '../lib/heardleMatchApi'
import type { PuzzleResponse } from '../lib/heardleApi'
import type { Guess, GameStatus, HeardleSong } from '../lib/heardle'
import { loadPools, searchPool, unlockedSeconds, revealCoverUrl } from '../lib/heardle'

interface Props {
  embedded?: boolean
  onClose: () => void
}

interface EndSummary {
  headline: string
  subtext: string
  outcome: 'win' | 'lose' | 'draw'
  myGuessCount: number
  opponentGuessCount: number
}

function buildEndSummary(payload: MatchEndPayload, accountId: number): EndSummary {
  const my = payload.my_guess_count ?? 0
  const opp = payload.opponent_guess_count ?? 0
  const tries = (n: number): string => `${n} ${n === 1 ? 'try' : 'tries'}`
  if (payload.reason === 'forfeit') {
    if (payload.user_id === accountId) {
      return { headline: 'You lose', subtext: 'You left the match', outcome: 'lose', myGuessCount: my, opponentGuessCount: opp }
    }
    return { headline: 'You win!', subtext: 'Opponent left the match', outcome: 'win', myGuessCount: my, opponentGuessCount: opp }
  }
  if (payload.drawn) {
    if (my > 0 && opp > 0 && my === opp) {
      return { headline: 'Draw', subtext: `Both got it in ${tries(my)}`, outcome: 'draw', myGuessCount: my, opponentGuessCount: opp }
    }
    if (my > 0 && opp > 0) {
      return { headline: 'Draw', subtext: `${tries(my)} vs ${tries(opp)}`, outcome: 'draw', myGuessCount: my, opponentGuessCount: opp }
    }
    return { headline: 'Draw', subtext: 'Neither player got it', outcome: 'draw', myGuessCount: my, opponentGuessCount: opp }
  }
  if (payload.winner_id === accountId) {
    return { headline: 'You win!', subtext: `${tries(my)} vs opponent's ${opp}`, outcome: 'win', myGuessCount: my, opponentGuessCount: opp }
  }
  return { headline: 'You lose', subtext: `${tries(my)} vs opponent's ${opp}`, outcome: 'lose', myGuessCount: my, opponentGuessCount: opp }
}

function secLabel(n: number): string {
  return `${Number.isInteger(n) ? n : n.toFixed(1)}S`
}

function SlotRow({ ladder, guesses, status }: { ladder: number[]; guesses: Guess[]; status: GameStatus }) {
  return (
    <div className="flex gap-1.5 sm:gap-2">
      {ladder.map((secs, i) => {
        const guess = guesses[i]
        const won = status === 'won' && i === guesses.length - 1
        const active = !guess && i === guesses.length && status === 'playing'
        const tone = won ? 'border-accent bg-accent/20'
          : !guess ? (active
            ? 'border-accent bg-accent/10 shadow-[0_0_18px_-6px_var(--accent)]'
            : 'border-[var(--border)] bg-[var(--surface-overlay)]/30')
            : guess.songId === null ? 'border-[var(--border)] bg-[var(--surface-overlay)]/60'
              : 'border-red-500/40 bg-red-500/10'
        return (
          <div
            key={i}
            title={guess ? (guess.songId === null ? 'Skipped' : guess.label) : `${secLabel(secs)} unlocked`}
            className={`flex-1 h-11 sm:h-12 rounded-xl border transition-all duration-200 ${tone}`}
          />
        )
      })}
    </div>
  )
}

function GuessRow({ guess, correct }: { guess: Guess; correct: boolean }) {
  const skipped = guess.songId === null
  return (
    <div
      className={`h-10 rounded-lg border flex items-center gap-2 px-3 ${
        correct
          ? 'border-accent/50 bg-accent/15 text-text-primary'
          : skipped
            ? 'border-[var(--border)] bg-[var(--surface-raised)]/40 text-text-muted'
            : 'border-[var(--border)] bg-[var(--surface-raised)] text-text-primary'
      }`}
    >
      {correct
        ? <Check size={14} className="shrink-0 text-accent" />
        : skipped
          ? <SkipForward size={14} className="shrink-0" />
          : <X size={14} className="shrink-0 text-red-400" />}
      <span className="text-sm truncate">{skipped ? 'Skipped' : guess.label}</span>
    </div>
  )
}

export default function HeardleVersusPanel({ embedded, onClose }: Props): JSX.Element {
  const { account, volume, setVolume, isPlaying, setIsPlaying } = useStorePick('account', 'volume', 'setVolume', 'isPlaying', 'setIsPlaying')
  const [phase, setPhase] = useState<MatchPhase>('idle')
  const [matchId, setMatchId] = useState<string | null>(null)
  const [guesses, setGuesses] = useState<Guess[]>([])
  const [status, setStatus] = useState<GameStatus>('playing')
  const [ladder, setLadder] = useState<number[]>([1, 2, 4, 7, 11, 16])
  const [clipUrl, setClipUrl] = useState<string | null>(null)
  const [clipStart, setClipStart] = useState(0)
  const [reveal, setReveal] = useState<HeardleSong | null>(null)
  const [pool, setPool] = useState<HeardleSong[]>([])
  const [poolLoading, setPoolLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [audioError, setAudioError] = useState(false)
  const [opponent, setOpponent] = useState<OpponentProgress | null>(null)
  const [endSummary, setEndSummary] = useState<EndSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [queueHint, setQueueHint] = useState<string | null>(null)
  const [connected, setConnected] = useState(true)

  const audioRef = useRef<HTMLAudioElement>(null)
  const rafRef = useRef<number | null>(null)
  const playTokenRef = useRef(0)
  const limitRef = useRef(1)
  const startRef = useRef(0)
  const matchIdRef = useRef<string | null>(null)
  const phaseRef = useRef<MatchPhase>('idle')
  const callbacksRef = useRef({
    applyRound: (_round: PuzzleResponse) => {},
    handleMatched: (_id: string, _round?: PuzzleResponse) => {},
    onEnd: (_payload: MatchEndPayload) => {},
    stopPlayback: () => {},
    accountId: 0,
  })

  const finished = status !== 'playing'
  const unlocked = unlockedSeconds(guesses.length, finished, ladder)
  const fullWindow = ladder[ladder.length - 1] ?? 16

  const suggestions = useMemo(
    () => (query.trim() ? searchPool(pool, query, 50) : []),
    [pool, query],
  )

  useEffect(() => { setHighlighted(0) }, [query])

  useEffect(() => {
    let cancelled = false
    setPoolLoading(true)
    loadPools(['released', 'unreleased'])
      .then((songs) => { if (!cancelled) { setPool(songs); setPoolLoading(false) } })
      .catch(() => { if (!cancelled) setPoolLoading(false) })
    return () => { cancelled = true }
  }, [])

  const applyRound = useCallback((round: PuzzleResponse) => {
    const parsed = puzzleFromMatchRound(round)
    setGuesses(parsed.guesses)
    setStatus(parsed.status)
    setLadder((prev) => parsed.ladder.length > 0 ? parsed.ladder : prev)
    setClipUrl(parsed.clipUrl)
    setClipStart(parsed.clipStart)
    if (parsed.reveal) setReveal(parsed.reveal)
  }, [])

  const handleMatched = useCallback((id: string, round?: PuzzleResponse) => {
    // Both transports can deliver this, so ignore the second one - but only
    // when it's the *same* match. Dropping it on phase alone stranded the
    // player in a match they'd been placed in from a stale queue entry: the
    // server considered them playing, the UI showed the idle screen, and the
    // match ran down to a forfeit nobody saw.
    if (matchIdRef.current === id && phaseRef.current === 'playing') return
    if (phaseRef.current === 'ended') return
    matchIdRef.current = id
    setMatchId(id)
    setPhase('playing')
    phaseRef.current = 'playing'
    setQueueHint(null)
    setEndSummary(null)
    setOpponent(null)
    setGuesses([])
    setStatus('playing')
    ackMatchSocket(id)
    if (round) applyRound(round)
  }, [applyRound])

  useEffect(() => { matchIdRef.current = matchId }, [matchId])
  useEffect(() => { phaseRef.current = phase }, [phase])

  const stopPlayback = useCallback((): void => {
    playTokenRef.current++
    if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
    const audio = audioRef.current
    if (audio) { audio.pause(); audio.currentTime = startRef.current }
    setPlaying(false)
    setPreparing(false)
    setElapsed(0)
  }, [])

  const tick = useCallback((): void => {
    const audio = audioRef.current
    if (!audio) return
    const played = audio.currentTime - startRef.current
    if (played >= limitRef.current) { stopPlayback(); return }
    setElapsed(played)
    rafRef.current = requestAnimationFrame(tick)
  }, [stopPlayback])

  const startPlayback = useCallback((): void => {
    const audio = audioRef.current
    if (!audio || !clipUrl) return
    if (isPlaying) setIsPlaying(false)
    setAudioError(false)
    setPreparing(true)
    audio.volume = volume
    const token = ++playTokenRef.current
    const live = (): boolean => playTokenRef.current === token && !!audioRef.current
    const begin = (): void => {
      if (!live()) return
      audio.play()
        .then(() => { if (!live()) return; setPlaying(true); setPreparing(false); rafRef.current = requestAnimationFrame(tick) })
        .catch(() => { if (live()) { setPreparing(false); setAudioError(true) } })
    }
    const seekThenPlay = (): void => {
      if (!live()) return
      startRef.current = clipStart
      limitRef.current = unlocked
      if (clipStart <= 0) { begin(); return }
      audio.addEventListener('seeked', begin, { once: true })
      audio.currentTime = clipStart
    }
    if (audio.readyState >= 1) seekThenPlay()
    else audio.addEventListener('loadedmetadata', seekThenPlay, { once: true })
  }, [clipUrl, clipStart, isPlaying, setIsPlaying, tick, unlocked, volume])

  useEffect(() => { limitRef.current = unlocked }, [unlocked])
  useEffect(() => { startRef.current = clipStart }, [clipStart])

  useEffect(() => {
    stopPlayback()
    const audio = audioRef.current
    if (audio && clipUrl) audio.src = clipUrl
    setAudioError(false)
  }, [clipUrl, stopPlayback])

  useEffect(() => () => {
    playTokenRef.current++
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    audioRef.current?.pause()
  }, [])

  useEffect(() => {
    if (!account) return
    callbacksRef.current.accountId = account.id
    callbacksRef.current.applyRound = applyRound
    callbacksRef.current.handleMatched = handleMatched
    callbacksRef.current.stopPlayback = stopPlayback
    callbacksRef.current.onEnd = (payload: MatchEndPayload) => {
      setPhase('ended')
      phaseRef.current = 'ended'
      stopPlayback()
      setEndSummary(buildEndSummary(payload, account.id))
      if (payload.reveal) {
        setReveal({
          id: payload.reveal.id,
          name: payload.reveal.name,
          titles: payload.reveal.titles ?? [payload.reveal.name],
          path: '',
          era: payload.reveal.era ?? null,
          category: payload.reveal.category ?? '',
          // revealCoverUrl reads the runtime object, not MatchEndReveal's
          // declared type - the websocket payload may carry `image_url`
          // (see the comment on revealCoverUrl) even though that field isn't
          // in this interface.
          imageUrl: revealCoverUrl(payload.reveal) ?? '',
          length: payload.reveal.length ?? '',
        })
      }
    }
  })

  useEffect(() => {
    if (!account?.id) return
    const disconnect = connectMatchSocket({
      onQueueWaiting: () => {
        setQueueHint('Waiting for another player. Each device needs a different signed-in account.')
      },
      onQueueError: (msg) => {
        setError(msg)
        setPhase('idle')
        phaseRef.current = 'idle'
      },
      onGuessError: (msg) => setError(msg),
      onMatched: (id, round) => callbacksRef.current.handleMatched(id, round),
      onRound: (round) => callbacksRef.current.applyRound(round),
      onOpponent: (p) => setOpponent(p),
      onEnd: (payload) => callbacksRef.current.onEnd(payload),
      onError: (msg) => setError(msg),
      onDisconnected: () => setConnected(false),
      onReconnected: () => { setConnected(true); setError(null) },
    }, account.id)
    return () => {
      if (phaseRef.current === 'playing') {
        sendLeaveMatch()
      } else if (phaseRef.current === 'queue') {
        sendQueueLeave()
        void leaveMatchQueueRest()
      }
      disconnect()
    }
  }, [account?.id])

  // REST polling is a *fallback*, not a parallel channel. Running it while the
  // socket is open would enqueue the same player twice - once over each
  // transport - so it only fires when the socket can't do the job.
  useEffect(() => {
    if (phase !== 'queue') return
    let cancelled = false
    const poll = (): void => {
      if (isMatchSocketOpen()) return
      pollMatchQueue()
        .then((result) => {
          if (cancelled || result.queued || !result.matchId) return
          callbacksRef.current.handleMatched(result.matchId, result.round)
        })
        .catch(() => {})
    }
    poll()
    const timer = window.setInterval(poll, 2000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [phase])

  const joinQueue = (): void => {
    setError(null)
    setQueueHint(null)
    setPhase('queue')
    phaseRef.current = 'queue'
    sendQueueJoin()
  }

  const leaveQueue = (): void => {
    sendQueueLeave()
    // Also drop any entry the REST fallback created, or cancelling leaves a
    // ghost in the queue that can still be matched.
    void leaveMatchQueueRest()
    setPhase('idle')
    phaseRef.current = 'idle'
  }

  // Both guess paths have to check the send actually left: a closed socket
  // used to swallow it, and clearing the box on the way out made a dropped
  // connection look like the game had simply ignored the answer.
  const skip = (): void => {
    if (status !== 'playing' || !matchId) return
    if (!sendMatchGuess(null, true, matchId)) {
      setConnected(false)
      setError("Connection lost - that skip didn't send. Reconnecting…")
      return
    }
    stopPlayback()
  }

  const submitGuess = (song: HeardleSong): void => {
    if (finished || !matchId) return
    if (!sendMatchGuess(song.id, false, matchId)) {
      setConnected(false)
      setError("Connection lost - that guess didn't send. Reconnecting…")
      return
    }
    stopPlayback()
    setQuery('')
    setDropdownOpen(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted((i) => Math.min(i + 1, suggestions.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlighted((i) => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); const s = suggestions[highlighted]; if (s) submitGuess(s) }
    else if (e.key === 'Escape') { setDropdownOpen(false) }
  }

  const shell = (content: JSX.Element): JSX.Element => {
    if (embedded) return content
    return (
      <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
        <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5" onClick={(e) => e.stopPropagation()}>
          {content}
        </div>
      </div>
    )
  }

  if (!account) {
    return shell(
      <>
        <p className="text-text-primary text-sm">Sign in to play 1v1.</p>
        <button onClick={onClose} className="mt-4 w-full py-2 rounded-lg bg-accent text-white text-sm font-semibold">Close</button>
      </>,
    )
  }

  const header = (
    <div className="flex items-center gap-2 mb-4">
      <Swords size={16} className="text-accent" />
      <h2 className="text-text-primary font-bold">1v1 Heardle</h2>
      {!embedded && (
        <button onClick={onClose} title="Close" className="ml-auto p-1 rounded-lg text-text-muted hover:text-text-primary"><X size={16} /></button>
      )}
    </div>
  )

  if (phase === 'idle') {
    return shell(
      <>
        {header}
        {error && <p className="text-red-400 text-xs mb-3">{error}</p>}
        <p className="text-text-muted text-sm mb-4">Fewest correct guesses wins. Both players finish before the result is decided.</p>
        <button onClick={joinQueue} className="w-full py-2.5 rounded-lg bg-accent text-white text-sm font-semibold">Find opponent</button>
      </>,
    )
  }

  if (phase === 'queue') {
    return shell(
      <>
        {header}
        <div className="text-center space-y-3 py-4">
          <Loader2 size={24} className="mx-auto animate-spin text-accent" />
          <p className="text-text-secondary text-sm">Searching for opponent…</p>
          {queueHint && <p className="text-text-muted text-xs px-2">{queueHint}</p>}
          <button onClick={leaveQueue} className="text-xs text-text-muted hover:text-text-primary">Cancel</button>
        </div>
      </>,
    )
  }

  if (phase === 'ended') {
    const outcome = endSummary?.outcome ?? 'draw'
    const heroTone = outcome === 'win'
      ? 'border-accent/50 bg-accent/10 shadow-[0_0_40px_-12px_var(--accent)]'
      : outcome === 'lose'
        ? 'border-red-500/30 bg-red-500/5'
        : 'border-[var(--border)] bg-[var(--surface-overlay)]/40'
    const headlineTone = outcome === 'win' ? 'text-accent' : outcome === 'lose' ? 'text-red-400' : 'text-text-primary'
    return shell(
      <>
        {header}
        <div className={`rounded-2xl border p-5 space-y-4 ${heroTone}`}>
          <div className="text-center space-y-2">
            {outcome === 'win'
              ? <Trophy size={36} className="mx-auto text-accent drop-shadow-[0_0_12px_var(--accent)]" />
              : outcome === 'lose'
                ? <X size={36} className="mx-auto text-red-400" />
                : <Swords size={36} className="mx-auto text-text-muted" />}
            <p className={`font-bold text-2xl tracking-tight ${headlineTone}`}>{endSummary?.headline ?? 'Match over'}</p>
            {endSummary?.subtext && <p className="text-text-secondary text-sm">{endSummary.subtext}</p>}
          </div>
          {endSummary && (
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)]/80 p-3 text-center">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-text-muted mb-1">You</p>
                <p className="text-text-primary text-xl font-bold">{endSummary.myGuessCount}</p>
                <p className="text-[10px] text-text-muted">{endSummary.myGuessCount === 1 ? 'guess' : 'guesses'}</p>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)]/80 p-3 text-center">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-text-muted mb-1">Opponent</p>
                <p className="text-text-primary text-xl font-bold">{endSummary.opponentGuessCount}</p>
                <p className="text-[10px] text-text-muted">{endSummary.opponentGuessCount === 1 ? 'guess' : 'guesses'}</p>
              </div>
            </div>
          )}
          {reveal && (
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
              <div className="flex gap-4">
                <div className="w-20 h-20 sm:w-24 sm:h-24 shrink-0 rounded-xl border border-[var(--border)] bg-[var(--surface-overlay)] overflow-hidden flex items-center justify-center">
                  {revealCoverUrl(reveal)
                    ? <img src={smallCoverUrl(revealCoverUrl(reveal))} alt="" className="w-full h-full object-cover" />
                    : <Music2 size={28} className="text-text-muted" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className={`text-[10px] font-bold uppercase tracking-[0.2em] mb-1 ${outcome === 'win' ? 'text-accent' : 'text-text-muted'}`}>
                    The song
                  </p>
                  <h2 className="text-text-primary text-lg font-bold leading-snug">{reveal.name}</h2>
                  <p className="text-sm text-text-secondary mt-0.5">
                    {[reveal.era, CATEGORY_LABELS[reveal.category] ?? reveal.category, reveal.length].filter(Boolean).join(' · ')}
                  </p>
                </div>
              </div>
            </div>
          )}
          <div className="flex flex-col gap-2 pt-1">
            <button
              onClick={() => { setEndSummary(null); setReveal(null); setGuesses([]); setStatus('playing'); setOpponent(null); joinQueue() }}
              className="w-full py-2.5 rounded-xl bg-accent text-white text-sm font-semibold hover:opacity-90 transition-opacity"
            >
              Rematch
            </button>
            <button onClick={onClose} className="w-full py-2.5 rounded-xl border border-[var(--border)] text-sm text-text-secondary hover:text-text-primary transition-colors">
              Back
            </button>
          </div>
        </div>
      </>,
    )
  }

  return (
    <>
      <audio ref={audioRef} preload="metadata" onTimeUpdate={() => {
        const audio = audioRef.current
        if (!audio || audio.paused) return
        if (audio.currentTime - startRef.current >= limitRef.current) stopPlayback()
      }} />
      {shell(
        <>
          {header}
          {error && <p className="text-red-400 text-xs mb-3">{error}</p>}
          {!connected && (
            <div className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 flex items-center gap-2">
              <Loader2 size={13} className="animate-spin shrink-0 text-amber-400" />
              <p className="text-xs text-amber-200">
                Reconnecting… guesses won&apos;t send until this clears.
              </p>
            </div>
          )}
          <div className="flex items-center justify-between gap-3 mb-4 text-xs">
            <span className="text-text-muted font-mono">Match {matchId?.slice(0, 8)}</span>
            <span className="text-text-secondary">
              Opponent: {opponent?.guess_count ?? 0} guesses · {opponent?.status ?? 'playing'}
            </span>
          </div>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)]/60 p-4 sm:p-5 space-y-4">
            <SlotRow ladder={ladder} guesses={guesses} status={status} />
            <button
              onClick={() => (playing ? stopPlayback() : startPlayback())}
              disabled={!clipUrl || poolLoading}
              className="w-full h-12 rounded-xl border border-accent/40 bg-accent/10 hover:bg-accent/20 text-text-primary text-sm font-bold uppercase tracking-[0.2em] flex items-center justify-center gap-2 transition-colors disabled:opacity-40"
            >
              {preparing
                ? <><Loader2 size={16} className="animate-spin" /> Loading</>
                : playing
                  ? <><Pause size={16} className="fill-current" /> Stop</>
                  : <><Play size={16} className="fill-current" /> Play ({secLabel(unlocked)})</>}
            </button>
            <div className="flex items-center gap-3">
              <Volume2 size={14} className="text-text-muted shrink-0" />
              <input
                type="range" min={0} max={1} step={0.01}
                value={volume}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  setVolume(v)
                  if (audioRef.current) audioRef.current.volume = v
                }}
                className="flex-1 h-1 accent-[var(--accent)] cursor-pointer"
              />
            </div>
            {audioError && <p className="text-center text-xs text-red-400">Couldn&apos;t stream this clip.</p>}
            {finished && phase === 'playing' && (
              <div className="rounded-xl border border-accent/30 bg-accent/10 px-4 py-3 text-center">
                <p className="text-sm font-semibold text-text-primary">
                  {status === 'won' ? 'Correct - waiting for opponent…' : 'Out of guesses - waiting for opponent…'}
                </p>
                <p className="text-xs text-text-muted mt-1">Result is decided once both players finish</p>
              </div>
            )}
            {!finished && (
              <>
                <div className="relative">
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
                  <input
                    value={query}
                    onChange={(e) => { setQuery(e.target.value); setDropdownOpen(true) }}
                    onFocus={() => setDropdownOpen(true)}
                    onKeyDown={handleKeyDown}
                    placeholder="guess the track…"
                    className="w-full h-12 pl-9 pr-3 rounded-xl bg-[var(--surface-overlay)]/50 border border-[var(--border)] text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50"
                  />
                  {dropdownOpen && suggestions.length > 0 && (
                    <div className="absolute bottom-full mb-1 left-0 right-0 max-h-64 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] shadow-xl z-20">
                      {suggestions.map((s, i) => (
                        <button
                          key={s.id}
                          onMouseEnter={() => setHighlighted(i)}
                          onClick={() => submitGuess(s)}
                          className={`w-full text-left px-3 py-2 flex items-center gap-2 transition-colors ${
                            i === highlighted ? 'bg-accent/15' : 'hover:bg-surface-overlay'
                          }`}
                        >
                          <span className="block text-sm text-text-primary truncate">{s.name}</span>
                          {s.era && <span className="ml-auto shrink-0 text-[10px] text-text-muted uppercase tracking-wider">{s.era}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2 sm:gap-3">
                  <button
                    onClick={skip}
                    className="h-12 rounded-xl border border-[var(--border)] hover:border-accent/40 text-text-secondary hover:text-text-primary text-xs font-bold uppercase tracking-[0.18em] transition-colors"
                  >
                    Skip
                  </button>
                  <button
                    onClick={() => { const s = suggestions[highlighted]; if (s) submitGuess(s) }}
                    disabled={suggestions.length === 0}
                    className="h-12 rounded-xl border border-accent/40 bg-accent/10 hover:bg-accent/20 text-text-primary text-xs font-bold uppercase tracking-[0.18em] transition-colors disabled:opacity-40"
                  >
                    Submit
                  </button>
                </div>
              </>
            )}
          </div>
          {guesses.length > 0 && (
            <div className="space-y-1.5 mt-4">
              {guesses.map((guess, i) => (
                <GuessRow
                  key={i}
                  guess={guess}
                  correct={status === 'won' && i === guesses.length - 1}
                />
              ))}
            </div>
          )}
          {!finished && (
            <p className="text-center text-[10px] font-mono tracking-wider text-text-muted mt-4">
              {ladder.length - guesses.length} {ladder.length - guesses.length === 1 ? 'guess' : 'guesses'} left
            </p>
          )}
        </>,
      )}
    </>
  )
}
