import {
  clipStart, filterByEra, isCorrectGuess, loadPools, loadPracticeRound as loadHeardlePractice, loadSettings as loadHeardleSettings,
  loadVersionGroups, normalizeTitle, pickRandomSong, puzzleNumber, savePracticeRound as saveHeardlePractice, searchPool,
  settingsForMode as heardleSettingsForMode, stageLadder, todayKey, unlockedSeconds,
  type GameStatus, type Guess, type HeardleSong, type VersionMap,
} from 'site:heardle'
import {
  findEntryByKey, gradeGuess, letterHints, loadPracticeRound, loadRound, loadSettings, pickDailyEntry, pickRandomEntry,
  playableEntries, recordResult, savePracticeRound, saveRound, searchOptions, settingsForMode, shareText, titleKey,
  type LetterState, type WordleEntry, type WordleGuess,
} from 'site:wordle'
import { streamUrl } from './api'
import { fail, type Command } from './command'
import { findMpv, Mpv, MPV_MISSING, type MpvEvent } from './mpv'
import { color } from './out'
import { canOpenScreen, openScreen, visibleLength, type Key, type Screen, type ScreenBody } from './screen'
import type { Shell } from './shell'

// The site terminal's Wordle and Heardle screens (components/chat/
// TerminalScreens.tsx), drawn as text. The game logic is the site's own
// (lib/wordle.ts, lib/heardle.ts compiled in), so the daily Wordle is the same
// puzzle; progress, streaks and settings live in ~/.unreleased/storage.json
// (the CLI's stand-in for the browser's localStorage).

const errText = (err: unknown): string => (err as Error)?.message || String(err)

/** A printable keystroke to add to an input line, or null. */
function typed(str: string | undefined, key: Key): string | null {
  if (!str || key.ctrl || key.meta || str.length !== 1) return null
  return str >= ' ' && str !== '\x7f' ? str : null
}

const isLeave = (key: Key): boolean => key.name === 'escape' || (!!key.ctrl && key.name === 'c')

/** A header line: title on the left, a dim hint on the right. */
function header(s: Screen, title: string, hint: string): string {
  const gap = Math.max(2, s.cols - visibleLength(title) - hint.length)
  return `${color.bold(title)}${' '.repeat(gap)}${color.dim(hint)}`
}

// ─── wordle ──────────────────────────────────────────────────────────────────

const TILE_BG: Record<LetterState, string> = { correct: '83;141;78', present: '181;159;59', absent: '58;58;60' }

function tiles(text: string, states?: LetterState[]): string {
  return text.split('').map((ch, i) => {
    if (states) return `\x1b[1;97;48;2;${TILE_BG[states[i]]}m ${ch} \x1b[0m`
    return ch === ' ' ? color.dim('[ ]') : `[${ch}]`
  }).join(' ')
}

function wordleScreen(unlimited: boolean): ScreenBody {
  const day = todayKey()
  const settings = settingsForMode(loadSettings(), unlimited ? 'unlimited' : 'daily')
  const tries = settings.tries
  let entries: WordleEntry[] | null = null
  let answer: WordleEntry | null = null
  let guesses: WordleGuess[] = []
  let status: GameStatus = 'playing'
  let input = ''
  let note = ''
  let failure = ''

  const persist = (): void => {
    if (!answer) return
    const round = { day, answerId: answer.song.id, guesses, status }
    if (unlimited) savePracticeRound(round)
    else saveRound(round)
  }

  const deal = (all: WordleEntry[]): void => {
    const next = pickRandomEntry(all)
    if (!next) { failure = 'not enough songs to make a puzzle'; return }
    answer = next; guesses = []; status = 'playing'; note = ''; input = ''
    persist()
  }

  const finishMessage = (): string | undefined => {
    if (!answer || status === 'playing') return undefined
    const grid = shareText(day, guesses.map((g) => gradeGuess(g.key, answer!.key)), status, tries, puzzleNumber(day))
    return `${status === 'won' ? 'solved' : 'the answer was'}: ${answer.song.name}\n${grid}`
  }

  const render = (s: Screen): void => {
    const title = `wordle · ${unlimited ? 'practice' : `daily #${puzzleNumber(day)}`}`
    const hint = status === 'playing' ? 'Enter guesses · Esc leaves (progress is saved)' : unlimited ? 'Enter deals a new song · Esc leaves' : 'Esc leaves'
    const lines = [header(s, title, hint), '']
    if (failure) { s.draw([...lines, color.red(failure), '', color.dim('Esc leaves')]); return }
    if (!answer || !entries) { s.draw([...lines, color.dim('loading the song list…')]); return }
    const length = answer.key.length
    const rows = guesses.map((g) => ({ g, states: gradeGuess(g.key, answer!.key) }))
    const hints = letterHints(rows.map((r) => ({ key: r.g.key, states: r.states })))
    lines.push(color.dim(`${length} letters · guess ${Math.min(guesses.length + (status === 'playing' ? 1 : 0), tries)}/${tries}`), '')
    for (const { g, states } of rows) {
      const sameEra = settings.eraHint && g.era && g.era === answer.song.era && g.key !== answer.key
      lines.push(`  ${tiles(g.key, states)}   ${color.dim(`${g.label}${sameEra ? '  · same era' : ''}`)}`)
    }
    if (status === 'playing' && guesses.length < tries) lines.push(`  ${tiles(titleKey(input).slice(0, length).padEnd(length, ' '))}`)
    for (let i = 0; i < tries - guesses.length - (status === 'playing' ? 1 : 0); i++) lines.push(`  ${tiles(' '.repeat(length))}`)
    lines.push('')
    lines.push(`  ${'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((c) => {
      const st = hints.get(c)
      return !st ? c : st === 'absent' ? color.dim(c) : `\x1b[1;38;2;${TILE_BG[st]}m${c}\x1b[0m`
    }).join(' ')}`, '')
    if (status === 'playing') {
      lines.push(`${color.cyan('guess>')} ${input}\x1b[7m \x1b[0m`)
      if (note) lines.push(color.red(note))
    } else {
      const done = `${status === 'won' ? `Solved in ${guesses.length}/${tries}` : 'Out of tries'}: ${answer.song.name}`
      lines.push(status === 'won' ? color.green(done) : color.red(done))
    }
    s.draw(lines)
  }

  const submit = (): void => {
    if (!answer || !entries || status !== 'playing') return
    const length = answer.key.length
    const key = titleKey(input)
    if (!key) return
    if (key.length !== length) { note = `the title has ${length} letters (yours has ${key.length})`; return }
    const hit = findEntryByKey(entries, key)
      ?? (() => { const s = searchOptions(entries!, length, input, 1)[0]; return s ? entries!.find((e) => e.song.id === s.id) ?? null : null })()
    if (!hit) { note = `no song title spells that in ${length} letters`; return }
    if (guesses.some((g) => g.songId === hit.song.id)) { note = 'already guessed'; return }
    guesses = [...guesses, { songId: hit.song.id, label: hit.song.name, key: hit.key, era: hit.song.era }]
    status = hit.key === answer.key ? 'won' : guesses.length >= tries ? 'lost' : 'playing'
    input = ''; note = ''
    persist()
    if (status !== 'playing' && !unlimited) recordResult(day, status === 'won', guesses.length)
  }

  return {
    start: async (s) => {
      render(s)
      try {
        const all = playableEntries(filterByEra(await loadPools(settings.categories), settings.eras))
        entries = all
        if (unlimited) {
          const saved = loadPracticeRound()
          const held = saved ? all.find((e) => e.song.id === saved.answerId) : undefined
          if (saved && held) { answer = held; guesses = saved.guesses; status = saved.status } else deal(all)
        } else {
          const today = pickDailyEntry(all, day)
          if (!today) failure = 'not enough songs to make a puzzle'
          else {
            answer = today
            const saved = loadRound(day, today.song.id)
            if (saved) { guesses = saved.guesses; status = saved.status }
          }
        }
      } catch (err) { failure = `couldn’t load the song list (${errText(err)})` }
      render(s)
    },
    key: (str, key, s) => {
      if (isLeave(key)) { s.exit(finishMessage()); return }
      if (key.name === 'return') {
        if (status !== 'playing') { if (unlimited && entries) deal(entries) } else submit()
      } else if (key.name === 'backspace') { input = input.slice(0, -1); note = '' }
      else if (key.ctrl && key.name === 'u') input = ''
      else {
        const ch = typed(str, key)
        if (ch && status === 'playing' && input.length < 80) { input += ch; note = '' }
      }
      render(s)
    },
    resize: (s) => render(s),
  }
}

// ─── heardle ─────────────────────────────────────────────────────────────────

/** Plays a stretch of a song through a separate, short-lived mpv (the music
 *  player's queue isn't touched). */
class ClipPlayer {
  private mpv: Mpv | null = null
  private loadedUrl: string | null = null
  private poll: NodeJS.Timeout | null = null
  private waiter: ((e: MpvEvent) => void) | null = null
  playing = false
  preparing = false
  elapsed = 0
  error = ''

  constructor(private readonly volume: number, private readonly changed: () => void) {}

  private onEvent(e: MpvEvent): void {
    if (this.waiter) { this.waiter(e); return }
    // The clip ran into the end of the song.
    if (e.event === 'end-file' && e.reason === 'eof') { this.loadedUrl = null; this.stop() }
  }

  private async engine(): Promise<Mpv> {
    if (this.mpv?.alive) return this.mpv
    const binary = findMpv() ?? fail(MPV_MISSING)
    const mpv = new Mpv((e) => this.onEvent(e), () => { this.mpv = null; this.loadedUrl = null; this.playing = false; this.changed() })
    await mpv.start(binary)
    await mpv.set('volume', this.volume)
    await mpv.set('pause', true)
    this.mpv = mpv
    return mpv
  }

  async play(url: string, from: number, seconds: number): Promise<void> {
    this.stop()
    this.preparing = true
    this.error = ''
    this.changed()
    try {
      const mpv = await this.engine()
      if (this.loadedUrl !== url) {
        // Paused first, so the start of the song never leaks out before the seek.
        await mpv.set('pause', true)
        const loaded = new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => { this.waiter = null; reject(new Error('the clip took too long to load')) }, 20_000)
          this.waiter = (e) => {
            if (e.event === 'file-loaded') { clearTimeout(timer); this.waiter = null; resolve() }
            else if (e.event === 'end-file' && e.reason === 'error') {
              clearTimeout(timer); this.waiter = null
              reject(new Error(`couldn’t load the clip${e.file_error ? ` (${e.file_error})` : ''}`))
            }
          }
        })
        await mpv.command('loadfile', url, 'replace')
        await loaded
        this.loadedUrl = url
      }
      await mpv.command('seek', from, 'absolute+exact')
      await mpv.set('pause', false)
      this.preparing = false
      this.playing = true
      this.elapsed = 0
      this.changed()
      this.poll = setInterval(() => {
        void mpv.get<number>('time-pos').then((pos) => {
          if (!this.playing) return
          this.elapsed = Math.max(0, (Number(pos) || from) - from)
          if (this.elapsed >= seconds) { this.elapsed = seconds; this.stop() }
          this.changed()
        }).catch(() => undefined)
      }, 100)
    } catch (err) {
      this.preparing = false
      this.playing = false
      this.error = errText(err)
      this.changed()
    }
  }

  stop(): void {
    if (this.poll) clearInterval(this.poll)
    this.poll = null
    if (this.playing || this.preparing) void this.mpv?.set('pause', true).catch(() => undefined)
    this.playing = false
  }

  shutdown(): void {
    this.stop()
    this.mpv?.stop()
    this.mpv = null
  }
}

function heardleScreen(sh: Shell, pausedMusic: boolean): ScreenBody {
  const settings = heardleSettingsForMode(loadHeardleSettings(), 'unlimited')
  const ladder = stageLadder(settings)
  let screen: Screen | null = null
  let pool: HeardleSong[] | null = null
  let versions: VersionMap | undefined
  let answer: HeardleSong | null = null
  let guesses: Guess[] = []
  let status: GameStatus = 'playing'
  let startAt = 0
  let input = ''
  let pick = 0
  let failure = ''
  const render = (): void => { if (screen && !screen.closed) draw(screen) }
  const clip = new ClipPlayer(sh.player?.volume ?? 100, render)

  const finished = (): boolean => status !== 'playing'
  const unlocked = (): number => unlockedSeconds(guesses.length, finished(), ladder)
  const save = (): void => { if (answer) saveHeardlePractice({ answerId: answer.id, guesses, status, startAt }) }
  const suggestions = (): HeardleSong[] => (pool && input.trim() ? searchPool(pool, input, 5) : [])

  const deal = (all: HeardleSong[]): void => {
    const next = pickRandomSong(all)
    if (!next) { failure = 'no songs to draw from (check the Heardle settings on the site)'; return }
    clip.stop()
    answer = next; guesses = []; status = 'playing'; input = ''; pick = 0
    startAt = clipStart(next, ladder[ladder.length - 1], settings.startPoint, null)
    save()
  }

  const record = (guess: Guess, correct: boolean): void => {
    guesses = [...guesses, guess]
    status = correct ? 'won' : guesses.length >= ladder.length ? 'lost' : 'playing'
    input = ''; pick = 0
    if (status !== 'playing') clip.stop()
    save()
  }

  const submit = (): void => {
    if (!answer || status !== 'playing') return
    if (!input.trim()) { record({ songId: null, label: 'skipped', era: null, sameEra: false }, false); return }
    const list = suggestions()
    const song = list[Math.min(pick, list.length - 1)]
    if (!song) return
    const correct = isCorrectGuess(song, answer, versions)
    record({
      songId: song.id, label: song.name, era: song.era,
      sameEra: settings.eraHint && !correct && !!song.era && song.era === answer.era,
      viaVersion: correct && song.id !== answer.id,
    }, correct)
  }

  const draw = (s: Screen): void => {
    const lines = [header(s, 'heardle · practice', 'Esc leaves'), color.dim('Tab plays the clip · Enter guesses (empty skips) · ↑↓ pick a suggestion'), '']
    if (failure) { s.draw([...lines, color.red(failure)]); return }
    if (!answer || !pool) { s.draw([...lines, color.dim('loading the song list…')]); return }
    const open = unlocked()
    lines.push(`${ladder.map((st) => (st <= open ? '▮' : '▯')).join(' ')}   ${color.dim(`${open}s unlocked · try ${Math.min(guesses.length + 1, ladder.length)}/${ladder.length}`)}`)
    const width = 24
    const filled = Math.max(0, Math.min(width, Math.round((clip.elapsed / Math.max(open, 0.1)) * width)))
    lines.push(`[${'█'.repeat(filled)}${'░'.repeat(width - filled)}] ${color.dim(clip.playing ? 'playing' : clip.preparing ? 'loading…' : 'Tab to play')}`)
    if (clip.error) lines.push(color.red(`${clip.error} (Tab to retry)`))
    lines.push('')
    guesses.forEach((g, i) => {
      const mark = g.songId === null ? '⏭' : status === 'won' && i === guesses.length - 1 ? color.green('✓') : color.red('✗')
      const text = `${g.label}${g.sameEra ? '  · same era' : ''}${g.viaVersion ? '  · another version of it' : ''}`
      lines.push(`${mark} ${g.songId === null ? color.dim(text) : text}`)
    })
    lines.push('')
    if (finished()) {
      const done = `${status === 'won' ? `Got it in ${guesses.length}` : 'Out of tries'}: ${answer.name}${answer.era ? `  (${answer.era})` : ''}`
      lines.push(status === 'won' ? color.green(done) : color.red(done), color.dim('Enter for another song · Tab plays the full clip'))
    } else {
      lines.push(`${color.cyan('guess>')} ${input}\x1b[7m \x1b[0m`)
      suggestions().forEach((song, i) => {
        const alias = normalizeTitle(song.name).includes(normalizeTitle(input)) ? '' : '  · alias'
        const text = `${song.name}${song.era ? `  (${song.era})` : ''}${alias}`
        lines.push(i === pick ? color.cyan(`› ${text}`) : color.dim(`  ${text}`))
      })
    }
    s.draw(lines)
  }

  return {
    start: async (s) => {
      screen = s
      render()
      try {
        const all = filterByEra(await loadPools(settings.categories), settings.eras)
        pool = all
        void loadVersionGroups(all).then((v) => { versions = v }).catch(() => undefined)
        const saved = loadHeardlePractice()
        const held = saved ? all.find((x) => x.id === saved.answerId) : undefined
        if (saved && held) { answer = held; guesses = saved.guesses; status = saved.status; startAt = saved.startAt } else deal(all)
      } catch (err) { failure = `couldn’t load the song list (${errText(err)})` }
      render()
    },
    key: (str, key, s) => {
      if (isLeave(key)) {
        clip.stop()
        const result = answer && finished() ? `${status === 'won' ? 'got it' : 'the answer was'}: ${answer.name}` : ''
        s.exit([result, pausedMusic ? 'your music is paused (play resumes it)' : ''].filter(Boolean).join('\n') || undefined)
        return
      }
      if (key.name === 'tab') {
        if (clip.playing || clip.preparing) { clip.stop(); render() }
        else if (answer) void clip.play(streamUrl(answer.path), startAt, unlocked())
        return
      }
      if (key.name === 'down') pick = Math.min(Math.max(0, suggestions().length - 1), pick + 1)
      else if (key.name === 'up') pick = Math.max(0, pick - 1)
      else if (key.name === 'return') { if (finished()) { if (pool) deal(pool) } else submit() }
      else if (key.name === 'backspace') { input = input.slice(0, -1); pick = 0 }
      else if (key.ctrl && key.name === 'u') { input = ''; pick = 0 }
      else {
        const ch = typed(str, key)
        if (ch && !finished() && input.length < 80) { input += ch; pick = 0 }
      }
      render()
    },
    resize: () => render(),
    stop: () => clip.shutdown(),
  }
}

// ─── The commands ────────────────────────────────────────────────────────────

const needScreen = (sh: Shell, name: string): void => {
  if (sh.scripted) fail(`${name}: not inside a script or watch`)
  if (!canOpenScreen()) fail(`${name}: needs an interactive terminal`)
}

export const GAME_COMMANDS: Command[] = [
  {
    name: 'wordle', group: 'Fun', usage: 'wordle [daily | unlimited]',
    description: 'The song-title Wordle (the same daily puzzle as the site). Progress and streaks are kept in ~/.unreleased',
    complete: async (arg) => ['daily', 'unlimited'].filter((w) => w.startsWith(arg.trim().toLowerCase())),
    run: async (args, sh) => {
      const mode = args.trim().toLowerCase()
      if (mode && !['daily', 'unlimited', 'practice'].includes(mode)) fail('usage: wordle [daily | unlimited]')
      needScreen(sh, 'wordle')
      const message = await openScreen(wordleScreen(mode === 'unlimited' || mode === 'practice'))
      if (message) sh.print(message)
    },
  },
  {
    name: 'heardle', group: 'Fun', usage: 'heardle', description: 'Name the song from a short clip (practice rounds, with your Heardle settings)',
    run: async (_a, sh) => {
      needScreen(sh, 'heardle')
      if (!findMpv()) fail(MPV_MISSING)
      // The clip and your music shouldn't play over each other.
      let pausedMusic = false
      if (sh.player?.current && !(await sh.player.paused())) { await sh.player.setPaused(true); pausedMusic = true }
      const message = await openScreen(heardleScreen(sh, pausedMusic))
      if (message) sh.print(message)
    },
  },
]
