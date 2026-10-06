import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { getAudioCurrentTime } from '../Player'
import { useHeardleClipPlayback } from '../../hooks/useHeardleClipPlayback'
import { getAnalysisTap } from '../../lib/audioEffects'
import {
  clipStart, filterByEra, isCorrectGuess, loadPools, loadSettings as loadHeardleSettings, loadVersionGroups, normalizeTitle,
  pickRandomSong, puzzleNumber, savePracticeRound as saveHeardlePractice, loadPracticeRound as loadHeardlePractice,
  searchPool, settingsForMode as heardleSettingsForMode, stageLadder, todayKey, unlockedSeconds,
  type GameStatus, type Guess, type HeardleSong, type VersionMap,
} from '../../lib/heardle'
import { getCurrentLineIndex, isLrcFormat, parseLrc } from '../../lib/lyrics'
import {
  findEntryByKey, gradeGuess, letterHints, loadPracticeRound as loadWordlePractice, loadRound as loadWordleRound, loadSettings as loadWordleSettings,
  pickDailyEntry, pickRandomEntry, playableEntries, recordResult as recordWordleResult, savePracticeRound as saveWordlePractice,
  saveRound as saveWordleRound, searchOptions, settingsForMode as wordleSettingsForMode, shareText, titleKey,
  type LetterState, type WordleEntry, type WordleGuess,
} from '../../lib/wordle'
import { progressBar } from '../../lib/terminal/player'
import type { TermScreen } from '../../lib/terminal'
import { useTermTheme } from '../../lib/terminal/themeStore'
import { useStore } from '../../store/useStore'
import { errorText } from './ui'

// The full-panel modes behind matrix, visualizer, karaoke, watch, wordle and
// heardle. Each one takes over the terminal body (the header stays) and hands
// control back with onExit(message?); a message is printed in the scrollback.
interface ExitProps { onExit: (message?: string) => void }

const dim = 'text-[color:var(--t-dim)]'

function Frame({ title, hint, children, onKeyDown }: { title: string; hint: string; children: ReactNode; onKeyDown?: (e: React.KeyboardEvent) => void }): JSX.Element {
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => { root.current?.focus() }, [])
  return (
    <div ref={root} tabIndex={0} onKeyDown={onKeyDown} className="flex-1 min-h-0 flex flex-col outline-none bg-[var(--t-bg)] text-[color:var(--t-fg)]">
      <div className="shrink-0 h-6 px-3 flex items-center bg-[var(--t-fg)] text-[color:var(--t-bg)] text-[12px] font-bold">
        <span className="truncate">{title}</span>
      </div>
      <div className="chat-scroll flex-1 min-h-0 overflow-auto px-4 py-3 text-[13px] leading-[1.45]">{children}</div>
      <div className={`shrink-0 px-3 py-1 text-[12px] ${dim}`}>{hint}</div>
    </div>
  )
}

// Any key (but a bare modifier) or a click leaves - used by the screensavers.
function useAnyKeyExit(onExit: () => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return
      e.preventDefault()
      onExit()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onExit])
}

// ─── matrix ───────────────────────────────────────────────────────────────────

const RAIN = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾅﾆﾇﾈﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾗﾘﾜ0123456789999'

function MatrixScreen({ onExit }: ExitProps): JSX.Element {
  const theme = useTermTheme()
  const canvas = useRef<HTMLCanvasElement>(null)
  useAnyKeyExit(() => onExit())
  useEffect(() => {
    const el = canvas.current
    const ctx = el?.getContext('2d')
    if (!el || !ctx) return
    const size = 15
    let drops: number[] = []
    const fit = (): void => {
      const dpr = window.devicePixelRatio || 1
      el.width = el.clientWidth * dpr
      el.height = el.clientHeight * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.fillStyle = theme.bg
      ctx.fillRect(0, 0, el.clientWidth, el.clientHeight)
      drops = Array.from({ length: Math.ceil(el.clientWidth / size) }, () => -Math.floor(Math.random() * 40))
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(el)
    const timer = window.setInterval(() => {
      ctx.globalAlpha = 0.1
      ctx.fillStyle = theme.bg
      ctx.fillRect(0, 0, el.clientWidth, el.clientHeight)
      ctx.globalAlpha = 1
      ctx.font = `${size}px monospace`
      drops.forEach((y, i) => {
        const ch = RAIN[Math.floor(Math.random() * RAIN.length)]
        // The head of each trail is white-hot; the rest is the theme's accent.
        ctx.fillStyle = '#e8ffe8'
        ctx.fillText(ch, i * size, y * size)
        ctx.fillStyle = theme.accent
        if (y > 0) ctx.fillText(RAIN[Math.floor(Math.random() * RAIN.length)], i * size, (y - 1) * size)
        drops[i] = y * size > el.clientHeight && Math.random() > 0.975 ? 0 : y + 1
      })
    }, 45)
    return () => { window.clearInterval(timer); observer.disconnect() }
  }, [theme])
  return (
    <div className="flex-1 min-h-0 relative bg-[var(--t-bg)]" onClick={() => onExit()}>
      <canvas ref={canvas} className="absolute inset-0 w-full h-full" />
      <div className={`absolute bottom-1 left-3 text-[12px] ${dim}`}>press any key</div>
    </div>
  )
}

// ─── visualizer ───────────────────────────────────────────────────────────────

const ROWS = 14

function VisualizerScreen({ onExit }: ExitProps): JSX.Element {
  const out = useRef<HTMLPreElement>(null)
  const title = useStore((s) => s.currentTrack?.title)
  const [available, setAvailable] = useState(true)
  useAnyKeyExit(() => onExit())

  useEffect(() => {
    const tap = getAnalysisTap()
    if (!tap) { setAvailable(false); return }
    const analyser = tap.ctx.createAnalyser()
    analyser.fftSize = 256
    analyser.smoothingTimeConstant = 0.78
    tap.node.connect(analyser)
    const bins = new Uint8Array(analyser.frequencyBinCount)
    let raf = 0
    const draw = (): void => {
      raf = requestAnimationFrame(draw)
      const el = out.current
      if (!el) return
      analyser.getByteFrequencyData(bins)
      // Bars as wide as the screen allows (3 chars a bar), spread over the
      // lower three quarters of the spectrum where the music is.
      const cols = Math.max(8, Math.min(40, Math.floor(el.parentElement!.clientWidth / 8 / 3)))
      const usable = Math.floor(bins.length * 0.75)
      const levels = Array.from({ length: cols }, (_, c) => {
        const from = Math.floor(Math.pow(c / cols, 1.6) * usable)
        const to = Math.max(from + 1, Math.floor(Math.pow((c + 1) / cols, 1.6) * usable))
        let peak = 0
        for (let i = from; i < to; i++) peak = Math.max(peak, bins[i])
        return Math.round((peak / 255) * ROWS)
      })
      const lines: string[] = []
      for (let r = ROWS; r >= 1; r--) lines.push(levels.map((l) => (l >= r ? '██ ' : '   ')).join(''))
      lines.push(levels.map(() => '▀▀ ').join(''))
      el.textContent = lines.join('\n')
    }
    draw()
    return () => {
      cancelAnimationFrame(raf)
      try { tap.node.disconnect(analyser) } catch { /* already gone */ }
    }
  }, [])

  return (
    <Frame title={`visualizer${title ? ` · ${title}` : ''}`} hint="press any key to leave">
      {available
        ? <pre ref={out} className="text-[color:var(--t-accent)] leading-[1.15]" />
        : (
          <p className={dim}>
            {'The audio graph isn’t running, so there is nothing to tap yet.\nTurn on any equalizer preset or sound effect (try: eq on), play something, and run visualizer again.'}
          </p>
        )}
    </Frame>
  )
}

// ─── karaoke ──────────────────────────────────────────────────────────────────

function KaraokeScreen({ onExit }: ExitProps): JSX.Element {
  const full = useStore((s) => s.currentTrackFull)
  const track = useStore((s) => s.currentTrack)
  const raw = full?.syncedLyrics || full?.lyrics || null
  const lines = useMemo(() => (raw && isLrcFormat(raw) ? parseLrc(raw) : null), [raw])
  const [now, setNow] = useState(0)
  const active = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const timer = window.setInterval(() => setNow(getAudioCurrentTime()), 120)
    return () => window.clearInterval(timer)
  }, [])
  const index = lines ? getCurrentLineIndex(lines, now) : -1
  useEffect(() => { active.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }) }, [index])

  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'q' || e.key === 'Escape' || (e.ctrlKey && e.key.toLowerCase() === 'c')) { e.preventDefault(); onExit() }
    else if (e.key === ' ') { e.preventDefault(); const s = useStore.getState(); s.setIsPlaying(!s.isPlaying) }
  }

  return (
    <Frame title={`karaoke · ${track?.title ?? 'nothing playing'}`} hint="q leaves · space pauses" onKeyDown={onKey}>
      {!raw && <p className={dim}>{full?.lyricsPending ? 'looking for lyrics…' : 'no lyrics for this song'}</p>}
      {lines && lines.map((l, i) => (
        <div
          key={i}
          ref={i === index ? active : undefined}
          className={`py-0.5 whitespace-pre-wrap ${i === index ? 'font-bold text-[color:var(--t-accent)]' : dim}`}
        >{i === index ? '▶ ' : '  '}{l.text || ' '}</div>
      ))}
      {raw && !lines && <p className="whitespace-pre-wrap">{raw}</p>}
    </Frame>
  )
}

// ─── watch ────────────────────────────────────────────────────────────────────

function WatchScreen({ command, seconds, run, onExit }: ExitProps & { command: string; seconds: number; run: (line: string) => Promise<string> }): JSX.Element {
  const [output, setOutput] = useState('')
  const [at, setAt] = useState<Date | null>(null)
  const busy = useRef(false)

  useEffect(() => {
    let live = true
    const tick = async (): Promise<void> => {
      if (busy.current) return
      busy.current = true
      try {
        const text = await run(command)
        if (live) { setOutput(text); setAt(new Date()) }
      } catch (err) {
        if (live) { setOutput(errorText(err, 'Command failed')); setAt(new Date()) }
      } finally { busy.current = false }
    }
    void tick()
    const timer = window.setInterval(() => void tick(), seconds * 1000)
    return () => { live = false; window.clearInterval(timer) }
  }, [command, seconds, run])

  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'q' || e.key === 'Escape' || (e.ctrlKey && e.key.toLowerCase() === 'c')) { e.preventDefault(); onExit() }
  }
  return (
    <Frame title={`Every ${seconds}s: ${command}${at ? `   ${at.toLocaleTimeString()}` : ''}`} hint="q leaves" onKeyDown={onKey}>
      <pre className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{output || '…'}</pre>
    </Frame>
  )
}

// ─── wordle ───────────────────────────────────────────────────────────────────

const TILE: Record<LetterState, string> = { correct: '#538d4e', present: '#b59f3b', absent: '#3a3a3c' }

function Tiles({ text, states }: { text: string; states?: LetterState[] }): JSX.Element {
  return (
    <span className="inline-flex flex-wrap gap-1 align-middle">
      {text.split('').map((ch, i) => (
        <span
          key={i}
          className="w-[1.35rem] h-[1.6rem] inline-flex items-center justify-center font-bold rounded-sm border border-[color:var(--t-border)]"
          style={states ? { background: TILE[states[i]], color: '#fff', borderColor: 'transparent' } : undefined}
        >{ch}</span>
      ))}
    </span>
  )
}

function WordleScreen({ unlimited, onExit }: ExitProps & { unlimited: boolean }): JSX.Element {
  const day = useMemo(() => todayKey(), [])
  const settings = useMemo(() => wordleSettingsForMode(loadWordleSettings(), unlimited ? 'unlimited' : 'daily'), [unlimited])
  const [entries, setEntries] = useState<WordleEntry[] | null>(null)
  const [answer, setAnswer] = useState<WordleEntry | null>(null)
  const [guesses, setGuesses] = useState<WordleGuess[]>([])
  const [status, setStatus] = useState<GameStatus>('playing')
  const [input, setInput] = useState('')
  const [note, setNote] = useState('')
  const [failure, setFailure] = useState('')
  const field = useRef<HTMLInputElement>(null)

  const persist = (a: WordleEntry, g: WordleGuess[], s: GameStatus): void => {
    const round = { day, answerId: a.song.id, guesses: g, status: s }
    if (unlimited) saveWordlePractice(round)
    else saveWordleRound(round)
  }

  const deal = (all: WordleEntry[]): void => {
    const next = pickRandomEntry(all)
    if (!next) { setFailure('not enough songs to make a puzzle'); return }
    setAnswer(next); setGuesses([]); setStatus('playing'); setNote('')
    persist(next, [], 'playing')
  }

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const pool = filterByEra(await loadPools(settings.categories), settings.eras)
        const all = playableEntries(pool)
        if (!live) return
        setEntries(all)
        if (unlimited) {
          const saved = loadWordlePractice()
          const held = saved ? all.find((e) => e.song.id === saved.answerId) : undefined
          if (saved && held) { setAnswer(held); setGuesses(saved.guesses); setStatus(saved.status) } else deal(all)
        } else {
          const today = pickDailyEntry(all, day)
          if (!today) { setFailure('not enough songs to make a puzzle'); return }
          setAnswer(today)
          const saved = loadWordleRound(day, today.song.id)
          if (saved) { setGuesses(saved.guesses); setStatus(saved.status) }
        }
      } catch (err) { if (live) setFailure(errorText(err, 'Couldn’t load the song list')) }
    })()
    return () => { live = false }
    // deal() reads state set above, but only runs once, from here.
  }, [])
  useEffect(() => { field.current?.focus() }, [answer, status])

  const tries = settings.tries
  const rows = answer ? guesses.map((g) => ({ g, states: gradeGuess(g.key, answer.key) })) : []
  const hints = letterHints(rows.map((r) => ({ key: r.g.key, states: r.states })))
  const length = answer?.key.length ?? 0

  const finishMessage = (a: WordleEntry, g: WordleGuess[], s: GameStatus): string | undefined => {
    if (s === 'playing') return undefined
    const grid = shareText(day, g.map((x) => gradeGuess(x.key, a.key)), s, tries, puzzleNumber(day))
    return `${s === 'won' ? 'solved' : 'the answer was'}: ${a.song.name}\n${grid}`
  }

  const submit = (): void => {
    if (!answer || !entries || status !== 'playing') return
    const key = titleKey(input)
    if (!key) return
    if (key.length !== length) { setNote(`the title has ${length} letters (yours has ${key.length})`); return }
    const hit = findEntryByKey(entries, key)
      ?? (() => { const s = searchOptions(entries, length, input, 1)[0]; return s ? entries.find((e) => e.song.id === s.id) ?? null : null })()
    if (!hit) { setNote(`no song title spells that in ${length} letters`); return }
    if (guesses.some((g) => g.songId === hit.song.id)) { setNote('already guessed'); return }
    const nextGuesses = [...guesses, { songId: hit.song.id, label: hit.song.name, key: hit.key, era: hit.song.era }]
    const nextStatus: GameStatus = hit.key === answer.key ? 'won' : nextGuesses.length >= tries ? 'lost' : 'playing'
    setGuesses(nextGuesses); setStatus(nextStatus); setInput(''); setNote('')
    persist(answer, nextGuesses, nextStatus)
    if (nextStatus !== 'playing' && !unlimited) recordWordleResult(day, nextStatus === 'won', nextGuesses.length)
  }

  const leave = (): void => onExit(answer ? finishMessage(answer, guesses, status) : undefined)

  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape' || (e.ctrlKey && e.key.toLowerCase() === 'c')) { e.preventDefault(); leave(); return }
    if (e.key !== 'Enter') return
    e.preventDefault()
    if (status !== 'playing') { if (unlimited && entries) deal(entries); return }
    submit()
  }

  const tracker = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((c) => {
    const s = hints.get(c)
    return <span key={c} className="mr-1" style={s ? { color: s === 'absent' ? 'var(--t-dim)' : TILE[s], fontWeight: 700, opacity: s === 'absent' ? 0.5 : 1 } : undefined}>{c}</span>
  })

  return (
    <Frame
      title={`wordle · ${unlimited ? 'practice' : `daily #${puzzleNumber(day)}`}`}
      hint={status === 'playing' ? 'Enter guesses · type a song title that fits · Esc leaves (progress is saved)' : unlimited ? 'Enter deals a new song · Esc leaves' : 'Esc leaves'}
      onKeyDown={onKey}
    >
      {failure && <p className="text-[color:var(--t-err)]">{failure}</p>}
      {!failure && (!answer || !entries) && <p className={dim}>loading the song list…</p>}
      {answer && (
        <>
          <p className={dim}>{length} letters · guess {Math.min(guesses.length + (status === 'playing' ? 1 : 0), tries)}/{tries}</p>
          <div className="my-2 space-y-1.5">
            {rows.map(({ g, states }, i) => (
              <div key={i}>
                <Tiles text={g.key} states={states} />
                <span className={`ml-2 ${dim}`}>{g.label}{settings.eraHint && g.era && g.era === answer.song.era && g.key !== answer.key ? '  · same era' : ''}</span>
              </div>
            ))}
            {status === 'playing' && guesses.length < tries && (
              <div><Tiles text={titleKey(input).slice(0, length).padEnd(length, ' ')} /></div>
            )}
            {Array.from({ length: Math.max(0, tries - guesses.length - (status === 'playing' ? 1 : 0)) }, (_, i) => (
              <div key={`e${i}`}><Tiles text={' '.repeat(length)} /></div>
            ))}
          </div>
          <p className="break-words">{tracker}</p>
          {status === 'playing' ? (
            <div className="mt-3">
              <div className="flex items-center gap-2">
                <span className="text-[color:var(--t-user)]">guess&gt;</span>
                <input
                  ref={field}
                  value={input}
                  onChange={(e) => { setInput(e.target.value); setNote('') }}
                  maxLength={80}
                  spellCheck={false}
                  autoComplete="off"
                  aria-label="Wordle guess"
                  className="flex-1 min-w-0 bg-transparent outline-none border-0 text-[color:var(--t-fg)]"
                  style={{ fontFamily: 'inherit' }}
                />
              </div>
              {note && <p className="text-[color:var(--t-err)] mt-1">{note}</p>}
            </div>
          ) : (
            <div className="mt-3">
              <p className={status === 'won' ? 'text-[color:var(--t-ok)]' : 'text-[color:var(--t-err)]'}>
                {status === 'won' ? `Solved in ${guesses.length}/${tries}` : 'Out of tries'}: {answer.song.name}
              </p>
              <input ref={field} readOnly aria-label="Wordle" className="opacity-0 w-0 h-0 absolute" />
            </div>
          )}
        </>
      )}
    </Frame>
  )
}

// ─── heardle ──────────────────────────────────────────────────────────────────

function HeardleScreen({ onExit }: ExitProps): JSX.Element {
  const settings = useMemo(() => heardleSettingsForMode(loadHeardleSettings(), 'unlimited'), [])
  const ladder = useMemo(() => stageLadder(settings), [settings])
  const isPlaying = useStore((s) => s.isPlaying)
  const setIsPlaying = useStore((s) => s.setIsPlaying)
  const volume = useStore((s) => s.volume)
  const [pool, setPool] = useState<HeardleSong[] | null>(null)
  const [versions, setVersions] = useState<VersionMap | undefined>(undefined)
  const [answer, setAnswer] = useState<HeardleSong | null>(null)
  const [guesses, setGuesses] = useState<Guess[]>([])
  const [status, setStatus] = useState<GameStatus>('playing')
  const [startAt, setStartAt] = useState(0)
  const [input, setInput] = useState('')
  const [pick, setPick] = useState(0)
  const [failure, setFailure] = useState('')
  const field = useRef<HTMLInputElement>(null)

  const finished = status !== 'playing'
  const unlocked = unlockedSeconds(guesses.length, finished, ladder)
  const { audioRef, playing, preparing, elapsed, audioError, stopPlayback, startPlayback, enforceLimit } = useHeardleClipPlayback({
    unlocked, startAt, answer, useServerRound: false, serverClipUrl: null, isPlaying, setIsPlaying, volume,
  })

  const save = (a: HeardleSong, g: Guess[], s: GameStatus, at: number): void => saveHeardlePractice({ answerId: a.id, guesses: g, status: s, startAt: at })

  const deal = (all: HeardleSong[]): void => {
    const next = pickRandomSong(all)
    if (!next) { setFailure('no songs to draw from (check the Heardle settings)'); return }
    const at = clipStart(next, ladder[ladder.length - 1], settings.startPoint, null)
    setAnswer(next); setGuesses([]); setStatus('playing'); setStartAt(at); setInput('')
    save(next, [], 'playing', at)
  }

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const all = filterByEra(await loadPools(settings.categories), settings.eras)
        if (!live) return
        setPool(all)
        void loadVersionGroups(all).then((v) => { if (live) setVersions(v) }).catch(() => undefined)
        const saved = loadHeardlePractice()
        const held = saved ? all.find((s) => s.id === saved.answerId) : undefined
        if (saved && held) { setAnswer(held); setGuesses(saved.guesses); setStatus(saved.status); setStartAt(saved.startAt) } else deal(all)
      } catch (err) { if (live) setFailure(errorText(err, 'Couldn’t load the song list')) }
    })()
    return () => { live = false }
    // deal() is only called from here, once.
  }, [])
  useEffect(() => { field.current?.focus() }, [answer, status])

  const suggestions = useMemo(() => (pool && input.trim() ? searchPool(pool, input, 5) : []), [pool, input])

  const record = (guess: Guess, correct: boolean): void => {
    if (!answer) return
    const next = [...guesses, guess]
    const nextStatus: GameStatus = correct ? 'won' : next.length >= ladder.length ? 'lost' : 'playing'
    setGuesses(next); setStatus(nextStatus); setInput(''); setPick(0)
    if (nextStatus !== 'playing') stopPlayback()
    save(answer, next, nextStatus, startAt)
  }

  const submit = (): void => {
    if (!answer || status !== 'playing') return
    if (!input.trim()) { record({ songId: null, label: 'skipped', era: null, sameEra: false }, false); return }
    const song = suggestions[Math.min(pick, suggestions.length - 1)]
    if (!song) return
    const correct = isCorrectGuess(song, answer, versions)
    record({
      songId: song.id, label: song.name, era: song.era,
      sameEra: settings.eraHint && !correct && !!song.era && song.era === answer.era,
      viaVersion: correct && song.id !== answer.id,
    }, correct)
  }

  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape' || (e.ctrlKey && e.key.toLowerCase() === 'c')) {
      e.preventDefault(); stopPlayback()
      onExit(answer && finished ? `${status === 'won' ? 'got it' : 'the answer was'}: ${answer.name}` : undefined)
      return
    }
    if (e.key === 'Tab') { e.preventDefault(); if (playing || preparing) stopPlayback(); else startPlayback(); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setPick((p) => Math.min(suggestions.length - 1, p + 1)); return }
    if (e.key === 'ArrowUp') { e.preventDefault(); setPick((p) => Math.max(0, p - 1)); return }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (finished) { if (pool) deal(pool); return }
      submit()
    }
  }

  const segments = ladder.map((s, i) => (s <= unlocked ? '▮' : '▯') + (i < ladder.length - 1 ? ' ' : '')).join('')

  return (
    <Frame title="heardle · practice" hint="Tab plays the clip · Enter guesses (empty = skip) · ↑↓ pick a suggestion · Esc leaves" onKeyDown={onKey}>
      <audio ref={audioRef} preload="auto" crossOrigin="anonymous" onTimeUpdate={enforceLimit} />
      {failure && <p className="text-[color:var(--t-err)]">{failure}</p>}
      {!failure && (!answer || !pool) && <p className={dim}>loading the song list…</p>}
      {answer && (
        <>
          <p>{segments}   <span className={dim}>{unlocked}s unlocked · try {Math.min(guesses.length + 1, ladder.length)}/{ladder.length}</span></p>
          <p className="my-1">
            {progressBar(elapsed, unlocked)} <span className={dim}>{playing ? 'playing' : preparing ? 'loading…' : 'Tab to play'}</span>
          </p>
          {audioError && <p className="text-[color:var(--t-err)]">couldn’t play the clip (press Tab to retry)</p>}
          <div className="my-2">
            {guesses.map((g, i) => (
              <p key={i} className={g.songId === null ? dim : 'text-[color:var(--t-fg)]'}>
                {g.songId === null ? '⏭' : status === 'won' && i === guesses.length - 1 ? '✓' : '✗'} {g.label}{g.sameEra ? '  · same era' : ''}{g.viaVersion ? '  · another version of it' : ''}
              </p>
            ))}
          </div>
          {finished ? (
            <div className="mt-2">
              <p className={status === 'won' ? 'text-[color:var(--t-ok)]' : 'text-[color:var(--t-err)]'}>
                {status === 'won' ? `Got it in ${guesses.length}` : 'Out of tries'}: {answer.name}{answer.era ? `  (${answer.era})` : ''}
              </p>
              <p className={dim}>Enter for another song</p>
              <input ref={field} readOnly aria-label="Heardle" className="opacity-0 w-0 h-0 absolute" />
            </div>
          ) : (
            <div className="mt-2">
              <div className="flex items-center gap-2">
                <span className="text-[color:var(--t-user)]">guess&gt;</span>
                <input
                  ref={field}
                  value={input}
                  onChange={(e) => { setInput(e.target.value); setPick(0) }}
                  spellCheck={false}
                  autoComplete="off"
                  aria-label="Heardle guess"
                  className="flex-1 min-w-0 bg-transparent outline-none border-0 text-[color:var(--t-fg)]"
                  style={{ fontFamily: 'inherit' }}
                />
              </div>
              {suggestions.map((s, i) => (
                <p key={s.id} className={i === pick ? 'text-[color:var(--t-accent)]' : dim}>{i === pick ? '› ' : '  '}{s.name}{s.era ? `  (${s.era})` : ''}{normalizeTitle(s.name).includes(normalizeTitle(input)) ? '' : '  · alias'}</p>
              ))}
            </div>
          )}
        </>
      )}
    </Frame>
  )
}

// ─── the switch ───────────────────────────────────────────────────────────────

export default function TerminalScreen({ screen, run, onExit }: ExitProps & { screen: TermScreen; run: (line: string) => Promise<string> }): JSX.Element {
  switch (screen.kind) {
    case 'matrix': return <MatrixScreen onExit={onExit} />
    case 'visualizer': return <VisualizerScreen onExit={onExit} />
    case 'karaoke': return <KaraokeScreen onExit={onExit} />
    case 'watch': return <WatchScreen command={screen.command} seconds={screen.seconds} run={run} onExit={onExit} />
    case 'wordle': return <WordleScreen unlimited={screen.unlimited} onExit={onExit} />
    case 'heardle': return <HeardleScreen onExit={onExit} />
  }
}
