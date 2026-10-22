import { relativeTime } from '../../components/adminShared'
import { formatBytes } from '../format'
import { DONOR_ALLOWED_EXTENSIONS, extensionOf, isImageFile } from '../donorFilesApi'
import {
  createLyricsJob, deleteLyricsJob, fetchLyricsJobOutput, getLyricsAdminSettings, getLyricsGenOptions, getLyricsJob,
  isFinished, LYRICS_MAX_FILE_SIZE, LYRICS_MAX_TEXT, setLyricsWhisperModel,
  type LyricsGenJob, type LyricsGenMode, type LyricsGenRequest, type LyricsOutput,
} from '../lyricsGenApi'
import { isAbortError } from '../apiClient'
import { ls } from '../persist'
import { useStore } from '../../store/useStore'
import { pickLocalFile, saveBlob } from './pick'
import { asJson, confirmAction, fail, parseArgs, table, type TermCommand, type TermCtx } from './types'

// Donor lyrics generation: Whisper on the server transcribes a song's audio
// (plain), or lines the user's own text up with it (synced, per-word). The
// result is a preview to read and download; nothing reaches the library. The
// API has no "list my jobs", so the terminal remembers the ids it started, per
// account, newest first.
const st = (): ReturnType<typeof useStore.getState> => useStore.getState()

const POLL_MS = 3000
const REMEMBER = 100
const MODES: Record<string, LyricsGenMode> = { plain: 'plain', sync: 'synced', synced: 'synced', words: 'word_synced', word: 'word_synced', word_synced: 'word_synced' }
const MODE_NAME: Record<LyricsGenMode, string> = { plain: 'plain', synced: 'sync', word_synced: 'words' }
const OUTPUTS: Record<string, LyricsOutput> = { txt: 'txt', text: 'txt', plain: 'txt', lrc: 'lrc', enhanced: 'enhanced_lrc', enhanced_lrc: 'enhanced_lrc', words: 'enhanced_lrc' }
const AUDIO_EXTENSIONS = DONOR_ALLOWED_EXTENSIONS.filter((e) => !isImageFile({ filename: `x.${e}`, mime_type: '' }))
const SUBCOMMANDS = ['ls', 'status', 'plain', 'sync', 'words', 'show', 'wait', 'get', 'rm']

interface Remembered { id: string; mode: LyricsGenMode; filename: string; created_at: string }

// The audio the last job was made from. The server deletes it after every job,
// so a follow-up (sync the text you just reviewed) uploads this again rather
// than asking for the file a second time. Kept for this run of the app only.
let lastAudio: File | null = null

const storeKey = (): string => `lyricsJobs:${st().account?.id ?? 0}`
const remembered = (): Remembered[] => ls.get<Remembered[]>(storeKey()) ?? []
const remember = (list: Remembered[]): void => ls.set(storeKey(), list.slice(0, REMEMBER))

/** A job by its number in `lyricsgen ls` (1 = newest), the start of its id, or
 *  "last". Nothing typed means the newest. */
function jobRef(arg: string | undefined): Remembered {
  const list = remembered()
  const q = (arg ?? '').trim().toLowerCase().replace(/^#/, '')
  if (!q || q === 'last') return list[0] ?? fail('no lyrics jobs yet (lyricsgen plain)')
  if (/^\d+$/.test(q) && Number(q) >= 1 && Number(q) <= list.length) return list[Number(q) - 1]
  const hits = list.filter((j) => j.id.toLowerCase().startsWith(q))
  if (hits.length === 1) return hits[0]
  if (/^[0-9a-f-]{36}$/.test(q)) return { id: q, mode: 'plain', filename: '', created_at: '' }
  return fail(hits.length ? `${hits.length} jobs match "${q}" - type more of the id` : `no job "${q}" (lyricsgen ls)`)
}

const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve() }, ms)
    const onAbort = (): void => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')) }
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
  })

/** Polls until the job finishes. Ctrl+C stops waiting, not the job. */
async function follow(ctx: TermCtx, id: string): Promise<LyricsGenJob | null> {
  const signal = ctx.signal
  let seen = ''
  try {
    for (;;) {
      const job = await getLyricsJob(id, signal)
      if (isFinished(job)) return job
      if (job.status !== seen) { seen = job.status; ctx.print(`${job.status}… (Ctrl+C stops waiting; the job keeps going)`, 'dim') }
      await sleep(POLL_MS, signal)
    }
  } catch (err) {
    if (!isAbortError(err) && !signal.aborted) throw err
    ctx.print('stopped waiting - the job is still running. lyricsgen wait picks it up again', 'dim')
    return null
  }
}

function printResult(ctx: TermCtx, job: LyricsGenJob, n: number | null): void {
  const ref = n ?? job.id.slice(0, 8)
  if (job.status === 'failed') { ctx.print(`failed: ${job.error || 'no reason given'}`, 'error'); return }
  if (job.status !== 'completed') { ctx.print(`${job.status} - lyricsgen wait ${ref}`, 'dim'); return }
  const r = job.result
  const text = job.mode === 'plain' ? r.plain_lyrics : r.synced_lyrics
  ctx.print(text?.trim() || '(no lyrics came back)')
  const next = job.mode === 'plain'
    ? `get it: lyricsgen get ${ref} txt · sync this text: lyricsgen sync ${ref} (or words ${ref}) · to fix lines first, edit the .txt and run lyricsgen sync --file`
    : job.mode === 'synced'
      ? `get it: lyricsgen get ${ref} lrc · per-word timing from these lines: lyricsgen words ${ref}`
      : `get it: lyricsgen get ${ref} enhanced (per word) or lrc (per line)`
  ctx.print(`preview only, nothing was saved to the song. ${next}`, 'dim')
}

/** The playing song's audio, fetched from its stream. */
async function nowPlayingAudio(ctx: TermCtx): Promise<File> {
  const track = st().currentTrack ?? fail('nothing is playing')
  if (!track.streamUrl) fail(`${track.title} plays from this computer - drop --now and pick its file`)
  ctx.print(`fetching ${track.title}…`, 'dim')
  const res = await fetch(track.streamUrl!, { signal: ctx.signal })
  if (!res.ok) fail(`couldn't load ${track.title} (HTTP ${res.status})`)
  const blob = await res.blob()
  const fromPath = track.path.split('/').pop() ?? ''
  const type = blob.type.split(';')[0]
  const ext = AUDIO_EXTENSIONS.includes(extensionOf(fromPath)) ? '' : ({ 'audio/flac': 'flac', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/ogg': 'ogg', 'audio/opus': 'opus' }[type] ?? 'mp3')
  return new File([blob], ext ? `${track.title.replace(/[\\/:*?"<>|]/g, '_')}.${ext}` : fromPath, { type: blob.type })
}

function checkAudio(file: File, max: number): File {
  if (!AUDIO_EXTENSIONS.includes(extensionOf(file.name))) fail(`${file.name}: pick an audio file (${AUDIO_EXTENSIONS.join(', ')})`)
  if (file.size === 0) fail(`${file.name} is empty`)
  if (file.size > max) fail(`${file.name} is ${formatBytes(file.size)}; the limit is ${formatBytes(max)}`)
  return file
}

const looksLikeLrc = (text: string): boolean => /^\s*\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/m.test(text)

function lyricsBody(text: string, source: string): Pick<LyricsGenRequest, 'plainLyrics' | 'syncedLyrics'> {
  const t = text.trim()
  if (!t) fail(`${source} has no lyrics`)
  if (t.length > LYRICS_MAX_TEXT) fail(`${source} is ${t.length.toLocaleString()} characters; the limit is ${LYRICS_MAX_TEXT.toLocaleString()}`)
  return looksLikeLrc(t) ? { syncedLyrics: t } : { plainLyrics: t }
}

// Start a job, then follow it to the end. Pickers only open straight after a
// keypress, so whichever file has to be picked first is picked first thing,
// and a second pick waits for Enter.
async function start(mode: LyricsGenMode, args: string, ctx: TermCtx): Promise<void> {
  const { rest, bool, value } = parseArgs(args, ['lang', 'language'])
  const language = (value.get('lang') ?? value.get('language') ?? '').toLowerCase()
  if (language && !/^[a-z]{2,3}$/.test(language)) fail('--lang takes a two or three letter code, like en')
  const now = bool.has('now')
  const fromArg = rest[0]
  if (mode === 'plain' && (fromArg || bool.has('file') || bool.has('f'))) fail('plain transcribes the audio alone - it takes no lyrics')

  // Where the text comes from (sync modes): an earlier job, a file, or the
  // playing song's own lyrics.
  let from: LyricsGenJob | null = null
  let text: Pick<LyricsGenRequest, 'plainLyrics' | 'syncedLyrics'> = {}
  let pickLyrics = false
  if (mode !== 'plain') {
    if (fromArg) {
      from = await getLyricsJob(jobRef(fromArg).id, ctx.signal)
      if (from.status !== 'completed') fail(`that job is ${from.status}${from.error ? `: ${from.error}` : ''}`)
      text = from.mode === 'plain' ? lyricsBody(from.result.plain_lyrics ?? '', 'that job') : lyricsBody(from.result.synced_lyrics ?? '', 'that job')
    } else if (!bool.has('file') && !bool.has('f') && now) {
      const track = st().currentTrack ?? fail('nothing is playing')
      const full = st().currentTrackFull
      const loaded = full && full.id === track.id && !full.lyricsPending ? full : fail(`${track.title}'s lyrics are still loading - try again in a moment`)
      const own = loaded.syncedLyrics?.trim() || loaded.lyrics?.trim() || fail(`${track.title} has no lyrics - run lyricsgen plain --now first, or add --file`)
      text = lyricsBody(own, `${track.title}'s lyrics`)
    } else pickLyrics = true
  }

  // The audio: the playing song, the file the last job used (same song), or a pick.
  const sameSong = lastAudio && !bool.has('audio') && (!from || from.filename === lastAudio.name)
  let audio: File | null = now ? null : sameSong ? lastAudio : null
  const pickAudio = !now && !audio
  if (pickAudio) audio = await pickLocalFile('audio/*')
  if (pickLyrics) {
    if (pickAudio) await ctx.ask('press Enter to choose the lyrics (.txt or .lrc) ')
    const file = await pickLocalFile('.txt,.lrc,text/plain')
    text = lyricsBody(await file.text(), file.name)
  }

  const options = await getLyricsGenOptions(ctx.signal)
  const opt = options.options.find((o) => o.mode === mode)
  if (!options.available) fail(`lyrics generation is off: ${options.unavailable_reason || 'unavailable'}`)
  if (opt && !opt.available) fail(`${MODE_NAME[mode]} isn't available: ${opt.unavailable_reason || 'unavailable'}`)
  if (now) audio = await nowPlayingAudio(ctx)
  const file = checkAudio(audio!, options.max_file_size || LYRICS_MAX_FILE_SIZE)
  if (!pickAudio && !now) ctx.print(`using ${file.name} again (--audio picks another)`, 'dim')
  lastAudio = file

  ctx.print(`uploading ${file.name} (${formatBytes(file.size)})…`, 'dim')
  let shown = 0
  const job = await createLyricsJob(file, { mode, language: language || undefined, ...text }, (f) => {
    const pct = Math.floor(f * 4) * 25
    if (pct > shown && pct < 100) { shown = pct; ctx.print(`${file.name} ${pct}%`, 'dim') }
  }, ctx.signal)
  remember([{ id: job.id, mode: job.mode, filename: job.filename || file.name, created_at: job.created_at }, ...remembered().filter((j) => j.id !== job.id)])
  ctx.print(`started ${MODE_NAME[mode]} job 1 (${job.id.slice(0, 8)}) for ${file.name}`, 'ok')
  const done = await follow(ctx, job.id)
  if (done) printResult(ctx, done, 1)
}

export const LYRICS_GEN_COMMANDS: TermCommand[] = [
  {
    name: 'lyricsgen', aliases: ['lyricgen'], group: 'Account',
    usage: 'lyricsgen [ls] · status · plain [--now] · sync|words [<job> | --file] [--now] · show|wait|get|rm <job>',
    description: 'Donors: generate lyrics with Whisper. plain transcribes a song; sync and words time your lyrics to it (from an earlier job, a .txt/.lrc file, or with --now the playing song and its lyrics). --lang en, --audio picks new audio. get <job> txt|lrc|enhanced downloads',
    covers: ['lyricsGenApi.getLyricsGenOptions', 'lyricsGenApi.createLyricsJob', 'lyricsGenApi.getLyricsJob', 'lyricsGenApi.fetchLyricsJobOutput', 'lyricsGenApi.deleteLyricsJob'],
    complete: (before, partial) => {
      const p = partial.toLowerCase()
      if (before.length === 0) return SUBCOMMANDS.filter((v) => v.startsWith(p))
      if (before[0] === 'get' && before.length === 2) return ['txt', 'lrc', 'enhanced'].filter((v) => v.startsWith(p))
      return []
    },
    run: async (args, ctx) => {
      const account = st().account ?? fail('sign in first (login)')
      if (account.is_donor === false) fail('lyrics generation is for donors')
      const [, first, rest] = /^(\S*)\s*([\s\S]*)$/.exec(args.trim())!
      const sub = (first || 'ls').toLowerCase()
      if (Object.prototype.hasOwnProperty.call(MODES, sub)) { await start(MODES[sub], rest, ctx); return }
      const { rest: words, bool } = parseArgs(rest)
      if (sub === 'ls' || sub === 'list' || sub === '--json') {
        const json = bool.has('json') || sub === '--json'
        const list = remembered()
        if (!list.length) { ctx.print('no lyrics jobs yet (lyricsgen plain)', 'dim'); return }
        const shown = list.slice(0, 20)
        const jobs = await Promise.all(shown.map((j) => getLyricsJob(j.id, ctx.signal).catch((err: Error) => (/not found/i.test(err.message) ? null : err))))
        const gone = new Set(shown.filter((_, i) => jobs[i] === null).map((j) => j.id))
        if (gone.size) remember(list.filter((j) => !gone.has(j.id)))
        const kept = shown.map((j, i) => ({ j, r: jobs[i] })).filter((x) => x.r !== null)
        if (asJson(ctx, json, kept.map((x) => (x.r instanceof Error ? { id: x.j.id, error: x.r.message } : x.r)))) return
        if (!kept.length) { ctx.print('no lyrics jobs left (previews expire after 7 days)', 'dim'); return }
        ctx.print(table(kept.map(({ j, r }, i) => [String(i + 1), MODE_NAME[j.mode], r instanceof Error ? `? ${r.message}` : r!.status, j.filename, j.created_at ? relativeTime(j.created_at) : ''])))
      } else if (sub === 'status' || sub === 'options') {
        const o = await getLyricsGenOptions(ctx.signal)
        if (asJson(ctx, bool.has('json'), o)) return
        ctx.print(o.available ? `available · audio up to ${formatBytes(o.max_file_size)}` : `off: ${o.unavailable_reason || 'unavailable'}`, o.available ? 'ok' : 'error')
        ctx.print(table(o.options.map((m) => [MODE_NAME[m.mode], m.label, m.available ? (m.requires_lyrics ? 'needs lyrics' : 'audio only') : `off: ${m.unavailable_reason || 'unavailable'}`])))
        ctx.print('this checks the server has Whisper installed, not that its worker is running', 'dim')
      } else if (sub === 'show' || sub === 'wait') {
        const ref = jobRef(words[0])
        const n = remembered().findIndex((j) => j.id === ref.id)
        const job = sub === 'wait' ? await follow(ctx, ref.id) : await getLyricsJob(ref.id, ctx.signal)
        if (!job || asJson(ctx, bool.has('json'), job)) return
        ctx.print(`${MODE_NAME[job.mode]} · ${job.filename}${job.language ? ` · ${job.language}` : ''} · ${job.status} · ${relativeTime(job.created_at)}`, 'dim')
        printResult(ctx, job, n >= 0 ? n + 1 : null)
      } else if (sub === 'get' || sub === 'download') {
        const ref = jobRef(words[0])
        const job = await getLyricsJob(ref.id, ctx.signal)
        if (job.status !== 'completed') fail(`that job is ${job.status}${job.error ? `: ${job.error}` : ''}`)
        const want = words[1]?.toLowerCase()
        const output = want ? OUTPUTS[want] ?? fail('get <job> txt | lrc | enhanced') : job.mode === 'plain' ? 'txt' : job.mode === 'synced' ? 'lrc' : 'enhanced_lrc'
        const text = await fetchLyricsJobOutput(job.id, output, ctx.signal)
        const base = (job.filename || 'lyrics').replace(/\.[^.]+$/, '')
        const name = output === 'txt' ? `${base}.txt` : output === 'lrc' ? `${base}.lrc` : `${base}.words.lrc`
        saveBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), name)
        ctx.print(`saved ${name} to your downloads`, 'ok')
      } else if (sub === 'rm' || sub === 'delete') {
        const ref = jobRef(words[0])
        if (!confirmAction(ctx, `Delete the lyrics preview for ${ref.filename || ref.id}?`, bool.has('y'))) return
        await deleteLyricsJob(ref.id)
        remember(remembered().filter((j) => j.id !== ref.id))
        ctx.print(`deleted ${ref.filename || ref.id}`, 'ok')
      } else fail('usage: lyricsgen [ls | status | plain | sync | words | show | wait | get | rm]')
    },
  },
  {
    name: 'lyricsmodel', group: 'Admin', usage: 'lyricsmodel [<model> | default] [--json]',
    description: 'The Whisper model lyrics generation uses. No argument shows it; default goes back to the server setting. Applies from the next job',
    covers: ['lyricsGenApi.getLyricsAdminSettings', 'lyricsGenApi.setLyricsWhisperModel'],
    complete: async (before, partial) => (before.length === 0 ? ['default', ...(await getLyricsAdminSettings().then((s) => s.available_models).catch(() => []))].filter((m) => m.startsWith(partial.toLowerCase())) : []),
    run: async (args, ctx) => {
      const { rest, bool } = parseArgs(args)
      const want = rest[0]?.toLowerCase()
      let s = await getLyricsAdminSettings(ctx.signal)
      if (want) {
        const model = want === 'default' || want === 'reset' ? '' : s.available_models.find((m) => m.toLowerCase() === want) ?? fail(`not a Whisper model. Pick one of: ${s.available_models.join(', ')}`)
        s = await setLyricsWhisperModel(model)
      }
      if (asJson(ctx, bool.has('json'), s)) return
      ctx.print(`${s.effective_model}${s.whisper_model ? '' : ' (server default)'}`, want ? 'ok' : 'plain')
      ctx.print(`server default ${s.default_model}${s.updated_by ? ` · last set by ${s.updated_by}${s.updated_at ? ` ${relativeTime(s.updated_at)}` : ''}` : ''}`, 'dim')
      if (!want) ctx.print(`models: ${s.available_models.join(', ')}`, 'dim')
      else ctx.print('the next job uses it; one that has not been used before downloads first, so that job is slow', 'dim')
    },
  },
]
